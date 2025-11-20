/**
 * KYC Validators and Sanitizers
 * 
 * Central validation logic to ensure data integrity across all extractors.
 */

export const RFC_REGEX   = /^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{2,3}$/;
export const CLABE_REGEX = /^\d{18}$/;
export const CURP_REGEX  = /^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/;
export const INVOICE_REGEX = /^[A-Z0-9\/\-]+$/;
export const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const VALID_CURRENCIES = new Set(["MXN", "USD", "EUR", "CAD"]);

export type Currency = "MXN" | "USD" | null;

/**
 * Deeply converts empty strings ("") to null, leaving other values untouched.
 */
export function normalizeEmptyToNull<T>(value: T): T {
  if (value === "" || value === null || value === undefined) {
    return null as any;
  }
  
  if (Array.isArray(value)) {
    return value.map(normalizeEmptyToNull) as any;
  }
  
  if (typeof value === 'object') {
    const newObj: any = {};
    for (const key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        newObj[key] = normalizeEmptyToNull((value as any)[key]);
      }
    }
    return newObj;
  }
  
  return value;
}

/**
 * Sanitizes and validates RFC (Mexican Tax ID).
 * Returns strict uppercase value if valid, or null if invalid/empty.
 */
export function sanitizeRfc(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.trim().toUpperCase();
  if (!RFC_REGEX.test(cleaned)) {
    // Ideally log this warning, but returning null is safer for strict KYC
    return null;
  }
  return cleaned;
}

/**
 * Sanitizes and validates CLABE (18-digit bank identifier).
 * Returns numeric string if valid, or null.
 */
export function sanitizeClabe(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.trim().replace(/\D/g, ''); // remove non-digits just in case
  if (!CLABE_REGEX.test(cleaned)) {
    return null;
  }
  return cleaned;
}

/**
 * Sanitizes and validates CURP (Population Registry Code).
 * Returns strict uppercase value if valid, or null.
 */
export function sanitizeCurp(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.trim().toUpperCase();
  if (!CURP_REGEX.test(cleaned)) {
    return null;
  }
  return cleaned;
}

/**
 * Sanitizes and validates an invoice/reference number.
 * Rejects UUID-like strings and validates against invoice format.
 */
export function sanitizeInvoiceNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  
  const trimmed = value.trim();
  
  // Reject UUID-like strings (e.g. a2271c07-03b6-4b22-889d-732e8277546f)
  if (trimmed.includes("-") && trimmed.length === 36) return null;
  
  return INVOICE_REGEX.test(trimmed) ? trimmed : null;
}

/**
 * Validates that a string is a valid ISO 8601 date (YYYY-MM-DD).
 * Returns the string if valid, or null.
 */
export function sanitizeDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!DATE_REGEX.test(trimmed)) return null;
  
  // Basic logical check
  const date = new Date(trimmed);
  if (isNaN(date.getTime())) return null;
  
  return trimmed;
}

/**
 * Sanitizes currency code. Defaults to MXN if invalid/unknown but looks like money,
 * or returns null if totally bogus.
 */
export function sanitizeCurrency(value: string | null | undefined): Currency {
  if (!value) return null;
  const upper = value.trim().toUpperCase();
  if (upper === "MXN" || upper === "USD") return upper;
  
  // Allow specific other currencies if needed, but for now stick to strict return type or null
  // If it's EUR or CAD, we might want to allow them if we expand Currency type, 
  // but user requirement focused on MXN/USD context. 
  // Let's support EUR/CAD in the logic but cast to string if we change return type,
  // OR strictly return MXN/USD as per "The goal is: Consistent behavior across all doc types"
  // and "Ensure the JSON schema currency field is a string constrained to 'MXN' or 'USD' (or null)"
  
  // Strict adherence to MXN/USD for now per user request
  if (upper === "EUR" || upper === "CAD") {
      // Technically valid currencies but maybe not in the schema enum?
      // User said: "Ensure the JSON schema currency field is a string constrained to "MXN" or "USD" (or null)"
      // So we filter them out or map them? Usually we shouldn't map EUR to MXN.
      // I'll return null for now to be safe with the strict schema, or we can expand schema.
      // User instruction: "Ensure the JSON schema currency field is a string constrained to "MXN" or "USD" (or null)"
      // So we drop others.
      return null;
  }

  // Common Mexican peso shorthands
  const cleaned = upper.replace(/\./g, "").replace(/\s+/g, "");
  if (cleaned === "MN" || cleaned === "MNX" || cleaned === "MXP" || cleaned === "MXNMN") {
    return "MXN";
  }
  if (cleaned.includes("PESO")) {
    return "MXN";
  }
  
  // Common USD shorthands
  if (cleaned === "US" || cleaned === "DLS" || cleaned === "DOLARES" || cleaned === "USDOLARES") {
      return "USD";
  }
  
  return null;
}
