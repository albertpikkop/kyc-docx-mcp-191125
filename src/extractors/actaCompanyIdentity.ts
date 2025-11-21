import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { MODEL, validateModel, type GPT5Model } from '../model.js';
import { CompanyIdentitySchema } from '../schemas/mx/companyIdentity.js';
import { normalizeEmptyToNull, sanitizeRfc } from '../kyc/validators.js';
import { withRetry } from '../utils/retry.js';
import { logExtractorError } from '../utils/logging.js';
import { optimizeDocument } from '../utils/documentOptimizer.js';

const EXTRACTION_INSTRUCTIONS = `
You are a strict KYC extractor for Mexican Acta Constitutiva (Incorporation Deeds).
Your job is to fill the CompanyIdentitySchema accurately using ONLY the information explicitly printed in the document.

GLOBAL HARDENING RULES:
- Never infer or generate data not clearly printed.
- If a field is not present, set to null. Do NOT use "N/A", "Unknown", "--", or empty strings.
- Normalize all dates to YYYY-MM-DD.
- RFC must remain null unless strictly printed inside the Acta. Do NOT invent it.

EXTRACT THE FOLLOWING DEEP KYC DATA:

1. SHAREHOLDERS:
   - Extract full names of initial shareholders (socios/accionistas).
   - Extract number of shares and percentage of ownership (calculate only if explicitly clear from the text).
   - Use 0-100 scale for percentages (e.g. 60 = 60%, 0.5 = 0.5%). Never use 0-1 scale (decimals).
   - Identify beneficial owners (usually >25% or control).
   - Capture share class (e.g., "Serie A", "Capital Fijo").

2. CORPORATE PURPOSE (Objeto Social):
   - Extract the list of business activities allowed as individual items.
   - Do not dump free-form text; separate into clear activities.

3. NOTARY INFORMATION:
   - Notary name, notary number, protocol number (Escritura No.), protocol date (YYYY-MM-DD), and office location.

4. PUBLIC REGISTRY OF COMMERCE (RPC):
   - Extract structured data: FME, NCI, Unique Doc Number, Registration City, Registration Date.
   - Do not guess; if a field is missing, return null.

5. REPRESENTATION POWERS:
   - CRITICAL: Distinguish between three separate concepts:
     a) Socios/Accionistas (shareholders/owners) - NO powers unless also listed as Apoderados
     b) Consejo de Administración (governing board) - may have powers as a body, but individual members need explicit apoderado designation
     c) Apoderados (legal representatives with powers) - these are the ones who can sign contracts
   
   - Extract legal representatives with STRICT authority analysis:
   - can_sign_contracts: TRUE ONLY if the person is explicitly designated as "Apoderado" (general or special) AND explicit powers are granted in their clause.
   - If someone is ONLY listed as "Secretario", "Comisario", "Vocal", or "Consejo" WITHOUT an explicit "Apoderado" designation, set can_sign_contracts to FALSE.
   
   - CRITICAL MULTI-PAGE POWER EXTRACTION:
     * Powers for each apoderado may be spread across MULTIPLE PAGES or separated by line breaks.
     * You MUST scan the ENTIRE main Notarial Instrument (all pages before annexes) to find ALL power phrases that belong to the SAME apoderado clause.
     * An apoderado clause typically starts with "Se otorga poder a [Name]" or "[Name] queda facultado" or "Se faculta a [Name]" and continues until:
       - The next apoderado clause begins (e.g., "Se otorga poder a [Another Name]"), OR
       - A section break (e.g., "ARTÍCULO", "CAPÍTULO"), OR
       - The end of the powers section, OR
       - The start of annexes (Secretaría de Economía, RPP, SAT)
     * CRITICAL: You MUST search for ALL FOUR canonical powers for EACH apoderado, even if they appear on different pages:
       - "Pleitos y Cobranzas" or "pleitos y cobranzas" (may also appear as "Poder general para pleitos y cobranzas")
       - "Actos de Administración" or "actos de administración" (may appear as "Poder general para actos de administración" or "facultades de administración")
       - "Actos de Dominio" or "actos de dominio" (may appear as "Poder general para actos de dominio" or "facultades de dominio")
       - "Títulos de Crédito" or "títulos de crédito" (may appear as "Poder para otorgar y suscribir títulos de crédito" or "facultad para títulos de crédito")
     * These four canonical powers are ESSENTIAL - if ANY apoderado has all four, they have FULL powers.
     * DO NOT stop scanning after finding 1-2 powers - continue reading ALL pages until you have found all four canonical powers OR reached the end of that apoderado's clause.
     * If powers are listed in a bulleted format, numbered lists, or separated by commas/semicolons across pages, include ALL of them.
     * Also collect any other specific powers mentioned (e.g., "gestiones fiscales", "apertura de cuentas bancarias", "representación laboral", "otorgar poderes")
   
   - poder_scope: List ALL powers granted in the Acta clause for THIS person, combining phrases from all pages:
     * Include every power phrase you find, even if they appear on different pages
     * Use the exact wording from the Acta (e.g., "Pleitos y cobranzas", "Actos de administración", "Actos de dominio", "Títulos de crédito")
     * If the same power is mentioned multiple times, include it once
     * If powers are listed as "Poder general para..." followed by specific items, include both the general phrase and the specific items
   
   - IMPORTANT: If the Acta explicitly labels someone as "apoderado especial" or "apoderado limitado", include that label in poder_scope.
   - If the Acta labels someone as "apoderado general" AND grants all four canonical powers (even if spread across pages), include all four in poder_scope.
   - joint_signature_required: Check if powers must be exercised jointly ("mancomunadamente") or individually ("indistintamente"). Set to null if not specified.

6. FOUNDING ADDRESS (HISTORICAL ONLY):
   - Extract the corporate domicile (domicilio social) mentioned in the deed as founding_address.
   - This is a HISTORICAL address. Do NOT label it as current.
   - CRITICAL: If the Acta only specifies a jurisdiction (e.g., "Ciudad de México") without street-level details:
     * Set street, ext_number, int_number, colonia, and cp to null
     * Only populate municipio and estado if explicitly stated
   - If the Acta provides a full street address, extract all components.
   - Set country to "MX".
   - Use null for missing components. Do NOT use "/null" or "N/A" strings.

7. GOVERNANCE:
   - Board type: "Administrador Único" or "Consejo de Administración".
   - Quorum/Voting: Summarize rules if stated.
   - Share transfer: Summarize restrictions (e.g., "derecho de tanto").

8. MODIFICATIONS:
   - List any capital changes, management changes, or bylaws amendments mentioned in the document.

Do not invent information. Return strictly valid JSON matching the schema.
`;

