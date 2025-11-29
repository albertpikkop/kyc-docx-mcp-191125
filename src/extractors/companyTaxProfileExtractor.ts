import { CompanyTaxProfileSchema } from '../schemas/mx/companyTaxProfile.js';
import { normalizeEmptyToNull, sanitizeRfc } from '../kyc/validators.js';
import { logExtractorError } from '../utils/logging.js';
import { routeExtraction, ExtractionResult } from '../utils/modelRouter.js';

const EXTRACTION_INSTRUCTIONS = `
You are extracting data from a Mexican SAT "Constancia de Situación Fiscal" document.

╔═══════════════════════════════════════════════════════════════════════════════╗
║  🚨 CRITICAL: TAX REGIME EXTRACTION - READ THIS FIRST 🚨                      ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║  The tax_regime field is THE MOST IMPORTANT field to extract correctly.      ║
║                                                                               ║
║  WHERE TO FIND IT:                                                            ║
║  Look for a TABLE with columns: "Régimen" | "Fecha Inicio" | "Fecha Fin"      ║
║  This table is usually in the MIDDLE of the document, after the address.     ║
║                                                                               ║
║  COMMON VALUES YOU WILL SEE:                                                  ║
║  ┌─────────────────────────────────────────────────────────────────────────┐  ║
║  │ "Sin obligaciones fiscales"                    ← No business activity   │  ║
║  │ "Sueldos y Salarios e Ingresos Asimilados"    ← Employee               │  ║
║  │ "Régimen Simplificado de Confianza"           ← RESICO                 │  ║
║  │ "Actividades Empresariales y Profesionales"   ← Business owner         │  ║
║  │ "Arrendamiento"                               ← Rental income          │  ║
║  │ "General de Ley Personas Morales"             ← Corporation            │  ║
║  └─────────────────────────────────────────────────────────────────────────┘  ║
║                                                                               ║
║  🚫 DO NOT HALLUCINATE: If the table shows "Sin obligaciones fiscales",       ║
║     then tax_regime = "Sin obligaciones fiscales". Period.                    ║
║                                                                               ║
║  🚫 DO NOT CONFUSE: The document may have section HEADERS like               ║
║     "Datos del contribuyente persona física con actividad empresarial"       ║
║     This is a HEADER, not the tax_regime. IGNORE headers.                    ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝

═══════════════════════════════════════════════════════════════════════════════
DOCUMENT STRUCTURE (Visual Guide):
═══════════════════════════════════════════════════════════════════════════════

A typical Constancia has these sections IN ORDER:

┌─────────────────────────────────────────┐
│ HEADER: SAT logo, "Constancia de        │
│ Situación Fiscal"                       │
├─────────────────────────────────────────┤
│ RFC: XXXX######XXX                      │  ← Extract this
│ CURP: (if persona física)               │
│ Nombre/Razón Social: [NAME]             │  ← Extract this
├─────────────────────────────────────────┤
│ DOMICILIO FISCAL                        │
│ Calle, Número, Colonia, CP, etc.        │  ← Extract all parts
├─────────────────────────────────────────┤
│ ★ REGÍMENES (TABLE) ★                   │
│ ┌────────────────────┬─────────┬──────┐ │
│ │ Régimen            │ F.Inicio│ F.Fin│ │
│ ├────────────────────┼─────────┼──────┤ │
│ │ Sin obligaciones   │ 2017-09 │      │ │  ← THIS IS tax_regime!
│ │ fiscales           │         │      │ │
│ └────────────────────┴─────────┴──────┘ │
├─────────────────────────────────────────┤
│ OBLIGACIONES (TABLE)                    │
│ Same content as Regímenes for           │
│ "Sin obligaciones fiscales" cases       │  ← Verify matches
├─────────────────────────────────────────┤
│ ACTIVIDADES ECONÓMICAS (TABLE)          │
│ [Empty if Sin obligaciones]             │  ← Should be empty
└─────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════════════
EXTRACTION RULES:
═══════════════════════════════════════════════════════════════════════════════

1. RFC: 12-13 alphanumeric characters at the top

2. razon_social: The name after "Nombre" or "Razón Social"

3. tax_regime: 
   ⚠️ LOOK AT THE "REGÍMENES" TABLE ROWS, NOT THE HEADERS
   ⚠️ Copy the EXACT text from the first column of the table
   ⚠️ If it says "Sin obligaciones fiscales" → tax_regime = "Sin obligaciones fiscales"

4. status: "ACTIVO" or "CANCELADO" from "Situación del contribuyente"

5. fiscal_address: Extract all parts (street, ext_number, int_number, colonia, municipio, estado, cp)

6. economic_activities: 
   - If table is empty → return []
   - If shows activities → extract each row

7. tax_obligations:
   - Extract from "Obligaciones" table
   - This should MATCH the tax_regime for "Sin obligaciones" cases

═══════════════════════════════════════════════════════════════════════════════
VALIDATION - MUST BE CONSISTENT:
═══════════════════════════════════════════════════════════════════════════════

IF tax_obligations contains "Sin obligaciones fiscales":
  THEN tax_regime MUST = "Sin obligaciones fiscales"
  AND economic_activities MUST = []

This is a HARD RULE. If your extraction violates this, you have made an error.

═══════════════════════════════════════════════════════════════════════════════
OUTPUT FORMAT:
═══════════════════════════════════════════════════════════════════════════════

Return valid JSON only. No markdown. No explanation.
If a field is not found, use null (not "", not "N/A", not "/").
Dates must be YYYY-MM-DD format.
`;

export async function extractCompanyTaxProfile(fileUrl: string): Promise<any> {
  console.log(`Extracting company tax profile using Router (Gemini default)`);
  console.log(`Processing file: ${fileUrl}`);

  try {
    // Route extraction through ModelRouter
    const result: ExtractionResult = await routeExtraction('sat_constancia', fileUrl, CompanyTaxProfileSchema, EXTRACTION_INSTRUCTIONS);
    const data = result.data;
    
    // Extract object if nested (Gemini returns flat structure)
    const profile = data.company_tax_profile || data;

    // Strict Post-processing: Normalize empty strings to null using deep validator
    const normalizedProfile = normalizeEmptyToNull(profile);

    // Sanitize RFC
    if (normalizedProfile.rfc) {
      normalizedProfile.rfc = sanitizeRfc(normalizedProfile.rfc);
    }

    // Ensure country is set to "MX" for fiscal_address
    if (normalizedProfile.fiscal_address) {
      normalizedProfile.fiscal_address.country = "MX";
    }

    // CRITICAL: Cross-validate tax_regime against tax_obligations
    // If obligations show "Sin obligaciones fiscales", the regime MUST match
    const hasNoObligations = normalizedProfile.tax_obligations?.some(
      (o: any) => o.description?.toLowerCase().includes('sin obligaciones')
    );
    if (hasNoObligations && normalizedProfile.tax_regime) {
      // Override any hallucinated regime - the obligations are authoritative
      normalizedProfile.tax_regime = 'Sin obligaciones fiscales';
      console.log('⚠️ Cross-validation: tax_regime corrected to match tax_obligations');
    }

    // Attach metadata
    (normalizedProfile as any)._metadata = {
        modelUsed: result.modelUsed,
        costUsd: result.costUsd
    };

    return normalizedProfile;

  } catch (error) {
    logExtractorError("sat_constancia", fileUrl, error);
    if (error instanceof Error) {
      throw new Error(`Company tax profile extraction failed: ${error.message}`);
    }
    throw error;
  }
}
