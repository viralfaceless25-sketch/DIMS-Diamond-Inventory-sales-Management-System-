const path = require('node:path');
const { Worker } = require('node:worker_threads');

const WORKER_PATH = path.resolve(__dirname, '../workers/stockFileParserWorker.js');
const DEFAULT_TIMEOUT_MS = 10 * 60_000;

function parseStockFile(filePath, originalName, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH, {
      workerData: { filePath, originalName },
      resourceLimits: { maxOldGenerationSizeMb: 320 },
    });
    let settled = false;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };

    const timer = setTimeout(() => {
      const error = new Error('Stock file processing timed out; verify the file and try again');
      error.code = 'STOCK_PARSE_TIMEOUT';
      worker.terminate().finally(() => finish(reject, error));
    }, timeoutMs);
    timer.unref?.();

    worker.once('message', (message) => {
      if (message?.ok) {
        finish(resolve, message.result);
        return;
      }
      const error = new Error(message?.error || 'Stock file could not be parsed');
      error.code = message?.code || 'STOCK_PARSE_FAILED';
      finish(reject, error);
    });
    worker.once('error', (error) => finish(reject, error));
    worker.once('exit', (code) => {
      if (code !== 0) {
        const error = new Error('Stock file parser stopped unexpectedly');
        error.code = 'STOCK_PARSE_WORKER_EXIT';
        finish(reject, error);
      }
    });
  });
}

module.exports = { parseStockFile, WORKER_PATH };
