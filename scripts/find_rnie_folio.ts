/**
 * Search the original PFDS bundle for the RNIE folio 255237
 */

import 'dotenv/config';
import * as fs from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';

const BUNDLE_FILE = '/Users/ashishpunj/Desktop/mcp-docs/pfds/FME_REGISTRO_Nacional De Inversion Extranjera_Registo_Publico_de_ComercioPFDS_SAPI.pdf';

async function main() {
  console.log('🔍 Searching for RNIE folio 255237 in original bundle...\n');

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

  const pdfBuffer = fs.readFileSync(BUNDLE_FILE);
  const base64Data = pdfBuffer.toString('base64');

  const prompt = `
This is a 46-page bundle of Mexican government documents.

I am looking for a specific number: **255237**

This number should appear as an "RNIE Folio de ingreso" or similar.

Please:
1. Search ALL 46 pages for this number
2. Tell me if you find 255237 anywhere
3. If you find it, tell me which page and in what context
4. If you don't find 255237, tell me what RNIE-related folios you DO find

Also look for:
- "Folio de ingreso"
- "Registro Nacional de Inversiones Extranjeras"
- Any 5-6 digit numbers that could be RNIE folios

Be thorough - check every page.
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

    console.log('=== SEARCH RESULTS ===');
    console.log(result.response.text());
    console.log('======================\n');

  } catch (error) {
    console.error('Error:', error);
  }
}

main().catch(console.error);

