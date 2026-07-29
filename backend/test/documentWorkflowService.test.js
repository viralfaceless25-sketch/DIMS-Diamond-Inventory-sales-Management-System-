const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertDocumentAccess,
  assertLabelUploadAllowed,
  assertPaperworkUploadAllowed,
} = require('../src/services/documentWorkflowService');

const crossBranchShipment = {
  id: 44,
  sales_rep_id: 7,
  fulfillment_branch: 'LA',
  destination_branch: 'NY',
  cross_branch: true,
  delivery_route: 'customer_ship',
  transfer_status: 'awaiting_source',
  workflow_version: 2,
  erp_transfer_received: false,
  has_paperwork: false,
};

test('version-2 cross-branch paperwork waits for destination ERP receipt', () => {
  assert.throws(() => assertPaperworkUploadAllowed({
    transfer: crossBranchShipment,
    salesRepId: 7,
  }), /received in ERP/);
  assert.doesNotThrow(() => assertPaperworkUploadAllowed({
    transfer: { ...crossBranchShipment, erp_transfer_received: true },
    salesRepId: 7,
  }));
  assert.throws(() => assertPaperworkUploadAllowed({
    transfer: { ...crossBranchShipment, erp_transfer_received: true },
    salesRepId: 8,
  }), /own request/);
});

test('version-2 label upload is ordered after a real paperwork file', () => {
  assert.throws(() => assertLabelUploadAllowed({
    transfer: { ...crossBranchShipment, erp_transfer_received: true },
    salesRepId: 7,
  }), /paperwork first/);
  assert.doesNotThrow(() => assertLabelUploadAllowed({
    transfer: {
      ...crossBranchShipment,
      erp_transfer_received: true,
      has_paperwork: true,
    },
    salesRepId: 7,
  }));
  assert.throws(() => assertLabelUploadAllowed({
    transfer: {
      ...crossBranchShipment,
      erp_transfer_received: false,
      has_paperwork: true,
    },
    salesRepId: 7,
  }), /received in ERP/);
});

test('document downloads are limited to the owner, source, or destination inventory', () => {
  assert.doesNotThrow(() => assertDocumentAccess({
    transfer: crossBranchShipment,
    user: { role: 'admin' },
  }));
  assert.doesNotThrow(() => assertDocumentAccess({
    transfer: crossBranchShipment,
    user: { role: 'sales_rep', salesRepId: 7 },
  }));
  assert.doesNotThrow(() => assertDocumentAccess({
    transfer: crossBranchShipment,
    user: { role: 'inventory' },
    inventoryBranch: 'LA',
  }));
  assert.doesNotThrow(() => assertDocumentAccess({
    transfer: crossBranchShipment,
    user: { role: 'inventory' },
    inventoryBranch: 'NY',
  }));
  assert.throws(() => assertDocumentAccess({
    transfer: crossBranchShipment,
    user: { role: 'inventory' },
    inventoryBranch: 'CH',
  }), /access/);
});
