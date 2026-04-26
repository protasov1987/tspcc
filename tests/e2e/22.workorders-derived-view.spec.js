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
  /^\[PRODUCTION\] areas layout load failed/i,
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

async function buildArchiveClient(browser, listRoute) {
  const client = await createLoggedInClient(browser, { baseURL, route: null });
  await client.page.goto(`${baseURL}${listRoute}`, { waitUntil: 'domcontentloaded' });
  await waitUsableUi(client.page, listRoute);
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

async function repeatArchivedCard(page, cardId) {
  const selector = `.repeat-card-btn[data-card-id="${cardId}"]`;
  await expect(page.locator(selector)).toBeVisible();
  return Promise.all([
    page.waitForResponse((res) => (
      res.request().method() === 'POST'
      && /\/api\/cards-core\/[^/]+\/repeat$/.test(new URL(res.url()).pathname)
    )),
    page.locator(selector).click()
  ]).then(([res]) => res);
}

async function findArchiveRepeatTarget(page) {
  return page.evaluate(() => {
    const button = document.querySelector('.repeat-card-btn[data-card-id]');
    const cardId = button?.getAttribute('data-card-id') || '';
    const card = typeof getCardStoreCard === 'function' ? getCardStoreCard(cardId) : null;
    const qr = String(card?.qrId || card?.barcode || '').trim();
    return cardId && qr ? { cardId, qr } : null;
  });
}

async function navigateSpaAndWait(page, route) {
  const spec = typeof route === 'string'
    ? { inputPath: route, expectedPath: route }
    : route;
  await page.evaluate((path) => {
    if (typeof navigateToRoute === 'function') {
      navigateToRoute(path);
      return;
    }
    if (typeof handleRoute === 'function') {
      handleRoute(path, { fromHistory: false });
      return;
    }
    throw new Error('SPA navigation helper is unavailable');
  }, spec.inputPath);
  await waitUsableUi(page, spec);
}

test.describe.serial('Stage 10 workorders derived view', () => {
  test.beforeAll(async () => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
  });

  test.afterAll(async () => {
    await stopServer();
  });

  test('keeps all Stage 10 routes URL-first on direct open, F5 and stale popstate state', async ({ page }) => {
    test.setTimeout(180000);
    const diagnostics = attachDiagnostics(page);
    const db = loadSnapshotDb();
    const fixture = getProductionFixture(db);
    const routeCardQr = fixture.routeCard?.qrId || '';
    const archivedCardQr = fixture.archivedCard?.qrId || '';

    const writes = [];
    page.on('request', (request) => {
      const url = request.url();
      if (request.method() === 'POST' && url.includes('/api/data')) {
        writes.push({ method: request.method(), url });
      }
    });

    await loginAsAbyss(page, { startPath: '/items' });
    await waitUsableUi(page, '/items');

    const routeChecks = [
      '/workorders',
      '/archive',
      '/items',
      '/ok',
      '/oc'
    ];

    if (routeCardQr) {
      routeChecks.push({
        inputPath: `/workorders/${encodeURIComponent(routeCardQr)}`,
        expectedPath: `/workorders/${encodeURIComponent(routeCardQr)}`,
        pageId: 'page-workorders-card'
      });
    }

    if (archivedCardQr) {
      routeChecks.push({
        inputPath: `/archive/${encodeURIComponent(archivedCardQr)}`,
        expectedPath: `/archive/${encodeURIComponent(archivedCardQr)}`,
        pageId: 'page-archive-card'
      });
    }

    for (const route of routeChecks) {
      const spec = await openRouteAndAssert(page, route);
      await expect.poll(() => page.evaluate(() => window.location.pathname)).not.toBe('/dashboard');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitUsableUi(page, spec);
      await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe(spec.expectedPath);
      await expect.poll(() => page.evaluate(() => window.location.pathname)).not.toBe('/dashboard');
    }

    await openRouteAndAssert(page, '/items');
    await page.evaluate(() => {
      history.pushState({ route: '/dashboard' }, '', '/ok');
      window.dispatchEvent(new PopStateEvent('popstate', { state: { route: '/dashboard' } }));
    });
    await waitUsableUi(page, '/ok');
    await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe('/ok');
    await expect.poll(() => (
      findConsoleEntries(diagnostics, /^\[ROUTE\] popstate/i).length
    )).toBeGreaterThan(0);

    expect(writes.some((entry) => entry.url.includes('/api/data'))).toBe(false);
    expectNoCriticalClientFailures(diagnostics, {
      ignoreConsolePatterns: [
        ...WORKORDERS_IGNORE_CONSOLE_PATTERNS
      ]
    });
  });

  test('keeps Stage 10 list/detail browser history route-safe without stale detail', async ({ page }) => {
    test.setTimeout(180000);
    const diagnostics = attachDiagnostics(page);
    const writes = [];
    page.on('request', (request) => {
      const url = request.url();
      if (request.method() === 'POST' && url.includes('/api/data')) {
        writes.push({ method: request.method(), url });
      }
    });

    await loginAsAbyss(page, { startPath: '/workorders' });
    await waitUsableUi(page, '/workorders');

    const db = loadSnapshotDb();
    const targets = (db.cards || [])
      .filter((card) => (
        card
        && !card.archived
        && card.cardType === 'MKI'
        && String(card.qrId || '').trim()
        && Array.isArray(card.operations)
        && card.operations.length > 0
      ))
      .slice(0, 2)
      .map((card) => ({
        id: String(card.id || '').trim(),
        qr: String(card.qrId || '').trim()
      }));
    expect(targets.length).toBeGreaterThanOrEqual(2);

    const [first, second] = targets;
    const firstRoute = `/workorders/${encodeURIComponent(first.qr)}`;
    const secondRoute = `/workorders/${encodeURIComponent(second.qr)}`;

    await navigateSpaAndWait(page, firstRoute);
    await expect(page.locator(`#page-workorders-card .wo-card[data-card-id="${first.id}"]`)).toBeVisible();
    await expect(page.locator(`#page-workorders-card .wo-card[data-card-id="${second.id}"]`)).toHaveCount(0);

    await navigateSpaAndWait(page, secondRoute);
    await expect(page.locator(`#page-workorders-card .wo-card[data-card-id="${second.id}"]`)).toBeVisible();
    await expect(page.locator(`#page-workorders-card .wo-card[data-card-id="${first.id}"]`)).toHaveCount(0);

    await page.goBack();
    await waitUsableUi(page, {
      inputPath: firstRoute,
      expectedPath: firstRoute,
      pageId: 'page-workorders-card'
    });
    await expect(page.locator(`#page-workorders-card .wo-card[data-card-id="${first.id}"]`)).toBeVisible();
    await expect(page.locator(`#page-workorders-card .wo-card[data-card-id="${second.id}"]`)).toHaveCount(0);

    await page.goBack();
    await waitUsableUi(page, '/workorders');
    await page.goForward();
    await waitUsableUi(page, {
      inputPath: firstRoute,
      expectedPath: firstRoute,
      pageId: 'page-workorders-card'
    });
    await page.goForward();
    await waitUsableUi(page, {
      inputPath: secondRoute,
      expectedPath: secondRoute,
      pageId: 'page-workorders-card'
    });
    await expect(page.locator(`#page-workorders-card .wo-card[data-card-id="${second.id}"]`)).toBeVisible();
    await expect(page.locator(`#page-workorders-card .wo-card[data-card-id="${first.id}"]`)).toHaveCount(0);

    expect(writes.some((entry) => entry.url.includes('/api/data'))).toBe(false);
    expectNoCriticalClientFailures(diagnostics, {
      ignoreConsolePatterns: [
        ...WORKORDERS_IGNORE_CONSOLE_PATTERNS
      ]
    });
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
        /^\[PRODUCTION\] areas layout load failed/i,
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

  test('keeps /archive/:qr during real two-client stale repeat conflict and refreshes to server truth', async ({ browser }) => {
    test.setTimeout(160000);
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();

    const listRoute = '/archive';
    const clients = [
      await buildArchiveClient(browser, listRoute),
      await buildArchiveClient(browser, listRoute)
    ];

    try {
      const [clientA, clientB] = clients;
      const target = await findArchiveRepeatTarget(clientA.page);
      test.skip(!target?.cardId || !target?.qr, 'Нет архивной карты для repeat conflict на /archive/:qr');
      const { cardId, qr } = target;
      const detailRoute = `/archive/${encodeURIComponent(qr)}`;

      await navigateSpaAndWait(clientA.page, {
        inputPath: detailRoute,
        expectedPath: detailRoute,
        pageId: 'page-archive-card'
      });
      await navigateSpaAndWait(clientB.page, {
        inputPath: detailRoute,
        expectedPath: detailRoute,
        pageId: 'page-archive-card'
      });

      const writes = [];
      for (const client of clients) {
        client.page.on('request', (request) => {
          const url = request.url();
          if (request.method() !== 'POST') return;
          if (url.includes('/api/data') || /\/api\/cards-core\/[^/]+\/repeat$/.test(new URL(url).pathname)) {
            writes.push({ method: request.method(), url });
          }
        });
      }

      const initialRev = await clientB.page.evaluate((id) => {
        const card = typeof getCardStoreCard === 'function' ? getCardStoreCard(id) : null;
        return Number(card?.rev || 0) || 0;
      }, cardId);
      expect(initialRev).toBeGreaterThan(0);

      const okResponse = await repeatArchivedCard(clientA.page, cardId);
      expect(okResponse.status()).toBe(201);
      await expect.poll(() => new URL(clientA.page.url()).pathname.startsWith('/cards/')).toBeTruthy();

      const staleResponse = await repeatArchivedCard(clientB.page, cardId);
      expect(staleResponse.status()).toBe(409);
      await expect.poll(() => new URL(clientB.page.url()).pathname).toBe(detailRoute);
      await expect(clientB.page.locator(`#page-archive-card .wo-card[data-card-id="${cardId}"]`)).toBeVisible();

      await expect.poll(() => clientB.page.evaluate((id) => {
        const card = typeof getCardStoreCard === 'function' ? getCardStoreCard(id) : null;
        return Number(card?.rev || 0) || 0;
      }, cardId)).toBeGreaterThan(initialRev);

      await clientB.page.goBack();
      await waitUsableUi(clientB.page, listRoute);
      await clientB.page.goForward();
      await waitUsableUi(clientB.page, {
        inputPath: detailRoute,
        expectedPath: detailRoute,
        pageId: 'page-archive-card'
      });
      await expect(clientB.page.locator(`#page-archive-card .wo-card[data-card-id="${cardId}"]`)).toBeVisible();

      expect(writes.some((entry) => entry.url.includes('/api/data'))).toBe(false);
      expect(writes.filter((entry) => /\/api\/cards-core\/[^/]+\/repeat$/.test(new URL(entry.url).pathname))).toHaveLength(2);
      await expect.poll(() => (
        findConsoleEntries(clientB.diagnostics, /^\[CONFLICT\] conflict detected/i).length
      )).toBeGreaterThan(0);
      await expect.poll(() => (
        findConsoleEntries(clientB.diagnostics, /^\[CONFLICT\] archive refresh start/i).length
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
});
