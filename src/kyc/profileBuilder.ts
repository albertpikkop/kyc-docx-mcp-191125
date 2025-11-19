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

import type {
  KycProfile,
  CompanyIdentity,
  CompanyTaxProfile,
  ProofOfAddress,
  BankAccountProfile,
  HistoricalAddress,
  Address,
} from './types.js';

/**
 * Builds a KYC profile from extracted document data
 */
export class KycProfileBuilder {
  private profile: KycProfile;

  constructor() {
    this.profile = {
      proofs_of_address: [],
      bank_accounts: [],
      historical_addresses: [],
    };
  }

  /**
   * Adds company identity from Acta Constitutiva
   * The founding_address is stored as a historical address only.
   */
  addCompanyIdentity(identity: CompanyIdentity): void {
    this.profile.company_identity = identity;

    // Acta domicilio is the original registered address at constitution.
    // It is treated as historical only and never overrides current fiscal/operational addresses.
    if (identity.founding_address) {
      const historicalAddress: HistoricalAddress = {
        source: 'acta',
        address: identity.founding_address,
        date: identity.incorporation_date,
      };
      this.profile.historical_addresses.push(historicalAddress);
    }
  }

  /**
   * Adds company tax profile from SAT Constancia
   * The fiscal_address becomes the canonical current_fiscal_address.
   */
  addCompanyTaxProfile(taxProfile: CompanyTaxProfile): void {
    this.profile.company_tax_profile = taxProfile;

    // SAT Constancia fiscal_address is the current fiscal address
    if (taxProfile.fiscal_address) {
      this.profile.current_fiscal_address = taxProfile.fiscal_address;

      // Also add as historical for tracking
      const historicalAddress: HistoricalAddress = {
        source: 'sat',
        address: taxProfile.fiscal_address,
        date: taxProfile.issue.issue_date,
      };
      this.profile.historical_addresses.push(historicalAddress);
    }
  }

  /**
   * Adds proof of address document (utility bill, CFE, Telmex)
   * Contributes to operational address resolution.
   */
  addProofOfAddress(proof: ProofOfAddress): void {
    this.profile.proofs_of_address.push(proof);

    if (proof.client_address) {
      // Add to historical tracking
      const historicalAddress: HistoricalAddress = {
        source: 'proof_of_address',
        address: proof.client_address,
        date: proof.date,
      };
      this.profile.historical_addresses.push(historicalAddress);
      
      // Address resolution logic is handled in build() or updateOperationalAddress()
      // For now, we push to history and profile lists.
    }
  }

  /**
   * Adds bank account profile
   * Bank statements are high-confidence operational address sources.
   */
  addBankAccount(bankAccount: BankAccountProfile): void {
    this.profile.bank_accounts.push(bankAccount);

    if (bankAccount.address_on_statement) {
       const historicalAddress: HistoricalAddress = {
        source: 'other', // Using 'other' for bank or we could add 'bank' to types
        address: bankAccount.address_on_statement,
        date: bankAccount.statement_period_end || undefined,
      };
      this.profile.historical_addresses.push(historicalAddress);
    }
  }

  /**
   * Resolves the current operational address based on precedence rules.
   * Priority: Bank Statement > CFE/Telmex > SAT (fallback)
   */
  private resolveOperationalAddress(): void {
    // 1. Try Bank Statements (most recent if possible, but for now any)
    const bankAccount = this.profile.bank_accounts.find(acc => acc.address_on_statement);
    if (bankAccount?.address_on_statement) {
      this.profile.current_operational_address = bankAccount.address_on_statement;
      return;
    }

    // 2. Try Proof of Address (CFE/Telmex) - taking the last added (assuming order implies recency or logic outside)
    // Ideally sorting by date would happen here.
    const proof = this.profile.proofs_of_address.find(p => p.client_address);
    if (proof?.client_address) {
      this.profile.current_operational_address = proof.client_address;
      return;
    }

    // 3. Fallback to SAT Fiscal Address if no operational docs
    if (this.profile.current_fiscal_address) {
      this.profile.current_operational_address = this.profile.current_fiscal_address;
    }
  }

  /**
   * Builds and returns the final KYC profile
   */
  build(): KycProfile {
    this.resolveOperationalAddress();
    
    // Ensure strict rules
    // 1. Fiscal address ALWAYS from SAT if available
    if (this.profile.company_tax_profile?.fiscal_address) {
        this.profile.current_fiscal_address = this.profile.company_tax_profile.fiscal_address;
    }

    // 2. RFC Consistency - SAT overrides everything
    const satRfc = this.profile.company_tax_profile?.rfc;
    if (satRfc && this.profile.company_identity) {
        // We don't overwrite source document data (extractor output), but the profile view could have a canonical identity.
        // For this Builder, we return the profile as aggregation.
        // The extractors have already been hardened to not invent RFCs.
    }

    return { ...this.profile };
  }

  /**
   * Resets the builder to start fresh
   */
  reset(): void {
    this.profile = {
      proofs_of_address: [],
      bank_accounts: [],
      historical_addresses: [],
    };
  }
}

/**
 * Convenience function to build a KYC profile from multiple sources
 */
export function buildKycProfile(options: {
  companyIdentity?: CompanyIdentity;
  companyTaxProfile?: CompanyTaxProfile;
  proofsOfAddress?: ProofOfAddress[];
  bankAccounts?: BankAccountProfile[];
}): KycProfile {
  const builder = new KycProfileBuilder();

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

  return builder.build();
}
