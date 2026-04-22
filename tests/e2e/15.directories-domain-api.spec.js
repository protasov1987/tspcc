const { test, expect } = require('@playwright/test');
const { resetDatabaseFromSnapshot } = require('./helpers/snapshot');
const { restartServer, stopServer } = require('./helpers/server');
const { attachDiagnostics, expectNoCriticalClientFailures } = require('./helpers/diagnostics');
const { loginAsAbyss } = require('./helpers/auth');
const { openRouteAndAssert, waitUsableUi } = require('./helpers/navigation');

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
  return page.locator(`${wrapperSelector} tbody tr`).filter({ hasText: text }).first();
}

async function waitForBackgroundHydration(page) {
  await expect.poll(() => page.evaluate(() => (
    typeof isBackgroundHydrationInFlight === 'function'
      ? isBackgroundHydrationInFlight() === false
      : true
  ))).toBe(true);
}

async function createDepartment(page, name, desc = '') {
  await waitForBackgroundHydration(page);
  await page.fill('#departments-name', name);
  await page.fill('#departments-desc', desc);
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && response.url().includes('/api/directories/departments')
    && response.status() === 201
  ));
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
  await page.fill('#departments-name', nextName);
  await page.fill('#departments-desc', nextDesc);
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'PUT'
    && response.url().includes('/api/directories/departments/')
    && response.status() === 200
  ));
  await page.click('#departments-submit');
  await responsePromise;
  await expect(await findTableRowByText(page, '#departments-table-wrapper', nextName)).toBeVisible();
}

async function createArea(page, name, desc = '', type = 'Производство') {
  await waitForBackgroundHydration(page);
  await page.fill('#areas-name', name);
  await page.fill('#areas-desc', desc);
  await page.selectOption('#areas-type', type);
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && response.url().includes('/api/directories/areas')
    && response.status() === 201
  ));
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
  await page.fill('#areas-name', nextName);
  await page.fill('#areas-desc', nextDesc);
  await page.selectOption('#areas-type', nextType);
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'PUT'
    && response.url().includes('/api/directories/areas/')
    && response.status() === 200
  ));
  await page.click('#areas-submit');
  await responsePromise;
  await expect(await findTableRowByText(page, '#areas-table-wrapper', nextName)).toBeVisible();
}

async function createOperation(page, name, desc = '', recTime = '45', type = 'Стандартная') {
  await waitForBackgroundHydration(page);
  await page.fill('#operations-name', name);
  await page.fill('#operations-desc', desc);
  await page.fill('#operations-time', recTime);
  await page.selectOption('#operations-type', type);
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && response.url().includes('/api/directories/operations')
    && response.status() === 201
  ));
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
  await page.fill('#operations-name', nextName);
  await page.fill('#operations-desc', nextDesc);
  await page.fill('#operations-time', recTime);
  await page.selectOption('#operations-type', type);
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'PUT'
    && response.url().includes('/api/directories/operations/')
    && response.status() === 200
  ));
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
  ));
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
  ));
  page.once('dialog', async (dialog) => dialog.accept());
  await removeButton.click();
  await responsePromise;
  await expect(row.locator('.op-area-pill').filter({ hasText: areaName })).toHaveCount(0);
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
});
