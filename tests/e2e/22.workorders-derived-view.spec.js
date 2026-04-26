const { test, expect } = require('@playwright/test');
const { resetDatabaseFromSnapshot } = require('./helpers/snapshot');
const { restartServer, stopServer } = require('./helpers/server');
const {
  attachDiagnostics,
  expectNoCriticalClientFailures,
  findConsoleEntries,
  resetDiagnostics
} = require('./helpers/diagnostics');
const { loginAsAbyss } = require('./helpers/auth');
const { openRouteAndAssert, waitUsableUi } = require('./helpers/navigation');
const { loadSnapshotDb, getProductionFixture } = require('./helpers/db');
const { createLoggedInClient, closeClients } = require('./helpers/multiclient');
const { baseURL } = require('./helpers/paths');

const WORKORDERS_IGNORE_CONSOLE_PATTERNS = [
  /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
  /^\[LIVE\]/i,
  /^\[DATA\]/i,
  /^\[CONFLICT\]/i,
  /Не удалось загрузить данные с сервера/i,
  /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
];

async function buildWorkordersClient(browser, routePath) {
  const client = await createLoggedInClient(browser, { baseURL, route: null });
  await client.page.goto(`${baseURL}${routePath}`, { waitUntil: 'domcontentloaded' });
  await waitUsableUi(client.page, {
    inputPath: routePath,
    expectedPath: routePath,
    pageId: routePath.startsWith('/workorders/') ? 'page-workorders-card' : 'page-workorders'
  });
  resetDiagnostics(client.diagnostics);
  return client;
}

async function findWorkordersCommentTarget(page) {
  return page.evaluate(() => {
    const cardList = typeof cards !== 'undefined' && Array.isArray(cards) ? cards : [];
    const buttons = [...document.querySelectorAll('button[data-action="op-comments"][data-card-id][data-op-id]')];
    for (const button of buttons) {
      const cardId = button.getAttribute('data-card-id') || '';
      const opId = button.getAttribute('data-op-id') || '';
      const card = cardList.find((item) => item && item.id === cardId);
      const op = (card?.operations || []).find((item) => item && item.id === opId);
      if (!card || !op || !card.qrId) continue;
      return {
        cardId,
        opId,
        qr: String(card.qrId).trim()
      };
    }
    return null;
  });
}

async function openWorkordersCommentModal(page, target) {
  const selector = `button[data-action="op-comments"][data-card-id="${target.cardId}"][data-op-id="${target.opId}"]`;
  await page.locator(selector).first().click();
  await expect(page.locator('#op-comments-modal')).toBeVisible();
}

