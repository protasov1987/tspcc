const { test, expect, request: playwrightRequest } = require('@playwright/test');
const { resetDatabaseFromSnapshot } = require('./helpers/snapshot');
const { restartServer, stopServer } = require('./helpers/server');
const { attachDiagnostics, findConsoleEntries, resetDiagnostics, expectNoCriticalClientFailures } = require('./helpers/diagnostics');
const { loginAsAbyss } = require('./helpers/auth');
const { openRouteAndAssert } = require('./helpers/navigation');

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

function findExecutionCandidate(data) {
  const card = (data.cards || []).find(item => (
    item
    && item.id
    && item.flow
    && Number.isFinite(Number(item.flow.version))
    && (item.operations || []).some(op => op && op.id)
  ));
  const op = (card?.operations || []).find(item => item && item.id);
  expect(card?.id).toBeTruthy();
  expect(op?.id).toBeTruthy();
  return {
    card,
    op,
    flowVersion: Number(card.flow.version)
  };
}

function findPersonalOperationCandidate(data) {
  const cards = Array.isArray(data.cards) ? data.cards : [];
  for (const card of cards) {
    if (!card || !card.id || !card.flow || !Array.isArray(card.operations)) continue;
    const flowVersion = Number(card.flow.version);
    if (!Number.isFinite(flowVersion)) continue;
    const personalOperations = Array.isArray(card.personalOperations) ? card.personalOperations : [];
    for (const personalOperation of personalOperations) {
      const parentOpId = String(personalOperation?.parentOpId || '').trim();
      if (!parentOpId) continue;
      const op = card.operations.find(item => item && item.id === parentOpId);
      if (!op?.id) continue;
      const kind = String(personalOperation?.kind || '').toUpperCase() === 'SAMPLE' ? 'samples' : 'items';
      const selectedItem = (card.flow?.[kind] || []).find(item => (
        item
        && String(item?.current?.opId || '') === String(op.id)
        && String(item?.current?.status || '').toUpperCase() === 'PENDING'
      )) || (card.flow?.[kind] || [])[0];
      if (!selectedItem?.id) continue;
      return {
        card,
        op,
        personalOperation,
        selectedItemId: selectedItem.id,
        flowVersion
      };
    }
  }
  throw new Error('No personal operation execution candidate found');
}

function findFlowIssueCandidate(data, wantedStatus) {
  const normalizedStatus = String(wantedStatus || '').toUpperCase();
  const cards = Array.isArray(data.cards) ? data.cards : [];
  for (const card of cards) {
    if (!card || !card.id || !card.flow || !Array.isArray(card.operations)) continue;
    const flowVersion = Number(card.flow.version);
    if (!Number.isFinite(flowVersion)) continue;
    for (const kindKey of ['items', 'samples']) {
      const kind = kindKey === 'samples' ? 'SAMPLE' : 'ITEM';
      const items = Array.isArray(card.flow?.[kindKey]) ? card.flow[kindKey] : [];
      for (const item of items) {
        if (!item?.id) continue;
        const status = String(item?.current?.status || item?.finalStatus || '').toUpperCase();
        const opId = String(item?.current?.opId || '').trim();
        if (status !== normalizedStatus || !opId) continue;
        const op = card.operations.find(entry => entry && String(entry.id || '') === opId);
        if (!op?.id) continue;
        return { card, op, item, kind, flowVersion };
      }
    }
  }
  throw new Error(`No ${normalizedStatus} flow issue candidate found`);
}

function findDryingOperationCandidate(data) {
  const cards = Array.isArray(data.cards) ? data.cards : [];
  for (const card of cards) {
    if (!card || !card.id || !card.flow || !Array.isArray(card.operations)) continue;
    const flowVersion = Number(card.flow.version);
    if (!Number.isFinite(flowVersion)) continue;
    const op = card.operations.find(entry => (
      entry
      && entry.id
      && String(entry.opName || entry.name || entry.opCode || '').toLowerCase().includes('суш')
    ));
    if (op?.id) return { card, op, flowVersion };
  }
  throw new Error('No drying operation candidate found');
}

function findProductionPlanCandidate(sliceBody) {
  const area = (sliceBody.areas || []).find(item => item && item.id);
  const employee = (sliceBody.users || []).find(item => item && item.id && item.login !== 'Abyss');
  expect(area?.id).toBeTruthy();
  expect(employee?.id).toBeTruthy();
  return { area, employee };
}

