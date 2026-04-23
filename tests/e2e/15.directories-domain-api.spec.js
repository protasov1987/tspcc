const { test, expect } = require('@playwright/test');
const { resetDatabaseFromSnapshot } = require('./helpers/snapshot');
const { restartServer, stopServer } = require('./helpers/server');
const { attachDiagnostics, expectNoCriticalClientFailures } = require('./helpers/diagnostics');
const { loginAsAbyss } = require('./helpers/auth');
const { openRouteAndAssert, waitUsableUi } = require('./helpers/navigation');

const DIRECTORY_RESPONSE_TIMEOUT_MS = 60000;

function trackDirectoryRequests(page) {
  const writes = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!url.includes('/api/directories') && !url.includes('/api/data')) return;
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) return;
    writes.push({
      method: request.method(),
      url
    });
  });
  return writes;
}

function findTableRowByText(page, wrapperSelector, text) {
  return page.locator(`${wrapperSelector} tbody tr:visible`).filter({ hasText: text }).first();
}

async function waitForBackgroundHydration(page) {
  await expect.poll(() => page.evaluate(() => (
    typeof isBackgroundHydrationInFlight === 'function'
      ? isBackgroundHydrationInFlight() === false
      : true
  ))).toBe(true);
}

async function fillInputStable(page, selector, value) {
  const input = page.locator(selector);
  await input.waitFor({ state: 'visible' });
  await expect.poll(async () => {
    await input.fill('');
    await input.fill(value);
    return await input.inputValue();
  }).toBe(value);
}

async function selectOptionStable(page, selector, value) {
  const select = page.locator(selector);
  await select.waitFor({ state: 'visible' });
  await expect.poll(async () => {
    await select.selectOption(value);
    return await select.inputValue();
  }).toBe(value);
}

async function createDepartment(page, name, desc = '') {
  await waitForBackgroundHydration(page);
  await fillInputStable(page, '#departments-name', name);
  await fillInputStable(page, '#departments-desc', desc);
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && response.url().includes('/api/directories/departments')
    && response.status() === 201
  ), { timeout: DIRECTORY_RESPONSE_TIMEOUT_MS });
  await page.click('#departments-submit');
  const response = await responsePromise;
  const body = await response.json();
  await expect(await findTableRowByText(page, '#departments-table-wrapper', name)).toBeVisible();
  return body;
}

async function editDepartment(page, currentName, nextName, nextDesc = '') {
  await waitForBackgroundHydration(page);
  const row = await findTableRowByText(page, '#departments-table-wrapper', currentName);
  await row.locator('button[data-action="edit"]').click();
  await fillInputStable(page, '#departments-name', nextName);
  await fillInputStable(page, '#departments-desc', nextDesc);
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'PUT'
    && response.url().includes('/api/directories/departments/')
    && response.status() === 200
  ), { timeout: DIRECTORY_RESPONSE_TIMEOUT_MS });
  await page.click('#departments-submit');
  await responsePromise;
  await expect(await findTableRowByText(page, '#departments-table-wrapper', nextName)).toBeVisible();
}

async function createArea(page, name, desc = '', type = 'Производство') {
  await waitForBackgroundHydration(page);
  await fillInputStable(page, '#areas-name', name);
  await fillInputStable(page, '#areas-desc', desc);
  await selectOptionStable(page, '#areas-type', type);
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && response.url().includes('/api/directories/areas')
    && response.status() === 201
  ), { timeout: DIRECTORY_RESPONSE_TIMEOUT_MS });
  await page.click('#areas-submit');
  const response = await responsePromise;
  const body = await response.json();
  await expect(await findTableRowByText(page, '#areas-table-wrapper', name)).toBeVisible();
  return body;
}

async function editArea(page, currentName, nextName, nextDesc = '', nextType = 'Качество') {
  await waitForBackgroundHydration(page);
  const row = await findTableRowByText(page, '#areas-table-wrapper', currentName);
  await row.locator('button[data-action="edit"]').click();
  await fillInputStable(page, '#areas-name', nextName);
  await fillInputStable(page, '#areas-desc', nextDesc);
  await selectOptionStable(page, '#areas-type', nextType);
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'PUT'
    && response.url().includes('/api/directories/areas/')
    && response.status() === 200
  ), { timeout: DIRECTORY_RESPONSE_TIMEOUT_MS });
  await page.click('#areas-submit');
  await responsePromise;
  await expect(await findTableRowByText(page, '#areas-table-wrapper', nextName)).toBeVisible();
}

async function createOperation(page, name, desc = '', recTime = '45', type = 'Стандартная') {
  await waitForBackgroundHydration(page);
  await fillInputStable(page, '#operations-name', name);
  await fillInputStable(page, '#operations-desc', desc);
  await fillInputStable(page, '#operations-time', recTime);
  await selectOptionStable(page, '#operations-type', type);
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && response.url().includes('/api/directories/operations')
    && response.status() === 201
  ), { timeout: DIRECTORY_RESPONSE_TIMEOUT_MS });
  await page.click('#operations-submit');
  const response = await responsePromise;
  const body = await response.json();
  await expect(await findTableRowByText(page, '#operations-table-wrapper', name)).toBeVisible();
  return body;
}

async function editOperation(page, currentName, nextName, nextDesc = '', recTime = '55', type = 'Документы') {
  await waitForBackgroundHydration(page);
  const row = await findTableRowByText(page, '#operations-table-wrapper', currentName);
  await row.locator('button[data-action="edit"]').click();
  await fillInputStable(page, '#operations-name', nextName);
  await fillInputStable(page, '#operations-desc', nextDesc);
  await fillInputStable(page, '#operations-time', recTime);
  await selectOptionStable(page, '#operations-type', type);
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'PUT'
    && response.url().includes('/api/directories/operations/')
    && response.status() === 200
  ), { timeout: DIRECTORY_RESPONSE_TIMEOUT_MS });
  await page.click('#operations-submit');
  await responsePromise;
  await expect(await findTableRowByText(page, '#operations-table-wrapper', nextName)).toBeVisible();
}

async function addOperationAreaBinding(page, operationName, areaName) {
  await waitForBackgroundHydration(page);
  const row = await findTableRowByText(page, '#operations-table-wrapper', operationName);
  await row.locator('.op-area-add-toggle').click();
  const picker = row.locator('.op-areas-picker');
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && /\/api\/directories\/operations\/.+\/areas$/.test(response.url())
    && response.status() === 200
  ), { timeout: DIRECTORY_RESPONSE_TIMEOUT_MS });
  await picker.selectOption({ label: areaName });
  await responsePromise;
  await expect(row).toContainText(areaName);
}

async function removeOperationAreaBinding(page, operationName, areaName) {
  await waitForBackgroundHydration(page);
  const row = await findTableRowByText(page, '#operations-table-wrapper', operationName);
  const removeButton = row.locator('.op-area-pill').filter({ hasText: areaName }).locator('.op-area-remove');
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'DELETE'
    && /\/api\/directories\/operations\/.+\/areas\/.+$/.test(response.url())
    && response.status() === 200
  ), { timeout: DIRECTORY_RESPONSE_TIMEOUT_MS });
  page.once('dialog', async (dialog) => dialog.accept());
  await removeButton.click();
  await responsePromise;
  await expect(row.locator('.op-area-pill').filter({ hasText: areaName })).toHaveCount(0);
}

async function changeAreaTypeInline(page, areaName, nextType = 'Качество') {
  await waitForBackgroundHydration(page);
  const row = await findTableRowByText(page, '#areas-table-wrapper', areaName);
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'PUT'
    && response.url().includes('/api/directories/areas/')
    && response.status() === 200
  ), { timeout: DIRECTORY_RESPONSE_TIMEOUT_MS });
  await row.locator('select.area-type-select').selectOption(nextType);
  await responsePromise;
}

async function deleteDepartment(page, name) {
  await waitForBackgroundHydration(page);
  const row = await findTableRowByText(page, '#departments-table-wrapper', name);
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'DELETE'
    && response.url().includes('/api/directories/departments/')
    && response.status() === 200
  ), { timeout: DIRECTORY_RESPONSE_TIMEOUT_MS });
  page.once('dialog', async (dialog) => dialog.accept());
  await row.locator('button[data-action="delete"]').click();
  await responsePromise;
}

async function deleteOperation(page, name) {
  await waitForBackgroundHydration(page);
  const row = await findTableRowByText(page, '#operations-table-wrapper', name);
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'DELETE'
    && response.url().includes('/api/directories/operations/')
    && response.status() === 200
  ), { timeout: DIRECTORY_RESPONSE_TIMEOUT_MS });
  page.once('dialog', async (dialog) => dialog.accept());
  await row.locator('button[data-action="delete"]').click();
  await responsePromise;
}

