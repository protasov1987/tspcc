const { test, expect, request: playwrightRequest } = require('@playwright/test');
const { resetDatabaseFromSnapshot } = require('./helpers/snapshot');
const { restartServer, stopServer } = require('./helpers/server');
const { loginAsAbyss } = require('./helpers/auth');
const { waitUsableUi } = require('./helpers/navigation');

async function loginApi(baseURL, password = 'ssyba') {
  const api = await playwrightRequest.newContext({ baseURL });
  const loginResponse = await api.post('/api/login', {
    data: { password }
  });
  expect(loginResponse.ok()).toBeTruthy();
  const loginBody = await loginResponse.json();
  expect(loginBody.csrfToken).toBeTruthy();
  return {
    api,
    csrfToken: loginBody.csrfToken
  };
}

async function getCardById(api, cardId) {
  const response = await api.get(`/api/cards-core/${encodeURIComponent(cardId)}`);
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.card).toBeTruthy();
  return body.card;
}

async function uploadCardFile(api, csrfToken, cardId, {
  expectedRev,
  fileName = 'workspace-stage5.pdf',
  mimeType = 'application/pdf',
  size = 8,
  category = 'GENERAL',
  scope = 'CARD',
  content = 'data:application/pdf;base64,JVBERi0xCg=='
} = {}) {
  return api.post(`/api/cards/${encodeURIComponent(cardId)}/files`, {
    headers: {
      'x-csrf-token': csrfToken
    },
    data: {
      expectedRev,
      name: fileName,
      type: mimeType,
      content,
      size,
      category,
      scope
    }
  });
}

async function blockCardsSse(page) {
  await page.route('**/api/events/stream', async (route) => {
    await route.abort();
  });
}

async function findWorkspaceTransferTarget(page) {
  return page.evaluate(() => {
    const cardNodes = Array.from(document.querySelectorAll('details.workspace-card[data-card-id]'));
    for (const node of cardNodes) {
      const cardId = node.getAttribute('data-card-id') || '';
      const card = Array.isArray(cards) ? cards.find((entry) => entry && entry.id === cardId) : null;
      if (!card) continue;
      const actionButtons = Array.from(node.querySelectorAll('button[data-action][data-op-id]'));
      for (const button of actionButtons) {
        if (button.disabled) continue;
        const action = button.getAttribute('data-action') || '';
        if (action !== 'stop') continue;
        const opId = button.getAttribute('data-op-id') || '';
        const qrId = String(card.qrId || '').trim();
        if (!qrId) continue;
        return {
          cardId,
          opId,
          qrId,
          action
        };
      }
    }
    return null;
  });
}

async function waitForWorkspaceTransferTarget(page) {
  let resolvedTarget = null;
  await expect.poll(async () => {
    resolvedTarget = await findWorkspaceTransferTarget(page);
    return resolvedTarget ? `${resolvedTarget.cardId}:${resolvedTarget.opId}:${resolvedTarget.action}` : '';
  }, {
    timeout: 15000
  }).not.toBe('');
  return resolvedTarget;
}

async function forceWorkspaceDocumentsMode(page, target) {
  await page.evaluate(({ cardId, opId }) => {
    const card = Array.isArray(cards) ? cards.find((entry) => entry && entry.id === cardId) : null;
    const op = Array.isArray(card?.operations) ? card.operations.find((entry) => entry && entry.id === opId) : null;
    if (!op) return false;
    op.operationType = 'Документы';
    return true;
  }, {
    cardId: target.cardId,
    opId: target.opId
  });
}

function trackWorkspaceFileRequests(page, cardId) {
  const encodedCardId = encodeURIComponent(cardId);
  const entries = [];
  page.on('request', (request) => {
    const url = request.url();
    if (
      !url.includes(`/api/cards/${encodedCardId}/files`)
      && !url.includes('/api/production/flow/commit')
      && !url.includes(`/api/cards-core/${encodedCardId}`)
    ) {
      return;
    }
    entries.push({
      method: request.method(),
      url
    });
  });
  return entries;
}

