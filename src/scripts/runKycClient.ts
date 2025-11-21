#!/usr/bin/env tsx
/**
 * Run KYC for a specific client
 * 
 * Usage:
 *   npm run client:run <customerId>
 * 
 * This script:
 * 1. Loads client configuration
 * 2. Runs the full KYC pipeline
 * 3. Generates the report
 * 4. Automatically opens the report in browser
 */

import "dotenv/config";
import { extractCompanyIdentity } from "../extractors/actaCompanyIdentity.js";
import { extractCompanyTaxProfile } from "../extractors/companyTaxProfileExtractor.js";
import { extractImmigrationProfile } from "../extractors/fm2Immigration.js";
import { extractCfeProofOfAddress } from "../extractors/cfeProofOfAddress.js";
import { extractTelmexProofOfAddress } from "../extractors/telmexProofOfAddress.js";
import { extractBankIdentityPage } from "../extractors/bankIdentityPage.js";
import { buildKycProfile } from "../kyc/profileBuilder.js";
import { validateKycProfile } from "../kyc/validation.js";
import { saveRun } from "../kyc/storage.js";
import { KycRun, KycDocument, DocumentType } from "../kyc/types.js";
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { DEMO_CONFIG } from "../core/demoConfig.js";
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Base folder configuration
 * 
 * Set this to your main documents folder (e.g., Desktop/mcp-docs)
 * Client folders should be subdirectories inside this base folder
 */
const BASE_DOCUMENTS_FOLDER = "/Users/ashishpunj/Desktop/mcp-docs";

/**
 * Document type patterns for auto-detection
 * These patterns help find documents in client folders
 */
const DOCUMENT_PATTERNS: Record<DocumentType, string[]> = {
  acta: ["acta", "constitutiva", "escritura", "constitución"],
  sat_constancia: ["constancia", "sat", "situacion fiscal", "rfc"],
  fm2: ["fm2", "immigration", "migración"],
  telmex: ["telmex", "telefono", "recibo telmex"],
  cfe: ["cfe", "luz", "electricidad", "recibo cfe"],
  bank_identity_page: ["banco", "bank", "estado cuenta", "cuenta", "clabe", "kapital"],
  bank_statement: ["estado cuenta", "bank statement", "extracto"],
  bank_statement_transactions: [] // Not auto-detected
};

/**
 * Auto-detect documents in a client folder
 */
function findDocumentsInFolder(clientFolder: string): Array<{ type: DocumentType; fileName: string }> {
  const files = fs.readdirSync(clientFolder).filter(f => f.toLowerCase().endsWith('.pdf'));
  const documents: Array<{ type: DocumentType; fileName: string }> = [];
  const usedFiles = new Set<string>();

  // Priority order for document types
  const typeOrder: DocumentType[] = ['acta', 'sat_constancia', 'fm2', 'telmex', 'cfe', 'bank_identity_page', 'bank_statement'];

  for (const docType of typeOrder) {
    const patterns = DOCUMENT_PATTERNS[docType];
    for (const file of files) {
      if (usedFiles.has(file)) continue;
      
      const fileLower = file.toLowerCase();
      const matches = patterns.some(pattern => fileLower.includes(pattern));
      
      if (matches) {
        documents.push({ type: docType, fileName: file });
        usedFiles.add(file);
        break; // Take first match for each type
      }
    }
  }

  return documents;
}

/**
 * Open URL in browser (macOS)
 */
async function openInBrowser(url: string): Promise<void> {
  try {
    await execAsync(`open "${url}"`);
    console.log(`\n🌐 Opened browser automatically!`);
  } catch (error) {
    console.error(`\n⚠️  Could not open browser automatically. Please copy this URL:`);
    console.log(`   ${url}`);
  }
}

/**
 * Normalize customer ID for folder names
 * Converts to lowercase and replaces spaces with hyphens
 */
function normalizeCustomerId(customerId: string): string {
  return customerId.toLowerCase().trim().replace(/\s+/g, '-');
}

function getClientFolder(customerId: string): string {
  // Normalize the customer ID to match folder structure
  const normalized = normalizeCustomerId(customerId);
  return path.join(BASE_DOCUMENTS_FOLDER, normalized);
}

function resolveDocument(clientFolder: string, fileName: string): string {
  const fullPath = path.resolve(clientFolder, fileName);
  if (!fs.existsSync(fullPath)) {
    console.error(`\n❌ Document not found: ${fullPath}`);
    console.error(`\n💡 Please ensure:`);
    console.error(`   1. The folder exists: ${clientFolder}`);
    console.error(`   2. The file exists: ${fileName}`);
    console.error(`   3. File names match exactly (case-sensitive)\n`);
    throw new Error(`Document not found: ${fullPath}`);
  }
  return fullPath;
}

