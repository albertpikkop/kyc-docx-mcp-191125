/**
 * KYC Profile Builder
 * 
 * Aggregates data from multiple document sources into a unified KYC profile.
 * 
 * Key rule: Acta domicilio is the original registered address at constitution.
 * It is treated as historical only and never overrides current fiscal/operational addresses.
 * 
 * Address Precedence:
 * - Current Fiscal: SAT Constancia (Canonical)
 * - Current Operational: Bank Statement > Proof of Address (CFE/Telmex) > SAT (fallback if no operational docs)
 * - Historical: All extracted addresses are preserved in historical_addresses
 */

import { differenceInDays } from 'date-fns';
import { DEMO_CONFIG } from '../core/demoConfig.js';
import type {
  KycProfile,
  CompanyIdentity,
  CompanyTaxProfile,
  ProofOfAddress,
  BankAccountProfile,
  HistoricalAddress,
  ImmigrationProfile,
  PassportIdentity,
  Address,
  BankIdentity
} from './types.js';

/**
 * Builds a KYC profile from extracted document data
 */
export class KycProfileBuilder {
  private profile: Partial<KycProfile>;
  private customerId: string;

  constructor(customerId: string) {
    this.customerId = customerId;
    this.profile = {
      customerId,
      addressEvidence: [],
      bankAccounts: [],
      historical_addresses: [],
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  /**
   * Adds company identity from Acta Constitutiva
   * The founding_address is stored as a historical address only.
   */
  addCompanyIdentity(identity: CompanyIdentity): void {
    this.profile.companyIdentity = identity;
    this.profile.foundingAddress = identity.founding_address;

    // Acta domicilio is the original registered address at constitution.
    // It is treated as historical only and never overrides current fiscal/operational addresses.
    if (identity.founding_address) {
      const historicalAddress: HistoricalAddress = {
        source: 'acta',
        address: identity.founding_address,
        date: identity.incorporation_date,
      };
      this.profile.historical_addresses?.push(historicalAddress);
    }
    this.updateTimestamp();
  }

  /**
   * Adds company tax profile from SAT Constancia
   * The fiscal_address becomes the canonical current_fiscal_address.
   */
  addCompanyTaxProfile(taxProfile: CompanyTaxProfile): void {
    this.profile.companyTaxProfile = taxProfile;

    // SAT Constancia fiscal_address is the current fiscal address
    if (taxProfile.fiscal_address) {
      this.profile.currentFiscalAddress = taxProfile.fiscal_address;

      // Also add as historical for tracking
      const historicalAddress: HistoricalAddress = {
        source: 'sat',
        address: taxProfile.fiscal_address,
        date: taxProfile.issue.issue_date,
      };
      this.profile.historical_addresses?.push(historicalAddress);
    }
    this.updateTimestamp();
  }

  /**
   * Adds proof of address document (utility bill, CFE, Telmex)
   * Contributes to operational address resolution.
   */
  addProofOfAddress(proof: ProofOfAddress): void {
    // In Demo Mode, we limit the number of proof of address documents
    if (DEMO_CONFIG.enabled) {
      const maxDocs = DEMO_CONFIG.maxProofOfAddressDocs;
      if ((this.profile.addressEvidence?.length || 0) >= maxDocs) {
        // If we already have the max number of documents, we only replace if the new one is more recent
        const existingDocs = this.profile.addressEvidence || [];
        
        // Find the oldest existing doc to potentially replace (simplified strategy: just compare with the first one for 1-doc limit)
        if (maxDocs === 1 && existingDocs.length > 0) {
           const existing = existingDocs[0];
           const existingDateStr = existing.issue_datetime || existing.due_date || "1970-01-01";
           const newDateStr = proof.issue_datetime || proof.due_date || "1970-01-01";
           
           // If new doc is newer, replace
           if (new Date(newDateStr).getTime() > new Date(existingDateStr).getTime()) {
             this.profile.addressEvidence = [proof];
           } else {
             // Keep existing
             return;
           }
        } else {
          // For >1 doc limit, we would need sorting logic, but for this demo requirement (1 doc), the above suffices or we simply ignore extra docs if we want strictly "1st one wins" or "latest wins".
          // The requirement says "prefer latest by document_date".
          // So let's just add it to a temp list and sort later? 
          // Actually, simpler to just allow adding and then truncate/sort in build() if we want to be robust.
          // BUT, if we want to strictly follow "Only aggregate... up to maxProofOfAddressDocs", we should handle it carefully.
          // Let's just allow adding all for now and filter in build() to be safe and simple.
          this.profile.addressEvidence?.push(proof);
        }
      } else {
        this.profile.addressEvidence?.push(proof);
      }
    } else {
      this.profile.addressEvidence?.push(proof);
    }

    if (proof.client_address) {
      // Add to historical tracking
      const historicalAddress: HistoricalAddress = {
        source: 'proof_of_address',
        address: proof.client_address,
        date: (proof.issue_datetime ||
          proof.due_date ||
          proof.billing_period_end ||
          proof.billing_period_start) || undefined,
      };
      this.profile.historical_addresses?.push(historicalAddress);
      
      // Address resolution logic is handled in build() or updateOperationalAddress()
    }
    this.updateTimestamp();
  }

  /**
   * Adds bank account profile
   * Bank statements are high-confidence operational address sources.
   */
  addBankAccount(bankAccount: BankAccountProfile): void {
    if (DEMO_CONFIG.enabled && DEMO_CONFIG.useBankIdentityOnly) {
       // Ignore transaction-heavy bank accounts in demo mode for the profile list
       // We will process "Bank Identity" separately or extract it from here if needed.
       // Actually, `buildKycProfile` function receives `bankAccounts`. 
       // If we are in demo mode, we shouldn't populate `this.profile.bankAccounts` with full transaction data?
       // The requirement says: "Ignore any bank_statement docs completely (do not populate transactions at all)."
       // AND "Ensure KycProfile includes: bankIdentity...".
       // So we will extract identity info from this profile and set `bankIdentity` but NOT push to `bankAccounts` array if we want to suppress "6 accounts" etc.
       
       // Create BankIdentity from the profile
       const bankIdentity: BankIdentity = {
         bank_name: bankAccount.bank_name || "Unknown Bank",
         account_holder_name: bankAccount.account_holder_name || "Unknown",
         clabe: bankAccount.clabe,
         clabe_last4: bankAccount.clabe ? bankAccount.clabe.slice(-4) : null,
         address_on_file: bankAccount.address_on_statement || null,
         document_date: bankAccount.statement_period_end || null
       };

       // Only keep one (the latest?)
       // If we already have one, compare dates
       if (this.profile.bankIdentity) {
          const existingDate = this.profile.bankIdentity.document_date || "1970-01-01";
          const newDate = bankIdentity.document_date || "1970-01-01";
          if (new Date(newDate).getTime() > new Date(existingDate).getTime()) {
             // Set this one as the bank identity
             this.updateBankIdentityMetrics(bankIdentity);
          }
       } else {
          this.updateBankIdentityMetrics(bankIdentity);
       }
       
       // DO NOT add to this.profile.bankAccounts array in demo mode
       return; 
    }

    this.profile.bankAccounts?.push(bankAccount);

    if (bankAccount.address_on_statement) {
       const historicalAddress: HistoricalAddress = {
        source: 'other', // Using 'other' for bank or we could add 'bank' to types
        address: bankAccount.address_on_statement,
        date: bankAccount.statement_period_end || undefined,
      };
      this.profile.historical_addresses?.push(historicalAddress);
    }
    this.updateTimestamp();
  }
  
  private updateBankIdentityMetrics(identity: BankIdentity) {
      const asOf = new Date();
      const docDate = identity.document_date ? new Date(identity.document_date) : new Date();
      const ageInDays = differenceInDays(asOf, docDate);
      
      // Fuzzy match holder
      const companyName = (this.profile.companyIdentity?.razon_social || this.profile.companyTaxProfile?.razon_social || "").toLowerCase();
      const holderName = (identity.account_holder_name || "").toLowerCase();
      
      // 1. Exact inclusion (original logic)
      let holderMatches = companyName.includes(holderName) || holderName.includes(companyName);
      
      // 2. Enhanced token matching (handles "Pounj Group" vs "Grupo Pounj")
      if (!holderMatches) {
          // Remove common legal entity suffixes and noise
          const clean = (s: string) => s.replace(/[.,]/g, '')
              .replace(/\b(sociedad|anonima|capital|variable|sa|cv|sapi|de|rl|limited|ltd|inc|corp)\b/g, '')
              .trim();
          
          const companyClean = clean(companyName);
          const holderClean = clean(holderName);
          
          // Split into tokens
          const cTokens = companyClean.split(/\s+/).filter(w => w.length > 1);
          const hTokens = holderClean.split(/\s+/).filter(w => w.length > 1);
          
          // Count matches (naive intersection)
          let matches = 0;
          for (const ht of hTokens) {
              // Direct match or translation match (Group <-> Grupo)
              if (cTokens.includes(ht) || 
                 (ht === 'group' && cTokens.includes('grupo')) ||
                 (ht === 'grupo' && cTokens.includes('group'))) {
                  matches++;
              }
          }
          
          // If all significant holder tokens found in company (or significant overlap)
          if (hTokens.length > 0 && matches >= hTokens.length * 0.8) { // Allow slight mismatch if long
             holderMatches = true;
          } else if (hTokens.length === 2 && matches >= 1) {
             // Special case: "Pounj Group" (2 tokens) vs "Grupo Pounj" (2 tokens)
             // If "Pounj" matches, and the other is Group/Grupo, we handled it above.
             // If just 1 matches (Pounj), is it enough? Maybe too risky for generic names.
             // But we added specific translation logic for Group/Grupo so it should match 2/2.
             if (matches === 2) holderMatches = true;
          }
          
          // Fallback: Check if unique identifier (Pounj) is present
          // Assuming "Pounj" is the distinct part
          if (!holderMatches && companyClean.includes(holderClean) || holderClean.includes(companyClean)) {
              holderMatches = true;
          }
      }
      
      // Fuzzy match address (CP match is robust enough for demo)
      const opAddress = this.profile.currentOperationalAddress || this.profile.currentFiscalAddress;
      const addressMatches = opAddress?.cp === identity.address_on_file?.cp;

      this.profile.bankIdentity = {
          ...identity,
          age_in_days: ageInDays,
          within_90_days: ageInDays <= 90,
          holder_matches_company: !!holderMatches,
          address_matches_operational: !!addressMatches
      };
  }

  /**
   * Adds representative identity (Immigration/FM2/INE)
   * This is the Mexican immigration document that proves legal right to work
   */
  addRepresentativeIdentity(identity: ImmigrationProfile): void {
    // In demo mode, we only want one. If we already have one, maybe keep the first or overwrite?
    // Requirement: "1 rep identity: prefer fm2, else ine, else passport"
    if (this.profile.representativeIdentity && DEMO_CONFIG.enabled) {
       return;
    }
    
    this.profile.representativeIdentity = identity;
    this.updateTimestamp();
  }

  /**
   * Adds passport identity (for foreign nationals)
   * This is the primary identity document from the person's country of origin
   */
  addPassportIdentity(passport: PassportIdentity): void {
    this.profile.passportIdentity = passport;
    this.updateTimestamp();
  }

  private updateTimestamp() {
    this.profile.lastUpdatedAt = new Date().toISOString();
  }

  /**
   * Resolves the current operational address based on precedence rules and recency.
   * Priority: Bank Statement > CFE/Telmex > SAT (fallback)
   * Within categories, picks the most recent document.
   */
  private resolveOperationalAddress(): void {
    // Collect all candidates with dates
    const candidates: Array<{
      source: 'bank' | 'proof' | 'sat';
      date: string;
      address: Address;
    }> = [];

    // 1. Bank Statements (Full Mode) OR Bank Identity (Demo Mode)
    if (DEMO_CONFIG.enabled && this.profile.bankIdentity && this.profile.bankIdentity.address_on_file && this.profile.bankIdentity.document_date) {
       candidates.push({
           source: 'bank',
           date: this.profile.bankIdentity.document_date,
           address: this.profile.bankIdentity.address_on_file
       });
    } else if (this.profile.bankAccounts) {
      for (const acc of this.profile.bankAccounts) {
        if (acc.address_on_statement && acc.statement_period_end) {
          candidates.push({
            source: 'bank',
            date: acc.statement_period_end,
            address: acc.address_on_statement
          });
        }
      }
    }

    // 2. Proof of Address (CFE/Telmex)
    if (this.profile.addressEvidence) {
      for (const proof of this.profile.addressEvidence) {
        const date =
          proof.issue_datetime ||
          proof.due_date ||
          proof.billing_period_end ||
          proof.billing_period_start;
        if (proof.client_address && date) {
          candidates.push({
            source: 'proof',
            date: date,
            address: proof.client_address
          });
        }
      }
    }

    // Sort by date descending (newest first)
    candidates.sort((a, b) => {
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });

    if (candidates.length > 0) {
      this.profile.currentOperationalAddress = candidates[0].address;
      
      // If we just resolved op address, and we are in demo mode, we might want to re-evaluate bank identity address match
      if (DEMO_CONFIG.enabled && this.profile.bankIdentity) {
         // Re-run match logic now that we have definitive operational address
         const addressMatches = this.profile.currentOperationalAddress?.cp === this.profile.bankIdentity.address_on_file?.cp;
         this.profile.bankIdentity.address_matches_operational = addressMatches;
      }
      return;
    }

    // 3. Fallback to SAT Fiscal Address if no operational docs
    if (this.profile.currentFiscalAddress) {
      this.profile.currentOperationalAddress = this.profile.currentFiscalAddress;
    }
  }

  /**
   * Builds and returns the final KYC profile
   */
  build(): KycProfile {
    // Filter PoA docs for Demo Mode at build time to be safe
    if (DEMO_CONFIG.enabled && this.profile.addressEvidence && this.profile.addressEvidence.length > DEMO_CONFIG.maxProofOfAddressDocs) {
       // Sort by date desc
       this.profile.addressEvidence.sort((a, b) => {
           const dateA = a.issue_datetime || a.due_date || "1970";
           const dateB = b.issue_datetime || b.due_date || "1970";
           return new Date(dateB).getTime() - new Date(dateA).getTime();
       });
       // Keep top N
       this.profile.addressEvidence = this.profile.addressEvidence.slice(0, DEMO_CONFIG.maxProofOfAddressDocs);
    }

    this.resolveOperationalAddress();
    
    // Ensure strict rules
    // 1. Fiscal address ALWAYS from SAT if available
    if (this.profile.companyTaxProfile?.fiscal_address) {
        this.profile.currentFiscalAddress = this.profile.companyTaxProfile.fiscal_address;
    }

    // 2. RFC Consistency - SAT overrides everything (validated at schema level but good to keep in mind)
    
    return this.profile as KycProfile;
  }

  /**
   * Resets the builder to start fresh
   */
  reset(newCustomerId?: string): void {
    if (newCustomerId) {
      this.customerId = newCustomerId;
    }
    this.profile = {
      customerId: this.customerId,
      addressEvidence: [],
      bankAccounts: [],
      historical_addresses: [],
      lastUpdatedAt: new Date().toISOString(),
    };
  }
}

/**
 * Convenience function to build a KYC profile from multiple sources
 */
export function buildKycProfile(options: {
  customerId: string;
  companyIdentity?: CompanyIdentity;
  companyTaxProfile?: CompanyTaxProfile;
  proofsOfAddress?: ProofOfAddress[];
  bankAccounts?: BankAccountProfile[];
  representativeIdentity?: ImmigrationProfile;
  passportIdentity?: PassportIdentity;
}): KycProfile {
  const builder = new KycProfileBuilder(options.customerId);

  if (options.companyIdentity) {
    builder.addCompanyIdentity(options.companyIdentity);
  }

  if (options.companyTaxProfile) {
    builder.addCompanyTaxProfile(options.companyTaxProfile);
  }

  if (options.proofsOfAddress) {
    for (const proof of options.proofsOfAddress) {
      builder.addProofOfAddress(proof);
    }
  }

  if (options.bankAccounts) {
    for (const account of options.bankAccounts) {
      builder.addBankAccount(account);
    }
  }

  if (options.representativeIdentity) {
    builder.addRepresentativeIdentity(options.representativeIdentity);
  }

  if (options.passportIdentity) {
    builder.addPassportIdentity(options.passportIdentity);
  }

  return builder.build();
}
