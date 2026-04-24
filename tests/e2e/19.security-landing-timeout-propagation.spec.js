const { test, expect, request: playwrightRequest } = require('@playwright/test');
const { resetDatabaseFromSnapshot } = require('./helpers/snapshot');
const { restartServer, stopServer } = require('./helpers/server');
const { logoutViaUi, waitForLoginForm } = require('./helpers/auth');
const { waitUsableUi } = require('./helpers/navigation');

const SECURITY_RESPONSE_TIMEOUT_MS = 60000;
const ACCESS_KEYS = [
  'dashboard',
  'cards',
  'approvals',
  'provision',
  'input-control',
  'archive',
  'workorders',
  'departments',
  'operations',
  'areas',
  'employees',
  'shift-times',
  'production-schedule',
  'production-plan',
  'production-shifts',
  'production-delayed',
  'production-defects',
  'items',
  'ok',
  'oc',
  'receipts',
  'workspace',
  'users',
  'accessLevels'
];

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

function buildPermissions({
  landingTab = 'accessLevels',
  inactivityTimeoutMinutes = 35,
  accessLevels = { view: true, edit: true },
  dashboard = { view: true, edit: false }
} = {}) {
  const tabs = Object.fromEntries(ACCESS_KEYS.map(key => [key, { view: false, edit: false }]));
  tabs.dashboard = { ...dashboard };
  tabs.accessLevels = { ...accessLevels };
  return {
    tabs,
    attachments: {
      upload: false,
      remove: false
    },
    landingTab,
    inactivityTimeoutMinutes,
    worker: false,
    headProduction: false,
    headSKK: false,
    skkWorker: false,
    labWorker: false,
    warehouseWorker: false,
    deputyTechDirector: false
  };
}

async function createAccessLevelUser(api, csrfToken, suffix, {
  landingTab = 'accessLevels',
  inactivityTimeoutMinutes = 35
} = {}) {
  const levelName = `Stage7 Landing ${suffix}`;
  const password = `Stage7Landing${suffix}99`;
  const createLevelResponse = await api.post('/api/security/access-levels', {
    headers: {
      'x-csrf-token': csrfToken
    },
    data: {
      name: levelName,
      description: 'landing timeout propagation level',
      permissions: buildPermissions({
        landingTab,
        inactivityTimeoutMinutes
      })
    }
  });
  expect(createLevelResponse.ok()).toBeTruthy();
  const levelBody = await createLevelResponse.json();
  const level = (levelBody.accessLevels || []).find(item => item && item.name === levelName);
  expect(level).toBeTruthy();

  const createUserResponse = await api.post('/api/security/users', {
    headers: {
      'x-csrf-token': csrfToken
    },
    data: {
      name: `Stage7 Landing User ${suffix}`,
      password,
      accessLevelId: level.id,
      status: 'active'
    }
  });
  expect(createUserResponse.ok()).toBeTruthy();
  const userBody = await createUserResponse.json();
  expect(userBody.user?.id).toBeTruthy();

  return {
    level,
    password,
    user: userBody.user
  };
}

async function loginWithPassword(page, password, startPath = '/') {
  await page.goto(startPath, { waitUntil: 'domcontentloaded' });
  await waitForLoginForm(page);
  await page.fill('#login-password', password);
  await page.click('#login-submit');
  await expect(page.locator('#app-root')).toBeVisible();
  await expect(page.locator('#app-root')).not.toHaveClass(/hidden/);
}

function trackSecurityWrites(page) {
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

async function openAccessLevelEditor(page, levelName) {
  const row = page.locator('#access-levels-table tbody tr:visible').filter({ hasText: levelName }).first();
  await expect(row).toBeVisible();
  await row.locator('.access-edit').click();
  await expect(page.locator('#access-level-modal')).toBeVisible();
}

async function saveAccessLevelModal(page, { status = 200 } = {}) {
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && response.url().includes('/api/security/access-levels')
    && response.status() === status
  ), { timeout: SECURITY_RESPONSE_TIMEOUT_MS });
  await page.locator('#access-level-form button[type="submit"]').click();
  const response = await responsePromise;
  return response.json().catch(() => ({}));
}

