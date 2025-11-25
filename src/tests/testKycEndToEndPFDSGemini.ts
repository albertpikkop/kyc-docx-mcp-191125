import "dotenv/config";
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { extractWithGemini } from '../utils/geminiExtractor.js';
import { GEMINI_PRO_MODEL, GEMINI_FLASH_MODEL } from '../modelGemini.js';
import { CompanyIdentitySchema } from '../schemas/mx/companyIdentity.js';
import { CompanyTaxProfileSchema } from '../schemas/mx/companyTaxProfile.js';
import { ImmigrationProfileSchema } from '../schemas/mx/immigrationProfile.js';
import { PassportIdentitySchema } from '../schemas/mx/passportIdentity.js';
import { ProofOfAddressSchema } from '../schemas/mx/proofOfAddress.js';
import { BankAccountProfileSchema } from '../schemas/mx/bankAccountProfile.js';
import { buildKycProfile } from '../kyc/profileBuilder.js';
import { validateKycProfile } from '../kyc/validation.js';
import { saveRun } from '../kyc/storage.js';
import { KycRun, KycDocument, DocumentType, PassportIdentity } from '../kyc/types.js';
import { normalizeEmptyToNull, sanitizeRfc, sanitizeCurp, sanitizeClabe, sanitizeCurrency } from '../kyc/validators.js';

// Instructions (Simplified for brevity, using same as Grupo Pounj mostly)
const ACTA_INSTRUCTIONS = `
You are a strict KYC extractor for Mexican Acta Constitutiva (Incorporation Deeds).
Extract CompanyIdentitySchema accurately using ONLY printed info.
Normalize dates to YYYY-MM-DD.
EXTRACT: Shareholders (names, %), Corporate Purpose, Notary Info, Registry Info (Folio), Legal Representatives (names, roles, specific powers).
CRITICAL: Distinguish between "Shareholders", "Board Members", and "Apoderados" (Legal Reps).
`;

const SAT_INSTRUCTIONS = `You are a strict KYC extractor for Mexican SAT Constancias. Extract CompanyTaxProfile.
Normalize dates YYYY-MM-DD. RFC must be exact. Extract fiscal address and economic activities.`;

const FM2_INSTRUCTIONS = `You are a strict KYC extractor for Mexican immigration cards (FM2). Extract ImmigrationProfile.
Normalize dates YYYY-MM-DD.`;

const PASSPORT_INSTRUCTIONS = `You are a strict KYC extractor for Passports. Extract PassportIdentity.

CRITICAL EXTRACTION FIELDS:
- full_name: Complete name as printed on passport
- nationality: Nationality as printed (e.g., "INDIAN", "MEXICAN", "AMERICAN")
- document_type: Always "PASSPORT" or "PASAPORTE"
- document_number: Passport number (alphanumeric)
- date_of_birth: YYYY-MM-DD format
- sex: "M" or "F"
- place_of_birth: City/State/Country of birth if visible
- issue_date: YYYY-MM-DD format
- expiry_date: YYYY-MM-DD format
- issuing_authority: Authority that issued the passport
- issuer_country: 3-letter ISO code (e.g., "IND", "MEX", "USA")
- mrz_line_1: First line of Machine Readable Zone if visible
- mrz_line_2: Second line of Machine Readable Zone if visible

GLOBAL RULES:
- Extract ONLY from the front/data page of the passport
- Never infer or generate data not clearly printed
- If a field is not present, set to null
- Normalize all dates to YYYY-MM-DD`;

const CFE_INSTRUCTIONS = `You are a strict KYC extractor for Mexican CFE/Telmex bills. Extract ProofOfAddress.
Normalize dates YYYY-MM-DD. Convert amounts to numeric.`;

