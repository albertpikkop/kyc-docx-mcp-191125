import { KycProfile, KycValidationResult } from "./types.js";
import { resolveUbo, resolveSignatories, checkFreshness, buildTrace, checkEquityConsistency, isPersonaFisica } from "./validation.js";
import { DEMO_CONFIG } from "../core/demoConfig.js";

export interface KycReportSection {
  title: string;
  body: string;
}

export interface KycReport {
  customerId: string;
  generatedAt: string;
  sections: KycReportSection[];
}

export interface ReportOptions {
  redacted?: boolean;
  includeTrace?: boolean;
}

/**
 * Formats an address object into a single line string.
 * Uses the extracted zip code (cp) exactly as provided.
 * If redacted is true, masks sensitive parts (street numbers, postal codes).
 */
function formatAddress(addr: any, redacted: boolean = false): string {
  if (!addr) return "N/A";
  
  // Ensure we use the CP from the address object itself, not normalized across roles.
  // (The input 'addr' is already specific to the role/source)
  
  const parts = [
    addr.street, 
    addr.ext_number ? `No. ${redacted ? maskString(addr.ext_number, 2) : addr.ext_number}` : '',
    addr.int_number ? `Int. ${redacted ? maskString(addr.int_number, 2) : addr.int_number}` : '',
    addr.colonia,
    addr.municipio,
    addr.estado,
    addr.cp ? (redacted ? maskString(addr.cp, 2) : addr.cp) : null, // Mask postal code if redacted
    addr.country
  ].filter(p => p && p !== "null" && p !== "");
  
  return parts.join(", ");
}

function maskString(str: string | null, visibleEnd: number = 4): string {
    if (!str) return "N/A";
    if (str.length <= visibleEnd) return str;
    return "*".repeat(str.length - visibleEnd) + str.slice(-visibleEnd);
}

/**
 * Builds a structured KYC report (Hechos + Conclusiones + Traza)
 */
