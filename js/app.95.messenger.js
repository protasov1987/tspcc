const SYSTEM_USER_ID = 'system';
let chatSse = null;
let messengerUiReady = false;
let chatUsers = [];
let activePeerId = null;
let activeConversationId = null;
let chatUsersEl = null;
let chatMessagesEl = null;
let chatThreadTitleEl = null;
let chatThreadStatusEl = null;
let chatInputEl = null;
let chatSendBtn = null;
let chatEmptyEl = null;
let chatScrollLoaderEl = null;
let userActionsEl = null;
const conversationByPeer = new Map();
const peerByConversation = new Map();
const messagesCache = new Map();
const pendingMessages = new Map();
let loadingHistory = false;
let unreadFallbackTimer = null;
let unreadFallbackInFlight = false;

function startMessagesSse() {
  if (chatSse || !currentUser) return;
  chatSse = new EventSource('/api/chat/stream');
  startUnreadFallbackTimer();

  chatSse.addEventListener('message_new', (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data || '{}');
    } catch (err) {
      console.warn('Failed to parse message_new', err);
      return;
    }
    const message = payload.message;
    if (!message || !message.conversationId) return;
    const conversationId = message.conversationId;
    const peerId = message.senderId === currentUser?.id
      ? peerByConversation.get(conversationId)
      : message.senderId;

    if (peerId) {
      conversationByPeer.set(peerId, conversationId);
      peerByConversation.set(conversationId, peerId);
    }

    const cache = ensureConversationCache(conversationId);
    const existsById = cache.messages.some(item => item.id === message.id);
    const existsByClient = message.clientMsgId
      ? cache.messages.some(item => item.clientMsgId === message.clientMsgId)
      : false;
    if (!existsById && !existsByClient) {
      cache.messages.push(message);
      sortMessages(cache.messages);
    } else if (message.clientMsgId) {
      replacePendingMessage(cache, message.clientMsgId, message);
      sortMessages(cache.messages);
    }

    const isOwnMessage = message.senderId === currentUser?.id;
    if (!isOwnMessage && peerId) {
      const updated = updateUserMetrics(peerId, { unreadDelta: activePeerId === peerId ? 0 : 1, messageDelta: 1 });
      if (!updated) {
        unreadMessagesCount = Math.max(0, unreadMessagesCount + (activePeerId === peerId ? 0 : 1));
        if (typeof updateUserBadge === 'function') updateUserBadge();
      }
    }

    if (activeConversationId === conversationId) {
      renderActiveConversation();
      if (!isOwnMessage) {
        markConversationDelivered(conversationId, message.seq);
        markConversationRead(conversationId, message.seq);
      }
    }
  });

  chatSse.addEventListener('unread_count', (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data || '{}');
    } catch (err) {
      console.warn('Failed to parse unread_count', err);
      return;
    }
    const count = Number(payload?.count || 0);
    unreadMessagesCount = Number.isFinite(count) ? Math.max(0, count) : 0;
    if (typeof updateUserBadge === 'function') updateUserBadge();
  });

  chatSse.addEventListener('delivered_update', (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data || '{}');
    } catch (err) {
      console.warn('Failed to parse delivered_update', err);
      return;
    }
    const { conversationId, userId, lastDeliveredSeq } = payload || {};
    if (!conversationId || !userId) return;
    const cache = ensureConversationCache(conversationId);
    cache.states[userId] = cache.states[userId] || { lastDeliveredSeq: 0, lastReadSeq: 0 };
    cache.states[userId].lastDeliveredSeq = Math.max(cache.states[userId].lastDeliveredSeq || 0, lastDeliveredSeq || 0);
    if (cache.states[userId].lastReadSeq > cache.states[userId].lastDeliveredSeq) {
      cache.states[userId].lastDeliveredSeq = cache.states[userId].lastReadSeq;
    }
    if (activeConversationId === conversationId) {
      renderActiveConversation();
    }
  });

  chatSse.addEventListener('read_update', (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data || '{}');
    } catch (err) {
      console.warn('Failed to parse read_update', err);
      return;
    }
    const { conversationId, userId, lastReadSeq } = payload || {};
    if (!conversationId || !userId) return;
    const cache = ensureConversationCache(conversationId);
    cache.states[userId] = cache.states[userId] || { lastDeliveredSeq: 0, lastReadSeq: 0 };
    cache.states[userId].lastReadSeq = Math.max(cache.states[userId].lastReadSeq || 0, lastReadSeq || 0);
    if (cache.states[userId].lastDeliveredSeq < cache.states[userId].lastReadSeq) {
      cache.states[userId].lastDeliveredSeq = cache.states[userId].lastReadSeq;
    }
    if (activeConversationId === conversationId) {
      renderActiveConversation();
    }
  });

  chatSse.addEventListener('user_status', (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data || '{}');
    } catch (err) {
      console.warn('Failed to parse user_status', err);
      return;
    }
    const { userId, isOnline } = payload || {};
    if (!userId) return;
    const user = chatUsers.find(u => u.id === userId);
    if (!user) return;
    user.isOnline = isOnline === true ? true : (isOnline === false ? false : null);
    renderChatUsers();
    if (activePeerId === userId) {
      updateThreadHeader(user);
    }
  });

  chatSse.onerror = () => {
    try {
      chatSse.close();
    } catch (_) {
      // ignore close errors
    }
    chatSse = null;
    setTimeout(startMessagesSse, 2000);
  };
}

