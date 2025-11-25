import { CompanyTaxProfileSchema } from '../schemas/mx/companyTaxProfile.js';
import { normalizeEmptyToNull, sanitizeRfc } from '../kyc/validators.js';
import { logExtractorError } from '../utils/logging.js';
import { routeExtraction, ExtractionResult } from '../utils/modelRouter.js';

const EXTRACTION_INSTRUCTIONS = `
You are a STRICT KYC data extractor for Mexican SAT Constancia de Situación Fiscal documents.
Your job is to extract data EXACTLY as printed - ZERO HALLUCINATIONS, ZERO INFERENCE.

═══════════════════════════════════════════════════════════════════════════════
ANTI-HALLUCINATION RULES (MANDATORY):
═══════════════════════════════════════════════════════════════════════════════
1. ONLY extract text that is PHYSICALLY PRINTED on the document
2. If a field is not visible, set to null - NEVER guess or infer
3. NEVER use placeholder values like "N/A", "--", "Unknown", or empty strings ""
4. NEVER transform, calculate, or reconstruct data
5. Copy text EXACTLY as shown, including accents, capitalization, and spacing
6. Dates must be converted to YYYY-MM-DD format ONLY

═══════════════════════════════════════════════════════════════════════════════
ENTITY TYPE DETECTION (Critical for Classification):
═══════════════════════════════════════════════════════════════════════════════
Detect the entity type from the document:

TYPE 1 - PERSONA MORAL (Corporate Entity):
  - RFC pattern: 3 letters + 6 digits + 3 homoclave (e.g., "PFD210830KQ7")
  - Has company name in "Razón Social" (e.g., "PFDS SAPI DE CV")
  - May have "Régimen Capital" section
  - Has registered economic activities
  
TYPE 2 - PERSONA FÍSICA CON ACTIVIDAD EMPRESARIAL (Individual with Business):
  - RFC pattern: 4 letters + 6 digits + 3 homoclave (e.g., "GAPA750101ABC")
  - Has person's name in "Razón Social"
  - Has registered economic activities in the table
  - Tax regime shows business activity (e.g., "Actividades Empresariales", "RESICO", "RIF")
  
TYPE 3 - PERSONA FÍSICA SIN OBLIGACIONES FISCALES (Individual without Tax Obligations):
  - RFC pattern: 4 letters + 6 digits + 3 homoclave (e.g., "CEDE981004E67")
  - Has person's name in "Razón Social" (e.g., "ENRIQUE DE CELLO DIAZ")
  - Tax regime shows: "Sin obligaciones fiscales"
  - Economic activities table is EMPTY or shows "Sin obligaciones fiscales"
  - Tax obligations shows ONLY "Sin obligaciones fiscales"

═══════════════════════════════════════════════════════════════════════════════
FIELD EXTRACTION RULES:
═══════════════════════════════════════════════════════════════════════════════

1. RFC (CRITICAL):
   - Extract the 12-13 character code EXACTLY as printed
   - Located prominently near the top of the document
   - Format: ABC123456XYZ (Persona Moral) or ABCD123456XYZ (Persona Física)
   - NEVER reconstruct from name + date

2. RAZÓN SOCIAL / DENOMINACIÓN:
   - For companies: Extract company name (e.g., "PFDS SAPI DE CV")
   - For individuals: Extract full name (e.g., "ENRIQUE DE CELLO DIAZ")
   - Extract EXACTLY as printed, including accents

3. TAX REGIME (tax_regime) - CRITICAL FOR CLASSIFICATION:
   - Extract the EXACT text from "Régimen" or "Régimen Fiscal" field
   - Common values:
     * "Sin obligaciones fiscales" - Individual with no business activity
     * "Régimen Simplificado de Confianza" - RESICO
     * "Actividades Empresariales y Profesionales" - Business activities
     * "Arrendamiento" - Rental income
   - If multiple regimes listed, extract all

4. STATUS:
   - Extract from "Situación del contribuyente" or "Estatus" field
   - Usually "ACTIVO" or "CANCELADO"

5. FISCAL ADDRESS:
   - This is the CANONICAL fiscal address - extract ALL components:
   - street: Street name only (e.g., "INDEPENDENCIA")
   - ext_number: External number (e.g., "2")
   - int_number: Internal number if present (e.g., "LT 10", "DEPTO 5")
   - colonia: Neighborhood name (e.g., "COPALERA")
   - municipio: Municipality/delegation (e.g., "CHIMALHUACAN")
   - estado: State (e.g., "MEXICO", "CIUDAD DE MEXICO")
   - cp: Postal code 5 digits (e.g., "56337")
   - country: Always set to "MX"

6. ECONOMIC ACTIVITIES (economic_activities):
   - Extract from "Actividades Económicas" table
   - For each activity: description, percentage, start_date, end_date
   - If table is EMPTY or only shows "Sin obligaciones fiscales": return empty array []
   - NEVER invent activities

7. TAX OBLIGATIONS (tax_obligations):
   - Extract from "Obligaciones" table
   - For each: description, due_rule, start_date, end_date
   - If shows only "Sin obligaciones fiscales": return array with single entry
   - NEVER invent obligations

8. DATES:
   - start_of_operations: From "Fecha de inicio de operaciones"
   - last_status_change: From "Fecha del último cambio de estado"
   - issue.issue_date: From "Lugar y fecha de emisión" section
   - ALL dates must be YYYY-MM-DD format

═══════════════════════════════════════════════════════════════════════════════
VALIDATION CHECKLIST (Must pass ALL):
═══════════════════════════════════════════════════════════════════════════════
□ RFC matches pattern (12-13 alphanumeric characters)
□ Status is either "ACTIVO" or "CANCELADO"
□ All dates are YYYY-MM-DD format
□ No placeholder values anywhere
□ tax_regime field is populated with exact printed text
□ For "Sin obligaciones fiscales": economic_activities should be empty []

Return ONLY valid JSON matching the schema. Zero hallucinations.
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
