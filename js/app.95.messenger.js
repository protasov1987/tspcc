let messagesSse = null;
let chatTabs = [];
let activePeerId = 'SYSTEM';
let messengerUiReady = false;
const chatHistory = new Map();
let chatTabsEl = null;
let chatPanelEl = null;
let chatInputEl = null;
let chatSendBtn = null;
let chatUserSelect = null;
let chatOpenBtn = null;

function startMessagesSse() {
  if (messagesSse) return;
  messagesSse = new EventSource('/api/messages/stream');

  messagesSse.addEventListener('unread_count', (event) => {
    try {
      const payload = JSON.parse(event.data || '{}');
      unreadMessagesCount = payload.count || 0;
      updateUserBadge();
    } catch (err) {
      console.warn('Failed to parse unread_count', err);
    }
  });

  messagesSse.addEventListener('message', (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data || '{}');
    } catch (err) {
      console.warn('Failed to parse message event', err);
      return;
    }
    const message = payload.message;
    if (!message) return;
    if (message.toUserId === currentUser?.id) {
      addMessageToHistory(message);
      const profileView = document.getElementById('user-profile-view');
      if (profileView && !profileView.classList.contains('hidden') && message.fromUserId === activePeerId) {
        appendChatMessage(message);
      }
    }
  });

  messagesSse.onerror = () => {
    try {
      messagesSse.close();
    } catch (_) {
      // ignore close errors
    }
    messagesSse = null;
    setTimeout(startMessagesSse, 2000);
  };
}

function stopMessagesSse() {
  if (messagesSse) {
    messagesSse.close();
    messagesSse = null;
  }
}

function initMessengerUiOnce() {
  if (messengerUiReady) return;
  chatTabsEl = document.getElementById('chat-tabs');
  chatPanelEl = document.getElementById('chat-panel');
  chatInputEl = document.getElementById('chat-input');
  chatSendBtn = document.getElementById('chat-send');
  chatUserSelect = document.getElementById('chat-user-select');
  chatOpenBtn = document.getElementById('chat-open-btn');

  if (chatTabsEl) {
    chatTabsEl.addEventListener('click', (event) => {
      const closeBtn = event.target.closest('.tab-pill-close');
      if (closeBtn) {
        const peerId = closeBtn.dataset.id;
        if (peerId) closeChatTab(peerId);
        return;
      }
      const target = event.target.closest('.tab-pill');
      if (!target) return;
      const peerId = target.dataset.id;
      if (peerId) openDialog(peerId);
    });
  }

  if (chatOpenBtn) {
    chatOpenBtn.addEventListener('click', () => {
      if (!chatUserSelect) return;
      const peerId = chatUserSelect.value || '';
      if (peerId) openDialog(peerId);
    });
  }

  if (chatSendBtn) {
    chatSendBtn.addEventListener('click', async () => {
      if (!chatInputEl || !currentUser) return;
      if (activePeerId === 'SYSTEM') return;
      const text = (chatInputEl.value || '').toString().trim();
      if (!text) return;
      const res = await apiFetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toUserId: activePeerId, text })
      });
      if (!res.ok) return;
      const payload = await res.json().catch(() => ({}));
      if (payload && payload.message) {
        chatInputEl.value = '';
        addMessageToHistory(payload.message);
        appendChatMessage(payload.message);
      }
    });
  }

  messengerUiReady = true;
}

