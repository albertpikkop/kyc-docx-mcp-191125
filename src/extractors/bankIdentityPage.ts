import { z } from 'zod';
import { BankAccountProfileSchema } from '../schemas/mx/bankAccountProfile.js';
import { normalizeEmptyToNull, sanitizeClabe, sanitizeCurrency } from '../kyc/validators.js';
import { logExtractorError } from '../utils/logging.js';
import { routeExtraction, ExtractionResult } from '../utils/modelRouter.js';

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
  console.log(`Extracting Bank Identity Page using Router (Gemini default)`);
  console.log(`Processing file: ${fileUrl}`);

  try {
    // Route extraction through ModelRouter
    const result: ExtractionResult = await routeExtraction('bank_identity_page', fileUrl, BankAccountProfileSchema, EXTRACTION_INSTRUCTIONS);
    const data = result.data;
    
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

    // Attach metadata
    (validatedData as any)._metadata = {
        modelUsed: result.modelUsed,
        costUsd: result.costUsd
    };

    return validatedData;

  } catch (error) {
    logExtractorError("bank_identity_page", fileUrl, error);
    if (error instanceof Error) {
      throw new Error(`Bank Identity Page extraction failed: ${error.message}`);
    }
    throw error;
  }
}

