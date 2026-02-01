const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const https = require('https');
const webpush = require('web-push');
const { GoogleAuth } = require('google-auth-library');
const { JsonDatabase, deepClone } = require('./db');
const { createAuthStore, createSessionStore, hashPassword, verifyPassword } = require('./server/authStore');

// === SSE Event Bus (cards live) ===
const SSE_CLIENTS = new Set();
const MSG_SSE_CLIENTS = new Map(); // userId -> Set(res)

const WEBPUSH_VAPID_PUBLIC = (process.env.WEBPUSH_VAPID_PUBLIC || '').trim();
const WEBPUSH_VAPID_PRIVATE = (process.env.WEBPUSH_VAPID_PRIVATE || '').trim();
const WEBPUSH_VAPID_SUBJECT = (process.env.WEBPUSH_VAPID_SUBJECT || '').trim();
const FCM_SERVER_KEY = (process.env.FCM_SERVER_KEY || '').trim();
const FCM_SERVICE_ACCOUNT_PATH = (process.env.FCM_SERVICE_ACCOUNT_PATH || '').trim();
const FCM_PROJECT_ID = (process.env.FCM_PROJECT_ID || '').trim();

function isWebPushConfigured() {
  return Boolean(WEBPUSH_VAPID_PUBLIC && WEBPUSH_VAPID_PRIVATE && WEBPUSH_VAPID_SUBJECT);
}

function isFcmConfigured() {
  return Boolean(FCM_SERVICE_ACCOUNT_PATH || FCM_SERVER_KEY);
}

if (isWebPushConfigured()) {
  try {
    webpush.setVapidDetails(WEBPUSH_VAPID_SUBJECT, WEBPUSH_VAPID_PUBLIC, WEBPUSH_VAPID_PRIVATE);
  } catch (err) {
    console.error('Failed to init web-push VAPID', err);
  }
}

function sseWrite(res, eventName, obj) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

function sseBroadcast(eventName, obj) {
  for (const res of SSE_CLIENTS) {
    try {
      sseWrite(res, eventName, obj);
    } catch (e) {
      SSE_CLIENTS.delete(res);
    }
  }
}

function msgSseWrite(res, eventName, obj) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

function msgSseBroadcast(eventName, payloadObj) {
  for (const [, clients] of MSG_SSE_CLIENTS.entries()) {
    for (const res of clients) {
      try {
        msgSseWrite(res, eventName, payloadObj);
      } catch (e) {
        // cleanup handled in caller or next write
      }
    }
  }
}

function msgSseAddClient(userId, res) {
  if (!userId || !res) return;
  const key = String(userId);
  const existing = MSG_SSE_CLIENTS.get(key);
  const wasOnline = existing && existing.size > 0;
  if (!existing) {
    MSG_SSE_CLIENTS.set(key, new Set());
  }
  MSG_SSE_CLIENTS.get(key).add(res);
  if (!wasOnline) {
    msgSseBroadcast('user_status', { userId: key, isOnline: true });
  }
}

function msgSseRemoveClient(userId, res) {
  const key = String(userId || '');
  if (!MSG_SSE_CLIENTS.has(key)) return;
  const set = MSG_SSE_CLIENTS.get(key);
  set.delete(res);
  if (set.size === 0) {
    MSG_SSE_CLIENTS.delete(key);
    msgSseBroadcast('user_status', { userId: key, isOnline: false });
  }
}

function msgSseSendToUser(userId, eventName, payloadObj) {
  const key = String(userId || '');
  const clients = MSG_SSE_CLIENTS.get(key);
  if (!clients) return;
  for (const res of clients) {
    try {
      msgSseWrite(res, eventName, payloadObj);
    } catch (e) {
      msgSseRemoveClient(key, res);
    }
  }
}

function broadcastCardsChanged(saved) {
  const rev = saved?.meta?.revision;
  sseBroadcast('cards:changed', { revision: rev });
}

// keep-alive for SSE (nginx/proxy friendly)
setInterval(() => {
  for (const res of SSE_CLIENTS) {
    try {
      res.write(`: ping ${Date.now()}\n\n`);
    } catch (e) {
      SSE_CLIENTS.delete(res);
    }
  }
}, 25000);

setInterval(() => {
  for (const [userId, clients] of MSG_SSE_CLIENTS.entries()) {
    for (const res of clients) {
      try {
        res.write(': ping\n\n');
      } catch (e) {
        msgSseRemoveClient(userId, res);
      }
    }
  }
}, 25000);

function resolveStorageDir() {
  const env = (process.env.TSPCC_STORAGE_DIR || '').trim();
  if (env) return env;

  const candidates = [
    path.join(__dirname, 'storage'),
    path.join(__dirname, '..', 'storage'),
    path.join(__dirname, '..', '..', 'storage'),
    '/var/www/tspcc.ru/storage'
  ];

  for (const base of candidates) {
    try {
      if (fs.existsSync(path.join(base, 'cards'))) return base;
    } catch (_) {
      // ignore fs errors while probing storage candidates
    }
  }

  return candidates[0];
}

const PORT = process.env.PORT || 8000;
// Bind to all interfaces by default to allow external access (e.g., on VDS)
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = __dirname;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'database.json');
const STORAGE_DIR = resolveStorageDir();
const CARDS_STORAGE_DIR = path.join(STORAGE_DIR, 'cards');
// eslint-disable-next-line no-console
console.log('[storage] STORAGE_DIR=', STORAGE_DIR, 'CARDS_STORAGE_DIR=', CARDS_STORAGE_DIR);
const TEMPLATE_DIR = path.join(__dirname, 'templates');
const MK_PRINT_TEMPLATE = path.join(TEMPLATE_DIR, 'print', 'mk-print.ejs');
const BARCODE_MK_TEMPLATE = path.join(TEMPLATE_DIR, 'print', 'barcode-mk.ejs');
const BARCODE_GROUP_TEMPLATE = path.join(TEMPLATE_DIR, 'print', 'barcode-group.ejs');
const BARCODE_PASSWORD_TEMPLATE = path.join(TEMPLATE_DIR, 'print', 'barcode-password.ejs');
const LOG_SUMMARY_TEMPLATE = path.join(TEMPLATE_DIR, 'print', 'log-summary.ejs');
const LOG_FULL_TEMPLATE = path.join(TEMPLATE_DIR, 'print', 'log-full.ejs');
const { generateQrSvg } = require('./generateQrSvg');
const MAX_BODY_SIZE = 60 * 1024 * 1024; // 60 MB to allow attachments
const FILE_SIZE_LIMIT = 15 * 1024 * 1024; // 15 MB per attachment
const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.zip', '.rar', '.7z'];
const DEFAULT_ADMIN_PASSWORD = 'ssyba';
const DEFAULT_ADMIN = { name: 'Abyss', role: 'admin' };
const SYSTEM_USER_ID = 'system';
const SESSION_COOKIE = 'session';
const PUBLIC_API_PATHS = new Set(['/api/login', '/api/logout', '/api/session']);
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';

const DEFAULT_PERMISSIONS = {
  tabs: {
    dashboard: { view: true, edit: true },
    cards: { view: true, edit: true },
    approvals: { view: true, edit: true },
    provision: { view: true, edit: true },
    'input-control': { view: true, edit: true },
    production: { view: true, edit: true },
    departments: { view: true, edit: true },
    operations: { view: true, edit: true },
    areas: { view: true, edit: true },
    employees: { view: true, edit: true },
    'shift-times': { view: true, edit: true },
    workorders: { view: true, edit: true },
    archive: { view: true, edit: true },
    workspace: { view: true, edit: true },
    users: { view: true, edit: true },
    accessLevels: { view: true, edit: true }
  },
  attachments: { upload: true, remove: true },
  landingTab: 'dashboard',
  inactivityTimeoutMinutes: 30,
  worker: false,
  headProduction: false,
  headSKK: false,
  deputyTechDirector: false
};
const OPERATION_TYPE_OPTIONS = ['Стандартная', 'Идентификация', 'Документы'];
const DEFAULT_OPERATION_TYPE = OPERATION_TYPE_OPTIONS[0];

const SPA_ROUTES = new Set([
  '/cards',
  '/cards/new',
  '/dashboard',
  '/approvals',
  '/provision',
  '/input-control',
  '/workorders',
  '/archive',
  '/workspace',
  '/accessLevels',
  '/departments',
  '/operations',
  '/areas',
  '/employees',
  '/shift-times',
  '/production/schedule',
  '/production/plan',
  '/production/shifts',
  '/production/delayed',
  '/production/defects',
  '/profile',
  '/'
]);

const renderMkPrint = buildTemplateRenderer(MK_PRINT_TEMPLATE);
const renderBarcodeMk = buildTemplateRenderer(BARCODE_MK_TEMPLATE);
const renderBarcodeGroup = buildTemplateRenderer(BARCODE_GROUP_TEMPLATE);
const renderBarcodePassword = buildTemplateRenderer(BARCODE_PASSWORD_TEMPLATE);
const renderLogSummary = buildTemplateRenderer(LOG_SUMMARY_TEMPLATE);
const renderLogFull = buildTemplateRenderer(LOG_FULL_TEMPLATE);
const BARCODE_SVG_OPTIONS = { width: 220, margin: 1, errorCorrectionLevel: 'M' };

async function makeBarcodeSvg(value) {
  return generateQrSvg(normalizeQrInput(value || ''), BARCODE_SVG_OPTIONS);
}

function genId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
}

const USER_ID_PATTERN = /^id(\d{6})$/;

function getUserByIdOrLegacy(data, id) {
  if (!id) return null;
  return (data?.users || []).find(u => u && (u.id === id || u.legacyId === id)) || null;
}

function getUserIdAliases(user) {
  const ids = new Set();
  if (user?.id) ids.add(user.id);
  if (user?.legacyId) ids.add(user.legacyId);
  return ids;
}

function isChatDebug(req) {
  try {
    const u = new URL(req.url, 'http://localhost');
    if (u.searchParams.get('debugChat') === '1') return true;
  } catch {}
  return process.env.DEBUG_CHAT === '1';
}