const BANK_INSTRUCTIONS = `You are a strict KYC extractor for Mexican Bank Statements. Extract BankAccountProfile.

CRITICAL - ADDRESS EXTRACTION:
The customer's address is typically found:
1. In the header section near the account holder's name
2. In a "Datos del Cliente" or "Información del Titular" section
3. Near the top of the first page, often in smaller print
Look for labels like "Domicilio:", "Dirección:" and extract the full address.

EXTRACTION RULES:
- bank_name: The name of the bank (e.g., "Kapital", "BBVA", "Santander")
- account_holder_name: The LEGAL NAME of the account holder (e.g., "PFDS", "Juan Perez")
  - CRITICAL: This should be the legal name, NOT an address component
  - Look for labels like "Cliente:", "Titular:", "Nombre:", "Razón Social:"
- account_number: The account number if visible
- clabe: The 18-digit CLABE interbancaria
- currency: MXN or USD
- statement_period_start/end: Dates in YYYY-MM-DD format
- address_on_statement: Extract the customer's address with all components (street, ext_number, colonia, municipio, estado, cp)

GLOBAL RULES:
- Never infer or generate data not clearly printed
- If a field is not present, set to null
- Normalize all dates to YYYY-MM-DD`;

const customerId = "pfds-gemini";
const fixtureRoot = "/Users/ashishpunj/Desktop/mcp-docs/pfds";

