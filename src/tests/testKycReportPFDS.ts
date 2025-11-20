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

  console.log("Building Standard Report (No Trace)...");
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
  
  // Verify Section IV is missing by default
  if (report.sections.some(s => s.title.includes("TRAZA"))) {
      console.error("FAIL: Trace section appeared when not requested.");
      process.exit(1);
  }

  console.log("\n--- Building Traceability Report (With Trace) ---");
  const traceReport = buildKycReport(run.profile, run.validation, { includeTrace: true });
  
  const traceSection = traceReport.sections.find(s => s.title.includes("TRAZA"));
  if (!traceSection) {
      console.error("FAIL: Trace section missing when requested.");
      process.exit(1);
  }
  
  console.log(`## ${traceSection.title}\n`);
  console.log(traceSection.body);
  console.log("--------------------------------------------------------\n");

  console.log("\n=== JSON OUTPUT (Trace Report) ===");
  console.log(JSON.stringify(traceReport, null, 2));
}

main().catch(console.error);
