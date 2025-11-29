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
  evidence_meta?: {
    issuer_country: string | null;
    original_filename: string | null;
    pages: number | null;
  } | null;
  vendor_name: string | null;
  vendor_address: Address;
  vendor_tax_id: string | null;
  client_name: string | null;
  client_address: Address;
  client_tax_id: string | null;
  total_due: number | null;
  currency: string | null;
  due_date: string | null;
  billing_month: string | null;
  billing_period_start?: string | null;
  billing_period_end?: string | null;
  issue_datetime: string | null;
  previous_balance?: number | null;
  current_charges?: number | null;
  service?: {
    category: string | null;
    telephone_number: string | null;
    service_number: string | null;
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
  // Common Fields (FM2/INE)
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
  
  // INE-Specific Fields (Front Side)
  address?: {
    street: string | null;
    colonia: string | null;
    municipio: string | null;
    estado: string | null;
    cp: string | null;
    country: string | null;
  } | null;
  
  // INE-Specific Fields (Back Side)
  clave_elector?: string | null;
  seccion?: string | null;           // Electoral section
  estado_registro?: string | null;    // State of voter registration
  localidad?: string | null;          // Locality number
  cic?: string | null;                // CIC (Código de Identificación de Credencial)
  ocr_number?: string | null;         // OCR number from back
  emission_year?: string | null;      // Year of emission
  vigencia_year?: string | null;      // Year of expiry
  
  // INE MRZ Data (Machine Readable Zone)
  mrz_line1?: string | null;
  mrz_line2?: string | null;
  mrz_line3?: string | null;
  
  // INE Metadata
  card_version?: string | null;       // INE card version (E, F, G, etc.)
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
    nationality?: string | null;  // For foreign investment compliance (RNIE)
    rfc?: string | null;          // Shareholder RFC if available
    curp?: string | null;         // Shareholder CURP if available
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

export type ImportableDocumentType =
  | "acta"
  | "sat_constancia"
  | "fm2"                    // FM2/FM3 Residente Temporal/Permanente
  | "ine"                    // INE/IFE Credencial para Votar
  | "passport"               // Pasaporte (mexicano o extranjero)
  | "telmex"
  | "cfe"
  | "bank_statement"
  | "bank_identity_page"
  // Commercial Registry & Foreign Investment Documents
  | "boleta_rpc"             // Boleta de Inscripción del Registro Público de Comercio (contains FME)
  | "rnie_constancia"        // Constancia de Inscripción en el Registro Nacional de Inversiones Extranjeras
  | "sre_convenio"           // SRE Convenio de Extranjería (foreign investment authorization)
  | "autorizacion_denominacion"; // SE Autorización de Uso de Denominación o Razón Social

export type DocumentType = ImportableDocumentType | "bank_statement_transactions";

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
  code: 
    | "ADDRESS_MISMATCH" 
    | "REP_ID_MISMATCH" 
    | "LOW_DOC_COVERAGE" 
    | "EQUITY_INCONSISTENT" 
    | "EQUITY_NEAR_100" 
    | "IDENTITY_MISMATCH" 
    | "ENTITY_MISMATCH" 
    | "POA_NAME_MISMATCH"           // Proof of Address name doesn't match client
    | "POA_THIRD_PARTY_FAMILY"      // POA in family member's name (acceptable with docs)
    | "POA_THIRD_PARTY_LANDLORD"    // POA in landlord's name (needs rental contract)
    | "POA_ADDRESS_VERIFIED"        // POA address matches SAT (mitigates third-party risk)
    | "IMMIGRATION_DOC_EXPIRED"     // FM2/FM3 likely expired
    | "IMMIGRATION_DOC_VALID_PERMANENT" // Residente Permanente valid (no expiry is correct)
    | "MISSING_FME"                 // Missing Folio Mercantil Electrónico
    | "MISSING_RNIE"                // Missing RNIE registration (required for foreign-owned companies)
    | "MISSING_SRE_CONVENIO"        // Missing SRE foreign investment agreement
    | "FOREIGN_OWNERSHIP_HIGH"      // Foreign ownership >49% (triggers additional requirements)
    | "TAX_REGIME_NO_COMMERCE"      // Sin obligaciones fiscales - cannot do commercial activity
    | "UBO_IDENTITY_NOT_VERIFIED"   // UBO identified but not ID-verified
    | "MISSING_COMPANY_SAT"         // Persona Moral missing company SAT Constancia
    | "WRONG_SAT_TYPE"              // SAT Constancia is personal, not company
    | "RFC_MISMATCH"                // RFC on SAT doesn't match RFC on Acta
    | "SHAREHOLDER_SAT_MISSING"     // Shareholder personal SAT not provided
    | "OTHER";
  level: "info" | "warning" | "critical";
  message: string;
  /** Optional: action required to resolve this flag */
  action_required?: string;
  /** Optional: supporting documents that can resolve this flag */
  supporting_docs?: string[];
}

