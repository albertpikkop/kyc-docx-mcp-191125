import * as fs from 'fs';
import * as path from 'path';

interface ComparisonResult {
  client: string;
  docType: string;
  field: string;
  gptValue: any;
  geminiValue: any;
  match: boolean;
  discrepancy: string;
}

function deepCompare(obj1: any, obj2: any, path: string = '', results: ComparisonResult[] = [], client: string = '', docType: string = ''): ComparisonResult[] {
  if (obj1 === null || obj2 === null) {
    if (obj1 !== obj2) {
      results.push({
        client,
        docType,
        field: path,
        gptValue: obj1,
        geminiValue: obj2,
        match: false,
        discrepancy: `Null mismatch: GPT=${obj1}, Gemini=${obj2}`
      });
    }
    return results;
  }

  if (typeof obj1 !== typeof obj2) {
    results.push({
      client,
      docType,
      field: path,
      gptValue: obj1,
      geminiValue: obj2,
      match: false,
      discrepancy: `Type mismatch: GPT=${typeof obj1}, Gemini=${typeof obj2}`
    });
    return results;
  }

  if (typeof obj1 !== 'object' || obj1 instanceof Date) {
    if (obj1 !== obj2) {
      results.push({
        client,
        docType,
        field: path,
        gptValue: obj1,
        geminiValue: obj2,
        match: false,
        discrepancy: `Value mismatch: GPT="${obj1}", Gemini="${obj2}"`
      });
    } else {
      results.push({
        client,
        docType,
        field: path,
        gptValue: obj1,
        geminiValue: obj2,
        match: true,
        discrepancy: ''
      });
    }
    return results;
  }

  if (Array.isArray(obj1)) {
    const maxLen = Math.max(obj1.length, obj2.length);
    for (let i = 0; i < maxLen; i++) {
      const newPath = path ? `${path}[${i}]` : `[${i}]`;
      if (i >= obj1.length) {
        results.push({
          client,
          docType,
          field: newPath,
          gptValue: null,
          geminiValue: obj2[i],
          match: false,
          discrepancy: `GPT missing array element`
        });
      } else if (i >= obj2.length) {
        results.push({
          client,
          docType,
          field: newPath,
          gptValue: obj1[i],
          geminiValue: null,
          match: false,
          discrepancy: `Gemini missing array element`
        });
      } else {
        deepCompare(obj1[i], obj2[i], newPath, results, client, docType);
      }
    }
    return results;
  }

  const allKeys = new Set([...Object.keys(obj1), ...Object.keys(obj2)]);
  for (const key of allKeys) {
    const newPath = path ? `${path}.${key}` : key;
    if (!(key in obj1)) {
      results.push({
        client,
        docType,
        field: newPath,
        gptValue: null,
        geminiValue: obj2[key],
        match: false,
        discrepancy: `GPT missing field`
      });
    } else if (!(key in obj2)) {
      results.push({
        client,
        docType,
        field: newPath,
        gptValue: obj1[key],
        geminiValue: null,
        match: false,
        discrepancy: `Gemini missing field`
      });
    } else {
      deepCompare(obj1[key], obj2[key], newPath, results, client, docType);
    }
  }

  return results;
}

function compareRuns(gptRunPath: string, geminiRunPath: string, clientName: string): ComparisonResult[] {
  const gptRun = JSON.parse(fs.readFileSync(gptRunPath, 'utf-8'));
  const geminiRun = JSON.parse(fs.readFileSync(geminiRunPath, 'utf-8'));

  const results: ComparisonResult[] = [];

  // Compare documents
  const gptDocs = gptRun.documents || [];
  const geminiDocs = geminiRun.documents || [];

  // Create maps by type
  const gptDocsByType = new Map<string, any>();
  const geminiDocsByType = new Map<string, any>();

  gptDocs.forEach((doc: any) => {
    gptDocsByType.set(doc.type, doc.extractedPayload);
  });

  geminiDocs.forEach((doc: any) => {
    geminiDocsByType.set(doc.type, doc.extractedPayload);
  });

  // Compare each document type
  const allTypes = new Set([...gptDocsByType.keys(), ...geminiDocsByType.keys()]);
  
  for (const docType of allTypes) {
    const gptPayload = gptDocsByType.get(docType);
    const geminiPayload = geminiDocsByType.get(docType);

    if (!gptPayload) {
      results.push({
        client: clientName,
        docType,
        field: 'document',
        gptValue: null,
        geminiValue: 'exists',
        match: false,
        discrepancy: 'GPT missing document'
      });
      continue;
    }

    if (!geminiPayload) {
      results.push({
        client: clientName,
        docType,
        field: 'document',
        gptValue: 'exists',
        geminiValue: null,
        match: false,
        discrepancy: 'Gemini missing document'
      });
      continue;
    }

    // CRITICAL: For "fm2" type, check if it's actually FM2 or INE based on document_type field
    let actualDocType = docType;
    if (docType === 'fm2') {
      const gptDocType = gptPayload.document_type || gptPayload.type;
      const geminiDocType = geminiPayload.document_type || geminiPayload.type;
      
      // If either says "INE", it's an INE document, not FM2
      if (gptDocType === 'INE' || geminiDocType === 'INE') {
        actualDocType = 'ine';
      } else {
        actualDocType = 'fm2';
      }
    }

    // Compare payloads
    deepCompare(gptPayload, geminiPayload, '', results, clientName, actualDocType);
  }

  return results;
}

