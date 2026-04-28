const { test, expect, request: playwrightRequest } = require('@playwright/test');
const { resetDatabaseFromSnapshot } = require('./helpers/snapshot');
const { restartServer, stopServer } = require('./helpers/server');
const { attachDiagnostics, resetDiagnostics, expectNoCriticalClientFailures } = require('./helpers/diagnostics');
const { loginAsAbyss, logoutViaUi, waitForLoginForm } = require('./helpers/auth');
const { openRouteAndAssert, waitUsableUi } = require('./helpers/navigation');
const { loadSnapshotDb, getStage1RouteFixture } = require('./helpers/db');

const IN_SCOPE_BASE_ROUTES = Object.freeze([
  '/dashboard',
  '/cards',
  '/cards/new',
  '/approvals',
  '/provision',
  '/input-control',
  '/departments',
  '/operations',
  '/areas',
  '/employees',
  '/shift-times',
  '/users',
  '/accessLevels',
  '/production/schedule',
  '/production/plan',
  '/production/shifts',
  '/workspace',
  '/production/delayed',
  '/production/defects',
  '/workorders',
  '/archive',
  '/items',
  '/ok',
  '/oc'
]);

const ACCESS_KEYS = Object.freeze([
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
  'workspace',
  'users',
  'accessLevels'
]);

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

function buildDashboardOnlyPermissions() {
  const tabs = Object.fromEntries(ACCESS_KEYS.map(key => [key, { view: false, edit: false }]));
  tabs.dashboard = { view: true, edit: false };
  return {
    tabs,
    attachments: {
      upload: false,
      remove: false
    },
    landingTab: 'dashboard',
    inactivityTimeoutMinutes: 30,
    worker: false,
    headProduction: false,
    headSKK: false,
    skkWorker: false,
    labWorker: false,
    warehouseWorker: false,
    deputyTechDirector: false
  };
}

async function createDashboardOnlyUser(baseURL) {
  const { api, csrfToken } = await loginApi(baseURL);
  const suffix = String(Date.now()).slice(-6);
  const levelName = `Stage14 Route Limited ${suffix}`;
  const password = `Stage14Limited${suffix}99`;

  try {
    const createLevelResponse = await api.post('/api/security/access-levels', {
      headers: {
        'x-csrf-token': csrfToken
      },
      data: {
        name: levelName,
        description: 'route/auth permission-sensitive E2E level',
        permissions: buildDashboardOnlyPermissions()
      }
    });
    expect(createLevelResponse.ok()).toBeTruthy();
    const createLevelBody = await createLevelResponse.json();
    const level = (createLevelBody.accessLevels || []).find(item => item && item.name === levelName);
    expect(level?.id).toBeTruthy();

    const createUserResponse = await api.post('/api/security/users', {
      headers: {
        'x-csrf-token': csrfToken
      },
      data: {
        name: `Stage14 Route Limited User ${suffix}`,
        password,
        accessLevelId: level.id,
        status: 'active'
      }
    });
    expect(createUserResponse.ok()).toBeTruthy();
    const createUserBody = await createUserResponse.json();
    expect(createUserBody.user?.id).toBeTruthy();
    return {
      password,
      user: createUserBody.user,
      level
    };
  } finally {
    await api.dispose();
  }
}

async function loginWithPassword(page, password, { startPath = '/', expectedBadgeText = '' } = {}) {
  await page.goto(startPath, { waitUntil: 'domcontentloaded' });
  await waitForLoginForm(page);
  await page.fill('#login-password', password);
  await page.click('#login-submit');
  await expect(page.locator('#app-root')).toBeVisible();
  await expect(page.locator('#app-root')).not.toHaveClass(/hidden/);
  if (expectedBadgeText) {
    await expect(page.locator('#user-badge')).toContainText(expectedBadgeText);
  }
}

async function waitForRouteDataIdle(page) {
  await expect.poll(() => page.evaluate(() => {
    if (typeof isDataScopeLoadInFlight !== 'function') return true;
    return ['full', 'cards-basic', 'directories', 'production']
      .every(scope => !isDataScopeLoadInFlight(scope));
  })).toBe(true);
}

