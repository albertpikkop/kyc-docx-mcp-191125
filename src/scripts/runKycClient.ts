import "dotenv/config";
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

import { extractCompanyIdentity } from "../extractors/actaCompanyIdentity.js";
import { extractCompanyTaxProfile } from "../extractors/companyTaxProfileExtractor.js";
import { extractImmigrationProfile } from "../extractors/fm2Immigration.js";
import { extractCfeProofOfAddress } from "../extractors/cfeProofOfAddress.js";
import { extractTelmexProofOfAddress } from "../extractors/telmexProofOfAddress.js";
import { extractBankIdentityPage } from "../extractors/bankIdentityPage.js";
import { extractBankStatementProfile } from "../extractors/bankStatementProfile.js";
import { extractBankStatementTransactions } from "../extractors/bankStatementTransactions.js";
import { buildKycProfile } from "../kyc/profileBuilder.js";
import { validateKycProfile, resolveUbo, resolveSignatories } from "../kyc/validation.js";

// Suppress unused import warnings for future use
void extractBankStatementTransactions;
import { saveRun, loadLatestRun } from "../kyc/storage.js";
import { KycRun, KycDocument, DocumentType } from "../kyc/types.js";
import { DEMO_CONFIG } from "../core/demoConfig.js";

// --- Argument Parsing ---
const args = process.argv.slice(2);
const idArg = args.find(a => a.startsWith('--id='));
const pathArg = args.find(a => a.startsWith('--path='));
const forceArg = args.find(a => a === '--force' || a === '-f');

if (!idArg || !pathArg) {
  console.error("Usage: npm run client:run -- --id=<client_id> --path=<folder_path> [--force]");
  console.error("  --force: Re-process all documents even if unchanged");
  process.exit(1);
}

const FORCE_RERUN = !!forceArg;

const customerId = idArg.split('=')[1];
// Resolve ~ to home dir if present
let fixtureRoot = pathArg.split('=')[1];
if (fixtureRoot.startsWith('~/')) {
    fixtureRoot = path.join(process.env.HOME || '', fixtureRoot.slice(2));
}
fixtureRoot = path.resolve(fixtureRoot);

if (!fs.existsSync(fixtureRoot)) {
    console.error(`Error: Folder not found: ${fixtureRoot}`);
    process.exit(1);
}

// --- Helper: Peek at PDF Content ---
async function peekPdfContent(filePath: string): Promise<string> {
    try {
        const buffer = new Uint8Array(fs.readFileSync(filePath));
        const loadingTask = pdfjsLib.getDocument(buffer);
        const doc = await loadingTask.promise;
        
        // Get text from first page
        const page = await doc.getPage(1);
        const textContent = await page.getTextContent();
        const text = textContent.items.map((item: any) => item.str).join(' ');
        
        return text.slice(0, 2000).toLowerCase(); 
    } catch (e) {
        return "";
    }
}

