
import "dotenv/config";
import { extractWithGemini } from '../utils/geminiExtractor.js';
import { GEMINI_PRO_MODEL } from '../modelGemini.js';

const ACTA_PATH = "/Users/ashishpunj/Desktop/mcp-docs/grupo-pounj/1. Acta Grupo Pounj.pdf";

async function verifyName() {
  console.log(`🔍 Verifying name in Acta: ${ACTA_PATH}`);
  
  const instructions = `
    You are a forensic document analyzer.
    
    TASK:
    1. Search the ENTIRE document for the name "Ashish PUNJ" or "PUNJ Ashish" or "ASHISH PUNJ".
    2. Extract the EXACT text snippet where this name appears.
    3. Determine the specific role assigned to this person (e.g., Shareholder, Administrator, Apoderado).
    4. Verify if they are explicitly granted "Poderes" (Powers of Attorney).
    
    OUTPUT JSON FORMAT:
    {
      "name_found": "Exact Name Found",
      "page_number": "approximate page",
      "context_snippet": "Text surrounding the name...",
      "roles": ["Role 1", "Role 2"],
      "has_powers": boolean,
      "powers_description": "Summary of powers if any"
    }
  `;
  
  const schema = {
    type: "object",
    properties: {
      name_found: { type: "string" },
      context_snippet: { type: "string" },
      roles: { type: "array", items: { type: "string" } },
      has_powers: { type: "boolean" },
      powers_description: { type: "string" }
    }
  };

  try {
    const result = await extractWithGemini(
        ACTA_PATH, 
        "application/pdf", 
        schema, 
        instructions, 
        GEMINI_PRO_MODEL
    );
    
    console.log("\n✅ Verification Result:");
    console.log(JSON.stringify(result, null, 2));
    
  } catch (error) {
    console.error("❌ Verification Failed:", error);
  }
}

verifyName();

