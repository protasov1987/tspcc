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
let chatSseReconnectNoticeTimer = null;
let activeConversationError = '';
let lastAppliedProfileChatDeeplinkKey = '';
let chatLiveDebounceTimer = null;
let chatLiveInFlight = false;
let chatLivePending = false;
let chatLiveSuppressUntil = 0;
let chatSseLastErrorLogAt = 0;
let chatLiveLastFallbackLogAt = 0;
const CHAT_LIVE_DEBOUNCE_MS = 250;
const CHAT_LIVE_RETRY_MS = 1500;
const chatLivePendingHints = {
  needsUsers: false,
  needsActive: false,
  fallback: false,
  conversationIds: new Set(),
  peerIds: new Set(),
  reasons: new Set()
};

function logChatLive(message, payload = {}) {
  if (typeof logLiveDiagnostic === 'function') {
    logLiveDiagnostic('chat ' + message, payload);
    return;
  }
  try {
    console.log('[LIVE] chat ' + message, payload);
  } catch (e) {}
}

function getChatLiveHintSummary(hints = chatLivePendingHints) {
  const conversationIds = Array.isArray(hints.conversationIds)
    ? hints.conversationIds
    : Array.from(hints.conversationIds || []);
  const peerIds = Array.isArray(hints.peerIds)
    ? hints.peerIds
    : Array.from(hints.peerIds || []);
  const reasons = Array.isArray(hints.reasons)
    ? hints.reasons
    : Array.from(hints.reasons || []);
  return {
    needsUsers: hints.needsUsers === true,
    needsActive: hints.needsActive === true,
    fallback: hints.fallback === true,
    conversationIds,
    peerIds,
    reasons
  };
}

function hasChatLivePendingHints() {
  return chatLivePendingHints.needsUsers
    || chatLivePendingHints.needsActive
    || chatLivePendingHints.fallback
    || chatLivePendingHints.conversationIds.size > 0
    || chatLivePendingHints.peerIds.size > 0
    || chatLivePendingHints.reasons.size > 0;
}

function clearChatLivePendingHints() {
  chatLivePendingHints.needsUsers = false;
  chatLivePendingHints.needsActive = false;
  chatLivePendingHints.fallback = false;
  chatLivePendingHints.conversationIds.clear();
  chatLivePendingHints.peerIds.clear();
  chatLivePendingHints.reasons.clear();
}

function queueChatLiveRefreshHint({
  reason = '',
  conversationId = '',
  peerId = '',
  needsUsers = false,
  needsActive = false,
  fallback = false
} = {}) {
  const normalizedConversationId = String(conversationId || '').trim();
  const normalizedPeerId = String(peerId || '').trim();
  const normalizedReason = String(reason || '').trim();
  if (normalizedReason) chatLivePendingHints.reasons.add(normalizedReason);
  if (normalizedConversationId) chatLivePendingHints.conversationIds.add(normalizedConversationId);
  if (normalizedPeerId) chatLivePendingHints.peerIds.add(normalizedPeerId);
  chatLivePendingHints.needsUsers = chatLivePendingHints.needsUsers || needsUsers === true;
  chatLivePendingHints.needsActive = chatLivePendingHints.needsActive
    || needsActive === true
    || (normalizedConversationId && normalizedConversationId === activeConversationId)
    || (normalizedPeerId && normalizedPeerId === activePeerId);
  chatLivePendingHints.fallback = chatLivePendingHints.fallback || fallback === true;
  return getChatLiveHintSummary();
}

function consumeChatLivePendingHints() {
  const hints = getChatLiveHintSummary();
  clearChatLivePendingHints();
  return hints;
}

function requeueChatLiveHints(hints = {}) {
  (hints.conversationIds || []).forEach(conversationId => {
    if (conversationId) chatLivePendingHints.conversationIds.add(conversationId);
  });
  (hints.peerIds || []).forEach(peerId => {
    if (peerId) chatLivePendingHints.peerIds.add(peerId);
  });
  (hints.reasons || []).forEach(reason => {
    if (reason) chatLivePendingHints.reasons.add(reason);
  });
  chatLivePendingHints.needsUsers = chatLivePendingHints.needsUsers || hints.needsUsers === true;
  chatLivePendingHints.needsActive = chatLivePendingHints.needsActive || hints.needsActive === true;
  chatLivePendingHints.fallback = chatLivePendingHints.fallback || hints.fallback === true;
}

