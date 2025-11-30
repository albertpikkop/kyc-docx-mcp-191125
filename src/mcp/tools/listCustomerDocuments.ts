/**
 * MCP Tool: list_customer_documents
 * 
 * PURPOSE: Scan a customer folder and identify available documents by type.
 * LOGIC: All document detection logic lives HERE, not in Claude.
 * 
 * Claude's job: Call this tool, present the results.
 * This tool's job: Read folder, identify documents, return structured list.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface DocumentInfo {
  filename: string;
  document_type: string;
  file_path: string;
  file_size_bytes: number;
  detected_by: string; // How we detected the type (filename pattern, etc.)
}

export interface ListDocumentsResult {
  customer_id: string;
  folder_path: string;
  documents: DocumentInfo[];
  unknown_files: string[]; // Files we couldn't classify
  scan_timestamp: string;
}

/**
 * Document type detection rules - ALL LOGIC HERE, NOT IN CLAUDE
 */
const DOCUMENT_PATTERNS: { type: string; patterns: RegExp[]; description: string }[] = [
  {
    type: 'acta',
    patterns: [
      /acta[_\-\s]?constitutiva/i,
      /modificaci[oó]n/i,
      /compraventa/i,
      /reforma/i,
      /protocolizaci[oó]n/i,
    ],
    description: 'Acta Constitutiva or Modification'
  },
  {
    type: 'sat_constancia',
    patterns: [
      /sat[_\-\s]?constancia/i,
      /constancia[_\-\s]?sat/i,
      /situaci[oó]n[_\-\s]?fiscal/i,
      /csf[_\-\s]/i,
    ],
    description: 'SAT Constancia de Situación Fiscal'
  },
  {
    type: 'fm2',
    patterns: [
      /fm2/i,
      /fm3/i,
      /residente/i,
      /inm/i,
    ],
    description: 'FM2/FM3 Immigration Document'
  },
  {
    type: 'passport',
    patterns: [
      /passport/i,
      /pasaporte/i,
    ],
    description: 'Passport'
  },
  {
    type: 'ine',
    patterns: [
      /ine/i,
      /ife/i,
      /credencial[_\-\s]?votar/i,
    ],
    description: 'INE/IFE Voter ID'
  },
  {
    type: 'cfe',
    patterns: [
      /cfe/i,
      /comisi[oó]n[_\-\s]?federal[_\-\s]?electricidad/i,
      /luz/i,
    ],
    description: 'CFE Electric Bill'
  },
  {
    type: 'telmex',
    patterns: [
      /telmex/i,
      /tel[eé]fono/i,
    ],
    description: 'Telmex Phone Bill'
  },
  {
    type: 'bank_identity_page',
    patterns: [
      /bank[_\-\s]?estado/i,
      /estado[_\-\s]?cuenta/i,
      /bank[_\-\s]?statement/i,
    ],
    description: 'Bank Statement / Identity Page'
  },
  {
    type: 'legal_document',
    patterns: [
      /rpp/i,
      /registro[_\-\s]?p[uú]blico/i,
      /fme/i,
      /boleta/i,
      /rnie/i,
      /sre/i,
    ],
    description: 'Legal/Registry Document'
  },
];

/**
 * Detect document type from filename - DETERMINISTIC LOGIC
 */
function detectDocumentType(filename: string): { type: string; detected_by: string } | null {
  const lowerFilename = filename.toLowerCase();
  
  for (const pattern of DOCUMENT_PATTERNS) {
    for (const regex of pattern.patterns) {
      if (regex.test(lowerFilename)) {
        return {
          type: pattern.type,
          detected_by: `Matched pattern: ${regex.toString()} → ${pattern.description}`
        };
      }
    }
  }
  
  return null;
}

/**
 * MAIN TOOL FUNCTION
 * 
 * Input: folder_path (string) - Path to customer's document folder
 * Output: ListDocumentsResult with all detected documents
 * 
 * Claude CANNOT modify this logic. Claude only calls and presents results.
 */
export async function listCustomerDocuments(folder_path: string): Promise<ListDocumentsResult> {
  const customer_id = path.basename(folder_path);
  const documents: DocumentInfo[] = [];
  const unknown_files: string[] = [];
  
  // Validate folder exists
  if (!fs.existsSync(folder_path)) {
    throw new Error(`Folder not found: ${folder_path}`);
  }
  
  // Read all files in folder
  const files = fs.readdirSync(folder_path);
  
  for (const filename of files) {
    const filePath = path.join(folder_path, filename);
    const stat = fs.statSync(filePath);
    
    // Skip directories
    if (stat.isDirectory()) continue;
    
    // Skip non-document files
    const ext = path.extname(filename).toLowerCase();
    if (!['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif'].includes(ext)) {
      continue;
    }
    
    // Detect document type
    const detection = detectDocumentType(filename);
    
    if (detection) {
      documents.push({
        filename,
        document_type: detection.type,
        file_path: filePath,
        file_size_bytes: stat.size,
        detected_by: detection.detected_by
      });
    } else {
      unknown_files.push(filename);
    }
  }
  
  return {
    customer_id,
    folder_path,
    documents,
    unknown_files,
    scan_timestamp: new Date().toISOString()
  };
}

/**
 * Tool definition for MCP registration
 */
export const LIST_CUSTOMER_DOCUMENTS_TOOL = {
  name: 'list_customer_documents',
  description: `Scan a customer's document folder and identify all KYC documents by type.
Returns a structured list of documents with their detected types.
Claude should call this FIRST to know what documents are available before extraction.`,
  inputSchema: {
    type: 'object',
    properties: {
      folder_path: {
        type: 'string',
        description: 'Full path to the customer document folder'
      }
    },
    required: ['folder_path']
  }
};

