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

// --- Configuration ---
const CLIENTS = [
  {
    id: "pfds",
    root: "/Users/ashishpunj/Desktop/mcp-docs/pfds",
    files: [
      { type: "acta" as DocumentType,           fileName: "Acta_Constitutiva_pfds.pdf" },
      { type: "sat_constancia" as DocumentType, fileName: "SAT_Constancia_pfds.pdf" },
      { type: "fm2" as DocumentType,            fileName: "FM2_pfds.pdf" },
      { type: "passport" as DocumentType,       fileName: "Passport_Front_Ashish_Punj_pfds.jpeg" },
      { type: "telmex" as DocumentType,         fileName: "Telmex_Recibo_pfds_Octubre_2025.pdf" },
      { type: "bank_identity_page" as DocumentType, fileName: "Bank_Estado_Cuenta_pfds_Octubre_2025.pdf" },
      { type: "acta" as DocumentType,           fileName: "Modificacion Objeto PFDS.pdf" }, // Corporate purpose modification
      { type: "legal_document" as DocumentType, fileName: "FME_REGISTRO_Nacional De Inversion Extranjera_Registo_Publico_de_ComercioPFDS_SAPI.pdf" }
    ]
  },
  {
    id: "grupo-pounj",
    root: "/Users/ashishpunj/Desktop/mcp-docs/grupo-pounj",
    files: [
      { type: "acta" as DocumentType,           fileName: "Acta_Constitutiva_grupo-pounj.pdf" },
      { type: "sat_constancia" as DocumentType, fileName: "SAT_Constancia_grupo-pounj.pdf" },
      { type: "fm2" as DocumentType,            fileName: "FM2_grupo-pounj.pdf" },
      { type: "passport" as DocumentType,       fileName: "Passport_Front_Ashish_Punj_grupo-pounj.jpeg" },
      { type: "cfe" as DocumentType,            fileName: "CFE_Recibo_grupo-pounj_Octubre_2025.pdf" },
      { type: "bank_identity_page" as DocumentType, fileName: "Bank_Estado_Cuenta_grupo-pounj_Octubre_2025.pdf" },
      { type: "legal_document" as DocumentType, fileName: "GRUPO POUNJ RPP.pdf" },
      { type: "acta" as DocumentType,           fileName: "Modificacion Objeto GP.pdf" }, // Corporate purpose + Arturo powers
      { type: "acta" as DocumentType,           fileName: "Compraventa Acciones GP.pdf" } // Share sale/purchase agreement - extract shareholder changes
    ]
  }
];

function resolveFixture(root: string, fileName: string): string {
  const fullPath = path.resolve(root, fileName);
  if (!fs.existsSync(fullPath)) {
    console.warn(`Warning: Fixture not found: ${fullPath}`);
    return fullPath;
  }
  return fullPath;
}