async function expectFlowConflict(response, expected) {
  expect(response.status()).toBe(409);
  const body = await response.json();
  expect(body.code).toBe('STALE_REVISION');
  expect(body.entity).toBe('card.flow');
  expect(body.id).toBe(expected.cardId);
  expect(body.expectedRev).toBe(expected.staleFlowVersion);
  expect(body.actualRev).toBe(expected.flowVersion);
  expect(body.flowVersion).toBe(expected.flowVersion);
  expect(body.error || body.message).toBeTruthy();
  return body;
}

test.describe('production execution contract api', () => {
  test.beforeAll(async () => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
  });

  test.afterAll(async () => {
    await stopServer();
  });

  test('returns shared card.flow conflict envelope for stale expectedFlowVersion', async ({}, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const { api, csrfToken } = await loginApi(baseURL);

    try {
      const dataResponse = await api.get('/api/data');
      expect(dataResponse.ok()).toBeTruthy();
      const data = await dataResponse.json();
      const { card, op, flowVersion } = findExecutionCandidate(data);
      const staleFlowVersion = flowVersion === 0 ? flowVersion + 1 : flowVersion - 1;

      const response = await api.post('/api/production/operation/start', {
        headers: { 'x-csrf-token': csrfToken },
        data: {
          cardId: card.id,
          opId: op.id,
          expectedFlowVersion: staleFlowVersion,
          source: 'contract-test'
        }
      });
      expect(response.status()).toBe(409);
      const body = await response.json();

      expect(body.code).toBe('STALE_REVISION');
      expect(body.entity).toBe('card.flow');
      expect(body.id).toBe(card.id);
      expect(body.expectedRev).toBe(staleFlowVersion);
      expect(body.actualRev).toBe(flowVersion);
      expect(body.flowVersion).toBe(flowVersion);
      expect(body.error || body.message).toBeTruthy();
    } finally {
      await api.dispose();
    }
  });

  test('successful execution command increments flow version without bumping planning revision', async ({}, testInfo) => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
    const baseURL = testInfo.project.use.baseURL;
    const { api, csrfToken } = await loginApi(baseURL);

    try {
      const dataResponse = await api.get('/api/data');
      expect(dataResponse.ok()).toBeTruthy();
      const data = await dataResponse.json();
      const { card, op, flowVersion } = findExecutionCandidate(data);
      const planningRevBefore = Number(data?.meta?.domainRevisions?.productionPlanning);

      const response = await api.post('/api/production/operation/comment', {
        headers: { 'x-csrf-token': csrfToken },
        data: {
          cardId: card.id,
          opId: op.id,
          expectedFlowVersion: flowVersion,
          source: 'contract-test',
          text: `stage9 execution contract ${Date.now()}`
        }
      });
      expect(response.ok()).toBeTruthy();
      const body = await response.json();
      expect(body.flowVersion).toBe(flowVersion + 1);

      const afterResponse = await api.get('/api/data');
      expect(afterResponse.ok()).toBeTruthy();
      const after = await afterResponse.json();
      const savedCard = (after.cards || []).find(item => item && item.id === card.id);
      expect(Number(savedCard?.flow?.version)).toBe(flowVersion + 1);
      expect(Number(after?.meta?.domainRevisions?.productionPlanning)).toBe(planningRevBefore);
    } finally {
      await api.dispose();
    }
  });

  test('does not use productionPlanning revision as execution revision source', async ({}, testInfo) => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
    const baseURL = testInfo.project.use.baseURL;
    const { api, csrfToken } = await loginApi(baseURL);

    try {
      const sliceResponse = await api.get('/api/production/planning/slice?slice=schedule');
      expect(sliceResponse.ok()).toBeTruthy();
      const sliceBody = await sliceResponse.json();
      const planningRev = Number(sliceBody.revision.rev);
      const { area, employee } = findProductionPlanCandidate(sliceBody);

      const commitResponse = await api.post('/api/production/planning/schedule/assignments/commit', {
        headers: { 'x-csrf-token': csrfToken },
        data: {
          action: 'add',
          expectedRev: planningRev,
          assignments: [{
            date: '2099-02-21',
            shift: 1,
            areaId: area.id,
            employeeId: employee.id,
            timeFrom: null,
            timeTo: null
          }]
        }
      });
      expect(commitResponse.ok()).toBeTruthy();
      const commitBody = await commitResponse.json();
      const bumpedPlanningRev = Number(commitBody.revision.rev);
      expect(bumpedPlanningRev).toBe(planningRev + 1);
      expect(commitBody.revision.source).toBe('meta.domainRevisions.productionPlanning');

      const dataResponse = await api.get('/api/data');
      expect(dataResponse.ok()).toBeTruthy();
      const data = await dataResponse.json();
      const { card, op, flowVersion } = findExecutionCandidate(data);
      expect(bumpedPlanningRev).not.toBe(flowVersion);

      const response = await api.post('/api/production/operation/start', {
        headers: { 'x-csrf-token': csrfToken },
        data: {
          cardId: card.id,
          opId: op.id,
          expectedFlowVersion: bumpedPlanningRev,
          source: 'contract-test'
        }
      });
      expect(response.status()).toBe(409);
      const body = await response.json();

      expect(body.code).toBe('STALE_REVISION');
      expect(body.entity).toBe('card.flow');
      expect(body.expectedRev).toBe(bumpedPlanningRev);
      expect(body.actualRev).toBe(flowVersion);
      expect(body.flowVersion).toBe(flowVersion);
    } finally {
      await api.dispose();
    }
  });

  test('returns shared card.flow conflict envelope for personal operation select and action', async ({}, testInfo) => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
    const baseURL = testInfo.project.use.baseURL;
    const { api, csrfToken } = await loginApi(baseURL);

    try {
      const dataResponse = await api.get('/api/data');
      expect(dataResponse.ok()).toBeTruthy();
      const data = await dataResponse.json();
      const { card, op, personalOperation, selectedItemId, flowVersion } = findPersonalOperationCandidate(data);
      const staleFlowVersion = flowVersion === 0 ? flowVersion + 1 : flowVersion - 1;

      const selectResponse = await api.post('/api/production/personal-operation/select', {
        headers: { 'x-csrf-token': csrfToken },
        data: {
          cardId: card.id,
          parentOpId: op.id,
          expectedFlowVersion: staleFlowVersion,
          selectedItemIds: [selectedItemId]
        }
      });
      expect(selectResponse.status()).toBe(409);
      const selectBody = await selectResponse.json();
      expect(selectBody.code).toBe('STALE_REVISION');
      expect(selectBody.entity).toBe('card.flow');
      expect(selectBody.id).toBe(card.id);
      expect(selectBody.expectedRev).toBe(staleFlowVersion);
      expect(selectBody.actualRev).toBe(flowVersion);
      expect(selectBody.flowVersion).toBe(flowVersion);

      const actionResponse = await api.post('/api/production/personal-operation/action', {
        headers: { 'x-csrf-token': csrfToken },
        data: {
          cardId: card.id,
          parentOpId: op.id,
          personalOperationId: personalOperation.id,
          action: 'pause',
          expectedFlowVersion: staleFlowVersion
        }
      });
      expect(actionResponse.status()).toBe(409);
      const actionBody = await actionResponse.json();
      expect(actionBody.code).toBe('STALE_REVISION');
      expect(actionBody.entity).toBe('card.flow');
      expect(actionBody.id).toBe(card.id);
      expect(actionBody.expectedRev).toBe(staleFlowVersion);
      expect(actionBody.actualRev).toBe(flowVersion);
      expect(actionBody.flowVersion).toBe(flowVersion);
    } finally {
      await api.dispose();
    }
  });

  test('returns shared card.flow conflict envelope for execution command families', async ({}, testInfo) => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
    const baseURL = testInfo.project.use.baseURL;
    const { api, csrfToken } = await loginApi(baseURL);

    try {
      const dataResponse = await api.get('/api/data');
      expect(dataResponse.ok()).toBeTruthy();
      const data = await dataResponse.json();
      const execution = findExecutionCandidate(data);
      const delayed = findFlowIssueCandidate(data, 'DELAYED');
      const defect = findFlowIssueCandidate(data, 'DEFECT');
      const drying = findDryingOperationCandidate(data);
      const staleExecutionVersion = execution.flowVersion === 0 ? execution.flowVersion + 1 : execution.flowVersion - 1;
      const staleDelayedVersion = delayed.flowVersion === 0 ? delayed.flowVersion + 1 : delayed.flowVersion - 1;
      const staleDefectVersion = defect.flowVersion === 0 ? defect.flowVersion + 1 : defect.flowVersion - 1;
      const staleDryingVersion = drying.flowVersion === 0 ? drying.flowVersion + 1 : drying.flowVersion - 1;
      const tinyFile = {
        name: 'stage9-conflict.txt',
        type: 'text/plain',
        content: 'data:text/plain;base64,WA==',
        size: 1
      };

      const directCommands = [
        {
          endpoint: '/api/production/flow/commit',
          expected: { cardId: execution.card.id, flowVersion: execution.flowVersion, staleFlowVersion: staleExecutionVersion },
          data: {
            cardId: execution.card.id,
            opId: execution.op.id,
            kind: 'ITEM',
            expectedFlowVersion: staleExecutionVersion,
            updates: [{ itemId: 'stage9-stale-item', status: 'GOOD' }]
          }
        },
        {
          endpoint: '/api/production/flow/identify',
          expected: { cardId: execution.card.id, flowVersion: execution.flowVersion, staleFlowVersion: staleExecutionVersion },
          data: {
            cardId: execution.card.id,
            opId: execution.op.id,
            expectedFlowVersion: staleExecutionVersion,
            updates: [{ itemId: 'stage9-stale-item', name: 'STAGE9-STale' }]
          }
        },
        {
          endpoint: '/api/production/operation/comment',
          expected: { cardId: execution.card.id, flowVersion: execution.flowVersion, staleFlowVersion: staleExecutionVersion },
          data: {
            cardId: execution.card.id,
            opId: execution.op.id,
            expectedFlowVersion: staleExecutionVersion,
            source: 'contract-test',
            text: 'stale comment'
          }
        },
        {
          endpoint: '/api/production/operation/material-issue',
          expected: { cardId: execution.card.id, flowVersion: execution.flowVersion, staleFlowVersion: staleExecutionVersion },
          data: {
            cardId: execution.card.id,
            opId: execution.op.id,
            expectedFlowVersion: staleExecutionVersion,
            source: 'contract-test'
          }
        },
        {
          endpoint: '/api/production/operation/material-return',
          expected: { cardId: execution.card.id, flowVersion: execution.flowVersion, staleFlowVersion: staleExecutionVersion },
          data: {
            cardId: execution.card.id,
            opId: execution.op.id,
            expectedFlowVersion: staleExecutionVersion,
            source: 'contract-test'
          }
        },
        {
          endpoint: '/api/production/operation/drying-finish',
          expected: { cardId: drying.card.id, flowVersion: drying.flowVersion, staleFlowVersion: staleDryingVersion },
          data: {
            cardId: drying.card.id,
            opId: drying.op.id,
            expectedFlowVersion: staleDryingVersion,
            source: 'contract-test',
            rowId: 'stale-row'
          }
        },
        {
          endpoint: '/api/production/operation/drying-complete',
          expected: { cardId: drying.card.id, flowVersion: drying.flowVersion, staleFlowVersion: staleDryingVersion },
          data: {
            cardId: drying.card.id,
            opId: drying.op.id,
            expectedFlowVersion: staleDryingVersion,
            source: 'contract-test'
          }
        },
        {
          endpoint: '/api/production/flow/repair/check',
          expected: { cardId: defect.card.id, flowVersion: defect.flowVersion, staleFlowVersion: staleDefectVersion },
          data: {
            cardId: defect.card.id,
            opId: defect.op.id,
            itemId: defect.item.id,
            kind: defect.kind,
            expectedFlowVersion: staleDefectVersion
          }
        }
      ];

      for (const command of directCommands) {
        await expectFlowConflict(await api.post(command.endpoint, {
          headers: { 'x-csrf-token': csrfToken },
          data: command.data
        }), command.expected);
      }

      await expectFlowConflict(await api.post('/api/production/operation/drying-start', {
        headers: { 'x-csrf-token': csrfToken },
        data: {
          cardId: drying.card.id,
          opId: drying.op.id,
          expectedFlowVersion: staleDryingVersion,
          source: 'contract-test',
          rowId: 'stale-row',
          dryQty: '1'
        }
      }), {
        cardId: drying.card.id,
        flowVersion: drying.flowVersion,
        staleFlowVersion: staleDryingVersion
      });

      await expectFlowConflict(await api.post('/api/production/flow/return', {
        headers: { 'x-csrf-token': csrfToken },
        data: {
          cardId: delayed.card.id,
          opId: delayed.op.id,
          itemId: delayed.item.id,
          kind: delayed.kind,
          expectedFlowVersion: staleDelayedVersion,
          techSpecFile: tinyFile
        }
      }), {
        cardId: delayed.card.id,
        flowVersion: delayed.flowVersion,
        staleFlowVersion: staleDelayedVersion
      });

      await expectFlowConflict(await api.post('/api/production/flow/defect', {
        headers: { 'x-csrf-token': csrfToken },
        data: {
          cardId: delayed.card.id,
          opId: delayed.op.id,
          itemId: delayed.item.id,
          kind: delayed.kind,
          expectedFlowVersion: staleDelayedVersion
        }
      }), {
        cardId: delayed.card.id,
        flowVersion: delayed.flowVersion,
        staleFlowVersion: staleDelayedVersion
      });

      for (const endpoint of ['/api/production/flow/repair/options', '/api/production/flow/repair', '/api/production/flow/dispose']) {
        const data = {
          cardId: defect.card.id,
          opId: defect.op.id,
          itemId: defect.item.id,
          kind: defect.kind,
          expectedFlowVersion: staleDefectVersion
        };
        if (endpoint === '/api/production/flow/repair') {
          data.action = 'create_new';
          data.trpnFile = tinyFile;
        }
        if (endpoint === '/api/production/flow/dispose') {
          data.trpnFile = tinyFile;
        }
        await expectFlowConflict(await api.post(endpoint, {
          headers: { 'x-csrf-token': csrfToken },
          data
        }), {
          cardId: defect.card.id,
          flowVersion: defect.flowVersion,
          staleFlowVersion: staleDefectVersion
        });
      }
    } finally {
      await api.dispose();
    }
  });

  test('keeps execution conflict refresh route-safe on workspace, delayed and defects routes', async ({ page }) => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
    const diagnostics = attachDiagnostics(page);

    await loginAsAbyss(page);
    const data = await page.evaluate(async () => {
      const response = await fetch('/api/data');
      return response.json();
    });
    const workspace = findExecutionCandidate(data);
    const delayed = findFlowIssueCandidate(data, 'DELAYED');
    const defect = findFlowIssueCandidate(data, 'DEFECT');
    const routes = [
      { path: '/workspace', card: workspace.card, flowVersion: workspace.flowVersion },
      { path: `/workspace/${encodeURIComponent(workspace.card.qrId)}`, card: workspace.card, flowVersion: workspace.flowVersion },
      { path: '/production/delayed', card: delayed.card, flowVersion: delayed.flowVersion },
      { path: `/production/delayed/${encodeURIComponent(delayed.card.qrId)}`, card: delayed.card, flowVersion: delayed.flowVersion },
      { path: '/production/defects', card: defect.card, flowVersion: defect.flowVersion },
      { path: `/production/defects/${encodeURIComponent(defect.card.qrId)}`, card: defect.card, flowVersion: defect.flowVersion }
    ].filter(route => route.card?.qrId || !/\/[^/]+$/.test(route.path.replace(/^\/production\/(?:delayed|defects)/, '')));

    for (const route of routes) {
      await openRouteAndAssert(page, route.path);
      resetDiagnostics(diagnostics);
      const staleFlowVersion = route.flowVersion === 0 ? route.flowVersion + 1 : route.flowVersion - 1;
      const result = await page.evaluate(async ({ cardId, flowVersion, staleFlowVersion }) => {
        const writeResult = await runProductionExecutionWriteRequest({
          action: 'stage9-route-safe-conflict',
          writePath: '/api/production/operation/start',
          cardId,
          expectedFlowVersion: staleFlowVersion,
          defaultConflictMessage: 'Данные производства уже изменились.',
          request: () => Promise.resolve(new Response(JSON.stringify({
            code: 'STALE_REVISION',
            entity: 'card.flow',
            id: cardId,
            expectedRev: staleFlowVersion,
            actualRev: flowVersion,
            flowVersion,
            message: 'Версия flow устарела',
            error: 'Версия flow устарела'
          }), {
            status: 409,
            headers: { 'Content-Type': 'application/json' }
          }))
        });
        return {
          ok: Boolean(writeResult?.ok),
          isConflict: Boolean(writeResult?.isConflict),
          message: String(writeResult?.message || '')
        };
      }, {
        cardId: route.card.id,
        flowVersion: route.flowVersion,
        staleFlowVersion
      });
      expect(result.ok).toBe(false);
      expect(result.isConflict).toBe(true);
      await expect.poll(() => new URL(page.url()).pathname).toBe(route.path);
      expect(findConsoleEntries(diagnostics, /^\[CONFLICT\] production execution refresh start/i).length).toBeGreaterThan(0);
      expect(findConsoleEntries(diagnostics, /route-safe re-render/i).length).toBeGreaterThan(0);
      expectNoCriticalClientFailures(diagnostics, {
        allow409: true,
        ignoreConsolePatterns: [/^\[LIVE\]/i, /^\[CONFLICT\]/i]
      });
    }
  });
});
