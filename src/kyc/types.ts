/**
 * KYC Domain Types
 * 
 * This module defines the core data structures for the multi-customer KYC SaaS.
 * It includes domain entities (CompanyIdentity, TaxProfile) and system types (KycDocument, KycRun).
 */

// --- Domain Data Types ---

/**
 * Address type matching AddressSchema structure
 */
export type Address = {
  street: string | null;
  ext_number: string | null;
  int_number: string | null;
  colonia: string | null;
  municipio: string | null;
  estado: string | null;
  cp: string | null;
  cross_streets: string | null;
  country: string;
};

/**
 * Historical address entry with source tracking
 */
export type HistoricalAddress = {
  source: 'acta' | 'sat' | 'proof_of_address' | 'other';
  address: Address;
  date?: string; // YYYY-MM-DD if available
};

/**
 * Proof of Address document (e.g., utility bill, bank statement)
 */
export type ProofOfAddress = {
  document_type: string;
  date: string; // YYYY-MM-DD
  vendor_name: string | null;
  vendor_address: Address;
  vendor_tax_id: string | null;
  client_name: string | null;
  client_address: Address;
  client_tax_id: string | null;
  total_due: number | null;
  currency: string | null;
  due_date: string | null; // YYYY-MM-DD
  billing_month: string | null;
  issue_datetime: string | null;
  service?: {
    category: string | null;
    telephone_number: string | null;
  };
  account_reference: string | null;
  invoice_number: string | null;
};

/**
 * Bank Account Profile
 */
export type BankAccountProfile = {
  bank_name: string | null;
  account_holder_name: string | null;
  account_number: string | null;
  clabe: string | null;
  currency: string | null;
  statement_period_start: string | null;
  statement_period_end: string | null;
  address_on_statement?: Address;
};

/**
 * Immigration Profile from FM2/Residente card
 */
export type ImmigrationProfile = {
  full_name: string | null;
  nationality: string | null;
  document_type: string | null;
  document_number: string | null;
  secondary_number: string | null;
  date_of_birth: string | null;
  curp: string | null;
  sex: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  issuing_office: string | null;
  issuer_country: string | null;
};

/**
 * Company Identity from Acta Constitutiva
 */
export type CompanyIdentity = {
  razon_social: string;
  rfc: string | null;
  registro_mercantil: string | null;
  incorporation_date: string; // YYYY-MM-DD
  founding_address: Address;
  legal_representatives: Array<{
    name: string;
    role: string;
    has_poder: boolean | null;
    can_sign_contracts: boolean | null;
    poder_scope: string[] | null;
    joint_signature_required: boolean | null;
  }>;
  shareholders: Array<{
    name: string;
    shares: number | null;
    percentage: number | null;
    class: string | null;
    is_beneficial_owner: boolean | null;
  }>;
  corporate_purpose: string[];
  notary: {
    name: string | null;
    notary_number: string | null;
    protocol_number: string | null;
    protocol_date: string | null;
    office_location: string | null;
  };
  registry: {
    fme: string | null;
    nci: string | null;
    unique_doc_number: string | null;
    registration_city: string | null;
    registration_date: string | null;
    folio: string | null;
  };
  governance: {
    board_type: string | null;
    quorum_rules: string | null;
    voting_rights: string | null;
    share_transfer_rules: string | null;
    capital_rules: string | null;
  };
  modifications: string[] | null;
};

/**
 * Company Tax Profile from SAT Constancia
 */
export type CompanyTaxProfile = {
  rfc: string;
  razon_social: string;
  commercial_name: string | null;
  capital_regime: string | null;
  tax_regime: string;
  start_of_operations: string | null; // YYYY-MM-DD
  status: string;
  last_status_change: string | null; // YYYY-MM-DD
  issue: {
    place_municipio: string;
    place_estado: string;
    issue_date: string; // YYYY-MM-DD
  };
  fiscal_address: Address;
  economic_activities: Array<{
    order: number;
    description: string;
    percentage: number | null;
    start_date: string | null; // YYYY-MM-DD
    end_date: string | null; // YYYY-MM-DD
  }>;
  tax_obligations: Array<{
    description: string;
    due_rule: string | null;
    start_date: string | null; // YYYY-MM-DD
    end_date: string | null; // YYYY-MM-DD
  }>;
};

// --- KYC System Types ---

export type DocumentType =
  | "acta"
  | "sat_constancia"
  | "fm2"
  | "telmex"
  | "cfe"
  | "bank_statement";

export interface KycDocument {
  id: string;                // uuid or hash
  customerId: string;        // e.g. "pfds"
  type: DocumentType;
  fileUrl: string;           // path/url to the original file
  extractedAt?: string;      // ISO datetime
  extractedPayload?: unknown;// typed later at use sites
  sourceName?: string;       // e.g. "CFE_AGOSTO.pdf"
}

export interface KycValidationFlag {
  code: "ADDRESS_MISMATCH" | "REP_ID_MISMATCH" | "LOW_DOC_COVERAGE" | "OTHER";
  level: "info" | "warning" | "critical";
  message: string;
}

export interface KycValidationResult {
  customerId: string;
  score: number;               // 0–1
  flags: KycValidationFlag[];
  generatedAt: string;
}

/**
 * Complete KYC Profile aggregating all document sources
 */
export interface KycProfile {
  customerId: string;
  companyIdentity?: CompanyIdentity;
  companyTaxProfile?: CompanyTaxProfile;
  representativeIdentity?: ImmigrationProfile;
  
  foundingAddress?: Address;             // from Acta (historical)
  currentFiscalAddress?: Address;        // from SAT
  currentOperationalAddress?: Address;   // from Telmex/CFE/Bank
  
  addressEvidence: ProofOfAddress[];     // all PoA docs
  bankAccounts: BankAccountProfile[];    // one per CLABE/account
  historical_addresses: HistoricalAddress[]; // keep track of all addresses found
  
  lastUpdatedAt: string;
}

export interface KycRun {
  runId: string;
  customerId: string;
  createdAt: string;
  documents: KycDocument[];
  profile?: KycProfile;
  validation?: KycValidationResult;
}