function parseChatLivePayload(eventName, event) {
  try {
    return JSON.parse(event?.data || '{}');
  } catch (err) {
    console.warn('[LIVE] chat parse warning', {
      event: eventName,
      error: err?.message || String(err)
    });
    scheduleChatLiveFallback(`${eventName}:parse-warning`, 0, {
      needsUsers: true,
      needsActive: Boolean(activeConversationId || activePeerId)
    });
    return null;
  }
}

function getChatLivePeerId(conversationId, message = {}) {
  const senderId = String(message?.senderId || '').trim();
  if (senderId && senderId !== String(currentUser?.id || '')) return senderId;
  const mappedPeerId = conversationId ? peerByConversation.get(conversationId) : '';
  if (mappedPeerId) return mappedPeerId;
  if (conversationId && conversationId === activeConversationId && activePeerId) return activePeerId;
  return '';
}

function shouldRefreshActiveConversationForHints(hints = {}, conversationId = activeConversationId, peerId = activePeerId) {
  if (!conversationId && !peerId) return false;
  if (hints.needsActive === true) return true;
  if (conversationId && (hints.conversationIds || []).includes(conversationId)) return true;
  if (peerId && (hints.peerIds || []).includes(peerId)) return true;
  return false;
}

function setChatLiveLocalWriteSuppressWindow(durationMs = 500) {
  chatLiveSuppressUntil = Math.max(chatLiveSuppressUntil, Date.now() + durationMs);
}

function scheduleChatLiveFallback(reason = 'fallback', delay = CHAT_LIVE_RETRY_MS, hint = {}) {
  const now = Date.now();
  if (now - chatLiveLastFallbackLogAt > 2000 || String(reason || '').includes('parse')) {
    chatLiveLastFallbackLogAt = now;
    logChatLive('fallback scheduled', {
      reason,
      delay,
      route: window.location.pathname + window.location.search
    });
  }
  scheduleChatLiveRefresh(reason, delay, { ...hint, fallback: true, needsUsers: true });
}

function scheduleChatLiveRefresh(reason = 'manual', delay = CHAT_LIVE_DEBOUNCE_MS, hint = {}) {
  if (!currentUser) return;
  const summary = queueChatLiveRefreshHint({ ...hint, reason });
  const normalizedDelay = Math.max(0, Number.isFinite(Number(delay)) ? Number(delay) : CHAT_LIVE_DEBOUNCE_MS);

  if (chatLiveInFlight) {
    chatLivePending = true;
    logChatLive('pending/retry scheduled', {
      reason,
      state: 'in-flight',
      hints: summary
    });
    return;
  }

  if (chatLiveDebounceTimer) {
    clearTimeout(chatLiveDebounceTimer);
  }

  const suppressDelay = Math.max(0, chatLiveSuppressUntil - Date.now() + 25);
  const effectiveDelay = Math.max(normalizedDelay, suppressDelay);
  if (suppressDelay > 0 || loadingHistory) {
    chatLivePending = true;
    logChatLive('pending/retry scheduled', {
      reason,
      state: suppressDelay > 0 ? 'local-write-suppression' : 'history-loading',
      delay: effectiveDelay,
      hints: summary
    });
  } else {
    logChatLive('targeted refresh scheduled', {
      reason,
      delay: effectiveDelay,
      hints: summary
    });
  }

  chatLiveDebounceTimer = setTimeout(() => {
    chatLiveDebounceTimer = null;
    runChatLiveRefresh(reason);
  }, effectiveDelay);
}

