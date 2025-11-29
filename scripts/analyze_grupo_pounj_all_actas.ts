/**
 * Analyze ALL GRUPO POUNJ Actas to understand the complete corporate structure
 */

import 'dotenv/config';
import * as fs from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';

const DOCS_DIR = '/Users/ashishpunj/Desktop/mcp-docs/grupo-pounj';

const DOCUMENTS = [
  {
    name: 'Acta Constitutiva',
    file: 'Acta_Constitutiva_grupo-pounj.pdf',
    description: 'Original formation document'
  },
  {
    name: 'Compraventa de Acciones',
    file: 'Compraventa Acciones GP.pdf',
    description: 'Share transfer agreement'
  },
  {
    name: 'Modificación de Objeto',
    file: 'Modificacion Objeto GP.pdf',
    description: 'Purpose/object modification'
  }
];

async function main() {
  console.log('🔍 Analyzing ALL GRUPO POUNJ Actas...\n');

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

  for (const doc of DOCUMENTS) {
    const filePath = `${DOCS_DIR}/${doc.file}`;
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📄 ${doc.name}`);
    console.log(`   File: ${doc.file}`);
    console.log('='.repeat(80));

    if (!fs.existsSync(filePath)) {
      console.log('❌ File not found');
      continue;
    }

    const pdfBuffer = fs.readFileSync(filePath);
    const base64Data = pdfBuffer.toString('base64');

    const prompt = `
Analyze this Mexican corporate document (${doc.name}) and extract the following information:

## DOCUMENT IDENTIFICATION
1. Document type (Acta Constitutiva, Acta de Asamblea, Escritura de Compraventa, etc.)
2. Date of the document
3. Notary name and number
4. Protocol/Escritura number
5. Total pages

## COMPANY INFORMATION
1. Company name (Razón Social)
2. RFC (if mentioned)
3. Company type (S.A., S.A. de C.V., S.A.P.I., etc.)

## SHAREHOLDERS (ACCIONISTAS)
List ALL shareholders mentioned with:
- Full name
- Number of shares
- Percentage ownership
- Nationality (if mentioned)
- Any changes (if this is a modification document)

## LEGAL REPRESENTATIVES / BOARD
List ALL persons with legal powers:
- Full name
- Position/Role (Presidente, Secretario, Vocal, Comisario, Apoderado, etc.)
- Type of powers (Actos de Administración, Actos de Dominio, Pleitos y Cobranzas, etc.)
- Joint signature requirement (firma conjunta/mancomunada) - YES or NO
- Exact quote of powers from the document (in Spanish)

## REGISTRY INFORMATION
1. FME (Folio Mercantil Electrónico)
2. Folio Mercantil
3. Libro
4. Fecha de Inscripción
5. NSI (Número de Control Interno)
6. Any pending registration notes

## KEY CHANGES (if modification document)
What was changed from the original?
- Share transfers
- New shareholders
- Changes to powers
- Changes to object/purpose
- Changes to capital

## SPECIAL CLAUSES
Any important clauses about:
- Foreign investment (Cláusula de Extranjería)
- Joint signature requirements
- Restrictions on share transfers
- UBO/Beneficiario Controlador provisions

Please be thorough and extract ALL relevant information.
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

  // Now create a consolidated view
  console.log(`\n\n${'='.repeat(80)}`);
  console.log('📊 CONSOLIDATED ANALYSIS - ALL THREE DOCUMENTS');
  console.log('='.repeat(80));
  console.log('\nPlease review the above analysis to understand:');
  console.log('1. Original shareholder structure (Acta Constitutiva)');
  console.log('2. Share transfers (Compraventa de Acciones)');
  console.log('3. Object/purpose changes (Modificación de Objeto)');
  console.log('\nThe CURRENT state should reflect all modifications applied.');
}

main().catch(console.error);

