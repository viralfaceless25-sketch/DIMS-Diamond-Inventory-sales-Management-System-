const express = require('express');
const multer = require('multer');
const pool = require('../db/pool');
const { assertRequestReadyForFinalDelivery } = require('../services/resolutionService');
const { requireAuth, requireRole } = require('../middleware/auth');
const { withTransaction } = require('../db/withRetry');
const {
  getTransferAction,
  requestStatusAfterTransfer,
} = require('../services/transferService');
const {
  assertErpTransferAction,
  buildErpUnavailableResolution,
} = require('../services/erpTransferService');
const {
  assertDocumentAccess,
  assertLabelUploadAllowed,
  assertPaperworkUploadAllowed,
} = require('../services/documentWorkflowService');
const {
  isSafeDocument,
  safeDownloadName,
} = require('../services/fileSecurity');
const { writeAudit } = require('../services/auditService');
const {
  movementForTransferAction,
  recordRequestMovement,
} = require('../services/movementService');
const { broadcast } = require('../sockets');
const { createRateLimit } = require('../middleware/rateLimit');

const router = express.Router();
router.use(requireAuth);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
const documentUploadLimit = createRateLimit({
  windowMs: 60 * 60_000,
  max: 60,
  key: (req) => `request-document:${req.user.id}`,
});

async function inventoryBranch(userId) {
  const { rows } = await pool.query(
    `SELECT sr.branch FROM users u JOIN sales_reps sr ON sr.id = u.sales_rep_id WHERE u.id = $1`, [userId]
  );
  return rows[0]?.branch || null;
}

async function getTransfer(requestId, queryable = pool, { forUpdate = false } = {}) {
  const { rows } = await queryable.query(
    `SELECT r.id, r.sales_rep_id, COALESCE(r.delivery_branch, r.branch) AS destination_branch, r.fulfillment_branch,
            r.cross_branch, r.delivery_route, r.transfer_status, r.request_type,
            r.dropoff_company, r.dropoff_address, r.paperwork_type, r.workflow_version,
            r.erp_transfer_confirmed, r.erp_transfer_confirmed_at,
            r.erp_transfer_received, r.erp_transfer_received_at,
            r.erp_receive_requested_at,
            r.cancelled_at, r.cancelled_by, r.cancellation_status, r.cancellation_reason,
            EXISTS(SELECT 1 FROM request_shipping_labels l WHERE l.request_id = r.id) AS has_label,
            EXISTS(SELECT 1 FROM request_paperwork_files p WHERE p.request_id = r.id) AS has_paperwork
     FROM requests r WHERE r.id = $1${forUpdate ? ' FOR UPDATE' : ''}`,
    [requestId]
  );
  return rows[0] || null;
}

