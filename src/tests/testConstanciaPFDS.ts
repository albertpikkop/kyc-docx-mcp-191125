import "dotenv/config";
import { extractCompanyTaxProfile } from "../extractors/constanciaPFDS.js";

async function main() {
  const profile = await extractCompanyTaxProfile("/Users/ashishpunj/Desktop/MCP-Docx/MCP/Constancia_PFDS.pdf");
  console.log(JSON.stringify(profile, null, 2));
}

main().catch(console.error);


