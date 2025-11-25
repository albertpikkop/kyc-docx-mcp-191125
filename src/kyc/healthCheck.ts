/**
 * KYC Health Check - Alta de Proveedor Verification
 * 
 * Generates a human-readable verification report for supplier/client onboarding.
 * Uses Mexican compliance terminology familiar to logistics and 3PL companies.
 */

import { differenceInDays } from 'date-fns';
import { KycProfile, KycValidationResult } from './types.js';
import { resolveSignatories, resolveUbo, isPersonaFisica } from './validation.js';

// --- Types ---

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'info';

export interface HealthCheckItem {
  check: string;           // Spanish label for the check
  status: CheckStatus;
  detail: string;          // Human-readable detail
  action?: string;         // Recommended action if not pass
}

export interface HealthCheckReport {
  customerId: string;
  razonSocial: string;
  rfc: string | null;
  generatedAt: string;
  items: HealthCheckItem[];
  passCount: number;
  totalCount: number;
  dictamen: 'APROBADO' | 'APROBADO CON OBSERVACIONES' | 'EN REVISIÓN' | 'RECHAZADO';
  accionRequerida: string | null;
}

// --- Helper Functions ---

function normalizeZip(cp: string | null | undefined): string | null {
  if (!cp) return null;
  // Extract just the numeric part (handles "11300-CR-11411" -> "11300")
  const match = cp.match(/^\d+/);
  return match ? match[0] : cp;
}

// Utility for address formatting (kept for future use)
function _formatAddress(addr: any): string {
  if (!addr) return 'No disponible';
  const parts = [
    addr.street,
    addr.ext_number ? `#${addr.ext_number}` : null,
    addr.int_number ? `Int. ${addr.int_number}` : null,
    addr.colonia,
    addr.cp ? `CP ${normalizeZip(addr.cp)}` : null,
    addr.municipio
  ].filter(Boolean);
  return parts.join(', ') || 'No disponible';
}
void _formatAddress; // Suppress unused warning

function matchesName(name1: string | null | undefined, name2: string | null | undefined): boolean {
  if (!name1 || !name2) return false;
  
  const normalize = (s: string) => s.toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[.,]/g, '')
    .replace(/\b(SOCIEDAD|ANONIMA|PROMOTORA|INVERSION|CAPITAL|VARIABLE|SA|CV|SAPI|DE|RL)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  const n1 = normalize(name1);
  const n2 = normalize(name2);
  
  // Check if one contains the other (for "PFDS" vs "PFDS, SOCIEDAD ANÓNIMA...")
  return n1.includes(n2) || n2.includes(n1) || n1 === n2;
}

// --- Main Health Check Function ---