async function readCurrentPermissionSnapshot(page) {
  return page.evaluate(() => ({
    landingTab: String(currentUser?.permissions?.landingTab || ''),
    inactivityTimeoutMinutes: Number(currentUser?.permissions?.inactivityTimeoutMinutes || 0),
    accessLevelsView: Boolean(currentUser?.permissions?.tabs?.accessLevels?.view),
    accessLevelsEdit: Boolean(currentUser?.permissions?.tabs?.accessLevels?.edit)
  }));
}

test.describe('security landing tab and inactivity timeout propagation', () => {
  test.beforeAll(async () => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
  });

  test.afterAll(async () => {
    await stopServer();
  });

  test('applies saved landingTab and timeout to current user, home route, F5 and next login', async ({ page }, testInfo) => {
    test.setTimeout(240000);
    const baseURL = testInfo.project.use.baseURL;
    const { api, csrfToken } = await loginApi(baseURL);
    const target = await createAccessLevelUser(api, csrfToken, String(Date.now()).slice(-6), {
      landingTab: 'accessLevels',
      inactivityTimeoutMinutes: 35
    });
    await api.dispose();
    const writes = trackSecurityWrites(page);

    await loginWithPassword(page, target.password, '/');
    await waitUsableUi(page, '/accessLevels');

    await openAccessLevelEditor(page, target.level.name);
    await page.locator('#access-landing').selectOption('dashboard');
    await page.locator('#access-timeout').fill('41');
    const saveBody = await saveAccessLevelModal(page);
    expect(saveBody.command).toBe('security.access-level.update');
    expect(saveBody.accessLevel.permissions.landingTab).toBe('dashboard');
    expect(saveBody.accessLevel.permissions.inactivityTimeoutMinutes).toBe(41);

    await expect.poll(() => readCurrentPermissionSnapshot(page)).toMatchObject({
      landingTab: 'dashboard',
      inactivityTimeoutMinutes: 41,
      accessLevelsView: true,
      accessLevelsEdit: true
    });

    await page.evaluate(() => handleRoute('/', { replace: true, fromHistory: false }));
    await waitUsableUi(page, '/dashboard');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitUsableUi(page, '/dashboard');

    await logoutViaUi(page);
    await loginWithPassword(page, target.password, '/');
    await waitUsableUi(page, '/dashboard');

    expect(writes.some(entry => entry.url.includes('/api/data'))).toBe(false);
  });

  test('moves current user to a permitted home route when saved access level blocks current route', async ({ page }, testInfo) => {
    test.setTimeout(240000);
    const baseURL = testInfo.project.use.baseURL;
    const { api, csrfToken } = await loginApi(baseURL);
    const target = await createAccessLevelUser(api, csrfToken, String(Date.now()).slice(-6), {
      landingTab: 'accessLevels',
      inactivityTimeoutMinutes: 36
    });
    await api.dispose();
    const writes = trackSecurityWrites(page);

    await loginWithPassword(page, target.password, '/accessLevels');
    await waitUsableUi(page, '/accessLevels');

    await openAccessLevelEditor(page, target.level.name);
    await page.locator('#access-landing').selectOption('dashboard');
    await page.locator('#access-timeout').fill('37');
    const accessView = page.locator('#access-permissions input[data-tab="accessLevels"][data-perm="view"]');
    const accessEdit = page.locator('#access-permissions input[data-tab="accessLevels"][data-perm="edit"]');
    if (await accessView.isChecked()) await accessView.uncheck();
    if (await accessEdit.isChecked()) await accessEdit.uncheck();

    const saveBody = await saveAccessLevelModal(page);
    expect(saveBody.command).toBe('security.access-level.update');
    expect(saveBody.accessLevel.permissions.tabs.accessLevels.view).toBe(false);
    expect(saveBody.accessLevel.permissions.tabs.accessLevels.edit).toBe(false);
    expect(saveBody.accessLevel.permissions.landingTab).toBe('dashboard');
    expect(saveBody.accessLevel.permissions.inactivityTimeoutMinutes).toBe(37);

    await waitUsableUi(page, '/dashboard');
    await expect.poll(() => readCurrentPermissionSnapshot(page)).toMatchObject({
      landingTab: 'dashboard',
      inactivityTimeoutMinutes: 37,
      accessLevelsView: false,
      accessLevelsEdit: false
    });

    expect(writes.some(entry => entry.url.includes('/api/data'))).toBe(false);
  });
});
