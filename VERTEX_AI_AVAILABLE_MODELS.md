# Vertex AI Available Models

## ✅ Available Model

### `gemini-2.0-flash-exp`
- **Status**: ✅ Available and Working
- **Type**: Experimental Gemini 2.0 Flash
- **Tested**: ✅ Verified working
- **Location**: `us-central1`
- **Project**: `gpounj-40b74`

## ❌ Unavailable Models

The following models were tested but are **NOT available** in Vertex AI for this project:

### Gemini 3.0 Models
- ❌ `gemini-3.0-pro`
- ❌ `gemini-3.0-flash`
- ❌ `gemini-3-pro-preview`
- ❌ `gemini-3-flash-preview`
- ❌ `gemini-3.0-pro-001`
- ❌ `gemini-3.0-flash-001`

### Gemini 2.0 Models
- ✅ `gemini-2.0-flash-exp` (AVAILABLE)
- ❌ `gemini-2.0-pro-exp`

### Gemini 1.5 Models
- ❌ `gemini-1.5-pro`
- ❌ `gemini-1.5-flash`
- ❌ `gemini-1.5-pro-001`
- ❌ `gemini-1.5-flash-001`
- ❌ `gemini-1.5-pro-002`
- ❌ `gemini-1.5-flash-002`
- ❌ `gemini-1.5-pro-latest`
- ❌ `gemini-1.5-flash-latest`

### Gemini 1.0 Models
- ❌ `gemini-pro`
- ❌ `gemini-pro-vision`

### Experimental
- ❌ `gemini-pro-experimental`
- ❌ `gemini-flash-experimental`

## Configuration

The default Vertex AI model has been updated to use the available model:

```typescript
// src/modelVertex.ts
export const VERTEX_MODEL = "gemini-2.0-flash-exp";
```

## Usage

### Option 1: Use Vertex AI with Available Model

```bash
export GOOGLE_CLOUD_PROJECT=gpounj-40b74
unset GEMINI_API_KEY  # Ensure we use Vertex AI, not standard API
npm run test:vertex:grupo-pounj
```

This will use `gemini-2.0-flash-exp` via Vertex AI.

### Option 2: Use Standard Gemini API (Gemini 3.0 Pro)

```bash
export GEMINI_API_KEY="your-api-key"
npm run test:vertex:grupo-pounj
```

This will automatically use `gemini-3-pro-preview` (Gemini 3.0 Pro) via standard Gemini API.

## Model Comparison

| Model | API | Status | Notes |
|-------|-----|--------|-------|
| `gemini-2.0-flash-exp` | Vertex AI | ✅ Available | Experimental, fast |
| `gemini-3-pro-preview` | Standard API | ✅ Available | Latest, requires API key |

## Recommendations

1. **For Vertex AI**: Use `gemini-2.0-flash-exp` (already configured)
2. **For Latest Features**: Use standard Gemini API with `gemini-3-pro-preview` (Gemini 3.0 Pro)
3. **For Production**: Consider requesting access to stable Gemini models in Vertex AI

## Test Results

```
✅ Vertex AI Client: Working
✅ Model: gemini-2.0-flash-exp
✅ API Call: Working
✅ Response: "Hello from Vertex AI."
```

## Next Steps

1. ✅ **Vertex AI**: Configured to use `gemini-2.0-flash-exp`
2. ✅ **Standard API**: Available with `gemini-3-pro-preview` (when `GEMINI_API_KEY` is set)
3. 💡 **Future**: Request access to more Gemini models in Vertex AI if needed

