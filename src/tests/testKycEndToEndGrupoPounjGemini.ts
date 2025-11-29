import "dotenv/config";
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { extractWithGemini } from '../utils/geminiExtractor.js';
import { GEMINI_PRO_MODEL, GEMINI_FLASH_MODEL } from '../modelGemini.js';
import { CompanyIdentitySchema } from '../schemas/mx/companyIdentity.js';
import { CompanyTaxProfileSchema } from '../schemas/mx/companyTaxProfile.js';
import { PassportIdentitySchema } from '../schemas/mx/passportIdentity.js';
import { ImmigrationProfileSchema } from '../schemas/mx/immigrationProfile.js';
import { ProofOfAddressSchema } from '../schemas/mx/proofOfAddress.js';
import { BankAccountProfileSchema } from '../schemas/mx/bankAccountProfile.js';
import { buildKycProfile } from '../kyc/profileBuilder.js';
import { validateKycProfile } from '../kyc/validation.js';
import { saveRun } from '../kyc/storage.js';
import { KycRun, KycDocument, DocumentType, PassportIdentity } from '../kyc/types.js';
// import { DEMO_CONFIG } from "../core/demoConfig.js";
import { normalizeEmptyToNull, sanitizeRfc, sanitizeCurp, sanitizeClabe, sanitizeCurrency } from '../kyc/validators.js';

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

1. SHAREHOLDERS (CRITICAL FOR UBO CALCULATION):
   - Extract full names of initial shareholders (socios/accionistas).
   - Extract number of shares and percentage of ownership (calculate only if explicitly clear from the text).
   - Use 0-100 scale for percentages (e.g. 60 = 60%, 0.5 = 0.5%). Never use 0-1 scale (decimals).
   - Identify beneficial owners (usually >25% or control).
   
   - SHARE CLASSIFICATION (CRITICAL FOR VOTING RIGHTS):
     * share_series: Extract the series/type (e.g., "Serie A", "Serie B", "Serie I", "Serie II")
     * share_class: Extract capital type: "FIJO" (Fixed Capital) or "VARIABLE" (Variable Capital)
     * share_type: Classify as "ORDINARIAS" (ordinary shares) or "PREFERENTES" (preferred shares)
     * has_voting_rights: 
       - TRUE for ordinary shares (Serie A, Serie I) - these have voting rights in assemblies
       - FALSE for preferred shares (Serie B, Serie II) - these typically have NO voting rights but priority in dividends
       - Look for explicit statements like "sin derecho a voto" or "con voto limitado"
   
   - LEGAL NOTE: Under Mexican LGSM (Ley General de Sociedades Mercantiles):
     * Acciones Ordinarias (Serie A) = full voting rights
     * Acciones Preferentes (Serie B) = typically NO voting rights, but priority in dividends
     * This distinction is CRITICAL for UBO calculation - only VOTING shares count for control (>25%).

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

6. FOUNDING ADDRESS (DOMICILIO SOCIAL - HISTORICAL):
   - Extract the corporate domicile (domicilio social) mentioned in the deed as founding_address.
   - IMPORTANT LEGAL DISTINCTION (per Mexican corporate law):
     * DOMICILIO SOCIAL = The jurisdiction (entidad federativa) stated in the Acta Constitutiva where shareholder assemblies are held
     * DOMICILIO FISCAL = The tax address registered with SAT (may be different from Domicilio Social)
     * These addresses do NOT need to match - this is legally permissible
   - This is a HISTORICAL address from incorporation. Do NOT label it as current.
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

const FM2_INSTRUCTIONS = `You are a strict KYC extractor for Mexican immigration documents (FM2/FM3/Tarjeta de Residente).
Extract ImmigrationProfile from the document.

CRITICAL FIELDS TO EXTRACT:
- full_name: Complete name as printed on the card
- nationality: Country of origin (e.g., "INDIA", "USA", "FRANCIA")
- document_type: Type of document (FM2, FM3, RESIDENTE TEMPORAL, RESIDENTE PERMANENTE)
- document_number: The primary document/card number
- date_of_birth: In YYYY-MM-DD format
- curp: Mexican CURP if present (18 characters)
- sex: M or F
- issue_date: When the card was issued (YYYY-MM-DD)
- expiry_date: When the card expires (YYYY-MM-DD)
- issuing_office: INM office that issued (e.g., "CDMX", "GUADALAJARA")
- issuer_country: Always "MX" for Mexican immigration documents

GLOBAL RULES:
- Never infer or generate data not clearly printed
- If a field is not visible, set to null
- Normalize all dates to YYYY-MM-DD`;

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