async function runChatLiveRefresh(reason = 'manual') {
  if (!currentUser) {
    clearChatLivePendingHints();
    return;
  }
  if (!hasChatLivePendingHints()) return;
  if (chatLiveInFlight) {
    chatLivePending = true;
    logChatLive('pending/retry scheduled', {
      reason,
      state: 'in-flight',
      hints: getChatLiveHintSummary()
    });
    return;
  }
  if (Date.now() < chatLiveSuppressUntil) {
    const retryDelay = Math.max(100, chatLiveSuppressUntil - Date.now() + 25);
    chatLivePending = true;
    logChatLive('pending/retry scheduled', {
      reason,
      state: 'local-write-suppression',
      delay: retryDelay,
      hints: getChatLiveHintSummary()
    });
    scheduleChatLiveRefresh('after-local-write', retryDelay);
    return;
  }

  const hints = consumeChatLivePendingHints();
  if (loadingHistory) {
    requeueChatLiveHints(hints);
    chatLivePending = true;
    logChatLive('pending/retry scheduled', {
      reason,
      state: 'history-loading',
      delay: 200,
      hints
    });
    scheduleChatLiveRefresh('pending', 200);
    return;
  }

  chatLiveInFlight = true;
  try {
    logChatLive('targeted refresh start', {
      reason,
      route: window.location.pathname + window.location.search,
      hints
    });

    await refreshChatUsers({
      applyProfileDeeplink: false,
      force: true,
      reason: `live:${reason}`,
      refreshActiveConversation: false
    });

    if (activePeerId && !activeConversationId && conversationByPeer.has(activePeerId)) {
      activeConversationId = conversationByPeer.get(activePeerId);
    }

    const shouldRefreshActive = shouldRefreshActiveConversationForHints(hints, activeConversationId, activePeerId);
    if (shouldRefreshActive && activeConversationId && !activeConversationId.startsWith('temp:')) {
      const opened = await loadConversationMessages(activeConversationId, {
        initial: true,
        expectedPeerId: activePeerId,
        force: true,
        reason: `live:${reason}`,
        preserveLocalPending: true
      });
      if (opened) {
        markActiveConversationSeen(activePeerId);
      }
    } else {
      renderActiveConversation();
    }

    logChatLive('targeted refresh done', {
      reason,
      route: window.location.pathname + window.location.search,
      activeConversationId: activeConversationId || null,
      activePeerId: activePeerId || null
    });
  } catch (err) {
    console.warn('[LIVE] chat targeted refresh failed', {
      reason,
      route: window.location.pathname + window.location.search,
      error: err?.message || String(err)
    });
    if (reason !== 'fallback') {
      requeueChatLiveHints(hints);
      chatLiveInFlight = false;
      chatLivePending = false;
      scheduleChatLiveFallback('fallback', CHAT_LIVE_RETRY_MS, {
        needsActive: Boolean(activeConversationId || activePeerId)
      });
    }
  } finally {
    chatLiveInFlight = false;
    if ((chatLivePending || hasChatLivePendingHints()) && !chatLiveDebounceTimer) {
      chatLivePending = false;
      scheduleChatLiveRefresh('pending', 0);
    }
  }
}