function assertDeliveryWorkflow(transfer) {
  if (!transfer || !transfer.fulfillment_branch || !transfer.delivery_route) {
    const error = new Error('This request does not use a delivery workflow'); error.status = 400; throw error;
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
                r.cross_branch, r.delivery_route, r.transfer_status, r.status, r.request_scope, r.resolution_confirmed, r.paperwork_type, r.workflow_version,
                r.erp_transfer_confirmed, r.erp_transfer_received,
                EXISTS(SELECT 1 FROM request_shipping_labels l WHERE l.request_id = r.id) AS has_label,
                EXISTS(SELECT 1 FROM request_paperwork_files p WHERE p.request_id = r.id) AS has_paperwork
         FROM requests r WHERE r.id = $1 FOR UPDATE`, [requestId]
      );
      const transfer = rows[0];
      assertDeliveryWorkflow(transfer);
      if (['hand_to_rep', 'ship_customer', 'dropoff_customer'].includes(action)) {
        await assertRequestReadyForFinalDelivery(client, requestId, transfer.request_scope || 'stone_and_cert');
        if (!transfer.resolution_confirmed) {
          const error = new Error('Review and confirm the request before final delivery'); error.status = 409; throw error;
        }
      }
      const nextStatus = getTransferAction({
        route: transfer.delivery_route, status: transfer.transfer_status || 'awaiting_source',
        sourceBranch: transfer.fulfillment_branch, destinationBranch: transfer.destination_branch,
        actorBranch, action, crossBranch: transfer.cross_branch,
        hasLabel: transfer.has_label, hasPaperwork: transfer.has_paperwork,
        paperworkType: transfer.paperwork_type, workflowVersion: transfer.workflow_version,
        requiresErpTransfer: transfer.cross_branch,
        erpTransferConfirmed: transfer.erp_transfer_confirmed,
        erpTransferReceived: transfer.erp_transfer_received,
      });
      const nextRequestStatus = requestStatusAfterTransfer(
        transfer.status,
        nextStatus
      );
      await client.query(
        'UPDATE requests SET transfer_status = $2, status = $3 WHERE id = $1',
        [requestId, nextStatus, nextRequestStatus]
      );
      await recordRequestMovement(client, requestId, {
        movementType: movementForTransferAction(action),
        fromBranch: transfer.fulfillment_branch,
        toBranch: transfer.destination_branch,
        actorId: req.user.id,
        details: { action, status: nextStatus, deliveryRoute: transfer.delivery_route },
      });
      return {
        ...transfer,
        transferStatus: nextStatus,
        status: nextRequestStatus,
      };
    });
    await writeAudit({ actorId: req.user.id, action: 'transfer.status_changed', targetType: 'request', targetId: requestId, ip: req.ip, details: { action, status: result.transferStatus } });
    broadcast(result.fulfillment_branch, 'transfer:updated', { requestId, status: result.transferStatus });
    broadcast(result.destination_branch, 'transfer:updated', { requestId, status: result.transferStatus });
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.message?.includes('Only ')
        || err.message?.includes('not allowed')
        || err.message?.includes('shipping label')
        || err.message?.includes('paperwork')
        || err.message?.includes('received in ERP')
        || err.message?.includes('ERP branch transfer')) {
      return res.status(409).json({ error: err.message });
    }
    next(err);
  }
});

router.patch('/:id/erp-transfer', requireRole('inventory'), async (req, res, next) => {
  try {
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId)) return res.status(400).json({ error: 'Valid request is required' });
    const actorBranch = await inventoryBranch(req.user.id);
    if (!actorBranch) return res.status(403).json({ error: 'Your inventory account is missing a branch' });

    const result = await withTransaction(pool, async (client) => {
      const { rows } = await client.query(
        `SELECT id, sales_rep_id, branch, cross_branch, fulfillment_branch,
                COALESCE(delivery_branch, branch) AS delivery_branch,
                COALESCE(delivery_branch, branch) AS destination_branch,
                erp_transfer_confirmed, erp_transfer_received, transfer_status, status
         FROM requests WHERE id = $1 FOR UPDATE`,
        [requestId]
      );
      const transfer = rows[0];
      if (!transfer) {
        const error = new Error('Request not found'); error.status = 404; throw error;
      }
      assertErpTransferAction({
        request: transfer,
        actorRole: req.user.role,
        actorBranch,
        action: 'issue',
      });
      if (!['awaiting_source', null].includes(transfer.transfer_status)) {
        const error = new Error('ERP BT issue must be confirmed before packing'); error.status = 409; throw error;
      }
      if (!transfer.erp_transfer_confirmed) {
        await client.query(
          `UPDATE requests
           SET erp_transfer_confirmed = true, erp_transfer_confirmed_at = now(), erp_transfer_confirmed_by = $2
           WHERE id = $1`,
          [requestId, req.user.id]
        );
        await recordRequestMovement(client, requestId, {
          movementType: 'erp_transfer_issued',
          fromBranch: transfer.fulfillment_branch,
          toBranch: transfer.destination_branch,
          actorId: req.user.id,
        });
      }
      return {
        ...transfer,
        erpTransferConfirmed: true,
        erpTransferIssued: true,
      };
    });

    await writeAudit({
      actorId: req.user.id,
      action: 'transfer.erp_bt_issued',
      targetType: 'request',
      targetId: requestId,
      ip: req.ip,
      details: { sourceBranch: result.fulfillment_branch, destinationBranch: result.destination_branch },
    });
    const event = {
      requestId,
      erpTransferConfirmed: true,
      erpTransferIssued: true,
    };
    broadcast(result.fulfillment_branch, 'transfer:updated', event);
    broadcast(result.destination_branch, 'transfer:updated', event);
    res.json({
      id: requestId,
      erpTransferConfirmed: true,
      erpTransferIssued: true,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.patch('/:id/erp-unavailable', requireRole('inventory'), async (req, res, next) => {
  try {
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId)) {
      return res.status(400).json({ error: 'Valid request is required' });
    }
    const actorBranch = await inventoryBranch(req.user.id);
    if (!actorBranch) {
      return res.status(403).json({ error: 'Your inventory account is missing a branch' });
    }
    const resolution = buildErpUnavailableResolution(req.body);

    const result = await withTransaction(pool, async (client) => {
      const { rows } = await client.query(
        `SELECT id, sales_rep_id, branch, cross_branch, fulfillment_branch,
                COALESCE(delivery_branch, branch) AS delivery_branch,
                COALESCE(delivery_branch, branch) AS destination_branch,
                erp_transfer_confirmed, transfer_status, status
         FROM requests
         WHERE id = $1
         FOR UPDATE`,
        [requestId]
      );
      const transfer = rows[0];
      if (!transfer) {
        const error = new Error('Request not found'); error.status = 404; throw error;
      }
      assertErpTransferAction({
        request: transfer,
        actorRole: req.user.role,
        actorBranch,
        action: 'reject_unavailable',
      });
      if (!['awaiting_source', null].includes(transfer.transfer_status)) {
        const error = new Error('Only a request awaiting source ERP action can be rejected');
        error.status = 409;
        throw error;
      }
      await client.query(
        `UPDATE requests
         SET status = 'cancelled', transfer_status = 'cancelled',
             cancelled_at = now(), cancelled_by = $2,
             cancellation_status = $3, cancellation_reason = $4
         WHERE id = $1`,
        [
          requestId,
          req.user.id,
          resolution.liveStatus,
          resolution.reason,
        ]
      );
      await recordRequestMovement(client, requestId, {
        movementType: 'erp_transfer_rejected',
        fromBranch: transfer.fulfillment_branch,
        toBranch: transfer.destination_branch,
        actorId: req.user.id,
        details: {
          liveStatus: resolution.liveStatus,
          reason: resolution.reason,
        },
      });
      return transfer;
    });

    await writeAudit({
      actorId: req.user.id,
      action: 'transfer.erp_bt_rejected',
      targetType: 'request',
      targetId: requestId,
      ip: req.ip,
      details: {
        sourceBranch: result.fulfillment_branch,
        destinationBranch: result.destination_branch,
        ...resolution,
      },
    });
    const event = {
      requestId,
      status: 'cancelled',
      transferStatus: 'cancelled',
      cancellationStatus: resolution.liveStatus,
      cancellationReason: resolution.reason,
    };
    broadcast(result.fulfillment_branch, 'transfer:updated', event);
    broadcast(result.destination_branch, 'transfer:updated', event);
    res.json({ id: requestId, ...event });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.patch('/:id/request-erp-receive', requireRole('sales_rep'), async (req, res, next) => {
  try {
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId)) {
      return res.status(400).json({ error: 'Valid request is required' });
    }

    const result = await withTransaction(pool, async (client) => {
      const { rows } = await client.query(
        `SELECT id, sales_rep_id, branch, cross_branch, fulfillment_branch,
                COALESCE(delivery_branch, branch) AS delivery_branch,
                COALESCE(delivery_branch, branch) AS destination_branch,
                erp_transfer_confirmed, erp_transfer_received, status,
                erp_receive_requested_at
         FROM requests WHERE id = $1 FOR UPDATE`,
        [requestId]
      );
      const transfer = rows[0];
      if (!transfer) {
        const error = new Error('Request not found'); error.status = 404; throw error;
      }
      assertErpTransferAction({
        request: transfer,
        actorRole: req.user.role,
        actorSalesRepId: req.user.salesRepId,
        action: 'request_receive',
      });

      if (!transfer.erp_receive_requested_at && !transfer.erp_transfer_received) {
        await client.query(
          `UPDATE requests
           SET erp_receive_requested_at = now(), erp_receive_requested_by = $2
           WHERE id = $1`,
          [requestId, req.user.id]
        );
        await recordRequestMovement(client, requestId, {
          movementType: 'erp_receive_requested',
          fromBranch: transfer.fulfillment_branch,
          toBranch: transfer.destination_branch,
          actorId: req.user.id,
        });
      }
      return transfer;
    });

    await writeAudit({
      actorId: req.user.id,
      action: 'transfer.erp_bt_receive_requested',
      targetType: 'request',
      targetId: requestId,
      ip: req.ip,
      details: { destinationBranch: result.destination_branch },
    });
    const event = { requestId, erpReceiveRequested: true };
    broadcast(result.fulfillment_branch, 'transfer:updated', event);
    broadcast(result.destination_branch, 'transfer:updated', event);
    res.json({ id: requestId, erpReceiveRequested: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.patch('/:id/erp-received', requireRole('inventory'), async (req, res, next) => {
  try {
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId)) {
      return res.status(400).json({ error: 'Valid request is required' });
    }
    const actorBranch = await inventoryBranch(req.user.id);
    if (!actorBranch) {
      return res.status(403).json({ error: 'Your inventory account is missing a branch' });
    }

    const result = await withTransaction(pool, async (client) => {
      const { rows } = await client.query(
        `SELECT id, sales_rep_id, branch, cross_branch, fulfillment_branch,
                COALESCE(delivery_branch, branch) AS delivery_branch,
                COALESCE(delivery_branch, branch) AS destination_branch,
                erp_transfer_confirmed, erp_transfer_received, transfer_status, status
         FROM requests WHERE id = $1 FOR UPDATE`,
        [requestId]
      );
      const transfer = rows[0];
      if (!transfer) {
        const error = new Error('Request not found'); error.status = 404; throw error;
      }
      assertErpTransferAction({
        request: transfer,
        actorRole: req.user.role,
        actorBranch,
        action: 'receive',
      });

      if (!transfer.erp_transfer_received) {
        await client.query(
          `UPDATE requests
           SET erp_transfer_received = true,
               erp_transfer_received_at = now(),
               erp_transfer_received_by = $2
           WHERE id = $1`,
          [requestId, req.user.id]
        );
        await recordRequestMovement(client, requestId, {
          movementType: 'erp_transfer_received',
          fromBranch: transfer.fulfillment_branch,
          toBranch: transfer.destination_branch,
          actorId: req.user.id,
        });
      }
      return transfer;
    });

    await writeAudit({
      actorId: req.user.id,
      action: 'transfer.erp_bt_received',
      targetType: 'request',
      targetId: requestId,
      ip: req.ip,
      details: { destinationBranch: result.destination_branch },
    });
    const event = { requestId, erpTransferReceived: true };
    broadcast(result.fulfillment_branch, 'transfer:updated', event);
    broadcast(result.destination_branch, 'transfer:updated', event);
    res.json({ id: requestId, erpTransferReceived: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.post(
  '/:id/paperwork',
  requireRole('sales_rep'),
  documentUploadLimit,
  upload.single('paperwork'),
  async (req, res, next) => {
    try {
      const requestId = Number(req.params.id);
      const paperworkType = String(req.body?.paperworkType || '');
      if (!Number.isInteger(requestId) || !req.file) {
        return res.status(400).json({ error: 'An invoice or memo paperwork file is required' });
      }
      if (!['invoice', 'memo'].includes(paperworkType)) {
        return res.status(400).json({ error: 'Choose Invoice or Memo for this paperwork' });
      }
      if (!isSafeDocument(req.file.buffer, req.file.mimetype)) {
        return res.status(415).json({ error: 'Paperwork must be a real PDF, PNG, or JPEG file' });
      }
      const fileName = safeDownloadName(req.file.originalname, `${paperworkType}-paperwork`);
      const transfer = await withTransaction(pool, async (client) => {
        const locked = await getTransfer(requestId, client, { forUpdate: true });
        assertPaperworkUploadAllowed({
          transfer: locked,
          salesRepId: req.user.salesRepId,
        });
        await client.query(
          `INSERT INTO request_paperwork_files
             (request_id, paperwork_type, file_name, mime_type, file_data, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (request_id) DO UPDATE
           SET paperwork_type = EXCLUDED.paperwork_type,
               file_name = EXCLUDED.file_name,
               mime_type = EXCLUDED.mime_type,
               file_data = EXCLUDED.file_data,
               uploaded_by = EXCLUDED.uploaded_by,
               uploaded_at = now()`,
          [
            requestId,
            paperworkType,
            fileName,
            req.file.mimetype,
            req.file.buffer,
            req.user.id,
          ]
        );
        await client.query(
          'UPDATE requests SET paperwork_type = $2 WHERE id = $1',
          [requestId, paperworkType]
        );
        return locked;
      });
      await writeAudit({
        actorId: req.user.id,
        action: 'transfer.paperwork_file_uploaded',
        targetType: 'request',
        targetId: requestId,
        ip: req.ip,
        details: { paperworkType, fileName },
      });
      const event = {
        requestId,
        paperworkType,
        hasPaperwork: true,
        paperworkFileName: fileName,
      };
      broadcast(transfer.fulfillment_branch, 'transfer:updated', event);
      broadcast(transfer.destination_branch, 'transfer:updated', event);
      res.json({ ok: true, ...event });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  }
);

router.post(
  '/:id/shipping-label',
  requireRole('sales_rep'),
  documentUploadLimit,
  upload.single('label'),
  async (req, res, next) => {
    try {
      const requestId = Number(req.params.id);
      if (!Number.isInteger(requestId) || !req.file) {
        return res.status(400).json({ error: 'A shipping label file is required' });
      }
      if (!isSafeDocument(req.file.buffer, req.file.mimetype)) {
        return res.status(415).json({ error: 'Label must be a real PDF, PNG, or JPEG file' });
      }
      const fileName = safeDownloadName(req.file.originalname, 'shipping-label');
      const transfer = await withTransaction(pool, async (client) => {
        const locked = await getTransfer(requestId, client, { forUpdate: true });
        assertLabelUploadAllowed({
          transfer: locked,
          salesRepId: req.user.salesRepId,
        });
        await client.query(
          `INSERT INTO request_shipping_labels
             (request_id, file_name, mime_type, file_data, uploaded_by)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (request_id) DO UPDATE
           SET file_name = EXCLUDED.file_name,
               mime_type = EXCLUDED.mime_type,
               file_data = EXCLUDED.file_data,
               uploaded_by = EXCLUDED.uploaded_by,
               uploaded_at = now()`,
          [
            requestId,
            fileName,
            req.file.mimetype,
            req.file.buffer,
            req.user.id,
          ]
        );
        return locked;
      });
      await writeAudit({
        actorId: req.user.id,
        action: 'transfer.shipping_label_uploaded',
        targetType: 'request',
        targetId: requestId,
        ip: req.ip,
        details: { fileName },
      });
      const event = { requestId, hasLabel: true, labelFileName: fileName };
      broadcast(transfer.fulfillment_branch, 'transfer:updated', event);
      broadcast(transfer.destination_branch, 'transfer:updated', event);
      res.json({ ok: true, ...event });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  }
);

router.patch('/:id/paperwork', requireRole('sales_rep'), async (req, res, next) => {
  try {
    const requestId = Number(req.params.id);
    const paperworkType = String(req.body?.paperworkType || '');
    if (!Number.isInteger(requestId) || !['none', 'invoice', 'memo'].includes(paperworkType)) {
      return res.status(400).json({ error: 'Choose No paperwork, Invoice, or Memo' });
    }
    const transfer = await getTransfer(requestId);
    assertDeliveryWorkflow(transfer);
    if (Number(transfer.workflow_version || 1) >= 2) {
      return res.status(409).json({ error: 'Upload the actual invoice or memo file for this request' });
    }
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
    assertDeliveryWorkflow(transfer);
    const staffBranch = req.user.role === 'inventory' ? await inventoryBranch(req.user.id) : null;
    assertDocumentAccess({
      transfer,
      user: req.user,
      inventoryBranch: staffBranch,
    });
    const { rows } = await pool.query('SELECT file_name, mime_type, file_data FROM request_shipping_labels WHERE request_id = $1', [requestId]);
    if (!rows[0]) return res.status(404).json({ error: 'No shipping label uploaded yet' });
    res.setHeader('Content-Type', rows[0].mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${safeDownloadName(rows[0].file_name, 'shipping-label')}"`);
    res.send(rows[0].file_data);
  } catch (err) { if (err.status) return res.status(err.status).json({ error: err.message }); next(err); }
});

router.get('/:id/paperwork', async (req, res, next) => {
  try {
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId)) {
      return res.status(400).json({ error: 'Valid request is required' });
    }
    const transfer = await getTransfer(requestId);
    assertDeliveryWorkflow(transfer);
    const staffBranch = req.user.role === 'inventory'
      ? await inventoryBranch(req.user.id)
      : null;
    assertDocumentAccess({
      transfer,
      user: req.user,
      inventoryBranch: staffBranch,
    });
    const { rows } = await pool.query(
      `SELECT paperwork_type, file_name, mime_type, file_data
       FROM request_paperwork_files
       WHERE request_id = $1`,
      [requestId]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: 'No invoice or memo paperwork uploaded yet' });
    }
    res.setHeader('Content-Type', rows[0].mime_type);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${safeDownloadName(rows[0].file_name, 'paperwork')}"`
    );
    res.setHeader('X-Paperwork-Type', rows[0].paperwork_type);
    res.send(rows[0].file_data);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
