import { GoogleGenerativeAI } from "@google/generative-ai";

// Initialize Gemini API (Google AI Studio)
const apiKey = process.env.GEMINI_API_KEY;

// Default model configuration for DOCUMENT EXTRACTION
// RULE: Use Gemini 2.5 Pro for extraction (stable, proven)
// NOTE: Gemini 3.0 Pro is for WEBSITE/CREATIVE tasks, not extraction
export const GEMINI_MODEL = process.env.GEMINI_MODEL_ID || "gemini-2.5-pro"; 

// Specific Model Tiers for Extraction Strategy
export const GEMINI_PRO_MODEL = process.env.GEMINI_PRO_MODEL_ID || "gemini-2.5-pro"; // Primary: Complex docs (Acta)
export const GEMINI_FLASH_MODEL = process.env.GEMINI_FLASH_MODEL_ID || "gemini-2.5-flash-preview-05-20"; // Fast: Standard docs

// Waterfall Tiers for Extraction: 2.5 Pro -> 2.5 Flash
export const MODEL_TIERS = [
  GEMINI_PRO_MODEL,    // Primary extraction model
  GEMINI_FLASH_MODEL   // Fallback for speed
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
