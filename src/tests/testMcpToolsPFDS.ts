import "dotenv/config";
import * as path from 'path';
import * as fs from 'fs';
import { 
  handleImportKycDocument, 
  handleBuildKycProfile, 
  handleValidateKycProfile, 
  handleGetKycReport 
} from "../mcp/server.js";
import { ImportableDocumentType } from "../kyc/types.js";

const customerId = "pfds";
// Using local paths mapped to the prompt's /mnt/data/
const fixtureRoot = process.env.KYC_FIXTURES_DIR ?? path.resolve(process.cwd(), "fixtures");

function resolveFixture(fileName: string): string {
  const fullPath = path.resolve(fixtureRoot, fileName);
  if (!fs.existsSync(fullPath)) {
    throw new Error(
      `Fixture not found: ${fullPath}. Set KYC_FIXTURES_DIR env var to your document folder.`
    );
  }
  return fullPath;
}

type McpResult = { content: Array<{ text: string }>; isError?: boolean };

function unwrap(result: McpResult) {
  const payload = JSON.parse(result.content[0].text);
  if (!payload.ok) {
    throw new Error(payload.message || "Unexpected MCP error");
  }
  return payload.data;
}

async function main() {
  console.log(`\n=== Testing MCP Tools Integration for ${customerId} ===\n`);

  // 1. Import Documents
  console.log("--- Step 1: Import Documents ---");
const docs: Array<{ type: ImportableDocumentType; file: string }> = [
  { type: "acta",           file: "Acta_Constitutiva_PFDS_SAPI.pdf" },
  { type: "sat_constancia", file: "Constancia_PFDS.pdf" },
  { type: "fm2",            file: "FM2 (1).pdf" },
  { type: "telmex",         file: "Recibo-Oct (2).pdf" },
  { type: "cfe",            file: "CFE_AGOSTO.pdf" },
  { type: "cfe",            file: "CFE_OCTUBRE.pdf" },
  { type: "bank_statement", file: "Esatdo_De_Cuenta_Agosto_2025.pdf" },
  { type: "bank_statement", file: "Esatdo_De_Cuenta_Septiembre_2025.pdf" },
  { type: "bank_statement", file: "Esatdo_De_Cuenta_Octubre_2025.pdf" }
];

  for (const doc of docs) {
    console.log(`Importing ${doc.type}: ${doc.file}`);
    const result = await handleImportKycDocument({
      customer_id: customerId,
      doc_type: doc.type,
      file_url: resolveFixture(doc.file),
      source_name: doc.file
    });
    
    if (result.isError) {
      console.error(`FAILED: ${result.content[0].text}`);
      process.exit(1);
    } else {
      const data = unwrap(result);
      console.log(`  OK -> Doc ID: ${data.doc_id}`);
    }
  }

  // 2. Build Profile
  console.log("\n--- Step 2: Build KYC Profile ---");
  const buildRes = await handleBuildKycProfile({ customer_id: customerId });
  if (buildRes.isError) {
    console.error(`Build Failed: ${buildRes.content[0].text}`);
    process.exit(1);
  }
  const profile = unwrap(buildRes);
  console.log("Profile Built.");
  
  // Assertions
  if (!profile.companyIdentity) throw new Error("Missing Company Identity");
  if (profile.currentFiscalAddress?.cp !== "11300") {
      throw new Error(`Fiscal CP mismatch. Expected 11300, got ${profile.currentFiscalAddress?.cp}`);
  }
  if (!profile.currentOperationalAddress) throw new Error("Missing Operational Address");

  // 3. Validate Profile
  console.log("\n--- Step 3: Validate KYC Profile ---");
  const validateRes = await handleValidateKycProfile({ customer_id: customerId });
  if (validateRes.isError) {
    console.error(`Validation Failed: ${validateRes.content[0].text}`);
    process.exit(1);
  }
  const validation = unwrap(validateRes);
  console.log(`Validation Complete. Score: ${validation.score}`);
  
  if (validation.score <= 0) throw new Error("Validation score should be positive");

  // 4. Get Report
  console.log("\n--- Step 4: Get KYC Report ---");
  const reportRes = await handleGetKycReport({ customer_id: customerId });
  if (reportRes.isError) {
     console.error(`Report Failed: ${reportRes.content[0].text}`);
     process.exit(1);
  }
  const report = unwrap(reportRes);
  console.log("Report Generated.");
  
  if (report.sections.length === 0) throw new Error("Report should have sections");
  const factsSection = report.sections.find((s: any) => s.title.includes("HECHOS"));
  if (!factsSection) throw new Error("Report missing 'HECHOS' section");

  console.log("\n=== MCP INTEGRATION TEST SUCCESS ===");
}

main().catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
});
