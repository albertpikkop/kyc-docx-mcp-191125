/**
 * Persona Moral KYC Template - Golden Standard
 * Based on PFDS S.A.P.I. de C.V. as the reference implementation
 * 
 * This template defines the requirements for a complete KYC package
 * for Mexican corporate entities (Persona Moral) for Alta de Proveedor.
 * 
 * Legal Basis:
 * - LGSM (Ley General de Sociedades Mercantiles) - Art. 10
 * - CFF (Código Fiscal de la Federación) - Art. 27, 29-A
 * - LFPIORPI (Ley Federal para la Prevención e Identificación de Operaciones 
 *   con Recursos de Procedencia Ilícita) - Art. 17, 18
 */

export interface PersonaMoralRequirement {
  id: string;
  name: string;
  nameEs: string;
  description: string;
  descriptionEs: string;
  documentTypes: string[];  // Which document types can satisfy this requirement
  required: boolean;
  weight: number;  // For scoring (total should be 100)
  validationRules: ValidationRule[];
}

export interface ValidationRule {
  id: string;
  description: string;
  descriptionEs: string;
  severity: 'critical' | 'warning' | 'info';
  check: string;  // Key for programmatic check
}

export interface TemplateComplianceResult {
  templateName: string;
  templateVersion: string;
  overallScore: number;
  maxScore: number;
  percentComplete: number;
  requirements: RequirementResult[];
  criticalIssues: string[];
  warnings: string[];
  recommendations: string[];
}

export interface RequirementResult {
  requirement: PersonaMoralRequirement;
  status: 'passed' | 'failed' | 'partial' | 'not_applicable';
  score: number;
  maxScore: number;
  details: string;
  detailsEs: string;
  evidence?: string[];
}

// ============================================================================
// PERSONA MORAL TEMPLATE DEFINITION
// Based on PFDS as the Golden Standard
// ============================================================================

