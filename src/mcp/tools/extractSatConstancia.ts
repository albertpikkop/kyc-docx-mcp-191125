/**
 * MCP Tool: extract_sat_constancia
 * 
 * PURPOSE: Extract tax profile from SAT Constancia de Situación Fiscal.
 * LOGIC: All extraction logic lives HERE, not in Claude.
 * 
 * Claude's job: Call this tool with file path, present results.
 * This tool's job: AI extraction with strict schema, return structured data.
 */

import { CompanyTaxProfileSchema } from '../../schemas/mx/companyTaxProfile.js';
import { routeExtraction, ExtractionResult } from '../../utils/modelRouter.js';

const EXTRACTION_INSTRUCTIONS = `
You are a strict KYC extractor for Mexican SAT Constancia de Situación Fiscal.
Extract ONLY information explicitly printed in the document.

EXTRACT:
1. RFC (Registro Federal de Contribuyentes)
2. Razón Social (legal name)
3. Régimen Fiscal (tax regime)
4. Status: ACTIVO or INACTIVO
5. Fiscal Address (full breakdown: street, number, colonia, CP, city, state)
6. Economic Activities (array with descriptions and percentages)
7. Tax Obligations (array)
8. Issue date and place

RULES:
- If a field is not present, set to null
- Normalize dates to YYYY-MM-DD
- Do NOT infer or calculate data
- Status must be exactly "ACTIVO" or "INACTIVO"

Return strictly valid JSON matching the schema.
`;

export interface ExtractSatResult {
  success: boolean;
  data: {
    rfc: string;
    razon_social: string;
    tax_regime: string;
    status: string;
    fiscal_address: any;
    economic_activities: any[];
    tax_obligations: any[];
    issue_date: string | null;
    issue_place: string | null;
  };
  model_used: string;
  cost_usd: number;
  extraction_timestamp: string;
}

/**
 * MAIN TOOL FUNCTION
 */
export async function extractSatConstancia(file_path: string): Promise<ExtractSatResult> {
  console.log(`[extract_sat_constancia] Processing: ${file_path}`);
  
  try {
    const result: ExtractionResult = await routeExtraction(
      'sat_constancia',
      file_path,
      CompanyTaxProfileSchema,
      EXTRACTION_INSTRUCTIONS
    );
    
    const data = result.data.company_tax_profile || result.data;
    
    return {
      success: true,
      data: {
        rfc: data.rfc || null,
        razon_social: data.razon_social || null,
        tax_regime: data.tax_regime || null,
        status: data.status || null,
        fiscal_address: data.fiscal_address || null,
        economic_activities: data.economic_activities || [],
        tax_obligations: data.tax_obligations || [],
        issue_date: data.issue?.issue_date || null,
        issue_place: data.issue?.place_municipio || null,
      },
      model_used: result.modelUsed,
      cost_usd: result.costUsd,
      extraction_timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error(`[extract_sat_constancia] Error:`, error);
    throw error;
  }
}

export const EXTRACT_SAT_CONSTANCIA_TOOL = {
  name: 'extract_sat_constancia',
  description: `Extract tax profile from SAT Constancia de Situación Fiscal.
Returns RFC, company name, tax regime, status, fiscal address, and economic activities.
Claude should call this for the company's SAT document.`,
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Full path to the SAT Constancia PDF'
      }
    },
    required: ['file_path']
  }
};

