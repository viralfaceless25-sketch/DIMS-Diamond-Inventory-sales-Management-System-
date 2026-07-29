require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');

const { initSockets } = require('./sockets');

const authRoute = require('./routes/auth');
const branchesRoute = require('./routes/branches');
const repsRoute = require('./routes/reps');
const stockRoute = require('./routes/stock');
const stockRechecksRoute = require('./routes/stockRechecks');
const requestsRoute = require('./routes/requests');
const trackingRoute = require('./routes/tracking');
const invoiceRoute = require('./routes/invoice');
const adminRoute = require('./routes/admin');
const transfersRoute = require('./routes/transfers');

const app = express();
const corsOrigin = process.env.CORS_ORIGIN || '*';
if (process.env.NODE_ENV === 'production' && corsOrigin === '*') {
  throw new Error('CORS_ORIGIN must be explicitly configured in production');
}

if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '2mb' }));

app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/ready', async (req, res) => {
  try {
    const pool = require('./db/pool');
    await pool.query('SELECT 1');
    res.json({ ok: true, database: 'ready' });
  } catch (err) {
    res.status(503).json({ ok: false, database: 'unavailable' });
  }
});

app.use('/api/auth', authRoute);
app.use('/api/branches', branchesRoute);
app.use('/api/reps', repsRoute);
app.use('/api/stock', stockRoute);
app.use('/api/stock-rechecks', stockRechecksRoute);
app.use('/api/requests', requestsRoute);
app.use('/api/tracking', trackingRoute);
app.use('/api/invoice', invoiceRoute);
app.use('/api/admin', adminRoute);
app.use('/api/transfers', transfersRoute);

// Centralized error handler — keep responses generic to the client, log the
// real detail server-side.
app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Uploaded file is too large' });
  if (err instanceof SyntaxError && 'body' in err) return res.status(400).json({ error: 'Invalid JSON request' });
  res.status(500).json({ error: 'Internal server error' });
});

const httpServer = http.createServer(app);
initSockets(httpServer, corsOrigin);

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '0.0.0.0';
httpServer.listen(PORT, HOST, () => {
  console.log(`Diamond inventory backend listening on http://${HOST}:${PORT}`);
});
