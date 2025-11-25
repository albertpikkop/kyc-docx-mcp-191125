import { GoogleGenerativeAI } from "@google/generative-ai";

// Initialize Gemini API (Google AI Studio)
const apiKey = process.env.GEMINI_API_KEY;

// Default model configuration
export const GEMINI_MODEL = process.env.GEMINI_MODEL_ID || "gemini-2.5-pro"; 

// Specific Model Tiers for Hybrid Strategy
// RULE: Always use Gemini 2.5+ - never use lesser models
export const GEMINI_PRO_MODEL = process.env.GEMINI_PRO_MODEL_ID || "gemini-2.5-pro"; // Complex docs (Acta)
export const GEMINI_FLASH_MODEL = process.env.GEMINI_FLASH_MODEL_ID || "gemini-2.5-flash-preview-05-20"; // Standard docs - MUST be 2.5+
export const GEMINI_LATEST_MODEL = "gemini-2.5-pro"; // Latest stable 2.5

// Waterfall Tiers: Flash -> Pro 2.5 -> Pro 3.0
export const MODEL_TIERS = [
  GEMINI_FLASH_MODEL,
  GEMINI_PRO_MODEL,
  GEMINI_LATEST_MODEL
]; 

let geminiClient: GoogleGenerativeAI | null = null;

export function getGeminiClient(): GoogleGenerativeAI {
  if (!geminiClient) {
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set.");
    }
    geminiClient = new GoogleGenerativeAI(apiKey);
  }
  
  return geminiClient;
}
