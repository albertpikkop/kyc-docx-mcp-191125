import "dotenv/config";
import { extractCompanyIdentity } from "../extractors/actaCompanyIdentity.js";

async function main() {
  console.log("=== TESTING COMISARIO & CAPITAL SOCIAL EXTRACTION ===\n");
  
  const actaPath = "/Users/ashishpunj/Desktop/mcp-docs/grupo-pounj/Acta_Constitutiva_grupo-pounj.pdf";
  
  console.log("Extracting from:", actaPath);
  console.log("This may take 30-60 seconds...\n");
  
  try {
    const result = await extractCompanyIdentity(actaPath);
    
    console.log("\n=== EXTRACTION RESULTS ===\n");
    
    console.log("COMPANY:", result.razon_social);
    console.log();
    
    console.log("COMISARIOS:");
    if (result.comisarios && result.comisarios.length > 0) {
      for (const c of result.comisarios) {
        console.log(`  ✅ ${c.name} - ${c.tipo} (appointed: ${c.appointment_date})`);
      }
    } else {
      console.log("  ❌ No comisarios extracted");
    }
    console.log();
    
    console.log("CAPITAL SOCIAL:");
    if (result.capital_social) {
      const cs = result.capital_social;
      console.log(`  ✅ Total: ${cs.total_amount} ${cs.currency}`);
      console.log(`     Fixed: ${cs.fixed_capital}, Variable: ${cs.variable_capital}`);
      console.log(`     Shares: ${cs.total_shares} @ ${cs.share_par_value} each`);
    } else {
      console.log("  ❌ No capital social extracted");
    }
    console.log();
    
    console.log("LEGAL REPRESENTATIVES:");
    for (const lr of result.legal_representatives || []) {
      console.log(`  • ${lr.name} - ${lr.role}`);
      console.log(`    Powers: ${(lr.poder_scope || []).length} facultades`);
    }
    
  } catch (e) {
    console.error("Extraction failed:", e);
  }
}

main().catch(console.error);
