import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { MODEL, validateModel, type GPT5Model } from '../model.js';
import { ImmigrationProfileSchema } from '../schemas/mx/immigrationProfile.js';

/**
 * Instructions for extracting immigration profile from FM2/Residente card
 */
const EXTRACTION_INSTRUCTIONS = `
You are a strict KYC extractor for Mexican immigration cards (FM2 / Residente Temporal / Residente Permanente).

Your job is to fill the ImmigrationProfile JSON schema accurately and ONLY with information printed on the card.

If something is not clearly printed, return null for that field. Never guess or infer.

Normalize all dates to ISO format YYYY-MM-DD.

EXTRACTION RULES:

1. FULL NAME:
   - Extract from the card's printed name field.
   - Normalize into consistent Western order (given name first, surname last).
   - Do NOT use machine-readable (MRZ) data for the name.

2. NATIONALITY:
   - Extract only from the nationality field on the card.
   - Do NOT infer or translate values.
   - Copy exactly as printed.

3. DOCUMENT TYPE:
   - Extract the residency category exactly as printed.
   - Do NOT guess or generalize.
   - Use the exact text from the card.

4. PRIMARY DOCUMENT NUMBER:
   - Extract the primary ID number printed in the main prominent position on the front side of the FM2 card.
   - Do NOT confuse MRZ sequences with this number.
   - This is the main identification number found prominently on the front.

5. SECONDARY NUMBER:
   - Extract the additional ID number printed in the secondary position on the back or lower half of the card.
   - This must be separate from the primary document number.
   - If no secondary number exists, set to null.

6. DATE OF BIRTH:
   - Extract from the birthdate field on the card.
   - Convert to YYYY-MM-DD format.
   - Do NOT derive from CURP or MRZ.
   - Only use the explicitly printed birthdate.

7. CURP:
   - Extract only if explicitly printed on the card.
   - Do NOT calculate or infer it.
   - If not present, set to null.

8. SEX / GENDER:
   - Extract only from the gender field on the card.
   - Do NOT infer from name or photo.
   - Use the exact value printed.

9. ISSUE DATE & EXPIRY DATE:
   - Extract from the printed issue and expiration fields.
   - Normalize to YYYY-MM-DD format.
   - If expiration is not present, set to null.
   - Do NOT derive dates from other fields.

10. ISSUING OFFICE:
    - Extract from the designated office-of-issuance section.
    - Ignore any MRZ references.
    - Use the office name/location as printed.

11. ISSUER COUNTRY:
    - Always return the country printed on the document.
    - No assumptions about nationality or residency.
    - Typically "MX" for Mexican immigration documents.

CRITICAL RULES:
- Do NOT use MRZ (machine-readable zone) data for any field except as a last resort if the printed field is illegible.
- Do NOT invent, calculate, or infer any values.
- Do NOT translate or normalize values beyond date formats.
- Empty strings must be converted to null for optional fields.
- All dates must be in YYYY-MM-DD format.
- Only extract what is clearly visible and printed on the card.
`;

/**
 * Extracts immigration profile data from a Mexican FM2/Residente card PDF/image.
 * Uses GPT-5.1 vision capabilities via Responses API.
 * 
 * @param fileUrl - URL or local file path to the immigration card document
 * @returns The parsed JSON object with immigration_profile key
 */
