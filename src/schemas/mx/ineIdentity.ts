import { z } from 'zod';

export const IneIdentitySchema = {
  type: "object",
  properties: {
    // === FRONT SIDE DATA ===
    full_name: { type: "string", description: "Full name as printed on the INE card (Nombre completo) - usually APELLIDO_PATERNO APELLIDO_MATERNO NOMBRE(S)" },
    curp: { type: "string", description: "CURP (Clave Única de Registro de Población) - 18 character alphanumeric code" },
    date_of_birth: { type: ["string", "null"], description: "Date of Birth in YYYY-MM-DD format (Fecha de Nacimiento)" },
    sex: { type: ["string", "null"], description: "Sex/Gender: H (Hombre/Male) or M (Mujer/Female)" },
    nationality: { type: ["string", "null"], description: "Nationality - should be 'MEXICANA' for INE holders" },
    address: {
      type: ["object", "null"],
      description: "Residential address as printed on card",
      properties: {
        street: { type: ["string", "null"], description: "Street name and number (Calle y número)" },
        colonia: { type: ["string", "null"], description: "Neighborhood (Colonia)" },
        municipio: { type: ["string", "null"], description: "Municipality/City (Municipio o Alcaldía)" },
        estado: { type: ["string", "null"], description: "State abbreviation (Estado)" },
        cp: { type: ["string", "null"], description: "Postal code (Código Postal)" },
        country: { type: ["string", "null"], description: "Country code (usually MX)" }
      },
      required: [],
      additionalProperties: false
    },
    
    // === BACK SIDE DATA ===
    clave_elector: { type: ["string", "null"], description: "Clave de Elector - 18 character voter ID (format: LLLLLLNNNNNNNNLNNN)" },
    seccion: { type: ["string", "null"], description: "Electoral Section number (Sección) - 4 digits" },
    estado_registro: { type: ["string", "null"], description: "State where voter is registered (3-letter code like 'MEX', 'DIF', 'JAL')" },
    localidad: { type: ["string", "null"], description: "Locality number (Localidad)" },
    cic: { type: ["string", "null"], description: "CIC (Código de Identificación de Credencial) - 10 digits after 'IDMEX' on back" },
    ocr_number: { type: ["string", "null"], description: "OCR Number - 13 digits found on back (vertical or horizontal text)" },
    emission_year: { type: ["string", "null"], description: "Year card was issued (Emisión) - 4 digit year" },
    vigencia_year: { type: ["string", "null"], description: "Year card expires (Vigencia) - 4 digit year" },
    
    // === MRZ DATA (Machine Readable Zone on back) ===
    mrz_line1: { type: ["string", "null"], description: "First line of MRZ (starts with IDMEX)" },
    mrz_line2: { type: ["string", "null"], description: "Second line of MRZ (contains encoded data)" },
    mrz_line3: { type: ["string", "null"], description: "Third line of MRZ (contains name)" },
    
    // === METADATA ===
    issuer_country: { type: "string", enum: ["MX"], description: "Always MX for INE" },
    document_type: { type: "string", enum: ["INE", "IFE"], description: "INE (current) or IFE (legacy)" },
    card_version: { type: ["string", "null"], description: "Card version (e.g., 'E', 'F', 'G' for different INE formats)" }
  },
  // Required fields: Only fields that MUST be present (even if null)
  required: [
    "full_name",       // Always present on INE card front
    "curp",            // Always present on INE card front
    "clave_elector",   // Must be present (can be null if not visible)
    "address",         // Must be present (can be null if not visible)
    "issuer_country"   // Always "MX"
  ],
  additionalProperties: false
};

// Zod version for runtime validation
export const IneIdentityZodSchema = z.object({
  // Front side
  full_name: z.string(),
  curp: z.string(),
  date_of_birth: z.string().nullable().optional(),
  sex: z.string().nullable().optional(),
  nationality: z.string().nullable().optional(),
  address: z.object({
    street: z.string().nullable(),
    colonia: z.string().nullable(),
    municipio: z.string().nullable(),
    estado: z.string().nullable(),
    cp: z.string().nullable(),
    country: z.string().nullable().default("MX")
  }).nullable().optional(),
  
  // Back side
  clave_elector: z.string().nullable(),
  seccion: z.string().nullable().optional(),
  estado_registro: z.string().nullable().optional(),
  localidad: z.string().nullable().optional(),
  cic: z.string().nullable().optional(),
  ocr_number: z.string().nullable().optional(),
  emission_year: z.string().nullable().optional(),
  vigencia_year: z.string().nullable().optional(),
  
  // MRZ
  mrz_line1: z.string().nullable().optional(),
  mrz_line2: z.string().nullable().optional(),
  mrz_line3: z.string().nullable().optional(),
  
  // Metadata
  issuer_country: z.string().default("MX"),
  document_type: z.enum(["INE", "IFE"]).optional(),
  card_version: z.string().nullable().optional()
});
