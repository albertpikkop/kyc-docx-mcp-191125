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

export function resolveUbo(profile: KycProfile): UboInfo[] {
  if (!profile.companyIdentity || !profile.companyIdentity.shareholders) {
    return [];
  }

  const shareholders = profile.companyIdentity.shareholders;
  
  // Filter > 25% ownership
  // If percentage is null, we can't determine UBO mathematically, but if is_beneficial_owner is true, include it.
  // We prioritize explicit percentage.
  
  const ubos: UboInfo[] = [];
  
  for (const s of shareholders) {
      let isUbo = false;
      let pct: number | null = null;

    if (s.percentage !== null && s.percentage !== undefined) {
        let fraction = s.percentage;
        if (fraction > 1) {
            fraction = fraction / 100;
        }
        if (fraction > 0.25) {
            isUbo = true;
        }
        pct = fraction * 100;
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

export function resolveSignatories(profile: KycProfile): SignatoryInfo[] {
  if (!profile.companyIdentity || !profile.companyIdentity.legal_representatives) {
    return [];
  }

  return profile.companyIdentity.legal_representatives.map(rep => {
      let scope: "full" | "limited" | "none" = "none";
      
      const roleUpper = rep.role.toUpperCase();
      const powers = (rep.poder_scope || []).join(' ').toUpperCase();
      
      // Heuristics for scope
      const hasDomino = powers.includes("DOMINIO");
      const hasAdmin = powers.includes("ADMINISTRACIÓN") || powers.includes("ADMINISTRACION");
      const hasPleitos = powers.includes("PLEITOS");
      const hasTitulos = powers.includes("TÍTULOS") || powers.includes("TITULOS");
      
      if (rep.can_sign_contracts) {
          if (hasDomino && hasAdmin && hasPleitos) {
              scope = "full";
          } else if (hasAdmin || hasPleitos || roleUpper.includes("APODERADO")) {
              scope = "limited"; // Or full? Prompt says "limited" for fiscal/admin tasks only.
              // Let's match prompt rules:
              // scope = "full" for general powers (pleitos, administración, dominio, títulos de crédito, laborales).
              // scope = "limited" for powers restricted to fiscal/administrative tasks.
              
              if (hasDomino && hasTitulos) {
                   scope = "full";
              } else {
                   scope = "limited";
              }
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
