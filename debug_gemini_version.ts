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
    console.error(`❌ Error with ${modelName}:`, error.message?.substring(0, 100));
    return false;
  }
}

async function run() {
    // Trying potential 3.0 aliases
    await testModel("gemini-3.0-pro-exp");
    await testModel("gemini-3.0-flash-exp");
    await testModel("gemini-3.0-pro");
    await testModel("gemini-3.0-flash");
    
    // Trying 2.0 aliases just in case
    await testModel("gemini-2.0-pro-exp");
    await testModel("gemini-2.0-flash-exp"); // We know this works
}

run();

