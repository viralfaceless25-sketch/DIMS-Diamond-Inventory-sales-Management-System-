const express = require('express');
const multer = require('multer');
const pool = require('../db/pool');
const { extractPdfText } = require('../utils/pdfExtract');
const { parseInvoiceStones } = require('../utils/invoiceParser');
const { sortStones } = require('../services/sortingService');
const {
  mergeInvoiceWithInventory,
} = require('../services/invoiceAvailabilityService');
const { requireAuth, requireRole } = require('../middleware/auth');
const { createRateLimit } = require('../middleware/rateLimit');

const router = express.Router();
router.use(requireAuth, requireRole('sales_rep'));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
});
const extractLimit = createRateLimit({
  windowMs: 10 * 60_000,
  max: 30,
  key: (req) => `invoice:${req.user.id}`,
});

function looksLikePdf(file) {
  const allowedMime = ['application/pdf', 'application/octet-stream']
    .includes(file.mimetype);
  return String(file.originalname || '').toLowerCase().endsWith('.pdf')
    && allowedMime
    && file.buffer.length >= 5
    && file.buffer.subarray(0, 5).toString('ascii') === '%PDF-';
}

router.post(
  '/extract',
  extractLimit,
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      if (!looksLikePdf(req.file)) {
        return res.status(415).json({
          error: 'Only a real PDF invoice or memo is accepted',
        });
      }

      const { rows: repRows } = await pool.query(
        'SELECT branch FROM sales_reps WHERE id = $1',
        [req.user.salesRepId]
      );
      const repBranch = repRows[0]?.branch;
      if (!repBranch) {
        return res.status(400).json({
          error: 'Your sales rep profile is missing a branch',
        });
      }

      let text;
      try {
        text = await extractPdfText(req.file.buffer);
      } catch (parseError) {
        console.error('PDF extract failed:', parseError.message);
        return res.status(422).json({
          error: 'Could not read this PDF (it may be corrupted or password-protected).',
        });
      }

      const parsed = parseInvoiceStones(text);
      if (!parsed.length) {
        return res.json({
          stones: [],
          repBranch,
          warning:
            "No stock numbers were found in this PDF's text. A scanned image-only PDF needs OCR before it can be imported.",
        });
      }

      const barcodes = parsed.map((stone) => stone.barcode);
      const [{ rows: looseRows }, { rows: jewelryRows }] = await Promise.all([
        pool.query(
          `SELECT *, 'loose' AS item_type
           FROM loose_diamonds
           WHERE barcode = ANY($1)`,
          [barcodes]
        ),
        pool.query(
          `SELECT *, 'jewelry' AS item_type
           FROM jewelry_pieces
           WHERE barcode = ANY($1)`,
          [barcodes]
        ),
      ]);

      // Availability is evaluated across all home branches. The client groups
      // requestable rows by the stored branch and applies local or BT routing.
      const merged = mergeInvoiceWithInventory(
        parsed,
        [...looseRows, ...jewelryRows]
      );
      const sorted = sortStones(merged);
      const available = sorted.filter((stone) => stone.available);
      const unavailable = sorted.filter((stone) => !stone.available);

      res.json({
        stones: sorted,
        repBranch,
        totalDetected: sorted.length,
        availableCount: available.length,
        unavailableCount: unavailable.length,
        unavailable: unavailable.map((stone) => ({
          barcode: stone.barcode,
          reason: stone.reason,
          stockBranch: stone.stockBranch || null,
          availabilityLabel: stone.availabilityLabel || null,
        })),
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