async function deleteArea(page, name) {
  await waitForBackgroundHydration(page);
  const row = await findTableRowByText(page, '#areas-table-wrapper', name);
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'DELETE'
    && response.url().includes('/api/directories/areas/')
    && response.status() === 200
  ), { timeout: DIRECTORY_RESPONSE_TIMEOUT_MS });
  page.once('dialog', async (dialog) => dialog.accept());
  await row.locator('button[data-action="delete"]').click();
  await responsePromise;
}

const SHIFT_TIME_VARIANTS = [
  { timeFrom: '06:30', timeTo: '14:30', lunchFrom: '10:00', lunchTo: '10:20' },
  { timeFrom: '07:15', timeTo: '15:15', lunchFrom: '11:00', lunchTo: '11:25' },
  { timeFrom: '08:45', timeTo: '16:45', lunchFrom: '12:30', lunchTo: '12:50' }
];

function buildShiftTimeFieldSelector(shift, type) {
  return `#shift-times-body input[data-shift="${shift}"][data-type="${type}"]`;
}

function serializeShiftTimeValues(entry = {}) {
  return [
    String(entry?.timeFrom || ''),
    String(entry?.timeTo || ''),
    String(entry?.lunchFrom || ''),
    String(entry?.lunchTo || '')
  ].join('|');
}

function pickShiftTimeVariant(current = {}, preferredOffset = 0) {
  const serializedCurrent = serializeShiftTimeValues(current);
  for (let offset = 0; offset < SHIFT_TIME_VARIANTS.length; offset += 1) {
    const candidate = SHIFT_TIME_VARIANTS[(preferredOffset + offset) % SHIFT_TIME_VARIANTS.length];
    if (serializeShiftTimeValues(candidate) !== serializedCurrent) {
      return candidate;
    }
  }
  return SHIFT_TIME_VARIANTS[preferredOffset % SHIFT_TIME_VARIANTS.length];
}

async function getShiftTimesMeta(page) {
  return page.evaluate(() => {
    const list = Array.isArray(productionShiftTimes) ? productionShiftTimes : [];
    return list
      .map((item) => ({
        shift: parseInt(item?.shift, 10) || 1,
        timeFrom: String(item?.timeFrom || ''),
        timeTo: String(item?.timeTo || ''),
        lunchFrom: String(item?.lunchFrom || ''),
        lunchTo: String(item?.lunchTo || ''),
        rev: Number.isFinite(Number(item?.rev)) ? Number(item.rev) : 1
      }))
      .sort((a, b) => a.shift - b.shift);
  });
}

async function fillShiftTimeInputs(page, shift, values = {}) {
  const timeFrom = values.timeFrom ?? null;
  const timeTo = values.timeTo ?? null;
  const lunchFrom = values.lunchFrom ?? null;
  const lunchTo = values.lunchTo ?? null;
  if (timeFrom !== null) {
    await page.fill(buildShiftTimeFieldSelector(shift, 'from'), timeFrom);
  }
  if (timeTo !== null) {
    await page.fill(buildShiftTimeFieldSelector(shift, 'to'), timeTo);
  }
  if (lunchFrom !== null) {
    await page.fill(buildShiftTimeFieldSelector(shift, 'lunch-from'), lunchFrom);
  }
  if (lunchTo !== null) {
    await page.fill(buildShiftTimeFieldSelector(shift, 'lunch-to'), lunchTo);
  }
}

async function readShiftTimeInputs(page, shift) {
  return {
    timeFrom: await page.locator(buildShiftTimeFieldSelector(shift, 'from')).inputValue(),
    timeTo: await page.locator(buildShiftTimeFieldSelector(shift, 'to')).inputValue(),
    lunchFrom: await page.locator(buildShiftTimeFieldSelector(shift, 'lunch-from')).inputValue(),
    lunchTo: await page.locator(buildShiftTimeFieldSelector(shift, 'lunch-to')).inputValue()
  };
}

async function saveShiftTimesFromUi(page, expectedStatus = 200) {
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'PUT'
    && response.url().includes('/api/directories/shift-times')
    && response.status() === expectedStatus
  ), { timeout: DIRECTORY_RESPONSE_TIMEOUT_MS });
  await page.click('#shift-times-save');
  const response = await responsePromise;
  return response.json().catch(() => ({}));
}

async function getEmployeeAssignmentMeta(page, { requireTwoTargets = false } = {}) {
  return page.evaluate(async ({ requireTwoTargets: needTwoTargets }) => {
    const response = await fetch('/api/data?scope=directories', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });
    const payload = await response.json().catch(() => ({}));
    const departments = Array.isArray(payload?.centers) ? payload.centers : [];
    const usersList = Array.isArray(payload?.users) ? payload.users : [];
    const departmentNameById = departments.reduce((acc, department) => {
      const id = String(department?.id || '').trim();
      if (!id) return acc;
      acc[id] = String(department?.name || '').trim();
      return acc;
    }, {});
    const departmentCounts = usersList.reduce((acc, user) => {
      const userName = String(user?.name || user?.username || '').trim().toLowerCase();
      const login = String(user?.login || '').trim().toLowerCase();
      if (!userName || userName === 'abyss' || login === 'abyss') return acc;
      const departmentId = String(user?.departmentId || '').trim();
      if (!departmentId) return acc;
      acc[departmentId] = (acc[departmentId] || 0) + 1;
      return acc;
    }, {});

    const employees = usersList
      .filter((user) => {
        const userName = String(user?.name || user?.username || '').trim().toLowerCase();
        const login = String(user?.login || '').trim().toLowerCase();
        return Boolean(userName && userName !== 'abyss' && login !== 'abyss');
      })
      .map((user) => {
        const userId = String(user?.id || '').trim();
        const currentDepartmentId = String(user?.departmentId || '').trim();
        const targetDepartmentIds = [];
        if (currentDepartmentId) {
          targetDepartmentIds.push('');
        }
        departments.forEach((department) => {
          const departmentId = String(department?.id || '').trim();
          if (!departmentId || departmentId === currentDepartmentId) return;
          targetDepartmentIds.push(departmentId);
        });
        return {
          userId,
          userName: String(user?.name || user?.username || '').trim(),
          expectedRev: Number.isFinite(Number(user?.rev)) ? Number(user.rev) : 1,
          currentDepartmentId,
          currentDepartmentName: departmentNameById[currentDepartmentId] || '',
          targetDepartmentIds,
          departmentNameById,
          departmentCounts
        };
      })
      .filter((entry) => entry.userId);

    return employees.find((entry) => (
      needTwoTargets
        ? entry.targetDepartmentIds.length >= 2
        : entry.targetDepartmentIds.length >= 1
    )) || null;
  }, { requireTwoTargets });
}

async function assignEmployeeDepartment(page, userId, departmentId, expectedStatus = 200) {
  await waitForBackgroundHydration(page);
  const requestPath = `/api/directories/employees/${encodeURIComponent(userId)}/department`;
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'PUT'
    && response.url().includes(requestPath)
    && response.status() === expectedStatus
  ), { timeout: DIRECTORY_RESPONSE_TIMEOUT_MS });
  await page.locator(`select.employee-department-select[data-id="${userId}"]`).selectOption(departmentId || '');
  const response = await responsePromise;
  return response.json().catch(() => ({}));
}

async function getDepartmentEmployeesCountFromTable(page, departmentName) {
  const row = await findTableRowByText(page, '#departments-table-wrapper', departmentName);
  const countText = await row.locator('td').nth(2).textContent();
  return Number.parseInt(String(countText || '').trim(), 10) || 0;
}

async function getReferencedOperationMeta(page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/data', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    });
    const payload = await response.json().catch(() => ({}));
    const operations = Array.isArray(payload?.ops) ? payload.ops : [];
    const cards = Array.isArray(payload?.cards) ? payload.cards : [];
    const counts = new Map();
    cards.forEach((card) => {
      if (!card || !Array.isArray(card.operations)) return;
      const seen = new Set();
      card.operations.forEach((routeOp) => {
        const opId = String(routeOp?.opId || '').trim();
        if (!opId || seen.has(opId)) return;
        seen.add(opId);
        counts.set(opId, (counts.get(opId) || 0) + 1);
      });
    });
    const operation = operations.find((item) => item && counts.get(String(item.id || '').trim()) > 0) || null;
    if (!operation) return null;
    const operationId = String(operation.id || '').trim();
    return {
      id: operationId,
      name: String(operation.name || '').trim(),
      rev: Number.isFinite(Number(operation.rev)) ? Number(operation.rev) : 1,
      cardsCount: counts.get(operationId) || 0
    };
  });
}

