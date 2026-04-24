const { test, expect, request: playwrightRequest } = require('@playwright/test');
const { resetDatabaseFromSnapshot } = require('./helpers/snapshot');
const { restartServer, stopServer } = require('./helpers/server');
const {
  attachDiagnostics,
  expectNoCriticalClientFailures,
  findConsoleEntries
} = require('./helpers/diagnostics');
const { loginAsAbyss } = require('./helpers/auth');
const { waitUsableUi } = require('./helpers/navigation');

const SECURITY_RESPONSE_TIMEOUT_MS = 60000;

async function loginApi(baseURL) {
  const api = await playwrightRequest.newContext({ baseURL });
  const loginResponse = await api.post('/api/login', {
    data: { password: 'ssyba' }
  });
  expect(loginResponse.ok()).toBeTruthy();
  const loginBody = await loginResponse.json();
  expect(loginBody.csrfToken).toBeTruthy();
  return {
    api,
    csrfToken: loginBody.csrfToken
  };
}

function buildLevelPermissions() {
  return {
    tabs: {
      users: { view: true, edit: true },
      accessLevels: { view: true, edit: false }
    },
    attachments: {
      upload: true,
      remove: true
    },
    landingTab: 'users',
    inactivityTimeoutMinutes: 27,
    worker: false,
    headProduction: false,
    headSKK: false,
    skkWorker: false,
    labWorker: false,
    warehouseWorker: false,
    deputyTechDirector: false
  };
}

async function createSecurityUiTarget(api, csrfToken, suffix) {
  const createLevelResponse = await api.post('/api/security/access-levels', {
    headers: {
      'x-csrf-token': csrfToken
    },
    data: {
      name: `Stage7 UI level ${suffix}`,
      description: 'users route-safe ui level',
      permissions: buildLevelPermissions()
    }
  });
  expect(createLevelResponse.ok()).toBeTruthy();
  const createLevelBody = await createLevelResponse.json();
  const createdLevel = (createLevelBody.accessLevels || []).find((level) => (
    level && level.name === `Stage7 UI level ${suffix}`
  ));
  expect(createdLevel).toBeTruthy();

  const createUserResponse = await api.post('/api/security/users', {
    headers: {
      'x-csrf-token': csrfToken
    },
    data: {
      name: `Stage7 UI User ${suffix}`,
      password: `Stage7${suffix}99`,
      accessLevelId: createdLevel.id,
      status: 'active'
    }
  });
  expect(createUserResponse.ok()).toBeTruthy();
  const createUserBody = await createUserResponse.json();
  expect(createUserBody.user?.id).toBeTruthy();

  return {
    accessLevel: createdLevel,
    user: createUserBody.user,
    nextNames: {
      winner: `Stage7 Winner ${suffix}`,
      loser: `Stage7 Loser ${suffix}`
    }
  };
}

function trackSecurityRequests(page) {
  const writes = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!url.includes('/api/security') && !url.includes('/api/data')) return;
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) return;
    writes.push({
      method: request.method(),
      url
    });
  });
  return writes;
}

function findUserTableRow(page, text) {
  return page.locator('#users-table tbody tr:visible').filter({ hasText: text }).first();
}

async function openUserEditor(page, rowText) {
  const row = findUserTableRow(page, rowText);
  await expect(row).toBeVisible();
  await row.locator('.user-edit').click();
  await expect(page.locator('#user-modal')).toBeVisible();
}

async function fillUserName(page, value) {
  const input = page.locator('#user-name');
  await expect.poll(async () => {
    await input.fill('');
    await input.fill(value);
    return await input.inputValue();
  }).toBe(value);
}

async function saveUserModalExpect(page, { method = 'PUT', userId = '', status = 200 } = {}) {
  const responsePromise = page.waitForResponse((response) => {
    if (response.request().method() !== method) return false;
    if (!response.url().includes('/api/security/users')) return false;
    if (userId && !response.url().includes(`/api/security/users/${encodeURIComponent(userId)}`)) return false;
    return response.status() === status;
  }, { timeout: SECURITY_RESPONSE_TIMEOUT_MS });
  await page.locator('#user-form button[type="submit"]').click();
  const response = await responsePromise;
  return response.json().catch(() => ({}));
}

