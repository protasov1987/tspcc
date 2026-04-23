const { test, expect, request: playwrightRequest } = require('@playwright/test');
const { resetDatabaseFromSnapshot } = require('./helpers/snapshot');
const { restartServer, stopServer } = require('./helpers/server');
const { createLoggedInClient, closeClients } = require('./helpers/multiclient');
const { waitUsableUi } = require('./helpers/navigation');
const { findConsoleEntries } = require('./helpers/diagnostics');
const { baseURL } = require('./helpers/paths');

async function loginApi(baseUrl, password = 'ssyba') {
  const api = await playwrightRequest.newContext({ baseURL: baseUrl });
  const loginResponse = await api.post('/api/login', {
    data: { password }
  });
  expect(loginResponse.ok()).toBeTruthy();
  const loginBody = await loginResponse.json();
  expect(loginBody.csrfToken).toBeTruthy();
  return {
    api,
    csrfToken: loginBody.csrfToken,
    user: loginBody.user
  };
}

async function createDraftCard(adminApi, csrfToken, name) {
  const response = await adminApi.post('/api/cards-core', {
    headers: {
      'x-csrf-token': csrfToken
    },
    data: {
      name,
      desc: `approval routes test ${name}`,
      cardType: 'MKI',
      quantity: 2,
      material: 'Сталь 40Х'
    }
  });
  expect(response.status()).toBe(201);
  const body = await response.json();
  expect(body.card).toBeTruthy();
  return body.card;
}

async function sendCardToApprovalByApi(adminApi, csrfToken, card, comment) {
  const response = await adminApi.post(`/api/cards-core/${encodeURIComponent(card.id)}/approval/send`, {
    headers: {
      'x-csrf-token': csrfToken
    },
    data: {
      expectedRev: card.rev,
      comment
    }
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.card).toBeTruthy();
  return body.card;
}

async function rejectCardByApi(adminApi, csrfToken, card, reason) {
  const response = await adminApi.post(`/api/cards-core/${encodeURIComponent(card.id)}/approval/reject`, {
    headers: {
      'x-csrf-token': csrfToken
    },
    data: {
      expectedRev: card.rev,
      reason
    }
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.card).toBeTruthy();
  return body.card;
}

function trackRelevantResponses(page) {
  const entries = [];
  page.on('response', async (response) => {
    const request = response.request();
    const method = request.method();
    const url = response.url();
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return;
    if (!url.includes('/api/cards-core') && !url.includes('/api/data')) return;
    entries.push({
      method,
      status: response.status(),
      url
    });
  });
  return entries;
}

function expectNoLegacySnapshotWrites(entries) {
  expect(entries.some((entry) => (
    entry.url.includes('/api/data')
    && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(entry.method)
  ))).toBeFalsy();
}

async function expectConflictToast(page) {
  await expect(page.locator('#toast-container .toast').last()).toContainText(/Версия карточки устарела|Карточка уже была изменена другим пользователем\. Данные обновлены\./);
}

async function expectApprovalLiveUpdateToast(page) {
  await expect(page.locator('#toast-container .toast').last()).toContainText(/Данные обновлены|больше недоступно|уже согласована|уже недоступна|доступно только/i);
}

async function openCardRoute(client, card) {
  const inputPath = `/cards/${encodeURIComponent(card.id)}`;
  await client.page.goto(`${baseURL}${inputPath}`, { waitUntil: 'domcontentloaded' });
  await expect.poll(() => client.page.evaluate(() => window.location.pathname + window.location.search)).toMatch(/^\/cards\/[^/]+$/);
  await expect.poll(() => client.page.evaluate(() => window.__currentPageId || null)).toBe('page-cards-new');
  await expect.poll(async () => {
    const text = await client.page.locator('#app-main').innerText().catch(() => '');
    return text.trim().length > 20;
  }).toBe(true);
}

async function expectCardDetailRouteStable(page, cardId) {
  await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toMatch(/^\/cards\/[^/]+$/);
  await expect.poll(() => page.evaluate(() => window.__currentPageId || null)).toBe('page-cards-new');
  await expect.poll(() => page.evaluate(() => {
    if (typeof getActiveCardId !== 'function') return '';
    return String(getActiveCardId() || '');
  })).toBe(String(cardId || ''));
}

async function openCardQrRoute(client, card) {
  const cardRouteKey = String(card?.qrId || card?.barcode || card?.id || '').trim();
  const inputPath = `/card-route/${encodeURIComponent(cardRouteKey)}`;
  await client.page.goto(`${baseURL}${inputPath}`, { waitUntil: 'domcontentloaded' });
  await expect.poll(() => pageEvaluateFullPath(client.page)).toMatch(/^\/card-route\/[^/]+$/);
  await expect.poll(() => client.page.evaluate(() => window.__currentPageId || null)).toBe('page-cards-new');
  await expect.poll(() => client.page.evaluate(() => {
    if (typeof getActiveCardId !== 'function') return '';
    return String(getActiveCardId() || '');
  })).toBe(String(card.id || ''));
  return pageEvaluateFullPath(client.page);
}

async function pageEvaluateFullPath(page) {
  return page.evaluate(() => window.location.pathname + window.location.search);
}

async function expectExactCardRouteStable(page, routePath, cardId) {
  await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe(routePath);
  await expect.poll(() => page.evaluate(() => window.__currentPageId || null)).toBe('page-cards-new');
  await expect.poll(() => page.evaluate(() => {
    if (typeof getActiveCardId !== 'function') return '';
    return String(getActiveCardId() || '');
  })).toBe(String(cardId || ''));
}

async function openCardApprovalDialog(page) {
  await page.evaluate(() => {
    const cardId = typeof getActiveCardId === 'function' ? getActiveCardId() : '';
    if (!cardId || typeof openApprovalDialog !== 'function') {
      throw new Error('Approval dialog is unavailable on current card route');
    }
    openApprovalDialog(cardId);
  });
  await expect(page.locator('#approval-dialog-modal')).toBeVisible();
}

async function confirmCardApprovalDialog(page, actionUrlPart, expectedStatus = 200) {
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && response.url().includes(actionUrlPart)
    && response.status() === expectedStatus
  ));
  await page.click('#approval-dialog-confirm');
  await responsePromise;
}

