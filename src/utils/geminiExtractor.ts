import { GoogleGenerativeAI } from "@google/generative-ai";
import * as fs from 'fs';
import { GEMINI_MODEL, getGeminiClient } from '../modelGemini.js';

/**
 * Recursively cleans schema for Gemini API compatibility
 * - Removes 'additionalProperties' everywhere (not supported by Gemini)
 * - Converts array types like ["string", "null"] to single type "string"
 */
function cleanSchemaForGemini(schema: any): any {
  if (typeof schema !== 'object' || schema === null) {
    return schema;
  }

  if (Array.isArray(schema)) {
    return schema.map(item => cleanSchemaForGemini(item));
  }

  const cleaned: any = {};
  for (const [key, value] of Object.entries(schema)) {
    // Always skip additionalProperties - Gemini doesn't support it anywhere
    if (key === 'additionalProperties') {
      continue;
    }
    
    // Convert array types like ["string", "null"] to single type "string"
    if (key === 'type' && Array.isArray(value)) {
      const nonNullType = value.find((t: any) => t !== 'null');
      cleaned[key] = nonNullType || value[0];
    } else {
      // Recursively clean all other values
      cleaned[key] = cleanSchemaForGemini(value);
    }
  }

  return cleaned;
}

export async function extractWithGemini(filePath: string, mimeType: string, schema: any, instructions: string): Promise<any> {
  const genAI = getGeminiClient();
  
  // Clean schema to remove additionalProperties (not supported by Gemini API)
  const cleanedSchema = cleanSchemaForGemini(schema);
  
  const model = genAI.getGenerativeModel({ 
    model: GEMINI_MODEL, 
    generationConfig: { 
      responseMimeType: "application/json",
      responseSchema: cleanedSchema
    } 
  });

  console.log(`Extracting document using Gemini model: ${GEMINI_MODEL}`);
  console.log(`Processing file: ${filePath}`);

  const fileBuffer = fs.readFileSync(filePath);
  const base64Data = fileBuffer.toString('base64');

  // CRITICAL: Explicitly instruct to EXTRACT data, not return schema
  const prompt = `${instructions}

CRITICAL: You must EXTRACT the actual data from the document and fill the schema with real values.
DO NOT return the schema definition itself - you must fill it with extracted data.
Output ONLY the extracted data in JSON format matching the schema structure.
If a field is not visible or cannot be extracted, set it to null.
`;

  const result = await model.generateContent([
    prompt,
    {
      inlineData: {
        data: base64Data,
        mimeType: mimeType
      }
    }
  ]);

  const response = await result.response;
  const text = response.text();

  try {
    const parsed = JSON.parse(text);
    
    // Check if Gemini returned the schema instead of data
    if (parsed.type === "object" && parsed.properties && parsed.description) {
      console.error("WARNING: Gemini returned schema definition instead of extracted data!");
      console.error("Response:", text.substring(0, 500));
      throw new Error("Gemini returned schema definition instead of extracted data. Check prompt and schema configuration.");
    }
    
    return parsed;
  } catch (e) {
    console.error("Failed to parse Gemini JSON response:", text);
    throw e;
  }
}