export function generateHealthCheck(profile: KycProfile, _validation: KycValidationResult): HealthCheckReport {
  const items: HealthCheckItem[] = [];
  const now = new Date();
  
  // Detect if this is a Persona Física (individual) vs Persona Moral (company)
  const isPF = isPersonaFisica(profile);
  
  // 1. DOCUMENTOS RECIBIDOS
  // -----------------------
  
  // Acta Constitutiva (NOT required for Persona Física)
  const hasActa = !!profile.companyIdentity;
  if (!isPF) {
    items.push({
      check: 'Acta Constitutiva',
      status: hasActa ? 'pass' : 'fail',
      detail: hasActa 
        ? `Escritura ${profile.companyIdentity?.notary?.protocol_number || 'N/A'} (${profile.companyIdentity?.incorporation_date || 'N/A'})`
        : 'No recibida',
      action: hasActa ? undefined : 'Solicitar Acta Constitutiva'
    });
  }
  
  // Constancia SAT
  const hasSat = !!profile.companyTaxProfile;
  const satIssueDate = profile.companyTaxProfile?.issue?.issue_date;
  items.push({
    check: 'Constancia SAT',
    status: hasSat ? 'pass' : 'fail',
    detail: hasSat 
      ? `Emitida ${satIssueDate || 'N/A'}`
      : 'No recibida',
    action: hasSat ? undefined : 'Solicitar Constancia de Situación Fiscal'
  });
  
  // Comprobante de Domicilio
  const hasPoA = profile.addressEvidence && profile.addressEvidence.length > 0;
  const latestPoA = profile.addressEvidence?.[0];
  const poaDate = latestPoA?.issue_datetime || latestPoA?.due_date;
  const poaAge = poaDate ? differenceInDays(now, new Date(poaDate)) : null;
  items.push({
    check: 'Comprobante Domicilio',
    status: hasPoA ? (poaAge && poaAge <= 90 ? 'pass' : 'warn') : 'fail',
    detail: hasPoA 
      ? `${latestPoA?.vendor_name || 'Recibo'} (${poaAge} días)`
      : 'No recibido',
    action: !hasPoA ? 'Solicitar comprobante de domicilio' : (poaAge && poaAge > 90 ? 'Solicitar comprobante más reciente (<90 días)' : undefined)
  });
  
  // Identificación del Representante
  const hasRepId = !!profile.representativeIdentity;
  const repName = profile.representativeIdentity?.full_name;
  const repDocType = profile.representativeIdentity?.document_type || 'ID';
  items.push({
    check: 'Identificación Rep. Legal',
    status: hasRepId ? 'pass' : 'fail',
    detail: hasRepId 
      ? `${repDocType} - ${repName}`
      : 'No recibida',
    action: hasRepId ? undefined : 'Solicitar INE o FM2 del representante legal'
  });
  
  // Estado de Cuenta Bancario
  const hasBankId = !!profile.bankIdentity;
  const bankName = profile.bankIdentity?.bank_name?.toUpperCase() || 'Banco';
  const clabeLast4 = profile.bankIdentity?.clabe_last4;
  items.push({
    check: 'Estado de Cuenta',
    status: hasBankId ? 'pass' : 'warn',
    detail: hasBankId 
      ? `${bankName} - CLABE ***${clabeLast4 || '????'}`
      : 'No recibido',
    action: hasBankId ? undefined : 'Solicitar estado de cuenta bancario'
  });
  
  // 2. VALIDACIONES CRUZADAS
  // ------------------------
  
  // RFC Coincide
  const actaRfc = profile.companyIdentity?.rfc;
  const satRfc = profile.companyTaxProfile?.rfc;
  const telmexRfc = profile.addressEvidence?.[0]?.client_tax_id;
  
  // RFC from SAT is canonical
  const rfcMatch = !actaRfc || actaRfc === satRfc; // If Acta has no RFC, it's OK
  const rfcMatchTelmex = !telmexRfc || telmexRfc === satRfc;
  items.push({
    check: 'RFC Coincide',
    status: (rfcMatch && rfcMatchTelmex) ? 'pass' : 'fail',
    detail: satRfc || 'No disponible',
    action: (!rfcMatch || !rfcMatchTelmex) ? 'RFC no coincide entre documentos - verificar manualmente' : undefined
  });
  
  // Razón Social
  const actaName = profile.companyIdentity?.razon_social;
  const satName = profile.companyTaxProfile?.razon_social;
  const nameMatch = matchesName(actaName, satName);
  items.push({
    check: 'Razón Social',
    status: nameMatch || !actaName ? 'pass' : 'warn',
    detail: satName || actaName || 'No disponible',
    action: !nameMatch && actaName ? 'Verificar que Acta y SAT corresponden a la misma entidad' : undefined
  });
  
  // Situación Fiscal
  const taxStatus = profile.companyTaxProfile?.status?.toUpperCase();
  items.push({
    check: 'Situación Fiscal',
    status: taxStatus === 'ACTIVO' ? 'pass' : 'fail',
    detail: taxStatus || 'No disponible',
    action: taxStatus !== 'ACTIVO' ? 'RFC no está ACTIVO - no proceder con alta' : undefined
  });
  
  // Domicilio (Fiscal vs Operativo)
  const fiscalZip = normalizeZip(profile.currentFiscalAddress?.cp);
  const opZip = normalizeZip(profile.currentOperationalAddress?.cp);
  const addressMatch = fiscalZip === opZip;
  items.push({
    check: 'Domicilio',
    status: addressMatch ? 'pass' : 'warn',
    detail: addressMatch 
      ? `CP ${fiscalZip} - Coincide`
      : `Fiscal: CP ${fiscalZip || 'N/A'} | Operativo: CP ${opZip || 'N/A'}`,
    action: !addressMatch ? 'Solicitar carta aclaratoria de domicilios' : undefined
  });
  
  // Representante Legal con Poderes (Only for Persona Moral)
  if (!isPF) {
    const signatories = hasActa ? resolveSignatories(profile) : [];
    const fullPowerSigners = signatories.filter(s => s.scope === 'full');
    const hasFullPower = fullPowerSigners.length > 0;
    items.push({
      check: 'Apoderado Legal',
      status: hasFullPower ? 'pass' : 'warn',
      detail: hasFullPower 
        ? `${fullPowerSigners[0].name} - Poderes Plenos`
        : (signatories.length > 0 ? `${signatories[0].name} - Poderes Limitados` : 'No identificado'),
      action: !hasFullPower ? 'Verificar que el firmante tiene poderes suficientes' : undefined
    });
    
    // Beneficiario Controlador (>25%) - Only for Persona Moral
    const ubos = hasActa ? resolveUbo(profile) : [];
    const hasUbo = ubos.length > 0;
    items.push({
      check: 'Beneficiario Controlador',
      status: hasUbo ? 'pass' : 'warn',
      detail: hasUbo 
        ? ubos.map(u => `${u.name} (${u.percentage?.toFixed(1) || '?'}%)`).join(', ')
        : 'No identificado (ningún socio >25%)',
      action: !hasUbo ? 'Verificar estructura accionaria' : undefined
    });
  } else {
    // For Persona Física, the representative IS the person
    const repName = profile.representativeIdentity?.full_name || profile.companyTaxProfile?.razon_social;
    items.push({
      check: 'Titular',
      status: repName ? 'pass' : 'warn',
      detail: repName || 'No identificado',
      action: !repName ? 'Verificar identidad del titular' : undefined
    });
  }
  
  // Actividad Económica (Info only)
  const activities = profile.companyTaxProfile?.economic_activities || [];
  const primaryActivity = activities.find(a => a.order === 1)?.description || activities[0]?.description;
  items.push({
    check: 'Actividad Económica',
    status: 'info',
    detail: primaryActivity || 'No disponible'
  });
  
  // 3. Calculate Summary
  // --------------------
  const passCount = items.filter(i => i.status === 'pass').length;
  const failCount = items.filter(i => i.status === 'fail').length;
  const warnCount = items.filter(i => i.status === 'warn').length;
  const totalCount = items.filter(i => i.status !== 'info').length;
  
  // Determine Dictamen
  let dictamen: HealthCheckReport['dictamen'];
  let accionRequerida: string | null = null;
  
  if (taxStatus !== 'ACTIVO') {
    dictamen = 'RECHAZADO';
    accionRequerida = 'RFC no está ACTIVO ante el SAT. No proceder con alta.';
  } else if (failCount > 0) {
    dictamen = 'EN REVISIÓN';
    const failedItems = items.filter(i => i.status === 'fail');
    accionRequerida = `Documentos faltantes: ${failedItems.map(i => i.check).join(', ')}`;
  } else if (warnCount > 0) {
    dictamen = 'APROBADO CON OBSERVACIONES';
    const warnItems = items.filter(i => i.status === 'warn' && i.action);
    accionRequerida = warnItems[0]?.action || null;
  } else {
    dictamen = 'APROBADO';
    accionRequerida = null;
  }
  
  return {
    customerId: profile.customerId,
    razonSocial: profile.companyTaxProfile?.razon_social || profile.companyIdentity?.razon_social || 'Desconocido',
    rfc: profile.companyTaxProfile?.rfc || null,
    generatedAt: now.toISOString(),
    items,
    passCount,
    totalCount,
    dictamen,
    accionRequerida
  };
}

