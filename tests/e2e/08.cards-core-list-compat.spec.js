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

    expect(reads.some((entry) => /\/api\/cards-core(\?|$)/.test(entry.url) && entry.url.includes('archived=active'))).toBe(true);
    expect(reads.some((entry) => /\/api\/data\?scope=cards-basic(&|$)/.test(entry.url))).toBe(false);
    const firstPrimaryRead = reads.find((entry) => (
      /\/api\/cards-core(\?|$)/.test(entry.url)
      || /\/api\/data\?scope=cards-basic(&|$)/.test(entry.url)
    ));
    expect(firstPrimaryRead?.url || '').toContain('/api/cards-core');

    const queryTerm = String(candidate.routeCardNumber || candidate.qrId || '').trim();
    const cardsBasicReadsBeforeQuery = reads.filter((entry) => /\/api\/data\?scope=cards-basic(&|$)/.test(entry.url)).length;
    const queryResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'GET'
      && response.url().includes('/api/cards-core')
      && response.url().includes('archived=active')
      && response.url().includes(`q=${encodeURIComponent(queryTerm)}`)
      && response.status() === 200
    ));
    await page.fill('#cards-search', queryTerm);
    await queryResponsePromise;

    const candidateRow = page.locator(`tr[data-card-id="${candidate.id}"]`);
    await expect(candidateRow).toBeVisible();
    await expect(candidateRow).toContainText(queryTerm);
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

    await openRouteAndAssert(page, '/archive');
    const archivedRow = page.locator(`.wo-card[data-card-id="${candidate.id}"]`);
    await expect(archivedRow).toBeVisible();
    if (candidate.routeCardNumber) {
      await expect(archivedRow).toContainText(candidate.routeCardNumber);
    }

    await openRouteAndAssert(page, '/workorders');
    await expect(page.locator(`.wo-card[data-card-id="${candidate.id}"]`)).toHaveCount(0);

    await openRouteAndAssert(page, '/items');
    await openRouteAndAssert(page, '/ok');
    await openRouteAndAssert(page, '/oc');

    expectNoCriticalClientFailures(diagnostics, {
      ignoreConsolePatterns: IGNORE_CONSOLE_PATTERNS
    });
  });
});
