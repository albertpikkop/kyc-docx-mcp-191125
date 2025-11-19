import "dotenv/config";
import { extractCompanyIdentity } from "../extractors/actaCompanyIdentity.js";

const FILE_PATH = "/Users/ashishpunj/Desktop/MCP-Docx/MCP/Acta_Constitutiva_PFDS_SAPI.pdf";

async function main() {
  const identity = await extractCompanyIdentity(FILE_PATH);
  console.log(JSON.stringify(identity, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


