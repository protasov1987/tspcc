const { test, expect } = require('@playwright/test');
const { resetDatabaseFromSnapshot } = require('./helpers/snapshot');
const { restartServer, stopServer } = require('./helpers/server');
const { attachDiagnostics, expectNoCriticalClientFailures } = require('./helpers/diagnostics');
const { loginAsAbyss } = require('./helpers/auth');
const { openRouteAndAssert, waitUsableUi } = require('./helpers/navigation');
const { loadSnapshotDb, getProductionFixture } = require('./helpers/db');

test.describe.serial('Stage 10 workorders derived view', () => {
  test.beforeAll(async () => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
  });

  test.afterAll(async () => {
    await stopServer();
  });

  test('uses production read scope and keeps list/detail route-safe', async ({ page }) => {
    test.setTimeout(120000);
    const diagnostics = attachDiagnostics(page);
    const db = loadSnapshotDb();
    const fixture = getProductionFixture(db);
    const qr = fixture.routeCard?.qrId || '';
    expect(qr).toBeTruthy();

    const dataRequests = [];
    page.on('request', (request) => {
      const url = request.url();
      if (!url.includes('/api/data')) return;
      dataRequests.push({ method: request.method(), url });
    });

    await loginAsAbyss(page, { startPath: '/workorders' });
    await waitUsableUi(page, '/workorders');

    await expect.poll(() => dataRequests.some((entry) => (
      entry.method === 'GET' && /[?&]scope=production\b/.test(entry.url)
    ))).toBeTruthy();
    expect(dataRequests.some((entry) => entry.method === 'POST' && entry.url.includes('/api/data'))).toBe(false);
    await expect(page.locator('.executor-main-input')).toHaveCount(0);
    await expect(page.locator('.additional-executor-input')).toHaveCount(0);

    const detailRoute = `/workorders/${encodeURIComponent(qr)}`;
    await openRouteAndAssert(page, {
      inputPath: detailRoute,
      expectedPath: detailRoute,
      pageId: 'page-workorders-card'
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitUsableUi(page, {
      inputPath: detailRoute,
      expectedPath: detailRoute,
      pageId: 'page-workorders-card'
    });
    await openRouteAndAssert(page, '/workorders');
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await waitUsableUi(page, {
      inputPath: detailRoute,
      expectedPath: detailRoute,
      pageId: 'page-workorders-card'
    });

    expect(dataRequests.some((entry) => entry.method === 'POST' && entry.url.includes('/api/data'))).toBe(false);
    expectNoCriticalClientFailures(diagnostics, {
      ignoreConsolePatterns: [
        /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
        /^\[LIVE\]/i,
        /Не удалось загрузить данные с сервера/i,
        /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
      ]
    });
  });

  test('sends operation comments through production execution command', async ({ page }) => {
    test.setTimeout(120000);
    const diagnostics = attachDiagnostics(page);
    const db = loadSnapshotDb();
    const fixture = getProductionFixture(db);
    const qr = fixture.routeCard?.qrId || '';
    expect(qr).toBeTruthy();

    const writes = [];
    page.on('request', (request) => {
      const url = request.url();
      if (request.method() === 'POST' && (url.includes('/api/data') || url.includes('/api/production/operation/comment'))) {
        writes.push({ method: request.method(), url });
      }
    });

    const detailRoute = `/workorders/${encodeURIComponent(qr)}`;
    await loginAsAbyss(page, { startPath: detailRoute });
    await waitUsableUi(page, {
      inputPath: detailRoute,
      expectedPath: detailRoute,
      pageId: 'page-workorders-card'
    });

    await page.locator('button[data-action="op-comments"]').first().click();
    await expect(page.locator('#op-comments-modal')).toBeVisible();
    await page.fill('#op-comments-input', `Stage10 workorders comment ${Date.now()}`);
    const response = await Promise.all([
      page.waitForResponse((res) => (
        res.request().method() === 'POST'
        && res.url().includes('/api/production/operation/comment')
      )),
      page.click('#op-comments-send')
    ]).then(([res]) => res);

    expect(response.ok()).toBeTruthy();
    await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe(detailRoute);
    expect(writes.some((entry) => entry.url.includes('/api/production/operation/comment'))).toBe(true);
    expect(writes.some((entry) => entry.url.includes('/api/data'))).toBe(false);

    expectNoCriticalClientFailures(diagnostics, {
      ignoreConsolePatterns: [
        /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
        /^\[LIVE\]/i,
        /^\[DATA\] route-safe re-render/i,
        /Не удалось загрузить данные с сервера/i,
        /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
      ]
    });
  });
});