async function submitWorkordersComment(page, text) {
  await page.fill('#op-comments-input', text);
  return Promise.all([
    page.waitForResponse((res) => (
      res.request().method() === 'POST'
      && res.url().includes('/api/production/operation/comment')
    )),
    page.click('#op-comments-send')
  ]).then(([res]) => res);
}

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
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitUsableUi(page, '/workorders');
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
        ...WORKORDERS_IGNORE_CONSOLE_PATTERNS
      ]
    });
  });

  test('keeps /workorders/:qr during real two-client stale operation comment conflict', async ({ browser }) => {
    test.setTimeout(120000);
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();

    const db = loadSnapshotDb();
    const fixture = getProductionFixture(db);
    const qr = fixture.routeCard?.qrId || '';
    expect(qr).toBeTruthy();
    const detailRoute = `/workorders/${encodeURIComponent(qr)}`;
    const clients = [
      await buildWorkordersClient(browser, detailRoute),
      await buildWorkordersClient(browser, detailRoute)
    ];

    try {
      const [clientA, clientB] = clients;
      const writes = [];
      for (const client of clients) {
        client.page.on('request', (request) => {
          const url = request.url();
          if (request.method() !== 'POST') return;
          if (url.includes('/api/data') || url.includes('/api/production/operation/comment')) {
            writes.push({ method: request.method(), url });
          }
        });
      }

      const target = await findWorkordersCommentTarget(clientA.page);
      test.skip(!target?.opId, 'Нет доступной операции для comment conflict на /workorders/:qr');

      await openWorkordersCommentModal(clientA.page, target);
      await openWorkordersCommentModal(clientB.page, target);

      const okResponse = await submitWorkordersComment(clientA.page, `Stage10 client A ${Date.now()}`);
      expect(okResponse.ok()).toBeTruthy();

      const staleResponse = await submitWorkordersComment(clientB.page, `Stage10 client B stale ${Date.now()}`);
      expect(staleResponse.status()).toBe(409);

      await expect.poll(() => new URL(clientA.page.url()).pathname).toBe(detailRoute);
      await expect.poll(() => new URL(clientB.page.url()).pathname).toBe(detailRoute);
      expect(writes.some((entry) => entry.url.includes('/api/production/operation/comment'))).toBe(true);
      expect(writes.some((entry) => entry.url.includes('/api/data'))).toBe(false);
      await expect.poll(() => (
        findConsoleEntries(clientB.diagnostics, /^\[CONFLICT\] conflict detected/i).length
      )).toBeGreaterThan(0);
      await expect.poll(() => (
        findConsoleEntries(clientB.diagnostics, /^\[DATA\] targeted refresh start/i).length
      )).toBeGreaterThan(0);

      expectNoCriticalClientFailures(clientA.diagnostics, {
        allow409: false,
        ignoreConsolePatterns: WORKORDERS_IGNORE_CONSOLE_PATTERNS
      });
      expectNoCriticalClientFailures(clientB.diagnostics, {
        allow409: true,
        ignoreConsolePatterns: WORKORDERS_IGNORE_CONSOLE_PATTERNS
      });
    } finally {
      await closeClients(clients);
    }
  });

  test('keeps /workorders/:qr and sends no request when comment modal has stale local operation context', async ({ page }) => {
    test.setTimeout(120000);
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();

    const diagnostics = attachDiagnostics(page);
    const db = loadSnapshotDb();
    const fixture = getProductionFixture(db);
    const qr = fixture.routeCard?.qrId || '';
    expect(qr).toBeTruthy();

    const detailRoute = `/workorders/${encodeURIComponent(qr)}`;
    const writes = [];
    page.on('request', (request) => {
      const url = request.url();
      if (request.method() !== 'POST') return;
      if (url.includes('/api/data') || url.includes('/api/production/operation/comment')) {
        writes.push({ method: request.method(), url });
      }
    });

    await loginAsAbyss(page, { startPath: detailRoute });
    await waitUsableUi(page, {
      inputPath: detailRoute,
      expectedPath: detailRoute,
      pageId: 'page-workorders-card'
    });

    const target = await findWorkordersCommentTarget(page);
    test.skip(!target?.opId, 'Нет доступной операции для local stale comment на /workorders/:qr');
    await openWorkordersCommentModal(page, target);
    await page.fill('#op-comments-input', `Stage10 local stale ${Date.now()}`);

    await page.evaluate(({ cardId, opId }) => {
      const card = cards.find((item) => item && item.id === cardId);
      if (!card || !Array.isArray(card.operations)) return;
      card.operations = card.operations.filter((item) => item && item.id !== opId);
    }, target);

    await page.click('#op-comments-send');

    await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe(detailRoute);
    await expect.poll(() => page.evaluate(({ cardId, opId }) => {
      const card = cards.find((item) => item && item.id === cardId);
      return Boolean((card?.operations || []).find((item) => item && item.id === opId));
    }, target)).toBe(true);
    expect(writes.some((entry) => entry.url.includes('/api/production/operation/comment'))).toBe(false);
    expect(writes.some((entry) => entry.url.includes('/api/data'))).toBe(false);
    await expect.poll(() => (
      findConsoleEntries(diagnostics, /^\[DATA\] targeted refresh start/i).length
    )).toBeGreaterThan(0);

    expectNoCriticalClientFailures(diagnostics, {
      ignoreConsolePatterns: WORKORDERS_IGNORE_CONSOLE_PATTERNS
    });
  });
});
