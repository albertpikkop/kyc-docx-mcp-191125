// import { GoogleGenerativeAI } from "@google/generative-ai";
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { GEMINI_MODEL, getGeminiClient, MODEL_TIERS } from '../modelGemini.js';
import { toGeminiSchema } from './schemaNormalizer.js';
import { metrics } from '../mcp/health.js';

/**
 * Normalize file URL or path to a regular filesystem path
 * Handles file:// URLs and regular paths
 */
function normalizeFilePath(filePathOrUrl: string): string {
  if (filePathOrUrl.startsWith('file://')) {
    // Convert file:// URL to path
    try {
      return fileURLToPath(filePathOrUrl);
    } catch (e) {
      // Fallback: just strip the file:// prefix
      return filePathOrUrl.replace('file://', '');
    }
  }
  return filePathOrUrl;
}

// Configuration
const MAX_FILE_SIZE_BYTES = 18 * 1024 * 1024; // 18MB (Gemini API limit is 20MB for inline data)
const BASE_TIMEOUT_MS = 60000; // 60s base timeout
const LARGE_FILE_TIMEOUT_MS = 180000; // 180s for files > 5MB (Acta Constitutiva can be 7MB+)
const LARGE_FILE_THRESHOLD = 5 * 1024 * 1024; // 5MB threshold
const MAX_RETRIES = 3;

export interface GeminiError extends Error {
  code?: string;
  cause?: unknown;
  retriable: boolean;
  message: string;
}

/**
 * Sleep with jitter
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Extract data using Gemini with hardening
 */
