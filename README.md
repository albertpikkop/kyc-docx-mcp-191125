# MexKYC - AI-Powered KYC for Mexico

<div align="center">

![MexKYC Logo](https://mexkyc.com/logo.png)

**Know Your Customer. Know Mexico.**

[![npm version](https://badge.fury.io/js/@mexkyc%2Fmcp.svg)](https://www.npmjs.com/package/@mexkyc/mcp)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

[Website](https://mexkyc.com) • [Documentation](https://docs.mexkyc.com) • [API Reference](https://api.mexkyc.com/docs)

</div>

---

## 🇲🇽 What is MexKYC?

**MexKYC** is a production-ready AI-powered KYC (Know Your Customer) document extraction platform designed specifically for Mexican business documents. Built as an MCP (Model Context Protocol) server, it seamlessly integrates with AI assistants and automated workflows.

Extract structured data from Mexican regulatory documents, build unified customer profiles, validate compliance requirements, and generate comprehensive KYC reports—all with AI precision.

## ✨ Features

- 🔍 **Multi-Document Support** - Extract data from 7+ types of Mexican business documents
- 🤖 **AI-Powered Extraction** - Uses advanced vision models for accurate OCR and data extraction
- 📊 **Intelligent Aggregation** - Build unified KYC profiles from multiple document sources
- 🏠 **Smart Address Resolution** - Intelligent address precedence logic (fiscal vs operational vs historical)
- ✅ **Validation Engine** - Comprehensive validation with scoring and risk flagging
- 🔌 **MCP Protocol** - Standardized Model Context Protocol for easy AI integration
- 📝 **Type-Safe** - Full TypeScript with Zod schema validation
- 🔐 **Enterprise Ready** - Multi-tenant, audit logging, and compliance features

## 📄 Supported Document Types

| Document | Type Code | What It Extracts |
|----------|-----------|------------------|
| **Acta Constitutiva** | `acta` | Company identity, shareholders, legal representatives, corporate purpose, notary info |
| **SAT Constancia** | `sat_constancia` | Tax profile, RFC, fiscal address, economic activities, tax obligations |
| **FM2/Residente Card** | `fm2` | Representative identity, nationality, immigration status, document validity |
| **INE (Voter ID)** | `ine` | Personal identity, CURP, address, photo verification |
| **Telmex Bill** | `telmex` | Proof of address, billing information, service details |
| **CFE Bill** | `cfe` | Proof of address, electricity account, consumption data |
| **Bank Statement** | `bank_statement` | Account profile, transactions, balances, bank address |

## 🏗️ Architecture

```
┌─────────────────────┐
│   AI Assistant      │  (ChatGPT, Claude, Custom)
│   or MCP Client     │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   MexKYC MCP        │  ← @mexkyc/mcp
│   Server            │
└──────────┬──────────┘
           │
    ┌──────┴──────┬──────────┬──────────┬──────────┐
    ▼             ▼          ▼          ▼          ▼
┌────────┐  ┌──────────┐ ┌────────┐ ┌────────┐ ┌────────┐
│Extract │  │Build     │ │Validate│ │Report  │ │Storage │
│Docs    │  │Profile   │ │        │ │        │ │        │
└────────┘  └──────────┘ └────────┘ └────────┘ └────────┘
    │
    ▼
┌─────────────────────┐
│  Document           │
│  Extractors         │  ← AI Vision Models
└─────────────────────┘
```

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- TypeScript 5.5+
- API key (OpenAI or Google Gemini)

### Installation

```bash
# Install from npm
npm install @mexkyc/mcp

# Or clone the repository
git clone https://github.com/mexkyc/mexkyc-mcp.git
cd mexkyc-mcp
npm install
```

### Configuration

Create a `.env` file:

```env
# AI Model (choose one)
OPENAI_API_KEY=your_openai_api_key
# OR
GOOGLE_API_KEY=your_gemini_api_key

# Optional: Server configuration
PORT=3000
MCP_TRANSPORT=sse  # 'sse' for HTTP, omit for stdio
```

### Run the Server

```bash
# Development mode
npm run dev

# Production build
npm run build
npm run start

# Run MCP server directly
npx mexkyc
```

## 📡 MCP Tools API

MexKYC exposes 5 MCP tools for document processing:

### 1. `list_supported_doc_types`

Lists all supported Mexican document types.

```typescript
// No parameters required
const result = await mcpClient.callTool("list_supported_doc_types", {});
```

### 2. `import_kyc_document`

Imports and extracts data from a KYC document.

```typescript
await mcpClient.callTool("import_kyc_document", {
  customer_id: "empresa-xyz",
  doc_type: "sat_constancia",
  file_url: "https://storage.example.com/constancia.pdf",
  source_name: "SAT_2024.pdf"  // optional
});
```

### 3. `build_kyc_profile`

Aggregates all imported documents into a unified KYC profile.

```typescript
await mcpClient.callTool("build_kyc_profile", {
  customer_id: "empresa-xyz"
});
```

### 4. `validate_kyc_profile`

Validates a KYC profile and generates compliance scores.

```typescript
await mcpClient.callTool("validate_kyc_profile", {
  customer_id: "empresa-xyz"
});
```

### 5. `get_kyc_report`

Generates a comprehensive KYC report combining profile and validation.

```typescript
await mcpClient.callTool("get_kyc_report", {
  customer_id: "empresa-xyz",
  include_trace: true  // optional: include extraction details
});
```

## 💡 Usage Example

```typescript
// Complete KYC workflow
const customerId = "mi-empresa-sa";

// 1. Import SAT Constancia (tax certificate)
await import_kyc_document({
  customer_id: customerId,
  doc_type: "sat_constancia",
  file_url: "https://example.com/constancia.pdf"
});

// 2. Import Acta Constitutiva (incorporation deed)
await import_kyc_document({
  customer_id: customerId,
  doc_type: "acta",
  file_url: "https://example.com/acta.pdf"
});

// 3. Import proof of address
await import_kyc_document({
  customer_id: customerId,
  doc_type: "cfe",
  file_url: "https://example.com/cfe_bill.pdf"
});

// 4. Build unified profile
await build_kyc_profile({ customer_id: customerId });

// 5. Validate for compliance
await validate_kyc_profile({ customer_id: customerId });

// 6. Generate KYC report
const report = await get_kyc_report({ customer_id: customerId });
```

## 🏠 Address Resolution Logic

MexKYC implements intelligent address resolution:

| Address Type | Source Priority |
|--------------|-----------------|
| **Fiscal Address** | SAT Constancia (canonical) |
| **Operational Address** | Bank Statement > CFE/Telmex > SAT (fallback) |
| **Historical Addresses** | All addresses preserved with source tracking |
| **Founding Address** | Acta Constitutiva (historical reference only) |

## 🔒 Security & Compliance

- **Multi-tenant isolation** - Organization-level data separation
- **Audit logging** - Complete audit trail for compliance
- **API key authentication** - Secure API access
- **Rate limiting** - Protection against abuse
- **HTTPS required** - Encrypted data transmission

## 📁 Project Structure

```
src/
├── extractors/          # Document-specific AI extractors
│   ├── actaCompanyIdentity.ts
│   ├── companyTaxProfileExtractor.ts
│   ├── ineIdentity.ts
│   ├── fm2Immigration.ts
│   ├── telmexProofOfAddress.ts
│   ├── cfeProofOfAddress.ts
│   └── bankStatementProfile.ts
├── kyc/                 # Core KYC logic
│   ├── types.ts         # Domain types
│   ├── profileBuilder.ts
│   ├── validation.ts
│   └── reportBuilder.ts
├── mcp/                 # MCP server implementation
│   ├── server.ts        # Main server with tool handlers
│   └── cli.ts           # CLI entry point
├── schemas/             # Zod schemas
│   └── mx/              # Mexican document schemas
└── utils/               # Utilities
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Test specific extractors
npm run test:constancia   # SAT Constancia
npm run test:acta         # Acta Constitutiva
npm run test:cfe          # CFE bills
npm run test:bank         # Bank statements

# End-to-end KYC tests
npm run test:kyc-pfds
npm run test:kyc-report-pfds
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

ISC License - see [LICENSE](LICENSE) for details.

## 🔗 Links

- **Website**: [https://mexkyc.com](https://mexkyc.com)
- **Documentation**: [https://docs.mexkyc.com](https://docs.mexkyc.com)
- **API Reference**: [https://api.mexkyc.com/docs](https://api.mexkyc.com/docs)
- **GitHub**: [https://github.com/mexkyc/mexkyc-mcp](https://github.com/mexkyc/mexkyc-mcp)
- **npm**: [https://www.npmjs.com/package/@mexkyc/mcp](https://www.npmjs.com/package/@mexkyc/mcp)

## 💬 Support

- **Issues**: [GitHub Issues](https://github.com/mexkyc/mexkyc-mcp/issues)
- **Email**: support@mexkyc.com
- **Twitter**: [@mexkyc](https://twitter.com/mexkyc)

---

<div align="center">

**Built with ❤️ for Mexico's fintech ecosystem**

*MexKYC - Know Your Customer. Know Mexico.*

</div>
