import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { KycRun } from './types.js';
import * as XLSX from 'xlsx';
import { logRunCost, calculateRunCost } from './costTracker.js';
import { classifyEntityType, getClientOnboardingLabel, EntityType } from './validation.js';

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
 * Returns the signed URL (S3) or file:// URL (local) to the generated HTML report.
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
 * Spanish-only translations for Mexican market
 * Clean, professional Mexican legal terminology
 */
const t = {
  nav: {
    title: "KYCIntel",
    print: "Imprimir",
    exportExcel: "Exportar a Excel"
  },
  header: {
    rfc: "RFC",
    generated: "Generado",
    approved: "APROBADO",
    rejected: "RECHAZADO",
    reviewNeeded: "EN REVISIÓN",
    approvedWithObs: "APROBADO CON OBSERVACIONES"
  },
  sections: {
    executiveSummary: "Resumen Ejecutivo",
    extractedFacts: "I. Hechos Extraídos",
    kycConclusions: "II. Conclusiones de KYC",
    riskFlags: "III. Banderas y Riesgos",
    traceability: "IV. Trazabilidad y Justificación"
  },
  sidebar: {
    riskScore: "Puntuación de Riesgo",
    trustScore: "Nivel de Confianza",
    complianceFlags: "Banderas de Cumplimiento",
    sourceDocuments: "Documentos Fuente",
    noFlags: "Sin banderas de riesgo detectadas.",
    processed: "Procesado"
  },
  cards: {
    whoCanSign: "¿Quién Puede Firmar?",
    otherAuthorized: "Otros Autorizados en Acta",
    quickStatus: "Estado Rápido",
    taxRegime: "Régimen Fiscal",
    documents: "Documentos",
    flags: "Banderas",
    address: "Domicilio"
  },
  signing: {
    canSign: "PUEDE FIRMAR",
    limitedSign: "FIRMA LIMITADA",
    noAuthority: "SIN FACULTADES",
    notVerified: "NO VERIFICADO EN ACTA",
    missingId: "FALTA IDENTIFICACIÓN",
    cannotVerify: "NO SE PUEDE VERIFICAR"
  },
  powers: {
    full: "Poderes Amplios",
    fullDetail: "Poderes Amplios (Administración, Dominio, Pleitos, Títulos)",
    limited: "Poderes Limitados",
    none: "Sin Poderes"
  },
  personaFisica: {
    title: "Persona Física",
    canSignNote: "El titular firma en nombre propio. No requiere Acta Constitutiva ni poderes notariales.",
    role: "Titular / Propietario",
    legalNote: "Como Persona Física, no existe Acta Constitutiva. La capacidad jurídica se acredita con identificación oficial vigente.",
    clientType: "Alta de Cliente - Persona Física con Actividad Empresarial"
  },
  personaMoral: {
    title: "Persona Moral",
    otherSignersNote: "Personas con facultades según el Acta (no verificadas con ID)",
    noOtherSigners: "No hay otros firmantes registrados"
  },
  alerts: {
    criticalTitle: "ALERTA CRÍTICA - Documentación Inconsistente",
    criticalAction: "No proceder con el alta hasta resolver esta inconsistencia. Verificar que todos los documentos correspondan a la misma entidad legal.",
    warningTitle: "Observaciones Pendientes",
    notInActa: "Identidad verificada pero no aparece en el Acta Constitutiva. Verificar poderes notariales.",
    noAuthority: "Esta persona no tiene poderes para firmar contratos",
    limitedPowers: "Poderes Limitados - verificar alcance para este contrato",
    requiredId: "INE, Pasaporte, o FM2 para verificar identidad"
  },
  status: {
    active: "ACTIVO",
    inactive: "INACTIVO",
    unknown: "Desconocido",
    notSpecified: "No especificado"
  },
  labels: {
    role: "Cargo",
    quality: "Calidad",
    rfc: "RFC",
    regime: "Régimen",
    satStatus: "Estatus SAT",
    powers: "Facultades",
    required: "Requerido",
    alert: "Alerta",
    legalNote: "Nota Legal"
  },
  print: {
    title: "Reporte KYC"
  }
};

/**
 * Generates a visual HTML report for a KYC run
 */
