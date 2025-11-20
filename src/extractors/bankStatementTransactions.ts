import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { MODEL, validateModel, type GPT5Model } from '../model.js';
import { BankTransactionListSchema } from '../schemas/mx/bankTransaction.js';
import { normalizeEmptyToNull } from '../kyc/validators.js';

const EXTRACTION_INSTRUCTIONS = `
You are a strict KYC extractor for Mexican Bank Statements (Estados de Cuenta).
Your job is to extract the LIST of transactions (movimientos) from the statement.

GLOBAL HARDENING RULES:
- Never infer or generate data not clearly printed.
- If a field is not present, set to null. Do NOT use "N/A", "Unknown", "--", or empty strings.
- Normalize all dates to YYYY-MM-DD.
- Normalize amounts to numeric values.

EXTRACT:
- Date: YYYY-MM-DD.
- Direction: "debit" (cargo/retiro/salida) or "credit" (abono/depósito/entrada).
- Amount: Numeric.
- Currency: e.g. MXN.
- Description: The main transaction text (Concepto/Detalle).
- Counterparty: Extract from SPEI/transfer narrations. If not visible, set to null.
- Category: Classify based on description (e.g., "rent", "telecom", "cfe", "services", "unknown").

Rules:
- Never include running balances.
- Only return transactions printed on the statement.
- Focus on the "Movimientos" or "Detalle de Movimientos" section.
`;

/**
 * deterministic category normalization based on description keywords.
 * This overrides LLM variance to ensure consistency across documents.
 */
function normalizeTransactionCategory(description: string, llmCategory: string | null): string | null {
  const desc = description.toUpperCase();
  
  if (desc.includes("COMISION") || desc.includes("COMISIÓN") || desc.includes("TIMBRADO")) {
    return "fee";
  }
  if (desc.includes("IVA ")) {
    return "tax";
  }
  if (desc.includes("INTERES") || desc.includes("RENDIMIENTO")) {
    return "interest";
  }
  if (desc.includes("RENTA")) {
    return "rent";
  }
  if (desc.includes("TELMEX") || desc.includes("IZZI") || desc.includes("TOTALPLAY")) {
    return "telecom";
  }
  if (desc.includes("CFE") || desc.includes("ELECTRICIDAD")) {
    return "utilities";
  }
  if (desc.includes("SPEI") || desc.includes("TRASPASO")) {
    // If it's a transfer but hasn't matched specific types above, default to transfer
    return "transfer";
  }

  return llmCategory;
}

export async function extractBankStatementTransactions(fileUrl: string): Promise<any> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set in environment variables');
  }

  const client = new OpenAI({ apiKey });
  const model: GPT5Model = validateModel(MODEL);

  console.log(`Extracting Bank Transactions using model: ${model}`);
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
    const res = await client.responses.create({
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
          name: "bank_transactions",
          strict: true,
          schema: BankTransactionListSchema
        },
      },
    } as any);

    const outputItem = res.output?.[0] as any;
    const content = outputItem?.content?.[0]?.text || (res as any).output_text;

    if (!content) {
      throw new Error('No content received from model');
    }

    const data = JSON.parse(content);
    
    // Strict Post-processing using central validator
    const normalizedData = normalizeEmptyToNull(data);

    if (normalizedData.transactions && Array.isArray(normalizedData.transactions)) {
        normalizedData.transactions = normalizedData.transactions.map((tx: any) => ({
            ...tx,
            counterparty_name: tx.counterparty_name, // Already normalized by normalizeEmptyToNull
            category: normalizeTransactionCategory(tx.description || "", tx.category)
        }));
    }

    return normalizedData;

  } catch (error) {
    console.error('Extraction failed:', error);
    if (error instanceof Error) {
      throw new Error(`Bank Transaction extraction failed: ${error.message}`);
    }
    throw error;
  }
}
