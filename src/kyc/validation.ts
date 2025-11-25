import { KycProfile, KycValidationResult, KycValidationFlag, TraceSection, UboTrace, AddressEvidenceTrace, PowerTrace, FreshnessTrace } from './types.js';
import { differenceInDays } from "date-fns";
import { DEMO_CONFIG } from '../core/demoConfig.js';

// --- 0. Entity Type Classification ---

/**
 * Entity Type Classification for Mexican Tax Entities
 * 
 * Three main categories based on SAT Constancia:
 * 
 * 1. PERSONA_MORAL - Corporate entities (S.A., S.A.P.I., S.C., etc.)
 *    - Has Acta Constitutiva
 *    - RFC pattern: 3 letters + 6 digits + 3 homoclave (e.g., "PFD210830KQ7")
 *    - Examples: PFDS SAPI DE CV, Grupo Pounj SA DE CV
 * 
 * 2. PERSONA_FISICA_EMPRESARIAL - Individual with business activity
 *    - Has registered economic activities in SAT
 *    - RFC pattern: 4 letters + 6 digits + 3 homoclave (e.g., "GAPA750101ABC")
 *    - Tax regimes: "Actividades Empresariales", "RESICO", "RIF", etc.
 * 
 * 3. PERSONA_FISICA_SIN_OBLIGACIONES - Individual without tax obligations
 *    - Registered in RFC but NO economic activities
 *    - Tax regime: "Sin obligaciones fiscales"
 *    - Examples: Students, housewives, people needing RFC for banking only
 *    - Like: Enrique Cello (CEDE981004E67)
 */
export type EntityType = 
  | 'PERSONA_MORAL'                    // Corporate entity (S.A., S.A.P.I., etc.)
  | 'PERSONA_FISICA_EMPRESARIAL'       // Individual with business activities
  | 'PERSONA_FISICA_SIN_OBLIGACIONES'  // Individual without tax obligations
  | 'UNKNOWN';

/**
 * Classifies the entity type based on SAT Constancia data
 */
export function classifyEntityType(profile: KycProfile): EntityType {
  const taxProfile = profile.companyTaxProfile;
  const hasActa = !!profile.companyIdentity;
  
  // 1. Check RFC pattern first
  if (taxProfile?.rfc) {
    const rfc = taxProfile.rfc.toUpperCase().trim();
    const personaMoralPattern = /^[A-Z]{3}\d{6}[A-Z0-9]{3}$/;  // 3 letters = corporate
    const personaFisicaPattern = /^[A-Z]{4}\d{6}[A-Z0-9]{3}$/; // 4 letters = individual
    
    // If RFC indicates Persona Moral
    if (personaMoralPattern.test(rfc) && hasActa) {
      return 'PERSONA_MORAL';
    }
    
    // If RFC indicates Persona Física, check tax regime
    if (personaFisicaPattern.test(rfc)) {
      return classifyPersonaFisicaSubtype(taxProfile);
    }
  }
  
  // 2. Fallback to tax regime analysis
  if (taxProfile?.tax_regime) {
    const regime = taxProfile.tax_regime.toUpperCase();
    
    // Check for "Sin obligaciones fiscales"
    if (regime.includes('SIN OBLIGACIONES')) {
      return 'PERSONA_FISICA_SIN_OBLIGACIONES';
    }
    
    // Check for business-related regimes
    if (regime.includes('ACTIVIDAD') || regime.includes('EMPRESARIAL') || 
        regime.includes('PROFESIONAL') || regime.includes('RESICO') ||
        regime.includes('RIF') || regime.includes('SIMPLIFICADO')) {
      return hasActa ? 'PERSONA_MORAL' : 'PERSONA_FISICA_EMPRESARIAL';
    }
    
    // Check for explicit Persona Física indicators
    if (regime.includes('PERSONA FÍSICA') || regime.includes('PERSONA FISICA')) {
      return classifyPersonaFisicaSubtype(taxProfile);
    }
  }
  
  // 3. If has Acta, it's corporate
  if (hasActa) {
    return 'PERSONA_MORAL';
  }
  
  return 'UNKNOWN';
}

/**
 * Helper: Classify Persona Física subtype based on activities
 */
