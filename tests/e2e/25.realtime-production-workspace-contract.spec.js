const { test, expect } = require('@playwright/test');
const { resetDatabaseFromSnapshot } = require('./helpers/snapshot');
const { restartServer, stopServer } = require('./helpers/server');
const { loginAsAbyss } = require('./helpers/auth');
const { openRouteAndAssert } = require('./helpers/navigation');
const { attachDiagnostics, resetDiagnostics, expectNoCriticalClientFailures } = require('./helpers/diagnostics');

const IGNORE_LIVE_CONSOLE = [
  /^\[LIVE\]/i,
  /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i,
  /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i
];

async function openLoggedInPage(browser, route) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const diagnostics = attachDiagnostics(page);
  await loginAsAbyss(page);
  await openRouteAndAssert(page, route);
  resetDiagnostics(diagnostics);
  return { context, page, diagnostics };
}

async function signalFakeCardLivePayload(page) {
  return page.evaluate(() => {
    const cardList = Array.isArray(cards) ? cards : [];
    const card = cardList.find(item => item && item.id);
    if (!card) return { handled: false, markerApplied: false, hasCard: false };
    const marker = `live-payload-marker-${Date.now()}`;
    const payloadCard = {
      ...JSON.parse(JSON.stringify(card)),
      __stage12LivePayloadMarker: marker
    };
    const handled = typeof handleProductionWorkspaceStructuredCardLiveEvent === 'function'
      ? handleProductionWorkspaceStructuredCardLiveEvent('card.updated', {
        entity: 'card',
        action: 'updated',
        id: card.id,
        card: payloadCard
      })
      : false;
    const stored = (Array.isArray(cards) ? cards : []).find(item => item && item.id === card.id);
    return {
      handled,
      markerApplied: stored?.__stage12LivePayloadMarker === marker,
      hasCard: true
    };
  });
}

async function findWorkspaceCommentTarget(page) {
  return page.evaluate(() => {
    const cardList = Array.isArray(cards) ? cards : [];
    const buttons = [...document.querySelectorAll('button[data-action="op-comments"][data-card-id][data-op-id]')];
    for (const button of buttons) {
      const cardId = button.getAttribute('data-card-id') || '';
      const opId = button.getAttribute('data-op-id') || '';
      const card = cardList.find(item => item && item.id === cardId);
      const op = (card?.operations || []).find(item => item && item.id === opId);
      const qr = String(card?.qrId || '').trim();
      if (!card || !op || !qr) continue;
      return { cardId, opId, qr };
    }
    return null;
  });
}

async function openWorkspaceCommentModal(page, target) {
  const selector = `button[data-action="op-comments"][data-card-id="${target.cardId}"][data-op-id="${target.opId}"]`;
  await page.locator(selector).first().click();
  await expect(page.locator('#op-comments-modal')).toBeVisible();
}

async function submitWorkspaceComment(page, text) {
  await page.fill('#op-comments-input', text);
  return Promise.all([
    page.waitForResponse((res) => (
      res.request().method() === 'POST'
      && res.url().includes('/api/production/operation/comment')
    )),
    page.click('#op-comments-send')
  ]).then(([res]) => res);
}

