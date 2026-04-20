const { test, expect } = require('@playwright/test');
const { resetDatabaseFromSnapshot } = require('./helpers/snapshot');
const { restartServer, stopServer } = require('./helpers/server');
const { attachDiagnostics, expectNoCriticalClientFailures } = require('./helpers/diagnostics');
const { loginAsAbyss } = require('./helpers/auth');
const { openRouteAndAssert, waitUsableUi } = require('./helpers/navigation');
const { loadSnapshotDb, getStage1RouteFixture } = require('./helpers/db');

test.describe.serial('Auth, bootstrap and routes', () => {
  test.beforeAll(async () => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
  });

  test.afterAll(async () => {
    await stopServer();
  });

  test('logs in, respects URL, survives F5 and browser history', async ({ page }) => {
    test.setTimeout(180000);
    const diagnostics = attachDiagnostics(page);
    const db = loadSnapshotDb();
    const stage1Fixture = getStage1RouteFixture(db);

    await loginAsAbyss(page);

    const routeChecks = [
      '/dashboard',
      '/cards',
      '/cards/new',
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
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitUsableUi(page, route);
      await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe(route);
    }

    for (const route of deepRouteChecks) {
      const spec = await openRouteAndAssert(page, route);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitUsableUi(page, spec);
      await openRouteAndAssert(page, '/dashboard');
      await page.goBack({ waitUntil: 'domcontentloaded' });
      await waitUsableUi(page, spec);
      await page.goForward({ waitUntil: 'domcontentloaded' });
      await waitUsableUi(page, '/dashboard');
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
      const directWorkspaceRoute = {
        inputPath: `/workspace/${encodeURIComponent(workspaceQr)}`,
        expectedPath: `/workspace/${encodeURIComponent(workspaceQr)}`,
        pageId: 'page-workorders-card'
      };
      await openRouteAndAssert(page, directWorkspaceRoute);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitUsableUi(page, directWorkspaceRoute);
    }

    expectNoCriticalClientFailures(diagnostics, {
      ignoreConsolePatterns: [
        /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
        /^\[LIVE\]/i,
        /Не удалось загрузить данные с сервера/i,
        /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
      ]
    });
  });
});
