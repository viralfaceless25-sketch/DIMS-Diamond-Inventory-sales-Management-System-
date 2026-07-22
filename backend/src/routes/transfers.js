const express = require('express');
const multer = require('multer');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');
const { withTransaction } = require('../db/withRetry');
const { getTransferAction } = require('../services/transferService');
const { writeAudit } = require('../services/auditService');
const { broadcast } = require('../sockets');

const router = express.Router();
router.use(requireAuth);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

function safeLabel(buffer, mime) {
  if (mime === 'application/pdf') return buffer.subarray(0, 4).toString('ascii') === '%PDF';
  if (mime === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return mime === 'image/jpeg' && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

async function inventoryBranch(userId) {
  const { rows } = await pool.query(
    `SELECT sr.branch FROM users u JOIN sales_reps sr ON sr.id = u.sales_rep_id WHERE u.id = $1`, [userId]
  );
  return rows[0]?.branch || null;
}

async function getTransfer(requestId) {
  const { rows } = await pool.query(
    `SELECT r.id, r.sales_rep_id, COALESCE(r.delivery_branch, r.branch) AS destination_branch, r.fulfillment_branch,
            r.cross_branch, r.delivery_route, r.transfer_status, r.request_type,
            r.dropoff_company, r.dropoff_address, r.paperwork_type,
            EXISTS(SELECT 1 FROM request_shipping_labels l WHERE l.request_id = r.id) AS has_label
     FROM requests r WHERE r.id = $1`, [requestId]
  );
  return rows[0] || null;
}

function assertCrossBranch(transfer) {
  if (!transfer || !transfer.cross_branch || !transfer.fulfillment_branch || !transfer.delivery_route) {
    const error = new Error('This is not a cross-branch request'); error.status = 400; throw error;
  }
}

async function assertRequestReadyForFinalDelivery(client, requestId, requestScope) {
  const { rows } = await client.query(
    'SELECT stone_found, cert_found FROM request_stones WHERE request_id = $1',
    [requestId]
  );
  const complete = rows.length > 0 && rows.every((stone) => {
    if (requestScope === 'stone_only') return stone.stone_found;
    if (requestScope === 'cert_only') return stone.cert_found;
    return stone.stone_found && stone.cert_found;
  });
  if (!complete) {
    const error = new Error('Confirm every required stone and certificate before completing delivery');
    error.status = 409;
    throw error;
  }
}

router.patch('/:id/status', requireRole('inventory'), async (req, res, next) => {
  try {
    const requestId = Number(req.params.id);
    const action = String(req.body?.action || '');
    if (!Number.isInteger(requestId)) return res.status(400).json({ error: 'Valid request is required' });
    const actorBranch = await inventoryBranch(req.user.id);
    if (!actorBranch) return res.status(403).json({ error: 'Your inventory account is missing a branch' });
    const result = await withTransaction(pool, async (client) => {
      const { rows } = await client.query(
        `SELECT r.id, r.sales_rep_id, COALESCE(r.delivery_branch, r.branch) AS destination_branch, r.fulfillment_branch,
                r.cross_branch, r.delivery_route, r.transfer_status, r.request_scope, r.resolution_confirmed, r.paperwork_type,
                EXISTS(SELECT 1 FROM request_shipping_labels l WHERE l.request_id = r.id) AS has_label
         FROM requests r WHERE r.id = $1 FOR UPDATE`, [requestId]
      );
      const transfer = rows[0];
      assertCrossBranch(transfer);
      if (['hand_to_rep', 'ship_customer', 'dropoff_customer'].includes(action)) {
        await assertRequestReadyForFinalDelivery(client, requestId, transfer.request_scope || 'stone_and_cert');
        if (!transfer.resolution_confirmed) {
          const error = new Error('Review and confirm the request before final delivery'); error.status = 409; throw error;
        }
      }
      const nextStatus = getTransferAction({
        route: transfer.delivery_route, status: transfer.transfer_status || 'awaiting_source',
        sourceBranch: transfer.fulfillment_branch, destinationBranch: transfer.destination_branch,
        actorBranch, action, hasLabel: transfer.has_label, paperworkType: transfer.paperwork_type,
      });
      await client.query('UPDATE requests SET transfer_status = $2 WHERE id = $1', [requestId, nextStatus]);
      return { ...transfer, transferStatus: nextStatus };
    });
    await writeAudit({ actorId: req.user.id, action: 'transfer.status_changed', targetType: 'request', targetId: requestId, ip: req.ip, details: { action, status: result.transferStatus } });
    broadcast(result.fulfillment_branch, 'transfer:updated', { requestId, status: result.transferStatus });
    broadcast(result.destination_branch, 'transfer:updated', { requestId, status: result.transferStatus });
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.message?.includes('Only ') || err.message?.includes('not allowed') || err.message?.includes('shipping label')) return res.status(409).json({ error: err.message });
    next(err);
  }
});

router.post('/:id/shipping-label', requireRole('sales_rep'), upload.single('label'), async (req, res, next) => {
  try {
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId) || !req.file) return res.status(400).json({ error: 'A shipping label file is required' });
    const allowed = new Set(['application/pdf', 'image/png', 'image/jpeg']);
    if (!allowed.has(req.file.mimetype) || !safeLabel(req.file.buffer, req.file.mimetype)) {
      return res.status(415).json({ error: 'Label must be a real PDF, PNG, or JPEG file' });
    }
    const transfer = await getTransfer(requestId);
    assertCrossBranch(transfer);
    if (transfer.sales_rep_id !== req.user.salesRepId) return res.status(403).json({ error: 'You can only upload a label for your own request' });
    if (transfer.delivery_route !== 'customer_ship') return res.status(400).json({ error: 'Shipping labels are only used for direct customer shipments' });
    if (!['awaiting_source', 'packed'].includes(transfer.transfer_status || 'awaiting_source')) return res.status(409).json({ error: 'The label can no longer be changed after shipment' });
    await pool.query(
      `INSERT INTO request_shipping_labels (request_id, file_name, mime_type, file_data, uploaded_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (request_id) DO UPDATE SET file_name = EXCLUDED.file_name, mime_type = EXCLUDED.mime_type,
         file_data = EXCLUDED.file_data, uploaded_by = EXCLUDED.uploaded_by, uploaded_at = now()`,
      [requestId, String(req.file.originalname || 'shipping-label').slice(0, 180), req.file.mimetype, req.file.buffer, req.user.id]
    );
    await writeAudit({ actorId: req.user.id, action: 'transfer.shipping_label_uploaded', targetType: 'request', targetId: requestId, ip: req.ip, details: { fileName: req.file.originalname } });
    broadcast(transfer.fulfillment_branch, 'transfer:updated', { requestId, labelUploaded: true });
    res.json({ ok: true, fileName: req.file.originalname });
  } catch (err) { if (err.status) return res.status(err.status).json({ error: err.message }); next(err); }
});