function stopMessagesSse() {
  if (chatSse) {
    chatSse.close();
    chatSse = null;
  }
  stopUnreadFallbackTimer();
}

function startUnreadFallbackTimer() {
  if (unreadFallbackTimer) return;
  unreadFallbackTimer = setInterval(() => {
    refreshUnreadCountFallback();
  }, 60000);
  refreshUnreadCountFallback();
}

function stopUnreadFallbackTimer() {
  if (unreadFallbackTimer) {
    clearInterval(unreadFallbackTimer);
    unreadFallbackTimer = null;
  }
}

async function refreshUnreadCountFallback() {
  if (!currentUser || unreadFallbackInFlight) return;
  unreadFallbackInFlight = true;
  try {
    const res = await apiFetch('/api/chat/users');
    if (!res.ok) return;
    const payload = await res.json().catch(() => ({}));
    const users = Array.isArray(payload?.users) ? payload.users : [];
    const total = users.reduce((sum, user) => sum + (user?.unreadCount || 0), 0);
    unreadMessagesCount = Math.max(0, total || 0);
    if (typeof updateUserBadge === 'function') updateUserBadge();
  } catch (err) {
    // ignore polling errors
  } finally {
    unreadFallbackInFlight = false;
  }
}

function initMessengerUiOnce() {
  chatUsersEl = document.getElementById('chat-users-list');
  chatMessagesEl = document.getElementById('chat-messages');
  chatThreadTitleEl = document.getElementById('chat-thread-title');
  chatThreadStatusEl = document.getElementById('chat-thread-status');
  chatInputEl = document.getElementById('chat-input');
  chatSendBtn = document.getElementById('chat-send');
  chatEmptyEl = document.getElementById('chat-empty');
  chatScrollLoaderEl = document.getElementById('chat-scroll-loader');
  userActionsEl = document.getElementById('user-actions-log');

  if (chatUsersEl && !chatUsersEl.dataset.bound) {
    chatUsersEl.addEventListener('click', (event) => {
      const row = event.target.closest('.chat-user-row');
      if (!row) return;
      const peerId = row.dataset.peerId;
      if (!peerId) return;
      openConversation(peerId);
    });
    chatUsersEl.dataset.bound = '1';
  }

  if (chatSendBtn && !chatSendBtn.dataset.bound) {
    chatSendBtn.addEventListener('click', () => {
      sendChatMessage();
    });
    chatSendBtn.dataset.bound = '1';
  }

  if (chatInputEl && !chatInputEl.dataset.bound) {
    chatInputEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        sendChatMessage();
      }
    });
    chatInputEl.dataset.bound = '1';
  }

  if (chatMessagesEl && !chatMessagesEl.dataset.bound) {
    chatMessagesEl.addEventListener('scroll', () => {
      if (!activeConversationId || loadingHistory) return;
      if (chatMessagesEl.scrollTop <= 20) {
        const cache = messagesCache.get(activeConversationId);
        if (!cache || !cache.hasMore) return;
        loadConversationMessages(activeConversationId, { beforeSeq: cache.oldestSeq });
      }
    });

    chatMessagesEl.addEventListener('click', (event) => {
      const retryBtn = event.target.closest('.chat-retry-btn');
      if (!retryBtn) return;
      const clientMsgId = retryBtn.dataset.clientMsgId;
      if (!clientMsgId) return;
      retryFailedMessage(clientMsgId);
    });
    chatMessagesEl.dataset.bound = '1';
  }

  messengerUiReady = true;
}

