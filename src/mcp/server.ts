import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { z } from "zod";
import { createContextLogger } from "../utils/logger.js";
import { handleHealthz, handleReadyz, handleMetrics, metrics } from "./health.js";
import { correlationIdMiddleware } from "./correlationId.js";
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';

// Domain imports
import { 
  DocumentType, 
  ImportableDocumentType,
  KycDocument, 
  KycProfile,
  KycValidationResult,
  CompanyIdentity,
  CompanyTaxProfile,
  ImmigrationProfile,
  ProofOfAddress,
  BankAccountProfile
} from "../kyc/types.js";
// File-based storage for backward compatibility and fallback when Prisma is not available
import { saveRun, loadLatestRun, generateVisualReport } from "../kyc/storage.js";
import { 
  createRun as createRunDb, 
  appendDoc as appendDocDb, 
  getLatestRun as getLatestRunDb,
  updateRun as updateRunDb,
  logAudit
} from "../kyc/prismaHelpers.js";
import { buildKycProfile } from "../kyc/profileBuilder.js";
import { validateKycProfile } from "../kyc/validation.js";
import { buildKycReport } from "../kyc/reportBuilder.js";
import { assessCredit } from "../kyc/creditAssessment.js";
import { apiKeyAuth, rateLimitConfig } from "./middleware.js";
import { handleKycCheck, handleCreditAssess, handleGetAudit } from "./restApi.js";
import { AsyncLocalStorage } from "async_hooks";

declare module 'fastify' {
  interface FastifyRequest {
    startTime?: number;
    routerPath?: string;
  }
}

// Extractors
import { extractCompanyIdentity } from "../extractors/actaCompanyIdentity.js";
import { extractCompanyTaxProfile } from "../extractors/companyTaxProfileExtractor.js";
import { extractImmigrationProfile } from "../extractors/fm2Immigration.js";
import { extractIneIdentity } from "../extractors/ineIdentity.js";
import { extractPassportIdentity } from "../extractors/passportIdentity.js";
import { extractTelmexProofOfAddress } from "../extractors/telmexProofOfAddress.js";
import { extractCfeProofOfAddress } from "../extractors/cfeProofOfAddress.js";
import { extractBankStatementProfile } from "../extractors/bankStatementProfile.js";
import { extractBankStatementTransactions } from "../extractors/bankStatementTransactions.js";
import { extractBankIdentityPage } from "../extractors/bankIdentityPage.js";
import { DEMO_CONFIG } from "../core/demoConfig.js";
import { canonicalizeName } from "../core/canonicalizer.js";
// Citation engine imported dynamically in handleGetLegalCitations

// AsyncLocalStorage for passing orgId through async call stack
const orgContext = new AsyncLocalStorage<{ orgId: string }>();

/**
 * Cross-verify UBO data from multiple acta sources (e.g., Acta Constitutiva + Lista de Asistentes)
 * Returns confidence scores for each shareholder based on how many sources agree
 */
function crossVerifyUboData(
  actaSources: { sourceName: string; shareholders: any[] }[],
  primaryShareholders: any[]
): { name: string; percentage: number | null; confidence: number; sources: string[]; discrepancies: string[] }[] {
  const results: { name: string; percentage: number | null; confidence: number; sources: string[]; discrepancies: string[] }[] = [];
  
  for (const sh of primaryShareholders) {
    const canonicalResult = canonicalizeName(sh.name);
    const canonicalName = canonicalResult.canonical;
    const matchingSources: string[] = [];
    const percentages: { source: string; pct: number | null }[] = [];
    const discrepancies: string[] = [];
    
    for (const source of actaSources) {
      // Find matching shareholder in this source
      const match = source.shareholders.find(s => {
        const sourceCanonical = canonicalizeName(s.name).canonical;
        return sourceCanonical === canonicalName;
      });
      
      if (match) {
        matchingSources.push(source.sourceName);
        percentages.push({ source: source.sourceName, pct: match.percentage ?? null });
      }
    }
    
    // Check for percentage discrepancies
    const uniquePercentages = [...new Set(percentages.filter(p => p.pct !== null).map(p => p.pct))];
    if (uniquePercentages.length > 1) {
      discrepancies.push(`Percentage varies across sources: ${percentages.map(p => `${p.source}: ${p.pct}%`).join(', ')}`);
    }
    
    // Calculate confidence: 100% if all sources agree, lower if discrepancies
    let confidence = 0;
    if (matchingSources.length === actaSources.length && discrepancies.length === 0) {
      confidence = 100; // All sources agree
    } else if (matchingSources.length === actaSources.length) {
      confidence = 80; // All sources have the name but percentages differ
    } else if (matchingSources.length >= 1) {
      confidence = Math.round((matchingSources.length / actaSources.length) * 70); // Partial match
    }
    
    results.push({
      name: sh.name,
      percentage: sh.percentage ?? null,
      confidence,
      sources: matchingSources,
      discrepancies
    });
  }
  
  return results;
}

// Helper to get orgId from context (throws if not set)
export function requireOrgId(): string {
  const context = orgContext.getStore();
  if (!context?.orgId) {
    throw new Error("orgId not found in context - request must be authenticated");
  }
  return context.orgId;
}

// Helper to get run from DB with file storage fallback
async function getRunWithFallback(orgId: string, customerId: string): Promise<any | null> {
  // Try Prisma first
  try {
    const dbRun = await getLatestRunDb(orgId, customerId);
    if (dbRun) return dbRun;
  } catch (e) {
    console.log(`Prisma unavailable for ${customerId}, trying file storage`);
  }
  
  // Fall back to file storage
  const fileRun = await loadLatestRun(customerId);
  if (fileRun) {
    // Convert file run to DB-like format
    return {
      id: fileRun.runId,
      customerId: fileRun.customerId,
      createdAt: new Date(fileRun.createdAt),
      profile: fileRun.profile || null,
      validation: fileRun.validation || null,
      docs: fileRun.documents?.map((d: any) => ({
        id: d.id,
        docType: d.type,
        fileUrl: d.fileUrl,
        sourceName: d.sourceName || null,
        extractedPayload: d.extractedPayload,
        createdAt: new Date(d.extractedAt),
      })) || [],
      _fromFile: true, // Flag to indicate file-based run
    };
  }
  
  return null;
}

type McpToolResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function okResponse(data: unknown): McpToolResponse {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ ok: true, data }, null, 2)
      }
    ]
  };
}

function errorResponse(error_code: string, message: string): McpToolResponse {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ ok: false, error_code, message }, null, 2)
      }
    ],
    isError: true
  };
}

// --- Exported Handlers for Direct Usage / Testing ---

export async function handleListSupportedDocTypes(): Promise<McpToolResponse> {
  const docs = Object.entries(SUPPORTED_DOCS).map(([type, desc]) => ({
    type,
    description: desc
  }));

  return okResponse(docs);
}

export async function handleImportKycDocument({ customer_id, doc_type, file_url, source_name }: { 
  customer_id: string; 
  doc_type: ImportableDocumentType; 
  file_url: string; 
  source_name?: string;
}): Promise<McpToolResponse> {
  // Require orgId from context (set by middleware)
  const orgId = requireOrgId();
  console.error(`Processing ${doc_type} for ${customer_id} from ${file_url}`);

  let extractedPayload: any = null;
  const supplementalDocs: KycDocument[] = [];

  try {
    switch (doc_type) {
      case "acta":
        extractedPayload = await extractCompanyIdentity(file_url);
        break;
      case "sat_constancia":
        extractedPayload = await extractCompanyTaxProfile(file_url);
        break;
      case "fm2":
        extractedPayload = await extractImmigrationProfile(file_url);
        break;
      case "ine":
        extractedPayload = await extractIneIdentity(file_url);
        break;
      case "passport":
        extractedPayload = await extractPassportIdentity(file_url);
        break;
      case "telmex":
        extractedPayload = await extractTelmexProofOfAddress(file_url);
        break;
      case "cfe":
        extractedPayload = await extractCfeProofOfAddress(file_url);
        break;
      case "bank_statement":
        // In Demo Mode, if using Bank Identity Only, we should really be using "bank_identity_page" doc type.
        // But if the user sends "bank_statement", we might want to adapt.
        // However, strict adherence to the new types is better.
        
        const profileResult = await extractBankStatementProfile(file_url);
        const txResult = await extractBankStatementTransactions(file_url);

        extractedPayload = profileResult.bank_account_profile ?? null;

        if (!DEMO_CONFIG.enabled || !DEMO_CONFIG.useBankIdentityOnly) {
          supplementalDocs.push({
            id: crypto.randomUUID(),
            customerId: customer_id,
            type: "bank_statement_transactions",
            fileUrl: file_url,
            extractedAt: new Date().toISOString(),
            extractedPayload: txResult.transactions || [],
            sourceName: source_name || path.basename(file_url)
          });
        }
        break;
      case "bank_identity_page":
        const identityResult = await extractBankIdentityPage(file_url);
        // Use the same payload structure as bank statement profile since they share schema
        extractedPayload = identityResult.bank_account_profile ?? null;
        // No transactions for identity page
        break;
      default:
        throw new Error(`Unsupported document type: ${doc_type}`);
    }
  } catch (error: any) {
    return errorResponse("EXTRACTION_FAILED", error?.message || "Unknown extraction error");
  }

  // Get or create run - try Prisma first, fall back to file storage
  let dbRun: any = null;
  let useFileStorage = false;
  let mainDocId: any = { id: crypto.randomUUID() };
  const supplementalDocIds: string[] = [];
  
  try {
    dbRun = await getLatestRunDb(orgId, customer_id);
    
    if (!dbRun) {
      await createRunDb(orgId, customer_id);
      dbRun = await getLatestRunDb(orgId, customer_id);
    }
    
    if (dbRun) {
      // Append main document to DB
      mainDocId = await appendDocDb(dbRun.id, {
        docType: doc_type,
        fileUrl: file_url,
        sourceName: source_name || path.basename(file_url),
        extractedPayload,
      });

      // Append supplemental documents to DB
      for (const suppDoc of supplementalDocs) {
        const suppDocId = await appendDocDb(dbRun.id, {
          docType: suppDoc.type,
          fileUrl: suppDoc.fileUrl,
          sourceName: suppDoc.sourceName,
          extractedPayload: suppDoc.extractedPayload,
        });
        supplementalDocIds.push(suppDocId.id);
      }
    }
  } catch (prismaError: any) {
    console.log(`Prisma unavailable for import, using file storage for ${customer_id}`);
    useFileStorage = true;
  }
  
  // Fall back to file storage if Prisma failed or not available
  if (useFileStorage || !dbRun) {
    // Load existing run or create new one
    let fileRun = await loadLatestRun(customer_id);
    
    if (!fileRun) {
      fileRun = {
        runId: crypto.randomUUID(),
        customerId: customer_id,
        createdAt: new Date().toISOString(),
        documents: [],
      };
    }
    
    // Add main document
    const newDoc: KycDocument = {
      id: mainDocId.id || crypto.randomUUID(),
      customerId: customer_id,
      type: doc_type as DocumentType,
      fileUrl: file_url,
      extractedAt: new Date().toISOString(),
      extractedPayload,
      sourceName: source_name || path.basename(file_url),
    };
    fileRun.documents.push(newDoc);
    
    // Add supplemental documents
    for (const suppDoc of supplementalDocs) {
      const suppId = crypto.randomUUID();
      fileRun.documents.push({
        ...suppDoc,
        id: suppId,
      });
      supplementalDocIds.push(suppId);
    }
    
    // Save to file storage
    await saveRun(fileRun);
    
    // Set mainDocId for response
    mainDocId = { id: newDoc.id };
    
    // Create a pseudo dbRun for response
    dbRun = { id: fileRun.runId };
  }

  // Log audit event (will silently fail if Prisma unavailable)
  await logAudit(orgId, "document_imported", {
    customerId: customer_id,
    docType: doc_type,
    runId: dbRun?.id || 'file-storage',
    docId: mainDocId?.id,
    modelUsed: extractedPayload?._metadata?.modelUsed
  });

  // Build a brief summary of what was extracted
  let extractionSummary: Record<string, any> = {};
  if (extractedPayload) {
    // Common identity fields
    if (extractedPayload.full_name) extractionSummary.name = extractedPayload.full_name;
    if (extractedPayload.razon_social) extractionSummary.company = extractedPayload.razon_social;
    if (extractedPayload.rfc) extractionSummary.rfc = extractedPayload.rfc;
    if (extractedPayload.document_number) extractionSummary.document_number = extractedPayload.document_number;
    if (extractedPayload.nationality) extractionSummary.nationality = extractedPayload.nationality;
    if (extractedPayload.issuer_country) extractionSummary.issuer_country = extractedPayload.issuer_country;
    if (extractedPayload.document_type) extractionSummary.document_type = extractedPayload.document_type;
    if (extractedPayload.client_name) extractionSummary.client_name = extractedPayload.client_name;
    if (extractedPayload.total_due) extractionSummary.total_due = extractedPayload.total_due;
    if (extractedPayload.account_number) extractionSummary.account = extractedPayload.account_number;
    // Address info
    if (extractedPayload.client_address?.street) {
      extractionSummary.address = `${extractedPayload.client_address.street} ${extractedPayload.client_address.ext_number || ''}, ${extractedPayload.client_address.colonia || ''}, ${extractedPayload.client_address.cp || ''}`;
    }
  }

  return okResponse({
    customer_id,
    run_id: dbRun?.id || 'file-storage',
    doc_id: mainDocId?.id,
    doc_type,
    supplemental_doc_ids: supplementalDocIds,
    status: "imported",
    model_used: extractedPayload?._metadata?.modelUsed || 'gemini-2.5-flash',
    cost_usd: extractedPayload?._metadata?.costUsd || 0.001,
    extraction_summary: extractionSummary
  });
}

