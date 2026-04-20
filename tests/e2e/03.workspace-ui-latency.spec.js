const { test, expect } = require('@playwright/test');
const { resetDatabaseFromSnapshot } = require('./helpers/snapshot');
const { restartServer, stopServer } = require('./helpers/server');
const { expectNoCriticalClientFailures, resetDiagnostics } = require('./helpers/diagnostics');
const { createLoggedInClient, closeClients } = require('./helpers/multiclient');
const { baseURL } = require('./helpers/paths');
const WorkspaceFlow = require('./flows/workspace.flow');

const WORKSPACE_UI_LATENCY_IGNORE_CONSOLE_PATTERNS = [
  /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
  /^\[LIVE\]/i,
  /Не удалось загрузить данные с сервера/i,
  /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
];

async function buildWorkspaceClient(browser) {
  const client = await createLoggedInClient(browser, { baseURL, route: null });
  client.flow = new WorkspaceFlow(client.page);
  await client.flow.openPage();
  resetDiagnostics(client.diagnostics);
  return client;
}

function logMeasurement(measurement) {
  const modalExtra = measurement.modalOpenMs == null ? '' : ` modalOpenMs=${measurement.modalOpenMs}`;
  const pendingExtra = measurement.pendingMs == null ? '' : ` pendingMs=${measurement.pendingMs}`;
  console.log(`[WORKSPACE_UI_LATENCY] action=${measurement.action} mode=${measurement.mode} totalMs=${measurement.totalMs}${modalExtra}${pendingExtra}`);
}

async function attachMeasurements(testInfo, name, measurements) {
  await testInfo.attach(name, {
    body: JSON.stringify(measurements, null, 2),
    contentType: 'application/json'
  });
}

