# Codebase Index

This document provides a comprehensive index of all files and modules in the repository, organized by purpose and functionality.

## Entry Points

### Main Entry Points
- **`src/index.ts`** - Model check utility (diagnostic tool)
- **`src/mcp/cli.ts`** - MCP server CLI entry point (executable)
- **`src/mcp/server.ts`** - MCP server implementation with tool handlers

## Core Modules

### MCP Server (`src/mcp/`)
- **`server.ts`** - Main MCP server with 5 tool handlers:
  - `list_supported_doc_types`
  - `import_kyc_document`
  - `build_kyc_profile`
  - `validate_kyc_profile`
  - `get_kyc_report`
- **`cli.ts`** - CLI entry point for running MCP server

### KYC Core (`src/kyc/`)
- **`types.ts`** - Core domain types:
  - `KycDocument`, `KycRun`, `KycProfile`, `KycValidationResult`
  - Domain types: `CompanyIdentity`, `CompanyTaxProfile`, `ImmigrationProfile`, etc.
- **`profileBuilder.ts`** - Profile aggregation logic:
  - `KycProfileBuilder` class
  - `buildKycProfile()` function
  - Address resolution logic
- **`validation.ts`** - Validation orchestration:
  - `validateKycProfile()` function
- **`validators.ts`** - Individual validation rules:
  - Address consistency checks
  - Representative identity matching
  - Document coverage assessment
- **`reportBuilder.ts`** - Report generation:
  - `buildKycReport()` function
- **`storage.ts`** - File-based storage:
  - `saveRun()` - Save customer run
  - `loadLatestRun()` - Load latest run for customer

### Document Extractors (`src/extractors/`)
- **`actaCompanyIdentity.ts`** - Extract company identity from Acta Constitutiva
- **`companyTaxProfileExtractor.ts`** - Extract tax profile from SAT Constancia
- **`fm2Immigration.ts`** - Extract immigration profile from FM2/Residente card
- **`telmexProofOfAddress.ts`** - Extract proof of address from Telmex bills
- **`cfeProofOfAddress.ts`** - Extract proof of address from CFE bills
- **`bankStatementProfile.ts`** - Extract bank account profile from statements
- **`bankStatementTransactions.ts`** - Extract transactions from bank statements
- **`visionExtractor.ts`** - Utility for GPT-5.1 vision API calls

### Schemas (`src/schemas/mx/`)
- **`address.ts`** - Address schema (Zod)
- **`companyIdentity.ts`** - Company identity schema
- **`companyTaxProfile.ts`** - Tax profile schema
- **`immigrationProfile.ts`** - Immigration profile schema
- **`proofOfAddress.ts`** - Proof of address schema
- **`bankAccountProfile.ts`** - Bank account schema
- **`bankTransaction.ts`** - Bank transaction schema

### Utilities (`src/utils/`)
- **`sanitize.ts`** - Data sanitization utilities

### Configuration
- **`src/model.ts`** - Model configuration:
  - `MODEL` constant (`gpt-5.1`)
  - `MODEL_MINI` constant (`gpt-5.1-mini`)
  - `validateModel()` function

## Test Files (`src/tests/`)

### Document Extraction Tests
- **`testConstancia.ts`** - Test SAT Constancia extraction
- **`testConstanciaPFDS.ts`** - Test SAT Constancia with PFDS data
- **`testCfeProofOfAddress.ts`** - Test CFE extraction
- **`testFm2Immigration.ts`** - Test FM2 extraction
- **`testActaCompanyIdentity.ts`** - Test Acta extraction
- **`testBankStatements.ts`** - Test bank statement extraction

### KYC Workflow Tests
- **`testKycProfileBuilder.ts`** - Test profile building logic
- **`testKycEndToEndPFDS.ts`** - End-to-end workflow test
- **`testKycReportPFDS.ts`** - Test report generation

## Configuration Files

### Root Level
- **`package.json`** - NPM package configuration
  - Scripts: `dev`, `build`, `start`, `test:*`
  - Dependencies: `@modelcontextprotocol/sdk`, `openai`, `zod`, etc.
- **`tsconfig.json`** - TypeScript configuration
- **`README.md`** - Main documentation
- **`.env`** - Environment variables (not in repo)

### Documentation
- **`README.md`** - Main README with setup and usage
- **`ARCHITECTURE.md`** - Architecture documentation
- **`API.md`** - MCP tools API reference
- **`CODEBASE_INDEX.md`** - This file

## Data Storage

### Storage Location
- **`data/{customer_id}/run-{uuid}.json`** - Customer run files

