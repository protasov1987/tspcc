const { test, expect } = require('@playwright/test');
const { resetDatabaseFromSnapshot } = require('./helpers/snapshot');
const { restartServer, stopServer } = require('./helpers/server');
const { loadSnapshotDb } = require('./helpers/db');
const { createLoggedInClient, closeClients } = require('./helpers/multiclient');
const { waitUsableUi } = require('./helpers/navigation');
const { expectNoCriticalClientFailures, findConsoleEntries, resetDiagnostics } = require('./helpers/diagnostics');
const { baseURL } = require('./helpers/paths');

const CARDS_CONFLICT_IGNORE_CONSOLE_PATTERNS = [
  /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
  /^\[LIVE\]/i,
  /Не удалось загрузить данные с сервера/i,
  /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
];

function isCardsCoreDetailResponse(entry, card) {
  if (!entry || entry.method !== 'GET' || !entry.url.includes('/api/cards-core/')) return false;
  const cardId = encodeURIComponent(String(card?.id || '').trim());
  const cardQr = encodeURIComponent(String(card?.qrId || '').trim());
  return Boolean(
    (cardId && entry.url.includes(`/api/cards-core/${cardId}`))
    || (cardQr && entry.url.includes(`/api/cards-core/${cardQr}`))
  );
}

async function buildCardsClient(browser, routePath) {
  const client = await createLoggedInClient(browser, { baseURL, route: null });
  await client.page.goto(`${baseURL}${routePath}`, { waitUntil: 'domcontentloaded' });
  await waitUsableUi(client.page, {
    inputPath: routePath,
    expectedPath: routePath,
    pageId: 'page-cards-new'
  });
  await expect.poll(() => client.page.evaluate(() => (
    typeof isBackgroundHydrationInFlight === 'function'
      ? isBackgroundHydrationInFlight() === false
      : true
  ))).toBe(true);
  resetDiagnostics(client.diagnostics);
  return client;
}