test.describe.serial('Auth, bootstrap and routes', () => {
  test.beforeAll(async () => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
  });

  test.afterAll(async () => {
    await stopServer();
  });

  test('declares the in-scope route/auth perimeter', async () => {
    const expectedInScope = [
      '/dashboard',
      '/cards',
      '/cards/new',
      '/card-route/:qr',
      '/approvals',
      '/provision',
      '/input-control',
      '/departments',
      '/operations',
      '/areas',
      '/employees',
      '/shift-times',
      '/users',
      '/accessLevels',
      '/profile/:id',
      '/production/schedule',
      '/production/plan',
      '/production/shifts',
      '/production/shifts/:key',
      '/production/gantt/:...',
      '/workspace',
      '/workspace/:qr',
      '/production/delayed',
      '/production/delayed/:qr',
      '/production/defects',
      '/production/defects/:qr',
      '/workorders',
      '/workorders/:qr',
      '/archive',
      '/archive/:qr',
      '/items',
      '/ok',
      '/oc'
    ];
    const dynamicRouteFamilies = [
      '/card-route/:qr',
      '/profile/:id',
      '/production/shifts/:key',
      '/production/gantt/:...',
      '/workspace/:qr',
      '/production/delayed/:qr',
      '/production/defects/:qr',
      '/workorders/:qr',
      '/archive/:qr'
    ];

    expect([...IN_SCOPE_BASE_ROUTES, ...dynamicRouteFamilies].sort()).toEqual(expectedInScope.sort());
  });

  test('logs in, respects URL, survives F5 and browser history', async ({ page }) => {
    test.setTimeout(300000);
    const diagnostics = attachDiagnostics(page);
    const db = loadSnapshotDb();
    const stage1Fixture = getStage1RouteFixture(db);

    await loginAsAbyss(page);

    const routeChecks = [...IN_SCOPE_BASE_ROUTES];

    const deepRouteChecks = [];

    if (stage1Fixture.routeCard?.qrId) {
      routeChecks.push(`/card-route/${encodeURIComponent(stage1Fixture.routeCard.qrId)}`);
      deepRouteChecks.push(
        {
          inputPath: `/cards/${encodeURIComponent(stage1Fixture.routeCard.id)}`,
          expectedPath: `/cards/${encodeURIComponent(stage1Fixture.routeCard.qrId)}`,
          pageId: 'page-cards-new'
        },
        {
          inputPath: `/card-route/${encodeURIComponent(stage1Fixture.routeCard.qrId)}/log`,
          expectedPath: `/card-route/${encodeURIComponent(stage1Fixture.routeCard.qrId)}/log`,
          pageId: 'page-card-log'
        },
        {
          inputPath: `/workorders/${encodeURIComponent(stage1Fixture.routeCard.qrId)}`,
          expectedPath: `/workorders/${encodeURIComponent(stage1Fixture.routeCard.qrId)}`,
          pageId: 'page-workorders-card'
        },
        {
          inputPath: `/production/gantt/${encodeURIComponent(stage1Fixture.routeCard.qrId)}`,
          expectedPath: `/production/gantt/${encodeURIComponent(stage1Fixture.routeCard.qrId)}`,
          pageId: 'page-production-gantt'
        },
        {
          inputPath: `/production/delayed/${encodeURIComponent(stage1Fixture.routeCard.qrId)}`,
          expectedPath: `/production/delayed/${encodeURIComponent(stage1Fixture.routeCard.qrId)}`,
          pageId: 'page-workorders-card'
        },
        {
          inputPath: `/production/defects/${encodeURIComponent(stage1Fixture.routeCard.qrId)}`,
          expectedPath: `/production/defects/${encodeURIComponent(stage1Fixture.routeCard.qrId)}`,
          pageId: 'page-workorders-card'
        }
      );
    }

    if (stage1Fixture.abyssUser?.id) {
      const profileUserId = encodeURIComponent(stage1Fixture.abyssUser.id);
      deepRouteChecks.push({
        inputPath: `/profile/${profileUserId}`,
        expectedPath: `/profile/${profileUserId}`,
        pageId: 'page-user-profile'
      });
    }

    if (stage1Fixture.workspaceCard?.qrId) {
      deepRouteChecks.push({
        inputPath: `/workspace/${encodeURIComponent(stage1Fixture.workspaceCard.qrId)}`,
        expectedPath: `/workspace/${encodeURIComponent(stage1Fixture.workspaceCard.qrId)}`,
        pageId: 'page-workorders-card'
      });
    }

    if (stage1Fixture.archivedCard?.qrId) {
      deepRouteChecks.push({
        inputPath: `/archive/${encodeURIComponent(stage1Fixture.archivedCard.qrId)}`,
        expectedPath: `/archive/${encodeURIComponent(stage1Fixture.archivedCard.qrId)}`,
        pageId: 'page-archive-card'
      });
    }

    if (stage1Fixture.shiftRoutePath) {
      deepRouteChecks.push({
        inputPath: stage1Fixture.shiftRoutePath,
        expectedPath: stage1Fixture.shiftRoutePath,
        pageId: 'page-production-shift-close'
      });
    }

    for (const route of routeChecks) {
      await openRouteAndAssert(page, route);
      await waitForRouteDataIdle(page);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitUsableUi(page, route);
      await waitForRouteDataIdle(page);
      await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe(route);
    }

    for (const route of deepRouteChecks) {
      const spec = await openRouteAndAssert(page, route);
      await waitForRouteDataIdle(page);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitUsableUi(page, spec);
      await waitForRouteDataIdle(page);
      await openRouteAndAssert(page, '/dashboard');
      await waitForRouteDataIdle(page);
      await page.goBack({ waitUntil: 'domcontentloaded' });
      await waitUsableUi(page, spec);
      await waitForRouteDataIdle(page);
      await page.goForward({ waitUntil: 'domcontentloaded' });
      await waitUsableUi(page, '/dashboard');
      await waitForRouteDataIdle(page);
    }

    await openRouteAndAssert(page, '/cards');
    await waitForRouteDataIdle(page);
    await openRouteAndAssert(page, '/production/plan');
    await waitForRouteDataIdle(page);
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await waitUsableUi(page, '/cards');
    await waitForRouteDataIdle(page);
    await page.goForward({ waitUntil: 'domcontentloaded' });
    await waitUsableUi(page, '/production/plan');
    await waitForRouteDataIdle(page);

    await openRouteAndAssert(page, '/workspace');
    await waitForRouteDataIdle(page);
    const workspaceQr = await page.evaluate(() => {
      const qrText = [...document.querySelectorAll('details.workspace-card .muted')]
        .map((el) => (el.textContent || '').trim())
        .find((text) => /^QR:\s+/i.test(text));
      return qrText ? qrText.replace(/^QR:\s+/i, '').trim() : '';
    });
    if (workspaceQr) {
      const directWorkspaceRoute = {
        inputPath: `/workspace/${encodeURIComponent(workspaceQr)}`,
        expectedPath: `/workspace/${encodeURIComponent(workspaceQr)}`,
        pageId: 'page-workorders-card'
      };
      await openRouteAndAssert(page, directWorkspaceRoute);
      await waitForRouteDataIdle(page);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitUsableUi(page, directWorkspaceRoute);
      await waitForRouteDataIdle(page);
    }

    expectNoCriticalClientFailures(diagnostics, {
      ignoreConsolePatterns: [
        /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
        /^\[LIVE\]/i,
        /^\[PRODUCTION\] areas layout load failed TypeError: Failed to fetch/i,
        /^\[DATA\] scope load failed .*reason: background:/i,
        /^\[DATA\] scope load unauthorized/i,
        /Не удалось загрузить данные с сервера/i,
        /Не удалось загрузить данные доступа TypeError: Failed to fetch/i,
        /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
      ]
    });
  });

  test('preserves direct protected URL through login and blocks foreign profile access', async ({ page }) => {
    test.setTimeout(180000);
    const diagnostics = attachDiagnostics(page);
    const db = loadSnapshotDb();
    const stage1Fixture = getStage1RouteFixture(db);

    const directUrlChecks = [
      '/cards',
      '/cards/new',
      '/approvals',
      '/departments',
      '/users',
      '/accessLevels',
      '/production/plan',
      '/workspace',
      '/archive',
      '/workorders',
      '/items'
    ];

    if (stage1Fixture.routeCard?.qrId) {
      directUrlChecks.push({
        inputPath: `/workorders/${encodeURIComponent(stage1Fixture.routeCard.qrId)}`,
        expectedPath: `/workorders/${encodeURIComponent(stage1Fixture.routeCard.qrId)}`,
        pageId: 'page-workorders-card'
      });
    }

    for (const route of directUrlChecks) {
      const spec = typeof route === 'string' ? { inputPath: route, expectedPath: route } : route;
      await loginAsAbyss(page, { startPath: spec.inputPath });
      await waitUsableUi(page, spec);
      await logoutViaUi(page);
    }

    if (stage1Fixture.foreignProfileUser?.id) {
      const foreignProfilePath = `/profile/${encodeURIComponent(stage1Fixture.foreignProfileUser.id)}`;
      await loginAsAbyss(page, { startPath: foreignProfilePath });
      await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe(foreignProfilePath);
      await expect.poll(() => page.evaluate(() => window.__currentPageId || null)).toBe('page-user-profile');
      await expect(page.locator('#user-profile-view')).toContainText('Доступ запрещён');
      await expect(page.locator('#user-profile-view')).toContainText('только владельцу');
    }

    expectNoCriticalClientFailures(diagnostics, {
      ignoreConsolePatterns: [
        /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
        /^\[LIVE\]/i,
        /^\[DATA\] scope load unauthorized/i,
        /Не удалось загрузить данные с сервера/i,
        /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
      ]
    });
  });

  test('logout from cards stops live refresh loops on auth-entry', async ({ page }) => {
    test.setTimeout(180000);
    const diagnostics = attachDiagnostics(page);

    await loginAsAbyss(page);
    await openRouteAndAssert(page, '/cards');
    await expect.poll(() => diagnostics.responses.filter((entry) => (
      entry.status === 200 && /\/api\/cards-live/i.test(entry.url || '')
    )).length).toBeGreaterThan(0);

    resetDiagnostics(diagnostics);
    await logoutViaUi(page);
    await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe('/');

    await page.fill('#login-password', 'ssyba');
    await page.waitForTimeout(6500);
    await expect(page.locator('#login-password')).toHaveValue('ssyba');

    const live401Responses = diagnostics.responses.filter((entry) => (
      entry.status === 401 && /\/api\/cards-live/i.test(entry.url || '')
    ));
    expect(live401Responses, `Unexpected cards-live 401 after logout: ${JSON.stringify(live401Responses, null, 2)}`).toEqual([]);

    expectNoCriticalClientFailures(diagnostics, {
      ignoreConsolePatterns: [
        /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
        /^\[LIVE\]/i,
        /^\[DATA\] scope load unauthorized/i,
        /Не удалось загрузить данные с сервера/i,
        /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
      ]
    });
  });

  test('keeps permission-sensitive protected routes behind auth and redirects only inside router', async ({ page }, testInfo) => {
    test.setTimeout(180000);
    const diagnostics = attachDiagnostics(page);
    const target = await createDashboardOnlyUser(testInfo.project.use.baseURL);
    const dialogs = [];
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.accept();
    });

    await loginWithPassword(page, target.password, {
      startPath: '/users',
      expectedBadgeText: target.user.name
    });
    await waitUsableUi(page, '/dashboard');
    await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe('/dashboard');
    await logoutViaUi(page);

    await loginWithPassword(page, target.password, {
      startPath: '/cards/new',
      expectedBadgeText: target.user.name
    });
    await waitUsableUi(page, '/dashboard');
    await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe('/dashboard');
    expect(dialogs.every(message => /Нет прав доступа к разделу/i.test(message))).toBe(true);
    expect(diagnostics.console.filter(entry => /^\[ROUTE\] access denied/i.test(entry.text || '')).length).toBeGreaterThanOrEqual(2);

    expectNoCriticalClientFailures(diagnostics, {
      ignoreConsolePatterns: [
        /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
        /^\[LIVE\]/i,
        /^\[DATA\] scope load unauthorized/i,
        /Не удалось загрузить данные с сервера/i,
        /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
      ]
    });
  });
});
