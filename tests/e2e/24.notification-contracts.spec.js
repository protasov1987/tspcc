const { test, expect } = require('@playwright/test');
const { resetDatabaseFromSnapshot } = require('./helpers/snapshot');
const { restartServer, stopServer } = require('./helpers/server');
const { loginAsAbyss } = require('./helpers/auth');
const { loadSnapshotDb, getFirstOtherUser, getUserByName } = require('./helpers/db');

const WEBPUSH_TEST_ENV = {
  WEBPUSH_VAPID_PUBLIC: 'BBzMaGbGyr4AK4615dq8Zs3DlaGuUaLG8Eb3uki1RkiB7OgPAowYVLy1NNf9dT55qkkT5hNGpAKbEQjbFK82NMw',
  WEBPUSH_VAPID_PRIVATE: 'LvLeud9iAgLtPFb1eSTJZQEXOQPahWA4mpweDnLDwCM',
  WEBPUSH_VAPID_SUBJECT: 'mailto:admin@tspcc.ru',
  FCM_SERVER_KEY: 'playwright-fcm-server-key'
};

function getNotificationFixture() {
  const db = loadSnapshotDb();
  const me = getUserByName(db, 'Abyss');
  const foreignSubscriptionUserId = (db.webPushSubscriptions || [])
    .map((entry) => String(entry?.userId || '').trim())
    .find((userId) => userId && userId !== String(me?.id || ''));
  const foreignWithWebPush = foreignSubscriptionUserId
    ? (db.users || []).find((user) => String(user?.id || '') === foreignSubscriptionUserId)
    : null;
  const foreign = foreignWithWebPush || getFirstOtherUser(db, 'Abyss');
  return { me, foreign };
}

async function readData(page) {
  return page.evaluate(async () => {
    const res = await apiFetch('/api/data');
    return res.json();
  });
}

