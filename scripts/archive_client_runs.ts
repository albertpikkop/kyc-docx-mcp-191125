import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_ROOT = path.resolve(__dirname, '../data');

async function archiveClientData(customerId: string) {
  if (!customerId) {
    console.error('Please provide a customerId. Usage: npm run archive:client -- <customerId>');
    process.exit(1);
  }

  const normalizedId = customerId.toLowerCase().trim().replace(/\s+/g, '-');
  const clientDir = path.join(DATA_ROOT, normalizedId);
  
  // Check if client dir exists
  try {
    await fs.access(clientDir);
  } catch {
    console.log(`No data found for customer: ${customerId}. Nothing to archive.`);
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archiveName = `archive_${timestamp}`;
  const archiveDir = path.join(clientDir, 'archive', archiveName);

  const runsDir = path.join(clientDir, 'runs');
  const reportsDir = path.join(clientDir, 'reports');

  // Create archive directory
  await fs.mkdir(archiveDir, { recursive: true });

  // Helper to move files
  const moveFiles = async (sourceDir: string, destSubDir: string) => {
    try {
      await fs.access(sourceDir);
      const files = await fs.readdir(sourceDir);
      if (files.length === 0) return 0;

      const targetDir = path.join(archiveDir, destSubDir);
      await fs.mkdir(targetDir, { recursive: true });

      let count = 0;
      for (const file of files) {
        const srcPath = path.join(sourceDir, file);
        const destPath = path.join(targetDir, file);
        
        // Check if it's a file
        const stat = await fs.stat(srcPath);
        if (stat.isFile()) {
            await fs.rename(srcPath, destPath);
            count++;
        }
      }
      return count;
    } catch (err) {
      // Directory might not exist, ignore
      return 0;
    }
  };

  console.log(`📦 Archiving data for ${customerId}...`);
  
  const runsMoved = await moveFiles(runsDir, 'runs');
  const reportsMoved = await moveFiles(reportsDir, 'reports');

  if (runsMoved + reportsMoved > 0) {
    console.log(`✅ Archived ${runsMoved} runs and ${reportsMoved} reports to:`);
    console.log(`   ${archiveDir}`);
    console.log(`✨ Workspace for ${customerId} is now clean for new runs.`);
  } else {
    console.log(`ℹ️  No active runs or reports found to archive.`);
    // Clean up empty archive dir if created
    try {
        await fs.rmdir(archiveDir);
        // Try to remove parent archive folder if empty
        await fs.rmdir(path.join(clientDir, 'archive')).catch(() => {});
    } catch {}
  }
}

// Get customerId from args
const args = process.argv.slice(2);
const customerId = args[0];

archiveClientData(customerId).catch(console.error);
