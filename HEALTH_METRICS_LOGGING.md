# Health, Metrics, Logging, and Free Tier

## Health Endpoints

### GET /healthz
Simple health check - returns OK if server is running.

**Response:**
```json
{ "status": "ok" }
```

### GET /readyz
Readiness check - verifies DB and storage connectivity.

**Response (200):**
```json
{
  "status": "ready",
  "checks": {
    "database": true,
    "storage": true
  }
}
```

**Response (503):**
```json
{
  "status": "not_ready",
  "checks": {
    "database": false,
    "storage": true
  }
}
```

### GET /metrics
Prometheus metrics endpoint.

**Response:** Prometheus text format

**Metrics:**
- `http_request_duration_seconds` - Request duration histogram
- `http_requests_total` - Total HTTP requests counter
- `kyc_active_runs` - Active KYC runs gauge
- `kyc_document_extractions_total` - Document extractions counter (by doc_type, model)
- `kyc_credit_assessments_total` - Credit assessments counter (by decision)
- `kyc_api_cost_usd_total` - Total API costs counter (by model)

## Logging

### Pino Logger
Structured logging with context fields:
- `orgId` - Organization ID
- `runId` - KYC run ID
- `decisionId` - Credit decision ID
- `corrId` - Correlation ID (from `x-correlation-id` header or auto-generated)

### Usage
```typescript
import { createContextLogger } from '../utils/logger.js';

const log = createContextLogger({
  orgId: 'org-123',
  runId: 'run-456',
  corrId: 'corr-789',
});

log.info({ customer_id: 'customer-123' }, 'Processing request');
log.error({ error: err.message }, 'Request failed');
```

### Correlation ID
- Automatically generated for each request
- Can be provided via `x-correlation-id` header
- Included in response headers as `X-Correlation-ID`
- Included in all log entries

## Free Tier Limiter

### Configuration
Set `FREE_DECISIONS_PER_ORG` environment variable (default: 10)

### Behavior
- Tracks credit assessments per organization via `AuditEvent` count
- Returns **402 Payment Required** when limit exceeded
- Friendly error message with upgrade URL

### Response (402)
```json
{
  "error": "PAYMENT_REQUIRED",
  "message": "You have reached the free tier limit of 10 credit assessments. Please upgrade your plan to continue.",
  "used": 10,
  "limit": 10,
  "upgrade_url": "https://example.com/upgrade"
}
```

### Spanish Response (402)
```json
{
  "error": "PAYMENT_REQUIRED",
  "message": "Ha alcanzado el límite de 10 evaluaciones de crédito del plan gratuito. Por favor, actualice su plan para continuar.",
  "used": 10,
  "limit": 10,
  "upgrade_url": "https://example.com/upgrade"
}
```

## Spanish Examples

OpenAPI spec includes Mexican Spanish examples with:
- RFC: `ABC123456789`
- Razón Social: `Empresa Mexicana S.A. de C.V.`
- CURP: `ABCDEFGHIJ12345678`

Examples available for:
- `/kyc/check` - Acta, SAT Constancia, FM2
- `/credit/assess` - Credit assessment responses
- Error responses (402, 404, etc.)

## Performance

- Health endpoints: No authentication required
- Metrics endpoint: No authentication required
- All other endpoints: Require `x-api-key` header
- First-run completion target: <3 minutes


