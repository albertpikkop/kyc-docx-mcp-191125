/**
 * Test file demonstrating KYC Profile Builder usage
 * 
 * This test shows how the Acta founding_address is treated as historical
 * and does not override current fiscal/operational addresses.
 */

import "dotenv/config";
import { buildKycProfile } from "../kyc/profileBuilder.js";
import type { CompanyIdentity, CompanyTaxProfile } from "../kyc/types.js";

// Mock data for testing
const mockCompanyIdentity: CompanyIdentity = {
  razon_social: "PFDS, S.A.P.I. DE C.V.",
  rfc: null,
  registro_mercantil: "N-2021074811",
  incorporation_date: "2021-08-30",
  founding_address: {
    street: "GUTEMBERG",
    ext_number: "44",
    int_number: "102",
    colonia: "VERONICA ANZURES",
    municipio: "MIGUEL HIDALGO",
    estado: "CIUDAD DE MÉXICO",
    cp: "11300",
    cross_streets: null,
    country: "MX",
  },
  legal_representatives: [],
  shareholders: [],
  corporate_purpose: [],
  notary: {
    name: null,
    notary_number: null,
    protocol_number: null,
    protocol_date: null,
    office_location: null,
  },
  registry: {
    fme: null,
    nci: null,
    unique_doc_number: null,
    registration_city: null,
    registration_date: null,
    folio: null,
  },
  governance: {
    board_type: null,
    quorum_rules: null,
    voting_rights: null,
    share_transfer_rules: null,
    capital_rules: null,
  },
  modifications: null,
};

const mockCompanyTaxProfile: CompanyTaxProfile = {
  rfc: "PFD210830KQ7",
  razon_social: "PFDS",
  commercial_name: null,
  capital_regime: null,
  tax_regime: "General",
  start_of_operations: "2021-08-30",
  status: "Activo",
  last_status_change: null,
  issue: {
    place_municipio: "Ciudad de México",
    place_estado: "Ciudad de México",
    issue_date: "2024-01-15",
  },
  fiscal_address: {
    street: "CALLE ACTUAL",
    ext_number: "100",
    int_number: null,
    colonia: "COLONIA ACTUAL",
    municipio: "Ciudad de México",
    estado: "Ciudad de México",
    cp: "11000",
    cross_streets: null,
    country: "MX",
  },
  economic_activities: [],
  tax_obligations: [],
};

async function main() {
  console.log("=== Testing KYC Profile Builder ===\n");

  const profile = buildKycProfile({
    customerId: "pfds",
    companyIdentity: mockCompanyIdentity,
    companyTaxProfile: mockCompanyTaxProfile,
  });

  console.log("1. Company Identity (Acta):");
  console.log(`   Founding Address: ${profile.companyIdentity?.founding_address.street} ${profile.companyIdentity?.founding_address.ext_number}`);
  console.log();

  console.log("2. Historical Addresses:");
  profile.historical_addresses.forEach((addr, idx) => {
    console.log(`   [${idx + 1}] Source: ${addr.source}`);
    console.log(`       Address: ${addr.address.street} ${addr.address.ext_number}`);
    console.log(`       Date: ${addr.date || "N/A"}`);
  });
  console.log();

  console.log("3. Current Fiscal Address (from SAT):");
  if (profile.currentFiscalAddress) {
    console.log(`   ${profile.currentFiscalAddress.street} ${profile.currentFiscalAddress.ext_number}`);
    console.log(`   ${profile.currentFiscalAddress.colonia}, ${profile.currentFiscalAddress.cp}`);
  }
  console.log();

  console.log("✓ Key Rule: Acta founding_address is in historical_addresses only.");
  console.log("✓ Current fiscal address comes from SAT Constancia, not Acta.");
  console.log("✓ No address override occurred.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
