# Client Folder Structure

## Overview

Each KYC client now has an organized folder structure that keeps all related data, reports, and documents together.

## Folder Structure

```
data/
└── {customerId}/              # e.g., "pfds"
    ├── runs/                  # All KYC run JSON files
    │   └── run-{uuid}.json    # Complete run data (profile + validation + documents)
    ├── reports/               # Visual HTML reports
    │   └── report-{uuid}.html # Browser-viewable report
    └── documents/             # (Optional) Placeholder for document references
```

## Example: PFDS Client

```
data/pfds/
├── runs/
│   ├── run-b7ca7fcf-c363-4f2c-9ee5-3f6300dbb2e3.json
│   └── run-c1d97ebc-89c0-4760-aff6-e73274c6d1f3.json
├── reports/
│   ├── report-b7ca7fcf-c363-4f2c-9ee5-3f6300dbb2e3.html
│   └── report-c1d97ebc-89c0-4760-aff6-e73274c6d1f3.html
└── documents/
```

## Automatic Report Generation

When a KYC run is saved using `saveRun()`, the system automatically:

1. **Saves the run JSON** to `data/{customerId}/runs/run-{uuid}.json`
2. **Generates an HTML report** to `data/{customerId}/reports/report-{uuid}.html`
3. **Returns a file:// URL** that can be opened directly in a browser

## Usage

### Saving a Run

```typescript
import { saveRun } from './kyc/storage.js';

const run: KycRun = {
  runId: crypto.randomUUID(),
  customerId: 'pfds',
  createdAt: new Date().toISOString(),
  documents: [...],
  profile: {...},
  validation: {...}
};

// Save run and get report URL
const reportUrl = await saveRun(run);
console.log(`Report available at: ${reportUrl}`);
// Output: file:///path/to/data/pfds/reports/report-{uuid}.html
```

### Getting Report URL for Existing Run

```typescript
import { getReportUrl, getLatestReportUrl } from './kyc/storage.js';

// Get URL for specific run
const url = getReportUrl('pfds', 'run-uuid-here');

// Get URL for latest run
const latestUrl = await getLatestReportUrl('pfds');
```

## Opening Reports

### From Terminal

```bash
# macOS
open file:///path/to/data/pfds/reports/report-{uuid}.html

# Linux
xdg-open file:///path/to/data/pfds/reports/report-{uuid}.html

# Windows
start file:///path/to/data/pfds/reports/report-{uuid}.html
```

### From Code

```typescript
import { exec } from 'child_process';

const reportUrl = await getLatestReportUrl('pfds');
if (reportUrl) {
  // macOS
  exec(`open "${reportUrl}"`);
  
  // Or use a cross-platform library like 'open'
  // import open from 'open';
  // await open(reportUrl);
}
```

## Benefits

1. **Organization**: All client data is grouped together
2. **Versioning**: Multiple runs are preserved with unique IDs
3. **Accessibility**: HTML reports can be opened directly in browsers
4. **Traceability**: Each report links back to its source run JSON
5. **Scalability**: Easy to add more folder types (e.g., `documents/`, `exports/`)

## Document Storage

**Note**: Raw PDF documents remain in their original location (e.g., `/Users/ashishpunj/Desktop/MCP-Docx/MCP/`). The `documents/` folder is available for:
- Document references/metadata
- Copied documents (if needed)
- Future document management features

The `KycRun` object stores document file paths in `documents[].fileUrl`, so the original documents are always accessible.

