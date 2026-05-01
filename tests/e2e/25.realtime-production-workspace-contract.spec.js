const { test, expect } = require('@playwright/test');
const { seedSqlFixture } = require('./helpers/sqlSeed');
const { restartServer, stopServer } = require('./helpers/server');
const { loginAsAbyss } = require('./helpers/auth');
const { openRouteAndAssert } = require('./helpers/navigation');
const { attachDiagnostics, resetDiagnostics, expectNoCriticalClientFailures } = require('./helpers/diagnostics');

const IGNORE_LIVE_CONSOLE = [
  /^\[LIVE\]/i,
  /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i,
  /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i
];

function hasDerivedSqlSourceEnv() {
  const isOne = (name) => String(process.env[name] || '').trim() === '1';
  const hasCards = isOne('TSPCC_CARDS_SQL_SOURCE');
  const hasDirectoriesSecurity = isOne('TSPCC_DIRECTORIES_SECURITY_SQL_SOURCE')
    || isOne('TSPCC_DIRECTORIES_SQL_SOURCE')
    || isOne('TSPCC_SECURITY_SQL_SOURCE');
  const hasProduction = isOne('TSPCC_PRODUCTION_SQL_SOURCE')
    || (isOne('TSPCC_PRODUCTION_PLANNING_SQL_SOURCE') && isOne('TSPCC_PRODUCTION_EXECUTION_SQL_SOURCE'));
  return hasCards && hasDirectoriesSecurity && hasProduction;
}

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

async function signalFakeCardLivePayload(page) {
  return page.evaluate(() => {
    const cardList = Array.isArray(cards) ? cards : [];
    const card = cardList.find(item => item && item.id);
    if (!card) return { handled: false, markerApplied: false, hasCard: false };
    const marker = `live-payload-marker-${Date.now()}`;
    const payloadCard = {
      ...JSON.parse(JSON.stringify(card)),
      __stage12LivePayloadMarker: marker
    };
    const handled = typeof handleProductionWorkspaceStructuredCardLiveEvent === 'function'
      ? handleProductionWorkspaceStructuredCardLiveEvent('card.updated', {
        entity: 'card',
        action: 'updated',
        id: card.id,
        card: payloadCard
      })
      : false;
    const stored = (Array.isArray(cards) ? cards : []).find(item => item && item.id === card.id);
    return {
      handled,
      markerApplied: stored?.__stage12LivePayloadMarker === marker,
      hasCard: true
    };
  });
}

async function findWorkspaceCommentTarget(page) {
  return page.evaluate(() => {
    const cardList = Array.isArray(cards) ? cards : [];
    const buttons = [...document.querySelectorAll('button[data-action="op-comments"][data-card-id][data-op-id]')];
    for (const button of buttons) {
      const cardId = button.getAttribute('data-card-id') || '';
      const opId = button.getAttribute('data-op-id') || '';
      const card = cardList.find(item => item && item.id === cardId);
      const op = (card?.operations || []).find(item => item && item.id === opId);
      const qr = String(card?.qrId || '').trim();
      if (!card || !op || !qr) continue;
      return { cardId, opId, qr };
    }
    return null;
  });
}

async function openWorkspaceCommentModal(page, target) {
  const selector = `button[data-action="op-comments"][data-card-id="${target.cardId}"][data-op-id="${target.opId}"]`;
  await page.locator(selector).first().click();
  await expect(page.locator('#op-comments-modal')).toBeVisible();
}

async function submitWorkspaceComment(page, text) {
  await page.fill('#op-comments-input', text);
  return Promise.all([
    page.waitForResponse((res) => (
      res.request().method() === 'POST'
      && res.url().includes('/api/production/operation/comment')
    )),
    page.click('#op-comments-send')
  ]).then(([res]) => res);
}

