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
    console.log(`❌ Failed: ${modelName}`);
    return false;
  }
}

async function run() {
    // Trying potential 2.5 aliases
    // Google often releases point releases as just "gemini-1.5-pro-002" etc, but "2.5" implies next gen.
    // Let's try specific 2.5 strings if they exist, or fallback to the 2.0 flash exp which is often the bleeding edge.
    // Web search mentioned 2.5 released in Sep 2025?
    const models = [
        "gemini-2.5-pro",
        "gemini-2.5-flash",
        "gemini-2.5-pro-exp",
        "gemini-2.5-flash-exp",
        "gemini-2.5-flash-latest",
        // Also try date-based versions if 2.5 was Sep 2025
        "gemini-pro-experimental", // often latest
        "gemini-flash-experimental" 
    ];

    for (const m of models) {
        await testModel(m);
    }
}

run();