async function confirmApprovalModal(page, modalSelector, confirmSelector, actionUrlPart, expectedStatus = 200) {
  await expect(page.locator(modalSelector)).toBeVisible();
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && response.url().includes(actionUrlPart)
    && response.status() === expectedStatus
  ));
  await page.click(confirmSelector);
  await responsePromise;
}

async function attachStaleExpectedRevInterceptor(page, approvalUrlPart) {
  let intercepted = false;
  await page.route(`**${approvalUrlPart}`, async (route) => {
    if (intercepted) {
      await route.continue();
      return;
    }
    intercepted = true;
    const request = route.request();
    const payload = JSON.parse(request.postData() || '{}');
    const expectedRev = Number(payload.expectedRev || 0);
    payload.expectedRev = expectedRev > 1 ? (expectedRev - 1) : 0;
    await route.continue({
      headers: {
        ...request.headers(),
        'content-type': 'application/json'
      },
      postData: JSON.stringify(payload)
    });
  });
}

test.describe.serial('approval commands route integration', () => {
  let adminSession = null;

  test.beforeAll(async () => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
    adminSession = await loginApi(baseURL);
  });

  test.afterAll(async () => {
    await adminSession?.api?.dispose().catch(() => {});
    adminSession = null;
    await stopServer();
  });

  test('sends a draft card to approval from direct card route via server command without legacy snapshot save', async ({ browser }) => {
    const adminApi = adminSession.api;
    const csrfToken = adminSession.csrfToken;
    const draftCard = await createDraftCard(adminApi, csrfToken, `Stage4 route send ${Date.now()}`);
    const client = await createLoggedInClient(browser, { baseURL, route: null });
    const responses = trackRelevantResponses(client.page);

    try {
      await openCardRoute(client, draftCard);
      await openCardApprovalDialog(client.page);
      await client.page.fill('#approval-dialog-comment', 'Route command send to approval');

      const sendResponsePromise = client.page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && response.url().includes(`/api/cards-core/${encodeURIComponent(draftCard.id)}/approval/send`)
        && response.status() === 200
      ));
      await client.page.click('#approval-dialog-confirm');
      await sendResponsePromise;

      await expect(client.page.locator('#approval-dialog-modal')).toBeHidden();
      await expectCardDetailRouteStable(client.page, draftCard.id);
      await expect.poll(() => client.page.evaluate(() => {
        if (typeof activeCardDraft === 'undefined' || !activeCardDraft) return '';
        return String(activeCardDraft.approvalStage || '');
      })).toBe('ON_APPROVAL');

      expect(responses.some((entry) => entry.url.includes(`/api/cards-core/${encodeURIComponent(draftCard.id)}/approval/send`))).toBeTruthy();
      expectNoLegacySnapshotWrites(responses);
    } finally {
      await closeClients([client]);
    }
  });

  test('returns a rejected card to draft from direct card route without losing the current route', async ({ browser }) => {
    const adminApi = adminSession.api;
    const csrfToken = adminSession.csrfToken;
    const draftCard = await createDraftCard(adminApi, csrfToken, `Stage4 route return ${Date.now()}`);
    const sentCard = await sendCardToApprovalByApi(adminApi, csrfToken, draftCard, 'Подготовка к возврату в черновик');
    await rejectCardByApi(adminApi, csrfToken, sentCard, 'Подготовка отклонения для route возврата');

    const client = await createLoggedInClient(browser, { baseURL, route: null });
    const responses = trackRelevantResponses(client.page);

    try {
      await openCardRoute(client, draftCard);
      await openCardApprovalDialog(client.page);
      await client.page.fill('#approval-dialog-comment', 'Возвращаем в черновик с card route');

      const returnResponsePromise = client.page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && response.url().includes(`/api/cards-core/${encodeURIComponent(draftCard.id)}/approval/return-to-draft`)
        && response.status() === 200
      ));
      await client.page.click('#approval-dialog-confirm');
      await returnResponsePromise;

      await expect(client.page.locator('#approval-dialog-modal')).toBeHidden();
      await expectCardDetailRouteStable(client.page, draftCard.id);
      await expect.poll(() => client.page.evaluate(() => {
        if (typeof activeCardDraft === 'undefined' || !activeCardDraft) return null;
        return {
          stage: String(activeCardDraft.approvalStage || ''),
          rejectionReadByUserName: String(activeCardDraft.rejectionReadByUserName || '')
        };
      })).toEqual({
        stage: 'DRAFT',
        rejectionReadByUserName: 'Abyss'
      });

      expect(responses.some((entry) => entry.url.includes(`/api/cards-core/${encodeURIComponent(draftCard.id)}/approval/return-to-draft`))).toBeTruthy();
      expectNoLegacySnapshotWrites(responses);
    } finally {
      await closeClients([client]);
    }
  });

  test('keeps /cards/:id stable and shows a message when live update invalidates stale send dialog without a new request', async ({ browser }) => {
    const adminApi = adminSession.api;
    const csrfToken = adminSession.csrfToken;
    const draftCard = await createDraftCard(adminApi, csrfToken, `Stage4 route live send ${Date.now()}`);
    const clients = [
      await createLoggedInClient(browser, { baseURL, route: null }),
      await createLoggedInClient(browser, { baseURL, route: null })
    ];
    const actor = clients[0];
    const observer = clients[1];
    const observerResponses = trackRelevantResponses(observer.page);
    const routePath = `/cards/${encodeURIComponent(draftCard.id)}`;
    const actionUrlPart = `/api/cards-core/${encodeURIComponent(draftCard.id)}/approval/send`;

    try {
      await openCardRoute(actor, draftCard);
      await openCardRoute(observer, draftCard);

      await openCardApprovalDialog(observer.page);
      await observer.page.fill('#approval-dialog-comment', 'Stale live send from second tab');

      await openCardApprovalDialog(actor.page);
      await actor.page.fill('#approval-dialog-comment', 'First tab sends before confirm');
      await confirmCardApprovalDialog(actor.page, actionUrlPart, 200);
      await expect(actor.page.locator('#approval-dialog-modal')).toBeHidden();

      await expect.poll(() => observer.page.evaluate((cardId) => {
        if (typeof getCardStoreCard !== 'function') return '';
        return String(getCardStoreCard(cardId)?.approvalStage || '');
      }, draftCard.id)).toBe('ON_APPROVAL');

      const observerPostCountBefore = observerResponses.filter((entry) => (
        entry.method === 'POST' && entry.url.includes(actionUrlPart)
      )).length;

      await observer.page.click('#approval-dialog-confirm');

      await expect(observer.page.locator('#approval-dialog-modal')).toBeHidden();
      await expectApprovalLiveUpdateToast(observer.page);
      await expectCardDetailRouteStable(observer.page, draftCard.id);
      await expect.poll(() => observer.page.evaluate(() => {
        if (typeof activeCardDraft === 'undefined' || !activeCardDraft) return '';
        return String(activeCardDraft.approvalStage || '');
      })).toBe('ON_APPROVAL');
      await expect.poll(() => (
        observerResponses.filter((entry) => (
          entry.method === 'POST' && entry.url.includes(actionUrlPart)
        )).length
      )).toBe(observerPostCountBefore);

      expectNoLegacySnapshotWrites(observerResponses);
    } finally {
      await closeClients(clients);
    }
  });

  test('keeps /card-route/:qr stable and shows a message when live update invalidates stale send dialog without a new request', async ({ browser }) => {
    const adminApi = adminSession.api;
    const csrfToken = adminSession.csrfToken;
    const draftCard = await createDraftCard(adminApi, csrfToken, `Stage4 qr live send ${Date.now()}`);
    const clients = [
      await createLoggedInClient(browser, { baseURL, route: null }),
      await createLoggedInClient(browser, { baseURL, route: null })
    ];
    const actor = clients[0];
    const observer = clients[1];
    const observerResponses = trackRelevantResponses(observer.page);
    const actionUrlPart = `/api/cards-core/${encodeURIComponent(draftCard.id)}/approval/send`;

    try {
      await openCardQrRoute(actor, draftCard);
      const routePath = await openCardQrRoute(observer, draftCard);

      await openCardApprovalDialog(observer.page);
      await observer.page.fill('#approval-dialog-comment', 'Stale QR send from second tab');

      await openCardApprovalDialog(actor.page);
      await actor.page.fill('#approval-dialog-comment', 'First tab sends before QR stale confirm');
      await confirmCardApprovalDialog(actor.page, actionUrlPart, 200);
      await expect(actor.page.locator('#approval-dialog-modal')).toBeHidden();

      await expect.poll(() => observer.page.evaluate((cardId) => {
        if (typeof getCardStoreCard !== 'function') return '';
        return String(getCardStoreCard(cardId)?.approvalStage || '');
      }, draftCard.id)).toBe('ON_APPROVAL');

      const observerPostCountBefore = observerResponses.filter((entry) => (
        entry.method === 'POST' && entry.url.includes(actionUrlPart)
      )).length;

      await observer.page.click('#approval-dialog-confirm');

      await expect(observer.page.locator('#approval-dialog-modal')).toBeHidden();
      await expectApprovalLiveUpdateToast(observer.page);
      await expectExactCardRouteStable(observer.page, routePath, draftCard.id);
      await expect.poll(() => observer.page.evaluate(() => {
        if (typeof activeCardDraft === 'undefined' || !activeCardDraft) return '';
        return String(activeCardDraft.approvalStage || '');
      })).toBe('ON_APPROVAL');
      await expect.poll(() => (
        observerResponses.filter((entry) => (
          entry.method === 'POST' && entry.url.includes(actionUrlPart)
        )).length
      )).toBe(observerPostCountBefore);

      expectNoLegacySnapshotWrites(observerResponses);
    } finally {
      await closeClients(clients);
    }
  });

  test('keeps /cards/:id stable and shows a message when live update invalidates stale return-to-draft dialog without a new request', async ({ browser }) => {
    const adminApi = adminSession.api;
    const csrfToken = adminSession.csrfToken;
    const draftCard = await createDraftCard(adminApi, csrfToken, `Stage4 route live return ${Date.now()}`);
    const sentCard = await sendCardToApprovalByApi(adminApi, csrfToken, draftCard, 'Подготовка карты к stale return');
    await rejectCardByApi(adminApi, csrfToken, sentCard, 'Подготовка отклонения для live return');

    const clients = [
      await createLoggedInClient(browser, { baseURL, route: null }),
      await createLoggedInClient(browser, { baseURL, route: null })
    ];
    const actor = clients[0];
    const observer = clients[1];
    const observerResponses = trackRelevantResponses(observer.page);
    const routePath = `/cards/${encodeURIComponent(draftCard.id)}`;
    const actionUrlPart = `/api/cards-core/${encodeURIComponent(draftCard.id)}/approval/return-to-draft`;

    try {
      await openCardRoute(actor, draftCard);
      await openCardRoute(observer, draftCard);

      await openCardApprovalDialog(observer.page);
      await observer.page.fill('#approval-dialog-comment', 'Stale live return from second tab');

      await openCardApprovalDialog(actor.page);
      await actor.page.fill('#approval-dialog-comment', 'First tab returns to draft');
      await confirmCardApprovalDialog(actor.page, actionUrlPart, 200);
      await expect(actor.page.locator('#approval-dialog-modal')).toBeHidden();

      await expect.poll(() => observer.page.evaluate((cardId) => {
        if (typeof getCardStoreCard !== 'function') return null;
        const card = getCardStoreCard(cardId);
        return card ? {
          stage: String(card.approvalStage || ''),
          rejectionReadByUserName: String(card.rejectionReadByUserName || '')
        } : null;
      }, draftCard.id)).toEqual({
        stage: 'DRAFT',
        rejectionReadByUserName: 'Abyss'
      });

      const observerPostCountBefore = observerResponses.filter((entry) => (
        entry.method === 'POST' && entry.url.includes(actionUrlPart)
      )).length;

      await observer.page.click('#approval-dialog-confirm');

      await expect(observer.page.locator('#approval-dialog-modal')).toBeHidden();
      await expectApprovalLiveUpdateToast(observer.page);
      await expectCardDetailRouteStable(observer.page, draftCard.id);
      await expect.poll(() => observer.page.evaluate(() => {
        if (typeof activeCardDraft === 'undefined' || !activeCardDraft) return null;
        return {
          stage: String(activeCardDraft.approvalStage || ''),
          rejectionReadByUserName: String(activeCardDraft.rejectionReadByUserName || '')
        };
      })).toEqual({
        stage: 'DRAFT',
        rejectionReadByUserName: 'Abyss'
      });
      await expect.poll(() => (
        observerResponses.filter((entry) => (
          entry.method === 'POST' && entry.url.includes(actionUrlPart)
        )).length
      )).toBe(observerPostCountBefore);

      expectNoLegacySnapshotWrites(observerResponses);
    } finally {
      await closeClients(clients);
    }
  });

  test('keeps /card-route/:qr stable and refreshes card detail after stale return-to-draft conflict', async ({ browser }) => {
    const adminApi = adminSession.api;
    const csrfToken = adminSession.csrfToken;
    const draftCard = await createDraftCard(adminApi, csrfToken, `Stage4 qr return conflict ${Date.now()}`);
    const sentCard = await sendCardToApprovalByApi(adminApi, csrfToken, draftCard, 'Подготовка QR карты к конфликту возврата');
    await rejectCardByApi(adminApi, csrfToken, sentCard, 'Подготовка QR отклонения для conflict return');

    const client = await createLoggedInClient(browser, { baseURL, route: null });
    const responses = trackRelevantResponses(client.page);

    try {
      const routePath = await openCardQrRoute(client, draftCard);
      await openCardApprovalDialog(client.page);
      await client.page.fill('#approval-dialog-comment', 'Stale QR return conflict');

      await attachStaleExpectedRevInterceptor(client.page, `/api/cards-core/${encodeURIComponent(draftCard.id)}/approval/return-to-draft`);

      const conflictResponsePromise = client.page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && response.url().includes(`/api/cards-core/${encodeURIComponent(draftCard.id)}/approval/return-to-draft`)
        && response.status() === 409
      ));
      await client.page.click('#approval-dialog-confirm');
      await conflictResponsePromise;

      await expect(client.page.locator('#approval-dialog-modal')).toBeHidden();
      await expectConflictToast(client.page);
      await expectExactCardRouteStable(client.page, routePath, draftCard.id);
      await expect.poll(() => client.page.evaluate((cardId) => {
        if (typeof activeCardDraft === 'undefined' || !activeCardDraft) return null;
        if (String(activeCardDraft.id || '') !== String(cardId || '')) return null;
        return {
          stage: String(activeCardDraft.approvalStage || ''),
          rejectionReadByUserName: String(activeCardDraft.rejectionReadByUserName || '')
        };
      }, draftCard.id)).toEqual({
        stage: 'REJECTED',
        rejectionReadByUserName: ''
      });
      await expect.poll(() => findConsoleEntries(client.diagnostics, /^\[CONFLICT\] cards-core refresh start/i).length).toBeGreaterThan(0);
      await expect.poll(() => findConsoleEntries(client.diagnostics, /^\[CONFLICT\] cards-core refresh done/i).length).toBeGreaterThan(0);

      expectNoLegacySnapshotWrites(responses);
    } finally {
      await closeClients([client]);
    }
  });

  test('approves a card from /approvals without snapshot writes and keeps the route stable', async ({ browser }) => {
    const adminApi = adminSession.api;
    const csrfToken = adminSession.csrfToken;
    const draftCard = await createDraftCard(adminApi, csrfToken, `Stage4 approvals approve ${Date.now()}`);
    await sendCardToApprovalByApi(adminApi, csrfToken, draftCard, 'Подготовка карточки к UI согласованию');

    const client = await createLoggedInClient(browser, { baseURL, route: null });
    const responses = trackRelevantResponses(client.page);

    try {
      await client.page.goto(`${baseURL}/approvals`, { waitUntil: 'domcontentloaded' });
      await waitUsableUi(client.page, '/approvals');
      const row = client.page.locator(`tr[data-card-id="${draftCard.id}"]`);
      await expect(row).toBeVisible();

      await row.locator('button[data-action="approve"]').click();
      await expect(client.page.locator('#approval-approve-modal')).toBeVisible();
      await client.page.fill('#approval-approve-comment', 'UI approval from approvals route');

      const approveResponsePromise = client.page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && response.url().includes(`/api/cards-core/${encodeURIComponent(draftCard.id)}/approval/approve`)
        && response.status() === 200
      ));
      await client.page.click('#approval-approve-confirm');
      await approveResponsePromise;

      await expect(client.page.locator('#approval-approve-modal')).toBeHidden();
      await expect.poll(() => client.page.evaluate(() => window.location.pathname + window.location.search)).toBe('/approvals');
      await expect.poll(() => client.page.evaluate((cardId) => {
        if (typeof getCardStoreCard !== 'function') return '';
        return String(getCardStoreCard(cardId)?.approvalStage || '');
      }, draftCard.id)).toBe('APPROVED');
      await expect(row).toHaveCount(0);

      expect(responses.some((entry) => entry.url.includes(`/api/cards-core/${encodeURIComponent(draftCard.id)}/approval/approve`))).toBeTruthy();
      expectNoLegacySnapshotWrites(responses);
    } finally {
      await closeClients([client]);
    }
  });

  test('keeps /approvals stable and shows a message when live update invalidates stale approve modal without a new request', async ({ browser }) => {
    const adminApi = adminSession.api;
    const csrfToken = adminSession.csrfToken;
    const draftCard = await createDraftCard(adminApi, csrfToken, `Stage4 approvals live approve ${Date.now()}`);
    await sendCardToApprovalByApi(adminApi, csrfToken, draftCard, 'Подготовка карточки к stale live approve');

    const clients = [
      await createLoggedInClient(browser, { baseURL, route: null }),
      await createLoggedInClient(browser, { baseURL, route: null })
    ];
    const actor = clients[0];
    const observer = clients[1];
    const observerResponses = trackRelevantResponses(observer.page);
    const actionUrlPart = `/api/cards-core/${encodeURIComponent(draftCard.id)}/approval/approve`;

    try {
      await actor.page.goto(`${baseURL}/approvals`, { waitUntil: 'domcontentloaded' });
      await observer.page.goto(`${baseURL}/approvals`, { waitUntil: 'domcontentloaded' });
      await waitUsableUi(actor.page, '/approvals');
      await waitUsableUi(observer.page, '/approvals');

      const actorRow = actor.page.locator(`tr[data-card-id="${draftCard.id}"]`);
      const observerRow = observer.page.locator(`tr[data-card-id="${draftCard.id}"]`);
      await expect(actorRow).toBeVisible();
      await expect(observerRow).toBeVisible();

      await observerRow.locator('button[data-action="approve"]').click();
      await expect(observer.page.locator('#approval-approve-modal')).toBeVisible();
      await observer.page.fill('#approval-approve-comment', 'Stale live approve from second tab');

      await actorRow.locator('button[data-action="approve"]').click();
      await actor.page.fill('#approval-approve-comment', 'First tab approves before stale confirm');
      await confirmApprovalModal(actor.page, '#approval-approve-modal', '#approval-approve-confirm', actionUrlPart, 200);
      await expect(actor.page.locator('#approval-approve-modal')).toBeHidden();

      await expect.poll(() => observer.page.evaluate((cardId) => {
        if (typeof getCardStoreCard !== 'function') return '';
        return String(getCardStoreCard(cardId)?.approvalStage || '');
      }, draftCard.id)).toBe('APPROVED');
      await expect(observerRow).toHaveCount(0);

      const observerPostCountBefore = observerResponses.filter((entry) => (
        entry.method === 'POST' && entry.url.includes(actionUrlPart)
      )).length;

      await observer.page.click('#approval-approve-confirm');

      await expect(observer.page.locator('#approval-approve-modal')).toBeHidden();
      await expectApprovalLiveUpdateToast(observer.page);
      await expect.poll(() => observer.page.evaluate(() => window.location.pathname + window.location.search)).toBe('/approvals');
      await expect.poll(() => observer.page.evaluate((cardId) => {
        if (typeof getCardStoreCard !== 'function') return '';
        return String(getCardStoreCard(cardId)?.approvalStage || '');
      }, draftCard.id)).toBe('APPROVED');
      await expect.poll(() => (
        observerResponses.filter((entry) => (
          entry.method === 'POST' && entry.url.includes(actionUrlPart)
        )).length
      )).toBe(observerPostCountBefore);

      expectNoLegacySnapshotWrites(observerResponses);
    } finally {
      await closeClients(clients);
    }
  });

  test('rejects a card from /approvals without snapshot writes and keeps the route stable', async ({ browser }) => {
    const adminApi = adminSession.api;
    const csrfToken = adminSession.csrfToken;
    const draftCard = await createDraftCard(adminApi, csrfToken, `Stage4 approvals reject ${Date.now()}`);
    await sendCardToApprovalByApi(adminApi, csrfToken, draftCard, 'Подготовка карточки к UI отклонению');

    const client = await createLoggedInClient(browser, { baseURL, route: null });
    const responses = trackRelevantResponses(client.page);

    try {
      await client.page.goto(`${baseURL}/approvals`, { waitUntil: 'domcontentloaded' });
      await waitUsableUi(client.page, '/approvals');
      const row = client.page.locator(`tr[data-card-id="${draftCard.id}"]`);
      await expect(row).toBeVisible();

      await row.locator('button[data-action="reject"]').click();
      await expect(client.page.locator('#approval-reject-modal')).toBeVisible();
      await client.page.fill('#approval-reject-text', 'UI reject from approvals route');

      const rejectResponsePromise = client.page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && response.url().includes(`/api/cards-core/${encodeURIComponent(draftCard.id)}/approval/reject`)
        && response.status() === 200
      ));
      await client.page.click('#approval-reject-confirm');
      await rejectResponsePromise;

      await expect(client.page.locator('#approval-reject-modal')).toBeHidden();
      await expect.poll(() => client.page.evaluate(() => window.location.pathname + window.location.search)).toBe('/approvals');
      await expect.poll(() => client.page.evaluate((cardId) => {
        if (typeof getCardStoreCard !== 'function') return null;
        const card = getCardStoreCard(cardId);
        return card ? {
          stage: String(card.approvalStage || ''),
          reason: String(card.rejectionReason || '')
        } : null;
      }, draftCard.id)).toEqual({
        stage: 'REJECTED',
        reason: 'UI reject from approvals route'
      });
      await expect(row).toHaveCount(0);

      expect(responses.some((entry) => entry.url.includes(`/api/cards-core/${encodeURIComponent(draftCard.id)}/approval/reject`))).toBeTruthy();
      expectNoLegacySnapshotWrites(responses);
    } finally {
      await closeClients([client]);
    }
  });

  test('keeps /approvals stable and shows a message when live update invalidates stale reject modal without a new request', async ({ browser }) => {
    const adminApi = adminSession.api;
    const csrfToken = adminSession.csrfToken;
    const draftCard = await createDraftCard(adminApi, csrfToken, `Stage4 approvals live reject ${Date.now()}`);
    await sendCardToApprovalByApi(adminApi, csrfToken, draftCard, 'Подготовка карточки к stale live reject');

    const clients = [
      await createLoggedInClient(browser, { baseURL, route: null }),
      await createLoggedInClient(browser, { baseURL, route: null })
    ];
    const actor = clients[0];
    const observer = clients[1];
    const observerResponses = trackRelevantResponses(observer.page);
    const actionUrlPart = `/api/cards-core/${encodeURIComponent(draftCard.id)}/approval/reject`;

    try {
      await actor.page.goto(`${baseURL}/approvals`, { waitUntil: 'domcontentloaded' });
      await observer.page.goto(`${baseURL}/approvals`, { waitUntil: 'domcontentloaded' });
      await waitUsableUi(actor.page, '/approvals');
      await waitUsableUi(observer.page, '/approvals');

      const actorRow = actor.page.locator(`tr[data-card-id="${draftCard.id}"]`);
      const observerRow = observer.page.locator(`tr[data-card-id="${draftCard.id}"]`);
      await expect(actorRow).toBeVisible();
      await expect(observerRow).toBeVisible();

      await observerRow.locator('button[data-action="reject"]').click();
      await expect(observer.page.locator('#approval-reject-modal')).toBeVisible();
      await observer.page.fill('#approval-reject-text', 'Stale live reject from second tab');

      await actorRow.locator('button[data-action="reject"]').click();
      await actor.page.fill('#approval-reject-text', 'First tab rejects before stale confirm');
      await confirmApprovalModal(actor.page, '#approval-reject-modal', '#approval-reject-confirm', actionUrlPart, 200);
      await expect(actor.page.locator('#approval-reject-modal')).toBeHidden();

      await expect.poll(() => observer.page.evaluate((cardId) => {
        if (typeof getCardStoreCard !== 'function') return null;
        const card = getCardStoreCard(cardId);
        return card ? {
          stage: String(card.approvalStage || ''),
          reason: String(card.rejectionReason || '')
        } : null;
      }, draftCard.id)).toEqual({
        stage: 'REJECTED',
        reason: 'First tab rejects before stale confirm'
      });
      await expect(observerRow).toHaveCount(0);

      const observerPostCountBefore = observerResponses.filter((entry) => (
        entry.method === 'POST' && entry.url.includes(actionUrlPart)
      )).length;

      await observer.page.click('#approval-reject-confirm');

      await expect(observer.page.locator('#approval-reject-modal')).toBeHidden();
      await expectApprovalLiveUpdateToast(observer.page);
      await expect.poll(() => observer.page.evaluate(() => window.location.pathname + window.location.search)).toBe('/approvals');
      await expect.poll(() => observer.page.evaluate((cardId) => {
        if (typeof getCardStoreCard !== 'function') return null;
        const card = getCardStoreCard(cardId);
        return card ? {
          stage: String(card.approvalStage || ''),
          reason: String(card.rejectionReason || '')
        } : null;
      }, draftCard.id)).toEqual({
        stage: 'REJECTED',
        reason: 'First tab rejects before stale confirm'
      });
      await expect.poll(() => (
        observerResponses.filter((entry) => (
          entry.method === 'POST' && entry.url.includes(actionUrlPart)
        )).length
      )).toBe(observerPostCountBefore);

      expectNoLegacySnapshotWrites(observerResponses);
    } finally {
      await closeClients(clients);
    }
  });

  test('keeps /approvals route and refreshes approvals list after stale reject conflict', async ({ browser }) => {
    const adminApi = adminSession.api;
    const csrfToken = adminSession.csrfToken;
    const draftCard = await createDraftCard(adminApi, csrfToken, `Stage4 approvals reject conflict ${Date.now()}`);
    await sendCardToApprovalByApi(adminApi, csrfToken, draftCard, 'Подготовка карточки к conflict reject');

    const client = await createLoggedInClient(browser, { baseURL, route: null });
    const responses = trackRelevantResponses(client.page);

    try {
      await client.page.goto(`${baseURL}/approvals`, { waitUntil: 'domcontentloaded' });
      await waitUsableUi(client.page, '/approvals');
      const row = client.page.locator(`tr[data-card-id="${draftCard.id}"]`);
      await expect(row).toBeVisible();

      const listRefreshBeforeConflict = responses.filter((entry) => (
        entry.method === 'GET'
        && entry.url.includes('/api/data?scope=cards-basic')
      )).length;

      await attachStaleExpectedRevInterceptor(client.page, `/api/cards-core/${encodeURIComponent(draftCard.id)}/approval/reject`);

      await row.locator('button[data-action="reject"]').click();
      await expect(client.page.locator('#approval-reject-modal')).toBeVisible();
      await client.page.fill('#approval-reject-text', 'Stale reject conflict from approvals route');

      const conflictResponsePromise = client.page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && response.url().includes(`/api/cards-core/${encodeURIComponent(draftCard.id)}/approval/reject`)
        && response.status() === 409
      ));
      await client.page.click('#approval-reject-confirm');
      await conflictResponsePromise;

      await expect(client.page.locator('#approval-reject-modal')).toBeHidden();
      await expectConflictToast(client.page);
      await expect.poll(() => client.page.evaluate(() => window.location.pathname + window.location.search)).toBe('/approvals');
      await expect.poll(() => (
        responses.filter((entry) => (
          entry.method === 'GET'
          && entry.url.includes('/api/data?scope=cards-basic')
        )).length
      )).toBeGreaterThan(listRefreshBeforeConflict);
      await expect(row).toBeVisible();

      expectNoLegacySnapshotWrites(responses);
    } finally {
      await closeClients([client]);
    }
  });

  test('keeps /cards/:id route and refreshes card detail after stale send-to-approval conflict', async ({ browser }) => {
    const adminApi = adminSession.api;
    const csrfToken = adminSession.csrfToken;
    const draftCard = await createDraftCard(adminApi, csrfToken, `Stage4 route conflict send ${Date.now()}`);
    const client = await createLoggedInClient(browser, { baseURL, route: null });
    const responses = trackRelevantResponses(client.page);

    try {
      await openCardRoute(client, draftCard);
      await openCardApprovalDialog(client.page);
      await client.page.fill('#approval-dialog-comment', 'Stale send conflict from card route');

      await attachStaleExpectedRevInterceptor(client.page, `/api/cards-core/${encodeURIComponent(draftCard.id)}/approval/send`);

      const conflictResponsePromise = client.page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && response.url().includes(`/api/cards-core/${encodeURIComponent(draftCard.id)}/approval/send`)
        && response.status() === 409
      ));
      await client.page.click('#approval-dialog-confirm');
      await conflictResponsePromise;

      await expect(client.page.locator('#approval-dialog-modal')).toBeHidden();
      await expectConflictToast(client.page);
      await expectCardDetailRouteStable(client.page, draftCard.id);
      await expect.poll(() => client.page.evaluate((cardId) => {
        if (typeof activeCardDraft === 'undefined' || !activeCardDraft) return null;
        if (String(activeCardDraft.id || '') !== String(cardId || '')) return null;
        return String(activeCardDraft.approvalStage || '');
      }, draftCard.id)).toBe('DRAFT');
      await expect.poll(() => findConsoleEntries(client.diagnostics, /^\[CONFLICT\] cards-core refresh start/i).length).toBeGreaterThan(0);
      await expect.poll(() => findConsoleEntries(client.diagnostics, /^\[CONFLICT\] cards-core refresh done/i).length).toBeGreaterThan(0);

      expectNoLegacySnapshotWrites(responses);
    } finally {
      await closeClients([client]);
    }
  });

  test('keeps /approvals route and refreshes approvals list after stale approve conflict', async ({ browser }) => {
    const adminApi = adminSession.api;
    const csrfToken = adminSession.csrfToken;
    const draftCard = await createDraftCard(adminApi, csrfToken, `Stage4 approvals conflict ${Date.now()}`);
    await sendCardToApprovalByApi(adminApi, csrfToken, draftCard, 'Подготовка карточки к conflict approve');

    const client = await createLoggedInClient(browser, { baseURL, route: null });
    const responses = trackRelevantResponses(client.page);

    try {
      await client.page.goto(`${baseURL}/approvals`, { waitUntil: 'domcontentloaded' });
      await waitUsableUi(client.page, '/approvals');
      const row = client.page.locator(`tr[data-card-id="${draftCard.id}"]`);
      await expect(row).toBeVisible();

      const listRefreshBeforeConflict = responses.filter((entry) => (
        entry.method === 'GET'
        && entry.url.includes('/api/data?scope=cards-basic')
      )).length;

      await attachStaleExpectedRevInterceptor(client.page, `/api/cards-core/${encodeURIComponent(draftCard.id)}/approval/approve`);

      await row.locator('button[data-action="approve"]').click();
      await expect(client.page.locator('#approval-approve-modal')).toBeVisible();
      await client.page.fill('#approval-approve-comment', 'Stale approve conflict from approvals route');

      const conflictResponsePromise = client.page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && response.url().includes(`/api/cards-core/${encodeURIComponent(draftCard.id)}/approval/approve`)
        && response.status() === 409
      ));
      await client.page.click('#approval-approve-confirm');
      await conflictResponsePromise;

      await expect(client.page.locator('#approval-approve-modal')).toBeHidden();
      await expectConflictToast(client.page);
      await expect.poll(() => client.page.evaluate(() => window.location.pathname + window.location.search)).toBe('/approvals');
      await expect.poll(() => (
        responses.filter((entry) => (
          entry.method === 'GET'
          && entry.url.includes('/api/data?scope=cards-basic')
        )).length
      )).toBeGreaterThan(listRefreshBeforeConflict);
      await expect(row).toBeVisible();

      expectNoLegacySnapshotWrites(responses);
    } finally {
      await closeClients([client]);
    }
  });
});