test.describe.serial('production/workspace realtime server-refresh contract', () => {
  test.beforeAll(async () => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
  });

  test.afterAll(async () => {
    await stopServer();
  });

  test('planning live signal refreshes route-local planning slice and does not apply card payload', async ({ browser }) => {
    const client = await openLoggedInPage(browser, '/production/plan');
    try {
      const result = await signalFakeCardLivePayload(client.page);
      expect(result.hasCard).toBeTruthy();
      expect(result.handled).toBeTruthy();
      expect(result.markerApplied).toBeFalsy();

      await expect.poll(() => {
        return client.diagnostics.responses.filter(entry => (
          entry.method === 'GET'
          && /\/api\/production\/planning\/slice\?/i.test(entry.url || '')
          && /[?&]slice=plan(?:&|$)/i.test(entry.url || '')
        )).length;
      }).toBeGreaterThan(0);

      const broadProductionReads = client.diagnostics.responses.filter(entry => (
        entry.method === 'GET'
        && /\/api\/data\?scope=production/i.test(entry.url || '')
      ));
      expect(broadProductionReads).toEqual([]);
      expectNoCriticalClientFailures(client.diagnostics, {
        ignoreConsolePatterns: IGNORE_LIVE_CONSOLE
      });
    } finally {
      await client.context.close();
    }
  });

  test('planning cards:changed delayed by ignore window still refreshes planning slice', async ({ browser }) => {
    const client = await openLoggedInPage(browser, '/production/plan');
    try {
      await client.page.evaluate(() => {
        window.__productionLiveIgnoreUntil = Date.now() + 350;
        if (typeof scheduleProductionLiveRefresh === 'function') {
          scheduleProductionLiveRefresh('sse', 0);
        }
      });

      await expect.poll(() => {
        return client.diagnostics.responses.filter(entry => (
          entry.method === 'GET'
          && /\/api\/production\/planning\/slice\?/i.test(entry.url || '')
          && /[?&]slice=plan(?:&|$)/i.test(entry.url || '')
        )).length;
      }).toBeGreaterThan(0);

      expectNoCriticalClientFailures(client.diagnostics, {
        ignoreConsolePatterns: IGNORE_LIVE_CONSOLE
      });
    } finally {
      await client.context.close();
    }
  });

  test('workspace live signal refreshes card flow state from server and does not apply card payload', async ({ browser }) => {
    const client = await openLoggedInPage(browser, '/workspace');
    try {
      const result = await signalFakeCardLivePayload(client.page);
      expect(result.hasCard).toBeTruthy();
      expect(result.handled).toBeTruthy();
      expect(result.markerApplied).toBeFalsy();

      await expect.poll(() => {
        return client.diagnostics.responses.filter(entry => (
          entry.method === 'GET'
          && /\/api\/cards-core\/[^/?#]+/i.test(entry.url || '')
        )).length;
      }).toBeGreaterThan(0);

      expectNoCriticalClientFailures(client.diagnostics, {
        ignoreConsolePatterns: IGNORE_LIVE_CONSOLE
      });
    } finally {
      await client.context.close();
    }
  });

  test('workspace cards:changed delayed by ignore window still refreshes server state', async ({ browser }) => {
    const client = await openLoggedInPage(browser, '/workspace');
    try {
      await client.page.evaluate(() => {
        window.__workspaceLiveIgnoreUntil = Date.now() + 350;
        if (typeof scheduleWorkspaceLiveRefresh === 'function') {
          scheduleWorkspaceLiveRefresh('sse', 0);
        }
      });

      await expect.poll(() => {
        return client.diagnostics.responses.filter(entry => (
          entry.method === 'GET'
          && /\/api\/data\?scope=production/i.test(entry.url || '')
        )).length;
      }).toBeGreaterThan(0);

      expectNoCriticalClientFailures(client.diagnostics, {
        ignoreConsolePatterns: IGNORE_LIVE_CONSOLE
      });
    } finally {
      await client.context.close();
    }
  });

  test('workspace detail comments modal updates from live server refresh', async ({ browser }) => {
    const clientA = await openLoggedInPage(browser, '/workspace');
    const clientB = await openLoggedInPage(browser, '/workspace');
    try {
      const target = await findWorkspaceCommentTarget(clientA.page);
      test.skip(!target?.opId || !target?.qr, 'Нет доступной операции для workspace comment live');
      const detailRoute = `/workspace/${encodeURIComponent(target.qr)}`;
      await Promise.all([
        openRouteAndAssert(clientA.page, {
          inputPath: detailRoute,
          expectedPath: detailRoute,
          pageId: 'page-workorders-card'
        }),
        openRouteAndAssert(clientB.page, {
          inputPath: detailRoute,
          expectedPath: detailRoute,
          pageId: 'page-workorders-card'
        })
      ]);
      resetDiagnostics(clientA.diagnostics);
      resetDiagnostics(clientB.diagnostics);

      await openWorkspaceCommentModal(clientA.page, target);
      await openWorkspaceCommentModal(clientB.page, target);

      const text = `Stage12 workspace live comment ${Date.now()}`;
      const response = await submitWorkspaceComment(clientA.page, text);
      expect(response.ok()).toBeTruthy();

      await expect.poll(() => {
        return clientB.diagnostics.responses.filter(entry => (
          entry.method === 'GET'
          && (
            /\/api\/cards-core\/[^/?#]+/i.test(entry.url || '')
            || /\/api\/data\?scope=production/i.test(entry.url || '')
          )
        )).length;
      }).toBeGreaterThan(0);
      await expect(clientB.page.locator('#op-comments-list')).toContainText(text);
      await expect.poll(() => new URL(clientA.page.url()).pathname).toBe(detailRoute);
      await expect.poll(() => new URL(clientB.page.url()).pathname).toBe(detailRoute);

      expectNoCriticalClientFailures(clientA.diagnostics, {
        ignoreConsolePatterns: IGNORE_LIVE_CONSOLE
      });
      expectNoCriticalClientFailures(clientB.diagnostics, {
        ignoreConsolePatterns: IGNORE_LIVE_CONSOLE
      });
    } finally {
      await clientA.context.close();
      await clientB.context.close();
    }
  });
});
