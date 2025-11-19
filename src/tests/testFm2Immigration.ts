import "dotenv/config";
import { extractImmigrationProfile } from "../extractors/fm2Immigration.js";

async function main() {
  const profile = await extractImmigrationProfile("/Users/ashishpunj/Desktop/MCP-Docx/MCP/FM2 (1).pdf");
  console.log(JSON.stringify(profile, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


