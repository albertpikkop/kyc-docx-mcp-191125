/**
 * Fastify Middleware for API Key Authentication and Rate Limiting
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { getOrCreateOrg } from '../kyc/prismaHelpers.js';

declare module 'fastify' {
  interface FastifyRequest {
    org?: { id: string };
  }
}

/**
 * PreHandler middleware that reads x-api-key header, looks up Org, and attaches req.org
 * Returns 401 if API key is missing or invalid
 */
export async function apiKeyAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const apiKey = request.headers['x-api-key'] as string | undefined;

  if (!apiKey) {
    reply.code(401).send({ error: 'Missing x-api-key header' });
    return;
  }

  try {
    const org = await getOrCreateOrg(apiKey);
    request.org = org;
  } catch (error) {
    reply.code(401).send({ error: 'Invalid API key' });
    return;
  }
}

/**
 * Rate limiting configuration: 60 requests per minute per org
 * Returns 429 status code on violation
 */
export const rateLimitConfig = {
  max: 60,
  timeWindow: 60 * 1000, // 1 minute in milliseconds
  keyGenerator: (request: FastifyRequest): string => {
    // Use orgId for rate limiting key
    const orgId = request.org?.id;
    if (!orgId) {
      // Fallback to IP if org not set (shouldn't happen if apiKeyAuth runs first)
      return request.ip || 'unknown';
    }
    return `org:${orgId}`;
  },
  errorResponseBuilder: (_request: FastifyRequest, _context: any) => {
    // @fastify/rate-limit automatically sets status 429
    return {
      error: 'Rate limit exceeded',
      message: 'Maximum 60 requests per minute per organization',
    };
  },
};

