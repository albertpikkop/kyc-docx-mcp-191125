export interface DemoConfig {
  enabled: boolean;
  maxProofOfAddressDocs: number;
  useBankIdentityOnly: boolean;
}

export const DEMO_CONFIG: DemoConfig = {
  enabled: true,
  maxProofOfAddressDocs: 1,
  useBankIdentityOnly: true,
};