// --- File Detection Logic ---
async function detectFileType(filePath: string): Promise<DocumentType | null> {
    const filename = path.basename(filePath);
    const lower = filename.toLowerCase();
    
    // 1. Fast Path: Filename Keywords
    // PRIORITY ORDER: Check bank statements FIRST (before tax) since they often contain RFC too
    // Bank statement detection - check for common patterns (including typos like "Esatdo")
    if ((lower.includes('estado') || lower.includes('esatdo')) && lower.includes('cuenta')) return 'bank_identity_page';
    if (lower.includes('cuenta') && (lower.includes('banco') || lower.includes('bank') || lower.includes('statement'))) return 'bank_identity_page';
    
    // Then check other document types
    if (lower.includes('acta') || lower.includes('constitutiva')) return 'acta';
    if (lower.includes('constancia') || lower.includes('sat') || lower.includes('situacion') || lower.includes('fiscal')) return 'sat_constancia';
    if (lower.includes('fm2') || lower.includes('fm3') || lower.includes('residente') || lower.includes('migratorio') || lower.includes('immigration') || lower.includes('ine') || lower.includes('passport') || lower.includes('pasaporte') || lower.includes('credencial')) return 'fm2';
    if (lower.includes('telmex')) return 'telmex';
    if (lower.includes('cfe') || lower.includes('electricidad') || lower.includes('recibo')) return 'cfe'; // "Recibo" = utility bill/receipt
    if (lower.includes('recibo') && lower.includes('telmex')) return 'telmex'; // Explicit Telmex receipt 
    if (lower.includes('bank') && lower.includes('statement')) return 'bank_identity_page';
    
    // Check for Month + Year pattern in filename (common for bank statements)
    // e.g. "October 2025.pdf", "octubre_2024.pdf", "octubre_2025" (with underscore)
    if (/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|january|february|march|april|may|june|july|august|september|october|november|december)[\s_-]*20[2-9][0-9]\b/.test(lower)) {
        return 'bank_identity_page';
    }
    
    // Also check for month name alone if followed by "cuenta" or "de cuenta" (bank statement pattern)
    if (/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|january|february|march|april|may|june|july|august|september|october|november|december)\b/.test(lower) && 
        (lower.includes('cuenta') || lower.includes('statement'))) {
        return 'bank_identity_page';
    }

    // Check for Month-only pattern with single-letter suffix (e.g., "Octubre_E.pdf", "Enero_A.pdf")
    // This catches bank statements that use month + initial letter instead of full year
    if (/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|january|february|march|april|may|june|july|august|september|october|november|december)[\s_-]*[a-z]\b/i.test(lower)) {
        // Additional check: if it's a PDF, we'll verify it's actually a bank statement in content inspection
        // But for now, return bank_identity_page as likely match
        return 'bank_identity_page';
    }

    // 2. Slow Path: Content Inspection (only for PDFs)
    if (lower.endsWith('.pdf')) {
        console.log(`   🔎 Peeking content of ambiguous file: ${filename}...`);
        const text = await peekPdfContent(filePath);
        
        // Bank Keywords (Spanish) - CHECK FIRST before tax keywords (bank statements often contain RFC)
        // Strong bank indicators take priority
        if (text.includes('estado de cuenta') || text.includes('esatdo de cuenta') || // Handle typo
            text.includes('clabe') || text.includes('saldo') || 
            text.includes('intercam') || text.includes('bbva') || text.includes('santander') || 
            text.includes('banorte') || text.includes('banamex') || text.includes('hsbc') ||
            text.includes('numero de cuenta') || (text.includes('cuenta') && text.includes('banco')) ||
            text.includes('movimientos') || text.includes('transacciones') || text.includes('deposito') ||
            text.includes('retiro') || text.includes('transferencia')) {
            return 'bank_identity_page';
        }
        // English Bank Keywords
        if (text.includes('account statement') || text.includes('single account statement') || 
            text.includes('checking account') || text.includes('balance') || 
            text.includes('period from') || text.includes('account number') ||
            text.includes('transactions') || text.includes('deposits') || text.includes('withdrawals')) {
            return 'bank_identity_page';
        }
        
        // Acta Keywords
        if (text.includes('notario') && (text.includes('escritura') || text.includes('sociedad anonima') || text.includes('constitutiva'))) {
            return 'acta';
        }
        
        // Tax Keywords - Only match if it's explicitly a Constancia (not just any document with RFC)
        // RFC appears in bank statements too, so we need stronger tax-specific indicators
        if (text.includes('constancia de situacion fiscal') || 
            (text.includes('rfc') && text.includes('situacion fiscal')) ||
            (text.includes('secretaria de hacienda') && text.includes('constancia'))) {
            return 'sat_constancia';
        }
        
        // PoA Keywords (Utility Bills) - Check for "Recibo" pattern
        if ((text.includes('cfe') || text.includes('comision federal de electricidad')) && 
            (text.includes('total a pagar') || text.includes('recibo') || text.includes('kilowatts'))) return 'cfe';
        if ((text.includes('telmex') || text.includes('telefonos de mexico')) && 
            (text.includes('total a pagar') || text.includes('recibo') || text.includes('servicio telefonico'))) return 'telmex';

        // Identity Keywords (INE, Passport, FM2)
        if (text.includes('instituto nacional electoral') || text.includes('credencial para votar') || 
            text.includes('pasaporte') || text.includes('passport') || 
            text.includes('residente permanente') || text.includes('tarjeta de residente') ||
            text.includes('inm')) { // INM = Instituto Nacional de Migración
            return 'fm2';
        }
    }

    return null;
}

// --- Helper: Check if document needs re-processing ---
function needsReprocessing(filePath: string, sourceName: string, existingDoc: KycDocument | null): boolean {
    if (FORCE_RERUN || !existingDoc) {
        return true; // Force re-run or new document
    }
    
    // Check file modification time
    try {
        const fileStats = fs.statSync(filePath);
        const docExtractedAt = existingDoc.extractedAt ? new Date(existingDoc.extractedAt) : new Date(0);
        
        // If file was modified after extraction, re-process
        if (fileStats.mtime > docExtractedAt) {
            return true;
        }
        
        // If source name changed, re-process
        if (existingDoc.sourceName !== sourceName) {
            return true;
        }
        
        return false; // File unchanged, reuse existing extraction
    } catch (e) {
        return true; // Error checking file, re-process to be safe
    }
}

