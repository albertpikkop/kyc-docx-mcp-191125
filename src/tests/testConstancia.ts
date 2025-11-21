import "dotenv/config";
import * as path from 'path';
import { extractCompanyTaxProfile } from '../extractors/companyTaxProfileExtractor.js';

const fixtureRoot = process.env.KYC_FIXTURES_DIR ?? path.resolve(process.cwd(), "fixtures");
const FILE_PATH = path.join(fixtureRoot, "Constancia_PFDS.pdf");

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
