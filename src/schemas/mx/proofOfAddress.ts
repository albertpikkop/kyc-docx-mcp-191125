import { AddressSchema } from './address.js';

const SERVICE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  description: "Service details",
  properties: {
    category: { type: "string", description: "Service category (e.g. telecom, electricity)", nullable: true },
    telephone_number: { type: "string", description: "Phone number if applicable", nullable: true },
    service_number: { type: "string", description: "Service number / Contract number / RPU (for CFE)", nullable: true }
  },
  required: ["category", "telephone_number", "service_number"]
};

export const ProofOfAddressSchema = {
  type: "object",
  additionalProperties: false,
  description: "Proof of Address JSON schema for Mexican utility bills (CFE, Telmex, etc.)",
  properties: {
    document_type: { type: "string", description: "Type of document (e.g. cfe_bill, telmex_bill)", nullable: true },
    evidence_meta: {
      type: "object",
      additionalProperties: false,
      properties: {
        issuer_country: { type: "string", description: "Issuer country code (MX)", nullable: true },
        original_filename: { type: "string", description: "Filename of the source document", nullable: true },
        pages: { type: "number", description: "Number of pages processed", nullable: true }
      },
      required: ["issuer_country", "original_filename", "pages"],
      nullable: true
    },
    
    client_name: { type: "string", description: "Client/Holder name as printed on the bill. Do not normalize or infer.", nullable: true },
    client_address: AddressSchema,
    client_tax_id: { type: "string", description: "Client RFC if printed. Set to null if not visible.", nullable: true },
    
    provider_name: { type: "string", description: "Provider name (e.g. CFE, TELMEX)", nullable: true },
    provider_address: AddressSchema,
    provider_rfc: { type: "string", description: "Provider RFC from issuer block.", nullable: true },
    
    total_due: { type: "number", description: "Total amount to pay", nullable: true },
    currency: { type: "string", description: "Currency code (MXN)", nullable: true },
    
    due_date: { type: "string", description: "Payment due date (YYYY-MM-DD)", nullable: true },
    billing_month: { type: "string", description: "Billing month/period description", nullable: true },
    billing_period_start: { type: "string", description: "Start of billing period (YYYY-MM-DD)", nullable: true },
    billing_period_end: { type: "string", description: "End of billing period (YYYY-MM-DD)", nullable: true },
    issue_datetime: { type: "string", description: "Date/Time of issuance (YYYY-MM-DD or ISO)", nullable: true },
    
    previous_balance: { type: "number", description: "Previous balance amount", nullable: true },
    current_charges: { type: "number", description: "Current charges amount", nullable: true },
    
    service: SERVICE_SCHEMA,
    
    account_reference: { type: "string", description: "Account reference / number", nullable: true },
    invoice_number: { type: "string", description: "Invoice/Folio number", nullable: true }
  },
  required: [
    "document_type", "evidence_meta",
    "client_name", "client_address", "client_tax_id",
    "provider_name", "provider_address", "provider_rfc",
    "total_due", "currency",
    "due_date", "billing_month", "billing_period_start", "billing_period_end", "issue_datetime",
    "previous_balance", "current_charges",
    "service", "account_reference", "invoice_number"
  ]
};

