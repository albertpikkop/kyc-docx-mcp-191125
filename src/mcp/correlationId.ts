/**
 * Correlation ID Middleware
 * 
 * Generates or extracts correlation ID from headers
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import * as crypto from 'crypto';

declare module 'fastify' {
  interface FastifyRequest {
    corrId?: string;
  }
}

/**
 * Generate correlation ID
 */
export function generateCorrelationId(): string {
  return crypto.randomUUID();
}

/**
 * Extract or generate correlation ID from request
 */
export function getCorrelationId(request: FastifyRequest): string {
  // Check for correlation ID in headers
  const headerId = request.headers['x-correlation-id'] as string | undefined;
  if (headerId) {
    return headerId;
  }
  
  // Generate new correlation ID
  const corrId = generateCorrelationId();
  request.corrId = corrId;
  return corrId;
}

/**
 * Middleware to set correlation ID
 */
export async function correlationIdMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const corrId = getCorrelationId(request);
  request.corrId = corrId;
  
  // Add to response headers
  reply.header('X-Correlation-ID', corrId);
}


