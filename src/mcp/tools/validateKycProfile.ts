/**
 * MCP Tool: validate_kyc_profile
 * 
 * PURPOSE: Validate a KYC profile and generate flags.
 * LOGIC: ALL validation rules are CODE, not prompts. Claude cannot influence.
 * 
 * Claude's job: Call this tool with profile, present validation results.
 * This tool's job: Run deterministic validation rules, return flags and score.
 */

import { KycProfile, KycValidationResult, KycValidationFlag } from '../../kyc/types.js';

/**
 * VALIDATION RULES - ALL LOGIC IN CODE
 * 
 * These rules CANNOT be influenced by Claude.
 * Each rule is a pure function that returns a flag or null.
 */
const VALIDATION_RULES: Array<{
  id: string;
  name: string;
  check: (profile: KycProfile) => KycValidationFlag | null;
}> = [
  
  // ═══════════════════════════════════════════════════════════════
  // DOCUMENT PRESENCE CHECKS
  // ═══════════════════════════════════════════════════════════════
  
  {
    id: 'missing_acta',
    name: 'Acta Constitutiva Required',
    check: (profile) => {
      if (!profile.companyIdentity) {
        return {
          code: 'LOW_DOC_COVERAGE',
          level: 'critical',
          message: 'Missing Acta Constitutiva - cannot verify company existence',
          action_required: 'Provide Acta Constitutiva'
        };
      }
      return null;
    }
  },
  
  {
    id: 'missing_sat',
    name: 'SAT Constancia Required',
    check: (profile) => {
      if (!profile.companyTaxProfile) {
        return {
          code: 'MISSING_COMPANY_SAT',
          level: 'critical',
          message: 'Missing SAT Constancia de Situación Fiscal',
          action_required: 'Provide company SAT Constancia'
        };
      }
      return null;
    }
  },
  
  {
    id: 'sat_status_inactive',
    name: 'SAT Status Check',
    check: (profile) => {
      if (profile.companyTaxProfile?.status && 
          profile.companyTaxProfile.status.toUpperCase() !== 'ACTIVO') {
        return {
          code: 'OTHER',
          level: 'critical',
          message: `SAT Status is ${profile.companyTaxProfile.status} - company may not be active`,
          action_required: 'Verify company tax status with SAT'
        };
      }
      return null;
    }
  },
  
  // ═══════════════════════════════════════════════════════════════
  // PROOF OF ADDRESS CHECKS
  // ═══════════════════════════════════════════════════════════════
  
  {
    id: 'poa_name_mismatch',
    name: 'POA Name Match',
    check: (profile) => {
      if (!profile.addressEvidence || profile.addressEvidence.length === 0) {
        return {
          code: 'LOW_DOC_COVERAGE',
          level: 'warning',
          message: 'No proof of address document provided',
          action_required: 'Provide utility bill (CFE, Telmex) in company name'
        };
      }
      
      const companyName = (profile.companyIdentity?.razon_social || 
                          profile.companyTaxProfile?.razon_social || '').toUpperCase();
      
      if (!companyName) return null;
      
      // Extract key words from company name
      const companyWords = companyName
        .replace(/S\.?A\.?P?\.?I?\.?\s*(DE\s*)?C\.?V\.?/gi, '')
        .replace(/SOCIEDAD\s+AN[ÓO]NIMA/gi, '')
        .trim()
        .split(/\s+/)
        .filter(w => w.length > 2 && !['DE', 'LA', 'EL', 'LOS', 'LAS'].includes(w));
      
      for (const poa of profile.addressEvidence) {
        const poaName = (poa.client_name || '').toUpperCase().trim();
        
        if (!poaName) continue;
        
        // Check for direct match or word overlap
        const poaWords = poaName.split(/\s+/).filter(w => w.length > 2);
        const matchingWords = companyWords.filter(cw =>
          poaWords.some(pw => pw.includes(cw) || cw.includes(pw))
        );
        
        // If less than 70% of company words match, flag it
        if (matchingWords.length < companyWords.length * 0.7 &&
            !poaName.includes(companyName.split(',')[0].trim())) {
          return {
            code: 'POA_NAME_MISMATCH',
            level: 'critical',
            message: `Proof of address name "${poa.client_name}" does not match company "${profile.companyIdentity?.razon_social}"`,
            action_required: 'Provide utility bill in company name or rental contract'
          };
        }
      }
      
      return null;
    }
  },
  
  {
    id: 'poa_freshness',
    name: 'POA Freshness Check (90 days)',
    check: (profile) => {
      if (!profile.addressEvidence || profile.addressEvidence.length === 0) {
        return null; // Already flagged by poa_name_mismatch
      }
      
      const now = new Date();
      const maxAgeDays = 90;
      
      for (const poa of profile.addressEvidence) {
        const issueDate = poa.issue_datetime || poa.due_date;
        if (!issueDate) continue;
        
        const poaDate = new Date(issueDate);
        const ageInDays = Math.floor((now.getTime() - poaDate.getTime()) / (1000 * 60 * 60 * 24));
        
        if (ageInDays > maxAgeDays) {
          return {
            code: 'OTHER',
            level: 'warning',
            message: `Proof of address is ${ageInDays} days old (max ${maxAgeDays} days)`,
            action_required: 'Provide more recent utility bill'
          };
        }
      }
      
      return null;
    }
  },
  
  // ═══════════════════════════════════════════════════════════════
  // IDENTITY CHECKS
  // ═══════════════════════════════════════════════════════════════
  
  {
    id: 'missing_rep_id',
    name: 'Representative ID Required',
    check: (profile) => {
      if (!profile.representativeIdentity && !profile.passportIdentity) {
        return {
          code: 'LOW_DOC_COVERAGE',
          level: 'warning',
          message: 'No identity document for legal representative',
          action_required: 'Provide FM2, INE, or Passport for legal representative'
        };
      }
      return null;
    }
  },
  
  {
    id: 'passport_expired',
    name: 'Passport Expiry Check',
    check: (profile) => {
      if (!profile.passportIdentity?.expiry_date) return null;
      
      const expiryDate = new Date(profile.passportIdentity.expiry_date);
      const now = new Date();
      
      if (expiryDate < now) {
        return {
          code: 'IMMIGRATION_DOC_EXPIRED',
          level: 'critical',
          message: `Passport expired on ${profile.passportIdentity.expiry_date}`,
          action_required: 'Provide valid (unexpired) passport'
        };
      }
      
      return null;
    }
  },
  
  // ═══════════════════════════════════════════════════════════════
  // UBO CHECKS
  // ═══════════════════════════════════════════════════════════════
  
  {
    id: 'ubo_not_verified',
    name: 'UBO Identity Verification',
    check: (profile) => {
      const shareholders = profile.companyIdentity?.shareholders || [];
      const ubos = shareholders.filter(s => 
        (s.percentage && s.percentage >= 25) || s.is_beneficial_owner
      );
      
      if (ubos.length === 0) return null;
      
      // Check if we have ID for each UBO
      const repName = (
        profile.representativeIdentity?.full_name ||
        profile.passportIdentity?.full_name ||
        ''
      ).toUpperCase();
      
      for (const ubo of ubos) {
        const uboName = ubo.name.toUpperCase();
        // Simple name matching
        if (!repName.includes(uboName.split(' ')[0])) {
          return {
            code: 'UBO_IDENTITY_NOT_VERIFIED',
            level: 'info',
            message: `UBO "${ubo.name}" (${ubo.percentage}%) identity not verified with ID document`,
            action_required: 'Provide ID for all beneficial owners >25%'
          };
        }
      }
      
      return null;
    }
  },
  
  // ═══════════════════════════════════════════════════════════════
  // BANK VERIFICATION CHECKS
  // ═══════════════════════════════════════════════════════════════
  
  {
    id: 'bank_name_match',
    name: 'Bank Account Holder Match',
    check: (profile) => {
      if (!profile.bankAccounts || profile.bankAccounts.length === 0) {
        return {
          code: 'LOW_DOC_COVERAGE',
          level: 'warning',
          message: 'No bank statement provided',
          action_required: 'Provide bank statement for account verification'
        };
      }
      
      const companyName = (profile.companyIdentity?.razon_social ||
                          profile.companyTaxProfile?.razon_social || '').toUpperCase();
      
      if (!companyName) return null;
      
      // Extract key words
      const companyWords = companyName
        .replace(/S\.?A\.?P?\.?I?\.?\s*(DE\s*)?C\.?V\.?/gi, '')
        .trim()
        .split(/\s+/)
        .filter(w => w.length > 2);
      
      for (const bank of profile.bankAccounts) {
        const holderName = (bank.account_holder_name || '').toUpperCase();
        const holderWords = holderName.split(/\s+/).filter(w => w.length > 2);
        
        const matchingWords = companyWords.filter(cw =>
          holderWords.some(hw => hw.includes(cw) || cw.includes(hw))
        );
        
        if (matchingWords.length < companyWords.length * 0.7) {
          return {
            code: 'OTHER',
            level: 'warning',
            message: `Bank account holder "${bank.account_holder_name}" may not match company name`,
            action_required: 'Verify bank account is in company name'
          };
        }
      }
      
      return null;
    }
  },
  
  // ═══════════════════════════════════════════════════════════════
  // RFC CONSISTENCY CHECKS
  // ═══════════════════════════════════════════════════════════════
  
  {
    id: 'rfc_mismatch',
    name: 'RFC Consistency',
    check: (profile) => {
      const actaRfc = profile.companyIdentity?.rfc?.toUpperCase().trim();
      const satRfc = profile.companyTaxProfile?.rfc?.toUpperCase().trim();
      
      if (actaRfc && satRfc && actaRfc !== satRfc) {
        return {
          code: 'RFC_MISMATCH',
          level: 'critical',
          message: `RFC mismatch: Acta says "${actaRfc}", SAT says "${satRfc}"`,
          action_required: 'Verify correct RFC'
        };
      }
      
      return null;
    }
  },
];

