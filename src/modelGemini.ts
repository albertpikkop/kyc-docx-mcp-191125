import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

// Gemini 2.5 Flash (Stable) is the chosen standard.
// We enforce this version to ensure extraction quality parity with GPT-5.1.
export const GEMINI_MODEL = "gemini-2.5-flash"; 

export function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set in environment variables");
  }
  return new GoogleGenerativeAI(apiKey);
}
