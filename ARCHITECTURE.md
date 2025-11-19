# Architecture Documentation

## System Overview

The KYC Document Extractor is a Model Context Protocol (MCP) server that processes Mexican business documents to extract structured KYC data. It uses OpenAI GPT-5.1's vision capabilities to extract information from PDF documents and aggregates them into unified customer profiles.

## Core Architecture

### Component Layers

```
┌─────────────────────────────────────────────────────────┐
│                    MCP Protocol Layer                    │
│  (Standardized interface for AI agents/clients)         │
└───────────────────────┬─────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────┐
│                  Application Layer                       │
│  - Tool Handlers (import, build, validate, report)      │
│  - Workflow Orchestration                               │
└───────────────────────┬─────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        │               │               │
┌───────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
│  Extraction  │ │   Profile   │ │ Validation  │
│    Layer     │ │   Builder    │ │   Engine    │
└───────┬──────┘ └──────┬───────┘ └──────┬──────┘
        │               │               │
        └───────────────┼───────────────┘
                        │
┌───────────────────────▼─────────────────────────────────┐
│                   Data Layer                            │
│  - Document Extractors (GPT-5.1 Vision)               │
│  - Schema Validation (Zod)                             │
│  - Storage (JSON files)                                │
└─────────────────────────────────────────────────────────┘
```

## Key Components

### 1. MCP Server (`src/mcp/server.ts`)

The MCP server exposes 5 tools:

- **`list_supported_doc_types`**: Returns metadata about supported document types
- **`import_kyc_document`**: Imports and extracts data from a document
- **`build_kyc_profile`**: Aggregates documents into a unified profile
- **`validate_kyc_profile`**: Validates profile data and generates flags
- **`get_kyc_report`**: Generates comprehensive KYC report

**Key Design Decisions:**
- Uses Zod for runtime parameter validation
- Returns structured JSON responses
- Handles errors gracefully with error flags
- Auto-builds profiles if missing during validation

### 2. Document Extractors (`src/extractors/`)

Each extractor follows a consistent pattern:

```typescript
async function extractDocumentType(fileUrl: string): Promise<ExtractedType> {
  1. Load document (PDF/image)
  2. Call GPT-5.1 Vision API with structured output
  3. Validate against Zod schema
  4. Return typed extracted data
}
```

**Extractors:**
- `actaCompanyIdentity.ts`: Company incorporation documents
- `companyTaxProfileExtractor.ts`: SAT tax certificates
- `fm2Immigration.ts`: Immigration documents
- `telmexProofOfAddress.ts`: Telmex utility bills
- `cfeProofOfAddress.ts`: CFE electricity bills
- `bankStatementProfile.ts`: Bank account information
- `bankStatementTransactions.ts`: Transaction extraction

**Common Pattern:**
- Uses `visionExtractor.ts` utility for GPT-5.1 vision calls
- Validates with Zod schemas from `src/schemas/mx/`
- Handles errors and returns null/partial data gracefully

### 3. Profile Builder (`src/kyc/profileBuilder.ts`)

Aggregates data from multiple documents into a unified `KycProfile`.

**Address Resolution Logic:**
```
Fiscal Address: SAT Constancia (canonical, always authoritative)
Operational Address: Bank Statement > CFE/Telmex > SAT (fallback)
Historical Addresses: All addresses preserved with source tracking
Founding Address: Acta (historical only, never overrides current)
```

**Key Features:**
- Preserves all historical addresses
- Implements precedence rules for current addresses
- Tracks address sources for auditability
- Handles missing data gracefully

### 4. Validation Engine (`src/kyc/validation.ts`, `validators.ts`)

Validates KYC profiles and generates:
- **Score**: 0-1 validation score
- **Flags**: Array of validation issues (info/warning/critical)

**Validation Rules:**
- Address consistency checks
- Representative identity matching
- Document coverage assessment
- Data completeness validation

### 5. Report Builder (`src/kyc/reportBuilder.ts`)

Combines profile and validation into a comprehensive report.

**Report Structure:**
- Customer summary
- Company information
- Addresses (current + historical)
- Documents summary
- Validation results
- Recommendations

### 6. Storage (`src/kyc/storage.ts`)

