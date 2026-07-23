let tail = Promise.resolve();

function enqueueStockImport(task) {
  const run = tail.then(task, task);
  tail = run.then(() => undefined, () => undefined);
  return run;
}

module.exports = { enqueueStockImport };
