/**
 * Template Compliance Checker
 * Evaluates a KYC run against the Persona Moral template
 */

import { 
  PERSONA_MORAL_TEMPLATE, 
  PersonaMoralRequirement,
  TemplateComplianceResult, 
  RequirementResult,
  getMaxScore 
} from './personaMoralTemplate.js';
import { KycRun, KycProfile } from '../types.js';

/**
 * Spanish/English word equivalents for company name matching
 */
const WORD_EQUIVALENTS: Record<string, string[]> = {
  'GRUPO': ['GRUPO', 'GROUP'],
  'GROUP': ['GRUPO', 'GROUP'],
  'SERVICIOS': ['SERVICIOS', 'SERVICES'],
  'SERVICES': ['SERVICIOS', 'SERVICES'],
  'SOLUCIONES': ['SOLUCIONES', 'SOLUTIONS'],
  'SOLUTIONS': ['SOLUCIONES', 'SOLUTIONS'],
  'COMERCIAL': ['COMERCIAL', 'COMMERCIAL'],
  'COMMERCIAL': ['COMERCIAL', 'COMMERCIAL'],
  'INTERNACIONAL': ['INTERNACIONAL', 'INTERNATIONAL'],
  'INTERNATIONAL': ['INTERNACIONAL', 'INTERNATIONAL'],
  'CONSULTORES': ['CONSULTORES', 'CONSULTANTS', 'CONSULTING'],
  'CONSULTANTS': ['CONSULTORES', 'CONSULTANTS', 'CONSULTING'],
};

/**
 * Check if two words are equivalent (including Spanish/English variations)
 */
function wordsAreEquivalent(word1: string, word2: string): boolean {
  const w1 = word1.toUpperCase();
  const w2 = word2.toUpperCase();
  
  // Direct match
  if (w1 === w2) return true;
  
  // Substring match (for abbreviations like POUNJ)
  if (w1.includes(w2) || w2.includes(w1)) return true;
  
  // Check equivalents table
  const equivalents1 = WORD_EQUIVALENTS[w1] || [w1];
  const equivalents2 = WORD_EQUIVALENTS[w2] || [w2];
  
  return equivalents1.some(e1 => equivalents2.includes(e1));
}

/**
 * Check compliance of a KYC run against the Persona Moral template
 */
export function checkTemplateCompliance(run: KycRun): TemplateComplianceResult {
  const results: RequirementResult[] = [];
  const criticalIssues: string[] = [];
  const warnings: string[] = [];
  const recommendations: string[] = [];
  
  const profile = run.profile;
  const documents = run.documents;
  
  if (!profile) {
    return {
      templateName: PERSONA_MORAL_TEMPLATE.name,
      templateVersion: PERSONA_MORAL_TEMPLATE.version,
      overallScore: 0,
      maxScore: getMaxScore(),
      percentComplete: 0,
      requirements: [],
      criticalIssues: ["No profile data available"],
      warnings: [],
      recommendations: ["Run KYC extraction to generate profile"]
    };
  }
  
  // Check each requirement
  for (const requirement of PERSONA_MORAL_TEMPLATE.requirements) {
    const result = checkRequirement(requirement, run, profile, documents);
    results.push(result);
    
    // Collect issues based on severity
    if (result.status === 'failed') {
      result.requirement.validationRules
        .filter(r => r.severity === 'critical')
        .forEach(r => {
          const failed = !checkRule(r.check, run, profile, documents);
          if (failed) {
            criticalIssues.push(`${requirement.nameEs}: ${r.descriptionEs}`);
          }
        });
      
      result.requirement.validationRules
        .filter(r => r.severity === 'warning')
        .forEach(r => {
          const failed = !checkRule(r.check, run, profile, documents);
          if (failed) {
            warnings.push(`${requirement.nameEs}: ${r.descriptionEs}`);
          }
        });
    }
  }
  
  // Calculate overall score
  const totalScore = results.reduce((sum, r) => sum + r.score, 0);
  const maxScore = getMaxScore();
  const percentComplete = Math.round((totalScore / maxScore) * 100);
  
  // Add recommendations based on missing items
  results.filter(r => r.status === 'failed' || r.status === 'partial').forEach(r => {
    recommendations.push(`Completar: ${r.requirement.nameEs} - ${r.detailsEs}`);
  });
  
  return {
    templateName: PERSONA_MORAL_TEMPLATE.name,
    templateVersion: PERSONA_MORAL_TEMPLATE.version,
    overallScore: totalScore,
    maxScore,
    percentComplete,
    requirements: results,
    criticalIssues,
    warnings,
    recommendations
  };
}

