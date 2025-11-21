import "dotenv/config";
import * as path from 'path';
import { extractCompanyIdentity } from "../extractors/actaCompanyIdentity.js";

const fixtureRoot = process.env.KYC_FIXTURES_DIR ?? path.resolve(process.cwd(), "fixtures");
const FILE_PATH = path.join(fixtureRoot, "Acta_Constitutiva_PFDS_SAPI.pdf");

async function main() {
  const identity = await extractCompanyIdentity(FILE_PATH);
  console.log(JSON.stringify(identity, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