function startMessagesSse() {
  if (chatSse || !currentUser) return;
  startUnreadFallbackTimer();
  try {
    chatSse = new EventSource('/api/chat/stream');
  } catch (err) {
    console.warn('[LIVE] chat connect error', {
      error: err?.message || String(err)
    });
    scheduleChatLiveFallback('connect-error', 0, {
      needsActive: Boolean(activeConversationId || activePeerId)
    });
    setTimeout(startMessagesSse, 2000);
    return;
  }

  chatSse.addEventListener('open', () => {
    if (chatSseReconnectNoticeTimer) {
      clearTimeout(chatSseReconnectNoticeTimer);
      chatSseReconnectNoticeTimer = null;
    }
    if (typeof reportServerConnectionOk === 'function') {
      reportServerConnectionOk('chat-sse');
    }
    try {
      window.__chatLiveConnectedAt = Date.now();
    } catch (e) {}
    logChatLive('connected', {
      route: window.location.pathname + window.location.search
    });
  });

  chatSse.addEventListener('message_new', (event) => {
    const payload = parseChatLivePayload('message_new', event);
    if (!payload) return;
    const message = payload.message;
    if (!message || !message.conversationId) return;
    const conversationId = message.conversationId;
    const peerId = getChatLivePeerId(conversationId, message);

    if (peerId) {
      conversationByPeer.set(peerId, conversationId);
      peerByConversation.set(conversationId, peerId);
    }

    scheduleChatLiveRefresh('message_new', CHAT_LIVE_DEBOUNCE_MS, {
      conversationId,
      peerId,
      needsUsers: true,
      needsActive: conversationId === activeConversationId || peerId === activePeerId
    });
  });

  chatSse.addEventListener('unread_count', (event) => {
    const payload = parseChatLivePayload('unread_count', event);
    if (!payload) return;
    scheduleChatLiveRefresh('unread_count', CHAT_LIVE_DEBOUNCE_MS, {
      needsUsers: true
    });
  });

  chatSse.addEventListener('delivered_update', (event) => {
    const payload = parseChatLivePayload('delivered_update', event);
    if (!payload) return;
    const { conversationId, userId, lastDeliveredSeq } = payload || {};
    if (!conversationId || !userId) return;
    const peerId = userId === currentUser?.id ? getChatLivePeerId(conversationId, {}) : userId;
    scheduleChatLiveRefresh('delivered_update', CHAT_LIVE_DEBOUNCE_MS, {
      conversationId,
      peerId,
      needsUsers: true,
      needsActive: conversationId === activeConversationId || peerId === activePeerId
    });
  });

  chatSse.addEventListener('read_update', (event) => {
    const payload = parseChatLivePayload('read_update', event);
    if (!payload) return;
    const { conversationId, userId, lastReadSeq } = payload || {};
    if (!conversationId || !userId) return;
    const peerId = userId === currentUser?.id ? getChatLivePeerId(conversationId, {}) : userId;
    scheduleChatLiveRefresh('read_update', CHAT_LIVE_DEBOUNCE_MS, {
      conversationId,
      peerId,
      needsUsers: true,
      needsActive: conversationId === activeConversationId || peerId === activePeerId
    });
  });

  chatSse.addEventListener('user_status', (event) => {
    const payload = parseChatLivePayload('user_status', event);
    if (!payload) return;
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
    const now = Date.now();
    if (now - chatSseLastErrorLogAt > 5000) {
      chatSseLastErrorLogAt = now;
      console.warn('[LIVE] chat connection error', {
        route: window.location.pathname + window.location.search
      });
    }
    scheduleChatLiveFallback('sse-error', 0, {
      needsActive: Boolean(activeConversationId || activePeerId)
    });
    if (!chatSseReconnectNoticeTimer) {
      chatSseReconnectNoticeTimer = setTimeout(() => {
        chatSseReconnectNoticeTimer = null;
        if (!chatSse && typeof reportServerConnectionDegraded === 'function') {
          reportServerConnectionDegraded('chat-sse');
        }
      }, 3000);
    }
    try {
      chatSse.close();
    } catch (_) {
      // ignore close errors
    }
    chatSse = null;
    logChatLive('disconnected', {
      route: window.location.pathname + window.location.search
    });
    setTimeout(startMessagesSse, 2000);
  };
}

function stopMessagesSse() {
  const hadSse = Boolean(chatSse);
  if (chatSseReconnectNoticeTimer) {
    clearTimeout(chatSseReconnectNoticeTimer);
    chatSseReconnectNoticeTimer = null;
  }
  if (chatLiveDebounceTimer) {
    clearTimeout(chatLiveDebounceTimer);
    chatLiveDebounceTimer = null;
  }
  chatLiveInFlight = false;
  chatLivePending = false;
  chatLiveSuppressUntil = 0;
  chatSseLastErrorLogAt = 0;
  chatLiveLastFallbackLogAt = 0;
  clearChatLivePendingHints();
  if (chatSse) {
    chatSse.close();
    chatSse = null;
  }
  try {
    window.__chatLiveConnectedAt = 0;
  } catch (e) {}
  if (hadSse) {
    logChatLive('disconnected', {
      reason: 'stop',
      route: window.location.pathname + window.location.search
    });
  }
  if (typeof reportServerConnectionOk === 'function') {
    reportServerConnectionOk('chat-sse');
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

function refreshUnreadCountFallback() {
  if (!currentUser) return;
  scheduleChatLiveRefresh('unread-fallback', 0, {
    needsUsers: true,
    needsActive: Boolean(activeConversationId || activePeerId),
    fallback: true
  });
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

async function refreshChatUsers({
  applyProfileDeeplink = true,
  force = false,
  reason = 'manual',
  refreshActiveConversation = true
} = {}) {
  if (!currentUser) return false;
  const fetchOptions = {
    connectionSource: force ? 'chat-users:refresh' : 'chat-users'
  };
  if (force) {
    Object.assign(fetchOptions, typeof getLiveNoCacheFetchOptions === 'function'
      ? getLiveNoCacheFetchOptions(fetchOptions)
      : {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      });
  }
  const res = await apiFetch('/api/chat/users', fetchOptions);
  if (!res.ok) return false;
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

  if (applyProfileDeeplink && await applyProfileChatDeeplinkFromRoute()) {
    return true;
  }

  if (refreshActiveConversation && activePeerId) {
    const conversationId = conversationByPeer.get(activePeerId) || null;
    if (conversationId) {
      activeConversationId = conversationId;
      const opened = await loadConversationMessages(conversationId, {
        initial: true,
        force,
        reason: `users:${reason}`,
        preserveLocalPending: force
      });
      if (opened) markActiveConversationSeen(activePeerId);
    } else {
      renderActiveConversation();
    }
  } else {
    renderActiveConversation();
  }
  return true;
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
  activeConversationError = '';
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
  markActiveConversationSeen(peerId);
}

async function applyProfileChatDeeplinkFromRoute() {
  const deeplink = getProfileChatDeeplinkFromRoute();
  if (!deeplink) {
    lastAppliedProfileChatDeeplinkKey = '';
    return false;
  }
  const key = `${deeplink.peerId || ''}|${deeplink.conversationId || ''}`;
  if (lastAppliedProfileChatDeeplinkKey === key) return true;
  lastAppliedProfileChatDeeplinkKey = key;

  await openConversationFromDeeplink(deeplink);
  return true;
}

function getProfileChatDeeplinkFromRoute() {
  let url;
  try {
    url = new URL(window.location.href);
  } catch (err) {
    return null;
  }
  if (!url.pathname.startsWith('/profile/')) return null;
  const peerId = (url.searchParams.get('openChatWith') || '').trim();
  const conversationId = (url.searchParams.get('conversationId') || '').trim();
  if (!peerId && !conversationId) return null;
  return { peerId, conversationId };
}

async function openConversationFromDeeplink({ peerId, conversationId } = {}) {
  activeConversationError = '';

  if (!peerId) {
    setConversationOpenError('Ссылка на чат неполная: не указан собеседник.');
    return;
  }
  if (currentUser && peerId === currentUser.id) {
    setConversationOpenError('Нельзя открыть диалог с самим собой.');
    return;
  }

  const peer = chatUsers.find(user => user.id === peerId);
  if (!peer) {
    setConversationOpenError('Пользователь из ссылки недоступен.');
    return;
  }

  activePeerId = peerId;
  activeConversationId = conversationId || conversationByPeer.get(peerId) || null;
  renderChatUsers();
  updateComposeState();

  if (!activeConversationId) {
    if (peerId === SYSTEM_USER_ID) {
      setConversationOpenError('Системный диалог доступен только для уже существующей переписки.');
      return;
    }
    renderActiveConversation();
    return;
  }

  if (peerId === SYSTEM_USER_ID && peer.conversationId !== activeConversationId) {
    setConversationOpenError('Системный диалог из ссылки недоступен.');
    return;
  }

  const opened = await loadConversationMessages(activeConversationId, {
    initial: true,
    expectedPeerId: peerId
  });
  if (!opened) return;

  conversationByPeer.set(peerId, activeConversationId);
  peerByConversation.set(activeConversationId, peerId);
  markActiveConversationSeen(peerId);
}

function setConversationOpenError(message) {
  activeConversationError = message || 'Диалог недоступен.';
  renderActiveConversation();
}

function markActiveConversationSeen(peerId = activePeerId) {
  const cache = activeConversationId ? messagesCache.get(activeConversationId) : null;
  if (!cache) return;
  const lastSeq = cache.messages.reduce((max, message) => Math.max(max, Number(message?.seq || 0)), 0);
  if (lastSeq > 0) {
    const ownState = cache.states?.[currentUser?.id] || {};
    const deliveredSeq = Number(ownState.lastDeliveredSeq || 0);
    const readSeq = Number(ownState.lastReadSeq || 0);
    if (deliveredSeq < lastSeq) {
      markConversationDelivered(activeConversationId, lastSeq).catch(err => {
        console.warn('[LIVE] chat delivered fallback write failed', {
          conversationId: activeConversationId,
          error: err?.message || String(err)
        });
      });
    }
    if (readSeq < lastSeq) {
      markConversationRead(activeConversationId, lastSeq).catch(err => {
        console.warn('[LIVE] chat read fallback write failed', {
          conversationId: activeConversationId,
          error: err?.message || String(err)
        });
      });
    }
    updateUserMetrics(peerId, { unreadReset: true });
  }
}

function updateComposeState() {
  if (!chatInputEl || !chatSendBtn) return;
  const disabled = !activePeerId || activePeerId === SYSTEM_USER_ID || Boolean(activeConversationError);
  chatInputEl.disabled = disabled;
  chatSendBtn.disabled = disabled;
  chatInputEl.placeholder = disabled
    ? (activePeerId === SYSTEM_USER_ID ? 'Системе нельзя писать' : (activeConversationError || 'Выберите пользователя'))
    : 'Введите сообщение...';
}

async function readChatErrorResponse(res, fallbackMessage = 'Ошибка чата') {
  const payload = await res?.json?.().catch(() => ({}));
  return payload?.error || fallbackMessage;
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
  setChatLiveLocalWriteSuppressWindow(500);
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
      if (!directRes.ok) throw new Error(await readChatErrorResponse(directRes, 'Не удалось создать диалог'));
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

    if (!sendAttempt.ok) throw new Error(await readChatErrorResponse(sendAttempt.res, 'Ошибка отправки'));
    const message = sendAttempt.message;
    if (!message) throw new Error('Некорректный ответ сервера');

    const cache = ensureConversationCache(conversationId);
    replacePendingMessage(cache, clientMsgId, message);
    sortMessages(cache.messages);

    updateUserMetrics(activePeerId, { messageDelta: 1, history: true });
    renderActiveConversation();
    scheduleChatLiveRefresh('local-write', CHAT_LIVE_DEBOUNCE_MS, {
      conversationId,
      peerId: activePeerId,
      needsUsers: true,
      needsActive: true
    });
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
    setChatLiveLocalWriteSuppressWindow(500);
    const sendRes = await apiFetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: msg.text, clientMsgId })
    });
    if (!sendRes.ok) throw new Error(await readChatErrorResponse(sendRes, 'Ошибка отправки'));
    const sendPayload = await sendRes.json().catch(() => ({}));
    const message = sendPayload.message;
    if (!message) throw new Error('Некорректный ответ сервера');
    const convCache = ensureConversationCache(conversationId);
    replacePendingMessage(convCache, clientMsgId, message);
    renderActiveConversation();
    scheduleChatLiveRefresh('local-retry-write', CHAT_LIVE_DEBOUNCE_MS, {
      conversationId,
      peerId,
      needsUsers: true,
      needsActive: true
    });
  } catch (err) {
    markFailedMessage(clientMsgId, err.message);
    renderActiveConversation();
  }
}

