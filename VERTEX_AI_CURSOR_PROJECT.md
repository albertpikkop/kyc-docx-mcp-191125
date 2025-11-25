# Vertex AI Configuration - Cursor Project

## ✅ Correct Project

**Project ID**: `gen-lang-client-0306628183`  
**Project Name**: Cursor  
**Status**: ✅ Working

## Available Models

### ✅ `gemini-2.0-flash-exp`
- **Status**: Available and Working
- **Type**: Experimental Gemini 2.0 Flash
- **Tested**: ✅ Verified working
- **Location**: `us-central1`

## Configuration

### Environment Variables

```bash
# Use Cursor project for Vertex AI
export GOOGLE_CLOUD_PROJECT=gen-lang-client-0306628183
export GOOGLE_CLOUD_LOCATION=us-central1

# To use Vertex AI (not standard API), ensure GEMINI_API_KEY is NOT set
unset GEMINI_API_KEY
```

### Model Configuration

The model is configured in `src/modelVertex.ts`:
```typescript
export const VERTEX_MODEL = "gemini-2.0-flash-exp";
```

## Usage

### Option 1: Use Vertex AI (Cursor Project)

```bash
export GOOGLE_CLOUD_PROJECT=gen-lang-client-0306628183
unset GEMINI_API_KEY
npm run test:vertex:grupo-pounj
```

This will use `gemini-2.0-flash-exp` via Vertex AI in the Cursor project.

### Option 2: Use Standard Gemini API (Gemini 3.0 Pro)

```bash
export GEMINI_API_KEY="your-api-key"
npm run test:vertex:grupo-pounj
```

This will automatically use `gemini-3-pro-preview` (Gemini 3.0 Pro) via standard Gemini API.

## Test Results

```
✅ Project: gen-lang-client-0306628183 (Cursor)
✅ Model: gemini-2.0-flash-exp
✅ API Call: Working
✅ Response: "Hello from Vertex AI."
```

## Quick Test

```bash
export GOOGLE_CLOUD_PROJECT=gen-lang-client-0306628183
tsx test_vertex_simple.ts
```

## Notes

- The Cursor project (`gen-lang-client-0306628183`) has access to `gemini-2.0-flash-exp`
- For Gemini 3.0 Pro, use standard Gemini API with `GEMINI_API_KEY`
- The codebase automatically chooses between Vertex AI and standard API based on `GEMINI_API_KEY`

