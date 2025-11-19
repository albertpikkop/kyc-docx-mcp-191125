/**
 * Shared Address Schema for Mexican documents
 */
export const AddressSchema = {
  type: "object",
  additionalProperties: false,
  description: "Structured address components",
  properties: {
    street: { type: "string", description: "Main street name", nullable: true },
    ext_number: { type: "string", description: "Exterior number", nullable: true },
    int_number: { type: "string", description: "Interior number (null if not present)", nullable: true },
    colonia: { type: "string", description: "Colonia/Neighborhood name", nullable: true },
    municipio: { type: "string", description: "Municipio/City/Delegation", nullable: true },
    estado: { type: "string", description: "State", nullable: true },
    cp: { type: "string", description: "Código Postal (postal code)", nullable: true },
    cross_streets: { type: "string", description: "Cross streets", nullable: true },
    country: { type: "string", description: "Country code (MX for Mexico)" }
  },
  required: [
    "street", "ext_number", "int_number", "colonia", "municipio", 
    "estado", "cp", "cross_streets", "country"
  ]
};

