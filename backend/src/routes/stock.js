const express = require('express');
const multer = require('multer');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const pool = require('../db/pool');
const { getHoldersForBarcodes } = require('../services/duplicateService');
const { normalizeStockStatus, stockStatusLabel } = require('../services/stockStatus');
const { parseStockFile } = require('../services/stockFileParser');
const { enqueueStockImport } = require('../services/stockImportQueue');
const { archiveBranchSnapshot } = require('../services/stockSnapshotService');
const { withTransaction } = require('../db/withRetry');
const { broadcast } = require('../sockets');
const { requireAuth, requireRole } = require('../middleware/auth');
const { createRateLimit } = require('../middleware/rateLimit');

const router = express.Router();
router.use(requireAuth);
const stockUploadLimit = createRateLimit({ windowMs: 15 * 60_000, max: 12, key: (req) => `stock:${req.user.id}` });
const upload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (req, file, callback) => {
      const extension = path.extname(String(file.originalname || '')).toLowerCase();
      callback(null, `diamond-stock-${randomUUID()}${extension}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
});

function availabilityFor(item, holdersMap) {
  if (item.snapshot_active === false) {
    return {
      status: 'not_in_snapshot',
      label: 'Not in latest ERP snapshot',
      holders: [],
    };
  }
  const status = normalizeStockStatus(item.stock_status);
  const holders = holdersMap.get(item.barcode) || [];
  if (status !== 'available') {
    return { status, label: stockStatusLabel(status), holders };
  }
  if (!holders || holders.length === 0) return { status: 'in_stock', label: 'Available', holders: [] };
  const distinctReps = new Set(holders.map((h) => h.repId));
  if (distinctReps.size > 1) {
    return { status: 'conflict', label: `${distinctReps.size} reps`, repCount: distinctReps.size, holders };
  }
  return { status: 'requested', label: `With ${holders[0].repName}`, repName: holders[0].repName, holders };
}

// SQL fragments that sort by Color -> Clarity -> Shape -> Size (carat), matching
// sortingService. Unknown/fancy colors and clarities sort last. Built as a
// CASE ladder so the database does the ordering before we page — essential
// when a branch has tens of thousands of stones.
const COLOR_RANK = ['D', 'E', 'F', 'G', 'H', 'I'];
const CLARITY_RANK = ['FL', 'IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2'];
function rankCase(column, values) {
  const whens = values.map((v, i) => `WHEN upper(${column}) = '${v}' THEN ${i}`).join(' ');
  return `CASE ${whens} ELSE ${values.length} END`;
}
const LOOSE_ORDER = `ORDER BY ${rankCase('color', COLOR_RANK)}, ${rankCase('clarity', CLARITY_RANK)}, shape NULLS LAST, carat NULLS LAST`;

// Stone-picking order for the "browse to request" grids (?sort=pick): a
// stone with no ERP encumbrance (available) sorts before on_hold/on_memo/
// in_transit stock, then shape -> carat -> color -> clarity ascending —
// distinct from LOOSE_ORDER above, which sortingService/paperwork rely on
// and must stay color-first.
const PICK_ORDER = `ORDER BY
  CASE WHEN coalesce(stock_status, 'available') = 'available' THEN 0 ELSE 1 END,
  shape NULLS LAST,
  carat NULLS LAST,
  ${rankCase('color', COLOR_RANK)},
  ${rankCase('clarity', CLARITY_RANK)}`;

function clampPage(q) {
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(q.pageSize, 10) || 50));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

// Parses comma-separated ?colors= / ?clarities= filters into arrays.
function csv(v) {
  return (v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function numericOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const match = String(value).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

function addLikeFilter(conditions, params, column, value) {
  if (!value) return;
  params.push(`%${String(value).toLowerCase()}%`);
  conditions.push(`lower(coalesce(${column},'')) LIKE $${params.length}`);
}

function addAnyFilter(conditions, params, column, values) {
  if (!values.length) return;
  params.push(values.map((v) => v.toUpperCase()));
  conditions.push(`upper(coalesce(${column},'')) = ANY($${params.length})`);
}

function addMetalTokenFilter(conditions, params, values) {
  if (!values.length) return;
  const likes = [];
  for (const value of values) {
    const raw = String(value).trim().toUpperCase();
    if (!raw) continue;
    const tokens = raw === 'YELLOW' ? ['YG', 'YELLOW']
      : raw === 'WHITE' ? ['WG', 'WHITE']
        : raw === 'PINK' ? ['PG', 'RG', 'PINK', 'ROSE']
          : [raw];
    const tokenParts = [];
    for (const token of tokens) {
      params.push(`%${token}%`);
      tokenParts.push(`upper(coalesce(metal,'')) LIKE $${params.length}`);
    }
    likes.push(`(${tokenParts.join(' OR ')})`);
  }
  if (likes.length) conditions.push(`(${likes.join(' OR ')})`);
}

async function distinctValues(table, column, branch, itemType) {
  const params = [];
  const conditions = [
    'snapshot_active = true',
    `${column} IS NOT NULL`,
    `trim(${column}) <> ''`,
  ];
  if (branch && branch !== 'ALL') {
    params.push(branch);
    conditions.push(`branch = $${params.length}`);
  }
  const { rows } = await pool.query(
    `SELECT DISTINCT ${column} AS value FROM ${table}
     WHERE ${conditions.join(' AND ')}
     ORDER BY ${column}`,
    params
  );
  return rows.map((r) => r.value).filter(Boolean);
}

router.get('/options', async (req, res, next) => {
  try {
    const { branch, itemType = 'loose' } = req.query;
    if (itemType === 'jewelry') {
      const [categories, metals, labs] = await Promise.all([
        distinctValues('jewelry_pieces', 'category', branch, 'jewelry'),
        distinctValues('jewelry_pieces', 'metal', branch, 'jewelry'),
        distinctValues('jewelry_pieces', 'lab', branch, 'jewelry'),
      ]);
      return res.json({ categories, metals, labs, shapes: [], statuses: ['available', 'on_memo', 'on_hold', 'in_transit'] });
    }
    const [shapes, labs] = await Promise.all([
      distinctValues('loose_diamonds', 'shape', branch, 'loose'),
      distinctValues('loose_diamonds', 'lab', branch, 'loose'),
    ]);
    res.json({ shapes, labs, categories: [], metals: [], statuses: ['available', 'on_memo', 'on_hold', 'in_transit'] });
  } catch (err) {
    next(err);
  }
});

// GET /api/stock/loose?branch=NY&page=1&pageSize=50&search=&barcode=&cert=&colors=D,E&clarities=VS1,VS2
// `search` matches barcode OR cert; `barcode` and `cert` are separate live
// filters (AND semantics) used by the mini diamond search. Cost visibility
// derived from role.
router.get('/loose', async (req, res, next) => {
  try {
    const { branch, search, barcode, cert, shape, lab, caratMin, caratMax, requestableOnly } = req.query;
    const { page, pageSize, offset } = clampPage(req.query);
    const colors = csv(req.query.colors);
    const clarities = csv(req.query.clarities);
    const shapes = csv(req.query.shapes);
    const labs = csv(req.query.labs);
    const statuses = csv(req.query.statuses).map(normalizeStockStatus);
    // certStatuses=certified,non_cert (either, both, or neither selected —
    // both/neither means no filter, matching the other chip-row filters).
    const certStatuses = csv(req.query.certStatuses);

    const params = [];
    const conditions = ['snapshot_active = true'];
    if (branch && branch !== 'ALL') {
      params.push(branch);
      conditions.push(`branch = $${params.length}`);
    }
    if (search) {
      params.push(`%${String(search).toLowerCase()}%`);
      const i = params.length;
      conditions.push(`(lower(barcode) LIKE $${i} OR lower(coalesce(certificate_no,'')) LIKE $${i})`);
    }
    addLikeFilter(conditions, params, 'barcode', barcode);
    addLikeFilter(conditions, params, 'certificate_no', cert);
    addLikeFilter(conditions, params, 'shape', shape);
    addLikeFilter(conditions, params, 'lab', lab);
    addAnyFilter(conditions, params, 'shape', shapes);
    addAnyFilter(conditions, params, 'lab', labs);
    if (colors.length) {
      params.push(colors.map((c) => c.toUpperCase()));
      conditions.push(`upper(color) = ANY($${params.length})`);
    }
    if (clarities.length) {
      params.push(clarities.map((c) => c.toUpperCase()));
      conditions.push(`upper(clarity) = ANY($${params.length})`);
    }
    if (statuses.length) {
      params.push(statuses);
      conditions.push(`coalesce(stock_status, 'available') = ANY($${params.length})`);
    }
    if (certStatuses.length === 1) {
      conditions.push(
        certStatuses[0] === 'non_cert'
          ? `(certificate_no IS NULL OR certificate_no = '')`
          : `(certificate_no IS NOT NULL AND certificate_no <> '')`
      );
    }
    if (caratMin !== undefined && caratMin !== '') {
      params.push(numericOrNull(caratMin));
      conditions.push(`carat >= $${params.length}`);
    }
    if (caratMax !== undefined && caratMax !== '') {
      params.push(numericOrNull(caratMax));
      conditions.push(`carat <= $${params.length}`);
    }
    if (requestableOnly === 'true') {
      params.push(['available', 'on_hold', 'on_memo', 'in_transit']);
      conditions.push(`coalesce(stock_status, 'available') = ANY($${params.length})`);
      conditions.push(`NOT EXISTS (
        SELECT 1 FROM request_stones rs
        JOIN requests r ON r.id = rs.request_id
        WHERE rs.barcode = loose_diamonds.barcode
          AND rs.returned = false
          AND r.status <> 'cancelled'
      )`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const totalRes = await pool.query(`SELECT count(*)::int AS total FROM loose_diamonds ${where}`, params);
    const total = totalRes.rows[0].total;

    const orderBy = req.query.sort === 'pick' ? PICK_ORDER : LOOSE_ORDER;
    const pageParams = [...params, pageSize, offset];
    const { rows } = await pool.query(
      `SELECT * FROM loose_diamonds ${where} ${orderBy}
       LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
      pageParams
    );

    const holdersMap = await getHoldersForBarcodes(branch, rows.map((row) => row.barcode));
    const stripCost = req.user.role !== 'inventory';
    const outRows = rows.map((item) => {
      const { cost, ...rest } = item;
      return {
        ...(stripCost ? rest : item),
        stock_status: normalizeStockStatus(item.stock_status),
        availability: availabilityFor(item, holdersMap),
      };
    });
    res.json({ rows: outRows, total, page, pageSize });
  } catch (err) {
    next(err);
  }
});

