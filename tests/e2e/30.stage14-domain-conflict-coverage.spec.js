const { test, expect, request: playwrightRequest } = require('@playwright/test');
const { seedSqlFixture } = require('./helpers/sqlSeed');
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

function expectCardConflictEnvelope(body, { cardId, expectedRev, actualRev }) {
  expect(body.code).toBe('STALE_REVISION');
  expect(body.entity).toBe('card');
  expect(body.id).toBe(cardId);
  expect(body.expectedRev).toBe(expectedRev);
  expect(body.actualRev).toBe(actualRev);
  expect(String(body.message || body.error || '')).toMatch(/версия карточки устарела/i);
}

function expectPlanningConflictEnvelope(body, { expectedRev, actualRev }) {
  expect(body.code).toBe('STALE_REVISION');
  expect(body.entity).toBe('production.schedule');
  expect(body.expectedRev).toBe(expectedRev);
  expect(body.actualRev).toBe(actualRev);
  expect(body.refresh.scope).toBe('production');
  expect(body.refresh.route).toBe('/production/schedule');
}

function buildSecurityPermissions() {
  return {
    tabs: {
      dashboard: { view: true, edit: false },
      accessLevels: { view: true, edit: true }
    },
    landingTab: 'dashboard',
    inactivityTimeoutMinutes: 21,
    worker: false,
    headProduction: false,
    headSKK: false,
    skkWorker: false,
    labWorker: false,
    warehouseWorker: false,
    deputyTechDirector: false
  };
}

async function createDraftCard(api, csrfToken, name) {
  const response = await api.post('/api/cards-core', {
    headers: { 'x-csrf-token': csrfToken },
    data: {
      name,
      desc: 'Stage 14 domain conflict coverage',
      cardType: 'MKI',
      quantity: 1,
      material: 'Сталь 40Х'
    }
  });
  expect(response.status()).toBe(201);
  const body = await response.json();
  expect(body.card?.id).toBeTruthy();
  return body.card;
}

