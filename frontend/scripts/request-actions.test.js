const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('inventory requests expose ERP confirmation and click-to-copy barcodes', () => {
  const page = read('src/app/dashboard/requests/page.tsx');
  assert.match(page, /MAITRI ERP DIGITAL BT/);
  assert.match(page, /confirmErpTransfer/);
  assert.match(page, /confirmErpReceived/);
  assert.match(page, /rejectErpTransfer/);
  assert.match(page, /LIVE MAITRI ERP RECHECKS/);
  // Barcodes/certs copy on click via the shared Copyable component — no
  // dedicated "Copy barcode" button, and no direct clipboard call inline.
  assert.match(page, /<Copyable\b/);
  assert.doesNotMatch(page, /Copy barcode/);
  assert.doesNotMatch(page, /navigator\.clipboard\.writeText/);
});

test('sales-rep requests have no manual branch-pair routing controls', () => {
  const page = read('src/app/rep/request-stones/page.tsx');
  const workflow = read('src/lib/requestWorkflow.ts');
  assert.doesNotMatch(page, /CROSS_BRANCH_ROUTES/);
  assert.doesNotMatch(page, /NY-LA|LA-CH|NY local/);
  assert.match(page, /Home branch detected automatically/);
  assert.match(page, /customer_ship/);
  assert.match(workflow, /Ship directly to customer/);
});

test('local customer shipping keeps paperwork and label controls', () => {
  const page = read('src/app/rep/request-stones/page.tsx');
  const myRequests = read('src/app/rep/my-requests/page.tsx');
  assert.doesNotMatch(page, /requiresCustomerShipment\s*=\s*isCrossBranch/);
  assert.match(page, /hasDeliveryWorkflow\(isCrossBranch, deliveryRoute\)/);
  assert.match(myRequests, /Step 1 complete/);
  assert.match(myRequests, /Step 2 complete/);
  assert.match(myRequests, /updateLegacyPaperworkDecision/);
  assert.match(myRequests, /api\.setPaperworkType/);
  assert.match(myRequests, /documentStepState/);
});

test('invoice review groups requestable items by their stored home branch', () => {
  const page = read('src/app/rep/request-stones/page.tsx');
  assert.match(page, /extractedBranches/);
  assert.match(page, /Load \{count\} from \{invoiceBranch\} into cart/);
  assert.doesNotMatch(page, /sendReviewedExtracted/);
});