async function createPlanningScheduleAssignmentViaApi(page, dateKey) {
  return page.evaluate(async ({ dateKey }) => {
    const sliceResponse = await apiFetch('/api/production/planning/slice?slice=schedule', {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'Accept': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });
    const slicePayload = await sliceResponse.json().catch(() => ({}));
    const expectedRev = Number(slicePayload?.revision?.rev);
    const area = (Array.isArray(slicePayload?.areas) ? slicePayload.areas : []).find(item => item && item.id);
    const employee = (Array.isArray(slicePayload?.users) ? slicePayload.users : []).find(item => (
      item
      && item.id
      && String(item.login || item.name || '').toLowerCase() !== 'abyss'
    ));
    if (!sliceResponse.ok || !Number.isFinite(expectedRev) || !area?.id || !employee?.id) {
      return {
        skipped: true,
        ok: false,
        status: sliceResponse.status,
        payload: slicePayload
      };
    }

    const assignment = {
      date: dateKey,
      shift: 1,
      areaId: area.id,
      employeeId: employee.id,
      timeFrom: null,
      timeTo: null
    };
    const response = await apiFetch('/api/production/planning/schedule/assignments/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'add',
        expectedRev,
        routePath: '/production/schedule',
        assignments: [assignment]
      })
    });
    const payload = await response.json().catch(() => ({}));
    return {
      skipped: false,
      ok: response.ok,
      status: response.status,
      assignment,
      payload
    };
  }, { dateKey });
}

async function findWorkspaceFlowCommitTarget(page) {
  return page.evaluate(() => {
    const cardList = Array.isArray(cards) ? cards : [];
    for (const card of cardList) {
      const qr = String(card?.qrId || '').trim();
      if (!card?.id || !qr) continue;
      const operations = Array.isArray(card.operations) ? card.operations : [];
      for (const op of operations) {
        if (!op?.id || op.isSamples) continue;
        if (String(op.status || '').toUpperCase() !== 'IN_PROGRESS') continue;
        if (typeof getWorkspaceOpenShiftPlanStats === 'function'
          && !getWorkspaceOpenShiftPlanStats(card, op, null)) {
          continue;
        }
        const items = Array.isArray(card?.flow?.items) ? card.flow.items : [];
        const item = items.find(entry => (
          entry
          && String(entry?.current?.opId || '') === String(op.id)
          && String(entry?.current?.status || '').toUpperCase() === 'PENDING'
        ));
        if (!item?.id) continue;
        const stats = typeof getWorkspaceOpenShiftPlanStats === 'function'
          ? getWorkspaceOpenShiftPlanStats(card, op, null)
          : null;
        return {
          cardId: card.id,
          opId: op.id,
          itemId: item.id,
          qr,
          flowVersion: Number.isFinite(card?.flow?.version) ? card.flow.version : 1,
          expectedDoneQty: Number(stats?.doneQty || 0) + 1
        };
      }
    }
    return null;
  });
}

async function commitWorkspaceFlowItem(page, target, status = 'DELAYED') {
  return page.evaluate(async ({ target, status }) => {
    const response = await apiFetch('/api/production/flow/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cardId: target.cardId,
        opId: target.opId,
        kind: 'ITEM',
        updates: [{
          itemId: target.itemId,
          status,
          comment: ''
        }],
        expectedFlowVersion: target.flowVersion
      })
    });
    const payload = await response.json().catch(() => ({}));
    return {
      ok: response.ok,
      status: response.status,
      payload
    };
  }, { target, status });
}

