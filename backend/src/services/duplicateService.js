const pool = require('../db/pool');

/**
 * A stone is "actively held" by a request if it has not been returned yet.
 * (stone_found/cert_found state doesn't matter for this — a stone that's
 * merely requested but not yet found is still "spoken for".)
 *
 * Returns a Map<barcode, Array<{ requestId, repId, repName }>> for EVERY
 * barcode currently held by at least one active request (branch-scoped if
 * `branch` is given and not 'ALL'). Used to drive both the Availability
 * column (Stock & Upload tab) and duplicate-flagging (Requests tab).
 */
async function getHoldersMap(branch) {
  const params = [];
  let branchFilter = '';
  if (branch && branch !== 'ALL') {
    params.push(branch);
    branchFilter = `AND r.branch = $${params.length}`;
  }

  const { rows } = await pool.query(
    `SELECT rs.barcode, rs.request_id, r.sales_rep_id, sr.name AS rep_name
     FROM request_stones rs
     JOIN requests r ON r.id = rs.request_id
     JOIN sales_reps sr ON sr.id = r.sales_rep_id
     WHERE rs.returned = false
     ${branchFilter}`,
    params
  );

  const byBarcode = new Map();
  for (const row of rows) {
    if (!byBarcode.has(row.barcode)) byBarcode.set(row.barcode, []);
    byBarcode.get(row.barcode).push({
      requestId: row.request_id,
      repId: row.sales_rep_id,
      repName: row.rep_name,
    });
  }
  return byBarcode;
}

// Stock pages are paginated. Querying every open request just to annotate the
// visible page becomes expensive once the team has months of history, so this
// deliberately limits the lookup to the barcodes being displayed.
async function getHoldersForBarcodes(branch, barcodes) {
  const uniqueBarcodes = [...new Set(barcodes.filter(Boolean))];
  if (!uniqueBarcodes.length) return new Map();

  const params = [uniqueBarcodes];
  let branchFilter = '';
  if (branch && branch !== 'ALL') {
    params.push(branch);
    branchFilter = `AND r.branch = $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT rs.barcode, rs.request_id, r.sales_rep_id, sr.name AS rep_name
     FROM request_stones rs
     JOIN requests r ON r.id = rs.request_id
     JOIN sales_reps sr ON sr.id = r.sales_rep_id
     WHERE rs.returned = false AND rs.barcode = ANY($1)
     ${branchFilter}`,
    params
  );
  const byBarcode = new Map();
  for (const row of rows) {
    if (!byBarcode.has(row.barcode)) byBarcode.set(row.barcode, []);
    byBarcode.get(row.barcode).push({ requestId: row.request_id, repId: row.sales_rep_id, repName: row.rep_name });
  }
  return byBarcode;
}

/**
 * Filters a holders map down to only barcodes held by 2+ DISTINCT reps —
 * i.e. genuine duplicate conflicts.
 */
function extractDuplicates(holdersMap) {
  const duplicates = new Map();
  for (const [barcode, holders] of holdersMap.entries()) {
    const distinctReps = new Set(holders.map((h) => h.repId));
    if (distinctReps.size > 1) duplicates.set(barcode, holders);
  }
  return duplicates;
}

async function getDuplicateMap(branch) {
  const holders = await getHoldersMap(branch);
  return extractDuplicates(holders);
}

module.exports = { getHoldersMap, getHoldersForBarcodes, extractDuplicates, getDuplicateMap };