export async function handleBuildKycProfile({ customer_id }: { customer_id: string }): Promise<McpToolResponse> {
  const orgId = requireOrgId();
  
  let dbRun: any = null;
  let run: any = null;
  
  // Try Prisma first, fall back to file storage
  try {
    dbRun = await getLatestRunDb(orgId, customer_id);
  } catch (prismaError: any) {
    console.log(`Prisma unavailable for build_kyc_profile, trying file storage for ${customer_id}`);
  }
  
  if (dbRun) {
    // Convert DB run to in-memory format for profile building
    run = {
      runId: dbRun.id,
      customerId: dbRun.customerId,
      createdAt: dbRun.createdAt.toISOString(),
      documents: dbRun.docs.map((doc: any) => ({
        id: doc.id,
        customerId: dbRun.customerId,
        type: doc.docType as DocumentType,
        fileUrl: doc.fileUrl,
        extractedAt: doc.createdAt.toISOString(),
        extractedPayload: doc.extractedPayload,
        sourceName: doc.sourceName || undefined,
      })),
    };
  } else {
    // Try file-based storage
    const fileRun = await loadLatestRun(customer_id);
    if (fileRun) {
      // If profile already exists in file, return it
      if (fileRun.profile) {
        return okResponse(fileRun.profile);
      }
      run = fileRun;
    }
  }
  
  if (!run) {
    return errorResponse("NO_RUN_FOR_CUSTOMER", `No run found for customer ${customer_id}`);
  }

  // Aggregate data from documents
  let companyIdentity: CompanyIdentity | undefined;
  let companyTaxProfile: CompanyTaxProfile | undefined;
  let representativeIdentity: ImmigrationProfile | undefined;
  let passportIdentity: any | undefined;
  const proofsOfAddress: ProofOfAddress[] = [];
  const bankAccounts: BankAccountProfile[] = [];
  
  // Track multiple acta sources for UBO cross-verification
  const actaSources: { sourceName: string; shareholders: any[] }[] = [];
  
  // Track all SAT Constancias (personal and company)
  const allSatConstancias: { rfc: string; razon_social: string; payload: any; isCompany: boolean }[] = [];

  for (const doc of run.documents) {
    if (!doc.extractedPayload) continue;

    const payload = doc.extractedPayload as any;
    
    // Debug: Log document processing
    console.log(`[Profile Build] Processing doc: type=${doc.type}, sourceName=${doc.sourceName}, has_shareholders=${!!payload.shareholders}`);

    switch (doc.type) {
      case "acta":
        // Collect shareholder data from all acta-type documents for cross-verification
        if (payload.shareholders && payload.shareholders.length > 0) {
          actaSources.push({
            sourceName: doc.sourceName || 'Acta',
            shareholders: payload.shareholders
          });
          console.log(`[Profile Build] Added acta source: ${doc.sourceName}, shareholders: ${payload.shareholders.length}`);
        }
        
        // Use the most complete acta as the primary (one with most data)
        if (!companyIdentity || 
            (payload.razon_social && payload.legal_representatives?.length > 0)) {
          companyIdentity = payload;
        }
        break;
      case "sat_constancia":
        // Collect all SAT Constancias for later processing
        if (payload.rfc) {
          // RFC pattern: 3 letters = Persona Moral, 4 letters = Persona Física
          const isCompanyRfc = /^[A-Z]{3}\d{6}[A-Z0-9]{3}$/i.test(payload.rfc);
          allSatConstancias.push({
            rfc: payload.rfc,
            razon_social: payload.razon_social || '',
            payload,
            isCompany: isCompanyRfc
          });
        }
        break;
      case "fm2":
      case "ine":
        representativeIdentity = payload;
        break;
      case "passport":
        // Passport identity - for foreign nationals this is the primary ID
        const passportData = payload.passport_identity || payload;
        passportIdentity = {
          full_name: passportData.full_name || null,
          nationality: passportData.nationality || null,
          document_type: "PASSPORT",
          document_number: passportData.document_number || passportData.passport_number || null,
          issue_date: passportData.issue_date || null,
          expiry_date: passportData.expiry_date || null,
          issuer_country: passportData.issuer_country || passportData.nationality || null,
          birth_date: passportData.birth_date || passportData.date_of_birth || null,
          gender: passportData.gender || null,
          curp: passportData.curp || null,
        };
        break;
      case "telmex":
      case "cfe":
        proofsOfAddress.push(payload);
        break;
      case "bank_statement":
        if (payload) {
          bankAccounts.push(payload);
        }
        break;
      case "bank_identity_page":
        if (payload) {
          bankAccounts.push(payload);
        }
        break;
      case "bank_statement_transactions":
        // Reserved for future transaction analytics
        break;
    }
  }

  // === SAT SELECTION LOGIC ===
  // CRITICAL: Determine if this is a Persona Moral based on having an Acta (not RFC)
  // RFC is often NOT in the Acta - it's assigned by SAT after incorporation
  const hasActa = !!companyIdentity;
  const actaRfc = companyIdentity?.rfc?.toUpperCase().trim();
  const personaMoralRfcPattern = /^[A-Z]{3}\d{6}[A-Z0-9]{3}$/i;  // 3 letters = corporate
  const personaFisicaRfcPattern = /^[A-Z]{4}\d{6}[A-Z0-9]{3}$/i; // 4 letters = individual
  
  // Separate SATs by type
  const companySats = allSatConstancias.filter(sat => personaMoralRfcPattern.test(sat.rfc));
  const personalSats = allSatConstancias.filter(sat => personaFisicaRfcPattern.test(sat.rfc));
  
  console.log(`[SAT Selection] Has Acta: ${hasActa}, Acta RFC: ${actaRfc || 'null'}`);
  console.log(`[SAT Selection] Company SATs (3-letter RFC): ${companySats.map(s => s.rfc).join(', ') || 'none'}`);
  console.log(`[SAT Selection] Personal SATs (4-letter RFC): ${personalSats.map(s => s.rfc).join(', ') || 'none'}`);
  
  if (hasActa) {
    // This is a Persona Moral - we need a company SAT
    if (actaRfc && personaMoralRfcPattern.test(actaRfc)) {
      // Acta has RFC - look for matching company SAT
      const matchingCompanySat = companySats.find(sat => 
        sat.rfc.toUpperCase().trim() === actaRfc
      );
      
      if (matchingCompanySat) {
        companyTaxProfile = matchingCompanySat.payload;
        console.log(`[SAT Selection] Using company SAT: ${matchingCompanySat.rfc} (matches Acta RFC)`);
      } else if (companySats.length > 0) {
        // Have company SAT but doesn't match Acta RFC - use it but flag mismatch
        companyTaxProfile = companySats[0].payload;
        console.log(`[SAT Selection] WARNING: Company SAT ${companySats[0].rfc} doesn't match Acta RFC ${actaRfc}`);
      } else {
        // No company SAT at all - leave undefined, validation will flag
        companyTaxProfile = undefined;
        console.log(`[SAT Selection] WARNING: No company SAT found. Only personal SATs available: ${personalSats.map(s => s.rfc).join(', ')}`);
      }
    } else {
      // Acta has no RFC (common case) - look for any company SAT
      if (companySats.length > 0) {
        companyTaxProfile = companySats[0].payload;
        console.log(`[SAT Selection] Using company SAT: ${companySats[0].rfc} (Acta has no RFC)`);
      } else {
        // No company SAT - leave undefined, validation will flag WRONG_SAT_TYPE
        companyTaxProfile = undefined;
        console.log(`[SAT Selection] WARNING: Acta present but no company SAT. Personal SATs: ${personalSats.map(s => s.rfc).join(', ')}`);
      }
    }
  } else {
    // No Acta = Persona Física - use any available SAT (prefer personal)
    if (personalSats.length > 0) {
      companyTaxProfile = personalSats[0].payload;
      console.log(`[SAT Selection] Using personal SAT: ${personalSats[0].rfc}`);
    } else if (companySats.length > 0) {
      companyTaxProfile = companySats[0].payload;
      console.log(`[SAT Selection] Using company SAT: ${companySats[0].rfc} (no personal SAT)`);
    }
  }
  
  // Store ALL personal SATs for shareholder/representative verification
  // This allows the report to show all individuals' tax status
  const personalSatConstancias = personalSats;

  const profile = buildKycProfile({
    customerId: customer_id,
    companyIdentity,
    companyTaxProfile,
    representativeIdentity,
    passportIdentity,
    proofsOfAddress,
    bankAccounts
  });
  
  // Attach personal SATs for cross-referencing with shareholders/representatives
  if (personalSatConstancias.length > 0) {
    (profile as any)._personalSatConstancias = personalSatConstancias.map(sat => ({
      rfc: sat.rfc,
      razon_social: sat.razon_social,
      isCompany: sat.isCompany
    }));
  }

  // Cross-verify UBO data from multiple acta sources for confidence scoring
  if (actaSources.length > 1 && profile.companyIdentity?.shareholders) {
    const uboVerification = crossVerifyUboData(actaSources, profile.companyIdentity.shareholders);
    // Attach verification metadata to profile for report generation
    (profile as any)._uboVerification = uboVerification;
    console.log(`[UBO Cross-Verification] ${actaSources.length} sources analyzed:`, 
      uboVerification.map((v: any) => `${v.name}: ${v.confidence}% confidence`).join(', '));
  }

  // Save profile to database or file
  if (dbRun) {
    try {
      await updateRunDb(dbRun.id, { profile, status: "completed" });
      await logAudit(orgId, "profile_built", {
        customerId: customer_id,
        runId: dbRun.id,
      });
    } catch (e) {
      console.warn('Could not save profile to DB, using file storage');
    }
  }
  
  // Also save to file storage as backup
  try {
    await saveRun({
      runId: run.runId,
      customerId: customer_id,
      createdAt: run.createdAt,
      documents: run.documents,
      profile,
    });
  } catch (e) {
    console.warn('Could not save profile to file storage:', e);
  }

  return okResponse(profile);
}

