import { KycProfile, KycValidationResult, KycValidationFlag } from './types.js';
import { differenceInDays } from "date-fns";

// --- 1. Address Resolution ---

/**
 * Resolves key addresses from the profile data.
 * Note: This logic is partially mirrored in the Builder, but the Validation layer
 * ensures it is explicitly re-evaluated or verified for the final report.
 * The Builder populates the fields, this function validates/refines them if needed,
 * or simply passes through since the Builder already enforces precedence.
 * We will treat this as a pass-through verification step.
 */
export function resolveAddresses(profile: KycProfile): KycProfile {
  // Logic is already in Builder, but we ensure consistency here.
  // If fiscal address is missing but we have Tax Profile, we map it again to be safe.
  if (!profile.currentFiscalAddress && profile.companyTaxProfile?.fiscal_address) {
      profile.currentFiscalAddress = profile.companyTaxProfile.fiscal_address;
  }
  
  // If operational address is missing, we try to find one from evidence
  if (!profile.currentOperationalAddress) {
      // Try Bank
      const bank = profile.bankAccounts.find(b => b.address_on_statement);
      if (bank?.address_on_statement) {
          profile.currentOperationalAddress = bank.address_on_statement;
      } else {
          // Try PoA
          const poa = profile.addressEvidence.find(p => p.client_address);
          if (poa?.client_address) {
              profile.currentOperationalAddress = poa.client_address;
          } else if (profile.currentFiscalAddress) {
              // Fallback
              profile.currentOperationalAddress = profile.currentFiscalAddress;
          }
      }
  }
  
  return profile;
}

// --- 2. UBO Helper ---

export interface UboInfo {
  name: string;
  percentage: number | null;
}

export interface EquityConsistencyResult {
  totalSharesFromActa: number | null;
  sumOfSharesFromHolders: number;
  sumOfPercentages: number;
  deviationFrom100: number;
}

export function checkEquityConsistency(profile: KycProfile): EquityConsistencyResult | null {
    if (!profile.companyIdentity || !profile.companyIdentity.shareholders || profile.companyIdentity.shareholders.length === 0) {
        return null;
    }
    
    const shareholders = profile.companyIdentity.shareholders;
    let sumOfSharesFromHolders = 0;
    let sumOfPercentages = 0;
    let hasShares = false;
    let hasPct = false;

    for (const s of shareholders) {
        if (s.shares !== null && s.shares !== undefined) {
            sumOfSharesFromHolders += s.shares;
            hasShares = true;
        }
        if (s.percentage !== null && s.percentage !== undefined) {
            sumOfPercentages += s.percentage;
            hasPct = true;
        }
    }
    
    // If we don't have percentage data, try to compute from shares if possible
    if (!hasPct && hasShares && sumOfSharesFromHolders > 0) {
         // Re-calc percentages? Not strictly needed for this check unless we backfill
         // But we return sumOfPercentages as 0 or implicit 100 if we trust shares?
         // If we only have shares, we can't check deviation from 100% unless we assume total shares = sum
         // Deviation check is mainly for when we HAVE percentages.
    }

    // If we have NO percentage data, we can't validate 100% sum.
    if (!hasPct) {
        return null;
    }

    const deviationFrom100 = Math.abs(sumOfPercentages - 100);
    
    // Note: totalSharesFromActa isn't directly in the schema as a top-level field in CompanyIdentitySchema
    // It might be inferred or we'd need to look at capital rules. 
    // For now we set it to null as the schema doesn't explicitly carry "Total Authorized Shares" separately from shareholders.
    const totalSharesFromActa = null;

    return {
        totalSharesFromActa,
        sumOfSharesFromHolders,
        sumOfPercentages,
        deviationFrom100
    };
}

export function resolveUbo(profile: KycProfile): UboInfo[] {
  if (!profile.companyIdentity || !profile.companyIdentity.shareholders) {
    return [];
  }

  const shareholders = profile.companyIdentity.shareholders;
  
  // Filter > 25% ownership
  // If percentage is null, we can't determine UBO mathematically, but if is_beneficial_owner is true, include it.
  // We prioritize explicit percentage.
  
    const ubos: UboInfo[] = [];
  
    // Detect scale: Removed legacy guessing logic. We now rely on strict schema/prompt enforcement (0-100).
    // const validPercentages = ... (removed)
    
    for (const s of shareholders) {
        let isUbo = false;
        let pct: number | null = null;

        if (s.percentage !== null && s.percentage !== undefined) {
            let val = s.percentage;
            
            // PRODUCTION GRADE FIX: 
            // We now strictly enforce 0-100 scale in the LLM prompt and Schema.
            // The calculation comes directly from the shares vs total shares logic.
            // We should NOT scale or modify the percentage unless we are re-calculating it from raw shares.
            // BUT, if we see percentages > 1.0, we assume they are already 0-100.
            
            if (val > 25) {
                isUbo = true;
            }
            pct = val;
        } else if (s.is_beneficial_owner) {
            isUbo = true;
        }

        if (isUbo) {
            ubos.push({ name: s.name, percentage: pct });
        }
    }
    
    return ubos;
}

