import "dotenv/config";
import { extractCfeProofOfAddress } from "../extractors/cfeProofOfAddress.js";

async function main() {
  // Note: /mnt/data/ path from prompt is mapped to the local path /Users/ashishpunj/Desktop/MCP-Docx/MCP/
  const basePath = "/Users/ashishpunj/Desktop/MCP-Docx/MCP";
  
  const agosto = await extractCfeProofOfAddress(`${basePath}/CFE_AGOSTO.pdf`);
  console.log("=== CFE AGOSTO ===");
  console.log(JSON.stringify(agosto, null, 2));

  const octubre = await extractCfeProofOfAddress(`${basePath}/CFE_OCTUBRE.pdf`);
  console.log("=== CFE OCTUBRE ===");
  console.log(JSON.stringify(octubre, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