// PASSPORT EXTRACTION INSTRUCTIONS
const PASSPORT_INSTRUCTIONS = `You are a strict KYC extractor for Passports (Mexican or foreign).
Your job is to extract identity information from the passport image.

CRITICAL: This is a PASSPORT document. Look for:
1. The DATA PAGE (page with photo, name, passport number)
2. Machine Readable Zone (MRZ) at the bottom - two lines of text with <<< characters

EXTRACTION RULES:
- full_name: Extract SURNAME (Apellidos) + GIVEN NAMES (Nombres) as printed
  - Usually in format "SURNAME / GIVEN NAMES" or separate fields
- nationality: The nationality printed (e.g., "MEXICANA", "INDIA", "AMERICAN")
- document_type: Always "PASSPORT" or "PASAPORTE"
- document_number: The passport number (alphanumeric, usually 8-9 characters)
  - Look for "Passport No." or "No. de Pasaporte"
- date_of_birth: Date of birth in YYYY-MM-DD format
- sex: M/F or H/M (Hombre/Mujer for Mexican)
- place_of_birth: City/State/Country of birth
- issue_date: Date passport was issued (YYYY-MM-DD)
- expiry_date: Date passport expires (YYYY-MM-DD)
- issuing_authority: Who issued it (e.g., "SRE" for Mexican passports)
- issuer_country: Country code (MX, US, IN, etc.)
- mrz_line_1: First line of MRZ if visible (starts with P<)
- mrz_line_2: Second line of MRZ if visible
- curp: CURP if present (Mexican passports only, 18 characters)

IMPORTANT:
- If this is the BACKSIDE of a passport, you may only see partial data or MRZ
- Extract whatever is visible
- Never infer or fabricate data
- If a field is not visible, set to null`;

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
// Complete KYC package for Alta de Proveedor (Persona Moral) - Foreign Representative
// Documents:
//   1. Acta Constitutiva - Corporate identity, shareholders, legal representatives
//   2. Constancia SAT - Tax registration, RFC, fiscal address
//   3. Pasaporte del Representante Legal - Primary identity (foreign national)
//   4. FM2/Tarjeta de Residente - Immigration status (required for foreigners)
//   5. Comprobante de Domicilio (CFE) - Operational address
//   6. Estado de Cuenta Bancario - Bank identity for payment setup
const docs = [
  { type: "acta" as DocumentType,           fileUrl: resolveFixture("Acta_Constitutiva_grupo-pounj.pdf"), instructions: ACTA_INSTRUCTIONS, schema: CompanyIdentitySchema },
  { type: "sat_constancia" as DocumentType, fileUrl: resolveFixture("SAT_Constancia_grupo-pounj.pdf"), instructions: SAT_INSTRUCTIONS, schema: CompanyTaxProfileSchema },
  { type: "passport" as DocumentType,       fileUrl: resolveFixture("Passport_Front_Ashish_Punj_grupo-pounj.jpeg"), instructions: PASSPORT_INSTRUCTIONS, schema: PassportIdentitySchema },
  { type: "fm2" as DocumentType,            fileUrl: resolveFixture("FM2_grupo-pounj.pdf"), instructions: FM2_INSTRUCTIONS, schema: ImmigrationProfileSchema },
  { type: "cfe" as DocumentType,            fileUrl: resolveFixture("CFE_Recibo_grupo-pounj_Octubre_2025.pdf"), instructions: CFE_INSTRUCTIONS, schema: ProofOfAddressSchema },
  { type: "bank_identity_page" as DocumentType, fileUrl: resolveFixture("Bank_Estado_Cuenta_grupo-pounj_Octubre_2025.pdf"), instructions: BANK_INSTRUCTIONS, schema: BankAccountProfileSchema }
];

