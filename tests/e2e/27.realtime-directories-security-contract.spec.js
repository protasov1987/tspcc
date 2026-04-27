const { test, expect } = require('@playwright/test');
const { resetDatabaseFromSnapshot } = require('./helpers/snapshot');
const { restartServer, stopServer } = require('./helpers/server');
const { loginAsAbyss, waitForLoginForm } = require('./helpers/auth');
const { openRouteAndAssert } = require('./helpers/navigation');
const { attachDiagnostics, resetDiagnostics, expectNoCriticalClientFailures } = require('./helpers/diagnostics');

const IGNORE_LIVE_CONSOLE = [
  /^\[LIVE\]/i,
  /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i,
  /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i
];

async function openLoggedInPage(browser, route) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const diagnostics = attachDiagnostics(page);
  await loginAsAbyss(page);
  await openRouteAndAssert(page, route);
  resetDiagnostics(diagnostics);
  return { context, page, diagnostics };
}

async function openLoggedInPageWithUnavailableAppSse(browser, route) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(() => {
    const NativeEventSource = window.EventSource;
    window.EventSource = class Stage12UnavailableAppEventSource {
      constructor(url) {
        if (String(url || '').includes('/api/events/stream')) {
          throw new Error('Stage12 app stream disabled');
        }
        return new NativeEventSource(url);
      }
    };
  });
  const diagnostics = attachDiagnostics(page);
  await loginAsAbyss(page);
  await openRouteAndAssert(page, route);
  resetDiagnostics(diagnostics);
  return { context, page, diagnostics };
}

async function openLoggedInPageWithPassword(browser, route, password, expectedUserName) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const diagnostics = attachDiagnostics(page);
  await page.goto(route, { waitUntil: 'domcontentloaded' });
  await waitForLoginForm(page);
  await page.fill('#login-password', password);
  await page.click('#login-submit');
  await expect(page.locator('#app-root')).toBeVisible();
  await expect(page.locator('#app-root')).not.toHaveClass(/hidden/);
  if (expectedUserName) {
    await expect(page.locator('#user-badge')).toContainText(expectedUserName);
  }
  await openRouteAndAssert(page, route);
  resetDiagnostics(diagnostics);
  return { context, page, diagnostics };
}

async function waitForAppSse(page) {
  await expect.poll(() => page.evaluate(() => Boolean(window.cardsSseOnline || cardsSseOnline))).toBe(true);
}

function trackGetRequestsWithHeaders(page, matcher) {
  const requests = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET') return;
    const url = request.url();
    if (!matcher.test(url)) return;
    requests.push({
      url,
      headers: request.headers()
    });
  });
  return requests;
}

async function createOperationViaApi(page, name) {
  return page.evaluate(async (name) => {
    const response = await apiFetch('/api/directories/operations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        desc: 'Stage 12 realtime directory proof',
        recTime: 31,
        operationType: 'Стандартная'
      })
    });
    const payload = await response.json().catch(() => ({}));
    return {
      ok: response.ok,
      status: response.status,
      payload
    };
  }, name);
}

function buildEmployeesOnlyPermissions() {
  const tabKeys = [
    'dashboard',
    'cards',
    'approvals',
    'provision',
    'input-control',
    'production',
    'production-schedule',
    'production-plan',
    'production-shifts',
    'production-delayed',
    'production-defects',
    'departments',
    'operations',
    'areas',
    'employees',
    'shift-times',
    'workorders',
    'items',
    'ok',
    'oc',
    'archive',
    'receipts',
    'workspace',
    'users',
    'accessLevels'
  ];
  const tabs = Object.fromEntries(tabKeys.map(key => [key, { view: false, edit: false }]));
  tabs.dashboard = { view: true, edit: false };
  tabs.employees = { view: true, edit: false };
  return {
    tabs,
    attachments: { upload: false, remove: false },
    landingTab: 'employees',
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

async function createAccessLevelViaApi(page, name, permissions) {
  return page.evaluate(async ({ name, permissions }) => {
    const response = await apiFetch('/api/security/access-levels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        description: 'Stage 12 employees live permission fixture',
        permissions
      })
    });
    const payload = await response.json().catch(() => ({}));
    const accessLevel = (payload.accessLevels || []).find(level => String(level?.name || '') === name) || payload.accessLevel || null;
    return {
      ok: response.ok,
      status: response.status,
      payload,
      accessLevel
    };
  }, { name, permissions });
}

