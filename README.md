# KYC Document Extractor (MCP Server)

A production-ready Node.js + TypeScript MCP (Model Context Protocol) server for extracting structured KYC (Know Your Customer) data from Mexican business documents using OpenAI GPT-5.1.

## Overview

This project provides an MCP server that extracts structured data from various Mexican KYC documents, aggregates them into unified customer profiles, validates the data, and generates comprehensive KYC reports. It's designed for financial institutions, compliance teams, and businesses requiring automated KYC document processing.

## Features

- **Multi-Document Support**: Extract data from 6 types of Mexican business documents
- **Intelligent Aggregation**: Build unified KYC profiles from multiple document sources
- **Address Resolution**: Smart address precedence logic (fiscal vs operational vs historical)
- **Validation Engine**: Comprehensive validation with scoring and flagging
- **MCP Protocol**: Standardized Model Context Protocol server for easy integration
- **Type-Safe**: Full TypeScript with Zod schema validation

## Supported Document Types

1. **Acta Constitutiva** (`acta`) - Company incorporation deed
   - Extracts: Company identity, shareholders, legal representatives, corporate purpose, notary info

2. **SAT Constancia** (`sat_constancia`) - Tax status certificate
   - Extracts: Tax profile, fiscal address, economic activities, tax obligations

3. **FM2/Residente Card** (`fm2`) - Immigration document
   - Extracts: Representative identity, nationality, document numbers, dates

4. **Telmex Bill** (`telmex`) - Proof of address (telephone)
   - Extracts: Client/vendor addresses, billing information, service details

5. **CFE Bill** (`cfe`) - Proof of address (electricity)
   - Extracts: Client/vendor addresses, billing information, service details

6. **Bank Statement** (`bank_statement`) - Bank account statement
   - Extracts: Account profile, transactions, address on statement

## Architecture

```
┌─────────────────┐
│   MCP Client    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  MCP Server     │  ← src/mcp/server.ts
└────────┬────────┘
         │
    ┌────┴────┬──────────┬──────────┬──────────┐
    ▼        ▼          ▼          ▼          ▼
┌────────┐ ┌──────┐ ┌────────┐ ┌────────┐ ┌────────┐
│Extract │ │Build │ │Validate│ │Report  │ │Storage │
│        │ │Profile│ │        │ │        │ │        │
└────────┘ └──────┘ └────────┘ └────────┘ └────────┘
    │
    ▼
┌─────────────────┐
│  Document       │
│  Extractors     │  ← src/extractors/
└─────────────────┘
```

### Key Components

- **MCP Server** (`src/mcp/`): Protocol server exposing tools for document import, profile building, validation, and reporting
- **Extractors** (`src/extractors/`): Document-specific extraction logic using GPT-5.1 vision API
- **KYC Core** (`src/kyc/`): Profile building, validation, and report generation
- **Schemas** (`src/schemas/mx/`): Zod schemas for Mexican document structures
- **Storage** (`src/kyc/storage.ts`): JSON-based run storage system

## Quick Start

### Prerequisites

- Node.js 20+
- OpenAI API key with GPT-5.1 access
- TypeScript 5.5+

### Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd kyc-docx-mcp

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY
```

### Configuration

Create a `.env` file:

```env
OPENAI_API_KEY=your_openai_api_key_here
```

### Development

```bash
# Run in development mode (watch mode)
npm run dev

# Build TypeScript
npm run build

# Run production build
npm run start

# Run MCP server
npm run build && ./dist/mcp/cli.js
```

## MCP Tools API

The server exposes 5 MCP tools:

> **Response format:** Each tool returns `{ "ok": true, "data": { ... } }` on success and `{ "ok": false, "error_code": "...", "message": "..." }` on failure. Parse the JSON and inspect the `ok` flag before using `data`.

### 1. `list_supported_doc_types`

Lists all supported document types and their descriptions.

**Response:**
```json
[
  {
    "type": "acta",
    "description": "Acta Constitutiva (Incorporation Deed) - Extracts Identity, Shareholders, Powers"
  },
  ...
]
```

### 2. `import_kyc_document`

Imports and extracts data from a KYC document.

**Parameters:**
- `customer_id` (string): Unique customer identifier
- `doc_type` (enum): Document type (`acta`, `sat_constancia`, `fm2`, `telmex`, `cfe`, `bank_statement`)
- `file_url` (string): URL or path to the document file
- `source_name` (string, optional): Human-readable source name

**Response:**
```json
{
  "customer_id": "pfds",
  "run_id": "uuid",
  "doc_id": "uuid",
  "doc_type": "sat_constancia",
  "status": "imported"
}
```

### 3. `build_kyc_profile`

Aggregates all imported documents into a unified KYC profile.

**Parameters:**
- `customer_id` (string): Customer identifier

**Response:** Complete `KycProfile` object with all aggregated data

### 4. `validate_kyc_profile`

Validates a KYC profile and generates validation results.

**Parameters:**
- `customer_id` (string): Customer identifier

**Response:** `KycValidationResult` with score (0-1) and flags

### 5. `get_kyc_report`

Generates a comprehensive KYC report combining profile and validation.

**Parameters:**
- `customer_id` (string): Customer identifier

**Response:** Complete KYC report JSON

## Usage Examples

### Basic Workflow

```typescript
// 1. Import documents
await import_kyc_document({
  customer_id: "customer-123",
  doc_type: "sat_constancia",
  file_url: "https://example.com/constancia.pdf"
});