async function main() {
  const customerId = process.argv[2];
  
  if (!customerId) {
    console.error('❌ Usage: npm run client:run <customerId>');
    console.log(`\n💡 Client folders should be in: ${BASE_DOCUMENTS_FOLDER}`);
    console.log('   Example: npm run client:run client1');
    process.exit(1);
  }

  const clientFolder = getClientFolder(customerId);
  
  if (!fs.existsSync(clientFolder)) {
    console.error(`❌ Client folder not found: ${clientFolder}`);
    console.log(`\n💡 Please create a folder at: ${clientFolder}`);
    console.log('   And place your PDF documents inside it.');
    process.exit(1);
  }

  // Auto-detect documents in the client folder
  const documents = findDocumentsInFolder(clientFolder);
  
  if (documents.length === 0) {
    console.error(`❌ No documents found in: ${clientFolder}`);
    console.log('\n💡 Please ensure PDF files are in the folder with recognizable names:');
    console.log('   - Acta: contains "acta" or "constitutiva"');
    console.log('   - SAT: contains "constancia" or "sat"');
    console.log('   - FM2: contains "fm2"');
    console.log('   - Telmex: contains "telmex"');
    console.log('   - CFE: contains "cfe"');
    console.log('   - Bank: contains "banco", "bank", or "cuenta"');
    process.exit(1);
  }

  console.log(`\n🚀 Starting KYC Run for client: ${customerId}`);
  console.log(`📁 Document folder: ${clientFolder}`);
  console.log(`📄 Documents found: ${documents.length}`);
  documents.forEach(doc => console.log(`   - ${doc.type}: ${doc.fileName}`));
  console.log(`Demo Mode: ${DEMO_CONFIG.enabled}\n`);

  const kycDocuments: KycDocument[] = [];
  const proofsOfAddress: any[] = [];
  const bankAccounts: any[] = [];
  let companyIdentity: any = null;
  let companyTaxProfile: any = null;
  let representativeIdentity: any = null;

  // Process each document
  for (const doc of documents) {
    try {
      const fileUrl = resolveDocument(clientFolder, doc.fileName);
      console.log(`Processing ${doc.type} - ${doc.fileName}...`);
      
      let extractedPayload: any = null;

      switch (doc.type) {
        case "acta":
          extractedPayload = await extractCompanyIdentity(fileUrl);
          companyIdentity = extractedPayload;
          break;
        case "sat_constancia":
          extractedPayload = await extractCompanyTaxProfile(fileUrl);
          companyTaxProfile = extractedPayload;
          break;
        case "fm2":
          extractedPayload = await extractImmigrationProfile(fileUrl);
          representativeIdentity = extractedPayload;
          break;
        case "telmex":
          extractedPayload = await extractTelmexProofOfAddress(fileUrl);
          proofsOfAddress.push(extractedPayload);
          break;
        case "cfe":
          extractedPayload = await extractCfeProofOfAddress(fileUrl);
          proofsOfAddress.push(extractedPayload);
          break;
        case "bank_identity_page":
          const identityResult = await extractBankIdentityPage(fileUrl);
          if (identityResult.bank_account_profile) {
            extractedPayload = identityResult.bank_account_profile;
            bankAccounts.push(extractedPayload);
          }
          break;
      }

      if (extractedPayload) {
        kycDocuments.push({
          id: crypto.randomUUID(),
          customerId,
          type: doc.type,
          fileUrl,
          extractedAt: new Date().toISOString(),
          extractedPayload,
          sourceName: path.basename(fileUrl)
        });
      }
    } catch (error) {
      console.error(`❌ Error processing ${doc.type} (${doc.fileName}):`, error);
      throw error;
    }
  }

  console.log("\n✅ All documents processed");
  console.log("Building KYC Profile...");
  
  const profile = buildKycProfile({
    customerId,
    companyIdentity,
    companyTaxProfile,
    proofsOfAddress,
    bankAccounts,
    representativeIdentity
  });

  console.log("Validating KYC Profile...");
  const validation = validateKycProfile(profile);

  const run: KycRun = {
    runId: crypto.randomUUID(),
    customerId,
    createdAt: new Date().toISOString(),
    documents: kycDocuments,
    profile,
    validation
  };

  console.log("Saving Run and Generating Report...");
  const reportUrl = await saveRun(run);
  
  if (reportUrl) {
    console.log(`\n✅ Visual Report Generated!`);
    console.log(`📄 Report URL: ${reportUrl}`);
    
    // Automatically open in browser
    await openInBrowser(reportUrl);
    
    console.log(`\n📊 Summary:`);
    console.log(`   Score: ${(validation.score * 100).toFixed(0)}/100`);
    console.log(`   Flags: ${validation.flags.length}`);
    console.log(`   Run ID: ${run.runId}`);
  } else {
    console.error("❌ Failed to generate report");
    process.exit(1);
  }
}

main().catch(console.error);

