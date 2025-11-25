import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { z } from "zod";
import { logger, createContextLogger } from "../utils/logger.js";
import { handleHealthz, handleReadyz, handleMetrics, metrics } from "./health.js";
import { correlationIdMiddleware } from "./correlationId.js";
import * as crypto from 'crypto';
import * as path from 'path';

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
// File-based storage kept for backward compatibility (not used in DB flow)
// import { saveRun, loadLatestRun } from "../kyc/storage.js";
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
import { extractTelmexProofOfAddress } from "../extractors/telmexProofOfAddress.js";
import { extractCfeProofOfAddress } from "../extractors/cfeProofOfAddress.js";
import { extractBankStatementProfile } from "../extractors/bankStatementProfile.js";
import { extractBankStatementTransactions } from "../extractors/bankStatementTransactions.js";
import { extractBankIdentityPage } from "../extractors/bankIdentityPage.js";
import { DEMO_CONFIG } from "../core/demoConfig.js";

// AsyncLocalStorage for passing orgId through async call stack
const orgContext = new AsyncLocalStorage<{ orgId: string }>();

// Helper to get orgId from context (throws if not set)
export function requireOrgId(): string {
  const context = orgContext.getStore();
  if (!context?.orgId) {
    throw new Error("orgId not found in context - request must be authenticated");
  }
  return context.orgId;
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

  // Get or create run using Prisma (requires orgId)
  let dbRun = await getLatestRunDb(orgId, customer_id);
  
  if (!dbRun) {
    await createRunDb(orgId, customer_id);
    dbRun = await getLatestRunDb(orgId, customer_id);
    if (!dbRun) {
      return errorResponse("DB_ERROR", "Failed to create run");
    }
  }

  // Append main document
  const mainDocId = await appendDocDb(dbRun.id, {
    docType: doc_type,
    fileUrl: file_url,
    sourceName: source_name || path.basename(file_url),
    extractedPayload,
  });

  // Append supplemental documents
  const supplementalDocIds: string[] = [];
  for (const suppDoc of supplementalDocs) {
    const suppDocId = await appendDocDb(dbRun.id, {
      docType: suppDoc.type,
      fileUrl: suppDoc.fileUrl,
      sourceName: suppDoc.sourceName,
      extractedPayload: suppDoc.extractedPayload,
    });
    supplementalDocIds.push(suppDocId.id);
  }

  // Log audit event
  await logAudit(orgId, "document_imported", {
    customerId: customer_id,
    docType: doc_type,
    runId: dbRun.id,
    docId: mainDocId.id,
    modelUsed: extractedPayload?._metadata?.modelUsed
  });

  return okResponse({
    customer_id,
    run_id: dbRun.id,
    doc_id: mainDocId.id,
    doc_type,
    supplemental_doc_ids: supplementalDocIds,
    status: "imported",
    model_used: extractedPayload?._metadata?.modelUsed
  });
}

