/**
 * Regenerate HTML report from existing run data (no API calls)
 * Usage: npx tsx src/tests/regenerateReport.ts <customer-folder>
 */

import * as fs from 'fs';
import * as path from 'path';
import { saveRun } from '../kyc/storage.js';

async function regenerateReport(customerFolder: string) {
  const dataDir = path.join(process.cwd(), 'data', customerFolder);
  
  if (!fs.existsSync(dataDir)) {
    console.error(`❌ Folder not found: ${dataDir}`);
    process.exit(1);
  }
  
  // Find the latest run file
  const runsDir = path.join(dataDir, 'runs');
  if (!fs.existsSync(runsDir)) {
    console.error(`❌ No runs directory found in ${dataDir}`);
    process.exit(1);
  }
  
  const runFiles = fs.readdirSync(runsDir)
    .filter(f => f.startsWith('run-') && f.endsWith('.json'))
    .map(f => ({
      name: f,
      path: path.join(runsDir, f),
      mtime: fs.statSync(path.join(runsDir, f)).mtime
    }))
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  
  if (runFiles.length === 0) {
    console.error(`❌ No run files found in ${runsDir}`);
    process.exit(1);
  }
  
  const latestRun = runFiles[0];
  console.log(`📄 Using run: ${latestRun.name}`);
  
  // Load the run data
  const runData = JSON.parse(fs.readFileSync(latestRun.path, 'utf-8'));
  
  // Re-save run to regenerate HTML report with updated template
  console.log(`🔄 Regenerating HTML report...`);
  const reportUrl = await saveRun(runData);
  
  // Get the actual file path
  const reportsDir = path.join(dataDir, 'reports');
  const reportPath = path.join(reportsDir, `report-${runData.runId}.html`);
  
  console.log(`✅ Report generated!`);
  console.log(`\n🌐 Open in browser:`);
  console.log(`   ${reportUrl}`);
  
  return reportPath;
}

// Main
const customerFolder = process.argv[2];

if (!customerFolder) {
  console.log('Usage: npx tsx src/tests/regenerateReport.ts <customer-folder>');
  console.log('Example: npx tsx src/tests/regenerateReport.ts grupo-pounj-gemini');
  process.exit(1);
}

regenerateReport(customerFolder).then(reportPath => {
  // Auto-open in browser using spawn (ESM compatible)
  import('child_process').then(({ exec }) => {
    exec(`open "${reportPath}"`);
  });
}).catch(console.error);

