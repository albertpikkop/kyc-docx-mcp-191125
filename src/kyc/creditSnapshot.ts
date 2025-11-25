/**
 * Immutable Credit Assessment Snapshot
 * 
 * Creates an immutable snapshot of credit assessment with SHA-256 hash
 */

import * as crypto from 'crypto';
import { KycProfile, KycValidationResult } from './types.js';
import { CreditAssessmentResult } from './creditAssessment.js';

export interface CreditSnapshot {
  policyVersion: string;
  profileSummary: {
    hasCompanyIdentity: boolean;
    hasTaxProfile: boolean;
    hasRepresentative: boolean;
    hasAddress: boolean;
    hasBankAccount: boolean;
    taxStatus?: string;
  };
  flags: Array<{
    code: string;
    level: string;
    message: string;
  }>;
  reasons: string[];
  limit: number;
  terms: string;
  confidence: number;
  modelMix: Record<string, number>; // e.g., { "gpt-5.1": 2, "gemini-2.5-flash": 5 }
  costUsd: number;
  createdAt: string;
  snapshotHash: string;
}

const POLICY_VERSION = '1.0.0';

/**
 * Create profile summary from KYC profile
 */
function createProfileSummary(profile: KycProfile): CreditSnapshot['profileSummary'] {
  return {
    hasCompanyIdentity: !!profile.companyIdentity,
    hasTaxProfile: !!profile.companyTaxProfile,
    hasRepresentative: !!profile.representativeIdentity,
    hasAddress: !!(profile.currentFiscalAddress || profile.currentOperationalAddress),
    hasBankAccount: !!(profile.bankAccounts && profile.bankAccounts.length > 0),
    taxStatus: profile.companyTaxProfile?.status || undefined,
  };
}

/**
 * Calculate model mix from documents
 * Returns count of documents per model
 */
function calculateModelMix(
  docs: Array<{
    docType: string;
    extractedPayload?: unknown;
  }>
): Record<string, number> {
  const modelMix: Record<string, number> = {};
  
  // Model routing rules (same as modelRouter)
  const MODEL_ROUTES: Record<string, string> = {
    'acta': 'gemini-2.5-flash',
    'sat_constancia': 'gemini-2.5-flash',
    'ine': 'gemini-2.5-flash',
    'fm2': 'gemini-2.5-flash',
    'telmex': 'gemini-2.5-flash',
    'cfe': 'gemini-2.5-flash',
    'bank_identity_page': 'gemini-2.5-flash',
    'bank_statement': 'gpt-5.1',
    'bank_statement_transactions': 'gpt-5.1',
  };
  
  for (const doc of docs) {
    if (!doc.extractedPayload) continue;
    
    const model = MODEL_ROUTES[doc.docType] || 'gpt-5.1';
    modelMix[model] = (modelMix[model] || 0) + 1;
  }
  
  return modelMix;
}

/**
 * Calculate total cost from documents
 * Note: This is a placeholder - actual cost tracking should come from extraction results
 */
function calculateTotalCost(
  docs: Array<{
    docType: string;
    extractedPayload?: unknown;
  }>,
  runCostUsd?: number | null
): number {
  // If run has costUsd, use it
  if (runCostUsd !== null && runCostUsd !== undefined) {
    return runCostUsd;
  }
  
  // Otherwise estimate based on document count and types
  // This is a fallback - ideally costs should be tracked per extraction
  const modelMix = calculateModelMix(docs);
  
  // Rough estimates (should be replaced with actual tracked costs)
  const COST_ESTIMATES: Record<string, number> = {
    'gpt-5.1': 0.05, // Estimated per document
    'gemini-2.5-flash': 0.01, // Estimated per document
  };
  
  let totalCost = 0;
  for (const [model, count] of Object.entries(modelMix)) {
    const costPerDoc = COST_ESTIMATES[model] || 0.03;
    totalCost += count * costPerDoc;
  }
  
  return parseFloat(totalCost.toFixed(6));
}

/**
 * Create immutable snapshot with hash
 */
export function createCreditSnapshot(
  assessment: CreditAssessmentResult,
  profile: KycProfile,
  _validation: KycValidationResult,
  docs: Array<{
    docType: string;
    extractedPayload?: unknown;
  }>,
  runCostUsd?: number | null
): CreditSnapshot {
  const createdAt = new Date().toISOString();
  const profileSummary = createProfileSummary(profile);
  const modelMix = calculateModelMix(docs);
  const costUsd = calculateTotalCost(docs, runCostUsd);
  
  // Create snapshot without hash first
  const snapshotWithoutHash: Omit<CreditSnapshot, 'snapshotHash'> = {
    policyVersion: POLICY_VERSION,
    profileSummary,
    flags: assessment.flags,
    reasons: assessment.reasons,
    limit: assessment.limit,
    terms: assessment.terms,
    confidence: assessment.confidence,
    modelMix,
    costUsd,
    createdAt,
  };
  
  // Calculate SHA-256 hash of JSON stringified snapshot
  const snapshotJson = JSON.stringify(snapshotWithoutHash, null, 0); // No formatting for consistent hash
  const snapshotHash = crypto.createHash('sha256').update(snapshotJson).digest('hex');
  
  // Return snapshot with hash
  return {
    ...snapshotWithoutHash,
    snapshotHash,
  };
}


