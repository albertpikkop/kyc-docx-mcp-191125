/**
 * REST API Handlers for KYC and Credit Assessment
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { handleImportKycDocument, handleBuildKycProfile, handleValidateKycProfile, requireOrgId } from './server.js';
import { getLatestRun, logAudit, saveDecision, prisma } from '../kyc/prismaHelpers.js';
import { KycProfile, KycValidationResult } from '../kyc/types.js';
import { assessCredit } from '../kyc/creditAssessment.js';
import { createCreditSnapshot } from '../kyc/creditSnapshot.js';
import { createContextLogger } from '../utils/logger.js';
import { metrics } from './health.js';
import { checkFreeTierLimit } from './freeTierLimiter.js';

/**
 * POST /kyc/check
 * Check/import a KYC document
 */
export async function handleKycCheck(
  request: FastifyRequest<{
    Body: {
      customer_id: string;
      doc_type: string;
      file_url: string;
    };
  }>,
  reply: FastifyReply
): Promise<void> {
  const orgId = requireOrgId(); // Ensure authenticated
  const { customer_id, doc_type, file_url } = request.body;
  
  const log = createContextLogger({
    orgId,
    corrId: request.corrId,
  });
  
  log.info({ customer_id, doc_type, file_url }, 'KYC check request');

  // Validate doc_type
  const validDocTypes = ['acta', 'sat_constancia', 'fm2', 'telmex', 'cfe', 'bank_statement', 'bank_identity_page'];
  if (!validDocTypes.includes(doc_type)) {
    reply.code(400).send({
      error: 'Invalid doc_type',
      message: `doc_type must be one of: ${validDocTypes.join(', ')}`,
    });
    return;
  }

  try {
    // Use existing handler logic
    const result = await handleImportKycDocument({
      customer_id,
      doc_type: doc_type as any,
      file_url,
    });

    // Parse the MCP response
    const responseText = result.content[0]?.text;
    if (!responseText) {
      reply.code(500).send({ error: 'Invalid response from handler' });
      return;
    }

    const parsed = JSON.parse(responseText);
    if (!parsed.ok) {
      reply.code(400).send({
        error: parsed.error_code || 'EXTRACTION_FAILED',
        message: parsed.message,
      });
      return;
    }

    // Model used is GPT-5.1 (as per project requirements)
    const model_used = 'gpt-5.1';
    
    // Record metrics
    metrics.documentExtractions.inc({ doc_type, model: model_used });
    
    log.info(
      { run_id: parsed.data.run_id, doc_id: parsed.data.doc_id, model_used },
      'KYC check completed'
    );

    reply.send({
      run_id: parsed.data.run_id,
      doc_id: parsed.data.doc_id,
      model_used,
    });
  } catch (error: any) {
    reply.code(500).send({
      error: 'INTERNAL_ERROR',
      message: error?.message || 'Unknown error',
    });
  }
}

/**
 * POST /credit/assess
 * Assess creditworthiness based on KYC profile
 */
