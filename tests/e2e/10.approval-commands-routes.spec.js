const { test, expect } = require('@playwright/test');
const { resetDatabaseFromSnapshot } = require('./helpers/snapshot');
const { restartServer, stopServer } = require('./helpers/server');
const { loadSnapshotDb } = require('./helpers/db');
const { createLoggedInClient, closeClients } = require('./helpers/multiclient');
const { waitUsableUi } = require('./helpers/navigation');
const { baseURL } = require('./helpers/paths');

test.describe.serial('approval commands route integration', () => {
  test.beforeAll(async () => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
  });

  test.afterAll(async () => {
    await stopServer();
  });

  test('sends a draft card to approval from direct card route via server command without legacy snapshot save', async ({ browser }) => {
    const db = loadSnapshotDb();
    const draftCard = (db.cards || []).find(card => (
      card
      && !card.archived
      && card.approvalStage === 'DRAFT'
      && String(card.qrId || '').trim()
    ));
    test.skip(!draftCard, 'Нет подходящей карточки в статусе Draft для route approval test');

    const routePath = `/card-route/${encodeURIComponent(draftCard.qrId)}`;
    const client = await createLoggedInClient(browser, { baseURL, route: null });
    const writeResponses = [];

    client.page.on('response', async (response) => {
      const request = response.request();
      const method = request.method();
      const url = response.url();
      if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return;
      if (!url.includes('/api/cards-core') && !url.includes('/api/data')) return;
      writeResponses.push({
        method,
        status: response.status(),
        url
      });
    });

    try {
      await client.page.goto(`${baseURL}${routePath}`, { waitUntil: 'domcontentloaded' });
      await waitUsableUi(client.page, {
        inputPath: routePath,
        expectedPath: routePath,
        pageId: 'page-cards-new'
      });

      await client.page.evaluate(() => {
        const cardId = typeof getActiveCardId === 'function' ? getActiveCardId() : '';
        if (!cardId || typeof openApprovalDialog !== 'function') {
          throw new Error('Approval dialog is unavailable on direct card route');
        }
        openApprovalDialog(cardId);
      });
      await expect(client.page.locator('#approval-dialog-modal')).toBeVisible();
      await client.page.fill('#approval-dialog-comment', 'Route command send to approval');

      const sendResponsePromise = client.page.waitForResponse(response => (
        response.request().method() === 'POST'
        && response.url().includes(`/api/cards-core/${encodeURIComponent(draftCard.id)}/approval/send`)
        && response.status() === 200
      ));
      await client.page.click('#approval-dialog-confirm');
      await sendResponsePromise;

      await expect(client.page.locator('#approval-dialog-modal')).toBeHidden();
      await expect.poll(() => client.page.evaluate(() => window.location.pathname + window.location.search)).toBe(routePath);
      await expect.poll(() => client.page.evaluate(() => {
        if (typeof activeCardDraft === 'undefined' || !activeCardDraft) return '';
        return String(activeCardDraft.approvalStage || '');
      })).toBe('ON_APPROVAL');

      expect(writeResponses.some(entry => entry.url.includes(`/api/cards-core/${encodeURIComponent(draftCard.id)}/approval/send`))).toBeTruthy();
      expect(writeResponses.some(entry => entry.url.includes('/api/data'))).toBeFalsy();
    } finally {
      await closeClients([client]);
    }
  });
});
