# Repository Information for Indexing

This document provides structured information about the repository to help with indexing and discovery.

## Repository Metadata

- **Name**: kyc-docx-mcp
- **Type**: MCP Server / Document Processing Tool
- **Language**: TypeScript
- **Runtime**: Node.js
- **Primary Use Case**: KYC document extraction and processing

## Description

A Model Context Protocol (MCP) server that extracts structured KYC data from Mexican business documents using OpenAI GPT-5.1. Processes 6 document types (Acta Constitutiva, SAT Constancia, FM2, Telmex, CFE, Bank Statements) and aggregates them into unified customer profiles with validation and reporting.

## Key Technologies

- OpenAI GPT-5.1 (Vision API)
- Model Context Protocol (MCP)
- TypeScript
- Zod (Schema Validation)
- Node.js

## Main Features

1. **Document Extraction**: Extract structured data from 6 types of Mexican business documents
2. **Profile Building**: Aggregate multiple documents into unified KYC profiles
3. **Address Resolution**: Intelligent address precedence (fiscal vs operational vs historical)
4. **Validation**: Comprehensive validation with scoring and flagging
5. **Reporting**: Generate comprehensive KYC reports

## Entry Points

- **CLI**: `src/mcp/cli.ts` - MCP server executable
- **Main**: `src/index.ts` - Model check utility
- **Server**: `src/mcp/server.ts` - MCP server implementation

## API Surface

5 MCP tools exposed:
1. `list_supported_doc_types` - List document types
2. `import_kyc_document` - Import and extract documents
3. `build_kyc_profile` - Build unified profile
4. `validate_kyc_profile` - Validate profile
5. `get_kyc_report` - Generate report

## Document Types Supported

- `acta` - Acta Constitutiva (Company incorporation)
- `sat_constancia` - SAT Tax Certificate
- `fm2` - Immigration Document
- `telmex` - Telmex Utility Bill
- `cfe` - CFE Electricity Bill
- `bank_statement` - Bank Statement

## Data Flow

1. Document Import → Extraction → Storage
2. Profile Building → Aggregation → Address Resolution
3. Validation → Scoring → Flagging
4. Reporting → Summary → Recommendations

## File Structure

```
src/
├── extractors/     # Document extraction logic
├── kyc/           # Core KYC processing
├── mcp/           # MCP server
├── schemas/       # Validation schemas
└── tests/         # Test suites
```

## Documentation Files

- `README.md` - Main documentation
- `ARCHITECTURE.md` - System architecture
- `API.md` - API reference
- `CODEBASE_INDEX.md` - File index
- `.github/README.md` - GitHub-specific info

## Keywords

kyc, know-your-customer, document-extraction, mcp, model-context-protocol, openai, gpt-5.1, typescript, mexican-documents, compliance, financial-services, document-processing, ai-extraction, structured-data, validation, profile-building

## Use Cases

- Financial institutions processing KYC documents
- Compliance teams validating customer information
- Businesses automating document processing
- AI agents needing document extraction capabilities

## Integration

- Integrates with ChatGPT and other MCP-compatible agents
- Can be used as standalone MCP server
- Exposes standardized MCP protocol interface

