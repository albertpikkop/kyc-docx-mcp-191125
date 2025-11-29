/**
 * Analyze what's in each split PDF
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';

const SPLIT_DIR = '/Users/ashishpunj/Desktop/mcp-docs/pfds/split';

async function main() {
  console.log('🔍 Analyzing split PDFs...\n');

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

  const files = fs.readdirSync(SPLIT_DIR).filter(f => f.endsWith('.pdf'));

  for (const file of files) {
    const filePath = path.join(SPLIT_DIR, file);
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📄 File: ${file}`);
    console.log('='.repeat(60));

    const pdfBuffer = fs.readFileSync(filePath);
    const base64Data = pdfBuffer.toString('base64');

    const prompt = `
Analyze this Mexican government document and tell me:
1. What type of document is this? (e.g., RNIE Acuse, SRE Convenio, Autorización de Denominación, SAT Constancia, etc.)
2. What is the main identifying number/folio in this document?
3. What company/person is this document for?
4. Briefly describe what this document is about.

Be concise - just the key facts.
`;

    try {
      const result = await model.generateContent([
        {
          inlineData: {
            mimeType: 'application/pdf',
            data: base64Data
          }
        },
        prompt
      ]);

      console.log(result.response.text());
    } catch (error) {
      console.error('Error:', error);
    }
  }
}

main().catch(console.error);