async function getReferencedDepartmentMeta(page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/data', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    });
    const payload = await response.json().catch(() => ({}));
    const departments = Array.isArray(payload?.centers) ? payload.centers : [];
    const cards = Array.isArray(payload?.cards) ? payload.cards : [];
    const counts = new Map();
    cards.forEach((card) => {
      if (!card || !Array.isArray(card.operations)) return;
      const seen = new Set();
      card.operations.forEach((routeOp) => {
        const centerId = String(routeOp?.centerId || '').trim();
        if (!centerId || seen.has(centerId)) return;
        seen.add(centerId);
        counts.set(centerId, (counts.get(centerId) || 0) + 1);
      });
    });
    const department = departments.find((item) => item && counts.get(String(item.id || '').trim()) > 0) || null;
    if (!department) return null;
    const departmentId = String(department.id || '').trim();
    return {
      id: departmentId,
      name: String(department.name || '').trim(),
      rev: Number.isFinite(Number(department.rev)) ? Number(department.rev) : 1,
      cardsCount: counts.get(departmentId) || 0
    };
  });
}

async function getProtectedAreaMeta(page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/data', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    });
    const payload = await response.json().catch(() => ({}));
    const areas = Array.isArray(payload?.areas) ? payload.areas : [];
    const tasks = Array.isArray(payload?.productionShiftTasks) ? payload.productionShiftTasks : [];
    const cards = Array.isArray(payload?.cards) ? payload.cards : [];
    return areas.map((area) => {
      const areaId = String(area?.id || '').trim();
      const plannedTasksCount = tasks.filter((task) => String(task?.areaId || '').trim() === areaId).length;
      const executionHistoryCount = cards.filter((card) => {
        const lists = [
          Array.isArray(card?.flow?.items) ? card.flow.items : [],
          Array.isArray(card?.flow?.samples) ? card.flow.samples : []
        ];
        return lists.some((list) => list.some((item) => (
          Array.isArray(item?.history)
          && item.history.some((entry) => (
            String(entry?.areaId || '').trim() === areaId
            && ['GOOD', 'DEFECT', 'DELAYED'].includes(String(entry?.status || '').trim().toUpperCase())
          ))
        )));
      }).length;
      return {
        id: areaId,
        name: String(area?.name || '').trim(),
        rev: Number.isFinite(Number(area?.rev)) ? Number(area.rev) : 1,
        plannedTasksCount,
        executionHistoryCount,
        blocked: plannedTasksCount > 0 || executionHistoryCount > 0
      };
    }).find((entry) => entry.blocked) || null;
  });
}

async function getPlanningOnlyAreaMeta(page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/data', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    });
    const payload = await response.json().catch(() => ({}));
    const areas = Array.isArray(payload?.areas) ? payload.areas : [];
    const tasks = Array.isArray(payload?.productionShiftTasks) ? payload.productionShiftTasks : [];
    const shifts = Array.isArray(payload?.productionShifts) ? payload.productionShifts : [];
    const cards = Array.isArray(payload?.cards) ? payload.cards : [];
    return areas.map((area) => {
      const areaId = String(area?.id || '').trim();
      const areaName = String(area?.name || '').trim();
      const areaNameNeedle = areaName.toLowerCase();
      const plannedTasksCount = tasks.filter((task) => String(task?.areaId || '').trim() === areaId).length;
      const executionHistoryCount = cards.filter((card) => {
        const lists = [
          Array.isArray(card?.flow?.items) ? card.flow.items : [],
          Array.isArray(card?.flow?.samples) ? card.flow.samples : []
        ];
        return lists.some((list) => list.some((item) => (
          Array.isArray(item?.history)
          && item.history.some((entry) => (
            String(entry?.areaId || '').trim() === areaId
            && ['GOOD', 'DEFECT', 'DELAYED'].includes(String(entry?.status || '').trim().toUpperCase())
          ))
        )));
      }).length;
      const planningLogsCount = areaNameNeedle
        ? cards.filter((card) => (Array.isArray(card?.logs) ? card.logs : []).some((entry) => {
          const field = String(entry?.field || '').trim().toLowerCase();
          if (field !== 'planning' && field !== 'subcontractchain') return false;
          const oldValue = String(entry?.oldValue || '').trim().toLowerCase();
          const newValue = String(entry?.newValue || '').trim().toLowerCase();
          return oldValue.includes(areaNameNeedle) || newValue.includes(areaNameNeedle);
        })).length + shifts.reduce((sum, shift) => (
          sum + (Array.isArray(shift?.logs) ? shift.logs.filter((entry) => {
            const field = String(entry?.field || '').trim().toLowerCase();
            const oldValue = String(entry?.oldValue || '').trim();
            const newValue = String(entry?.newValue || '').trim();
            if (field === 'shiftcell') {
              return oldValue.includes(areaId) || newValue.includes(areaId);
            }
            if (field === 'subcontractchain' && areaNameNeedle) {
              return oldValue.toLowerCase().includes(areaNameNeedle) || newValue.toLowerCase().includes(areaNameNeedle);
            }
            return false;
          }).length : 0)
        ), 0)
        : 0;
      return {
        id: areaId,
        name: areaName,
        rev: Number.isFinite(Number(area?.rev)) ? Number(area.rev) : 1,
        plannedTasksCount,
        executionHistoryCount,
        planningLogsCount
      };
    }).find((entry) => (
      entry.plannedTasksCount === 0
      && entry.executionHistoryCount === 0
      && entry.planningLogsCount > 0
    )) || null;
  });
}

