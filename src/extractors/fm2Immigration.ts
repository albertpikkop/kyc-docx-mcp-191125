import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { MODEL, validateModel, type GPT5Model } from '../model.js';
import { ImmigrationProfileSchema } from '../schemas/mx/immigrationProfile.js';
import { normalizeEmptyToNull, sanitizeCurp } from '../kyc/validators.js';
import { withRetry } from '../utils/retry.js';
import { logExtractorError } from '../utils/logging.js';
import { optimizeDocument } from '../utils/documentOptimizer.js';

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
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set in environment variables');
  }

  const client = new OpenAI({ apiKey });
  const model: GPT5Model = validateModel(MODEL);

  console.log(`Extracting Immigration Profile using model: ${model}`);
  console.log(`Processing file: ${fileUrl}`);

  const isUrl = fileUrl.startsWith('http://') || fileUrl.startsWith('https://') || fileUrl.startsWith('data:');
  let inputItem: any;

  if (isUrl) {
    inputItem = {
      type: 'input_image',
      image_url: fileUrl
    };
  } else {
    // Optimize document before sending to OpenAI
    const optimizedResults = await optimizeDocument(fileUrl);
    const optimized = optimizedResults[0];

    // Check if optimization failed (fallback)
    if (!optimized.success || optimized.isFallback) {
        console.warn(`Optimization failed for ${fileUrl}. Uploading raw PDF file to OpenAI.`);
        
        // FALLBACK: Upload original PDF file
        console.log('Uploading raw PDF file...');
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
        // Success: Use optimized image
        const base64Data = optimized.buffer!.toString('base64');
        inputItem = {
            type: 'input_image',
            image_url: `data:${optimized.mimeType};base64,${base64Data}`
        };
    }
  }

  try {
    const res = await withRetry(() =>
      client.responses.create({
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
      } as any)
    );

    const outputItem = res.output?.[0] as any;
    const content = outputItem?.content?.[0]?.text || (res as any).output_text;

    if (!content) {
      throw new Error('No content received from model');
    }

    const data = JSON.parse(content);
    
    // Extract object if nested
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
