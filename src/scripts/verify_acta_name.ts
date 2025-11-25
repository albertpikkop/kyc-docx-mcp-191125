
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfLib = require('pdf-parse');

const PDF_PATH = "/Users/ashishpunj/Desktop/mcp-docs/grupo-pounj/1. Acta Grupo Pounj.pdf";

async function verifyActa() {
  console.log(`Reading PDF: ${PDF_PATH}`);
  console.log(`PDF Library Type: ${typeof pdfLib}`);
  
  // Handle different export formats
  const pdfParse = typeof pdfLib === 'function' ? pdfLib : pdfLib.default;

  try {
    const dataBuffer = fs.readFileSync(PDF_PATH);
    const data = await pdfParse(dataBuffer);
    const text = data.text;
    
    console.log(`\n--- Document Content Analysis ---`);
    console.log(`Total Length: ${text.length} characters`);
    
    // 1. Search for name variations
    const name1 = "ASHISH PUNJ";
    const name2 = "PUNJ ASHISH";
    const name3 = "Ashish Punj";
    
    console.log(`\n--- Searching for Names ---`);
    
    const upperText = text.toUpperCase();
    
    [name1, name2, name3].forEach(name => {
        const idx = upperText.indexOf(name.toUpperCase());
        if (idx !== -1) {
            console.log(`✅ Found "${name}" at index ${idx}`);
            // Show context
            const start = Math.max(0, idx - 200);
            const end = Math.min(text.length, idx + 200);
            console.log(`   Context: "...${text.substring(start, end).replace(/\n/g, ' ')}..."`);
        } else {
            console.log(`❌ Did NOT find "${name}"`);
        }
    });
    
    // 2. Search for Appointments/Powers
    console.log(`\n--- Searching for Powers/Appointments ---`);
    const keywords = ["Administrador General", "Apoderado", "Poderes", "Otorgamiento", "ASHISH"];
    
    keywords.forEach(kw => {
        const regex = new RegExp(kw, 'gi');
        let match;
        while ((match = regex.exec(text)) !== null) {
             console.log(`Found keyword "${kw}":`);
             const start = Math.max(0, match.index - 100);
             const end = Math.min(text.length, match.index + 300);
             console.log(`   "...${text.substring(start, end).replace(/\n/g, ' ')}..."\n`);
             // Only show first 3 matches per keyword to avoid spam
             if (regex.lastIndex > 0) break; 
        }
    });

  } catch (error) {
    console.error("Error reading PDF:", error);
  }
}

verifyActa();