export async function extractWithGemini(
  filePathOrUrl: string,
  mimeType: string,
  schema: any,
  instructions: string,
  initialModel?: string // Optional: Override model selection
): Promise<any> {
  const startTime = Date.now();
  
  // Normalize file:// URLs to regular paths
  const filePath = normalizeFilePath(filePathOrUrl);
  console.log(`📂 Processing file: ${filePath}`);
  
  // 1. Size Guard & Timeout Selection
  let requestTimeoutMs = BASE_TIMEOUT_MS;
  try {
    const stats = fs.statSync(filePath);
    if (stats.size > MAX_FILE_SIZE_BYTES) {
      throw new Error(`File too large for Gemini: ${(stats.size / 1024 / 1024).toFixed(2)}MB. Limit: 18MB.`);
    }
    // Use longer timeout for large files (Acta Constitutiva can be 7MB+)
    if (stats.size > LARGE_FILE_THRESHOLD) {
      requestTimeoutMs = LARGE_FILE_TIMEOUT_MS;
      console.log(`📁 Large file detected (${(stats.size / 1024 / 1024).toFixed(1)}MB), using ${requestTimeoutMs/1000}s timeout`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('File too large')) {
      throw error;
    }
    // If file doesn't exist or other fs error, let it fail naturally below
  }

  const client = getGeminiClient();
  
  // 2. Schema Normalization
  const cleanedSchema = toGeminiSchema(schema);

  const fileBuffer = fs.readFileSync(filePath);
  const base64Data = fileBuffer.toString('base64');

  const prompt = `${instructions}

CRITICAL: You must EXTRACT the actual data from the document and fill the schema with real values.
DO NOT return the schema definition itself - you must fill it with extracted data.
Output ONLY the extracted data in JSON format matching the schema structure.
If a field is not visible or cannot be extracted, set it to null.
`;

  // WATERFALL LOGIC
  const requestedModel = initialModel || GEMINI_MODEL;
  
  // Find where the requested model sits in the hierarchy
  let tierIndex = MODEL_TIERS.indexOf(requestedModel);
  if (tierIndex === -1) tierIndex = 0; // Default to start if unknown

  // Create list of models to try in order: [Requested, ...Higher Tiers]
  const modelsToTry = MODEL_TIERS.slice(tierIndex);
  // Ensure at least the requested model is tried if it wasn't in the list
  if (modelsToTry[0] !== requestedModel) {
      modelsToTry.unshift(requestedModel);
  }

  let lastError: any;

  // Iterate through models (Waterfall)
  for (const targetModel of modelsToTry) {
    console.log(`Attempting extraction with ${targetModel}...`);

    try {
      const model = client.getGenerativeModel({ 
        model: targetModel, 
        generationConfig: { 
          responseMimeType: "application/json",
          responseSchema: cleanedSchema
        } 
      });

      // 3. Retries with Jitter (Per Model)
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      metrics?.geminiCallsTotal?.inc({ status: 'attempt' });
      
      // Prepare request part based on client type
      const requestPart = {
        inlineData: {
          data: base64Data,
          mimeType: mimeType
        }
      };

      const resultPromise = model.generateContent([
        prompt,
        requestPart
      ]);

      // 4. Timeout (dynamic based on file size)
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Gemini request timed out')), requestTimeoutMs);
      });

      const result = await Promise.race([resultPromise, timeoutPromise]);
      const response = await result.response;
      
          // Extract text from response
      const text = typeof response.text === 'function' ? response.text() : (response.candidates?.[0]?.content?.parts?.[0]?.text || "");

      // Metrics: Latency
      const latency = Date.now() - startTime;
      metrics?.geminiLatencyMs?.observe(latency);
      metrics?.geminiCallsTotal?.inc({ status: 'success' });

      try {
        const parsed = JSON.parse(text);
        
        // Check if Gemini returned the schema instead of data
        if (parsed.type === "object" && parsed.properties && parsed.description) {
          throw new Error("Gemini returned schema definition instead of extracted data.");
        }
        
            // Success - Return immediately
            console.log(`✅ Extraction successful with ${targetModel}`);
        return parsed;
      } catch (e) {
        console.error("Failed to parse Gemini JSON response:", text);
        throw new Error("Invalid JSON response from Gemini");
      }

    } catch (error: any) {
      lastError = error;
          console.warn(`${targetModel} attempt ${attempt} failed: ${error.message}`);
      
      // Determine if retriable
      const isRetriable = 
        error.message.includes('timed out') || 
        error.message.includes('503') || 
        error.message.includes('429') ||
        error.message.includes('fetch failed') ||
        error.message.includes('Invalid JSON'); // Retry on JSON parse error (hallucination)
            
          // Special handling for 400 Bad Request (Schema/Validation Error)
          // If it's a 400, retrying the SAME model won't help. Break inner loop to try NEXT model.
          if (error.message.includes('400') || error.message.includes('Bad Request')) {
             console.warn(`⚠️  400 Bad Request detected on ${targetModel}. Breaking retry loop to escalate model.`);
             break; // Break retry loop, move to next model
          }
        
      if (!isRetriable && attempt < MAX_RETRIES) {
             // If strictly not retriable and not a 400, we might stop here, 
             // OR we might want to try a smarter model if it was a logic error?
             // For now, assume non-retriable means we should try the next model.
             break;
      }

      if (attempt === MAX_RETRIES) break;
      
      // Jittered backoff: 1s, 2s, 4s + jitter
      const backoff = Math.pow(2, attempt - 1) * 1000 + Math.random() * 500;
      await sleep(backoff);
    }
  }

      // If we exhausted retries for this model, we loop to the next model in the waterfall
      console.warn(`⚠️  Exhausted attempts for ${targetModel}. Escalating to next tier...`);

    } catch (modelError: any) {
       // Catch model instantiation errors
       console.warn(`❌ Failed to initialize ${targetModel}: ${modelError.message}`);
    }
  }

  // If all models failed
  const structuredError: GeminiError = new Error(`All Gemini extraction tiers failed. Last error: ${lastError?.message}`) as GeminiError;
  structuredError.code = 'GEMINI_EXTRACTION_FAILED';
  structuredError.cause = lastError;
  structuredError.retriable = true; 
  
  throw structuredError;
}
