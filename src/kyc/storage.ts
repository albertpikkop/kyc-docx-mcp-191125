import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { KycRun } from './types.js';

// Root directory for data, relative to this file
// src/kyc/storage.ts -> ../../data/
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_ROOT = path.resolve(__dirname, '../../data');

/**
 * Helper to get customer directory path
 */
function getCustomerDir(customerId: string): string {
  return path.join(DATA_ROOT, customerId);
}

/**
 * Helper to get run file path
 */
function getRunFilePath(customerId: string, runId: string): string {
  return path.join(getCustomerDir(customerId), `run-${runId}.json`);
}

/**
 * Saves a KYC run to disk.
 * Creates the customer directory if it doesn't exist.
 * Overwrites the file if it already exists for the same runId.
 */
export async function saveRun(run: KycRun): Promise<void> {
  try {
    if (!run.customerId || !run.runId) {
      throw new Error('Run must have customerId and runId');
    }

    const customerDir = getCustomerDir(run.customerId);
    
    // Ensure directory exists
    await fs.mkdir(customerDir, { recursive: true });

    const filePath = getRunFilePath(run.customerId, run.runId);
    const content = JSON.stringify(run, null, 2);

    await fs.writeFile(filePath, content, 'utf-8');
  } catch (error) {
    console.error(`Failed to save run ${run.runId} for customer ${run.customerId}:`, error);
    throw error;
  }
}

/**
 * Lists all KYC runs for a customer, sorted by createdAt ascending.
 * Returns empty array if no runs found or directory doesn't exist.
 */
export async function listRuns(customerId: string): Promise<KycRun[]> {
  try {
    const customerDir = getCustomerDir(customerId);
    
    // Check if directory exists
    try {
      await fs.access(customerDir);
    } catch {
      return [];
    }

    const files = await fs.readdir(customerDir);
    const runFiles = files.filter(f => f.startsWith('run-') && f.endsWith('.json'));

    const runs: KycRun[] = [];

    for (const file of runFiles) {
      try {
        const content = await fs.readFile(path.join(customerDir, file), 'utf-8');
        const run = JSON.parse(content) as KycRun;
        runs.push(run);
      } catch (err) {
        console.warn(`Failed to parse run file ${file}:`, err);
        // Continue with valid files
      }
    }

    // Sort by createdAt ascending
    return runs.sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      return dateA - dateB;
    });

  } catch (error) {
    console.error(`Failed to list runs for customer ${customerId}:`, error);
    return [];
  }
}

/**
 * Loads the latest KYC run for a customer based on createdAt timestamp.
 * Returns null if no runs exist.
 */
export async function loadLatestRun(customerId: string): Promise<KycRun | null> {
  const runs = await listRuns(customerId);
  if (runs.length === 0) {
    return null;
  }
  // listRuns sorts ascending, so the last one is the latest
  return runs[runs.length - 1];
}

