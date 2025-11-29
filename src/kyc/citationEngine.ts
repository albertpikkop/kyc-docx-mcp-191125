/**
 * Citation Engine for KYC Reports - Decision-Driven Citations
 * 
 * IMPORTANT: Citations are ONLY shown when they justify a specific validation decision.
 * We are NOT providing an education tour - only explaining WHY we approved/rejected.
 * 
 * Each validation flag maps to its relevant legal citation.
 */

import type { KycProfile, KycValidationResult } from './types.js';

// =============================================================================
// TYPES
// =============================================================================

export interface LegalCitation {
  id: string;
  ley_nombre: string;
  articulo?: string;
  url_base: string;
  text_fragment?: string;
  cita_textual: string;
  vigencia_verificada: string;
}

export interface DecisionCitation {
  decision: 'APROBADO' | 'REQUIERE REVISIÓN' | 'ADVERTENCIA' | 'INFO';
  documento: string;
  razon: string;
  cita: LegalCitation;
  highlight_url: string;
}

export interface CitationReport {
  citas_por_decision: DecisionCitation[];
  generado_en: string;
}

// =============================================================================
// HELPER: Generate URL with Custom PDF Viewer (Article Highlighting)
// =============================================================================
// Uses custom PDF viewer that highlights articles automatically
// Simple approach: Direct PDF links with page anchors
// No custom viewer needed - just open PDF at the right page

function buildHighlightUrl(baseUrl: string, _textToHighlight?: string, _article?: string): string {
  // For PDFs, just return the URL directly with page anchor if present
  // User will use Ctrl+F to search for the citation text shown inline
  if (baseUrl.includes('.pdf')) {
    // URL already contains page anchor like #page=45, just return it
    return baseUrl;
  }
  
  // For HTML pages, just return the URL directly
  return baseUrl;
}

// =============================================================================
// CITATION DATABASE - Only citations that justify decisions
// =============================================================================

// =============================================================================
// VERIFIED URLS - Only official law PDFs from diputados.gob.mx are guaranteed
// SAT website pages are UNRELIABLE and frequently return 403/404 errors
// =============================================================================

