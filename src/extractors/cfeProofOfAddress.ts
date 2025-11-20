import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { MODEL, validateModel, type GPT5Model } from '../model.js';
import { ProofOfAddressSchema } from '../schemas/mx/proofOfAddress.js';

const EXTRACTION_INSTRUCTIONS = `
You are a strict KYC extractor for Mexican CFE electricity bills (comprobantes de domicilio).
Your job is to fill the ProofOfAddress JSON schema accurately using ONLY information printed on the bill.

GLOBAL HARDENING RULES:
- Never infer or generate data not clearly printed.
- If a field is not present, set to null. Do NOT use "N/A", "Unknown", "--", or empty strings.
- Normalize all dates to YYYY-MM-DD.
- Convert amounts to numeric values (no currency symbols).
- Never invent service numbers, RFCs, or names.

EXTRACT:
- Provider info: vendor_name (CFE) and vendor_tax_id from the issuer block.
- Holder info: the customer/contract holder name exactly as printed. Do NOT assume it is "PFDS".
- Service address: Split strictly into street, exterior number, interior number (if any), colonia, municipio/alcaldía, estado, CP, country="MX". Include cross streets if printed.
- Service identifiers: service or contract number / account number printed on the bill.
- Billing info: billing_period_start, billing_period_end, due_date, issue_datetime (if printed), currency, total_due.
- Doc metadata: mark document_type as "cfe_receipt" and fill evidence_meta (issuer_country="MX", original_filename, pages).

Do not infer who the ultimate client is and do not merge with other documents. Only extract what this single CFE bill says.
`;

export async function extractCfeProofOfAddress(fileUrl: string): Promise<any> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set in environment variables');
  }

  const client = new OpenAI({ apiKey });
  const model: GPT5Model = validateModel(MODEL);

  console.log(`Extracting CFE Proof of Address using model: ${model}`);
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
      throw new Error(`Unsupported file type: ${ext}. Only PDF and Images are supported.`);
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
          name: "proof_of_address",
          strict: true,
          schema: ProofOfAddressSchema
        },
      },
    } as any);

    const outputItem = res.output?.[0] as any;
    const content = outputItem?.content?.[0]?.text || (res as any).output_text;

    if (!content) {
      throw new Error('No content received from model');
    }

    const data = JSON.parse(content);
    
    // Extract proof_of_address if nested
    const proofOfAddress = data.proof_of_address || data;

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

    const normalizedProof = deepNormalize(proofOfAddress);

    // Add filename to metadata if available and not set
    if (normalizedProof.evidence_meta && !normalizedProof.evidence_meta.original_filename) {
      normalizedProof.evidence_meta.original_filename = path.basename(fileUrl);
    }

    // Ensure country is set to "MX" for addresses
    if (normalizedProof.client_address) {
      normalizedProof.client_address.country = "MX";
    }

    if (normalizedProof.vendor_address) {
      normalizedProof.vendor_address.country = "MX";
    }

    return normalizedProof;

  } catch (error) {
    console.error('Extraction failed:', error);
    if (error instanceof Error) {
      throw new Error(`CFE Proof of Address extraction failed: ${error.message}`);
    }
    throw error;
  }
}