function renderChatUserSelect() {
  if (!chatUserSelect) return;
  const options = (users || [])
    .filter(u => u && u.id && u.id !== currentUser?.id)
    .map(u => ({ id: u.id, name: u.name || 'Пользователь' }));
  chatUserSelect.innerHTML = options
    .map(u => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.name)}</option>`)
    .join('');
}

function renderChatTabs() {
  if (!chatTabsEl) return;
  chatTabsEl.innerHTML = chatTabs.map(tab => {
    const activeClass = tab.peerId === activePeerId ? ' active' : '';
    return `<div class="tab-pill${activeClass}" data-id="${escapeHtml(tab.peerId)}">` +
      `<button type="button" class="tab-pill-btn" data-id="${escapeHtml(tab.peerId)}">${escapeHtml(tab.title)}</button>` +
      `<button type="button" class="tab-pill-close" data-id="${escapeHtml(tab.peerId)}" aria-label="Закрыть чат">×</button>` +
      `</div>`;
  }).join('');
}

function formatChatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function renderChatMessages(messages = []) {
  if (!chatPanelEl) return;
  const html = (messages || []).map(msg => {
    const isMine = msg.fromUserId === currentUser?.id;
    const klass = isMine ? 'chat-msg me' : 'chat-msg other';
    const time = formatChatTime(msg.createdAt || msg.at || '');
    const text = escapeHtml(msg.text || '');
    return `<div class="${klass}">` +
      `<div class="chat-msg-time">${escapeHtml(time)}</div>` +
      `<div class="chat-msg-text">${text}</div>` +
      `</div>`;
  }).join('');
  chatPanelEl.innerHTML = html;
  chatPanelEl.scrollTop = chatPanelEl.scrollHeight;
}

function appendChatMessage(message) {
  if (!chatPanelEl || !message) return;
  const isMine = message.fromUserId === currentUser?.id;
  const klass = isMine ? 'chat-msg me' : 'chat-msg other';
  const time = formatChatTime(message.createdAt || message.at || '');
  const text = escapeHtml(message.text || '');
  const wrapper = document.createElement('div');
  wrapper.className = klass;
  wrapper.innerHTML = `<div class="chat-msg-time">${escapeHtml(time)}</div>` +
    `<div class="chat-msg-text">${text}</div>`;
  chatPanelEl.appendChild(wrapper);
  chatPanelEl.scrollTop = chatPanelEl.scrollHeight;
}

function addMessageToHistory(message) {
  if (!message || !currentUser) return;
  const peerId = message.fromUserId === currentUser.id ? message.toUserId : message.fromUserId;
  if (!peerId) return;
  const history = chatHistory.get(peerId) || [];
  history.push(message);
  chatHistory.set(peerId, history);
}

function setChatHistory(peerId, messages = []) {
  if (!peerId) return;
  chatHistory.set(peerId, Array.isArray(messages) ? messages : []);
}

function getChatHistory(peerId) {
  if (!peerId) return [];
  return chatHistory.get(peerId) || [];
}

function closeChatTab(peerId) {
  const index = chatTabs.findIndex(tab => tab.peerId === peerId);
  if (index === -1) return;
  chatTabs.splice(index, 1);
  const wasActive = activePeerId === peerId;
  if (wasActive) {
    const nextTab = chatTabs[0];
    activePeerId = nextTab ? nextTab.peerId : 'SYSTEM';
  }
  renderChatTabs();
  if (wasActive) {
    if (activePeerId === 'SYSTEM') {
      renderChatMessages([]);
      if (chatInputEl && chatSendBtn) {
        chatInputEl.disabled = true;
        chatSendBtn.disabled = true;
      }
    } else {
      openDialog(activePeerId);
    }
  }
}

async function openDialog(peerId) {
  if (!peerId) return;
  const existing = chatTabs.find(tab => tab.peerId === peerId);
  if (!existing) {
    const title = peerId === 'SYSTEM'
      ? 'Система'
      : (users.find(u => u.id === peerId)?.name || 'Пользователь');
    chatTabs.push({ peerId, title });
  }
  activePeerId = peerId;
  renderChatTabs();

  if (chatInputEl && chatSendBtn) {
    const disabled = peerId === 'SYSTEM';
    chatInputEl.disabled = disabled;
    chatSendBtn.disabled = disabled;
  }

  const cachedMessages = getChatHistory(peerId);
  if (cachedMessages.length) {
    renderChatMessages(cachedMessages);
  } else {
    renderChatMessages([]);
  }

  const res = await apiFetch('/api/messages/dialog/' + encodeURIComponent(peerId), { method: 'GET' });
  if (res.ok) {
    const payload = await res.json().catch(() => ({}));
    const messages = payload.messages || [];
    setChatHistory(peerId, messages);
    if (activePeerId === peerId) {
      renderChatMessages(messages);
    }
  }

  await apiFetch('/api/messages/mark-read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ peerId })
  });
}
