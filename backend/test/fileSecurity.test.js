const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isSafeDocument,
  safeDownloadName,
} = require('../src/services/fileSecurity');

test('document signature must agree with the declared PDF, PNG, or JPEG type', () => {
  assert.equal(
    isSafeDocument(Buffer.from('%PDF-1.7\nstock paperwork'), 'application/pdf'),
    true
  );
  assert.equal(
    isSafeDocument(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]),
      'image/png'
    ),
    true
  );
  assert.equal(
    isSafeDocument(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]), 'image/jpeg'),
    true
  );
  assert.equal(
    isSafeDocument(Buffer.from('%PDF-1.7\n'), 'image/png'),
    false
  );
  assert.equal(
    isSafeDocument(Buffer.from('not a document'), 'application/pdf'),
    false
  );
});

test('download names cannot inject paths, quotes, or response headers', () => {
  assert.equal(
    safeDownloadName('../../folder\\invoice\"\r\nX-Test: bad.pdf', 'paperwork.pdf'),
    'invoiceX-Test bad.pdf'
  );
  assert.equal(safeDownloadName('', 'paperwork.pdf'), 'paperwork.pdf');
  assert.equal(safeDownloadName('N'.repeat(250), 'paperwork.pdf').length, 180);
});