export interface KycValidationResult {
  customerId: string;
  score: number;               // 0–1
  flags: KycValidationFlag[];
  generatedAt: string;
}

export interface BankIdentity {
  bank_name: string;
  account_holder_name: string;
  clabe: string | null;
  clabe_last4: string | null;
  address_on_file: Address | null;
  document_date: string | null; // ISO
}

/**
 * Passport Identity for foreign nationals
 */
export interface PassportIdentity {
  full_name: string | null;
  nationality: string | null;
  document_type: "PASSPORT" | "PASAPORTE";
  document_number: string | null;
  date_of_birth: string | null;
  sex: string | null;
  place_of_birth?: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  issuing_authority?: string | null;
  issuer_country: string | null;
  mrz_line_1?: string | null;
  mrz_line_2?: string | null;
  curp?: string | null;  // Only for Mexican passports
}

/**
 * Boleta de Inscripción del Registro Público de Comercio
 * Contains the FME (Folio Mercantil Electrónico) - the official company registration number
 */
export interface BoletaRPC {
  numero_unico_documento: string | null;  // This IS the FME (e.g., "2021002379110064")
  libro: string | null;                    // Registry book number (e.g., "1511")
  tipo_acto: string | null;                // Type of act (e.g., "M4 - Constitución de sociedad")
  instrumento: string | null;              // Notarial instrument number
  fecha_instrumento: string | null;        // Date of notarial instrument (YYYY-MM-DD)
  notario_nombre: string | null;           // Notary name
  notario_numero: string | null;           // Notary number
  entidad: string | null;                  // State (e.g., "Ciudad de México")
  municipio: string | null;                // Municipality
  fecha_inscripcion: string | null;        // Registration date (YYYY-MM-DD)
  razon_social: string | null;             // Company name as registered
  tipo_sociedad: string | null;            // Company type (e.g., "S.A.P.I. DE C.V.")
  capital_social: number | null;           // Registered capital
  duracion: string | null;                 // Duration (e.g., "INDEFINIDA")
  domicilio: string | null;                // Registered address
}

/**
 * Constancia de Inscripción en el Registro Nacional de Inversiones Extranjeras (RNIE)
 * Required for companies with foreign shareholders
 */
export interface RNIEConstancia {
  folio_ingreso: string | null;            // RNIE registration number (e.g., "255237")
  fecha_recepcion: string | null;          // Reception date (YYYY-MM-DD)
  hora_recepcion: string | null;           // Reception time
  instrumento: string | null;              // Related notarial instrument
  razon_social: string | null;             // Company name
  notario_nombre: string | null;           // Notary name
  notario_numero: string | null;           // Notary number
  entidad: string | null;                  // State
  tipo_tramite: string | null;             // Type of procedure (e.g., "Aviso de Fedatario")
}

/**
 * SRE Convenio de Extranjería
 * Foreign investment agreement registration with Secretaría de Relaciones Exteriores
 */
export interface SREConvenio {
  folio: string | null;                    // SRE folio number (e.g., "21083109101")
  fecha_registro: string | null;           // Registration date (YYYY-MM-DD)
  tipo_aviso: string | null;               // Type of notice (e.g., "Celebración de Convenio de Extranjería")
  razon_social: string | null;             // Company name
  destinatario: string | null;             // Addressee (notary)
}

/**
 * Autorización de Uso de Denominación o Razón Social
 * SE authorization to use a company name
 */
