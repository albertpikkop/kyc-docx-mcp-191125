import "dotenv/config";
import { loadLatestRun } from "../kyc/storage.js";
import { buildKycReport } from "../kyc/reportBuilder.js";
import { DEMO_CONFIG } from "../core/demoConfig.js";

const customerId = "pfds";

async function main() {
  console.log(`Loading latest run for customer: ${customerId}...`);
  console.log(`Demo Mode: ${DEMO_CONFIG.enabled}`);
  
  const run = await loadLatestRun(customerId);

  if (!run || !run.profile || !run.validation) {
    console.error("No complete run found. Please run 'npm run test:kyc-pfds' first.");
    process.exit(1);
  }

  console.log("Building Default Report...");
  // No options passed - should default to Trace+Redacted in Demo Mode
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
  
  // Assertions for Demo Mode Report
  if (DEMO_CONFIG.enabled) {
      console.log("\n--- Verifying Demo Mode Report Content ---");
      
      const fullText = report.sections.map(s => s.body).join("\n");
      
      // 1. Check Trace Section Presence
      if (report.sections.some(s => s.title.includes("TRAZA"))) {
          console.log("✅ Trace section present by default.");
      } else {
          console.error("❌ FAILURE: Trace section missing.");
      }
      
      // 2. Check Bank Identity Presence
      if (fullText.includes("Identidad Bancaria")) {
          console.log("✅ 'Identidad Bancaria' mentioned.");
      } else {
          console.error("❌ FAILURE: 'Identidad Bancaria' missing.");
      }
      
      // 3. Check Absence of "6 Cuentas" or similar clutter
      if (!fullText.includes("Cuentas Bancarias: 6 detectadas")) {
          console.log("✅ Account clutter suppressed.");
      } else {
          console.error("❌ FAILURE: Account clutter present.");
      }
      
      // 4. Check UBO Table
      if (fullText.includes("| Accionista | Acciones |")) {
          console.log("✅ UBO Table present.");
      } else {
          console.error("❌ FAILURE: UBO Table missing.");
      }
  }

  console.log("\n=== JSON OUTPUT ===");
  console.log(JSON.stringify(report, null, 2));
}

main().catch(console.error);
