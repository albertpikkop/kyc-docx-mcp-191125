#!/usr/bin/env tsx
/**
 * Simple confirmation that Gemini 3.0 Pro is working
 * Run with: tsx confirm_gemini_3_pro.ts
 */

import "dotenv/config";
import { GoogleGenerativeAI } from "@google/generative-ai";

async function confirmGemini3Pro() {
  console.log("\n" + "=".repeat(70));
  console.log("  🔍 CONFIRMING GEMINI 3.0 PRO IS WORKING");
  console.log("=".repeat(70) + "\n");
  
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("❌ ERROR: GEMINI_API_KEY is not set!\n");
    process.exit(1);
  }
  
  console.log("✅ Step 1: API Key found\n");
  
  try {
    const client = new GoogleGenerativeAI(apiKey);
    const model = client.getGenerativeModel({
      model: "gemini-3-pro-preview",
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
      }
    });
    
    console.log("✅ Step 2: Model initialized (gemini-3-pro-preview)\n");
    
    // Test 1: Simple response
    console.log("📤 Test 1: Basic response test...");
    const test1 = await model.generateContent("Respond with JSON: {\"test\": \"Gemini 3.0 Pro is working\", \"timestamp\": \"now\"}");
    const response1 = await test1.response;
    let text1 = response1.text().trim();
    
    // Clean markdown if present
    if (text1.startsWith('```json')) {
      text1 = text1.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    } else if (text1.startsWith('```')) {
      text1 = text1.replace(/^```\n?/, '').replace(/\n?```$/, '');
    }
    
    const json1 = JSON.parse(text1);
    console.log("   ✅ Response received:");
    console.log("   " + JSON.stringify(json1, null, 2).split('\n').join('\n   '));
    
    // Test 2: Model identification
    console.log("\n📤 Test 2: Model identification test...");
    const test2 = await model.generateContent(`What is your exact model name? Respond with JSON: {"model": "your-model-name", "version": "x.x"}`);
    const response2 = await test2.response;
    let text2 = response2.text().trim();
    
    if (text2.startsWith('```json')) {
      text2 = text2.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    } else if (text2.startsWith('```')) {
      text2 = text2.replace(/^```\n?/, '').replace(/\n?```$/, '');
    }
    
    const json2 = JSON.parse(text2);
    console.log("   ✅ Model response:");
    console.log("   " + JSON.stringify(json2, null, 2).split('\n').join('\n   '));
    
    // Test 3: Structured output (like KYC extraction)
    console.log("\n📤 Test 3: Structured JSON output test (simulating KYC extraction)...");
    const test3 = await model.generateContent(`Extract data from this text: "Company: Acme Corp, RFC: ABC123456, Founded: 2020"
    
Respond with JSON matching this schema:
{
  "company_name": "string",
  "rfc": "string", 
  "founded_year": "number"
}`);

    const response3 = await test3.response;
    let text3 = response3.text().trim();
    
    if (text3.startsWith('```json')) {
      text3 = text3.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    } else if (text3.startsWith('```')) {
      text3 = text3.replace(/^```\n?/, '').replace(/\n?```$/, '');
    }
    
    const json3 = JSON.parse(text3);
    console.log("   ✅ Structured extraction working:");
    console.log("   " + JSON.stringify(json3, null, 2).split('\n').join('\n   '));
    
    // Final confirmation
    console.log("\n" + "=".repeat(70));
    console.log("  ✅ CONFIRMATION: GEMINI 3.0 PRO IS WORKING!");
    console.log("=".repeat(70));
    console.log("\n📋 Verification Results:");
    console.log("   ✅ API Connection: Working");
    console.log("   ✅ Model: gemini-3-pro-preview (Gemini 3.0 Pro)");
    console.log("   ✅ Basic Responses: Working");
    console.log("   ✅ JSON Output: Working");
    console.log("   ✅ Structured Extraction: Working");
    console.log("\n💡 You can now use Gemini 3.0 Pro for KYC document extraction!");
    console.log("   Run: npm run test:vertex:grupo-pounj\n");
    
  } catch (error: any) {
    console.error("\n❌ ERROR:", error.message);
    if (error.stack) {
      console.error("\nStack:", error.stack.split('\n').slice(0, 5).join('\n'));
    }
    process.exit(1);
  }
}

confirmGemini3Pro();

