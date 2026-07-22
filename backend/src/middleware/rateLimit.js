function createRateLimit({ windowMs, max, message = 'Too many attempts. Please try again later.', key }) {
  const entries = new Map();

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [entryKey, entry] of entries) {
      if (entry.resetAt <= now) entries.delete(entryKey);
    }
  }, Math.min(windowMs, 60_000));
  cleanup.unref();

  return (req, res, next) => {
    const now = Date.now();
    const entryKey = key ? key(req) : req.ip;
    const current = entries.get(entryKey);
    const entry = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + windowMs }
      : current;
    entry.count += 1;
    entries.set(entryKey, entry);
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    if (entry.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

module.exports = { createRateLimit };
