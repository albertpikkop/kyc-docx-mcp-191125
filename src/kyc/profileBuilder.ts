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
  ImmigrationProfile,
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
    this.profile.addressEvidence?.push(proof);

    if (proof.client_address) {
      // Add to historical tracking
      const historicalAddress: HistoricalAddress = {
        source: 'proof_of_address',
        address: proof.client_address,
        date: proof.date,
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

  /**
   * Adds representative identity (Immigration/FM2)
   */
  addRepresentativeIdentity(identity: ImmigrationProfile): void {
    this.profile.representativeIdentity = identity;
    this.updateTimestamp();
  }

  private updateTimestamp() {
    this.profile.lastUpdatedAt = new Date().toISOString();
  }

  /**
   * Resolves the current operational address based on precedence rules.
   * Priority: Bank Statement > CFE/Telmex > SAT (fallback)
   */
  private resolveOperationalAddress(): void {
    // 1. Try Bank Statements (most recent if possible, but for now any)
    const bankAccount = this.profile.bankAccounts?.find(acc => acc.address_on_statement);
    if (bankAccount?.address_on_statement) {
      this.profile.currentOperationalAddress = bankAccount.address_on_statement;
      return;
    }

    // 2. Try Proof of Address (CFE/Telmex) - taking the last added (assuming order implies recency or logic outside)
    const proof = this.profile.addressEvidence?.find(p => p.client_address);
    if (proof?.client_address) {
      this.profile.currentOperationalAddress = proof.client_address;
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

  return builder.build();
}
