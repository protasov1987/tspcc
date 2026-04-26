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

  test('keeps /api/chat as the only server-side message write path', async ({ page }) => {
    test.setTimeout(180000);
    const { peer } = getChatFixture();
    expect(peer?.id).toBeTruthy();

    await loginAsAbyss(page);
    const before = await page.evaluate(async () => {
      const res = await apiFetch('/api/data');
      return res.json();
    });
    const beforeLegacyCount = Array.isArray(before.messages) ? before.messages.length : 0;
    const beforeChatCount = Array.isArray(before.chatMessages) ? before.chatMessages.length : 0;
    const clientMsgId = `stage11-batch3-${Date.now()}`;

    const result = await page.evaluate(async ({ peerId, clientMsgId }) => {
      const directRes = await apiFetch('/api/chat/direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peerId })
      });
      const directBody = await directRes.json().catch(() => ({}));
      const conversationId = directBody.conversationId;

      const chatSendRes = await apiFetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Stage 11 Batch 3 primary chat write', clientMsgId })
      });
      const chatSendBody = await chatSendRes.json().catch(() => ({}));

      const legacyGetRes = await apiFetch(`/api/messages/dialog/${encodeURIComponent(peerId)}`);
      const legacySendRes = await apiFetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toUserId: peerId, text: 'Legacy write must stay disabled' })
      });
      const legacyMarkReadRes = await apiFetch('/api/messages/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peerId })
      });
      const snapshotWriteRes = await apiFetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{
            id: `legacy-${clientMsgId}`,
            fromUserId: currentUser?.id || '',
            toUserId: peerId,
            text: 'Snapshot write must not revive legacy messages',
            createdAt: new Date().toISOString(),
            readAt: ''
          }]
        })
      });

      const afterRes = await apiFetch('/api/data');
      const after = await afterRes.json();
      return {
        directStatus: directRes.status,
        conversationId,
        chatSendStatus: chatSendRes.status,
        chatSendBody,
        legacyGetStatus: legacyGetRes.status,
        legacySendStatus: legacySendRes.status,
        legacyMarkReadStatus: legacyMarkReadRes.status,
        snapshotWriteStatus: snapshotWriteRes.status,
        after
      };
    }, { peerId: peer.id, clientMsgId });

    expect(result.directStatus).toBe(200);
    expect(result.conversationId).toBeTruthy();
    expect(result.chatSendStatus).toBe(200);
    expect(result.chatSendBody.message?.clientMsgId).toBe(clientMsgId);
    expect(result.legacyGetStatus).toBe(404);
    expect(result.legacySendStatus).toBe(404);
    expect(result.legacyMarkReadStatus).toBe(404);
    expect(result.snapshotWriteStatus).toBe(200);

    const afterLegacyMessages = Array.isArray(result.after.messages) ? result.after.messages : [];
    const afterChatMessages = Array.isArray(result.after.chatMessages) ? result.after.chatMessages : [];
    expect(afterLegacyMessages.length).toBe(beforeLegacyCount);
    expect(afterChatMessages.length).toBe(beforeChatCount + 1);
    expect(afterChatMessages.some((message) => message?.clientMsgId === clientMsgId)).toBe(true);
  });
});