function newReqId() {
  return `chatdbg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function chatDbg(req, reqId, label, payload) {
  if (!isChatDebug(req)) return;
  if (payload === undefined) console.log('[CHATDBG]', reqId, label);
  else console.log('[CHATDBG]', reqId, label, payload);
}

function getUserIdAliasSet(userOrId, data) {
  if (!userOrId) return new Set();
  if (typeof userOrId === 'object') return getUserIdAliases(userOrId);
  const user = getUserByIdOrLegacy(data, String(userOrId));
  return user ? getUserIdAliases(user) : new Set([String(userOrId)]);
}

function normalizeChatUserId(id, data) {
  const raw = String(id || '').trim();
  if (!raw) return '';
  if (raw === SYSTEM_USER_ID) return SYSTEM_USER_ID;
  const user = getUserByIdOrLegacy(data, raw);
  return user?.id ? String(user.id) : raw;
}

function normUserId(x) {
  if (x == null) return '';
  return String(x).trim();
}

function conversationHasParticipant(conversation, userAliasSet) {
  if (!conversation || !Array.isArray(conversation.participantIds)) return false;
  for (const pid of conversation.participantIds) {
    if (userAliasSet.has(String(pid))) return true;
  }
  return false;
}

function getConversationPeerIdByAliases(conversation, meAliasSet) {
  if (!conversation || !Array.isArray(conversation.participantIds)) return null;
  const peer = conversation.participantIds.find(pid => !meAliasSet.has(String(pid)));
  return peer ? String(peer) : null;
}

function createUserId(existingUsers = []) {
  const usedIds = new Set();
  let maxValue = 0;
  (existingUsers || []).forEach(user => {
    const match = USER_ID_PATTERN.exec(trimToString(user?.id));
    if (!match) return;
    const num = parseInt(match[1], 10);
    if (Number.isFinite(num)) {
      maxValue = Math.max(maxValue, num);
    }
    usedIds.add(`id${String(num).padStart(6, '0')}`);
  });
  let candidate = '';
  let attempts = 0;
  do {
    maxValue = maxValue >= 999999 ? 1 : maxValue + 1;
    candidate = `id${String(maxValue).padStart(6, '0')}`;
    attempts += 1;
    if (attempts > 1000000) {
      throw new Error('Cannot allocate user id');
    }
  } while (usedIds.has(candidate));
  return candidate;
}

function getUnreadCountForUser(userId, data) {
  if (!userId) return 0;
  if (userId === 'SYSTEM') return 0;
  const user = getUserByIdOrLegacy(data, userId);
  const aliases = user ? getUserIdAliases(user) : new Set([userId]);
  const messages = Array.isArray(data?.messages) ? data.messages : [];
  return messages.filter(m => m && aliases.has(m.toUserId) && !m.readAt).length;
}

function sortParticipantIds(a, b) {
  return [String(a), String(b)].sort();
}

function findDirectConversation(data, participantIds = []) {
  const list = Array.isArray(data?.chatConversations) ? data.chatConversations : [];
  const [first, second] = participantIds;
  if (!first || !second) return null;
  return list.find(conv => {
    if (!conv || conv.type !== 'direct') return false;
    if (!Array.isArray(conv.participantIds) || conv.participantIds.length !== 2) return false;
    return conv.participantIds[0] === first && conv.participantIds[1] === second;
  }) || null;
}

function getConversationPeerId(conversation, meId) {
  if (!conversation || !meId || !Array.isArray(conversation.participantIds)) return null;
  return conversation.participantIds.find(id => id !== meId) || null;
}

function normalizeChatConversationsParticipants(draft) {
  if (!Array.isArray(draft.chatConversations)) return;
  draft.chatConversations = draft.chatConversations.map(conv => {
    if (!conv || !Array.isArray(conv.participantIds) || conv.participantIds.length !== 2) return conv;
    const normalized = conv.participantIds.map(pid => normalizeChatUserId(pid, draft));
    const sorted = sortParticipantIds(normalized[0], normalized[1]);
    if (sorted[0] === conv.participantIds[0] && sorted[1] === conv.participantIds[1]) {
      return conv;
    }
    return { ...conv, participantIds: sorted };
  });
}

function getConversationMessages(data, conversationId) {
  const list = Array.isArray(data?.chatMessages) ? data.chatMessages : [];
  return list.filter(msg => msg && msg.conversationId === conversationId);
}

function getChatStateForUser(data, conversationId, userId) {
  const list = Array.isArray(data?.chatStates) ? data.chatStates : [];
  return list.find(state => state && state.conversationId === conversationId && state.userId === userId) || null;
}

async function appendUserVisit(userId) {
  if (!userId) return;
  await database.update(current => {
    const draft = normalizeData(current);
    if (!Array.isArray(draft.userVisits)) draft.userVisits = [];
    draft.userVisits.push({ id: genId('visit'), userId, at: new Date().toISOString() });
    return draft;
  });
}

async function appendUserAction(userId, text) {
  if (!userId || !text) return;
  await database.update(current => {
    const draft = normalizeData(current);
    if (!Array.isArray(draft.userActions)) draft.userActions = [];
    draft.userActions.push({ id: genId('act'), userId, at: new Date().toISOString(), text });
    return draft;
  });
}

function formatCardLabel(card) {
  if (!card) return 'Карта';
  const route = trimToString(card.routeCardNumber || card.orderNo || '');
  const name = trimToString(card.name || card.itemName || '');
  const id = trimToString(card.id || '');
  if (route && name) return `${route} · ${name}`;
  return route || name || id || 'Карта';
}

function formatCardLogEntry(entry, card) {
  if (!entry) return '';
  const action = trimToString(entry.action || 'Действие');
  const object = trimToString(entry.object || '');
  const field = trimToString(entry.field || '');
  const oldVal = trimToString(entry.oldValue || '');
  const newVal = trimToString(entry.newValue || '');
  let text = action;
  if (object) text += `: ${object}`;
  if (field) text += ` (${field})`;
  if (oldVal || newVal) {
    const parts = [];
    if (oldVal) parts.push(`было «${oldVal}»`);
    if (newVal) parts.push(`стало «${newVal}»`);
    text += ` — ${parts.join(', ')}`;
  }
  text += ` (Карта: ${formatCardLabel(card)})`;
  return text;
}

function normalizeSurname(value) {
  return trimToString(value).toLowerCase();
}

function resolveUserByIssuedSurname(data, surname) {
  const target = normalizeSurname(surname);
  if (!target) return null;
  const users = Array.isArray(data?.users) ? data.users : [];
  return users.find(u => {
    const fullName = trimToString(u?.name || u?.username || u?.login || '');
    const tokens = fullName.split(/\s+/).map(t => trimToString(t)).filter(Boolean);
    const firstToken = tokens[0] || '';
    const lastToken = tokens[tokens.length - 1] || '';
    const normalizedFull = normalizeSurname(fullName);
    return normalizedFull === target
      || normalizeSurname(firstToken) === target
      || normalizeSurname(lastToken) === target
      || (normalizedFull && normalizedFull.includes(target));
  }) || null;
}

function formatProductionStatusLabel(value) {
  const key = trimToString(value).toUpperCase();
  if (key === 'IN_PROGRESS') return 'В работе';
  if (key === 'PAUSED') return 'Пауза';
  if (key === 'DONE') return 'Завершена';
  if (key === 'NOT_STARTED') return 'Не запущена';
  return value || '—';
}

function formatApprovalStageLabel(value) {
  const key = trimToString(value).toUpperCase();
  if (key === 'DRAFT') return 'Черновик';
  if (key === 'ON_APPROVAL') return 'На согласовании';
  if (key === 'APPROVED') return 'Согласовано';
  if (key === 'REJECTED') return 'Отклонено';
  if (key === 'WAITING_PROVISION') return 'Ожидает обеспечения';
  if (key === 'WAITING_INPUT_CONTROL') return 'Ожидает входного контроля';
  if (key === 'PROVIDED') return 'Обеспечено';
  if (key === 'PLANNING') return 'Планирование';
  if (key === 'PLANNED') return 'Запланировано';
  return value || '—';
}

function buildStatusChangeMessage({ card, type, fromValue, toValue }) {
  const cardLabel = formatCardLabel(card);
  if (type === 'production') {
    return `Производственный статус изменён: ${cardLabel}. Было «${formatProductionStatusLabel(fromValue)}», стало «${formatProductionStatusLabel(toValue)}».`;
  }
  return `Статус согласования изменён: ${cardLabel}. Было «${formatApprovalStageLabel(fromValue)}», стало «${formatApprovalStageLabel(toValue)}».`;
}

function collectStatusChangeNotifications(prev, saved) {
  const notifications = [];
  const seen = new Set();
  const prevCards = Array.isArray(prev?.cards) ? prev.cards : [];
  const nextCards = Array.isArray(saved?.cards) ? saved.cards : [];
  const prevMap = new Map(prevCards.map(c => [c.id, c]));
  const nextMap = new Map(nextCards.map(c => [c.id, c]));

  nextMap.forEach((nextCard, id) => {
    const prevCard = prevMap.get(id);
    if (!prevCard || !nextCard) return;
    const prodPrev = prevCard.productionStatus || prevCard.status || '';
    const prodNext = nextCard.productionStatus || nextCard.status || '';
    if (prodPrev !== prodNext) {
      const key = `${id}|production|${prodPrev}|${prodNext}`;
      if (!seen.has(key)) {
        seen.add(key);
        notifications.push({
          card: nextCard,
          type: 'production',
          fromValue: prodPrev,
          toValue: prodNext
        });
      }
    }
    const apprPrev = prevCard.approvalStage || '';
    const apprNext = nextCard.approvalStage || '';
    if (apprPrev !== apprNext) {
      const key = `${id}|approval|${apprPrev}|${apprNext}`;
      if (!seen.has(key)) {
        seen.add(key);
        notifications.push({
          card: nextCard,
          type: 'approval',
          fromValue: apprPrev,
          toValue: apprNext
        });
      }
    }
  });

  prevMap.forEach((prevCard, id) => {
    const nextCard = nextMap.get(id);
    if (!nextCard) return;
    const prevLogs = Array.isArray(prevCard?.logs) ? prevCard.logs : [];
    const nextLogs = Array.isArray(nextCard?.logs) ? nextCard.logs : [];
    if (!nextLogs.length) return;
    const prevIds = new Set(prevLogs.map(l => l && l.id).filter(Boolean));
    nextLogs.forEach(log => {
      if (!log || !log.id || prevIds.has(log.id)) return;
      const field = trimToString(log.field || '');
      if (field === 'approvalStage') {
        const key = `${id}|approval|${log.oldValue || ''}|${log.newValue || ''}`;
        if (seen.has(key)) return;
        seen.add(key);
        notifications.push({
          card: nextCard,
          type: 'approval',
          fromValue: log.oldValue || '',
          toValue: log.newValue || ''
        });
      }
      if (field === 'productionStatus' || field === 'status') {
        const key = `${id}|production|${log.oldValue || ''}|${log.newValue || ''}`;
        if (seen.has(key)) return;
        seen.add(key);
        notifications.push({
          card: nextCard,
          type: 'production',
          fromValue: log.oldValue || '',
          toValue: log.newValue || ''
        });
      }
    });
  });

  return notifications;
}

function ensureSystemConversation(draft, userId) {
  if (!userId) return null;
  if (!Array.isArray(draft.chatConversations)) draft.chatConversations = [];
  const participantIds = sortParticipantIds(SYSTEM_USER_ID, String(userId));
  let convo = findDirectConversation(draft, participantIds);
  if (!convo) {
    convo = {
      id: genId('cvt'),
      type: 'direct',
      participantIds,
      createdAt: new Date().toISOString(),
      lastMessageId: null,
      lastMessageAt: null,
      lastMessagePreview: null
    };
    draft.chatConversations.push(convo);
  }
  return convo;
}

function appendSystemMessage(draft, userId, text) {
  if (!userId || !text) return null;
  if (!Array.isArray(draft.chatMessages)) draft.chatMessages = [];
  const convo = ensureSystemConversation(draft, userId);
  if (!convo) return null;
  const convMessages = getConversationMessages(draft, convo.id);
  const maxSeq = convMessages.reduce((max, msg) => Math.max(max, msg.seq || 0), 0);
  const message = {
    id: genId('cmsg'),
    conversationId: convo.id,
    seq: maxSeq + 1,
    senderId: SYSTEM_USER_ID,
    text,
    createdAt: new Date().toISOString(),
    clientMsgId: ''
  };
  draft.chatMessages.push(message);
  const idx = draft.chatConversations.findIndex(item => item && item.id === convo.id);
  if (idx >= 0) {
    draft.chatConversations[idx] = {
      ...draft.chatConversations[idx],
      lastMessageId: message.id,
      lastMessageAt: message.createdAt,
      lastMessagePreview: message.text.slice(0, 120)
    };
  }
  return { conversationId: convo.id, message };
}

function normalizeWebPushSubscription(input) {
  if (!input || typeof input !== 'object') return null;
  const endpoint = trimToString(input.endpoint || '');
  const keys = input.keys || {};
  const p256dh = trimToString(keys.p256dh || '');
  const auth = trimToString(keys.auth || '');
  if (!endpoint || !p256dh || !auth) return null;
  return {
    endpoint,
    keys: { p256dh, auth },
    subscription: input
  };
}

async function saveWebPushSubscriptionForUser(userId, subscription, userAgent = '') {
  if (!userId || !subscription) return false;
  await database.update(current => {
    const draft = normalizeData(current);
    if (!Array.isArray(draft.webPushSubscriptions)) draft.webPushSubscriptions = [];
    const endpoint = subscription.endpoint;
    const existingIdx = draft.webPushSubscriptions.findIndex(item =>
      item && String(item.userId) === String(userId) && String(item.endpoint) === String(endpoint)
    );
    const now = new Date().toISOString();
    const next = {
      id: existingIdx >= 0 ? draft.webPushSubscriptions[existingIdx].id : genId('wps'),
      userId: String(userId),
      endpoint,
      keys: subscription.keys,
      subscription: subscription.subscription || subscription,
      createdAt: existingIdx >= 0 ? draft.webPushSubscriptions[existingIdx].createdAt : now,
      updatedAt: now,
      userAgent: trimToString(userAgent)
    };
    if (existingIdx >= 0) {
      draft.webPushSubscriptions[existingIdx] = { ...draft.webPushSubscriptions[existingIdx], ...next };
    } else {
      draft.webPushSubscriptions.push(next);
    }
    return draft;
  });
  return true;
}

async function removeWebPushSubscriptionForUser(userId, endpoint) {
  if (!userId || !endpoint) return false;
  await database.update(current => {
    const draft = normalizeData(current);
    if (!Array.isArray(draft.webPushSubscriptions)) draft.webPushSubscriptions = [];
    draft.webPushSubscriptions = draft.webPushSubscriptions.filter(item =>
      !(item && String(item.userId) === String(userId) && String(item.endpoint) === String(endpoint))
    );
    return draft;
  });
  return true;
}

async function sendWebPushToUser(userId, payloadObj) {
  if (!isWebPushConfigured()) {
    console.log('[WebPush] Not configured');
    return false;
  }
  if (!userId) {
    console.log('[WebPush] No userId');
    return false;
  }
  const data = await database.getData();
  const list = Array.isArray(data.webPushSubscriptions) ? data.webPushSubscriptions : [];
  console.log('[WebPush] Total subscriptions:', list.length);
  const userSubs = list.filter(item => item && String(item.userId) === String(userId));
  console.log('[WebPush] Subscriptions for user', userId, ':', userSubs.length);
  if (!userSubs.length) return false;
  const payload = JSON.stringify(payloadObj || {});
  console.log('[WebPush] Sending payload:', payload);
  await Promise.all(userSubs.map(async sub => {
    try {
      console.log('[WebPush] Sending to endpoint:', sub.endpoint);
      await webpush.sendNotification(sub.subscription || { endpoint: sub.endpoint, keys: sub.keys }, payload);
      console.log('[WebPush] Sent successfully');
    } catch (err) {
      const statusCode = err?.statusCode || err?.status || 0;
      console.error('[WebPush] Error:', statusCode, err?.message || err);
      if (statusCode === 404 || statusCode === 410) {
        await removeWebPushSubscriptionForUser(userId, sub.endpoint);
      } else {
        console.error('WebPush send error', statusCode, err?.message || err);
      }
    }
  }));
  return true;
}

function normalizeFcmToken(input) {
  if (!input || typeof input !== 'object') return null;
  const token = trimToString(input.token || '');
  if (!token) return null;
  return {
    token,
    platform: trimToString(input.platform || ''),
    device: trimToString(input.device || ''),
    updatedAt: new Date().toISOString()
  };
}

async function saveFcmTokenForUser(userId, entry) {
  if (!userId || !entry) return false;
  await database.update(current => {
    const draft = normalizeData(current);
    if (!Array.isArray(draft.fcmTokens)) draft.fcmTokens = [];
    const existingIdx = draft.fcmTokens.findIndex(item => item && String(item.userId) === String(userId) && item.token === entry.token);
    const next = {
      id: existingIdx >= 0 ? draft.fcmTokens[existingIdx].id : genId('fcm'),
      userId: String(userId),
      token: entry.token,
      platform: entry.platform,
      device: entry.device,
      createdAt: existingIdx >= 0 ? draft.fcmTokens[existingIdx].createdAt : entry.updatedAt,
      updatedAt: entry.updatedAt
    };
    if (existingIdx >= 0) {
      draft.fcmTokens[existingIdx] = { ...draft.fcmTokens[existingIdx], ...next };
    } else {
      draft.fcmTokens.push(next);
    }
    return draft;
  });
  return true;
}

async function removeFcmToken(userId, token) {
  if (!userId || !token) return false;
  await database.update(current => {
    const draft = normalizeData(current);
    if (!Array.isArray(draft.fcmTokens)) draft.fcmTokens = [];
    draft.fcmTokens = draft.fcmTokens.filter(item => !(item && String(item.userId) === String(userId) && item.token === token));
    return draft;
  });
  return true;
}

let fcmAuthClient = null;
let fcmProjectIdCached = '';
let fcmAccessTokenCache = { token: '', expiresAt: 0 };

async function resolveFcmProjectId() {
  if (FCM_PROJECT_ID) return FCM_PROJECT_ID;
  if (fcmProjectIdCached) return fcmProjectIdCached;
  if (!FCM_SERVICE_ACCOUNT_PATH) return '';
  try {
    const raw = fs.readFileSync(FCM_SERVICE_ACCOUNT_PATH, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    fcmProjectIdCached = trimToString(parsed.project_id || '') || '';
    return fcmProjectIdCached;
  } catch (err) {
    console.error('Failed to read FCM service account', err?.message || err);
    return '';
  }
}

async function getFcmAccessToken() {
  const now = Date.now();
  if (fcmAccessTokenCache.token && fcmAccessTokenCache.expiresAt > now + 60000) {
    return fcmAccessTokenCache.token;
  }
  if (!FCM_SERVICE_ACCOUNT_PATH) return '';
  if (!fcmAuthClient) {
    fcmAuthClient = new GoogleAuth({
      keyFile: FCM_SERVICE_ACCOUNT_PATH,
      scopes: ['https://www.googleapis.com/auth/firebase.messaging']
    });
  }
  const client = await fcmAuthClient.getClient();
  const tokenResponse = await client.getAccessToken();
  const accessToken = typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token;
  if (accessToken) {
    fcmAccessTokenCache = { token: accessToken, expiresAt: now + 50 * 60 * 1000 };
  }
  return accessToken || '';
}

function sendFcmRequest(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request(
      {
        method: 'POST',
        host: 'fcm.googleapis.com',
        path: '/fcm/send',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Authorization: `key=${FCM_SERVER_KEY}`
        }
      },
      res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sendFcmRequestV1(projectId, accessToken, message) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ message });
    const req = https.request(
      {
        method: 'POST',
        host: 'fcm.googleapis.com',
        path: `/v1/projects/${projectId}/messages:send`,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Authorization: `Bearer ${accessToken}`
        }
      },
      res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sendFcmToUser(userId, payloadObj) {
  if (!isFcmConfigured()) return false;
  if (!userId) return false;
  const data = await database.getData();
  const list = Array.isArray(data.fcmTokens) ? data.fcmTokens : [];
  const tokens = list.filter(item => item && String(item.userId) === String(userId)).map(item => item.token);
  if (!tokens.length) return false;

  const notification = {
    title: payloadObj?.title || 'Новое сообщение',
    body: payloadObj?.body || ''
  };
  const dataPayload = {
    conversationId: String(payloadObj?.conversationId || ''),
    peerId: String(payloadObj?.peerId || ''),
    userName: String(payloadObj?.userName || '')
  };

  for (const token of tokens) {
    try {
      if (FCM_SERVICE_ACCOUNT_PATH) {
        const projectId = await resolveFcmProjectId();
        const accessToken = await getFcmAccessToken();
        if (!projectId || !accessToken) continue;
        const result = await sendFcmRequestV1(projectId, accessToken, {
          token,
          notification,
          data: dataPayload
        });
        if (result.status >= 400) {
          const parsed = (() => { try { return JSON.parse(result.body || '{}'); } catch { return {}; } })();
          const message = trimToString(parsed?.error?.message || '');
          const status = trimToString(parsed?.error?.status || '');
          const shouldRemove = status === 'NOT_FOUND'
            || message.toLowerCase().includes('registration token')
            || message.toLowerCase().includes('not registered')
            || message.toLowerCase().includes('requested entity was not found');
          if (shouldRemove) {
            await removeFcmToken(userId, token);
          }
        }
      } else if (FCM_SERVER_KEY) {
        const result = await sendFcmRequest({
          to: token,
          notification,
          data: dataPayload
        });
        if (result.status >= 400) {
          const parsed = (() => { try { return JSON.parse(result.body || '{}'); } catch { return {}; } })();
          const error = parsed?.results?.[0]?.error;
          if (error === 'NotRegistered' || error === 'InvalidRegistration') {
            await removeFcmToken(userId, token);
          }
        }
      }
    } catch (err) {
      console.error('FCM send error', err?.message || err);
    }
  }
  return true;
}

function collectBusinessUserActions(prev, saved, authedUser) {
  const actions = [];
  if (!authedUser?.id) return actions;
  const prevCards = Array.isArray(prev?.cards) ? prev.cards : [];
  const nextCards = Array.isArray(saved?.cards) ? saved.cards : [];
  const prevMap = new Map(prevCards.map(c => [c.id, c]));
  const nextMap = new Map(nextCards.map(c => [c.id, c]));

  const now = new Date().toISOString();

  nextMap.forEach((card, id) => {
    if (!prevMap.has(id)) {
      actions.push({ userId: authedUser.id, at: now, text: `Создал карту ${formatCardLabel(card)}` });
    }
  });

  prevMap.forEach((card, id) => {
    if (!nextMap.has(id)) {
      actions.push({ userId: authedUser.id, at: now, text: `Удалил карту ${formatCardLabel(card)}` });
      return;
    }
    const nextCard = nextMap.get(id);
    if (card?.archived !== nextCard?.archived) {
      actions.push({
        userId: authedUser.id,
        at: now,
        text: nextCard?.archived
          ? `Архивировал карту ${formatCardLabel(nextCard)}`
          : `Разархивировал карту ${formatCardLabel(nextCard)}`
      });
    }
  });

  prevMap.forEach((prevCard, id) => {
    const nextCard = nextMap.get(id);
    if (!nextCard) return;
    const prevLogs = Array.isArray(prevCard?.logs) ? prevCard.logs : [];
    const nextLogs = Array.isArray(nextCard?.logs) ? nextCard.logs : [];
    if (!nextLogs.length) return;
    const prevIds = new Set(prevLogs.map(l => l && l.id).filter(Boolean));
    nextLogs.forEach(log => {
      if (!log || !log.id || prevIds.has(log.id)) return;
      const text = formatCardLogEntry(log, nextCard);
      if (text) actions.push({ userId: authedUser.id, at: new Date(log.ts || Date.now()).toISOString(), text });
    });
  });

  return actions;
}

function resolveUserNameById(id, data) {
  if (id === 'SYSTEM') return 'Система';
  const user = getUserByIdOrLegacy(data, id);
  return (user && user.name) ? user.name : 'Пользователь';
}

function trimToString(value) {
  if (value == null) return '';
  const str = typeof value === 'string' ? value : String(value);
  return str.trim();
}

function normalizeQrInput(value) {
  const mapping = {
    'Ф': 'A', 'И': 'B', 'С': 'C', 'В': 'D', 'У': 'E', 'А': 'F', 'П': 'G', 'Р': 'H',
    'Ш': 'I', 'О': 'J', 'Л': 'K', 'Д': 'L', 'Ь': 'M', 'Т': 'N', 'Щ': 'O', 'З': 'P',
    'Й': 'Q', 'К': 'R', 'Ы': 'S', 'Е': 'T', 'Г': 'U', 'М': 'V', 'Ц': 'W', 'Ч': 'X',
    'Н': 'Y', 'Я': 'Z'
  };
  const upper = trimToString(value).toUpperCase();
  let result = '';
  for (let i = 0; i < upper.length; i += 1) {
    const ch = upper[i];
    result += mapping[ch] || ch;
  }
  return result.replace(/[^A-Z0-9]/g, '');
}

function ensureDirSync(p) {
  fs.mkdirSync(p, { recursive: true });
}

function normalizeQrIdServer(value) {
  const upper = String(value || '').trim().toUpperCase();
  return upper.replace(/[^A-Z0-9]/g, '');
}

function isValidQrIdServer(value) {
  return /^[A-Z0-9]{6,32}$/.test(value || '');
}

function sanitizeFilename(name) {
  const raw = String(name || 'file').trim();
  let safe = raw.replace(/[\u0000-\u001f\u007f]/g, '');
  safe = safe.replace(/[\/\\:*?"<>|]/g, '_');
  safe = safe.replace(/\.\.+/g, '.');
  safe = safe.replace(/^\.+/g, '');
  safe = safe.trim();
  if (!safe) safe = 'file';
  const ext = path.extname(safe);
  const base = safe.slice(0, Math.max(1, 120 - ext.length));
  return base + ext;
}

function sanitizeHeaderFilename(name) {
  let safe = name == null ? 'file' : String(name);
  safe = safe.replace(/[\r\n]/g, ' ');
  safe = safe.replace(/[\u0000-\u001F\u007F]/g, '');
  safe = safe.replace(/"/g, "'");
  safe = safe.trim();
  if (!safe) safe = 'file';
  if (safe.length > 200) safe = safe.slice(0, 200);
  return safe;
}

function buildContentDisposition(filename, isDownload) {
  const safe = sanitizeHeaderFilename(filename);
  const asciiFallback = safe.replace(/[^\x20-\x7E]/g, '_') || 'file';
  const utf8 = encodeURIComponent(safe)
    .replace(/['()]/g, escape)
    .replace(/\*/g, '%2A');
  const type = isDownload ? 'attachment' : 'inline';
  return `${type}; filename="${asciiFallback}"; filename*=UTF-8''${utf8}`;
}

function isSafeRelPath(relPath) {
  if (typeof relPath !== 'string' || !relPath) return false;
  if (relPath.includes('..')) return false;
  if (relPath.startsWith('/') || relPath.startsWith('\\')) return false;
  return true;
}

function makeStoredName(originalName) {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  const rnd = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${ts}__${rnd}__${sanitizeFilename(originalName)}`;
}

function categoryToFolder(category) {
  const c = String(category || 'GENERAL').toUpperCase();
  if (c === 'INPUT_CONTROL') return 'input-control';
  if (c === 'SKK') return 'skk';
  return 'general';
}

function normalizeDoubleExtension(filename) {
  let name = String(filename || '');
  let lower = name.toLowerCase();
  let updated = true;
  let changed = false;
  while (updated) {
    updated = false;
    for (const ext of ALLOWED_EXTENSIONS) {
      const pair = `${ext}${ext}`;
      if (ext && lower.endsWith(pair)) {
        name = name.slice(0, -ext.length);
        lower = name.toLowerCase();
        updated = true;
        changed = true;
        break;
      }
    }
  }
  return changed ? name : String(filename || '');
}

function decodeHashUnicodeFilename(str) {
  const raw = String(str || '');
  if (!/#U[0-9A-Fa-f]{4}/.test(raw)) return raw;
  return raw.replace(/#U([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function resolveFilePathWithHashedUnicode(absExpectedPath) {
  if (!absExpectedPath) return null;
  try {
    if (fs.existsSync(absExpectedPath)) return absExpectedPath;
  } catch (err) {
    return null;
  }

  const dir = path.dirname(absExpectedPath);
  const expectedBase = path.basename(absExpectedPath);

  try {
    if (!fs.existsSync(dir)) return null;
  } catch (err) {
    return null;
  }

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return null;
  }

  for (const entry of entries) {
    if (!entry || !entry.isFile()) continue;
    const entryName = String(entry.name || '');
    const decoded = decodeHashUnicodeFilename(entryName);
    if (decoded !== expectedBase) continue;
    const absFound = path.join(dir, entryName);
    try {
      if (!fs.existsSync(absExpectedPath)) {
        try {
          fs.renameSync(absFound, absExpectedPath);
          return absExpectedPath;
        } catch (err) {
          return absFound;
        }
      }
    } catch (err) {
      return absFound;
    }
    return absFound;
  }

  return null;
}

function getHumanNameFromStoredName(storedName) {
  const s = String(storedName || '').trim();
  if (!s) return s;
  const m = /^(\d{4}-\d{2}-\d{2}_[0-9]{2}-[0-9]{2}-[0-9]{2}__(?:[A-Za-z0-9]{6}__)?)(.+)$/.exec(s);
  return m ? m[2] : s;
}

function folderToCategory(folder) {
  const value = String(folder || '').toLowerCase();
  if (value === 'input-control') return 'INPUT_CONTROL';
  if (value === 'skk') return 'SKK';
  return 'GENERAL';
}

function guessMimeByExt(filename) {
  const ext = path.extname(filename || '').toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.doc') return 'application/msword';
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.zip') return 'application/zip';
  if (ext === '.rar') return 'application/vnd.rar';
  if (ext === '.7z') return 'application/x-7z-compressed';
  return 'application/octet-stream';
}

function ensureCardStorageFoldersByQr(qr) {
  const safe = normalizeQrIdServer(qr);
  if (!isValidQrIdServer(safe)) throw new Error('Invalid QR for storage');
  const base = path.join(CARDS_STORAGE_DIR, safe);
  ensureDirSync(base);
  ensureDirSync(path.join(base, 'general'));
  ensureDirSync(path.join(base, 'input-control'));
  ensureDirSync(path.join(base, 'skk'));
  return base;
}

function syncCardAttachmentsFromDisk(card) {
  if (!card) {
    return { changed: false, files: [], inputControlFileId: '' };
  }
  const qr = normalizeQrIdServer(card.qrId || '');
  if (!isValidQrIdServer(qr)) {
    return {
      changed: false,
      files: card.attachments || [],
      inputControlFileId: card.inputControlFileId || ''
    };
  }
  ensureCardStorageFoldersByQr(qr);
  let changed = false;
  let attachments = Array.isArray(card.attachments) ? card.attachments : [];
  for (const attachment of attachments) {
    if (!attachment) continue;
    if (!attachment.storedName && attachment.relPath) {
      attachment.storedName = path.basename(attachment.relPath);
      changed = true;
    }
  }
  const setRelPaths = new Set(attachments.map(item => item && item.relPath).filter(Boolean));
  const folders = ['general', 'input-control', 'skk'];

  for (const folder of folders) {
    const absDir = path.join(CARDS_STORAGE_DIR, qr, folder);
    if (!fs.existsSync(absDir)) continue;
    const entries = fs.readdirSync(absDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry || !entry.isFile()) continue;
      let name = String(entry.name || '').trim();
      if (!name || name.startsWith('.')) continue;
      const ext = path.extname(name).toLowerCase();
      if (!ext || (ALLOWED_EXTENSIONS.length && !ALLOWED_EXTENSIONS.includes(ext))) continue;
      const oldName = name;
      const fixed = normalizeDoubleExtension(name);
      if (fixed && fixed !== name) {
        const src = path.join(absDir, name);
        const dst = path.join(absDir, fixed);
        if (!fs.existsSync(dst)) {
          try {
            fs.renameSync(src, dst);
            name = fixed;
            const oldRel = `${folder}/${oldName}`;
            const newRel = `${folder}/${fixed}`;
            const existing = attachments.find(item => item && item.relPath === oldRel);
            if (existing) {
              existing.relPath = newRel;
              existing.storedName = fixed;
              const human = getHumanNameFromStoredName(fixed);
              if (!existing.originalName) existing.originalName = human;
              if (!existing.name || existing.name === oldName || existing.name === fixed) {
                existing.name = human;
              }
              changed = true;
            }
            if (setRelPaths.has(oldRel)) {
              setRelPaths.delete(oldRel);
              setRelPaths.add(newRel);
            }
          } catch (err) {
            // ignore rename errors, keep original name
          }
        }
      }
      const relPath = `${folder}/${name}`;
      if (setRelPaths.has(relPath)) continue;
      const stat = fs.statSync(path.join(absDir, name));
      const mime = guessMimeByExt(name);
      const storedName = name;
      const human = getHumanNameFromStoredName(storedName);
      const fileMeta = {
        id: genId('file'),
        name: human,
        originalName: human,
        storedName,
        relPath,
        type: mime,
        mime,
        size: stat.size,
        createdAt: stat.mtimeMs || Date.now(),
        category: folderToCategory(folder),
        scope: 'CARD',
        scopeId: null
      };
      attachments.push(fileMeta);
      setRelPaths.add(relPath);
      changed = true;
      if (fileMeta.category === 'INPUT_CONTROL' && !card.inputControlFileId) {
        card.inputControlFileId = fileMeta.id;
      }
    }
  }

  const beforeCleanupLength = attachments.length;
  attachments = attachments.filter(item => {
    if (!item || !item.relPath || !isSafeRelPath(item.relPath)) return false;
    const abs = path.join(CARDS_STORAGE_DIR, qr, item.relPath);
    return Boolean(resolveFilePathWithHashedUnicode(abs));
  });
  if (attachments.length !== beforeCleanupLength) changed = true;

  const seen = new Set();
  const beforeDedupeLength = attachments.length;
  attachments = attachments.filter(item => {
    if (!item || !item.relPath) return false;
    if (seen.has(item.relPath)) return false;
    seen.add(item.relPath);
    return true;
  });
  if (attachments.length !== beforeDedupeLength) changed = true;

  if (changed) {
    card.attachments = attachments;
  }
  return {
    changed,
    files: card.attachments || [],
    inputControlFileId: card.inputControlFileId || ''
  };
}

