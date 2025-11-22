import * as path from 'path';
import { CompanyTaxProfileSchema } from '../schemas/mx/companyTaxProfile.js';
import { normalizeEmptyToNull, sanitizeRfc } from '../kyc/validators.js';
import { logExtractorError } from '../utils/logging.js';
import { extractWithGemini } from '../utils/geminiExtractor.js';

const EXTRACTION_INSTRUCTIONS = `
You are a strict KYC extractor for Mexican SAT Constancias (both Persona Moral and Persona Física).
Your job is to fill the CompanyTaxProfile JSON schema accurately using ONLY the information printed on the document.

GLOBAL HARDENING RULES:
- Never infer or generate data.
- If a field is not present, set to null. Do NOT use "N/A" or empty strings. Do NOT use the string "null".
- Normalize all dates to YYYY-MM-DD.

EXTRACT:
- RFC: Extract EXACTLY as printed (e.g., PFD210830KQ7 for Persona Moral, CEDE981004E67 for Persona Física). Never transform or rebuild it.
- Razón Social: For Persona Física, this is the person's full name. Extract EXACTLY as printed (e.g., "ENRIQUE DE CELLO DIAZ"). For Persona Moral, extract the company name (e.g., "PFDS").
- Capital Regime: For Persona Física, this is typically null. For Persona Moral, extract from printed tables.
- Tax Regime: Extract EXACTLY as printed (e.g., "PERSONA FÍSICA", "Sin obligaciones fiscales", "Régimen Simplificado de Confianza", etc.).
- Start of Operations: Date as YYYY-MM-DD. May be null for Persona Física.
- Status: e.g., "ACTIVO".
- Issue Date/Place: From "Lugar y Fecha de Emisión".
- Fiscal Address: This is the CANONICAL fiscal address. Split strictly into: street, ext_number, int_number, colonia, municipio, estado, cp. Set country="MX".
- Economic Activities: Extract from the "Actividades Económicas" table. May be empty for Persona Física with "Sin obligaciones fiscales".
- Tax Obligations: Extract from the "Obligaciones" table. May be empty for Persona Física with "Sin obligaciones fiscales".

CRITICAL: For Persona Física documents:
- The "Razón Social" field contains the person's full name, not a company name.
- "Sin obligaciones fiscales" is a valid tax regime and should NOT be treated as missing data.
- Extract the person's name exactly as shown in the "Razón Social" or "Nombre" field.

Only copy what is explicitly printed. No hallucinations.
`;

export async function extractCompanyTaxProfile(fileUrl: string): Promise<any> {
  console.log(`Extracting company tax profile using Gemini 2.5`);
  console.log(`Processing file: ${fileUrl}`);

  try {
    // Determine MIME type
    const ext = path.extname(fileUrl).toLowerCase();
    const mimeType = ext === '.pdf' ? 'application/pdf' : 
                     ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
                     ext === '.png' ? 'image/png' :
                     ext === '.webp' ? 'image/webp' : 'application/pdf';

    // Use Gemini for extraction
    const data = await extractWithGemini(fileUrl, mimeType, CompanyTaxProfileSchema, EXTRACTION_INSTRUCTIONS);
    
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

    return normalizedProfile;

  } catch (error) {
    logExtractorError("sat_constancia", fileUrl, error);
    if (error instanceof Error) {
      throw new Error(`Company tax profile extraction failed: ${error.message}`);
    }
    throw error;
  }
}