async function refreshUserActionsLog() {
  if (!currentUser || !userActionsEl) return;
  try {
    const url = `/api/user-actions?userId=${encodeURIComponent(currentUser.id)}&limit=200`;
    const res = await apiFetch(url);
    if (!res.ok) return;
    const payload = await res.json().catch(() => ({}));
    const entries = Array.isArray(payload.actions) ? payload.actions : [];
    if (!entries.length) {
      userActionsEl.innerHTML = '<div class="chat-empty">История действий пока отсутствует.</div>';
      return;
    }
    userActionsEl.innerHTML = entries.map(entry => {
      const date = entry?.at ? new Date(entry.at).toLocaleString('ru-RU') : '';
      const text = entry?.text || '';
      return `
        <div class="user-action-item">
          <div class="user-action-time">${escapeHtml(date)}</div>
          <div class="user-action-text">${escapeHtml(text)}</div>
        </div>
      `;
    }).join('');
  } catch (err) {
    // silent
  }
}

async function refreshChatUsers() {
  if (!currentUser) return;
  const res = await apiFetch('/api/chat/users');
  if (!res.ok) return;
  const payload = await res.json().catch(() => ({}));
  chatUsers = Array.isArray(payload?.users) ? payload.users : [];
  conversationByPeer.clear();
  peerByConversation.clear();
  if (activePeerId && !chatUsers.some(user => user.id === activePeerId)) {
    activePeerId = null;
    activeConversationId = null;
  }
  chatUsers.forEach(user => {
    if (user?.conversationId) {
      conversationByPeer.set(user.id, user.conversationId);
      peerByConversation.set(user.conversationId, user.id);
    }
  });

  if (activePeerId && !conversationByPeer.has(activePeerId)) {
    activeConversationId = null;
  }

  if (activePeerId && conversationByPeer.has(activePeerId)) {
    activeConversationId = conversationByPeer.get(activePeerId);
  }

  updateUnreadBadge();
  renderChatUsers();

  if (activePeerId) {
    const conversationId = conversationByPeer.get(activePeerId) || null;
    if (conversationId) {
      activeConversationId = conversationId;
      await loadConversationMessages(conversationId, { initial: true });
    } else {
      renderActiveConversation();
    }
  } else {
    renderActiveConversation();
  }
}

function renderChatUsers() {
  if (!chatUsersEl) return;
  const sorted = sortChatUsers(chatUsers);
  chatUsersEl.innerHTML = sorted.map(user => {
    const isActive = user.id === activePeerId;
    const unread = user.unreadCount > 0;
    const hasHistory = user.hasHistory;
    const statusClass = user.isOnline === true ? 'online' : (user.isOnline === false ? 'offline' : 'unknown');
    const icons = unread
      ? '<span class="chat-user-icon">📩</span>'
      : (hasHistory ? '<span class="chat-user-icon">✉️</span>' : '');
    return `
      <div class="chat-user-row${isActive ? ' active' : ''}" data-peer-id="${escapeHtml(user.id)}">
        <div class="chat-user-name${unread ? ' unread' : ''}">
          <span class="chat-user-status ${statusClass}"></span>
          <span class="chat-user-label">${escapeHtml(user.name || 'Пользователь')}</span>
        </div>
        <div class="chat-user-icons">${icons}</div>
      </div>
    `;
  }).join('');
}

