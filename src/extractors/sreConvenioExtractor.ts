/**
 * Extractor for SRE Convenio de Extranjería
 * Foreign investment agreement registration with Secretaría de Relaciones Exteriores
 */

import { SREConvenioSchema, SRE_CONVENIO_EXTRACTION_INSTRUCTIONS } from '../schemas/mx/sreConvenio.js';
import { normalizeEmptyToNull } from '../kyc/validators.js';
import { logExtractorError } from '../utils/logging.js';
import { routeExtraction } from '../utils/modelRouter.js';
import type { SREConvenio } from '../kyc/types.js';

export interface SREConvenioExtractionResult {
  success: boolean;
  data?: SREConvenio;
  error?: string;
  modelUsed?: string;
  costUsd?: number;
}

export async function extractSREConvenio(filePathOrUrl: string): Promise<SREConvenioExtractionResult> {
  console.log('[SRE Convenio Extractor] Starting extraction...');
  console.log(`[SRE Convenio Extractor] File: ${filePathOrUrl}`);

  try {
    const result = await routeExtraction(
      'sreConvenio',
      filePathOrUrl,
      SREConvenioSchema,
      SRE_CONVENIO_EXTRACTION_INSTRUCTIONS
    );

    if (result && result.data) {
      const processed = postProcessSREConvenio(result.data as SREConvenio);
      return { 
        success: true, 
        data: processed,
        modelUsed: result.modelUsed,
        costUsd: result.costUsd
      };
    }

    return { success: false, error: 'No data extracted' };
  } catch (error) {
    logExtractorError('sreConvenio', error instanceof Error ? error.message : String(error), filePathOrUrl);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during extraction'
    };
  }
}

function postProcessSREConvenio(data: SREConvenio): SREConvenio {
  const processed = { ...data };

  // Normalize empty strings to null
  Object.keys(processed).forEach(key => {
    const value = (processed as any)[key];
    if (typeof value === 'string') {
      (processed as any)[key] = normalizeEmptyToNull(value);
    }
  });

  // Validate folio format (should be numeric, usually 11 digits)
  if (processed.folio) {
    const folio = processed.folio.replace(/\D/g, '');
    if (folio.length >= 8) {
      processed.folio = folio;
    } else {
      console.warn(`[SRE Convenio Extractor] Invalid folio format: ${processed.folio}`);
    }
  }

  // Normalize fecha_registro to YYYY-MM-DD
  if (processed.fecha_registro) {
    const dateMatch = processed.fecha_registro.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dateMatch) {
      const [, day, month, year] = dateMatch;
      processed.fecha_registro = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
  }

  return processed;
}

