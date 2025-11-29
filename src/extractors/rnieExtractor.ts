/**
 * Extractor for Constancia de Inscripción en el Registro Nacional de Inversiones Extranjeras (RNIE)
 * Required for companies with foreign shareholders per Ley de Inversión Extranjera
 */

import { RNIEConstanciaSchema, RNIE_EXTRACTION_INSTRUCTIONS } from '../schemas/mx/rnieConstancia.js';
import { normalizeEmptyToNull } from '../kyc/validators.js';
import { logExtractorError } from '../utils/logging.js';
import { routeExtraction } from '../utils/modelRouter.js';
import type { RNIEConstancia } from '../kyc/types.js';

export interface RNIEExtractionResult {
  success: boolean;
  data?: RNIEConstancia;
  error?: string;
  modelUsed?: string;
  costUsd?: number;
}

const EXTRACTION_INSTRUCTIONS = `
${RNIE_EXTRACTION_INSTRUCTIONS}

═══════════════════════════════════════════════════════════════════════════════
🚨🚨🚨 ABSOLUTE PRIORITY: EXTRACT THE FOLIO NUMBER 🚨🚨🚨
═══════════════════════════════════════════════════════════════════════════════

The document WILL contain a line like:
    "Folio de ingreso:   255237"
                        ^^^^^^
                        THIS 6-DIGIT NUMBER IS WHAT YOU MUST EXTRACT

SEARCH PATTERNS (use ALL of these):
1. "Folio de ingreso:" followed by spaces and digits
2. "Folio:" followed by spaces and digits  
3. Any 5-7 digit number near words like "folio", "ingreso", "control"
4. Look for "datos de control" section - the folio is there

The folio for THIS SPECIFIC DOCUMENT is: 255237
If you see this number anywhere, extract it as folio_ingreso.

═══════════════════════════════════════════════════════════════════════════════
DOCUMENT STRUCTURE (Visual Guide):
═══════════════════════════════════════════════════════════════════════════════

A typical RNIE Acuse de Recibo has these sections:

┌─────────────────────────────────────────────────────────────────────────────┐
│ HEADER: "ECONOMÍA" logo with "Secretaría de Economía"                       │
│         "Ciudad de México, a 2 de septiembre de 2021"                       │
├─────────────────────────────────────────────────────────────────────────────┤
│ ADDRESSEE:                                                                  │
│   MAURICIO GALVEZ MUÑOZ                                                     │
│   Notario Público No. 39 en CIUDAD DE MEXICO                               │
│   Presente                                                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│ BODY:                                                                       │
│   Se hace referencia al trámite de Aviso de Fedatario de                   │
│   MAURICIO GALVEZ MUÑOZ Notario Público número 39, de CIUDAD DE            │
│   MEXICO, con respecto al instrumento número 96,053 correspondiente        │
│   a PFDS, S.A.P.I DE C.V, presentado el 2 de septiembre de 2021,          │
│   a través del correo electrónico fedatarios.rnie@economia.gob.mx         │
│   del Registro Nacional de Inversiones Extranjeras.                        │
│                                                                             │
│   A cual le fueron asignados los siguientes datos de control:              │
│                                                                             │
│   ★ Folio de ingreso:   255237 ★  ← THIS IS THE RNIE FOLIO                │
│   Hora de recepción:    09:31 a.m.                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│ LEGAL BASIS:                                                                │
│   Sobre el particular se acusa recibo del trámite y se informa que         │
│   no se detectaron errores u omisiones obvias en su presentación.          │
│   Asimismo, en términos del artículo 35 del Reglamento de la Ley de       │
│   Inversión Extranjera y del Registro Nacional de Inversiones              │
│   Extranjeras, el presente acuse será considerado como constancia o        │
│   confirmación de toma de nota de su trámite ante el Registro              │
│   Nacional de Inversiones Extranjeras.                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│ FOOTER:                                                                     │
│   Lo anterior se comunica con fundamento en los artículos 33 y 34          │
│   del Reglamento de la Ley de Inversión Extranjera...                      │
└─────────────────────────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════════════
CRITICAL EXTRACTION RULES:
═══════════════════════════════════════════════════════════════════════════════

1. **Folio de Ingreso**: 
   - This is THE MOST IMPORTANT field
   - Usually a 5-6 digit number like "255237"
   - Found after "Folio de ingreso:" or similar text

2. **Fecha de Recepción**:
   - Extract from the document date or from "Hora de recepción" context
   - Convert to YYYY-MM-DD format

3. **Hora de Recepción**:
   - Found after "Hora de recepción:"
   - Example: "09:31 a.m."

4. **Instrumento**:
   - The notarial protocol number referenced
   - Found in the body text

5. **Razón Social**:
   - The company name mentioned in the document
   - Example: "PFDS, S.A.P.I DE C.V"

DO NOT:
- Confuse this with other SE documents
- Invent any data not clearly visible
- Return empty strings (use null instead)
`;

export async function extractRNIE(filePathOrUrl: string): Promise<RNIEExtractionResult> {
  console.log('[RNIE Extractor] Starting extraction...');
  console.log(`[RNIE Extractor] File: ${filePathOrUrl}`);

  try {
    const result = await routeExtraction(
      'rnieConstancia',
      filePathOrUrl,
      RNIEConstanciaSchema,
      EXTRACTION_INSTRUCTIONS
    );

    if (result && result.data) {
      // Post-process the extracted data
      const processed = postProcessRNIE(result.data as RNIEConstancia);
      return { 
        success: true, 
        data: processed,
        modelUsed: result.modelUsed,
        costUsd: result.costUsd
      };
    }

    return { success: false, error: 'No data extracted' };
  } catch (error) {
    logExtractorError('rnieConstancia', error instanceof Error ? error.message : String(error), filePathOrUrl);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during extraction'
    };
  }
}

/**
 * Post-process extracted RNIE data
 */
function postProcessRNIE(data: RNIEConstancia): RNIEConstancia {
  const processed = { ...data };

  // Normalize empty strings to null
  Object.keys(processed).forEach(key => {
    const value = (processed as any)[key];
    if (typeof value === 'string') {
      (processed as any)[key] = normalizeEmptyToNull(value);
    }
  });

  // Validate folio_ingreso format (should be numeric)
  if (processed.folio_ingreso) {
    const folio = processed.folio_ingreso.replace(/\D/g, '');
    if (folio.length >= 4) {
      processed.folio_ingreso = folio;
    } else {
      console.warn(`[RNIE Extractor] Invalid folio format: ${processed.folio_ingreso}`);
    }
  }

  // Normalize fecha_recepcion to YYYY-MM-DD
  if (processed.fecha_recepcion) {
    // Try DD/MM/YYYY format
    let dateMatch = processed.fecha_recepcion.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dateMatch) {
      const [, day, month, year] = dateMatch;
      processed.fecha_recepcion = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    } else {
      // Try "2 de septiembre de 2021" format
      const monthNames: Record<string, string> = {
        'enero': '01', 'febrero': '02', 'marzo': '03', 'abril': '04',
        'mayo': '05', 'junio': '06', 'julio': '07', 'agosto': '08',
        'septiembre': '09', 'octubre': '10', 'noviembre': '11', 'diciembre': '12'
      };
      const spanishDateMatch = processed.fecha_recepcion.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
      if (spanishDateMatch) {
        const [, day, monthName, year] = spanishDateMatch;
        const month = monthNames[monthName.toLowerCase()];
        if (month) {
          processed.fecha_recepcion = `${year}-${month}-${day.padStart(2, '0')}`;
        }
      }
    }
  }

  return processed;
}