test.describe.serial('cards core conflict control', () => {
  test.beforeAll(async () => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
  });

  test.afterAll(async () => {
    await stopServer();
  });

  test('keeps current card route and refreshes current card after stale generic edit conflict', async ({ browser }) => {
    test.setTimeout(180000);
    const db = loadSnapshotDb();
    const draftCard = (db.cards || []).find((card) => (
      card
      && !card.archived
      && card.approvalStage === 'DRAFT'
      && String(card.qrId || '').trim()
    ));
    test.skip(!draftCard, 'Нет подходящей карточки в статусе Draft для conflict-path');

    const routePath = `/card-route/${encodeURIComponent(draftCard.qrId)}`;
    const clients = [
      await buildCardsClient(browser, routePath),
      await buildCardsClient(browser, routePath)
    ];

    try {
      const clientA = clients[0];
      const clientB = clients[1];

      const initialState = await clientB.page.evaluate(() => {
        const activeId = typeof getActiveCardId === 'function' ? getActiveCardId() : null;
        const draft = typeof activeCardDraft !== 'undefined' ? activeCardDraft : null;
        const stored = activeId && typeof getCardStoreCard === 'function' ? getCardStoreCard(activeId) : null;
        return {
          activeId: String(activeId || '').trim(),
          draftRev: Number(draft?.rev || 0),
          storeRev: Number(stored?.rev || 0),
          desc: String(draft?.specialNotes || draft?.desc || '')
        };
      });
      expect(initialState.activeId).toBe(draftCard.id);
      expect(initialState.draftRev).toBeGreaterThan(0);
      expect(initialState.storeRev).toBeGreaterThan(0);

      const actorDescription = `Stage 3 conflict actor ${Date.now()}`;
      await clientA.page.fill('#card-desc', actorDescription);
      const clientASaveResponse = clientA.page.waitForResponse((response) => (
        response.request().method() === 'PUT'
        && response.url().includes(`/api/cards-core/${encodeURIComponent(draftCard.id)}`)
        && response.status() === 200
      ));
      await clientA.page.locator('#card-save-btn').dispatchEvent('click');
      await clientASaveResponse;
      await expect(clientA.page.locator('#toast-container .toast').last()).toContainText('Маршрутная карта сохранена.');
      await expect.poll(() => clientA.page.evaluate(() => window.location.pathname + window.location.search)).toBe('/cards');

      const actorLatestRev = await clientA.page.evaluate((cardId) => {
        if (typeof getCardStoreCard !== 'function') return 0;
        return Number(getCardStoreCard(cardId)?.rev || 0);
      }, draftCard.id);
      expect(actorLatestRev).toBeGreaterThan(initialState.storeRev);

      await expect.poll(() => clientB.page.evaluate((cardId) => {
        if (typeof getCardStoreCard !== 'function') return null;
        const stored = getCardStoreCard(cardId);
        const draft = typeof activeCardDraft !== 'undefined' ? activeCardDraft : null;
        return {
          storeRev: Number(stored?.rev || 0),
          draftRev: Number(draft?.rev || 0),
          draftDesc: String(draft?.specialNotes || draft?.desc || '')
        };
      }, draftCard.id)).toMatchObject({
        storeRev: expect.any(Number),
        draftRev: initialState.draftRev,
        draftDesc: initialState.desc
      });

      const detailResponsesBeforeConflict = clientB.diagnostics.responses.filter((entry) => (
        isCardsCoreDetailResponse(entry, draftCard)
      )).length;

      const staleDescription = `Stage 3 conflict stale ${Date.now()}`;
      await clientB.page.fill('#card-desc', staleDescription);
      const staleSaveResponse = clientB.page.waitForResponse((response) => (
        response.request().method() === 'PUT'
        && response.url().includes(`/api/cards-core/${encodeURIComponent(draftCard.id)}`)
        && response.status() === 409
      ));
      await clientB.page.locator('#card-save-btn').dispatchEvent('click');
      await staleSaveResponse;

      await expect(clientB.page.locator('#toast-container .toast').last()).toContainText('Карточка уже была изменена другим пользователем. Данные обновлены.');
      await expect.poll(() => clientB.page.evaluate(() => window.location.pathname + window.location.search)).toBe(routePath);
      await expect.poll(() => clientB.page.evaluate(() => window.__currentPageId || null)).toBe('page-cards-new');
      await expect.poll(() => clientB.page.evaluate((cardId) => {
        const draft = typeof activeCardDraft !== 'undefined' ? activeCardDraft : null;
        if (!draft || String(draft.id || '').trim() !== cardId) return null;
        return {
          rev: Number(draft.rev || 0),
          desc: String(draft.specialNotes || draft.desc || '')
        };
      }, draftCard.id)).toEqual({
        rev: actorLatestRev,
        desc: actorDescription
      });

      await expect.poll(() => {
        return clientB.diagnostics.responses.filter((entry) => isCardsCoreDetailResponse(entry, draftCard)).length;
      }).toBeGreaterThan(detailResponsesBeforeConflict);

      await expect.poll(() => {
        return clientB.diagnostics.responses.filter((entry) => (
          entry.method === 'PUT'
          && entry.status === 409
          && entry.url.includes(`/api/cards-core/${encodeURIComponent(draftCard.id)}`)
        )).length;
      }).toBeGreaterThan(0);

      await expect.poll(() => (
        findConsoleEntries(clientB.diagnostics, /^\[CONFLICT\] conflict detected/i).length
      )).toBeGreaterThan(0);

      expectNoCriticalClientFailures(clientA.diagnostics, {
        allow409: false,
        ignoreConsolePatterns: CARDS_CONFLICT_IGNORE_CONSOLE_PATTERNS
      });
      expectNoCriticalClientFailures(clientB.diagnostics, {
        allow409: true,
        ignoreConsolePatterns: CARDS_CONFLICT_IGNORE_CONSOLE_PATTERNS
      });
    } finally {
      await closeClients(clients);
    }
  });
});
