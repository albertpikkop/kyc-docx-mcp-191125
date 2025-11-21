import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { KycRun } from './types.js';
import * as XLSX from 'xlsx';
import { logRunCost, calculateRunCost } from './costTracker.js';

// Root directory for data, relative to this file
// src/kyc/storage.ts -> ../../data/
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_ROOT = path.resolve(__dirname, '../../data');
const writeQueues = new Map<string, Promise<string>>();

/**
 * Normalize customer ID for folder names
 * Converts to lowercase and replaces spaces with hyphens
 */
function normalizeCustomerId(customerId: string): string {
  return customerId.toLowerCase().trim().replace(/\s+/g, '-');
}

/**
 * Helper to get customer directory path
 */
function getCustomerDir(customerId: string): string {
  const normalized = normalizeCustomerId(customerId);
  return path.join(DATA_ROOT, normalized);
}

/**
 * Helper to get runs directory path for a customer
 */
function getRunsDir(customerId: string): string {
  return path.join(getCustomerDir(customerId), 'runs');
}

/**
 * Helper to get reports directory path for a customer
 */
function getReportsDir(customerId: string): string {
  return path.join(getCustomerDir(customerId), 'reports');
}

/**
 * Helper to get documents directory path for a customer
 */
function getDocumentsDir(customerId: string): string {
  return path.join(getCustomerDir(customerId), 'documents');
}

/**
 * Helper to get run file path
 */
function getRunFilePath(customerId: string, runId: string): string {
  return path.join(getRunsDir(customerId), `run-${runId}.json`);
}

/**
 * Helper to get report file path
 */
function getReportFilePath(customerId: string, runId: string): string {
  return path.join(getReportsDir(customerId), `report-${runId}.html`);
}

/**
 * Helper to get Excel file path
 */
function getExcelFilePath(customerId: string, runId: string): string {
  return path.join(getReportsDir(customerId), `report-${runId}.xlsx`);
}

/**
 * Saves a KYC run to disk and generates visual report.
 * Creates the customer directory structure if it doesn't exist.
 * Overwrites the file if it already exists for the same runId.
 * Returns the file:// URL to the generated HTML report.
 */
export async function saveRun(run: KycRun): Promise<string> {
  if (!run.customerId || !run.runId) {
    throw new Error('Run must have customerId and runId');
  }

  const write = async (): Promise<string> => {
    try {
      // Create directory structure
      const runsDir = getRunsDir(run.customerId);
      const reportsDir = getReportsDir(run.customerId);
      const documentsDir = getDocumentsDir(run.customerId);
      
      await fs.mkdir(runsDir, { recursive: true });
      await fs.mkdir(reportsDir, { recursive: true });
      await fs.mkdir(documentsDir, { recursive: true });

      // Save run JSON
      const filePath = getRunFilePath(run.customerId, run.runId);
      const content = JSON.stringify(run, null, 2);
      await fs.writeFile(filePath, content, 'utf-8');

      // Log Cost
      // Estimate usage based on documents count if actual usage is not available in run object
      // In a real implementation, 'run' object should contain token usage data from extractors
      const estimatedInputTokens = run.documents.length * 30000; // Avg 30k tokens per doc (Acta is heavy)
      const estimatedOutputTokens = run.documents.length * 1000; // Avg 1k tokens output
      const estimatedCost = calculateRunCost({
        prompt_tokens: estimatedInputTokens,
        completion_tokens: estimatedOutputTokens,
        total_tokens: estimatedInputTokens + estimatedOutputTokens
      });

      await logRunCost({
        runId: run.runId,
        customerId: run.customerId,
        timestamp: new Date().toISOString(),
        model: 'gpt-5.1', // Assuming default model
        usage: {
            prompt_tokens: estimatedInputTokens,
            completion_tokens: estimatedOutputTokens,
            total_tokens: estimatedInputTokens + estimatedOutputTokens
        },
        estimatedCost,
        documentCount: run.documents.length,
        reportType: 'kyc_full'
      });

      // Generate and save HTML report if profile and validation exist
      let reportUrl = '';
      if (run.profile && run.validation) {
        reportUrl = await generateVisualReport(run);
        // Also generate Excel export
        await generateExcelReport(run);
      }

      return reportUrl;
    } catch (error) {
      console.error(`Failed to save run ${run.runId} for customer ${run.customerId}:`, error);
      throw error;
    }
  };

  const existing = writeQueues.get(run.customerId) ?? Promise.resolve('');
  const writeTask = existing.then(write);
  writeQueues.set(run.customerId, writeTask.catch(() => Promise.resolve('')));
  return await writeTask;
}

/**
 * Bilingual translations for Mexican market
 */