function classifyPersonaFisicaSubtype(taxProfile: any): EntityType {
  const regime = (taxProfile?.tax_regime || '').toUpperCase();
  const hasActivities = taxProfile?.economic_activities && taxProfile.economic_activities.length > 0;
  
  // "Sin obligaciones fiscales" = no tax obligations
  if (regime.includes('SIN OBLIGACIONES')) {
    return 'PERSONA_FISICA_SIN_OBLIGACIONES';
  }
  
  // Has economic activities registered
  if (hasActivities) {
    return 'PERSONA_FISICA_EMPRESARIAL';
  }
  
  // Has business-related regime keywords
  if (regime.includes('ACTIVIDAD') || regime.includes('EMPRESARIAL') || 
      regime.includes('PROFESIONAL') || regime.includes('RESICO') ||
      regime.includes('ARRENDAMIENTO') || regime.includes('RIF')) {
    return 'PERSONA_FISICA_EMPRESARIAL';
  }
  
  // Default: if no activities and no business keywords, likely sin obligaciones
  return 'PERSONA_FISICA_SIN_OBLIGACIONES';
}

/**
 * Get human-readable entity type label
 */
export function getEntityTypeLabel(entityType: EntityType, language: 'es' | 'en' = 'es'): string {
  const labels: Record<EntityType, { es: string; en: string }> = {
    'PERSONA_MORAL': {
      es: 'Persona Moral (Empresa)',
      en: 'Legal Entity (Corporation)'
    },
    'PERSONA_FISICA_EMPRESARIAL': {
      es: 'Persona Física con Actividad Empresarial',
      en: 'Individual with Business Activity'
    },
    'PERSONA_FISICA_SIN_OBLIGACIONES': {
      es: 'Persona Física Sin Obligaciones Fiscales',
      en: 'Individual without Tax Obligations'
    },
    'UNKNOWN': {
      es: 'Tipo de Entidad Desconocido',
      en: 'Unknown Entity Type'
    }
  };
  
  return labels[entityType][language];
}

/**
 * Get client onboarding type label for reports
 */
export function getClientOnboardingLabel(entityType: EntityType): string {
  switch (entityType) {
    case 'PERSONA_MORAL':
      return 'Alta de Cliente - Persona Moral (Empresa)';
    case 'PERSONA_FISICA_EMPRESARIAL':
      return 'Alta de Cliente - Persona Física con Actividad Empresarial';
    case 'PERSONA_FISICA_SIN_OBLIGACIONES':
      return 'Alta de Cliente - Persona Física (Sin Actividad Económica Registrada)';
    default:
      return 'Alta de Cliente';
  }
}

/**
 * Legacy function: Detects if the profile represents a Persona Física (individual) vs Persona Moral (corporate)
 * @deprecated Use classifyEntityType() for more detailed classification
 */
