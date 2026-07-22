// Whole-transaction retry helper.
//
// CockroachDB always runs at SERIALIZABLE isolation (Postgres normally
// defaults to READ COMMITTED). Under concurrent writes that touch overlapping
// data — two branches uploading stock at once, two inventory staff toggling
// the same request — CockroachDB can abort one transaction with SQLSTATE
// '40001' (serialization_failure) where plain Postgres would have just let it
// proceed. This is expected CockroachDB behavior, not a bug: every
// multi-statement transaction must be prepared to retry the WHOLE transaction
// from BEGIN, using a fresh client each attempt.
//
// This same helper also works unchanged against Postgres/Neon: Postgres can
// raise the identical SQLSTATE 40001 when a transaction explicitly runs at
// SERIALIZABLE isolation (see withSerializableTransaction below), so the
// retry path is exercised and testable without needing a live CockroachDB
// connection.

const RETRYABLE_SQLSTATE = '40001';

function isRetryableError(err) {
  return err && err.code === RETRYABLE_SQLSTATE;
}

/**
 * Runs `fn(client)` inside a fresh BEGIN/COMMIT transaction, retrying the
 * ENTIRE transaction (with a brand new client and a brand new BEGIN) if the
 * database reports a serialization failure. Non-retryable errors and
 * exhausted retries propagate to the caller unchanged.
 *
 * @param {import('pg').Pool} pool
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @param {{ maxAttempts?: number, baseDelayMs?: number, isolationLevel?: string }} [options]
 * @returns {Promise<T>}
 */
async function withTransaction(pool, fn, options = {}) {
  const { maxAttempts = 5, baseDelayMs = 50, isolationLevel } = options;

  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const client = await pool.connect();
    let began = false;
    try {
      await client.query(
        isolationLevel ? `BEGIN ISOLATION LEVEL ${isolationLevel}` : 'BEGIN'
      );
      began = true;

      const result = await fn(client);

      await client.query('COMMIT');
      return result;
    } catch (err) {
      if (began) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackErr) {
          // Rollback failing is not itself fatal — the connection is about to
          // be released either way. Log for visibility, don't mask the
          // original error.
          console.error('Rollback failed after transaction error:', rollbackErr.message);
        }
      }

      lastErr = err;
      const retryable = isRetryableError(err);
      const attemptsLeft = attempt < maxAttempts;

      if (!retryable || !attemptsLeft) {
        throw err;
      }

      const jitter = Math.random() * 20;
      const delay = baseDelayMs * 2 ** (attempt - 1) + jitter;
      await new Promise((resolve) => setTimeout(resolve, delay));
    } finally {
      client.release();
    }
  }

  // Unreachable in practice (the loop always throws or returns), but keeps
  // the function's type honest and satisfies strict linters.
  throw lastErr;
}

/**
 * Convenience wrapper that forces SERIALIZABLE isolation even on plain
 * Postgres. Use this for the request-stone toggle path so a real
 * serialization conflict (and the retry that handles it) can be forced and
 * tested locally against Postgres, not just assumed to work once we're on
 * CockroachDB.
 */
function withSerializableTransaction(pool, fn, options = {}) {
  return withTransaction(pool, fn, { ...options, isolationLevel: 'SERIALIZABLE' });
}

module.exports = { withTransaction, withSerializableTransaction, isRetryableError, RETRYABLE_SQLSTATE };