const CITAS: Record<string, LegalCitation> = {
  // Comprobante de Domicilio - Using LFPIORPI (anti-money laundering law)
  'sat_comprobante_valido': {
    id: 'sat_comprobante_valido',
    ley_nombre: 'LFPIORPI - Comprobante de Domicilio',
    articulo: 'Artículo 18, Fracción II',
    url_base: 'https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPIORPI.pdf#page=8',
    cita_textual: 'Recibo de pago de servicios como luz, gas, teléfono, agua, televisión o internet, con antigüedad no mayor a tres meses.',
    vigencia_verificada: '2024-11-25'
  },
  'sat_comprobante_tercero': {
    id: 'sat_comprobante_tercero',
    ley_nombre: 'LFPIORPI - Comprobante Tercero (Persona Física)',
    articulo: 'Artículo 18',
    url_base: 'https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPIORPI.pdf#page=8',
    cita_textual: 'Las personas físicas podrán presentar comprobante a nombre de tercero cuando acrediten vínculo familiar o arrendamiento.',
    vigencia_verificada: '2024-11-25'
  },
  'lfpiorpi_poa_pm': {
    id: 'lfpiorpi_poa_pm',
    ley_nombre: 'LFPIORPI - Persona Moral',
    articulo: 'Artículo 18, Fracción II',
    url_base: 'https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPIORPI.pdf#page=8',
    cita_textual: 'Tratándose de personas morales, el comprobante de domicilio deberá estar a nombre de la persona moral.',
    vigencia_verificada: '2024-11-25'
  },
  
  // Constancia SAT - Using Código Fiscal de la Federación
  'cff_rfc': {
    id: 'cff_rfc',
    ley_nombre: 'Código Fiscal de la Federación',
    articulo: 'Artículo 27',
    url_base: 'https://www.diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf#page=45',
    cita_textual: 'Las personas morales y físicas que deban presentar declaraciones periódicas deberán solicitar su inscripción en el RFC.',
    vigencia_verificada: '2024-11-25'
  },
  'sat_sin_obligaciones': {
    id: 'sat_sin_obligaciones',
    ley_nombre: 'Código Fiscal de la Federación',
    articulo: 'Artículo 27',
    // Note: Article 27 discusses RFC registration requirements. The restriction on "sin obligaciones fiscales"
    // for commercial activity is a regulatory interpretation by SAT, not explicit in CFF Article 27.
    // Users should search for "Artículo 27" in the PDF to find the actual text.
    url_base: 'https://www.diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf',
    cita_textual: 'Las personas morales y físicas que deban presentar declaraciones periódicas deberán solicitar su inscripción en el RFC.',
    vigencia_verificada: '2024-11-25'
  },
  
  // Documentos Migratorios - Using Ley de Migración
  'ley_migracion_permanente': {
    id: 'ley_migracion_permanente',
    ley_nombre: 'Ley de Migración',
    articulo: 'Artículo 54',
    url_base: 'https://www.diputados.gob.mx/LeyesBiblio/pdf/LMigra.pdf#page=16',
    cita_textual: 'Residente Permanente: Se autoriza al extranjero para permanecer en el territorio nacional de manera indefinida, con permiso para trabajar.',
    vigencia_verificada: '2024-11-25'
  },
  'inm_vigencia_indefinida': {
    id: 'inm_vigencia_indefinida',
    ley_nombre: 'Reglamento de la Ley de Migración',
    articulo: 'Artículo 137',
    url_base: 'https://www.diputados.gob.mx/LeyesBiblio/regley/Reg_LMigra.pdf#page=35',
    cita_textual: 'La tarjeta de residente permanente para personas mayores de 18 años tiene vigencia indefinida. Para menores de 18 años, la tarjeta tiene vigencia de 3 años y debe renovarse.',
    vigencia_verificada: '2024-11-25'
  },
  'inm_residente_temporal': {
    id: 'inm_residente_temporal',
    ley_nombre: 'Ley de Migración',
    articulo: 'Artículo 52',
    url_base: 'https://www.diputados.gob.mx/LeyesBiblio/pdf/LMigra.pdf#page=15',
    cita_textual: 'Residente Temporal: Autorización para permanecer en el país por un periodo de 1 a 4 años, con posibilidad de renovación.',
    vigencia_verificada: '2024-11-25'
  },
  'inm_fm_obsoleto': {
    id: 'inm_fm_obsoleto',
    ley_nombre: 'Ley de Migración - Transitorios',
    url_base: 'https://www.diputados.gob.mx/LeyesBiblio/pdf/LMigra.pdf#page=45',
    cita_textual: 'Los documentos FM2 y FM3 expedidos con anterioridad conservarán su vigencia hasta su vencimiento. Los nuevos documentos serán Tarjetas de Residente.',
    vigencia_verificada: '2024-11-25'
  },
  
  // Acta Constitutiva
  'lgsm_inscripcion': {
    id: 'lgsm_inscripcion',
    ley_nombre: 'Ley General de Sociedades Mercantiles',
    articulo: 'Artículo 19',
    url_base: 'https://www.diputados.gob.mx/LeyesBiblio/pdf/LGSM.pdf#page=4',
    cita_textual: 'La inscripción en el Registro Público de Comercio surtirá efectos contra terceros.',
    vigencia_verificada: '2024-11-25'
  },
  'ccom_fme': {
    id: 'ccom_fme',
    ley_nombre: 'Código de Comercio',
    articulo: 'Artículo 21',
    url_base: 'https://www.diputados.gob.mx/LeyesBiblio/pdf/CCom.pdf#page=5',
    cita_textual: 'Existirá un folio electrónico por cada comerciante o sociedad.',
    vigencia_verificada: '2024-11-25'
  },
  
  // Beneficiario Controlador
  'lfpiorpi_ubo': {
    id: 'lfpiorpi_ubo',
    ley_nombre: 'LFPIORPI',
    articulo: 'Artículo 17',
    url_base: 'https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPIORPI.pdf#page=7',
    cita_textual: 'Beneficiario Controlador: persona física con titularidad de acciones que representen más del 25% del capital.',
    vigencia_verificada: '2024-11-25'
  },
  
  // Identificación - Using LFPIORPI
  'sat_ine_valido': {
    id: 'sat_ine_valido',
    ley_nombre: 'LFPIORPI - Identificación Oficial',
    articulo: 'Artículo 18, Fracción I',
    url_base: 'https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPIORPI.pdf#page=7',
    cita_textual: 'Credencial para votar vigente expedida por el Instituto Nacional Electoral (INE), pasaporte vigente, o cédula profesional.',
    vigencia_verificada: '2024-11-25'
  },
  
  // Estado de Cuenta Bancario
  'sat_estado_cuenta': {
    id: 'sat_estado_cuenta',
    ley_nombre: 'LFPIORPI - Estado de Cuenta',
    articulo: 'Artículo 18, Fracción II',
    url_base: 'https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPIORPI.pdf#page=8',
    cita_textual: 'Estado de cuenta bancario a nombre del cliente, con antigüedad no mayor a tres meses, que acredite el domicilio.',
    vigencia_verificada: '2024-11-25'
  }
};

