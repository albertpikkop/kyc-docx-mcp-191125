#!/usr/bin/env tsx
/**
 * MCP Server Inspector
 * 
 * Inspects the MCP server configuration, tools, and capabilities
 */

// Import handlers to inspect (referenced in documentation output)
import {
  handleListSupportedDocTypes,
  handleImportKycDocument,
  handleBuildKycProfile,
  handleValidateKycProfile,
  handleGetKycReport
} from "../mcp/server.js";

// Verify imports exist (used in documentation strings below)
void handleListSupportedDocTypes;
void handleImportKycDocument;
void handleBuildKycProfile;
void handleValidateKycProfile;
void handleGetKycReport;

const SUPPORTED_DOCS: Record<string, string> = {
  "acta": "Acta Constitutiva (Incorporation Deed) - Extracts Identity, Shareholders, Powers",
  "sat_constancia": "SAT Constancia de Situación Fiscal - Extracts Tax Profile",
  "fm2": "FM2 / Residente Card - Extracts Immigration Profile",
  "telmex": "Telmex Bill - Extracts Proof of Address",
  "cfe": "CFE Electricity Bill - Extracts Proof of Address",
  "bank_statement": "Bank Statement - Extracts Profile & Transactions",
  "bank_identity_page": "Bank Identity Page - Extracts Account Profile from Bank Statement Identity Page"
};

function printSection(title: string) {
  console.log("\n" + "=".repeat(80));
  console.log(`  ${title}`);
  console.log("=".repeat(80));
}

function printSubsection(title: string) {
  console.log(`\n📋 ${title}`);
  console.log("-".repeat(80));
}

async function inspectMcpServer() {
  console.log("\n╔══════════════════════════════════════════════════════════════════════════════╗");
  console.log("║                    MCP SERVER INSPECTOR                                     ║");
  console.log("╚══════════════════════════════════════════════════════════════════════════════╝");

  // Server Info
  printSection("SERVER INFORMATION");
  console.log("  Name:        mx-kyc-mcp");
  console.log("  Version:     1.0.0");
  console.log("  Protocol:    Model Context Protocol (MCP)");
  console.log("  Transport:   stdio (default) / SSE (optional)");

  // Tools
  printSection("AVAILABLE TOOLS");
  
  printSubsection("1. list_supported_doc_types");
  console.log("  Description: Lists all supported document types and their descriptions");
  console.log("  Parameters:  None");
  console.log("  Returns:     Array of document type objects");
  console.log("  Handler:     handleListSupportedDocTypes()");
  
  printSubsection("2. import_kyc_document");
  console.log("  Description: Imports a KYC document, extracts structured data, and stores it");
  console.log("  Parameters:");
  console.log("    - customer_id (string, required): Unique customer identifier");
  console.log("    - doc_type (enum, required): One of:");
  Object.entries(SUPPORTED_DOCS).forEach(([type, desc]) => {
    console.log(`      • ${type.padEnd(20)} - ${desc}`);
  });
  console.log("    - file_url (string, required): URL or path to document file");
  console.log("    - source_name (string, optional): Human-readable source name");
  console.log("  Returns:     Import result with customer_id, run_id, doc_id, status");
  console.log("  Handler:     handleImportKycDocument()");
  
  printSubsection("3. build_kyc_profile");
  console.log("  Description: Aggregates all imported documents into a unified KYC profile");
  console.log("  Parameters:");
  console.log("    - customer_id (string, required): Customer identifier");
  console.log("  Returns:     Complete KycProfile object");
  console.log("  Handler:     handleBuildKycProfile()");
  
  printSubsection("4. validate_kyc_profile");
  console.log("  Description: Validates a KYC profile and generates validation results");
  console.log("  Parameters:");
  console.log("    - customer_id (string, required): Customer identifier");
  console.log("  Returns:     KycValidationResult with score (0-1) and flags");
  console.log("  Handler:     handleValidateKycProfile()");
  
  printSubsection("5. get_kyc_report");
  console.log("  Description: Generates a comprehensive KYC report");
  console.log("  Parameters:");
  console.log("    - customer_id (string, required): Customer identifier");
  console.log("    - include_trace (boolean, optional): Include traceability section (default: false)");
  console.log("  Returns:     Complete KYC report JSON");
  console.log("  Handler:     handleGetKycReport()");

  // Response Format
  printSection("RESPONSE FORMAT");
  console.log("  All tools return a uniform JSON structure:");
  console.log("\n  Success:");
  console.log("    {");
  console.log('      "ok": true,');
  console.log('      "data": { ... }');
  console.log("    }");
  console.log("\n  Error:");
  console.log("    {");
  console.log('      "ok": false,');
  console.log('      "error_code": "ERROR_CODE",');
  console.log('      "message": "Error message"');
  console.log("    }");

  // Error Codes
  printSection("ERROR CODES");
  console.log("  • EXTRACTION_FAILED          - Document extraction failed");
  console.log("  • NO_RUN_FOR_CUSTOMER       - No run found for customer");
  console.log("  • PROFILE_BUILD_FAILED       - Failed to build profile");
  console.log("  • FAILED_TO_GENERATE_PROFILE_OR_VALIDATION - Unable to generate profile/validation");

  // Data Flow
  printSection("TYPICAL WORKFLOW");
  console.log("  1. import_kyc_document  → Extract and store document");
  console.log("  2. import_kyc_document  → (Repeat for each document)");
  console.log("  3. build_kyc_profile    → Aggregate all documents");
  console.log("  4. validate_kyc_profile → Validate and score");
  console.log("  5. get_kyc_report      → Generate final report");

  // Storage
  printSection("STORAGE");
  console.log("  Location:    data/{customer_id}/runs/*.json");
  console.log("  Reports:     data/{customer_id}/reports/*.html");
  console.log("  Structure:   Each run contains:");
  console.log("    - runId: Unique identifier");
  console.log("    - customerId: Customer identifier");
  console.log("    - createdAt: ISO timestamp");
  console.log("    - documents: Array of KycDocument");
  console.log("    - profile: KycProfile (after build)");
  console.log("    - validation: KycValidationResult (after validate)");

  // Document Types Details
  printSection("DOCUMENT TYPE DETAILS");
  Object.entries(SUPPORTED_DOCS).forEach(([type, desc], index) => {
    console.log(`\n  ${index + 1}. ${type.toUpperCase()}`);
    console.log(`     ${desc}`);
  });

  console.log("\n" + "=".repeat(80));
  console.log("  Inspection Complete!");
  console.log("=".repeat(80) + "\n");
}

// Run inspection
inspectMcpServer().catch(console.error);




