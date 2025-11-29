import { ImmigrationProfileSchema } from '../schemas/mx/immigrationProfile.js';
import { normalizeEmptyToNull, sanitizeCurp } from '../kyc/validators.js';
import { logExtractorError } from '../utils/logging.js';
import { routeExtraction, ExtractionResult } from '../utils/modelRouter.js';

const EXTRACTION_INSTRUCTIONS = `
You are a STRICT KYC extractor for Mexican identity documents (FM2, INE, Residente Cards, Passports).
Your job is to extract data EXACTLY as printed - ZERO HALLUCINATIONS, ZERO INFERENCE.

═══════════════════════════════════════════════════════════════════════════════
ANTI-HALLUCINATION RULES (MANDATORY):
═══════════════════════════════════════════════════════════════════════════════
1. ONLY extract text that is PHYSICALLY PRINTED on the document
2. If a field is not visible, set to null - NEVER guess or infer
3. NEVER use placeholder values like "N/A", "--", "Unknown", or empty strings ""
4. Copy text EXACTLY as shown, including accents and special characters
5. ALL dates must be converted to YYYY-MM-DD format
6. Do NOT use MRZ (machine-readable zone) as primary source - use printed fields

═══════════════════════════════════════════════════════════════════════════════
DOCUMENT TYPE DETECTION:
═══════════════════════════════════════════════════════════════════════════════
Identify the document type:

- INE/IFE: Mexican voter ID card (Credencial para Votar)
  * Front: Photo, name, address, CURP, Clave de Elector
  * Back: Barcode, voter registration info
  
- FM2 / RESIDENTE PERMANENTE / RESIDENTE TEMPORAL:
  * Immigration card for foreigners residing in Mexico
  * Front: Photo, name, nationality, document number
  * Back: May have NUT number, CURP
  
- PASSPORT (Mexican or Foreign):
  * Contains nationality, passport number, issue/expiry dates
  * MRZ at bottom (use as secondary source only)

═══════════════════════════════════════════════════════════════════════════════
FIELD EXTRACTION RULES:
═══════════════════════════════════════════════════════════════════════════════

1. FULL NAME (full_name):
   - Extract the complete name as printed
   - Format: "GIVEN_NAME SURNAME(S)" (e.g., "ASHISH PUNJ", "ENRIQUE DE CELLO DIAZ")
   - Include middle names if present
   - Use PRINTED text, NOT MRZ transliteration

2. DOCUMENT TYPE (document_type):
   - Extract the category printed on the card:
     * "Residente Permanente"
     * "Residente Temporal"
     * "INE" or "Credencial para Votar"
     * "Pasaporte" / "Passport"

3. DOCUMENT NUMBER (document_number):
   - For INE: The "Clave de Elector" (18 characters)
   - For FM2/Residente: The main ID number on the FRONT (NOT the NUT on back)
   - For Passport: The passport number
   - Extract EXACTLY as printed

4. SECONDARY NUMBER (secondary_number):
   - INE: The "OCR" or vertical number
   - FM2: The NUT number (Número Único de Trámite) on back
   - May be null if not present

5. CURP (curp) - CRITICAL FOR MEXICAN NATIONALS:
   - 18-character alphanumeric code
   - Format: XXXX######XXXXXX##
   - Extract EXACTLY as printed - NEVER reconstruct
   - For foreigners: May be printed on FM2 back or null

6. NATIONALITY (nationality):
   - Extract as printed (e.g., "MEXICANA", "INDIA", "ESTADOUNIDENSE")
   - Use the Spanish form if that's what's printed

7. DATE OF BIRTH (date_of_birth):
   - Convert to YYYY-MM-DD format
   - Extract from printed field, NOT from CURP

8. SEX (sex):
   - Extract as printed: "M", "F", "MASCULINO", "FEMENINO", "H", "MUJER", "HOMBRE"

9. ISSUE DATE / EXPIRY DATE:
   - Convert to YYYY-MM-DD format
   - issue_date: When the document was issued
   - expiry_date: When the document expires (null if not shown or "permanente")

10. ISSUING OFFICE (issuing_office):
    - For INE: The state/delegation printed
    - For FM2: The INM office location
    - May be null if not visible

11. ADDRESS (address):
    - For INE: Extract the voter's registered address if visible
    - Split into components: street, ext_number, colonia, municipio, estado, cp
    - For FM2/Passport: Usually not present (return null)

═══════════════════════════════════════════════════════════════════════════════
SPECIAL RULES BY DOCUMENT TYPE:
═══════════════════════════════════════════════════════════════════════════════

FOR INE (Mexican Voter ID):
- ALWAYS extract: full_name, curp, document_number (clave de elector), sex, date_of_birth
- Look for: address on front, registration year, section/locality
- document_type: Set to "INE" or "Credencial para Votar"
- issuer_country: "MX"

FOR FM2 / RESIDENTE CARDS:
- ALWAYS extract: full_name, nationality, document_number, document_type
- Look for: CURP on back (if present), NUT as secondary_number
- expiry_date: May show "PERMANENTE" (set to null)
- issuer_country: "MX"

FOR PASSPORT:
- ALWAYS extract: full_name, nationality, document_number, issue_date, expiry_date
- Passport number is the PRIMARY document_number
- MRZ should NOT override printed fields

═══════════════════════════════════════════════════════════════════════════════
VALIDATION CHECKLIST:
═══════════════════════════════════════════════════════════════════════════════
□ full_name is populated with actual printed name
□ document_type matches actual document shown
□ All dates are YYYY-MM-DD format
□ CURP (if present) is exactly 18 characters
□ No placeholder values anywhere
□ issuer_country is "MX" for Mexican documents

Return ONLY valid JSON matching the schema. Zero hallucinations.
`;