export function isPersonaFisica(profile: KycProfile): boolean {
  const entityType = classifyEntityType(profile);
  return entityType === 'PERSONA_FISICA_EMPRESARIAL' || entityType === 'PERSONA_FISICA_SIN_OBLIGACIONES';
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
  percentage: number | null;          // Total ownership percentage (all shares)
  votingPercentage?: number | null;   // Voting percentage (only voting shares)
  hasVotingRights?: boolean;          // Whether this shareholder's shares have voting rights
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

/**
 * Resolves Ultimate Beneficial Owners (UBOs) from shareholder structure.
 * 
 * CRITICAL LEGAL NOTE (per Arturo's comment):
 * UBO calculation should ONLY count VOTING SHARES for control determination.
 * - Serie A / Acciones Ordinarias = VOTING shares (count for UBO)
 * - Serie B / Acciones Preferentes = NON-VOTING shares (do NOT count for control)
 * 
 * Per LGSM (Ley General de Sociedades Mercantiles), preferred shares typically
 * have priority in dividends but NO voting rights in ordinary assemblies.
 * 
 * A person with 30% of Serie B shares does NOT control the company because
 * they cannot vote in shareholder assemblies.
 */
export function resolveUbo(profile: KycProfile): UboInfo[] {
  if (!profile.companyIdentity || !profile.companyIdentity.shareholders) {
    return [];
  }

  const shareholders = profile.companyIdentity.shareholders;
  
  // Calculate TOTAL VOTING SHARES only (exclude preferred/non-voting shares)
  let totalVotingShares = 0;
  let totalAllShares = 0;
  
  shareholders.forEach(s => { 
    const shares = s.shares || 0;
    totalAllShares += shares;
    
    // Determine if these are voting shares
    // Default to voting if not specified (conservative approach)
    const hasVotingRights = determineVotingRights(s);
    
    if (hasVotingRights) {
      totalVotingShares += shares;
    }
  });
  
  const ubos: UboInfo[] = [];
  
  for (const s of shareholders) {
    let isUbo = false;
    let pct: number | null = null;
    let votingPct: number | null = null;
    
    const shares = s.shares || 0;
    const hasVotingRights = determineVotingRights(s);
    
    // Calculate ownership percentage (total shares)
    if (totalAllShares > 0 && s.shares !== null && s.shares !== undefined) {
      pct = (shares / totalAllShares) * 100;
    } else {
      pct = s.percentage ?? null;
    }
    
    // Calculate VOTING percentage (only voting shares count for control)
    if (hasVotingRights && totalVotingShares > 0) {
      votingPct = (shares / totalVotingShares) * 100;
    } else if (!hasVotingRights) {
      // Non-voting shares = 0% voting control
      votingPct = 0;
    }
    
    // UBO determination: >25% of VOTING SHARES = control
    // Per FATF/GAFI and Mexican CNBV regulations, control is measured by voting power
    if (votingPct !== null && votingPct > 25) {
      isUbo = true;
    } else if (s.is_beneficial_owner) {
      // Fallback: if explicitly marked as beneficial owner (e.g., through other control mechanisms)
      isUbo = true;
    }
    
    if (isUbo) {
      ubos.push({ 
        name: s.name, 
        percentage: pct,
        votingPercentage: votingPct,
        hasVotingRights
      });
    }
  }
  
  return ubos;
}

/**
 * Determines if a shareholder's shares have voting rights.
 * 
 * Mexican corporate law (LGSM):
 * - Serie A / Acciones Ordinarias = typically have voting rights
 * - Serie B / Acciones Preferentes = typically NO voting rights
 * - Serie I = often ordinary (voting)
 * - Serie II = often preferred (no voting)
 * 
 * If has_voting_rights is explicitly set, use that.
 * Otherwise, infer from share_series and share_type.
 */
function determineVotingRights(shareholder: any): boolean {
  // 1. If explicitly set, use it
  if (shareholder.has_voting_rights === true) return true;
  if (shareholder.has_voting_rights === false) return false;
  
  // 2. Check share_type
  const shareType = (shareholder.share_type || '').toUpperCase();
  if (shareType.includes('PREFERENTE') || shareType.includes('PREFERRED')) {
    return false; // Preferred shares typically don't vote
  }
  if (shareType.includes('ORDINARIA') || shareType.includes('ORDINARY')) {
    return true; // Ordinary shares have voting rights
  }
  
  // 3. Check share_series
  const series = (shareholder.share_series || shareholder.class || '').toUpperCase();
  
  // Serie B, Serie II are typically preferred (non-voting)
  if (series.includes('SERIE B') || series.includes('SERIES B') || 
      series.includes('SERIE II') || series.includes('SERIES II') ||
      series === 'B' || series === 'II') {
    return false;
  }
  
  // Serie A, Serie I are typically ordinary (voting)
  if (series.includes('SERIE A') || series.includes('SERIES A') || 
      series.includes('SERIE I') || series.includes('SERIES I') ||
      series === 'A' || series === 'I') {
    return true;
  }
  
  // 4. Default: assume voting rights (conservative for UBO detection)
  // Better to flag potential UBOs than miss them
  return true;
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
  titulosCredito: /T[ÍI]TULOS? (?:DE|Y)(?:.*?)CR[ÉE]DITO/i,
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
      // CRITICAL: Only check for "poderes especiales" as a label in the ROLE.
      // Checking in powersText is risky because "otorgar poderes generales y especiales" is a common FULL power attribute.
      // We trust the 4 canonical powers check to determine fullness.
      const hasEspecialPowersLabel = false; // Disable text body check for "PODERES ESPECIALES" to avoid false positives on substitution clauses
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

// --- 4.5 Entity Coherence Helper ---

/**
 * Normalizes strings for flexible matching (razón social).
 * - Upper case
 * - Remove accents
 * - Remove punctuation
 * - Standardize spacing
 */
function normalizeString(str: string): string {
  if (!str) return "";
  
  // Standardize corporate suffixes to a single token: __CORP_SUFFIX__
  // This handles "S.A. DE C.V." vs "Sociedad Anónima de Capital Variable"
  const corpSuffixRegex = /\b(SOCIEDAD\s+AN[OÓ]NIMA\s+PROMOTORA\s+DE\s+INVERSI[OÓ]N\s+DE\s+CAPITAL\s+VARIABLE|SOCIEDAD\s+AN[OÓ]NIMA\s+DE\s+CAPITAL\s+VARIABLE|S\s*A\s*P\s*I\s*DE\s*C\s*V|S\s*A\s*DE\s*C\s*V)\b/g;

  return str
    .toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u0306f]/g, "") // Strip accents
    .replace(corpSuffixRegex, " __CORP_SUFFIX__ ")
    .replace(/[.,;:\-_]/g, " ") // Replace punctuation with space
    .replace(/\s+/g, " ") // Collapse spaces
    .trim();
}

