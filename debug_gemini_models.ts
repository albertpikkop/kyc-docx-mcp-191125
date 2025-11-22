import { getGeminiClient } from './src/modelGemini.js';
import "dotenv/config";

async function testModel() {
  const client = getGeminiClient();
  const modelName = "gemini-2.0-flash-exp";
  console.log(`Testing ${modelName}...`);
  try {
      const model = client.getGenerativeModel({ model: modelName });
      const result = await model.generateContent("Hello");
      console.log(`Success with ${modelName}: `, result.response.text());
  } catch (error) {
    console.error(`Error with ${modelName}:`, error);
  }
}

testModel();
