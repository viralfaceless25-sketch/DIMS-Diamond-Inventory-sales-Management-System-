const express = require('express');
const multer = require('multer');
const pool = require('../db/pool');
const { extractPdfText } = require('../utils/pdfExtract');
const { parseInvoiceStones } = require('../utils/invoiceParser');
const { sortStones } = require('../services/sortingService');
const { normalizeStockStatus, stockStatusLabel, isRequestableStockStatus } = require('../services/stockStatus');
const { requireAuth, requireRole } = require('../middleware/auth');
const { createRateLimit } = require('../middleware/rateLimit');

const router = express.Router();
// Invoice upload lives in the Sales Rep app.
router.use(requireAuth, requireRole('sales_rep'));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const extractLimit = createRateLimit({ windowMs: 10 * 60_000, max: 30, key: (req) => `invoice:${req.user.id}` });

// Replaces the prototype's hardcoded mock (README "Known Gap #1").
//
// Strategy: extract the PDF's text, parse each line-item row (barcode + shape
// + carat + color + clarity + cert), then for every barcode ALSO try to match
// it against our own inventory. Inventory data is authoritative when present
// (it's our clean gemological record); when a stone on the invoice isn't in
// inventory yet, we fall back to the data parsed from the invoice itself
// rather than dropping the stone. Each returned stone carries a `source`
// ('inventory' | 'invoice') so the UI can indicate provenance.
//
// Limitation: only works on PDFs with a real text layer. Scanned / image-only
// invoices have no text to read and need an OCR step in front of this — that
// case is detected and reported rather than silently returning nothing.
router.post('/extract', extractLimit, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const extension = String(req.file.originalname || '').toLowerCase();
    if (!extension.endsWith('.pdf') || !['application/pdf', 'application/octet-stream'].includes(req.file.mimetype)) {
      return res.status(415).json({ error: 'Only PDF invoices and memos are accepted' });
    }
    const { rows: repRows } = await pool.query('SELECT branch FROM sales_reps WHERE id = $1', [req.user.salesRepId]);
    const branch = repRows[0]?.branch;
    if (!branch) return res.status(400).json({ error: 'Your sales rep profile is missing a branch' });

    let text = '';
    try {
      text = await extractPdfText(req.file.buffer);
    } catch (parseErr) {
      console.error('PDF extract failed:', parseErr.message);
      return res.status(422).json({
        error: 'Could not read this PDF (it may be corrupted or password-protected).',
      });
    }

    const parsed = parseInvoiceStones(text);

    if (parsed.length === 0) {
      return res.json({
        stones: [],
        warning:
          "No stock numbers were found in this PDF's text. If this is a scanned/image invoice, it has no text layer to read — an OCR step would be needed.",
      });
    }

    const barcodes = parsed.map((s) => s.barcode);

    const { rows: looseRows } = await pool.query(
      `SELECT *, 'loose' AS item_type FROM loose_diamonds WHERE barcode = ANY($1)`,
      [barcodes]
    );
    const { rows: jewelryRows } = await pool.query(
      `SELECT *, 'jewelry' AS item_type FROM jewelry_pieces WHERE barcode = ANY($1)`,
      [barcodes]
    );
    const inventoryByBarcode = new Map();
    for (const row of [...looseRows, ...jewelryRows]) {
      inventoryByBarcode.set(row.barcode, row);
    }

    // For each detected stone, decide availability. A stone is AVAILABLE only
    // if it's in our stock AND (when a branch is given) in that branch. When
    // available we use the authoritative inventory record; otherwise we return
    // the invoice-parsed data and mark it unavailable so the rep is told the
    // diamond isn't in stock and it won't be sent to inventory.
    const scopeBranch = branch && branch !== 'ALL' ? branch : null;
    const merged = parsed.map((p) => {
      const inv = inventoryByBarcode.get(p.barcode);
      const inStock = !!inv;
      const inBranch = inStock && (!scopeBranch || inv.branch === scopeBranch);
      const stockStatus = inStock ? normalizeStockStatus(inv.stock_status) : null;
      const requestable = inStock && inBranch && isRequestableStockStatus(stockStatus);

      if (requestable) {
        const { cost, ...safe } = inv; // strip internal cost — rep-facing
        if (safe.carat != null) safe.carat = Number(safe.carat);
        return {
          ...safe,
          stock_status: stockStatus,
          source: 'inventory',
          available: true,
          availabilityLabel: 'Available',
        };
      }

      return {
        barcode: p.barcode,
        shape: p.shape,
        carat: p.carat,
        color: p.color,
        clarity: p.clarity,
        certificate_no: p.certificate_no,
        item_type: p.item_type,
        confidence: p.confidence,
        source: 'invoice',
        available: false,
        // Distinguish "not in stock at all" from "in stock but another branch".
        reason: inStock && !inBranch ? 'wrong_branch' : inStock ? stockStatus : 'not_in_stock',
        stockBranch: inStock ? inv.branch : null,
        stock_status: stockStatus,
        availabilityLabel: inStock ? stockStatusLabel(stockStatus) : 'Not in stock',
      };
    });

    const sorted = sortStones(merged);
    const available = sorted.filter((s) => s.available);
    const unavailable = sorted.filter((s) => !s.available);

    res.json({
      stones: sorted,
      totalDetected: sorted.length,
      availableCount: available.length,
      unavailableCount: unavailable.length,
      unavailable: unavailable.map((s) => ({
        barcode: s.barcode,
        reason: s.reason,
        stockBranch: s.stockBranch || null,
        availabilityLabel: s.availabilityLabel || null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
