import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { extractWithGemini } from './geminiExtractor.js';
import { extractDocument as extractWithGpt } from '../extractors/visionExtractor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RULES_PATH = path.resolve(__dirname, '../config/router.rules.json');

interface RoutingRule {
  primary: 'gemini' | 'gpt';
  fallback?: 'gemini' | 'gpt';
}

interface RouterConfig {
  [key: string]: RoutingRule;
}

let rules: RouterConfig = {
  default: { primary: 'gemini', fallback: 'gpt' }
};

// Load rules
try {
  if (fs.existsSync(RULES_PATH)) {
    const raw = fs.readFileSync(RULES_PATH, 'utf-8');
    rules = JSON.parse(raw);
  }
} catch (error) {
  console.warn('Failed to load router rules, using defaults', error);
}

export type ModelType = 'gemini-2.5-flash' | 'gpt-5.1';

export interface ExtractionResult {
  data: any;
  modelUsed: ModelType;
  costUsd: number;
}

export async function routeExtraction(
  docType: string,
  fileUrl: string,
  schema: any,
  instructions: string
): Promise<ExtractionResult> {
  const rule = rules[docType] || rules.default;
  const primary = rule.primary;
  const fallback = rule.fallback;

  console.log(`Routing ${docType}: Primary=${primary}, Fallback=${fallback}`);

  try {
    return await executeExtraction(primary, fileUrl, schema, instructions);
  } catch (error: any) {
    console.warn(`${primary} extraction failed for ${docType}: ${error.message}`);
    
    if (fallback && fallback !== primary) {
      console.log(`Falling back to ${fallback}...`);
      try {
        return await executeExtraction(fallback, fileUrl, schema, instructions);
      } catch (fallbackError: any) {
        throw new Error(`Fallback extraction (${fallback}) also failed: ${fallbackError.message}`);
      }
    }
    
    throw error;
  }
}

async function executeExtraction(
  model: 'gemini' | 'gpt',
  fileUrl: string,
  schema: any,
  instructions: string
): Promise<ExtractionResult> {
  // Map internal model name to specific model ID for reporting
  const modelName: ModelType = model === 'gemini' ? 'gemini-2.5-flash' : 'gpt-5.1';

  if (model === 'gemini') {
    // Determine mime type from file extension or checking file
    let mimeType = 'application/pdf';
    const ext = path.extname(fileUrl).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
    else if (ext === '.png') mimeType = 'image/png';
    else if (ext === '.webp') mimeType = 'image/webp';

    const data = await extractWithGemini(fileUrl, mimeType, schema, instructions);
    
    // Calculate cost (approximate for now, or track token usage if available)
    // Gemini 1.5 Flash is very cheap, let's say $0.001 per doc for now or implement token counting
    const costUsd = 0.001; 
    
    return { data, modelUsed: modelName, costUsd };
  } else {
    // GPT
    const data = await extractWithGpt(fileUrl, schema, instructions);
    
    // GPT-5.1 cost estimation (placeholder, should integrate with costTracker)
    const costUsd = 0.05;
    
    return { data, modelUsed: modelName, costUsd };
  }
}