export interface AutorizacionDenominacion {
  cud: string | null;                      // Clave Única del Documento (e.g., "A202103260225274610")
  denominacion: string | null;             // Authorized company name
  fecha_autorizacion: string | null;       // Authorization date (YYYY-MM-DD)
  vigencia_dias: number | null;            // Validity in days (usually 180)
  solicitante: string | null;              // Applicant name
  fundamento_legal: string | null;         // Legal basis
}

/**
 * Complete KYC Profile aggregating all document sources
 */
export interface KycProfile {
  customerId: string;
  companyIdentity?: CompanyIdentity;
  companyTaxProfile?: CompanyTaxProfile;
  
  // Representative Identity Documents (for foreign nationals, need BOTH)
  representativeIdentity?: ImmigrationProfile;  // FM2/FM3/INE - Immigration status
  passportIdentity?: PassportIdentity;          // Passport - Primary identity for foreigners
  
  foundingAddress?: Address;             // from Acta (historical)
  currentFiscalAddress?: Address;        // from SAT
  currentOperationalAddress?: Address;   // from Telmex/CFE/Bank
  
  addressEvidence: ProofOfAddress[];     // all PoA docs
  bankAccounts: BankAccountProfile[];    // one per CLABE/account
  
  // Demo Mode additions
  bankIdentity?: BankIdentity & {
    age_in_days: number;
    within_90_days: boolean;
    holder_matches_company: boolean;
    address_matches_operational: boolean;
  };

  historical_addresses: HistoricalAddress[]; // keep track of all addresses found
  
  // Commercial Registry & Foreign Investment Documents
  boletaRPC?: BoletaRPC;                       // Boleta de Inscripción RPC (contains FME)
  rnieConstancia?: RNIEConstancia;             // RNIE registration (for foreign-owned companies)
  sreConvenio?: SREConvenio;                   // SRE foreign investment agreement
  autorizacionDenominacion?: AutorizacionDenominacion; // SE name authorization
  
  // Shareholder personal documents (for UBO verification)
  shareholderDocuments?: {
    name: string;
    rfc?: string | null;
    curp?: string | null;
    nationality?: string | null;
    satConstancia?: boolean;  // Has personal SAT been provided?
    idVerified?: boolean;     // Has ID been verified?
  }[];
  
  lastUpdatedAt: string;
}

export interface KycRun {
  runId: string;
  customerId: string;
  createdAt: string;
  documents: KycDocument[];
  profile?: KycProfile;
  validation?: KycValidationResult;
  
  // Transparency metrics for investors
  processingTimeMs?: number;      // Time taken to process all documents in milliseconds
  estimatedCostUsd?: number;      // Estimated AI processing cost in USD
  aiModel?: string;               // Primary AI model used (e.g., "gemini-2.5-pro")
}

// --- Traceability Types ---

export interface UboTrace {
  name: string;
  shares: number | null;
  totalShares: number | null;
  computedPercentage: number | null;
  thresholdApplied: number | null; // e.g. 25
  isUbo: boolean;
}

export interface AddressEvidenceTrace {
  role: "founding" | "fiscal" | "operational";
  address: Address | null;
  sources: {
    type: "acta" | "sat_constancia" | "cfe" | "telmex" | "bank_statement" | "other";
    documentId?: string;
    description?: string; // e.g. "CFE Agosto 2025 – GUTENBERG 60..."
  }[];
}

export interface PowerTrace {
  personName: string;
  role: string;
  scope: "full" | "limited" | "none";
  matchedPhrases: string[];   // e.g. ["PLEITOS Y COBRANZAS", "ACTOS DE ADMINISTRACIÓN"]
  missingPowers?: string[];   // New: Which canonical powers were NOT found
  limitations?: string[];     // New: Specific reasons for limited scope (e.g. "Labeled as Special")
  sourceReference?: string;   // e.g. "Acta, cláusula quinta, pág. 12"
}

export interface FreshnessTrace {
  docType: "proof_of_address" | "sat_constancia" | "bank_statement";
  latestDate: string | null;  // ISO date string
  ageInDays: number | null;
  withinThreshold: boolean;
  thresholdDays: number | null;
  supportingDocuments: { type: string; date?: string; description?: string }[];
}

export interface TraceSection {
  ubos?: UboTrace[];
  addressEvidence?: AddressEvidenceTrace[];
  powers?: PowerTrace[];
  freshness?: FreshnessTrace[];
}
