const { test, expect } = require('@playwright/test');
const { resetDatabaseFromSnapshot } = require('./helpers/snapshot');
const { restartServer, stopServer } = require('./helpers/server');
const { attachDiagnostics, expectNoCriticalClientFailures } = require('./helpers/diagnostics');
const { loginAsAbyss } = require('./helpers/auth');
const { openRouteAndAssert, waitUsableUi } = require('./helpers/navigation');
const { loadSnapshotDb, getStage1RouteFixture } = require('./helpers/db');

test.describe.serial('cards core routes', () => {
  test.beforeAll(async () => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
  });

  test.afterAll(async () => {
    await stopServer();
  });

  test('uses cards core for detail/create/update and keeps detail routes stable', async ({ page }) => {
    test.setTimeout(180000);
    const diagnostics = attachDiagnostics(page);
    const db = loadSnapshotDb();
    const fixture = getStage1RouteFixture(db);
    const existingCard = fixture.routeCard;

    expect(existingCard?.id).toBeTruthy();
    expect(existingCard?.qrId).toBeTruthy();

    const writes = [];
    page.on('request', (request) => {
      if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) return;
      const url = request.url();
      if (!url.includes('/api/cards-core') && !url.includes('/api/data')) return;
      writes.push({
        method: request.method(),
        url
      });
    });

    await loginAsAbyss(page, {
      startPath: `/cards/${encodeURIComponent(existingCard.id)}`
    });

    const existingDetailRoute = {
      inputPath: `/cards/${encodeURIComponent(existingCard.id)}`,
      expectedPath: `/cards/${encodeURIComponent(existingCard.qrId)}`,
      pageId: 'page-cards-new'
    };
    await waitUsableUi(page, existingDetailRoute);
    await expect(page.locator('#card-route-number')).toHaveValue(String(existingCard.routeCardNumber || existingCard.orderNo || ''));

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitUsableUi(page, existingDetailRoute);

    const cardRouteSpec = {
      inputPath: `/card-route/${encodeURIComponent(existingCard.qrId)}`,
      expectedPath: `/card-route/${encodeURIComponent(existingCard.qrId)}`,
      pageId: 'page-cards-new'
    };
    await openRouteAndAssert(page, cardRouteSpec);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitUsableUi(page, cardRouteSpec);

    await openRouteAndAssert(page, '/cards/new');
    await expect.poll(() => page.evaluate(() => (
      typeof isBackgroundHydrationInFlight === 'function'
        ? isBackgroundHydrationInFlight() === false
        : true
    ))).toBe(true);
    const suffix = String(Date.now()).slice(-6);
    const draftRouteNumber = `E2E-S3-${suffix}`;
    const draftName = `Stage 3 UI card ${suffix}`;
    const createdDescription = `Stage 3 create ${suffix}`;
    const updatedDescription = `Stage 3 update ${suffix}`;

    await page.fill('#card-route-number', draftRouteNumber);
    await page.fill('#card-name', draftName);
    await page.fill('#card-planned-completion-date', '2026-05-15');
    await page.evaluate(() => {
      const qtyInput = document.getElementById('card-qty');
      if (!qtyInput) return;
      qtyInput.value = '1';
      qtyInput.dispatchEvent(new Event('input', { bubbles: true }));
      qtyInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.fill('#card-desc', createdDescription);

    const legacyWritesBeforeCreate = writes.filter((entry) => entry.url.includes('/api/data')).length;
    const cardsCoreWritesBeforeCreate = writes.filter((entry) => entry.url.includes('/api/cards-core')).length;
    const createResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && response.url().includes('/api/cards-core')
      && response.status() === 201
    ));
    await page.locator('#card-save-btn').dispatchEvent('click');
    await createResponsePromise;

    await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).not.toBe('/cards/new');
    const createdDetailPath = await page.evaluate(() => window.location.pathname + window.location.search);
    await waitUsableUi(page, {
      inputPath: createdDetailPath,
      expectedPath: createdDetailPath,
      pageId: 'page-cards-new'
    });
    await expect(page.locator('#card-route-number')).toHaveValue(draftRouteNumber);
    await expect(page.locator('#card-desc')).toHaveValue(createdDescription);
    expect(writes.filter((entry) => entry.url.includes('/api/data')).length).toBe(legacyWritesBeforeCreate);
    expect(writes.filter((entry) => entry.url.includes('/api/cards-core')).length).toBeGreaterThan(cardsCoreWritesBeforeCreate);

    await page.fill('#card-desc', updatedDescription);
    const legacyWritesBeforeUpdate = writes.filter((entry) => entry.url.includes('/api/data')).length;
    const cardsCoreWritesBeforeUpdate = writes.filter((entry) => entry.url.includes('/api/cards-core')).length;
    const updateResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'PUT'
      && response.url().includes('/api/cards-core/')
      && response.status() === 200
    ));
    await page.locator('#card-save-btn').dispatchEvent('click');
    await updateResponsePromise;

    await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe(createdDetailPath);
    await expect(page.locator('#card-desc')).toHaveValue(updatedDescription);
    expect(writes.filter((entry) => entry.url.includes('/api/data')).length).toBe(legacyWritesBeforeUpdate);
    expect(writes.filter((entry) => entry.url.includes('/api/cards-core')).length).toBeGreaterThan(cardsCoreWritesBeforeUpdate);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitUsableUi(page, {
      inputPath: createdDetailPath,
      expectedPath: createdDetailPath,
      pageId: 'page-cards-new'
    });
    await expect(page.locator('#card-route-number')).toHaveValue(draftRouteNumber);
    await expect(page.locator('#card-desc')).toHaveValue(updatedDescription);

    await page.goto(createdDetailPath, { waitUntil: 'domcontentloaded' });
    await waitUsableUi(page, {
      inputPath: createdDetailPath,
      expectedPath: createdDetailPath,
      pageId: 'page-cards-new'
    });

    expectNoCriticalClientFailures(diagnostics, {
      ignoreConsolePatterns: [
        /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
        /^\[LIVE\]/i,
        /Не удалось загрузить данные с сервера/i,
        /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
      ]
    });
  });

  test('keeps newer card revision when a stale legacy payload arrives before save', async ({ page }) => {
    test.setTimeout(180000);
    const diagnostics = attachDiagnostics(page);
    await loginAsAbyss(page, {
      startPath: '/cards/new'
    });

    await openRouteAndAssert(page, '/cards/new');
    await expect.poll(() => page.evaluate(() => (
      typeof isBackgroundHydrationInFlight === 'function'
        ? isBackgroundHydrationInFlight() === false
        : true
    ))).toBe(true);

    const suffix = String(Date.now()).slice(-6);
    const draftRouteNumber = `E2E-S3-STALE-${suffix}`;
    const draftName = `Stage 3 stale draft ${suffix}`;
    const createdDescription = `Stage 3 stale create ${suffix}`;

    await page.fill('#card-route-number', draftRouteNumber);
    await page.fill('#card-name', draftName);
    await page.fill('#card-planned-completion-date', '2026-05-16');
    await page.evaluate(() => {
      const qtyInput = document.getElementById('card-qty');
      if (!qtyInput) return;
      qtyInput.value = '1';
      qtyInput.dispatchEvent(new Event('input', { bubbles: true }));
      qtyInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.fill('#card-desc', createdDescription);

    const createResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && response.url().includes('/api/cards-core')
      && response.status() === 201
    ));
    await page.locator('#card-save-btn').dispatchEvent('click');
    await createResponsePromise;

    const createdDetailPath = await page.evaluate(() => window.location.pathname + window.location.search);
    await waitUsableUi(page, {
      inputPath: createdDetailPath,
      expectedPath: createdDetailPath,
      pageId: 'page-cards-new'
    });

    const activeCardId = await page.evaluate(() => (
      typeof getActiveCardId === 'function' ? getActiveCardId() : null
    ));
    expect(activeCardId).toBeTruthy();

    const preparedDescription = `Stage 3 stale prep ${suffix}`;
    await page.fill('#card-desc', preparedDescription);
    const prepUpdateResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'PUT'
      && response.url().includes(`/api/cards-core/${encodeURIComponent(activeCardId)}`)
      && response.status() === 200
    ));
    await page.locator('#card-save-btn').dispatchEvent('click');
    await prepUpdateResponsePromise;
    await expect(page.locator('#card-desc')).toHaveValue(preparedDescription);

    const initialState = await page.evaluate((cardId) => {
      if (typeof getCardStoreCard !== 'function') return null;
      const card = getCardStoreCard(cardId);
      if (!card) return null;
      return {
        id: String(card.id || '').trim(),
        rev: Number(card.rev || 0),
        desc: String(card.specialNotes || card.desc || '')
      };
    }, activeCardId);
    expect(initialState).toBeTruthy();
    expect(initialState.rev).toBeGreaterThan(1);
    expect(initialState.desc).toBe(preparedDescription);

    const mergedState = await page.evaluate(({ cardId }) => {
      if (typeof getCardStoreCard !== 'function' || typeof applyLoadedDataPayload !== 'function') {
        return null;
      }
      const currentCards = Array.isArray(cards) ? cards : [];
      const currentCard = getCardStoreCard(cardId);
      if (!currentCard) return null;
      const staleRev = Math.max(1, Number(currentCard.rev || 1) - 1);
      const staleCards = currentCards.map((card) => {
        if (!card || String(card.id || '').trim() !== cardId) return card;
        return {
          ...card,
          rev: staleRev,
          specialNotes: 'STALE_PAYLOAD_SHOULD_NOT_WIN',
          desc: 'STALE_PAYLOAD_SHOULD_NOT_WIN'
        };
      });
      applyLoadedDataPayload({
        scope: 'cards-basic',
        cards: staleCards,
        ops,
        centers,
        areas
      }, {
        scope: 'cards-basic'
      });
      const mergedCard = getCardStoreCard(cardId);
      return mergedCard ? {
        rev: Number(mergedCard.rev || 0),
        desc: String(mergedCard.specialNotes || mergedCard.desc || '')
      } : null;
    }, { cardId: activeCardId });

    expect(mergedState).toBeTruthy();
    expect(mergedState.rev).toBe(initialState.rev);
    expect(mergedState.desc).toBe(initialState.desc);

    const updatedDescription = `Stage 3 stale payload regression ${Date.now()}`;
    await page.fill('#card-desc', updatedDescription);

    const updateResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'PUT'
      && response.url().includes(`/api/cards-core/${encodeURIComponent(activeCardId)}`)
      && response.status() === 200
    ));
    await page.locator('#card-save-btn').dispatchEvent('click');
    await updateResponsePromise;

    await expect(page.locator('#card-desc')).toHaveValue(updatedDescription);
    await expect.poll(() => page.evaluate((cardId) => {
      if (typeof getCardStoreCard !== 'function') return 0;
      return Number(getCardStoreCard(cardId)?.rev || 0);
    }, activeCardId)).toBeGreaterThan(initialState.rev);

    expectNoCriticalClientFailures(diagnostics, {
      ignoreConsolePatterns: [
        /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
        /^\[LIVE\]/i,
        /Не удалось загрузить данные с сервера/i,
        /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
      ],
      ignorePageErrors: [
        /ResizeObserver loop completed with undelivered notifications/i
      ]
    });
  });
});
