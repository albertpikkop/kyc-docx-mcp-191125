import * as fs from 'fs';

const geminiRun = JSON.parse(fs.readFileSync('data/grupo-pounj-gemini/runs/run-5a710207-b420-4d12-af11-f934b51dac5c.json', 'utf-8'));
const gptRun = JSON.parse(fs.readFileSync('data/grupo-pounj/runs/run-78e6ace7-1b44-4a04-973d-7885878ecbe1.json', 'utf-8'));

console.log('='.repeat(80));
console.log('GRUPO POUNJ - SIDE-BY-SIDE COMPARISON');
console.log('='.repeat(80));
console.log(`\nGemini Run: ${geminiRun.runId}`);
console.log(`GPT Run: ${gptRun.runId}`);
console.log(`\nGemini Score: ${geminiRun.validation?.score || 'N/A'}`);
console.log(`GPT Score: ${gptRun.validation?.score || 'N/A'}`);

// Compare documents
const geminiDocs = new Map();
const gptDocs = new Map();

geminiRun.documents?.forEach((doc: any) => {
  geminiDocs.set(doc.type, doc);
});

gptRun.documents?.forEach((doc: any) => {
  gptDocs.set(doc.type, doc);
});

const allTypes = new Set([...geminiDocs.keys(), ...gptDocs.keys()]);

