export const BankTransactionSchema = {
  type: "object",
  additionalProperties: false,
  description: "A single bank transaction",
  properties: {
    date: { type: "string", description: "Transaction date in YYYY-MM-DD format" },
    direction: { type: "string", description: "debit (outflow) or credit (inflow)" },
    amount: { type: "number", description: "Amount of the transaction" },
    currency: { type: "string", enum: ["MXN", "USD"], description: "Currency code (MXN or USD)" },
    description: { type: "string", description: "Transaction description / concept" },
    counterparty_name: { type: "string", description: "Name of the other party involved", nullable: true },
    category: { type: "string", description: "Category of the transaction (e.g. Transfer, Payment, Fee)", nullable: true }
  },
  required: [
    "date", "direction", "amount", "currency", 
    "description", "counterparty_name", "category"
  ]
} as const;

export const BankTransactionListSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    transactions: {
      type: "array",
      items: BankTransactionSchema,
      description: "List of transactions extracted from the statement"
    }
  },
  required: ["transactions"]
} as const;

