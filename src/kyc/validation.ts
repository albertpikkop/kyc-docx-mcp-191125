import { KycProfile, KycValidationResult, KycValidationFlag, TraceSection, UboTrace, AddressEvidenceTrace, PowerTrace, FreshnessTrace } from './types.js';
import { differenceInDays } from "date-fns";
import { DEMO_CONFIG } from '../core/demoConfig.js';

// --- 0. Persona Física Detection ---

/**
 * Detects if the profile represents a Persona Física (individual) vs Persona Moral (corporate)
 * Triggers PF Mode when:
 * - SAT Constancia shows "Régimen: Persona Física" OR
 * - SAT Constancia shows "Régimen: Sin obligaciones fiscales" OR
 * - No Acta uploaded AND RFC pattern = persona física (ends with letters/numbers, not "KQ7" corporate pattern)
 */
export function isPersonaFisica(profile: KycProfile): boolean {
  // Check SAT Constancia tax regime
  if (profile.companyTaxProfile?.tax_regime) {
    const regime = profile.companyTaxProfile.tax_regime.toUpperCase();
    if (regime.includes('PERSONA FÍSICA') || regime.includes('PERSONA FISICA') || 
        regime.includes('SIN OBLIGACIONES FISCALES') || regime === 'SIN OBLIGACIONES FISCALES') {
      return true;
    }
  }

  // Check if no Acta AND RFC pattern suggests persona física
  if (!profile.companyIdentity && profile.companyTaxProfile?.rfc) {
    const rfc = profile.companyTaxProfile.rfc.toUpperCase();
    // Persona Física RFC pattern: ends with 3 letters/numbers (e.g., "CEDE981004E67")
    // Persona Moral RFC pattern: ends with "KQ7", "KQ8", etc. (e.g., "PFD210830KQ7")
    const personaFisicaPattern = /^[A-Z]{4}\d{6}[A-Z0-9]{3}$/;
    const personaMoralPattern = /^[A-Z]{3}\d{6}[A-Z]{1}\d{1}$/;
    
    if (personaFisicaPattern.test(rfc) && !personaMoralPattern.test(rfc)) {
      return true;
    }
  }

  return false;
}

// --- 1. Address Resolution ---

/**
 * Resolves key addresses from the profile data.
 */