export async function handleValidateKycProfile({ customer_id }: { customer_id: string }): Promise<McpToolResponse> {
  const orgId = requireOrgId();
  
  let dbRun: any = null;
  let profile: KycProfile | null = null;
  
  // Try Prisma first, fall back to file storage
  try {
    dbRun = await getLatestRunDb(orgId, customer_id);
  } catch (prismaError: any) {
    console.log(`Prisma unavailable for validate_kyc_profile, trying file storage for ${customer_id}`);
  }
  
  if (dbRun) {
    profile = dbRun.profile as KycProfile | null;
  } else {
    // Try file-based storage
    const fileRun = await loadLatestRun(customer_id);
    if (fileRun) {
      profile = fileRun.profile as KycProfile | null;
    }
  }
  
  if (!profile) {
    // Auto-build if missing
    const buildResult = await handleBuildKycProfile({ customer_id });
    
    // Try to get profile from build result
    const buildData = JSON.parse(buildResult.content?.[0]?.text || '{}');
    if (buildData.ok === false) {
      return errorResponse("PROFILE_BUILD_FAILED", `Failed to build profile for customer ${customer_id}`);
    }
    profile = buildData.data || buildData;
    
    // Also try to reload from file storage
    if (!profile) {
      const fileRun = await loadLatestRun(customer_id);
      if (fileRun?.profile) {
        profile = fileRun.profile;
      }
    }
  }
  
  if (!profile) {
    return errorResponse("NO_PROFILE", `No profile found for customer ${customer_id}. Import documents first.`);
  }

  const validation = validateKycProfile(profile);
  
  // Save validation to database or file
  if (dbRun) {
    try {
      await updateRunDb(dbRun.id, { validation, status: "completed" });
      await logAudit(orgId, "profile_validated", {
        customerId: customer_id,
        runId: dbRun.id,
        score: validation.score,
      });
    } catch (e) {
      console.warn('Could not save validation to DB');
    }
  }
  
  // Also save to file storage
  try {
    const fileRun = await loadLatestRun(customer_id);
    if (fileRun) {
      await saveRun({
        ...fileRun,
        validation,
      });
    }
  } catch (e) {
    console.warn('Could not save validation to file storage:', e);
  }

  // Extract validation checklist for structured response
  const checklistFlag = validation.flags.find(f => f.message.includes('📋 VALIDATION_CHECKLIST'));
  const regularFlags = validation.flags.filter(f => !f.message.includes('📋 VALIDATION_CHECKLIST'));
  
  // Parse checklist items
  const checklistItems: Array<{ item: string; status: 'pass' | 'fail' | 'info' }> = [];
  if (checklistFlag) {
    const lines = checklistFlag.message.split('\n').filter(l => l.startsWith('✓') || l.startsWith('✗'));
    for (const line of lines) {
      checklistItems.push({
        item: line.substring(2).trim(),
        status: line.startsWith('✓') ? 'pass' : 'fail'
      });
    }
  }

  // Build enhanced response
  const enhancedValidation = {
    customer_id,
    score: validation.score,
    score_percent: Math.round(validation.score * 100),
    overall_status: validation.score >= 0.9 ? 'APPROVED' : (validation.score >= 0.7 ? 'REVIEW_NEEDED' : 'REJECTED'),
    
    // Separated alerts by severity for easy consumption
    critical_issues: regularFlags.filter(f => f.level === 'critical').map(f => ({
      code: f.code,
      message: f.message,
      action_required: (f as any).action_required || null
    })),
    warnings: regularFlags.filter(f => f.level === 'warning').map(f => ({
      code: f.code,
      message: f.message,
      action_required: (f as any).action_required || null
    })),
    info_messages: regularFlags.filter(f => f.level === 'info').map(f => ({
      code: f.code,
      message: f.message
    })),
    
    // Validation checklist for transparency
    validation_checklist: checklistItems,
    
    // Summary counts
    summary: {
      critical_count: regularFlags.filter(f => f.level === 'critical').length,
      warning_count: regularFlags.filter(f => f.level === 'warning').length,
      info_count: regularFlags.filter(f => f.level === 'info').length,
      checklist_passed: checklistItems.filter(c => c.status === 'pass').length,
      checklist_failed: checklistItems.filter(c => c.status === 'fail').length,
    },
    
    // Raw flags for backwards compatibility
    flags: validation.flags,
    
    generatedAt: validation.generatedAt
  };

  return okResponse(enhancedValidation);
}

export async function handleGetKycReport({ customer_id, include_trace = false }: { customer_id: string; include_trace?: boolean }): Promise<McpToolResponse> {
  const orgId = requireOrgId();
  console.log(`[get_kyc_report] Starting for customer: ${customer_id}`);
  
  let dbRun: any = null;
  let fileRun: any = null;
  
  // Try Prisma first, fall back to file storage
  try {
    dbRun = await getLatestRunDb(orgId, customer_id);
    console.log(`[get_kyc_report] Prisma returned: ${dbRun ? 'run found' : 'null'}`);
  } catch (prismaError: any) {
    // Prisma not available, try file-based storage
    console.log(`[get_kyc_report] Prisma unavailable: ${prismaError.message}`);
    fileRun = await loadLatestRun(customer_id);
    console.log(`[get_kyc_report] File storage returned: ${fileRun ? 'run found' : 'null'}`);
    if (fileRun && fileRun.profile && fileRun.validation) {
      // Generate HTML report and return URL
      console.log(`[get_kyc_report] PATH A: Building report from file storage (Prisma error case)`);
      const report = buildKycReport(fileRun.profile, fileRun.validation, { includeTrace: include_trace });
      const reportUrl = await generateVisualReport(fileRun);
      console.log(`[get_kyc_report] Generated report URL: ${reportUrl}`);
      return okResponse({ ...report, report_url: reportUrl });
    } else if (fileRun) {
      // File run exists but no profile/validation - return raw run data
      return okResponse({
        customer_id,
        status: "incomplete",
        message: "Run found but profile/validation not yet built",
        documents: fileRun.documents?.length || 0,
        run_id: fileRun.runId,
      });
    }
  }
  
  if (!dbRun) {
    // Also try file storage as fallback
    console.log(`[get_kyc_report] PATH B: dbRun is null, trying file storage`);
    fileRun = await loadLatestRun(customer_id);
    console.log(`[get_kyc_report] File storage returned: ${fileRun ? 'run found' : 'null'}`);
    if (fileRun && fileRun.profile && fileRun.validation) {
      console.log(`[get_kyc_report] Building report from file storage (fallback case)`);
      const report = buildKycReport(fileRun.profile, fileRun.validation, { includeTrace: include_trace });
      const reportUrl = await generateVisualReport(fileRun);
      console.log(`[get_kyc_report] Generated report URL: ${reportUrl}`);
      return okResponse({ ...report, report_url: reportUrl });
    } else if (fileRun) {
      return okResponse({
        customer_id,
        status: "incomplete", 
        message: "Run found but profile/validation not yet built",
        documents: fileRun.documents?.length || 0,
        run_id: fileRun.runId,
      });
    }
    return errorResponse("NO_RUN_FOR_CUSTOMER", `No run found for customer ${customer_id}`);
  }

  console.log(`[get_kyc_report] PATH C: Using Prisma dbRun`);
  let profile = dbRun.profile as KycProfile | null;
  let validation = dbRun.validation as KycValidationResult | null;

  if (!profile || !validation) {
    console.log(`[get_kyc_report] Profile or validation missing, rebuilding...`);
    await handleValidateKycProfile({ customer_id }); // This triggers build if needed
    dbRun = await getRunWithFallback(orgId, customer_id);
    if (!dbRun) {
      return errorResponse("DB_ERROR", "Failed to reload run");
    }
    profile = dbRun.profile as KycProfile | null;
    validation = dbRun.validation as KycValidationResult | null;
  }

  if (!profile || !validation) {
    return errorResponse("FAILED_TO_GENERATE_PROFILE_OR_VALIDATION", "Unable to build profile or validation for report");
  }

  const report = buildKycReport(profile, validation, { includeTrace: include_trace });
  
  // Generate HTML report from file-based run if available
  let reportUrl: string | undefined;
  if (!fileRun) {
    fileRun = await loadLatestRun(customer_id);
    console.log(`[get_kyc_report] Loaded file run for HTML generation: ${fileRun ? 'found' : 'null'}`);
  }
  if (fileRun) {
    reportUrl = await generateVisualReport(fileRun);
    console.log(`[get_kyc_report] Generated report URL from file run: ${reportUrl}`);
  } else {
    console.log(`[get_kyc_report] No file run available, report_url will be undefined`);
  }

  return okResponse({ ...report, report_url: reportUrl });
}

// --- NEW MVP TOOLS (Top 5 for $5M Pitch) ---

/**
 * Tool 1: ASSESS CREDIT - THE MONEY MAKER 💰
 * Deterministic credit scoring with full transparency
 */
export async function handleAssessCredit({ customer_id }: { customer_id: string }): Promise<McpToolResponse> {
  const orgId = requireOrgId();
  
  let dbRun = await getRunWithFallback(orgId, customer_id);
  
  if (!dbRun) {
    return errorResponse("NO_RUN_FOR_CUSTOMER", `No run found for customer ${customer_id}`);
  }

  let profile = dbRun.profile as KycProfile | null;
  let validation = dbRun.validation as KycValidationResult | null;

  // Auto-build and validate if needed
  if (!profile || !validation) {
    await handleValidateKycProfile({ customer_id });
    dbRun = await getRunWithFallback(orgId, customer_id);
    if (!dbRun) {
      return errorResponse("DB_ERROR", "Failed to reload run");
    }
    profile = dbRun.profile as KycProfile | null;
    validation = dbRun.validation as KycValidationResult | null;
  }

  if (!profile || !validation) {
    return errorResponse("PROFILE_OR_VALIDATION_MISSING", "Unable to assess credit without profile and validation");
  }

  // Get transactions from bank_statement_transactions documents
  const txDoc = dbRun.docs.find(d => d.docType === 'bank_statement_transactions');
  const transactions = txDoc?.extractedPayload as Array<{
    date: string;
    direction: 'credit' | 'debit';
    amount: number;
    currency: string;
  }> | null;

  const assessment = assessCredit(profile, validation, transactions);

  // Log audit event
  await logAudit(orgId, "credit_assessed", {
    customerId: customer_id,
    runId: dbRun.id,
    decision: assessment.decision,
    limit: assessment.limit,
    confidence: assessment.confidence,
  });

  return okResponse(assessment);
}

