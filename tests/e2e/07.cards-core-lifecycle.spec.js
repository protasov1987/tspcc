const fs = require('fs');
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
const { loadSnapshotDb } = require('./helpers/db');
const { dataDbPath, baseURL } = require('./helpers/paths');
const { createLoggedInClient, closeClients } = require('./helpers/multiclient');

const IGNORE_CONSOLE_PATTERNS = [
  /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
  /^\[LIVE\]/i,
  /Не удалось загрузить данные с сервера/i,
  /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
];

function findArchivedRepeatCandidate(db) {
  return (db.cards || []).find((card) => (
    card
    && card.archived
    && card.cardType === 'MKI'
    && ['PROVIDED', 'PLANNING', 'PLANNED'].includes(String(card.approvalStage || ''))
    && String(card.qrId || '').trim()
    && Number.isFinite(Number(card.rev))
  )) || null;
}

async function buildArchiveClient(browser, routePath) {
  const client = await createLoggedInClient(browser, { baseURL, route: null });
  await client.page.goto(`${baseURL}${routePath}`, { waitUntil: 'domcontentloaded' });
  await waitUsableUi(client.page, {
    inputPath: routePath,
    expectedPath: routePath,
    pageId: routePath.startsWith('/archive/') ? 'page-archive-card' : 'page-archive'
  });
  resetDiagnostics(client.diagnostics);
  return client;
}

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

  test('keeps archive detail route during real two-client stale repeat conflict', async ({ browser }) => {
    test.setTimeout(180000);
    const db = loadSnapshotDb();
    const candidate = findArchivedRepeatCandidate(db);
    test.skip(!candidate?.id, 'Нет архивной MKI-карты для stale repeat conflict');

    const detailRoute = `/archive/${encodeURIComponent(candidate.qrId)}`;
    const clients = [
      await buildArchiveClient(browser, detailRoute),
      await buildArchiveClient(browser, detailRoute)
    ];

    try {
      const [clientA, clientB] = clients;
      const writes = [];
      for (const client of clients) {
        client.page.on('request', (request) => {
          const url = request.url();
          if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) return;
          if (url.includes('/api/cards-core') || url.includes('/api/data')) {
            writes.push({ method: request.method(), url });
          }
        });
      }

      const initialB = await clientB.page.evaluate((cardId) => {
        const card = typeof getCardStoreCard === 'function' ? getCardStoreCard(cardId) : null;
        return {
          id: String(card?.id || ''),
          rev: Number(card?.rev || 0),
          archived: Boolean(card?.archived)
        };
      }, candidate.id);
      expect(initialB).toMatchObject({
        id: candidate.id,
        rev: Number(candidate.rev),
        archived: true
      });

      const actorNote = `Stage10 stale repeat actor ${Date.now()}`;
      const updateResult = await clientA.page.evaluate(async ({ cardId, note }) => {
        const card = typeof getCardStoreCard === 'function' ? getCardStoreCard(cardId) : null;
        if (!card || typeof updateCardsCoreCard !== 'function') return { status: 0, body: null };
        const res = await updateCardsCoreCard(card.id, {
          ...card,
          specialNotes: note
        }, { expectedRev: Number(card.rev || 1) });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body?.card && typeof upsertCardEntity === 'function') {
          upsertCardEntity(body.card);
          if (typeof markCardsCoreDetailLoaded === 'function') {
            markCardsCoreDetailLoaded(body.card);
          }
        }
        return { status: res.status, body };
      }, {
        cardId: candidate.id,
        note: actorNote
      });
      expect(updateResult.status).toBe(200);
      expect(Number(updateResult.body?.card?.rev || 0)).toBeGreaterThan(initialB.rev);

      const staleRepeatResponsePromise = clientB.page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && response.url().includes(`/api/cards-core/${encodeURIComponent(candidate.id)}/repeat`)
        && response.status() === 409
      ));
      await clientB.page.locator(`.wo-card[data-card-id="${candidate.id}"] .repeat-card-btn`).click();
      const staleRepeatResponse = await staleRepeatResponsePromise;
      const staleBody = await staleRepeatResponse.json();

      expect(staleBody?.code).toBe('STALE_REVISION');
      expect(staleBody?.expectedRev).toBe(initialB.rev);
      expect(Number(staleBody?.actualRev || 0)).toBeGreaterThan(initialB.rev);
      await expect(clientB.page.locator('#toast-container .toast').last()).toContainText('Карточка уже была изменена другим пользователем. Данные обновлены.');
      await expect.poll(() => clientB.page.evaluate(() => window.location.pathname + window.location.search)).toBe(detailRoute);
      await expect.poll(() => clientB.page.evaluate(() => window.__currentPageId || null)).toBe('page-archive-card');
      await expect.poll(() => clientB.page.evaluate((cardId) => {
        const card = typeof getCardStoreCard === 'function' ? getCardStoreCard(cardId) : null;
        return {
          rev: Number(card?.rev || 0),
          note: String(card?.specialNotes || ''),
          archived: Boolean(card?.archived)
        };
      }, candidate.id)).toEqual({
        rev: Number(updateResult.body.card.rev),
        note: actorNote,
        archived: true
      });
      expect(writes.some((entry) => entry.url.includes('/api/data'))).toBe(false);
      await expect.poll(() => (
        findConsoleEntries(clientB.diagnostics, /^\[CONFLICT\] conflict detected/i).length
      )).toBeGreaterThan(0);

      expectNoCriticalClientFailures(clientA.diagnostics, {
        ignoreConsolePatterns: IGNORE_CONSOLE_PATTERNS
      });
      expectNoCriticalClientFailures(clientB.diagnostics, {
        allow409: true,
        ignoreConsolePatterns: [
          ...IGNORE_CONSOLE_PATTERNS,
          /^\[CONFLICT\]/i
        ]
      });
    } finally {
      await closeClients(clients);
    }
  });

  test('keeps archive context and sends no repeat request for local invalid archived state', async ({ page }) => {
    test.setTimeout(180000);
    const diagnostics = attachDiagnostics(page);
    const db = loadSnapshotDb();
    const candidate = findArchivedRepeatCandidate(db);
    test.skip(!candidate?.id, 'Нет архивной MKI-карты для local invalid repeat path');

    const detailRoute = `/archive/${encodeURIComponent(candidate.qrId)}`;
    const writes = [];
    page.on('request', (request) => {
      const url = request.url();
      if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) return;
      if (url.includes('/api/cards-core') || url.includes('/api/data')) {
        writes.push({ method: request.method(), url });
      }
    });

    await loginAsAbyss(page, { startPath: detailRoute });
    await waitUsableUi(page, {
      inputPath: detailRoute,
      expectedPath: detailRoute,
      pageId: 'page-archive-card'
    });

    await page.evaluate((cardId) => {
      const card = typeof getCardStoreCard === 'function' ? getCardStoreCard(cardId) : null;
      if (card) {
        card.archived = false;
      }
    }, candidate.id);

    await page.locator(`.wo-card[data-card-id="${candidate.id}"] .repeat-card-btn`).click();

    await expect(page.locator('#toast-container .toast').last()).toContainText('Карта больше недоступна для повтора. Данные обновлены.');
    await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe(detailRoute);
    await expect.poll(() => page.evaluate((cardId) => {
      const card = typeof getCardStoreCard === 'function' ? getCardStoreCard(cardId) : null;
      return Boolean(card?.archived);
    }, candidate.id)).toBe(true);
    expect(writes.some((entry) => entry.url.includes('/repeat'))).toBe(false);
    expect(writes.some((entry) => entry.url.includes('/api/data'))).toBe(false);
    await expect.poll(() => (
      findConsoleEntries(diagnostics, /^\[CONFLICT\] archive repeat local invalid/i).length
    )).toBeGreaterThan(0);

    expectNoCriticalClientFailures(diagnostics, {
      ignoreConsolePatterns: [
        ...IGNORE_CONSOLE_PATTERNS,
        /^\[CONFLICT\]/i
      ]
    });
  });
});
