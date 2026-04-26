const { test, expect } = require('@playwright/test');
const { resetDatabaseFromSnapshot } = require('./helpers/snapshot');
const { restartServer, stopServer } = require('./helpers/server');
const { attachDiagnostics, expectNoCriticalClientFailures } = require('./helpers/diagnostics');
const { loginAsAbyss } = require('./helpers/auth');
const { openRouteAndAssert, waitUsableUi } = require('./helpers/navigation');
const { loadSnapshotDb } = require('./helpers/db');

const IGNORE_CONSOLE_PATTERNS = [
  /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
  /^\[LIVE\]/i,
  /^\[PRODUCTION\] areas layout load failed TypeError: Failed to fetch/i,
  /Не удалось загрузить данные с сервера/i,
  /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
];

test.describe.serial('cards core list and derived compatibility', () => {
  test.beforeEach(async () => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
  });

  test.afterAll(async () => {
    await stopServer();
  });

  test('loads /cards list and query from cards core and refreshes list after update', async ({ page }) => {
    test.setTimeout(180000);
    const diagnostics = attachDiagnostics(page);
    const db = loadSnapshotDb();
    const candidate = (db.cards || []).find((card) => (
      card
      && !card.archived
      && card.cardType === 'MKI'
      && card.approvalStage === 'DRAFT'
      && String(card.qrId || '').trim()
      && String(card.routeCardNumber || '').trim()
    ));

    expect(candidate?.id).toBeTruthy();
    expect(candidate?.qrId).toBeTruthy();

    const reads = [];
    page.on('request', (request) => {
      if (request.method() !== 'GET') return;
      const url = request.url();
      if (!url.includes('/api/cards-core') && !url.includes('/api/data')) return;
      reads.push({ url, at: Date.now() });
    });

    await loginAsAbyss(page, { startPath: '/cards' });
    await waitUsableUi(page, '/cards');
    await expect.poll(() => page.locator('#cards-search').evaluate((el) => el?.dataset?.boundSearch || '')).toBe('1');

    expect(reads.some((entry) => /\/api\/cards-core(\?|$)/.test(entry.url) && entry.url.includes('archived=active'))).toBe(true);
    expect(reads.some((entry) => /\/api\/data\?scope=cards-basic(&|$)/.test(entry.url))).toBe(false);
    const firstPrimaryRead = reads.find((entry) => (
      /\/api\/cards-core(\?|$)/.test(entry.url)
      || /\/api\/data\?scope=cards-basic(&|$)/.test(entry.url)
    ));
    expect(firstPrimaryRead?.url || '').toContain('/api/cards-core');

    const queryTerm = String(candidate.routeCardNumber || candidate.qrId || '').trim();
    const cardsBasicReadsBeforeQuery = reads.filter((entry) => /\/api\/data\?scope=cards-basic(&|$)/.test(entry.url)).length;
    await page.fill('#cards-search', queryTerm);

    const candidateRow = page.locator(`tr[data-card-id="${candidate.id}"]`);
    await expect(candidateRow).toBeVisible();
    await expect(candidateRow).toContainText(queryTerm);
    await expect.poll(() => page.evaluate((term) => (
      typeof hasCardsCoreListLoaded === 'function'
      && hasCardsCoreListLoaded({ archived: 'active', q: term })
    ), queryTerm)).toBe(true);
    expect(reads.filter((entry) => /\/api\/data\?scope=cards-basic(&|$)/.test(entry.url)).length).toBe(cardsBasicReadsBeforeQuery);

    await openRouteAndAssert(page, {
      inputPath: `/card-route/${encodeURIComponent(candidate.qrId)}`,
      expectedPath: `/card-route/${encodeURIComponent(candidate.qrId)}`,
      pageId: 'page-cards-new'
    });
    await expect.poll(() => page.evaluate(() => (
      typeof isBackgroundHydrationInFlight === 'function'
        ? isBackgroundHydrationInFlight() === false
        : true
    ))).toBe(true);
    const plannedCompletionInput = page.locator('#card-planned-completion-date');
    if ((await plannedCompletionInput.inputValue()).trim() === '') {
      await plannedCompletionInput.fill('2026-05-20');
    }

    const updatedName = `Stage3 batch6 ${Date.now()}`;
    await page.fill('#card-name', updatedName);
    const updateResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'PUT'
      && response.url().includes(`/api/cards-core/${encodeURIComponent(candidate.id)}`)
      && response.status() === 200
    ));
    await page.locator('#card-save-btn').dispatchEvent('click');
    await updateResponsePromise;

    await waitUsableUi(page, '/cards');
    await expect(page.locator(`tr[data-card-id="${candidate.id}"]`)).toContainText(updatedName);
    expect(reads.some((entry) => /\/api\/data\?scope=cards-basic(&|$)/.test(entry.url))).toBe(false);

    expectNoCriticalClientFailures(diagnostics, {
      ignoreConsolePatterns: IGNORE_CONSOLE_PATTERNS
    });
  });

  test('keeps /workorders and /archive consistent after archive through cards core', async ({ page }) => {
    test.setTimeout(180000);
    const diagnostics = attachDiagnostics(page);
    const reads = [];
    page.on('request', (request) => {
      if (request.method() !== 'GET') return;
      const url = request.url();
      if (!url.includes('/api/cards-core') && !url.includes('/api/data')) return;
      reads.push({ method: request.method(), url });
    });

    await loginAsAbyss(page, { startPath: '/workorders' });
    await waitUsableUi(page, '/workorders');

    const archiveButton = page.locator('.archive-move-btn').first();
    await expect(archiveButton).toBeVisible();
    const candidate = await archiveButton.evaluate((btn) => {
      const detail = btn.closest('.wo-card');
      const cardId = String(detail?.dataset?.cardId || '').trim();
      const cardList = typeof cards !== 'undefined' && Array.isArray(cards) ? cards : [];
      const card = cardList.find((entry) => String(entry?.id || '').trim() === cardId) || null;
      return {
        id: cardId,
        qrId: String(card?.qrId || '').trim(),
        routeCardNumber: String(card?.routeCardNumber || '').trim()
      };
    });

    expect(candidate?.id).toBeTruthy();
    expect(candidate?.qrId).toBeTruthy();

    const archiveResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && response.url().includes(`/api/cards-core/${encodeURIComponent(candidate.id)}/archive`)
      && response.status() === 200
    ));
    await archiveButton.click();
    await archiveResponsePromise;
    await expect(page.locator(`.wo-card[data-card-id="${candidate.id}"]`)).toHaveCount(0);

    const archiveReadsBeforeOpen = reads.length;
    await openRouteAndAssert(page, '/archive');
    await expect.poll(() => reads.slice(archiveReadsBeforeOpen).some((entry) => (
      /\/api\/cards-core(\?|$)/.test(entry.url)
      && entry.url.includes('archived=only')
    ))).toBe(true);
    expect(reads.slice(archiveReadsBeforeOpen).some((entry) => /\/api\/data\?scope=cards-basic(&|$)/.test(entry.url))).toBe(false);

    const archivedRow = page.locator(`.wo-card[data-card-id="${candidate.id}"]`);
    await expect(archivedRow).toBeVisible();
    if (candidate.routeCardNumber) {
      await expect(archivedRow).toContainText(candidate.routeCardNumber);
    }

    const detailRoute = `/archive/${encodeURIComponent(candidate.qrId)}`;
    await archivedRow.locator('summary').click();
    await waitUsableUi(page, {
      inputPath: detailRoute,
      expectedPath: detailRoute,
      pageId: 'page-archive-card'
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitUsableUi(page, {
      inputPath: detailRoute,
      expectedPath: detailRoute,
      pageId: 'page-archive-card'
    });
    await openRouteAndAssert(page, '/archive');
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await waitUsableUi(page, {
      inputPath: detailRoute,
      expectedPath: detailRoute,
      pageId: 'page-archive-card'
    });
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await waitUsableUi(page, '/archive');
    await page.goForward({ waitUntil: 'domcontentloaded' });
    await waitUsableUi(page, {
      inputPath: detailRoute,
      expectedPath: detailRoute,
      pageId: 'page-archive-card'
    });

    await openRouteAndAssert(page, '/workorders');
    await expect(page.locator(`.wo-card[data-card-id="${candidate.id}"]`)).toHaveCount(0);

    await openRouteAndAssert(page, '/items');
    await openRouteAndAssert(page, '/ok');
    await openRouteAndAssert(page, '/oc');

    expectNoCriticalClientFailures(diagnostics, {
      ignoreConsolePatterns: IGNORE_CONSOLE_PATTERNS
    });
  });

  test('keeps /items, /ok and /oc as flow-derived read-only views', async ({ page }) => {
    test.setTimeout(180000);
    const diagnostics = attachDiagnostics(page);
    const dataRequests = [];
    const legacyDataWrites = [];

    page.on('request', (request) => {
      const url = request.url();
      if (!url.includes('/api/data')) return;
      const entry = { method: request.method(), url };
      dataRequests.push(entry);
      if (request.method() !== 'GET') {
        legacyDataWrites.push(entry);
      }
    });

    await loginAsAbyss(page, { startPath: '/items' });
    await waitUsableUi(page, '/items');
    await expect.poll(() => dataRequests.some((entry) => (
      entry.method === 'GET' && /[?&]scope=production\b/.test(entry.url)
    ))).toBe(true);

    for (const route of ['/items', '/ok', '/oc']) {
      await openRouteAndAssert(page, route);
      await expect(page.locator('#items-table-wrapper table')).toBeVisible();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitUsableUi(page, route);
      await expect(page.locator('#items-table-wrapper table')).toBeVisible();
    }

    await openRouteAndAssert(page, '/items');
    const sourceTarget = await page.evaluate(() => {
      const cardList = typeof getItemsPageReadModelCards === 'function'
        ? getItemsPageReadModelCards(getItemsPageConfig('/items'))
        : (typeof cards !== 'undefined' && Array.isArray(cards) ? cards : []);
      for (const card of cardList) {
        if (!card || !card.id || !card.flow || !Number.isFinite(Number(card.flow.version))) continue;
        const op = (card.operations || []).find((item) => item && item.id);
        const routeCardNumber = String(card.routeCardNumber || card.orderNo || '').trim();
        if (!op?.id || !routeCardNumber) continue;
        return {
          cardId: card.id,
          opId: op.id,
          routeCardNumber,
          flowVersion: Number(card.flow.version)
        };
      }
      return null;
    });
    expect(sourceTarget?.cardId).toBeTruthy();

    const updatedFlowVersion = await page.evaluate(async (target) => {
      const response = await apiFetch('/api/production/operation/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cardId: target.cardId,
          opId: target.opId,
          expectedFlowVersion: target.flowVersion,
          source: 'stage10-items-read-model-test',
          text: `Stage10 items flow consistency ${Date.now()}`
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || body.message || `HTTP ${response.status}`);
      }
      return Number(body.flowVersion);
    }, sourceTarget);
    expect(updatedFlowVersion).toBe(sourceTarget.flowVersion + 1);

    await page.evaluate(async () => {
      await loadDataWithScope({
        scope: DATA_SCOPE_PRODUCTION,
        force: true,
        reason: 'stage10-items-flow-consistency'
      });
      renderItemsPage();
    });
    await expect.poll(() => page.evaluate((cardId) => {
      const card = cards.find((item) => item && item.id === cardId);
      return Number(card?.flow?.version || 0);
    }, sourceTarget.cardId)).toBe(updatedFlowVersion);

    const legacyWritesBeforeUiState = legacyDataWrites.length;
    await page.fill('#items-search', sourceTarget.routeCardNumber);
    await expect(page.locator('#items-table-wrapper')).toContainText(sourceTarget.routeCardNumber);
    await page.selectOption('#items-status-filter', 'PENDING');
    await page.locator('#items-date-from-native').fill('2026-01-01');
    await page.locator('#items-date-from-native').dispatchEvent('change');
    await page.locator('#items-date-to-native').fill('2099-12-31');
    await page.locator('#items-date-to-native').dispatchEvent('change');
    await page.locator('th.th-sortable[data-sort-key="route"]').click();
    const nextPage = page.locator('.items-page-pagination-btn[data-page]:not([disabled])').last();
    if (await nextPage.count()) {
      await nextPage.click();
    }
    expect(legacyDataWrites.length).toBe(legacyWritesBeforeUiState);

    await page.fill('#items-search', '');
    await page.selectOption('#items-status-filter', 'ALL');
    await page.locator('#items-date-from-native').fill('');
    await page.locator('#items-date-from-native').dispatchEvent('change');
    await page.locator('#items-date-to-native').fill('');
    await page.locator('#items-date-to-native').dispatchEvent('change');
    await expect(page.locator('.items-page-route-cell[data-route]').first()).toBeVisible();
    const detailRoute = await page.locator('.items-page-route-cell[data-route]').first().getAttribute('data-route');
    expect(detailRoute).toMatch(/^\/(workorders|archive)\/[^/]+$/);
    await page.locator('.items-page-route-cell[data-route]').first().dblclick();
    await waitUsableUi(page, {
      inputPath: detailRoute,
      expectedPath: detailRoute,
      pageId: detailRoute.startsWith('/archive/') ? 'page-archive-card' : 'page-workorders-card'
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitUsableUi(page, {
      inputPath: detailRoute,
      expectedPath: detailRoute,
      pageId: detailRoute.startsWith('/archive/') ? 'page-archive-card' : 'page-workorders-card'
    });
    expect(legacyDataWrites.length).toBe(legacyWritesBeforeUiState);

    expectNoCriticalClientFailures(diagnostics, {
      ignoreConsolePatterns: IGNORE_CONSOLE_PATTERNS
    });
  });
});
