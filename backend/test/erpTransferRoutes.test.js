const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

test('transfer routes expose separate ERP issue, request, and receipt actions', async () => {
  const source = await fs.readFile(
    path.resolve(__dirname, '../src/routes/transfers.js'),
    'utf8'
  );

  assert.match(source, /\/:id\/erp-transfer/);
  assert.match(source, /\/:id\/request-erp-receive/);
  assert.match(source, /\/:id\/erp-received/);
  assert.match(source, /\/:id\/erp-unavailable/);
  assert.match(source, /assertErpTransferAction/);
  assert.match(source, /erp_transfer_issued/);
  assert.match(source, /erp_receive_requested/);
  assert.match(source, /erp_transfer_received/);
  assert.match(source, /erp_transfer_rejected/);
});
