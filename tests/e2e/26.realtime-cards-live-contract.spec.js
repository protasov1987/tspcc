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

async function waitForCardsSse(page) {
  await expect.poll(() => page.evaluate(() => Boolean(window.cardsSseOnline || cardsSseOnline))).toBe(true);
}

async function createDraftCardViaApi(page, suffix) {
  return page.evaluate(async ({ suffix }) => {
    const response = await apiFetch('/api/cards-core', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        card: {
          cardType: 'MKI',
          qrId: `S12LIVE${suffix}`,
          routeCardNumber: `S12-LIVE-${suffix}`,
          name: `Stage 12 live card ${suffix}`,
          itemName: `Stage 12 live card ${suffix}`,
          quantity: 1,
          batchSize: 1,
          plannedCompletionDate: '2026-05-15',
          specialNotes: `created ${suffix}`,
          desc: `created ${suffix}`,
          operations: []
        }
      })
    });
    const payload = await response.json().catch(() => ({}));
    return {
      ok: response.ok,
      status: response.status,
      card: payload.card || null,
      payload
    };
  }, { suffix });
}

async function updateCardNoteViaApi(page, cardId, note) {
  return page.evaluate(async ({ cardId, note }) => {
    const detailResponse = await apiFetch('/api/cards-core/' + encodeURIComponent(cardId), {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'Accept': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });
    const detailPayload = await detailResponse.json().catch(() => ({}));
    const card = detailPayload.card || null;
    if (!detailResponse.ok || !card) {
      return { ok: false, status: detailResponse.status, payload: detailPayload };
    }
    const response = await apiFetch('/api/cards-core/' + encodeURIComponent(card.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedRev: card.rev,
        card: {
          ...card,
          specialNotes: note,
          desc: note
        }
      })
    });
    const payload = await response.json().catch(() => ({}));
    return {
      ok: response.ok,
      status: response.status,
      card: payload.card || null,
      payload
    };
  }, { cardId, note });
}

async function signalSyntheticCardsPayload(page, cardId) {
  return page.evaluate((cardId) => {
    const card = (Array.isArray(cards) ? cards : []).find(item => item && item.id === cardId);
    if (!card) return { hasCard: false, handled: false, markerApplied: false };
    const marker = `cards-live-payload-marker-${Date.now()}`;
    const handled = typeof applyServerEvent === 'function'
      ? applyServerEvent({
        entity: 'card',
        action: 'updated',
        id: card.id,
        rev: Number(card.rev || 1) + 100,
        card: {
          ...JSON.parse(JSON.stringify(card)),
          __stage12CardsLivePayloadMarker: marker,
          specialNotes: marker,
          desc: marker
        }
      })
      : false;
    const stored = (Array.isArray(cards) ? cards : []).find(item => item && item.id === cardId);
    return {
      hasCard: true,
      handled,
      markerApplied: stored?.__stage12CardsLivePayloadMarker === marker || stored?.specialNotes === marker
    };
  }, cardId);
}

test.describe.serial('cards realtime server-refresh contract', () => {
  test.beforeAll(async () => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
  });

  test.afterAll(async () => {
    await stopServer();
  });

  test('refreshes cards list and deeplink detail from server in another client', async ({ browser }) => {
    test.setTimeout(180000);
    const clientA = await openLoggedInPage(browser, '/cards');
    const clientB = await openLoggedInPage(browser, '/cards');
    const clientAReads = [];
    clientA.page.on('request', (request) => {
      if (request.method() !== 'GET') return;
      const url = request.url();
      if (!/\/api\/(?:cards-core|cards-live)/i.test(url)) return;
      clientAReads.push({
        url,
        headers: request.headers()
      });
    });

    try {
      await Promise.all([
        waitForCardsSse(clientA.page),
        waitForCardsSse(clientB.page)
      ]);
      const suffix = String(Date.now()).slice(-7);
      await clientA.page.fill('#cards-search', `S12-LIVE-${suffix}`);
      await expect.poll(() => clientA.diagnostics.responses.filter(entry => (
        entry.method === 'GET'
        && /\/api\/cards-core(?:\?|$)/i.test(entry.url || '')
      )).length).toBeGreaterThan(0);
      resetDiagnostics(clientA.diagnostics);
      clientAReads.length = 0;

      const created = await createDraftCardViaApi(clientB.page, suffix);
      expect(created.ok, JSON.stringify(created)).toBeTruthy();
      expect(created.card?.id).toBeTruthy();
      expect(created.card?.qrId).toBeTruthy();

      await expect.poll(() => clientA.diagnostics.responses.filter(entry => (
        entry.method === 'GET'
        && /\/api\/cards-core\/[^/?#]+/i.test(entry.url || '')
      )).length).toBeGreaterThan(0);
      await expect(clientA.page.locator('#app-main')).toContainText(`S12-LIVE-${suffix}`);
      expect(clientAReads.some(entry => (
        /\/api\/cards-core\/[^/?#]+/i.test(entry.url)
        && String(entry.headers['cache-control'] || '').toLowerCase().includes('no-cache')
      ))).toBeTruthy();

      const detailRoute = `/card-route/${encodeURIComponent(created.card.qrId)}`;
      await Promise.all([
        openRouteAndAssert(clientA.page, {
          inputPath: detailRoute,
          expectedPath: detailRoute,
          pageId: 'page-cards-new'
        }),
        openRouteAndAssert(clientB.page, {
          inputPath: detailRoute,
          expectedPath: detailRoute,
          pageId: 'page-cards-new'
        })
      ]);
      await Promise.all([
        waitForCardsSse(clientA.page),
        waitForCardsSse(clientB.page)
      ]);
      resetDiagnostics(clientA.diagnostics);
      clientAReads.length = 0;

      const synthetic = await signalSyntheticCardsPayload(clientA.page, created.card.id);
      expect(synthetic.hasCard).toBeTruthy();
      expect(synthetic.handled).toBeTruthy();
      expect(synthetic.markerApplied).toBeFalsy();
      await expect.poll(() => clientA.diagnostics.responses.filter(entry => (
        entry.method === 'GET'
        && new RegExp(`/api/cards-core/${encodeURIComponent(created.card.id)}`, 'i').test(entry.url || '')
      )).length).toBeGreaterThan(0);
      await expect(clientA.page.locator('#card-desc')).not.toHaveValue(/cards-live-payload-marker/);

      resetDiagnostics(clientA.diagnostics);
      clientAReads.length = 0;

      const note = `updated from second tab ${Date.now()}`;
      const updated = await updateCardNoteViaApi(clientB.page, created.card.id, note);
      expect(updated.ok, JSON.stringify(updated)).toBeTruthy();

      await expect.poll(() => clientA.diagnostics.responses.filter(entry => (
        entry.method === 'GET'
        && new RegExp(`/api/cards-core/${encodeURIComponent(created.card.id)}`, 'i').test(entry.url || '')
      )).length).toBeGreaterThan(0);
      await expect(clientA.page.locator('#card-desc')).toHaveValue(note);
      await expect.poll(() => new URL(clientA.page.url()).pathname).toBe(detailRoute);
      expect(clientAReads.some(entry => (
        /\/api\/cards-core\/[^/?#]+/i.test(entry.url)
        && String(entry.headers['cache-control'] || '').toLowerCase().includes('no-cache')
      ))).toBeTruthy();

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
