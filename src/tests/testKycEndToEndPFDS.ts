import "dotenv/config";
import { extractCompanyIdentity } from "../extractors/actaCompanyIdentity.js";
import { extractCompanyTaxProfile } from "../extractors/companyTaxProfileExtractor.js";
import { extractImmigrationProfile } from "../extractors/fm2Immigration.js";
import { extractCfeProofOfAddress } from "../extractors/cfeProofOfAddress.js";
import { extractTelmexProofOfAddress } from "../extractors/telmexProofOfAddress.js";
import { extractBankIdentityPage } from "../extractors/bankIdentityPage.js";
import { buildKycProfile } from "../kyc/profileBuilder.js";
import { validateKycProfile } from "../kyc/validation.js";
import { saveRun } from "../kyc/storage.js";
import { KycRun, KycDocument, DocumentType } from "../kyc/types.js";
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { DEMO_CONFIG } from "../core/demoConfig.js";

const customerId = "pfds";
// Use the desktop folder as requested
const fixtureRoot = "/Users/ashishpunj/Desktop/MCP-Docx/MCP";

function resolveFixture(fileName: string): string {
  const fullPath = path.resolve(fixtureRoot, fileName);
  if (!fs.existsSync(fullPath)) {
    throw new Error(
      `Fixture not found: ${fullPath}. Please check the folder content.`
    );
  }
  return fullPath;
}

// Demo Mode 5-Document Set from Desktop Folder
const docs = [
  { type: "acta" as DocumentType,           fileUrl: resolveFixture("Acta_Constitutiva_PFDS_SAPI.pdf") },
  { type: "sat_constancia" as DocumentType, fileUrl: resolveFixture("Constancia_PFDS.pdf") },
  { type: "fm2" as DocumentType,            fileUrl: resolveFixture("FM2 (1).pdf") },
  // Using Recibo-Oct (2).pdf which is Telmex based on previous analysis
  { type: "telmex" as DocumentType,         fileUrl: resolveFixture("Recibo-Oct (2).pdf") },
  // Using one bank statement as identity page
  { type: "bank_identity_page" as DocumentType, fileUrl: resolveFixture("Esatdo_De_Cuenta_Octubre_2025.pdf") }
];

async function main() {
  console.log(`Starting Demo Mode KYC Run for customer: ${customerId}`);
  console.log(`Demo Config Enabled: ${DEMO_CONFIG.enabled}`);
  console.log(`Fixture Root: ${fixtureRoot}`);
  
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
        case "cfe":
          extractedPayload = await extractCfeProofOfAddress(doc.fileUrl);
          proofsOfAddress.push(extractedPayload);
          break;
        case "telmex":
          extractedPayload = await extractTelmexProofOfAddress(doc.fileUrl);
          proofsOfAddress.push(extractedPayload);
          break;
        case "bank_identity_page":
          const identityResult = await extractBankIdentityPage(doc.fileUrl);
          if (identityResult.bank_account_profile) {
             extractedPayload = identityResult.bank_account_profile;
             bankAccounts.push(extractedPayload);
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

  // --- DEMO MODE ASSERTIONS ---
  if (DEMO_CONFIG.enabled) {
      console.log("\n--- DEMO MODE ASSERTIONS ---");
      
      // 1. Check Bank Identity
      if (profile.bankIdentity) {
          console.log("✅ Bank Identity populated.");
          console.log(`   - Age: ${profile.bankIdentity.age_in_days} days (Within 90: ${profile.bankIdentity.within_90_days})`);
          console.log(`   - Holder Match: ${profile.bankIdentity.holder_matches_company}`);
          console.log(`   - Address Match: ${profile.bankIdentity.address_matches_operational}`);
      } else {
          console.error("❌ FAILURE: Bank Identity missing.");
      }

      // 2. Check PoA Count
      if (profile.addressEvidence.length === 1) {
          console.log("✅ Exact 1 Proof of Address used.");
      } else {
          console.error(`❌ FAILURE: ${profile.addressEvidence.length} PoA docs found (Expected 1).`);
      }
  }

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
      
      // Automatically open in browser (macOS)
      try {
          const { exec } = await import('child_process');
          const { promisify } = await import('util');
          const execAsync = promisify(exec);
          await execAsync(`open "${reportUrl}"`);
          console.log(`\n🌐 Opened browser automatically!`);
      } catch (error) {
          console.log(`\n💡 Tip: Copy and paste this URL into your browser to view the report.`);
      }
  }

  console.log("\n=== FINAL KYC PROFILE ===");
  console.log(JSON.stringify(profile, null, 2));

  console.log("\n=== VALIDATION RESULT ===");
  console.log(JSON.stringify(validation, null, 2));
}

main().catch(console.error);
