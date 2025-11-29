/**
 * Re-import PFDS registry documents with improved extractors
 * - RNIE Acuse (for folio 255237)
 * - SRE Convenio (for folio 21083109101)
 * - Autorización Denominación (for CUD A202103260225274610)
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

// Ensure API key is set
if (!process.env.GEMINI_API_KEY) {
  console.error('❌ GEMINI_API_KEY not set');
  process.exit(1);
}

const SPLIT_DIR = '/Users/ashishpunj/Desktop/mcp-docs/pfds/split';
const DATA_DIR = '/Users/ashishpunj/.cursor/worktrees/kyc-docx-mcp-191125/ttz/data/pfds-gemini';
const RUN_ID = 'run-f399f644-b004-4a19-808f-89c4a84588c4';

interface ExtractionResult {
  success: boolean;
  data?: any;
  error?: string;
  modelUsed?: string;
}

async function main() {
  console.log('🔄 Re-importing PFDS registry documents with improved extractors...\n');

  // Import extractors dynamically to ensure API key is loaded
  const { extractRNIE } = await import('../src/extractors/rnieExtractor.js');
  const { extractSREConvenio } = await import('../src/extractors/sreConvenioExtractor.js');
  const { extractAutorizacionDenominacion } = await import('../src/extractors/autorizacionDenominacionExtractor.js');

  const documents = [
    {
      name: 'RNIE Acuse',
      file: path.join(SPLIT_DIR, 'RNIE_Acuse_PFDS.pdf'),
      extractor: extractRNIE,
      docType: 'rnie_constancia',
      expectedField: 'folio_ingreso',
      expectedValue: '255237'
    },
    {
      name: 'SRE Convenio',
      file: path.join(SPLIT_DIR, 'SRE_Convenio_Extranjeria_PFDS.pdf'),
      extractor: extractSREConvenio,
      docType: 'sre_convenio',
      expectedField: 'folio',
      expectedValue: '21083109101'
    },
    {
      name: 'Autorización Denominación',
      file: path.join(SPLIT_DIR, 'Autorizacion_Denominacion_PFDS.pdf'),
      extractor: extractAutorizacionDenominacion,
      docType: 'autorizacion_denominacion',
      expectedField: 'cud',
      expectedValue: 'A202103260225274610'
    }
  ];

  const results: Record<string, any> = {};

  for (const doc of documents) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📄 Extracting: ${doc.name}`);
    console.log(`   File: ${doc.file}`);
    console.log(`   Expected ${doc.expectedField}: ${doc.expectedValue}`);
    console.log('='.repeat(60));

    if (!fs.existsSync(doc.file)) {
      console.error(`❌ File not found: ${doc.file}`);
      continue;
    }

    try {
      const result = await doc.extractor(doc.file) as ExtractionResult;
      
      if (result.success && result.data) {
        console.log(`\n✅ Extraction successful!`);
        console.log(`   Model used: ${result.modelUsed || 'unknown'}`);
        console.log(`\n📋 Extracted data:`);
        console.log(JSON.stringify(result.data, null, 2));
        
        // Check if expected field was extracted
        const extractedValue = result.data[doc.expectedField];
        if (extractedValue === doc.expectedValue) {
          console.log(`\n🎯 ${doc.expectedField}: ${extractedValue} ✅ MATCH!`);
        } else if (extractedValue) {
          console.log(`\n⚠️  ${doc.expectedField}: ${extractedValue} (expected: ${doc.expectedValue})`);
        } else {
          console.log(`\n❌ ${doc.expectedField}: NOT EXTRACTED (expected: ${doc.expectedValue})`);
        }
        
        results[doc.docType] = result.data;
      } else {
        console.error(`\n❌ Extraction failed: ${result.error}`);
      }
    } catch (error) {
      console.error(`\n❌ Error: ${error}`);
    }
  }

  // Update the run file with new data
  console.log(`\n\n${'='.repeat(60)}`);
  console.log('📝 Updating run file with extracted data...');
  console.log('='.repeat(60));

  const runFile = path.join(DATA_DIR, 'runs', `${RUN_ID}.json`);
  if (fs.existsSync(runFile)) {
    const runData = JSON.parse(fs.readFileSync(runFile, 'utf-8'));
    
    // Update profile with new data
    if (results.rnie_constancia) {
      runData.profile.rnieConstancia = results.rnie_constancia;
      console.log('✅ Updated rnieConstancia in profile');
    }
    if (results.sre_convenio) {
      runData.profile.sreConvenio = results.sre_convenio;
      console.log('✅ Updated sreConvenio in profile');
    }
    if (results.autorizacion_denominacion) {
      runData.profile.autorizacionDenominacion = results.autorizacion_denominacion;
      console.log('✅ Updated autorizacionDenominacion in profile');
    }
    
    // Write back
    fs.writeFileSync(runFile, JSON.stringify(runData, null, 2));
    console.log(`\n✅ Run file updated: ${runFile}`);
  } else {
    console.error(`❌ Run file not found: ${runFile}`);
  }

  // Summary
  console.log(`\n\n${'='.repeat(60)}`);
  console.log('📊 EXTRACTION SUMMARY');
  console.log('='.repeat(60));
  
  for (const doc of documents) {
    const data = results[doc.docType];
    const value = data?.[doc.expectedField];
    const status = value === doc.expectedValue ? '✅' : value ? '⚠️' : '❌';
    console.log(`${status} ${doc.name}: ${doc.expectedField} = ${value || 'NOT EXTRACTED'}`);
  }
}

main().catch(console.error);

