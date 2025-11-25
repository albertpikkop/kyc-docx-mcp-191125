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
You are a STRICT KYC extractor for Mexican CFE electricity bills (Comprobantes de Domicilio CFE).
Your job is to extract data EXACTLY as printed - ZERO HALLUCINATIONS, ZERO INFERENCE.

═══════════════════════════════════════════════════════════════════════════════
ANTI-HALLUCINATION RULES (MANDATORY):
═══════════════════════════════════════════════════════════════════════════════
1. ONLY extract text that is PHYSICALLY PRINTED on the document
2. If a field is not visible, set to null - NEVER guess or infer
3. NEVER use placeholder values like "N/A", "--", "Unknown", or empty strings ""
4. Copy names and addresses EXACTLY as printed
5. Convert ALL dates to YYYY-MM-DD format
6. Convert amounts to NUMERIC values (remove currency symbols)
7. Currency is MXN unless document explicitly shows "USD" or "DLS"

═══════════════════════════════════════════════════════════════════════════════
CFE BILL STRUCTURE - WHERE TO FIND DATA:
═══════════════════════════════════════════════════════════════════════════════
CFE bills typically have this layout:

TOP SECTION (Header):
- CFE logo and company info
- Bill date (Fecha de emisión)
- Service number / Número de servicio

CUSTOMER SECTION:
- Account holder name (Nombre del titular)
- Service address (Domicilio del servicio)
- Contract/Account number (No. de contrato / No. de cuenta)

CONSUMPTION SECTION:
- Billing period (Periodo de facturación)
- kWh consumed
- Previous/Current readings

PAYMENT SECTION:
- Total due (Total a pagar)
- Due date (Fecha límite de pago)
- Payment locations

═══════════════════════════════════════════════════════════════════════════════
FIELD EXTRACTION RULES:
═══════════════════════════════════════════════════════════════════════════════

1. VENDOR INFO (Always CFE):
   - vendor_name: "Comisión Federal de Electricidad" or "CFE"
   - vendor_tax_id: CFE's RFC if printed (usually "CFE370814QI0")

2. CLIENT NAME (client_name) - CRITICAL:
   - Extract the EXACT name of the account holder as printed
   - May be a person name: "ENRIQUE DE CELLO DIAZ"
   - May be a company name: "PFDS SAPI DE CV"
   - NEVER assume or guess the client name

3. SERVICE ADDRESS (client_address) - CRITICAL:
   - Extract the service address (Domicilio del servicio), NOT payment address
   - Split into components:
     * street: Street name (e.g., "CERRADA AZTECAS")
     * ext_number: Exterior number (e.g., "MZA 48", "23")
     * int_number: Interior/Lot if present (e.g., "LT 9", "DEPTO 3")
     * colonia: Neighborhood (e.g., "AMPLIACION SAN PEDRO")
     * municipio: Municipality/Delegación (e.g., "IZTAPALAPA")
     * estado: State (e.g., "CIUDAD DE MEXICO", "MEXICO")
     * cp: 5-digit postal code (e.g., "09630")
     * country: Always "MX"
   - Include cross_streets if printed (e.g., "ENTRE CALLE X Y CALLE Y")

4. SERVICE IDENTIFIERS:
   - account_reference: The service/contract number (Número de servicio)
   - invoice_number: The bill number if different from service number

5. BILLING DATES:
   - billing_period_start: Start of billing period (YYYY-MM-DD)
   - billing_period_end: End of billing period (YYYY-MM-DD)
   - due_date: Payment due date (YYYY-MM-DD)
   - issue_datetime: Date bill was generated (YYYY-MM-DD)

6. AMOUNTS:
   - total_due: Total amount to pay (numeric, no symbols)
   - currency: "MXN" (default for CFE)

7. DOCUMENT METADATA:
   - document_type: "cfe_receipt"
   - evidence_meta.issuer_country: "MX"
   - evidence_meta.original_filename: From file path
   - evidence_meta.pages: Usually 1

═══════════════════════════════════════════════════════════════════════════════
VALIDATION CHECKLIST:
═══════════════════════════════════════════════════════════════════════════════
□ client_name is populated with ACTUAL printed name (not assumed)
□ client_address has at least: street, colonia, municipio, estado, cp
□ All dates are YYYY-MM-DD format
□ total_due is a numeric value (no "$" symbols)
□ account_reference contains the service/contract number
□ No placeholder values anywhere

Return ONLY valid JSON matching the schema. Zero hallucinations.
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
