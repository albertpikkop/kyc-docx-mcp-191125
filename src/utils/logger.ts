/**
 * Pino Logger with Structured Fields
 * 
 * Includes orgId, runId, decisionId, corrId in logs
 */

import pino from 'pino';

// Create base logger
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'development' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss Z',
      ignore: 'pid,hostname',
    },
  } : undefined,
  base: {
    service: 'kyc-mcp',
    version: '1.0.0',
  },
});

/**
 * Create child logger with context fields
 */
export function createContextLogger(context: {
  orgId?: string;
  runId?: string;
  decisionId?: string;
  corrId?: string;
}) {
  return logger.child(context);
}

/**
 * Get logger from Fastify request (if available)
 */
export function getLoggerFromRequest(request: any): pino.Logger {
  if (request.log) {
    return request.log;
  }
  return logger;
}


