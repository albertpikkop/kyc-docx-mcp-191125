#!/usr/bin/env tsx
/**
 * Simple Vertex AI Test
 * Tests if Vertex AI is working with a basic text generation
 */

import "dotenv/config";
import { getVertexClient, VERTEX_MODEL } from "./src/modelVertex.js";

async function testVertexSimple() {
  console.log("\n" + "=".repeat(70));
  console.log("  🧪 SIMPLE VERTEX AI TEST");
  console.log("=".repeat(70) + "\n");
  
  // Check configuration
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT;
  const location = process.env.GOOGLE_CLOUD_LOCATION || process.env.GCP_LOCATION || 'us-central1';
  const apiKey = process.env.GEMINI_API_KEY;
  
  console.log("📋 Configuration:");
  console.log(`   Project: ${project || 'NOT SET'}`);
  console.log(`   Location: ${location}`);
  console.log(`   Model: ${VERTEX_MODEL}`);
  console.log(`   GEMINI_API_KEY: ${apiKey ? 'SET (will use standard API)' : 'NOT SET (will use Vertex AI)'}`);
  console.log("");
  
  if (!project) {
    console.error("❌ ERROR: GOOGLE_CLOUD_PROJECT or GCP_PROJECT is not set!");
    console.log("\n💡 Set it with: export GOOGLE_CLOUD_PROJECT=gpounj-40b74\n");
    process.exit(1);
  }
  
  try {
    console.log("📤 Step 1: Initializing Vertex AI client...");
    const client = getVertexClient();
    console.log(`   ✅ Client initialized: ${client.constructor.name}`);
    
    console.log("\n📤 Step 2: Creating model instance...");
    // Try multiple models - Vertex AI may not have gemini-3.0-pro
    const modelsToTry = [
      VERTEX_MODEL,
      "gemini-1.5-flash",
      "gemini-1.5-pro",
      "gemini-1.5-flash-001",
      "gemini-1.5-pro-001"
    ];
    
    let model: any = null;
    let workingModel = '';
    
    for (const modelName of modelsToTry) {
      try {
        model = client.getGenerativeModel({
          model: modelName,
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 256,
          }
        });
        // Test if model works by making a quick call
        const testResult = await model.generateContent("test");
        await testResult.response;
        workingModel = modelName;
        console.log(`   ✅ Model created and verified: ${modelName}`);
        break;
      } catch (error: any) {
        if (error.message?.includes('404') || error.message?.includes('NOT_FOUND')) {
          console.log(`   ⚠️  ${modelName} not available, trying next...`);
          continue;
        } else {
          throw error; // Re-throw if it's not a 404
        }
      }
    }
    
    if (!model) {
      throw new Error("No available models found in Vertex AI. Try using standard Gemini API (set GEMINI_API_KEY)");
    }
    
    console.log("\n📤 Step 3: Sending test request...");
    const prompt = "Say 'Hello from Vertex AI' in exactly 5 words.";
    console.log(`   Prompt: "${prompt}"`);
    console.log(`   Using model: ${workingModel}`);
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    
    // Handle response (Vertex AI response format)
    const responseAny = response as any;
    let text = '';
    
    if (typeof responseAny.text === 'function') {
      text = responseAny.text();
    } else if (responseAny.candidates && responseAny.candidates[0]) {
      text = responseAny.candidates[0].content?.parts?.[0]?.text || '';
    } else {
      text = String(responseAny);
    }
    
    console.log("\n✅ Step 4: Response received!");
    console.log(`   Response: "${text.trim()}"`);
    
    // Check if response makes sense
    if (text.toLowerCase().includes('hello') || text.toLowerCase().includes('vertex')) {
      console.log("\n" + "=".repeat(70));
      console.log("  ✅ SUCCESS: Vertex AI is working!");
      console.log("=".repeat(70));
      console.log("\n📊 Test Results:");
      console.log("   ✅ Client initialization: Working");
      console.log("   ✅ Model creation: Working");
      console.log("   ✅ API call: Working");
      console.log("   ✅ Response parsing: Working");
      console.log("\n💡 Vertex AI is ready to use!\n");
    } else {
      console.log("\n⚠️  Response received but content seems unexpected");
      console.log("   This might indicate an issue with the model or response format");
    }
    
  } catch (error: any) {
    console.error("\n" + "=".repeat(70));
    console.error("  ❌ ERROR: Vertex AI Test Failed");
    console.error("=".repeat(70));
    console.error(`\nError: ${error.message}\n`);
    
    if (error.message?.includes('403') || error.message?.includes('PERMISSION_DENIED')) {
      console.error("💡 Permission Issue:");
      console.error("   1. Check if Vertex AI API is enabled");
      console.error("   2. Verify IAM permissions (need 'Vertex AI User' role)");
      console.error("   3. Run: tsx scripts/fix_vertex_permissions.ts\n");
    } else if (error.message?.includes('404') || error.message?.includes('NOT_FOUND')) {
      console.error("💡 Model Not Found:");
      console.error(`   Model '${VERTEX_MODEL}' is not available in this project/region`);
      console.error("   Try using standard Gemini API instead (set GEMINI_API_KEY)\n");
    } else if (error.message?.includes('401') || error.message?.includes('UNAUTHENTICATED')) {
      console.error("💡 Authentication Issue:");
      console.error("   1. Run: gcloud auth application-default login");
      console.error("   2. Or set: export GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json\n");
    } else {
      console.error("💡 Troubleshooting:");
      console.error("   - Check your network connection");
      console.error("   - Verify project ID is correct");
      console.error("   - Check Vertex AI API is enabled\n");
    }
    
    if (error.stack) {
      console.error("Stack trace:");
      console.error(error.stack.split('\n').slice(0, 5).join('\n'));
    }
    
    process.exit(1);
  }
}

testVertexSimple();

