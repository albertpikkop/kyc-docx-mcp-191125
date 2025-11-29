/**
 * Regenerate the PFDS KYC report with all the updated data
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = '/Users/ashishpunj/.cursor/worktrees/kyc-docx-mcp-191125/ttz/data/pfds-gemini';
const RUN_ID = 'run-f399f644-b004-4a19-808f-89c4a84588c4';

async function main() {
  console.log('📊 Regenerating PFDS KYC Report...\n');

  // Import the report generator
  const { generateVisualReport } = await import('../src/kyc/storage.js');
  const { validateKycProfile } = await import('../src/kyc/validation.js');

  // Load the run file
  const runFile = path.join(DATA_DIR, 'runs', `${RUN_ID}.json`);
  const runData = JSON.parse(fs.readFileSync(runFile, 'utf-8'));

  console.log('📋 Current Profile Data:');
  console.log('   Company:', runData.profile.companyIdentity?.razon_social);
  console.log('   RFC:', runData.profile.companyTaxProfile?.rfc);
  console.log('   FME:', runData.profile.boletaRPC?.numero_unico_documento);
  console.log('   RNIE Folio:', runData.profile.rnieConstancia?.folio_ingreso);
  console.log('   SRE Folio:', runData.profile.sreConvenio?.folio);
  console.log('   CUD:', runData.profile.autorizacionDenominacion?.cud);

  // Re-run validation with updated profile
  console.log('\n🔍 Re-running validation...');
  const validation = validateKycProfile(runData.profile);
  console.log('   Score:', Math.round(validation.score * 100) + '/100');
  console.log('   Flags:', validation.flags.length);
  
  for (const flag of validation.flags) {
    const icon = flag.level === 'critical' ? '🔴' : flag.level === 'warning' ? '🟡' : 'ℹ️';
    console.log(`   ${icon} [${flag.code}] ${flag.message?.substring(0, 60)}...`);
  }

  // Update validation in run data
  runData.validation = validation;

  // Generate new report using the visual report generator
  console.log('\n📝 Generating HTML report...');
  const reportHtml = await generateVisualReport(runData);

  // Save report
  const reportFileName = `report-${RUN_ID.replace('run-', '')}-updated.html`;
  const reportPath = path.join(DATA_DIR, 'reports', reportFileName);
  fs.writeFileSync(reportPath, reportHtml);
  console.log(`   ✅ Report saved: ${reportPath}`);

  // Save updated run file
  fs.writeFileSync(runFile, JSON.stringify(runData, null, 2));
  console.log(`   ✅ Run file updated: ${runFile}`);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 FINAL EXTRACTION STATUS');
  console.log('='.repeat(60));
  
  const checks = [
    { name: 'FME (Folio Mercantil Electrónico)', value: runData.profile.boletaRPC?.numero_unico_documento },
    { name: 'RNIE Folio de Ingreso', value: runData.profile.rnieConstancia?.folio_ingreso },
    { name: 'SRE Convenio Folio', value: runData.profile.sreConvenio?.folio },
    { name: 'CUD (Autorización Denominación)', value: runData.profile.autorizacionDenominacion?.cud },
    { name: 'Company RFC', value: runData.profile.companyTaxProfile?.rfc },
    { name: 'Libro RPC', value: runData.profile.boletaRPC?.libro },
    { name: 'Fecha Inscripción', value: runData.profile.boletaRPC?.fecha_inscripcion },
  ];

  for (const check of checks) {
    const status = check.value ? '✅' : '❌';
    console.log(`${status} ${check.name}: ${check.value || 'NOT EXTRACTED'}`);
  }

  console.log('\n📄 Report available at:');
  console.log(`   file://${reportPath}`);
}

main().catch(console.error);

