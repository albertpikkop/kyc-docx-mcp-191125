import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { MODEL, validateModel, type GPT5Model } from '../model.js';
import { BankAccountProfileSchema } from '../schemas/mx/bankAccountProfile.js';
import { normalizeEmptyToNull, sanitizeClabe, sanitizeCurrency } from '../kyc/validators.js';
import { withRetry } from '../utils/retry.js';
import { logExtractorError } from '../utils/logging.js';

// Zod definition matching BankAccountProfileSchema for runtime validation
const AddressZodSchema = z.object({
  street: z.string().nullable(),
  ext_number: z.string().nullable(),
  int_number: z.string().nullable(),
  colonia: z.string().nullable(),
  municipio: z.string().nullable(),
  estado: z.string().nullable(),
  cp: z.string().nullable(),
  cross_streets: z.string().nullable(),
  country: z.string().optional().default("MX")
});

const BankAccountProfileZodSchema = z.object({
  bank_account_profile: z.object({
    bank_name: z.string(),
    account_holder_name: z.string(),
    account_number: z.string().nullable().optional(),
    clabe: z.string().nullable().optional(),
    currency: z.enum(["MXN", "USD"]).nullable().optional(),
    statement_period_start: z.string().nullable().optional(),
    statement_period_end: z.string().nullable().optional(),
    address_on_statement: AddressZodSchema.nullable().optional()
  })
});

const EXTRACTION_INSTRUCTIONS = `
You are a strict KYC extractor for Mexican Bank Documents (Identity Sheet / Carátula).
Your job is to extract ONLY the account profile information into the bank_account_profile object.

GLOBAL HARDENING RULES:
- Never infer or generate data not clearly printed.
- If a field is not present, set to null. Do NOT use "N/A", "Unknown", "--", or empty strings.
- Normalize all dates to YYYY-MM-DD.
- Never invent account numbers, CLABEs, or names.

EXTRACT:
- Bank Name: (e.g. BBVA, Banorte, Santander).
- Account Holder Name: Extract exactly as printed. Do NOT assume it is "PFDS" unless printed.
- Account Number: Extract account/contract number.
- CLABE: Extract 18-digit CLABE.
- Currency: Assume "MXN" for Mexican documents unless the document explicitly uses "USD", "US$", "DÓLARES", or "DLS", in which case set to "USD". Never treat "$" alone as USD; in this context "$" means pesos (MXN).
- Statement Period: Start and End dates (YYYY-MM-DD) if available, or document date.
- Address: The registered address printed on the statement header. Split strictly into structured fields (street, ext_number, int_number, colonia, municipio, estado, cp). Set country="MX".

Do NOT extract individual transactions here. Focus only on the header/profile info.
Do not hallucinate missing fields.
`;

export async function extractBankIdentityPage(fileUrl: string): Promise<any> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set in environment variables');
  }

  const client = new OpenAI({ apiKey });
  const model: GPT5Model = validateModel(MODEL);

  console.log(`Extracting Bank Identity Page using model: ${model}`);
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
        // Fallback for images
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
            name: "bank_account_profile",
            strict: false,
            schema: BankAccountProfileSchema
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
    
    // Deep normalization of empty strings to null
    const normalizedData = normalizeEmptyToNull(data);

    // Runtime Validation against Zod Schema
    const validationResult = BankAccountProfileZodSchema.safeParse(normalizedData);
    
    if (!validationResult.success) {
        console.warn("Bank Identity Schema Validation Failed:", validationResult.error);
        throw new Error(`Validation Error: ${validationResult.error.message}`);
    }

    const validatedData = validationResult.data;
    const profile = validatedData.bank_account_profile;

    if (profile) {
      if (profile.address_on_statement) {
          profile.address_on_statement.country = "MX";
      }
      // Sanitize CLABE
      if (profile.clabe) {
        profile.clabe = sanitizeClabe(profile.clabe);
      }
      if (profile.currency) {
        profile.currency = sanitizeCurrency(profile.currency);
      }
    }

    return validatedData;

  } catch (error) {
    logExtractorError("bank_identity_page", fileUrl, error);
    if (error instanceof Error) {
      throw new Error(`Bank Identity Page extraction failed: ${error.message}`);
    }
    throw error;
  }
}

