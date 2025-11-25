/**
 * Deterministic Credit Assessment Rules
 * 
 * Rules:
 * - base = avgMonthlyInflow * 0.15
 * - Reduce 20-50% for critical flags
 * - Cap at minBalance * 1.5
 * - Confidence 0.6-0.9 from doc coverage
 * - Return ≥3 reason codes
 */

import { KycProfile, KycValidationResult, KycValidationFlag } from './types.js';

export interface CreditAssessmentResult {
  decision: 'approved' | 'rejected' | 'pending';
  limit: number;
  terms: string;
  score: number;
  confidence: number;
  flags: Array<{
    code: string;
    level: string;
    message: string;
  }>;
  reasons: string[];
  reasonCodes: string[];
  calculation: {
    avgMonthlyInflow: number;
    baseLimit: number;
    flagReduction: number;
    flagReductionPercent: number;
    afterFlagReduction: number;
    minBalance: number;
    balanceCap: number;
    finalLimit: number;
    documentCoverage: number;
  };
}

/**
 * Calculate average monthly inflow from bank statement transactions
 */
function calculateAvgMonthlyInflow(
  transactions: Array<{
    date: string;
    direction: 'credit' | 'debit';
    amount: number;
    currency: string;
  }> | null | undefined
): number {
  if (!transactions || transactions.length === 0) {
    return 0;
  }

  // Filter credit transactions (inflows)
  const credits = transactions.filter(tx => tx.direction === 'credit');
  
  if (credits.length === 0) {
    return 0;
  }

  // Group by month
  const monthlyTotals: Record<string, number> = {};
  
  for (const tx of credits) {
    const date = new Date(tx.date);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    
    if (!monthlyTotals[monthKey]) {
      monthlyTotals[monthKey] = 0;
    }
    
    monthlyTotals[monthKey] += tx.amount;
  }

  // Calculate average
  const months = Object.keys(monthlyTotals);
  if (months.length === 0) {
    return 0;
  }

  const totalInflow = Object.values(monthlyTotals).reduce((sum, val) => sum + val, 0);
  return totalInflow / months.length;
}

/**
 * Calculate minimum balance from bank statement transactions
 */
