const { test, expect } = require('@playwright/test');
const { resetDatabaseFromSnapshot } = require('./helpers/snapshot');
const { restartServer, stopServer } = require('./helpers/server');
const { expectNoCriticalClientFailures } = require('./helpers/diagnostics');
const { createLoggedInClient, closeClients } = require('./helpers/multiclient');
const { baseURL } = require('./helpers/paths');
const WorkspaceFlow = require('./flows/workspace.flow');

const WORKSPACE_REALTIME_TWO_CLIENT_SLA_MS = 1500;
const WORKSPACE_REALTIME_MULTI_CLIENT_SLA_MS = 2000;

async function buildWorkspaceClient(browser) {
  const client = await createLoggedInClient(browser, { baseURL, route: '/workspace' });
  client.flow = new WorkspaceFlow(client.page);
  await client.flow.openPage();
  return client;
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
      expectNoCriticalClientFailures(actor.diagnostics, { allow409: false });
      expectNoCriticalClientFailures(observer.diagnostics, { allow409: false });
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

      expectNoCriticalClientFailures(clientA.diagnostics, { allow409: true });
      expectNoCriticalClientFailures(clientB.diagnostics, { allow409: true });
    } finally {
      await closeClients(clients);
    }
  });

  test('supports 20 concurrent live clients observing one confirmed change', async ({ browser }) => {
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
        expectNoCriticalClientFailures(client.diagnostics, { allow409: false });
      }
    } finally {
      await closeClients(clients);
    }
  });
});
