import { getAggregateCosts } from '../src/kyc/costTracker.js';

async function main() {
  console.log("--- KYC Cost Aggregation ---");
  const costs = await getAggregateCosts();
  
  console.log(`Total Runs Logged: ${costs.totalRuns}`);
  console.log(`Total Estimated Cost: $${costs.totalCost.toFixed(2)}`);
  console.log(`Average Cost Per Run: $${costs.avgCostPerRun.toFixed(2)}`);
  console.log("----------------------------");
}

main().catch(console.error);