export interface EntityCoherenceResult {
  isCoherent: boolean;
  reason?: string;
}

/**
 * Checks if Acta Constitutiva and SAT Constancia refer to the same entity.
 * Returns true if coherent (or if one document is missing, assuming coherent until proven otherwise).
 */
export function checkEntityCoherence(profile: KycProfile): EntityCoherenceResult {
  const acta = profile.companyIdentity;
  const sat = profile.companyTaxProfile;

  // Can only check consistency if both documents are present
  if (!acta || !sat) {
    return { isCoherent: true };
  }

  // 1. RFC Match (Exact, Case-Insensitive)
  // If Acta has no RFC, we can't validate it, so skip RFC check.
  if (acta.rfc && sat.rfc) {
    if (acta.rfc.toUpperCase().trim() !== sat.rfc.toUpperCase().trim()) {
      return { 
        isCoherent: false, 
        reason: `RFC Mismatch: Acta says '${acta.rfc}', SAT says '${sat.rfc}'.` 
      };
    }
  }

  // 2. Razón Social Match (Normalized)
  const actaName = normalizeString(acta.razon_social);
  const satName = normalizeString(sat.razon_social);

  // Handle SA DE CV variations explicitly if needed, but normalized comparison often catches it.
  // normalizeString removes dots, so "S.A. DE C.V." -> "S A DE C V" vs "SA DE CV" -> "SA DE CV".
  // Let's enhance normalization to remove spaces between single letters if needed, or just simple substring match?
  // Prompt requirements: "Remove abbreviations (“S.A. DE C.V.” ≈ “SA DE CV”)"
  
  // Let's do a more robust comparison: check if one is contained in the other or very similar.
  // Or simpler: strip spaces entirely for the comparison.
  const simpleActa = actaName.replace(/\s/g, "");
  const simpleSat = satName.replace(/\s/g, "");

  if (simpleActa !== simpleSat) {
      // Allow for "SA DE CV" difference if the core name matches
      // E.g. "GRUPO POUNJ SA DE CV" vs "GRUPO POUNJ"
      // Check if one starts with the other
      if (simpleActa.startsWith(simpleSat) || simpleSat.startsWith(simpleActa)) {
          // Acceptable partial match (e.g. missing suffix)
      } else {
          return { 
            isCoherent: false, 
            reason: `Razón Social Mismatch: Acta says '${acta.razon_social}', SAT says '${sat.razon_social}'.` 
          };
      }
  }

  return { isCoherent: true };
}

// --- 5. Main Validation Function ---

/**
 * Determines nationality from available identity documents
 * Returns: 'mexican' | 'foreign' | 'unknown'
 */
function determineNationality(profile: KycProfile): 'mexican' | 'foreign' | 'unknown' {
  const fm2Nationality = profile.representativeIdentity?.nationality?.toUpperCase() || null;
  const passportNationality = profile.passportIdentity?.nationality?.toUpperCase() || null;
  const passportIssuer = profile.passportIdentity?.issuer_country?.toUpperCase() || null;
  const ineDocType = profile.representativeIdentity?.document_type?.toUpperCase() || null;
  
  // Mexican indicators
  const mexicanNationalityTerms = ['MEXICANA', 'MEXICANO', 'MEXICO', 'MX', 'MEX'];
  
  // If document is INE, the person is definitely Mexican (only Mexican citizens can have INE)
  if (ineDocType === 'INE' || ineDocType === 'IFE') {
    return 'mexican';
  }
  
  // Check explicit nationality fields
  if (fm2Nationality && mexicanNationalityTerms.includes(fm2Nationality)) {
    return 'mexican';
  }
  if (passportNationality && mexicanNationalityTerms.includes(passportNationality)) {
    return 'mexican';
  }
  if (passportIssuer && mexicanNationalityTerms.includes(passportIssuer)) {
    return 'mexican';
  }
  
  // If we have FM2/FM3 with non-Mexican nationality, they're foreign
  if (fm2Nationality && !mexicanNationalityTerms.includes(fm2Nationality)) {
    return 'foreign';
  }
  
  // If passport is from non-Mexican country, they're foreign
  if (passportIssuer && !mexicanNationalityTerms.includes(passportIssuer)) {
    return 'foreign';
  }
  if (passportNationality && !mexicanNationalityTerms.includes(passportNationality)) {
    return 'foreign';
  }
  
  return 'unknown';
}

