/**
 * MCP Tools Index
 * 
 * Export all tools for MCP server registration.
 * 
 * ARCHITECTURE PRINCIPLE:
 * - ALL logic lives in these tools
 * - Claude is ONLY an orchestrator
 * - Claude calls tools, presents results
 * - Claude CANNOT modify extraction, validation, or report logic
 */

// Tool implementations
export { listCustomerDocuments, LIST_CUSTOMER_DOCUMENTS_TOOL } from './listCustomerDocuments.js';
export { extractActa, EXTRACT_ACTA_TOOL } from './extractActa.js';
export { extractSatConstancia, EXTRACT_SAT_CONSTANCIA_TOOL } from './extractSatConstancia.js';
export { validateKycProfile, VALIDATE_KYC_PROFILE_TOOL } from './validateKycProfile.js';
export { mergeModifications, MERGE_MODIFICATIONS_TOOL } from './mergeModifications.js';
export { generateKycReport, GENERATE_KYC_REPORT_TOOL } from './generateKycReport.js';

// Tool definitions for MCP registration
export const ALL_TOOL_DEFINITIONS = [
  // 1. Discovery
  {
    name: 'list_customer_documents',
    description: `Scan a customer's document folder and identify all KYC documents by type.
Returns a structured list of documents with their detected types.
Call this FIRST to know what documents are available.`,
    inputSchema: {
      type: 'object',
      properties: {
        folder_path: { type: 'string', description: 'Path to customer folder' }
      },
      required: ['folder_path']
    }
  },
  
  // 2. Extraction - Acta
  {
    name: 'extract_acta',
    description: `Extract ALL data from Acta Constitutiva using AI.
CRITICAL: Extracts ALL facultades - no fixed limits (not 10, not 26, ALL of them).
Call this for each Acta document (original + modifications).`,
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to Acta PDF' }
      },
      required: ['file_path']
    }
  },
  
  // 3. Extraction - SAT
  {
    name: 'extract_sat_constancia',
    description: `Extract tax profile from SAT Constancia de Situación Fiscal.
Returns RFC, company name, tax status, fiscal address.`,
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to SAT PDF' }
      },
      required: ['file_path']
    }
  },
  
  // 4. Merge
  {
    name: 'merge_modifications',
    description: `Merge multiple Acta extractions into current state.
Handles shareholder transfers, new legal reps, Comisario changes.
Returns merged profile with change history.`,
    inputSchema: {
      type: 'object',
      properties: {
        actas: { type: 'array', description: 'Array of extracted Actas' }
      },
      required: ['actas']
    }
  },
  
  // 5. Validate
  {
    name: 'validate_kyc_profile',
    description: `Run validation rules on KYC profile.
ALL rules are code - you cannot influence them.
Returns score, flags, and required actions.`,
    inputSchema: {
      type: 'object',
      properties: {
        profile: { type: 'object', description: 'The KycProfile to validate' }
      },
      required: ['profile']
    }
  },
  
  // 6. Report
  {
    name: 'generate_kyc_report',
    description: `Generate HTML KYC report.
Template is FIXED - you cannot modify format.
Returns path to generated report.`,
    inputSchema: {
      type: 'object',
      properties: {
        profile: { type: 'object', description: 'The KycProfile' },
        validation: { type: 'object', description: 'The validation result' }
      },
      required: ['profile', 'validation']
    }
  }
];

