import { BankTransactionListSchema } from '../schemas/mx/bankTransaction.js';
import { normalizeEmptyToNull, sanitizeDate, sanitizeCurrency } from '../kyc/validators.js';
import { logExtractorError } from '../utils/logging.js';
import { routeExtraction, ExtractionResult } from '../utils/modelRouter.js';

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
  console.log(`Extracting Bank Transactions using Router (Gemini default)`);
  console.log(`Processing file: ${fileUrl}`);

  try {
    // Route extraction through ModelRouter
    const result: ExtractionResult = await routeExtraction('bank_statement.transactions', fileUrl, BankTransactionListSchema, EXTRACTION_INSTRUCTIONS);
    const data = result.data;
    
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

    // Attach metadata
    (normalizedData as any)._metadata = {
        modelUsed: result.modelUsed,
        costUsd: result.costUsd
    };

    return normalizedData;

  } catch (error) {
    logExtractorError("bank_statement_transactions", fileUrl, error);
    if (error instanceof Error) {
      throw new Error(`Bank Transaction extraction failed: ${error.message}`);
    }
    throw error;
  }
}
