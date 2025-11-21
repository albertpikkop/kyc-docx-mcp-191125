#!/usr/bin/env tsx
/**
 * Client Management Script
 * 
 * Usage:
 *   npm run client:list                    - List all clients
 *   npm run client:run <customerId>        - Run KYC for a client
 *   npm run client:delete <customerId>      - Delete all runs for a client
 *   npm run client:open <customerId>      - Open latest report in browser
 *   npm run client:open-latest             - Open latest report for all clients
 */

import "dotenv/config";
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getLatestReportUrl, listRuns, loadLatestRun } from '../kyc/storage.js';
import type { KycRun } from '../kyc/types.js';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_ROOT = path.resolve(__dirname, '../../data');
const BASE_DOCUMENTS_FOLDER = "/Users/ashishpunj/Desktop/mcp-docs";

/**
 * Normalize customer ID for folder names
 * Converts to lowercase and replaces spaces with hyphens
 */
function normalizeCustomerId(customerId: string): string {
  return customerId.toLowerCase().trim().replace(/\s+/g, '-');
}

/**
 * List all clients
 */
async function listClients(): Promise<string[]> {
  try {
    const entries = await fs.readdir(DATA_ROOT, { withFileTypes: true });
    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort();
  } catch (error) {
    return [];
  }
}

/**
 * List available client folders from the documents directory
 */
async function listAvailableClientFolders(): Promise<string[]> {
  try {
    const entries = await fs.readdir(BASE_DOCUMENTS_FOLDER, { withFileTypes: true });
    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort();
  } catch (error) {
    return [];
  }
}

/**
 * Delete all runs for a client
 */
async function deleteClientRuns(customerId: string): Promise<void> {
  const customerDir = path.join(DATA_ROOT, customerId);
  const runsDir = path.join(customerDir, 'runs');
  const reportsDir = path.join(customerDir, 'reports');
  
  try {
    // Delete runs
    const runFiles = await fs.readdir(runsDir).catch(() => []);
    for (const file of runFiles) {
      if (file.startsWith('run-') && file.endsWith('.json')) {
        await fs.unlink(path.join(runsDir, file));
      }
    }
    
    // Delete reports
    const reportFiles = await fs.readdir(reportsDir).catch(() => []);
    for (const file of reportFiles) {
      if (file.startsWith('report-') && file.endsWith('.html')) {
        await fs.unlink(path.join(reportsDir, file));
      }
    }
    
    console.log(`✅ Deleted all runs and reports for client: ${customerId}`);
  } catch (error) {
    console.error(`❌ Failed to delete runs for ${customerId}:`, error);
    throw error;
  }
}

/**
 * Open URL in browser (macOS)
 */
async function openInBrowser(url: string): Promise<void> {
  try {
    await execAsync(`open "${url}"`);
    console.log(`🌐 Opened browser: ${url}`);
  } catch (error) {
    console.error(`❌ Failed to open browser:`, error);
    throw error;
  }
}

/**
 * Get client info
 */
async function getClientInfo(customerId: string): Promise<{
  customerId: string;
  runCount: number;
  latestRun: KycRun | null;
  latestReportUrl: string;
}> {
  const normalized = normalizeCustomerId(customerId);
  const runs = await listRuns(normalized);
  const latestRun = await loadLatestRun(normalized);
  const latestReportUrl = latestRun ? await getLatestReportUrl(normalized) : '';
  
  return {
    customerId: normalized,
    runCount: runs.length,
    latestRun,
    latestReportUrl
  };
}

async function main() {
  const command = process.argv[2];
  const customerId = process.argv[3];

  switch (command) {
    case 'list':
    case undefined:
      console.log('\n📋 Available Clients:\n');
      
      // Show clients with data (runs/reports)
      const clients = await listClients();
      if (clients.length > 0) {
        console.log('📊 Clients with KYC Data:');
        for (const clientId of clients) {
          const info = await getClientInfo(clientId);
          const dateStr = info.latestRun 
            ? new Date(info.latestRun.createdAt).toLocaleDateString()
            : 'N/A';
          const score = info.latestRun?.validation?.score 
            ? `${(info.latestRun.validation.score * 100).toFixed(0)}/100`
            : 'N/A';
          
          console.log(`  📁 ${clientId}`);
          console.log(`     Runs: ${info.runCount} | Latest: ${dateStr} | Score: ${score}`);
          if (info.latestReportUrl) {
            console.log(`     Report: ${info.latestReportUrl}`);
          }
          console.log('');
        }
      }
      
      // Show available document folders
      const docFolders = await listAvailableClientFolders();
      if (docFolders.length > 0) {
        console.log('📁 Available Document Folders:');
        for (const folder of docFolders) {
          const normalized = normalizeCustomerId(folder);
          const hasData = clients.includes(normalized);
          console.log(`  ${hasData ? '✅' : '📄'} ${folder} ${hasData ? '(has KYC data)' : '(ready to process)'}`);
        }
        console.log('');
      }
      
      if (clients.length === 0 && docFolders.length === 0) {
        console.log('  No clients found.');
      }
      break;

    case 'delete':
      if (!customerId) {
        console.error('❌ Usage: npm run client:delete <customerId>');
        process.exit(1);
      }
      await deleteClientRuns(customerId);
      break;

    case 'open':
      if (!customerId) {
        console.error('❌ Usage: npm run client:open <customerId>');
        process.exit(1);
      }
      const normalizedOpen = normalizeCustomerId(customerId);
      const reportUrl = await getLatestReportUrl(normalizedOpen);
      if (!reportUrl) {
        console.error(`❌ No report found for client: ${customerId}`);
        console.log(`💡 Run: npm run client:run ${customerId}`);
        process.exit(1);
      }
      await openInBrowser(reportUrl);
      break;

    case 'open-latest':
      const allClients = await listClients();
      if (allClients.length === 0) {
        console.log('No clients found.');
        process.exit(0);
      }
      
      // Find client with most recent report
      let latestClient: string | null = null;
      let latestDate = 0;
      
      for (const clientId of allClients) {
        const info = await getClientInfo(clientId);
        if (info.latestRun) {
          const date = new Date(info.latestRun.createdAt).getTime();
          if (date > latestDate) {
            latestDate = date;
            latestClient = clientId;
          }
        }
      }
      
      if (latestClient) {
        const reportUrl = await getLatestReportUrl(latestClient);
        if (reportUrl) {
          await openInBrowser(reportUrl);
        } else {
          console.error(`❌ No report found for client: ${latestClient}`);
        }
      } else {
        console.log('No clients with reports found.');
      }
      break;

    default:
      console.log(`
📋 Client Management Commands:

  npm run client:list                    - List all clients
  npm run client:delete <customerId>    - Delete all runs for a client
  npm run client:open <customerId>       - Open latest report in browser
  npm run client:open-latest             - Open latest report (most recent)

Examples:
  npm run client:list
  npm run client:delete pfds
  npm run client:open pfds
  npm run client:open-latest
      `);
      break;
  }
}

main().catch(console.error);