async function main() {
  const comparisons = [
    {
      client: 'PFDS',
      gpt: 'data/pfds/runs/run-5754138c-41fe-48ca-b263-1bebc1aaabce.json',
      gemini: 'data/pfds-gemini/runs/run-3fcd0630-b013-480e-9ed7-62f7ed1d2d49.json'
    },
    {
      client: 'Grupo Pounj',
      gpt: 'data/grupo-pounj/runs/run-2dfe5090-b8fa-49a2-8d7b-3943d3a9b746.json',
      gemini: 'data/grupo-pounj-gemini/runs/run-838b93b6-f72e-4089-9bb3-f8b203467614.json'
    },
    {
      client: 'Enrique Cello',
      gpt: 'data/enrique-cello/runs/run-4c9fc541-82b8-43b2-9dec-fa6c40986f32.json',
      gemini: 'data/enrique-cello-gemini/runs/run-2e0bf3bd-2aaa-45ed-afc7-7a7de40f55a8.json'
    }
  ];

  const allResults: ComparisonResult[] = [];

  for (const comp of comparisons) {
    console.log(`\n=== Comparing ${comp.client} ===`);
    const results = compareRuns(comp.gpt, comp.gemini, comp.client);
    allResults.push(...results);
    
    // Summary by document type
    const byDocType = new Map<string, { matches: number; mismatches: number }>();
    results.forEach(r => {
      if (!byDocType.has(r.docType)) {
        byDocType.set(r.docType, { matches: 0, mismatches: 0 });
      }
      const stats = byDocType.get(r.docType)!;
      if (r.match) {
        stats.matches++;
      } else {
        stats.mismatches++;
      }
    });

    byDocType.forEach((stats, docType) => {
      const total = stats.matches + stats.mismatches;
      const accuracy = ((stats.matches / total) * 100).toFixed(1);
      console.log(`  ${docType}: ${stats.matches}/${total} match (${accuracy}%)`);
    });
  }

  // Generate detailed report
  console.log('\n\n=== DETAILED DISCREPANCIES ===\n');
  
  const mismatches = allResults.filter(r => !r.match);
  
  // Group by document type
  const byDocType = new Map<string, ComparisonResult[]>();
  mismatches.forEach(r => {
    if (!byDocType.has(r.docType)) {
      byDocType.set(r.docType, []);
    }
    byDocType.get(r.docType)!.push(r);
  });

  byDocType.forEach((results, docType) => {
    console.log(`\n## ${docType.toUpperCase()}`);
    console.log(`Total Discrepancies: ${results.length}\n`);
    
    // Group by client
    const byClient = new Map<string, ComparisonResult[]>();
    results.forEach(r => {
      if (!byClient.has(r.client)) {
        byClient.set(r.client, []);
      }
      byClient.get(r.client)!.push(r);
    });

    byClient.forEach((clientResults, client) => {
      console.log(`### ${client} (${clientResults.length} discrepancies)`);
      clientResults.slice(0, 10).forEach(r => {
        console.log(`  Field: ${r.field}`);
        console.log(`    GPT:    ${JSON.stringify(r.gptValue)}`);
        console.log(`    Gemini: ${JSON.stringify(r.geminiValue)}`);
        console.log(`    Issue:  ${r.discrepancy}`);
        console.log('');
      });
      if (clientResults.length > 10) {
        console.log(`  ... and ${clientResults.length - 10} more`);
      }
    });
  });

  // Summary statistics
  console.log('\n\n=== SUMMARY STATISTICS ===\n');
  const totalFields = allResults.length;
  const totalMatches = allResults.filter(r => r.match).length;
  const totalMismatches = mismatches.length;
  
  console.log(`Total Fields Compared: ${totalFields}`);
  console.log(`Matches: ${totalMatches} (${((totalMatches/totalFields)*100).toFixed(1)}%)`);
  console.log(`Mismatches: ${totalMismatches} (${((totalMismatches/totalFields)*100).toFixed(1)}%)`);

  // Recommendations
  console.log('\n\n=== RECOMMENDATIONS ===\n');
  
  const docTypeAccuracy = new Map<string, { matches: number; total: number }>();
  allResults.forEach(r => {
    if (!docTypeAccuracy.has(r.docType)) {
      docTypeAccuracy.set(r.docType, { matches: 0, total: 0 });
    }
    const stats = docTypeAccuracy.get(r.docType)!;
    stats.total++;
    if (r.match) stats.matches++;
  });

  docTypeAccuracy.forEach((stats, docType) => {
    const accuracy = (stats.matches / stats.total) * 100;
    const recommendation = accuracy >= 90 ? '✅ Both models perform well' :
                          accuracy >= 70 ? '⚠️ Minor differences, both acceptable' :
                          accuracy >= 50 ? '🔶 Significant differences, prefer Gemini' :
                          '❌ Major differences, use Gemini only';
    console.log(`${docType}: ${accuracy.toFixed(1)}% accuracy - ${recommendation}`);
  });
}

main().catch(console.error);

