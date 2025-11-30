/**
 * MCP Tool: extract_acta
 * 
 * PURPOSE: Extract ALL data from Acta Constitutiva using AI with strict schema.
 * LOGIC: All extraction logic and schema lives HERE, not in Claude.
 * 
 * CRITICAL: This tool extracts ALL facultades found in the document.
 * NOT limited to 10, 26, or any fixed number.
 * Each Acta may have different facultades - extract EVERY ONE.
 * 
 * Claude's job: Call this tool with file path, present results.
 * This tool's job: AI extraction with strict schema, return structured data.
 */

import { CompanyIdentitySchema } from '../../schemas/mx/companyIdentity.js';
import { routeExtraction, ExtractionResult } from '../../utils/modelRouter.js';

/**
 * EXTRACTION INSTRUCTIONS - ALL LOGIC HERE
 * 
 * CRITICAL RULE FOR FACULTADES:
 * - Extract EVERY facultad found in the document
 * - Do NOT limit to 10, 26, or any fixed number
 * - Each Acta may have different facultades - extract ALL of them
 * - Return the COMPLETE legal text of each facultad, not summaries
 */
const EXTRACTION_INSTRUCTIONS = `
You are a strict KYC extractor for Mexican Acta Constitutiva (Incorporation Deeds).
Your job is to fill the CompanyIdentitySchema accurately using ONLY the information explicitly printed in the document.

═══════════════════════════════════════════════════════════════════
 CRITICAL: EXTRACT ALL FACULTADES - NO FIXED LIMITS
═══════════════════════════════════════════════════════════════════

RULE: Extract EVERY facultad/power found in the document.
- Do NOT stop at 10 facultades
- Do NOT stop at 26 facultades  
- Do NOT stop at ANY fixed number
- If the document has 5 facultades, return 5
- If the document has 50 facultades, return 50
- Return the COMPLETE legal text of each facultad

For EACH legal representative/apoderado:
1. Scan the ENTIRE document from their name mention until:
   - The next apoderado clause begins, OR
   - A section break (ARTÍCULO, CAPÍTULO), OR
   - The start of annexes (SE, RPP, SAT documents)

2. Collect EVERY power phrase found:
   - Powers on the same page as the apoderado name
   - Powers on following pages (powers often span multiple pages!)
   - Powers in bullet points, numbered lists, commas, semicolons
   - General powers AND specific powers
   
3. Include in poder_scope array:
   - CANONICAL POWERS (the 4 main ones - check for ALL):
     * "Poder general para pleitos y cobranzas"
     * "Poder general para actos de administración" 
     * "Poder general para actos de dominio"
     * "Poder para otorgar y suscribir títulos de crédito"
   
   - SPECIAL POWERS (include ALL found):
     * "Poder para abrir y cancelar cuentas bancarias..."
     * "Poder para otorgar poderes generales o especiales..."
     * "Poder para gestiones ante dependencias gubernamentales..."
     * "Poder especial para trámites ante SAT..."
     * "Representación laboral..."
     * ANY OTHER POWER mentioned for this person
   
4. Use EXACT wording from the Acta for each facultad
   - Do NOT summarize
   - Do NOT truncate
   - Include the full legal phrase

═══════════════════════════════════════════════════════════════════
 GLOBAL HARDENING RULES
═══════════════════════════════════════════════════════════════════

- Never infer or generate data not clearly printed
- If a field is not present, set to null (NOT "N/A", "Unknown", "--", or "")
- Normalize all dates to YYYY-MM-DD

RFC RULE:
- RFC is ALMOST NEVER in Acta Constitutiva (assigned by SAT after incorporation)
- RFC must be NULL unless you see "RFC:" explicitly printed
- Do NOT calculate RFC from company name + date

═══════════════════════════════════════════════════════════════════
 DATA EXTRACTION SECTIONS
═══════════════════════════════════════════════════════════════════

1. SHAREHOLDERS:
   - Full names of initial shareholders
   - Number of shares and percentage (0-100 scale, e.g., 60 = 60%)
   - Share class (Serie A, Capital Fijo, etc.)
   - Beneficial owners (>25%)

2. CORPORATE PURPOSE (Objeto Social):
   - Extract as individual items, not free-form text

3. NOTARY INFORMATION:
   - Notary name, number, protocol number, date, location

4. PUBLIC REGISTRY OF COMMERCE (RPC):
   - FME, NCI, Unique Doc Number, City, Date

5. LEGAL REPRESENTATIVES - WITH ALL FACULTADES:
   - Distinguish: Socios vs Consejo vs Apoderados
   - can_sign_contracts: TRUE only if:
     * Explicitly designated as "Apoderado"
     * Has UNRESTRICTED Actos de Administración or Dominio
   - LIMITED POWERS: If "limitado", "solo", "únicamente" → can_sign_contracts = FALSE
   - poder_scope: List EVERY power (no limits!)
   - joint_signature_required: Check for "mancomunadamente" vs "indistintamente"

6. FOUNDING ADDRESS:
   - Historical address from deed (not current)
   - If only jurisdiction specified, set street details to null

7. GOVERNANCE:
   - Board type, quorum, voting, share transfer rules

8. COMISARIOS (CRITICAL):
   - Required for S.A. (LGSM Art. 164-171)
   - Supervisory role, NOT signing authority
   - Extract: name, tipo (PROPIETARIO/SUPLENTE), appointment_date

9. CAPITAL SOCIAL:
   - Total amount in MXN
   - Fixed vs Variable capital
   - Total shares, par value

10. MODIFICATIONS:
    - List any changes mentioned

═══════════════════════════════════════════════════════════════════
 PAGE RANGE INSTRUCTION
═══════════════════════════════════════════════════════════════════

- IGNORE annexes (SE, RPP, SAT) at the end
- ONLY extract from main Notarial Instrument
- But DO scan ALL pages of main instrument for powers (they span pages!)

Return strictly valid JSON matching the schema.
`;

