/**
 * Script to import all split PFDS bundle documents
 * This imports the new document types: boleta_rpc, rnie_constancia, sre_convenio, autorizacion_denominacion
 * Plus the personal SAT constancias for shareholders
 */

// MUST load dotenv FIRST before any other imports
import * as dotenv from 'dotenv';
dotenv.config();

// Now import everything else
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

// Import extractors (these will now see the env vars)
import { extractBoletaRPC } from '../src/extractors/boletaRPCExtractor.js';
import { extractRNIE } from '../src/extractors/rnieExtractor.js';
import { extractCompanyTaxProfile } from '../src/extractors/companyTaxProfileExtractor.js';
import { saveRun, loadLatestRun } from '../src/kyc/storage.js';
import type { KycDocument, DocumentType } from '../src/kyc/types.js';

const SPLIT_DIR = '/Users/ashishpunj/Desktop/mcp-docs/pfds/split';
const CUSTOMER_ID = 'pfds-gemini';

interface DocumentToImport {
  fileName: string;
  docType: DocumentType;
  description: string;
}

const DOCUMENTS_TO_IMPORT: DocumentToImport[] = [
  { fileName: 'Boleta_RPC_PFDS.pdf', docType: 'boleta_rpc', description: 'Boleta de Inscripción RPC (FME)' },
  { fileName: 'RNIE_Acuse_PFDS.pdf', docType: 'rnie_constancia', description: 'RNIE Acuse de Recibo' },
  { fileName: 'SAT_Constancia_Moises_Gonzalez.pdf', docType: 'sat_constancia', description: 'SAT Constancia - Moises Gonzalez' },
  { fileName: 'SAT_Constancia_Jose_Cerdan.pdf', docType: 'sat_constancia', description: 'SAT Constancia - Jose Cerdan' },
  // SRE Convenio and Autorización Denominación have placeholder extractors for now
  // { fileName: 'SRE_Convenio_Extranjeria_PFDS.pdf', docType: 'sre_convenio', description: 'SRE Convenio de Extranjería' },
  // { fileName: 'Autorizacion_Denominacion_PFDS.pdf', docType: 'autorizacion_denominacion', description: 'Autorización de Denominación' },
];

async function importDocument(docInfo: DocumentToImport): Promise<KycDocument | null> {
  const filePath = path.join(SPLIT_DIR, docInfo.fileName);
  
  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    return null;
  }
  
  console.log(`\n📄 Importing: ${docInfo.description}`);
  console.log(`   File: ${docInfo.fileName}`);
  console.log(`   Type: ${docInfo.docType}`);
  
  let extractedPayload: any = null;
  
  try {
    switch (docInfo.docType) {
      case 'boleta_rpc':
        const boletaResult = await extractBoletaRPC(filePath);
        if (boletaResult.success && boletaResult.data) {
          extractedPayload = boletaResult.data;
          console.log(`   ✅ FME: ${boletaResult.data.numero_unico_documento}`);
          console.log(`   ✅ Libro: ${boletaResult.data.libro}`);
          console.log(`   ✅ Fecha Inscripción: ${boletaResult.data.fecha_inscripcion}`);
        } else {
          console.error(`   ❌ Extraction failed: ${boletaResult.error}`);
          return null;
        }
        break;
        
      case 'rnie_constancia':
        const rnieResult = await extractRNIE(filePath);
        if (rnieResult.success && rnieResult.data) {
          extractedPayload = rnieResult.data;
          console.log(`   ✅ Folio RNIE: ${rnieResult.data.folio_ingreso}`);
          console.log(`   ✅ Fecha: ${rnieResult.data.fecha_recepcion}`);
        } else {
          console.error(`   ❌ Extraction failed: ${rnieResult.error}`);
          return null;
        }
        break;
        
      case 'sat_constancia':
        const satResult = await extractCompanyTaxProfile(filePath);
        if (satResult) {
          extractedPayload = satResult;
          console.log(`   ✅ RFC: ${satResult.rfc}`);
          console.log(`   ✅ Nombre: ${satResult.razon_social}`);
          console.log(`   ✅ CURP: ${satResult.curp || 'N/A'}`);
        } else {
          console.error(`   ❌ Extraction failed`);
          return null;
        }
        break;
        
      default:
        console.log(`   ⚠️ No extractor for type: ${docInfo.docType}`);
        extractedPayload = { document_type: docInfo.docType, note: 'Placeholder - extractor pending' };
    }
    
    const doc: KycDocument = {
      id: crypto.randomUUID(),
      customerId: CUSTOMER_ID,
      type: docInfo.docType,
      fileUrl: filePath,
      extractedAt: new Date().toISOString(),
      extractedPayload,
      sourceName: docInfo.fileName,
    };
    
    return doc;
    
  } catch (error) {
    console.error(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function main() {
  console.log('🚀 PFDS Bundle Import Script');
  console.log('============================\n');
  
  // Check API keys
  if (!process.env.GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY not set');
    process.exit(1);
  }
  console.log('✅ GEMINI_API_KEY found');
  
  // Load existing run
  let run = await loadLatestRun(CUSTOMER_ID);
  if (!run) {
    console.log('⚠️ No existing run found, creating new one');
    run = {
      runId: crypto.randomUUID(),
      customerId: CUSTOMER_ID,
      createdAt: new Date().toISOString(),
      documents: [],
    };
  } else {
    console.log(`📁 Found existing run: ${run.runId}`);
    console.log(`   Existing documents: ${run.documents.length}`);
  }
  
  // Import each document
  const importedDocs: KycDocument[] = [];
  
  for (const docInfo of DOCUMENTS_TO_IMPORT) {
    const doc = await importDocument(docInfo);
    if (doc) {
      importedDocs.push(doc);
    }
  }
  
  console.log(`\n✅ Successfully imported: ${importedDocs.length}/${DOCUMENTS_TO_IMPORT.length} documents`);
  
  // Merge with existing documents (avoid duplicates by type+sourceName)
  const existingKeys = new Set(run.documents.map(d => `${d.type}:${d.sourceName}`));
  const newDocs = importedDocs.filter(d => !existingKeys.has(`${d.type}:${d.sourceName}`));
  
  console.log(`   New documents to add: ${newDocs.length}`);
  
  run.documents = [...run.documents, ...newDocs];
  
  // Save updated run
  await saveRun(run);
  console.log(`\n💾 Saved run with ${run.documents.length} total documents`);
  
  // Summary
  console.log('\n📊 EXTRACTION SUMMARY');
  console.log('=====================');
  for (const doc of importedDocs) {
    const payload = doc.extractedPayload as any;
    console.log(`\n${doc.type.toUpperCase()}:`);
    
    if (doc.type === 'boleta_rpc' && payload) {
      console.log(`  FME: ${payload.numero_unico_documento}`);
      console.log(`  Libro: ${payload.libro}`);
      console.log(`  Fecha Inscripción: ${payload.fecha_inscripcion}`);
      console.log(`  Razón Social: ${payload.razon_social}`);
    } else if (doc.type === 'rnie_constancia' && payload) {
      console.log(`  Folio RNIE: ${payload.folio_ingreso}`);
      console.log(`  Fecha: ${payload.fecha_recepcion}`);
      console.log(`  Razón Social: ${payload.razon_social}`);
    } else if (doc.type === 'sat_constancia' && payload) {
      console.log(`  RFC: ${payload.rfc}`);
      console.log(`  Nombre: ${payload.razon_social}`);
      console.log(`  CURP: ${payload.curp || 'N/A'}`);
    }
  }
  
  console.log('\n✅ Import complete! Run build_kyc_profile to update the profile.');
}

main().catch(console.error);

