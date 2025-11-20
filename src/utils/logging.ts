export function logExtractorError(docType: string, filePath: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    JSON.stringify({
      level: "error",
      event: "extraction_failed",
      doc_type: docType,
      file: filePath,
      message
    })
  );
}

