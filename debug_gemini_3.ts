import { getGeminiClient } from './src/modelGemini.js';
import "dotenv/config";

async function testModel(modelName: string) {
  const client = getGeminiClient();
  console.log(`Testing ${modelName}...`);
  try {
      const model = client.getGenerativeModel({ model: modelName });
      const result = await model.generateContent("Hello");
      console.log(`✅ Success with ${modelName}: `, result.response.text().substring(0, 50));
      return true;
  } catch (error: any) {
    // console.error(`❌ Error with ${modelName}:`, error.message?.substring(0, 100));
    console.log(`❌ Failed: ${modelName}`);
    return false;
  }
}

async function run() {
    // Trying exact variations for 3.0 based on news
    const models = [
        "gemini-3.0-pro",
        "gemini-3.0-flash",
        "gemini-3.0-pro-001",
        "gemini-3.0-flash-001",
        "gemini-3.0-pro-exp",
        "gemini-3.0-flash-exp",
        "gemini-3.0-experimental",
        "gemini-experimental", // Often points to latest
        "gemini-3.0-pro-latest",
        "gemini-3.0-flash-latest"
    ];

    for (const m of models) {
        await testModel(m);
    }
}

run();

