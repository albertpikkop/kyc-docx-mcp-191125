import { AddressSchema } from './address.js';

/**
 * Economic Activity Schema
 */
const EconomicActivitySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    order: { type: "number", description: "Order/sequence number" },
    description: { type: "string", description: "Activity description" },
    percentage: { type: "number", description: "Percentage of activity", nullable: true },
    start_date: { type: "string", description: "Start date in YYYY-MM-DD format", nullable: true },
    end_date: { type: "string", description: "End date in YYYY-MM-DD format (null if ongoing)", nullable: true }
  },
  required: ["order", "description", "percentage", "start_date", "end_date"]
};

/**
 * Tax Obligation Schema
 */
const TaxObligationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    description: { type: "string", description: "Obligation description" },
    due_rule: { type: "string", description: "Due date rule/frequency", nullable: true },
    start_date: { type: "string", description: "Start date in YYYY-MM-DD format", nullable: true },
    end_date: { type: "string", description: "End date in YYYY-MM-DD format (null if ongoing)", nullable: true }
  },
  required: ["description", "due_rule", "start_date", "end_date"]
};

/**
 * Issue Information Schema
 */
const IssueSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    place_municipio: { type: "string", description: "Municipio where document was issued" },
    place_estado: { type: "string", description: "State where document was issued" },
    issue_date: { type: "string", description: "Issue date in YYYY-MM-DD format" }
  },
  required: ["place_municipio", "place_estado", "issue_date"]
};

/**
 * Company Tax Profile Schema for SAT Constancia
 * All fields are required and dates are in YYYY-MM-DD format
 */
export const CompanyTaxProfileSchema = {
  type: "object",
  additionalProperties: false,
  description: "Company Tax Profile from SAT Constancia",
  properties: {
    rfc: { type: "string", description: "RFC (Registro Federal de Contribuyentes)" },
    razon_social: { type: "string", description: "Razón Social (Legal Company Name)" },
    commercial_name: { type: "string", description: "Nombre Comercial (Commercial Name)", nullable: true },
    capital_regime: { type: "string", description: "Régimen de Capital (Capital Regime)", nullable: true },
    tax_regime: { type: "string", description: "Régimen Fiscal (Tax Regime)" },
    start_of_operations: { type: "string", description: "Inicio de Operaciones (Start of Operations) in YYYY-MM-DD format", nullable: true },
    status: { type: "string", description: "Estatus (Status)" },
    last_status_change: { type: "string", description: "Último Cambio de Estatus (Last Status Change) in YYYY-MM-DD format", nullable: true },
    issue: IssueSchema,
    fiscal_address: AddressSchema,
    economic_activities: {
      type: "array",
      items: EconomicActivitySchema,
      description: "List of economic activities"
    },
    tax_obligations: {
      type: "array",
      items: TaxObligationSchema,
      description: "List of tax obligations"
    }
  },
  required: [
    "rfc",
    "razon_social",
    "commercial_name",
    "capital_regime",
    "tax_regime",
    "start_of_operations",
    "status",
    "last_status_change",
    "issue",
    "fiscal_address",
    "economic_activities",
    "tax_obligations"
  ]
};