/**
 * Tool 2: EXPLAIN VALIDATION - AI WOW FACTOR 🧠
 * Natural language explanations of validation results
 */
export async function handleExplainValidation({ customer_id, language = 'en' }: { 
  customer_id: string; 
  language?: 'en' | 'es';
}): Promise<McpToolResponse> {
  const orgId = requireOrgId();
  
  let dbRun = await getRunWithFallback(orgId, customer_id);
  
  if (!dbRun) {
    return errorResponse("NO_RUN_FOR_CUSTOMER", `No run found for customer ${customer_id}`);
  }

  let profile = dbRun.profile as KycProfile | null;
  let validation = dbRun.validation as KycValidationResult | null;

  if (!profile || !validation) {
    await handleValidateKycProfile({ customer_id });
    dbRun = await getRunWithFallback(orgId, customer_id);
    profile = dbRun?.profile as KycProfile | null;
    validation = dbRun?.validation as KycValidationResult | null;
  }

  if (!validation) {
    return errorResponse("VALIDATION_MISSING", "No validation results found");
  }

  const isSpanish = language === 'es';
  
  // Generate human-readable explanations
  const explanations: Array<{
    category: string;
    status: 'pass' | 'warning' | 'fail';
    explanation: string;
    recommendation?: string;
  }> = [];

  // Score explanation
  const scorePercent = Math.round(validation.score * 100);
  let scoreStatus: 'pass' | 'warning' | 'fail' = 'pass';
  let scoreExplanation = '';
  
  if (scorePercent >= 90) {
    scoreStatus = 'pass';
    scoreExplanation = isSpanish 
      ? `Excelente puntuación KYC de ${scorePercent}%. El perfil cumple con todos los requisitos de verificación.`
      : `Excellent KYC score of ${scorePercent}%. The profile meets all verification requirements.`;
  } else if (scorePercent >= 70) {
    scoreStatus = 'warning';
    scoreExplanation = isSpanish
      ? `Puntuación KYC de ${scorePercent}%. El perfil es aceptable pero tiene algunas observaciones menores.`
      : `KYC score of ${scorePercent}%. The profile is acceptable but has some minor observations.`;
  } else {
    scoreStatus = 'fail';
    scoreExplanation = isSpanish
      ? `Puntuación KYC baja de ${scorePercent}%. Se requiere revisión adicional o documentos faltantes.`
      : `Low KYC score of ${scorePercent}%. Additional review or missing documents required.`;
  }

  explanations.push({
    category: isSpanish ? 'Puntuación General' : 'Overall Score',
    status: scoreStatus,
    explanation: scoreExplanation,
  });

  // Flag explanations - COMPREHENSIVE list of all validation flags
  // Updated: Each time validation.ts adds new flags, add explanations here
  const flagMessages: Record<string, { en: string; es: string; rec_en: string; rec_es: string }> = {
    'ADDRESS_MISMATCH': {
      en: 'The fiscal address from SAT does not match the address found in proof of address documents.',
      es: 'La dirección fiscal del SAT no coincide con la dirección en los comprobantes de domicilio.',
      rec_en: 'Verify the customer has updated their SAT registration or provide a more recent proof of address.',
      rec_es: 'Verificar que el cliente haya actualizado su registro en el SAT o proporcionar un comprobante de domicilio más reciente.',
    },
    'REP_ID_MISMATCH': {
      en: 'The legal representative\'s identity document does not match the name in the Acta Constitutiva or required documents are missing.',
      es: 'El documento de identidad del representante legal no coincide con el nombre en el Acta Constitutiva o faltan documentos requeridos.',
      rec_en: 'Request the correct ID document or verify the representative has legal authority.',
      rec_es: 'Solicitar el documento de identidad correcto o verificar que el representante tenga facultades legales.',
    },
    'LOW_DOC_COVERAGE': {
      en: 'The customer has provided fewer documents than required for a complete KYC profile.',
      es: 'El cliente ha proporcionado menos documentos de los requeridos para un perfil KYC completo.',
      rec_en: 'Request the missing documents to complete the verification process.',
      rec_es: 'Solicitar los documentos faltantes para completar el proceso de verificación.',
    },
    'IDENTITY_MISMATCH': {
      en: 'Identity information is inconsistent across different documents.',
      es: 'La información de identidad es inconsistente entre diferentes documentos.',
      rec_en: 'Review all identity documents for consistency and request clarification if needed.',
      rec_es: 'Revisar todos los documentos de identidad y solicitar aclaración si es necesario.',
    },
    'EQUITY_INCONSISTENT': {
      en: 'Shareholder equity percentages do not add up correctly.',
      es: 'Los porcentajes de participación accionaria no suman correctamente.',
      rec_en: 'Review the Acta Constitutiva for accurate shareholder information.',
      rec_es: 'Revisar el Acta Constitutiva para información precisa de accionistas.',
    },
    // Immigration document flags
    'IMMIGRATION_DOC_EXPIRED': {
      en: 'The immigration document has expired or is obsolete.',
      es: 'El documento migratorio ha expirado o es obsoleto.',
      rec_en: 'Request a current Tarjeta de Residente (Temporal or Permanente) from INM.',
      rec_es: 'Solicitar una Tarjeta de Residente (Temporal o Permanente) vigente del INM.',
    },
    // Proof of Address flags
    'POA_NAME_MISMATCH': {
      en: 'The proof of address is in a third party\'s name, not the customer or company.',
      es: 'El comprobante de domicilio está a nombre de un tercero, no del cliente o empresa.',
      rec_en: 'For Persona Moral: Provide utility bill in company name. For Persona Física: Provide proof of relationship (rental contract, family tie).',
      rec_es: 'Para Persona Moral: Proporcionar recibo de servicios a nombre de la empresa. Para Persona Física: Proporcionar prueba de relación (contrato de arrendamiento, vínculo familiar).',
    },
    'POA_ADDRESS_VERIFIED': {
      en: 'The proof of address confirms the fiscal address exists and has active services.',
      es: 'El comprobante de domicilio confirma que el domicilio fiscal existe y tiene servicios activos.',
      rec_en: 'No action needed - address is verified.',
      rec_es: 'No se requiere acción - domicilio verificado.',
    },
    // Corporate registry flags
    'MISSING_FME': {
      en: 'Missing Folio Mercantil Electrónico (FME) or Registro Público de Comercio registration number.',
      es: 'Falta Folio Mercantil Electrónico (FME) o número de inscripción en el Registro Público de Comercio.',
      rec_en: 'Request the commercial registry certificate (boleta de inscripción) from the notary or Registro Público.',
      rec_es: 'Solicitar la boleta de inscripción del Registro Público de Comercio al notario o directamente al Registro.',
    },
    // Tax regime flags
    'TAX_REGIME_NO_COMMERCE': {
      en: 'Tax regime "Sin obligaciones fiscales" does not permit commercial activity.',
      es: 'Régimen fiscal "Sin obligaciones fiscales" no permite actividad comercial.',
      rec_en: 'This individual cannot issue invoices (CFDI) or conduct formal business. Appropriate for personal/non-commercial relationships only.',
      rec_es: 'Esta persona no puede emitir facturas (CFDI) ni realizar actividad empresarial. Solo apto para relaciones personales/no comerciales.',
    },
    'ENTITY_MISMATCH': {
      en: 'Entity names do not match across documents (SAT vs Acta Constitutiva).',
      es: 'Los nombres de la entidad no coinciden entre documentos (SAT vs Acta Constitutiva).',
      rec_en: 'Verify the company name is consistent across all official documents.',
      rec_es: 'Verificar que el nombre de la empresa sea consistente en todos los documentos oficiales.',
    },
    'EQUITY_NEAR_100': {
      en: 'Shareholder equity totals close to but not exactly 100%.',
      es: 'La suma del capital accionario está cerca pero no es exactamente 100%.',
      rec_en: 'Review the Acta Constitutiva for the exact distribution of shares.',
      rec_es: 'Revisar el Acta Constitutiva para la distribución exacta de acciones.',
    },
  };

  for (const flag of validation.flags) {
    const msgData = flagMessages[flag.code];
    explanations.push({
      category: flag.code.replace(/_/g, ' '),
      status: flag.level === 'critical' ? 'fail' : 'warning',
      explanation: msgData 
        ? (isSpanish ? msgData.es : msgData.en)
        : flag.message,
      recommendation: msgData
        ? (isSpanish ? msgData.rec_es : msgData.rec_en)
        : undefined,
    });
  }

  // Summary
  const criticalCount = validation.flags.filter(f => f.level === 'critical').length;
  const warningCount = validation.flags.filter(f => f.level === 'warning').length;
  
  const summary = isSpanish
    ? `Resumen: ${criticalCount} problema(s) crítico(s), ${warningCount} advertencia(s). ${
        criticalCount === 0 ? 'El perfil puede proceder a evaluación crediticia.' : 'Se requiere atención antes de proceder.'
      }`
    : `Summary: ${criticalCount} critical issue(s), ${warningCount} warning(s). ${
        criticalCount === 0 ? 'Profile can proceed to credit assessment.' : 'Attention required before proceeding.'
      }`;

  return okResponse({
    customer_id,
    score: validation.score,
    score_percent: scorePercent,
    summary,
    explanations,
    language,
  });
}

/**
 * Tool 3: SUGGEST MISSING DOCUMENTS - PROACTIVE AI 🤖
 * AI-powered suggestions for completing KYC profile
 */