/**
 * Calculate overall score based on flags
 */
function calculateScore(flags: KycValidationFlag[]): number {
  let score = 100;
  
  for (const flag of flags) {
    switch (flag.level) {
      case 'critical':
        score -= 20;
        break;
      case 'warning':
        score -= 10;
        break;
      case 'info':
        score -= 2;
        break;
    }
  }
  
  return Math.max(0, Math.min(100, score));
}

export interface ValidateProfileResult {
  customer_id: string;
  score: number;
  trust_level: 'HIGH' | 'MEDIUM' | 'LOW' | 'CRITICAL';
  flags: KycValidationFlag[];
  critical_count: number;
  warning_count: number;
  info_count: number;
  validation_timestamp: string;
  rules_applied: number;
}

/**
 * MAIN TOOL FUNCTION
 * 
 * Input: profile (KycProfile)
 * Output: ValidateProfileResult with score and flags
 * 
 * Claude CANNOT modify validation rules. Claude only presents results.
 */
export async function validateKycProfile(profile: KycProfile): Promise<ValidateProfileResult> {
  console.log(`[validate_kyc_profile] Validating: ${profile.customerId}`);
  
  const flags: KycValidationFlag[] = [];
  
  // Run ALL validation rules
  for (const rule of VALIDATION_RULES) {
    try {
      const flag = rule.check(profile);
      if (flag) {
        flags.push(flag);
      }
    } catch (error) {
      console.error(`[validate_kyc_profile] Rule ${rule.id} failed:`, error);
    }
  }
  
  // Calculate score
  const score = calculateScore(flags);
  
  // Determine trust level
  let trust_level: 'HIGH' | 'MEDIUM' | 'LOW' | 'CRITICAL';
  const criticalCount = flags.filter(f => f.level === 'critical').length;
  
  if (criticalCount > 0) {
    trust_level = 'CRITICAL';
  } else if (score >= 90) {
    trust_level = 'HIGH';
  } else if (score >= 70) {
    trust_level = 'MEDIUM';
  } else {
    trust_level = 'LOW';
  }
  
  return {
    customer_id: profile.customerId,
    score,
    trust_level,
    flags,
    critical_count: criticalCount,
    warning_count: flags.filter(f => f.level === 'warning').length,
    info_count: flags.filter(f => f.level === 'info').length,
    validation_timestamp: new Date().toISOString(),
    rules_applied: VALIDATION_RULES.length
  };
}

export const VALIDATE_KYC_PROFILE_TOOL = {
  name: 'validate_kyc_profile',
  description: `Run validation rules on a KYC profile and generate compliance flags.
ALL validation rules are deterministic code - Claude cannot influence them.
Returns score (0-100), trust level, and list of issues.
Claude should call this after building the merged profile.`,
  inputSchema: {
    type: 'object',
    properties: {
      profile: {
        type: 'object',
        description: 'The merged KycProfile object'
      }
    },
    required: ['profile']
  }
};