async function loadConversationMessages(conversationId, {
  beforeSeq = null,
  initial = false,
  expectedPeerId = null,
  force = false,
  reason = 'manual',
  preserveLocalPending = false
} = {}) {
  if (!conversationId || loadingHistory) return false;
  loadingHistory = true;
  if (chatScrollLoaderEl) chatScrollLoaderEl.classList.remove('hidden');
  const limit = 50;
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  if (beforeSeq) params.set('beforeSeq', String(beforeSeq));
  if (expectedPeerId) params.set('peerId', String(expectedPeerId));
  const url = `/api/chat/conversations/${encodeURIComponent(conversationId)}/messages?${params.toString()}`;
  const fetchOptions = {
    connectionSource: force ? `chat-messages:refresh:${reason}` : 'chat-messages'
  };
  if (force) {
    Object.assign(fetchOptions, typeof getLiveNoCacheFetchOptions === 'function'
      ? getLiveNoCacheFetchOptions(fetchOptions)
      : {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      });
  }

  try {
    const res = await apiFetch(url, fetchOptions);
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      if (initial) {
        setConversationOpenError(payload?.error || 'Диалог недоступен.');
      }
      return false;
    }
    const payload = await res.json().catch(() => ({}));
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const cache = ensureConversationCache(conversationId);
    const localOnlyMessages = preserveLocalPending
      ? cache.messages.filter(item => (
        item
        && item.clientMsgId
        && (item.pending || item.failed)
        && !messages.some(serverMsg => (
          serverMsg
          && (serverMsg.id === item.id || serverMsg.clientMsgId === item.clientMsgId)
        ))
      ))
      : [];

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
      cache.messages = localOnlyMessages.length ? [...messages, ...localOnlyMessages] : messages;
      sortMessages(cache.messages);
      cache.oldestSeq = cache.messages.length ? cache.messages[0].seq : null;
      cache.hasMore = payload.hasMore ?? (messages.length === limit);
      renderActiveConversation({ scrollToBottom: true });
    }
    return true;
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

  if (activeConversationError) {
    setEmptyState(activeConversationError);
    return;
  }

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
    if (message.error) {
      const errorEl = document.createElement('div');
      errorEl.className = 'chat-msg-error';
      errorEl.textContent = message.error;
      wrapper.appendChild(errorEl);
    }
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
  activeConversationError = '';
  lastAppliedProfileChatDeeplinkKey = '';
  renderActiveConversation();
  renderChatUsers();
}