export async function extractImmigrationProfile(fileUrl: string): Promise<any> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set in environment variables');
  }
  
  const client = new OpenAI({ apiKey });
  const model: GPT5Model = validateModel(MODEL);

  console.log(`Extracting immigration profile using model: ${model}`);
  console.log(`Processing file: ${fileUrl}`);

  // Determine if fileUrl is a local path or URL
  const isUrl = fileUrl.startsWith('http://') || fileUrl.startsWith('https://') || fileUrl.startsWith('data:');
  
  let inputItem: any;

  if (isUrl) {
    // Use URL directly for input_image
    inputItem = {
      type: 'input_image',
      image_url: fileUrl
    };
  } else {
    // Local file path - read and convert to data URL
    const ext = path.extname(fileUrl).toLowerCase();
    const isPdf = ext === '.pdf';
    const isImage = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext);

    if (!isPdf && !isImage) {
      throw new Error(`Unsupported file type: ${ext}. Only PDF and Images are supported.`);
    }

    if (isPdf) {
      // For PDFs, upload and use file_id
      console.log('Uploading PDF file...');
      const fileStream = fs.createReadStream(fileUrl);
      const uploadedFile = await client.files.create({
        file: fileStream,
        purpose: 'assistants',
      });
      
      inputItem = {
        type: 'input_file',
        file_id: uploadedFile.id,
      };
    } else {
      // For images, convert to data URL
      const fileBuffer = fs.readFileSync(fileUrl);
      const base64Data = fileBuffer.toString('base64');
      const mimeType = ext === '.jpg' ? 'image/jpeg' : `image/${ext.substring(1)}`;
      inputItem = {
        type: 'input_image',
        image_url: `data:${mimeType};base64,${base64Data}`
      };
    }
  }

  try {
    const res = await client.responses.create({
      model,
      instructions: EXTRACTION_INSTRUCTIONS,
      input: [
        {
          role: 'user',
          content: [inputItem]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "immigration_profile",
          strict: true,
          schema: ImmigrationProfileSchema
        },
      },
    } as any);

    const outputItem = res.output?.[0] as any;
    const content = outputItem?.content?.[0]?.text || (res as any).output_text;

    if (!content) {
      throw new Error('No content received from model');
    }

    const data = JSON.parse(content);

    // Extract immigration_profile from response or use data directly
    const profile = data.immigration_profile || data;

    // Post-processing: Convert empty strings and invalid date markers to null for all optional fields
    const normalizeEmptyToNull = (value: any): any => {
      if (value === "" || value === "/" || value === "-" || value === "N/A" || value === "N/A") {
        return null;
      }
      return value;
    };

    // Normalize all nullable string fields
    if (profile.full_name !== undefined) {
      profile.full_name = normalizeEmptyToNull(profile.full_name);
    }
    if (profile.nationality !== undefined) {
      profile.nationality = normalizeEmptyToNull(profile.nationality);
    }
    if (profile.document_type !== undefined) {
      profile.document_type = normalizeEmptyToNull(profile.document_type);
    }
    if (profile.document_number !== undefined) {
      profile.document_number = normalizeEmptyToNull(profile.document_number);
    }
    if (profile.secondary_number !== undefined) {
      profile.secondary_number = normalizeEmptyToNull(profile.secondary_number);
    }
    if (profile.date_of_birth !== undefined) {
      profile.date_of_birth = normalizeEmptyToNull(profile.date_of_birth);
    }
    if (profile.curp !== undefined) {
      profile.curp = normalizeEmptyToNull(profile.curp);
    }
    if (profile.sex !== undefined) {
      profile.sex = normalizeEmptyToNull(profile.sex);
    }
    if (profile.issue_date !== undefined) {
      profile.issue_date = normalizeEmptyToNull(profile.issue_date);
    }
    if (profile.expiry_date !== undefined) {
      profile.expiry_date = normalizeEmptyToNull(profile.expiry_date);
    }
    if (profile.issuing_office !== undefined) {
      profile.issuing_office = normalizeEmptyToNull(profile.issuing_office);
    }

    // Normalize issuer_country to ISO country code
    if (!profile.issuer_country || profile.issuer_country === "") {
      profile.issuer_country = "MX";
    } else if (profile.issuer_country.toUpperCase() === "MEX" || profile.issuer_country.toUpperCase() === "MEXICO") {
      profile.issuer_country = "MX";
    }

    return profile;

  } catch (error) {
    console.error('Extraction failed:', error);
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON response from model: ${error.message}`);
    }
    if (error instanceof Error) {
      throw new Error(`Immigration profile extraction failed: ${error.message}`);
    }
    throw error;
  }
}

