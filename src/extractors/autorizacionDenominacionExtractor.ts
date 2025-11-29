/**
 * Extractor for Autorización de Uso de Denominación o Razón Social
 * SE authorization to use a company name
 */

import { AutorizacionDenominacionSchema, AUTORIZACION_DENOMINACION_EXTRACTION_INSTRUCTIONS } from '../schemas/mx/autorizacionDenominacion.js';
import { normalizeEmptyToNull } from '../kyc/validators.js';
import { logExtractorError } from '../utils/logging.js';
import { routeExtraction } from '../utils/modelRouter.js';
import type { AutorizacionDenominacion } from '../kyc/types.js';

export interface AutorizacionDenominacionExtractionResult {
  success: boolean;
  data?: AutorizacionDenominacion;
  error?: string;
  modelUsed?: string;
  costUsd?: number;
}

export async function extractAutorizacionDenominacion(filePathOrUrl: string): Promise<AutorizacionDenominacionExtractionResult> {
  console.log('[Autorización Denominación Extractor] Starting extraction...');
  console.log(`[Autorización Denominación Extractor] File: ${filePathOrUrl}`);

  try {
    const result = await routeExtraction(
      'autorizacionDenominacion',
      filePathOrUrl,
      AutorizacionDenominacionSchema,
      AUTORIZACION_DENOMINACION_EXTRACTION_INSTRUCTIONS
    );

    if (result && result.data) {
      const processed = postProcessAutorizacion(result.data as AutorizacionDenominacion);
      return { 
        success: true, 
        data: processed,
        modelUsed: result.modelUsed,
        costUsd: result.costUsd
      };
    }

    return { success: false, error: 'No data extracted' };
  } catch (error) {
    logExtractorError('autorizacionDenominacion', error instanceof Error ? error.message : String(error), filePathOrUrl);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during extraction'
    };
  }
}

function postProcessAutorizacion(data: AutorizacionDenominacion): AutorizacionDenominacion {
  const processed = { ...data };

  // Normalize empty strings to null
  Object.keys(processed).forEach(key => {
    const value = (processed as any)[key];
    if (typeof value === 'string') {
      (processed as any)[key] = normalizeEmptyToNull(value);
    }
  });

  // Validate CUD format (should start with A and be ~19 characters)
  if (processed.cud) {
    // Remove any spaces or special characters
    const cud = processed.cud.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (cud.startsWith('A') && cud.length >= 15) {
      processed.cud = cud;
    } else {
      console.warn(`[Autorización Denominación Extractor] Invalid CUD format: ${processed.cud}`);
    }
  }

  // Normalize dates to YYYY-MM-DD
  const monthNames: Record<string, string> = {
    'enero': '01', 'febrero': '02', 'marzo': '03', 'abril': '04',
    'mayo': '05', 'junio': '06', 'julio': '07', 'agosto': '08',
    'septiembre': '09', 'octubre': '10', 'noviembre': '11', 'diciembre': '12'
  };

  if (processed.fecha_autorizacion) {
    // Try DD/MM/YYYY format
    let dateMatch = processed.fecha_autorizacion.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dateMatch) {
      const [, day, month, year] = dateMatch;
      processed.fecha_autorizacion = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    } else {
      // Try "26 de marzo de 2021" format
      const spanishDateMatch = processed.fecha_autorizacion.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
      if (spanishDateMatch) {
        const [, day, monthName, year] = spanishDateMatch;
        const month = monthNames[monthName.toLowerCase()];
        if (month) {
          processed.fecha_autorizacion = `${year}-${month}-${day.padStart(2, '0')}`;
        }
      }
    }
  }

  return processed;
}

