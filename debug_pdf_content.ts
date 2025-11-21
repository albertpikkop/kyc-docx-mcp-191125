
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// Try handling potential export structure differences
const pdfParseLib = require('pdf-parse');
const pdfParse = pdfParseLib.default || pdfParseLib;

const filePath = "/Users/ashishpunj/Desktop/mcp-docs/grupo-pounj/October 2025.pdf";

async function inspect() {
    if (!fs.existsSync(filePath)) {
        console.error("File not found:", filePath);
        return;
    }
    const buffer = fs.readFileSync(filePath);
    try {
        const data = await pdfParse(buffer);
        console.log("--- START PDF TEXT DUMP ---");
        console.log(data.text); // Dump all text to find the caveat and keywords
        console.log("--- END PDF TEXT DUMP ---");
    } catch (e) {
        console.error("Failed to parse PDF:", e);
    }
}

inspect();

