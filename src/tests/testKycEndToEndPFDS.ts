import "dotenv/config";
import { extractCompanyIdentity } from "../extractors/actaCompanyIdentity.js";
import { extractCompanyTaxProfile } from "../extractors/companyTaxProfileExtractor.js";
import { extractImmigrationProfile } from "../extractors/fm2Immigration.js";
import { extractTelmexProofOfAddress } from "../extractors/telmexProofOfAddress.js";
import { extractCfeProofOfAddress } from "../extractors/cfeProofOfAddress.js";
import { extractBankStatementProfile } from "../extractors/bankStatementProfile.js";
import { extractBankStatementTransactions } from "../extractors/bankStatementTransactions.js";
import { buildKycProfile } from "../kyc/profileBuilder.js";
import { validateKycProfile, resolveUbo, resolveSignatories, checkFreshness } from "../kyc/validation.js";
import { saveRun } from "../kyc/storage.js";
import { KycRun, KycDocument, DocumentType } from "../kyc/types.js";
import * as crypto from 'crypto';

const customerId = "pfds";
const basePath = "/Users/ashishpunj/Desktop/MCP-Docx/MCP";

const docs = [
  { type: "acta" as DocumentType,           fileUrl: `${basePath}/Acta_Constitutiva_PFDS_SAPI.pdf` },
  { type: "sat_constancia" as DocumentType, fileUrl: `${basePath}/Constancia_PFDS.pdf` },
  { type: "fm2" as DocumentType,            fileUrl: `${basePath}/FM2 (1).pdf` },
  { type: "telmex" as DocumentType,         fileUrl: `${basePath}/Recibo-Oct (2).pdf` },
  { type: "cfe" as DocumentType,            fileUrl: `${basePath}/CFE_AGOSTO.pdf` },
  { type: "cfe" as DocumentType,            fileUrl: `${basePath}/CFE_OCTUBRE.pdf` },
  { type: "bank_statement" as DocumentType, fileUrl: `${basePath}/Esatdo_De_Cuenta_Agosto_2025.pdf` },
  { type: "bank_statement" as DocumentType, fileUrl: `${basePath}/Esatdo_De_Cuenta_Septiembre_2025.pdf` },
  { type: "bank_statement" as DocumentType, fileUrl: `${basePath}/Esatdo_De_Cuenta_Octubre_2025.pdf` }
];

async function main() {
  console.log(`Starting End-to-End KYC Run for customer: ${customerId}`);
  const kycDocuments: KycDocument[] = [];
  
  // Temporary holders for builder inputs
  let companyIdentity;
  let companyTaxProfile;
  let representativeIdentity;
  const proofsOfAddress: any[] = [];
  const bankAccounts: any[] = [];

  for (const doc of docs) {
    console.log(`Processing ${doc.type} - ${doc.fileUrl}...`);
    let extractedPayload: any = null;
    
    try {
      switch (doc.type) {
        case "acta":
          extractedPayload = await extractCompanyIdentity(doc.fileUrl);
          companyIdentity = extractedPayload;
          break;
        case "sat_constancia":
          extractedPayload = await extractCompanyTaxProfile(doc.fileUrl);
          companyTaxProfile = extractedPayload;
          break;
        case "fm2":
          extractedPayload = await extractImmigrationProfile(doc.fileUrl);
          representativeIdentity = extractedPayload;
          break;
        case "telmex":
          extractedPayload = await extractTelmexProofOfAddress(doc.fileUrl);
          proofsOfAddress.push(extractedPayload);
          break;
        case "cfe":
          extractedPayload = await extractCfeProofOfAddress(doc.fileUrl);
          proofsOfAddress.push(extractedPayload);
          break;
        case "bank_statement":
          const profile = await extractBankStatementProfile(doc.fileUrl);
          const txs = await extractBankStatementTransactions(doc.fileUrl);
          if (profile.bank_account_profile) {
             extractedPayload = {
                 ...profile.bank_account_profile,
                 transactions: txs.transactions
             };
             bankAccounts.push(profile.bank_account_profile);
          }
          break;
      }

      kycDocuments.push({
        id: crypto.randomUUID(),
        customerId,
        type: doc.type,
        fileUrl: doc.fileUrl,
        extractedAt: new Date().toISOString(),
        extractedPayload,
        sourceName: doc.fileUrl.split('/').pop()
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

  // --- EXPLICIT INSPECTION LOGGING ---
  console.log("\n--- INSPECTABLE RULES BRAIN ---");
  
  const ubos = resolveUbo(profile);
  console.log("1. Resolved UBOs (>25%):", JSON.stringify(ubos, null, 2));

  const signers = resolveSignatories(profile);
  console.log("2. Resolved Signatories:", JSON.stringify(signers, null, 2));

  const freshness = checkFreshness(profile, new Date()); // relative to now
  console.log("3. Document Freshness (Days):", JSON.stringify(freshness, null, 2));
  
  console.log("-------------------------------");

  const run: KycRun = {
    runId: crypto.randomUUID(),
    customerId,
    createdAt: new Date().toISOString(),
    documents: kycDocuments,
    profile,
    validation
  };

  console.log("Saving Run...");
  await saveRun(run);

  console.log("\n=== FINAL KYC PROFILE ===");
  console.log(JSON.stringify(profile, null, 2));

  console.log("\n=== VALIDATION RESULT ===");
  console.log(JSON.stringify(validation, null, 2));
}

main().catch(console.error);
