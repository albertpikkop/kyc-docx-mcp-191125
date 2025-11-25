import { ProofOfAddressSchema } from '../schemas/mx/proofOfAddress.js';
import {
  normalizeEmptyToNull,
  sanitizeRfc,
  sanitizeInvoiceNumber,
  sanitizeCurrency,
} from '../kyc/validators.js';
import { logExtractorError } from '../utils/logging.js';
import { routeExtraction, ExtractionResult } from '../utils/modelRouter.js';
import * as path from 'path';

const EXTRACTION_INSTRUCTIONS = `
You are a strict KYC extractor for Mexican CFE electricity bills (comprobantes de domicilio).
Your job is to fill the ProofOfAddress JSON schema accurately using ONLY information printed on the bill.

GLOBAL HARDENING RULES:
- Never infer or generate data not clearly printed.
- If a field is not present, set to null. Do NOT use "N/A", "Unknown", "--", or empty strings.
- Normalize all dates to YYYY-MM-DD.
- Convert amounts to numeric values (no currency symbols).
- Never invent service numbers, RFCs, or names.
- Currency: Assume "MXN" for Mexican documents unless the document explicitly uses "USD", "US$", "DÓLARES", or "DLS", in which case set to "USD". Never treat "$" alone as USD; in this context "$" means pesos (MXN).

EXTRACT:
- Provider info: vendor_name (CFE) and vendor_tax_id from the issuer block.
- Holder info: the customer/contract holder name exactly as printed. Do NOT assume it is "PFDS".
- Service address: Split strictly into street, exterior number, interior number (if any), colonia, municipio/alcaldía, estado, CP, country="MX". Include cross streets if printed.
- Service identifiers: service or contract number / account number printed on the bill.
- Billing info: billing_period_start, billing_period_end, due_date, issue_datetime (if printed), currency, total_due.
- Doc metadata: mark document_type as "cfe_receipt" and fill evidence_meta (issuer_country="MX", original_filename, pages).

Do not infer who the ultimate client is and do not merge with other documents. Only extract what this single CFE bill says.
`;

export async function extractCfeProofOfAddress(fileUrl: string): Promise<any> {
  console.log(`Extracting CFE Proof of Address using Router (Gemini default)`);
  console.log(`Processing file: ${fileUrl}`);

  try {
    // Route extraction through ModelRouter
    const result: ExtractionResult = await routeExtraction('cfe', fileUrl, ProofOfAddressSchema, EXTRACTION_INSTRUCTIONS);
    const data = result.data;

    const proofOfAddress = data.proof_of_address || data;
    const normalizedProof = normalizeEmptyToNull(proofOfAddress);

    // Add filename to metadata if available and not set
    if (normalizedProof.evidence_meta && !normalizedProof.evidence_meta.original_filename) {
      normalizedProof.evidence_meta.original_filename = path.basename(fileUrl);
    }

    // Ensure country is set to "MX" for addresses
    if (normalizedProof.client_address) {
      normalizedProof.client_address.country = "MX";
    }

    if (normalizedProof.vendor_address) {
      normalizedProof.vendor_address.country = "MX";
    }

    if (normalizedProof.vendor_tax_id) {
      normalizedProof.vendor_tax_id = sanitizeRfc(normalizedProof.vendor_tax_id);
    }
    if (normalizedProof.client_tax_id) {
      normalizedProof.client_tax_id = sanitizeRfc(normalizedProof.client_tax_id);
    }
    if (normalizedProof.invoice_number) {
      normalizedProof.invoice_number = sanitizeInvoiceNumber(normalizedProof.invoice_number);
    }
    if (normalizedProof.account_reference) {
      normalizedProof.account_reference = sanitizeInvoiceNumber(normalizedProof.account_reference);
    }
    if (normalizedProof.currency) {
      normalizedProof.currency = sanitizeCurrency(normalizedProof.currency);
    }

    // Attach metadata
    (normalizedProof as any)._metadata = {
        modelUsed: result.modelUsed,
        costUsd: result.costUsd
    };

    return normalizedProof;

  } catch (error) {
    logExtractorError("cfe", fileUrl, error);
    if (error instanceof Error) {
      throw new Error(`CFE Proof of Address extraction failed: ${error.message}`);
    }
    throw error;
  }
}