// --- Console Output Formatter ---

export function printHealthCheck(report: HealthCheckReport): void {
  const width = 72;
  const line = '═'.repeat(width);
  const thinLine = '─'.repeat(width);
  
  const statusIcon = (s: CheckStatus) => {
    switch (s) {
      case 'pass': return '✅';
      case 'fail': return '❌';
      case 'warn': return '⚠️ ';
      case 'info': return 'ℹ️ ';
    }
  };
  
  const dictamenColor = (d: HealthCheckReport['dictamen']) => {
    switch (d) {
      case 'APROBADO': return '\x1b[32m'; // Green
      case 'APROBADO CON OBSERVACIONES': return '\x1b[33m'; // Yellow
      case 'EN REVISIÓN': return '\x1b[33m'; // Yellow
      case 'RECHAZADO': return '\x1b[31m'; // Red
    }
  };
  const reset = '\x1b[0m';
  
  // Detect if Persona Física from RFC pattern (4 letters = PF, 3 letters = PM)
  const isPF = report.rfc && /^[A-Z]{4}\d{6}/.test(report.rfc);
  const title = isPF ? 'VERIFICACIÓN ALTA DE CLIENTE (PERSONA FÍSICA)' : 'VERIFICACIÓN ALTA DE PROVEEDOR';
  const entityLabel = isPF ? 'Cliente' : 'Proveedor';
  
  console.log(`\n╔${line}╗`);
  console.log(`║${title.padStart(width / 2 + title.length / 2).padEnd(width)}║`);
  console.log(`║${`${entityLabel}: ${report.razonSocial}`.substring(0, width).padEnd(width)}║`);
  console.log(`║${`RFC: ${report.rfc || 'N/A'}`.padEnd(width)}║`);
  console.log(`╠${line}╣`);
  console.log(`║${''.padEnd(width)}║`);
  console.log(`║${'DOCUMENTOS RECIBIDOS'.padEnd(width)}║`);
  console.log(`║${thinLine}║`);
  
  // Documents section (first 5 items)
  for (let i = 0; i < 5 && i < report.items.length; i++) {
    const item = report.items[i];
    const icon = statusIcon(item.status);
    const line = `${icon}  ${item.check.padEnd(22)} ${item.detail}`.substring(0, width);
    console.log(`║${line.padEnd(width)}║`);
  }
  
  console.log(`║${''.padEnd(width)}║`);
  console.log(`║${'VALIDACIONES CRUZADAS'.padEnd(width)}║`);
  console.log(`║${thinLine}║`);
  
  // Validations section (remaining items)
  for (let i = 5; i < report.items.length; i++) {
    const item = report.items[i];
    const icon = statusIcon(item.status);
    const line = `${icon}  ${item.check.padEnd(22)} ${item.detail}`.substring(0, width);
    console.log(`║${line.padEnd(width)}║`);
  }
  
  // Warnings/Actions
  const warnings = report.items.filter(i => i.action);
  if (warnings.length > 0) {
    console.log(`║${''.padEnd(width)}║`);
    console.log(`║${'ALERTAS'.padEnd(width)}║`);
    console.log(`║${thinLine}║`);
    for (const w of warnings.slice(0, 3)) {
      const line = `⚠️  ${w.action}`.substring(0, width);
      console.log(`║${line.padEnd(width)}║`);
    }
  }
  
  console.log(`╠${line}╣`);
  const color = dictamenColor(report.dictamen);
  console.log(`║${color}  DICTAMEN: ${report.dictamen}${reset}`.padEnd(width + 9) + `║`);
  if (report.accionRequerida) {
    console.log(`║${`  Acción: ${report.accionRequerida}`.substring(0, width).padEnd(width)}║`);
  }
  console.log(`╚${line}╝\n`);
}

