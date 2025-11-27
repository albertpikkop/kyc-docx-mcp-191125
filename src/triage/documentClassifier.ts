import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { PDFDocument } from "pdf-lib";
import { getGeminiClient } from "../modelGemini";

export type DocumentType = 
  | 'sat_constancia' 
  | 'acta_constitutiva' 
  | 'lista_asistentes' 
  | 'ine' 
  | 'passport' 
  | 'cfe' 
  | 'telmex' 
  | 'bank_statement' 
  | 'unknown';

export interface PageClassification {
  pageNumber: number;
  documentType: DocumentType;
  confidence: number;
  extractedName?: string;
  extractedRfc?: string;
  isFirstPage: boolean;
  isLastPage: boolean;
  pageCount: number; // Total pages in the detected document
  reasoning: string;
}

export interface DocumentSegment {
  type: DocumentType;
  startPage: number;
  endPage: number;
  confidence: number;
  metadata: {
    name?: string;
    rfc?: string;
    description?: string;
  };
}

// Helper to normalize document type from AI response
function normalizeDocType(type: string): DocumentType {
  const lower = type.toLowerCase();
  if (lower.includes('sat') || lower.includes('constancia')) return 'sat_constancia';
  if (lower.includes('acta') || lower.includes('testimonio') || lower.includes('escritura')) return 'acta_constitutiva';
  if (lower.includes('lista') || lower.includes('asistentes')) return 'lista_asistentes';
  if (lower.includes('ine') || lower.includes('elector')) return 'ine';
  if (lower.includes('passport') || lower.includes('pasaporte')) return 'passport';
  if (lower.includes('cfe') || lower.includes('luz')) return 'cfe';
  if (lower.includes('telmex') || lower.includes('telefono')) return 'telmex';
  if (lower.includes('bank') || lower.includes('banco') || lower.includes('cuenta')) return 'bank_statement';
  return 'unknown';
}

const classificationSchema = z.object({
  document_type: z.string().transform(normalizeDocType),
  confidence: z.number().min(0).max(100),
  extracted_name: z.string().nullable().optional().transform(val => val === 'null' ? undefined : val),
  extracted_rfc: z.string().nullable().optional().transform(val => val === 'null' ? undefined : val),
  is_first_page: z.boolean(),
  is_last_page: z.boolean(),
  detected_page_number: z.union([z.number(), z.string(), z.null()]).optional().transform(val => typeof val === 'number' ? val : (val ? parseInt(String(val)) : undefined)),
  total_pages_in_doc: z.union([z.number(), z.string(), z.null()]).optional().transform(val => typeof val === 'number' ? val : (val ? parseInt(String(val)) : undefined)),
  reasoning: z.string()
});

/**
 * Classifies a single page of a PDF using Gemini Vision
 */