export async function handleSuggestMissingDocuments({ customer_id }: { customer_id: string }): Promise<McpToolResponse> {
  const orgId = requireOrgId();
  
  const dbRun = await getRunWithFallback(orgId, customer_id);
  
  if (!dbRun) {
    // No documents at all - suggest everything
    return okResponse({
      customer_id,
      completeness: 0,
      suggestions: [
        {
          doc_type: 'sat_constancia',
          priority: 'required',
          reason: 'Tax registration is mandatory for all business KYC profiles',
          reason_es: 'El registro fiscal es obligatorio para todos los perfiles KYC empresariales',
        },
        {
          doc_type: 'acta',
          priority: 'required',
          reason: 'Incorporation deed establishes legal entity and authorized representatives',
          reason_es: 'El acta constitutiva establece la entidad legal y los representantes autorizados',
        },
        {
          doc_type: 'fm2',
          priority: 'required',
          reason: 'Identity document for the legal representative is required',
          reason_es: 'Se requiere documento de identidad del representante legal',
        },
        {
          doc_type: 'cfe',
          priority: 'recommended',
          reason: 'Proof of address validates operational location',
          reason_es: 'El comprobante de domicilio valida la ubicación operativa',
        },
        {
          doc_type: 'bank_statement',
          priority: 'recommended',
          reason: 'Bank statements enable credit assessment and verify financial activity',
          reason_es: 'Los estados de cuenta bancarios permiten la evaluación crediticia',
        },
      ],
    });
  }

  const existingDocTypes = new Set(dbRun.docs.map(d => d.docType));
  const profile = dbRun.profile as KycProfile | null;

  const suggestions: Array<{
    doc_type: string;
    priority: 'required' | 'recommended' | 'optional';
    reason: string;
    reason_es: string;
  }> = [];

  // Check required documents
  if (!existingDocTypes.has('sat_constancia')) {
    suggestions.push({
      doc_type: 'sat_constancia',
      priority: 'required',
      reason: 'Missing SAT Constancia - Tax registration is mandatory',
      reason_es: 'Falta Constancia SAT - El registro fiscal es obligatorio',
    });
  }

  if (!existingDocTypes.has('acta') && !profile?.companyIdentity) {
    suggestions.push({
      doc_type: 'acta',
      priority: 'required',
      reason: 'Missing Acta Constitutiva - Legal entity verification required',
      reason_es: 'Falta Acta Constitutiva - Se requiere verificación de entidad legal',
    });
  }

  // Check identity documents
  const hasIdentityDoc = existingDocTypes.has('fm2') || existingDocTypes.has('ine') || existingDocTypes.has('passport');
  if (!hasIdentityDoc) {
    suggestions.push({
      doc_type: 'fm2',
      priority: 'required',
      reason: 'Missing identity document for legal representative (INE, FM2, or Passport)',
      reason_es: 'Falta documento de identidad del representante legal (INE, FM2 o Pasaporte)',
    });
  }

  // Check proof of address
  const hasProofOfAddress = existingDocTypes.has('cfe') || existingDocTypes.has('telmex');
  if (!hasProofOfAddress) {
    suggestions.push({
      doc_type: 'cfe',
      priority: 'recommended',
      reason: 'No proof of address found - Utility bill recommended for address validation',
      reason_es: 'No se encontró comprobante de domicilio - Se recomienda recibo de servicios',
    });
  }

  // Check bank statements for credit assessment
  const hasBankDocs = existingDocTypes.has('bank_statement') || existingDocTypes.has('bank_identity_page');
  if (!hasBankDocs) {
    suggestions.push({
      doc_type: 'bank_statement',
      priority: 'recommended',
      reason: 'No bank statement found - Required for credit assessment and financial verification',
      reason_es: 'No se encontró estado de cuenta - Requerido para evaluación crediticia',
    });
  }

  // Calculate completeness score
  const requiredDocs = ['sat_constancia', 'acta'];
  const recommendedDocs = ['cfe', 'bank_statement'];
  const identityDocs = ['fm2', 'ine', 'passport'];

  let completeness = 0;
  const weights = { required: 30, identity: 20, recommended: 10 };

  for (const doc of requiredDocs) {
    if (existingDocTypes.has(doc)) completeness += weights.required;
  }
  if (identityDocs.some(d => existingDocTypes.has(d))) completeness += weights.identity;
  for (const doc of recommendedDocs) {
    if (existingDocTypes.has(doc)) completeness += weights.recommended;
  }

  return okResponse({
    customer_id,
    completeness: Math.min(100, completeness),
    existing_documents: Array.from(existingDocTypes),
    suggestions,
    next_action: suggestions.length > 0 
      ? suggestions[0].priority === 'required'
        ? `Upload ${suggestions[0].doc_type} to continue`
        : 'Profile is complete for basic KYC. Additional documents recommended for credit assessment.'
      : 'Profile is complete! Ready for credit assessment.',
  });
}

/**
 * Tool 4: GET RISK ANALYSIS - FRAUD DETECTION 🛡️
 * Comprehensive risk scoring with fraud indicators
 */
export async function handleGetRiskAnalysis({ customer_id }: { customer_id: string }): Promise<McpToolResponse> {
  const orgId = requireOrgId();
  
  let dbRun = await getRunWithFallback(orgId, customer_id);
  
  if (!dbRun) {
    return errorResponse("NO_RUN_FOR_CUSTOMER", `No run found for customer ${customer_id}`);
  }

  let profile = dbRun.profile as KycProfile | null;
  let validation = dbRun.validation as KycValidationResult | null;

  if (!profile || !validation) {
    await handleValidateKycProfile({ customer_id });
    dbRun = await getRunWithFallback(orgId, customer_id);
    if (!dbRun) {
      return errorResponse("DB_ERROR", "Failed to reload run after validation");
    }
    profile = dbRun.profile as KycProfile | null;
    validation = dbRun.validation as KycValidationResult | null;
  }

  if (!profile || !validation) {
    return errorResponse("PROFILE_OR_VALIDATION_MISSING", "Cannot perform risk analysis without profile");
  }

  const riskFactors: Array<{
    factor: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    score_impact: number;
    details: string;
  }> = [];

  let riskScore = 100; // Start at 100, deduct for risk factors

  // 1. Document Coverage Risk
  // Robustly ensure dbRun.docs is an array and handle missing/invalid structure.
  const docs = Array.isArray(dbRun.docs) ? dbRun.docs : [];
  const docTypes = new Set(
    docs
      .map((d: any) => (typeof d === 'object' && d !== null ? d.docType : undefined))
      .filter((x: any) => typeof x === 'string' && x.length > 0)
  );
  const docCoverage = docTypes.size / 5; // Assume 5 main doc types
  if (docCoverage < 0.4) {
    riskFactors.push({
      factor: 'LOW_DOCUMENT_COVERAGE',
      severity: 'high',
      score_impact: -25,
      details: `Only ${docTypes.size} document types provided. Insufficient for full verification.`,
    });
    riskScore -= 25;
  } else if (docCoverage < 0.6) {
    riskFactors.push({
      factor: 'MODERATE_DOCUMENT_COVERAGE',
      severity: 'medium',
      score_impact: -10,
      details: `${docTypes.size} document types provided. Additional documents recommended.`,
    });
    riskScore -= 10;
  }

  // 2. Validation Flags Risk
  const criticalFlags = validation.flags.filter(f => f.level === 'critical');
  const warningFlags = validation.flags.filter(f => f.level === 'warning');
  
  for (const flag of criticalFlags) {
    riskFactors.push({
      factor: flag.code,
      severity: 'critical',
      score_impact: -20,
      details: flag.message,
    });
    riskScore -= 20;
  }

  for (const flag of warningFlags) {
    riskFactors.push({
      factor: flag.code,
      severity: 'medium',
      score_impact: -5,
      details: flag.message,
    });
    riskScore -= 5;
  }

  // 3. Tax Status Risk
  if (profile.companyTaxProfile?.status && profile.companyTaxProfile.status !== 'ACTIVO') {
    riskFactors.push({
      factor: 'INACTIVE_TAX_STATUS',
      severity: 'critical',
      score_impact: -30,
      details: `Tax status is "${profile.companyTaxProfile.status}" instead of ACTIVO`,
    });
    riskScore -= 30;
  }

  // 4. Recent Incorporation Risk (new companies are higher risk)
  if (profile.companyIdentity?.incorporation_date) {
    const incDate = new Date(profile.companyIdentity.incorporation_date);
    const ageYears = (Date.now() - incDate.getTime()) / (365 * 24 * 60 * 60 * 1000);
    if (ageYears < 1) {
      riskFactors.push({
        factor: 'RECENTLY_INCORPORATED',
        severity: 'medium',
        score_impact: -10,
        details: `Company incorporated less than 1 year ago (${Math.round(ageYears * 12)} months)`,
      });
      riskScore -= 10;
    }
  }

  // 5. Missing Bank Account Risk
  if (!profile.bankAccounts || profile.bankAccounts.length === 0) {
    riskFactors.push({
      factor: 'NO_BANK_ACCOUNT_VERIFIED',
      severity: 'medium',
      score_impact: -15,
      details: 'No bank account information provided for financial verification',
    });
    riskScore -= 15;
  }

  // Ensure score is between 0 and 100
  riskScore = Math.max(0, Math.min(100, riskScore));

  // Determine risk category
  let riskCategory: 'low' | 'medium' | 'high' | 'extreme';
  if (riskScore >= 80) riskCategory = 'low';
  else if (riskScore >= 60) riskCategory = 'medium';
  else if (riskScore >= 40) riskCategory = 'high';
  else riskCategory = 'extreme';

  // Generate recommendation
  let recommendation: string;
  if (riskCategory === 'low') {
    recommendation = 'Profile presents minimal risk. Proceed with standard terms.';
  } else if (riskCategory === 'medium') {
    recommendation = 'Profile presents moderate risk. Consider additional verification or adjusted terms.';
  } else if (riskCategory === 'high') {
    recommendation = 'Profile presents high risk. Manual review required before proceeding.';
  } else {
    recommendation = 'Profile presents extreme risk. Do not proceed without thorough investigation.';
  }

  await logAudit(orgId, "risk_analyzed", {
    customerId: customer_id,
    runId: dbRun.id,
    riskScore,
    riskCategory,
    factorCount: riskFactors.length,
  });

  return okResponse({
    customer_id,
    risk_score: riskScore,
    risk_category: riskCategory,
    risk_factors: riskFactors,
    recommendation,
    analyzed_at: new Date().toISOString(),
  });
}

/**
 * Tool 5: BATCH IMPORT DOCUMENTS - ENTERPRISE SCALE 🚀
 * Import multiple documents in parallel for efficiency
 */
export async function handleBatchImportDocuments({ customer_id, documents }: { 
  customer_id: string; 
  documents: Array<{ doc_type: ImportableDocumentType; file_url: string; source_name?: string }>;
}): Promise<McpToolResponse> {
  const orgId = requireOrgId();
  
  if (!documents || documents.length === 0) {
    return errorResponse("NO_DOCUMENTS", "At least one document must be provided");
  }

  if (documents.length > 10) {
    return errorResponse("TOO_MANY_DOCUMENTS", "Maximum 10 documents per batch");
  }

  const startTime = Date.now();
  const results: Array<{
    doc_type: string;
    file_url: string;
    status: 'success' | 'failed';
    doc_id?: string;
    error?: string;
    model_used?: string;
  }> = [];

  // Process documents in parallel
  const promises = documents.map(async (doc) => {
    try {
      const response = await handleImportKycDocument({
        customer_id,
        doc_type: doc.doc_type,
        file_url: doc.file_url,
        source_name: doc.source_name,
      });

      // Parse the response
      const responseData = JSON.parse(response.content[0].text);
      
      if (responseData.ok) {
        return {
          doc_type: doc.doc_type,
          file_url: doc.file_url,
          status: 'success' as const,
          doc_id: responseData.data.doc_id,
          model_used: responseData.data.model_used,
        };
      } else {
        return {
          doc_type: doc.doc_type,
          file_url: doc.file_url,
          status: 'failed' as const,
          error: responseData.message,
        };
      }
    } catch (error: any) {
      return {
        doc_type: doc.doc_type,
        file_url: doc.file_url,
        status: 'failed' as const,
        error: error?.message || 'Unknown error',
      };
    }
  });

  const resolvedResults = await Promise.all(promises);
  results.push(...resolvedResults);

  const successCount = results.filter(r => r.status === 'success').length;
  const failedCount = results.filter(r => r.status === 'failed').length;
  const duration = Date.now() - startTime;

  await logAudit(orgId, "batch_import_completed", {
    customerId: customer_id,
    totalDocuments: documents.length,
    successCount,
    failedCount,
    durationMs: duration,
  });

  return okResponse({
    customer_id,
    total: documents.length,
    success_count: successCount,
    failed_count: failedCount,
    duration_ms: duration,
    results,
    next_step: successCount > 0 
      ? 'Run build_kyc_profile to aggregate documents into a unified profile'
      : 'Review failed imports and retry',
  });
}

/**
 * Tool 6: GET LEGAL CITATIONS - COMPLIANCE TRANSPARENCY 📚
 * Returns context-aware legal citations based on client profile
 * Only shows relevant citations (e.g., no immigration for Mexican citizens)
 */
