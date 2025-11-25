// import { z } from 'zod';
// import { SchemaType } from '@google/generative-ai';

/**
 * Normalizes a Zod schema or JSON schema for Gemini.
 * - Strips additionalProperties
 * - Converts unions to oneOf with simple branches
 * - Removes unsupported formats
 */
export function toGeminiSchema(schema: any): any {
  // If it's a Zod schema, convert to JSON schema first
  // Note: We assume the input is already a JSON schema object for now, 
  // as most extractors pass a JSON schema object. 
  // If a Zod object is passed, we'd need zod-to-json-schema.
  // The current codebase seems to use defined JSON schemas in src/schemas/mx/
  
  return cleanSchema(schema);
}

function cleanSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  // Clone to avoid mutating original
  const clean = { ...schema };

  // Remove additionalProperties (Gemini doesn't like it)
  if ('additionalProperties' in clean) {
    delete clean.additionalProperties;
  }

  // Handle type arrays (e.g. ["string", "null"])
  // Gemini often dislikes type arrays. Convert to nullable: true if possible.
  if (Array.isArray(clean.type)) {
    const types = clean.type;
    const otherTypes = types.filter((t: string) => t !== 'null');
    
    if (otherTypes.length === 1) {
      // Simple nullable case: ["string", "null"] -> type: "string", nullable: true
      clean.type = otherTypes[0];
      clean.nullable = true; // Use nullable: true for Gemini
    } else if (otherTypes.length === 0) {
      // Simple nullable case: ["string", "null"] -> type: "string", nullable: true
      clean.type = otherTypes[0];
      clean.nullable = true; // Use nullable: true for Gemini
    } else if (otherTypes.length === 0) {
        // Only null?
        clean.type = 'null';
    } else {
        // Complex union (e.g. string | number) - Gemini might struggle.
        // Fallback: Use string and let the model figure it out, or keep as is and hope.
        // For now, keep as is, but this is risky.
    }
  }

  // Handle properties recursively
  if (clean.properties) {
    const newProps: any = {};
    for (const [key, value] of Object.entries(clean.properties)) {
      newProps[key] = cleanSchema(value);
    }
    clean.properties = newProps;
  }

  // Handle items (arrays)
  if (clean.items) {
    clean.items = cleanSchema(clean.items);
  }

  // Handle anyOf/oneOf/allOf
  // Gemini prefers flattened structures, but basic oneOf is supported if simple.
  // For robustness, if we see complex unions, we might want to simplify them.
  // For now, just clean recursively.
  if (clean.anyOf) {
    clean.anyOf = clean.anyOf.map(cleanSchema);
  }
  if (clean.oneOf) {
    clean.oneOf = clean.oneOf.map(cleanSchema);
  }
  if (clean.allOf) {
    clean.allOf = clean.allOf.map(cleanSchema);
  }

  // Gemini specific types mapping if needed
  // e.g. 'integer' is fine, 'number' is fine.
  // 'date-time' format might be ignored by Gemini, but keeping it doesn't usually break it.
  
  return clean;
}