// GET /api/stock/jewelry?branch=NY&page=1&pageSize=50&search=
router.get('/jewelry', async (req, res, next) => {
  try {
    const { branch, search, barcode, cert, ref, category, metal, lab, caratMin, caratMax, requestableOnly } = req.query;
    const { page, pageSize, offset } = clampPage(req.query);
    const categories = csv(req.query.categories);
    const metals = csv(req.query.metals);
    const labs = csv(req.query.labs);
    const goldColors = csv(req.query.goldColors);
    const purities = csv(req.query.purities);
    const statuses = csv(req.query.statuses).map(normalizeStockStatus);
    const certStatuses = csv(req.query.certStatuses);

    const params = [];
    const conditions = ['snapshot_active = true'];
    if (branch && branch !== 'ALL') {
      params.push(branch);
      conditions.push(`branch = $${params.length}`);
    }
    if (search) {
      params.push(`%${String(search).toLowerCase()}%`);
      const i = params.length;
      conditions.push(`(lower(barcode) LIKE $${i} OR lower(coalesce(item,'')) LIKE $${i} OR lower(coalesce(category,'')) LIKE $${i} OR lower(coalesce(metal,'')) LIKE $${i} OR lower(coalesce(ref_no,'')) LIKE $${i} OR lower(coalesce(cert_no,'')) LIKE $${i})`);
    }
    addLikeFilter(conditions, params, 'barcode', barcode);
    addLikeFilter(conditions, params, 'cert_no', cert);
    addLikeFilter(conditions, params, 'ref_no', ref);
    addLikeFilter(conditions, params, 'category', category);
    addLikeFilter(conditions, params, 'metal', metal);
    addLikeFilter(conditions, params, 'lab', lab);
    addAnyFilter(conditions, params, 'category', categories);
    addAnyFilter(conditions, params, 'metal', metals);
    addAnyFilter(conditions, params, 'lab', labs);
    addMetalTokenFilter(conditions, params, goldColors);
    addMetalTokenFilter(conditions, params, purities.map((p) => `${p}K`));
    if (statuses.length) {
      params.push(statuses);
      conditions.push(`coalesce(stock_status, 'available') = ANY($${params.length})`);
    }
    if (certStatuses.length === 1) {
      conditions.push(
        certStatuses[0] === 'non_cert'
          ? `(cert_no IS NULL OR cert_no = '')`
          : `(cert_no IS NOT NULL AND cert_no <> '')`
      );
    }
    if (caratMin !== undefined && caratMin !== '') {
      params.push(numericOrNull(caratMin));
      conditions.push(`diamond_cts >= $${params.length}`);
    }
    if (caratMax !== undefined && caratMax !== '') {
      params.push(numericOrNull(caratMax));
      conditions.push(`diamond_cts <= $${params.length}`);
    }
    if (requestableOnly === 'true') {
      params.push(['available', 'on_hold', 'on_memo', 'in_transit']);
      conditions.push(`coalesce(stock_status, 'available') = ANY($${params.length})`);
      conditions.push(`NOT EXISTS (
        SELECT 1 FROM request_stones rs
        JOIN requests r ON r.id = rs.request_id
        WHERE rs.barcode = jewelry_pieces.barcode
          AND rs.returned = false
          AND r.status <> 'cancelled'
      )`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const totalRes = await pool.query(`SELECT count(*)::int AS total FROM jewelry_pieces ${where}`, params);
    const total = totalRes.rows[0].total;

    const pageParams = [...params, pageSize, offset];
    const { rows } = await pool.query(
      `SELECT * FROM jewelry_pieces ${where} ORDER BY category NULLS LAST, item NULLS LAST, diamond_cts NULLS LAST
       LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
      pageParams
    );

    const holdersMap = await getHoldersForBarcodes(branch, rows.map((row) => row.barcode));
    const outRows = rows.map((item) => ({
      ...item,
      stock_status: normalizeStockStatus(item.stock_status),
      availability: availabilityFor(item, holdersMap),
    }));
    res.json({ rows: outRows, total, page, pageSize });
  } catch (err) {
    next(err);
  }
});

// POST /api/stock/upload  (multipart form field name: "file") — inventory only
// Accepts .xlsx or .csv. Parses server-side, groups rows by their Branch
// column, and replaces each matching branch's stock list — a single upload
// can refresh multiple branches if the sheet contains rows for more than one.
router.post('/upload', requireRole('inventory'), stockUploadLimit, upload.single('file'), async (req, res, next) => {
  const startedAt = Date.now();
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const fileName = String(req.file.originalname || '').toLowerCase();
    if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.csv')) {
      return res.status(415).json({
        error: fileName.endsWith('.xls')
          ? 'Legacy .xls files must be saved as .xlsx or .csv before uploading'
          : 'Only .xlsx or .csv stock files are accepted',
      });
    }

    // Parsing a real 37k-row workbook can take over ten seconds and hundreds
    // of MB with SheetJS. Run a low-memory streaming reader in a worker so the
    // API can continue answering Render health checks during the import.
    const { format, rows } = await enqueueStockImport(
      () => parseStockFile(req.file.path, req.file.originalname)
    );

    if (rows.length === 0) {
      return res.status(400).json({ error: 'No data rows found, or headers were not recognized' });
    }

    // Normalize a Branch cell to our codes NY/LA/CH. Accepts the codes
    // themselves plus full city names and common variants, case-insensitive,
    // so real client sheets (which spell out "New York" etc.) import cleanly.
    const BRANCH_ALIASES = {
      NY: ['NY', 'NYC', 'NEW YORK', 'NEWYORK', 'NEW YORK CITY'],
      LA: ['LA', 'LOS ANGELES', 'LOSANGELES', 'L.A.'],
      CH: ['CH', 'CHI', 'CHICAGO'],
    };
    const branchLookup = new Map();
    for (const [code, names] of Object.entries(BRANCH_ALIASES)) {
      for (const n of names) branchLookup.set(n, code);
    }
    const normalizeBranch = (raw) => {
      const key = String(raw || '').trim().toUpperCase().replace(/\s+/g, ' ');
      return branchLookup.get(key) || key; // unknown values pass through and get skipped below
    };

    // Group by branch
    const byBranch = new Map();
    for (const row of rows) {
      const branch = normalizeBranch(row.branch);
      if (!branch) continue; // skip rows with no branch — reported back to user
      if (!byBranch.has(branch)) byBranch.set(branch, []);
      byBranch.get(branch).push(row);
    }

    if (byBranch.size === 0) {
      return res.status(400).json({ error: 'No rows had a recognizable Branch value' });
    }

    const validBranches = new Set(['NY', 'LA', 'CH']);
    const skippedBranches = [...byBranch.keys()].filter((b) => !validBranches.has(b));
    for (const b of skippedBranches) byBranch.delete(b);
    if (byBranch.size === 0) {
      return res.status(400).json({
        error: `No supported branch rows found${skippedBranches.length ? ` (found: ${skippedBranches.join(', ')})` : ''}`,
      });
    }

    const table = format === 'jewelry' ? 'jewelry_pieces' : 'loose_diamonds';

    // Column layout per format. We build multi-row INSERT statements (many rows
    // per query) instead of one query per row, so a 27k-row sheet is a few dozen
    // round trips to the database instead of 27,000. Rows within one branch are
    // de-duplicated by barcode (last one wins) so a single statement never tries
    // to insert the same barcode twice (which Postgres rejects).
    const COLS = {
      loose: {
        cols: ['barcode', 'branch', 'lab', 'certificate_no', 'shape', 'carat', 'color', 'clarity', 'cut', 'polish', 'symmetry', 'length_mm', 'width_mm', 'height_mm', 'lw_ratio', 'stock_status', 'cost'],
        map: (row, branch) => [
          row.barcode, branch, row.lab, row.certificate_no, row.shape, numericOrNull(row.carat),
          row.color, row.clarity, row.cut, row.polish, row.symmetry,
          numericOrNull(row.length_mm), numericOrNull(row.width_mm), numericOrNull(row.height_mm), numericOrNull(row.lw_ratio),
          normalizeStockStatus(row.stock_status), numericOrNull(row.cost),
        ],
      },
      jewelry: {
        cols: ['barcode', 'branch', 'img_link', 'video_link', 'category', 'item', 'ref_no', 'metal', 'metal_weight', 'gross_weight', 'diamond_cts', 'diamond_pcs', 'diamond_size', 'lab', 'cert_no', 'stock_status', 'amount'],
        map: (row, branch) => [
          row.barcode, branch, row.img_link, row.video_link, row.category, row.item,
          row.ref_no, row.metal, numericOrNull(row.metal_weight), numericOrNull(row.gross_weight),
          numericOrNull(row.diamond_cts), numericOrNull(row.diamond_pcs), row.diamond_size, row.lab, row.cert_no,
          normalizeStockStatus(row.stock_status), numericOrNull(row.amount),
        ],
      },
    };

    const spec = format === 'jewelry' ? COLS.jewelry : COLS.loose;
    const colCount = spec.cols.length;
    const updateAssignments = spec.cols
      .filter((c) => c !== 'barcode')
      .map((c) => `${c}=EXCLUDED.${c}`)
      .concat(
        'snapshot_active=true',
        'last_seen_at=now()',
        'snapshot_missing_since=NULL',
        'updated_at=now()'
      )
      .join(', ');
    const BATCH_SIZE = 500; // 500 rows * ~12 cols = 6000 params, well under Postgres' 65535 limit

    // The whole replace-and-reinsert is one logical operation. On CockroachDB
    // (SERIALIZABLE-only) a concurrent write touching the same branch can
    // abort this with a retryable conflict — withTransaction retries the
    // ENTIRE thing (fresh client, fresh BEGIN) rather than leaving a branch
    // half-updated.
    const {
      totalInserted,
      branchesUpdated,
      snapshotRowsInactive,
    } = await withTransaction(pool, async (client) => {
      let inserted = 0;
      const updated = [];

      for (const [branch, branchRows] of byBranch.entries()) {
        await archiveBranchSnapshot(client, table, branch);

        // De-dupe within the sheet by barcode (last occurrence wins).
        const byBarcode = new Map();
        for (const row of branchRows) {
          if (!row.barcode) continue;
          byBarcode.set(String(row.barcode).trim(), row);
        }
        const uniqueRows = [...byBarcode.values()];

        for (let i = 0; i < uniqueRows.length; i += BATCH_SIZE) {
          const chunk = uniqueRows.slice(i, i + BATCH_SIZE);
          const valueGroups = [];
          const params = [];
          chunk.forEach((row, idx) => {
            const base = idx * colCount;
            const placeholders = spec.cols.map((_, c) => `$${base + c + 1}`);
            valueGroups.push(`(${placeholders.join(',')}, now())`);
            params.push(...spec.map(row, branch));
          });

          await client.query(
            `INSERT INTO ${table} (${spec.cols.join(', ')}, updated_at)
             VALUES ${valueGroups.join(', ')}
             ON CONFLICT (barcode) DO UPDATE SET ${updateAssignments}`,
            params
          );
          inserted += chunk.length;
        }
        updated.push(branch);
      }

      const { rows: inactiveRows } = await client.query(
        `SELECT count(*)::int AS total
         FROM ${table}
         WHERE branch = ANY($1) AND snapshot_active = false`,
        [updated]
      );
      return {
        totalInserted: inserted,
        branchesUpdated: updated,
        snapshotRowsInactive: inactiveRows[0]?.total || 0,
      };
    });

    for (const branch of branchesUpdated) {
      broadcast(branch, 'stock:updated', { branch, format });
    }

    res.json({
      format,
      branchesUpdated,
      rowsImported: totalInserted,
      snapshotRowsInactive,
      skippedBranches,
      processingMs: Date.now() - startedAt,
    });
  } catch (err) {
    if (['INVALID_STOCK_HEADERS', 'INVALID_STOCK_FILE', 'STOCK_PARSE_FAILED'].includes(err.code)) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  } finally {
    if (req.file?.path) {
      await fs.unlink(req.file.path).catch(() => {});
    }
  }
});

module.exports = router;
