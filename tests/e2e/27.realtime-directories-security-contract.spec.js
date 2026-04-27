const { test, expect } = require('@playwright/test');
const { resetDatabaseFromSnapshot } = require('./helpers/snapshot');
const { restartServer, stopServer } = require('./helpers/server');
const { loginAsAbyss } = require('./helpers/auth');
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

async function createUserViaApi(page, name, password) {
  return page.evaluate(async ({ name, password }) => {
    const levelId = (accessLevels || []).find(level => String(level?.id || '') === 'level_admin')?.id
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
  }, { name, password });
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
});
