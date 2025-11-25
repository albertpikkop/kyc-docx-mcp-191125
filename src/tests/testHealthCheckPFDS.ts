/**
 * Test Health Check on PFDS real data
 * 
 * Loads the latest PFDS run and generates a Verificación Alta de Proveedor report.
 */

import * as fs from 'fs';
import * as path from 'path';
import { generateHealthCheck, printHealthCheck } from '../kyc/healthCheck.js';
import { KycRun } from '../kyc/types.js';

const DATA_DIR = '/Users/ashishpunj/kyc-docx-mcp-191125/data/pfds-gemini/runs';

async function main() {
  console.log('🔍 Loading latest PFDS run...\n');
  
  // Find the most recent run file
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => ({
      name: f,
      path: path.join(DATA_DIR, f),
      mtime: fs.statSync(path.join(DATA_DIR, f)).mtime
    }))
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  
  if (files.length === 0) {
    console.error('No run files found!');
    process.exit(1);
  }
  
  const latestFile = files[0];
  console.log(`📄 Using run: ${latestFile.name}`);
  console.log(`   Modified: ${latestFile.mtime.toISOString()}\n`);
  
  // Load the run
  const runData = JSON.parse(fs.readFileSync(latestFile.path, 'utf-8')) as KycRun;
  
  if (!runData.profile || !runData.validation) {
    console.error('Run does not have profile or validation data!');
    process.exit(1);
  }
  
  // Generate Health Check
  console.log('🏥 Generating Health Check Report...\n');
  const report = generateHealthCheck(runData.profile, runData.validation);
  
  // Print the report
  printHealthCheck(report);
  
  // Also output JSON for debugging
  console.log('\n📊 JSON Report:');
  console.log(JSON.stringify(report, null, 2));
}

main().catch(console.error);

