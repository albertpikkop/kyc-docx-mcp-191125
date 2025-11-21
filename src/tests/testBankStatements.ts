import "dotenv/config";
import * as path from 'path';
import { extractBankStatementProfile } from "../extractors/bankStatementProfile.js";
import { extractBankStatementTransactions } from "../extractors/bankStatementTransactions.js";

const fixtureRoot = process.env.KYC_FIXTURES_DIR ?? path.resolve(process.cwd(), "fixtures");
const files = [
  path.join(fixtureRoot, "Esatdo_De_Cuenta_Agosto_2025.pdf"),
  path.join(fixtureRoot, "Esatdo_De_Cuenta_Septiembre_2025.pdf"),
  path.join(fixtureRoot, "Esatdo_De_Cuenta_Octubre_2025.pdf")
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
