#!/usr/bin/env tsx
/**
 * Test Gemini 3.0 Pro via Standard Gemini API
 * Run with: tsx test_gemini_3_pro.ts
 */

import "dotenv/config";
import { GoogleGenerativeAI } from "@google/generative-ai";

async function testGemini3Pro() {
  console.log("🧪 Testing Gemini 3.0 Pro via Standard Gemini API\n");
  
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    console.error("❌ GEMINI_API_KEY is not set!");
    console.log("\n💡 To use Gemini 3.0 Pro:");
    console.log("   1. Get your API key from: https://aistudio.google.com/app/apikey");
    console.log("   2. Set it: export GEMINI_API_KEY='your-api-key'");
    console.log("   3. Run this test again\n");
    process.exit(1);
  }
  
  console.log(`✅ API Key found: ${apiKey.substring(0, 10)}...`);
  console.log(`📋 Model: gemini-3-pro-preview (Gemini 3.0 Pro)\n`);
  
  try {
    const client = new GoogleGenerativeAI(apiKey);
    const model = client.getGenerativeModel({
      model: "gemini-3-pro-preview",
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1024,
      }
    });
    
    console.log("📤 Sending test request...");
    const prompt = "Say 'Hello from Gemini 3.0 Pro' in JSON format: {\"message\": \"your response\", \"model\": \"gemini-3-pro-preview\"}";
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    console.log("\n🤖 Response:");
    console.log(text);
    
    // Try to parse as JSON (handle markdown code blocks)
    try {
      let jsonText = text.trim();
      // Remove markdown code blocks if present
      if (jsonText.startsWith('```json')) {
        jsonText = jsonText.replace(/^```json\n?/, '').replace(/\n?```$/, '');
      } else if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/^```\n?/, '').replace(/\n?```$/, '');
      }
      const json = JSON.parse(jsonText);
      console.log("\n✅ Valid JSON response:");
      console.log(JSON.stringify(json, null, 2));
    } catch (e) {
      console.log("\n⚠️  Response is not JSON (that's okay for this test)");
      console.log("   Raw response:", text.substring(0, 200));
    }
    
    console.log("\n✅ Gemini 3.0 Pro Test Passed!");
    console.log("\n💡 You can now use Gemini 3.0 Pro in your KYC extraction:");
    console.log("   - The codebase automatically uses gemini-3-pro-preview");
    console.log("   - Just ensure GEMINI_API_KEY is set");
    console.log("   - Run: npm run test:vertex:grupo-pounj");
    
  } catch (error: any) {
    console.error("\n❌ Test Failed:", error.message);
    if (error.message?.includes('API_KEY_INVALID')) {
      console.error("\n💡 Your API key appears to be invalid.");
      console.error("   Get a new one from: https://aistudio.google.com/app/apikey");
    } else if (error.message?.includes('not found') || error.message?.includes('404')) {
      console.error("\n💡 Model gemini-3-pro-preview might not be available yet.");
      console.error("   Try: gemini-1.5-pro or gemini-1.5-flash");
    }
    if (error.stack) {
      console.error("\nStack trace:", error.stack);
    }
    process.exit(1);
  }
}

testGemini3Pro();

