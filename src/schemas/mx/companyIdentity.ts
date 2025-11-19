import { AddressSchema } from './address.js';

const LegalRepresentativeSchema = {
  type: "object",
  additionalProperties: false,
  description: "Legal representative details",
  properties: {
    name: { type: "string", description: "Full name of the representative" },
    role: { type: "string", description: "Role or title (e.g. Administrator, Apoderado, Representante Legal)" },
    has_poder: { type: "boolean", description: "Whether the deed explicitly grants powers to act on behalf of the company", nullable: true },
    can_sign_contracts: { type: "boolean", description: "True only if powers are explicitly granted (e.g. Apoderado)", nullable: true },
    poder_scope: { 
      type: "array", 
      items: { type: "string" }, 
      description: "List of granted power categories (e.g. pleitos y cobranzas, actos de administración, actos de dominio)", 
      nullable: true 
    },
    joint_signature_required: { type: "boolean", description: "True if powers must be exercised jointly, false if individual", nullable: true }
  },
  required: ["name", "role", "has_poder", "can_sign_contracts", "poder_scope", "joint_signature_required"]
};

const ShareholderSchema = {
  type: "object",
  additionalProperties: false,
  description: "Shareholder / Partner details",
  properties: {
    name: { type: "string", description: "Full name of shareholder" },
    shares: { type: "number", description: "Number of shares/equity units", nullable: true },
    percentage: { type: "number", description: "Percentage of ownership", nullable: true },
    class: { type: "string", description: "Class of shares (e.g. Series A, Fixed Capital)", nullable: true },
    is_beneficial_owner: { type: "boolean", description: "Whether this person is a beneficial owner (>25% usually)", nullable: true }
  },
  required: ["name", "shares", "percentage", "class", "is_beneficial_owner"]
};

const NotarySchema = {
  type: "object",
  additionalProperties: false,
  description: "Notary Public details",
  properties: {
    name: { type: "string", description: "Notary name", nullable: true },
    notary_number: { type: "string", description: "Notary number", nullable: true },
    protocol_number: { type: "string", description: "Protocol number (Escritura number)", nullable: true },
    protocol_date: { type: "string", description: "Date of protocol/signature (YYYY-MM-DD)", nullable: true },
    office_location: { type: "string", description: "Office location/City", nullable: true }
  },
  required: ["name", "notary_number", "protocol_number", "protocol_date", "office_location"]
};

const RegistrySchema = {
  type: "object",
  additionalProperties: false,
  description: "Public Registry of Commerce (RPC) details",
  properties: {
    fme: { type: "string", description: "Folio Mercantil Electrónico", nullable: true },
    nci: { type: "string", description: "Número de Control Interno", nullable: true },
    unique_doc_number: { type: "string", description: "Número Único de Documento", nullable: true },
    registration_city: { type: "string", description: "City of registration", nullable: true },
    registration_date: { type: "string", description: "Date of registration (YYYY-MM-DD)", nullable: true },
    folio: { type: "string", description: "Other folio/entry number", nullable: true }
  },
  required: ["fme", "nci", "unique_doc_number", "registration_city", "registration_date", "folio"]
};

const GovernanceSchema = {
  type: "object",
  additionalProperties: false,
  description: "Governance rules",
  properties: {
    board_type: { type: "string", description: "Administrador Único vs Consejo de Administración", nullable: true },
    quorum_rules: { type: "string", description: "Quorum requirements summary", nullable: true },
    voting_rights: { type: "string", description: "Voting thresholds summary", nullable: true },
    share_transfer_rules: { type: "string", description: "Restrictions on share transfer", nullable: true },
    capital_rules: { type: "string", description: "Capital increase/decrease rules", nullable: true }
  },
  required: ["board_type", "quorum_rules", "voting_rights", "share_transfer_rules", "capital_rules"]
};

export const CompanyIdentitySchema = {
  type: "object",
  additionalProperties: false,
  description: "Company Identity from Acta Constitutiva (Incorporation Deed)",
  properties: {
    razon_social: { type: "string", description: "Legal name of the company (Razón Social)" },
    rfc: { type: "string", description: "RFC if present in the deed, otherwise null", nullable: true },
    registro_mercantil: { type: "string", description: "Raw mercantile registry string reference (for backward compat)", nullable: true },
    incorporation_date: { type: "string", description: "Date of incorporation in YYYY-MM-DD format" },
    founding_address: AddressSchema,

    legal_representatives: {
      type: "array",
      items: LegalRepresentativeSchema,
      description: "List of appointed administrators or legal representatives"
    },
    
    // New fields
    shareholders: {
      type: "array",
      items: ShareholderSchema,
      description: "Initial shareholders / partners structure"
    },
    corporate_purpose: {
      type: "array",
      items: { type: "string" },
      description: "List of corporate purpose activities (Objeto Social)"
    },
    notary: NotarySchema,
    registry: RegistrySchema,
    governance: GovernanceSchema,
    modifications: {
      type: "array",
      items: { type: "string" },
      description: "List of modifications mentioned in the document or annexes",
      nullable: true
    }
  },
  required: [
    "razon_social",
    "rfc",
    "registro_mercantil",
    "incorporation_date",
    "founding_address",
    "legal_representatives",
    "shareholders",
    "corporate_purpose",
    "notary",
    "registry",
    "governance",
    "modifications"
  ]
};
