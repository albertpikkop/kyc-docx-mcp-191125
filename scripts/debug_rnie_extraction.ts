/**
 * Debug RNIE extraction - try to find the folio number
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';

const RNIE_FILE = '/Users/ashishpunj/Desktop/mcp-docs/pfds/split/RNIE_Acuse_PFDS.pdf';

async function main() {
  console.log('🔍 Debug RNIE extraction...\n');

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

  // Read the PDF file
  const pdfBuffer = fs.readFileSync(RNIE_FILE);
  const base64Data = pdfBuffer.toString('base64');

  const prompt = `
You are analyzing a Mexican government document called "Acuse de Recibo" from the Registro Nacional de Inversiones Extranjeras (RNIE).

TASK: Find and extract the "Folio de ingreso" number from this document.

The folio is a 5-6 digit number that appears after the text "Folio de ingreso:" or similar.
It is THE MOST IMPORTANT piece of information in this document.

SEARCH CAREFULLY through ALL pages of this PDF. The folio might be:
- On the first page in a "datos de control" section
- Near text like "Folio de ingreso:" or "Folio:"
- A number like 255237

Please:
1. List ALL numbers you can see in the document
2. Identify which one is the "Folio de ingreso"
3. Return ONLY the folio number, nothing else

If you find any number that could be the folio (5-6 digits near "folio" or "ingreso"), report it.
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

    const response = result.response.text();
    console.log('=== GEMINI RESPONSE ===');
    console.log(response);
    console.log('=======================\n');

    // Try a more direct approach
    console.log('\n🔍 Second attempt - direct number search...\n');
    
    const prompt2 = `
Look at this PDF document. I need you to find a specific number.

The document is an "Acuse de Recibo" from RNIE (Registro Nacional de Inversiones Extranjeras).

Somewhere in this document, there should be text like:
"Folio de ingreso: 255237"
or
"Folio: 255237"

The number 255237 (or similar 5-6 digit number) is what I'm looking for.

Please examine EVERY page carefully and tell me:
1. Do you see the words "Folio de ingreso" anywhere?
2. What number follows those words?
3. List ALL numbers visible in the document.

Be extremely thorough - this number is critical.
`;

    const result2 = await model.generateContent([
      {
        inlineData: {
          mimeType: 'application/pdf',
          data: base64Data
        }
      },
      prompt2
    ]);

    console.log('=== GEMINI RESPONSE (2nd attempt) ===');
    console.log(result2.response.text());
    console.log('=====================================\n');

  } catch (error) {
    console.error('Error:', error);
  }
}

main().catch(console.error);

