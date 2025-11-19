# GitHub Repository Information

## Repository Purpose

This repository contains a production-ready **KYC (Know Your Customer) Document Extractor** built as an MCP (Model Context Protocol) server. It extracts structured data from Mexican business documents using OpenAI GPT-5.1 and aggregates them into unified customer profiles.

## Key Features

- **6 Document Types Supported**: Acta Constitutiva, SAT Constancia, FM2, Telmex, CFE, Bank Statements
- **Intelligent Address Resolution**: Fiscal vs operational vs historical address tracking
- **Validation Engine**: Comprehensive validation with scoring and flagging
- **MCP Protocol**: Standardized interface for AI agents
- **Type-Safe**: Full TypeScript with Zod validation

## Quick Links

- **Main README**: [README.md](../README.md) - Setup and usage instructions
- **Architecture**: [ARCHITECTURE.md](../ARCHITECTURE.md) - System design and components
- **API Reference**: [API.md](../API.md) - Complete MCP tools documentation

## Repository Structure

```
├── src/
│   ├── extractors/      # Document extraction logic
│   ├── kyc/            # Core KYC processing
│   ├── mcp/            # MCP server implementation
│   ├── schemas/        # Zod validation schemas
│   └── tests/          # Test suites
├── data/               # JSON storage (customer runs)
├── dist/               # Compiled JavaScript
└── docs/               # Documentation files
```

## Getting Started

1. **Install dependencies**: `npm install`
2. **Set up environment**: Create `.env` with `OPENAI_API_KEY`
3. **Run tests**: `npm run test:*`
4. **Build**: `npm run build`
5. **Start server**: `npm run start`

## Technology Stack

- **Runtime**: Node.js 20+
- **Language**: TypeScript 5.5+
- **AI Model**: OpenAI GPT-5.1 (vision)
- **Protocol**: Model Context Protocol (MCP)
- **Validation**: Zod
- **Storage**: JSON files

## Document Types

| Type | Description | Extracted Data |
|------|-------------|----------------|
| `acta` | Acta Constitutiva | Company identity, shareholders, legal structure |
| `sat_constancia` | SAT Tax Certificate | Tax profile, fiscal address, economic activities |
| `fm2` | Immigration Document | Representative identity, nationality, dates |
| `telmex` | Telmex Bill | Proof of address, billing info |
| `cfe` | CFE Electricity Bill | Proof of address, billing info |
| `bank_statement` | Bank Statement | Account profile, transactions, address |

## MCP Tools

1. `list_supported_doc_types` - List available document types
2. `import_kyc_document` - Import and extract document data
3. `build_kyc_profile` - Aggregate documents into unified profile
4. `validate_kyc_profile` - Validate profile and generate flags
5. `get_kyc_report` - Generate comprehensive KYC report

See [API.md](../API.md) for complete documentation.

## Testing

Run individual test suites:
- `npm run test:constancia` - SAT Constancia extraction
- `npm run test:cfe` - CFE proof of address
- `npm run test:bank` - Bank statements
- `npm run test:acta` - Acta extraction
- `npm run test:kyc-builder` - Profile builder
- `npm run test:kyc-pfds` - End-to-end workflow

## Contributing

1. Follow TypeScript best practices
2. Maintain Zod schema validation
3. Add tests for new extractors
4. Update documentation

## License

ISC

