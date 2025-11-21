
import * as fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const filePath = "/Users/ashishpunj/Desktop/mcp-docs/grupo-pounj/October 2025.pdf";

async function inspect() {
    if (!fs.existsSync(filePath)) {
        console.error("File not found:", filePath);
        return;
    }
    
    const buffer = new Uint8Array(fs.readFileSync(filePath));
    
    try {
        const loadingTask = pdfjsLib.getDocument(buffer);
        const doc = await loadingTask.promise;
        console.log(`PDF loaded. Pages: ${doc.numPages}`);
        
        const page = await doc.getPage(1);
        const textContent = await page.getTextContent();
        const text = textContent.items.map((item: any) => item.str).join(' ');
        
        console.log("--- START PDF TEXT DUMP ---");
        console.log(text);
        console.log("--- END PDF TEXT DUMP ---");
        
    } catch (e) {
        console.error("Failed to parse PDF with PDF.js:", e);
    }
}

inspect();

