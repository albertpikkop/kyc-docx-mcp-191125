import { canonicalizeName } from "../core/canonicalizer";
import { DocumentType } from "./documentClassifier";

/**
 * Standardizes filenames for KYC documents
 */
export function getStandardizedFilename(
  docType: DocumentType,
  entityName: string | undefined,
  rfc: string | undefined,
  originalBasename: string
): string {
  // Map internal types to user-friendly prefixes
  const typeMap: Record<DocumentType, string> = {
    'sat_constancia': 'SAT_Constancia',
    'acta_constitutiva': 'Acta_Constitutiva',
    'lista_asistentes': 'Lista_Asistentes',
    'ine': 'INE',
    'passport': 'Passport',
    'cfe': 'CFE_Recibo',
    'telmex': 'Telmex_Recibo',
    'bank_statement': 'Estado_Cuenta',
    'unknown': 'Unknown_Doc'
  };

  const prefix = typeMap[docType] || 'Doc';
  let identifier = '';

  // Priority 1: Entity Name (Canonicalized)
  if (entityName) {
    const canon = canonicalizeName(entityName);
    // Replace spaces with underscores, remove special chars
    identifier = canon.canonical
      .replace(/[^A-Z0-9\s]/g, '')
      .replace(/\s+/g, '_');
  } 
  // Priority 2: RFC
  else if (rfc) {
    identifier = rfc.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }
  // Priority 3: Fallback to part of original filename (e.g. client folder name)
  else {
    // Try to extract client name from original file like "Acta_Constitutiva_alejandro-karam.pdf"
    const match = originalBasename.match(/_([a-zA-Z0-9-]+)\./);
    if (match) {
      identifier = match[1];
    } else {
      identifier = `Extracted_${Date.now()}`;
    }
  }

  return `${prefix}_${identifier}.pdf`;
}

