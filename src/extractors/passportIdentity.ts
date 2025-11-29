import { PassportIdentitySchema } from '../schemas/mx/passportIdentity.js';
import { normalizeEmptyToNull } from '../kyc/validators.js';
import { logExtractorError } from '../utils/logging.js';
import { routeExtraction, ExtractionResult } from '../utils/modelRouter.js';

const EXTRACTION_INSTRUCTIONS = `
You are a strict KYC extractor for International Passports (Mexican and Foreign).
Your job is to fill the PassportIdentitySchema accurately using ONLY the information printed on the passport.

CRITICAL ANTI-HALLUCINATION RULES:
- NEVER invent, infer, or generate data that is not explicitly printed on the passport.
- NEVER guess or approximate values - if you cannot read it clearly, set to null.
- NEVER use information from other documents or your training data.
- NEVER correct spelling errors - extract EXACTLY as printed, even if it looks wrong.
- NEVER transpose numbers or letters - read them character-by-character.
- If text is partially obscured, extract only what is clearly visible and set the rest to null.

GLOBAL HARDENING RULES:
- Never infer or generate data not clearly printed.
- If a field is not clearly visible, set to null.
- Normalize all dates to YYYY-MM-DD format.
- Read character-by-character - do not guess or approximate.

FIELD-BY-FIELD EXTRACTION GUIDANCE:

1. FULL NAME (full_name):
   - Extract EXACTLY as printed on the passport, combining surname and given names.
   - Format: SURNAME / GIVEN NAMES (as shown on passport).
   - Do NOT rearrange words or "fix" spelling.
   - Extract exactly as printed including any accents or special characters.

2. NATIONALITY (nationality):
   - Extract the nationality EXACTLY as printed (e.g., "MEXICANA", "INDIAN", "AMERICAN").
   - This is the nationality/citizenship, not the country of issue.

3. DOCUMENT TYPE (document_type):
   - Always "PASSPORT" or "PASAPORTE" depending on the language on the document.

4. DOCUMENT NUMBER (document_number):
   - Extract the passport number EXACTLY as printed.
   - This is usually in the top right area or near the MRZ.
   - Read character-by-character - do NOT transpose.
   - Include all alphanumeric characters.

5. DATE OF BIRTH (date_of_birth):
   - Extract EXACTLY as printed and format as YYYY-MM-DD.
   - Look for "Date of Birth", "Fecha de Nacimiento", or similar label.
   - If format is DD/MM/YYYY or DD-MMM-YYYY, convert to YYYY-MM-DD.

6. SEX (sex):
   - Extract as "M" (Male/Masculino) or "F" (Female/Femenino).
   - Look for "Sex", "Sexo", or "Gender" field.

7. PLACE OF BIRTH (place_of_birth):
   - Extract the full place of birth as printed (city, state, country).
   - Do NOT correct or normalize - extract exactly as shown.

8. ISSUE DATE (issue_date):
   - Extract the date of issue/expedition as YYYY-MM-DD.
   - Look for "Date of Issue", "Fecha de Expedición", etc.

9. EXPIRY DATE (expiry_date):
   - Extract the expiration date as YYYY-MM-DD.
   - Look for "Date of Expiry", "Fecha de Vencimiento", "Vigencia", etc.

10. ISSUING AUTHORITY (issuing_authority):
    - Extract the authority that issued the passport (e.g., "SRE", "PASSPORT OFFICE").

11. ISSUER COUNTRY (issuer_country):
    - Extract the 2-letter ISO country code of the issuing country.
    - For Mexican passports: "MX"
    - For Indian passports: "IN"
    - For US passports: "US"
    - Look at the passport cover or header to determine the issuing country.

12. MRZ LINES (mrz_line_1, mrz_line_2):
    - If visible, extract the Machine Readable Zone (bottom of passport).
    - Line 1: Type and name (starts with P<)
    - Line 2: Numbers and checksums
    - Extract EXACTLY as printed, character-by-character.

13. CURP (curp):
    - ONLY for Mexican passports - extract the 18-character CURP if present.
    - For foreign passports, set to null.

VALIDATION CHECKLIST BEFORE SUBMITTING:
- Did I extract full_name EXACTLY as printed?
- Did I extract the passport document_number character-by-character?
- Did I correctly identify the issuer_country from the passport?
- Did I normalize all dates to YYYY-MM-DD?
- Did I avoid inventing or guessing any data?
- Did I set unreadable or missing fields to null?
`;

/**
 * Extracts passport identity from a passport image/PDF
 */
export async function extractPassportIdentity(fileUrl: string): Promise<any> {
  console.log(`Extracting Passport Identity using Router (Gemini default)`);
  console.log(`Processing file: ${fileUrl}`);

  try {
    // Route extraction through ModelRouter (docType, fileUrl, schema, instructions)
    const result: ExtractionResult = await routeExtraction(
      'passport',  // docType
      fileUrl,     // fileUrl
      PassportIdentitySchema,  // schema
      EXTRACTION_INSTRUCTIONS  // instructions
    );

    const data = result.data;
    if (!data) {
      console.log('Passport extraction returned null data');
      return null;
    }

    // Extract object if nested
    const passport = data.passport_identity || data;

    // Deep normalization of empty strings to null
    const normalizedPassport = normalizeEmptyToNull(passport);

    // Ensure issuer_country is uppercase 2-letter code
    if (normalizedPassport.issuer_country) {
      const country = normalizedPassport.issuer_country.toUpperCase();
      // Normalize common country codes
      if (country === 'MEXICO' || country === 'MEX' || country === 'MEXICANA') {
        normalizedPassport.issuer_country = 'MX';
      } else if (country === 'INDIA' || country === 'IND' || country === 'INDIAN') {
        normalizedPassport.issuer_country = 'IN';
      } else if (country === 'USA' || country === 'UNITED STATES' || country === 'AMERICAN') {
        normalizedPassport.issuer_country = 'US';
      } else if (country.length === 2) {
        normalizedPassport.issuer_country = country;
      }
    }

    // Ensure document_type is standardized
    if (normalizedPassport.document_type) {
      const docType = normalizedPassport.document_type.toUpperCase();
      normalizedPassport.document_type = docType.includes('PASAPORTE') ? 'PASAPORTE' : 'PASSPORT';
    } else {
      normalizedPassport.document_type = 'PASSPORT';
    }

    // Add extraction metadata (model used and cost)
    normalizedPassport._metadata = {
      modelUsed: result.modelUsed,
      costUsd: result.costUsd
    };

    console.log('Passport extraction complete:', JSON.stringify(normalizedPassport, null, 2));
    return normalizedPassport;
  } catch (error) {
    logExtractorError('passport-identity', fileUrl, error);
    throw error;
  }
}