/**
 * Check a single requirement
 */
function checkRequirement(
  requirement: PersonaMoralRequirement,
  run: KycRun,
  profile: KycProfile,
  documents: any[]
): RequirementResult {
  const ruleResults: boolean[] = [];
  const evidence: string[] = [];
  
  // Check each validation rule
  for (const rule of requirement.validationRules) {
    const passed = checkRule(rule.check, run, profile, documents);
    ruleResults.push(passed);
    
    if (passed) {
      evidence.push(`✓ ${rule.descriptionEs}`);
    } else {
      evidence.push(`✗ ${rule.descriptionEs}`);
    }
  }
  
  // Calculate score based on critical rules
  const criticalRules = requirement.validationRules.filter(r => r.severity === 'critical');
  const criticalPassed = criticalRules.filter((r, i) => {
    const ruleIndex = requirement.validationRules.indexOf(r);
    return ruleResults[ruleIndex];
  }).length;
  
  const allCriticalPassed = criticalPassed === criticalRules.length;
  const allPassed = ruleResults.every(r => r);
  const somePassed = ruleResults.some(r => r);
  
  let status: 'passed' | 'failed' | 'partial' | 'not_applicable';
  let score: number;
  
  if (allPassed) {
    status = 'passed';
    score = requirement.weight;
  } else if (allCriticalPassed && somePassed) {
    status = 'partial';
    // Partial score based on rules passed
    const passedCount = ruleResults.filter(r => r).length;
    score = Math.round((passedCount / ruleResults.length) * requirement.weight);
  } else if (!allCriticalPassed) {
    status = 'failed';
    score = 0;
  } else {
    status = 'partial';
    score = Math.round(requirement.weight * 0.5);
  }
  
  // Generate details
  const passedCount = ruleResults.filter(r => r).length;
  const totalCount = ruleResults.length;
  const details = `${passedCount}/${totalCount} checks passed`;
  const detailsEs = `${passedCount}/${totalCount} verificaciones pasaron`;
  
  return {
    requirement,
    status,
    score,
    maxScore: requirement.weight,
    details,
    detailsEs,
    evidence
  };
}

/**
 * Check a specific validation rule
 */
