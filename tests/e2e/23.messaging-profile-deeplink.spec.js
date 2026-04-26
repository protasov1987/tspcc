const { test, expect } = require('@playwright/test');
const { resetDatabaseFromSnapshot } = require('./helpers/snapshot');
const { restartServer, stopServer } = require('./helpers/server');
const { attachDiagnostics, expectNoCriticalClientFailures } = require('./helpers/diagnostics');
const { loginAsAbyss, logoutViaUi } = require('./helpers/auth');
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
  const foreignConversation = conversations.find((conversation) => (
    conversation
    && conversation.type === 'direct'
    && Array.isArray(conversation.participantIds)
    && !conversation.participantIds.includes(me?.id)
  )) || null;
  const foreignProfile = (db.users || []).find((user) => user?.id && user.id !== me?.id) || null;

  return { me, peer, ownConversation, mismatchPeerId, foreignConversation, foreignProfile };
}

test.describe.serial('Messaging profile deeplink', () => {
  test.beforeAll(async () => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
  });

  test.afterAll(async () => {
    await stopServer();
  });

  test('shows own profile action log after login/logout and rejects foreign action reads', async ({ page }) => {
    test.setTimeout(180000);
    const diagnostics = attachDiagnostics(page);
    const { me, foreignProfile } = getChatFixture();
    expect(me?.id).toBeTruthy();
    expect(foreignProfile?.id).toBeTruthy();

    const profilePath = `/profile/${encodeURIComponent(me.id)}`;
    await loginAsAbyss(page, { startPath: profilePath });
    await waitUsableUi(page, { inputPath: profilePath, expectedPath: profilePath, pageId: 'page-user-profile' });
    await expect(page.locator('#user-actions-log')).toContainText('Вошёл в систему');

    const foreignRead = await page.evaluate(async (foreignId) => {
      const res = await apiFetch(`/api/user-actions?userId=${encodeURIComponent(foreignId)}&limit=20`);
      const body = await res.json().catch(() => ({}));
      return { status: res.status, body };
    }, foreignProfile.id);
    expect(foreignRead.status).toBe(403);
    expect(foreignRead.body.error).toContain('Нет доступа');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitUsableUi(page, { inputPath: profilePath, expectedPath: profilePath, pageId: 'page-user-profile' });
    await expect(page.locator('#user-actions-log')).toContainText('Вошёл в систему');

    await logoutViaUi(page);
    await loginAsAbyss(page, { startPath: profilePath });
    await waitUsableUi(page, { inputPath: profilePath, expectedPath: profilePath, pageId: 'page-user-profile' });
    await expect(page.locator('#user-actions-log')).toContainText('Вышел из системы');

    const ownRead = await page.evaluate(async (meId) => {
      const res = await apiFetch(`/api/user-actions?userId=${encodeURIComponent(meId)}&limit=20`);
      const body = await res.json().catch(() => ({}));
      return { status: res.status, actions: body.actions || [] };
    }, me.id);
    expect(ownRead.status).toBe(200);
    expect(ownRead.actions.some((entry) => String(entry?.text || '').includes('Вошёл в систему'))).toBe(true);
    expect(ownRead.actions.some((entry) => String(entry?.text || '').includes('Вышел из системы'))).toBe(true);
    expect(ownRead.actions.every((entry) => String(entry?.userId || '') === String(me.id))).toBe(true);

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

  test('persists delivered/read via primary chat endpoints and rejects invalid state writes', async ({ page }) => {
    test.setTimeout(180000);
    const { me, ownConversation, foreignConversation } = getChatFixture();
    expect(me?.id).toBeTruthy();
    expect(ownConversation?.id).toBeTruthy();
    expect(foreignConversation?.id).toBeTruthy();

    await loginAsAbyss(page);

    const result = await page.evaluate(async ({ conversationId, foreignConversationId, meId }) => {
      const readData = async () => {
        const res = await apiFetch('/api/data');
        return res.json();
      };
      const findState = (db, targetConversationId) => (
        (db.chatStates || []).find((state) => state?.conversationId === targetConversationId && state?.userId === meId) || null
      );

      const before = await readData();
      const maxSeq = (before.chatMessages || [])
        .filter((message) => message?.conversationId === conversationId)
        .reduce((max, message) => Math.max(max, Number(message?.seq || 0)), 0);

      const csrfRejectedRes = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/read`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lastReadSeq: maxSeq })
      });
      const deliveredRes = await apiFetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/delivered`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lastDeliveredSeq: maxSeq + 100 })
      });
      const deliveredBody = await deliveredRes.json().catch(() => ({}));
      const readRes = await apiFetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lastReadSeq: maxSeq + 100 })
      });
      const readBody = await readRes.json().catch(() => ({}));
      const afterSuccess = await readData();
      const successState = findState(afterSuccess, conversationId);

      const deliveredLowRes = await apiFetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/delivered`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lastDeliveredSeq: 1 })
      });
      const readLowRes = await apiFetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lastReadSeq: 1 })
      });
      const afterLow = await readData();
      const lowState = findState(afterLow, conversationId);

      const foreignDeliveredRes = await apiFetch(`/api/chat/conversations/${encodeURIComponent(foreignConversationId)}/delivered`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lastDeliveredSeq: 1 })
      });
      const foreignReadRes = await apiFetch(`/api/chat/conversations/${encodeURIComponent(foreignConversationId)}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lastReadSeq: 1 })
      });
      const afterForeign = await readData();
      const foreignState = findState(afterForeign, foreignConversationId);

      return {
        maxSeq,
        csrfStatus: csrfRejectedRes.status,
        deliveredStatus: deliveredRes.status,
        deliveredBody,
        readStatus: readRes.status,
        readBody,
        successState,
        deliveredLowStatus: deliveredLowRes.status,
        readLowStatus: readLowRes.status,
        lowState,
        foreignDeliveredStatus: foreignDeliveredRes.status,
        foreignReadStatus: foreignReadRes.status,
        foreignState
      };
    }, {
      conversationId: ownConversation.id,
      foreignConversationId: foreignConversation.id,
      meId: me.id
    });

    expect(result.maxSeq).toBeGreaterThan(0);
    expect(result.csrfStatus).toBe(403);
    expect(result.deliveredStatus).toBe(200);
    expect(result.deliveredBody.lastDeliveredSeq).toBe(result.maxSeq);
    expect(result.readStatus).toBe(200);
    expect(result.readBody.lastReadSeq).toBe(result.maxSeq);
    expect(result.successState?.lastDeliveredSeq).toBe(result.maxSeq);
    expect(result.successState?.lastReadSeq).toBe(result.maxSeq);
    expect(result.deliveredLowStatus).toBe(200);
    expect(result.readLowStatus).toBe(200);
    expect(result.lowState?.lastDeliveredSeq).toBe(result.maxSeq);
    expect(result.lowState?.lastReadSeq).toBe(result.maxSeq);
    expect(result.foreignDeliveredStatus).toBe(403);
    expect(result.foreignReadStatus).toBe(403);
    expect(result.foreignState).toBeNull();
  });

  test('resets unread after profile deeplink open and keeps state after F5 without realtime dependency', async ({ page }) => {
    test.setTimeout(180000);
    await page.addInitScript(() => {
      window.EventSource = class DisabledEventSource {
        constructor() {
          setTimeout(() => {
            const handlers = this._handlers?.open || [];
            handlers.forEach((handler) => handler({ type: 'open' }));
          }, 0);
        }

        addEventListener(type, handler) {
          this._handlers = this._handlers || {};
          this._handlers[type] = this._handlers[type] || [];
          this._handlers[type].push(handler);
        }

        close() {}
      };
    });

    const { me, peer, ownConversation } = getChatFixture();
    expect(me?.id).toBeTruthy();
    expect(peer?.id).toBeTruthy();
    expect(ownConversation?.id).toBeTruthy();

    await loginAsAbyss(page);

    const prepared = await page.evaluate(async ({ conversationId, meId, peerId }) => {
      const dataRes = await apiFetch('/api/data');
      const data = await dataRes.json();
      const chatStates = (data.chatStates || [])
        .filter((state) => !(state?.conversationId === conversationId && state?.userId === meId));
      chatStates.push({
        conversationId,
        userId: meId,
        lastDeliveredSeq: 0,
        lastReadSeq: 0,
        updatedAt: new Date().toISOString()
      });
      const saveRes = await apiFetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatStates })
      });
      const usersRes = await apiFetch('/api/chat/users');
      const usersBody = await usersRes.json().catch(() => ({}));
      const peerEntry = (usersBody.users || []).find((user) => user?.id === peerId) || null;
      return {
        saveStatus: saveRes.status,
        usersStatus: usersRes.status,
        unreadBeforeOpen: peerEntry?.unreadCount || 0
      };
    }, { conversationId: ownConversation.id, meId: me.id, peerId: peer.id });

    expect(prepared.saveStatus).toBe(200);
    expect(prepared.usersStatus).toBe(200);
    expect(prepared.unreadBeforeOpen).toBeGreaterThan(0);

    const deeplink = `/profile/${encodeURIComponent(me.id)}?openChatWith=${encodeURIComponent(peer.id)}&conversationId=${encodeURIComponent(ownConversation.id)}`;
    await page.goto(deeplink, { waitUntil: 'domcontentloaded' });
    await waitUsableUi(page, { inputPath: deeplink, expectedPath: deeplink, pageId: 'page-user-profile' });
    await expect(page.locator('#chat-thread-title')).toContainText(peer.name);
    await expect(page.locator('#chat-messages')).toContainText('Привет');

    await expect.poll(() => page.evaluate(async (peerId) => {
      const usersRes = await apiFetch('/api/chat/users');
      const usersBody = await usersRes.json().catch(() => ({}));
      const peerEntry = (usersBody.users || []).find((user) => user?.id === peerId) || null;
      return peerEntry?.unreadCount || 0;
    }, peer.id)).toBe(0);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitUsableUi(page, { inputPath: deeplink, expectedPath: deeplink, pageId: 'page-user-profile' });
    await expect(page.locator('#chat-thread-title')).toContainText(peer.name);
    await expect(page.locator('#chat-messages')).toContainText('Привет');
    await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe(deeplink);
  });

  test('stores system status notifications in primary chat messages only', async ({ page }) => {
    test.setTimeout(180000);
    const { me } = getChatFixture();
    expect(me?.id).toBeTruthy();

    await loginAsAbyss(page);
    const before = await page.evaluate(async () => {
      const res = await apiFetch('/api/data');
      return res.json();
    });
    const targetCard = (before.cards || []).find((card) => card?.id && card?.approvalStage !== 'STAGE11_SYSTEM_TEST') || null;
    expect(targetCard?.id).toBeTruthy();

    const result = await page.evaluate(async ({ meId, meName, cardId }) => {
      const dataRes = await apiFetch('/api/data');
      const data = await dataRes.json();
      const beforeLegacyCount = Array.isArray(data.messages) ? data.messages.length : 0;
      const beforeSystemMessages = (data.chatMessages || []).filter((message) => message?.senderId === 'system').length;
      const nextCards = (data.cards || []).map((card) => {
        if (!card || card.id !== cardId) return card;
        const oldStage = String(card.approvalStage || 'DRAFT');
        const nextStage = oldStage === 'DRAFT' ? 'ON_APPROVAL' : 'DRAFT';
        return {
          ...card,
          issuedBySurname: meName,
          approvalStage: nextStage,
          logs: [
            ...(Array.isArray(card.logs) ? card.logs : []),
            {
              id: `stage11-system-${Date.now()}`,
              ts: new Date().toISOString(),
              action: 'approval',
              object: 'approval',
              field: 'approvalStage',
              oldValue: oldStage,
              newValue: nextStage,
              userName: meName
            }
          ]
        };
      });

      const saveRes = await apiFetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cards: nextCards })
      });
      const afterRes = await apiFetch('/api/data');
      const after = await afterRes.json();
      const systemConversation = (after.chatConversations || []).find((conversation) => (
        conversation
        && Array.isArray(conversation.participantIds)
        && conversation.participantIds.includes('system')
        && conversation.participantIds.includes(meId)
      )) || null;
      const systemMessages = (after.chatMessages || []).filter((message) => (
        message?.senderId === 'system'
        && message?.conversationId === systemConversation?.id
      ));
      return {
        saveStatus: saveRes.status,
        beforeLegacyCount,
        afterLegacyCount: Array.isArray(after.messages) ? after.messages.length : 0,
        beforeSystemMessages,
        afterSystemMessages: (after.chatMessages || []).filter((message) => message?.senderId === 'system').length,
        systemConversation,
        lastSystemMessage: systemMessages[systemMessages.length - 1] || null
      };
    }, { meId: me.id, meName: me.name, cardId: targetCard.id });

    expect(result.saveStatus).toBe(200);
    expect(result.systemConversation?.id).toBeTruthy();
    expect(result.systemConversation.participantIds).toContain(me.id);
    expect(result.systemConversation.participantIds).toContain('system');
    expect(result.afterLegacyCount).toBe(result.beforeLegacyCount);
    expect(result.afterSystemMessages).toBeGreaterThan(result.beforeSystemMessages);
    expect(result.lastSystemMessage?.senderId).toBe('system');
    expect(result.lastSystemMessage?.text).toContain('Статус согласования изменён');
  });

  test('keeps /api/chat as the only server-side message write path', async ({ page }) => {
    test.setTimeout(180000);
    const { me, peer, foreignProfile } = getChatFixture();
    expect(me?.id).toBeTruthy();
    expect(peer?.id).toBeTruthy();
    expect(foreignProfile?.id).toBeTruthy();

    await loginAsAbyss(page);
    const before = await page.evaluate(async () => {
      const res = await apiFetch('/api/data');
      return res.json();
    });
    const beforeLegacyCount = Array.isArray(before.messages) ? before.messages.length : 0;
    const beforeChatCount = Array.isArray(before.chatMessages) ? before.chatMessages.length : 0;
    const beforeConversationCount = Array.isArray(before.chatConversations) ? before.chatConversations.length : 0;
    const beforeActionCount = Array.isArray(before.userActions) ? before.userActions.length : 0;
    const clientMsgId = `stage11-batch3-${Date.now()}`;

    const result = await page.evaluate(async ({ meId, peerId, foreignId, clientMsgId }) => {
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
          }],
          chatConversations: [{
            id: `legacy-conversation-${clientMsgId}`,
            type: 'direct',
            participantIds: [meId, foreignId],
            createdAt: new Date().toISOString()
          }],
          chatMessages: [{
            id: `legacy-chat-${clientMsgId}`,
            conversationId: conversationId || `legacy-conversation-${clientMsgId}`,
            seq: 999999,
            senderId: meId,
            text: 'Snapshot write must not create primary chat messages',
            createdAt: new Date().toISOString(),
            clientMsgId: `legacy-chat-${clientMsgId}`
          }],
          userActions: [{
            id: `legacy-action-${clientMsgId}`,
            userId: foreignId,
            at: new Date().toISOString(),
            text: 'Snapshot write must not create profile actions'
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
    }, { meId: me.id, peerId: peer.id, foreignId: foreignProfile.id, clientMsgId });

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
    const afterChatConversations = Array.isArray(result.after.chatConversations) ? result.after.chatConversations : [];
    const afterUserActions = Array.isArray(result.after.userActions) ? result.after.userActions : [];
    expect(afterLegacyMessages.length).toBe(beforeLegacyCount);
    expect(afterChatMessages.length).toBe(beforeChatCount + 1);
    expect(afterChatMessages.some((message) => message?.clientMsgId === clientMsgId)).toBe(true);
    expect(afterChatMessages.some((message) => message?.clientMsgId === `legacy-chat-${clientMsgId}`)).toBe(false);
    expect(afterChatConversations.length).toBe(beforeConversationCount);
    expect(afterChatConversations.some((conversation) => conversation?.id === `legacy-conversation-${clientMsgId}`)).toBe(false);
    expect(afterUserActions.length).toBe(beforeActionCount);
    expect(afterUserActions.some((entry) => entry?.id === `legacy-action-${clientMsgId}`)).toBe(false);
  });
});
