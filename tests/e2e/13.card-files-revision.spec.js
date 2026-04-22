const { test, expect, request: playwrightRequest } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { resetDatabaseFromSnapshot } = require('./helpers/snapshot');
const { restartServer, stopServer } = require('./helpers/server');
const { loginAsAbyss } = require('./helpers/auth');
const { waitUsableUi } = require('./helpers/navigation');
const { repoRoot } = require('./helpers/paths');

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
  const qrId = `S5${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
  const response = await api.post('/api/cards-core', {
    headers: {
      'x-csrf-token': csrfToken
    },
    data: {
      name,
      desc: `card files revision test ${name}`,
      qrId,
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

async function getCardById(api, cardId) {
  const response = await api.get(`/api/cards-core/${encodeURIComponent(cardId)}`);
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.card).toBeTruthy();
  return body.card;
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

function getCardStorageFilePath(card, file) {
  return path.join(repoRoot, 'storage', 'cards', String(card?.qrId || '').trim(), String(file?.relPath || '').trim());
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

function trackFileAndDetailResponses(page, cardId) {
  const entries = [];
  const encodedCardId = encodeURIComponent(cardId);
  page.on('response', async (response) => {
    const request = response.request();
    const method = request.method();
    const url = response.url();
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return;
    if (
      !url.includes(`/api/cards/${encodedCardId}/files`)
      && !url.includes(`/api/cards-core/${encodedCardId}`)
      && !url.includes('/api/data')
    ) {
      return;
    }
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

async function blockCardsSse(page) {
  await page.route('**/api/events/stream', async (route) => {
    await route.abort();
  });
}

async function stubWindowOpen(page) {
  await page.addInitScript(() => {
    window.open = () => ({
      closed: false,
      close() {},
      document: {
        write() {},
        close() {}
      },
      location: {
        href: ''
      }
    });
  });
}

async function clearAttachmentRelPathInUi(page, cardId, fileId) {
  await page.evaluate(({ targetCardId, targetFileId }) => {
    const patchCard = (card) => {
      if (!card || !Array.isArray(card.attachments)) return false;
      const attachment = card.attachments.find((file) => file && file.id === targetFileId);
      if (!attachment) return false;
      attachment.relPath = '';
      return true;
    };

    if (typeof activeCardDraft !== 'undefined' && activeCardDraft && activeCardDraft.id === targetCardId) {
      patchCard(activeCardDraft);
    }
    if (Array.isArray(cards)) {
      const liveCard = cards.find((card) => card && card.id === targetCardId);
      patchCard(liveCard);
    }
    if (typeof renderAttachmentsModal === 'function') {
      renderAttachmentsModal();
    }
  }, {
    targetCardId: cardId,
    targetFileId: fileId
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
      const createdCard = await createDraftCard(api, csrfToken, `Stage5 files success ${Date.now()}`);
      const draftCard = await getCardById(api, createdCard.id);
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
      expect(resyncBody.inputControlFileId).toBeTruthy();
      expect(resyncBody.card.inputControlFileId).toBe(resyncBody.inputControlFileId);
      const resyncedInputControlFile = resyncBody.files.find((file) => file && file.id === resyncBody.inputControlFileId);
      expect(resyncedInputControlFile?.category).toBe('INPUT_CONTROL');

      const generalFile = resyncBody.files.find((file) => file && file.name === generalFileName);
      expect(generalFile?.id).toBeTruthy();
      const deleteResponse = await deleteCardFile(api, csrfToken, draftCard.id, generalFile.id, resyncBody.cardRev);
      expect(deleteResponse.ok()).toBeTruthy();
      const deleteBody = await deleteResponse.json();
      expectCardFilesPayload(deleteBody, draftCard.id);
      expect(deleteBody.status).toBe('ok');
      expect(deleteBody.filesCount).toBe(resyncBody.filesCount - 1);
      expect(deleteBody.inputControlFileId).toBe(resyncBody.inputControlFileId);
      expect(deleteBody.card.inputControlFileId).toBe(resyncBody.inputControlFileId);
      expect(deleteBody.cardRev).toBeGreaterThan(resyncBody.cardRev);
    } finally {
      await api.dispose();
    }
  });

  test('relinks and clears inputControlFileId when linked input-control files are deleted', async ({}, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const { api, csrfToken } = await loginApi(baseURL);

    try {
      const createdCard = await createDraftCard(api, csrfToken, `Stage5 ic delete linkage ${Date.now()}`);
      const draftCard = await getCardById(api, createdCard.id);

      const firstUploadResponse = await uploadCardFile(api, csrfToken, draftCard.id, {
        expectedRev: draftCard.rev,
        fileName: `ic-delete-first-${Date.now()}.pdf`,
        category: 'INPUT_CONTROL'
      });
      expect(firstUploadResponse.ok()).toBeTruthy();
      const firstUploadBody = await firstUploadResponse.json();
      const firstFile = firstUploadBody.file;
      expect(firstFile?.id).toBeTruthy();
      expect(firstUploadBody.inputControlFileId).toBe(firstFile.id);

      const secondUploadResponse = await uploadCardFile(api, csrfToken, draftCard.id, {
        expectedRev: firstUploadBody.cardRev,
        fileName: `ic-delete-second-${Date.now()}.pdf`,
        category: 'INPUT_CONTROL'
      });
      expect(secondUploadResponse.ok()).toBeTruthy();
      const secondUploadBody = await secondUploadResponse.json();
      const secondFile = secondUploadBody.file;
      expect(secondFile?.id).toBeTruthy();
      expect(secondUploadBody.inputControlFileId).toBe(secondFile.id);

      const deleteLinkedResponse = await deleteCardFile(api, csrfToken, draftCard.id, secondFile.id, secondUploadBody.cardRev);
      expect(deleteLinkedResponse.ok()).toBeTruthy();
      const deleteLinkedBody = await deleteLinkedResponse.json();
      expectCardFilesPayload(deleteLinkedBody, draftCard.id);
      expect(deleteLinkedBody.inputControlFileId).toBe(firstFile.id);
      expect(deleteLinkedBody.card.inputControlFileId).toBe(firstFile.id);

      const deleteLastLinkedResponse = await deleteCardFile(api, csrfToken, draftCard.id, firstFile.id, deleteLinkedBody.cardRev);
      expect(deleteLastLinkedResponse.ok()).toBeTruthy();
      const deleteLastLinkedBody = await deleteLastLinkedResponse.json();
      expectCardFilesPayload(deleteLastLinkedBody, draftCard.id);
      expect(deleteLastLinkedBody.inputControlFileId).toBe('');
      expect(deleteLastLinkedBody.card.inputControlFileId).toBe('');
      expect(deleteLastLinkedBody.filesCount).toBe(0);
    } finally {
      await api.dispose();
    }
  });

  test('resync clears stale inputControlFileId when linked file disappears from disk', async ({}, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const { api, csrfToken } = await loginApi(baseURL);

    try {
      const createdCard = await createDraftCard(api, csrfToken, `Stage5 ic resync cleanup ${Date.now()}`);
      const draftCard = await getCardById(api, createdCard.id);
      const uploadResponse = await uploadCardFile(api, csrfToken, draftCard.id, {
        expectedRev: draftCard.rev,
        fileName: `ic-resync-cleanup-${Date.now()}.pdf`,
        category: 'INPUT_CONTROL'
      });
      expect(uploadResponse.ok()).toBeTruthy();
      const uploadBody = await uploadResponse.json();
      const uploadedFile = uploadBody.file;
      expect(uploadedFile?.id).toBeTruthy();
      expect(uploadBody.inputControlFileId).toBe(uploadedFile.id);

      const diskPath = getCardStorageFilePath(draftCard, uploadedFile);
      expect(fs.existsSync(diskPath)).toBeTruthy();
      fs.rmSync(diskPath, { force: true });

      const resyncResponse = await resyncCardFiles(api, csrfToken, draftCard.id, uploadBody.cardRev);
      expect(resyncResponse.ok()).toBeTruthy();
      const resyncBody = await resyncResponse.json();
      expectCardFilesPayload(resyncBody, draftCard.id);
      expect(resyncBody.changed).toBe(true);
      expect(resyncBody.filesCount).toBe(0);
      expect(resyncBody.inputControlFileId).toBe('');
      expect(resyncBody.card.inputControlFileId).toBe('');
      expect(resyncBody.files).toEqual([]);
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

  test('updates generic attachments modal from upload payload and keeps /cards/:id stable', async ({ page }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const { api, csrfToken } = await loginApi(baseURL);

    try {
      const draftCard = await createDraftCard(api, csrfToken, `Stage5 generic upload ${Date.now()}`);
      const responses = trackFileResponses(page, draftCard.id);

      await loginAsAbyss(page, { startPath: '/cards' });
      await waitUsableUi(page, '/cards');
      const attachButton = page.locator(`button[data-attach-card="${draftCard.id}"]`).first();
      await expect(attachButton).toBeVisible();
      await attachButton.click();
      await expect(page.locator('#attachments-modal')).toBeVisible();

      const uploadPromise = page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && response.url().includes(`/api/cards/${encodeURIComponent(draftCard.id)}/files`)
        && response.status() === 200
      ));
      await page.setInputFiles('#attachments-input', {
        name: 'stage5-generic-upload.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('JVBERi0xCg==', 'base64')
      });
      await uploadPromise;

      await expect(page.locator('#attachments-list')).toContainText('stage5-generic-upload.pdf');
      await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe('/cards');
      await expect.poll(() => page.evaluate(() => window.__currentPageId || null)).toBe('page-cards');
      expect(responses.some((entry) => (
        entry.method === 'POST'
        && entry.status === 200
        && entry.url.includes(`/api/cards/${encodeURIComponent(draftCard.id)}/files`)
      ))).toBeTruthy();
      expect(responses.some((entry) => (
        entry.url.includes('/api/data')
        && entry.method !== 'GET'
      ))).toBeFalsy();
    } finally {
      await api.dispose();
    }
  });

  test('refreshes stale card revision from files modal payload before local upload when live updates are unavailable', async ({ page }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const { api, csrfToken } = await loginApi(baseURL);

    try {
      const createdCard = await createDraftCard(api, csrfToken, `Stage5 modal rev sync ${Date.now()}`);
      const draftCard = await getCardById(api, createdCard.id);
      const routePath = `/cards/${encodeURIComponent(draftCard.qrId)}`;
      const responses = trackFileAndDetailResponses(page, draftCard.id);

      await blockCardsSse(page);
      await loginAsAbyss(page, { startPath: routePath });
      await waitUsableUi(page, routePath);

      const currentCardBeforeExternalUpload = await getCardById(api, draftCard.id);
      const externalUploadResponse = await uploadCardFile(api, csrfToken, draftCard.id, {
        expectedRev: currentCardBeforeExternalUpload.rev,
        fileName: `modal-stale-external-${Date.now()}.pdf`,
        category: 'GENERAL'
      });
      expect(externalUploadResponse.ok()).toBeTruthy();
      const externalUploadBody = await externalUploadResponse.json();

      await page.locator('#card-attachments-btn').click();
      await expect(page.locator('#attachments-modal')).toBeVisible();
      await expect(page.locator('#attachments-list')).toContainText('modal-stale-external-');
      await expect.poll(() => page.evaluate(() => {
        if (typeof activeCardDraft === 'undefined' || !activeCardDraft) return null;
        return {
          rev: Number(activeCardDraft.rev || 0),
          filesCount: Number(activeCardDraft.filesCount || activeCardDraft.__liveFilesCount || 0)
        };
      })).toEqual({
        rev: externalUploadBody.cardRev,
        filesCount: externalUploadBody.filesCount
      });

      const uploadPromise = page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && response.url().includes(`/api/cards/${encodeURIComponent(draftCard.id)}/files`)
      ));
      await page.setInputFiles('#attachments-input', {
        name: 'modal-stale-local-upload.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('JVBERi0xCg==', 'base64')
      });
      const uploadResponse = await uploadPromise;
      expect(uploadResponse.status()).toBe(200);

      await expect(page.locator('#attachments-list')).toContainText('modal-stale-external-');
      await expect(page.locator('#attachments-list')).toContainText('modal-stale-local-upload.pdf');
      await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe(routePath);
      expect(responses.some((entry) => (
        entry.method === 'GET'
        && entry.url.includes(`/api/cards-core/${encodeURIComponent(draftCard.id)}`)
      ))).toBeFalsy();
      expect(responses.some((entry) => (
        entry.url.includes('/api/data')
        && entry.method !== 'GET'
      ))).toBeFalsy();
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

  test('keeps /cards/:id stable and point-refreshes files after real stale delete conflict', async ({ page }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const { api, csrfToken } = await loginApi(baseURL);

    try {
      const draftCard = await findCardWithQr(api);
      const initialFileName = `delete-stale-initial-${Date.now()}.pdf`;
      const initialUploadResponse = await uploadCardFile(api, csrfToken, draftCard.id, {
        expectedRev: draftCard.rev,
        fileName: initialFileName,
        category: 'GENERAL'
      });
      expect(initialUploadResponse.ok()).toBeTruthy();
      const initialUploadBody = await initialUploadResponse.json();
      const initialFile = initialUploadBody.files.find((file) => file && file.name === initialFileName);
      expect(initialFile?.id).toBeTruthy();

      await blockCardsSse(page);
      const routePath = `/cards/${encodeURIComponent(draftCard.qrId)}`;
      const responses = trackFileResponses(page, draftCard.id);

      await loginAsAbyss(page, { startPath: routePath });
      await waitUsableUi(page, routePath);
      await page.locator('#card-attachments-btn').click();
      await expect(page.locator('#attachments-modal')).toBeVisible();
      await expect(page.locator('#attachments-list')).toContainText(initialFileName);

      const currentCardBeforeExternalUpload = await getCardById(api, draftCard.id);
      const externalFileName = `delete-stale-external-${Date.now()}.pdf`;
      const externalUploadResponse = await uploadCardFile(api, csrfToken, draftCard.id, {
        expectedRev: currentCardBeforeExternalUpload.rev,
        fileName: externalFileName,
        category: 'GENERAL'
      });
      expect(externalUploadResponse.ok()).toBeTruthy();

      const deleteConflictResponsePromise = page.waitForResponse((response) => (
        response.request().method() === 'DELETE'
        && response.url().includes(`/api/cards/${encodeURIComponent(draftCard.id)}/files/${encodeURIComponent(initialFile.id)}`)
        && response.status() === 409
      ));
      const pointRefreshPromise = page.waitForResponse((response) => (
        response.request().method() === 'GET'
        && response.url().includes(`/api/cards-core/${encodeURIComponent(draftCard.id)}`)
        && response.status() === 200
      ));

      await page.locator(`button[data-delete-id="${initialFile.id}"]`).click();

      await deleteConflictResponsePromise;
      await pointRefreshPromise;
      await expect(page.locator('#toast-container .toast').last()).toContainText(/Версия карточки устарела|Карточка уже была изменена другим пользователем\. Данные обновлены\./);
      await expect(page.locator('#attachments-list')).toContainText(initialFileName);
      await expect(page.locator('#attachments-list')).toContainText(externalFileName);
      await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe(routePath);
      await expect.poll(() => page.evaluate(() => window.__currentPageId || null)).toBe('page-cards-new');
      expect(responses.some((entry) => entry.url.includes('/api/data') && entry.method !== 'GET')).toBeFalsy();
    } finally {
      await api.dispose();
    }
  });

  test('uses implicit preview resync path with stale revision conflict and keeps /cards/:id stable', async ({ page }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const { api, csrfToken } = await loginApi(baseURL);

    try {
      const draftCard = await findCardWithQr(api);
      const initialFileName = `resync-stale-initial-${Date.now()}.pdf`;
      const initialUploadResponse = await uploadCardFile(api, csrfToken, draftCard.id, {
        expectedRev: draftCard.rev,
        fileName: initialFileName,
        category: 'GENERAL'
      });
      expect(initialUploadResponse.ok()).toBeTruthy();
      const initialUploadBody = await initialUploadResponse.json();
      const initialFile = initialUploadBody.files.find((file) => file && file.name === initialFileName);
      expect(initialFile?.id).toBeTruthy();

      await blockCardsSse(page);
      await stubWindowOpen(page);
      const routePath = `/cards/${encodeURIComponent(draftCard.qrId)}`;
      const responses = trackFileResponses(page, draftCard.id);

      await loginAsAbyss(page, { startPath: routePath });
      await waitUsableUi(page, routePath);
      await page.locator('#card-attachments-btn').click();
      await expect(page.locator('#attachments-modal')).toBeVisible();
      await expect(page.locator('#attachments-list')).toContainText(initialFileName);

      await clearAttachmentRelPathInUi(page, draftCard.id, initialFile.id);

      const currentCardBeforeExternalUpload = await getCardById(api, draftCard.id);
      const externalFileName = `resync-stale-external-${Date.now()}.pdf`;
      const externalUploadResponse = await uploadCardFile(api, csrfToken, draftCard.id, {
        expectedRev: currentCardBeforeExternalUpload.rev,
        fileName: externalFileName,
        category: 'GENERAL'
      });
      expect(externalUploadResponse.ok()).toBeTruthy();

      const resyncConflictResponsePromise = page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && response.url().includes(`/api/cards/${encodeURIComponent(draftCard.id)}/files/resync`)
        && response.status() === 409
      ));
      const pointRefreshPromise = page.waitForResponse((response) => (
        response.request().method() === 'GET'
        && response.url().includes(`/api/cards-core/${encodeURIComponent(draftCard.id)}`)
        && response.status() === 200
      ));

      await page.locator(`button[data-preview-id="${initialFile.id}"]`).click();

      await resyncConflictResponsePromise;
      await pointRefreshPromise;
      await expect(page.locator('#toast-container .toast').last()).toContainText(/Версия карточки устарела|Карточка уже была изменена другим пользователем\. Данные обновлены\./);
      await expect(page.locator('#attachments-list')).toContainText(initialFileName);
      await expect(page.locator('#attachments-list')).toContainText(externalFileName);
      await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe(routePath);
      await expect.poll(() => page.evaluate(() => window.__currentPageId || null)).toBe('page-cards-new');
      expect(responses.some((entry) => entry.url.includes('/api/data') && entry.method !== 'GET')).toBeFalsy();
    } finally {
      await api.dispose();
    }
  });
});