export async function handleCreditAssess(
  request: FastifyRequest<{
    Body: {
      customer_id: string;
    };
  }>,
  reply: FastifyReply
): Promise<void> {
  const orgId = requireOrgId();
  const { customer_id } = request.body;
  
  const log = createContextLogger({
    orgId,
    corrId: request.corrId,
  });
  
  log.info({ customer_id }, 'Credit assessment request');

  // Check free tier limit
  const tierCheck = await checkFreeTierLimit(orgId);
  if (!tierCheck.allowed) {
    log.warn(
      { orgId, used: tierCheck.used, limit: tierCheck.limit },
      'Free tier limit exceeded'
    );
    reply.code(402).send({
      error: 'PAYMENT_REQUIRED',
      message: tierCheck.message,
      used: tierCheck.used,
      limit: tierCheck.limit,
      upgrade_url: process.env.UPGRADE_URL || 'https://example.com/upgrade',
    });
    return;
  }

  try {
    // Ensure profile is built and validated
    let dbRun = await getLatestRun(orgId, customer_id);
    
    if (!dbRun) {
      reply.code(404).send({
        error: 'NO_RUN_FOR_CUSTOMER',
        message: `No KYC run found for customer ${customer_id}`,
      });
      return;
    }

    // Build profile if missing
    if (!dbRun.profile) {
      await handleBuildKycProfile({ customer_id });
      dbRun = await getLatestRun(orgId, customer_id);
      if (!dbRun) {
        reply.code(500).send({ error: 'Failed to build profile' });
        return;
      }
    }

    // Validate profile if missing
    if (!dbRun.validation) {
      await handleValidateKycProfile({ customer_id });
      dbRun = await getLatestRun(orgId, customer_id);
      if (!dbRun) {
        reply.code(500).send({ error: 'Failed to validate profile' });
        return;
      }
    }

    const profile = dbRun.profile as KycProfile;
    const validation = dbRun.validation as KycValidationResult;

    // Extract transactions from bank_statement_transactions documents
    let transactions: Array<{
      date: string;
      direction: 'credit' | 'debit';
      amount: number;
      currency: string;
    }> | undefined;

    for (const doc of dbRun.docs) {
      if (doc.docType === 'bank_statement_transactions' && doc.extractedPayload) {
        const payload = doc.extractedPayload as any;
        if (payload.transactions && Array.isArray(payload.transactions)) {
          transactions = payload.transactions.map((tx: any) => ({
            date: tx.date,
            direction: tx.direction,
            amount: tx.amount,
            currency: tx.currency || 'MXN',
          }));
          break; // Use first transaction set found
        }
      }
    }

    // Use deterministic credit assessment
    const assessment = assessCredit(profile, validation, transactions);

    // Create immutable snapshot with hash
    const snapshot = createCreditSnapshot(
      assessment,
      profile,
      validation,
      dbRun.docs.map(doc => ({
        docType: doc.docType,
        extractedPayload: doc.extractedPayload,
      })),
      (dbRun as any).costUsd // Get costUsd from run if available
    );

    // Save decision (use run.id as decision_id)
    await saveDecision(dbRun.id, assessment.decision, profile, validation);
    const decisionId = dbRun.id; // Use run.id as decision_id

    // Log audit event with snapshot in payload
    await logAudit(orgId, 'credit_assessment', {
      customerId: customer_id,
      runId: dbRun.id,
      decisionId,
      decision: assessment.decision,
      score: assessment.score,
      limit: assessment.limit,
      confidence: assessment.confidence,
      reasonCodes: assessment.reasonCodes,
      calculation: assessment.calculation,
      snapshot, // Store immutable snapshot
    });
    
    // Record metrics
    metrics.creditAssessments.inc({ decision: assessment.decision });
    if (snapshot.costUsd > 0) {
      // Record cost per model in modelMix
      for (const [model, count] of Object.entries(snapshot.modelMix)) {
        metrics.apiCostUsd.inc({ model }, snapshot.costUsd * (count / Object.values(snapshot.modelMix).reduce((a, b) => a + b, 0)));
      }
    }
    
    log.info(
      {
        runId: dbRun.id,
        decisionId,
        decision: assessment.decision,
        limit: assessment.limit,
        confidence: assessment.confidence,
        snapshotHash: snapshot.snapshotHash,
      },
      'Credit assessment completed'
    );

    reply.send({
      decision_id: decisionId,
      limit: assessment.limit,
      terms: assessment.terms,
      score: assessment.score,
      confidence: assessment.confidence,
      flags: assessment.flags,
      reasons: assessment.reasons,
      reason_codes: assessment.reasonCodes,
      calculation: assessment.calculation,
    });
  } catch (error: any) {
    reply.code(500).send({
      error: 'INTERNAL_ERROR',
      message: error?.message || 'Unknown error',
    });
  }
}

/**
 * GET /audit/{decision_id}
 * Get audit information for a decision
 */
export async function handleGetAudit(
  request: FastifyRequest<{
    Params: {
      decision_id: string;
    };
  }>,
  reply: FastifyReply
): Promise<void> {
  const orgId = requireOrgId();
  const { decision_id } = request.params;
  
  const log = createContextLogger({
    orgId,
    decisionId: decision_id,
    corrId: request.corrId,
  });
  
  log.info({ decision_id }, 'Get audit request');

  try {
    // decision_id is the run.id - get the run directly
    const run = await prisma.run.findFirst({
      where: {
        id: decision_id,
        orgId, // Ensure org scoping
      },
      include: {
        docs: {
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });

    if (!run) {
      reply.code(404).send({
        error: 'RUN_NOT_FOUND',
        message: 'Run associated with decision not found',
      });
      return;
    }

    // Get all audit events for this run (using JSON path query)
    const auditEvents = await prisma.auditEvent.findMany({
      where: {
        orgId,
        OR: [
          {
            metadata: {
              path: ['runId'],
              equals: run.id,
            } as any,
          },
          {
            eventType: {
              in: ['document_imported', 'profile_built', 'profile_validated', 'credit_assessment'],
            },
          },
        ],
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    reply.send({
      decision_id,
      run_id: run.id,
      customer_id: run.customerId,
      decision: run.decision,
      score: (run.validation as any)?.score || null,
      created_at: run.updatedAt.toISOString(),
      profile: run.profile,
      validation: run.validation,
                audit_trail: auditEvents.map((e: any) => ({
        event_type: e.eventType,
        metadata: e.metadata,
        created_at: e.createdAt.toISOString(),
      })),
    });
  } catch (error: any) {
    reply.code(500).send({
      error: 'INTERNAL_ERROR',
      message: error?.message || 'Unknown error',
    });
  }
}