const translations = {
  en: {
    nav: {
      title: "KYCIntel",
      print: "Print",
      exportExcel: "Export Excel"
    },
    header: {
      rfc: "RFC",
      generated: "Generated",
      approved: "APPROVED",
      rejected: "REJECTED",
      reviewNeeded: "REVIEW NEEDED"
    },
    sidebar: {
      riskScore: "Risk Score",
      trustScore: "Trust Score",
      complianceFlags: "Compliance Flags",
      sourceDocuments: "Source Documents",
      noFlags: "No risk flags detected.",
      processed: "Processed"
    },
    print: {
      title: "KYC Report"
    }
  },
  es: {
    nav: {
      title: "KYCIntel",
      print: "Imprimir",
      exportExcel: "Exportar Excel"
    },
    header: {
      rfc: "RFC",
      generated: "Generado",
      approved: "APROBADO",
      rejected: "RECHAZADO",
      reviewNeeded: "REVISIÓN REQUERIDA"
    },
    sidebar: {
      riskScore: "Puntuación de Riesgo",
      trustScore: "Puntuación de Confianza",
      complianceFlags: "Banderas de Cumplimiento",
      sourceDocuments: "Documentos Fuente",
      noFlags: "No se detectaron banderas de riesgo.",
      processed: "Procesado"
    },
    print: {
      title: "Reporte KYC"
    }
  }
};

/**
 * Generates a visual HTML report for a KYC run
 */
