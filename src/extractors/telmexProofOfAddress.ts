import * as path from 'path';
import { ProofOfAddressSchema } from '../schemas/mx/proofOfAddress.js';
import { normalizeEmptyToNull, sanitizeRfc, sanitizeInvoiceNumber, sanitizeCurrency } from '../kyc/validators.js';
import { extractWithGemini } from '../utils/geminiExtractor.js';

const EXTRACTION_INSTRUCTIONS = `
You are a strict KYC extractor for Mexican Telmex bills (comprobantes de domicilio).
Your job is to fill the ProofOfAddress JSON schema accurately using ONLY information printed on the bill.

GLOBAL HARDENING RULES:
- Never infer or generate data not clearly printed.
- If a field is not present, set to null.
- Normalize all dates to YYYY-MM-DD.
- Convert amounts to numeric values (no currency symbols).
- Currency: Assume "MXN" for Mexican documents unless the document explicitly uses "USD", "US$", "DÓLARES", or "DLS", in which case set to "USD". Never treat "$" alone as USD; in this context "$" means pesos (MXN).

EXTRACT:
- Provider info: vendor_name (Telmex) and vendor_tax_id.
- Holder info: the customer/contract holder name exactly as printed.
- Service address: Split strictly into street, exterior number, interior number (if any), colonia, municipio/alcaldía, estado, CP, country="MX".
- Service identifiers: phone number (service number) and account number.
- Billing info: billing_period, due_date, issue_datetime (if printed), currency, total_due.
- Doc metadata: mark document_type as "telmex_bill" and fill evidence_meta.

Do not infer who the ultimate client is. Only extract what this single bill says.
`;

// Re-implementing extractDocument logic here to include optimization step directly
// instead of relying on visionExtractor.ts which handles raw files
async function extractOptimizedDocument(fileUrl: string, schema: any, instructions: string): Promise<any> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  const client = new OpenAI({ apiKey });
  const model: GPT5Model = validateModel(MODEL);

  console.log(`Extracting document using model: ${model}`);
  
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

  const res = await withRetry(() =>
    client.responses.create({
      model,
      instructions,
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
    } as any)
  );

  const outputItem = res.output?.[0] as any;
  const content = outputItem?.content?.[0]?.text || (res as any).output_text;

  if (!content) {
    throw new Error('No content received from model');
  }

  const data = JSON.parse(content);
  const normalizedData = normalizeEmptyToNull(data);

  // Apply standard sanitizers
  const applySanitizers = (value: any) => {
    if (Array.isArray(value)) {
      value.forEach(applySanitizers);
      return;
    }
    if (value && typeof value === 'object') {
      for (const key of Object.keys(value)) {
        const current = value[key];
        if (/tax_id$/i.test(key) || key === 'rfc' || key === 'vendor_tax_id' || key === 'client_tax_id') {
          value[key] = sanitizeRfc(current);
        } else if (key === 'invoice_number' || key === 'account_reference') {
          value[key] = sanitizeInvoiceNumber(current);
        } else if (key === 'currency') {
          value[key] = sanitizeCurrency(current);
        }
        applySanitizers(value[key]);
      }
    }
  };
  applySanitizers(normalizedData);

  // Ensure country
  if (normalizedData.client_address) normalizedData.client_address.country = "MX";
  if (normalizedData.vendor_address) normalizedData.vendor_address.country = "MX";

  return normalizedData;
}

export async function extractTelmexProofOfAddress(fileUrl: string): Promise<any> {
  console.log(`Extracting Telmex Proof of Address using Gemini 2.5`);
  console.log(`Processing file: ${fileUrl}`);
  
  try {
    // Determine MIME type
    const ext = path.extname(fileUrl).toLowerCase();
    const mimeType = ext === '.pdf' ? 'application/pdf' : 
                     ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
                     ext === '.png' ? 'image/png' :
                     ext === '.webp' ? 'image/webp' : 'application/pdf';

    // Use Gemini for extraction
    const result = await extractWithGemini(fileUrl, mimeType, ProofOfAddressSchema, EXTRACTION_INSTRUCTIONS);
    
    // Ensure document_type is set if model missed it
    if (!result.document_type) {
      result.document_type = 'telmex_bill';
    }

    // Add filename to metadata if available and not set
    if (result.evidence_meta && !result.evidence_meta.original_filename) {
      result.evidence_meta.original_filename = path.basename(fileUrl);
    } else if (!result.evidence_meta) {
       result.evidence_meta = {
          issuer_country: "MX",
          original_filename: path.basename(fileUrl),
          pages: 1 // default/unknown
       };
    }

    return result;
  } catch (error) {
    console.error('Telmex extraction failed:', error);
    throw error;
  }
}
