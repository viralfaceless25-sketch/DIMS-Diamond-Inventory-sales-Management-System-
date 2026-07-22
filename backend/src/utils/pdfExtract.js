// Robust PDF text extraction using Mozilla's pdfjs-dist (maintained), which
// handles a much wider range of real-world PDFs than the old pdf-parse lib.
// pdfjs-dist is ESM-only, so we dynamic-import it from this CommonJS codebase.

async function extractPdfText(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const uint8 = new Uint8Array(buffer);
  const loadingTask = pdfjs.getDocument({
    data: uint8,
    // Silence the "fake worker" warning — fine for server-side one-shot parsing.
    useSystemFonts: true,
    isEvalSupported: false,
  });

  const doc = await loadingTask.promise;
  let fullText = '';

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => item.str).join(' ');
    fullText += pageText + '\n';
  }

  await doc.cleanup();
  return fullText;
}

module.exports = { extractPdfText };
