import { z } from 'zod';
import { BankAccountProfileSchema } from '../schemas/mx/bankAccountProfile.js';
import { sanitizeClabe, sanitizeCurrency } from '../kyc/validators.js';
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
You are a STRICT KYC extractor for Mexican Bank Statements (Estados de Cuenta Bancarios).
Your job is to extract PROFILE information ONLY - ZERO HALLUCINATIONS, ZERO INFERENCE.

═══════════════════════════════════════════════════════════════════════════════
ANTI-HALLUCINATION RULES (MANDATORY):
═══════════════════════════════════════════════════════════════════════════════
1. ONLY extract text that is PHYSICALLY PRINTED on the document
2. If a field is not visible, set to null - NEVER guess or infer
3. NEVER use placeholder values like "N/A", "--", "Unknown", or empty strings ""
4. Copy names and addresses EXACTLY as printed
5. Convert ALL dates to YYYY-MM-DD format
6. NEVER invent account numbers, CLABEs, or names
7. Do NOT extract transactions - only header/profile information

═══════════════════════════════════════════════════════════════════════════════
BANK STATEMENT STRUCTURE - WHERE TO FIND DATA:
═══════════════════════════════════════════════════════════════════════════════
Bank statements typically have this layout:

HEADER SECTION (Top):
- Bank logo and name
- Statement date range
- Account holder name and address
- Account number and CLABE

ACCOUNT INFO SECTION:
- Account type
- Branch information
- Currency

BALANCE SUMMARY:
- Opening balance
- Closing balance

TRANSACTIONS (Do NOT extract these):
- Individual deposits/withdrawals

═══════════════════════════════════════════════════════════════════════════════
FIELD EXTRACTION RULES:
═══════════════════════════════════════════════════════════════════════════════

1. BANK NAME (bank_name):
   - Extract the bank name from logo/header
   - Common banks: BBVA, Banorte, Santander, HSBC, Citibanamex, Scotiabank, Banco Azteca
   - Use official name (e.g., "BBVA México", "Banorte", "Santander")

2. ACCOUNT HOLDER NAME (account_holder_name) - CRITICAL:
   - Extract the EXACT name as printed on the statement
   - May be individual: "ENRIQUE DE CELLO DIAZ"
   - May be company: "PFDS SAPI DE CV", "GRUPO POUNJ SA DE CV"
   - NEVER assume or guess the name

3. ACCOUNT NUMBER (account_number):
   - Extract the account/contract number
   - Usually 10-12 digits
   - May be partially masked (e.g., "****1234") - extract as shown

4. CLABE (clabe) - CRITICAL:
   - 18-digit interbank transfer code
   - Format: BBBSSSCCCCCCCCCCCD
   - Extract EXACTLY as printed
   - If not visible, set to null

5. CURRENCY (currency):
   - "MXN" for Mexican peso accounts (default)
   - "USD" only if document explicitly shows US Dollars
   - "$" symbol alone = MXN (NOT USD)

6. STATEMENT PERIOD:
   - statement_period_start: First day of statement (YYYY-MM-DD)
   - statement_period_end: Last day of statement (YYYY-MM-DD)
   - Look for "Periodo" or date range in header

7. ADDRESS ON STATEMENT (address_on_statement):
   - The registered address shown in the header
   - Split into components:
     * street: Street name (e.g., "AV. INSURGENTES SUR")
     * ext_number: Exterior number (e.g., "1234")
     * int_number: Interior if present (e.g., "PISO 5")
     * colonia: Neighborhood (e.g., "DEL VALLE")
     * municipio: Municipality (e.g., "BENITO JUAREZ")
     * estado: State (e.g., "CIUDAD DE MEXICO")
     * cp: Postal code (e.g., "03100")
     * country: Always "MX"

═══════════════════════════════════════════════════════════════════════════════
OUTPUT FORMAT:
═══════════════════════════════════════════════════════════════════════════════
Return data in this structure:
{
  "bank_account_profile": {
    "bank_name": "...",
    "account_holder_name": "...",
    "account_number": "...",
    "clabe": "...",
    "currency": "MXN",
    "statement_period_start": "YYYY-MM-DD",
    "statement_period_end": "YYYY-MM-DD",
    "address_on_statement": { ... }
  }
}

═══════════════════════════════════════════════════════════════════════════════
VALIDATION CHECKLIST:
═══════════════════════════════════════════════════════════════════════════════
□ bank_name is a valid Mexican bank
□ account_holder_name is populated with ACTUAL printed name
□ CLABE (if present) is exactly 18 digits
□ All dates are YYYY-MM-DD format
□ No placeholder values anywhere
□ Did NOT extract transaction data

Return ONLY valid JSON matching the schema. Zero hallucinations.
`;

export async function extractBankStatementProfile(fileUrl: string): Promise<any> {
  console.log(`Extracting Bank Statement Profile using Router (Gemini default)`);
  console.log(`Processing file: ${fileUrl}`);

  try {
    // Route extraction through ModelRouter
    const result: ExtractionResult = await routeExtraction('bank_statement.profile', fileUrl, BankAccountProfileSchema, EXTRACTION_INSTRUCTIONS);
    const data = result.data;
    
    // Strict Post-processing: Normalize empty strings to null
    const normalizeEmptyToNull = (value: any): any => {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed === "" || trimmed === "/" || trimmed === "/null" || trimmed === "N/A" || trimmed === "--" || trimmed.toLowerCase() === "unknown") {
          return null;
        }
        return trimmed;
      }
      return value;
    };

    // Recursive deep normalization
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
    
    // Deep normalization of empty strings to null
    const normalizedData = deepNormalize(data);

    // Runtime Validation against Zod Schema
    const validationResult = BankAccountProfileZodSchema.safeParse(normalizedData);
    
    if (!validationResult.success) {
        console.warn("Bank Statement Schema Validation Failed:", validationResult.error);
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
    logExtractorError("bank_statement_profile", fileUrl, error);
    if (error instanceof Error) {
      throw new Error(`Bank Statement Profile extraction failed: ${error.message}`);
    }
    throw error;
  }
}
