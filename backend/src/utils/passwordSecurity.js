const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = 12;

function passwordError(password) {
  if (typeof password !== 'string' || password.length < 12) {
    return 'Password must be at least 12 characters';
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return 'Password must include uppercase, lowercase, number, and symbol';
  }
  return null;
}

function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

module.exports = { BCRYPT_ROUNDS, passwordError, hashPassword };