function sortChatUsers(list) {
  const usersList = Array.isArray(list) ? list.slice() : [];
  const systemUser = usersList.find(user => user.id === SYSTEM_USER_ID) || null;
  const others = usersList.filter(user => user.id !== SYSTEM_USER_ID);
  const sortFn = (a, b) => {
    const aUnread = (a.unreadCount || 0) > 0;
    const bUnread = (b.unreadCount || 0) > 0;
    if (aUnread !== bUnread) return aUnread ? -1 : 1;
    if ((b.messageCount || 0) !== (a.messageCount || 0)) {
      return (b.messageCount || 0) - (a.messageCount || 0);
    }
    return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
  };

  const sortedOthers = others.sort(sortFn);
  if (systemUser && (systemUser.unreadCount || 0) === 0) {
    return [systemUser, ...sortedOthers];
  }
  if (systemUser) {
    return [systemUser, ...sortedOthers].sort(sortFn);
  }
  return sortedOthers;
}

async function openConversation(peerId) {
  if (!peerId) return;
  activePeerId = peerId;
  const tempId = `temp:${peerId}`;
  activeConversationId = conversationByPeer.get(peerId) || (messagesCache.has(tempId) ? tempId : null);
  renderChatUsers();
  updateComposeState();

  if (!activeConversationId) {
    renderActiveConversation();
    return;
  }

  if (activeConversationId.startsWith('temp:')) {
    renderActiveConversation();
    return;
  }

  await loadConversationMessages(activeConversationId, { initial: true });
  const cache = messagesCache.get(activeConversationId);
  if (cache) {
    const lastSeq = cache.messages.length ? cache.messages[cache.messages.length - 1].seq : 0;
    if (lastSeq > 0) {
      markConversationDelivered(activeConversationId, lastSeq);
      markConversationRead(activeConversationId, lastSeq);
      updateUserMetrics(peerId, { unreadReset: true });
    }
  }
}

function updateComposeState() {
  if (!chatInputEl || !chatSendBtn) return;
  const disabled = !activePeerId || activePeerId === SYSTEM_USER_ID;
  chatInputEl.disabled = disabled;
  chatSendBtn.disabled = disabled;
  chatInputEl.placeholder = disabled
    ? (activePeerId === SYSTEM_USER_ID ? 'Системе нельзя писать' : 'Выберите пользователя')
    : 'Введите сообщение...';
}

