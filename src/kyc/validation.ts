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
 * Classifies the entity type based on Acta and SAT Constancia data
 * 
 * PRIORITY ORDER:
 * 1. Presence of Acta Constitutiva - ALWAYS means Persona Moral
 * 2. Acta RFC (if present) - confirms Persona Moral
 * 3. SAT RFC pattern (only if no Acta)
 * 4. Tax regime analysis (only if no Acta)
 * 
 * CRITICAL: An Acta Constitutiva is ONLY created for corporate entities.
 * If we have an Acta, the entity is ALWAYS Persona Moral, regardless of 
 * whether the company's RFC is in the Acta or what SAT Constancias we have.
 * Personal SAT Constancias of shareholders should NOT change this classification.
 */
export function classifyEntityType(profile: KycProfile): EntityType {
  const taxProfile = profile.companyTaxProfile;
  const hasActa = !!profile.companyIdentity;
  const actaRfc = profile.companyIdentity?.rfc?.toUpperCase().trim();
  const razonSocial = profile.companyIdentity?.razon_social?.toUpperCase() || '';
  
  const personaMoralPattern = /^[A-Z]{3}\d{6}[A-Z0-9]{3}$/;  // 3 letters = corporate
  const personaFisicaPattern = /^[A-Z]{4}\d{6}[A-Z0-9]{3}$/; // 4 letters = individual
  
  // 1. HIGHEST PRIORITY: If we have an Acta Constitutiva, it's ALWAYS Persona Moral
  //    An Acta is only created for corporate entities (SA, SC, SAPI, etc.)
  if (hasActa) {
    // Additional confirmation: check if razon_social contains corporate suffixes
    const corporateSuffixes = ['S.A.', 'SA ', 'S.C.', 'SC ', 'S.A.P.I.', 'SAPI', 'S.A.S.', 'SAS', 
                               'S. DE R.L.', 'SOCIEDAD', 'DE C.V.', 'CV'];
    const hasCorporateSuffix = corporateSuffixes.some(suffix => razonSocial.includes(suffix));
    
    if (hasCorporateSuffix || actaRfc || profile.companyIdentity?.shareholders?.length) {
      return 'PERSONA_MORAL';
    }
    
    // Even without corporate suffix, an Acta implies corporate entity
    return 'PERSONA_MORAL';
  }
  
  // 2. If Acta has RFC, confirm Persona Moral (redundant if hasActa check passed, but explicit)
  if (actaRfc && personaMoralPattern.test(actaRfc)) {
    return 'PERSONA_MORAL';
  }
  
  // 3. NO ACTA: Check SAT RFC pattern for Persona Física classification
  if (taxProfile?.rfc) {
    const satRfc = taxProfile.rfc.toUpperCase().trim();
    
    // If SAT RFC indicates Persona Moral (and no Acta - unusual case)
    if (personaMoralPattern.test(satRfc)) {
      return 'PERSONA_MORAL';
    }
    
    // If SAT RFC indicates Persona Física
    if (personaFisicaPattern.test(satRfc)) {
      return classifyPersonaFisicaSubtype(taxProfile);
    }
  }
  
  // 4. Fallback to tax regime analysis (only if no Acta)
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
      return 'PERSONA_FISICA_EMPRESARIAL';
    }
    
    // Check for explicit Persona Física indicators
    if (regime.includes('PERSONA FÍSICA') || regime.includes('PERSONA FISICA')) {
      return classifyPersonaFisicaSubtype(taxProfile);
    }
  }
  
  // 5. No classification possible
  // (This case should not happen if hasActa check passed above)
  
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
    
    // PRIORITY: Use explicit percentage from extraction if available
    // This is critical for Sociedad Civil and other structures where 
    // percentages are stated directly (e.g., 80%/20%) rather than calculated from share counts
    if (s.percentage !== null && s.percentage !== undefined) {
      pct = s.percentage;
      votingPct = hasVotingRights ? s.percentage : 0;
    } else if (totalAllShares > 0 && s.shares !== null && s.shares !== undefined) {
      // Fallback: Calculate from share counts
      pct = (shares / totalAllShares) * 100;
      // Calculate VOTING percentage (only voting shares count for control)
      if (hasVotingRights && totalVotingShares > 0) {
        votingPct = (shares / totalVotingShares) * 100;
      } else if (!hasVotingRights) {
        votingPct = 0;
      }
    } else {
      pct = null;
      votingPct = null;
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
      const isExplicitlyEspecial = roleUpper.includes("APODERADO ESPECIAL") || 
                                   roleUpper.includes("ESPECIAL APODERADO") ||
                                   roleUpper.includes("APODERADO LIMITADO") ||
                                   roleUpper.includes("LIMITADO APODERADO");
      const hasEspecialPowersLabel = false; 
      const isExplicitlyLimited = isExplicitlyEspecial || hasEspecialPowersLabel;
      
      if (isExplicitlyLimited) {
          limitations.push("Explicitly labeled as 'Especial' or 'Limitado' in role or powers.");
      }
      
      // Match canonical power phrases
      const hasPleitos = POWER_PATTERNS.pleitos.test(powersText);
      const hasAdmin = POWER_PATTERNS.administracion.test(powersText);
      const hasDomino = POWER_PATTERNS.dominio.test(powersText);
      const hasTitulos = POWER_PATTERNS.titulosCredito.test(powersText);

      // --- NEW: CHECK FOR LIMITED ADMINISTRATIVE POWERS (Article 2554 CCF) ---
      // Even if they have "Actos de Administración", if it's limited (e.g., "solo ante SAT"), 
      // they CANNOT sign general commercial contracts.
      let hasRestrictedAdmin = false;
      if (hasAdmin) {
        // Check for limiting keywords in the same sentence/context as "actos de administración"
        // This is a heuristic check on the full text
        const adminClause = (rep.poder_scope || []).find(p => POWER_PATTERNS.administracion.test(p.toUpperCase())) || "";
        const adminUpper = adminClause.toUpperCase();
        
        if (adminUpper.includes("LIMITADO") || adminUpper.includes("SOLO") || 
            adminUpper.includes("UNICAMENTE") || adminUpper.includes("ÚNICAMENTE") || 
            adminUpper.includes("EXCLUSIVAMENTE") || adminUpper.includes("EN MATERIA LABORAL") || adminUpper.includes("EN EL ÁREA LABORAL") || adminUpper.includes("EN EL AREA LABORAL")) {
            hasRestrictedAdmin = true;
            limitations.push("⚠️ Administrative powers are RESTRICTED (cannot sign general contracts).");
        }
      }

      if (hasPleitos) matchedPhrases.push("PLEITOS Y COBRANZAS");
      else missingPowers.push("Pleitos y Cobranzas");

      if (hasAdmin) {
          if (hasRestrictedAdmin) matchedPhrases.push("ACTOS DE ADMINISTRACIÓN (LIMITADO)");
          else matchedPhrases.push("ACTOS DE ADMINISTRACIÓN");
      } else {
          missingPowers.push("Actos de Administración");
      }

      if (hasDomino) matchedPhrases.push("ACTOS DE DOMINIO");
      else missingPowers.push("Actos de Dominio");

      if (hasTitulos) matchedPhrases.push("TÍTULOS DE CRÉDITO");
      else missingPowers.push("Títulos de Crédito");
      
      // STRICT CLASSIFICATION LOGIC:
      if (!rep.can_sign_contracts) {
          scope = "none";
          limitations.push("No 'Apoderado' designation found in extraction.");
      } else {
          const isOfficerOnly = (roleUpper.includes("SECRETARIO") || roleUpper.includes("VOCAL") || 
                                 roleUpper.includes("COMISARIO") || roleUpper.includes("CONSEJO")) &&
                                !roleUpper.includes("APODERADO");
          
          if (isOfficerOnly) {
              scope = "none";
              limitations.push("Officer role (Secretario/Vocal) without explicit Apoderado grant.");
          } else if (isExplicitlyLimited || hasRestrictedAdmin) {
              // Explicitly labeled as "especial"/"limitado" OR has restricted administrative powers = LIMITED
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

// --- 4.1 Address Comparison and POA Validation ---

/**
 * Normalizes Mexican state names to a canonical form
 * Handles: CDMX, Ciudad de México, Distrito Federal, Mexico City, MEX., etc.
 */
function normalizeEstado(estado: string | null | undefined): string {
  if (!estado) return '';
  const s = estado.toUpperCase().trim();
  
  // Mexico City variants
  if (s === 'CDMX' || s === 'CIUDAD DE MEXICO' || s === 'CIUDAD DE MÉXICO' || 
      s === 'DISTRITO FEDERAL' || s === 'D.F.' || s === 'DF' || 
      s === 'MEXICO CITY' || s === 'CD. DE MEXICO' || s === 'CD DE MEXICO') {
    return 'CIUDAD_DE_MEXICO';
  }
  
  // Estado de México variants
  if (s === 'MEXICO' || s === 'MEX' || s === 'MEX.' || s === 'EDO. MEX' || 
      s === 'EDO MEX' || s === 'ESTADO DE MEXICO' || s === 'ESTADO DE MÉXICO' ||
      s === 'EDO. DE MEXICO' || s === 'EDO DE MEXICO') {
    return 'ESTADO_DE_MEXICO';
  }
  
  return s.replace(/[.,]/g, '').replace(/\s+/g, '_');
}

/**
 * Normalizes street names for comparison
 * Handles: CDA (Cerrada), AV (Avenida), CALLE, etc.
 */
function normalizeStreet(street: string | null | undefined): string {
  if (!street) return '';
  let s = street.toUpperCase().trim();
  
  // Remove common prefixes that don't change the location
  s = s.replace(/^(CALLE|C\.|CDA|CDA\.|CERRADA|CERRADA DE|AV|AV\.|AVENIDA|BLVD|BLVD\.|BOULEVARD|PRIV|PRIV\.|PRIVADA|AND|AND\.|ANDADOR)\s+/i, '');
  
  // Normalize spacing and punctuation
  s = s.replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  
  return s;
}

/**
 * Normalizes exterior/interior numbers for comparison
 * Handles: "MZ 2 LT10" vs "2, LT 10" vs "MZA 2 LOTE 10"
 */
function normalizeNumber(ext: string | null | undefined, int: string | null | undefined): string {
  const combined = [ext, int].filter(Boolean).join(' ').toUpperCase();
  if (!combined) return '';
  
  // Extract MZ/MZA (manzana) and LT/LOTE numbers
  const mzMatch = combined.match(/M(?:Z|ZA|ANZANA)?\s*(\d+)/i);
  const ltMatch = combined.match(/L(?:T|OTE|TE)?\s*(\d+)/i);
  
  const parts: string[] = [];
  if (mzMatch) parts.push(`MZ${mzMatch[1]}`);
  if (ltMatch) parts.push(`LT${ltMatch[1]}`);
  
  // If we found manzana/lote format, use normalized version
  if (parts.length > 0) {
    return parts.join('_');
  }
  
  // Otherwise just clean up the number
  return combined.replace(/[.,\s]/g, '').replace(/^(NUM|NO|#)/i, '');
}

/**
 * Interface for address comparison result
 */
export interface AddressComparisonResult {
  isEquivalent: boolean;
  confidence: number; // 0-1
  matchDetails: {
    cpMatch: boolean;
    coloniaMatch: boolean;
    municipioMatch: boolean;
    estadoMatch: boolean;
    streetSimilar: boolean;
    numberEquivalent: boolean;
  };
  normalizedAddresses?: {
    address1: string;
    address2: string;
  };
}

/**
 * Compares two Mexican addresses for equivalence
 * Returns confidence score and match details
 */
export function compareAddresses(
  addr1: { street?: string | null; ext_number?: string | null; int_number?: string | null; colonia?: string | null; municipio?: string | null; estado?: string | null; cp?: string | null } | null | undefined,
  addr2: { street?: string | null; ext_number?: string | null; int_number?: string | null; colonia?: string | null; municipio?: string | null; estado?: string | null; cp?: string | null } | null | undefined
): AddressComparisonResult {
  if (!addr1 || !addr2) {
    return {
      isEquivalent: false,
      confidence: 0,
      matchDetails: {
        cpMatch: false,
        coloniaMatch: false,
        municipioMatch: false,
        estadoMatch: false,
        streetSimilar: false,
        numberEquivalent: false
      }
    };
  }
  
  // Normalize components
  const cp1 = (addr1.cp || '').replace(/\D/g, '');
  const cp2 = (addr2.cp || '').replace(/\D/g, '');
  const cpMatch: boolean = !!(cp1 && cp2 && cp1 === cp2);
  
  const col1 = (addr1.colonia || '').toUpperCase().replace(/[.,]/g, '').trim();
  const col2 = (addr2.colonia || '').toUpperCase().replace(/[.,]/g, '').trim();
  const coloniaMatch: boolean = !!(col1 && col2 && col1 === col2);
  
  const mun1 = (addr1.municipio || '').toUpperCase().replace(/[.,]/g, '').trim();
  const mun2 = (addr2.municipio || '').toUpperCase().replace(/[.,]/g, '').trim();
  const municipioMatch: boolean = !!(mun1 && mun2 && (mun1 === mun2 || mun1.includes(mun2) || mun2.includes(mun1)));
  
  const est1 = normalizeEstado(addr1.estado);
  const est2 = normalizeEstado(addr2.estado);
  const estadoMatch: boolean = !!(est1 && est2 && est1 === est2);
  
  const street1 = normalizeStreet(addr1.street);
  const street2 = normalizeStreet(addr2.street);
  // Check if streets are similar (one contains the other or >70% token match)
  const streetSimilar: boolean = !!(street1 && street2 && (
    street1 === street2 ||
    street1.includes(street2) || 
    street2.includes(street1) ||
    calculateTokenOverlap(street1, street2) > 0.7
  ));
  
  const num1 = normalizeNumber(addr1.ext_number, addr1.int_number);
  const num2 = normalizeNumber(addr2.ext_number, addr2.int_number);
  const numberEquivalent: boolean = !!(num1 && num2 && (num1 === num2 || num1.includes(num2) || num2.includes(num1)));
  
  // Calculate confidence score
  let confidence = 0;
  if (cpMatch) confidence += 0.30;       // CP is most important
  if (coloniaMatch) confidence += 0.25;  // Colonia is key
  if (municipioMatch) confidence += 0.20;
  if (estadoMatch) confidence += 0.10;
  if (streetSimilar) confidence += 0.10;
  if (numberEquivalent) confidence += 0.05;
  
  // Is equivalent if confidence >= 0.75 (CP + Colonia + Municipio at minimum)
  const isEquivalent = confidence >= 0.75;
  
  return {
    isEquivalent,
    confidence,
    matchDetails: {
      cpMatch,
      coloniaMatch,
      municipioMatch,
      estadoMatch,
      streetSimilar,
      numberEquivalent
    },
    normalizedAddresses: {
      address1: `${street1} ${num1}, ${col1}, ${mun1}, ${est1}, ${cp1}`,
      address2: `${street2} ${num2}, ${col2}, ${mun2}, ${est2}, ${cp2}`
    }
  };
}

/**
 * Calculates token overlap between two strings
 */
function calculateTokenOverlap(str1: string, str2: string): number {
  const tokens1 = new Set(str1.split(/\s+/).filter(t => t.length > 1));
  const tokens2 = new Set(str2.split(/\s+/).filter(t => t.length > 1));
  
  if (tokens1.size === 0 || tokens2.size === 0) return 0;
  
  let matches = 0;
  for (const t of tokens1) {
    if (tokens2.has(t)) matches++;
  }
  
  return matches / Math.min(tokens1.size, tokens2.size);
}

/**
 * Extracts surname(s) from a full name
 * Handles Mexican naming conventions: APELLIDO_PATERNO APELLIDO_MATERNO NOMBRE(S)
 * Or: NOMBRE(S) APELLIDO_PATERNO APELLIDO_MATERNO
 */
export function extractSurnames(fullName: string | null | undefined): string[] {
  if (!fullName) return [];
  
  const name = fullName.toUpperCase().trim().replace(/\s+/g, ' ');
  const parts = name.split(' ').filter(p => p.length > 1);
  
  if (parts.length < 2) return parts;
  
  // Common Mexican patterns:
  // 1. "APELLIDO_P APELLIDO_M NOMBRE(S)" - return first 2 parts
  // 2. "NOMBRE(S) APELLIDO_P APELLIDO_M" - return last 2 parts
  // 3. "DE SOMETHING" - compound surname
  
  const surnames: string[] = [];
  
  // Check for compound surnames with "DE", "DEL", "DE LA", "DE LOS"
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === 'DE' || parts[i] === 'DEL' || parts[i] === 'LA' || parts[i] === 'LOS') {
      // Include compound: "DE CELLO" or "DE LA PEÑA"
      if (i + 1 < parts.length) {
        surnames.push(`${parts[i]} ${parts[i + 1]}`);
      }
    } else if (i > 0 && (parts[i-1] === 'DE' || parts[i-1] === 'DEL')) {
      // Already handled above
    } else {
      surnames.push(parts[i]);
    }
  }
  
  // Return unique surnames (avoid duplicates from compound handling)
  return [...new Set(surnames)];
}

/**
 * Checks if two names share a surname (indicates family relationship)
 */
export function sharesSurname(name1: string | null | undefined, name2: string | null | undefined): boolean {
  const surnames1 = extractSurnames(name1);
  const surnames2 = extractSurnames(name2);
  
  if (surnames1.length === 0 || surnames2.length === 0) return false;
  
  for (const s1 of surnames1) {
    for (const s2 of surnames2) {
      // Exact match or one contains the other (for compound surnames)
      if (s1 === s2 || s1.includes(s2) || s2.includes(s1)) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Interface for POA validation result
 */
export interface PoaValidationResult {
  isValid: boolean;
  nameMatches: boolean;
  addressMatchesSat: boolean;
  thirdPartyType: 'none' | 'family' | 'landlord' | 'unknown';
  flags: KycValidationFlag[];
  scorePenalty: number;
  mitigatingFactors: string[];
}

/**
 * Validates Proof of Address against client identity
 * Implements Mexican KYC rules for third-party POA acceptance
 */
export function validateProofOfAddress(profile: KycProfile): PoaValidationResult {
  const flags: KycValidationFlag[] = [];
  let scorePenalty = 0;
  const mitigatingFactors: string[] = [];
  
  const isPF = isPersonaFisica(profile);
  // entityType is used for more detailed classification if needed
  // const entityType = classifyEntityType(profile);
  
  // Get client name from SAT (authoritative source)
  const clientName = profile.companyTaxProfile?.razon_social || 
                     profile.companyIdentity?.razon_social || '';
  
  // Get SAT fiscal address
  const satAddress = profile.companyTaxProfile?.fiscal_address || profile.currentFiscalAddress;
  
  // Check utility bill POA (Telmex/CFE)
  const utilityPoa = profile.addressEvidence?.[0];
  const utilityPoaName = utilityPoa?.client_name || '';
  const utilityPoaAddress = utilityPoa?.client_address;
  
  // Check bank statement as alternative POA
  const bankName = profile.bankIdentity?.account_holder_name || '';
  const bankAddress = profile.bankIdentity?.address_on_file;
  
  // 1. Check if bank statement can serve as POA (name matches client)
  const bankNameMatches: boolean = !!(bankName && clientName && 
    (normalizeNameForComparison(bankName) === normalizeNameForComparison(clientName) ||
     calculateTokenOverlap(bankName.toUpperCase(), clientName.toUpperCase()) > 0.7));
  
  if (bankNameMatches && bankAddress) {
    // Bank statement is valid POA since it's in client's name
    mitigatingFactors.push(`Estado de cuenta bancario a nombre del cliente (${bankName}) es válido como comprobante de domicilio.`);
    
    // Check if bank address matches SAT
    const bankSatComparison = compareAddresses(bankAddress, satAddress);
    if (bankSatComparison.isEquivalent) {
      mitigatingFactors.push(`Dirección bancaria coincide con domicilio fiscal (${Math.round(bankSatComparison.confidence * 100)}% confianza).`);
    }
    
    return {
      isValid: true,
      nameMatches: true,
      addressMatchesSat: bankSatComparison.isEquivalent,
      thirdPartyType: 'none',
      flags,
      scorePenalty: 0,
      mitigatingFactors
    };
  }
  
  // 2. Check utility POA
  if (!utilityPoa || !utilityPoaName) {
    // No utility POA and no valid bank POA
    if (!bankNameMatches) {
      flags.push({
        code: "LOW_DOC_COVERAGE",
        level: "warning",
        message: "No se encontró comprobante de domicilio válido (recibo de servicios o estado de cuenta a nombre del cliente)."
      });
      scorePenalty += 0.15;
    }
    
    return {
      isValid: bankNameMatches,
      nameMatches: bankNameMatches,
      addressMatchesSat: false,
      thirdPartyType: 'none',
      flags,
      scorePenalty,
      mitigatingFactors
    };
  }
  
  // 3. Check if utility POA name matches client
  const utilityNameMatches = clientName && utilityPoaName &&
    (normalizeNameForComparison(utilityPoaName) === normalizeNameForComparison(clientName) ||
     calculateTokenOverlap(utilityPoaName.toUpperCase(), clientName.toUpperCase()) > 0.7);
  
  if (utilityNameMatches) {
    // Perfect - POA is in client's name
    const addressComparison = compareAddresses(utilityPoaAddress, satAddress);
    
    return {
      isValid: true,
      nameMatches: true,
      addressMatchesSat: addressComparison.isEquivalent,
      thirdPartyType: 'none',
      flags,
      scorePenalty: 0,
      mitigatingFactors: [`Comprobante de domicilio a nombre del cliente.`]
    };
  }
  
  // 4. POA is in third party's name - analyze the situation
  const addressComparison = compareAddresses(utilityPoaAddress, satAddress);
  const isFamily = sharesSurname(utilityPoaName, clientName);
  
  // For Persona Moral: POA MUST be in company's name
  if (!isPF) {
    flags.push({
      code: "POA_NAME_MISMATCH",
      level: "critical",
      message: `Comprobante de domicilio a nombre de tercero ("${utilityPoaName}"). Para Persona Moral, el comprobante DEBE estar a nombre de la empresa ("${clientName}").`,
      action_required: "Proporcionar comprobante de domicilio a nombre de la empresa.",
      supporting_docs: ["Recibo CFE/Telmex a nombre de la empresa", "Contrato de arrendamiento + recibo del arrendador"]
    });
    scorePenalty += 0.25;
    
    // Partial mitigation if address matches SAT
    if (addressComparison.isEquivalent) {
      mitigatingFactors.push(`La dirección del comprobante coincide con el domicilio fiscal SAT (${Math.round(addressComparison.confidence * 100)}% confianza).`);
      scorePenalty -= 0.10; // Reduce penalty
      
      flags.push({
        code: "POA_ADDRESS_VERIFIED",
        level: "info",
        message: `Dirección verificada: El comprobante de servicios confirma que el domicilio fiscal existe y tiene servicios activos.`
      });
    }
    
    return {
      isValid: false,
      nameMatches: false,
      addressMatchesSat: addressComparison.isEquivalent,
      thirdPartyType: isFamily ? 'family' : 'unknown',
      flags,
      scorePenalty,
      mitigatingFactors
    };
  }
  
  // 5. For Persona Física: Third-party POA may be acceptable with conditions
  if (isFamily) {
    // Family member's POA - acceptable per SAT rules with supporting docs
    flags.push({
      code: "POA_THIRD_PARTY_FAMILY",
      level: "warning",
      message: `Comprobante de domicilio a nombre de familiar ("${utilityPoaName}"). Apellido compartido con cliente ("${clientName}").`,
      action_required: "Opcional: Proporcionar acta de nacimiento para confirmar parentesco.",
      supporting_docs: ["Acta de nacimiento del cliente"]
    });
    scorePenalty += 0.05; // Minor penalty
    
    mitigatingFactors.push(`Apellido compartido sugiere relación familiar (${utilityPoaName} ↔ ${clientName}).`);
    
    // If address also matches SAT, further mitigation
    if (addressComparison.isEquivalent) {
      mitigatingFactors.push(`La dirección del comprobante coincide con el domicilio fiscal SAT (${Math.round(addressComparison.confidence * 100)}% confianza).`);
      scorePenalty = 0; // No penalty if family + address matches
      
      flags.push({
        code: "POA_ADDRESS_VERIFIED",
        level: "info",
        message: `Domicilio verificado: El comprobante confirma residencia en el mismo domicilio fiscal.`
      });
    }
    
    return {
      isValid: true, // Valid for PF with family POA
      nameMatches: false,
      addressMatchesSat: addressComparison.isEquivalent,
      thirdPartyType: 'family',
      flags,
      scorePenalty,
      mitigatingFactors
    };
  }
  
  // 6. Non-family third party - likely landlord/rental situation
  flags.push({
    code: "POA_THIRD_PARTY_LANDLORD",
    level: "warning",
    message: `Comprobante de domicilio a nombre de tercero ("${utilityPoaName}"), no familiar del cliente ("${clientName}").`,
    action_required: "Proporcionar contrato de arrendamiento vigente o carta del propietario.",
    supporting_docs: [
      "Contrato de arrendamiento vigente",
      "Carta del propietario con copia de su INE",
      "Constancia de residencia municipal"
    ]
  });
  scorePenalty += 0.10;
  
  // Mitigation if address matches SAT
  if (addressComparison.isEquivalent) {
    mitigatingFactors.push(`La dirección del comprobante coincide con el domicilio fiscal SAT (${Math.round(addressComparison.confidence * 100)}% confianza).`);
    mitigatingFactors.push(`Posible situación de arrendamiento donde el titular de servicios es el propietario.`);
    scorePenalty -= 0.05; // Reduce penalty
    
    flags.push({
      code: "POA_ADDRESS_VERIFIED",
      level: "info",
      message: `Domicilio verificado: La dirección existe y tiene servicios activos en el mismo domicilio fiscal.`
    });
  }
  
  return {
    isValid: addressComparison.isEquivalent, // Valid if address matches (pending rental doc)
    nameMatches: false,
    addressMatchesSat: addressComparison.isEquivalent,
    thirdPartyType: 'landlord',
    flags,
    scorePenalty,
    mitigatingFactors
  };
}

/**
 * Helper to normalize names for comparison
 */
function normalizeNameForComparison(name: string): string {
  return name.toUpperCase()
    .replace(/[.,;:\-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b(SOCIEDAD|ANONIMA|CAPITAL|VARIABLE|SA|CV|SAPI|DE|RL|SC|AC)\b/g, '')
    .trim();
}

// --- 4.3 Immigration Document Validation ---

/**
 * Immigration Document Types in Mexico
 * 
 * OBSOLETE (Pre-November 2012):
 * - FM1: Data collection form (prerequisite for FM2/FM3)
 * - FM2: "Inmigrante" - Permanent residence pathway (1 year validity, renewable 5 years)
 * - FM3: "No Inmigrante" - Temporary residence/work (1 year validity, renewable annually)
 * 
 * CURRENT (Post-November 2012):
 * - FMM: "Forma Migratoria Múltiple" - Tourist/visitor permit (1-180 days)
 * - Residente Temporal: Temporary residence (1-4 years, card has expiration)
 * - Residente Permanente: Permanent residence (STATUS never expires, CARD does)
 * - INE: National ID for Mexican citizens (has expiration)
 */

export interface ImmigrationValidationResult {
  isValid: boolean;
  statusValid: boolean;      // Immigration STATUS validity
  documentValid: boolean;    // Physical DOCUMENT validity
  code: string;
  level: 'info' | 'warning' | 'critical';
  message: string;
  action_required?: string;
  details?: {
    documentType: string;
    issueDate?: string | null;
    expiryDate?: string | null;
    daysUntilExpiry?: number;
    isObsolete?: boolean;
  };
}

/**
 * Comprehensive Immigration Document Validation
 * Based on Mexican Immigration Law (Ley de Migración) and INM regulations
 */
export function validateImmigrationDocument(profile: KycProfile): ImmigrationValidationResult {
  const doc = profile.representativeIdentity;
  const repIdentity = doc as any; // For accessing INE-specific fields
  
  // Check if we have an INE (by INE-specific fields) even without document_type
  const hasIneFields = !!(repIdentity?.clave_elector || 
                         (repIdentity?.issuer_country === 'MX' && repIdentity?.curp && repIdentity?.vigencia_year));
  
  // No document provided - but allow INE by fields
  if (!doc || (!doc.document_type && !hasIneFields)) {
    return {
      isValid: false,
      statusValid: false,
      documentValid: false,
      code: 'NO_IMMIGRATION_DOC',
      level: 'critical',
      message: 'No se proporcionó documento de identidad/migratorio.'
    };
  }
  
  // If we have INE by fields, treat it as valid Mexican ID
  if (hasIneFields && !doc.document_type) {
    // INE is valid Mexican ID - check vigencia
    const vigenciaYear = parseInt(repIdentity?.vigencia_year) || 0;
    const currentYear = new Date().getFullYear();
    const isExpired = vigenciaYear > 0 && vigenciaYear < currentYear;
    
    return {
      isValid: !isExpired,
      statusValid: true, // Mexican citizen, valid status
      documentValid: !isExpired,
      code: isExpired ? 'INE_EXPIRED' : 'INE_VALID',
      level: isExpired ? 'critical' : 'info',
      message: isExpired 
        ? `INE vencida (vigencia: ${vigenciaYear}). Requiere renovación.`
        : `INE válida (vigencia: ${vigenciaYear}).`,
      details: {
        documentType: 'INE',
        expiryDate: vigenciaYear ? `${vigenciaYear}-12-31` : undefined,
        isObsolete: isExpired
      }
    };
  }
  
  const docType = (doc.document_type || '').toUpperCase().trim();
  const issueDate = doc.issue_date;
  const expiryDate = doc.expiry_date;
  const now = new Date();
  const currentYear = now.getFullYear();
  const issueYear = issueDate ? new Date(issueDate).getFullYear() : 0;
  
  // Calculate days until expiry if we have an expiry date
  let daysUntilExpiry: number | undefined;
  if (expiryDate) {
    const expiry = new Date(expiryDate);
    daysUntilExpiry = Math.floor((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  }
  
  // =====================================================
  // 1. FMM - Tourist Permit (NOT valid for KYC)
  // =====================================================
  if (docType === 'FMM' || docType.includes('FORMA MIGRATORIA MULTIPLE') || 
      docType.includes('VISITANTE') || docType === 'TOURIST') {
    return {
      isValid: false,
      statusValid: false,
      documentValid: false,
      code: 'INVALID_DOC_TYPE_FMM',
      level: 'critical',
      message: 'FMM (permiso de turista/visitante) NO es válido para alta de clientes. ' +
               'Se requiere Tarjeta de Residente (Temporal o Permanente) o INE para mexicanos.',
      action_required: 'Solicitar documento de residencia válido.',
      details: { documentType: 'FMM', isObsolete: false }
    };
  }
  
  // =====================================================
  // 2. TARJETA DE RESIDENTE PERMANENTE (Post-2012)
  // =====================================================
  // This is the NEW format that replaced FM2 for permanent residents
  // Key characteristics:
  // - NO expiration date for adults (18+) - valid INDEFINITELY
  // - 3-year validity for minors (<18) - must be renewed
  // - Issued after November 2012
  // - Per Ley de Migración Art. 54 and Reglamento Art. 137
  const isPermanentResident = 
    docType.includes('PERMANENTE') || 
    docType.includes('PERMANENT') ||
    docType === 'TARJETA DE RESIDENTE PERMANENTE' ||
    docType === 'PERMANENT RESIDENT' ||
    docType === 'RESIDENTE PERMANENTE' ||
    // Post-2012 document with no expiry is a Permanent Resident card
    (issueYear >= 2012 && !expiryDate && (docType === 'FM2' || docType.includes('RESIDENTE')));
  
  if (isPermanentResident) {
    // Permanent resident cards for ADULTS have NO expiration (indefinite validity)
    // Per Reglamento de la Ley de Migración Art. 137
    if (!expiryDate) {
      return {
        isValid: true,
        statusValid: true,
        documentValid: true,
        code: 'IMMIGRATION_DOC_VALID_PERMANENT',
        level: 'info',
        message: `Tarjeta de Residente Permanente emitida en ${issueYear || 'fecha desconocida'}. ` +
                 `Vigencia INDEFINIDA para adultos (Ley de Migración Art. 54, Reglamento Art. 137).`,
        details: { 
          documentType: 'RESIDENTE PERMANENTE', 
          issueDate, 
          expiryDate: null
        }
      };
    }
    
    // Permanent resident card WITH expiry date = minor's card (valid 3 years)
    // Per Reglamento Art. 137: minors' cards must be renewed every 3 years until age 18
    if (daysUntilExpiry !== undefined && daysUntilExpiry < 0) {
      return {
        isValid: false,
        statusValid: true, // Status is still valid, just need card renewal
        documentValid: false,
        code: 'IMMIGRATION_CARD_EXPIRED',
        level: 'warning',
        message: `Tarjeta de Residente Permanente expiró el ${expiryDate}. ` +
                 `Nota: El estatus de Residente Permanente NO expira, solo la tarjeta física. ` +
                 `Se requiere renovación de tarjeta en INM.`,
        action_required: 'Renovar tarjeta de residente en INM (el estatus permanente sigue vigente).',
        details: { documentType: 'RESIDENTE PERMANENTE', issueDate, expiryDate, daysUntilExpiry }
      };
    }
    
    // Card with valid expiry (minor's card still current)
    return {
      isValid: true,
      statusValid: true,
      documentValid: true,
      code: 'IMMIGRATION_DOC_VALID',
      level: 'info',
      message: `Tarjeta de Residente Permanente vigente hasta ${expiryDate}.`,
      details: { documentType: 'RESIDENTE PERMANENTE', issueDate, expiryDate, daysUntilExpiry }
    };
  }
  
  // =====================================================
  // 3. FM2 - Legacy "Inmigrante" Document (Pre-2012)
  // =====================================================
  // FM2 was the old format document BEFORE November 2012
  // These documents ALWAYS had annual expiration dates
  // ANY FM2 document is now OBSOLETE (>12 years old)
  if (docType === 'FM2' || docType.includes('INMIGRANTE')) {
    // All FM2 documents are now obsolete - they were replaced in November 2012
    return {
      isValid: false,
      statusValid: false,
      documentValid: false,
      code: 'IMMIGRATION_DOC_OBSOLETE',
      level: 'critical',
      message: `Documento FM2 es OBSOLETO. Los documentos FM fueron reemplazados en ` +
               `Noviembre 2012 por Tarjetas de Residente. Cualquier FM2 tiene más de 12 años.`,
      action_required: 'Solicitar Tarjeta de Residente Permanente vigente del INM.',
      details: { 
        documentType: 'FM2', 
        issueDate, 
        expiryDate,
        isObsolete: true 
      }
    };
  }
  
  // =====================================================
  // 4. FM3 - Legacy "No Inmigrante" Document (Pre-2012)
  // =====================================================
  // FM3 was the old format for temporary residents BEFORE November 2012
  // These documents ALWAYS had 1-year expiration dates
  // ANY FM3 document is now OBSOLETE (>12 years old)
  if (docType === 'FM3' || docType.includes('NO INMIGRANTE')) {
    // All FM3 documents are now obsolete - they were replaced in November 2012
    return {
      isValid: false,
      statusValid: false,
      documentValid: false,
      code: 'IMMIGRATION_DOC_OBSOLETE',
      level: 'critical',
      message: `Documento FM3 es OBSOLETO. Los documentos FM fueron reemplazados en ` +
               `Noviembre 2012 por Tarjetas de Residente. Cualquier FM3 tiene más de 12 años.`,
      action_required: 'Solicitar Tarjeta de Residente Temporal o Permanente vigente del INM.',
      details: { documentType: 'FM3', issueDate, expiryDate, isObsolete: true }
    };
  }
  
  // =====================================================
  // 4. Residente Temporal - Current Valid Document
  // =====================================================
  if (docType.includes('TEMPORAL') || docType.includes('RESIDENTE TEMPORAL') ||
      docType === 'TEMPORARY RESIDENT') {
    
    // Residente Temporal MUST have expiry date (1-4 years validity)
    if (!expiryDate) {
      return {
        isValid: false,
        statusValid: false,
        documentValid: false,
        code: 'MISSING_EXPIRY_DATE',
        level: 'critical',
        message: 'Tarjeta de Residente Temporal DEBE tener fecha de vencimiento. ' +
                 'Las tarjetas tienen vigencia de 1 a 4 años. Verificar documento.',
        action_required: 'Verificar autenticidad del documento o solicitar uno vigente.',
        details: { documentType: 'RESIDENTE_TEMPORAL', issueDate }
      };
    }
    
    // Check if expired
    if (daysUntilExpiry !== undefined && daysUntilExpiry < 0) {
      return {
        isValid: false,
        statusValid: false,
        documentValid: false,
        code: 'IMMIGRATION_DOC_EXPIRED',
        level: 'critical',
        message: `Tarjeta de Residente Temporal expiró el ${expiryDate} ` +
                 `(hace ${Math.abs(daysUntilExpiry)} días). El estatus y documento son inválidos.`,
        action_required: 'El cliente debe renovar su residencia temporal en INM antes de proceder.',
        details: { documentType: 'RESIDENTE_TEMPORAL', issueDate, expiryDate, daysUntilExpiry }
      };
    }
    
    // Check if expiring soon (within 30 days)
    if (daysUntilExpiry !== undefined && daysUntilExpiry <= 30) {
      return {
        isValid: true,
        statusValid: true,
        documentValid: true,
        code: 'IMMIGRATION_DOC_EXPIRING_SOON',
        level: 'warning',
        message: `Tarjeta de Residente Temporal vence en ${daysUntilExpiry} días (${expiryDate}). ` +
                 `El cliente debe renovar pronto en INM.`,
        action_required: 'Recomendar al cliente iniciar trámite de renovación.',
        details: { documentType: 'RESIDENTE_TEMPORAL', issueDate, expiryDate, daysUntilExpiry }
      };
    }
    
    // Valid Residente Temporal
    return {
      isValid: true,
      statusValid: true,
      documentValid: true,
      code: 'IMMIGRATION_DOC_VALID',
      level: 'info',
      message: `Tarjeta de Residente Temporal válida hasta ${expiryDate}.`,
      details: { documentType: 'RESIDENTE_TEMPORAL', issueDate, expiryDate, daysUntilExpiry }
    };
  }
  
  // =====================================================
  // 5. Residente Permanente - STATUS Never Expires
  // =====================================================
  if (docType.includes('PERMANENTE') || docType.includes('RESIDENTE PERMANENTE') ||
      docType === 'PERMANENT RESIDENT') {
    
    // CRITICAL: Permanent resident STATUS never expires
    // But the physical CARD does need renewal every 5-10 years
    
    if (expiryDate && daysUntilExpiry !== undefined && daysUntilExpiry < 0) {
      // Card expired but STATUS is still valid!
      return {
        isValid: true,  // STATUS is valid
        statusValid: true,
        documentValid: false,  // Card is not valid
        code: 'IMMIGRATION_CARD_EXPIRED_STATUS_VALID',
        level: 'warning',
        message: `La tarjeta física de Residente Permanente expiró el ${expiryDate}, ` +
                 `PERO el estatus de residencia permanente NUNCA EXPIRA. ` +
                 `El cliente puede proceder con trámites mientras canjea su tarjeta.`,
        action_required: 'Recomendar al cliente canjear su tarjeta en INM (trámite de reposición).',
        details: { documentType: 'RESIDENTE_PERMANENTE', issueDate, expiryDate, daysUntilExpiry }
      };
    }
    
    // No expiry date - THIS IS NORMAL AND CORRECT FOR ADULT PERMANENT RESIDENTS
    // Per Mexican Immigration Law (Ley de Migración):
    // - Adults (18+): Card has NO expiration date (vigencia indefinida)
    // - Minors under 3: Card valid 1 year
    // - Minors 3-17: Card valid 4 years
    if (!expiryDate) {
      if (issueYear > 0 && (currentYear - issueYear) > 10) {
        // Card is more than 10 years old - recommend refresh for updated photo/security
        return {
          isValid: true,
          statusValid: true,
          documentValid: true,
          code: 'IMMIGRATION_CARD_OLD',
          level: 'info',
          message: `Tarjeta de Residente Permanente emitida en ${issueYear} ` +
                   `(hace ${currentYear - issueYear} años). El estatus es VIGENTE INDEFINIDAMENTE. ` +
                   `Se recomienda canje de tarjeta solo para actualizar foto y elementos de seguridad.`,
          details: { documentType: 'RESIDENTE_PERMANENTE', issueDate }
        };
      }
      
      // Card without expiry date - THIS IS CORRECT for adult permanent residents
      return {
        isValid: true,
        statusValid: true,
        documentValid: true,
        code: 'IMMIGRATION_DOC_VALID_PERMANENT',
        level: 'info',
        message: 'Tarjeta de Residente Permanente válida. Para adultos (18+), la tarjeta ' +
                 'NO tiene fecha de vencimiento - esto es CORRECTO per Ley de Migración. ' +
                 'El estatus de residente permanente es indefinido.',
        details: { documentType: 'RESIDENTE_PERMANENTE', issueDate }
      };
    }
    
    // Card expiring soon
    if (daysUntilExpiry !== undefined && daysUntilExpiry <= 90) {
      return {
        isValid: true,
        statusValid: true,
        documentValid: true,
        code: 'IMMIGRATION_CARD_EXPIRING',
        level: 'info',
        message: `Tarjeta de Residente Permanente vence en ${daysUntilExpiry} días. ` +
                 `El estatus NO expira, solo la tarjeta física.`,
        action_required: 'Recomendar canje de tarjeta en INM.',
        details: { documentType: 'RESIDENTE_PERMANENTE', issueDate, expiryDate, daysUntilExpiry }
      };
    }
    
    // Valid permanent resident card
    return {
      isValid: true,
      statusValid: true,
      documentValid: true,
      code: 'IMMIGRATION_DOC_VALID',
      level: 'info',
      message: `Residente Permanente válido. Estatus indefinido.`,
      details: { documentType: 'RESIDENTE_PERMANENTE', issueDate, expiryDate, daysUntilExpiry }
    };
  }
  
  // =====================================================
  // 6. INE/IFE - Mexican National ID
  // =====================================================
  if (docType === 'INE' || docType === 'IFE' || docType.includes('CREDENCIAL')) {
    // INE is for Mexican citizens - no immigration status needed
    // But the card itself has expiration
    
    if (expiryDate && daysUntilExpiry !== undefined && daysUntilExpiry < 0) {
      return {
        isValid: false,
        statusValid: true,  // Mexican nationality never expires
        documentValid: false,
        code: 'IDENTITY_DOC_EXPIRED',
        level: 'critical',
        message: `INE expiró el ${expiryDate}. Se requiere INE vigente.`,
        action_required: 'Solicitar INE vigente del cliente.',
        details: { documentType: 'INE', issueDate, expiryDate, daysUntilExpiry }
      };
    }
    
    // INE issue date validation - suspicious if Jan 1
    if (issueDate) {
      const issueDateObj = new Date(issueDate);
      if (issueDateObj.getMonth() === 0 && issueDateObj.getDate() === 1) {
        // January 1st is suspicious - INE doesn't issue on holidays
        return {
          isValid: true,
          statusValid: true,
          documentValid: true,
          code: 'IDENTITY_DOC_SUSPICIOUS_DATE',
          level: 'warning',
          message: `Fecha de emisión de INE (${issueDate}) es sospechosa. ` +
                   `INE no emite credenciales el 1 de enero. Verificar documento.`,
          details: { documentType: 'INE', issueDate, expiryDate, daysUntilExpiry }
        };
      }
    }
    
    // Valid INE
    return {
      isValid: true,
      statusValid: true,
      documentValid: true,
      code: 'IDENTITY_DOC_VALID',
      level: 'info',
      message: `INE válida${expiryDate ? ` hasta ${expiryDate}` : ''}.`,
      details: { documentType: 'INE', issueDate, expiryDate, daysUntilExpiry }
    };
  }
  
  // =====================================================
  // 7. Passport - Additional Identity Document
  // =====================================================
  if (docType.includes('PASAPORTE') || docType === 'PASSPORT') {
    if (expiryDate && daysUntilExpiry !== undefined && daysUntilExpiry < 0) {
      return {
        isValid: false,
        statusValid: true,
        documentValid: false,
        code: 'IDENTITY_DOC_EXPIRED',
        level: 'warning',
        message: `Pasaporte expiró el ${expiryDate}. Para extranjeros, se requiere ` +
                 `pasaporte vigente junto con documento migratorio.`,
        action_required: 'Solicitar pasaporte vigente.',
        details: { documentType: 'PASSPORT', issueDate, expiryDate, daysUntilExpiry }
      };
    }
    
    return {
      isValid: true,
      statusValid: true,
      documentValid: true,
      code: 'IDENTITY_DOC_VALID',
      level: 'info',
      message: `Pasaporte válido${expiryDate ? ` hasta ${expiryDate}` : ''}.`,
      details: { documentType: 'PASSPORT', issueDate, expiryDate, daysUntilExpiry }
    };
  }
  
  // =====================================================
  // 8. Unknown Document Type
  // =====================================================
  return {
    isValid: true,
    statusValid: true,
    documentValid: true,
    code: 'UNKNOWN_DOC_TYPE',
    level: 'warning',
    message: `Tipo de documento no reconocido: "${docType}". Verificar manualmente.`,
    details: { documentType: docType, issueDate, expiryDate, daysUntilExpiry }
  };
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
 * 
 * CRITICAL: If the SAT is a personal SAT (4-letter RFC = Persona Física) but we have an Acta
 * (Persona Moral), this is NOT an entity mismatch - it's a "wrong SAT type" issue.
 * The validation should continue, but flag that the company SAT is missing.
 */
export function checkEntityCoherence(profile: KycProfile): EntityCoherenceResult {
  const acta = profile.companyIdentity;
  const sat = profile.companyTaxProfile;

  // Can only check consistency if both documents are present
  if (!acta || !sat) {
    return { isCoherent: true };
  }

  // CRITICAL: Check if SAT is a personal SAT (Persona Física) while Acta is for company
  // Personal SAT RFC pattern: 4 letters + 6 digits + 3 homoclave (e.g., KATA6910101W6)
  // Company SAT RFC pattern: 3 letters + 6 digits + 3 homoclave (e.g., DIP030930MM0)
  const satRfc = sat.rfc?.toUpperCase().trim();
  const satIsPersonal = satRfc && /^[A-Z]{4}\d{6}[A-Z0-9]{3}$/.test(satRfc);
  
  if (satIsPersonal) {
    // The SAT is a personal SAT, not a company SAT.
    // This is NOT an entity mismatch - it's a "wrong SAT type" situation.
    // Return coherent=true to allow validation to continue.
    // The WRONG_SAT_TYPE flag will be added by the main validation logic.
    return { 
      isCoherent: true,
      reason: `SAT is personal (${satRfc}), not company SAT. Validation will flag wrong SAT type.`
    };
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

  // 2. Razón Social Match (Normalized) - Only for corporate SATs
  const actaName = normalizeString(acta.razon_social);
  const satName = normalizeString(sat.razon_social);

  // Handle SA DE CV variations explicitly if needed, but normalized comparison often catches it.
  // normalizeString removes dots, so "S.A. DE C.V." -> "S A DE C V" vs "SA DE CV" -> "SA DE CV".
  // Let's enhance normalization to remove spaces between single letters if needed, or just simple substring match?
  // Prompt requirements: "Remove abbreviations ("S.A. DE C.V." ≈ "SA DE CV")"
  
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
  
  // Check for INE-specific fields (clave_elector, issuer_country === 'MX')
  // INE uses different schema than FM2 - need to detect by fields
  const repIdentity = profile.representativeIdentity as any;
  const hasIneFields = !!(repIdentity?.clave_elector || 
                         (repIdentity?.issuer_country === 'MX' && repIdentity?.curp));
  
  // Mexican indicators
  const mexicanNationalityTerms = ['MEXICANA', 'MEXICANO', 'MEXICO', 'MX', 'MEX'];
  
  // If document is INE (by doc_type or by INE-specific fields), person is Mexican
  // Only Mexican citizens can have INE
  if (ineDocType === 'INE' || ineDocType === 'IFE' || hasIneFields) {
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
  
  // INE detection: Check for INE-specific fields (clave_elector, curp with vigencia)
  // INE schema uses different fields than FM2/Immigration - need to check both patterns
  // Using 'as any' because INE fields aren't in the ImmigrationProfile type (tech debt)
  const repIdentity = profile.representativeIdentity as any;
  const hasIneByFields = !!(repIdentity?.clave_elector || 
                           (repIdentity?.curp && (repIdentity?.vigencia_year || repIdentity?.emission_year)));
  const hasIneByDocType = !!profile.representativeIdentity?.document_number && 
                          (repDocType === 'INE' || repDocType === 'IFE');
  const hasIne = hasIneByFields || hasIneByDocType;
  
  // FM2/FM3 detection: Requires document_number AND immigration document type
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
    
    // FM2 expiry validation
    const fm2IssueDate = profile.representativeIdentity?.issue_date;
    const fm2ExpiryDate = profile.representativeIdentity?.expiry_date;
    if (hasFm2 && fm2IssueDate && !fm2ExpiryDate) {
      // FM2 with no expiry date - check if it's too old
      const issueYear = new Date(fm2IssueDate).getFullYear();
      // FM2/Tarjeta de Residente Permanente without expiry is VALID indefinitely for adults
      // Per Ley de Migración Art. 54 and Reglamento Art. 137
      // Only add info-level message, not a warning
      const currentYear = new Date().getFullYear();
      if (issueYear >= 2012) {
        // Post-2012 document without expiry = Residente Permanente (valid indefinitely)
        flags.push({
          code: "OTHER",
          level: "info",
          message: `Documento migratorio emitido en ${issueYear} sin fecha de expiración = Residente Permanente con vigencia indefinida para adultos.`
        });
        // No penalty - this is a valid document
      } else if (currentYear - issueYear > 12) {
        // Pre-2012 documents are genuinely obsolete (>12 years old)
        flags.push({
          code: "IMMIGRATION_DOC_EXPIRED",
          level: "warning",
          message: `Documento migratorio (FM2) emitido en ${issueYear} (${currentYear - issueYear} años). Los FM2 fueron reemplazados por Tarjetas de Residente en 2012.`,
          action_required: "Verificar si el estatus migratorio ha sido renovado con una Tarjeta de Residente."
        });
        scorePenalty += 0.1;
      }
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
  
  // =========================================================
  // D.1 IMMIGRATION DOCUMENT VALIDATION
  // Comprehensive validation of FM2, FM3, FMM, Residente Temporal/Permanente
  // Based on Mexican Immigration Law (Ley de Migración) and INM regulations
  // =========================================================
  if (profile.representativeIdentity) {
    const immigrationValidation = validateImmigrationDocument(profile);
    
    // List of codes that indicate valid/good status (no penalty needed)
    const validCodes = [
      'IDENTITY_DOC_VALID',
      'IMMIGRATION_DOC_VALID',
      'IMMIGRATION_DOC_VALID_PERMANENT',  // Residente Permanente without expiry = VALID
      'IMMIGRATION_DOC_NO_EXPIRY'         // Permanent resident no expiry = OK
    ];
    
    // Only flag if not a valid status
    if (!validCodes.includes(immigrationValidation.code)) {
      
      // Determine the appropriate flag code
      let flagCode: KycValidationFlag['code'] = 'OTHER';
      if (immigrationValidation.code.includes('EXPIRED') || 
          immigrationValidation.code.includes('OBSOLETE')) {
        flagCode = 'IMMIGRATION_DOC_EXPIRED';
      } else if (immigrationValidation.code.includes('INVALID') ||
                 immigrationValidation.code.includes('FMM')) {
        flagCode = 'REP_ID_MISMATCH';
      } else if (immigrationValidation.code === 'IMMIGRATION_CARD_OLD') {
        // Old card but still valid - just informational
        flagCode = 'OTHER';
      }
      
      flags.push({
        code: flagCode,
        level: immigrationValidation.level,
        message: immigrationValidation.message,
        action_required: immigrationValidation.action_required
      });
      
      // Score penalties based on severity
      if (immigrationValidation.level === 'critical') {
        if (!immigrationValidation.statusValid) {
          score -= 0.25; // Status invalid - major penalty
        } else {
          score -= 0.10; // Status valid but document issue
        }
      } else if (immigrationValidation.level === 'warning') {
        score -= 0.05;
      }
      // 'info' level = no penalty (just informational)
    }
  }

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
  
  // E.1 UBO Identity Verification Check
  // For compliance, we should verify the identity of UBOs (>25% owners)
  if (ubos.length > 0 && profile.representativeIdentity) {
    const repName = profile.representativeIdentity.full_name?.toUpperCase().trim() || '';
    const repNameTokens = new Set(repName.split(/\s+/).filter(t => t.length > 1));
    
    // Check if the verified identity matches any UBO
    const verifiedUbo = ubos.find(ubo => {
      const uboName = ubo.name.toUpperCase().trim();
      const uboTokens = new Set(uboName.split(/\s+/).filter(t => t.length > 1));
      // Token match: all tokens from shorter name appear in longer name
      const [smaller, larger] = repNameTokens.size <= uboTokens.size 
        ? [repNameTokens, uboTokens] 
        : [uboTokens, repNameTokens];
      let matchCount = 0;
      for (const token of smaller) {
        if (larger.has(token)) matchCount++;
      }
      return smaller.size > 0 && matchCount === smaller.size;
    });
    
    if (!verifiedUbo) {
      // Identity verified but it's not a UBO - the person with ID is not a beneficial owner
      // This is common when a non-UBO apoderado handles the onboarding
      const uboNames = ubos.map(u => `${u.name} (${u.percentage?.toFixed(0) || '?'}%)`).join(', ');
      const verifiedPersonPct = profile.companyIdentity?.shareholders?.find((sh: any) => {
        const shTokens = new Set(sh.name?.toUpperCase().split(/\s+/) || []);
        const idTokens = new Set(profile.representativeIdentity?.full_name?.toUpperCase().split(/\s+/) || []);
        let matchCount = 0;
        for (const token of idTokens) {
          if (shTokens.has(token)) matchCount++;
        }
        return matchCount >= 2;
      })?.percentage;
      
      flags.push({
        code: "UBO_IDENTITY_NOT_VERIFIED",
        level: "info", // Downgrade to info - this is expected when apoderado handles onboarding
        message: `INE verificada: ${profile.representativeIdentity.full_name}${verifiedPersonPct ? ` (${verifiedPersonPct}% participación)` : ''}. UBOs según Acta (>25%): ${uboNames}. Los UBOs están identificados en el Acta Constitutiva.`,
        action_required: `Para verificación completa de UBO, solicitar INE de: ${ubos[0]?.name || 'UBO principal'}`
      });
      // Don't penalize score - UBOs are identified in Acta, just not ID-verified
    } else {
      // The verified identity IS a UBO - this is the ideal case
      // No flag needed
    }
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

  // C.2 PROOF OF ADDRESS VALIDATION (NEW)
  // This validates the POA document's name against the client
  // and handles third-party POA scenarios (family, landlord, etc.)
  const poaValidation = validateProofOfAddress(profile);
  flags.push(...poaValidation.flags);
  score -= poaValidation.scorePenalty;

  // D. Doc Coverage (PF Mode: Skip Acta requirement)
  if (!isPF && !profile.companyIdentity) {
    flags.push({ code: "LOW_DOC_COVERAGE", level: "critical", message: "Missing Company Identity (Acta Constitutiva)." });
    score -= 0.3;
  }
  
  // D.1 SAT Constancia validation
  const actaRfc = profile.companyIdentity?.rfc?.toUpperCase().trim();
  const satRfc = profile.companyTaxProfile?.rfc?.toUpperCase().trim();
  const personaMoralRfcPattern = /^[A-Z]{3}\d{6}[A-Z0-9]{3}$/;  // 3 letters = corporate
  const personaFisicaRfcPattern = /^[A-Z]{4}\d{6}[A-Z0-9]{3}$/; // 4 letters = individual
  
  // CRITICAL: Determine if this is a Persona Moral based on having an Acta
  // An Acta Constitutiva is ONLY created for corporate entities
  const hasActa = !!profile.companyIdentity;
  const isPersonaMoral = hasActa; // If we have an Acta, it's ALWAYS Persona Moral
  const hasActaRfc = actaRfc && personaMoralRfcPattern.test(actaRfc);
  
  // Check if the SAT we have is a personal SAT (not company SAT)
  const satIsPersonal = satRfc && personaFisicaRfcPattern.test(satRfc);
  // satIsCorporate could be used for future validation but currently satIsPersonal is sufficient
  
  // Get company name for better error messages
  const companyName = profile.companyIdentity?.razon_social || 'la empresa';
  
  if (isPersonaMoral) {
    // For Persona Moral: We need the COMPANY's SAT Constancia
    if (!profile.companyTaxProfile) {
      // No SAT at all
      flags.push({ 
        code: "MISSING_COMPANY_SAT", 
        level: "critical", 
        message: `Falta Constancia de Situación Fiscal de la empresa "${companyName}". Se requiere SAT de la Persona Moral, no de socios individuales.`,
        action_required: `Solicitar Constancia de Situación Fiscal del SAT de la empresa. El RFC de la empresa NO está en el Acta - debe obtenerse del SAT.`
      });
      score -= 0.3;
    } else if (satIsPersonal) {
      // We have a SAT but it's a personal SAT (4-letter RFC = Persona Física)
      const satHolderName = profile.companyTaxProfile.razon_social || 'desconocido';
      flags.push({ 
        code: "WRONG_SAT_TYPE", 
        level: "critical", 
        message: `SAT Constancia proporcionada es de Persona Física (${satRfc}: ${satHolderName}), pero se requiere SAT de la Persona Moral "${companyName}".`,
        action_required: `Solicitar Constancia de Situación Fiscal de la EMPRESA (no de socios individuales). El RFC de la empresa tendrá formato de 3 letras (ej: DIP######XX#).`
      });
      score -= 0.3;
    } else if (hasActaRfc && satRfc && satRfc !== actaRfc) {
      // We have both Acta RFC and SAT RFC but they don't match
      flags.push({ 
        code: "RFC_MISMATCH", 
        level: "critical", 
        message: `RFC del Acta (${actaRfc}) no coincide con RFC del SAT (${satRfc}). Verificar que ambos documentos correspondan a la misma empresa.`,
        action_required: `Verificar documentos. Si el Acta es correcto, solicitar SAT con RFC: ${actaRfc}`
      });
      score -= 0.25;
    }
    // If satIsCorporate and (no actaRfc OR matches), that's good - no flag needed
  } else {
    // For Persona Física: Standard SAT validation
    if (!profile.companyTaxProfile) {
      flags.push({ code: "LOW_DOC_COVERAGE", level: "critical", message: "Falta Constancia de Situación Fiscal (SAT)." });
      score -= 0.3;
    }
  }
  
  // D.1 Check for missing Folio Mercantil (ONLY for Sociedades Mercantiles)
  // IMPORTANT: Sociedad Civil (S.C.) does NOT require FME - it's regulated by Código Civil, not LGSM
  // Only Sociedades Mercantiles (S.A., S.A.P.I., S. de R.L., S.A.S., etc.) require inscription in RPP
  if (!isPF && profile.companyIdentity) {
    const razonSocial = (profile.companyIdentity.razon_social || '').toUpperCase();
    
    // Check if this is a Sociedad Mercantil (requires FME) or Sociedad Civil (doesn't require FME)
    const isSociedadMercantil = /\b(S\.?A\.?|S\.?A\.?P\.?I\.?|S\.?\s*DE\s*R\.?L\.?|S\.?A\.?S\.?|S\.?C\.?A\.?|SOCIEDAD\s+AN[ÓO]NIMA|SOCIEDAD\s+DE\s+RESPONSABILIDAD\s+LIMITADA)\b/i.test(razonSocial);
    const isSociedadCivil = /\bSOCIEDAD\s+CIVIL\b|,\s*S\.?C\.?\s*$/i.test(razonSocial);
    
    const registry = profile.companyIdentity.registry;
    
    if (isSociedadMercantil && !isSociedadCivil) {
      // Sociedad Mercantil - FME is REQUIRED per Código de Comercio Art. 21
      // Check multiple sources: registry from Acta, or boletaRPC
      const hasFMEFromActa = !!(registry?.fme || registry?.folio || registry?.nci);
      const hasFMEFromBoleta = !!(profile as any).boletaRPC?.numero_unico_documento;
      
      if (!hasFMEFromActa && !hasFMEFromBoleta) {
        flags.push({ 
          code: "MISSING_FME", 
          level: "warning", 
          message: "Falta Folio Mercantil Electrónico (FME) o número de inscripción en el Registro Público de Comercio. Requerido para Sociedades Mercantiles según Código de Comercio Art. 21.",
          action_required: "Solicitar boleta de inscripción o constancia del Registro Público de Comercio."
        });
        score -= 0.05;
      }
    }
    // For Sociedad Civil - NO FME required (regulated by Código Civil, not Código de Comercio)
    // No flag needed
  }
  
  // D.1.5 RNIE Validation for companies with foreign shareholders
  // Per Ley de Inversión Extranjera Art. 32-35, companies with foreign shareholders must register with RNIE
  const shareholders = profile.companyIdentity?.shareholders || [];
  const hasForeignShareholders = shareholders.some(s => {
    const nationality = (s.nationality || '').toUpperCase();
    return nationality && 
           !['MEXICANA', 'MEXICANO', 'MEXICO', 'MX', 'MEX'].includes(nationality);
  });
  
  if (hasForeignShareholders) {
    // Check if RNIE registration exists
    const hasRNIE = !!(profile as any).rnieConstancia?.folio_ingreso;
    const hasSREConvenio = !!(profile as any).sreConvenio?.folio;
    
    if (!hasRNIE) {
      flags.push({
        code: "MISSING_RNIE",
        level: "warning",
        message: "Empresa con accionistas extranjeros: Falta Constancia de Inscripción en el Registro Nacional de Inversiones Extranjeras (RNIE). Requerido por Ley de Inversión Extranjera Art. 32.",
        action_required: "Solicitar acuse de recibo o constancia de inscripción del RNIE a través de fedatario público."
      });
      score -= 0.05;
    }
    
    // Calculate foreign ownership percentage
    let totalShares = 0;
    let foreignShares = 0;
    shareholders.forEach(s => {
      const shares = s.shares || 0;
      totalShares += shares;
      const nationality = (s.nationality || '').toUpperCase();
      if (nationality && !['MEXICANA', 'MEXICANO', 'MEXICO', 'MX', 'MEX'].includes(nationality)) {
        foreignShares += shares;
      }
    });
    
    const foreignPercentage = totalShares > 0 ? (foreignShares / totalShares) * 100 : 0;
    
    if (foreignPercentage > 49) {
      flags.push({
        code: "FOREIGN_OWNERSHIP_HIGH",
        level: "info",
        message: `Participación extranjera del ${foreignPercentage.toFixed(1)}% (mayor al 49%). Verificar que la actividad económica permita mayoría extranjera según Ley de Inversión Extranjera.`,
        action_required: "Verificar que el objeto social no esté restringido a inversión mexicana mayoritaria."
      });
    }
    
    if (!hasSREConvenio) {
      flags.push({
        code: "MISSING_SRE_CONVENIO",
        level: "info",
        message: "Empresa con accionistas extranjeros: No se encontró Convenio de Extranjería registrado ante SRE. Recomendado para mayor seguridad jurídica.",
        action_required: "Verificar si el Convenio de Extranjería fue registrado en la escritura constitutiva."
      });
    }
  }
  
  // D.2 Tax Regime validation for commercial capability
  if (profile.companyTaxProfile?.tax_regime) {
    const regime = profile.companyTaxProfile.tax_regime.toUpperCase();
    if (regime.includes('SIN OBLIGACIONES')) {
      const entityType = classifyEntityType(profile);
      if (entityType === 'PERSONA_FISICA_SIN_OBLIGACIONES') {
        flags.push({
          code: "TAX_REGIME_NO_COMMERCE",
          level: "warning",
          message: `Régimen Fiscal: "Sin obligaciones fiscales". Esta persona NO puede emitir facturas ni realizar actividad empresarial. Apto solo para relaciones personales/no comerciales.`,
          action_required: "Si se requiere para actividad comercial, el cliente debe cambiar su régimen fiscal ante SAT (RESICO o Actividad Empresarial)."
        });
        // Don't penalize if it's valid for their use case
      }
    }
  }
  
  // D.3 POA Doc Coverage - only if POA validation didn't already add flags
  if (profile.addressEvidence.length === 0 && !profile.bankIdentity && profile.bankAccounts.length === 0) {
      if (!poaValidation.flags.some(f => f.code === "LOW_DOC_COVERAGE")) {
        flags.push({ code: "LOW_DOC_COVERAGE", level: "critical", message: "No Proof of Address or Bank Statements provided." });
        score -= 0.2;
      }
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

  // =========================================================================
  // F. VALIDATION CHECKLIST - Consistent summary for all clients
  // =========================================================================
  // This ensures users can see what HAS been validated, not just what's missing
  
  const checklist: string[] = [];
  
  // 1. Entity Classification
  // CRITICAL: Persona Moral is determined by having an Acta, NOT by having RFC in the Acta
  const hasActaConstitutiva = !!profile.companyIdentity;
  const companyRfcFromActa = profile.companyIdentity?.rfc?.toUpperCase().trim();
  const checklistCompanyName = profile.companyIdentity?.razon_social || 'la empresa';
  const checklistSatRfc = profile.companyTaxProfile?.rfc?.toUpperCase().trim();
  const checklistSatIsPersonal = checklistSatRfc && /^[A-Z]{4}\d{6}[A-Z0-9]{3}$/.test(checklistSatRfc);
  const checklistSatIsCorporate = checklistSatRfc && /^[A-Z]{3}\d{6}[A-Z0-9]{3}$/.test(checklistSatRfc);
  
  if (isPF) {
    checklist.push(`✓ Tipo de Entidad: Persona Física`);
  } else {
    checklist.push(`✓ Tipo de Entidad: Persona Moral`);
    // Acta Constitutiva
    if (hasActaConstitutiva) {
      checklist.push(`✓ Acta Constitutiva: Verificada (${checklistCompanyName})`);
      if (companyRfcFromActa) {
        checklist.push(`✓ RFC Empresa (del Acta): ${companyRfcFromActa}`);
      } else {
        checklist.push(`⚠️ RFC Empresa: No especificado en Acta (se requiere SAT de la empresa para obtener RFC)`);
      }
      if (profile.companyIdentity?.registry?.folio || profile.companyIdentity?.registry?.fme) {
        checklist.push(`✓ Registro Público: Folio ${profile.companyIdentity.registry.folio || profile.companyIdentity.registry.fme}`);
      }
    } else {
      checklist.push(`✗ Acta Constitutiva: No proporcionada`);
    }
  }
  
  // 2. Constancia SAT
  // Get personal SAT Constancias from profile metadata (attached by server.ts)
  const personalSatConstancias = (profile as any)._personalSatConstancias || [];
  
  if (hasActaConstitutiva) {
    // For Persona Moral: We need the COMPANY's SAT Constancia
    if (checklistSatRfc) {
      if (checklistSatIsCorporate) {
        // Good: We have a corporate SAT (3-letter RFC)
        if (!companyRfcFromActa || checklistSatRfc === companyRfcFromActa) {
          checklist.push(`✓ Constancia SAT Empresa: RFC ${checklistSatRfc}`);
          checklist.push(`✓ Régimen Fiscal: ${profile.companyTaxProfile?.tax_regime || 'No especificado'}`);
        } else {
          checklist.push(`⚠️ Constancia SAT: RFC ${checklistSatRfc} no coincide con RFC del Acta (${companyRfcFromActa})`);
        }
      } else if (checklistSatIsPersonal) {
        // Bad: We have a personal SAT (4-letter RFC) but need company SAT
        checklist.push(`✗ Constancia SAT Empresa: PENDIENTE`);
        checklist.push(`   → Se requiere Constancia de Situación Fiscal de "${checklistCompanyName}"`);
      }
    } else {
      checklist.push(`✗ Constancia SAT Empresa: No proporcionada`);
      checklist.push(`   → Se requiere Constancia de Situación Fiscal de "${checklistCompanyName}"`);
    }
    
    // Show ALL personal SAT Constancias (shareholders/representatives)
    if (personalSatConstancias.length > 0) {
      checklist.push(`📋 SAT Constancias de Socios/Representantes (${personalSatConstancias.length} documentos):`);
      for (const sat of personalSatConstancias) {
        // Check if this person is a shareholder or legal representative
        const shareholders = profile.companyIdentity?.shareholders || [];
        const legalReps = profile.companyIdentity?.legal_representatives || [];
        const satName = (sat.razon_social || '').toUpperCase();
        
        const isShareholder = shareholders.some((sh: any) => 
          satName.includes(sh.name?.split(' ')[0]?.toUpperCase()) || 
          sh.name?.toUpperCase().includes(satName.split(' ')[0])
        );
        const isLegalRep = legalReps.some((rep: any) => 
          satName.includes(rep.name?.split(' ')[0]?.toUpperCase()) || 
          rep.name?.toUpperCase().includes(satName.split(' ')[0])
        );
        
        const role = isShareholder && isLegalRep ? 'Socio/Representante' : 
                     isShareholder ? 'Socio' : 
                     isLegalRep ? 'Representante Legal' : 'Persona relacionada';
        
        checklist.push(`   ✓ ${sat.razon_social}: RFC ${sat.rfc} (${role})`);
      }
    }
  } else {
    // For Persona Física
    if (profile.companyTaxProfile?.rfc) {
      checklist.push(`✓ Constancia SAT: RFC ${profile.companyTaxProfile.rfc}`);
      checklist.push(`✓ Régimen Fiscal: ${profile.companyTaxProfile.tax_regime || 'No especificado'}`);
    } else {
      checklist.push(`✗ Constancia SAT: No proporcionada`);
    }
  }
  
  // 3. Identity Documents
  if (nationality === 'mexican') {
    if (profile.representativeIdentity?.document_type === 'INE') {
      checklist.push(`✓ Identificación: INE vigente`);
    } else if (profile.passportIdentity) {
      checklist.push(`✓ Identificación: Pasaporte mexicano`);
    } else {
      checklist.push(`✗ Identificación: Falta INE o Pasaporte`);
    }
  } else if (nationality === 'foreign') {
    // Foreign national - need passport + immigration doc
    if (profile.passportIdentity) {
      checklist.push(`✓ Pasaporte: ${profile.passportIdentity.nationality || 'Extranjero'}`);
    } else {
      checklist.push(`✗ Pasaporte: No proporcionado`);
    }
    if (profile.representativeIdentity) {
      const docType = profile.representativeIdentity.document_type || 'Documento migratorio';
      if (docType.includes('PERMANENTE')) {
        checklist.push(`✓ Estatus Migratorio: Residente Permanente (vigencia indefinida)`);
      } else if (docType.includes('TEMPORAL')) {
        const expiry = profile.representativeIdentity.expiry_date || 'No especificada';
        checklist.push(`✓ Estatus Migratorio: Residente Temporal (vigencia: ${expiry})`);
      } else {
        checklist.push(`✓ Estatus Migratorio: ${docType}`);
      }
    } else {
      checklist.push(`✗ Estatus Migratorio: No proporcionado`);
    }
  }
  
  // 4. Proof of Address
  if (profile.addressEvidence && profile.addressEvidence.length > 0) {
    const latestPoa = profile.addressEvidence[0];
    const poaName = latestPoa.client_name || 'N/A';
    checklist.push(`✓ Comprobante de Domicilio: ${latestPoa.vendor_name || 'Servicio'} a nombre de "${poaName}"`);
  } else {
    checklist.push(`✗ Comprobante de Domicilio: No proporcionado`);
  }
  
  // 5. Bank Account - Check both bankAccounts array AND bankIdentity (demo mode)
  if (profile.bankIdentity) {
    // Demo mode uses bankIdentity
    checklist.push(`✓ Cuenta Bancaria: ${profile.bankIdentity.bank_name || 'Banco'} - ${profile.bankIdentity.account_holder_name || 'Titular'}`);
  } else if (profile.bankAccounts && profile.bankAccounts.length > 0) {
    const bank = profile.bankAccounts[0];
    checklist.push(`✓ Cuenta Bancaria: ${bank.bank_name || 'Banco'} - ${bank.account_holder_name || 'Titular'}`);
  } else {
    checklist.push(`✗ Cuenta Bancaria: No proporcionada`);
  }
  
  // Add checklist as info-level flag (using OTHER code type for compatibility)
  flags.push({
    code: "OTHER",
    level: "info",
    message: `📋 VALIDATION_CHECKLIST:\n${checklist.join('\n')}`
  });

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
      const isUbo = ubos.some(u => u.name === sh.name);
      const uboThreshold = 25;

      // PRIORITY: Use explicit percentage from extraction if available (e.g., Sociedad Civil with 80%/20%)
      // Only fall back to share-based calculation if no explicit percentage was extracted
      let computedPercentage: number | null = null;
      if (sh.percentage !== null && sh.percentage !== undefined) {
        computedPercentage = sh.percentage;
      } else if (shares && totalShares > 0) {
        computedPercentage = Number(((shares / totalShares) * 100).toFixed(2));
      }

      return {
        name: sh.name,
        shares,
        totalShares,
        computedPercentage,
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