/**
 * Validates identity documents based on nationality and entity type
 * 
 * MEXICAN KYC REQUIREMENTS (Based on FATF-GAFI, CNBV, and SAT regulations):
 * 
 * 1. MEXICAN NATIONAL - PERSONA FÍSICA:
 *    - INE (Credencial para Votar) is sufficient
 *    - Passport NOT required (optional)
 *    - RFC required for tax purposes
 *    - Proof of address required
 * 
 * 2. MEXICAN NATIONAL - PERSONA MORAL (Legal Representative):
 *    - INE is sufficient for the representative
 *    - Passport NOT required
 *    - Acta Constitutiva required (proves powers)
 *    - SAT Constancia required
 * 
 * 3. FOREIGN NATIONAL - PERSONA FÍSICA:
 *    - Passport REQUIRED (primary identity from country of origin)
 *    - FM2/FM3/Tarjeta de Residente REQUIRED (proves legal status in Mexico)
 *    - CURP comes automatically with FM2/FM3
 *    - RFC required if conducting business activities
 * 
 * 4. FOREIGN NATIONAL - PERSONA MORAL (Legal Representative):
 *    - Passport REQUIRED (primary identity)
 *    - FM2/FM3 REQUIRED (proves legal right to work/represent in Mexico)
 *    - Mexican law requires legal representatives to have work authorization
 *    - Acta Constitutiva required (proves powers)
 *    - SAT Constancia required
 */