test.describe.serial('directories domain api', () => {
  test.beforeAll(async () => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
  });

  test.afterAll(async () => {
    await stopServer();
  });

  test('uses directory domain API for departments, operations, operation-area bindings and areas', async ({ page }) => {
    test.setTimeout(180000);
    const diagnostics = attachDiagnostics(page);
    const writes = trackDirectoryRequests(page);
    const suffix = String(Date.now()).slice(-6);
    const departmentName = `Цех E2E ${suffix}`;
    const departmentUpdatedName = `${departmentName} Обновлён`;
    const areaName = `Участок E2E ${suffix}`;
    const areaUpdatedName = `${areaName} QA`;
    const operationName = `Операция E2E ${suffix}`;
    const operationUpdatedName = `${operationName} Обновлён`;

    await loginAsAbyss(page, { startPath: '/departments' });
    await waitUsableUi(page, '/departments');

    await createDepartment(page, departmentName, 'Stage 6 create department');
    await editDepartment(page, departmentName, departmentUpdatedName, 'Stage 6 update department');
    await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe('/departments');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitUsableUi(page, '/departments');
    await expect(await findTableRowByText(page, '#departments-table-wrapper', departmentUpdatedName)).toBeVisible();

    await openRouteAndAssert(page, '/areas');
    await createArea(page, areaName, 'Stage 6 create area', 'Производство');
    await editArea(page, areaName, areaUpdatedName, 'Stage 6 update area', 'Качество');
    await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe('/areas');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitUsableUi(page, '/areas');
    await expect(await findTableRowByText(page, '#areas-table-wrapper', areaUpdatedName)).toBeVisible();

    await openRouteAndAssert(page, '/operations');
    await createOperation(page, operationName, 'Stage 6 create operation', '45', 'Стандартная');
    await editOperation(page, operationName, operationUpdatedName, 'Stage 6 update operation', '55', 'Документы');
    await addOperationAreaBinding(page, operationUpdatedName, areaUpdatedName);
    await removeOperationAreaBinding(page, operationUpdatedName, areaUpdatedName);
    await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe('/operations');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitUsableUi(page, '/operations');
    await expect(await findTableRowByText(page, '#operations-table-wrapper', operationUpdatedName)).toBeVisible();

    await openRouteAndAssert(page, '/areas');
    page.once('dialog', async (dialog) => dialog.accept());
    {
      const row = await findTableRowByText(page, '#areas-table-wrapper', areaUpdatedName);
      const responsePromise = page.waitForResponse((response) => (
        response.request().method() === 'DELETE'
        && response.url().includes('/api/directories/areas/')
        && response.status() === 200
      ));
      await row.locator('button[data-action="delete"]').click();
      await responsePromise;
      await expect(row).toHaveCount(0);
    }

    await openRouteAndAssert(page, '/operations');
    page.once('dialog', async (dialog) => dialog.accept());
    {
      const row = await findTableRowByText(page, '#operations-table-wrapper', operationUpdatedName);
      const responsePromise = page.waitForResponse((response) => (
        response.request().method() === 'DELETE'
        && response.url().includes('/api/directories/operations/')
        && response.status() === 200
      ));
      await row.locator('button[data-action="delete"]').click();
      await responsePromise;
      await expect(row).toHaveCount(0);
    }

    await openRouteAndAssert(page, '/departments');
    page.once('dialog', async (dialog) => dialog.accept());
    {
      const row = await findTableRowByText(page, '#departments-table-wrapper', departmentUpdatedName);
      const responsePromise = page.waitForResponse((response) => (
        response.request().method() === 'DELETE'
        && response.url().includes('/api/directories/departments/')
        && response.status() === 200
      ));
      await row.locator('button[data-action="delete"]').click();
      await responsePromise;
      await expect(row).toHaveCount(0);
    }

    expect(writes.some((entry) => entry.url.includes('/api/directories/departments'))).toBe(true);
    expect(writes.some((entry) => entry.url.includes('/api/directories/operations'))).toBe(true);
    expect(writes.some((entry) => entry.url.includes('/api/directories/areas'))).toBe(true);
    expect(writes.some((entry) => entry.url.includes('/api/data'))).toBe(false);

    expectNoCriticalClientFailures(diagnostics, {
      ignoreConsolePatterns: [
        /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
        /^\[LIVE\]/i,
        /Не удалось загрузить данные с сервера/i,
        /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
      ]
    });
  });

  test('uses directory employee assignment API on /employees and survives save, F5 and /departments refresh', async ({ page }) => {
    test.setTimeout(180000);
    const diagnostics = attachDiagnostics(page);
    const writes = trackDirectoryRequests(page);

    await loginAsAbyss(page, { startPath: '/employees' });
    await waitUsableUi(page, '/employees');

    const employeeMeta = await getEmployeeAssignmentMeta(page);
    expect(employeeMeta).toBeTruthy();
    const targetDepartmentId = employeeMeta.targetDepartmentIds.find(Boolean);
    expect(targetDepartmentId).toBeTruthy();
    const targetDepartmentName = employeeMeta.departmentNameById[targetDepartmentId];
    const expectedTargetCount = (employeeMeta.departmentCounts[targetDepartmentId] || 0) + 1;
    const writesBeforeAssignment = writes.length;

    const responseBody = await assignEmployeeDepartment(page, employeeMeta.userId, targetDepartmentId, 200);
    expect(responseBody?.command).toBe('employee.assignment.update');
    await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe('/employees');
    await expect(page.locator(`select.employee-department-select[data-id="${employeeMeta.userId}"]`)).toHaveValue(targetDepartmentId);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitUsableUi(page, '/employees');
    await expect(page.locator(`select.employee-department-select[data-id="${employeeMeta.userId}"]`)).toHaveValue(targetDepartmentId);

    await openRouteAndAssert(page, '/departments');
    await expect(await findTableRowByText(page, '#departments-table-wrapper', targetDepartmentName)).toBeVisible();
    await expect.poll(() => getDepartmentEmployeesCountFromTable(page, targetDepartmentName)).toBe(expectedTargetCount);

    expect(writes.slice(writesBeforeAssignment).some((entry) => (
      entry.method === 'PUT'
      && entry.url.includes(`/api/directories/employees/${employeeMeta.userId}/department`)
    ))).toBe(true);
    expect(writes.some((entry) => entry.url.includes('/api/data'))).toBe(false);

    expectNoCriticalClientFailures(diagnostics, {
      ignoreConsolePatterns: [
        /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
        /^\[LIVE\]/i,
        /^\[DATA\] legacy snapshot boundary/i,
        /Не удалось загрузить данные с сервера/i,
        /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
      ]
    });
  });

  test('keeps /employees stable on real two-tab employee assignment conflicts', async ({ browser, page }) => {
    test.setTimeout(180000);
    const diagnosticsOne = attachDiagnostics(page);
    const writesOne = trackDirectoryRequests(page);
    const contextTwo = await browser.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8401',
      viewport: { width: 1440, height: 1000 }
    });
    const pageTwo = await contextTwo.newPage();
    const diagnosticsTwo = attachDiagnostics(pageTwo);
    const writesTwo = trackDirectoryRequests(pageTwo);

    try {
      await loginAsAbyss(page, { startPath: '/employees' });
      await loginAsAbyss(pageTwo, { startPath: '/employees' });
      await waitUsableUi(pageTwo, '/employees');

      const employeeMeta = await getEmployeeAssignmentMeta(page, { requireTwoTargets: true });
      expect(employeeMeta).toBeTruthy();
      const winnerDepartmentId = employeeMeta.targetDepartmentIds.find(Boolean) || employeeMeta.targetDepartmentIds[0];
      const loserDepartmentId = employeeMeta.targetDepartmentIds.find((id) => id !== winnerDepartmentId);
      expect(winnerDepartmentId).toBeDefined();
      expect(loserDepartmentId).toBeDefined();

      await expect(pageTwo.locator(`select.employee-department-select[data-id="${employeeMeta.userId}"]`)).toBeVisible();
      let releaseBlockedRequest;
      const blockedRequestReady = new Promise((resolve) => {
        releaseBlockedRequest = resolve;
      });
      let notifyBlockedRequestSeen;
      const blockedRequestSeen = new Promise((resolve) => {
        notifyBlockedRequestSeen = resolve;
      });
      const requestPathPattern = `**/api/directories/employees/${employeeMeta.userId}/department`;
      await pageTwo.route(requestPathPattern, async (route) => {
        notifyBlockedRequestSeen();
        await blockedRequestReady;
        await route.continue();
      });

      const conflictResponsePromise = pageTwo.waitForResponse((response) => (
        response.request().method() === 'PUT'
        && response.url().includes(`/api/directories/employees/${employeeMeta.userId}/department`)
        && response.status() === 409
      ));
      const loserActionPromise = pageTwo.locator(`select.employee-department-select[data-id="${employeeMeta.userId}"]`).selectOption(loserDepartmentId);
      await blockedRequestSeen;

      await assignEmployeeDepartment(page, employeeMeta.userId, winnerDepartmentId, 200);
      releaseBlockedRequest();
      await loserActionPromise;
      const conflictBody = await (await conflictResponsePromise).json().catch(() => ({}));
      await pageTwo.unroute(requestPathPattern);

      expect(conflictBody?.code).toBe('STALE_REVISION');
      await expect.poll(() => pageTwo.evaluate(() => window.location.pathname + window.location.search)).toBe('/employees');
      await expect(pageTwo.locator('#toast-container .toast').last()).toContainText(/измен|обновлен/i);
      await expect.poll(async () => (
        pageTwo.locator(`select.employee-department-select[data-id="${employeeMeta.userId}"]`).inputValue()
      )).toBe(winnerDepartmentId);

      expect(writesOne.some((entry) => entry.url.includes('/api/data'))).toBe(false);
      expect(writesTwo.some((entry) => entry.url.includes('/api/data'))).toBe(false);

      expectNoCriticalClientFailures(diagnosticsOne, {
        ignoreConsolePatterns: [
          /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
          /^\[LIVE\]/i,
          /^\[CONFLICT\]/i,
          /Не удалось загрузить данные с сервера/i,
          /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
        ]
      });
      expectNoCriticalClientFailures(diagnosticsTwo, {
        ignoreConsolePatterns: [
          /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
          /Failed to load resource: the server responded with a status of 409 \(Conflict\)/i,
          /^\[LIVE\]/i,
          /^\[CONFLICT\]/i,
          /Не удалось загрузить данные с сервера/i,
          /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
        ]
      });
    } finally {
      await contextTwo.close();
    }
  });

  test('returns clear rejected employee assignment responses for missing employee and missing department', async ({ page }) => {
    test.setTimeout(180000);
    const diagnostics = attachDiagnostics(page);
    const writes = trackDirectoryRequests(page);

    await loginAsAbyss(page, { startPath: '/employees' });
    await waitUsableUi(page, '/employees');

    const employeeMeta = await getEmployeeAssignmentMeta(page);
    expect(employeeMeta).toBeTruthy();
    const targetDepartmentId = employeeMeta.targetDepartmentIds.find(Boolean);
    expect(targetDepartmentId).toBeTruthy();

    const missingUserResult = await page.evaluate(async ({ departmentId }) => {
      const response = await window.apiFetch('/api/directories/employees/missing-e2e-user/department', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          departmentId,
          expectedRev: 1
        }),
        connectionSource: 'e2e:employee-assignment:missing-user'
      });
      const body = await response.json().catch(() => ({}));
      return {
        status: response.status,
        body
      };
    }, { departmentId: targetDepartmentId });

    expect(missingUserResult.status).toBe(404);
    expect(missingUserResult.body?.code).toBe('USER_NOT_FOUND');
    expect(Array.isArray(missingUserResult.body?.users)).toBe(true);
    expect(Array.isArray(missingUserResult.body?.centers)).toBe(true);

    const invalidDepartmentResult = await page.evaluate(async ({ userId, expectedRev }) => {
      const response = await window.apiFetch(`/api/directories/employees/${encodeURIComponent(userId)}/department`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          departmentId: 'missing-e2e-department',
          expectedRev
        }),
        connectionSource: 'e2e:employee-assignment:missing-department'
      });
      const body = await response.json().catch(() => ({}));
      return {
        status: response.status,
        body
      };
    }, {
      userId: employeeMeta.userId,
      expectedRev: employeeMeta.expectedRev
    });

    expect(invalidDepartmentResult.status).toBe(409);
    expect(invalidDepartmentResult.body?.code).toBe('INVALID_STATE');
    expect(String(invalidDepartmentResult.body?.message || invalidDepartmentResult.body?.error || '')).toContain('Подразделение уже недоступно');
    await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe('/employees');
    expect(writes.some((entry) => entry.url.includes('/api/data'))).toBe(false);

    expectNoCriticalClientFailures(diagnostics, {
      ignoreConsolePatterns: [
        /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
        /Failed to load resource: the server responded with a status of 404 \(Not Found\)/i,
        /Failed to load resource: the server responded with a status of 409 \(Conflict\)/i,
        /^\[LIVE\]/i,
        /^\[CONFLICT\]/i,
        /Не удалось загрузить данные с сервера/i,
        /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
      ]
    });
  });

  test('uses directory shift-times API, propagates live updates and keeps production readers compatible', async ({ browser, page }) => {
    test.setTimeout(240000);
    const diagnosticsOne = attachDiagnostics(page);
    const writesOne = trackDirectoryRequests(page);
    const contextTwo = await browser.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8401',
      viewport: { width: 1440, height: 1000 }
    });
    const pageTwo = await contextTwo.newPage();
    const diagnosticsTwo = attachDiagnostics(pageTwo);
    const writesTwo = trackDirectoryRequests(pageTwo);

    try {
      await loginAsAbyss(page, { startPath: '/shift-times' });
      await loginAsAbyss(pageTwo, { startPath: '/shift-times' });
      await waitUsableUi(pageTwo, '/shift-times');

      const shiftTimesMeta = await getShiftTimesMeta(page);
      const targetShift = shiftTimesMeta.find((entry) => entry.shift === 1) || shiftTimesMeta[0];
      expect(targetShift).toBeTruthy();
      const nextValues = pickShiftTimeVariant(targetShift, 0);

      await fillShiftTimeInputs(page, targetShift.shift, nextValues);
      const responseBody = await saveShiftTimesFromUi(page, 200);
      expect(responseBody?.command).toBe('shift-times.update');
      await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe('/shift-times');
      await expect.poll(async () => serializeShiftTimeValues(await readShiftTimeInputs(pageTwo, targetShift.shift))).toBe(serializeShiftTimeValues(nextValues));
      await expect.poll(() => pageTwo.evaluate(() => window.location.pathname + window.location.search)).toBe('/shift-times');

      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitUsableUi(page, '/shift-times');
      await expect.poll(async () => serializeShiftTimeValues(await readShiftTimeInputs(page, targetShift.shift))).toBe(serializeShiftTimeValues(nextValues));

      await openRouteAndAssert(page, '/production/plan');
      await waitUsableUi(page, '/production/plan');
      await expect(page.locator('.production-shifts-shift-btn').first()).toBeVisible();
      await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe('/production/plan');

      expect(writesOne.some((entry) => (
        entry.method === 'PUT'
        && entry.url.includes('/api/directories/shift-times')
      ))).toBe(true);
      expect(writesOne.some((entry) => entry.url.includes('/api/data'))).toBe(false);
      expect(writesTwo.some((entry) => entry.url.includes('/api/data'))).toBe(false);

      expectNoCriticalClientFailures(diagnosticsOne, {
        ignoreConsolePatterns: [
          /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
          /^\[LIVE\]/i,
          /^\[CONFLICT\]/i,
          /Не удалось загрузить данные с сервера/i,
          /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
        ]
      });
      expectNoCriticalClientFailures(diagnosticsTwo, {
        ignoreConsolePatterns: [
          /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
          /^\[LIVE\]/i,
          /^\[CONFLICT\]/i,
          /Не удалось загрузить данные с сервера/i,
          /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
        ]
      });
    } finally {
      await contextTwo.close();
    }
  });

  test('keeps /shift-times route-safe on local invalid-state without sending a request', async ({ page }) => {
    test.setTimeout(180000);
    const diagnostics = attachDiagnostics(page);
    const writes = trackDirectoryRequests(page);

    await loginAsAbyss(page, { startPath: '/shift-times' });
    await waitUsableUi(page, '/shift-times');

    const shiftTimesMeta = await getShiftTimesMeta(page);
    const targetShift = shiftTimesMeta.find((entry) => entry.shift === 1) || shiftTimesMeta[0];
    expect(targetShift).toBeTruthy();
    const nextValues = pickShiftTimeVariant(targetShift, 1);
    const writesBeforeSave = writes.length;

    await fillShiftTimeInputs(page, targetShift.shift, nextValues);
    await page.evaluate((shiftNumber) => {
      productionShiftTimes = (productionShiftTimes || []).map((item) => {
        const shift = parseInt(item?.shift, 10) || 1;
        if (shift !== shiftNumber) return item;
        return {
          ...item,
          rev: (Number(item?.rev) > 0 ? Number(item.rev) : 1) + 1
        };
      });
    }, targetShift.shift);

    await page.click('#shift-times-save');
    await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe('/shift-times');
    await expect(page.locator('#toast-container .toast').last()).toContainText(/изменено другим пользователем|данные обновлены/i);
    await expect.poll(async () => serializeShiftTimeValues(await readShiftTimeInputs(page, targetShift.shift))).toBe(serializeShiftTimeValues(targetShift));
    expect(writes.slice(writesBeforeSave).some((entry) => entry.url.includes('/api/directories/shift-times'))).toBe(false);
    expect(writes.some((entry) => entry.url.includes('/api/data'))).toBe(false);

    expectNoCriticalClientFailures(diagnostics, {
      ignoreConsolePatterns: [
        /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
        /^\[LIVE\]/i,
        /^\[CONFLICT\]/i,
        /Не удалось загрузить данные с сервера/i,
        /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
      ]
    });
  });

  test('keeps /shift-times stable on real two-tab conflicts through the directory API', async ({ browser, page }) => {
    test.setTimeout(240000);
    const diagnosticsOne = attachDiagnostics(page);
    const writesOne = trackDirectoryRequests(page);
    const contextTwo = await browser.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8401',
      viewport: { width: 1440, height: 1000 }
    });
    const pageTwo = await contextTwo.newPage();
    await pageTwo.route('**/api/events/stream', async (route) => {
      await route.abort();
    });
    const diagnosticsTwo = attachDiagnostics(pageTwo);
    const writesTwo = trackDirectoryRequests(pageTwo);

    try {
      await loginAsAbyss(page, { startPath: '/shift-times' });
      await loginAsAbyss(pageTwo, { startPath: '/shift-times' });
      await waitUsableUi(pageTwo, '/shift-times');

      const shiftTimesMeta = await getShiftTimesMeta(page);
      const targetShift = shiftTimesMeta.find((entry) => entry.shift === 1) || shiftTimesMeta[0];
      expect(targetShift).toBeTruthy();
      const winnerValues = pickShiftTimeVariant(targetShift, 0);
      const loserValues = pickShiftTimeVariant(winnerValues, 1);

      await fillShiftTimeInputs(pageTwo, targetShift.shift, loserValues);
      await fillShiftTimeInputs(page, targetShift.shift, winnerValues);
      const successBody = await saveShiftTimesFromUi(page, 200);
      expect(successBody?.command).toBe('shift-times.update');

      const conflictBody = await saveShiftTimesFromUi(pageTwo, 409);
      expect(conflictBody?.code).toBe('STALE_REVISION');
      await expect.poll(() => pageTwo.evaluate(() => window.location.pathname + window.location.search)).toBe('/shift-times');
      await expect(pageTwo.locator('#toast-container .toast').last()).toContainText(/изменено другим пользователем|данные обновлены/i);
      await expect.poll(async () => serializeShiftTimeValues(await readShiftTimeInputs(pageTwo, targetShift.shift))).toBe(serializeShiftTimeValues(winnerValues));

      expect(writesOne.some((entry) => entry.url.includes('/api/data'))).toBe(false);
      expect(writesTwo.some((entry) => entry.url.includes('/api/data'))).toBe(false);

      expectNoCriticalClientFailures(diagnosticsOne, {
        ignoreConsolePatterns: [
          /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
          /^\[LIVE\]/i,
          /^\[CONFLICT\]/i,
          /Не удалось загрузить данные с сервера/i,
          /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
        ]
      });
      expectNoCriticalClientFailures(diagnosticsTwo, {
        ignoreConsolePatterns: [
          /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
          /Failed to load resource: the server responded with a status of 409 \(Conflict\)/i,
          /Failed to load resource:.*api\/events\/stream/i,
          /net::ERR_FAILED/i,
          /^\[LIVE\]/i,
          /^\[CONFLICT\]/i,
          /Не удалось загрузить данные с сервера/i,
          /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
        ]
      });
    } finally {
      await contextTwo.close();
    }
  });

  test('keeps /departments, /operations and /areas stable on real two-tab conflicts', async ({ browser, page }) => {
    test.setTimeout(240000);
    const diagnosticsOne = attachDiagnostics(page);
    const contextTwo = await browser.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8401',
      viewport: { width: 1440, height: 1000 }
    });
    const pageTwo = await contextTwo.newPage();
    const diagnosticsTwo = attachDiagnostics(pageTwo);
    const suffix = String(Date.now()).slice(-6);

    try {
      await loginAsAbyss(page, { startPath: '/departments' });
      await loginAsAbyss(pageTwo, { startPath: '/departments' });

      const departmentInitial = `Конфликт Цех ${suffix}`;
      const departmentWinner = `${departmentInitial} A`;
      const departmentLoser = `${departmentInitial} B`;
      await createDepartment(page, departmentInitial, 'Conflict department');
      await waitUsableUi(pageTwo, '/departments');
      await expect(await findTableRowByText(pageTwo, '#departments-table-wrapper', departmentInitial)).toBeVisible();
      {
        const rowOne = await findTableRowByText(page, '#departments-table-wrapper', departmentInitial);
        const rowTwo = await findTableRowByText(pageTwo, '#departments-table-wrapper', departmentInitial);
        await rowOne.locator('button[data-action="edit"]').click();
        await rowTwo.locator('button[data-action="edit"]').click();
        await page.fill('#departments-name', departmentWinner);
        await pageTwo.fill('#departments-name', departmentLoser);
        const successPromise = page.waitForResponse((response) => (
          response.request().method() === 'PUT'
          && response.url().includes('/api/directories/departments/')
          && response.status() === 200
        ));
        await page.click('#departments-submit');
        await successPromise;
        const conflictPromise = pageTwo.waitForResponse((response) => (
          response.request().method() === 'PUT'
          && response.url().includes('/api/directories/departments/')
          && response.status() === 409
        ));
        await pageTwo.click('#departments-submit');
        await conflictPromise;
        await expect.poll(() => pageTwo.evaluate(() => window.location.pathname + window.location.search)).toBe('/departments');
        await expect(pageTwo.locator('#toast-container .toast').last()).toContainText('изменено другим пользователем');
        await expect(await findTableRowByText(pageTwo, '#departments-table-wrapper', departmentWinner)).toBeVisible();
      }

      await openRouteAndAssert(page, '/areas');
      await openRouteAndAssert(pageTwo, '/areas');
      const areaInitial = `Конфликт Участок ${suffix}`;
      const areaWinner = `${areaInitial} A`;
      const areaLoser = `${areaInitial} B`;
      await createArea(page, areaInitial, 'Conflict area', 'Производство');
      await expect(await findTableRowByText(pageTwo, '#areas-table-wrapper', areaInitial)).toBeVisible();
      {
        const rowOne = await findTableRowByText(page, '#areas-table-wrapper', areaInitial);
        const rowTwo = await findTableRowByText(pageTwo, '#areas-table-wrapper', areaInitial);
        await rowOne.locator('button[data-action="edit"]').click();
        await rowTwo.locator('button[data-action="edit"]').click();
        await page.fill('#areas-name', areaWinner);
        await pageTwo.fill('#areas-name', areaLoser);
        const successPromise = page.waitForResponse((response) => (
          response.request().method() === 'PUT'
          && response.url().includes('/api/directories/areas/')
          && response.status() === 200
        ));
        await page.click('#areas-submit');
        await successPromise;
        const conflictPromise = pageTwo.waitForResponse((response) => (
          response.request().method() === 'PUT'
          && response.url().includes('/api/directories/areas/')
          && response.status() === 409
        ));
        await pageTwo.click('#areas-submit');
        await conflictPromise;
        await expect.poll(() => pageTwo.evaluate(() => window.location.pathname + window.location.search)).toBe('/areas');
        await expect(pageTwo.locator('#toast-container .toast').last()).toContainText('измен');
        await expect(await findTableRowByText(pageTwo, '#areas-table-wrapper', areaWinner)).toBeVisible();
      }

      await openRouteAndAssert(page, '/operations');
      await openRouteAndAssert(pageTwo, '/operations');
      const operationInitial = `Конфликт Операция ${suffix}`;
      const operationWinner = `${operationInitial} A`;
      const operationLoser = `${operationInitial} B`;
      await createOperation(page, operationInitial, 'Conflict operation', '35', 'Стандартная');
      await expect(await findTableRowByText(pageTwo, '#operations-table-wrapper', operationInitial)).toBeVisible();
      {
        const rowOne = await findTableRowByText(page, '#operations-table-wrapper', operationInitial);
        const rowTwo = await findTableRowByText(pageTwo, '#operations-table-wrapper', operationInitial);
        await rowOne.locator('button[data-action="edit"]').click();
        await rowTwo.locator('button[data-action="edit"]').click();
        await page.fill('#operations-name', operationWinner);
        await pageTwo.fill('#operations-name', operationLoser);
        const successPromise = page.waitForResponse((response) => (
          response.request().method() === 'PUT'
          && response.url().includes('/api/directories/operations/')
          && response.status() === 200
        ));
        await page.click('#operations-submit');
        await successPromise;
        const conflictPromise = pageTwo.waitForResponse((response) => (
          response.request().method() === 'PUT'
          && response.url().includes('/api/directories/operations/')
          && response.status() === 409
        ));
        await pageTwo.click('#operations-submit');
        await conflictPromise;
        await expect.poll(() => pageTwo.evaluate(() => window.location.pathname + window.location.search)).toBe('/operations');
        await expect(pageTwo.locator('#toast-container .toast').last()).toContainText('измен');
        await expect(await findTableRowByText(pageTwo, '#operations-table-wrapper', operationWinner)).toBeVisible();
      }

      expectNoCriticalClientFailures(diagnosticsOne, {
        ignoreConsolePatterns: [
          /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
          /Failed to load resource: the server responded with a status of 409 \(Conflict\)/i,
          /^\[LIVE\]/i,
          /^\[CONFLICT\]/i,
          /Не удалось загрузить данные с сервера/i,
          /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
        ]
      });
      expectNoCriticalClientFailures(diagnosticsTwo, {
        ignoreConsolePatterns: [
          /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
          /Failed to load resource: the server responded with a status of 409 \(Conflict\)/i,
          /^\[LIVE\]/i,
          /^\[CONFLICT\]/i,
          /Не удалось загрузить данные с сервера/i,
          /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
        ]
      });
    } finally {
      await contextTwo.close();
    }
  });

  test('blocks operation delete when the operation is already used in route cards', async ({ page }) => {
    test.setTimeout(180000);
    const diagnostics = attachDiagnostics(page);
    const writes = trackDirectoryRequests(page);

    await loginAsAbyss(page, { startPath: '/operations' });
    await waitUsableUi(page, '/operations');

    const protectedOperation = await getReferencedOperationMeta(page);
    expect(protectedOperation).toBeTruthy();
    const previousWritesCount = writes.length;

    {
      const row = await findTableRowByText(page, '#operations-table-wrapper', protectedOperation.name);
      page.once('dialog', async (dialog) => dialog.accept());
      await row.locator('button[data-action="delete"]').click();
      await expect(page.locator('#toast-container .toast').last()).toContainText('используется в маршрутных картах');
      await expect(await findTableRowByText(page, '#operations-table-wrapper', protectedOperation.name)).toBeVisible();
      await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe('/operations');
    }

    expect(writes.slice(previousWritesCount).some((entry) => (
      entry.method === 'DELETE' && entry.url.includes(`/api/directories/operations/${protectedOperation.id}`)
    ))).toBe(false);

    const apiResult = await page.evaluate(async ({ operationId, expectedRev }) => {
      const response = await window.apiFetch(`/api/directories/operations/${encodeURIComponent(operationId)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRev }),
        connectionSource: 'e2e:operation-delete-guard'
      });
      const body = await response.json().catch(() => ({}));
      return {
        status: response.status,
        body
      };
    }, {
      operationId: protectedOperation.id,
      expectedRev: protectedOperation.rev
    });

    expect(apiResult.status).toBe(409);
    expect(apiResult.body?.code).toBe('INVALID_STATE');
    expect(String(apiResult.body?.message || apiResult.body?.error || '')).toContain('используется в маршрутных картах');
    await expect(await findTableRowByText(page, '#operations-table-wrapper', protectedOperation.name)).toBeVisible();

    expectNoCriticalClientFailures(diagnostics, {
      ignoreConsolePatterns: [
        /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
        /Failed to load resource: the server responded with a status of 409 \(Conflict\)/i,
        /^\[LIVE\]/i,
        /^\[CONFLICT\]/i,
        /Не удалось загрузить данные с сервера/i,
        /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
      ]
    });
  });

  test('blocks department delete when the department is already used in route cards', async ({ page }) => {
    test.setTimeout(180000);
    const diagnostics = attachDiagnostics(page);
    const writes = trackDirectoryRequests(page);

    await loginAsAbyss(page, { startPath: '/departments' });
    await waitUsableUi(page, '/departments');

    const protectedDepartment = await getReferencedDepartmentMeta(page);
    expect(protectedDepartment).toBeTruthy();
    const previousWritesCount = writes.length;

    {
      const row = await findTableRowByText(page, '#departments-table-wrapper', protectedDepartment.name);
      page.once('dialog', async (dialog) => dialog.accept());
      await row.locator('button[data-action="delete"]').click();
      await expect(page.locator('#toast-container .toast').last()).toContainText('используется в маршрутных картах');
      await expect(await findTableRowByText(page, '#departments-table-wrapper', protectedDepartment.name)).toBeVisible();
      await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe('/departments');
    }

    expect(writes.slice(previousWritesCount).some((entry) => (
      entry.method === 'DELETE' && entry.url.includes(`/api/directories/departments/${protectedDepartment.id}`)
    ))).toBe(false);

    const apiResult = await page.evaluate(async ({ departmentId, expectedRev }) => {
      const response = await window.apiFetch(`/api/directories/departments/${encodeURIComponent(departmentId)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRev }),
        connectionSource: 'e2e:department-delete-guard'
      });
      const body = await response.json().catch(() => ({}));
      return {
        status: response.status,
        body
      };
    }, {
      departmentId: protectedDepartment.id,
      expectedRev: protectedDepartment.rev
    });

    expect(apiResult.status).toBe(409);
    expect(apiResult.body?.code).toBe('INVALID_STATE');
    expect(String(apiResult.body?.message || apiResult.body?.error || '')).toContain('используется в маршрутных картах');
    await expect(await findTableRowByText(page, '#departments-table-wrapper', protectedDepartment.name)).toBeVisible();

    expectNoCriticalClientFailures(diagnostics, {
      ignoreConsolePatterns: [
        /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
        /Failed to load resource: the server responded with a status of 409 \(Conflict\)/i,
        /^\[LIVE\]/i,
        /^\[CONFLICT\]/i,
        /Не удалось загрузить данные с сервера/i,
        /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
      ]
    });
  });

  test('blocks area delete when the area has active plan or execution history', async ({ page }) => {
    test.setTimeout(180000);
    const diagnostics = attachDiagnostics(page);
    const writes = trackDirectoryRequests(page);

    await loginAsAbyss(page, { startPath: '/areas' });
    await waitUsableUi(page, '/areas');

    const protectedArea = await getProtectedAreaMeta(page);
    expect(protectedArea).toBeTruthy();
    const previousWritesCount = writes.length;

    await page.evaluate(async () => {
      if (typeof window.loadData === 'function') {
        await window.loadData();
      } else if (typeof window.loadDataWithScope === 'function') {
        await window.loadDataWithScope({ scope: 'full', force: true, reason: 'e2e:area-delete-guard' });
      }
    });

    {
      const row = await findTableRowByText(page, '#areas-table-wrapper', protectedArea.name);
      page.once('dialog', async (dialog) => dialog.accept());
      await row.locator('button[data-action="delete"]').click();
      await expect(page.locator('#toast-container .toast').last()).toContainText(/планирован|история выполнения/i);
      await expect(await findTableRowByText(page, '#areas-table-wrapper', protectedArea.name)).toBeVisible();
      await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe('/areas');
    }

    expect(writes.slice(previousWritesCount).some((entry) => (
      entry.method === 'DELETE' && entry.url.includes(`/api/directories/areas/${protectedArea.id}`)
    ))).toBe(false);

    const apiResult = await page.evaluate(async ({ areaId, expectedRev }) => {
      const response = await window.apiFetch(`/api/directories/areas/${encodeURIComponent(areaId)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRev }),
        connectionSource: 'e2e:area-delete-guard'
      });
      const body = await response.json().catch(() => ({}));
      return {
        status: response.status,
        body
      };
    }, {
      areaId: protectedArea.id,
      expectedRev: protectedArea.rev
    });

    expect(apiResult.status).toBe(409);
    expect(apiResult.body?.code).toBe('INVALID_STATE');
    expect(String(apiResult.body?.message || apiResult.body?.error || '')).toMatch(/планирован|история выполнения/i);
    await expect(await findTableRowByText(page, '#areas-table-wrapper', protectedArea.name)).toBeVisible();

    expectNoCriticalClientFailures(diagnostics, {
      ignoreConsolePatterns: [
        /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
        /Failed to load resource: the server responded with a status of 409 \(Conflict\)/i,
        /^\[LIVE\]/i,
        /^\[CONFLICT\]/i,
        /Не удалось загрузить данные с сервера/i,
        /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
      ]
    });
  });

  test('allows area delete when the area has only planning logs without execution history', async ({ page }) => {
    test.setTimeout(180000);
    const diagnostics = attachDiagnostics(page);
    const writes = trackDirectoryRequests(page);

    await loginAsAbyss(page, { startPath: '/areas' });
    await waitUsableUi(page, '/areas');

    const deletableArea = await getPlanningOnlyAreaMeta(page);
    expect(deletableArea).toBeTruthy();

    await page.evaluate(async () => {
      if (typeof window.loadData === 'function') {
        await window.loadData();
      } else if (typeof window.loadDataWithScope === 'function') {
        await window.loadDataWithScope({ scope: 'full', force: true, reason: 'e2e:area-delete-planning-only' });
      }
    });

    const deleteResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'DELETE'
      && response.url().includes(`/api/directories/areas/${deletableArea.id}`)
      && response.status() === 200
    ));

    {
      const row = await findTableRowByText(page, '#areas-table-wrapper', deletableArea.name);
      page.once('dialog', async (dialog) => dialog.accept());
      await row.locator('button[data-action="delete"]').click();
    }

    await deleteResponsePromise;
    await expect(await findTableRowByText(page, '#areas-table-wrapper', deletableArea.name)).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe('/areas');
    expect(writes.some((entry) => (
      entry.method === 'DELETE' && entry.url.includes(`/api/directories/areas/${deletableArea.id}`)
    ))).toBe(true);

    expectNoCriticalClientFailures(diagnostics, {
      ignoreConsolePatterns: [
        /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
        /^\[LIVE\]/i,
        /^\[CONFLICT\]/i,
        /^\[DATA\] legacy snapshot boundary/i,
        /Не удалось загрузить данные с сервера/i,
        /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
      ]
    });
  });

  test('cleans production schedule assignments for deleted areas so employees are not blocked on /production/schedule', async ({ page }) => {
    test.setTimeout(180000);
    const diagnostics = attachDiagnostics(page);
    const suffix = String(Date.now()).slice(-6);
    const areaName = `Участок schedule cleanup ${suffix}`;

    await loginAsAbyss(page, { startPath: '/areas' });
    await waitUsableUi(page, '/areas');

    const createdArea = await createArea(page, areaName, 'Stage 6 schedule cleanup area', 'Производство');
    const areaId = String(createdArea?.area?.id || createdArea?.id || '').trim();
    expect(areaId).toBeTruthy();

    const scheduleSetup = await page.evaluate(async ({ targetAreaId }) => {
      if (typeof window.loadData === 'function') {
        await window.loadData();
      }
      const employee = (users || []).find(user => {
        const id = String(user?.id || '').trim();
        const name = String(user?.name || user?.username || '').trim().toLowerCase();
        return id && name && name !== 'abyss';
      });
      const fallbackArea = (areas || []).find(area => String(area?.id || '').trim() && String(area?.id || '').trim() !== targetAreaId);
      if (!employee || !fallbackArea) {
        return { ok: false, reason: 'missing-fixtures' };
      }
      const date = '2030-01-06';
      const shift = 1;
      productionSchedule = (productionSchedule || []).filter(record => !(
        String(record?.date || '') === date
        && (parseInt(record?.shift, 10) || 1) === shift
        && String(record?.employeeId || '').trim() === String(employee.id || '').trim()
      ));
      productionSchedule.push({
        date,
        shift,
        areaId: targetAreaId,
        employeeId: String(employee.id || '').trim(),
        timeFrom: null,
        timeTo: null,
        assignmentStatus: ''
      });
      const saved = typeof saveData === 'function' ? await saveData() : false;
      return {
        ok: Boolean(saved),
        employeeId: String(employee.id || '').trim(),
        fallbackAreaId: String(fallbackArea.id || '').trim(),
        date,
        shift
      };
    }, { targetAreaId: areaId });

    expect(scheduleSetup?.ok).toBe(true);
    expect(scheduleSetup?.employeeId).toBeTruthy();
    expect(scheduleSetup?.fallbackAreaId).toBeTruthy();

    const deleteResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'DELETE'
      && response.url().includes(`/api/directories/areas/${areaId}`)
      && response.status() === 200
    ));

    {
      const row = await findTableRowByText(page, '#areas-table-wrapper', areaName);
      page.once('dialog', async (dialog) => dialog.accept());
      await row.locator('button[data-action="delete"]').click();
    }

    await deleteResponsePromise;
    await expect(await findTableRowByText(page, '#areas-table-wrapper', areaName)).toBeHidden();

    await expect.poll((targetAreaId) => page.evaluate((deletedAreaId) => (
      Array.isArray(productionSchedule)
        ? productionSchedule.some(record => String(record?.areaId || '').trim() === deletedAreaId)
        : false
    ), targetAreaId), areaId).toBe(false);

    const persistedScheduleState = await page.evaluate(async (targetAreaId) => {
      const response = await fetch('/api/data', {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });
      const payload = await response.json().catch(() => ({}));
      const records = Array.isArray(payload?.productionSchedule) ? payload.productionSchedule : [];
      return records.some(record => String(record?.areaId || '').trim() === targetAreaId);
    }, areaId);
    expect(persistedScheduleState).toBe(false);

    await openRouteAndAssert(page, '/production/schedule');
    await waitUsableUi(page, '/production/schedule');

    const overlapConflict = await page.evaluate(({ date, shift, employeeId, fallbackAreaId }) => {
      if (typeof findEmployeeOverlapConflict !== 'function' || typeof getShiftRange !== 'function') {
        return { missing: true };
      }
      const range = getShiftRange(shift);
      return findEmployeeOverlapConflict({
        date,
        shift,
        employeeId,
        newStart: range?.start ?? null,
        newEnd: range?.end ?? null,
        allowSameAreaId: fallbackAreaId
      });
    }, {
      date: scheduleSetup.date,
      shift: scheduleSetup.shift,
      employeeId: scheduleSetup.employeeId,
      fallbackAreaId: scheduleSetup.fallbackAreaId
    });

    expect(overlapConflict).toBeNull();

    expectNoCriticalClientFailures(diagnostics, {
      ignoreConsolePatterns: [
        /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
        /^\[LIVE\]/i,
        /^\[CONFLICT\]/i,
        /^\[DATA\] legacy snapshot boundary/i,
        /Не удалось загрузить данные с сервера/i,
        /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
      ]
    });
  });

  test('keeps local stale-open invalid-state route-safe after concurrent delete', async ({ browser, page }) => {
    test.setTimeout(240000);
    const diagnosticsOne = attachDiagnostics(page);
    const contextTwo = await browser.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8401',
      viewport: { width: 1440, height: 1000 }
    });
    const pageTwo = await contextTwo.newPage();
    const diagnosticsTwo = attachDiagnostics(pageTwo);
    const suffix = String(Date.now()).slice(-6);

    try {
      await loginAsAbyss(page, { startPath: '/departments' });
      await loginAsAbyss(pageTwo, { startPath: '/departments' });

      const departmentName = `Stale Цех ${suffix}`;
      await createDepartment(page, departmentName, 'Stale department');
      await expect(await findTableRowByText(pageTwo, '#departments-table-wrapper', departmentName)).toBeVisible();
      {
        const row = await findTableRowByText(page, '#departments-table-wrapper', departmentName);
        await row.locator('button[data-action="edit"]').click();
        await page.fill('#departments-name', `${departmentName} Edited`);
        await deleteDepartment(pageTwo, departmentName);
        await page.click('#departments-submit');
        await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe('/departments');
        await expect(page.locator('#toast-container .toast').last()).toContainText(/обновлены|не найден/i);
        await expect(await findTableRowByText(page, '#departments-table-wrapper', departmentName)).toHaveCount(0);
        await expect(page.locator('#departments-submit')).toHaveText('Добавить подразделение');
      }

      await openRouteAndAssert(page, '/operations');
      await openRouteAndAssert(pageTwo, '/operations');
      const operationName = `Stale Операция ${suffix}`;
      await createOperation(page, operationName, 'Stale operation', '25', 'Стандартная');
      await expect(await findTableRowByText(pageTwo, '#operations-table-wrapper', operationName)).toBeVisible();
      {
        const row = await findTableRowByText(page, '#operations-table-wrapper', operationName);
        await row.locator('button[data-action="edit"]').click();
        await page.fill('#operations-name', `${operationName} Edited`);
        await deleteOperation(pageTwo, operationName);
        await page.click('#operations-submit');
        await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe('/operations');
        await expect(page.locator('#toast-container .toast').last()).toContainText(/обновлены|не найден/i);
        await expect(await findTableRowByText(page, '#operations-table-wrapper', operationName)).toHaveCount(0);
        await expect(page.locator('#operations-submit')).toHaveText('Добавить операцию');
      }

      await openRouteAndAssert(page, '/areas');
      await openRouteAndAssert(pageTwo, '/areas');
      const areaName = `Stale Участок ${suffix}`;
      await createArea(page, areaName, 'Stale area', 'Производство');
      await expect(await findTableRowByText(pageTwo, '#areas-table-wrapper', areaName)).toBeVisible();
      {
        const row = await findTableRowByText(page, '#areas-table-wrapper', areaName);
        await row.locator('button[data-action="edit"]').click();
        await page.fill('#areas-name', `${areaName} Edited`);
        await deleteArea(pageTwo, areaName);
        await page.click('#areas-submit');
        await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe('/areas');
        await expect(page.locator('#toast-container .toast').last()).toContainText(/обновлены|не найден/i);
        await expect(await findTableRowByText(page, '#areas-table-wrapper', areaName)).toHaveCount(0);
        await expect(page.locator('#areas-submit')).toHaveText('Добавить участок');
      }

      expectNoCriticalClientFailures(diagnosticsOne, {
        ignoreConsolePatterns: [
          /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
          /Failed to load resource: the server responded with a status of 404 \(Not Found\)/i,
          /^\[LIVE\]/i,
          /^\[CONFLICT\]/i,
          /Не удалось загрузить данные с сервера/i,
          /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
        ]
      });
      expectNoCriticalClientFailures(diagnosticsTwo, {
        ignoreConsolePatterns: [
          /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
          /^\[LIVE\]/i,
          /Не удалось загрузить данные с сервера/i,
          /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
        ]
      });
    } finally {
      await contextTwo.close();
    }
  });

  test('keeps /operations synchronized with /areas after live type change and area delete cleanup', async ({ browser, page }) => {
    test.setTimeout(240000);
    const diagnosticsOne = attachDiagnostics(page);
    const contextTwo = await browser.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8401',
      viewport: { width: 1440, height: 1000 }
    });
    const pageTwo = await contextTwo.newPage();
    const diagnosticsTwo = attachDiagnostics(pageTwo);
    const suffix = String(Date.now()).slice(-6);
    const areaName = `Sync Участок ${suffix}`;
    const operationName = `Sync Операция ${suffix}`;

    try {
      await loginAsAbyss(page, { startPath: '/operations' });
      await loginAsAbyss(pageTwo, { startPath: '/areas' });
      await waitUsableUi(page, '/operations');
      await waitUsableUi(pageTwo, '/areas');

      await createArea(pageTwo, areaName, 'Sync area', 'Производство');
      await openRouteAndAssert(page, '/operations');
      await createOperation(page, operationName, 'Sync operation', '30', 'Стандартная');
      await addOperationAreaBinding(page, operationName, areaName);

      await expect(await findTableRowByText(pageTwo, '#areas-table-wrapper', areaName)).toBeVisible();
      await changeAreaTypeInline(pageTwo, areaName, 'Качество');
      await expect.poll(async () => {
        const row = await findTableRowByText(page, '#operations-table-wrapper', operationName);
        return row.textContent();
      }).toContain('Качество');
      await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe('/operations');

      await deleteArea(pageTwo, areaName);
      await expect.poll(async () => {
        const row = await findTableRowByText(page, '#operations-table-wrapper', operationName);
        return await row.locator('.op-area-pill').filter({ hasText: areaName }).count();
      }).toBe(0);
      await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe('/operations');

      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitUsableUi(page, '/operations');
      await expect(await findTableRowByText(page, '#operations-table-wrapper', operationName)).toBeVisible();
      await expect((await findTableRowByText(page, '#operations-table-wrapper', operationName)).locator('.op-area-pill').filter({ hasText: areaName })).toHaveCount(0);

      expectNoCriticalClientFailures(diagnosticsOne, {
        ignoreConsolePatterns: [
          /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
          /^\[LIVE\]/i,
          /^\[CONFLICT\]/i,
          /Не удалось загрузить данные с сервера/i,
          /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
        ]
      });
      expectNoCriticalClientFailures(diagnosticsTwo, {
        ignoreConsolePatterns: [
          /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
          /^\[LIVE\]/i,
          /Не удалось загрузить данные с сервера/i,
          /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
        ]
      });
    } finally {
      await contextTwo.close();
    }
  });

  test('does not expose the removed legacy directory modal on /cards', async ({ page }) => {
    const diagnostics = attachDiagnostics(page);

    await loginAsAbyss(page, { startPath: '/cards' });
    await waitUsableUi(page, '/cards');

    await expect(page.locator('#directory-modal')).toHaveCount(0);
    const legacyApi = await page.evaluate(() => ({
      openDirectoryModal: typeof window.openDirectoryModal,
      closeDirectoryModal: typeof window.closeDirectoryModal
    }));
    expect(legacyApi).toEqual({
      openDirectoryModal: 'undefined',
      closeDirectoryModal: 'undefined'
    });
    await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe('/cards');

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
