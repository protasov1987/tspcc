const { test, expect, request: playwrightRequest } = require('@playwright/test');
const { resetDatabaseFromSnapshot } = require('./helpers/snapshot');
const { restartServer, stopServer } = require('./helpers/server');
const { openRouteAndAssert } = require('./helpers/navigation');
const { loginAsAbyss } = require('./helpers/auth');
const { attachDiagnostics, findConsoleEntries } = require('./helpers/diagnostics');

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

async function createProvisionUser(baseURL, adminApi, adminCsrfToken, suffix) {
  const levelName = `Stage4 Provision ${suffix}`;
  const levelResponse = await adminApi.post('/api/security/access-levels', {
    headers: {
      'x-csrf-token': adminCsrfToken
    },
    data: {
      name: levelName,
      description: 'Stage 4 provision command test level',
      permissions: {
        tabs: {
          provision: { view: true, edit: true }
        }
      }
    }
  });
  expect(levelResponse.ok()).toBeTruthy();
  const levelBody = await levelResponse.json();
  const createdLevel = (levelBody.accessLevels || []).find(level => level && level.name === levelName);
  expect(createdLevel).toBeTruthy();

  const userName = `Stage4Provision_${suffix}`;
  const userPassword = `Stage4P${suffix}9`;
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
      desc: `provision command test ${name}`,
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
      comment: 'Отправка на согласование перед обеспечением'
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

async function completeInputControl(adminApi, adminCsrfToken, card, comment) {
  const response = await adminApi.post(`/api/cards-core/${encodeURIComponent(card.id)}/input-control/complete`, {
    headers: {
      'x-csrf-token': adminCsrfToken
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

test.describe('provision command path', () => {
  test.beforeAll(async () => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
  });

  test.afterAll(async () => {
    await stopServer();
  });

  test('supports permission-based provision command, keeps production order in mainMaterials and returns stale conflicts', async ({}, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const { api: adminApi, csrfToken: adminCsrfToken } = await loginApi(baseURL);
    const suffix = String(Date.now()).slice(-6);
    const provisionUser = await createProvisionUser(baseURL, adminApi, adminCsrfToken, suffix);

    try {
      const approvedCard = await createApprovedCard(adminApi, adminCsrfToken, `Stage4 provision ${suffix}`);
      const completeResponse = await provisionUser.api.post(`/api/cards-core/${encodeURIComponent(approvedCard.id)}/provision/complete`, {
        headers: {
          'x-csrf-token': provisionUser.csrfToken
        },
        data: {
          expectedRev: approvedCard.rev,
          productionOrder: 'PR-001-TEST'
        }
      });
      expect(completeResponse.ok()).toBeTruthy();
      const completeBody = await completeResponse.json();
      expect(completeBody.command).toBe('complete');
      expect(completeBody.card.id).toBe(approvedCard.id);
      expect(completeBody.card.provisionDoneBy).toBe(provisionUser.userName);
      expect(completeBody.card.provisionDoneAt).toEqual(expect.any(Number));
      expect(completeBody.card.mainMaterials).toContain('Заказ на производство №: PR-001-TEST');
      expect(completeBody.card.approvalStage).toBe('WAITING_INPUT_CONTROL');
      expect(completeBody.card.approvalThread.at(-1)).toMatchObject({
        actionType: 'PROVISION_COMPLETE',
        comment: 'PR-001-TEST',
        userName: provisionUser.userName
      });
      expect(
        (completeBody.card.logs || []).some(log => (
          log
          && log.action === 'Обеспечение'
          && log.field === 'mainMaterials'
          && String(log.newValue || '').includes('Заказ на производство №: PR-001-TEST')
        ))
      ).toBeTruthy();

      const staleResponse = await provisionUser.api.post(`/api/cards-core/${encodeURIComponent(approvedCard.id)}/provision/complete`, {
        headers: {
          'x-csrf-token': provisionUser.csrfToken
        },
        data: {
          expectedRev: approvedCard.rev,
          productionOrder: 'PR-STALE-TEST'
        }
      });
      expect(staleResponse.status()).toBe(409);
      const staleBody = await staleResponse.json();
      expect(staleBody.code).toBe('STALE_REVISION');
      expect(staleBody.entity).toBe('card');
      expect(staleBody.id).toBe(approvedCard.id);
      expect(staleBody.expectedRev).toBe(approvedCard.rev);
      expect(staleBody.actualRev).toBe(completeBody.card.rev);

      const approvedWithInputControl = await createApprovedCard(adminApi, adminCsrfToken, `Stage4 provision provided ${suffix}`);
      const waitingProvisionCard = await completeInputControl(
        adminApi,
        adminCsrfToken,
        approvedWithInputControl,
        'Подготовка к обеспечению после входного контроля'
      );
      expect(waitingProvisionCard.approvalStage).toBe('WAITING_PROVISION');

      const providedResponse = await provisionUser.api.post(`/api/cards-core/${encodeURIComponent(waitingProvisionCard.id)}/provision/complete`, {
        headers: {
          'x-csrf-token': provisionUser.csrfToken
        },
        data: {
          expectedRev: waitingProvisionCard.rev,
          productionOrder: 'PR-002-PROVIDED'
        }
      });
      expect(providedResponse.ok()).toBeTruthy();
      const providedBody = await providedResponse.json();
      expect(providedBody.card.approvalStage).toBe('PROVIDED');
      expect(providedBody.card.mainMaterials).toContain('Заказ на производство №: PR-002-PROVIDED');
    } finally {
      await provisionUser.api.dispose();
      await adminApi.dispose();
    }
  });

  test('keeps /provision route after UI command, avoids snapshot writes and survives F5', async ({ page }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const { api: adminApi, csrfToken: adminCsrfToken } = await loginApi(baseURL);
    const approvedCard = await createApprovedCard(adminApi, adminCsrfToken, `Stage4 provision route ${Date.now()}`);
    const responses = trackRelevantResponses(page);

    try {
      await loginAsAbyss(page, { startPath: '/provision' });
      await openRouteAndAssert(page, '/provision');

      const row = page.locator(`tr[data-card-id="${approvedCard.id}"]`);
      await expect(row).toBeVisible();
      await row.getByRole('button', { name: 'Обеспечить' }).click();
      await expect(page.locator('#provision-production-order-modal')).toBeVisible();
      await page.locator('#provision-production-order-input').fill('UI-PROVISION-001');

      const provisionResponsePromise = page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && response.url().includes(`/api/cards-core/${encodeURIComponent(approvedCard.id)}/provision/complete`)
        && response.status() === 200
      ));
      await page.locator('#provision-production-order-confirm').click();
      await provisionResponsePromise;

      await expect(page.locator('#provision-production-order-modal')).toBeHidden();
      await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe('/provision');
      await expect(row).toHaveCount(0);
      expect(responses.some((entry) => entry.url.includes(`/api/cards-core/${encodeURIComponent(approvedCard.id)}/provision/complete`))).toBeTruthy();
      expectNoLegacySnapshotWrites(responses);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await openRouteAndAssert(page, '/provision');
      await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe('/provision');
    } finally {
      await adminApi.dispose();
    }
  });

  test('keeps /provision route and refreshes list after stale provision conflict', async ({ page }, testInfo) => {
    const diagnostics = attachDiagnostics(page);
    const baseURL = testInfo.project.use.baseURL;
    const { api: adminApi, csrfToken: adminCsrfToken } = await loginApi(baseURL);
    const approvedCard = await createApprovedCard(adminApi, adminCsrfToken, `Stage4 provision conflict ${Date.now()}`);
    const responses = trackRelevantResponses(page);

    try {
      await loginAsAbyss(page, { startPath: '/provision' });
      await openRouteAndAssert(page, '/provision');

      const row = page.locator(`tr[data-card-id="${approvedCard.id}"]`);
      await expect(row).toBeVisible();
      const listRefreshBeforeConflict = responses.filter((entry) => (
        entry.method === 'GET'
        && entry.url.includes('/api/data?scope=cards-basic')
      )).length;

      await attachStaleExpectedRevInterceptor(page, `/api/cards-core/${encodeURIComponent(approvedCard.id)}/provision/complete`);

      await row.getByRole('button', { name: 'Обеспечить' }).click();
      await expect(page.locator('#provision-production-order-modal')).toBeVisible();
      await page.locator('#provision-production-order-input').fill('UI-PROVISION-CONFLICT');

      const conflictResponsePromise = page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && response.url().includes(`/api/cards-core/${encodeURIComponent(approvedCard.id)}/provision/complete`)
        && response.status() === 409
      ));
      await page.locator('#provision-production-order-confirm').click();
      await conflictResponsePromise;

      await expect(page.locator('#provision-production-order-modal')).toBeHidden();
      await expect(page.locator('#toast-container .toast').last()).toContainText(/Версия карточки устарела|Карточка уже была изменена другим пользователем\. Данные обновлены\./);
      await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe('/provision');
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
});