test.describe.serial('Notification ownership contracts', () => {
  const previousEnv = {};

  test.beforeAll(async () => {
    Object.keys(WEBPUSH_TEST_ENV).forEach((key) => {
      previousEnv[key] = process.env[key];
      process.env[key] = WEBPUSH_TEST_ENV[key];
    });
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
  });

  test.afterAll(async () => {
    await stopServer();
    Object.keys(WEBPUSH_TEST_ENV).forEach((key) => {
      if (previousEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousEnv[key];
      }
    });
  });

  test('keeps WebPush subscribe and unsubscribe owned by the current user', async ({ page }) => {
    const { me, foreign } = getNotificationFixture();
    expect(me?.id).toBeTruthy();
    expect(foreign?.id).toBeTruthy();
    await loginAsAbyss(page);

    const invalidSubscribe = await page.evaluate(async () => {
      const res = await apiFetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: { endpoint: '' } })
      });
      return res.status;
    });
    expect(invalidSubscribe).toBe(400);

    const endpoint = `https://push.example.test/stage11-${Date.now()}`;
    const subscribeResult = await page.evaluate(async ({ endpoint, foreignId }) => {
      const res = await apiFetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: foreignId,
          subscription: {
            endpoint,
            keys: {
              p256dh: 'stage11-p256dh',
              auth: 'stage11-auth'
            }
          },
          userAgent: 'stage11-test-agent'
        })
      });
      return res.status;
    }, { endpoint, foreignId: foreign.id });
    expect(subscribeResult).toBe(200);

    let data = await readData(page);
    let matching = (data.webPushSubscriptions || []).filter((entry) => entry?.endpoint === endpoint);
    expect(matching).toHaveLength(1);
    expect(matching[0].userId).toBe(me.id);

    const snapshotEndpoint = `https://push.example.test/stage11-snapshot-${Date.now()}`;
    const snapshotWriteStatus = await page.evaluate(async ({ snapshotEndpoint, foreignId }) => {
      const res = await apiFetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webPushSubscriptions: [{
            id: 'stage11-foreign-webpush',
            userId: foreignId,
            endpoint: snapshotEndpoint,
            keys: { p256dh: 'foreign-p256dh', auth: 'foreign-auth' },
            subscription: { endpoint: snapshotEndpoint, keys: { p256dh: 'foreign-p256dh', auth: 'foreign-auth' } },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            userAgent: 'foreign-test-agent'
          }]
        })
      });
      return res.status;
    }, { snapshotEndpoint, foreignId: foreign.id });
    expect(snapshotWriteStatus).toBe(200);

    const unsubscribeResult = await page.evaluate(async (endpoint) => {
      const res = await apiFetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint })
      });
      return res.status;
    }, endpoint);
    expect(unsubscribeResult).toBe(200);

    data = await readData(page);
    matching = (data.webPushSubscriptions || []).filter((entry) => entry?.endpoint === endpoint);
    expect(matching).toHaveLength(0);
    expect((data.webPushSubscriptions || []).some((entry) => entry?.endpoint === snapshotEndpoint)).toBe(false);

    const foreignEndpoint = (data.webPushSubscriptions || []).find((entry) => entry?.userId === foreign.id)?.endpoint;
    expect(foreignEndpoint).toBeTruthy();
    const foreignUnsubscribeResult = await page.evaluate(async (endpoint) => {
      const res = await apiFetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint })
      });
      return res.status;
    }, foreignEndpoint);
    expect(foreignUnsubscribeResult).toBe(200);
    data = await readData(page);
    expect((data.webPushSubscriptions || []).some((entry) => entry?.endpoint === foreignEndpoint && entry?.userId === foreign.id)).toBe(true);
  });

  test('rejects foreign WebPush test targets and returns a profile deeplink for own test push', async ({ page }) => {
    const { me, foreign } = getNotificationFixture();
    expect(me?.id).toBeTruthy();
    expect(foreign?.id).toBeTruthy();
    await loginAsAbyss(page);

    const foreignResult = await page.evaluate(async (foreignId) => {
      const res = await apiFetch('/api/push/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: foreignId })
      });
      const body = await res.json().catch(() => ({}));
      return { status: res.status, body };
    }, foreign.id);
    expect(foreignResult.status).toBe(403);
    expect(foreignResult.body.error).toContain('Нет доступа');

    const ownResult = await page.evaluate(async (meId) => {
      const res = await apiFetch('/api/push/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: meId })
      });
      const body = await res.json().catch(() => ({}));
      return { status: res.status, body };
    }, me.id);
    expect(ownResult.status).toBe(200);
    expect(ownResult.body.url).toBe(`/profile/${encodeURIComponent(me.id)}?openChatWith=system`);
  });

  test('stores FCM tokens only for the authenticated current user', async ({ page }) => {
    const { me, foreign } = getNotificationFixture();
    expect(me?.id).toBeTruthy();
    expect(foreign?.id).toBeTruthy();
    await loginAsAbyss(page);

    const invalidToken = await page.evaluate(async () => {
      const res = await apiFetch('/api/fcm/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: '' })
      });
      return res.status;
    });
    expect(invalidToken).toBe(400);

    const token = `stage11-fcm-${Date.now()}`;
    const snapshotToken = `stage11-fcm-snapshot-${Date.now()}`;
    const snapshotWriteStatus = await page.evaluate(async ({ token, foreignId }) => {
      const res = await apiFetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fcmTokens: [{
            id: 'stage11-foreign-fcm',
            userId: foreignId,
            token,
            platform: 'android',
            device: 'Snapshot'
          }]
        })
      });
      return res.status;
    }, { token: snapshotToken, foreignId: foreign.id });
    expect(snapshotWriteStatus).toBe(200);

    const subscribeResult = await page.evaluate(async ({ token, foreignId }) => {
      const res = await apiFetch('/api/fcm/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: foreignId,
          token,
          platform: 'android',
          device: 'Playwright'
        })
      });
      return res.status;
    }, { token, foreignId: foreign.id });
    expect(subscribeResult).toBe(200);

    const data = await readData(page);
    expect((data.fcmTokens || []).some((entry) => entry?.token === snapshotToken)).toBe(false);
    const matching = (data.fcmTokens || []).filter((entry) => entry?.token === token);
    expect(matching).toHaveLength(1);
    expect(matching[0]).toMatchObject({
      userId: me.id,
      token,
      platform: 'android',
      device: 'Playwright'
    });
  });
});