export async function extractImmigrationProfile(fileUrl: string): Promise<any> {
  console.log(`Extracting Immigration Profile using Router (Gemini default)`);
  console.log(`Processing file: ${fileUrl}`);

  try {
    // Route extraction through ModelRouter
    const result: ExtractionResult = await routeExtraction('fm2', fileUrl, ImmigrationProfileSchema, EXTRACTION_INSTRUCTIONS);
    const data = result.data;
    
    // Extract object if nested (Gemini returns flat structure)
    const profile = data.immigration_profile || data;

    // Deep normalization of empty strings to null
    const normalizedProfile = normalizeEmptyToNull(profile);

    // Normalize issuer_country to ISO country code
    if (normalizedProfile.issuer_country) {
      const country = normalizedProfile.issuer_country.toUpperCase();
      if (country === "MEX" || country === "MEXICO") {
        normalizedProfile.issuer_country = "MX";
      }
    } else {
       normalizedProfile.issuer_country = "MX";
    }
    
    // Sanitize CURP
    if (normalizedProfile.curp) {
        normalizedProfile.curp = sanitizeCurp(normalizedProfile.curp);
    }
    
    // CRITICAL: Post-process document_type classification
    // Documents labeled as "FM2" but issued after 2012 without expiry are actually
    // "Tarjeta de Residente Permanente" (Permanent Resident Card)
    const docType = (normalizedProfile.document_type || '').toUpperCase();
    const issueDate = normalizedProfile.issue_date;
    const expiryDate = normalizedProfile.expiry_date;
    
    if (docType === 'FM2' || docType.includes('FM2') || docType.includes('INMIGRANTE')) {
      const issueYear = issueDate ? new Date(issueDate).getFullYear() : 0;
      
      // Post-2012 document without expiry = Residente Permanente
      if (issueYear >= 2012 && !expiryDate) {
        normalizedProfile.document_type = 'RESIDENTE PERMANENTE';
        console.log('📋 Document reclassified: FM2 → RESIDENTE PERMANENTE (post-2012, no expiry = permanent status)');
      }
      // Post-2012 document with expiry = Residente Temporal
      else if (issueYear >= 2012 && expiryDate) {
        normalizedProfile.document_type = 'RESIDENTE TEMPORAL';
        console.log('📋 Document reclassified: FM2 → RESIDENTE TEMPORAL (post-2012, has expiry = temporal status)');
      }
      // Pre-2012 = Legacy FM2 (obsolete)
      else if (issueYear > 0 && issueYear < 2012) {
        console.log(`⚠️ Legacy FM2 detected from ${issueYear} - document is obsolete`);
      }
    }

    // Attach metadata
    (normalizedProfile as any)._metadata = {
        modelUsed: result.modelUsed,
        costUsd: result.costUsd
    };

    return normalizedProfile;

  } catch (error) {
    logExtractorError("fm2", fileUrl, error);
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON response from model: ${error.message}`);
    }
    if (error instanceof Error) {
      throw new Error(`Immigration profile extraction failed: ${error.message}`);
    }
    throw error;
  }
}
