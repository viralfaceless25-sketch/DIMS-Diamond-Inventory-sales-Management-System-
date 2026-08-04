const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const liveUrl = process.env.DIMS_LIVE_URL || 'https://maitri-inventory-web.onrender.com';
const accounts = JSON.parse(process.env.DIMS_ACCOUNTS_JSON || '[]');
const outputDir = path.resolve(__dirname, '../../artifacts/production-audit-2026-08-04');
const screenshotDir = path.join(outputDir, 'screenshots');

const pagesByRole = {
  sales_rep: ['/rep/request-stones', '/rep/my-requests', '/rep/tracking'],
  inventory: ['/dashboard/requests', '/dashboard/receiving', '/dashboard/reps', '/dashboard/stock', '/dashboard/tracking'],
  admin: ['/admin/users'],
};

const forbiddenByRole = {
  sales_rep: '/dashboard/requests',
  inventory: '/rep/request-stones',
  admin: '/dashboard/requests',
};

function safeName(value) {
  return value.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
}

async function settle(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1800);
}

async function login(page, account) {
  await page.goto(`${liveUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[autocomplete="email"]').fill(account.email);
  await page.locator('input[autocomplete="current-password"]').fill(process.env.DIMS_TEST_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 30_000 });
  await settle(page);
}

async function inspectPage(page, account, route, viewport) {
  const consoleErrors = [];
  const failedRequests = [];
  const consoleHandler = (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 500));
  };
  const failedHandler = (request) => failedRequests.push({
    method: request.method(),
    url: request.url().replace(/\?.*$/, ''),
    error: request.failure()?.errorText || 'failed',
  });
  page.on('console', consoleHandler);
  page.on('requestfailed', failedHandler);
  const startedAt = Date.now();
  let navigationError = null;
  try {
    await page.goto(`${liveUrl}${route}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await settle(page);
  } catch (error) {
    navigationError = error instanceof Error ? error.message.slice(0, 500) : String(error);
  }
  const currentPath = new URL(page.url()).pathname;
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const unnamedButtons = await page.locator('button').evaluateAll((buttons) => buttons.filter((button) => {
    const text = (button.textContent || '').trim();
    return !text && !button.getAttribute('aria-label') && !button.getAttribute('title');
  }).length).catch(() => -1);
  const unlabeledInputs = await page.locator('input, select, textarea').evaluateAll((inputs) => inputs.filter((input) => {
    const id = input.getAttribute('id');
    const labelled = input.getAttribute('aria-label') || input.getAttribute('aria-labelledby') || input.getAttribute('title');
    const wrapped = Boolean(input.closest('label'));
    const explicit = id ? Boolean(document.querySelector(`label[for="${CSS.escape(id)}"]`)) : false;
    return !labelled && !wrapped && !explicit;
  }).length).catch(() => -1);
  const screenshot = `${safeName(account.label)}-${viewport}-${safeName(route)}.png`;
  await page.screenshot({ path: path.join(screenshotDir, screenshot), fullPage: false });
  page.off('console', consoleHandler);
  page.off('requestfailed', failedHandler);
  return {
    account: account.label,
    role: account.role,
    branch: account.branch,
    route,
    currentPath,
    viewport,
    durationMs: Date.now() - startedAt,
    bodyPresent: bodyText.trim().length > 0,
    navigationError,
    consoleErrors,
    failedRequests,
    unnamedButtons,
    unlabeledInputs,
    screenshot,
    passed: !navigationError && currentPath === route && bodyText.trim().length > 0 && consoleErrors.length === 0 && failedRequests.length === 0,
  };
}

(async () => {
  if (!accounts.length || !process.env.DIMS_TEST_PASSWORD) throw new Error('Test accounts and password are required');
  fs.mkdirSync(screenshotDir, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const results = [];
  try {
    for (const account of accounts) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      await login(page, account);
      for (const route of pagesByRole[account.role]) {
        results.push(await inspectPage(page, account, route, 'desktop'));
      }
      await page.goto(`${liveUrl}${forbiddenByRole[account.role]}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      results.push({
        account: account.label,
        role: account.role,
        route: forbiddenByRole[account.role],
        currentPath: new URL(page.url()).pathname,
        kind: 'role-redirect',
        passed: new URL(page.url()).pathname !== forbiddenByRole[account.role],
      });
      await context.close();
    }

    for (const account of accounts.filter((candidate) => ['sales-NY', 'inventory-NY', 'admin'].includes(candidate.label))) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      await login(page, account);
      results.push(await inspectPage(page, account, pagesByRole[account.role][0], 'mobile'));
      await context.close();
    }
  } finally {
    await browser.close();
  }
  const report = {
    generatedAt: new Date().toISOString(),
    liveUrl,
    summary: {
      total: results.length,
      passed: results.filter((result) => result.passed).length,
      failed: results.filter((result) => !result.passed).length,
    },
    results,
  };
  fs.writeFileSync(path.join(outputDir, 'ui-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ summary: report.summary, failures: results.filter((result) => !result.passed) }, null, 2));
  if (report.summary.failed) process.exitCode = 1;
})().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
