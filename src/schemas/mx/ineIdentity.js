import { z } from 'zod';

export const IneIdentitySchema = {
  type: "object",
  properties: {
    full_name: { type: "string", description: "Full name as printed on the INE card (Nombre completo)" },
    curp: { type: "string", description: "CURP (Clave Única de Registro de Población)" },
    clave_elector: { type: ["string", "null"], description: "Clave de Elector (18 characters)" },
    cic: { type: ["string", "null"], description: "CIC (Código de Identificación de Credencial) - found on the back following 'IDMEX', exactly 10 digits" },
    ocr_number: { type: ["string", "null"], description: "OCR Number (found on the back vertical or horizontal)" },
    emission_year: { type: ["string", "null"], description: "Year of emission (Emisión)" },
    vigencia_year: { type: ["string", "null"], description: "Year of expiry (Vigencia)" },
    date_of_birth: { type: ["string", "null"], description: "Date of Birth (YYYY-MM-DD)" },
    sex: { type: ["string", "null"], description: "Sex/Gender (H/M)" },
    address: {
      type: ["object", "null"],
      properties: {
        street: { type: ["string", "null"] },
        colonia: { type: ["string", "null"] },
        municipio: { type: ["string", "null"] },
        estado: { type: ["string", "null"] },
        cp: { type: ["string", "null"] },
        country: { type: ["string", "null"] }
      },
      // STRICT MODE REQUIREMENT: All defined properties must be in required array
      required: ["street", "colonia", "municipio", "estado", "cp", "country"],
      additionalProperties: false
    },
    issuer_country: { type: "string", enum: ["MX"], description: "Always MX for INE" }
  },
  // STRICT MODE REQUIREMENT: All defined properties must be in required array
  required: [
    "full_name", 
    "curp", 
    "clave_elector", 
    "cic", 
    "ocr_number", 
    "emission_year", 
    "vigencia_year", 
    "date_of_birth", 
    "sex", 
    "address", 
    "issuer_country"
  ],
  additionalProperties: false
};

// Zod version for runtime validation
export const IneIdentityZodSchema = z.object({
  full_name: z.string(),
  curp: z.string(),
  clave_elector: z.string().nullable(),
  cic: z.string().nullable().optional(),
  ocr_number: z.string().nullable().optional(),
  emission_year: z.string().nullable().optional(),
  vigencia_year: z.string().nullable().optional(),
  date_of_birth: z.string().nullable().optional(),
  sex: z.string().nullable().optional(),
  address: z.object({
    street: z.string().nullable(),
    colonia: z.string().nullable(),
    municipio: z.string().nullable(),
    estado: z.string().nullable(),
    cp: z.string().nullable(),
    country: z.string().nullable().default("MX")
  }).nullable().optional(),
  issuer_country: z.string().default("MX")
});
