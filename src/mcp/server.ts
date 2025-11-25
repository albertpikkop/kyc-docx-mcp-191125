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

// --- MCP Server Setup ---

// Create server instance
const server = new McpServer({
  name: "mx-kyc-mcp",
  version: "1.0.0"
});

// Supported doc types map for listing
const SUPPORTED_DOCS: Record<ImportableDocumentType, string> = {
  "acta": "Acta Constitutiva (Incorporation Deed) - Extracts Identity, Shareholders, Powers",
  "sat_constancia": "SAT Constancia de Situación Fiscal - Extracts Tax Profile",
  "fm2": "FM2 / Residente Card - Extracts Immigration Profile",
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
    doc_type: z.enum(["acta", "sat_constancia", "fm2", "telmex", "cfe", "bank_statement", "bank_identity_page"]),
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
          title: 'KYC & Credit Assessment API',
          description: 'API for KYC document checking and credit assessment',
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
              enum: ['acta', 'sat_constancia', 'fm2', 'telmex', 'cfe', 'bank_statement', 'bank_identity_page'],
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
      console.log(`MX KYC MCP Server running on SSE at http://localhost:${port}/sse`);
    } catch (err) {
      app.log.error(err);
      process.exit(1);
    }
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("MX KYC MCP Server running on stdio");
  }
}