async function sendChatMessage() {
  if (!chatInputEl || !currentUser || !activePeerId) return;
  if (activePeerId === SYSTEM_USER_ID) return;
  const text = (chatInputEl.value || '').toString().trim();
  if (!text) return;

  const clientMsgId = generateClientMsgId();
  let tempConversationId = null;
  if (!activeConversationId) {
    tempConversationId = `temp:${activePeerId}`;
    activeConversationId = tempConversationId;
  }
  const optimistic = {
    id: `pending-${clientMsgId}`,
    conversationId: activeConversationId,
    seq: null,
    senderId: currentUser.id,
    text,
    createdAt: new Date().toISOString(),
    clientMsgId,
    pending: true
  };

  if (activeConversationId) {
    const cache = ensureConversationCache(activeConversationId);
    cache.messages.push(optimistic);
    sortMessages(cache.messages);
  }

  pendingMessages.set(clientMsgId, { peerId: activePeerId });
  chatInputEl.value = '';
  renderActiveConversation();

  try {
    let conversationId = activeConversationId;
    if (conversationId && conversationId.startsWith('temp:')) {
      conversationId = null;
    }
    if (!conversationId) {
      const directRes = await apiFetch('/api/chat/direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peerId: activePeerId })
      });
      if (!directRes.ok) throw new Error('Не удалось создать диалог');
      const directPayload = await directRes.json().catch(() => ({}));
      conversationId = directPayload.conversationId;
      if (!conversationId) throw new Error('Некорректный ответ сервера');
      if (tempConversationId) {
        promoteTempConversation(tempConversationId, conversationId);
      }
      activeConversationId = conversationId;
      conversationByPeer.set(activePeerId, conversationId);
      peerByConversation.set(conversationId, activePeerId);
    }

    const attemptSend = async (targetConversationId) => {
      const res = await apiFetch(`/api/chat/conversations/${encodeURIComponent(targetConversationId)}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, clientMsgId })
      });
      if (!res.ok) return { ok: false, res };
      const payload = await res.json().catch(() => ({}));
      return { ok: true, message: payload.message };
    };

    let sendAttempt = await attemptSend(conversationId);
    if (!sendAttempt.ok && sendAttempt.res?.status === 403 && activePeerId) {
      const directRes = await apiFetch('/api/chat/direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peerId: activePeerId })
      });
      if (directRes.ok) {
        const directPayload = await directRes.json().catch(() => ({}));
        const newConversationId = directPayload.conversationId;
        if (newConversationId) {
          conversationId = newConversationId;
          activeConversationId = newConversationId;
          conversationByPeer.set(activePeerId, newConversationId);
          peerByConversation.set(newConversationId, activePeerId);
          sendAttempt = await attemptSend(newConversationId);
        }
      }
    }

    if (!sendAttempt.ok) throw new Error('Ошибка отправки');
    const message = sendAttempt.message;
    if (!message) throw new Error('Некорректный ответ сервера');

    const cache = ensureConversationCache(conversationId);
    replacePendingMessage(cache, clientMsgId, message);
    sortMessages(cache.messages);

    updateUserMetrics(activePeerId, { messageDelta: 1, history: true });
    renderActiveConversation();
  } catch (err) {
    markFailedMessage(clientMsgId, err.message);
    renderActiveConversation();
  }
}

function replacePendingMessage(cache, clientMsgId, message) {
  const idx = cache.messages.findIndex(item => item.clientMsgId === clientMsgId);
  if (idx >= 0) {
    cache.messages[idx] = message;
  } else {
    cache.messages.push(message);
  }
  pendingMessages.delete(clientMsgId);
}

function promoteTempConversation(tempId, conversationId) {
  if (!tempId || !conversationId || tempId === conversationId) return;
  const tempCache = messagesCache.get(tempId);
  if (tempCache) {
    messagesCache.set(conversationId, {
      ...tempCache,
      messages: tempCache.messages.map(msg => ({ ...msg, conversationId }))
    });
    messagesCache.delete(tempId);
  }
}

function markFailedMessage(clientMsgId, reason) {
  messagesCache.forEach(cache => {
    cache.messages.forEach(msg => {
      if (msg.clientMsgId === clientMsgId && msg.pending) {
        msg.pending = false;
        msg.failed = true;
        msg.error = reason;
      }
    });
  });
}

function retryFailedMessage(clientMsgId) {
  messagesCache.forEach(cache => {
    cache.messages.forEach(msg => {
      if (msg.clientMsgId === clientMsgId && msg.failed) {
        msg.failed = false;
        msg.pending = true;
        renderActiveConversation();
      }
    });
  });
  sendRetryMessage(clientMsgId);
}

async function sendRetryMessage(clientMsgId) {
  const pending = pendingMessages.get(clientMsgId);
  if (!pending) return;
  const peerId = pending.peerId;
  if (!peerId) return;
  const cache = activeConversationId ? messagesCache.get(activeConversationId) : null;
  const msg = cache ? cache.messages.find(item => item.clientMsgId === clientMsgId) : null;
  if (!msg) return;
  try {
    const conversationId = conversationByPeer.get(peerId) || activeConversationId;
    if (!conversationId) return;
    const sendRes = await apiFetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: msg.text, clientMsgId })
    });
    if (!sendRes.ok) throw new Error('Ошибка отправки');
    const sendPayload = await sendRes.json().catch(() => ({}));
    const message = sendPayload.message;
    if (!message) throw new Error('Некорректный ответ сервера');
    const convCache = ensureConversationCache(conversationId);
    replacePendingMessage(convCache, clientMsgId, message);
    renderActiveConversation();
  } catch (err) {
    markFailedMessage(clientMsgId, err.message);
    renderActiveConversation();
  }
}

async function loadConversationMessages(conversationId, { beforeSeq = null, initial = false } = {}) {
  if (!conversationId || loadingHistory) return;
  loadingHistory = true;
  if (chatScrollLoaderEl) chatScrollLoaderEl.classList.remove('hidden');
  const limit = 50;
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  if (beforeSeq) params.set('beforeSeq', String(beforeSeq));
  const url = `/api/chat/conversations/${encodeURIComponent(conversationId)}/messages?${params.toString()}`;

  try {
    const res = await apiFetch(url);
    if (!res.ok) return;
    const payload = await res.json().catch(() => ({}));
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const cache = ensureConversationCache(conversationId);

    if (payload.states && typeof payload.states === 'object') {
      cache.states = { ...cache.states, ...payload.states };
    }

    if (beforeSeq) {
      const prevHeight = chatMessagesEl ? chatMessagesEl.scrollHeight : 0;
      cache.messages = [...messages, ...cache.messages];
      sortMessages(cache.messages);
      cache.oldestSeq = cache.messages.length ? cache.messages[0].seq : null;
      cache.hasMore = payload.hasMore ?? (messages.length === limit);
      renderActiveConversation({ keepScroll: true, prevHeight });
    } else {
      cache.messages = messages;
      sortMessages(cache.messages);
      cache.oldestSeq = cache.messages.length ? cache.messages[0].seq : null;
      cache.hasMore = payload.hasMore ?? (messages.length === limit);
      renderActiveConversation({ scrollToBottom: true });
    }
  } finally {
    loadingHistory = false;
    if (chatScrollLoaderEl) chatScrollLoaderEl.classList.add('hidden');
  }
}

function renderActiveConversation({ scrollToBottom = true, keepScroll = false, prevHeight = 0 } = {}) {
  updateComposeState();
  if (!chatMessagesEl) return;
  resetMessagesContainer();

  if (!activePeerId) {
    setEmptyState('Выберите пользователя слева.');
    updateThreadHeader(null);
    return;
  }

  const peer = chatUsers.find(user => user.id === activePeerId);
  updateThreadHeader(peer || { name: 'Пользователь', id: activePeerId });

  if (!activeConversationId) {
    setEmptyState('Диалог появится после первого сообщения.');
    return;
  }

  const cache = messagesCache.get(activeConversationId);
  if (!cache || cache.messages.length === 0) {
    setEmptyState('Сообщений пока нет.');
    return;
  }

  chatEmptyEl?.classList.add('hidden');
  const fragment = document.createDocumentFragment();
  cache.messages.forEach(message => {
    const el = renderMessageBubble(message, cache.states);
    fragment.appendChild(el);
  });
  chatMessagesEl.appendChild(fragment);

  if (keepScroll && chatMessagesEl) {
    const newHeight = chatMessagesEl.scrollHeight;
    chatMessagesEl.scrollTop = newHeight - prevHeight + chatMessagesEl.scrollTop;
  } else if (scrollToBottom && chatMessagesEl) {
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }
}

function resetMessagesContainer() {
  if (!chatMessagesEl) return;
  chatMessagesEl.innerHTML = '';
  if (chatScrollLoaderEl) chatMessagesEl.appendChild(chatScrollLoaderEl);
  if (chatEmptyEl) chatMessagesEl.appendChild(chatEmptyEl);
}

function setEmptyState(text) {
  if (!chatEmptyEl) return;
  chatEmptyEl.textContent = text;
  chatEmptyEl.classList.remove('hidden');
}

function updateThreadHeader(peer) {
  if (chatThreadTitleEl) {
    chatThreadTitleEl.textContent = peer ? (peer.name || 'Пользователь') : 'Диалог';
  }
  if (chatThreadStatusEl) {
    if (!peer) {
      chatThreadStatusEl.textContent = '';
    } else if (peer.id === SYSTEM_USER_ID) {
      chatThreadStatusEl.textContent = 'Только чтение';
    } else if (peer.isOnline === true) {
      chatThreadStatusEl.textContent = 'В сети';
    } else if (peer.isOnline === false) {
      chatThreadStatusEl.textContent = 'Не в сети';
    } else {
      chatThreadStatusEl.textContent = '';
    }
  }
}

function renderMessageBubble(message, states) {
  const isMine = message.senderId === currentUser?.id;
  const wrapper = document.createElement('div');
  wrapper.className = `chat-msg ${isMine ? 'me' : 'other'}`;

  const meta = document.createElement('div');
  meta.className = 'chat-msg-meta';
  const timeEl = document.createElement('span');
  timeEl.className = 'chat-msg-time';
  timeEl.textContent = formatChatTime(message.createdAt);
  meta.appendChild(timeEl);

  if (isMine) {
    const statusEl = document.createElement('span');
    statusEl.className = 'chat-msg-status';
    statusEl.innerHTML = getMessageStatusIcon(message, states);
    meta.appendChild(statusEl);
  }

  const textEl = document.createElement('div');
  textEl.className = 'chat-msg-text';
  textEl.textContent = message.text || '';

  wrapper.appendChild(meta);
  wrapper.appendChild(textEl);

  if (isMine && message.failed) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'chat-retry-btn';
    retry.dataset.clientMsgId = message.clientMsgId;
    retry.textContent = '❌ Повторить';
    wrapper.appendChild(retry);
  }

  return wrapper;
}

function formatChatTime(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function sortMessages(list) {
  list.sort((a, b) => {
    const aSeq = Number.isFinite(a.seq) ? a.seq : Number.MAX_SAFE_INTEGER;
    const bSeq = Number.isFinite(b.seq) ? b.seq : Number.MAX_SAFE_INTEGER;
    if (aSeq !== bSeq) return aSeq - bSeq;
    const aTime = new Date(a.createdAt || 0).getTime();
    const bTime = new Date(b.createdAt || 0).getTime();
    return aTime - bTime;
  });
}

function generateClientMsgId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `cmsg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function getMessageStatusIcon(message, states) {
  if (message.pending) return '⏳';
  if (message.failed) return '❌';
  if (!message.seq || !activePeerId) return '✓';
  const peerState = states?.[activePeerId] || { lastDeliveredSeq: 0, lastReadSeq: 0 };
  if ((peerState.lastReadSeq || 0) >= message.seq) return '✓✓';
  if ((peerState.lastDeliveredSeq || 0) >= message.seq) return '✓✓';
  return '✓';
}

function ensureConversationCache(conversationId) {
  if (!messagesCache.has(conversationId)) {
    messagesCache.set(conversationId, {
      messages: [],
      oldestSeq: null,
      hasMore: true,
      states: {}
    });
  }
  return messagesCache.get(conversationId);
}

async function markConversationDelivered(conversationId, lastSeq) {
  if (!conversationId || !lastSeq) return;
  await apiFetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/delivered`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lastDeliveredSeq: lastSeq })
  });
}

async function markConversationRead(conversationId, lastSeq) {
  if (!conversationId || !lastSeq) return;
  await apiFetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/read`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lastReadSeq: lastSeq })
  });
}

function updateUnreadBadge() {
  unreadMessagesCount = chatUsers.reduce((sum, user) => sum + (user.unreadCount || 0), 0);
  if (typeof updateUserBadge === 'function') updateUserBadge();
}

function updateUserMetrics(peerId, { unreadDelta = 0, messageDelta = 0, unreadReset = false, history = false } = {}) {
  const user = chatUsers.find(u => u.id === peerId);
  if (!user) return false;
  if (unreadReset) {
    user.unreadCount = 0;
  } else if (unreadDelta) {
    user.unreadCount = Math.max(0, (user.unreadCount || 0) + unreadDelta);
  }
  if (messageDelta) {
    user.messageCount = Math.max(0, (user.messageCount || 0) + messageDelta);
    user.hasHistory = user.messageCount > 0;
  }
  if (history) {
    user.hasHistory = true;
  }
  updateUnreadBadge();
  renderChatUsers();
  return true;
}

function resetChatView() {
  activePeerId = null;
  activeConversationId = null;
  renderActiveConversation();
  renderChatUsers();
}
