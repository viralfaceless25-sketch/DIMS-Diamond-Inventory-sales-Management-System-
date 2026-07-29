function workflowError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function assertCustomerShipment(transfer) {
  if (!transfer) throw workflowError(404, 'Request not found');
  if (transfer.delivery_route !== 'customer_ship') {
    throw workflowError(400, 'Documents are only used for customer shipments');
  }
}

function assertRequestOwner(transfer, salesRepId) {
  if (Number(transfer.sales_rep_id) !== Number(salesRepId)) {
    throw workflowError(403, 'You can only update documents for your own request');
  }
}

function assertDocumentsEditable(transfer) {
  if (!['awaiting_source', 'packed'].includes(
    transfer.transfer_status || 'awaiting_source'
  )) {
    throw workflowError(409, 'Documents can no longer be changed after shipment');
  }
}

function assertPaperworkUploadAllowed({ transfer, salesRepId }) {
  assertCustomerShipment(transfer);
  assertRequestOwner(transfer, salesRepId);
  assertDocumentsEditable(transfer);
  if (Number(transfer.workflow_version || 1) >= 2
      && transfer.cross_branch
      && !transfer.erp_transfer_received) {
    throw workflowError(
      409,
      'The branch transfer must be received in ERP before paperwork can be uploaded'
    );
  }
}

function assertLabelUploadAllowed({ transfer, salesRepId }) {
  assertCustomerShipment(transfer);
  assertRequestOwner(transfer, salesRepId);
  assertDocumentsEditable(transfer);
  if (Number(transfer.workflow_version || 1) >= 2) {
    if (transfer.cross_branch && !transfer.erp_transfer_received) {
      throw workflowError(
        409,
        'The branch transfer must be received in ERP before the label can be uploaded'
      );
    }
    if (!transfer.has_paperwork) {
      throw workflowError(409, 'Upload the invoice or memo paperwork first');
    }
  }
}

function assertDocumentAccess({ transfer, user, inventoryBranch }) {
  if (!transfer) throw workflowError(404, 'Request not found');
  const administrator = user?.role === 'admin';
  const owner = user?.role === 'sales_rep'
    && Number(transfer.sales_rep_id) === Number(user.salesRepId);
  const assignedInventory = user?.role === 'inventory'
    && [transfer.fulfillment_branch, transfer.destination_branch]
      .includes(inventoryBranch);
  if (!administrator && !owner && !assignedInventory) {
    throw workflowError(403, 'You do not have access to this request document');
  }
}

module.exports = {
  assertDocumentAccess,
  assertLabelUploadAllowed,
  assertPaperworkUploadAllowed,
};
