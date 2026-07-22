// Maps arbitrary header text (case-insensitive, punctuation/space-insensitive)
// from client "General Client Format" (loose) and "JS Client Format" (jewelry)
// exports onto our internal field names. Add more aliases here as real client
// files reveal new header spellings.

function normalize(header) {
  return String(header || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ''); // strip spaces, #, ., -, _ etc.
}

const LOOSE_ALIASES = {
  barcode: ['barcode', 'stockno', 'stockno.', 'stock', 'stocknumber', 'stone'],
  stock_status: ['status', 'stockstatus', 'availability', 'availablestatus'],
  branch: ['branch', 'location'],
  lab: ['lab', 'laboratory'],
  certificate_no: ['certno', 'certificateno', 'certnumber', 'reportno'],
  shape: ['shape', 'cutshape'],
  carat: ['carat', 'cts', 'ct', 'weight', 'caratweight'],
  color: ['color', 'colour'],
  clarity: ['clarity'],
  cut: ['cut'],
  polish: ['polish', 'pol'],
  symmetry: ['symmetry', 'sym'],
  length_mm: ['lengthmm', 'length'],
  width_mm: ['widthmm', 'width'],
  height_mm: ['heightmm', 'height', 'depthmm'],
  lw_ratio: ['lwratio', 'lengthwidthratio', 'lwratio'],
  cost: ['cost', 'amount', 'buyamount'],
};

const JEWELRY_ALIASES = {
  barcode: ['barcode', 'stockno', 'stockno.', 'stock', 'stocknumber'],
  stock_status: ['status', 'stockstatus', 'availability', 'availablestatus'],
  branch: ['branch', 'location'],
  img_link: ['imglink', 'imagelink', 'image', 'photo'],
  video_link: ['videolink', 'video'],
  category: ['category', 'type', 'itemtype'],
  item: ['item', 'description', 'itemdescription', 'productdescription'],
  ref_no: ['refno', 'refnumber', 'referenceno', 'referencenumber'],
  metal: ['metal', 'metaltype'],
  metal_weight: ['metalweight', 'metalwt', 'gramweight', 'grams'],
  gross_weight: ['grossweight', 'grosswt', 'totalweight'],
  diamond_cts: ['diamondcts', 'diamondweight', 'dwt', 'ctw'],
  diamond_pcs: ['diamondpcs', 'pcs', 'diamondpieces', 'stones'],
  diamond_size: ['diamondsize', 'stonesize', 'size'],
  lab: ['lab', 'laboratory'],
  cert_no: ['certno', 'certificateno', 'reportno'],
  amount: ['amount', 'price', 'value'],
};

function buildFieldIndex(headerRow, aliasMap) {
  const normalizedHeaders = headerRow.map(normalize);
  const fieldIndex = {};
  for (const [field, aliases] of Object.entries(aliasMap)) {
    const normalizedAliases = aliases.map(normalize);
    const idx = normalizedHeaders.findIndex((h) => normalizedAliases.includes(h));
    if (idx !== -1) fieldIndex[field] = idx;
  }
  return fieldIndex;
}

function mapRow(row, fieldIndex) {
  const out = {};
  for (const [field, idx] of Object.entries(fieldIndex)) {
    const value = row[idx] !== undefined ? row[idx] : null;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      out[field] = trimmed ? trimmed : null;
    } else {
      out[field] = value;
    }
  }
  return out;
}

/**
 * Given a 2D array (first row = headers), returns { format, rows } where
 * format is 'loose' or 'jewelry' — whichever alias set matches more columns —
 * and rows is an array of mapped objects.
 */
function parseSheet(rows2d) {
  if (!rows2d || rows2d.length === 0) return { format: null, rows: [] };
  const [headerRow, ...dataRows] = rows2d;

  const looseIndex = buildFieldIndex(headerRow, LOOSE_ALIASES);
  const jewelryIndex = buildFieldIndex(headerRow, JEWELRY_ALIASES);

  const looseScore = Object.keys(looseIndex).length;
  const jewelryScore = Object.keys(jewelryIndex).length;

  const format = jewelryScore > looseScore ? 'jewelry' : 'loose';
  const fieldIndex = format === 'jewelry' ? jewelryIndex : looseIndex;

  const mapped = dataRows
    .filter((r) => r.some((cell) => cell !== undefined && cell !== null && String(cell).trim() !== ''))
    .map((r) => mapRow(r, fieldIndex));

  return { format, rows: mapped };
}

module.exports = { parseSheet, normalize, LOOSE_ALIASES, JEWELRY_ALIASES };