for (const docType of allTypes) {
  console.log('\n' + '='.repeat(80));
  console.log(`DOCUMENT TYPE: ${docType.toUpperCase()}`);
  console.log('='.repeat(80));
  
  const geminiDoc = geminiDocs.get(docType);
  const gptDoc = gptDocs.get(docType);
  
  if (!geminiDoc) {
    console.log('\n❌ Gemini: MISSING');
    console.log('✅ GPT: Present');
    continue;
  }
  
  if (!gptDoc) {
    console.log('\n✅ Gemini: Present');
    console.log('❌ GPT: MISSING');
    continue;
  }
  
  console.log('\n--- KEY FIELDS COMPARISON ---\n');
  
  const geminiPayload = geminiDoc.extractedPayload || {};
  const gptPayload = gptDoc.extractedPayload || {};
  
  // Compare based on document type
  if (docType === 'acta') {
    console.log('Company Name:');
    console.log(`  Gemini: ${geminiPayload.razon_social || 'N/A'}`);
    console.log(`  GPT:    ${gptPayload.razon_social || 'N/A'}`);
    
    console.log('\nIncorporation Date:');
    console.log(`  Gemini: ${geminiPayload.incorporation_date || 'N/A'}`);
    console.log(`  GPT:    ${gptPayload.incorporation_date || 'N/A'}`);
    
    console.log('\nLegal Representatives:');
    const geminiReps = geminiPayload.legal_representatives || [];
    const gptReps = gptPayload.legal_representatives || [];
    console.log(`  Gemini: ${geminiReps.length} representatives`);
    console.log(`  GPT:    ${gptReps.length} representatives`);
    
    if (geminiReps.length > 0 && gptReps.length > 0) {
      console.log('\n  First Representative Powers:');
      const geminiPowers = geminiReps[0]?.poder_scope || [];
      const gptPowers = gptReps[0]?.poder_scope || [];
      console.log(`    Gemini: ${geminiPowers.length} powers`);
      console.log(`    GPT:    ${gptPowers.length} powers`);
      if (geminiPowers.length > 0) {
        console.log(`    Gemini Sample: ${geminiPowers[0]?.substring(0, 80)}...`);
      }
      if (gptPowers.length > 0) {
        console.log(`    GPT Sample:    ${gptPowers[0]?.substring(0, 80)}...`);
      }
    }
    
    console.log('\nShareholders:');
    const geminiShareholders = geminiPayload.shareholders || [];
    const gptShareholders = gptPayload.shareholders || [];
    console.log(`  Gemini: ${geminiShareholders.length} shareholders`);
    console.log(`  GPT:    ${gptShareholders.length} shareholders`);
    
  } else if (docType === 'sat_constancia') {
    console.log('RFC:');
    console.log(`  Gemini: ${geminiPayload.rfc || 'N/A'}`);
    console.log(`  GPT:    ${gptPayload.rfc || 'N/A'}`);
    
    console.log('\nFiscal Address:');
    const geminiAddr = geminiPayload.fiscal_address || {};
    const gptAddr = gptPayload.fiscal_address || {};
    console.log(`  Gemini: ${geminiAddr.street || 'N/A'} ${geminiAddr.ext_number || ''}, ${geminiAddr.colonia || 'N/A'}`);
    console.log(`  GPT:    ${gptAddr.street || 'N/A'} ${gptAddr.ext_number || ''}, ${gptAddr.colonia || 'N/A'}`);
    
    console.log('\nEconomic Activities:');
    const geminiActs = geminiPayload.economic_activities || [];
    const gptActs = gptPayload.economic_activities || [];
    console.log(`  Gemini: ${geminiActs.length} activities`);
    console.log(`  GPT:    ${gptActs.length} activities`);
    
  } else if (docType === 'fm2') {
    console.log('Full Name:');
    console.log(`  Gemini: ${geminiPayload.full_name || 'N/A'}`);
    console.log(`  GPT:    ${gptPayload.full_name || 'N/A'}`);
    
    console.log('\nDocument Number:');
    console.log(`  Gemini: ${geminiPayload.document_number || 'N/A'}`);
    console.log(`  GPT:    ${gptPayload.document_number || 'N/A'}`);
    
    console.log('\nCURP:');
    console.log(`  Gemini: ${geminiPayload.curp || 'N/A'}`);
    console.log(`  GPT:    ${gptPayload.curp || 'N/A'}`);
    
    console.log('\nDate of Birth:');
    console.log(`  Gemini: ${geminiPayload.date_of_birth || 'N/A'}`);
    console.log(`  GPT:    ${gptPayload.date_of_birth || 'N/A'}`);
    
  } else if (docType === 'cfe') {
    console.log('Client Name:');
    console.log(`  Gemini: ${geminiPayload.client_name || 'N/A'}`);
    console.log(`  GPT:    ${gptPayload.client_name || 'N/A'}`);
    
    console.log('\nClient Address:');
    const geminiAddr = geminiPayload.client_address || {};
    const gptAddr = gptPayload.client_address || {};
    console.log(`  Gemini: ${geminiAddr.street || 'N/A'} ${geminiAddr.ext_number || ''}, ${geminiAddr.colonia || 'N/A'}`);
    console.log(`  GPT:    ${gptAddr.street || 'N/A'} ${gptAddr.ext_number || ''}, ${gptAddr.colonia || 'N/A'}`);
    
    console.log('\nPostal Code:');
    console.log(`  Gemini: ${geminiAddr.cp || 'N/A'}`);
    console.log(`  GPT:    ${gptAddr.cp || 'N/A'}`);
    
  } else if (docType === 'bank_identity_page') {
    console.log('Bank Name:');
    console.log(`  Gemini: ${geminiPayload.bank_name || 'N/A'}`);
    console.log(`  GPT:    ${gptPayload.bank_name || 'N/A'}`);
    
    console.log('\nAccount Holder:');
    console.log(`  Gemini: ${geminiPayload.account_holder_name || 'N/A'}`);
    console.log(`  GPT:    ${gptPayload.account_holder_name || 'N/A'}`);
    
    console.log('\nCLABE:');
    console.log(`  Gemini: ${geminiPayload.clabe || 'N/A'}`);
    console.log(`  GPT:    ${gptPayload.clabe || 'N/A'}`);
  }
}

console.log('\n' + '='.repeat(80));
console.log('VALIDATION COMPARISON');
console.log('='.repeat(80));
console.log(`\nGemini Score: ${geminiRun.validation?.score || 'N/A'}`);
console.log(`Gemini Flags: ${geminiRun.validation?.flags?.length || 0}`);
if (geminiRun.validation?.flags?.length > 0) {
  geminiRun.validation.flags.forEach((flag: string) => console.log(`  - ${flag}`));
}

console.log(`\nGPT Score: ${gptRun.validation?.score || 'N/A'}`);
console.log(`GPT Flags: ${gptRun.validation?.flags?.length || 0}`);
if (gptRun.validation?.flags?.length > 0) {
  gptRun.validation.flags.forEach((flag: string) => console.log(`  - ${flag}`));
}

console.log('\n' + '='.repeat(80));