async function waitForWorkspaceSse(page) {
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

test.describe.serial('production/workspace realtime server-refresh contract', () => {
  test.beforeAll(async () => {
    seedSqlFixture('baseline-with-production-fixtures');
    await restartServer();
  });

  test.afterAll(async () => {
    await stopServer();
  });

  test('planning live signal refreshes route-local planning slice and does not apply card payload', async ({ browser }) => {
    const client = await openLoggedInPage(browser, '/production/plan');
    const planningReads = trackGetRequestsWithHeaders(client.page, /\/api\/production\/planning\/slice\?/i);
    try {
      const result = await signalFakeCardLivePayload(client.page);
      expect(result.hasCard).toBeTruthy();
      expect(result.handled).toBeTruthy();
      expect(result.markerApplied).toBeFalsy();

      await expect.poll(() => {
        return client.diagnostics.responses.filter(entry => (
          entry.method === 'GET'
          && /\/api\/production\/planning\/slice\?/i.test(entry.url || '')
          && /[?&]slice=plan(?:&|$)/i.test(entry.url || '')
        )).length;
      }).toBeGreaterThan(0);
      expect(planningReads.some(entry => (
        /[?&]slice=plan(?:&|$)/i.test(entry.url || '')
        && String(entry.headers['cache-control'] || '').toLowerCase().includes('no-cache')
      ))).toBeTruthy();

      const broadProductionReads = client.diagnostics.responses.filter(entry => (
        entry.method === 'GET'
        && /\/api\/data\?scope=production/i.test(entry.url || '')
      ));
      expect(broadProductionReads).toEqual([]);
      expectNoCriticalClientFailures(client.diagnostics, {
        ignoreConsolePatterns: IGNORE_LIVE_CONSOLE
      });
    } finally {
      await client.context.close();
    }
  });

  test('planning fallback refresh runs when app live stream is unavailable', async ({ browser }) => {
    const client = await openLoggedInPageWithUnavailableAppSse(browser, '/production/plan');
    const planningReads = trackGetRequestsWithHeaders(client.page, /\/api\/production\/planning\/slice\?/i);
    try {
      resetDiagnostics(client.diagnostics);
      planningReads.length = 0;

      await client.page.evaluate(() => {
        if (typeof stopProductionLiveIfNeeded === 'function') stopProductionLiveIfNeeded();
        if (typeof startProductionLiveIfNeeded === 'function') startProductionLiveIfNeeded();
      });

      await expect.poll(() => planningReads.filter(entry => (
        /[?&]slice=plan(?:&|$)/i.test(entry.url || '')
      )).length).toBeGreaterThan(0);
      expect(planningReads.some(entry => (
        /[?&]slice=plan(?:&|$)/i.test(entry.url || '')
        && String(entry.headers['cache-control'] || '').toLowerCase().includes('no-cache')
      ))).toBeTruthy();

      const broadProductionReads = client.diagnostics.responses.filter(entry => (
        entry.method === 'GET'
        && /\/api\/data\?scope=production/i.test(entry.url || '')
      ));
      expect(broadProductionReads).toEqual([]);
      expectNoCriticalClientFailures(client.diagnostics, {
        ignoreConsolePatterns: IGNORE_LIVE_CONSOLE
      });
    } finally {
      await client.context.close();
    }
  });

  test('planning fallback refreshes schedule slice after a real two-tab write with live unavailable', async ({ browser }) => {
    const observer = await openLoggedInPageWithUnavailableAppSse(browser, '/production/schedule');
    const actor = await openLoggedInPage(browser, '/production/schedule');
    const planningReads = trackGetRequestsWithHeaders(observer.page, /\/api\/production\/planning\/slice\?/i);
    try {
      resetDiagnostics(observer.diagnostics);
      resetDiagnostics(actor.diagnostics);
      planningReads.length = 0;

      const created = await createPlanningScheduleAssignmentViaApi(actor.page, '2099-06-21');
      test.skip(created.skipped, 'Нет данных для real planning fallback assignment');
      expect(created.ok, JSON.stringify(created)).toBeTruthy();
      expect(created.assignment?.areaId).toBeTruthy();
      expect(created.assignment?.employeeId).toBeTruthy();

      await observer.page.evaluate(() => {
        if (typeof stopProductionLiveIfNeeded === 'function') stopProductionLiveIfNeeded();
        if (typeof startProductionLiveIfNeeded === 'function') startProductionLiveIfNeeded();
      });

      await expect.poll(() => planningReads.filter(entry => (
        /[?&]slice=schedule(?:&|$)/i.test(entry.url || '')
      )).length).toBeGreaterThan(0);
      expect(planningReads.some(entry => (
        /[?&]slice=schedule(?:&|$)/i.test(entry.url || '')
        && String(entry.headers['cache-control'] || '').toLowerCase().includes('no-cache')
      ))).toBeTruthy();
      await expect.poll(() => observer.page.evaluate(({ assignment }) => {
        return (Array.isArray(productionSchedule) ? productionSchedule : []).some(item => (
          String(item?.date || '') === assignment.date
          && Number(item?.shift || 0) === Number(assignment.shift || 0)
          && String(item?.areaId || '') === String(assignment.areaId || '')
          && String(item?.employeeId || '') === String(assignment.employeeId || '')
        ));
      }, created)).toBe(true);
      await expect.poll(() => new URL(observer.page.url()).pathname).toBe('/production/schedule');

      expectNoCriticalClientFailures(observer.diagnostics, {
        ignoreConsolePatterns: IGNORE_LIVE_CONSOLE
      });
      expectNoCriticalClientFailures(actor.diagnostics, {
        ignoreConsolePatterns: IGNORE_LIVE_CONSOLE
      });
    } finally {
      await observer.context.close();
      await actor.context.close();
    }
  });

  test('planning cards:changed delayed by ignore window still refreshes planning slice', async ({ browser }) => {
    const client = await openLoggedInPage(browser, '/production/plan');
    try {
      await client.page.evaluate(() => {
        window.__productionLiveIgnoreUntil = Date.now() + 350;
        if (typeof scheduleProductionLiveRefresh === 'function') {
          scheduleProductionLiveRefresh('sse', 0);
        }
      });

      await expect.poll(() => {
        return client.diagnostics.responses.filter(entry => (
          entry.method === 'GET'
          && /\/api\/production\/planning\/slice\?/i.test(entry.url || '')
          && /[?&]slice=plan(?:&|$)/i.test(entry.url || '')
        )).length;
      }).toBeGreaterThan(0);

      expectNoCriticalClientFailures(client.diagnostics, {
        ignoreConsolePatterns: IGNORE_LIVE_CONSOLE
      });
    } finally {
      await client.context.close();
    }
  });

  test('production execution live debounce keeps multiple affected card ids', async ({ browser }) => {
    const client = await openLoggedInPage(browser, '/production/delayed');
    try {
      const result = await client.page.evaluate(async () => {
        const targets = (Array.isArray(cards) ? cards : [])
          .filter(card => card && card.id)
          .slice(0, 2)
          .map(card => String(card.id || '').trim());
        if (targets.length < 2 || typeof handleProductionWorkspaceStructuredCardLiveEvent !== 'function') {
          return { skipped: true, targets, fetched: [] };
        }

        const originalFetch = fetchCardsCoreCard;
        const fetched = [];
        fetchCardsCoreCard = async function patchedFetchCardsCoreCard(cardId, options) {
          fetched.push(String(cardId || '').trim());
          return originalFetch.apply(this, arguments);
        };

        try {
          handleProductionWorkspaceStructuredCardLiveEvent('card.updated', {
            entity: 'card',
            action: 'updated',
            id: targets[0],
            card: { id: targets[0] }
          });
          handleProductionWorkspaceStructuredCardLiveEvent('card.updated', {
            entity: 'card',
            action: 'updated',
            id: targets[1],
            card: { id: targets[1] }
          });
          await new Promise(resolve => setTimeout(resolve, 1200));
          return { skipped: false, targets, fetched };
        } finally {
          fetchCardsCoreCard = originalFetch;
        }
      });

      test.skip(result.skipped, 'Нет двух карточек для проверки production live debounce');
      expect(result.fetched).toEqual(expect.arrayContaining(result.targets));
      expect(new Set(result.fetched).size).toBeGreaterThanOrEqual(2);

      expectNoCriticalClientFailures(client.diagnostics, {
        ignoreConsolePatterns: IGNORE_LIVE_CONSOLE
      });
    } finally {
      await client.context.close();
    }
  });

  test('workspace live signal refreshes card flow state from server and does not apply card payload', async ({ browser }) => {
    const client = await openLoggedInPage(browser, '/workspace');
    try {
      const result = await signalFakeCardLivePayload(client.page);
      expect(result.hasCard).toBeTruthy();
      expect(result.handled).toBeTruthy();
      expect(result.markerApplied).toBeFalsy();

      await expect.poll(() => {
        return client.diagnostics.responses.filter(entry => (
          entry.method === 'GET'
          && /\/api\/cards-core\/[^/?#]+/i.test(entry.url || '')
        )).length;
      }).toBeGreaterThan(0);

      expectNoCriticalClientFailures(client.diagnostics, {
        ignoreConsolePatterns: IGNORE_LIVE_CONSOLE
      });
    } finally {
      await client.context.close();
    }
  });

  test('workspace fallback refresh runs when app live stream is unavailable', async ({ browser }) => {
    const client = await openLoggedInPageWithUnavailableAppSse(browser, '/workspace');
    try {
      resetDiagnostics(client.diagnostics);

      await client.page.evaluate(() => {
        if (typeof stopWorkspaceLiveIfNeeded === 'function') stopWorkspaceLiveIfNeeded();
        if (typeof startWorkspaceLiveIfNeeded === 'function') startWorkspaceLiveIfNeeded();
      });

      await expect.poll(() => {
        return client.diagnostics.responses.filter(entry => (
          entry.method === 'GET'
          && /\/api\/production\/execution\/scope/i.test(entry.url || '')
        )).length;
      }).toBeGreaterThan(0);
      expect(client.diagnostics.responses.filter(entry => (
        entry.method === 'GET'
        && /\/api\/data\?scope=production/i.test(entry.url || '')
      ))).toEqual([]);

      expectNoCriticalClientFailures(client.diagnostics, {
        ignoreConsolePatterns: IGNORE_LIVE_CONSOLE
      });
    } finally {
      await client.context.close();
    }
  });

  test('workspace cards:changed delayed by ignore window still refreshes server state', async ({ browser }) => {
    const client = await openLoggedInPage(browser, '/workspace');
    try {
      await client.page.evaluate(() => {
        window.__workspaceLiveIgnoreUntil = Date.now() + 350;
        if (typeof scheduleWorkspaceLiveRefresh === 'function') {
          scheduleWorkspaceLiveRefresh('sse', 0);
        }
      });

      await expect.poll(() => {
        return client.diagnostics.responses.filter(entry => (
          entry.method === 'GET'
          && /\/api\/production\/execution\/scope/i.test(entry.url || '')
        )).length;
      }).toBeGreaterThan(0);
      expect(client.diagnostics.responses.filter(entry => (
        entry.method === 'GET'
        && /\/api\/data\?scope=production/i.test(entry.url || '')
      ))).toEqual([]);

      expectNoCriticalClientFailures(client.diagnostics, {
        ignoreConsolePatterns: IGNORE_LIVE_CONSOLE
      });
    } finally {
      await client.context.close();
    }
  });

  test('workspace detail fallback refreshes after a real two-tab comment with live unavailable', async ({ browser }) => {
    const observer = await openLoggedInPageWithUnavailableAppSse(browser, '/workspace');
    const actor = await openLoggedInPage(browser, '/workspace');
    try {
      const target = await findWorkspaceCommentTarget(actor.page);
      test.skip(!target?.opId || !target?.qr, 'Нет доступной операции для workspace no-live fallback');
      const detailRoute = `/workspace/${encodeURIComponent(target.qr)}`;
      await Promise.all([
        openRouteAndAssert(observer.page, {
          inputPath: detailRoute,
          expectedPath: detailRoute,
          pageId: 'page-workorders-card'
        }),
        openRouteAndAssert(actor.page, {
          inputPath: detailRoute,
          expectedPath: detailRoute,
          pageId: 'page-workorders-card'
        })
      ]);
      await openWorkspaceCommentModal(observer.page, target);
      await openWorkspaceCommentModal(actor.page, target);
      resetDiagnostics(observer.diagnostics);
      resetDiagnostics(actor.diagnostics);

      const text = `Stage14 workspace no-live fallback ${Date.now()}`;
      const response = await submitWorkspaceComment(actor.page, text);
      expect(response.ok()).toBeTruthy();

      await observer.page.evaluate(() => {
        if (typeof stopWorkspaceLiveIfNeeded === 'function') stopWorkspaceLiveIfNeeded();
        if (typeof startWorkspaceLiveIfNeeded === 'function') startWorkspaceLiveIfNeeded();
      });

      await expect.poll(() => {
        return observer.diagnostics.responses.filter(entry => (
          entry.method === 'GET'
          && /\/api\/production\/execution\/scope/i.test(entry.url || '')
        )).length;
      }).toBeGreaterThan(0);
      expect(observer.diagnostics.responses.filter(entry => (
        entry.method === 'GET'
        && /\/api\/data\?scope=production/i.test(entry.url || '')
      ))).toEqual([]);
      await expect.poll(() => observer.page.evaluate(({ cardId, opId, text }) => {
        const card = (Array.isArray(cards) ? cards : []).find(item => item && item.id === cardId);
        const op = (card?.operations || []).find(item => item && item.id === opId);
        return (op?.comments || []).some(entry => String(entry?.text || '') === text);
      }, { ...target, text })).toBe(true);
      await expect(observer.page.locator('#op-comments-list')).toContainText(text);
      await expect.poll(() => new URL(observer.page.url()).pathname).toBe(detailRoute);

      expectNoCriticalClientFailures(observer.diagnostics, {
        ignoreConsolePatterns: IGNORE_LIVE_CONSOLE
      });
      expectNoCriticalClientFailures(actor.diagnostics, {
        ignoreConsolePatterns: IGNORE_LIVE_CONSOLE
      });
    } finally {
      await observer.context.close();
      await actor.context.close();
    }
  });

  test('workspace detail comments modal updates from live server refresh', async ({ browser }) => {
    const clientA = await openLoggedInPage(browser, '/workspace');
    const clientB = await openLoggedInPage(browser, '/workspace');
    try {
      const target = await findWorkspaceCommentTarget(clientA.page);
      test.skip(!target?.opId || !target?.qr, 'Нет доступной операции для workspace comment live');
      const detailRoute = `/workspace/${encodeURIComponent(target.qr)}`;
      await Promise.all([
        openRouteAndAssert(clientA.page, {
          inputPath: detailRoute,
          expectedPath: detailRoute,
          pageId: 'page-workorders-card'
        }),
        openRouteAndAssert(clientB.page, {
          inputPath: detailRoute,
          expectedPath: detailRoute,
          pageId: 'page-workorders-card'
        })
      ]);
      await Promise.all([
        waitForWorkspaceSse(clientA.page),
        waitForWorkspaceSse(clientB.page)
      ]);
      resetDiagnostics(clientA.diagnostics);
      resetDiagnostics(clientB.diagnostics);

      await openWorkspaceCommentModal(clientA.page, target);
      await openWorkspaceCommentModal(clientB.page, target);

      const text = `Stage12 workspace live comment ${Date.now()}`;
      const response = await submitWorkspaceComment(clientA.page, text);
      expect(response.ok()).toBeTruthy();

      await expect.poll(() => {
        return clientB.diagnostics.responses.filter(entry => (
          entry.method === 'GET'
          && (
            /\/api\/cards-core\/[^/?#]+/i.test(entry.url || '')
            || /\/api\/production\/execution\/scope/i.test(entry.url || '')
          )
        )).length;
      }).toBeGreaterThan(0);
      expect(clientB.diagnostics.responses.filter(entry => (
        entry.method === 'GET'
        && /\/api\/data\?scope=production/i.test(entry.url || '')
      ))).toEqual([]);
      await expect.poll(() => clientB.page.evaluate(({ cardId, opId, text }) => {
        const card = (Array.isArray(cards) ? cards : []).find(item => item && item.id === cardId);
        const op = (card?.operations || []).find(item => item && item.id === opId);
        return (op?.comments || []).some(entry => String(entry?.text || '') === text);
      }, { ...target, text })).toBe(true);
      await expect(clientB.page.locator('#op-comments-list')).toContainText(text);
      await expect.poll(() => new URL(clientA.page.url()).pathname).toBe(detailRoute);
      await expect.poll(() => new URL(clientB.page.url()).pathname).toBe(detailRoute);

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

  test('workspace detail sender renders first comment from server once', async ({ browser }) => {
    const client = await openLoggedInPage(browser, '/workspace');
    try {
      const target = await findWorkspaceCommentTarget(client.page);
      test.skip(!target?.opId || !target?.qr, 'Нет доступной операции для workspace comment server refresh');
      const detailRoute = `/workspace/${encodeURIComponent(target.qr)}`;
      await openRouteAndAssert(client.page, {
        inputPath: detailRoute,
        expectedPath: detailRoute,
        pageId: 'page-workorders-card'
      });
      await waitForWorkspaceSse(client.page);
      resetDiagnostics(client.diagnostics);

      await openWorkspaceCommentModal(client.page, target);

      const text = `Stage12 workspace server comment ${Date.now()}`;
      const response = await submitWorkspaceComment(client.page, text);
      expect(response.ok()).toBeTruthy();

      await expect.poll(() => client.page.locator('#op-comments-list .op-comments-item', { hasText: text }).count()).toBe(1);
      await client.page.evaluate(async ({ cardId }) => {
        await fetchCardsCoreCard(cardId, {
          force: true,
          reason: 'test-workspace-comment-server-confirm'
        });
        syncOpCommentsModalAfterDataSync();
      }, target);
      await expect.poll(() => client.page.evaluate(({ cardId, opId, text }) => {
        const card = (Array.isArray(cards) ? cards : []).find(item => item && item.id === cardId);
        const op = (card?.operations || []).find(item => item && item.id === opId);
        return (op?.comments || []).filter(entry => String(entry?.text || '') === text).length;
      }, { ...target, text })).toBe(1);
      await expect(client.page.locator('#op-comments-list .op-comments-item', { hasText: text })).toHaveCount(1);
      await expect.poll(() => new URL(client.page.url()).pathname).toBe(detailRoute);

      expectNoCriticalClientFailures(client.diagnostics, {
        ignoreConsolePatterns: IGNORE_LIVE_CONSOLE
      });
    } finally {
      await client.context.close();
    }
  });

  test('workorders detail comments modal updates from live server refresh', async ({ browser }) => {
    test.skip(!hasDerivedSqlSourceEnv(), 'Workorders detail live refresh requires SQL derived source env.');
    const clientA = await openLoggedInPage(browser, '/workorders');
    const clientB = await openLoggedInPage(browser, '/workorders');
    try {
      const target = await findWorkspaceCommentTarget(clientA.page);
      test.skip(!target?.opId || !target?.qr, 'Нет доступной операции для workorders comment live');
      const detailRoute = `/workorders/${encodeURIComponent(target.qr)}`;
      await Promise.all([
        openRouteAndAssert(clientA.page, {
          inputPath: detailRoute,
          expectedPath: detailRoute,
          pageId: 'page-workorders-card'
        }),
        openRouteAndAssert(clientB.page, {
          inputPath: detailRoute,
          expectedPath: detailRoute,
          pageId: 'page-workorders-card'
        })
      ]);
      await Promise.all([
        waitForWorkspaceSse(clientA.page),
        waitForWorkspaceSse(clientB.page)
      ]);
      resetDiagnostics(clientA.diagnostics);
      resetDiagnostics(clientB.diagnostics);

      await openWorkspaceCommentModal(clientA.page, target);
      await openWorkspaceCommentModal(clientB.page, target);

      const text = `Stage13 workorders live comment ${Date.now()}`;
      const response = await submitWorkspaceComment(clientA.page, text);
      expect(response.ok()).toBeTruthy();

      await expect.poll(() => {
        return clientB.diagnostics.responses.filter(entry => (
          entry.method === 'GET'
          && (
            /\/api\/cards-core\/[^/?#]+/i.test(entry.url || '')
            || /\/api\/derived\/workorders\/[^/?#]+/i.test(entry.url || '')
            || /\/api\/production\/execution\/scope/i.test(entry.url || '')
          )
        )).length;
      }).toBeGreaterThan(0);
      expect(clientB.diagnostics.responses.filter(entry => (
        entry.method === 'GET'
        && /\/api\/data\?scope=production/i.test(entry.url || '')
      ))).toEqual([]);
      await expect.poll(() => clientB.page.evaluate(({ cardId, opId, text }) => {
        const card = (Array.isArray(cards) ? cards : []).find(item => item && item.id === cardId);
        const op = (card?.operations || []).find(item => item && item.id === opId);
        return (op?.comments || []).some(entry => String(entry?.text || '') === text);
      }, { ...target, text })).toBe(true);
      await expect(clientB.page.locator('#op-comments-list')).toContainText(text);
      await expect.poll(() => new URL(clientA.page.url()).pathname).toBe(detailRoute);
      await expect.poll(() => new URL(clientB.page.url()).pathname).toBe(detailRoute);

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

  test('workorders comment live refreshes workspace detail route', async ({ browser }) => {
    test.skip(!hasDerivedSqlSourceEnv(), 'Workorders detail live refresh requires SQL derived source env.');
    const clientA = await openLoggedInPage(browser, '/workorders');
    const clientB = await openLoggedInPage(browser, '/workspace');
    try {
      const target = await findWorkspaceCommentTarget(clientB.page);
      test.skip(!target?.opId || !target?.qr, 'Нет доступной операции для workorders to workspace comment live');
      const workordersRoute = `/workorders/${encodeURIComponent(target.qr)}`;
      const workspaceRoute = `/workspace/${encodeURIComponent(target.qr)}`;
      await Promise.all([
        openRouteAndAssert(clientA.page, {
          inputPath: workordersRoute,
          expectedPath: workordersRoute,
          pageId: 'page-workorders-card'
        }),
        openRouteAndAssert(clientB.page, {
          inputPath: workspaceRoute,
          expectedPath: workspaceRoute,
          pageId: 'page-workorders-card'
        })
      ]);
      await Promise.all([
        waitForWorkspaceSse(clientA.page),
        waitForWorkspaceSse(clientB.page)
      ]);
      resetDiagnostics(clientA.diagnostics);
      resetDiagnostics(clientB.diagnostics);

      await openWorkspaceCommentModal(clientA.page, target);
      await openWorkspaceCommentModal(clientB.page, target);

      const text = `Stage13 workorders workspace live comment ${Date.now()}`;
      const response = await submitWorkspaceComment(clientA.page, text);
      expect(response.ok()).toBeTruthy();

      await expect.poll(() => {
        return clientB.diagnostics.responses.filter(entry => (
          entry.method === 'GET'
          && (
            /\/api\/cards-core\/[^/?#]+/i.test(entry.url || '')
            || /\/api\/production\/execution\/scope/i.test(entry.url || '')
          )
        )).length;
      }).toBeGreaterThan(0);
      expect(clientB.diagnostics.responses.filter(entry => (
        entry.method === 'GET'
        && /\/api\/data\?scope=production/i.test(entry.url || '')
      ))).toEqual([]);
      await expect.poll(() => clientB.page.evaluate(({ cardId, opId, text }) => {
        const card = (Array.isArray(cards) ? cards : []).find(item => item && item.id === cardId);
        const op = (card?.operations || []).find(item => item && item.id === opId);
        return (op?.comments || []).some(entry => String(entry?.text || '') === text);
      }, { ...target, text })).toBe(true);
      await expect(clientB.page.locator('#op-comments-list')).toContainText(text);
      await expect.poll(() => new URL(clientA.page.url()).pathname).toBe(workordersRoute);
      await expect.poll(() => new URL(clientB.page.url()).pathname).toBe(workspaceRoute);

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

  test('workspace detail flow commit updates shift summary in another client', async ({ browser }) => {
    const clientA = await openLoggedInPage(browser, '/workspace');
    const clientB = await openLoggedInPage(browser, '/workspace');
    try {
      const target = await findWorkspaceFlowCommitTarget(clientA.page);
      test.skip(!target?.opId || !target?.itemId || !target?.qr, 'Нет доступного изделия для проверки workspace flow live');
      const detailRoute = `/workspace/${encodeURIComponent(target.qr)}`;
      await Promise.all([
        openRouteAndAssert(clientA.page, {
          inputPath: detailRoute,
          expectedPath: detailRoute,
          pageId: 'page-workorders-card'
        }),
        openRouteAndAssert(clientB.page, {
          inputPath: detailRoute,
          expectedPath: detailRoute,
          pageId: 'page-workorders-card'
        })
      ]);
      await Promise.all([
        waitForWorkspaceSse(clientA.page),
        waitForWorkspaceSse(clientB.page)
      ]);
      resetDiagnostics(clientA.diagnostics);
      resetDiagnostics(clientB.diagnostics);

      const response = await commitWorkspaceFlowItem(clientA.page, target, 'DELAYED');
      expect(response.ok, JSON.stringify(response)).toBeTruthy();

      await expect.poll(() => {
        return clientB.diagnostics.responses.filter(entry => (
          entry.method === 'GET'
          && (
            /\/api\/cards-core\/[^/?#]+/i.test(entry.url || '')
            || /\/api\/production\/execution\/scope/i.test(entry.url || '')
          )
        )).length;
      }).toBeGreaterThan(0);
      expect(clientB.diagnostics.responses.filter(entry => (
        entry.method === 'GET'
        && /\/api\/data\?scope=production/i.test(entry.url || '')
      ))).toEqual([]);

      await expect.poll(() => clientB.page.evaluate(({ cardId, opId, itemId, expectedDoneQty }) => {
        const card = (Array.isArray(cards) ? cards : []).find(entry => entry && entry.id === cardId);
        const op = (card?.operations || []).find(entry => entry && entry.id === opId);
        const item = (Array.isArray(card?.flow?.items) ? card.flow.items : []).find(entry => entry && entry.id === itemId);
        const stats = card && op && typeof getWorkspaceOpenShiftPlanStats === 'function'
          ? getWorkspaceOpenShiftPlanStats(card, op, null)
          : null;
        return {
          status: String(item?.current?.status || ''),
          doneQty: Number(stats?.doneQty || 0),
          summaryText: document.body.innerText
        };
      }, target)).toEqual(expect.objectContaining({
        status: 'DELAYED',
        doneQty: target.expectedDoneQty
      }));

      await expect.poll(() => clientB.page.locator('.op-items-summary-line-shift').filter({
        hasText: `Факт: ${target.expectedDoneQty}`
      }).count()).toBeGreaterThan(0);
      await expect.poll(() => new URL(clientA.page.url()).pathname).toBe(detailRoute);
      await expect.poll(() => new URL(clientB.page.url()).pathname).toBe(detailRoute);

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
