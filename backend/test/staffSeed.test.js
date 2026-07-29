const test = require('node:test');
const assert = require('node:assert/strict');
const { staffAccounts } = require('../src/db/staffAccounts');

test('staff seed always includes one inventory account for every branch', () => {
  const inventory = staffAccounts()
    .filter((account) => account.role === 'inventory')
    .map(({ email, name, branch }) => ({ email, name, branch }));

  assert.deepEqual(inventory, [
    { email: 'stockny@maitri.nyc', name: 'Inventory NY', branch: 'NY' },
    { email: 'stockla@maitri.nyc', name: 'Inventory LA', branch: 'LA' },
    { email: 'stockch@maitri.nyc', name: 'Inventory CH', branch: 'CH' },
  ]);
});

test('staff account definitions never contain credentials', () => {
  for (const account of staffAccounts()) {
    assert.deepEqual(Object.keys(account).sort(), [
      'branch',
      'email',
      'name',
      'role',
    ]);
  }
});
