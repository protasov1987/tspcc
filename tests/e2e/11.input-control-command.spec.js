const { test, expect, request: playwrightRequest } = require('@playwright/test');
const { resetDatabaseFromSnapshot } = require('./helpers/snapshot');
const { restartServer, stopServer } = require('./helpers/server');
const { openRouteAndAssert } = require('./helpers/navigation');
const { loginAsAbyss } = require('./helpers/auth');
const { attachDiagnostics, findConsoleEntries } = require('./helpers/diagnostics');
const { createLoggedInClient, closeClients } = require('./helpers/multiclient');

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
    csrfToken: loginBody.csrfToken,
    user: loginBody.user
  };
}

async function createInputControlUser(baseURL, adminApi, adminCsrfToken, suffix) {
  const levelName = `Stage4 Input Control ${suffix}`;
  const levelResponse = await adminApi.post('/api/security/access-levels', {
    headers: {
      'x-csrf-token': adminCsrfToken
    },
    data: {
      name: levelName,
      description: 'Stage 4 input control command test level',
      permissions: {
        tabs: {
          'input-control': { view: true, edit: true }
        }
      }
    }
  });
  expect(levelResponse.ok()).toBeTruthy();
  const levelBody = await levelResponse.json();
  const createdLevel = (levelBody.accessLevels || []).find(level => level && level.name === levelName);
  expect(createdLevel).toBeTruthy();

  const userName = `Stage4Input_${suffix}`;
  const userPassword = `Stage4I${suffix}9`;
  const createUserResponse = await adminApi.post('/api/security/users', {
    headers: {
      'x-csrf-token': adminCsrfToken
    },
    data: {
      name: userName,
      password: userPassword,
      accessLevelId: createdLevel.id,
      status: 'active'
    }
  });
  expect(createUserResponse.ok()).toBeTruthy();

  const session = await loginApi(baseURL, userPassword);
  return {
    levelId: createdLevel.id,
    userName,
    userPassword,
    api: session.api,
    csrfToken: session.csrfToken,
    user: session.user
  };
}