async function main() {
  console.log(`\n🚀 Starting Generic KYC Run`);
  console.log(`   Customer: ${customerId}`);
  console.log(`   Folder:   ${fixtureRoot}`);
  if (FORCE_RERUN) {
      console.log(`   Mode:     🔄 FORCE (re-processing all documents)`);
  } else {
      console.log(`   Mode:     💰 SMART (only changed/new documents)`);
  }
  console.log("----------------------------------------");

  // Load existing run if available
  let existingRun: KycRun | null = null;
  if (!FORCE_RERUN) {
      try {
          existingRun = await loadLatestRun(customerId);
          if (existingRun) {
              console.log(`📦 Found existing run with ${existingRun.documents.length} documents`);
              console.log(`   Run ID: ${existingRun.runId}`);
              console.log(`   Created: ${new Date(existingRun.createdAt).toLocaleString()}`);
          }
      } catch (e) {
          // No existing run, continue fresh
      }
  }

  const files = fs.readdirSync(fixtureRoot).filter(f => !f.startsWith('.') && (f.endsWith('.pdf') || f.endsWith('.jpg') || f.endsWith('.png')));
  
  if (files.length === 0) {
      console.warn("⚠️ No PDF/Image files found in the target folder.");
      process.exit(0);
  }

  const kycDocuments: KycDocument[] = [];
  const existingDocsBySource = new Map<string, KycDocument>();
  
  // Index existing documents by source name for quick lookup
  if (existingRun) {
      for (const doc of existingRun.documents) {
          if (doc.sourceName) {
              existingDocsBySource.set(doc.sourceName, doc);
          }
      }
  }
  
  // Holders for extracted data
  let companyIdentity;
  let companyTaxProfile;
  let representativeIdentity;
  const proofsOfAddress: any[] = [];
  const bankAccounts: any[] = [];

  let processedCount = 0;
  let reusedCount = 0;

  for (const file of files) {
      const filePath = path.join(fixtureRoot, file);
      const docType = await detectFileType(filePath);
      
      if (!docType) {
          console.log(`⏭️  Skipping unrecognized file: ${file}`);
          continue;
      }

      // Check if we can reuse existing extraction
      const existingDoc = existingDocsBySource.get(file);
      const shouldReprocess = needsReprocessing(filePath, file, existingDoc || null);
      
      if (!shouldReprocess && existingDoc) {
          console.log(`♻️  Reusing [${docType}]: ${file} (unchanged)`);
          kycDocuments.push(existingDoc);
          reusedCount++;
          
          // Still need to populate data holders for profile building
          switch (docType) {
              case "acta":
                  companyIdentity = existingDoc.extractedPayload;
                  break;
              case "sat_constancia":
                  companyTaxProfile = existingDoc.extractedPayload;
                  break;
              case "fm2":
                  representativeIdentity = existingDoc.extractedPayload;
                  break;
              case "telmex":
              case "cfe":
                  proofsOfAddress.push(existingDoc.extractedPayload);
                  break;
              case "bank_identity_page":
              case "bank_statement":
                  bankAccounts.push(existingDoc.extractedPayload);
                  break;
          }
          continue;
      }

      console.log(`📄 Processing [${docType}]: ${file}...`);
      if (existingDoc && shouldReprocess) {
          console.log(`   ⚠️  File changed since last extraction, re-processing...`);
      }
      
      let extractedPayload: any = null;

      try {
        switch (docType) {
            case "acta":
              extractedPayload = await extractCompanyIdentity(filePath);
              companyIdentity = extractedPayload;
              break;
            case "sat_constancia":
              extractedPayload = await extractCompanyTaxProfile(filePath);
              companyTaxProfile = extractedPayload;
              break;
            case "fm2":
              extractedPayload = await extractImmigrationProfile(filePath);
              representativeIdentity = extractedPayload;
              break;
            case "telmex":
              extractedPayload = await extractTelmexProofOfAddress(filePath);
              proofsOfAddress.push(extractedPayload);
              break;
            case "cfe":
              extractedPayload = await extractCfeProofOfAddress(filePath);
              proofsOfAddress.push(extractedPayload);
              break;
            case "bank_identity_page":
              // We use the specific identity page extractor for speed/focus
              const identityResult = await extractBankIdentityPage(filePath);
              if (identityResult.bank_account_profile) {
                 extractedPayload = identityResult.bank_account_profile;
                 bankAccounts.push(extractedPayload);
              }
              break;
            case "bank_statement":
               // Standard full extraction (profile + txs)
               const profile = await extractBankStatementProfile(filePath);
               if (profile.bank_account_profile) {
                  extractedPayload = profile.bank_account_profile;
                  bankAccounts.push(profile.bank_account_profile);
               }
               break;
          }
    
          kycDocuments.push({
            id: existingDoc?.id || crypto.randomUUID(), // Preserve ID if re-processing
            customerId,
            type: docType,
            fileUrl: filePath,
            extractedAt: new Date().toISOString(),
            extractedPayload,
            sourceName: file
          });
          console.log(`   ✅ Extracted successfully.`);
          processedCount++;

      } catch (error: any) {
          console.error(`   ❌ Failed to process ${file}: ${error.message}`);
          // If we have an existing doc and extraction failed, keep the old one
          if (existingDoc) {
              console.log(`   ⚠️  Keeping previous extraction for ${file}`);
              kycDocuments.push(existingDoc);
              reusedCount++;
          }
      }
  }

  if (kycDocuments.length === 0) {
      console.error("❌ No documents were successfully processed. Aborting run.");
      return;
  }

  console.log(`\n📊 Processing Summary:`);
  console.log(`   ✅ Processed: ${processedCount} document(s)`);
  console.log(`   ♻️  Reused: ${reusedCount} document(s)`);
  if (reusedCount > 0) {
      const estimatedSavings = reusedCount * 0.05; // ~$0.05 per doc saved
      console.log(`   💰 Estimated cost savings: $${estimatedSavings.toFixed(2)}`);
  }

  console.log("\n🏗️  Building KYC Profile...");
  const profile = buildKycProfile({
    customerId,
    companyIdentity,
    companyTaxProfile,
    representativeIdentity,
    proofsOfAddress,
    bankAccounts
  });

  console.log("🔍 Validating KYC Profile...");
  const validation = validateKycProfile(profile);

  // --- DEMO MODE OUTPUT ---
  if (DEMO_CONFIG.enabled) {
      console.log("\n--- DEMO INSIGHTS ---");
      const ubos = resolveUbo(profile);
      console.log(`1. UBOs Found: ${ubos.length} (${ubos.map(u => u.name).join(', ')})`);
      
      const signers = resolveSignatories(profile);
      const fullSigners = signers.filter(s => s.scope === 'full');
      console.log(`2. Full Signers: ${fullSigners.length} (${fullSigners.map(s => s.name).join(', ')})`);
      
      if (profile.bankIdentity) {
          console.log(`3. Bank Match: ✅ (Holder: ${profile.bankIdentity.account_holder_name})`);
      } else {
          console.log(`3. Bank Match: ❌ (No identity extracted)`);
      }
  }

  // Preserve runId if updating existing run, otherwise create new
  const run: KycRun = {
    runId: existingRun?.runId || crypto.randomUUID(),
    customerId,
    createdAt: existingRun?.createdAt || new Date().toISOString(),
    documents: kycDocuments,
    profile,
    validation
  };

  console.log("\n💾 Saving Run and Generating Report...");
  const reportUrl = await saveRun(run);
  
  // Cost Summary
  try {
    const { getAggregateCosts } = await import('../kyc/costTracker.js');
    const costs = await getAggregateCosts();
    console.log("\n--- COST SUMMARY ---");
    console.log(`Total Runs: ${costs.totalRuns}`);
    console.log(`Total Spent: $${costs.totalCost}`);
    console.log(`Avg Cost/Run: $${costs.avgCostPerRun}`);
  } catch (e) {
    // ignore
  }
  
  if (reportUrl) {
      console.log(`\n✅ Visual Report Generated!`);
      console.log(`📄 Report URL: ${reportUrl}`);
      
      // Open in browser
      try {
          const { exec } = await import('child_process');
          const { promisify } = await import('util');
          const execAsync = promisify(exec);
          await execAsync(`open "${reportUrl}"`);
          console.log(`\n🌐 Opened browser automatically!`);
      } catch (error) {
          console.log(`\n💡 Tip: Copy and paste this URL into your browser to view the report.`);
      }
  }
}

main().catch(console.error);