function getCardLiveSummary(card) {
  return {
    id: card.id,
    rev: Number.isFinite(card.rev) ? card.rev : 1,
    approvalStage: card.approvalStage || '',
    archived: Boolean(card.archived),
    productionStatus: card.productionStatus || card.status || 'NOT_STARTED',
    opsCount: Array.isArray(card.operations) ? card.operations.length : 0,
    filesCount: Array.isArray(card.attachments) ? card.attachments.length : 0,
    operationsLive: Array.isArray(card.operations)
      ? card.operations.map(o => ({
        id: o.id,
        status: o.status,
        elapsedSeconds: typeof o.elapsedSeconds === 'number' ? o.elapsedSeconds : 0,
        startedAt: o.startedAt || null,
        order: typeof o.order === 'number' ? o.order : null,
        plannedMinutes: typeof o.plannedMinutes === 'number' ? o.plannedMinutes : null,
        opName: o.opName || o.name || '',
        opCode: o.opCode || o.code || ''
      }))
      : []
  };
}

function removeCardStorageFoldersByQr(qr) {
  const safe = normalizeQrIdServer(qr);
  if (!isValidQrIdServer(safe)) return;
  const base = path.join(CARDS_STORAGE_DIR, safe);
  try {
    fs.rmSync(base, { recursive: true, force: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to remove card storage', safe, err);
  }
}

function decodeDataUrlToBuffer(dataUrl) {
  const raw = String(dataUrl || '');
  const idx = raw.indexOf(',');
  if (idx === -1) return null;
  const base64 = raw.slice(idx + 1);
  try {
    return Buffer.from(base64, 'base64');
  } catch (err) {
    return null;
  }
}

function normalizeOperationType(value) {
  const raw = trimToString(value);
  if (!raw) return DEFAULT_OPERATION_TYPE;
  const matched = OPERATION_TYPE_OPTIONS.find(option => option.toLowerCase() === raw.toLowerCase());
  return matched || DEFAULT_OPERATION_TYPE;
}

function normalizeDepartmentId(value) {
  if (value == null) return null;
  const raw = typeof value === 'string' ? value.trim() : String(value).trim();
  return raw ? raw : null;
}

function formatDateStamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function generateRawCode128(prefix = 'MK') {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function generateUniqueCode128(cards = [], used = new Set()) {
  let attempt = 0;
  while (attempt < 1000) {
    const code = generateRawCode128();
    const exists = cards.some(c => trimToString(c?.barcode) === code) || used.has(code);
    if (!exists) {
      used.add(code);
      return code;
    }
    attempt += 1;
  }
  const fallback = `${generateRawCode128()}-${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
  used.add(fallback);
  return fallback;
}

function generateRawQrId(len = 10) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  while (code.length < len) {
    const idx = Math.floor(Math.random() * chars.length);
    code += chars[idx];
  }
  return code;
}

function generateUniqueQrId(cards = [], used = new Set()) {
  let attempt = 0;
  while (attempt < 1000) {
    const code = generateRawQrId();
    const exists = cards.some(c => trimToString(c?.qrId).toUpperCase() === code) || used.has(code);
    if (!exists) {
      used.add(code);
      return code;
    }
    attempt += 1;
  }
  const fallback = generateRawQrId(12);
  used.add(fallback);
  return fallback;
}

function generateUniqueRouteCardNumber(existingNumbers = new Set(), date = new Date()) {
  const dateStamp = formatDateStamp(date);
  let counter = 1;
  let candidate = '';

  do {
    candidate = `MK-${dateStamp}-${String(counter).padStart(4, '0')}`;
    counter += 1;
  } while (existingNumbers.has(candidate));

  existingNumbers.add(candidate);
  return candidate;
}

function collectRouteCardNumbers(db) {
  const numbers = new Set();
  const cards = Array.isArray(db?.cards) ? db.cards : [];
  cards.forEach(item => {
    if (item && item.isGroup !== true) {
      const candidate = trimToString(item.routeCardNumber);
      if (candidate) numbers.add(candidate);
    }
  });
  return numbers;
}

function ensureRouteCardNumber(card, db, options = {}) {
  if (!card || card.isGroup === true) {
    return trimToString(card?.routeCardNumber);
  }

  const existingNumbers = options.existingNumbers || collectRouteCardNumbers(db);
  let candidate = trimToString(card.routeCardNumber);

  if (!candidate) {
    const legacy = trimToString(card.barcode);
    if (legacy) {
      candidate = legacy;
    }
  }

  if (!candidate) {
    candidate = generateUniqueRouteCardNumber(existingNumbers);
  }

  if (existingNumbers) existingNumbers.add(candidate);
  card.routeCardNumber = candidate;
  return candidate;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function compileTemplate(template) {
  const matcher = /<%([=-]?)([\s\S]+?)%>/g;
  let cursor = 0;
  let code = 'let __out = "";\n';

  const addText = (text) => {
    if (!text) return;
    code += `__out += ${JSON.stringify(text)};\n`;
  };

  let match;
  while ((match = matcher.exec(template))) {
    addText(template.slice(cursor, match.index));
    const [full, flag, inner] = match;
    if (flag === '=') {
      code += `__out += escapeHtml(${inner.trim()});\n`;
    } else if (flag === '-') {
      // RAW OUTPUT (нужно для SVG/HTML фрагментов)
      code += `__out += (${inner.trim()} ?? "");\n`;
    } else {
      code += `${inner}\n`;
    }
    cursor = match.index + full.length;
  }

  addText(template.substr(cursor));
  code += 'return __out;';

  return new Function('data', 'escapeHtml', `with (data) {\n${code}\n}`);
}

function buildTemplateRenderer(templatePath) {
  let compiled = null;
  let cached = '';

  return (data) => {
    if (!compiled) {
      cached = fs.readFileSync(templatePath, 'utf8');
      compiled = compileTemplate(cached);
    }
    return compiled(data, escapeHtml);
  };
}

function generateRawOpCode() {
  return `OP-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
}

function generateUniqueOpCode(used = new Set()) {
  let code = generateRawOpCode();
  let attempt = 0;
  while (used.has(code) && attempt < 1000) {
    code = generateRawOpCode();
    attempt++;
  }
  return code;
}

function clonePermissions(source = {}) {
  const tabs = source.tabs || {};
  const safeTabs = Object.fromEntries(
    Object.entries(DEFAULT_PERMISSIONS.tabs).map(([key, defaults]) => {
      const incoming = tabs[key] || {};
      return [key, { view: Boolean(incoming.view ?? defaults.view), edit: Boolean(incoming.edit ?? defaults.edit) }];
    })
  );

  const attachments = source.attachments || {};
  return {
    tabs: safeTabs,
    attachments: {
      upload: Boolean(attachments.upload ?? DEFAULT_PERMISSIONS.attachments.upload),
      remove: Boolean(attachments.remove ?? DEFAULT_PERMISSIONS.attachments.remove)
    },
    landingTab: source.landingTab || DEFAULT_PERMISSIONS.landingTab,
    inactivityTimeoutMinutes: Number.isFinite(source.inactivityTimeoutMinutes)
      ? Math.max(1, parseInt(source.inactivityTimeoutMinutes, 10))
      : DEFAULT_PERMISSIONS.inactivityTimeoutMinutes,
    worker: Boolean(source.worker ?? DEFAULT_PERMISSIONS.worker),
    headProduction: Boolean(source.headProduction ?? DEFAULT_PERMISSIONS.headProduction),
    headSKK: Boolean(source.headSKK ?? DEFAULT_PERMISSIONS.headSKK),
    deputyTechDirector: Boolean(source.deputyTechDirector ?? DEFAULT_PERMISSIONS.deputyTechDirector)
  };
}

function createRouteOpFromRefs(op, center, executor, plannedMinutes, order, options = {}) {
  const { quantity = '', autoCode = false, code } = options;
  return {
    id: genId('rop'),
    opId: op.id,
    opCode: code || op.code || op.opCode || generateUniqueOpCode(),
    opName: op.name,
    operationType: normalizeOperationType(op.operationType),
    centerId: center.id,
    centerName: center.name,
    executor: executor || '',
    plannedMinutes: plannedMinutes || op.recTime || 30,
    quantity: quantity === '' || quantity == null ? '' : parseInt(quantity, 10) || 0,
    autoCode,
    additionalExecutors: Array.isArray(op.additionalExecutors)
      ? op.additionalExecutors.slice(0, 2)
      : [],
    status: 'NOT_STARTED',
    firstStartedAt: null,
    startedAt: null,
    lastPausedAt: null,
    finishedAt: null,
    actualSeconds: null,
    elapsedSeconds: 0,
    order: order || 1,
    comment: '',
    goodCount: 0,
    scrapCount: 0,
    holdCount: 0
  };
}

function buildDefaultUser() {
  const { hash, salt } = hashPassword(DEFAULT_ADMIN_PASSWORD);
  return { id: createUserId([]), ...DEFAULT_ADMIN, passwordHash: hash, passwordSalt: salt, accessLevelId: 'level_admin', status: 'active', departmentId: null };
}

function buildDefaultAccessLevels() {
  return [
    {
      id: 'level_admin',
      name: 'Администратор',
      description: 'Полные права',
      permissions: clonePermissions({ ...DEFAULT_PERMISSIONS, worker: false, landingTab: 'dashboard', inactivityTimeoutMinutes: 60 })
    }
  ];
}

function buildDefaultData() {
  const centers = [
    { id: genId('wc'), name: 'Механическая обработка', desc: 'Токарные и фрезерные операции' },
    { id: genId('wc'), name: 'Покрытия / напыление', desc: 'Покрытия, термическое напыление' },
    { id: genId('wc'), name: 'Контроль качества', desc: 'Измерения, контроль, визуальный осмотр' }
  ];

  const used = new Set();
  const ops = [
    { id: genId('op'), code: generateUniqueOpCode(used), name: 'Токарная обработка', desc: 'Черновая и чистовая', recTime: 40, operationType: DEFAULT_OPERATION_TYPE },
    { id: genId('op'), code: generateUniqueOpCode(used), name: 'Напыление покрытия', desc: 'HVOF / APS', recTime: 60, operationType: DEFAULT_OPERATION_TYPE },
    { id: genId('op'), code: generateUniqueOpCode(used), name: 'Контроль размеров', desc: 'Измерения, оформление протокола', recTime: 20, operationType: DEFAULT_OPERATION_TYPE }
  ];

  const cardId = genId('card');
  const cards = [
    {
      id: cardId,
      barcode: generateUniqueCode128([]),
      routeCardNumber: '',
      name: 'Вал привода Ø60',
      orderNo: 'DEMO-001',
      desc: 'Демонстрационная карта для примера.',
      status: 'NOT_STARTED',
      archived: false,
      createdAt: Date.now(),
      logs: [],
      initialSnapshot: null,
      attachments: [],
      operations: [
        createRouteOpFromRefs(ops[0], centers[0], 'Иванов И.И.', 40, 1),
        createRouteOpFromRefs(ops[1], centers[1], 'Петров П.П.', 60, 2),
        createRouteOpFromRefs(ops[2], centers[2], 'Сидоров С.С.', 20, 3)
      ]
    }
  ];

  const routeNumbers = new Set();
  cards.forEach(card => ensureRouteCardNumber(card, { cards }, { existingNumbers: routeNumbers }));

  const users = [buildDefaultUser()];
  const accessLevels = buildDefaultAccessLevels();

  const areas = [];

  const productionShiftTimes = [
    { shift: 1, timeFrom: '08:00', timeTo: '16:00' },
    { shift: 2, timeFrom: '16:00', timeTo: '00:00' },
    { shift: 3, timeFrom: '00:00', timeTo: '08:00' }
  ];

  return {
    cards,
    ops,
    centers,
    areas,
    users,
    accessLevels,
    messages: [],
    chatConversations: [],
    chatMessages: [],
    chatStates: [],
    webPushSubscriptions: [],
    fcmTokens: [],
    userVisits: [],
    userActions: [],
    productionSchedule: [],
    productionShiftTimes,
    productionShiftTasks: []
  };
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function serveStatic(req, res) {
  const parsedUrl = url.parse(req.url);
  let pathname = path.join(__dirname, decodeURIComponent(parsedUrl.pathname));

  if (pathname.endsWith(path.sep)) {
    pathname = path.join(pathname, 'index.html');
  }

  if (!pathname.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(pathname, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const ext = path.extname(pathname).toLowerCase();
    const mime = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
      '.ico': 'image/x-icon',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
      '.pdf': 'application/pdf'
    }[ext] || 'application/octet-stream';

    fs.readFile(pathname, (readErr, data) => {
      if (readErr) {
        res.writeHead(500);
        res.end('Server error');
        return;
      }
      res.writeHead(200, { 'Content-Type': mime });
      res.end(data);
    });
  });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > MAX_BODY_SIZE) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function recalcCardProductionStatus(card) {
  const opsArr = Array.isArray(card.operations) ? card.operations : [];

  let next = 'NOT_STARTED';
  if (opsArr.length === 0) {
    next = 'NOT_STARTED';
  } else {
    const norm = s => (s || 'NOT_STARTED');
    const statuses = opsArr.map(o => norm(o && o.status));

    const allDone = statuses.every(s => s === 'DONE');
    const hasInProgress = statuses.includes('IN_PROGRESS');
    const hasPaused = statuses.includes('PAUSED');
    const hasAnyDone = statuses.includes('DONE');
    const hasNotStarted = statuses.includes('NOT_STARTED');

    if (allDone) next = 'DONE';
    else if (hasInProgress) next = 'IN_PROGRESS';
    else if (hasPaused) next = 'PAUSED';
    else if (hasAnyDone && hasNotStarted) next = 'PAUSED';
    else next = 'NOT_STARTED';
  }

  card.productionStatus = next;

  // легаси синхронизация (важно для существующих мест)
  card.status = next;

  return next;
}

function normalizeCard(card) {
  const safeCard = deepClone(card);
  const qtyNumber = parseInt(safeCard.quantity, 10);
  safeCard.quantity = Number.isFinite(qtyNumber) ? qtyNumber : '';
  safeCard.name = safeCard.name || 'Карта';
  safeCard.orderNo = safeCard.orderNo || '';
  safeCard.contractNumber = safeCard.contractNumber || '';
  safeCard.desc = safeCard.desc || '';
  safeCard.drawing = safeCard.drawing || '';
  safeCard.material = safeCard.material || '';
  safeCard.operations = (safeCard.operations || []).map(op => ({
    ...op,
    opCode: op.opCode || '',
    elapsedSeconds: typeof op.elapsedSeconds === 'number' ? op.elapsedSeconds : (op.actualSeconds || 0),
    firstStartedAt: typeof op.firstStartedAt === 'number' ? op.firstStartedAt : (op.startedAt || null),
    startedAt: op.startedAt || null,
    lastPausedAt: typeof op.lastPausedAt === 'number' ? op.lastPausedAt : null,
    finishedAt: op.finishedAt || null,
    status: op.status || 'NOT_STARTED',
    comment: typeof op.comment === 'string' ? op.comment : '',
    goodCount: Number.isFinite(parseInt(op.goodCount, 10)) ? Math.max(0, parseInt(op.goodCount, 10)) : 0,
    scrapCount: Number.isFinite(parseInt(op.scrapCount, 10)) ? Math.max(0, parseInt(op.scrapCount, 10)) : 0,
    holdCount: Number.isFinite(parseInt(op.holdCount, 10)) ? Math.max(0, parseInt(op.holdCount, 10)) : 0,
    quantity: Number.isFinite(parseInt(op.quantity, 10)) ? Math.max(0, parseInt(op.quantity, 10)) : '',
    autoCode: Boolean(op.autoCode),
    additionalExecutors: Array.isArray(op.additionalExecutors)
      ? op.additionalExecutors.map(name => (name || '').toString()).slice(0, 2)
      : []
  })).map(op => ({
    ...op,
    quantity: op.quantity === '' && safeCard.quantity !== '' ? safeCard.quantity : op.quantity
  }));
  safeCard.archived = Boolean(safeCard.archived);
  safeCard.createdAt = typeof safeCard.createdAt === 'number' ? safeCard.createdAt : Date.now();
  safeCard.logs = Array.isArray(safeCard.logs)
    ? safeCard.logs.map(entry => ({
      id: entry.id || genId('log'),
      ts: typeof entry.ts === 'number' ? entry.ts : Date.now(),
      action: entry.action || 'update',
      object: entry.object || '',
      targetId: entry.targetId || null,
      field: entry.field || null,
      oldValue: entry.oldValue != null ? entry.oldValue : '',
      newValue: entry.newValue != null ? entry.newValue : ''
    }))
    : [];
  safeCard.initialSnapshot = safeCard.initialSnapshot || null;
  safeCard.attachments = Array.isArray(safeCard.attachments)
    ? safeCard.attachments.map(file => ({
      id: file.id || genId('file'),
      name: file.name || file.originalName || 'file',
      originalName: file.originalName || file.name || 'file',
      storedName: file.storedName || '',
      relPath: file.relPath || '',
      type: file.type || file.mime || 'application/octet-stream',
      mime: file.mime || file.type || 'application/octet-stream',
      size: Number(file.size) || 0,
      createdAt: file.createdAt || Date.now(),
      category: String(file.category || 'GENERAL').toUpperCase(),
      scope: String(file.scope || 'CARD').toUpperCase(),
      scopeId: file.scopeId || null
    }))
    : [];
  recalcCardProductionStatus(safeCard);
  return safeCard;
}

function ensureOperationCodes(data) {
  const used = new Set();

  data.ops = data.ops.map(op => {
    const next = { ...op };
    if (!next.code || used.has(next.code)) {
      next.code = generateUniqueOpCode(used);
    }
    used.add(next.code);
    return next;
  });

  const opMap = Object.fromEntries(data.ops.map(op => [op.id, op]));

  data.cards = data.cards.map(card => {
    const nextCard = { ...card };
    nextCard.operations = (nextCard.operations || []).map(op => {
      const nextOp = { ...op };
      const source = nextOp.opId ? opMap[nextOp.opId] : null;
      const isAuto = nextOp.autoCode === true;
      const hasManualCode = typeof nextOp.opCode === 'string'
        ? nextOp.opCode.trim().length > 0
        : Boolean(nextOp.opCode);

      if (!hasManualCode) {
        if (isAuto && source && source.code) {
          nextOp.opCode = source.code;
        }

        if (!nextOp.opCode) {
          nextOp.opCode = generateUniqueOpCode(used);
        }
      }

      if (nextOp.opCode) used.add(nextOp.opCode);
      return nextOp;
    });
    recalcCardProductionStatus(nextCard);
    return nextCard;
  });
}

function ensureOperationTypes(data) {
  data.ops = (data.ops || []).map(op => ({ ...op, operationType: normalizeOperationType(op.operationType) }));
  const typeMap = Object.fromEntries((data.ops || []).map(op => [op.id, op.operationType]));

  data.cards = (data.cards || []).map(card => {
    const nextCard = { ...card };
    nextCard.operations = (nextCard.operations || []).map(op => {
      const nextOp = { ...op };
      const refType = nextOp.opId ? typeMap[nextOp.opId] : null;
      nextOp.operationType = normalizeOperationType(refType || nextOp.operationType);
      return nextOp;
    });
    recalcCardProductionStatus(nextCard);
    return nextCard;
  });
}

function normalizeTimeString(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{2}:\d{2}$/.test(raw)) return null;
  const [hh, mm] = raw.split(':').map(part => parseInt(part, 10));
  if (Number.isNaN(hh) || Number.isNaN(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function normalizeProductionShiftTimes(raw) {
  const defaults = [
    { shift: 1, timeFrom: '08:00', timeTo: '16:00' },
    { shift: 2, timeFrom: '16:00', timeTo: '00:00' },
    { shift: 3, timeFrom: '00:00', timeTo: '08:00' }
  ];
  const incoming = Array.isArray(raw) ? raw : [];
  const normalized = incoming
    .map(item => ({
      shift: Number.isFinite(parseInt(item.shift, 10)) ? Math.max(1, parseInt(item.shift, 10)) : 1,
      timeFrom: normalizeTimeString(item.timeFrom) || '00:00',
      timeTo: normalizeTimeString(item.timeTo) || '00:00'
    }))
    .filter(item => Number.isInteger(item.shift) && item.shift > 0);
  const unique = [];
  const seen = new Set();
  normalized.forEach(item => {
    if (seen.has(item.shift)) return;
    seen.add(item.shift);
    unique.push(item);
  });
  return unique.length ? unique : defaults;
}

function normalizeProductionScheduleEntry(entry) {
  const date = typeof entry?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) ? entry.date : '';
  const areaId = trimToString(entry?.areaId);
  const employeeId = trimToString(entry?.employeeId);
  const shift = Number.isFinite(parseInt(entry?.shift, 10)) ? Math.max(1, parseInt(entry.shift, 10)) : 1;
  return {
    date,
    shift,
    areaId,
    employeeId,
    timeFrom: normalizeTimeString(entry?.timeFrom),
    timeTo: normalizeTimeString(entry?.timeTo)
  };
}

function normalizeProductionSchedule(raw, shiftTimes = []) {
  const entries = Array.isArray(raw) ? raw.map(normalizeProductionScheduleEntry) : [];
  const deduped = [];
  const usedKeys = new Set();
  entries.forEach(item => {
    if (!item.date || !item.areaId || !item.employeeId || !item.shift) return;
    const key = `${item.date}|${item.shift}|${item.employeeId}`;
    if (usedKeys.has(key)) return;
    usedKeys.add(key);
    deduped.push(item);
  });

  const validShifts = new Set((shiftTimes || []).map(s => s.shift));
  return deduped.filter(item => validShifts.size === 0 || validShifts.has(item.shift));
}

function normalizeProductionShiftTask(entry) {
  const date = typeof entry?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) ? entry.date : '';
  const shift = Number.isFinite(parseInt(entry?.shift, 10)) ? Math.max(1, parseInt(entry.shift, 10)) : 1;
  return {
    id: trimToString(entry?.id) || genId('pst'),
    cardId: trimToString(entry?.cardId),
    routeOpId: trimToString(entry?.routeOpId),
    opId: trimToString(entry?.opId),
    opName: trimToString(entry?.opName),
    date,
    shift,
    areaId: trimToString(entry?.areaId),
    createdAt: typeof entry?.createdAt === 'number' ? entry.createdAt : Date.now(),
    createdBy: trimToString(entry?.createdBy)
  };
}

function normalizeProductionShiftTasks(raw, shiftTimes = []) {
  const entries = Array.isArray(raw) ? raw.map(normalizeProductionShiftTask) : [];
  const validShifts = new Set((shiftTimes || []).map(s => s.shift));
  return entries.filter(item => {
    if (!item.cardId || !item.routeOpId || !item.areaId || !item.date || !item.shift) return false;
    return validShifts.size === 0 || validShifts.has(item.shift);
  });
}

function isAbyssUser(user) {
  const login = trimToString(user?.login).toLowerCase();
  const name = trimToString(user?.name || user?.username).toLowerCase();
  return login === 'abyss' || name === 'abyss';
}

function normalizeUser(user) {
  const id = trimToString(user?.id);
  const departmentId = normalizeDepartmentId(user?.departmentId);
  const abyss = isAbyssUser(user);
  return {
    ...user,
    id,
    departmentId: abyss ? null : departmentId
  };
}

function normalizeData(payload) {
  const rawUsers = Array.isArray(payload.users) ? payload.users.map(normalizeUser) : [];
  const usedIds = new Set();
  let maxUserValue = 0;
  rawUsers.forEach(user => {
    const match = USER_ID_PATTERN.exec(trimToString(user?.id));
    if (!match) return;
    const num = parseInt(match[1], 10);
    if (!Number.isFinite(num)) return;
    maxUserValue = Math.max(maxUserValue, num);
    const normalized = `id${String(num).padStart(6, '0')}`;
    if (!usedIds.has(normalized)) {
      usedIds.add(normalized);
    }
  });
  const allocateUserId = () => {
    let candidate = '';
    let attempts = 0;
    do {
      maxUserValue = maxUserValue >= 999999 ? 1 : maxUserValue + 1;
      candidate = `id${String(maxUserValue).padStart(6, '0')}`;
      attempts += 1;
      if (attempts > 1000000) {
        throw new Error('Cannot allocate user id');
      }
    } while (usedIds.has(candidate));
    usedIds.add(candidate);
    return candidate;
  };
  const userIdMap = new Map();
  const normalizedUsers = rawUsers.map(user => {
    const currentId = trimToString(user?.id);
    const match = USER_ID_PATTERN.exec(currentId);
    if (match && !userIdMap.has(currentId)) {
      userIdMap.set(currentId, currentId);
      return { ...user, id: currentId };
    }
    const nextId = allocateUserId();
    if (currentId) {
      userIdMap.set(currentId, nextId);
    }
    const legacyId = trimToString(user?.legacyId) || currentId;
    return { ...user, id: nextId, legacyId: legacyId || undefined };
  });
  const remapUserId = (value) => {
    const id = trimToString(value);
    if (!id || id === 'SYSTEM' || id === SYSTEM_USER_ID) return id;
    return userIdMap.get(id) || id;
  };
  const safe = {
    cards: Array.isArray(payload.cards) ? payload.cards.map(normalizeCard) : [],
    ops: Array.isArray(payload.ops) ? payload.ops : [],
    centers: Array.isArray(payload.centers) ? payload.centers : [],
    areas: Array.isArray(payload.areas) ? payload.areas : [],
    users: normalizedUsers,
    messages: Array.isArray(payload.messages)
      ? payload.messages.map(message => {
        if (!message || typeof message !== 'object') return message;
        return {
          ...message,
          fromUserId: remapUserId(message.fromUserId),
          toUserId: remapUserId(message.toUserId)
        };
      })
      : [],
    chatConversations: Array.isArray(payload.chatConversations)
      ? payload.chatConversations.map(conversation => {
        if (!conversation || typeof conversation !== 'object') return conversation;
        const participantIds = Array.isArray(conversation.participantIds)
          ? conversation.participantIds.map(remapUserId).filter(Boolean)
          : [];
        participantIds.sort();
        return {
          id: conversation.id || genId('cvt'),
          type: conversation.type || 'direct',
          participantIds,
          createdAt: conversation.createdAt || new Date().toISOString(),
          lastMessageId: conversation.lastMessageId || null,
          lastMessageAt: conversation.lastMessageAt || null,
          lastMessagePreview: conversation.lastMessagePreview || null
        };
      })
      : [],
    chatMessages: Array.isArray(payload.chatMessages)
      ? payload.chatMessages.map(message => {
        if (!message || typeof message !== 'object') return message;
        const next = {
          id: message.id || genId('cmsg'),
          conversationId: message.conversationId || '',
          seq: Number.isFinite(message.seq) ? message.seq : Number(message.seq || 0),
          senderId: remapUserId(message.senderId),
          text: trimToString(message.text),
          createdAt: message.createdAt || new Date().toISOString()
        };
        if (message.clientMsgId) next.clientMsgId = message.clientMsgId;
        return next;
      })
      : [],
    chatStates: Array.isArray(payload.chatStates)
      ? payload.chatStates.map(state => {
        if (!state || typeof state !== 'object') return state;
        const lastDeliveredSeq = Number.isFinite(state.lastDeliveredSeq)
          ? state.lastDeliveredSeq
          : Number(state.lastDeliveredSeq || 0);
        const lastReadSeq = Number.isFinite(state.lastReadSeq)
          ? state.lastReadSeq
          : Number(state.lastReadSeq || 0);
        const normalizedLastDelivered = Math.max(lastDeliveredSeq, lastReadSeq);
        return {
          conversationId: state.conversationId || '',
          userId: remapUserId(state.userId),
          lastDeliveredSeq: normalizedLastDelivered,
          lastReadSeq: Math.min(lastReadSeq, normalizedLastDelivered),
          updatedAt: state.updatedAt || new Date().toISOString()
        };
      })
      : [],
    webPushSubscriptions: Array.isArray(payload.webPushSubscriptions)
      ? payload.webPushSubscriptions.map(entry => ({
        ...entry,
        userId: remapUserId(entry?.userId)
      }))
      : [],
    fcmTokens: Array.isArray(payload.fcmTokens)
      ? payload.fcmTokens.map(entry => ({
        ...entry,
        userId: remapUserId(entry?.userId)
      }))
      : [],
    userVisits: Array.isArray(payload.userVisits)
      ? payload.userVisits.map(entry => ({
        ...entry,
        userId: remapUserId(entry?.userId)
      }))
      : [],
    userActions: Array.isArray(payload.userActions)
      ? payload.userActions.map(entry => ({
        ...entry,
        userId: remapUserId(entry?.userId)
      }))
      : [],
    accessLevels: Array.isArray(payload.accessLevels)
      ? payload.accessLevels.map(level => ({
        id: level.id || genId('lvl'),
        name: level.name || 'Уровень доступа',
        description: level.description || '',
        permissions: clonePermissions(level.permissions || {})
      }))
      : []
  };
  ensureOperationCodes(safe);
  ensureOperationTypes(safe);
  const existingRouteNumbers = new Set();
  safe.cards = safe.cards.map(card => {
    const next = { ...card };
    ensureRouteCardNumber(next, safe, { existingNumbers: existingRouteNumbers });
    return next;
  });
  const usedBarcodes = new Set();
  safe.cards = safe.cards.map(card => {
    const next = { ...card };
    let barcode = trimToString(next.barcode);
    const isLegacy = /^\d{13}$/.test(barcode);
    if (!barcode || isLegacy || usedBarcodes.has(barcode)) {
      barcode = generateUniqueCode128(safe.cards, usedBarcodes);
    }
    next.barcode = barcode;
    usedBarcodes.add(barcode);
    return next;
  });
  const usedQrIds = new Set();
  safe.cards = safe.cards.map(card => {
    const next = { ...card };
    let qrId = normalizeQrInput(next.qrId);
    const valid = /^[A-Z0-9]{6,32}$/.test(qrId || '');
    if (!valid || usedQrIds.has(qrId)) {
      qrId = generateUniqueQrId(safe.cards, usedQrIds);
    }
    next.qrId = qrId;
    usedQrIds.add(qrId);
    return next;
  });
  safe.productionShiftTimes = normalizeProductionShiftTimes(payload.productionShiftTimes);
  safe.productionSchedule = normalizeProductionSchedule(payload.productionSchedule, safe.productionShiftTimes);
  safe.productionShiftTasks = normalizeProductionShiftTasks(payload.productionShiftTasks, safe.productionShiftTimes);
  safe.productionShifts = Array.isArray(payload.productionShifts) ? payload.productionShifts : [];
  return safe;
}

function mergeSnapshots(existingData, incomingData) {
  const currentMap = Object.fromEntries((existingData.cards || []).map(card => [card.id, card]));

  const mergedCards = (incomingData.cards || []).map(card => {
    const existing = currentMap[card.id];
    const next = deepClone(card);

    // Сохраняем дату создания, если она уже была сохранена
    next.createdAt = existing && existing.createdAt ? existing.createdAt : (next.createdAt || Date.now());

    // Не перезаписываем изначальный снимок, если он уже был сохранён ранее
    if (existing && existing.initialSnapshot) {
      next.initialSnapshot = existing.initialSnapshot;
    } else if (!next.initialSnapshot) {
      const snapshot = deepClone(next);
      snapshot.logs = [];
      next.initialSnapshot = snapshot;
    }

    return next;
  });

  return { ...incomingData, cards: mergedCards };
}

function mergeUsersForDataUpdate(currentUsers = [], incomingUsers = []) {
  const incomingMap = new Map(
    (incomingUsers || [])
      .filter(u => u && u.id != null)
      .map(u => [String(u.id).trim(), u])
      .filter(([id]) => id)
  );

  return (currentUsers || []).map(user => {
    const id = user && user.id != null ? String(user.id).trim() : '';
    const update = id ? incomingMap.get(id) : null;
    const abyss = isAbyssUser(user || update);
    const departmentId = abyss
      ? null
      : update
        ? normalizeDepartmentId(update.departmentId)
        : normalizeDepartmentId(user?.departmentId);

    return { ...user, id, departmentId };
  });
}

function isPasswordValid(password) {
  return typeof password === 'string' && password.length >= 6 && /[A-Za-zА-Яа-яЁё]/.test(password) && /\d/.test(password);
}

function isPasswordUnique(password, users, excludeId = null) {
  return !(users || []).some(u => {
    if (excludeId && u.id === excludeId) return false;
    return verifyPassword(password, u);
  });
}

function getAccessLevelForUser(user, accessLevels = []) {
  if (!user) return null;
  if ((user.name || user.username) === DEFAULT_ADMIN.name) {
    return accessLevels.find(l => l.id === 'level_admin') || { id: 'level_admin', name: 'Администратор', permissions: clonePermissions(DEFAULT_PERMISSIONS) };
  }
  return accessLevels.find(level => level.id === user.accessLevelId) || null;
}

function hasFullAccess(user) {
  return user && ((user.name || user.username) === DEFAULT_ADMIN.name || user.role === 'admin');
}

function getUserPermissions(user, accessLevels = []) {
  const level = getAccessLevelForUser(user, accessLevels);
  return level ? clonePermissions(level.permissions || {}) : clonePermissions(DEFAULT_PERMISSIONS);
}

function canManageUsers(user, accessLevels = []) {
  if (hasFullAccess(user)) return true;
  const perms = getUserPermissions(user, accessLevels);
  return Boolean(perms.tabs?.users?.edit);
}

function canManageAccessLevels(user, accessLevels = []) {
  if (hasFullAccess(user)) return true;
  const perms = getUserPermissions(user, accessLevels);
  return Boolean(perms.tabs?.accessLevels?.edit);
}

function canViewTab(user, accessLevels = [], tabKey = '') {
  const perms = getUserPermissions(user, accessLevels);
  const tab = perms.tabs?.[tabKey];
  return Boolean(tab && tab.view);
}

function sanitizeUser(user, level) {
  const safe = { ...user };
  delete safe.password;
  delete safe.passwordHash;
  delete safe.passwordSalt;
  safe.permissions = level ? clonePermissions(level.permissions || {}) : clonePermissions(DEFAULT_PERMISSIONS);
  return safe;
}

const database = new JsonDatabase(DATA_FILE);
const authStore = createAuthStore(database);
const sessionStore = createSessionStore({ ttlMs: SESSION_TTL_MS });

function parseCookies(cookieHeader = '') {
  return cookieHeader.split(';').reduce((acc, part) => {
    const [key, ...rest] = part.trim().split('=');
    if (!key) return acc;
    acc[key] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
}

function isMutatingMethod(method = '') {
  const normalized = method.toUpperCase();
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(normalized);
}

async function resolveUserBySession(req, { enforceCsrf = false } = {}) {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[SESSION_COOKIE];
  const session = sessionStore.getSession(token);
  if (!session) return { user: null, level: null, session: null };

  const data = await database.getData();
  const user = (data.users || []).find(u => u.id === session.userId);
  if (!user) {
    sessionStore.deleteSession(token);
    return { user: null, level: null, session: null };
  }

  const level = getAccessLevelForUser(user, data.accessLevels || []);
  const timeoutMinutes = level?.permissions?.inactivityTimeoutMinutes || DEFAULT_PERMISSIONS.inactivityTimeoutMinutes;
  const timeoutMs = Math.max(1, timeoutMinutes) * 60 * 1000;
  const lastActivity = session.lastActivity || session.createdAt;
  if (lastActivity && Date.now() - lastActivity > timeoutMs) {
    sessionStore.deleteSession(token);
    return { user: null, level: null, session: null };
  }

  if (enforceCsrf && isMutatingMethod(req.method)) {
    const headerToken = req.headers['x-csrf-token'];
    if (!headerToken || headerToken !== session.csrfToken) {
      return { user, level, session, csrfValid: false };
    }
  }

  sessionStore.touchSession(token);
  return { user, level, session, csrfValid: true };
}

async function ensureAuthenticated(req, res, { requireCsrf = true } = {}) {
  const { user, level, session, csrfValid } = await resolveUserBySession(req, { enforceCsrf: requireCsrf });
  if (!session || !user) {
    if (!res.headersSent) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
    }
    return null;
  }

  if (requireCsrf && isMutatingMethod(req.method) && csrfValid === false) {
    if (!res.headersSent) {
      sendJson(res, 403, { error: 'CSRF' });
    }
    return null;
  }

  return user;
}

async function ensureDefaultUser() {
  await database.update(data => {
    const draft = { ...deepClone(data) };
    draft.accessLevels = Array.isArray(draft.accessLevels) && draft.accessLevels.length
      ? draft.accessLevels.map(level => ({ ...level, permissions: clonePermissions(level.permissions || {}) }))
      : buildDefaultAccessLevels();
    draft.users = Array.isArray(draft.users) ? draft.users.map(user => {
      const next = { ...user };
      const isAbyss = (next.name || next.username) === DEFAULT_ADMIN.name;
      if (!next.passwordHash || !next.passwordSalt || isAbyss) {
        const sourcePassword = isAbyss ? DEFAULT_ADMIN_PASSWORD : next.password;
        const { hash, salt } = hashPassword(sourcePassword || DEFAULT_ADMIN_PASSWORD);
        next.passwordHash = hash;
        next.passwordSalt = salt;
      }
      delete next.password;
      if (isAbyss && !next.role) {
        next.role = DEFAULT_ADMIN.role;
      }
      next.departmentId = normalizeDepartmentId(next.departmentId);
      if (!next.accessLevelId) {
        next.accessLevelId = 'level_admin';
      }
      return next;
    }) : [];

    if (!draft.users.length) {
      draft.users.push(buildDefaultUser());
    }
    return draft;
  });
}

async function migrateRouteCardNumbers() {
  const data = await database.getData();
  const cards = Array.isArray(data.cards) ? data.cards : [];
  const migratedCards = cards.map(card => ({ ...card }));
  const ensureNumbers = new Set();
  const dedupedNumbers = new Set();
  let createdCount = 0;
  let replacedCount = 0;
  let processedCount = 0;

  migratedCards.forEach(card => {
    if (!card || card.isGroup === true) return;
    processedCount += 1;
    const before = trimToString(card.routeCardNumber);
    const ensured = ensureRouteCardNumber(card, { cards: migratedCards }, { existingNumbers: ensureNumbers });
    if (!before && ensured) {
      createdCount += 1;
    }
  });

  migratedCards.forEach(card => {
    if (!card || card.isGroup === true) return;
    const current = trimToString(card.routeCardNumber);
    if (!current) return;
    if (!dedupedNumbers.has(current)) {
      dedupedNumbers.add(current);
      return;
    }
    const newNumber = generateUniqueRouteCardNumber(dedupedNumbers);
    card.routeCardNumber = newNumber;
    replacedCount += 1;
  });

  const changed = createdCount > 0 || replacedCount > 0;
  if (changed) {
    await database.update(current => {
      const draft = deepClone(current);
      draft.cards = migratedCards;
      return draft;
    });
  }

  // eslint-disable-next-line no-console
  console.log(`Route card numbers migration: checked ${processedCount} cards, created ${createdCount}, replaced ${replacedCount}`);
}

async function migrateBarcodesToCode128() {
  const data = await database.getData();
  const cards = Array.isArray(data.cards) ? data.cards.map(card => ({ ...card })) : [];
  const used = new Set();
  let createdCount = 0;
  let replacedCount = 0;
  let processedCount = 0;

  cards.forEach(card => {
    if (!card) return;
    processedCount += 1;
    let barcode = trimToString(card.barcode);
    const isLegacy = /^\d{13}$/.test(barcode);
    const needsNew = !barcode || isLegacy || used.has(barcode);
    if (needsNew) {
      const newCode = generateUniqueCode128(cards, used);
      if (!barcode) {
        createdCount += 1;
      } else if (isLegacy || used.has(barcode)) {
        replacedCount += 1;
      }
      barcode = newCode;
    }
    used.add(barcode);
    card.barcode = barcode;
  });

  const changed = createdCount > 0 || replacedCount > 0;
  if (changed) {
    await database.update(current => {
      const draft = deepClone(current);
      draft.cards = cards;
      return draft;
    });
  }

  // eslint-disable-next-line no-console
  console.log(`Barcode migration: processed ${processedCount} cards, created ${createdCount}, replaced ${replacedCount}`);
}

async function migrateUsersToStringIds() {
  const data = await database.getData();
  const normalizedUsers = (data.users || []).map(normalizeUser);
  const changed = JSON.stringify(data.users || []) !== JSON.stringify(normalizedUsers);
  if (!changed) return;

  await database.update(current => {
    const draft = deepClone(current);
    draft.users = normalizedUsers;
    return draft;
  });
}

function formatDateOnly(ts) {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return '';
  try {
    return new Date(ts).toLocaleDateString('ru-RU');
  } catch (e) {
    return '';
  }
}

function mapCardForPrint(card = {}) {
  const toText = (value) => value == null ? '' : String(value);
  const batchRaw = card.batchSize == null ? card.quantity : card.batchSize;
  const individualNumbers = Array.isArray(card.itemSerials)
    ? card.itemSerials.map(v => (v == null ? '' : String(v))).join(', ')
    : toText(card.itemSerials || '');
  return {
    mkNumber: toText(card.routeCardNumber || card.orderNo || ''),
    docDesignation: toText(card.documentDesignation || card.contractNumber || ''),
    date: toText(card.documentDate || card.date || ''),
    issuedBySurname: toText(card.issuedBySurname || ''),
    programName: toText(card.programName || ''),
    labRequestNo: toText(card.labRequestNumber || ''),
    workBasis: toText(card.workBasis || ''),
    deliveryState: toText(card.supplyState || ''),
    productDesignation: toText(card.itemDesignation || card.drawing || ''),
    ntdSupply: toText(card.supplyStandard || ''),
    productName: toText(card.itemName || card.name || ''),
    mainMaterialGrade: toText(card.mainMaterialGrade || card.material || ''),
    mainMaterialsProcess: toText(card.mainMaterials || ''),
    specialNotes: toText(card.specialNotes || card.desc || ''),
    batchSize: toText(batchRaw == null ? '' : batchRaw),
    individualNumbers,
    headProduction: toText(card.responsibleProductionChief || ''),
    headSKK: toText(card.responsibleSKKChief || ''),
    zgdTech: toText(card.responsibleTechLead || ''),
    headProductionDate: formatDateOnly(card.responsibleProductionChiefAt),
    headSKKDate: formatDateOnly(card.responsibleSKKChiefAt),
    zgdTechDate: formatDateOnly(card.responsibleTechLeadAt)
  };
}

function mapOperationsForPrint(card = {}) {
  const ops = Array.isArray(card.operations) ? [...card.operations] : [];
  ops.sort((a, b) => (a.order || 0) - (b.order || 0));

  return ops.map(op => {
    const opCodeRaw = op.opCode ?? op.code ?? op.operationCode ?? op.operation_code ?? '';
    return {
      department: (op.centerName || op.department || ''),
      opCode: opCodeRaw == null ? '' : String(opCodeRaw),
      operationName: (op.opName || op.name || '')
    };
  });
}

function formatDateTime(ts) {
  if (!ts) return '-';
  try {
    return new Date(ts).toLocaleString();
  } catch (e) {
    return '-';
  }
}

function formatSecondsToHMS(sec) {
  const total = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function getOperationElapsedSeconds(op) {
  const base = typeof op?.elapsedSeconds === 'number' ? op.elapsedSeconds : 0;
  if (op?.status === 'IN_PROGRESS' && op.startedAt) {
    return base + (Date.now() - op.startedAt) / 1000;
  }
  return base;
}

function formatStartEnd(op) {
  const start = op.firstStartedAt || op.startedAt;
  let endLabel = '-';
  if (op.status === 'PAUSED') {
    const pauseTs = op.lastPausedAt || Date.now();
    endLabel = `${formatDateTime(pauseTs)} (П)`;
  } else if (op.finishedAt) {
    endLabel = formatDateTime(op.finishedAt);
  } else if (op.status === 'DONE' && op.finishedAt) {
    endLabel = formatDateTime(op.finishedAt);
  } else if (op.status === 'IN_PROGRESS') {
    endLabel = '-';
  }

  return `<div class="nk-lines"><div>Н: ${escapeHtml(formatDateTime(start))}</div><div>К: ${escapeHtml(endLabel)}</div></div>`;
}

function statusBadge(status) {
  if (status === 'IN_PROGRESS') return '<span class="badge status-in-progress">В работе</span>';
  if (status === 'PAUSED') return '<span class="badge status-paused">Пауза</span>';
  if (status === 'DONE') return '<span class="badge status-done">Завершена</span>';
  return '<span class="badge status-not-started">Не начата</span>';
}

function toSafeCount(val) {
  const num = parseInt(val, 10);
  if (!Number.isFinite(num) || num < 0) return 0;
  return num;
}

function getOperationQuantity(op, card) {
  if (op && (op.quantity || op.quantity === 0)) {
    const q = toSafeCount(op.quantity);
    return Number.isFinite(q) ? q : '';
  }
  if (card && (card.quantity || card.quantity === 0)) {
    const q = toSafeCount(card.quantity);
    return Number.isFinite(q) ? q : '';
  }
  return '';
}

function renderQuantityRow(card, op, { colspan = 9, blankForPrint = false } = {}) {
  const opQty = getOperationQuantity(op, card);
  const totalLabel = opQty === '' ? '—' : `${opQty} шт`;
  const base = `<span class="qty-total">Количество изделий: ${escapeHtml(totalLabel)}</span>`;
  const goodVal = op.goodCount != null ? op.goodCount : 0;
  const scrapVal = op.scrapCount != null ? op.scrapCount : 0;
  const holdVal = op.holdCount != null ? op.holdCount : 0;

  const chipGood = blankForPrint ? '____' : escapeHtml(goodVal);
  const chipScrap = blankForPrint ? '____' : escapeHtml(scrapVal);
  const chipHold = blankForPrint ? '____' : escapeHtml(holdVal);

  return `<tr class="op-qty-row"><td colspan="${colspan}">
    <div class="qty-row-content readonly">
      ${base}
      <span class="qty-chip">Годные: ${chipGood}</span>
      <span class="qty-chip">Брак: ${chipScrap}</span>
      <span class="qty-chip">Задержано: ${chipHold}</span>
    </div>
  </td></tr>`;
}

function buildSummaryTableHtml(card, { blankForPrint = false } = {}) {
  const opsSorted = Array.isArray(card?.operations) ? [...card.operations] : [];
  opsSorted.sort((a, b) => (a.order || 0) - (b.order || 0));
  if (!opsSorted.length) return '<p>Маршрут пока пуст.</p>';

  let html = '<table><thead><tr>' +
    '<th>Порядок</th><th>Подразделение</th><th>Код операции</th><th>Наименование операции</th><th>Исполнитель</th><th>План (мин)</th><th>Статус</th><th>Дата и время Н/К</th><th>Текущее / факт. время</th><th>Комментарии</th>' +
    '</tr></thead><tbody>';

  opsSorted.forEach((op, idx) => {
    const elapsed = getOperationElapsedSeconds(op);
    let timeCell = '';
    if (op.status === 'IN_PROGRESS' || op.status === 'PAUSED') {
      timeCell = `<span class="wo-timer" data-row-id="${escapeHtml(card.id || '')}::${escapeHtml(op.id || '')}">${formatSecondsToHMS(elapsed)}</span>`;
    } else if (op.status === 'DONE') {
      const seconds = typeof op.elapsedSeconds === 'number' && op.elapsedSeconds
        ? op.elapsedSeconds
        : (op.actualSeconds || 0);
      timeCell = formatSecondsToHMS(seconds);
    }

    const executorCell = escapeHtml(op.executor || '');
    const startEndCell = formatStartEnd(op);

    html += '<tr>' +
      `<td>${idx + 1}</td>` +
      `<td>${escapeHtml(op.centerName || '')}</td>` +
      `<td>${escapeHtml(op.opCode || '')}</td>` +
      `<td>${escapeHtml(op.opName || op.name || '')}</td>` +
      `<td>${executorCell}</td>` +
      `<td>${op.plannedMinutes || ''}</td>` +
      `<td>${statusBadge(op.status)}</td>` +
      `<td>${startEndCell}</td>` +
      `<td>${timeCell}</td>` +
      `<td>${escapeHtml(op.comment || '')}</td>` +
      '</tr>';

    html += renderQuantityRow(card, op, { readonly: true, colspan: 10, blankForPrint });
  });

  html += '</tbody></table>';
  return html;
}

function buildInitialSummaryTableHtml(card) {
  const opsSorted = Array.isArray(card?.operations) ? [...card.operations] : [];
  opsSorted.sort((a, b) => (a.order || 0) - (b.order || 0));
  if (!opsSorted.length) return '<p>Маршрут пока пуст.</p>';

  let html = '<table><thead><tr>' +
    '<th>Порядок</th><th>Подразделение</th><th>Код операции</th><th>Наименование операции</th><th>Исполнитель</th><th>План (мин)</th>' +
    '</tr></thead><tbody>';

  opsSorted.forEach((op, idx) => {
    const executorCell = escapeHtml(op.executor || '');

    html += '<tr>' +
      `<td>${idx + 1}</td>` +
      `<td>${escapeHtml(op.centerName || '')}</td>` +
      `<td>${escapeHtml(op.opCode || '')}</td>` +
      `<td>${escapeHtml(op.opName || op.name || '')}</td>` +
      `<td>${executorCell}</td>` +
      `<td>${op.plannedMinutes || ''}</td>` +
      '</tr>';

    html += renderQuantityRow(card, op, { readonly: true, colspan: 6, blankForPrint: true });
  });

  html += '</tbody></table>';
  return html;
}

function renderCardDisplayField(label, value, { multiline = false, fullWidth = false } = {}) {
  const classes = ['card-display-field'];
  if (fullWidth) classes.push('card-display-field-full');
  const safeValue = value === '' || value == null ? '—' : escapeHtml(String(value));
  const content = multiline ? safeValue.replace(/\n/g, '<br>') : safeValue;
  return `<div class="${classes.join(' ')}">
    <div class="field-label">${escapeHtml(label)}</div>
    <div class="field-value${multiline ? ' multiline' : ''}">${content}</div>
  </div>`;
}

function buildCardInfoBlockForPrint(card, { startCollapsed = false } = {}) {
  if (!card) return '';
  const blockClasses = ['card-main-collapse-block', 'card-info-collapse-block', 'card-info-static'];
  if (startCollapsed) blockClasses.push('is-collapsed');
  const summaryText = `${card.itemName || card.name || 'Маршрутная карта'} · ${(card.quantity || card.batchSize || '') ? `${toSafeCount(card.quantity || card.batchSize)} шт.` : 'Размер партии не указан'} · ${card.routeCardNumber ? 'МК № ' + card.routeCardNumber : 'МК без номера'}`;

  let html = `<div class="${blockClasses.join(' ')}" data-card-id="${escapeHtml(card.id || '')}">`;
  html += '<div class="card-main-header">' +
    '<h3 class="card-main-title">Основные данные</h3>' +
    `<div class="card-main-summary">${escapeHtml(summaryText)}</div>` +
    '</div>';

  html += '<div class="card-main-collapse-body">';
  html += '<div class="card-info-block">';

  html += '<div class="card-meta-grid card-meta-grid-compact card-display-grid">' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Маршрутная карта №', card.routeCardNumber || card.orderNo || '') +
    renderCardDisplayField('Обозначение документа', card.documentDesignation || card.drawing || '') +
    renderCardDisplayField('Дата', card.documentDate || card.date || '') +
    '</div>' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Фамилия выписавшего маршрутную карту', card.issuedBySurname || '') +
    renderCardDisplayField('Название программы', card.programName || '') +
    renderCardDisplayField('Номер заявки лаборатории', card.labRequestNumber || '') +
    '</div>' +
    '</div>';

  html += '<div class="card-meta-grid card-meta-grid-compact card-display-grid">' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Основание для выполнения работ', card.workBasis || card.contractNumber || '', { multiline: true }) +
    '</div>' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Состояние поставки', card.supplyState || '') +
    '</div>' +
    '</div>';

  html += '<div class="card-meta-grid card-meta-grid-compact card-display-grid">' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Обозначение изделия', card.itemDesignation || card.drawing || '') +
    '</div>' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('НТД на поставку', card.supplyStandard || '') +
    '</div>' +
    '</div>';

  html += renderCardDisplayField('Наименование изделия', card.itemName || card.name || '', { multiline: true, fullWidth: true });

  html += '<div class="card-meta-grid card-meta-grid-compact card-display-grid">' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Основные материалы, применяемые в техпроцессе (согласно заказу на производство)', card.mainMaterials || '', { multiline: true }) +
    '</div>' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Марка основного материала', card.mainMaterialGrade || card.material || '') +
    '</div>' +
    '</div>';

  const batchLabel = card.batchSize === '' || card.batchSize == null ? (card.quantity === '' || card.quantity == null ? '—' : toSafeCount(card.quantity)) : card.batchSize;
  const itemSerials = Array.isArray(card.itemSerials)
    ? card.itemSerials.map(v => (v == null ? '' : String(v))).join(', ')
    : (card.itemSerials || '');
  html += '<div class="card-meta-grid card-meta-grid-compact card-display-grid">' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Размер партии', batchLabel) +
    '</div>' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Индивидуальные номера изделий', itemSerials, { multiline: true }) +
    '</div>' +
    '</div>';

  html += renderCardDisplayField('Особые отметки', card.specialNotes || card.desc || '', { multiline: true, fullWidth: true });

  html += '<div class="card-meta-grid card-meta-grid-compact card-display-grid card-meta-responsible">' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Начальник производства (ФИО)', card.responsibleProductionChief || '') +
    '</div>' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Начальник СКК (ФИО)', card.responsibleSKKChief || '') +
    '</div>' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('ЗГД по технологиям (ФИО)', card.responsibleTechLead || '') +
    '</div>' +
    '</div>';

  html += '</div>';
  html += '</div>';
  html += '</div>';
  return html;
}

function buildInitialSnapshotHtml(card) {
  const snapshot = card?.initialSnapshot || card || {};
  const infoBlock = buildCardInfoBlockForPrint(snapshot, { startCollapsed: true });
  const opsHtml = buildInitialSummaryTableHtml(snapshot);
  const wrappedOps = opsHtml.trim().startsWith('<table') ? `<div class="table-wrapper">${opsHtml}</div>` : opsHtml;
  return infoBlock + wrappedOps;
}

function buildLogHistoryTableHtml(card) {
  const logs = Array.isArray(card?.logs) ? [...card.logs] : [];
  logs.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  if (!logs.length) return '<p>История изменений пока отсутствует.</p>';
  let html = '<table><thead><tr><th>Дата/время</th><th>Тип действия</th><th>Объект</th><th>Старое значение</th><th>Новое значение</th></tr></thead><tbody>';
  logs.forEach(entry => {
    const date = formatDateTime(entry.ts || Date.now());
    html += '<tr>' +
      `<td>${escapeHtml(date)}</td>` +
      `<td>${escapeHtml(entry.action || '')}</td>` +
      `<td>${escapeHtml(entry.object || '')}${entry.field ? ' (' + escapeHtml(entry.field) + ')' : ''}</td>` +
      `<td>${escapeHtml(entry.oldValue || '')}</td>` +
      `<td>${escapeHtml(entry.newValue || '')}</td>` +
      '</tr>';
  });
  html += '</tbody></table>';
  return html;
}

function formatQuantityValue(val) {
  if (val === '' || val == null) return '';
  return `${val} шт`;
}

function cardStatusText(card) {
  const status = (card?.status || 'NOT_STARTED').toUpperCase();
  if (status === 'IN_PROGRESS') return 'Выполняется';
  if (status === 'PAUSED') return 'Пауза';
  if (status === 'DONE') return 'Завершена';
  return 'Не запущена';
}

async function handlePrintRoutes(req, res) {
  const parsed = url.parse(req.url, true);
  const mkMatch = /^\/print\/mk\/([^/]+)\/?$/.exec(parsed.pathname || '');
  const barcodeMkMatch = /^\/print\/barcode\/mk\/([^/]+)\/?$/.exec(parsed.pathname || '');
  const barcodeGroupMatch = /^\/print\/barcode\/group\/([^/]+)\/?$/.exec(parsed.pathname || '');
  const barcodePasswordMatch = /^\/print\/barcode\/password\/([^/]+)\/?$/.exec(parsed.pathname || '');
  const logSummaryMatch = /^\/print\/log\/summary\/([^/]+)\/?$/.exec(parsed.pathname || '');
  const logFullMatch = /^\/print\/log\/full\/([^/]+)\/?$/.exec(parsed.pathname || '');

  const matchExists = mkMatch || barcodeMkMatch || barcodeGroupMatch || barcodePasswordMatch || logSummaryMatch || logFullMatch;
  if (!matchExists) return false;

  const { user } = await resolveUserBySession(req);
  if (!user) {
    res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Требуется авторизация');
    return true;
  }

  const data = await database.getData();

  const ensureCardNumber = async (card) => {
    if (!card || card.isGroup === true) return card;
    const existingNumbers = collectRouteCardNumbers(data);
    const before = trimToString(card.routeCardNumber);
    const ensured = ensureRouteCardNumber(card, data, { existingNumbers });
    if (before !== ensured) {
      await database.update(draft => {
        const target = (draft.cards || []).find(c => c.id === card.id);
        if (target) target.routeCardNumber = ensured;
        return draft;
      });
    }
    return card;
  };

  const ensureCardQrId = async (card) => {
    if (!card) return card;
    const used = new Set();
    (data.cards || []).forEach(c => {
      if (!c || c.id === card.id) return;
      const candidate = trimToString(c.qrId).toUpperCase();
      if (candidate) used.add(candidate);
    });
    let qrId = normalizeQrInput(card.qrId);
    const valid = /^[A-Z0-9]{6,32}$/.test(qrId || '');
    if (!valid || used.has(qrId)) {
      qrId = generateUniqueQrId(data.cards, used);
      await database.update(draft => {
        const target = (draft.cards || []).find(c => c.id === card.id);
        if (target) target.qrId = qrId;
        return draft;
      });
      card.qrId = qrId;
    }
    return card;
  };

  const ensureCardBarcode = async (card) => {
    if (!card) return card;
    const current = trimToString(card.barcode);
    const isLegacy = /^\d{13}$/.test(current);
    const isGroup = card.isGroup === true;
    if (isGroup) {
      if (current && !isLegacy) return card;
      const nextCode = generateUniqueCode128(data.cards);
      await database.update(draft => {
        const target = (draft.cards || []).find(c => c.id === card.id);
        if (target) target.barcode = nextCode;
        return draft;
      });
      card.barcode = nextCode;
      return card;
    }

    const routeCode = trimToString(card.routeCardNumber);
    if (routeCode && current === routeCode && !isLegacy) return card;
    const nextCode = routeCode || generateUniqueCode128(data.cards);
    await database.update(draft => {
      const target = (draft.cards || []).find(c => c.id === card.id);
      if (target) target.barcode = nextCode;
      return draft;
    });
    card.barcode = nextCode;
    return card;
  };

  try {
    if (mkMatch) {
      const cardId = decodeURIComponent(mkMatch[1]);
      const card = (data.cards || []).find(c => c.id === cardId);
      if (!card) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Маршрутная карта не найдена');
        return true;
      }

      await ensureCardNumber(card);
      await ensureCardQrId(card);

      const html = renderMkPrint({
        mk: mapCardForPrint(card),
        operations: mapOperationsForPrint(card),
        routeCardNumber: card.routeCardNumber || '',
        barcodeValue: trimToString(card.qrId || ''),
        barcodeSvg: await makeBarcodeSvg(card.qrId)
      });
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      res.end(html);
      return true;
    }

    if (barcodeMkMatch) {
      const cardId = decodeURIComponent(barcodeMkMatch[1]);
      const card = (data.cards || []).find(c => c.id === cardId && c.isGroup !== true);
      if (!card) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Маршрутная карта не найдена');
        return true;
      }

      await ensureCardNumber(card);
      await ensureCardQrId(card);

      const qrId = trimToString(card.qrId || '');
      const html = renderBarcodeMk({
        code: qrId,
        card,
        routeCardNumber: trimToString(card.routeCardNumber || ''),
        barcodeSvg: await makeBarcodeSvg(qrId)
      });

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return true;
    }

    if (barcodeGroupMatch) {
      const groupId = decodeURIComponent(barcodeGroupMatch[1]);
      const card = (data.cards || []).find(c => c.id === groupId && c.isGroup === true);
      if (!card) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Группа не найдена');
        return true;
      }
      await ensureCardQrId(card);
      const code = trimToString(card.qrId || '');
      const html = renderBarcodeGroup({
        code,
        card,
        barcodeSvg: await makeBarcodeSvg(code)
      });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return true;
    }

    if (barcodePasswordMatch) {
      const userId = decodeURIComponent(barcodePasswordMatch[1]);
      const target = (data.users || []).find(u => u.id === userId);
      if (!target) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Пользователь не найден');
        return true;
      }
      const password = trimToString(target.password || '');
      const html = renderBarcodePassword({
        code: password,
        username: trimToString(target.name || ''),
        barcodeSvg: await makeBarcodeSvg(password)
      });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return true;
    }

    if (logSummaryMatch) {
      const cardId = decodeURIComponent(logSummaryMatch[1]);
      const card = (data.cards || []).find(c => c.id === cardId);
      if (!card) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Маршрутная карта не найдена');
        return true;
      }
      await ensureCardNumber(card);
      await ensureCardQrId(card);
      await ensureCardBarcode(card);
      const barcodeValue = trimToString(card.qrId || '');
      const html = renderLogSummary({
        card,
        barcodeValue,
        barcodeSvg: await makeBarcodeSvg(barcodeValue),
        summaryHtml: buildSummaryTableHtml(card),
        formatQuantityValue,
        cardStatusText
      });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return true;
    }

    if (logFullMatch) {
      const cardId = decodeURIComponent(logFullMatch[1]);
      const card = (data.cards || []).find(c => c.id === cardId);
      if (!card) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Маршрутная карта не найдена');
        return true;
      }
      await ensureCardNumber(card);
      await ensureCardQrId(card);
      await ensureCardBarcode(card);
      const barcodeValue = trimToString(card.qrId || '');
      const html = renderLogFull({
        card,
        barcodeValue,
        barcodeSvg: await makeBarcodeSvg(barcodeValue),
        initialHtml: buildInitialSnapshotHtml(card),
        historyHtml: buildLogHistoryTableHtml(card),
        summaryHtml: buildSummaryTableHtml(card, { blankForPrint: false }),
        formatQuantityValue,
        cardStatusText
      });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return true;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Print render error', err);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Ошибка формирования печатной формы');
    return true;
  }

  return false;
}

