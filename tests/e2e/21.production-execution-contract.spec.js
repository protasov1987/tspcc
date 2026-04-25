const { test, expect, request: playwrightRequest } = require('@playwright/test');
const { resetDatabaseFromSnapshot } = require('./helpers/snapshot');
const { restartServer, stopServer } = require('./helpers/server');

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

function findProductionPlanCandidate(sliceBody) {
  const area = (sliceBody.areas || []).find(item => item && item.id);
  const employee = (sliceBody.users || []).find(item => item && item.id && item.login !== 'Abyss');
  expect(area?.id).toBeTruthy();
  expect(employee?.id).toBeTruthy();
  return { area, employee };
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
});