### Storage Structure
```typescript
{
  runId: string;
  customerId: string;
  createdAt: string;
  documents: KycDocument[];
  profile?: KycProfile;
  validation?: KycValidationResult;
}
```

## Build Output

### Compiled Files (`dist/`)
- Compiled JavaScript files (`.js`)
- Type definitions (`.d.ts`)
- Source maps (`.js.map`, `.d.ts.map`)

## File Dependencies

### Import Flow
```
cli.ts → server.ts
  ↓
server.ts → extractors/*, kyc/*, types
  ↓
extractors/* → visionExtractor.ts, schemas/mx/*
  ↓
kyc/* → types.ts, schemas/mx/*
  ↓
schemas/mx/* → zod
```

## Key Functions by Purpose

### Document Extraction
- `extractCompanyIdentity(fileUrl)` - Acta extraction
- `extractCompanyTaxProfile(fileUrl)` - SAT extraction
- `extractImmigrationProfile(fileUrl)` - FM2 extraction
- `extractTelmexProofOfAddress(fileUrl)` - Telmex extraction
- `extractCfeProofOfAddress(fileUrl)` - CFE extraction
- `extractBankStatementProfile(fileUrl)` - Bank profile extraction
- `extractBankStatementTransactions(fileUrl)` - Bank transactions extraction

### Profile Management
- `buildKycProfile(options)` - Build unified profile
- `KycProfileBuilder` class - Profile builder with address resolution

### Validation
- `validateKycProfile(profile)` - Main validation function
- Individual validators in `validators.ts`

### Reporting
- `buildKycReport(profile, validation)` - Generate report

### Storage
- `saveRun(run)` - Persist run to file
- `loadLatestRun(customerId)` - Load latest run

### MCP Tools
- `handleListSupportedDocTypes()` - List document types
- `handleImportKycDocument(params)` - Import document
- `handleBuildKycProfile(params)` - Build profile
- `handleValidateKycProfile(params)` - Validate profile
- `handleGetKycReport(params)` - Get report

## Type Definitions

### Core Types (`src/kyc/types.ts`)
- `DocumentType` - Union of document type strings
- `KycDocument` - Document metadata + payload
- `KycRun` - Run container
- `KycProfile` - Unified customer profile
- `KycValidationResult` - Validation results
- `KycValidationFlag` - Individual validation flag

### Domain Types
- `CompanyIdentity` - Company incorporation data
- `CompanyTaxProfile` - Tax certificate data
- `ImmigrationProfile` - Immigration document data
- `ProofOfAddress` - Utility bill data
- `BankAccountProfile` - Bank account data
- `Address` - Standardized address
- `HistoricalAddress` - Address with source tracking

## External Dependencies

### Runtime Dependencies
- `@modelcontextprotocol/sdk` - MCP protocol implementation
- `openai` - OpenAI API client
- `zod` - Schema validation
- `date-fns` - Date utilities
- `dotenv` - Environment variable loading

### Development Dependencies
- `typescript` - TypeScript compiler
- `tsx` - TypeScript execution
- `@types/node` - Node.js type definitions

## Scripts Reference

### Development
- `npm run dev` - Run in watch mode
- `npm run build` - Compile TypeScript
- `npm run start` - Run compiled code

### Testing
- `npm run test:constancia` - Test SAT extraction
- `npm run test:cfe` - Test CFE extraction
- `npm run test:bank` - Test bank extraction
- `npm run test:acta` - Test Acta extraction
- `npm run test:kyc-builder` - Test profile builder
- `npm run test:kyc-pfds` - Test end-to-end
- `npm run test:kyc-report-pfds` - Test report generation

### Utilities
- `npm run check:model` - Check GPT-5.1 model availability

## Common Patterns

### Extractor Pattern
```typescript
async function extractDocumentType(fileUrl: string): Promise<Type> {
  1. Load document
  2. Call GPT-5.1 Vision API
  3. Validate with Zod schema
  4. Return typed data
}
```

### MCP Tool Pattern
```typescript
server.tool(
  "tool_name",
  { param1: z.string(), param2: z.number() },
  async (params) => {
    // Implementation
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);
```

### Storage Pattern
```typescript
// Load
const run = await loadLatestRun(customerId);

// Modify
run.documents.push(newDoc);

// Save
await saveRun(run);
```

## Search Keywords

For searching this codebase:
- **MCP**: Model Context Protocol, server, tools
- **KYC**: Profile, validation, report, document
- **Extraction**: Extractor, vision, GPT-5.1
- **Address**: Fiscal, operational, historical, resolution
- **Validation**: Score, flags, validators
- **Storage**: Run, save, load, customer

