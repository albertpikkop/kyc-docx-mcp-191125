import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as crypto from 'crypto';
import * as path from 'path';

// Domain imports
import { 
  DocumentType, 
  KycRun, 
  KycDocument, 
  KycProfile,
  CompanyIdentity,
  CompanyTaxProfile,
  ImmigrationProfile,
  ProofOfAddress,
  BankAccountProfile
} from "../kyc/types.js";
import { saveRun, loadLatestRun } from "../kyc/storage.js";
import { buildKycProfile } from "../kyc/profileBuilder.js";
import { validateKycProfile } from "../kyc/validation.js";
import { buildKycReport } from "../kyc/reportBuilder.js";

// Extractors
import { extractCompanyIdentity } from "../extractors/actaCompanyIdentity.js";
import { extractCompanyTaxProfile } from "../extractors/companyTaxProfileExtractor.js";
import { extractImmigrationProfile } from "../extractors/fm2Immigration.js";
import { extractTelmexProofOfAddress } from "../extractors/telmexProofOfAddress.js";
import { extractCfeProofOfAddress } from "../extractors/cfeProofOfAddress.js";
import { extractBankStatementProfile } from "../extractors/bankStatementProfile.js";
import { extractBankStatementTransactions } from "../extractors/bankStatementTransactions.js";

// --- Exported Handlers for Direct Usage / Testing ---

export async function handleListSupportedDocTypes() {
  const docs = Object.entries(SUPPORTED_DOCS).map(([type, desc]) => ({
    type,
    description: desc
  }));
  
  return {
    content: [{
      type: "text",
      text: JSON.stringify(docs, null, 2)
    }]
  };
}

export async function handleImportKycDocument({ customer_id, doc_type, file_url, source_name }: { 
  customer_id: string; 
  doc_type: DocumentType; 
  file_url: string; 
  source_name?: string;
}) {
  console.error(`Processing ${doc_type} for ${customer_id} from ${file_url}`);

  let extractedPayload: any = null;

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
        const profile = await extractBankStatementProfile(file_url);
        const txs = await extractBankStatementTransactions(file_url);
        
        if (profile.bank_account_profile) {
           extractedPayload = {
               ...profile.bank_account_profile,
               transactions: txs.transactions || []
           };
        } else {
           // Fallback if profile extraction fails but structure exists
           extractedPayload = { bank_account_profile: null, transactions: txs.transactions };
        }
        break;
      default:
        throw new Error(`Unsupported document type: ${doc_type}`);
    }
  } catch (error: any) {
    return {
      content: [{
        type: "text",
        text: `Extraction failed: ${error.message}`
      }],
      isError: true
    };
  }

  // Load existing run or create new
  let run = await loadLatestRun(customer_id);
  
  if (!run) {
    run = {
      runId: crypto.randomUUID(),
      customerId: customer_id,
      createdAt: new Date().toISOString(),
      documents: []
    };
  }

  // Create document entry
  const newDoc: KycDocument = {
    id: crypto.randomUUID(),
    customerId: customer_id,
    type: doc_type as DocumentType,
    fileUrl: file_url,
    extractedAt: new Date().toISOString(),
    extractedPayload,
    sourceName: source_name || path.basename(file_url)
  };

  // Append and save
  run.documents.push(newDoc);
  
  await saveRun(run);

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        customer_id,
        run_id: run.runId,
        doc_id: newDoc.id,
        doc_type,
        status: "imported"
      }, null, 2)
    }]
  };
}

export async function handleBuildKycProfile({ customer_id }: { customer_id: string }) {
  const run = await loadLatestRun(customer_id);
  
  if (!run) {
    return {
      content: [{ type: "text", text: `No run found for customer ${customer_id}` }],
      isError: true
    };
  }

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
        bankAccounts.push(payload);
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

  run.profile = profile;
  await saveRun(run);

  return {
    content: [{
      type: "text",
      text: JSON.stringify(profile, null, 2)
    }]
  };
}

export async function handleValidateKycProfile({ customer_id }: { customer_id: string }) {
  const run = await loadLatestRun(customer_id);
  
  if (!run) {
     return {
      content: [{ type: "text", text: `No run found for customer ${customer_id}` }],
      isError: true
    };
  }

  if (!run.profile) {
     // Auto-build if missing
      await handleBuildKycProfile({ customer_id });
      // Reload to get the profile
      const reloadedRun = await loadLatestRun(customer_id);
      if (reloadedRun && reloadedRun.profile) {
          run.profile = reloadedRun.profile;
      } else {
          return {
            content: [{ type: "text", text: `Failed to build profile for customer ${customer_id}` }],
            isError: true
          };
      }
  }

  const validation = validateKycProfile(run.profile!);
  run.validation = validation;
  
  await saveRun(run);

  return {
    content: [{
      type: "text",
      text: JSON.stringify(validation, null, 2)
    }]
  };
}

export async function handleGetKycReport({ customer_id }: { customer_id: string }) {
  const run = await loadLatestRun(customer_id);
  
  if (!run) {
     return {
      content: [{ type: "text", text: JSON.stringify({ ok: false, error_code: "NO_RUN_FOR_CUSTOMER" }) }],
      isError: true
    };
  }

  let profile = run.profile;
  let validation = run.validation;

  if (!profile || !validation) {
      await handleValidateKycProfile({ customer_id }); // This triggers build if needed
      const reloadedRun = await loadLatestRun(customer_id);
      profile = reloadedRun?.profile;
      validation = reloadedRun?.validation;
  }

  if (!profile || !validation) {
      return {
          content: [{ type: "text", text: JSON.stringify({ ok: false, error_code: "FAILED_TO_GENERATE_PROFILE_OR_VALIDATION" }) }],
          isError: true
      };
  }

  const report = buildKycReport(profile, validation);

  return {
    content: [{
      type: "text",
      text: JSON.stringify(report, null, 2)
    }]
  };
}

// --- MCP Server Setup ---

// Create server instance
const server = new McpServer({
  name: "mx-kyc-mcp",
  version: "1.0.0"
});

// Supported doc types map for listing
const SUPPORTED_DOCS: Record<DocumentType, string> = {
  "acta": "Acta Constitutiva (Incorporation Deed) - Extracts Identity, Shareholders, Powers",
  "sat_constancia": "SAT Constancia de Situación Fiscal - Extracts Tax Profile",
  "fm2": "FM2 / Residente Card - Extracts Immigration Profile",
  "telmex": "Telmex Bill - Extracts Proof of Address",
  "cfe": "CFE Electricity Bill - Extracts Proof of Address",
  "bank_statement": "Bank Statement - Extracts Profile & Transactions"
};

// Wire tools to handlers
server.tool(
  "list_supported_doc_types",
  {},
  handleListSupportedDocTypes
);

server.tool(
  "import_kyc_document",
  {
    customer_id: z.string(),
    doc_type: z.enum(["acta", "sat_constancia", "fm2", "telmex", "cfe", "bank_statement"]),
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
    customer_id: z.string()
  },
  handleGetKycReport
);

export async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MX KYC MCP Server running on stdio");
}