async function createDraftCard(adminApi, adminCsrfToken, name) {
  const response = await adminApi.post('/api/cards-core', {
    headers: {
      'x-csrf-token': adminCsrfToken
    },
    data: {
      name,
      desc: `input control command test ${name}`,
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

async function createApprovedCard(adminApi, adminCsrfToken, name) {
  const draftCard = await createDraftCard(adminApi, adminCsrfToken, name);
  const sendResponse = await adminApi.post(`/api/cards-core/${encodeURIComponent(draftCard.id)}/approval/send`, {
    headers: {
      'x-csrf-token': adminCsrfToken
    },
    data: {
      expectedRev: draftCard.rev,
      comment: 'Отправка на согласование перед входным контролем'
    }
  });
  expect(sendResponse.ok()).toBeTruthy();
  const sendBody = await sendResponse.json();
  const approveResponse = await adminApi.post(`/api/cards-core/${encodeURIComponent(draftCard.id)}/approval/approve`, {
    headers: {
      'x-csrf-token': adminCsrfToken
    },
    data: {
      expectedRev: sendBody.card.rev,
      comment: 'Abyss переводит карту в APPROVED'
    }
  });
  expect(approveResponse.ok()).toBeTruthy();
  const approveBody = await approveResponse.json();
  expect(approveBody.card.approvalStage).toBe('APPROVED');
  return approveBody.card;
}

async function uploadInputControlFile(api, csrfToken, cardId, fileName = 'pvh.pdf') {
  const isImage = /\.(jpg|jpeg)$/i.test(fileName);
  const uploadResponse = await api.post(`/api/cards/${encodeURIComponent(cardId)}/files`, {
    headers: {
      'x-csrf-token': csrfToken
    },
    data: {
      name: fileName,
      type: isImage ? 'image/jpeg' : 'application/pdf',
      size: 8,
      category: 'INPUT_CONTROL',
      scope: 'CARD',
      content: isImage
        ? 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBAQEA8QDw8QDw8PDw8PDw8QDw8QFREWFhURFRUYHSggGBolGxUVITEhJSkrLi4uFx8zODMsNygtLisBCgoKDg0OGhAQGi0fHyUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAgMBIgACEQEDEQH/xAAXAAADAQAAAAAAAAAAAAAAAAAAAQID/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEAMQAAAB6A//xAAVEAEBAAAAAAAAAAAAAAAAAAAAIf/aAAgBAQABBQJf/8QAFBEBAAAAAAAAAAAAAAAAAAAAEP/aAAgBAwEBPwFH/8QAFBEBAAAAAAAAAAAAAAAAAAAAEP/aAAgBAgEBPwFH/8QAFBABAAAAAAAAAAAAAAAAAAAAEP/aAAgBAQAGPwJH/8QAFBABAAAAAAAAAAAAAAAAAAAAEP/aAAgBAQABPyFH/9k='
        : 'data:application/pdf;base64,JVBERi0xCg=='
    }
  });
  expect(uploadResponse.ok()).toBeTruthy();
  return uploadResponse.json();
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

async function attachStaleExpectedRevInterceptor(page, urlPart) {
  let intercepted = false;
  await page.route(`**${urlPart}`, async (route) => {
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

async function expectConflictToast(page) {
  await expect(page.locator('#toast-container .toast').last()).toContainText(/Версия карточки устарела|Карточка уже была изменена другим пользователем\. Данные обновлены\./);
}

async function expectInputControlLiveUpdateToast(page) {
  await expect(page.locator('#toast-container .toast').last()).toContainText(/Данные обновлены|уже выполнен|уже недоступен|потеряло актуальный контекст|потеряло элементы формы/i);
}

async function openCardRoute(client, card, baseURL) {
  const routePath = `/cards/${encodeURIComponent(card.id)}`;
  await client.page.goto(`${baseURL}${routePath}`, { waitUntil: 'domcontentloaded' });
  await expect.poll(() => client.page.evaluate(() => window.location.pathname + window.location.search)).toMatch(/^\/cards\/[^/]+$/);
  await expect.poll(() => client.page.evaluate(() => window.__currentPageId || null)).toBe('page-cards-new');
  await expect.poll(async () => {
    const text = await client.page.locator('#app-main').innerText().catch(() => '');
    return text.trim().length > 20;
  }).toBe(true);
}

async function openCardQrRoute(client, card, baseURL) {
  const routePath = `/card-route/${encodeURIComponent(card.qrId)}`;
  await client.page.goto(`${baseURL}${routePath}`, { waitUntil: 'domcontentloaded' });
  await expect.poll(() => client.page.evaluate(() => window.location.pathname + window.location.search)).toBe(routePath);
  await expect.poll(() => client.page.evaluate(() => window.__currentPageId || null)).toBe('page-cards-new');
  await expect.poll(() => client.page.evaluate(() => {
    if (typeof getActiveCardId !== 'function') return '';
    return String(getActiveCardId() || '');
  })).toBe(String(card.id || ''));
}

async function expectCardDetailRouteStable(page, cardId) {
  await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toMatch(/^\/cards\/[^/]+$/);
  await expect.poll(() => page.evaluate(() => window.__currentPageId || null)).toBe('page-cards-new');
  await expect.poll(() => page.evaluate(() => {
    if (typeof getActiveCardId !== 'function') return '';
    return String(getActiveCardId() || '');
  })).toBe(String(cardId || ''));
}

async function expectExactCardRouteStable(page, routePath, cardId) {
  await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe(routePath);
  await expect.poll(() => page.evaluate(() => window.__currentPageId || null)).toBe('page-cards-new');
  await expect.poll(() => page.evaluate(() => {
    if (typeof getActiveCardId !== 'function') return '';
    return String(getActiveCardId() || '');
  })).toBe(String(cardId || ''));
}

async function openInputControlModalOnActiveCard(page) {
  await page.evaluate(() => {
    const cardId = typeof getActiveCardId === 'function' ? getActiveCardId() : '';
    if (!cardId || typeof openInputControlModal !== 'function') {
      throw new Error('Input-control modal is unavailable on current card route');
    }
    openInputControlModal(cardId);
  });
  await expect(page.locator('#input-control-modal')).toBeVisible();
}

test.describe('input control command path', () => {
  test.beforeAll(async () => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
  });

  test.afterAll(async () => {
    await stopServer();
  });

  test('supports permission-based input control command, stale conflict and existing inputControlFileId', async ({}, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const { api: adminApi, csrfToken: adminCsrfToken } = await loginApi(baseURL);
    const suffix = String(Date.now()).slice(-6);
    const inputControlUser = await createInputControlUser(baseURL, adminApi, adminCsrfToken, suffix);

    try {
      const approvedCard = await createApprovedCard(adminApi, adminCsrfToken, `Stage4 input control ${suffix}`);
      const uploadBody = await uploadInputControlFile(adminApi, adminCsrfToken, approvedCard.id);
      expect(uploadBody.inputControlFileId).toBeTruthy();

      const detailResponse = await adminApi.get(`/api/cards-core/${encodeURIComponent(approvedCard.id)}`);
      expect(detailResponse.ok()).toBeTruthy();
      const detailBody = await detailResponse.json();
      expect(detailBody.card.inputControlFileId).toBe(uploadBody.inputControlFileId);

      const completeResponse = await inputControlUser.api.post(`/api/cards-core/${encodeURIComponent(approvedCard.id)}/input-control/complete`, {
        headers: {
          'x-csrf-token': inputControlUser.csrfToken
        },
        data: {
          expectedRev: detailBody.card.rev,
          comment: 'Входной контроль выполнен отдельной командой'
        }
      });
      expect(completeResponse.ok()).toBeTruthy();
      const completeBody = await completeResponse.json();
      expect(completeBody.command).toBe('complete');
      expect(completeBody.card.id).toBe(approvedCard.id);
      expect(completeBody.card.inputControlComment).toBe('Входной контроль выполнен отдельной командой');
      expect(completeBody.card.inputControlDoneBy).toBe(inputControlUser.userName);
      expect(completeBody.card.inputControlDoneAt).toEqual(expect.any(Number));
      expect(completeBody.card.inputControlFileId).toBe(uploadBody.inputControlFileId);
      expect(completeBody.card.approvalStage).toBe('WAITING_PROVISION');
      expect(completeBody.card.approvalThread.at(-1)).toMatchObject({
        actionType: 'INPUT_CONTROL_COMPLETE',
        comment: 'Входной контроль выполнен отдельной командой',
        userName: inputControlUser.userName
      });
      expect(
        (completeBody.card.logs || []).some(log => (
          log
          && log.action === 'Входной контроль'
          && log.field === 'inputControlComment'
          && log.newValue === 'Входной контроль выполнен отдельной командой'
        ))
      ).toBeTruthy();

      const staleResponse = await inputControlUser.api.post(`/api/cards-core/${encodeURIComponent(approvedCard.id)}/input-control/complete`, {
        headers: {
          'x-csrf-token': inputControlUser.csrfToken
        },
        data: {
          expectedRev: detailBody.card.rev,
          comment: 'Повтор со stale expectedRev'
        }
      });
      expect(staleResponse.status()).toBe(409);
      const staleBody = await staleResponse.json();
      expect(staleBody.code).toBe('STALE_REVISION');
      expect(staleBody.entity).toBe('card');
      expect(staleBody.id).toBe(approvedCard.id);
      expect(staleBody.expectedRev).toBe(detailBody.card.rev);
      expect(staleBody.actualRev).toBe(completeBody.card.rev);
    } finally {
      await inputControlUser.api.dispose();
      await adminApi.dispose();
    }
  });

  test('keeps /input-control route after UI command and after F5', async ({ page }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const { api: adminApi, csrfToken: adminCsrfToken } = await loginApi(baseURL);
    const responses = trackRelevantResponses(page);

    try {
      const approvedCard = await createApprovedCard(adminApi, adminCsrfToken, `Stage4 route ${Date.now()}`);
      await loginAsAbyss(page, { startPath: '/input-control' });
      await openRouteAndAssert(page, '/input-control');

      const row = page.locator(`tr[data-card-id="${approvedCard.id}"]`);
      await expect(row).toBeVisible();
      await row.getByRole('button', { name: 'Входной контроль' }).click();
      await page.locator('#input-control-comment-input').fill('UI command keeps route context');
      await page.locator('#input-control-confirm').click();

      await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe('/input-control');
      await expect(row).toHaveCount(0);
      expect(responses.some((entry) => entry.url.includes(`/api/cards-core/${encodeURIComponent(approvedCard.id)}/input-control/complete`))).toBeTruthy();
      expectNoLegacySnapshotWrites(responses);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await openRouteAndAssert(page, '/input-control');
      await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe('/input-control');
    } finally {
      await adminApi.dispose();
    }
  });

  test('keeps /input-control route and refreshes list after stale input-control conflict', async ({ page }, testInfo) => {
    const diagnostics = attachDiagnostics(page);
    const baseURL = testInfo.project.use.baseURL;
    const { api: adminApi, csrfToken: adminCsrfToken } = await loginApi(baseURL);
    const responses = trackRelevantResponses(page);

    try {
      const approvedCard = await createApprovedCard(adminApi, adminCsrfToken, `Stage4 input-control conflict ${Date.now()}`);
      await loginAsAbyss(page, { startPath: '/input-control' });
      await openRouteAndAssert(page, '/input-control');

      const row = page.locator(`tr[data-card-id="${approvedCard.id}"]`);
      await expect(row).toBeVisible();
      const listRefreshBeforeConflict = responses.filter((entry) => (
        entry.method === 'GET'
        && entry.url.includes('/api/data?scope=cards-basic')
      )).length;

      await attachStaleExpectedRevInterceptor(page, `/api/cards-core/${encodeURIComponent(approvedCard.id)}/input-control/complete`);

      await row.getByRole('button', { name: 'Входной контроль' }).click();
      await page.locator('#input-control-comment-input').fill('UI input-control conflict');

      const conflictResponsePromise = page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && response.url().includes(`/api/cards-core/${encodeURIComponent(approvedCard.id)}/input-control/complete`)
        && response.status() === 409
      ));
      await page.locator('#input-control-confirm').click();
      await conflictResponsePromise;

      await expect(page.locator('#input-control-modal')).toBeHidden();
      await expect(page.locator('#toast-container .toast').last()).toContainText(/Версия карточки устарела|Карточка уже была изменена другим пользователем\. Данные обновлены\./);
      await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe('/input-control');
      await expect.poll(() => (
        responses.filter((entry) => (
          entry.method === 'GET'
          && entry.url.includes('/api/data?scope=cards-basic')
        )).length
      )).toBeGreaterThan(listRefreshBeforeConflict);
      await expect(row).toBeVisible();
      await expect.poll(() => findConsoleEntries(diagnostics, /^\[CONFLICT\] cards-core scope refresh start/i).length).toBeGreaterThan(0);
      await expect.poll(() => findConsoleEntries(diagnostics, /^\[CONFLICT\] cards-core scope refresh done/i).length).toBeGreaterThan(0);
      expectNoLegacySnapshotWrites(responses);
    } finally {
      await adminApi.dispose();
    }
  });

  test('keeps /cards/:id stable and shows a message when live update invalidates stale input-control modal without a new request', async ({ browser }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const { api: adminApi, csrfToken: adminCsrfToken } = await loginApi(baseURL);
    const approvedCard = await createApprovedCard(adminApi, adminCsrfToken, `Stage4 input-control stale detail ${Date.now()}`);
    const clients = [
      await createLoggedInClient(browser, { baseURL, route: null }),
      await createLoggedInClient(browser, { baseURL, route: null })
    ];
    const actor = clients[0];
    const observer = clients[1];
    const observerResponses = trackRelevantResponses(observer.page);
    const actionUrlPart = `/api/cards-core/${encodeURIComponent(approvedCard.id)}/input-control/complete`;

    try {
      await openCardRoute(actor, approvedCard, baseURL);
      await openCardRoute(observer, approvedCard, baseURL);

      await openInputControlModalOnActiveCard(observer.page);
      await observer.page.fill('#input-control-comment-input', 'Second tab stale input control');

      await openInputControlModalOnActiveCard(actor.page);
      await actor.page.fill('#input-control-comment-input', 'First tab completes input control');

      const actorResponsePromise = actor.page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && response.url().includes(actionUrlPart)
        && response.status() === 200
      ));
      await actor.page.click('#input-control-confirm');
      await actorResponsePromise;
      await expect(actor.page.locator('#input-control-modal')).toBeHidden();

      await expect.poll(() => observer.page.evaluate((cardId) => {
        if (typeof getCardStoreCard !== 'function') return null;
        const card = getCardStoreCard(cardId);
        return card ? {
          stage: String(card.approvalStage || ''),
          inputControlDoneAt: Number(card.inputControlDoneAt || 0)
        } : null;
      }, approvedCard.id)).toEqual({
        stage: 'WAITING_PROVISION',
        inputControlDoneAt: expect.any(Number)
      });

      const observerPostCountBefore = observerResponses.filter((entry) => (
        entry.method === 'POST' && entry.url.includes(actionUrlPart)
      )).length;

      await observer.page.click('#input-control-confirm');

      await expect(observer.page.locator('#input-control-modal')).toBeHidden();
      await expectInputControlLiveUpdateToast(observer.page);
      await expectCardDetailRouteStable(observer.page, approvedCard.id);
      await expect.poll(() => observer.page.evaluate(() => {
        if (typeof activeCardDraft === 'undefined' || !activeCardDraft) return null;
        return {
          stage: String(activeCardDraft.approvalStage || ''),
          inputControlDoneAt: Number(activeCardDraft.inputControlDoneAt || 0)
        };
      })).toEqual({
        stage: 'WAITING_PROVISION',
        inputControlDoneAt: expect.any(Number)
      });
      await expect.poll(() => (
        observerResponses.filter((entry) => (
          entry.method === 'POST' && entry.url.includes(actionUrlPart)
        )).length
      )).toBe(observerPostCountBefore);
      await expect.poll(() => findConsoleEntries(observer.diagnostics, /^\[CONFLICT\] lifecycle modal local invalid state/i).length).toBeGreaterThan(0);

      expectNoLegacySnapshotWrites(observerResponses);
    } finally {
      await closeClients(clients);
      await adminApi.dispose();
    }
  });

  test('keeps /card-route/:qr stable and refreshes card detail after stale input-control conflict', async ({ browser }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const { api: adminApi, csrfToken: adminCsrfToken } = await loginApi(baseURL);
    const approvedCard = await createApprovedCard(adminApi, adminCsrfToken, `Stage4 input-control card-route conflict ${Date.now()}`);
    const client = await createLoggedInClient(browser, { baseURL, route: null });
    const responses = trackRelevantResponses(client.page);
    const routePath = `/card-route/${encodeURIComponent(approvedCard.qrId)}`;

    try {
      await openCardQrRoute(client, approvedCard, baseURL);
      await openInputControlModalOnActiveCard(client.page);
      await client.page.fill('#input-control-comment-input', 'Stale input control conflict from card-route');

      await attachStaleExpectedRevInterceptor(client.page, `/api/cards-core/${encodeURIComponent(approvedCard.id)}/input-control/complete`);

      const conflictResponsePromise = client.page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && response.url().includes(`/api/cards-core/${encodeURIComponent(approvedCard.id)}/input-control/complete`)
        && response.status() === 409
      ));
      await client.page.click('#input-control-confirm');
      await conflictResponsePromise;

      await expect(client.page.locator('#input-control-modal')).toBeHidden();
      await expectConflictToast(client.page);
      await expectExactCardRouteStable(client.page, routePath, approvedCard.id);
      await expect.poll(() => client.page.evaluate((cardId) => {
        if (typeof activeCardDraft === 'undefined' || !activeCardDraft) return null;
        if (String(activeCardDraft.id || '') !== String(cardId || '')) return null;
        return {
          stage: String(activeCardDraft.approvalStage || ''),
          inputControlDoneAt: activeCardDraft.inputControlDoneAt == null ? null : Number(activeCardDraft.inputControlDoneAt)
        };
      }, approvedCard.id)).toEqual({
        stage: 'APPROVED',
        inputControlDoneAt: null
      });
      await expect.poll(() => findConsoleEntries(client.diagnostics, /^\[CONFLICT\] cards-core refresh start/i).length).toBeGreaterThan(0);
      await expect.poll(() => findConsoleEntries(client.diagnostics, /^\[CONFLICT\] cards-core refresh done/i).length).toBeGreaterThan(0);

      expectNoLegacySnapshotWrites(responses);
    } finally {
      await closeClients([client]);
      await adminApi.dispose();
    }
  });

  test('syncs input-control files into /card-route live view and keeps clean attachment names', async ({ page }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const { api: adminApi, csrfToken: adminCsrfToken } = await loginApi(baseURL);

    try {
      const approvedCard = await createApprovedCard(adminApi, adminCsrfToken, `Stage4 route file sync ${Date.now()}`);
      const routePath = `/card-route/${encodeURIComponent(approvedCard.qrId)}`;

      await loginAsAbyss(page, { startPath: routePath });
      await openRouteAndAssert(page, routePath);

      await page.locator('[data-action="card-tab"][data-tab-target="tab-input-control"]').click();
      const fileInfo = page.locator('#input-control-file-info');
      await expect(fileInfo).toContainText('Файл ПВХ ещё не добавлен.');

      await uploadInputControlFile(adminApi, adminCsrfToken, approvedCard.id, 'ПВХ - route-live.jpg.jpg');

      const fileName = fileInfo.locator('strong').first();
      await expect(fileName).toHaveText('ПВХ - route-live.jpg');
      await expect(fileInfo.locator('button[data-action="input-control-preview-file"]').first()).toHaveAttribute('data-file-rel-path', /input-control\//);

      const popupPromise = page.waitForEvent('popup');
      await fileInfo.locator('button[data-action="input-control-preview-file"]').first().click();
      const popup = await popupPromise;
      await expect.poll(() => popup.url() === 'about:blank', { timeout: 10000 }).toBe(false);
      await popup.waitForLoadState('domcontentloaded').catch(() => {});
      await popup.close().catch(() => {});

      const downloadPromise = page.waitForEvent('download');
      await fileInfo.locator('button[data-action="input-control-download-file"]').first().click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe('ПВХ - route-live.jpg');
    } finally {
      await adminApi.dispose();
    }
  });

  test('keeps input-control preview and download enabled on readonly /card-route when file already exists', async ({ page }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const { api: adminApi, csrfToken: adminCsrfToken } = await loginApi(baseURL);

    try {
      const approvedCard = await createApprovedCard(adminApi, adminCsrfToken, `Stage4 readonly route file ${Date.now()}`);
      await uploadInputControlFile(adminApi, adminCsrfToken, approvedCard.id, 'readonly-existing.jpg');

      const routePath = `/card-route/${encodeURIComponent(approvedCard.qrId)}`;
      await loginAsAbyss(page, { startPath: routePath });
      await openRouteAndAssert(page, routePath);

      await page.waitForTimeout(1500);
      await page.locator('[data-action="card-tab"][data-tab-target="tab-input-control"]').click();
      const previewBtn = page.locator('#input-control-file-info button[data-action="input-control-preview-file"]').first();
      const downloadBtn = page.locator('#input-control-file-info button[data-action="input-control-download-file"]').first();

      await expect(previewBtn).toBeVisible();
      await expect(downloadBtn).toBeVisible();
      await expect(previewBtn).toBeEnabled();
      await expect(downloadBtn).toBeEnabled();

      const popupPromise = page.waitForEvent('popup');
      await previewBtn.click();
      const popup = await popupPromise;
      await expect.poll(() => popup.url() === 'about:blank', { timeout: 10000 }).toBe(false);
      await popup.waitForLoadState('domcontentloaded').catch(() => {});
      await popup.close().catch(() => {});

      const downloadPromise = page.waitForEvent('download');
      await downloadBtn.click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe('readonly-existing.jpg');
    } finally {
      await adminApi.dispose();
    }
  });
});
