import sharp from 'sharp';
import * as path from 'path';
// pdf-img-convert exports an object with a convert method: { convert: function }
// Using namespace import (import * as) to access the convert method
// Verified: pdfImgConvert.convert() works correctly with this import style
import * as pdfImgConvert from 'pdf-img-convert';

// Configuration for "High Fidelity but Low Cost"
const MAX_DIMENSION = 1536;
const JPEG_QUALITY = 80;

export interface OptimizationResult {
  success: boolean;
  buffer?: Buffer;
  mimeType?: string;
  width?: number;
  height?: number;
  isFallback?: boolean;
}

export async function optimizeDocument(filePath: string): Promise<OptimizationResult[]> {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.pdf') {
    return await optimizePdf(filePath);
  } else if (['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.bmp'].includes(ext)) {
    return [await optimizeImage(filePath)];
  } else {
    // For unsupported types, return a failure result so extractor handles it (e.g. skips or throws)
    // or we could return raw buffer if it's a format OpenAI might accept? 
    // Actually OpenAI 'files.create' accepts many things, but vision needs images.
    // We return success: false.
    return [{ success: false, isFallback: true }];
  }
}

async function optimizeImage(input: string | Buffer): Promise<OptimizationResult> {
  try {
    const pipeline = sharp(input);
    const metadata = await pipeline.metadata();

    if (!metadata.width || !metadata.height) {
        throw new Error('Could not determine image dimensions.');
    }

    if (metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION) {
        pipeline.resize({
        width: MAX_DIMENSION,
        height: MAX_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true
        });
    }

    pipeline.jpeg({ quality: JPEG_QUALITY, force: true });

    const buffer = await pipeline.toBuffer();
    const info = await sharp(buffer).metadata();

    return {
        success: true,
        buffer,
        mimeType: 'image/jpeg',
        width: info.width,
        height: info.height
    };
  } catch (error) {
      console.warn("Image optimization failed:", error);
      return { success: false, isFallback: true };
  }
}

async function optimizePdf(filePath: string): Promise<OptimizationResult[]> {
  try {
    const pages = await pdfImgConvert.convert(filePath, {
        width: MAX_DIMENSION
    });

    const optimizedPages: OptimizationResult[] = [];

    for (const pageBuffer of pages) {
       const optimized = await optimizeImage(Buffer.from(pageBuffer));
       if (optimized.success) {
           optimizedPages.push(optimized);
       }
    }
    
    if (optimizedPages.length === 0) {
        throw new Error("No pages converted successfully");
    }

    return optimizedPages;

  } catch (e) {
    console.warn("Optimization Warning: PDF Conversion failed.", e);
    
    // Return a single result indicating failure/fallback so the extractor can switch to File Upload
    return [{ success: false, isFallback: true }];
  }
}
