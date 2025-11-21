import "dotenv/config";
import * as path from 'path';
import { extractCfeProofOfAddress } from "../extractors/cfeProofOfAddress.js";

async function main() {
  const fixtureRoot = process.env.KYC_FIXTURES_DIR ?? path.resolve(process.cwd(), "fixtures");
  
  const agosto = await extractCfeProofOfAddress(path.join(fixtureRoot, "CFE_AGOSTO.pdf"));
  console.log("=== CFE AGOSTO ===");
  console.log(JSON.stringify(agosto, null, 2));

  const octubre = await extractCfeProofOfAddress(path.join(fixtureRoot, "CFE_OCTUBRE.pdf"));
  console.log("=== CFE OCTUBRE ===");
  console.log(JSON.stringify(octubre, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