function validateIdentityDocuments(
  profile: KycProfile, 
  isPF: boolean, 
  nationality: 'mexican' | 'foreign' | 'unknown'
): { flags: KycValidationFlag[]; scorePenalty: number } {
  const flags: KycValidationFlag[] = [];
  let scorePenalty = 0;
  
  // Helper to check document types
  const repDocType = profile.representativeIdentity?.document_type?.toUpperCase() || '';
  const hasIne = !!profile.representativeIdentity?.document_number && 
                 (repDocType === 'INE' || repDocType === 'IFE');
  const hasFm2 = !!profile.representativeIdentity?.document_number && 
                 (repDocType === 'FM2' || repDocType === 'FM3' || 
                  repDocType.includes('RESIDENTE') || repDocType.includes('TEMPORAL') || 
                  repDocType.includes('PERMANENTE'));
  const hasPassport = !!profile.passportIdentity?.document_number;
  const hasCurp = !!profile.representativeIdentity?.curp;
  const hasAnyIdentity = hasIne || hasFm2 || hasPassport;
  
  // =========================================================
  // SCENARIO 1: MEXICAN NATIONAL - PERSONA FÍSICA
  // =========================================================
  if (nationality === 'mexican' && isPF) {
    // Mexican PF: INE alone is sufficient, passport optional
    if (!hasIne && !hasPassport) {
      flags.push({
        code: "REP_ID_MISMATCH",
        level: "critical",
        message: "Persona Física Mexicana: Falta identificación oficial (INE o Pasaporte Mexicano)."
      });
      scorePenalty += 0.3;
    }
    // Note: No FM2 needed for Mexican nationals
  }
  
  // =========================================================
  // SCENARIO 2: MEXICAN NATIONAL - PERSONA MORAL
  // =========================================================
  else if (nationality === 'mexican' && !isPF) {
    // Mexican PM Rep Legal: INE alone is sufficient
    if (!hasIne && !hasPassport) {
      flags.push({
        code: "REP_ID_MISMATCH",
        level: "critical",
        message: "Representante Legal Mexicano: Falta identificación oficial (INE o Pasaporte Mexicano). La INE es suficiente para ciudadanos mexicanos."
      });
      scorePenalty += 0.3;
    }
    // Note: Mexican nationals don't need FM2 - they have automatic right to work
  }
  
  // =========================================================
  // SCENARIO 3: FOREIGN NATIONAL - PERSONA FÍSICA
  // =========================================================
  else if (nationality === 'foreign' && isPF) {
    // Foreign PF: Need BOTH passport AND FM2/FM3
    // Per FATF-GAFI Mexico report: "original passport and documentation showing legal status"
    
    if (!hasPassport && !hasFm2) {
      flags.push({
        code: "REP_ID_MISMATCH",
        level: "critical",
        message: "Persona Física Extranjera: Faltan documentos de identidad. Se requiere Pasaporte (identidad) Y FM2/FM3 (estatus migratorio en México)."
      });
      scorePenalty += 0.3;
    } else if (!hasPassport) {
      flags.push({
        code: "LOW_DOC_COVERAGE",
        level: "critical",
        message: "Persona Física Extranjera: Falta Pasaporte. El pasaporte es el documento de identidad primario emitido por el país de origen."
      });
      scorePenalty += 0.2;
    } else if (!hasFm2) {
      flags.push({
        code: "LOW_DOC_COVERAGE",
        level: "critical",
        message: "Persona Física Extranjera: Falta FM2/FM3/Tarjeta de Residente. Este documento acredita el estatus migratorio legal en México."
      });
      scorePenalty += 0.2;
    }
    
    // CURP validation - should come with FM2
    if (hasFm2 && !hasCurp) {
      flags.push({
        code: "LOW_DOC_COVERAGE",
        level: "warning",
        message: "Extranjero con FM2 pero sin CURP detectado. Verificar que el FM2 incluya CURP válido."
      });
      scorePenalty += 0.05;
    }
  }
  
  // =========================================================
  // SCENARIO 4: FOREIGN NATIONAL - PERSONA MORAL
  // =========================================================
  else if (nationality === 'foreign' && !isPF) {
    // Foreign PM Rep Legal: Need BOTH passport AND FM2/FM3
    // Mexican law requires foreign legal representatives to have work authorization
    
    if (!hasPassport && !hasFm2) {
      flags.push({
        code: "REP_ID_MISMATCH",
        level: "critical",
        message: "Representante Legal Extranjero: Faltan documentos. Se requiere Pasaporte (identidad) Y FM2/FM3 (autorización para trabajar en México)."
      });
      scorePenalty += 0.3;
    } else if (!hasPassport) {
      flags.push({
        code: "LOW_DOC_COVERAGE",
        level: "critical",
        message: "Representante Legal Extranjero: Falta Pasaporte. El pasaporte acredita la identidad ante su país de origen."
      });
      scorePenalty += 0.2;
    } else if (!hasFm2) {
      flags.push({
        code: "LOW_DOC_COVERAGE",
        level: "critical",
        message: "Representante Legal Extranjero: Falta FM2/FM3. La ley mexicana requiere que representantes legales extranjeros tengan permiso de trabajo (FM2/FM3/Residente)."
      });
      scorePenalty += 0.2;
    }
    
    // CURP validation for foreign legal reps
    if (hasFm2 && !hasCurp) {
      flags.push({
        code: "LOW_DOC_COVERAGE",
        level: "warning",
        message: "Representante Extranjero: FM2 sin CURP. El CURP es necesario para trámites fiscales y bancarios."
      });
      scorePenalty += 0.05;
    }
    
    // Both documents present - verify names match
    if (hasPassport && hasFm2) {
      const passportName = profile.passportIdentity?.full_name?.toUpperCase().trim() || '';
      const fm2Name = profile.representativeIdentity?.full_name?.toUpperCase().trim() || '';
      
      if (passportName && fm2Name) {
        // Simple token-based matching
        const passportTokens = new Set(passportName.split(/\s+/).filter(t => t.length > 1));
        const fm2Tokens = new Set(fm2Name.split(/\s+/).filter(t => t.length > 1));
        
        let matchCount = 0;
        for (const token of passportTokens) {
          if (fm2Tokens.has(token)) matchCount++;
        }
        
        const matchRatio = matchCount / Math.min(passportTokens.size, fm2Tokens.size);
        
        if (matchRatio < 0.5) {
          flags.push({
            code: "IDENTITY_MISMATCH",
            level: "warning",
            message: `Los nombres en Pasaporte (${profile.passportIdentity?.full_name}) y FM2 (${profile.representativeIdentity?.full_name}) no coinciden.`
          });
          scorePenalty += 0.1;
        }
      }
    }
  }
  
  // =========================================================
  // SCENARIO 5: NATIONALITY UNKNOWN
  // =========================================================
  else {
    // Can't determine nationality - require at least one identity document
    if (!hasAnyIdentity) {
      flags.push({
        code: "REP_ID_MISMATCH",
        level: "critical",
        message: "Falta documento de identidad (INE/Pasaporte/FM2). No se puede verificar la identidad del firmante."
      });
      scorePenalty += 0.3;
    } else {
      // Have some identity but can't determine nationality
      flags.push({
        code: "OTHER",
        level: "warning",
        message: "No se pudo determinar la nacionalidad del representante. Verificar si es mexicano (INE suficiente) o extranjero (requiere Pasaporte + FM2)."
      });
      scorePenalty += 0.05;
    }
  }
  
  return { flags, scorePenalty };
}