export async function handleGetLegalCitations({ customer_id }: { customer_id: string }): Promise<McpToolResponse> {
  const orgId = requireOrgId();
  
  let dbRun = await getRunWithFallback(orgId, customer_id);
  
  if (!dbRun) {
    return errorResponse("NO_RUN_FOR_CUSTOMER", `No run found for customer ${customer_id}`);
  }

  let profile = dbRun.profile as KycProfile | null;

  if (!profile) {
    // Try to build profile first
    await handleBuildKycProfile({ customer_id });
    dbRun = await getRunWithFallback(orgId, customer_id);
    if (!dbRun) {
      return errorResponse("DB_ERROR", "Failed to reload run after profile build");
    }
    profile = dbRun.profile as KycProfile | null;
  }

  if (!profile) {
    return errorResponse("PROFILE_MISSING", "Cannot get citations without a built profile");
  }

  // Get validation if exists
  let validation = dbRun.validation as KycValidationResult | null;
  if (!validation) {
    await handleValidateKycProfile({ customer_id });
    dbRun = await getRunWithFallback(orgId, customer_id);
    if (dbRun) {
      validation = dbRun.validation as KycValidationResult | null;
    }
  }

  if (!validation) {
    return errorResponse("VALIDATION_MISSING", "Cannot get citations without validation");
  }

  // Import the decision citations generator
  const { generateDecisionCitations } = await import("../kyc/citationEngine.js");
  const citationReport = generateDecisionCitations(validation, profile);

  // Format citations for output
  const formattedCitations = citationReport.citas_por_decision.map(d => ({
    decision: d.decision,
    documento: d.documento,
    razon: d.razon,
    ley_nombre: d.cita.ley_nombre,
    articulo: d.cita.articulo,
    url: d.highlight_url,
    cita_textual: d.cita.cita_textual,
  }));

  await logAudit(orgId, "citations_generated", {
    customerId: customer_id,
    runId: dbRun?.id,
    totalCitations: citationReport.citas_por_decision.length,
  });

  return okResponse({
    customer_id,
    total_citas: citationReport.citas_por_decision.length,
    citas: formattedCitations,
    generado_en: citationReport.generado_en,
    nota: 'Citas basadas en las decisiones de validación. Al hacer clic, el texto relevante se resaltará en amarillo.',
  });
}

// --- MCP Server Setup ---

// Create server instance
const server = new McpServer({
  name: "mexkyc-mcp",
  version: "1.0.0"
});

// Supported doc types map for listing
const SUPPORTED_DOCS: Record<ImportableDocumentType, string> = {
  "acta": "Acta Constitutiva (Incorporation Deed) - Extracts Identity, Shareholders, Powers",
  "sat_constancia": "SAT Constancia de Situación Fiscal - Extracts Tax Profile",
  "fm2": "FM2 / Residente Card - Extracts Immigration Profile",
  "ine": "INE / IFE Credencial para Votar - Extracts Identity Profile",
  "passport": "Pasaporte (Mexican or Foreign) - Extracts Identity Profile",
  "telmex": "Telmex Bill - Extracts Proof of Address",
  "cfe": "CFE Electricity Bill - Extracts Proof of Address",
  "bank_statement": "Bank Statement - Extracts Profile & Transactions",
  "bank_identity_page": "Bank Identity Page - Extracts Account Profile from Bank Statement Identity Page"
};

// Wire tools to handlers
server.tool(
  "list_supported_doc_types",
  "Lists all supported document types",
  () => handleListSupportedDocTypes()
);

server.tool(
  "import_kyc_document",
  {
    customer_id: z.string(),
    doc_type: z.enum(["acta", "sat_constancia", "fm2", "ine", "passport", "telmex", "cfe", "bank_statement", "bank_identity_page"]),
    file_url: z.string(),
    source_name: z.string().optional()
  },
  handleImportKycDocument
);

server.tool(
  "build_kyc_profile",
  {
    customer_id: z.string()
  },
  handleBuildKycProfile
);

server.tool(
  "validate_kyc_profile",
  {
    customer_id: z.string()
  },
  handleValidateKycProfile
);

server.tool(
  "get_kyc_report",
  {
    customer_id: z.string(),
    include_trace: z.boolean().optional().default(false)
  },
  handleGetKycReport
);

// --- NEW MVP TOOLS (Top 5 for $5M Pitch) ---

// Tool 1: ASSESS CREDIT - THE MONEY MAKER 💰
server.tool(
  "assess_credit",
  {
    customer_id: z.string().describe("Customer identifier to assess credit for")
  },
  handleAssessCredit
);

// Tool 2: EXPLAIN VALIDATION - AI WOW FACTOR 🧠
server.tool(
  "explain_validation",
  {
    customer_id: z.string().describe("Customer identifier"),
    language: z.enum(["en", "es"]).optional().default("en").describe("Language for explanations (English or Spanish)")
  },
  handleExplainValidation
);

// Tool 3: SUGGEST MISSING DOCUMENTS - PROACTIVE AI 🤖
server.tool(
  "suggest_missing_documents",
  {
    customer_id: z.string().describe("Customer identifier to analyze")
  },
  handleSuggestMissingDocuments
);

// Tool 4: GET RISK ANALYSIS - FRAUD DETECTION 🛡️
server.tool(
  "get_risk_analysis",
  {
    customer_id: z.string().describe("Customer identifier for risk analysis")
  },
  handleGetRiskAnalysis
);

// Tool 5: BATCH IMPORT DOCUMENTS - ENTERPRISE SCALE 🚀
server.tool(
  "batch_import_documents",
  {
    customer_id: z.string().describe("Customer identifier"),
    documents: z.array(z.object({
      doc_type: z.enum(["acta", "sat_constancia", "fm2", "ine", "passport", "telmex", "cfe", "bank_statement", "bank_identity_page"]),
      file_url: z.string(),
      source_name: z.string().optional()
    })).min(1).max(10).describe("Array of documents to import (max 10)")
  },
  handleBatchImportDocuments
);

import { segmentDocument } from "../triage/documentClassifier.js";
import { splitPdf } from "../triage/pdfSplitter.js";
// getStandardizedFilename is used internally by pdfSplitter

// --- Triage Handler ---

export async function handleTriageDocuments({ customer_id, file_url, auto_import = false }: {
  customer_id: string;
  file_url: string;
  auto_import?: boolean;
}): Promise<McpToolResponse> {
  requireOrgId(); // Validates authentication context
  console.log(`[triage_documents] Processing ${file_url} for ${customer_id}`);

  try {
    const filePath = file_url.replace('file://', '');
    if (!fs.existsSync(filePath)) {
      return errorResponse("FILE_NOT_FOUND", `File not found: ${filePath}`);
    }

    // 1. Analyze and segment
    const segments = await segmentDocument(filePath);
    
    // 2. Split PDF - Save to the CLIENT'S mcp-docs folder (source of truth)
    // This enriches the client's document folder with properly separated files
    const sourceDir = path.dirname(filePath);
    const triageDir = path.join(sourceDir, 'documents'); // e.g., mcp-docs/alejandro-karam/documents/
    const splitResult = await splitPdf(filePath, segments, triageDir);
    
    // 3. Optionally archive the original bundled file
    const originalFileName = path.basename(filePath);
    const archiveDir = path.join(sourceDir, 'originals');
    if (!fs.existsSync(archiveDir)) {
      fs.mkdirSync(archiveDir, { recursive: true });
    }
    const archivePath = path.join(archiveDir, originalFileName);
    if (!fs.existsSync(archivePath)) {
      fs.copyFileSync(filePath, archivePath);
      console.log(`[triage_documents] Archived original to: ${archivePath}`);
    }

    const result = {
      original_file: path.basename(filePath),
      total_segments: segments.length,
      segments: splitResult.outputFiles.map(f => ({
        type: f.documentType,
        pages: `${f.pageRange[0]}-${f.pageRange[1]}`,
        file_path: f.path,
        metadata: f.extractedMetadata
      })),
      imported_docs: [] as string[]
    };

    // 3. Auto-import if requested
    if (auto_import) {
      for (const file of splitResult.outputFiles) {
        // Skip unknown documents unless they are substantial
        if (file.documentType === 'unknown' && (file.pageRange[1] - file.pageRange[0]) < 2) {
          continue;
        }

        // Import the split document
        // Map triage types to import types
        // Note: 'lista_asistentes' is not a primary KYC doc type yet, maybe treat as 'other' or skip
        let importType = file.documentType as ImportableDocumentType;
        if (file.documentType === 'lista_asistentes' || file.documentType === 'unknown') {
          // Skip for now or map to closest type
          continue; 
        }

        const importRes = await handleImportKycDocument({
          customer_id,
          doc_type: importType,
          file_url: `file://${file.path}`,
          source_name: path.basename(file.path)
        });
        
        const importData = JSON.parse(importRes.content[0].text);
        if (importData.ok) {
          result.imported_docs.push(path.basename(file.path));
        }
      }
    }

    return okResponse(result);

  } catch (error: any) {
    console.error("Triage error:", error);
    return errorResponse("TRIAGE_FAILED", error.message);
  }
}

// ... existing server.tool calls ...

// Tool 7: TRIAGE DOCUMENTS - AI PRE-PROCESSING 🧠
server.tool(
  "triage_documents",
  {
    customer_id: z.string().describe("Customer identifier"),
    file_url: z.string().describe("URL or path to the multi-document PDF"),
    auto_import: z.boolean().optional().describe("Automatically import split documents into the KYC profile")
  },
  handleTriageDocuments
);