async function main() {
  const startTime = Date.now(); // Track processing time for transparency
  console.log(`Starting Gemini KYC Run for customer: ${customerId}`);
  
  const kycDocuments: KycDocument[] = [];
  
  let companyIdentity;
  let companyTaxProfile;
  let representativeIdentity;  // FM2/INE - Immigration document
  let passportIdentity: PassportIdentity | undefined;  // Passport - Primary identity for foreigners
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
        const ext = doc.fileUrl.toLowerCase().split('.').pop();
        let mimeType = "application/pdf";
        if (ext === 'jpg' || ext === 'jpeg') mimeType = "image/jpeg";
        else if (ext === 'png') mimeType = "image/png";
        else if (ext === 'gif') mimeType = "image/gif";
        else if (ext === 'webp') mimeType = "image/webp";
        
        console.log(`   Mime type: ${mimeType}`);
        const rawData = await extractWithGemini(doc.fileUrl, mimeType, doc.schema, doc.instructions, modelToUse);
        
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
        } else if (doc.type === 'fm2' || doc.type === 'ine') {
            const profile = extractedPayload.immigration_profile || extractedPayload;
            if (profile.issuer_country === "MEXICO" || profile.issuer_country === "MEX") profile.issuer_country = "MX";
            if (profile.curp) profile.curp = sanitizeCurp(profile.curp);
            
            // CRITICAL: Reclassify document based on characteristics
            // Post-2012 documents without expiry are Residente Permanente (not FM2)
            if (doc.type === 'fm2') {
              const docTypeExtracted = (profile.document_type || '').toUpperCase();
              const issueDate = profile.issue_date;
              const expiryDate = profile.expiry_date;
              const issueYear = issueDate ? new Date(issueDate).getFullYear() : 0;
              
              if (docTypeExtracted.includes('FM2') || !profile.document_type) {
                if (issueYear >= 2012 && !expiryDate) {
                  profile.document_type = 'RESIDENTE PERMANENTE';
                  console.log('📋 Document reclassified: FM2 → RESIDENTE PERMANENTE (post-2012, no expiry = permanent)');
                } else if (issueYear >= 2012 && expiryDate) {
                  profile.document_type = 'RESIDENTE TEMPORAL';
                  console.log('📋 Document reclassified: FM2 → RESIDENTE TEMPORAL (post-2012, has expiry)');
                } else {
                  profile.document_type = 'FM2'; // Legacy FM2
                }
              }
            } else if (doc.type === 'ine') {
              profile.document_type = 'INE';
            }
            
            extractedPayload = profile;
            representativeIdentity = extractedPayload;
        } else if (doc.type === 'passport') {
            // Passport identity - stored separately from FM2/INE
            const passport = extractedPayload.passport_identity || extractedPayload;
            if (passport.issuer_country === "MEXICO" || passport.issuer_country === "MEX") passport.issuer_country = "MX";
            if (passport.curp) passport.curp = sanitizeCurp(passport.curp);
            // Store passport in its own field (not representativeIdentity)
            passportIdentity = {
                full_name: passport.full_name,
                nationality: passport.nationality,
                document_type: "PASAPORTE" as const,
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

  const processingTimeMs = Date.now() - startTime;
  const estimatedCostUsd = 0.51; // Approximate cost per run (6 docs including Acta)

  const run: KycRun = {
    runId: crypto.randomUUID(),
    customerId,
    createdAt: new Date().toISOString(),
    documents: kycDocuments,
    profile,
    validation,
    // Transparency metrics for investors
    processingTimeMs,
    estimatedCostUsd,
    aiModel: 'Gemini 2.5 Pro/Flash'
  };

  console.log("Saving Run and Generating Report...");
  console.log(`⏱️  Processing time: ${(processingTimeMs / 1000).toFixed(1)}s | 💰 Est. cost: $${estimatedCostUsd.toFixed(2)}`);
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