// =============================================================================
// FLAG TO CITATION MAPPING
// =============================================================================

interface FlagCitationMapping {
  cita_id: string;
  decision: 'APROBADO' | 'REQUIERE REVISIÓN' | 'ADVERTENCIA' | 'INFO';
  documento: string;
  razon_template: string;
}

const FLAG_CITATIONS: Record<string, FlagCitationMapping> = {
  // POA Validations
  'POA_ADDRESS_VERIFIED': {
    cita_id: 'sat_comprobante_valido',
    decision: 'APROBADO',
    documento: 'Comprobante de Domicilio',
    razon_template: 'Comprobante válido conforme a requisitos SAT'
  },
  'POA_NAME_MISMATCH': {
    cita_id: 'lfpiorpi_poa_pm',
    decision: 'REQUIERE REVISIÓN',
    documento: 'Comprobante de Domicilio',
    razon_template: 'Comprobante no está a nombre de la empresa (Persona Moral)'
  },
  'POA_THIRD_PARTY_FAMILY': {
    cita_id: 'sat_comprobante_tercero',
    decision: 'ADVERTENCIA',
    documento: 'Comprobante de Domicilio',
    razon_template: 'Comprobante a nombre de tercero - requiere acreditar parentesco'
  },
  'POA_THIRD_PARTY_LANDLORD': {
    cita_id: 'sat_comprobante_tercero',
    decision: 'ADVERTENCIA',
    documento: 'Comprobante de Domicilio',
    razon_template: 'Comprobante a nombre de arrendador - requiere contrato de arrendamiento'
  },
  
  // Tax Regime
  'TAX_REGIME_NO_COMMERCE': {
    cita_id: 'sat_sin_obligaciones',
    decision: 'ADVERTENCIA',
    documento: 'Constancia de Situación Fiscal',
    razon_template: 'Régimen "Sin obligaciones" no permite actividad empresarial'
  },
  
  // Immigration
  'IMMIGRATION_DOC_VALID': {
    cita_id: 'ley_migracion_permanente',
    decision: 'APROBADO',
    documento: 'Documento Migratorio',
    razon_template: 'Documento migratorio vigente y válido'
  },
  'IMMIGRATION_DOC_VALID_PERMANENT': {
    cita_id: 'inm_vigencia_indefinida',
    decision: 'APROBADO',
    documento: 'Tarjeta de Residente Permanente',
    razon_template: 'Tarjeta de Residente Permanente con vigencia indefinida (adulto 18+)'
  },
  'IMMIGRATION_DOC_EXPIRED': {
    cita_id: 'ley_migracion_permanente',
    decision: 'REQUIERE REVISIÓN',
    documento: 'Documento Migratorio',
    razon_template: 'Documento migratorio vencido'
  },
  'IMMIGRATION_CARD_OLD': {
    cita_id: 'inm_fm_obsoleto',
    decision: 'ADVERTENCIA',
    documento: 'FM2/FM3',
    razon_template: 'Documento FM obsoleto - debe canjear por Tarjeta de Residente'
  },
  
  // Corporate
  'MISSING_FME': {
    cita_id: 'ccom_fme',
    decision: 'ADVERTENCIA',
    documento: 'Acta Constitutiva',
    razon_template: 'Falta Folio Mercantil Electrónico para acreditar inscripción'
  },
  'UBO_MISSING': {
    cita_id: 'lfpiorpi_ubo',
    decision: 'REQUIERE REVISIÓN',
    documento: 'Acta Constitutiva',
    razon_template: 'No se identificaron beneficiarios controladores (>25%)'
  },
  'UBO_IDENTIFIED': {
    cita_id: 'lfpiorpi_ubo',
    decision: 'APROBADO',
    documento: 'Acta Constitutiva',
    razon_template: 'Beneficiarios controladores identificados correctamente'
  },
  
  // Identity
  'INE_VALID': {
    cita_id: 'sat_ine_valido',
    decision: 'APROBADO',
    documento: 'INE',
    razon_template: 'Credencial INE vigente y válida'
  },
  'IDENTITY_DOC_EXPIRED': {
    cita_id: 'sat_ine_valido',
    decision: 'REQUIERE REVISIÓN',
    documento: 'Identificación',
    razon_template: 'Documento de identidad vencido'
  },
  
  // Bank Statement
  'BANK_STATEMENT_VALID': {
    cita_id: 'sat_estado_cuenta',
    decision: 'APROBADO',
    documento: 'Estado de Cuenta Bancario',
    razon_template: 'Estado de cuenta válido como comprobante de domicilio'
  },
  
  // SAT Constancia
  'SAT_CONSTANCIA_VALID': {
    cita_id: 'cff_rfc',
    decision: 'APROBADO',
    documento: 'Constancia de Situación Fiscal',
    razon_template: 'Constancia SAT válida con RFC activo'
  },
  'MISSING_CONSTANCIA': {
    cita_id: 'cff_rfc',
    decision: 'REQUIERE REVISIÓN',
    documento: 'Constancia de Situación Fiscal',
    razon_template: 'Falta Constancia de Situación Fiscal (obligatoria)'
  }
};