function resolveFixture(fileName: string): string {
  const fullPath = path.resolve(fixtureRoot, fileName);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Fixture not found: ${fullPath}`);
  }
  return fullPath;
}

const docs = [
  { type: "acta" as DocumentType,           fileUrl: resolveFixture("Acta_Constitutiva_PFDS_SAPI.pdf"), instructions: ACTA_INSTRUCTIONS, schema: CompanyIdentitySchema },
  { type: "sat_constancia" as DocumentType, fileUrl: resolveFixture("Constancia_PFDS.pdf"), instructions: SAT_INSTRUCTIONS, schema: CompanyTaxProfileSchema },
  { type: "passport" as DocumentType,       fileUrl: resolveFixture("New passport - Sep 18 2018 - 12-33 PM - p1 copy.jpeg"), instructions: PASSPORT_INSTRUCTIONS, schema: PassportIdentitySchema },
  { type: "fm2" as DocumentType,            fileUrl: resolveFixture("FM2 (1).pdf"), instructions: FM2_INSTRUCTIONS, schema: ImmigrationProfileSchema },
  { type: "telmex" as DocumentType,         fileUrl: resolveFixture("Recibo-Oct (2).pdf"), instructions: CFE_INSTRUCTIONS, schema: ProofOfAddressSchema },
  { type: "bank_identity_page" as DocumentType, fileUrl: resolveFixture("Esatdo_De_Cuenta_Octubre_2025.pdf"), instructions: BANK_INSTRUCTIONS, schema: BankAccountProfileSchema }
];

async function main() {
  console.log(`Starting Gemini KYC Run for customer: ${customerId}`);
  
  const kycDocuments: KycDocument[] = [];
  
  let companyIdentity;
  let companyTaxProfile;
  let representativeIdentity;
  let passportIdentity: PassportIdentity | undefined;
  const proofsOfAddress: any[] = [];
  const bankAccounts: any[] = []; 

  for (const doc of docs) {
    console.log(`Processing ${doc.type} with Gemini - ${doc.fileUrl}...`);
    let extractedPayload: any = null;
    
    try {
        // Hybrid Model Selection
        // Use Pro for complex legal docs (Acta), Flash for standard docs
        const modelToUse = doc.type === 'acta' ? GEMINI_PRO_MODEL : GEMINI_FLASH_MODEL;
        console.log(`   Using model: ${modelToUse}`);

        // Detect mime type based on file extension
        const fileExt = path.extname(doc.fileUrl).toLowerCase();
        const mimeType = fileExt === '.jpeg' || fileExt === '.jpg' ? 'image/jpeg' : 
                         fileExt === '.png' ? 'image/png' : 'application/pdf';
        console.log(`   Mime type: ${mimeType}`);
        
        const rawData = await extractWithGemini(doc.fileUrl, mimeType, doc.schema, doc.instructions, modelToUse);
        
        extractedPayload = normalizeEmptyToNull(rawData);

        if (doc.type === 'acta') {
             const identity = extractedPayload.company_identity || extractedPayload;
             if (identity.founding_address) identity.founding_address.country = "MX";
             extractedPayload = identity;
             companyIdentity = extractedPayload;
        } else if (doc.type === 'sat_constancia') {
            const profile = extractedPayload.company_tax_profile || extractedPayload;
            if (profile.rfc) profile.rfc = sanitizeRfc(profile.rfc);
            if (profile.fiscal_address) profile.fiscal_address.country = "MX";
            extractedPayload = profile;
            companyTaxProfile = extractedPayload;
        } else if (doc.type === 'passport') {
            const passport = extractedPayload.passport_identity || extractedPayload;
            // Map to PassportIdentity type
            passportIdentity = {
                full_name: passport.full_name,
                nationality: passport.nationality,
                document_type: "PASAPORTE",
                document_number: passport.document_number,
                date_of_birth: passport.date_of_birth,
                sex: passport.sex,
                place_of_birth: passport.place_of_birth || null,
                issue_date: passport.issue_date,
                expiry_date: passport.expiry_date,
                issuing_authority: passport.issuing_authority || null,
                issuer_country: passport.issuer_country || null,
                mrz_line_1: passport.mrz_line_1 || null,
                mrz_line_2: passport.mrz_line_2 || null,
                curp: passport.curp || null
            };
            extractedPayload = passportIdentity;
        } else if (doc.type === 'fm2') {
            const profile = extractedPayload.immigration_profile || extractedPayload;
            if (profile.issuer_country === "MEXICO" || profile.issuer_country === "MEX") profile.issuer_country = "MX";
            if (profile.curp) profile.curp = sanitizeCurp(profile.curp);
            profile.document_type = "FM2"; // Ensure correct document type
            extractedPayload = profile;
            representativeIdentity = extractedPayload;
        } else if (doc.type === 'telmex' || doc.type === 'cfe') {
             const proof = extractedPayload.proof_of_address || extractedPayload;
             if (!proof.document_type) proof.document_type = doc.type === 'telmex' ? 'telmex_bill' : 'cfe_receipt';
             if (proof.client_address) proof.client_address.country = "MX";
             if (proof.vendor_address) proof.vendor_address.country = "MX";
             if (proof.vendor_tax_id) proof.vendor_tax_id = sanitizeRfc(proof.vendor_tax_id);
             if (proof.currency) proof.currency = sanitizeCurrency(proof.currency);
             proof.evidence_meta = { issuer_country: "MX", original_filename: path.basename(doc.fileUrl), pages: 1 };
             extractedPayload = proof;
             proofsOfAddress.push(extractedPayload);
        } else if (doc.type === 'bank_identity_page') {
            const profile = extractedPayload.bank_account_profile || extractedPayload;
            if (profile.address_on_statement) profile.address_on_statement.country = "MX";
            if (profile.clabe) profile.clabe = sanitizeClabe(profile.clabe);
            if (profile.currency) profile.currency = sanitizeCurrency(profile.currency);
            extractedPayload = profile;
            bankAccounts.push(extractedPayload);
        }

      kycDocuments.push({
        id: crypto.randomUUID(),
        customerId,
        type: doc.type,
        fileUrl: doc.fileUrl,
        extractedAt: new Date().toISOString(),
        extractedPayload,
        sourceName: path.basename(doc.fileUrl)
      });

    } catch (error) {
      console.error(`Failed to process ${doc.type}:`, error);
    }
  }

  console.log("Building KYC Profile...");
  const profile = buildKycProfile({
    customerId,
    companyIdentity,
    companyTaxProfile,
    representativeIdentity,
    passportIdentity,
    proofsOfAddress,
    bankAccounts
  });

  console.log("Validating KYC Profile...");
  const validation = validateKycProfile(profile);

  const run: KycRun = {
    runId: crypto.randomUUID(),
    customerId,
    createdAt: new Date().toISOString(),
    documents: kycDocuments,
    profile,
    validation
  };

  console.log("Saving Run and Generating Report...");
  const reportUrl = await saveRun(run);
  
  if (reportUrl) {
      console.log(`\n✅ Visual Report Generated!`);
      console.log(`📄 Report URL: ${reportUrl}`);
  }
}

main().catch(console.error);

