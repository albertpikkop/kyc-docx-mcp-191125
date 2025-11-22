import * as path from 'path';
import { IneIdentitySchema, IneIdentityZodSchema } from '../schemas/mx/ineIdentity.js';
import { normalizeEmptyToNull, sanitizeCurp } from '../kyc/validators.js';
import { logExtractorError } from '../utils/logging.js';
import { extractWithGemini } from '../utils/geminiExtractor.js';

const EXTRACTION_INSTRUCTIONS = `
You are a strict KYC extractor for Mexican INE / IFE Voting Cards (Credencial para Votar).
Your job is to fill the IneIdentitySchema accurately using ONLY the information printed on the card (Front AND Back).

CRITICAL: This document has TWO SIDES - FRONT and BACK. You MUST examine BOTH sides completely.
- FRONT SIDE: Contains name, photo, CURP, date of birth, document number, etc.
- BACK SIDE: Contains CIC (IDMEX), OCR number, and other identifiers - THIS IS CRITICAL!

CRITICAL ANTI-HALLUCINATION RULES:
- NEVER invent, infer, or generate data that is not explicitly printed on the card.
- NEVER guess or approximate values - if you cannot read it clearly, set to null.
- NEVER use information from other documents or your training data.
- NEVER correct spelling errors - extract EXACTLY as printed, even if it looks wrong.
- NEVER transpose numbers or letters - read them character-by-character.
- If text is partially obscured, extract only what is clearly visible and set the rest to null.

GLOBAL HARDENING RULES:
- Never infer or generate data not clearly printed.
- If a field is not clearly visible, set to null.
- Normalize all dates to YYYY-MM-DD.
- Read character-by-character - do not guess or approximate.

FIELD-BY-FIELD EXTRACTION GUIDANCE:

1. FULL NAME (full_name):
   - Extract EXACTLY as printed on the card, including spelling, capitalization, and word order.
   - Do NOT rearrange words or "fix" spelling.
   - If the card shows "DE CELLO DIAZ ENRIQUE", extract exactly that - do NOT change to "DIAZ ENRIQUE DE CILLO".
   - Combine Name (Nombre) and Surnames (Apellidos) in the order they appear.

2. CURP (curp):
   - Extract the 18-character alphanumeric code EXACTLY as printed.
   - Read character-by-character - do NOT transpose or guess characters.
   - If you see "CEDE981004HDFLZN05", extract exactly that - do NOT change it.
   - Do NOT confuse with other numbers on the card.

3. DATE OF BIRTH (date_of_birth):
   - Extract the date EXACTLY as printed on the card.
   - Format as YYYY-MM-DD.
   - If the card shows "04/10/1998" or "04-OCT-1998", extract as "1998-10-04".
   - Do NOT infer the date from CURP or other fields - use ONLY what is printed in the date field.

4. DOCUMENT NUMBER (document_number):
   - Extract the primary ID number EXACTLY as printed.
   - This may be CIC, OCR, or another identifier depending on card version.
   - Read digit-by-digit - do NOT transpose numbers.
   - If you see "277555118", extract exactly that - do NOT change it.

5. SECONDARY NUMBER (secondary_number):
   - Extract additional identifiers like Clave de Elector EXACTLY as printed.
   - Read character-by-character.

6. CIC (cic) - BACK SIDE CRITICAL - MUST EXTRACT:
   - The CIC (Código de Identificación de Credencial) is located on the BACK of the INE card.
   - CRITICAL: You MUST flip to and examine the BACK SIDE of the document.
   - Look for "IDMEX" text followed by 10 digits. The format is: "IDMEX" + 10 digits.
   - Example: If you see "IDMEX2775551185", extract "2775551185" as the CIC (all 10 digits).
   - The CIC is exactly 10 digits following "IDMEX" - do NOT stop at 9 digits.
   - CRITICAL: Scan the ENTIRE back side - look in all corners, edges, and text areas.
   - Read digit-by-digit - extract ALL 10 digits after "IDMEX". Do NOT miss any digits.
   - If "IDMEX" is visible, the CIC MUST be extracted - it is ESSENTIAL identification data.
   - The CIC is a REQUIRED field - if you see "IDMEX" on the back, you MUST extract all 10 digits.

7. OCR NUMBER (ocr_number) - BACK SIDE:
   - Extract the OCR identifier from the BACK of the card if visible.
   - OCR may appear vertically (rotated text) or horizontally on the back side.
   - Look for machine-readable text, barcode-like numbers, or OCR codes.
   - OCR numbers are often longer sequences of digits/characters.
   - Scan the entire back side for any OCR-like identifiers.
   - Extract EXACTLY as printed, including all characters and digits.

8. ADDRESS (address):
   - Extract the full address if printed on the front, EXACTLY as shown.
   - Split into structured fields (street, colonia, municipio, estado, cp).
   - Do NOT correct or normalize address text - extract exactly as printed.

9. SEX (sex):
   - Extract as "H" (Hombre) or "M" (Mujer) EXACTLY as printed.
   - Do NOT infer from name or photo.

10. EMISSION/VIGENCIA (emission_year, vigencia_year):
    - Extract the years EXACTLY as printed.
    - If only year is shown, extract just the year.

BACK SIDE EXTRACTION CHECKLIST (MANDATORY):
- Did I flip to and examine the BACK SIDE of the document? (This is a 2-page PDF - page 2 is the back)
- Did I search for "IDMEX" text on the back side?
- If I found "IDMEX", did I extract the complete 9-digit CIC number that follows it?
- Did I check ALL areas of the back side: top, bottom, left, right, center?
- Did I look for OCR numbers (may appear as vertical or horizontal text)?
- Did I extract the complete CIC (all 9 digits) if "IDMEX" was visible?
- Did I extract any OCR numbers or machine-readable codes visible on the back side?
- REMEMBER: The back side is page 2 of the PDF - make sure you examined it!

VALIDATION CHECKLIST BEFORE SUBMITTING:
- Did I read every character exactly as printed?
- Did I avoid guessing or approximating any value?
- Did I preserve spelling errors if they exist on the card?
- Did I extract dates from the date field, not from CURP or other fields?
- Did I set fields to null if they are not clearly visible?
- Did I extract ALL back-side identifiers (CIC, OCR) if visible?

CRITICAL: The back side of the INE card contains important identifiers:
- CIC (Código de Identificación de Credencial) - usually 9 digits near "IDMEX"
- OCR Number - may appear vertically or horizontally
- These are ESSENTIAL for complete identification - extract them if visible!

Do not confuse the CITIZEN ID with the CURP.
Do not transpose characters or numbers.
Do not "fix" what appears to be errors - extract exactly as printed.
Do not skip the back side - examine it thoroughly for CIC and OCR data.
`;

