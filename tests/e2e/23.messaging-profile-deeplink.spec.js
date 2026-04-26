const { test, expect } = require('@playwright/test');
const { resetDatabaseFromSnapshot } = require('./helpers/snapshot');
const { restartServer, stopServer } = require('./helpers/server');
const { attachDiagnostics, expectNoCriticalClientFailures } = require('./helpers/diagnostics');
const { loginAsAbyss } = require('./helpers/auth');
const { waitUsableUi } = require('./helpers/navigation');
const { loadSnapshotDb, getUserByName } = require('./helpers/db');

function getChatFixture() {
  const db = loadSnapshotDb();
  const me = getUserByName(db, 'Abyss');
  const conversations = Array.isArray(db.chatConversations) ? db.chatConversations : [];
  const messages = Array.isArray(db.chatMessages) ? db.chatMessages : [];
  const ownConversation = conversations.find((conversation) => (
    conversation
    && conversation.type === 'direct'
    && Array.isArray(conversation.participantIds)
    && conversation.participantIds.includes(me?.id)
    && messages.some((message) => message?.conversationId === conversation.id)
  ));
  const peerId = ownConversation?.participantIds.find((id) => id !== me?.id) || '';
  const peer = (db.users || []).find((user) => user?.id === peerId) || null;
  const mismatchConversation = conversations.find((conversation) => (
    conversation
    && conversation.type === 'direct'
    && Array.isArray(conversation.participantIds)
    && conversation.participantIds.includes(me?.id)
    && conversation.id !== ownConversation?.id
  ));
  const mismatchPeerId = mismatchConversation?.participantIds.find((id) => id !== me?.id) || '';
  const foreignProfile = (db.users || []).find((user) => user?.id && user.id !== me?.id) || null;

  return { me, peer, ownConversation, mismatchPeerId, foreignProfile };
}

test.describe.serial('Messaging profile deeplink', () => {
  test.beforeAll(async () => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
  });

  test.afterAll(async () => {
    await stopServer();
  });

  test('opens profile chat deeplink directly, after F5, and through protected login', async ({ page }) => {
    test.setTimeout(180000);
    const diagnostics = attachDiagnostics(page);
    const { me, peer, ownConversation } = getChatFixture();
    expect(me?.id).toBeTruthy();
    expect(peer?.id).toBeTruthy();
    expect(ownConversation?.id).toBeTruthy();

    const deeplink = `/profile/${encodeURIComponent(me.id)}?openChatWith=${encodeURIComponent(peer.id)}&conversationId=${encodeURIComponent(ownConversation.id)}`;
    await loginAsAbyss(page, { startPath: deeplink });
    await waitUsableUi(page, { inputPath: deeplink, expectedPath: deeplink, pageId: 'page-user-profile' });

    await expect(page.locator('#chat-thread-title')).toContainText(peer.name);
    await expect(page.locator('#chat-messages')).toContainText('Привет');
    await expect(page.locator('#chat-input')).toBeEnabled();
    await expect(page.locator('#chat-send')).toBeEnabled();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitUsableUi(page, { inputPath: deeplink, expectedPath: deeplink, pageId: 'page-user-profile' });
    await expect(page.locator('#chat-thread-title')).toContainText(peer.name);
    await expect(page.locator('#chat-messages')).toContainText('Привет');

    expectNoCriticalClientFailures(diagnostics, {
      ignoreConsolePatterns: [
        /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
        /^\[LIVE\]/i,
        /^\[DATA\] scope load unauthorized/i,
        /Не удалось загрузить данные с сервера/i,
        /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
      ]
    });
  });

  test('keeps foreign profile private and handles rejected deeplink without dashboard redirect', async ({ page }) => {
    test.setTimeout(180000);
    const diagnostics = attachDiagnostics(page);
    const { me, peer, ownConversation, mismatchPeerId, foreignProfile } = getChatFixture();
    expect(me?.id).toBeTruthy();
    expect(peer?.id).toBeTruthy();
    expect(ownConversation?.id).toBeTruthy();
    expect(mismatchPeerId).toBeTruthy();
    expect(foreignProfile?.id).toBeTruthy();

    await loginAsAbyss(page);

    const foreignPath = `/profile/${encodeURIComponent(foreignProfile.id)}?openChatWith=${encodeURIComponent(peer.id)}&conversationId=${encodeURIComponent(ownConversation.id)}`;
    await page.goto(foreignPath, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe(foreignPath);
    await expect(page.locator('#user-profile-view')).toContainText('Доступ запрещён');
    await expect(page.locator('#user-profile-view')).toContainText('только владельцу');

    const mismatchedPath = `/profile/${encodeURIComponent(me.id)}?openChatWith=${encodeURIComponent(mismatchPeerId)}&conversationId=${encodeURIComponent(ownConversation.id)}`;
    await page.goto(mismatchedPath, { waitUntil: 'domcontentloaded' });
    await waitUsableUi(page, { inputPath: mismatchedPath, expectedPath: mismatchedPath, pageId: 'page-user-profile' });
    await expect(page.locator('#chat-empty')).toContainText('Диалог не соответствует ссылке');
    await expect(page.locator('#chat-input')).toBeDisabled();
    await expect(page.locator('#chat-send')).toBeDisabled();
    await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe(mismatchedPath);

    expectNoCriticalClientFailures(diagnostics, {
      ignoreConsolePatterns: [
        /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
        /Failed to load resource: the server responded with a status of 403 \(Forbidden\)/i,
        /^\[LIVE\]/i,
        /^\[DATA\] scope load unauthorized/i,
        /Не удалось загрузить данные с сервера/i,
        /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
      ]
    });
  });

  test('does not make system user writable', async ({ page }) => {
    test.setTimeout(180000);
    const diagnostics = attachDiagnostics(page);
    const { me } = getChatFixture();
    expect(me?.id).toBeTruthy();

    await loginAsAbyss(page);
    const systemPath = `/profile/${encodeURIComponent(me.id)}?openChatWith=system&conversationId=missing-system-conversation`;
    await page.goto(systemPath, { waitUntil: 'domcontentloaded' });
    await waitUsableUi(page, { inputPath: systemPath, expectedPath: systemPath, pageId: 'page-user-profile' });
    await expect(page.locator('#chat-thread-title')).toContainText('Система');
    await expect(page.locator('#chat-thread-status')).toContainText('Только чтение');
    await expect(page.locator('#chat-input')).toBeDisabled();
    await expect(page.locator('#chat-send')).toBeDisabled();

    const directResult = await page.evaluate(async () => {
      const res = await apiFetch('/api/chat/direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peerId: 'system' })
      });
      const body = await res.json().catch(() => ({}));
      return { status: res.status, body };
    });
    expect(directResult.status).toBe(403);
    expect(directResult.body.error).toContain('Нельзя инициировать диалог с системой');

    expectNoCriticalClientFailures(diagnostics, {
      ignoreConsolePatterns: [
        /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i,
        /Failed to load resource: the server responded with a status of 403 \(Forbidden\)/i,
        /^\[LIVE\]/i,
        /^\[DATA\] scope load unauthorized/i,
        /Не удалось загрузить данные с сервера/i,
        /^\[CONSISTENCY\]\[FLOW\] operation stats mismatch/i
      ]
    });
  });
});
