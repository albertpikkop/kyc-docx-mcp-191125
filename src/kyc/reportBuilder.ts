import { KycProfile, KycValidationResult, KycValidationFlag } from "./types.js";
import { resolveUbo, resolveSignatories, checkFreshness } from "./validation.js";

export interface KycReportSection {
  title: string;
  body: string;
}

export interface KycReport {
  customerId: string;
  generatedAt: string;
  sections: KycReportSection[];
}

/**
 * Formats an address object into a single line string
 */
function formatAddress(addr: any): string {
  if (!addr) return "N/A";
  const parts = [
    addr.street, 
    addr.ext_number ? `No. ${addr.ext_number}` : '',
    addr.int_number ? `Int. ${addr.int_number}` : '',
    addr.colonia,
    addr.municipio,
    addr.estado,
    addr.cp,
    addr.country
  ].filter(p => p && p !== "null");
  return parts.join(", ");
}

/**
 * Builds a structured KYC report (Hechos + Conclusiones)
 */
export function buildKycReport(
  profile: KycProfile,
  validation: KycValidationResult
): KycReport {
  
  const sections: KycReportSection[] = [];

  // --- SECTION I: HECHOS EXTRAÍDOS ---
  let hechosBody = "";

  // 1. Identidad Corporativa (Acta)
  hechosBody += "### 1. Identidad Corporativa (Fuente: Acta Constitutiva)\n";
  if (profile.companyIdentity) {
      const id = profile.companyIdentity;
      hechosBody += `- **Razón Social:** ${id.razon_social}\n`;
      hechosBody += `- **Fecha Constitución:** ${id.incorporation_date}\n`;
      hechosBody += `- **Domicilio Fundacional (Histórico):** ${formatAddress(id.founding_address)}\n`;
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
      hechosBody += `- **Domicilio Fiscal (Actual):** ${formatAddress(tax.fiscal_address)}\n`;
  } else {
      hechosBody += "- *No se encontró Constancia Fiscal.*\n";
  }
  hechosBody += "\n";

  // 3. Identidad del Representante (FM2/INE)
  hechosBody += "### 3. Identidad del Representante\n";
  if (profile.representativeIdentity) {
      const rep = profile.representativeIdentity;
      hechosBody += `- **Nombre:** ${rep.full_name}\n`;
      hechosBody += `- **Documento:** ${rep.document_type} (${rep.document_number})\n`;
      hechosBody += `- **Nacionalidad:** ${rep.nationality}\n`;
      hechosBody += `- **CURP:** ${rep.curp || "N/A"}\n`;
  } else {
      hechosBody += "- *No se encontró documento de identidad del representante.*\n";
  }
  hechosBody += "\n";

  // 4. Evidencia Operativa (Bank/PoA)
  hechosBody += "### 4. Evidencia Operativa\n";
  hechosBody += `- **Cuentas Bancarias:** ${profile.bankAccounts.length} detectadas\n`;
  profile.bankAccounts.forEach(acc => {
      hechosBody += `  - ${acc.bank_name} (${acc.currency || 'MXN'}) - CLABE: ${acc.clabe || 'N/A'}\n`;
  });
  hechosBody += `- **Comprobantes de Domicilio:** ${profile.addressEvidence.length} documentos\n`;
  profile.addressEvidence.forEach(doc => {
      hechosBody += `  - ${doc.provider_name} (${doc.date || doc.issue_datetime})\n`;
  });

  sections.push({
      title: "I. HECHOS EXTRAÍDOS",
      body: hechosBody
  });


  // --- SECTION II: CONCLUSIONES DE KYC ---
  let conclusionesBody = "";
  
  // Address Logic
  conclusionesBody += "### 1. Domicilio Operativo Confirmado\n";
  if (profile.currentOperationalAddress) {
      conclusionesBody += `- **Dirección:** ${formatAddress(profile.currentOperationalAddress)}\n`;
      const sources = [];
      if (profile.addressEvidence.length > 0) sources.push("Servicios (CFE/Telmex)");
      if (profile.bankAccounts.some(b => b.address_on_statement)) sources.push("Estados de Cuenta");
      conclusionesBody += `- **Validado por:** ${sources.join(", ") || "SAT (Fallback)"}\n`;
  } else {
      conclusionesBody += "- **Alerta:** No se pudo determinar un domicilio operativo claro.\n";
  }
  conclusionesBody += "\n";

  // UBOs
  conclusionesBody += "### 2. Propietarios Beneficiarios (UBOs > 25%)\n";
  const ubos = resolveUbo(profile);
  if (ubos.length > 0) {
      ubos.forEach(ubo => {
          conclusionesBody += `- **${ubo.name}:** ${ubo.percentage}%\n`;
      });
  } else {
      conclusionesBody += "- *No se detectaron accionistas con >25% de participación directa.*\n";
  }
  conclusionesBody += "\n";

  // Signatories
  conclusionesBody += "### 3. Capacidad Legal (Firmantes)\n";
  const signers = resolveSignatories(profile);
  const fullSigners = signers.filter(s => s.scope === "full");
  if (fullSigners.length > 0) {
      conclusionesBody += "**Poderes Amplios (Administración, Dominio, Títulos):**\n";
      fullSigners.forEach(s => {
          conclusionesBody += `- ${s.name} (${s.role})\n`;
      });
  } else {
      conclusionesBody += "- **Alerta:** No se detectaron apoderados con facultades plenas.\n";
  }
  conclusionesBody += "\n";

  // Freshness
  conclusionesBody += "### 4. Vigencia Documental\n";
  const freshness = checkFreshness(profile, new Date());
  const poaAge = freshness.find(f => f.type === "proof_of_address")?.maxAgeDays;
  if (poaAge !== null && poaAge !== undefined) {
      const status = poaAge <= 90 ? "VIGENTE" : "ANTIGUO";
      conclusionesBody += `- **Comprobante de Domicilio:** ${status} (${poaAge} días de antigüedad)\n`;
  } else {
      conclusionesBody += "- **Comprobante de Domicilio:** No disponible.\n";
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

  sections.push({
      title: "III. FLAGS Y RIESGOS",
      body: flagsBody
  });

  return {
      customerId: profile.customerId,
      generatedAt: new Date().toISOString(),
      sections
  };
}

