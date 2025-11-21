# Multi-Client KYC Setup Guide

## Overview

This system manages multiple KYC clients with:
- **Documents**: Stored in a base folder on your local drive (e.g., `Desktop/mcp-docs`)
- **Client Folders**: Subfolders inside the base folder (e.g., `client1`, `client2`, `client3`)
- **Auto-Detection**: Automatically finds documents in each client folder
- **Reports**: Generated and stored in codebase at `data/{clientId}/reports/`
- **Auto-Open**: Reports automatically open in browser after generation

## Quick Start

### 1. Set Up Base Folder

The base folder is configured in `src/scripts/runKycClient.ts`:

```typescript
const BASE_DOCUMENTS_FOLDER = "/Users/ashishpunj/Desktop/mcp-docs";
```

### 2. Organize Client Documents

Create subfolders for each client inside the base folder:

```
/Users/ashishpunj/Desktop/mcp-docs/
├── client1/
│   ├── Acta_Constitutiva.pdf
│   ├── Constancia_SAT.pdf
│   ├── FM2.pdf
│   ├── Telmex_Recibo.pdf
│   └── Bank_Statement.pdf
├── client2/
│   └── (your documents)
└── client3/
    └── (your documents)
```

### 3. Run KYC

Simply specify the client folder name:

```bash
npm run client:run client1
```

The system will:
- ✅ Auto-detect documents in `mcp-docs/client1/`
- ✅ Process all found documents
- ✅ Generate KYC profile
- ✅ Save run data to `data/client1/runs/`
- ✅ Generate HTML report in `data/client1/reports/`
- ✅ **Automatically open report in browser!**

## Document Auto-Detection

The system automatically detects document types based on file names:

| Document Type | Keywords Detected |
|--------------|-------------------|
| Acta | "acta", "constitutiva", "escritura", "constitución" |
| SAT Constancia | "constancia", "sat", "situacion fiscal", "rfc" |
| FM2 | "fm2", "immigration", "migración" |
| Telmex | "telmex", "telefono", "recibo telmex" |
| CFE | "cfe", "luz", "electricidad", "recibo cfe" |
| Bank | "banco", "bank", "estado cuenta", "cuenta", "clabe", "kapital" |

**Example file names that work:**
- `Acta_Constitutiva.pdf` → Detected as Acta
- `Constancia_SAT.pdf` → Detected as SAT
- `FM2_2024.pdf` → Detected as FM2
- `Recibo_Telmex_Oct.pdf` → Detected as Telmex
- `Estado_Cuenta_Banco.pdf` → Detected as Bank

## Available Commands

```bash
# List all clients and their status
npm run client:list

# Run KYC for a client (auto-opens browser)
npm run client:run <customerId>

# Delete all runs/reports for a client
npm run client:delete <customerId>

# Open latest report for a client
npm run client:open <customerId>

# Open most recent report (any client)
npm run client:open-latest
```

## Folder Structure

### Local Drive (Your Documents)
```
/Users/ashishpunj/Desktop/mcp-docs/
├── client1/          ← Client folder
│   ├── acta.pdf
│   ├── sat.pdf
│   └── ...
├── client2/
│   └── ...
└── client3/
    └── ...
```

### Codebase (Reports Only)
```
data/
├── client1/
│   ├── runs/
│   │   └── run-{uuid}.json      ← KYC run data
│   └── reports/
│       └── report-{uuid}.html   ← HTML report (URL points here)
├── client2/
│   └── ...
└── client3/
    └── ...
```

## Workflow Example

### Setting Up 3 Clients

1. **Create base folder** (if not exists):
   ```bash
   mkdir -p /Users/ashishpunj/Desktop/mcp-docs
   ```

2. **Create client folders**:
   ```bash
   mkdir -p /Users/ashishpunj/Desktop/mcp-docs/{client1,client2,client3}
   ```

3. **Place documents** in each client folder

4. **Run reports**:
   ```bash
   npm run client:run client1
   npm run client:run client2
   npm run client:run client3
   ```
   Each command automatically opens the report in your browser!

5. **Regenerate if needed**:
   ```bash
   npm run client:delete client1
   npm run client:run client1
   ```

## Key Points

- ✅ **Base Folder**: Configured in `src/scripts/runKycClient.ts` as `BASE_DOCUMENTS_FOLDER`
- ✅ **Client Folders**: Subfolders inside the base folder
- ✅ **Auto-Detection**: Documents are automatically found based on file names
- ✅ **Reports**: Generated and stored in `data/{clientId}/reports/`
- ✅ **URLs**: Point to report files in codebase (one-click access)
- ✅ **Auto-open**: Reports automatically open in browser after generation
- ✅ **Clean slate**: Use `client:delete` to remove old runs before regenerating

## Troubleshooting

### Client Folder Not Found
- Check that the base folder exists: `/Users/ashishpunj/Desktop/mcp-docs`
- Verify the client subfolder exists: `mcp-docs/client1/`
- Update `BASE_DOCUMENTS_FOLDER` in `src/scripts/runKycClient.ts` if needed

### No Documents Found
- Ensure PDF files are in the client folder
- Check file names contain recognizable keywords (see auto-detection table)
- Files must have `.pdf` extension

### Report Not Opening
- Check that report was generated: `data/{clientId}/reports/report-*.html`
- Try manually: `npm run client:open {clientId}`
- Or copy the URL from console output and paste in browser
