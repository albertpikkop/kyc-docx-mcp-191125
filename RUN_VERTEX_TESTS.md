# Running Vertex AI 3.0 Pro Tests for Three Clients

## Quick Start

I've created test files for all three clients using Vertex AI 3.0 Pro:

1. **PFDS**: `src/tests/testKycEndToEndPFDSVertex.ts`
2. **Grupo Pounj**: `src/tests/testKycEndToEndGrupoPounjVertex.ts`
3. **Enrique Cello**: `src/tests/testKycEndToEndEnriqueCelloVertex.ts`

## Prerequisites

Before running the tests, you need to set up Google Cloud authentication:

### 1. Set Environment Variables

```bash
export GOOGLE_CLOUD_PROJECT="your-project-id"
export GOOGLE_CLOUD_LOCATION="us-central1"  # or your preferred region
```

### 2. Authenticate with Google Cloud

**Option A: Application Default Credentials (Recommended for Development)**

```bash
gcloud auth application-default login
```

This will open a browser for authentication.

**Option B: Service Account Key (Recommended for Production)**

1. Create a service account in GCP Console
2. Grant it the "Vertex AI User" role
3. Download the JSON key file
4. Set the environment variable:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account-key.json"
```

### 3. Enable Vertex AI API

```bash
gcloud services enable aiplatform.googleapis.com
```

Or enable it through the [GCP Console](https://console.cloud.google.com/apis/library/aiplatform.googleapis.com).

## Running the Tests

### Run Individual Client Tests

```bash
# PFDS
npm run test:vertex:pfds

# Grupo Pounj
npm run test:vertex:grupo-pounj

# Enrique Cello
npm run test:vertex:enrique-cello
```

### Run All Three Clients

```bash
npm run test:vertex:all
```

This will run all three tests sequentially:
1. PFDS
2. Grupo Pounj
3. Enrique Cello

## What Each Test Does

Each test:
1. ✅ Processes all documents for that client using Vertex AI 3.0 Pro
2. ✅ Extracts structured data from:
   - Acta Constitutiva (PFDS, Grupo Pounj)
   - SAT Constancia
   - FM2/INE documents
   - Proof of Address (CFE, Telmex)
   - Bank Statements
3. ✅ Builds a complete KYC profile
4. ✅ Validates the profile
5. ✅ Generates HTML and Excel reports
6. ✅ Saves results to `data/{client-name}-vertex/`

## Expected Output

Each test will:
- Show progress for each document being processed
- Display success/error messages for each extraction
- Generate reports in the `data/` directory
- Open the HTML report automatically (if on macOS)

## Troubleshooting

### Error: "GOOGLE_CLOUD_PROJECT is not set"

**Solution**: Set the environment variable:
```bash
export GOOGLE_CLOUD_PROJECT="your-project-id"
```

### Error: "Unable to authenticate your request"

**Solution**: Authenticate with Google Cloud:
```bash
gcloud auth application-default login
```

### Error: "API not enabled" or "Permission denied"

**Solution**: 
1. Enable Vertex AI API: `gcloud services enable aiplatform.googleapis.com`
2. Ensure your account/service account has "Vertex AI User" role

### Error: "Model not found" or "Invalid model path"

**Solution**: 
- Verify Gemini 3.0 Pro is available in your region
- Check that Vertex AI API is enabled
- Ensure you're using a supported region (e.g., `us-central1`)

## Test Results Location

Results are saved to:
- `data/pfds-vertex/` - PFDS test results
- `data/grupo-pounj-vertex/` - Grupo Pounj test results  
- `data/enrique-cello-vertex/` - Enrique Cello test results

Each directory contains:
- `runs/` - JSON files with extraction results
- `reports/` - HTML and Excel reports

## Notes

- Tests use **Gemini 3.0 Pro** model via Vertex AI
- All extractions use the same schemas and instructions as the standard Gemini tests
- Results are saved with customer ID suffix `-vertex` to distinguish from other runs
- The tests process documents sequentially (one at a time) to avoid rate limits

