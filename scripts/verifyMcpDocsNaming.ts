#!/usr/bin/env tsx
/**
 * Verify all documents in mcp-docs follow standardized naming convention
 * Format: {DocumentType}_{Company}_{OptionalDate}.{ext}
 */

import * as fs from 'fs';
import * as path from 'path';

const MCP_DOCS = path.join(process.env.HOME || '/Users/ashishpunj', 'Desktop', 'mcp-docs');

const EXPECTED_PATTERNS = {
  'Acta_Constitutiva': /^Acta_Constitutiva_[a-z-]+\.pdf$/i,
  'SAT_Constancia': /^SAT_Constancia_[a-z-]+\.pdf$/i,
  'FM2': /^FM2_[a-z-]+\.(pdf|jpg|jpeg|png)$/i,
  'INE': /^INE_[a-z-]+\.(pdf|jpg|jpeg|png)$/i,
  // Passport can have person name: Passport_Front_{PersonName}_{Company}.{ext}
  'Passport_Front': /^Passport_Front_([A-Za-z_]+)_[a-z-]+\.(jpg|jpeg|png|pdf)$/i,
  'Telmex_Recibo': /^Telmex_Recibo_[a-z-]+_Octubre_\d{4}\.pdf$/i,
  'CFE_Recibo': /^CFE_Recibo_[a-z-]+_Octubre_\d{4}\.pdf$/i,
  'Bank_Estado_Cuenta': /^Bank_Estado_Cuenta_[a-z-]+_Octubre_\d{4}\.pdf$/i,
};

function verifyCustomerFiles(customerDir: string, customerName: string): { valid: string[]; invalid: string[]; skipped: string[] } {
  const files = fs.readdirSync(customerDir).filter(f => 
    !f.startsWith('.') && 
    (f.endsWith('.pdf') || f.endsWith('.PDF') || 
     f.endsWith('.jpg') || f.endsWith('.jpeg') || 
     f.endsWith('.png') || f.endsWith('.JPG') || f.endsWith('.JPEG'))
  );

  const valid: string[] = [];
  const invalid: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const fileLower = file.toLowerCase();
    
    // Skip backside passport files
    if (fileLower.includes('backside')) {
      skipped.push(file);
      continue;
    }

    // Check against expected patterns
    let matched = false;
    for (const [docType, pattern] of Object.entries(EXPECTED_PATTERNS)) {
      if (pattern.test(file)) {
        valid.push(file);
        matched = true;
        break;
      }
    }

    if (!matched) {
      invalid.push(file);
    }
  }

  return { valid, invalid, skipped };
}

function main() {
  console.log('🔍 Verifying document naming in mcp-docs folder...\n');
  console.log(`📂 Target directory: ${MCP_DOCS}\n`);

  if (!fs.existsSync(MCP_DOCS)) {
    console.error(`❌ mcp-docs folder not found at: ${MCP_DOCS}`);
    process.exit(1);
  }

  const dirs = fs.readdirSync(MCP_DOCS).filter(d => {
    const dirPath = path.join(MCP_DOCS, d);
    return fs.statSync(dirPath).isDirectory() && !d.startsWith('.') && d !== 'MCP-Improvements';
  });

  let allValid = true;

  for (const dir of dirs) {
    const customerPath = path.join(MCP_DOCS, dir);
    const { valid, invalid, skipped } = verifyCustomerFiles(customerPath, dir);

    console.log(`📁 ${dir}:`);
    console.log(`   ✅ Valid: ${valid.length} files`);
    if (valid.length > 0) {
      valid.forEach(f => console.log(`      - ${f}`));
    }
    
    if (skipped.length > 0) {
      console.log(`   ⏭️  Skipped (backside): ${skipped.length} files`);
      skipped.forEach(f => console.log(`      - ${f}`));
    }
    
    if (invalid.length > 0) {
      console.log(`   ❌ Invalid naming: ${invalid.length} files`);
      invalid.forEach(f => console.log(`      - ${f}`));
      allValid = false;
    }
    console.log('');
  }

  if (allValid) {
    console.log('✅ All files follow standardized naming convention!');
    process.exit(0);
  } else {
    console.log('❌ Some files need renaming. Please review the invalid files above.');
    process.exit(1);
  }
}

main();

