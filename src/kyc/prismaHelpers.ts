/**
 * Prisma Database Helpers
 * 
 * Helper functions for Org, Run, Doc, and AuditEvent operations.
 * All operations are scoped to an organization (orgId).
 */

// Prisma client will be generated after running: npm run prisma:generate
import { KycProfile, KycValidationResult } from './types.js';

// Try to import Prisma client, fallback to mock if not available
let prisma: any;
try {
  // @ts-ignore - Generated file, will exist after prisma generate
  const prismaModule = require('../generated/prisma/index.js');
  const PrismaClient = prismaModule.PrismaClient || prismaModule.default?.PrismaClient;
  if (PrismaClient) {
    prisma = new PrismaClient();
  } else {
    throw new Error('PrismaClient not found');
  }
} catch (error) {
  // Prisma not generated or not available - use mock that throws helpful errors
  console.warn('⚠️  Prisma client not available. Database operations will fail.');
  console.warn('   To fix: Set DATABASE_URL and run: npm run prisma:generate');
  prisma = {
    org: {
      upsert: () => Promise.reject(new Error('Prisma not initialized. Set DATABASE_URL and run: npm run prisma:generate')),
      findFirst: () => Promise.reject(new Error('Prisma not initialized')),
    },
    run: {
      findFirst: () => Promise.reject(new Error('Prisma not initialized. Set DATABASE_URL and run: npm run prisma:generate')),
      create: () => Promise.reject(new Error('Prisma not initialized')),
      update: () => Promise.reject(new Error('Prisma not initialized')),
    },
    doc: {
      create: () => Promise.reject(new Error('Prisma not initialized')),
    },
    auditEvent: {
      create: () => Promise.reject(new Error('Prisma not initialized')),
    },
  };
}

/**
 * Get or create an organization by API key
 */
export async function getOrCreateOrg(apiKey: string): Promise<{ id: string }> {
  const org = await prisma.org.upsert({
    where: { apiKey },
    update: {},
    create: {
      apiKey,
      name: null,
    },
    select: { id: true },
  });
  return org;
}

/**
 * Create a new KYC run for an organization and customer
 */
export async function createRun(
  orgId: string,
  customerId: string
): Promise<{ id: string }> {
  const run = await prisma.run.create({
    data: {
      orgId,
      customerId,
      status: 'pending',
    },
    select: { id: true },
  });
  return run;
}

/**
 * Append a document to a run
 */
export async function appendDoc(
  runId: string,
  doc: {
    docType: string;
    fileUrl: string;
    sourceName?: string;
    extractedPayload?: unknown;
  }
): Promise<{ id: string }> {
  const docRecord = await prisma.doc.create({
    data: {
      runId,
      docType: doc.docType,
      fileUrl: doc.fileUrl,
      sourceName: doc.sourceName ?? null,
      extractedPayload: doc.extractedPayload ? (doc.extractedPayload as object) : null,
    },
    select: { id: true },
  });
  return docRecord;
}

/**
 * Save a decision (approval/rejection) for a run
 */
export async function saveDecision(
  runId: string,
  decision: 'approved' | 'rejected' | 'pending',
  profile?: KycProfile,
  validation?: KycValidationResult
): Promise<void> {
  await prisma.run.update({
    where: { id: runId },
    data: {
      decision,
      profile: profile ? (profile as object) : undefined,
      validation: validation ? (validation as object) : undefined,
      status: 'completed',
      updatedAt: new Date(),
    },
  });
}

/**
 * Log an audit event for an organization
 * Silently fails if Prisma is not available (non-critical operation)
 */
export async function logAudit(
  orgId: string,
  eventType: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        orgId,
        eventType,
        metadata: metadata ? (metadata as object) : null,
      },
    });
  } catch (e) {
    // Silently fail - audit logging is non-critical
    console.warn(`Audit logging failed for ${eventType}: Prisma not available`);
  }
}

/**
 * Get the latest run for an org and customer
 */
export async function getLatestRun(
  orgId: string,
  customerId: string
): Promise<{
  id: string;
  customerId: string;
  status: string | null;
  profile: unknown;
  validation: unknown;
  decision: string | null;
  createdAt: Date;
  docs: Array<{
    id: string;
    docType: string;
    fileUrl: string;
    sourceName: string | null;
    extractedPayload: unknown;
    createdAt: Date;
  }>;
} | null> {
  const run = await prisma.run.findFirst({
    where: {
      orgId,
      customerId,
    },
    orderBy: {
      createdAt: 'desc',
    },
    include: {
      docs: {
        orderBy: {
          createdAt: 'asc',
        },
      },
    },
  });
  return run;
}

/**
 * Update run with profile and/or validation
 */
export async function updateRun(
  runId: string,
  data: {
    profile?: KycProfile;
    validation?: KycValidationResult;
    status?: string;
  }
): Promise<void> {
  await prisma.run.update({
    where: { id: runId },
    data: {
      profile: data.profile ? (data.profile as object) : undefined,
      validation: data.validation ? (data.validation as object) : undefined,
      status: data.status,
      updatedAt: new Date(),
    },
  });
}

export { prisma };

