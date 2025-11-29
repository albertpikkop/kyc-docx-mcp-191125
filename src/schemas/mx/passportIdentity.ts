import { z } from 'zod';

/**
 * Passport Identity Schema
 * For Mexican and foreign passports used in KYC verification
 */

export const PassportIdentitySchema = {
  type: "object",
  properties: {
    full_name: { 
      type: "string", 
      description: "Full name as printed on passport (Apellidos / Surname + Nombres / Given Names)" 
    },
    nationality: { 
      type: "string", 
      description: "Nationality/Nacionalidad (e.g., MEXICANA, INDIA, USA)" 
    },
    document_type: { 
      type: "string", 
      enum: ["PASSPORT", "PASAPORTE"],
      description: "Always PASSPORT or PASAPORTE" 
    },
    document_number: { 
      type: "string", 
      description: "Passport number (Número de Pasaporte) - alphanumeric code" 
    },
    date_of_birth: { 
      type: ["string", "null"], 
      description: "Date of Birth (YYYY-MM-DD format) - Fecha de Nacimiento" 
    },
    sex: { 
      type: ["string", "null"], 
      description: "Sex/Gender (M/F or H/M in Spanish)" 
    },
    place_of_birth: { 
      type: ["string", "null"], 
      description: "Place of birth (city, state, country)" 
    },
    issue_date: { 
      type: ["string", "null"], 
      description: "Date of Issue (YYYY-MM-DD) - Fecha de Expedición" 
    },
    expiry_date: { 
      type: ["string", "null"], 
      description: "Date of Expiry (YYYY-MM-DD) - Fecha de Vencimiento/Vigencia" 
    },
    issuing_authority: { 
      type: ["string", "null"], 
      description: "Issuing Authority (e.g., SRE for Mexican passports)" 
    },
    issuer_country: { 
      type: "string", 
      description: "Country code that issued the passport (MX, US, IN, etc.)" 
    },
    mrz_line_1: { 
      type: ["string", "null"], 
      description: "Machine Readable Zone Line 1 (if visible)" 
    },
    mrz_line_2: { 
      type: ["string", "null"], 
      description: "Machine Readable Zone Line 2 (if visible)" 
    },
    curp: { 
      type: ["string", "null"], 
      description: "CURP (only for Mexican passports, 18 characters)" 
    }
  },
  required: [
    "full_name",
    "nationality",
    "document_type",
    "document_number",
    "date_of_birth",
    "sex",
    "place_of_birth",
    "issue_date",
    "expiry_date",
    "issuing_authority",
    "issuer_country",
    "mrz_line_1",
    "mrz_line_2",
    "curp"
  ],
  additionalProperties: false
};

// Zod version for runtime validation
export const PassportIdentityZodSchema = z.object({
  full_name: z.string(),
  nationality: z.string(),
  document_type: z.enum(["PASSPORT", "PASAPORTE"]),
  document_number: z.string(),
  date_of_birth: z.string().nullable().optional(),
  sex: z.string().nullable().optional(),
  place_of_birth: z.string().nullable().optional(),
  issue_date: z.string().nullable().optional(),
  expiry_date: z.string().nullable().optional(),
  issuing_authority: z.string().nullable().optional(),
  issuer_country: z.string(),
  mrz_line_1: z.string().nullable().optional(),
  mrz_line_2: z.string().nullable().optional(),
  curp: z.string().nullable().optional()
});

export type PassportIdentity = z.infer<typeof PassportIdentityZodSchema>;


