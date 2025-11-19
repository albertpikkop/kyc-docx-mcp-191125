/**
 * Re-exporting sanitization utilities from the new central validators module.
 * This ensures backward compatibility while consolidating logic.
 */
export { sanitizeRfc, sanitizeInvoiceNumber } from '../kyc/validators.js';
