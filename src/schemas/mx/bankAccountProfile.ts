import { AddressSchema } from './address.js';

export const BankAccountProfileSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    bank_account_profile: {
      type: "object",
      additionalProperties: false,
      description: "Profile information extracted from a bank statement",
      properties: {
        bank_name: { type: "string", description: "Name of the bank (e.g. BBVA, Santander)" },
        account_holder_name: { type: "string", description: "Name of the account holder as printed" },
        account_number: { type: "string", description: "Account number if visible", nullable: true },
        clabe: { type: "string", description: "CLABE interbancaria (18 digits)", nullable: true },
        currency: { type: "string", enum: ["MXN", "USD"], description: "Currency code (MXN or USD)", nullable: true },
        statement_period_start: { type: "string", description: "Start date of the statement period (YYYY-MM-DD)", nullable: true },
        statement_period_end: { type: "string", description: "End date of the statement period (YYYY-MM-DD)", nullable: true },
        address_on_statement: AddressSchema
      },
      required: [
        "bank_name",
        "account_holder_name",
        "address_on_statement"
      ]
    }
  },
  required: ["bank_account_profile"]
} as const;
