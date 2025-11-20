import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { MODEL, validateModel, type GPT5Model } from '../model.js';
import { CompanyIdentitySchema } from '../schemas/mx/companyIdentity.js';
import { logExtractorError } from '../utils/logging.js';
import { withRetry } from '../utils/retry.js';

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
   - Extract legal representatives with strict authority analysis.
   - can_sign_contracts: TRUE only if explicit powers ("Poderes") are granted or role is "Apoderado" / "Representante Legal".
   - poder_scope: List specific powers (e.g., "Pleitos y Cobranzas", "Actos de Administración", "Actos de Dominio", "Títulos de Crédito").
   - joint_signature_required: Check if powers must be exercised jointly ("mancomunadamente") or individually ("indistintamente"). Set to null if not specified.

6. FOUNDING ADDRESS (HISTORICAL ONLY):
   - Extract the corporate domicile (domicilio social) mentioned in the deed as founding_address.
   - This is a HISTORICAL address. Do NOT label it as current.
   - Set country to "MX".
   - Use null for missing components.

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
    const ext = path.extname(fileUrl).toLowerCase();
    const isPdf = ext === '.pdf';
    const isImage = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext);

    if (!isPdf && !isImage) {
      throw new Error(`Unsupported file type: ${ext}. Only PDF and Images are supported.`);
    }

    if (isPdf) {
      console.log('Uploading PDF file...');
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
      const fileBuffer = fs.readFileSync(fileUrl);
      const base64Data = fileBuffer.toString('base64');
      const mimeType = ext === '.jpg' ? 'image/jpeg' : `image/${ext.substring(1)}`;
      inputItem = {
        type: 'input_image',
        image_url: `data:${mimeType};base64,${base64Data}`
      };
    }
  }

  try {
    const res = await withRetry(() =>
      client.responses.create({
        model,
        instructions: EXTRACTION_INSTRUCTIONS,
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
        if (trimmed === "" || trimmed === "/" || trimmed === "N/A" || trimmed === "--" || trimmed.toLowerCase() === "unknown") {
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