export async function handleBuildKycProfile({ customer_id }: { customer_id: string }): Promise<McpToolResponse> {
  const orgId = requireOrgId();
  
  const dbRun = await getLatestRunDb(orgId, customer_id);
  
  if (!dbRun) {
    return errorResponse("NO_RUN_FOR_CUSTOMER", `No run found for customer ${customer_id}`);
  }

  // Convert DB run to in-memory format for profile building
  const run = {
    runId: dbRun.id,
    customerId: dbRun.customerId,
    createdAt: dbRun.createdAt.toISOString(),
    documents: dbRun.docs.map(doc => ({
      id: doc.id,
      customerId: dbRun.customerId,
      type: doc.docType as DocumentType,
      fileUrl: doc.fileUrl,
      extractedAt: doc.createdAt.toISOString(),
      extractedPayload: doc.extractedPayload,
      sourceName: doc.sourceName || undefined,
    })),
  };

  // Aggregate data from documents
  let companyIdentity: CompanyIdentity | undefined;
  let companyTaxProfile: CompanyTaxProfile | undefined;
  let representativeIdentity: ImmigrationProfile | undefined;
  const proofsOfAddress: ProofOfAddress[] = [];
  const bankAccounts: BankAccountProfile[] = [];

  for (const doc of run.documents) {
    if (!doc.extractedPayload) continue;

    const payload = doc.extractedPayload as any;

    switch (doc.type) {
      case "acta":
        companyIdentity = payload;
        break;
      case "sat_constancia":
        companyTaxProfile = payload;
        break;
      case "fm2":
        representativeIdentity = payload;
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

  const profile = buildKycProfile({
    customerId: customer_id,
    companyIdentity,
    companyTaxProfile,
    representativeIdentity,
    proofsOfAddress,
    bankAccounts
  });

  // Save profile to database
  await updateRunDb(dbRun.id, { profile, status: "completed" });

  // Log audit event
  await logAudit(orgId, "profile_built", {
    customerId: customer_id,
    runId: dbRun.id,
  });

  return okResponse(profile);
}

export async function handleValidateKycProfile({ customer_id }: { customer_id: string }): Promise<McpToolResponse> {
  const orgId = requireOrgId();
  
  let dbRun = await getLatestRunDb(orgId, customer_id);
  
  if (!dbRun) {
    return errorResponse("NO_RUN_FOR_CUSTOMER", `No run found for customer ${customer_id}`);
  }

  // Get profile from DB run
  let profile = dbRun.profile as KycProfile | null;
  
  if (!profile) {
    // Auto-build if missing
    await handleBuildKycProfile({ customer_id });
    // Reload to get the profile
    dbRun = await getLatestRunDb(orgId, customer_id);
    if (!dbRun) {
      return errorResponse("DB_ERROR", "Failed to reload run");
    }
    profile = dbRun.profile as KycProfile | null;
    if (!profile) {
      return errorResponse("PROFILE_BUILD_FAILED", `Failed to build profile for customer ${customer_id}`);
    }
  }

  const validation = validateKycProfile(profile);
  
  // Save validation to database
  await updateRunDb(dbRun.id, { validation, status: "completed" });

  // Log audit event
  await logAudit(orgId, "profile_validated", {
    customerId: customer_id,
    runId: dbRun.id,
    score: validation.score,
  });

  return okResponse(validation);
}

export async function handleGetKycReport({ customer_id, include_trace = false }: { customer_id: string; include_trace?: boolean }): Promise<McpToolResponse> {
  const orgId = requireOrgId();
  
  let dbRun = await getLatestRunDb(orgId, customer_id);
  
  if (!dbRun) {
    return errorResponse("NO_RUN_FOR_CUSTOMER", `No run found for customer ${customer_id}`);
  }

  let profile = dbRun.profile as KycProfile | null;
  let validation = dbRun.validation as KycValidationResult | null;

  if (!profile || !validation) {
    await handleValidateKycProfile({ customer_id }); // This triggers build if needed
    dbRun = await getLatestRunDb(orgId, customer_id);
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

  return okResponse(report);
}

// --- NEW MVP TOOLS (Top 5 for $5M Pitch) ---

/**
 * Tool 1: ASSESS CREDIT - THE MONEY MAKER 💰
 * Deterministic credit scoring with full transparency
 */
export async function handleAssessCredit({ customer_id }: { customer_id: string }): Promise<McpToolResponse> {
  const orgId = requireOrgId();
  
  let dbRun = await getLatestRunDb(orgId, customer_id);
  
  if (!dbRun) {
    return errorResponse("NO_RUN_FOR_CUSTOMER", `No run found for customer ${customer_id}`);
  }

  let profile = dbRun.profile as KycProfile | null;
  let validation = dbRun.validation as KycValidationResult | null;

  // Auto-build and validate if needed
  if (!profile || !validation) {
    await handleValidateKycProfile({ customer_id });
    dbRun = await getLatestRunDb(orgId, customer_id);
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
  
  let dbRun = await getLatestRunDb(orgId, customer_id);
  
  if (!dbRun) {
    return errorResponse("NO_RUN_FOR_CUSTOMER", `No run found for customer ${customer_id}`);
  }

  let profile = dbRun.profile as KycProfile | null;
  let validation = dbRun.validation as KycValidationResult | null;

  if (!profile || !validation) {
    await handleValidateKycProfile({ customer_id });
    dbRun = await getLatestRunDb(orgId, customer_id);
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

  // Flag explanations
  const flagMessages: Record<string, { en: string; es: string; rec_en: string; rec_es: string }> = {
    'ADDRESS_MISMATCH': {
      en: 'The fiscal address from SAT does not match the address found in proof of address documents.',
      es: 'La dirección fiscal del SAT no coincide con la dirección en los comprobantes de domicilio.',
      rec_en: 'Verify the customer has updated their SAT registration or provide a more recent proof of address.',
      rec_es: 'Verificar que el cliente haya actualizado su registro en el SAT o proporcionar un comprobante de domicilio más reciente.',
    },
    'REP_ID_MISMATCH': {
      en: 'The legal representative\'s identity document does not match the name in the Acta Constitutiva.',
      es: 'El documento de identidad del representante legal no coincide con el nombre en el Acta Constitutiva.',
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
  
  const dbRun = await getLatestRunDb(orgId, customer_id);
  
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
  
  let dbRun = await getLatestRunDb(orgId, customer_id);
  
  if (!dbRun) {
    return errorResponse("NO_RUN_FOR_CUSTOMER", `No run found for customer ${customer_id}`);
  }

  let profile = dbRun.profile as KycProfile | null;
  let validation = dbRun.validation as KycValidationResult | null;

  if (!profile || !validation) {
    await handleValidateKycProfile({ customer_id });
    dbRun = await getLatestRunDb(orgId, customer_id);
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
  const docTypes = new Set(dbRun.docs.map(d => d.docType));
  const docCoverage = docTypes.size / 5; // Assume 5 main doc types
  if (docCoverage < 0.4) {
    riskFactors.push({
      factor: 'LOW_DOCUMENT_COVERAGE',
      severity: 'high',
      score_impact: -25,
      details: `Only ${docTypes.size} document types provided. Insufficient for comprehensive verification.`,
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

export async function runServer() {
  if (process.env.MCP_TRANSPORT === "sse") {
    const app = Fastify({
      logger: logger,
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

    // Apply API key authentication to all routes (except health/ready/metrics/docs)
    app.addHook("preHandler", async (request, reply) => {
      const path = request.url.split('?')[0];
      if (
        path === '/healthz' ||
        path === '/readyz' ||
        path === '/metrics' ||
        path.startsWith('/docs')
      ) {
        return; // Skip auth for health/ready/metrics/docs
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