async function readUserStoreSnapshot(page, userId) {
  return page.evaluate((targetUserId) => {
    const user = (users || []).find((entry) => String(entry?.id || '').trim() === String(targetUserId || '').trim()) || null;
    return user
      ? {
        id: String(user.id || '').trim(),
        name: String(user.name || '').trim(),
        rev: Number(user.rev || 0)
      }
      : null;
  }, userId);
}

test.describe('security users route-safe flows', () => {
  test.beforeAll(async () => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
  });

  test.afterAll(async () => {
    await stopServer();
  });

  test('keeps /users stable on stale edit modal without sending a request after live update', async ({ browser, page }, testInfo) => {
    test.setTimeout(240000);
    const baseURL = testInfo.project.use.baseURL;
    const { api, csrfToken } = await loginApi(baseURL);
    const target = await createSecurityUiTarget(api, csrfToken, String(Date.now()).slice(-6));
    await api.dispose();

    const diagnosticsOne = attachDiagnostics(page);
    const writesOne = trackSecurityRequests(page);
    const contextTwo = await browser.newContext({
      baseURL,
      viewport: { width: 1440, height: 1000 }
    });
    const pageTwo = await contextTwo.newPage();
    const diagnosticsTwo = attachDiagnostics(pageTwo);
    const writesTwo = trackSecurityRequests(pageTwo);

    try {
      await loginAsAbyss(page, { startPath: '/users' });
      await loginAsAbyss(pageTwo, { startPath: '/users' });
      await waitUsableUi(pageTwo, '/users');

      await openUserEditor(page, target.user.name);
      await fillUserName(page, target.nextNames.loser);

      await openUserEditor(pageTwo, target.user.name);
      await fillUserName(pageTwo, target.nextNames.winner);
      const winnerBody = await saveUserModalExpect(pageTwo, {
        method: 'PUT',
        userId: target.user.id,
        status: 200
      });
      expect(winnerBody.command).toBe('security.user.update');

      await expect.poll(async () => {
        const snapshot = await readUserStoreSnapshot(page, target.user.id);
        return snapshot ? snapshot.name : '';
      }).toBe(target.nextNames.winner);

      const writesBeforeStaleSubmit = writesOne.length;
      await page.locator('#user-form button[type="submit"]').click();

      await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe('/users');
      await expect(page.locator('#toast-container .toast').last()).toContainText(/измен|обновл/i);
      await expect.poll(async () => {
        const snapshot = await readUserStoreSnapshot(page, target.user.id);
        return snapshot ? snapshot.name : '';
      }).toBe(target.nextNames.winner);
      expect(writesOne.slice(writesBeforeStaleSubmit).some((entry) => (
        entry.method === 'PUT'
        && entry.url.includes(`/api/security/users/${encodeURIComponent(target.user.id)}`)
      ))).toBe(false);

      await expect.poll(() => findConsoleEntries(diagnosticsOne, /^\[CONFLICT\] security user local invalid state/i).length).toBeGreaterThan(0);
      await expect.poll(() => findConsoleEntries(diagnosticsOne, /^\[CONFLICT\] security refresh start/i).length).toBeGreaterThan(0);
      await expect.poll(() => findConsoleEntries(diagnosticsOne, /^\[CONFLICT\] security refresh done/i).length).toBeGreaterThan(0);

      expect(writesOne.some((entry) => entry.url.includes('/api/data'))).toBe(false);
      expect(writesTwo.some((entry) => entry.url.includes('/api/data'))).toBe(false);

      expectNoCriticalClientFailures(diagnosticsOne, {
        ignoreConsolePatterns: [
          /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
          /^\[LIVE\]/i,
          /^\[CONFLICT\]/i,
          /Не удалось загрузить данные с сервера/i,
          /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
        ]
      });
      expectNoCriticalClientFailures(diagnosticsTwo, {
        ignoreConsolePatterns: [
          /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
          /^\[LIVE\]/i,
          /^\[CONFLICT\]/i,
          /Не удалось загрузить данные с сервера/i,
          /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
        ]
      });
    } finally {
      await contextTwo.close();
    }
  });

  test('keeps /users stable on real stale delete conflicts through the security API', async ({ browser, page }, testInfo) => {
    test.setTimeout(240000);
    const baseURL = testInfo.project.use.baseURL;
    const { api, csrfToken } = await loginApi(baseURL);
    const target = await createSecurityUiTarget(api, csrfToken, String(Date.now()).slice(-6));
    await api.dispose();

    const diagnosticsOne = attachDiagnostics(page);
    const writesOne = trackSecurityRequests(page);
    const contextTwo = await browser.newContext({
      baseURL,
      viewport: { width: 1440, height: 1000 }
    });
    const pageTwo = await contextTwo.newPage();
    await pageTwo.route('**/api/events/stream', async (route) => {
      await route.abort();
    });
    const diagnosticsTwo = attachDiagnostics(pageTwo);
    const writesTwo = trackSecurityRequests(pageTwo);

    try {
      await loginAsAbyss(page, { startPath: '/users' });
      await loginAsAbyss(pageTwo, { startPath: '/users' });
      await waitUsableUi(pageTwo, '/users');

      await openUserEditor(page, target.user.name);
      await fillUserName(page, target.nextNames.winner);
      const winnerBody = await saveUserModalExpect(page, {
        method: 'PUT',
        userId: target.user.id,
        status: 200
      });
      expect(winnerBody.command).toBe('security.user.update');

      await expect(findUserTableRow(pageTwo, target.user.name)).toBeVisible();

      const deleteConflictPromise = pageTwo.waitForResponse((response) => (
        response.request().method() === 'DELETE'
        && response.url().includes(`/api/security/users/${encodeURIComponent(target.user.id)}`)
        && response.status() === 409
      ), { timeout: SECURITY_RESPONSE_TIMEOUT_MS });

      await findUserTableRow(pageTwo, target.user.name).locator('.user-delete').click();
      await expect(pageTwo.locator('#delete-confirm-modal')).toBeVisible();
      await pageTwo.locator('#delete-confirm-apply').click();

      const deleteConflictBody = await (await deleteConflictPromise).json().catch(() => ({}));
      expect(deleteConflictBody.code).toBe('STALE_REVISION');
      expect(deleteConflictBody.entity).toBe('security.user');
      expect(deleteConflictBody.id).toBe(target.user.id);

      await expect.poll(() => pageTwo.evaluate(() => window.location.pathname + window.location.search)).toBe('/users');
      await expect(pageTwo.locator('#toast-container .toast').last()).toContainText(/измен|обновл/i);
      await expect.poll(async () => {
        const snapshot = await readUserStoreSnapshot(pageTwo, target.user.id);
        return snapshot ? snapshot.name : '';
      }).toBe(target.nextNames.winner);
      await expect(findUserTableRow(pageTwo, target.nextNames.winner)).toBeVisible();

      await expect.poll(() => findConsoleEntries(diagnosticsTwo, /^\[CONFLICT\] conflict detected/i).length).toBeGreaterThan(0);
      await expect.poll(() => findConsoleEntries(diagnosticsTwo, /^\[CONFLICT\] security refresh start/i).length).toBeGreaterThan(0);
      await expect.poll(() => findConsoleEntries(diagnosticsTwo, /^\[CONFLICT\] security refresh done/i).length).toBeGreaterThan(0);

      expect(writesOne.some((entry) => entry.url.includes('/api/data'))).toBe(false);
      expect(writesTwo.some((entry) => entry.url.includes('/api/data'))).toBe(false);
      expect(writesTwo.some((entry) => (
        entry.method === 'DELETE'
        && entry.url.includes(`/api/security/users/${encodeURIComponent(target.user.id)}`)
      ))).toBe(true);

      expectNoCriticalClientFailures(diagnosticsOne, {
        ignoreConsolePatterns: [
          /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
          /^\[LIVE\]/i,
          /^\[CONFLICT\]/i,
          /Не удалось загрузить данные с сервера/i,
          /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
        ]
      });
      expectNoCriticalClientFailures(diagnosticsTwo, {
        ignoreConsolePatterns: [
          /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
          /Failed to load resource: the server responded with a status of 409 \(Conflict\)/i,
          /Failed to load resource:.*api\/events\/stream/i,
          /net::ERR_FAILED/i,
          /^\[LIVE\]/i,
          /^\[CONFLICT\]/i,
          /Не удалось загрузить данные с сервера/i,
          /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
        ]
      });
    } finally {
      await contextTwo.close();
    }
  });
});
