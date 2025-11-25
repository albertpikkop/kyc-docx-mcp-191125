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
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        * { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
        body { 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 2rem;
        }
        .card {
            background: white;
            border-radius: 1rem;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
        }
        .tool-card {
            transition: all 0.3s ease;
            border-left: 4px solid #667eea;
        }
        .tool-card:hover {
            transform: translateX(4px);
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
        }
        .badge {
            display: inline-block;
            padding: 0.25rem 0.75rem;
            border-radius: 9999px;
            font-size: 0.75rem;
            font-weight: 600;
        }
        .badge-required { background: #fee2e2; color: #991b1b; }
        .badge-optional { background: #dbeafe; color: #1e40af; }
        .badge-type { background: #f3f4f6; color: #374151; }
        code {
            background: #f3f4f6;
            padding: 0.125rem 0.375rem;
            border-radius: 0.25rem;
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 0.875rem;
        }
    </style>
</head>
<body>
    <div class="max-w-7xl mx-auto">
        <!-- Header -->
        <div class="card p-8 mb-8 text-center">
            <h1 class="text-4xl font-bold text-gray-900 mb-2">MCP Server Inspector</h1>
            <p class="text-xl text-gray-600">mx-kyc-mcp v1.0.0</p>
            <div class="mt-4 flex justify-center gap-4 text-sm text-gray-500">
                <span>📡 Protocol: Model Context Protocol (MCP)</span>
                <span>•</span>
                <span>🔌 Transport: stdio / SSE</span>
            </div>
        </div>

        <!-- Server Information -->
        <div class="card p-6 mb-8">
            <h2 class="text-2xl font-semibold text-gray-900 mb-4">Server Information</h2>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                    <div class="text-sm text-gray-500">Name</div>
                    <div class="text-lg font-semibold text-gray-900">mx-kyc-mcp</div>
                </div>
                <div>
                    <div class="text-sm text-gray-500">Version</div>
                    <div class="text-lg font-semibold text-gray-900">1.0.0</div>
                </div>
                <div>
                    <div class="text-sm text-gray-500">Protocol</div>
                    <div class="text-lg font-semibold text-gray-900">MCP</div>
                </div>
                <div>
                    <div class="text-sm text-gray-500">Transport</div>
                    <div class="text-lg font-semibold text-gray-900">stdio / SSE</div>
                </div>
            </div>
        </div>

        <!-- Tools -->
        <div class="mb-8">
            <h2 class="text-2xl font-semibold text-gray-900 mb-4 text-white">Available Tools (${tools.length})</h2>
            ${tools.map((tool, index) => `
            <div class="card p-6 mb-4 tool-card">
                <div class="flex items-start justify-between mb-4">
                    <div>
                        <h3 class="text-xl font-semibold text-gray-900 mb-1">
                            ${index + 1}. <code>${tool.name}</code>
                        </h3>
                        <p class="text-gray-600">${tool.description}</p>
                    </div>
                </div>
                
                ${tool.parameters.length > 0 ? `
                <div class="mb-4">
                    <h4 class="text-sm font-semibold text-gray-700 mb-2 uppercase tracking-wide">Parameters</h4>
                    <div class="space-y-2">
                        ${tool.parameters.map(param => `
                        <div class="flex items-start gap-2 p-2 bg-gray-50 rounded">
                            <code class="font-semibold">${param.name}</code>
                            <span class="badge badge-type">${param.type}</span>
                            ${param.required ? '<span class="badge badge-required">Required</span>' : '<span class="badge badge-optional">Optional</span>'}
                            <span class="text-sm text-gray-600 ml-auto">${param.description}</span>
                        </div>
                        `).join('')}
                    </div>
                </div>
                ` : '<div class="mb-4 text-sm text-gray-500">No parameters</div>'}
                
                <div class="mb-2">
                    <span class="text-sm font-semibold text-gray-700">Returns:</span>
                    <span class="text-sm text-gray-600 ml-2">${tool.returns}</span>
                </div>
                <div>
                    <span class="text-sm font-semibold text-gray-700">Handler:</span>
                    <code class="text-sm ml-2">${tool.handler}</code>
                </div>
            </div>
            `).join('')}
        </div>

        <!-- Document Types -->
        <div class="card p-6 mb-8">
            <h2 class="text-2xl font-semibold text-gray-900 mb-4">Supported Document Types</h2>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                ${Object.entries(SUPPORTED_DOCS).map(([type, desc]) => `
                <div class="p-4 border border-gray-200 rounded-lg">
                    <div class="font-semibold text-gray-900 mb-1"><code>${type}</code></div>
                    <div class="text-sm text-gray-600">${desc}</div>
                </div>
                `).join('')}
            </div>
        </div>

        <!-- Response Format -->
        <div class="card p-6 mb-8">
            <h2 class="text-2xl font-semibold text-gray-900 mb-4">Response Format</h2>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <h3 class="text-lg font-semibold text-green-700 mb-2">✅ Success</h3>
                    <pre class="bg-gray-900 text-green-400 p-4 rounded-lg text-sm overflow-x-auto"><code>{
  "ok": true,
  "data": { ... }
}</code></pre>
                </div>
                <div>
                    <h3 class="text-lg font-semibold text-red-700 mb-2">❌ Error</h3>
                    <pre class="bg-gray-900 text-red-400 p-4 rounded-lg text-sm overflow-x-auto"><code>{
  "ok": false,
  "error_code": "ERROR_CODE",
  "message": "Error message"
}</code></pre>
                </div>
            </div>
        </div>

        <!-- Error Codes -->
        <div class="card p-6 mb-8">
            <h2 class="text-2xl font-semibold text-gray-900 mb-4">Error Codes</h2>
            <div class="space-y-2">
                ${errorCodes.map(err => `
                <div class="flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded">
                    <code class="font-semibold text-red-800">${err.code}</code>
                    <span class="text-gray-700">${err.description}</span>
                </div>
                `).join('')}
            </div>
        </div>

        <!-- Workflow -->
        <div class="card p-6 mb-8">
            <h2 class="text-2xl font-semibold text-gray-900 mb-4">Typical Workflow</h2>
            <div class="space-y-3">
                ${[
                    "import_kyc_document → Extract and store document",
                    "import_kyc_document → (Repeat for each document)",
                    "build_kyc_profile → Aggregate all documents",
                    "validate_kyc_profile → Validate and score",
                    "get_kyc_report → Generate final report"
                ].map((step, index) => `
                <div class="flex items-center gap-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <div class="flex-shrink-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-semibold">
                        ${index + 1}
                    </div>
                    <code class="text-gray-800">${step}</code>
                </div>
                `).join('')}
            </div>
        </div>

        <!-- Storage -->
        <div class="card p-6">
            <h2 class="text-2xl font-semibold text-gray-900 mb-4">Storage Structure</h2>
            <div class="space-y-4">
                <div>
                    <div class="text-sm font-semibold text-gray-700 mb-1">Location</div>
                    <code class="text-sm">data/{customer_id}/runs/*.json</code>
                </div>
                <div>
                    <div class="text-sm font-semibold text-gray-700 mb-1">Reports</div>
                    <code class="text-sm">data/{customer_id}/reports/*.html</code>
                </div>
                <div>
                    <div class="text-sm font-semibold text-gray-700 mb-2">Run Structure</div>
                    <pre class="bg-gray-900 text-gray-100 p-4 rounded-lg text-sm overflow-x-auto"><code>{
  "runId": "uuid",
  "customerId": "string",
  "createdAt": "ISO timestamp",
  "documents": [...],
  "profile": {...},
  "validation": {...}
}</code></pre>
                </div>
            </div>
        </div>

        <!-- Footer -->
        <div class="text-center mt-8 text-white text-sm opacity-75">
            Generated: ${new Date().toLocaleString()}
        </div>
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