// --- 3. Signatory Helper ---

export interface SignatoryInfo {
  name: string;
  role: string;
  scope: "full" | "limited" | "none";
}

// Strict Regex Patterns for Mexican Powers
const POWER_PATTERNS = {
  pleitos: /PLEITOS? Y COBRANZAS?/i,
  administracion: /ACTOS? DE ADMINISTRACI[ÓO]N/i,
  dominio: /ACTOS? DE DOMINIO/i,
  titulosCredito: /T[ÍI]TULOS? DE CR[ÉE]DITO/i,
  // laborales: /(PODERES|FACULTADES).+LABORALES?/i // Optional depending on strictness
};

export function resolveSignatories(profile: KycProfile): SignatoryInfo[] {
  if (!profile.companyIdentity || !profile.companyIdentity.legal_representatives) {
    return [];
  }

  return profile.companyIdentity.legal_representatives.map(rep => {
      let scope: "full" | "limited" | "none" = "none";
      
      const roleUpper = rep.role.toUpperCase();
      // Combine all power scopes into one string for regex matching
      const powersText = (rep.poder_scope || []).join(' ').toUpperCase();
      
      const hasPleitos = POWER_PATTERNS.pleitos.test(powersText);
      const hasAdmin = POWER_PATTERNS.administracion.test(powersText);
      const hasDomino = POWER_PATTERNS.dominio.test(powersText);
      const hasTitulos = POWER_PATTERNS.titulosCredito.test(powersText);
      
      if (rep.can_sign_contracts) {
          // STRICT DEFINITION OF FULL POWERS:
          // Must have Admin + Dominio + Pleitos (General Powers)
          // Títulos de crédito is often included but Admin+Dominio is the core high-risk set.
          // User specified: "scope = 'full' if pleitos + administracion + dominio + titulosCredito present"
          
          if (hasPleitos && hasAdmin && hasDomino && hasTitulos) {
              scope = "full";
          } else if (hasPleitos && hasAdmin && hasDomino) {
              // Almost full, but missing titulos. Usually treated as full for corporate acts.
              // Strict per user request: "limited" if only some present.
              // But practically, Admin+Dominio is the highest power level.
              // We will stick to the strict 4-set if user requested, or reasonable 3-set.
              // User example: "scope = 'full' if pleitos + administracion + dominio + titulosCredito present;"
              scope = "limited"; 
          } else if (hasAdmin || hasPleitos || roleUpper.includes("APODERADO")) {
              scope = "limited";
          } else {
              scope = "limited";
          }
      }
      
      // Council positions without powers
      if (roleUpper.includes("SECRETARIO") || roleUpper.includes("VOCAL") || roleUpper.includes("COMISARIO")) {
          if (!rep.has_poder) {
              scope = "none";
          }
      }

      return {
          name: rep.name,
          role: rep.role,
          scope
      };
  });
}

// --- 4. Document Freshness Helper ---

export interface FreshnessInfo {
  type: "proof_of_address" | "bank_statement" | "sat_constancia";
  maxAgeDays: number | null;
}

export function checkFreshness(profile: KycProfile, asOf: Date = new Date()): FreshnessInfo[] {
  const results: FreshnessInfo[] = [];

  // 1. Proof of Address (Telmex/CFE)
  const poaDates = profile.addressEvidence
      .map(d => d.issue_datetime || d.due_date)
      .filter(d => d !== null) as string[];
  
  let maxAgePoa: number | null = null;
  if (poaDates.length > 0) {
      // Find most recent date
      const sorted = poaDates.sort().reverse();
      const latest = new Date(sorted[0]);
      maxAgePoa = differenceInDays(asOf, latest);
  }
  results.push({ type: "proof_of_address", maxAgeDays: maxAgePoa });

  // 2. Bank Statements
  const bankDates = profile.bankAccounts
      .map(b => b.statement_period_end)
      .filter(d => d !== null) as string[];
      
  let maxAgeBank: number | null = null;
  if (bankDates.length > 0) {
      const sorted = bankDates.sort().reverse();
      const latest = new Date(sorted[0]);
      maxAgeBank = differenceInDays(asOf, latest);
  }
  results.push({ type: "bank_statement", maxAgeDays: maxAgeBank });

  // 3. SAT Constancia
  let maxAgeSat: number | null = null;
  if (profile.companyTaxProfile?.issue?.issue_date) {
      const issueDate = new Date(profile.companyTaxProfile.issue.issue_date);
      maxAgeSat = differenceInDays(asOf, issueDate);
  }
  results.push({ type: "sat_constancia", maxAgeDays: maxAgeSat });

  return results;
}

