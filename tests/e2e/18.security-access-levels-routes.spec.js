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
      users: { view: true, edit: false },
      accessLevels: { view: true, edit: true }
    },
    attachments: {
      upload: true,
      remove: true
    },
    landingTab: 'accessLevels',
    inactivityTimeoutMinutes: 29,
    worker: false,
    headProduction: false,
    headSKK: false,
    skkWorker: false,
    labWorker: false,
    warehouseWorker: false,
    deputyTechDirector: false
  };
}

async function createAccessLevelTarget(api, csrfToken, suffix) {
  const createLevelResponse = await api.post('/api/security/access-levels', {
    headers: {
      'x-csrf-token': csrfToken
    },
    data: {
      name: `Stage7 Access UI ${suffix}`,
      description: 'access-level route-safe ui level',
      permissions: buildLevelPermissions()
    }
  });
  expect(createLevelResponse.ok()).toBeTruthy();
  const createLevelBody = await createLevelResponse.json();
  const createdLevel = (createLevelBody.accessLevels || []).find((level) => (
    level && level.name === `Stage7 Access UI ${suffix}`
  ));
  expect(createdLevel).toBeTruthy();

  return {
    accessLevel: createdLevel,
    nextNames: {
      winner: `Stage7 Access Winner ${suffix}`,
      loser: `Stage7 Access Loser ${suffix}`
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

function findAccessLevelTableRow(page, text) {
  return page.locator('#access-levels-table tbody tr:visible').filter({ hasText: text }).first();
}

async function openAccessLevelEditor(page, rowText) {
  const row = findAccessLevelTableRow(page, rowText);
  await expect(row).toBeVisible();
  await row.locator('.access-edit').click();
  await expect(page.locator('#access-level-modal')).toBeVisible();
}

async function fillAccessLevelName(page, value) {
  const input = page.locator('#access-level-name');
  await expect.poll(async () => {
    await input.fill('');
    await input.fill(value);
    return await input.inputValue();
  }).toBe(value);
}

async function saveAccessLevelModalExpect(page, { status = 200 } = {}) {
  const responsePromise = page.waitForResponse((response) => {
    if (response.request().method() !== 'POST') return false;
    if (!response.url().includes('/api/security/access-levels')) return false;
    return response.status() === status;
  }, { timeout: SECURITY_RESPONSE_TIMEOUT_MS });
  await page.locator('#access-level-form button[type="submit"]').click();
  const response = await responsePromise;
  return response.json().catch(() => ({}));
}

async function deleteAccessLevelExpect(page, accessLevelId, { status = 200 } = {}) {
  const responsePromise = page.waitForResponse((response) => {
    if (response.request().method() !== 'DELETE') return false;
    if (!response.url().includes(`/api/security/access-levels/${encodeURIComponent(accessLevelId)}`)) return false;
    return response.status() === status;
  }, { timeout: SECURITY_RESPONSE_TIMEOUT_MS });
  await page.locator('#delete-confirm-apply').click();
  const response = await responsePromise;
  return response.json().catch(() => ({}));
}

async function readAccessLevelStoreSnapshot(page, accessLevelId) {
  return page.evaluate((targetAccessLevelId) => {
    const level = (accessLevels || []).find((entry) => String(entry?.id || '').trim() === String(targetAccessLevelId || '').trim()) || null;
    return level
      ? {
        id: String(level.id || '').trim(),
        name: String(level.name || '').trim(),
        rev: Number(level.rev || 0),
        accessLevelsEdit: Boolean(level.permissions?.tabs?.accessLevels?.edit),
        accessLevelsView: Boolean(level.permissions?.tabs?.accessLevels?.view),
        landingTab: String(level.permissions?.landingTab || '').trim(),
        inactivityTimeoutMinutes: Number(level.permissions?.inactivityTimeoutMinutes || 0)
      }
      : null;
  }, accessLevelId);
}

test.describe('security access-level route-safe flows', () => {
  test.beforeAll(async () => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
  });

  test.afterAll(async () => {
    await stopServer();
  });

  test('keeps /accessLevels stable on stale edit modal without sending a request after live update', async ({ browser, page }, testInfo) => {
    test.setTimeout(240000);
    const baseURL = testInfo.project.use.baseURL;
    const { api, csrfToken } = await loginApi(baseURL);
    const target = await createAccessLevelTarget(api, csrfToken, String(Date.now()).slice(-6));
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
      await loginAsAbyss(page, { startPath: '/accessLevels' });
      await loginAsAbyss(pageTwo, { startPath: '/accessLevels' });
      await waitUsableUi(pageTwo, '/accessLevels');

      await openAccessLevelEditor(page, target.accessLevel.name);
      await fillAccessLevelName(page, target.nextNames.loser);

      await openAccessLevelEditor(pageTwo, target.accessLevel.name);
      await fillAccessLevelName(pageTwo, target.nextNames.winner);
      const winnerBody = await saveAccessLevelModalExpect(pageTwo, { status: 200 });
      expect(winnerBody.command).toBe('security.access-level.update');
      expect(winnerBody.accessLevel.permissions.tabs.accessLevels.edit).toBe(true);
      expect(winnerBody.accessLevel.permissions.tabs.accessLevels.view).toBe(true);
      expect(winnerBody.accessLevel.permissions.landingTab).toBe('accessLevels');
      expect(winnerBody.accessLevel.permissions.inactivityTimeoutMinutes).toBe(29);

      await expect.poll(async () => {
        const snapshot = await readAccessLevelStoreSnapshot(page, target.accessLevel.id);
        return snapshot ? snapshot.name : '';
      }).toBe(target.nextNames.winner);

      const writesBeforeStaleSubmit = writesOne.length;
      await page.locator('#access-level-form button[type="submit"]').click();

      await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe('/accessLevels');
      await expect(page.locator('#toast-container .toast').last()).toContainText(/измен|обновл/i);
      await expect.poll(async () => {
        const snapshot = await readAccessLevelStoreSnapshot(page, target.accessLevel.id);
        return snapshot ? snapshot.name : '';
      }).toBe(target.nextNames.winner);
      expect(writesOne.slice(writesBeforeStaleSubmit).some((entry) => (
        entry.method === 'POST'
        && entry.url.includes('/api/security/access-levels')
      ))).toBe(false);

      await expect.poll(() => findConsoleEntries(diagnosticsOne, /^\[CONFLICT\] security access-level local invalid state/i).length).toBeGreaterThan(0);
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

  test('keeps /accessLevels stable on real stale save conflicts through the security API', async ({ browser, page }, testInfo) => {
    test.setTimeout(240000);
    const baseURL = testInfo.project.use.baseURL;
    const { api, csrfToken } = await loginApi(baseURL);
    const target = await createAccessLevelTarget(api, csrfToken, String(Date.now()).slice(-6));
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
      await loginAsAbyss(page, { startPath: '/accessLevels' });
      await loginAsAbyss(pageTwo, { startPath: '/accessLevels' });
      await waitUsableUi(pageTwo, '/accessLevels');

      await openAccessLevelEditor(pageTwo, target.accessLevel.name);
      await fillAccessLevelName(pageTwo, target.nextNames.loser);

      await openAccessLevelEditor(page, target.accessLevel.name);
      await fillAccessLevelName(page, target.nextNames.winner);
      const winnerBody = await saveAccessLevelModalExpect(page, { status: 200 });
      expect(winnerBody.command).toBe('security.access-level.update');

      await expect(findAccessLevelTableRow(pageTwo, target.accessLevel.name)).toBeVisible();
      const conflictBody = await saveAccessLevelModalExpect(pageTwo, { status: 409 });
      expect(conflictBody.code).toBe('STALE_REVISION');
      expect(conflictBody.entity).toBe('security.access-level');
      expect(conflictBody.id).toBe(target.accessLevel.id);

      await expect.poll(() => pageTwo.evaluate(() => window.location.pathname + window.location.search)).toBe('/accessLevels');
      await expect(pageTwo.locator('#toast-container .toast').last()).toContainText(/измен|обновл/i);
      await expect.poll(async () => {
        const snapshot = await readAccessLevelStoreSnapshot(pageTwo, target.accessLevel.id);
        return snapshot ? snapshot.name : '';
      }).toBe(target.nextNames.winner);
      await expect(findAccessLevelTableRow(pageTwo, target.nextNames.winner)).toBeVisible();

      await expect.poll(() => findConsoleEntries(diagnosticsTwo, /^\[CONFLICT\] conflict detected/i).length).toBeGreaterThan(0);
      await expect.poll(() => findConsoleEntries(diagnosticsTwo, /^\[CONFLICT\] security refresh start/i).length).toBeGreaterThan(0);
      await expect.poll(() => findConsoleEntries(diagnosticsTwo, /^\[CONFLICT\] security refresh done/i).length).toBeGreaterThan(0);

      expect(writesOne.some((entry) => entry.url.includes('/api/data'))).toBe(false);
      expect(writesTwo.some((entry) => entry.url.includes('/api/data'))).toBe(false);
      expect(writesTwo.some((entry) => (
        entry.method === 'POST'
        && entry.url.includes('/api/security/access-levels')
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

  test('shows access-level delete actions and blocks deleting levels that are assigned to users', async ({ page }, testInfo) => {
    test.setTimeout(180000);
    const baseURL = testInfo.project.use.baseURL;
    const { api, csrfToken } = await loginApi(baseURL);
    const suffix = String(Date.now()).slice(-6);
    const unusedTarget = await createAccessLevelTarget(api, csrfToken, `delete-unused-${suffix}`);
    const usedTarget = await createAccessLevelTarget(api, csrfToken, `delete-used-${suffix}`);
    const createUserResponse = await api.post('/api/security/users', {
      headers: {
        'x-csrf-token': csrfToken
      },
      data: {
        name: `Stage7 Access Delete User ${suffix}`,
        password: `AccessDelete${suffix}99`,
        accessLevelId: usedTarget.accessLevel.id,
        status: 'active'
      }
    });
    expect(createUserResponse.ok()).toBeTruthy();
    const createUserBody = await createUserResponse.json();

    const diagnostics = attachDiagnostics(page);
    const writes = trackSecurityRequests(page);

    try {
      await loginAsAbyss(page, { startPath: '/accessLevels' });
      await waitUsableUi(page, '/accessLevels');

      await expect(page.locator('#access-levels-table th').filter({ hasText: 'Действия' })).toBeVisible();

      const unusedRow = findAccessLevelTableRow(page, unusedTarget.accessLevel.name);
      await expect(unusedRow).toBeVisible();
      await expect(unusedRow.locator('.access-edit')).toBeVisible();
      await expect(unusedRow.locator('.access-level-delete')).toBeVisible();
      const editBox = await unusedRow.locator('.access-edit').boundingBox();
      const deleteBox = await unusedRow.locator('.access-level-delete').boundingBox();
      expect(editBox).toBeTruthy();
      expect(deleteBox).toBeTruthy();
      expect(Math.abs(editBox.height - deleteBox.height)).toBeLessThanOrEqual(1);

      await unusedRow.locator('.access-level-delete').click();
      await expect(page.locator('#delete-confirm-modal')).toBeVisible();
      const deleteBody = await deleteAccessLevelExpect(page, unusedTarget.accessLevel.id, { status: 200 });
      expect(deleteBody.command).toBe('security.access-level.delete');
      expect(deleteBody.deletedId).toBe(unusedTarget.accessLevel.id);
      await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe('/accessLevels');
      await expect(findAccessLevelTableRow(page, unusedTarget.accessLevel.name)).toHaveCount(0);

      const usedRow = findAccessLevelTableRow(page, usedTarget.accessLevel.name);
      await expect(usedRow).toBeVisible();
      const writesBeforeBlockedDelete = writes.length;
      await usedRow.locator('.access-level-delete').click();
      await expect(page.locator('#toast-container .toast').last()).toContainText(/Нельзя удалить уровень доступа/i);
      await page.waitForTimeout(500);
      expect(writes.slice(writesBeforeBlockedDelete).some((entry) => (
        entry.method === 'DELETE'
        && entry.url.includes(`/api/security/access-levels/${encodeURIComponent(usedTarget.accessLevel.id)}`)
      ))).toBe(false);

      expect(writes.some((entry) => entry.url.includes('/api/data'))).toBe(false);
      expectNoCriticalClientFailures(diagnostics, {
        ignoreConsolePatterns: [
          /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
          /^\[LIVE\]/i,
          /^\[CONFLICT\]/i,
          /Не удалось загрузить данные с сервера/i,
          /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
        ]
      });
    } finally {
      if (createUserBody.user?.id) {
        await api.delete(`/api/security/users/${encodeURIComponent(createUserBody.user.id)}`, {
          headers: {
            'x-csrf-token': csrfToken,
            'Content-Type': 'application/json'
          },
          data: {
            expectedRev: createUserBody.user.rev
          }
        }).catch(() => null);
      }
      const levelsResponse = await api.get('/api/security/access-levels').catch(() => null);
      if (levelsResponse && levelsResponse.ok()) {
        const levelsBody = await levelsResponse.json().catch(() => ({}));
        const usedLevel = (levelsBody.accessLevels || []).find((level) => level && level.id === usedTarget.accessLevel.id);
        if (usedLevel) {
          await api.delete(`/api/security/access-levels/${encodeURIComponent(usedLevel.id)}`, {
            headers: {
              'x-csrf-token': csrfToken,
              'Content-Type': 'application/json'
            },
            data: {
              expectedRev: usedLevel.rev
            }
          }).catch(() => null);
        }
      }
      await api.dispose();
    }
  });
});
