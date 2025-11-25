# S3/R2 Storage Setup for Report URLs

## Overview

HTML reports are now uploaded to S3-compatible storage (AWS S3 or Cloudflare R2) and served via signed URLs valid for 7 days. This replaces the previous `file://` URL approach.

## Implementation

### Functions

**`uploadReport(html, customerId, runId)`**
- Uploads HTML content to S3/R2
- Returns signed URL valid for 7 days
- Key format: `reports/{customerId}/report-{runId}.html`

**`getReportSignedUrl(customerId, runId)`**
- Generates signed URL for existing report
- Returns `null` if report doesn't exist
- URL valid for 7 days

**`isS3Configured()`**
- Checks if S3 credentials are configured
- Returns `true` if S3 is available, `false` otherwise

### Fallback Behavior

If S3 is not configured or upload fails:
- System falls back to local file system
- Returns `file://` URLs as before
- No breaking changes for existing deployments

## Configuration

### Environment Variables

**Required for S3/R2:**
```bash
# S3 Access Credentials
S3_ACCESS_KEY_ID=your_access_key
S3_SECRET_ACCESS_KEY=your_secret_key

# Bucket Configuration
S3_BUCKET_NAME=kyc-reports

# Endpoint (for R2 or custom S3-compatible storage)
S3_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com  # For R2
# OR
S3_ENDPOINT=https://s3.amazonaws.com  # For AWS S3 (default)

# Region (for AWS S3)
S3_REGION=us-east-1

# Force path style (required for R2)
S3_FORCE_PATH_STYLE=true  # Set to true for R2
```

### Cloudflare R2 Example

```bash
S3_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=your_r2_access_key_id
S3_SECRET_ACCESS_KEY=your_r2_secret_access_key
S3_BUCKET_NAME=kyc-reports
S3_FORCE_PATH_STYLE=true
S3_REGION=auto
```

### AWS S3 Example

```bash
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
S3_BUCKET_NAME=kyc-reports
S3_REGION=us-east-1
# S3_ENDPOINT not needed (uses default AWS endpoint)
```

## Usage

### Automatic Upload

Reports are automatically uploaded when:
- A KYC run is saved with `saveRun()`
- Profile and validation exist
- S3 is configured

### Manual Upload

```typescript
import { uploadReport } from './kyc/s3Storage.js';

const html = '<html>...</html>';
const signedUrl = await uploadReport(html, 'customer-123', 'run-uuid');
console.log('Report URL:', signedUrl);
```

### Get Existing Report URL

```typescript
import { getReportUrl } from './kyc/storage.js';

const url = await getReportUrl('customer-123', 'run-uuid');
if (url) {
  console.log('Report URL:', url);
}
```

## Changes Made

1. **Created `src/kyc/s3Storage.ts`**
   - S3 upload functionality
   - Signed URL generation
   - Configuration checking

2. **Updated `src/kyc/storage.ts`**
   - `generateVisualReport()` now uploads to S3 if configured
   - `getReportUrl()` returns signed URLs from S3
   - `getLatestReportUrl()` returns signed URLs from S3
   - Falls back to file system if S3 not configured

3. **HTML Rendering**
   - No changes to HTML rendering logic
   - Same report format and styling

## Benefits

1. **Accessible URLs**: Reports accessible via HTTPS URLs
2. **Security**: Signed URLs expire after 7 days
3. **Scalability**: No local file system dependencies
4. **Compatibility**: Works with AWS S3, Cloudflare R2, and other S3-compatible storage
5. **Backward Compatible**: Falls back to file system if S3 not configured

## Notes

- Excel exports still use local file system (`file://` URLs)
- Signed URLs are valid for 7 days (configurable via `SIGNED_URL_EXPIRY`)
- Reports are cached with `Cache-Control: public, max-age=3600`
- Content-Type is set to `text/html; charset=utf-8`


