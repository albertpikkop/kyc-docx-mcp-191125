/**
 * Script to rebuild PFDS profile and generate report
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { loadLatestRun, saveRun, generateVisualReport } from '../src/kyc/storage.js';
import { buildKycProfile } from '../src/kyc/profileBuilder.js';
import { validateKycProfile } from '../src/kyc/validation.js';
import { buildKycReport } from '../src/kyc/reportBuilder.js';
import type { KycProfile, KycValidationResult } from '../src/kyc/types.js';

const CUSTOMER_ID = 'pfds-gemini';

async function main() {
  console.log('🚀 PFDS Profile Rebuild Script');
  console.log('==============================\n');
  
  // Load existing run
  const run = await loadLatestRun(CUSTOMER_ID);
  if (!run) {
    console.error('❌ No run found for customer:', CUSTOMER_ID);
    process.exit(1);
  }
  
  console.log(`📁 Loaded run: ${run.runId}`);
  console.log(`   Documents: ${run.documents.length}`);
  
  // Show document types
  const docTypes = run.documents.reduce((acc, doc) => {
    acc[doc.type] = (acc[doc.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  console.log('\n📄 Document Types:');
  for (const [type, count] of Object.entries(docTypes)) {
    console.log(`   - ${type}: ${count}`);
  }
  
  // Build profile
  console.log('\n🔨 Building profile...');
  
  // Extract data from documents
  let companyIdentity: any = null;
  let companyTaxProfile: any = null;
  let representativeIdentity: any = null;
  let passportIdentity: any = null;
  const proofsOfAddress: any[] = [];
  const bankAccounts: any[] = [];
  let boletaRPC: any = null;
  let rnieConstancia: any = null;
  const personalSats: any[] = [];
  
  for (const doc of run.documents) {
    const payload = doc.extractedPayload as any;
    if (!payload) continue;
    
    switch (doc.type) {
      case 'acta':
        companyIdentity = payload;
        break;
      case 'sat_constancia':
        // Check if company or personal SAT
        const rfcPattern = /^[A-Z]{3}\d{6}[A-Z0-9]{3}$/i;
        if (payload.rfc && rfcPattern.test(payload.rfc)) {
          companyTaxProfile = payload;
        } else {
          personalSats.push(payload);
        }
        break;
      case 'fm2':
      case 'ine':
        representativeIdentity = payload;
        break;
      case 'passport':
        passportIdentity = payload.passport_identity || payload;
        break;
      case 'telmex':
      case 'cfe':
        proofsOfAddress.push(payload);
        break;
      case 'bank_statement':
      case 'bank_identity_page':
        if (payload) bankAccounts.push(payload);
        break;
      case 'boleta_rpc':
        boletaRPC = payload;
        console.log(`   Found Boleta RPC: FME=${payload.numero_unico_documento}`);
        break;
      case 'rnie_constancia':
        rnieConstancia = payload;
        console.log(`   Found RNIE: Folio=${payload.folio_ingreso || 'N/A'}`);
        break;
    }
  }
  
  // Build the profile using the profile builder
  const profile = buildKycProfile({
    customerId: CUSTOMER_ID,
    companyIdentity,
    companyTaxProfile,
    representativeIdentity,
    passportIdentity,
    proofsOfAddress,
    bankAccounts,
  });
  
  // Add the new registry documents
  if (boletaRPC) {
    (profile as any).boletaRPC = boletaRPC;
  }
  if (rnieConstancia) {
    (profile as any).rnieConstancia = rnieConstancia;
  }
  if (personalSats.length > 0) {
    (profile as any)._personalSatConstancias = personalSats.map(sat => ({
      rfc: sat.rfc,
      razon_social: sat.razon_social,
      curp: sat.curp,
    }));
  }
  
  console.log('\n✅ Profile built');
  console.log(`   Company: ${profile.companyIdentity?.razon_social || 'N/A'}`);
  console.log(`   RFC: ${profile.companyTaxProfile?.rfc || 'N/A'}`);
  console.log(`   Boleta RPC FME: ${(profile as any).boletaRPC?.numero_unico_documento || 'Not imported'}`);
  console.log(`   RNIE Folio: ${(profile as any).rnieConstancia?.folio_ingreso || 'Not imported'}`);
  
  // Validate
  console.log('\n🔍 Validating profile...');
  const validation = validateKycProfile(profile);
  
  console.log(`   Score: ${validation.score}`);
  console.log(`   Flags: ${validation.flags.length}`);
  
  // Update run with profile and validation
  run.profile = profile;
  run.validation = validation;
  
  // Save
  await saveRun(run);
  console.log('\n💾 Run saved');
  
  // Generate report
  console.log('\n📊 Generating report...');
  const reportPath = await generateVisualReport(run, validation);
  console.log(`   Report saved to: ${reportPath}`);
  
  // Summary
  console.log('\n📋 FINAL SUMMARY');
  console.log('================');
  console.log(`Company: ${profile.companyIdentity?.razon_social}`);
  console.log(`RFC: ${profile.companyTaxProfile?.rfc}`);
  console.log(`FME: ${(profile as any).boletaRPC?.numero_unico_documento || '❌ Missing'}`);
  console.log(`Libro: ${(profile as any).boletaRPC?.libro || '❌ Missing'}`);
  console.log(`RNIE Folio: ${(profile as any).rnieConstancia?.folio_ingreso || '❌ Missing'}`);
  console.log(`Score: ${validation.score}/100`);
  console.log(`\n🌐 View report at: file://${reportPath}`);
}

main().catch(console.error);

