import { PDFDocument } from "pdf-lib";
import * as fs from "fs";
import * as path from "path";
import { DocumentSegment, DocumentType } from "./documentClassifier";
import { getStandardizedFilename } from "./namingConvention";

export interface SplitResult {
  originalFile: string;
  outputFiles: {
    path: string;
    documentType: DocumentType;
    pageRange: [number, number];
    extractedMetadata: {
      name?: string;
      rfc?: string;
      description?: string;
    };
  }[];
}

/**
 * Splits a PDF based on the provided segments
 */
export async function splitPdf(
  pdfPath: string, 
  segments: DocumentSegment[],
  outputDir: string
): Promise<SplitResult> {
  const pdfBuffer = fs.readFileSync(pdfPath);
  const srcDoc = await PDFDocument.load(pdfBuffer);
  const originalBasename = path.basename(pdfPath);
  
  const result: SplitResult = {
    originalFile: pdfPath,
    outputFiles: []
  };
  
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  console.log(`Splitting ${originalBasename} into ${segments.length} files...`);
  
  for (const segment of segments) {
    // Skip 'unknown' segments unless they are significant size (>2 pages)
    if (segment.type === 'unknown' && (segment.endPage - segment.startPage) < 2) {
      console.log(`Skipping small unknown segment (pages ${segment.startPage}-${segment.endPage})`);
      continue;
    }
    
    // Create new PDF
    const newPdf = await PDFDocument.create();
    
    // Copy pages (indices are 0-based, so subtract 1)
    const pageIndices = Array.from(
      { length: segment.endPage - segment.startPage + 1 }, 
      (_, i) => segment.startPage - 1 + i
    );
    
    const copiedPages = await newPdf.copyPages(srcDoc, pageIndices);
    copiedPages.forEach(page => newPdf.addPage(page));
    
    // Generate filename using standardized convention
    const filename = getStandardizedFilename(
      segment.type,
      segment.metadata.name,
      segment.metadata.rfc,
      originalBasename
    );
    
    const outputPath = path.join(outputDir, filename);
    
    // Save file
    const pdfBytes = await newPdf.save();
    fs.writeFileSync(outputPath, pdfBytes);
    
    console.log(`✅ Saved ${filename} (${segment.type}, pages ${segment.startPage}-${segment.endPage})`);
    
    result.outputFiles.push({
      path: outputPath,
      documentType: segment.type,
      pageRange: [segment.startPage, segment.endPage],
      extractedMetadata: segment.metadata
    });
  }
  
  return result;
}

