import "dotenv/config";
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { extractWithGemini } from '../utils/geminiExtractor.js';
import { CompanyIdentitySchema } from '../schemas/mx/companyIdentity.js';
import { CompanyTaxProfileSchema } from '../schemas/mx/companyTaxProfile.js';
import { ImmigrationProfileSchema } from '../schemas/mx/immigrationProfile.js';
import { ProofOfAddressSchema } from '../schemas/mx/proofOfAddress.js';
import { BankAccountProfileSchema } from '../schemas/mx/bankAccountProfile.js';
import { buildKycProfile } from '../kyc/profileBuilder.js';
import { validateKycProfile } from '../kyc/validation.js';
import { saveRun } from '../kyc/storage.js';
import { KycRun, KycDocument, DocumentType } from '../kyc/types.js';
import { DEMO_CONFIG } from "../core/demoConfig.js";
import { normalizeEmptyToNull, sanitizeRfc, sanitizeCurp, sanitizeClabe, sanitizeCurrency, sanitizeInvoiceNumber } from '../kyc/validators.js';

// --- Instructions (Copies from extractors with enhancements) ---
// UPGRADED: Using the full, detailed prompt for Acta
const ACTA_INSTRUCTIONS = `
You are a strict KYC extractor for Mexican Acta Constitutiva (Incorporation Deeds).
Your job is to fill the CompanyIdentitySchema accurately using ONLY the information explicitly printed in the document.

GLOBAL HARDENING RULES:
- Never infer or generate data not clearly printed.
- If a field is not present, set to null. Do NOT use "N/A", "Unknown", "--", or empty strings.
- Normalize all dates to YYYY-MM-DD.
- RFC must remain null unless strictly printed inside the Acta. Do NOT invent it.

EXTRACT THE FOLLOWING DEEP KYC DATA:

1. SHAREHOLDERS:
   - Extract full names of initial shareholders (socios/accionistas).
   - Extract number of shares and percentage of ownership (calculate only if explicitly clear from the text).
   - Use 0-100 scale for percentages (e.g. 60 = 60%, 0.5 = 0.5%). Never use 0-1 scale (decimals).
   - Identify beneficial owners (usually >25% or control).
   - Capture share class (e.g., "Serie A", "Capital Fijo").

2. CORPORATE PURPOSE (Objeto Social):
   - Extract the list of business activities allowed as individual items.
   - Do not dump free-form text; separate into clear activities.

3. NOTARY INFORMATION:
   - Notary name, notary number, protocol number (Escritura No.), protocol date (YYYY-MM-DD), and office location.

4. PUBLIC REGISTRY OF COMMERCE (RPC):
   - Extract structured data: FME, NCI, Unique Doc Number, Registration City, Registration Date.
   - Do not guess; if a field is missing, return null.

5. REPRESENTATION POWERS:
   - CRITICAL: Distinguish between three separate concepts:
     a) Socios/Accionistas (shareholders/owners) - NO powers unless also listed as Apoderados
     b) Consejo de Administración (governing board) - may have powers as a body, but individual members need explicit apoderado designation
     c) Apoderados (legal representatives with powers) - these are the ones who can sign contracts
   
   - Extract legal representatives with STRICT authority analysis:
   - can_sign_contracts: TRUE ONLY if the person is explicitly designated as "Apoderado" (general or special) AND explicit powers are granted in their clause.
   - If someone is ONLY listed as "Secretario", "Comisario", "Vocal", or "Consejo" WITHOUT an explicit "Apoderado" designation, set can_sign_contracts to FALSE.
   
   - CRITICAL MULTI-PAGE POWER EXTRACTION:
     * Powers for each apoderado may be spread across MULTIPLE PAGES or separated by line breaks.
     * You MUST scan the ENTIRE main Notarial Instrument (all pages before annexes) to find ALL power phrases that belong to the SAME apoderado clause.
     * An apoderado clause typically starts with "Se otorga poder a [Name]" or "[Name] queda facultado" or "Se faculta a [Name]" and continues until:
       - The next apoderado clause begins (e.g., "Se otorga poder a [Another Name]"), OR
       - A section break (e.g., "ARTÍCULO", "CAPÍTULO"), OR
       - The end of the powers section, OR
       - The start of annexes (Secretaría de Economía, RPP, SAT)
     * CRITICAL: You MUST search for ALL FOUR canonical powers for EACH apoderado, even if they appear on different pages:
       - "Pleitos y Cobranzas" or "pleitos y cobranzas" (may also appear as "Poder general para pleitos y cobranzas")
       - "Actos de Administración" or "actos de administración" (may appear as "Poder general para actos de administración" or "facultades de administración")
       - "Actos de Dominio" or "actos de dominio" (may appear as "Poder general para actos de dominio" or "facultades de dominio")
       - "Títulos de Crédito" or "títulos de crédito" (may appear as "Poder para otorgar y suscribir títulos de crédito" or "facultad para títulos de crédito")
     * These four canonical powers are ESSENTIAL - if ANY apoderado has all four, they have FULL powers.
     * DO NOT stop scanning after finding 1-2 powers - continue reading ALL pages until you have found all four canonical powers OR reached the end of that apoderado's clause.
     * If powers are listed in a bulleted format, numbered lists, or separated by commas/semicolons across pages, include ALL of them.
     * Also collect any other specific powers mentioned (e.g., "gestiones fiscales", "apertura de cuentas bancarias", "representación laboral", "otorgar poderes")
   
   - poder_scope: List ALL powers granted in the Acta clause for THIS person, combining phrases from all pages:
     * Include every power phrase you find, even if they appear on different pages
     * Use the exact wording from the Acta (e.g., "Pleitos y cobranzas", "Actos de administración", "Actos de dominio", "Títulos de crédito")
     * If the same power is mentioned multiple times, include it once
     * If powers are listed as "Poder general para..." followed by specific items, include both the general phrase and the specific items
   
   - IMPORTANT: If the Acta explicitly labels someone as "apoderado especial" or "apoderado limitado", include that label in poder_scope.
   - If the Acta labels someone as "apoderado general" AND grants all four canonical powers (even if spread across pages), include all four in poder_scope.
   - joint_signature_required: Check if powers must be exercised jointly ("mancomunadamente") or individually ("indistintamente"). Set to null if not specified.

6. FOUNDING ADDRESS (HISTORICAL ONLY):
   - Extract the corporate domicile (domicilio social) mentioned in the deed as founding_address.
   - This is a HISTORICAL address. Do NOT label it as current.
   - CRITICAL: If the Acta only specifies a jurisdiction (e.g., "Ciudad de México") without street-level details:
     * Set street, ext_number, int_number, colonia, and cp to null
     * Only populate municipio and estado if explicitly stated
   - If the Acta provides a full street address, extract all components.
   - Set country to "MX".
   - Use null for missing components. Do NOT use "/null" or "N/A" strings.

7. GOVERNANCE:
   - Board type: "Administrador Único" or "Consejo de Administración".
   - Quorum/Voting: Summarize rules if stated.
   - Share transfer: Summarize restrictions (e.g., "derecho de tanto").

8. MODIFICATIONS:
   - List any capital changes, management changes, or bylaws amendments mentioned in the document.

Do not invent information. Return strictly valid JSON matching the schema.
`;

