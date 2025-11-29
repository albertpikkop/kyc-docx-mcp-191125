/**
 * Schema for SRE Convenio de Extranjería
 * Foreign investment agreement registration with Secretaría de Relaciones Exteriores
 * 
 * Legal Basis: Ley de Inversión Extranjera Art. 27
 * Issuer: Secretaría de Relaciones Exteriores
 */

export const SREConvenioSchema = {
  type: "object",
  additionalProperties: false,
  description: "SRE Convenio de Extranjería - Foreign investment agreement registration",
  properties: {
    folio: { 
      type: "string", 
      description: "SRE folio number (e.g., '21083109101'). This is the unique identifier for this registration.", 
      nullable: true 
    },
    fecha_registro: { 
      type: "string", 
      description: "Date of registration (YYYY-MM-DD format)", 
      nullable: true 
    },
    tipo_aviso: { 
      type: "string", 
      description: "Type of notice (e.g., 'Celebración de Convenio de Extranjería')", 
      nullable: true 
    },
    razon_social: { 
      type: "string", 
      description: "Company name", 
      nullable: true 
    },
    destinatario: { 
      type: "string", 
      description: "Addressee (usually the notary)", 
      nullable: true 
    },
    notario_nombre: { 
      type: "string", 
      description: "Name of the notary", 
      nullable: true 
    },
    notario_numero: { 
      type: "string", 
      description: "Notary number", 
      nullable: true 
    },
    instrumento: { 
      type: "string", 
      description: "Related notarial instrument number", 
      nullable: true 
    }
  },
  required: [
    "folio",
    "razon_social"
  ]
};

export const SRE_CONVENIO_EXTRACTION_INSTRUCTIONS = `
You are extracting data from a Mexican "Convenio de Extranjería" registration document from the Secretaría de Relaciones Exteriores (SRE).

This document confirms that a company has registered its foreign investment agreement (Convenio de Extranjería) with the SRE, as required by Mexican law for companies with foreign shareholders.

╔═══════════════════════════════════════════════════════════════════════════════╗
║  🚨 CRITICAL: FOLIO SRE - THE MOST IMPORTANT FIELD 🚨                        ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║  LOOK FOR THIS EXACT TEXT PATTERN:                                           ║
║                                                                               ║
║  "Folio: 21083109101"  or  "Número de folio: 21083109101"                   ║
║         ^^^^^^^^^^^                                                          ║
║         THIS IS THE SRE FOLIO NUMBER                                         ║
║                                                                               ║
║  The folio is usually an 11-digit number like: 21083109101                   ║
║  Format: YYMMDDHHMMS (year, month, day, hour, minute, sequence)              ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝

DOCUMENT STRUCTURE (Visual Guide):
┌─────────────────────────────────────────────────────────────────────────────┐
│ HEADER: "SECRETARÍA DE RELACIONES EXTERIORES" logo                          │
│         "Dirección General de Asuntos Jurídicos"                            │
├─────────────────────────────────────────────────────────────────────────────┤
│ REFERENCE:                                                                  │
│   Folio: 21083109101  ← EXTRACT THIS!                                       │
│   Asunto: Celebración de Convenio de Extranjería                           │
├─────────────────────────────────────────────────────────────────────────────┤
│ ADDRESSEE:                                                                  │
│   LIC. MAURICIO GÁLVEZ MUÑOZ                                               │
│   NOTARIO PÚBLICO NÚMERO 39                                                │
│   CIUDAD DE MÉXICO                                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│ BODY:                                                                       │
│   "...en relación con la escritura pública número 96,053..."               │
│   "...sociedad denominada 'PFDS, S.A.P.I. DE C.V.'..."                     │
│   "...celebración del convenio previsto en la fracción I del              │
│   artículo 27 de la Constitución..."                                       │
└─────────────────────────────────────────────────────────────────────────────┘

EXTRACTION RULES:
1. The "Folio" is the SRE registration number - usually 11 digits
2. Look for "Folio:" or "Número de folio:" followed by the number
3. The "Asunto" field contains the type of notice
4. Extract the company name from the body text
5. Convert dates to YYYY-MM-DD format

DO NOT:
- Confuse the SRE folio with the notarial instrument number
- Confuse with RNIE folio (different registry)
- Invent numbers - only extract what you see
`;

