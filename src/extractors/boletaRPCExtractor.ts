/**
 * Extractor for Boleta de Inscripción del Registro Público de Comercio
 * This document contains the FME (Folio Mercantil Electrónico) - the official company registration number
 */

import { BoletaRPCSchema, BOLETA_RPC_EXTRACTION_INSTRUCTIONS } from '../schemas/mx/boletaRPC.js';
import { normalizeEmptyToNull } from '../kyc/validators.js';
import { logExtractorError } from '../utils/logging.js';
import { routeExtraction } from '../utils/modelRouter.js';
import type { BoletaRPC } from '../kyc/types.js';

export interface BoletaRPCExtractionResult {
  success: boolean;
  data?: BoletaRPC;
  error?: string;
  modelUsed?: string;
  costUsd?: number;
}

const EXTRACTION_INSTRUCTIONS = `
${BOLETA_RPC_EXTRACTION_INSTRUCTIONS}

═══════════════════════════════════════════════════════════════════════════════
DOCUMENT STRUCTURE (Visual Guide):
═══════════════════════════════════════════════════════════════════════════════

A typical Boleta de Inscripción RPC has these sections:

┌─────────────────────────────────────────────────────────────────────────────┐
│ HEADER: "Registro Público de Comercio" with SE logo                         │
│         "Ciudad de México" (or other state)                                 │
│         "Constitución de Sociedad"                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│ TOP RIGHT:                                                                  │
│   ★ 2021002379110064 ★  ← THIS IS THE FME (Número Único de Documento)      │
│   Número Único de Documento                                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│ BODY:                                                                       │
│   M4 - Constitución de sociedad                                             │
│                                                                             │
│   Sociedad mercantil: [Company Type]                                        │
│   Modalidad de capital variable: [X] Sí  [ ] No                            │
│                                                                             │
│   Por instrumento No. 96053          Libro: 1511                           │
│   De fecha: 30/08/2021                                                      │
│   Formalizado ante: Notario Público                                        │
│   Nombre: Mauricio Gálvez Muñoz      No. 39                                │
│   Estado: Ciudad de México           Municipio: Álvaro Obregón             │
│                                                                             │
│   Se constituyó la sociedad denominada:                                     │
│   "PFDS, SOCIEDAD ANÓNIMA PROMOTORA DE INVERSIÓN DE CAPITAL VARIABLE"      │
│                                                                             │
│   Con duración: INDEFINIDA                                                  │
│   Domicilio en: CIUDAD DE MÉXICO                                           │
│   Capital social mínimo: 10,200.00                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│ SHAREHOLDERS TABLE:                                                         │
│   Nombre | Nacionalidad | CURP | RFC | No. acciones | Serie | Valor | Total│
├─────────────────────────────────────────────────────────────────────────────┤
│ ADMINISTRATION:                                                             │
│   [X] Colegiada  [ ] Unipersonal                                           │
│   Con facultades para: [list of powers]                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│ FOOTER:                                                                     │
│   11/10/2021 12:52:49 T.CENTRO      ← THIS IS fecha_inscripcion            │
│   [Signature]                                                               │
│   José Luis Flores Granados                                                 │
│                                                                             │
│   página X de Y                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════════════
CRITICAL EXTRACTION RULES:
═══════════════════════════════════════════════════════════════════════════════

1. **Número Único de Documento (FME)**: 
   - Located at TOP RIGHT of first page
   - Usually a 16-digit number like "2021002379110064"
   - This is THE MOST IMPORTANT field - extract it exactly as printed

2. **Libro**:
   - Found next to "Por instrumento No."
   - Example: "Libro: 1511"

3. **Fecha de Inscripción**:
   - Found at the BOTTOM of the LAST PAGE
   - Usually a timestamp like "11/10/2021 12:52:49 T.CENTRO"
   - Convert to YYYY-MM-DD format (e.g., "2021-10-11")

4. **Instrumento**:
   - The notarial protocol number
   - Found after "Por instrumento No."

5. **Capital Social**:
   - Convert to number: "10,200.00" → 10200

DO NOT:
- Confuse the instrumento number with the FME
- Invent any data not clearly visible
- Return empty strings (use null instead)
`;

export async function extractBoletaRPC(filePathOrUrl: string): Promise<BoletaRPCExtractionResult> {
  console.log('[BoletaRPC Extractor] Starting extraction...');
  console.log(`[BoletaRPC Extractor] File: ${filePathOrUrl}`);

  try {
    const result = await routeExtraction(
      'boletaRPC',
      filePathOrUrl,
      BoletaRPCSchema,
      EXTRACTION_INSTRUCTIONS
    );

    if (result && result.data) {
      // Post-process the extracted data
      const processed = postProcessBoletaRPC(result.data as BoletaRPC);
      return { 
        success: true, 
        data: processed,
        modelUsed: result.modelUsed,
        costUsd: result.costUsd
      };
    }

    return { success: false, error: 'No data extracted' };
  } catch (error) {
    logExtractorError('boletaRPC', error instanceof Error ? error.message : String(error), filePathOrUrl);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during extraction'
    };
  }
}

/**
 * Post-process extracted Boleta RPC data
 */
function postProcessBoletaRPC(data: BoletaRPC): BoletaRPC {
  const processed = { ...data };

  // Normalize empty strings to null
  Object.keys(processed).forEach(key => {
    const value = (processed as any)[key];
    if (typeof value === 'string') {
      (processed as any)[key] = normalizeEmptyToNull(value);
    }
  });

  // Validate FME format (should be numeric, usually 16 digits)
  if (processed.numero_unico_documento) {
    const fme = processed.numero_unico_documento.replace(/\D/g, '');
    if (fme.length >= 10) {
      processed.numero_unico_documento = fme;
    } else {
      console.warn(`[BoletaRPC Extractor] Invalid FME format: ${processed.numero_unico_documento}`);
    }
  }

  // Normalize fecha_inscripcion to YYYY-MM-DD
  if (processed.fecha_inscripcion) {
    const dateMatch = processed.fecha_inscripcion.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dateMatch) {
      const [, day, month, year] = dateMatch;
      processed.fecha_inscripcion = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
  }

  // Normalize fecha_instrumento to YYYY-MM-DD
  if (processed.fecha_instrumento) {
    const dateMatch = processed.fecha_instrumento.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dateMatch) {
      const [, day, month, year] = dateMatch;
      processed.fecha_instrumento = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
  }

  // Extract tipo_sociedad from razon_social if not provided
  if (processed.razon_social && !processed.tipo_sociedad) {
    const tipoMatch = processed.razon_social.match(/(S\.?A\.?P\.?I\.?\s*DE\s*C\.?V\.?|S\.?A\.?\s*DE\s*C\.?V\.?|S\.?\s*DE\s*R\.?L\.?|S\.?A\.?S\.?)/i);
    if (tipoMatch) {
      processed.tipo_sociedad = tipoMatch[1].toUpperCase();
    }
  }

  return processed;
}

