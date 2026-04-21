const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { resetDatabaseFromSnapshot } = require('./helpers/snapshot');
const { restartServer, stopServer } = require('./helpers/server');
const { attachDiagnostics, expectNoCriticalClientFailures } = require('./helpers/diagnostics');
const { loginAsAbyss } = require('./helpers/auth');
const { openRouteAndAssert, waitUsableUi } = require('./helpers/navigation');
const { loadSnapshotDb } = require('./helpers/db');
const { dataDbPath } = require('./helpers/paths');

const IGNORE_CONSOLE_PATTERNS = [
  /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
  /^\[LIVE\]/i,
  /Не удалось загрузить данные с сервера/i,
  /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
];

test.describe.serial('cards core lifecycle operations', () => {
  test.beforeEach(async () => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
  });

  test.afterAll(async () => {
    await stopServer();
  });

  test('archives active workorder card and repeats archived card through cards core API', async ({ page }) => {
    test.setTimeout(180000);
    const diagnostics = attachDiagnostics(page);
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

    await loginAsAbyss(page, { startPath: '/workorders' });
    await waitUsableUi(page, '/workorders');

    const archiveButton = page.locator('.archive-move-btn').first();
    await expect(archiveButton).toBeVisible();
    const archiveCandidate = await archiveButton.evaluate((btn) => {
      const detail = btn.closest('.wo-card');
      const cardId = String(detail?.dataset?.cardId || '').trim();
      const cardList = typeof cards !== 'undefined' && Array.isArray(cards) ? cards : [];
      const card = cardList.find((entry) => String(entry?.id || '').trim() === cardId) || null;
      return {
        id: cardId,
        qrId: String(card?.qrId || '').trim(),
        routeCardNumber: String(card?.routeCardNumber || '').trim(),
        name: String(card?.name || card?.itemName || '').trim()
      };
    });

    const legacyWritesBeforeArchive = writes.filter((entry) => entry.url.includes('/api/data')).length;
    const cardsCoreWritesBeforeArchive = writes.filter((entry) => entry.url.includes('/api/cards-core')).length;
    const archiveResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && response.url().includes(`/api/cards-core/${encodeURIComponent(archiveCandidate.id)}/archive`)
      && response.status() === 200
    ));
    await archiveButton.click();
    const archiveResponse = await archiveResponsePromise;
    const archiveBody = await archiveResponse.json();

    expect(archiveBody?.card?.id).toBe(archiveCandidate.id);
    expect(archiveBody?.card?.archived).toBe(true);
    await expect(page.locator('#toast-container .toast').last()).toContainText('Карта перенесена в архив');
    expect(writes.filter((entry) => entry.url.includes('/api/data')).length).toBe(legacyWritesBeforeArchive);
    expect(writes.filter((entry) => entry.url.includes('/api/cards-core')).length).toBeGreaterThan(cardsCoreWritesBeforeArchive);

    await expect.poll(() => page.evaluate((cardId) => {
      if (typeof getCardStoreCard !== 'function') return false;
      return Boolean(getCardStoreCard(cardId)?.archived);
    }, archiveCandidate.id)).toBe(true);

    await openRouteAndAssert(page, '/archive');
    const archivedRow = page.locator(`.wo-card[data-card-id="${archiveCandidate.id}"]`);
    await expect(archivedRow).toBeVisible();
    if (archiveCandidate.routeCardNumber) {
      await expect(archivedRow).toContainText(archiveCandidate.routeCardNumber);
    }

    const legacyWritesBeforeRepeat = writes.filter((entry) => entry.url.includes('/api/data')).length;
    const cardsCoreWritesBeforeRepeat = writes.filter((entry) => entry.url.includes('/api/cards-core')).length;
    const repeatResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && response.url().includes(`/api/cards-core/${encodeURIComponent(archiveCandidate.id)}/repeat`)
      && response.status() === 201
    ));
    await page.locator(`.wo-card[data-card-id="${archiveCandidate.id}"] .repeat-card-btn`).click();
    const repeatResponse = await repeatResponsePromise;
    const repeatBody = await repeatResponse.json();
    const repeatedCard = repeatBody?.card || null;

    expect(repeatedCard?.id).toBeTruthy();
    expect(repeatedCard?.id).not.toBe(archiveCandidate.id);
    expect(repeatedCard?.archived).toBeFalsy();
    expect(repeatedCard?.approvalStage).toBe('DRAFT');
    expect(repeatedCard?.qrId).toBeTruthy();

    await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe(
      `/cards/${encodeURIComponent(repeatedCard.qrId)}`
    );
    await expect.poll(() => page.evaluate(() => window.__currentPageId || null)).toBe('page-cards-new');
    expect(writes.filter((entry) => entry.url.includes('/api/data')).length).toBe(legacyWritesBeforeRepeat);
    expect(writes.filter((entry) => entry.url.includes('/api/cards-core')).length).toBeGreaterThan(cardsCoreWritesBeforeRepeat);

    await expect.poll(() => page.evaluate(({ sourceCardId, newCardId }) => {
      if (typeof getCardStoreCard !== 'function') return null;
      const sourceCard = getCardStoreCard(sourceCardId);
      const newCard = getCardStoreCard(newCardId);
      if (!sourceCard || !newCard) return null;
      return {
        sourceArchived: Boolean(sourceCard.archived),
        newArchived: Boolean(newCard.archived),
        newApprovalStage: String(newCard.approvalStage || '')
      };
    }, {
      sourceCardId: archiveCandidate.id,
      newCardId: repeatedCard.id
    })).toEqual({
      sourceArchived: true,
      newArchived: false,
      newApprovalStage: 'DRAFT'
    });

    expectNoCriticalClientFailures(diagnostics, {
      ignoreConsolePatterns: IGNORE_CONSOLE_PATTERNS
    });
  });

  test('deletes card through cards core API and removes production task references', async ({ page }) => {
    test.setTimeout(180000);
    const diagnostics = attachDiagnostics(page);
    const db = loadSnapshotDb();
    const taskCounts = new Map();
    (db.productionShiftTasks || []).forEach((task) => {
      const cardId = String(task?.cardId || '').trim();
      if (!cardId) return;
      taskCounts.set(cardId, (taskCounts.get(cardId) || 0) + 1);
    });
    const deleteCandidate = (db.cards || []).find((card) => (
      card
      && !card.archived
      && card.cardType === 'MKI'
      && String(card.qrId || '').trim()
      && taskCounts.has(String(card.id || '').trim())
    )) || null;
    test.skip(!deleteCandidate?.id, 'Нет подходящей карточки с production task references для delete-path');

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

    await loginAsAbyss(page, { startPath: '/cards' });
    await waitUsableUi(page, '/cards');

    const cardRow = page.locator(`tr[data-card-id="${deleteCandidate.id}"]`);
    await expect(cardRow).toBeVisible();

    const legacyWritesBeforeDelete = writes.filter((entry) => entry.url.includes('/api/data')).length;
    const cardsCoreWritesBeforeDelete = writes.filter((entry) => entry.url.includes('/api/cards-core')).length;
    const deleteResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'DELETE'
      && response.url().includes(`/api/cards-core/${encodeURIComponent(deleteCandidate.id)}`)
      && response.status() === 200
    ));

    await cardRow.locator('button[data-action="delete-card"]').click();
    await expect(page.locator('#delete-confirm-modal')).toBeVisible();
    await page.locator('#delete-confirm-apply').click();

    const deleteResponse = await deleteResponsePromise;
    const deleteBody = await deleteResponse.json();
    expect(deleteBody?.deletedId).toBe(deleteCandidate.id);
    expect(Number(deleteBody?.removedProductionShiftTasks || 0)).toBeGreaterThan(0);
    expect(writes.filter((entry) => entry.url.includes('/api/data')).length).toBe(legacyWritesBeforeDelete);
    expect(writes.filter((entry) => entry.url.includes('/api/cards-core')).length).toBeGreaterThan(cardsCoreWritesBeforeDelete);

    await expect(cardRow).toHaveCount(0);
    await expect.poll(() => page.evaluate((cardId) => {
      if (typeof getCardStoreCard !== 'function') return 'missing-helper';
      const card = getCardStoreCard(cardId);
      const taskRefs = (Array.isArray(productionShiftTasks) ? productionShiftTasks : []).filter((task) => (
        String(task?.cardId || '').trim() === cardId
      ));
      return JSON.stringify({
        hasCard: Boolean(card),
        taskRefs: taskRefs.length
      });
    }, deleteCandidate.id)).toBe(JSON.stringify({
      hasCard: false,
      taskRefs: 0
    }));

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitUsableUi(page, '/cards');

    const persistedDb = JSON.parse(fs.readFileSync(dataDbPath, 'utf8'));
    const persistedCard = (persistedDb.cards || []).find((card) => String(card?.id || '').trim() === deleteCandidate.id) || null;
    const persistedTaskRefs = (persistedDb.productionShiftTasks || []).filter((task) => (
      String(task?.cardId || '').trim() === deleteCandidate.id
    ));
    expect(persistedCard).toBeNull();
    expect(persistedTaskRefs.length).toBe(0);

    expectNoCriticalClientFailures(diagnostics, {
      ignoreConsolePatterns: IGNORE_CONSOLE_PATTERNS
    });
  });
});
