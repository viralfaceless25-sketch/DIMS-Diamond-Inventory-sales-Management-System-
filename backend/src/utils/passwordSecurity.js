const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = 12;
const MAX_PASSWORD_UTF8_BYTES = 72;

function passwordExceedsBcryptByteLimit(password) {
  return typeof password === 'string' && Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_UTF8_BYTES;
}

function passwordError(password) {
  if (typeof password !== 'string' || password.length < 12) {
    return 'Password must be at least 12 characters';
  }
  if (passwordExceedsBcryptByteLimit(password)) {
    return `Password must be at most ${MAX_PASSWORD_UTF8_BYTES} UTF-8 bytes`;
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return 'Password must include uppercase, lowercase, number, and symbol';
  }
  return null;
}

function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

module.exports = { BCRYPT_ROUNDS, MAX_PASSWORD_UTF8_BYTES, passwordExceedsBcryptByteLimit, passwordError, hashPassword };
