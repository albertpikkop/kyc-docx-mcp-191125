/**
 * Schema for Boleta de Inscripción del Registro Público de Comercio
 * This document contains the FME (Folio Mercantil Electrónico) - the official company registration number
 * 
 * Legal Basis: Código de Comercio Art. 21
 * Issuer: Secretaría de Economía - Registro Público de Comercio
 */

export const BoletaRPCSchema = {
  type: "object",
  additionalProperties: false,
  description: "Boleta de Inscripción del Registro Público de Comercio - Contains FME and official registration data",
  properties: {
    numero_unico_documento: { 
      type: "string", 
      description: "Número Único de Documento - This IS the FME (Folio Mercantil Electrónico). Usually a 16-digit number like '2021002379110064'", 
      nullable: true 
    },
    libro: { 
      type: "string", 
      description: "Registry book number (e.g., '1511')", 
      nullable: true 
    },
    tipo_acto: { 
      type: "string", 
      description: "Type of registered act (e.g., 'M4 - Constitución de sociedad', 'M5 - Modificación de estatutos')", 
      nullable: true 
    },
    instrumento: { 
      type: "string", 
      description: "Notarial instrument/protocol number", 
      nullable: true 
    },
    fecha_instrumento: { 
      type: "string", 
      description: "Date of notarial instrument (YYYY-MM-DD format)", 
      nullable: true 
    },
    notario_nombre: { 
      type: "string", 
      description: "Full name of the notary public", 
      nullable: true 
    },
    notario_numero: { 
      type: "string", 
      description: "Notary number (e.g., '39')", 
      nullable: true 
    },
    entidad: { 
      type: "string", 
      description: "State/Entity (e.g., 'Ciudad de México', 'Jalisco')", 
      nullable: true 
    },
    municipio: { 
      type: "string", 
      description: "Municipality (e.g., 'Álvaro Obregón', 'Miguel Hidalgo')", 
      nullable: true 
    },
    fecha_inscripcion: { 
      type: "string", 
      description: "Date of registration in the RPC (YYYY-MM-DD format). Usually found at the bottom of the document with a timestamp.", 
      nullable: true 
    },
    razon_social: { 
      type: "string", 
      description: "Full company name as registered (e.g., 'PFDS, SOCIEDAD ANÓNIMA PROMOTORA DE INVERSIÓN DE CAPITAL VARIABLE')", 
      nullable: true 
    },
    tipo_sociedad: { 
      type: "string", 
      description: "Company type extracted from razón social (e.g., 'S.A.P.I. DE C.V.', 'S.A. DE C.V.', 'S. DE R.L.')", 
      nullable: true 
    },
    capital_social: { 
      type: "number", 
      description: "Registered capital in MXN (e.g., 10200.00)", 
      nullable: true 
    },
    duracion: { 
      type: "string", 
      description: "Company duration (e.g., 'INDEFINIDA', '99 AÑOS')", 
      nullable: true 
    },
    domicilio: { 
      type: "string", 
      description: "Registered address/domicile", 
      nullable: true 
    },
    objeto_social: { 
      type: "string", 
      description: "Brief description of corporate purpose (first paragraph only)", 
      nullable: true 
    },
    administracion: { 
      type: "string", 
      description: "Type of administration (e.g., 'Colegiada' for board, 'Unipersonal' for single administrator)", 
      nullable: true 
    },
    firmante: { 
      type: "string", 
      description: "Name of the RPC official who signed the document", 
      nullable: true 
    }
  },
  required: [
    "numero_unico_documento", 
    "libro", 
    "tipo_acto", 
    "instrumento", 
    "fecha_instrumento",
    "notario_nombre",
    "notario_numero",
    "entidad",
    "municipio",
    "fecha_inscripcion",
    "razon_social"
  ]
};

export const BOLETA_RPC_EXTRACTION_INSTRUCTIONS = `
You are extracting data from a Mexican "Boleta de Inscripción del Registro Público de Comercio" (RPC Registration Certificate).

This document is issued by the Secretaría de Economía and contains the official company registration in the Commercial Public Registry.

CRITICAL FIELDS TO EXTRACT:
1. **Número Único de Documento** - This is the FME (Folio Mercantil Electrónico). It's usually a 16-digit number at the top right of the document (e.g., "2021002379110064"). This is THE MOST IMPORTANT field.
2. **Libro** - Registry book number (e.g., "1511")
3. **Fecha de Inscripción** - Look for a timestamp at the bottom of the last page (e.g., "11/10/2021 12:52:49 T.CENTRO")

DOCUMENT STRUCTURE:
- Header: "Registro Público de Comercio" with SE logo
- Top right: "Número Único de Documento" followed by the FME number
- Body: "M4 - Constitución de sociedad" or similar act type
- Contains: Company name, notary info, capital, shareholders, powers
- Footer: Timestamp and official signature

EXTRACTION RULES:
1. The "Número Único de Documento" IS the FME - extract it exactly as printed
2. Convert dates to YYYY-MM-DD format
3. Extract capital as a number (e.g., "10,200.00" → 10200)
4. For fecha_inscripcion, look for the timestamp at the bottom of the document
5. Return null for any field not clearly visible in the document

DO NOT:
- Invent or calculate any numbers
- Confuse the notarial instrument number with the FME
- Return empty strings - use null instead
`;

