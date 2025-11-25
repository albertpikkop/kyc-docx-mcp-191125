/**
 * Health, Readiness, and Metrics Endpoints
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../kyc/prismaHelpers.js';
import { isS3Configured } from '../kyc/s3Storage.js';
import { Registry, Counter, Histogram, Gauge } from 'prom-client';

// Prometheus metrics registry
const register = new Registry();

// Define metrics
const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.1, 0.5, 1, 2, 5],
  registers: [register],
});

const httpRequestTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

const activeRuns = new Gauge({
  name: 'kyc_active_runs',
  help: 'Number of active KYC runs',
  labelNames: ['status'],
  registers: [register],
});

const documentExtractions = new Counter({
  name: 'kyc_document_extractions_total',
  help: 'Total number of document extractions',
  labelNames: ['doc_type', 'model'],
  registers: [register],
});

const creditAssessments = new Counter({
  name: 'kyc_credit_assessments_total',
  help: 'Total number of credit assessments',
  labelNames: ['decision'],
  registers: [register],
});

const apiCostUsd = new Counter({
  name: 'kyc_api_cost_usd_total',
  help: 'Total API costs in USD',
  labelNames: ['model'],
  registers: [register],
});

const geminiCallsTotal = new Counter({
  name: 'gemini_calls_total',
  help: 'Total number of Gemini API calls',
  labelNames: ['status'], // success, error
  registers: [register],
});

const geminiErrorsTotal = new Counter({
  name: 'gemini_errors_total',
  help: 'Total number of Gemini API errors',
  labelNames: ['code'], // error code or type
  registers: [register],
});

const geminiLatencyMs = new Histogram({
  name: 'gemini_latency_ms',
  help: 'Latency of Gemini API calls in milliseconds',
  buckets: [500, 1000, 2000, 5000, 10000, 20000, 30000],
  registers: [register],
});

// Export metrics for use in other modules
export const metrics = {
  httpRequestDuration,
  httpRequestTotal,
  activeRuns,
  documentExtractions,
  creditAssessments,
  apiCostUsd,
  geminiCallsTotal,
  geminiErrorsTotal,
  geminiLatencyMs,
};

/**
 * GET /healthz
 * Simple health check - returns OK if server is running
 */
export async function handleHealthz(
  _request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  reply.send({ status: 'ok' });
}

/**
 * GET /readyz
 * Readiness check - verifies DB and storage connectivity
 */
export async function handleReadyz(
  _request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const checks: Record<string, boolean> = {};
  let allReady = true;

  // Check database connectivity
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = true;
  } catch (error) {
    checks.database = false;
    allReady = false;
  }

  // Check storage (S3 if configured, otherwise filesystem is always available)
  try {
    if (isS3Configured()) {
      // S3 is configured - consider it ready (actual connectivity tested on use)
      checks.storage = true;
    } else {
      // Filesystem storage is always available
      checks.storage = true;
    }
  } catch (error) {
    checks.storage = false;
    allReady = false;
  }

  if (allReady) {
    reply.send({
      status: 'ready',
      checks,
    });
  } else {
    reply.code(503).send({
      status: 'not_ready',
      checks,
    });
  }
}

/**
 * GET /metrics
 * Prometheus metrics endpoint
 */
export async function handleMetrics(
  _request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  reply.type('text/plain').send(await register.metrics());
}