async function processClient(client: typeof CLIENTS[0]) {
  console.log(`\n🚀 Starting Parallel KYC Run for: ${client.id.toUpperCase()}`);
  
  const kycDocuments: KycDocument[] = [];
  let companyIdentity: any = null;
  let companyTaxProfile: any = null;
  let representativeIdentity: any = null;
  let passportIdentity: any = null;
  const proofsOfAddress: any[] = [];
  const bankAccounts: any[] = [];
  const actaModifications: any[] = []; // Collect modification documents for merging

  // Process documents in sequence for a single client (to avoid rate limits/context mixing), 
  // but client runs themselves will be parallel.
  for (const fileDef of client.files) {
    const fileUrl = resolveFixture(client.root, fileDef.fileName);
    if (!fs.existsSync(fileUrl)) {
      console.log(`  [${client.id}] Skipping missing file: ${fileDef.fileName}`);
      continue;
    }

    console.log(`  [${client.id}] Extracting ${fileDef.type} - ${fileDef.fileName}...`);
    let extractedPayload: any = null;

    try {
      switch (fileDef.type) {
        case "acta":
          extractedPayload = await extractCompanyIdentity(fileUrl);
          // Logic: First Acta found is primary (original incorporation), subsequent ones are modifications
          if (!companyIdentity) {
            companyIdentity = extractedPayload;
          } else {
            // Store modification for later merging
            actaModifications.push({ source: fileDef.fileName, data: extractedPayload });
            console.log(`    📝 Stored modification from: ${fileDef.fileName}`);
          }
          break;
        case "sat_constancia":
          extractedPayload = await extractCompanyTaxProfile(fileUrl);
          companyTaxProfile = extractedPayload;
          break;
        case "fm2":
          extractedPayload = await extractImmigrationProfile(fileUrl);
          representativeIdentity = extractedPayload;
          break;
        case "passport":
          extractedPayload = await extractPassportIdentity(fileUrl);
          passportIdentity = extractedPayload;
          break;
        case "cfe":
          extractedPayload = await extractCfeProofOfAddress(fileUrl);
          proofsOfAddress.push(extractedPayload);
          break;
        case "telmex":
          extractedPayload = await extractTelmexProofOfAddress(fileUrl);
          proofsOfAddress.push(extractedPayload);
          break;
        case "bank_identity_page":
          const identityResult = await extractBankIdentityPage(fileUrl);
          if (identityResult.bank_account_profile) {
             extractedPayload = identityResult.bank_account_profile;
             bankAccounts.push(extractedPayload);
          }
          break;
        default:
          // No specific extractor for legal_document or others yet
          break;
      }

      kycDocuments.push({
        id: crypto.randomUUID(),
        customerId: client.id,
        type: fileDef.type,
        fileUrl: fileUrl,
        extractedAt: new Date().toISOString(),
        extractedPayload,
        sourceName: fileDef.fileName
      });

    } catch (error) {
      console.error(`  [${client.id}] Failed to process ${fileDef.fileName}:`, error);
    }
  }

  // --- MERGE MODIFICATIONS INTO COMPANY IDENTITY (per Arturo's notes) ---
  // Modifications can add: new legal_representatives, updated shareholders, modified corporate_purpose
  if (companyIdentity && actaModifications.length > 0) {
    console.log(`  [${client.id}] Merging ${actaModifications.length} modification(s) into company identity...`);
    
    for (const mod of actaModifications) {
      const modData = mod.data;
      
      // 1. Merge legal representatives (add new apoderados from modifications)
      if (modData.legal_representatives && modData.legal_representatives.length > 0) {
        const existingNames = new Set(
          (companyIdentity.legal_representatives || []).map((r: any) => r.name?.toUpperCase())
        );
        for (const rep of modData.legal_representatives) {
          if (!existingNames.has(rep.name?.toUpperCase())) {
            companyIdentity.legal_representatives = companyIdentity.legal_representatives || [];
            companyIdentity.legal_representatives.push(rep);
            console.log(`    ➕ Added legal rep from modification: ${rep.name} (${rep.role})`);
          }
        }
      }
      
      // 2. Update shareholders if the modification has newer shareholder info
      if (modData.shareholders && modData.shareholders.length > 0) {
        // Use modification shareholders as current (they represent the latest state)
        console.log(`    📊 Updated shareholders from: ${mod.source}`);
        companyIdentity.shareholders = modData.shareholders;
      }
      
      // 3. Track modifications in the company identity
      companyIdentity.modifications = companyIdentity.modifications || [];
      if (modData.modifications) {
        companyIdentity.modifications.push(...modData.modifications);
      } else {
        companyIdentity.modifications.push(`Modification from: ${mod.source}`);
      }
      
      // 4. Update registry info if modification has it
      if (modData.registry?.fme || modData.registry?.nci) {
        companyIdentity.registry = { ...companyIdentity.registry, ...modData.registry };
        console.log(`    📋 Updated registry info from: ${mod.source}`);
      }
    }
  }

  console.log(`  [${client.id}] Building & Validating Profile...`);
  const profile = buildKycProfile({
    customerId: client.id,
    companyIdentity,
    companyTaxProfile,
    representativeIdentity,
    passportIdentity,
    proofsOfAddress,
    bankAccounts
  });

  const validation = validateKycProfile(profile);

  const run: KycRun = {
    runId: crypto.randomUUID(),
    customerId: client.id,
    createdAt: new Date().toISOString(),
    documents: kycDocuments,
    profile,
    validation
  };

  console.log(`  [${client.id}] Saving Run & Generating Report...`);
  const reportUrl = await saveRun(run);
  
  if (reportUrl) {
    console.log(`  ✅ [${client.id}] Report Ready: ${reportUrl}`);
    // Open report automatically
    try {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        await execAsync(`open "${reportUrl}"`);
    } catch (e) { /* ignore */ }
  }

  return { clientId: client.id, reportUrl, runId: run.runId };
}

async function main() {
  console.log("Starting PARALLEL extraction for all clients...");
  
  // Run both client processes in parallel
  const results = await Promise.allSettled(CLIENTS.map(client => processClient(client)));

  console.log("\n=== PARALLEL EXECUTION COMPLETE ===");
  results.forEach((result) => {
    if (result.status === 'fulfilled') {
      console.log(`Client ${result.value.clientId}: SUCCESS (Run ${result.value.runId})`);
    } else {
      console.error(`Client Failed:`, result.reason);
    }
  });
}

main().catch(console.error);

