/**
 * Analyze GRUPO POUNJ documents to find FME/RPC information
 */

import 'dotenv/config';
import * as fs from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';

const ACTA_FILE = '/Users/ashishpunj/Desktop/mcp-docs/grupo-pounj/Acta_Constitutiva_grupo-pounj.pdf';

async function main() {
  console.log('🔍 Analyzing GRUPO POUNJ Acta Constitutiva for FME/RPC...\n');

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

  const pdfBuffer = fs.readFileSync(ACTA_FILE);
  const base64Data = pdfBuffer.toString('base64');

  const prompt = `
Analyze this Mexican Acta Constitutiva document and search for the following registry information:

1. **FME (Folio Mercantil Electrónico)** - Usually a long number like "2021002379110064" or "N-2021074811"
2. **Folio Mercantil** - Traditional folio number
3. **Libro** - Book number in the RPC
4. **Fecha de Inscripción** - Registration date in the RPC
5. **Boleta de Inscripción** - Is there a Boleta RPC included in this bundle?
6. **RNIE** - Any RNIE (Registro Nacional de Inversiones Extranjeras) information
7. **SRE Convenio** - Any SRE (Secretaría de Relaciones Exteriores) folio

Please search ALL pages thoroughly and report:
1. What registry numbers you found
2. On which page(s) they appear
3. If there's a Boleta de Inscripción del RPC included
4. If there's RNIE or SRE documentation included
5. Total number of pages in this document

Also tell me the company name and RFC if visible.
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

    console.log('=== ANALYSIS RESULTS ===');
    console.log(result.response.text());
    console.log('========================\n');

  } catch (error) {
    console.error('Error:', error);
  }
}

main().catch(console.error);