async function openWorkspaceDocumentsModal(page, target, routePath) {
  await page.goto(routePath, { waitUntil: 'domcontentloaded' });
  await waitUsableUi(page, routePath);
  await forceWorkspaceDocumentsMode(page, target);
  const actionButton = page.locator(`button[data-op-id="${target.opId}"][data-action="${target.action}"]`).first();
  await expect(actionButton).toBeVisible();
  await actionButton.click();
  await expect(page.locator('#workspace-transfer-modal')).toBeVisible();
  await expect(page.locator('#workspace-transfer-docs')).toBeVisible();
  const items = page.locator('#workspace-transfer-list .workspace-transfer-item');
  test.skip((await items.count()) === 0, 'В documents-flow нет изделий для подтверждения');
  await page.locator('#workspace-transfer-all-good').click();
}

test.describe.serial('workspace card-file action contexts', () => {
  test.beforeEach(async () => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
  });

  test.afterEach(async () => {
    await stopServer();
  });

  test('keeps /workspace/:qr modal open after local no-request stale file context and refreshes route safely', async ({ page }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;

    await loginAsAbyss(page, { startPath: '/workspace' });
    await waitUsableUi(page, '/workspace');

    const target = await waitForWorkspaceTransferTarget(page);

    const routePath = `/workspace/${encodeURIComponent(target.qrId)}`;
    const requests = trackWorkspaceFileRequests(page, target.cardId);
    await openWorkspaceDocumentsModal(page, target, routePath);

    await page.setInputFiles('#workspace-transfer-docs-files', {
      name: 'workspace-local-stale.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('JVBERi0xCg==', 'base64')
    });
    await expect(page.locator('#workspace-transfer-docs-list')).toContainText('workspace-local-stale.pdf');

    const postedFileRequestsBefore = requests.filter((entry) => (
      entry.method === 'POST'
      && entry.url.includes(`/api/cards/${encodeURIComponent(target.cardId)}/files`)
    )).length;

    await page.evaluate(({ cardId, opId }) => {
      const originalShowToast = showToast;
      showToast = function wrappedShowToast(message, ...args) {
        const text = String(message || '').trim();
        if (text === 'Маршрутная карта не найдена' || text === 'Маршрутная карта не найдена.') {
          return;
        }
        return originalShowToast.call(this, message, ...args);
      };
      scheduleWorkspaceCommitFallbackRefresh = () => {};
      const originalUpload = uploadWorkspaceTransferDocuments;
      uploadWorkspaceTransferDocuments = async function wrappedWorkspaceTransferDocuments(...args) {
        const card = Array.isArray(cards) ? cards.find((entry) => entry && entry.id === cardId) : null;
        if (Array.isArray(card?.operations)) {
          card.operations = card.operations.filter((entry) => entry && entry.id !== opId);
        }
        uploadWorkspaceTransferDocuments = originalUpload;
        return originalUpload.apply(this, args);
      };
    }, {
      cardId: target.cardId,
      opId: target.opId
    });

    const commitResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && response.url().includes('/api/production/flow/commit')
      && response.status() === 200
    ));

    await page.locator('#workspace-transfer-confirm').click();

    await commitResponsePromise;
    await expect(page.locator('#toast-container .toast').last()).toContainText('Операция уже была изменена другим пользователем. Данные обновлены.');
    await expect(page.locator('#workspace-transfer-modal')).toBeVisible();
    await expect(page.locator('#workspace-transfer-docs-list')).toContainText('workspace-local-stale.pdf');
    await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe(routePath);
    await expect.poll(() => page.evaluate(() => window.__currentPageId || null)).toBe('page-workorders-card');
    await expect.poll(() => requests.filter((entry) => (
      entry.method === 'POST'
      && entry.url.includes(`/api/cards/${encodeURIComponent(target.cardId)}/files`)
    )).length).toBe(postedFileRequestsBefore);
  });

  test('keeps /workspace/:qr modal open after real stale card-file upload conflict in documents flow', async ({ page }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const { api, csrfToken } = await loginApi(baseURL);

    try {
      await blockCardsSse(page);
      await loginAsAbyss(page, { startPath: '/workspace' });
      await waitUsableUi(page, '/workspace');

      const target = await waitForWorkspaceTransferTarget(page);

      const routePath = `/workspace/${encodeURIComponent(target.qrId)}`;
      await openWorkspaceDocumentsModal(page, target, routePath);

      await page.setInputFiles('#workspace-transfer-docs-files', {
        name: 'workspace-server-conflict.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('JVBERi0xCg==', 'base64')
      });
      await expect(page.locator('#workspace-transfer-docs-list')).toContainText('workspace-server-conflict.pdf');

      const currentCard = await getCardById(api, target.cardId);
      const externalUploadResponse = await uploadCardFile(api, csrfToken, target.cardId, {
        expectedRev: currentCard.rev,
        fileName: `workspace-external-${Date.now()}.pdf`,
        category: 'GENERAL'
      });
      expect(externalUploadResponse.ok()).toBeTruthy();

      const commitResponsePromise = page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && response.url().includes('/api/production/flow/commit')
        && response.status() === 200
      ));
      const fileConflictResponsePromise = page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && response.url().includes(`/api/cards/${encodeURIComponent(target.cardId)}/files`)
        && response.status() === 409
      ));
      const pointRefreshPromise = page.waitForResponse((response) => (
        response.request().method() === 'GET'
        && response.url().includes(`/api/cards-core/${encodeURIComponent(target.cardId)}`)
        && response.status() === 200
      ));

      await page.locator('#workspace-transfer-confirm').click();

      await commitResponsePromise;
      await fileConflictResponsePromise;
      await pointRefreshPromise;
      await expect(page.locator('#toast-container .toast').last()).toContainText(/Версия карточки устарела|Карточка уже была изменена другим пользователем\. Данные обновлены\./);
      await expect(page.locator('#workspace-transfer-modal')).toBeVisible();
      await expect(page.locator('#workspace-transfer-docs-list')).toContainText('workspace-server-conflict.pdf');
      await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe(routePath);
      await expect.poll(() => page.evaluate(() => window.__currentPageId || null)).toBe('page-workorders-card');
    } finally {
      await api.dispose();
    }
  });

  test('shows selected item names in attachments modal after workspace documents upload', async ({ page }) => {
    await loginAsAbyss(page, { startPath: '/workspace' });
    await waitUsableUi(page, '/workspace');

    const target = await waitForWorkspaceTransferTarget(page);
    const routePath = `/workspace/${encodeURIComponent(target.qrId)}`;
    await openWorkspaceDocumentsModal(page, target, routePath);

    const itemRows = page.locator('#workspace-transfer-list .workspace-transfer-item');
    const itemCount = await itemRows.count();
    test.skip(itemCount === 0, 'В documents-flow нет изделий для подтверждения');

    const expectedNames = [];
    for (let idx = 0; idx < Math.min(itemCount, 2); idx += 1) {
      const name = ((await itemRows.nth(idx).locator('.workspace-transfer-item-name').textContent()) || '').trim();
      if (name) expectedNames.push(name);
    }
    test.skip(expectedNames.length === 0, 'Для documents-flow не удалось определить имена изделий');

    await page.setInputFiles('#workspace-transfer-docs-files', {
      name: 'workspace-items-label.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('JVBERi0xCg==', 'base64')
    });
    await expect(page.locator('#workspace-transfer-docs-list')).toContainText('workspace-items-label.pdf');

    const fileUploadResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && response.url().includes(`/api/cards/${encodeURIComponent(target.cardId)}/files`)
      && response.status() === 200
    ));

    await page.locator('#workspace-transfer-confirm').click();

    await fileUploadResponsePromise;
    await expect(page.locator('#toast-container .toast').last()).toContainText('Документы загружены');
    await expect(page.locator('#workspace-transfer-modal')).toBeHidden();

    await page.evaluate(async (cardId) => {
      await openAttachmentsModal(cardId, 'live');
    }, target.cardId);
    await expect(page.locator('#attachments-modal')).toBeVisible();

    const fileRow = page.locator('#attachments-modal tbody tr').filter({
      hasText: 'ХА_workspace-items-label.pdf'
    }).first();
    await expect(fileRow).toBeVisible();

    const itemsCell = fileRow.locator('td').nth(4);
    for (const name of expectedNames) {
      await expect(itemsCell).toContainText(name);
    }
  });
});
