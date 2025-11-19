/**
 * Sanitization utilities for KYC document extraction
 */

const RFC_REGEX = /^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{2,3}$/;

/**
 * Sanitizes and validates an RFC (Registro Federal de Contribuyentes) value.
 * Returns null if the value doesn't match the RFC format.
 * 
 * @param value - The RFC string to sanitize
 * @returns Sanitized RFC in uppercase, or null if invalid
 */
export function sanitizeRfc(value: string | null | undefined): string | null {
  if (!value) return null;
  
  const trimmed = value.trim().toUpperCase();
  
  return RFC_REGEX.test(trimmed) ? trimmed : null;
}

const INVOICE_REGEX = /^[A-Z0-9\/\-]+$/; // e.g. 070/125/000718083

/**
 * Sanitizes and validates an invoice/reference number.
 * Rejects UUID-like strings and validates against invoice format.
 * 
 * @param value - The invoice number string to sanitize
 * @returns Sanitized invoice number, or null if invalid
 */
export function sanitizeInvoiceNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  
  const trimmed = value.trim();
  
  // Reject UUID-like strings (e.g. a2271c07-03b6-4b22-889d-732e8277546f)
  if (trimmed.includes("-") && trimmed.length === 36) return null;
  
  return INVOICE_REGEX.test(trimmed) ? trimmed : null;
}