/**
 * Validates a KYC Profile against business rules with advanced logic.
 */
export function validateKycProfile(profile: KycProfile): KycValidationResult {
  const flags: KycValidationFlag[] = [];
  let score = 1.0;

  // A. Detect Persona Física mode
  const isPF = isPersonaFisica(profile);
  
  // B. Determine nationality of the representative/individual
  const nationality = determineNationality(profile);

  // 0. Critical Entity Coherence Check (Persona Moral Only)
  if (!isPF) {
      const coherence = checkEntityCoherence(profile);
      if (!coherence.isCoherent) {
          flags.push({
              code: "ENTITY_MISMATCH",
              level: "critical",
              message: `Los documentos corresponden a entidades distintas: ${coherence.reason}`
          });
          
          // Force Immediate Rejection
          return {
              customerId: profile.customerId,
              score: 0.0, // Force failure
              flags,
              generatedAt: new Date().toISOString()
          };
      }
  }

  // C. Resolve Addresses (Ensure strictly populated)
  resolveAddresses(profile);

  // =========================================================
  // D. IDENTITY DOCUMENT VALIDATION
  // This is the core logic that handles all 4 scenarios:
  // 1. Mexican National - Persona Física
  // 2. Mexican National - Persona Moral
  // 3. Foreign National - Persona Física  
  // 4. Foreign National - Persona Moral
  // =========================================================
  const identityValidation = validateIdentityDocuments(profile, isPF, nationality);
  flags.push(...identityValidation.flags);
  score -= identityValidation.scorePenalty;

  // E. Corporate checks (SKIP for Persona Física)
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

  // PF Mode: Additional name matching check (identity doc requirement already handled above)
  if (isPF) {
    // Check if identity document name matches SAT name (only if both exist)
    // This catches cases where someone provides valid ID but for wrong person
    const satName = profile.companyTaxProfile?.razon_social;
    const identityName = profile.representativeIdentity?.full_name || profile.passportIdentity?.full_name;
    
    if (satName && identityName) {
      // Normalize names for comparison (uppercase, trim, normalize spaces)
      const normalizeName = (name: string) => name.toUpperCase().trim().replace(/\s+/g, ' ');
      const satNormalized = normalizeName(satName);
      const identityNormalized = normalizeName(identityName);
      
      // Check if names are similar (allowing for word order differences)
      const satWords = new Set(satNormalized.split(' ').filter(w => w.length > 2));
      const identityWords = new Set(identityNormalized.split(' ').filter(w => w.length > 2));
      
      // Calculate intersection
      let commonCount = 0;
      for (const word of identityWords) {
          if (satWords.has(word)) commonCount++;
      }
      
      // STRICTER: Require high overlap, but allow order diffs
      // For PF, usually identity name is part of SAT name (which might be full legal name)
      const matchRatio = identityWords.size > 0 ? commonCount / identityWords.size : 0;
      
      // Only flag if match ratio is low (less than 75% of identity tokens found in SAT)
      if (matchRatio < 0.75) {
        flags.push({
          code: "IDENTITY_MISMATCH",
          level: "warning",
          message: `El nombre en SAT (${satName}) no coincide con el documento de identidad (${identityName}).`
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
