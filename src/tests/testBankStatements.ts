import "dotenv/config";
import { extractBankStatementProfile } from "../extractors/bankStatementProfile.js";
import { extractBankStatementTransactions } from "../extractors/bankStatementTransactions.js";

// Using local paths mapped to the prompt's /mnt/data/
const basePath = "/Users/ashishpunj/Desktop/MCP-Docx/MCP";
const files = [
  `${basePath}/Esatdo_De_Cuenta_Agosto_2025.pdf`,
  `${basePath}/Esatdo_De_Cuenta_Septiembre_2025.pdf`,
  `${basePath}/Esatdo_De_Cuenta_Octubre_2025.pdf`
];

async function main() {
  for (const file of files) {
    console.log("==== PROFILE:", file, "====");
    const profile = await extractBankStatementProfile(file);
    console.log(JSON.stringify(profile, null, 2));

    console.log("==== TRANSACTIONS:", file, "====");
    const txs = await extractBankStatementTransactions(file);
    console.log(JSON.stringify(txs, null, 2));
  }
}

main().catch(console.error);