export async function classifyPage(
  pdfBuffer: Buffer, 
  pageIndex: number, // 0-based
  totalPdfPages: number
): Promise<PageClassification> {
  try {
    // Extract single page as a new PDF buffer
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const newPdf = await PDFDocument.create();
    const [page] = await newPdf.copyPages(pdfDoc, [pageIndex]);
    newPdf.addPage(page);
    const pageBuffer = Buffer.from(await newPdf.save());
    
    // Convert to base64 for Gemini
    const base64Data = pageBuffer.toString('base64');
    
    // Use Gemini Flash for speed and cost
    const client = getGeminiClient();
    const model = client.getGenerativeModel({ model: 'gemini-2.5-flash' });
    
    const prompt = `
    Analyze this document page (Page ${pageIndex + 1} of ${totalPdfPages} in the file).
    
    Task: Identify the document type and extract key metadata to help split a multi-document PDF.
    
    Specific Identification Rules:
    1. SAT Constancia (Constancia de Situación Fiscal): Look for "CONSTANCIA DE SITUACIÓN FISCAL", RFC, Cédula de Identificación Fiscal (QR code grid). Extract the Name/Razon Social and RFC.
    2. Acta Constitutiva: Look for "TESTIMONIO", "ESCRITURA PUBLICA", notary seals, "Sociedad Anónima", "Constitución de Sociedad".
    3. Lista de Asistentes: Look for "Lista de Asistentes", "Asamblea General", table with "Accionista", "Acciones", "Valor".
    4. INE/Passport: ID documents.
    5. Utility Bills (CFE/Telmex): Look for logos and service details.
    
    Return a JSON object with:
    - document_type: one of the allowed types
    - confidence: 0-100
    - extracted_name: Name of person/company (crucial for SAT)
    - extracted_rfc: RFC if visible (crucial for SAT)
    - is_first_page: Does this look like the first page of a document?
    - is_last_page: Does this look like the last page? (e.g. signature page, end of list)
    - detected_page_number: If you see "Página X de Y", extracted X
    - total_pages_in_doc: If you see "Página X de Y", extracted Y
    - reasoning: Brief explanation
    `;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType: "application/pdf",
          data: base64Data
        }
      }
    ]);

    const response = result.response;
    const text = response.text();
    
    // Parse JSON
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in response");
    }
    
    const parsed = JSON.parse(jsonMatch[0]);
    const validated = classificationSchema.parse(parsed);
    
    return {
      pageNumber: pageIndex + 1,
      documentType: validated.document_type as DocumentType,
      confidence: validated.confidence,
      extractedName: validated.extracted_name,
      extractedRfc: validated.extracted_rfc,
      isFirstPage: validated.is_first_page,
      isLastPage: validated.is_last_page,
      pageCount: validated.total_pages_in_doc || 1,
      reasoning: validated.reasoning
    };
    
  } catch (error) {
    console.error(`Error classifying page ${pageIndex + 1}:`, error);
    return {
      pageNumber: pageIndex + 1,
      documentType: 'unknown',
      confidence: 0,
      isFirstPage: false,
      isLastPage: false,
      pageCount: 0,
      reasoning: `Error: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * Analyzes an entire PDF and segments it into logical documents
 */
export async function segmentDocument(pdfPath: string): Promise<DocumentSegment[]> {
  const pdfBuffer = fs.readFileSync(pdfPath);
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const totalPages = pdfDoc.getPageCount();
  
  console.log(`Analyzing ${totalPages} pages in ${path.basename(pdfPath)}...`);
  
  // Classify all pages in parallel (with concurrency limit)
  const classifications: PageClassification[] = [];
  const CONCURRENCY = 5;
  
  for (let i = 0; i < totalPages; i += CONCURRENCY) {
    const batch = Array.from({ length: Math.min(CONCURRENCY, totalPages - i) }, (_, j) => i + j);
    console.log(`Processing pages ${batch[0] + 1} to ${batch[batch.length - 1] + 1}...`);
    
    const results = await Promise.all(
      batch.map(pageIndex => classifyPage(pdfBuffer, pageIndex, totalPages))
    );
    classifications.push(...results);
  }
  
  // Group pages into segments
  const segments: DocumentSegment[] = [];
  let currentSegment: Partial<DocumentSegment> | null = null;
  
  for (let i = 0; i < classifications.length; i++) {
    const page = classifications[i];
    const prevPage = i > 0 ? classifications[i - 1] : null;
    
    // Logic to detect new segment start:
    // 1. It's the first page of the file
    // 2. The detected document type changes (and isn't just "unknown" noise in the middle)
    // 3. The page is explicitly marked as "isFirstPage" by AI with high confidence
    // 4. The previous page was "isLastPage"
    
    const typeChanged = prevPage && page.documentType !== prevPage.documentType && page.documentType !== 'unknown';
    const explicitStart = page.isFirstPage && page.confidence > 80;
    const prevEnded = prevPage && prevPage.isLastPage && prevPage.confidence > 80;
    
    // Heuristic: If we have SAT constancia, usually it's 1-3 pages. If we see another SAT constancia with a DIFFERENT name, it's a new doc.
    const newSatIdentity = page.documentType === 'sat_constancia' && 
                           prevPage?.documentType === 'sat_constancia' &&
                           page.extractedRfc && prevPage.extractedRfc &&
                           page.extractedRfc !== prevPage.extractedRfc;

    if (i === 0 || typeChanged || explicitStart || prevEnded || newSatIdentity) {
      // Close previous segment
      if (currentSegment) {
        currentSegment.endPage = i; // 1-based, so endPage is the index of previous page + 1 (which is just i)
        segments.push(currentSegment as DocumentSegment);
      }
      
      // Start new segment
      currentSegment = {
        type: page.documentType,
        startPage: i + 1,
        confidence: page.confidence,
        metadata: {
          name: page.extractedName,
          rfc: page.extractedRfc,
          description: page.reasoning
        }
      };
    } else {
      // Continue segment - update metadata if we found better info
      if (currentSegment && page.confidence > (currentSegment.confidence || 0)) {
        currentSegment.type = page.documentType;
        currentSegment.confidence = page.confidence;
        if (page.extractedName) currentSegment.metadata!.name = page.extractedName;
        if (page.extractedRfc) currentSegment.metadata!.rfc = page.extractedRfc;
      }
    }
  }
  
  // Close final segment
  if (currentSegment) {
    currentSegment.endPage = totalPages;
    segments.push(currentSegment as DocumentSegment);
  }
  
  return segments;
}
