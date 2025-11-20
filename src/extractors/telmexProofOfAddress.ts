import { extractDocument } from './visionExtractor.js';
import { ProofOfAddressSchema } from '../schemas/mx/proofOfAddress.js';
import * as path from 'path';

const EXTRACTION_INSTRUCTIONS = `
You are a strict KYC extractor for Mexican Telmex bills (comprobantes de domicilio).
Your job is to fill the ProofOfAddress JSON schema accurately using ONLY information printed on the bill.

GLOBAL HARDENING RULES:
- Never infer or generate data not clearly printed.
- If a field is not present, set to null.
- Normalize all dates to YYYY-MM-DD.
- Convert amounts to numeric values (no currency symbols).
- Currency: Assume "MXN" for Mexican documents unless the document explicitly uses "USD", "US$", "DÓLARES", or "DLS", in which case set to "USD". Never treat "$" alone as USD; in this context "$" means pesos (MXN).

EXTRACT:
- Provider info: vendor_name (Telmex) and vendor_tax_id.
- Holder info: the customer/contract holder name exactly as printed.
- Service address: Split strictly into street, exterior number, interior number (if any), colonia, municipio/alcaldía, estado, CP, country="MX".
- Service identifiers: phone number (service number) and account number.
- Billing info: billing_period, due_date, issue_datetime (if printed), currency, total_due.
- Doc metadata: mark document_type as "telmex_bill" and fill evidence_meta.

Do not infer who the ultimate client is. Only extract what this single bill says.
`;

export async function extractTelmexProofOfAddress(fileUrl: string): Promise<any> {
  console.log(`Extracting Telmex Proof of Address from: ${fileUrl}`);
  
  try {
    const result = await extractDocument(fileUrl, ProofOfAddressSchema, EXTRACTION_INSTRUCTIONS);
    
    // Ensure document_type is set if model missed it
    if (!result.document_type) {
      result.document_type = 'telmex_bill';
    }

    // Add filename to metadata if available and not set
    if (result.evidence_meta && !result.evidence_meta.original_filename) {
      result.evidence_meta.original_filename = path.basename(fileUrl);
    } else if (!result.evidence_meta) {
       result.evidence_meta = {
          issuer_country: "MX",
          original_filename: path.basename(fileUrl),
          pages: 1 // default/unknown
       };
    }

    return result;
  } catch (error) {
    console.error('Telmex extraction failed:', error);
    throw error;
  }
}