// --- 5. Main Validation Function ---

/**
 * Validates a KYC Profile against business rules with advanced logic.
 */
export function validateKycProfile(profile: KycProfile): KycValidationResult {
  const flags: KycValidationFlag[] = [];
  let score = 1.0;

  // A. Resolve Addresses (Ensure strictly populated)
  resolveAddresses(profile);

  // B. Compute & Log UBO/Signers (For debugging/info mostly, but could trigger rules)
  const ubos = resolveUbo(profile);
  if (ubos.length === 0) {
      flags.push({
          code: "OTHER",
          level: "warning",
          message: "No UBOs (>25%) detected from shareholder structure."
      });
      score -= 0.1;
  }

  // Equity Consistency Check
  const equityCheck = checkEquityConsistency(profile);
  if (equityCheck) {
      if (equityCheck.deviationFrom100 > 2) {
          flags.push({ 
              code: "EQUITY_INCONSISTENT", 
              level: "critical", 
              message: `Share percentages sum to ${equityCheck.sumOfPercentages}%, which is inconsistent with 100%. Possible extraction error.` 
          });
          // Heavy penalty as this indicates bad extraction
          score -= 0.2; 
      } else if (equityCheck.deviationFrom100 > 0.5) {
          flags.push({ 
              code: "EQUITY_NEAR_100", 
              level: "warning", 
              message: `Share percentages sum to ${equityCheck.sumOfPercentages}%; likely rounding issue.` 
          });
          score -= 0.05;
      }
  }

  const signatories = resolveSignatories(profile);
  const fullSigners = signatories.filter(s => s.scope === "full");
  if (fullSigners.length === 0) {
       flags.push({
          code: "OTHER",
          level: "warning",
          message: "No Full Power signatories detected."
      });
      score -= 0.1;
  }

  // C. Address Consistency
  const fiscalAddress = profile.currentFiscalAddress;
  const operationalAddress = profile.currentOperationalAddress;

  if (fiscalAddress && operationalAddress) {
    const fiscalZip = fiscalAddress.cp;
    const opZip = operationalAddress.cp;

    if (fiscalZip && opZip && fiscalZip !== opZip) {
       flags.push({
         code: "ADDRESS_MISMATCH",
         level: "warning",
         message: `Fiscal Zip (${fiscalZip}) does not match Operational Zip (${opZip}).`
       });
       score -= 0.1;
    }
    
    // Could add more fuzzy matching here (municipio, street)
  } else if (!fiscalAddress || !operationalAddress) {
      // Don't penalize twice if missing doc penalizes below, but good to flag specific data gap
      // flags.push({ ... }); 
  }

  // D. Doc Coverage
  if (!profile.companyIdentity) {
    flags.push({ code: "LOW_DOC_COVERAGE", level: "critical", message: "Missing Company Identity (Acta Constitutiva)." });
    score -= 0.3;
  }
  if (!profile.companyTaxProfile) {
    flags.push({ code: "LOW_DOC_COVERAGE", level: "critical", message: "Missing Tax Profile (SAT Constancia)." });
    score -= 0.3;
  }
  if (profile.addressEvidence.length === 0 && profile.bankAccounts.length === 0) {
      flags.push({ code: "LOW_DOC_COVERAGE", level: "critical", message: "No Proof of Address or Bank Statements provided." });
      score -= 0.2;
  }

  // E. Freshness
  const freshness = checkFreshness(profile);
  const poaFreshness = freshness.find(f => f.type === "proof_of_address");
  
  if (poaFreshness && poaFreshness.maxAgeDays !== null && poaFreshness.maxAgeDays > 90) {
      flags.push({
          code: "OTHER",
          level: "warning",
          message: `Latest Proof of Address is older than 90 days (${poaFreshness.maxAgeDays} days).`
      });
      score -= 0.1;
  }

  return {
    customerId: profile.customerId,
    score: Math.max(0, score),
    flags,
    generatedAt: new Date().toISOString()
  };
}
