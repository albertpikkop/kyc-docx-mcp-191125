import { GoogleGenerativeAI } from "@google/generative-ai";

// Initialize Gemini API (Google AI Studio)
const apiKey = process.env.GEMINI_API_KEY;

// Default model configuration - UPDATED TO GEMINI 3.0 PRO
export const GEMINI_MODEL = process.env.GEMINI_MODEL_ID || "gemini-3.0-pro"; 

// Specific Model Tiers for Hybrid Strategy
// RULE: Always use Gemini 3.0+ for best extraction quality
export const GEMINI_3_PRO_MODEL = process.env.GEMINI_3_PRO_MODEL_ID || "gemini-3.0-pro"; // Best: Complex docs (Acta)
export const GEMINI_PRO_MODEL = process.env.GEMINI_PRO_MODEL_ID || "gemini-2.5-pro"; // Fallback: Complex docs
export const GEMINI_FLASH_MODEL = process.env.GEMINI_FLASH_MODEL_ID || "gemini-2.5-flash-preview-05-20"; // Fast: Standard docs
export const GEMINI_LATEST_MODEL = "gemini-3.0-pro"; // Latest stable

// Waterfall Tiers: 3.0 Pro (best) -> 2.5 Pro -> 2.5 Flash
// Start with best model, fall back if issues
export const MODEL_TIERS = [
  GEMINI_3_PRO_MODEL,
  GEMINI_PRO_MODEL,
  GEMINI_FLASH_MODEL
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
