import "dotenv/config";
import { extractCompanyIdentity } from "../extractors/actaCompanyIdentity.js";
import { extractCompanyTaxProfile } from "../extractors/companyTaxProfileExtractor.js";
import { extractImmigrationProfile } from "../extractors/fm2Immigration.js";
import { extractPassportIdentity } from "../extractors/passportIdentity.js";
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
// import { DEMO_CONFIG } from "../core/demoConfig.js";

const customerId = "pfds";
const fixtureRoot = "/Users/ashishpunj/Desktop/mcp-docs/pfds";

function resolveFixture(fileName: string): string {
  const fullPath = path.resolve(fixtureRoot, fileName);
  if (!fs.existsSync(fullPath)) {
    console.warn(`Warning: Fixture not found: ${fullPath}`);
    return fullPath;
  }
  return fullPath;
}

// Full Document Set from Plan
const docs = [
  { type: "acta" as DocumentType,           fileUrl: resolveFixture("Acta_Constitutiva_pfds.pdf") },
  { type: "sat_constancia" as DocumentType, fileUrl: resolveFixture("SAT_Constancia_pfds.pdf") },
  { type: "fm2" as DocumentType,            fileUrl: resolveFixture("FM2_pfds.pdf") },
  { type: "passport" as DocumentType,       fileUrl: resolveFixture("Passport_Front_Ashish_Punj_pfds.jpeg") },
  // { type: "passport_back" as DocumentType,  fileUrl: resolveFixture("Passport_Backside_Ashish_Punj_pfds.jpg") }, // System usually processes front for data
  { type: "telmex" as DocumentType,         fileUrl: resolveFixture("Telmex_Recibo_pfds_Octubre_2025.pdf") },
  { type: "bank_identity_page" as DocumentType, fileUrl: resolveFixture("Bank_Estado_Cuenta_pfds_Octubre_2025.pdf") },
  { type: "acta" as DocumentType,           fileUrl: resolveFixture("Modificacion Objeto PFDS.pdf") }, // Treat modification as Acta to extract updates
  { type: "legal_document" as DocumentType, fileUrl: resolveFixture("FME_REGISTRO_Nacional De Inversion Extranjera_Registo_Publico_de_ComercioPFDS_SAPI.pdf") }
];

async function main() {
  console.log(`Starting FULL KYC Run for customer: ${customerId}`);
  console.log(`Fixture Root: ${fixtureRoot}`);
  
  const kycDocuments: KycDocument[] = [];
  
  // Holders for builder inputs
  let companyIdentity: any = null;
  let companyTaxProfile: any = null;
  let representativeIdentity: any = null;
  let passportIdentity: any = null;
  const proofsOfAddress: any[] = [];
  const bankAccounts: any[] = []; 
  // const _otherDocs: any[] = [];

  for (const doc of docs) {
    if (!fs.existsSync(doc.fileUrl)) {
        console.log(`Skipping missing file: ${doc.fileUrl}`);
        continue;
    }

    console.log(`Processing ${doc.type} - ${path.basename(doc.fileUrl)}...`);
    let extractedPayload: any = null;
    
    try {
      switch (doc.type) {
        case "acta":
          extractedPayload = await extractCompanyIdentity(doc.fileUrl);
          // If we already have companyIdentity (from main Acta), merge or keep main?
          // Usually main Acta has incorporation data. Modification has updates.
          // For simplicity in this script, if we have multiple, we might want to merge manually or just use the first one for "creation" data
          // but we'll store the last one or handle specific logic.
          // Let's prioritize the main Acta for creation, but maybe look at modification for updates.
          if (!companyIdentity) {
              companyIdentity = extractedPayload;
          } else {
              // Basic merge for demo purposes if needed, or just log it
              console.log("  (Second Acta/Modification found - keeping original for base identity, but could merge modifications)");
              // In a real scenario we'd merge the 'modifications' array
          }
          break;
        case "sat_constancia":
          extractedPayload = await extractCompanyTaxProfile(doc.fileUrl);
          companyTaxProfile = extractedPayload;
          break;
        case "fm2":
          extractedPayload = await extractImmigrationProfile(doc.fileUrl);
          representativeIdentity = extractedPayload;
          break;
        case "passport":
          extractedPayload = await extractPassportIdentity(doc.fileUrl);
          passportIdentity = extractedPayload;
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
        default:
          console.log(`  No specific extractor for ${doc.type}, just storing document record.`);
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
    passportIdentity, // Add passport identity
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
      
      // Automatically open in browser (macOS)
      try {
          const { exec } = await import('child_process');
          const { promisify } = await import('util');
          const execAsync = promisify(exec);
          await execAsync(`open "${reportUrl}"`);
      } catch (error) {
          console.log(`\n💡 Tip: Copy and paste this URL into your browser to view the report.`);
      }
  }

  console.log("\n=== FINAL KYC PROFILE ===");
  console.log(JSON.stringify(profile, null, 2));
}

main().catch(console.error);

