import { CompanyIdentitySchema } from '../schemas/mx/companyIdentity.js';
import { logExtractorError } from '../utils/logging.js';
import { routeExtraction, ExtractionResult } from '../utils/modelRouter.js';

const EXTRACTION_INSTRUCTIONS = `
You are a strict KYC extractor for Mexican Acta Constitutiva (Incorporation Deeds).
Your job is to fill the CompanyIdentitySchema accurately using ONLY the information explicitly printed in the document.

GLOBAL HARDENING RULES:
- Never infer or generate data not clearly printed.
- If a field is not present, set to null. Do NOT use "N/A", "Unknown", "--", or empty strings.
- Normalize all dates to YYYY-MM-DD.

CRITICAL RFC RULE - READ CAREFULLY:
- RFC (Registro Federal de Contribuyentes) is ALMOST NEVER printed in an Acta Constitutiva.
- RFC is assigned by SAT (Servicio de Administración Tributaria) AFTER the company is incorporated.
- The Acta Constitutiva is created BEFORE the company has an RFC.
- DO NOT calculate or invent RFC from company name + incorporation date.
- DO NOT generate RFC in the format [3 letters][6 digits][3 chars] based on company initials and date.
- RFC must be set to NULL unless you see the exact phrase "RFC:" or "Registro Federal de Contribuyentes:" followed by the actual RFC number explicitly printed in the document.
- If you are tempted to "fill in" the RFC based on the company name and date, STOP - set it to null instead.
- The only exception is reformation/modification deeds that reference an existing RFC.

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
   - can_sign_contracts: TRUE ONLY if the person is explicitly designated as "Apoderado" (general or special) AND has explicit powers to sign contracts (typically UNRESTRICTED Actos de Administración or Actos de Dominio).
   - If someone is ONLY listed as "Secretario", "Comisario", "Vocal", or "Consejo" WITHOUT an explicit "Apoderado" designation, set can_sign_contracts to FALSE.
   
   - LIMITED POWERS RULE (CRITICAL):
     * If "Actos de Administración" contains limiting words like "limitado", "solo", "únicamente", "exclusivamente", or specifies a narrow scope (e.g., "limitado a trámites fiscales", "solo ante SAT"), then SET can_sign_contracts to FALSE.
     * "Pleitos y Cobranzas" alone is NOT enough to sign contracts.
     * "Poder Especial" for specific procedures (e.g., "gestiones administrativas") is NOT enough to sign general commercial contracts.
     * To sign contracts, they need FULL/GENERAL Actos de Administración or Actos de Dominio.
   
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

8. COMISARIOS (STATUTORY EXAMINERS) - CRITICAL:
   - Mexican S.A. companies MUST have a Comisario (per Ley General de Sociedades Mercantiles Art. 164-171).
   - The Comisario is a supervisory/audit role, NOT a signing authority.
   - Look for phrases like: "Se designa como Comisario a...", "Comisario Propietario:", "Comisario Suplente:".
   - Extract:
     * name: Full name of the Comisario
     * tipo: "PROPIETARIO" (primary) or "SUPLENTE" (alternate/backup)
     * appointment_date: Date appointed (usually same as incorporation date)
     * is_active: true (unless explicitly replaced in a later modification)
   - The Comisario is typically found in the section about corporate governance or officer appointments.
   - DO NOT confuse Comisario with Administrador or Apoderado - they have different roles:
     * Administrador/Apoderado = Can sign contracts and represent the company
     * Comisario = Supervises management, reviews financials, reports to shareholders (CANNOT sign contracts)

9. CAPITAL SOCIAL (SHARE CAPITAL):
   - Extract the capital structure:
     * total_amount: Total capital in MXN (e.g., 50000 for "CINCUENTA MIL PESOS")
     * currency: "MXN"
     * fixed_capital: Fixed portion if S.A. de C.V. (capital fijo)
     * variable_capital: Variable portion if S.A. de C.V. (capital variable)
     * total_shares: Total number of shares
     * share_par_value: Value per share (total_amount / total_shares)
   - Look for phrases like: "Capital social de...", "dividido en ... acciones", "con un valor nominal de..."
   - Convert text numbers to digits (e.g., "CINCUENTA MIL PESOS" = 50000)

10. MODIFICATIONS:
   - List any capital changes, management changes, Comisario changes, or bylaws amendments mentioned in the document.
   - If a Comisario is replaced, note the old and new Comisario names.

Do not invent information. Return strictly valid JSON matching the schema.
`;

