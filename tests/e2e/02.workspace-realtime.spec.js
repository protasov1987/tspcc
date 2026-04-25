const { test, expect } = require('@playwright/test');
const { resetDatabaseFromSnapshot } = require('./helpers/snapshot');
const { restartServer, stopServer } = require('./helpers/server');
const { expectNoCriticalClientFailures, findConsoleEntries, resetDiagnostics } = require('./helpers/diagnostics');
const { createLoggedInClient, closeClients } = require('./helpers/multiclient');
const { baseURL } = require('./helpers/paths');
const WorkspaceFlow = require('./flows/workspace.flow');

const WORKSPACE_REALTIME_TWO_CLIENT_SLA_MS = 1500;
const WORKSPACE_REALTIME_MULTI_CLIENT_SLA_MS = 4500;
const WORKSPACE_REALTIME_IGNORE_CONSOLE_PATTERNS = [
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

async function readWorkspaceCardQr(page, cardId) {
  return page.evaluate((targetCardId) => {
    const cardList = typeof cards !== 'undefined' ? cards : [];
    const card = cardList.find((item) => item && item.id === targetCardId);
    if (card?.qrId) return String(card.qrId).trim();
    const cardEl = document.querySelector(`details.workspace-card[data-card-id="${targetCardId}"]`);
    const qrText = [...(cardEl?.querySelectorAll('.muted') || [])]
      .map((el) => (el.textContent || '').trim())
      .find((text) => /^QR:\s+/i.test(text));
    return qrText ? qrText.replace(/^QR:\s+/i, '').trim() : '';
  }, cardId);
}

async function openWorkspaceDetail(client, routePath, cardId) {
  await client.page.goto(baseURL + routePath, { waitUntil: 'domcontentloaded' });
  await expect.poll(() => new URL(client.page.url()).pathname).toBe(routePath);
  await expect(client.page.locator(`details.workspace-card[data-card-id="${cardId}"]`).first()).toBeVisible();
  resetDiagnostics(client.diagnostics);
}

async function findDirectWorkspaceActionTarget(page, actionNames = ['pause', 'start']) {
  return page.evaluate((actions) => {
    const cardList = typeof cards !== 'undefined' ? cards : [];
    for (const button of document.querySelectorAll('details.workspace-card button[data-action][data-op-id]')) {
      const action = button.getAttribute('data-action') || '';
      if (!actions.includes(action) || button.disabled) continue;
      const cardId = button.getAttribute('data-card-id') || '';
      const opId = button.getAttribute('data-op-id') || '';
      const personalOperationId = button.getAttribute('data-personal-op-id') || '';
      if (!cardId || !opId) continue;
      const card = cardList.find((item) => item && item.id === cardId);
      const op = (card?.operations || []).find((item) => item && item.id === opId);
      if (!card || !op) continue;
      if (
        action === 'start'
        && !personalOperationId
        && typeof isIndividualOperationUi === 'function'
        && isIndividualOperationUi(card, op)
      ) continue;
      if (!card.qrId) continue;
      return {
        cardId,
        opId,
        personalOperationId,
        action,
        qr: String(card.qrId).trim()
      };
    }
    return null;
  }, actionNames);
}

test.describe.serial('Workspace realtime and multi-device', () => {
  test.beforeAll(async () => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
  });

  test.afterAll(async () => {
    await stopServer();
  });

  test('propagates workspace action between two live clients without F5', async ({ browser }) => {
    const clients = [
      await buildWorkspaceClient(browser),
      await buildWorkspaceClient(browser)
    ];

    try {
      const actor = clients[0];
      const observer = clients[1];
      const target = await actor.flow.getFirstCardWithAction(['pause', 'start']);
      test.skip(!target, 'Нет доступной МК для realtime-проверки рабочего места');

      const observerBefore = await observer.flow.readCardActionState(target.cardId);
      const startedAt = Date.now();
      await actor.flow.performCardAction(target.cardId, target.action);
      await observer.flow.waitForCardStateChange(target.cardId, observerBefore.text);
      const totalMs = Date.now() - startedAt;

      expect(totalMs).toBeLessThanOrEqual(WORKSPACE_REALTIME_TWO_CLIENT_SLA_MS);
      expectNoCriticalClientFailures(actor.diagnostics, {
        allow409: false,
        ignoreConsolePatterns: WORKSPACE_REALTIME_IGNORE_CONSOLE_PATTERNS
      });
      expectNoCriticalClientFailures(observer.diagnostics, {
        allow409: false,
        ignoreConsolePatterns: WORKSPACE_REALTIME_IGNORE_CONSOLE_PATTERNS
      });
    } finally {
      await closeClients(clients);
    }
  });

  test('keeps same-user multi-device clients consistent during concurrent action attempt', async ({ browser }) => {
    const clients = [
      await buildWorkspaceClient(browser),
      await buildWorkspaceClient(browser)
    ];

    try {
      const clientA = clients[0];
      const clientB = clients[1];
      const target = await clientA.flow.getFirstCardWithAction(['pause', 'start']);
      test.skip(!target, 'Нет доступной МК для concurrent same-user сценария');

      const beforeA = await clientA.flow.readCardActionState(target.cardId);
      const beforeB = await clientB.flow.readCardActionState(target.cardId);

      await Promise.allSettled([
        clientA.flow.performCardAction(target.cardId, target.action),
        clientB.flow.performCardAction(target.cardId, target.action)
      ]);

      await expect.poll(async () => {
        const [stateA, stateB] = await Promise.all([
          clientA.flow.readCardActionState(target.cardId),
          clientB.flow.readCardActionState(target.cardId)
        ]);
        return JSON.stringify({
          a: stateA?.text || '',
          b: stateB?.text || ''
        });
      }).not.toBe(JSON.stringify({ a: beforeA.text, b: beforeB.text }));

      await expect.poll(async () => {
        const [stateA, stateB] = await Promise.all([
          clientA.flow.readCardActionState(target.cardId),
          clientB.flow.readCardActionState(target.cardId)
        ]);
        return (stateA?.text || '') === (stateB?.text || '');
      }).toBe(true);

      await expect.poll(() => new URL(clientA.page.url()).pathname).toBe('/workspace');
      await expect.poll(() => new URL(clientB.page.url()).pathname).toBe('/workspace');
      await expect.poll(() => {
        const responses = [...clientA.diagnostics.responses, ...clientB.diagnostics.responses];
        return responses.filter((entry) => entry.status === 409 && /\/api\/production\/(?:operation\/|personal-operation\/action)/i.test(entry.url || '')).length;
      }).toBeGreaterThan(0);
      await expect.poll(() => {
        return findConsoleEntries(clientA.diagnostics, /^\[DATA\] client write start/i).length
          + findConsoleEntries(clientB.diagnostics, /^\[DATA\] client write start/i).length;
      }).toBeGreaterThan(0);
      await expect.poll(() => {
        return findConsoleEntries(clientA.diagnostics, /^\[CONFLICT\] conflict detected/i).length
          + findConsoleEntries(clientB.diagnostics, /^\[CONFLICT\] conflict detected/i).length;
      }).toBeGreaterThan(0);
      await expect.poll(() => {
        return findConsoleEntries(clientA.diagnostics, /fallback refresh start/i).length
          + findConsoleEntries(clientB.diagnostics, /fallback refresh start/i).length;
      }).toBeGreaterThan(0);

      expectNoCriticalClientFailures(clientA.diagnostics, {
        allow409: true,
        ignoreConsolePatterns: WORKSPACE_REALTIME_IGNORE_CONSOLE_PATTERNS
      });
      expectNoCriticalClientFailures(clientB.diagnostics, {
        allow409: true,
        ignoreConsolePatterns: WORKSPACE_REALTIME_IGNORE_CONSOLE_PATTERNS
      });
    } finally {
      await closeClients(clients);
    }
  });

  test('keeps /workspace/:qr during real concurrent workspace action conflict', async ({ browser }) => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
    const clients = [
      await buildWorkspaceClient(browser),
      await buildWorkspaceClient(browser)
    ];

    try {
      const clientA = clients[0];
      const clientB = clients[1];
      const target = await findDirectWorkspaceActionTarget(clientA.page, ['pause', 'start']);
      test.skip(!target?.opId, 'Нет доступной МК для concurrent /workspace/:qr сценария');
      const qr = target.qr || await readWorkspaceCardQr(clientA.page, target.cardId);
      test.skip(!qr, 'Не найден QR для /workspace/:qr сценария');
      const routePath = `/workspace/${encodeURIComponent(qr)}`;

      await Promise.all([
        openWorkspaceDetail(clientA, routePath, target.cardId),
        openWorkspaceDetail(clientB, routePath, target.cardId)
      ]);

      const beforeA = await clientA.flow.readOperationActionArea(target.cardId, target.opId);
      const beforeB = await clientB.flow.readOperationActionArea(target.cardId, target.opId);

      await Promise.allSettled([
        clientA.flow.performCardAction(target.cardId, target.action, { opId: target.opId }),
        clientB.flow.performCardAction(target.cardId, target.action, { opId: target.opId })
      ]);

      await expect.poll(async () => {
        const [stateA, stateB] = await Promise.all([
          clientA.flow.readOperationActionArea(target.cardId, target.opId),
          clientB.flow.readOperationActionArea(target.cardId, target.opId)
        ]);
        return JSON.stringify({
          a: stateA?.signature || '',
          b: stateB?.signature || ''
        });
      }).not.toBe(JSON.stringify({
        a: beforeA?.signature || '',
        b: beforeB?.signature || ''
      }));

      await expect.poll(() => new URL(clientA.page.url()).pathname).toBe(routePath);
      await expect.poll(() => new URL(clientB.page.url()).pathname).toBe(routePath);
      await expect.poll(() => {
        const responses = [...clientA.diagnostics.responses, ...clientB.diagnostics.responses];
        return responses.filter((entry) => entry.status === 409 && /\/api\/production\/operation\//i.test(entry.url || '')).length;
      }).toBeGreaterThan(0);
      await expect.poll(() => {
        return findConsoleEntries(clientA.diagnostics, /fallback refresh start/i).length
          + findConsoleEntries(clientB.diagnostics, /fallback refresh start/i).length;
      }).toBeGreaterThan(0);

      expectNoCriticalClientFailures(clientA.diagnostics, {
        allow409: true,
        ignoreConsolePatterns: WORKSPACE_REALTIME_IGNORE_CONSOLE_PATTERNS
      });
      expectNoCriticalClientFailures(clientB.diagnostics, {
        allow409: true,
        ignoreConsolePatterns: WORKSPACE_REALTIME_IGNORE_CONSOLE_PATTERNS
      });
    } finally {
      await closeClients(clients);
    }
  });

  test('supports 20 concurrent live clients observing one confirmed change', async ({ browser }) => {
    test.setTimeout(240000);
    const clients = [];
    for (let i = 0; i < 20; i += 1) {
      clients.push(await buildWorkspaceClient(browser));
    }

    try {
      const actor = clients[0];
      const observers = clients.slice(1);
      const target = await actor.flow.getFirstCardWithAction(['pause', 'start']);
      test.skip(!target, 'Нет доступной МК для 20-клиентского сценария');

      const beforeTexts = await Promise.all(observers.map((client) => client.flow.readCardActionState(target.cardId).then((state) => state?.text || '')));
      const startedAt = Date.now();
      await actor.flow.performCardAction(target.cardId, target.action);

      const observedLatencies = await Promise.all(observers.map(async (client, index) => {
        const previousText = beforeTexts[index];
        await client.flow.waitForCardStateChange(target.cardId, previousText);
        return Date.now() - startedAt;
      }));

      expect(Math.max(...observedLatencies)).toBeLessThanOrEqual(WORKSPACE_REALTIME_MULTI_CLIENT_SLA_MS);
      for (const client of clients) {
        expectNoCriticalClientFailures(client.diagnostics, {
          allow409: false,
          ignoreConsolePatterns: WORKSPACE_REALTIME_IGNORE_CONSOLE_PATTERNS
        });
      }
    } finally {
      await closeClients(clients);
    }
  });
});
