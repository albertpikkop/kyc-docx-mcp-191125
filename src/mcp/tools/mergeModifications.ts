/**
 * MCP Tool: merge_modifications
 * 
 * PURPOSE: Merge multiple Acta extractions (original + modifications) into current state.
 * LOGIC: ALL merge logic is CODE, not prompts. Claude cannot influence.
 * 
 * Claude's job: Call this tool with extracted actas, receive merged profile.
 * This tool's job: Deterministically merge, track changes, return current state.
 */

import { CompanyIdentity, KycProfile } from '../../kyc/types.js';

export interface ActaExtraction {
  source_file: string;
  extracted_data: any;
  is_original: boolean; // true for Acta Constitutiva, false for modifications
  extraction_date?: string;
}

export interface ShareholderChange {
  shareholder_name: string;
  action: 'ADDED' | 'REMOVED' | 'SHARES_CHANGED';
  old_shares?: number | null;
  new_shares?: number | null;
  old_percentage?: number | null;
  new_percentage?: number | null;
  source_document: string;
}

export interface LegalRepChange {
  name: string;
  action: 'ADDED' | 'REMOVED' | 'POWERS_CHANGED';
  old_powers?: string[];
  new_powers?: string[];
  source_document: string;
}

export interface MergeResult {
  merged_company_identity: CompanyIdentity;
  shareholder_history: ShareholderChange[];
  legal_rep_history: LegalRepChange[];
  comisario_current: any | null;
  comisario_history: any[];
  documents_merged: number;
  merge_timestamp: string;
  warnings: string[];
}

/**
 * MERGE RULES - ALL LOGIC IN CODE
 */

/**
 * Normalize name for comparison
 */
function normalizeName(name: string): string {
  return name.toUpperCase().trim()
    .replace(/\s+/g, ' ')
    .replace(/[.,]/g, '');
}

/**
 * Check if two names match
 */
function namesMatch(name1: string, name2: string): boolean {
  const n1 = normalizeName(name1);
  const n2 = normalizeName(name2);
  
  if (n1 === n2) return true;
  
  // Check if one contains the other (for variations)
  const words1 = n1.split(' ').filter(w => w.length > 2);
  const words2 = n2.split(' ').filter(w => w.length > 2);
  
  const matchingWords = words1.filter(w1 => words2.some(w2 => w1 === w2));
  return matchingWords.length >= Math.min(words1.length, words2.length) * 0.7;
}

/**
 * MAIN TOOL FUNCTION
 * 
 * Input: Array of ActaExtraction (original + modifications in chronological order)
 * Output: MergeResult with current state and change history
 * 
 * Claude CANNOT modify merge logic. Claude only presents results.
 */