async function createUserViaApi(page, name, password, accessLevelId = '') {
  return page.evaluate(async ({ name, password, accessLevelId }) => {
    const levelId = String(accessLevelId || '').trim()
      || (accessLevels || []).find(level => String(level?.id || '') === 'level_admin')?.id
      || (accessLevels || [])[0]?.id
      || '';
    const response = await apiFetch('/api/security/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        password,
        accessLevelId: levelId,
        status: 'active'
      })
    });
    const payload = await response.json().catch(() => ({}));
    return {
      ok: response.ok,
      status: response.status,
      payload
    };
  }, { name, password, accessLevelId });
}

test.describe.serial('directories/security realtime server-refresh contract', () => {
  test.beforeAll(async () => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
  });

  test.afterAll(async () => {
    await stopServer();
  });

  test('uses server refresh for directory live hints, parse fallback and pending refresh', async ({ browser }) => {
    test.setTimeout(180000);
    const client = await openLoggedInPage(browser, '/operations');
    const directoryReads = trackGetRequestsWithHeaders(client.page, /\/api\/data\?scope=directories/i);
    try {
      await waitForAppSse(client.page);
      resetDiagnostics(client.diagnostics);
      directoryReads.length = 0;

      const synthetic = await client.page.evaluate(() => {
        const originalLoad = loadDataWithScope;
        window.__stage12DirectoryLiveOriginalLoad = originalLoad;
        window.__stage12DirectoryLiveLoadCalls = [];
        loadDataWithScope = async function patchedLoadDataWithScope(options) {
          window.__stage12DirectoryLiveLoadCalls.push(options || {});
          if (window.__stage12DirectoryLiveLoadCalls.length === 1) {
            setTimeout(() => {
              const area = (Array.isArray(areas) ? areas : []).find(item => item && item.id);
              applyDirectoryEvent({
                entity: 'directory.area',
                action: 'updated',
                id: area?.id || 'stage12-missing-area'
              });
            }, 10);
            await new Promise(resolve => setTimeout(resolve, 250));
          }
          return originalLoad.apply(this, arguments);
        };

        const operation = (Array.isArray(ops) ? ops : []).find(item => item && item.id);
        if (!operation) return { hasOperation: false, handled: false, markerApplied: false };
        const marker = `stage12-live-payload-${Date.now()}`;
        const handled = applyDirectoryEvent({
          entity: 'directory.operation',
          action: 'updated',
          id: operation.id,
          operation: {
            ...JSON.parse(JSON.stringify(operation)),
            name: marker
          }
        });
        const stored = (Array.isArray(ops) ? ops : []).find(item => item && item.id === operation.id);
        return {
          hasOperation: true,
          handled,
          markerApplied: stored?.name === marker
        };
      });
      expect(synthetic.hasOperation).toBeTruthy();
      expect(synthetic.handled).toBeTruthy();
      expect(synthetic.markerApplied).toBeFalsy();

      await expect.poll(() => client.page.evaluate(() => window.__stage12DirectoryLiveLoadCalls?.length || 0)).toBeGreaterThan(1);
      await client.page.evaluate(() => {
        if (window.__stage12DirectoryLiveOriginalLoad) {
          loadDataWithScope = window.__stage12DirectoryLiveOriginalLoad;
        }
      });

      await client.page.evaluate(() => {
        handleDirectorySecurityLiveMessage('directory.operation.updated', { data: '{bad json' });
      });
      await expect.poll(() => directoryReads.length).toBeGreaterThan(1);
      expect(directoryReads.some(entry => String(entry.headers['cache-control'] || '').toLowerCase().includes('no-cache'))).toBeTruthy();

      expectNoCriticalClientFailures(client.diagnostics, {
        ignoreConsolePatterns: IGNORE_LIVE_CONSOLE
      });
    } finally {
      await client.page.evaluate(() => {
        if (window.__stage12DirectoryLiveOriginalLoad) {
          loadDataWithScope = window.__stage12DirectoryLiveOriginalLoad;
        }
      }).catch(() => {});
      await client.context.close();
    }
  });

  test('directories fallback refresh runs when app live stream is unavailable', async ({ browser }) => {
    const client = await openLoggedInPageWithUnavailableAppSse(browser, '/operations');
    const directoryReads = trackGetRequestsWithHeaders(client.page, /\/api\/data\?scope=directories/i);
    try {
      resetDiagnostics(client.diagnostics);
      directoryReads.length = 0;

      await client.page.evaluate(() => {
        if (typeof stopCardsLiveIfNeeded === 'function') stopCardsLiveIfNeeded();
        if (typeof startCardsSse === 'function') startCardsSse();
      });

      await expect.poll(() => directoryReads.length).toBeGreaterThan(0);
      expect(directoryReads.some(entry => (
        String(entry.headers['cache-control'] || '').toLowerCase().includes('no-cache')
      ))).toBeTruthy();
      await expect.poll(() => new URL(client.page.url()).pathname).toBe('/operations');

      expectNoCriticalClientFailures(client.diagnostics, {
        ignoreConsolePatterns: IGNORE_LIVE_CONSOLE
      });
    } finally {
      await client.context.close();
    }
  });

  test('refreshes /operations from server after a real two-tab directory write', async ({ browser }) => {
    test.setTimeout(180000);
    const clientA = await openLoggedInPage(browser, '/operations');
    const clientB = await openLoggedInPage(browser, '/operations');
    const directoryReads = trackGetRequestsWithHeaders(clientA.page, /\/api\/data\?scope=directories/i);
    try {
      await Promise.all([
        waitForAppSse(clientA.page),
        waitForAppSse(clientB.page)
      ]);
      resetDiagnostics(clientA.diagnostics);
      resetDiagnostics(clientB.diagnostics);
      directoryReads.length = 0;

      const name = `Stage12 live operation ${String(Date.now()).slice(-7)}`;
      const created = await createOperationViaApi(clientB.page, name);
      expect(created.ok, JSON.stringify(created)).toBeTruthy();

      await expect.poll(() => directoryReads.length).toBeGreaterThan(0);
      await expect(clientA.page.locator('#operations-table-wrapper')).toContainText(name);
      await expect.poll(() => new URL(clientA.page.url()).pathname).toBe('/operations');
      expect(directoryReads.some(entry => String(entry.headers['cache-control'] || '').toLowerCase().includes('no-cache'))).toBeTruthy();

      expectNoCriticalClientFailures(clientA.diagnostics, {
        ignoreConsolePatterns: IGNORE_LIVE_CONSOLE
      });
      expectNoCriticalClientFailures(clientB.diagnostics, {
        ignoreConsolePatterns: IGNORE_LIVE_CONSOLE
      });
    } finally {
      await clientA.context.close();
      await clientB.context.close();
    }
  });

  test('refreshes /users from server after a real two-tab security write', async ({ browser }) => {
    test.setTimeout(180000);
    const clientA = await openLoggedInPage(browser, '/users');
    const clientB = await openLoggedInPage(browser, '/users');
    const securityReads = trackGetRequestsWithHeaders(clientA.page, /\/api\/security\/(?:users|access-levels)(?:\?|$)/i);
    try {
      await Promise.all([
        waitForAppSse(clientA.page),
        waitForAppSse(clientB.page)
      ]);
      resetDiagnostics(clientA.diagnostics);
      resetDiagnostics(clientB.diagnostics);
      securityReads.length = 0;

      const suffix = String(Date.now()).slice(-7);
      const name = `Stage12 Live User ${suffix}`;
      const created = await createUserViaApi(clientB.page, name, `Live${suffix}99`);
      expect(created.ok, JSON.stringify(created)).toBeTruthy();

      await expect.poll(() => securityReads.filter(entry => /\/api\/security\/users/i.test(entry.url)).length).toBeGreaterThan(0);
      await expect(clientA.page.locator('#users-table')).toContainText(name);
      await expect.poll(() => new URL(clientA.page.url()).pathname).toBe('/users');
      expect(securityReads.some(entry => String(entry.headers['cache-control'] || '').toLowerCase().includes('no-cache'))).toBeTruthy();

      expectNoCriticalClientFailures(clientA.diagnostics, {
        ignoreConsolePatterns: IGNORE_LIVE_CONSOLE
      });
      expectNoCriticalClientFailures(clientB.diagnostics, {
        ignoreConsolePatterns: IGNORE_LIVE_CONSOLE
      });
    } finally {
      await clientA.context.close();
      await clientB.context.close();
    }
  });

  test('refreshes /employees from directories scope after a /users create without users permission', async ({ browser }) => {
    test.setTimeout(180000);
    const admin = await openLoggedInPage(browser, '/users');
    let employeeClient = null;
    try {
      await waitForAppSse(admin.page);
      resetDiagnostics(admin.diagnostics);

      const suffix = String(Date.now()).slice(-7);
      const levelName = `Stage12 Employees Only ${suffix}`;
      const level = await createAccessLevelViaApi(admin.page, levelName, buildEmployeesOnlyPermissions());
      expect(level.ok, JSON.stringify(level)).toBeTruthy();
      expect(level.accessLevel?.id, JSON.stringify(level)).toBeTruthy();

      const employeePassword = `EmpLive${suffix}A1`;
      const employeeName = `Stage12 Employees Viewer ${suffix}`;
      const employeeUser = await createUserViaApi(admin.page, employeeName, employeePassword, level.accessLevel.id);
      expect(employeeUser.ok, JSON.stringify(employeeUser)).toBeTruthy();

      employeeClient = await openLoggedInPageWithPassword(browser, '/employees', employeePassword, employeeName);
      const directoryReads = trackGetRequestsWithHeaders(employeeClient.page, /\/api\/data\?scope=directories/i);

      await Promise.all([
        waitForAppSse(admin.page),
        waitForAppSse(employeeClient.page)
      ]);
      resetDiagnostics(employeeClient.diagnostics);
      resetDiagnostics(admin.diagnostics);
      directoryReads.length = 0;

      const targetName = `Stage12 Employee Live ${suffix}`;
      const created = await createUserViaApi(admin.page, targetName, `EmpTarget${suffix}A1`, 'level_admin');
      expect(created.ok, JSON.stringify(created)).toBeTruthy();

      await expect.poll(() => directoryReads.length).toBeGreaterThan(0);
      await expect(employeeClient.page.locator('#employees-table-wrapper')).toContainText(targetName);
      await expect.poll(() => new URL(employeeClient.page.url()).pathname).toBe('/employees');
      expect(directoryReads.some(entry => String(entry.headers['cache-control'] || '').toLowerCase().includes('no-cache'))).toBeTruthy();

      expectNoCriticalClientFailures(employeeClient.diagnostics, {
        ignoreConsolePatterns: IGNORE_LIVE_CONSOLE
      });
      expectNoCriticalClientFailures(admin.diagnostics, {
        ignoreConsolePatterns: IGNORE_LIVE_CONSOLE
      });
    } finally {
      if (employeeClient) {
        await employeeClient.context.close();
      }
      await admin.context.close();
    }
  });
});