async function updateCard(api, csrfToken, card, name) {
  const response = await api.put(`/api/cards-core/${encodeURIComponent(card.id)}`, {
    headers: { 'x-csrf-token': csrfToken },
    data: {
      id: card.id,
      expectedRev: card.rev,
      name
    }
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.card?.id).toBe(card.id);
  expect(body.card.rev).toBeGreaterThan(card.rev);
  return body.card;
}

test.describe('Stage 14 domain and conflict coverage completion', () => {
  test.beforeEach(async () => {
    seedSqlFixture('baseline-with-production-fixtures');
    await restartServer();
  });

  test.afterAll(async () => {
    await stopServer();
  });

  test('cards archive, delete and repeat reject stale expectedRev without falling back to snapshot writes', async ({}, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const { api, csrfToken } = await loginApi(baseURL);

    try {
      const archiveInitial = await createDraftCard(api, csrfToken, `Stage14 archive stale ${Date.now()}`);
      const archiveFresh = await updateCard(api, csrfToken, archiveInitial, `Stage14 archive fresh ${Date.now()}`);

      const staleArchiveResponse = await api.post(`/api/cards-core/${encodeURIComponent(archiveInitial.id)}/archive`, {
        headers: { 'x-csrf-token': csrfToken },
        data: { expectedRev: archiveInitial.rev }
      });
      expect(staleArchiveResponse.status()).toBe(409);
      expectCardConflictEnvelope(await staleArchiveResponse.json(), {
        cardId: archiveInitial.id,
        expectedRev: archiveInitial.rev,
        actualRev: archiveFresh.rev
      });

      const archiveResponse = await api.post(`/api/cards-core/${encodeURIComponent(archiveInitial.id)}/archive`, {
        headers: { 'x-csrf-token': csrfToken },
        data: { expectedRev: archiveFresh.rev }
      });
      expect(archiveResponse.ok()).toBeTruthy();
      const archiveBody = await archiveResponse.json();
      expect(archiveBody.card.archived).toBe(true);
      expect(archiveBody.card.rev).toBeGreaterThan(archiveFresh.rev);

      const repeatResponse = await api.post(`/api/cards-core/${encodeURIComponent(archiveInitial.id)}/repeat`, {
        headers: { 'x-csrf-token': csrfToken },
        data: { expectedRev: archiveBody.card.rev }
      });
      expect(repeatResponse.status()).toBe(201);
      const repeatBody = await repeatResponse.json();
      expect(repeatBody.card.approvalStage).toBe('DRAFT');
      expect(repeatBody.card.archived).toBeFalsy();

      const staleRepeatResponse = await api.post(`/api/cards-core/${encodeURIComponent(archiveInitial.id)}/repeat`, {
        headers: { 'x-csrf-token': csrfToken },
        data: { expectedRev: archiveBody.card.rev }
      });
      expect(staleRepeatResponse.status()).toBe(409);
      const staleRepeatBody = await staleRepeatResponse.json();
      expectCardConflictEnvelope(staleRepeatBody, {
        cardId: archiveInitial.id,
        expectedRev: archiveBody.card.rev,
        actualRev: staleRepeatBody.actualRev
      });
      expect(staleRepeatBody.actualRev).toBeGreaterThan(archiveBody.card.rev);

      const deleteInitial = await createDraftCard(api, csrfToken, `Stage14 delete stale ${Date.now()}`);
      const deleteFresh = await updateCard(api, csrfToken, deleteInitial, `Stage14 delete fresh ${Date.now()}`);
      const staleDeleteResponse = await api.delete(`/api/cards-core/${encodeURIComponent(deleteInitial.id)}`, {
        headers: {
          'x-csrf-token': csrfToken,
          'Content-Type': 'application/json'
        },
        data: { expectedRev: deleteInitial.rev }
      });
      expect(staleDeleteResponse.status()).toBe(409);
      expectCardConflictEnvelope(await staleDeleteResponse.json(), {
        cardId: deleteInitial.id,
        expectedRev: deleteInitial.rev,
        actualRev: deleteFresh.rev
      });

      const deleteResponse = await api.delete(`/api/cards-core/${encodeURIComponent(deleteInitial.id)}`, {
        headers: {
          'x-csrf-token': csrfToken,
          'Content-Type': 'application/json'
        },
        data: { expectedRev: deleteFresh.rev }
      });
      expect(deleteResponse.ok()).toBeTruthy();
      const deleteBody = await deleteResponse.json();
      expect(deleteBody.deletedId).toBe(deleteInitial.id);

      const afterDataResponse = await api.get('/api/data');
      expect(afterDataResponse.ok()).toBeTruthy();
      const afterData = await afterDataResponse.json();
      expect((afterData.cards || []).some(card => card?.id === deleteInitial.id)).toBe(false);
    } finally {
      await api.dispose();
    }
  });

  test('planning expectedRev survives unrelated security writes and conflicts after real planning mutation', async ({}, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const { api, csrfToken } = await loginApi(baseURL);
    const suffix = String(Date.now()).slice(-6);

    try {
      const sliceResponse = await api.get('/api/production/planning/slice?slice=schedule');
      expect(sliceResponse.ok()).toBeTruthy();
      const sliceBody = await sliceResponse.json();
      const expectedRev = Number(sliceBody.revision.rev);
      expect(Number.isFinite(expectedRev)).toBe(true);
      const area = (sliceBody.areas || []).find(item => item?.id);
      const employee = (sliceBody.users || []).find(item => item?.id && item.login !== 'Abyss');
      expect(area?.id).toBeTruthy();
      expect(employee?.id).toBeTruthy();

      const securityResponse = await api.post('/api/security/access-levels', {
        headers: { 'x-csrf-token': csrfToken },
        data: {
          name: `Stage14 unrelated level ${suffix}`,
          description: 'unrelated write must not stale planning',
          permissions: buildSecurityPermissions()
        }
      });
      expect(securityResponse.ok()).toBeTruthy();

      const afterSecuritySliceResponse = await api.get('/api/production/planning/slice?slice=schedule');
      expect(afterSecuritySliceResponse.ok()).toBeTruthy();
      const afterSecuritySlice = await afterSecuritySliceResponse.json();
      expect(Number(afterSecuritySlice.revision.rev)).toBe(expectedRev);

      const firstPlanningWrite = await api.post('/api/production/planning/schedule/assignments/commit', {
        headers: { 'x-csrf-token': csrfToken },
        data: {
          action: 'add',
          expectedRev,
          routePath: '/production/schedule',
          assignments: [{
            date: '2099-05-14',
            shift: 1,
            areaId: area.id,
            employeeId: employee.id,
            timeFrom: null,
            timeTo: null
          }]
        }
      });
      expect(firstPlanningWrite.ok()).toBeTruthy();
      const firstPlanningBody = await firstPlanningWrite.json();
      const bumpedRev = Number(firstPlanningBody.revision.rev);
      expect(bumpedRev).toBe(expectedRev + 1);

      const stalePlanningWrite = await api.post('/api/production/planning/schedule/assignments/commit', {
        headers: { 'x-csrf-token': csrfToken },
        data: {
          action: 'add',
          expectedRev,
          routePath: '/production/schedule',
          assignments: [{
            date: '2099-05-15',
            shift: 1,
            areaId: area.id,
            employeeId: employee.id,
            timeFrom: null,
            timeTo: null
          }]
        }
      });
      expect(stalePlanningWrite.status()).toBe(409);
      expectPlanningConflictEnvelope(await stalePlanningWrite.json(), {
        expectedRev,
        actualRev: bumpedRev
      });
    } finally {
      await api.dispose();
    }
  });
});
