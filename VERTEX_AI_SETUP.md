# Vertex AI Integration Setup and Testing

This project now includes Vertex AI integration for using Gemini models through Google Cloud Platform.

## Overview

Vertex AI provides access to Gemini models (using `gemini-3.0-pro`) through Google Cloud Platform, offering:
- Enterprise-grade security and compliance
- Better cost management through GCP billing
- Integration with other GCP services
- Same model capabilities as the standard Gemini API

## Prerequisites

1. **Google Cloud Project**: You need a GCP project with Vertex AI API enabled
2. **Authentication**: Set up Google Cloud authentication
3. **Environment Variables**: Configure project and location

## Setup Steps

### 1. Install Dependencies

The required packages are already installed:
- `@google-cloud/vertexai` - Vertex AI Generative AI client

### 2. Set Environment Variables

```bash
# Required: Your Google Cloud Project ID
export GOOGLE_CLOUD_PROJECT="your-project-id"
# OR
export GCP_PROJECT="your-project-id"

# Optional: Location/region (defaults to us-central1)
export GOOGLE_CLOUD_LOCATION="us-central1"
# OR
export GCP_LOCATION="us-central1"
```

### 3. Authenticate with Google Cloud

You have two options:

#### Option A: Application Default Credentials (Recommended for Development)

```bash
gcloud auth application-default login
```

This will open a browser to authenticate and store credentials locally.

#### Option B: Service Account Key (Recommended for Production)

1. Create a service account in GCP Console
2. Grant it the "Vertex AI User" role
3. Download the JSON key file
4. Set the environment variable:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account-key.json"
```

### 4. Enable Vertex AI API

```bash
gcloud services enable aiplatform.googleapis.com
```

Or enable it through the [GCP Console](https://console.cloud.google.com/apis/library/aiplatform.googleapis.com).

## Testing

### Basic Test (No File Required)

Test the Vertex AI client and a simple text prediction:

```bash
npm run test:vertex
```

Or directly:

```bash
tsx test_vertex_api.ts
```

### Test with Document Extraction

Test document extraction with a sample file:

```bash
tsx test_vertex_api.ts /path/to/your/document.pdf
```

The test script will:
1. ✅ Test Vertex AI client creation
2. ✅ Test simple text prediction
3. ✅ Test document extraction (if file provided)

## Implementation Details

### Files Created

1. **`src/modelVertex.ts`**: Vertex AI client configuration
   - `getVertexClient()`: Creates and returns a Vertex AI client
   - `VERTEX_MODEL`: Model name constant (`gemini-3.0-pro`)

2. **`src/utils/vertexExtractor.ts`**: Document extraction using Vertex AI
   - `extractWithVertex()`: Extracts structured data from documents
   - Similar API to `extractWithGemini()` but uses Vertex AI endpoints

3. **`test_vertex_api.ts`**: Test script for validation

### Usage in Code

```typescript
import { extractWithVertex } from './src/utils/vertexExtractor.js';

const result = await extractWithVertex(
  '/path/to/document.pdf',
  'application/pdf',
  schema,
  instructions
);
```

## Troubleshooting

### Error: "GOOGLE_CLOUD_PROJECT is not set"

**Solution**: Set the environment variable:
```bash
export GOOGLE_CLOUD_PROJECT="your-project-id"
```

### Error: "Could not load the default credentials"

**Solution**: Authenticate with Google Cloud:
```bash
gcloud auth application-default login
```

Or set `GOOGLE_APPLICATION_CREDENTIALS` to a service account key file.

### Error: "API not enabled" or "Permission denied"

**Solution**: 
1. Enable Vertex AI API: `gcloud services enable aiplatform.googleapis.com`
2. Ensure your account/service account has "Vertex AI User" role

### Error: "Model not found" or "Invalid model path"

**Solution**: 
- Verify the model name is correct (`gemini-3.0-pro`)
- Check that Vertex AI API is enabled in your project
- Ensure you're using a supported region (e.g., `us-central1`)

### Error: "Request timed out"

**Solution**:
- Check your network connectivity
- Verify firewall rules allow outbound HTTPS to `*.googleapis.com`
- Try increasing the timeout in `vertexExtractor.ts`

## Differences from Standard Gemini API

| Feature | Standard Gemini API | Vertex AI |
|--------|---------------------|-----------|
| Authentication | API Key | Google Cloud Credentials |
| Billing | Direct to Google | Through GCP |
| Endpoint | `generativelanguage.googleapis.com` | `{location}-aiplatform.googleapis.com` |
| Package | `@google/generative-ai` | `@google-cloud/vertexai` |
| Model Access | Same models | Same models |

## Cost Considerations

- Vertex AI pricing is similar to standard Gemini API
- Billing goes through your GCP account
- You can set up budgets and alerts in GCP Console
- Check [Vertex AI Pricing](https://cloud.google.com/vertex-ai/pricing) for current rates

## Next Steps

1. **Integrate into Model Router**: Add Vertex AI as an option in `src/utils/modelRouter.ts`
2. **Add to Config**: Include Vertex AI in routing rules (`src/config/router.rules.json`)
3. **Cost Tracking**: Integrate with your cost tracking system
4. **Production Setup**: Use service account authentication for production deployments

## Additional Resources

- [Vertex AI Documentation](https://cloud.google.com/vertex-ai/docs)
- [Vertex AI Generative AI Client](https://cloud.google.com/vertex-ai/docs/generative-ai/model-reference/gemini)
- [Google Cloud Authentication](https://cloud.google.com/docs/authentication)