export async function extractIneIdentity(fileUrl: string): Promise<any> {
  console.log(`Extracting INE Identity using Gemini 2.5`);
  console.log(`Processing file: ${fileUrl}`);

  try {
    // Determine MIME type
    const ext = path.extname(fileUrl).toLowerCase();
    const mimeType = ext === '.pdf' ? 'application/pdf' : 
                     ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
                     ext === '.png' ? 'image/png' :
                     ext === '.webp' ? 'image/webp' : 'application/pdf';

    // Use Gemini for extraction
    const data = await extractWithGemini(fileUrl, mimeType, IneIdentitySchema, EXTRACTION_INSTRUCTIONS);
    
    // Extract object if nested (Gemini returns flat structure)
    const profile = data.ine_identity || data;

    // Deep normalization of empty strings to null
    const normalizedProfile = normalizeEmptyToNull(profile);
    
    // Sanitize CURP
    if (normalizedProfile.curp) {
        // Sometimes models add "CURP" prefix
        const cleanCurp = normalizedProfile.curp.replace(/^CURP\s*/i, '');
        // We could use sanitizeCurp here but we'll let the caller handle it
        // Actually, let's do basic cleanup
        normalizedProfile.curp = cleanCurp.trim().toUpperCase();
    }

    return normalizedProfile;

  } catch (error) {
    logExtractorError("ine", fileUrl, error);
    if (error instanceof Error) {
      throw new Error(`INE identity extraction failed: ${error.message}`);
    }
    throw error;
  }
}

// Export instructions for use in Gemini Test
export { EXTRACTION_INSTRUCTIONS };