export async function mergeModifications(actas: ActaExtraction[]): Promise<MergeResult> {
  console.log(`[merge_modifications] Merging ${actas.length} documents`);
  
  const warnings: string[] = [];
  const shareholderHistory: ShareholderChange[] = [];
  const legalRepHistory: LegalRepChange[] = [];
  const comisarioHistory: any[] = [];
  
  // Sort by original first, then by date
  const sorted = [...actas].sort((a, b) => {
    if (a.is_original && !b.is_original) return -1;
    if (!a.is_original && b.is_original) return 1;
    return 0;
  });
  
  // Start with original Acta
  const original = sorted.find(a => a.is_original);
  if (!original) {
    warnings.push('No original Acta Constitutiva found - using first document as base');
  }
  
  const base = original?.extracted_data || sorted[0]?.extracted_data || {};
  
  // Initialize merged state from original
  let currentShareholders = [...(base.shareholders || [])];
  let currentLegalReps = [...(base.legal_representatives || [])];
  let currentComisario = (base.comisarios || [])[0] || null;
  
  // Process each modification
  for (const acta of sorted) {
    if (acta.is_original) continue; // Skip original, already used as base
    
    const mod = acta.extracted_data;
    const sourceName = acta.source_file;
    
    // ═══════════════════════════════════════════════════════════════
    // MERGE SHAREHOLDERS
    // ═══════════════════════════════════════════════════════════════
    
    if (mod.shareholders && mod.shareholders.length > 0) {
      const newShareholders = mod.shareholders;
      
      // Detect changes
      for (const newSh of newShareholders) {
        const existing = currentShareholders.find(s => namesMatch(s.name, newSh.name));
        
        if (!existing) {
          // New shareholder added
          shareholderHistory.push({
            shareholder_name: newSh.name,
            action: 'ADDED',
            new_shares: newSh.shares,
            new_percentage: newSh.percentage,
            source_document: sourceName
          });
          currentShareholders.push(newSh);
        } else if (existing.shares !== newSh.shares || existing.percentage !== newSh.percentage) {
          // Shares changed
          shareholderHistory.push({
            shareholder_name: newSh.name,
            action: 'SHARES_CHANGED',
            old_shares: existing.shares,
            new_shares: newSh.shares,
            old_percentage: existing.percentage,
            new_percentage: newSh.percentage,
            source_document: sourceName
          });
          // Update current
          const idx = currentShareholders.indexOf(existing);
          currentShareholders[idx] = { ...existing, ...newSh };
        }
      }
      
      // Check for removed shareholders (in current but not in new)
      const newNames = newShareholders.map((s: any) => normalizeName(s.name));
      for (const current of currentShareholders) {
        if (!newNames.some((n: string) => namesMatch(current.name, n))) {
          // Shareholder may have been removed or sold all shares
          if (current.shares && current.shares > 0) {
            shareholderHistory.push({
              shareholder_name: current.name,
              action: 'REMOVED',
              old_shares: current.shares,
              old_percentage: current.percentage,
              source_document: sourceName
            });
            current.shares = 0;
            current.percentage = 0;
          }
        }
      }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // MERGE LEGAL REPRESENTATIVES
    // ═══════════════════════════════════════════════════════════════
    
    if (mod.legal_representatives && mod.legal_representatives.length > 0) {
      for (const newRep of mod.legal_representatives) {
        const existing = currentLegalReps.find(r => namesMatch(r.name, newRep.name));
        
        if (!existing) {
          // New legal rep added
          legalRepHistory.push({
            name: newRep.name,
            action: 'ADDED',
            new_powers: newRep.poder_scope || [],
            source_document: sourceName
          });
          currentLegalReps.push(newRep);
        } else {
          // Check if powers changed
          const oldPowers = existing.poder_scope || [];
          const newPowers = newRep.poder_scope || [];
          
          if (JSON.stringify(oldPowers.sort()) !== JSON.stringify(newPowers.sort())) {
            legalRepHistory.push({
              name: newRep.name,
              action: 'POWERS_CHANGED',
              old_powers: oldPowers,
              new_powers: newPowers,
              source_document: sourceName
            });
            // Update current
            const idx = currentLegalReps.indexOf(existing);
            currentLegalReps[idx] = { ...existing, ...newRep };
          }
        }
      }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // MERGE COMISARIOS
    // ═══════════════════════════════════════════════════════════════
    
    if (mod.comisarios && mod.comisarios.length > 0) {
      const newComisario = mod.comisarios.find((c: any) => c.tipo === 'PROPIETARIO') || mod.comisarios[0];
      
      if (currentComisario && !namesMatch(currentComisario.name, newComisario.name)) {
        // Comisario changed
        comisarioHistory.push({
          action: 'REPLACED',
          old_comisario: currentComisario,
          new_comisario: newComisario,
          source_document: sourceName
        });
        currentComisario = newComisario;
      } else if (!currentComisario) {
        currentComisario = newComisario;
      }
    }
  }
  
  // Build merged company identity
  const mergedIdentity: CompanyIdentity = {
    ...base,
    shareholders: currentShareholders.filter(s => s.shares && s.shares > 0),
    legal_representatives: currentLegalReps,
    // Include comisario in modifications note if changed
    modifications: [
      ...(base.modifications || []),
      ...shareholderHistory.map(h => `${h.action}: ${h.shareholder_name}`),
      ...legalRepHistory.map(h => `${h.action}: ${h.name}`),
    ]
  };
  
  // Recalculate percentages
  const totalShares = mergedIdentity.shareholders.reduce((sum, s) => sum + (s.shares || 0), 0);
  if (totalShares > 0) {
    mergedIdentity.shareholders = mergedIdentity.shareholders.map(s => ({
      ...s,
      percentage: Math.round(((s.shares || 0) / totalShares) * 10000) / 100
    }));
  }
  
  return {
    merged_company_identity: mergedIdentity,
    shareholder_history: shareholderHistory,
    legal_rep_history: legalRepHistory,
    comisario_current: currentComisario,
    comisario_history: comisarioHistory,
    documents_merged: sorted.length,
    merge_timestamp: new Date().toISOString(),
    warnings
  };
}

export const MERGE_MODIFICATIONS_TOOL = {
  name: 'merge_modifications',
  description: `Merge multiple Acta extractions (original + modifications) into current state.
ALL merge logic is deterministic code - Claude cannot influence it.
Returns:
- Current shareholders (after all transfers)
- All legal representatives (original + added)
- Shareholder change history
- Current Comisario
Claude should call this after extracting all Acta documents.`,
  inputSchema: {
    type: 'object',
    properties: {
      actas: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            source_file: { type: 'string' },
            extracted_data: { type: 'object' },
            is_original: { type: 'boolean' }
          }
        },
        description: 'Array of extracted Acta data in chronological order'
      }
    },
    required: ['actas']
  }
};

