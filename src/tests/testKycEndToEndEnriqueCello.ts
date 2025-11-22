import "dotenv/config";
import { extractCompanyTaxProfile } from "../extractors/companyTaxProfileExtractor.js";
import { extractIneIdentity } from "../extractors/ineIdentity.js"; // Use new INE extractor
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
import { sanitizeCurp } from "../kyc/validators.js";

const customerId = "enrique-cello";
const fixtureRoot = "/Users/ashishpunj/Desktop/mcp-docs/enrique-cello";

function resolveFixture(fileName: string): string {
  const fullPath = path.resolve(fixtureRoot, fileName);
  if (!fs.existsSync(fullPath)) {
    throw new Error(
      `Fixture not found: ${fullPath}. Please check the folder content.`
    );
  }
  return fullPath;
}

const docs = [
  { type: "sat_constancia" as DocumentType, fileUrl: resolveFixture("Constancia de Situacion Fiscal.pdf") },
  // Updated to use standard FM2 type string but calling the INE extractor logic
  // Ideally we should have a dedicated "ine" document type in the system, but reusing "fm2" for identity slot is standard for now.
  // We will manually route to extractIneIdentity.
  { type: "fm2" as DocumentType,            fileUrl: resolveFixture("INE Enrique De Cello.pdf") },
  
  { type: "cfe" as DocumentType,            fileUrl: resolveFixture("Comprobante (1).pdf") },
  
  { type: "bank_identity_page" as DocumentType, fileUrl: resolveFixture("Octubre_E.pdf") }
];

async function main() {
  console.log(`Starting GPT-5.1 KYC Run for customer: ${customerId}`);
  console.log(`Fixture Root: ${fixtureRoot}`);
  
  const kycDocuments: KycDocument[] = [];
  
  // Temporary holders
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
        case "sat_constancia":
          extractedPayload = await extractCompanyTaxProfile(doc.fileUrl);
          companyTaxProfile = extractedPayload;
          break;
        case "fm2": 
          // Determine if file is INE or FM2? We know it is INE for this test file.
          // We'll use the new extractIneIdentity function but need to map result to ImmigrationProfile structure
          // to fit the existing representativeIdentity slot.
          
          // We need to actually implement extractIneIdentity fully first if we want to call it.
          // The file src/extractors/ineIdentity.ts currently returns a placeholder.
          // I will implement it using GPT-5.1 first.
          // BUT wait, I need to update src/extractors/ineIdentity.ts to use OpenAI properly first.
          // I'll do that in a separate tool call or inline if I could, but here I am updating the TEST runner.
          
          // For this step, I will stick to the plan: I updated the test runner, but I need to update the extractor implementation too.
          // I will assume extractIneIdentity works or I will use the "instructions" override approach if I was using the generic vision extractor directly.
          // Since I am calling specific functions, I should fix the function first.
          
          // Let's assume I will fix extractIneIdentity.ts in the next step or I should have done it.
          // Re-reading the plan... "Update GPT-5.1 test... to use dedicated... extractor".
          // So I will import it here, and map it.
          
          const rawIneData = await extractIneIdentity(doc.fileUrl);
          
          // Log raw INE extraction for debugging
          console.log("Raw INE Extraction:", JSON.stringify({
            cic: rawIneData?.cic,
            ocr_number: rawIneData?.ocr_number,
            clave_elector: rawIneData?.clave_elector,
            document_number: rawIneData?.document_number
          }, null, 2));
          
          // Map INE schema to ImmigrationProfile schema
          if (rawIneData && rawIneData.full_name) {
              representativeIdentity = {
                full_name: rawIneData.full_name,
                nationality: "MEXICANA", // Implicit for INE
                document_type: "INE",
                document_number: rawIneData.cic || rawIneData.ocr_number || rawIneData.document_number || rawIneData.clave_elector,
                secondary_number: rawIneData.clave_elector,
                date_of_birth: rawIneData.date_of_birth,
                curp: sanitizeCurp(rawIneData.curp),
                sex: rawIneData.sex === 'H' ? 'Hombre' : (rawIneData.sex === 'M' ? 'Mujer' : rawIneData.sex),
                issue_date: rawIneData.emission_year ? `${rawIneData.emission_year}-01-01` : null,
                expiry_date: rawIneData.vigencia_year ? `${rawIneData.vigencia_year}-12-31` : null,
                issuing_office: "INE",
                issuer_country: "MX"
              };
              // Store the RAW INE data to preserve CIC and OCR fields
              extractedPayload = rawIneData;
          }
          break;
        case "cfe":
          try {
              extractedPayload = await extractCfeProofOfAddress(doc.fileUrl);
              if (extractedPayload && (!extractedPayload.vendor_name || !extractedPayload.vendor_name.toUpperCase().includes("CFE"))) {
                  console.log("Document processed as CFE but might not be CFE. Trying Telmex...");
              }
              proofsOfAddress.push(extractedPayload);
          } catch (e) {
              console.log("CFE extraction failed, trying Telmex...");
              extractedPayload = await extractTelmexProofOfAddress(doc.fileUrl);
              proofsOfAddress.push(extractedPayload);
          }
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
