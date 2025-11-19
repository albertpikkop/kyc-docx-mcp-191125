/**
 * Immigration Profile Schema for Mexican FM2/Residente cards
 * All fields are required, nullable fields can be null if not present
 */
export const ImmigrationProfileSchema = {
  type: "object",
  additionalProperties: false,
  description: "Immigration Profile from Mexican FM2/Residente card",
  properties: {
    full_name: { type: "string", description: "Full name normalized to Western order (given name first, surname last). Extract from printed name field, NOT from MRZ.", nullable: true },
    nationality: { type: "string", description: "Nationality as printed on card. Do not infer or translate.", nullable: true },
    document_type: { type: "string", description: "Residency category exactly as printed (e.g. Residente Permanente, Residente Temporal). Do not guess or generalize.", nullable: true },
    document_number: { type: "string", description: "Primary ID number printed on card. Do NOT use MRZ sequences.", nullable: true },
    secondary_number: { type: "string", description: "Additional identification number printed elsewhere on card (separate from primary document number)", nullable: true },
    date_of_birth: { type: "string", description: "Date of birth in YYYY-MM-DD format. Extract from birthdate field, NOT from CURP or MRZ.", nullable: true },
    curp: { type: "string", description: "CURP (Clave Única de Registro de Población) only if explicitly printed. Do not calculate or infer.", nullable: true },
    sex: { type: "string", description: "Sex/Gender as printed on card. Do not infer from name or photo.", nullable: true },
    issue_date: { type: "string", description: "Issue date in YYYY-MM-DD format from printed issue field", nullable: true },
    expiry_date: { type: "string", description: "Expiry date in YYYY-MM-DD format from printed expiration field. Set to null if not present.", nullable: true },
    issuing_office: { type: "string", description: "Office of issuance from designated section. Ignore MRZ references.", nullable: true },
    issuer_country: { type: "string", description: "Country printed on document (e.g. MX for Mexico). No assumptions." }
  },
  required: [
    "full_name",
    "nationality",
    "document_type",
    "document_number",
    "secondary_number",
    "date_of_birth",
    "curp",
    "sex",
    "issue_date",
    "expiry_date",
    "issuing_office",
    "issuer_country"
  ]
};
