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

const APP_VERSION_PATH = path.join(__dirname, 'app-version.json');
const APP_VERSION_PLACEHOLDER = '__APP_VERSION_FOOTER__';

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

function buildCardLiveEventEnvelope(action, cardOrId, extras = {}) {
  const card = cardOrId && typeof cardOrId === 'object' ? cardOrId : null;
  const id = card ? trimToString(card.id) : trimToString(cardOrId);
  if (!id) return null;
  const rev = Number.isFinite(card?.rev) ? card.rev : null;
  const envelope = {
    entity: 'card',
    action,
    id,
    scope: DATA_SCOPE_CARDS_BASIC,
    rev
  };
  if (card) {
    envelope.card = deepClone(card);
    envelope.summary = getCardLiveSummary(card);
  }
  Object.keys(extras || {}).forEach(key => {
    if (extras[key] !== undefined) envelope[key] = extras[key];
  });
  return envelope;
}

function broadcastCardEvent(action, cardOrId, extras = {}) {
  const envelope = buildCardLiveEventEnvelope(action, cardOrId, extras);
  if (!envelope) return;
  sseBroadcast(`card.${action}`, envelope);
}

function broadcastCardMutationEvents(prev, saved) {
  const prevCards = Array.isArray(prev?.cards) ? prev.cards : [];
  const nextCards = Array.isArray(saved?.cards) ? saved.cards : [];
  const prevMap = new Map(prevCards.map(card => [trimToString(card?.id), card]).filter(entry => entry[0]));
  const nextMap = new Map(nextCards.map(card => [trimToString(card?.id), card]).filter(entry => entry[0]));

  nextMap.forEach((card, id) => {
    const previous = prevMap.get(id);
    if (!previous) {
      broadcastCardEvent('created', card);
      return;
    }
    const prevJson = JSON.stringify(previous);
    const nextJson = JSON.stringify(card);
    if (prevJson !== nextJson) {
      broadcastCardEvent('updated', card);
      const prevFilesJson = JSON.stringify(previous.attachments || []);
      const nextFilesJson = JSON.stringify(card.attachments || []);
      if (prevFilesJson !== nextFilesJson || trimToString(previous.inputControlFileId) !== trimToString(card.inputControlFileId)) {
        broadcastCardEvent('files-updated', card, {
          filesCount: Array.isArray(card.attachments) ? card.attachments.length : 0,
          inputControlFileId: trimToString(card.inputControlFileId)
        });
      }
    }
  });

  prevMap.forEach((card, id) => {
    if (!nextMap.has(id)) {
      broadcastCardEvent('deleted', id, { deleted: true });
    }
  });
}

function buildOperationLiveEventEnvelope(action, operationOrId) {
  const operation = operationOrId && typeof operationOrId === 'object' ? operationOrId : null;
  const id = operation ? trimToString(operation.id) : trimToString(operationOrId);
  if (!id) return null;
  return {
    entity: 'directory.operation',
    action,
    id,
    operation: operation ? deepClone(operation) : null
  };
}

function broadcastOperationEvent(action, operationOrId) {
  const envelope = buildOperationLiveEventEnvelope(action, operationOrId);
  if (!envelope) return;
  sseBroadcast(`directory.operation.${action}`, envelope);
}

function broadcastOperationMutationEvents(prev, saved) {
  const prevOps = Array.isArray(prev?.ops) ? prev.ops : [];
  const nextOps = Array.isArray(saved?.ops) ? saved.ops : [];
  const prevMap = new Map(prevOps.map(op => [trimToString(op?.id), op]).filter(entry => entry[0]));
  const nextMap = new Map(nextOps.map(op => [trimToString(op?.id), op]).filter(entry => entry[0]));

  nextMap.forEach((operation, id) => {
    const previous = prevMap.get(id);
    if (!previous) {
      broadcastOperationEvent('created', operation);
      return;
    }
    if (JSON.stringify(previous) !== JSON.stringify(operation)) {
      broadcastOperationEvent('updated', operation);
    }
  });

  prevMap.forEach((operation, id) => {
    if (!nextMap.has(id)) {
      broadcastOperationEvent('deleted', id);
    }
  });
}

function buildAreaLiveEventEnvelope(action, areaOrId) {
  const area = areaOrId && typeof areaOrId === 'object' ? areaOrId : null;
  const id = area ? trimToString(area.id) : trimToString(areaOrId);
  if (!id) return null;
  return {
    entity: 'directory.area',
    action,
    id,
    area: area ? deepClone(area) : null
  };
}

function broadcastAreaEvent(action, areaOrId) {
  const envelope = buildAreaLiveEventEnvelope(action, areaOrId);
  if (!envelope) return;
  sseBroadcast(`directory.area.${action}`, envelope);
}

function broadcastAreaMutationEvents(prev, saved) {
  const prevAreas = Array.isArray(prev?.areas) ? prev.areas : [];
  const nextAreas = Array.isArray(saved?.areas) ? saved.areas : [];
  const prevMap = new Map(prevAreas.map(area => [trimToString(area?.id), area]).filter(entry => entry[0]));
  const nextMap = new Map(nextAreas.map(area => [trimToString(area?.id), area]).filter(entry => entry[0]));

  nextMap.forEach((area, id) => {
    const previous = prevMap.get(id);
    if (!previous) {
      broadcastAreaEvent('created', area);
      return;
    }
    if (JSON.stringify(previous) !== JSON.stringify(area)) {
      broadcastAreaEvent('updated', area);
    }
  });

  prevMap.forEach((area, id) => {
    if (!nextMap.has(id)) {
      broadcastAreaEvent('deleted', id);
    }
  });
}

function buildDepartmentLiveEventEnvelope(action, departmentOrId) {
  const department = departmentOrId && typeof departmentOrId === 'object' ? departmentOrId : null;
  const id = department ? trimToString(department.id) : trimToString(departmentOrId);
  if (!id) return null;
  return {
    entity: 'directory.department',
    action,
    id,
    department: department ? deepClone(department) : null
  };
}

function broadcastDepartmentEvent(action, departmentOrId) {
  const envelope = buildDepartmentLiveEventEnvelope(action, departmentOrId);
  if (!envelope) return;
  sseBroadcast(`directory.department.${action}`, envelope);
}

function broadcastDepartmentMutationEvents(prev, saved) {
  const prevDepartments = Array.isArray(prev?.centers) ? prev.centers : [];
  const nextDepartments = Array.isArray(saved?.centers) ? saved.centers : [];
  const prevMap = new Map(prevDepartments.map(center => [trimToString(center?.id), center]).filter(entry => entry[0]));
  const nextMap = new Map(nextDepartments.map(center => [trimToString(center?.id), center]).filter(entry => entry[0]));

  nextMap.forEach((department, id) => {
    const previous = prevMap.get(id);
    if (!previous) {
      broadcastDepartmentEvent('created', department);
      return;
    }
    if (JSON.stringify(previous) !== JSON.stringify(department)) {
      broadcastDepartmentEvent('updated', department);
    }
  });

  prevMap.forEach((department, id) => {
    if (!nextMap.has(id)) {
      broadcastDepartmentEvent('deleted', id);
    }
  });
}

function buildShiftTimeLiveEventEnvelope(action, shiftTimeOrId) {
  const shiftTime = shiftTimeOrId && typeof shiftTimeOrId === 'object' ? shiftTimeOrId : null;
  const id = shiftTime ? trimToString(shiftTime.shift) : trimToString(shiftTimeOrId);
  if (!id) return null;
  return {
    entity: 'directory.shift-time',
    action,
    id,
    shiftTime: shiftTime ? deepClone(shiftTime) : null
  };
}

function broadcastShiftTimeEvent(action, shiftTimeOrId) {
  const envelope = buildShiftTimeLiveEventEnvelope(action, shiftTimeOrId);
  if (!envelope) return;
  sseBroadcast(`directory.shift-time.${action}`, envelope);
}

function broadcastShiftTimeMutationEvents(prev, saved) {
  const prevShiftTimes = Array.isArray(prev?.productionShiftTimes) ? prev.productionShiftTimes : [];
  const nextShiftTimes = Array.isArray(saved?.productionShiftTimes) ? saved.productionShiftTimes : [];
  const prevMap = new Map(prevShiftTimes.map(item => [trimToString(item?.shift), item]).filter(entry => entry[0]));
  const nextMap = new Map(nextShiftTimes.map(item => [trimToString(item?.shift), item]).filter(entry => entry[0]));

  nextMap.forEach((shiftTime, id) => {
    const previous = prevMap.get(id);
    if (!previous) {
      broadcastShiftTimeEvent('created', shiftTime);
      return;
    }
    if (JSON.stringify(previous) !== JSON.stringify(shiftTime)) {
      broadcastShiftTimeEvent('updated', shiftTime);
    }
  });

  prevMap.forEach((shiftTime, id) => {
    if (!nextMap.has(id)) {
      broadcastShiftTimeEvent('deleted', id);
    }
  });
}

function buildUserLiveEventEnvelope(action, userOrId, accessLevels = []) {
  const user = userOrId && typeof userOrId === 'object' ? userOrId : null;
  const id = user ? trimToString(user.id) : trimToString(userOrId);
  if (!id) return null;
  return {
    entity: 'security.user',
    action,
    id,
    user: user ? sanitizeUser(user, getAccessLevelForUser(user, accessLevels || [])) : null
  };
}

function broadcastUserEvent(action, userOrId, accessLevels = []) {
  const envelope = buildUserLiveEventEnvelope(action, userOrId, accessLevels);
  if (!envelope) return;
  sseBroadcast(`security.user.${action}`, envelope);
}

function broadcastUserMutationEvents(prev, saved) {
  const prevUsers = Array.isArray(prev?.users) ? prev.users : [];
  const nextUsers = Array.isArray(saved?.users) ? saved.users : [];
  const accessLevels = Array.isArray(saved?.accessLevels) ? saved.accessLevels : [];
  const prevMap = new Map(prevUsers.map(user => [trimToString(user?.id), user]).filter(entry => entry[0]));
  const nextMap = new Map(nextUsers.map(user => [trimToString(user?.id), user]).filter(entry => entry[0]));

  nextMap.forEach((user, id) => {
    const previous = prevMap.get(id);
    if (!previous) {
      broadcastUserEvent('created', user, accessLevels);
      return;
    }
    if (JSON.stringify(previous) !== JSON.stringify(user)) {
      broadcastUserEvent('updated', user, accessLevels);
    }
  });

  prevMap.forEach((user, id) => {
    if (!nextMap.has(id)) {
      broadcastUserEvent('deleted', id, accessLevels);
    }
  });
}

function buildAccessLevelLiveEventEnvelope(action, accessLevelOrId) {
  const accessLevel = accessLevelOrId && typeof accessLevelOrId === 'object' ? accessLevelOrId : null;
  const id = accessLevel ? trimToString(accessLevel.id) : trimToString(accessLevelOrId);
  if (!id) return null;
  return {
    entity: 'security.access-level',
    action,
    id,
    accessLevel: accessLevel ? deepClone(accessLevel) : null
  };
}

function broadcastAccessLevelEvent(action, accessLevelOrId) {
  const envelope = buildAccessLevelLiveEventEnvelope(action, accessLevelOrId);
  if (!envelope) return;
  sseBroadcast(`security.access-level.${action}`, envelope);
}

function broadcastAccessLevelMutationEvents(prev, saved) {
  const prevLevels = Array.isArray(prev?.accessLevels) ? prev.accessLevels : [];
  const nextLevels = Array.isArray(saved?.accessLevels) ? saved.accessLevels : [];
  const prevMap = new Map(prevLevels.map(level => [trimToString(level?.id), level]).filter(entry => entry[0]));
  const nextMap = new Map(nextLevels.map(level => [trimToString(level?.id), level]).filter(entry => entry[0]));

  nextMap.forEach((accessLevel, id) => {
    const previous = prevMap.get(id);
    if (!previous) {
      broadcastAccessLevelEvent('created', accessLevel);
      return;
    }
    if (JSON.stringify(previous) !== JSON.stringify(accessLevel)) {
      broadcastAccessLevelEvent('updated', accessLevel);
    }
  });

  prevMap.forEach((accessLevel, id) => {
    if (!nextMap.has(id)) {
      broadcastAccessLevelEvent('deleted', id);
    }
  });
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

const PASSWORD_QR_PRINT_SETTINGS_DEFAULTS = {
  paperMode: 'A4',
  customWidthMm: 58,
  customHeightMm: 40,
  placement: 'CENTER',
  rotate90: false,
  showUsername: true,
  showPassword: true,
  qrSizeMm: 25,
  fontSizePt: 9
};

const ITEM_QR_PRINT_SETTINGS_DEFAULTS = {
  paperMode: 'A4',
  customWidthMm: 58,
  customHeightMm: 40,
  placement: 'CENTER',
  rotate90: false,
  showRouteCardNumber: true,
  showItemName: true,
  showItemSerial: true,
  qrSizeMm: 25,
  fontSizePt: 9
};

const CARD_QR_PRINT_SETTINGS_DEFAULTS = {
  paperMode: 'A4',
  customWidthMm: 58,
  customHeightMm: 40,
  placement: 'CENTER',
  rotate90: false,
  showRouteNumber: true,
  showItemName: true,
  qrSizeMm: 25,
  fontSizePt: 9
};

const DEFAULT_PERMISSIONS = {
  tabs: {
    dashboard: { view: true, edit: true },
    cards: { view: true, edit: true },
    approvals: { view: true, edit: true },
    provision: { view: true, edit: true },
    'input-control': { view: true, edit: true },
    production: { view: true, edit: true },
    'production-schedule': { view: true, edit: true },
    'production-plan': { view: true, edit: true },
    'production-shifts': { view: true, edit: true },
    'production-delayed': { view: true, edit: true },
    'production-defects': { view: true, edit: true },
    departments: { view: true, edit: true },
    operations: { view: true, edit: true },
    areas: { view: true, edit: true },
    employees: { view: true, edit: true },
    'shift-times': { view: true, edit: true },
    workorders: { view: true, edit: true },
    items: { view: true, edit: true },
    ok: { view: true, edit: true },
    oc: { view: true, edit: true },
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
  skkWorker: false,
  labWorker: false,
  warehouseWorker: false,
  deputyTechDirector: false
};
const PRODUCTION_GRANULAR_PERMISSION_KEYS = [
  'production-schedule',
  'production-plan',
  'production-shifts',
  'production-delayed',
  'production-defects'
];
const OPERATION_TYPE_OPTIONS = ['Стандартная', 'Идентификация', 'Документы', 'Получение материала', 'Возврат материала', 'Сушка'];
const DEFAULT_OPERATION_TYPE = OPERATION_TYPE_OPTIONS[0];
const AREA_TYPE_OPTIONS = ['Производство', 'Качество', 'Лаборатория', 'Субподрядчик', 'Индивидуальный'];
const DEFAULT_AREA_TYPE = AREA_TYPE_OPTIONS[0];

function isMaterialIssueOperation(op) {
  return normalizeOperationType(op?.operationType) === 'Получение материала';
}

function isIdentificationOperation(op) {
  return normalizeOperationType(op?.operationType) === 'Идентификация';
}

function isMaterialReturnOperation(op) {
  return normalizeOperationType(op?.operationType) === 'Возврат материала';
}

function isDryingOperation(op) {
  return normalizeOperationType(op?.operationType) === 'Сушка';
}

function makeShiftSlotKey(date, shift) {
  return `${trimToString(date)}|${parseInt(shift, 10) || 1}`;
}

function getOpenShiftSlotKeys(data) {
  return new Set(
    (Array.isArray(data?.productionShifts) ? data.productionShifts : [])
      .filter(item => item && trimToString(item.status).toUpperCase() === 'OPEN')
      .map(item => makeShiftSlotKey(item.date, item.shift))
  );
}

function isWorkspaceRegularOperation(op) {
  return Boolean(op) && !isMaterialIssueOperation(op) && !isMaterialReturnOperation(op);
}

function getWorkspaceOpenShiftTasksForCard(data, card) {
  if (!card?.id) return [];
  const openKeys = getOpenShiftSlotKeys(data);
  if (!openKeys.size) return [];
  return (Array.isArray(data?.productionShiftTasks) ? data.productionShiftTasks : []).filter(task => (
    task
    && trimToString(task.cardId) === trimToString(card.id)
    && openKeys.has(makeShiftSlotKey(task.date, task.shift))
  ));
}

function isUserAssignedAsOperationExecutorServer(me, op) {
  const login = trimToString(me?.login).toLowerCase();
  const name = trimToString(me?.name || me?.username).toLowerCase();
  const aliases = new Set([login, name].filter(Boolean));
  const executors = [op?.executor].concat(Array.isArray(op?.additionalExecutors) ? op.additionalExecutors : [])
    .map(item => trimToString(item).toLowerCase())
    .filter(Boolean);
  return executors.some(item => aliases.has(item));
}

function hasShiftMasterPermissionForTaskServer(data, me, task) {
  const userId = trimToString(me?.id);
  if (!userId || !task?.date) return false;
  return (Array.isArray(data?.productionSchedule) ? data.productionSchedule : []).some(record => (
    trimToString(record?.date) === trimToString(task?.date)
    && (parseInt(record?.shift, 10) || 1) === (parseInt(task?.shift, 10) || 1)
    && trimToString(record?.areaId) === PRODUCTION_SHIFT_MASTER_AREA_ID
    && trimToString(record?.employeeId) === userId
  ));
}

function canUserOperateSubcontractTaskServer(data, me, card, op) {
  const openTasks = getOpenShiftTasksForOperationServer(data, card, op)
    .filter(task => isSubcontractAreaServer(data, task?.areaId));
  if (!openTasks.length) return true;
  if (isUserAssignedAsOperationExecutorServer(me, op)) return true;
  return openTasks.some(task => hasShiftMasterPermissionForTaskServer(data, me, task));
}

function isUserAssignedToIndividualTaskServer(data, me, task) {
  const userId = trimToString(me?.id || '');
  if (!userId || !task) return false;
  return (Array.isArray(data?.productionSchedule) ? data.productionSchedule : []).some(record => (
    trimToString(record?.date) === trimToString(task?.date)
    && (parseInt(record?.shift, 10) || 1) === (parseInt(task?.shift, 10) || 1)
    && trimToString(record?.areaId) === trimToString(task?.areaId)
    && trimToString(record?.employeeId) === userId
  ));
}

function hasAssignedEmployeeOnAreaShiftServer(data, date, shift, areaId) {
  const targetDate = trimToString(date);
  const targetAreaId = trimToString(areaId);
  const targetShift = parseInt(shift, 10) || 1;
  if (!targetDate || !targetAreaId) return false;
  return (Array.isArray(data?.productionSchedule) ? data.productionSchedule : []).some(record => (
    trimToString(record?.date) === targetDate
    && (parseInt(record?.shift, 10) || 1) === targetShift
    && trimToString(record?.areaId) === targetAreaId
    && trimToString(record?.employeeId)
  ));
}

function buildProductionAreaAssignmentErrorMessageServer(areaName) {
  return `На участок ${trimToString(areaName) || 'Участок'} не назначен исполнитель.`;
}

function getOpenShiftUnassignedAreaNameServer(data, date, shift, areaId) {
  const targetAreaId = trimToString(areaId);
  if (!trimToString(date) || !targetAreaId) return '';
  if (isSubcontractAreaServer(data, targetAreaId)) return '';
  const meta = getProductionShiftMutationMetaServer(data, date, shift);
  if (trimToString(meta?.status).toUpperCase() !== 'OPEN') return '';
  return hasAssignedEmployeeOnAreaShiftServer(data, date, shift, targetAreaId)
    ? ''
    : getPlanningTaskAreaNameServer(data, targetAreaId);
}

function canUserAccessIndividualOperationServer(data, me, card, op) {
  if (!me || !card || !op) return false;
  if (isAdminLikeUserServer(me, data?.accessLevels || [])) return true;
  const openTasks = getOpenShiftTasksForOperationServer(data, card, op)
    .filter(task => isIndividualAreaServer(data, task?.areaId));
  if (!openTasks.length) return false;
  return openTasks.some(task => isUserAssignedToIndividualTaskServer(data, me, task));
}

function canUserOperatePersonalOperationServer(data, me, card, op, personalOp) {
  if (!me || !personalOp || !card || !op) return false;
  if (isAdminLikeUserServer(me, data?.accessLevels || [])) return true;
  if (!canUserAccessIndividualOperationServer(data, me, card, op)) return false;
  return trimToString(personalOp?.currentExecutorUserId || '') === trimToString(me?.id || '');
}

function hasWorkspaceRegularPlannedOperation(data, card) {
  if (!card?.id) return false;
  return getWorkspaceOpenShiftTasksForCard(data, card).some(task => {
    const taskOp = findOperationInCard(card, trimToString(task.routeOpId || task.opId));
    return isWorkspaceRegularOperation(taskOp);
  });
}

function isWorkspaceOperationAllowed(data, card, op) {
  if (!card || !op) return false;
  if (!getOpenShiftSlotKeys(data).size) return false;
  if (isMaterialIssueOperation(op) || isMaterialReturnOperation(op)) {
    return hasWorkspaceRegularPlannedOperation(data, card);
  }
  return getWorkspaceOpenShiftTasksForCard(data, card).some(task => (
    trimToString(task.routeOpId || task.opId) === trimToString(op.id)
  ));
}

function getWorkspaceRoleFlagsServer(user, accessLevels = []) {
  const permissions = getUserPermissions(user, accessLevels);
  const worker = Boolean(permissions?.worker);
  const warehouseWorker = Boolean(permissions?.warehouseWorker);
  const restricted = !isAdminLikeUserServer(user, accessLevels) && (worker || warehouseWorker);
  return {
    worker,
    warehouseWorker,
    restricted,
    unrestricted: !restricted
  };
}

function isWorkspaceMaterialOperationServer(op) {
  return isMaterialIssueOperation(op) || isMaterialReturnOperation(op);
}

function canUserAccessWorkspaceTaskAssignmentServer(data, me, card, op) {
  return getOpenShiftTasksForOperationServer(data, card, op)
    .some(task => isUserAssignedToIndividualTaskServer(data, me, task));
}

function canUserAccessWorkspaceWorkerOperationServer(data, me, card, op) {
  if (!card || !op || isWorkspaceMaterialOperationServer(op)) return false;
  if (isUserAssignedAsOperationExecutorServer(me, op)) return true;
  return canUserAccessWorkspaceTaskAssignmentServer(data, me, card, op);
}

function getWorkspaceOperationRoleAccessServer(data, me, card, op) {
  const roleFlags = getWorkspaceRoleFlagsServer(me, data?.accessLevels || []);
  if (!roleFlags.restricted) {
    return {
      ...roleFlags,
      workerAllowed: true,
      warehouseAllowed: true,
      roleAllowed: true,
      denialReason: ''
    };
  }
  const workerAllowed = roleFlags.worker && canUserAccessWorkspaceWorkerOperationServer(data, me, card, op);
  const warehouseAllowed = roleFlags.warehouseWorker && isWorkspaceMaterialOperationServer(op);
  const roleAllowed = workerAllowed || warehouseAllowed;
  const denialReason = roleAllowed
    ? ''
    : (isWorkspaceMaterialOperationServer(op)
      ? 'Операция материалов доступна только работнику склада'
      : 'Операция доступна только назначенному исполнителю');
  return {
    ...roleFlags,
    workerAllowed,
    warehouseAllowed,
    roleAllowed,
    denialReason
  };
}

function canUserAccessWorkspaceCardServer(data, me, card) {
  if (!isWorkspaceCardBaseVisibleServer(data, card)) return false;
  const roleFlags = getWorkspaceRoleFlagsServer(me, data?.accessLevels || []);
  if (!roleFlags.restricted) return true;
  return (Array.isArray(card?.operations) ? card.operations : []).some(op => (
    isWorkspaceOperationAllowed(data, card, op)
    && getWorkspaceOperationRoleAccessServer(data, me, card, op).roleAllowed
  ));
}

function isWorkspaceCardBaseVisibleServer(data, card) {
  return Boolean(
    card &&
    !card.archived &&
    card.cardType === 'MKI' &&
    Array.isArray(card.operations) &&
    card.operations.length &&
    (card.approvalStage === APPROVAL_STAGE_PLANNING || card.approvalStage === APPROVAL_STAGE_PLANNED) &&
    hasWorkspaceRegularPlannedOperation(data, card)
  );
}

function getOpenShiftRecordsServer(data) {
  return (Array.isArray(data?.productionShifts) ? data.productionShifts : [])
    .filter(item => item && trimToString(item.status).toUpperCase() === 'OPEN')
    .map(item => ({
      ...item,
      id: trimToString(item.id) || makeShiftSlotKey(item.date, item.shift),
      date: trimToString(item.date),
      shift: parseInt(item.shift, 10) || 1,
      openedAt: Number.isFinite(Number(item.openedAt)) ? Number(item.openedAt) : Number.POSITIVE_INFINITY
    }));
}

function getOpenShiftTasksForOperationServer(data, card, op) {
  if (!card?.id || !op) return [];
  const openRecords = getOpenShiftRecordsServer(data);
  if (!openRecords.length) return [];
  const openByKey = new Map(openRecords.map(item => [makeShiftSlotKey(item.date, item.shift), item]));
  const opRouteId = trimToString(op.id);
  const opRefId = trimToString(op.opId);
  return (Array.isArray(data?.productionShiftTasks) ? data.productionShiftTasks : [])
    .filter(task => {
      if (!task) return false;
      if (trimToString(task.cardId) !== trimToString(card.id)) return false;
      const routeOpId = trimToString(task.routeOpId);
      const opId = trimToString(task.opId);
      if (routeOpId !== opRouteId && (routeOpId || !opRefId || opId !== opRefId)) return false;
      return openByKey.has(makeShiftSlotKey(task.date, task.shift));
    })
    .map(task => ({
      ...task,
      date: trimToString(task.date),
      shift: parseInt(task.shift, 10) || 1,
      shiftRecord: openByKey.get(makeShiftSlotKey(task.date, task.shift)) || null,
      createdAt: Number.isFinite(Number(task.createdAt)) ? Number(task.createdAt) : Number.POSITIVE_INFINITY
    }));
}

function resolveFlowEventShiftContextServer(data, card, op) {
  const tasks = getOpenShiftTasksForOperationServer(data, card, op)
    .filter(task => task.shiftRecord && trimToString(task.shiftRecord.status).toUpperCase() === 'OPEN');
  if (!tasks.length) {
    return {
      shiftDate: null,
      shift: null,
      shiftRecordId: null,
      shiftStatus: null,
      areaId: null,
      taskId: null
    };
  }
  tasks.sort((a, b) => {
    const openedDiff = (a.shiftRecord?.openedAt || Number.POSITIVE_INFINITY) - (b.shiftRecord?.openedAt || Number.POSITIVE_INFINITY);
    if (openedDiff !== 0) return openedDiff;
    const dateDiff = trimToString(a.date).localeCompare(trimToString(b.date));
    if (dateDiff !== 0) return dateDiff;
    const shiftDiff = (a.shift || 1) - (b.shift || 1);
    if (shiftDiff !== 0) return shiftDiff;
    return (a.createdAt || Number.POSITIVE_INFINITY) - (b.createdAt || Number.POSITIVE_INFINITY);
  });
  const selected = tasks[0];
  return {
    shiftDate: trimToString(selected.date) || null,
    shift: Number.isFinite(Number(selected.shift)) ? (parseInt(selected.shift, 10) || 1) : null,
    shiftRecordId: trimToString(selected.shiftRecord?.id) || makeShiftSlotKey(selected.date, selected.shift),
    shiftStatus: trimToString(selected.shiftRecord?.status) || 'OPEN',
    areaId: trimToString(selected.areaId) || null,
    taskId: trimToString(selected.id) || null
  };
}

function appendFlowHistoryEntryWithShift(data, { card, op, shiftOp = null, item, status, comment = '', me = null, now = Date.now(), personalOperationId = '', isPersonalOperation = false } = {}) {
  if (!item || !card || !op) return null;
  if (!Array.isArray(item.history)) item.history = [];
  const actorName = trimToString(me?.name || me?.username || me?.login || '');
  const actorId = trimToString(me?.id || '');
  const shiftContext = resolveFlowEventShiftContextServer(data, card, shiftOp || op);
  const entry = {
    at: now,
    cardQr: card.qrId || '',
    opId: trimToString(op?.id || op?.opId || '') || null,
    opCode: trimToString(op?.opCode || '') || null,
    opName: trimToString(op?.opName || op?.name || '') || null,
    status,
    comment: comment || '',
    createdBy: actorName,
    userId: actorId || null,
    userName: actorName || null,
    shiftDate: shiftContext.shiftDate || null,
    shift: Number.isFinite(Number(shiftContext.shift)) ? (parseInt(shiftContext.shift, 10) || 1) : null,
    shiftRecordId: shiftContext.shiftRecordId || null,
    shiftStatus: shiftContext.shiftStatus || null,
    areaId: shiftContext.areaId || null,
    shiftTaskId: shiftContext.taskId || null,
    personalOperationId: trimToString(personalOperationId || '') || null,
    isPersonalOperation: Boolean(isPersonalOperation)
  };
  item.history.push(entry);
  return entry;
}

function getSubcontractTaskItemsServer(card, task) {
  if (!card || !task) return [];
  const itemIds = normalizeSubcontractItemIdsServer(task?.subcontractItemIds);
  if (!itemIds.length) return [];
  const kind = trimToString(task?.subcontractItemKind).toUpperCase();
  const list = kind === 'SAMPLE'
    ? (Array.isArray(card?.flow?.samples) ? card.flow.samples : [])
    : (Array.isArray(card?.flow?.items) ? card.flow.items : []);
  return itemIds.map(itemId => list.find(item => trimToString(item?.id) === itemId) || null).filter(Boolean);
}

function isSubcontractItemFinishedStatusServer(item) {
  const finalStatus = trimToString(item?.finalStatus || item?.current?.status).toUpperCase();
  return finalStatus === 'GOOD' || finalStatus === 'DELAYED' || finalStatus === 'DEFECT';
}

function isSubcontractChainCompletedServer(card, task) {
  const items = getSubcontractTaskItemsServer(card, task);
  if (!items.length) return false;
  return items.every(isSubcontractItemFinishedStatusServer);
}

function getOperationOrderMapServer(card) {
  const map = new Map();
  (Array.isArray(card?.operations) ? card.operations : []).forEach((item, index) => {
    const opId = resolveCardOpIdServer(item);
    if (!opId) return;
    map.set(opId, getOperationOrderValueServer(item, index));
  });
  return map;
}

function getFlowItemCurrentOrderServer(item, opOrderMap = null) {
  const currentOpId = trimToString(item?.current?.opId || '');
  if (!currentOpId) return Number.POSITIVE_INFINITY;
  const map = opOrderMap instanceof Map ? opOrderMap : null;
  const order = map ? map.get(currentOpId) : undefined;
  return Number.isFinite(order) ? order : Number.POSITIVE_INFINITY;
}

function isFlowHistoryEntryRelevantForCurrentPositionServer(item, entry, opOrderMap = null) {
  if (!entry) return false;
  const entryOpId = trimToString(entry?.opId || '');
  if (!entryOpId) return false;
  const map = opOrderMap instanceof Map ? opOrderMap : null;
  const currentOrder = getFlowItemCurrentOrderServer(item, map);
  if (!Number.isFinite(currentOrder)) return true;
  const entryOrder = map ? map.get(entryOpId) : undefined;
  if (!Number.isFinite(entryOrder)) return true;
  return entryOrder <= currentOrder;
}

function getRelevantFlowHistoryEntriesServer(item, opOrderMap = null) {
  const history = Array.isArray(item?.history) ? item.history : [];
  return history.filter(entry => isFlowHistoryEntryRelevantForCurrentPositionServer(item, entry, opOrderMap));
}

function getLastRelevantStatusForOpServer(item, opId, opOrderMap = null) {
  const targetOpId = trimToString(opId || '');
  if (!targetOpId) return null;
  let last = null;
  getRelevantFlowHistoryEntriesServer(item, opOrderMap).forEach(entry => {
    if (trimToString(entry?.opId || '') !== targetOpId) return;
    const status = normalizeFlowStatus(entry?.status, null);
    if (status) last = status;
  });
  return last;
}

function getLastRelevantStatusesByOpServer(item, opOrderMap = null) {
  const lastStatusByOp = new Map();
  getRelevantFlowHistoryEntriesServer(item, opOrderMap).forEach(entry => {
    const opId = trimToString(entry?.opId || '');
    const status = normalizeFlowStatus(entry?.status, null);
    if (opId && status) lastStatusByOp.set(opId, status);
  });
  return lastStatusByOp;
}

function isSubcontractPlanningItemAvailableServer(card, op, item, opOrderMap = null) {
  if (!card || !op || !item || isSubcontractItemFinishedStatusServer(item)) return false;
  const currentStatus = normalizeFlowStatus(item?.current?.status, null);
  if (currentStatus !== 'PENDING') return false;
  const currentOpId = trimToString(item?.current?.opId);
  const targetOpId = resolveCardOpIdServer(op);
  if (!currentOpId || !targetOpId) return false;
  if (currentOpId === targetOpId) return true;
  const orderMap = opOrderMap || getOperationOrderMapServer(card);
  const currentOrder = orderMap.get(targetOpId);
  const itemOrder = orderMap.get(currentOpId);
  return Number.isFinite(currentOrder) && Number.isFinite(itemOrder) && itemOrder < currentOrder;
}

function shouldCountTaskInPlanningCoverageServer(data, task) {
  if (!task || task.closePagePreview === true) return false;
  const dateStr = trimToString(task?.date);
  const shift = parseInt(task?.shift, 10) || 1;
  if (!dateStr) return false;
  const shiftRecord = getProductionShiftRecordServer(data, dateStr, shift);
  const status = trimToString(shiftRecord?.status).toUpperCase() || 'PLANNING';
  const isFixed = Boolean(shiftRecord?.isFixed || status === 'LOCKED');
  if (isFixed) return false;
  return status !== 'CLOSED' && status !== 'LOCKED';
}

function collectReservedSubcontractItemIdsServer(data, card, op, { excludeTaskId = '' } = {}) {
  const reservedIds = new Set();
  const cardId = trimToString(card?.id);
  const routeOpId = resolveCardOpIdServer(op);
  const excludedTaskId = trimToString(excludeTaskId);
  (Array.isArray(data?.productionShiftTasks) ? data.productionShiftTasks : []).forEach(task => {
    if (!task || !isSubcontractAreaServer(data, task?.areaId)) return;
    if (!shouldCountTaskInPlanningCoverageServer(data, task)) return;
    if (cardId && trimToString(task?.cardId) !== cardId) return;
    if (routeOpId && trimToString(task?.routeOpId) !== routeOpId) return;
    if (excludedTaskId && trimToString(task?.id) === excludedTaskId) return;
    normalizeSubcontractItemIdsServer(task?.subcontractItemIds).forEach(itemId => reservedIds.add(itemId));
  });
  return reservedIds;
}

function getAvailableSubcontractItemsServer(data, card, op, options = {}) {
  const list = getFlowListForOp(card, op, op?.isSamples ? 'SAMPLE' : 'ITEM');
  const opOrderMap = getOperationOrderMapServer(card);
  const reservedIds = options?.excludeReserved === false
    ? new Set()
    : collectReservedSubcontractItemIdsServer(data, card, op, options);
  return list.filter(item => {
    const itemId = trimToString(item?.id);
    if (!itemId || reservedIds.has(itemId)) return false;
    return isSubcontractPlanningItemAvailableServer(card, op, item, opOrderMap);
  });
}

function pickSubcontractPendingItemIdsServer(data, card, op, requestedQty = 0) {
  const pending = getAvailableSubcontractItemsServer(data, card, op);
  const limit = Math.max(0, Math.floor(Number(requestedQty) || 0));
  if (limit > 0 && pending.length > limit) {
    return pending.slice(0, limit).map(item => trimToString(item?.id)).filter(Boolean);
  }
  return pending.map(item => trimToString(item?.id)).filter(Boolean);
}

function removeFutureSubcontractChainTasksServer(data, task, currentSlot) {
  if (!task) return { removedCount: 0, removedTasks: [] };
  const chainId = trimToString(task?.subcontractChainId);
  if (!chainId) return { removedCount: 0, removedTasks: [] };
  const removedTasks = [];
  data.productionShiftTasks = (Array.isArray(data?.productionShiftTasks) ? data.productionShiftTasks : []).filter(entry => {
    const sameChain = (
      trimToString(entry?.cardId) === trimToString(task?.cardId)
      && trimToString(entry?.routeOpId) === trimToString(task?.routeOpId)
      && trimToString(entry?.areaId) === trimToString(task?.areaId)
      && trimToString(entry?.subcontractChainId) === chainId
    );
    if (!sameChain) return true;
    const isFuture = compareProductionShiftSlotServer(
      { date: trimToString(entry?.date), shift: parseInt(entry?.shift, 10) || 1 },
      currentSlot
    ) > 0;
    if (isFuture) {
      removedTasks.push(normalizeProductionShiftTask(entry));
      return false;
    }
    return true;
  });
  return { removedCount: removedTasks.length, removedTasks };
}

function getShiftFactStatsForOperationServer(card, routeOpId, shiftDate, shift) {
  const op = findOperationInCard(card, routeOpId);
  if (!card || !op || !shiftDate || !Number.isFinite(parseInt(shift, 10))) {
    return {
      doneQty: 0,
      defectQty: 0,
      delayedQty: 0,
      disposedQty: 0,
      returnedQty: 0,
      totalProcessedQty: 0,
      itemIds: []
    };
  }
  const normalizedShift = Math.max(1, parseInt(shift, 10));
  const flow = card?.flow || {};
  const archived = Array.isArray(flow.archivedItems) ? flow.archivedItems : [];
  const list = (() => {
    if (op.isSamples) {
      const sampleType = normalizeSampleTypeServer(op.sampleType);
      const activeSamples = getFlowListForOp(card, op, 'SAMPLE');
      const archivedSamples = archived.filter(item => (
        trimToString(item?.kind).toUpperCase() === 'SAMPLE'
        && normalizeSampleTypeServer(item?.sampleType) === sampleType
      ));
      return (activeSamples || []).concat(archivedSamples);
    }
    const activeItems = getFlowListForOp(card, op, 'ITEM');
    const archivedItems = archived.filter(item => {
      const kind = trimToString(item?.kind).toUpperCase();
      return !kind || kind === 'ITEM';
    });
    return (activeItems || []).concat(archivedItems);
  })();
  const itemIds = new Set();
  const stats = {
    doneQty: 0,
    defectQty: 0,
    delayedQty: 0,
    disposedQty: 0,
    returnedQty: 0,
    totalProcessedQty: 0,
    itemIds: []
  };
  (list || []).forEach(item => {
    const history = Array.isArray(item?.history) ? item.history : [];
    history.forEach(rawEntry => {
      const entry = normalizeFlowHistoryEntry(rawEntry);
      if (trimToString(entry.shiftDate) !== trimToString(shiftDate)) return;
      if ((parseInt(entry.shift, 10) || 0) !== normalizedShift) return;
      if (trimToString(entry.opId) !== trimToString(op.id)) return;
      let counted = false;
      if (entry.status === 'GOOD') {
        stats.doneQty += 1;
        counted = true;
      } else if (entry.status === 'DEFECT') {
        stats.defectQty += 1;
        counted = true;
      } else if (entry.status === 'DELAYED') {
        stats.delayedQty += 1;
        counted = true;
      } else if (entry.status === 'DISPOSED') {
        stats.disposedQty += 1;
        counted = true;
      } else if (entry.status === 'PENDING' && /возврат/i.test(trimToString(entry.comment))) {
        stats.returnedQty += 1;
        counted = true;
      }
      if (counted) {
        stats.totalProcessedQty += 1;
        itemIds.add(trimToString(item?.id || ''));
      }
    });
  });
  stats.itemIds = Array.from(itemIds).filter(Boolean);
  return stats;
}

const SPA_ROUTES = new Set([
  '/cards',
  '/cards/new',
  '/card-route',
  '/dashboard',
  '/approvals',
  '/provision',
  '/input-control',
  '/workorders',
  '/items',
  '/ok',
  '/oc',
  '/archive',
  '/receipts',
  '/workspace',
  '/users',
  '/accessLevels',
  '/departments',
  '/operations',
  '/areas',
  '/employees',
  '/shift-times',
  '/production/schedule',
  '/production/plan',
  '/production/shifts',
  '/production/gantt',
  '/production/delayed',
  '/production/defects',
  '/profile',
  '/'
]);
const DATA_SCOPE_FULL = 'full';
const DATA_SCOPE_CARDS_BASIC = 'cards-basic';
const DATA_SCOPE_DIRECTORIES = 'directories';
const DATA_SCOPE_PRODUCTION = 'production';

function normalizeDataScope(scope) {
  const value = String(scope || DATA_SCOPE_FULL).trim().toLowerCase();
  if (value === DATA_SCOPE_CARDS_BASIC) return DATA_SCOPE_CARDS_BASIC;
  if (value === DATA_SCOPE_DIRECTORIES) return DATA_SCOPE_DIRECTORIES;
  if (value === DATA_SCOPE_PRODUCTION) return DATA_SCOPE_PRODUCTION;
  return DATA_SCOPE_FULL;
}

function buildScopedDataPayload(data, scope) {
  const normalizedScope = normalizeDataScope(scope);
  const normalizedAreas = Array.isArray(data.areas) ? data.areas.map(normalizeArea) : [];
  const sanitizedUsers = (data.users || []).map(u => sanitizeUser(u, getAccessLevelForUser(u, data.accessLevels || [])));

  if (normalizedScope === DATA_SCOPE_CARDS_BASIC) {
    return {
      scope: normalizedScope,
      cards: Array.isArray(data.cards) ? data.cards : [],
      ops: Array.isArray(data.ops) ? data.ops : [],
      centers: Array.isArray(data.centers) ? data.centers : [],
      areas: normalizedAreas
    };
  }

  if (normalizedScope === DATA_SCOPE_DIRECTORIES) {
    return {
      scope: normalizedScope,
      ops: Array.isArray(data.ops) ? data.ops : [],
      centers: Array.isArray(data.centers) ? data.centers : [],
      areas: normalizedAreas,
      users: sanitizedUsers,
      productionShiftTimes: Array.isArray(data.productionShiftTimes) ? data.productionShiftTimes : []
    };
  }

  if (normalizedScope === DATA_SCOPE_PRODUCTION) {
    return {
      scope: normalizedScope,
      cards: Array.isArray(data.cards) ? data.cards : [],
      ops: Array.isArray(data.ops) ? data.ops : [],
      centers: Array.isArray(data.centers) ? data.centers : [],
      areas: normalizedAreas,
      users: sanitizedUsers,
      productionSchedule: Array.isArray(data.productionSchedule) ? data.productionSchedule : [],
      productionShiftTasks: Array.isArray(data.productionShiftTasks) ? data.productionShiftTasks : [],
      productionShifts: Array.isArray(data.productionShifts) ? data.productionShifts : [],
      productionShiftTimes: Array.isArray(data.productionShiftTimes) ? data.productionShiftTimes : []
    };
  }

  return {
    scope: DATA_SCOPE_FULL,
    ...data,
    areas: normalizedAreas,
    users: sanitizedUsers
  };
}

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

function resolveUserByNameLike(data, name) {
  const target = normalizeSurname(name);
  if (!target) return null;
  const users = Array.isArray(data?.users) ? data.users : [];
  return users.find(u => {
    const fullName = trimToString(u?.name || u?.username || u?.login || '');
    const tokens = fullName.split(/\s+/).map(t => trimToString(t)).filter(Boolean);
    const normalizedFull = normalizeSurname(fullName);
    return normalizedFull === target
      || tokens.some(token => normalizeSurname(token) === target)
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
  if (c === 'TECH_SPEC') return 'TechSpec';
  if (c === 'TRPN') return 'TRPN';
  if (c === 'PARTS_DOCS') return 'Parts';
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
  if (value === 'techspec') return 'TECH_SPEC';
  if (value === 'trpn') return 'TRPN';
  if (value === 'parts') return 'PARTS_DOCS';
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
  ensureDirSync(path.join(base, 'TechSpec'));
  ensureDirSync(path.join(base, 'TRPN'));
  ensureDirSync(path.join(base, 'Parts'));
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
  const folders = ['general', 'input-control', 'skk', 'TechSpec', 'TRPN', 'Parts'];

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

function normalizeAreaType(value) {
  const raw = trimToString(value);
  if (!raw) return DEFAULT_AREA_TYPE;
  const matched = AREA_TYPE_OPTIONS.find(option => option.toLowerCase() === raw.toLowerCase());
  return matched || DEFAULT_AREA_TYPE;
}

function normalizeArea(area) {
  if (!area || typeof area !== 'object') {
    return {
      id: '',
      name: '',
      desc: '',
      type: DEFAULT_AREA_TYPE
    };
  }
  return {
    ...area,
    id: trimToString(area.id),
    name: trimToString(area.name),
    desc: trimToString(area.desc),
    type: normalizeAreaType(area.type)
  };
}

function getAreaByIdServer(data, areaId) {
  const key = trimToString(areaId);
  return (Array.isArray(data?.areas) ? data.areas : []).find(item => trimToString(item?.id) === key) || null;
}

function isSubcontractAreaServer(data, areaId) {
  return trimToString(getAreaByIdServer(data, areaId)?.type) === 'Субподрядчик';
}

function normalizeSubcontractItemIdsServer(value) {
  return Array.isArray(value)
    ? Array.from(new Set(value.map(item => trimToString(item)).filter(Boolean)))
    : [];
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

function generateRawItemQrCode(len = 5) {
  return generateRawQrId(len);
}

function normalizeItemQrCodeServer(value) {
  return trimToString(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function isValidItemQrCodeServer(value) {
  return /^[A-Z0-9]{5}$/.test(value || '');
}

function buildItemQrServer(cardQrId, qrCode) {
  const base = normalizeQrIdServer(cardQrId || '');
  const code = normalizeItemQrCodeServer(qrCode);
  if (!base || !isValidItemQrCodeServer(code)) return '';
  return `${base}-${code}`;
}

function extractItemQrCodeServer(qrValue, cardQrId) {
  const raw = trimToString(qrValue).toUpperCase();
  const base = normalizeQrIdServer(cardQrId || '');
  if (!raw || !base) return '';
  const prefix = `${base}-`;
  if (!raw.startsWith(prefix)) return '';
  const suffix = normalizeItemQrCodeServer(raw.slice(prefix.length));
  return isValidItemQrCodeServer(suffix) ? suffix : '';
}

function extractAnyItemQrCodeServer(qrValue) {
  const raw = trimToString(qrValue).toUpperCase();
  const match = raw.match(/-([A-Z0-9]{5})$/);
  return match ? normalizeItemQrCodeServer(match[1]) : '';
}

function appendLegacyItemQrServer(item, qrValue) {
  const legacy = trimToString(qrValue);
  if (!legacy) return false;
  const current = trimToString(item?.qr || '');
  if (legacy === current) return false;
  const list = Array.isArray(item?.legacyQrs) ? item.legacyQrs.slice() : [];
  if (list.includes(legacy)) return false;
  list.push(legacy);
  item.legacyQrs = list;
  return true;
}

function collectCardItemQrCodesServer(card, excludeItemId = '') {
  const used = new Set();
  const excluded = trimToString(excludeItemId);
  const flowItems = []
    .concat(Array.isArray(card?.flow?.items) ? card.flow.items : [])
    .concat(Array.isArray(card?.flow?.samples) ? card.flow.samples : []);
  flowItems.forEach(item => {
    if (!item || trimToString(item.id) === excluded) return;
    const directCode = normalizeItemQrCodeServer(item.qrCode || '');
    const extracted = extractItemQrCodeServer(item.qr, card?.qrId || '') || extractAnyItemQrCodeServer(item.qr);
    const code = directCode || extracted;
    if (isValidItemQrCodeServer(code)) used.add(code);
  });
  return used;
}

function generateUniqueItemQrCodeServer(card, usedCodes = new Set()) {
  let attempt = 0;
  while (attempt < 1000) {
    const code = generateRawItemQrCode();
    if (!usedCodes.has(code)) {
      usedCodes.add(code);
      return code;
    }
    attempt += 1;
  }
  const fallback = generateRawItemQrCode(6).slice(0, 5);
  usedCodes.add(fallback);
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
      const incoming = (() => {
        if (Object.prototype.hasOwnProperty.call(tabs, key)) {
          return tabs[key] || {};
        }
        if (PRODUCTION_GRANULAR_PERMISSION_KEYS.includes(key) && Object.prototype.hasOwnProperty.call(tabs, 'production')) {
          return tabs.production || {};
        }
        return {};
      })();
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
    skkWorker: Boolean(source.skkWorker ?? DEFAULT_PERMISSIONS.skkWorker),
    labWorker: Boolean(source.labWorker ?? DEFAULT_PERMISSIONS.labWorker),
    warehouseWorker: Boolean(source.warehouseWorker ?? DEFAULT_PERMISSIONS.warehouseWorker),
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

function buildDefaultUser(existingUsers = []) {
  const { hash, salt } = hashPassword(DEFAULT_ADMIN_PASSWORD);
  return {
    id: createUserId(existingUsers),
    ...DEFAULT_ADMIN,
    passwordHash: hash,
    passwordSalt: salt,
    accessLevelId: 'level_admin',
    status: 'active',
    departmentId: null
  };
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
    { shift: 1, timeFrom: '08:00', timeTo: '16:00', lunchFrom: '', lunchTo: '' },
    { shift: 2, timeFrom: '16:00', timeTo: '00:00', lunchFrom: '', lunchTo: '' },
    { shift: 3, timeFrom: '00:00', timeTo: '08:00', lunchFrom: '', lunchTo: '' }
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

const LEGACY_SNAPSHOT_DATA_PATH = '/api/data';

function normalizeSharedRevisionValue(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function readSharedRevisionValue(value, fallbackKeys = ['rev', 'actualRev', 'flowVersion']) {
  if (value == null) return null;
  if (typeof value !== 'object') {
    return normalizeSharedRevisionValue(value);
  }
  for (const key of fallbackKeys) {
    const normalized = normalizeSharedRevisionValue(value[key]);
    if (normalized !== null) return normalized;
  }
  return null;
}

function readSharedExpectedRevisionValue(value, fallbackKeys = ['expectedRev', 'expectedFlowVersion']) {
  if (value == null) return null;
  if (typeof value !== 'object') {
    return normalizeSharedRevisionValue(value);
  }
  for (const key of fallbackKeys) {
    const normalized = normalizeSharedRevisionValue(value[key]);
    if (normalized !== null) return normalized;
  }
  return null;
}

function compareSharedExpectedRevision({
  expectedRev = null,
  actualRev = null,
  payload = null
} = {}) {
  const resolvedPayload = payload && typeof payload === 'object' ? payload : null;
  const normalizedExpectedRev = expectedRev !== null && expectedRev !== undefined
    ? readSharedExpectedRevisionValue(expectedRev)
    : readSharedExpectedRevisionValue(resolvedPayload);
  const normalizedActualRev = actualRev !== null && actualRev !== undefined
    ? readSharedRevisionValue(actualRev)
    : readSharedRevisionValue(resolvedPayload);
  const isComparable = normalizedExpectedRev !== null && normalizedActualRev !== null;
  return {
    expectedRev: normalizedExpectedRev,
    actualRev: normalizedActualRev,
    isComparable,
    matches: isComparable ? normalizedExpectedRev === normalizedActualRev : null,
    isConflict: isComparable ? normalizedExpectedRev !== normalizedActualRev : false
  };
}

function normalizeExpectedRevisionInput(value) {
  return readSharedExpectedRevisionValue(value);
}

function buildConflictPayload({
  code = 'STALE_REVISION',
  entity = '',
  id = '',
  expectedRev = null,
  actualRev = null,
  message = 'Конфликт данных',
  extras = null
} = {}) {
  const safeMessage = trimToString(message) || 'Конфликт данных';
  const payload = {
    code: trimToString(code) || 'STALE_REVISION',
    entity: trimToString(entity),
    id: trimToString(id),
    expectedRev: Number.isFinite(expectedRev) ? expectedRev : null,
    actualRev: Number.isFinite(actualRev) ? actualRev : null,
    message: safeMessage,
    error: safeMessage
  };
  if (!payload.entity) delete payload.entity;
  if (!payload.id) delete payload.id;
  if (!Number.isFinite(payload.expectedRev)) delete payload.expectedRev;
  if (!Number.isFinite(payload.actualRev)) delete payload.actualRev;
  if (extras && typeof extras === 'object') {
    Object.keys(extras).forEach(key => {
      if (extras[key] !== undefined) payload[key] = extras[key];
    });
  }
  return payload;
}

function buildSharedRevisionConflictPayload(options = {}) {
  const revisionComparison = compareSharedExpectedRevision({
    expectedRev: options.expectedRev ?? options.expectedFlowVersion,
    actualRev: options.actualRev ?? options.flowVersion,
    payload: options
  });
  return buildConflictPayload({
    ...options,
    expectedRev: revisionComparison.expectedRev,
    actualRev: revisionComparison.actualRev
  });
}

function resolveConflictWritePath(req = null) {
  return trimToString(req?.url || '').split('?')[0] || '';
}

function sendConflictResponse(res, options = {}, req = null) {
  const payload = buildSharedRevisionConflictPayload(options);
  console.warn('[CONFLICT] Response', {
    writePath: resolveConflictWritePath(req) || null,
    code: payload.code,
    entity: payload.entity || null,
    id: payload.id || null,
    expectedRev: Number.isFinite(payload.expectedRev) ? payload.expectedRev : null,
    actualRev: Number.isFinite(payload.actualRev) ? payload.actualRev : null
  });
  sendJson(res, 409, payload);
}

function sendFlowVersionConflict(res, {
  cardId = '',
  expectedFlowVersion = null,
  flowVersion = null,
  message = 'Версия flow устарела'
} = {}, req = null) {
  sendConflictResponse(res, {
    code: 'STALE_REVISION',
    entity: 'card.flow',
    id: cardId,
    expectedRev: expectedFlowVersion,
    actualRev: flowVersion,
    message,
    extras: {
      flowVersion: Number.isFinite(flowVersion) ? flowVersion : undefined
    }
  }, req);
}

function isLegacySnapshotDataPath(pathname = '') {
  return trimToString(pathname).split('?')[0] === LEGACY_SNAPSHOT_DATA_PATH;
}

function logLegacySnapshotWriteBoundary(req = null, extras = null) {
  const payload = extras && typeof extras === 'object' ? extras : {};
  console.warn('[DATA] legacy snapshot write boundary', {
    writePath: LEGACY_SNAPSHOT_DATA_PATH,
    method: trimToString(req?.method || '') || null,
    route: resolveConflictWritePath(req) || LEGACY_SNAPSHOT_DATA_PATH,
    ...payload
  });
}

function formatAppVersionPart(value) {
  return String(Number.isFinite(value) ? value : 0).padStart(2, '0');
}

function formatAppVersionMajor(stage, value) {
  const safeValue = Number.isFinite(value) ? value : 0;
  if (String(stage || '').trim() === 'Betta') return formatAppVersionPart(safeValue);
  return String(safeValue);
}

function readAppVersionMeta() {
  try {
    const raw = fs.readFileSync(APP_VERSION_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      productName: String(parsed?.productName || 'Tracker').trim() || 'Tracker',
      stage: String(parsed?.stage || 'Alpha').trim() || 'Alpha',
      major: Number(parsed?.major || 0),
      minor: Number(parsed?.minor || 0),
      patch: Number(parsed?.patch || 0),
      email: String(parsed?.email || 'a.protasov@tspc.ru').trim() || 'a.protasov@tspc.ru'
    };
  } catch (err) {
    console.error('[BOOT] Failed to read app-version.json', err?.message || err);
    return {
      productName: 'Tracker',
      stage: 'Alpha',
      major: 0,
      minor: 0,
      patch: 0,
      email: 'a.protasov@tspc.ru'
    };
  }
}

function buildAppVersionFooter() {
  const meta = readAppVersionMeta();
  const version = [
    formatAppVersionMajor(meta.stage, meta.major),
    formatAppVersionPart(meta.minor),
    formatAppVersionPart(meta.patch)
  ].join('.');
  return `${meta.productName} ${meta.stage} v ${version} mail to: ${meta.email}`;
}

function applyNoStoreHeaders(headers = {}) {
  return {
    ...headers,
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0'
  };
}

function shouldDisableStaticCaching(pathname) {
  const fileName = path.basename(pathname || '').toLowerCase();
  return fileName === 'index.html' || fileName === 'sw.js' || fileName === 'app-version.json' || fileName === 'version-log.html' || fileName === 'manifest.webmanifest';
}

function serveIndexHtml(res, { noStore = false } = {}) {
  const indexPath = path.join(PUBLIC_DIR, 'index.html');
  fs.readFile(indexPath, 'utf8', (err, html) => {
    if (err) {
      console.error('[BOOT] Failed to read index.html', err?.message || err);
      res.writeHead(500);
      res.end('Server error');
      return;
    }
    const rendered = html.replace(APP_VERSION_PLACEHOLDER, buildAppVersionFooter());
    const headers = applyNoStoreHeaders({ 'Content-Type': 'text/html; charset=utf-8' });
    if (noStore) headers['Cache-Control'] = 'no-store';
    res.writeHead(200, headers);
    res.end(rendered);
  });
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
      '.webmanifest': 'application/manifest+json; charset=utf-8',
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
      if (ext === '.html' && path.basename(pathname).toLowerCase() === 'index.html') {
        const rendered = data.toString('utf8').replace(APP_VERSION_PLACEHOLDER, buildAppVersionFooter());
        res.writeHead(200, applyNoStoreHeaders({ 'Content-Type': mime }));
        res.end(rendered);
        return;
      }
      const headers = shouldDisableStaticCaching(pathname)
        ? applyNoStoreHeaders({ 'Content-Type': mime })
        : { 'Content-Type': mime };
      res.writeHead(200, headers);
      res.end(data);
    });
  });
}

function sendHtmlStatus(res, statusCode, title, message) {
  const safeTitle = String(title || '').trim() || 'Ошибка';
  const safeMessage = String(message || '').trim() || 'Запрос не может быть выполнен.';
  res.writeHead(statusCode, applyNoStoreHeaders({ 'Content-Type': 'text/html; charset=utf-8' }));
  res.end(
    '<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>${safeTitle}</title>` +
    '<style>body{margin:0;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f5f5f7;color:#111827;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}main{max-width:520px;width:100%;background:#fff;border-radius:12px;padding:24px;box-shadow:0 6px 24px rgba(0,0,0,.08)}h1{margin:0 0 12px;font-size:24px}p{margin:0;color:#4b5563;line-height:1.5}a{display:inline-block;margin-top:16px;color:#047857;text-decoration:none;font-weight:600}</style>' +
    `</head><body><main><h1>${safeTitle}</h1><p>${safeMessage}</p><a href="/">Вернуться на сайт</a></main></body></html>`
  );
}

async function serveVersionLogPage(req, res, { normalizedPath = '' } = {}) {
  const { user, session } = await resolveUserBySession(req, { enforceCsrf: false });
  if (!user || !session) {
    try {
      console.warn('[AUTH] version-log unauthorized', { path: normalizedPath || req.url || '' });
    } catch (e) {}
    res.writeHead(302, applyNoStoreHeaders({ Location: '/' }));
    res.end();
    return;
  }

  const data = await database.getData();
  if (!canViewTab(user, data.accessLevels || [], 'accessLevels')) {
    try {
      console.warn('[AUTH] version-log forbidden', {
        path: normalizedPath || req.url || '',
        userId: user.id || null,
        userName: user.name || user.username || null
      });
    } catch (e) {}
    sendHtmlStatus(res, 403, 'Недостаточно прав', 'Лог версий доступен только авторизованным пользователям с правом просмотра уровней доступа.');
    return;
  }

  try {
    console.log('[ROUTE] serve version-log', {
      path: normalizedPath || req.url || '',
      userId: user.id || null,
      userName: user.name || user.username || null
    });
  } catch (e) {}

  const originalUrl = req.url;
  req.url = '/docs/version-log.html';
  serveStatic(req, res);
  req.url = originalUrl;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalLength = 0;
    req.on('data', chunk => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buffer);
      totalLength += buffer.length;
      if (totalLength > MAX_BODY_SIZE) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
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
    const statuses = opsArr.map(o => norm(o && o.status)).map(status => (
      status === 'NO_ITEMS' ? 'NOT_STARTED' : status
    ));

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

function appendCardLog(card, {
  action = 'update',
  object = '',
  targetId = null,
  field = null,
  oldValue = '',
  newValue = '',
  userName = '',
  createdBy = ''
} = {}) {
  if (!card) return;
  if (!Array.isArray(card.logs)) card.logs = [];
  card.logs.push({
    id: genId('log'),
    ts: Date.now(),
    action,
    object,
    targetId,
    field,
    userName: trimToString(userName || createdBy || ''),
    createdBy: trimToString(createdBy || userName || ''),
    oldValue: oldValue != null ? oldValue : '',
    newValue: newValue != null ? newValue : ''
  });
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
  safeCard.plannedCompletionDate = /^\d{4}-\d{2}-\d{2}$/.test(trimToString(safeCard.plannedCompletionDate))
    ? trimToString(safeCard.plannedCompletionDate)
    : '';
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
    comments: Array.isArray(op.comments)
      ? op.comments.map(entry => ({
        id: entry && entry.id ? entry.id : genId('cmt'),
        text: entry && entry.text ? String(entry.text) : '',
        author: entry && entry.author ? String(entry.author) : '',
        createdAt: entry && entry.createdAt ? entry.createdAt : Date.now()
      }))
      : [],
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
      userName: trimToString(entry.userName || entry.createdBy || ''),
      createdBy: trimToString(entry.createdBy || entry.userName || ''),
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
      scopeId: file.scopeId || null,
      operationLabel: file.operationLabel || '',
      itemsLabel: file.itemsLabel || '',
      opId: file.opId || null,
      opCode: file.opCode || '',
      opName: file.opName || ''
    }))
    : [];
  safeCard.materialIssues = Array.isArray(safeCard.materialIssues)
    ? safeCard.materialIssues.map(entry => ({
      opId: trimToString(entry?.opId || ''),
      updatedAt: typeof entry?.updatedAt === 'number' ? entry.updatedAt : Date.now(),
      updatedBy: trimToString(entry?.updatedBy || ''),
      items: Array.isArray(entry?.items)
        ? entry.items.map(item => ({
          name: trimToString(item?.name || ''),
          qty: trimToString(item?.qty || ''),
          unit: trimToString(item?.unit || 'кг') || 'кг',
          isPowder: Boolean(item?.isPowder),
          returnQty: trimToString(item?.returnQty || ''),
          balanceQty: trimToString(item?.balanceQty || '')
        }))
        : [],
      dryingRows: Array.isArray(entry?.dryingRows)
        ? entry.dryingRows.map(row => ({
          rowId: trimToString(row?.rowId || '') || genId('dry'),
          sourceIssueOpId: trimToString(row?.sourceIssueOpId || ''),
          sourceItemIndex: Number.isFinite(Number(row?.sourceItemIndex)) ? Number(row.sourceItemIndex) : -1,
          name: trimToString(row?.name || ''),
          qty: trimToString(row?.qty || ''),
          unit: trimToString(row?.unit || 'кг') || 'кг',
          isPowder: Boolean(row?.isPowder),
          dryQty: trimToString(row?.dryQty || ''),
          dryResultQty: trimToString(row?.dryResultQty || ''),
          status: trimToString(row?.status || '').toUpperCase() === 'IN_PROGRESS'
            ? 'IN_PROGRESS'
            : (trimToString(row?.status || '').toUpperCase() === 'DONE' ? 'DONE' : 'NOT_STARTED'),
          startedAt: typeof row?.startedAt === 'number' ? row.startedAt : null,
          finishedAt: typeof row?.finishedAt === 'number' ? row.finishedAt : null,
          createdAt: typeof row?.createdAt === 'number' ? row.createdAt : Date.now(),
          updatedAt: typeof row?.updatedAt === 'number' ? row.updatedAt : Date.now()
        }))
        : []
    }))
    : [];
  safeCard.personalOperations = Array.isArray(safeCard.personalOperations)
    ? safeCard.personalOperations.map(normalizePersonalOperation)
    : [];
  recalcCardProductionStatus(safeCard);
  return safeCard;
}

const FLOW_STATUS_SET = new Set(['PENDING', 'GOOD', 'DEFECT', 'DELAYED', 'DISPOSED']);
const PERSONAL_OPERATION_STATUS_SET = new Set(['NOT_STARTED', 'IN_PROGRESS', 'PAUSED', 'DONE']);

const FLOW_EXTRA_STATUS_SET = new Set(['PRIMARY', 'REPAIR']);

function normalizeFlowExtraStatus(value, fallback = 'PRIMARY') {
  const raw = String(value || '').toUpperCase();
  if (FLOW_EXTRA_STATUS_SET.has(raw)) return raw;
  return fallback;
}

function normalizeFlowStatus(value, fallback = 'PENDING') {
  const raw = String(value || '').toUpperCase();
  if (FLOW_STATUS_SET.has(raw)) return raw;
  return fallback;
}

function normalizePersonalOperationStatus(value, fallback = 'NOT_STARTED') {
  const raw = trimToString(value || '').toUpperCase();
  if (PERSONAL_OPERATION_STATUS_SET.has(raw)) return raw;
  return fallback;
}

function normalizePersonalOperationSegment(segment) {
  return {
    id: trimToString(segment?.id || '') || genId('poseg'),
    executorUserId: trimToString(segment?.executorUserId || '') || null,
    executorUserName: trimToString(segment?.executorUserName || '') || null,
    firstStartedAt: typeof segment?.firstStartedAt === 'number' ? segment.firstStartedAt : null,
    startedAt: typeof segment?.startedAt === 'number' ? segment.startedAt : null,
    finishedAt: typeof segment?.finishedAt === 'number' ? segment.finishedAt : null,
    elapsedSeconds: Number.isFinite(Number(segment?.elapsedSeconds)) ? Math.max(0, Number(segment.elapsedSeconds)) : 0,
    actualSeconds: Number.isFinite(Number(segment?.actualSeconds)) ? Math.max(0, Number(segment.actualSeconds)) : 0,
    finalState: trimToString(segment?.finalState || '').toUpperCase() === 'HANDOFF' ? 'HANDOFF' : 'DONE'
  };
}

function normalizePersonalOperation(personalOp) {
  const itemIds = Array.isArray(personalOp?.itemIds)
    ? Array.from(new Set(personalOp.itemIds.map(value => trimToString(value)).filter(Boolean)))
    : [];
  const segments = Array.isArray(personalOp?.historySegments)
    ? personalOp.historySegments.map(normalizePersonalOperationSegment)
    : [];
  return {
    id: trimToString(personalOp?.id || '') || genId('pop'),
    parentOpId: trimToString(personalOp?.parentOpId || ''),
    kind: trimToString(personalOp?.kind || '').toUpperCase() === 'SAMPLE' ? 'SAMPLE' : 'ITEM',
    itemIds,
    status: normalizePersonalOperationStatus(personalOp?.status),
    currentExecutorUserId: trimToString(personalOp?.currentExecutorUserId || '') || null,
    currentExecutorUserName: trimToString(personalOp?.currentExecutorUserName || '') || null,
    firstStartedAt: typeof personalOp?.firstStartedAt === 'number' ? personalOp.firstStartedAt : null,
    startedAt: typeof personalOp?.startedAt === 'number' ? personalOp.startedAt : null,
    lastPausedAt: typeof personalOp?.lastPausedAt === 'number' ? personalOp.lastPausedAt : null,
    finishedAt: typeof personalOp?.finishedAt === 'number' ? personalOp.finishedAt : null,
    elapsedSeconds: Number.isFinite(Number(personalOp?.elapsedSeconds)) ? Math.max(0, Number(personalOp.elapsedSeconds)) : 0,
    actualSeconds: Number.isFinite(Number(personalOp?.actualSeconds)) ? Math.max(0, Number(personalOp.actualSeconds)) : 0,
    historySegments: segments
  };
}

function normalizeFlowHistoryEntry(entry) {
  const at = Number(entry?.at);
  const shift = Number.isFinite(parseInt(entry?.shift, 10)) ? Math.max(1, parseInt(entry.shift, 10)) : null;
  const shiftDate = typeof entry?.shiftDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.shiftDate)
    ? entry.shiftDate
    : null;
  return {
    at: Number.isFinite(at) ? at : Date.now(),
    cardQr: trimToString(entry?.cardQr || ''),
    opId: trimToString(entry?.opId || ''),
    opCode: trimToString(entry?.opCode || ''),
    opName: trimToString(entry?.opName || '') || null,
    status: normalizeFlowStatus(entry?.status, null),
    comment: trimToString(entry?.comment || ''),
    createdBy: trimToString(entry?.createdBy || ''),
    userId: trimToString(entry?.userId || '') || null,
    userName: trimToString(entry?.userName || '') || null,
    shiftDate,
    shift,
    shiftRecordId: trimToString(entry?.shiftRecordId || '') || null,
    shiftStatus: trimToString(entry?.shiftStatus || '') || null,
    areaId: trimToString(entry?.areaId || '') || null,
    shiftTaskId: trimToString(entry?.shiftTaskId || '') || null,
    personalOperationId: trimToString(entry?.personalOperationId || '') || null,
    isPersonalOperation: entry?.isPersonalOperation === true
  };
}

function isAdminLikeUserServer(user, accessLevels = []) {
  if (!user) return false;
  if (hasFullAccess(user)) return true;
  const permissions = getUserPermissions(user, accessLevels);
  return Boolean(permissions?.headSKK);
}

function getShiftTasksForOperationServer(data, card, op) {
  if (!card?.id || !op) return [];
  const opRouteId = trimToString(op.id);
  const opRefId = trimToString(op.opId);
  return (Array.isArray(data?.productionShiftTasks) ? data.productionShiftTasks : [])
    .filter(task => {
      if (!task) return false;
      if (trimToString(task.cardId) !== trimToString(card.id)) return false;
      const routeOpId = trimToString(task.routeOpId);
      const opId = trimToString(task.opId);
      return routeOpId === opRouteId || (!routeOpId && opRefId && opId === opRefId);
    })
    .map(task => ({
      ...task,
      date: trimToString(task.date),
      shift: parseInt(task.shift, 10) || 1,
      areaId: trimToString(task.areaId || '')
    }));
}

function isIndividualAreaServer(data, areaId) {
  return normalizeAreaType(getAreaByIdServer(data, areaId)?.type) === 'Индивидуальный';
}

function isIndividualOperationTypeServer(op) {
  if (!op) return false;
  if (isMaterialIssueOperation(op) || isMaterialReturnOperation(op) || isDryingOperation(op)) return false;
  const type = normalizeOperationType(op?.operationType);
  return type === 'Стандартная' || type === 'Идентификация' || type === 'Документы';
}

function getCardPersonalOperationsServer(card, parentOpId = '') {
  const list = Array.isArray(card?.personalOperations) ? card.personalOperations : [];
  const normalizedParentOpId = trimToString(parentOpId || '');
  if (!normalizedParentOpId) return list;
  return list.filter(entry => trimToString(entry?.parentOpId) === normalizedParentOpId);
}

function getPersonalOperationByIdServer(card, personalOperationId) {
  const targetId = trimToString(personalOperationId || '');
  if (!targetId) return null;
  return getCardPersonalOperationsServer(card).find(entry => trimToString(entry?.id) === targetId) || null;
}

function isIndividualOperationServer(data, card, op) {
  if (!card || !op || card.cardType !== 'MKI' || !isIndividualOperationTypeServer(op)) return false;
  if (getCardPersonalOperationsServer(card, op.id).length) return true;
  return getShiftTasksForOperationServer(data, card, op).some(task => isIndividualAreaServer(data, task?.areaId));
}

function getPersonalOperationFlowListServer(card, op, personalOp) {
  return getFlowListForOp(card, op, trimToString(personalOp?.kind || '').toUpperCase() === 'SAMPLE' ? 'SAMPLE' : 'ITEM');
}

function getPersonalOperationItemsServer(card, op, personalOp) {
  const itemIds = new Set(Array.isArray(personalOp?.itemIds) ? personalOp.itemIds.map(value => trimToString(value)).filter(Boolean) : []);
  if (!itemIds.size) return [];
  return getPersonalOperationFlowListServer(card, op, personalOp).filter(item => itemIds.has(trimToString(item?.id)));
}

function getPendingPersonalOperationItemsServer(card, op, personalOp) {
  return getPersonalOperationItemsServer(card, op, personalOp).filter(item => (
    trimToString(item?.current?.opId) === trimToString(op?.id)
    && normalizeFlowStatus(item?.current?.status, null) === 'PENDING'
  ));
}

function detachItemFromPersonalOperationsServer(card, parentOpId, itemId) {
  const normalizedParentOpId = trimToString(parentOpId || '');
  const normalizedItemId = trimToString(itemId || '');
  if (!card || !normalizedParentOpId || !normalizedItemId) return false;
  let changed = false;
  getCardPersonalOperationsServer(card, normalizedParentOpId).forEach(personalOp => {
    const prevIds = Array.isArray(personalOp?.itemIds)
      ? personalOp.itemIds.map(value => trimToString(value)).filter(Boolean)
      : [];
    const nextIds = prevIds.filter(value => value !== normalizedItemId);
    if (nextIds.length !== prevIds.length) {
      personalOp.itemIds = nextIds;
      changed = true;
    }
  });
  return changed;
}

function getPersonalOperationItemsLabelServer(card, op, personalOp) {
  return getPersonalOperationItemsServer(card, op, personalOp)
    .map(item => trimToString(item?.displayName || item?.id || ''))
    .filter(Boolean)
    .join(', ');
}

function getBusyPendingItemIdsForOperationServer(card, op, { excludePersonalOperationId = '' } = {}) {
  const excludedId = trimToString(excludePersonalOperationId || '');
  const ids = new Set();
  getCardPersonalOperationsServer(card, op?.id).forEach(personalOp => {
    if (!personalOp) return;
    if (excludedId && trimToString(personalOp.id) === excludedId) return;
    getPendingPersonalOperationItemsServer(card, op, personalOp).forEach(item => {
      const itemId = trimToString(item?.id);
      if (itemId) ids.add(itemId);
    });
  });
  return ids;
}

function getAvailablePersonalOperationItemsServer(card, op, options = {}) {
  const busyIds = getBusyPendingItemIdsForOperationServer(card, op, options);
  return getFlowListForOp(card, op, op?.isSamples ? 'SAMPLE' : 'ITEM').filter(item => (
    trimToString(item?.current?.opId) === trimToString(op?.id)
    && normalizeFlowStatus(item?.current?.status, null) === 'PENDING'
    && !busyIds.has(trimToString(item?.id))
  ));
}

function getLatestPersonalOperationSegmentServer(personalOp) {
  const list = Array.isArray(personalOp?.historySegments) ? personalOp.historySegments : [];
  return list.length ? list[list.length - 1] : null;
}

function ensureCurrentPersonalOperationSegmentServer(personalOp, me, now = Date.now()) {
  if (!Array.isArray(personalOp.historySegments)) personalOp.historySegments = [];
  const executorUserId = trimToString(me?.id || '') || null;
  const executorUserName = trimToString(me?.name || me?.username || me?.login || '') || null;
  let segment = getLatestPersonalOperationSegmentServer(personalOp);
  if (
    segment
    && trimToString(segment.executorUserId) === trimToString(executorUserId)
  ) {
    if (!segment.firstStartedAt) segment.firstStartedAt = now;
    if (segment.finishedAt) segment.finishedAt = null;
    if (trimToString(segment.finalState).toUpperCase() === 'HANDOFF') {
      segment.finalState = 'DONE';
    }
    return segment;
  }
  segment = normalizePersonalOperationSegment({
    executorUserId,
    executorUserName,
    firstStartedAt: now,
    startedAt: null,
    finishedAt: null,
    elapsedSeconds: 0,
    actualSeconds: 0,
    finalState: 'DONE'
  });
  personalOp.historySegments.push(segment);
  return segment;
}

function accumulatePersonalOperationTimeServer(personalOp, segment, now = Date.now()) {
  if (!personalOp?.startedAt) return 0;
  const diff = Math.max(0, (now - personalOp.startedAt) / 1000);
  personalOp.elapsedSeconds = Math.max(0, Number(personalOp.elapsedSeconds) || 0) + diff;
  if (segment) {
    segment.elapsedSeconds = Math.max(0, Number(segment.elapsedSeconds) || 0) + diff;
  }
  personalOp.startedAt = null;
  if (segment) segment.startedAt = null;
  return diff;
}

function finalizePersonalOperationSegmentServer(personalOp, segment, finalState = 'DONE', now = Date.now()) {
  if (!segment) return;
  if (personalOp?.startedAt) accumulatePersonalOperationTimeServer(personalOp, segment, now);
  segment.finishedAt = segment.finishedAt || now;
  segment.actualSeconds = Math.max(0, Number(segment.elapsedSeconds) || 0);
  segment.finalState = finalState === 'HANDOFF' ? 'HANDOFF' : 'DONE';
}

function syncPersonalOperationServer(card, op, personalOp, now = Date.now()) {
  if (!personalOp || !op) return personalOp;
  const pendingItems = getPendingPersonalOperationItemsServer(card, op, personalOp);
  const latestSegment = getLatestPersonalOperationSegmentServer(personalOp);
  if (!pendingItems.length) {
    if (personalOp.status !== 'DONE') {
      finalizePersonalOperationSegmentServer(personalOp, latestSegment, 'DONE', now);
      personalOp.status = 'DONE';
      personalOp.lastPausedAt = latestSegment?.finishedAt || personalOp.lastPausedAt || now;
      personalOp.finishedAt = latestSegment?.finishedAt || now;
      personalOp.actualSeconds = Math.max(0, Number(personalOp.elapsedSeconds) || 0);
    }
    personalOp.startedAt = null;
    return personalOp;
  }
  if (personalOp.status === 'DONE') {
    personalOp.status = 'PAUSED';
    personalOp.finishedAt = null;
    personalOp.actualSeconds = Math.max(0, Number(personalOp.elapsedSeconds) || 0);
  }
  return personalOp;
}

function syncPersonalOperationsForCardServer(card, data = null, now = Date.now()) {
  if (!card || !Array.isArray(card.personalOperations)) return;
  card.personalOperations = card.personalOperations
    .map(personalOp => normalizePersonalOperation(personalOp))
    .map(personalOp => {
      const op = findOperationInCard(card, personalOp.parentOpId);
      if (!op) return personalOp;
      if (data && !isIndividualOperationServer(data, card, op)) return personalOp;
      return syncPersonalOperationServer(card, op, personalOp, now);
    });
}

function getPersonalOperationAggregateServer(card, op) {
  const personalOps = getCardPersonalOperationsServer(card, op?.id);
  const activePersonalOps = personalOps.filter(Boolean);
  const hasInProgress = activePersonalOps.some(entry => trimToString(entry?.status).toUpperCase() === 'IN_PROGRESS');
  const hasPaused = activePersonalOps.some(entry => trimToString(entry?.status).toUpperCase() === 'PAUSED');
  const pendingOnBase = getFlowListForOp(card, op, op?.isSamples ? 'SAMPLE' : 'ITEM').some(item => (
    trimToString(item?.current?.opId) === trimToString(op?.id)
    && normalizeFlowStatus(item?.current?.status, null) === 'PENDING'
  ));
  const totalSeconds = activePersonalOps.reduce((sum, entry) => sum + Math.max(0, Number(entry?.actualSeconds) || Number(entry?.elapsedSeconds) || 0), 0);
  let status = 'NOT_STARTED';
  if (hasInProgress) status = 'IN_PROGRESS';
  else if (hasPaused) status = 'PAUSED';
  else if (activePersonalOps.length && !pendingOnBase && activePersonalOps.every(entry => trimToString(entry?.status).toUpperCase() === 'DONE')) status = 'DONE';
  return {
    status,
    totalSeconds
  };
}

function applyPersonalOperationAggregatesToCardServer(data, card) {
  if (!card || !Array.isArray(card?.operations)) return;
  syncPersonalOperationsForCardServer(card, data);
  card.operations.forEach(op => {
    if (!isIndividualOperationServer(data, card, op)) return;
    const aggregate = getPersonalOperationAggregateServer(card, op);
    op.parentFlowBlocked = Boolean(op.blocked);
    op.parentFlowBlockedReasons = Array.isArray(op.blockedReasons) ? op.blockedReasons.slice() : [];
    op.status = aggregate.status;
    op.elapsedSeconds = aggregate.totalSeconds;
    op.actualSeconds = aggregate.totalSeconds;
    op.startedAt = null;
    op.lastPausedAt = null;
    if (aggregate.status === 'DONE' && !op.finishedAt) {
      op.finishedAt = Date.now();
    } else if (aggregate.status !== 'DONE') {
      op.finishedAt = null;
    }
    // Base row on individual areas is an aggregate only.
    // Action flags must not leak from the previous regular-flow recalculation.
    op.canStart = false;
    op.canPause = false;
    op.canResume = false;
    op.canComplete = false;
    op.blocked = false;
    op.blockedReasons = [];
  });
  recalcCardProductionStatus(card);
}

function refreshCardIndividualAggregateStateServer(data, card) {
  if (!card || card.cardType !== 'MKI') return;
  applyPersonalOperationAggregatesToCardServer(data, card);
}

function findReusablePersonalOperationForExecutorServer(card, op, me) {
  const userId = trimToString(me?.id || '');
  if (!userId) return null;
  return getCardPersonalOperationsServer(card, op?.id).find(entry => (
    trimToString(entry?.currentExecutorUserId || '') === userId
    && trimToString(entry?.kind || '') === (op?.isSamples ? 'SAMPLE' : 'ITEM')
  )) || null;
}

function startPersonalOperationServer(personalOp, me, now = Date.now()) {
  const executorUserId = trimToString(me?.id || '') || null;
  const executorUserName = trimToString(me?.name || me?.username || me?.login || '') || null;
  const isSameExecutor = trimToString(personalOp?.currentExecutorUserId || '') === trimToString(executorUserId || '');
  if (!isSameExecutor) {
    const previousSegment = getLatestPersonalOperationSegmentServer(personalOp);
    if (previousSegment && !previousSegment.finishedAt) {
      finalizePersonalOperationSegmentServer(personalOp, previousSegment, 'HANDOFF', now);
    }
    personalOp.currentExecutorUserId = executorUserId;
    personalOp.currentExecutorUserName = executorUserName;
  }
  const segment = ensureCurrentPersonalOperationSegmentServer(personalOp, me, now);
  if (isSameExecutor && personalOp.startedAt) {
    accumulatePersonalOperationTimeServer(personalOp, segment, now);
  }
  if (!personalOp.firstStartedAt) personalOp.firstStartedAt = now;
  if (!segment.firstStartedAt) segment.firstStartedAt = now;
  personalOp.status = 'IN_PROGRESS';
  personalOp.startedAt = now;
  personalOp.lastPausedAt = null;
  personalOp.finishedAt = null;
  segment.startedAt = now;
  return personalOp;
}

function pausePersonalOperationServer(personalOp, now = Date.now()) {
  const segment = getLatestPersonalOperationSegmentServer(personalOp);
  accumulatePersonalOperationTimeServer(personalOp, segment, now);
  personalOp.status = 'PAUSED';
  personalOp.lastPausedAt = now;
  personalOp.actualSeconds = Math.max(0, Number(personalOp.elapsedSeconds) || 0);
  return personalOp;
}

function resetPersonalOperationServer(personalOp, now = Date.now()) {
  const segment = getLatestPersonalOperationSegmentServer(personalOp);
  if (trimToString(personalOp?.status).toUpperCase() === 'IN_PROGRESS') {
    accumulatePersonalOperationTimeServer(personalOp, segment, now);
  }
  if (segment && !segment.finishedAt) {
    finalizePersonalOperationSegmentServer(personalOp, segment, 'DONE', now);
  }
  personalOp.startedAt = null;
  personalOp.lastPausedAt = null;
  personalOp.finishedAt = null;
  personalOp.actualSeconds = Math.max(0, Number(personalOp.elapsedSeconds) || 0);
  personalOp.status = 'NOT_STARTED';
  return personalOp;
}

function toSafeCountServer(value) {
  const num = parseInt(value, 10);
  if (!Number.isFinite(num) || num < 0) return 0;
  return num;
}

function normalizeFlowSerialList(raw, fallbackCount = 0) {
  let list = [];
  if (Array.isArray(raw)) {
    list = raw.map(value => (value == null ? '' : String(value)));
  } else if (typeof raw === 'string' && raw.trim()) {
    list = [raw.trim()];
  }
  if (!list.length && Number.isFinite(fallbackCount) && fallbackCount > 0) {
    list = Array.from({ length: fallbackCount }, () => '');
  }
  return list;
}

function buildFlowQrSet(cards = []) {
  const used = new Set();
  (cards || []).forEach(card => {
    (card?.flow?.items || []).forEach(item => {
      const qr = trimToString(item?.qr || '') || buildItemQrServer(card?.qrId || '', item?.qrCode || '');
      if (qr) used.add(qr);
    });
    (card?.flow?.samples || []).forEach(item => {
      const qr = trimToString(item?.qr || '') || buildItemQrServer(card?.qrId || '', item?.qrCode || '');
      if (qr) used.add(qr);
    });
  });
  return used;
}

function buildFlowDisplayName(serials, kind, index) {
  const raw = Array.isArray(serials) ? serials[index] : '';
  const value = (raw == null ? '' : String(raw)).trim();
  if (value) return value;
  return kind === 'SAMPLE' ? `Образец #${index + 1}` : `Изделие #${index + 1}`;
}

function parseAutoSampleSerialServer(value, prefixLetter) {
  const trimmed = trimToString(value);
  if (!trimmed) return null;
  const match = trimmed.match(new RegExp(`^(.+)-${prefixLetter}(\\d+)-(\\d{4})$`));
  if (!match) return null;
  return {
    base: match[1],
    seq: parseInt(match[2], 10),
    year: match[3]
  };
}

function getSamplePrefixLetterServer(sampleType) {
  return normalizeSampleTypeServer(sampleType) === 'WITNESS' ? 'С' : 'К';
}

function syncCardSerialsFromFlow(card) {
  const items = Array.isArray(card?.flow?.items) ? card.flow.items : [];
  const samples = Array.isArray(card?.flow?.samples) ? card.flow.samples : [];
  const controlSamples = samples.filter(item => normalizeSampleTypeServer(item?.sampleType) === 'CONTROL');
  const witnessSamples = samples.filter(item => normalizeSampleTypeServer(item?.sampleType) === 'WITNESS');
  card.itemSerials = items.map(item => trimToString(item?.displayName || ''));
  card.sampleSerials = controlSamples.map(item => trimToString(item?.displayName || ''));
  card.witnessSampleSerials = witnessSamples.map(item => trimToString(item?.displayName || ''));
  if (card.cardType === 'MKI') {
    card.sampleCount = card.sampleSerials.length;
    card.witnessSampleCount = card.witnessSampleSerials.length;
    card.quantity = card.itemSerials.length;
    card.batchSize = card.quantity;
  }
}

function getNextReturnedSampleNameServer(card, item) {
  if (!card || !item || item.kind !== 'SAMPLE') return null;
  const prefixLetter = getSamplePrefixLetterServer(item.sampleType);
  const currentName = trimToString(item.displayName || '');
  const parsedCurrent = parseAutoSampleSerialServer(currentName, prefixLetter);
  const fallbackBase = trimToString(card.routeCardNumber || card.orderNo || '');
  const base = trimToString(parsedCurrent?.base || fallbackBase);
  const year = trimToString(parsedCurrent?.year || new Date().getFullYear());
  if (!base || !year) return null;
  const currentSeq = Number.isFinite(parsedCurrent?.seq) ? parsedCurrent.seq : 0;
  const maxExistingSeq = (Array.isArray(card?.flow?.samples) ? card.flow.samples : []).reduce((maxSeq, sample) => {
    if (!sample || trimToString(sample.id) === trimToString(item.id)) return maxSeq;
    if (normalizeSampleTypeServer(sample.sampleType) !== normalizeSampleTypeServer(item.sampleType)) return maxSeq;
    const parsed = parseAutoSampleSerialServer(sample.displayName, prefixLetter);
    if (!parsed || parsed.base !== base || parsed.year !== year || !Number.isFinite(parsed.seq)) return maxSeq;
    return Math.max(maxSeq, parsed.seq);
  }, 0);
  const nextSeq = Math.max(currentSeq, maxExistingSeq) + 1;
  return `${base}-${prefixLetter}${nextSeq}-${year}`;
}

function detectAutoSampleSerialBaseServer(values, prefixLetter, routeNo) {
  const currentBase = trimToString(routeNo);
  const prefixes = new Set();
  let nonEmptyCount = 0;
  let matchedCount = 0;

  (values || []).forEach((value, idx) => {
    const trimmed = trimToString(value);
    if (!trimmed) return;
    nonEmptyCount += 1;
    const parsed = parseAutoSampleSerialServer(trimmed, prefixLetter);
    if (!parsed || parsed.seq !== idx + 1) return;
    prefixes.add(parsed.base);
    matchedCount += 1;
  });

  if (!nonEmptyCount || matchedCount !== nonEmptyCount || prefixes.size !== 1) return '';
  const [detectedBase] = Array.from(prefixes);
  if (!detectedBase || detectedBase === currentBase) return '';
  return detectedBase;
}

function normalizeAutoSampleSerialsServer(values, count, prefixLetter, routeNo, year) {
  const sized = normalizeFlowSerialList(values, count);
  const currentBase = trimToString(routeNo);
  if (!currentBase) return sized;

  const rebaseBase = detectAutoSampleSerialBaseServer(sized, prefixLetter, currentBase);
  return sized.map((value, idx) => {
    const trimmed = trimToString(value);
    if (!trimmed) {
      return `${currentBase}-${prefixLetter}${idx + 1}-${year}`;
    }
    const parsed = parseAutoSampleSerialServer(trimmed, prefixLetter);
    if (parsed && rebaseBase && parsed.base === rebaseBase && parsed.seq === idx + 1) {
      return `${currentBase}-${prefixLetter}${parsed.seq}-${parsed.year}`;
    }
    return trimmed;
  });
}

function appendRepairFlowItem(card, itemLabel, usedSet) {
  if (!card || typeof card !== 'object') return;
  if (!card.flow || typeof card.flow !== 'object') {
    card.flow = { items: [], samples: [], events: [], version: 1 };
  }
  if (!Array.isArray(card.flow.items)) card.flow.items = [];
  if (!Array.isArray(card.flow.samples)) card.flow.samples = [];
  if (!Array.isArray(card.flow.events)) card.flow.events = [];
  if (!Number.isFinite(card.flow.version)) card.flow.version = 1;

  const localUsed = new Set();
  (card.flow.items || []).forEach(item => {
    const code = normalizeItemQrCodeServer(item?.qrCode || '')
      || extractItemQrCodeServer(item?.qr || '', card.qrId || '')
      || extractAnyItemQrCodeServer(item?.qr || '');
    if (isValidItemQrCodeServer(code)) localUsed.add(code);
  });

  const opInfo = getFirstOperationForKind(card, 'ITEM');
  const now = Date.now();
  const displayName = trimToString(itemLabel)
    || buildFlowDisplayName(card.itemSerials, 'ITEM', card.flow.items.length);

  card.flow.items.push({
    id: genId('it'),
    kind: 'ITEM',
    displayName,
    extraStatus: 'REPAIR',
    qrCode: generateUniqueItemQrCodeServer(card, localUsed),
    qr: '',
    createdInCardQr: card.qrId || '',
    finalStatus: 'PENDING',
    current: {
      opId: opInfo.opId,
      opCode: opInfo.opCode,
      status: 'PENDING',
      updatedAt: now
    },
    history: []
  });
  const createdItem = card.flow.items[card.flow.items.length - 1];
  createdItem.qr = buildItemQrServer(card.qrId || '', createdItem.qrCode);
}

function resolveCardOpIdServer(op) {
  return trimToString(op?.id || op?.opId) || null;
}

function normalizeSampleTypeServer(value) {
  const raw = trimToString(value || '').toUpperCase();
  return raw === 'WITNESS' ? 'WITNESS' : 'CONTROL';
}

function getOpSampleTypeServer(op) {
  if (!op || !op.isSamples) return '';
  return normalizeSampleTypeServer(op.sampleType);
}

function getSamplesByType(samples, sampleType) {
  const list = Array.isArray(samples) ? samples : [];
  const type = normalizeSampleTypeServer(sampleType);
  return list.filter(item => normalizeSampleTypeServer(item?.sampleType) === type);
}

function getFlowListForOp(card, op, kindRaw) {
  if (kindRaw === 'SAMPLE') {
    return getSamplesByType(card?.flow?.samples, getOpSampleTypeServer(op));
  }
  return Array.isArray(card?.flow?.items) ? card.flow.items : [];
}

function getOperationsByKind(card, kind, sampleType = '') {
  const ops = Array.isArray(card.operations) ? card.operations : [];
  const wantSamples = kind === 'SAMPLE';
  const sampleTypeNorm = normalizeSampleTypeServer(sampleType);
  return ops
    .filter(op => {
      if (!op) return false;
      if (isMaterialIssueOperation(op)) return false;
      if (isMaterialReturnOperation(op)) return false;
      if (isDryingOperation(op)) return false;
      if (Boolean(op.isSamples) !== wantSamples) return false;
      if (!wantSamples) return true;
      return getOpSampleTypeServer(op) === sampleTypeNorm;
    })
    .map((op, index) => ({
      op,
      index,
      order: Number.isFinite(op?.order) ? op.order : index
    }))
    .sort((a, b) => (a.order - b.order) || (a.index - b.index));
}

function getFirstOperationForKind(card, kind, sampleType = '') {
  const list = getOperationsByKind(card, kind, sampleType);
  if (!list.length) return { opId: null, opCode: null };
  const first = list[0].op || null;
  return {
    opId: resolveCardOpIdServer(first),
    opCode: trimToString(first?.opCode) || null
  };
}

function getNextOperationForKind(card, kind, currentOpId, sampleType = '') {
  const list = getOperationsByKind(card, kind, sampleType);
  if (!list.length) return null;
  const idx = list.findIndex(entry => resolveCardOpIdServer(entry.op) === currentOpId);
  if (idx < 0 || idx + 1 >= list.length) return null;
  const next = list[idx + 1].op || null;
  return {
    opId: resolveCardOpIdServer(next),
    opCode: trimToString(next?.opCode) || null
  };
}

function getNextNonMaterialOpAfter(card, kind, currentOpId, sampleType = '') {
  const ops = Array.isArray(card.operations) ? card.operations : [];
  const wantSamples = kind === 'SAMPLE';
  const sampleTypeNorm = normalizeSampleTypeServer(sampleType);
  const indexed = ops.map((op, index) => ({
    op,
    index,
    order: getOperationOrderValueServer(op, index)
  })).sort((a, b) => (a.order - b.order) || (a.index - b.index));
  const currentIdx = indexed.findIndex(entry => resolveCardOpIdServer(entry.op) === currentOpId);
  if (currentIdx < 0) return null;
  for (let i = currentIdx + 1; i < indexed.length; i += 1) {
    const op = indexed[i].op;
    if (!op) continue;
    if (isMaterialIssueOperation(op) || isMaterialReturnOperation(op) || isDryingOperation(op)) continue;
    if (Boolean(op.isSamples) !== wantSamples) continue;
    if (wantSamples && getOpSampleTypeServer(op) !== sampleTypeNorm) continue;
    return {
      opId: resolveCardOpIdServer(op),
      opCode: trimToString(op?.opCode) || null
    };
  }
  return null;
}

function getLastOperationForKind(card, kind, sampleType = '') {
  const list = getOperationsByKind(card, kind, sampleType);
  if (!list.length) return { opId: null, opCode: null };
  const last = list[list.length - 1].op || null;
  return {
    opId: resolveCardOpIdServer(last),
    opCode: trimToString(last?.opCode) || null
  };
}

function computeFinalStatus(card, item, kind, sampleType = '') {
  const currentStatus = normalizeFlowStatus(item?.current?.status, 'PENDING');
  if (currentStatus === 'DEFECT' || currentStatus === 'DELAYED' || currentStatus === 'DISPOSED') {
    return currentStatus;
  }
  const lastOp = getLastOperationForKind(card, kind, sampleType);
  const currentOpId = trimToString(item?.current?.opId || '');
  if (currentStatus === 'GOOD' && (!currentOpId || currentOpId === lastOp.opId)) {
    return 'GOOD';
  }
  return 'PENDING';
}

function updateFinalStatuses(card) {
  if (!card || !card.flow) return false;
  let changed = false;
  if (Array.isArray(card.flow.items)) {
    card.flow.items = card.flow.items.map(item => {
      const finalStatus = computeFinalStatus(card, item, 'ITEM');
      if (item.finalStatus !== finalStatus) {
        changed = true;
        return { ...item, finalStatus };
      }
      return item;
    });
  }
  if (Array.isArray(card.flow.samples)) {
    card.flow.samples = card.flow.samples.map(item => {
      const sampleType = normalizeSampleTypeServer(item?.sampleType);
      const finalStatus = computeFinalStatus(card, item, 'SAMPLE', sampleType);
      if (item.finalStatus !== finalStatus) {
        changed = true;
        return { ...item, finalStatus };
      }
      return item;
    });
  }
  return changed;
}

function findOperationInCard(card, opId) {
  if (!opId) return null;
  const ops = Array.isArray(card.operations) ? card.operations : [];
  return ops.find(op => resolveCardOpIdServer(op) === opId || trimToString(op?.opId) === opId) || null;
}

function normalizeFlowItem(item, kind, index, serials, card, usedSet, localSet, opInfo, sampleType = '') {
  const now = Date.now();
  const next = (item && typeof item === 'object') ? { ...item } : {};
  let changed = false;
  if (!next.id) {
    next.id = genId('it');
    changed = true;
  }
  if (next.kind !== kind) {
    next.kind = kind;
    changed = true;
  }
  if (kind === 'SAMPLE') {
    const normalizedType = normalizeSampleTypeServer(sampleType);
    if (next.sampleType !== normalizedType) {
      next.sampleType = normalizedType;
      changed = true;
    }
  }
  const expectedDisplayName = buildFlowDisplayName(serials, kind, index);
  if (trimToString(next.displayName) !== trimToString(expectedDisplayName)) {
    next.displayName = expectedDisplayName;
    changed = true;
  }
  const extraStatus = normalizeFlowExtraStatus(next.extraStatus, 'PRIMARY');
  if (next.extraStatus !== extraStatus) {
    next.extraStatus = extraStatus;
    changed = true;
  }
  if (!Array.isArray(next.legacyQrs)) {
    next.legacyQrs = [];
    changed = true;
  }
  const prevQr = trimToString(next.qr || '');
  let qrCode = normalizeItemQrCodeServer(next.qrCode || '');
  if (!isValidItemQrCodeServer(qrCode)) {
    qrCode = extractItemQrCodeServer(prevQr, card.qrId || '')
      || extractAnyItemQrCodeServer(prevQr)
      || '';
  }
  if (!isValidItemQrCodeServer(qrCode) || localSet.has(qrCode)) {
    qrCode = generateUniqueItemQrCodeServer(card, localSet);
    changed = true;
  } else {
    localSet.add(qrCode);
  }
  if (next.qrCode !== qrCode) {
    next.qrCode = qrCode;
    changed = true;
  }
  const canonicalQr = buildItemQrServer(card.qrId || '', qrCode);
  if (prevQr && prevQr !== canonicalQr) {
    if (appendLegacyItemQrServer(next, prevQr)) changed = true;
  }
  if (trimToString(next.qr || '') !== canonicalQr) {
    next.qr = canonicalQr;
    changed = true;
  }
  if (!next.createdInCardQr || trimToString(next.createdInCardQr) !== trimToString(card.qrId || '')) {
    next.createdInCardQr = card.qrId || '';
    changed = true;
  }
  if (!next.current || typeof next.current !== 'object') {
    next.current = {
      opId: opInfo.opId,
      opCode: opInfo.opCode,
      status: 'PENDING',
      updatedAt: now
    };
    changed = true;
  } else {
    const status = normalizeFlowStatus(next.current.status, 'PENDING');
    if (next.current.status !== status) {
      next.current.status = status;
      changed = true;
    }
    if (next.current.opId && opInfo.opId) {
      const currentOp = findOperationInCard(card, next.current.opId);
      if (currentOp && status === 'PENDING' && (
        isMaterialIssueOperation(currentOp)
        || isMaterialReturnOperation(currentOp)
        || isDryingOperation(currentOp)
      )) {
        const nextInfo = getNextNonMaterialOpAfter(card, kind, next.current.opId, sampleType);
        const target = nextInfo || opInfo;
        if (target && target.opId) {
          next.current.opId = target.opId;
          next.current.opCode = target.opCode;
          changed = true;
        }
      }
    }
    if (!next.current.opId && opInfo.opId) {
      next.current.opId = opInfo.opId;
      next.current.opCode = opInfo.opCode;
      changed = true;
    }
    if (next.current.opId && !next.current.opCode) {
      const op = findOperationInCard(card, next.current.opId);
      if (op && op.opCode) {
        next.current.opCode = op.opCode;
        changed = true;
      }
    }
    if (!Number.isFinite(next.current.updatedAt)) {
      next.current.updatedAt = now;
      changed = true;
    }
  }
  if (!Array.isArray(next.history)) {
    next.history = [];
    changed = true;
  } else {
    const normalizedHistory = next.history.map(normalizeFlowHistoryEntry);
    if (JSON.stringify(normalizedHistory) !== JSON.stringify(next.history)) {
      next.history = normalizedHistory;
      changed = true;
    }
  }
  const finalStatus = computeFinalStatus(card, next, kind, sampleType);
  if (next.finalStatus !== finalStatus) {
    next.finalStatus = finalStatus;
    changed = true;
  }
  return { item: next, changed };
}

function ensureCardFlow(card, usedSet = new Set()) {
  if (!card || typeof card !== 'object') return { card, changed: false };
  let changed = false;
  const hadVersion = Number.isFinite(card.flow?.version);
  if (!card.flow || typeof card.flow !== 'object') {
    card.flow = { items: [], samples: [], events: [], version: 1 };
    changed = true;
  }
  if (!Array.isArray(card.flow.items)) {
    card.flow.items = [];
    changed = true;
  }
  if (!Array.isArray(card.flow.samples)) {
    card.flow.samples = [];
    changed = true;
  }
  if (!Array.isArray(card.flow.events)) {
    card.flow.events = [];
    changed = true;
  }
  if (!Number.isFinite(card.flow.version)) {
    card.flow.version = 1;
    changed = true;
  }

  const localUsed = new Set();
  const itemSerials = normalizeFlowSerialList(card.itemSerials, toSafeCountServer(card.quantity));
  const currentYear = new Date().getFullYear();
  const sampleSerials = normalizeAutoSampleSerialsServer(
    card.sampleSerials,
    toSafeCountServer(card.sampleCount),
    'К',
    card.routeCardNumber || card.orderNo || '',
    currentYear
  );
  const witnessSerials = normalizeAutoSampleSerialsServer(
    card.witnessSampleSerials,
    toSafeCountServer(card.witnessSampleCount),
    'С',
    card.routeCardNumber || card.orderNo || '',
    currentYear
  );
  if (JSON.stringify(card.sampleSerials || []) !== JSON.stringify(sampleSerials)) {
    card.sampleSerials = sampleSerials.slice();
    changed = true;
  }
  if (JSON.stringify(card.witnessSampleSerials || []) !== JSON.stringify(witnessSerials)) {
    card.witnessSampleSerials = witnessSerials.slice();
    changed = true;
  }

  if (card.flow.items.length === 0 && itemSerials.length) {
    const opInfo = getFirstOperationForKind(card, 'ITEM');
    card.flow.items = itemSerials.map((_, index) => ({
      id: genId('it'),
      kind: 'ITEM',
      displayName: buildFlowDisplayName(itemSerials, 'ITEM', index),
      extraStatus: 'PRIMARY',
      qrCode: generateUniqueItemQrCodeServer(card, localUsed),
      qr: '',
      createdInCardQr: card.qrId || '',
      finalStatus: 'PENDING',
      current: {
        opId: opInfo.opId,
        opCode: opInfo.opCode,
        status: 'PENDING',
        updatedAt: Date.now()
      },
      history: []
    }));
    card.flow.items.forEach(item => {
      item.qr = buildItemQrServer(card.qrId || '', item.qrCode);
    });
    changed = true;
  } else if (card.flow.items.length) {
    const opInfo = getFirstOperationForKind(card, 'ITEM');
    card.flow.items = card.flow.items.map((item, index) => {
      const normalized = normalizeFlowItem(item, 'ITEM', index, itemSerials, card, usedSet, localUsed, opInfo);
      if (normalized.changed) changed = true;
      return normalized.item;
    });
  }

  if (card.flow.samples.length === 0 && (sampleSerials.length || witnessSerials.length)) {
    const controlOp = getFirstOperationForKind(card, 'SAMPLE', 'CONTROL');
    const witnessOp = getFirstOperationForKind(card, 'SAMPLE', 'WITNESS');
    const controlItems = sampleSerials.map((_, index) => ({
      id: genId('it'),
      kind: 'SAMPLE',
      sampleType: 'CONTROL',
      displayName: buildFlowDisplayName(sampleSerials, 'SAMPLE', index),
      extraStatus: 'PRIMARY',
      qrCode: generateUniqueItemQrCodeServer(card, localUsed),
      qr: '',
      createdInCardQr: card.qrId || '',
      finalStatus: 'PENDING',
      current: {
        opId: controlOp.opId,
        opCode: controlOp.opCode,
        status: 'PENDING',
        updatedAt: Date.now()
      },
      history: []
    }));
    const witnessItems = witnessSerials.map((_, index) => ({
      id: genId('it'),
      kind: 'SAMPLE',
      sampleType: 'WITNESS',
      displayName: buildFlowDisplayName(witnessSerials, 'SAMPLE', index),
      extraStatus: 'PRIMARY',
      qrCode: generateUniqueItemQrCodeServer(card, localUsed),
      qr: '',
      createdInCardQr: card.qrId || '',
      finalStatus: 'PENDING',
      current: {
        opId: witnessOp.opId,
        opCode: witnessOp.opCode,
        status: 'PENDING',
        updatedAt: Date.now()
      },
      history: []
    }));
    controlItems.forEach(item => {
      item.qr = buildItemQrServer(card.qrId || '', item.qrCode);
    });
    witnessItems.forEach(item => {
      item.qr = buildItemQrServer(card.qrId || '', item.qrCode);
    });
    card.flow.samples = controlItems.concat(witnessItems);
    changed = true;
  } else if (card.flow.samples.length) {
    let controlIndex = 0;
    let witnessIndex = 0;
    card.flow.samples = card.flow.samples.map(item => {
      const sampleType = normalizeSampleTypeServer(item?.sampleType);
      const serials = sampleType === 'WITNESS' ? witnessSerials : sampleSerials;
      const index = sampleType === 'WITNESS' ? witnessIndex++ : controlIndex++;
      const opInfo = getFirstOperationForKind(card, 'SAMPLE', sampleType);
      const normalized = normalizeFlowItem(item, 'SAMPLE', index, serials, card, usedSet, localUsed, opInfo, sampleType);
      if (normalized.changed) changed = true;
      return normalized.item;
    });
    const hasControl = card.flow.samples.some(item => normalizeSampleTypeServer(item?.sampleType) === 'CONTROL');
    const hasWitness = card.flow.samples.some(item => normalizeSampleTypeServer(item?.sampleType) === 'WITNESS');
    if (!hasControl && sampleSerials.length) {
      card.flow.samples = card.flow.samples.concat(
        sampleSerials.map((_, index) => ({
          id: genId('it'),
          kind: 'SAMPLE',
          sampleType: 'CONTROL',
          displayName: buildFlowDisplayName(sampleSerials, 'SAMPLE', index),
          extraStatus: 'PRIMARY',
          qrCode: generateUniqueItemQrCodeServer(card, localUsed),
          qr: '',
          createdInCardQr: card.qrId || '',
          current: {
            opId: getFirstOperationForKind(card, 'SAMPLE', 'CONTROL').opId,
            opCode: getFirstOperationForKind(card, 'SAMPLE', 'CONTROL').opCode,
            status: 'PENDING',
            updatedAt: Date.now()
          },
          history: []
        }))
      );
      card.flow.samples
        .filter(item => item && item.sampleType === 'CONTROL' && !trimToString(item.qr || ''))
        .forEach(item => {
          item.qr = buildItemQrServer(card.qrId || '', item.qrCode);
        });
      changed = true;
    }
    if (!hasWitness && witnessSerials.length) {
      card.flow.samples = card.flow.samples.concat(
        witnessSerials.map((_, index) => ({
          id: genId('it'),
          kind: 'SAMPLE',
          sampleType: 'WITNESS',
          displayName: buildFlowDisplayName(witnessSerials, 'SAMPLE', index),
          extraStatus: 'PRIMARY',
          qrCode: generateUniqueItemQrCodeServer(card, localUsed),
          qr: '',
          createdInCardQr: card.qrId || '',
          finalStatus: 'PENDING',
          current: {
            opId: getFirstOperationForKind(card, 'SAMPLE', 'WITNESS').opId,
            opCode: getFirstOperationForKind(card, 'SAMPLE', 'WITNESS').opCode,
            status: 'PENDING',
            updatedAt: Date.now()
          },
          history: []
        }))
      );
      card.flow.samples
        .filter(item => item && item.sampleType === 'WITNESS' && !trimToString(item.qr || ''))
        .forEach(item => {
          item.qr = buildItemQrServer(card.qrId || '', item.qrCode);
        });
      changed = true;
    }
  }

  if (updateFinalStatuses(card)) changed = true;

  if (changed && hadVersion) {
    card.flow.version = Math.max(0, card.flow.version || 0) + 1;
  }

  return { card, changed };
}

function ensureFlowForCards(cards = []) {
  const used = new Set();
  let changed = false;
  const updated = (cards || []).map(card => {
    const result = ensureCardFlow(card, used);
    if (result.changed) changed = true;
    return result.card;
  });
  return { cards: updated, changed };
}

function recalcOperationCountersFromFlow(card) {
  if (!card) return;
  const ops = Array.isArray(card.operations) ? card.operations : [];
  const items = Array.isArray(card.flow?.items) ? card.flow.items : [];
  const samples = Array.isArray(card.flow?.samples) ? card.flow.samples : [];
  const opOrderMap = new Map();
  ops.forEach((op, index) => {
    const opId = resolveCardOpIdServer(op);
    if (!opId) return;
    opOrderMap.set(opId, getOperationOrderValueServer(op, index));
  });

  ops.forEach((op, index) => {
    const opId = resolveCardOpIdServer(op);
    if (!opId) return;
    const list = op.isSamples ? getSamplesByType(samples, getOpSampleTypeServer(op)) : items;
    const currentOrder = opOrderMap.get(opId) ?? getOperationOrderValueServer(op, index);
    let pendingOnOp = 0;
    let awaiting = 0;
    let good = 0;
    let defect = 0;
    let delayed = 0;
    let totalOnOp = 0;

    list.forEach(item => {
      if (!item) return;
      const current = item.current || {};
      const currentOpId = trimToString(current.opId);
      const currentStatus = normalizeFlowStatus(current.status, null);

      if (currentStatus === 'DISPOSED') {
        return;
      }

      if (currentOpId === opId) {
        totalOnOp += 1;
        if (currentStatus === 'PENDING') pendingOnOp += 1;
        else if (currentStatus === 'DEFECT') defect += 1;
        else if (currentStatus === 'DELAYED') delayed += 1;
        else if (currentStatus === 'GOOD') good += 1;
        return;
      }

      const lastStatus = getLastRelevantStatusForOpServer(item, opId, opOrderMap);
      if (lastStatus === 'GOOD') good += 1;

      if (currentStatus === 'PENDING' && currentOpId) {
        const order = opOrderMap.get(currentOpId) ?? Number.POSITIVE_INFINITY;
        if (order < currentOrder) awaiting += 1;
      }
    });

    const completed = good + defect + delayed;
    op.flowStats = {
      pendingOnOp,
      awaiting,
      good,
      defect,
      delayed,
      completed,
      totalOnOp
    };
    op.goodCount = good;
    op.scrapCount = defect;
    op.holdCount = delayed;
  });
}

function getOperationOrderValueServer(op, index) {
  const raw = typeof op?.order === 'number' ? op.order : parseFloat(op?.order);
  if (Number.isFinite(raw)) return raw;
  return Number.isFinite(index) ? index + 1 : 0;
}

function buildOperationsIndex(card) {
  const ops = Array.isArray(card.operations) ? card.operations : [];
  const indexed = ops.map((op, index) => ({
    op,
    index,
    opId: resolveCardOpIdServer(op),
    order: getOperationOrderValueServer(op, index),
    isSamples: Boolean(op?.isSamples)
  }));
  indexed.sort((a, b) => (a.order - b.order) || (a.index - b.index));
  return indexed.map((entry, rank) => ({ ...entry, rank }));
}

function buildBlockingMaps(card) {
  const items = Array.isArray(card.flow?.items) ? card.flow.items : [];
  const samples = Array.isArray(card.flow?.samples) ? card.flow.samples : [];
  const blockingItems = new Map();
  const blockingSamples = new Map();

  const addBlocking = (map, item) => {
    const opId = trimToString(item?.current?.opId);
    const status = normalizeFlowStatus(item?.current?.status, null);
    if (!opId || !['PENDING', 'DELAYED', 'DEFECT'].includes(status)) return;
    map.set(opId, (map.get(opId) || 0) + 1);
  };

  items.forEach(item => addBlocking(blockingItems, item));
  samples.forEach(item => addBlocking(blockingSamples, item));

  return { blockingItems, blockingSamples };
}

function buildDryingRowIdServer(issueOpId, itemIndex) {
  return `src:${trimToString(issueOpId)}:${Number.isFinite(Number(itemIndex)) ? Number(itemIndex) : -1}`;
}

function getDryingEntryServer(card, dryingOpId) {
  const entries = Array.isArray(card?.materialIssues) ? card.materialIssues : [];
  return entries.find(entry => trimToString(entry?.opId || '') === trimToString(dryingOpId)) || null;
}

function buildDryingSourceRowsServer(card, dryingOpId) {
  if (!card || !dryingOpId) return [];
  const opsIndex = buildOperationsIndex(card);
  const dryingIndex = opsIndex.findIndex(entry => trimToString(entry?.opId || '') === trimToString(dryingOpId));
  if (dryingIndex < 0) return [];
  const materialIssues = Array.isArray(card.materialIssues) ? card.materialIssues : [];
  const issuesByOpId = new Map(materialIssues.map(entry => [trimToString(entry?.opId || ''), entry]));
  const createdAt = Date.now();
  const rows = [];
  opsIndex.forEach((entry, idx) => {
    if (idx >= dryingIndex) return;
    if (!entry?.op || !isMaterialIssueOperation(entry.op) || entry.op.status !== 'DONE') return;
    const issueEntry = issuesByOpId.get(trimToString(entry.opId));
    const items = Array.isArray(issueEntry?.items) ? issueEntry.items : [];
    items.forEach((item, itemIndex) => {
      if (!item || !item.isPowder) return;
      rows.push({
        rowId: buildDryingRowIdServer(entry.opId, itemIndex),
        sourceIssueOpId: trimToString(entry.opId),
        sourceItemIndex: itemIndex,
        name: trimToString(item.name || ''),
        qty: trimToString(item.qty || ''),
        unit: trimToString(item.unit || 'кг') || 'кг',
        isPowder: true,
        dryQty: '',
        dryResultQty: '',
        status: 'NOT_STARTED',
        startedAt: null,
        finishedAt: null,
        createdAt,
        updatedAt: createdAt
      });
    });
  });
  return rows;
}

function mergeDryingRowsServer(existingRows, sourceRows) {
  const baseRows = Array.isArray(existingRows) ? existingRows.slice() : [];
  const sourceList = Array.isArray(sourceRows) ? sourceRows : [];
  const knownIds = new Set(baseRows.map(row => trimToString(row?.rowId || '')).filter(Boolean));
  sourceList.forEach(row => {
    const rowId = trimToString(row?.rowId || '');
    if (!rowId || knownIds.has(rowId)) return;
    baseRows.push(row);
    knownIds.add(rowId);
  });
  return baseRows;
}

function ensureDryingEntryServer(card, dryingOpId, updatedBy = '') {
  if (!card || !dryingOpId) return null;
  card.materialIssues = Array.isArray(card.materialIssues) ? card.materialIssues : [];
  const entryIndex = card.materialIssues.findIndex(entry => trimToString(entry?.opId || '') === trimToString(dryingOpId));
  const existing = entryIndex >= 0 ? card.materialIssues[entryIndex] : null;
  const sourceRows = buildDryingSourceRowsServer(card, dryingOpId);
  const next = {
    opId: trimToString(dryingOpId),
    updatedAt: Date.now(),
    updatedBy: trimToString(updatedBy || existing?.updatedBy || ''),
    items: Array.isArray(existing?.items) ? existing.items : [],
    dryingRows: Array.isArray(existing?.dryingRows) && existing.dryingRows.length
      ? mergeDryingRowsServer(existing.dryingRows, sourceRows)
      : sourceRows
  };
  if (entryIndex >= 0) card.materialIssues[entryIndex] = next;
  else card.materialIssues.push(next);
  return next;
}

function recalcProductionStateFromFlow(card) {
  if (!card || typeof card !== 'object') return false;
  const usesFlow = card.cardType === 'MKI';
  const opsIndex = buildOperationsIndex(card);
  if (!opsIndex.length) return false;
  const approvalStage = trimToString(card.approvalStage || '').toUpperCase();
  if (approvalStage === 'DRAFT') {
    let changed = false;
    opsIndex.forEach(entry => {
      const op = entry.op;
      if (!op) return;
      if (op.status !== 'NOT_STARTED') {
        op.status = 'NOT_STARTED';
        changed = true;
      }
      if (op.startedAt || op.finishedAt || op.lastPausedAt) {
        op.startedAt = null;
        op.finishedAt = null;
        op.lastPausedAt = null;
        changed = true;
      }
      if (op.elapsedSeconds || op.actualSeconds) {
        op.elapsedSeconds = 0;
        op.actualSeconds = 0;
        changed = true;
      }
      if (op.goodCount || op.scrapCount || op.holdCount) {
        op.goodCount = 0;
        op.scrapCount = 0;
        op.holdCount = 0;
        changed = true;
      }
      op.canStart = false;
      op.canPause = false;
      op.canResume = false;
      op.canComplete = false;
    });
    if (changed) recalcCardProductionStatus(card);
    recalcOperationCountersFromFlow(card);
    return changed;
  }
  const items = Array.isArray(card.flow?.items) ? card.flow.items : [];
  const samples = Array.isArray(card.flow?.samples) ? card.flow.samples : [];
  const opOrderMap = getOperationOrderMapServer(card);
  const goodItemsByOpId = new Map();
  const markGood = (opId) => {
    const key = trimToString(opId);
    if (!key) return;
    goodItemsByOpId.set(key, true);
  };
  const getSampleStatusSummaryForOp = (opId, sampleType) => {
    const targetOpId = trimToString(opId);
    const targetType = normalizeSampleTypeServer(sampleType);
    let total = 0;
    let good = 0;
    let resolved = 0;
    samples.forEach(item => {
      if (!item || normalizeSampleTypeServer(item?.sampleType) !== targetType) return;
      const current = item.current || {};
      const currentOpId = trimToString(current.opId);
      const currentStatus = normalizeFlowStatus(current.status, null);
      if (currentOpId === targetOpId) {
        total += 1;
        if (currentStatus === 'GOOD') good += 1;
        if (currentStatus === 'GOOD' || currentStatus === 'DISPOSED') resolved += 1;
        return;
      }
      const lastStatus = getLastRelevantStatusForOpServer(item, targetOpId, opOrderMap);
      if (lastStatus) {
        total += 1;
        if (lastStatus === 'GOOD') good += 1;
        if (lastStatus === 'GOOD' || lastStatus === 'DISPOSED') resolved += 1;
      }
    });
    return { total, good, resolved };
  };

  items.forEach(item => {
    if (!item) return;
    const current = item.current || {};
    const currentOpId = trimToString(current.opId);
    const currentStatus = normalizeFlowStatus(current.status, null);
    if (currentStatus === 'GOOD' && currentOpId) {
      markGood(currentOpId);
    }
    const lastStatusByOp = getLastRelevantStatusesByOpServer(item, opOrderMap);
    lastStatusByOp.forEach((status, opId) => {
      if (status === 'GOOD') markGood(opId);
    });
  });

  const getPrevItemOpId = (index) => {
    for (let i = index - 1; i >= 0; i -= 1) {
      const prev = opsIndex[i];
      if (prev && !prev.isSamples) return prev.opId || null;
    }
    return null;
  };
  const { blockingItems, blockingSamples } = buildBlockingMaps(card);
  const materialIssues = Array.isArray(card.materialIssues) ? card.materialIssues : [];
  const issuedByOpId = new Map(
    materialIssues.map(entry => [
      trimToString(entry?.opId),
      Array.isArray(entry?.items) && entry.items.length > 0
    ])
  );
  const unissuedMaterialIndex = opsIndex.findIndex(entry => (
    entry?.op
    && isMaterialIssueOperation(entry.op)
    && !issuedByOpId.get(trimToString(entry.opId))
  ));
  const returnOpIndex = opsIndex.findIndex(entry => entry?.op && isMaterialReturnOperation(entry.op));
  const returnOpEntry = returnOpIndex >= 0 ? opsIndex[returnOpIndex] : null;
  const returnCompletedOnce = Boolean(returnOpEntry?.op?.returnCompletedOnce || returnOpEntry?.op?.status === 'DONE');
  const hasIssueInProgress = opsIndex.some(entry => entry?.op && isMaterialIssueOperation(entry.op) && entry.op.status === 'IN_PROGRESS');
  const hasReturnInProgress = opsIndex.some(entry => entry?.op && isMaterialReturnOperation(entry.op) && entry.op.status === 'IN_PROGRESS');
  const dryingStateByOpId = new Map(
    opsIndex
      .filter(entry => entry?.op && isDryingOperation(entry.op))
      .map(entry => {
        const entryOpId = trimToString(entry?.opId || '');
        const dryingEntry = getDryingEntryServer(card, entryOpId);
        const sourceRows = buildDryingSourceRowsServer(card, entryOpId);
        const dryingRows = Array.isArray(dryingEntry?.dryingRows) && dryingEntry.dryingRows.length
          ? mergeDryingRowsServer(dryingEntry.dryingRows, sourceRows)
          : sourceRows;
        return [entryOpId, {
          rows: dryingRows,
          hasRows: dryingRows.length > 0,
          hasActive: dryingRows.some(row => trimToString(row?.status || '').toUpperCase() === 'IN_PROGRESS'),
          hasDone: dryingRows.some(row => trimToString(row?.status || '').toUpperCase() === 'DONE')
        }];
      })
  );
  let changed = false;

  opsIndex.forEach((entry, idx) => {
    const op = entry.op;
    if (!op) return;
    const isMaterialIssue = isMaterialIssueOperation(op);
    const isMaterialReturn = isMaterialReturnOperation(op);
    const isDrying = isDryingOperation(op);
    const isControlSample = entry.isSamples && getOpSampleTypeServer(op) === 'CONTROL';
    const isWitnessSample = entry.isSamples && getOpSampleTypeServer(op) === 'WITNESS';

    const opId = entry.opId;
    const pendingOnOp = isDrying
      ? 0
      : (entry.isSamples
        ? samples.reduce((sum, item) => (
          sum + (trimToString(item?.current?.opId) === opId && normalizeFlowStatus(item?.current?.status, null) === 'PENDING' ? 1 : 0)
        ), 0)
        : items.reduce((sum, item) => (
          sum + (trimToString(item?.current?.opId) === opId && normalizeFlowStatus(item?.current?.status, null) === 'PENDING' ? 1 : 0)
        ), 0));

    let blockingBeforeAny = 0;
    let blockingBeforeSamples = 0;
    let blockingBeforeItems = 0;
    let relaxedBlockingSamples = 0;
    let nearestPrevWitnessOpId = null;
    let nearestPrevWitnessHasGood = false;
    let nearestPrevControlOpId = null;
    let nearestPrevControlAllResolved = false;
    let hasAnyPrevMaterialIssue = false;
    let hasIssuedPrevMaterialIssue = false;
    for (let i = 0; i < idx; i += 1) {
      const prev = opsIndex[i];
      if (!prev?.opId) continue;
      const prevSamples = blockingSamples.get(prev.opId) || 0;
      const prevItems = blockingItems.get(prev.opId) || 0;
      blockingBeforeAny += prevSamples + prevItems;
      if (prev.isSamples) blockingBeforeSamples += prevSamples;
      else blockingBeforeItems += prevItems;
      if (prev?.op && isMaterialIssueOperation(prev.op)) {
        hasAnyPrevMaterialIssue = true;
        if (issuedByOpId.get(trimToString(prev.opId))) hasIssuedPrevMaterialIssue = true;
      }
      if (prev?.op && prev.isSamples) {
        const prevSampleType = getOpSampleTypeServer(prev.op);
        if (prevSampleType === 'WITNESS') {
          nearestPrevWitnessOpId = prev.opId;
        } else if (prevSampleType === 'CONTROL') {
          nearestPrevControlOpId = prev.opId;
        }
      }
    }
    if (nearestPrevWitnessOpId) {
      const witnessSummary = getSampleStatusSummaryForOp(nearestPrevWitnessOpId, 'WITNESS');
      nearestPrevWitnessHasGood = witnessSummary.good > 0;
      if (nearestPrevWitnessHasGood) {
        relaxedBlockingSamples = blockingSamples.get(nearestPrevWitnessOpId) || 0;
      }
    }
    if (nearestPrevControlOpId) {
      const controlSummary = getSampleStatusSummaryForOp(nearestPrevControlOpId, 'CONTROL');
      nearestPrevControlAllResolved = controlSummary.total === 0 || controlSummary.resolved === controlSummary.total;
    }

    const effectiveBlockingBeforeSamples = Math.max(0, blockingBeforeSamples - relaxedBlockingSamples);
    const blockedBySamples = effectiveBlockingBeforeSamples > 0;
    const blockedByItems = blockingBeforeItems > 0;
    const witnessRelaxed = isWitnessSample
      && goodItemsByOpId.get(getPrevItemOpId(idx));
    const blockedByMaterialIssue = isControlSample
      ? (hasAnyPrevMaterialIssue && !hasIssuedPrevMaterialIssue)
      : (!isMaterialIssue && unissuedMaterialIndex >= 0 && idx > unissuedMaterialIndex);
    const blockedByMaterialReturn = isControlSample
      ? false
      : (!isMaterialReturn && returnOpIndex >= 0 && idx > returnOpIndex && !returnCompletedOnce);
    const blockedByDrying = !isMaterialReturn && opsIndex.some((prev, prevIndex) => (
      prevIndex < idx
      && prev?.op
      && isDryingOperation(prev.op)
      && !dryingStateByOpId.get(trimToString(prev?.opId || ''))?.hasDone
    ));
    const blockedByPrevControl = isControlSample && nearestPrevControlOpId
      ? !nearestPrevControlAllResolved
      : false;
    const blockedByFlow = (isMaterialReturn || isDrying)
      ? false
      : (isControlSample
        ? blockedByPrevControl
        : (entry.isSamples
          ? (blockedBySamples || (blockedByItems && !witnessRelaxed))
          : blockedBySamples));
    const dryingState = dryingStateByOpId.get(opId) || { rows: [], hasRows: false, hasActive: false, hasDone: false };
    const dryingRows = dryingState.rows;
    const hasDryingRows = dryingState.hasRows;
    const hasDryingActive = dryingState.hasActive;
    const hasDryingDone = dryingState.hasDone;
    const prevMaterialIssueOps = isDrying
      ? opsIndex.filter((item, itemIndex) => itemIndex < idx && item?.op && isMaterialIssueOperation(item.op))
      : [];
    const allPrevMaterialIssuesDone = !isDrying
      ? true
      : (prevMaterialIssueOps.length > 0 && prevMaterialIssueOps.every(item => item.op.status === 'DONE'));
    const isBlockedForStart = blockedByMaterialIssue || blockedByMaterialReturn || blockedByFlow || blockedByDrying;
    const wasStarted = Boolean(op.firstStartedAt || op.startedAt || op.finishedAt);
    const storedSeconds = Number.isFinite(Number(op.elapsedSeconds))
      ? Number(op.elapsedSeconds)
      : (Number.isFinite(Number(op.actualSeconds)) ? Number(op.actualSeconds) : 0);
    const hasTime = storedSeconds > 0;
    const hasPrevIssueDone = isMaterialReturn
      ? opsIndex.some((item, itemIndex) => (
        itemIndex < idx
        && item?.op
        && isMaterialIssueOperation(item.op)
        && item.op.status === 'DONE'
      ))
      : true;
    const allOtherOpsDone = isMaterialIssue
      ? opsIndex.every(item => {
        if (!item?.op) return true;
        if (isMaterialIssueOperation(item.op)) return true;
        return item.op.status === 'DONE';
      })
      : false;

    let nextState = op.status || 'NOT_STARTED';
    if (usesFlow) {
      if (isMaterialIssue || isMaterialReturn) {
        nextState = op.status || 'NOT_STARTED';
      } else if (isDrying) {
        nextState = hasDryingActive
          ? 'IN_PROGRESS'
          : ((op.dryingCompletedManually === true && hasDryingDone) ? 'DONE' : 'NOT_STARTED');
      } else if (op.status === 'PAUSED' && pendingOnOp > 0) {
        nextState = 'PAUSED';
      } else if (op.status === 'IN_PROGRESS' && pendingOnOp > 0) {
        nextState = 'IN_PROGRESS';
      } else if (pendingOnOp > 0) {
        nextState = 'NOT_STARTED';
      } else {
        const blockingBeforeForStatus = entry.isSamples
          ? effectiveBlockingBeforeSamples
          : blockingBeforeAny;
        if (wasStarted && blockingBeforeForStatus > 0 && hasTime) {
          nextState = 'NO_ITEMS';
        } else if (wasStarted && blockingBeforeForStatus === 0) {
          nextState = 'DONE';
        } else {
          nextState = 'NOT_STARTED';
        }
      }
    }

    const blockedReasons = [];
    if (usesFlow) {
      if (blockedByMaterialIssue) {
        blockedReasons.push('Материал не выдан.');
      }
      if (blockedByMaterialReturn) {
        blockedReasons.push('Возврат материала не завершен.');
      }
      if (blockedByDrying) {
        blockedReasons.push('Предыдущая операция «Сушка» не завершена.');
      }
      if (isMaterialIssue && allOtherOpsDone) {
        blockedReasons.push('Операция «Получение материала» недоступна: все остальные операции завершены.');
      }
      if (isMaterialReturn && !hasPrevIssueDone) {
        blockedReasons.push('Нет завершенной операции «Получение материала» перед возвратом.');
      }
      if (isDrying && !allPrevMaterialIssuesDone) {
        blockedReasons.push('Нет завершенных операций «Получение материала» перед сушкой.');
      }
      if (isDrying && !hasDryingRows) {
        blockedReasons.push('Нет выданного порошка для сушки.');
      }
      if (isMaterialIssue && hasReturnInProgress) {
        blockedReasons.push('Операция «Возврат материала» уже в работе.');
      }
      if (isMaterialReturn && hasIssueInProgress) {
        blockedReasons.push('Операция «Получение материала» уже в работе.');
      }
      if (entry.isSamples) {
        if (isControlSample) {
          if (blockedByPrevControl) blockedReasons.push('На предыдущей операции есть ОК со статусами «В ожидании», «Задержано» или «Брак».');
        } else {
          if (blockedBySamples) blockedReasons.push('На предыдущих операциях есть образцы со статусами «В ожидании», «Задержано» или «Брак».');
          if (blockedByItems && !witnessRelaxed) blockedReasons.push('На предыдущих операциях есть изделия со статусами «В ожидании», «Задержано» или «Брак».');
        }
      } else if (!isDrying && blockedBySamples) {
        blockedReasons.push('На предыдущих операциях есть образцы со статусами «В ожидании», «Задержано» или «Брак».');
      }
      if (!isMaterialIssue && !isMaterialReturn && !isDrying && pendingOnOp === 0) {
        blockedReasons.push(entry.isSamples ? 'Нет образцов на операции.' : 'Нет изделий на операции.');
      }
    }

    const canStart = usesFlow
      ? (isMaterialIssue
        ? ((nextState === 'NOT_STARTED' || nextState === 'DONE') && !allOtherOpsDone && !hasReturnInProgress)
        : (isMaterialReturn
          ? ((nextState === 'NOT_STARTED' || nextState === 'DONE') && hasPrevIssueDone && !hasIssueInProgress && !isBlockedForStart)
          : (isDrying
            ? (allPrevMaterialIssuesDone && hasDryingRows && !blockedByMaterialIssue && !blockedByMaterialReturn && !blockedByDrying)
            : (nextState === 'NOT_STARTED' && pendingOnOp > 0 && !isBlockedForStart))))
      : (nextState === 'NOT_STARTED');
    const canPause = isDrying ? false : (nextState === 'IN_PROGRESS');
    const canResume = isDrying
      ? false
      : (nextState === 'PAUSED' && (!usesFlow || (!blockedByFlow && ((isMaterialIssue || isMaterialReturn) || pendingOnOp > 0))));
    const canComplete = usesFlow
      ? (isDrying
        ? false
        : (nextState === 'IN_PROGRESS' && ((isMaterialIssue || isMaterialReturn) || (pendingOnOp > 0 && !blockedByFlow))))
      : (nextState === 'IN_PROGRESS');

    if (op.status !== nextState) {
      op.status = nextState;
      changed = true;
    }

    if (nextState !== 'IN_PROGRESS' && op.startedAt) {
      const now = Date.now();
      const diff = (now - op.startedAt) / 1000;
      const base = Number.isFinite(op.elapsedSeconds) ? op.elapsedSeconds : 0;
      op.elapsedSeconds = base + diff;
      op.startedAt = null;
      changed = true;
    }

    if (op.pendingCount !== pendingOnOp) {
      op.pendingCount = pendingOnOp;
      changed = true;
    }
    op.blocked = Boolean(isBlockedForStart);
    op.blockedReasons = blockedReasons;
    op.canStart = Boolean(canStart);
    op.canPause = Boolean(canPause);
    op.canResume = Boolean(canResume);
    op.canComplete = Boolean(canComplete);

  });

  if (changed) {
    recalcCardProductionStatus(card);
  }

  recalcOperationCountersFromFlow(card);

  return changed;
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

function normalizeProductionShiftTimeEntryServer(item, fallbackShift = 1) {
  return {
    shift: Number.isFinite(parseInt(item?.shift, 10)) ? Math.max(1, parseInt(item.shift, 10)) : fallbackShift,
    timeFrom: normalizeTimeString(item?.timeFrom) || '00:00',
    timeTo: normalizeTimeString(item?.timeTo) || '00:00',
    lunchFrom: normalizeTimeString(item?.lunchFrom) || '',
    lunchTo: normalizeTimeString(item?.lunchTo) || ''
  };
}

function normalizeProductionShiftTimes(raw) {
  const defaults = [
    { shift: 1, timeFrom: '08:00', timeTo: '16:00', lunchFrom: '', lunchTo: '' },
    { shift: 2, timeFrom: '16:00', timeTo: '00:00', lunchFrom: '', lunchTo: '' },
    { shift: 3, timeFrom: '00:00', timeTo: '08:00', lunchFrom: '', lunchTo: '' }
  ];
  const incoming = Array.isArray(raw) ? raw : [];
  const normalized = incoming
    .map((item, index) => normalizeProductionShiftTimeEntryServer(item, index + 1))
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
  const assignmentStatus = areaId === '__shift_master__'
    ? 'SHIFT_MASTER'
    : (trimToString(entry?.assignmentStatus).toUpperCase() === 'SHIFT_MASTER' ? 'SHIFT_MASTER' : '');
  return {
    date,
    shift,
    areaId,
    employeeId,
    timeFrom: normalizeTimeString(entry?.timeFrom),
    timeTo: normalizeTimeString(entry?.timeTo),
    assignmentStatus
  };
}

function normalizeProductionSchedule(raw, shiftTimes = []) {
  const entries = Array.isArray(raw) ? raw.map(normalizeProductionScheduleEntry) : [];
  const deduped = [];
  const usedKeys = new Set();
  entries.forEach(item => {
    if (!item.date || !item.areaId || !item.employeeId || !item.shift) return;
    const key = `${item.date}|${item.shift}|${item.areaId}|${item.employeeId}`;
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
  const plannedPartMinutes = Number(entry?.plannedPartMinutes);
  const plannedTotalMinutes = Number(entry?.plannedTotalMinutes);
  const plannedPartQty = Number(entry?.plannedPartQty);
  const plannedTotalQty = Number(entry?.plannedTotalQty);
  const minutesPerUnitSnapshot = Number(entry?.minutesPerUnitSnapshot);
  const remainingQtySnapshot = Number(entry?.remainingQtySnapshot);
  const plannedStartAt = Number(entry?.plannedStartAt);
  const plannedEndAt = Number(entry?.plannedEndAt);
  const sourceShift = Number(entry?.sourceShift);
  const delayMinutes = Number(entry?.delayMinutes);
  const lastPartialBatchApplied = entry?.lastPartialBatchApplied === true;
  const workSegmentKey = trimToString(entry?.workSegmentKey);
  return {
    id: trimToString(entry?.id) || genId('pst'),
    cardId: trimToString(entry?.cardId),
    routeOpId: trimToString(entry?.routeOpId),
    opId: trimToString(entry?.opId),
    opName: trimToString(entry?.opName),
    date,
    shift,
    areaId: trimToString(entry?.areaId),
    subcontractChainId: trimToString(entry?.subcontractChainId),
    subcontractItemIds: normalizeSubcontractItemIdsServer(entry?.subcontractItemIds),
    subcontractItemKind: trimToString(entry?.subcontractItemKind).toUpperCase(),
    subcontractExtendedChain: entry?.subcontractExtendedChain === true,
    plannedPartMinutes: Number.isFinite(plannedPartMinutes) && plannedPartMinutes > 0 ? plannedPartMinutes : undefined,
    plannedPartQty: Number.isFinite(plannedPartQty) && plannedPartQty > 0 ? plannedPartQty : undefined,
    plannedTotalQty: Number.isFinite(plannedTotalQty) && plannedTotalQty > 0 ? plannedTotalQty : undefined,
    minutesPerUnitSnapshot: Number.isFinite(minutesPerUnitSnapshot) && minutesPerUnitSnapshot > 0 ? minutesPerUnitSnapshot : undefined,
    remainingQtySnapshot: Number.isFinite(remainingQtySnapshot) && remainingQtySnapshot > 0 ? remainingQtySnapshot : undefined,
    planningMode: trimToString(entry?.planningMode).toUpperCase() === 'AUTO' ? 'AUTO' : 'MANUAL',
    autoPlanRunId: trimToString(entry?.autoPlanRunId),
    workSegmentKey,
    plannedStartAt: Number.isFinite(plannedStartAt) && plannedStartAt > 0 ? plannedStartAt : undefined,
    plannedEndAt: Number.isFinite(plannedEndAt) && plannedEndAt > 0 ? plannedEndAt : undefined,
    sourceShiftDate: /^\d{4}-\d{2}-\d{2}$/.test(trimToString(entry?.sourceShiftDate)) ? trimToString(entry.sourceShiftDate) : '',
    sourceShift: Number.isFinite(sourceShift) && sourceShift > 0 ? Math.max(1, parseInt(sourceShift, 10)) : undefined,
    fromShiftCloseTransfer: entry?.fromShiftCloseTransfer === true,
    shiftCloseSourceDate: /^\d{4}-\d{2}-\d{2}$/.test(trimToString(entry?.shiftCloseSourceDate)) ? trimToString(entry.shiftCloseSourceDate) : '',
    shiftCloseSourceShift: Number.isFinite(Number(entry?.shiftCloseSourceShift))
      ? Math.max(1, parseInt(entry.shiftCloseSourceShift, 10) || 1)
      : undefined,
    closePagePreview: entry?.closePagePreview === true,
    closePageRecordId: trimToString(entry?.closePageRecordId),
    closePageRowKey: trimToString(entry?.closePageRowKey),
    delayMinutes: Number.isFinite(delayMinutes) && delayMinutes >= 0 ? Math.max(0, parseInt(delayMinutes, 10)) : undefined,
    effectiveDeadlineSnapshot: /^\d{4}-\d{2}-\d{2}$/.test(trimToString(entry?.effectiveDeadlineSnapshot)) ? trimToString(entry.effectiveDeadlineSnapshot) : '',
    cardPlannedCompletionDateSnapshot: /^\d{4}-\d{2}-\d{2}$/.test(trimToString(entry?.cardPlannedCompletionDateSnapshot)) ? trimToString(entry.cardPlannedCompletionDateSnapshot) : '',
    lastPartialBatchApplied,
    lastPartialBatchReason: lastPartialBatchApplied ? trimToString(entry?.lastPartialBatchReason) : '',
    plannedTotalMinutes: Number.isFinite(plannedTotalMinutes) && plannedTotalMinutes > 0 ? plannedTotalMinutes : undefined,
    isPartial: entry?.isPartial === true || (
      Number.isFinite(plannedPartMinutes) &&
      plannedPartMinutes > 0 &&
      Number.isFinite(plannedTotalMinutes) &&
      plannedTotalMinutes > 0 &&
      plannedPartMinutes < plannedTotalMinutes
    ),
    createdAt: typeof entry?.createdAt === 'number' ? entry.createdAt : Date.now(),
    createdBy: trimToString(entry?.createdBy)
  };
}

function getProductionShiftTaskMergeKeyServer(task) {
  const cardId = trimToString(task?.cardId);
  const routeOpId = trimToString(task?.routeOpId);
  const date = trimToString(task?.date);
  const shift = parseInt(task?.shift, 10) || 1;
  const areaId = trimToString(task?.areaId);
  const subcontractChainId = trimToString(task?.subcontractChainId);
  const workSegmentKey = trimToString(task?.workSegmentKey);
  const isPreview = task?.closePagePreview === true;
  const previewRowKey = trimToString(task?.closePageRowKey);
  return isPreview
    ? `${cardId}|${routeOpId}|${date}|${shift}|${areaId}|${subcontractChainId}|${workSegmentKey}|preview|${previewRowKey}`
    : `${cardId}|${routeOpId}|${date}|${shift}|${areaId}|${subcontractChainId}|${workSegmentKey}`;
}

function getProductionShiftTaskMinutesForMergeServer(task) {
  const plannedPart = Number(task?.plannedPartMinutes);
  if (Number.isFinite(plannedPart) && plannedPart > 0) return plannedPart;
  const plannedTotal = Number(task?.plannedTotalMinutes);
  if (Number.isFinite(plannedTotal) && plannedTotal > 0) return plannedTotal;
  return 0;
}

function getProductionShiftTaskSortRefServer(task) {
  return {
    createdAt: Number.isFinite(Number(task?.createdAt)) ? Number(task.createdAt) : Number.MAX_SAFE_INTEGER,
    id: trimToString(task?.id)
  };
}

function pickPrimaryProductionShiftTaskServer(tasks, preferredTaskId = '') {
  const list = Array.isArray(tasks) ? tasks.filter(Boolean) : [];
  if (!list.length) return null;
  const preferred = preferredTaskId
    ? list.find(item => trimToString(item?.id) === trimToString(preferredTaskId))
    : null;
  if (preferred) return preferred;
  return list.slice().sort((a, b) => {
    const refA = getProductionShiftTaskSortRefServer(a);
    const refB = getProductionShiftTaskSortRefServer(b);
    if (refA.createdAt !== refB.createdAt) return refA.createdAt - refB.createdAt;
    return refA.id.localeCompare(refB.id);
  })[0];
}

function mergeProductionShiftTaskEntriesServer(tasks, { preferredTaskId = '' } = {}) {
  const list = Array.isArray(tasks) ? tasks.filter(Boolean) : [];
  if (!list.length) return null;
  const primary = pickPrimaryProductionShiftTaskServer(list, preferredTaskId) || list[0];
  const earliest = list.reduce((acc, item) => {
    if (!acc) return item;
    const refAcc = getProductionShiftTaskSortRefServer(acc);
    const refItem = getProductionShiftTaskSortRefServer(item);
    if (refItem.createdAt !== refAcc.createdAt) return refItem.createdAt < refAcc.createdAt ? item : acc;
    return refItem.id.localeCompare(refAcc.id) < 0 ? item : acc;
  }, null);
  const plannedPartMinutes = list.reduce((sum, item) => sum + getProductionShiftTaskMinutesForMergeServer(item), 0);
  const plannedPartQty = roundPlanningQtyServer(list.reduce((sum, item) => {
    const value = Number(item?.plannedPartQty);
    return sum + (Number.isFinite(value) && value > 0 ? value : 0);
  }, 0));
  const plannedTotalMinutes = list.reduce((max, item) => {
    const value = Number(item?.plannedTotalMinutes);
    return Number.isFinite(value) && value > max ? value : max;
  }, 0);
  const plannedTotalQty = roundPlanningQtyServer(list.reduce((max, item) => {
    const value = Number(item?.plannedTotalQty);
    return Number.isFinite(value) && value > max ? value : max;
  }, 0));
  const minutesPerUnitSnapshot = list.reduce((value, item) => {
    if (value > 0) return value;
    const candidate = Number(item?.minutesPerUnitSnapshot);
    return Number.isFinite(candidate) && candidate > 0 ? candidate : 0;
  }, 0);
  const remainingQtySnapshot = roundPlanningQtyServer(list.reduce((max, item) => {
    const value = Number(item?.remainingQtySnapshot);
    return Number.isFinite(value) && value > max ? value : max;
  }, 0));
  return {
    ...primary,
    id: trimToString(primary?.id) || genId('pst'),
    cardId: trimToString(primary?.cardId),
    routeOpId: trimToString(primary?.routeOpId),
    opId: trimToString(primary?.opId) || trimToString(list.find(item => item?.opId)?.opId),
    opName: trimToString(primary?.opName) || trimToString(list.find(item => item?.opName)?.opName),
    date: trimToString(primary?.date),
    shift: parseInt(primary?.shift, 10) || 1,
    areaId: trimToString(primary?.areaId),
    subcontractChainId: trimToString(primary?.subcontractChainId),
    subcontractItemIds: normalizeSubcontractItemIdsServer(list.flatMap(item => normalizeSubcontractItemIdsServer(item?.subcontractItemIds))),
    subcontractItemKind: trimToString(primary?.subcontractItemKind).toUpperCase(),
    subcontractExtendedChain: list.some(item => item?.subcontractExtendedChain === true),
    plannedPartMinutes: plannedPartMinutes > 0 ? plannedPartMinutes : undefined,
    plannedPartQty: plannedPartQty > 0 ? plannedPartQty : undefined,
    plannedTotalMinutes: plannedTotalMinutes > 0 ? plannedTotalMinutes : undefined,
    plannedTotalQty: plannedTotalQty > 0 ? plannedTotalQty : undefined,
    minutesPerUnitSnapshot: minutesPerUnitSnapshot > 0 ? minutesPerUnitSnapshot : undefined,
    remainingQtySnapshot: remainingQtySnapshot > 0 ? remainingQtySnapshot : undefined,
    planningMode: trimToString(primary?.planningMode).toUpperCase() === 'AUTO' ? 'AUTO' : 'MANUAL',
    autoPlanRunId: trimToString(primary?.autoPlanRunId),
    workSegmentKey: trimToString(primary?.workSegmentKey),
    plannedStartAt: Number.isFinite(Number(primary?.plannedStartAt)) ? Number(primary.plannedStartAt) : undefined,
    plannedEndAt: Number.isFinite(Number(primary?.plannedEndAt)) ? Number(primary.plannedEndAt) : undefined,
    sourceShiftDate: trimToString(primary?.sourceShiftDate),
    sourceShift: Number.isFinite(Number(primary?.sourceShift)) ? (parseInt(primary.sourceShift, 10) || 1) : undefined,
    fromShiftCloseTransfer: list.some(item => item?.fromShiftCloseTransfer === true),
    shiftCloseSourceDate: trimToString(primary?.shiftCloseSourceDate),
    shiftCloseSourceShift: Number.isFinite(Number(primary?.shiftCloseSourceShift))
      ? (parseInt(primary.shiftCloseSourceShift, 10) || 1)
      : undefined,
    closePagePreview: primary?.closePagePreview === true,
    closePageRecordId: trimToString(primary?.closePageRecordId),
    closePageRowKey: trimToString(primary?.closePageRowKey),
    delayMinutes: Number.isFinite(Number(primary?.delayMinutes)) ? Math.max(0, parseInt(primary.delayMinutes, 10) || 0) : undefined,
    effectiveDeadlineSnapshot: trimToString(primary?.effectiveDeadlineSnapshot),
    cardPlannedCompletionDateSnapshot: trimToString(primary?.cardPlannedCompletionDateSnapshot),
    lastPartialBatchApplied: primary?.lastPartialBatchApplied === true,
    lastPartialBatchReason: primary?.lastPartialBatchApplied === true ? trimToString(primary?.lastPartialBatchReason) : '',
    isPartial: plannedTotalMinutes > 0 ? plannedPartMinutes < plannedTotalMinutes : false,
    createdAt: Number.isFinite(Number(earliest?.createdAt)) ? Number(earliest.createdAt) : (Number(primary?.createdAt) || Date.now()),
    createdBy: trimToString(earliest?.createdBy) || trimToString(primary?.createdBy)
  };
}

function mergeProductionShiftTasksServer(raw, data = null) {
  const entries = Array.isArray(raw) ? raw.map(normalizeProductionShiftTask) : [];
  const groups = new Map();
  entries.forEach(item => {
    const key = data && !canMutateExistingShiftTaskServer(data, item)
      ? `${getProductionShiftTaskMergeKeyServer(item)}|${trimToString(item?.id)}`
      : getProductionShiftTaskMergeKeyServer(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  const merged = [];
  entries.forEach(item => {
    const key = data && !canMutateExistingShiftTaskServer(data, item)
      ? `${getProductionShiftTaskMergeKeyServer(item)}|${trimToString(item?.id)}`
      : getProductionShiftTaskMergeKeyServer(item);
    const group = groups.get(key);
    if (!group) return;
    merged.push(group.length === 1 ? group[0] : mergeProductionShiftTaskEntriesServer(group, {
      preferredTaskId: trimToString(group[0]?.id)
    }));
    groups.delete(key);
  });
  return merged;
}

function normalizeProductionShiftTasks(raw, shiftTimes = [], productionShifts = []) {
  const entries = mergeProductionShiftTasksServer(raw, {
    productionShiftTimes: shiftTimes,
    productionShifts
  });
  const validShifts = new Set((shiftTimes || []).map(s => s.shift));
  return entries.filter(item => {
    if (!item.cardId || !item.routeOpId || !item.areaId || !item.date || !item.shift) return false;
    return validShifts.size === 0 || validShifts.has(item.shift);
  });
}

function getPlanningTaskAreaNameServer(data, areaId) {
  const key = trimToString(areaId);
  const area = (Array.isArray(data?.areas) ? data.areas : []).find(item => trimToString(item?.id) === key);
  return trimToString(area?.name || area?.title || key || 'Участок');
}

function getTaskPlannedQuantityServer(task) {
  if (!task) return 0;
  const stored = Number(task?.plannedPartQty);
  if (Number.isFinite(stored) && stored > 0) return normalizePlanningWholeQtyServer(stored);
  const minutes = Number(task?.plannedPartMinutes);
  const minutesPerUnit = Number(task?.minutesPerUnitSnapshot);
  if (Number.isFinite(minutes) && minutes > 0 && Number.isFinite(minutesPerUnit) && minutesPerUnit > 0) {
    return normalizePlanningWholeQtyServer(minutes / minutesPerUnit);
  }
  return 0;
}

function getPlanningCoverageQuantityForTaskServer(data, task, reservedSubcontractIds = null) {
  if (!task) return 0;
  const isSubcontractTask = data
    ? isSubcontractAreaServer(data, task?.areaId)
    : (normalizeSubcontractItemIdsServer(task?.subcontractItemIds).length > 0 || Boolean(trimToString(task?.subcontractChainId)));
  if (isSubcontractTask) {
    const itemIds = normalizeSubcontractItemIdsServer(task?.subcontractItemIds);
    if (itemIds.length) {
      if (!reservedSubcontractIds) return itemIds.length;
      let qty = 0;
      itemIds.forEach(itemId => {
        if (reservedSubcontractIds.has(itemId)) return;
        reservedSubcontractIds.add(itemId);
        qty += 1;
      });
      return qty;
    }
  }
  return getTaskPlannedQuantityServer(task);
}

function getPlanningCoverageQuantityForTasksServer(data, tasks = []) {
  const reservedSubcontractIds = new Set();
  return (Array.isArray(tasks) ? tasks : []).reduce((sum, task) => (
    sum + getPlanningCoverageQuantityForTaskServer(data, task, reservedSubcontractIds)
  ), 0);
}

function getPlanningTaskQuantityLabelServer(task, op = null) {
  const qty = getTaskPlannedQuantityServer(task);
  if (qty <= 0) return '';
  const unitLabel = op?.isSamples
    ? (normalizeSampleTypeServer(op.sampleType) === 'WITNESS' ? 'ОС' : 'ОК')
    : 'изд';
  return `${qty} ${unitLabel}`;
}

function buildPlanningTaskLogTextServer(data, task, op = null) {
  if (!task) return '';
  const dateLabel = formatDateDisplayServer(task.date);
  const shift = parseInt(task?.shift, 10) || 1;
  const areaName = getPlanningTaskAreaNameServer(data, task.areaId);
  const minutes = Math.max(0, Math.round(getProductionShiftTaskMinutesForMergeServer(task)));
  const qtyLabel = getPlanningTaskQuantityLabelServer(task, op);
  return `Участок: ${areaName}; дата: ${dateLabel}; смена: ${shift}; объём: ${qtyLabel ? `${qtyLabel} / ` : ''}${minutes} мин`;
}

function formatDateDisplayServer(value) {
  const date = trimToString(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const [year, month, day] = date.split('-');
  return `${day}.${month}.${year.slice(-2)}`;
}

function appendPlanningTaskCardLogServer(data, card, task, action, prevTask = null, userName = '') {
  if (!card || !task) return;
  const op = (Array.isArray(card.operations) ? card.operations : []).find(item => trimToString(item?.id) === trimToString(task.routeOpId)) || null;
  const prevOp = prevTask
    ? ((Array.isArray(card.operations) ? card.operations : []).find(item => trimToString(item?.id) === trimToString(prevTask.routeOpId)) || op)
    : op;
  let logAction = 'Планирование операции';
  let oldValue = '';
  let newValue = buildPlanningTaskLogTextServer(data, task, op);
  if (action === 'REMOVE_TASK_FROM_SHIFT') {
    logAction = 'Удаление из плана';
    oldValue = newValue;
    newValue = '';
  } else if (action === 'MOVE_TASK_TO_SHIFT') {
    logAction = 'Перенос в плане';
    oldValue = buildPlanningTaskLogTextServer(data, prevTask, prevOp);
  } else if (action === 'ADD_TASK_TO_SHIFT') {
    logAction = 'Добавление в план';
  }
  appendCardLog(card, {
    action: logAction,
    object: trimToString(op?.opName || op?.name || op?.opCode || 'Операция'),
    field: 'planning',
    targetId: trimToString(task.routeOpId) || null,
    oldValue,
    newValue,
    userName
  });
}

function ensureProductionShiftServer(data, date, shift) {
  if (!data) return null;
  if (!Array.isArray(data.productionShifts)) data.productionShifts = [];
  const dateKey = trimToString(date);
  const shiftNum = parseInt(shift, 10) || 1;
  let existing = data.productionShifts.find(item => trimToString(item?.date) === dateKey && (parseInt(item?.shift, 10) || 1) === shiftNum) || null;
  if (existing) {
    if (!Array.isArray(existing.logs)) existing.logs = [];
    return existing;
  }
  const ref = (Array.isArray(data.productionShiftTimes) ? data.productionShiftTimes : []).find(item => (parseInt(item?.shift, 10) || 1) === shiftNum) || {
    shift: shiftNum,
    timeFrom: '00:00',
    timeTo: '00:00'
  };
  existing = {
    id: `SHIFT_${dateKey}_${shiftNum}`,
    date: dateKey,
    shift: shiftNum,
    timeFrom: trimToString(ref.timeFrom || '00:00'),
    timeTo: trimToString(ref.timeTo || '00:00'),
    status: 'PLANNING',
    openedAt: null,
    openedBy: null,
    closedAt: null,
    closedBy: null,
    isFixed: false,
    fixedAt: null,
    fixedBy: null,
    lockedAt: null,
    lockedBy: null,
    initialSnapshot: null,
    logs: []
  };
  data.productionShifts.push(existing);
  return existing;
}

function appendShiftTaskLogServer(data, task, action, prevTask = null, userName = '') {
  if (!task) return;
  const shiftRecord = ensureProductionShiftServer(data, task.date, task.shift);
  if (!shiftRecord) return;
  if (!Array.isArray(shiftRecord.logs)) shiftRecord.logs = [];
  shiftRecord.logs.push({
    id: genId('shiftlog'),
    ts: Date.now(),
    action,
    object: 'Операция',
    targetId: trimToString(task.routeOpId) || null,
    field: action === 'MOVE_TASK_TO_SHIFT' ? 'shiftCell' : null,
    oldValue: action === 'MOVE_TASK_TO_SHIFT' && prevTask
      ? `${trimToString(prevTask.date)} / смена ${parseInt(prevTask.shift, 10) || 1} / ${trimToString(prevTask.areaId)}`
      : '',
    newValue: action === 'MOVE_TASK_TO_SHIFT'
      ? `${trimToString(task.date)} / смена ${parseInt(task.shift, 10) || 1} / ${trimToString(task.areaId)}`
      : '',
    createdBy: trimToString(userName)
  });
}

function buildSubcontractChainLogTextServer(data, task, { removedCount = 0, target = null } = {}) {
  if (!task) return '';
  const chainId = trimToString(task?.subcontractChainId) || '—';
  const areaName = getPlanningTaskAreaNameServer(data, task.areaId);
  const itemCount = normalizeSubcontractItemIdsServer(task?.subcontractItemIds).length;
  const base = `Цепочка ${chainId}; участок: ${areaName}; изделий: ${itemCount}`;
  if (target?.date) {
    return `${base}; новая смена: ${formatDateDisplayServer(target.date)} / ${parseInt(target.shift, 10) || 1}`;
  }
  if (removedCount > 0) {
    return `${base}; удалено будущих фрагментов: ${removedCount}`;
  }
  return base;
}

function appendSubcontractChainShiftLogServer(data, task, action, { userName = '', removedCount = 0, target = null } = {}) {
  if (!task) return;
  const shiftRecord = target?.date
    ? ensureProductionShiftServer(data, target.date, target.shift)
    : ensureProductionShiftServer(data, task.date, task.shift);
  if (!shiftRecord) return;
  if (!Array.isArray(shiftRecord.logs)) shiftRecord.logs = [];
  shiftRecord.logs.push({
    id: genId('shiftlog'),
    ts: Date.now(),
    action,
    object: 'Операция',
    targetId: trimToString(task.routeOpId) || null,
    field: 'subcontractChain',
    oldValue: '',
    newValue: buildSubcontractChainLogTextServer(data, task, { removedCount, target }),
    createdBy: trimToString(userName)
  });
}

function appendSubcontractChainCardLogServer(data, card, task, action, { userName = '', removedCount = 0, target = null } = {}) {
  if (!card || !task) return;
  const op = (Array.isArray(card.operations) ? card.operations : []).find(item => trimToString(item?.id) === trimToString(task.routeOpId)) || null;
  const actionMap = {
    SUBCONTRACT_CHAIN_CREATE: 'Создание цепочки субподрядчика',
    SUBCONTRACT_CHAIN_DELETE: 'Удаление цепочки субподрядчика',
    SUBCONTRACT_CHAIN_EXTEND: 'Продление цепочки субподрядчика',
    SUBCONTRACT_CHAIN_FINISH: 'Завершение цепочки субподрядчика'
  };
  appendCardLog(card, {
    action: actionMap[action] || 'Изменение цепочки субподрядчика',
    object: trimToString(op?.opName || op?.name || op?.opCode || 'Операция'),
    targetId: trimToString(task.routeOpId) || null,
    field: 'subcontractChain',
    oldValue: '',
    newValue: buildSubcontractChainLogTextServer(data, task, { removedCount, target }),
    userName: trimToString(userName)
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

function normalizePasswordQrPrintSettings(value) {
  const source = value && typeof value === 'object' ? value : {};
  const parseMm = (input, fallback, min) => {
    const parsed = Number(input);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, parsed);
  };
  const parsePt = (input, fallback, min) => {
    const parsed = Number(input);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, parsed);
  };
  return {
    paperMode: trimToString(source.paperMode).toUpperCase() === 'CUSTOM' ? 'CUSTOM' : 'A4',
    customWidthMm: parseMm(source.customWidthMm, PASSWORD_QR_PRINT_SETTINGS_DEFAULTS.customWidthMm, 10),
    customHeightMm: parseMm(source.customHeightMm, PASSWORD_QR_PRINT_SETTINGS_DEFAULTS.customHeightMm, 10),
    placement: trimToString(source.placement).toUpperCase() === 'TOP_LEFT' ? 'TOP_LEFT' : 'CENTER',
    rotate90: Boolean(source.rotate90),
    showUsername: source.showUsername !== false,
    showPassword: source.showPassword !== false,
    qrSizeMm: parseMm(source.qrSizeMm, PASSWORD_QR_PRINT_SETTINGS_DEFAULTS.qrSizeMm, 5),
    fontSizePt: parsePt(source.fontSizePt, PASSWORD_QR_PRINT_SETTINGS_DEFAULTS.fontSizePt, 4)
  };
}

function normalizeItemQrPrintSettings(value) {
  const source = value && typeof value === 'object' ? value : {};
  const parseMm = (input, fallback, min) => {
    const parsed = Number(input);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, parsed);
  };
  const parsePt = (input, fallback, min) => {
    const parsed = Number(input);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, parsed);
  };
  return {
    paperMode: trimToString(source.paperMode).toUpperCase() === 'CUSTOM' ? 'CUSTOM' : 'A4',
    customWidthMm: parseMm(source.customWidthMm, ITEM_QR_PRINT_SETTINGS_DEFAULTS.customWidthMm, 10),
    customHeightMm: parseMm(source.customHeightMm, ITEM_QR_PRINT_SETTINGS_DEFAULTS.customHeightMm, 10),
    placement: trimToString(source.placement).toUpperCase() === 'TOP_LEFT' ? 'TOP_LEFT' : 'CENTER',
    rotate90: Boolean(source.rotate90),
    showRouteCardNumber: source.showRouteCardNumber !== false,
    showItemName: source.showItemName !== false,
    showItemSerial: source.showItemSerial !== false,
    qrSizeMm: parseMm(source.qrSizeMm, ITEM_QR_PRINT_SETTINGS_DEFAULTS.qrSizeMm, 5),
    fontSizePt: parsePt(source.fontSizePt, ITEM_QR_PRINT_SETTINGS_DEFAULTS.fontSizePt, 4)
  };
}

function normalizeCardQrPrintSettings(value) {
  const source = value && typeof value === 'object' ? value : {};
  const parseMm = (input, fallback, min) => {
    const parsed = Number(input);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, parsed);
  };
  const parsePt = (input, fallback, min) => {
    const parsed = Number(input);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, parsed);
  };
  return {
    paperMode: trimToString(source.paperMode).toUpperCase() === 'CUSTOM' ? 'CUSTOM' : 'A4',
    customWidthMm: parseMm(source.customWidthMm, CARD_QR_PRINT_SETTINGS_DEFAULTS.customWidthMm, 10),
    customHeightMm: parseMm(source.customHeightMm, CARD_QR_PRINT_SETTINGS_DEFAULTS.customHeightMm, 10),
    placement: trimToString(source.placement).toUpperCase() === 'TOP_LEFT' ? 'TOP_LEFT' : 'CENTER',
    rotate90: Boolean(source.rotate90),
    showRouteNumber: source.showRouteNumber !== false,
    showItemName: source.showItemName !== false,
    qrSizeMm: parseMm(source.qrSizeMm, CARD_QR_PRINT_SETTINGS_DEFAULTS.qrSizeMm, 5),
    fontSizePt: parsePt(source.fontSizePt, CARD_QR_PRINT_SETTINGS_DEFAULTS.fontSizePt, 4)
  };
}

function normalizeUserPrintSettings(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    passwordQr: normalizePasswordQrPrintSettings(source.passwordQr),
    itemQr: normalizeItemQrPrintSettings(source.itemQr),
    cardQr: normalizeCardQrPrintSettings(source.cardQr)
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
      return {
        ...user,
        id: currentId,
        printSettings: normalizeUserPrintSettings(user?.printSettings)
      };
    }
    const nextId = allocateUserId();
    if (currentId) {
      userIdMap.set(currentId, nextId);
    }
    const legacyId = trimToString(user?.legacyId) || currentId;
    return {
      ...user,
      id: nextId,
      legacyId: legacyId || undefined,
      printSettings: normalizeUserPrintSettings(user?.printSettings)
    };
  });
  const remapUserId = (value) => {
    const id = trimToString(value);
    if (!id || id === 'SYSTEM' || id === SYSTEM_USER_ID) return id;
    return userIdMap.get(id) || id;
  };
  const normalizedCards = Array.isArray(payload.cards) ? payload.cards.map(normalizeCard) : [];
  const flowNormalized = ensureFlowForCards(normalizedCards);
  flowNormalized.cards.forEach(card => recalcProductionStateFromFlow(card));
  const safe = {
    cards: flowNormalized.cards,
    ops: Array.isArray(payload.ops) ? payload.ops : [],
    centers: Array.isArray(payload.centers) ? payload.centers : [],
    areas: Array.isArray(payload.areas) ? payload.areas.map(normalizeArea) : [],
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
  safe.productionShifts = Array.isArray(payload.productionShifts) ? payload.productionShifts : [];
  safe.productionShiftTasks = normalizeProductionShiftTasks(payload.productionShiftTasks, safe.productionShiftTimes, safe.productionShifts);
  safe.cards.forEach(card => reconcileCardPlanningTasksServer(safe, card));
  safe.cards.forEach(card => applyPersonalOperationAggregatesToCardServer(safe, card));
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
  delete safe.printSettings;
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
  const clientPlatform = String(req.headers['x-client-platform'] || '').toLowerCase();
  const skipInactivityTimeout = clientPlatform === 'android';
  if (!skipInactivityTimeout && lastActivity && Date.now() - lastActivity > timeoutMs) {
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
    let hasAbyss = false;
    draft.users = Array.isArray(draft.users) ? draft.users.map(user => {
      const next = { ...user };
      const isAbyss = (next.name || next.username) === DEFAULT_ADMIN.name;
       if (isAbyss) hasAbyss = true;
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
      if (isAbyss) {
        next.accessLevelId = 'level_admin';
        next.status = 'active';
      }
      next.departmentId = normalizeDepartmentId(next.departmentId);
      if (!next.accessLevelId) {
        next.accessLevelId = 'level_admin';
      }
      next.printSettings = normalizeUserPrintSettings(next.printSettings);
      return next;
    }) : [];

    if (!draft.users.length) {
      draft.users.push(buildDefaultUser(draft.users));
    } else if (!hasAbyss) {
      draft.users.push(buildDefaultUser(draft.users));
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
    plannedCompletionDate: toText(card.plannedCompletionDate || ''),
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
  if (status === 'NO_ITEMS') return '<span class="badge status-no-items">Нет изделий/образцов</span>';
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

function roundPlanningMinutesServer(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.ceil(numeric - 1e-9);
}

function roundPlanningQtyServer(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.round(numeric * 100) / 100;
}

function normalizePlanningWholeQtyServer(value, maxQty = Infinity) {
  const numeric = Number(value);
  const qtyLimit = Number.isFinite(Number(maxQty)) ? Math.max(0, Math.floor(Number(maxQty))) : Infinity;
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.min(Math.max(0, Math.floor(numeric + 1e-9)), qtyLimit);
}

function getPlanningOperationBaseQtyServer(card, op) {
  if (!card || !op) return 0;
  if (op.isSamples) {
    const sampleType = normalizeSampleTypeServer(op.sampleType);
    const raw = sampleType === 'WITNESS' ? card.witnessSampleCount : card.sampleCount;
    return toSafeCountServer(raw);
  }
  const raw = op.quantity != null && op.quantity !== '' ? op.quantity : card.quantity;
  return toSafeCountServer(raw);
}

function isQtyDrivenPlanningOperationServer(card, op) {
  return Boolean(card && op && card.cardType === 'MKI' && !isMaterialIssueOperation(op) && !isMaterialReturnOperation(op) && !isDryingOperation(op));
}

function getTaskPlannedMinutesServer(task, card, op) {
  const plannedPart = Number(task?.plannedPartMinutes);
  if (Number.isFinite(plannedPart) && plannedPart > 0) return plannedPart;
  const total = Number(task?.plannedTotalMinutes);
  if (Number.isFinite(total) && total > 0) return total;
  const fallback = Number(op?.plannedMinutes);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
}

function getProductionShiftRecordServer(data, date, shift) {
  return (Array.isArray(data?.productionShifts) ? data.productionShifts : []).find(item => (
    item
    && trimToString(item.date) === trimToString(date)
    && (parseInt(item.shift, 10) || 1) === (parseInt(shift, 10) || 1)
  )) || null;
}

function isPastPlanningShiftServer(data, date, shift) {
  const window = getSummaryShiftWindowServer(date, shift, data);
  if (!window) return false;
  return Date.now() > Number(window.end || 0);
}

function getProductionShiftMutationMetaServer(data, date, shift) {
  const shiftRecord = getProductionShiftRecordServer(data, date, shift);
  const status = trimToString(shiftRecord?.status).toUpperCase() || 'PLANNING';
  const isFixed = Boolean(shiftRecord?.isFixed || status === 'LOCKED');
  return {
    status,
    isFixed,
    isPastPlanning: status === 'PLANNING' && isPastPlanningShiftServer(data, date, shift)
  };
}

function canAddTaskToShiftServer(data, date, shift) {
  const meta = getProductionShiftMutationMetaServer(data, date, shift);
  if (meta.isFixed) return false;
  if (meta.status === 'OPEN') return true;
  return meta.status === 'PLANNING' && !meta.isPastPlanning;
}

function canMutateExistingShiftTaskServer(data, task) {
  if (!task) return false;
  const meta = getProductionShiftMutationMetaServer(data, task.date, task.shift);
  if (meta.isFixed) return false;
  return meta.status === 'PLANNING' && !meta.isPastPlanning;
}

function canMoveExistingShiftTaskServer(data, task) {
  if (!task) return false;
  const meta = getProductionShiftMutationMetaServer(data, task.date, task.shift);
  if (meta.isFixed) return false;
  return meta.status === 'PLANNING';
}

function canMoveTaskToShiftServer(data, date, shift) {
  const meta = getProductionShiftMutationMetaServer(data, date, shift);
  if (meta.isFixed) return false;
  if (meta.status === 'OPEN') return true;
  return meta.status === 'PLANNING' && !meta.isPastPlanning;
}

function canRemoveExistingShiftTaskServer(data, task) {
  if (!task) return false;
  const meta = getProductionShiftMutationMetaServer(data, task.date, task.shift);
  if (meta.isFixed) return false;
  return meta.status === 'PLANNING';
}

function canAutoAdjustShiftTaskServer(data, task) {
  if (!task) return false;
  const shiftRecord = getProductionShiftRecordServer(data, task.date, task.shift);
  if (!shiftRecord) return true;
  const status = trimToString(shiftRecord.status).toUpperCase() || 'PLANNING';
  if (status !== 'PLANNING') return false;
  return !Boolean(shiftRecord.isFixed || status === 'LOCKED');
}

function shouldReserveShiftTaskPlanningBudgetServer(data, task) {
  if (!task) return false;
  const shiftRecord = getProductionShiftRecordServer(data, task.date, task.shift);
  if (!shiftRecord) return true;
  const status = trimToString(shiftRecord.status).toUpperCase() || 'PLANNING';
  if (status === 'CLOSED') return false;
  return true;
}

function getOperationPlanningRequirementServer(card, op, plannedMinutes = 0, plannedQty = 0) {
  const baseMinutes = Number(op?.plannedMinutes);
  const unitLabel = op?.isSamples
    ? (normalizeSampleTypeServer(op.sampleType) === 'WITNESS' ? 'WITNESS' : 'CONTROL')
    : 'ITEM';
  const baseQty = getPlanningOperationBaseQtyServer(card, op);
  if (!isQtyDrivenPlanningOperationServer(card, op) || !Number.isFinite(baseMinutes) || baseMinutes <= 0 || baseQty <= 0) {
    const requiredMinutes = Number.isFinite(baseMinutes) && baseMinutes > 0 ? baseMinutes : 0;
    return {
      qtyDriven: false,
      unitLabel,
      baseQty,
      remainingQty: 0,
      plannedMinutes,
      plannedQty: 0,
      coveredQty: 0,
      availableQty: 0,
      minutesPerUnit: 0,
      requiredMinutes,
      availableMinutes: Math.max(0, requiredMinutes - plannedMinutes)
    };
  }

  const stats = op?.flowStats || {};
  const remainingQty = roundPlanningQtyServer(
    Math.max(0, Number(stats.pendingOnOp || 0)) + Math.max(0, Number(stats.awaiting || 0))
  );
  const minutesPerUnit = baseMinutes / baseQty;
  const requiredMinutes = roundPlanningMinutesServer(minutesPerUnit * remainingQty);
  const normalizedPlannedQty = normalizePlanningWholeQtyServer(plannedQty, remainingQty);
  const coveredQty = Math.min(remainingQty, Math.max(0, normalizedPlannedQty));
  const availableQty = normalizePlanningWholeQtyServer(remainingQty - coveredQty, remainingQty);
  return {
    qtyDriven: true,
    unitLabel,
    baseQty,
    remainingQty,
    plannedQty: normalizedPlannedQty,
    coveredQty,
    availableQty,
    plannedMinutes,
    minutesPerUnit,
    requiredMinutes,
    availableMinutes: roundPlanningMinutesServer(minutesPerUnit * availableQty)
  };
}

function updateCardPlanningStageServer(card, tasksForCard) {
  if (!card) return;
  const stage = trimToString(card.approvalStage).toUpperCase();
  if (!['PROVIDED', 'PLANNING', 'PLANNED'].includes(stage)) return;
  const plannableOps = (Array.isArray(card.operations) ? card.operations : []).filter(op => (
    op
    && !isMaterialIssueOperation(op)
    && !isMaterialReturnOperation(op)
  ));
  if (!plannableOps.length) {
    card.approvalStage = 'PLANNED';
    return;
  }

  let coveredCount = 0;
  let plannedCount = 0;
  plannableOps.forEach(op => {
    const opTasks = (tasksForCard || []).filter(task => trimToString(task.routeOpId) === trimToString(op.id));
    const plannedMinutes = opTasks.reduce((sum, task) => sum + getTaskPlannedMinutesServer(task, card, op), 0);
    const plannedQty = getPlanningCoverageQuantityForTasksServer(null, opTasks);
    const requirement = getOperationPlanningRequirementServer(card, op, plannedMinutes, plannedQty);
    if ((requirement.qtyDriven ? plannedQty : plannedMinutes) > 0) plannedCount += 1;
    if (requirement.qtyDriven ? requirement.availableQty === 0 : requirement.availableMinutes === 0) coveredCount += 1;
  });

  const processState = trimToString(card.productionStatus || card.status).toUpperCase() || 'NOT_STARTED';
  if (plannedCount === 0) {
    card.approvalStage = processState === 'NOT_STARTED' ? 'PROVIDED' : 'PLANNING';
    return;
  }
  if (coveredCount < plannableOps.length) {
    card.approvalStage = 'PLANNING';
    return;
  }
  card.approvalStage = 'PLANNED';
}

function reconcileCardPlanningTasksServer(data, card) {
  if (!data || !card?.id) return;
  const allTasks = Array.isArray(data.productionShiftTasks) ? data.productionShiftTasks : [];
  const cardTasks = allTasks.filter(task => trimToString(task?.cardId) === trimToString(card.id));
  if (!cardTasks.length) {
    updateCardPlanningStageServer(card, []);
    return;
  }

  recalcOperationCountersFromFlow(card);
  recalcProductionStateFromFlow(card);

  const nextTasks = [];
  const sortedCardTasks = cardTasks.slice().sort((a, b) => {
    const dateCmp = trimToString(a.date).localeCompare(trimToString(b.date));
    if (dateCmp !== 0) return dateCmp;
    const shiftCmp = (parseInt(a.shift, 10) || 1) - (parseInt(b.shift, 10) || 1);
    if (shiftCmp !== 0) return shiftCmp;
    const createdCmp = (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0);
    if (createdCmp !== 0) return createdCmp;
    return trimToString(a.id).localeCompare(trimToString(b.id));
  });
  const tasksByOpId = new Map();
  sortedCardTasks.forEach(task => {
    const key = trimToString(task?.routeOpId);
    if (!key) return;
    if (!tasksByOpId.has(key)) tasksByOpId.set(key, []);
    tasksByOpId.get(key).push(task);
  });

  const plannableOpIds = new Set();
  (Array.isArray(card.operations) ? card.operations : []).forEach(op => {
    if (!op || isMaterialIssueOperation(op) || isMaterialReturnOperation(op)) return;
    const opId = trimToString(op.id);
    if (!opId) return;
    plannableOpIds.add(opId);
    const opTasks = tasksByOpId.get(opId) || [];
    const plannedMinutes = opTasks.reduce((sum, task) => sum + getTaskPlannedMinutesServer(task, card, op), 0);
    const plannedQty = getPlanningCoverageQuantityForTasksServer(data, opTasks);
    const requirement = getOperationPlanningRequirementServer(card, op, plannedMinutes, plannedQty);

    let lockedMinutes = 0;
    let lockedQty = 0;
    const adjustableTasks = [];
    const lockedSubcontractIds = new Set();
    opTasks.forEach(task => {
      const taskMinutes = getTaskPlannedMinutesServer(task, card, op);
      const taskQty = getTaskPlannedQuantityServer(task);
      if (isSubcontractAreaServer(data, task?.areaId)) {
        if (shouldReserveShiftTaskPlanningBudgetServer(data, task)) {
          lockedMinutes += taskMinutes;
          lockedQty += getPlanningCoverageQuantityForTaskServer(data, task, lockedSubcontractIds);
        }
        nextTasks.push(task);
        return;
      }
      if (canAutoAdjustShiftTaskServer(data, task)) {
        adjustableTasks.push({ task, taskMinutes, taskQty });
      } else {
        if (shouldReserveShiftTaskPlanningBudgetServer(data, task)) {
          lockedMinutes += taskMinutes;
          lockedQty += taskQty;
        }
        nextTasks.push(task);
      }
    });

    if (requirement.qtyDriven && requirement.minutesPerUnit > 0) {
      let remainingQtyBudget = normalizePlanningWholeQtyServer(requirement.remainingQty - lockedQty, requirement.remainingQty);
      adjustableTasks.forEach(({ task, taskQty }) => {
        const normalizedTaskQty = normalizePlanningWholeQtyServer(taskQty);
        const allowedQty = Math.max(0, Math.min(normalizedTaskQty, remainingQtyBudget));
        remainingQtyBudget = normalizePlanningWholeQtyServer(remainingQtyBudget - allowedQty, requirement.remainingQty);
        if (allowedQty <= 0) return;
        task.plannedPartQty = allowedQty;
        task.plannedPartMinutes = roundPlanningMinutesServer(requirement.minutesPerUnit * allowedQty);
        task.plannedTotalQty = requirement.remainingQty;
        task.plannedTotalMinutes = requirement.requiredMinutes > 0 ? requirement.requiredMinutes : task.plannedTotalMinutes;
        task.minutesPerUnitSnapshot = requirement.minutesPerUnit;
        task.remainingQtySnapshot = requirement.remainingQty;
        nextTasks.push(task);
      });
      return;
    }

    let remainingBudget = Math.max(0, requirement.requiredMinutes - lockedMinutes);
    adjustableTasks.forEach(({ task, taskMinutes }) => {
      const allowedMinutes = Math.max(0, Math.min(taskMinutes, remainingBudget));
      remainingBudget = Math.max(0, remainingBudget - allowedMinutes);
      if (allowedMinutes <= 0) return;
      task.plannedPartMinutes = allowedMinutes;
      task.plannedTotalMinutes = requirement.requiredMinutes > 0 ? requirement.requiredMinutes : task.plannedTotalMinutes;
      nextTasks.push(task);
    });
  });

  sortedCardTasks.forEach(task => {
    const opId = trimToString(task?.routeOpId);
    if (!plannableOpIds.has(opId)) nextTasks.push(task);
  });

  const others = allTasks.filter(task => trimToString(task?.cardId) !== trimToString(card.id));
  data.productionShiftTasks = mergeProductionShiftTasksServer(others.concat(nextTasks), data);
  updateCardPlanningStageServer(card, data.productionShiftTasks.filter(task => trimToString(task?.cardId) === trimToString(card.id)));
}

function getProductionShiftNumbersServer(data) {
  const list = Array.isArray(data?.productionShiftTimes) ? data.productionShiftTimes : [];
  const shifts = list
    .map(item => parseInt(item?.shift, 10) || 0)
    .filter(value => value > 0)
    .sort((a, b) => a - b);
  return shifts.length ? Array.from(new Set(shifts)) : [1, 2, 3];
}

function getProductionShiftTimeRefServer(data, shift) {
  const shiftNum = parseInt(shift, 10) || 1;
  const ref = (Array.isArray(data?.productionShiftTimes) ? data.productionShiftTimes : [])
    .find(item => (parseInt(item?.shift, 10) || 1) === shiftNum);
  return normalizeProductionShiftTimeEntryServer(ref || { shift: shiftNum }, shiftNum);
}

function parseShiftTimeMinutesServer(value) {
  const raw = trimToString(value);
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return (parseInt(match[1], 10) || 0) * 60 + (parseInt(match[2], 10) || 0);
}

function resolveProductionShiftLunchStateServer(entry) {
  const normalized = normalizeProductionShiftTimeEntryServer(entry);
  const shiftFrom = parseShiftTimeMinutesServer(normalized.timeFrom) ?? 0;
  let shiftTo = parseShiftTimeMinutesServer(normalized.timeTo);
  if (shiftTo == null) shiftTo = shiftFrom;
  if (shiftTo <= shiftFrom) shiftTo += 24 * 60;

  const lunchFrom = parseShiftTimeMinutesServer(normalized.lunchFrom);
  const lunchTo = parseShiftTimeMinutesServer(normalized.lunchTo);
  if (lunchFrom == null && lunchTo == null) {
    return {
      status: 'none',
      shiftRange: { start: shiftFrom, end: shiftTo },
      lunchRange: null,
      normalized
    };
  }
  if (lunchFrom == null || lunchTo == null) {
    return {
      status: 'partial',
      shiftRange: { start: shiftFrom, end: shiftTo },
      lunchRange: null,
      normalized
    };
  }
  if (lunchFrom === lunchTo) {
    return {
      status: 'zero',
      shiftRange: { start: shiftFrom, end: shiftTo },
      lunchRange: null,
      normalized
    };
  }
  let normalizedLunchFrom = lunchFrom;
  while (normalizedLunchFrom < shiftFrom) normalizedLunchFrom += 24 * 60;
  let normalizedLunchTo = lunchTo;
  while (normalizedLunchTo < normalizedLunchFrom) normalizedLunchTo += 24 * 60;
  const lunchRange = {
    start: normalizedLunchFrom,
    end: normalizedLunchTo
  };
  if (lunchRange.start <= shiftFrom || lunchRange.end >= shiftTo) {
    return {
      status: 'outside',
      shiftRange: { start: shiftFrom, end: shiftTo },
      lunchRange: null,
      normalized
    };
  }
  return {
    status: 'ok',
    shiftRange: { start: shiftFrom, end: shiftTo },
    lunchRange,
    normalized
  };
}

function getShiftLunchWindowServer(dateStr, shift, data, { ignoreLunch = false } = {}) {
  if (ignoreLunch) return null;
  const baseWindow = getSummaryShiftWindowServer(dateStr, shift, data);
  if (!baseWindow) return null;
  const resolution = resolveProductionShiftLunchStateServer(getProductionShiftTimeRefServer(data, shift));
  if (resolution.status !== 'ok' || !resolution.lunchRange) return null;
  const offsetStartMinutes = resolution.lunchRange.start - resolution.shiftRange.start;
  const offsetEndMinutes = resolution.lunchRange.end - resolution.shiftRange.start;
  return {
    start: baseWindow.start + (offsetStartMinutes * 60000),
    end: baseWindow.start + (offsetEndMinutes * 60000)
  };
}

function getShiftWorkWindowsServer(dateStr, shift, data, { ignoreLunch = false } = {}) {
  const baseWindow = getSummaryShiftWindowServer(dateStr, shift, data);
  if (!baseWindow) return [];
  const lunchWindow = getShiftLunchWindowServer(dateStr, shift, data, { ignoreLunch });
  if (!lunchWindow) {
    return [{ start: baseWindow.start, end: baseWindow.end, segmentKey: '' }];
  }
  const windows = [];
  if (lunchWindow.start > baseWindow.start) {
    windows.push({ start: baseWindow.start, end: lunchWindow.start, segmentKey: 'before_lunch' });
  }
  if (lunchWindow.end < baseWindow.end) {
    windows.push({ start: lunchWindow.end, end: baseWindow.end, segmentKey: 'after_lunch' });
  }
  return windows.filter(window => window.end > window.start);
}

function findShiftWorkWindowStartServer(windows, minStartAt = 0) {
  const list = Array.isArray(windows) ? windows : [];
  for (const window of list) {
    if (!window || !(window.end > window.start)) continue;
    if (window.end <= minStartAt) continue;
    return {
      window,
      startAt: Math.max(Number(minStartAt) || 0, window.start)
    };
  }
  return null;
}

function getShiftDurationMinutesServer(data, shift, { ignoreLunch = false } = {}) {
  const windows = getShiftWorkWindowsServer('2000-01-01', shift, data, { ignoreLunch });
  const totalMinutes = windows.reduce((sum, window) => sum + Math.max(0, Math.round((window.end - window.start) / 60000)), 0);
  return totalMinutes > 0 ? totalMinutes : 8 * 60;
}

function compareProductionShiftSlotServer(a, b) {
  const dateA = trimToString(a?.date);
  const dateB = trimToString(b?.date);
  if (dateA !== dateB) return dateA.localeCompare(dateB);
  return (parseInt(a?.shift, 10) || 1) - (parseInt(b?.shift, 10) || 1);
}

function getShiftPlannedMinutesForAreaServer(data, date, shift, areaId, { excludeTaskIds = null } = {}) {
  const excluded = excludeTaskIds instanceof Set ? excludeTaskIds : null;
  return (Array.isArray(data?.productionShiftTasks) ? data.productionShiftTasks : [])
    .filter(task => (
      task
      && trimToString(task?.date) === trimToString(date)
      && (parseInt(task?.shift, 10) || 1) === (parseInt(shift, 10) || 1)
      && trimToString(task?.areaId) === trimToString(areaId)
      && (!excluded || !excluded.has(trimToString(task?.id)))
    ))
    .reduce((sum, task) => sum + getProductionShiftTaskMinutesForMergeServer(task), 0);
}

function isSubcontractTraversalLockedShiftServer(data, date, shift) {
  const record = getProductionShiftRecordServer(data, date, shift);
  const status = trimToString(record?.status).toUpperCase();
  return Boolean(record?.isFixed || status === 'LOCKED' || status === 'CLOSED');
}

function findNextAvailableSubcontractSlotServer(data, startSlot, areaId, { allowOpen = true } = {}) {
  let cursor = { date: trimToString(startSlot?.date), shift: parseInt(startSlot?.shift, 10) || 1 };
  for (let guard = 0; guard < 366 * 3; guard += 1) {
    cursor = moveShiftSlotServer(cursor, 1, data);
    const record = ensureProductionShiftServer(data, cursor.date, cursor.shift);
    const status = trimToString(record?.status).toUpperCase() || 'PLANNING';
    const isFixed = Boolean(record?.isFixed || status === 'LOCKED');
    if (isFixed || status === 'CLOSED') continue;
    if (!allowOpen && status === 'OPEN') continue;
    return {
      date: cursor.date,
      shift: cursor.shift,
      areaId: trimToString(areaId)
    };
  }
  return null;
}

function buildSubcontractChainTasksServer(data, {
  card,
  op,
  areaId,
  startDate,
  startShift,
  totalMinutes,
  planningMode = 'MANUAL',
  autoPlanRunId = '',
  createdAt = Date.now(),
  createdBy = '',
  sourceShiftDate = '',
  sourceShift = null,
  shiftCloseSourceDate = '',
  shiftCloseSourceShift = null,
  fromShiftCloseTransfer = false,
  subcontractChainId = '',
  subcontractItemIds = [],
  subcontractItemKind = ''
} = {}) {
  const chainId = trimToString(subcontractChainId) || genId('subc');
  const tasks = [];
  const totalRequiredMinutes = roundPlanningMinutesServer(totalMinutes);
  if (!(totalRequiredMinutes > 0)) {
    return { chainId, tasks };
  }
  let remaining = totalRequiredMinutes;
  let slot = { date: trimToString(startDate), shift: parseInt(startShift, 10) || 1 };
  let index = 0;
  while (remaining > 0 && slot?.date && index < 366 * 9) {
    index += 1;
    const record = ensureProductionShiftServer(data, slot.date, slot.shift);
    const shiftDuration = getShiftDurationMinutesServer(data, slot.shift, { ignoreLunch: true });
    let segmentMinutes = shiftDuration;
    if (planningMode === 'AUTO' && isSubcontractTraversalLockedShiftServer(data, slot.date, slot.shift)) {
      segmentMinutes = shiftDuration;
    } else if (planningMode === 'AUTO') {
      const busy = getShiftPlannedMinutesForAreaServer(data, slot.date, slot.shift, areaId);
      segmentMinutes = Math.max(0, Math.min(shiftDuration, shiftDuration - busy));
      if (segmentMinutes <= 0) {
        slot = moveShiftSlotServer(slot, 1, data);
        continue;
      }
    } else if (index === 1) {
      const busy = getShiftPlannedMinutesForAreaServer(data, slot.date, slot.shift, areaId);
      const free = Math.max(0, shiftDuration - busy);
      segmentMinutes = free > 0 ? free : shiftDuration;
    }
    segmentMinutes = Math.min(remaining, segmentMinutes);
    if (segmentMinutes <= 0) break;
    tasks.push(normalizeProductionShiftTask({
      id: genId('pst'),
      cardId: trimToString(card?.id),
      routeOpId: trimToString(op?.id),
      opId: trimToString(op?.opId),
      opName: trimToString(op?.opName || op?.name),
      date: slot.date,
      shift: slot.shift,
      areaId: trimToString(areaId),
      subcontractChainId: chainId,
      subcontractItemIds,
      subcontractItemKind,
      subcontractExtendedChain: fromShiftCloseTransfer === true,
      plannedPartMinutes: segmentMinutes,
      plannedTotalMinutes: totalRequiredMinutes,
      planningMode,
      autoPlanRunId,
      sourceShiftDate: trimToString(sourceShiftDate) || trimToString(startDate),
      sourceShift: Number.isFinite(Number(sourceShift)) ? (parseInt(sourceShift, 10) || 1) : (parseInt(startShift, 10) || 1),
      fromShiftCloseTransfer: fromShiftCloseTransfer === true,
      shiftCloseSourceDate: trimToString(shiftCloseSourceDate),
      shiftCloseSourceShift: Number.isFinite(Number(shiftCloseSourceShift)) ? (parseInt(shiftCloseSourceShift, 10) || 1) : undefined,
      createdAt,
      createdBy
    }));
    remaining = Math.max(0, remaining - segmentMinutes);
    if (remaining <= 0 && isSubcontractTraversalLockedShiftServer(data, slot.date, slot.shift)) {
      remaining = getShiftDurationMinutesServer(data, slot.shift, { ignoreLunch: true });
    }
    if (remaining > 0) {
      slot = moveShiftSlotServer(slot, 1, data);
    }
  }
  return { chainId, tasks };
}

function moveShiftSlotServer(slot, dir, data) {
  const shifts = getProductionShiftNumbersServer(data);
  const idx = Math.max(0, shifts.indexOf(parseInt(slot?.shift, 10) || shifts[0] || 1));
  let nextIdx = idx + dir;
  let date = new Date(`${trimToString(slot?.date)}T00:00:00`);
  if (Number.isNaN(date.getTime())) date = new Date();
  if (nextIdx >= shifts.length) {
    nextIdx = 0;
    date.setDate(date.getDate() + 1);
  }
  if (nextIdx < 0) {
    nextIdx = shifts.length - 1;
    date.setDate(date.getDate() - 1);
  }
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return {
    date: `${yyyy}-${mm}-${dd}`,
    shift: shifts[nextIdx] || 1
  };
}

function getAutoPlanSlotWindowServer(data, date, shift) {
  return getSummaryShiftWindowServer(date, shift, data);
}

function getAutoPlanSlotWindowsServer(data, date, shift, areaId = '') {
  return getShiftWorkWindowsServer(date, shift, data, {
    ignoreLunch: isSubcontractAreaServer(data, areaId)
  });
}

function isAutoPlanShiftAvailableServer(data, date, shift) {
  const shiftRecord = getProductionShiftRecordServer(data, date, shift);
  if (!shiftRecord) return true;
  const status = trimToString(shiftRecord.status).toUpperCase() || 'PLANNING';
  if (shiftRecord.isFixed === true) return false;
  return status !== 'LOCKED' && status !== 'CLOSED';
}

function getAutoPlanCellLimitMinutesServer(data, date, shift, maxLoadPercent, areaId = '') {
  const shiftMinutes = getShiftDurationMinutesServer(data, shift, {
    ignoreLunch: isSubcontractAreaServer(data, areaId)
  });
  return Math.max(0, Math.floor(shiftMinutes * (Math.max(1, Math.min(100, maxLoadPercent)) / 100)));
}

function getAutoPlanAreasDisplayOrderServer(data, rawOrder) {
  const areasList = Array.isArray(data?.areas) ? data.areas : [];
  const existingIds = new Set(areasList.map(item => trimToString(item?.id)).filter(Boolean));
  const requestedOrder = Array.isArray(rawOrder) ? rawOrder.map(item => trimToString(item)).filter(Boolean) : [];
  const normalizedOrder = requestedOrder.filter(id => existingIds.has(id));
  const seen = new Set(normalizedOrder);
  const missing = areasList
    .filter(area => {
      const key = trimToString(area?.id);
      return key && !seen.has(key);
    })
    .sort((a, b) => trimToString(a?.name).localeCompare(trimToString(b?.name)))
    .map(area => trimToString(area?.id));
  return normalizedOrder.concat(missing);
}

function getAutoPlanPriorityAreaIdsServer(data, routeOp) {
  const refOpId = trimToString(routeOp?.opId);
  const refOp = (Array.isArray(data?.ops) ? data.ops : []).find(item => trimToString(item?.id) === refOpId) || null;
  const allowed = Array.isArray(refOp?.allowedAreaIds)
    ? refOp.allowedAreaIds.map(item => trimToString(item)).filter(Boolean)
    : [];
  if (!allowed.length && Array.isArray(routeOp?.allowedAreaIds)) {
    routeOp.allowedAreaIds.forEach(item => {
      const key = trimToString(item);
      if (key && !allowed.includes(key)) allowed.push(key);
    });
  }
  return allowed;
}

function getAutoPlanAllowedAreaIdsServer(data, routeOp, requestedAreaId = '', areasOrder = []) {
  const requestArea = trimToString(requestedAreaId);
  const allowed = getAutoPlanPriorityAreaIdsServer(data, routeOp);
  const displayOrder = getAutoPlanAreasDisplayOrderServer(data, areasOrder);
  const existingIds = new Set((Array.isArray(data?.areas) ? data.areas : []).map(item => trimToString(item?.id)).filter(Boolean));
  if (!allowed.length) {
    const allAreaIds = displayOrder.length
      ? displayOrder.slice()
      : (Array.isArray(data?.areas) ? data.areas : []).map(item => trimToString(item?.id)).filter(Boolean);
    if (requestArea) {
      return allAreaIds.includes(requestArea) ? [requestArea].concat(allAreaIds.filter(id => id !== requestArea)) : allAreaIds;
    }
    return allAreaIds;
  }
  return allowed.filter(id => existingIds.has(id));
}

function sortAutoPlanAreaIdsForSlotServer(data, areaIds, slot, endByCell) {
  const normalizedIds = Array.isArray(areaIds) ? areaIds.map(item => trimToString(item)).filter(Boolean) : [];
  if (!normalizedIds.length) return [];
  return normalizedIds.slice();
}

function isAutoPlanPlannableOperationServer(op) {
  return Boolean(op) && !isMaterialIssueOperation(op) && !isMaterialReturnOperation(op);
}

function getAutoPlanOperationFlowKindServer(op) {
  if (!op) return 'ITEM';
  if (isDryingOperation(op)) return 'DRYING';
  if (Boolean(op.isSamples)) {
    return normalizeSampleTypeServer(op.sampleType) === 'WITNESS' ? 'WITNESS' : 'CONTROL';
  }
  return 'ITEM';
}

function getAutoPlanOrderedOperationsServer(card) {
  return buildOperationsIndex(card)
    .map(entry => entry?.op || null)
    .filter(isAutoPlanPlannableOperationServer);
}

function canStartInAutoPlanByWorkspaceRulesServer(op) {
  if (!op) return false;
  if (op.canStart === true) return true;
  if (!isDryingOperation(op)) return false;
  const reasons = Array.isArray(op.blockedReasons)
    ? op.blockedReasons.map(item => trimToString(item)).filter(Boolean)
    : [];
  if (!reasons.length) return true;
  return reasons.every(reason => reason === 'Нет выданного порошка для сушки.');
}

function buildAutoPlanDependencyMetaServer(opStates) {
  const states = Array.isArray(opStates) ? opStates : [];
  states.forEach((state, index) => {
    const prevStates = states.slice(0, index);
    const prevItem = [...prevStates].reverse().find(item => item?.flowKind === 'ITEM') || null;
    const prevControl = [...prevStates].reverse().find(item => item?.flowKind === 'CONTROL') || null;
    const prevWitness = [...prevStates].reverse().find(item => item?.flowKind === 'WITNESS') || null;
    const prevDrying = [...prevStates].reverse().find(item => item?.flowKind === 'DRYING') || null;
    const prevSample = [...prevStates].reverse().find(item => item?.flowKind === 'CONTROL' || item?.flowKind === 'WITNESS') || null;
    const gating = [];
    const gatingReasons = new Map();
    const pushGate = (depState, reason) => {
      const depId = trimToString(depState?.op?.id);
      if (!depId || gating.includes(depId)) return;
      gating.push(depId);
      gatingReasons.set(depId, trimToString(reason));
    };

    state.workspaceCanStartNow = canStartInAutoPlanByWorkspaceRulesServer(state.op);
    state.qtySourceOpId = '';
    state.gatingOpIds = [];
    state.gatingReasons = gatingReasons;

    if (state.flowKind === 'ITEM') {
      state.qtySourceOpId = trimToString(prevItem?.op?.id);
      if (prevSample) pushGate(prevSample, 'На предыдущих операциях есть образцы со статусами «В ожидании», «Задержано» или «Брак».');
      if (prevDrying) pushGate(prevDrying, 'Предыдущая операция «Сушка» не завершена.');
    } else if (state.flowKind === 'CONTROL') {
      state.qtySourceOpId = trimToString(prevControl?.op?.id);
      if (prevControl) pushGate(prevControl, 'На предыдущей операции есть ОК со статусами «В ожидании», «Задержано» или «Брак».');
    } else if (state.flowKind === 'WITNESS') {
      state.qtySourceOpId = trimToString(prevWitness?.op?.id);
      if (prevItem) pushGate(prevItem, 'На предыдущих операциях есть изделия со статусами «В ожидании», «Задержано» или «Брак».');
      if (prevSample) pushGate(prevSample, 'На предыдущих операциях есть образцы со статусами «В ожидании», «Задержано» или «Брак».');
      if (prevDrying) pushGate(prevDrying, 'Предыдущая операция «Сушка» не завершена.');
    } else if (state.flowKind === 'DRYING') {
      if (prevItem) pushGate(prevItem, 'Предыдущая операция ещё не завершена.');
    }

    state.gatingOpIds = gating;
  });
}

function resolveAutoPlanGatingReadyAtServer({ state, opStateById, completionByOpId, completionAreaByOpId, settings, data }) {
  if (!state) {
    return { ok: true, readyAt: 0 };
  }
  if (state.workspaceCanStartNow === true) {
    return { ok: true, readyAt: 0 };
  }
  const gateIds = Array.isArray(state.gatingOpIds) ? state.gatingOpIds : [];
  if (!gateIds.length) {
    return { ok: true, readyAt: 0 };
  }
  let readyAt = 0;
  for (const depId of gateIds) {
    const depState = opStateById.get(trimToString(depId));
    if (!depState) continue;
    const depRemainingQty = Math.max(0, Number(depState.remainingQty) || 0);
    const depRemainingMinutes = Math.max(0, Number(depState.remainingMinutes) || 0);
    const depCompletionAt = Number(completionByOpId.get(trimToString(depId)) || 0);
    const depAlreadyResolved = depRemainingQty <= 0 && depRemainingMinutes <= 0;
    if (!depAlreadyResolved) {
      return {
        ok: false,
        reason: state.gatingReasons instanceof Map
          ? (state.gatingReasons.get(trimToString(depId)) || 'Предыдущая операция ещё не завершена.')
          : 'Предыдущая операция ещё не завершена.'
      };
    }
    if (depCompletionAt > 0) {
      const delayResolution = resolveAutoPlanDelayWithinActiveShiftsServer(depCompletionAt, settings.delayMinutes, settings, data, {
        areaId: trimToString(completionAreaByOpId?.get(trimToString(depId)) || '')
      });
      readyAt = Math.max(readyAt, delayResolution.readyAt);
    }
  }
  return { ok: true, readyAt };
}

function buildAutoPlanSlotsServer(data, startDate, startShift, activeShifts, effectiveDeadline) {
  const allowedShifts = Array.from(new Set((Array.isArray(activeShifts) ? activeShifts : []).map(item => parseInt(item, 10) || 0).filter(Boolean))).sort((a, b) => a - b);
  const slots = [];
  let cursor = { date: startDate, shift: parseInt(startShift, 10) || 1 };
  let guard = 0;
  while (cursor.date <= effectiveDeadline && guard < 512) {
    if (allowedShifts.includes(cursor.shift)) {
      slots.push({ ...cursor });
    }
    cursor = moveShiftSlotServer(cursor, 1, data);
    guard += 1;
  }
  return slots.filter(slot => slot.date <= effectiveDeadline);
}

function formatDateKeyFromTimestampServer(ts) {
  const ref = new Date(Number(ts) || 0);
  if (Number.isNaN(ref.getTime())) return '';
  const yyyy = ref.getFullYear();
  const mm = String(ref.getMonth() + 1).padStart(2, '0');
  const dd = String(ref.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysToDateKeyServer(dateKey, days = 1) {
  const ref = new Date(`${trimToString(dateKey)}T00:00:00`);
  if (Number.isNaN(ref.getTime())) return '';
  ref.setDate(ref.getDate() + (parseInt(days, 10) || 0));
  const yyyy = ref.getFullYear();
  const mm = String(ref.getMonth() + 1).padStart(2, '0');
  const dd = String(ref.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function findNextAutoPlanActiveShiftWindowServer(data, ts, activeShifts, { areaId = '' } = {}) {
  const allowedShifts = Array.from(new Set((Array.isArray(activeShifts) ? activeShifts : []).map(item => parseInt(item, 10) || 0).filter(Boolean))).sort((a, b) => a - b);
  if (!allowedShifts.length) return null;
  let cursorDate = formatDateKeyFromTimestampServer(ts) || formatDateKeyFromTimestampServer(Date.now());
  let guard = 0;
  while (cursorDate && guard < 1024) {
    for (const shift of allowedShifts) {
      if (!isAutoPlanShiftAvailableServer(data, cursorDate, shift)) continue;
      const windows = getAutoPlanSlotWindowsServer(data, cursorDate, shift, areaId);
      const resolved = findShiftWorkWindowStartServer(windows, ts);
      if (!resolved?.window) continue;
      return {
        date: cursorDate,
        shift,
        window: resolved.window
      };
    }
    cursorDate = addDaysToDateKeyServer(cursorDate, 1);
    guard += 1;
  }
  return null;
}

function resolveAutoPlanDelayWithinActiveShiftsServer(startAt, delayMinutes, settings, data, { areaId = '' } = {}) {
  const numericStartAt = Number(startAt) || 0;
  const remainingStart = Math.max(0, parseInt(delayMinutes, 10) || 0);
  if (!(numericStartAt > 0) || remainingStart <= 0) {
    return {
      readyAt: numericStartAt,
      trace: []
    };
  }

  let cursorAt = numericStartAt;
  let remaining = remainingStart;
  let guard = 0;
  const trace = [];

  while (remaining > 0 && guard < 2048) {
    const segment = findNextAutoPlanActiveShiftWindowServer(data, cursorAt, settings?.activeShifts, { areaId });
    if (!segment?.window) {
      return {
        readyAt: cursorAt,
        trace
      };
    }
    const segmentStartAt = Math.max(cursorAt, segment.window.start);
    const segmentMinutes = Math.max(0, Math.floor((segment.window.end - segmentStartAt) / 60000));
    if (segmentMinutes <= 0) {
      cursorAt = segment.window.end + 1;
      guard += 1;
      continue;
    }
    const consumedMinutes = Math.min(remaining, segmentMinutes);
    trace.push({
      date: segment.date,
      shift: segment.shift,
      segmentKey: trimToString(segment.window?.segmentKey),
      consumedMinutes,
      remainingBefore: remaining,
      remainingAfter: remaining - consumedMinutes,
      startAt: segmentStartAt,
      endAt: segmentStartAt + (consumedMinutes * 60000)
    });
    remaining -= consumedMinutes;
    if (remaining <= 0) {
      return {
        readyAt: segmentStartAt + (consumedMinutes * 60000),
        trace
      };
    }
    cursorAt = segment.window.end + 1;
    guard += 1;
  }

  return {
    readyAt: cursorAt,
    trace
  };
}

function buildAutoPlanExistingBusyMapServer(data) {
  const map = new Map();
  (Array.isArray(data?.productionShiftTasks) ? data.productionShiftTasks : []).forEach(task => {
    const key = `${trimToString(task?.date)}|${parseInt(task?.shift, 10) || 1}|${trimToString(task?.areaId)}`;
    const next = (map.get(key) || 0) + getProductionShiftTaskMinutesForMergeServer(task);
    map.set(key, next);
  });
  return map;
}

function buildAutoPlanExistingEndMapServer(data) {
  const map = new Map();
  (Array.isArray(data?.productionShiftTasks) ? data.productionShiftTasks : []).forEach(task => {
    const key = `${trimToString(task?.date)}|${parseInt(task?.shift, 10) || 1}|${trimToString(task?.areaId)}`;
    const currentMax = map.get(key) || 0;
    const next = Number.isFinite(Number(task?.plannedEndAt))
      ? Math.max(currentMax, Number(task.plannedEndAt))
      : currentMax + (getProductionShiftTaskMinutesForMergeServer(task) * 60000);
    map.set(key, next);
  });
  return map;
}

function getAutoPlanTransferBatchServer(settings, op) {
  if (!op?.isSamples) return Math.max(1, parseInt(settings.transferItems, 10) || 1);
  return normalizeSampleTypeServer(op.sampleType) === 'WITNESS'
    ? Math.max(1, parseInt(settings.transferWitness, 10) || 1)
    : Math.max(1, parseInt(settings.transferControl, 10) || 1);
}

function getAutoPlanMinimumQtyServer(settings, op) {
  if (!op?.isSamples) return Math.max(1, parseInt(settings.minItems, 10) || 1);
  return normalizeSampleTypeServer(op.sampleType) === 'WITNESS'
    ? Math.max(1, parseInt(settings.minWitness, 10) || 1)
    : Math.max(1, parseInt(settings.minControl, 10) || 1);
}

function makeAutoPlanTaskLineServer(data, card, op, task) {
  const areaName = getPlanningTaskAreaNameServer(data, task.areaId);
  const dateLabel = formatDateDisplayServer(task.date);
  const qtyLabel = getPlanningTaskQuantityLabelServer(task, op);
  const code = trimToString(op?.opCode || op?.code);
  const name = trimToString(op?.opName || op?.name || code);
  const lastPartialLabel = task?.lastPartialBatchApplied
    ? ` - последняя неполная партия${trimToString(task?.lastPartialBatchReason) ? ` (${trimToString(task.lastPartialBatchReason)})` : ''}`
    : '';
  return `${code} - ${name} - ${areaName} - ${dateLabel} - смена ${parseInt(task.shift, 10) || 1} - ${Math.max(0, Math.round(task.plannedPartMinutes || 0))} мин${qtyLabel ? ` - ${qtyLabel}` : ''}${lastPartialLabel}`;
}

function makeAutoPlanUnplannedLineServer(op, reason, remainingMinutes = 0, remainingQty = 0) {
  const code = trimToString(op?.opCode || op?.code);
  const name = trimToString(op?.opName || op?.name || code);
  const base = `${code} - ${name}`;
  const qtyPart = remainingQty > 0 ? ` / ${remainingQty}` : '';
  const minutesPart = remainingMinutes > 0 ? ` / ${Math.max(0, Math.round(remainingMinutes))} мин` : '';
  return `${base} - ${trimToString(reason || 'Не удалось запланировать')}${minutesPart}${qtyPart}`;
}

function compareAutoPlanCandidateServer(left, right) {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  const startDiff = (Number(left.plannedStartAt) || 0) - (Number(right.plannedStartAt) || 0);
  if (startDiff !== 0) return startDiff;
  const endDiff = (Number(left.plannedEndAt) || 0) - (Number(right.plannedEndAt) || 0);
  if (endDiff !== 0) return endDiff;
  const areaOrderDiff = (Number(left.areaOrderIndex) || 0) - (Number(right.areaOrderIndex) || 0);
  if (areaOrderDiff !== 0) return areaOrderDiff;
  return trimToString(left.areaId).localeCompare(trimToString(right.areaId));
}

function buildAutoPlanLastPartialBatchReasonServer({ bypassMinimumQty = false, bypassTransferBatch = false } = {}) {
  const parts = [];
  if (bypassTransferBatch) parts.push('меньше передаточной партии');
  if (bypassMinimumQty) parts.push('меньше дневного минимума');
  return parts.join(' и ');
}

function buildAutoPlanQtyCandidateServer({ settings, state, prevState, availableQty, usableMinutes }) {
  const maxQtyByMinutes = Math.max(0, Math.floor(usableMinutes / state.minutesPerUnit));
  const minQtyByMinutes = Math.max(1, Math.ceil(settings.minOperationMinutes / state.minutesPerUnit));
  const minQtyByRule = Math.max(1, state.minimumQty);
  const taskQty = Math.min(state.remainingQty, availableQty, maxQtyByMinutes);
  const finalTailAllowed = settings.allowLastPartialBatch === true && taskQty > 0 && taskQty === state.remainingQty;
  const bypassMinimumQty = taskQty > 0 && taskQty < minQtyByRule && finalTailAllowed;
  const bypassTransferBatch = prevState?.qtyDriven && taskQty > 0 && taskQty < state.transferBatchQty && finalTailAllowed;
  const isPotentialTailBlockedByPrev = settings.allowLastPartialBatch === true
    && state.remainingQty > 0
    && prevState?.qtyDriven
    && availableQty > 0
    && availableQty < state.remainingQty
    && state.remainingQty <= Math.max(minQtyByRule, state.transferBatchQty);
  const isPotentialTailBlockedByWindow = settings.allowLastPartialBatch === true
    && state.remainingQty > 0
    && maxQtyByMinutes > 0
    && maxQtyByMinutes < state.remainingQty
    && state.remainingQty <= Math.max(minQtyByRule, prevState?.qtyDriven ? state.transferBatchQty : 0);

  if (taskQty < minQtyByMinutes) {
    return {
      ok: false,
      reason: isPotentialTailBlockedByWindow
        ? 'Финальный хвост допустим, но не помещается до дедлайна'
        : 'В смене недостаточно времени для минимального фрагмента операции'
    };
  }

  if (taskQty < minQtyByRule && !bypassMinimumQty) {
    return {
      ok: false,
      reason: isPotentialTailBlockedByPrev
        ? 'Финальный хвост допустим, но предыдущая операция ещё не выпустила объём'
        : (isPotentialTailBlockedByWindow
          ? 'Финальный хвост допустим, но не помещается до дедлайна'
          : 'Не выполнен минимальный порог количества для операции')
    };
  }

  if (prevState?.qtyDriven && taskQty < state.transferBatchQty && !bypassTransferBatch) {
    return {
      ok: false,
      reason: isPotentialTailBlockedByPrev
        ? 'Финальный хвост допустим, но предыдущая операция ещё не выпустила объём'
        : (isPotentialTailBlockedByWindow
          ? 'Финальный хвост допустим, но не помещается до дедлайна'
          : 'Не достигнута передаточная партия')
    };
  }

  const taskMinutes = roundPlanningMinutesServer(state.minutesPerUnit * taskQty);
  if (!(taskMinutes > 0)) {
    return { ok: false, reason: 'Операция не помещается в доступный слот' };
  }

  return {
    ok: true,
    taskQty,
    taskMinutes,
    lastPartialBatchApplied: bypassMinimumQty || bypassTransferBatch,
    lastPartialBatchReason: buildAutoPlanLastPartialBatchReasonServer({
      bypassMinimumQty,
      bypassTransferBatch
    })
  };
}

function resolveAutoPlanQtyDependencyServer({
  settings,
  state,
  cellStartAt,
  freeMinutes,
  windows,
  releaseBatchesByOpId,
  consumedQtyByOpId,
  gatingReadyAt = 0
}) {
  const releases = (releaseBatchesByOpId.get(trimToString(state?.qtySourceOpId)) || [])
    .map(batch => ({
      availableAt: Number(batch?.availableAt) || 0,
      qty: Number(batch?.qty) || 0
    }))
    .filter(batch => batch.availableAt > 0 && batch.qty > 0)
    .sort((a, b) => a.availableAt - b.availableAt);
  const currentConsumed = consumedQtyByOpId.get(trimToString(state?.op?.id)) || 0;
  const currentReadyQty = Math.max(0, Number(state?.currentReadyQtyRemaining) || 0);
  const baseStartAt = Math.max(Number(cellStartAt) || 0, Number(gatingReadyAt) || 0);
  const candidateStarts = [baseStartAt];
  releases.forEach(batch => {
    const candidateStartAt = Math.max(baseStartAt, batch.availableAt, Number(gatingReadyAt) || 0);
    if (!candidateStarts.includes(candidateStartAt)) {
      candidateStarts.push(candidateStartAt);
    }
  });
  candidateStarts.sort((a, b) => a - b);
  const testedCandidates = new Set();

  let lastReason = settings.allowLastPartialBatch === true
    && state.remainingQty > 0
    && state.remainingQty <= Math.max(state.minimumQty, state.transferBatchQty)
    ? 'Финальный хвост допустим, но предыдущая операция ещё не выпустила объём'
    : 'Не достигнута передаточная партия предыдущей операции';

  for (const candidateStartAt of candidateStarts) {
    const resolvedWindow = findShiftWorkWindowStartServer(windows, candidateStartAt);
    if (!resolvedWindow?.window) continue;
    const normalizedCandidateStartAt = resolvedWindow.startAt;
    const windowEndAt = Number(resolvedWindow.window?.end) || 0;
    const candidateKey = `${normalizedCandidateStartAt}|${windowEndAt}`;
    if (testedCandidates.has(candidateKey)) continue;
    testedCandidates.add(candidateKey);
    const readyQty = releases
      .filter(batch => batch.availableAt <= normalizedCandidateStartAt)
      .reduce((sum, batch) => sum + batch.qty, 0);
    const availableQty = Math.max(0, Math.floor(currentReadyQty + readyQty - currentConsumed));
    if (availableQty <= 0) continue;

    const availableWindowMinutes = Math.max(0, Math.floor((windowEndAt - normalizedCandidateStartAt) / 60000));
    const usableMinutes = Math.min(freeMinutes, availableWindowMinutes);
    if (usableMinutes < settings.minOperationMinutes) {
      lastReason = state.remainingQty > 0
        && settings.allowLastPartialBatch === true
        && state.remainingQty <= Math.max(state.minimumQty, state.transferBatchQty)
        ? 'Финальный хвост допустим, но не помещается до дедлайна'
        : 'В смене недостаточно времени для минимального фрагмента операции';
      continue;
    }

    const qtyCandidate = buildAutoPlanQtyCandidateServer({
      settings,
      state,
      prevState: state?.qtySourceOpId ? { qtyDriven: true } : null,
      availableQty,
      usableMinutes
    });
    if (qtyCandidate.ok) {
      return {
        ok: true,
        dependencyStartAt: normalizedCandidateStartAt,
        availableQty,
        qtyCandidate,
        window: resolvedWindow.window
      };
    }
    lastReason = qtyCandidate.reason || lastReason;
  }

  return {
    ok: false,
    reason: lastReason
  };
}

function resolveExistingAutoPlanTaskTimingServer(task, data) {
  const directEndAt = Number(task?.plannedEndAt);
  const directStartAt = Number(task?.plannedStartAt);
  const fallbackMinutes = getProductionShiftTaskMinutesForMergeServer(task);
  if (Number.isFinite(directEndAt) && directEndAt > 0) {
    let startAt = Number.isFinite(directStartAt) && directStartAt > 0 ? directStartAt : 0;
    if (!(startAt > 0) && fallbackMinutes > 0) startAt = directEndAt - (fallbackMinutes * 60000);
    return {
      startAt: startAt > 0 ? startAt : undefined,
      endAt: directEndAt
    };
  }

  const date = trimToString(task?.date);
  const shift = parseInt(task?.shift, 10) || 1;
  const window = getAutoPlanSlotWindowServer(data, date, shift);
  if (!window || fallbackMinutes <= 0) return null;

  const startAt = Number.isFinite(directStartAt) && directStartAt > 0
    ? Math.max(directStartAt, window.start)
    : window.start;
  return {
    startAt,
    endAt: startAt + (fallbackMinutes * 60000)
  };
}

function getExistingAutoPlanTaskQtyServer(task, state) {
  const explicitQty = Number(task?.plannedPartQty);
  if (Number.isFinite(explicitQty) && explicitQty > 0) return normalizePlanningWholeQtyServer(explicitQty);
  const taskMinutes = getProductionShiftTaskMinutesForMergeServer(task);
  const minutesPerUnit = Number(state?.minutesPerUnit) || 0;
  if (!(taskMinutes > 0) || !(minutesPerUnit > 0)) return 0;
  return normalizePlanningWholeQtyServer(taskMinutes / minutesPerUnit);
}

function seedExistingAutoPlanFlowStateServer({
  data,
  card,
  settings,
  opStates,
  completionByOpId,
  completionAreaByOpId,
  releaseBatchesByOpId,
  consumedQtyByOpId
}) {
  const stateMetaByOpId = new Map();
  opStates.forEach(state => {
    const opId = trimToString(state?.op?.id);
    if (!opId) return;
    stateMetaByOpId.set(opId, {
      state
    });
  });

  const existingTasks = (Array.isArray(data?.productionShiftTasks) ? data.productionShiftTasks : [])
    .filter(task => trimToString(task?.cardId) === trimToString(card?.id))
    .filter(task => stateMetaByOpId.has(trimToString(task?.routeOpId)));

  const consumedQtySeedByOpId = new Map();
  let seededCompletionCount = 0;
  let seededReleaseCount = 0;

  existingTasks.forEach(task => {
    const opId = trimToString(task?.routeOpId);
    const meta = stateMetaByOpId.get(opId);
    if (!meta?.state) return;

    const timing = resolveExistingAutoPlanTaskTimingServer(task, data);
    if (timing?.endAt > 0) {
      const currentCompletion = completionByOpId.get(opId) || 0;
      if (timing.endAt > currentCompletion) {
        completionByOpId.set(opId, timing.endAt);
        completionAreaByOpId.set(opId, trimToString(task?.areaId));
        seededCompletionCount += 1;
      }
    }

    if (!meta.state.qtyDriven || !(timing?.endAt > 0)) return;
    const taskQty = getExistingAutoPlanTaskQtyServer(task, meta.state);
    if (!(taskQty > 0)) return;

    const releases = releaseBatchesByOpId.get(opId) || [];
    const delayResolution = resolveAutoPlanDelayWithinActiveShiftsServer(timing.endAt, settings.delayMinutes, settings, data, {
      areaId: trimToString(task?.areaId)
    });
    releases.push({
      availableAt: delayResolution.readyAt,
      qty: taskQty
    });
    releaseBatchesByOpId.set(opId, releases);
    seededReleaseCount += 1;

    if (trimToString(meta.state.qtySourceOpId)) {
      consumedQtySeedByOpId.set(opId, (consumedQtySeedByOpId.get(opId) || 0) + taskQty);
    }
  });

  consumedQtySeedByOpId.forEach((qty, opId) => {
    consumedQtyByOpId.set(opId, qty);
  });

  console.info(`[AUTO_PLAN] seed-existing card=${trimToString(card?.id)} tasks=${existingTasks.length} completion=${seededCompletionCount} releases=${seededReleaseCount}`);
  releaseBatchesByOpId.forEach((batches, opId) => {
    const payload = (Array.isArray(batches) ? batches : [])
      .filter(batch => Number(batch?.availableAt) > 0 && Number(batch?.qty) > 0)
      .map(batch => `${Number(batch.availableAt)}:${Number(batch.qty)}`)
      .join(',');
    if (payload) {
      console.info(`[AUTO_PLAN] seed-existing-release card=${trimToString(card?.id)} op=${opId} batches=${payload}`);
    }
  });
}

function runProductionAutoPlanServer(data, card, rawSettings, { save = false, userName = '' } = {}) {
  const settings = {
    cardId: trimToString(rawSettings?.cardId),
    startDate: trimToString(rawSettings?.startDate),
    startShift: parseInt(rawSettings?.startShift, 10) || 1,
    activeShifts: Array.isArray(rawSettings?.activeShifts) ? rawSettings.activeShifts.map(item => parseInt(item, 10) || 0).filter(Boolean) : [1],
    deadlineMode: trimToString(rawSettings?.deadlineMode) === 'CUSTOM_DEADLINE' ? 'CUSTOM_DEADLINE' : 'CARD_PLANNED_COMPLETION',
    cardPlannedCompletionDate: trimToString(rawSettings?.cardPlannedCompletionDate || card?.plannedCompletionDate),
    targetEndDate: trimToString(rawSettings?.targetEndDate),
    effectiveDeadline: trimToString(rawSettings?.effectiveDeadline),
    maxLoadPercent: Math.max(1, Math.min(100, parseInt(rawSettings?.maxLoadPercent, 10) || 100)),
    areaMode: trimToString(rawSettings?.areaMode) === 'SELECTED_AREA_ONLY' ? 'SELECTED_AREA_ONLY' : 'AUTO_ALLOWED_AREAS',
    areaId: trimToString(rawSettings?.areaId),
    delayMinutes: Math.max(0, parseInt(rawSettings?.delayMinutes, 10) || 0),
    minOperationMinutes: Math.max(1, parseInt(rawSettings?.minOperationMinutes, 10) || 1),
    minItems: Math.max(1, parseInt(rawSettings?.minItems, 10) || 1),
    minWitness: Math.max(1, parseInt(rawSettings?.minWitness, 10) || 1),
    minControl: Math.max(1, parseInt(rawSettings?.minControl, 10) || 1),
    transferItems: Math.max(1, parseInt(rawSettings?.transferItems, 10) || 1),
    transferWitness: Math.max(1, parseInt(rawSettings?.transferWitness, 10) || 1),
    transferControl: Math.max(1, parseInt(rawSettings?.transferControl, 10) || 1),
    allowLastPartialBatch: rawSettings?.allowLastPartialBatch === true,
    areasOrder: getAutoPlanAreasDisplayOrderServer(data, rawSettings?.areasOrder)
  };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(settings.startDate)) {
    throw new Error('Некорректная дата начала автоплана');
  }
  if (!settings.activeShifts.length) {
    throw new Error('Не выбраны смены планирования');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(settings.effectiveDeadline)) {
    throw new Error('Некорректный дедлайн автоплана');
  }
  if (settings.effectiveDeadline < settings.startDate) {
    throw new Error('Дедлайн не может быть раньше даты старта');
  }
  if (card.approvalStage !== 'PROVIDED' && card.approvalStage !== 'PLANNING') {
    throw new Error('Автопланирование доступно только для карт в статусах PROVIDED или PLANNING');
  }

  console.info(`[AUTO_PLAN] start card=${trimToString(card?.id)} start=${settings.startDate}/s${settings.startShift} active=${settings.activeShifts.join(',')} deadlineMode=${settings.deadlineMode} cardDeadline=${settings.cardPlannedCompletionDate || '-'} effectiveDeadline=${settings.effectiveDeadline} areaMode=${settings.areaMode} area=${settings.areaId || '-'} maxLoad=${settings.maxLoadPercent} delay=${settings.delayMinutes} areasOrder=${settings.areasOrder.join(',')}`);

  recalcOperationCountersFromFlow(card);
  recalcProductionStateFromFlow(card);

  const slots = buildAutoPlanSlotsServer(data, settings.startDate, settings.startShift, settings.activeShifts, settings.effectiveDeadline);
  const busyByCell = buildAutoPlanExistingBusyMapServer(data);
  const endByCell = buildAutoPlanExistingEndMapServer(data);
  const dayAreaQtyByOp = new Map();
  const previewTasks = [];
  const plannedOperations = [];
  const unplannedOperations = [];
  const overloadedSlots = new Set();
  const blockedAreaNames = [];
  const blockedAreaNameSet = new Set();
  const opStates = [];
  const completionByOpId = new Map();
  const completionAreaByOpId = new Map();
  const releaseBatchesByOpId = new Map();
  const consumedQtyByOpId = new Map();
  const previewRunId = genId('aprun');

  const operations = getAutoPlanOrderedOperationsServer(card);
  operations.forEach(op => {
    const opId = trimToString(op?.id);
    const existingPlannedMinutes = (Array.isArray(data?.productionShiftTasks) ? data.productionShiftTasks : [])
      .filter(task => trimToString(task?.cardId) === trimToString(card.id) && trimToString(task?.routeOpId) === opId)
      .reduce((sum, task) => sum + getProductionShiftTaskMinutesForMergeServer(task), 0);
    const existingPlannedQty = getPlanningCoverageQuantityForTasksServer(data, (Array.isArray(data?.productionShiftTasks) ? data.productionShiftTasks : [])
      .filter(task => trimToString(task?.cardId) === trimToString(card.id) && trimToString(task?.routeOpId) === opId));
    const requirement = getOperationPlanningRequirementServer(card, op, existingPlannedMinutes, existingPlannedQty);
    const currentPendingQty = requirement.qtyDriven
      ? Math.max(0, roundPlanningQtyServer(Number(op?.flowStats?.pendingOnOp || 0)))
      : 0;
    const coveredQty = requirement.qtyDriven ? requirement.coveredQty : 0;
    const uncoveredQty = requirement.qtyDriven
      ? normalizePlanningWholeQtyServer(requirement.availableQty)
      : 0;
    opStates.push({
      op,
      flowKind: getAutoPlanOperationFlowKindServer(op),
      qtyDriven: requirement.qtyDriven,
      unitLabel: requirement.qtyDriven
        ? (normalizeSampleTypeServer(op.sampleType) === 'WITNESS' ? 'ОС' : (op.isSamples ? 'ОК' : 'изд'))
        : 'мин',
      minutesPerUnit: requirement.minutesPerUnit,
      remainingQty: uncoveredQty,
      remainingMinutes: requirement.qtyDriven ? roundPlanningMinutesServer(requirement.minutesPerUnit * uncoveredQty) : requirement.availableMinutes,
      requiredMinutes: requirement.requiredMinutes,
      transferBatchQty: getAutoPlanTransferBatchServer(settings, op),
      minimumQty: getAutoPlanMinimumQtyServer(settings, op),
      currentReadyQtyRemaining: Math.min(uncoveredQty, currentPendingQty)
    });
  });

  buildAutoPlanDependencyMetaServer(opStates);
  const opStateById = new Map(opStates.map(state => [trimToString(state?.op?.id), state]));

  seedExistingAutoPlanFlowStateServer({
    data,
    card,
    settings,
    opStates,
    completionByOpId,
    completionAreaByOpId,
    releaseBatchesByOpId,
    consumedQtyByOpId
  });

  opStates.forEach(state => {
    const op = state.op;
    if (state.qtyDriven && state.remainingQty <= 0) return;
    if (!state.qtyDriven && state.remainingMinutes <= 0) return;

    let lastReason = 'Не удалось подобрать слот до дедлайна';
    for (const slot of slots) {
      if (state.qtyDriven && state.remainingQty <= 0) break;
      if (!state.qtyDriven && state.remainingMinutes <= 0) break;
      if (!isAutoPlanShiftAvailableServer(data, slot.date, slot.shift)) continue;
      const areaIds = settings.areaMode === 'SELECTED_AREA_ONLY'
        ? [settings.areaId]
        : getAutoPlanAllowedAreaIdsServer(data, op, settings.areaId, settings.areasOrder);
      if (!areaIds.length) {
        lastReason = 'Нет доступного участка';
        continue;
      }

      const orderedAreaIds = sortAutoPlanAreaIdsForSlotServer(data, areaIds, slot, endByCell);
      for (const areaId of orderedAreaIds) {
        if (state.qtyDriven && state.remainingQty <= 0) break;
        if (!state.qtyDriven && state.remainingMinutes <= 0) break;
        if (!trimToString(areaId)) continue;
        const blockedAreaName = getOpenShiftUnassignedAreaNameServer(data, slot.date, slot.shift, areaId);
        if (blockedAreaName) {
          if (!blockedAreaNameSet.has(blockedAreaName)) {
            blockedAreaNameSet.add(blockedAreaName);
            blockedAreaNames.push(blockedAreaName);
          }
          lastReason = buildProductionAreaAssignmentErrorMessageServer(blockedAreaName);
          continue;
        }
        const isSubcontractArea = isSubcontractAreaServer(data, areaId);
        const windows = getAutoPlanSlotWindowsServer(data, slot.date, slot.shift, areaId);
        if (!windows.length) {
          lastReason = 'В смене нет рабочего окна для планирования';
          continue;
        }

        let areaHasProgress = true;
        while (areaHasProgress) {
          if (state.qtyDriven && state.remainingQty <= 0) break;
          if (!state.qtyDriven && state.remainingMinutes <= 0) break;
          areaHasProgress = false;

          const cellKey = `${slot.date}|${slot.shift}|${trimToString(areaId)}`;
          const cellLimitMinutes = getAutoPlanCellLimitMinutesServer(data, slot.date, slot.shift, settings.maxLoadPercent, areaId);
          const busyMinutes = busyByCell.get(cellKey) || 0;
          const freeMinutes = Math.max(0, cellLimitMinutes - busyMinutes);
          if (freeMinutes <= 0) {
            overloadedSlots.add(`${getPlanningTaskAreaNameServer(data, areaId)} - ${formatDateDisplayServer(slot.date)} - смена ${slot.shift}`);
            lastReason = 'Превышен лимит загрузки смены';
            break;
          }

          const slotWindowStart = Number(windows[0]?.start) || 0;
          let cellStartAt = endByCell.get(cellKey) || slotWindowStart;
          if (slotWindowStart > 0 && cellStartAt < slotWindowStart) cellStartAt = slotWindowStart;
          let dependencyStartAt = slotWindowStart;
          let availableQty = state.qtyDriven ? Math.max(0, state.currentReadyQtyRemaining) : 0;
          let precomputedQtyCandidate = null;
          let selectedWindow = null;
          const gatingResolution = resolveAutoPlanGatingReadyAtServer({
            state,
            opStateById,
            completionByOpId,
            completionAreaByOpId,
            settings,
            data
          });
          if (!gatingResolution.ok) {
            lastReason = gatingResolution.reason || 'Предыдущая операция ещё не завершена.';
            break;
          }
          dependencyStartAt = Math.max(dependencyStartAt, Number(gatingResolution.readyAt) || 0);

          if (state.qtyDriven && trimToString(state.qtySourceOpId)) {
            const dependencyResolution = resolveAutoPlanQtyDependencyServer({
              settings,
              state,
              cellStartAt,
              freeMinutes,
              windows,
              releaseBatchesByOpId,
              consumedQtyByOpId,
              gatingReadyAt: dependencyStartAt
            });
            if (!dependencyResolution.ok) {
              lastReason = dependencyResolution.reason || 'Не достигнута передаточная партия предыдущей операции';
              break;
            }
            dependencyStartAt = dependencyResolution.dependencyStartAt;
            availableQty = dependencyResolution.availableQty;
            precomputedQtyCandidate = dependencyResolution.qtyCandidate || null;
            selectedWindow = dependencyResolution.window || null;
          }

          let plannedStartAt = 0;
          let usableMinutes = 0;
          if (selectedWindow) {
            plannedStartAt = Math.max(cellStartAt, dependencyStartAt, Number(selectedWindow.start) || 0);
            usableMinutes = Math.min(
              freeMinutes,
              Math.max(0, Math.floor(((Number(selectedWindow.end) || 0) - plannedStartAt) / 60000))
            );
          } else {
            let candidateWindowRef = findShiftWorkWindowStartServer(windows, Math.max(cellStartAt, dependencyStartAt));
            while (candidateWindowRef?.window) {
              selectedWindow = candidateWindowRef.window;
              plannedStartAt = candidateWindowRef.startAt;
              usableMinutes = Math.min(
                freeMinutes,
                Math.max(0, Math.floor(((Number(selectedWindow.end) || 0) - plannedStartAt) / 60000))
              );
              if (usableMinutes < settings.minOperationMinutes) {
                lastReason = state.qtyDriven
                  && settings.allowLastPartialBatch === true
                  && state.remainingQty > 0
                  && state.remainingQty <= Math.max(state.minimumQty, trimToString(state.qtySourceOpId) ? state.transferBatchQty : 0)
                  ? 'Финальный хвост допустим, но не помещается до дедлайна'
                  : 'В смене недостаточно времени для минимального фрагмента операции';
                selectedWindow = null;
                candidateWindowRef = findShiftWorkWindowStartServer(windows, (Number(candidateWindowRef.window?.end) || 0) + 1);
                continue;
              }
              if (state.qtyDriven) {
                const qtyCandidate = buildAutoPlanQtyCandidateServer({
                  settings,
                  state,
                  prevState: trimToString(state.qtySourceOpId) ? { qtyDriven: true } : null,
                  availableQty,
                  usableMinutes
                });
                if (!qtyCandidate.ok) {
                  lastReason = qtyCandidate.reason || lastReason;
                  selectedWindow = null;
                  candidateWindowRef = findShiftWorkWindowStartServer(windows, (Number(candidateWindowRef.window?.end) || 0) + 1);
                  continue;
                }
                precomputedQtyCandidate = qtyCandidate;
              }
              break;
            }
          }

          if (!selectedWindow || !(plannedStartAt > 0) || usableMinutes < settings.minOperationMinutes) {
            if (!lastReason) {
              lastReason = 'В смене недостаточно времени для минимального фрагмента операции';
            }
            break;
          }

          let taskQty = 0;
          let taskMinutes = 0;
          let lastPartialBatchApplied = false;
          let lastPartialBatchReason = '';
          if (state.qtyDriven) {
            const qtyCandidate = precomputedQtyCandidate || { ok: false, reason: lastReason };
            if (!qtyCandidate.ok) {
              lastReason = qtyCandidate.reason || lastReason;
              break;
            }
            taskQty = qtyCandidate.taskQty;
            taskMinutes = qtyCandidate.taskMinutes;
            lastPartialBatchApplied = qtyCandidate.lastPartialBatchApplied === true;
            lastPartialBatchReason = trimToString(qtyCandidate.lastPartialBatchReason);
          } else {
            taskMinutes = Math.min(state.remainingMinutes, usableMinutes);
            if (taskMinutes < settings.minOperationMinutes) {
              lastReason = 'Не выполнен минимум времени операции';
              break;
            }
          }

          if (!(taskMinutes > 0)) {
            lastReason = 'Операция не помещается в доступный слот';
            break;
          }

          if (isSubcontractArea) {
            const chainItemIds = pickSubcontractPendingItemIdsServer(data, card, op, state.qtyDriven ? state.remainingQty : 0);
            const subcontractQty = state.qtyDriven ? chainItemIds.length : 0;
            const subcontractMinutes = state.qtyDriven
              ? roundPlanningMinutesServer(state.minutesPerUnit * subcontractQty)
              : state.remainingMinutes;
            if (state.qtyDriven && !(subcontractQty > 0) || !(subcontractMinutes > 0)) {
              lastReason = 'Нет доступных изделий для цепочки субподрядчика';
              break;
            }
            const chainBuild = buildSubcontractChainTasksServer(data, {
              card,
              op,
              areaId,
              startDate: slot.date,
              startShift: slot.shift,
              totalMinutes: subcontractMinutes,
              planningMode: 'AUTO',
              autoPlanRunId: previewRunId,
              createdAt: Date.now(),
              createdBy: userName,
              sourceShiftDate: settings.startDate,
              sourceShift: settings.startShift,
              subcontractItemIds: chainItemIds,
              subcontractItemKind: op.isSamples ? 'SAMPLE' : 'ITEM'
            });
            if (!chainBuild.tasks.length) {
              lastReason = 'Не удалось построить цепочку субподрядчика';
              break;
            }
            let chainEndAt = 0;
            chainBuild.tasks.forEach(task => {
              const taskWindow = getSummaryShiftWindowServer(task.date, task.shift, data);
              const busy = busyByCell.get(`${task.date}|${task.shift}|${trimToString(areaId)}`) || 0;
              if (taskWindow?.end > chainEndAt) chainEndAt = taskWindow.end;
              previewTasks.push(task);
              plannedOperations.push(makeAutoPlanTaskLineServer(data, card, op, task));
              if (!isSubcontractTraversalLockedShiftServer(data, task.date, task.shift)) {
                busyByCell.set(`${task.date}|${task.shift}|${trimToString(areaId)}`, busy + getProductionShiftTaskMinutesForMergeServer(task));
              }
            });
            if (state.qtyDriven) {
              const currentReadyUsed = Math.min(state.currentReadyQtyRemaining, subcontractQty);
              const predecessorUsed = Math.max(0, subcontractQty - currentReadyUsed);
              const releasedQty = subcontractQty;
              state.currentReadyQtyRemaining = Math.max(0, state.currentReadyQtyRemaining - currentReadyUsed);
              state.remainingQty = Math.max(0, state.remainingQty - subcontractQty);
              state.remainingMinutes = Math.max(0, roundPlanningMinutesServer(state.minutesPerUnit * state.remainingQty));
              completionByOpId.set(trimToString(op.id), chainEndAt);
              completionAreaByOpId.set(trimToString(op.id), trimToString(areaId));
              const releases = releaseBatchesByOpId.get(trimToString(op.id)) || [];
              const delayResolution = resolveAutoPlanDelayWithinActiveShiftsServer(chainEndAt, settings.delayMinutes, settings, data, {
                areaId: trimToString(areaId)
              });
              releases.push({ availableAt: delayResolution.readyAt, qty: releasedQty });
              releaseBatchesByOpId.set(trimToString(op.id), releases);
              if (trimToString(state.qtySourceOpId) && predecessorUsed > 0) {
                consumedQtyByOpId.set(trimToString(op.id), (consumedQtyByOpId.get(trimToString(op.id)) || 0) + predecessorUsed);
              }
            } else {
              state.remainingMinutes = 0;
              completionByOpId.set(trimToString(op.id), chainEndAt);
              completionAreaByOpId.set(trimToString(op.id), trimToString(areaId));
            }
            areaHasProgress = false;
            lastReason = '';
            break;
          }

          const plannedEndAt = plannedStartAt + taskMinutes * 60000;
          const task = normalizeProductionShiftTask({
            id: genId('pst'),
            cardId: trimToString(card.id),
            routeOpId: trimToString(op.id),
            opId: trimToString(op.opId),
            opName: trimToString(op.opName || op.name),
            date: slot.date,
            shift: slot.shift,
            areaId,
            plannedPartMinutes: taskMinutes,
            plannedPartQty: state.qtyDriven ? taskQty : undefined,
            plannedTotalQty: state.qtyDriven ? state.remainingQty : undefined,
            minutesPerUnitSnapshot: state.qtyDriven ? state.minutesPerUnit : undefined,
            remainingQtySnapshot: state.qtyDriven ? state.remainingQty : undefined,
            plannedTotalMinutes: state.requiredMinutes,
            isPartial: true,
            planningMode: 'AUTO',
            autoPlanRunId: previewRunId,
            workSegmentKey: trimToString(selectedWindow?.segmentKey),
            plannedStartAt,
            plannedEndAt,
            sourceShiftDate: settings.startDate,
            sourceShift: settings.startShift,
            delayMinutes: settings.delayMinutes,
            effectiveDeadlineSnapshot: settings.effectiveDeadline,
            cardPlannedCompletionDateSnapshot: settings.cardPlannedCompletionDate,
            lastPartialBatchApplied,
            lastPartialBatchReason,
            createdAt: Date.now(),
            createdBy: userName
          });
          if (!isSubcontractArea && trimToString(selectedWindow?.segmentKey)) {
            console.info(`[AUTO_PLAN] work-window card=${trimToString(card?.id)} op=${trimToString(op?.id)} slot=${slot.date}/s${slot.shift} area=${trimToString(areaId)} segment=${trimToString(selectedWindow.segmentKey)} start=${plannedStartAt} end=${plannedEndAt}`);
          }
          previewTasks.push(task);
          plannedOperations.push(makeAutoPlanTaskLineServer(data, card, op, task));
          busyByCell.set(cellKey, busyMinutes + taskMinutes);
          endByCell.set(cellKey, plannedEndAt);
          const dayAreaKey = `${trimToString(op.id)}|${slot.date}|${trimToString(areaId)}`;
          if (state.qtyDriven) {
            const nextQty = (dayAreaQtyByOp.get(dayAreaKey) || 0) + taskQty;
            dayAreaQtyByOp.set(dayAreaKey, nextQty);
            const currentReadyUsed = Math.min(state.currentReadyQtyRemaining, taskQty);
            const predecessorUsed = Math.max(0, taskQty - currentReadyUsed);
            state.currentReadyQtyRemaining = Math.max(0, state.currentReadyQtyRemaining - currentReadyUsed);
            state.remainingQty = Math.max(0, state.remainingQty - taskQty);
            state.remainingMinutes = Math.max(0, roundPlanningMinutesServer(state.minutesPerUnit * state.remainingQty));
            completionByOpId.set(trimToString(op.id), plannedEndAt);
            completionAreaByOpId.set(trimToString(op.id), trimToString(areaId));
            const releases = releaseBatchesByOpId.get(trimToString(op.id)) || [];
            const delayResolution = resolveAutoPlanDelayWithinActiveShiftsServer(plannedEndAt, settings.delayMinutes, settings, data, {
              areaId: trimToString(areaId)
            });
            releases.push({
              availableAt: delayResolution.readyAt,
              qty: taskQty
            });
            releaseBatchesByOpId.set(trimToString(op.id), releases);
            if (settings.delayMinutes > 0 && delayResolution.trace.length) {
              const traceLabel = delayResolution.trace
                .map(item => `${trimToString(item.date)}/s${parseInt(item.shift, 10) || 1}${trimToString(item.segmentKey) ? `:${trimToString(item.segmentKey)}` : ''}:${Math.max(0, Math.round(item.consumedMinutes || 0))}`)
                .join(',');
              console.info(`[AUTO_PLAN] release-delay card=${trimToString(card?.id)} op=${trimToString(op?.id)} end=${plannedEndAt} delay=${settings.delayMinutes} ready=${delayResolution.readyAt} trace=${traceLabel}`);
            }
            if (trimToString(state.qtySourceOpId) && predecessorUsed > 0) {
              consumedQtyByOpId.set(trimToString(op.id), (consumedQtyByOpId.get(trimToString(op.id)) || 0) + predecessorUsed);
            }
          } else {
            state.remainingMinutes = Math.max(0, state.remainingMinutes - taskMinutes);
            completionByOpId.set(trimToString(op.id), plannedEndAt);
            completionAreaByOpId.set(trimToString(op.id), trimToString(areaId));
          }
          areaHasProgress = true;
          lastReason = '';
        }
      }
    }

    if ((state.qtyDriven && state.remainingQty > 0) || (!state.qtyDriven && state.remainingMinutes > 0)) {
      console.info(`[AUTO_PLAN] skip card=${trimToString(card?.id)} op=${trimToString(op?.id)} code=${trimToString(op?.opCode || op?.code)} reason=${trimToString(lastReason || 'Не удалось запланировать до дедлайна')} remainderMinutes=${Math.max(0, Math.round(state.remainingMinutes || 0))} remainderQty=${Math.max(0, Math.round(state.remainingQty || 0))}`);
      unplannedOperations.push(makeAutoPlanUnplannedLineServer(
        op,
        lastReason || 'Не удалось запланировать до дедлайна',
        state.remainingMinutes,
        state.remainingQty
      ));
    }
  });

  const affectedCells = Array.from(new Set(previewTasks.map(task => `${task.date}|${task.shift}|${task.areaId}`)))
    .map(key => {
      const [date, shift, areaId] = key.split('|');
      return { date, shift: parseInt(shift, 10) || 1, areaId };
    });

  if (save && previewTasks.length) {
    if (!Array.isArray(data.productionShiftTasks)) data.productionShiftTasks = [];
    data.productionShiftTasks = mergeProductionShiftTasksServer((data.productionShiftTasks || []).concat(previewTasks), data);
    reconcileCardPlanningTasksServer(data, card);
  }

  console.info(`[AUTO_PLAN] done card=${trimToString(card?.id)} save=${save === true ? 'true' : 'false'} createdTasks=${previewTasks.length} planned=${plannedOperations.length} unplanned=${unplannedOperations.length}`);

  return {
    ok: true,
    previewRunId,
    hasSuccessfulOperations: previewTasks.length > 0,
    plannedCount: plannedOperations.length,
    unplannedCount: unplannedOperations.length,
    plannedOperations,
    unplannedOperations,
    overloadedSlots: Array.from(overloadedSlots),
    blockedAreaNames,
    affectedCells,
    createdTasks: previewTasks
  };
}

function renderQuantityRow(card, op, { colspan = 9, blankForPrint = false } = {}) {
  const opQty = getOperationQuantity(op, card);
  const totalLabel = opQty === '' ? '—' : `${opQty} шт`;
  const base = `<span class="qty-total">Количество изделий: ${escapeHtml(totalLabel)}</span>`;
  const executionStats = getOperationExecutionStatsServer(card, op);
  const goodVal = executionStats.good;
  const scrapVal = executionStats.defect;
  const holdVal = executionStats.delayed;

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

const flowOperationConsistencyWarningsServer = new Set();

function getOperationExecutionStatsServer(card, op, { logConsistency = true } = {}) {
  const fallback = {
    good: toSafeCount(op?.goodCount || 0),
    defect: toSafeCount(op?.scrapCount || 0),
    delayed: toSafeCount(op?.holdCount || 0)
  };
  fallback.completed = fallback.good + fallback.defect + fallback.delayed;
  if (!card || !op || card.cardType !== 'MKI') return fallback;

  const source = op.flowStats || null;
  if (!source) return fallback;

  const normalized = {
    good: Math.max(0, Number(source.good || 0)),
    defect: Math.max(0, Number(source.defect || 0)),
    delayed: Math.max(0, Number(source.delayed || 0))
  };
  normalized.completed = Number.isFinite(Number(source.completed))
    ? Math.max(0, Number(source.completed))
    : (normalized.good + normalized.defect + normalized.delayed);

  if (logConsistency) {
    const storedGood = toSafeCount(op.goodCount || 0);
    const storedDefect = toSafeCount(op.scrapCount || 0);
    const storedDelayed = toSafeCount(op.holdCount || 0);
    if (
      storedGood !== normalized.good
      || storedDefect !== normalized.defect
      || storedDelayed !== normalized.delayed
    ) {
      const warningKey = [
        trimToString(card.id || ''),
        trimToString(op.id || op.opId || ''),
        storedGood,
        storedDefect,
        storedDelayed,
        normalized.good,
        normalized.defect,
        normalized.delayed
      ].join('|');
      if (!flowOperationConsistencyWarningsServer.has(warningKey)) {
        flowOperationConsistencyWarningsServer.add(warningKey);
        console.warn('[CONSISTENCY][FLOW] operation stats mismatch', {
          cardId: trimToString(card.id || ''),
          opId: trimToString(op.id || op.opId || ''),
          stored: { good: storedGood, defect: storedDefect, delayed: storedDelayed },
          flow: { good: normalized.good, defect: normalized.defect, delayed: normalized.delayed }
        });
      }
    }
  }

  return normalized;
}

function getSummaryShiftWindowServer(dateStr, shift, data) {
  if (!dateStr) return null;
  const base = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(base.getTime())) return null;
  const ref = (Array.isArray(data?.productionShiftTimes) ? data.productionShiftTimes : [])
    .find(item => (parseInt(item?.shift, 10) || 1) === (parseInt(shift, 10) || 1));
  const parseTime = (value) => {
    const raw = trimToString(value);
    const match = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    return (parseInt(match[1], 10) || 0) * 60 + (parseInt(match[2], 10) || 0);
  };
  const startMin = parseTime(ref?.timeFrom) ?? (((parseInt(shift, 10) || 1) - 1) * 8 * 60);
  let endMin = parseTime(ref?.timeTo);
  if (endMin == null) endMin = startMin + (8 * 60);
  if (endMin <= startMin) endMin += 24 * 60;
  return {
    start: base.getTime() + startMin * 60 * 1000,
    end: base.getTime() + endMin * 60 * 1000
  };
}

function buildSummaryOpStatusIntervalsServer(card, op) {
  const entries = (Array.isArray(card?.logs) ? card.logs : [])
    .filter(entry => entry && entry.targetId === op.id && trimToString(entry.field) === 'status')
    .slice()
    .sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const intervals = [];
  let activeStart = null;
  entries.forEach(entry => {
    const prev = trimToString(entry.oldValue).toUpperCase();
    const next = trimToString(entry.newValue).toUpperCase();
    const ts = Number(entry.ts) || 0;
    if (!ts) return;
    if (next === 'IN_PROGRESS' && prev !== 'IN_PROGRESS') {
      if (activeStart == null) activeStart = ts;
      return;
    }
    if (prev === 'IN_PROGRESS' && next !== 'IN_PROGRESS') {
      intervals.push({ start: activeStart != null ? activeStart : ts, end: ts, endStatus: next || 'PAUSED' });
      activeStart = null;
    }
  });
  if (activeStart != null) intervals.push({ start: activeStart, end: null, endStatus: 'IN_PROGRESS' });
  return intervals;
}

function splitSummaryIntervalsByShiftServer(card, op, data) {
  const intervals = buildSummaryOpStatusIntervalsServer(card, op);
  const byShiftKey = new Map();
  const shiftList = [1, 2, 3];
  const pushPart = (dateStr, shift, payload) => {
    const key = `${dateStr}|${shift}`;
    if (!byShiftKey.has(key)) {
      byShiftKey.set(key, {
        key,
        date: dateStr,
        shift,
        firstStart: null,
        lastEnd: null,
        elapsedSeconds: 0,
        hasDone: false,
        hasPause: false,
        hasActive: false
      });
    }
    const target = byShiftKey.get(key);
    if (payload.start != null) target.firstStart = target.firstStart == null ? payload.start : Math.min(target.firstStart, payload.start);
    if (payload.end != null) target.lastEnd = target.lastEnd == null ? payload.end : Math.max(target.lastEnd, payload.end);
    if (payload.elapsedSeconds) target.elapsedSeconds += payload.elapsedSeconds;
    if (payload.hasDone) target.hasDone = true;
    if (payload.hasPause) target.hasPause = true;
    if (payload.hasActive) target.hasActive = true;
  };
  intervals.forEach(interval => {
    const startTs = Number(interval.start) || 0;
    const endTs = interval.end == null ? Date.now() : Number(interval.end);
    if (!startTs || !endTs || endTs < startTs) return;
    const startDate = new Date(startTs);
    const endDate = new Date(endTs);
    for (
      let cursor = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
      cursor <= new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
      cursor.setDate(cursor.getDate() + 1)
    ) {
      const dateStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
      shiftList.forEach(shift => {
        const window = getSummaryShiftWindowServer(dateStr, shift, data);
        if (!window) return;
        const overlapStart = Math.max(startTs, window.start);
        const overlapEnd = Math.min(endTs, window.end);
        if (overlapEnd <= overlapStart) return;
        pushPart(dateStr, shift, {
          start: overlapStart,
          end: overlapEnd,
          elapsedSeconds: Math.max(0, Math.round((overlapEnd - overlapStart) / 1000)),
          hasDone: interval.endStatus === 'DONE' && interval.end != null && interval.end >= window.start && interval.end <= window.end,
          hasPause: interval.endStatus === 'PAUSED' && interval.end != null && interval.end >= window.start && interval.end <= window.end,
          hasActive: interval.end == null
        });
      });
    }
  });
  return byShiftKey;
}

function buildSummaryShiftSegmentsServer(data, card, op) {
  const taskGroups = new Map();
  (Array.isArray(data?.productionShiftTasks) ? data.productionShiftTasks : [])
    .filter(task => task && String(task.cardId || '') === String(card.id || '') && String(task.routeOpId || '') === String(op.id || ''))
    .forEach(task => {
      const key = `${task.date || ''}|${parseInt(task.shift, 10) || 1}`;
      if (!taskGroups.has(key)) {
        taskGroups.set(key, {
          key,
          date: String(task.date || ''),
          shift: parseInt(task.shift, 10) || 1,
          plannedMinutes: 0,
          tasks: []
        });
      }
      const bucket = taskGroups.get(key);
      bucket.tasks.push(task);
      bucket.plannedMinutes += getTaskPlannedMinutesServer(task, card, op);
    });

  const intervalFacts = splitSummaryIntervalsByShiftServer(card, op, data);
  const segmentKeys = new Set([...taskGroups.keys(), ...intervalFacts.keys()]);
  return Array.from(segmentKeys).map(key => {
    const taskGroup = taskGroups.get(key) || null;
    const intervalFact = intervalFacts.get(key) || null;
    const date = taskGroup?.date || intervalFact?.date || '';
    const shift = taskGroup?.shift || intervalFact?.shift || 1;
    const executors = [];
    const seen = new Set();
    (taskGroup?.tasks || []).forEach(task => {
      (Array.isArray(data?.productionSchedule) ? data.productionSchedule : [])
        .filter(rec =>
          rec &&
          String(rec.date || '') === String(task.date || '') &&
          String(rec.areaId || '') === String(task.areaId || '') &&
          Number(rec.shift || 0) === Number(task.shift || 0)
        )
        .forEach(rec => {
          const user = getUserByIdOrLegacy(data, rec.employeeId || '');
          const name = trimToString(user?.name || user?.username || user?.login || '');
          if (!name || seen.has(name)) return;
          seen.add(name);
          executors.push(name);
        });
    });
    if (!executors.length) {
      [op.executor].concat(op.additionalExecutors || []).map(trimToString).filter(Boolean).forEach(name => {
        if (seen.has(name)) return;
        seen.add(name);
        executors.push(name);
      });
    }
    let statusKey = 'NOT_STARTED';
    if (intervalFact?.hasActive) statusKey = 'IN_PROGRESS';
    else if (intervalFact?.hasDone) statusKey = 'DONE';
    else if (intervalFact?.hasPause) statusKey = 'PAUSED';
    else if (!taskGroup && op.status) statusKey = trimToString(op.status).toUpperCase() || 'NOT_STARTED';
    return {
      key,
      meta: `${date} · ${shift} смена`,
      date,
      shift,
      executors,
      plannedMinutes: taskGroup ? Math.max(0, Math.round(taskGroup.plannedMinutes || 0)) : null,
      statusKey,
      startAt: intervalFact?.firstStart ?? null,
      endAt: intervalFact?.lastEnd ?? null,
      elapsedSeconds: intervalFact?.elapsedSeconds ? Math.max(0, Math.round(intervalFact.elapsedSeconds)) : null
    };
  }).sort((a, b) => {
    const dateCmp = String(a.date || '').localeCompare(String(b.date || ''));
    if (dateCmp !== 0) return dateCmp;
    return (a.shift || 1) - (b.shift || 1);
  });
}

function renderOpCommentsForPrint(op) {
  const comments = Array.isArray(op?.comments) ? op.comments : [];
  if (!comments.length) return '—';
  return comments.map(entry => {
    const author = trimToString(entry?.author || '') || 'Пользователь';
    const ts = entry?.createdAt || entry?.ts ? formatDateTime(entry.createdAt || entry.ts) : '';
    const text = trimToString(entry?.text || '');
    const meta = [author, ts].filter(Boolean).join(' · ');
    return `<div class="print-op-comment">${escapeHtml(meta || 'Комментарий')}</div><div>${escapeHtml(text || '—')}</div>`;
  }).join('<hr class="print-op-comment-sep">');
}

function buildSummaryTableHtml(card, data, { blankForPrint = false } = {}) {
  const opsSorted = Array.isArray(card?.operations) ? [...card.operations] : [];
  opsSorted.sort((a, b) => (a.order || 0) - (b.order || 0));
  if (!opsSorted.length) return '<p>Маршрут пока пуст.</p>';

  let html = '<table><thead><tr>' +
    '<th>Порядок</th><th>Подразделение</th><th>Код операции</th><th>Наименование операции</th><th>Исполнитель</th><th>План (мин)</th><th>Статус</th><th>Дата и время Н/К</th><th>Текущее / факт. время</th><th>Комментарии</th>' +
    '</tr></thead><tbody>';

  opsSorted.forEach((op, idx) => {
    const elapsed = getOperationElapsedSeconds(op);
    const shiftSegments = buildSummaryShiftSegmentsServer(data, card, op);
    const useShiftSegments = shiftSegments.length > 1;
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
    const commentsPrintHtml = renderOpCommentsForPrint(op);

    if (useShiftSegments) {
      shiftSegments.forEach((segment, segmentIndex) => {
        const segmentExecutors = segment.executors.length
          ? segment.executors.map(name => `<div>${escapeHtml(name)}</div>`).join('')
          : '—';
        const segmentPlan = Number.isFinite(segment.plannedMinutes) && segment.plannedMinutes > 0 ? String(segment.plannedMinutes) : '—';
        const segmentStatus = statusBadge(segment.statusKey || 'NOT_STARTED');
        const segmentStart = segment.startAt ? formatDateTime(segment.startAt) : '—';
        const segmentEnd = segment.endAt ? formatDateTime(segment.endAt) : '—';
        const segmentNk = `<div class="nk-lines"><div>Н: ${escapeHtml(segmentStart)}</div><div>К: ${escapeHtml(segmentEnd)}</div></div>`;
        const segmentTime = segment.elapsedSeconds && segment.elapsedSeconds > 0 ? formatSecondsToHMS(segment.elapsedSeconds) : '—';
        html += '<tr' + (segmentIndex > 0 ? ' class="log-op-shift-row"' : '') + '>';
        if (segmentIndex === 0) {
          html += `<td rowspan="${shiftSegments.length}">${idx + 1}</td>` +
            `<td rowspan="${shiftSegments.length}">${escapeHtml(op.centerName || '')}</td>` +
            `<td rowspan="${shiftSegments.length}">${escapeHtml(op.opCode || '')}</td>` +
            `<td rowspan="${shiftSegments.length}">${escapeHtml(op.opName || op.name || '')}</td>`;
        }
        html += `<td>${segmentExecutors}</td>` +
          `<td><div class="log-op-shift-meta">${escapeHtml(segment.meta || '')}</div>${escapeHtml(segmentPlan)}</td>` +
          `<td>${segmentStatus}</td>` +
          `<td>${segmentNk}</td>` +
          `<td>${escapeHtml(segmentTime)}</td>` +
          `<td>${segmentIndex === 0 ? commentsPrintHtml : '—'}</td>` +
          '</tr>';
      });
    } else {
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
        `<td>${commentsPrintHtml}</td>` +
        '</tr>';
    }

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
    renderCardDisplayField('Планируемая дата завершения', card.plannedCompletionDate || '') +
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
      const normalized = normalizeQrInput(cardId);
      const card = (data.cards || []).find(c =>
        c &&
        c.isGroup !== true &&
        (c.id === cardId || normalizeQrInput(c.qrId || c.barcode || '') === normalized)
      );
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
        summaryHtml: buildSummaryTableHtml(card, data),
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
        summaryHtml: buildSummaryTableHtml(card, data, { blankForPrint: false }),
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

function canReadCardsCore(user, data) {
  if (hasFullAccess(user)) return true;
  const tabs = getUserPermissions(user, data?.accessLevels || []).tabs || {};
  return ['cards', 'approvals', 'provision', 'input-control', 'archive']
    .some(tabKey => Boolean(tabs?.[tabKey]?.view));
}

function canEditCardsCore(user, data) {
  if (hasFullAccess(user)) return true;
  const tabs = getUserPermissions(user, data?.accessLevels || []).tabs || {};
  return Boolean(tabs?.cards?.edit);
}

function canEditInputControlServer(user, data) {
  if (hasFullAccess(user)) return true;
  const tabs = getUserPermissions(user, data?.accessLevels || []).tabs || {};
  return Boolean(tabs?.['input-control']?.edit);
}

function normalizeCardsCoreArchivedMode(value) {
  const normalized = trimToString(value).toLowerCase();
  if (['true', '1', 'archived', 'only'].includes(normalized)) return 'only';
  if (['false', '0', 'active'].includes(normalized)) return 'active';
  return 'all';
}

function buildCardsCoreSearchHaystack(card) {
  return [
    trimToString(card?.id),
    trimToString(card?.qrId),
    trimToString(card?.barcode),
    trimToString(card?.routeCardNumber),
    trimToString(card?.name),
    trimToString(card?.orderNo),
    trimToString(card?.contractNumber),
    trimToString(card?.drawing),
    trimToString(card?.material),
    trimToString(card?.desc),
    trimToString(card?.issuedBySurname),
    trimToString(card?.cardType),
    trimToString(card?.approvalStage)
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function applyCardsCoreListQuery(cards, query = {}) {
  const archivedMode = normalizeCardsCoreArchivedMode(query.archived);
  const searchTerm = trimToString(query.q || query.query || '').toLowerCase();
  const limit = Number.parseInt(query.limit, 10);
  let result = Array.isArray(cards) ? cards.slice() : [];

  if (archivedMode === 'active') {
    result = result.filter(card => !card?.archived);
  } else if (archivedMode === 'only') {
    result = result.filter(card => Boolean(card?.archived));
  }

  if (searchTerm) {
    result = result.filter(card => buildCardsCoreSearchHaystack(card).includes(searchTerm));
  }

  if (Number.isFinite(limit) && limit > 0) {
    result = result.slice(0, limit);
  }

  return {
    cards: result.map(card => deepClone(card)),
    total: result.length,
    query: {
      archived: archivedMode,
      q: searchTerm
    }
  };
}

async function ensureCardsCoreDataReady() {
  let data = await database.getData();
  let cardsArr = Array.isArray(data?.cards) ? data.cards : [];
  const flowResult = ensureFlowForCards(cardsArr);
  let stateChanged = Boolean(flowResult.changed);
  flowResult.cards.forEach(card => {
    if (recalcProductionStateFromFlow(card)) stateChanged = true;
  });
  if (stateChanged) {
    await database.update(current => ({ ...current, cards: flowResult.cards }));
    data = await database.getData();
    cardsArr = Array.isArray(data?.cards) ? data.cards : [];
  }
  return { ...data, cards: cardsArr };
}

function extractCardsCoreCardInput(payload) {
  const source = payload?.card && typeof payload.card === 'object' && !Array.isArray(payload.card)
    ? payload.card
    : payload;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const next = deepClone(source);
  delete next.expectedRev;
  delete next.rev;
  return next;
}

function buildCardsCoreCreateCandidate(cardInput = {}) {
  const now = Date.now();
  const draftCard = normalizeCard({
    ...cardInput,
    id: genId('card'),
    archived: false,
    approvalStage: 'DRAFT',
    createdAt: now,
    updatedAt: now,
    attachments: [],
    inputControlFileId: '',
    rev: undefined
  });
  const snapshot = deepClone(draftCard);
  snapshot.logs = [];
  snapshot.initialSnapshot = null;
  draftCard.initialSnapshot = snapshot;
  return draftCard;
}

function buildCardsCoreUpdateCandidate(existingCard, cardInput = {}) {
  return normalizeCard({
    ...deepClone(existingCard),
    ...cardInput,
    id: existingCard.id,
    rev: undefined,
    createdAt: existingCard.createdAt || Date.now(),
    initialSnapshot: existingCard.initialSnapshot || null,
    attachments: Array.isArray(existingCard.attachments) ? deepClone(existingCard.attachments) : [],
    inputControlFileId: trimToString(existingCard.inputControlFileId || '')
  });
}

function buildCardsCoreCopySuffix(value, usedValues = []) {
  const trimmed = trimToString(value);
  if (!trimmed) return '';
  const base = trimmed.replace(/-copy\d*$/i, '');
  const basePrefix = `${base}-copy`;
  let maxSuffix = -1;
  (usedValues || []).forEach(raw => {
    const candidate = trimToString(raw);
    if (!candidate.startsWith(basePrefix)) return;
    const suffix = candidate.slice(basePrefix.length);
    if (!suffix) {
      maxSuffix = Math.max(maxSuffix, 0);
      return;
    }
    if (!/^\d+$/.test(suffix)) return;
    maxSuffix = Math.max(maxSuffix, parseInt(suffix, 10));
  });
  if (maxSuffix >= 0) {
    return `${basePrefix}${String(maxSuffix + 1)}`;
  }
  return basePrefix;
}

function getCardsCoreIssuedSurname(user) {
  const name = trimToString(user?.name || user?.username || user?.login || '');
  if (!name) return '';
  return name.split(/\s+/)[0] || '';
}

function formatCardsCoreLocalDateValue(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildCardsCoreRepeatInput(sourceCard, data, authedUser) {
  const now = Date.now();
  const cardsList = Array.isArray(data?.cards) ? data.cards : [];
  const baseName = trimToString(sourceCard?.itemName || sourceCard?.name || '');
  const usedRouteNumbers = cardsList.map(card => trimToString(card?.routeCardNumber)).filter(Boolean);
  const usedDocDesignations = cardsList.map(card => trimToString(card?.documentDesignation)).filter(Boolean);
  const usedItemNames = cardsList.map(card => trimToString(card?.itemName || card?.name)).filter(Boolean);
  const repeatedName = buildCardsCoreCopySuffix(baseName, usedItemNames);
  const sampleCount = sourceCard?.sampleCount == null || sourceCard?.sampleCount === ''
    ? ''
    : toSafeCountServer(sourceCard.sampleCount);
  const witnessSampleCount = sourceCard?.witnessSampleCount == null || sourceCard?.witnessSampleCount === ''
    ? ''
    : toSafeCountServer(sourceCard.witnessSampleCount);
  const currentYear = new Date(now).getFullYear();
  const serialBase = repeatedName || baseName;

  return {
    barcode: generateUniqueCode128(cardsList),
    qrId: generateUniqueQrId(cardsList),
    routeCardNumber: buildCardsCoreCopySuffix(sourceCard?.routeCardNumber || '', usedRouteNumbers),
    documentDesignation: buildCardsCoreCopySuffix(sourceCard?.documentDesignation || '', usedDocDesignations),
    documentDate: formatCardsCoreLocalDateValue(now),
    plannedCompletionDate: /^\d{4}-\d{2}-\d{2}$/.test(trimToString(sourceCard?.plannedCompletionDate))
      ? trimToString(sourceCard.plannedCompletionDate)
      : '',
    issuedBySurname: getCardsCoreIssuedSurname(authedUser),
    itemName: repeatedName,
    name: repeatedName || baseName || 'Маршрутная карта',
    workBasis: sourceCard?.workBasis || '',
    itemDesignation: sourceCard?.itemDesignation || '',
    programName: sourceCard?.programName || '',
    labRequestNumber: sourceCard?.labRequestNumber || '',
    supplyState: sourceCard?.supplyState || '',
    supplyStandard: sourceCard?.supplyStandard || '',
    specialNotes: sourceCard?.specialNotes || sourceCard?.desc || '',
    desc: sourceCard?.specialNotes || sourceCard?.desc || '',
    mainMaterialGrade: sourceCard?.mainMaterialGrade || sourceCard?.material || '',
    mainMaterials: '',
    materialIssues: [],
    quantity: sourceCard?.quantity != null ? sourceCard.quantity : '',
    batchSize: sourceCard?.quantity != null ? sourceCard.quantity : '',
    itemSerials: Array.isArray(sourceCard?.itemSerials)
      ? deepClone(sourceCard.itemSerials)
      : normalizeFlowSerialList(sourceCard?.itemSerials, toSafeCountServer(sourceCard?.quantity)),
    sampleCount,
    witnessSampleCount,
    sampleSerials: normalizeAutoSampleSerialsServer([], toSafeCountServer(sampleCount || 0), 'К', serialBase, currentYear),
    witnessSampleSerials: normalizeAutoSampleSerialsServer([], toSafeCountServer(witnessSampleCount || 0), 'С', serialBase, currentYear),
    partQrs: {},
    operations: (Array.isArray(sourceCard?.operations) ? sourceCard.operations : []).map(op => ({
      ...deepClone(op),
      id: genId('rop'),
      status: 'NOT_STARTED',
      firstStartedAt: null,
      startedAt: null,
      lastPausedAt: null,
      finishedAt: null,
      elapsedSeconds: 0,
      actualSeconds: null,
      comment: '',
      comments: [],
      goodCount: 0,
      scrapCount: 0,
      holdCount: 0
    })),
    approvalStage: 'DRAFT',
    approvalProductionStatus: null,
    approvalSKKStatus: null,
    approvalTechStatus: null,
    rejectionReason: '',
    rejectionReadByUserName: '',
    rejectionReadAt: null,
    approvalThread: [],
    archived: false,
    status: 'NOT_STARTED',
    createdAt: now,
    updatedAt: now,
    logs: [],
    initialSnapshot: null,
    attachments: [],
    inputControlFileId: '',
    inputControlComment: '',
    inputControlDoneAt: null,
    inputControlDoneBy: '',
    provisionDoneAt: null,
    provisionDoneBy: '',
    personalOperations: [],
    flow: {
      items: [],
      samples: [],
      events: [],
      archivedItems: [],
      version: 1
    }
  };
}

const CARD_APPROVAL_ROLE_CONFIG = [
  {
    key: 'production',
    statusField: 'approvalProductionStatus',
    permissionField: 'headProduction',
    roleContext: 'PRODUCTION',
    responsibleNameField: 'responsibleProductionChief',
    responsibleAtField: 'responsibleProductionChiefAt'
  },
  {
    key: 'skk',
    statusField: 'approvalSKKStatus',
    permissionField: 'headSKK',
    roleContext: 'SKK',
    responsibleNameField: 'responsibleSKKChief',
    responsibleAtField: 'responsibleSKKChiefAt'
  },
  {
    key: 'tech',
    statusField: 'approvalTechStatus',
    permissionField: 'deputyTechDirector',
    roleContext: 'TECH',
    responsibleNameField: 'responsibleTechLead',
    responsibleAtField: 'responsibleTechLeadAt'
  }
];

const CARD_APPROVAL_STATUS_APPROVED = 'Согласовано';
const CARD_APPROVAL_STATUS_REJECTED = 'Не согласовано';
const CARD_APPROVAL_STAGE_DRAFT = 'DRAFT';
const CARD_APPROVAL_STAGE_ON_APPROVAL = 'ON_APPROVAL';
const CARD_APPROVAL_STAGE_REJECTED = 'REJECTED';
const CARD_APPROVAL_STAGE_APPROVED = 'APPROVED';

function createApprovalCommandError(statusCode, message, code = 'APPROVAL_COMMAND_ERROR') {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

function getCardRevisionValue(card) {
  const rev = Number(card?.rev);
  return Number.isFinite(rev) && rev > 0 ? rev : 1;
}

function getApprovalActorName(user) {
  return trimToString(user?.name || user?.username || user?.login || '') || 'Пользователь';
}

function normalizeApprovalComment(value, {
  required = false,
  maxLength = 600,
  fieldLabel = 'Комментарий'
} = {}) {
  const comment = trimToString(value);
  if (required && !comment) {
    throw createApprovalCommandError(400, `${fieldLabel} обязателен`, 'APPROVAL_COMMENT_REQUIRED');
  }
  if (comment.length > maxLength) {
    throw createApprovalCommandError(400, `${fieldLabel} не должен превышать ${maxLength} символов`, 'APPROVAL_COMMENT_TOO_LONG');
  }
  return comment;
}

function canEditApprovalsServer(user, data) {
  if (hasFullAccess(user)) return true;
  const tabs = getUserPermissions(user, data?.accessLevels || []).tabs || {};
  return Boolean(tabs?.approvals?.edit);
}

function getApprovalRolesForUserServer(user, data) {
  if (hasFullAccess(user) || isAbyssUser(user)) {
    return CARD_APPROVAL_ROLE_CONFIG.slice();
  }
  const permissions = getUserPermissions(user, data?.accessLevels || []);
  return CARD_APPROVAL_ROLE_CONFIG.filter(role => Boolean(permissions?.[role.permissionField]));
}

function appendApprovalLog(card, field, oldValue, newValue, userName) {
  appendCardLog(card, {
    action: 'approval',
    field,
    oldValue,
    newValue,
    userName,
    createdBy: userName
  });
}

function pushApprovalThreadEntry(card, { userName, actionType, roleContext = '', comment = '' } = {}) {
  if (!Array.isArray(card.approvalThread)) card.approvalThread = [];
  card.approvalThread.push({
    ts: Date.now(),
    userName: trimToString(userName) || 'Пользователь',
    actionType: trimToString(actionType),
    roleContext: trimToString(roleContext),
    comment: trimToString(comment)
  });
}

function areAllCardApprovalsApprovedServer(card) {
  return CARD_APPROVAL_ROLE_CONFIG.every(role => card?.[role.statusField] === CARD_APPROVAL_STATUS_APPROVED);
}

function hasAnyCardApprovalRejectedServer(card) {
  return CARD_APPROVAL_ROLE_CONFIG.some(role => card?.[role.statusField] === CARD_APPROVAL_STATUS_REJECTED);
}

function syncCardApprovalStageServer(card) {
  if (!card || trimToString(card.approvalStage) !== CARD_APPROVAL_STAGE_ON_APPROVAL) return;
  if (areAllCardApprovalsApprovedServer(card)) {
    card.approvalStage = CARD_APPROVAL_STAGE_APPROVED;
    return;
  }
  if (hasAnyCardApprovalRejectedServer(card)) {
    card.approvalStage = CARD_APPROVAL_STAGE_REJECTED;
  }
}

function applySendToApprovalCommand(card, { userName, comment }) {
  if (card.archived) {
    throw createApprovalCommandError(409, 'Архивную карточку нельзя отправить на согласование', 'APPROVAL_INVALID_STATE');
  }
  if (trimToString(card.approvalStage) !== CARD_APPROVAL_STAGE_DRAFT) {
    throw createApprovalCommandError(409, 'Отправка на согласование доступна только для черновика', 'APPROVAL_INVALID_STATE');
  }
  const previousStage = card.approvalStage;
  card.approvalStage = CARD_APPROVAL_STAGE_ON_APPROVAL;
  card.approvalProductionStatus = null;
  card.approvalSKKStatus = null;
  card.approvalTechStatus = null;
  card.rejectionReason = '';
  card.rejectionReadByUserName = '';
  card.rejectionReadAt = null;
  pushApprovalThreadEntry(card, {
    userName,
    actionType: 'SEND_TO_APPROVAL',
    comment
  });
  appendApprovalLog(card, 'approvalStage', previousStage, card.approvalStage, userName);
}

function applyApproveCardCommand(card, { userName, roles, comment }) {
  if (card.archived) {
    throw createApprovalCommandError(409, 'Архивную карточку нельзя согласовать', 'APPROVAL_INVALID_STATE');
  }
  if (trimToString(card.approvalStage) !== CARD_APPROVAL_STAGE_ON_APPROVAL) {
    throw createApprovalCommandError(409, 'Согласование доступно только на этапе согласования', 'APPROVAL_INVALID_STATE');
  }
  const pendingRoles = (roles || []).filter(role => card?.[role.statusField] == null);
  if (!pendingRoles.length) {
    throw createApprovalCommandError(409, 'Для текущего пользователя нет доступных направлений согласования', 'APPROVAL_INVALID_STATE');
  }
  pendingRoles.forEach(role => {
    const oldStatus = card[role.statusField];
    card[role.statusField] = CARD_APPROVAL_STATUS_APPROVED;
    appendApprovalLog(card, role.statusField, oldStatus, card[role.statusField], userName);

    const oldName = card[role.responsibleNameField];
    const oldAt = card[role.responsibleAtField];
    card[role.responsibleNameField] = userName;
    card[role.responsibleAtField] = Date.now();
    appendApprovalLog(card, role.responsibleNameField, oldName, card[role.responsibleNameField], userName);
    appendApprovalLog(card, role.responsibleAtField, oldAt, card[role.responsibleAtField], userName);

    pushApprovalThreadEntry(card, {
      userName,
      actionType: 'APPROVE',
      roleContext: role.roleContext,
      comment
    });
  });

  const previousStage = card.approvalStage;
  syncCardApprovalStageServer(card);
  if (previousStage !== card.approvalStage) {
    appendApprovalLog(card, 'approvalStage', previousStage, card.approvalStage, userName);
  }
}

function applyRejectCardCommand(card, { userName, roles, reason }) {
  if (card.archived) {
    throw createApprovalCommandError(409, 'Архивную карточку нельзя отклонить', 'APPROVAL_INVALID_STATE');
  }
  if (trimToString(card.approvalStage) !== CARD_APPROVAL_STAGE_ON_APPROVAL) {
    throw createApprovalCommandError(409, 'Отклонение доступно только на этапе согласования', 'APPROVAL_INVALID_STATE');
  }
  if (!Array.isArray(roles) || !roles.length) {
    throw createApprovalCommandError(403, 'Недостаточно прав для отклонения карточки', 'APPROVAL_FORBIDDEN');
  }

  const previousStage = card.approvalStage;
  card.approvalStage = CARD_APPROVAL_STAGE_REJECTED;
  card.rejectionReason = reason;
  card.rejectionReadByUserName = '';
  card.rejectionReadAt = null;

  roles.forEach(role => {
    const oldStatus = card[role.statusField];
    card[role.statusField] = CARD_APPROVAL_STATUS_REJECTED;
    appendApprovalLog(card, role.statusField, oldStatus, card[role.statusField], userName);

    const oldName = card[role.responsibleNameField];
    const oldAt = card[role.responsibleAtField];
    card[role.responsibleNameField] = '';
    card[role.responsibleAtField] = null;
    appendApprovalLog(card, role.responsibleNameField, oldName, card[role.responsibleNameField], userName);
    appendApprovalLog(card, role.responsibleAtField, oldAt, card[role.responsibleAtField], userName);

    pushApprovalThreadEntry(card, {
      userName,
      actionType: 'REJECT',
      roleContext: role.roleContext,
      comment: reason
    });
  });

  appendApprovalLog(card, 'approvalStage', previousStage, card.approvalStage, userName);
}

function applyReturnRejectedCardToDraftCommand(card, { userName, comment }) {
  if (card.archived) {
    throw createApprovalCommandError(409, 'Архивную карточку нельзя вернуть в черновик', 'APPROVAL_INVALID_STATE');
  }
  if (trimToString(card.approvalStage) !== CARD_APPROVAL_STAGE_REJECTED) {
    throw createApprovalCommandError(409, 'Возврат в черновик доступен только для отклоненной карточки', 'APPROVAL_INVALID_STATE');
  }
  if (trimToString(card.rejectionReadByUserName)) {
    throw createApprovalCommandError(409, 'Отклонение уже было подтверждено пользователем', 'APPROVAL_INVALID_STATE');
  }

  const previousStage = card.approvalStage;
  card.rejectionReadByUserName = userName;
  card.rejectionReadAt = Date.now();
  pushApprovalThreadEntry(card, {
    userName,
    actionType: 'UNFREEZE',
    comment
  });
  card.approvalStage = CARD_APPROVAL_STAGE_DRAFT;
  appendApprovalLog(card, 'approvalStage', previousStage, card.approvalStage, userName);
}

function syncCardPostApprovalStageServer(card) {
  if (!card) return '';
  const stage = trimToString(card.approvalStage).toUpperCase();
  if (![
    CARD_APPROVAL_STAGE_APPROVED,
    'WAITING_INPUT_CONTROL',
    'WAITING_PROVISION',
    'PROVIDED'
  ].includes(stage)) {
    return stage;
  }
  const hasIC = !!card.inputControlDoneAt;
  const hasPR = !!card.provisionDoneAt;
  let nextStage = CARD_APPROVAL_STAGE_APPROVED;
  if (hasIC && hasPR) {
    nextStage = 'PROVIDED';
  } else if (hasIC) {
    nextStage = 'WAITING_PROVISION';
  } else if (hasPR) {
    nextStage = 'WAITING_INPUT_CONTROL';
  }
  card.approvalStage = nextStage;
  return nextStage;
}

function applyInputControlCardCommand(card, { userName, comment }) {
  if (card.archived) {
    throw createApprovalCommandError(409, 'Архивную карточку нельзя отправить на входной контроль', 'INPUT_CONTROL_INVALID_STATE');
  }
  const stage = trimToString(card.approvalStage).toUpperCase();
  if (![
    CARD_APPROVAL_STAGE_APPROVED,
    'WAITING_INPUT_CONTROL',
    'WAITING_PROVISION'
  ].includes(stage)) {
    throw createApprovalCommandError(409, 'Входной контроль доступен только после согласования', 'INPUT_CONTROL_INVALID_STATE');
  }
  if (card.inputControlDoneAt) {
    throw createApprovalCommandError(409, 'Входной контроль уже выполнен', 'INPUT_CONTROL_INVALID_STATE');
  }
  const previousComment = trimToString(card.inputControlComment);
  const previousStage = trimToString(card.approvalStage);
  card.inputControlComment = comment;
  card.inputControlDoneAt = Date.now();
  card.inputControlDoneBy = userName;
  syncCardPostApprovalStageServer(card);
  appendCardLog(card, {
    action: 'Входной контроль',
    object: 'Карта',
    field: 'inputControlComment',
    oldValue: previousComment,
    newValue: card.inputControlComment,
    userName
  });
  if (previousStage !== card.approvalStage) {
    appendCardLog(card, {
      action: 'Входной контроль',
      object: 'Карта',
      field: 'approvalStage',
      oldValue: previousStage,
      newValue: card.approvalStage,
      userName
    });
  }
}

function getCardsCoreApprovalCommandDescriptor(commandKey) {
  const normalizedCommand = trimToString(commandKey).toLowerCase();
  if (normalizedCommand === 'send') {
    return {
      key: 'send',
      successStatus: 200,
      getUserContext(user, data) {
        if (!canEditCardsCore(user, data)) {
          throw createApprovalCommandError(403, 'Недостаточно прав для отправки карточки на согласование', 'APPROVAL_FORBIDDEN');
        }
        return {
          userName: getApprovalActorName(user)
        };
      },
      getPayload(payload) {
        return {
          comment: normalizeApprovalComment(payload?.comment, {
            required: false,
            fieldLabel: 'Комментарий'
          })
        };
      },
      apply(card, payload, context) {
        applySendToApprovalCommand(card, {
          userName: context.userName,
          comment: payload.comment
        });
      }
    };
  }
  if (normalizedCommand === 'approve') {
    return {
      key: 'approve',
      successStatus: 200,
      getUserContext(user, data) {
        if (!canEditApprovalsServer(user, data)) {
          throw createApprovalCommandError(403, 'Недостаточно прав для согласования карточки', 'APPROVAL_FORBIDDEN');
        }
        const roles = getApprovalRolesForUserServer(user, data);
        if (!roles.length) {
          throw createApprovalCommandError(403, 'Недостаточно прав для согласования карточки', 'APPROVAL_FORBIDDEN');
        }
        return {
          userName: getApprovalActorName(user),
          roles
        };
      },
      getPayload(payload) {
        return {
          comment: normalizeApprovalComment(payload?.comment, {
            required: false,
            fieldLabel: 'Комментарий'
          })
        };
      },
      apply(card, payload, context) {
        applyApproveCardCommand(card, {
          userName: context.userName,
          roles: context.roles,
          comment: payload.comment
        });
      }
    };
  }
  if (normalizedCommand === 'reject') {
    return {
      key: 'reject',
      successStatus: 200,
      getUserContext(user, data) {
        if (!canEditApprovalsServer(user, data)) {
          throw createApprovalCommandError(403, 'Недостаточно прав для отклонения карточки', 'APPROVAL_FORBIDDEN');
        }
        const roles = getApprovalRolesForUserServer(user, data);
        if (!roles.length) {
          throw createApprovalCommandError(403, 'Недостаточно прав для отклонения карточки', 'APPROVAL_FORBIDDEN');
        }
        return {
          userName: getApprovalActorName(user),
          roles
        };
      },
      getPayload(payload) {
        return {
          reason: normalizeApprovalComment(payload?.reason ?? payload?.comment, {
            required: true,
            fieldLabel: 'Причина отклонения'
          })
        };
      },
      apply(card, payload, context) {
        applyRejectCardCommand(card, {
          userName: context.userName,
          roles: context.roles,
          reason: payload.reason
        });
      }
    };
  }
  if (normalizedCommand === 'return-to-draft') {
    return {
      key: 'return-to-draft',
      successStatus: 200,
      getUserContext(user, data) {
        if (!canEditCardsCore(user, data)) {
          throw createApprovalCommandError(403, 'Недостаточно прав для возврата карточки в черновик', 'APPROVAL_FORBIDDEN');
        }
        return {
          userName: getApprovalActorName(user)
        };
      },
      getPayload(payload) {
        return {
          comment: normalizeApprovalComment(payload?.comment, {
            required: true,
            fieldLabel: 'Комментарий'
          })
        };
      },
      apply(card, payload, context) {
        applyReturnRejectedCardToDraftCommand(card, {
          userName: context.userName,
          comment: payload.comment
        });
      }
    };
  }
  return null;
}

function getCardsCoreInputControlCommandDescriptor(commandKey) {
  const normalizedCommand = trimToString(commandKey).toLowerCase();
  if (normalizedCommand !== 'complete') return null;
  return {
    key: 'complete',
    successStatus: 200,
    getUserContext(user, data) {
      if (!canEditInputControlServer(user, data)) {
        throw createApprovalCommandError(403, 'Недостаточно прав для входного контроля', 'INPUT_CONTROL_FORBIDDEN');
      }
      return {
        userName: getApprovalActorName(user)
      };
    },
    getPayload(payload) {
      return {
        comment: normalizeApprovalComment(payload?.comment, {
          required: true,
          fieldLabel: 'Комментарий'
        })
      };
    },
    apply(card, payload, context) {
      applyInputControlCardCommand(card, {
        userName: context.userName,
        comment: payload.comment
      });
    }
  };
}

async function handleCardsCoreRoutes(req, res, parsed) {
  const pathname = parsed?.pathname || '';
  if (pathname !== '/api/cards-core' && !pathname.startsWith('/api/cards-core/')) return false;

  const requireCsrf = req.method !== 'GET';
  const authedUser = await ensureAuthenticated(req, res, { requireCsrf });
  if (!authedUser) return true;

  const data = await ensureCardsCoreDataReady();

  if (req.method === 'GET' && pathname === '/api/cards-core') {
    if (!canReadCardsCore(authedUser, data)) {
      sendJson(res, 403, { error: 'Недостаточно прав для просмотра карточек' });
      return true;
    }
    sendJson(res, 200, applyCardsCoreListQuery(data.cards || [], parsed.query || {}));
    return true;
  }

  const pathSegments = pathname.split('/').filter(Boolean);
  const cardKey = pathSegments.length >= 3 ? decodeURIComponent(pathSegments[2] || '') : '';
  const approvalCommand = pathSegments.length === 5 && trimToString(pathSegments[3]).toLowerCase() === 'approval'
    ? getCardsCoreApprovalCommandDescriptor(pathSegments[4])
    : null;
  const inputControlCommand = pathSegments.length === 5 && trimToString(pathSegments[3]).toLowerCase() === 'input-control'
    ? getCardsCoreInputControlCommandDescriptor(pathSegments[4])
    : null;

  if (req.method === 'GET' && cardKey) {
    if (!canReadCardsCore(authedUser, data)) {
      sendJson(res, 403, { error: 'Недостаточно прав для просмотра карточки' });
      return true;
    }
    const card = findCardByKey(data, cardKey);
    if (!card) {
      sendJson(res, 404, { error: 'Карточка не найдена' });
      return true;
    }
    sendJson(res, 200, { card: deepClone(card) });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/cards-core') {
    if (!canEditCardsCore(authedUser, data)) {
      sendJson(res, 403, { error: 'Недостаточно прав для создания карточки' });
      return true;
    }
    const raw = await parseBody(req).catch(() => '');
    const payload = parseJsonBody(raw);
    if (!payload) {
      sendJson(res, 400, { error: 'Некорректные данные' });
      return true;
    }
    const cardInput = extractCardsCoreCardInput(payload);
    if (!cardInput) {
      sendJson(res, 400, { error: 'Некорректные данные карточки' });
      return true;
    }

    const prev = await database.getData();
    const createdCard = buildCardsCoreCreateCandidate(cardInput);
    const saved = await database.update(current => {
      const draft = normalizeData(current);
      draft.cards = Array.isArray(draft.cards) ? draft.cards : [];
      draft.cards.push(createdCard);
      return draft;
    });
    const savedCard = findCardByKey(saved, createdCard.id);
    console.info('[DATA] cards-core create ok', {
      cardId: savedCard?.id || createdCard.id,
      rev: Number.isFinite(savedCard?.rev) ? savedCard.rev : null
    });
    broadcastCardsChanged(saved);
    broadcastCardMutationEvents(prev, saved);
    sendJson(res, 201, { card: deepClone(savedCard || createdCard) });
    return true;
  }

  if ((req.method === 'PUT' || req.method === 'PATCH') && cardKey) {
    if (!canEditCardsCore(authedUser, data)) {
      sendJson(res, 403, { error: 'Недостаточно прав для изменения карточки' });
      return true;
    }
    const existingCard = findCardByKey(data, cardKey);
    if (!existingCard) {
      sendJson(res, 404, { error: 'Карточка не найдена' });
      return true;
    }

    const raw = await parseBody(req).catch(() => '');
    const payload = parseJsonBody(raw);
    if (!payload) {
      sendJson(res, 400, { error: 'Некорректные данные' });
      return true;
    }

    const payloadId = trimToString(payload?.id || payload?.card?.id);
    if (payloadId && payloadId !== existingCard.id) {
      sendJson(res, 400, { error: 'Идентификатор карточки не совпадает с URL' });
      return true;
    }

    const expectedRev = normalizeExpectedRevisionInput(payload?.expectedRev ?? payload?.card?.expectedRev ?? payload);
    if (!Number.isFinite(expectedRev)) {
      sendJson(res, 400, { error: 'Не указана ожидаемая ревизия expectedRev' });
      return true;
    }

    const actualRev = Number.isFinite(existingCard.rev) ? existingCard.rev : 1;
    if (expectedRev !== actualRev) {
      sendConflictResponse(res, {
        code: 'STALE_REVISION',
        entity: 'card',
        id: existingCard.id,
        expectedRev,
        actualRev,
        message: 'Версия карточки устарела'
      }, req);
      return true;
    }

    const cardInput = extractCardsCoreCardInput(payload);
    if (!cardInput) {
      sendJson(res, 400, { error: 'Некорректные данные карточки' });
      return true;
    }

    const prev = await database.getData();
    const nextCard = buildCardsCoreUpdateCandidate(existingCard, cardInput);
    let saved;
    try {
      saved = await database.update(current => {
        const draft = normalizeData(current);
        const currentCard = findCardByKey(draft, existingCard.id);
        if (!currentCard) {
          const err = new Error('Карточка не найдена');
          err.code = 'CARD_NOT_FOUND';
          throw err;
        }
        const currentActualRev = Number.isFinite(currentCard.rev) ? currentCard.rev : 1;
        if (expectedRev !== currentActualRev) {
          const err = new Error('Версия карточки устарела');
          err.code = 'STALE_REVISION';
          err.expectedRev = expectedRev;
          err.actualRev = currentActualRev;
          err.cardId = currentCard.id;
          throw err;
        }
        const idx = (draft.cards || []).findIndex(card => trimToString(card?.id) === existingCard.id);
        draft.cards[idx] = nextCard;
        return draft;
      });
    } catch (err) {
      if (err?.code === 'STALE_REVISION') {
        sendConflictResponse(res, {
          code: 'STALE_REVISION',
          entity: 'card',
          id: trimToString(err.cardId || existingCard.id),
          expectedRev: Number.isFinite(err.expectedRev) ? err.expectedRev : expectedRev,
          actualRev: Number.isFinite(err.actualRev) ? err.actualRev : actualRev,
          message: 'Версия карточки устарела'
        }, req);
        return true;
      }
      if (err?.code === 'CARD_NOT_FOUND') {
        sendJson(res, 404, { error: 'Карточка не найдена' });
        return true;
      }
      throw err;
    }
    const savedCard = findCardByKey(saved, existingCard.id);
    console.info('[DATA] cards-core update ok', {
      cardId: savedCard?.id || existingCard.id,
      expectedRev,
      rev: Number.isFinite(savedCard?.rev) ? savedCard.rev : null
    });
    broadcastCardsChanged(saved);
    broadcastCardMutationEvents(prev, saved);
    sendJson(res, 200, { card: deepClone(savedCard || nextCard) });
    return true;
  }

  if (req.method === 'POST' && cardKey && approvalCommand) {
    const existingCard = findCardByKey(data, cardKey);
    if (!existingCard) {
      sendJson(res, 404, { error: 'Карточка не найдена' });
      return true;
    }

    const raw = await parseBody(req).catch(() => '');
    const payload = raw ? parseJsonBody(raw) : {};
    if (raw && !payload) {
      sendJson(res, 400, { error: 'Некорректные данные' });
      return true;
    }

    const expectedRev = normalizeExpectedRevisionInput(payload?.expectedRev ?? payload);
    if (!Number.isFinite(expectedRev)) {
      sendJson(res, 400, { error: 'Не указана ожидаемая ревизия expectedRev' });
      return true;
    }

    const actualRev = getCardRevisionValue(existingCard);
    if (expectedRev !== actualRev) {
      sendConflictResponse(res, {
        code: 'STALE_REVISION',
        entity: 'card',
        id: existingCard.id,
        expectedRev,
        actualRev,
        message: 'Версия карточки устарела'
      }, req);
      return true;
    }

    let commandPayload;
    let initialUserContext;
    try {
      commandPayload = approvalCommand.getPayload(payload || {});
      initialUserContext = approvalCommand.getUserContext(authedUser, data);
    } catch (err) {
      const statusCode = Number(err?.statusCode) || 400;
      sendJson(res, statusCode, { error: err?.message || 'Не удалось выполнить команду согласования' });
      return true;
    }

    const prev = await database.getData();
    let saved;
    try {
      saved = await database.update(current => {
        const draft = normalizeData(current);
        const currentCard = findCardByKey(draft, existingCard.id);
        if (!currentCard) {
          const err = createApprovalCommandError(404, 'Карточка не найдена', 'CARD_NOT_FOUND');
          err.cardId = existingCard.id;
          throw err;
        }
        const currentActualRev = getCardRevisionValue(currentCard);
        if (expectedRev !== currentActualRev) {
          const err = createApprovalCommandError(409, 'Версия карточки устарела', 'STALE_REVISION');
          err.expectedRev = expectedRev;
          err.actualRev = currentActualRev;
          err.cardId = currentCard.id;
          throw err;
        }
        const currentUserContext = approvalCommand.getUserContext(authedUser, draft);
        approvalCommand.apply(currentCard, commandPayload, currentUserContext);
        currentCard.updatedAt = Date.now();
        return draft;
      });
    } catch (err) {
      if (err?.code === 'STALE_REVISION') {
        sendConflictResponse(res, {
          code: 'STALE_REVISION',
          entity: 'card',
          id: trimToString(err.cardId || existingCard.id),
          expectedRev: Number.isFinite(err.expectedRev) ? err.expectedRev : expectedRev,
          actualRev: Number.isFinite(err.actualRev) ? err.actualRev : actualRev,
          message: 'Версия карточки устарела'
        }, req);
        return true;
      }
      if (err?.code === 'CARD_NOT_FOUND') {
        sendJson(res, 404, { error: 'Карточка не найдена' });
        return true;
      }
      if (err?.code === 'APPROVAL_FORBIDDEN') {
        sendJson(res, 403, { error: err.message || 'Недостаточно прав' });
        return true;
      }
      if (err?.code === 'APPROVAL_INVALID_STATE') {
        sendConflictResponse(res, {
          code: 'INVALID_STATE',
          entity: 'card.approval',
          id: trimToString(err.cardId || existingCard.id),
          expectedRev,
          actualRev: Number.isFinite(err.actualRev) ? err.actualRev : getCardRevisionValue(findCardByKey(await database.getData(), existingCard.id)),
          message: err.message || 'Команда согласования недоступна в текущем статусе'
        }, req);
        return true;
      }
      if (Number(err?.statusCode) === 400) {
        sendJson(res, 400, { error: err.message || 'Некорректные данные' });
        return true;
      }
      throw err;
    }

    const savedCard = findCardByKey(saved, existingCard.id);
    console.info('[DATA] cards approval command ok', {
      command: approvalCommand.key,
      cardId: savedCard?.id || existingCard.id,
      expectedRev,
      rev: Number.isFinite(savedCard?.rev) ? savedCard.rev : null,
      approvalStage: trimToString(savedCard?.approvalStage || ''),
      actor: initialUserContext?.userName || null
    });
    broadcastCardsChanged(saved);
    broadcastCardMutationEvents(prev, saved);
    sendJson(res, approvalCommand.successStatus || 200, {
      command: approvalCommand.key,
      card: deepClone(savedCard || existingCard)
    });
    return true;
  }

  if (req.method === 'POST' && cardKey && inputControlCommand) {
    const existingCard = findCardByKey(data, cardKey);
    if (!existingCard) {
      sendJson(res, 404, { error: 'Карточка не найдена' });
      return true;
    }

    const raw = await parseBody(req).catch(() => '');
    const payload = raw ? parseJsonBody(raw) : {};
    if (raw && !payload) {
      sendJson(res, 400, { error: 'Некорректные данные' });
      return true;
    }

    const expectedRev = normalizeExpectedRevisionInput(payload?.expectedRev ?? payload);
    if (!Number.isFinite(expectedRev)) {
      sendJson(res, 400, { error: 'Не указана ожидаемая ревизия expectedRev' });
      return true;
    }

    const actualRev = getCardRevisionValue(existingCard);
    if (expectedRev !== actualRev) {
      sendConflictResponse(res, {
        code: 'STALE_REVISION',
        entity: 'card',
        id: existingCard.id,
        expectedRev,
        actualRev,
        message: 'Версия карточки устарела'
      }, req);
      return true;
    }

    let commandPayload;
    let initialUserContext;
    try {
      commandPayload = inputControlCommand.getPayload(payload || {});
      initialUserContext = inputControlCommand.getUserContext(authedUser, data);
    } catch (err) {
      const statusCode = Number(err?.statusCode) || 400;
      sendJson(res, statusCode, { error: err?.message || 'Не удалось выполнить команду входного контроля' });
      return true;
    }

    const prev = await database.getData();
    let saved;
    try {
      saved = await database.update(current => {
        const draft = normalizeData(current);
        const currentCard = findCardByKey(draft, existingCard.id);
        if (!currentCard) {
          const err = createApprovalCommandError(404, 'Карточка не найдена', 'CARD_NOT_FOUND');
          err.cardId = existingCard.id;
          throw err;
        }
        const currentActualRev = getCardRevisionValue(currentCard);
        if (expectedRev !== currentActualRev) {
          const err = createApprovalCommandError(409, 'Версия карточки устарела', 'STALE_REVISION');
          err.expectedRev = expectedRev;
          err.actualRev = currentActualRev;
          err.cardId = currentCard.id;
          throw err;
        }
        const currentUserContext = inputControlCommand.getUserContext(authedUser, draft);
        inputControlCommand.apply(currentCard, commandPayload, currentUserContext);
        currentCard.updatedAt = Date.now();
        return draft;
      });
    } catch (err) {
      if (err?.code === 'STALE_REVISION') {
        sendConflictResponse(res, {
          code: 'STALE_REVISION',
          entity: 'card',
          id: trimToString(err.cardId || existingCard.id),
          expectedRev: Number.isFinite(err.expectedRev) ? err.expectedRev : expectedRev,
          actualRev: Number.isFinite(err.actualRev) ? err.actualRev : actualRev,
          message: 'Версия карточки устарела'
        }, req);
        return true;
      }
      if (err?.code === 'CARD_NOT_FOUND') {
        sendJson(res, 404, { error: 'Карточка не найдена' });
        return true;
      }
      if (err?.code === 'INPUT_CONTROL_FORBIDDEN') {
        sendJson(res, 403, { error: err.message || 'Недостаточно прав' });
        return true;
      }
      if (err?.code === 'INPUT_CONTROL_INVALID_STATE') {
        sendConflictResponse(res, {
          code: 'INVALID_STATE',
          entity: 'card.inputControl',
          id: trimToString(err.cardId || existingCard.id),
          expectedRev,
          actualRev: Number.isFinite(err.actualRev) ? err.actualRev : getCardRevisionValue(findCardByKey(await database.getData(), existingCard.id)),
          message: err.message || 'Команда входного контроля недоступна в текущем статусе'
        }, req);
        return true;
      }
      if (Number(err?.statusCode) === 400) {
        sendJson(res, 400, { error: err.message || 'Некорректные данные' });
        return true;
      }
      throw err;
    }

    const savedCard = findCardByKey(saved, existingCard.id);
    console.info('[DATA] cards input-control command ok', {
      command: inputControlCommand.key,
      cardId: savedCard?.id || existingCard.id,
      expectedRev,
      rev: Number.isFinite(savedCard?.rev) ? savedCard.rev : null,
      approvalStage: trimToString(savedCard?.approvalStage || ''),
      actor: initialUserContext?.userName || null,
      inputControlFileId: trimToString(savedCard?.inputControlFileId || '')
    });
    broadcastCardsChanged(saved);
    broadcastCardMutationEvents(prev, saved);
    sendJson(res, inputControlCommand.successStatus || 200, {
      command: inputControlCommand.key,
      card: deepClone(savedCard || existingCard)
    });
    return true;
  }

  const command = pathSegments.length === 4 ? trimToString(pathSegments[3]).toLowerCase() : '';

  if (req.method === 'POST' && cardKey && command === 'archive') {
    if (!canEditCardsCore(authedUser, data)) {
      sendJson(res, 403, { error: 'Недостаточно прав для архивирования карточки' });
      return true;
    }
    const existingCard = findCardByKey(data, cardKey);
    if (!existingCard) {
      sendJson(res, 404, { error: 'Карточка не найдена' });
      return true;
    }

    const raw = await parseBody(req).catch(() => '');
    const payload = parseJsonBody(raw);
    if (!payload) {
      sendJson(res, 400, { error: 'Некорректные данные' });
      return true;
    }

    const expectedRev = normalizeExpectedRevisionInput(payload?.expectedRev ?? payload);
    if (!Number.isFinite(expectedRev)) {
      sendJson(res, 400, { error: 'Не указана ожидаемая ревизия expectedRev' });
      return true;
    }

    const actualRev = Number.isFinite(existingCard.rev) ? existingCard.rev : 1;
    if (expectedRev !== actualRev) {
      sendConflictResponse(res, {
        code: 'STALE_REVISION',
        entity: 'card',
        id: existingCard.id,
        expectedRev,
        actualRev,
        message: 'Версия карточки устарела'
      }, req);
      return true;
    }

    const prev = await database.getData();
    let saved;
    try {
      saved = await database.update(current => {
        const draft = normalizeData(current);
        const currentCard = findCardByKey(draft, existingCard.id);
        if (!currentCard) {
          const err = new Error('Карточка не найдена');
          err.code = 'CARD_NOT_FOUND';
          throw err;
        }
        const currentActualRev = Number.isFinite(currentCard.rev) ? currentCard.rev : 1;
        if (expectedRev !== currentActualRev) {
          const err = new Error('Версия карточки устарела');
          err.code = 'STALE_REVISION';
          err.expectedRev = expectedRev;
          err.actualRev = currentActualRev;
          err.cardId = currentCard.id;
          throw err;
        }
        if (!currentCard.archived) {
          appendCardLog(currentCard, {
            action: 'Архивирование',
            object: 'Карта',
            field: 'archived',
            oldValue: false,
            newValue: true,
            userName: trimToString(authedUser?.name || ''),
            createdBy: trimToString(authedUser?.name || '')
          });
        }
        currentCard.archived = true;
        currentCard.updatedAt = Date.now();
        return draft;
      });
    } catch (err) {
      if (err?.code === 'STALE_REVISION') {
        sendConflictResponse(res, {
          code: 'STALE_REVISION',
          entity: 'card',
          id: trimToString(err.cardId || existingCard.id),
          expectedRev: Number.isFinite(err.expectedRev) ? err.expectedRev : expectedRev,
          actualRev: Number.isFinite(err.actualRev) ? err.actualRev : actualRev,
          message: 'Версия карточки устарела'
        }, req);
        return true;
      }
      if (err?.code === 'CARD_NOT_FOUND') {
        sendJson(res, 404, { error: 'Карточка не найдена' });
        return true;
      }
      throw err;
    }

    const savedCard = findCardByKey(saved, existingCard.id);
    console.info('[DATA] cards-core archive ok', {
      cardId: savedCard?.id || existingCard.id,
      expectedRev,
      rev: Number.isFinite(savedCard?.rev) ? savedCard.rev : null
    });
    broadcastCardsChanged(saved);
    broadcastCardMutationEvents(prev, saved);
    sendJson(res, 200, { card: deepClone(savedCard || existingCard) });
    return true;
  }

  if (req.method === 'POST' && cardKey && command === 'repeat') {
    if (!canEditCardsCore(authedUser, data)) {
      sendJson(res, 403, { error: 'Недостаточно прав для повторного создания карточки' });
      return true;
    }
    const existingCard = findCardByKey(data, cardKey);
    if (!existingCard) {
      sendJson(res, 404, { error: 'Карточка не найдена' });
      return true;
    }
    if (!existingCard.archived) {
      sendJson(res, 409, { error: 'Повтор доступен только для архивной карточки' });
      return true;
    }

    const raw = await parseBody(req).catch(() => '');
    const payload = parseJsonBody(raw);
    if (!payload) {
      sendJson(res, 400, { error: 'Некорректные данные' });
      return true;
    }

    const expectedRev = normalizeExpectedRevisionInput(payload?.expectedRev ?? payload);
    if (!Number.isFinite(expectedRev)) {
      sendJson(res, 400, { error: 'Не указана ожидаемая ревизия expectedRev' });
      return true;
    }

    const actualRev = Number.isFinite(existingCard.rev) ? existingCard.rev : 1;
    if (expectedRev !== actualRev) {
      sendConflictResponse(res, {
        code: 'STALE_REVISION',
        entity: 'card',
        id: existingCard.id,
        expectedRev,
        actualRev,
        message: 'Версия карточки устарела'
      }, req);
      return true;
    }

    const prev = await database.getData();
    let repeatedCardId = '';
    let saved;
    try {
      saved = await database.update(current => {
        const draft = normalizeData(current);
        const currentCard = findCardByKey(draft, existingCard.id);
        if (!currentCard) {
          const err = new Error('Карточка не найдена');
          err.code = 'CARD_NOT_FOUND';
          throw err;
        }
        const currentActualRev = Number.isFinite(currentCard.rev) ? currentCard.rev : 1;
        if (expectedRev !== currentActualRev) {
          const err = new Error('Версия карточки устарела');
          err.code = 'STALE_REVISION';
          err.expectedRev = expectedRev;
          err.actualRev = currentActualRev;
          err.cardId = currentCard.id;
          throw err;
        }
        if (!currentCard.archived) {
          const err = new Error('Повтор доступен только для архивной карточки');
          err.code = 'CARD_NOT_ARCHIVED';
          throw err;
        }
        const repeatedCard = buildCardsCoreCreateCandidate(buildCardsCoreRepeatInput(currentCard, draft, authedUser));
        appendCardLog(repeatedCard, {
          action: 'Создание МК',
          object: 'Карта',
          oldValue: '',
          newValue: trimToString(repeatedCard.name || repeatedCard.itemName || repeatedCard.routeCardNumber || repeatedCard.id),
          userName: trimToString(authedUser?.name || ''),
          createdBy: trimToString(authedUser?.name || '')
        });
        draft.cards = Array.isArray(draft.cards) ? draft.cards : [];
        draft.cards.push(repeatedCard);
        repeatedCardId = repeatedCard.id;
        return draft;
      });
    } catch (err) {
      if (err?.code === 'STALE_REVISION') {
        sendConflictResponse(res, {
          code: 'STALE_REVISION',
          entity: 'card',
          id: trimToString(err.cardId || existingCard.id),
          expectedRev: Number.isFinite(err.expectedRev) ? err.expectedRev : expectedRev,
          actualRev: Number.isFinite(err.actualRev) ? err.actualRev : actualRev,
          message: 'Версия карточки устарела'
        }, req);
        return true;
      }
      if (err?.code === 'CARD_NOT_FOUND') {
        sendJson(res, 404, { error: 'Карточка не найдена' });
        return true;
      }
      if (err?.code === 'CARD_NOT_ARCHIVED') {
        sendJson(res, 409, { error: 'Повтор доступен только для архивной карточки' });
        return true;
      }
      throw err;
    }

    const repeatedCard = findCardByKey(saved, repeatedCardId);
    console.info('[DATA] cards-core repeat ok', {
      sourceCardId: existingCard.id,
      cardId: repeatedCard?.id || repeatedCardId,
      expectedRev,
      rev: Number.isFinite(repeatedCard?.rev) ? repeatedCard.rev : null
    });
    broadcastCardsChanged(saved);
    broadcastCardMutationEvents(prev, saved);
    sendJson(res, 201, {
      card: deepClone(repeatedCard),
      sourceCardId: existingCard.id
    });
    return true;
  }

  if (req.method === 'DELETE' && cardKey && !command) {
    if (!canEditCardsCore(authedUser, data)) {
      sendJson(res, 403, { error: 'Недостаточно прав для удаления карточки' });
      return true;
    }
    const existingCard = findCardByKey(data, cardKey);
    if (!existingCard) {
      sendJson(res, 404, { error: 'Карточка не найдена' });
      return true;
    }

    const raw = await parseBody(req).catch(() => '');
    const payload = raw ? parseJsonBody(raw) : {};
    if (raw && !payload) {
      sendJson(res, 400, { error: 'Некорректные данные' });
      return true;
    }

    const expectedRev = normalizeExpectedRevisionInput(payload?.expectedRev ?? payload);
    if (!Number.isFinite(expectedRev)) {
      sendJson(res, 400, { error: 'Не указана ожидаемая ревизия expectedRev' });
      return true;
    }

    const actualRev = Number.isFinite(existingCard.rev) ? existingCard.rev : 1;
    if (expectedRev !== actualRev) {
      sendConflictResponse(res, {
        code: 'STALE_REVISION',
        entity: 'card',
        id: existingCard.id,
        expectedRev,
        actualRev,
        message: 'Версия карточки устарела'
      }, req);
      return true;
    }

    const prev = await database.getData();
    let removedProductionShiftTasks = 0;
    let saved;
    try {
      saved = await database.update(current => {
        const draft = normalizeData(current);
        const currentCard = findCardByKey(draft, existingCard.id);
        if (!currentCard) {
          const err = new Error('Карточка не найдена');
          err.code = 'CARD_NOT_FOUND';
          throw err;
        }
        const currentActualRev = Number.isFinite(currentCard.rev) ? currentCard.rev : 1;
        if (expectedRev !== currentActualRev) {
          const err = new Error('Версия карточки устарела');
          err.code = 'STALE_REVISION';
          err.expectedRev = expectedRev;
          err.actualRev = currentActualRev;
          err.cardId = currentCard.id;
          throw err;
        }
        const prevTasks = Array.isArray(draft.productionShiftTasks) ? draft.productionShiftTasks.length : 0;
        draft.productionShiftTasks = (Array.isArray(draft.productionShiftTasks) ? draft.productionShiftTasks : []).filter(task => (
          trimToString(task?.cardId) !== trimToString(currentCard.id)
        ));
        removedProductionShiftTasks = Math.max(0, prevTasks - draft.productionShiftTasks.length);
        draft.cards = (Array.isArray(draft.cards) ? draft.cards : []).filter(card => trimToString(card?.id) !== trimToString(currentCard.id));
        return draft;
      });
    } catch (err) {
      if (err?.code === 'STALE_REVISION') {
        sendConflictResponse(res, {
          code: 'STALE_REVISION',
          entity: 'card',
          id: trimToString(err.cardId || existingCard.id),
          expectedRev: Number.isFinite(err.expectedRev) ? err.expectedRev : expectedRev,
          actualRev: Number.isFinite(err.actualRev) ? err.actualRev : actualRev,
          message: 'Версия карточки устарела'
        }, req);
        return true;
      }
      if (err?.code === 'CARD_NOT_FOUND') {
        sendJson(res, 404, { error: 'Карточка не найдена' });
        return true;
      }
      throw err;
    }

    removeCardStorageFoldersByQr(existingCard.qrId || existingCard.barcode || '');
    console.info('[DATA] cards-core delete ok', {
      cardId: existingCard.id,
      expectedRev,
      removedProductionShiftTasks
    });
    broadcastCardsChanged(saved);
    broadcastCardMutationEvents(prev, saved);
    sendJson(res, 200, {
      deletedId: existingCard.id,
      removedProductionShiftTasks
    });
    return true;
  }

  sendJson(res, 405, { error: 'Method Not Allowed' });
  return true;
}

async function handleSecurityRoutes(req, res) {
  const parsed = url.parse(req.url, true);
  if (!parsed.pathname.startsWith('/api/security/')) return false;

  const authedUser = await ensureAuthenticated(req, res);
  if (!authedUser) return true;
  const data = await database.getData();
  const accessLevels = data.accessLevels || [];

  if (parsed.pathname === '/api/security/print-settings/password-qr' && req.method === 'GET') {
    const target = (data.users || []).find(u => u && u.id === authedUser.id);
    const settings = normalizePasswordQrPrintSettings(target?.printSettings?.passwordQr);
    sendJson(res, 200, { settings });
    return true;
  }

  if (parsed.pathname === '/api/security/print-settings/password-qr' && req.method === 'PUT') {
    const raw = await parseBody(req).catch(() => '');
    const payload = parseJsonBody(raw);
    if (!payload || !payload.settings || typeof payload.settings !== 'object') {
      sendJson(res, 400, { error: 'Некорректные данные' });
      return true;
    }
    const normalizedSettings = normalizePasswordQrPrintSettings(payload.settings);
    const saved = await database.update(current => {
      const draft = normalizeData(current);
      const target = (draft.users || []).find(u => u && u.id === authedUser.id);
      if (!target) {
        throw new Error('Пользователь не найден');
      }
      target.printSettings = normalizeUserPrintSettings(target.printSettings);
      target.printSettings.passwordQr = normalizedSettings;
      return draft;
    }).catch(err => ({ error: err.message }));
    if (saved && saved.error) {
      sendJson(res, 400, { error: saved.error });
      return true;
    }
    const updatedUser = (saved.users || []).find(u => u && u.id === authedUser.id);
    sendJson(res, 200, { settings: normalizePasswordQrPrintSettings(updatedUser?.printSettings?.passwordQr) });
    return true;
  }

  if (parsed.pathname === '/api/security/print-settings/item-qr' && req.method === 'GET') {
    const target = (data.users || []).find(u => u && u.id === authedUser.id);
    const settings = normalizeItemQrPrintSettings(target?.printSettings?.itemQr);
    sendJson(res, 200, { settings });
    return true;
  }

  if (parsed.pathname === '/api/security/print-settings/item-qr' && req.method === 'PUT') {
    const raw = await parseBody(req).catch(() => '');
    const payload = parseJsonBody(raw);
    if (!payload || !payload.settings || typeof payload.settings !== 'object') {
      sendJson(res, 400, { error: 'Некорректные данные' });
      return true;
    }
    const normalizedSettings = normalizeItemQrPrintSettings(payload.settings);
    const saved = await database.update(current => {
      const draft = normalizeData(current);
      const target = (draft.users || []).find(u => u && u.id === authedUser.id);
      if (!target) {
        throw new Error('Пользователь не найден');
      }
      target.printSettings = normalizeUserPrintSettings(target.printSettings);
      target.printSettings.itemQr = normalizedSettings;
      return draft;
    }).catch(err => ({ error: err.message }));
    if (saved && saved.error) {
      sendJson(res, 400, { error: saved.error });
      return true;
    }
    const updatedUser = (saved.users || []).find(u => u && u.id === authedUser.id);
    sendJson(res, 200, { settings: normalizeItemQrPrintSettings(updatedUser?.printSettings?.itemQr) });
    return true;
  }

  if (parsed.pathname === '/api/security/print-settings/card-qr' && req.method === 'GET') {
    const target = (data.users || []).find(u => u && u.id === authedUser.id);
    const settings = normalizeCardQrPrintSettings(target?.printSettings?.cardQr);
    sendJson(res, 200, { settings });
    return true;
  }

  if (parsed.pathname === '/api/security/print-settings/card-qr' && req.method === 'PUT') {
    const raw = await parseBody(req).catch(() => '');
    const payload = parseJsonBody(raw);
    if (!payload || !payload.settings || typeof payload.settings !== 'object') {
      sendJson(res, 400, { error: 'Некорректные данные' });
      return true;
    }
    const normalizedSettings = normalizeCardQrPrintSettings(payload.settings);
    const saved = await database.update(current => {
      const draft = normalizeData(current);
      const target = (draft.users || []).find(u => u && u.id === authedUser.id);
      if (!target) {
        throw new Error('Пользователь не найден');
      }
      target.printSettings = normalizeUserPrintSettings(target.printSettings);
      target.printSettings.cardQr = normalizedSettings;
      return draft;
    }).catch(err => ({ error: err.message }));
    if (saved && saved.error) {
      sendJson(res, 400, { error: saved.error });
      return true;
    }
    const updatedUser = (saved.users || []).find(u => u && u.id === authedUser.id);
    sendJson(res, 200, { settings: normalizeCardQrPrintSettings(updatedUser?.printSettings?.cardQr) });
    return true;
  }

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
    const prev = data;
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
    broadcastUserMutationEvents(prev, saved);
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
    const prev = data;
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
    broadcastUserMutationEvents(prev, saved);
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
    const prev = data;
    const saved = await database.update(current => {
      const draft = normalizeData(current);
      draft.users = (draft.users || []).filter(u => u.id !== userId || (u.name || u.username) === DEFAULT_ADMIN.name);
      return draft;
    });
    broadcastUserMutationEvents(prev, saved);
    const updated = (saved.users || []).map(u => sanitizeUser(u, getAccessLevelForUser(u, saved.accessLevels || [])));
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
    const prev = data;
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
    broadcastAccessLevelMutationEvents(prev, saved);
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
  if (await handleCardsCoreRoutes(req, res, parsed)) return true;

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
    const useRaw = trimToString(parsed.query?.raw || '') === '1';
    const value = useRaw
      ? trimToString(parsed.query?.value || '')
      : normalizeQrInput(parsed.query?.value || '');
    if (!value) {
      res.writeHead(200, {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      res.end('');
      return true;
    }
    const svg = useRaw
      ? await generateQrSvg(value, BARCODE_SVG_OPTIONS)
      : await makeBarcodeSvg(value);
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
    let data = await database.getData();
    let cardsArr = Array.isArray(data.cards) ? data.cards : [];
    const flowResult = ensureFlowForCards(cardsArr);
    if (flowResult.changed) {
      await database.update(current => ({ ...current, cards: flowResult.cards }));
      data = await database.getData();
      cardsArr = Array.isArray(data.cards) ? data.cards : [];
    }
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

  if (req.method === 'POST' && pathname === '/api/production/personal-operation/select') {
    const me = await ensureAuthenticated(req, res, { requireCsrf: true });
    if (!me) return true;
    const raw = await parseBody(req).catch(() => '');
    const payload = parseJsonBody(raw);
    if (!payload) {
      sendJson(res, 400, { error: 'Некорректные данные' });
      return true;
    }

    const cardId = trimToString(payload.cardId);
    const parentOpId = trimToString(payload.parentOpId || payload.opId);
    const expectedFlowVersion = normalizeExpectedRevisionInput(payload.expectedFlowVersion);
    const selectedItemIds = Array.isArray(payload.selectedItemIds)
      ? Array.from(new Set(payload.selectedItemIds.map(value => trimToString(value)).filter(Boolean)))
      : [];
    if (!cardId || !parentOpId || !Number.isFinite(expectedFlowVersion) || !selectedItemIds.length) {
      sendJson(res, 400, { error: 'Некорректные параметры' });
      return true;
    }

    const data = await database.getData();
    const prev = normalizeData(deepClone(data || {}));
    const flowResult = ensureFlowForCards(Array.isArray(data.cards) ? data.cards : []);
    const card = findCardByKey({ ...data, cards: flowResult.cards }, cardId);
    if (!card) {
      sendJson(res, 404, { error: 'Карта не найдена' });
      return true;
    }
    const flowVersion = Number.isFinite(card.flow?.version) ? card.flow.version : 1;
    if (expectedFlowVersion !== flowVersion) {
      sendFlowVersionConflict(res, { cardId: card.id, expectedFlowVersion, flowVersion }, req);
      return true;
    }

    const op = findOperationInCard(card, parentOpId);
    if (!op) {
      sendJson(res, 404, { error: 'Операция не найдена' });
      return true;
    }
    if (!isIndividualOperationServer(data, card, op)) {
      sendJson(res, 400, { error: 'Операция не поддерживает индивидуальный режим' });
      return true;
    }
    if (!isWorkspaceOperationAllowed(data, card, op)) {
      sendJson(res, 409, { error: 'Операция не запланирована на текущую смену' });
      return true;
    }
    {
      const roleAccess = getWorkspaceOperationRoleAccessServer(data, me, card, op);
      if (!roleAccess.roleAllowed) {
        sendJson(res, 403, { error: roleAccess.denialReason || 'Нет прав для выбора изделий на этой операции' });
        return true;
      }
    }
    recalcProductionStateFromFlow(card);
    if (Array.isArray(op.blockedReasons) && op.blockedReasons.length) {
      sendJson(res, 409, { error: 'Операцию нельзя начать', reasons: op.blockedReasons });
      return true;
    }
    if (!canUserAccessIndividualOperationServer(data, me, card, op)) {
      sendJson(res, 403, { error: 'Нет прав для выбора изделий на этом участке' });
      return true;
    }

    syncPersonalOperationsForCardServer(card, data);
    const availableItems = getAvailablePersonalOperationItemsServer(card, op);
    const availableIds = new Set(availableItems.map(item => trimToString(item?.id)));
    const acceptedItemIds = selectedItemIds.filter(itemId => availableIds.has(itemId));
    const rejectedItemIds = selectedItemIds.filter(itemId => !availableIds.has(itemId));
    if (!acceptedItemIds.length) {
      sendJson(res, 409, {
        error: 'Выбранные изделия уже закреплены другим исполнителем или недоступны',
        rejectedItemIds,
        flowVersion
      });
      return true;
    }

    if (!Array.isArray(card.personalOperations)) card.personalOperations = [];
    let personalOp = findReusablePersonalOperationForExecutorServer(card, op, me);
    if (!personalOp) {
      personalOp = normalizePersonalOperation({
        id: genId('pop'),
        parentOpId: trimToString(op.id),
        kind: op.isSamples ? 'SAMPLE' : 'ITEM',
        itemIds: [],
        status: 'NOT_STARTED',
        currentExecutorUserId: trimToString(me?.id || '') || null,
        currentExecutorUserName: trimToString(me?.name || me?.username || me?.login || '') || null,
        historySegments: []
      });
      card.personalOperations.push(personalOp);
    }

    const nextIds = new Set(Array.isArray(personalOp.itemIds) ? personalOp.itemIds.map(value => trimToString(value)).filter(Boolean) : []);
    acceptedItemIds.forEach(itemId => nextIds.add(itemId));
    personalOp.itemIds = Array.from(nextIds);
    startPersonalOperationServer(personalOp, me);

    const itemLabel = getPersonalOperationItemsLabelServer(card, op, personalOp);
    const actorName = trimToString(me?.name || me?.username || me?.login || 'Пользователь');
    appendCardLog(card, {
      action: 'PERSONAL_OPERATION_SELECT',
      object: op.opName || op.opCode || 'Операция',
      targetId: op.id,
      field: 'personalOperation',
      oldValue: '',
      newValue: `${actorName}: ${acceptedItemIds.length} шт. · ${itemLabel}`,
      userName: actorName
    });
    appendCardLog(card, {
      action: 'PERSONAL_OPERATION_START',
      object: op.opName || op.opCode || 'Операция',
      targetId: op.id,
      field: 'personalOperation',
      oldValue: '',
      newValue: `${actorName}: ${acceptedItemIds.length} шт. · ${itemLabel}`,
      userName: actorName
    });

    applyPersonalOperationAggregatesToCardServer(data, card);
    card.flow.version = flowVersion + 1;

    await database.update(current => {
      const draft = normalizeData(current);
      const idx = (draft.cards || []).findIndex(entry => entry && entry.id === card.id);
      if (idx >= 0) draft.cards[idx] = card;
      return draft;
    });
    const saved = await database.getData();
    broadcastCardsChanged(saved);
    sendJson(res, 200, {
      ok: true,
      flowVersion: card.flow.version,
      personalOperationId: personalOp.id,
      rejectedItemIds
    });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/production/personal-operation/action') {
    const me = await ensureAuthenticated(req, res, { requireCsrf: true });
    if (!me) return true;
    const raw = await parseBody(req).catch(() => '');
    const payload = parseJsonBody(raw);
    if (!payload) {
      sendJson(res, 400, { error: 'Некорректные данные' });
      return true;
    }

    const cardId = trimToString(payload.cardId);
    const parentOpId = trimToString(payload.parentOpId || payload.opId);
    const personalOperationId = trimToString(payload.personalOperationId);
    const action = trimToString(payload.action).toLowerCase();
    const expectedFlowVersion = normalizeExpectedRevisionInput(payload.expectedFlowVersion);
    if (!cardId || !parentOpId || !personalOperationId || !['start', 'pause', 'resume', 'reset'].includes(action) || !Number.isFinite(expectedFlowVersion)) {
      sendJson(res, 400, { error: 'Некорректные параметры' });
      return true;
    }

    const data = await database.getData();
    const flowResult = ensureFlowForCards(Array.isArray(data.cards) ? data.cards : []);
    const card = findCardByKey({ ...data, cards: flowResult.cards }, cardId);
    if (!card) {
      sendJson(res, 404, { error: 'Карта не найдена' });
      return true;
    }
    const flowVersion = Number.isFinite(card.flow?.version) ? card.flow.version : 1;
    if (expectedFlowVersion !== flowVersion) {
      sendFlowVersionConflict(res, { cardId: card.id, expectedFlowVersion, flowVersion }, req);
      return true;
    }

    const op = findOperationInCard(card, parentOpId);
    if (!op) {
      sendJson(res, 404, { error: 'Операция не найдена' });
      return true;
    }
    if (!isIndividualOperationServer(data, card, op)) {
      sendJson(res, 400, { error: 'Операция не поддерживает индивидуальный режим' });
      return true;
    }
    if (!isWorkspaceOperationAllowed(data, card, op)) {
      sendJson(res, 409, { error: 'Операция не запланирована на текущую смену' });
      return true;
    }
    {
      const roleAccess = getWorkspaceOperationRoleAccessServer(data, me, card, op);
      if (!roleAccess.roleAllowed) {
        sendJson(res, 403, { error: roleAccess.denialReason || 'Нет прав для запуска этой личной операции' });
        return true;
      }
    }
    syncPersonalOperationsForCardServer(card, data);
    const personalOp = getPersonalOperationByIdServer(card, personalOperationId);
    if (!personalOp || trimToString(personalOp.parentOpId) !== trimToString(op.id)) {
      sendJson(res, 404, { error: 'Личная операция не найдена' });
      return true;
    }

    const pendingItems = getPendingPersonalOperationItemsServer(card, op, personalOp);
    if (!pendingItems.length) {
      sendJson(res, 409, { error: 'В личной операции нет pending-изделий' });
      return true;
    }

    const canOperate = canUserOperatePersonalOperationServer(data, me, card, op, personalOp);
    const canAccess = canUserAccessIndividualOperationServer(data, me, card, op);
    if ((action === 'pause' || action === 'reset') && !canOperate) {
      sendJson(res, 403, { error: 'Нет прав для изменения этой личной операции' });
      return true;
    }
    if ((action === 'start' || action === 'resume') && !canOperate && !canAccess) {
      sendJson(res, 403, { error: 'Нет прав для запуска этой личной операции' });
      return true;
    }

    const prevExecutorUserId = trimToString(personalOp.currentExecutorUserId || '');
    const prevExecutorUserName = trimToString(personalOp.currentExecutorUserName || '');
    const actorName = trimToString(me?.name || me?.username || me?.login || 'Пользователь');
    const itemLabel = getPersonalOperationItemsLabelServer(card, op, personalOp);
    if (action === 'pause') {
      if (trimToString(personalOp.status).toUpperCase() !== 'IN_PROGRESS') {
        sendJson(res, 409, { error: 'Личную операцию нельзя поставить на паузу' });
        return true;
      }
      pausePersonalOperationServer(personalOp);
      appendCardLog(card, {
        action: 'PERSONAL_OPERATION_PAUSE',
        object: op.opName || op.opCode || 'Операция',
        targetId: op.id,
        field: 'personalOperation',
        oldValue: '',
        newValue: `${actorName}: ${itemLabel}`,
        userName: actorName
      });
    } else if (action === 'reset') {
      if (trimToString(personalOp.status).toUpperCase() === 'DONE') {
        sendJson(res, 409, { error: 'Личную операцию нельзя завершить' });
        return true;
      }
      resetPersonalOperationServer(personalOp);
      appendCardLog(card, {
        action: 'PERSONAL_OPERATION_FINISH',
        object: op.opName || op.opCode || 'Операция',
        targetId: op.id,
        field: 'personalOperation',
        oldValue: '',
        newValue: `${actorName}: ${itemLabel}`,
        userName: actorName
      });
    } else {
      startPersonalOperationServer(personalOp, me);
      if (prevExecutorUserId && prevExecutorUserId !== trimToString(me?.id || '')) {
        appendCardLog(card, {
          action: 'PERSONAL_OPERATION_HANDOFF',
          object: op.opName || op.opCode || 'Операция',
          targetId: op.id,
          field: 'personalOperation',
          oldValue: prevExecutorUserName || prevExecutorUserId,
          newValue: `${actorName}: ${itemLabel}`,
          userName: actorName
        });
      } else {
        appendCardLog(card, {
          action: action === 'resume' ? 'PERSONAL_OPERATION_RESUME' : 'PERSONAL_OPERATION_START',
          object: op.opName || op.opCode || 'Операция',
          targetId: op.id,
          field: 'personalOperation',
          oldValue: '',
          newValue: `${actorName}: ${itemLabel}`,
          userName: actorName
        });
      }
    }

    applyPersonalOperationAggregatesToCardServer(data, card);
    card.flow.version = flowVersion + 1;

    await database.update(current => {
      const draft = normalizeData(current);
      const idx = (draft.cards || []).findIndex(entry => entry && entry.id === card.id);
      if (idx >= 0) draft.cards[idx] = card;
      return draft;
    });
    const saved = await database.getData();
    broadcastCardsChanged(saved);
    broadcastCardMutationEvents(prev, saved);
    sendJson(res, 200, { ok: true, flowVersion: card.flow.version, personalOperationId: personalOp.id });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/production/flow/commit') {
    const me = await ensureAuthenticated(req, res, { requireCsrf: true });
    if (!me) return true;
    const raw = await parseBody(req).catch(() => '');
    const payload = parseJsonBody(raw);
    if (!payload) {
      sendJson(res, 400, { error: 'Некорректные данные' });
      return true;
    }

    const cardId = trimToString(payload.cardId);
    const opId = trimToString(payload.opId);
    const personalOperationId = trimToString(payload.personalOperationId || '');
    const kindRaw = trimToString(payload.kind).toUpperCase();
    const expectedFlowVersion = normalizeExpectedRevisionInput(payload.expectedFlowVersion);
    const updatesRaw = Array.isArray(payload.updates) ? payload.updates : [];

    if (!cardId || !opId || !['ITEM', 'SAMPLE'].includes(kindRaw) || !Number.isFinite(expectedFlowVersion)) {
      sendJson(res, 400, { error: 'Некорректные параметры' });
      return true;
    }
    if (!updatesRaw.length) {
      sendJson(res, 400, { error: 'Пустой список обновлений' });
      return true;
    }

    const updates = updatesRaw.map(entry => ({
      itemId: trimToString(entry?.itemId),
      status: normalizeFlowStatus(entry?.status, null),
      comment: trimToString(entry?.comment || '')
    }));

    if (updates.some(entry => !entry.itemId || !entry.status || entry.status === 'PENDING')) {
      sendJson(res, 400, { error: 'Некорректные обновления' });
      return true;
    }

    const data = await database.getData();
    const prev = normalizeData(deepClone(data || {}));
    const flowResult = ensureFlowForCards(Array.isArray(data.cards) ? data.cards : []);
    const card = findCardByKey({ ...data, cards: flowResult.cards }, cardId);
    if (!card) {
      sendJson(res, 404, { error: 'Карта не найдена' });
      return true;
    }

    const flowVersion = Number.isFinite(card.flow?.version) ? card.flow.version : 1;
    if (expectedFlowVersion !== flowVersion) {
      sendFlowVersionConflict(res, { cardId: card.id, expectedFlowVersion, flowVersion }, req);
      return true;
    }

    const op = findOperationInCard(card, opId);
    if (!op) {
      sendJson(res, 404, { error: 'Операция не найдена' });
      return true;
    }
    {
      const roleAccess = getWorkspaceOperationRoleAccessServer(data, me, card, op);
      if (!roleAccess.roleAllowed) {
        sendJson(res, 403, { error: roleAccess.denialReason || 'Нет прав для завершения операции в рабочем месте' });
        return true;
      }
    }
    let personalOp = null;
    if (personalOperationId) {
      if (!isIndividualOperationServer(data, card, op)) {
        sendJson(res, 400, { error: 'Личная операция недоступна для этого маршрута' });
        return true;
      }
      syncPersonalOperationsForCardServer(card, data);
      personalOp = getPersonalOperationByIdServer(card, personalOperationId);
      if (!personalOp || trimToString(personalOp.parentOpId) !== trimToString(op.id)) {
        sendJson(res, 404, { error: 'Личная операция не найдена' });
        return true;
      }
      if (!canUserOperatePersonalOperationServer(data, me, card, op, personalOp)) {
        sendJson(res, 403, { error: 'Нет прав для завершения этой личной операции' });
        return true;
      }
    }
    const opIsSamples = Boolean(op.isSamples);
    if ((kindRaw === 'SAMPLE' && !opIsSamples) || (kindRaw === 'ITEM' && opIsSamples)) {
      sendJson(res, 400, { error: 'Неверный тип операции' });
      return true;
    }

    recalcProductionStateFromFlow(card);
    const personalCommitInProgress = personalOp
      ? trimToString(personalOp.status).toUpperCase() === 'IN_PROGRESS'
      : false;
    const personalCommitPaused = personalOp
      ? trimToString(personalOp.status).toUpperCase() === 'PAUSED'
      : false;
    if (!personalOp && op.status === 'PAUSED') {
      sendJson(res, 409, { error: 'Операция на паузе' });
      return true;
    }
    if ((personalOp && personalCommitPaused) || (!personalOp && (op.status !== 'IN_PROGRESS' || !op.canComplete)) || (personalOp && !personalCommitInProgress)) {
      sendJson(res, 409, { error: 'Операцию нельзя завершить', reasons: op.blockedReasons || [] });
      return true;
    }

    const list = getFlowListForOp(card, op, kindRaw);
    const opCode = trimToString(op.opCode) || null;

    const prevOpStatus = op.status;
    const prevCardStatus = card.productionStatus || card.status || 'NOT_STARTED';

    for (const entry of updates) {
      const item = list.find(it => it && it.id === entry.itemId);
      if (!item) {
        sendJson(res, 404, { error: `Изделие не найдено: ${entry.itemId}` });
        return true;
      }
      if (item.current?.opId && item.current.opId !== opId) {
        sendJson(res, 409, { error: `Изделие не находится на операции: ${entry.itemId}` });
        return true;
      }
      if (normalizeFlowStatus(item.current?.status, null) !== 'PENDING') {
        sendJson(res, 409, { error: `Изделие не ожидает выполнения: ${entry.itemId}` });
        return true;
      }
    }

    if (personalOp) {
      const ownedIds = new Set(Array.isArray(personalOp.itemIds) ? personalOp.itemIds.map(value => trimToString(value)).filter(Boolean) : []);
      const foreignEntry = updates.find(entry => !ownedIds.has(entry.itemId));
      if (foreignEntry) {
        sendJson(res, 409, { error: `Изделие не принадлежит личной операции: ${foreignEntry.itemId}` });
        return true;
      }
    }

    const now = Date.now();
    const transferMap = new Map();
    updates.forEach(entry => {
      const item = list.find(it => it && it.id === entry.itemId);
      if (!item) return;
      appendFlowHistoryEntryWithShift(data, {
        card,
        op,
        item,
        status: entry.status,
        comment: entry.comment || '',
        me,
        now,
        personalOperationId: personalOp?.id || '',
        isPersonalOperation: Boolean(personalOp)
      });

      if (!item.current || typeof item.current !== 'object') item.current = {};
      item.current.opId = opId;
      item.current.opCode = opCode;
      item.current.status = entry.status;
      item.current.updatedAt = now;

      if (entry.status === 'GOOD') {
        const sampleType = kindRaw === 'SAMPLE' ? getOpSampleTypeServer(op) : '';
        const next = getNextOperationForKind(card, kindRaw, opId, sampleType);
        if (next) {
          const nextOp = findOperationInCard(card, next.opId);
          if (nextOp) {
            const key = nextOp.id || nextOp.opId || next.opId;
            const bucket = transferMap.get(key) || { op: nextOp, items: [] };
            bucket.items.push(trimToString(item.displayName || item.id));
            transferMap.set(key, bucket);
          }
          item.current.opId = next.opId;
          item.current.opCode = next.opCode;
          item.current.status = 'PENDING';
          item.current.updatedAt = now;
        } else {
          const last = getLastOperationForKind(card, kindRaw, sampleType);
          item.current.opId = last.opId || opId;
          item.current.opCode = last.opCode || opCode;
          item.current.status = 'GOOD';
          item.current.updatedAt = now;
        }
      }
    });

    updateFinalStatuses(card);
    if (personalOp) {
      syncPersonalOperationServer(card, op, personalOp, now);
      appendCardLog(card, {
        action: 'PERSONAL_OPERATION_COMPLETE',
        object: op.opName || op.opCode || 'Операция',
        targetId: op.id,
        field: 'personalOperation',
        oldValue: '',
        newValue: `${trimToString(me?.name || me?.username || me?.login || 'Пользователь')}: ${getPersonalOperationItemsLabelServer(card, op, personalOp)}`,
        userName: trimToString(me?.name || me?.username || me?.login || 'Пользователь')
      });
    }

    const shiftContext = resolveFlowEventShiftContextServer(data, card, op);
    const currentSlot = {
      date: trimToString(shiftContext.shiftDate),
      shift: Number.isFinite(Number(shiftContext.shift)) ? (parseInt(shiftContext.shift, 10) || 1) : null
    };
    const completedSubcontractChains = [];
    (Array.isArray(data?.productionShiftTasks) ? data.productionShiftTasks : []).forEach(task => {
      if (
        !task
        || trimToString(task?.cardId) !== trimToString(card.id)
        || trimToString(task?.routeOpId) !== trimToString(op.id)
        || !isSubcontractAreaServer(data, task?.areaId)
      ) {
        return;
      }
      const chainId = trimToString(task?.subcontractChainId);
      if (!chainId) return;
      if (!currentSlot.date || !currentSlot.shift) return;
      if (!isSubcontractChainCompletedServer(card, task)) return;
      if (completedSubcontractChains.some(entry => entry.chainId === chainId && entry.areaId === trimToString(task?.areaId))) return;
      completedSubcontractChains.push({
        chainId,
        areaId: trimToString(task?.areaId)
      });
    });

    const transferNotices = [];
    if (transferMap.size) {
      const actorName = trimToString(me?.name || me?.username || me?.login || 'Пользователь');
      const cardLabel = trimToString(card.routeCardNumber || card.name || card.id);
      const kindLabel = kindRaw === 'SAMPLE' ? 'образцы' : 'изделия';
      transferMap.forEach(({ op: nextOp, items }) => {
        if (!nextOp || !items || !items.length) return;
        const opName = trimToString(nextOp.opName || nextOp.name || '');
        const opCodeValue = trimToString(nextOp.opCode || '');
        const listText = items.filter(Boolean).join(', ');
        const opLabel = opCodeValue
          ? `${opCodeValue}${opName ? ' — ' + opName : ''}`
          : (opName || trimToString(nextOp.id || '—'));
        const text = `${actorName}, ${kindLabel}: ${listText} в количестве ${items.length} шт. переданы на операцию ${opLabel} по маршрутной карте ${cardLabel}`;
        const executors = [nextOp.executor].concat(nextOp.additionalExecutors || []).map(trimToString).filter(Boolean);
        const recipients = new Set();
        executors.forEach(name => {
          const user = resolveUserByNameLike(data, name);
          if (user?.id) recipients.add(user.id);
        });
        recipients.forEach(userId => transferNotices.push({ userId, text }));
      });
    }

    card.flow.version = flowVersion + 1;
    recalcOperationCountersFromFlow(card);
    recalcProductionStateFromFlow(card);
    applyPersonalOperationAggregatesToCardServer(data, card);

    if (prevOpStatus !== op.status) {
      appendCardLog(card, {
        action: 'Статус операции',
        object: op.opName || op.opCode || 'Операция',
        targetId: op.id,
        field: 'status',
        oldValue: prevOpStatus,
        newValue: op.status,
        userName: me?.name || me?.username || me?.login || 'Пользователь'
      });
    }

    const nextCardStatus = card.productionStatus || card.status || 'NOT_STARTED';
    if (prevCardStatus !== nextCardStatus) {
      appendCardLog(card, {
        action: 'Статус карты',
        object: 'Карта',
        field: 'status',
        oldValue: prevCardStatus,
        newValue: nextCardStatus,
        userName: me?.name || me?.username || me?.login || 'Пользователь'
      });
    }

    const delivered = [];
    await database.update(current => {
      const draft = normalizeData(current);
      const idx = (draft.cards || []).findIndex(c => c && c.id === card.id);
      if (idx >= 0) {
        draft.cards[idx] = card;
        completedSubcontractChains.forEach(entry => {
          const chainSeedTask = (Array.isArray(draft.productionShiftTasks) ? draft.productionShiftTasks : []).find(task => (
            trimToString(task?.cardId) === trimToString(card.id)
            && trimToString(task?.routeOpId) === trimToString(op.id)
            && trimToString(task?.areaId) === entry.areaId
            && trimToString(task?.subcontractChainId) === entry.chainId
          )) || null;
          const removal = chainSeedTask
            ? removeFutureSubcontractChainTasksServer(draft, chainSeedTask, currentSlot)
            : { removedCount: 0, removedTasks: [] };
          const shiftRecord = ensureProductionShiftServer(draft, currentSlot.date, currentSlot.shift);
          if (shiftRecord) {
            shiftRecord.logs = Array.isArray(shiftRecord.logs) ? shiftRecord.logs : [];
            shiftRecord.logs.push({
              id: genId('shiftlog'),
              ts: now,
              action: 'SUBCONTRACT_CHAIN_FINISH',
              object: 'Операция',
              targetId: trimToString(op.id) || null,
              field: 'subcontractChain',
              oldValue: '',
              newValue: `${entry.chainId}; удалено будущих фрагментов: ${removal.removedCount}`,
              createdBy: nowUser
            });
          }
          removal.removedTasks.forEach(removedTask => {
            appendShiftTaskLogServer(draft, removedTask, 'REMOVE_TASK_FROM_SHIFT', null, nowUser);
          });
          appendSubcontractChainCardLogServer(draft, draft.cards[idx], chainSeedTask || {
            routeOpId: op.id,
            subcontractChainId: entry.chainId,
            areaId: entry.areaId
          }, 'SUBCONTRACT_CHAIN_FINISH', { userName: nowUser, removedCount: removal.removedCount });
        });
        reconcileCardPlanningTasksServer(draft, draft.cards[idx]);
      }
      if (transferNotices.length) {
        transferNotices.forEach(note => {
          const created = appendSystemMessage(draft, note.userId, note.text);
          if (created) delivered.push({ userId: note.userId, ...created });
        });
        normalizeChatConversationsParticipants(draft);
      }
      return draft;
    });
    const saved = await database.getData();
    broadcastCardsChanged(saved);
    broadcastCardMutationEvents(prev, saved);
    if (delivered.length) {
      delivered.forEach(item => {
        if (!item?.userId || !item?.conversationId || !item?.message) return;
        msgSseSendToUser(item.userId, 'message_new', { conversationId: item.conversationId, message: item.message });
        const count = getUnreadCountForUser(item.userId, saved);
        msgSseSendToUser(item.userId, 'unread_count', { count });
      });
    }
    sendJson(res, 200, { ok: true, flowVersion: card.flow.version });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/production/flow/identify') {
    const me = await ensureAuthenticated(req, res, { requireCsrf: true });
    if (!me) return true;
    const raw = await parseBody(req).catch(() => '');
    const payload = parseJsonBody(raw);
    if (!payload) {
      sendJson(res, 400, { error: 'Некорректные данные' });
      return true;
    }

    const cardId = trimToString(payload.cardId);
    const opId = trimToString(payload.opId);
    const personalOperationId = trimToString(payload.personalOperationId || '');
    const expectedFlowVersion = normalizeExpectedRevisionInput(payload.expectedFlowVersion);
    const updatesRaw = Array.isArray(payload.updates) ? payload.updates : [];
    if (!cardId || !opId || !Number.isFinite(expectedFlowVersion)) {
      sendJson(res, 400, { error: 'Некорректные параметры' });
      return true;
    }
    if (!updatesRaw.length) {
      sendJson(res, 400, { error: 'Пустой список обновлений' });
      return true;
    }

    const updates = updatesRaw.map(entry => ({
      itemId: trimToString(entry?.itemId),
      name: trimToString(entry?.name)
    })).filter(entry => entry.itemId);

    if (updates.some(entry => !entry.name)) {
      sendJson(res, 400, { error: 'Заполните индивидуальные номера изделий.' });
      return true;
    }

    const data = await database.getData();
    const flowResult = ensureFlowForCards(Array.isArray(data.cards) ? data.cards : []);
    const card = findCardByKey({ ...data, cards: flowResult.cards }, cardId);
    if (!card) {
      sendJson(res, 404, { error: 'Карта не найдена' });
      return true;
    }

    const flowVersion = Number.isFinite(card.flow?.version) ? card.flow.version : 1;
    if (expectedFlowVersion !== flowVersion) {
      sendFlowVersionConflict(res, { cardId: card.id, expectedFlowVersion, flowVersion }, req);
      return true;
    }

    const op = findOperationInCard(card, opId);
    if (!op || !isIdentificationOperation(op)) {
      sendJson(res, 400, { error: 'Неверный тип операции' });
      return true;
    }
    let personalOp = null;
    if (personalOperationId) {
      if (!isIndividualOperationServer(data, card, op)) {
        sendJson(res, 400, { error: 'Личная операция недоступна для этого маршрута' });
        return true;
      }
      syncPersonalOperationsForCardServer(card, data);
      personalOp = getPersonalOperationByIdServer(card, personalOperationId);
      if (!personalOp || trimToString(personalOp.parentOpId) !== trimToString(op.id)) {
        sendJson(res, 404, { error: 'Личная операция не найдена' });
        return true;
      }
      if (!canUserOperatePersonalOperationServer(data, me, card, op, personalOp)) {
        sendJson(res, 403, { error: 'Нет прав для изменения этой личной операции' });
        return true;
      }
    }
    if (op.status !== 'IN_PROGRESS') {
      sendJson(res, 409, { error: 'Изменение доступно только в статусе "В работе"' });
      return true;
    }

    const items = Array.isArray(card.flow?.items) ? card.flow.items : [];
    const samples = Array.isArray(card.flow?.samples) ? card.flow.samples : [];
    const itemIndex = new Map(items.map(item => [trimToString(item?.id), item]));
    const sampleIndex = new Map(samples.map(item => [trimToString(item?.id), item]));

    const updatesById = new Map();
    updates.forEach(entry => updatesById.set(entry.itemId, entry.name));

    const allNames = new Set();
    const collectName = (item) => {
      const nextName = trimToString(updatesById.get(trimToString(item?.id)) || item?.displayName || '');
      if (!nextName) return { ok: false };
      const key = nextName.toLowerCase();
      if (allNames.has(key)) return { ok: false, duplicate: true };
      allNames.add(key);
      return { ok: true, name: nextName };
    };

    for (const item of items) {
      const resCheck = collectName(item);
      if (!resCheck.ok) {
        sendJson(res, 400, { error: resCheck.duplicate ? 'Индивидуальные номера должны быть уникальны внутри МК.' : 'Заполните индивидуальные номера изделий.' });
        return true;
      }
    }
    for (const item of samples) {
      const resCheck = collectName(item);
      if (!resCheck.ok) {
        sendJson(res, 400, { error: resCheck.duplicate ? 'Индивидуальные номера должны быть уникальны внутри МК.' : 'Заполните индивидуальные номера изделий.' });
        return true;
      }
    }
    if (personalOp) {
      const ownedIds = new Set(Array.isArray(personalOp.itemIds) ? personalOp.itemIds.map(value => trimToString(value)).filter(Boolean) : []);
      const foreignEntry = updates.find(entry => !ownedIds.has(entry.itemId));
      if (foreignEntry) {
        sendJson(res, 409, { error: `Изделие не принадлежит личной операции: ${foreignEntry.itemId}` });
        return true;
      }
    }

    const changed = [];
    updates.forEach(entry => {
      const item = itemIndex.get(entry.itemId) || sampleIndex.get(entry.itemId);
      if (!item) return;
      if (trimToString(item.current?.opId) !== opId) return;
      if (item.displayName !== entry.name) {
        changed.push({
          itemId: entry.itemId,
          oldName: item.displayName || '',
          newName: entry.name
        });
      }
      item.displayName = entry.name;
    });

    if (!changed.length) {
      sendJson(res, 400, { error: 'Изменений нет.' });
      return true;
    }

    card.itemSerials = items.map(item => trimToString(item?.displayName || ''));
    const controlSamples = samples.filter(item => normalizeSampleTypeServer(item?.sampleType) === 'CONTROL');
    const witnessSamples = samples.filter(item => normalizeSampleTypeServer(item?.sampleType) === 'WITNESS');
    card.sampleSerials = controlSamples.map(item => trimToString(item?.displayName || ''));
    card.witnessSampleSerials = witnessSamples.map(item => trimToString(item?.displayName || ''));
    if (card.cardType === 'MKI') {
      card.sampleCount = card.sampleSerials.length;
      card.witnessSampleCount = card.witnessSampleSerials.length;
      card.quantity = card.itemSerials.length;
      card.batchSize = card.quantity;
    }

    recalcProductionStateFromFlow(card);
    applyPersonalOperationAggregatesToCardServer(data, card);
    if (card.flow && Number.isFinite(card.flow.version)) {
      card.flow.version = Math.max(0, card.flow.version || 0) + 1;
    }

    const nowUser = me?.name || 'Пользователь';
    appendCardLog(card, {
      action: 'Идентификация',
      object: op.opName || op.opCode || 'Операция',
      field: 'itemSerials',
      oldValue: '',
      newValue: `${nowUser}: ${changed.length} шт.`,
      userName: nowUser
    });

    await database.update(current => {
      const draft = normalizeData(current);
      const idx = (draft.cards || []).findIndex(c => c && c.id === card.id);
      if (idx >= 0) {
        draft.cards[idx] = card;
        reconcileCardPlanningTasksServer(draft, draft.cards[idx]);
      }
      return draft;
    });
    const saved = await database.getData();
    broadcastCardsChanged(saved);
    broadcastCardMutationEvents(prev, saved);
    sendJson(res, 200, { ok: true, flowVersion: card.flow.version });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/production/flow/return') {
    const me = await ensureAuthenticated(req, res, { requireCsrf: true });
    if (!me) return true;
    const raw = await parseBody(req).catch(() => '');
    const payload = parseJsonBody(raw);
    if (!payload) {
      sendJson(res, 400, { error: 'Некорректные данные' });
      return true;
    }

    const cardId = trimToString(payload.cardId);
    const opId = trimToString(payload.opId);
    const itemId = trimToString(payload.itemId);
    const kindRaw = trimToString(payload.kind).toUpperCase();
    const expectedFlowVersion = normalizeExpectedRevisionInput(payload.expectedFlowVersion);
    const techSpecFileId = trimToString(payload.techSpecFileId);
    const techSpecFile = payload.techSpecFile && typeof payload.techSpecFile === 'object'
      ? payload.techSpecFile
      : null;
    const renameSample = payload.renameSample === true;
    const targetOpCode = trimToString(payload.targetOpCode);

    if (!cardId || !opId || !itemId || !['ITEM', 'SAMPLE'].includes(kindRaw) || !Number.isFinite(expectedFlowVersion)) {
      sendJson(res, 400, { error: 'Некорректные параметры' });
      return true;
    }
    if (!techSpecFileId && !techSpecFile) {
      sendJson(res, 400, { error: 'Не указан файл технических указаний' });
      return true;
    }

    const data = await database.getData();
    const flowResult = ensureFlowForCards(Array.isArray(data.cards) ? data.cards : []);
    const card = findCardByKey({ ...data, cards: flowResult.cards }, cardId);
    if (!card) {
      sendJson(res, 404, { error: 'Карта не найдена' });
      return true;
    }

    const flowVersion = Number.isFinite(card.flow?.version) ? card.flow.version : 1;
    if (expectedFlowVersion !== flowVersion) {
      sendFlowVersionConflict(res, { cardId: card.id, expectedFlowVersion, flowVersion }, req);
      return true;
    }

    const op = findOperationInCard(card, opId);
    if (!op) {
      sendJson(res, 404, { error: 'Операция не найдена' });
      return true;
    }
    const opIsSamples = Boolean(op.isSamples);
    if ((kindRaw === 'SAMPLE' && !opIsSamples) || (kindRaw === 'ITEM' && opIsSamples)) {
      sendJson(res, 400, { error: 'Неверный тип операции' });
      return true;
    }

    const list = getFlowListForOp(card, op, kindRaw);
    const item = list.find(it => it && it.id === itemId);
    if (!item) {
      sendJson(res, 404, { error: 'Изделие не найдено' });
      return true;
    }

    if (item.current?.opId && item.current.opId !== opId) {
      sendJson(res, 409, { error: 'Изделие находится на другой операции' });
      return true;
    }
    if (normalizeFlowStatus(item.current?.status, null) !== 'DELAYED') {
      sendJson(res, 409, { error: 'Изделие не имеет статус Задержано' });
      return true;
    }

    let techFile = null;
    if (techSpecFileId) {
      techFile = (card.attachments || []).find(file => file && file.id === techSpecFileId && String(file.category || '').toUpperCase() === 'TECH_SPEC');
      if (!techFile) {
        sendJson(res, 409, { error: 'Файл технических указаний не найден' });
        return true;
      }
    }

    const targetOp = targetOpCode
      ? (card.operations || []).find(entry => trimToString(entry?.opCode) === targetOpCode)
      : op;
    if (!targetOp) {
      sendJson(res, 404, { error: 'Операция с таким кодом не найдена' });
      return true;
    }
    const targetIsSamples = Boolean(targetOp.isSamples);
    if ((kindRaw === 'SAMPLE' && !targetIsSamples) || (kindRaw === 'ITEM' && targetIsSamples)) {
      sendJson(res, 409, { error: 'Тип операции не совпадает' });
      return true;
    }
    if (kindRaw === 'SAMPLE') {
      const sourceType = getOpSampleTypeServer(op);
      const targetType = getOpSampleTypeServer(targetOp);
      if (sourceType !== targetType) {
        sendJson(res, 409, { error: 'Тип образцов не совпадает' });
        return true;
      }
    }

    if (!techFile && techSpecFile) {
      const name = trimToString(techSpecFile.name || 'file');
      const content = techSpecFile.content;
      const size = Number(techSpecFile.size) || 0;
      const type = trimToString(techSpecFile.type || 'application/octet-stream');
      if (!name || !content || typeof content !== 'string' || !content.startsWith('data:')) {
        sendJson(res, 400, { error: 'Некорректный файл технических указаний' });
        return true;
      }
      const safeName = normalizeDoubleExtension(name);
      const ext = path.extname(safeName || '').toLowerCase();
      if (ALLOWED_EXTENSIONS.length && ext && !ALLOWED_EXTENSIONS.includes(ext)) {
        sendJson(res, 400, { error: 'Недопустимый тип файла' });
        return true;
      }
      const buffer = decodeDataUrlToBuffer(content);
      if (!buffer) {
        sendJson(res, 400, { error: 'Некорректный файл технических указаний' });
        return true;
      }
      if (size > FILE_SIZE_LIMIT || buffer.length > FILE_SIZE_LIMIT) {
        sendJson(res, 400, { error: 'Файл слишком большой' });
        return true;
      }

      const qr = normalizeQrIdServer(card.qrId || '');
      if (!isValidQrIdServer(qr)) {
        sendJson(res, 400, { error: 'Некорректный QR карты' });
        return true;
      }
      ensureCardStorageFoldersByQr(qr);
      const storedName = makeStoredName(safeName);
      const folder = categoryToFolder('TECH_SPEC');
      const relPath = `${folder}/${storedName}`;
      const absPath = path.join(CARDS_STORAGE_DIR, qr, relPath);
      fs.writeFileSync(absPath, buffer);
      techFile = {
        id: genId('file'),
        name: safeName,
        originalName: safeName,
        storedName,
        relPath,
        type: type || 'application/octet-stream',
        mime: type || 'application/octet-stream',
        size: size || buffer.length,
        createdAt: Date.now(),
        category: 'TECH_SPEC',
        scope: 'CARD',
        scopeId: null
      };
      card.attachments = Array.isArray(card.attachments) ? card.attachments : [];
      card.attachments.push(techFile);
    }

    const now = Date.now();
    const prevOpLabel = trimToString(op.opCode || op.opName || op.id);
    const nextOpLabel = trimToString(targetOp.opCode || targetOp.opName || targetOp.id);
    const previousItemLabel = trimToString(item.displayName || item.id || 'Изделие');
    if (kindRaw === 'SAMPLE' && renameSample) {
      const nextSampleName = getNextReturnedSampleNameServer(card, item);
      if (!nextSampleName) {
        sendJson(res, 409, { error: 'Не удалось определить следующее имя образца' });
        return true;
      }
      if (trimToString(item.displayName) !== nextSampleName) {
        item.displayName = nextSampleName;
        syncCardSerialsFromFlow(card);
        appendCardLog(card, {
          action: 'Переименование образца',
          object: previousItemLabel,
          field: 'itemSerials',
          oldValue: previousItemLabel,
          newValue: nextSampleName,
          userName: me?.name || me?.username || me?.login || 'Пользователь'
        });
      }
    }
    const itemLabel = trimToString(item.displayName || item.id || 'Изделие');
    appendFlowHistoryEntryWithShift(data, {
      card,
      op: targetOp,
      shiftOp: op,
      item,
      status: 'PENDING',
      comment: 'Возврат',
      me,
      now
    });
    if (!item.current || typeof item.current !== 'object') item.current = {};
    item.current.opId = targetOp.id;
    item.current.opCode = targetOp.opCode || null;
    item.current.status = 'PENDING';
    item.current.updatedAt = now;
    item.finalStatus = 'PENDING';

    if (isIndividualOperationServer(data, card, op)) {
      detachItemFromPersonalOperationsServer(card, op.id, item.id);
    }
    if (trimToString(targetOp.id) !== trimToString(op.id) && isIndividualOperationServer(data, card, targetOp)) {
      detachItemFromPersonalOperationsServer(card, targetOp.id, item.id);
    }

    recalcOperationCountersFromFlow(card);
    recalcProductionStateFromFlow(card);
    updateFinalStatuses(card);
    applyPersonalOperationAggregatesToCardServer(data, card);
    card.flow.version = flowVersion + 1;

    appendCardLog(card, {
      action: 'Возврат изделия',
      object: itemLabel,
      field: 'operation',
      oldValue: prevOpLabel,
      newValue: nextOpLabel,
      userName: me?.name || me?.username || me?.login || 'Пользователь'
    });

    await database.update(current => {
      const draft = normalizeData(current);
      const idx = (draft.cards || []).findIndex(c => c && c.id === card.id);
      if (idx >= 0) {
        draft.cards[idx] = card;
        reconcileCardPlanningTasksServer(draft, draft.cards[idx]);
      }
      return draft;
    });
    const saved = await database.getData();
    broadcastCardsChanged(saved);
    sendJson(res, 200, { ok: true, flowVersion: card.flow.version, itemName: itemLabel });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/production/flow/defect') {
    const me = await ensureAuthenticated(req, res, { requireCsrf: true });
    if (!me) return true;
    const raw = await parseBody(req).catch(() => '');
    const payload = parseJsonBody(raw);
    if (!payload) {
      sendJson(res, 400, { error: 'Некорректные данные' });
      return true;
    }

    const cardId = trimToString(payload.cardId);
    const opId = trimToString(payload.opId);
    const itemId = trimToString(payload.itemId);
    const kindRaw = trimToString(payload.kind).toUpperCase();
    const expectedFlowVersion = normalizeExpectedRevisionInput(payload.expectedFlowVersion);
    if (!cardId || !opId || !itemId || !['ITEM', 'SAMPLE'].includes(kindRaw) || !Number.isFinite(expectedFlowVersion)) {
      sendJson(res, 400, { error: 'Некорректные параметры' });
      return true;
    }

    const data = await database.getData();
    const flowResult = ensureFlowForCards(Array.isArray(data.cards) ? data.cards : []);
    const card = findCardByKey({ ...data, cards: flowResult.cards }, cardId);
    if (!card) {
      sendJson(res, 404, { error: 'Карта не найдена' });
      return true;
    }

    const flowVersion = Number.isFinite(card.flow?.version) ? card.flow.version : 1;
    if (expectedFlowVersion !== flowVersion) {
      sendFlowVersionConflict(res, { cardId: card.id, expectedFlowVersion, flowVersion }, req);
      return true;
    }

    const op = findOperationInCard(card, opId);
    if (!op) {
      sendJson(res, 404, { error: 'Операция не найдена' });
      return true;
    }
    const opIsSamples = Boolean(op.isSamples);
    if ((kindRaw === 'SAMPLE' && !opIsSamples) || (kindRaw === 'ITEM' && opIsSamples)) {
      sendJson(res, 400, { error: 'Неверный тип операции' });
      return true;
    }

    const list = getFlowListForOp(card, op, kindRaw);
    const item = list.find(it => it && it.id === itemId);
    if (!item) {
      sendJson(res, 404, { error: 'Изделие не найдено' });
      return true;
    }
    if (item.current?.opId && item.current.opId !== opId) {
      sendJson(res, 409, { error: 'Изделие находится на другой операции' });
      return true;
    }
    if (normalizeFlowStatus(item.current?.status, null) !== 'DELAYED') {
      sendJson(res, 409, { error: 'Изделие не имеет статус Задержано' });
      return true;
    }

    const now = Date.now();
    const itemLabel = trimToString(item.displayName || item.id || 'Изделие');
    appendFlowHistoryEntryWithShift(data, {
      card,
      op,
      item,
      status: 'DEFECT',
      comment: 'Перенос в брак',
      me,
      now
    });
    if (!item.current || typeof item.current !== 'object') item.current = {};
    item.current.opId = opId;
    item.current.opCode = op.opCode || null;
    item.current.status = 'DEFECT';
    item.current.updatedAt = now;

    recalcOperationCountersFromFlow(card);
    recalcProductionStateFromFlow(card);
    refreshCardIndividualAggregateStateServer(data, card);
    card.flow.version = flowVersion + 1;

    appendCardLog(card, {
      action: 'Перенос в брак',
      object: itemLabel,
      field: 'status',
      oldValue: 'Задержано',
      newValue: 'Брак',
      userName: me?.name || me?.username || me?.login || 'Пользователь'
    });

    await database.update(current => {
      const draft = normalizeData(current);
      const idx = (draft.cards || []).findIndex(c => c && c.id === card.id);
      if (idx >= 0) {
        draft.cards[idx] = card;
        reconcileCardPlanningTasksServer(draft, draft.cards[idx]);
      }
      return draft;
    });
    const saved = await database.getData();
    const savedCard = findCardByKey(saved, card.id);
    broadcastCardEvent('updated', savedCard || card);
    broadcastCardsChanged(saved);
    sendJson(res, 200, { ok: true, flowVersion: card.flow.version });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/production/flow/repair/check') {
    const me = await ensureAuthenticated(req, res, { requireCsrf: true });
    if (!me) return true;
    const raw = await parseBody(req).catch(() => '');
    const payload = parseJsonBody(raw);
    if (!payload) {
      sendJson(res, 400, { error: 'Некорректные данные' });
      return true;
    }

    const cardId = trimToString(payload.cardId);
    const opId = trimToString(payload.opId);
    const itemId = trimToString(payload.itemId);
    const kindRaw = trimToString(payload.kind).toUpperCase();
    const expectedFlowVersion = normalizeExpectedRevisionInput(payload.expectedFlowVersion);

    if (!cardId || !opId || !itemId || !['ITEM', 'SAMPLE'].includes(kindRaw) || !Number.isFinite(expectedFlowVersion)) {
      sendJson(res, 400, { error: 'Некорректные параметры' });
      return true;
    }

    const data = await database.getData();
    const flowResult = ensureFlowForCards(Array.isArray(data.cards) ? data.cards : []);
    const card = findCardByKey({ ...data, cards: flowResult.cards }, cardId);
    if (!card) {
      sendJson(res, 404, { error: 'Карта не найдена' });
      return true;
    }

    const flowVersion = Number.isFinite(card.flow?.version) ? card.flow.version : 1;
    if (expectedFlowVersion !== flowVersion) {
      sendFlowVersionConflict(res, { cardId: card.id, expectedFlowVersion, flowVersion }, req);
      return true;
    }

    const op = findOperationInCard(card, opId);
    if (!op) {
      sendJson(res, 404, { error: 'Операция не найдена' });
      return true;
    }
    const opIsSamples = Boolean(op.isSamples);
    if ((kindRaw === 'SAMPLE' && !opIsSamples) || (kindRaw === 'ITEM' && opIsSamples)) {
      sendJson(res, 400, { error: 'Неверный тип операции' });
      return true;
    }

    const list = getFlowListForOp(card, op, kindRaw);
    const item = list.find(it => it && it.id === itemId);
    if (!item) {
      sendJson(res, 404, { error: 'Изделие не найдено' });
      return true;
    }
    if (item.current?.opId && item.current.opId !== opId) {
      sendJson(res, 409, { error: 'Изделие находится на другой операции' });
      return true;
    }
    if (normalizeFlowStatus(item.current?.status, null) !== 'DEFECT') {
      sendJson(res, 409, { error: 'Изделие не имеет статус Брак' });
      return true;
    }

    const baseRouteNo = trimToString(card.routeCardNumber || '');
    if (!baseRouteNo) {
      sendJson(res, 409, { error: 'Не указан номер МК (card-route-number)' });
      return true;
    }
    const baseRepairRouteNo = `${baseRouteNo}-РЕМ`;
    const isRepairRouteMatch = (value) => {
      const route = trimToString(value || '');
      if (route === baseRepairRouteNo) return true;
      if (!route.startsWith(`${baseRepairRouteNo}-`)) return false;
      const suffix = route.slice(baseRepairRouteNo.length + 1);
      return /^[0-9]+$/.test(suffix);
    };
    const isBaseRepairMatch = (entry) => {
      if (!entry || entry.archived) return false;
      if (entry.cardType && entry.cardType !== 'MKI') return false;
      return isRepairRouteMatch(entry.routeCardNumber);
    };
    const existingRepairCard = (flowResult.cards || []).find(isBaseRepairMatch) || null;
    const isDraftRepair = existingRepairCard && trimToString(existingRepairCard.approvalStage || '').toUpperCase() === 'DRAFT';

    sendJson(res, 200, {
      ok: true,
      existingRepairCardId: isDraftRepair ? existingRepairCard.id : null,
      existingRepairCardName: isDraftRepair ? (existingRepairCard.routeCardNumber || baseRepairRouteNo) : baseRepairRouteNo,
      existingRepairCardNotDraft: Boolean(existingRepairCard && !isDraftRepair)
    });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/production/flow/repair/options') {
    const me = await ensureAuthenticated(req, res, { requireCsrf: true });
    if (!me) return true;
    const raw = await parseBody(req).catch(() => '');
    const payload = parseJsonBody(raw);
    if (!payload) {
      sendJson(res, 400, { error: 'Некорректные данные' });
      return true;
    }

    const cardId = trimToString(payload.cardId);
    const opId = trimToString(payload.opId);
    const itemId = trimToString(payload.itemId);
    const kindRaw = trimToString(payload.kind).toUpperCase();
    const expectedFlowVersion = normalizeExpectedRevisionInput(payload.expectedFlowVersion);

    if (!cardId || !opId || !itemId || !['ITEM', 'SAMPLE'].includes(kindRaw) || !Number.isFinite(expectedFlowVersion)) {
      sendJson(res, 400, { error: 'Некорректные параметры' });
      return true;
    }

    const data = await database.getData();
    const flowResult = ensureFlowForCards(Array.isArray(data.cards) ? data.cards : []);
    const card = findCardByKey({ ...data, cards: flowResult.cards }, cardId);
    if (!card) {
      sendJson(res, 404, { error: 'Карта не найдена' });
      return true;
    }

    const flowVersion = Number.isFinite(card.flow?.version) ? card.flow.version : 1;
    if (expectedFlowVersion !== flowVersion) {
      sendFlowVersionConflict(res, { cardId: card.id, expectedFlowVersion, flowVersion }, req);
      return true;
    }

    const op = findOperationInCard(card, opId);
    if (!op) {
      sendJson(res, 404, { error: 'Операция не найдена' });
      return true;
    }
    const opIsSamples = Boolean(op.isSamples);
    if ((kindRaw === 'SAMPLE' && !opIsSamples) || (kindRaw === 'ITEM' && opIsSamples)) {
      sendJson(res, 400, { error: 'Неверный тип операции' });
      return true;
    }

    const list = getFlowListForOp(card, op, kindRaw);
    const item = list.find(it => it && it.id === itemId);
    if (!item) {
      sendJson(res, 404, { error: 'Изделие не найдено' });
      return true;
    }
    if (item.current?.opId && item.current.opId !== opId) {
      sendJson(res, 409, { error: 'Изделие находится на другой операции' });
      return true;
    }
    if (normalizeFlowStatus(item.current?.status, null) !== 'DEFECT') {
      sendJson(res, 409, { error: 'Изделие не имеет статус Брак' });
      return true;
    }

    const baseRouteNo = trimToString(card.routeCardNumber || '');
    if (!baseRouteNo) {
      sendJson(res, 409, { error: 'Не указан номер МК (card-route-number)' });
      return true;
    }

    const baseRepairPrefix = `${baseRouteNo}-РЕМ`;
    const isDraftRepair = (entry) => trimToString(entry?.approvalStage || '').toUpperCase() === 'DRAFT';
    const isRepairRouteMatch = (value) => {
      const route = trimToString(value || '');
      if (route === baseRepairPrefix) return true;
      if (!route.startsWith(`${baseRepairPrefix}-`)) return false;
      const suffix = route.slice(baseRepairPrefix.length + 1);
      return /^[0-9]+$/.test(suffix);
    };

    const options = (flowResult.cards || [])
      .filter(entry => entry && !entry.archived)
      .filter(entry => !entry.cardType || entry.cardType === 'MKI')
      .filter(entry => isDraftRepair(entry))
      .filter(entry => isRepairRouteMatch(entry.routeCardNumber))
      .map(entry => ({
        id: entry.id,
        label: trimToString(entry.routeCardNumber || entry.name || 'МК-РЕМ')
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru'));

    sendJson(res, 200, { ok: true, options });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/production/flow/repair') {
    const me = await ensureAuthenticated(req, res, { requireCsrf: true });
    if (!me) return true;
    const raw = await parseBody(req).catch(() => '');
    const payload = parseJsonBody(raw);
    if (!payload) {
      sendJson(res, 400, { error: 'Некорректные данные' });
      return true;
    }

    const cardId = trimToString(payload.cardId);
    const opId = trimToString(payload.opId);
    const itemId = trimToString(payload.itemId);
    const kindRaw = trimToString(payload.kind).toUpperCase();
    const expectedFlowVersion = normalizeExpectedRevisionInput(payload.expectedFlowVersion);
    const actionRaw = trimToString(payload.action).toLowerCase();
    const targetRepairCardId = trimToString(payload.targetRepairCardId);
    const trpnFile = payload.trpnFile && typeof payload.trpnFile === 'object'
      ? payload.trpnFile
      : null;

    if (!cardId || !opId || !itemId || !['ITEM', 'SAMPLE'].includes(kindRaw) || !Number.isFinite(expectedFlowVersion)) {
      sendJson(res, 400, { error: 'Некорректные параметры' });
      return true;
    }
    if (!trpnFile) {
      sendJson(res, 400, { error: 'Не указан файл ТРПН' });
      return true;
    }

    const data = await database.getData();
    const flowResult = ensureFlowForCards(Array.isArray(data.cards) ? data.cards : []);
    const card = findCardByKey({ ...data, cards: flowResult.cards }, cardId);
    if (!card) {
      sendJson(res, 404, { error: 'Карта не найдена' });
      return true;
    }

    const flowVersion = Number.isFinite(card.flow?.version) ? card.flow.version : 1;
    if (expectedFlowVersion !== flowVersion) {
      sendFlowVersionConflict(res, { cardId: card.id, expectedFlowVersion, flowVersion }, req);
      return true;
    }

    const op = findOperationInCard(card, opId);
    if (!op) {
      sendJson(res, 404, { error: 'Операция не найдена' });
      return true;
    }
    const opIsSamples = Boolean(op.isSamples);
    if ((kindRaw === 'SAMPLE' && !opIsSamples) || (kindRaw === 'ITEM' && opIsSamples)) {
      sendJson(res, 400, { error: 'Неверный тип операции' });
      return true;
    }

    const list = getFlowListForOp(card, op, kindRaw);
    const item = list.find(it => it && it.id === itemId);
    if (!item) {
      sendJson(res, 404, { error: 'Изделие не найдено' });
      return true;
    }
    if (item.current?.opId && item.current.opId !== opId) {
      sendJson(res, 409, { error: 'Изделие находится на другой операции' });
      return true;
    }
    if (normalizeFlowStatus(item.current?.status, null) !== 'DEFECT') {
      sendJson(res, 409, { error: 'Изделие не имеет статус Брак' });
      return true;
    }

    const name = trimToString(trpnFile.name || 'file');
    const content = trpnFile.content;
    const size = Number(trpnFile.size) || 0;
    const type = trimToString(trpnFile.type || 'application/octet-stream');
    if (!name || !content || typeof content !== 'string' || !content.startsWith('data:')) {
      sendJson(res, 400, { error: 'Некорректный файл ТРПН' });
      return true;
    }
    const safeName = normalizeDoubleExtension(name);
    const ext = path.extname(safeName || '').toLowerCase();
    if (ALLOWED_EXTENSIONS.length && ext && !ALLOWED_EXTENSIONS.includes(ext)) {
      sendJson(res, 400, { error: 'Недопустимый тип файла' });
      return true;
    }
    const buffer = decodeDataUrlToBuffer(content);
    if (!buffer) {
      sendJson(res, 400, { error: 'Некорректный файл ТРПН' });
      return true;
    }
    if (size > FILE_SIZE_LIMIT || buffer.length > FILE_SIZE_LIMIT) {
      sendJson(res, 400, { error: 'Файл слишком большой' });
      return true;
    }

    const now = Date.now();
    const itemLabel = trimToString(item.displayName || item.id || 'Изделие');
    const addToExisting = actionRaw === 'add_existing';
    const baseRouteNo = trimToString(card.routeCardNumber || '');
    if (!baseRouteNo) {
      sendJson(res, 409, { error: 'Не указан номер МК (card-route-number)' });
      return true;
    }
    const baseRepairRouteNo = `${baseRouteNo}-РЕМ`;
    const isRepairRouteMatch = (value) => {
      const route = trimToString(value || '');
      if (route === baseRepairRouteNo) return true;
      if (!route.startsWith(`${baseRepairRouteNo}-`)) return false;
      const suffix = route.slice(baseRepairRouteNo.length + 1);
      return /^[0-9]+$/.test(suffix);
    };
    const isBaseRepairMatch = (entry) => {
      if (!entry || entry.archived) return false;
      if (entry.cardType && entry.cardType !== 'MKI') return false;
      return isRepairRouteMatch(entry.routeCardNumber);
    };
    const findBaseRepairCard = () => (flowResult.cards || []).find(isBaseRepairMatch) || null;
    const isDraftRepair = (entry) => trimToString(entry?.approvalStage || '').toUpperCase() === 'DRAFT';

    let repairCard = null;
    let targetRepairCard = null;

    if (addToExisting) {
      targetRepairCard = (flowResult.cards || []).find(entry => entry && entry.id === targetRepairCardId) || findBaseRepairCard();
      if (!targetRepairCard) {
        sendJson(res, 404, { error: 'МК-РЕМ не найдена' });
        return true;
      }
      if (targetRepairCard.id === card.id) {
        sendJson(res, 409, { error: 'Неверная МК-РЕМ' });
        return true;
      }
      if (!isBaseRepairMatch(targetRepairCard)) {
        sendJson(res, 409, { error: 'МК-РЕМ не соответствует текущей карте' });
        return true;
      }
      if (!isDraftRepair(targetRepairCard)) {
        sendJson(res, 409, { error: 'Изделия можно переносить только в МК-РЕМ со статусом Черновик' });
        return true;
      }
      if (targetRepairCard.cardType && targetRepairCard.cardType !== 'MKI') {
        sendJson(res, 409, { error: 'Тип карты МК-РЕМ не совпадает' });
        return true;
      }
      const existingSerials = normalizeFlowSerialList(targetRepairCard.itemSerials, 0);
      const normalizedItemLabel = trimToString(itemLabel);
      const alreadyExists = normalizedItemLabel
        && existingSerials.some(value => trimToString(value) === normalizedItemLabel);
      if (alreadyExists) {
        sendJson(res, 409, { error: 'Изделие уже добавлено в МК-РЕМ' });
        return true;
      }
    } else {
      const normalizeRepairLabel = (base, existing) => {
        const trimmed = trimToString(base);
        if (!trimmed) return trimmed;
        const baseLabel = `${trimmed}-РЕМ`;
        if (!existing.has(baseLabel)) return baseLabel;
        let idx = 1;
        while (existing.has(`${baseLabel}-${idx}`)) idx += 1;
        return `${baseLabel}-${idx}`;
      };

      const existingRoutes = new Set(
        (data.cards || [])
          .map(c => trimToString(c?.routeCardNumber || ''))
          .filter(Boolean)
      );

      const buildRepairCard = () => {
        const next = deepClone(card);
        const nextRouteNo = baseRouteNo;
        next.id = genId('card');
        next.archived = false;
        next.status = 'NOT_STARTED';
        next.createdAt = now;
        next.updatedAt = now;
        next.approvalStage = 'DRAFT';
        next.approvalThread = [];
        next.approvalProductionStatus = null;
        next.approvalSKKStatus = null;
        next.approvalTechStatus = null;
        next.inputControlComment = '';
        next.inputControlFileId = '';
        next.inputControlDoneAt = null;
        next.inputControlDoneBy = '';
        next.provisionDoneAt = null;
        next.provisionDoneBy = '';
        next.rejectionReason = '';
        next.rejectionReadByUserName = '';
        next.rejectionReadAt = null;
        next.responsibleProductionChief = '';
        next.responsibleProductionChiefAt = null;
        next.responsibleSKKChief = '';
        next.responsibleSKKChiefAt = null;
        next.responsibleTechLead = '';
        next.responsibleTechLeadAt = null;
        if (nextRouteNo) {
          const normalized = normalizeRepairLabel(nextRouteNo, existingRoutes);
          next.routeCardNumber = normalized;
          next.name = normalized;
        }
        next.qrId = generateUniqueQrId(data.cards);
        next.barcode = generateUniqueCode128(data.cards);
        next.logs = [];
        next.attachments = [];
        next.mainMaterials = '';
        next.quantity = 1;
        next.batchSize = 1;
        next.itemSerials = [itemLabel];
        next.sampleCount = Number.isFinite(parseInt(card.sampleCount, 10)) ? card.sampleCount : '';
        next.sampleSerials = Array.isArray(card.sampleSerials) ? card.sampleSerials.slice() : [];
        next.witnessSampleCount = Number.isFinite(parseInt(card.witnessSampleCount, 10)) ? card.witnessSampleCount : '';
        next.witnessSampleSerials = Array.isArray(card.witnessSampleSerials) ? card.witnessSampleSerials.slice() : [];

        next.operations = (card.operations || []).map(opEntry => {
          const opNext = deepClone(opEntry);
          opNext.id = genId('rop');
          opNext.status = 'NOT_STARTED';
          opNext.startedAt = null;
          opNext.pausedAt = null;
          opNext.finishedAt = null;
          opNext.elapsedSeconds = 0;
          opNext.actualSeconds = 0;
          opNext.pendingCount = null;
          opNext.blocked = false;
          opNext.blockedReasons = [];
          opNext.canStart = false;
          opNext.canPause = false;
          opNext.canResume = false;
          opNext.canComplete = false;
          delete opNext.flowStats;
          delete opNext.goodCount;
          delete opNext.scrapCount;
          delete opNext.holdCount;
          return opNext;
        });

        next.flow = { items: [], samples: [], events: [], version: 1 };
        ensureCardFlow(next, new Set());
        (next.flow?.items || []).forEach(flowItem => {
          if (flowItem && flowItem.kind === 'ITEM') flowItem.extraStatus = 'REPAIR';
        });
        recalcProductionStateFromFlow(next);

        const snapshot = deepClone(next);
        snapshot.logs = [];
        snapshot.initialSnapshot = null;
        next.initialSnapshot = snapshot;
        return next;
      };

      repairCard = buildRepairCard();
    }

    appendFlowHistoryEntryWithShift(data, {
      card,
      op,
      item,
      status: 'PENDING',
      comment: 'Перемещение в МК-РЕМ',
      me,
      now
    });

    const archiveRemovedFlowItem = (targetCard) => {
      if (!card || !item) return;
      if (!card.flow || typeof card.flow !== 'object') {
        card.flow = { items: [], samples: [], events: [], version: 1 };
      }
      if (!Array.isArray(card.flow.archivedItems)) {
        card.flow.archivedItems = [];
      }
      const archived = deepClone(item);
      if (!archived || typeof archived !== 'object') return;
      const targetName = trimToString(targetCard?.name || '');
      const targetRouteNo = trimToString(targetCard?.routeCardNumber || '');
      const targetLabel = targetRouteNo
        ? `МК № ${targetRouteNo}`
        : trimToString(targetCard?.name || 'МК');
      archived.archivedAt = now;
      archived.archivedReason = 'MOVED';
      archived.archivedTarget = {
        cardId: trimToString(targetCard?.id || ''),
        name: targetName,
        routeCardNumber: targetRouteNo,
        label: targetLabel
      };
      card.flow.archivedItems.push(archived);
    };

    const removeItemFromCard = () => {
      if (kindRaw === 'SAMPLE') {
        const sampleType = normalizeSampleTypeServer(item?.sampleType);
        const idx = (card.flow?.samples || []).findIndex(it => it && it.id === itemId);
        if (idx >= 0) {
          card.flow.samples.splice(idx, 1);
          const serialsKey = sampleType === 'WITNESS' ? 'witnessSampleSerials' : 'sampleSerials';
          const countKey = sampleType === 'WITNESS' ? 'witnessSampleCount' : 'sampleCount';
          if (Array.isArray(card[serialsKey])) {
            const serialIdx = card[serialsKey].findIndex(val => trimToString(val) === trimToString(item.displayName || ''));
            if (serialIdx >= 0) card[serialsKey].splice(serialIdx, 1);
          }
          if (Number.isFinite(parseInt(card[countKey], 10))) {
            card[countKey] = Math.max(0, parseInt(card[countKey], 10) - 1);
          }
        }
      } else {
        const idx = (card.flow?.items || []).findIndex(it => it && it.id === itemId);
        if (idx >= 0) {
          card.flow.items.splice(idx, 1);
          if (Array.isArray(card.itemSerials) && card.itemSerials.length > idx) {
            card.itemSerials.splice(idx, 1);
          } else if (Number.isFinite(parseInt(card.quantity, 10))) {
            card.quantity = Math.max(0, parseInt(card.quantity, 10) - 1);
          }
        }
      }
    };

    const targetCard = addToExisting ? targetRepairCard : repairCard;
    archiveRemovedFlowItem(targetCard);
    removeItemFromCard();

    if (addToExisting && targetRepairCard) {
      const existingSerials = normalizeFlowSerialList(targetRepairCard.itemSerials, 0);
      existingSerials.push(itemLabel);
      targetRepairCard.itemSerials = existingSerials;
      const nextQty = toSafeCountServer(targetRepairCard.quantity) + 1;
      targetRepairCard.quantity = nextQty;
      if (targetRepairCard.batchSize == null || targetRepairCard.batchSize === '') {
        targetRepairCard.batchSize = nextQty;
      } else {
        targetRepairCard.batchSize = toSafeCountServer(targetRepairCard.batchSize) + 1;
      }
      targetRepairCard.updatedAt = now;

      const usedSet = buildFlowQrSet(flowResult.cards || []);
      appendRepairFlowItem(targetRepairCard, itemLabel, usedSet);
      recalcOperationCountersFromFlow(targetRepairCard);
      recalcProductionStateFromFlow(targetRepairCard);
      const targetFlowVersion = Number.isFinite(targetRepairCard.flow?.version) ? targetRepairCard.flow.version : 1;
      targetRepairCard.flow.version = targetFlowVersion + 1;
    }

    const qr = normalizeQrIdServer(card.qrId || '');
    if (!isValidQrIdServer(qr)) {
      sendJson(res, 400, { error: 'Некорректный QR карты' });
      return true;
    }
    ensureCardStorageFoldersByQr(qr);
    const storedName = makeStoredName(safeName);
    const folder = categoryToFolder('TRPN');
    const relPath = `${folder}/${storedName}`;
    const absPath = path.join(CARDS_STORAGE_DIR, qr, relPath);
    fs.writeFileSync(absPath, buffer);
    const trpnMeta = {
      id: genId('file'),
      name: name,
      originalName: safeName,
      storedName,
      relPath,
      type: type || 'application/octet-stream',
      mime: type || 'application/octet-stream',
      size: size || buffer.length,
      createdAt: Date.now(),
      category: 'TRPN',
      scope: 'CARD',
      scopeId: null
    };
    card.attachments = Array.isArray(card.attachments) ? card.attachments : [];
    card.attachments.push(trpnMeta);

    recalcOperationCountersFromFlow(card);
    recalcProductionStateFromFlow(card);
    refreshCardIndividualAggregateStateServer(data, card);
    card.flow.version = flowVersion + 1;
    appendCardLog(card, {
      action: 'Ремонт изделия',
      object: itemLabel,
      field: 'repair',
      oldValue: 'Брак',
      newValue: addToExisting ? 'МК-РЕМ (добавлено)' : 'МК-РЕМ',
      userName: me?.name || me?.username || me?.login || 'Пользователь'
    });

    await database.update(current => {
      const draft = normalizeData(current);
      const idx = (draft.cards || []).findIndex(c => c && c.id === card.id);
      if (idx >= 0) {
        draft.cards[idx] = card;
        reconcileCardPlanningTasksServer(draft, draft.cards[idx]);
      }
      if (addToExisting && targetRepairCard) {
        const targetIdx = (draft.cards || []).findIndex(c => c && c.id === targetRepairCard.id);
        if (targetIdx >= 0) {
          draft.cards[targetIdx] = targetRepairCard;
          reconcileCardPlanningTasksServer(draft, draft.cards[targetIdx]);
        }
      }
      draft.cards = Array.isArray(draft.cards) ? draft.cards : [];
      if (!addToExisting && repairCard) {
        draft.cards.push(repairCard);
        reconcileCardPlanningTasksServer(draft, repairCard);
      }
      return draft;
    });
    const saved = await database.getData();
    broadcastCardsChanged(saved);
    if (addToExisting && targetRepairCard) {
      const targetLabel = targetRepairCard.routeCardNumber
        ? `МК № ${targetRepairCard.routeCardNumber}`
        : (targetRepairCard.name || 'МК-РЕМ');
      sendJson(res, 200, {
        ok: true,
        mode: 'add_existing',
        flowVersion: card.flow.version,
        targetCardId: targetRepairCard.id,
        targetCardLabel: targetLabel
      });
    } else if (repairCard) {
      const newCardLabel = repairCard.routeCardNumber ? `МК № ${repairCard.routeCardNumber}` : (repairCard.name || 'МК-РЕМ');
      sendJson(res, 200, {
        ok: true,
        mode: 'create_new',
        flowVersion: card.flow.version,
        newCardId: repairCard.id,
        newCardQr: repairCard.qrId,
        newCardLabel
      });
    } else {
      sendJson(res, 200, { ok: true, flowVersion: card.flow.version });
    }
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/production/flow/dispose') {
    const me = await ensureAuthenticated(req, res, { requireCsrf: true });
    if (!me) return true;
    const raw = await parseBody(req).catch(() => '');
    const payload = parseJsonBody(raw);
    if (!payload) {
      sendJson(res, 400, { error: 'Некорректные данные' });
      return true;
    }

    const cardId = trimToString(payload.cardId);
    const opId = trimToString(payload.opId);
    const itemId = trimToString(payload.itemId);
    const kindRaw = trimToString(payload.kind).toUpperCase();
    const expectedFlowVersion = normalizeExpectedRevisionInput(payload.expectedFlowVersion);
    const trpnFile = payload.trpnFile && typeof payload.trpnFile === 'object'
      ? payload.trpnFile
      : null;

    if (!cardId || !opId || !itemId || !['ITEM', 'SAMPLE'].includes(kindRaw) || !Number.isFinite(expectedFlowVersion)) {
      sendJson(res, 400, { error: 'Некорректные параметры' });
      return true;
    }
    if (!trpnFile) {
      sendJson(res, 400, { error: 'Не указан файл ТРПН' });
      return true;
    }

    const data = await database.getData();
    const flowResult = ensureFlowForCards(Array.isArray(data.cards) ? data.cards : []);
    const card = findCardByKey({ ...data, cards: flowResult.cards }, cardId);
    if (!card) {
      sendJson(res, 404, { error: 'Карта не найдена' });
      return true;
    }

    const flowVersion = Number.isFinite(card.flow?.version) ? card.flow.version : 1;
    if (expectedFlowVersion !== flowVersion) {
      sendFlowVersionConflict(res, { cardId: card.id, expectedFlowVersion, flowVersion }, req);
      return true;
    }

    const op = findOperationInCard(card, opId);
    if (!op) {
      sendJson(res, 404, { error: 'Операция не найдена' });
      return true;
    }
    const opIsSamples = Boolean(op.isSamples);
    if ((kindRaw === 'SAMPLE' && !opIsSamples) || (kindRaw === 'ITEM' && opIsSamples)) {
      sendJson(res, 400, { error: 'Неверный тип операции' });
      return true;
    }

    const list = getFlowListForOp(card, op, kindRaw);
    const item = list.find(it => it && it.id === itemId);
    if (!item) {
      sendJson(res, 404, { error: 'Изделие не найдено' });
      return true;
    }
    if (item.current?.opId && item.current.opId !== opId) {
      sendJson(res, 409, { error: 'Изделие находится на другой операции' });
      return true;
    }
    if (normalizeFlowStatus(item.current?.status, null) !== 'DEFECT') {
      sendJson(res, 409, { error: 'Изделие не имеет статус Брак' });
      return true;
    }

    const name = trimToString(trpnFile.name || 'file');
    const content = trpnFile.content;
    const size = Number(trpnFile.size) || 0;
    const type = trimToString(trpnFile.type || 'application/octet-stream');
    if (!name || !content || typeof content !== 'string' || !content.startsWith('data:')) {
      sendJson(res, 400, { error: 'Некорректный файл ТРПН' });
      return true;
    }
    const safeName = normalizeDoubleExtension(name);
    const ext = path.extname(safeName || '').toLowerCase();
    if (ALLOWED_EXTENSIONS.length && ext && !ALLOWED_EXTENSIONS.includes(ext)) {
      sendJson(res, 400, { error: 'Недопустимый тип файла' });
      return true;
    }
    const buffer = decodeDataUrlToBuffer(content);
    if (!buffer) {
      sendJson(res, 400, { error: 'Некорректный файл ТРПН' });
      return true;
    }
    if (size > FILE_SIZE_LIMIT || buffer.length > FILE_SIZE_LIMIT) {
      sendJson(res, 400, { error: 'Файл слишком большой' });
      return true;
    }

    const now = Date.now();
    const itemLabel = trimToString(item.displayName || item.id || 'Изделие');
    appendFlowHistoryEntryWithShift(data, {
      card,
      op,
      item,
      status: 'DISPOSED',
      comment: 'Утилизация',
      me,
      now
    });
    if (!item.current || typeof item.current !== 'object') item.current = {};
    item.current.opId = opId;
    item.current.opCode = op.opCode || null;
    item.current.status = 'DISPOSED';
    item.current.updatedAt = now;

    const qr = normalizeQrIdServer(card.qrId || '');
    if (!isValidQrIdServer(qr)) {
      sendJson(res, 400, { error: 'Некорректный QR карты' });
      return true;
    }
    ensureCardStorageFoldersByQr(qr);
    const storedName = makeStoredName(safeName);
    const folder = categoryToFolder('TRPN');
    const relPath = `${folder}/${storedName}`;
    const absPath = path.join(CARDS_STORAGE_DIR, qr, relPath);
    fs.writeFileSync(absPath, buffer);
    const trpnMeta = {
      id: genId('file'),
      name: name,
      originalName: safeName,
      storedName,
      relPath,
      type: type || 'application/octet-stream',
      mime: type || 'application/octet-stream',
      size: size || buffer.length,
      createdAt: Date.now(),
      category: 'TRPN',
      scope: 'CARD',
      scopeId: null
    };
    card.attachments = Array.isArray(card.attachments) ? card.attachments : [];
    card.attachments.push(trpnMeta);

    recalcOperationCountersFromFlow(card);
    recalcProductionStateFromFlow(card);
    refreshCardIndividualAggregateStateServer(data, card);
    card.flow.version = flowVersion + 1;

    appendCardLog(card, {
      action: 'Утилизация изделия',
      object: itemLabel,
      field: 'status',
      oldValue: 'Брак',
      newValue: 'Утилизировано',
      userName: me?.name || me?.username || me?.login || 'Пользователь'
    });

    await database.update(current => {
      const draft = normalizeData(current);
      const idx = (draft.cards || []).findIndex(c => c && c.id === card.id);
      if (idx >= 0) {
        draft.cards[idx] = card;
        reconcileCardPlanningTasksServer(draft, draft.cards[idx]);
      }
      return draft;
    });
    const saved = await database.getData();
    broadcastCardsChanged(saved);
    sendJson(res, 200, { ok: true, flowVersion: card.flow.version });
    return true;
  }

  if (req.method === 'POST' && pathname.startsWith('/api/production/operation/')) {
    const me = await ensureAuthenticated(req, res, { requireCsrf: true });
    if (!me) return true;
    const raw = await parseBody(req).catch(() => '');
    const payload = parseJsonBody(raw);
    if (!payload) {
      sendJson(res, 400, { error: 'Некорректные данные' });
      return true;
    }

    const action = pathname.split('/').pop();
    if (!['start', 'pause', 'resume', 'complete', 'reset', 'material-issue', 'material-issue-complete', 'material-return', 'drying-start', 'drying-finish', 'drying-complete'].includes(action)) {
      sendJson(res, 404, { error: 'Неизвестное действие' });
      return true;
    }

    const cardId = trimToString(payload.cardId);
    const opId = trimToString(payload.opId);
    const source = trimToString(payload.source).toLowerCase();
    const expectedFlowVersion = normalizeExpectedRevisionInput(payload.expectedFlowVersion);
    if (!cardId || !opId || !Number.isFinite(expectedFlowVersion)) {
      sendJson(res, 400, { error: 'Некорректные параметры' });
      return true;
    }

    const data = await database.getData();
    const flowResult = ensureFlowForCards(Array.isArray(data.cards) ? data.cards : []);
    const card = findCardByKey({ ...data, cards: flowResult.cards }, cardId);
    if (!card) {
      sendJson(res, 404, { error: 'Карта не найдена' });
      return true;
    }

    const flowVersion = Number.isFinite(card.flow?.version) ? card.flow.version : 1;
    if (expectedFlowVersion !== flowVersion) {
      sendFlowVersionConflict(res, { cardId: card.id, expectedFlowVersion, flowVersion }, req);
      return true;
    }

    const op = findOperationInCard(card, opId);
    if (!op) {
      sendJson(res, 404, { error: 'Операция не найдена' });
      return true;
    }
    if (
      card.cardType === 'MKI'
      && isIndividualOperationServer(data, card, op)
      && ['start', 'pause', 'resume', 'complete'].includes(action)
    ) {
      sendJson(res, 409, {
        error: action === 'start'
          ? 'Для участка «Индивид.» используйте выбор изделий.'
          : 'Для участка «Индивид.» действие доступно только на личной операции.'
      });
      return true;
    }

    const usesFlow = card.cardType === 'MKI';
    recalcProductionStateFromFlow(card);

    if (source === 'workspace' && !isWorkspaceOperationAllowed(data, card, op)) {
      sendJson(res, 409, { error: 'Операция не запланирована на текущую смену' });
      return true;
    }
    if (source === 'workspace') {
      const roleAccess = getWorkspaceOperationRoleAccessServer(data, me, card, op);
      if (!roleAccess.roleAllowed) {
        sendJson(res, 403, { error: roleAccess.denialReason || 'Нет прав для выполнения операции в рабочем месте' });
        return true;
      }
    }
    if (!canUserOperateSubcontractTaskServer(data, me, card, op)) {
      sendJson(res, 403, { error: 'Действие на операции субподрядчика разрешено только мастеру смены или назначенному исполнителю' });
      return true;
    }

    if (action === 'start' && !op.canStart) {
      sendJson(res, 409, { error: 'Операцию нельзя начать', reasons: op.blockedReasons || [] });
      return true;
    }
    if (action === 'reset' && op.status === 'DONE') {
      sendJson(res, 409, { error: 'Операцию нельзя завершить' });
      return true;
    }
    if (action === 'pause' && op.status !== 'IN_PROGRESS') {
      sendJson(res, 409, { error: 'Операцию нельзя поставить на паузу' });
      return true;
    }
    if (action === 'resume' && !op.canResume) {
      sendJson(res, 409, { error: 'Операцию нельзя продолжить', reasons: op.blockedReasons || [] });
      return true;
    }
    if (action === 'complete') {
      if (usesFlow) {
        sendJson(res, 400, { error: 'Завершение по количеству недоступно для MKI' });
        return true;
      }
      if (op.status !== 'IN_PROGRESS') {
        sendJson(res, 409, { error: 'Операцию нельзя завершить' });
        return true;
      }
    }
    if (action === 'start' && isDryingOperation(op)) {
      sendJson(res, 400, { error: 'Для операции «Сушка» используйте кнопку «Сушить».' });
      return true;
    }
    if (action === 'material-issue' || action === 'material-issue-complete') {
      if (!usesFlow) {
        sendJson(res, 400, { error: 'Выдача материала доступна только для MKI' });
        return true;
      }
      if (!isMaterialIssueOperation(op)) {
        sendJson(res, 400, { error: 'Неверный тип операции' });
        return true;
      }
      if (!['IN_PROGRESS', 'PAUSED'].includes(op.status)) {
        sendJson(res, 409, { error: 'Операцию нельзя завершить' });
        return true;
      }
    }
    if (action === 'material-return') {
      if (!usesFlow) {
        sendJson(res, 400, { error: 'Возврат материала доступен только для MKI' });
        return true;
      }
      if (!isMaterialReturnOperation(op)) {
        sendJson(res, 400, { error: 'Неверный тип операции' });
        return true;
      }
      if (!['IN_PROGRESS', 'PAUSED'].includes(op.status)) {
        sendJson(res, 409, { error: 'Операцию нельзя завершить' });
        return true;
      }
    }
    if (action === 'drying-start' || action === 'drying-finish' || action === 'drying-complete') {
      if (!usesFlow) {
        sendJson(res, 400, { error: 'Сушка доступна только для MKI' });
        return true;
      }
      if (!isDryingOperation(op)) {
        sendJson(res, 400, { error: 'Неверный тип операции' });
        return true;
      }
      if (action === 'drying-start' && !op.canStart) {
        sendJson(res, 409, { error: 'Операцию «Сушка» нельзя начать', reasons: op.blockedReasons || [] });
        return true;
      }
      if (action === 'drying-complete') {
        const dryingEntry = ensureDryingEntryServer(card, opId, me?.name || 'Пользователь');
        const dryingRows = Array.isArray(dryingEntry?.dryingRows) ? dryingEntry.dryingRows : [];
        const hasActive = dryingRows.some(row => trimToString(row?.status || '').toUpperCase() === 'IN_PROGRESS');
        if (hasActive) {
          sendJson(res, 409, { error: 'Нельзя завершить операцию, пока есть активная сушка.' });
          return true;
        }
        const hasDone = dryingRows.some(row => trimToString(row?.status || '').toUpperCase() === 'DONE');
        if (!hasDone) {
          sendJson(res, 409, { error: 'Нельзя завершить операцию без сухого порошка.' });
          return true;
        }
      }
    }

    const prevOpStatus = op.status;
    const prevCardStatus = card.productionStatus || card.status || 'NOT_STARTED';
    const now = Date.now();
    const nowUser = me?.name || 'Пользователь';
    const allowedUnits = new Set(['кг', 'шт', 'л', 'м', 'м2', 'м3', 'пог.м', 'упак', 'компл', 'лист', 'рул', 'набор', 'боб', 'бут', 'пар']);
    const normalizeDecimalInputServer = (value) => {
      const raw = trimToString(value || '');
      if (!raw) return '';
      const normalized = raw.replace(',', '.');
      if (!/^[0-9]+(\.[0-9]+)?$/.test(normalized)) return '';
      return normalized;
    };
    const formatDecimalDisplayServer = (value) => {
      const normalized = normalizeDecimalInputServer(value);
      if (!normalized) return '';
      return normalized.replace('.', ',');
    };
    const toDecimalPartsServer = (value) => {
      const normalized = normalizeDecimalInputServer(value);
      if (!normalized) return null;
      const [intPartRaw, fracRaw = ''] = normalized.split('.');
      const intPart = intPartRaw.replace(/^0+(?=\d)/, '') || '0';
      return { intPart, fracPart: fracRaw, scale: fracRaw.length };
    };
    const toScaledBigIntServer = (parts, scale) => {
      const frac = (parts.fracPart || '').padEnd(scale, '0');
      const raw = (parts.intPart || '0') + frac;
      return BigInt(raw || '0');
    };
    const compareDecimalServer = (a, b) => {
      const aParts = toDecimalPartsServer(a || '0');
      const bParts = toDecimalPartsServer(b || '0');
      if (!aParts || !bParts) return null;
      const scale = Math.max(aParts.scale, bParts.scale);
      const aScaled = toScaledBigIntServer(aParts, scale);
      const bScaled = toScaledBigIntServer(bParts, scale);
      if (aScaled === bScaled) return 0;
      return aScaled > bScaled ? 1 : -1;
    };
    const subtractDecimalServer = (a, b) => {
      const aParts = toDecimalPartsServer(a || '0');
      const bParts = toDecimalPartsServer(b || '0');
      if (!aParts || !bParts) return '';
      const scale = Math.max(aParts.scale, bParts.scale);
      const aScaled = toScaledBigIntServer(aParts, scale);
      const bScaled = toScaledBigIntServer(bParts, scale);
      const diff = aScaled - bScaled;
      const sign = diff < 0n ? '-' : '';
      const abs = diff < 0n ? -diff : diff;
      let str = abs.toString().padStart(scale + 1, '0');
      if (scale > 0) {
        const head = str.slice(0, -scale) || '0';
        const tail = str.slice(-scale);
        return sign + head + ',' + tail;
      }
      return sign + str;
    };
    const stopOperationPreservingElapsedServer = (targetOp, nextStatus = 'NOT_STARTED') => {
      if (!targetOp) return;
      if (targetOp.status === 'IN_PROGRESS') {
        const diff = targetOp.startedAt ? (now - targetOp.startedAt) / 1000 : 0;
        targetOp.elapsedSeconds = (targetOp.elapsedSeconds || 0) + diff;
      }
      targetOp.startedAt = null;
      targetOp.lastPausedAt = null;
      targetOp.finishedAt = null;
      targetOp.actualSeconds = targetOp.elapsedSeconds || 0;
      targetOp.status = nextStatus;
    };

    if (action === 'start') {
      if (isMaterialReturnOperation(op) && op.status === 'DONE') {
        op.returnCompletedOnce = true;
      }
      if (isMaterialIssueOperation(op) && op.status === 'DONE') {
        op.finishedAt = null;
        op.lastPausedAt = null;
        op.startedAt = null;
      }
      if (isMaterialReturnOperation(op) && op.status === 'DONE') {
        op.finishedAt = null;
        op.lastPausedAt = null;
        op.startedAt = null;
      }
      if (!op.firstStartedAt) op.firstStartedAt = now;
      op.status = 'IN_PROGRESS';
      op.startedAt = now;
      op.lastPausedAt = null;
      if (!Number.isFinite(op.elapsedSeconds) && Number.isFinite(op.actualSeconds)) {
        op.elapsedSeconds = op.actualSeconds;
      }
      if (!Number.isFinite(op.elapsedSeconds)) op.elapsedSeconds = 0;
    } else if (action === 'pause') {
      const diff = op.startedAt ? (now - op.startedAt) / 1000 : 0;
      op.elapsedSeconds = (op.elapsedSeconds || 0) + diff;
      op.lastPausedAt = now;
      op.startedAt = null;
      op.status = 'PAUSED';
    } else if (action === 'resume') {
      if (!op.firstStartedAt) op.firstStartedAt = now;
      op.status = 'IN_PROGRESS';
      op.startedAt = now;
      op.lastPausedAt = null;
      if (!Number.isFinite(op.elapsedSeconds)) op.elapsedSeconds = 0;
    } else if (action === 'complete') {
      const goodCount = toSafeCount(payload.goodCount || 0);
      const scrapCount = toSafeCount(payload.scrapCount || 0);
      const holdCount = toSafeCount(payload.holdCount || 0);
      const rawQtyTotal = getOperationQuantity(op, card);
      const qtyTotal = rawQtyTotal === '' || rawQtyTotal == null ? null : toSafeCount(rawQtyTotal);
      if (qtyTotal != null && qtyTotal > 0) {
        const sum = goodCount + scrapCount + holdCount;
        if (sum !== qtyTotal) {
          sendJson(res, 409, { error: 'Количество деталей не совпадает' });
          return true;
        }
      }

      if (op.status === 'IN_PROGRESS') {
        const diff = op.startedAt ? (now - op.startedAt) / 1000 : 0;
        op.elapsedSeconds = (op.elapsedSeconds || 0) + diff;
      }
      op.goodCount = goodCount;
      op.scrapCount = scrapCount;
      op.holdCount = holdCount;
      op.startedAt = null;
      op.finishedAt = now;
      op.lastPausedAt = null;
      op.actualSeconds = op.elapsedSeconds || 0;
      op.status = 'DONE';
    } else if (action === 'drying-start') {
      const rowId = trimToString(payload.rowId || '');
      const dryQtyRaw = trimToString(payload.dryQty || '');
      const normalizedDryQty = normalizeDecimalInputServer(dryQtyRaw);
      if (!rowId || !normalizedDryQty) {
        sendJson(res, 400, { error: 'Проверьте количество для сушки.' });
        return true;
      }
      if (compareDecimalServer(normalizedDryQty, '0') == null || compareDecimalServer(normalizedDryQty, '0') <= 0) {
        sendJson(res, 400, { error: 'Количество для сушки должно быть больше нуля.' });
        return true;
      }

      const dryingEntry = ensureDryingEntryServer(card, opId, nowUser);
      const dryingRows = Array.isArray(dryingEntry?.dryingRows) ? dryingEntry.dryingRows : [];
      const rowIndex = dryingRows.findIndex(row => trimToString(row?.rowId || '') === rowId);
      if (rowIndex < 0) {
        sendJson(res, 404, { error: 'Строка сушки не найдена.' });
        return true;
      }

      const row = dryingRows[rowIndex];
      if (trimToString(row?.status || '').toUpperCase() !== 'NOT_STARTED') {
        sendJson(res, 409, { error: 'Процесс сушки уже начат или завершен.' });
        return true;
      }
      if (!row.name || !row.qty || !row.unit || !allowedUnits.has(row.unit) || !row.isPowder) {
        sendJson(res, 400, { error: 'Строка сушки заполнена некорректно.' });
        return true;
      }
      if (compareDecimalServer(row.qty, normalizedDryQty) == null || compareDecimalServer(row.qty, normalizedDryQty) < 0) {
        sendJson(res, 400, { error: 'Количество для сушки не может быть больше количества в строке.' });
        return true;
      }

      row.dryQty = formatDecimalDisplayServer(normalizedDryQty);
      row.dryResultQty = '';
      row.status = 'IN_PROGRESS';
      row.startedAt = now;
      row.finishedAt = null;
      row.updatedAt = now;

      if (compareDecimalServer(row.qty, normalizedDryQty) > 0) {
        dryingRows.splice(rowIndex + 1, 0, {
          rowId: genId('dry'),
          sourceIssueOpId: trimToString(row.sourceIssueOpId || ''),
          sourceItemIndex: Number.isFinite(Number(row.sourceItemIndex)) ? Number(row.sourceItemIndex) : -1,
          name: trimToString(row.name || ''),
          qty: subtractDecimalServer(row.qty, normalizedDryQty),
          unit: trimToString(row.unit || 'кг') || 'кг',
          isPowder: true,
          dryQty: '',
          dryResultQty: '',
          status: 'NOT_STARTED',
          startedAt: null,
          finishedAt: null,
          createdAt: now,
          updatedAt: now
        });
      }

      op.dryingCompletedManually = false;
      dryingEntry.updatedAt = now;
      dryingEntry.updatedBy = nowUser;

      appendCardLog(card, {
        action: 'Старт сушки',
        object: op.opName || op.opCode || 'Операция',
        targetId: op.id,
        field: 'dryingRows',
        oldValue: '',
        newValue: `${row.name}; ${row.dryQty} ${row.unit}; старт ${new Date(now).toLocaleString('ru-RU')}`,
        userName: nowUser
      });
    } else if (action === 'drying-finish') {
      const rowId = trimToString(payload.rowId || '');
      if (!rowId) {
        sendJson(res, 400, { error: 'Строка сушки не найдена.' });
        return true;
      }

      const dryingEntry = ensureDryingEntryServer(card, opId, nowUser);
      const dryingRows = Array.isArray(dryingEntry?.dryingRows) ? dryingEntry.dryingRows : [];
      const row = dryingRows.find(item => trimToString(item?.rowId || '') === rowId) || null;
      if (!row) {
        sendJson(res, 404, { error: 'Строка сушки не найдена.' });
        return true;
      }
      if (trimToString(row.status || '').toUpperCase() !== 'IN_PROGRESS') {
        sendJson(res, 409, { error: 'Процесс сушки уже завершен.' });
        return true;
      }

      row.status = 'DONE';
      row.finishedAt = now;
      row.dryResultQty = trimToString(row.dryQty || '');
      row.updatedAt = now;
      dryingEntry.updatedAt = now;
      dryingEntry.updatedBy = nowUser;

      appendCardLog(card, {
        action: 'Завершение сушки',
        object: op.opName || op.opCode || 'Операция',
        targetId: op.id,
        field: 'dryingRows',
        oldValue: '',
        newValue: `${row.name}; ${row.dryResultQty} ${row.unit}; завершение ${new Date(now).toLocaleString('ru-RU')}`,
        userName: nowUser
      });
    } else if (action === 'drying-complete') {
      if (op.status === 'IN_PROGRESS') {
        const diff = op.startedAt ? (now - op.startedAt) / 1000 : 0;
        op.elapsedSeconds = (op.elapsedSeconds || 0) + diff;
      }
      op.startedAt = null;
      op.lastPausedAt = null;
      op.finishedAt = now;
      op.actualSeconds = op.elapsedSeconds || 0;
      op.dryingCompletedManually = true;
    } else if (action === 'material-issue') {
      const rawItems = Array.isArray(payload.materials) ? payload.materials : [];
      let items = rawItems.map(item => ({
        name: trimToString(item?.name || ''),
        qty: trimToString(item?.qty || ''),
        unit: trimToString(item?.unit || 'кг') || 'кг',
        isPowder: Boolean(item?.isPowder)
      })).filter(item => item.name || item.qty);

      if (!items.length) {
        sendJson(res, 400, { error: 'Добавьте хотя бы одну строку материала.' });
        return true;
      }

      const invalid = items.find(item => {
        if (!item.name) return true;
        if (!item.qty) return true;
        if (!item.unit || !allowedUnits.has(item.unit)) return true;
        return !normalizeDecimalInputServer(item.qty);
      });
      if (invalid) {
        sendJson(res, 400, { error: 'Проверьте заполнение наименования и количества.' });
        return true;
      }

      card.materialIssues = Array.isArray(card.materialIssues) ? card.materialIssues : [];
      const issueIdx = card.materialIssues.findIndex(entry => trimToString(entry?.opId) === opId);
      const existingEntry = issueIdx >= 0 ? card.materialIssues[issueIdx] : null;
      const existingItems = Array.isArray(existingEntry?.items) ? existingEntry.items : [];
      const buildKey = (item) => (
        `${trimToString(item?.name || '').toLowerCase()}|${trimToString(item?.qty || '')}|${trimToString(item?.unit || '').toLowerCase()}|${item?.isPowder ? '1' : '0'}`
      );
      const existingKeys = new Set(existingItems.map(buildKey));
      items = items.filter(item => !existingKeys.has(buildKey(item)));
      if (!items.length) {
        sendJson(res, 400, { error: 'Добавьте хотя бы одну новую строку материала.' });
        return true;
      }

      const issueEntry = {
        opId,
        updatedAt: now,
        updatedBy: nowUser,
        items: existingItems.concat(items)
      };
      if (issueIdx >= 0) card.materialIssues[issueIdx] = issueEntry;
      else card.materialIssues.push(issueEntry);

      const issueLines = items.map(item =>
        `${item.name}; ${item.qty} ${item.unit}; тип-${item.isPowder ? 'порошок' : 'нет'}`
      ).join('\n');
      const existingLines = trimToString(card.mainMaterials || '');
      card.mainMaterials = existingLines
        ? `${existingLines}\n${issueLines}`
        : issueLines;

      if (op.status === 'IN_PROGRESS') {
        const diff = op.startedAt ? (now - op.startedAt) / 1000 : 0;
        op.elapsedSeconds = (op.elapsedSeconds || 0) + diff;
      }
      op.startedAt = null;
      op.finishedAt = now;
      op.lastPausedAt = null;
      op.actualSeconds = op.elapsedSeconds || 0;
      op.status = 'DONE';

      appendCardLog(card, {
        action: 'Выдача материала',
        object: op.opName || op.opCode || 'Операция',
        targetId: op.id,
        field: 'mainMaterials',
        oldValue: '',
        newValue: issueLines,
        userName: nowUser
      });
    } else if (action === 'material-return') {
      const rawReturns = Array.isArray(payload.returns) ? payload.returns : [];
      const materialIssues = Array.isArray(card.materialIssues) ? card.materialIssues : [];
      const opsSorted = [...(card.operations || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
      const issuesByOpId = new Map(materialIssues.map(entry => [trimToString(entry?.opId || ''), entry]));
      const orderedItems = [];
      opsSorted.forEach(opEntry => {
        if (!opEntry || !isMaterialIssueOperation(opEntry)) return;
        const entry = issuesByOpId.get(trimToString(opEntry.id));
        const items = Array.isArray(entry?.items) ? entry.items : [];
        items.forEach((item, itemIndex) => {
          orderedItems.push({
            opId: trimToString(opEntry.id),
            itemIndex,
            item
          });
        });
      });

      const updates = rawReturns.map(row => ({
        sourceIndex: Number(row?.sourceIndex),
        name: trimToString(row?.name || ''),
        qty: trimToString(row?.qty || ''),
        unit: trimToString(row?.unit || 'кг') || 'кг',
        isPowder: Boolean(row?.isPowder),
        returnQty: trimToString(row?.returnQty || ''),
        balanceQty: trimToString(row?.balanceQty || '')
      }));

      const invalid = updates.find(row => {
        if (!Number.isFinite(row.sourceIndex) || row.sourceIndex < 0) return true;
        if (!row.name || !row.qty) return true;
        if (!row.unit || !allowedUnits.has(row.unit)) return true;
        const qtyNorm = normalizeDecimalInputServer(row.qty);
        const returnNorm = row.returnQty === '' ? '0' : normalizeDecimalInputServer(row.returnQty);
        if (!qtyNorm || !returnNorm) return true;
        if (compareDecimalServer(qtyNorm, returnNorm) === null) return true;
        if (compareDecimalServer(qtyNorm, returnNorm) < 0) return true;
        return false;
      });
      if (invalid) {
        sendJson(res, 400, { error: 'Проверьте заполнение возврата.' });
        return true;
      }

      const updateLines = [];
      updates.forEach(row => {
        const entry = orderedItems[row.sourceIndex];
        if (!entry || !entry.item) return;
        const item = entry.item;
        const itemUnit = trimToString(item?.unit || '') || row.unit;
        const matches =
          trimToString(item?.name || '') === row.name &&
          trimToString(item?.qty || '') === row.qty &&
          itemUnit === row.unit &&
          Boolean(item?.isPowder) === Boolean(row.isPowder);
        if (!matches) return;
        if (!item.unit) item.unit = row.unit;
        const normalizedReturn = row.returnQty === '' ? '0' : row.returnQty;
        const normalizedBalance = row.balanceQty || subtractDecimalServer(row.qty, normalizedReturn);
        item.returnQty = normalizedReturn;
        item.balanceQty = normalizedBalance;
        updateLines.push({
          name: row.name,
          qty: row.qty,
          unit: row.unit,
          isPowder: row.isPowder,
          returnQty: normalizedReturn,
          balanceQty: normalizedBalance
        });
      });

      if (updateLines.length) {
        const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const lines = trimToString(card.mainMaterials || '').split('\n');
        const queueByBase = new Map();
        updateLines.forEach(entry => {
          const base = `${entry.name}; ${entry.qty} ${entry.unit}; тип-${entry.isPowder ? 'порошок' : 'нет'}`;
          if (!queueByBase.has(base)) queueByBase.set(base, []);
          queueByBase.get(base).push(entry);
        });
        const updated = lines.map(line => {
          const raw = (line || '').trim();
          if (!raw) return line;
          for (const [base, queue] of queueByBase.entries()) {
            if (!queue.length) continue;
            const re = new RegExp('^' + escapeRegExp(base) + '(?:;.*)?$');
            if (!re.test(raw)) continue;
            const match = queue.shift();
            return `${base}; Воз. ${match.returnQty}; Ост. ${match.balanceQty} ${match.unit}`;
          }
          return line;
        });
        card.mainMaterials = updated.join('\n');
      }

      if (op.status === 'IN_PROGRESS') {
        const diff = op.startedAt ? (now - op.startedAt) / 1000 : 0;
        op.elapsedSeconds = (op.elapsedSeconds || 0) + diff;
      }
      op.startedAt = null;
      op.finishedAt = now;
      op.lastPausedAt = null;
      op.actualSeconds = op.elapsedSeconds || 0;
      op.status = 'DONE';
      op.returnCompletedOnce = true;

      const returnLines = updateLines.map(item =>
        `${item.name}; ${item.qty} ${item.unit}; тип-${item.isPowder ? 'порошок' : 'нет'}; Воз. ${item.returnQty}; Ост. ${item.balanceQty} ${item.unit}`
      ).join('\n');

      appendCardLog(card, {
        action: 'Возврат материала',
        object: op.opName || op.opCode || 'Операция',
        targetId: op.id,
        field: 'materialReturns',
        oldValue: '',
        newValue: returnLines,
        userName: nowUser
      });
    } else if (action === 'material-issue-complete') {
      const issueEntry = Array.isArray(card.materialIssues)
        ? card.materialIssues.find(entry => trimToString(entry?.opId) === opId)
        : null;
      const issuedItems = Array.isArray(issueEntry?.items) ? issueEntry.items.filter(Boolean) : [];
      if (issuedItems.length > 0) {
        if (op.status === 'IN_PROGRESS') {
          const diff = op.startedAt ? (now - op.startedAt) / 1000 : 0;
          op.elapsedSeconds = (op.elapsedSeconds || 0) + diff;
        }
        op.startedAt = null;
        op.finishedAt = now;
        op.lastPausedAt = null;
        op.actualSeconds = op.elapsedSeconds || 0;
        op.status = 'DONE';
      } else {
        stopOperationPreservingElapsedServer(op, 'NOT_STARTED');
      }
    } else if (action === 'reset') {
      if (isMaterialIssueOperation(op) || isMaterialReturnOperation(op)) {
        stopOperationPreservingElapsedServer(op, 'NOT_STARTED');
      } else {
      if (op.status === 'IN_PROGRESS') {
        const diff = op.startedAt ? (now - op.startedAt) / 1000 : 0;
        op.elapsedSeconds = (op.elapsedSeconds || 0) + diff;
      }
      op.startedAt = null;
      op.lastPausedAt = null;
      op.finishedAt = null;
      op.status = 'NOT_STARTED';
      if (isDryingOperation(op)) op.dryingCompletedManually = false;
      }
    }

    recalcProductionStateFromFlow(card);
    refreshCardIndividualAggregateStateServer(data, card);
    if ((action === 'material-issue' || action === 'material-return' || action === 'drying-start' || action === 'drying-finish' || action === 'drying-complete') && card.flow && Number.isFinite(card.flow.version)) {
      card.flow.version = Math.max(0, card.flow.version || 0) + 1;
    }

    if (prevOpStatus !== op.status) {
      appendCardLog(card, {
        action: 'Статус операции',
        object: op.opName || op.opCode || 'Операция',
        targetId: op.id,
        field: 'status',
        oldValue: prevOpStatus,
        newValue: op.status,
        userName: nowUser
      });
    }

    const nextCardStatus = card.productionStatus || card.status || 'NOT_STARTED';
    if (prevCardStatus !== nextCardStatus) {
      appendCardLog(card, {
        action: 'Статус карты',
        object: 'Карта',
        field: 'status',
        oldValue: prevCardStatus,
        newValue: nextCardStatus,
        userName: nowUser
      });
    }

    card.flow.version = flowVersion + 1;

    const saved = await database.update(current => {
      const draft = normalizeData(current);
      const idx = (draft.cards || []).findIndex(c => c && c.id === card.id);
      if (idx >= 0) {
        draft.cards[idx] = card;
      }
      return draft;
    });
    const savedCard = findCardByKey(saved, card.id);
    broadcastCardEvent('updated', savedCard || card);
    broadcastCardsChanged(saved);
    sendJson(res, 200, { ok: true, flowVersion: card.flow.version });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/production/plan/auto') {
    const me = await ensureAuthenticated(req, res, { requireCsrf: true });
    if (!me) return true;
    try {
      const raw = await parseBody(req).catch(() => '');
      const payload = parseJsonBody(raw);
      if (!payload) {
        sendJson(res, 400, { error: 'Некорректные данные' });
        return true;
      }
      const dryRun = payload.dryRun === true;
      const userName = trimToString(me?.name || me?.username || me?.login || '');
      if (dryRun) {
        const current = await database.getData();
        const draft = normalizeData(deepClone(current || {}));
        const cardId = trimToString(payload.cardId);
        const card = findCardByKey(draft, cardId);
        if (!card) {
          sendJson(res, 400, { error: 'Маршрутная карта не найдена' });
          return true;
        }
        const preview = runProductionAutoPlanServer(draft, card, payload, { save: false, userName });
        preview.message = preview.hasSuccessfulOperations
          ? (preview.unplannedCount > 0 ? 'Автопланирование выполнено частично' : 'Все операции запланированы')
          : 'Не удалось построить автоплан';
        sendJson(res, 200, preview);
        return true;
      }

      let responseData = null;
      const saved = await database.update(current => {
        const draft = normalizeData(deepClone(current || {}));
        const cardId = trimToString(payload.cardId);
        const card = findCardByKey(draft, cardId);
        if (!card) {
          throw new Error('Маршрутная карта не найдена');
        }
        const result = runProductionAutoPlanServer(draft, card, payload, { save: true, userName });
        responseData = {
          ...result,
          cardId: trimToString(card.id),
          card: deepClone(card),
          tasksForCard: (draft.productionShiftTasks || [])
            .filter(task => trimToString(task?.cardId) === trimToString(card.id))
            .map(task => normalizeProductionShiftTask(task)),
          message: result.hasSuccessfulOperations
            ? (result.unplannedCount > 0 ? 'Автоплан сохранён частично' : 'Автоплан сохранён')
            : 'Нет операций для сохранения'
        };
        return draft;
      });
      broadcastCardsChanged(saved);
      broadcastCardMutationEvents(prev, saved);
      sendJson(res, 200, responseData || { ok: true });
    } catch (err) {
      sendJson(res, 400, { error: err?.message || 'Не удалось выполнить автопланирование' });
    }
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/production/plan/commit') {
    const me = await ensureAuthenticated(req, res, { requireCsrf: true });
    if (!me) return true;
    try {
      const startedAt = Date.now();
      const raw = await parseBody(req).catch(() => '');
      const payload = parseJsonBody(raw);
      if (!payload) {
        sendJson(res, 400, { error: 'Некорректные данные' });
        return true;
      }
      const action = trimToString(payload.action).toLowerCase();
      if (!['add', 'move', 'delete'].includes(action)) {
        sendJson(res, 400, { error: 'Неизвестное действие планирования' });
        return true;
      }

      let responseData = null;
      const saved = await database.update(current => {
        const draft = deepClone(current || {});
        if (!Array.isArray(draft.cards)) draft.cards = [];
        if (!Array.isArray(draft.productionShiftTasks)) draft.productionShiftTasks = [];
        if (!Array.isArray(draft.productionShifts)) draft.productionShifts = [];
        if (!Array.isArray(draft.productionShiftTimes)) draft.productionShiftTimes = normalizeProductionShiftTimes([]);
        if (!Array.isArray(draft.areas)) draft.areas = [];

        const userName = trimToString(me?.name || me?.username || me?.login || '');
        const cardId = trimToString(payload.cardId);
        const card = findCardByKey(draft, cardId);
        if (!card) {
          throw new Error('Маршрутная карта не найдена');
        }

        const routeOpId = trimToString(payload.routeOpId);
        const op = action === 'add'
          ? ((Array.isArray(card.operations) ? card.operations : []).find(item => (
            trimToString(item?.id) === routeOpId
          )) || null)
          : null;
        if (action === 'add' && !op) {
          throw new Error('Операция не найдена');
        }

        let affectedTask = null;
        let merged = false;
        let prevTask = null;

        if (action === 'add') {
          const date = trimToString(payload.date);
          const shift = parseInt(payload.shift, 10) || 1;
          const areaId = trimToString(payload.areaId);
          if (!canAddTaskToShiftServer(draft, date, shift)) {
            throw new Error('Добавлять операции можно только в открытую или не начатую актуальную смену');
          }
          const isSubcontract = isSubcontractAreaServer(draft, areaId);
          const blockedAreaName = getOpenShiftUnassignedAreaNameServer(draft, date, shift, areaId);
          if (blockedAreaName) {
            const error = new Error(buildProductionAreaAssignmentErrorMessageServer(blockedAreaName));
            error.blockedAreaNames = [blockedAreaName];
            throw error;
          }
          let plannedPartMinutes = roundPlanningMinutesServer(payload.plannedPartMinutes);
          let subcontractItemIds = normalizeSubcontractItemIdsServer(payload.subcontractItemIds);
          let subcontractItemKind = trimToString(payload.subcontractItemKind);
          let plannedQty = Number.isFinite(Number(payload.plannedPartQty)) ? Number(payload.plannedPartQty) : undefined;
          let totalQty = Number.isFinite(Number(payload.plannedTotalQty)) ? Number(payload.plannedTotalQty) : plannedQty;
          let minutesPerUnitSnapshot = Number.isFinite(Number(payload.minutesPerUnitSnapshot)) ? Number(payload.minutesPerUnitSnapshot) : undefined;
          let remainingQtySnapshot = Number.isFinite(Number(payload.remainingQtySnapshot)) ? Number(payload.remainingQtySnapshot) : undefined;
          if (isSubcontract) {
            const availableItems = getAvailableSubcontractItemsServer(draft, card, op);
            const availableItemIds = new Set(availableItems.map(item => trimToString(item?.id)).filter(Boolean));
            if (!subcontractItemIds.length) {
              throw new Error('Нет доступных изделий для цепочки субподрядчика');
            }
            const invalidIds = subcontractItemIds.filter(itemId => !availableItemIds.has(itemId));
            if (invalidIds.length) {
              throw new Error('Часть изделий уже запланирована или недоступна для цепочки субподрядчика');
            }
            const baseQty = getPlanningOperationBaseQtyServer(card, op);
            const baseMinutes = Number(op?.plannedMinutes);
            const minutesPerUnit = Number.isFinite(baseMinutes) && baseMinutes > 0 && baseQty > 0
              ? (baseMinutes / baseQty)
              : 0;
            plannedQty = subcontractItemIds.length;
            totalQty = plannedQty;
            minutesPerUnitSnapshot = minutesPerUnit > 0 ? minutesPerUnit : minutesPerUnitSnapshot;
            remainingQtySnapshot = totalQty;
            plannedPartMinutes = minutesPerUnit > 0
              ? roundPlanningMinutesServer(minutesPerUnit * plannedQty)
              : plannedPartMinutes;
            if (!(plannedPartMinutes > 0) || !(plannedQty > 0)) {
              throw new Error('Некорректный объём планирования для цепочки субподрядчика');
            }
          }
          if (!(plannedPartMinutes > 0)) {
            throw new Error('Некорректное время планирования');
          }
          const targetKey = `${cardId}|${trimToString(op?.id)}|${date}|${shift}|${areaId}|${trimToString(payload.subcontractChainId)}`;
          const targetMeta = getProductionShiftMutationMetaServer(draft, date, shift);
          const canMergeTarget = targetMeta.status === 'PLANNING' && !targetMeta.isFixed && !targetMeta.isPastPlanning;
          const existingByKeyCount = canMergeTarget
            ? draft.productionShiftTasks.filter(task => (
              getProductionShiftTaskMergeKeyServer(task) === targetKey
            )).length
            : 0;
          const createdAt = Number(payload.createdAt) || Date.now();
          const createdBy = trimToString(payload.createdBy || userName);
          let createdTasks = [];
          if (isSubcontract) {
            const chainBuild = buildSubcontractChainTasksServer(draft, {
              card,
              op,
              areaId,
              startDate: date,
              startShift: shift,
              totalMinutes: plannedPartMinutes,
              planningMode: trimToString(payload.planningMode).toUpperCase() === 'AUTO' ? 'AUTO' : 'MANUAL',
              autoPlanRunId: trimToString(payload.autoPlanRunId),
              createdAt,
              createdBy,
              sourceShiftDate: trimToString(payload.sourceShiftDate) || date,
              sourceShift: Number(payload.sourceShift) || shift,
              shiftCloseSourceDate: trimToString(payload.shiftCloseSourceDate),
              shiftCloseSourceShift: Number(payload.shiftCloseSourceShift) || undefined,
              fromShiftCloseTransfer: payload.fromShiftCloseTransfer === true,
              subcontractChainId: trimToString(payload.subcontractChainId),
              subcontractItemIds,
              subcontractItemKind
            });
            createdTasks = chainBuild.tasks.map((task, index, list) => {
              const segmentQty = plannedQty > 0 && plannedPartMinutes > 0
                ? roundPlanningQtyServer((getProductionShiftTaskMinutesForMergeServer(task) / plannedPartMinutes) * plannedQty)
                : undefined;
              return normalizeProductionShiftTask({
                ...task,
                plannedPartQty: segmentQty > 0 ? segmentQty : undefined,
                plannedTotalQty: totalQty > 0 ? totalQty : undefined,
                minutesPerUnitSnapshot: minutesPerUnitSnapshot > 0 ? minutesPerUnitSnapshot : undefined,
                remainingQtySnapshot: totalQty > 0 ? totalQty : undefined,
                isPartial: list.length > 1 || payload.isPartial === true
              });
            });
          } else {
            createdTasks = [normalizeProductionShiftTask({
              id: genId('pst'),
              cardId,
              routeOpId: trimToString(op?.id),
              opId: trimToString(op?.opId),
              opName: trimToString(op?.opName || op?.name),
              date,
              shift,
              areaId,
              plannedPartMinutes,
              plannedPartQty: Number.isFinite(Number(payload.plannedPartQty)) ? Number(payload.plannedPartQty) : undefined,
              plannedTotalQty: Number.isFinite(Number(payload.plannedTotalQty)) ? Number(payload.plannedTotalQty) : undefined,
              minutesPerUnitSnapshot: minutesPerUnitSnapshot > 0 ? minutesPerUnitSnapshot : undefined,
              remainingQtySnapshot,
              plannedTotalMinutes: Number.isFinite(Number(payload.plannedTotalMinutes)) ? Number(payload.plannedTotalMinutes) : undefined,
              isPartial: payload.isPartial === true,
              createdAt,
              createdBy
            })];
          }
          draft.productionShiftTasks.push(...createdTasks);
          draft.productionShiftTasks = mergeProductionShiftTasksServer(draft.productionShiftTasks, draft);
          reconcileCardPlanningTasksServer(draft, card);
          affectedTask = canMergeTarget
            ? (draft.productionShiftTasks.find(task => getProductionShiftTaskMergeKeyServer(task) === targetKey) || null)
            : (draft.productionShiftTasks
              .filter(task => (
                trimToString(task?.cardId) === cardId
                && trimToString(task?.routeOpId) === trimToString(op?.id)
                && trimToString(task?.areaId) === areaId
                && (!isSubcontract || trimToString(task?.subcontractChainId) === trimToString(createdTasks[0]?.subcontractChainId))
              ))
              .sort((a, b) => (Number(a?.createdAt) || 0) - (Number(b?.createdAt) || 0))[0] || null);
          merged = existingByKeyCount > 0;
          createdTasks.forEach(task => {
            appendShiftTaskLogServer(draft, task, 'ADD_TASK_TO_SHIFT', null, userName);
            appendPlanningTaskCardLogServer(draft, card, task, 'ADD_TASK_TO_SHIFT', null, userName);
          });
          if (isSubcontract && createdTasks[0]?.subcontractChainId) {
            appendSubcontractChainShiftLogServer(draft, createdTasks[0], 'SUBCONTRACT_CHAIN_CREATE', { userName });
            appendSubcontractChainCardLogServer(draft, card, createdTasks[0], 'SUBCONTRACT_CHAIN_CREATE', { userName });
          }
        } else if (action === 'move') {
          const taskId = trimToString(payload.taskId);
          const task = draft.productionShiftTasks.find(item => trimToString(item?.id) === taskId) || null;
          if (!task) {
            throw new Error('Плановая операция не найдена');
          }
          if (isSubcontractAreaServer(draft, task.areaId)) {
            throw new Error('Операции на участке "Субподрядчик" нельзя переносить вручную');
          }
          if (!canMoveExistingShiftTaskServer(draft, task)) {
            throw new Error('Переносить можно только операции из не начатой смены');
          }
          const moveOp = (Array.isArray(card.operations) ? card.operations : []).find(item => (
            trimToString(item?.id) === trimToString(task.routeOpId)
          )) || null;
          if (moveOp) {
            const moveStatus = trimToString(moveOp.status).toUpperCase();
            if (moveStatus === 'IN_PROGRESS' || moveStatus === 'PAUSED') {
              throw new Error('Нельзя переносить операцию со статусом "В работе" или "Пауза"');
            }
          }
          prevTask = { ...task };
          const targetDate = trimToString(payload.date);
          const targetShift = parseInt(payload.shift, 10) || 1;
          const targetAreaId = trimToString(payload.areaId);
          const targetMeta = getProductionShiftMutationMetaServer(draft, targetDate, targetShift);
          if (!canMoveTaskToShiftServer(draft, targetDate, targetShift)) {
            if (targetMeta.isFixed) {
              throw new Error('Смена зафиксирована и не может быть изменена');
            }
            if (targetMeta.status === 'CLOSED') {
              throw new Error('В завершённую смену перенос запрещён');
            }
            throw new Error('Перенос возможен только в смену "Не начата" или "В работе"');
          }
          const targetKey = `${trimToString(task.cardId)}|${trimToString(task.routeOpId)}|${targetDate}|${targetShift}|${targetAreaId}`;
          const canMergeTarget = targetMeta.status === 'PLANNING' && !targetMeta.isFixed && !targetMeta.isPastPlanning;
          const existingTarget = canMergeTarget
            ? (draft.productionShiftTasks.find(item => (
                trimToString(item?.id) !== taskId &&
                getProductionShiftTaskMergeKeyServer(item) === targetKey
              )) || null)
            : null;
          task.date = targetDate;
          task.shift = targetShift;
          task.areaId = targetAreaId;
          draft.productionShiftTasks = mergeProductionShiftTasksServer(draft.productionShiftTasks, draft);
          reconcileCardPlanningTasksServer(draft, card);
          affectedTask = canMergeTarget
            ? (draft.productionShiftTasks.find(item => getProductionShiftTaskMergeKeyServer(item) === targetKey) || null)
            : (draft.productionShiftTasks.find(item => trimToString(item?.id) === taskId) || null);
          merged = Boolean(existingTarget);
          appendShiftTaskLogServer(draft, affectedTask, 'MOVE_TASK_TO_SHIFT', prevTask, userName);
          appendPlanningTaskCardLogServer(draft, card, affectedTask, 'MOVE_TASK_TO_SHIFT', prevTask, userName);
        } else {
          const taskId = trimToString(payload.taskId);
          const task = draft.productionShiftTasks.find(item => trimToString(item?.id) === taskId) || null;
          if (!task) {
            throw new Error('Плановая операция не найдена');
          }
          if (!canRemoveExistingShiftTaskServer(draft, task)) {
            throw new Error('Удалять можно только операции из не начатой смены');
          }
          const deleteOp = (Array.isArray(card.operations) ? card.operations : []).find(item => (
            trimToString(item?.id) === trimToString(task.routeOpId)
          )) || null;
          if (deleteOp) {
            const deleteStatus = trimToString(deleteOp.status).toUpperCase();
            if (deleteStatus === 'IN_PROGRESS' || deleteStatus === 'PAUSED') {
              throw new Error('Нельзя удалить операцию со статусом "В работе" или "Пауза"');
            }
          }
          prevTask = normalizeProductionShiftTask(task);
          if (isSubcontractAreaServer(draft, task.areaId)) {
            const chainId = trimToString(task?.subcontractChainId);
            const chainTasks = (draft.productionShiftTasks || []).filter(item => (
              trimToString(item?.cardId) === trimToString(task?.cardId)
              && trimToString(item?.routeOpId) === trimToString(task?.routeOpId)
              && trimToString(item?.areaId) === trimToString(task?.areaId)
              && trimToString(item?.subcontractChainId) === chainId
            ));
            const sortedChain = chainTasks.slice().sort(compareProductionShiftSlotServer);
            const firstId = trimToString(sortedChain[0]?.id);
            const lastId = trimToString(sortedChain[sortedChain.length - 1]?.id);
            if (taskId !== firstId && taskId !== lastId) {
              throw new Error('Удаление цепочки субподрядчика доступно только из первой или последней смены');
            }
            draft.productionShiftTasks = draft.productionShiftTasks.filter(item => trimToString(item?.subcontractChainId) !== chainId);
            appendSubcontractChainShiftLogServer(draft, task, 'SUBCONTRACT_CHAIN_DELETE', { userName });
            appendSubcontractChainCardLogServer(draft, card, task, 'SUBCONTRACT_CHAIN_DELETE', { userName });
          } else {
            draft.productionShiftTasks = draft.productionShiftTasks.filter(item => trimToString(item?.id) !== taskId);
          }
          reconcileCardPlanningTasksServer(draft, card);
          affectedTask = prevTask;
          merged = false;
          appendShiftTaskLogServer(draft, prevTask, 'REMOVE_TASK_FROM_SHIFT', null, userName);
          appendPlanningTaskCardLogServer(draft, card, prevTask, 'REMOVE_TASK_FROM_SHIFT', null, userName);
        }

        responseData = {
          ok: true,
          cardId: trimToString(card.id),
          card: deepClone(card),
          tasksForCard: draft.productionShiftTasks
            .filter(task => trimToString(task?.cardId) === trimToString(card.id))
            .map(task => normalizeProductionShiftTask(task)),
          merged
        };
        return draft;
      });

      console.info(`[PERF][PLAN] server.commit: ${Date.now() - startedAt}ms action=${action} card=${responseData?.cardId || ''}`);
      broadcastCardsChanged(saved);
      sendJson(res, 200, responseData || { ok: true });
    } catch (err) {
      sendJson(res, 400, {
        error: err?.message || 'Не удалось сохранить планирование',
        blockedAreaNames: Array.isArray(err?.blockedAreaNames) ? err.blockedAreaNames : []
      });
    }
    return true;
  }

  if (!isLegacySnapshotDataPath(pathname)) return false;

  const authedUser = await ensureAuthenticated(req, res);
  if (!authedUser) return true;

  if (req.method === 'GET' && isLegacySnapshotDataPath(pathname)) {
    const requestedScope = normalizeDataScope(parsed.query?.scope || DATA_SCOPE_FULL);
    let data = await database.getData();
    const flowResult = ensureFlowForCards(Array.isArray(data.cards) ? data.cards : []);
    let stateChanged = false;
    flowResult.cards.forEach(card => {
      if (recalcProductionStateFromFlow(card)) stateChanged = true;
    });
    if (flowResult.changed || stateChanged) {
      await database.update(current => ({ ...current, cards: flowResult.cards }));
      data = await database.getData();
    }
    const safe = buildScopedDataPayload(data, requestedScope);
    sendJson(res, 200, safe);
    return true;
  }

  if (req.method === 'POST' && isLegacySnapshotDataPath(pathname)) {
    try {
      logLegacySnapshotWriteBoundary(req, {
        mode: 'legacy-snapshot-save',
        note: 'Compatibility path for unmigrated snapshot domains only.'
      });
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
      broadcastCardMutationEvents(prev, saved);
      broadcastOperationMutationEvents(prev, saved);
      broadcastAreaMutationEvents(prev, saved);
      broadcastDepartmentMutationEvents(prev, saved);
      broadcastShiftTimeMutationEvents(prev, saved);
      broadcastUserMutationEvents(prev, saved);
      broadcastAccessLevelMutationEvents(prev, saved);
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
      const savedCard = findCardByKey(saved, card.id);
      if (savedCard) {
        broadcastCardEvent('updated', savedCard, { reason: 'card-files-disk-resync' });
        broadcastCardEvent('files-updated', savedCard, {
          reason: 'card-files-disk-resync',
          filesCount: Array.isArray(savedCard.attachments) ? savedCard.attachments.length : 0,
          inputControlFileId: trimToString(savedCard.inputControlFileId)
        });
      }
    }
    sendJson(res, 200, { files: sync.files, inputControlFileId: sync.inputControlFileId, changed: sync.changed });
    return true;
  }

  if (req.method === 'POST' && segments[0] === 'api' && segments[1] === 'cards' && segments[3] === 'files' && segments.length === 4) {
    const cardId = segments[2];
    try {
      const raw = await parseBody(req);
      const payload = JSON.parse(raw || '{}');
      const { name, type, content, size, category, scope, scopeId, operationLabel, itemsLabel, opId, opCode, opName } = payload || {};
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
      const normalizedCategory = String(category || 'GENERAL').toUpperCase();
      const normalizedName = String(safeName || '').trim().toLowerCase();
      if (normalizedCategory === 'PARTS_DOCS') {
        const existing = (card.attachments || []).some(file => (
          String(file?.category || '').toUpperCase() === 'PARTS_DOCS'
          && String(file?.name || '').trim().toLowerCase() === normalizedName
        ));
        if (existing) {
          sendJson(res, 409, { error: 'Файл с таким именем уже загружен.' });
          return true;
        }
      }

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
        category: normalizedCategory,
        scope: String(scope || 'CARD').toUpperCase(),
        scopeId: scopeId || null,
        operationLabel: trimToString(operationLabel || ''),
        itemsLabel: trimToString(itemsLabel || ''),
        opId: trimToString(opId || ''),
        opCode: trimToString(opCode || ''),
        opName: trimToString(opName || '')
      };
      card.attachments = Array.isArray(card.attachments) ? card.attachments : [];
      if (fileMeta.category === 'INPUT_CONTROL') {
        card.inputControlFileId = fileMeta.id;
      }
      card.attachments.push(fileMeta);
      const prev = await database.getData();
      const saved = await database.update(d => {
        const cards = d.cards || [];
        const idx = cards.findIndex(c => c.id === card.id);
        if (idx >= 0) cards[idx] = card;
        d.cards = cards;
        return d;
      });
      broadcastCardsChanged(saved);
      const savedCard = findCardByKey(saved, card.id);
      if (savedCard) {
        broadcastCardEvent('updated', savedCard, { reason: 'card-files-resync' });
        broadcastCardEvent('files-updated', savedCard, {
          reason: 'card-files-resync',
          filesCount: Array.isArray(savedCard.attachments) ? savedCard.attachments.length : 0,
          inputControlFileId: trimToString(savedCard.inputControlFileId)
        });
      } else {
        broadcastCardMutationEvents(prev, saved);
      }
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
      const prev = await database.getData();
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
      if (card) {
        broadcastCardEvent('updated', card, { reason: 'card-file-delete' });
        broadcastCardEvent('files-updated', card, {
          reason: 'card-file-delete',
          filesCount: Array.isArray(card.attachments) ? card.attachments.length : 0,
          inputControlFileId: trimToString(card.inputControlFileId)
        });
      } else {
        broadcastCardMutationEvents(prev, saved);
      }
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
  if (normalizedPath === '/version-log' || normalizedPath === '/docs/version-log.html') {
    await serveVersionLogPage(req, res, { normalizedPath });
    return;
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
    normalizedPath.startsWith('/card-route/') ||
    normalizedPath.startsWith('/workorders/') ||
    normalizedPath.startsWith('/workspace/') ||
    normalizedPath.startsWith('/archive/') ||
    normalizedPath.startsWith('/production/shifts/') ||
    normalizedPath.startsWith('/production/gantt/') ||
    normalizedPath.startsWith('/production/defects/') ||
    normalizedPath.startsWith('/production/delayed/') ||
    normalizedPath.startsWith('/cards/') ||
    normalizedPath === '/profile' ||
    normalizedPath.startsWith('/profile/')
  ) {
    serveIndexHtml(res);
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
