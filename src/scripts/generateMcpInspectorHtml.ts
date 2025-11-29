#!/usr/bin/env tsx
/**
 * Generates an HTML inspector page for the MCP server
 */

import * as fs from 'fs';
import * as path from 'path';

const SUPPORTED_DOCS: Record<string, string> = {
  "acta": "Acta Constitutiva (Incorporation Deed) - Extracts Identity, Shareholders, Powers",
  "sat_constancia": "SAT Constancia de Situación Fiscal - Extracts Tax Profile",
  "fm2": "FM2 / Residente Card - Extracts Immigration Profile",
  "telmex": "Telmex Bill - Extracts Proof of Address",
  "cfe": "CFE Electricity Bill - Extracts Proof of Address",
  "bank_statement": "Bank Statement - Extracts Profile & Transactions",
  "bank_identity_page": "Bank Identity Page - Extracts Account Profile from Bank Statement Identity Page"
};

function generateHtml(): string {
  const tools = [
    {
      name: "list_supported_doc_types",
      description: "Lists all supported document types and their descriptions",
      parameters: [],
      returns: "Array of document type objects",
      handler: "handleListSupportedDocTypes()"
    },
    {
      name: "import_kyc_document",
      description: "Imports a KYC document, extracts structured data, and stores it",
      parameters: [
        { name: "customer_id", type: "string", required: true, description: "Unique customer identifier" },
        { name: "doc_type", type: "enum", required: true, description: "Document type (see below)" },
        { name: "file_url", type: "string", required: true, description: "URL or path to document file" },
        { name: "source_name", type: "string", required: false, description: "Human-readable source name" }
      ],
      returns: "Import result with customer_id, run_id, doc_id, status",
      handler: "handleImportKycDocument()"
    },
    {
      name: "build_kyc_profile",
      description: "Aggregates all imported documents into a unified KYC profile",
      parameters: [
        { name: "customer_id", type: "string", required: true, description: "Customer identifier" }
      ],
      returns: "Complete KycProfile object",
      handler: "handleBuildKycProfile()"
    },
    {
      name: "validate_kyc_profile",
      description: "Validates a KYC profile and generates validation results",
      parameters: [
        { name: "customer_id", type: "string", required: true, description: "Customer identifier" }
      ],
      returns: "KycValidationResult with score (0-1) and flags",
      handler: "handleValidateKycProfile()"
    },
    {
      name: "get_kyc_report",
      description: "Generates a comprehensive KYC report",
      parameters: [
        { name: "customer_id", type: "string", required: true, description: "Customer identifier" },
        { name: "include_trace", type: "boolean", required: false, description: "Include traceability section (default: false)" }
      ],
      returns: "Complete KYC report JSON",
      handler: "handleGetKycReport()"
    }
  ];

  const errorCodes = [
    { code: "EXTRACTION_FAILED", description: "Document extraction failed" },
    { code: "NO_RUN_FOR_CUSTOMER", description: "No run found for customer" },
    { code: "PROFILE_BUILD_FAILED", description: "Failed to build profile" },
    { code: "FAILED_TO_GENERATE_PROFILE_OR_VALIDATION", description: "Unable to generate profile/validation" }
  ];

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MCP Server Inspector - mx-kyc-mcp</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            font-size: 14px;
            line-height: 1.6;
            color: #333;
            background-color: #f5f5f5;
            padding: 20px;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background-color: #fff;
            border: 1px solid #ddd;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        header {
            background-color: #2c3e50;
            color: #fff;
            padding: 20px;
            border-bottom: 3px solid #34495e;
        }
        header h1 {
            font-size: 24px;
            margin-bottom: 5px;
        }
        header p {
            font-size: 14px;
            color: #ecf0f1;
        }
        .content {
            padding: 20px;
        }
        h2 {
            font-size: 20px;
            margin: 30px 0 15px 0;
            padding-bottom: 10px;
            border-bottom: 2px solid #3498db;
            color: #2c3e50;
        }
        h3 {
            font-size: 16px;
            margin: 20px 0 10px 0;
            color: #34495e;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 15px 0;
            background-color: #fff;
        }
        table th {
            background-color: #34495e;
            color: #fff;
            padding: 10px;
            text-align: left;
            font-weight: 600;
            border: 1px solid #2c3e50;
        }
        table td {
            padding: 10px;
            border: 1px solid #ddd;
        }
        table tr:nth-child(even) {
            background-color: #f9f9f9;
        }
        table tr:hover {
            background-color: #f0f0f0;
        }
        code {
            background-color: #f4f4f4;
            padding: 2px 6px;
            border: 1px solid #ddd;
            border-radius: 3px;
            font-family: 'Courier New', Courier, monospace;
            font-size: 13px;
            color: #c7254e;
        }
        pre {
            background-color: #2c3e50;
            color: #ecf0f1;
            padding: 15px;
            border-radius: 4px;
            overflow-x: auto;
            margin: 10px 0;
            border: 1px solid #1a252f;
        }
        pre code {
            background-color: transparent;
            color: #ecf0f1;
            padding: 0;
            border: none;
        }
        .info-box {
            background-color: #e8f4f8;
            border-left: 4px solid #3498db;
            padding: 15px;
            margin: 15px 0;
        }
        .success-box {
            background-color: #d4edda;
            border-left: 4px solid #28a745;
            padding: 15px;
            margin: 15px 0;
        }
        .error-box {
            background-color: #f8d7da;
            border-left: 4px solid #dc3545;
            padding: 15px;
            margin: 15px 0;
        }
        .badge {
            display: inline-block;
            padding: 3px 8px;
            border-radius: 3px;
            font-size: 11px;
            font-weight: 600;
            margin-right: 5px;
        }
        .badge-required {
            background-color: #dc3545;
            color: #fff;
        }
        .badge-optional {
            background-color: #6c757d;
            color: #fff;
        }
        .badge-type {
            background-color: #17a2b8;
            color: #fff;
        }
        ul {
            margin: 10px 0 10px 20px;
        }
        li {
            margin: 5px 0;
        }
        .tool-section {
            margin: 20px 0;
            padding: 15px;
            border: 1px solid #ddd;
            background-color: #fafafa;
        }
        .tool-section h3 {
            margin-top: 0;
            color: #2c3e50;
        }
        footer {
            text-align: center;
            padding: 15px;
            background-color: #ecf0f1;
            border-top: 1px solid #ddd;
            color: #7f8c8d;
            font-size: 12px;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>MCP Server Inspector</h1>
            <p>mx-kyc-mcp v1.0.0 | Protocol: Model Context Protocol (MCP) | Transport: stdio / SSE</p>
        </header>
        
        <div class="content">
            <h2>Server Information</h2>
            <table>
                <tr>
                    <th>Property</th>
                    <th>Value</th>
                </tr>
                <tr>
                    <td><strong>Name</strong></td>
                    <td>mx-kyc-mcp</td>
                </tr>
                <tr>
                    <td><strong>Version</strong></td>
                    <td>1.0.0</td>
                </tr>
                <tr>
                    <td><strong>Protocol</strong></td>
                    <td>Model Context Protocol (MCP)</td>
                </tr>
                <tr>
                    <td><strong>Transport</strong></td>
                    <td>stdio / SSE</td>
                </tr>
            </table>

            <h2>Available Tools (${tools.length})</h2>
            ${tools.map((tool, index) => `
            <div class="tool-section">
                <h3>${index + 1}. ${tool.name}</h3>
                <p><strong>Description:</strong> ${tool.description}</p>
                ${tool.parameters.length > 0 ? `
                <h4>Parameters:</h4>
                <table>
                    <tr>
                        <th>Name</th>
                        <th>Type</th>
                        <th>Required</th>
                        <th>Description</th>
                    </tr>
                    ${tool.parameters.map(param => `
                    <tr>
                        <td><code>${param.name}</code></td>
                        <td><span class="badge badge-type">${param.type}</span></td>
                        <td>${param.required ? '<span class="badge badge-required">Required</span>' : '<span class="badge badge-optional">Optional</span>'}</td>
                        <td>${param.description}</td>
                    </tr>
                    `).join('')}
                </table>
                ` : '<p><strong>Parameters:</strong> None</p>'}
                <p><strong>Returns:</strong> ${tool.returns}</p>
                <p><strong>Handler:</strong> <code>${tool.handler}</code></p>
            </div>
            `).join('')}

            <h2>Supported Document Types</h2>
            <table>
                <tr>
                    <th>Type</th>
                    <th>Description</th>
                </tr>
                ${Object.entries(SUPPORTED_DOCS).map(([type, desc]) => `
                <tr>
                    <td><code>${type}</code></td>
                    <td>${desc}</td>
                </tr>
                `).join('')}
            </table>

            <h2>Response Format</h2>
            <div class="success-box">
                <h3>Success Response</h3>
                <pre><code>{
  "ok": true,
  "data": { ... }
}</code></pre>
            </div>
            <div class="error-box">
                <h3>Error Response</h3>
                <pre><code>{
  "ok": false,
  "error_code": "ERROR_CODE",
  "message": "Error message"
}</code></pre>
            </div>

            <h2>Error Codes</h2>
            <table>
                <tr>
                    <th>Error Code</th>
                    <th>Description</th>
                </tr>
                ${errorCodes.map(err => `
                <tr>
                    <td><code>${err.code}</code></td>
                    <td>${err.description}</td>
                </tr>
                `).join('')}
            </table>

            <h2>Typical Workflow</h2>
            <ol>
                ${[
                    "import_kyc_document → Extract and store document",
                    "import_kyc_document → (Repeat for each document)",
                    "build_kyc_profile → Aggregate all documents",
                    "validate_kyc_profile → Validate and score",
                    "get_kyc_report → Generate final report"
                ].map(step => `<li><code>${step}</code></li>`).join('')}
            </ol>

            <h2>Storage Structure</h2>
            <div class="info-box">
                <p><strong>Location:</strong> <code>data/{customer_id}/runs/*.json</code></p>
                <p><strong>Reports:</strong> <code>data/{customer_id}/reports/*.html</code></p>
                <p><strong>Run Structure:</strong></p>
                <pre><code>{
  "runId": "uuid",
  "customerId": "string",
  "createdAt": "ISO timestamp",
  "documents": [...],
  "profile": {...},
  "validation": {...}
}</code></pre>
            </div>
        </div>

        <footer>
            Generated: ${new Date().toLocaleString()}
        </footer>
    </div>
</body>
</html>`;
}

async function main() {
  const html = generateHtml();
  const outputPath = path.join(process.cwd(), 'mcp-inspector.html');
  await fs.promises.writeFile(outputPath, html, 'utf-8');
  console.log(`✅ MCP Inspector HTML generated: ${outputPath}`);
  return outputPath;
}

main().then(path => {
  console.log(`📄 Open in browser: file://${path}`);
}).catch(console.error);