function calculateMinBalance(
  transactions: Array<{
    date: string;
    direction: 'credit' | 'debit';
    amount: number;
    currency: string;
  }> | null | undefined
): number {
  if (!transactions || transactions.length === 0) {
    return 0;
  }

  // Sort by date
  const sorted = [...transactions].sort((a, b) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // Calculate running balance (assuming starting balance is 0 or first transaction)
  let balance = 0;
  let minBalance = 0;

  for (const tx of sorted) {
    if (tx.direction === 'credit') {
      balance += tx.amount;
    } else {
      balance -= tx.amount;
    }
    
    if (balance < minBalance) {
      minBalance = balance;
    }
  }

  return Math.abs(minBalance); // Return absolute value
}

/**
 * Calculate document coverage score (0-1)
 */
function calculateDocumentCoverage(profile: KycProfile): number {
  let coverage = 0;
  let maxCoverage = 0;

  // Company Identity (20%)
  maxCoverage += 20;
  if (profile.companyIdentity) {
    coverage += 20;
  }

  // Tax Profile (20%)
  maxCoverage += 20;
  if (profile.companyTaxProfile) {
    coverage += 20;
  }

  // Representative Identity (15%)
  maxCoverage += 15;
  if (profile.representativeIdentity) {
    coverage += 15;
  }

  // Current Address (15%)
  maxCoverage += 15;
  if (profile.currentFiscalAddress || profile.currentOperationalAddress) {
    coverage += 15;
  }

  // Proof of Address (15%)
  maxCoverage += 15;
  if (profile.addressEvidence && profile.addressEvidence.length > 0) {
    coverage += 15;
  }

  // Bank Account (15%)
  maxCoverage += 15;
  if (profile.bankAccounts && profile.bankAccounts.length > 0) {
    coverage += 15;
  }

  return maxCoverage > 0 ? coverage / maxCoverage : 0;
}

/**
 * Calculate confidence score (0.6-0.9) from document coverage
 */
function calculateConfidence(documentCoverage: number): number {
  // Map coverage (0-1) to confidence (0.6-0.9)
  // Linear mapping: 0 coverage -> 0.6 confidence, 1 coverage -> 0.9 confidence
  return 0.6 + (documentCoverage * 0.3);
}

/**
 * Calculate flag-based reduction (20-50% for critical flags)
 */
function calculateFlagReduction(flags: KycValidationFlag[]): { reduction: number; percent: number } {
  const criticalFlags = flags.filter(f => f.level === 'critical');
  
  if (criticalFlags.length === 0) {
    return { reduction: 0, percent: 0 };
  }

  // Base reduction: 20% per critical flag, up to 50% max
  const reductionPercent = Math.min(20 * criticalFlags.length, 50);
  
  return {
    reduction: reductionPercent / 100,
    percent: reductionPercent,
  };
}

/**
 * Generate reason codes (≥3 codes)
 */
function generateReasonCodes(
  profile: KycProfile,
  validation: KycValidationResult,
  calculation: CreditAssessmentResult['calculation']
): string[] {
  const codes: string[] = [];

  // Base calculation reason
  if (calculation.avgMonthlyInflow > 0) {
    codes.push('BASE_INFLOW_CALCULATED');
  } else {
    codes.push('NO_INFLOW_DATA');
  }

  // Flag-based reasons
  const criticalFlags = validation.flags.filter(f => f.level === 'critical');
  if (criticalFlags.length > 0) {
    codes.push('CRITICAL_FLAGS_DETECTED');
    criticalFlags.forEach(flag => {
      codes.push(`FLAG_${flag.code}`);
    });
  } else {
    codes.push('NO_CRITICAL_FLAGS');
  }

  // Balance cap reason
  if (calculation.finalLimit === calculation.balanceCap) {
    codes.push('BALANCE_CAP_APPLIED');
  } else {
    codes.push('BALANCE_CAP_NOT_LIMITING');
  }

  // Document coverage reason
  if (calculation.documentCoverage >= 0.8) {
    codes.push('HIGH_DOC_COVERAGE');
  } else if (calculation.documentCoverage >= 0.5) {
    codes.push('MODERATE_DOC_COVERAGE');
  } else {
    codes.push('LOW_DOC_COVERAGE');
  }

  // Tax status reason
  if (profile.companyTaxProfile?.status === 'ACTIVO') {
    codes.push('TAX_STATUS_ACTIVE');
  } else if (profile.companyTaxProfile?.status) {
    codes.push('TAX_STATUS_INACTIVE');
  }

  // Bank account reason
  if (profile.bankAccounts && profile.bankAccounts.length > 0) {
    codes.push('BANK_ACCOUNT_VERIFIED');
  } else {
    codes.push('NO_BANK_ACCOUNT');
  }

  // Ensure at least 3 codes
  if (codes.length < 3) {
    codes.push('STANDARD_ASSESSMENT');
  }

  return codes;
}

/**
 * Assess credit using deterministic rules
 */
export function assessCredit(
  profile: KycProfile,
  validation: KycValidationResult,
  transactions?: Array<{
    date: string;
    direction: 'credit' | 'debit';
    amount: number;
    currency: string;
  }> | null
): CreditAssessmentResult {
  // Get transactions from profile if not provided
  // Note: Transactions are stored in documents with type "bank_statement_transactions"
  // For now, we'll need to pass them separately or extract from profile
  
  // Calculate metrics
  const avgMonthlyInflow = calculateAvgMonthlyInflow(transactions || null);
  const minBalance = calculateMinBalance(transactions || null);
  const documentCoverage = calculateDocumentCoverage(profile);
  const confidence = calculateConfidence(documentCoverage);

  // Base limit calculation
  const baseLimit = avgMonthlyInflow * 0.15;

  // Flag-based reduction
  const flagReduction = calculateFlagReduction(validation.flags);
  const afterFlagReduction = baseLimit * (1 - flagReduction.reduction);

  // Balance cap (only apply if we have balance data)
  let finalLimit = afterFlagReduction;
  if (minBalance > 0) {
    const balanceCap = minBalance * 1.5;
    finalLimit = Math.min(afterFlagReduction, balanceCap);
  }
  
  // Ensure non-negative
  finalLimit = Math.max(0, finalLimit);

  // Determine decision
  let decision: 'approved' | 'rejected' | 'pending' = 'pending';
  const reasons: string[] = [];
  
  if (validation.score >= 0.7 && validation.flags.filter(f => f.level === 'critical').length === 0 && finalLimit > 0) {
    decision = 'approved';
    reasons.push(`Approved based on ${(validation.score * 100).toFixed(0)}% KYC score`);
    reasons.push(`Monthly inflow: ${avgMonthlyInflow.toLocaleString('en-US', { style: 'currency', currency: 'MXN' })}`);
    reasons.push(`Calculated limit: ${finalLimit.toLocaleString('en-US', { style: 'currency', currency: 'MXN' })}`);
  } else if (validation.score < 0.5 || validation.flags.filter(f => f.level === 'critical').length > 2) {
    decision = 'rejected';
    reasons.push(`Rejected due to low KYC score (${(validation.score * 100).toFixed(0)}%)`);
    if (validation.flags.filter(f => f.level === 'critical').length > 0) {
      reasons.push(`${validation.flags.filter(f => f.level === 'critical').length} critical validation flags`);
    }
  } else {
    decision = 'pending';
    reasons.push(`Pending manual review - moderate risk profile`);
    reasons.push(`KYC score: ${(validation.score * 100).toFixed(0)}%`);
    if (validation.flags.filter(f => f.level === 'critical').length > 0) {
      reasons.push(`${validation.flags.filter(f => f.level === 'critical').length} critical flags require review`);
    }
  }

  // Generate reason codes
  const balanceCap = minBalance > 0 ? minBalance * 1.5 : 0;
  const reasonCodes = generateReasonCodes(profile, validation, {
    avgMonthlyInflow,
    baseLimit,
    flagReduction: flagReduction.reduction,
    flagReductionPercent: flagReduction.percent,
    afterFlagReduction,
    minBalance,
    balanceCap,
    finalLimit,
    documentCoverage,
  });

  // Terms
  let terms = '';
  if (decision === 'approved') {
    terms = `Standard terms: 30-day payment, 2% monthly interest, ${Math.round(finalLimit / 1000)}k MXN limit`;
  } else if (decision === 'pending') {
    terms = 'Pending manual review - terms TBD';
  } else {
    terms = 'Application rejected';
  }

  return {
    decision,
    limit: Math.round(finalLimit),
    terms,
    score: validation.score,
    confidence,
    flags: validation.flags.map(f => ({
      code: f.code,
      level: f.level,
      message: f.message,
    })),
    reasons,
    reasonCodes,
    calculation: {
      avgMonthlyInflow,
      baseLimit,
      flagReduction: flagReduction.reduction,
      flagReductionPercent: flagReduction.percent,
      afterFlagReduction,
      minBalance,
      balanceCap,
      finalLimit,
      documentCoverage,
    },
  };
}

