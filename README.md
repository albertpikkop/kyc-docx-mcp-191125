# KYC Document Extractor

A Node.js + TypeScript project for extracting KYC (Know Your Customer) documents using OpenAI GPT-5.1.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file in the root directory:
```
OPENAI_API_KEY=your_openai_api_key_here
```

## Usage

### Development
```bash
npm run dev
```

### Build
```bash
npm run build
```

### Production
```bash
npm run start
```

## Model Constraints

**IMPORTANT**: This project ONLY supports the following models:
- `gpt-5.1`
- `gpt-5.1-mini`

These constraints are enforced in code, types, and comments. Any other model will throw an error.

## API Usage

This project uses the new `responses.create` API (NOT chat completions) from OpenAI.