export async function extractCompanyIdentity(fileUrl: string): Promise<any> {
  console.log(`Extracting deep legal KYC from Acta Constitutiva using Router (Gemini default)`);
  console.log(`Processing file: ${fileUrl}`);

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
    // Route extraction through ModelRouter
    const result: ExtractionResult = await routeExtraction('acta', fileUrl, CompanyIdentitySchema, INSTRUCTIONS_WITH_LIMITS);
    const data = result.data;
    
    // Extract company_identity if nested (Gemini returns flat structure)
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

    // CRITICAL: RFC HALLUCINATION PREVENTION
    // Gemini often invents/calculates RFC from company name + date even when instructed not to.
    // RFC is RARELY printed in Acta Constitutiva - it comes from SAT registration AFTER incorporation.
    // We MUST force RFC to null unless we have high confidence it was explicitly found.
    // 
    // A "calculated" RFC follows the pattern: [First 3 letters of name] + [YYMMDD of incorporation] + [3 char homoclave]
    // If the RFC matches this pattern AND matches the company name/date, it was likely hallucinated.
    if (normalizedIdentity.rfc) {
      const rfc = normalizedIdentity.rfc.toUpperCase().trim();
      const razonSocial = (normalizedIdentity.razon_social || '').toUpperCase();
      const incDate = normalizedIdentity.incorporation_date;
      
      // Check if RFC looks like it was calculated from company name + date
      // Pattern: 3 letters (company initials) + 6 digits (YYMMDD) + 3 chars (homoclave)
      const rfcMatch = rfc.match(/^([A-Z]{3})(\d{6})([A-Z0-9]{3})$/);
      if (rfcMatch && incDate) {
        const rfcInitials = rfcMatch[1];
        const rfcDatePart = rfcMatch[2];
        
        // Extract initials from company name (first letter of first 3 significant words)
        const words = razonSocial.split(/\s+/).filter((w: string) => 
          w.length > 2 && !['DE', 'LA', 'EL', 'LOS', 'LAS', 'SA', 'SC', 'CV', 'SAPI', 'SAS'].includes(w)
        );
        const calculatedInitials = words.slice(0, 3).map((w: string) => w[0]).join('');
        
        // Extract date from incorporation_date (YYYY-MM-DD -> YYMMDD)
        const dateParts = incDate.split('-');
        if (dateParts.length === 3) {
          const calculatedDatePart = dateParts[0].slice(2) + dateParts[1] + dateParts[2];
          
          // If RFC initials match calculated initials AND date matches, it was likely hallucinated
          if (rfcInitials === calculatedInitials && rfcDatePart === calculatedDatePart) {
            console.log(`[RFC HALLUCINATION DETECTED] RFC "${rfc}" appears to be calculated from company name "${razonSocial}" and date "${incDate}". Setting to null.`);
            normalizedIdentity.rfc = null;
          }
        }
      }
      
      // Additional check: RFC should NOT be in Acta unless it's a reformation/modification deed
      // For new incorporations, RFC doesn't exist yet - it's assigned by SAT after registration
      // If this is an original constitution (not a reformation), RFC should be null
      const isOriginalConstitution = !normalizedIdentity.modifications || normalizedIdentity.modifications.length === 0;
      if (isOriginalConstitution && normalizedIdentity.rfc) {
        // For original constitutions, RFC is almost never present
        // Only keep it if it's clearly NOT calculated (different pattern)
        console.log(`[RFC WARNING] Original constitution deed should not contain RFC. Verify if "${normalizedIdentity.rfc}" was explicitly printed.`);
      }
    }

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

    // Attach modelUsed and costUsd to the result object if needed, but the current return type is any (Schema).
    // The calling function (mcp/server.ts) expects just the payload.
    // However, we might want to attach metadata.
    // For now, return the payload. The metrics in modelRouter handle the logging/cost tracking.
    // If we need to pass modelUsed up, we might need to change the return type.
    // But the instructions say "modelUsed logged".
    
    // Add hidden properties for tracking if possible, or just rely on side-effects?
    // The prompt says "Record modelUsed per doc and add to Run model mix".
    // This implies we need to pass it back.
    // Let's attach it as a non-enumerable property or just a property if the schema allows extra props?
    // Schema usually forbids extra props.
    // But we are returning `any` here.
    
    (normalizedIdentity as any)._metadata = {
        modelUsed: result.modelUsed,
        costUsd: result.costUsd
    };

    return normalizedIdentity;

  } catch (error) {
    logExtractorError("acta", fileUrl, error);
    if (error instanceof Error) {
      throw new Error(`Acta Constitutiva extraction failed: ${error.message}`);
    }
    throw error;
  }
}