export function resolveAddresses(profile: KycProfile): KycProfile {
  // If fiscal address is missing but we have Tax Profile, we map it again to be safe.
  if (!profile.currentFiscalAddress && profile.companyTaxProfile?.fiscal_address) {
      profile.currentFiscalAddress = profile.companyTaxProfile.fiscal_address;
  }
  
  // If operational address is missing, we try to find one from evidence
  if (!profile.currentOperationalAddress) {
      // Try Bank (in full mode) or Bank Identity (in demo mode)
      let bankAddress: any = null;
      if (DEMO_CONFIG.enabled && profile.bankIdentity?.address_on_file) {
          bankAddress = profile.bankIdentity.address_on_file;
      } else {
          const bank = profile.bankAccounts.find(b => b.address_on_statement);
          if (bank) bankAddress = bank.address_on_statement;
      }

      if (bankAddress) {
          profile.currentOperationalAddress = bankAddress;
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
  usedShares: boolean;
}

export function checkEquityConsistency(profile: KycProfile): EquityConsistencyResult | null {
    if (!profile.companyIdentity || !profile.companyIdentity.shareholders || profile.companyIdentity.shareholders.length === 0) {
        return null;
    }
    
    const shareholders = profile.companyIdentity.shareholders;
    let sumOfSharesFromHolders = 0;
    let hasShares = false;

    // DEBUG LOGGING
    // console.log("Checking equity consistency...");
    // shareholders.forEach(s => console.log(`Shareholder: ${s.name}, Shares: ${s.shares} (${typeof s.shares})`));

    for (const s of shareholders) {
        if (s.shares !== null && s.shares !== undefined) {
            sumOfSharesFromHolders += Number(s.shares); // Ensure number coercion
            hasShares = true;
        }
    }

    // Re-calculate percentages from shares if shares are available
    let sumOfPercentages = 0;
    let percentages: number[] = [];
    let usedShares = false;
    
    if (hasShares && sumOfSharesFromHolders > 0) {
        usedShares = true;
        for (const s of shareholders) {
            const shareCount = Number(s.shares) || 0;
            const pct = (shareCount / sumOfSharesFromHolders) * 100;
            percentages.push(pct);
            sumOfPercentages += pct;
        }
    } else {
        // Fallback to extracted percentages if shares are missing
        usedShares = false;
        for (const s of shareholders) {
            if (s.percentage !== null && s.percentage !== undefined) {
                percentages.push(s.percentage);
                sumOfPercentages += s.percentage;
            }
        }
    }
    
    // console.log(`Used Shares: ${usedShares}, Sum %: ${sumOfPercentages}`);

    const deviationFrom100 = Math.abs(sumOfPercentages - 100);
    const totalSharesFromActa = null; // Not always extracted separately

    return {
        totalSharesFromActa,
        sumOfSharesFromHolders,
        sumOfPercentages,
        deviationFrom100,
        usedShares
    };
}

export function resolveUbo(profile: KycProfile): UboInfo[] {
  if (!profile.companyIdentity || !profile.companyIdentity.shareholders) {
    return [];
  }

  const shareholders = profile.companyIdentity.shareholders;
  
  // Canonical recalculation for UBO check too
  let totalShares = 0;
  shareholders.forEach(s => { totalShares += (s.shares || 0); });
  
  const ubos: UboInfo[] = [];
  
    for (const s of shareholders) {
        let isUbo = false;
        let pct: number | null = null;

        // Prefer calculated percentage if total shares available
        if (totalShares > 0 && s.shares !== null && s.shares !== undefined) {
            pct = (s.shares / totalShares) * 100;
        } else {
            pct = s.percentage ?? null;
        }

        if (pct !== null && pct > 25) {
            isUbo = true;
        } else if (s.is_beneficial_owner) {
            // Fallback if calculation fails but extracted metadata says yes
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
  matchedPhrases?: string[];
  missingPowers?: string[];
  limitations?: string[];
  sourceReference?: string;
}

// Strict Regex Patterns for Mexican Powers
const POWER_PATTERNS = {
  pleitos: /PLEITOS? Y COBRANZAS?/i,
  administracion: /ACTOS? DE ADMINISTRACI[ÓO]N/i,
  dominio: /ACTOS? DE DOMINIO/i,
  titulosCredito: /T[ÍI]TULOS? DE CR[ÉE]DITO/i,
};

export function resolveSignatories(profile: KycProfile): SignatoryInfo[] {
  if (!profile.companyIdentity || !profile.companyIdentity.legal_representatives) {
    return [];
  }

  // First pass: map to SignatoryInfo with STRICT classification based on Acta text only
  const rawSignatories = profile.companyIdentity.legal_representatives.map(rep => {
      let scope: "full" | "limited" | "none" = "none";
      const matchedPhrases: string[] = [];
      const missingPowers: string[] = [];
      const limitations: string[] = [];
      
      const roleUpper = rep.role.toUpperCase();
      // Combine all power scopes into one string for regex matching
      const powersText = (rep.poder_scope || []).join(' ').toUpperCase();
      
      // Check for explicit labels: person must be explicitly labeled as "apoderado especial" or "apoderado limitado"
      // NOT just if the word "especial" appears in power clauses (which could refer to granting powers to others)
      const isExplicitlyEspecial = roleUpper.includes("APODERADO ESPECIAL") || 
                                   roleUpper.includes("ESPECIAL APODERADO") ||
                                   roleUpper.includes("APODERADO LIMITADO") ||
                                   roleUpper.includes("LIMITADO APODERADO");
      // CRITICAL: Only check for "poderes especiales" as a label, NOT "poder especial" which appears in power descriptions
      // "Poder especial para X" is a specific power grant, not a label that the person is an "apoderado especial"
      // We need to distinguish between:
      // - "apoderado especial" (role label) = LIMITED
      // - "poder especial para actos de dirección" (specific power) = can still be FULL if has all 4 canonical powers
      const hasEspecialPowersLabel = powersText.includes("PODERES ESPECIALES") || 
                                     powersText.includes("PODERES LIMITADOS");
      // Do NOT check for "PODER ESPECIAL" as it appears in power descriptions like "Poder especial para actos de dirección"
      const isExplicitlyLimited = isExplicitlyEspecial || hasEspecialPowersLabel;
      
      if (isExplicitlyLimited) {
          limitations.push("Explicitly labeled as 'Especial' or 'Limitado' in role or powers.");
      }
      
      // Match canonical power phrases
      const hasPleitos = POWER_PATTERNS.pleitos.test(powersText);
      const hasAdmin = POWER_PATTERNS.administracion.test(powersText);
      const hasDomino = POWER_PATTERNS.dominio.test(powersText);
      const hasTitulos = POWER_PATTERNS.titulosCredito.test(powersText);

      if (hasPleitos) matchedPhrases.push("PLEITOS Y COBRANZAS");
      else missingPowers.push("Pleitos y Cobranzas");

      if (hasAdmin) matchedPhrases.push("ACTOS DE ADMINISTRACIÓN");
      else missingPowers.push("Actos de Administración");

      if (hasDomino) matchedPhrases.push("ACTOS DE DOMINIO");
      else missingPowers.push("Actos de Dominio");

      if (hasTitulos) matchedPhrases.push("TÍTULOS DE CRÉDITO");
      else missingPowers.push("Títulos de Crédito");
      
      // STRICT CLASSIFICATION LOGIC:
      // 1. Only classify if can_sign_contracts is TRUE (extractor determined they have powers)
      // 2. FULL = ALL 4 canonical powers AND NOT explicitly labeled as "especial"
      // 3. LIMITED = Some powers OR explicitly labeled as "especial" OR missing any canonical power
      // 4. NONE = No powers OR officer roles without apoderado designation
      
      if (!rep.can_sign_contracts) {
          // No powers granted - set to none
          scope = "none";
          limitations.push("No 'Apoderado' designation found in extraction.");
      } else {
          // Check if this is an officer role WITHOUT apoderado designation
          const isOfficerOnly = (roleUpper.includes("SECRETARIO") || roleUpper.includes("VOCAL") || 
                                 roleUpper.includes("COMISARIO") || roleUpper.includes("CONSEJO")) &&
                                !roleUpper.includes("APODERADO");
          
          if (isOfficerOnly) {
              // Officers without explicit apoderado designation have NO powers
              scope = "none";
              limitations.push("Officer role (Secretario/Vocal) without explicit Apoderado grant.");
          } else if (isExplicitlyLimited) {
              // Explicitly labeled as "especial" or "limitado" OR has "poderes especiales" = LIMITED
              scope = "limited";
          } else if (hasPleitos && hasAdmin && hasDomino && hasTitulos) {
              // ALL 4 canonical powers AND not explicitly limited = FULL
              scope = "full";
          } else if (matchedPhrases.length > 0) {
              // Has some powers but not all 4 = LIMITED
              scope = "limited";
          } else {
              // Has can_sign_contracts but no matched phrases = LIMITED (fallback)
              scope = "limited";
              limitations.push("Has powers but no canonical power phrases matched.");
          }
      }

      return {
          name: rep.name,
          role: rep.role,
          scope,
          matchedPhrases,
          missingPowers,
          limitations,
          sourceReference: undefined
      };
  });

  // Deduplicate by name
  const mergedSignatories: SignatoryInfo[] = [];
  const map = new Map<string, SignatoryInfo>();

  for (const s of rawSignatories) {
      const existing = map.get(s.name);
      if (existing) {
          // Merge logic
          // Upgrade scope if new one is higher
          if (s.scope === "full") existing.scope = "full";
          else if (s.scope === "limited" && existing.scope === "none") existing.scope = "limited";
          
          // Concatenate roles if different
          if (!existing.role.includes(s.role)) {
              existing.role = `${existing.role} / ${s.role}`;
          }
          
          // Merge matched phrases
          if (s.matchedPhrases) {
              const newPhrases = s.matchedPhrases.filter(p => !existing.matchedPhrases?.includes(p));
              existing.matchedPhrases = [...(existing.matchedPhrases || []), ...newPhrases];
          }
          
          // Update missing powers (intersection: if one has it, it's not missing)
          // If existing has it (not in its missing), remove from new missing
          // Wait, missing needs to be intersection: if doc A misses X but doc B has X, then X is NOT missing.
          if (existing.missingPowers && s.matchedPhrases) {
             existing.missingPowers = existing.missingPowers.filter(mp => 
                !s.matchedPhrases?.some(ph => ph.toUpperCase().includes(mp.toUpperCase()))
             );
          }
          
          // Merge limitations? If one doc says limited, is he limited overall? 
          // Usually we take the BEST scope. So clear limitations if we found a full scope doc.
          if (existing.scope === 'full') {
              existing.limitations = [];
              existing.missingPowers = [];
          } else {
              // If still limited, maybe merge unique limitations
              if (s.limitations) {
                  const newLimits = s.limitations.filter(l => !existing.limitations?.includes(l));
                  existing.limitations = [...(existing.limitations || []), ...newLimits];
              }
          }

      } else {
          map.set(s.name, s);
          mergedSignatories.push(s);
      }
  }

  return Array.from(map.values());
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
  let maxAgeBank: number | null = null;
  
  if (DEMO_CONFIG.enabled && profile.bankIdentity && profile.bankIdentity.document_date) {
      const docDate = new Date(profile.bankIdentity.document_date);
      maxAgeBank = differenceInDays(asOf, docDate);
  } else if (profile.bankAccounts.length > 0) {
      const bankDates = profile.bankAccounts
          .map(b => b.statement_period_end)
          .filter(d => d !== null) as string[];
      
      if (bankDates.length > 0) {
          const sorted = bankDates.sort().reverse();
          const latest = new Date(sorted[0]);
          maxAgeBank = differenceInDays(asOf, latest);
      }
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

  // A. Detect Persona Física mode
  const isPF = isPersonaFisica(profile);

  // A. Resolve Addresses (Ensure strictly populated)
  resolveAddresses(profile);

  // B. Corporate checks (SKIP for Persona Física)
  if (!isPF) {
    // Compute & Log UBO/Signers (For debugging/info mostly, but could trigger rules)
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
        // Use a small tolerance (e.g. 1.0) instead of exact sum check
        if (equityCheck.deviationFrom100 > 2) {
            flags.push({ 
                code: "EQUITY_INCONSISTENT", 
                level: "critical", 
                message: `Share percentages sum to ${equityCheck.sumOfPercentages.toFixed(2)}%, which is inconsistent with 100%. Possible extraction error.` 
            });
            // Heavy penalty as this indicates bad extraction
            score -= 0.2; 
        } else if (equityCheck.deviationFrom100 > 1.0) { // Relaxed from 0.5 to 1.0 to handle rounding noise
            flags.push({ 
                code: "EQUITY_NEAR_100", 
                level: "warning", 
                message: `Share percentages sum to ${equityCheck.sumOfPercentages.toFixed(2)}%; likely rounding issue.` 
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
  }

  // D. Doc Coverage (PF Mode: Skip Acta requirement)
  if (!isPF && !profile.companyIdentity) {
    flags.push({ code: "LOW_DOC_COVERAGE", level: "critical", message: "Missing Company Identity (Acta Constitutiva)." });
    score -= 0.3;
  }
  if (!profile.companyTaxProfile) {
    flags.push({ code: "LOW_DOC_COVERAGE", level: "critical", message: "Missing Tax Profile (SAT Constancia)." });
    score -= 0.3;
  }
  if (profile.addressEvidence.length === 0 && !profile.bankIdentity && profile.bankAccounts.length === 0) {
      flags.push({ code: "LOW_DOC_COVERAGE", level: "critical", message: "No Proof of Address or Bank Statements provided." });
      score -= 0.2;
  }

  // PF Mode: Identity verification (INE/FM2 must match SAT)
  if (isPF) {
    // Check if identity document exists
    if (!profile.representativeIdentity) {
      flags.push({
        code: "LOW_DOC_COVERAGE",
        level: "critical",
        message: "Missing Identity Document (INE/FM2) for Persona Física."
      });
      score -= 0.2;
    }
    
    // Check if identity document matches SAT name (only if both exist)
    const satName = profile.companyTaxProfile?.razon_social;
    const identityName = profile.representativeIdentity?.full_name;
    
    if (satName && identityName) {
      // Normalize names for comparison (uppercase, trim, normalize spaces)
      const normalizeName = (name: string) => name.toUpperCase().trim().replace(/\s+/g, ' ');
      const satNormalized = normalizeName(satName);
      const identityNormalized = normalizeName(identityName);
      
      // Check if names are similar (allowing for word order differences)
      const satWords = new Set(satNormalized.split(' ').filter(w => w.length > 2));
      const identityWords = new Set(identityNormalized.split(' ').filter(w => w.length > 2));
      const commonWords = [...satWords].filter(w => identityWords.has(w));
      const matchRatio = commonWords.length / Math.max(satWords.size, identityWords.size);
      
      // Only flag if match ratio is low (less than 50% common words)
      if (matchRatio < 0.5) {
        flags.push({
          code: "IDENTITY_MISMATCH",
          level: "warning",
          message: `SAT name (${satName}) does not match identity document name (${identityName}).`
        });
        score -= 0.1;
      }
    }
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

// --- 6. Traceability Helper ---

export function buildTrace(profile: KycProfile): TraceSection {
  const trace: TraceSection = {};

  // 1) UBO trace
  const ubos = resolveUbo(profile); // existing helper returning UboInfo[]
  if (profile.companyIdentity?.shareholders && profile.companyIdentity.shareholders.length > 0) {
    const totalShares = profile.companyIdentity.shareholders
      .map(s => s.shares || 0)
      .reduce((a, b) => a + b, 0);
    
    trace.ubos = profile.companyIdentity.shareholders.map(sh => {
      const shares = sh.shares ?? null;
      const percentage = shares && totalShares ? (shares / totalShares) * 100 : null;
      const isUbo = ubos.some(u => u.name === sh.name);
      const uboThreshold = 25;

      return {
        name: sh.name,
        shares,
        totalShares,
        computedPercentage: percentage ? Number(percentage.toFixed(2)) : (sh.percentage ?? null), // Fallback to explicit percentage if share calc fails
        thresholdApplied: uboThreshold,
        isUbo,
      } as UboTrace;
    });
  }

  // 2) Address evidence trace
  const addressEvidence: AddressEvidenceTrace[] = [];
  
  // Founding Address (from Acta)
  if (profile.foundingAddress) {
      addressEvidence.push({
          role: "founding",
          address: profile.foundingAddress,
          sources: [{ type: "acta", description: "Acta Constitutiva (Domicilio Social)" }]
      });
  }
  
  // Fiscal Address (from SAT)
  if (profile.currentFiscalAddress) {
       addressEvidence.push({
          role: "fiscal",
          address: profile.currentFiscalAddress,
          sources: [{ type: "sat_constancia", description: "Constancia de Situación Fiscal" }]
      });
  }
  
  // Helper function to safely format address parts for trace descriptions
  const formatAddressForTrace = (addr: any): string => {
      if (!addr) return "";
      const parts: string[] = [];
      if (addr.street) parts.push(addr.street);
      if (addr.ext_number) parts.push(`No. ${addr.ext_number}`);
      return parts.join(" ");
  };

  // Operational Address (from Bank/PoA)
  if (profile.currentOperationalAddress) {
      const sources: AddressEvidenceTrace["sources"] = [];
      
      // Find matching PoAs
      profile.addressEvidence.forEach(poa => {
          const dateStr = poa.issue_datetime || poa.due_date || "N/A";
          const addrPart = poa.client_address ? formatAddressForTrace(poa.client_address) : "";
          sources.push({
              type: poa.document_type === "cfe_receipt" ? "cfe" : (poa.document_type === "telmex_bill" ? "telmex" : "other"),
              description: `${poa.vendor_name} (${dateStr})${addrPart ? ` - ${addrPart}` : ""}`
          });
      });

      // Find matching Bank Accounts / Identity
      if (DEMO_CONFIG.enabled && profile.bankIdentity && profile.bankIdentity.address_on_file) {
          const dateStr = profile.bankIdentity.document_date || "N/A";
          const addrPart = formatAddressForTrace(profile.bankIdentity.address_on_file);
          sources.push({
              type: "bank_identity_page" as any,
              description: `${profile.bankIdentity.bank_name} (${dateStr})${addrPart ? ` - ${addrPart}` : ""}`
          });
      } else {
          profile.bankAccounts.forEach(bank => {
              if (bank.address_on_statement) {
                 const addrPart = formatAddressForTrace(bank.address_on_statement);
                 sources.push({
                     type: "bank_statement",
                     description: `${bank.bank_name}${addrPart ? ` - ${addrPart}` : ""}`
                 });
              }
          });
      }
      
      addressEvidence.push({
          role: "operational",
          address: profile.currentOperationalAddress,
          sources: sources.length > 0 ? sources : [{ type: "other", description: "Inferred from Fiscal/Other" }]
      });
  }
  
  trace.addressEvidence = addressEvidence;

  // 3) Powers trace
  const signers = resolveSignatories(profile);
  trace.powers = signers.map(s => {
    return {
      personName: s.name,
      role: s.role,
      scope: s.scope,
      matchedPhrases: s.matchedPhrases ?? [],
      missingPowers: s.missingPowers,
      limitations: s.limitations,
      sourceReference: s.sourceReference
    } as PowerTrace;
  });

  // 4) Freshness trace
  const freshness = checkFreshness(profile, new Date());
  trace.freshness = freshness.map(f => {
      // Gather supporting docs for this type
      const docs: { type: string; date?: string; description?: string }[] = [];
      
      if (f.type === "proof_of_address") {
          profile.addressEvidence.forEach(d => {
              docs.push({
                  type: d.document_type,
                  date: d.issue_datetime || d.due_date || undefined,
                  description: d.vendor_name || undefined
              });
          });
      } else if (f.type === "bank_statement") {
          if (DEMO_CONFIG.enabled && profile.bankIdentity) {
              docs.push({
                  type: "bank_identity_page",
                  date: profile.bankIdentity.document_date || undefined,
                  description: profile.bankIdentity.bank_name
              });
          } else {
              profile.bankAccounts.forEach(b => {
                  docs.push({
                      type: "bank_statement",
                      date: b.statement_period_end || undefined,
                      description: b.bank_name || undefined
                  });
              });
          }
      } else if (f.type === "sat_constancia") {
           if (profile.companyTaxProfile?.issue?.issue_date) {
               docs.push({
                   type: "sat_constancia",
                   date: profile.companyTaxProfile.issue.issue_date,
                   description: "Fecha de emisión de Constancia"
               });
           }
      }

      return {
        docType: f.type,
        latestDate: null,
        ageInDays: f.maxAgeDays,
        withinThreshold: f.maxAgeDays !== null ? f.maxAgeDays <= 90 : false,
        thresholdDays: 90,
        supportingDocuments: docs
      } as FreshnessTrace;
  });

  // Backfill latestDate for freshness trace from docs
  trace.freshness.forEach(t => {
      if (t.supportingDocuments.length > 0) {
          const dates = t.supportingDocuments
             .map(d => d.date)
             .filter(d => !!d)
             .sort()
             .reverse();
          if (dates.length > 0) {
              t.latestDate = dates[0]!;
          }
      }
  });

  return trace;
}