export async function runServer() {
  if (process.env.MCP_TRANSPORT === "sse") {
    const app = Fastify({
      logger: true, // Use Fastify's default logger
      ajv: {
        customOptions: {
          strict: false, // Allow 'example' keyword in schemas
        },
      },
    });

    // Register CORS for ChatGPT Actions
    await app.register(cors, {
      origin: (origin, callback) => {
        // Allow requests from ChatGPT Actions
        if (!origin || 
            origin === 'https://chat.openai.com' ||
            origin === 'https://chatgpt.com' ||
            /^https:\/\/.*\.chatgpt\.com$/.test(origin)) {
          callback(null, true);
        } else {
          callback(null, true); // Allow all origins for development
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
    });

    // Register Swagger/OpenAPI
    await app.register(swagger, {
      openapi: {
        openapi: '3.1.0',
        info: {
          title: 'MexKYC API',
          description: 'MexKYC - AI-powered KYC document extraction and credit assessment API for Mexican business documents',
          version: '1.0.0',
        },
        servers: [
          {
            url: process.env.API_BASE_URL || 'http://localhost:3000',
            description: 'API Server',
          },
        ],
        components: {
          securitySchemes: {
            apiKey: {
              type: 'apiKey',
              name: 'x-api-key',
              in: 'header',
            },
          },
        },
        security: [{ apiKey: [] }],
      },
    });

    await app.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: false,
      },
    });

    // Register rate limiting plugin
    await app.register(rateLimit, rateLimitConfig);

    const port = parseInt(process.env.PORT || "3000", 10);

    let transport: SSEServerTransport | null = null;

    // Add correlation ID middleware (runs before auth)
    app.addHook("onRequest", correlationIdMiddleware);

    // Add request logging and metrics
    app.addHook("onRequest", async (request) => {
      const startTime = Date.now();
      request.startTime = startTime;
      
      // Log request
      const log = createContextLogger({
        corrId: request.corrId,
        orgId: (request as any).org?.id,
      });
      log.info({ method: request.method, url: request.url }, 'Incoming request');
    });

    app.addHook("onResponse", async (request, reply) => {
      const duration = ((request.startTime ? Date.now() - request.startTime : 0)) / 1000;
      const route = (request as any).routerPath || request.url.split('?')[0];
      
      // Record metrics
      metrics.httpRequestDuration.observe(
        { method: request.method, route, status: reply.statusCode },
        duration
      );
      metrics.httpRequestTotal.inc({
        method: request.method,
        route,
        status: reply.statusCode,
      });
      
      // Log response
      const log = createContextLogger({
        corrId: request.corrId,
        orgId: (request as any).org?.id,
      });
      log.info(
        {
          method: request.method,
          url: request.url,
          statusCode: reply.statusCode,
          duration,
        },
        'Request completed'
      );
    });

    // Apply API key authentication to all routes (except health/ready/metrics/docs/inspector)
    app.addHook("preHandler", async (request, reply) => {
      const path = request.url.split('?')[0];
      if (
        path === '/healthz' ||
        path === '/readyz' ||
        path === '/metrics' ||
        path.startsWith('/docs') ||
        path.startsWith('/mcp/tools') ||
        path === '/mcp/documents' ||
        path.startsWith('/mcp/latest-report')
      ) {
        return; // Skip auth for health/ready/metrics/docs/inspector/documents/latest-report
      }
      return apiKeyAuth(request, reply);
    });

    // Health and metrics endpoints (no auth required)
    app.get('/healthz', handleHealthz);
    app.get('/readyz', handleReadyz);
    app.get('/metrics', handleMetrics);

    // REST API Routes
    app.post('/kyc/check', {
      schema: {
        description: 'Check/import a KYC document',
        tags: ['KYC'],
        body: {
          type: 'object',
          required: ['customer_id', 'doc_type', 'file_url'],
          properties: {
            customer_id: { type: 'string', example: 'customer-123' },
            doc_type: {
              type: 'string',
              enum: ['acta', 'sat_constancia', 'fm2', 'ine', 'passport', 'telmex', 'cfe', 'bank_statement', 'bank_identity_page'],
              example: 'acta',
            },
            file_url: { type: 'string', example: 'https://example.com/document.pdf' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              run_id: { type: 'string', example: '550e8400-e29b-41d4-a716-446655440000' },
              doc_id: { type: 'string', example: '660e8400-e29b-41d4-a716-446655440000' },
              model_used: { type: 'string', example: 'gpt-5.1' },
            },
          },
        },
      },
    }, handleKycCheck);

    app.post('/credit/assess', {
      schema: {
        description: 'Assess creditworthiness based on KYC profile',
        tags: ['Credit'],
        body: {
          type: 'object',
          required: ['customer_id'],
          properties: {
            customer_id: { type: 'string', example: 'customer-123' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              decision_id: { type: 'string', example: '770e8400-e29b-41d4-a716-446655440000' },
              limit: { type: 'number', example: 100000 },
              terms: { type: 'string', example: 'Standard terms: 30-day payment, 2% interest' },
              score: { type: 'number', example: 0.85 },
              flags: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    code: { type: 'string', example: 'ADDRESS_MISMATCH' },
                    level: { type: 'string', enum: ['info', 'warning', 'critical'], example: 'warning' },
                    message: { type: 'string', example: 'Address mismatch detected' },
                  },
                },
              },
              reasons: {
                type: 'array',
                items: { type: 'string' },
                example: ['High KYC score and no critical flags'],
              },
            },
          },
        },
      },
    }, handleCreditAssess);

    app.get('/audit/:decision_id', {
      schema: {
        description: 'Get audit information for a decision',
        tags: ['Audit'],
        params: {
          type: 'object',
          properties: {
            decision_id: { type: 'string', example: '770e8400-e29b-41d4-a716-446655440000' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              decision_id: { type: 'string' },
              run_id: { type: 'string' },
              customer_id: { type: 'string' },
              decision: { type: 'string', enum: ['approved', 'rejected', 'pending'] },
              score: { type: 'number', nullable: true },
              created_at: { type: 'string', format: 'date-time' },
              profile: { type: 'object' },
              validation: { type: 'object' },
              audit_trail: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    event_type: { type: 'string' },
                    metadata: { type: 'object' },
                    created_at: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    }, handleGetAudit);

    // PDF Viewer Route - Serves custom PDF viewer with article highlighting
    // PDF viewer route removed - using direct PDF links instead
    // Citations now link directly to official PDF URLs with page anchors

    // MCP Tool Testing Endpoint (for inspector GUI)
    app.post('/mcp/tools/:toolName', {
      schema: {
        description: 'Test an MCP tool directly',
        tags: ['MCP'],
        params: {
          type: 'object',
          properties: {
            toolName: { type: 'string' },
          },
        },
        body: {
          type: 'object',
        },
        // Remove strict response schema validation to allow any response
        response: {},
      },
    }, async (request, reply) => {
      const { toolName } = request.params as { toolName: string };
      const args = request.body as Record<string, unknown>;
      
      // Use orgId from request if available, otherwise use demo org
      const orgId = (request as any).org?.id || 'demo-org';
      
      const log = createContextLogger({
        orgId,
        corrId: request.corrId,
      });
      
      log.info({ toolName, args }, 'MCP tool test request');
      
      try {
        // Map tool names to their handlers directly
        const toolHandlers: Record<string, (args: any) => Promise<McpToolResponse>> = {
          'list_supported_doc_types': () => handleListSupportedDocTypes(),
          'import_kyc_document': (a) => handleImportKycDocument(a),
          'build_kyc_profile': (a) => handleBuildKycProfile(a),
          'validate_kyc_profile': (a) => handleValidateKycProfile(a),
          'get_kyc_report': (a) => handleGetKycReport(a),
          'assess_credit': (a) => handleAssessCredit(a),
          'explain_validation': (a) => handleExplainValidation(a),
          'suggest_missing_documents': (a) => handleSuggestMissingDocuments(a),
          'get_risk_analysis': (a) => handleGetRiskAnalysis(a),
          'batch_import_documents': (a) => handleBatchImportDocuments(a),
          'get_legal_citations': (a) => handleGetLegalCitations(a),
          'triage_documents': (a) => handleTriageDocuments(a),
        };
        
        const handler = toolHandlers[toolName];
        if (!handler) {
          reply.code(404).send({
            error: 'TOOL_NOT_FOUND',
            message: `Tool '${toolName}' not found. Available tools: ${Object.keys(toolHandlers).join(', ')}`,
          });
          return;
        }
        
        // Execute tool within org context
        const result = await orgContext.run({ orgId }, async () => {
          return await handler(args);
        });
        
        log.info({ result, resultType: typeof result, hasContent: !!result?.content }, 'Tool execution result');
        
        // Parse MCP response
        const responseText = result?.content?.[0]?.text;
        if (!responseText) {
          log.error({ result, resultKeys: result ? Object.keys(result) : 'null' }, 'Tool returned empty response');
          reply.code(500).send({ 
            error: 'Invalid response from tool',
            details: 'Tool returned empty content',
            result: result,
            debug: {
              hasResult: !!result,
              hasContent: !!result?.content,
              contentLength: result?.content?.length,
              firstContent: result?.content?.[0]
            }
          });
          return;
        }
        
        try {
          const parsed = JSON.parse(responseText);
          log.info({ parsed, parsedKeys: Object.keys(parsed), parsedString: JSON.stringify(parsed) }, 'Successfully parsed tool response');
          
          // Ensure we're sending the response correctly
          const responseToSend = parsed;
          log.info({ responseToSend, willSend: JSON.stringify(responseToSend).substring(0, 100) }, 'About to send response');
          
          return reply.code(200).type('application/json').send(responseToSend);
        } catch (parseError: any) {
          log.error({ responseText, parseError }, 'Failed to parse tool response');
          reply.code(500).send({
            error: 'Failed to parse tool response',
            message: parseError?.message || 'Invalid JSON',
            rawResponse: responseText
          });
        }
      } catch (error: any) {
        log.error({ error: error.message, stack: error.stack }, 'MCP tool test failed');
        reply.code(500).send({
          error: 'TOOL_EXECUTION_FAILED',
          message: error?.message || 'Unknown error',
          ...(process.env.NODE_ENV === 'development' ? { stack: error.stack } : {}),
        });
      }
    });

    // Get available MCP tools (for inspector GUI)
    app.get('/mcp/tools', {
      schema: {
        description: 'List all available MCP tools',
        tags: ['MCP'],
        // Remove strict response schema to allow any structure
        response: {},
      },
    }, async (_request, reply) => {
      try {
        // Use hardcoded tool definitions as primary source (more reliable than extracting from MCP SDK)
        const tools: Array<{ name: string; description: string; parameters: any }> = [
          { 
            name: 'list_supported_doc_types', 
            description: 'Lists all supported document types', 
            parameters: {} 
          },
          { 
            name: 'import_kyc_document', 
            description: 'Imports a KYC document, extracts structured data, and stores it', 
            parameters: { 
              properties: { 
                customer_id: { type: 'string', description: 'Unique customer identifier' }, 
                doc_type: { type: 'string', enum: ['acta', 'sat_constancia', 'fm2', 'ine', 'passport', 'telmex', 'cfe', 'bank_statement', 'bank_identity_page'], description: 'Document type' }, 
                file_url: { type: 'string', description: 'URL or path to document file' }, 
                source_name: { type: 'string', description: 'Human-readable source name (optional)' } 
              }, 
              required: ['customer_id', 'doc_type', 'file_url'] 
            } 
          },
          { 
            name: 'build_kyc_profile', 
            description: 'Aggregates all imported documents into a unified KYC profile', 
            parameters: { 
              properties: { 
                customer_id: { type: 'string', description: 'Customer identifier' } 
              }, 
              required: ['customer_id'] 
            } 
          },
          { 
            name: 'validate_kyc_profile', 
            description: 'Validates a KYC profile and generates validation results', 
            parameters: { 
              properties: { 
                customer_id: { type: 'string', description: 'Customer identifier' } 
              }, 
              required: ['customer_id'] 
            } 
          },
          { 
            name: 'get_kyc_report', 
            description: 'Generates a comprehensive KYC report', 
            parameters: { 
              properties: { 
                customer_id: { type: 'string', description: 'Customer identifier' }, 
                include_trace: { type: 'boolean', description: 'Include traceability section (default: false)' } 
              }, 
              required: ['customer_id'] 
            } 
          },
          { 
            name: 'assess_credit', 
            description: 'Assess creditworthiness based on KYC profile', 
            parameters: { 
              properties: { 
                customer_id: { type: 'string', description: 'Customer identifier to assess credit for' } 
              }, 
              required: ['customer_id'] 
            } 
          },
          { 
            name: 'explain_validation', 
            description: 'Explain validation results in natural language', 
            parameters: { 
              properties: { 
                customer_id: { type: 'string', description: 'Customer identifier' }, 
                language: { type: 'string', enum: ['en', 'es'], description: 'Language for explanations (English or Spanish)', default: 'en' } 
              }, 
              required: ['customer_id'] 
            } 
          },
          { 
            name: 'suggest_missing_documents', 
            description: 'Suggest missing documents needed for complete KYC', 
            parameters: { 
              properties: { 
                customer_id: { type: 'string', description: 'Customer identifier to analyze' } 
              }, 
              required: ['customer_id'] 
            } 
          },
          { 
            name: 'get_risk_analysis', 
            description: 'Get risk analysis and fraud detection flags', 
            parameters: { 
              properties: { 
                customer_id: { type: 'string', description: 'Customer identifier for risk analysis' } 
              }, 
              required: ['customer_id'] 
            } 
          },
          { 
            name: 'batch_import_documents', 
            description: 'Batch import multiple documents at once', 
            parameters: { 
              properties: { 
                customer_id: { type: 'string', description: 'Customer identifier' }, 
                documents: { 
                  type: 'array', 
                  items: {
                    type: 'object',
                    properties: {
                      doc_type: { type: 'string', enum: ['acta', 'sat_constancia', 'fm2', 'ine', 'passport', 'telmex', 'cfe', 'bank_statement', 'bank_identity_page'] },
                      file_url: { type: 'string' },
                      source_name: { type: 'string' }
                    },
                    required: ['doc_type', 'file_url']
                  },
                  description: 'Array of documents to import (max 10)'
                } 
              }, 
              required: ['customer_id', 'documents'] 
            } 
          },
          { 
            name: 'get_legal_citations', 
            description: 'Get legal citations and compliance references', 
            parameters: { 
              properties: { 
                customer_id: { type: 'string', description: 'Customer identifier to get citations for' } 
              }, 
              required: ['customer_id'] 
            } 
          },
          {
            name: 'triage_documents',
            description: 'Analyze and split multi-page PDFs into individual documents',
            parameters: {
              properties: {
                customer_id: { type: 'string', description: 'Customer identifier' },
                file_url: { type: 'string', description: 'URL or path to the multi-document PDF' },
                auto_import: { type: 'boolean', description: 'Automatically import split documents into the KYC profile' }
              },
              required: ['customer_id', 'file_url']
            }
          }
        ];
        
        // Log for debugging
        console.log(`[MCP Tools] Returning ${tools.length} tools`);
        const buildProfileTool = tools.find(t => t.name === 'build_kyc_profile');
        if (buildProfileTool) {
          console.log(`[MCP Tools] build_kyc_profile parameters:`, JSON.stringify(buildProfileTool.parameters));
        }
        
        // Fallback: Try to get tools from server if hardcoded list is empty (shouldn't happen)
        if (tools.length === 0) {
          tools.push(
            { name: 'list_supported_doc_types', description: 'Lists all supported document types', parameters: {} },
            { name: 'import_kyc_document', description: 'Imports a KYC document', parameters: { properties: { customer_id: { type: 'string' }, doc_type: { type: 'string' }, file_url: { type: 'string' }, source_name: { type: 'string' } }, required: ['customer_id', 'doc_type', 'file_url'] } },
            { name: 'build_kyc_profile', description: 'Builds KYC profile', parameters: { properties: { customer_id: { type: 'string' } }, required: ['customer_id'] } },
            { name: 'validate_kyc_profile', description: 'Validates KYC profile', parameters: { properties: { customer_id: { type: 'string' } }, required: ['customer_id'] } },
            { name: 'get_kyc_report', description: 'Gets KYC report', parameters: { properties: { customer_id: { type: 'string' } }, required: ['customer_id'] } },
            { name: 'triage_documents', description: 'Triage documents', parameters: { properties: { customer_id: { type: 'string' }, file_url: { type: 'string' } }, required: ['customer_id', 'file_url'] } }
          );
        }
        
        reply.send({ tools });
      } catch (error: any) {
        console.error('Error listing tools:', error);
        // Return fallback tools even on error
        reply.send({
          tools: [
            { name: 'list_supported_doc_types', description: 'Lists all supported document types', parameters: {} },
            { name: 'import_kyc_document', description: 'Imports a KYC document', parameters: { properties: { customer_id: { type: 'string' }, doc_type: { type: 'string' }, file_url: { type: 'string' }, source_name: { type: 'string' } }, required: ['customer_id', 'doc_type', 'file_url'] } },
            { name: 'build_kyc_profile', description: 'Builds KYC profile', parameters: { properties: { customer_id: { type: 'string' } }, required: ['customer_id'] } },
            { name: 'validate_kyc_profile', description: 'Validates KYC profile', parameters: { properties: { customer_id: { type: 'string' } }, required: ['customer_id'] } },
            { name: 'get_kyc_report', description: 'Gets KYC report', parameters: { properties: { customer_id: { type: 'string' } }, required: ['customer_id'] } },
          ],
          error: error?.message || 'Using fallback tool list'
        });
      }
    });

    // List available test documents (for inspector GUI)
    app.get('/mcp/documents', {
      schema: {
        description: 'List available test documents from mcp-docs folder',
        tags: ['MCP'],
        response: {},
      },
    }, async (_request, reply) => {
      try {
        const mcpDocsPath = path.join(process.env.HOME || '/Users/ashishpunj', 'Desktop', 'mcp-docs');
        const customers: Record<string, Array<{ name: string; path: string; type: string; suggestedDocType: string }>> = {};
        
        // Helper to suggest doc type from filename
        const suggestDocType = (filename: string): string => {
          const lower = filename.toLowerCase();
          
          // Skip passport backside files
          if (lower.includes('backside')) return 'skip';
          
          // Remove numbered prefixes (e.g., "1. Acta..." -> "Acta...")
          const cleanName = lower.replace(/^\d+\.\s*/, '');
          
          // Check CFE and Telmex BEFORE bank statements (they may contain "octubre")
          if (cleanName.includes('cfe') || cleanName.includes('luz') || cleanName.includes('comprobante')) return 'cfe';
          if (cleanName.includes('telmex') || (cleanName.includes('recibo') && !cleanName.includes('cfe'))) return 'telmex';
          
          // Bank statement (check for estado/cuenta/bank after CFE/Telmex)
          // Handle typo "esatdo" and month names
          if (cleanName.includes('estado') || cleanName.includes('esatdo') || 
              cleanName.includes('cuenta') || cleanName.includes('bank') || 
              cleanName.includes('octubre') || cleanName.includes('october')) {
            return 'bank_identity_page';
          }
          
          if (cleanName.includes('acta') || cleanName.includes('constitutiva')) return 'acta';
          if (cleanName.includes('constancia') || cleanName.includes('situacion fiscal') || cleanName.includes('gpo')) return 'sat_constancia';
          if (cleanName.includes('fm2') || cleanName.includes('fm3') || cleanName.includes('residente')) return 'fm2';
          if (cleanName.includes('ine') || cleanName.includes('credencial')) return 'ine';
          if (cleanName.includes('passport') || cleanName.includes('pasaporte')) {
            // Skip backside - contains family info, not holder info
            if (lower.includes('backside')) return 'skip';
            // Accept passport files with person names (e.g., "Passport_Front_Ashish_Punj_...")
            return 'passport';
          }
          
          return 'other';
        };
        
        if (fs.existsSync(mcpDocsPath)) {
          const dirs = fs.readdirSync(mcpDocsPath).filter(d => 
            fs.statSync(path.join(mcpDocsPath, d)).isDirectory() && !d.startsWith('.')
          );
          
          for (const dir of dirs) {
            const customerPath = path.join(mcpDocsPath, dir);
            const files = fs.readdirSync(customerPath).filter(f => 
              !f.startsWith('.') && 
              (f.endsWith('.pdf') || f.endsWith('.PDF') || 
               f.endsWith('.jpg') || f.endsWith('.jpeg') || 
               f.endsWith('.png') || f.endsWith('.JPG') || f.endsWith('.JPEG'))
            );
            
            customers[dir] = files.map(f => ({
              name: f,
              path: path.join(customerPath, f),
              type: f.split('.').pop()?.toLowerCase() || 'pdf',
              suggestedDocType: suggestDocType(f)
            }));
          }
        }
        
        // Also list existing customer runs from data folder
        const dataPath = path.join(process.cwd(), 'data');
        const existingRuns: string[] = [];
        if (fs.existsSync(dataPath)) {
          const dataDirs = fs.readdirSync(dataPath).filter(d => 
            fs.statSync(path.join(dataPath, d)).isDirectory() && !d.startsWith('.')
          );
          existingRuns.push(...dataDirs);
        }
        
        reply.send({ 
          documents: customers,
          existingCustomers: existingRuns,
          mcpDocsPath,
          dataPath
        });
      } catch (error: any) {
        console.error('Error listing documents:', error);
        reply.code(500).send({
          ok: false,
          error_code: 'FAILED_TO_LIST_DOCUMENTS',
          message: error?.message || 'Unknown error',
        });
      }
    });

    // Get latest report URL for a customer (no auth required - just returns file path)
    app.get('/mcp/latest-report/:customer_id', {
      schema: {
        description: 'Get the latest report URL for a customer',
        tags: ['MCP'],
        params: {
          type: 'object',
          properties: {
            customer_id: { type: 'string' }
          },
          required: ['customer_id']
        },
      },
      config: {
        skipAuth: true  // Allow unauthenticated access
      }
    }, async (request: any, reply) => {
      try {
        const { customer_id } = request.params;
        const dataPath = path.join(process.cwd(), 'data', customer_id, 'reports');
        
        // Check if reports directory exists
        if (!fs.existsSync(dataPath)) {
          reply.code(404).send({ ok: false, error: 'No reports found for customer' });
          return;
        }
        
        // Find the latest HTML report
        const files = fs.readdirSync(dataPath)
          .filter((f: string) => f.endsWith('.html'))
          .map((f: string) => ({
            name: f,
            path: path.join(dataPath, f),
            mtime: fs.statSync(path.join(dataPath, f)).mtime
          }))
          .sort((a: any, b: any) => b.mtime.getTime() - a.mtime.getTime());
        
        if (files.length === 0) {
          reply.code(404).send({ ok: false, error: 'No HTML reports found' });
          return;
        }
        
        const latestReport = files[0];
        const relativePath = `data/${customer_id}/reports/${latestReport.name}`;
        
        reply.send({
          ok: true,
          report_url: relativePath,
          report_name: latestReport.name,
          generated_at: latestReport.mtime.toISOString()
        });
      } catch (error: any) {
        console.error('Error getting latest report:', error);
        reply.code(500).send({
          ok: false,
          error: error?.message || 'Unknown error',
        });
      }
    });

    app.get("/sse", async (request, reply) => {
      console.log("New SSE connection established");
      // Store orgId in context for this request
      const orgId = request.org?.id;
      if (!orgId) {
        reply.code(401).send({ error: "Organization not authenticated" });
        return;
      }
      
      // SSEServerTransport works with Node.js raw response object
      // Fastify's reply.raw is compatible
      const nodeRes = reply.raw;
      
      // Run MCP server connection within org context
      await orgContext.run({ orgId }, async () => {
        transport = new SSEServerTransport("/message", nodeRes);
        await server.connect(transport);
      });
    });

    app.post("/message", async (request, reply) => {
      if (!transport) {
        reply.code(400).send({ error: "No active SSE connection" });
        return;
      }
      
      // Get orgId from authenticated request
      const orgId = request.org?.id;
      if (!orgId) {
        reply.code(401).send({ error: "Organization not authenticated" });
        return;
      }
      
      // Run message handling within org context
      await orgContext.run({ orgId }, async () => {
        // SSEServerTransport expects Node.js raw request/response
        const nodeReq = request.raw;
        const nodeRes = reply.raw;
        await transport!.handlePostMessage(nodeReq, nodeRes);
      });
    });

    try {
      await app.listen({ port, host: "0.0.0.0" });
      console.log(`MexKYC MCP Server running on SSE at http://localhost:${port}/sse`);
      console.log(`API Documentation available at http://localhost:${port}/docs`);
    } catch (err) {
      app.log.error(err);
      process.exit(1);
    }
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("MexKYC MCP Server running on stdio");
  }
}