const SAT_INSTRUCTIONS = `You are a strict KYC extractor for Mexican SAT Constancias. Extract CompanyTaxProfile.
GLOBAL HARDENING RULES:
- Never infer or generate data.
- If a field is not present, set to null.
- Normalize all dates to YYYY-MM-DD.
- RFC: Extract EXACTLY as printed.`;

const FM2_INSTRUCTIONS = `You are a strict KYC extractor for Mexican immigration cards (FM2). Extract ImmigrationProfile.
GLOBAL HARDENING RULES:
- Never infer or generate data.
- Normalize all dates to YYYY-MM-DD.
- Document Number: PRIMARY number on front.`;

const CFE_INSTRUCTIONS = `You are a strict KYC extractor for Mexican CFE electricity bills. Extract ProofOfAddress.
GLOBAL HARDENING RULES:
- Never infer or generate data.
- Normalize all dates to YYYY-MM-DD.
- Convert amounts to numeric values.`;

const BANK_INSTRUCTIONS = `You are a strict KYC extractor for Mexican Bank Statements. Extract BankAccountProfile.
GLOBAL HARDENING RULES:
- Never infer or generate data.
- Normalize all dates to YYYY-MM-DD.
- Never invent account numbers.`;

const customerId = "grupo-pounj-gemini";
const fixtureRoot = "/Users/ashishpunj/Desktop/mcp-docs/grupo-pounj";

