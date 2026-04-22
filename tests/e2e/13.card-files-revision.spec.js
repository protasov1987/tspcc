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
    csrfToken: loginBody.csrfToken,
    user: loginBody.user
  };
}

async function createDraftCard(api, csrfToken, name) {
  const response = await api.post('/api/cards-core', {
    headers: {
      'x-csrf-token': csrfToken
    },
    data: {
      name,
      desc: `card files revision test ${name}`,
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

async function findCardWithQr(api) {
  const response = await api.get('/api/cards-core?archived=active');
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  const cards = Array.isArray(body.cards) ? body.cards : [];
  const card = cards.find((entry) => /^[A-Z0-9]{6,32}$/.test(String(entry?.qrId || '').trim()));
  expect(card).toBeTruthy();
  return card;
}

async function uploadCardFile(api, csrfToken, cardId, {
  expectedRev,
  fileName = 'test.pdf',
  mimeType = 'application/pdf',
  size = 8,
  category = 'GENERAL',
  scope = 'CARD',
  content = 'data:application/pdf;base64,JVBERi0xCg==',
  operationLabel = '',
  itemsLabel = '',
  opId = '',
  opCode = '',
  opName = ''
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
      scope,
      operationLabel,
      itemsLabel,
      opId,
      opCode,
      opName
    }
  });
}

async function resyncCardFiles(api, csrfToken, cardId, expectedRev) {
  return api.post(`/api/cards/${encodeURIComponent(cardId)}/files/resync`, {
    headers: {
      'x-csrf-token': csrfToken
    },
    data: {
      expectedRev
    }
  });
}

async function deleteCardFile(api, csrfToken, cardId, fileId, expectedRev) {
  return api.delete(`/api/cards/${encodeURIComponent(cardId)}/files/${encodeURIComponent(fileId)}`, {
    headers: {
      'x-csrf-token': csrfToken
    },
    data: {
      expectedRev
    }
  });
}

function expectCardFilesPayload(payload, cardId) {
  expect(payload.cardRev).toBe(payload.rev);
  expect(payload.card).toBeTruthy();
  expect(payload.card.id).toBe(cardId);
  expect(payload.card.rev).toBe(payload.cardRev);
  expect(Array.isArray(payload.files)).toBeTruthy();
  expect(Array.isArray(payload.attachments)).toBeTruthy();
  expect(payload.filesCount).toBe(payload.files.length);
}

function trackFileResponses(page, cardId) {
  const entries = [];
  const encodedCardId = encodeURIComponent(cardId);
  page.on('response', async (response) => {
    const request = response.request();
    const method = request.method();
    const url = response.url();
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return;
    if (!url.includes(`/api/cards/${encodedCardId}/files`) && !url.includes('/api/data')) return;
    entries.push({
      method,
      status: response.status(),
      url
    });
  });
  return entries;
}

async function attachStaleExpectedRevInterceptor(page, urlPart) {
  let intercepted = false;
  await page.route(`**${urlPart}`, async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') {
      await route.continue();
      return;
    }
    if (intercepted) {
      await route.continue();
      return;
    }
    intercepted = true;
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

test.describe('card files revision-safe contract', () => {
  test.beforeAll(async () => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
  });

  test.afterAll(async () => {
    await stopServer();
  });

  test('returns revision-safe success payload for upload, delete and resync and keeps inputControlFileId consistent', async ({}, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const { api, csrfToken } = await loginApi(baseURL);

    try {
      const draftCard = await findCardWithQr(api);
      const initialFilesCount = Array.isArray(draftCard.attachments) ? draftCard.attachments.length : 0;

      const inputControlResponse = await uploadCardFile(api, csrfToken, draftCard.id, {
        expectedRev: draftCard.rev,
        fileName: `pvh-${Date.now()}.pdf`,
        category: 'INPUT_CONTROL'
      });
      expect(inputControlResponse.ok()).toBeTruthy();
      const inputControlBody = await inputControlResponse.json();
      expectCardFilesPayload(inputControlBody, draftCard.id);
      expect(inputControlBody.status).toBe('ok');
      expect(inputControlBody.file.id).toBeTruthy();
      expect(inputControlBody.inputControlFileId).toBe(inputControlBody.file.id);
      expect(inputControlBody.card.inputControlFileId).toBe(inputControlBody.file.id);

      const generalFileName = `general-${Date.now()}.pdf`;
      const generalResponse = await uploadCardFile(api, csrfToken, draftCard.id, {
        expectedRev: inputControlBody.cardRev,
        fileName: generalFileName,
        category: 'GENERAL'
      });
      expect(generalResponse.ok()).toBeTruthy();
      const generalBody = await generalResponse.json();
      expectCardFilesPayload(generalBody, draftCard.id);
      expect(generalBody.filesCount).toBe(initialFilesCount + 2);
      expect(generalBody.inputControlFileId).toBe(inputControlBody.inputControlFileId);
      expect(generalBody.card.inputControlFileId).toBe(inputControlBody.inputControlFileId);

      const resyncResponse = await resyncCardFiles(api, csrfToken, draftCard.id, generalBody.cardRev);
      expect(resyncResponse.ok()).toBeTruthy();
      const resyncBody = await resyncResponse.json();
      expectCardFilesPayload(resyncBody, draftCard.id);
      expect(typeof resyncBody.changed).toBe('boolean');
      expect(resyncBody.cardRev).toBeGreaterThanOrEqual(generalBody.cardRev);
      expect(resyncBody.inputControlFileId).toBe(inputControlBody.inputControlFileId);

      const generalFile = resyncBody.files.find((file) => file && file.name === generalFileName);
      expect(generalFile?.id).toBeTruthy();
      const deleteResponse = await deleteCardFile(api, csrfToken, draftCard.id, generalFile.id, resyncBody.cardRev);
      expect(deleteResponse.ok()).toBeTruthy();
      const deleteBody = await deleteResponse.json();
      expectCardFilesPayload(deleteBody, draftCard.id);
      expect(deleteBody.status).toBe('ok');
      expect(deleteBody.filesCount).toBe(resyncBody.filesCount - 1);
      expect(deleteBody.inputControlFileId).toBe(inputControlBody.inputControlFileId);
      expect(deleteBody.card.inputControlFileId).toBe(inputControlBody.inputControlFileId);
      expect(deleteBody.cardRev).toBeGreaterThan(resyncBody.cardRev);
    } finally {
      await api.dispose();
    }
  });

  test('returns 409 STALE_REVISION with current card payload for upload, delete and resync', async ({}, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const { api, csrfToken } = await loginApi(baseURL);

    try {
      const draftCard = await findCardWithQr(api);
      const staleFileName = `stale-${Date.now()}.pdf`;

      const uploadResponse = await uploadCardFile(api, csrfToken, draftCard.id, {
        expectedRev: draftCard.rev,
        fileName: staleFileName,
        category: 'GENERAL'
      });
      expect(uploadResponse.ok()).toBeTruthy();
      const uploadBody = await uploadResponse.json();
      expectCardFilesPayload(uploadBody, draftCard.id);

      const staleUploadResponse = await uploadCardFile(api, csrfToken, draftCard.id, {
        expectedRev: draftCard.rev,
        fileName: `stale-second-${Date.now()}.pdf`,
        category: 'GENERAL'
      });
      expect(staleUploadResponse.status()).toBe(409);
      const staleUploadBody = await staleUploadResponse.json();
      expect(staleUploadBody.code).toBe('STALE_REVISION');
      expect(staleUploadBody.entity).toBe('card');
      expect(staleUploadBody.id).toBe(draftCard.id);
      expect(staleUploadBody.expectedRev).toBe(draftCard.rev);
      expect(staleUploadBody.actualRev).toBe(uploadBody.cardRev);
      expectCardFilesPayload(staleUploadBody, draftCard.id);

      const staleResyncResponse = await resyncCardFiles(api, csrfToken, draftCard.id, draftCard.rev);
      expect(staleResyncResponse.status()).toBe(409);
      const staleResyncBody = await staleResyncResponse.json();
      expect(staleResyncBody.code).toBe('STALE_REVISION');
      expect(staleResyncBody.expectedRev).toBe(draftCard.rev);
      expect(staleResyncBody.actualRev).toBe(uploadBody.cardRev);
      expectCardFilesPayload(staleResyncBody, draftCard.id);

      const uploadedFile = uploadBody.files.find((file) => file && file.name === staleFileName);
      expect(uploadedFile?.id).toBeTruthy();
      const staleDeleteResponse = await deleteCardFile(api, csrfToken, draftCard.id, uploadedFile.id, draftCard.rev);
      expect(staleDeleteResponse.status()).toBe(409);
      const staleDeleteBody = await staleDeleteResponse.json();
      expect(staleDeleteBody.code).toBe('STALE_REVISION');
      expect(staleDeleteBody.expectedRev).toBe(draftCard.rev);
      expect(staleDeleteBody.actualRev).toBe(uploadBody.cardRev);
      expectCardFilesPayload(staleDeleteBody, draftCard.id);
    } finally {
      await api.dispose();
    }
  });

  test('keeps duplicate PARTS_DOCS guard on the server', async ({}, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const { api, csrfToken } = await loginApi(baseURL);

    try {
      const draftCard = await findCardWithQr(api);
      const fileName = `parts-doc-${Date.now()}.pdf`;

      const firstResponse = await uploadCardFile(api, csrfToken, draftCard.id, {
        expectedRev: draftCard.rev,
        fileName,
        category: 'PARTS_DOCS'
      });
      expect(firstResponse.ok()).toBeTruthy();
      const firstBody = await firstResponse.json();
      expectCardFilesPayload(firstBody, draftCard.id);

      const duplicateResponse = await uploadCardFile(api, csrfToken, draftCard.id, {
        expectedRev: firstBody.cardRev,
        fileName,
        category: 'PARTS_DOCS'
      });
      expect(duplicateResponse.status()).toBe(409);
      const duplicateBody = await duplicateResponse.json();
      expect(duplicateBody.code).toBe('DUPLICATE_PARTS_DOCS');
      expect(duplicateBody.error).toContain('уже загружен');
      expectCardFilesPayload(duplicateBody, draftCard.id);
      expect(duplicateBody.filesCount).toBe(firstBody.filesCount);
    } finally {
      await api.dispose();
    }
  });

  test('keeps /cards/:id route stable after stale file upload conflict', async ({ page }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const { api } = await loginApi(baseURL);

    try {
      const draftCard = await findCardWithQr(api);
      const routePath = `/cards/${encodeURIComponent(draftCard.qrId)}`;
      const fileUrlPart = `/api/cards/${encodeURIComponent(draftCard.id)}/files`;
      const responses = trackFileResponses(page, draftCard.id);

      await loginAsAbyss(page, { startPath: routePath });
      await waitUsableUi(page, routePath);
      await attachStaleExpectedRevInterceptor(page, fileUrlPart);

      await page.locator('#card-attachments-btn').click();
      await expect(page.locator('#attachments-modal')).toBeVisible();

      const uploadPromise = page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && response.url().includes(fileUrlPart)
      ));
      await page.setInputFiles('#attachments-input', {
        name: 'route-stale.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('JVBERi0xCg==', 'base64')
      });
      const uploadResponse = await uploadPromise;
      expect(uploadResponse.status()).toBe(409);

      await expect(page.locator('#toast-container .toast').last()).toContainText(/Версия карточки устарела|Карточка уже была изменена другим пользователем\. Данные обновлены\./);
      await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe(routePath);
      await expect.poll(() => page.evaluate(() => window.__currentPageId || null)).toBe('page-cards-new');
      expect(responses.some((entry) => entry.url.includes('/api/data') && entry.method !== 'GET')).toBeFalsy();
    } finally {
      await api.dispose();
    }
  });
});
