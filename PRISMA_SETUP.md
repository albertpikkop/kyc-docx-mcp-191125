# Prisma Setup and Fastify API Key Authentication

## Overview

This document describes the Prisma database setup and Fastify API key authentication middleware added to the KYC MCP server.

## Prisma Schema

Located at `prisma/schema.prisma` with the following models:

- **Org**: Organizations identified by API key
- **Run**: KYC runs scoped to an organization and customer
- **Doc**: Documents attached to runs
- **AuditEvent**: Audit trail for organization actions

## Database Helpers

Located at `src/kyc/prismaHelpers.ts`:

- `getOrCreateOrg(apiKey)`: Get or create organization by API key
- `createRun(orgId, customerId)`: Create a new KYC run
- `appendDoc(runId, doc)`: Append a document to a run
- `saveDecision(runId, decision, profile?, validation?)`: Save decision with optional profile/validation
- `logAudit(orgId, eventType, metadata?)`: Log an audit event
- `getLatestRun(orgId, customerId)`: Get the latest run for an org/customer
- `updateRun(runId, data)`: Update run with profile/validation/status

**All operations require `orgId`** to ensure proper scoping.

## Fastify Middleware

Located at `src/mcp/middleware.ts`:

### API Key Authentication

- Reads `x-api-key` header from requests
- Looks up or creates Org by API key
- Attaches `req.org` with `{ id: string }`
- Returns **401** if API key is missing or invalid

### Rate Limiting

- **60 requests per minute per organization**
- Uses `orgId` as the rate limit key
- Returns **429** status code when limit exceeded
- Error message: "Maximum 60 requests per minute per organization"

## Server Updates

The server (`src/mcp/server.ts`) now:

1. Uses **Fastify** instead of Express for SSE transport
2. Registers rate limiting plugin
3. Applies API key authentication to all routes via `preHandler` hook
4. All routes have access to `request.org.id` after authentication

## Scripts

Added to `package.json`:

- `npm run prisma:generate`: Generate Prisma client
- `npm run prisma:migrate`: Run Prisma migrations (dev mode)

## Usage

### Generate Prisma Client

```bash
npm run prisma:generate
```

Note: Requires `DATABASE_URL` environment variable (can be placeholder for generation).

### Run Migrations

```bash
npm run prisma:migrate
```

### Making Requests

All HTTP requests must include the `x-api-key` header:

```bash
curl -H "x-api-key: your-api-key-here" http://localhost:3000/sse
```

## Status Codes

- **401**: Missing or invalid API key
- **429**: Rate limit exceeded (60 req/min per org)

## Next Steps

The Prisma helpers are ready to use. To migrate from file-based storage:

1. Update handlers in `src/mcp/server.ts` to use Prisma helpers
2. Replace `loadLatestRun`/`saveRun` calls with Prisma equivalents
3. Ensure all operations pass `orgId` from `request.org.id`


