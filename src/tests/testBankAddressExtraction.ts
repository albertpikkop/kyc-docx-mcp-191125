/**
 * Test Bank Statement Address Extraction with Enhanced Instructions
 * 
 * This test specifically focuses on extracting the address from the Kapital bank statement
 * to verify if the address is present and can be matched with operational address.
 */

import "dotenv/config";
import * as fs from 'fs';
import * as path from 'path';
import { extractWithGemini } from '../utils/geminiExtractor.js';
import { GEMINI_PRO_MODEL } from '../modelGemini.js';
import { BankAccountProfileSchema } from '../schemas/mx/bankAccountProfile.js';

// Enhanced instructions specifically for address extraction
const BANK_ADDRESS_INSTRUCTIONS = `
You are a strict KYC extractor for Mexican Bank Statements. Your PRIMARY GOAL is to extract the customer's ADDRESS from the bank statement.

CRITICAL: LOOK FOR THE ADDRESS CAREFULLY!
The address is typically found:
1. In the header section near the account holder's name
2. In a "Datos del Cliente" or "Información del Titular" section
3. Near the top of the first page, often in smaller print
4. Sometimes in a box or highlighted area with customer details

EXTRACT THE FOLLOWING:
1. bank_name: The name of the bank (e.g., "Kapital", "BBVA", "Santander")
2. account_holder_name: The legal name of the account holder (company or person name)
   - CRITICAL: This should be the LEGAL NAME (e.g., "PFDS", "GRUPO POUNJ"), NOT an address component
   - Look for labels like "Cliente:", "Titular:", "Nombre:", "Razón Social:"
3. account_number: The account number if visible
4. clabe: The 18-digit CLABE interbancaria
5. currency: MXN or USD
6. statement_period_start: Start date (YYYY-MM-DD)
7. statement_period_end: End date (YYYY-MM-DD)
8. address_on_statement: The customer's address as printed on the statement
   - Look for: street, exterior number, interior number, colonia, municipio/delegación, estado, CP (código postal)
   - CRITICAL: Even if the address is partial, extract what you can find
   - If you see "Domicilio:", "Dirección:", or similar labels, extract that address

GLOBAL RULES:
- Never infer or generate data not clearly printed
- If a field is not present, set to null
- Normalize all dates to YYYY-MM-DD
- For address_on_statement: Extract ANY address information you can find, even if incomplete
- DO NOT confuse address parts (like "Veronica Anzures" which is a colonia) with the account holder name

Return valid JSON matching the schema.
`;

const bankStatementPath = "/Users/ashishpunj/Desktop/mcp-docs/pfds/Esatdo_De_Cuenta_Octubre_2025.pdf";

async function main() {
  console.log('🏦 Testing Bank Statement Address Extraction\n');
  console.log(`📄 File: ${path.basename(bankStatementPath)}`);
  console.log(`🤖 Model: ${GEMINI_PRO_MODEL}\n`);
  
  if (!fs.existsSync(bankStatementPath)) {
    console.error('❌ Bank statement file not found!');
    process.exit(1);
  }
  
  console.log('Extracting with enhanced address instructions...\n');
  
  try {
    const result = await extractWithGemini(
      bankStatementPath,
      'application/pdf',
      BankAccountProfileSchema,
      BANK_ADDRESS_INSTRUCTIONS,
      GEMINI_PRO_MODEL  // Use Pro model for better extraction
    );
    
    const profile = result.bank_account_profile || result;
    
    console.log('═'.repeat(60));
    console.log('EXTRACTION RESULTS');
    console.log('═'.repeat(60));
    console.log(`Bank Name:        ${profile.bank_name || 'N/A'}`);
    console.log(`Account Holder:   ${profile.account_holder_name || 'N/A'}`);
    console.log(`Account Number:   ${profile.account_number || 'N/A'}`);
    console.log(`CLABE:            ${profile.clabe || 'N/A'}`);
    console.log(`Currency:         ${profile.currency || 'N/A'}`);
    console.log(`Period:           ${profile.statement_period_start || 'N/A'} to ${profile.statement_period_end || 'N/A'}`);
    console.log('─'.repeat(60));
    console.log('ADDRESS ON STATEMENT:');
    
    if (profile.address_on_statement) {
      const addr = profile.address_on_statement;
      console.log(`  Street:         ${addr.street || 'N/A'}`);
      console.log(`  Ext Number:     ${addr.ext_number || 'N/A'}`);
      console.log(`  Int Number:     ${addr.int_number || 'N/A'}`);
      console.log(`  Colonia:        ${addr.colonia || 'N/A'}`);
      console.log(`  Municipio:      ${addr.municipio || 'N/A'}`);
      console.log(`  Estado:         ${addr.estado || 'N/A'}`);
      console.log(`  CP:             ${addr.cp || 'N/A'}`);
      console.log(`  Country:        ${addr.country || 'N/A'}`);
    } else {
      console.log('  ⚠️  NO ADDRESS FOUND ON STATEMENT');
    }
    
    console.log('═'.repeat(60));
    
    // Compare with expected operational address (from SAT/Telmex)
    const expectedAddress = {
      street: "CALLE GUTENBERG",
      ext_number: "60",
      colonia: "VERONICA ANZURES",
      cp: "11300"
    };
    
    console.log('\n📍 ADDRESS VERIFICATION:');
    console.log('─'.repeat(60));
    console.log('Expected (from SAT/Telmex):');
    console.log(`  ${expectedAddress.street} #${expectedAddress.ext_number}`);
    console.log(`  Col. ${expectedAddress.colonia}, CP ${expectedAddress.cp}`);
    console.log('');
    
    if (profile.address_on_statement?.cp) {
      const extractedCp = profile.address_on_statement.cp?.replace(/[^0-9]/g, '').substring(0, 5);
      const expectedCp = expectedAddress.cp;
      
      if (extractedCp === expectedCp) {
        console.log('✅ ADDRESS MATCH: CP codes match!');
      } else {
        console.log(`⚠️  ADDRESS MISMATCH: Extracted CP (${extractedCp}) ≠ Expected CP (${expectedCp})`);
      }
    } else {
      console.log('⚠️  Cannot verify: No address extracted from bank statement');
    }
    
    console.log('\n📊 Full JSON Output:');
    console.log(JSON.stringify(profile, null, 2));
    
  } catch (error) {
    console.error('❌ Extraction failed:', error);
  }
}

main().catch(console.error);

