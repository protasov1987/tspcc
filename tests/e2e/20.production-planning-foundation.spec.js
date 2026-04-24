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

function expectPlanningConflictEnvelope(body, { entity, route }) {
  expect(body.code).toBe('STALE_REVISION');
  expect(body.entity).toBe(entity);
  expect(Number.isFinite(Number(body.expectedRev))).toBeTruthy();
  expect(Number.isFinite(Number(body.actualRev))).toBeTruthy();
  expect(body.refresh.scope).toBe('production');
  expect(body.refresh.route).toBe(route);
}

function findProductionPlanCandidate(sliceBody) {
  const area = (sliceBody.areas || []).find(item => (
    item
    && item.id
    && !String(item.name || item.title || '').toLowerCase().includes('субпод')
  ));
  const card = (sliceBody.cards || []).find(item => (
    item
    && item.id
    && Array.isArray(item.operations)
    && item.operations.some(op => op && op.id)
  ));
  const op = (card?.operations || []).find(item => item && item.id);
  expect(area?.id).toBeTruthy();
  expect(card?.id).toBeTruthy();
  expect(op?.id).toBeTruthy();
  return { area, card, op };
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

  test('persists personal production area layout on the server', async ({}, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const { api, csrfToken } = await loginApi(baseURL);

    try {
      const sliceResponse = await api.get('/api/production/planning/slice?slice=schedule');
      expect(sliceResponse.ok()).toBeTruthy();
      const sliceBody = await sliceResponse.json();
      const areaIds = (sliceBody.areas || []).map(item => item?.id).filter(Boolean).slice(0, 2);
      expect(areaIds.length).toBeGreaterThanOrEqual(2);

      const hiddenAreaIds = [areaIds[0], '__shift_master__'];
      const layout = {
        order: [areaIds[1], areaIds[0]],
        hiddenAreaIds
      };
      const saveResponse = await api.put('/api/production/planning/areas-layout', {
        headers: {
          'x-csrf-token': csrfToken
        },
        data: { layout }
      });
      expect(saveResponse.ok()).toBeTruthy();
      const saveBody = await saveResponse.json();
      expect(saveBody.layout.order).toEqual(layout.order);
      expect(saveBody.layout.hiddenAreaIds).toEqual(hiddenAreaIds);

      const readResponse = await api.get('/api/production/planning/areas-layout');
      expect(readResponse.ok()).toBeTruthy();
      const readBody = await readResponse.json();
      expect(readBody.layout.order).toEqual(layout.order);
      expect(readBody.layout.hiddenAreaIds).toEqual(hiddenAreaIds);

      const sessionResponse = await api.get('/api/session');
      expect(sessionResponse.ok()).toBeTruthy();
      const sessionBody = await sessionResponse.json();
      expect(sessionBody.user.productionSettings).toBeUndefined();
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

  test('commits shift lifecycle writes through targeted planning api', async ({}, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const { api, csrfToken } = await loginApi(baseURL);

    try {
      const date = '2099-02-10';
      const shift = 1;
      const sliceResponse = await api.get('/api/production/planning/slice?slice=shifts');
      const sliceBody = await sliceResponse.json();

      const openResponse = await api.post('/api/production/planning/shifts/lifecycle/commit', {
        headers: { 'x-csrf-token': csrfToken },
        data: {
          action: 'open',
          date,
          shift,
          expectedRev: sliceBody.revision.rev
        }
      });
      expect(openResponse.status()).toBe(400);
      const openBody = await openResponse.json();
      expect(openBody.command).toBe('production.shift.lifecycle.commit');
      expect(openBody.slice).toBe('shifts');
      expect(openBody.refresh.route).toBe('/production/shifts');
      expect(String(openBody.error || '')).toMatch(/больше двух смен/i);

      const fixResponse = await api.post('/api/production/planning/shifts/lifecycle/commit', {
        headers: { 'x-csrf-token': csrfToken },
        data: {
          action: 'fix',
          date: '2026-03-10',
          shift: 2,
          expectedRev: openBody.revision.rev
        }
      });
      expect(fixResponse.ok()).toBeTruthy();
      const fixBody = await fixResponse.json();
      expect(fixBody.shiftRecord.isFixed).toBe(true);
      expect(Array.isArray(fixBody.productionShifts)).toBeTruthy();
    } finally {
      await api.dispose();
    }
  });

  test('commits shift-close draft and finalize writes through targeted planning api', async ({}, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const { api, csrfToken } = await loginApi(baseURL);

    try {
      const date = '2026-04-15';
      const shift = 1;
      const sliceResponse = await api.get('/api/production/planning/slice?slice=shift-close');
      const sliceBody = await sliceResponse.json();
      const area = (sliceBody.areas || []).find(item => item && item.id);
      expect(area?.id).toBeTruthy();

      const row = {
        key: `${date}|${shift}|${area.id}|card_shift_close_test|op_shift_close_test||`,
        taskId: '',
        cardId: 'card_shift_close_test',
        routeOpId: 'op_shift_close_test',
        opId: 'op_shift_close_test',
        opName: 'Тестовая операция',
        date,
        shift,
        areaId: area.id,
        remainingQty: 1,
        remainingMinutes: 30,
        completedQty: 0,
        minutesPerUnit: 30,
        canResolveRemaining: true,
        isQtyDriven: true
      };

      const transferResponse = await api.post('/api/production/planning/shift-close/draft/commit', {
        headers: { 'x-csrf-token': csrfToken },
        data: {
          action: 'set-row-action',
          actionType: 'TRANSFER',
          date,
          shift,
          row,
          rowKey: row.key,
          targetDate: '2099-02-12',
          targetShift: 1,
          targetAreaId: area.id,
          expectedRev: sliceBody.revision.rev
        }
      });
      expect(transferResponse.ok()).toBeTruthy();
      const transferBody = await transferResponse.json();
      expect(transferBody.command).toBe('production.shift-close.draft.commit');
      expect(transferBody.slice).toBe('shift-close');
      expect(transferBody.shiftRecord.closePageDraft.rows[row.key].action).toBe('TRANSFER');
      expect((transferBody.productionShiftTasks || []).some(task => task.closePagePreview === true)).toBeTruthy();

      const clearResponse = await api.post('/api/production/planning/shift-close/draft/commit', {
        headers: { 'x-csrf-token': csrfToken },
        data: {
          action: 'clear-row-action',
          date,
          shift,
          row,
          rowKey: row.key,
          expectedRev: transferBody.revision.rev
        }
      });
      expect(clearResponse.ok()).toBeTruthy();
      const clearBody = await clearResponse.json();
      expect(clearBody.shiftRecord.closePageDraft.rows[row.key]).toBeUndefined();
      expect((clearBody.productionShiftTasks || []).some(task => task.closePagePreview === true)).toBeFalsy();

      const finalizeResponse = await api.post('/api/production/planning/shift-close/finalize/commit', {
        headers: { 'x-csrf-token': csrfToken },
        data: {
          action: 'finalize',
          date,
          shift,
          routeKey: `${date}s${shift}`,
          rows: [{
            ...row,
            status: 'IN_PROGRESS',
            canResolveRemaining: false,
            remainingQty: 0
          }],
          draftRows: {},
          operationFacts: {},
          shiftMasterNames: [],
          summary: {
            plannedOps: 0,
            completedOps: 0,
            goodQty: 0,
            delayedQty: 0,
            defectQty: 0,
            averageAreaFactSeconds: 0
          },
          expectedRev: clearBody.revision.rev
        }
      });
      expect(finalizeResponse.status()).toBe(400);
      const finalizeBody = await finalizeResponse.json();
      expect(finalizeBody.command).toBe('production.shift-close.finalize.commit');
      expect(String(finalizeBody.error || '')).toMatch(/операции в работе/i);
      expect(finalizeBody.refresh.route).toBe(`/production/shifts/${date.replace(/-/g, '')}s${shift}`);
    } finally {
      await api.dispose();
    }
  });

  test('handles real multi-client planning conflicts with route-local refresh metadata', async ({}, testInfo) => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
    const baseURL = testInfo.project.use.baseURL;
    const sessionA = await loginApi(baseURL);
    const sessionB = await loginApi(baseURL);

    try {
      const scheduleA = await (await sessionA.api.get('/api/production/planning/slice?slice=schedule')).json();
      const scheduleB = await (await sessionB.api.get('/api/production/planning/slice?slice=schedule')).json();
      const area = (scheduleA.areas || []).find(item => item && item.id);
      const employee = (scheduleA.users || []).find(item => item && item.id && item.login !== 'Abyss');
      expect(area?.id).toBeTruthy();
      expect(employee?.id).toBeTruthy();

      const firstScheduleWrite = await sessionA.api.post('/api/production/planning/schedule/assignments/commit', {
        headers: { 'x-csrf-token': sessionA.csrfToken },
        data: {
          action: 'add',
          expectedRev: scheduleA.revision.rev,
          routePath: '/production/schedule',
          assignments: [{
            date: '2099-04-01',
            shift: 1,
            areaId: area.id,
            employeeId: employee.id,
            timeFrom: null,
            timeTo: null
          }]
        }
      });
      expect(firstScheduleWrite.ok()).toBeTruthy();
      const staleScheduleWrite = await sessionB.api.post('/api/production/planning/schedule/assignments/commit', {
        headers: { 'x-csrf-token': sessionB.csrfToken },
        data: {
          action: 'add',
          expectedRev: scheduleB.revision.rev,
          routePath: '/production/schedule',
          assignments: [{
            date: '2099-04-02',
            shift: 1,
            areaId: area.id,
            employeeId: employee.id,
            timeFrom: null,
            timeTo: null
          }]
        }
      });
      expect(staleScheduleWrite.status()).toBe(409);
      expectPlanningConflictEnvelope(await staleScheduleWrite.json(), {
        entity: 'production.schedule',
        route: '/production/schedule'
      });

      const planA = await (await sessionA.api.get('/api/production/planning/slice?slice=plan')).json();
      const planB = await (await sessionB.api.get('/api/production/planning/slice?slice=plan')).json();
      const { card, op, area: planArea } = findProductionPlanCandidate(planA);
      const ganttRoute = `/production/gantt/${encodeURIComponent(card.id)}`;
      const firstPlanWrite = await sessionA.api.post('/api/production/plan/commit', {
        headers: { 'x-csrf-token': sessionA.csrfToken },
        data: {
          action: 'add',
          cardId: card.id,
          routeOpId: op.id,
          date: '2099-04-03',
          shift: 1,
          areaId: planArea.id,
          plannedPartMinutes: Number(op.plannedMinutes) > 0 ? Number(op.plannedMinutes) : 30,
          expectedRev: planA.revision.rev,
          routePath: ganttRoute
        }
      });
      expect(firstPlanWrite.ok()).toBeTruthy();
      expect((await firstPlanWrite.json()).refresh.route).toBe(ganttRoute);
      const stalePlanWrite = await sessionB.api.post('/api/production/plan/commit', {
        headers: { 'x-csrf-token': sessionB.csrfToken },
        data: {
          action: 'add',
          cardId: card.id,
          routeOpId: op.id,
          date: '2099-04-04',
          shift: 1,
          areaId: planArea.id,
          plannedPartMinutes: Number(op.plannedMinutes) > 0 ? Number(op.plannedMinutes) : 30,
          expectedRev: planB.revision.rev,
          routePath: ganttRoute
        }
      });
      expect(stalePlanWrite.status()).toBe(409);
      expectPlanningConflictEnvelope(await stalePlanWrite.json(), {
        entity: 'production.plan',
        route: ganttRoute
      });

      const shiftsA = await (await sessionA.api.get('/api/production/planning/slice?slice=shifts')).json();
      const shiftsB = await (await sessionB.api.get('/api/production/planning/slice?slice=shifts')).json();
      const firstShiftWrite = await sessionA.api.post('/api/production/planning/shifts/lifecycle/commit', {
        headers: { 'x-csrf-token': sessionA.csrfToken },
        data: {
          action: 'fix',
          date: '2026-03-10',
          shift: 2,
          expectedRev: shiftsA.revision.rev,
          routePath: '/production/shifts'
        }
      });
      expect(firstShiftWrite.ok()).toBeTruthy();
      const staleShiftWrite = await sessionB.api.post('/api/production/planning/shifts/lifecycle/commit', {
        headers: { 'x-csrf-token': sessionB.csrfToken },
        data: {
          action: 'fix',
          date: '2026-03-10',
          shift: 2,
          expectedRev: shiftsB.revision.rev,
          routePath: '/production/shifts'
        }
      });
      expect(staleShiftWrite.status()).toBe(409);
      expectPlanningConflictEnvelope(await staleShiftWrite.json(), {
        entity: 'production.shifts',
        route: '/production/shifts'
      });

      const closeA = await (await sessionA.api.get('/api/production/planning/slice?slice=shift-close')).json();
      const closeB = await (await sessionB.api.get('/api/production/planning/slice?slice=shift-close')).json();
      const closeDate = '2026-04-15';
      const closeShift = 1;
      const closeRoute = `/production/shifts/${closeDate.replace(/-/g, '')}s${closeShift}`;
      const closeArea = (closeA.areas || []).find(item => item && item.id);
      expect(closeArea?.id).toBeTruthy();
      const row = {
        key: `${closeDate}|${closeShift}|${closeArea.id}|card_shift_close_test|op_shift_close_test||`,
        taskId: '',
        cardId: 'card_shift_close_test',
        routeOpId: 'op_shift_close_test',
        opId: 'op_shift_close_test',
        opName: 'Тестовая операция',
        date: closeDate,
        shift: closeShift,
        areaId: closeArea.id,
        remainingQty: 1,
        remainingMinutes: 30,
        completedQty: 0,
        minutesPerUnit: 30,
        canResolveRemaining: true,
        isQtyDriven: true
      };
      const firstCloseWrite = await sessionA.api.post('/api/production/planning/shift-close/draft/commit', {
        headers: { 'x-csrf-token': sessionA.csrfToken },
        data: {
          action: 'set-row-action',
          actionType: 'REPLAN',
          date: closeDate,
          shift: closeShift,
          row,
          rowKey: row.key,
          expectedRev: closeA.revision.rev,
          routePath: closeRoute
        }
      });
      expect(firstCloseWrite.ok()).toBeTruthy();
      const staleFinalizeWrite = await sessionB.api.post('/api/production/planning/shift-close/finalize/commit', {
        headers: { 'x-csrf-token': sessionB.csrfToken },
        data: {
          action: 'finalize',
          date: closeDate,
          shift: closeShift,
          routeKey: `${closeDate}s${closeShift}`,
          rows: [],
          draftRows: {},
          operationFacts: {},
          shiftMasterNames: [],
          summary: {
            plannedOps: 0,
            completedOps: 0,
            goodQty: 0,
            delayedQty: 0,
            defectQty: 0,
            averageAreaFactSeconds: 0
          },
          expectedRev: closeB.revision.rev,
          routePath: closeRoute
        }
      });
      expect(staleFinalizeWrite.status()).toBe(409);
      expectPlanningConflictEnvelope(await staleFinalizeWrite.json(), {
        entity: 'production.shift-close',
        route: closeRoute
      });
    } finally {
      await sessionA.api.dispose();
      await sessionB.api.dispose();
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

      const planSliceResponse = await api.get('/api/production/planning/slice?slice=plan');
      const planSliceBody = await planSliceResponse.json();
      const autoResponse = await api.post('/api/production/plan/auto', {
        headers: {
          'x-csrf-token': csrfToken
        },
        data: {
          dryRun: true,
          cardId: '__missing_card__',
          expectedRev: planSliceBody.revision.rev
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
