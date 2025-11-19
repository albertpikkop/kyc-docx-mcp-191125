import "dotenv/config";
import { loadLatestRun } from "../kyc/storage.js";
import { buildKycReport } from "../kyc/reportBuilder.js";

const customerId = "pfds";

async function main() {
  console.log(`Loading latest run for customer: ${customerId}...`);
  const run = await loadLatestRun(customerId);

  if (!run || !run.profile || !run.validation) {
    console.error("No complete run found. Please run 'npm run test:kyc-pfds' first.");
    process.exit(1);
  }

  console.log("Building Report...");
  const report = buildKycReport(run.profile, run.validation);

  console.log("\n========================================================");
  console.log(`KYC REPORT: ${report.customerId.toUpperCase()}`);
  console.log(`Generated: ${report.generatedAt}`);
  console.log("========================================================\n");

  report.sections.forEach(section => {
    console.log(`## ${section.title}\n`);
    console.log(section.body);
    console.log("--------------------------------------------------------\n");
  });

  console.log("\n=== JSON OUTPUT ===");
  console.log(JSON.stringify(report, null, 2));
}

main().catch(console.error);

