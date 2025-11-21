import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { MODEL, validateModel, type GPT5Model } from '../model.js';
import { BankTransactionListSchema } from '../schemas/mx/bankTransaction.js';
import { normalizeEmptyToNull, sanitizeDate, sanitizeCurrency } from '../kyc/validators.js';
import { withRetry } from '../utils/retry.js';
import { logExtractorError } from '../utils/logging.js';
import { optimizeDocument } from '../utils/documentOptimizer.js';

const EXTRACTION_INSTRUCTIONS = `
You are a strict KYC extractor for Mexican Bank Statements (Estados de Cuenta).
Your job is to extract the LIST of transactions (movimientos) from the statement.

GLOBAL HARDENING RULES:
- Never infer or generate data not clearly printed.
- If a field is not present, set to null. Do NOT use "N/A", "Unknown", "--", or empty strings.
- Normalize all dates to YYYY-MM-DD.
- Normalize amounts to numeric values.
- Currency: Assume "MXN" for Mexican documents unless the document explicitly uses "USD", "US$", "DÓLARES", or "DLS", in which case set to "USD". Never treat "$" alone as USD; in this context "$" means pesos (MXN).

EXTRACT:
- Date: YYYY-MM-DD.
- Direction: "debit" (cargo/retiro/salida) or "credit" (abono/depósito/entrada).
- Amount: Numeric.
- Currency: e.g. MXN or USD.
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
    // Optimize document before sending to OpenAI
    const optimizedResults = await optimizeDocument(fileUrl);
    
    // Check if optimization failed (fallback)
    // Since optimizeDocument returns an array, check the first item or if array is empty/fallback
    const firstResult = optimizedResults[0];
    
    if (!firstResult || !firstResult.success || firstResult.isFallback) {
        console.warn(`Optimization failed for ${fileUrl}. Uploading raw PDF file to OpenAI.`);
        
        // FALLBACK: Upload original PDF file (Not ideal for transactions as Vision is better, but better than crash)
        // Note: Vision API cannot take a file_id for PDF content. We must use the 'file_search' or 'assistants' approach if falling back.
        // However, for Chat Completions, we can't easily mix file_id for text extraction unless using a different model or tool.
        // BUT, GPT-4o can read PDFs if uploaded? No, only Assistants API.
        // Chat Completions API needs images for vision.
        // IF we fallback here, we might need to skip transaction extraction or error out gracefully.
        // Let's throw an error here because transactions via Vision really need images.
        
        throw new Error(`Optimization failed for Bank Transactions. Cannot convert PDF to images for Vision API.`);
        
    } else {
        // Success: Use optimized images
        // Send up to 3 pages
        const maxPages = 3;
        const pagesToSend = optimizedResults.slice(0, maxPages).map(opt => ({
            type: 'image_url',
            image_url: {
                url: `data:${opt.mimeType};base64,${opt.buffer!.toString('base64')}`
            }
        }));
        
        inputItem = pagesToSend; 
    }
  }

  try {
    // Construct input content based on whether we have multiple pages (array) or single
    // Note: inputItem here is either a single object (if URL) or an array of image objects (if local file)
    // We need to handle this carefully to match the API expectation.
    
    let content: any[];
    
    if (Array.isArray(inputItem)) {
        content = inputItem;
    } else {
        // URL case (single image)
        content = [{
            type: 'image_url',
            image_url: { url: inputItem.image_url }
        }];
    }

    const res = await withRetry(() =>
      client.responses.create({
        model,
        instructions: EXTRACTION_INSTRUCTIONS,
        input: [
          {
            role: 'user',
            content: content
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
      } as any)
    );

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
            // Ensure date is valid
            date: sanitizeDate(tx.date),
            // Ensure amount is positive absolute
            amount: Math.abs(tx.amount),
            // Ensure currency is valid
            currency: sanitizeCurrency(tx.currency) || "MXN",
            counterparty_name: tx.counterparty_name, // Already normalized by normalizeEmptyToNull
            category: normalizeTransactionCategory(tx.description || "", tx.category)
        }));
    }

    return normalizedData;

  } catch (error) {
    logExtractorError("bank_statement_transactions", fileUrl, error);
    if (error instanceof Error) {
      throw new Error(`Bank Transaction extraction failed: ${error.message}`);
    }
    throw error;
  }
}
