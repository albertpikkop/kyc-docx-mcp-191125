/**
 * Schema for Autorización de Uso de Denominación o Razón Social
 * SE authorization to use a company name
 * 
 * Legal Basis: Ley General de Sociedades Mercantiles Art. 15
 * Issuer: Secretaría de Economía
 */

export const AutorizacionDenominacionSchema = {
  type: "object",
  additionalProperties: false,
  description: "Autorización de Uso de Denominación o Razón Social from Secretaría de Economía",
  properties: {
    cud: { 
      type: "string", 
      description: "Clave Única del Documento (e.g., 'A202103260225274610'). This is the unique authorization code.", 
      nullable: true 
    },
    denominacion: { 
      type: "string", 
      description: "Authorized company name/denomination", 
      nullable: true 
    },
    fecha_autorizacion: { 
      type: "string", 
      description: "Authorization date (YYYY-MM-DD format)", 
      nullable: true 
    },
    vigencia_dias: { 
      type: "number", 
      description: "Validity period in days (usually 180)", 
      nullable: true 
    },
    fecha_vencimiento: { 
      type: "string", 
      description: "Expiration date (YYYY-MM-DD format)", 
      nullable: true 
    },
    solicitante: { 
      type: "string", 
      description: "Applicant name (usually the notary)", 
      nullable: true 
    },
    fundamento_legal: { 
      type: "string", 
      description: "Legal basis cited", 
      nullable: true 
    },
    tipo_sociedad: { 
      type: "string", 
      description: "Type of company (e.g., 'S.A.P.I. DE C.V.')", 
      nullable: true 
    }
  },
  required: [
    "cud",
    "denominacion"
  ]
};

export const AUTORIZACION_DENOMINACION_EXTRACTION_INSTRUCTIONS = `
You are extracting data from a Mexican "Autorización de Uso de Denominación o Razón Social" document from the Secretaría de Economía.

This document authorizes the use of a specific company name (denominación) and must be obtained before incorporating a company.

╔═══════════════════════════════════════════════════════════════════════════════╗
║  🚨 CRITICAL: CUD (CLAVE ÚNICA DEL DOCUMENTO) - MOST IMPORTANT FIELD 🚨      ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║  LOOK FOR THIS EXACT TEXT PATTERN:                                           ║
║                                                                               ║
║  "Clave Única del Documento: A202103260225274610"                            ║
║                              ^^^^^^^^^^^^^^^^^^                              ║
║                              THIS IS THE CUD                                 ║
║                                                                               ║
║  The CUD format is: A + YYYYMMDD + 10 digit sequence                         ║
║  Example: A202103260225274610                                                ║
║           A = Authorization prefix                                           ║
║           20210326 = Date (March 26, 2021)                                   ║
║           0225274610 = Sequence number                                       ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝

DOCUMENT STRUCTURE (Visual Guide):
┌─────────────────────────────────────────────────────────────────────────────┐
│ HEADER: "SECRETARÍA DE ECONOMÍA" logo                                       │
│         "Autorización de Uso de Denominación o Razón Social"               │
├─────────────────────────────────────────────────────────────────────────────┤
│ AUTHORIZATION DETAILS:                                                      │
│   Clave Única del Documento: A202103260225274610  ← EXTRACT THIS!          │
│   Fecha de Autorización: 26 de marzo de 2021                               │
│   Vigencia: 180 días naturales                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│ DENOMINATION:                                                               │
│   Denominación Autorizada: PFDS, S.A.P.I. DE C.V.  ← EXTRACT THIS!         │
│   Tipo de Sociedad: Sociedad Anónima Promotora de Inversión                │
├─────────────────────────────────────────────────────────────────────────────┤
│ APPLICANT:                                                                  │
│   Solicitante: MAURICIO GÁLVEZ MUÑOZ                                       │
│   Notario Público No. 39                                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│ LEGAL BASIS:                                                                │
│   "...de conformidad con el artículo 15 de la Ley General de              │
│   Sociedades Mercantiles..."                                               │
└─────────────────────────────────────────────────────────────────────────────┘

EXTRACTION RULES:
1. The CUD starts with "A" followed by date and sequence (total ~19 characters)
2. Look for "Clave Única del Documento:" or just "CUD:"
3. The denomination is the full company name including type (S.A., S.A.P.I., etc.)
4. Vigencia is usually 180 days
5. Convert dates to YYYY-MM-DD format

DO NOT:
- Confuse CUD with other document numbers
- Extract partial CUD - get the complete code
- Invent numbers - only extract what you see
`;

