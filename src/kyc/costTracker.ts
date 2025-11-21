import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Cost constants for GPT-5.1 (Estimates based on current tier)
const COST_PER_1M_INPUT_TOKENS = 2.50;
const COST_PER_1M_OUTPUT_TOKENS = 10.00;

// Interface for usage data (usually returned by OpenAI API, but we need to ensure we capture it)
export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface CostRecord {
  runId: string;
  customerId: string;
  timestamp: string;
  model: string;
  usage: TokenUsage;
  estimatedCost: number;
  documentCount: number;
  reportType: 'kyc_full' | 'demo' | 'custom';
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const COST_LOG_PATH = path.resolve(__dirname, '../../data/cost_log.json');

/**
 * Calculates the cost of a run based on token usage.
 */
export function calculateRunCost(usage: TokenUsage): number {
  const inputCost = (usage.prompt_tokens / 1_000_000) * COST_PER_1M_INPUT_TOKENS;
  const outputCost = (usage.completion_tokens / 1_000_000) * COST_PER_1M_OUTPUT_TOKENS;
  return parseFloat((inputCost + outputCost).toFixed(4));
}

/**
 * Logs the cost of a run to a central JSON file.
 */
export async function logRunCost(record: CostRecord): Promise<void> {
  try {
    let logs: CostRecord[] = [];
    try {
      const data = await fs.readFile(COST_LOG_PATH, 'utf-8');
      logs = JSON.parse(data);
    } catch (error) {
      // File might not exist yet
    }

    logs.push(record);
    await fs.writeFile(COST_LOG_PATH, JSON.stringify(logs, null, 2), 'utf-8');
    console.log(`💰 Cost Logged: $${record.estimatedCost} for Run ${record.runId}`);
  } catch (error) {
    console.error('Failed to log run cost:', error);
  }
}

/**
 * Aggregates costs from the log file.
 */
export async function getAggregateCosts(): Promise<{ totalCost: number; totalRuns: number; avgCostPerRun: number }> {
  try {
    const data = await fs.readFile(COST_LOG_PATH, 'utf-8');
    const logs: CostRecord[] = JSON.parse(data);
    
    const totalCost = logs.reduce((sum, record) => sum + record.estimatedCost, 0);
    const totalRuns = logs.length;
    const avgCostPerRun = totalRuns > 0 ? totalCost / totalRuns : 0;

    return {
      totalCost: parseFloat(totalCost.toFixed(4)),
      totalRuns,
      avgCostPerRun: parseFloat(avgCostPerRun.toFixed(4))
    };
  } catch (error) {
    return { totalCost: 0, totalRuns: 0, avgCostPerRun: 0 };
  }
}

