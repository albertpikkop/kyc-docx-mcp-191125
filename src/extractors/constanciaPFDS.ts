import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { MODEL, validateModel, type GPT5Model } from '../model.js';
import { CompanyTaxProfileSchema } from '../schemas/mx/companyTaxProfile.js';

const EXTRACTION_INSTRUCTIONS = `
You are a strict KYC extractor for Mexican SAT Constancias (Persona Moral).
Your job is to fill the CompanyTaxProfile JSON schema accurately using ONLY the information printed on the document.

GLOBAL HARDENING RULES:
- Never infer or generate data.
- If a field is not present, set to null. Do NOT use "N/A" or empty strings.
- Normalize all dates to YYYY-MM-DD.

EXTRACT:
- RFC: Extract EXACTLY as printed (e.g., PFD210830KQ7). Never transform or rebuild it.
- Razón Social: Exactly as printed (e.g., PFDS).
- Capital Regime & Tax Regime: Must match printed tables only.
- Start of Operations: Date as YYYY-MM-DD.
- Status: e.g., "ACTIVO".
- Issue Date/Place: From "Lugar y Fecha de Emisión".
- Fiscal Address: This is the CANONICAL fiscal address. Split strictly into: street, ext_number, int_number, colonia, municipio, estado, cp. Set country="MX".
- Economic Activities: Extract from the "Actividades Económicas" table.
- Tax Obligations: Extract from the "Obligaciones" table.

Only copy what is explicitly printed. No hallucinations.
`;

export async function extractCompanyTaxProfile(fileUrl: string): Promise<any> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set in environment variables');
  }

  const client = new OpenAI({ apiKey });
  const model: GPT5Model = validateModel(MODEL);

  console.log(`Extracting Company Tax Profile using model: ${model}`);
  console.log(`Processing file: ${fileUrl}`);

  const isUrl = fileUrl.startsWith('http://') || fileUrl.startsWith('https://') || fileUrl.startsWith('data:');
  let inputItem: any;

  if (isUrl) {
    inputItem = {
      type: 'input_image',
      image_url: fileUrl
    };
  } else {
    const ext = path.extname(fileUrl).toLowerCase();
    const isPdf = ext === '.pdf';
    const isImage = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext);

    if (!isPdf && !isImage) {
        // Fallback or error
         throw new Error(`Unsupported file type: ${ext}.`);
    }

    if (isPdf) {
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
          name: "company_tax_profile",
          strict: true,
          schema: CompanyTaxProfileSchema
        },
      },
    } as any);

    const outputItem = res.output?.[0] as any;
    const content = outputItem?.content?.[0]?.text || (res as any).output_text;

    if (!content) {
      throw new Error('No content received from model');
    }

    const data = JSON.parse(content);
    
    // Extract object if nested (schema name matches)
    const profile = data.company_tax_profile || data;

    // Strict Post-processing: Normalize empty strings to null
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

    const normalizedProfile = deepNormalize(profile);

    // Ensure country is set to "MX" for fiscal_address
    if (normalizedProfile.fiscal_address) {
      normalizedProfile.fiscal_address.country = "MX";
    }

    return normalizedProfile;

  } catch (error) {
    console.error('Extraction failed:', error);
    if (error instanceof Error) {
      throw new Error(`Company tax profile extraction failed: ${error.message}`);
    }
    throw error;
  }
}
