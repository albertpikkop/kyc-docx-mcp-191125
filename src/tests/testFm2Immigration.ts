import "dotenv/config";
import * as path from 'path';
import { extractImmigrationProfile } from "../extractors/fm2Immigration.js";

async function main() {
  const fixtureRoot = process.env.KYC_FIXTURES_DIR ?? path.resolve(process.cwd(), "fixtures");
  const profile = await extractImmigrationProfile(path.join(fixtureRoot, "FM2 (1).pdf"));
  console.log(JSON.stringify(profile, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
