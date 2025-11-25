# Deterministic Credit Assessment Rules

## Overview

Credit assessment uses deterministic rules based on bank statement analysis, KYC validation, and document coverage.

## Rules

### 1. Base Limit Calculation
```
baseLimit = avgMonthlyInflow * 0.15
```

The base credit limit is 15% of the average monthly credit inflow from bank statements.

### 2. Flag-Based Reduction
```
reduction = 20% per critical flag, up to 50% maximum
afterFlagReduction = baseLimit * (1 - reduction)
```

Critical validation flags reduce the limit by 20% each, capped at 50% total reduction.

### 3. Balance Cap
```
balanceCap = minBalance * 1.5
finalLimit = min(afterFlagReduction, balanceCap)
```

The final limit is capped at 1.5x the minimum balance observed in transactions. This cap only applies if balance data is available.

### 4. Confidence Score
```
confidence = 0.6 + (documentCoverage * 0.3)
```

Confidence ranges from 0.6 (low coverage) to 0.9 (high coverage), based on document completeness.

### 5. Reason Codes
At least 3 reason codes are returned, including:
- `BASE_INFLOW_CALCULATED` or `NO_INFLOW_DATA`
- `CRITICAL_FLAGS_DETECTED` or `NO_CRITICAL_FLAGS`
- `BALANCE_CAP_APPLIED` or `BALANCE_CAP_NOT_LIMITING`
- `HIGH_DOC_COVERAGE`, `MODERATE_DOC_COVERAGE`, or `LOW_DOC_COVERAGE`
- `TAX_STATUS_ACTIVE` or `TAX_STATUS_INACTIVE`
- `BANK_ACCOUNT_VERIFIED` or `NO_BANK_ACCOUNT`
- Additional flag-specific codes (e.g., `FLAG_ADDRESS_MISMATCH`)

## Document Coverage Calculation

Coverage is calculated based on presence of:
- Company Identity (20%)
- Tax Profile (20%)
- Representative Identity (15%)
- Current Address (15%)
- Proof of Address (15%)
- Bank Account (15%)

Total: 100% coverage when all documents present.

## Example Calculation

**Input:**
- Average monthly inflow: $1,000,000 MXN
- Minimum balance: $50,000 MXN
- Critical flags: 0
- Document coverage: 90%

**Calculation:**
1. Base limit: $1,000,000 * 0.15 = $150,000
2. Flag reduction: 0% (no critical flags)
3. After reduction: $150,000
4. Balance cap: $50,000 * 1.5 = $75,000
5. Final limit: min($150,000, $75,000) = $75,000
6. Confidence: 0.6 + (0.9 * 0.3) = 0.87

**Result:**
- Limit: $75,000 MXN
- Confidence: 0.87
- Reason codes: `BASE_INFLOW_CALCULATED`, `NO_CRITICAL_FLAGS`, `BALANCE_CAP_APPLIED`, `HIGH_DOC_COVERAGE`, etc.

## API Response

The `/credit/assess` endpoint returns:

```json
{
  "decision_id": "uuid",
  "limit": 75000,
  "terms": "Standard terms: 30-day payment, 2% monthly interest, 75k MXN limit",
  "score": 0.85,
  "confidence": 0.87,
  "flags": [...],
  "reasons": [
    "Approved based on 85% KYC score",
    "Monthly inflow: $1,000,000.00",
    "Calculated limit: $75,000.00"
  ],
  "reason_codes": [
    "BASE_INFLOW_CALCULATED",
    "NO_CRITICAL_FLAGS",
    "BALANCE_CAP_APPLIED",
    "HIGH_DOC_COVERAGE",
    "TAX_STATUS_ACTIVE",
    "BANK_ACCOUNT_VERIFIED"
  ],
  "calculation": {
    "avgMonthlyInflow": 1000000,
    "baseLimit": 150000,
    "flagReduction": 0,
    "flagReductionPercent": 0,
    "afterFlagReduction": 150000,
    "minBalance": 50000,
    "balanceCap": 75000,
    "finalLimit": 75000,
    "documentCoverage": 0.9
  }
}
```

## Implementation

Located in `src/kyc/creditAssessment.ts`:
- `assessCredit()` - Main assessment function
- `calculateAvgMonthlyInflow()` - Calculates average monthly credits
- `calculateMinBalance()` - Finds minimum balance from transactions
- `calculateDocumentCoverage()` - Computes document completeness
- `calculateConfidence()` - Maps coverage to confidence score
- `calculateFlagReduction()` - Applies flag-based reductions
- `generateReasonCodes()` - Generates ≥3 reason codes

## Integration

The credit assessment is integrated into:
- `POST /credit/assess` endpoint in `src/mcp/restApi.ts`
- Extracts transactions from `bank_statement_transactions` documents
- Uses KYC profile and validation results
- Stores decision and calculation details in audit log


