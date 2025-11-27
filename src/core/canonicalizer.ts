/**
 * Canonicalization Library for MexKYC
 * 
 * Handles normalization and comparison of names, entities, and addresses
 * with Mexican-specific rules (accents, legal suffixes, naming conventions).
 * 
 * @module core/canonicalizer
 * @version 1.0.0
 * @date 2025-11-27
 */

// ============================================================================
// TYPES
// ============================================================================

export interface CanonicalResult {
  /** The canonicalized string */
  canonical: string;
  /** Individual tokens (for order-independent matching) */
  tokens: string[];
  /** Confidence in the canonicalization (0-100) */
  confidence: number;
  /** How the match was achieved */
  matchType: 'exact' | 'normalized' | 'token' | 'phonetic';
  /** List of transformations applied */
  transformations: string[];
}

export interface MatchResult {
  /** Whether the inputs match */
  isMatch: boolean;
  /** Confidence score (0-100) */
  confidence: number;
  /** Method used for matching */
  matchType: 'exact' | 'normalized' | 'token' | 'phonetic' | 'semantic';
  /** Human-readable explanation */
  reasoning: string;
  /** Evidence supporting the match */
  evidence: { source: string; value: string }[];
}

export interface Address {
  street?: string | null;
  ext_number?: string | null;
  int_number?: string | null;
  colonia?: string | null;
  municipio?: string | null;
  estado?: string | null;
  cp?: string | null;
  country?: string | null;
}

// ============================================================================
// DICTIONARIES
// ============================================================================

/**
 * Spanish nickname/alias mappings
 * Maps formal names to common nicknames and vice versa
 */
const NICKNAME_MAP: Record<string, string[]> = {
  'JOSE': ['PEPE', 'CHEPE', 'PEPITO'],
  'MARIA': ['MA', 'MARI', 'MARY'],
  'FRANCISCO': ['PACO', 'PANCHO', 'FRANK', 'CISCO'],
  'MANUEL': ['MANOLO', 'MANNY', 'MANUELITO'],
  'GUADALUPE': ['LUPE', 'LUPITA'],
  'JESUS': ['CHUCHO', 'CHUY', 'JESSE'],
  'ANTONIO': ['TOÑO', 'TONY', 'TONO'],
  'MIGUEL': ['MIKE', 'MICKY'],
  'FERNANDO': ['NANDO', 'FERNIE'],
  'ROBERTO': ['BETO', 'BOB', 'BOBBY'],
  'ALBERTO': ['BETO', 'AL', 'ALBERT'],
  'RICARDO': ['RICKY', 'RICK'],
  'EDUARDO': ['EDDIE', 'LALO', 'EDU'],
  'RAFAEL': ['RAFA', 'RALPH'],
  'CARLOS': ['CHARLIE', 'CARLITOS'],
  'LUIS': ['LUCHO', 'LOUIE'],
  'ENRIQUE': ['QUIQUE', 'HENRY', 'KIKE'],
  'JORGE': ['GEORGE', 'COQUE'],
  'ROSA': ['ROSITA', 'ROSIE'],
  'TERESA': ['TERE', 'TERESITA'],
  'PATRICIA': ['PATY', 'PATTY', 'TRISH'],
  'ELIZABETH': ['ELI', 'ELIZA', 'BETH', 'BETTY'],
  'ALEJANDRO': ['ALEX', 'JANDRO'],
  'ALEJANDRA': ['ALEX', 'JANDRA', 'ALE'],
  'GUILLERMO': ['MEMO', 'WILLY', 'BILL'],
};

/**
 * Legal entity suffix patterns (documented here for reference)
 * 
 * Mexican Entity Types:
 * - SA (S.A.) = Sociedad Anónima
 * - SA DE CV (S.A. de C.V.) = Sociedad Anónima de Capital Variable
 * - SC (S.C.) = Sociedad Civil
 * - S DE RL (S. de R.L.) = Sociedad de Responsabilidad Limitada  
 * - SAPI = Sociedad Anónima Promotora de Inversión
 * - SAS = Sociedad por Acciones Simplificada
 * 
 * Foreign Entity Types (for reference):
 * - INC = Incorporated
 * - LLC = Limited Liability Company
 * - LTD = Limited
 * - CORP = Corporation
 * 
 * See normalizeLegalSuffix() for the actual matching patterns.
 */

