import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { MODEL, validateModel, type GPT5Model } from '../model.js';
import { ProofOfAddressSchema } from '../schemas/mx/proofOfAddress.js';
import {
  normalizeEmptyToNull,
  sanitizeRfc,
  sanitizeInvoiceNumber,
  sanitizeCurrency,
} from '../kyc/validators.js';
import { withRetry } from '../utils/retry.js';
import { logExtractorError } from '../utils/logging.js';
import { optimizeDocument } from '../utils/documentOptimizer.js';

const EXTRACTION_INSTRUCTIONS = `
You are a strict KYC extractor for Mexican CFE electricity bills (comprobantes de domicilio).
Your job is to fill the ProofOfAddress JSON schema accurately using ONLY information printed on the bill.

GLOBAL HARDENING RULES:
- Never infer or generate data not clearly printed.
- If a field is not present, set to null. Do NOT use "N/A", "Unknown", "--", or empty strings.
- Normalize all dates to YYYY-MM-DD.
- Convert amounts to numeric values (no currency symbols).
- Never invent service numbers, RFCs, or names.
- Currency: Assume "MXN" for Mexican documents unless the document explicitly uses "USD", "US$", "DÓLARES", or "DLS", in which case set to "USD". Never treat "$" alone as USD; in this context "$" means pesos (MXN).

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
            name: "proof_of_address",
            strict: true,
            schema: ProofOfAddressSchema
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

    const proofOfAddress = data.proof_of_address || data;
    const normalizedProof = normalizeEmptyToNull(proofOfAddress);

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

    if (normalizedProof.vendor_tax_id) {
      normalizedProof.vendor_tax_id = sanitizeRfc(normalizedProof.vendor_tax_id);
    }
    if (normalizedProof.client_tax_id) {
      normalizedProof.client_tax_id = sanitizeRfc(normalizedProof.client_tax_id);
    }
    if (normalizedProof.invoice_number) {
      normalizedProof.invoice_number = sanitizeInvoiceNumber(normalizedProof.invoice_number);
    }
    if (normalizedProof.account_reference) {
      normalizedProof.account_reference = sanitizeInvoiceNumber(normalizedProof.account_reference);
    }
    if (normalizedProof.currency) {
      normalizedProof.currency = sanitizeCurrency(normalizedProof.currency);
    }

    return normalizedProof;

  } catch (error) {
    logExtractorError("cfe", fileUrl, error);
    if (error instanceof Error) {
      throw new Error(`CFE Proof of Address extraction failed: ${error.message}`);
    }
    throw error;
  }
}