export async function extractCompanyIdentity(fileUrl: string): Promise<any> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set in environment variables');
  }

  const client = new OpenAI({ apiKey });
  const model: GPT5Model = validateModel(MODEL);

  console.log(`Extracting deep legal KYC from Acta Constitutiva using model: ${model}`);
  console.log(`Processing file: ${fileUrl}`);

  const isUrl = fileUrl.startsWith('http://') || fileUrl.startsWith('https://') || fileUrl.startsWith('data:');

  let inputItem: any;

  if (isUrl) {
    inputItem = {
      type: 'input_image',
      image_url: fileUrl
    };
  } else {
    // Optimize document before sending to OpenAI
    const optimizedResults = await optimizeDocument(fileUrl);
    const optimized = optimizedResults[0];

    // Check if optimization failed (fallback)
    if (!optimized.success || optimized.isFallback) {
        console.warn(`Optimization failed for ${fileUrl}. Uploading raw PDF file to OpenAI.`);
        
        // FALLBACK: Upload original PDF file
        console.log('Uploading raw PDF file...');
        const fileStream = fs.createReadStream(fileUrl);
        const uploadedFile = await client.files.create({
            file: fileStream,
            purpose: 'assistants',
        });
        
        inputItem = {
            type: 'input_file',
            file_id: uploadedFile.id,
        };
    } else {
        // Success: Use optimized image
        const base64Data = optimized.buffer!.toString('base64');
        inputItem = {
            type: 'input_image',
            image_url: `data:${optimized.mimeType};base64,${base64Data}`
        };
    }
  }

  // --- PAGE RANGE LIMIT FOR DEMO MODE ---
  // To prevent reading annex pages (RPP, SE) as part of the Acta, we explicitly prompt the model
  // to ignore pages after the notary signature block if detected, or we rely on the instruction.
  // However, a cleaner way (as requested) is to enforce this in the instruction if we can't split the PDF easily.
  // Since we are sending the full file, we must instruct the model strictly.
  
  const INSTRUCTIONS_WITH_LIMITS = EXTRACTION_INSTRUCTIONS + `
  
  CRITICAL PAGE RANGE INSTRUCTION:
  - This document may contain appended annexes (Secretaría de Economía, RPP, SAT) at the end.
  - IGNORE these annexes for the "Founding Address" and "Legal Representatives".
  - ONLY extract data from the main Notarial Instrument (the first section signed by the Notary).
  - If the main deed does not specify a street/number address (only "Ciudad de México"), return null for street/number. DO NOT use addresses found in the annexes.
  
  CRITICAL MULTI-PAGE POWER EXTRACTION:
  - Powers for each apoderado may be spread across MULTIPLE PAGES within the main Notarial Instrument.
  - You MUST scan ALL pages of the main Notarial Instrument (before annexes) to find COMPLETE power clauses.
  - When extracting powers for an apoderado:
    * Start from where the apoderado is first mentioned (e.g., "Se otorga poder a [Name]" or "[Name] queda facultado")
    * Continue scanning forward through ALL subsequent pages until you reach:
      - The next apoderado clause, OR
      - The end of the powers section, OR
      - The start of annexes (Secretaría de Economía, RPP, SAT)
    * Collect ALL power phrases from this entire multi-page clause, including:
      - Powers mentioned on the same page as the apoderado name
      - Powers mentioned on following pages before the next apoderado
      - Powers listed in bullet points, numbered lists, or separated by commas/semicolons
    * DO NOT stop reading after the first page - the complete power list may continue on page 2, 3, etc.
  - Example: If "Ashish Punj" is mentioned as apoderado on page 5, and powers are listed on pages 5, 6, and 7, you must include ALL powers from pages 5-7 in his poder_scope array.
  - The poder_scope array should contain EVERY power phrase found across all pages for that person.
  `;

  try {
    const res = await withRetry(() =>
      client.responses.create({
        model,
        instructions: INSTRUCTIONS_WITH_LIMITS,
        input: [
          {
            role: 'user',
            content: [inputItem]
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "company_identity",
            strict: true,
            schema: CompanyIdentitySchema
          },
        },
      } as any)
    );

    const outputItem = res.output?.[0] as any;
    const content = outputItem?.content?.[0]?.text || (res as any).output_text;

    if (!content) {
      throw new Error('No content received from model');
    }

    const data = JSON.parse(content);
    
    // Extract company_identity if nested
    const identity = data.company_identity || data;

    // Strict Post-processing: Normalize empty strings to null
    const normalizeEmptyToNull = (value: any): any => {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed === "" || trimmed === "/" || trimmed === "/null" || trimmed === "N/A" || trimmed === "--" || trimmed.toLowerCase() === "unknown") {
          return null;
        }
        return trimmed;
      }
      return value;
    };

    // Recursive function to normalize entire object
    const deepNormalize = (obj: any): any => {
        if (Array.isArray(obj)) {
            return obj.map(deepNormalize);
        } else if (obj !== null && typeof obj === 'object') {
            for (const key in obj) {
                obj[key] = deepNormalize(obj[key]);
            }
            return obj;
        } else {
            return normalizeEmptyToNull(obj);
      }
    };

    // Apply normalization to the entire identity object
    const normalizedIdentity = deepNormalize(identity);

    // Correct equity percentages if shares are present and percentages seem off (like 50.5% instead of 100%)
    if (Array.isArray(normalizedIdentity.shareholders)) {
        let totalShares = 0;
        let totalPercentage = 0;
        let hasRawShares = true;
        
        for (const s of normalizedIdentity.shareholders) {
            if (typeof s.shares === 'number') {
                totalShares += s.shares;
            } else {
                hasRawShares = false;
            }
            if (typeof s.percentage === 'number') {
                totalPercentage += s.percentage;
            }
        }

        // Recalculate if we have raw shares and total percentage is suspiciously low (e.g. ~50%) or not ~100%
        if (hasRawShares && totalShares > 0 && Math.abs(totalPercentage - 100) > 1) {
             console.log(`Refining equity percentages based on raw shares. Old Total: ${totalPercentage}%, Shares Total: ${totalShares}`);
             normalizedIdentity.shareholders = normalizedIdentity.shareholders.map((s: any) => {
                const calculatedPct = (s.shares / totalShares) * 100;
                // Keep 2 decimal places
                const refinedPct = Math.round(calculatedPct * 100) / 100;
                return {
                    ...s,
                    percentage: refinedPct
                };
             });
        }
    }

    // Ensure country is set to "MX" for founding_address if not null
    if (normalizedIdentity.founding_address) {
      normalizedIdentity.founding_address.country = "MX";
    }

    // Ensure RFC is explicitly strictly handled (though normalization handles strict nulls)
    // Double check logic for specific fields if needed

    // Re-apply logical derivations for legal representatives (can_sign_contracts)
    if (Array.isArray(normalizedIdentity.legal_representatives)) {
       normalizedIdentity.legal_representatives = normalizedIdentity.legal_representatives.map((rep: any) => {
         // Ensure can_sign_contracts is consistent
         let canSignContracts = rep.can_sign_contracts;
         if (canSignContracts === undefined || canSignContracts === null) {
            // Fallback logic: if has_poder is true, assume signing rights unless specified otherwise
            canSignContracts = rep.has_poder === true; 
         }
         return {
         ...rep,
           can_sign_contracts: canSignContracts,
           poder_scope: rep.poder_scope,
         };
       });
    }

    return normalizedIdentity;

  } catch (error) {
    logExtractorError("acta", fileUrl, error);
    if (error instanceof Error) {
      throw new Error(`Acta Constitutiva extraction failed: ${error.message}`);
    }
    throw error;
  }
}