/**
 * Mexican state name normalizations
 */
const STATE_MAP: Record<string, string> = {
  'CIUDAD DE MEXICO': 'CDMX',
  'CIUDAD DE MÉXICO': 'CDMX',
  'D.F.': 'CDMX',
  'DF': 'CDMX',
  'DISTRITO FEDERAL': 'CDMX',
  'CDMX': 'CDMX',
  'EDO. DE MEXICO': 'ESTADO DE MEXICO',
  'EDO. DE MÉXICO': 'ESTADO DE MEXICO',
  'EDO DE MEXICO': 'ESTADO DE MEXICO',
  'EDO MEX': 'ESTADO DE MEXICO',
  'EDOMEX': 'ESTADO DE MEXICO',
  'MEX': 'ESTADO DE MEXICO',
  'NL': 'NUEVO LEON',
  'N.L.': 'NUEVO LEON',
  'JAL': 'JALISCO',
  'JAL.': 'JALISCO',
};

/**
 * Street type normalizations
 */
const STREET_TYPE_MAP: Record<string, string> = {
  'AV': 'AVENIDA',
  'AV.': 'AVENIDA',
  'AVE': 'AVENIDA',
  'AVE.': 'AVENIDA',
  'AVDA': 'AVENIDA',
  'AVDA.': 'AVENIDA',
  'C': 'CALLE',
  'C.': 'CALLE',
  'CLL': 'CALLE',
  'CLL.': 'CALLE',
  'BLVD': 'BOULEVARD',
  'BLVD.': 'BOULEVARD',
  'BLV': 'BOULEVARD',
  'BLV.': 'BOULEVARD',
  'CALZ': 'CALZADA',
  'CALZ.': 'CALZADA',
  'CDA': 'CERRADA',
  'CDA.': 'CERRADA',
  'PRIV': 'PRIVADA',
  'PRIV.': 'PRIVADA',
  'PROL': 'PROLONGACION',
  'PROL.': 'PROLONGACION',
  'FRACC': 'FRACCIONAMIENTO',
  'FRACC.': 'FRACCIONAMIENTO',
  'COL': 'COLONIA',
  'COL.': 'COLONIA',
};

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Removes diacritics/accents from a string
 * ELOÍSA → ELOISA, MARTÍNEZ → MARTINEZ
 */
