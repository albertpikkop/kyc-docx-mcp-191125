/**
 * KYC Validators and Sanitizers
 * 
 * Central validation logic to ensure data integrity across all extractors.
 */

export const RFC_REGEX   = /^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{2,3}$/;
export const CLABE_REGEX = /^\d{18}$/;
export const CURP_REGEX  = /^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/;
export const INVOICE_REGEX = /^[A-Z0-9\/\-]+$/;

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
