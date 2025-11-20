import "dotenv/config";
import { extractCompanyTaxProfile } from "../extractors/companyTaxProfileExtractor.js";
import * as path from "path";
import * as fs from "fs";

const fixtureRoot = process.env.KYC_FIXTURES_DIR ?? path.resolve(process.cwd(), "fixtures");
const CONSTANCIA_FILE = "Constancia_PFDS.pdf";

function resolveFixture() {
  const fullPath = path.resolve(fixtureRoot, CONSTANCIA_FILE);
  if (!fs.existsSync(fullPath)) {
    throw new Error(
      `Fixture not found: ${fullPath}. Set KYC_FIXTURES_DIR to your document directory.`
    );
  }
  return fullPath;
}

async function main() {
  const profile = await extractCompanyTaxProfile(resolveFixture());
  console.log(JSON.stringify(profile, null, 2));
}

main().catch(console.error);