router.patch('/:id/paperwork', requireRole('sales_rep'), async (req, res, next) => {
  try {
    const requestId = Number(req.params.id);
    const paperworkType = String(req.body?.paperworkType || '');
    if (!Number.isInteger(requestId) || !['none', 'invoice', 'memo'].includes(paperworkType)) {
      return res.status(400).json({ error: 'Choose No paperwork, Invoice, or Memo' });
    }
    const transfer = await getTransfer(requestId);
    assertCrossBranch(transfer);
    if (transfer.sales_rep_id !== req.user.salesRepId) return res.status(403).json({ error: 'You can only update paperwork for your own request' });
    if (transfer.delivery_route !== 'customer_ship') return res.status(400).json({ error: 'Paperwork is only required for direct customer shipments' });
    if (!['awaiting_source', 'packed'].includes(transfer.transfer_status || 'awaiting_source')) return res.status(409).json({ error: 'Paperwork can no longer be changed after shipment' });
    await pool.query('UPDATE requests SET paperwork_type = $2 WHERE id = $1', [requestId, paperworkType]);
    await writeAudit({ actorId: req.user.id, action: 'transfer.paperwork_updated', targetType: 'request', targetId: requestId, ip: req.ip, details: { paperworkType } });
    broadcast(transfer.fulfillment_branch, 'transfer:updated', { requestId, paperworkType });
    broadcast(transfer.destination_branch, 'transfer:updated', { requestId, paperworkType });
    res.json({ ok: true, paperworkType });
  } catch (err) { if (err.status) return res.status(err.status).json({ error: err.message }); next(err); }
});

router.get('/:id/shipping-label', async (req, res, next) => {
  try {
    const requestId = Number(req.params.id);
    const transfer = await getTransfer(requestId);
    assertCrossBranch(transfer);
    const staffBranch = req.user.role === 'inventory' ? await inventoryBranch(req.user.id) : null;
    const allowed = (req.user.role === 'sales_rep' && transfer.sales_rep_id === req.user.salesRepId)
      || (req.user.role === 'inventory' && [transfer.fulfillment_branch, transfer.destination_branch].includes(staffBranch));
    if (!allowed) return res.status(403).json({ error: 'You do not have access to this label' });
    const { rows } = await pool.query('SELECT file_name, mime_type, file_data FROM request_shipping_labels WHERE request_id = $1', [requestId]);
    if (!rows[0]) return res.status(404).json({ error: 'No shipping label uploaded yet' });
    res.setHeader('Content-Type', rows[0].mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${rows[0].file_name.replace(/[\\"]/g, '')}"`);
    res.send(rows[0].file_data);
  } catch (err) { if (err.status) return res.status(err.status).json({ error: err.message }); next(err); }
});

module.exports = router;