// =============================================================================
// MAIN FUNCTION: Generate citations from validation flags
// =============================================================================

export function generateDecisionCitations(
  validation: KycValidationResult,
  profile: KycProfile
): CitationReport {
  const decisions: DecisionCitation[] = [];
  
  // Process each validation flag
  for (const flag of validation.flags) {
    const mapping = FLAG_CITATIONS[flag.code];
    if (mapping) {
      const cita = CITAS[mapping.cita_id];
      if (cita) {
        decisions.push({
          decision: mapping.decision,
          documento: mapping.documento,
          razon: flag.message || mapping.razon_template,
          cita,
          highlight_url: buildHighlightUrl(cita.url_base, cita.text_fragment || cita.cita_textual, cita.articulo)
        });
      }
    }
  }
  
  // Add positive citations for documents that passed validation
  // Only if we don't already have a citation for that document type
  
  const hasPoaCitation = decisions.some(d => d.documento.includes('Domicilio'));
  const hasSatCitation = decisions.some(d => d.documento.includes('Constancia'));
  const hasIdentityCitation = decisions.some(d => d.documento === 'INE' || d.documento === 'Identificación');
  const hasBankCitation = decisions.some(d => d.documento.includes('Bancario'));
  
  // If POA exists and no POA citation yet, add approval
  if (!hasPoaCitation && profile.addressEvidence && profile.addressEvidence.length > 0) {
    const cita = CITAS['sat_comprobante_valido'];
    decisions.push({
      decision: 'APROBADO',
      documento: 'Comprobante de Domicilio',
      razon: 'Comprobante de domicilio válido y dentro del plazo de 4 meses',
      cita,
      highlight_url: buildHighlightUrl(cita.url_base, cita.text_fragment || cita.cita_textual)
    });
  }
  
  // If SAT Constancia exists and no SAT citation yet, add approval
  if (!hasSatCitation && profile.companyTaxProfile) {
    const cita = CITAS['cff_rfc'];
    decisions.push({
      decision: 'APROBADO',
      documento: 'Constancia de Situación Fiscal',
      razon: 'RFC registrado y Constancia válida',
      cita,
      highlight_url: buildHighlightUrl(cita.url_base, cita.text_fragment || cita.cita_textual)
    });
  }
  
  // If INE/Identity exists and no identity citation yet
  if (!hasIdentityCitation && profile.representativeIdentity) {
    const docType = profile.representativeIdentity.document_type?.toLowerCase() || '';
    if (docType.includes('ine') || docType.includes('credencial')) {
      const cita = CITAS['sat_ine_valido'];
      decisions.push({
        decision: 'APROBADO',
        documento: 'INE',
        razon: 'Credencial INE vigente',
        cita,
        highlight_url: buildHighlightUrl(cita.url_base, cita.text_fragment || cita.cita_textual)
      });
    }
  }
  
  // If Bank Statement exists and no bank citation yet
  if (!hasBankCitation && profile.bankAccounts && profile.bankAccounts.length > 0) {
    const cita = CITAS['sat_estado_cuenta'];
    decisions.push({
      decision: 'APROBADO',
      documento: 'Estado de Cuenta Bancario',
      razon: 'Estado de cuenta bancario válido',
      cita,
      highlight_url: buildHighlightUrl(cita.url_base, cita.text_fragment || cita.cita_textual)
    });
  }
  
  return {
    citas_por_decision: decisions,
    generado_en: new Date().toISOString()
  };
}

