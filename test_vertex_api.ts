import "dotenv/config";
import { getVertexClient, VERTEX_MODEL } from "./src/modelVertex.js";

async function testVertex() {
  console.log("🧪 Testing Vertex AI Gemini 3.0 Pro Connection...");
  console.log(`   Project: ${process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || 'NOT SET'}`);
  console.log(`   Location: ${process.env.GOOGLE_CLOUD_LOCATION || process.env.GCP_LOCATION || 'us-central1 (default)'}`);
  console.log(`   Model: ${VERTEX_MODEL}\n`);
  
  // Try multiple model names if the first one fails
  const modelsToTry = [
    VERTEX_MODEL,
    "gemini-3.0-pro",
    "gemini-3-pro-preview",
    "gemini-1.5-pro",
    "gemini-1.5-flash"
  ];
  
  let lastError: any = null;
  
  for (const modelName of modelsToTry) {
    try {
      console.log(`\n🔄 Trying model: ${modelName}...`);
    const client = getVertexClient();
    console.log(`✅ Vertex AI Client initialized successfully`);
      console.log(`   Client Type: ${client.constructor.name}`);

    const model = client.getGenerativeModel({ 
        model: modelName,
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1024,
      }
    });
    
    console.log("📤 Sending test request...");
    const result = await model.generateContent("Say 'Hello from Vertex AI Gemini 3.0 Pro' in JSON format: {\"message\": \"your response\"}");
    const response = await result.response;
      // Handle both Vertex AI and standard Gemini API response formats
      const responseAny = response as any;
      const text = typeof responseAny.text === 'function' 
        ? responseAny.text() 
        : (responseAny.candidates?.[0]?.content?.parts?.[0]?.text || "");
    
    console.log("\n🤖 Response:");
    console.log(text);
      console.log(`\n✅ Vertex AI Test Passed with model: ${modelName}!`);
      return; // Success, exit

  } catch (error: any) {
      lastError = error;
      console.warn(`   ⚠️  ${modelName} failed: ${error.message}`);
      
      // If it's a model not found error, try next model
      if (error.message?.includes('404') || error.message?.includes('NOT_FOUND') || error.message?.includes('not found')) {
        console.log(`   Trying next model...`);
        continue;
      }
      
      // If it's a different error (auth, etc.), break
      break;
    }
  }
  
  // If we get here, all models failed
  console.error("\n❌ Vertex AI Test Failed with all models");
  console.error(`   Last error: ${lastError?.message}`);
  if (lastError?.details) {
    console.error("   Details:", lastError.details);
    }
  if (lastError?.stack) {
    console.error("\nStack trace:", lastError.stack);
  }
}

testVertex();
