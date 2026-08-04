const test = require('node:test');
const assert = require('node:assert/strict');
const { applyResolutionChoice } = require('../src/services/requestLifecycleService');
const { assertInventoryRequestView } = require('../src/services/requestAuthorization');

const base = {
  stone_found: false,
  cert_found: false,
  not_found: false,
  stone_found_at: null,
  cert_found_at: null,
  not_found_at: null,
  not_found_by: null,
};

test('not found clears both found controls and records its actor', () => {
  const changed = applyResolutionChoice({ ...base, stone_found: true, cert_found: true }, 'not_found', true, 7, 'now');
  assert.deepEqual(changed, {
    stone_found: false, cert_found: false, not_found: true,
    stone_found_at: null, cert_found_at: null, not_found_at: 'now', not_found_by: 7,
  });
});

test('selecting a found control clears not found', () => {
  const changed = applyResolutionChoice({ ...base, not_found: true, not_found_at: 'before', not_found_by: 8 }, 'stone_found', true, 7, 'now');
  assert.deepEqual(changed, {
    stone_found: true, cert_found: false, not_found: false,
    stone_found_at: 'now', cert_found_at: null, not_found_at: null, not_found_by: null,
  });
});

test('responsible inventory can record a view before customer packing', () => {
  assert.doesNotThrow(() => assertInventoryRequestView({
    request: { branch: 'NY', fulfillment_branch: 'NY', status: 'awaiting' },
    actorBranch: 'NY',
  }));
  assert.throws(() => assertInventoryRequestView({
    request: { branch: 'LA', fulfillment_branch: 'NY', status: 'awaiting' },
    actorBranch: 'LA',
  }), /Only NY inventory/);
});
