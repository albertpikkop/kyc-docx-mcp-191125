import "dotenv/config";
import { extractCompanyTaxProfile } from '../extractors/companyTaxProfileExtractor.js';

const FILE_PATH = "/Users/ashishpunj/Desktop/MCP-Docx/MCP/Constancia_PFDS.pdf";

async function main() {
  try {
    console.log("Starting SAT Constancia extraction...");
    const result = await extractCompanyTaxProfile(FILE_PATH);
    console.log("\n=== COMPANY TAX PROFILE RESULT ===");
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
  }
}

main();