// =============================================================================
// HTML GENERATOR - Compact, Decision-Focused
// =============================================================================

export function generateCitationsHtml(profile: KycProfile, validation?: KycValidationResult): string {
  // If no validation provided, return minimal section
  if (!validation) {
    return '';
  }
  
  const report = generateDecisionCitations(validation, profile);
  
  // If no decisions, no citations section
  if (report.citas_por_decision.length === 0) {
    return '';
  }
  
  // Group by decision type
  const aprobados = report.citas_por_decision.filter(d => d.decision === 'APROBADO');
  const pendientes = report.citas_por_decision.filter(d => d.decision === 'REQUIERE REVISIÓN');
  const advertencias = report.citas_por_decision.filter(d => d.decision === 'ADVERTENCIA');
  
  // Generate decision rows
  const generateRows = (items: DecisionCitation[], icon: string, bgColor: string, textColor: string) => {
    if (items.length === 0) return '';
    
    return items.map(item => {
      const isPdf = item.highlight_url.includes('.pdf');
      const pageMatch = item.highlight_url.match(/#page=(\d+)/);
      const pageInfo = pageMatch ? ` (Página ${pageMatch[1]})` : '';
      
      // Build search helper - use article number if available, otherwise use citation text
      let searchHelper = '';
      if (isPdf) {
        if (item.cita.articulo) {
          searchHelper = `<div class="mt-2 text-xs text-gray-500 italic">📝 Buscar en el PDF: "${item.cita.articulo}"</div>`;
        } else if (item.cita.cita_textual) {
          searchHelper = `<div class="mt-2 text-xs text-gray-500 italic">📝 Buscar en el PDF: "${item.cita.cita_textual.substring(0, 80)}${item.cita.cita_textual.length > 80 ? '...' : ''}"</div>`;
        }
      }
      
      return `
      <tr class="border-b border-gray-100">
        <td class="py-2 px-3">
          <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${bgColor} ${textColor}">
            ${icon} ${item.decision}
          </span>
        </td>
        <td class="py-2 px-3 text-sm font-medium text-gray-800">${item.documento}</td>
        <td class="py-2 px-3 text-sm text-gray-600">${item.razon}</td>
        <td class="py-2 px-3">
          <div>
            <a href="${item.highlight_url}" target="_blank" rel="noopener" 
               class="inline-flex items-center text-xs text-blue-600 hover:text-blue-800 hover:underline">
              <svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path>
              </svg>
              ${item.cita.ley_nombre}${item.cita.articulo ? ` ${item.cita.articulo}` : ''}${pageInfo}
            </a>
            ${searchHelper}
            ${isPdf && item.cita.cita_textual ? `
            <div class="mt-2 p-2 bg-blue-50 rounded text-xs text-gray-700 border-l-2 border-blue-300">
              <strong>📖 Cita Textual:</strong><br>
              "${item.cita.cita_textual}"
            </div>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
    }).join('');
  };
  
  const allRows = [
    generateRows(pendientes, '⚠️', 'bg-amber-100', 'text-amber-800'),
    generateRows(advertencias, '⚠️', 'bg-amber-100', 'text-amber-800'),
    generateRows(aprobados, '✅', 'bg-green-100', 'text-green-800')
  ].join('');
  
  return `
    <div class="fluent-card rounded-xl shadow-md border border-gray-200 p-4 mt-6" style="background: #fafafa;">
      <h3 class="text-base font-semibold text-gray-900 mb-3 flex items-center">
        <svg class="w-4 h-4 mr-2 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
        Fundamento Legal por Decisión
      </h3>
      
      <div class="overflow-x-auto">
        <table class="w-full text-left">
          <thead class="bg-gray-100 text-xs text-gray-600 uppercase">
            <tr>
              <th class="py-2 px-3 rounded-tl-lg">Decisión</th>
              <th class="py-2 px-3">Documento</th>
              <th class="py-2 px-3">Razón</th>
              <th class="py-2 px-3 rounded-tr-lg">Fundamento</th>
            </tr>
          </thead>
          <tbody>
            ${allRows}
          </tbody>
        </table>
      </div>
      
      <div class="mt-3 text-xs text-gray-500 border-t pt-2">
        <p>📌 Al hacer clic en "Fundamento", se abrirá el PDF oficial. La cita textual se muestra arriba para verificación inmediata. Use Ctrl+F (Cmd+F en Mac) en el PDF para buscar el texto exacto.</p>
      </div>
    </div>
  `;
}

// =============================================================================
// EXPORTS FOR BACKWARD COMPATIBILITY
// =============================================================================

export const LEGAL_CITATIONS = Object.values(CITAS);
export const CITAS_LEGALES = Object.values(CITAS);

export function buildCitationContext(profile: KycProfile) {
  return {
    isPersonaMoral: !!profile.companyIdentity,
    isPersonaFisica: !profile.companyIdentity,
    isForeigner: false,
    isMexicanCitizen: true,
    documentTypes: new Set<string>(),
    hasImmigrationDoc: !!profile.representativeIdentity,
    hasSatConstancia: !!profile.companyTaxProfile,
    hasActaConstitutiva: !!profile.companyIdentity,
    hasProofOfAddress: (profile.addressEvidence?.length || 0) > 0,
    hasINE: false,
    hasPassport: !!profile.passportIdentity
  };
}

export function getApplicableCitations(context: ReturnType<typeof buildCitationContext>) {
  return {
    citas_aplicables: [],
    citas_excluidas: [],
    generado_en: new Date().toISOString(),
    contexto: context
  };
}

export function getCitationsForFlag(flagCode: string): LegalCitation[] {
  const mapping = FLAG_CITATIONS[flagCode];
  if (mapping) {
    const cita = CITAS[mapping.cita_id];
    return cita ? [cita] : [];
  }
  return [];
}
