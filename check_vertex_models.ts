#!/usr/bin/env tsx
/**
 * Check what models are available via Vertex AI
 */

import "dotenv/config";
import { VertexAI } from '@google-cloud/vertexai';

async function checkAvailableModels() {
  console.log("\n" + "=".repeat(70));
  console.log("  🔍 CHECKING AVAILABLE VERTEX AI MODELS");
  console.log("=".repeat(70) + "\n");
  
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || 'gpounj-40b74';
  const location = process.env.GOOGLE_CLOUD_LOCATION || process.env.GCP_LOCATION || 'us-central1';
  
  console.log(`Project: ${project}`);
  console.log(`Location: ${location}\n`);
  
  // List of models to test
  const modelsToTest = [
    // Gemini 3.0 models
    "gemini-3.0-pro",
    "gemini-3.0-flash",
    "gemini-3-pro-preview",
    "gemini-3-flash-preview",
    "gemini-3.0-pro-001",
    "gemini-3.0-flash-001",
    
    // Gemini 2.0 models
    "gemini-2.0-pro-exp",
    "gemini-2.0-flash-exp",
    
    // Gemini 1.5 models
    "gemini-1.5-pro",
    "gemini-1.5-flash",
    "gemini-1.5-pro-001",
    "gemini-1.5-flash-001",
    "gemini-1.5-pro-002",
    "gemini-1.5-flash-002",
    "gemini-1.5-pro-latest",
    "gemini-1.5-flash-latest",
    
    // Gemini 1.0 models
    "gemini-pro",
    "gemini-pro-vision",
    
    // Experimental
    "gemini-pro-experimental",
    "gemini-flash-experimental",
  ];
  
  try {
    const vertexAI = new VertexAI({ project, location });
    console.log("✅ Vertex AI client initialized\n");
    
    const availableModels: string[] = [];
    const unavailableModels: string[] = [];
    
    console.log("Testing models...\n");
    
    for (const modelName of modelsToTest) {
      try {
        const model = vertexAI.getGenerativeModel({ 
          model: modelName,
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 10, // Minimal tokens for quick test
          }
        });
        
        // Try a very quick test
        const result = await Promise.race([
          model.generateContent("test"),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('timeout')), 5000)
          )
        ]) as any;
        
        await result.response;
        availableModels.push(modelName);
        console.log(`✅ ${modelName} - AVAILABLE`);
      } catch (error: any) {
        if (error.message?.includes('404') || error.message?.includes('NOT_FOUND')) {
          unavailableModels.push(modelName);
          // Don't print unavailable models to reduce noise
        } else if (error.message?.includes('timeout')) {
          // Timeout might mean it's available but slow
          console.log(`⏳ ${modelName} - TIMEOUT (might be available)`);
        } else {
          // Other errors might indicate availability but different issue
          console.log(`⚠️  ${modelName} - Error: ${error.message?.substring(0, 60)}`);
        }
      }
    }
    
    console.log("\n" + "=".repeat(70));
    console.log("  📊 SUMMARY");
    console.log("=".repeat(70));
    
    if (availableModels.length > 0) {
      console.log(`\n✅ AVAILABLE MODELS (${availableModels.length}):`);
      availableModels.forEach(m => console.log(`   - ${m}`));
    } else {
      console.log("\n❌ NO MODELS AVAILABLE");
      console.log("   All tested models returned 404 Not Found");
      console.log("   This means your project doesn't have access to Gemini models via Vertex AI");
    }
    
    console.log(`\n❌ UNAVAILABLE MODELS: ${unavailableModels.length}`);
    
    console.log("\n💡 RECOMMENDATIONS:");
    if (availableModels.length === 0) {
      console.log("   1. Use Standard Gemini API (set GEMINI_API_KEY)");
      console.log("   2. Request Vertex AI model access from Google Cloud Support");
      console.log("   3. Check if Generative AI features need to be enabled");
      console.log("   4. Verify billing is enabled for the project");
    } else {
      console.log(`   ✅ You can use: ${availableModels[0]}`);
      console.log("   Update VERTEX_MODEL in src/modelVertex.ts");
    }
    
    console.log("\n");
    
  } catch (error: any) {
    console.error("❌ Error checking models:", error.message);
    if (error.stack) {
      console.error(error.stack.split('\n').slice(0, 5).join('\n'));
    }
  }
}

checkAvailableModels();