async function resolveVisibleTransferCommitButton(page) {
  for (const selector of ['#workspace-transfer-confirm', '#workspace-transfer-submit']) {
    const locator = page.locator(selector);
    if (await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }
  return null;
}

async function measureDirectActionLatency(client, action) {
  const { page, flow } = client;
  const target = await flow.getFirstCardWithAction([action]);
  if (!target) return null;
  if (!target.opId) return null;

  const beforeArea = await flow.readOperationActionArea(target.cardId, target.opId);
  const transferModal = page.locator('#workspace-transfer-modal');
  const clickStartedAt = Date.now();
  await flow.performCardAction(target.cardId, action, { opId: target.opId });
  let pendingMs = null;
  if (!await transferModal.isVisible().catch(() => false)) {
    await flow.waitForOperationPendingState(target.cardId, target.opId, action);
    pendingMs = Date.now() - clickStartedAt;
  }

  if (await transferModal.isVisible().catch(() => false)) {
    const allGoodBtn = page.locator('#workspace-transfer-all-good');
    const items = page.locator('#workspace-transfer-list .workspace-transfer-item');
    const commitBtn = await resolveVisibleTransferCommitButton(page);
    await expect(allGoodBtn).toBeVisible();
    expect(commitBtn, 'Не найдена видимая commit-кнопка в workspace transfer modal').not.toBeNull();
    if ((await items.count()) === 0) {
      await page.locator('#workspace-transfer-cancel').click();
      await expect(transferModal).toBeHidden();
      return null;
    }
    await allGoodBtn.click();
    const commitStartedAt = Date.now();
    await commitBtn.click();
    await expect(transferModal).toBeHidden();
    await flow.waitForOperationActionAreaChange(target.cardId, target.opId, beforeArea?.signature || '');
    const measurement = {
      action,
      mode: 'modal-confirm',
      cardId: target.cardId,
      opId: target.opId,
      totalMs: Date.now() - commitStartedAt,
      modalOpenMs: commitStartedAt - clickStartedAt,
      pendingMs
    };
    logMeasurement(measurement);
    return measurement;
  }

  await flow.waitForOperationActionAreaChange(target.cardId, target.opId, beforeArea?.signature || '');
  const measurement = {
    action,
    mode: 'direct',
    cardId: target.cardId,
    opId: target.opId,
    totalMs: Date.now() - clickStartedAt,
    pendingMs
  };
  logMeasurement(measurement);
  return measurement;
}

async function openStopFlow(client) {
  const target = await client.flow.getFirstCardWithAction(['stop']);
  if (!target) return null;
  const beforeArea = target.opId
    ? await client.flow.readOperationActionArea(target.cardId, target.opId)
    : null;
  await client.flow.performCardAction(target.cardId, 'stop', { opId: target.opId });
  await expect(client.page.locator('#workspace-transfer-modal')).toBeVisible();
  return { target, beforeArea };
}

async function resolveDryingRow(page) {
  return page.evaluate(() => {
    const row = document.querySelector('#drying-table-wrapper tr[data-status="NOT_STARTED"]');
    if (!row) return null;
    const rowId = row.getAttribute('data-row-id') || '';
    const qtyInput = row.querySelector('.drying-qty-input');
    const qtyCell = row.children?.[2]?.textContent || '';
    const qty = (qtyInput?.value || qtyCell || '').toString().trim();
    const action = row.querySelector('.drying-row-action')?.getAttribute('data-action') || '';
    const status = row.getAttribute('data-status') || '';
    return {
      rowId,
      qty,
      fingerprint: `${status}|${action}`
    };
  });
}

test.describe.serial('Workspace same-client UI latency', () => {
  test.beforeEach(async () => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
  });

  test.afterEach(async () => {
    await stopServer();
  });

  test('measures direct workspace action latency on the same client', async ({ browser }, testInfo) => {
    const clients = [await buildWorkspaceClient(browser)];
    try {
      const client = clients[0];
      const measurements = [];

      for (const action of ['start', 'pause', 'resume']) {
        const measurement = await measureDirectActionLatency(client, action);
        if (measurement) measurements.push(measurement);
      }

      test.skip(!measurements.length, 'Нет доступных direct action-кнопок для замера на /workspace');
      await attachMeasurements(testInfo, 'workspace-ui-latency-direct.json', measurements);

      expectNoCriticalClientFailures(client.diagnostics, {
        allow409: false,
        ignoreConsolePatterns: WORKSPACE_UI_LATENCY_IGNORE_CONSOLE_PATTERNS
      });
    } finally {
      await closeClients(clients);
    }
  });

  test('measures stop confirm latency on the same client', async ({ browser }, testInfo) => {
    const clients = [await buildWorkspaceClient(browser)];
    try {
      const client = clients[0];
      const flowState = await openStopFlow(client);
      test.skip(!flowState, 'Нет доступной кнопки Завершить для замера на /workspace');

      const { target, beforeArea } = flowState;
      const items = client.page.locator('#workspace-transfer-list .workspace-transfer-item');
      const commitBtn = await resolveVisibleTransferCommitButton(client.page);
      test.skip((await items.count()) === 0, 'В stop-flow нет изделий для подтверждения');
      expect(commitBtn, 'Не найдена видимая commit-кнопка в stop-flow').not.toBeNull();

      await client.page.locator('#workspace-transfer-all-good').click();

      const startedAt = Date.now();
      await commitBtn.click();
      await expect(client.page.locator('#workspace-transfer-modal')).toBeHidden();
      await client.flow.waitForOperationActionAreaChange(target.cardId, target.opId, beforeArea?.signature || '');

      const measurement = {
        action: 'stop',
        mode: 'modal-confirm',
        cardId: target.cardId,
        opId: target.opId,
        totalMs: Date.now() - startedAt
      };
      logMeasurement(measurement);
      await attachMeasurements(testInfo, 'workspace-ui-latency-stop.json', [measurement]);

      expectNoCriticalClientFailures(client.diagnostics, {
        allow409: false,
        ignoreConsolePatterns: WORKSPACE_UI_LATENCY_IGNORE_CONSOLE_PATTERNS
      });
    } finally {
      await closeClients(clients);
    }
  });

  test('measures drying row start latency on the same client', async ({ browser }, testInfo) => {
    const clients = [await buildWorkspaceClient(browser)];
    try {
      const client = clients[0];
      const target = await client.flow.getFirstCardWithAction(['drying']);
      test.skip(!target, 'Нет доступной кнопки Сушить для замера на /workspace');

      await client.flow.performCardAction(target.cardId, 'drying', { opId: target.opId });
      await expect(client.page.locator('#drying-modal')).toBeVisible();

      const row = await resolveDryingRow(client.page);
      test.skip(!row?.rowId, 'В drying-flow нет строки, которую можно запустить');

      const qtyValue = row.qty || '1';
      await client.page.locator(`.drying-qty-input[data-row-id="${row.rowId}"]`).fill(qtyValue);

      const startedAt = Date.now();
      await client.page.locator(`.drying-row-action[data-action="start"][data-row-id="${row.rowId}"]`).click();
      await expect.poll(async () => client.page.evaluate((rowId) => {
        const currentRow = document.querySelector(`#drying-table-wrapper tr[data-row-id="${rowId}"]`);
        if (!currentRow) return '__missing__';
        const status = currentRow.getAttribute('data-status') || '';
        const action = currentRow.querySelector('.drying-row-action')?.getAttribute('data-action') || '';
        return `${status}|${action}`;
      }, row.rowId)).not.toBe(row.fingerprint);

      const measurement = {
        action: 'drying',
        mode: 'row-start',
        cardId: target.cardId,
        rowId: row.rowId,
        totalMs: Date.now() - startedAt
      };
      logMeasurement(measurement);
      await attachMeasurements(testInfo, 'workspace-ui-latency-drying.json', [measurement]);

      expectNoCriticalClientFailures(client.diagnostics, {
        allow409: false,
        ignoreConsolePatterns: WORKSPACE_UI_LATENCY_IGNORE_CONSOLE_PATTERNS
      });
    } finally {
      await closeClients(clients);
    }
  });
});
