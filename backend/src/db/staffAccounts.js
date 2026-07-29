const ACCOUNTS = [
  { email: 'sales@maitri.nyc', role: 'sales_rep', name: 'Surbhi', branch: 'NY' },
  { email: 'sales1@maitri.nyc', role: 'sales_rep', name: 'Karan', branch: 'NY' },
  { email: 'sales2@maitri.nyc', role: 'sales_rep', name: 'Parth', branch: 'NY' },
  { email: 'sales3@maitri.nyc', role: 'sales_rep', name: 'Dhruvil', branch: 'NY' },
  { email: 'sales4@maitri.nyc', role: 'sales_rep', name: 'Harsh', branch: 'NY' },
  { email: 'sales5@maitri.nyc', role: 'sales_rep', name: 'Jash', branch: 'NY' },
  { email: 'sales6@maitri.nyc', role: 'sales_rep', name: 'Keyush', branch: 'NY' },
  { email: 'stockny@maitri.nyc', role: 'inventory', name: 'Inventory NY', branch: 'NY' },
  { email: 'stockla@maitri.nyc', role: 'inventory', name: 'Inventory LA', branch: 'LA' },
  { email: 'stockch@maitri.nyc', role: 'inventory', name: 'Inventory CH', branch: 'CH' },
  { email: 'sales11@maitri.nyc', role: 'sales_rep', name: 'Romil', branch: 'CH' },
  { email: 'sales12@maitri.nyc', role: 'sales_rep', name: 'Ajay', branch: 'CH' },
  { email: 'fadi@maitri.nyc', role: 'sales_rep', name: 'Fadi', branch: 'LA' },
  { email: 'parthik@maitri.nyc', role: 'sales_rep', name: 'Parthik', branch: 'LA' },
  { email: 'sales20@maitri.nyc', role: 'sales_rep', name: 'Parth (LA)', branch: 'LA' },
  { email: 'sales21@maitri.nyc', role: 'sales_rep', name: 'Sahil', branch: 'CH' },
];

function staffAccounts() {
  return ACCOUNTS.map((account) => ({ ...account }));
}

module.exports = { staffAccounts };
