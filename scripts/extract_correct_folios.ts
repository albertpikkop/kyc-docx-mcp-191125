/**
 * Extract the correct folios from specific pages of the PFDS bundle
 * - Page 30: RNIE Folio de ingreso 255237
 * - Pages 25-26: SRE Folio 210831091011
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PDFDocument } from 'pdf-lib';
import { GoogleGenerativeAI } from '@google/generative-ai';

const BUNDLE_FILE = '/Users/ashishpunj/Desktop/mcp-docs/pfds/FME_REGISTRO_Nacional De Inversion Extranjera_Registo_Publico_de_ComercioPFDS_SAPI.pdf';
const OUTPUT_DIR = '/Users/ashishpunj/Desktop/mcp-docs/pfds/split';
const DATA_DIR = '/Users/ashishpunj/.cursor/worktrees/kyc-docx-mcp-191125/ttz/data/pfds-gemini';
const RUN_ID = 'run-f399f644-b004-4a19-808f-89c4a84588c4';

async function extractPages(inputPath: string, outputPath: string, pageNumbers: number[]): Promise<void> {
  const inputPdf = await PDFDocument.load(fs.readFileSync(inputPath));
  const outputPdf = await PDFDocument.create();
  
  for (const pageNum of pageNumbers) {
    // PDF pages are 0-indexed, but we're using 1-indexed
    const [page] = await outputPdf.copyPages(inputPdf, [pageNum - 1]);
    outputPdf.addPage(page);
  }
  
  const outputBytes = await outputPdf.save();
  fs.writeFileSync(outputPath, outputBytes);
  console.log(`✅ Created: ${outputPath} (pages ${pageNumbers.join(', ')})`);
}

async function main() {
  console.log('🔄 Extracting correct pages for RNIE and SRE folios...\n');

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

  // 1. Extract page 30 for RNIE Acuse with folio 255237
  console.log('📄 Extracting RNIE Acuse (page 30)...');
  const rnieOutputPath = path.join(OUTPUT_DIR, 'RNIE_Acuse_Page30_PFDS.pdf');
  await extractPages(BUNDLE_FILE, rnieOutputPath, [30]);

  // 2. Extract pages 25-26 for SRE Convenio with folio 210831091011
  console.log('📄 Extracting SRE Convenio (pages 25-26)...');
  const sreOutputPath = path.join(OUTPUT_DIR, 'SRE_Convenio_Pages25_26_PFDS.pdf');
  await extractPages(BUNDLE_FILE, sreOutputPath, [25, 26]);

  // 3. Now extract the folios from these new files
  console.log('\n🔍 Extracting RNIE folio from page 30...');
  
  const rniePdfBuffer = fs.readFileSync(rnieOutputPath);
  const rnieBase64 = rniePdfBuffer.toString('base64');
  
  const rniePrompt = `
Extract the "Folio de ingreso" number from this RNIE Acuse de recibo document.
The folio should be a 5-6 digit number like 255237.
Return ONLY the number, nothing else.
`;

  const rnieResult = await model.generateContent([
    { inlineData: { mimeType: 'application/pdf', data: rnieBase64 } },
    rniePrompt
  ]);
  const rnieFolio = rnieResult.response.text().trim();
  console.log(`   RNIE Folio: ${rnieFolio}`);

  console.log('\n🔍 Extracting SRE folio from pages 25-26...');
  
  const srePdfBuffer = fs.readFileSync(sreOutputPath);
  const sreBase64 = srePdfBuffer.toString('base64');
  
  const srePrompt = `
Extract the "folio número" from this SRE Convenio de Extranjería document.
The folio should be an 11-12 digit number like 210831091011.
Return ONLY the number, nothing else.
`;

  const sreResult = await model.generateContent([
    { inlineData: { mimeType: 'application/pdf', data: sreBase64 } },
    srePrompt
  ]);
  const sreFolio = sreResult.response.text().trim();
  console.log(`   SRE Folio: ${sreFolio}`);

  // 4. Update the run file with the correct folios
  console.log('\n📝 Updating run file with correct folios...');
  
  const runFile = path.join(DATA_DIR, 'runs', `${RUN_ID}.json`);
  const runData = JSON.parse(fs.readFileSync(runFile, 'utf-8'));
  
  // Update RNIE
  if (!runData.profile.rnieConstancia) {
    runData.profile.rnieConstancia = {};
  }
  runData.profile.rnieConstancia.folio_ingreso = rnieFolio.replace(/\D/g, '');
  console.log(`   ✅ Set rnieConstancia.folio_ingreso = ${rnieFolio.replace(/\D/g, '')}`);
  
  // Update SRE
  if (!runData.profile.sreConvenio) {
    runData.profile.sreConvenio = {};
  }
  runData.profile.sreConvenio.folio = sreFolio.replace(/\D/g, '');
  console.log(`   ✅ Set sreConvenio.folio = ${sreFolio.replace(/\D/g, '')}`);
  
  // Write back
  fs.writeFileSync(runFile, JSON.stringify(runData, null, 2));
  console.log(`\n✅ Run file updated: ${runFile}`);

  // 5. Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 EXTRACTION SUMMARY');
  console.log('='.repeat(60));
  console.log(`✅ RNIE Folio de ingreso: ${rnieFolio.replace(/\D/g, '')} (page 30)`);
  console.log(`✅ SRE Folio: ${sreFolio.replace(/\D/g, '')} (pages 25-26)`);
  console.log(`✅ CUD: ${runData.profile.autorizacionDenominacion?.cud || 'Already extracted'}`);
  console.log(`✅ FME: ${runData.profile.boletaRPC?.numero_unico_documento || 'Already extracted'}`);
}

main().catch(console.error);