function parseJsonBody(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch (err) {
    return null;
  }
}

async function handleSecurityRoutes(req, res) {
  const parsed = url.parse(req.url, true);
  if (!parsed.pathname.startsWith('/api/security/')) return false;

  const authedUser = await ensureAuthenticated(req, res);
  if (!authedUser) return true;
  const data = await database.getData();
  const accessLevels = data.accessLevels || [];

  if (parsed.pathname === '/api/security/users' && req.method === 'GET') {
    if (!canViewTab(authedUser, accessLevels, 'users')) {
      sendJson(res, 403, { error: 'Нет прав' });
      return true;
    }
    const sanitized = (data.users || []).map(u => sanitizeUser(u, getAccessLevelForUser(u, accessLevels)));
    sendJson(res, 200, { users: sanitized });
    return true;
  }

  if (parsed.pathname === '/api/security/users' && req.method === 'POST') {
    if (!canManageUsers(authedUser, accessLevels)) {
      sendJson(res, 403, { error: 'Нет прав' });
      return true;
    }
    const raw = await parseBody(req).catch(() => '');
    const payload = parseJsonBody(raw);
    if (!payload) {
      sendJson(res, 400, { error: 'Некорректные данные' });
      return true;
    }
    const { name, password, accessLevelId, status } = payload;
    const username = (name || '').trim();
    if (!username) {
      sendJson(res, 400, { error: 'Имя обязательно' });
      return true;
    }
    if (!isPasswordValid(password)) {
      sendJson(res, 400, { error: 'Пароль должен быть не короче 6 символов и содержать буквы и цифры' });
      return true;
    }
    if (!isPasswordUnique(password, data.users || [])) {
      sendJson(res, 400, { error: 'Пароль уже используется другим пользователем' });
      return true;
    }
    if (!accessLevels.find(l => l.id === accessLevelId)) {
      sendJson(res, 400, { error: 'Уровень доступа не найден' });
      return true;
    }
    const { hash, salt } = hashPassword(password);
    const saved = await database.update(current => {
      const draft = normalizeData(current);
      draft.users = Array.isArray(draft.users) ? draft.users : [];
      draft.users.push({
        id: createUserId(draft.users),
        name: username,
        passwordHash: hash,
        passwordSalt: salt,
        accessLevelId,
        status: status || 'active'
      });
      return draft;
    });
    const updated = (saved.users || []).map(u => sanitizeUser(u, getAccessLevelForUser(u, saved.accessLevels || [])));
    sendJson(res, 200, { users: updated });
    return true;
  }

  if (parsed.pathname.startsWith('/api/security/users/') && req.method === 'PUT') {
    if (!canManageUsers(authedUser, accessLevels)) {
      sendJson(res, 403, { error: 'Нет прав' });
      return true;
    }
    const userId = parsed.pathname.split('/').pop();
    const raw = await parseBody(req).catch(() => '');
    const payload = parseJsonBody(raw);
    if (!payload) {
      sendJson(res, 400, { error: 'Некорректные данные' });
      return true;
    }
    const { name, password, accessLevelId, status } = payload;
    const saved = await database.update(current => {
      const draft = normalizeData(current);
      const target = (draft.users || []).find(u => u.id === userId);
      if (!target) {
        throw new Error('Пользователь не найден');
      }
      if (name) target.name = name.trim();
      if (status) target.status = status;
      if (accessLevelId && accessLevels.find(l => l.id === accessLevelId)) {
        target.accessLevelId = accessLevelId;
      }
      if (password) {
        if (!isPasswordValid(password)) {
          throw new Error('Пароль должен быть не короче 6 символов и содержать буквы и цифры');
        }
        if (!isPasswordUnique(password, draft.users, userId)) {
          throw new Error('Пароль уже используется другим пользователем');
        }
        const { hash, salt } = hashPassword(password);
        target.passwordHash = hash;
        target.passwordSalt = salt;
      }
      return draft;
    }).catch(err => ({ error: err.message }));

    if (saved.error) {
      sendJson(res, 400, { error: saved.error });
      return true;
    }
    const updated = (saved.users || []).map(u => sanitizeUser(u, getAccessLevelForUser(u, saved.accessLevels || [])));
    sendJson(res, 200, { users: updated });
    return true;
  }

  if (parsed.pathname.startsWith('/api/security/users/') && req.method === 'DELETE') {
    if (!canManageUsers(authedUser, accessLevels)) {
      sendJson(res, 403, { error: 'Нет прав' });
      return true;
    }
    const userId = parsed.pathname.split('/').pop();
    await database.update(current => {
      const draft = normalizeData(current);
      draft.users = (draft.users || []).filter(u => u.id !== userId || (u.name || u.username) === DEFAULT_ADMIN.name);
      return draft;
    });
    const fresh = await database.getData();
    const updated = (fresh.users || []).map(u => sanitizeUser(u, getAccessLevelForUser(u, fresh.accessLevels || [])));
    sendJson(res, 200, { users: updated });
    return true;
  }

  if (parsed.pathname === '/api/security/access-levels' && req.method === 'GET') {
    if (!canViewTab(authedUser, accessLevels, 'accessLevels')) {
      sendJson(res, 403, { error: 'Нет прав' });
      return true;
    }
    sendJson(res, 200, { accessLevels });
    return true;
  }

  if (parsed.pathname === '/api/security/access-levels' && req.method === 'POST') {
    if (!canManageAccessLevels(authedUser, accessLevels)) {
      sendJson(res, 403, { error: 'Нет прав' });
      return true;
    }
    const raw = await parseBody(req).catch(() => '');
    const payload = parseJsonBody(raw);
    if (!payload) {
      sendJson(res, 400, { error: 'Некорректные данные' });
      return true;
    }
    const { id, name, description, permissions } = payload;
    if (!name) {
      sendJson(res, 400, { error: 'Название обязательно' });
      return true;
    }
    const saved = await database.update(current => {
      const draft = normalizeData(current);
      const nextLevel = { id: id || genId('lvl'), name: name.trim(), description: description || '', permissions: clonePermissions(permissions || {}) };
      const existingIdx = (draft.accessLevels || []).findIndex(l => l.id === nextLevel.id);
      if (existingIdx >= 0) {
        draft.accessLevels[existingIdx] = nextLevel;
      } else {
        draft.accessLevels.push(nextLevel);
      }
      return draft;
    });
    sendJson(res, 200, { accessLevels: saved.accessLevels || [] });
    return true;
  }

  return false;
}

