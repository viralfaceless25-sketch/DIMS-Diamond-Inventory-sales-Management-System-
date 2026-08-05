// Shared parsing for values that arrive as untrusted request text.
//
// `Number(req.params.id)` was the previous pattern and it accepts too much:
// `Number('abc')` is NaN, which pg then sends to an integer column and
// Postgres answers with a 500; `Number.isInteger` alone still lets `-1` and
// `0` through, which reach the database and return an inconsistent mix of
// 404s and no-op 200s depending on the route. Both are indistinguishable to
// the caller from a real server fault.

const PLAIN_DECIMAL = /^\d+$/;

/**
 * Parses an id that must be a positive integer, written in plain decimal.
 *
 * Deliberately stricter than `Number()`: exponent form, hex, signs, decimal
 * points, and surrounding whitespace are all rejected, so the accepted set is
 * the same on every route and cannot drift with JavaScript coercion rules.
 *
 * @returns {number|null} the id, or null if the value is not a usable id
 */
function parseId(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== 'string' || !PLAIN_DECIMAL.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Resolves an enum-valued query parameter.
 *
 * An absent or empty value falls back to the default. A value that is present
 * but not allowed returns null so the caller can answer 400 — silently
 * falling back would show the caller a different list than the one asked for
 * and look like missing data.
 *
 * @returns {string|null} the chosen value, or null if it was supplied and invalid
 */
function parseEnumParam(value, allowed, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return null;
  return allowed.includes(value) ? value : null;
}

/**
 * Trims and length-checks free text that will be stored, rejecting anything
 * that is not actually a string. `[]` and `{}` are truthy, so a bare
 * `if (!name)` check lets them through to the INSERT.
 *
 * @returns {string|null} the trimmed text, or null if unusable
 */
function parseText(value, { maxLength = 200 } = {}) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

module.exports = { parseId, parseEnumParam, parseText };
