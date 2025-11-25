import "dotenv/config";
import { VertexAI } from '@google-cloud/vertexai';

async function listModels() {
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || 'gpounj-40b74';
  const location = process.env.GOOGLE_CLOUD_LOCATION || process.env.GCP_LOCATION || 'us-central1';
  
  console.log(`Listing models for project: ${project}, location: ${location}\n`);
  
  try {
    const vertexAI = new VertexAI({ project, location });
    
    // Try to list available models
    console.log("Available Gemini models in Vertex AI:");
    console.log("Note: Model names may vary. Common formats:");
    console.log("  - gemini-1.5-flash");
    console.log("  - gemini-1.5-pro");
    console.log("  - gemini-1.5-flash-001");
    console.log("  - gemini-1.5-pro-001");
    console.log("  - gemini-3-pro-preview");
    console.log("  - gemini-3.0-pro");
    console.log("\nTrying common model names...\n");
    
    const modelsToTry = [
      "gemini-1.5-flash",
      "gemini-1.5-pro",
      "gemini-1.5-flash-001",
      "gemini-1.5-pro-001",
      "gemini-3-pro-preview",
      "gemini-3.0-pro",
      "gemini-pro",
      "gemini-flash"
    ];
    
    for (const modelName of modelsToTry) {
      try {
        const model = vertexAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent("test");
        await result.response;
        console.log(`✅ ${modelName} - WORKS!`);
        break;
      } catch (error: any) {
        if (error.message?.includes('404') || error.message?.includes('NOT_FOUND')) {
          console.log(`❌ ${modelName} - Not found`);
        } else {
          console.log(`⚠️  ${modelName} - Error: ${error.message?.substring(0, 50)}`);
        }
      }
    }
    
  } catch (error: any) {
    console.error("Error:", error.message);
  }
}

listModels();
