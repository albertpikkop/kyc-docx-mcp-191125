/**
 * 🍌 Nano Banana Pro - Landing Page Image Generator
 * 
 * Uses Gemini 3.0 Pro Image Preview (Nano Banana Pro) to generate
 * stunning visuals for the MexKYC landing page.
 * 
 * Usage:
 *   npx tsx scripts/nanoBananaGenerator.ts
 *   npx tsx scripts/nanoBananaGenerator.ts --prompt "your custom prompt"
 *   npx tsx scripts/nanoBananaGenerator.ts --all
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Nano Banana Pro Model ID
const NANO_BANANA_MODEL = "gemini-2.0-flash-exp-image-generation";

// Output directory for generated images
const OUTPUT_DIR = path.join(__dirname, "../website/images/generated");

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Landing Page Image Prompts
const LANDING_PAGE_PROMPTS = {
  hero: {
    name: "hero-main",
    prompt: `Create a stunning hero image for a KYC fintech product. 
    Show a sleek, modern visualization of Mexican legal documents (Acta Constitutiva, SAT Constancia) 
    transforming into flowing digital data streams. 
    Dark navy blue background (#0a1628) with electric blue (#3b82f6) and cyan (#22d3ee) glowing accents.
    Abstract geometric shapes, floating document icons becoming data particles.
    Ultra-modern, professional, cinematic lighting. 4K quality.
    Style: Futuristic fintech, clean minimalism with depth.`,
    aspectRatio: "16:9"
  },
  
  chatInterface: {
    name: "chat-with-data",
    prompt: `Create an illustration of an AI chat interface showing a conversation about business data.
    Show a modern chat bubble UI with a question: "Who are the shareholders of Grupo Financiero?"
    And an AI response showing structured data with names and percentages.
    Glassmorphism design, frosted glass effect on dark background.
    Accent colors: bright blue (#3b82f6) and emerald green (#10b981).
    Professional, clean, SaaS product aesthetic. High resolution.`,
    aspectRatio: "4:3"
  },
  
  documentScanning: {
    name: "document-scan",
    prompt: `Photorealistic visualization of AI scanning a Mexican legal document.
    Show a physical document (Acta Constitutiva) with holographic scan lines moving across it.
    Extracted data fields floating above the document in glowing boxes.
    Data points: Company name, RFC, shareholders, legal powers.
    Dark mode aesthetic with blue (#3b82f6) and purple (#8b5cf6) gradients.
    Cinematic depth of field, professional photography style.`,
    aspectRatio: "16:9"
  },
  
  dashboard: {
    name: "kyc-dashboard",
    prompt: `Modern KYC compliance dashboard UI mockup.
    Show a dark-themed dashboard with:
    - Document verification status cards (green checkmarks)
    - Risk score gauge showing "Low Risk" in green
    - Company profile summary panel
    - Recent activity timeline
    Glassmorphism cards, subtle gradients, professional data visualization.
    Colors: Dark slate (#1e293b) background, blue (#3b82f6) accents, green (#22c55e) for success.
    Clean, modern SaaS design. 4K resolution.`,
    aspectRatio: "16:9"
  },
  
  mexicoMap: {
    name: "mexico-coverage",
    prompt: `Stylized map of Mexico showing nationwide coverage.
    Abstract geometric representation with glowing connection points in major cities.
    Network lines connecting business hubs: Mexico City, Monterrey, Guadalajara.
    Dark background with vibrant turquoise (#14b8a6) and gold (#f59e0b) accents.
    Modern, tech-forward aesthetic. Data visualization style.
    Professional, clean lines, subtle glow effects.`,
    aspectRatio: "16:9"
  },
  
  securityShield: {
    name: "security-trust",
    prompt: `Abstract visualization of data security and compliance.
    Show a glowing shield icon with lock symbol at center.
    Surrounded by floating certification badges and compliance icons.
    Binary code and encrypted data streams in the background.
    Colors: Deep blue (#1e40af) to purple (#7c3aed) gradient.
    Professional, trustworthy, enterprise-grade aesthetic.
    Subtle particle effects, modern 3D style.`,
    aspectRatio: "1:1"
  },
  
  beforeAfter: {
    name: "before-after-comparison",
    prompt: `Split-screen comparison image for KYC process.
    LEFT SIDE (Before - chaotic): 
    - Messy pile of paper documents
    - Red warning icons, stressed person silhouette
    - Gray, dull colors representing manual work
    
    RIGHT SIDE (After - organized):
    - Clean digital dashboard with organized data
    - Green checkmarks, happy business icons
    - Bright blue and white, modern and efficient
    
    Clear dividing line in the middle. Professional marketing style.`,
    aspectRatio: "16:9"
  },
  
  apiIntegration: {
    name: "api-integration",
    prompt: `Technical illustration showing API integration concept.
    Central glowing API endpoint icon with code brackets {}.
    Connected to multiple service icons: Bank, Government (SAT), Documents.
    Flowing data lines in JSON-style brackets between nodes.
    Dark mode with syntax highlighting colors: blue, green, orange, purple.
    Developer-focused, technical but clean aesthetic.
    Modern flat design with subtle 3D depth.`,
    aspectRatio: "4:3"
  }
};

interface GenerationResult {
  name: string;
  success: boolean;
  filePath?: string;
  error?: string;
}

async function generateImage(
  client: GoogleGenerativeAI,
  name: string,
  prompt: string,
  aspectRatio: string = "16:9"
): Promise<GenerationResult> {
  console.log(`\n🍌 Generating: ${name}...`);
  console.log(`   Aspect Ratio: ${aspectRatio}`);
  
  try {
    const model = client.getGenerativeModel({ 
      model: NANO_BANANA_MODEL,
      generationConfig: {
        // @ts-ignore - responseModalities is valid for image generation
        responseModalities: ["TEXT", "IMAGE"],
      }
    });

    const result = await model.generateContent({
      contents: [{
        role: "user",
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        // @ts-ignore - image config
        responseModalities: ["TEXT", "IMAGE"],
      }
    });

    const response = result.response;
    
    // Check for image in response
    for (const candidate of response.candidates || []) {
      for (const part of candidate.content?.parts || []) {
        if (part.inlineData) {
          const imageData = part.inlineData.data;
          const mimeType = part.inlineData.mimeType || "image/png";
          const extension = mimeType.includes("jpeg") ? "jpg" : "png";
          
          const fileName = `${name}.${extension}`;
          const filePath = path.join(OUTPUT_DIR, fileName);
          
          // Decode base64 and save
          const buffer = Buffer.from(imageData, "base64");
          fs.writeFileSync(filePath, buffer);
          
          console.log(`   ✅ Saved: ${filePath}`);
          return { name, success: true, filePath };
        }
      }
    }
    
    // If no image found, check for text response
    const textResponse = response.text();
    if (textResponse) {
      console.log(`   ⚠️ Got text response instead of image: ${textResponse.substring(0, 100)}...`);
    }
    
    return { name, success: false, error: "No image in response" };
    
  } catch (error: any) {
    console.error(`   ❌ Error: ${error.message}`);
    return { name, success: false, error: error.message };
  }
}

async function generateAllImages(client: GoogleGenerativeAI): Promise<GenerationResult[]> {
  const results: GenerationResult[] = [];
  
  console.log("\n" + "=".repeat(60));
  console.log("🍌 NANO BANANA PRO - Landing Page Image Generator");
  console.log("=".repeat(60));
  console.log(`📁 Output directory: ${OUTPUT_DIR}`);
  console.log(`🎨 Generating ${Object.keys(LANDING_PAGE_PROMPTS).length} images...`);
  
  for (const [key, config] of Object.entries(LANDING_PAGE_PROMPTS)) {
    const result = await generateImage(
      client,
      config.name,
      config.prompt,
      config.aspectRatio
    );
    results.push(result);
    
    // Small delay between requests to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  return results;
}

async function generateSingleImage(
  client: GoogleGenerativeAI,
  prompt: string,
  name: string = "custom"
): Promise<GenerationResult> {
  console.log("\n" + "=".repeat(60));
  console.log("🍌 NANO BANANA PRO - Custom Image Generator");
  console.log("=".repeat(60));
  console.log(`📁 Output directory: ${OUTPUT_DIR}`);
  
  return await generateImage(client, name, prompt, "16:9");
}

function printSummary(results: GenerationResult[]) {
  console.log("\n" + "=".repeat(60));
  console.log("📊 GENERATION SUMMARY");
  console.log("=".repeat(60));
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(`\n✅ Successful: ${successful.length}/${results.length}`);
  for (const result of successful) {
    console.log(`   - ${result.name}: ${result.filePath}`);
  }
  
  if (failed.length > 0) {
    console.log(`\n❌ Failed: ${failed.length}/${results.length}`);
    for (const result of failed) {
      console.log(`   - ${result.name}: ${result.error}`);
    }
  }
  
  console.log("\n" + "=".repeat(60));
  console.log("🎉 Done! Check the generated images in:");
  console.log(`   ${OUTPUT_DIR}`);
  console.log("=".repeat(60) + "\n");
}

async function main() {
  // Check for API key
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("❌ Error: GEMINI_API_KEY environment variable is not set");
    console.error("   Please add it to your .env file");
    process.exit(1);
  }
  
  // Initialize client
  const client = new GoogleGenerativeAI(apiKey);
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
🍌 Nano Banana Pro - Landing Page Image Generator

Usage:
  npx tsx scripts/nanoBananaGenerator.ts [options]

Options:
  --all              Generate all predefined landing page images
  --prompt "text"    Generate a single image with custom prompt
  --name "filename"  Custom filename for --prompt (default: "custom")
  --list             List all available predefined prompts
  --help, -h         Show this help message

Examples:
  npx tsx scripts/nanoBananaGenerator.ts --all
  npx tsx scripts/nanoBananaGenerator.ts --prompt "A futuristic robot" --name "robot"
  npx tsx scripts/nanoBananaGenerator.ts --list
`);
    return;
  }
  
  if (args.includes("--list")) {
    console.log("\n📋 Available Predefined Prompts:\n");
    for (const [key, config] of Object.entries(LANDING_PAGE_PROMPTS)) {
      console.log(`  ${key}:`);
      console.log(`    Name: ${config.name}`);
      console.log(`    Aspect: ${config.aspectRatio}`);
      console.log(`    Prompt: ${config.prompt.substring(0, 80)}...`);
      console.log();
    }
    return;
  }
  
  const promptIndex = args.indexOf("--prompt");
  if (promptIndex !== -1 && args[promptIndex + 1]) {
    const customPrompt = args[promptIndex + 1];
    const nameIndex = args.indexOf("--name");
    const customName = nameIndex !== -1 && args[nameIndex + 1] ? args[nameIndex + 1] : "custom";
    
    const result = await generateSingleImage(client, customPrompt, customName);
    printSummary([result]);
    return;
  }
  
  // Default: generate all images
  const results = await generateAllImages(client);
  printSummary(results);
}

main().catch(console.error);