async function generateVisualReport(run: KycRun): Promise<string> {
  // Dynamic import to avoid circular dependency
  const { buildKycReport } = await import('./reportBuilder.js');
  const report = buildKycReport(run.profile!, run.validation!, { includeTrace: true });
  
  // Score for calculations
  const score = run.validation!.score;

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
          <div class="text-green-800 font-medium" style="font-size: 15px; line-height: 1.6;">${t.sidebar.noFlags}</div>
        </div>
      </div>`
    : run.validation!.flags.map(f => {
        const isCritical = f.level === 'critical';
        const isWarning = f.level === 'warning';
        const badgeClass = isCritical ? 'risk-critical' : (isWarning ? 'risk-warning' : 'risk-info');
        const bgClass = isCritical ? 'bg-red-50' : (isWarning ? 'bg-yellow-50' : 'bg-blue-50');
        const borderClass = isCritical ? 'border-red-200' : (isWarning ? 'border-yellow-200' : 'border-blue-200');
        
        const icon = isCritical ? '🔴' : (isWarning ? '⚠️' : 'ℹ️');
        
        return `
          <div class="p-4 mb-3 ${bgClass} border ${borderClass} rounded-lg flex items-start shadow-sm hover:shadow transition-shadow relative overflow-hidden">
            <div class="absolute top-0 left-0 w-1 h-full ${isCritical ? 'bg-red-500' : (isWarning ? 'bg-yellow-500' : 'bg-blue-500')}"></div>
            <span class="text-xl mr-3 mt-0.5">${icon}</span>
            <div class="flex-1">
              <div class="flex items-center mb-1.5">
                 <span class="risk-badge ${badgeClass} mr-2">${f.level.toUpperCase()}</span>
                 <span class="font-mono text-xs text-gray-500">${f.code}</span>
              </div>
              <div class="text-gray-800 font-medium" style="font-size: 14px; line-height: 1.6;">${f.message}</div>
            </div>
          </div>
        `;
      }).join("");

  // Documents Grid
  const docNames: Record<string, { en: string; es: string }> = {
    'acta': { en: 'Acta Constitutiva', es: 'Acta Constitutiva' },
    'sat_constancia': { en: 'SAT Constancia', es: 'Constancia SAT' },
    'fm2': { en: 'FM2 Immigration', es: 'FM2 Residente' },
    'ine': { en: 'INE Voter ID', es: 'INE Credencial' },
    'passport': { en: 'Passport', es: 'Pasaporte' },
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
        'ine': '🪪',
        'passport': '🛂',
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
              <span class="text-xs bg-green-100 text-green-700 px-3 py-1.5 rounded-lg font-medium whitespace-nowrap">✓ ${t.sidebar.processed}</span>
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
        processed.push(`<h3 class="text-lg font-semibold text-gray-900 mt-8 mb-5 pb-2 border-b border-gray-300 break-words" style="font-size: 18px; line-height: 1.4; padding-bottom: 8px;">${line.substring(4)}</h3>`);
        continue;
      }
      if (line.startsWith('## ')) {
        processed.push(`<h2 class="text-xl font-bold text-gray-900 mt-10 mb-6 break-words" style="font-size: 20px; line-height: 1.3;">${line.substring(3)}</h2>`);
        continue;
      }
      if (line.startsWith('# ')) {
        processed.push(`<h1 class="text-2xl font-bold text-gray-900 mt-10 mb-6 break-words" style="font-size: 24px; line-height: 1.3;">${line.substring(2)}</h1>`);
        continue;
      }
      
      // Lists
      if (line.startsWith('- ')) {
        const content = line.substring(2);
        // Handle bold labels
        const boldMatch = content.match(/^\*\*(.*?):\*\*\s*(.*)$/);
        if (boldMatch) {
          processed.push(`<li class="mb-3 break-words pl-1" style="font-size: 15px; line-height: 1.8;"><span class="font-semibold text-gray-900">${boldMatch[1]}:</span> <span class="text-gray-700">${boldMatch[2]}</span></li>`);
        } else {
          // Handle bold only
          const boldOnly = content.replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-gray-900">$1</strong>');
          processed.push(`<li class="mb-3 text-gray-700 break-words pl-1" style="font-size: 15px; line-height: 1.8;">${boldOnly}</li>`);
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
        processed.push(`<p class="mb-5 text-gray-700 break-words" style="font-size: 15px; line-height: 1.8;">${text}</p>`);
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
        return `<ul class="list-disc list-inside space-y-2 my-5 ml-5 pl-2" style="line-height: 1.8;">${match}</ul>`;
      }
      return match;
    });
    
    return html;
  }

  // Section title translations (Spanish-only)
  const sectionTitles: Record<string, string> = {
    "I. HECHOS EXTRAÍDOS": t.sections.extractedFacts,
    "II. CONCLUSIONES DE KYC": t.sections.kycConclusions,
    "III. FLAGS Y RIESGOS": t.sections.riskFlags,
    "IV. TRAZA Y JUSTIFICACIÓN": t.sections.traceability
  };

  // Report Sections (Spanish-only)
  const sectionsHtml = report.sections.map(s => {
      const body = markdownToHtml(s.body);
      const sectionTitle = sectionTitles[s.title] || s.title;
      
      return `
        <div class="fluent-card rounded-xl shadow-md border border-gray-200 p-10 mb-8 hover:shadow-lg transition-all section-card" style="margin-bottom: 2rem;">
            <h2 class="text-2xl font-semibold text-gray-900 mb-6 pb-4 border-b-2 border-blue-300 break-words" style="font-size: 22px; line-height: 1.4; padding-bottom: 12px;">
              ${sectionTitle}
            </h2>
            <div class="text-gray-700 prose prose-sm max-w-none" style="font-size: 15px; line-height: 1.8;">
                ${body}
            </div>
        </div>
      `;
  }).join("");

  // Build Executive Summary Data
  // FM2/INE (Immigration document)
  const repIdentityName = run.profile!.representativeIdentity?.full_name || run.profile!.passportIdentity?.full_name || null;
  const repDocType = run.profile!.representativeIdentity?.document_type || null;
  const repDocNumber = run.profile!.representativeIdentity?.document_number || null;
  const repCurp = run.profile!.representativeIdentity?.curp || null;
  
  // Passport (Primary identity for foreigners)
  // passportName is same as repIdentityName when no FM2 - used in name matching
  const passportNumber = run.profile!.passportIdentity?.document_number || null;
  const passportNationality = run.profile!.passportIdentity?.nationality || null;
  const passportExpiry = run.profile!.passportIdentity?.expiry_date || null;
  const passportIssuer = run.profile!.passportIdentity?.issuer_country || null;
  
  // Check if foreigner (has passport from non-MX country)
  const isForeignNational = passportIssuer && passportIssuer !== 'MX' && passportIssuer !== 'MEXICO';
  
  // Find matching signatory in Acta
  const legalReps = run.profile!.companyIdentity?.legal_representatives || [];
  const namesMatchFn = (name1: string, name2: string): boolean => {
      if (!name1 || !name2) return false;
      const normalize = (n: string) => n.toUpperCase().trim().replace(/\s+/g, ' ');
      const n1 = normalize(name1);
      const n2 = normalize(name2);
      if (n1 === n2) return true;
      const tokens1 = new Set(n1.split(' ').filter(t => t.length > 1));
      const tokens2 = new Set(n2.split(' ').filter(t => t.length > 1));
      const [smaller, larger] = tokens1.size <= tokens2.size ? [tokens1, tokens2] : [tokens2, tokens1];
      let matchCount = 0;
      for (const token of smaller) {
          if (larger.has(token)) matchCount++;
      }
      return smaller.size > 0 && matchCount === smaller.size;
  };
  
  const matchedRep = repIdentityName ? legalReps.find(r => namesMatchFn(r.name || '', repIdentityName)) : null;
  const otherReps = repIdentityName ? legalReps.filter(r => !namesMatchFn(r.name || '', repIdentityName)) : legalReps;
  
  // Determine power scope for matched rep
  const getPowerScope = (rep: any): { scope: string; label: string; color: string } => {
      if (!rep || !rep.poder_scope) return { scope: 'none', label: 'Sin Poderes', color: 'gray' };
      const scope = Array.isArray(rep.poder_scope) ? rep.poder_scope.join(' ').toUpperCase() : String(rep.poder_scope).toUpperCase();
      const hasPleitos = /PLEITOS?/.test(scope);
      const hasAdmin = /ADMINISTRACI[ÓO]N/.test(scope);
      const hasDominio = /DOMINIO/.test(scope);
      const hasTitulos = /T[ÍI]TULOS?/.test(scope);
      if (hasPleitos && hasAdmin && hasDominio && hasTitulos) {
          return { scope: 'full', label: 'Poderes Amplios', color: 'green' };
      } else if (hasPleitos || hasAdmin || hasDominio || hasTitulos) {
          return { scope: 'limited', label: 'Poderes Limitados', color: 'yellow' };
      }
      return { scope: 'none', label: 'Sin Poderes', color: 'gray' };
  };
  
  const matchedPowerInfo = matchedRep ? getPowerScope(matchedRep) : null;
  
  // ========== ENTITY TYPE CLASSIFICATION ==========
  // Use the new comprehensive classification system that considers:
  // 1. RFC pattern (4 letters = individual, 3 letters = corporate)
  // 2. Tax regime from SAT Constancia
  // 3. Presence of Acta Constitutiva
  // 
  // Three types:
  // - PERSONA_MORAL: Corporate entity (e.g., PFDS SAPI DE CV)
  // - PERSONA_FISICA_EMPRESARIAL: Individual with business (e.g., freelancer)
  // - PERSONA_FISICA_SIN_OBLIGACIONES: Individual without tax obligations (e.g., Enrique Cello)
  const entityTypeClassification: EntityType = classifyEntityType(run.profile!);
  const isPersonaFisica = entityTypeClassification === 'PERSONA_FISICA_EMPRESARIAL' || 
                          entityTypeClassification === 'PERSONA_FISICA_SIN_OBLIGACIONES';
  
  // Get the proper onboarding label based on entity type
  const clientOnboardingLabel = getClientOnboardingLabel(entityTypeClassification);
  
  // Determine if the verified person CAN SIGN
  // For Persona Física: If identity is verified, they CAN sign (they are the business)
  // For Persona Moral: Need to match against Acta and have powers
  const canSign = isPersonaFisica 
      ? !!repIdentityName  // PF: Identity verified = can sign
      : (matchedRep && matchedPowerInfo?.scope === 'full');  // PM: Need full powers
  const canSignLimited = !isPersonaFisica && matchedRep && matchedPowerInfo?.scope === 'limited';
  
  // ========== CRITICAL ALERT DETECTION ==========
  // If there are critical flags, show alert banner FIRST in the story
  const criticalFlags = run.validation!.flags.filter(f => f.level === 'critical');
  const warningFlags = run.validation!.flags.filter(f => f.level === 'warning');
  const hasCriticalIssues = criticalFlags.length > 0;
  
  // Build alert banner HTML (shown at top if critical issues exist)
  const alertBannerHtml = hasCriticalIssues ? `
    <div class="exec-alert-banner exec-alert-critical">
        <div class="exec-alert-icon">🚨</div>
        <div class="exec-alert-content">
            <div class="exec-alert-title">ALERTA CRÍTICA - Documentación Inconsistente</div>
            <div class="exec-alert-message">${criticalFlags[0].message}</div>
            <div class="exec-alert-action">
                <strong>Acción Requerida:</strong> No proceder con el alta hasta resolver esta inconsistencia. 
                Verificar que todos los documentos correspondan a la misma entidad legal.
            </div>
        </div>
    </div>
  ` : warningFlags.length > 0 ? `
    <div class="exec-alert-banner exec-alert-warning">
        <div class="exec-alert-icon">⚠️</div>
        <div class="exec-alert-content">
            <div class="exec-alert-title">Observaciones Pendientes</div>
            <div class="exec-alert-message">${warningFlags.map(f => f.message).join(' | ')}</div>
        </div>
    </div>
  ` : '';
  
  // ========== ENTITY HEADER - Shows at VERY TOP ==========
  // This immediately tells the user WHAT entity they're looking at
  // Use the proper entity type label based on classification
  const entityTypeLabels: Record<EntityType, string> = {
    'PERSONA_MORAL': 'Persona Moral',
    'PERSONA_FISICA_EMPRESARIAL': 'Persona Física (Empresarial)',
    'PERSONA_FISICA_SIN_OBLIGACIONES': 'Persona Física (Sin Actividad)',
    'UNKNOWN': 'Tipo Desconocido'
  };
  const entityType = entityTypeLabels[entityTypeClassification] || 'Persona';
  const entityName = companyName;
  const entityStatus = run.validation!.score >= 0.9 ? 'APROBADO' : (run.validation!.score >= 0.7 ? 'EN REVISIÓN' : 'RECHAZADO');
  const entityStatusClass = run.validation!.score >= 0.9 ? 'approved' : (run.validation!.score >= 0.7 ? 'review' : 'rejected');
  
  const entityHeaderHtml = `
    <div class="entity-header">
        <div class="entity-header-main">
            <div class="entity-type-badge ${isPersonaFisica ? 'entity-type-pf' : 'entity-type-pm'}">
                ${isPersonaFisica ? '👤' : '🏢'} ${entityType}
            </div>
            <h1 class="entity-name">${entityName}</h1>
            <div class="entity-rfc">RFC: <strong>${rfc}</strong></div>
        </div>
        <div class="entity-header-status">
            <div class="entity-status-badge entity-status-${entityStatusClass}">
                ${entityStatus}
            </div>
            <div class="entity-score">Puntuación: ${Math.round(run.validation!.score * 100)}%</div>
        </div>
    </div>
  `;
  
  // Executive Summary HTML - Redesigned for clarity on WHO CAN SIGN
  // DIFFERENT LOGIC FOR PERSONA FÍSICA vs PERSONA MORAL
  const executiveSummaryHtml = entityHeaderHtml + alertBannerHtml + (isPersonaFisica ? `
    <!-- ========== PERSONA FÍSICA LAYOUT ========== -->
    <div class="exec-summary-grid">
        <!-- PRIMARY: Signing Authority Card - PERSONA FÍSICA -->
        <div class="exec-card exec-card-success">
            <div class="exec-card-header">
                <span class="exec-icon">✍️</span>
                <span class="exec-title">¿Quién Puede Firmar?</span>
            </div>
            <div class="exec-card-body">
                ${repIdentityName ? `
                    <div class="exec-signing-authority">
                        <div class="exec-main-value">${repIdentityName}</div>
                        
                        <!-- Identity Documents Section for Persona Física -->
                        <div class="exec-identity-docs">
                            ${passportNumber ? `
                                <div class="exec-doc-item exec-doc-passport">
                                    <span class="exec-doc-icon">🛂</span>
                                    <span class="exec-doc-label">Pasaporte:</span>
                                    <span class="exec-doc-value">${passportNumber}</span>
                                    <span class="exec-doc-detail">(${passportNationality || 'N/A'}, vence: ${passportExpiry || 'N/A'})</span>
                                </div>
                            ` : ''}
                            ${repDocType && repDocNumber ? `
                                <div class="exec-doc-item exec-doc-fm2">
                                    <span class="exec-doc-icon">🪪</span>
                                    <span class="exec-doc-label">${repDocType}:</span>
                                    <span class="exec-doc-value">${repDocNumber}</span>
                                    ${repCurp ? `<span class="exec-doc-detail">(CURP: ${repCurp})</span>` : ''}
                                </div>
                            ` : ''}
                            ${!passportNumber && !repDocNumber ? `
                                <div class="exec-doc-item">
                                    <span class="exec-doc-icon">📄</span>
                                    <span class="exec-doc-label">Documento:</span>
                                    <span class="exec-doc-value">Pendiente de verificación</span>
                                </div>
                            ` : ''}
                        </div>
                        
                        <div class="exec-can-sign-badge exec-can-sign-yes">
                            <span class="exec-can-sign-icon">✅</span>
                            <span class="exec-can-sign-text">PUEDE FIRMAR</span>
                        </div>
                        <div class="exec-power-detail">
                            <strong>Persona Física:</strong> El titular firma en nombre propio. No requiere Acta Constitutiva ni poderes notariales.
                        </div>
                        
                        <div class="exec-role-compact">
                            <span class="exec-role-label">Calidad:</span>
                            <span class="exec-role-value">Titular / Propietario</span>
                        </div>
                    </div>
                ` : `
                    <div class="exec-main-value text-gray-400">Sin documento de identidad</div>
                    <div class="exec-can-sign-badge exec-can-sign-no">
                        <span class="exec-can-sign-icon">❌</span>
                        <span class="exec-can-sign-text">FALTA IDENTIFICACIÓN</span>
                    </div>
                    <div class="exec-power-detail">
                        <strong>Requerido:</strong> INE, Pasaporte, o FM2 para verificar identidad
                    </div>
                `}
            </div>
        </div>
        
        <!-- SECONDARY: Persona Física Info Card -->
        <div class="exec-card">
            <div class="exec-card-header">
                <span class="exec-icon">📋</span>
                <span class="exec-title">Régimen Fiscal</span>
            </div>
            <div class="exec-card-body">
                <div class="exec-info-note">ℹ️ ${clientOnboardingLabel}</div>
                <div class="exec-pf-info">
                    <div class="exec-pf-item">
                        <span class="exec-pf-label">RFC:</span>
                        <span class="exec-pf-value">${rfc}</span>
                    </div>
                    <div class="exec-pf-item">
                        <span class="exec-pf-label">Régimen:</span>
                        <span class="exec-pf-value">${run.profile!.companyTaxProfile?.tax_regime || 'No especificado'}</span>
                    </div>
                    <div class="exec-pf-item">
                        <span class="exec-pf-label">Estatus SAT:</span>
                        <span class="exec-pf-value exec-pf-status-${run.profile!.companyTaxProfile?.status === 'ACTIVO' ? 'active' : 'inactive'}">${run.profile!.companyTaxProfile?.status || 'Desconocido'}</span>
                    </div>
                </div>
                <div class="exec-pf-note">
                    <strong>Nota Legal:</strong> Como Persona Física, no existe Acta Constitutiva. La capacidad jurídica se acredita con identificación oficial vigente.
                </div>
            </div>
        </div>
    ` : `
    <!-- ========== PERSONA MORAL LAYOUT ========== -->
    <div class="exec-summary-grid">
        <!-- PRIMARY: Signing Authority Card - PERSONA MORAL -->
        <div class="exec-card ${canSign ? 'exec-card-success' : (canSignLimited ? 'exec-card-warning' : 'exec-card-danger')}">
            <div class="exec-card-header">
                <span class="exec-icon">✍️</span>
                <span class="exec-title">¿Quién Puede Firmar?</span>
            </div>
            <div class="exec-card-body">
                ${matchedRep && repIdentityName ? `
                    <div class="exec-signing-authority">
                        <div class="exec-main-value">${repIdentityName}</div>
                        
                        <!-- Identity Documents Section -->
                        <div class="exec-identity-docs">
                            ${passportNumber ? `
                                <div class="exec-doc-item exec-doc-passport">
                                    <span class="exec-doc-icon">🛂</span>
                                    <span class="exec-doc-label">Pasaporte:</span>
                                    <span class="exec-doc-value">${passportNumber}</span>
                                    <span class="exec-doc-detail">(${passportNationality || 'N/A'}, vence: ${passportExpiry || 'N/A'})</span>
                                </div>
                            ` : ''}
                            ${repDocType && repDocNumber ? `
                                <div class="exec-doc-item exec-doc-fm2">
                                    <span class="exec-doc-icon">🪪</span>
                                    <span class="exec-doc-label">${repDocType}:</span>
                                    <span class="exec-doc-value">${repDocNumber}</span>
                                    ${repCurp ? `<span class="exec-doc-detail">(CURP: ${repCurp})</span>` : ''}
                                </div>
                            ` : ''}
                        </div>
                        
                        ${isForeignNational && !repDocType ? `
                            <div class="exec-warning-badge">
                                <span class="exec-warning-icon">⚠️</span>
                                <span class="exec-warning-text">Extranjero sin FM2/FM3 - Documento migratorio requerido</span>
                            </div>
                        ` : ''}
                        
                        ${canSign ? `
                            <div class="exec-can-sign-badge exec-can-sign-yes">
                                <span class="exec-can-sign-icon">✅</span>
                                <span class="exec-can-sign-text">PUEDE FIRMAR</span>
                            </div>
                            <div class="exec-power-detail">
                                <strong>Facultades:</strong> Poderes Amplios (Administración, Dominio, Pleitos, Títulos)
                            </div>
                        ` : canSignLimited ? `
                            <div class="exec-can-sign-badge exec-can-sign-limited">
                                <span class="exec-can-sign-icon">⚠️</span>
                                <span class="exec-can-sign-text">FIRMA LIMITADA</span>
                            </div>
                            <div class="exec-power-detail">
                                <strong>Facultades:</strong> Poderes Limitados - verificar alcance para este contrato
                            </div>
                        ` : `
                            <div class="exec-can-sign-badge exec-can-sign-no">
                                <span class="exec-can-sign-icon">❌</span>
                                <span class="exec-can-sign-text">SIN FACULTADES</span>
                            </div>
                            <div class="exec-power-detail">
                                <strong>Alerta:</strong> Esta persona no tiene poderes para firmar contratos
                            </div>
                        `}
                        
                        <div class="exec-role-compact">
                            <span class="exec-role-label">Cargo:</span>
                            <span class="exec-role-value">${matchedRep.role || 'Apoderado'}</span>
                        </div>
                    </div>
                ` : repIdentityName ? `
                    <div class="exec-signing-authority">
                        <div class="exec-main-value">${repIdentityName}</div>
                        <div class="exec-sub-value">${repDocType || 'Documento'} ${repDocNumber ? `(${repDocNumber})` : ''}</div>
                        <div class="exec-can-sign-badge exec-can-sign-no">
                            <span class="exec-can-sign-icon">⚠️</span>
                            <span class="exec-can-sign-text">NO VERIFICADO EN ACTA</span>
                        </div>
                        <div class="exec-power-detail">
                            <strong>Alerta:</strong> Identidad verificada pero no aparece en el Acta Constitutiva. Verificar poderes notariales.
                        </div>
                    </div>
                ` : `
                    <div class="exec-main-value text-gray-400">Sin documento de identidad</div>
                    <div class="exec-can-sign-badge exec-can-sign-no">
                        <span class="exec-can-sign-icon">❌</span>
                        <span class="exec-can-sign-text">NO SE PUEDE VERIFICAR</span>
                    </div>
                `}
            </div>
        </div>
        
        <!-- SECONDARY: Other Authorized Signatories (Informational) - PERSONA MORAL ONLY -->
        <div class="exec-card">
            <div class="exec-card-header">
                <span class="exec-icon">👥</span>
                <span class="exec-title">Otros Autorizados en Acta</span>
            </div>
            <div class="exec-card-body">
                <div class="exec-info-note">ℹ️ Personas con facultades según el Acta (no verificadas con ID)</div>
                ${otherReps.length > 0 ? `
                    <div class="exec-signatory-list">
                        ${otherReps.slice(0, 4).map(r => {
                            const power = getPowerScope(r);
                            return `
                                <div class="exec-signatory-item">
                                    <span class="exec-signatory-name">${r.name || 'N/A'}</span>
                                    <span class="exec-signatory-role">${r.role || 'Rol desconocido'}</span>
                                    <span class="exec-power-mini exec-power-${power.color}">${power.label}</span>
                                </div>
                            `;
                        }).join('')}
                        ${otherReps.length > 4 ? `<div class="exec-more">+${otherReps.length - 4} más...</div>` : ''}
                    </div>
                ` : `
                    <div class="exec-empty">No hay otros firmantes registrados</div>
                `}
            </div>
        </div>
        
        <!-- Quick Status Card - Simplified (RFC now in header) -->
        <div class="exec-card">
            <div class="exec-card-header">
                <span class="exec-icon">✅</span>
                <span class="exec-title">Checklist Rápido</span>
            </div>
            <div class="exec-card-body">
                <div class="exec-checklist">
                    <div class="exec-check-item ${run.documents.length >= 3 ? 'exec-check-pass' : 'exec-check-warn'}">
                        <span class="exec-check-icon">${run.documents.length >= 3 ? '✓' : '⚠️'}</span>
                        <span class="exec-check-text">Documentos: ${run.documents.length} procesados</span>
                    </div>
                    <div class="exec-check-item ${run.validation!.flags.length === 0 ? 'exec-check-pass' : (run.validation!.flags.filter(f => f.level === 'critical').length > 0 ? 'exec-check-fail' : 'exec-check-warn')}">
                        <span class="exec-check-icon">${run.validation!.flags.length === 0 ? '✓' : '⚠️'}</span>
                        <span class="exec-check-text">Banderas: ${run.validation!.flags.length === 0 ? 'Sin observaciones' : run.validation!.flags.length + ' pendiente(s)'}</span>
                    </div>
                    <div class="exec-check-item ${run.profile!.currentOperationalAddress ? 'exec-check-pass' : 'exec-check-fail'}">
                        <span class="exec-check-icon">${run.profile!.currentOperationalAddress ? '✓' : '❌'}</span>
                        <span class="exec-check-text">Domicilio: ${run.profile!.currentOperationalAddress ? 'Verificado' : 'Pendiente'}</span>
                    </div>
                    <div class="exec-check-item ${run.profile!.companyTaxProfile?.status === 'ACTIVO' ? 'exec-check-pass' : 'exec-check-fail'}">
                        <span class="exec-check-icon">${run.profile!.companyTaxProfile?.status === 'ACTIVO' ? '✓' : '❌'}</span>
                        <span class="exec-check-text">SAT: ${run.profile!.companyTaxProfile?.status || 'No verificado'}</span>
                    </div>
                </div>
            </div>
        </div>
    </div>
  `);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${t.print.title} - ${companyName}</title>
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
            line-height: 1.7;
            letter-spacing: 0.01em;
            color: #374151;
        }
        h1, h2, h3, h4, h5, h6 {
            font-weight: 600;
            letter-spacing: -0.02em;
            line-height: 1.4;
            margin-top: 1.5em;
            margin-bottom: 0.75em;
        }
        p, li, td, th {
            font-size: 15px;
            line-height: 1.8;
            letter-spacing: 0.01em;
        }
        ul, ol {
            margin-top: 1em;
            margin-bottom: 1.5em;
        }
        li {
            margin-bottom: 0.5em;
        }
        
        /* IMPROVED TABLE STYLES - No text cutoff */
        table { 
            border-collapse: separate; 
            border-spacing: 0; 
            width: 100%;
            table-layout: auto;
        }
        table thead th { 
            background: linear-gradient(to bottom, #1e3a5f, #2d4a6f);
            color: #ffffff !important;
            font-weight: 600;
            text-transform: uppercase;
            font-size: 0.75rem;
            text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
            letter-spacing: 0.05em;
            color: #ffffff;
            line-height: 1.5;
            padding: 14px 16px;
            text-align: left;
            white-space: nowrap;
            border-bottom: 2px solid #0d2137;
        }
        table tbody tr:nth-child(even) { background-color: #f8fafc; }
        table tbody tr:hover { background-color: #e0f2fe; }
        table td {
            font-size: 14px;
            line-height: 1.6;
            padding: 14px 16px;
            vertical-align: top;
            border-bottom: 1px solid #e5e7eb;
        }
        /* Allow text wrapping in table cells */
        table td, table th {
            word-wrap: break-word;
            overflow-wrap: break-word;
            max-width: none;
            min-width: 80px;
        }
        /* Specific column widths for better layout */
        table td:first-child { min-width: 150px; }
        table td:last-child { min-width: 200px; }
        
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
        p, li { word-break: break-word; hyphens: auto; }
        
        /* Ensure proper spacing */
        .section-card h2 { line-height: 1.3; }
        .section-card h3 { line-height: 1.4; }
        
        /* Metadata Footer/Sidebar Style */
        .metadata-section {
            font-size: 0.8rem;
            color: #6b7280;
            background: #f9fafb;
            border-top: 1px solid #e5e7eb;
            padding: 1rem;
            margin-top: 2rem;
            border-radius: 0 0 0.5rem 0.5rem;
        }

        .risk-badge {
            display: inline-flex;
            align-items: center;
            padding: 0.35rem 0.85rem;
            border-radius: 9999px;
            font-weight: 600;
            font-size: 0.8rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .risk-critical { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
        .risk-warning { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }
        .risk-info { background: #eff6ff; color: #1e40af; border: 1px solid #dbeafe; }

        /* Windows Fluent Design */
        .fluent-card {
            background: rgba(255, 255, 255, 0.95);
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
        
        /* ========== ENTITY HEADER - TOP OF REPORT ========== */
        .entity-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 1.5rem 2rem;
            margin-bottom: 1.5rem;
            background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #1e40af 100%);
            border-radius: 16px;
            color: white;
            box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.3);
        }
        .entity-header-main {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
        }
        .entity-type-badge {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.85rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            padding: 0.35rem 0.75rem;
            border-radius: 20px;
            width: fit-content;
        }
        .entity-type-pm {
            background: rgba(59, 130, 246, 0.3);
            color: #93c5fd;
            border: 1px solid rgba(147, 197, 253, 0.3);
        }
        .entity-type-pf {
            background: rgba(16, 185, 129, 0.3);
            color: #6ee7b7;
            border: 1px solid rgba(110, 231, 183, 0.3);
        }
        .entity-name {
            font-size: 1.75rem;
            font-weight: 700;
            color: white;
            margin: 0.25rem 0;
            letter-spacing: -0.02em;
            text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }
        .entity-rfc {
            font-size: 1rem;
            color: #cbd5e1;
            font-family: 'Monaco', 'Menlo', monospace;
        }
        .entity-rfc strong {
            color: #f1f5f9;
            font-weight: 600;
        }
        .entity-header-status {
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            gap: 0.5rem;
        }
        .entity-status-badge {
            font-size: 1rem;
            font-weight: 700;
            padding: 0.5rem 1.25rem;
            border-radius: 8px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .entity-status-approved {
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            color: white;
            box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
        }
        .entity-status-review {
            background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
            color: white;
            box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4);
        }
        .entity-status-rejected {
            background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
            color: white;
            box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4);
        }
        .entity-score {
            font-size: 0.85rem;
            color: #94a3b8;
        }
        
        /* ========== EXECUTIVE SUMMARY STYLES ========== */
        .exec-summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 1.5rem;
            margin-bottom: 2rem;
        }
        .exec-card {
            background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
            border: 1px solid #e2e8f0;
            border-radius: 16px;
            padding: 1.5rem;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
            transition: all 0.2s ease;
        }
        .exec-card:hover {
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.08), 0 4px 6px -2px rgba(0, 0, 0, 0.04);
            transform: translateY(-2px);
        }
        .exec-card-success {
            border-left: 4px solid #10b981;
            background: linear-gradient(135deg, #f0fdf4 0%, #ffffff 100%);
        }
        .exec-card-warning {
            border-left: 4px solid #f59e0b;
            background: linear-gradient(135deg, #fffbeb 0%, #ffffff 100%);
        }
        .exec-card-header {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            margin-bottom: 1rem;
            padding-bottom: 0.75rem;
            border-bottom: 1px solid #e5e7eb;
        }
        .exec-icon {
            font-size: 1.5rem;
        }
        .exec-title {
            font-weight: 600;
            font-size: 1rem;
            color: #1e293b;
            letter-spacing: -0.01em;
        }
        .exec-card-body {
            min-height: 120px;
        }
        .exec-main-value {
            font-size: 1.25rem;
            font-weight: 700;
            color: #0f172a;
            margin-bottom: 0.25rem;
        }
        .exec-sub-value {
            font-size: 0.875rem;
            color: #64748b;
            margin-bottom: 0.75rem;
        }
        /* Identity Documents Section */
        .exec-identity-docs {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
            margin: 0.75rem 0;
            padding: 0.75rem;
            background: #f8fafc;
            border-radius: 8px;
            border: 1px solid #e2e8f0;
        }
        .exec-doc-item {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.875rem;
        }
        .exec-doc-icon {
            font-size: 1rem;
        }
        .exec-doc-label {
            font-weight: 600;
            color: #475569;
        }
        .exec-doc-value {
            font-family: 'Monaco', 'Menlo', monospace;
            font-weight: 600;
            color: #0f172a;
        }
        .exec-doc-detail {
            font-size: 0.75rem;
            color: #64748b;
        }
        .exec-doc-passport {
            padding-bottom: 0.5rem;
            border-bottom: 1px dashed #e2e8f0;
        }
        .exec-warning-badge {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.5rem 0.75rem;
            background: #fef3c7;
            border: 1px solid #fde68a;
            border-radius: 6px;
            margin: 0.5rem 0;
        }
        .exec-warning-icon {
            font-size: 1rem;
        }
        .exec-warning-text {
            font-size: 0.8rem;
            font-weight: 500;
            color: #92400e;
        }
        .exec-match-badge {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.5rem 1rem;
            border-radius: 8px;
            font-size: 0.875rem;
            font-weight: 600;
            margin-bottom: 1rem;
        }
        .exec-match-success {
            background: #dcfce7;
            color: #166534;
            border: 1px solid #86efac;
        }
        .exec-match-warning {
            background: #fef3c7;
            color: #92400e;
            border: 1px solid #fde68a;
        }
        /* NEW: Signing Authority Styles */
        .exec-card-danger {
            border-left: 4px solid #ef4444;
        }
        .exec-signing-authority {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
        }
        .exec-can-sign-badge {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.75rem 1rem;
            border-radius: 8px;
            margin: 0.5rem 0;
        }
        .exec-can-sign-yes {
            background: linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%);
            border: 2px solid #22c55e;
        }
        .exec-can-sign-limited {
            background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
            border: 2px solid #f59e0b;
        }
        .exec-can-sign-no {
            background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%);
            border: 2px solid #ef4444;
        }
        .exec-can-sign-icon {
            font-size: 1.5rem;
        }
        .exec-can-sign-text {
            font-size: 1rem;
            font-weight: 700;
            letter-spacing: 0.05em;
        }
        .exec-can-sign-yes .exec-can-sign-text { color: #166534; }
        .exec-can-sign-limited .exec-can-sign-text { color: #92400e; }
        .exec-can-sign-no .exec-can-sign-text { color: #991b1b; }
        .exec-power-detail {
            font-size: 0.85rem;
            color: #475569;
            padding: 0.5rem;
            background: #f8fafc;
            border-radius: 6px;
        }
        .exec-role-compact {
            display: flex;
            gap: 0.5rem;
            font-size: 0.85rem;
            color: #64748b;
        }
        .exec-role-compact .exec-role-label {
            font-weight: 500;
        }
        .exec-role-compact .exec-role-value {
            font-weight: 600;
            color: #1e293b;
        }
        .exec-info-note {
            font-size: 0.75rem;
            color: #64748b;
            margin-bottom: 0.75rem;
            padding: 0.5rem;
            background: #f1f5f9;
            border-radius: 4px;
        }
        /* Critical Alert Banner - Shows at TOP of Executive Summary */
        .exec-alert-banner {
            display: flex;
            align-items: flex-start;
            gap: 1rem;
            padding: 1.25rem 1.5rem;
            border-radius: 12px;
            margin-bottom: 1.5rem;
            animation: alertPulse 2s ease-in-out infinite;
        }
        @keyframes alertPulse {
            0%, 100% { box-shadow: 0 4px 15px rgba(239, 68, 68, 0.2); }
            50% { box-shadow: 0 4px 25px rgba(239, 68, 68, 0.4); }
        }
        .exec-alert-critical {
            background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%);
            border: 2px solid #ef4444;
            border-left: 6px solid #dc2626;
        }
        .exec-alert-warning {
            background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
            border: 2px solid #f59e0b;
            border-left: 6px solid #d97706;
            animation: none;
        }
        .exec-alert-icon {
            font-size: 2rem;
            flex-shrink: 0;
        }
        .exec-alert-content {
            flex: 1;
        }
        .exec-alert-title {
            font-size: 1.1rem;
            font-weight: 700;
            color: #991b1b;
            margin-bottom: 0.5rem;
            text-transform: uppercase;
            letter-spacing: 0.03em;
        }
        .exec-alert-warning .exec-alert-title {
            color: #92400e;
        }
        .exec-alert-message {
            font-size: 0.95rem;
            color: #7f1d1d;
            line-height: 1.5;
            margin-bottom: 0.75rem;
        }
        .exec-alert-warning .exec-alert-message {
            color: #78350f;
        }
        .exec-alert-action {
            font-size: 0.85rem;
            color: #991b1b;
            padding: 0.75rem;
            background: rgba(255, 255, 255, 0.7);
            border-radius: 8px;
            border: 1px solid #fecaca;
        }
        .exec-alert-warning .exec-alert-action {
            color: #92400e;
            border-color: #fde68a;
        }
        
        /* Persona Física specific styles */
        .exec-pf-info {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
            margin-bottom: 1rem;
        }
        .exec-pf-item {
            display: flex;
            justify-content: space-between;
            padding: 0.5rem;
            background: #f8fafc;
            border-radius: 6px;
            border: 1px solid #e2e8f0;
        }
        .exec-pf-label {
            font-size: 0.85rem;
            color: #64748b;
            font-weight: 500;
        }
        .exec-pf-value {
            font-size: 0.85rem;
            color: #1e293b;
            font-weight: 600;
        }
        .exec-pf-status-active {
            color: #166534;
            background: #dcfce7;
            padding: 0.15rem 0.5rem;
            border-radius: 4px;
        }
        .exec-pf-status-inactive {
            color: #991b1b;
            background: #fee2e2;
            padding: 0.15rem 0.5rem;
            border-radius: 4px;
        }
        .exec-pf-note {
            font-size: 0.8rem;
            color: #475569;
            padding: 0.75rem;
            background: linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%);
            border-radius: 8px;
            border-left: 3px solid #3b82f6;
            margin-top: 0.5rem;
        }
        
        /* Checklist Styles */
        .exec-checklist {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
        }
        .exec-check-item {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            padding: 0.6rem 0.75rem;
            border-radius: 8px;
            font-size: 0.9rem;
        }
        .exec-check-pass {
            background: #f0fdf4;
            border: 1px solid #bbf7d0;
        }
        .exec-check-pass .exec-check-icon {
            color: #16a34a;
            font-weight: 700;
        }
        .exec-check-pass .exec-check-text {
            color: #166534;
        }
        .exec-check-warn {
            background: #fffbeb;
            border: 1px solid #fde68a;
        }
        .exec-check-warn .exec-check-icon {
            color: #d97706;
        }
        .exec-check-warn .exec-check-text {
            color: #92400e;
        }
        .exec-check-fail {
            background: #fef2f2;
            border: 1px solid #fecaca;
        }
        .exec-check-fail .exec-check-icon {
            color: #dc2626;
        }
        .exec-check-fail .exec-check-text {
            color: #991b1b;
        }
        .exec-check-icon {
            font-size: 1rem;
            width: 1.25rem;
            text-align: center;
        }
        .exec-check-text {
            font-weight: 500;
        }
        .exec-role-box {
            background: #f1f5f9;
            border-radius: 8px;
            padding: 0.75rem 1rem;
        }
        .exec-role-title {
            font-size: 0.75rem;
            color: #64748b;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 0.25rem;
        }
        .exec-role-value {
            font-size: 0.95rem;
            font-weight: 600;
            color: #1e293b;
            margin-bottom: 0.5rem;
        }
        .exec-power-badge {
            display: inline-block;
            padding: 0.25rem 0.75rem;
            border-radius: 9999px;
            font-size: 0.75rem;
            font-weight: 600;
        }
        .exec-power-green { background: #dcfce7; color: #166534; }
        .exec-power-yellow { background: #fef3c7; color: #92400e; }
        .exec-power-gray { background: #f1f5f9; color: #64748b; }
        .exec-signatory-list {
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
        }
        .exec-signatory-item {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 0.5rem;
            padding: 0.5rem;
            background: #f8fafc;
            border-radius: 8px;
            border: 1px solid #e2e8f0;
        }
        .exec-signatory-name {
            font-weight: 600;
            font-size: 0.9rem;
            color: #1e293b;
            flex: 1;
            min-width: 100px;
        }
        .exec-signatory-role {
            font-size: 0.8rem;
            color: #64748b;
        }
        .exec-power-mini {
            padding: 0.15rem 0.5rem;
            border-radius: 4px;
            font-size: 0.7rem;
            font-weight: 600;
        }
        .exec-more {
            font-size: 0.8rem;
            color: #64748b;
            font-style: italic;
        }
        .exec-empty {
            color: #94a3b8;
            font-style: italic;
            font-size: 0.9rem;
        }
        .exec-status-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 0.75rem;
        }
        .exec-status-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0.5rem 0.75rem;
            background: #f8fafc;
            border-radius: 6px;
            border: 1px solid #e2e8f0;
        }
        .exec-status-label {
            font-size: 0.8rem;
            color: #64748b;
        }
        .exec-status-value {
            font-weight: 600;
            font-size: 0.9rem;
        }
        .exec-status-ok { color: #16a34a; }
        .exec-status-warn { color: #d97706; }
        .exec-status-error { color: #dc2626; }
        
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
            button.innerHTML = '✅ ${t.nav.exportExcel}';
            
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
                        🖨️ ${t.nav.print}
                    </button>
                    <button onclick="exportToExcel()" class="fluent-button text-white px-4 py-2 rounded-lg text-sm font-medium transition-all no-print whitespace-nowrap">
                        📊 ${t.nav.exportExcel}
                    </button>
                </div>
            </div>
        </div>
    </nav>

    <div id="report-content" class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        <!-- Executive Summary - Quick Glance for Analysts -->
        <div class="mb-8">
            ${executiveSummaryHtml}
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
                        <span class="break-words">${t.sidebar.riskScore}</span>
                    </h3>
                    <div class="flex flex-col items-center justify-center">
                        <div class="relative w-40 h-40 mb-3">
                            <svg class="w-full h-full transform -rotate-90 score-ring" viewBox="0 0 36 36">
                                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#e5e7eb" stroke-width="2.5" />
                                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="${score > 0.9 ? '#107c10' : (score > 0.7 ? '#ffaa44' : '#d13438')}" stroke-width="2.5" stroke-dasharray="${score * 100}, 100" stroke-linecap="round" />
                            </svg>
                            <div class="absolute inset-3 flex items-center justify-center flex-col">
                                <span class="text-4xl font-semibold text-gray-900" style="font-size: 38px; line-height: 1.2;">${(score * 100).toFixed(0)}</span>
                                <span class="text-xs text-gray-600 uppercase tracking-wider mt-1" style="font-size: 9px; line-height: 1.3; max-width: 80px; text-align: center;">${t.sidebar.trustScore}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Flags -->
                <div class="fluent-card rounded-xl shadow-md border border-gray-200 p-6">
                    <h3 class="text-lg font-semibold text-gray-900 mb-2 flex items-center" style="font-size: 17px; line-height: 1.4;">
                        <svg class="w-5 h-5 mr-2 text-blue-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                        </svg>
                        <span class="break-words">${t.sidebar.complianceFlags}</span>
                    </h3>
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
                        <span class="break-words">${t.sidebar.sourceDocuments}</span>
                    </h3>
                    <div class="space-y-2">
                        ${docs}
                    </div>
                </div>

            </div>

            <!-- Right Column: Detailed Report -->
            <div class="lg:col-span-2 space-y-6">
                ${sectionsHtml}
                
                <!-- Metadata Footer -->
                <div class="metadata-section rounded-lg">
                    <div class="font-semibold mb-2 text-gray-700">Report Metadata</div>
                    <div class="grid grid-cols-2 gap-4 text-xs font-mono">
                        <div>Run ID: ${run.runId}</div>
                        <div>Generated: ${new Date().toISOString()}</div>
                        <div>Customer ID: ${run.customerId}</div>
                        <div>System Version: 1.0.0</div>
                    </div>
                </div>
            </div>

        </div>
    </div>
</body>
</html>`;

  // Upload to S3/R2 if configured, otherwise fall back to file system
  const { uploadReport, isS3Configured } = await import('./s3Storage.js');
  
  if (isS3Configured()) {
    try {
      // Upload to S3 and return signed URL
      const signedUrl = await uploadReport(html, run.customerId, run.runId);
      return signedUrl;
    } catch (error) {
      console.error('Failed to upload report to S3, falling back to file system:', error);
      // Fall through to file system fallback
    }
  }
  
  // Fallback to file system if S3 not configured or upload failed
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
 * Gets the signed URL for a report HTML file (S3) or file:// URL (local).
 * Returns empty string if report doesn't exist.
 */
export async function getReportUrl(customerId: string, runId: string): Promise<string> {
  const { getReportSignedUrl, isS3Configured } = await import('./s3Storage.js');
  
  if (isS3Configured()) {
    try {
      const signedUrl = await getReportSignedUrl(customerId, runId);
      if (signedUrl) {
        return signedUrl;
      }
      // If not found in S3, fall back to file system
    } catch (error) {
      console.error('Failed to get signed URL from S3, falling back to file system:', error);
      // Fall through to file system fallback
    }
  }
  
  // Fallback to file system
  const reportPath = getReportFilePath(customerId, runId);
  try {
    await fs.access(reportPath);
    return `file://${reportPath}`;
  } catch {
    return '';
  }
}

/**
 * Gets the signed URL for the latest report (S3) or file:// URL (local).
 * Returns empty string if no runs exist.
 */
export async function getLatestReportUrl(customerId: string): Promise<string> {
  const run = await loadLatestRun(customerId);
  if (!run) {
    return '';
  }
  return await getReportUrl(customerId, run.runId);
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
    ['Estatus', validation.score >= 0.9 ? t.header.approved : (validation.score >= 0.7 ? t.header.reviewNeeded : t.header.rejected)],
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
      // DOMICILIO SOCIAL: Jurisdiction for shareholder assemblies (may differ from fiscal address - this is legal)
      summaryData.push(['Domicilio Social (Acta) - Para Asambleas', 
        [addr.street, addr.ext_number, addr.colonia, addr.municipio, addr.estado, addr.cp].filter(Boolean).join(', ') || 'Solo jurisdicción especificada']);
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
      // DOMICILIO FISCAL: Tax address registered with SAT (may differ from social address - this is legal)
      summaryData.push(['Domicilio Fiscal (SAT) - Para Obligaciones Fiscales', 
        [addr.street, addr.ext_number, addr.colonia, addr.municipio, addr.estado, addr.cp].filter(Boolean).join(', ')]);
    }
    summaryData.push([]);
  }
  
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');
  
  // Sheet 2: Shareholders / UBO - Enhanced with Share Types and Voting Rights (per Arturo's comments)
  if (profile.companyIdentity?.shareholders && profile.companyIdentity.shareholders.length > 0) {
    const uboData = [
      [
        'Accionista / Shareholder', 
        'Acciones / Shares', 
        'Serie / Series',
        'Tipo / Type',
        'Derecho a Voto / Voting Rights',
        '% Total', 
        '% Voto / Voting %',
        'Es UBO / Is UBO',
        'Notas / Notes'
      ]
    ];
    
    const shareholders = profile.companyIdentity.shareholders;
    const totalShares = shareholders.reduce((sum, s) => sum + (s.shares || 0), 0);
    
    // Calculate total VOTING shares only (Serie A / Ordinarias have voting rights)
    const totalVotingShares = shareholders.reduce((sum, s) => {
      const hasVoting = determineShareholderVotingRights(s);
      return sum + (hasVoting ? (s.shares || 0) : 0);
    }, 0);
    
    shareholders.forEach(sh => {
      const shares = sh.shares || 0;
      const percentage = totalShares > 0 ? (shares / totalShares * 100).toFixed(2) : (sh.percentage || 0).toFixed(2);
      
      // Determine voting rights based on share type
      const hasVotingRights = determineShareholderVotingRights(sh);
      const votingPercentage = hasVotingRights && totalVotingShares > 0 
        ? (shares / totalVotingShares * 100).toFixed(2) 
        : '0.00';
      
      // UBO is determined by VOTING percentage, not total ownership
      const isUbo = hasVotingRights && parseFloat(votingPercentage) > 25;
      
      // Extract share series and type
      const shareSeries = (sh as any).share_series || (sh as any).class || 'No especificada';
      const shareType = (sh as any).share_type || (hasVotingRights ? 'Ordinarias' : 'Preferentes');
      
      // Notes for clarity
      let notes = '';
      if (!hasVotingRights) {
        notes = 'Sin voto en asambleas ordinarias';
      } else if (isUbo) {
        notes = 'Beneficiario Controlador (>25% voto)';
      }
      
      uboData.push([
        sh.name || 'N/A',
        shares.toString(),
        shareSeries,
        shareType,
        hasVotingRights ? 'SÍ' : 'NO',
        `${percentage}%`,
        `${votingPercentage}%`,
        isUbo ? 'SÍ' : 'NO',
        notes
      ]);
    });
    
    // Add summary row
    uboData.push([]);
    uboData.push([
      'TOTALES',
      totalShares.toString(),
      '',
      '',
      '',
      '100%',
      totalVotingShares > 0 ? '100%' : '0%',
      '',
      `Total acciones con voto: ${totalVotingShares}`
    ]);
    
    const uboSheet = XLSX.utils.aoa_to_sheet(uboData);
    XLSX.utils.book_append_sheet(workbook, uboSheet, 'Accionistas-UBO');
  }
  
  // Helper function to determine voting rights (duplicated here for Excel export)
  function determineShareholderVotingRights(shareholder: any): boolean {
    // If explicitly set, use it
    if (shareholder.has_voting_rights === true) return true;
    if (shareholder.has_voting_rights === false) return false;
    
    // Check share_type
    const shareType = (shareholder.share_type || '').toUpperCase();
    if (shareType.includes('PREFERENTE') || shareType.includes('PREFERRED')) return false;
    if (shareType.includes('ORDINARIA') || shareType.includes('ORDINARY')) return true;
    
    // Check share_series
    const series = (shareholder.share_series || shareholder.class || '').toUpperCase();
    if (series.includes('SERIE B') || series.includes('SERIES B') || series === 'B' ||
        series.includes('SERIE II') || series.includes('SERIES II') || series === 'II') {
      return false;
    }
    
    // Default: assume voting rights (conservative for UBO detection)
    return true;
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
  
  // Sheet 4: Identity Documents (Passport, FM2, INE)
  const identityData = [
    ['Documento / Document', 'Campo / Field', 'Valor / Value']
  ];
  
  // Passport Information
  if (profile.passportIdentity) {
    const passport = profile.passportIdentity;
    identityData.push(['--- PASAPORTE / PASSPORT ---', '', '']);
    identityData.push(['Pasaporte', 'Nombre Completo / Full Name', passport.full_name || 'N/A']);
    identityData.push(['Pasaporte', 'Número / Number', passport.document_number || 'N/A']);
    identityData.push(['Pasaporte', 'Nacionalidad / Nationality', passport.nationality || 'N/A']);
    identityData.push(['Pasaporte', 'País Emisor / Issuing Country', passport.issuer_country || 'N/A']);
    identityData.push(['Pasaporte', 'Fecha de Nacimiento / DOB', passport.date_of_birth || 'N/A']);
    identityData.push(['Pasaporte', 'Sexo / Sex', passport.sex || 'N/A']);
    identityData.push(['Pasaporte', 'Lugar de Nacimiento / Place of Birth', passport.place_of_birth || 'N/A']);
    identityData.push(['Pasaporte', 'Fecha de Expedición / Issue Date', passport.issue_date || 'N/A']);
    identityData.push(['Pasaporte', 'Fecha de Vencimiento / Expiry Date', passport.expiry_date || 'N/A']);
    identityData.push(['Pasaporte', 'Autoridad Emisora / Issuing Authority', passport.issuing_authority || 'N/A']);
    if (passport.mrz_line_1) identityData.push(['Pasaporte', 'MRZ Línea 1', passport.mrz_line_1]);
    if (passport.mrz_line_2) identityData.push(['Pasaporte', 'MRZ Línea 2', passport.mrz_line_2]);
    identityData.push(['', '', '']);
  }
  
  // FM2/INE Information
  if (profile.representativeIdentity) {
    const rep = profile.representativeIdentity;
    const docType = rep.document_type?.toUpperCase() || 'FM2/INE';
    identityData.push([`--- ${docType} ---`, '', '']);
    identityData.push([docType, 'Nombre Completo / Full Name', rep.full_name || 'N/A']);
    identityData.push([docType, 'Número de Documento / Document Number', rep.document_number || 'N/A']);
    identityData.push([docType, 'CURP', rep.curp || 'N/A']);
    identityData.push([docType, 'Nacionalidad / Nationality', rep.nationality || 'N/A']);
    identityData.push([docType, 'Fecha de Nacimiento / DOB', rep.date_of_birth || 'N/A']);
    identityData.push([docType, 'Sexo / Sex', rep.sex || 'N/A']);
    if (rep.issue_date) identityData.push([docType, 'Fecha de Expedición / Issue Date', rep.issue_date]);
    if (rep.expiry_date) identityData.push([docType, 'Fecha de Vencimiento / Expiry Date', rep.expiry_date]);
    identityData.push(['', '', '']);
  }
  
  // If no identity documents
  if (!profile.passportIdentity && !profile.representativeIdentity) {
    identityData.push(['N/A', 'N/A', 'No se encontraron documentos de identidad / No identity documents found']);
  }
  
  // Add verification status
  identityData.push(['--- VERIFICACIÓN / VERIFICATION ---', '', '']);
  const hasPassport = !!profile.passportIdentity?.document_number;
  const hasFm2 = !!profile.representativeIdentity?.document_number;
  const passportIssuer = profile.passportIdentity?.issuer_country?.toUpperCase() || '';
  const isForeign = passportIssuer && passportIssuer !== 'MX' && passportIssuer !== 'MEX' && passportIssuer !== 'MEXICO';
  
  if (isForeign) {
    identityData.push(['Verificación', 'Tipo de Persona', 'Extranjero / Foreign National']);
    identityData.push(['Verificación', 'Pasaporte Requerido', hasPassport ? '✓ Presente' : '❌ Faltante']);
    identityData.push(['Verificación', 'FM2/FM3 Requerido', hasFm2 ? '✓ Presente' : '❌ Faltante']);
    identityData.push(['Verificación', 'Cumple Requisitos', (hasPassport && hasFm2) ? '✓ SÍ' : '❌ NO - Faltan documentos']);
  } else {
    identityData.push(['Verificación', 'Tipo de Persona', 'Mexicano / Mexican National']);
    identityData.push(['Verificación', 'INE/Pasaporte', (hasPassport || hasFm2) ? '✓ Presente' : '❌ Faltante']);
    identityData.push(['Verificación', 'Cumple Requisitos', (hasPassport || hasFm2) ? '✓ SÍ' : '❌ NO']);
  }
  
  const identitySheet = XLSX.utils.aoa_to_sheet(identityData);
  XLSX.utils.book_append_sheet(workbook, identitySheet, 'Identidad-Docs');
  
  // Sheet 5: Risk Flags
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
  XLSX.utils.book_append_sheet(workbook, flagsSheet, 'Banderas-Riesgo');
  
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
  // LEGAL NOTE: Domicilio Social (from Acta) may differ from Domicilio Fiscal (from SAT) - this is legally permissible
  const addressData = [
    ['Type / Tipo', 'Legal Purpose / Propósito Legal', 'Street / Calle', 'Number / Número', 'Colonia', 'Municipio', 'Estado', 'Postal Code / CP']
  ];
  
  if (profile.foundingAddress) {
    const addr = profile.foundingAddress;
    // Domicilio Social: Where shareholder assemblies are held (per Acta Constitutiva)
    addressData.push(['Domicilio Social (Acta)', 'Lugar para Asambleas de Accionistas', addr.street || '', addr.ext_number || '', addr.colonia || '', addr.municipio || '', addr.estado || '', addr.cp || '']);
  }
  
  if (profile.currentFiscalAddress) {
    const addr = profile.currentFiscalAddress;
    // Domicilio Fiscal: Tax address registered with SAT
    addressData.push(['Domicilio Fiscal (SAT)', 'Dirección para Obligaciones Fiscales', addr.street || '', addr.ext_number || '', addr.colonia || '', addr.municipio || '', addr.estado || '', addr.cp || '']);
  }
  
  if (profile.currentOperationalAddress) {
    const addr = profile.currentOperationalAddress;
    // Operational address: Where the business actually operates (from bank/utility bills)
    addressData.push(['Domicilio Operativo', 'Ubicación Real de Operaciones', addr.street || '', addr.ext_number || '', addr.colonia || '', addr.municipio || '', addr.estado || '', addr.cp || '']);
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