export function buildKycReport(
  profile: KycProfile,
  validation: KycValidationResult,
  options: ReportOptions = {}
): KycReport {
  
  // Default options for Demo Mode
  if (DEMO_CONFIG.enabled) {
      options.includeTrace = options.includeTrace ?? true;
      options.redacted = false; // DISABLED MASKING
  }

  const sections: KycReportSection[] = [];
  const isPF = isPersonaFisica(profile);

  // --- SECTION I: HECHOS EXTRAÍDOS ---
  let hechosBody = "";

  // 1. Identidad (Acta for Corporate, Identity Doc for PF)
  if (isPF) {
      hechosBody += "### 1. Identidad Personal (Fuente: INE/FM2)\n";
      if (profile.representativeIdentity) {
          const id = profile.representativeIdentity as any; // Cast to access INE-specific fields
          const hasIneFields = !!(id.clave_elector || id.cic || id.ocr_number);
          const docType = hasIneFields ? 'INE' : (id.document_type || 'FM2');
          
          // Front side data
          hechosBody += `- **Nombre Completo:** ${id.full_name || "N/A"}\n`;
          hechosBody += `- **CURP:** ${id.curp || "N/A"}\n`;
          if (id.date_of_birth) {
              hechosBody += `- **Fecha de Nacimiento:** ${id.date_of_birth}\n`;
          }
          hechosBody += `- **Sexo:** ${id.sex === 'H' ? 'Hombre' : id.sex === 'M' ? 'Mujer' : (id.sex || 'N/A')}\n`;
          hechosBody += `- **Nacionalidad:** ${id.nationality || (hasIneFields ? 'MEXICANA' : 'N/A')}\n`;
          
          // Back side data (INE-specific)
          if (hasIneFields) {
              hechosBody += `\n**Datos del Reverso del INE:**\n`;
              hechosBody += `- **Clave de Elector:** ${id.clave_elector || "N/A"}\n`;
              hechosBody += `- **CIC:** ${id.cic || "N/A"}\n`;
              hechosBody += `- **OCR:** ${id.ocr_number || "N/A"}\n`;
              if (id.seccion) hechosBody += `- **Sección Electoral:** ${id.seccion}\n`;
              if (id.estado_registro) hechosBody += `- **Estado de Registro:** ${id.estado_registro}\n`;
              hechosBody += `- **Año de Emisión:** ${id.emission_year || "N/A"}\n`;
              hechosBody += `- **Vigencia:** ${id.vigencia_year || "N/A"}\n`;
          } else {
              // FM2 data
              hechosBody += `- **Documento:** ${docType}\n`;
              if (id.document_number) hechosBody += `- **Número de Documento:** ${id.document_number}\n`;
          }
          
          // Address from INE/FM2
          if (id.address) {
              hechosBody += `\n**Domicilio en ${docType}:**\n`;
              const addr = id.address;
              const addrStr = [addr.street, addr.colonia, addr.municipio, addr.estado, addr.cp].filter(Boolean).join(', ');
              hechosBody += `- ${addrStr || 'N/A'}\n`;
          }
      } else {
          hechosBody += "- *No se encontró documento de identidad (INE/FM2).*\n";
      }
      hechosBody += "\n";
      hechosBody += "**Nota:** Acta constitutiva no aplica para Persona Física.\n";
      hechosBody += "\n";
  } else {
      hechosBody += "### 1. Identidad Corporativa (Fuente: Acta Constitutiva)\n";
      if (profile.companyIdentity) {
          const id = profile.companyIdentity;
          hechosBody += `- **Razón Social:** ${id.razon_social}\n`;
          hechosBody += `- **Fecha Constitución:** ${id.incorporation_date}\n`;
          
          // Fix: Handle empty/null founding address explicitly
          // Only show full address if street-level details exist, otherwise show friendly message
          if (id.founding_address && id.founding_address.street && id.founding_address.ext_number) {
              hechosBody += `- **Domicilio Fundacional (Histórico):** ${formatAddress(id.founding_address, options.redacted)}\n`;
          } else if (id.founding_address && id.founding_address.municipio) {
              // Only jurisdiction provided (e.g., "Ciudad de México")
              hechosBody += `- **Domicilio Fundacional (Histórico):** No especificado en la escritura (solo se indica ${id.founding_address.municipio}).\n`;
          } else {
              hechosBody += `- **Domicilio Fundacional (Histórico):** No especificado en la escritura.\n`;
          }
          
          // ========== NOTARY INFORMATION ==========
          if (id.notary) {
              hechosBody += `\n**Datos Notariales:**\n`;
              hechosBody += `- **Notario:** ${id.notary.name || 'N/A'}\n`;
              hechosBody += `- **Notaría No.:** ${id.notary.notary_number || 'N/A'}\n`;
              hechosBody += `- **Escritura/Protocolo No.:** ${id.notary.protocol_number || 'N/A'}\n`;
              hechosBody += `- **Fecha de Protocolo:** ${id.notary.protocol_date || 'N/A'}\n`;
              hechosBody += `- **Lugar de Otorgamiento:** ${id.notary.office_location || 'N/A'}\n`;
          }
          
          // ========== REGISTRY / FOLIO MERCANTIL ==========
          if (id.registry) {
              hechosBody += `\n**Inscripción en Registro Público de Comercio:**\n`;
              if (id.registry.fme) {
                  hechosBody += `- **Folio Mercantil Electrónico (FME):** ${id.registry.fme}\n`;
              }
              if (id.registry.folio) {
                  hechosBody += `- **Folio Mercantil:** ${id.registry.folio}\n`;
              }
              if (id.registry.nci) {
                  hechosBody += `- **NCI (Número de Control Interno):** ${id.registry.nci}\n`;
              }
              if (id.registry.unique_doc_number) {
                  hechosBody += `- **Número Único de Documento:** ${id.registry.unique_doc_number}\n`;
              }
              if (id.registry.registration_city) {
                  hechosBody += `- **Ciudad de Inscripción:** ${id.registry.registration_city}\n`;
              }
              if (id.registry.registration_date) {
                  hechosBody += `- **Fecha de Inscripción:** ${id.registry.registration_date}\n`;
              }
              // If no registry info at all
              if (!id.registry.fme && !id.registry.folio && !id.registry.nci) {
                  hechosBody += `- *Pendiente de inscripción o datos no disponibles en el Acta.*\n`;
              }
          }
      } else {
          hechosBody += "- *No se encontró Acta Constitutiva.*\n";
      }
      hechosBody += "\n";
      
      // ========== BOLETA RPC (FME from dedicated document) ==========
      const boletaRPC = (profile as any).boletaRPC;
      if (boletaRPC) {
          hechosBody += "### 1.5 Boleta de Inscripción RPC\n";
          if (boletaRPC.numero_unico_documento) {
              hechosBody += `- **FME (Número Único de Documento):** ${boletaRPC.numero_unico_documento}\n`;
          }
          if (boletaRPC.libro) {
              hechosBody += `- **Libro:** ${boletaRPC.libro}\n`;
          }
          if (boletaRPC.fecha_inscripcion) {
              hechosBody += `- **Fecha de Inscripción:** ${boletaRPC.fecha_inscripcion}\n`;
          }
          if (boletaRPC.tipo_acto) {
              hechosBody += `- **Tipo de Acto:** ${boletaRPC.tipo_acto}\n`;
          }
          if (boletaRPC.razon_social) {
              hechosBody += `- **Razón Social Registrada:** ${boletaRPC.razon_social}\n`;
          }
          if (boletaRPC.capital_social) {
              hechosBody += `- **Capital Social Registrado:** $${boletaRPC.capital_social.toLocaleString('es-MX')} MXN\n`;
          }
          if (boletaRPC.duracion) {
              hechosBody += `- **Duración:** ${boletaRPC.duracion}\n`;
          }
          hechosBody += "\n";
      }
      
      // ========== RNIE (Foreign Investment Registry) ==========
      const rnieConstancia = (profile as any).rnieConstancia;
      if (rnieConstancia) {
          hechosBody += "### 1.6 Registro Nacional de Inversiones Extranjeras (RNIE)\n";
          if (rnieConstancia.folio_ingreso) {
              hechosBody += `- **Folio de Ingreso RNIE:** ${rnieConstancia.folio_ingreso}\n`;
          }
          if (rnieConstancia.fecha_recepcion) {
              hechosBody += `- **Fecha de Recepción:** ${rnieConstancia.fecha_recepcion}\n`;
          }
          if (rnieConstancia.tipo_tramite) {
              hechosBody += `- **Tipo de Trámite:** ${rnieConstancia.tipo_tramite}\n`;
          }
          if (rnieConstancia.razon_social) {
              hechosBody += `- **Razón Social:** ${rnieConstancia.razon_social}\n`;
          }
          hechosBody += `- **Fundamento Legal:** Ley de Inversión Extranjera Art. 32-35\n`;
          hechosBody += "\n";
      }
      
      // ========== SRE Convenio de Extranjería ==========
      const sreConvenio = (profile as any).sreConvenio;
      if (sreConvenio && sreConvenio.folio) {
          hechosBody += "### 1.7 Convenio de Extranjería (SRE)\n";
          hechosBody += `- **Folio SRE:** ${sreConvenio.folio}\n`;
          if (sreConvenio.fecha_registro) {
              hechosBody += `- **Fecha de Registro:** ${sreConvenio.fecha_registro}\n`;
          }
          if (sreConvenio.tipo_aviso) {
              hechosBody += `- **Tipo de Aviso:** ${sreConvenio.tipo_aviso}\n`;
          }
          hechosBody += "\n";
      }
  }

  // 2. Perfil Fiscal (SAT)
  if (isPF) {
      hechosBody += "### 2. Perfil Fiscal (Fuente: SAT Constancia)\n";
  } else {
      hechosBody += "### 2. Perfil Fiscal (Fuente: SAT Constancia)\n";
  }
  if (profile.companyTaxProfile) {
      const tax = profile.companyTaxProfile;
      hechosBody += `- **RFC:** ${tax.rfc}\n`;
      hechosBody += `- **Régimen Fiscal:** ${tax.tax_regime}\n`;
      if (isPF && tax.tax_regime && tax.tax_regime.toUpperCase().includes('SIN OBLIGACIONES FISCALES')) {
          hechosBody += `- **Nota:** Régimen fiscal: Sin obligaciones fiscales (no implica exención; solo indica ausencia de actividad económica registrada).\n`;
      }
      hechosBody += `- **Estatus:** ${tax.status}\n`;
      hechosBody += `- **Domicilio Fiscal (Actual):** ${formatAddress(tax.fiscal_address, options.redacted)}\n`;
      
      if (tax.economic_activities && tax.economic_activities.length > 0) {
          hechosBody += `- **Actividades Económicas:**\n`;
          tax.economic_activities.forEach(act => {
              hechosBody += `  - ${act.description} (${act.percentage}%)\n`;
          });
      }
  } else {
      hechosBody += "- *No se encontró Constancia Fiscal.*\n";
  }
  hechosBody += "\n";

  // 3. Identidad del Representante (FM2/INE)
  // For Persona Física, this is redundant with Section 1 ("Identidad Personal").
  // We only show it if it's a corporate entity (Persona Moral).
  if (!isPF) {
      hechosBody += "### 3. Identidad del Representante\n";
      if (profile.representativeIdentity) {
          const rep = profile.representativeIdentity as any; // Cast to access INE-specific fields
          hechosBody += `- **Nombre:** ${rep.full_name}\n`;
          
          // For INE documents, use CIC as the document identifier
          // For FM2/Passport, use document_number
          const isINE = rep.document_type === 'INE' || rep.document_type === 'IFE' || rep.cic;
          const docNumRaw = isINE ? (rep.cic || "") : (rep.document_number || "");
          const docType = rep.document_type || (isINE ? 'INE' : 'ID');
          
          if (docNumRaw.length < 4) { 
              hechosBody += `- **Documento:** ${docType} (número no disponible)\n`;
          } else {
              const docNum = options.redacted ? maskString(docNumRaw) : docNumRaw;
              hechosBody += `- **Documento:** ${docType} (${docNum})\n`;
          }

          hechosBody += `- **Nacionalidad:** ${rep.nationality || "MEXICANA"}\n`;
          
          // Date of Birth - consistent with Persona Física section
          if (rep.date_of_birth) {
              hechosBody += `- **Fecha de Nacimiento:** ${rep.date_of_birth}\n`;
          }
          
          // FIX: Check strict length for CURP (must be 18)
          const curpRaw = rep.curp || "";
          if (curpRaw.length !== 18) {
               hechosBody += `- **CURP:** Incomplete/Error (${curpRaw})\n`;
          } else {
               // Output full CURP if unmasked
               const curp = options.redacted ? maskString(curpRaw, 4) : curpRaw;
               hechosBody += `- **CURP:** ${curp}\n`;
          }

      } else {
          hechosBody += "- *No se encontró documento de identidad del representante.*\n";
      }
      hechosBody += "\n";
      
      // 3b. Passport Identity (for foreign nationals)
      if (profile.passportIdentity) {
          hechosBody += "### 3b. Pasaporte / Passport\n";
          const passport = profile.passportIdentity;
          hechosBody += `- **Nombre / Name:** ${passport.full_name || "N/A"}\n`;
          hechosBody += `- **Número / Number:** ${options.redacted ? maskString(passport.document_number || "", 4) : (passport.document_number || "N/A")}\n`;
          hechosBody += `- **Nacionalidad / Nationality:** ${passport.nationality || "N/A"}\n`;
          hechosBody += `- **País Emisor / Issuer:** ${passport.issuer_country || "N/A"}\n`;
          if (passport.date_of_birth) {
              hechosBody += `- **Fecha de Nacimiento / DOB:** ${passport.date_of_birth}\n`;
          }
          if (passport.issue_date) {
              hechosBody += `- **Fecha de Expedición / Issue Date:** ${passport.issue_date}\n`;
          }
          if (passport.expiry_date) {
              hechosBody += `- **Vigencia / Expiry:** ${passport.expiry_date}\n`;
          }
          hechosBody += "\n";
      }
  }

  // 4. Evidencia Operativa (Bank/PoA)
  hechosBody += "### 4. Evidencia Operativa\n";
  
  // Bank Identity (Demo Mode Priority)
  if (profile.bankIdentity) {
      hechosBody += `- **Identidad Bancaria:** 1 documento\n`;
      const b = profile.bankIdentity;
      
      // FIX: Check strict length for CLABE (must be 18)
      const clabeRaw = b.clabe || "";
      let clabeDisplay = "N/A";
      
      if (clabeRaw.length !== 18) {
          clabeDisplay = `Incomplete/Error (${clabeRaw})`;
      } else {
          // Show full CLABE if unmasked
          clabeDisplay = options.redacted ? maskString(clabeRaw, 4) : clabeRaw;
      }

      hechosBody += `  - **Banco:** ${b.bank_name}\n`;
      hechosBody += `  - **Titular:** ${b.account_holder_name}\n`;
      hechosBody += `  - **CLABE:** ${clabeDisplay}\n`;
      if (b.address_on_file) {
          hechosBody += `  - **Dirección Reg.:** ${formatAddress(b.address_on_file, options.redacted)}\n`;
      }
  } else if (profile.bankAccounts.length > 0) {
      hechosBody += `- **Cuentas Bancarias:** ${profile.bankAccounts.length} detectadas\n`;
      profile.bankAccounts.forEach(acc => {
          const clabeRaw = acc.clabe || "";
          let clabe = "N/A";
          if (clabeRaw.length === 18) {
              clabe = options.redacted ? maskString(clabeRaw, 4) : clabeRaw;
          } else {
              clabe = `Incomplete (${clabeRaw})`;
          }
          hechosBody += `  - ${acc.bank_name} (${acc.currency || 'MXN'}) - CLABE: ${clabe}\n`;
      });
  } else {
      hechosBody += `- **Cuentas Bancarias:** No detectadas\n`;
  }

  // PoA
  if (profile.addressEvidence.length > 0) {
      hechosBody += `- **Comprobantes de Domicilio:** ${profile.addressEvidence.length} documento${profile.addressEvidence.length !== 1 ? 's' : ''}\n`;
      profile.addressEvidence.forEach(doc => {
          const dateStr = doc.issue_datetime || doc.due_date || "Fecha desconocida";
          // Simplify date for report
          const dateDisplay = dateStr.split('T')[0]; 
          hechosBody += `  - ${doc.vendor_name} (${dateDisplay})\n`;
          if (doc.client_address) {
              hechosBody += `    - Dirección: ${formatAddress(doc.client_address, options.redacted)}\n`;
          }
      });
  } else {
      hechosBody += `- **Comprobantes de Domicilio:** No detectados\n`;
  }

  sections.push({
      title: "I. HECHOS EXTRAÍDOS",
      body: hechosBody
  });


  // --- SECTION II: CONCLUSIONES DE KYC ---
  let conclusionesBody = "";
  
  // Address Logic
  conclusionesBody += "### 1. Domicilio Operativo Confirmado\n";
  if (profile.currentOperationalAddress) {
      conclusionesBody += `- **Dirección:** ${formatAddress(profile.currentOperationalAddress, options.redacted)}\n`;
      const sources = [];
      
      // Dynamic PoA Source listing
      if (profile.addressEvidence.length > 0) {
          const providers = new Set(profile.addressEvidence.map(d => {
             if (d.document_type?.includes("cfe")) return "CFE";
             if (d.document_type?.includes("telmex")) return "Telmex";
             return d.vendor_name || "Servicios";
          }));
          const providerList = Array.from(providers).join(" y ");
          sources.push(`Servicios (${providerList})`);
      }

      // In demo mode, bank identity is a source if it matches
      if (profile.bankIdentity && profile.bankIdentity.address_matches_operational) {
          sources.push(`Identidad Bancaria (${profile.bankIdentity.bank_name})`);
      } else if (profile.bankAccounts.some(b => b.address_on_statement)) {
          sources.push("Estados de Cuenta");
      }
      
      if (sources.length === 0 && profile.currentFiscalAddress) sources.push("SAT (Fallback)");
      
      conclusionesBody += `- **Validado por:** ${sources.join(", ")}\n`;
  } else {
      conclusionesBody += "- **Alerta:** No se pudo determinar un domicilio operativo claro.\n";
  }
  conclusionesBody += "\n";

  // UBOs / Shareholders (SKIP for Persona Física)
  if (isPF) {
      conclusionesBody += "### 2. Propietarios Beneficiarios\n";
      conclusionesBody += "- **No existen accionistas; el titular es Persona Física.**\n";
      conclusionesBody += "\n";
  } else {
      conclusionesBody += "### 2. Propietarios Beneficiarios (UBOs > 25%)\n";
      // Use trace percentages directly to avoid re-calculation mismatch
      const trace = buildTrace(profile); // Re-building trace here just for data access is okay
      
      if (trace.ubos && trace.ubos.length > 0) {
          const ubos = trace.ubos.filter(u => u.isUbo);
          if (ubos.length > 0) {
              ubos.forEach(ubo => {
                  const pctText = ubo.computedPercentage !== null ? `${ubo.computedPercentage.toFixed(2)}%` : "Porcentaje no declarado";
                  conclusionesBody += `- **${ubo.name}:** ${pctText}\n`;
              });
          } else {
              conclusionesBody += "- *No se detectaron accionistas con >25% de participación directa.*\n";
          }
      } else {
          // Fallback to previous logic if trace fails (should not happen)
          const ubos = resolveUbo(profile);
          if (ubos.length > 0) {
            ubos.forEach(ubo => {
                const pctText = ubo.percentage !== null ? `${ubo.percentage.toFixed(2)}%` : "Porcentaje no declarado";
                conclusionesBody += `- **${ubo.name}:** ${pctText}\n`;
            });
          } else {
            conclusionesBody += "- *No se detectaron accionistas con >25% de participación directa.*\n";
          }
      }
      conclusionesBody += "\n";
  }

  // Signatories - Match with Representative Identity (PF Mode: Individual is signatory)
  conclusionesBody += "### 3. Capacidad Legal (Firmantes)\n";
  
  if (isPF) {
      // Persona Física: The individual is the sole legal signatory
      const identityName = profile.representativeIdentity?.full_name || profile.companyTaxProfile?.razon_social || "N/A";
      conclusionesBody += `**✅ Autoridad Firmante Verificada:**\n`;
      conclusionesBody += `- **${identityName}** - La persona titular es la autoridad firmante y representante legal de sí misma.\n`;
      // Redundant doc info removed here too to keep it clean
      conclusionesBody += "\n";
  } else {
      const signers = resolveSignatories(profile);
      
      // Helper function to fuzzy match names (handles variations like "Ashish Punj" vs "PUNJ ASHISH")
      const namesMatch = (name1: string, name2: string): boolean => {
          if (!name1 || !name2) return false;
          const normalize = (n: string) => n.toUpperCase().trim().replace(/\s+/g, ' ');
          const n1 = normalize(name1);
          const n2 = normalize(name2);
          
          // 1. Exact match
          if (n1 === n2) return true;
          
          // 2. Token set match (Bag of Words)
          const tokens1 = new Set(n1.split(' ').filter(t => t.length > 1));
          const tokens2 = new Set(n2.split(' ').filter(t => t.length > 1));
          
          // Check if all tokens from the shorter name appear in the longer name
          // (e.g., "ASHISH PUNJ" matches "ASHISH PUNJ EXTRA")
          const [smaller, larger] = tokens1.size <= tokens2.size ? [tokens1, tokens2] : [tokens2, tokens1];
          let matchCount = 0;
          for (const token of smaller) {
              if (larger.has(token)) matchCount++;
          }
          
          // Require 100% of the smaller name's significant tokens to match
          return smaller.size > 0 && matchCount === smaller.size;
      };
      
      // Find verified signing authority (matches representative identity)
      const repIdentityName = profile.representativeIdentity?.full_name || null;
      const verifiedSignatory = repIdentityName 
          ? signers.find(s => namesMatch(s.name, repIdentityName))
          : null;
      
      // Deduplicate by name for the summary list
      const seenSigners = new Set<string>();
      
      if (verifiedSignatory) {
          // Highlight the verified signing authority
          const scopeLabel = verifiedSignatory.scope === "full" 
              ? "Poderes Amplios (Administración, Dominio, Títulos)" 
              : verifiedSignatory.scope === "limited"
              ? "Poderes Limitados / Específicos"
              : "Sin Poderes";
          
          conclusionesBody += `**✅ Autoridad Firmante Verificada** (ID verificado: ${profile.representativeIdentity?.document_type || "N/A"}):\n`;
          conclusionesBody += `- **${verifiedSignatory.name}** (${verifiedSignatory.role}) - ${scopeLabel}\n`;
          seenSigners.add(verifiedSignatory.name);
          
          // Show other signatories as informational
          const otherSigners = signers.filter(s => !namesMatch(s.name, repIdentityName!));
          if (otherSigners.length > 0) {
              conclusionesBody += `\n**ℹ️ Otras Autoridades con Poderes** (informacional, ID no verificado):\n`;
              otherSigners.forEach(s => {
                  if (!seenSigners.has(s.name)) {
                      const scopeLabel = s.scope === "full" 
                          ? "Poderes Amplios" 
                          : s.scope === "limited"
                          ? "Poderes Limitados"
                          : "Sin Poderes";
                      conclusionesBody += `- ${s.name} (${s.role}) - ${scopeLabel}\n`;
                      seenSigners.add(s.name);
                  }
              });
          }
      } else {
          // No match found - show all signatories normally
          const fullSigners = signers.filter(s => s.scope === "full");
          
          if (fullSigners.length > 0) {
              conclusionesBody += "**Poderes Amplios (Administración, Dominio, Títulos):**\n";
              fullSigners.forEach(s => {
                  if (!seenSigners.has(s.name)) {
                      conclusionesBody += `- ${s.name} (${s.role})\n`;
                      seenSigners.add(s.name);
                  }
              });
          } else {
              conclusionesBody += "- **Alerta:** No se detectaron apoderados con facultades plenas.\n";
          }
          
          // List Limited powers
          const limitedSigners = signers.filter(s => s.scope === "limited");
          if (limitedSigners.length > 0) {
           const newLimited = limitedSigners.filter(s => !seenSigners.has(s.name));
           if (newLimited.length > 0) {
               conclusionesBody += "\n**Poderes Limitados / Específicos:**\n";
               newLimited.forEach(s => {
                   conclusionesBody += `- ${s.name} (${s.role})\n`;
                   seenSigners.add(s.name);
               });
           }
      }
      
          // Warn if we have representative identity but no match (only for corporate)
          if (repIdentityName) {
              conclusionesBody += `\n⚠️ **Nota:** Se verificó identidad de "${repIdentityName}" pero no se encontró coincidencia exacta en los apoderados del Acta.`;
          }
      }
  }

  conclusionesBody += "\n";

  // Freshness
  conclusionesBody += "### 4. Vigencia Documental\n";
  
  const freshness = checkFreshness(profile, new Date());
  const poaFreshness = freshness.find(f => f.type === "proof_of_address");
  
  if (poaFreshness && poaFreshness.maxAgeDays !== null) {
      const status = poaFreshness.maxAgeDays <= 90 ? "VIGENTE" : "ANTIGUO";
      conclusionesBody += `- **Comprobante de Domicilio:** ${status} (emitido hace ${poaFreshness.maxAgeDays} días)\n`;
  } else {
      conclusionesBody += "- **Comprobante de Domicilio:** No disponible o fecha desconocida.\n";
  }
  
  if (profile.bankIdentity) {
       const bankAge = profile.bankIdentity.age_in_days;
       const status = bankAge <= 90 ? "VIGENTE" : "ANTIGUO";
       conclusionesBody += `- **Identidad Bancaria:** ${status} (emitido hace ${bankAge} días)\n`;
  } else {
      const bankFreshness = freshness.find(f => f.type === "bank_statement");
      if (bankFreshness && bankFreshness.maxAgeDays !== null) {
          const status = bankFreshness.maxAgeDays <= 90 ? "VIGENTE" : "ANTIGUO";
          conclusionesBody += `- **Identidad Bancaria:** ${status} (emitido hace ${bankFreshness.maxAgeDays} días)\n`;
      }
  }

  sections.push({
      title: "II. CONCLUSIONES DE KYC",
      body: conclusionesBody
  });


  // --- SECTION III: FLAGS / RIESGOS ---
  let flagsBody = "";
  if (validation.flags.length === 0) {
      flagsBody = "✅ **Sin riesgos detectados.** El expediente cumple con los criterios estándar de KYC.\n";
  } else {
      validation.flags.forEach(flag => {
          const icon = flag.level === "critical" ? "🔴" : (flag.level === "warning" ? "⚠️" : "ℹ️");
          flagsBody += `${icon} **[${flag.code}]** ${flag.message}\n`;
      });
      flagsBody += `\n**Score de Validación:** ${(validation.score * 100).toFixed(0)}/100\n`;
  }
  
  // Demo Mode: Check founding vs fiscal address mismatch as INFO
  // Only show mismatch note if founding address has actual street-level details
  if (DEMO_CONFIG.enabled && profile.foundingAddress && profile.currentFiscalAddress) {
      const hasStreetLevelAddress = profile.foundingAddress.street && profile.foundingAddress.ext_number;
      if (hasStreetLevelAddress) {
          const foundingZip = profile.foundingAddress.cp;
          const fiscalZip = profile.currentFiscalAddress.cp;
          
          // Only compare if both have zip codes
          if (foundingZip && fiscalZip && foundingZip !== fiscalZip) {
              flagsBody += `\nℹ️ **Nota Informativa:** El domicilio fiscal actual (${fiscalZip}) difiere del fundacional (${foundingZip}), lo cual es normal en empresas con trayectoria.\n`;
          }
      }
      // If founding address is only jurisdiction (no street), do not show mismatch note
  }

  // Debug block for equity issue
  const eqCheck = checkEquityConsistency(profile);
  if (eqCheck) {
      // Only show if debug is needed or always show for demo?
      // User asked to show it.
      // flagsBody += `\n[DEBUG] SumOfPercentages: ${eqCheck.sumOfPercentages}\n`;
  }
  
  sections.push({
      title: "III. FLAGS Y RIESGOS",
      body: flagsBody
  });

  // --- SECTION IV: TRAZA Y JUSTIFICACIÓN (Optional) ---
  if (options.includeTrace) {
      // We already built trace above for consistency, reuse if possible, or rebuild.
      // Since we didn't store the full trace object above (only accessed ubos), rebuild is safer.
      const trace = buildTrace(profile);
      const lines: string[] = [];
      
      // UBO trace (SKIP for Persona Física)
      if (!isPF && trace.ubos && trace.ubos.length > 0) {
          lines.push("### 1. Propietarios Beneficiarios – Cálculo de Porcentajes");
          lines.push("");
          lines.push("| Accionista | Acciones | Total Acciones | % Calculado | Umbral UBO | Es UBO |");
          lines.push("|-----------|----------|----------------|-------------|------------|--------|");
          for (const u of trace.ubos) {
              const pct = u.computedPercentage != null ? `${u.computedPercentage.toFixed(2)}%` : "-";
              const thr = u.thresholdApplied != null ? `${u.thresholdApplied}%` : "-";
              const isUboLabel = u.isUbo ? "Sí" : "No";
              lines.push(`| ${u.name} | ${u.shares ?? "-"} | ${u.totalShares ?? "-"} | ${pct} | ${thr} | ${isUboLabel} |`);
          }
          lines.push("");
      } 
      // Removed redundant "No shareholders" block for PF
      
      // Address evidence trace
      if (trace.addressEvidence && trace.addressEvidence.length > 0) {
          // Rename "Evidencia de Domicilio" to "Evidencia de Comprobante de Domicilio" for clarity if desired,
          // but prompt specifically asked to remove "proof of address from ACTA because that's not the purpose".
          // We will keep the section title but Filter out "founding" role here if it is confusing.
          // Or just rename the roles to be clearer.
          // The user said: "So, we don't have to make it confusing by saying Evidencia de Domicilio and then role founding... We have to figure out what address confirms the addresses of the company where they will be operating from."
          
          lines.push("### 2. Evidencia de Domicilio");
          
          // Filter out 'founding' role from this trace section based on user feedback
          const operationalEvidence = trace.addressEvidence.filter(a => a.role !== 'founding');
          
          for (const a of operationalEvidence) {
              // For PF, merge Fiscal and Operational if they are identical to reduce redundancy
              // (Usually handled by consolidation in validation, but displaying both is sometimes verbose)
              // For now, keeping them distinct but clearly labeled.
              
              // Map internal roles to user-friendly names
              let roleName: string = a.role;
              if (a.role === 'fiscal') roleName = 'Fiscal (SAT)';
              if (a.role === 'operational') roleName = 'Operativo (Físico)';
              
              lines.push(`- **Rol:** ${roleName}`);
              if (a.address) {
                  lines.push(`  - Dirección: ${formatAddress(a.address, options.redacted)}`);
              }
              if (a.sources && a.sources.length > 0) {
                  lines.push("  - Fuentes:");
                  for (const s of a.sources) {
                      lines.push(`    - ${s.type}${s.description ? ` – ${s.description}` : ""}`);
                  }
              }
          }
          lines.push("");
      }
      
      // Powers trace (PF Mode: Individual is signatory)
      if (isPF) {
          // Hide Powers trace for PF as it's trivial and redundant
      } else if (trace.powers && trace.powers.length > 0) {
          lines.push("### 3. Facultades / Poderes – Justificación");
          lines.push("");
          lines.push("| Nombre | Rol | Alcance | Evidencia (Frases/Notas) |");
          lines.push("|--------|-----|---------|---------------------------|");
          
          for (const p of trace.powers) {
              let evidence = "";
              if (p.matchedPhrases?.length) evidence += `✅ **Frases:** ${p.matchedPhrases.join(", ")}<br>`;
              if (p.missingPowers?.length && p.scope !== 'full') evidence += `❌ **Faltantes:** ${p.missingPowers.join(", ")}<br>`;
              if (p.limitations?.length) evidence += `⚠️ **Limitaciones:** ${p.limitations.join(", ")}`;
              
              // Clean up breaks
              if (evidence.endsWith("<br>")) evidence = evidence.slice(0, -4);
              if (!evidence) evidence = "-";

              const scopeLabel = p.scope === 'full' ? '**FULL**' : (p.scope === 'limited' ? 'Limited' : 'None');
              
              lines.push(`| ${p.personName} | ${p.role} | ${scopeLabel} | ${evidence} |`);
          }
          lines.push("");
      }
      
      // Freshness trace
      if (trace.freshness && trace.freshness.length > 0) {
          lines.push("### 4. Vigencia de Documentos – Detalle");
          lines.push("");
          lines.push("| Tipo Documento | Fecha Doc. | Antigüedad | Estatus | Documentos Fuente |");
          lines.push("|----------------|------------|------------|---------|-------------------|");
          
          for (const f of trace.freshness) {
              const statusIcon = f.withinThreshold ? "✅" : "⚠️";
              const statusText = f.withinThreshold ? "Vigente" : "Antiguo";
              
              let sources = "";
              if (f.supportingDocuments?.length) {
                  sources = f.supportingDocuments.map(s => `${s.type} (${s.date || 'N/A'})`).join(", ");
              } else {
                  sources = "-";
              }

              lines.push(`| **${f.docType}** | ${f.latestDate ?? "-"} | ${f.ageInDays ?? "-"} días | ${statusIcon} ${statusText} | ${sources} |`);
          }
          lines.push("");
          
          // Demo: Show Bank Identity matching logic with LEGAL HIERARCHY
          // SAT Constancia is the SOURCE OF TRUTH per Mexican law (CNBV, LFPIORPI)
          // Bank records are DERIVED and must match SAT, not the other way around
          if (profile.bankIdentity) {
               const satRazonSocial = profile.companyTaxProfile?.razon_social || profile.companyIdentity?.razon_social || 'N/A';
               const bankTitular = profile.bankIdentity.account_holder_name || 'N/A';
               
               lines.push(`\n**Validación de Identidad Bancaria:**`);
               lines.push("");
               lines.push("> ℹ️ **Jerarquía Legal:** La Constancia de Situación Fiscal (SAT) es la fuente autoritativa para la Razón Social. El banco debe coincidir con SAT, no al revés.");
               lines.push("");
               lines.push("| Criterio | Resultado | Detalle |");
               lines.push("|----------|-----------|---------|");
               lines.push(`| Razón Social (SAT) coincide con Titular Bancario | ${profile.bankIdentity.holder_matches_company ? "✅ Sí" : "⚠️ Difiere"} | SAT: "${satRazonSocial}" → Banco: "${bankTitular}" |`);
               lines.push(`| Dirección Operativa coincide con Estado de Cuenta | ${profile.bankIdentity.address_matches_operational ? "✅ Sí" : "⚠️ No"} | ${formatAddress(profile.bankIdentity.address_on_file, options.redacted)} |`);
               lines.push(`| Documento Reciente (<90 días) | ${profile.bankIdentity.within_90_days ? "✅ Sí" : "⚠️ No"} | ${profile.bankIdentity.age_in_days} días |`);
               lines.push("");
               
               // Add warning if bank differs from SAT
               if (!profile.bankIdentity.holder_matches_company) {
                   lines.push(`> ⚠️ **Nota Legal:** El nombre del titular bancario ("${bankTitular}") difiere de la Razón Social en SAT ("${satRazonSocial}"). Para efectos legales, prevalece la Razón Social del SAT. El banco puede tener un error de captura o usar un nombre comercial.`);
                   lines.push("");
               }
          }
          
          lines.push("");
      }
      
      sections.push({
          title: "IV. TRAZA Y JUSTIFICACIÓN",
          body: lines.join("\n")
      });
  }

  return {
      customerId: profile.customerId,
      generatedAt: new Date().toISOString(),
      sections
  };
}
