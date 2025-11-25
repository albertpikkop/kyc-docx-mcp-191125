import "dotenv/config";
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { extractWithGemini } from '../utils/geminiExtractor.js';
import { GEMINI_FLASH_MODEL } from '../modelGemini.js';
// import { CompanyIdentitySchema } from '../schemas/mx/companyIdentity.js';
import { CompanyTaxProfileSchema } from '../schemas/mx/companyTaxProfile.js';
import { IneIdentitySchema } from '../schemas/mx/ineIdentity.js'; // Use new INE schema
import { ProofOfAddressSchema } from '../schemas/mx/proofOfAddress.js';
import { BankAccountProfileSchema } from '../schemas/mx/bankAccountProfile.js';
import { buildKycProfile } from '../kyc/profileBuilder.js';
import { validateKycProfile } from '../kyc/validation.js';
import { saveRun } from '../kyc/storage.js';
import { KycRun, KycDocument, DocumentType } from '../kyc/types.js';
// import { DEMO_CONFIG } from "../core/demoConfig.js";
import { normalizeEmptyToNull, sanitizeRfc, sanitizeCurp, sanitizeClabe, sanitizeCurrency } from '../kyc/validators.js';
import { EXTRACTION_INSTRUCTIONS as INE_INSTRUCTIONS } from '../extractors/ineIdentity.js';

// --- Instructions ---
const SAT_INSTRUCTIONS = `You are a strict KYC extractor for Mexican SAT Constancias. Extract CompanyTaxProfile.
GLOBAL HARDENING RULES:
- Never infer or generate data.
- If a field is not present, set to null.
- Normalize all dates to YYYY-MM-DD.
- RFC: Extract EXACTLY as printed.`;

const CFE_INSTRUCTIONS = `You are a strict KYC extractor for Mexican CFE electricity bills. Extract ProofOfAddress.
GLOBAL HARDENING RULES:
- Never infer or generate data.
- Normalize all dates to YYYY-MM-DD.
- Convert amounts to numeric values.`;

const BANK_INSTRUCTIONS = `You are a strict KYC extractor for Mexican Bank Statements. Extract BankAccountProfile.

CRITICAL - ADDRESS EXTRACTION:
The customer's address is typically found:
1. In the header section near the account holder's name
2. In a "Datos del Cliente" or "Información del Titular" section
3. Near the top of the first page, often in smaller print
Look for labels like "Domicilio:", "Dirección:" and extract the full address.

EXTRACTION RULES:
- bank_name: The name of the bank (e.g., "Kapital", "BBVA", "Bancoppel")
- account_holder_name: The LEGAL NAME of the account holder (e.g., "ENRIQUE DE CELLO DIAZ")
  - CRITICAL: This should be the legal name, NOT an address component
  - Look for labels like "Cliente:", "Titular:", "Nombre:"
- account_number: The account number if visible
- clabe: The 18-digit CLABE interbancaria
- currency: MXN or USD
- statement_period_start/end: Dates in YYYY-MM-DD format
- address_on_statement: Extract the customer's address with all components (street, ext_number, colonia, municipio, estado, cp)

GLOBAL RULES:
- Never infer or generate data not clearly printed
- If a field is not present, set to null
- Normalize all dates to YYYY-MM-DD`;

const customerId = "enrique-cello-gemini";
const fixtureRoot = "/Users/ashishpunj/Desktop/mcp-docs/enrique-cello";

function resolveFixture(fileName: string): string {
  const fullPath = path.resolve(fixtureRoot, fileName);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Fixture not found: ${fullPath}`);
  }
  return fullPath;
}

const docs = [
  { type: "sat_constancia" as DocumentType, fileUrl: resolveFixture("Constancia de Situacion Fiscal.pdf"), instructions: SAT_INSTRUCTIONS, schema: CompanyTaxProfileSchema },
  // Using the new INE specific setup
  { type: "fm2" as DocumentType,            fileUrl: resolveFixture("INE Enrique De Cello.pdf"), instructions: INE_INSTRUCTIONS, schema: IneIdentitySchema },
  { type: "cfe" as DocumentType,            fileUrl: resolveFixture("Comprobante (1).pdf"), instructions: CFE_INSTRUCTIONS, schema: ProofOfAddressSchema },
  { type: "bank_identity_page" as DocumentType, fileUrl: resolveFixture("Octubre_E.pdf"), instructions: BANK_INSTRUCTIONS, schema: BankAccountProfileSchema }
];

async function main() {
  console.log(`Starting Gemini KYC Run for customer: ${customerId} (Updated with INE Extractor)`);
  
  const kycDocuments: KycDocument[] = [];
  
  let companyIdentity;
  let companyTaxProfile;
  let representativeIdentity;
  const proofsOfAddress: any[] = [];
  const bankAccounts: any[] = []; 

  for (const doc of docs) {
    console.log(`Processing ${doc.type} with Gemini - ${doc.fileUrl}...`);
    let extractedPayload: any = null;
    
    try {
        // Use Flash model for all docs in this Persona Física run
        const modelToUse = GEMINI_FLASH_MODEL;
        console.log(`   Using model: ${modelToUse}`);

        const mimeType = "application/pdf"; 
        const rawData = await extractWithGemini(doc.fileUrl, mimeType, doc.schema, doc.instructions, modelToUse);
        
        extractedPayload = normalizeEmptyToNull(rawData);

        if (doc.type === 'sat_constancia') {
            const profile = extractedPayload.company_tax_profile || extractedPayload;
            if (profile.rfc) profile.rfc = sanitizeRfc(profile.rfc);
            if (profile.fiscal_address) profile.fiscal_address.country = "MX";
            extractedPayload = profile;
            companyTaxProfile = extractedPayload;
        } else if (doc.type === 'fm2') {
            // Handle INE payload mapping to ImmigrationProfile structure for compatibility
            // The extractor returns IneIdentitySchema, we need to map it to ImmigrationProfileSchema structure
            // used by the rest of the system until we fully refactor for generic "IdentityDocument"
            const ineData = extractedPayload;
            const profile = {
                full_name: ineData.full_name,
                nationality: "MEXICANA", // INE implies Mexican citizenship usually
                document_type: "INE",
                document_number: ineData.cic || ineData.ocr_number || ineData.clave_elector, // Prioritize CIC
                secondary_number: ineData.clave_elector,
                date_of_birth: ineData.date_of_birth,
                curp: sanitizeCurp(ineData.curp),
                sex: ineData.sex === 'H' ? 'Hombre' : (ineData.sex === 'M' ? 'Mujer' : ineData.sex),
                issue_date: ineData.emission_year ? `${ineData.emission_year}-01-01` : null, // Approximate if only year
                expiry_date: ineData.vigencia_year ? `${ineData.vigencia_year}-12-31` : null,
                issuing_office: "INE",
                issuer_country: "MX"
            };
            extractedPayload = profile;
            representativeIdentity = extractedPayload;
        } else if (doc.type === 'cfe') {
             const proof = extractedPayload.proof_of_address || extractedPayload;
             if (!proof.document_type) proof.document_type = 'cfe_receipt';
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
      try {
          const { exec } = await import('child_process');
          const { promisify } = await import('util');
          const execAsync = promisify(exec);
          await execAsync(`open "${reportUrl}"`);
      } catch (error) {
          console.log(`\n💡 Tip: Copy and paste this URL into your browser.`);
      }
  }
}

main().catch(console.error);