async function handleAuth(req, res) {
  if (req.method === 'POST' && req.url === '/api/login') {
    try {
      const raw = await parseBody(req);
      const contentType = (req.headers['content-type'] || '').toLowerCase();
      let password = '';

      if (contentType.includes('application/json')) {
        const payload = JSON.parse(raw || '{}');
        password = (payload.password || '').toString();
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        const params = new URLSearchParams(raw || '');
        password = (params.get('password') || '').toString();
      } else if (contentType.includes('multipart/form-data')) {
        const multipartMatch = raw.match(/name="password"[^\r\n]*\r\n[^\r\n]*\r\n([\s\S]*?)\r\n/);
        if (multipartMatch && multipartMatch[1]) {
          password = multipartMatch[1].trim();
        }
      }

      const user = await authStore.getUserByPassword(password);
      if (!user) {
        sendJson(res, 401, { success: false, error: 'Неверный пароль' });
        return true;
      }

      const accessLevels = await authStore.getAccessLevels();
      const session = sessionStore.createSession(user.id);
      const level = getAccessLevelForUser(user, accessLevels);
      const safeUser = sanitizeUser(user, level);
      const cookieParts = [
        `${SESSION_COOKIE}=${session.token}`,
        'HttpOnly',
        'Path=/',
        `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
        'SameSite=Lax'
      ];
      if (COOKIE_SECURE) cookieParts.push('Secure');
      res.writeHead(200, {
        'Set-Cookie': cookieParts.join('; '),
        'Content-Type': 'application/json; charset=utf-8'
      });
      await appendUserVisit(user.id);
      await appendUserAction(user.id, 'Вошёл в систему');
      res.end(JSON.stringify({ success: true, user: safeUser, csrfToken: session.csrfToken }));
    } catch (err) {
      sendJson(res, 400, { success: false, error: 'Некорректный запрос' });
    }
    return true;
  }

  if (req.method === 'POST' && req.url === '/api/logout') {
    const { user, session, csrfValid } = await resolveUserBySession(req, { enforceCsrf: true });
    if (!session) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return true;
    }
    if (csrfValid === false) {
      sendJson(res, 403, { error: 'CSRF' });
      return true;
    }
    if (user) {
      await appendUserAction(user.id, 'Вышел из системы');
    }
    sessionStore.deleteSession(session.token);
    const cookieParts = [
      `${SESSION_COOKIE}=`,
      'HttpOnly',
      'Path=/',
      'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      'SameSite=Lax'
    ];
    if (COOKIE_SECURE) cookieParts.push('Secure');
    res.writeHead(200, {
      'Set-Cookie': cookieParts.join('; '),
      'Content-Type': 'application/json; charset=utf-8'
    });
    res.end(JSON.stringify({ status: 'ok' }));
    return true;
  }

  if (req.method === 'GET' && req.url === '/api/session') {
    const { user, level, session } = await resolveUserBySession(req, { enforceCsrf: false });
    if (!user || !session) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return true;
    }
    sendJson(res, 200, { user: sanitizeUser(user, level), csrfToken: session.csrfToken });
    return true;
  }

  return false;
}

async function handleApi(req, res) {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  if (!pathname.startsWith('/api/')) return false;
  if (PUBLIC_API_PATHS.has(pathname)) return false;
  if (await handleSecurityRoutes(req, res)) return true;

  if (req.method === 'GET' && pathname === '/api/chat/stream') {
    const me = await ensureAuthenticated(req, res, { requireCsrf: false });
    if (!me) return true;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Surrogate-Control': 'no-store',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    msgSseAddClient(me.id, res);

    req.on('close', () => {
      msgSseRemoveClient(me.id, res);
    });

    return true;
  }

  if (req.method === 'GET' && pathname === '/api/chat/users') {
    const reqId = newReqId();
    chatDbg(req, reqId, `BEGIN ${req.method} ${pathname}`);
    const me = await ensureAuthenticated(req, res, { requireCsrf: false });
    if (!me) {
      chatDbg(req, reqId, 'ME is null/unauthorized');
      return true;
    }
    chatDbg(req, reqId, 'ME', {
      id: me?.id,
      legacyId: me?.legacyId,
      name: me?.name,
      role: me?.role
    });
    const data = await database.getData();
    const meIdCanonical = normalizeChatUserId(me.id, data);
    const meAliasSet = getUserIdAliasSet(me, data);
    const onlineUsers = new Set(Array.from(MSG_SSE_CLIENTS.keys()).map(String));
    const usersList = (data.users || [])
      .filter(u => u && u.id && u.id !== meIdCanonical)
      .map(u => ({
        id: u.id,
        name: u.name || 'Пользователь',
        isOnline: onlineUsers.has(String(u.id)),
        unreadCount: 0,
        messageCount: 0,
        hasHistory: false,
        conversationId: null
      }));

    const systemEntry = {
      id: SYSTEM_USER_ID,
      name: 'Система',
      isOnline: null,
      unreadCount: 0,
      messageCount: 0,
      hasHistory: false,
      conversationId: null
    };

    const participantsMap = new Map();
    const conversations = (data.chatConversations || []).filter(conv => {
      if (!conv || conv.type !== 'direct') return false;
      if (!Array.isArray(conv.participantIds) || conv.participantIds.length !== 2) return false;
      return conversationHasParticipant(conv, meAliasSet);
    });
    conversations.forEach(conv => {
      const peerIdRaw = getConversationPeerIdByAliases(conv, meAliasSet);
      const peerIdCanonical = normalizeChatUserId(peerIdRaw, data);
      if (peerIdCanonical) participantsMap.set(peerIdCanonical, conv);
    });

    const messagesByConversation = new Map();
    (data.chatMessages || []).forEach(message => {
      if (!message || !message.conversationId) return;
      if (!messagesByConversation.has(message.conversationId)) {
        messagesByConversation.set(message.conversationId, []);
      }
      messagesByConversation.get(message.conversationId).push(message);
    });

    const statesByConversation = new Map();
    (data.chatStates || []).forEach(state => {
      if (!state || !meAliasSet.has(String(state.userId))) return;
      statesByConversation.set(state.conversationId, state);
    });

    const allEntries = [...usersList, systemEntry].map(entry => {
      const conversation = participantsMap.get(entry.id);
      if (!conversation) return entry;
      const convoMessages = messagesByConversation.get(conversation.id) || [];
      const state = statesByConversation.get(conversation.id);
      const lastReadSeq = state?.lastReadSeq || 0;
      const unreadCount = convoMessages.filter(msg => msg.senderId === entry.id && msg.seq > lastReadSeq).length;
      const messageCount = convoMessages.length;
      return {
        ...entry,
        unreadCount,
        messageCount,
        hasHistory: messageCount > 0,
        conversationId: conversation.id
      };
    });

    chatDbg(req, reqId, 'USERS list size', usersList.length);
    chatDbg(req, reqId, 'USERS conv count for me', conversations.length);
    chatDbg(req, reqId, 'USERS sample', allEntries.slice(0, 5).map(entry => ({
      id: entry.id,
      name: entry.name,
      unread: entry.unreadCount,
      msgCount: entry.messageCount,
      hasHistory: entry.hasHistory
    })));
    sendJson(res, 200, { users: allEntries });
    chatDbg(req, reqId, 'OK');
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/push/vapidPublicKey') {
    const me = await ensureAuthenticated(req, res, { requireCsrf: false });
    if (!me) return true;
    if (!isWebPushConfigured()) {
      sendJson(res, 501, { error: 'WebPush не настроен на сервере' });
      return true;
    }
    sendJson(res, 200, { publicKey: WEBPUSH_VAPID_PUBLIC });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/push/subscribe') {
    const me = await ensureAuthenticated(req, res, { requireCsrf: true });
    if (!me) return true;
    if (!isWebPushConfigured()) {
      sendJson(res, 501, { error: 'WebPush не настроен на сервере' });
      return true;
    }
    const raw = await parseBody(req).catch(() => '');
    const payload = parseJsonBody(raw);
    if (!payload) {
      sendJson(res, 400, { error: 'Некорректные данные' });
      return true;
    }
    const normalized = normalizeWebPushSubscription(payload.subscription || null);
    if (!normalized) {
      sendJson(res, 400, { error: 'Некорректная подписка' });
      return true;
    }
    await saveWebPushSubscriptionForUser(me.id, normalized, payload.userAgent || '');
    sendJson(res, 200, { status: 'ok' });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/push/unsubscribe') {
    const me = await ensureAuthenticated(req, res, { requireCsrf: true });
    if (!me) return true;
    const raw = await parseBody(req).catch(() => '');
    const payload = parseJsonBody(raw) || {};
    const endpoint = trimToString(payload.endpoint || '');
    if (!endpoint) {
      sendJson(res, 400, { error: 'Некорректный endpoint' });
      return true;
    }
    await removeWebPushSubscriptionForUser(me.id, endpoint);
    sendJson(res, 200, { status: 'ok' });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/push/test') {
    const me = await ensureAuthenticated(req, res, { requireCsrf: true });
    if (!me) return true;
    if (!isWebPushConfigured()) {
      sendJson(res, 501, { error: 'WebPush не настроен на сервере' });
      return true;
    }
    const raw = await parseBody(req).catch(() => '');
    const payload = parseJsonBody(raw) || {};
    const targetUserId = trimToString(payload.targetUserId || '') || me.id;
    console.log('[WebPush Test] targetUserId:', targetUserId, 'requestedBy:', me.id);
    const sent = await sendWebPushToUser(targetUserId, {
      type: 'chat',
      title: 'Тестовое уведомление',
      body: 'WebPush работает корректно.',
      url: `/profile/${encodeURIComponent(targetUserId)}`,
      peerId: 'system'
    });
    console.log('[WebPush Test] sent:', sent);
    sendJson(res, 200, { status: 'sent' });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/fcm/subscribe') {
    const me = await ensureAuthenticated(req, res, { requireCsrf: true });
    if (!me) return true;
    if (!isFcmConfigured()) {
      sendJson(res, 501, { error: 'FCM не настроен на сервере' });
      return true;
    }
    const raw = await parseBody(req).catch(() => '');
    const payload = parseJsonBody(raw) || {};
    const normalized = normalizeFcmToken(payload);
    if (!normalized) {
      sendJson(res, 400, { error: 'Некорректный token' });
      return true;
    }
    await saveFcmTokenForUser(me.id, normalized);
    sendJson(res, 200, { status: 'ok' });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/user-actions') {
    const me = await ensureAuthenticated(req, res, { requireCsrf: false });
    if (!me) return true;
    const targetId = trimToString(parsed.query.userId || me.id) || me.id;
    if (String(targetId) !== String(me.id)) {
      sendJson(res, 403, { error: 'Нет доступа' });
      return true;
    }
    const limit = Math.max(1, Math.min(500, parseInt(parsed.query.limit, 10) || 200));
    const data = await database.getData();
    const list = Array.isArray(data.userActions) ? data.userActions : [];
    const actions = list.filter(item => item && String(item.userId) === String(targetId));
    actions.sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime());
    sendJson(res, 200, { actions: actions.slice(0, limit) });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/chat/direct') {
    const reqId = newReqId();
    chatDbg(req, reqId, `BEGIN ${req.method} ${pathname}`);
    const me = await ensureAuthenticated(req, res, { requireCsrf: true });
    if (!me) {
      chatDbg(req, reqId, 'ME is null/unauthorized');
      return true;
    }
    chatDbg(req, reqId, 'ME', {
      id: me?.id,
      legacyId: me?.legacyId,
      name: me?.name,
      role: me?.role
    });
    const raw = await parseBody(req).catch(() => '');
    const payload = parseJsonBody(raw);
    if (!payload) {
      sendJson(res, 400, { error: 'Некорректные данные', requestId: reqId });
      chatDbg(req, reqId, 'DENY 400 INVALID_PAYLOAD');
      return true;
    }
    const peerId = trimToString(payload.peerId);
    chatDbg(req, reqId, 'DIRECT input', { peerId });
    const data = await database.getData();
    const meId = normalizeChatUserId(me.id, data);
    const peerIdCanonical = normalizeChatUserId(peerId, data);
    if (!peerIdCanonical || peerIdCanonical === meId) {
      sendJson(res, 400, { error: 'Некорректный пользователь', requestId: reqId });
      chatDbg(req, reqId, 'DENY 400 PEER_EQUALS_ME_OR_EMPTY', { peerIdCanonical, meId });
      return true;
    }
    if (peerIdCanonical === SYSTEM_USER_ID) {
      sendJson(res, 403, { error: 'Нельзя инициировать диалог с системой', requestId: reqId });
      chatDbg(req, reqId, 'DENY 403 PEER_IS_SYSTEM');
      return true;
    }

    const peerUser = getUserByIdOrLegacy(data, peerId);
    chatDbg(req, reqId, 'DIRECT peerUser', {
      found: !!peerUser,
      id: peerUser?.id,
      legacyId: peerUser?.legacyId,
      name: peerUser?.name
    });
    if (!peerUser) {
      sendJson(res, 404, { error: 'Пользователь не найден', requestId: reqId });
      chatDbg(req, reqId, 'DENY 404 PEER_NOT_FOUND');
      return true;
    }
    const directParticipantIds = sortParticipantIds(meId, String(peerUser.id));
    const existing = findDirectConversation(data, directParticipantIds);
    chatDbg(req, reqId, 'DIRECT participantIds', directParticipantIds);
    chatDbg(req, reqId, 'DIRECT existing', { found: !!existing, id: existing?.id });
    if (existing) {
      sendJson(res, 200, { conversationId: existing.id });
      chatDbg(req, reqId, 'OK');
      return true;
    }

    const conversation = {
      id: genId('cvt'),
      type: 'direct',
      participantIds: directParticipantIds,
      createdAt: new Date().toISOString(),
      lastMessageId: null,
      lastMessageAt: null,
      lastMessagePreview: null
    };
    await database.update(current => {
      const draft = normalizeData(current);
      if (!Array.isArray(draft.chatConversations)) draft.chatConversations = [];
      draft.chatConversations.push(conversation);
      normalizeChatConversationsParticipants(draft);
      return draft;
    });
    sendJson(res, 200, { conversationId: conversation.id });
    chatDbg(req, reqId, 'OK');
    return true;
  }

  if (req.method === 'GET' && pathname.startsWith('/api/chat/conversations/') && pathname.endsWith('/messages')) {
    const reqId = newReqId();
    chatDbg(req, reqId, `BEGIN ${req.method} ${pathname}`);
    const me = await ensureAuthenticated(req, res, { requireCsrf: false });
    if (!me) {
      chatDbg(req, reqId, 'ME is null/unauthorized');
      return true;
    }
    chatDbg(req, reqId, 'ME', {
      id: me?.id,
      legacyId: me?.legacyId,
      name: me?.name,
      role: me?.role
    });
    const conversationId = decodeURIComponent(pathname.replace('/api/chat/conversations/', '').replace('/messages', ''));
    const peerUserIdRaw = parsed.query.peerUserId || parsed.query.userId || parsed.query.peerId || parsed.query.to;
    if (!conversationId) {
      sendJson(res, 400, { error: 'Некорректный диалог', requestId: reqId });
      chatDbg(req, reqId, 'DENY 400 INVALID_CONVERSATION_ID');
      return true;
    }
    chatDbg(req, reqId, 'CONV input', { conversationId });
    const data = await database.getData();
    chatDbg(req, reqId, 'DB sizes', {
      chatConversations: (data.chatConversations || []).length,
      chatMessages: (data.chatMessages || []).length,
      chatStates: (data.chatStates || []).length
    });
    const meAliases = Array.from(getUserIdAliases(me));
    chatDbg(req, reqId, 'ME aliases', meAliases);
    const meNorm = normUserId(me.id);
    const peerNorm = normUserId(peerUserIdRaw);
    let conversation = (data.chatConversations || []).find(c => c && c.id === conversationId);
    if (peerNorm) {
      const directParticipantIds = sortParticipantIds(meNorm, peerNorm);
      const directConversation = findDirectConversation(data, directParticipantIds);
      if (!directConversation) {
        sendJson(res, 200, { messages: [], states: {}, hasMore: false });
        chatDbg(req, reqId, 'OK');
        return true;
      }
      conversation = directConversation;
    }
    chatDbg(req, reqId, 'CONV found', { found: !!conversation, id: conversation?.id });
    if (conversation) {
      chatDbg(req, reqId, 'CONV participants', conversation.participantIds);
    }
    const pids = Array.isArray(conversation?.participantIds)
      ? conversation.participantIds.map(normUserId)
      : [];
    if (!conversation || !pids.includes(meNorm)) {
      if (conversation) {
        const p = (conversation.participantIds || []).map(String);
        const hasMeId = p.includes(String(me.id));
        const hasMeLegacy = me.legacyId ? p.includes(String(me.legacyId)) : false;
        chatDbg(req, reqId, 'ACCESS CHECK DETAILS', {
          participants: p,
          hasMeId,
          hasMeLegacy,
          meId: me.id,
          meLegacyId: me.legacyId
        });
      }
      chatDbg(req, reqId, 'DENY 403 NO_ACCESS', {
        meId: me?.id,
        meLegacyId: me?.legacyId,
        conversationId: conversation?.id,
        participants: conversation?.participantIds
      });
      sendJson(res, 403, { error: 'Нет доступа', requestId: reqId });
      return true;
    }

    const limit = Math.max(1, Math.min(200, parseInt(parsed.query.limit, 10) || 50));
    const beforeSeq = parseInt(parsed.query.beforeSeq, 10);
    const effectiveConversationId = conversation?.id || conversationId;
    const allMessages = getConversationMessages(data, effectiveConversationId).sort((a, b) => (a.seq || 0) - (b.seq || 0));
    const filtered = Number.isFinite(beforeSeq)
      ? allMessages.filter(msg => (msg.seq || 0) < beforeSeq)
      : allMessages;
    const start = Math.max(0, filtered.length - limit);
    const messages = filtered.slice(start);
    const hasMore = filtered.length > limit;

    const states = {};
    (data.chatStates || []).forEach(state => {
      if (!state || state.conversationId !== effectiveConversationId) return;
      states[state.userId] = {
        lastDeliveredSeq: state.lastDeliveredSeq || 0,
        lastReadSeq: state.lastReadSeq || 0
      };
    });

    sendJson(res, 200, { messages, states, hasMore });
    chatDbg(req, reqId, 'OK');
    return true;
  }

  if (req.method === 'POST' && pathname.startsWith('/api/chat/conversations/') && pathname.endsWith('/messages')) {
    const reqId = newReqId();
    chatDbg(req, reqId, `BEGIN ${req.method} ${pathname}`);
    const me = await ensureAuthenticated(req, res, { requireCsrf: true });
    if (!me) {
      chatDbg(req, reqId, 'ME is null/unauthorized');
      return true;
    }
    chatDbg(req, reqId, 'ME', {
      id: me?.id,
      legacyId: me?.legacyId,
      name: me?.name,
      role: me?.role
    });
    const conversationId = decodeURIComponent(pathname.replace('/api/chat/conversations/', '').replace('/messages', ''));
    if (!conversationId) {
      sendJson(res, 400, { error: 'Некорректный диалог', requestId: reqId });
      chatDbg(req, reqId, 'DENY 400 INVALID_CONVERSATION_ID');
      return true;
    }
    chatDbg(req, reqId, 'CONV input', { conversationId });
    const raw = await parseBody(req).catch(() => '');
    const payload = parseJsonBody(raw);
    if (!payload) {
      sendJson(res, 400, { error: 'Некорректные данные', requestId: reqId });
      chatDbg(req, reqId, 'DENY 400 INVALID_PAYLOAD');
      return true;
    }
    const text = trimToString(payload.text);
    const clientMsgId = trimToString(payload.clientMsgId);
    if (!text) {
      sendJson(res, 400, { error: 'Текст обязателен', requestId: reqId });
      chatDbg(req, reqId, 'DENY 400 TEXT_REQUIRED');
      return true;
    }

    const data = await database.getData();
    chatDbg(req, reqId, 'DB sizes', {
      chatConversations: (data.chatConversations || []).length,
      chatMessages: (data.chatMessages || []).length,
      chatStates: (data.chatStates || []).length
    });
    const meAliases = Array.from(getUserIdAliases(me));
    chatDbg(req, reqId, 'ME aliases', meAliases);
    const meAliasSet = getUserIdAliasSet(me, data);
    const conversation = (data.chatConversations || []).find(c => c && c.id === conversationId);
    chatDbg(req, reqId, 'CONV found', { found: !!conversation, id: conversation?.id });
    if (conversation) {
      chatDbg(req, reqId, 'CONV participants', conversation.participantIds);
    }
    if (!conversation || !Array.isArray(conversation.participantIds) || !conversationHasParticipant(conversation, meAliasSet)) {
      if (conversation) {
        const p = (conversation.participantIds || []).map(String);
        const hasMeId = p.includes(String(me.id));
        const hasMeLegacy = me.legacyId ? p.includes(String(me.legacyId)) : false;
        chatDbg(req, reqId, 'ACCESS CHECK DETAILS', {
          participants: p,
          hasMeId,
          hasMeLegacy,
          meId: me.id,
          meLegacyId: me.legacyId
        });
      }
      chatDbg(req, reqId, 'DENY 403 NO_ACCESS', {
        meId: me?.id,
        meLegacyId: me?.legacyId,
        conversationId: conversation?.id,
        participants: conversation?.participantIds
      });
      sendJson(res, 403, { error: 'Нет доступа', requestId: reqId });
      return true;
    }
    chatDbg(req, reqId, 'SEND input', { textLen: (text || '').length, clientMsgId });
    const peerIdRaw = getConversationPeerIdByAliases(conversation, meAliasSet);
    const peerId = normalizeChatUserId(peerIdRaw, data);
    chatDbg(req, reqId, 'PEER calc', { peerIdComputed: peerId });
    if (peerId === SYSTEM_USER_ID) {
      sendJson(res, 403, { error: 'Нельзя отправлять сообщения системе', requestId: reqId });
      chatDbg(req, reqId, 'DENY 403 PEER_IS_SYSTEM');
      return true;
    }
    if (!clientMsgId) {
      sendJson(res, 400, { error: 'clientMsgId обязателен', requestId: reqId });
      chatDbg(req, reqId, 'DENY 400 CLIENT_MSG_ID_REQUIRED');
      return true;
    }

    const existing = (data.chatMessages || []).find(msg => msg && msg.conversationId === conversationId && msg.senderId === me.id && msg.clientMsgId === clientMsgId);
    if (existing) {
      sendJson(res, 200, { message: existing });
      chatDbg(req, reqId, 'OK');
      return true;
    }

    const convMessages = getConversationMessages(data, conversationId);
    const maxSeq = convMessages.reduce((max, msg) => Math.max(max, msg.seq || 0), 0);
    const message = {
      id: genId('cmsg'),
      conversationId,
      seq: maxSeq + 1,
      senderId: me.id,
      text,
      createdAt: new Date().toISOString(),
      clientMsgId
    };

    await database.update(current => {
      const draft = normalizeData(current);
      if (!Array.isArray(draft.chatMessages)) draft.chatMessages = [];
      draft.chatMessages.push(message);
      if (Array.isArray(draft.chatConversations)) {
        const idx = draft.chatConversations.findIndex(item => item && item.id === conversationId);
        if (idx >= 0) {
          draft.chatConversations[idx] = {
            ...draft.chatConversations[idx],
            lastMessageId: message.id,
            lastMessageAt: message.createdAt,
            lastMessagePreview: message.text.slice(0, 120)
          };
        }
      }
      normalizeChatConversationsParticipants(draft);
      return draft;
    });

    sendJson(res, 200, { message });

    if (peerId) {
      msgSseSendToUser(peerId, 'message_new', { conversationId, message });
      msgSseSendToUser(me.id, 'message_new', { conversationId, message });
      const senderName = trimToString(me?.name || me?.username || 'Пользователь') || 'Пользователь';
      const bodyText = trimToString(message.text || '').slice(0, 120);
      sendWebPushToUser(peerId, {
        type: 'chat',
        title: `Сообщение от ${senderName}`,
        body: bodyText,
        url: `/profile/${encodeURIComponent(peerId)}?openChatWith=${encodeURIComponent(me.id)}&conversationId=${encodeURIComponent(conversationId)}`,
        conversationId,
        peerId: me.id
      });
      sendFcmToUser(peerId, {
        type: 'chat',
        title: `Сообщение от ${senderName}`,
        body: bodyText,
        conversationId,
        peerId: me.id,
        userName: senderName
      });
    }
    chatDbg(req, reqId, 'OK');
    return true;
  }

  if (req.method === 'POST' && pathname.startsWith('/api/chat/conversations/') && pathname.endsWith('/delivered')) {
    const reqId = newReqId();
    chatDbg(req, reqId, `BEGIN ${req.method} ${pathname}`);
    const me = await ensureAuthenticated(req, res, { requireCsrf: true });
    if (!me) {
      chatDbg(req, reqId, 'ME is null/unauthorized');
      return true;
    }
    chatDbg(req, reqId, 'ME', {
      id: me?.id,
      legacyId: me?.legacyId,
      name: me?.name,
      role: me?.role
    });
    const conversationId = decodeURIComponent(pathname.replace('/api/chat/conversations/', '').replace('/delivered', ''));
    if (!conversationId) {
      sendJson(res, 400, { error: 'Некорректный диалог', requestId: reqId });
      chatDbg(req, reqId, 'DENY 400 INVALID_CONVERSATION_ID');
      return true;
    }
    chatDbg(req, reqId, 'CONV input', { conversationId });
    const raw = await parseBody(req).catch(() => '');
    const payload = parseJsonBody(raw) || {};
    const data = await database.getData();
    chatDbg(req, reqId, 'DB sizes', {
      chatConversations: (data.chatConversations || []).length,
      chatMessages: (data.chatMessages || []).length,
      chatStates: (data.chatStates || []).length
    });
    const meAliases = Array.from(getUserIdAliases(me));
    chatDbg(req, reqId, 'ME aliases', meAliases);
    const meAliasSet = getUserIdAliasSet(me, data);
    const conversation = (data.chatConversations || []).find(c => c && c.id === conversationId);
    chatDbg(req, reqId, 'CONV found', { found: !!conversation, id: conversation?.id });
    if (conversation) {
      chatDbg(req, reqId, 'CONV participants', conversation.participantIds);
    }
    if (!conversation || !Array.isArray(conversation.participantIds) || !conversationHasParticipant(conversation, meAliasSet)) {
      if (conversation) {
        const p = (conversation.participantIds || []).map(String);
        const hasMeId = p.includes(String(me.id));
        const hasMeLegacy = me.legacyId ? p.includes(String(me.legacyId)) : false;
        chatDbg(req, reqId, 'ACCESS CHECK DETAILS', {
          participants: p,
          hasMeId,
          hasMeLegacy,
          meId: me.id,
          meLegacyId: me.legacyId
        });
      }
      chatDbg(req, reqId, 'DENY 403 NO_ACCESS', {
        meId: me?.id,
        meLegacyId: me?.legacyId,
        conversationId: conversation?.id,
        participants: conversation?.participantIds
      });
      sendJson(res, 403, { error: 'Нет доступа', requestId: reqId });
      return true;
    }
    const convMessages = getConversationMessages(data, conversationId);
    const maxSeq = convMessages.reduce((max, msg) => Math.max(max, msg.seq || 0), 0);
    const incomingSeq = Number.isFinite(payload.lastDeliveredSeq) ? payload.lastDeliveredSeq : Number(payload.lastDeliveredSeq || 0);
    const nextSeq = Math.min(maxSeq, incomingSeq || maxSeq);
    const updatedAt = new Date().toISOString();

    await database.update(current => {
      const draft = normalizeData(current);
      if (!Array.isArray(draft.chatStates)) draft.chatStates = [];
      const idx = draft.chatStates.findIndex(state => state.conversationId === conversationId && state.userId === me.id);
      if (idx >= 0) {
        const state = draft.chatStates[idx];
        const lastDeliveredSeq = Math.max(state.lastDeliveredSeq || 0, nextSeq);
        const lastReadSeq = Math.min(state.lastReadSeq || 0, lastDeliveredSeq);
        draft.chatStates[idx] = { ...state, lastDeliveredSeq, lastReadSeq, updatedAt };
      } else {
        draft.chatStates.push({
          conversationId,
          userId: me.id,
          lastDeliveredSeq: nextSeq,
          lastReadSeq: 0,
          updatedAt
        });
      }
      return draft;
    });

    const peerIdRaw = getConversationPeerIdByAliases(conversation, meAliasSet);
    const peerIdCanonical = normalizeChatUserId(peerIdRaw, data);
    const payloadObj = { conversationId, userId: me.id, lastDeliveredSeq: nextSeq };
    if (peerIdCanonical) msgSseSendToUser(peerIdCanonical, 'delivered_update', payloadObj);
    msgSseSendToUser(me.id, 'delivered_update', payloadObj);
    sendJson(res, 200, { ok: true });
    chatDbg(req, reqId, 'OK');
    return true;
  }

  if (req.method === 'POST' && pathname.startsWith('/api/chat/conversations/') && pathname.endsWith('/read')) {
    const reqId = newReqId();
    chatDbg(req, reqId, `BEGIN ${req.method} ${pathname}`);
    const me = await ensureAuthenticated(req, res, { requireCsrf: true });
    if (!me) {
      chatDbg(req, reqId, 'ME is null/unauthorized');
      return true;
    }
    chatDbg(req, reqId, 'ME', {
      id: me?.id,
      legacyId: me?.legacyId,
      name: me?.name,
      role: me?.role
    });
    const conversationId = decodeURIComponent(pathname.replace('/api/chat/conversations/', '').replace('/read', ''));
    if (!conversationId) {
      sendJson(res, 400, { error: 'Некорректный диалог', requestId: reqId });
      chatDbg(req, reqId, 'DENY 400 INVALID_CONVERSATION_ID');
      return true;
    }
    chatDbg(req, reqId, 'CONV input', { conversationId });
    const raw = await parseBody(req).catch(() => '');
    const payload = parseJsonBody(raw) || {};
    const data = await database.getData();
    chatDbg(req, reqId, 'DB sizes', {
      chatConversations: (data.chatConversations || []).length,
      chatMessages: (data.chatMessages || []).length,
      chatStates: (data.chatStates || []).length
    });
    const meAliases = Array.from(getUserIdAliases(me));
    chatDbg(req, reqId, 'ME aliases', meAliases);
    const meAliasSet = getUserIdAliasSet(me, data);
    const conversation = (data.chatConversations || []).find(c => c && c.id === conversationId);
    chatDbg(req, reqId, 'CONV found', { found: !!conversation, id: conversation?.id });
    if (conversation) {
      chatDbg(req, reqId, 'CONV participants', conversation.participantIds);
    }
    if (!conversation || !Array.isArray(conversation.participantIds) || !conversationHasParticipant(conversation, meAliasSet)) {
      if (conversation) {
        const p = (conversation.participantIds || []).map(String);
        const hasMeId = p.includes(String(me.id));
        const hasMeLegacy = me.legacyId ? p.includes(String(me.legacyId)) : false;
        chatDbg(req, reqId, 'ACCESS CHECK DETAILS', {
          participants: p,
          hasMeId,
          hasMeLegacy,
          meId: me.id,
          meLegacyId: me.legacyId
        });
      }
      chatDbg(req, reqId, 'DENY 403 NO_ACCESS', {
        meId: me?.id,
        meLegacyId: me?.legacyId,
        conversationId: conversation?.id,
        participants: conversation?.participantIds
      });
      sendJson(res, 403, { error: 'Нет доступа', requestId: reqId });
      return true;
    }
    const convMessages = getConversationMessages(data, conversationId);
    const maxSeq = convMessages.reduce((max, msg) => Math.max(max, msg.seq || 0), 0);
    const incomingSeq = Number.isFinite(payload.lastReadSeq) ? payload.lastReadSeq : Number(payload.lastReadSeq || 0);
    const nextSeq = Math.min(maxSeq, incomingSeq || maxSeq);
    const updatedAt = new Date().toISOString();

    await database.update(current => {
      const draft = normalizeData(current);
      if (!Array.isArray(draft.chatStates)) draft.chatStates = [];
      const idx = draft.chatStates.findIndex(state => state.conversationId === conversationId && state.userId === me.id);
      if (idx >= 0) {
        const state = draft.chatStates[idx];
        const lastReadSeq = Math.max(state.lastReadSeq || 0, nextSeq);
        const lastDeliveredSeq = Math.max(state.lastDeliveredSeq || 0, lastReadSeq);
        draft.chatStates[idx] = { ...state, lastDeliveredSeq, lastReadSeq, updatedAt };
      } else {
        draft.chatStates.push({
          conversationId,
          userId: me.id,
          lastDeliveredSeq: nextSeq,
          lastReadSeq: nextSeq,
          updatedAt
        });
      }
      return draft;
    });

    const peerIdRaw = getConversationPeerIdByAliases(conversation, meAliasSet);
    const peerIdCanonical = normalizeChatUserId(peerIdRaw, data);
    const payloadObj = { conversationId, userId: me.id, lastReadSeq: nextSeq };
    if (peerIdCanonical) msgSseSendToUser(peerIdCanonical, 'read_update', payloadObj);
    msgSseSendToUser(me.id, 'read_update', payloadObj);
    sendJson(res, 200, { ok: true });
    chatDbg(req, reqId, 'OK');
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/messages/stream') {
    const me = await ensureAuthenticated(req, res, { requireCsrf: false });
    if (!me) return true;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Surrogate-Control': 'no-store',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    msgSseAddClient(me.id, res);

    const data = await database.getData();
    const count = getUnreadCountForUser(me.id, data);
    msgSseWrite(res, 'unread_count', { count });

    req.on('close', () => {
      msgSseRemoveClient(me.id, res);
    });

    return true;
  }

  if (req.method === 'GET' && pathname.startsWith('/api/messages/dialog/')) {
    const me = await ensureAuthenticated(req, res, { requireCsrf: false });
    if (!me) return true;
    const peerId = decodeURIComponent(pathname.replace('/api/messages/dialog/', ''));
    if (!peerId) {
      sendJson(res, 400, { error: 'Некорректный диалог' });
      return true;
    }
    const data = await database.getData();
    const meAliases = getUserIdAliases(me);
    const peer = peerId === 'SYSTEM' ? null : getUserByIdOrLegacy(data, peerId);
    const peerAliases = new Set();
    if (peerId === 'SYSTEM') {
      peerAliases.add('SYSTEM');
    } else {
      peerAliases.add(peerId);
      if (peer?.id) peerAliases.add(peer.id);
      if (peer?.legacyId) peerAliases.add(peer.legacyId);
    }
    const messages = (data.messages || []).filter(m => {
      if (!m) return false;
      if (peerId === 'SYSTEM') {
        return m.fromUserId === 'SYSTEM' && meAliases.has(m.toUserId);
      }
      return (meAliases.has(m.fromUserId) && peerAliases.has(m.toUserId))
        || (peerAliases.has(m.fromUserId) && meAliases.has(m.toUserId));
    }).sort((a, b) => {
      const aKey = (a && a.createdAt) ? String(a.createdAt) : '';
      const bKey = (b && b.createdAt) ? String(b.createdAt) : '';
      return aKey.localeCompare(bKey);
    });
    sendJson(res, 200, { messages });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/messages/send') {
    const me = await ensureAuthenticated(req, res, { requireCsrf: true });
    if (!me) return true;
    const raw = await parseBody(req).catch(() => '');
    const payload = parseJsonBody(raw);
    if (!payload) {
      sendJson(res, 400, { error: 'Некорректные данные' });
      return true;
    }
    const toUserId = (payload.toUserId || '').toString().trim();
    const text = (payload.text || '').toString().trim();
    if (!toUserId || !text) {
      sendJson(res, 400, { error: 'Текст обязателен' });
      return true;
    }
    if (toUserId === 'SYSTEM') {
      sendJson(res, 400, { error: 'Нельзя отправлять сообщения системе' });
      return true;
    }
    const data = await database.getData();
    const message = {
      id: genId('msg'),
      fromUserId: me.id,
      toUserId,
      text,
      createdAt: new Date().toISOString(),
      readAt: ''
    };
    await database.update(current => {
      const draft = normalizeData(current);
      if (!Array.isArray(draft.messages)) draft.messages = [];
      draft.messages.push(message);
      return draft;
    });
    const name = resolveUserNameById(toUserId, data);
    sendJson(res, 200, { ok: true, message });

    const fresh = await database.getData();
    const count = getUnreadCountForUser(toUserId, fresh);
    msgSseSendToUser(toUserId, 'message', { message });
    msgSseSendToUser(toUserId, 'unread_count', { count });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/messages/mark-read') {
    const me = await ensureAuthenticated(req, res, { requireCsrf: true });
    if (!me) return true;
    const raw = await parseBody(req).catch(() => '');
    const payload = parseJsonBody(raw);
    if (!payload) {
      sendJson(res, 400, { error: 'Некорректные данные' });
      return true;
    }
    const peerId = (payload.peerId || '').toString().trim();
    if (!peerId) {
      sendJson(res, 400, { error: 'Некорректный диалог' });
      return true;
    }
    const data = await database.getData();
    const meAliases = getUserIdAliases(me);
    const peer = peerId === 'SYSTEM' ? null : getUserByIdOrLegacy(data, peerId);
    const peerAliases = new Set();
    if (peerId === 'SYSTEM') {
      peerAliases.add('SYSTEM');
    } else {
      peerAliases.add(peerId);
      if (peer?.id) peerAliases.add(peer.id);
      if (peer?.legacyId) peerAliases.add(peer.legacyId);
    }
    const now = new Date().toISOString();
    await database.update(current => {
      const draft = normalizeData(current);
      if (!Array.isArray(draft.messages)) draft.messages = [];
      draft.messages.forEach(m => {
        if (!m || !meAliases.has(m.toUserId) || m.readAt) return;
        if (peerId === 'SYSTEM') {
          if (m.fromUserId !== 'SYSTEM') return;
        } else if (!peerAliases.has(m.fromUserId)) {
          return;
        }
        m.readAt = now;
      });
      return draft;
    });
    const name = peerId === 'SYSTEM' ? 'Система' : resolveUserNameById(peerId, data);
    sendJson(res, 200, { ok: true });

    const fresh = await database.getData();
    const count = getUnreadCountForUser(me.id, fresh);
    msgSseSendToUser(me.id, 'unread_count', { count });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/barcode/svg') {
    const authedUser = await ensureAuthenticated(req, res);
    if (!authedUser) return true;
    const value = normalizeQrInput(parsed.query?.value || '');
    if (!value) {
      res.writeHead(200, {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      res.end('');
      return true;
    }
    const svg = await makeBarcodeSvg(value);
    res.writeHead(200, {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(svg);
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/events/stream') {
    if (!ensureAuthenticated(req, res)) return true;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Surrogate-Control': 'no-store',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    res.write(': ok\n\n');
    SSE_CLIENTS.add(res);

    req.on('close', () => {
      SSE_CLIENTS.delete(res);
    });

    return true;
  }

  if (req.method === 'GET' && pathname === '/api/cards-live') {
    const authedUser = await ensureAuthenticated(req, res);
    if (!authedUser) return true;
    const data = await database.getData();
    const cardsArr = Array.isArray(data.cards) ? data.cards : [];
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    let clientCardRevs = null;
    try {
      if (typeof parsed.query.cardRevs === 'string' && parsed.query.cardRevs.trim()) {
        clientCardRevs = JSON.parse(parsed.query.cardRevs);
      }
    } catch (_) {
      clientCardRevs = null;
    }

    // fallback: если клиент не прислал карту ревизий — отдаём всё (как раньше)
    if (!clientCardRevs || typeof clientCardRevs !== 'object') {
      const summaries = cardsArr.map(getCardLiveSummary);
      sendJson(res, 200, { changed: true, cards: summaries });
      return true;
    }

    const changed = [];
    for (const card of cardsArr) {
      const srvRev = Number.isFinite(card.rev) ? card.rev : 1;
      const cliRev = Number.isFinite(clientCardRevs[card.id]) ? clientCardRevs[card.id] : 0;
      if (srvRev > cliRev) changed.push(getCardLiveSummary(card));
    }

    sendJson(res, 200, { changed: changed.length > 0, cards: changed });
    return true;
  }

  if (!pathname.startsWith('/api/data')) return false;

  const authedUser = await ensureAuthenticated(req, res);
  if (!authedUser) return true;

  if (req.method === 'GET' && pathname.startsWith('/api/data')) {
    const data = await database.getData();
    const safe = { ...data, users: (data.users || []).map(u => sanitizeUser(u, getAccessLevelForUser(u, data.accessLevels || []))) };
    sendJson(res, 200, safe);
    return true;
  }

  if (req.method === 'POST' && pathname.startsWith('/api/data')) {
    try {
      const prev = await database.getData();
      const raw = await parseBody(req);
      const parsed = JSON.parse(raw || '{}');
      const saved = await database.update(current => {
        const basePayload = { ...current, ...parsed };
        const normalized = normalizeData(basePayload);
        normalized.users = mergeUsersForDataUpdate(current.users || [], parsed.users || []);
        normalized.accessLevels = current.accessLevels || [];
        return mergeSnapshots(current, normalized);
      });
      const actions = collectBusinessUserActions(prev, saved, authedUser);
      if (actions.length) {
        await database.update(current => {
          const draft = normalizeData(current);
          if (!Array.isArray(draft.userActions)) draft.userActions = [];
          actions.forEach(entry => {
            if (!entry || !entry.userId || !entry.text) return;
            draft.userActions.push({ id: genId('act'), userId: entry.userId, at: entry.at || new Date().toISOString(), text: entry.text });
          });
          return draft;
        });
      }
      const notifications = collectStatusChangeNotifications(prev, saved);
      if (notifications.length) {
        const delivered = [];
        await database.update(current => {
          const draft = normalizeData(current);
          notifications.forEach(note => {
            const surname = note?.card?.issuedBySurname || '';
            const author = resolveUserByIssuedSurname(draft, surname);
            if (!author?.id) return;
            const text = buildStatusChangeMessage(note);
            const created = appendSystemMessage(draft, author.id, text);
            if (created) delivered.push({ userId: author.id, ...created });
          });
          normalizeChatConversationsParticipants(draft);
          return draft;
        });
        delivered.forEach(item => {
          if (!item?.userId || !item?.conversationId || !item?.message) return;
          msgSseSendToUser(item.userId, 'message_new', { conversationId: item.conversationId, message: item.message });
          const bodyText = trimToString(item.message.text || '').slice(0, 120);
          sendWebPushToUser(item.userId, {
            type: 'chat',
            title: 'Сообщение от Системы',
            body: bodyText,
            url: `/profile/${encodeURIComponent(item.userId)}`,
            conversationId: item.conversationId,
            peerId: 'system'
          });
          sendFcmToUser(item.userId, {
            type: 'chat',
            title: 'Сообщение от Системы',
            body: bodyText,
            conversationId: item.conversationId,
            peerId: 'system',
            userName: 'Система'
          });
        });
      }
      broadcastCardsChanged(saved);
      const prevSet = new Set((prev.cards || []).map(c => normalizeQrIdServer(c.qrId || '')).filter(isValidQrIdServer));
      const nextSet = new Set((saved.cards || []).map(c => normalizeQrIdServer(c.qrId || '')).filter(isValidQrIdServer));
      for (const qr of nextSet) {
        ensureCardStorageFoldersByQr(qr);
      }
      for (const qr of prevSet) {
        if (!nextSet.has(qr)) removeCardStorageFoldersByQr(qr);
      }
      sendJson(res, 200, { status: 'ok', data: saved });
    } catch (err) {
      const status = err.message === 'Payload too large' ? 413 : 400;
      sendJson(res, status, { error: err.message || 'Invalid JSON' });
    }
    return true;
  }

  return false;
}

function findAttachment(data, attachmentId) {
  for (const card of data.cards || []) {
    const found = (card.attachments || []).find(f => f.id === attachmentId);
    if (found) {
      return { card, attachment: found };
    }
  }
  return null;
}

function findCardByKey(data, key) {
  if (!key) return null;
  const direct = (data.cards || []).find(c => c.id === key);
  if (direct) return direct;
  const normalizedKey = normalizeQrIdServer(key);
  if (!isValidQrIdServer(normalizedKey)) return null;
  return (data.cards || []).find(c => normalizeQrIdServer(c.qrId || '') === normalizedKey) || null;
}

async function handleFileRoutes(req, res) {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || '';
  const isFileDownload = req.method === 'GET' && pathname.startsWith('/files/');
  const segments = pathname.split('/').filter(Boolean);
  const isCardFiles = segments[0] === 'api' && segments[1] === 'cards' && segments[3] === 'files';
  if (!isFileDownload && !isCardFiles) return false;

  const authedUser = await ensureAuthenticated(req, res);
  if (!authedUser) return true;
  if (req.method === 'GET' && pathname.startsWith('/files/')) {
    if (segments.length !== 2) {
      res.writeHead(404);
      res.end('Not found');
      return true;
    }
    const attachmentId = segments[1];
    const data = await database.getData();
    const match = findAttachment(data, attachmentId);
    if (!match) {
      res.writeHead(404);
      res.end('Not found');
      return true;
    }
    const { attachment } = match;
    if (!isSafeRelPath(attachment.relPath)) {
      res.writeHead(400);
      res.end('Invalid file path');
      return true;
    }
    if (!attachment.relPath) {
      res.writeHead(404);
      res.end('File missing');
      return true;
    }
    const qr = normalizeQrIdServer(match.card.qrId || '');
    if (!isValidQrIdServer(qr)) {
      res.writeHead(404);
      res.end('File missing');
      return true;
    }
    const absPath = path.join(CARDS_STORAGE_DIR, qr, attachment.relPath);
    const resolvedPath = resolveFilePathWithHashedUnicode(absPath);
    if (!resolvedPath) {
      res.writeHead(404);
      res.end('File missing');
      return true;
    }
    let stat;
    try {
      stat = fs.statSync(resolvedPath);
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('File missing');
        return true;
      }
      res.writeHead(500);
      res.end('File read error');
      return true;
    }
    const originalName = attachment.originalName || attachment.name || attachment.storedName || 'file';
    const downloadName = sanitizeFilename(originalName);
    const mime = attachment.mime || attachment.type || guessMimeByExt(downloadName) || 'application/octet-stream';
    const isDownload = parsed.query && parsed.query.download === '1';
    const disposition = buildContentDisposition(originalName, isDownload);
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': stat.size,
      'Content-Disposition': disposition
    });
    fs.createReadStream(resolvedPath).pipe(res);
    return true;
  }

  if (req.method === 'GET' && segments[0] === 'api' && segments[1] === 'cards' && segments[3] === 'files' && segments.length === 4) {
    const cardId = segments[2];
    const data = await database.getData();
    const card = findCardByKey(data, cardId);
    if (!card) {
      sendJson(res, 404, { error: 'Card not found' });
      return true;
    }
    if (!card.qrId) {
      sendJson(res, 400, { error: 'Card QR missing' });
      return true;
    }
    const debugEnabled = parsed.query && parsed.query.debug === '1';
    let debugInfo;
    if (debugEnabled) {
      const qrNormalized = normalizeQrIdServer(card.qrId || '');
      const dirs = ['general', 'input-control', 'skk'].map(folder => {
        const absDir = path.join(CARDS_STORAGE_DIR, qrNormalized, folder);
        let exists = false;
        let files = [];
        try {
          exists = fs.existsSync(absDir);
          if (exists) {
            const entries = fs.readdirSync(absDir, { withFileTypes: true });
            files = entries.filter(entry => entry && entry.isFile()).map(entry => entry.name).slice(0, 50);
          }
        } catch (err) {
          exists = false;
          files = [];
        }
        return {
          folder,
          absDir,
          exists,
          files,
          count: files.length
        };
      });
      debugInfo = {
        storageDir: STORAGE_DIR,
        cardsStorageDir: CARDS_STORAGE_DIR,
        cardIdRequested: cardId,
        cardIdResolved: card.id,
        qrIdRaw: card.qrId,
        qrNormalized,
        isQrValid: isValidQrIdServer(qrNormalized),
        dirs
      };
    }
    sendJson(res, 200, {
      files: card.attachments || [],
      inputControlFileId: card.inputControlFileId || null,
      ...(debugEnabled ? { debug: debugInfo } : {})
    });
    return true;
  }

  if (req.method === 'POST' && segments[0] === 'api' && segments[1] === 'cards' && segments[3] === 'files' && segments[4] === 'resync' && segments.length === 5) {
    const cardId = segments[2];
    const data = await database.getData();
    const card = findCardByKey(data, cardId);
    if (!card) {
      sendJson(res, 404, { error: 'Card not found' });
      return true;
    }
    const sync = syncCardAttachmentsFromDisk(card);
    if (sync.changed) {
      await database.update(d => {
        const cards = d.cards || [];
        const idx = cards.findIndex(c => c.id === card.id);
        if (idx >= 0) cards[idx] = card;
        d.cards = cards;
        return d;
      });
      const saved = await database.getData();
      broadcastCardsChanged(saved);
    }
    sendJson(res, 200, { files: sync.files, inputControlFileId: sync.inputControlFileId, changed: sync.changed });
    return true;
  }

  if (req.method === 'POST' && segments[0] === 'api' && segments[1] === 'cards' && segments[3] === 'files' && segments.length === 4) {
    const cardId = segments[2];
    try {
      const raw = await parseBody(req);
      const payload = JSON.parse(raw || '{}');
      const { name, type, content, size, category, scope, scopeId } = payload || {};
      const data = await database.getData();
      const card = findCardByKey(data, cardId);
      if (!card) {
        sendJson(res, 404, { error: 'Card not found' });
        return true;
      }
      const qr = normalizeQrIdServer(card.qrId || '');
      if (!isValidQrIdServer(qr)) {
        sendJson(res, 400, { error: 'Invalid card QR' });
        return true;
      }
      if (!name || !content || typeof content !== 'string' || !content.startsWith('data:')) {
        sendJson(res, 400, { error: 'Invalid payload' });
        return true;
      }
      const safeName = normalizeDoubleExtension(String(name || 'file').trim());
      const ext = path.extname(safeName || '').toLowerCase();
      if (ALLOWED_EXTENSIONS.length && ext && !ALLOWED_EXTENSIONS.includes(ext)) {
        sendJson(res, 400, { error: 'Недопустимый тип файла' });
        return true;
      }
      const buffer = decodeDataUrlToBuffer(content);
      if (!buffer) {
        sendJson(res, 400, { error: 'Invalid file content' });
        return true;
      }
      if (Number(size) > FILE_SIZE_LIMIT || buffer.length > FILE_SIZE_LIMIT) {
        sendJson(res, 400, { error: 'Файл слишком большой' });
        return true;
      }

      ensureCardStorageFoldersByQr(qr);
      const storedName = makeStoredName(safeName);
      const folder = categoryToFolder(category);
      const relPath = `${folder}/${storedName}`;
      const absPath = path.join(CARDS_STORAGE_DIR, qr, relPath);
      fs.writeFileSync(absPath, buffer);
      const fileMeta = {
        id: genId('file'),
        name: safeName,
        originalName: safeName,
        storedName,
        relPath,
        type: type || 'application/octet-stream',
        mime: type || 'application/octet-stream',
        size: Number(size) || buffer.length,
        createdAt: Date.now(),
        category: String(category || 'GENERAL').toUpperCase(),
        scope: String(scope || 'CARD').toUpperCase(),
        scopeId: scopeId || null
      };
      card.attachments = Array.isArray(card.attachments) ? card.attachments : [];
      if (fileMeta.category === 'INPUT_CONTROL') {
        card.inputControlFileId = fileMeta.id;
      }
      card.attachments.push(fileMeta);
      const saved = await database.update(d => {
        const cards = d.cards || [];
        const idx = cards.findIndex(c => c.id === card.id);
        if (idx >= 0) cards[idx] = card;
        d.cards = cards;
        return d;
      });
      broadcastCardsChanged(saved);
      sendJson(res, 200, { status: 'ok', file: fileMeta, files: card.attachments, inputControlFileId: card.inputControlFileId || '' });
    } catch (err) {
      const status = err.message === 'Payload too large' ? 413 : 400;
      sendJson(res, status, { error: err.message || 'Upload error' });
    }
    return true;
  }

  if (req.method === 'GET' && segments[0] === 'api' && segments[1] === 'cards' && segments[3] === 'files' && segments.length === 5) {
    const cardId = segments[2];
    const fileId = segments[4];
    const data = await database.getData();
    const card = findCardByKey(data, cardId);
    if (!card) {
      sendJson(res, 404, { error: 'Card not found' });
      return true;
    }
    const attachment = (card.attachments || []).find(item => item && item.id === fileId);
    if (!attachment) {
      sendJson(res, 404, { error: 'File not found' });
      return true;
    }
    if (!isSafeRelPath(attachment.relPath)) {
      sendJson(res, 400, { error: 'Invalid file path' });
      return true;
    }
    const qr = normalizeQrIdServer(card.qrId || '');
    if (!isValidQrIdServer(qr)) {
      sendJson(res, 404, { error: 'File missing' });
      return true;
    }
    const absPath = path.join(CARDS_STORAGE_DIR, qr, attachment.relPath);
    const resolvedPath = resolveFilePathWithHashedUnicode(absPath);
    if (!resolvedPath) {
      sendJson(res, 404, { error: 'File missing' });
      return true;
    }
    let stat;
    try {
      stat = fs.statSync(resolvedPath);
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        sendJson(res, 404, { error: 'File missing' });
        return true;
      }
      sendJson(res, 500, { error: 'File read error' });
      return true;
    }
    const originalName = attachment.originalName || attachment.name || attachment.storedName || 'file';
    const downloadName = sanitizeFilename(originalName);
    const mime = attachment.mime || attachment.type || guessMimeByExt(downloadName) || 'application/octet-stream';
    const isDownload = parsed.query && parsed.query.download === '1';
    const disposition = buildContentDisposition(originalName, isDownload);
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': stat.size,
      'Content-Disposition': disposition
    });
    fs.createReadStream(resolvedPath).pipe(res);
    return true;
  }

  if (req.method === 'DELETE' && segments[0] === 'api' && segments[1] === 'cards' && segments[3] === 'files' && segments.length === 5) {
    const cardId = segments[2];
    const fileId = segments[4];
    try {
      const saved = await database.update(data => {
        const draft = normalizeData(data);
        const card = findCardByKey(draft, cardId);
        if (!card) {
          throw new Error('Card not found');
        }
        const idx = (card.attachments || []).findIndex(item => item.id === fileId);
        if (idx < 0) {
          throw new Error('File not found');
        }
        const attachment = card.attachments[idx];
        if (attachment && attachment.relPath) {
          const qr = normalizeQrIdServer(card.qrId || '');
          if (isValidQrIdServer(qr)) {
            const absPath = path.join(CARDS_STORAGE_DIR, qr, attachment.relPath);
            fs.rmSync(absPath, { force: true });
          }
        }
        card.attachments.splice(idx, 1);
        if (card.inputControlFileId === fileId) {
          const remainingIc = (card.attachments || [])
            .filter(item => item && String(item.category || '').toUpperCase() === 'INPUT_CONTROL');
          remainingIc.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
          card.inputControlFileId = remainingIc[0] ? remainingIc[0].id : '';
        }
        return draft;
      });
      broadcastCardsChanged(saved);
      const card = findCardByKey(saved, cardId);
      sendJson(res, 200, { status: 'ok', files: card ? card.attachments || [] : [], inputControlFileId: card ? card.inputControlFileId || '' : '' });
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'Delete error' });
    }
    return true;
  }

  return false;
}

async function requestHandler(req, res) {
  if (await handleAuth(req, res)) return;
  if (await handlePrintRoutes(req, res)) return;
  if (await handleApi(req, res)) return;
  if (await handleFileRoutes(req, res)) return;
  const parsed = url.parse(req.url);
  const rawPath = parsed.pathname || '';
  const normalizedPath = rawPath === '/' ? '/' : rawPath.replace(/\/+$/, '') || '/';
  if (normalizedPath === '/cards-mki/new') {
    const query = parsed.search || '';
    res.writeHead(301, { Location: `/cards/new${query}` });
    res.end();
    return;
  }
  if (normalizedPath === '/cards/new') {
    const query = parsed.query || {};
    const cardId = (query.cardId || '').toString().trim();
    if (cardId) {
      res.writeHead(301, { Location: `/cards/${encodeURIComponent(cardId)}` });
      res.end();
      return;
    }
  }
  if (normalizedPath === '/user' || normalizedPath.startsWith('/user/')) {
    res.statusCode = 404;
    res.end('Not Found');
    return;
  }
  if (normalizedPath.startsWith('/users/')) {
    res.statusCode = 404;
    res.end('Not Found');
    return;
  }
  const isFileRequest = path.posix.basename(normalizedPath).includes('.');
  if (isFileRequest) {
    serveStatic(req, res);
    return;
  }
  if (
    SPA_ROUTES.has(normalizedPath) ||
    normalizedPath.startsWith('/workorders/') ||
    normalizedPath.startsWith('/archive/') ||
    normalizedPath.startsWith('/cards/') ||
    normalizedPath === '/profile' ||
    normalizedPath.startsWith('/profile/')
  ) {
    const indexPath = path.join(PUBLIC_DIR, 'index.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(indexPath).pipe(res);
    return;
  }
  serveStatic(req, res);
}

async function startServer() {
  await database.init(buildDefaultData);
  await migrateUsersToStringIds();
  await database.update(data => normalizeData(data));
  await migrateBarcodesToCode128();
  await migrateRouteCardNumbers();
  await ensureDefaultUser();
  const fresh = await database.getData();
  if (!Array.isArray(fresh.messages) || !Array.isArray(fresh.userVisits) || !Array.isArray(fresh.userActions) || !Array.isArray(fresh.webPushSubscriptions) || !Array.isArray(fresh.fcmTokens)) {
    await database.update(current => {
      const draft = normalizeData(current);
      if (!Array.isArray(draft.messages)) draft.messages = [];
      if (!Array.isArray(draft.userVisits)) draft.userVisits = [];
      if (!Array.isArray(draft.userActions)) draft.userActions = [];
      if (!Array.isArray(draft.webPushSubscriptions)) draft.webPushSubscriptions = [];
      if (!Array.isArray(draft.fcmTokens)) draft.fcmTokens = [];
      return draft;
    });
  }
  ensureDirSync(STORAGE_DIR);
  ensureDirSync(CARDS_STORAGE_DIR);
  const server = http.createServer((req, res) => {
    requestHandler(req, res).catch(err => {
      // eslint-disable-next-line no-console
      console.error('Request error', err);
      res.writeHead(500);
      res.end('Server error');
    });
  });

  server.listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`Server started on http://${HOST}:${PORT}`);
  });
}

startServer().catch(err => {
  // eslint-disable-next-line no-console
  console.error('Failed to start server:', err);
  process.exit(1);
});
