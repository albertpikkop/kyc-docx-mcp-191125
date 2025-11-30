import "dotenv/config";
import { extractBankIdentityPage } from "../extractors/bankIdentityPage.js";
import { extractCfeProofOfAddress } from "../extractors/cfeProofOfAddress.js";

async function main() {
  console.log("=== VERIFYING GRUPO POUNJ EXTRACTIONS ===\n");
  
  // 1. Bank Statement
  console.log("1. RE-EXTRACTING BANK STATEMENT...");
  const bankPath = "/Users/ashishpunj/Desktop/mcp-docs/grupo-pounj/Bank_Estado_Cuenta_grupo-pounj_Octubre_2025.pdf";
  try {
    const bankResult = await extractBankIdentityPage(bankPath);
    console.log("\nBANK EXTRACTION RESULT:");
    console.log(JSON.stringify(bankResult, null, 2));
  } catch (e) {
    console.error("Bank extraction failed:", e);
  }
  
  // 2. CFE Bill  
  console.log("\n\n2. RE-EXTRACTING CFE BILL...");
  const cfePath = "/Users/ashishpunj/Desktop/mcp-docs/grupo-pounj/CFE_Recibo_grupo-pounj_Octubre_2025.pdf";
  try {
    const cfeResult = await extractCfeProofOfAddress(cfePath);
    console.log("\nCFE EXTRACTION RESULT:");
    console.log(JSON.stringify(cfeResult, null, 2));
  } catch (e) {
    console.error("CFE extraction failed:", e);
  }
}

main().catch(console.error);
