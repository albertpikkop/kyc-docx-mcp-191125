import * as path from 'path';
import { ImmigrationProfileSchema } from '../schemas/mx/immigrationProfile.js';
import { normalizeEmptyToNull, sanitizeCurp } from '../kyc/validators.js';
import { logExtractorError } from '../utils/logging.js';
import { extractWithGemini } from '../utils/geminiExtractor.js';

const EXTRACTION_INSTRUCTIONS = `
You are a strict KYC extractor for Mexican immigration cards (FM2 / Residente Temporal / Residente Permanente).
Your job is to fill the ImmigrationProfile JSON schema accurately and ONLY with information printed on the card.
If something is not clearly printed, return null for that field. Never guess.
Normalize all dates to ISO format YYYY-MM-DD.

For this specific card:
It is a "Residente Permanente" card for Ashish Punj.

Extract:
- full_name: normalize into "Ashish Punj" (given name first, surname last).
- nationality: use the nationality printed on the card (e.g. "India" or its Spanish form).
- document_type: use the printed category (e.g. "Residente Permanente").
- document_number: the main ID number printed on the card, not the MRZ.
  IMPORTANT: The PRIMARY document number is on the FRONT side, top right or prominent.
  The number on the BACK is usually a secondary ID (NUT or similar).
- secondary_number: Extract the additional identification number printed elsewhere on the card (e.g. back).
- issue_date: the date the card was issued.
- expiry_date: the date the card expires, if present; otherwise null.
- issuer_country: set to "MX" (Mexico).
- curp: Extract ONLY if printed.
- sex: Extract gender.
- date_of_birth: Extract DOB.
- issuing_office: Extract the office location.

Do NOT use the MRZ (machine-readable zone) lines as the name or nationality. Those are secondary.
Do NOT invent any dates or codes. Only copy values that are clearly visible on the card.
`;

export async function extractImmigrationProfile(fileUrl: string): Promise<any> {
  console.log(`Extracting Immigration Profile using Gemini 2.5`);
  console.log(`Processing file: ${fileUrl}`);

  try {
    // Determine MIME type
    const ext = path.extname(fileUrl).toLowerCase();
    const mimeType = ext === '.pdf' ? 'application/pdf' : 
                     ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
                     ext === '.png' ? 'image/png' :
                     ext === '.webp' ? 'image/webp' : 'application/pdf';

    // Use Gemini for extraction
    const data = await extractWithGemini(fileUrl, mimeType, ImmigrationProfileSchema, EXTRACTION_INSTRUCTIONS);
    
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