export function removeDiacritics(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Normalizes whitespace and punctuation
 */
export function normalizeWhitespace(input: string): string {
  return input
    .replace(/[.,\-_()]/g, ' ')  // Replace punctuation with spaces
    .replace(/\s+/g, ' ')         // Collapse multiple spaces
    .trim();
}

/**
 * Extracts tokens from a string (for order-independent matching)
 */
export function tokenize(input: string): string[] {
  const normalized = removeDiacritics(input.toUpperCase());
  const cleaned = normalizeWhitespace(normalized);
  return cleaned
    .split(' ')
    .filter(token => token.length > 1)  // Filter out single characters
    .sort();  // Sort for consistent comparison
}

/**
 * Resolves a nickname to its canonical form
 */
function resolveNickname(token: string): string {
  const upper = token.toUpperCase();
  
  // Check if this is a canonical name
  if (NICKNAME_MAP[upper]) {
    return upper;
  }
  
  // Check if this is a nickname
  for (const [canonical, nicknames] of Object.entries(NICKNAME_MAP)) {
    if (nicknames.includes(upper)) {
      return canonical;
    }
  }
  
  return upper;
}

/**
 * Normalizes legal entity suffixes
 * 
 * Strategy: First normalize dots/spaces to a consistent form,
 * then match against known patterns.
 */
function normalizeLegalSuffix(input: string): { normalized: string; suffix: string | null } {
  let normalized = input.toUpperCase();
  let foundSuffix: string | null = null;
  
  // Create a normalized version for pattern matching (remove dots, normalize spaces)
  const forMatching = normalized
    .replace(/\./g, '')           // Remove all dots
    .replace(/,/g, '')            // Remove commas
    .replace(/\s+/g, ' ')         // Normalize spaces
    .trim();
  
  // Define patterns in normalized form (no dots) mapped to canonical output
  const normalizedPatterns: [RegExp, string][] = [
    // Longest patterns first (order matters!)
    [/\bSOCIEDAD ANONIMA DE CAPITAL VARIABLE\b/gi, 'SA DE CV'],
    [/\bS ?A ?P ?I ?DE ?C ?V\b/gi, 'SAPI DE CV'],
    [/\bS ?DE ?R ?L ?DE ?C ?V\b/gi, 'S DE RL DE CV'],
    [/\bS ?A ?DE ?C ?V\b/gi, 'SA DE CV'],
    [/\bS ?DE ?R ?L\b/gi, 'S DE RL'],
    [/\bSOCIEDAD ANONIMA\b/gi, 'SA'],
    [/\bSOCIEDAD CIVIL\b/gi, 'SC'],
    [/\bSOCIEDAD DE RESPONSABILIDAD LIMITADA\b/gi, 'S DE RL'],
    [/\bS ?A ?P ?I\b/gi, 'SAPI'],
    [/\bS ?A ?S\b/gi, 'SAS'],
    [/\bS ?A\b/gi, 'SA'],
    [/\bS ?C\b/gi, 'SC'],
    [/\bINCORPORATED\b/gi, 'INC'],
    [/\bCORPORATION\b/gi, 'CORP'],
    [/\bLIMITED\b/gi, 'LTD'],
    [/\bL ?L ?C\b/gi, 'LLC'],
    [/\bINC\b/gi, 'INC'],
    [/\bCORP\b/gi, 'CORP'],
    [/\bLTD\b/gi, 'LTD'],
  ];
  
  // Try to match and replace
  for (const [pattern, replacement] of normalizedPatterns) {
    if (pattern.test(forMatching)) {
      // Find and replace in the original (with dots/commas removed for consistency)
      normalized = forMatching.replace(pattern, replacement);
      foundSuffix = replacement;
      break;
    }
  }
  
  // If no pattern matched, just clean up dots and commas
  if (!foundSuffix) {
    normalized = forMatching;
  }
  
  return { normalized, suffix: foundSuffix };
}

// ============================================================================
// MAIN CANONICALIZATION FUNCTIONS
// ============================================================================

/**
 * Canonicalizes a person's name
 * 
 * Handles:
 * - Accent folding (ELOÍSA → ELOISA)
 * - Word order (ARROYO MARTINEZ ELOISA ↔ ELOISA ARROYO MARTINEZ)
 * - Nicknames (JOSÉ ↔ PEPE)
 * - Whitespace normalization
 * 
 * @param input - The name to canonicalize
 * @returns Canonical result with tokens for matching
 */
export function canonicalizeName(input: string): CanonicalResult {
  if (!input || typeof input !== 'string') {
    return {
      canonical: '',
      tokens: [],
      confidence: 0,
      matchType: 'exact',
      transformations: []
    };
  }
  
  const transformations: string[] = [];
  let result = input;
  
  // Step 1: Uppercase
  result = result.toUpperCase();
  
  // Step 2: Remove diacritics
  const withoutDiacritics = removeDiacritics(result);
  if (withoutDiacritics !== result) {
    transformations.push('diacritics_removed');
    result = withoutDiacritics;
  }
  
  // Step 3: Normalize whitespace
  const withNormalizedSpace = normalizeWhitespace(result);
  if (withNormalizedSpace !== result) {
    transformations.push('whitespace_normalized');
    result = withNormalizedSpace;
  }
  
  // Step 4: Tokenize and resolve nicknames
  const rawTokens = result.split(' ').filter(t => t.length > 1);
  const resolvedTokens = rawTokens.map(token => {
    const resolved = resolveNickname(token);
    if (resolved !== token) {
      transformations.push(`nickname_resolved:${token}→${resolved}`);
    }
    return resolved;
  });
  
  // Step 5: Sort tokens for canonical form
  const sortedTokens = [...resolvedTokens].sort();
  
  return {
    canonical: sortedTokens.join(' '),
    tokens: sortedTokens,
    confidence: 100,
    matchType: transformations.length === 0 ? 'exact' : 'normalized',
    transformations
  };
}

/**
 * Canonicalizes a legal entity name
 * 
 * Handles:
 * - Accent folding
 * - Legal suffix normalization (S.A. de C.V. → SA DE CV)
 * - Whitespace and punctuation
 * 
 * @param input - The entity name to canonicalize
 * @returns Canonical result
 */
export function canonicalizeEntity(input: string): CanonicalResult {
  if (!input || typeof input !== 'string') {
    return {
      canonical: '',
      tokens: [],
      confidence: 0,
      matchType: 'exact',
      transformations: []
    };
  }
  
  const transformations: string[] = [];
  let result = input;
  
  // Step 1: Uppercase
  result = result.toUpperCase();
  
  // Step 2: Remove diacritics
  const withoutDiacritics = removeDiacritics(result);
  if (withoutDiacritics !== result) {
    transformations.push('diacritics_removed');
    result = withoutDiacritics;
  }
  
  // Step 3: Normalize legal suffixes
  const { normalized, suffix } = normalizeLegalSuffix(result);
  if (normalized !== result) {
    transformations.push(`legal_suffix_normalized:${suffix}`);
    result = normalized;
  }
  
  // Step 4: Normalize whitespace
  const withNormalizedSpace = normalizeWhitespace(result);
  if (withNormalizedSpace !== result) {
    transformations.push('whitespace_normalized');
    result = withNormalizedSpace;
  }
  
  // Step 5: Tokenize
  const tokens = result.split(' ').filter(t => t.length > 0).sort();
  
  return {
    canonical: result,
    tokens,
    confidence: 100,
    matchType: transformations.length === 0 ? 'exact' : 'normalized',
    transformations
  };
}

/**
 * Canonicalizes a Mexican address
 * 
 * Handles:
 * - Street type normalization (AV. → AVENIDA)
 * - State normalization (D.F. → CDMX)
 * - Postal code formatting
 * 
 * @param input - The address object to canonicalize
 * @returns Canonical result
 */
export function canonicalizeAddress(input: Address): CanonicalResult {
  if (!input) {
    return {
      canonical: '',
      tokens: [],
      confidence: 0,
      matchType: 'exact',
      transformations: []
    };
  }
  
  const transformations: string[] = [];
  const parts: string[] = [];
  
  // Process street
  if (input.street) {
    let street = removeDiacritics(input.street.toUpperCase());
    
    // Normalize street types
    for (const [abbrev, full] of Object.entries(STREET_TYPE_MAP)) {
      const regex = new RegExp(`^${abbrev.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`, 'i');
      if (regex.test(street)) {
        street = street.replace(regex, `${full} `);
        transformations.push(`street_type_normalized:${abbrev}→${full}`);
        break;
      }
    }
    
    parts.push(street);
  }
  
  // Process exterior number
  if (input.ext_number) {
    parts.push(`NO ${input.ext_number}`);
  }
  
  // Process interior number
  if (input.int_number) {
    parts.push(`INT ${input.int_number}`);
  }
  
  // Process colonia
  if (input.colonia) {
    parts.push(removeDiacritics(input.colonia.toUpperCase()));
  }
  
  // Process municipio
  if (input.municipio) {
    parts.push(removeDiacritics(input.municipio.toUpperCase()));
  }
  
  // Process estado
  if (input.estado) {
    let estado = removeDiacritics(input.estado.toUpperCase());
    const normalizedEstado = STATE_MAP[estado];
    if (normalizedEstado) {
      transformations.push(`state_normalized:${estado}→${normalizedEstado}`);
      estado = normalizedEstado;
    }
    parts.push(estado);
  }
  
  // Process postal code
  if (input.cp) {
    const cp = input.cp.replace(/\D/g, '').padStart(5, '0');
    parts.push(`CP ${cp}`);
  }
  
  const canonical = parts.join(', ');
  const tokens = canonical.split(/[\s,]+/).filter(t => t.length > 0);
  
  return {
    canonical,
    tokens,
    confidence: 100,
    matchType: transformations.length === 0 ? 'exact' : 'normalized',
    transformations
  };
}

// ============================================================================
// COMPARISON FUNCTIONS
// ============================================================================

/**
 * Calculates Jaccard similarity between two token sets
 */
function jaccardSimilarity(tokens1: string[], tokens2: string[]): number {
  const set1 = new Set(tokens1);
  const set2 = new Set(tokens2);
  
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  
  if (union.size === 0) return 0;
  return (intersection.size / union.size) * 100;
}

/**
 * Calculates token overlap percentage
 * Returns the percentage of tokens from the smaller set found in the larger set
 */
function tokenOverlap(tokens1: string[], tokens2: string[]): number {
  const set1 = new Set(tokens1);
  const set2 = new Set(tokens2);
  
  const [smaller, larger] = set1.size <= set2.size 
    ? [set1, set2] 
    : [set2, set1];
  
  if (smaller.size === 0) return 0;
  
  let matchCount = 0;
  for (const token of smaller) {
    if (larger.has(token)) matchCount++;
  }
  
  return (matchCount / smaller.size) * 100;
}

/**
 * Compares two person names with intelligent matching
 * 
 * @param a - First name
 * @param b - Second name
 * @returns Match result with confidence and reasoning
 */
export function compareNames(a: string, b: string): MatchResult {
  const evidence: { source: string; value: string }[] = [
    { source: 'input_a', value: a },
    { source: 'input_b', value: b }
  ];
  
  // Handle empty inputs
  if (!a || !b) {
    return {
      isMatch: false,
      confidence: 0,
      matchType: 'exact',
      reasoning: 'One or both inputs are empty',
      evidence
    };
  }
  
  // Step 1: Exact match
  if (a.toUpperCase().trim() === b.toUpperCase().trim()) {
    return {
      isMatch: true,
      confidence: 100,
      matchType: 'exact',
      reasoning: 'Exact match after case normalization',
      evidence
    };
  }
  
  // Step 2: Canonicalize both
  const canonA = canonicalizeName(a);
  const canonB = canonicalizeName(b);
  
  evidence.push(
    { source: 'canonical_a', value: canonA.canonical },
    { source: 'canonical_b', value: canonB.canonical }
  );
  
  // Step 3: Canonical exact match
  if (canonA.canonical === canonB.canonical) {
    const transformations = [...canonA.transformations, ...canonB.transformations];
    return {
      isMatch: true,
      confidence: 98,
      matchType: 'normalized',
      reasoning: `Match after canonicalization: ${transformations.join(', ')}`,
      evidence
    };
  }
  
  // Step 4: Token-based matching (order-independent)
  const overlap = tokenOverlap(canonA.tokens, canonB.tokens);
  const jaccard = jaccardSimilarity(canonA.tokens, canonB.tokens);
  
  // High overlap = likely match
  if (overlap >= 100 && jaccard >= 80) {
    return {
      isMatch: true,
      confidence: Math.round(jaccard),
      matchType: 'token',
      reasoning: `Token match: ${overlap.toFixed(0)}% overlap, ${jaccard.toFixed(0)}% Jaccard similarity`,
      evidence
    };
  }
  
  // Medium overlap = possible match (needs review)
  if (overlap >= 75 && jaccard >= 60) {
    return {
      isMatch: true,
      confidence: Math.round(jaccard),
      matchType: 'token',
      reasoning: `Partial token match: ${overlap.toFixed(0)}% overlap. May need verification.`,
      evidence
    };
  }
  
  // Low overlap = likely different
  return {
    isMatch: false,
    confidence: Math.round(jaccard),
    matchType: 'token',
    reasoning: `Low token similarity: ${overlap.toFixed(0)}% overlap, ${jaccard.toFixed(0)}% Jaccard. Likely different names.`,
    evidence
  };
}

/**
 * Compares two entity names with intelligent matching
 * 
 * @param a - First entity name
 * @param b - Second entity name
 * @returns Match result with confidence and reasoning
 */
export function compareEntities(a: string, b: string): MatchResult {
  const evidence: { source: string; value: string }[] = [
    { source: 'input_a', value: a },
    { source: 'input_b', value: b }
  ];
  
  // Handle empty inputs
  if (!a || !b) {
    return {
      isMatch: false,
      confidence: 0,
      matchType: 'exact',
      reasoning: 'One or both inputs are empty',
      evidence
    };
  }
  
  // Step 1: Exact match
  if (a.toUpperCase().trim() === b.toUpperCase().trim()) {
    return {
      isMatch: true,
      confidence: 100,
      matchType: 'exact',
      reasoning: 'Exact match after case normalization',
      evidence
    };
  }
  
  // Step 2: Canonicalize both
  const canonA = canonicalizeEntity(a);
  const canonB = canonicalizeEntity(b);
  
  evidence.push(
    { source: 'canonical_a', value: canonA.canonical },
    { source: 'canonical_b', value: canonB.canonical }
  );
  
  // Step 3: Canonical exact match
  if (canonA.canonical === canonB.canonical) {
    const transformations = [...canonA.transformations, ...canonB.transformations];
    return {
      isMatch: true,
      confidence: 98,
      matchType: 'normalized',
      reasoning: `Match after canonicalization: ${transformations.join(', ')}`,
      evidence
    };
  }
  
  // Step 4: Token-based matching
  const overlap = tokenOverlap(canonA.tokens, canonB.tokens);
  const jaccard = jaccardSimilarity(canonA.tokens, canonB.tokens);
  
  // For entities, we need higher confidence
  if (overlap >= 100 && jaccard >= 85) {
    return {
      isMatch: true,
      confidence: Math.round(jaccard),
      matchType: 'token',
      reasoning: `Entity token match: ${overlap.toFixed(0)}% overlap, ${jaccard.toFixed(0)}% similarity`,
      evidence
    };
  }
  
  // Medium confidence - might be related entities
  if (overlap >= 60 && jaccard >= 50) {
    return {
      isMatch: false, // Don't auto-match, but flag for review
      confidence: Math.round(jaccard),
      matchType: 'token',
      reasoning: `Partial match: ${overlap.toFixed(0)}% overlap. Possibly related entities (parent/subsidiary?). Needs verification.`,
      evidence
    };
  }
  
  // Low overlap = different entities
  return {
    isMatch: false,
    confidence: Math.round(jaccard),
    matchType: 'token',
    reasoning: `Different entities: ${overlap.toFixed(0)}% overlap, ${jaccard.toFixed(0)}% similarity.`,
    evidence
  };
}

/**
 * Compares two addresses
 * 
 * @param a - First address
 * @param b - Second address
 * @returns Match result with confidence and reasoning
 */
export function compareAddresses(a: Address, b: Address): MatchResult {
  const canonA = canonicalizeAddress(a);
  const canonB = canonicalizeAddress(b);
  
  const evidence: { source: string; value: string }[] = [
    { source: 'canonical_a', value: canonA.canonical },
    { source: 'canonical_b', value: canonB.canonical }
  ];
  
  // Postal code match is strong signal
  const cpMatch = a.cp && b.cp && a.cp.replace(/\D/g, '') === b.cp.replace(/\D/g, '');
  
  // Token comparison
  const overlap = tokenOverlap(canonA.tokens, canonB.tokens);
  const jaccard = jaccardSimilarity(canonA.tokens, canonB.tokens);
  
  // Same postal code + high token overlap = match
  if (cpMatch && overlap >= 70) {
    return {
      isMatch: true,
      confidence: Math.min(98, Math.round(jaccard) + 10), // Bonus for CP match
      matchType: 'normalized',
      reasoning: `Address match: Same postal code (${a.cp}) + ${overlap.toFixed(0)}% token overlap`,
      evidence
    };
  }
  
  // High token overlap without CP = possible match
  if (overlap >= 85 && jaccard >= 75) {
    return {
      isMatch: true,
      confidence: Math.round(jaccard),
      matchType: 'token',
      reasoning: `Address token match: ${overlap.toFixed(0)}% overlap`,
      evidence
    };
  }
  
  // Different addresses
  return {
    isMatch: false,
    confidence: Math.round(jaccard),
    matchType: 'token',
    reasoning: `Different addresses: ${overlap.toFixed(0)}% overlap. ${cpMatch ? 'Same postal code.' : 'Different postal codes.'}`,
    evidence
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  // Canonicalization
  canonicalizeName,
  canonicalizeEntity,
  canonicalizeAddress,
  
  // Comparison
  compareNames,
  compareEntities,
  compareAddresses,
  
  // Utilities
  removeDiacritics,
  normalizeWhitespace,
  tokenize,
};

