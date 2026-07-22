// Parses stone rows out of Maitri invoice/memo PDF text.
//
// ACCURACY GUARANTEE: stone detection is driven by a global scan for every
// barcode-shaped token in the PDF text, so if the invoice lists 7 stones we
// return 7 stones. Field parsing (shape/carat/color/clarity/cert) is a
// best-effort second pass anchored on each barcode; if the layout is unusual
// those fields come back null, but the stone is still detected and its barcode
// is still validated against stock downstream. Detection never depends on the
// surrounding columns being in a particular order.

const { COLOR_ORDER, CLARITY_ORDER } = require('../services/sortingService');

const COLORS = new Set([...COLOR_ORDER, 'J', 'K', 'L', 'M', 'N']);
const CLARITIES = new Set([...CLARITY_ORDER, 'SI3', 'I1', 'I2', 'I3']);

// Barcode shape: 5-10 leading digits, a hyphen, then 2-6 alphanumerics.
// - Prefix >=5 digits avoids matching 4-digit years like "2024-2025".
// - Suffix 2-6 avoids single-character noise.
// Global (g) so we find EVERY occurrence, and de-dupe after.
const BARCODE_GLOBAL = /\b\d{5,10}-[A-Z0-9]{2,6}\b/gi;
const BARCODE_TOKEN = /^\d{5,10}-[A-Z0-9]{2,6}$/i;
const CARAT_TOKEN = /^\d+\.\d+$/;
const CERT_TOKEN = /^\d{6,10}$/;

function parseInvoiceStones(text) {
  if (!text) return [];

  // --- Pass 1: detect every unique barcode in the whole document. ---
  const found = text.match(BARCODE_GLOBAL) || [];
  const uniqueBarcodes = [...new Set(found.map((b) => b.toUpperCase()))];

  // --- Pass 2: best-effort field parse, anchored on each barcode token. ---
  const tokens = text.split(/\s+/).filter(Boolean);
  const tokenIndexByBarcode = new Map();
  tokens.forEach((tok, idx) => {
    const up = tok.toUpperCase();
    if (BARCODE_TOKEN.test(up) && !tokenIndexByBarcode.has(up)) {
      tokenIndexByBarcode.set(up, idx);
    }
  });

  return uniqueBarcodes.map((barcode) => {
    const i = tokenIndexByBarcode.get(barcode);

    let shape = null;
    let carat = null;
    let color = null;
    let clarity = null;
    let cert = null;
    let confidence = 'low';

    if (i != null) {
      const rawShape = tokens[i + 1] || null;
      const rawCts = tokens[i + 2] || null;
      const rawColor = (tokens[i + 3] || '').toUpperCase();
      const rawClarity = (tokens[i + 4] || '').toUpperCase();

      // Cert: first 6-10 digit run within a short window after the barcode.
      for (let j = i + 3; j < Math.min(i + 16, tokens.length); j++) {
        if (CERT_TOKEN.test(tokens[j])) {
          cert = tokens[j];
          break;
        }
      }

      const caratValid = rawCts != null && CARAT_TOKEN.test(rawCts);
      const colorValid = COLORS.has(rawColor);
      const clarityValid = CLARITIES.has(rawClarity);
      const confident = caratValid && (colorValid || clarityValid);

      shape = confident ? rawShape : null;
      carat = caratValid ? Number(rawCts) : null;
      color = colorValid ? rawColor : null;
      clarity = clarityValid ? rawClarity : null;
      confidence = confident ? 'high' : 'low';
    }

    return { barcode, shape, carat, color, clarity, certificate_no: cert, item_type: 'loose', confidence };
  });
}

module.exports = { parseInvoiceStones };