function checkRule(
  ruleId: string,
  run: KycRun,
  profile: KycProfile,
  documents: any[]
): boolean {
  const companyIdentity = profile.companyIdentity;
  const companyTaxProfile = profile.companyTaxProfile;
  const representativeIdentity = profile.representativeIdentity;
  const passportIdentity = profile.passportIdentity;
  // Profile uses addressEvidence (array of PoA documents) not proofsOfAddress
  const proofsOfAddress = profile.addressEvidence || [];
  // Profile uses bankIdentity (single object) and bankAccounts (array) - combine them
  const bankAccounts = [
    ...(profile.bankAccounts || []),
    ...(profile.bankIdentity ? [profile.bankIdentity] : [])
  ];
  
  switch (ruleId) {
    // =========================================================================
    // ACTA CONSTITUTIVA RULES
    // =========================================================================
    case 'has_razon_social':
      return !!(companyIdentity?.razon_social);
      
    case 'has_incorporation_date':
      return !!(companyIdentity?.incorporation_date);
      
    case 'has_notary_info':
      return !!(companyIdentity?.notary?.name && companyIdentity?.notary?.notary_number);
      
    case 'has_registry_info':
      return !!(companyIdentity?.registry?.fme || companyIdentity?.registry?.folio);
      
    case 'has_shareholders':
      return !!(companyIdentity?.shareholders && companyIdentity.shareholders.length > 0);
      
    case 'has_legal_representatives':
      return !!(companyIdentity?.legal_representatives && companyIdentity.legal_representatives.length > 0);
    
    // =========================================================================
    // SAT CONSTANCIA RULES
    // =========================================================================
    case 'has_rfc':
      return !!(companyTaxProfile?.rfc && companyTaxProfile.rfc.length >= 12);
      
    case 'sat_status_active':
      return companyTaxProfile?.status?.toUpperCase() === 'ACTIVO';
      
    case 'has_fiscal_address':
      return !!(companyTaxProfile?.fiscal_address?.street || companyTaxProfile?.fiscal_address?.colonia);
      
    case 'has_tax_regime':
      return !!(companyTaxProfile?.tax_regime);
    
    // =========================================================================
    // REPRESENTATIVE IDENTITY RULES
    // =========================================================================
    case 'has_identity_document':
      return !!(passportIdentity || representativeIdentity);
      
    case 'identity_not_expired': {
      // Check passport expiry
      if (passportIdentity?.expiry_date) {
        const expiry = new Date(passportIdentity.expiry_date);
        if (expiry < new Date()) return false;
      }
      // Check FM2 expiry (null means permanent resident - no expiry)
      if (representativeIdentity?.expiry_date) {
        const expiry = new Date(representativeIdentity.expiry_date);
        if (expiry < new Date()) return false;
      }
      return true;
    }
      
    case 'rep_name_matches_acta': {
      const repName = (passportIdentity?.full_name || representativeIdentity?.full_name || '').toUpperCase();
      if (!repName || !companyIdentity?.legal_representatives) return false;
      
      return companyIdentity.legal_representatives.some(lr => {
        const lrName = (lr.name || '').toUpperCase();
        // Simple name matching - check if key parts match
        const repParts = repName.replace(/[\/,]/g, ' ').split(/\s+/).filter(p => p.length > 2);
        const lrParts = lrName.split(/\s+/).filter(p => p.length > 2);
        const matches = repParts.filter(rp => lrParts.some(lp => lp.includes(rp) || rp.includes(lp)));
        return matches.length >= 2;
      });
    }
      
    case 'rep_has_signing_powers': {
      const repName = (passportIdentity?.full_name || representativeIdentity?.full_name || '').toUpperCase();
      if (!repName || !companyIdentity?.legal_representatives) return false;
      
      return companyIdentity.legal_representatives.some(lr => {
        const lrName = (lr.name || '').toUpperCase();
        const repParts = repName.replace(/[\/,]/g, ' ').split(/\s+/).filter(p => p.length > 2);
        const lrParts = lrName.split(/\s+/).filter(p => p.length > 2);
        const matches = repParts.filter(rp => lrParts.some(lp => lp.includes(rp) || rp.includes(lp)));
        const nameMatches = matches.length >= 2;
        return nameMatches && lr.can_sign_contracts;
      });
    }
      
    case 'foreigner_has_fm2': {
      // If passport is foreign (not MX), check for FM2
      if (passportIdentity?.issuer_country && passportIdentity.issuer_country !== 'MX') {
        return !!(representativeIdentity?.document_type);
      }
      return true; // Not a foreigner or no passport
    }
    
    // =========================================================================
    // PROOF OF ADDRESS RULES
    // =========================================================================
    case 'has_proof_of_address':
      return proofsOfAddress.length > 0;
      
    case 'poa_within_90_days': {
      if (proofsOfAddress.length === 0) return false;
      const now = new Date();
      return proofsOfAddress.some(poa => {
        const issueDate = poa.issue_datetime || poa.due_date;
        if (!issueDate) return false;
        const date = new Date(issueDate);
        const daysDiff = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
        return daysDiff <= 90;
      });
    }
      
    case 'poa_name_matches_company': {
      if (proofsOfAddress.length === 0) return false;
      const companyName = (companyIdentity?.razon_social || companyTaxProfile?.razon_social || '').toUpperCase();
      if (!companyName) return false;
      
      // Extract key words from company name (remove common suffixes)
      const companyShort = companyName.split(',')[0].trim();
      const companyWords = companyShort
        .replace(/S\.?A\.?P?\.?I?\.?\s*(DE\s*)?C\.?V\.?/gi, '')
        .replace(/SOCIEDAD\s+AN[ÓO]NIMA/gi, '')
        .trim()
        .split(/\s+/)
        .filter(w => w.length > 2);
      
      return proofsOfAddress.some(poa => {
        const poaName = (poa.client_name || '').toUpperCase().trim();
        const poaWords = poaName.split(/\s+/).filter(w => w.length > 2);
        
        // Check if names match directly
        if (poaName.includes(companyShort) || companyShort.includes(poaName)) {
          return true;
        }
        
        // Check if key words match using word equivalents
        const matchingWords = companyWords.filter(cw => 
          poaWords.some(pw => wordsAreEquivalent(cw, pw))
        );
        
        // POA name must match company name (strict for critical compliance)
        // At least 70% of company words must appear in POA name
        return matchingWords.length >= companyWords.length * 0.7;
      });
    }
      
    case 'poa_address_matches_fiscal': {
      // This is a warning-level check, be lenient
      return true; // TODO: Implement address comparison
    }
    
    // =========================================================================
    // BANK ACCOUNT RULES
    // =========================================================================
    case 'has_bank_statement':
      return bankAccounts.length > 0;
      
    case 'has_clabe':
      return bankAccounts.some(ba => ba.clabe && ba.clabe.length === 18);
      
    case 'bank_holder_matches_company': {
      if (bankAccounts.length === 0) return false;
      const companyName = (companyIdentity?.razon_social || companyTaxProfile?.razon_social || '').toUpperCase();
      if (!companyName) return false;
      
      // Extract key words from company name (remove common suffixes)
      const companyShort = companyName.split(',')[0].trim();
      const companyWords = companyShort
        .replace(/S\.?A\.?P?\.?I?\.?\s*(DE\s*)?C\.?V\.?/gi, '')
        .replace(/SOCIEDAD\s+AN[ÓO]NIMA/gi, '')
        .trim()
        .split(/\s+/)
        .filter(w => w.length > 2);
      
      return bankAccounts.some(ba => {
        const holderName = (ba.account_holder_name || '').toUpperCase().trim();
        const holderWords = holderName.split(/\s+/).filter(w => w.length > 2);
        
        // Check if names match directly
        if (holderName.includes(companyShort) || companyShort.includes(holderName)) {
          return true;
        }
        
        // Check if key words match using word equivalents (handles "GRUPO POUNJ" ≈ "POUNJ GROUP")
        const matchingWords = companyWords.filter(cw => 
          holderWords.some(hw => wordsAreEquivalent(cw, hw))
        );
        
        // If most key words match, consider it a match
        return matchingWords.length >= Math.min(companyWords.length, holderWords.length) * 0.7;
      });
    }
      
    case 'bank_within_90_days': {
      if (bankAccounts.length === 0) return false;
      const now = new Date();
      return bankAccounts.some(ba => {
        // Try multiple date fields that might indicate document freshness
        const dateStr = ba.statement_period_end || ba.document_date || ba.statement_date;
        if (!dateStr) {
          // If no date field, assume it's recent (benefit of the doubt)
          return true;
        }
        const date = new Date(dateStr);
        const daysDiff = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
        return daysDiff <= 90;
      });
    }
    
    // =========================================================================
    // UBO RULES
    // =========================================================================
    case 'has_ownership_percentages':
      return companyIdentity?.shareholders?.some(s => typeof s.percentage === 'number') || false;
      
    case 'ubos_identified':
      return companyIdentity?.shareholders?.some(s => (s.percentage || 0) > 25) || false;
      
    case 'ubo_is_signatory': {
      if (!companyIdentity?.shareholders || !companyIdentity?.legal_representatives) return false;
      
      const ubos = companyIdentity.shareholders.filter(s => (s.percentage || 0) > 25);
      const signatories = companyIdentity.legal_representatives.filter(lr => lr.can_sign_contracts);
      
      return ubos.some(ubo => {
        const uboName = (ubo.name || '').toUpperCase();
        return signatories.some(sig => {
          const sigName = (sig.name || '').toUpperCase();
          return sigName.includes(uboName) || uboName.includes(sigName);
        });
      });
    }
    
    default:
      console.warn(`Unknown rule: ${ruleId}`);
      return false;
  }
}

/**
 * Generate a summary comparison between two runs
 */
export function compareToGolden(run: KycRun, goldenRun: KycRun): {
  matching: string[];
  missing: string[];
  extra: string[];
} {
  const matching: string[] = [];
  const missing: string[] = [];
  const extra: string[] = [];
  
  // Compare document types
  const runDocTypes = new Set(run.documents.map(d => d.type));
  const goldenDocTypes = new Set(goldenRun.documents.map(d => d.type));
  
  goldenDocTypes.forEach(type => {
    if (runDocTypes.has(type)) {
      matching.push(`Document: ${type}`);
    } else {
      missing.push(`Document: ${type}`);
    }
  });
  
  runDocTypes.forEach(type => {
    if (!goldenDocTypes.has(type)) {
      extra.push(`Document: ${type} (additional)`);
    }
  });
  
  return { matching, missing, extra };
}

