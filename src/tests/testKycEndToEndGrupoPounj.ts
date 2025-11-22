import "dotenv/config";
import { extractCompanyIdentity } from "../extractors/actaCompanyIdentity.js";
import { extractCompanyTaxProfile } from "../extractors/companyTaxProfileExtractor.js";
import { extractImmigrationProfile } from "../extractors/fm2Immigration.js";
import { extractCfeProofOfAddress } from "../extractors/cfeProofOfAddress.js";
import { extractBankIdentityPage } from "../extractors/bankIdentityPage.js";
import { buildKycProfile } from "../kyc/profileBuilder.js";
import { validateKycProfile } from "../kyc/validation.js";
import { saveRun } from "../kyc/storage.js";
import { KycRun, KycDocument, DocumentType } from "../kyc/types.js";
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { DEMO_CONFIG } from "../core/demoConfig.js";

const customerId = "grupo-pounj";
const fixtureRoot = "/Users/ashishpunj/Desktop/mcp-docs/grupo-pounj";

function resolveFixture(fileName: string): string {
  const fullPath = path.resolve(fixtureRoot, fileName);
  if (!fs.existsSync(fullPath)) {
    throw new Error(
      `Fixture not found: ${fullPath}. Please check the folder content.`
    );
  }
  return fullPath;
}

// Grupo Pounj Document Set
const docs = [
  { type: "acta" as DocumentType,           fileUrl: resolveFixture("1. Acta Grupo Pounj.pdf") },
  { type: "sat_constancia" as DocumentType, fileUrl: resolveFixture("2. Constancia_GPO.pdf") },
  { type: "fm2" as DocumentType,            fileUrl: resolveFixture("3. FM2 .pdf") },
  { type: "cfe" as DocumentType,            fileUrl: resolveFixture("CFE_OCTUBRE.pdf") },
  // Assuming this is the bank statement
  { type: "bank_identity_page" as DocumentType, fileUrl: resolveFixture("October 2025.pdf") }
];

async function main() {
  console.log(`Starting GPT-5.1 KYC Run for customer: ${customerId}`);
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
  
  // Calculate Cost Summary
  try {
    const { getAggregateCosts } = await import('../kyc/costTracker.js');
    const costs = await getAggregateCosts();
    console.log("\n--- COST SUMMARY ---");
    console.log(`Total Runs: ${costs.totalRuns}`);
    console.log(`Total Spent: $${costs.totalCost}`);
    console.log(`Avg Cost/Run: $${costs.avgCostPerRun}`);
  } catch (e) {
    // ignore
  }
  
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

