/**
 * Search the original PFDS bundle for the SRE folio 21083109101
 */

import 'dotenv/config';
import * as fs from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';

const BUNDLE_FILE = '/Users/ashishpunj/Desktop/mcp-docs/pfds/FME_REGISTRO_Nacional De Inversion Extranjera_Registo_Publico_de_ComercioPFDS_SAPI.pdf';

async function main() {
  console.log('🔍 Searching for SRE folio 21083109101 in original bundle...\n');

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

  const pdfBuffer = fs.readFileSync(BUNDLE_FILE);
  const base64Data = pdfBuffer.toString('base64');

  const prompt = `
This is a 46-page bundle of Mexican government documents.

I am looking for a specific number: **21083109101**

This number should appear as an "SRE Folio" or "Folio" from the Secretaría de Relaciones Exteriores.

Please:
1. Search ALL 46 pages for this number
2. Tell me if you find 21083109101 anywhere
3. If you find it, tell me which page and in what context
4. If you don't find it exactly, tell me what SRE-related folios you DO find

Also look for:
- "Secretaría de Relaciones Exteriores"
- "SRE"
- "Convenio de Extranjería"
- Any 11-digit numbers that could be SRE folios

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