await import_kyc_document({
  customer_id: "customer-123",
  doc_type: "acta",
  file_url: "https://example.com/acta.pdf"
});

// 2. Build profile
await build_kyc_profile({ customer_id: "customer-123" });

// 3. Validate
await validate_kyc_profile({ customer_id: "customer-123" });

// 4. Get report
await get_kyc_report({ customer_id: "customer-123" });
```

## Testing

Run individual test suites:

```bash
# Test SAT Constancia extraction
npm run test:constancia

# Test CFE proof of address
npm run test:cfe

# Test bank statements
npm run test:bank

# Test Acta extraction
npm run test:acta

# Test KYC profile builder
npm run test:kyc-builder

# Test end-to-end PFDS workflow
npm run test:kyc-pfds

# Test KYC report generation
npm run test:kyc-report-pfds
```

> **Fixture Paths**  
> Integration tests expect real PDF fixtures. Set `KYC_FIXTURES_DIR` to the directory containing your documents (e.g. `export KYC_FIXTURES_DIR=/path/to/pfds/docs`). If the variable is unset the tests look for a local `fixtures/` directory and will fail with a descriptive error if the files are missing.

## Data Flow

1. **Document Import**: Document URL → Extractor → Structured JSON payload
2. **Storage**: Extracted payload stored in `KycRun` with document metadata
3. **Profile Building**: All documents aggregated → Unified `KycProfile`
4. **Validation**: Profile analyzed → Validation flags and score
5. **Reporting**: Profile + Validation → Comprehensive report

## Address Resolution Logic

The system implements intelligent address resolution:

- **Fiscal Address**: Always from SAT Constancia (canonical)
- **Operational Address**: Bank Statement > Proof of Address (CFE/Telmex) > SAT (fallback)
- **Historical Addresses**: All addresses preserved with source tracking
- **Founding Address**: From Acta (historical only, never overrides current)

## Model Constraints

**IMPORTANT**: This project ONLY supports:
- `gpt-5.1`
- `gpt-5.1-mini`

These constraints are enforced in code, types, and comments. Any other model will throw an error.

## API Usage

This project uses OpenAI's new `responses.create` API (NOT chat completions). See `src/model.ts` for model configuration.

## Project Structure

```
src/
├── extractors/          # Document-specific extractors
│   ├── actaCompanyIdentity.ts
│   ├── companyTaxProfileExtractor.ts
│   ├── fm2Immigration.ts
│   ├── telmexProofOfAddress.ts
│   ├── cfeProofOfAddress.ts
│   ├── bankStatementProfile.ts
│   └── bankStatementTransactions.ts
├── kyc/                 # Core KYC logic
│   ├── types.ts         # Domain types
│   ├── profileBuilder.ts
│   ├── validation.ts
│   ├── validators.ts
│   ├── reportBuilder.ts
│   └── storage.ts
├── mcp/                 # MCP server
│   ├── server.ts        # Main server with tool handlers
│   └── cli.ts          # CLI entry point
├── schemas/             # Zod schemas
│   └── mx/              # Mexican document schemas
└── tests/               # Test suites
```

## Storage

Runs are stored as JSON files in `data/{customer_id}/run-{uuid}.json`. Each run contains:
- Customer ID
- Documents array with extracted payloads
- Generated profile (if built)
- Validation results (if validated)

## Contributing

1. Follow TypeScript best practices
2. Maintain Zod schema validation for all extracted data
3. Add tests for new extractors
4. Update documentation for API changes

## License

ISC

## Support

For issues or questions, please open an issue on GitHub.
