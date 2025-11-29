#!/usr/bin/env tsx
/**
 * Rename documents in mcp-docs folder to standardized naming convention
 */

import * as fs from 'fs';
import * as path from 'path';

const MCP_DOCS = path.join(process.env.HOME || '/Users/ashishpunj', 'Desktop', 'mcp-docs');

interface RenameRule {
  pattern: RegExp | ((filename: string) => boolean);
  newName: (filename: string, customerName: string) => string;
  docType: string;
}

function renameCustomerFiles(customerDir: string, customerName: string): void {
  const files = fs.readdirSync(customerDir).filter(f => 
    !f.startsWith('.') && 
    (f.endsWith('.pdf') || f.endsWith('.PDF') || 
     f.endsWith('.jpg') || f.endsWith('.jpeg') || 
     f.endsWith('.png') || f.endsWith('.JPG') || f.endsWith('.JPEG'))
  );

  console.log(`\n📁 Processing: ${customerName}`);
  console.log(`   Found ${files.length} files`);

  const renamed: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const filePath = path.join(customerDir, file);
    const fileLower = file.toLowerCase();
    const ext = path.extname(file).toLowerCase();
    
    // Skip backside passport files
    if (fileLower.includes('backside')) {
      skipped.push(file);
      console.log(`   ⏭️  Skipping backside: ${file}`);
      continue;
    }

    let newName: string | null = null;

    // Acta Constitutiva
    if ((fileLower.includes('acta') || fileLower.includes('constitutiva')) && ext === '.pdf') {
      if (!file.startsWith('Acta_Constitutiva_')) {
        newName = `Acta_Constitutiva_${customerName}.pdf`;
      }
    }
    // SAT Constancia
    else if ((fileLower.includes('constancia') || fileLower.includes('situacion fiscal') || fileLower.includes('gpo')) && ext === '.pdf') {
      if (!file.startsWith('SAT_Constancia_')) {
        newName = `SAT_Constancia_${customerName}.pdf`;
      }
    }
    // FM2
    else if ((fileLower.includes('fm2') || fileLower.includes('fm3') || fileLower.includes('residente')) && (ext === '.pdf' || ext === '.jpg' || ext === '.jpeg')) {
      if (!file.startsWith('FM2_')) {
        newName = `FM2_${customerName}${ext}`;
      }
    }
    // INE
    else if ((fileLower.includes('ine') || fileLower.includes('credencial')) && (ext === '.pdf' || ext === '.jpg' || ext === '.jpeg')) {
      if (!file.startsWith('INE_')) {
        newName = `INE_${customerName}${ext}`;
      }
    }
    // Passport (front only) - check if it has a person's name in it
    else if ((fileLower.includes('passport') || fileLower.includes('pasaporte')) && (ext === '.jpg' || ext === '.jpeg' || ext === '.pdf')) {
      // Check if file already has person name (e.g., "New passport - Sep 18 2018 - 12-33 PM - p1.jpeg" is Ashish's)
      // For Ashish Punj's passport, use his name
      if (fileLower.includes('new passport') || fileLower.includes('ashish')) {
        if (!file.startsWith('Passport_Front_Ashish_Punj_')) {
          newName = `Passport_Front_Ashish_Punj_${customerName}${ext}`;
        }
      } else if (!file.startsWith('Passport_Front_')) {
        // Generic passport naming (if no person name detected)
        newName = `Passport_Front_${customerName}${ext}`;
      }
    }
    // CFE (check BEFORE bank statement since CFE files may contain "octubre")
    else if ((fileLower.includes('cfe') || fileLower.includes('luz') || fileLower.includes('comprobante')) && ext === '.pdf') {
      if (!file.startsWith('CFE_Recibo_')) {
        newName = `CFE_Recibo_${customerName}_Octubre_2025.pdf`;
      }
    }
    // Telmex
    else if ((fileLower.includes('telmex') || (fileLower.includes('recibo') && !fileLower.includes('cfe'))) && ext === '.pdf') {
      if (!file.startsWith('Telmex_Recibo_')) {
        newName = `Telmex_Recibo_${customerName}_Octubre_2025.pdf`;
      }
    }
    // Bank Statement (fix typo "esatdo" → "estado") - check AFTER CFE/Telmex
    else if ((fileLower.includes('estado') || fileLower.includes('esatdo') || fileLower.includes('cuenta') || fileLower.includes('octubre') || fileLower.includes('october')) && ext === '.pdf') {
      if (!file.startsWith('Bank_Estado_Cuenta_')) {
        // Fix typo in new name
        const fixedName = file.replace(/[Ee]satdo/gi, 'Estado');
        newName = `Bank_Estado_Cuenta_${customerName}_Octubre_2025.pdf`;
      }
    }

    if (newName && newName !== file) {
      const newPath = path.join(customerDir, newName);
      // Check if target already exists
      if (fs.existsSync(newPath)) {
        console.log(`   ⚠️  Target exists, skipping: ${file} → ${newName}`);
        skipped.push(file);
      } else {
        try {
          fs.renameSync(filePath, newPath);
          console.log(`   ✅ Renamed: ${file} → ${newName}`);
          renamed.push(`${file} → ${newName}`);
        } catch (error) {
          console.error(`   ❌ Error renaming ${file}:`, error);
        }
      }
    } else if (!newName) {
      skipped.push(file);
      console.log(`   ⏭️  No pattern match: ${file}`);
    }
  }

  console.log(`   Summary: ${renamed.length} renamed, ${skipped.length} skipped`);
}

function main() {
  console.log('🔄 Renaming documents in mcp-docs folder...\n');
  console.log(`📂 Target directory: ${MCP_DOCS}\n`);

  if (!fs.existsSync(MCP_DOCS)) {
    console.error(`❌ mcp-docs folder not found at: ${MCP_DOCS}`);
    process.exit(1);
  }

  const dirs = fs.readdirSync(MCP_DOCS).filter(d => {
    const dirPath = path.join(MCP_DOCS, d);
    return fs.statSync(dirPath).isDirectory() && !d.startsWith('.') && d !== 'MCP-Improvements';
  });

  if (dirs.length === 0) {
    console.error(`❌ No customer folders found in: ${MCP_DOCS}`);
    process.exit(1);
  }

  for (const dir of dirs) {
    const customerPath = path.join(MCP_DOCS, dir);
    renameCustomerFiles(customerPath, dir);
  }

  console.log('\n✅ Renaming complete!');
}

main();

