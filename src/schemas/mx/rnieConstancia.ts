/**
 * Schema for Constancia de Inscripción en el Registro Nacional de Inversiones Extranjeras (RNIE)
 * Required for companies with foreign shareholders per Ley de Inversión Extranjera
 * 
 * Legal Basis: Ley de Inversión Extranjera Art. 32-35
 * Issuer: Secretaría de Economía - Dirección General de Inversión Extranjera
 */

export const RNIEConstanciaSchema = {
  type: "object",
  additionalProperties: false,
  description: "Constancia de Inscripción en el Registro Nacional de Inversiones Extranjeras (RNIE)",
  properties: {
    folio_ingreso: { 
      type: "string", 
      description: "RNIE registration/entry folio number (e.g., '255237'). This is the unique identifier for this registration.", 
      nullable: true 
    },
    fecha_recepcion: { 
      type: "string", 
      description: "Date of reception/registration (YYYY-MM-DD format)", 
      nullable: true 
    },
    hora_recepcion: { 
      type: "string", 
      description: "Time of reception (HH:MM format)", 
      nullable: true 
    },
    instrumento: { 
      type: "string", 
      description: "Related notarial instrument number", 
      nullable: true 
    },
    razon_social: { 
      type: "string", 
      description: "Company name as registered", 
      nullable: true 
    },
    notario_nombre: { 
      type: "string", 
      description: "Name of the notary who submitted the registration", 
      nullable: true 
    },
    notario_numero: { 
      type: "string", 
      description: "Notary number", 
      nullable: true 
    },
    entidad: { 
      type: "string", 
      description: "State where the notary is located", 
      nullable: true 
    },
    tipo_tramite: { 
      type: "string", 
      description: "Type of procedure (e.g., 'Aviso de Fedatario', 'Inscripción Inicial')", 
      nullable: true 
    },
    fundamento_legal: { 
      type: "string", 
      description: "Legal basis cited in the document", 
      nullable: true 
    }
  },
  required: [
    "folio_ingreso",
    "fecha_recepcion",
    "razon_social"
  ]
};

export const RNIE_EXTRACTION_INSTRUCTIONS = `
You are extracting data from a Mexican "Acuse de Recibo" from the Registro Nacional de Inversiones Extranjeras (RNIE).

This document is issued by the Secretaría de Economía and confirms that a company with foreign investment has been registered.

╔═══════════════════════════════════════════════════════════════════════════════╗
║  🚨 CRITICAL: FOLIO DE INGRESO - THE MOST IMPORTANT FIELD 🚨                  ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║  LOOK FOR THIS EXACT TEXT PATTERN IN THE DOCUMENT:                           ║
║                                                                               ║
║  "Folio de ingreso:   255237"                                                ║
║                       ^^^^^^                                                  ║
║                       THIS IS THE NUMBER YOU MUST EXTRACT                    ║
║                                                                               ║
║  The folio is usually a 5-6 digit number like: 255237                        ║
║  It appears AFTER the text "Folio de ingreso:" with some spaces              ║
║                                                                               ║
║  ALSO LOOK FOR:                                                              ║
║  "Hora de recepción:   09:31 a.m."                                           ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝

DOCUMENT STRUCTURE (Visual Guide):
┌─────────────────────────────────────────────────────────────────────────────┐
│ HEADER: "ECONOMÍA" logo - Secretaría de Economía                            │
│         "Ciudad de México, a 2 de septiembre de 2021"                       │
├─────────────────────────────────────────────────────────────────────────────┤
│ ADDRESSEE:                                                                  │
│   MAURICIO GALVEZ MUÑOZ                                                     │
│   Notario Público No. 39 en CIUDAD DE MEXICO                               │
├─────────────────────────────────────────────────────────────────────────────┤
│ BODY TEXT:                                                                  │
│   "Se hace referencia al trámite de Aviso de Fedatario..."                 │
│   "...instrumento número 96,053 correspondiente a PFDS, S.A.P.I DE C.V"    │
│                                                                             │
│   "A cual le fueron asignados los siguientes datos de control:"            │
│                                                                             │
│   ★★★ Folio de ingreso:   255237 ★★★  ← EXTRACT THIS NUMBER!              │
│   Hora de recepción:   09:31 a.m.                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│ LEGAL TEXT:                                                                 │
│   "...en términos del artículo 35 del Reglamento de la Ley de             │
│   Inversión Extranjera..."                                                  │
└─────────────────────────────────────────────────────────────────────────────┘

EXTRACTION RULES:
1. The "Folio de ingreso" is a NUMBER (usually 5-6 digits like "255237")
2. Look for the EXACT pattern: "Folio de ingreso:" followed by the number
3. Extract ONLY the numeric part, not any surrounding text
4. The date format in the header is "X de [month] de YYYY" - convert to YYYY-MM-DD
5. Extract the company name from the body text (e.g., "PFDS, S.A.P.I DE C.V")

CRITICAL - DO NOT:
- Return null for folio_ingreso if you can see ANY number after "Folio de ingreso"
- Confuse this with other document numbers (instrument number, notary number)
- Invent numbers - only extract what you see
- Return empty strings - use null only if truly not visible
`;