export interface ExtractActaResult {
  success: boolean;
  data: any;
  model_used: string;
  cost_usd: number;
  extraction_timestamp: string;
  facultades_count: number; // How many total facultades extracted across all reps
}

/**
 * MAIN TOOL FUNCTION
 * 
 * Input: file_path (string) - Path to Acta PDF/image
 * Output: Structured CompanyIdentity with ALL facultades
 * 
 * Claude CANNOT modify extraction logic. Claude only calls and presents.
 */
export async function extractActa(file_path: string): Promise<ExtractActaResult> {
  console.log(`[extract_acta] Processing: ${file_path}`);
  
  try {
    // Route through AI extraction with strict schema
    const result: ExtractionResult = await routeExtraction(
      'acta', 
      file_path, 
      CompanyIdentitySchema, 
      EXTRACTION_INSTRUCTIONS
    );
    
    const data = result.data.company_identity || result.data;
    
    // Post-processing: Normalize and validate
    const normalized = normalizeExtraction(data);
    
    // Count total facultades extracted
    let facultadesCount = 0;
    if (Array.isArray(normalized.legal_representatives)) {
      for (const rep of normalized.legal_representatives) {
        if (Array.isArray(rep.poder_scope)) {
          facultadesCount += rep.poder_scope.length;
        }
      }
    }
    
    console.log(`[extract_acta] Extracted ${facultadesCount} total facultades`);
    
    return {
      success: true,
      data: normalized,
      model_used: result.modelUsed,
      cost_usd: result.costUsd,
      extraction_timestamp: new Date().toISOString(),
      facultades_count: facultadesCount
    };
    
  } catch (error) {
    console.error(`[extract_acta] Error:`, error);
    throw error;
  }
}

/**
 * Post-processing normalization - ALL LOGIC HERE
 */
function normalizeExtraction(data: any): any {
  // Deep normalize empty strings to null
  const normalizeValue = (value: any): any => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed === "" || trimmed === "/" || trimmed === "/null" || 
          trimmed === "N/A" || trimmed === "--" || trimmed.toLowerCase() === "unknown") {
        return null;
      }
      return trimmed;
    }
    return value;
  };
  
  const deepNormalize = (obj: any): any => {
    if (Array.isArray(obj)) {
      return obj.map(deepNormalize);
    } else if (obj !== null && typeof obj === 'object') {
      for (const key in obj) {
        obj[key] = deepNormalize(obj[key]);
      }
      return obj;
    } else {
      return normalizeValue(obj);
    }
  };
  
  const normalized = deepNormalize(data);
  
  // RFC hallucination prevention
  if (normalized.rfc) {
    const rfc = normalized.rfc.toUpperCase().trim();
    const razonSocial = (normalized.razon_social || '').toUpperCase();
    const incDate = normalized.incorporation_date;
    
    // Check if RFC looks calculated (pattern matching)
    const rfcMatch = rfc.match(/^([A-Z]{3})(\d{6})([A-Z0-9]{3})$/);
    if (rfcMatch && incDate) {
      const rfcDatePart = rfcMatch[2];
      const dateParts = incDate.split('-');
      if (dateParts.length === 3) {
        const calculatedDatePart = dateParts[0].slice(2) + dateParts[1] + dateParts[2];
        if (rfcDatePart === calculatedDatePart) {
          console.log(`[extract_acta] RFC hallucination detected, setting to null`);
          normalized.rfc = null;
        }
      }
    }
  }
  
  // Recalculate equity percentages if needed
  if (Array.isArray(normalized.shareholders)) {
    let totalShares = 0;
    let totalPercentage = 0;
    let hasRawShares = true;
    
    for (const s of normalized.shareholders) {
      if (typeof s.shares === 'number') {
        totalShares += s.shares;
      } else {
        hasRawShares = false;
      }
      if (typeof s.percentage === 'number') {
        totalPercentage += s.percentage;
      }
    }
    
    if (hasRawShares && totalShares > 0 && Math.abs(totalPercentage - 100) > 1) {
      normalized.shareholders = normalized.shareholders.map((s: any) => ({
        ...s,
        percentage: Math.round((s.shares / totalShares) * 10000) / 100
      }));
    }
  }
  
  // Ensure country is MX
  if (normalized.founding_address) {
    normalized.founding_address.country = "MX";
  }
  
  return normalized;
}

/**
 * Tool definition for MCP registration
 */
export const EXTRACT_ACTA_TOOL = {
  name: 'extract_acta',
  description: `Extract ALL data from an Acta Constitutiva (Incorporation Deed) using AI.
CRITICAL: Extracts ALL facultades found - no fixed limits.
Returns structured company identity, shareholders, legal representatives with complete powers.
Claude should call this for each Acta document (original + modifications).`,
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Full path to the Acta PDF or image file'
      }
    },
    required: ['file_path']
  }
};

