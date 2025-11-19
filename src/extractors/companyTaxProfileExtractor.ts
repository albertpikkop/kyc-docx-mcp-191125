import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { MODEL, validateModel, type GPT5Model } from '../model.js';
import { sanitizeRfc } from '../utils/sanitize.js';

/**
 * Schema for SAT Constancia (Company Tax Profile)
 * Extracts only what is visible on the document without assumptions
 */
const COMPANY_TAX_PROFILE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    company_name: { type: "string", description: "Razón Social (Company Name)", nullable: true },
    rfc: { type: "string", description: "RFC (Registro Federal de Contribuyentes)", nullable: true },
    tax_regime: { type: "string", description: "Régimen Fiscal (Tax Regime)", nullable: true },
    address: { type: "string", description: "Domicilio Fiscal (Tax Address)", nullable: true },
    status: { type: "string", description: "Estatus (Status)", nullable: true },
    issue_date: { type: "string", description: "Fecha de Emisión (Issue Date)", nullable: true },
    expiration_date: { type: "string", description: "Fecha de Vigencia (Expiration Date)", nullable: true }
  },
  required: [
    "company_name", "rfc", "tax_regime", "address", "status", 
    "issue_date", "expiration_date"
  ]
};

/**
 * Extracts company tax profile data from a SAT Constancia PDF.
 * Uses GPT-5.1 vision capabilities to extract only visible data without assumptions.
 * 
 * @param filePath - The absolute path to the Constancia PDF file
 * @returns The parsed JSON object matching CompanyTaxProfileSchema
 */
export async function extractCompanyTaxProfile(filePath: string): Promise<any> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set in environment variables');
  }
  
  const client = new OpenAI({ apiKey });
  const model: GPT5Model = validateModel(MODEL);

  console.log(`Extracting company tax profile using model: ${model}`);
  console.log(`Processing file: ${filePath}`);

  // Detect file type
  const ext = path.extname(filePath).toLowerCase();
  const isPdf = ext === '.pdf';
  const isImage = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext);

  if (!isPdf && !isImage) {
    throw new Error(`Unsupported file type: ${ext}. Only PDF and Images are supported.`);
  }

  let inputItem: any;

  if (isPdf) {
    // Use input_file for PDFs via upload
    console.log('Uploading PDF file...');
    const fileStream = fs.createReadStream(filePath);
    const uploadedFile = await client.files.create({
      file: fileStream,
      purpose: 'assistants',
    });
    
    inputItem = {
      type: 'input_file',
      file_id: uploadedFile.id,
    };
  } else {
    // Use input_image for Images with Data URL
    const fileBuffer = fs.readFileSync(filePath);
    const base64Data = fileBuffer.toString('base64');
    const mimeType = ext === '.jpg' ? 'image/jpeg' : `image/${ext.substring(1)}`;
    inputItem = {
      type: 'input_image',
      image_url: `data:${mimeType};base64,${base64Data}`
    };
  }

  try {
    const res = await client.responses.create({
      model,
      input: [
        {
          role: 'user',
          content: [inputItem]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "company_tax_profile",
          strict: true,
          schema: COMPANY_TAX_PROFILE_SCHEMA
        },
      },
    } as any);

    const outputItem = res.output?.[0] as any;
    const content = outputItem?.content?.[0]?.text || (res as any).output_text;

    if (!content) {
      throw new Error('No content received from model');
    }

    const data = JSON.parse(content);

    // Sanitize RFC field
    if (data.rfc) {
      data.rfc = sanitizeRfc(data.rfc);
    }

    return data;

  } catch (error) {
    console.error('Extraction failed:', error);
    throw error;
  }
}


