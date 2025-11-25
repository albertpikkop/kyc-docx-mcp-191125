import "dotenv/config";
import { loadLatestRun, saveRun } from "../kyc/storage.js";

const CLIENTS = ["enrique-cello", "grupo-pounj", "pfds"];

async function main() {
  console.log("🚀 Generating reports for clients...");

  for (const client of CLIENTS) {
    console.log(`\nProcessing client: ${client}`);
    try {
      const run = await loadLatestRun(client);
      
      if (!run) {
        console.warn(`⚠️ No existing run found for client: ${client}`);
        continue;
      }

      console.log(`📦 Loaded run ${run.runId} (Created: ${new Date(run.createdAt).toLocaleString()})`);
      
      // Regenerate reports
      const reportUrl = await saveRun(run);
      console.log(`✅ Report generated: ${reportUrl}`);
      
    } catch (error: any) {
      console.error(`❌ Failed to generate report for ${client}:`, error.message);
    }
  }
  
  console.log("\n✨ Done!");
}

main().catch(console.error);