JSON-based file storage system.

**Storage Structure:**
```
data/
  {customer_id}/
    run-{uuid}.json  # Latest run for customer
```

**Run Structure:**
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

**Design Decisions:**
- One run per customer (latest overwrites)
- Documents accumulate in run
- Profile/validation computed on-demand
- Simple file-based storage (can be replaced with DB)

## Data Flow

### Document Import Flow

```
1. MCP Tool Call: import_kyc_document
   ↓
2. Route to appropriate extractor based on doc_type
   ↓
3. Extractor loads document from file_url
   ↓
4. GPT-5.1 Vision API call with structured output schema
   ↓
5. Zod schema validation
   ↓
6. Create KycDocument with extracted payload
   ↓
7. Load or create KycRun for customer_id
   ↓
8. Append document to run.documents
   ↓
9. Save run to storage
   ↓
10. Return success response
```

### Profile Building Flow

```
1. MCP Tool Call: build_kyc_profile
   ↓
2. Load latest run for customer_id
   ↓
3. Iterate through run.documents
   ↓
4. Group by document type
   ↓
5. Initialize KycProfileBuilder
   ↓
6. Add each document type to builder
   ↓
7. Resolve addresses using precedence rules
   ↓
8. Build final KycProfile
   ↓
9. Save profile to run
   ↓
10. Return profile JSON
```

### Validation Flow

```
1. MCP Tool Call: validate_kyc_profile
   ↓
2. Load run (auto-build profile if missing)
   ↓
3. Run validation rules:
   - Address consistency checks
   - Representative identity matching
   - Document coverage assessment
   ↓
4. Generate validation flags
   ↓
5. Calculate score (0-1)
   ↓
6. Save validation to run
   ↓
7. Return validation result
```

## Type System

### Core Types (`src/kyc/types.ts`)

- **`KycDocument`**: Document metadata + extracted payload
- **`KycRun`**: Container for all documents + profile + validation
- **`KycProfile`**: Unified customer profile
- **`KycValidationResult`**: Validation score + flags

### Domain Types

- **`CompanyIdentity`**: From Acta Constitutiva
- **`CompanyTaxProfile`**: From SAT Constancia
- **`ImmigrationProfile`**: From FM2
- **`ProofOfAddress`**: From CFE/Telmex
- **`BankAccountProfile`**: From bank statements
- **`Address`**: Standardized address structure
- **`HistoricalAddress`**: Address with source tracking

## Error Handling

### Extraction Errors
- Extracted as error responses with `isError: true`
- Original error message preserved
- Run still created (with failed document)

### Validation Errors
- Returned as validation flags
- Critical flags prevent report generation
- Warnings allow report with caveats

### Storage Errors
- File system errors propagated
- Missing runs return error responses
- Invalid data handled at schema level

## Extensibility

### Adding New Document Types

1. Create extractor in `src/extractors/`
2. Define Zod schema in `src/schemas/mx/`
3. Add to `DocumentType` union in `src/kyc/types.ts`
4. Add case to `handleImportKycDocument` switch
5. Update `SUPPORTED_DOCS` map
6. Add to profile builder if needed

### Adding Validation Rules

1. Add validator function in `src/kyc/validators.ts`
2. Register in `validateKycProfile` function
3. Return `KycValidationFlag` objects

## Performance Considerations

- **Extraction**: GPT-5.1 API calls are async and can be parallelized
- **Storage**: File-based storage is simple but not scalable (consider DB for production)
- **Profile Building**: O(n) where n = number of documents
- **Validation**: O(1) per validation rule

## Security Considerations

- API keys stored in environment variables
- File URLs validated (consider adding URL validation)
- No authentication on MCP server (add if exposing publicly)
- Sensitive data in JSON files (consider encryption)

## Future Improvements

1. **Database Storage**: Replace file storage with PostgreSQL/MongoDB
2. **Caching**: Cache extracted documents to avoid re-extraction
3. **Batch Processing**: Support bulk document import
4. **Webhooks**: Notify on profile/validation updates
5. **API Authentication**: Add auth for MCP server
6. **Rate Limiting**: Protect against abuse
7. **Document Versioning**: Track document updates over time
8. **Multi-language**: Support English documents

