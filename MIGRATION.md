# Database Migration Plan

This document outlines the strategy for migrating from file-based storage to a production-grade database system for the KYC Docx MCP.

## Current State
- **Storage:** Local filesystem (`data/{customerId}/run-{runId}.json`).
- **Format:** JSON files containing `KycRun` objects (metadata + documents + profile + validation).
- **Concurrency:** None (single process access assumed).
- **Querying:** Linear scan of files per customer.

## Target State
- **Database:** PostgreSQL (v14+).
- **ORM:** Prisma or Drizzle (for type safety).
- **Concurrency:** Row-level locking for run updates.
- **Querying:** Indexed lookups by customer, run ID, date.

## Schema Design

### Tables

1.  **`customers`**
    *   `id` (UUID, PK)
    *   `external_id` (String, Unique) - e.g., "pfds"
    *   `created_at` (Timestamp)

2.  **`kyc_runs`**
    *   `id` (UUID, PK)
    *   `customer_id` (UUID, FK -> customers.id)
    *   `status` (Enum: 'pending', 'processing', 'completed', 'failed')
    *   `created_at` (Timestamp)
    *   `updated_at` (Timestamp)
    *   `profile_snapshot` (JSONB) - Stores the final `KycProfile`
    *   `validation_result` (JSONB) - Stores `KycValidationResult`

3.  **`kyc_documents`**
    *   `id` (UUID, PK)
    *   `run_id` (UUID, FK -> kyc_runs.id)
    *   `doc_type` (Enum: 'acta', 'sat', 'fm2', 'proof_address', 'bank')
    *   `file_url` (String)
    *   `source_name` (String)
    *   `extracted_data` (JSONB) - The raw extraction result
    *   `created_at` (Timestamp)

4.  **`addresses`** (Optional normalization)
    *   If strict address management is needed, extracted addresses could be normalized into a separate table linked to documents.

## Migration Strategy

### Phase 1: Parallel Write (Dual Store)
1.  Implement a `DatabaseStorage` class implementing the same interface as `src/kyc/storage.ts`.
2.  Update `saveRun` to write to BOTH filesystem and Database.
3.  Keep `loadLatestRun` reading from filesystem for safety.

### Phase 2: Backfill
1.  Write a script to iterate over `data/` directories.
2.  Parse each `run-*.json`.
3.  Insert into PostgreSQL tables, handling upserts (idempotency).

### Phase 3: Cutover
1.  Switch `loadLatestRun` to read from Database (`SELECT * FROM kyc_runs WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1`).
2.  Deprecate filesystem writes (or keep as backup/audit log).

## Authentication & Security
- **Database Access:** Use environment variables for connection strings (`DATABASE_URL`).
- **Row Level Security (RLS):** If exposing directly to users, enable RLS on `customer_id`.
- **Encryption:** Encrypt sensitive JSONB fields (PII) at rest if required by compliance.

## Code Changes Required
- `src/kyc/storage.ts`: Refactor to support swappable backends.
- `src/kyc/types.ts`: Ensure types align with DB schema (mostly JSONB mapping).
- New `src/db/`: Database connection and schema definitions.