function resolveFixture(fileName: string): string {
  const fullPath = path.resolve(fixtureRoot, fileName);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Fixture not found: ${fullPath}`);
  }
  return fullPath;
}

// Grupo Pounj Document Set for Gemini
const docs = [
  { type: "acta" as DocumentType,           fileUrl: resolveFixture("1. Acta Grupo Pounj.pdf"), instructions: ACTA_INSTRUCTIONS, schema: CompanyIdentitySchema },
  { type: "sat_constancia" as DocumentType, fileUrl: resolveFixture("2. Constancia_GPO.pdf"), instructions: SAT_INSTRUCTIONS, schema: CompanyTaxProfileSchema },
  { type: "fm2" as DocumentType,            fileUrl: resolveFixture("3. FM2 .pdf"), instructions: FM2_INSTRUCTIONS, schema: ImmigrationProfileSchema },
  { type: "cfe" as DocumentType,            fileUrl: resolveFixture("CFE_OCTUBRE.pdf"), instructions: CFE_INSTRUCTIONS, schema: ProofOfAddressSchema },
  { type: "bank_identity_page" as DocumentType, fileUrl: resolveFixture("October 2025.pdf"), instructions: BANK_INSTRUCTIONS, schema: BankAccountProfileSchema }
];

async function main() {
  console.log(`Starting Gemini KYC Run for customer: ${customerId}`);
  
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
        // Assume PDF for now, can detect mime type if needed
        const mimeType = "application/pdf"; 
        const rawData = await extractWithGemini(doc.fileUrl, mimeType, doc.schema, doc.instructions);
        
        // Normalization & Sanitization logic (replicated from extractors)
        extractedPayload = normalizeEmptyToNull(rawData);

        if (doc.type === 'acta') {
             const identity = extractedPayload.company_identity || extractedPayload;
             // Basic post-processing for acta
             if (identity.founding_address) identity.founding_address.country = "MX";
             // Recalculate equity if needed (simplified version of OpenAI extractor logic)
             if (Array.isArray(identity.shareholders)) {
                let totalShares = 0;
                identity.shareholders.forEach((s: any) => { if(typeof s.shares === 'number') totalShares += s.shares; });
                 if (totalShares > 0) {
                     identity.shareholders = identity.shareholders.map((s: any) => ({
                         ...s,
                         percentage: typeof s.shares === 'number' ? parseFloat(((s.shares / totalShares) * 100).toFixed(2)) : s.percentage
                     }));
                 }
             }
             extractedPayload = identity;
             companyIdentity = extractedPayload;
        } else if (doc.type === 'sat_constancia') {
            const profile = extractedPayload.company_tax_profile || extractedPayload;
            if (profile.rfc) profile.rfc = sanitizeRfc(profile.rfc);
            if (profile.fiscal_address) profile.fiscal_address.country = "MX";
            extractedPayload = profile;
            companyTaxProfile = extractedPayload;
        } else if (doc.type === 'fm2') {
            const profile = extractedPayload.immigration_profile || extractedPayload;
            if (profile.issuer_country === "MEXICO" || profile.issuer_country === "MEX") profile.issuer_country = "MX";
             if (profile.curp) profile.curp = sanitizeCurp(profile.curp);
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