async function generateVisualReport(run: KycRun): Promise<string> {
  // Dynamic import to avoid circular dependency
  const { buildKycReport } = await import('./reportBuilder.js');
  const report = buildKycReport(run.profile!, run.validation!, { includeTrace: true });
  
  // Determine Status Color
  const score = run.validation!.score;
  let statusColor = "bg-green-100 text-green-800";
  let statusTextEn = "APPROVED";
  let statusTextEs = "APROBADO";
  if (score < 0.7) {
    statusColor = "bg-red-100 text-red-800";
    statusTextEn = "REJECTED";
    statusTextEs = "RECHAZADO";
  } else if (score < 0.9) {
    statusColor = "bg-yellow-100 text-yellow-800";
    statusTextEn = "REVIEW NEEDED";
    statusTextEs = "REVISIÓN REQUERIDA";
  }

  // Safe Accessors
  const companyName = run.profile!.companyIdentity?.razon_social || run.profile!.companyTaxProfile?.razon_social || "Unknown Company";
  const rfc = run.profile!.companyTaxProfile?.rfc || "N/A";
  
  // Flags HTML (Bilingual)
  const flagsHtml = run.validation!.flags.length === 0 
    ? `<div class="p-4 bg-green-50 border border-green-200 rounded-lg flex items-center shadow-sm">
        <svg class="w-5 h-5 text-green-600 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
        <div>
          <div class="text-green-800 font-medium" style="font-size: 15px; line-height: 1.6;">${translations.en.sidebar.noFlags}</div>
          <div class="text-green-700 mt-1.5" style="font-size: 14px; line-height: 1.6;">${translations.es.sidebar.noFlags}</div>
        </div>
      </div>`
    : run.validation!.flags.map(f => {
        const isCritical = f.level === 'critical';
        const isWarning = f.level === 'warning';
        const bgClass = isCritical ? 'bg-red-50' : (isWarning ? 'bg-yellow-50' : 'bg-blue-50');
        const borderClass = isCritical ? 'border-red-200' : (isWarning ? 'border-yellow-200' : 'border-blue-200');
        const textClass = isCritical ? 'text-red-800' : (isWarning ? 'text-yellow-800' : 'text-blue-800');
        const icon = isCritical ? '🔴' : (isWarning ? '⚠️' : 'ℹ️');
        return `
          <div class="p-4 mb-3 ${bgClass} border ${borderClass} rounded-lg flex items-start shadow-sm hover:shadow transition-shadow">
            <span class="text-xl mr-3 mt-0.5">${icon}</span>
            <div class="flex-1">
              <div class="font-semibold ${textClass} mb-1.5" style="font-size: 14px; line-height: 1.5;">${f.code}</div>
              <div class="${textClass.replace('800', '700')}" style="font-size: 14px; line-height: 1.6;">${f.message}</div>
            </div>
          </div>
        `;
      }).join("");

  // Documents Grid
  const docNames: Record<string, { en: string; es: string }> = {
    'acta': { en: 'Acta Constitutiva', es: 'Acta Constitutiva' },
    'sat_constancia': { en: 'SAT Constancia', es: 'Constancia SAT' },
    'fm2': { en: 'FM2 Immigration', es: 'FM2 Inmigración' },
    'telmex': { en: 'Telmex Bill', es: 'Recibo Telmex' },
    'cfe': { en: 'CFE Bill', es: 'Recibo CFE' },
    'bank_identity_page': { en: 'Bank Identity', es: 'Identidad Bancaria' },
    'bank_statement': { en: 'Bank Statement', es: 'Estado de Cuenta' }
  };
  
  const docs = run.documents.map(d => {
      const docIcons: Record<string, string> = {
        'acta': '📋',
        'sat_constancia': '🏛️',
        'fm2': '🛂',
        'telmex': '📞',
        'cfe': '⚡',
        'bank_identity_page': '🏦',
        'bank_statement': '💳'
      };
      const icon = docIcons[d.type] || '📄';
      const names = docNames[d.type] || { en: d.type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()), es: d.type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()) };
      
      return `
        <div class="flex items-center justify-between p-4 bg-white rounded-lg mb-2 border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all gap-3">
            <div class="flex items-center flex-1 min-w-0">
                <div class="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center text-xl mr-3 flex-shrink-0">
                    ${icon}
                </div>
                <div class="min-w-0 flex-1 overflow-hidden">
                    <div class="text-sm font-semibold text-gray-900 break-words" style="font-size: 14px; line-height: 1.5;">${names.en}</div>
                    <div class="text-xs text-gray-600 break-words mt-1" style="font-size: 12px; line-height: 1.5;">${names.es}</div>
                    <div class="text-xs text-gray-500 break-words mt-1.5" style="font-size: 11px; line-height: 1.4;">${d.sourceName || 'Unknown Source / Fuente Desconocida'}</div>
                </div>
            </div>
            <div class="flex flex-col items-end ml-3 flex-shrink-0 gap-1">
              <span class="text-xs bg-green-100 text-green-700 px-3 py-1.5 rounded-lg font-medium whitespace-nowrap">✓ ${translations.en.sidebar.processed}</span>
              <span class="text-xs text-gray-500 whitespace-nowrap">${translations.es.sidebar.processed}</span>
            </div>
        </div>
      `;
  }).join("");

  // Enhanced markdown to HTML conversion with proper text wrapping
  function markdownToHtml(markdown: string): string {
    const lines = markdown.split('\n');
    const processed: string[] = [];
    let inTable = false;
    let tableRows: string[][] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Detect table start
      if (line.includes('|') && !line.match(/^\|[\s-:]+\|$/)) {
        if (!inTable) {
          inTable = true;
          tableRows = [];
        }
        const cells = line.split('|').map(c => c.trim()).filter(c => c);
        if (cells.length > 0) {
          // Check if it's a header separator
          if (cells[0].match(/^[-:]+$/)) {
            continue; // Skip separator
          }
          tableRows.push(cells);
        }
        continue;
      } else {
        // End of table
        if (inTable && tableRows.length > 0) {
          const headerRow = tableRows[0];
          const bodyRows = tableRows.slice(1);
          processed.push(`<div class="overflow-x-auto my-4 rounded-lg border border-gray-300 shadow-sm">`);
          processed.push(`<table class="min-w-full divide-y divide-gray-200">`);
          processed.push(`<thead class="bg-gradient-to-r from-gray-50 to-gray-100">`);
          processed.push(`<tr>${headerRow.map((cell: string) => `<th class="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider break-words">${cell}</th>`).join('')}</tr>`);
          processed.push(`</thead>`);
          processed.push(`<tbody class="bg-white divide-y divide-gray-200">`);
          bodyRows.forEach((row: string[]) => {
            processed.push(`<tr class="hover:bg-gray-50 transition-colors">${row.map((cell: string) => `<td class="px-6 py-4 text-sm text-gray-700 break-words max-w-xs">${cell}</td>`).join('')}</tr>`);
          });
          processed.push(`</tbody>`);
          processed.push(`</table>`);
          processed.push(`</div>`);
          tableRows = [];
          inTable = false;
        }
      }
      
      // Headers
      if (line.startsWith('### ')) {
        processed.push(`<h3 class="text-lg font-semibold text-gray-900 mt-6 mb-4 pb-2 border-b border-gray-200 break-words" style="font-size: 18px; line-height: 1.4;">${line.substring(4)}</h3>`);
        continue;
      }
      if (line.startsWith('## ')) {
        processed.push(`<h2 class="text-xl font-bold text-gray-900 mt-8 mb-5 break-words" style="font-size: 20px; line-height: 1.3;">${line.substring(3)}</h2>`);
        continue;
      }
      if (line.startsWith('# ')) {
        processed.push(`<h1 class="text-2xl font-bold text-gray-900 mt-8 mb-5 break-words" style="font-size: 24px; line-height: 1.3;">${line.substring(2)}</h1>`);
        continue;
      }
      
      // Lists
      if (line.startsWith('- ')) {
        const content = line.substring(2);
        // Handle bold labels
        const boldMatch = content.match(/^\*\*(.*?):\*\*\s*(.*)$/);
        if (boldMatch) {
          processed.push(`<li class="mb-2.5 break-words" style="font-size: 15px; line-height: 1.7;"><span class="font-semibold text-gray-800">${boldMatch[1]}:</span> <span class="text-gray-700">${boldMatch[2]}</span></li>`);
        } else {
          // Handle bold only
          const boldOnly = content.replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-gray-900">$1</strong>');
          processed.push(`<li class="mb-2.5 text-gray-700 break-words" style="font-size: 15px; line-height: 1.7;">${boldOnly}</li>`);
        }
        continue;
      }
      
      // Empty lines
      if (line === '') {
        processed.push('');
        continue;
      }
      
      // Regular text
      let text = line;
      // Process inline formatting
      text = text.replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-gray-900">$1</strong>');
      text = text.replace(/\*(.*?)\*/g, '<em class="italic text-gray-600">$1</em>');
      text = text.replace(/`([^`]+)`/g, '<code class="bg-gray-100 text-gray-800 px-1.5 py-0.5 rounded text-sm font-mono break-all">$1</code>');
      
      if (text.trim()) {
        processed.push(`<p class="mb-4 text-gray-700 break-words" style="font-size: 15px; line-height: 1.7;">${text}</p>`);
      }
    }
    
    // Handle any remaining table
    if (inTable && tableRows.length > 0) {
      const headerRow = tableRows[0];
      const bodyRows = tableRows.slice(1);
      processed.push(`<div class="overflow-x-auto my-4 rounded-lg border border-gray-300 shadow-sm">`);
      processed.push(`<table class="min-w-full divide-y divide-gray-200">`);
      processed.push(`<thead class="bg-gradient-to-r from-gray-50 to-gray-100">`);
      processed.push(`<tr>${headerRow.map((cell: string) => `<th class="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider break-words">${cell}</th>`).join('')}</tr>`);
      processed.push(`</thead>`);
      processed.push(`<tbody class="bg-white divide-y divide-gray-200">`);
      bodyRows.forEach((row: string[]) => {
        processed.push(`<tr class="hover:bg-gray-50 transition-colors">${row.map((cell: string) => `<td class="px-6 py-4 text-sm text-gray-700 break-words max-w-xs">${cell}</td>`).join('')}</tr>`);
      });
      processed.push(`</tbody>`);
      processed.push(`</table>`);
      processed.push(`</div>`);
    }
    
    // Wrap lists
    let html = processed.join('\n');
    html = html.replace(/(<li[^>]*>.*?<\/li>(?:\s*<li[^>]*>.*?<\/li>)*)/gs, (match) => {
      if (!match.includes('<ul')) {
        return `<ul class="list-disc list-inside space-y-1 my-3 ml-4">${match}</ul>`;
      }
      return match;
    });
    
    return html;
  }

  // Section title translations
  const sectionTitles: Record<string, { en: string; es: string }> = {
    "I. HECHOS EXTRAÍDOS": { en: "I. EXTRACTED FACTS", es: "I. HECHOS EXTRAÍDOS" },
    "II. CONCLUSIONES DE KYC": { en: "II. KYC CONCLUSIONS", es: "II. CONCLUSIONES DE KYC" },
    "III. BANDERAS DE RIESGO": { en: "III. RISK FLAGS", es: "III. BANDERAS DE RIESGO" },
    "IV. TRAZA DE JUSTIFICACIÓN": { en: "IV. TRACEABILITY / JUSTIFICATION", es: "IV. TRAZA DE JUSTIFICACIÓN" }
  };

  // Trace / Summary Sections (Bilingual)
  const sectionsHtml = report.sections.map(s => {
      const body = markdownToHtml(s.body);
      const titleTranslations = sectionTitles[s.title] || { en: s.title, es: s.title };
      
      return `
        <div class="fluent-card rounded-xl shadow-md border border-gray-200 p-8 mb-6 hover:shadow-lg transition-all section-card">
            <h2 class="text-2xl font-semibold text-gray-900 mb-3 pb-3 border-b-2 border-blue-200 break-words" style="font-size: 22px; line-height: 1.4;">
              ${titleTranslations.en}
            </h2>
            <div class="text-base text-gray-600 mb-6 pb-2 border-b border-gray-200 break-words" style="font-size: 16px; line-height: 1.5;">
              ${titleTranslations.es}
            </div>
            <div class="text-gray-700 prose prose-sm max-w-none" style="font-size: 15px; line-height: 1.7;">
                ${body}
            </div>
        </div>
      `;
  }).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${translations.en.print.title} / ${translations.es.print.title} - ${companyName}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Roboto:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        * { 
            font-family: 'Inter', 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }
        body { 
            font-family: 'Inter', 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
            font-size: 15px;
            line-height: 1.6;
            letter-spacing: 0.01em;
        }
        h1, h2, h3, h4, h5, h6 {
            font-weight: 600;
            letter-spacing: -0.02em;
            line-height: 1.3;
        }
        p, li, td, th {
            font-size: 15px;
            line-height: 1.7;
            letter-spacing: 0.01em;
        }
        table { border-collapse: separate; border-spacing: 0; }
        table thead th { 
            background: linear-gradient(to bottom, #f3f4f6, #e5e7eb);
            font-weight: 600;
            text-transform: uppercase;
            font-size: 0.8rem;
            letter-spacing: 0.03em;
            color: #1f2937;
            line-height: 1.5;
        }
        table tbody tr:hover { background-color: #f3f4f6; }
        table td, table th {
            font-size: 14px;
            line-height: 1.6;
            padding: 12px 16px;
        }
        code { 
            font-family: 'Consolas', 'Monaco', 'Menlo', 'Courier New', monospace;
            font-size: 13px;
            line-height: 1.5;
        }
        
        .score-ring { transition: all 0.3s ease; }
        .section-card { transition: all 0.2s ease; }
        .section-card:hover { transform: translateY(-1px); }
        
        /* Prevent text overflow and ensure proper wrapping */
        * { word-wrap: break-word; overflow-wrap: break-word; }
        h1, h2, h3, h4, h5, h6 { word-break: break-word; }
        p, li, td, th { word-break: break-word; hyphens: auto; }
        
        /* Ensure proper spacing */
        .section-card h2 { line-height: 1.3; }
        .section-card h3 { line-height: 1.4; }
        
        /* Better table cell wrapping */
        table td, table th { 
            word-break: break-word;
            overflow-wrap: break-word;
            max-width: 300px;
        }
        
        /* Windows Fluent Design */
        .fluent-card {
            background: rgba(255, 255, 255, 0.9);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(0, 0, 0, 0.1);
        }
        .fluent-button {
            background: linear-gradient(135deg, #0078d4 0%, #106ebe 100%);
            border: none;
            box-shadow: 0 2px 4px rgba(0, 120, 212, 0.2);
        }
        .fluent-button:hover {
            background: linear-gradient(135deg, #106ebe 0%, #005a9e 100%);
            box-shadow: 0 4px 8px rgba(0, 120, 212, 0.3);
        }
        
        /* Print Styles - Optimized for professional printing */
        @media print {
            @page {
                size: A4;
                margin: 1.5cm 1.5cm 2cm 1.5cm;
            }
            
            * {
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
                color-adjust: exact !important;
            }
            
            body { 
                background: white !important;
                color: #000 !important;
                font-size: 11pt;
                line-height: 1.5;
            }
            
            .no-print { 
                display: none !important; 
            }
            
            nav { 
                display: none !important; 
            }
            
            .fluent-card { 
                background: white !important;
                border: 1px solid #d1d5db !important;
                box-shadow: none !important;
                page-break-inside: avoid;
                margin-bottom: 1.5em;
                padding: 1em;
            }
            
            .section-card { 
                page-break-inside: avoid;
                break-inside: avoid;
            }
            
            h1, h2, h3, h4, h5, h6 {
                page-break-after: avoid;
                page-break-inside: avoid;
                color: #000 !important;
            }
            
            table {
                page-break-inside: auto;
                border-collapse: collapse;
            }
            
            tr {
                page-break-inside: avoid;
                page-break-after: auto;
            }
            
            thead {
                display: table-header-group;
            }
            
            tfoot {
                display: table-footer-group;
            }
            
            /* Prevent breaking inside cells */
            td, th {
                page-break-inside: avoid;
                padding: 8px !important;
            }
            
            /* Avoid breaking lists */
            ul, ol {
                page-break-inside: avoid;
            }
            
            li {
                page-break-inside: avoid;
            }
            
            /* Section breaks */
            .print-break { 
                page-break-after: always; 
            }
            
            .print-break-before {
                page-break-before: always;
            }
            
            /* Ensure proper spacing */
            .space-y-6 > * + * {
                margin-top: 1.5em;
            }
            
            /* Remove gradients and shadows for print */
            .bg-gradient-to-br,
            .bg-gradient-to-r {
                background: white !important;
            }
            
            .shadow-md,
            .shadow-sm,
            .shadow-lg {
                box-shadow: none !important;
            }
            
            /* Ensure text is readable */
            .text-gray-700,
            .text-gray-600,
            .text-gray-500 {
                color: #374151 !important;
            }
            
            .text-gray-900 {
                color: #111827 !important;
            }
            
            /* Keep important colors for flags */
            .bg-red-50 { background: #fef2f2 !important; }
            .bg-yellow-50 { background: #fefce8 !important; }
            .bg-green-50 { background: #f0fdf4 !important; }
            .bg-blue-50 { background: #eff6ff !important; }
            
            .text-red-800 { color: #991b1b !important; }
            .text-yellow-800 { color: #854d0e !important; }
            .text-green-800 { color: #166534 !important; }
            .text-blue-800 { color: #1e40af !important; }
            
            /* Grid layout for print */
            .grid {
                display: block;
            }
            
            .lg\\:grid-cols-3 {
                grid-template-columns: 1fr;
            }
            
            .lg\\:col-span-2 {
                width: 100%;
            }
            
            /* Sidebar content should come after main content in print */
            .space-y-6 > div:first-child {
                page-break-after: always;
            }
        }
    </style>
    <script>
        function printReport() {
            // Use browser's native print dialog - best quality
            window.print();
        }
        
        function exportToExcel() {
            // Excel file was already generated server-side
            const excelPath = '${getExcelFilePath(run.customerId, run.runId)}';
            const companyNameSafe = '${companyName.replace(/[^a-z0-9]/gi, '_')}';
            const dateStr = '${new Date(run.createdAt).toISOString().split('T')[0]}';
            const filename = 'KYC_Report_' + companyNameSafe + '_' + dateStr + '.xlsx';
            
            // Convert to file:// URL for opening
            const fileUrl = 'file://' + excelPath.replace(/\\\\/g, '/');
            
            // Show user-friendly message with file location
            const button = event.target;
            const originalText = button.innerHTML;
            button.innerHTML = '✅ ${translations.en.nav.exportExcel}';
            
            // Create a message with the file path
            const message = 'Excel file generated successfully!\\n\\n' +
                          'File: ' + filename + '\\n\\n' +
                          'Location: ' + excelPath + '\\n\\n' +
                          'The file has been saved. You can find it in the reports folder.';
            
            alert(message);
            
            // Try to open the file location (works on some systems)
            setTimeout(() => {
                try {
                    window.open(fileUrl, '_blank');
                } catch (e) {
                    // If opening fails, user can navigate manually
                }
                button.innerHTML = originalText;
            }, 1000);
        }
    </script>
</head>
<body class="bg-gradient-to-br from-gray-50 via-gray-100 to-gray-50 min-h-screen">
    <!-- Navigation -->
    <nav class="fluent-card sticky top-0 z-50 shadow-md no-print">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div class="flex justify-between h-16">
                <div class="flex items-center">
                    <div class="flex-shrink-0 flex items-center">
                        <div class="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-700 rounded-lg flex items-center justify-center text-white font-bold mr-3 shadow-lg">K</div>
                        <span class="font-semibold text-lg text-gray-900">KYC<span class="text-blue-600">Intel</span></span>
                    </div>
                </div>
                <div class="flex items-center space-x-3">
                    <span class="text-sm text-gray-600">${new Date(run.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    <button onclick="printReport()" class="fluent-button text-white px-4 py-2 rounded-lg text-sm font-medium transition-all no-print whitespace-nowrap">
                        🖨️ ${translations.en.nav.print} / ${translations.es.nav.print}
                    </button>
                    <button onclick="exportToExcel()" class="fluent-button text-white px-4 py-2 rounded-lg text-sm font-medium transition-all no-print whitespace-nowrap">
                        📊 ${translations.en.nav.exportExcel} / ${translations.es.nav.exportExcel}
                    </button>
                </div>
            </div>
        </div>
    </nav>

    <div id="report-content" class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        <!-- Header -->
        <div class="fluent-card rounded-xl shadow-md p-8 mb-8">
            <div class="md:flex md:items-center md:justify-between">
                <div class="flex-1 min-w-0">
                    <h1 class="text-3xl font-semibold leading-snug text-gray-900 mb-4 break-words" style="font-size: 28px; line-height: 1.3;">
                        ${companyName}
                    </h1>
                    <div class="flex flex-wrap gap-6 text-gray-700">
                        <div class="flex items-start">
                            <svg class="w-4 h-4 mr-2 text-blue-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path>
                            </svg>
                            <div class="min-w-0">
                              <div class="break-words" style="font-size: 15px; line-height: 1.6;"><span class="font-medium text-gray-900">${translations.en.header.rfc}:</span> <span class="text-gray-700">${rfc}</span></div>
                              <div class="text-gray-500 mt-1 break-words" style="font-size: 13px; line-height: 1.5;">${translations.es.header.rfc}: ${rfc}</div>
                            </div>
                        </div>
                        <div class="flex items-start">
                            <svg class="w-4 h-4 mr-2 text-blue-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                            </svg>
                            <div class="min-w-0">
                              <div class="break-words" style="font-size: 15px; line-height: 1.6;"><span class="font-medium text-gray-900">${translations.en.header.generated}:</span> <span class="text-gray-700">${new Date(run.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span></div>
                              <div class="text-gray-500 mt-1 break-words" style="font-size: 13px; line-height: 1.5;">${translations.es.header.generated}: ${new Date(run.createdAt).toLocaleDateString('es-MX', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="mt-4 flex md:mt-0 md:ml-4">
                    <div class="flex flex-col items-end">
                      <span class="${statusColor} px-6 py-2.5 rounded-lg text-sm font-semibold tracking-wide uppercase shadow-sm border whitespace-nowrap">
                          ${statusTextEn}
                      </span>
                      <span class="text-xs text-gray-600 mt-1.5 whitespace-nowrap">${statusTextEs}</span>
                    </div>
                </div>
            </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            <!-- Left Column: Score & Risks -->
            <div class="space-y-6">
                
                <!-- Score Card -->
                <div class="fluent-card rounded-xl shadow-md border border-gray-200 p-6 hover:shadow-lg transition-all">
                    <h3 class="text-lg font-semibold text-gray-900 mb-2 flex items-center" style="font-size: 17px; line-height: 1.4;">
                        <svg class="w-5 h-5 mr-2 text-blue-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                        </svg>
                        <span class="break-words">${translations.en.sidebar.riskScore}</span>
                    </h3>
                    <div class="text-sm text-gray-500 mb-5 ml-7 break-words" style="font-size: 13px; line-height: 1.5;">${translations.es.sidebar.riskScore}</div>
                    <div class="flex flex-col items-center justify-center">
                        <div class="relative w-36 h-36 mb-3">
                            <svg class="w-full h-full transform -rotate-90 score-ring" viewBox="0 0 36 36">
                                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#e5e7eb" stroke-width="3" />
                                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="${score > 0.9 ? '#107c10' : (score > 0.7 ? '#ffaa44' : '#d13438')}" stroke-width="3" stroke-dasharray="${score * 100}, 100" stroke-linecap="round" />
                            </svg>
                            <div class="absolute inset-0 flex items-center justify-center flex-col">
                                <span class="text-4xl font-semibold text-gray-900" style="font-size: 42px; line-height: 1.2;">${(score * 100).toFixed(0)}</span>
                                <span class="text-xs text-gray-600 uppercase tracking-wider mt-1.5" style="font-size: 11px; line-height: 1.4;">${translations.en.sidebar.trustScore}</span>
                            </div>
                        </div>
                        <div class="text-sm text-gray-500 text-center mt-2" style="font-size: 13px; line-height: 1.5;">${translations.es.sidebar.trustScore}</div>
                    </div>
                </div>

                <!-- Flags -->
                <div class="fluent-card rounded-xl shadow-md border border-gray-200 p-6">
                    <h3 class="text-lg font-semibold text-gray-900 mb-2 flex items-center" style="font-size: 17px; line-height: 1.4;">
                        <svg class="w-5 h-5 mr-2 text-blue-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                        </svg>
                        <span class="break-words">${translations.en.sidebar.complianceFlags}</span>
                    </h3>
                    <div class="text-sm text-gray-500 mb-4 ml-7 break-words" style="font-size: 13px; line-height: 1.5;">${translations.es.sidebar.complianceFlags}</div>
                    <div class="space-y-3">
                        ${flagsHtml}
                    </div>
                </div>

                <!-- Source Documents -->
                <div class="fluent-card rounded-xl shadow-md border border-gray-200 p-6">
                    <h3 class="text-lg font-semibold text-gray-900 mb-2 flex items-center" style="font-size: 17px; line-height: 1.4;">
                        <svg class="w-5 h-5 mr-2 text-blue-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                        </svg>
                        <span class="break-words">${translations.en.sidebar.sourceDocuments}</span>
                    </h3>
                    <div class="text-sm text-gray-500 mb-4 ml-7 break-words" style="font-size: 13px; line-height: 1.5;">${translations.es.sidebar.sourceDocuments}</div>
                    <div class="space-y-2">
                        ${docs}
                    </div>
                </div>

            </div>

            <!-- Right Column: Detailed Report -->
            <div class="lg:col-span-2 space-y-6">
                ${sectionsHtml}
            </div>

        </div>
    </div>
</body>
</html>`;

  const reportPath = getReportFilePath(run.customerId, run.runId);
  await fs.writeFile(reportPath, html, 'utf-8');
  
  // Return file:// URL that can be opened in browser
  return `file://${reportPath}`;
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

    const runsDir = getRunsDir(customerId);
    
    // Check if runs directory exists
    try {
      await fs.access(runsDir);
    } catch {
      return [];
    }

    const files = await fs.readdir(runsDir);
    const runFiles = files.filter(f => f.startsWith('run-') && f.endsWith('.json'));

    const runs: KycRun[] = [];

    for (const file of runFiles) {
      try {
        const content = await fs.readFile(path.join(runsDir, file), 'utf-8');
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
  const pendingWrite = writeQueues.get(customerId);
  if (pendingWrite) {
    try {
      await pendingWrite;
    } catch {
      // Ignore write errors here; they will have been logged during save
    }
  }
  const runs = await listRuns(customerId);
  if (runs.length === 0) {
    return null;
  }
  // listRuns sorts ascending, so the last one is the latest
  return runs[runs.length - 1];
}

/**
 * Gets the file:// URL for a report HTML file.
 * Returns empty string if report doesn't exist.
 */
export function getReportUrl(customerId: string, runId: string): string {
  const reportPath = getReportFilePath(customerId, runId);
  return `file://${reportPath}`;
}

/**
 * Gets the file:// URL for the latest report.
 * Returns empty string if no runs exist.
 */
export async function getLatestReportUrl(customerId: string): Promise<string> {
  const run = await loadLatestRun(customerId);
  if (!run) {
    return '';
  }
  return getReportUrl(customerId, run.runId);
}

/**
 * Generates an Excel report from KYC run data
 */
async function generateExcelReport(run: KycRun): Promise<string> {
  const workbook = XLSX.utils.book_new();
  const profile = run.profile!;
  const validation = run.validation!;
  
  const companyName = profile.companyIdentity?.razon_social || profile.companyTaxProfile?.razon_social || "Unknown Company";
  const rfc = profile.companyTaxProfile?.rfc || "N/A";
  
  // Sheet 1: Summary
  const summaryData = [
    ['KYC Report Summary / Resumen KYC'],
    [],
    ['Company Name / Nombre de la Empresa', companyName],
    ['RFC', rfc],
    ['Report Date / Fecha del Reporte', new Date(run.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })],
    ['Score / Puntuación', `${(validation.score * 100).toFixed(0)}%`],
    ['Status / Estatus', validation.score >= 0.9 ? 'APPROVED / APROBADO' : (validation.score >= 0.7 ? 'REVIEW NEEDED / REVISIÓN REQUERIDA' : 'REJECTED / RECHAZADO')],
    ['Flags Count / Conteo de Banderas', validation.flags.length],
    [],
  ];
  
  // Company Identity
  if (profile.companyIdentity) {
    summaryData.push(['--- Company Identity / Identidad Corporativa ---']);
    summaryData.push(['Razón Social', profile.companyIdentity.razon_social]);
    summaryData.push(['Incorporation Date / Fecha de Constitución', profile.companyIdentity.incorporation_date]);
    if (profile.companyIdentity.founding_address) {
      const addr = profile.companyIdentity.founding_address;
      summaryData.push(['Founding Address / Domicilio Fundacional', 
        [addr.street, addr.ext_number, addr.colonia, addr.municipio, addr.estado, addr.cp].filter(Boolean).join(', ') || 'Not specified']);
    }
    summaryData.push([]);
  }
  
  // Tax Profile
  if (profile.companyTaxProfile) {
    summaryData.push(['--- Tax Profile / Perfil Fiscal ---']);
    summaryData.push(['RFC', profile.companyTaxProfile.rfc]);
    summaryData.push(['Tax Regime / Régimen Fiscal', profile.companyTaxProfile.tax_regime]);
    summaryData.push(['Status / Estatus', profile.companyTaxProfile.status]);
    if (profile.currentFiscalAddress) {
      const addr = profile.currentFiscalAddress;
      summaryData.push(['Fiscal Address / Domicilio Fiscal', 
        [addr.street, addr.ext_number, addr.colonia, addr.municipio, addr.estado, addr.cp].filter(Boolean).join(', ')]);
    }
    summaryData.push([]);
  }
  
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');
  
  // Sheet 2: Shareholders / UBO
  if (profile.companyIdentity?.shareholders && profile.companyIdentity.shareholders.length > 0) {
    const uboData = [
      ['Shareholder / Accionista', 'Shares / Acciones', 'Percentage / Porcentaje', 'UBO Status / Estado UBO']
    ];
    
    const totalShares = profile.companyIdentity.shareholders.reduce((sum, s) => sum + (s.shares || 0), 0);
    
    profile.companyIdentity.shareholders.forEach(sh => {
      const percentage = totalShares > 0 ? ((sh.shares || 0) / totalShares * 100).toFixed(2) : (sh.percentage || 0).toFixed(2);
      const isUbo = (parseFloat(percentage) > 25);
      uboData.push([
        sh.name || 'N/A',
        sh.shares?.toString() || 'N/A',
        `${percentage}%`,
        isUbo ? 'YES / SÍ' : 'NO'
      ]);
    });
    
    const uboSheet = XLSX.utils.aoa_to_sheet(uboData);
    XLSX.utils.book_append_sheet(workbook, uboSheet, 'Shareholders');
  }
  
  // Sheet 3: Signatories
  if (profile.companyIdentity?.legal_representatives && profile.companyIdentity.legal_representatives.length > 0) {
    const signatoryData = [
      ['Name / Nombre', 'Role / Rol', 'Scope / Alcance', 'Powers / Poderes']
    ];
    
    profile.companyIdentity.legal_representatives.forEach(rep => {
      const scope = rep.poder_scope;
      let scopeText = 'NONE / NINGUNO';
      if (scope && Array.isArray(scope)) {
        // Check if it contains all canonical powers for "full"
        const hasAllPowers = scope.some(p => typeof p === 'string' && p.toLowerCase().includes('pleitos')) &&
                            scope.some(p => typeof p === 'string' && p.toLowerCase().includes('administración')) &&
                            scope.some(p => typeof p === 'string' && p.toLowerCase().includes('dominio')) &&
                            scope.some(p => typeof p === 'string' && p.toLowerCase().includes('títulos'));
        scopeText = hasAllPowers ? 'FULL / COMPLETO' : 'LIMITED / LIMITADO';
      }
      signatoryData.push([
        rep.name || 'N/A',
        rep.role || 'N/A',
        scopeText,
        scope && Array.isArray(scope) ? scope.join(', ') : 'N/A'
      ]);
    });
    
    const signatorySheet = XLSX.utils.aoa_to_sheet(signatoryData);
    XLSX.utils.book_append_sheet(workbook, signatorySheet, 'Signatories');
  }
  
  // Sheet 4: Risk Flags
  const flagsData = [
    ['Code / Código', 'Level / Nivel', 'Message / Mensaje']
  ];
  
  if (validation.flags.length === 0) {
    flagsData.push(['N/A', 'INFO', 'No risk flags detected / No se detectaron banderas de riesgo']);
  } else {
    validation.flags.forEach(flag => {
      flagsData.push([
        flag.code,
        flag.level.toUpperCase(),
        flag.message
      ]);
    });
  }
  
  const flagsSheet = XLSX.utils.aoa_to_sheet(flagsData);
  XLSX.utils.book_append_sheet(workbook, flagsSheet, 'Risk Flags');
  
  // Sheet 5: Documents
  const docsData = [
    ['Type / Tipo', 'Source Name / Nombre de Fuente', 'Processed Date / Fecha Procesado']
  ];
  
  run.documents.forEach(doc => {
    docsData.push([
      doc.type,
      doc.sourceName || 'N/A',
      doc.extractedAt ? new Date(doc.extractedAt).toLocaleDateString() : 'N/A'
    ]);
  });
  
  const docsSheet = XLSX.utils.aoa_to_sheet(docsData);
  XLSX.utils.book_append_sheet(workbook, docsSheet, 'Documents');
  
  // Sheet 6: Addresses
  const addressData = [
    ['Type / Tipo', 'Street / Calle', 'Number / Número', 'Colonia', 'Municipio', 'Estado', 'Postal Code / CP']
  ];
  
  if (profile.foundingAddress) {
    const addr = profile.foundingAddress;
    addressData.push(['Founding / Fundacional', addr.street || '', addr.ext_number || '', addr.colonia || '', addr.municipio || '', addr.estado || '', addr.cp || '']);
  }
  
  if (profile.currentFiscalAddress) {
    const addr = profile.currentFiscalAddress;
    addressData.push(['Fiscal / Fiscal', addr.street || '', addr.ext_number || '', addr.colonia || '', addr.municipio || '', addr.estado || '', addr.cp || '']);
  }
  
  if (profile.currentOperationalAddress) {
    const addr = profile.currentOperationalAddress;
    addressData.push(['Operational / Operativo', addr.street || '', addr.ext_number || '', addr.colonia || '', addr.municipio || '', addr.estado || '', addr.cp || '']);
  }
  
  profile.addressEvidence?.forEach((poa, idx) => {
    if (poa.client_address) {
      const addr = poa.client_address;
      const provider = poa.vendor_name || poa.document_type || 'Unknown';
      addressData.push([`PoA ${idx + 1} (${provider})`, addr.street || '', addr.ext_number || '', addr.colonia || '', addr.municipio || '', addr.estado || '', addr.cp || '']);
    }
  });
  
  const addressSheet = XLSX.utils.aoa_to_sheet(addressData);
  XLSX.utils.book_append_sheet(workbook, addressSheet, 'Addresses');
  
  // Write Excel file
  const excelPath = getExcelFilePath(run.customerId, run.runId);
  XLSX.writeFile(workbook, excelPath);
  
  return excelPath;
}


