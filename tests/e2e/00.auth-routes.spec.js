const { test, expect } = require('@playwright/test');
const { resetDatabaseFromSnapshot } = require('./helpers/snapshot');
const { restartServer, stopServer } = require('./helpers/server');
const { attachDiagnostics, expectNoCriticalClientFailures } = require('./helpers/diagnostics');
const { expectWithinBudget } = require('./helpers/perf');
const { loginAsAbyss } = require('./helpers/auth');
const { openRouteAndAssert, waitUsableUi } = require('./helpers/navigation');
const { loadSnapshotDb, getProductionFixture } = require('./helpers/db');

test.describe.serial('Auth, bootstrap and routes', () => {
  test.beforeAll(async () => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
  });

  test.afterAll(async () => {
    await stopServer();
  });

  test('logs in, respects URL, survives F5 and browser history', async ({ page }) => {
    const diagnostics = attachDiagnostics(page);
    const db = loadSnapshotDb();
    const fixture = getProductionFixture(db);

    const login = await loginAsAbyss(page);
    expectWithinBudget('login usable UI', login.totalMs, 1000);

    const routeChecks = [
      '/dashboard',
      '/cards',
      '/production/plan',
      '/workspace',
      '/archive',
      '/approvals',
      '/provision',
      '/input-control',
      '/items',
      '/ok',
      '/oc',
      '/users',
      '/accessLevels',
      '/departments',
      '/operations',
      '/areas',
      '/employees',
      '/shift-times',
      '/production/schedule',
      '/production/shifts',
      '/production/delayed',
      '/production/defects'
    ];

    if (fixture.routeCard?.qrId) {
      routeChecks.push(`/card-route/${encodeURIComponent(fixture.routeCard.qrId)}`);
    }
    if (fixture.archivedCard?.qrId) {
      routeChecks.push(`/archive/${encodeURIComponent(fixture.archivedCard.qrId)}`);
    }

    for (const route of routeChecks) {
      const startedAt = Date.now();
      await openRouteAndAssert(page, route);
      const routeMs = Date.now() - startedAt;
      expectWithinBudget(`route ${route}`, routeMs, 1000);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitUsableUi(page, route);
      await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toContain(route);
    }

    await openRouteAndAssert(page, '/cards');
    await openRouteAndAssert(page, '/production/plan');
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await waitUsableUi(page, '/cards');
    await page.goForward({ waitUntil: 'domcontentloaded' });
    await waitUsableUi(page, '/production/plan');

    await openRouteAndAssert(page, '/workspace');
    const workspaceQr = await page.evaluate(() => {
      const qrText = [...document.querySelectorAll('details.workspace-card .muted')]
        .map((el) => (el.textContent || '').trim())
        .find((text) => /^QR:\s+/i.test(text));
      return qrText ? qrText.replace(/^QR:\s+/i, '').trim() : '';
    });
    if (workspaceQr) {
      const directWorkspaceRoute = `/workspace/${encodeURIComponent(workspaceQr)}`;
      await openRouteAndAssert(page, directWorkspaceRoute);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toContain(directWorkspaceRoute);
    }

    expectNoCriticalClientFailures(diagnostics);
  });
});
