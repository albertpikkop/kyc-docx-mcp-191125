import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { MODEL, validateModel, type GPT5Model } from '../model.js';
import { sanitizeRfc, sanitizeInvoiceNumber } from '../utils/sanitize.js';

// Base instruction for generic document extraction if no specific instructions are provided
const BASE_INSTRUCTIONS = `
You are a strict KYC data extractor.
Your job is to fill the provided JSON schema accurately using ONLY information printed on the document.

GLOBAL HARDENING RULES:
- Never infer or generate data not clearly printed.
- If a field is not present, set to null. Do NOT use "N/A", "Unknown", "--", or empty strings.
- Normalize all dates to YYYY-MM-DD.
- Convert amounts to numeric values.
- Do not invent data.
`;

export async function extractDocument(filePath: string, schema: any, instructions?: string): Promise<any> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set in environment variables');
  }

  const client = new OpenAI({ apiKey });
  const model: GPT5Model = validateModel(MODEL);

  console.log(`Extracting document using model: ${model}`);
  console.log(`Processing file: ${filePath}`);

  const isUrl = filePath.startsWith('http://') || filePath.startsWith('https://') || filePath.startsWith('data:');
  let inputItem: any;

  if (isUrl) {
    inputItem = {
      type: 'input_image',
      image_url: filePath
    };
  } else {
    const ext = path.extname(filePath).toLowerCase();
    const isPdf = ext === '.pdf';
    const isImage = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext);

    if (!isPdf && !isImage) {
      throw new Error(`Unsupported file type: ${ext}. Only PDF and Images are supported.`);
    }

    if (isPdf) {
      console.log('Uploading PDF file...');
      const fileStream = fs.createReadStream(filePath);
      const uploadedFile = await client.files.create({
        file: fileStream,
        purpose: 'assistants',
      });

      inputItem = {
        type: 'input_file',
        file_id: uploadedFile.id,
      };
    } else {
      const fileBuffer = fs.readFileSync(filePath);
      const base64Data = fileBuffer.toString('base64');
      const mimeType = ext === '.jpg' ? 'image/jpeg' : `image/${ext.substring(1)}`;
      inputItem = {
        type: 'input_image',
        image_url: `data:${mimeType};base64,${base64Data}`
      };
    }
  }

  const finalInstructions = instructions 
    ? `${instructions}\n\n${BASE_INSTRUCTIONS}`
    : BASE_INSTRUCTIONS;

  try {
    const res = await client.responses.create({
      model,
      instructions: finalInstructions,
      input: [
        {
          role: 'user',
          content: [inputItem]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "document_extraction",
          strict: true,
          schema: schema
        },
      },
    } as any);

    const outputItem = res.output?.[0] as any;
    const content = outputItem?.content?.[0]?.text || (res as any).output_text;

    if (!content) {
      throw new Error('No content received from model');
    }

    const data = JSON.parse(content);

    // Strict Post-processing
    const normalizeEmptyToNull = (value: any): any => {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed === "" || trimmed === "/" || trimmed === "N/A" || trimmed === "--" || trimmed.toLowerCase() === "unknown") {
          return null;
        }
        return trimmed;
      }
      return value;
    };

    const deepNormalize = (obj: any): any => {
        if (Array.isArray(obj)) {
            return obj.map(deepNormalize);
        } else if (obj !== null && typeof obj === 'object') {
            for (const key in obj) {
                obj[key] = deepNormalize(obj[key]);
            }
            return obj;
        } else {
            return normalizeEmptyToNull(obj);
        }
    };

    const normalizedData = deepNormalize(data);

    // Sanitize specific fields if they exist in the schema/data
    if (normalizedData.vendor_tax_id) {
      normalizedData.vendor_tax_id = sanitizeRfc(normalizedData.vendor_tax_id);
    }
    if (normalizedData.client_tax_id) {
      normalizedData.client_tax_id = sanitizeRfc(normalizedData.client_tax_id);
    }

    if (normalizedData.invoice_number) {
      normalizedData.invoice_number = sanitizeInvoiceNumber(normalizedData.invoice_number);
    }
    if (normalizedData.account_reference) {
      normalizedData.account_reference = sanitizeInvoiceNumber(normalizedData.account_reference);
    }

    // Ensure country fields are normalized if present in address objects
    // This is generic traversal for keys ending in 'address'
    const setCountryInAddress = (obj: any) => {
        if (obj && typeof obj === 'object') {
            for (const key in obj) {
                if (key.endsWith('address') || key === 'address') {
                     if (obj[key] && typeof obj[key] === 'object' && !obj[key].country) {
                         obj[key].country = "MX";
                     }
                } else {
                    setCountryInAddress(obj[key]);
                }
            }
        }
    };
    setCountryInAddress(normalizedData);

    return normalizedData;

  } catch (error) {
    console.error('Extraction failed:', error);
    if (error instanceof Error) {
        // Enhance error message if it's a schema validation error from OpenAI
        throw new Error(`Document extraction failed: ${error.message}`);
    }
    throw error;
  }
}
