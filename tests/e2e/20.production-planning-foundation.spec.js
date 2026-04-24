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

test.describe('production planning foundation api', () => {
  test.beforeAll(async () => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
  });

  test.afterAll(async () => {
    await stopServer();
  });

  test('returns targeted schedule slice with route-safe refresh metadata', async ({}, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const { api } = await loginApi(baseURL);

    try {
      const response = await api.get('/api/production/planning/slice?slice=schedule');
      expect(response.ok()).toBeTruthy();
      const body = await response.json();

      expect(body.domain).toBe('production-planning');
      expect(body.slice).toBe('schedule');
      expect(body.revision.entity).toBe('production.schedule');
      expect(Number.isFinite(Number(body.revision.rev))).toBeTruthy();
      expect(body.refresh.scope).toBe('production');
      expect(body.refresh.route).toBe('/production/schedule');
      expect(Array.isArray(body.productionSchedule)).toBeTruthy();
      expect(Array.isArray(body.productionShiftTimes)).toBeTruthy();
      expect(Array.isArray(body.areas)).toBeTruthy();
      expect(Array.isArray(body.users)).toBeTruthy();
      expect(body.cards).toBeUndefined();
    } finally {
      await api.dispose();
    }
  });

  test('prepares schedule assignment command responses without snapshot writes', async ({}, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const { api, csrfToken } = await loginApi(baseURL);

    try {
      const sliceResponse = await api.get('/api/production/planning/slice?slice=schedule');
      const sliceBody = await sliceResponse.json();
      const expectedRev = sliceBody.revision.rev;

      const response = await api.post('/api/production/planning/schedule/assignments/prepare', {
        headers: {
          'x-csrf-token': csrfToken
        },
        data: {
          action: 'add',
          expectedRev
        }
      });
      expect(response.ok()).toBeTruthy();
      const body = await response.json();

      expect(body.ok).toBe(true);
      expect(body.prepared).toBe(true);
      expect(body.command).toBe('production.schedule.assignment.prepare');
      expect(body.slice).toBe('schedule');
      expect(body.refresh.route).toBe('/production/schedule');
      expect(body.supportedActions).toContain('add');
      expect(Array.isArray(body.productionSchedule)).toBeTruthy();
      expect(Array.isArray(body.productionShiftTimes)).toBeTruthy();
    } finally {
      await api.dispose();
    }
  });

  test('commits schedule assignment writes through targeted planning api', async ({}, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const { api, csrfToken } = await loginApi(baseURL);

    try {
      const sliceResponse = await api.get('/api/production/planning/slice?slice=schedule');
      const sliceBody = await sliceResponse.json();
      const area = (sliceBody.areas || []).find(item => item && item.id);
      const employee = (sliceBody.users || []).find(item => item && item.id && item.login !== 'Abyss');
      expect(area?.id).toBeTruthy();
      expect(employee?.id).toBeTruthy();

      const response = await api.post('/api/production/planning/schedule/assignments/commit', {
        headers: {
          'x-csrf-token': csrfToken
        },
        data: {
          action: 'add',
          expectedRev: sliceBody.revision.rev,
          assignments: [{
            date: '2099-01-05',
            shift: 1,
            areaId: area.id,
            employeeId: employee.id,
            timeFrom: null,
            timeTo: null
          }]
        }
      });
      expect(response.ok()).toBeTruthy();
      const body = await response.json();

      expect(body.ok).toBe(true);
      expect(body.command).toBe('production.schedule.assignment.commit');
      expect(body.slice).toBe('schedule');
      expect(body.refresh.route).toBe('/production/schedule');
      expect(Array.isArray(body.productionSchedule)).toBeTruthy();
      expect(body.productionSchedule.some(item => (
        item.date === '2099-01-05'
        && item.shift === 1
        && item.areaId === area.id
        && item.employeeId === employee.id
      ))).toBeTruthy();
      expect(body.affectedCells).toEqual(expect.arrayContaining([
        expect.objectContaining({ date: '2099-01-05', shift: 1, areaId: area.id })
      ]));
    } finally {
      await api.dispose();
    }
  });

  test('returns reusable planning conflict and validation envelopes', async ({}, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const { api, csrfToken } = await loginApi(baseURL);

    try {
      const staleResponse = await api.post('/api/production/planning/shifts/lifecycle/prepare', {
        headers: {
          'x-csrf-token': csrfToken
        },
        data: {
          action: 'open',
          expectedRev: -1
        }
      });
      expect(staleResponse.status()).toBe(409);
      const staleBody = await staleResponse.json();
      expect(staleBody.code).toBe('STALE_REVISION');
      expect(staleBody.entity).toBe('production.shifts');
      expect(staleBody.expectedRev).toBe(-1);
      expect(Number.isFinite(Number(staleBody.actualRev))).toBeTruthy();
      expect(staleBody.refresh.scope).toBe('production');
      expect(staleBody.refresh.route).toBe('/production/shifts');
      expect(Array.isArray(staleBody.productionShiftTasks)).toBeTruthy();
      expect(Array.isArray(staleBody.productionShifts)).toBeTruthy();

      const sliceResponse = await api.get('/api/production/planning/slice?slice=shift-close');
      const sliceBody = await sliceResponse.json();
      const validationResponse = await api.post('/api/production/planning/shift-close/finalize/prepare', {
        headers: {
          'x-csrf-token': csrfToken
        },
        data: {
          action: 'unexpected',
          expectedRev: sliceBody.revision.rev
        }
      });
      expect(validationResponse.status()).toBe(400);
      const validationBody = await validationResponse.json();
      expect(validationBody.ok).toBe(false);
      expect(validationBody.code).toBe('PLANNING_VALIDATION_ERROR');
      expect(validationBody.command).toBe('production.shift-close.finalize.prepare');
      expect(validationBody.slice).toBe('shift-close');
      expect(validationBody.validation.ok).toBe(false);
      expect(validationBody.validation.details.supportedActions).toContain('finalize');
      expect(Array.isArray(validationBody.productionShiftTasks)).toBeTruthy();
    } finally {
      await api.dispose();
    }
  });

  test('keeps existing production plan endpoint validation paths available', async ({}, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const { api, csrfToken } = await loginApi(baseURL);

    try {
      const commitResponse = await api.post('/api/production/plan/commit', {
        headers: {
          'x-csrf-token': csrfToken
        },
        data: {
          action: 'unexpected'
        }
      });
      expect(commitResponse.status()).toBe(400);
      const commitBody = await commitResponse.json();
      expect(String(commitBody.error || '')).toMatch(/действие планирования/i);
      expect(commitBody.command).toBe('production.plan.commit');
      expect(commitBody.slice).toBe('plan');
      expect(commitBody.validation.ok).toBe(false);

      const autoResponse = await api.post('/api/production/plan/auto', {
        headers: {
          'x-csrf-token': csrfToken
        },
        data: {
          dryRun: true,
          cardId: '__missing_card__'
        }
      });
      expect(autoResponse.status()).toBe(400);
      const autoBody = await autoResponse.json();
      expect(String(autoBody.error || '')).toMatch(/маршрутная карта не найдена/i);
    } finally {
      await api.dispose();
    }
  });
});
