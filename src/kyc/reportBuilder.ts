import { KycProfile, KycValidationResult } from "./types.js";
import { resolveUbo, resolveSignatories, checkFreshness, buildTrace, checkEquityConsistency } from "./validation.js";
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

  // --- SECTION I: HECHOS EXTRAÍDOS ---
  let hechosBody = "";

  // 1. Identidad Corporativa (Acta)
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
  } else {
      hechosBody += "- *No se encontró Acta Constitutiva.*\n";
  }
  hechosBody += "\n";

  // 2. Perfil Fiscal (SAT)
  hechosBody += "### 2. Perfil Fiscal (Fuente: SAT Constancia)\n";
  if (profile.companyTaxProfile) {
      const tax = profile.companyTaxProfile;
      hechosBody += `- **RFC:** ${tax.rfc}\n`;
      hechosBody += `- **Régimen Fiscal:** ${tax.tax_regime}\n`;
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
  hechosBody += "### 3. Identidad del Representante\n";
  if (profile.representativeIdentity) {
      const rep = profile.representativeIdentity;
      hechosBody += `- **Nombre:** ${rep.full_name}\n`;
      
      // FIX: Check strict length for document_number
      const docNumRaw = rep.document_number || "";
      if (docNumRaw.length < 8) { 
          hechosBody += `- **Documento:** Incomplete/Error (${docNumRaw})\n`;
      } else {
          const docNum = options.redacted ? maskString(docNumRaw) : docNumRaw;
          hechosBody += `- **Documento:** ${rep.document_type} (${docNum})\n`;
      }

      hechosBody += `- **Nacionalidad:** ${rep.nationality}\n`;
      
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

  // UBOs - Consistency Check
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

  // Signatories - Match with Representative Identity
  conclusionesBody += "### 3. Capacidad Legal (Firmantes)\n";
  const signers = resolveSignatories(profile);
  
  // Helper function to fuzzy match names (handles variations like "Ashish Punj" vs "ASHISH PUNJ")
  const namesMatch = (name1: string, name2: string): boolean => {
      const normalize = (n: string) => n.toUpperCase().trim().replace(/\s+/g, ' ');
      return normalize(name1) === normalize(name2);
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
      
      // Warn if we have representative identity but no match
      if (repIdentityName) {
          conclusionesBody += `\n⚠️ **Nota:** Se verificó identidad de "${repIdentityName}" pero no se encontró coincidencia exacta en los apoderados del Acta.`;
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
      
      // UBO trace
      if (trace.ubos && trace.ubos.length > 0) {
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
      
      // Powers trace
      if (trace.powers && trace.powers.length > 0) {
          lines.push("### 3. Facultades / Poderes – Justificación");
          for (const p of trace.powers) {
              lines.push(`- **${p.personName}** (${p.role}) – Alcance: ${p.scope}`);
              if (p.matchedPhrases?.length) {
                  lines.push(`  - Frases clave detectadas: ${p.matchedPhrases.join(", ")}`);
              }
              if (p.sourceReference) {
                  lines.push(`  - Fuente: ${p.sourceReference}`);
              }
          }
          lines.push("");
      }
      
      // Freshness trace
      if (trace.freshness && trace.freshness.length > 0) {
          lines.push("### 4. Vigencia de Documentos – Detalle");
          for (const f of trace.freshness) {
              lines.push(`- **Tipo:** ${f.docType}`);
              lines.push(`  - Última fecha: ${f.latestDate ?? "-"}`);
              lines.push(`  - Antigüedad (días): ${f.ageInDays ?? "-"}`);
              lines.push(`  - Dentro del umbral: ${f.withinThreshold ? "Sí" : "No"}`);
              if (f.supportingDocuments?.length) {
                  lines.push("  - Documentos utilizados:");
                  for (const s of f.supportingDocuments) {
                      lines.push(`    - ${s.type}${s.date ? ` (${s.date})` : ""}${s.description ? ` – ${s.description}` : ""}`);
                  }
              }
          }
          
          // Demo: Show Bank Identity matching logic
          if (profile.bankIdentity) {
               lines.push(`\n**Validación de Identidad Bancaria:**`);
               lines.push(`- Titular coincide con Razón Social: ${profile.bankIdentity.holder_matches_company ? "Sí" : "No"}`);
               lines.push(`- Dirección coincide con Operativa: ${profile.bankIdentity.address_matches_operational ? "Sí" : "No"}`);
               lines.push(`- Documento reciente: ${profile.bankIdentity.within_90_days ? "Sí" : "No"} (${profile.bankIdentity.age_in_days} días)`);
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
