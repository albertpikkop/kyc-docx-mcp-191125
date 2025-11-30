/**
 * MCP Tool: generate_kyc_report
 * 
 * PURPOSE: Generate the complete HTML KYC report from validated profile.
 * LOGIC: Report template is FIXED in code. Claude cannot modify format.
 * 
 * Claude's job: Call this tool, present the generated report.
 * This tool's job: Build HTML report using fixed template, return report path.
 */

import * as fs from 'fs';
import * as path from 'path';
import { KycProfile, KycValidationResult } from '../../kyc/types.js';

export interface GenerateReportInput {
  profile: KycProfile;
  validation: KycValidationResult;
  comisario?: any;
  shareholder_history?: any[];
  output_folder?: string;
}

export interface GenerateReportResult {
  success: boolean;
  report_path: string;
  report_url: string;
  customer_id: string;
  generation_timestamp: string;
}

/**
 * MAIN TOOL FUNCTION
 * 
 * Input: Validated profile data
 * Output: Path to generated HTML report
 * 
 * Claude CANNOT modify report template. Report format is fixed.
 */
export async function generateKycReport(input: GenerateReportInput): Promise<GenerateReportResult> {
  const { profile, validation, comisario, shareholder_history, output_folder } = input;
  
  console.log(`[generate_kyc_report] Generating report for: ${profile.customerId}`);
  
  // Determine output path
  const baseFolder = output_folder || `./data/${profile.customerId}/reports`;
  if (!fs.existsSync(baseFolder)) {
    fs.mkdirSync(baseFolder, { recursive: true });
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `kyc_report_${profile.customerId}_${timestamp}.html`;
  const reportPath = path.join(baseFolder, filename);
  
  // Generate HTML using FIXED template
  const html = buildHtmlReport(profile, validation, comisario, shareholder_history);
  
  // Write file
  fs.writeFileSync(reportPath, html, 'utf8');
  
  return {
    success: true,
    report_path: reportPath,
    report_url: `file://${path.resolve(reportPath)}`,
    customer_id: profile.customerId,
    generation_timestamp: new Date().toISOString()
  };
}

/**
 * FIXED HTML TEMPLATE - Claude cannot modify this
 */
function buildHtmlReport(
  profile: KycProfile,
  validation: KycValidationResult,
  comisario?: any,
  shareholderHistory?: any[]
): string {
  const companyName = profile.companyIdentity?.razon_social || 
                     profile.companyTaxProfile?.razon_social || 
                     profile.customerId;
  
  const rfc = profile.companyTaxProfile?.rfc || profile.companyIdentity?.rfc || 'N/A';
  const score = Math.round(validation.score);
  const status = score >= 90 ? 'APROBADO' : score >= 70 ? 'EN REVISIÓN' : 'RECHAZADO';
  const statusColor = score >= 90 ? '#22c55e' : score >= 70 ? '#f59e0b' : '#ef4444';
  
  // Critical flags
  const criticalFlags = validation.flags.filter(f => f.level === 'critical');
  const warningFlags = validation.flags.filter(f => f.level === 'warning');
  
  // Shareholders
  const shareholders = profile.companyIdentity?.shareholders || [];
  const ubos = shareholders.filter(s => (s.percentage && s.percentage >= 25) || s.is_beneficial_owner);
  
  // Legal representatives
  const legalReps = profile.companyIdentity?.legal_representatives || [];
  
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>KYC Report - ${companyName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f8fafc;
      color: #1e293b;
      line-height: 1.6;
      padding: 20px;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    .header {
      background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
      color: white;
      padding: 24px 32px;
      border-radius: 12px;
      margin-bottom: 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .header h1 { font-size: 1.5rem; font-weight: 600; }
    .header .rfc { opacity: 0.9; font-size: 0.9rem; }
    .score-badge {
      background: ${statusColor};
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      text-align: center;
    }
    .score-badge .score { font-size: 2rem; font-weight: 700; }
    .score-badge .status { font-size: 0.9rem; }
    
    .section {
      background: white;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 20px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .section h2 {
      font-size: 1.1rem;
      font-weight: 600;
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 2px solid #e2e8f0;
    }
    
    .alert-critical {
      background: #fef2f2;
      border-left: 4px solid #ef4444;
      padding: 16px;
      margin-bottom: 12px;
      border-radius: 0 8px 8px 0;
    }
    .alert-warning {
      background: #fffbeb;
      border-left: 4px solid #f59e0b;
      padding: 16px;
      margin-bottom: 12px;
      border-radius: 0 8px 8px 0;
    }
    .alert-title { font-weight: 600; margin-bottom: 4px; }
    .alert-action { font-size: 0.9rem; color: #64748b; }
    
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    th, td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #e2e8f0;
    }
    th { background: #f8fafc; font-weight: 600; }
    
    .badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .badge-ubo { background: #fef3c7; color: #92400e; }
    .badge-full { background: #dcfce7; color: #166534; }
    .badge-limited { background: #fee2e2; color: #991b1b; }
    
    .checklist-item {
      display: flex;
      align-items: center;
      padding: 8px 0;
      border-bottom: 1px solid #f1f5f9;
    }
    .checklist-item:last-child { border-bottom: none; }
    .check-icon { margin-right: 12px; font-size: 1.2rem; }
    
    .footer {
      text-align: center;
      color: #64748b;
      font-size: 0.8rem;
      padding: 20px;
    }
  </style>
</head>
<body>
  <div class="container">
    
    <!-- HEADER -->
    <div class="header">
      <div>
        <h1>🏢 Persona Moral</h1>
        <div style="font-size: 1.3rem; font-weight: 600; margin-top: 8px;">${companyName}</div>
        <div class="rfc">RFC: ${rfc}</div>
      </div>
      <div class="score-badge">
        <div class="score">${score}%</div>
        <div class="status">${status}</div>
      </div>
    </div>
    
    <!-- CRITICAL ALERTS -->
    ${criticalFlags.length > 0 ? `
    <div class="section" style="border: 2px solid #ef4444;">
      <h2>🚨 ALERTAS CRÍTICAS (${criticalFlags.length})</h2>
      ${criticalFlags.map(f => `
        <div class="alert-critical">
          <div class="alert-title">${f.code}: ${f.message}</div>
          ${f.action_required ? `<div class="alert-action">▸ Acción: ${f.action_required}</div>` : ''}
        </div>
      `).join('')}
    </div>
    ` : ''}
    
    <!-- WARNINGS -->
    ${warningFlags.length > 0 ? `
    <div class="section">
      <h2>⚠️ Observaciones (${warningFlags.length})</h2>
      ${warningFlags.map(f => `
        <div class="alert-warning">
          <div class="alert-title">${f.message}</div>
          ${f.action_required ? `<div class="alert-action">▸ ${f.action_required}</div>` : ''}
        </div>
      `).join('')}
    </div>
    ` : ''}
    
    <!-- SIGNATORIES -->
    <div class="section">
      <h2>✍️ ¿Quién Puede Firmar?</h2>
      <table>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Rol</th>
            <th>Alcance</th>
            <th>Facultades</th>
          </tr>
        </thead>
        <tbody>
          ${legalReps.map(rep => {
            const powerScope = rep.poder_scope || [];
            const hasFull = powerScope.some(p => /administraci[óo]n/i.test(p) && !/limitado/i.test(p)) &&
                          powerScope.some(p => /dominio/i.test(p));
            const scopeLabel = hasFull ? 'FULL' : 'LIMITED';
            const scopeClass = hasFull ? 'badge-full' : 'badge-limited';
            
            return `
              <tr>
                <td><strong>${rep.name}</strong></td>
                <td>${rep.role || 'Apoderado'}</td>
                <td><span class="badge ${scopeClass}">${scopeLabel}</span></td>
                <td>${powerScope.slice(0, 4).join(', ')}${powerScope.length > 4 ? ` (+${powerScope.length - 4} más)` : ''}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
    
    <!-- SHAREHOLDERS -->
    <div class="section">
      <h2>👥 Accionistas</h2>
      <table>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Acciones</th>
            <th>Porcentaje</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${shareholders.map(sh => `
            <tr>
              <td>${sh.name}</td>
              <td>${sh.shares || '-'}</td>
              <td>${sh.percentage ? sh.percentage.toFixed(2) + '%' : '-'}</td>
              <td>${(sh.percentage && sh.percentage >= 25) || sh.is_beneficial_owner ? '<span class="badge badge-ubo">UBO &gt;25%</span>' : ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    
    <!-- COMISARIO -->
    ${comisario ? `
    <div class="section">
      <h2>🔍 Órgano de Vigilancia (Comisario)</h2>
      <table>
        <tbody>
          <tr><th>Nombre</th><td>${comisario.name}</td></tr>
          <tr><th>Tipo</th><td>${comisario.tipo || 'PROPIETARIO'}</td></tr>
          <tr><th>Fecha Nombramiento</th><td>${comisario.appointment_date || 'Fecha de constitución'}</td></tr>
        </tbody>
      </table>
      <p style="margin-top: 12px; font-size: 0.85rem; color: #64748b;">
        ℹ️ El Comisario es un rol de vigilancia (LGSM Art. 164-171), NO tiene facultades para firmar contratos.
      </p>
    </div>
    ` : ''}
    
    <!-- SHAREHOLDER HISTORY -->
    ${shareholderHistory && shareholderHistory.length > 0 ? `
    <div class="section">
      <h2>📜 Historial de Cambios Accionarios</h2>
      <table>
        <thead>
          <tr>
            <th>Accionista</th>
            <th>Cambio</th>
            <th>Antes</th>
            <th>Después</th>
            <th>Documento</th>
          </tr>
        </thead>
        <tbody>
          ${shareholderHistory.map(h => `
            <tr>
              <td>${h.shareholder_name}</td>
              <td>${h.action}</td>
              <td>${h.old_percentage ? h.old_percentage + '%' : '-'}</td>
              <td>${h.new_percentage ? h.new_percentage + '%' : '-'}</td>
              <td>${h.source_document}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    ` : ''}
    
    <!-- CHECKLIST -->
    <div class="section">
      <h2>✅ Checklist de Verificación</h2>
      <div class="checklist-item">
        <span class="check-icon">${profile.companyIdentity ? '✓' : '✗'}</span>
        <span>Acta Constitutiva ${profile.companyIdentity ? 'verificada' : 'faltante'}</span>
      </div>
      <div class="checklist-item">
        <span class="check-icon">${profile.companyTaxProfile ? '✓' : '✗'}</span>
        <span>Constancia SAT ${profile.companyTaxProfile?.status === 'ACTIVO' ? '(ACTIVO)' : ''}</span>
      </div>
      <div class="checklist-item">
        <span class="check-icon">${profile.representativeIdentity || profile.passportIdentity ? '✓' : '✗'}</span>
        <span>Identificación del Representante</span>
      </div>
      <div class="checklist-item">
        <span class="check-icon">${profile.addressEvidence?.length ? '✓' : '✗'}</span>
        <span>Comprobante de Domicilio (${profile.addressEvidence?.length || 0} docs)</span>
      </div>
      <div class="checklist-item">
        <span class="check-icon">${profile.bankAccounts?.length ? '✓' : '✗'}</span>
        <span>Estado de Cuenta Bancario</span>
      </div>
    </div>
    
    <!-- FOOTER -->
    <div class="footer">
      <p>KYCIntel Report | Generated ${new Date().toISOString()}</p>
      <p>Customer ID: ${profile.customerId}</p>
    </div>
    
  </div>
</body>
</html>`;
}

export const GENERATE_KYC_REPORT_TOOL = {
  name: 'generate_kyc_report',
  description: `Generate the complete HTML KYC report from validated profile.
Report template is FIXED in code - Claude cannot modify format.
Returns path to the generated HTML file.
Claude should call this as the final step after validation.`,
  inputSchema: {
    type: 'object',
    properties: {
      profile: { type: 'object', description: 'The merged KycProfile' },
      validation: { type: 'object', description: 'The validation result' },
      comisario: { type: 'object', description: 'Current Comisario (optional)' },
      shareholder_history: { type: 'array', description: 'Shareholder changes (optional)' },
      output_folder: { type: 'string', description: 'Output folder path (optional)' }
    },
    required: ['profile', 'validation']
  }
};

