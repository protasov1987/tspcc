const fs = require('fs');
const path = require('path');
const { test, expect, request: playwrightRequest } = require('@playwright/test');
const { resetDatabaseFromSnapshot } = require('./helpers/snapshot');
const { restartServer, stopServer } = require('./helpers/server');

const ROOT = path.resolve(__dirname, '../..');

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

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function listJsFiles(dir) {
  const absoluteDir = path.join(ROOT, dir);
  return fs.readdirSync(absoluteDir, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listJsFiles(relativePath);
    return entry.isFile() && entry.name.endsWith('.js') ? [relativePath] : [];
  });
}

function findLineMatches(relativePath, pattern) {
  return readProjectFile(relativePath)
    .split(/\r?\n/)
    .map((line, index) => ({ relativePath, line, lineNumber: index + 1 }))
    .filter((entry) => pattern.test(entry.line));
}

test.describe.serial('stage 13 removal-path contract', () => {
  test.beforeAll(async () => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
  });

  test.afterAll(async () => {
    await stopServer();
  });

  test('keeps legacy snapshot POST from overwriting protected migrated slices', async ({}, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const { api, csrfToken } = await loginApi(baseURL);

    try {
      const beforeResponse = await api.get('/api/data');
      expect(beforeResponse.ok()).toBeTruthy();
      const before = await beforeResponse.json();
      const beforeDomainRevisions = JSON.stringify(before.meta?.domainRevisions || {});
      const marker = `stage13-batch8-${Date.now()}`;

      const snapshotResponse = await api.post('/api/data', {
        headers: {
          'x-csrf-token': csrfToken,
          'Content-Type': 'application/json'
        },
        data: {
          ops: [{ id: marker, name: marker }],
          centers: [{ id: marker, name: marker }],
          areas: [{ id: marker, name: marker }],
          users: [{ id: marker, name: marker, login: marker }],
          accessLevels: [{ id: marker, name: marker, permissions: {} }],
          messages: [{ id: marker, text: marker }],
          userActions: [{ id: marker, userId: marker, text: marker }],
          userVisits: [{ id: marker, userId: marker, routePath: '/profile/' + marker }],
          chatConversations: [{ id: marker, participantIds: [marker] }],
          chatMessages: [{ id: marker, conversationId: marker, text: marker }],
          chatStates: [{ conversationId: marker, userId: marker, marker }],
          webPushSubscriptions: [{ id: marker, userId: marker }],
          fcmTokens: [{ id: marker, userId: marker, token: marker }],
          productionSchedule: [{ id: marker, assignmentStatus: marker }],
          productionShiftTimes: [{ id: marker, name: marker }],
          productionShiftTasks: [{ id: marker, cardId: marker }],
          productionShifts: [{ id: marker, openedBy: marker }],
          meta: {
            revision: Number(before.meta?.revision || 0) + 1000,
            domainRevisions: {
              ...(before.meta?.domainRevisions || {}),
              productionPlanning: Number(before.meta?.domainRevisions?.productionPlanning || 0) + 1000,
              security: Number(before.meta?.domainRevisions?.security || 0) + 1000
            }
          }
        }
      });
      expect(snapshotResponse.ok()).toBeTruthy();

      const afterResponse = await api.get('/api/data');
      expect(afterResponse.ok()).toBeTruthy();
      const after = await afterResponse.json();
      const protectedSlices = [
        'ops',
        'centers',
        'areas',
        'users',
        'accessLevels',
        'messages',
        'userActions',
        'userVisits',
        'chatConversations',
        'chatMessages',
        'chatStates',
        'webPushSubscriptions',
        'fcmTokens',
        'productionSchedule',
        'productionShiftTimes',
        'productionShiftTasks',
        'productionShifts'
      ];

      for (const key of protectedSlices) {
        expect(JSON.stringify(after[key] || [])).not.toContain(marker);
      }
      expect(JSON.stringify(after.meta?.domainRevisions || {})).toBe(beforeDomainRevisions);
    } finally {
      await api.dispose();
    }
  });

  test('keeps removed messaging and legacy client adapters from becoming active write paths', async () => {
    const serverSource = readProjectFile('server.js');
    expect(serverSource).not.toContain('/api/messages');

    const jsFiles = listJsFiles('js');
    const saveDataMatches = jsFiles.flatMap((file) => (
      findLineMatches(file, /\bsaveData\s*\(/)
        .filter((entry) => !entry.line.trim().startsWith('//'))
    ));
    expect(saveDataMatches).toEqual([
      expect.objectContaining({
        relativePath: path.join('js', 'app.40.store.js'),
        line: expect.stringMatching(/async function saveData\s*\(/)
      })
    ]);

    const apiEndpointMatches = jsFiles.flatMap((file) => findLineMatches(file, /\bAPI_ENDPOINT\b/));
    expect(apiEndpointMatches).toEqual([
      expect.objectContaining({
        relativePath: path.join('js', 'app.00.state.js'),
        line: expect.stringMatching(/const API_ENDPOINT = LEGACY_SNAPSHOT_API_PATH/)
      })
    ]);
  });
});
