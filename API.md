# MexKYC API Reference

This document describes all MCP tools exposed by the MexKYC server.

## Base Information

- **Server Name**: `mexkyc-mcp`
- **Version**: `1.0.0`
- **Protocol**: Model Context Protocol (MCP)
- **Transport**: stdio or SSE (HTTP)
- **Website**: [https://mexkyc.com](https://mexkyc.com)

## Tools

> **Response Envelope**  
> All tools respond with a uniform JSON structure:
> - Success: `{ "ok": true, "data": { ... } }`
> - Error: `{ "ok": false, "error_code": "...", "message": "..." }`

Example client-side pattern:

```typescript
const payload = JSON.parse(result.content[0].text);
if (!payload.ok) {
  throw new Error(payload.message);
}
const data = payload.data;
```

### 1. `list_supported_doc_types`

Lists all supported document types and their descriptions.

#### Parameters

None

#### Response

```json
{
  "ok": true,
  "data": [
    {
      "type": "acta",
      "description": "Acta Constitutiva (Incorporation Deed) - Extracts Identity, Shareholders, Powers"
    },
    {
      "type": "sat_constancia",
      "description": "SAT Constancia de Situación Fiscal - Extracts Tax Profile"
    },
    {
      "type": "fm2",
      "description": "FM2 / Residente Card - Extracts Immigration Profile"
    },
    {
      "type": "telmex",
      "description": "Telmex Bill - Extracts Proof of Address"
    },
    {
      "type": "cfe",
      "description": "CFE Electricity Bill - Extracts Proof of Address"
    },
    {
      "type": "bank_statement",
      "description": "Bank Statement - Extracts Profile & Transactions"
    }
  ]
}
```

#### Example Usage

```typescript
const result = await mcpClient.callTool("list_supported_doc_types", {});
console.log(result.content[0].text); // JSON array of document types
```

---

### 2. `import_kyc_document`

Imports a KYC document, extracts structured data, and stores it in a customer run.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `customer_id` | string | Yes | Unique identifier for the customer (e.g., "pfds", "customer-123") |
| `doc_type` | enum | Yes | Document type: `"acta"`, `"sat_constancia"`, `"fm2"`, `"telmex"`, `"cfe"`, `"bank_statement"` |
| `file_url` | string | Yes | URL or file path to the document (PDF or image) |
| `source_name` | string | No | Human-readable name for the document (e.g., "CFE_AGOSTO.pdf") |

#### Response (Success)

```json
{
  "ok": true,
  "data": {
    "customer_id": "pfds",
    "run_id": "64ebd4d5-b2dc-408f-92ab-38808ec7de01",
    "doc_id": "fea5e097-bf7a-4de9-a928-d6681938feb2",
    "doc_type": "sat_constancia",
    "supplemental_doc_ids": [],
    "status": "imported"
  }
}
```

Additional fields:
- `supplemental_doc_ids`: For documents that spawn extra records (e.g., bank statement transactions), this array lists the newly created document IDs.

#### Response (Error)

```json
{
  "ok": false,
  "error_code": "EXTRACTION_FAILED",
  "message": "Invalid document format"
}
```

#### Example Usage

```typescript
// Import SAT Constancia
const result = await mcpClient.callTool("import_kyc_document", {
  customer_id: "customer-123",
  doc_type: "sat_constancia",
  file_url: "https://example.com/constancia.pdf",
  source_name: "SAT_Constancia_2024.pdf"
});

// Import Acta Constitutiva
await mcpClient.callTool("import_kyc_document", {
  customer_id: "customer-123",
  doc_type: "acta",
  file_url: "/path/to/acta.pdf"
});

// Import bank statement
await mcpClient.callTool("import_kyc_document", {
  customer_id: "customer-123",
  doc_type: "bank_statement",
  file_url: "https://bank.com/statement.pdf"
});
```

#### Notes

- Creates a new run if one doesn't exist for the customer
- Appends documents to existing runs
- Extraction uses GPT-5.1 Vision API
- Documents are validated against Zod schemas
- Failed extractions still create document entries (with error info)

---

### 3. `build_kyc_profile`

Aggregates all imported documents for a customer into a unified KYC profile.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `customer_id` | string | Yes | Customer identifier |

#### Response (Success)

Returns the complete `KycProfile` object:

```json
{
  "ok": true,
  "data": {
    "customerId": "customer-123",
    "companyIdentity": {
      "razon_social": "Example Corp",
      "rfc": "EXC123456789",
      "incorporation_date": "2020-01-15",
      "founding_address": { ... },
      "legal_representatives": [ ... ],
      "shareholders": [ ... ],
      ...
    },
    "companyTaxProfile": {
      "rfc": "EXC123456789",
      "razon_social": "Example Corp",
      "tax_regime": "General",
      "fiscal_address": { ... },
      "economic_activities": [ ... ],
      ...
    },
    "representativeIdentity": { ... },
    "currentFiscalAddress": { ... },
    "currentOperationalAddress": { ... },
    "foundingAddress": { ... },
    "addressEvidence": [ ... ],
    "bankAccounts": [ ... ],
    "historical_addresses": [ ... ],
    "lastUpdatedAt": "2024-01-15T10:30:00Z"
  }
}
```

#### Response (Error)

```json
{
  "ok": false,
  "error_code": "NO_RUN_FOR_CUSTOMER",
  "message": "No run found for customer customer-123"
}
```

#### Example Usage

```typescript
const result = await mcpClient.callTool("build_kyc_profile", {
  customer_id: "customer-123"
});

const profile = JSON.parse(result.content[0].text);
console.log(profile.companyIdentity?.razon_social);
console.log(profile.currentFiscalAddress);
```

#### Notes

- Automatically resolves addresses using precedence rules
- Preserves all historical addresses
- Fiscal address always from SAT Constancia
- Operational address: Bank > CFE/Telmex > SAT (fallback)
- Profile is saved to the run after building

---

### 4. `validate_kyc_profile`

Validates a KYC profile and generates validation results with scores and flags.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `customer_id` | string | Yes | Customer identifier |

#### Response (Success)

```json
{
  "ok": true,
  "data": {
    "customerId": "customer-123",
    "score": 0.85,
    "flags": [
      {
        "code": "ADDRESS_MISMATCH",
        "level": "warning",
        "message": "Fiscal address differs from operational address"
      },
      {
        "code": "LOW_DOC_COVERAGE",
        "level": "info",
        "message": "Missing bank statement"
      }
    ],
    "generatedAt": "2024-01-15T10:35:00Z"
  }
}
```

#### Flag Codes

- `ADDRESS_MISMATCH`: Addresses from different sources don't match
- `REP_ID_MISMATCH`: Representative identity inconsistencies
- `LOW_DOC_COVERAGE`: Missing recommended documents
- `OTHER`: Generic validation issue

#### Flag Levels

- `info`: Informational, doesn't affect score significantly
- `warning`: Should be reviewed, minor score impact
- `critical`: Blocks approval, major score impact

#### Response (Error)

```json
{
  "ok": false,
  "error_code": "NO_RUN_FOR_CUSTOMER",
  "message": "No run found for customer customer-123"
}
```

#### Example Usage

```typescript
const result = await mcpClient.callTool("validate_kyc_profile", {
  customer_id: "customer-123"
});

const validation = JSON.parse(result.content[0].text);
console.log(`Score: ${validation.score}`);
validation.flags.forEach(flag => {
  console.log(`[${flag.level}] ${flag.message}`);
});
```

#### Notes

- Auto-builds profile if missing
- Score ranges from 0.0 to 1.0
- Validation results are saved to the run
- Critical flags indicate blocking issues

---

### 5. `get_kyc_report`

Generates a comprehensive KYC report combining profile and validation data.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `customer_id` | string | Yes | Customer identifier |

#### Response (Success)

```json
{
  "ok": true,
  "data": {
    "customerId": "customer-123",
    "generatedAt": "2024-01-15T10:40:00Z",
    "profile": {
      "companyIdentity": { ... },
      "companyTaxProfile": { ... },
      "currentFiscalAddress": { ... },
      "currentOperationalAddress": { ... },
      ...
    },
    "validation": {
      "score": 0.85,
      "flags": [ ... ]
    },
    "summary": {
      "companyName": "Example Corp",
      "rfc": "EXC123456789",
      "hasCompleteProfile": true,
      "documentCount": 3,
      "addressesFound": 2
    },
    "recommendations": [
      "Consider adding bank statement for operational address verification"
    ]
  }
}
```

#### Response (Error)

```json
{
  "ok": false,
  "error_code": "NO_RUN_FOR_CUSTOMER",
  "message": "No run found for customer customer-123"
}
```

#### Error Codes

- `NO_RUN_FOR_CUSTOMER`: No run exists for the customer
- `FAILED_TO_GENERATE_PROFILE_OR_VALIDATION`: Profile/validation generation failed

#### Example Usage

```typescript
const result = await mcpClient.callTool("get_kyc_report", {
  customer_id: "customer-123"
});

const report = JSON.parse(result.content[0].text);
if (report.ok) {
  console.log(`Company: ${report.summary.companyName}`);
  console.log(`Score: ${report.validation.score}`);
  console.log(`Recommendations:`, report.recommendations);
} else {
  console.error(`Error: ${report.error_code}`);
}
```

#### Notes

- Auto-builds profile and validation if missing
- Combines all available data into single report
- Includes actionable recommendations
- Report is not persisted (regenerated on each call)

---

## Workflow Examples

### Complete KYC Workflow

```typescript
// 1. Import all documents
await import_kyc_document({
  customer_id: "customer-123",
  doc_type: "sat_constancia",
  file_url: "constancia.pdf"
});

await import_kyc_document({
  customer_id: "customer-123",
  doc_type: "acta",
  file_url: "acta.pdf"
});

await import_kyc_document({
  customer_id: "customer-123",
  doc_type: "cfe",
  file_url: "cfe_bill.pdf"
});

// 2. Build profile
await build_kyc_profile({ customer_id: "customer-123" });

// 3. Validate
await validate_kyc_profile({ customer_id: "customer-123" });

// 4. Get final report
const report = await get_kyc_report({ customer_id: "customer-123" });
```

### Incremental Document Addition

```typescript
// Add documents over time
await import_kyc_document({ ... }); // Document 1
await import_kyc_document({ ... }); // Document 2

// Rebuild profile with new documents
await build_kyc_profile({ customer_id: "customer-123" });

// Re-validate
await validate_kyc_profile({ customer_id: "customer-123" });
```

## Error Handling

All tools return errors in a consistent format:

```json
{
  "ok": false,
  "error_code": "EXTRACTION_FAILED",
  "message": "Error message here"
}
```

Common error scenarios / codes:
- `INVALID_DOC_TYPE`
- `EXTRACTION_FAILED`
- `NO_RUN_FOR_CUSTOMER`
- `PROFILE_BUILD_FAILED`
- `FAILED_TO_GENERATE_PROFILE_OR_VALIDATION`
- `INVALID_FILE_URL`
- `SCHEMA_VALIDATION_FAILED`

## Rate Limiting

Currently no rate limiting is implemented. Consider:
- Limiting concurrent extractions
- Caching extracted documents
- Implementing request queuing

## Best Practices

1. **Import all documents first** before building profile
2. **Use consistent customer_id** across all operations
3. **Handle errors gracefully** - check `isError` flag
4. **Rebuild profile** after adding new documents
5. **Re-validate** after profile changes
6. **Store run_id** for tracking document history