export const PERSONA_MORAL_TEMPLATE: {
  name: string;
  version: string;
  description: string;
  requirements: PersonaMoralRequirement[];
} = {
  name: "Persona Moral - Alta de Proveedor",
  version: "1.0.0",
  description: "Template for Mexican corporate entity KYC (based on PFDS golden standard)",
  
  requirements: [
    // =========================================================================
    // 1. ACTA CONSTITUTIVA (25 points)
    // =========================================================================
    {
      id: "acta_constitutiva",
      name: "Incorporation Deed",
      nameEs: "Acta Constitutiva",
      description: "Corporate charter with notarized incorporation deed",
      descriptionEs: "Escritura pública de constitución de la sociedad",
      documentTypes: ["acta"],
      required: true,
      weight: 25,
      validationRules: [
        {
          id: "acta_razon_social",
          description: "Company name (Razón Social) extracted",
          descriptionEs: "Razón Social extraída correctamente",
          severity: "critical",
          check: "has_razon_social"
        },
        {
          id: "acta_incorporation_date",
          description: "Incorporation date present",
          descriptionEs: "Fecha de constitución presente",
          severity: "critical",
          check: "has_incorporation_date"
        },
        {
          id: "acta_notary_info",
          description: "Notary information complete (name, number, protocol)",
          descriptionEs: "Datos notariales completos (notario, número, protocolo)",
          severity: "warning",
          check: "has_notary_info"
        },
        {
          id: "acta_registry",
          description: "Public Registry inscription (FME/Folio)",
          descriptionEs: "Inscripción en Registro Público (FME/Folio)",
          severity: "warning",
          check: "has_registry_info"
        },
        {
          id: "acta_shareholders",
          description: "Shareholders/ownership structure extracted",
          descriptionEs: "Accionistas/estructura accionaria extraída",
          severity: "critical",
          check: "has_shareholders"
        },
        {
          id: "acta_legal_reps",
          description: "Legal representatives with powers extracted",
          descriptionEs: "Representantes legales con poderes extraídos",
          severity: "critical",
          check: "has_legal_representatives"
        }
      ]
    },
    
    // =========================================================================
    // 2. CONSTANCIA SAT (20 points)
    // =========================================================================
    {
      id: "sat_constancia",
      name: "SAT Tax Registration",
      nameEs: "Constancia de Situación Fiscal SAT",
      description: "Official tax registration certificate from SAT",
      descriptionEs: "Constancia de Situación Fiscal emitida por el SAT",
      documentTypes: ["sat_constancia"],
      required: true,
      weight: 20,
      validationRules: [
        {
          id: "sat_rfc",
          description: "RFC extracted and valid format",
          descriptionEs: "RFC extraído con formato válido",
          severity: "critical",
          check: "has_rfc"
        },
        {
          id: "sat_status_activo",
          description: "Tax status is ACTIVO",
          descriptionEs: "Estatus fiscal es ACTIVO",
          severity: "critical",
          check: "sat_status_active"
        },
        {
          id: "sat_fiscal_address",
          description: "Fiscal address extracted",
          descriptionEs: "Domicilio fiscal extraído",
          severity: "warning",
          check: "has_fiscal_address"
        },
        {
          id: "sat_regime",
          description: "Tax regime identified",
          descriptionEs: "Régimen fiscal identificado",
          severity: "info",
          check: "has_tax_regime"
        }
      ]
    },
    
    // =========================================================================
    // 3. REPRESENTATIVE IDENTITY (20 points)
    // =========================================================================
    {
      id: "representative_identity",
      name: "Legal Representative Identity",
      nameEs: "Identificación del Representante Legal",
      description: "Official ID of the legal representative (INE/Passport + FM2 for foreigners)",
      descriptionEs: "Identificación oficial del representante legal (INE/Pasaporte + FM2 para extranjeros)",
      documentTypes: ["passport", "ine", "fm2"],
      required: true,
      weight: 20,
      validationRules: [
        {
          id: "rep_id_present",
          description: "At least one identity document present",
          descriptionEs: "Al menos un documento de identidad presente",
          severity: "critical",
          check: "has_identity_document"
        },
        {
          id: "rep_id_valid",
          description: "Identity document not expired",
          descriptionEs: "Documento de identidad vigente",
          severity: "critical",
          check: "identity_not_expired"
        },
        {
          id: "rep_matches_acta",
          description: "Representative name matches Acta Constitutiva",
          descriptionEs: "Nombre del representante coincide con Acta Constitutiva",
          severity: "critical",
          check: "rep_name_matches_acta"
        },
        {
          id: "rep_has_powers",
          description: "Representative has signing powers in Acta",
          descriptionEs: "Representante tiene poderes para firmar en el Acta",
          severity: "critical",
          check: "rep_has_signing_powers"
        },
        {
          id: "foreigner_fm2",
          description: "Foreign nationals have valid FM2/Residency",
          descriptionEs: "Extranjeros tienen FM2/Residencia vigente",
          severity: "critical",
          check: "foreigner_has_fm2"
        }
      ]
    },
    
    // =========================================================================
    // 4. PROOF OF ADDRESS (15 points)
    // =========================================================================
    {
      id: "proof_of_address",
      name: "Proof of Address",
      nameEs: "Comprobante de Domicilio",
      description: "Utility bill or bank statement as proof of operational address",
      descriptionEs: "Recibo de servicios o estado de cuenta como comprobante de domicilio",
      documentTypes: ["cfe", "telmex", "bank_identity_page"],
      required: true,
      weight: 15,
      validationRules: [
        {
          id: "poa_present",
          description: "At least one proof of address document",
          descriptionEs: "Al menos un comprobante de domicilio",
          severity: "critical",
          check: "has_proof_of_address"
        },
        {
          id: "poa_recent",
          description: "Document issued within last 90 days",
          descriptionEs: "Documento emitido en los últimos 90 días",
          severity: "warning",
          check: "poa_within_90_days"
        },
        {
          id: "poa_name_matches",
          description: "Name on document matches company name (Razón Social)",
          descriptionEs: "Nombre en documento coincide con Razón Social de la empresa",
          severity: "critical",
          check: "poa_name_matches_company"
        },
        {
          id: "poa_address_matches_sat",
          description: "Address matches or is near fiscal address",
          descriptionEs: "Dirección coincide o está cerca del domicilio fiscal",
          severity: "warning",
          check: "poa_address_matches_fiscal"
        }
      ]
    },
    
    // =========================================================================
    // 5. BANK ACCOUNT (10 points)
    // =========================================================================
    {
      id: "bank_account",
      name: "Bank Account Verification",
      nameEs: "Verificación de Cuenta Bancaria",
      description: "Bank statement showing account holder and CLABE",
      descriptionEs: "Estado de cuenta mostrando titular y CLABE",
      documentTypes: ["bank_identity_page"],
      required: true,
      weight: 10,
      validationRules: [
        {
          id: "bank_present",
          description: "Bank statement present",
          descriptionEs: "Estado de cuenta bancario presente",
          severity: "critical",
          check: "has_bank_statement"
        },
        {
          id: "bank_clabe",
          description: "CLABE interbancaria extracted",
          descriptionEs: "CLABE interbancaria extraída",
          severity: "critical",
          check: "has_clabe"
        },
        {
          id: "bank_holder_matches",
          description: "Account holder matches company name",
          descriptionEs: "Titular de cuenta coincide con nombre de empresa",
          severity: "critical",
          check: "bank_holder_matches_company"
        },
        {
          id: "bank_recent",
          description: "Statement within last 90 days",
          descriptionEs: "Estado de cuenta de los últimos 90 días",
          severity: "warning",
          check: "bank_within_90_days"
        }
      ]
    },
    
    // =========================================================================
    // 6. UBO IDENTIFICATION (10 points)
    // =========================================================================
    {
      id: "ubo_identification",
      name: "Beneficial Owner Identification",
      nameEs: "Identificación de Beneficiario Controlador",
      description: "Identification of Ultimate Beneficial Owners (>25% ownership)",
      descriptionEs: "Identificación de Beneficiarios Controladores (>25% participación)",
      documentTypes: ["acta"],
      required: true,
      weight: 10,
      validationRules: [
        {
          id: "ubo_calculated",
          description: "Ownership percentages calculated",
          descriptionEs: "Porcentajes de participación calculados",
          severity: "critical",
          check: "has_ownership_percentages"
        },
        {
          id: "ubo_identified",
          description: "UBOs (>25%) identified",
          descriptionEs: "Beneficiarios Controladores (>25%) identificados",
          severity: "critical",
          check: "ubos_identified"
        },
        {
          id: "ubo_is_signatory",
          description: "At least one UBO is a verified signatory",
          descriptionEs: "Al menos un UBO es firmante verificado",
          severity: "warning",
          check: "ubo_is_signatory"
        }
      ]
    }
  ]
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get the total possible score from the template
 */
export function getMaxScore(): number {
  return PERSONA_MORAL_TEMPLATE.requirements.reduce((sum, req) => sum + req.weight, 0);
}

/**
 * Get required document types from template
 */
export function getRequiredDocumentTypes(): string[] {
  const types = new Set<string>();
  PERSONA_MORAL_TEMPLATE.requirements.forEach(req => {
    req.documentTypes.forEach(t => types.add(t));
  });
  return Array.from(types);
}

/**
 * Get critical validation rules
 */
export function getCriticalRules(): ValidationRule[] {
  const rules: ValidationRule[] = [];
  PERSONA_MORAL_TEMPLATE.requirements.forEach(req => {
    req.validationRules
      .filter(r => r.severity === 'critical')
      .forEach(r => rules.push(r));
  });
  return rules;
}

