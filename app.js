// === КОНСТАНТЫ И ГЛОБАЛЬНЫЕ МАССИВЫ ===
const API_ENDPOINT = '/api/data';

let cards = [];
let ops = [];
let centers = [];
let accessLevels = [];
let users = [];
let userPasswordCache = {};
let workorderSearchTerm = '';
let workorderStatusFilter = 'ALL';
let workorderMissingExecutorFilter = 'ALL';
let workorderAutoScrollEnabled = true;
let suppressWorkorderAutoscroll = false;
const MOBILE_OPERATIONS_BREAKPOINT = 768;
let activeMobileCardId = null;
let activeMobileGroupId = null;
let mobileWorkorderScroll = 0;
let mobileOpsScrollTop = 0;
let mobileOpsObserver = null;
let archiveSearchTerm = '';
let archiveStatusFilter = 'ALL';
let apiOnline = false;
const workorderOpenCards = new Set();
const workorderOpenGroups = new Set();
let activeCardDraft = null;
let activeCardOriginalId = null;
let activeCardIsNew = false;
let activeMkiDraft = null;
let activeMkiId = null;
let mkiIsNew = false;
let cardsSearchTerm = '';
let attachmentContext = null;
let routeQtyManual = false;
let imdxImportState = { parsed: null, missing: null };
const IMDX_ALLOWED_CENTERS = ['ТО', 'ПО', 'СКК', 'Склад', 'УГН', 'УТО', 'ИЛ'];
const DEBUG_IMDX = false;
const ATTACH_ACCEPT = '.pdf,.doc,.docx,.jpg,.jpeg,.png,.zip,.rar,.7z';
const ATTACH_MAX_SIZE = 15 * 1024 * 1024; // 15 MB
let logContextCardId = null;
let clockIntervalId = null;
const cardsGroupOpen = new Set();
let groupExecutorContext = null;
let dashboardStatusSnapshot = null;
let dashboardEligibleCache = [];
let workspaceSearchTerm = '';
let scannerRegistry = {};
let appState = { tab: 'dashboard', modal: null };
let restoringState = false;
let workspaceStopContext = null;
let workspaceActiveModalInput = null;
let cardActiveSectionKey = 'main';
let deleteContext = null;
const ACCESS_TAB_CONFIG = [
  { key: 'dashboard', label: 'Дашборд' },
  { key: 'cards', label: 'МК' },
  { key: 'workorders', label: 'Трекер' },
  { key: 'archive', label: 'Архив' },
  { key: 'workspace', label: 'Рабочее место' },
  { key: 'users', label: 'Пользователи' },
  { key: 'accessLevels', label: 'Уровни доступа' }
];
const USER_DATALIST_ID = 'user-combobox-options';
const FORBIDDEN_EXECUTOR = 'abyss';
const USER_PASSWORD_CACHE_KEY = 'userPasswordCache';
let currentUser = null;
let appBootstrapped = false;
let timersStarted = false;
let inactivityTimer = null;

function isActiveWorker(user) {
  if (!user || typeof user !== 'object') return false;
  const normalizedStatus = (user.status || 'active').toLowerCase();
  if (normalizedStatus === 'deleted' || normalizedStatus === 'disabled' || normalizedStatus === 'inactive') return false;
  return !!(user.permissions && user.permissions.worker);
}

function getEligibleExecutorUsers() {
  return (users || []).filter(u => {
    const name = (u && u.name ? u.name : '').trim();
    if (!name) return false;
    if (name.toLowerCase() === FORBIDDEN_EXECUTOR) return false;
    return isActiveWorker(u);
  });
}

function getEligibleExecutorNames() {
  return getEligibleExecutorUsers().map(u => u.name || '').filter(Boolean);
}

function isEligibleExecutorName(name) {
  const normalized = (name || '').trim().toLowerCase();
  if (!normalized || normalized === FORBIDDEN_EXECUTOR) return false;
  return getEligibleExecutorNames().some(n => (n || '').trim().toLowerCase() === normalized);
}

function sanitizeExecutorName(name = '') {
  if ((name || '').toLowerCase() === FORBIDDEN_EXECUTOR) return '';
  return name;
}

function formatDateInputValue(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getCurrentDateString() {
  return formatDateInputValue(Date.now());
}

function getSurnameFromUser(user) {
  const name = (user && user.name ? user.name : '').trim();
  if (!name) return '';
  const parts = name.split(/\s+/);
  return parts[0] || '';
}

function loadUserPasswordCache() {
  try {
    const stored = localStorage.getItem(USER_PASSWORD_CACHE_KEY);
    userPasswordCache = stored ? JSON.parse(stored) || {} : {};
  } catch (err) {
    console.warn('Не удалось загрузить кэш паролей', err);
    userPasswordCache = {};
  }
}

function persistUserPasswordCache() {
  try {
    localStorage.setItem(USER_PASSWORD_CACHE_KEY, JSON.stringify(userPasswordCache));
  } catch (err) {
    console.warn('Не удалось сохранить кэш паролей', err);
  }
}

function rememberUserPassword(userId, password) {
  if (!userId || !password) return;
  userPasswordCache[userId] = password;
  persistUserPasswordCache();
}

function forgetMissingUserPasswords(activeUsers = []) {
  const activeIds = new Set((activeUsers || []).map(u => u.id));
  let changed = false;
  Object.keys(userPasswordCache).forEach(id => {
    if (!activeIds.has(id)) {
      delete userPasswordCache[id];
      changed = true;
    }
  });
  if (changed) persistUserPasswordCache();
}

function resolveUserPassword(user) {
  if (!user) return '';
  if (user.password) return user.password;
  const cached = userPasswordCache[user.id];
  return cached || '';
}

function setConnectionStatus(message, variant = 'info') {
  const banner = document.getElementById('server-status');
  if (!banner) return;

  if (!message) {
    banner.classList.add('hidden');
    return;
  }

  banner.textContent = message;
  banner.className = `status-banner status-${variant}`;
}

function updateUserBadge() {
  const badge = document.getElementById('user-badge');
  if (!badge) return;
  if (currentUser) {
    badge.textContent = currentUser.name || 'Пользователь';
    badge.classList.remove('hidden');
  } else {
    badge.textContent = 'Не авторизовано';
    badge.classList.remove('hidden');
  }
}

function showAuthOverlay(message = '') {
  const overlay = document.getElementById('login-overlay');
  const errorEl = document.getElementById('login-error');
  const input = document.getElementById('login-password');
  if (!overlay) return;
  if (errorEl) {
    errorEl.textContent = message || '';
    errorEl.style.display = message ? 'block' : 'none';
  }
  overlay.classList.remove('hidden');
  if (input) {
    input.value = '';
    setTimeout(() => input.focus(), 50);
  }
}

function hideAuthOverlay() {
  const overlay = document.getElementById('login-overlay');
  const errorEl = document.getElementById('login-error');
  if (overlay) overlay.classList.add('hidden');
  if (errorEl) {
    errorEl.textContent = '';
    errorEl.style.display = 'none';
  }
}

function showMainApp() {
  const app = document.getElementById('app-root');
  if (app) app.classList.remove('hidden');
}

function hideMainApp() {
  const app = document.getElementById('app-root');
  if (app) app.classList.add('hidden');
}

function togglePrimaryNav() {
  const toggle = document.getElementById('nav-toggle');
  const nav = document.getElementById('primary-nav');
  if (!toggle || !nav) return;

  const isOpen = nav.classList.toggle('open');
  toggle.setAttribute('aria-expanded', String(isOpen));
}

function closePrimaryNav() {
  const toggle = document.getElementById('nav-toggle');
  const nav = document.getElementById('primary-nav');
  if (!toggle || !nav) return;

  nav.classList.remove('open');
  toggle.setAttribute('aria-expanded', 'false');
}

function setupResponsiveNav() {
  const toggle = document.getElementById('nav-toggle');
  const nav = document.getElementById('primary-nav');
  if (!toggle || !nav) return;

  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
      closePrimaryNav();
    }
  });
}

function handleUnauthorized(message = 'Требуется вход') {
  currentUser = null;
  updateUserBadge();
  hideMainApp();
  showAuthOverlay(message);
}

function resetInactivityTimer() {
  if (!currentUser || !currentUser.permissions) return;
  if (inactivityTimer) clearTimeout(inactivityTimer);
  const minutes = currentUser.permissions.inactivityTimeoutMinutes || 30;
  inactivityTimer = setTimeout(() => {
    performLogout(true);
  }, Math.max(1, minutes) * 60 * 1000);
}

['click', 'mousemove', 'keydown', 'touchstart'].forEach(evt => {
  document.addEventListener(evt, () => resetInactivityTimer());
});

function startRealtimeClock() {
  const el = document.getElementById('realtime-clock');
  if (!el) return;
  const update = () => {
    const now = new Date();
    const date = now.toLocaleDateString('ru-RU');
    const time = now.toLocaleTimeString('ru-RU');
    el.textContent = `${date} ${time}`;
  };
  update();
  if (clockIntervalId) clearInterval(clockIntervalId);
  clockIntervalId = setInterval(update, 1000);
}

function getAllowedTabs() {
  const tabs = [];
  document.querySelectorAll('.nav-btn').forEach(btn => {
    const target = btn.getAttribute('data-target');
    if (!target) return;
    if (canViewTab(target)) {
      tabs.push(target);
    }
  });
  return tabs.length ? tabs : ['dashboard'];
}

function getDefaultTab() {
  const allowed = getAllowedTabs();
  const landing = currentUser?.permissions?.landingTab || 'dashboard';
  const forced = currentUser && currentUser.name === 'Abyss' ? 'dashboard' : landing;
  return allowed.includes(forced) ? forced : allowed[0];
}

function updateHistoryState({ replace = false } = {}) {
  if (restoringState) return;
  const method = replace ? 'replaceState' : 'pushState';
  try {
    const url = appState.route || ('#' + (appState.tab || ''));
    history[method](appState, '', url);
  } catch (err) {
    console.warn('History update failed', err);
  }
}

function setModalState(modal, { replace = false, fromRestore = false } = {}) {
  const nextModal = modal ? { ...modal } : null;
  const sameModal = (!appState.modal && !nextModal) ||
    (appState.modal && nextModal &&
      appState.modal.type === nextModal.type &&
      appState.modal.cardId === nextModal.cardId &&
      appState.modal.inputId === nextModal.inputId &&
      appState.modal.mode === nextModal.mode);
  appState = { ...appState, modal: nextModal };
  if (sameModal) return;
  if (!fromRestore) {
    updateHistoryState({ replace });
  }
}

function setTabState(tab, { replaceHistory = false, fromRestore = false } = {}) {
  if (appState.tab === tab) {
    appState = { ...appState, tab };
    if (!fromRestore && replaceHistory) {
      updateHistoryState({ replace: replaceHistory });
    }
    return;
  }
  appState = { ...appState, tab };
  if (!fromRestore) {
    updateHistoryState({ replace: replaceHistory });
  }
}

function closeAllModals(silent = false) {
  closeBarcodeModal(true);
  closeLogModal(true);
  closeCardModal(true);
  closeDirectoryModal?.(true);
  Object.values(scannerRegistry || {}).forEach(scanner => {
    if (scanner && typeof scanner.closeScanner === 'function') {
      scanner.closeScanner();
    }
  });
  if (!silent) {
    setModalState(null, { replace: true });
  } else {
    appState = { ...appState, modal: null };
  }
}

function closePageScreens() {
  closeCardModal(true);
  closeDirectoryModal(true);
  document.body.classList.remove('page-card-mode');
  document.body.classList.remove('page-directory-mode');
}

function handleRoute(path, { replace = false, fromHistory = false } = {}) {
  let urlObj;
  try {
    urlObj = new URL(path || '/', window.location.origin);
  } catch (err) {
    urlObj = new URL('/', window.location.origin);
  }

  const basePath = urlObj.pathname || '/';
  const search = urlObj.search || '';
  const normalized = (basePath || '/') + search;
  const tabRoutes = {
    '/dashboard': 'dashboard',
    '/workorders': 'workorders',
    '/archive': 'archive',
    '/workspace': 'workspace',
    '/users': 'users',
    '/accessLevels': 'accessLevels'
  };

  const pushState = () => {
    appState = { ...appState, route: normalized };
    if (fromHistory) return;
    const method = replace ? 'replaceState' : 'pushState';
    try {
      history[method](appState, '', normalized);
    } catch (err) {
      console.warn('History update failed', err);
    }
  };

  if (basePath === '/cards/new' || basePath === '/cards-mki/new') {
    const cardIdParam = urlObj.searchParams.get('cardId');
    const card = cardIdParam ? cards.find(c => c.id === cardIdParam) : null;
    const defaultType = basePath === '/cards-mki/new' ? 'MKI' : 'MK';
    const normalizedType = card && card.cardType === 'MKI' ? 'MKI' : defaultType;
    closePageScreens();
    activateTab('cards', { skipHistory: true, fromRestore: fromHistory });
    openCardModal(card ? card.id : null, { cardType: normalizedType, pageMode: true, fromRestore: fromHistory });
    pushState();
    return;
  }

  if (basePath === '/directories') {
    closePageScreens();
    activateTab('cards', { skipHistory: true, fromRestore: fromHistory });
    openDirectoryModal({ pageMode: true });
    pushState();
    return;
  }

  if (basePath === '/cards') {
    closePageScreens();
    activateTab('cards', { skipHistory: true, fromRestore: fromHistory });
    pushState();
    return;
  }

  if (tabRoutes[basePath]) {
    closePageScreens();
    activateTab(tabRoutes[basePath], { skipHistory: true, fromRestore: fromHistory });
    pushState();
    return;
  }

  const fallbackTab = getDefaultTab();
  closePageScreens();
  activateTab(fallbackTab, { skipHistory: true, fromRestore: fromHistory });
  pushState();
}

function navigateToRoute(path) {
  handleRoute(path, { replace: false, fromHistory: false });
}

// === УТИЛИТЫ ===
function genId(prefix) {
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
}

function generateRawOpCode() {
  return 'OP-' + Math.random().toString(36).substring(2, 6).toUpperCase();
}

function generateUniqueOpCode(used = new Set()) {
  let code = generateRawOpCode();
  let attempt = 0;
  const taken = new Set(used);
  while ((taken.has(code) || !code) && attempt < 1000) {
    code = generateRawOpCode();
    attempt++;
  }
  return code;
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function wrapTable(tableHtml) {
  return '<div class="table-wrapper">' + tableHtml + '</div>';
}

function formatSecondsToHMS(sec) {
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const hh = h.toString().padStart(2, '0');
  const mm = m.toString().padStart(2, '0');
  const ss = s.toString().padStart(2, '0');
  return hh + ':' + mm + ':' + ss;
}

function formatDateTime(ts) {
  if (!ts) return '-';
  try {
    return new Date(ts).toLocaleString();
  } catch (e) {
    return '-';
  }
}

function formatStartEnd(op) {
  const start = op.firstStartedAt || op.startedAt;
  let endLabel = '-';
  if (op.status === 'PAUSED') {
    const pauseTs = op.lastPausedAt || Date.now();
    endLabel = formatDateTime(pauseTs) + ' (П)';
  } else if (op.finishedAt) {
    endLabel = formatDateTime(op.finishedAt);
  } else if (op.status === 'DONE' && op.finishedAt) {
    endLabel = formatDateTime(op.finishedAt);
  } else if (op.status === 'IN_PROGRESS') {
    endLabel = '-';
  }

  return '<div class="nk-lines"><div>Н: ' + escapeHtml(formatDateTime(start)) + '</div><div>К: ' + escapeHtml(endLabel) + '</div></div>';
}

function generatePassword(len = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789';
  let pwd = '';
  while (pwd.length < len) {
    const idx = Math.floor(Math.random() * chars.length);
    pwd += chars[idx];
  }
  return pwd;
}

// Время операции с учётом пауз / продолжений
function getOperationElapsedSeconds(op) {
  const base = typeof op.elapsedSeconds === 'number' ? op.elapsedSeconds : 0;
  if (op.status === 'IN_PROGRESS' && op.startedAt) {
    return base + (Date.now() - op.startedAt) / 1000;
  }
  return base;
}

function autoResizeComment(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function getUserPermissions() {
  if (!currentUser || !currentUser.permissions) return null;
  return currentUser.permissions;
}

function canViewTab(tabKey) {
  const perms = getUserPermissions();
  if (!perms) return true;
  const tab = perms.tabs && perms.tabs[tabKey];
  return tab ? !!tab.view : true;
}

function canEditTab(tabKey) {
  const perms = getUserPermissions();
  if (!perms) return true;
  const tab = perms.tabs && perms.tabs[tabKey];
  return tab ? !!tab.edit : false;
}

function isTabReadonly(tabKey) {
  return canViewTab(tabKey) && !canEditTab(tabKey);
}

function applyReadonlyState(tabKey, sectionId) {
  const section = document.getElementById(sectionId);
  if (!section) return;
  const readonly = isTabReadonly(tabKey);
  section.classList.toggle('tab-readonly', readonly);

  const controls = section.querySelectorAll('input, select, textarea, button');
  controls.forEach(ctrl => {
    const allowView = ctrl.dataset.allowView === 'true';
    if (readonly && !allowView) {
      ctrl.disabled = true;
      ctrl.classList.add('view-disabled');
    } else {
      ctrl.disabled = false;
      ctrl.classList.remove('view-disabled');
    }
  });
}

function cloneCard(card) {
  return JSON.parse(JSON.stringify(card));
}

function isGroupCard(card) {
  return Boolean(card && card.isGroup);
}

function getCardBarcodeValue(card) {
  if (!card) return '';
  if (isGroupCard(card)) return String(card.barcode || '').trim();
  const rc = (card.routeCardNumber || '').trim();
  if (rc) return rc;
  return String(card.barcode || '').trim();
}

function getGroupChildren(group) {
  if (!group) return [];
  return cards.filter(c => c.groupId === group.id);
}

function getActiveGroupChildren(group) {
  return getGroupChildren(group).filter(c => !c.archived);
}

function toSafeCount(val) {
  const num = parseInt(val, 10);
  if (!Number.isFinite(num) || num < 0) return 0;
  return num;
}

function clampToSafeCount(val, max) {
  const safe = toSafeCount(val);
  if (!Number.isFinite(max) || max < 0) return safe;
  return Math.min(safe, max);
}

function normalizeSerialInput(value) {
  if (Array.isArray(value)) return value.map(v => (v == null ? '' : String(v).trim()));
  if (typeof value === 'string') {
    return value.split(/\r?\n|,/).map(v => v.trim());
  }
  return [];
}

function resizeSerialList(list, targetLength, { fillDefaults = false } = {}) {
  const safeList = Array.isArray(list) ? list : [];
  const length = Math.max(0, targetLength || 0);
  const result = [];
  for (let i = 0; i < length; i++) {
    if (i < safeList.length) {
      const val = safeList[i];
      result.push(val == null ? '' : String(val));
    } else if (fillDefaults) {
      result.push('Без номера ' + (i + 1));
    } else {
      result.push('');
    }
  }
  return result;
}

function hasEmptySerial(values = []) {
  return (values || []).some(v => !String(v || '').trim());
}

function looksLikeLegacyBarcode(code) {
  return /^\d{13}$/.test((code || '').trim());
}

function generateCardCode128() {
  return `MK-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function collectBarcodeSet(excludeId = null) {
  const set = new Set();
  (cards || []).forEach(card => {
    if (!card || card.id === excludeId) return;
    const value = (card.barcode || '').trim();
    if (value) set.add(value);
  });
  return set;
}

function generateUniqueCardCode128(used = collectBarcodeSet()) {
  let attempt = 0;
  while (attempt < 1000) {
    const code = generateCardCode128();
    const exists = (cards || []).some(c => (c?.barcode || '').trim() === code) || used.has(code);
    if (!exists) {
      used.add(code);
      return code;
    }
    attempt += 1;
  }
  const fallback = `${generateCardCode128()}-${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
  used.add(fallback);
  return fallback;
}

function ensureUniqueBarcodes(list = cards) {
  const used = new Set();
  (list || []).forEach(card => {
    if (!card) return;
    let value = (card.barcode || '').trim();
    const legacy = looksLikeLegacyBarcode(value);
    if (!value || legacy || used.has(value)) {
      value = generateUniqueCardCode128(used);
    }
    card.barcode = value;
    used.add(value);
  });
}

function formatCardNameWithGroupPosition(card, { includeArchivedSiblings = false } = {}) {
  if (!card) return '';

  const baseName = formatCardTitle(card) || card.id || '';
  if (!card.groupId) return escapeHtml(baseName);

  const siblings = cards.filter(c => c.groupId === card.groupId && (includeArchivedSiblings || !c.archived));
  let displayName = baseName;
  let position = null;

  const nameMatch = /^\s*(\d+)\.\s*(.*)$/.exec(displayName || '');
  if (nameMatch) {
    position = toSafeCount(nameMatch[1]);
    displayName = nameMatch[2] || '';
  }

  if (!position && siblings.length) {
    const idx = siblings.findIndex(c => c.id === card.id);
    position = idx >= 0 ? idx + 1 : null;
  }

  const total = siblings.length || null;
  const prefix = position && total ? '<span class="group-position">' + position + '/' + total + '</span> ' : '';

  return prefix + escapeHtml(displayName.trim());
}

function getCardPlannedQuantity(card) {
  if (!card) return { qty: null, hasValue: false };
  const rawQty = card.quantity !== '' && card.quantity != null
    ? card.quantity
    : (card.initialSnapshot && card.initialSnapshot.quantity);

  if (rawQty !== '' && rawQty != null) {
    return { qty: toSafeCount(rawQty), hasValue: true };
  }

  const snapshotItems = Array.isArray(card.initialSnapshot && card.initialSnapshot.items)
    ? card.initialSnapshot.items.length
    : null;
  if (snapshotItems) {
    return { qty: snapshotItems, hasValue: true };
  }

  const itemsCount = Array.isArray(card.items) ? card.items.length : null;
  if (itemsCount) {
    return { qty: itemsCount, hasValue: true };
  }

  return { qty: null, hasValue: false };
}

function formatStepCode(step) {
  return String(step * 5).padStart(3, '0');
}

function computeMkiOperationQuantity(op, card) {
  if (!card || card.cardType !== 'MKI') return null;
  const source = op && op.isSamples ? card.sampleCount : card.quantity;
  if (source === '' || source == null) return '';
  const qty = toSafeCount(source);
  return Number.isFinite(qty) ? qty : '';
}

function getOperationQuantity(op, card) {
  if (card && card.cardType === 'MKI') {
    const computed = computeMkiOperationQuantity(op, card);
    return computed === null ? '' : computed;
  }
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

function recalcMkiOperationQuantities(card) {
  if (!card || card.cardType !== 'MKI' || !Array.isArray(card.operations)) return;
  card.operations.forEach(op => {
    op.quantity = computeMkiOperationQuantity(op, card);
    if (card.useItemList) {
      normalizeOperationItems(card, op);
    }
  });
  if (card.useItemList) {
    syncItemListFromFirstOperation(card);
  }
}

function sumItemCounts(items = []) {
  return items.reduce((acc, item) => {
    acc.good += toSafeCount(item && item.goodCount != null ? item.goodCount : 0);
    acc.scrap += toSafeCount(item && item.scrapCount != null ? item.scrapCount : 0);
    acc.hold += toSafeCount(item && item.holdCount != null ? item.holdCount : 0);
    return acc;
  }, { good: 0, scrap: 0, hold: 0 });
}

function calculateFinalResults(operations = [], initialQty = 0) {
  const total = toSafeCount(initialQty);
  const opsSorted = Array.isArray(operations)
    ? operations.filter(Boolean).slice().sort((a, b) => (a.order || 0) - (b.order || 0))
    : [];

  const lastOp = opsSorted[opsSorted.length - 1];
  const goodFinal = toSafeCount(lastOp && lastOp.goodCount != null ? lastOp.goodCount : 0);
  const scrapFinal = toSafeCount(lastOp && lastOp.scrapCount != null ? lastOp.scrapCount : 0);
  const delayedFinal = toSafeCount(lastOp && lastOp.holdCount != null ? lastOp.holdCount : 0);

  return {
    good_final: goodFinal,
    scrap_final: scrapFinal,
    delayed_final: delayedFinal,
    summary_ok: total === 0 || goodFinal + scrapFinal + delayedFinal === total
  };
}

function buildItemsFromTemplate(template = [], qty = 0) {
  const items = [];
  const targetQty = Number.isFinite(qty) ? qty : 0;
  for (let i = 0; i < targetQty; i++) {
    const source = template[i] || {};
    items.push({
      id: source.id || genId('item'),
      name: typeof source.name === 'string' ? source.name : '',
      quantity: 1,
      goodCount: 0,
      scrapCount: 0,
      holdCount: 0
    });
  }
  return items;
}

function getFirstOperation(card) {
  if (!card || !Array.isArray(card.operations) || !card.operations.length) return null;
  return [...card.operations].sort((a, b) => (a.order || 0) - (b.order || 0))[0];
}

function syncItemListFromFirstOperation(card) {
  if (!card || !card.useItemList) return;
  const firstOp = getFirstOperation(card);
  if (!firstOp) return;
  normalizeOperationItems(card, firstOp);
  const template = buildItemsFromTemplate(firstOp.items, getOperationQuantity(firstOp, card));
  (card.operations || []).forEach(op => {
    if (op.id === firstOp.id) return;
    const qty = getOperationQuantity(op, card);
    op.items = buildItemsFromTemplate(template, qty);
    normalizeOperationItems(card, op);
  });
}

function renumberAutoCodesForCard(card) {
  if (!card || !Array.isArray(card.operations)) return;
  const opsSorted = [...card.operations].sort((a, b) => (a.order || 0) - (b.order || 0));
  let autoIndex = 0;
  opsSorted.forEach(op => {
    if (op.autoCode) {
      autoIndex++;
      op.opCode = formatStepCode(autoIndex);
    }
  });
}

function normalizeOperationItems(card, op) {
  if (!op || !card) return;
  op.items = Array.isArray(op.items) ? op.items : [];
  const useList = Boolean(card.useItemList);
  const opQty = getOperationQuantity(op, card);
  if (!useList) {
    const totals = sumItemCounts(op.items);
    op.goodCount = toSafeCount(op.goodCount || totals.good);
    op.scrapCount = toSafeCount(op.scrapCount || totals.scrap);
    op.holdCount = toSafeCount(op.holdCount || totals.hold);
    op.items = op.items.map(item => ({
      id: item.id || genId('item'),
      name: typeof item.name === 'string' ? item.name : '',
      quantity: 1,
      goodCount: toSafeCount(item.goodCount || 0),
      scrapCount: toSafeCount(item.scrapCount || 0),
      holdCount: toSafeCount(item.holdCount || 0)
    }));
    return;
  }

  const targetQty = Number.isFinite(opQty) ? opQty : 0;
  const normalized = [];
  for (let i = 0; i < targetQty; i++) {
    const source = op.items[i] || {};
    normalized.push({
      id: source.id || genId('item'),
      name: typeof source.name === 'string' ? source.name : '',
      quantity: 1,
      goodCount: toSafeCount(source.goodCount || 0),
      scrapCount: toSafeCount(source.scrapCount || 0),
      holdCount: toSafeCount(source.holdCount || 0)
    });
  }
  op.items = normalized;
  const totals = sumItemCounts(normalized);
  op.goodCount = totals.good;
  op.scrapCount = totals.scrap;
  op.holdCount = totals.hold;
}

function ensureAttachments(card) {
  if (!card) return;
  if (!Array.isArray(card.attachments)) card.attachments = [];
  card.attachments = card.attachments.map(file => ({
    id: file.id || genId('file'),
    name: file.name || 'file',
    type: file.type || 'application/octet-stream',
    size: typeof file.size === 'number' ? file.size : 0,
    content: typeof file.content === 'string' ? file.content : '',
    createdAt: file.createdAt || Date.now()
  }));
}

function ensureCardMeta(card, options = {}) {
  if (!card) return;
  const { skipSnapshot = false } = options;
  card.cardType = card.cardType === 'MKI' ? 'MKI' : 'MK';
  const isMki = card.cardType === 'MKI';
  card.routeCardNumber = typeof card.routeCardNumber === 'string'
    ? card.routeCardNumber
    : (card.orderNo ? String(card.orderNo) : '');
  card.orderNo = card.routeCardNumber;
  card.documentDesignation = typeof card.documentDesignation === 'string' ? card.documentDesignation : '';
  card.documentDate = formatDateInputValue(card.documentDate) || getCurrentDateString();
  card.issuedBySurname = typeof card.issuedBySurname === 'string' ? card.issuedBySurname : '';
  card.programName = typeof card.programName === 'string' ? card.programName : '';
  card.labRequestNumber = typeof card.labRequestNumber === 'string' ? card.labRequestNumber : '';
  card.workBasis = typeof card.workBasis === 'string'
    ? card.workBasis
    : (card.contractNumber ? String(card.contractNumber) : '');
  card.contractNumber = card.workBasis;
  card.supplyState = typeof card.supplyState === 'string' ? card.supplyState : '';
  card.itemDesignation = typeof card.itemDesignation === 'string'
    ? card.itemDesignation
    : (card.drawing ? String(card.drawing) : '');
  card.drawing = card.itemDesignation;
  card.supplyStandard = typeof card.supplyStandard === 'string' ? card.supplyStandard : '';
  card.itemName = typeof card.itemName === 'string' ? card.itemName : (card.name || '');
  card.name = card.itemName || 'Маршрутная карта';
  card.mainMaterials = typeof card.mainMaterials === 'string' ? card.mainMaterials : '';
  card.mainMaterialGrade = typeof card.mainMaterialGrade === 'string'
    ? card.mainMaterialGrade
    : (card.material ? String(card.material) : '');
  card.material = card.mainMaterialGrade;
  card.batchSize = card.batchSize == null ? card.quantity : card.batchSize;
  const qtyVal = card.batchSize === '' ? '' : toSafeCount(card.batchSize);
  card.quantity = qtyVal;
  card.batchSize = card.quantity;
  if (isMki) {
    const normalizedItems = normalizeSerialInput(card.itemSerials);
    const itemCount = card.quantity === '' ? 0 : toSafeCount(card.quantity);
    card.itemSerials = resizeSerialList(normalizedItems, itemCount, { fillDefaults: true });

    const normalizedSamples = normalizeSerialInput(card.sampleSerials);
    card.sampleCount = card.sampleCount === '' || card.sampleCount == null ? '' : toSafeCount(card.sampleCount);
    const sampleCount = card.sampleCount === '' ? 0 : toSafeCount(card.sampleCount);
    card.sampleSerials = resizeSerialList(normalizedSamples, sampleCount, { fillDefaults: true });
  } else {
    card.itemSerials = typeof card.itemSerials === 'string' ? card.itemSerials : '';
    card.sampleCount = '';
    card.sampleSerials = [];
  }
  card.specialNotes = typeof card.specialNotes === 'string'
    ? card.specialNotes
    : (card.desc ? String(card.desc) : '');
  card.desc = card.specialNotes;
  card.responsibleProductionChief = typeof card.responsibleProductionChief === 'string'
    ? card.responsibleProductionChief
    : '';
  card.responsibleSKKChief = typeof card.responsibleSKKChief === 'string' ? card.responsibleSKKChief : '';
  card.responsibleTechLead = typeof card.responsibleTechLead === 'string' ? card.responsibleTechLead : '';
  card.useItemList = Boolean(card.useItemList);
  if (typeof card.createdAt !== 'number') {
    card.createdAt = Date.now();
  }
  if (!Array.isArray(card.logs)) {
    card.logs = [];
  }
  const usedBarcodes = collectBarcodeSet(card.id);
  const barcodeValue = (card.barcode || '').trim();
  if (!barcodeValue || looksLikeLegacyBarcode(barcodeValue) || usedBarcodes.has(barcodeValue)) {
    card.barcode = generateUniqueCardCode128(usedBarcodes);
  } else {
    card.barcode = barcodeValue;
  }
  if (!card.initialSnapshot && !skipSnapshot) {
    const snapshot = cloneCard(card);
    snapshot.logs = [];
    card.initialSnapshot = snapshot;
  }
  card.operations = card.operations || [];
  card.operations.forEach(op => {
    op.isSamples = isMki ? Boolean(op && op.isSamples) : false;
    op.goodCount = toSafeCount(op.goodCount || 0);
    op.scrapCount = toSafeCount(op.scrapCount || 0);
    op.holdCount = toSafeCount(op.holdCount || 0);
    op.quantity = getOperationQuantity(op, card);
    op.autoCode = Boolean(op.autoCode);
    op.additionalExecutors = Array.isArray(op.additionalExecutors)
      ? op.additionalExecutors.map(name => (name || '').toString()).slice(0, 2)
      : [];
    normalizeOperationItems(card, op);
  });
  renumberAutoCodesForCard(card);
}

function formatCardTitle(card) {
  if (!card) return '';

  const name = (card?.name || '').toString().trim();
  const route = (card?.routeCardNumber || '').toString().trim();

  if (card?.cardType === 'MKI') {
    if (route && name) return route + ' · ' + name;
    if (route) return route;
    if (name) return name;
    return '';
  }

  return card?.name ? String(card.name) : 'Маршрутная карта';
}

function formatItemSerialsValue(card) {
  if (!card) return '';
  const raw = resolveCardField(card, 'itemSerials');
  if (Array.isArray(raw)) {
    return raw.map(v => (v == null ? '' : String(v))).join(', ');
  }
  return typeof raw === 'string' ? raw : '';
}

function getCardItemName(card) {
  if (!card) return '';
  return (card.itemName || card.name || '').toString().trim();
}

// Deprecated alias kept for backwards compatibility
function getCardDisplayTitle(card) {
  return formatCardTitle(card);
}

function validateMkiRouteCardNumber(draft, allCards) {
  if (!draft || draft.cardType !== 'MKI') return null;

  const number = String(draft.routeCardNumber || '').trim();
  if (!number) return null;

  const conflict = (allCards || []).some(c =>
    c && c.cardType === 'MK' && String(c.routeCardNumber || '').trim() === number && c.id !== draft.id
  );

  if (conflict) {
    return 'Нельзя создать МКИ с номером маршрутной карты, совпадающим с номером обычной МК.';
  }

  return null;
}

function validateMkiDraftConstraints(draft) {
  if (!draft || draft.cardType !== 'MKI') return null;
  const qty = draft.quantity === '' ? 0 : toSafeCount(draft.quantity);
  if (qty === 0) {
    return 'Размер партии не может быть равен 0';
  }

  const normalizedItems = resizeSerialList(normalizeSerialInput(draft.itemSerials), qty, { fillDefaults: false });
  if (hasEmptySerial(normalizedItems)) {
    return 'Заполните все значения в таблице "Индивидуальные номера изделий".';
  }

  const sampleCount = draft.sampleCount === '' ? 0 : toSafeCount(draft.sampleCount);
  const normalizedSamples = resizeSerialList(normalizeSerialInput(draft.sampleSerials), sampleCount, { fillDefaults: false });
  if (hasEmptySerial(normalizedSamples)) {
    return 'Заполните все значения в таблице "Индивидуальные номера образцов".';
  }

  return null;
}

function formatLogValue(val) {
  if (val === undefined || val === null) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  try {
    return JSON.stringify(val);
  } catch (err) {
    return String(val);
  }
}

function recordCardLog(card, { action, object, field = null, targetId = null, oldValue = '', newValue = '' }) {
  if (!card) return;
  ensureCardMeta(card);
  card.logs.push({
    id: genId('log'),
    ts: Date.now(),
    action: action || 'update',
    object: object || '',
    field,
    targetId,
    oldValue: formatLogValue(oldValue),
    newValue: formatLogValue(newValue)
  });
}

function opLogLabel(op) {
  return formatOpLabel(op) || 'Операция';
}

function dataUrlToBlob(dataUrl, fallbackType = 'application/octet-stream') {
  const parts = (dataUrl || '').split(',');
  if (parts.length < 2) return new Blob([], { type: fallbackType });
  const match = parts[0].match(/data:(.*);base64/);
  const mime = match ? match[1] : fallbackType;
  const binary = atob(parts[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

function formatBytes(size) {
  if (!size) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let idx = 0;
  let s = size;
  while (s >= 1024 && idx < units.length - 1) {
    s /= 1024;
    idx++;
  }
  return s.toFixed(Math.min(1, idx)).replace(/\.0$/, '') + ' ' + units[idx];
}

async function fetchBarcodeSvg(value) {
  const normalized = (value || '').trim();
  if (!normalized) return '';
  const res = await fetch('/api/barcode/svg?value=' + encodeURIComponent(normalized), { credentials: 'include' });
  if (!res.ok) throw new Error('Не удалось получить штрихкод');
  return res.text();
}

async function renderBarcodeInto(container, value) {
  if (!container) return;
  container.innerHTML = '';
  container.dataset.barcodeValue = '';
  const normalized = (value || '').trim();
  if (!normalized) return;
  container.dataset.barcodeValue = normalized;
  try {
    const svg = await fetchBarcodeSvg(normalized);
    if (container.dataset.barcodeValue === normalized) {
      container.innerHTML = svg;
    }
  } catch (err) {
    if (container.dataset.barcodeValue === normalized) {
      container.innerHTML = '<div class="barcode-error">Не удалось загрузить штрихкод</div>';
    }
  }
}

function openPasswordBarcode(password, username, userId, options = {}) {
  const { fromRestore = false } = options;
  const modal = document.getElementById('barcode-modal');
  const barcodeContainer = document.getElementById('barcode-svg');
  const codeSpan = document.getElementById('barcode-modal-code');
  const title = document.getElementById('barcode-modal-title');
  const userLabel = document.getElementById('barcode-modal-user');
  if (!modal || !barcodeContainer || !codeSpan) return;
  if (title) title.textContent = 'Штрихкод пароля';
  renderBarcodeInto(barcodeContainer, password);
  codeSpan.textContent = password;
  if (userLabel) {
    const normalized = (username || '').trim();
    userLabel.textContent = normalized ? `Пользователь: ${normalized}` : '';
    userLabel.classList.toggle('hidden', !normalized);
  }
  modal.dataset.username = username || '';
  modal.dataset.mode = 'password';
  modal.dataset.userId = userId || '';
  modal.dataset.cardId = '';
  modal.dataset.groupId = '';
  modal.style.display = 'flex';
  setModalState({ type: 'barcode', mode: 'password', userId }, { fromRestore });
}

function openBarcodeModal(card, options = {}) {
  const { fromRestore = false } = options;
  const modal = document.getElementById('barcode-modal');
  const barcodeContainer = document.getElementById('barcode-svg');
  const codeSpan = document.getElementById('barcode-modal-code');
  const title = document.getElementById('barcode-modal-title');
  const userLabel = document.getElementById('barcode-modal-user');
  if (!modal || !barcodeContainer || !codeSpan) return;

  const isGroup = isGroupCard(card);
  if (title) {
    title.textContent = isGroup ? 'Штрихкод группы карт' : 'Штрихкод маршрутной карты';
  }

  if (userLabel) {
    userLabel.textContent = '';
    userLabel.classList.add('hidden');
  }
  modal.dataset.username = '';
  modal.dataset.mode = 'card';
  modal.dataset.cardId = card && !isGroup ? (card.id || '') : '';
  modal.dataset.groupId = isGroup && card ? (card.id || '') : '';
  modal.dataset.userId = '';

  let value = getCardBarcodeValue(card);
  if (!value) {
    card.barcode = generateUniqueCardCode128();
    ensureUniqueBarcodes(cards);
    value = card.barcode;
    saveData();
    renderEverything();
  }
  renderBarcodeInto(barcodeContainer, value);
  codeSpan.textContent = value || (isGroup ? '(нет номера группы)' : '(нет номера МК)');
  modal.style.display = 'flex';
  setModalState({
    type: 'barcode',
    cardId: card && card.id ? card.id : '',
    mode: isGroup ? 'group' : 'card'
  }, { fromRestore });
}

function closeBarcodeModal(silent = false) {
  const modal = document.getElementById('barcode-modal');
  if (modal) modal.style.display = 'none';
  if (silent || restoringState) return;
  if (appState.modal && appState.modal.type === 'barcode') {
    history.back();
  } else {
    setModalState(null, { replace: true });
  }
}

function openPrintWindow(url) {
  const win = window.open(url, '_blank');
  if (!win) return;

  try { win.focus(); } catch (e) {}
  // ВАЖНО: здесь НЕЛЬЗЯ вызывать win.print().
  // Печать будет запускаться внутри шаблона после генерации SVG.
}

function setupBarcodeModal() {
  const modal = document.getElementById('barcode-modal');
  if (!modal) return;
  const closeBtn = document.getElementById('btn-close-barcode');
  const printBtn = document.getElementById('btn-print-barcode');

  if (closeBtn) {
    closeBtn.addEventListener('click', closeBarcodeModal);
  }

  if (printBtn) {
    printBtn.addEventListener('click', () => {
      const mode = modal.dataset.mode || 'card';
      if (mode === 'password') {
        const userId = (modal.dataset.userId || '').trim();
        if (userId) {
          const url = '/print/barcode/password/' + encodeURIComponent(userId);
          openPrintWindow(url);
        }
        return;
      }

      const groupId = (modal.dataset.groupId || '').trim();
      if (groupId) {
        const url = '/print/barcode/group/' + encodeURIComponent(groupId);
        openPrintWindow(url);
        return;
      }

      const cardId = (modal.dataset.cardId || '').trim();
      if (cardId) {
        const url = '/print/barcode/mk/' + encodeURIComponent(cardId);
        openPrintWindow(url);
      }
    });
  }
}

// === МОДЕЛЬ ОПЕРАЦИИ МАРШРУТА ===
function createRouteOpFromRefs(op, center, executor, plannedMinutes, order, options = {}) {
  const { code, autoCode = false, quantity, items = [], isSamples = false, card = null } = options;
  const opData = {
    id: genId('rop'),
    opId: op.id,
    opCode: code || op.code || op.opCode || generateUniqueOpCode(collectUsedOpCodes()),
    opName: op.name,
    centerId: center.id,
    centerName: center.name,
    executor: executor || '',
    plannedMinutes: plannedMinutes || op.recTime || 30,
    quantity: quantity === '' || quantity == null ? '' : toSafeCount(quantity),
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
    holdCount: 0,
    items,
    isSamples: Boolean(isSamples)
  };
  if (card && card.cardType === 'MKI') {
    opData.quantity = computeMkiOperationQuantity(opData, card);
  }
  return opData;
}

function recalcCardStatus(card) {
  if (isGroupCard(card)) {
    const children = card.archived ? getGroupChildren(card) : getActiveGroupChildren(card);
    if (!children.length) {
      card.status = 'NOT_STARTED';
      return;
    }
    const childStatuses = children.map(c => c.status || 'NOT_STARTED');
    const allDone = childStatuses.every(s => s === 'DONE');
    const anyInProgress = childStatuses.some(s => s === 'IN_PROGRESS');
    const anyPaused = childStatuses.some(s => s === 'PAUSED');
    const anyDone = childStatuses.some(s => s === 'DONE');
    const anyNotStarted = childStatuses.some(s => s === 'NOT_STARTED');
    if (anyInProgress) {
      card.status = 'IN_PROGRESS';
    } else if (anyPaused) {
      card.status = 'PAUSED';
    } else if (allDone) {
      card.status = 'DONE';
    } else if (anyDone && anyNotStarted) {
      card.status = 'PAUSED';
    } else {
      card.status = 'NOT_STARTED';
    }
    return;
  }
  const opsArr = card.operations || [];
  if (!opsArr.length) {
    card.status = 'NOT_STARTED';
    return;
  }
  const hasActive = opsArr.some(o => o.status === 'IN_PROGRESS' || o.status === 'PAUSED');
  const allDone = opsArr.length > 0 && opsArr.every(o => o.status === 'DONE');
  const hasNotStarted = opsArr.some(o => o.status === 'NOT_STARTED' || !o.status);
  const hasDone = opsArr.some(o => o.status === 'DONE');
  if (hasActive) {
    card.status = 'IN_PROGRESS';
  } else if (hasDone && hasNotStarted) {
    card.status = 'PAUSED';
  } else if (allDone && !hasNotStarted) {
    card.status = 'DONE';
  } else {
    card.status = 'NOT_STARTED';
  }
}

function statusBadge(status) {
  if (status === 'IN_PROGRESS') return '<span class="badge status-in-progress">В работе</span>';
  if (status === 'PAUSED') return '<span class="badge status-paused">Пауза</span>';
  if (status === 'DONE') return '<span class="badge status-done">Завершена</span>';
  return '<span class="badge status-not-started">Не начата</span>';
}

function cardStatusText(card) {
  if (isGroupCard(card)) {
    const children = card.archived ? getGroupChildren(card) : getActiveGroupChildren(card);
    if (!children.length) return 'Не запущена';
    const anyInProgress = children.some(c => c.status === 'IN_PROGRESS');
    const anyPaused = children.some(c => c.status === 'PAUSED');
    const anyPausedOp = children.some(ch => (ch.operations || []).some(op => op.status === 'PAUSED'));
    const allDone = children.length > 0 && children.every(c => c.status === 'DONE');
    const anyDone = children.some(c => c.status === 'DONE');
    const anyNotStarted = children.some(c => c.status === 'NOT_STARTED' || !c.status);

    if (anyPausedOp) return 'Смешанно';
    if (anyInProgress) return 'Выполняется';
    if (anyPaused) return 'Пауза';
    if (allDone) return 'Завершена';
    if (anyDone && anyNotStarted) return 'Пауза';
    return 'Не запущена';
  }
  const opsArr = card.operations || [];

  const hasStartedOrDoneOrPaused = opsArr.some(o =>
    o.status === 'IN_PROGRESS' || o.status === 'DONE' || o.status === 'PAUSED'
  );
  if (!opsArr.length || !hasStartedOrDoneOrPaused) {
    return 'Не запущена';
  }

  const inProgress = opsArr.find(o => o.status === 'IN_PROGRESS');
  if (inProgress) {
    const sec = getOperationElapsedSeconds(inProgress);
    return formatOpLabel(inProgress) + ' (' + formatSecondsToHMS(sec) + ')';
  }

  const paused = opsArr.find(o => o.status === 'PAUSED');
  if (paused) {
    const sec = getOperationElapsedSeconds(paused);
    return formatOpLabel(paused) + ' (пауза ' + formatSecondsToHMS(sec) + ')';
  }

  const allDone = opsArr.length > 0 && opsArr.every(o => o.status === 'DONE');
  if (allDone) {
    return 'Завершена';
  }

  const hasDone = opsArr.some(o => o.status === 'DONE');
  const hasNotStarted = opsArr.some(o => o.status === 'NOT_STARTED' || !o.status);
  if (hasDone && hasNotStarted) {
    return 'Пауза';
  }

  const notStartedOps = opsArr.filter(o => o.status === 'NOT_STARTED' || !o.status);
  if (notStartedOps.length) {
    let next = notStartedOps[0];
    notStartedOps.forEach(o => {
      const curOrder = typeof next.order === 'number' ? next.order : 999999;
      const newOrder = typeof o.order === 'number' ? o.order : 999999;
      if (newOrder < curOrder) next = o;
    });
    return formatOpLabel(next) + ' (ожидание)';
  }

  return 'Не запущена';
}

function getCardProcessState(card, { includeArchivedChildren = false } = {}) {
  if (isGroupCard(card)) {
    const children = getGroupChildren(card).filter(c => includeArchivedChildren || !c.archived);
    if (!children.length) return { key: 'NOT_STARTED', label: 'Не запущено', className: 'not-started' };
    const childStates = children.map(c => getCardProcessState(c, { includeArchivedChildren }));
    const hasPausedOp = children.some(ch => (ch.operations || []).some(op => op.status === 'PAUSED'));
    const hasInProgress = childStates.some(s => s.key === 'IN_PROGRESS');
    const hasPaused = childStates.some(s => s.key === 'PAUSED' || s.key === 'MIXED');
    const allDone = childStates.length > 0 && childStates.every(s => s.key === 'DONE');
    const hasDone = childStates.some(s => s.key === 'DONE');
    const hasNotStarted = childStates.some(s => s.key === 'NOT_STARTED');
    if (allDone) return { key: 'DONE', label: 'Выполнено', className: 'done' };
    if (hasPausedOp) return { key: 'MIXED', label: 'Смешанно', className: 'mixed' };
    if (hasInProgress) return { key: 'IN_PROGRESS', label: 'Выполняется', className: 'in-progress' };
    if (hasPaused) return { key: 'PAUSED', label: 'Пауза', className: 'paused' };
    if (hasDone && hasNotStarted) return { key: 'MIXED', label: 'Смешанно', className: 'mixed' };
    return { key: 'NOT_STARTED', label: 'Не запущена', className: 'not-started' };
  }
  const opsArr = card.operations || [];
  const hasInProgress = opsArr.some(o => o.status === 'IN_PROGRESS');
  const hasPaused = opsArr.some(o => o.status === 'PAUSED');
  const allDone = opsArr.length > 0 && opsArr.every(o => o.status === 'DONE');
  const allNotStarted = opsArr.length > 0 && opsArr.every(o => o.status === 'NOT_STARTED' || !o.status);
  const hasAnyDone = opsArr.some(o => o.status === 'DONE');
  const hasNotStarted = opsArr.some(o => o.status === 'NOT_STARTED' || !o.status);

  if (allDone) return { key: 'DONE', label: 'Выполнено', className: 'done' };
  if (hasInProgress && hasPaused) return { key: 'MIXED', label: 'Смешанно', className: 'mixed' };
  if (hasInProgress) return { key: 'IN_PROGRESS', label: 'Выполняется', className: 'in-progress' };
  if (hasPaused) return { key: 'PAUSED', label: 'Пауза', className: 'paused' };
  if (hasAnyDone && hasNotStarted) return { key: 'PAUSED', label: 'Пауза', className: 'paused' };
  if (allNotStarted) return { key: 'NOT_STARTED', label: 'Не запущена', className: 'not-started' };
  if (hasAnyDone) return { key: 'IN_PROGRESS', label: 'Выполняется', className: 'in-progress' };
  return { key: 'NOT_STARTED', label: 'Не запущена', className: 'not-started' };
}

function cardHasMissingExecutors(card) {
  const opsArr = card.operations || [];
  return opsArr.some(op => {
    const mainMissing = !op.executor || !String(op.executor).trim();
    const additionalMissing = Array.isArray(op.additionalExecutors)
      ? op.additionalExecutors.some(ex => !ex || !String(ex).trim())
      : false;
    return mainMissing || additionalMissing;
  });
}

function groupHasMissingExecutors(group) {
  if (!isGroupCard(group)) return false;
  const children = getGroupChildren(group).filter(c => !c.archived);
  return children.some(cardHasMissingExecutors);
}

function renderCardStateBadge(card, options) {
  const state = getCardProcessState(card, options);
  if (state.key === 'DONE') {
    return '<span class="status-pill status-pill-done" title="Выполнено">✓</span>';
  }
  if (state.key === 'MIXED') {
    return '<span class="status-pill status-pill-mixed" title="Смешанный статус">Смешанно</span>';
  }
  return '<span class="status-pill status-pill-' + state.className + '">' + state.label + '</span>';
}

function getCardComment(card) {
  const opsArr = card.operations || [];
  const priority = ['IN_PROGRESS', 'PAUSED', 'DONE', 'NOT_STARTED'];
  for (const status of priority) {
    const found = opsArr.find(o => o.status === status && o.comment);
    if (found) return found.comment;
  }
  const fallback = opsArr.find(o => o.comment);
  return fallback ? fallback.comment : '';
}

function formatOpLabel(op) {
  const name = op.opName || op.name || '';
  const code = op.opCode || op.code || '';
  return name || code;
}

function renderOpLabel(op) {
  return escapeHtml(formatOpLabel(op));
}

function renderOpName(op) {
  const name = op.opName || op.name || '';
  return escapeHtml(name);
}

function collectUsedOpCodes() {
  const used = new Set();
  ops.forEach(o => {
    if (o.code) used.add(o.code);
  });
  cards.forEach(card => {
    (card.operations || []).forEach(op => {
      if (op.opCode) used.add(op.opCode);
    });
  });
  return used;
}

function ensureOperationCodes() {
  const used = collectUsedOpCodes();
  ops = ops.map(op => {
    const next = { ...op };
    if (!next.code || used.has(next.code)) {
      next.code = generateUniqueOpCode(used);
    }
    used.add(next.code);
    return next;
  });

  const opMap = Object.fromEntries(ops.map(op => [op.id, op]));
  cards = cards.map(card => {
    const clonedCard = { ...card };
    clonedCard.operations = (clonedCard.operations || []).map(op => {
      const next = { ...op };
      const source = next.opId ? opMap[next.opId] : null;
      const isAuto = next.autoCode === true;

      const hasManualCode = typeof next.opCode === 'string'
        ? next.opCode.trim().length > 0
        : Boolean(next.opCode);

      if (!hasManualCode) {
        if (isAuto && source && source.code) {
          next.opCode = source.code;
        }

        if (!next.opCode) {
          next.opCode = generateUniqueOpCode(used);
        }
      }

      if (next.opCode) {
        used.add(next.opCode);
      }
      return next;
    });
    return clonedCard;
  });
}

// === ИМПОРТ IMDX (ИЗОЛИРОВАННЫЙ) ===
function resetImdxImportState() {
  imdxImportState = { parsed: null, missing: null };
}

function stripUtf8Bom(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/^\uFEFF/, '');
}

function normalizeImdxText(value) {
  return (value || '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ===== IMDX helpers (FIX: отличаем № п/п от кода операции, нормализуем названия) =====
function normalizeOpName(name) {
  return String(name || '')
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\[\s+/g, '[')
    .replace(/\s+\]/g, ']')
    .trim();
}

// КОД ОПЕРАЦИИ: принимаем только 3-4 цифры
// ВАЖНО: двузначные 1..99 НЕ принимаем, чтобы не путать с № п/п
function parseOpCodeToken(tok) {
  const t = String(tok || '').trim();
  if (!t) return null;
  // иногда встречается 4 цифры, оставим как есть
  if (/^\d{3,4}$/.test(t)) return t.padStart(3, '0');
  // 2 цифры разрешаем ТОЛЬКО если начинается с 0 (например 05 -> 005), иначе это почти всегда № п/п
  if (/^\d{2}$/.test(t) && t.startsWith('0')) return t.padStart(3, '0');
  return null;
}

function isProbablyOrderNumber(tok, opCode) {
  const t = String(tok || '').trim();
  if (!/^\d+$/.test(t)) return false;
  const n = parseInt(t, 10);
  if (Number.isNaN(n) || n < 1 || n > 300) return false;
  // если это совпадает с opCode (055) — не считаем order
  const opN = opCode ? parseInt(opCode, 10) : null;
  if (opN != null && n === opN) return false;
  return true;
}

// Дедуп по названию операции (уникальность только по названию)
function uniqByOpName(items) {
  const seen = new Set();
  const out = [];
  for (const it of items || []) {
    const key = normalizeOpName(it.opName).toLowerCase();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

function extractImdxCardFieldsByAttrGuid(doc) {
  const pickByAttrGuid = (guid) => {
    if (!doc || !guid) return '';
    const all = Array.from(doc.getElementsByTagName('*'));
    for (const el of all) {
      if ((el.getAttribute && el.getAttribute('attrGuid')) !== guid) continue;
      const textNodes = Array.from(el.getElementsByTagName('Text'));
      for (const node of textNodes) {
        const val = normalizeImdxText(node.textContent || '');
        if (val) return val;
      }
      const fallback = normalizeImdxText(el.textContent || '');
      if (fallback) return fallback;
    }
    return '';
  };

  return {
    documentDesignation: pickByAttrGuid('c7ab6c4e-866f-4408-8915-f0c5a4ecaeed'),
    itemName: pickByAttrGuid('cad00020-306c-11d8-b4e9-00304f19f545'),
    itemDesignation: pickByAttrGuid('cad0001f-306c-11d8-b4e9-00304f19f545')
  };
}

function extractImdxOperationsByObjGuid(doc) {
  if (!doc) return { operations: [], guidCount: 0 };

  const byObjGuid = new Map();
  const textBoxes = Array.from(doc.getElementsByTagName('TextBoxElement'));

  // Сбор токенов по objGuid
  textBoxes.forEach((tb, idx) => {
    const ref = Array.from(tb.getElementsByTagName('Reference'))
      .find(r => r.getAttribute && r.getAttribute('objGuid'));
    const guid = ref ? ref.getAttribute('objGuid') : null;
    if (!guid) return;

    const texts = Array.from(tb.getElementsByTagName('Text'));
    texts.forEach(node => {
      const raw = node.textContent || '';
      raw.split(/\r?\n/).forEach(part => {
        const normalized = normalizeImdxText(part);
        if (!normalized) return;
        if (!byObjGuid.has(guid)) byObjGuid.set(guid, { tokens: [], order: idx });
        byObjGuid.get(guid).tokens.push(normalized);
      });
    });
  });

  const headers = [
    'подразделение', '№', '№ п/п', '№оп', '№ оп', '№ оп.', 'наименование операции',
    'выдано в работу', 'изготовлено', 'годные', 'брак', 'задержано',
    'исполнитель', 'дата', 'подпись', 'время начала', 'время окончания'
  ];
  const isHeader = (s = '') => {
    const t = String(s).trim().toLowerCase();
    return !t ? true : headers.some(h => t.includes(h));
  };

  const operations = [];
  let guidIndex = 0;

  for (const [guid, data] of byObjGuid.entries()) {
    guidIndex += 1;
    const tokens = (data.tokens || []).map(normalizeImdxText).filter(Boolean);

    // 1) Находим opCode: ТОЛЬКО 3-4 цифры (иначе путается с № п/п)
    let opCode = null;
    for (const tok of tokens) {
      const c = parseOpCodeToken(tok);
      if (c) { opCode = c; break; }
    }
    if (!opCode) continue; // без кода операции - не операция

    // 2) Найти centerName: ближайший "короткий" текст рядом с opCode
    // допускаем составные типа "О ОПР/СКК": если токены короткие - склеиваем 2-3 шт.
    let centerName = '';
    const opIdx = tokens.findIndex(t => parseOpCodeToken(t) === opCode);
    const scanStart = Math.max(0, (opIdx >= 0 ? opIdx : 0) - 4);
    const scanEnd = Math.min(tokens.length, (opIdx >= 0 ? opIdx : tokens.length) + 1);

    for (let i = scanStart; i < scanEnd; i++) {
      const t = tokens[i];
      if (!t || isHeader(t)) continue;
      if (/^\d+$/.test(t)) continue;

      // пробуем склеить 1-3 токена, после которых стоит opCode
      const t1 = t;
      const t2 = (i + 1 < tokens.length) ? tokens[i + 1] : '';
      const t3 = (i + 2 < tokens.length) ? tokens[i + 2] : '';

      const cand1 = t1;
      const cand2 = (t2 && !/^\d+$/.test(t2) && !isHeader(t2)) ? (t1 + ' ' + t2) : '';
      const cand3 = (cand2 && t3 && !/^\d+$/.test(t3) && !isHeader(t3)) ? (cand2 + ' ' + t3) : '';

      const after1 = tokens[i + 1] || '';
      const after2 = tokens[i + 2] || '';
      const after3 = tokens[i + 3] || '';

      if (parseOpCodeToken(after1) === opCode) { centerName = cand1; break; }
      if (cand2 && parseOpCodeToken(after2) === opCode) { centerName = cand2; break; }
      if (cand3 && parseOpCodeToken(after3) === opCode) { centerName = cand3; break; }

      // fallback: если рядом не нашли, берем первый короткий текст
      if (!centerName && t.length <= 30) centerName = t;
    }

    centerName = normalizeImdxText(centerName);

    // 3) Найти opName: самая "человеческая" строка (длина >= 4), не число, не header, не centerName, не opCode
    let opName = '';
    let best = '';
    for (const tok of tokens) {
      if (!tok || isHeader(tok)) continue;
      if (parseOpCodeToken(tok)) continue;        // это код
      if (/^\d+$/.test(tok)) continue;            // это числа (в т.ч. № п/п)
      if (centerName && tok.toLowerCase() === centerName.toLowerCase()) continue;
      if (tok.length >= 4 && tok.length > best.length) best = tok;
    }
    opName = normalizeOpName(best);

    if (!centerName || !opName) continue;

    // 4) Найти order: число 1..300, но не равное opCode
    let order = null;
    for (const tok of tokens) {
      if (!isProbablyOrderNumber(tok, opCode)) continue;
      order = parseInt(tok, 10);
      break;
    }

    operations.push({
      order: Number.isFinite(order) ? order : null,
      centerName,
      opCode,
      opName,
      __guidIndex: data.order ?? guidIndex
    });
  }

  // сортировка: если order есть у большинства - сортируем по order
  const withOrder = operations.filter(op => Number.isFinite(op.order)).length;
  const sorted = (withOrder >= operations.length / 2)
    ? operations.sort((a, b) => {
        const ao = Number.isFinite(a.order) ? a.order : Number.MAX_SAFE_INTEGER;
        const bo = Number.isFinite(b.order) ? b.order : Number.MAX_SAFE_INTEGER;
        if (ao !== bo) return ao - bo;
        return a.__guidIndex - b.__guidIndex;
      })
    : operations.sort((a, b) => a.__guidIndex - b.__guidIndex);

  return {
    operations: sorted.map(({ __guidIndex, ...op }) => op),
    guidCount: byObjGuid.size
  };
}

function parseImdxContent(xmlText) {
  const cleaned = stripUtf8Bom(xmlText || '');
  const doc = new DOMParser().parseFromString(cleaned, 'application/xml');
  if (!doc || doc.getElementsByTagName('parsererror').length) {
    throw new Error('Файл IMDX повреждён или имеет неверный формат');
  }

  const cardData = extractImdxCardFieldsByAttrGuid(doc);
  const { operations: rawOperations, guidCount } = extractImdxOperationsByObjGuid(doc);

  const normalizeOpField = (val) => normalizeImdxText(val || '');
  const dedupedOperations = [];
  const seenOps = new Set();
  (rawOperations || []).forEach(op => {
    const centerName = normalizeOpField(op.centerName);
    const opCode = (op.opCode || '').trim();
    const opName = normalizeOpField(op.opName);
    if (!centerName || !opCode || !opName) return;
    const key = `${centerName.toLowerCase()}|${opCode}|${opName.toLowerCase()}`;
    if (seenOps.has(key)) return;
    seenOps.add(key);
    dedupedOperations.push({ ...op, centerName, opCode, opName });
  });
  const operations = dedupedOperations;

  if (!cardData.documentDesignation && !cardData.itemName && !cardData.itemDesignation && !operations.length) {
    throw new Error('В IMDX не найдены данные для импорта');
  }

  if (!operations.length) {
    throw new Error('Не удалось извлечь маршрут операций из IMDX');
  }

  if (DEBUG_IMDX) {
    console.log('[IMDX] objGuids:', guidCount, 'operations:', operations.length, 'card fields:', Object.keys(cardData).filter(k => cardData[k]));
    console.log('[IMDX] first operations sample:', operations.slice(0, 3));
  }

  return { card: cardData, operations };
}

function findCenterByName(name) {
  if (!name) return null;
  const target = name.trim().toLowerCase();
  if (!target) return null;
  return centers.find(c => (c.name || '').trim().toLowerCase() === target) || null;
}

function findOpByCodeOrName(opCode, opName) {
  const code = (opCode || '').trim().toLowerCase();
  if (code) {
    const byCode = ops.find(o => (o.code || o.opCode || '').trim().toLowerCase() === code);
    if (byCode) return byCode;
  }
  const name = (opName || '').trim().toLowerCase();
  if (name) {
    const byName = ops.find(o => (o.name || '').trim().toLowerCase() === name);
    if (byName) return byName;
  }
  return null;
}

function collectImdxMissing(parsed) {
  const missingCenters = new Set();
  let missingOps = [];
  if (!parsed || !Array.isArray(parsed.operations)) {
    return { centers: [], ops: [] };
  }

  parsed.operations.forEach(op => {
    const centerName = (op.centerName || '').trim();
    if (centerName && !findCenterByName(centerName)) {
      missingCenters.add(centerName);
    }

    const opRef = findOpByCodeOrName(op.opCode, op.opName);
    if (!opRef) {
      const opKey = normalizeOpName(op.opName).toLowerCase();
      const exists = missingOps.some(item => normalizeOpName(item.opName).toLowerCase() === opKey);
      if (!exists) {
        missingOps.push({ opCode: op.opCode || '', opName: op.opName || '' });
      }
    }
  });

  missingOps = uniqByOpName(missingOps);

  const result = { centers: Array.from(missingCenters), ops: missingOps };
  if (DEBUG_IMDX) {
    console.log('[IMDX] missing references:', result);
  }
  return result;
}

function openImdxImportModal() {
  const modal = document.getElementById('imdx-import-modal');
  if (!modal) return;
  const input = document.getElementById('imdx-file-input');
  if (input) input.value = '';
  closeImdxMissingModal();
  modal.classList.remove('hidden');
}

function closeImdxImportModal() {
  const modal = document.getElementById('imdx-import-modal');
  if (!modal) return;
  modal.classList.add('hidden');
}

function renderImdxMissingList(listEl, items = []) {
  if (!listEl) return;
  listEl.innerHTML = '';
  items.forEach(text => {
    const li = document.createElement('li');
    li.textContent = text;
    listEl.appendChild(li);
  });
}

function openImdxMissingModal(missing) {
  const modal = document.getElementById('imdx-missing-modal');
  if (!modal) return;
  const centersList = document.getElementById('imdx-missing-centers');
  const opsList = document.getElementById('imdx-missing-ops');
  const centerItems = (missing && missing.centers) || [];
  const opItems = (missing && missing.ops) || [];
  renderImdxMissingList(centersList, centerItems);
  renderImdxMissingList(opsList, opItems.map(op => {
    const code = (op.opCode || '').trim();
    const name = (op.opName || '').trim();
    if (code && name) return `${code} — ${name}`;
    return name || code || 'Операция';
  }));
  modal.classList.remove('hidden');
}

function closeImdxMissingModal() {
  const modal = document.getElementById('imdx-missing-modal');
  if (!modal) return;
  modal.classList.add('hidden');
}

async function handleImdxImportConfirm() {
  if (!activeCardDraft) return;
  const input = document.getElementById('imdx-file-input');
  const file = input && input.files ? input.files[0] : null;
  if (!file) {
    alert('Выберите файл IMDX');
    return;
  }
  try {
    const text = await file.text();
    const parsed = parseImdxContent(text);
    if (!parsed.operations || !parsed.operations.length) {
      alert('Не удалось извлечь маршрут операций из IMDX');
      resetImdxImportState();
      return;
    }
    const missing = collectImdxMissing(parsed);
    imdxImportState = { parsed, missing };
    closeImdxImportModal();
    if ((missing.centers && missing.centers.length) || (missing.ops && missing.ops.length)) {
      openImdxMissingModal(missing);
      return;
    }
    applyImdxImport(parsed);
    resetImdxImportState();
  } catch (err) {
    alert('Ошибка импорта IMDX: ' + err.message);
    resetImdxImportState();
  }
}

async function confirmImdxMissingAdd() {
  const state = imdxImportState || {};
  if (!state.parsed || !state.missing) {
    closeImdxMissingModal();
    resetImdxImportState();
    return;
  }

  const usedCodes = collectUsedOpCodes();
  (state.missing.centers || []).forEach(name => {
    const trimmed = (name || '').trim();
    if (!trimmed || findCenterByName(trimmed)) return;
    centers.push({ id: genId('wc'), name: trimmed, desc: '' });
  });

  (state.missing.ops || []).forEach(op => {
    const name = (op.opName || '').trim();
    const code = (op.opCode || '').trim();
    const nameKey = normalizeOpName(name).toLowerCase();
    if (!nameKey) return;
    const existsByName = ops.some(o => normalizeOpName(o.name).toLowerCase() === nameKey);
    if (existsByName) return;
    if (findOpByCodeOrName(code, name)) return;
    let finalCode = code;
    if (!finalCode || usedCodes.has(finalCode)) {
      finalCode = generateUniqueOpCode(usedCodes);
    }
    usedCodes.add(finalCode);
    ops.push({ id: genId('op'), code: finalCode, name: name || finalCode, desc: '', recTime: 0 });
  });

  await saveData();
  closeImdxMissingModal();
  applyImdxImport(state.parsed);
  resetImdxImportState();
}

function applyImdxImport(parsed) {
  if (!activeCardDraft || !parsed) return;
  const { card = {}, operations = [] } = parsed;
  const setFieldIfEmpty = (field, value, inputId) => {
    const val = (value || '').trim();
    if (!val) return;
    const current = (activeCardDraft[field] || '').trim();
    if (current) return;
    activeCardDraft[field] = val;
    if (inputId) {
      const input = document.getElementById(inputId);
      if (input && !input.value.trim()) {
        input.value = val;
      }
    }
  };

  setFieldIfEmpty('documentDesignation', card.documentDesignation, 'card-document-designation');
  setFieldIfEmpty('itemDesignation', card.itemDesignation, 'card-item-designation');
  if ((card.itemDesignation || '').trim()) {
    activeCardDraft.drawing = activeCardDraft.itemDesignation;
  }
  const itemName = (card.itemName || '').trim();
  if (itemName && !(activeCardDraft.itemName || '').trim()) {
    activeCardDraft.itemName = itemName;
    activeCardDraft.name = itemName;
    const nameInput = document.getElementById('card-name');
    if (nameInput && !nameInput.value.trim()) {
      nameInput.value = itemName;
    }
  }
  if (DEBUG_IMDX) {
    console.log('[IMDX] applying card fields', {
      documentDesignation: card.documentDesignation,
      itemDesignation: card.itemDesignation,
      itemName: card.itemName
    });
  }

  activeCardDraft.operations = [];
  const sortedOps = (operations || []).map((op, idx) => ({ ...op, __idx: idx })).sort((a, b) => {
    const aOrder = Number.isFinite(a.order) ? a.order : a.__idx + 1;
    const bOrder = Number.isFinite(b.order) ? b.order : b.__idx + 1;
    return aOrder - bOrder;
  });
  sortedOps.forEach((op, idx) => {
    const center = findCenterByName(op.centerName);
    const opRef = findOpByCodeOrName(op.opCode, op.opName);
    if (!center || !opRef) {
      if (DEBUG_IMDX) {
        console.warn('[IMDX] пропущена операция из-за отсутствия справочника', op);
      }
      return;
    }
    const orderVal = Number.isFinite(op.order) ? op.order : ((op.order != null && !Number.isNaN(parseInt(op.order, 10))) ? parseInt(op.order, 10) : idx + 1);
    const rop = createRouteOpFromRefs(opRef, center, '', 0, orderVal, { autoCode: true });
    activeCardDraft.operations.push(rop);
  });

  updateCardMainSummary();
  renderRouteTableDraft();
  fillRouteSelectors();
  const statusEl = document.getElementById('card-status-text');
  if (statusEl) {
    statusEl.textContent = cardStatusText(activeCardDraft);
  }
}

// === ХРАНИЛИЩЕ ===
async function saveData() {
  try {
    if (!apiOnline) {
      setConnectionStatus('Сервер недоступен — изменения не сохраняются. Проверьте, что запущен server.js.', 'error');
      return;
    }

    const res = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cards, ops, centers }),
      credentials: 'include'
    });
    if (res.status === 401) {
      handleUnauthorized('Сессия истекла, войдите снова');
      return;
    }
    if (!res.ok) {
      throw new Error('Ответ сервера ' + res.status);
    }
    await loadData();
    setConnectionStatus('', 'info');
  } catch (err) {
    apiOnline = false;
    setConnectionStatus('Не удалось сохранить данные на сервер: ' + err.message, 'error');
    console.error('Ошибка сохранения данных на сервер', err);
  }
}

function ensureDefaults() {
  if (!centers.length) {
    centers = [
      { id: genId('wc'), name: 'Механическая обработка', desc: 'Токарные и фрезерные операции' },
      { id: genId('wc'), name: 'Покрытия / напыление', desc: 'Покрытия, термическое напыление' },
      { id: genId('wc'), name: 'Контроль качества', desc: 'Измерения, контроль, визуальный осмотр' }
    ];
  }

  if (!ops.length) {
    const used = new Set();
    ops = [
      { id: genId('op'), code: generateUniqueOpCode(used), name: 'Токарная обработка', desc: 'Черновая и чистовая', recTime: 40 },
      { id: genId('op'), code: generateUniqueOpCode(used), name: 'Напыление покрытия', desc: 'HVOF / APS', recTime: 60 },
      { id: genId('op'), code: generateUniqueOpCode(used), name: 'Контроль размеров', desc: 'Измерения, оформление протокола', recTime: 20 }
    ];
  }

  if (!cards.length) {
    const demoId = genId('card');
    const op1 = ops[0];
    const op2 = ops[1];
    const op3 = ops[2];
    const wc1 = centers[0];
    const wc2 = centers[1];
    const wc3 = centers[2];
    cards = [
      {
        id: demoId,
        barcode: '',
        name: 'Вал привода Ø60',
        quantity: 1,
        drawing: 'DWG-001',
        material: 'Сталь',
        orderNo: 'DEMO-001',
        desc: 'Демонстрационная карта для примера.',
        status: 'NOT_STARTED',
        archived: false,
        attachments: [],
        operations: [
          createRouteOpFromRefs(op1, wc1, 'Иванов И.И.', 40, 1),
          createRouteOpFromRefs(op2, wc2, 'Петров П.П.', 60, 2),
          createRouteOpFromRefs(op3, wc3, 'Сидоров С.С.', 20, 3)
        ]
      }
    ];
  }
}

async function loadData() {
  try {
    const res = await fetch(API_ENDPOINT, { credentials: 'include' });
    if (res.status === 401) {
      handleUnauthorized('Введите пароль для продолжения работы');
      throw new Error('Unauthorized');
    }
    if (!res.ok) throw new Error('Ответ сервера ' + res.status);
    const payload = await res.json();
    cards = Array.isArray(payload.cards) ? payload.cards : [];
    ops = Array.isArray(payload.ops) ? payload.ops : [];
    centers = Array.isArray(payload.centers) ? payload.centers : [];
    accessLevels = Array.isArray(payload.accessLevels) ? payload.accessLevels : [];
    users = Array.isArray(payload.users) ? payload.users : [];
    apiOnline = true;
    setConnectionStatus('', 'info');
  } catch (err) {
    if (err.message === 'Unauthorized') {
      apiOnline = false;
      return;
    }
    console.warn('Не удалось загрузить данные с сервера, используем пустые коллекции', err);
    apiOnline = false;
    setConnectionStatus('Нет соединения с сервером: данные будут только в этой сессии', 'error');
    cards = [];
    ops = [];
    centers = [];
  }

  ensureDefaults();
  ensureOperationCodes();
  ensureUniqueBarcodes(cards);
  renderUserDatalist();

  cards.forEach(c => {
    c.archived = Boolean(c.archived);
    ensureAttachments(c);
    ensureCardMeta(c);
    c.operations = c.operations || [];
    c.operations.forEach(op => {
      if (typeof op.elapsedSeconds !== 'number') {
        op.elapsedSeconds = 0;
      }
      op.goodCount = toSafeCount(op.goodCount || 0);
      op.scrapCount = toSafeCount(op.scrapCount || 0);
      op.holdCount = toSafeCount(op.holdCount || 0);
      if (typeof op.firstStartedAt !== 'number') {
        op.firstStartedAt = op.startedAt || null;
      }
      if (typeof op.lastPausedAt !== 'number') {
        op.lastPausedAt = null;
      }
      if (typeof op.comment !== 'string') {
        op.comment = '';
      }
      if (op.status === 'DONE' && op.actualSeconds != null && !op.elapsedSeconds) {
        op.elapsedSeconds = op.actualSeconds;
      }
    });
    recalcCardStatus(c);
  });
}

async function loadSecurityData() {
  try {
    const [usersRes, levelsRes] = await Promise.all([
      fetch('/api/security/users', { credentials: 'include' }),
      fetch('/api/security/access-levels', { credentials: 'include' })
    ]);
    if (usersRes.ok) {
      const payload = await usersRes.json();
      users = Array.isArray(payload.users) ? payload.users : [];
      users.forEach(u => {
        const cached = resolveUserPassword(u);
        if (cached) u.password = cached;
      });
      forgetMissingUserPasswords(users);
      renderUserDatalist();
    }
    if (levelsRes.ok) {
      const payload = await levelsRes.json();
      accessLevels = Array.isArray(payload.accessLevels) ? payload.accessLevels : [];
    }
  } catch (err) {
    console.error('Не удалось загрузить данные доступа', err);
  }
}

// === АВТОРИЗАЦИЯ ===
async function performLogin(password) {
  const errorEl = document.getElementById('login-error');
  if (!password) {
    if (errorEl) {
      errorEl.style.display = 'block';
      errorEl.textContent = 'Введите пароль';
    }
    return;
  }

  try {
    const formData = new FormData();
    formData.append('password', password);

    const res = await fetch('/api/login', {
      method: 'POST',
      body: formData,
      credentials: 'include'
    });
    const payload = await res.json().catch(() => ({}));
    if (!payload.success) {
      const message = (payload && payload.error) ? payload.error : 'Неверный пароль';
      if (errorEl) {
        errorEl.style.display = 'block';
        errorEl.textContent = message;
      }
      return;
    }

    currentUser = payload.user || null;
    updateUserBadge();
    hideAuthOverlay();
    showMainApp();
    await bootstrapApp();
    applyNavigationPermissions();
    resetInactivityTimer();
  } catch (err) {
    if (errorEl) {
      errorEl.style.display = 'block';
      errorEl.textContent = 'Ошибка входа: ' + err.message;
    }
  }
}

async function restoreSession() {
  try {
    const res = await fetch('/api/session', { credentials: 'include' });
    if (!res.ok) throw new Error('Unauthorized');
    const payload = await res.json();
    currentUser = payload.user || null;
    updateUserBadge();
    hideAuthOverlay();
    showMainApp();
    applyNavigationPermissions();
    await bootstrapApp();
    resetInactivityTimer();
  } catch (err) {
    showAuthOverlay('Введите пароль для входа');
  }
}

async function performLogout(silent = false) {
  try {
    await fetch('/api/logout', { method: 'POST', credentials: 'include' });
  } catch (err) {
    if (!silent) console.error('Logout failed', err);
  }
  currentUser = null;
  updateUserBadge();
  hideMainApp();
  showAuthOverlay('Сессия завершена');
}

function applyNavigationPermissions() {
  const navButtons = document.querySelectorAll('.nav-btn');
  navButtons.forEach(btn => {
    const target = btn.getAttribute('data-target');
    const allowed = canViewTab(target);
    btn.classList.toggle('hidden', !allowed);
    const section = document.getElementById(target);
    if (section) section.classList.toggle('hidden', !allowed);
  });

  const selected = getDefaultTab();
  activateTab(selected, { replaceHistory: true });
}

function restoreState(state) {
  if (!currentUser) return;
  restoringState = true;
  const targetTab = state && canViewTab(state.tab) ? state.tab : getDefaultTab();
  closeAllModals(true);
  activateTab(targetTab, { skipHistory: true, fromRestore: true });

  let openedModal = null;
  const incomingModal = state ? state.modal : null;
  const cardsAllowed = canViewTab('cards');
  if (incomingModal && incomingModal.type === 'barcode' && cardsAllowed) {
    const card = cards.find(c => c.id === incomingModal.cardId);
    if (card) {
      openBarcodeModal(card, { fromRestore: true });
      openedModal = incomingModal;
    }
  } else if (incomingModal && incomingModal.type === 'log' && cardsAllowed) {
    if (incomingModal.cardId) {
      openLogModal(incomingModal.cardId, { fromRestore: true });
      openedModal = incomingModal;
    }
  } else if (incomingModal && incomingModal.type === 'card' && cardsAllowed) {
    openCardModal(incomingModal.cardId || null, { fromRestore: true });
    openedModal = incomingModal;
  } else if (incomingModal && incomingModal.type === 'scanner') {
    const scanner = scannerRegistry[incomingModal.inputId];
    if (scanner && typeof scanner.openScanner === 'function') {
      scanner.openScanner();
      openedModal = incomingModal;
    }
  }

  appState = { tab: targetTab, modal: openedModal };
  restoringState = false;
}

window.addEventListener('popstate', (event) => {
  const route = (event.state && event.state.route) || (window.location.pathname + window.location.search) || '/';
  handleRoute(route, { fromHistory: true, replace: true });
});

function syncReadonlyLocks() {
  applyReadonlyState('dashboard', 'dashboard');
  applyReadonlyState('cards', 'cards');
  applyReadonlyState('workorders', 'workorders');
  applyReadonlyState('archive', 'archive');
  applyReadonlyState('workspace', 'workspace');
  applyReadonlyState('users', 'users');
  applyReadonlyState('accessLevels', 'accessLevels');
}

function setupAuthControls() {
  const loginOverlay = document.getElementById('login-overlay');
  const appRoot = document.getElementById('app-root');
  const form = document.getElementById('login-form');
  const input = document.getElementById('login-password');
  const errorEl = document.getElementById('login-error');

  if (loginOverlay) loginOverlay.classList.remove('hidden');
  if (appRoot) appRoot.classList.add('hidden');

  if (!form) {
    console.error('login-form not found');
    return;
  }

  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => performLogout());
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const pwd = (input && input.value) ? input.value.trim() : '';

    if (errorEl) {
      errorEl.style.display = 'none';
      errorEl.textContent = '';
    }

    await performLogin(pwd);
  });
}

function setupHelpModal() {
  const helpBtn = document.getElementById('login-help-btn');
  const helpOverlay = document.getElementById('help-overlay');
  const helpClose = document.getElementById('help-close');
  if (!helpBtn || !helpOverlay) return;

  const closeHelp = () => {
    helpOverlay.classList.add('hidden');
    helpBtn.setAttribute('aria-expanded', 'false');
    helpBtn.focus({ preventScroll: true });
  };

  const openHelp = (event) => {
    event?.preventDefault();
    helpOverlay.classList.remove('hidden');
    helpBtn.setAttribute('aria-expanded', 'true');
    if (helpClose) {
      helpClose.focus({ preventScroll: true });
    }
  };

  helpBtn.addEventListener('click', openHelp);

  if (helpClose) {
    helpClose.addEventListener('click', closeHelp);
  }

  helpOverlay.addEventListener('click', (event) => {
    if (event.target === helpOverlay) {
      closeHelp();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !helpOverlay.classList.contains('hidden')) {
      closeHelp();
    }
  });
}

function setupBarcodeScannerForInput(inputId, triggerId) {
  const searchInput = document.getElementById(inputId);
  const triggerButton = document.getElementById(triggerId);
  const modal = document.getElementById('barcode-scanner-modal');
  const video = document.getElementById('barcode-scanner-video');
  const closeButton = document.getElementById('barcode-scanner-close');
  const statusEl = document.getElementById('barcode-scanner-status');
  const hintEl = document.getElementById('barcode-scanner-hint');

  if (!searchInput || !triggerButton || !modal || typeof BarcodeScanner === 'undefined') return null;

  const scanner = new BarcodeScanner({
    input: searchInput,
    triggerButton,
    modal,
    video,
    closeButton,
    statusEl,
    hintEl,
    onOpen: () => {
      if (restoringState) {
        appState = { ...appState, modal: { type: 'scanner', inputId } };
        return;
      }
      setModalState({ type: 'scanner', inputId });
    },
    onClose: () => {
      if (restoringState) {
        appState = { ...appState, modal: null };
        return;
      }
      if (appState.modal && appState.modal.type === 'scanner' && appState.modal.inputId === inputId) {
        history.back();
      } else {
        setModalState(null, { replace: true });
      }
    }
  });

  scanner.init();
  scannerRegistry[inputId] = scanner;
  return scanner;
}

function initScanButton(inputId, buttonId) {
  return setupBarcodeScannerForInput(inputId, buttonId);
}

async function bootstrapApp() {
  await loadData();
  await loadSecurityData();
  if (!currentUser) return;

  if (!appBootstrapped) {
    setupNavigation();
    setupCardsDropdownMenu();
    setupCardsTabs();
    setupForms();
    setupBarcodeModal();
    setupDeleteConfirmModal();
    initScanButton('cards-search', 'cards-scan-btn');
    initScanButton('workorder-search', 'workorder-scan-btn');
    initScanButton('archive-search', 'archive-scan-btn');
    initScanButton('workspace-search', 'workspace-scan-btn');
    setupGroupTransferModal();
    setupGroupExecutorModal();
    setupAttachmentControls();
    setupWorkspaceModal();
    setupLogModal();
    setupSecurityControls();
    appBootstrapped = true;
  }

  renderEverything();
  if (window.dashboardPager && typeof window.dashboardPager.updatePages === 'function') {
    requestAnimationFrame(() => window.dashboardPager.updatePages());
  }
  if (!timersStarted) {
    setInterval(tickTimers, 1000);
    timersStarted = true;
  }

  handleRoute((window.location.pathname + window.location.search) || '/', { replace: true, fromHistory: true });
}

// === РЕНДЕРИНГ ДАШБОРДА ===
function renderDashboard() {
  const statsContainer = document.getElementById('dashboard-stats');
  const activeCards = cards.filter(c => !c.archived && !isGroupCard(c));
  const cardsCount = activeCards.length;
  const inWork = activeCards.filter(c => c.status === 'IN_PROGRESS').length;
  const done = activeCards.filter(c => c.status === 'DONE').length;
  const notStarted = cardsCount - inWork - done;

  statsContainer.innerHTML = '';
  const stats = [
    { label: 'Всего карт', value: cardsCount },
    { label: 'Не запущено', value: notStarted },
    { label: 'В работе', value: inWork },
    { label: 'Завершено', value: done }
  ];
  stats.forEach(st => {
    const div = document.createElement('div');
    div.className = 'stat-block';
    div.innerHTML = '<span>' + st.label + '</span><strong>' + st.value + '</strong>';
    statsContainer.appendChild(div);
  });

  const dashTableWrapper = document.getElementById('dashboard-cards');
  const currentStatusSnapshot = (() => {
    const map = new Map();
    cards.forEach(card => {
      if (card && !card.archived) {
        map.set(card.id, card.status || 'NOT_STARTED');
      }
    });
    return map;
  })();

  const statusChanged = (() => {
    if (!dashboardStatusSnapshot) return true;
    if (dashboardStatusSnapshot.size !== currentStatusSnapshot.size) return true;
    for (const [id, status] of currentStatusSnapshot.entries()) {
      if (dashboardStatusSnapshot.get(id) !== status) return true;
    }
    return false;
  })();

  dashboardStatusSnapshot = currentStatusSnapshot;
  if (statusChanged) {
    dashboardEligibleCache = activeCards.filter(c => c.status !== 'NOT_STARTED');
  }
  const eligibleCards = dashboardEligibleCache;
  const emptyMessage = '<p>Карт для отображения пока нет.</p>';
  const tableHeader = '<thead><tr><th>Маршрутная карта №</th><th>Наименование изделия</th><th>Статус / операции</th><th>Сделано деталей</th><th>Выполнено операций</th><th>Комментарии</th></tr></thead>';

  if (!eligibleCards.length) {
    if (window.dashboardPager && typeof window.dashboardPager.render === 'function') {
      window.dashboardPager.render({
        headerHtml: tableHeader,
        rowsHtml: [],
        emptyMessage
      });
    } else if (dashTableWrapper) {
      dashTableWrapper.innerHTML = emptyMessage;
    }
    return;
  }

  if (!statusChanged) {
    updateDashboardTimers();
    return;
  }

  const rowsHtml = eligibleCards.map(card => {
    const opsArr = card.operations || [];
    const activeOps = opsArr.filter(o => o.status === 'IN_PROGRESS' || o.status === 'PAUSED');
    let statusHtml = '';

    let opsForDisplay = [];
    if (card.status === 'DONE') {
      statusHtml = '<span class="dash-card-completed">Завершена</span>';
    } else if (!opsArr.length || opsArr.every(o => o.status === 'NOT_STARTED' || !o.status)) {
      statusHtml = 'Не запущена';
    } else if (activeOps.length) {
      opsForDisplay = activeOps;
      activeOps.forEach(op => {
        const elapsed = getOperationElapsedSeconds(op);
        const plannedSec = (op.plannedMinutes || 0) * 60;
        let cls = 'dash-op';
        if (op.status === 'PAUSED') {
          cls += ' dash-op-paused';
        }
        if (plannedSec && elapsed > plannedSec) {
          cls += ' dash-op-overdue';
        }
        statusHtml += '<span class="' + cls + '" data-card-id="' + card.id + '" data-op-id="' + op.id + '">' +
          '<span class="dash-op-label">' + renderOpLabel(op) + '</span>' +
          ' — <span class="dash-op-time">' + formatSecondsToHMS(elapsed) + '</span>' +
          '</span>';
      });
    } else {
      const notStartedOps = opsArr.filter(o => o.status === 'NOT_STARTED' || !o.status);
      if (notStartedOps.length) {
        let next = notStartedOps[0];
        notStartedOps.forEach(o => {
          const curOrder = typeof next.order === 'number' ? next.order : 999999;
          const newOrder = typeof o.order === 'number' ? o.order : 999999;
          if (newOrder < curOrder) next = o;
        });
        opsForDisplay = [next];
        statusHtml = renderOpLabel(next) + ' (ожидание)';
      } else {
        statusHtml = 'Не запущена';
      }
    }

    const { qty: qtyTotal, hasValue: hasQty } = getCardPlannedQuantity(card);
    let qtyCell = '—';

    if (card.status === 'DONE' && hasQty) {
      const batchResult = calculateFinalResults(opsArr, qtyTotal || 0);
      const qtyText = (batchResult.good_final || 0) + ' из ' + qtyTotal;
      qtyCell = '<div class="dash-qty-line">' + qtyText + '</div>';
    } else if (opsForDisplay.length && hasQty) {
      const qtyLines = opsForDisplay.map(op => {
        const good = toSafeCount(op.goodCount || 0);
        const qtyText = good + ' из ' + qtyTotal;
        return '<div class="dash-qty-line">' + qtyText + '</div>';
      });
      qtyCell = qtyLines.length ? qtyLines.join('') : '—';
    }

    const completedCount = opsArr.filter(o => o.status === 'DONE').length;
    const commentLines = opsForDisplay
      .filter(o => o.comment)
      .map(o => '<div class="dash-comment-line"><span class="dash-comment-op">' + renderOpLabel(o) + ':</span> ' + escapeHtml(o.comment) + '</div>');
    const commentCell = commentLines.join('');

    const nameCell = escapeHtml(getCardItemName(card));
    const barcodeValue = getCardBarcodeValue(card);
    return '<tr>' +
      '<td>' + escapeHtml(barcodeValue) + '</td>' +
      '<td>' + nameCell + '</td>' +
      '<td><span class="dashboard-card-status" data-card-id="' + card.id + '">' + statusHtml + '</span></td>' +
      '<td>' + qtyCell + '</td>' +
      '<td>' + completedCount + ' из ' + (card.operations ? card.operations.length : 0) + '</td>' +
      '<td>' + commentCell + '</td>' +
      '</tr>';
  });

  if (window.dashboardPager && typeof window.dashboardPager.render === 'function') {
    window.dashboardPager.render({
      headerHtml: tableHeader,
      rowsHtml,
      emptyMessage
    });
  } else if (dashTableWrapper) {
    dashTableWrapper.innerHTML = wrapTable('<table>' + tableHeader + '<tbody>' + rowsHtml.join('') + '</tbody></table>');
  }
}

function updateDashboardTimers() {
  const nodes = document.querySelectorAll('.dashboard-card-status .dash-op[data-card-id][data-op-id]');
  nodes.forEach(node => {
    const cardId = node.getAttribute('data-card-id');
    const opId = node.getAttribute('data-op-id');
    const card = cards.find(c => c.id === cardId);
    const op = card ? (card.operations || []).find(o => o.id === opId) : null;
    if (!op) return;

    const elapsed = getOperationElapsedSeconds(op);
    const plannedSec = (op.plannedMinutes || 0) * 60;
    const timeSpan = node.querySelector('.dash-op-time');

    if (timeSpan) {
      timeSpan.textContent = formatSecondsToHMS(elapsed);
    }

    node.classList.toggle('dash-op-paused', op.status === 'PAUSED');
    node.classList.toggle('dash-op-overdue', plannedSec && elapsed > plannedSec);
  });
}

// === РЕНДЕРИНГ МАРШРУТНЫХ КАРТ ===
function renderCardStatusCell(card) {
  if (!card) return '';
  const status = cardStatusText(card);
  return '<span class="cards-status-text" data-card-id="' + card.id + '">' + escapeHtml(status) + '</span>';
}

function renderCardsTable() {
  const wrapper = document.getElementById('cards-table-wrapper');
  const visibleCards = cards.filter(c => !c.archived && !c.groupId);
  if (!visibleCards.length) {
    wrapper.innerHTML = '<p>Список маршрутных карт пуст. Нажмите «Создать МК».</p>';
    return;
  }

  const termRaw = cardsSearchTerm.trim();
  const cardMatches = (card) => {
    return termRaw ? cardSearchScore(card, termRaw) > 0 : true;
  };

  let sortedCards = [...visibleCards];
  if (termRaw) {
    sortedCards.sort((a, b) => cardSearchScore(b, termRaw) - cardSearchScore(a, termRaw));
  }

  const filteredCards = sortedCards.filter(card => {
    if (isGroupCard(card)) {
      const children = getGroupChildren(card).filter(c => !c.archived);
      return cardMatches(card) || children.some(ch => cardMatches(ch));
    }
    return cardMatches(card);
  });

  if (!filteredCards.length) {
    wrapper.innerHTML = '<p>Карты по запросу не найдены.</p>';
    return;
  }

  let html = '<table><thead><tr>' +
    '<th>Маршрутная карта № (Code128)</th><th>Наименование</th><th>Статус</th><th>Операций</th><th>Файлы</th><th>Действия</th>' +
    '</tr></thead><tbody>';

  filteredCards.forEach(card => {
    if (isGroupCard(card)) {
      const children = getGroupChildren(card).filter(c => !c.archived);
      const filesCount = (card.attachments || []).length;
      const opened = cardsGroupOpen.has(card.id);
      const opsTotal = children.reduce((acc, c) => acc + ((c.operations || []).length), 0);
      const toggleLabel = opened ? 'Закрыть' : 'Открыть';
      const groupBarcode = getCardBarcodeValue(card);
      html += '<tr class="group-row" data-group-id="' + card.id + '">' +
        '<td><button class="btn-link barcode-link" data-id="' + card.id + '">' + escapeHtml(groupBarcode) + '</button></td>' +
        '<td><span class="group-marker">(Г)</span>' + escapeHtml(card.name || '') + '</td>' +
        '<td></td>' +
        '<td>' + opsTotal + '</td>' +
        '<td><button class="btn-small clip-btn" data-attach-card="' + card.id + '">📎 <span class="clip-count">' + filesCount + '</span></button></td>' +
        '<td><div class="table-actions">' +
        '<button class="btn-small group-toggle-btn" data-action="toggle-group" data-id="' + card.id + '">' + toggleLabel + '</button>' +
        '<button class="btn-small" data-action="print-group" data-id="' + card.id + '">Печать</button>' +
        '<button class="btn-small" data-action="copy-group" data-id="' + card.id + '">Копировать</button>' +
        '<button class="btn-small btn-danger" data-action="delete-group" data-id="' + card.id + '">Удалить</button>' +
        '</div></td>' +
        '</tr>';

      if (opened) {
        children.forEach(child => {
          const childFiles = (child.attachments || []).length;
          const childBarcode = getCardBarcodeValue(child);
          html += '<tr class="group-child-row" data-parent="' + card.id + '">' +
            '<td><button class="btn-link barcode-link" data-id="' + child.id + '">' + escapeHtml(childBarcode) + '</button></td>' +
            '<td class="group-indent">' + escapeHtml(child.name || '') + '</td>' +
            '<td>' + renderCardStatusCell(child) + '</td>' +
            '<td>' + ((child.operations || []).length) + '</td>' +
            '<td><button class="btn-small clip-btn" data-attach-card="' + child.id + '">📎 <span class="clip-count">' + childFiles + '</span></button></td>' +
            '<td><div class="table-actions">' +
            '<button class="btn-small" data-action="edit-card" data-id="' + child.id + '">Открыть</button>' +
            '<button class="btn-small" data-action="print-card" data-id="' + child.id + '">Печать</button>' +
            '<button class="btn-small" data-action="copy-card" data-id="' + child.id + '">Копировать</button>' +
            '<button class="btn-small btn-danger" data-action="delete-card" data-id="' + child.id + '">Удалить</button>' +
            '</div></td>' +
            '</tr>';
        });
      }
      return;
    }

    const filesCount = (card.attachments || []).length;
    const barcodeValue = getCardBarcodeValue(card);
    html += '<tr>' +
      '<td><button class="btn-link barcode-link" data-id="' + card.id + '">' + escapeHtml(barcodeValue) + '</button></td>' +
      '<td>' + escapeHtml(card.name || '') + '</td>' +
      '<td>' + renderCardStatusCell(card) + '</td>' +
      '<td>' + (card.operations ? card.operations.length : 0) + '</td>' +
      '<td><button class="btn-small clip-btn" data-attach-card="' + card.id + '">📎 <span class="clip-count">' + filesCount + '</span></button></td>' +
      '<td><div class="table-actions">' +
      '<button class="btn-small" data-action="edit-card" data-id="' + card.id + '">Открыть</button>' +
      '<button class="btn-small" data-action="print-card" data-id="' + card.id + '">Печать</button>' +
      '<button class="btn-small" data-action="copy-card" data-id="' + card.id + '">Копировать</button>' +
      '<button class="btn-small btn-danger" data-action="delete-card" data-id="' + card.id + '">Удалить</button>' +
      '</div></td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  wrapper.innerHTML = html;

  wrapper.querySelectorAll('button[data-action="edit-card"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cardId = btn.getAttribute('data-id');
      const card = cards.find(c => c.id === cardId);
      const isMki = card && card.cardType === 'MKI';
      const route = isMki ? '/cards-mki/new?cardId=' + encodeURIComponent(cardId) : '/cards/new?cardId=' + encodeURIComponent(cardId);
      navigateToRoute(route);
    });
  });

  wrapper.querySelectorAll('button[data-action="copy-card"]').forEach(btn => {
    btn.addEventListener('click', () => {
      duplicateCard(btn.getAttribute('data-id'));
    });
  });

  wrapper.querySelectorAll('button[data-action="toggle-group"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      if (cardsGroupOpen.has(id)) {
        cardsGroupOpen.delete(id);
      } else {
        cardsGroupOpen.add(id);
      }
      renderCardsTable();
    });
  });

  wrapper.querySelectorAll('button[data-action="copy-group"]').forEach(btn => {
    btn.addEventListener('click', () => duplicateGroup(btn.getAttribute('data-id')));
  });

  wrapper.querySelectorAll('button[data-action="delete-group"]').forEach(btn => {
    btn.addEventListener('click', () => openDeleteConfirm({ type: 'group', id: btn.getAttribute('data-id') }));
  });

  wrapper.querySelectorAll('button[data-action="print-group"]').forEach(btn => {
    btn.addEventListener('click', () => printGroupList(btn.getAttribute('data-id')));
  });

  wrapper.querySelectorAll('button[data-action="print-card"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = cards.find(c => c.id === btn.getAttribute('data-id'));
      if (!card) return;
      printCardView(card);
    });
  });

  wrapper.querySelectorAll('button[data-action="delete-card"]').forEach(btn => {
    btn.addEventListener('click', () => {
      openDeleteConfirm({ type: 'card', id: btn.getAttribute('data-id') });
    });
  });

  wrapper.querySelectorAll('.barcode-link').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const card = cards.find(c => c.id === id);
      if (!card) return;
      openBarcodeModal(card);
    });
  });

  wrapper.querySelectorAll('button[data-attach-card]').forEach(btn => {
    btn.addEventListener('click', () => {
      openAttachmentsModal(btn.getAttribute('data-attach-card'), 'live');
    });
  });

  applyReadonlyState('cards', 'cards');
}

function buildCardCopy(template, { nameOverride, groupId = null } = {}) {
  const copy = cloneCard(template);
  copy.id = genId('card');
  copy.cardType = template.cardType === 'MKI' ? 'MKI' : 'MK';
  copy.itemName = nameOverride || template.itemName || template.name || '';
  copy.name = copy.itemName || 'Маршрутная карта';
  copy.groupId = groupId;
  copy.isGroup = false;
  copy.status = 'NOT_STARTED';
  copy.archived = false;
  copy.useItemList = Boolean(template.useItemList);
  copy.logs = [];
  copy.createdAt = Date.now();
  copy.initialSnapshot = null;
  copy.attachments = (copy.attachments || []).map(file => ({
    ...file,
    id: genId('file'),
    createdAt: Date.now()
  }));
  copy.operations = (copy.operations || []).map((op) => ({
    ...op,
    id: genId('rop'),
    status: 'NOT_STARTED',
    startedAt: null,
    finishedAt: null,
    elapsedSeconds: 0,
    actualSeconds: null,
    comment: '',
    goodCount: 0,
    scrapCount: 0,
    holdCount: 0,
    items: Array.isArray(op.items)
      ? op.items.map(item => ({
        ...item,
        id: genId('item'),
        goodCount: 0,
        scrapCount: 0,
        holdCount: 0,
        quantity: toSafeCount(item.quantity || 0) || 1
      }))
      : [],
    order: typeof op.order === 'number' ? op.order : undefined
  }));
  renumberAutoCodesForCard(copy);
  return copy;
}

function duplicateCard(cardId) {
  const card = cards.find(c => c.id === cardId);
  if (!card) return;
  const copy = buildCardCopy(card, { nameOverride: (card.name || '') + ' (копия)' });
  copy.barcode = generateUniqueCardCode128();
  recalcCardStatus(copy);
  ensureCardMeta(copy);
  if (!copy.initialSnapshot) {
    const snapshot = cloneCard(copy);
    snapshot.logs = [];
    copy.initialSnapshot = snapshot;
  }
  const oldBarcode = getCardBarcodeValue(card);
  const newBarcode = getCardBarcodeValue(copy);
  recordCardLog(copy, { action: 'Создание копии', object: 'Карта', oldValue: oldBarcode, newValue: newBarcode });
  cards.push(copy);
  saveData();
  renderEverything();
}

function duplicateGroup(groupId, { includeArchivedChildren = false } = {}) {
  const group = cards.find(c => c.id === groupId && isGroupCard(c));
  if (!group) return;
  const children = getGroupChildren(group).filter(c => includeArchivedChildren || !c.archived);
  const usedBarcodes = collectBarcodeSet();
  const newGroup = {
    id: genId('group'),
    isGroup: true,
    name: (group.name || '') + ' (копия)',
    barcode: generateUniqueCardCode128(usedBarcodes),
    orderNo: group.orderNo || '',
    contractNumber: group.contractNumber || '',
    status: 'NOT_STARTED',
    archived: false,
    attachments: (group.attachments || []).map(file => ({
      ...file,
      id: genId('file'),
      createdAt: Date.now()
    })),
    createdAt: Date.now()
  };

  cards.push(newGroup);

  children.forEach((child, idx) => {
    const baseName = child.name ? child.name.replace(/^\d+\.\s*/, '') : group.name || 'Карта';
    const copy = buildCardCopy(child, { nameOverride: (idx + 1) + '. ' + baseName, groupId: newGroup.id });
    copy.barcode = generateUniqueCardCode128(usedBarcodes);
    ensureCardMeta(copy);
    recalcCardStatus(copy);
    cards.push(copy);
  });

  recalcCardStatus(newGroup);
  saveData();
  renderEverything();
  return newGroup;
}

function openGroupTransferModal() {
  const modal = document.getElementById('group-transfer-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
}

function closeGroupTransferModal() {
  const modal = document.getElementById('group-transfer-modal');
  if (!modal) return;
  modal.classList.add('hidden');
}

function archiveCardWithLog(card) {
  if (!card || card.archived) return false;
  recordCardLog(card, { action: 'Архивирование', object: 'Карта', field: 'archived', oldValue: false, newValue: true });
  card.archived = true;
  return true;
}

function deleteGroup(groupId) {
  const group = cards.find(c => c.id === groupId && isGroupCard(c));
  if (!group) return false;
  cards = cards.filter(c => c.id !== groupId && c.groupId !== groupId);
  cardsGroupOpen.delete(groupId);
  return true;
}

function deleteCardById(cardId) {
  const card = cards.find(c => c.id === cardId);
  if (!card) return false;
  const parentId = card.groupId;
  cards = cards.filter(c => c.id !== cardId);
  if (parentId) {
    const parent = cards.find(c => c.id === parentId);
    if (parent) recalcCardStatus(parent);
  }
  return true;
}

function buildDeleteConfirmMessage(context) {
  if (!context || !context.id) return '';
  if (context.type === 'group') {
    const group = cards.find(c => c.id === context.id && isGroupCard(c));
    if (!group) return '';
    const children = group.archived ? getGroupChildren(group) : getActiveGroupChildren(group);
    const groupTitle = formatCardTitle(group) || group.name || getCardBarcodeValue(group) || 'Группа карт';
    const childText = children.length ? ' вместе с ' + children.length + ' вложенными картами' : '';
    return 'Группа «' + groupTitle + '»' + childText + ' будет удалена без возможности восстановления.';
  }

  const card = cards.find(c => c.id === context.id);
  if (!card) return '';
  const cardTitle = formatCardTitle(card) || getCardBarcodeValue(card) || 'Маршрутная карта';
  return 'Карта «' + cardTitle + '» будет удалена без возможности восстановления.';
}

function openDeleteConfirm(context) {
  deleteContext = null;
  const modal = document.getElementById('delete-confirm-modal');
  const messageEl = document.getElementById('delete-confirm-message');
  const hintEl = document.getElementById('delete-confirm-hint');
  if (!modal || !messageEl || !context || !context.id) return;
  const message = buildDeleteConfirmMessage(context);
  if (!message) return;
  deleteContext = context;
  messageEl.textContent = message;
  if (hintEl) {
    hintEl.textContent = 'Нажмите «Удалить», чтобы полностью убрать запись из системы. «Отменить» закроет окно без удаления.';
  }
  modal.classList.remove('hidden');
}

function closeDeleteConfirm() {
  const modal = document.getElementById('delete-confirm-modal');
  deleteContext = null;
  if (modal) modal.classList.add('hidden');
}

function confirmDeletion() {
  if (!deleteContext || !deleteContext.id) {
    closeDeleteConfirm();
    return;
  }

  const { type, id } = deleteContext;
  deleteContext = null;
  let changed = false;

  if (type === 'group') {
    workorderOpenGroups.delete(id);
    const group = cards.find(c => c.id === id && isGroupCard(c));
    if (group) {
      getGroupChildren(group).forEach(child => workorderOpenCards.delete(child.id));
    }
    changed = deleteGroup(id);
  } else {
    workorderOpenCards.delete(id);
    changed = deleteCardById(id);
  }

  closeDeleteConfirm();
  if (changed) {
    saveData();
    renderEverything();
  }
}

function printGroupList(groupId) {
  const group = cards.find(c => c.id === groupId && isGroupCard(c));
  if (!group) return;
  const children = getGroupChildren(group).filter(c => !c.archived);
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write('<html><head><title>Список карт группы</title><style> .print-meta { margin: 12px 0; } .print-meta div { margin: 4px 0; font-size: 14px; } </style></head><body onload="window.print()">');
  win.document.write('<h3>Группа: ' + escapeHtml(group.name || '') + '</h3>');

  if (children.length > 0) {
    const firstCard = children[0];
    win.document.write('<div class="print-meta">');
    win.document.write('<div><strong>Номер / код заказа:</strong> ' + escapeHtml(firstCard.orderNo || '') + '</div>');
    win.document.write('<div><strong>Чертёж / обозначение детали:</strong> ' + escapeHtml(firstCard.drawing || '') + '</div>');
    win.document.write('<div><strong>Материал:</strong> ' + escapeHtml(firstCard.material || '') + '</div>');
    win.document.write('<div><strong>Номер договора:</strong> ' + escapeHtml(firstCard.contractNumber || '') + '</div>');
    win.document.write('<div><strong>Описание:</strong> ' + escapeHtml(firstCard.desc || '') + '</div>');
    win.document.write('</div>');
  }

  win.document.write('<ol>');
  children.forEach(child => {
    win.document.write('<li>' + escapeHtml(child.name || '') + ' — ' + escapeHtml(child.barcode || '') + '</li>');
  });
  win.document.write('</ol>');
  win.document.close();
}

async function openPrintPreview(url) {
  const win = window.open('', '_blank');
  if (!win) {
    alert('Разрешите всплывающие окна для печати.');
    return;
  }

  try {
    const res = await fetch(url, { credentials: 'include' });
    if (res.status === 401) {
      handleUnauthorized('Сессия истекла, войдите снова');
      throw new Error('Требуется авторизация');
    }
    if (!res.ok) {
      throw new Error('Ответ сервера ' + res.status);
    }
    const html = await res.text();
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
  } catch (err) {
    win.close();
    alert('Не удалось открыть печатную форму: ' + (err.message || err));
  }
}

function openGroupModal() {
  const modal = document.getElementById('group-modal');
  if (!modal || !activeCardDraft) return;
  const nameInput = document.getElementById('group-name');
  const qtyInput = document.getElementById('group-qty');
  if (nameInput) nameInput.value = activeCardDraft.name || '';
  if (qtyInput) qtyInput.value = activeCardDraft.quantity || 2;
  modal.classList.remove('hidden');
}

function closeGroupModal() {
  const modal = document.getElementById('group-modal');
  if (modal) modal.classList.add('hidden');
}

function createGroupFromDraft() {
  if (!activeCardDraft) return;
  ensureCardMeta(activeCardDraft, { skipSnapshot: true });
  const mkiConflict = validateMkiRouteCardNumber(activeCardDraft, cards);
  if (mkiConflict) {
    alert(mkiConflict);
    return;
  }
  const nameInput = document.getElementById('group-name');
  const qtyInput = document.getElementById('group-qty');
  const groupName = nameInput ? nameInput.value.trim() : '';
  const qty = qtyInput ? Math.max(1, toSafeCount(qtyInput.value)) : 1;
  const baseName = activeCardDraft.name || 'МК';
  const finalGroupName = groupName || baseName;
  const usedBarcodes = collectBarcodeSet();

  const newGroup = {
    id: genId('group'),
    isGroup: true,
    name: finalGroupName,
    barcode: generateUniqueCardCode128(usedBarcodes),
    orderNo: activeCardDraft.orderNo || '',
    contractNumber: activeCardDraft.contractNumber || '',
    cardType: activeCardDraft.cardType === 'MKI' ? 'MKI' : 'MK',
    status: 'NOT_STARTED',
    archived: false,
    attachments: [],
    createdAt: Date.now()
  };

  cards.push(newGroup);

  for (let i = 0; i < qty; i++) {
    const child = buildCardCopy(activeCardDraft, { nameOverride: (i + 1) + '. ' + baseName, groupId: newGroup.id });
    child.barcode = generateUniqueCardCode128(usedBarcodes);
    recalcCardStatus(child);
    ensureCardMeta(child);
    cards.push(child);
  }

  recalcCardStatus(newGroup);
  saveData();
  closeGroupModal();
  closeCardModal();
  renderEverything();
}

function createEmptyCardDraft(cardType = 'MK') {
  const normalizedType = cardType === 'MKI' ? 'MKI' : 'MK';
  const defaultName = normalizedType === 'MKI' ? 'Новая МКИ' : 'Новая карта';
  return {
    id: genId('card'),
    barcode: generateUniqueCardCode128(),
    cardType: normalizedType,
    name: defaultName,
    itemName: defaultName,
    routeCardNumber: '',
    documentDesignation: '',
    documentDate: getCurrentDateString(),
    issuedBySurname: '',
    programName: '',
    labRequestNumber: '',
    workBasis: '',
    supplyState: '',
    itemDesignation: '',
    supplyStandard: '',
    mainMaterials: '',
    mainMaterialGrade: '',
    batchSize: '',
    itemSerials: normalizedType === 'MKI' ? [] : '',
    specialNotes: '',
    quantity: '',
    sampleCount: '',
    sampleSerials: [],
    useItemList: false,
    drawing: '',
    material: '',
    contractNumber: '',
    orderNo: '',
    desc: '',
    responsibleProductionChief: '',
    responsibleSKKChief: '',
    responsibleTechLead: '',
    status: 'NOT_STARTED',
    archived: false,
    createdAt: Date.now(),
    logs: [],
    initialSnapshot: null,
    attachments: [],
    operations: []
  };
}

function cardSectionLabel(sectionKey) {
  const labels = {
    main: 'Основная информация',
    operations: 'Операции',
    add: 'Добавление операций'
  };
  return labels[sectionKey] || labels.main;
}

function updateCardSectionsVisibility() {
  // Override: Always show all sections inside tabs
  const sections = document.querySelectorAll('.card-section');
  sections.forEach(section => {
    section.classList.add('active');
    section.hidden = false;
  });
}

window.openTab = function(evt, tabName) {
    var i, tabcontent, tablinks;
    tabcontent = document.getElementsByClassName("tab-pane");
    for (i = 0; i < tabcontent.length; i++) {
        tabcontent[i].classList.remove("active");
    }
    tablinks = document.getElementsByClassName("tab-btn");
    for (i = 0; i < tablinks.length; i++) {
        tablinks[i].classList.remove("active");
    }
    const target = document.getElementById(tabName);
    if (target) target.classList.add("active");
    
    if (evt) {
        evt.currentTarget.classList.add("active");
    } else {
        const btn = Array.from(tablinks).find(b => b.getAttribute('onclick') && b.getAttribute('onclick').includes(`'${tabName}'`));
        if (btn) btn.classList.add("active");
    }
};

function updateCardSectionMenuItems() {
  const menu = document.getElementById('card-section-menu');
  if (!menu) return;
  menu.querySelectorAll('.card-section-menu-item[data-section-target]').forEach(item => {
    const key = item.getAttribute('data-section-target');
    const shouldHide = key === cardActiveSectionKey;
    item.classList.toggle('hidden', shouldHide);
    item.setAttribute('aria-hidden', shouldHide ? 'true' : 'false');
    item.tabIndex = shouldHide ? -1 : 0;
  });
}

function setActiveCardSection(sectionKey = 'main') {
  cardActiveSectionKey = sectionKey;
  const labelEl = document.getElementById('card-mobile-active-label');
  if (labelEl) {
    labelEl.textContent = cardSectionLabel(cardActiveSectionKey);
  }
  updateCardSectionMenuItems();
  updateCardSectionsVisibility();
}

function closeCardSectionMenu() {
  const toggle = document.getElementById('card-section-menu-toggle');
  const menu = document.getElementById('card-section-menu');
  if (menu) menu.classList.remove('open');
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
}

function setupCardSectionMenu() {
  const toggle = document.getElementById('card-section-menu-toggle');
  const menu = document.getElementById('card-section-menu');
  if (!toggle || !menu) return;

  toggle.addEventListener('click', () => {
    const isOpen = menu.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(isOpen));
  });

  menu.addEventListener('click', e => {
    const target = e.target.closest('button');
    if (!target) return;
    const sectionKey = target.getAttribute('data-section-target');
    const actionTarget = target.getAttribute('data-action-target');
    if (sectionKey) {
      setActiveCardSection(sectionKey);
      closeCardSectionMenu();
      return;
    }
    if (actionTarget) {
      const btn = document.getElementById(actionTarget);
      if (btn) btn.click();
      closeCardSectionMenu();
    }
  });

  window.addEventListener('resize', () => updateCardSectionsVisibility());
}

function openCardModal(cardId, options = {}) {
  const { fromRestore = false, cardType = 'MK', pageMode = false } = options;
  const modal = document.getElementById('card-modal');
  if (!modal) return;
  closeImdxImportModal();
  closeImdxMissingModal();
  resetImdxImportState();
  focusCardsSection();
  activeCardOriginalId = cardId || null;
  if (cardId) {
    const card = cards.find(c => c.id === cardId);
    if (!card) return;
    activeCardDraft = cloneCard(card);
    activeCardIsNew = false;
  } else {
    activeCardDraft = createEmptyCardDraft(cardType);
    activeCardIsNew = true;
  }
  const isMki = activeCardDraft.cardType === 'MKI';
  modal.classList.toggle('is-mki', isMki);
  document.body.classList.toggle('is-mki', isMki);
  ensureCardMeta(activeCardDraft, { skipSnapshot: activeCardIsNew });
  if (activeCardIsNew) {
    activeCardDraft.documentDate = getCurrentDateString();
    if (!activeCardDraft.issuedBySurname) {
      activeCardDraft.issuedBySurname = getSurnameFromUser(currentUser);
    }
  }
  const cardTypeLabel = activeCardDraft.cardType === 'MKI' ? 'МКИ' : 'МК';
  document.getElementById('card-modal-title').textContent = activeCardIsNew
    ? 'Создание ' + cardTypeLabel
    : 'Редактирование ' + cardTypeLabel;
  document.getElementById('card-id').value = activeCardDraft.id;
  document.getElementById('card-route-number').value = activeCardDraft.routeCardNumber || '';
  document.getElementById('card-document-designation').value = activeCardDraft.documentDesignation || '';
  document.getElementById('card-date').value = activeCardDraft.documentDate || '';
  document.getElementById('card-issued-by').value = activeCardDraft.issuedBySurname || '';
  document.getElementById('card-program-name').value = activeCardDraft.programName || '';
  document.getElementById('card-lab-request').value = activeCardDraft.labRequestNumber || '';
  document.getElementById('card-work-basis').value = activeCardDraft.workBasis || '';
  document.getElementById('card-supply-state').value = activeCardDraft.supplyState || '';
  document.getElementById('card-item-designation').value = activeCardDraft.itemDesignation || '';
  document.getElementById('card-supply-standard').value = activeCardDraft.supplyStandard || '';
  document.getElementById('card-name').value = activeCardDraft.name || '';
  document.getElementById('card-main-materials').value = activeCardDraft.mainMaterials || '';
  document.getElementById('card-material').value = activeCardDraft.mainMaterialGrade || '';
  document.getElementById('card-qty').value = activeCardDraft.quantity != null ? activeCardDraft.quantity : '';
  const serialsTextarea = document.getElementById('card-item-serials');
  if (serialsTextarea) {
    const serialValue = Array.isArray(activeCardDraft.itemSerials)
      ? activeCardDraft.itemSerials.join('\n')
      : (activeCardDraft.itemSerials || '');
    serialsTextarea.value = serialValue;
  }
  const sampleQtyInput = document.getElementById('card-sample-qty');
  if (sampleQtyInput) {
    sampleQtyInput.value = activeCardDraft.sampleCount != null ? activeCardDraft.sampleCount : '';
  }
  document.getElementById('card-production-chief').value = activeCardDraft.responsibleProductionChief || '';
  document.getElementById('card-skk-chief').value = activeCardDraft.responsibleSKKChief || '';
  document.getElementById('card-tech-lead').value = activeCardDraft.responsibleTechLead || '';
  const useItemsCheckbox = document.getElementById('card-use-items');
  if (useItemsCheckbox) {
    useItemsCheckbox.checked = Boolean(activeCardDraft.useItemList);
    const label = useItemsCheckbox.closest('.toggle-row');
    if (label) {
        if (activeCardDraft.cardType === 'MKI') {
            label.classList.add('hidden');
        } else {
            label.classList.remove('hidden');
        }
    }
  }
  document.getElementById('card-desc').value = activeCardDraft.specialNotes || '';
  document.getElementById('card-status-text').textContent = cardStatusText(activeCardDraft);
  const attachBtn = document.getElementById('card-attachments-btn');
  if (attachBtn) {
    attachBtn.innerHTML = '📎 Файлы (' + (activeCardDraft.attachments ? activeCardDraft.attachments.length : 0) + ')';
  }
  const routeCodeInput = document.getElementById('route-op-code');
  if (routeCodeInput) routeCodeInput.value = '';
  const routeOpInput = document.getElementById('route-op');
  if (routeOpInput) routeOpInput.value = '';
  const routeCenterInput = document.getElementById('route-center');
  if (routeCenterInput) routeCenterInput.value = '';
  const routeQtyInput = document.getElementById('route-qty');
  routeQtyManual = false;
  if (routeQtyInput) routeQtyInput.value = activeCardDraft.quantity !== '' ? activeCardDraft.quantity : '';
  const routeSamplesToggle = document.getElementById('route-samples-toggle');
  if (routeSamplesToggle) routeSamplesToggle.checked = false;
  updateCardMainSummary();
  setCardMainCollapsed(false);
  renderRouteTableDraft();
  fillRouteSelectors();
  setProductsLayoutMode(activeCardDraft.cardType);
  renderMkiSerialTables();
  if (activeCardDraft.cardType === 'MKI') {
    applyMkiProductsGridLayout();
  } else {
    restoreProductsLayout();
  }
  updateRouteFormQuantityUI();
  if (typeof window.openTab === 'function') {
    window.openTab(null, 'tab-main');
  }
  // setActiveCardSection('main'); // Disabled in favor of tabs
  closeCardSectionMenu();
  modal.classList.remove('hidden');
  if (pageMode) {
    modal.classList.add('page-mode');
    document.body.classList.add('page-card-mode');
  } else {
    modal.classList.remove('page-mode');
    document.body.classList.remove('page-card-mode');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setModalState({ type: 'card', cardId: activeCardDraft ? activeCardDraft.id : null }, { fromRestore });
  }
}

function closeCardModal(silent = false) {
  const modal = document.getElementById('card-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('is-mki');
  document.body.classList.remove('is-mki');
  document.getElementById('card-form').reset();
  document.getElementById('route-form').reset();
  document.getElementById('route-table-wrapper').innerHTML = '';
  setCardMainCollapsed(false);
  closeImdxImportModal();
  closeImdxMissingModal();
  resetImdxImportState();
  activeCardDraft = null;
  activeCardOriginalId = null;
  activeCardIsNew = false;
  routeQtyManual = false;
  focusCardsSection();
  if (modal.classList.contains('page-mode')) {
    modal.classList.remove('page-mode');
    document.body.classList.remove('page-card-mode');
    return;
  }
  if (silent || restoringState) return;
  if (appState.modal && appState.modal.type === 'card') {
    history.back();
  } else {
    setModalState(null, { replace: true });
  }
}

async function saveCardDraft(options = {}) {
  if (!activeCardDraft) return null;
  const { closeModal = true, keepDraftOpen = false, skipRender = false } = options;
  const draft = cloneCard(activeCardDraft);
  draft.useItemList = Boolean(draft.useItemList);
  draft.operations = (draft.operations || []).map((op, idx) => ({
    ...op,
    order: typeof op.order === 'number' ? op.order : idx + 1,
    goodCount: toSafeCount(op.goodCount || 0),
    scrapCount: toSafeCount(op.scrapCount || 0),
    holdCount: toSafeCount(op.holdCount || 0),
    isSamples: draft.cardType === 'MKI' ? Boolean(op.isSamples) : false,
    quantity: getOperationQuantity(op, draft),
    autoCode: Boolean(op.autoCode),
    additionalExecutors: Array.isArray(op.additionalExecutors) ? op.additionalExecutors.slice(0, 2) : [],
    items: Array.isArray(op.items)
      ? op.items.map(item => ({
        id: item.id || genId('item'),
        name: typeof item.name === 'string' ? item.name : '',
        quantity: 1,
        goodCount: toSafeCount(item.goodCount || 0),
        scrapCount: toSafeCount(item.scrapCount || 0),
        holdCount: toSafeCount(item.holdCount || 0)
      }))
      : []
  }));
  renumberAutoCodesForCard(draft);
  recalcCardStatus(draft);
  ensureCardMeta(draft, { skipSnapshot: true });

  const mkiValidationError = validateMkiDraftConstraints(draft);
  if (mkiValidationError) {
    alert(mkiValidationError);
    return null;
  }

  const mkiConflictError = validateMkiRouteCardNumber(draft, cards);
  if (mkiConflictError) {
    alert(mkiConflictError);
    return null;
  }

  if (activeCardIsNew || activeCardOriginalId == null) {
    ensureCardMeta(draft);
    if (!draft.initialSnapshot) {
      const snapshot = cloneCard(draft);
      snapshot.logs = [];
      draft.initialSnapshot = snapshot;
    }
    recordCardLog(draft, { action: 'Создание МК', object: 'Карта', oldValue: '', newValue: draft.name || draft.barcode });
    cards.push(draft);
  } else {
    const idx = cards.findIndex(c => c.id === activeCardOriginalId);
    if (idx >= 0) {
      const original = cloneCard(cards[idx]);
      ensureCardMeta(original);
      ensureCardMeta(draft);
      draft.createdAt = original.createdAt || draft.createdAt;
      draft.initialSnapshot = original.initialSnapshot || draft.initialSnapshot;
      draft.logs = Array.isArray(original.logs) ? original.logs : [];
      logCardDifferences(original, draft);
      cards[idx] = draft;
    }
  }

  activeCardIsNew = false;
  activeCardOriginalId = draft.id;

  ensureUniqueBarcodes(cards);
  const savePromise = saveData();
  if (!skipRender) {
    renderEverything();
  }
  if (closeModal) {
    closeCardModal();
  } else if (keepDraftOpen) {
    activeCardDraft = cloneCard(draft);
    document.getElementById('card-status-text').textContent = cardStatusText(activeCardDraft);
    updateCardMainSummary();
  }

  await savePromise;
  return draft;
}

function syncCardDraftFromForm() {
  if (!activeCardDraft) return;
  activeCardDraft.routeCardNumber = document.getElementById('card-route-number').value.trim();
  activeCardDraft.documentDesignation = document.getElementById('card-document-designation').value.trim();
  activeCardDraft.documentDate = formatDateInputValue(document.getElementById('card-date').value.trim());
  activeCardDraft.issuedBySurname = document.getElementById('card-issued-by').value.trim();
  activeCardDraft.programName = document.getElementById('card-program-name').value.trim();
  activeCardDraft.labRequestNumber = document.getElementById('card-lab-request').value.trim();
  activeCardDraft.workBasis = document.getElementById('card-work-basis').value.trim();
  activeCardDraft.supplyState = document.getElementById('card-supply-state').value.trim();
  activeCardDraft.itemDesignation = document.getElementById('card-item-designation').value.trim();
  activeCardDraft.supplyStandard = document.getElementById('card-supply-standard').value.trim();
  activeCardDraft.itemName = document.getElementById('card-name').value.trim();
  activeCardDraft.name = activeCardDraft.itemName;
  activeCardDraft.mainMaterials = document.getElementById('card-main-materials').value.trim();
  activeCardDraft.mainMaterialGrade = document.getElementById('card-material').value.trim();
  const qtyRaw = document.getElementById('card-qty').value.trim();
  const qtyVal = qtyRaw === '' ? '' : Math.max(0, parseInt(qtyRaw, 10) || 0);
  activeCardDraft.quantity = Number.isFinite(qtyVal) ? qtyVal : '';
  activeCardDraft.batchSize = activeCardDraft.quantity;
  if (activeCardDraft.cardType === 'MKI') {
    const sampleRaw = document.getElementById('card-sample-qty').value.trim();
    const sampleVal = sampleRaw === '' ? '' : Math.max(0, parseInt(sampleRaw, 10) || 0);
    activeCardDraft.sampleCount = Number.isFinite(sampleVal) ? sampleVal : '';

    activeCardDraft.itemSerials = collectSerialValuesFromTable('card-item-serials-table');
    activeCardDraft.sampleSerials = collectSerialValuesFromTable('card-sample-serials-table');
    const normalizedItems = normalizeSerialInput(activeCardDraft.itemSerials);
    const normalizedSamples = normalizeSerialInput(activeCardDraft.sampleSerials);
    const qtyCount = activeCardDraft.quantity === '' ? 0 : toSafeCount(activeCardDraft.quantity);
    const sampleCount = activeCardDraft.sampleCount === '' ? 0 : toSafeCount(activeCardDraft.sampleCount);
    activeCardDraft.itemSerials = resizeSerialList(normalizedItems, qtyCount, { fillDefaults: true });
    activeCardDraft.sampleSerials = resizeSerialList(normalizedSamples, sampleCount, { fillDefaults: true });
  } else {
    activeCardDraft.itemSerials = document.getElementById('card-item-serials').value.trim();
    activeCardDraft.sampleCount = '';
    activeCardDraft.sampleSerials = [];
  }
  activeCardDraft.specialNotes = document.getElementById('card-desc').value.trim();
  activeCardDraft.desc = activeCardDraft.specialNotes;
  activeCardDraft.responsibleProductionChief = document.getElementById('card-production-chief').value.trim();
  activeCardDraft.responsibleSKKChief = document.getElementById('card-skk-chief').value.trim();
  activeCardDraft.responsibleTechLead = document.getElementById('card-tech-lead').value.trim();
  const useItemsCheckbox = document.getElementById('card-use-items');
  const prevUseList = Boolean(activeCardDraft.useItemList);
  activeCardDraft.useItemList = useItemsCheckbox ? useItemsCheckbox.checked : false;
  if (prevUseList !== activeCardDraft.useItemList && Array.isArray(activeCardDraft.operations)) {
    activeCardDraft.operations.forEach(op => normalizeOperationItems(activeCardDraft, op));
  }
}

function collectSerialValuesFromTable(tableId) {
  const table = document.getElementById(tableId);
  if (!table) return [];
  return Array.from(table.querySelectorAll('.serials-input')).map(input => input.value || '');
}

function renderSerialsTable(tableId, values = []) {
  const rows = (values || []).map((val, idx) => {
    return '<tr>' +
      '<td class="serials-index-cell">' + (idx + 1) + '.</td>' +
      '<td class="serials-input-cell">' +
        '<input class="serials-input" data-index="' + idx + '" value="' + escapeHtml(val || '') + '" placeholder="Без номера ' + (idx + 1) + '">' +
      '</td>' +
    '</tr>';
  }).join('');
  return '<table id="' + tableId + '" class="serials-table"><tbody>' + rows + '</tbody></table>';
}

function setProductsLayoutMode(cardType) {
  const isMki = cardType === 'MKI';
  const tab = document.getElementById('tab-products');
  if (tab) tab.classList.toggle('mki-mode', isMki);
  const serialsTableWrapper = document.getElementById('card-item-serials-table-wrapper');
  if (serialsTableWrapper) serialsTableWrapper.classList.toggle('hidden', !isMki);
  const serialsTextarea = document.getElementById('card-item-serials');
  if (serialsTextarea) serialsTextarea.classList.toggle('hidden', isMki);
  const sampleQtyField = document.getElementById('field-sample-qty');
  if (sampleQtyField) sampleQtyField.classList.toggle('hidden', !isMki);
  const sampleSerialsField = document.getElementById('field-sample-serials');
  if (sampleSerialsField) sampleSerialsField.classList.toggle('hidden', !isMki);
}

function getActiveCardSampleAvailability() {
  const isMki = activeCardDraft && activeCardDraft.cardType === 'MKI';
  const sampleCount = isMki ? toSafeCount(activeCardDraft.sampleCount || 0) : 0;
  return { isMki, sampleCount, hasSamples: isMki && sampleCount > 0 };
}

function updateRouteFormQuantityUI() {
  const qtyLabel = document.getElementById('route-qty-label');
  const qtyInput = document.getElementById('route-qty');
  const samplesCol = document.getElementById('route-samples-col');
  const samplesToggle = document.getElementById('route-samples-toggle');
  const samplesHint = document.getElementById('route-samples-hint');
  const { isMki, hasSamples } = getActiveCardSampleAvailability();

  if (samplesCol) samplesCol.classList.toggle('hidden', !isMki);
  if (samplesToggle) {
    if (!hasSamples) samplesToggle.checked = false;
    samplesToggle.disabled = !hasSamples;
  }
  if (samplesHint) {
    samplesHint.textContent = isMki && !hasSamples
      ? 'Операции по образцам недоступны при нулевом количестве образцов'
      : '';
  }

  if (!qtyLabel || !qtyInput) return;
  const isSamplesMode = Boolean(samplesToggle && samplesToggle.checked);
  if (isMki) {
    qtyLabel.textContent = isSamplesMode ? 'Кол-во образцов' : 'Кол-во изделий';
    const value = isSamplesMode
      ? (activeCardDraft && activeCardDraft.sampleCount !== '' ? activeCardDraft.sampleCount : '')
      : (activeCardDraft && activeCardDraft.quantity !== '' ? activeCardDraft.quantity : '');
    qtyInput.value = value;
    qtyInput.readOnly = true;
    routeQtyManual = false;
  } else {
    qtyLabel.textContent = 'Количество изделий';
    qtyInput.readOnly = false;
    if (activeCardDraft) {
      qtyInput.value = activeCardDraft.quantity !== '' ? activeCardDraft.quantity : '';
    }
  }
}

let originalProductsLayout = null;
let originalProductsLayoutChildren = null;

function getProductsLayoutBlockByLabel(tab, labelText) {
  const labels = Array.from(tab.querySelectorAll('label')).filter(lbl => lbl.textContent && lbl.textContent.trim() === labelText);
  for (const label of labels) {
    const productField = label.closest('.product-field');
    if (productField) return productField;
    const flexCol = label.closest('.flex-col');
    if (flexCol) return flexCol;
  }
  return null;
}

function ensureOriginalProductsLayoutCached() {
  if (originalProductsLayout) return;
  const layout = document.getElementById('products-layout');
  if (layout) {
    originalProductsLayout = layout;
    originalProductsLayoutChildren = Array.from(layout.children);
  }
}

function applyMkiProductsGridLayout() {
  if (!activeCardDraft || activeCardDraft.cardType !== 'MKI') return;
  const tab = document.getElementById('tab-products');
  if (!tab) return;
  ensureOriginalProductsLayoutCached();
  const existingGrid = tab.querySelector('.mki-products-grid');
  if (existingGrid) return;

  const batchBlock = getProductsLayoutBlockByLabel(tab, 'Размер партии');
  const sampleQtyBlock = getProductsLayoutBlockByLabel(tab, 'Количество образцов');
  const itemSerialsBlock = getProductsLayoutBlockByLabel(tab, 'Индивидуальные номера изделий');
  const sampleSerialsBlock = getProductsLayoutBlockByLabel(tab, 'Индивидуальные номера образцов');

  const grid = document.createElement('div');
  grid.className = 'mki-products-grid';

  const cells = [
    { className: 'mki-products-cell mki-products-cell--left-top', block: batchBlock },
    { className: 'mki-products-cell mki-products-cell--right-top', block: sampleQtyBlock },
    { className: 'mki-products-cell mki-products-cell--left-bottom', block: itemSerialsBlock },
    { className: 'mki-products-cell mki-products-cell--right-bottom', block: sampleSerialsBlock },
  ];

  cells.forEach(cellConfig => {
    const cell = document.createElement('div');
    cell.className = cellConfig.className;
    if (cellConfig.block) {
      cell.appendChild(cellConfig.block);
    }
    grid.appendChild(cell);
  });

  tab.innerHTML = '';
  tab.appendChild(grid);
}

function restoreProductsLayout() {
  ensureOriginalProductsLayoutCached();
  const tab = document.getElementById('tab-products');
  if (!tab || !originalProductsLayout) return;
  const isAlreadyDefault = tab.contains(originalProductsLayout) && !tab.querySelector('.mki-products-grid');
  if (isAlreadyDefault) return;

  if (Array.isArray(originalProductsLayoutChildren)) {
    originalProductsLayoutChildren.forEach(child => {
      if (child && child.parentElement !== originalProductsLayout) {
        originalProductsLayout.appendChild(child);
      }
    });
  }

  tab.innerHTML = '';
  tab.appendChild(originalProductsLayout);
}

function renderMkiSerialTables() {
  if (!activeCardDraft || activeCardDraft.cardType !== 'MKI') return;
  const qty = activeCardDraft.quantity === '' ? 0 : toSafeCount(activeCardDraft.quantity);
  const normalizedItems = normalizeSerialInput(activeCardDraft.itemSerials);
  activeCardDraft.itemSerials = resizeSerialList(normalizedItems, qty, { fillDefaults: true });
  const itemWrapper = document.getElementById('card-item-serials-table-wrapper');
  if (itemWrapper) {
    itemWrapper.innerHTML = renderSerialsTable('card-item-serials-table', activeCardDraft.itemSerials);
  }

  const sampleCount = activeCardDraft.sampleCount === '' ? 0 : toSafeCount(activeCardDraft.sampleCount);
  const normalizedSamples = normalizeSerialInput(activeCardDraft.sampleSerials);
  activeCardDraft.sampleSerials = resizeSerialList(normalizedSamples, sampleCount, { fillDefaults: true });
  const sampleField = document.getElementById('field-sample-serials');
  if (sampleField) sampleField.classList.toggle('hidden', sampleCount === 0);
  const sampleWrapper = document.getElementById('card-sample-serials-table-wrapper');
  if (sampleWrapper) {
    sampleWrapper.innerHTML = sampleCount > 0
      ? renderSerialsTable('card-sample-serials-table', activeCardDraft.sampleSerials)
      : '';
  }
}

function logCardDifferences(original, updated) {
  if (!original || !updated) return;
  const cardRef = updated;
  const fields = [
    'itemName',
    'routeCardNumber',
    'documentDesignation',
    'documentDate',
    'issuedBySurname',
    'programName',
    'labRequestNumber',
    'workBasis',
    'supplyState',
    'itemDesignation',
    'supplyStandard',
    'mainMaterials',
    'mainMaterialGrade',
    'batchSize',
    'itemSerials',
    'sampleCount',
    'sampleSerials',
    'specialNotes',
    'responsibleProductionChief',
    'responsibleSKKChief',
    'responsibleTechLead',
    'useItemList'
  ];
  fields.forEach(field => {
    if ((original[field] || '') !== (updated[field] || '')) {
      recordCardLog(cardRef, { action: 'Изменение поля', object: 'Карта', field, oldValue: original[field] || '', newValue: updated[field] || '' });
    }
  });

  if (original.status !== updated.status) {
    recordCardLog(cardRef, { action: 'Статус карты', object: 'Карта', field: 'status', oldValue: original.status, newValue: updated.status });
  }

  if (original.archived !== updated.archived) {
    recordCardLog(cardRef, { action: 'Архивирование', object: 'Карта', field: 'archived', oldValue: original.archived, newValue: updated.archived });
  }

  const originalAttachments = Array.isArray(original.attachments) ? original.attachments.length : 0;
  const updatedAttachments = Array.isArray(updated.attachments) ? updated.attachments.length : 0;
  if (originalAttachments !== updatedAttachments) {
    recordCardLog(cardRef, { action: 'Файлы', object: 'Карта', field: 'attachments', oldValue: originalAttachments, newValue: updatedAttachments });
  }

  const originalOps = Array.isArray(original.operations) ? original.operations : [];
  const updatedOps = Array.isArray(updated.operations) ? updated.operations : [];
  const originalMap = new Map(originalOps.map(op => [op.id, op]));
  const updatedMap = new Map(updatedOps.map(op => [op.id, op]));

  updatedOps.forEach(op => {
    const prev = originalMap.get(op.id);
    if (!prev) {
      recordCardLog(cardRef, { action: 'Добавление операции', object: opLogLabel(op), targetId: op.id, oldValue: '', newValue: `${op.centerName || ''} / ${op.executor || ''}`.trim() });
      return;
    }

    if ((prev.centerName || '') !== (op.centerName || '')) {
      recordCardLog(cardRef, { action: 'Изменение операции', object: opLogLabel(op), field: 'centerName', targetId: op.id, oldValue: prev.centerName || '', newValue: op.centerName || '' });
    }
    if ((prev.opCode || '') !== (op.opCode || '') || (prev.opName || '') !== (op.opName || '')) {
      recordCardLog(cardRef, { action: 'Изменение операции', object: opLogLabel(op), field: 'operation', targetId: op.id, oldValue: opLogLabel(prev), newValue: opLogLabel(op) });
    }
    if ((prev.executor || '') !== (op.executor || '')) {
      recordCardLog(cardRef, { action: 'Исполнитель', object: opLogLabel(op), field: 'executor', targetId: op.id, oldValue: prev.executor || '', newValue: op.executor || '' });
    }
    if ((prev.plannedMinutes || 0) !== (op.plannedMinutes || 0)) {
      recordCardLog(cardRef, { action: 'Плановое время', object: opLogLabel(op), field: 'plannedMinutes', targetId: op.id, oldValue: prev.plannedMinutes || 0, newValue: op.plannedMinutes || 0 });
    }
    if ((prev.order || 0) !== (op.order || 0)) {
      recordCardLog(cardRef, { action: 'Порядок операции', object: opLogLabel(op), field: 'order', targetId: op.id, oldValue: prev.order || 0, newValue: op.order || 0 });
    }
  });

  originalOps.forEach(op => {
    if (!updatedMap.has(op.id)) {
      recordCardLog(cardRef, { action: 'Удаление операции', object: opLogLabel(op), targetId: op.id, oldValue: `${op.centerName || ''} / ${op.executor || ''}`.trim(), newValue: '' });
    }
  });
}

function getAttachmentTargetCard() {
  if (!attachmentContext) return null;
  if (attachmentContext.source === 'draft') {
    return activeCardDraft;
  }
  return cards.find(c => c.id === attachmentContext.cardId);
}

function renderAttachmentsModal() {
  const modal = document.getElementById('attachments-modal');
  if (!modal || !attachmentContext) return;
  const card = getAttachmentTargetCard();
  const title = document.getElementById('attachments-title');
  const list = document.getElementById('attachments-list');
  const uploadHint = document.getElementById('attachments-upload-hint');
  if (!card || !list || !title || !uploadHint) return;
  ensureAttachments(card);
  title.textContent = formatCardTitle(card) || getCardBarcodeValue(card) || 'Файлы карты';
  const files = card.attachments || [];
  if (!files.length) {
    list.innerHTML = '<p>Файлы ещё не добавлены.</p>';
  } else {
    let html = '<table class="attachments-table"><thead><tr><th>Имя файла</th><th>Размер</th><th>Дата</th><th>Действия</th></tr></thead><tbody>';
    files.forEach(file => {
      const date = new Date(file.createdAt || Date.now()).toLocaleString();
      html += '<tr>' +
        '<td>' + escapeHtml(file.name || 'файл') + '</td>' +
        '<td>' + escapeHtml(formatBytes(file.size)) + '</td>' +
        '<td>' + escapeHtml(date) + '</td>' +
        '<td><div class="table-actions">' +
        '<button class="btn-small" data-preview-id="' + file.id + '">Открыть</button>' +
        '<button class="btn-small" data-download-id="' + file.id + '">Скачать</button>' +
        '<button class="btn-small btn-danger" data-delete-id="' + file.id + '">Удалить</button>' +
        '</div></td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    list.innerHTML = wrapTable(html);
  }
  uploadHint.textContent = 'Допустимые форматы: pdf, doc, jpg, архив. Максимум ' + formatBytes(ATTACH_MAX_SIZE) + '.';

  list.querySelectorAll('button[data-preview-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-preview-id');
      const cardRef = getAttachmentTargetCard();
      if (!cardRef) return;
      const file = (cardRef.attachments || []).find(f => f.id === id);
      if (!file) return;
      previewAttachment(file);
    });
  });

  list.querySelectorAll('button[data-download-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-download-id');
      const cardRef = getAttachmentTargetCard();
      if (!cardRef) return;
      const file = (cardRef.attachments || []).find(f => f.id === id);
      if (!file) return;
      downloadAttachment(file);
    });
  });

  list.querySelectorAll('button[data-delete-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-delete-id');
      deleteAttachment(id);
    });
  });
}

function downloadAttachment(file) {
  if (!file) return;
  if (file.content) {
    const blob = dataUrlToBlob(file.content, file.type);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = file.name || 'file';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
    return;
  }
  if (file.id) {
    window.open('/files/' + file.id, '_blank', 'noopener');
  }
}

function previewAttachment(file) {
  if (!file) return;
  if (file.content) {
    const blob = dataUrlToBlob(file.content, file.type);
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return;
  }
  if (file.id) {
    window.open('/files/' + file.id, '_blank', 'noopener');
  }
}

async function deleteAttachment(fileId) {
  const card = getAttachmentTargetCard();
  if (!card) return;
  ensureAttachments(card);
  const before = card.attachments.length;
  const idx = card.attachments.findIndex(f => f.id === fileId);
  if (idx < 0) return;
  card.attachments.splice(idx, 1);
  recordCardLog(card, { action: 'Файлы', object: 'Карта', field: 'attachments', oldValue: before, newValue: card.attachments.length });
  if (attachmentContext && attachmentContext.source === 'live') {
    await saveData();
    renderEverything();
  }
  renderAttachmentsModal();
  updateAttachmentCounters(card.id);
}

async function addAttachmentsFromFiles(fileList) {
  const card = getAttachmentTargetCard();
  if (!card || !fileList || !fileList.length) return;
  ensureAttachments(card);
  const beforeCount = card.attachments.length;
  const filesArray = Array.from(fileList);
  const allowed = ATTACH_ACCEPT.split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
  const newFiles = [];

  for (const file of filesArray) {
    const ext = ('.' + (file.name.split('.').pop() || '')).toLowerCase();
    if (allowed.length && !allowed.includes(ext)) {
      alert('Тип файла не поддерживается: ' + file.name);
      continue;
    }
    if (file.size > ATTACH_MAX_SIZE) {
      alert('Файл ' + file.name + ' превышает лимит ' + formatBytes(ATTACH_MAX_SIZE));
      continue;
    }
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    newFiles.push({
      id: genId('file'),
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      content: dataUrl,
      createdAt: Date.now()
    });
  }

  if (newFiles.length) {
    card.attachments.push(...newFiles);
    recordCardLog(card, { action: 'Файлы', object: 'Карта', field: 'attachments', oldValue: beforeCount, newValue: card.attachments.length });
    if (attachmentContext.source === 'live') {
      await saveData();
      renderEverything();
    }
    renderAttachmentsModal();
    updateAttachmentCounters(card.id);
  }
}

function openAttachmentsModal(cardId, source = 'live') {
  const modal = document.getElementById('attachments-modal');
  if (!modal) return;
  const card = source === 'draft' ? activeCardDraft : cards.find(c => c.id === cardId);
  if (!card) return;
  attachmentContext = { cardId: card.id, source };
  renderAttachmentsModal();
  modal.classList.remove('hidden');
}

function closeAttachmentsModal() {
  const modal = document.getElementById('attachments-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  const input = document.getElementById('attachments-input');
  if (input) input.value = '';
  attachmentContext = null;
}

function updateAttachmentCounters(cardId) {
  const count = (() => {
    if (activeCardDraft && activeCardDraft.id === cardId) {
      return (activeCardDraft.attachments || []).length;
    }
    const card = cards.find(c => c.id === cardId);
    return card ? (card.attachments || []).length : 0;
  })();

  const cardBtn = document.getElementById('card-attachments-btn');
  if (cardBtn && activeCardDraft && activeCardDraft.id === cardId) {
    cardBtn.innerHTML = '📎 Файлы (' + count + ')';
  }
}

function openGroupExecutorModal(groupId) {
  const modal = document.getElementById('group-executor-modal');
  const executorInput = document.getElementById('group-executor-input');
  const opCodeInput = document.getElementById('group-op-code-input');
  const group = cards.find(c => c.id === groupId && isGroupCard(c));
  if (!modal || !group) return;
  groupExecutorContext = { groupId };
  if (executorInput) executorInput.value = '';
  if (opCodeInput) opCodeInput.value = '';
  modal.classList.remove('hidden');
  if (executorInput) executorInput.focus();
}

function closeGroupExecutorModal() {
  const modal = document.getElementById('group-executor-modal');
  if (modal) modal.classList.add('hidden');
  groupExecutorContext = null;
}

function applyGroupExecutorToGroup() {
  const executorInput = document.getElementById('group-executor-input');
  const opCodeInput = document.getElementById('group-op-code-input');
  if (!groupExecutorContext) return;

  const rawExecutor = (executorInput ? executorInput.value : '').trim();
  const executor = sanitizeExecutorName(rawExecutor);
  const opCodeRaw = (opCodeInput ? opCodeInput.value : '').trim();
  const group = cards.find(c => c.id === groupExecutorContext.groupId && isGroupCard(c));

  if (!group) {
    closeGroupExecutorModal();
    return;
  }

  if (executor && !isEligibleExecutorName(executor)) {
    alert('Выберите исполнителя со статусом "Рабочий" (пользователь Abyss недоступен).');
    if (executorInput) executorInput.value = '';
    return;
  }

  if (!executor && rawExecutor) {
    alert('Пользователь Abyss недоступен для выбора. Выберите другого исполнителя.');
    if (executorInput) executorInput.value = '';
    return;
  }

  if (!executor || !opCodeRaw) {
    alert('Укажите группового исполнителя и код операции.');
    return;
  }

  const targetCode = opCodeRaw.toUpperCase();
  const children = getGroupChildren(group).filter(c => !c.archived);
  let matched = 0;
  let updated = 0;

  children.forEach(card => {
    (card.operations || []).forEach(op => {
      const opCodeValue = (op.opCode || '').trim().toUpperCase();
      if (opCodeValue !== targetCode) return;
      matched++;
      const prevExecutor = op.executor || '';
      const prevExtras = Array.isArray(op.additionalExecutors) ? [...op.additionalExecutors] : [];
      const extrasChanged = prevExtras.length > 0;
      const executorChanged = prevExecutor !== executor;
      op.executor = executor;
      op.additionalExecutors = [];
      if (executorChanged) {
        recordCardLog(card, { action: 'Исполнитель', object: opLogLabel(op), field: 'executor', targetId: op.id, oldValue: prevExecutor, newValue: executor });
      }
      if (extrasChanged) {
        recordCardLog(card, { action: 'Доп. исполнитель', object: opLogLabel(op), field: 'additionalExecutors', targetId: op.id, oldValue: prevExtras.join(', '), newValue: 'очищено' });
      }
      if (executorChanged || extrasChanged) {
        updated++;
      }
    });
    recalcCardStatus(card);
  });

  recalcCardStatus(group);

  if (!matched) {
    alert('В группе нет операций с указанным кодом.');
    return;
  }

  if (updated) {
    saveData();
    renderDashboard();
  }
  renderWorkordersTable();
  closeGroupExecutorModal();
}

function buildLogHistoryTable(card) {
  const logs = (card.logs || []).slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
  if (!logs.length) return '<p>История изменений пока отсутствует.</p>';
  let html = '<table><thead><tr><th>Дата/время</th><th>Тип действия</th><th>Объект</th><th>Старое значение</th><th>Новое значение</th></tr></thead><tbody>';
  logs.forEach(entry => {
    const date = new Date(entry.ts || Date.now()).toLocaleString();
    html += '<tr>' +
      '<td>' + escapeHtml(date) + '</td>' +
      '<td>' + escapeHtml(entry.action || '') + '</td>' +
      '<td>' + escapeHtml(entry.object || '') + (entry.field ? ' (' + escapeHtml(entry.field) + ')' : '') + '</td>' +
      '<td>' + escapeHtml(entry.oldValue || '') + '</td>' +
      '<td>' + escapeHtml(entry.newValue || '') + '</td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  return html;
}

function buildExecutorHistory(card, op) {
  const entries = (card.logs || [])
    .filter(entry => entry.targetId === op.id && entry.field === 'executor')
    .sort((a, b) => (a.ts || 0) - (b.ts || 0));
  if (!entries.length) {
    return op.executor || '';
  }
  const chain = [];
  entries.forEach((entry, idx) => {
    if (idx === 0 && entry.oldValue) chain.push(entry.oldValue);
    if (entry.newValue) chain.push(entry.newValue);
  });
  if (!chain.length && op.executor) chain.push(op.executor);
  return chain.filter(Boolean).join(' → ');
}

function buildAdditionalExecutorsHistory(card, op) {
  const entries = (card.logs || [])
    .filter(entry => entry.targetId === op.id && entry.field === 'additionalExecutors')
    .sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const lines = [];
  const seen = new Set();

  entries.forEach(entry => {
    const oldVal = (entry.oldValue || '').trim();
    const newVal = (entry.newValue || '').trim();
    const isCountChange = /^\d+$/.test(newVal) && (!oldVal || /^\d+$/.test(oldVal));
    if (isCountChange) return;

    if (oldVal && newVal && newVal !== oldVal && newVal !== 'удален') {
      lines.push(escapeHtml(oldVal) + ' → ' + escapeHtml(newVal));
      seen.add(oldVal);
      seen.add(newVal);
    } else if (!oldVal && newVal && newVal !== 'удален') {
      lines.push(escapeHtml(newVal));
      seen.add(newVal);
    } else if (oldVal && (!newVal || newVal === 'удален')) {
      lines.push(escapeHtml(oldVal) + ' (удален)');
      seen.add(oldVal);
    }
  });

  const currentExtras = Array.isArray(op.additionalExecutors) ? op.additionalExecutors : [];
  currentExtras.forEach(name => {
    const clean = (name || '').trim();
    if (!clean || seen.has(clean)) return;
    lines.push(escapeHtml(clean));
    seen.add(clean);
  });

  return lines.filter(Boolean);
}

function buildExecutorHistoryCell(card, op) {
  const mainHistory = buildExecutorHistory(card, op) || '';
  const extraHistory = buildAdditionalExecutorsHistory(card, op);
  if (!mainHistory && !extraHistory.length) return '';

  let html = '';
  if (mainHistory) {
    html += '<div class="executor-history-main">' + escapeHtml(mainHistory) + '</div>';
  }
  if (extraHistory.length) {
    html += '<div class="executor-history-extras">' +
      extraHistory.map(line => '<div class="executor-history-line">' + line + '</div>').join('') +
      '</div>';
  }
  return html;
}

function buildSummaryTable(card) {
  const opsSorted = [...(card.operations || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  if (!opsSorted.length) return '<p>Маршрут пока пуст.</p>';
  let html = '<table><thead><tr>' +
    '<th>Порядок</th><th>Подразделение</th><th>Код операции</th><th>Наименование операции</th><th>Исполнитель</th><th>План (мин)</th><th>Статус</th><th>Дата и время Н/К</th><th>Текущее / факт. время</th><th>Комментарии</th>' +
    '</tr></thead><tbody>';

  opsSorted.forEach((op, idx) => {
    normalizeOperationItems(card, op);
    op.executor = sanitizeExecutorName(op.executor || '');
      if (Array.isArray(op.additionalExecutors)) {
        op.additionalExecutors = op.additionalExecutors
          .map(name => sanitizeExecutorName(name || ''))
          .slice(0, 3);
      } else {
        op.additionalExecutors = [];
      }
    const rowId = card.id + '::' + op.id;
    const elapsed = getOperationElapsedSeconds(op);
    let timeCell = '';
    if (op.status === 'IN_PROGRESS' || op.status === 'PAUSED') {
      timeCell = '<span class="wo-timer" data-row-id="' + rowId + '">' + formatSecondsToHMS(elapsed) + '</span>';
    } else if (op.status === 'DONE') {
      const seconds = typeof op.elapsedSeconds === 'number' && op.elapsedSeconds
        ? op.elapsedSeconds
        : (op.actualSeconds || 0);
      timeCell = formatSecondsToHMS(seconds);
    }

    const executorCell = buildExecutorHistoryCell(card, op) || escapeHtml(op.executor || '');
    const startEndCell = formatStartEnd(op);

    html += '<tr data-row-id="' + rowId + '">' +
      '<td>' + (idx + 1) + '</td>' +
      '<td>' + escapeHtml(op.centerName) + '</td>' +
      '<td>' + escapeHtml(op.opCode || '') + '</td>' +
      '<td>' + renderOpName(op) + '</td>' +
      '<td>' + executorCell + '</td>' +
      '<td>' + (op.plannedMinutes || '') + '</td>' +
      '<td>' + statusBadge(op.status) + '</td>' +
      '<td>' + startEndCell + '</td>' +
      '<td>' + timeCell + '</td>' +
      '<td>' + escapeHtml(op.comment || '') + '</td>' +
      '</tr>';

    html += renderQuantityRow(card, op, { readonly: true, colspan: 10 });
  });

  html += '</tbody></table>';
  return html;
}

function buildInitialSummaryTable(card) {
  const opsSorted = [...(card.operations || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  if (!opsSorted.length) return '<p>Маршрут пока пуст.</p>';
  let html = '<table><thead><tr>' +
    '<th>Порядок</th><th>Подразделение</th><th>Код операции</th><th>Наименование операции</th><th>Исполнитель</th><th>План (мин)</th>' +
    '</tr></thead><tbody>';

  opsSorted.forEach((op, idx) => {
    normalizeOperationItems(card, op);
    const executorCell = buildExecutorHistoryCell(card, op) || escapeHtml(op.executor || '');

    html += '<tr>' +
      '<td>' + (idx + 1) + '</td>' +
      '<td>' + escapeHtml(op.centerName) + '</td>' +
      '<td>' + escapeHtml(op.opCode || '') + '</td>' +
      '<td>' + renderOpName(op) + '</td>' +
      '<td>' + executorCell + '</td>' +
      '<td>' + (op.plannedMinutes || '') + '</td>' +
      '</tr>';

    html += renderQuantityRow(card, op, { readonly: true, colspan: 6, blankForPrint: true });
  });

  html += '</tbody></table>';
  return html;
}

function buildInitialSnapshotHtml(card) {
  if (!card) return '';
  const snapshot = card.initialSnapshot || card;
  const infoBlock = buildCardInfoBlock(snapshot, { startCollapsed: true });
  const opsHtml = buildInitialSummaryTable(snapshot);
  const wrappedOps = opsHtml.trim().startsWith('<table') ? wrapTable(opsHtml) : opsHtml;
  return infoBlock + wrappedOps;
}

function renderInitialSnapshot(card) {
  const container = document.getElementById('log-initial-view');
  if (!container || !card) return;
  container.innerHTML = buildInitialSnapshotHtml(card);
}

function renderLogModal(cardId) {
  const modal = document.getElementById('log-modal');
  if (!modal) return;
  const card = cards.find(c => c.id === cardId);
  if (!card) return;
  logContextCardId = card.id;
  const barcodeContainer = document.getElementById('log-barcode-svg');
  const barcodeValue = getCardBarcodeValue(card);
  renderBarcodeInto(barcodeContainer, barcodeValue);
  const barcodeNum = document.getElementById('log-barcode-number');
  if (barcodeNum) {
    barcodeNum.textContent = barcodeValue || '(нет номера МК)';
    barcodeNum.classList.toggle('hidden', Boolean(barcodeContainer && barcodeValue));
  }
  const nameEl = document.getElementById('log-card-name');
  if (nameEl) nameEl.textContent = formatCardTitle(card);
  const orderEl = document.getElementById('log-card-order');
  if (orderEl) orderEl.textContent = card.orderNo || '';
  const statusEl = document.getElementById('log-card-status');
  if (statusEl) statusEl.textContent = cardStatusText(card);
  const createdEl = document.getElementById('log-card-created');
  if (createdEl) createdEl.textContent = new Date(card.createdAt || Date.now()).toLocaleString();

  renderInitialSnapshot(card);
  const historyContainer = document.getElementById('log-history-table');
  if (historyContainer) historyContainer.innerHTML = buildLogHistoryTable(card);
  const summaryContainer = document.getElementById('log-summary-table');
  if (summaryContainer) summaryContainer.innerHTML = buildSummaryTable(card);

  bindCardInfoToggles(modal, { defaultCollapsed: true });

  modal.classList.remove('hidden');
}

function openLogModal(cardId, options = {}) {
  const { fromRestore = false } = options;
  renderLogModal(cardId);
  setModalState({ type: 'log', cardId }, { fromRestore });
}

function closeLogModal(silent = false) {
  const modal = document.getElementById('log-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  logContextCardId = null;
  if (silent || restoringState) return;
  if (appState.modal && appState.modal.type === 'log') {
    history.back();
  } else {
    setModalState(null, { replace: true });
  }
}

function printCardView(card) {
  if (!card || !card.id) return;
  const draft = cloneCard(card);
  ensureCardMeta(draft, { skipSnapshot: true });
  const validationError = validateMkiDraftConstraints(draft);
  if (validationError) {
    alert(validationError);
    return;
  }
  const url = '/print/mk/' + encodeURIComponent(card.id);
  openPrintPreview(url);
}

function setupLogModal() {
  const modal = document.getElementById('log-modal');
  const closeBtn = document.getElementById('log-close');
  const printBtn = document.getElementById('log-print-summary');
  const printAllBtn = document.getElementById('log-print-all');
  const closeBottomBtn = document.getElementById('log-close-bottom');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => closeLogModal());
  }
  if (closeBottomBtn) {
    closeBottomBtn.addEventListener('click', () => closeLogModal());
  }
  if (printBtn) {
    printBtn.addEventListener('click', async () => {
      if (!logContextCardId) return;
      const url = '/print/log/summary/' + encodeURIComponent(logContextCardId);
      await openPrintPreview(url);
    });
  }
  if (printAllBtn) {
    printAllBtn.addEventListener('click', async () => {
      if (!logContextCardId) return;
      const url = '/print/log/full/' + encodeURIComponent(logContextCardId);
      await openPrintPreview(url);
    });
  }
}

// === МАРШРУТ КАРТЫ (ЧЕРЕЗ МОДАЛЬНОЕ ОКНО) ===
function renderDraftItemsRow(op, colspan = 8) {
  const items = Array.isArray(op.items) ? op.items : [];
  const content = items.length
    ? items.map((item, idx) => '<label class="item-name-field">' +
        '<span class="item-name-index">' + (idx + 1) + '.</span>' +
        '<input class="item-name-input" data-op-id="' + op.id + '" data-item-id="' + (item.id || '') + '" placeholder="Изделие ' + (idx + 1) + '" value="' + escapeHtml(item.name || '') + '">' +
        '<span class="item-qty-tag">1 шт</span>' +
      '</label>').join('')
    : '<span class="items-empty">Укажите количество изделий для операции, чтобы задать их список.</span>';

  return '<tr class="op-qty-row op-items-row"><td colspan="' + colspan + '">' +
    '<div class="items-row-header">Список изделий</div>' +
    '<div class="items-row-content editable">' + content + '</div>' +
    '</td></tr>';
}

function updateRouteTableScrollState() {
  const wrapper = document.getElementById('route-table-wrapper');
  if (!wrapper) return;
  wrapper.style.removeProperty('--route-table-max-height');
  wrapper.classList.remove('route-table-scrollable');
}

function isDesktopCardLayout() {
  return window.innerWidth > 1024;
}

function scrollRouteAreaToLatest() {
  const wrapper = document.getElementById('route-table-wrapper');
  const modalBody = document.querySelector('#card-modal .modal-body');
  if (!wrapper || !modalBody) return;
  const lastRow = wrapper.querySelector('tbody tr:last-child');
  const scrollContainer = isDesktopCardLayout() ? wrapper : modalBody;
  if (!lastRow) {
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
    return;
  }

  if (scrollContainer === wrapper) {
    const lastBottom = lastRow.offsetTop + lastRow.offsetHeight;
    const targetScroll = Math.max(0, lastBottom - wrapper.clientHeight);
    wrapper.scrollTop = targetScroll;
    return;
  }

  const addPanel = document.querySelector('#route-editor .route-add-panel');
  const bodyRect = modalBody.getBoundingClientRect();
  const rowRect = lastRow.getBoundingClientRect();
  const stickyBottomOffset = addPanel ? addPanel.getBoundingClientRect().height : 0;
  const visibleBottom = bodyRect.bottom - stickyBottomOffset - 12;
  const visibleTop = bodyRect.top + 12;

  if (rowRect.bottom > visibleBottom) {
    modalBody.scrollTop += rowRect.bottom - visibleBottom;
  } else if (rowRect.top < visibleTop) {
    modalBody.scrollTop += rowRect.top - visibleTop;
  }
}

function formatCardMainSummaryText({ name, quantity, routeNumber }) {
  const safeName = name || 'Маршрутная карта';
  const qtyLabel = quantity !== '' && quantity != null
    ? toSafeCount(quantity) + ' шт.'
    : 'Размер партии не указан';
  const routeLabel = routeNumber ? 'МК № ' + routeNumber : 'МК без номера';
  return safeName + ' · ' + qtyLabel + ' · ' + routeLabel;
}

function computeCardMainSummary() {
  const nameInput = document.getElementById('card-name');
  const qtyInput = document.getElementById('card-qty');
  const routeInput = document.getElementById('card-route-number');
  return formatCardMainSummaryText({
    name: (nameInput ? nameInput.value : '').trim(),
    quantity: (qtyInput ? qtyInput.value : '').trim(),
    routeNumber: (routeInput ? routeInput.value : '').trim()
  });
}

function updateCardMainSummary() {
  const summary = document.getElementById('card-main-summary');
  if (!summary) return;
  summary.textContent = computeCardMainSummary();
}

function setCardMainCollapsed(collapsed) {
  const block = document.getElementById('card-main-block');
  const toggle = document.getElementById('card-main-toggle');
  if (!block || !toggle) return;
  const isCollapsed = collapsed && isDesktopCardLayout();
  block.classList.toggle('is-collapsed', isCollapsed);
  toggle.textContent = isCollapsed ? 'Развернуть' : 'Свернуть';
  toggle.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
  updateCardMainSummary();
}

function renderRouteTableDraft() {
  const wrapper = document.getElementById('route-table-wrapper');
  if (!wrapper || !activeCardDraft) return;
  const opsArr = activeCardDraft.operations || [];
  renumberAutoCodesForCard(activeCardDraft);
  if (!opsArr.length) {
    wrapper.innerHTML = '<p>Маршрут пока пуст. Добавьте операции ниже.</p>';
    document.getElementById('card-status-text').textContent = cardStatusText(activeCardDraft);
    requestAnimationFrame(() => updateRouteTableScrollState());
    return;
  }
  const sortedOps = [...opsArr].sort((a, b) => (a.order || 0) - (b.order || 0));
  const { isMki, hasSamples } = getActiveCardSampleAvailability();
  let html = '<table><thead><tr>' +
    '<th>Порядок</th><th>Подразделение</th><th>Код операции</th><th>Наименование операции</th><th>Кол-во изделий</th><th>План (мин)</th><th>Статус</th><th>Действия</th>' +
    '</tr></thead><tbody>';
  sortedOps.forEach((o, index) => {
    normalizeOperationItems(activeCardDraft, o);
    const qtyValue = getOperationQuantity(o, activeCardDraft);
    const qtyLabel = o.isSamples ? 'Кол-во образцов' : 'Кол-во изделий';
    const qtyCell = isMki
      ? '<td class="route-qty-cell">' +
        '<label class="checkbox-inline route-samples-toggle">' +
          '<input type="checkbox" class="route-samples-checkbox" data-rop-id="' + o.id + '"' + (o.isSamples ? ' checked' : '') + (hasSamples ? '' : ' disabled') + '> Образцы' +
        '</label>' +
        (hasSamples ? '' : '<div class="route-samples-hint-text">Операции по образцам недоступны при нулевом количестве образцов</div>') +
        '<div class="route-qty-label">' + qtyLabel + '</div>' +
        '<input type="number" min="0" class="route-qty-input" data-rop-id="' + o.id + '" value="' + escapeHtml(qtyValue) + '" readonly>' +
      '</td>'
      : '<td><input type="number" min="0" class="route-qty-input" data-rop-id="' + o.id + '" value="' + escapeHtml(qtyValue) + '"></td>';

    html += '<tr data-rop-id="' + o.id + '">' +
      '<td>' + (index + 1) + '</td>' +
      '<td>' + escapeHtml(o.centerName) + '</td>' +
      '<td><input class="route-code-input" data-rop-id="' + o.id + '" value="' + escapeHtml(o.opCode || '') + '" /></td>' +
      '<td>' + renderOpName(o) + '</td>' +
      qtyCell +
      '<td>' + (o.plannedMinutes || '') + '</td>' +
      '<td>' + statusBadge(o.status) + '</td>' +
      '<td><div class="table-actions">' +
      '<button class="btn-small" data-action="move-up">↑</button>' +
      '<button class="btn-small" data-action="move-down">↓</button>' +
      '<button class="btn-small btn-danger" data-action="delete">Удалить</button>' +
      '</div></td>' +
      '</tr>';

    if (activeCardDraft.useItemList) {
      html += renderDraftItemsRow(o, 8);
    }
  });
  html += '</tbody></table>';
  wrapper.innerHTML = html;

  wrapper.querySelectorAll('tr[data-rop-id]').forEach(row => {
    const ropId = row.getAttribute('data-rop-id');
    row.querySelectorAll('button[data-action]').forEach(btn => {
      const action = btn.getAttribute('data-action');
      btn.addEventListener('click', () => {
        if (!activeCardDraft) return;
        if (action === 'delete') {
          activeCardDraft.operations = activeCardDraft.operations.filter(o => o.id !== ropId);
          renumberAutoCodesForCard(activeCardDraft);
        } else if (action === 'move-up' || action === 'move-down') {
          moveRouteOpInDraft(ropId, action === 'move-up' ? -1 : 1);
        }
        document.getElementById('card-status-text').textContent = cardStatusText(activeCardDraft);
        renderRouteTableDraft();
      });
    });
  });

  wrapper.querySelectorAll('.route-code-input').forEach(input => {
    input.addEventListener('blur', e => {
      if (!activeCardDraft) return;
      const ropId = input.getAttribute('data-rop-id');
      const op = activeCardDraft.operations.find(o => o.id === ropId);
      if (!op) return;
      const prev = op.opCode || '';
      const value = (e.target.value || '').trim();
      if (!value) {
        op.autoCode = true;
      } else {
        op.autoCode = false;
        op.opCode = value;
      }
      renumberAutoCodesForCard(activeCardDraft);
      if (prev !== op.opCode && !activeCardIsNew) {
        recordCardLog(activeCardDraft, { action: 'Код операции', object: opLogLabel(op), field: 'opCode', targetId: op.id, oldValue: prev, newValue: op.opCode });
      }
      renderRouteTableDraft();
    });
  });

  if (isMki) {
    wrapper.querySelectorAll('.route-samples-checkbox').forEach(input => {
      input.addEventListener('change', e => {
        if (!activeCardDraft) return;
        const ropId = input.getAttribute('data-rop-id');
        const op = activeCardDraft.operations.find(o => o.id === ropId);
        if (!op) return;
        op.isSamples = Boolean(e.target.checked);
        recalcMkiOperationQuantities(activeCardDraft);
        renderRouteTableDraft();
      });
    });
  }

  wrapper.querySelectorAll('.route-qty-input').forEach(input => {
    input.addEventListener('input', e => {
      if (activeCardDraft && activeCardDraft.cardType === 'MKI') {
        const ropId = input.getAttribute('data-rop-id');
        const op = activeCardDraft.operations.find(o => o.id === ropId);
        e.target.value = getOperationQuantity(op, activeCardDraft);
        return;
      }
      e.target.value = toSafeCount(e.target.value);
    });
    input.addEventListener('blur', e => {
      if (!activeCardDraft) return;
      const ropId = input.getAttribute('data-rop-id');
      const op = activeCardDraft.operations.find(o => o.id === ropId);
      if (!op) return;
      if (activeCardDraft.cardType === 'MKI') {
        input.value = getOperationQuantity(op, activeCardDraft);
        return;
      }
      const prev = getOperationQuantity(op, activeCardDraft);
      const raw = e.target.value;
      if (raw === '') {
        op.quantity = '';
      } else {
        op.quantity = toSafeCount(raw);
      }
      normalizeOperationItems(activeCardDraft, op);
      const firstOp = getFirstOperation(activeCardDraft);
      if (firstOp && firstOp.id === ropId) {
        syncItemListFromFirstOperation(activeCardDraft);
      }
      if (prev !== op.quantity && !activeCardIsNew) {
        recordCardLog(activeCardDraft, { action: 'Количество изделий', object: opLogLabel(op), field: 'operationQuantity', targetId: op.id, oldValue: prev, newValue: op.quantity });
      }
      renderRouteTableDraft();
    });
  });

  wrapper.querySelectorAll('.item-name-input').forEach(input => {
    input.addEventListener('blur', e => {
      if (!activeCardDraft) return;
      const ropId = input.getAttribute('data-op-id');
      const itemId = input.getAttribute('data-item-id');
      const op = activeCardDraft.operations.find(o => o.id === ropId);
      if (!op || !Array.isArray(op.items)) return;
      const item = op.items.find(it => it.id === itemId);
      if (!item) return;
      const prev = item.name || '';
      const value = (e.target.value || '').trim();
      item.name = value;
      if (prev !== value && !activeCardIsNew) {
        recordCardLog(activeCardDraft, { action: 'Список изделий', object: opLogLabel(op), field: 'itemName', targetId: item.id, oldValue: prev, newValue: value });
      }
      const firstOp = getFirstOperation(activeCardDraft);
      if (firstOp && firstOp.id === ropId) {
        syncItemListFromFirstOperation(activeCardDraft);
        renderRouteTableDraft();
        return;
      }
    });
  });

  requestAnimationFrame(() => {
    updateRouteTableScrollState();
    scrollRouteAreaToLatest();
  });
}

function moveRouteOpInDraft(ropId, delta) {
  if (!activeCardDraft) return;
  const opsArr = [...(activeCardDraft.operations || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const idx = opsArr.findIndex(o => o.id === ropId);
  if (idx < 0) return;
  const newIdx = idx + delta;
  if (newIdx < 0 || newIdx >= opsArr.length) return;
  const tmpOrder = opsArr[idx].order;
  opsArr[idx].order = opsArr[newIdx].order;
  opsArr[newIdx].order = tmpOrder;
  activeCardDraft.operations = opsArr;
  renumberAutoCodesForCard(activeCardDraft);
}

function getFilteredRouteSources() {
  const opInput = document.getElementById('route-op');
  const centerInput = document.getElementById('route-center');
  const opFilter = (opInput ? opInput.value : '').toLowerCase();
  const centerFilter = (centerInput ? centerInput.value : '').toLowerCase();

  const filteredOps = ops.filter(o => {
    if (!opFilter) return true;
    const label = formatOpLabel(o).toLowerCase();
    const code = (o.opCode || o.code || '').toLowerCase();
    const desc = (o.desc || '').toLowerCase();
    return label.includes(opFilter) || code.includes(opFilter) || desc.includes(opFilter);
  });
  const filteredCenters = centers.filter(c => {
    if (!centerFilter) return true;
    const name = (c.name || '').toLowerCase();
    const desc = (c.desc || '').toLowerCase();
    return name.includes(centerFilter) || desc.includes(centerFilter);
  });

  return { filteredOps, filteredCenters };
}

function updateRouteCombo(kind, items, { forceOpen = false } = {}) {
  const containerId = kind === 'center' ? 'route-center-suggestions' : 'route-op-suggestions';
  const inputId = kind === 'center' ? 'route-center' : 'route-op';
  const container = document.getElementById(containerId);
  const input = document.getElementById(inputId);
  if (!container || !input) return;

  if (window.innerWidth > 768) {
    container.classList.remove('open');
    container.innerHTML = '';
    return;
  }

  container.innerHTML = '';
  if (!items || !items.length) {
    container.classList.remove('open');
    return;
  }

  items.forEach(item => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'combo-option';
    btn.textContent = kind === 'center' ? (item.name || '') : formatOpLabel(item);
    btn.addEventListener('click', () => {
      input.value = btn.textContent;
      container.classList.remove('open');
      fillRouteSelectors();
      input.focus();
    });
    container.appendChild(btn);
  });

  const shouldOpen = forceOpen || container.classList.contains('open');
  container.classList.toggle('open', shouldOpen);
}

function hideRouteCombos() {
  const containers = document.querySelectorAll('.combo-suggestions');
  containers.forEach(el => {
    el.classList.remove('open');
    if (el.classList.contains('executor-suggestions')) {
      resetExecutorSuggestionPosition(el);
    }
  });
}

function isMobileExecutorInput(input) {
  if (!input) return false;
  if (input.closest && input.closest('#mobile-operations-view')) return true;
  return document.body.classList.contains('mobile-ops-open') && isMobileOperationsLayout();
}

function normalizeCyrillicTerm(str = '') {
  return str.toLowerCase().replace(/[^а-яё]/g, '');
}

function filterExecutorChoices(filter, { useCyrillic = false } = {}) {
  const normalize = useCyrillic ? normalizeCyrillicTerm : (val = '') => val.toLowerCase();
  const term = normalize(filter || '');
  return getEligibleExecutorNames()
    .filter(name => !term || normalize(name).includes(term))
    .slice(0, 30);
}

function shouldUseCustomExecutorCombo() {
  const pointerCoarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const touchCapable = typeof navigator !== 'undefined' && Number(navigator.maxTouchPoints || 0) > 0;
  const mobileOpsActive = isMobileOperationsLayout() || document.body.classList.contains('mobile-ops-open');
  return pointerCoarse || touchCapable || mobileOpsActive;
}

function updateExecutorCombo(input, { forceOpen = false } = {}) {
  if (!input) return;
  const combo = input.closest('.executor-combo');
  const container = combo ? combo.querySelector('.executor-suggestions') : null;
  if (!container) return;

  if (!shouldUseCustomExecutorCombo()) {
    container.classList.remove('open');
    container.innerHTML = '';
    resetExecutorSuggestionPosition(container);
    return;
  }

  const mobileMode = isMobileExecutorInput(input);
  const options = filterExecutorChoices(input.value, { useCyrillic: mobileMode });
  container.innerHTML = '';
  if (!options.length) {
    container.classList.remove('open');
    resetExecutorSuggestionPosition(container);
    return;
  }

  options.forEach(name => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'combo-option';
    btn.textContent = name;
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('pointerdown', e => e.preventDefault());
    btn.addEventListener('click', () => {
      input.value = name;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      container.classList.remove('open');
      input.focus();
    });
    container.appendChild(btn);
  });

  const shouldOpen = forceOpen || container.classList.contains('open');
  container.classList.toggle('open', shouldOpen);
  if (shouldOpen) {
    if (!mobileMode) {
      positionExecutorSuggestions(container, input);
    } else {
      resetExecutorSuggestionPosition(container);
    }
  } else {
    resetExecutorSuggestionPosition(container);
  }
}

function repositionOpenExecutorSuggestions() {
  if (!shouldUseCustomExecutorCombo()) return;
  const openContainers = document.querySelectorAll('.executor-suggestions.open');
  openContainers.forEach(container => {
    const combo = container.closest('.executor-combo');
    const input = combo ? combo.querySelector('input[type="text"]') : null;
    if (input && !isMobileExecutorInput(input)) {
      positionExecutorSuggestions(container, input);
    } else {
      resetExecutorSuggestionPosition(container);
    }
  });
}

function syncExecutorComboboxMode() {
  const useCustom = shouldUseCustomExecutorCombo();
  const inputs = document.querySelectorAll('.executor-main-input, .additional-executor-input');
  inputs.forEach(input => {
    if (useCustom) {
      if (input.hasAttribute('list')) {
        input.removeAttribute('list');
      }
    } else {
      if (input.getAttribute('list') !== USER_DATALIST_ID) {
        input.setAttribute('list', USER_DATALIST_ID);
      }
    }
  });

  document.querySelectorAll('.executor-suggestions').forEach(container => {
    if (!useCustom) {
      container.classList.remove('open');
      resetExecutorSuggestionPosition(container);
    }
  });
}

function handleExecutorViewportChange() {
  syncExecutorComboboxMode();
  repositionOpenExecutorSuggestions();
}

window.addEventListener('resize', handleExecutorViewportChange);
window.addEventListener('scroll', repositionOpenExecutorSuggestions, true);

function fillRouteSelectors() {
  const opList = document.getElementById('route-op-options');
  const centerList = document.getElementById('route-center-options');
  if (!opList || !centerList) return;

  const { filteredOps, filteredCenters } = getFilteredRouteSources();

  opList.innerHTML = '';
  filteredOps.forEach(o => {
    const opt = document.createElement('option');
    opt.value = formatOpLabel(o);
    opt.dataset.id = o.id;
    opList.appendChild(opt);
  });

  centerList.innerHTML = '';
  filteredCenters.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.name;
    opt.dataset.id = c.id;
    centerList.appendChild(opt);
  });

  updateRouteCombo('op', filteredOps);
  updateRouteCombo('center', filteredCenters);
}

function resetExecutorSuggestionPosition(container) {
  if (!container) return;
  container.style.position = '';
  container.style.left = '';
  container.style.top = '';
  container.style.width = '';
  container.style.maxWidth = '';
  container.style.zIndex = '';
}

function resetCenterForm() {
  const form = document.getElementById('center-form');
  if (!form) return;
  form.dataset.editingId = '';
  form.reset();
  const submit = document.getElementById('center-submit');
  const cancel = document.getElementById('center-cancel-edit');
  if (submit) submit.textContent = 'Добавить подразделение';
  if (cancel) cancel.classList.add('hidden');
}

function startCenterEdit(center) {
  const form = document.getElementById('center-form');
  if (!form || !center) return;
  form.dataset.editingId = center.id;
  const nameInput = document.getElementById('center-name');
  const descInput = document.getElementById('center-desc');
  if (nameInput) nameInput.value = center.name || '';
  if (descInput) descInput.value = center.desc || '';
  const submit = document.getElementById('center-submit');
  const cancel = document.getElementById('center-cancel-edit');
  if (submit) submit.textContent = 'Сохранить';
  if (cancel) cancel.classList.remove('hidden');
  if (nameInput) nameInput.focus();
}

function resetOpForm() {
  const form = document.getElementById('op-form');
  if (!form) return;
  form.dataset.editingId = '';
  form.reset();
  const submit = document.getElementById('op-submit');
  const cancel = document.getElementById('op-cancel-edit');
  if (submit) submit.textContent = 'Добавить операцию';
  if (cancel) cancel.classList.add('hidden');
}

function startOpEdit(op) {
  const form = document.getElementById('op-form');
  if (!form || !op) return;
  form.dataset.editingId = op.id;
  const nameInput = document.getElementById('op-name');
  const descInput = document.getElementById('op-desc');
  const timeInput = document.getElementById('op-time');
  if (nameInput) nameInput.value = op.name || '';
  if (descInput) descInput.value = op.desc || '';
  if (timeInput) timeInput.value = op.recTime || 30;
  const submit = document.getElementById('op-submit');
  const cancel = document.getElementById('op-cancel-edit');
  if (submit) submit.textContent = 'Сохранить';
  if (cancel) cancel.classList.remove('hidden');
  if (nameInput) nameInput.focus();
}

function updateCenterReferences(updatedCenter) {
  if (!updatedCenter) return;
  const apply = (opsArr = []) => {
    opsArr.forEach(op => {
      if (op && op.centerId === updatedCenter.id) {
        op.centerName = updatedCenter.name;
      }
    });
  };
  cards.forEach(card => apply(card.operations));
  if (activeCardDraft && Array.isArray(activeCardDraft.operations)) {
    apply(activeCardDraft.operations);
  }
}

function updateOperationReferences(updatedOp) {
  if (!updatedOp) return;
  const apply = (opsArr = []) => {
    opsArr.forEach(op => {
      if (op && op.opId === updatedOp.id) {
        op.opName = updatedOp.name;
        if (op.status === 'NOT_STARTED' || !op.status) {
          op.plannedMinutes = updatedOp.recTime || op.plannedMinutes;
        }
      }
    });
  };
  cards.forEach(card => apply(card.operations));
  if (activeCardDraft && Array.isArray(activeCardDraft.operations)) {
    apply(activeCardDraft.operations);
  }
}

function positionExecutorSuggestions(container, input) {
  if (!container || !input || !shouldUseCustomExecutorCombo() || isMobileExecutorInput(input)) {
    resetExecutorSuggestionPosition(container);
    return;
  }

  const rect = input.getBoundingClientRect();
  const viewportPadding = 6;
  const availableWidth = window.innerWidth - viewportPadding * 2;
  const targetWidth = Math.min(rect.width, availableWidth);
  const left = Math.min(
    Math.max(viewportPadding, rect.left + window.scrollX),
    window.scrollX + window.innerWidth - targetWidth - viewportPadding
  );
  const top = rect.bottom + window.scrollY + 4;

  container.style.position = 'fixed';
  container.style.left = `${left}px`;
  container.style.top = `${top}px`;
  container.style.width = `${targetWidth}px`;
  container.style.maxWidth = `${availableWidth}px`;
  container.style.zIndex = '1400';
}

// === СПРАВОЧНИКИ ===
function renderCentersTable() {
  const wrapper = document.getElementById('centers-table-wrapper');
  if (!centers.length) {
    wrapper.innerHTML = '<p>Список подразделений пуст.</p>';
    return;
  }
  let html = '<table><thead><tr><th>Название</th><th>Описание</th><th>Действия</th></tr></thead><tbody>';
  centers.forEach(center => {
    html += '<tr>' +
      '<td>' + escapeHtml(center.name) + '</td>' +
      '<td>' + escapeHtml(center.desc || '') + '</td>' +
      '<td><div class="table-actions">' +
      '<button class="btn-small btn-secondary" data-id="' + center.id + '" data-action="edit">Изменить</button>' +
      '<button class="btn-small btn-danger" data-id="' + center.id + '" data-action="delete">Удалить</button>' +
      '</div></td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  wrapper.innerHTML = html;
  wrapper.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const action = btn.getAttribute('data-action');
      const center = centers.find(c => c.id === id);
      if (!center) return;
      if (action === 'edit') {
        startCenterEdit(center);
        return;
      }
      if (confirm('Удалить подразделение? Он останется в уже созданных маршрутах как текст.')) {
        centers = centers.filter(c => c.id !== id);
        saveData();
        const centerForm = document.getElementById('center-form');
        if (centerForm && centerForm.dataset.editingId === id) {
          resetCenterForm();
        }
        renderCentersTable();
        fillRouteSelectors();
      }
    });
  });
}

function renderOpsTable() {
  const wrapper = document.getElementById('ops-table-wrapper');
  if (!ops.length) {
    wrapper.innerHTML = '<p>Список операций пуст.</p>';
    return;
  }
  let html = '<table><thead><tr><th>Название</th><th>Описание</th><th>Рек. время (мин)</th><th>Действия</th></tr></thead><tbody>';
  ops.forEach(o => {
    html += '<tr>' +
      '<td>' + escapeHtml(o.name) + '</td>' +
      '<td>' + escapeHtml(o.desc || '') + '</td>' +
      '<td>' + (o.recTime || '') + '</td>' +
      '<td><div class="table-actions">' +
      '<button class="btn-small btn-secondary" data-id="' + o.id + '" data-action="edit">Изменить</button>' +
      '<button class="btn-small btn-danger" data-id="' + o.id + '" data-action="delete">Удалить</button>' +
      '</div></td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  wrapper.innerHTML = html;
  wrapper.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const action = btn.getAttribute('data-action');
      const op = ops.find(v => v.id === id);
      if (!op) return;
      if (action === 'edit') {
        startOpEdit(op);
        return;
      }
      if (confirm('Удалить операцию? Она останется в уже созданных маршрутах как текст.')) {
        ops = ops.filter(o => o.id !== id);
        saveData();
        const opForm = document.getElementById('op-form');
        if (opForm && opForm.dataset.editingId === id) {
          resetOpForm();
        }
        renderOpsTable();
        fillRouteSelectors();
      }
    });
  });
}

// === МАРШРУТНЫЕ КВИТАНЦИИ ===
function getAllRouteRows() {
  const rows = [];
  cards.forEach(card => {
    if (card.archived) return;
    (card.operations || []).forEach(op => {
      rows.push({ card, op });
    });
  });
  return rows;
}

function cardHasCenterMatch(card, term) {
  if (!card || !term) return false;
  const t = term.toLowerCase();
  return (card.operations || []).some(op => (op.centerName || '').toLowerCase().includes(t));
}

function cardSearchScore(card, term) {
  if (!term) return 0;
  const t = term.toLowerCase();
  const compactTerm = term.replace(/\s+/g, '').toLowerCase();
  let score = 0;
  const barcodeValue = getCardBarcodeValue(card).toLowerCase();
  if (barcodeValue) {
    if (barcodeValue === compactTerm) score += 200;
    else if (barcodeValue.indexOf(compactTerm) !== -1) score += 100;
  }
  const displayTitle = (formatCardTitle(card) || '').toLowerCase();
  if (displayTitle && displayTitle.includes(t)) score += 50;
  if (card.orderNo && card.orderNo.toLowerCase().includes(t)) score += 50;
  if (card.contractNumber && card.contractNumber.toLowerCase().includes(t)) score += 50;
  if (cardHasCenterMatch(card, t)) score += 40;
  return score;
}

function cardSearchScoreWithChildren(card, term, { includeArchivedChildren = false } = {}) {
  if (!term) return 0;
  const selfScore = cardSearchScore(card, term);
  if (!isGroupCard(card)) return selfScore;
  const children = getGroupChildren(card).filter(c => includeArchivedChildren || !c.archived);
  const childScore = children.reduce((max, child) => Math.max(max, cardSearchScore(child, term)), 0);
  return Math.max(selfScore, childScore);
}

function buildWorkorderCardDetails(card, { opened = false, allowArchive = true, showLog = true, readonly = false, highlightCenterTerm = '' } = {}) {
  const stateBadge = renderCardStateBadge(card);
  const missingBadge = cardHasMissingExecutors(card)
    ? '<span class="status-pill status-pill-missing-executor" title="Есть операции без исполнителя">Нет исполнителя</span>'
    : '';
  const canArchive = allowArchive && card.status === 'DONE' && !readonly;
  const filesCount = (card.attachments || []).length;
  const contractText = card.contractNumber ? ' (Договор: ' + escapeHtml(card.contractNumber) + ')' : '';
  const barcodeButton = ' <button type="button" class="btn-small btn-secondary barcode-view-btn" data-allow-view="true" data-card-id="' + card.id + '" title="Показать штрихкод" aria-label="Показать штрихкод">Штрихкод</button>';
  const filesButton = ' <button type="button" class="btn-small clip-btn inline-clip" data-card-id="' + card.id + '" data-attach-card="' + card.id + '">📎 <span class="clip-count">' + filesCount + '</span></button>';
  const logButton = showLog ? ' <button type="button" class="btn-small btn-secondary log-btn" data-allow-view="true" data-log-card="' + card.id + '">Log</button>' : '';
  const inlineActions = '<span class="summary-inline-actions">' + barcodeButton + filesButton + logButton + '</span>';
  const nameLabel = formatCardNameWithGroupPosition(card);

  let html = '<details class="wo-card" data-card-id="' + card.id + '"' + (opened ? ' open' : '') + '>' +
    '<summary>' +
    '<div class="summary-line">' +
    '<div class="summary-text">' +
    '<strong>' + nameLabel + '</strong>' +
    ' <span class="summary-sub">' +
    (card.orderNo ? ' (Заказ: ' + escapeHtml(card.orderNo) + ')' : '') + contractText +
    inlineActions +
    '</span>' +
    '</div>' +
    '<div class="summary-actions">' +
    (missingBadge ? missingBadge + ' ' : '') + stateBadge +
    (canArchive ? ' <button type="button" class="btn-small btn-secondary archive-move-btn" data-card-id="' + card.id + '">Перенести в архив</button>' : '') +
    '</div>' +
    '</div>' +
    '</summary>';

  html += buildCardInfoBlock(card);
  html += buildOperationsTable(card, { readonly, showQuantityColumn: false, allowActions: !readonly, centerHighlightTerm: highlightCenterTerm });
  html += '</details>';
  return html;
}

function buildWorkspaceCardDetails(card, { opened = true, readonly = false } = {}) {
  const stateBadge = renderCardStateBadge(card);
  const filesCount = (card.attachments || []).length;
  const contractText = card.contractNumber ? ' (Договор: ' + escapeHtml(card.contractNumber) + ')' : '';
  const barcodeButton = ' <button type="button" class="btn-small btn-secondary barcode-view-btn" data-allow-view="true" data-card-id="' + card.id + '" title="Показать штрихкод" aria-label="Показать штрихкод">Штрихкод</button>';
  const filesButton = ' <button type="button" class="btn-small clip-btn inline-clip" data-attach-card="' + card.id + '">📎 <span class="clip-count">' + filesCount + '</span></button>';
  const inlineActions = '<span class="summary-inline-actions workorder-inline-actions">' + barcodeButton + filesButton + '</span>';
  const nameLabel = formatCardNameWithGroupPosition(card);

  let html = '<details class="wo-card workspace-card" data-card-id="' + card.id + '"' + (opened ? ' open' : '') + '>' +
    '<summary>' +
    '<div class="summary-line">' +
    '<div class="summary-text">' +
    '<strong>' + nameLabel + '</strong>' +
    ' <span class="summary-sub">' +
    (card.orderNo ? ' (Заказ: ' + escapeHtml(card.orderNo) + ')' : '') + contractText +
    inlineActions +
    '</span>' +
    '</div>' +
    '<div class="summary-actions">' + stateBadge + '</div>' +
    '</div>' +
    '</summary>';

  html += buildCardInfoBlock(card);
  const restrictToUser = currentUser && currentUser.permissions && currentUser.permissions.worker;
  html += buildOperationsTable(card, { readonly, showQuantityColumn: false, lockExecutors: true, lockQuantities: true, allowActions: !readonly, restrictToUser });
  html += '</details>';
  return html;
}

function buildWorkspaceGroupDetails(group) {
  const children = getGroupChildren(group).filter(c => !c.archived);
  const stateBadge = renderCardStateBadge(group);
  const contractText = group.contractNumber ? ' (Договор: ' + escapeHtml(group.contractNumber) + ')' : '';
  const filesCount = (group.attachments || []).length;
  const filesButton = ' <button type="button" class="btn-small clip-btn inline-clip" data-attach-card="' + group.id + '">📎 <span class="clip-count">' + filesCount + '</span></button>';
  const barcodeButton = ' <button type="button" class="btn-small btn-secondary barcode-view-btn" data-card-id="' + group.id + '" title="Показать штрихкод" aria-label="Показать штрихкод">Штрихкод</button>';
  const inlineActions = '<span class="summary-inline-actions workorder-inline-actions">' + barcodeButton + filesButton + '</span>';

  const childrenHtml = children.length
    ? children.map(child => buildWorkspaceCardDetails(child, { opened: true })).join('')
    : '<p class="group-empty">В группе нет карт для отображения.</p>';

  return '<details class="wo-card group-wo-card" data-group-id="' + group.id + '" open>' +
    '<summary>' +
    '<div class="summary-line">' +
    '<div class="summary-text">' +
    '<strong><span class="group-marker">(Г)</span>' + escapeHtml(group.name || group.id) + '</strong>' +
    ' <span class="summary-sub">' +
    (group.orderNo ? ' (Заказ: ' + escapeHtml(group.orderNo) + ')' : '') + contractText +
    inlineActions +
    '</span>' +
    '</div>' +
    '<div class="summary-actions">' + stateBadge + '</div>' +
    '</div>' +
    '</summary>' +
    '<div class="group-children">' + childrenHtml + '</div>' +
    '</details>';
}

function scrollWorkorderDetailsIntoViewIfNeeded(detailsEl) {
  if (!detailsEl || !workorderAutoScrollEnabled || suppressWorkorderAutoscroll) return;

  // Автоскролл существует только для удобного просмотра именно что раскрытой карточки/группы.
  requestAnimationFrame(() => {
    if (suppressWorkorderAutoscroll) return;
    const rect = detailsEl.getBoundingClientRect();
    const header = document.querySelector('header');
    const headerOffset = header ? header.getBoundingClientRect().height : 0;
    const offset = headerOffset + 16;

    const needsScrollDown = rect.bottom > window.innerHeight;
    const needsScrollUp = rect.top < offset;
    if (!needsScrollDown && !needsScrollUp) return;
    const targetTop = window.scrollY + rect.top - offset;

    window.scrollTo({
      top: targetTop,
      behavior: 'smooth',
    });
  });
}

function markWorkorderToggleState(detail) {
  detail.dataset.wasOpen = detail.open ? 'true' : 'false';
}

function shouldScrollAfterWorkorderToggle(detail) {
  const wasOpen = detail.dataset.wasOpen === 'true';
  const nowOpen = detail.open;
  detail.dataset.wasOpen = nowOpen ? 'true' : 'false';
  // Скроллим только при переходе «было закрыто → стало открыто».
  return nowOpen && !wasOpen;
}

function findWorkorderDetail({ cardId = null, groupId = null } = {}) {
  if (cardId) {
    return document.querySelector('.wo-card[data-card-id="' + cardId + '"]');
  }
  if (groupId) {
    return document.querySelector('.wo-card[data-group-id="' + groupId + '"]');
  }
  return null;
}

function withWorkorderScrollLock(cb, { anchorCardId = null, anchorGroupId = null } = {}) {
  const anchorEl = anchorCardId || anchorGroupId ? findWorkorderDetail({ cardId: anchorCardId, groupId: anchorGroupId }) : null;
  const anchorTop = anchorEl ? anchorEl.getBoundingClientRect().top : null;
  const prevX = window.scrollX;
  const prevY = window.scrollY;
  cb();
  if (!suppressWorkorderAutoscroll) return;
  requestAnimationFrame(() => {
    if (anchorTop != null) {
      const freshAnchor = findWorkorderDetail({ cardId: anchorCardId, groupId: anchorGroupId });
      if (freshAnchor) {
        const newTop = freshAnchor.getBoundingClientRect().top;
        const delta = newTop - anchorTop;
        window.scrollTo({ left: prevX, top: window.scrollY + delta });
        return;
      }
    }
    window.scrollTo({ left: prevX, top: prevY });
  });
}

function renderExecutorCell(op, card, { readonly = false, mobile = false } = {}) {
  const extras = Array.isArray(op.additionalExecutors) ? op.additionalExecutors : [];
  if (readonly) {
    const extrasText = extras.filter(Boolean).length
      ? '<div class="additional-executor-list">' + extras.map(name => '<span class="executor-chip">' + escapeHtml(name) + '</span>').join('') + '</div>'
      : '';
    return '<div class="executor-cell readonly">' +
      '<div class="executor-name">' + escapeHtml(op.executor || '') + '</div>' +
      extrasText +
      '</div>';
  }
  const cardId = card ? card.id : '';
  const comboClass = mobile ? 'combo-field executor-combo executor-combobox' : 'combo-field executor-combo';
  const comboAttrs = mobile ? ' data-mobile-combo="true"' : '';

  let html = '<div class="executor-cell" data-card-id="' + cardId + '" data-op-id="' + op.id + '">';
  html += '<div class="executor-row primary">' +
    '<div class="' + comboClass + '"' + comboAttrs + '>' +
      '<input type="text" list="' + USER_DATALIST_ID + '" class="executor-main-input" data-card-id="' + cardId + '" data-op-id="' + op.id + '" value="' + escapeHtml(op.executor || '') + '" placeholder="Исполнитель" />' +
      (mobile ? '<button type="button" class="executor-arrow" aria-label="Открыть список исполнителей" tabindex="-1">▼</button>' : '') +
      '<div class="combo-suggestions executor-suggestions" role="listbox"></div>' +
    '</div>' +
    (extras.length < 3 ? '<button type="button" class="icon-btn add-executor-btn" data-card-id="' + cardId + '" data-op-id="' + op.id + '">+</button>' : '') +
    '</div>';

  extras.forEach((name, idx) => {
    const canAddMore = extras.length < 3 && idx === extras.length - 1;
    html += '<div class="executor-row extra" data-extra-index="' + idx + '">' +
      '<div class="' + comboClass + '"' + comboAttrs + '>' +
        '<input type="text" list="' + USER_DATALIST_ID + '" class="additional-executor-input" data-card-id="' + cardId + '" data-op-id="' + op.id + '" data-extra-index="' + idx + '" value="' + escapeHtml(name || '') + '" placeholder="Доп. исполнитель" />' +
        (mobile ? '<button type="button" class="executor-arrow" aria-label="Открыть список исполнителей" tabindex="-1">▼</button>' : '') +
        '<div class="combo-suggestions executor-suggestions" role="listbox"></div>' +
      '</div>' +
      (canAddMore ? '<button type="button" class="icon-btn add-executor-btn" data-card-id="' + cardId + '" data-op-id="' + op.id + '">+</button>' : '') +
      '<button type="button" class="icon-btn remove-executor-btn" data-card-id="' + cardId + '" data-op-id="' + op.id + '" data-extra-index="' + idx + '">-</button>' +
      '</div>';
  });

  html += '</div>';
  return html;
}

function buildOperationsTable(card, { readonly = false, quantityPrintBlanks = false, showQuantityColumn = true, lockExecutors = false, lockQuantities = false, allowActions = !readonly, restrictToUser = false, centerHighlightTerm = '' } = {}) {
  const opsSorted = [...(card.operations || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const hasActions = allowActions && !readonly;
  const baseColumns = hasActions ? 10 : 9;
  const totalColumns = baseColumns + (showQuantityColumn ? 1 : 0);
  let html = '<table><thead><tr>' +
    '<th>Порядок</th><th>Подразделение</th><th>Код операции</th><th>Наименование операции</th>' +
    (showQuantityColumn ? '<th>Количество изделий</th>' : '') +
    '<th>Исполнитель</th><th>План (мин)</th><th>Статус</th><th>Текущее / факт. время</th>' +
    (hasActions ? '<th>Действия</th>' : '') +
    '<th>Комментарии</th>' +
    '</tr></thead><tbody>';

  opsSorted.forEach((op, idx) => {
    normalizeOperationItems(card, op);
    op.executor = sanitizeExecutorName(op.executor || '');
    if (Array.isArray(op.additionalExecutors)) {
      op.additionalExecutors = op.additionalExecutors
        .map(name => sanitizeExecutorName(name || ''))
        .slice(0, 2);
    } else {
      op.additionalExecutors = [];
    }
    const rowId = card.id + '::' + op.id;
    const elapsed = getOperationElapsedSeconds(op);
    let timeCell = '';
    if (op.status === 'IN_PROGRESS' || op.status === 'PAUSED') {
      timeCell = '<span class="wo-timer" data-row-id="' + rowId + '">' + formatSecondsToHMS(elapsed) + '</span>';
    } else if (op.status === 'DONE') {
      const seconds = typeof op.elapsedSeconds === 'number' && op.elapsedSeconds
        ? op.elapsedSeconds
        : (op.actualSeconds || 0);
      timeCell = formatSecondsToHMS(seconds);
    }

    const userName = (currentUser && currentUser.name ? currentUser.name.toLowerCase() : '').trim();
    const matchesUser = userName && ((op.executor || '').toLowerCase() === userName || (op.additionalExecutors || []).map(v => (v || '').toLowerCase()).includes(userName));
    let actionsHtml = '';
    if (hasActions) {
      const allowed = !restrictToUser || matchesUser;
      if (!allowed) {
        actionsHtml = '<span class="hint">Доступно только исполнителю</span>';
      } else if (op.status === 'NOT_STARTED' || !op.status) {
        actionsHtml = '<button class="btn-primary" data-action="start" data-card-id="' + card.id + '" data-op-id="' + op.id + '">Начать</button>';
      } else if (op.status === 'IN_PROGRESS') {
        actionsHtml =
          '<button class="btn-secondary" data-action="pause" data-card-id="' + card.id + '" data-op-id="' + op.id + '">Пауза</button>' +
          '<button class="btn-secondary" data-action="stop" data-card-id="' + card.id + '" data-op-id="' + op.id + '">Завершить</button>';
      } else if (op.status === 'PAUSED') {
        actionsHtml =
          '<button class="btn-primary" data-action="resume" data-card-id="' + card.id + '" data-op-id="' + op.id + '">Продолжить</button>' +
          '<button class="btn-secondary" data-action="stop" data-card-id="' + card.id + '" data-op-id="' + op.id + '">Завершить</button>';
      } else if (op.status === 'DONE') {
        actionsHtml =
          '<button class="btn-primary" data-action="resume" data-card-id="' + card.id + '" data-op-id="' + op.id + '">Продолжить</button>';
      }
    }

    const commentCell = readonly || op.status === 'DONE'
      ? '<div class="comment-readonly">' + escapeHtml(op.comment || '') + '</div>'
      : '<textarea class="comment-input" data-card-id="' + card.id + '" data-op-id="' + op.id + '" maxlength="40" rows="1" placeholder="Комментарий">' + escapeHtml(op.comment || '') + '</textarea>';

    const actionsCell = hasActions
      ? '<td><div class="table-actions">' + actionsHtml + '</div></td>'
      : '';

    const rowClasses = [];
    if (matchesUser) rowClasses.push('executor-highlight');
    if (centerHighlightTerm && (op.centerName || '').toLowerCase().includes(centerHighlightTerm)) {
      rowClasses.push('center-highlight');
    }
    const highlightClass = rowClasses.length ? ' class="' + rowClasses.join(' ') + '"' : '';
    html += '<tr data-row-id="' + rowId + '"' + highlightClass + '>' +
      '<td>' + (idx + 1) + '</td>' +
      '<td>' + escapeHtml(op.centerName) + '</td>' +
      '<td>' + escapeHtml(op.opCode || '') + '</td>' +
      '<td>' + renderOpName(op) + '</td>' +
      (showQuantityColumn ? '<td>' + escapeHtml(getOperationQuantity(op, card)) + '</td>' : '') +
      '<td>' + renderExecutorCell(op, card, { readonly: readonly || lockExecutors }) + '</td>' +
      '<td>' + (op.plannedMinutes || '') + '</td>' +
      '<td>' + statusBadge(op.status) + '</td>' +
      '<td>' + timeCell + '</td>' +
      actionsCell +
      '<td>' + commentCell + '</td>' +
      '</tr>';

    html += renderQuantityRow(card, op, { readonly: readonly || lockQuantities, colspan: totalColumns, blankForPrint: quantityPrintBlanks });
  });

  html += '</tbody></table>';
  return '<div class="table-wrapper operations-table-wrapper">' + html + '</div>';
}

function formatQuantityValue(val) {
  if (val === '' || val == null) return '';
  return val + ' шт';
}

function resolveCardField(card, ...fields) {
  if (!card) return '';
  for (const field of fields) {
    const raw = card[field];
    if (raw === null || raw === undefined) continue;
    const value = typeof raw === 'string' ? raw.trim() : raw;
    if (value !== '') return value;
  }
  return '';
}

function formatMultilineValue(value, { multiline = false } = {}) {
  if (value === '' || value == null) return '—';
  const safe = escapeHtml(String(value));
  return multiline ? safe.replace(/\n/g, '<br>') : safe;
}

function formatCardMainSummaryFromCard(card) {
  const name = resolveCardField(card, 'itemName', 'name');
  const quantity = resolveCardField(card, 'batchSize', 'quantity');
  const routeNumber = resolveCardField(card, 'routeCardNumber', 'orderNo');
  return formatCardMainSummaryText({ name, quantity, routeNumber });
}

function renderCardDisplayField(label, value, { multiline = false, fullWidth = false } = {}) {
  const classes = ['card-display-field'];
  if (fullWidth) classes.push('card-display-field-full');
  const content = formatMultilineValue(value, { multiline });
  return '<div class="' + classes.join(' ') + '">' +
    '<div class="field-label">' + escapeHtml(label) + '</div>' +
    '<div class="field-value' + (multiline ? ' multiline' : '') + '">' + content + '</div>' +
    '</div>';
}

function buildCardInfoBlock(card, { collapsible = true, startCollapsed = false } = {}) {
  if (!card) return '';

  const routeCardNumber = resolveCardField(card, 'routeCardNumber', 'orderNo');
  const documentDesignation = resolveCardField(card, 'documentDesignation', 'drawing');
  const documentDate = formatDateInputValue(resolveCardField(card, 'documentDate'));
  const issuedBySurname = resolveCardField(card, 'issuedBySurname');
  const programName = resolveCardField(card, 'programName');
  const labRequestNumber = resolveCardField(card, 'labRequestNumber');
  const workBasis = resolveCardField(card, 'workBasis', 'contractNumber');
  const supplyState = resolveCardField(card, 'supplyState');
  const itemDesignation = resolveCardField(card, 'itemDesignation', 'drawing');
  const supplyStandard = resolveCardField(card, 'supplyStandard');
  const itemName = resolveCardField(card, 'itemName', 'name');
  const mainMaterials = resolveCardField(card, 'mainMaterials');
  const mainMaterialGrade = resolveCardField(card, 'mainMaterialGrade', 'material');
  const batchSize = resolveCardField(card, 'batchSize', 'quantity');
  const itemSerials = formatItemSerialsValue(card);
  const specialNotes = resolveCardField(card, 'specialNotes', 'desc');
  const responsibleProductionChief = resolveCardField(card, 'responsibleProductionChief');
  const responsibleSKKChief = resolveCardField(card, 'responsibleSKKChief');
  const responsibleTechLead = resolveCardField(card, 'responsibleTechLead');

  const summaryText = formatCardMainSummaryFromCard(card);
  const batchLabel = batchSize === '' || batchSize == null ? '—' : toSafeCount(batchSize);

  const blockClasses = ['card-main-collapse-block', 'card-info-collapse-block'];
  if (!collapsible) blockClasses.push('card-info-static');
  const attrs = ['class="' + blockClasses.join(' ') + '"', 'data-card-id="' + card.id + '"'];
  if (collapsible && startCollapsed) attrs.push('data-start-collapsed="true"');

  let html = '<div ' + attrs.join(' ') + '>';
  html += '<div class="card-main-header">' +
    '<h3 class="card-main-title">Основные данные</h3>' +
    '<div class="card-main-summary">' + escapeHtml(summaryText) + '</div>' +
    (collapsible ? '<button type="button" class="btn-secondary card-main-toggle card-info-toggle" aria-expanded="true">Свернуть</button>' : '') +
    '</div>';

  html += '<div class="card-main-collapse-body">';
  html += '<div class="card-info-block">';
  html += '<div class="card-meta-grid card-meta-grid-compact card-display-grid">' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Маршрутная карта №', routeCardNumber) +
    renderCardDisplayField('Обозначение документа', documentDesignation) +
    renderCardDisplayField('Дата', documentDate) +
    '</div>' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Фамилия выписавшего маршрутную карту', issuedBySurname) +
    renderCardDisplayField('Название программы', programName) +
    renderCardDisplayField('Номер заявки лаборатории', labRequestNumber) +
    '</div>' +
    '</div>';

  html += '<div class="card-meta-grid card-meta-grid-compact card-display-grid">' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Основание для выполнения работ', workBasis, { multiline: true }) +
    '</div>' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Состояние поставки', supplyState) +
    '</div>' +
    '</div>';

  html += '<div class="card-meta-grid card-meta-grid-compact card-display-grid">' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Обозначение изделия', itemDesignation) +
    '</div>' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('НТД на поставку', supplyStandard) +
    '</div>' +
    '</div>';

  html += '<div class="card-display-field card-display-field-full">' +
    '<div class="field-label">Наименование изделия</div>' +
    '<div class="field-value multiline">' + formatMultilineValue(itemName, { multiline: true }) + '</div>' +
    '</div>';

  html += '<div class="card-meta-grid card-meta-grid-compact card-display-grid">' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Основные материалы, применяемые в техпроцессе (согласно заказу на производство)', mainMaterials, { multiline: true }) +
    '</div>' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Марка основного материала', mainMaterialGrade) +
    '</div>' +
    '</div>';

  html += '<div class="card-meta-grid card-meta-grid-compact card-display-grid">' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Размер партии', batchLabel) +
    '</div>' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Индивидуальные номера изделий', itemSerials, { multiline: true }) +
    '</div>' +
    '</div>';

  html += renderCardDisplayField('Особые отметки', specialNotes, { multiline: true, fullWidth: true });

  html += '<div class="card-meta-grid card-meta-grid-compact card-display-grid card-meta-responsible">' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Начальник производства (ФИО)', responsibleProductionChief) +
    '</div>' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Начальник СКК (ФИО)', responsibleSKKChief) +
    '</div>' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('ЗГД по технологиям (ФИО)', responsibleTechLead) +
    '</div>' +
    '</div>';

  html += '</div>';
  html += '</div>';
  html += '</div>';
  return html;
}

function setCardInfoCollapsed(block, collapsed) {
  if (!block) return;
  const toggle = block.querySelector('.card-info-toggle');
  block.classList.toggle('is-collapsed', !!collapsed);
  if (toggle) {
    toggle.textContent = collapsed ? 'Развернуть' : 'Свернуть';
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }
}

function bindCardInfoToggles(root, { defaultCollapsed = true } = {}) {
  if (!root) return;
  root.querySelectorAll('.card-info-collapse-block').forEach(block => {
    const toggle = block.querySelector('.card-info-toggle');
    if (!toggle) return;
    const startCollapsed = block.hasAttribute('data-start-collapsed')
      ? block.getAttribute('data-start-collapsed') !== 'false'
      : defaultCollapsed;
    setCardInfoCollapsed(block, startCollapsed);
    toggle.addEventListener('click', () => {
      setCardInfoCollapsed(block, !block.classList.contains('is-collapsed'));
    });
  });
}

function renderQuantityRow(card, op, { readonly = false, colspan = 9, blankForPrint = false } = {}) {
  if (card && card.useItemList) {
    return renderItemListRow(card, op, { readonly, colspan, blankForPrint });
  }
  const opQty = getOperationQuantity(op, card);
  const totalLabel = opQty === '' ? '—' : opQty + ' шт';
  const base = '<span class="qty-total">Количество изделий: ' + escapeHtml(totalLabel) + '</span>';
  const lockRow = readonly || op.status === 'DONE';
  const goodVal = op.goodCount != null ? op.goodCount : 0;
  const scrapVal = op.scrapCount != null ? op.scrapCount : 0;
  const holdVal = op.holdCount != null ? op.holdCount : 0;

  if (lockRow) {
    const chipGood = blankForPrint ? '____' : escapeHtml(goodVal);
    const chipScrap = blankForPrint ? '____' : escapeHtml(scrapVal);
    const chipHold = blankForPrint ? '____' : escapeHtml(holdVal);

    return '<tr class="op-qty-row"><td colspan="' + colspan + '">' +
      '<div class="qty-row-content readonly">' +
      base +
      '<span class="qty-chip">Годные: ' + chipGood + '</span>' +
      '<span class="qty-chip">Брак: ' + chipScrap + '</span>' +
      '<span class="qty-chip">Задержано: ' + chipHold + '</span>' +
      '</div>' +
      '</td></tr>';
  }

  return '<tr class="op-qty-row" data-card-id="' + card.id + '" data-op-id="' + op.id + '"><td colspan="' + colspan + '">' +
    '<div class="qty-row-content">' +
    base +
    '<label>Годные <input type="number" class="qty-input" data-qty-type="good" data-card-id="' + card.id + '" data-op-id="' + op.id + '" min="0" value="' + goodVal + '"></label>' +
    '<label>Брак <input type="number" class="qty-input" data-qty-type="scrap" data-card-id="' + card.id + '" data-op-id="' + op.id + '" min="0" value="' + scrapVal + '"></label>' +
    '<label>Задержано <input type="number" class="qty-input" data-qty-type="hold" data-card-id="' + card.id + '" data-op-id="' + op.id + '" min="0" value="' + holdVal + '"></label>' +
    '</div>' +
    '</td></tr>';
}

function renderItemListRow(card, op, { readonly = false, colspan = 9, blankForPrint = false } = {}) {
  const items = Array.isArray(op.items) ? op.items : [];
  const lockRow = readonly || op.status === 'DONE';
  const itemBlocks = items.length
    ? items.map((item, idx) => {
      const goodVal = item.goodCount != null ? item.goodCount : 0;
      const scrapVal = item.scrapCount != null ? item.scrapCount : 0;
      const holdVal = item.holdCount != null ? item.holdCount : 0;
      const qtyVal = item.quantity != null ? toSafeCount(item.quantity) : 1;
      if (lockRow) {
        const goodText = blankForPrint ? '____' : escapeHtml(goodVal);
        const scrapText = blankForPrint ? '____' : escapeHtml(scrapVal);
        const holdText = blankForPrint ? '____' : escapeHtml(holdVal);
        return '<div class="item-block readonly">' +
          '<div class="item-name">' + escapeHtml(item.name || ('Изделие ' + (idx + 1))) + '</div>' +
          '<div class="item-qty">' + escapeHtml(qtyVal) + ' шт</div>' +
          '<div class="item-chips">' +
          '<span class="qty-chip">Годные: ' + goodText + '</span>' +
          '<span class="qty-chip">Брак: ' + scrapText + '</span>' +
          '<span class="qty-chip">Задержано: ' + holdText + '</span>' +
          '</div>' +
          '</div>';
      }

      return '<div class="item-block" data-card-id="' + card.id + '" data-op-id="' + op.id + '" data-item-id="' + (item.id || '') + '">' +
        '<div class="item-name">' + escapeHtml(item.name || ('Изделие ' + (idx + 1))) + '</div>' +
        '<div class="item-qty">' + escapeHtml(qtyVal) + ' шт</div>' +
        '<div class="item-inputs">' +
        '<label>Годные <input type="number" class="item-status-input" data-qty-type="good" data-item-id="' + (item.id || '') + '" data-op-id="' + op.id + '" data-card-id="' + card.id + '" data-item-qty="' + qtyVal + '" min="0" value="' + goodVal + '"></label>' +
        '<label>Брак <input type="number" class="item-status-input" data-qty-type="scrap" data-item-id="' + (item.id || '') + '" data-op-id="' + op.id + '" data-card-id="' + card.id + '" data-item-qty="' + qtyVal + '" min="0" value="' + scrapVal + '"></label>' +
        '<label>Задержано <input type="number" class="item-status-input" data-qty-type="hold" data-item-id="' + (item.id || '') + '" data-op-id="' + op.id + '" data-card-id="' + card.id + '" data-item-qty="' + qtyVal + '" min="0" value="' + holdVal + '"></label>' +
        '</div>' +
        '</div>';
    }).join('')
    : '<span class="items-empty">Список изделий пуст</span>';

  const cardId = card ? card.id : '';
  return '<tr class="op-qty-row op-items-row" data-card-id="' + cardId + '" data-op-id="' + op.id + '"><td colspan="' + colspan + '">' +
    '<div class="items-row-header">Список изделий</div>' +
    '<div class="items-row-content">' + itemBlocks + '</div>' +
    '</td></tr>';
}

function applyOperationAction(action, card, op, { anchorGroupId = null, useWorkorderScrollLock = true } = {}) {
  if (!card || !op) return;

  const syncQuantitiesFromInputs = () => {
    const fieldMap = { good: 'goodCount', scrap: 'scrapCount', hold: 'holdCount' };
    const selectorBase = '[data-card-id="' + card.id + '"][data-op-id="' + op.id + '"]';

    document.querySelectorAll('.qty-input' + selectorBase).forEach(input => {
      const type = input.getAttribute('data-qty-type');
      const field = fieldMap[type] || null;
      if (!field) return;
      const val = toSafeCount(input.value);
      const prev = toSafeCount(op[field] || 0);
      if (prev === val) return;
      op[field] = val;
      recordCardLog(card, { action: 'Количество деталей', object: opLogLabel(op), field, targetId: op.id, oldValue: prev, newValue: val });
    });

    if (!card.useItemList) return;

    document.querySelectorAll('.item-status-input' + selectorBase).forEach(input => {
      const itemId = input.getAttribute('data-item-id');
      const type = input.getAttribute('data-qty-type');
      const field = fieldMap[type] || null;
      if (!field || !itemId) return;
      const item = (op.items || []).find(it => it.id === itemId);
      if (!item) return;
      const maxVal = item.quantity != null ? item.quantity : 1;
      const val = clampToSafeCount(input.value, maxVal);
      const prev = toSafeCount(item[field] || 0);
      if (prev === val) return;
      item[field] = val;
      recordCardLog(card, { action: 'Количество изделия', object: opLogLabel(op), field: 'item.' + field, targetId: item.id, oldValue: prev, newValue: val });
    });

    if (card.useItemList) {
      normalizeOperationItems(card, op);
    }
  };

  const execute = () => {
    const prevStatus = op.status;
    const prevElapsed = op.elapsedSeconds || 0;
    const prevCardStatus = card.status;

    syncQuantitiesFromInputs();

    if (action === 'start') {
      const now = Date.now();
      if (!op.firstStartedAt) op.firstStartedAt = now;
      op.status = 'IN_PROGRESS';
      op.startedAt = now;
      op.lastPausedAt = null;
      op.finishedAt = null;
      op.actualSeconds = null;
      op.elapsedSeconds = 0;
    } else if (action === 'pause') {
      if (op.status === 'IN_PROGRESS') {
        const now = Date.now();
        const diff = op.startedAt ? (now - op.startedAt) / 1000 : 0;
        op.elapsedSeconds = (op.elapsedSeconds || 0) + diff;
        op.lastPausedAt = now;
        op.startedAt = null;
        op.status = 'PAUSED';
      }
    } else if (action === 'resume') {
      const now = Date.now();
      if (op.status === 'DONE' && typeof op.elapsedSeconds !== 'number') {
        op.elapsedSeconds = op.actualSeconds || 0;
      }
      if (!op.firstStartedAt) op.firstStartedAt = now;
      op.status = 'IN_PROGRESS';
      op.startedAt = now;
      op.lastPausedAt = null;
      op.finishedAt = null;
    } else if (action === 'stop') {
      const now = Date.now();
      if (op.status === 'IN_PROGRESS') {
        const diff = op.startedAt ? (now - op.startedAt) / 1000 : 0;
        op.elapsedSeconds = (op.elapsedSeconds || 0) + diff;
      }
      const qtyTotal = getOperationQuantity(op, card);
      if (card.useItemList) {
        normalizeOperationItems(card, op);
        const wrongItem = (op.items || []).find(item => {
          const expected = item.quantity != null ? item.quantity : 1;
          const total = toSafeCount(item.goodCount || 0) + toSafeCount(item.scrapCount || 0) + toSafeCount(item.holdCount || 0);
          return expected > 0 && total !== expected;
        });
        if (wrongItem) {
          alert('Количество по изделию "' + (wrongItem.name || 'Изделие') + '" не совпадает');
          return;
        }
      } else if (qtyTotal > 0) {
        const sum = toSafeCount(op.goodCount || 0) + toSafeCount(op.scrapCount || 0) + toSafeCount(op.holdCount || 0);
        if (sum !== qtyTotal) {
          alert('Количество деталей не совпадает');
          return;
        }
      }
      op.startedAt = null;
      op.finishedAt = now;
      op.lastPausedAt = null;
      op.actualSeconds = op.elapsedSeconds || 0;
      op.status = 'DONE';
    }

    recalcCardStatus(card);
    if (prevStatus !== op.status) {
      recordCardLog(card, { action: 'Статус операции', object: opLogLabel(op), field: 'status', targetId: op.id, oldValue: prevStatus, newValue: op.status });
    }
    if (prevElapsed !== op.elapsedSeconds && op.status === 'DONE') {
      recordCardLog(card, { action: 'Факт. время', object: opLogLabel(op), field: 'elapsedSeconds', targetId: op.id, oldValue: Math.round(prevElapsed), newValue: Math.round(op.elapsedSeconds || 0) });
    }
    if (prevCardStatus !== card.status) {
      recordCardLog(card, { action: 'Статус карты', object: 'Карта', field: 'status', oldValue: prevCardStatus, newValue: card.status });
    }
    saveData();
    renderEverything();
  };

  suppressWorkorderAutoscroll = true;
  try {
    if (useWorkorderScrollLock) {
      withWorkorderScrollLock(execute, { anchorCardId: card.id, anchorGroupId });
    } else {
      execute();
    }
  } finally {
    suppressWorkorderAutoscroll = false;
  }
}

function isMobileOperationsLayout() {
  return window.innerWidth <= MOBILE_OPERATIONS_BREAKPOINT;
}

function closeMobileOperationsView() {
  const container = document.getElementById('mobile-operations-view');
  if (!container) return;
  activeMobileCardId = null;
  activeMobileGroupId = null;
  mobileOpsScrollTop = 0;
  if (mobileOpsObserver) {
    mobileOpsObserver.disconnect();
    mobileOpsObserver = null;
  }
  container.classList.add('hidden');
  container.innerHTML = '';
  document.body.classList.remove('mobile-ops-open');
  window.scrollTo({ top: mobileWorkorderScroll, left: 0 });
}

function buildMobileItemsBlock(card, op) {
  const items = Array.isArray(op.items) ? op.items : [];
  if (!card.useItemList) return '';
  const header = '<div class="card-section-title">Список изделий (' + items.length + ')</div>';
  if (!items.length) {
    return '<div class="mobile-items">' + header + '<p class="hint">Список изделий пуст</p></div>';
  }
  const list = items.map((item, idx) => {
    const qtyVal = item.quantity != null ? toSafeCount(item.quantity) : 1;
    const baseTitle = escapeHtml(item.name || ('Изделие ' + (idx + 1)));
    return '<div class="mobile-item-card" data-item-id="' + (item.id || '') + '">' +
      '<div class="mobile-op-name">' + baseTitle + '</div>' +
      '<div class="mobile-op-meta">' + qtyVal + ' шт.</div>' +
      '<div class="mobile-qty-grid">' +
      '<label>Годные <input type="number" class="item-status-input" data-qty-type="good" data-item-id="' + (item.id || '') + '" data-op-id="' + op.id + '" data-card-id="' + card.id + '" data-item-qty="' + qtyVal + '" min="0" value="' + (item.goodCount || 0) + '"></label>' +
      '<label>Брак <input type="number" class="item-status-input" data-qty-type="scrap" data-item-id="' + (item.id || '') + '" data-op-id="' + op.id + '" data-card-id="' + card.id + '" data-item-qty="' + qtyVal + '" min="0" value="' + (item.scrapCount || 0) + '"></label>' +
      '<label>Задержано <input type="number" class="item-status-input" data-qty-type="hold" data-item-id="' + (item.id || '') + '" data-op-id="' + op.id + '" data-card-id="' + card.id + '" data-item-qty="' + qtyVal + '" min="0" value="' + (item.holdCount || 0) + '"></label>' +
      '</div>' +
      '</div>';
  }).join('');
  return '<div class="mobile-items">' + header + list + '</div>';
}

function buildMobileQtyBlock(card, op) {
  if (card.useItemList) {
    return buildMobileItemsBlock(card, op);
  }
  const opQty = getOperationQuantity(op, card);
  return '<div class="card-section-title">Количество изделий: ' + escapeHtml(opQty || '—') + (opQty ? ' шт' : '') + '</div>' +
    '<div class="mobile-qty-grid" data-card-id="' + card.id + '" data-op-id="' + op.id + '">' +
    '<label>Годные <input type="number" class="qty-input" data-qty-type="good" data-card-id="' + card.id + '" data-op-id="' + op.id + '" min="0" value="' + (op.goodCount || 0) + '"></label>' +
    '<label>Брак <input type="number" class="qty-input" data-qty-type="scrap" data-card-id="' + card.id + '" data-op-id="' + op.id + '" min="0" value="' + (op.scrapCount || 0) + '"></label>' +
    '<label>Задержано <input type="number" class="qty-input" data-qty-type="hold" data-card-id="' + card.id + '" data-op-id="' + op.id + '" min="0" value="' + (op.holdCount || 0) + '"></label>' +
    '</div>';
}

function buildMobileOperationCard(card, op, idx, total) {
  const rowId = card.id + '::' + op.id;
  const elapsed = getOperationElapsedSeconds(op);
  const timeText = op.status === 'IN_PROGRESS' || op.status === 'PAUSED'
    ? '<span class="wo-timer" data-row-id="' + rowId + '">' + formatSecondsToHMS(elapsed) + '</span>'
    : (op.status === 'DONE' ? formatSecondsToHMS(op.elapsedSeconds || op.actualSeconds || 0) : '—');
  let actionsHtml = '';
  if (op.status === 'NOT_STARTED' || !op.status) {
    actionsHtml = '<button class="btn-primary" data-action="start" data-card-id="' + card.id + '" data-op-id="' + op.id + '">Начать</button>';
  } else if (op.status === 'IN_PROGRESS') {
    actionsHtml = '<button class="btn-secondary" data-action="pause" data-card-id="' + card.id + '" data-op-id="' + op.id + '">Пауза</button>' +
      '<button class="btn-secondary" data-action="stop" data-card-id="' + card.id + '" data-op-id="' + op.id + '">Завершить</button>';
  } else if (op.status === 'PAUSED') {
    actionsHtml = '<button class="btn-primary" data-action="resume" data-card-id="' + card.id + '" data-op-id="' + op.id + '">Продолжить</button>' +
      '<button class="btn-secondary" data-action="stop" data-card-id="' + card.id + '" data-op-id="' + op.id + '">Завершить</button>';
  } else if (op.status === 'DONE') {
    actionsHtml = '<button class="btn-primary" data-action="resume" data-card-id="' + card.id + '" data-op-id="' + op.id + '">Продолжить</button>';
  }

  return '<article class="mobile-op-card" data-op-index="' + (idx + 1) + '">' +
    '<div class="mobile-op-top op-card-header">' +
    '<div class="op-title">' +
    '<div class="mobile-op-name">' + (idx + 1) + '. ' + renderOpName(op) + '</div>' +
    '<div class="mobile-op-meta">Подразделение: ' + escapeHtml(op.centerName) + ' • Код операции: ' + escapeHtml(op.opCode || '') + '</div>' +
    '</div>' +
    '<div class="op-status">' + statusBadge(op.status) + '</div>' +
    '</div>' +
    '<div class="mobile-executor-block">' +
    '<div class="card-section-title">Исполнитель <span class="hint" style="font-weight:400; font-size:12px;">(доп. до 3)</span></div>' +
    renderExecutorCell(op, card, { mobile: true }) +
    '</div>' +
    '<div class="mobile-plan-time">' +
    '<div><div class="card-section-title">План (мин)</div><div>' + escapeHtml(op.plannedMinutes || '') + '</div></div>' +
    '<div><div class="card-section-title">Текущее / факт. время</div><div>' + timeText + '</div></div>' +
    '</div>' +
    '<div class="mobile-qty-block">' + buildMobileQtyBlock(card, op) + '</div>' +
    '<div class="mobile-actions">' + actionsHtml + '</div>' +
    '<div class="mobile-op-comment">' +
    '<div class="card-section-title">Комментарий</div>' +
    (op.status === 'DONE'
      ? '<div class="comment-readonly">' + escapeHtml(op.comment || '') + '</div>'
      : '<textarea class="comment-input" data-card-id="' + card.id + '" data-op-id="' + op.id + '" maxlength="40" rows="2" placeholder="Комментарий">' + escapeHtml(op.comment || '') + '</textarea>') +
    '</div>' +
    '</article>';
}

function buildMobileOperationsView(card, { groupId = null, preserveScroll = false } = {}) {
  const container = document.getElementById('mobile-operations-view');
  if (!container || !card) return;
  const opsSorted = [...(card.operations || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const titleHtml = formatCardNameWithGroupPosition(card);
  const status = cardStatusText(card);
  const subtitle = card.groupId ? '' : '';
  const headerActions = '<div class="mobile-ops-actions">' +
    '<span class="status-pill">' + escapeHtml(status) + '</span>' +
    '<button type="button" class="btn-small btn-secondary barcode-view-btn" data-allow-view="true" data-card-id="' + card.id + '">Штрихкод</button>' +
    '<button type="button" class="btn-small btn-secondary log-btn" data-allow-view="true" data-log-card="' + card.id + '">Log</button>' +
    '</div>';

  const cardsHtml = opsSorted.map((op, idx) => buildMobileOperationCard(card, op, idx, opsSorted.length)).join('');
  container.innerHTML =
    '<div class="mobile-ops-header">' +
    '<div class="mobile-ops-header-row">' +
    '<button type="button" id="mobile-ops-back" class="btn-secondary mobile-ops-back" aria-label="Назад">← Назад</button>' +
    '<div class="mobile-ops-title">' + titleHtml + '</div>' +
    '</div>' +
    (subtitle ? '<div class="mobile-ops-subtitle">' + subtitle + '</div>' : '') +
    headerActions +
    '</div>' +
    '<div class="mobile-ops-indicator" id="mobile-ops-indicator">Операция 1 / ' + opsSorted.length + '</div>' +
    '<div class="mobile-ops-list" id="mobile-ops-list">' + cardsHtml + '</div>';

  const listEl = container.querySelector('#mobile-ops-list');
  if (preserveScroll) {
    listEl.scrollTop = mobileOpsScrollTop;
  } else {
    listEl.scrollTop = 0;
  }

  const updateIndicator = () => {
    const indicator = container.querySelector('#mobile-ops-indicator');
    if (!indicator) return;
    const cards = Array.from(listEl.querySelectorAll('.mobile-op-card'));
    if (!cards.length) return;
    const listTop = listEl.getBoundingClientRect().top;
    let minIdx = 0;
    let minDelta = Infinity;
    cards.forEach((cardEl, idx) => {
      const delta = Math.abs(cardEl.getBoundingClientRect().top - listTop);
      if (delta < minDelta) {
        minDelta = delta;
        minIdx = idx;
      }
    });
    indicator.textContent = 'Операция ' + (minIdx + 1) + ' / ' + cards.length;
  };

  listEl.addEventListener('scroll', () => {
    mobileOpsScrollTop = listEl.scrollTop;
    updateIndicator();
  });
  updateIndicator();

  const backBtn = container.querySelector('#mobile-ops-back');
  if (backBtn) {
    backBtn.addEventListener('click', () => closeMobileOperationsView());
  }

  bindOperationControls(container, { readonly: isTabReadonly('workorders') });

  container.classList.remove('hidden');
  document.body.classList.add('mobile-ops-open');
  mobileOpsScrollTop = listEl.scrollTop;
}

function openMobileOperationsView(cardId, groupId = null) {
  const groupCard = groupId ? cards.find(c => c.id === groupId && isGroupCard(c)) : null;
  const card = groupCard
    ? (getGroupChildren(groupCard).find(c => c.id === cardId) || groupCard)
    : cards.find(c => c.id === cardId);
  if (!card) return;
  mobileWorkorderScroll = window.scrollY;
  activeMobileCardId = card.id;
  activeMobileGroupId = groupId;
  buildMobileOperationsView(card, { groupId });
}

function bindOperationControls(root, { readonly = false } = {}) {
  if (!root) return;

  root.querySelectorAll('.barcode-view-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-card-id');
      const card = cards.find(c => c.id === id);
      if (!card) return;
      openBarcodeModal(card);
    });
  });

  root.querySelectorAll('.log-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-log-card');
      openLogModal(id);
    });
  });

  root.querySelectorAll('.comment-input').forEach(input => {
    autoResizeComment(input);
    const cardId = input.getAttribute('data-card-id');
    const opId = input.getAttribute('data-op-id');
    const card = cards.find(c => c.id === cardId);
    const op = card ? (card.operations || []).find(o => o.id === opId) : null;
    if (!op) return;

    input.addEventListener('focus', () => {
      input.dataset.prevComment = op.comment || '';
    });

    input.addEventListener('input', e => {
      const value = (e.target.value || '').slice(0, 40);
      e.target.value = value;
      op.comment = value;
      autoResizeComment(e.target);
    });

    input.addEventListener('blur', e => {
      const value = (e.target.value || '').slice(0, 40);
      e.target.value = value;
      const prev = input.dataset.prevComment || '';
      if (prev !== value) {
        recordCardLog(card, { action: 'Комментарий', object: opLogLabel(op), field: 'comment', targetId: op.id, oldValue: prev, newValue: value });
      }
      op.comment = value;
      saveData();
      renderDashboard();
    });
  });

  root.querySelectorAll('.executor-main-input').forEach(input => {
    const mobileCombo = isMobileExecutorInput(input);
    let isComposing = false;
    const runFiltering = () => updateExecutorCombo(input, { forceOpen: true });
    const comboWrapper = input.closest('.executor-combobox');
    const arrow = comboWrapper ? comboWrapper.querySelector('.executor-arrow') : null;

    if (arrow) {
      arrow.addEventListener('pointerdown', e => {
        e.preventDefault();
        input.focus({ preventScroll: true });
        runFiltering();
      });
    }

    if (mobileCombo) {
      input.addEventListener('compositionstart', () => { isComposing = true; });
      input.addEventListener('compositionend', () => { isComposing = false; runFiltering(); });
    }

    input.addEventListener('focus', () => {
      input.dataset.prevVal = input.value || '';
      runFiltering();
    });
    input.addEventListener('click', runFiltering);
    input.addEventListener('touchstart', runFiltering);
    input.addEventListener('input', e => {
      const cardId = input.getAttribute('data-card-id');
      const opId = input.getAttribute('data-op-id');
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!op) return;
      op.executor = sanitizeExecutorName((e.target.value || '').trim());
      if (!op.executor && (e.target.value || '').trim()) {
        e.target.value = '';
      }
      if (mobileCombo) {
        if (!isComposing) runFiltering();
      } else {
        updateExecutorCombo(input, { forceOpen: true });
      }
    });
    input.addEventListener('blur', e => {
      const cardId = input.getAttribute('data-card-id');
      const opId = input.getAttribute('data-op-id');
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!op || !card) return;
      const raw = (e.target.value || '').trim();
      const value = sanitizeExecutorName(raw);
      const prev = input.dataset.prevVal || '';
      if (value && !isEligibleExecutorName(value)) {
        alert('Выберите исполнителя со статусом "Рабочий" (пользователь Abyss недоступен).');
        e.target.value = '';
        op.executor = '';
        updateExecutorCombo(input);
        return;
      }
      if (!value && raw) {
        alert('Пользователь Abyss недоступен для выбора. Выберите другого исполнителя.');
        e.target.value = '';
      }
      op.executor = value;
      if (prev !== value) {
        recordCardLog(card, { action: 'Исполнитель', object: opLogLabel(op), field: 'executor', targetId: op.id, oldValue: prev, newValue: value });
        saveData();
        renderDashboard();
      }
      updateExecutorCombo(input);
    });
  });

  root.querySelectorAll('.add-executor-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cardId = btn.getAttribute('data-card-id');
      const opId = btn.getAttribute('data-op-id');
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!card || !op) return;
      if (!Array.isArray(op.additionalExecutors)) op.additionalExecutors = [];
      if (op.additionalExecutors.length >= 3) return;
      op.additionalExecutors.push('');
      recordCardLog(card, { action: 'Доп. исполнитель', object: opLogLabel(op), field: 'additionalExecutors', targetId: op.id, oldValue: op.additionalExecutors.length - 1, newValue: op.additionalExecutors.length });
      saveData();
      renderWorkordersTable();
      if (activeMobileCardId === card.id && isMobileOperationsLayout()) {
        buildMobileOperationsView(card, { groupId: activeMobileGroupId, preserveScroll: true });
      }
    });
  });

  root.querySelectorAll('.remove-executor-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cardId = btn.getAttribute('data-card-id');
      const opId = btn.getAttribute('data-op-id');
      const idx = parseInt(btn.getAttribute('data-extra-index'), 10);
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!card || !op || !Array.isArray(op.additionalExecutors)) return;
      if (idx < 0 || idx >= op.additionalExecutors.length) return;
      const removed = op.additionalExecutors.splice(idx, 1)[0];
      recordCardLog(card, { action: 'Доп. исполнитель', object: opLogLabel(op), field: 'additionalExecutors', targetId: op.id, oldValue: removed, newValue: 'удален' });
      saveData();
      renderWorkordersTable();
      if (activeMobileCardId === card.id && isMobileOperationsLayout()) {
        buildMobileOperationsView(card, { groupId: activeMobileGroupId, preserveScroll: true });
      }
    });
  });

  root.querySelectorAll('.additional-executor-input').forEach(input => {
    const mobileCombo = isMobileExecutorInput(input);
    let isComposing = false;
    const runFiltering = () => updateExecutorCombo(input, { forceOpen: true });
    const comboWrapper = input.closest('.executor-combobox');
    const arrow = comboWrapper ? comboWrapper.querySelector('.executor-arrow') : null;

    if (arrow) {
      arrow.addEventListener('pointerdown', e => {
        e.preventDefault();
        input.focus({ preventScroll: true });
        runFiltering();
      });
    }

    if (mobileCombo) {
      input.addEventListener('compositionstart', () => { isComposing = true; });
      input.addEventListener('compositionend', () => { isComposing = false; runFiltering(); });
    }

    input.addEventListener('focus', () => {
      input.dataset.prevVal = input.value || '';
      runFiltering();
    });
    input.addEventListener('click', runFiltering);
    input.addEventListener('touchstart', runFiltering);
    input.addEventListener('blur', e => {
      const cardId = input.getAttribute('data-card-id');
      const opId = input.getAttribute('data-op-id');
      const idx = parseInt(input.getAttribute('data-extra-index'), 10);
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!card || !op || !Array.isArray(op.additionalExecutors)) return;
      const raw = (e.target.value || '').trim();
      const value = sanitizeExecutorName(raw);
      const prev = input.dataset.prevVal || '';
      if (value && !isEligibleExecutorName(value)) {
        alert('Выберите исполнителя со статусом "Рабочий" (пользователь Abyss недоступен).');
        e.target.value = '';
        if (idx >= 0 && idx < op.additionalExecutors.length) {
          op.additionalExecutors[idx] = '';
        }
        updateExecutorCombo(input);
        return;
      }
      if (!value && raw) {
        alert('Пользователь Abyss недоступен для выбора. Выберите другого исполнителя.');
        e.target.value = '';
      }
      if (idx < 0 || idx >= op.additionalExecutors.length) return;
      op.additionalExecutors[idx] = value;
      if (prev !== value) {
        recordCardLog(card, { action: 'Доп. исполнитель', object: opLogLabel(op), field: 'additionalExecutors', targetId: op.id, oldValue: prev, newValue: value });
        saveData();
        renderDashboard();
      }
      updateExecutorCombo(input);
    });
    input.addEventListener('input', e => {
      const cardId = input.getAttribute('data-card-id');
      const opId = input.getAttribute('data-op-id');
      const idx = parseInt(input.getAttribute('data-extra-index'), 10);
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!card || !op || !Array.isArray(op.additionalExecutors)) return;
      if (idx < 0 || idx >= op.additionalExecutors.length) return;
      const raw = (e.target.value || '').trim();
      const value = sanitizeExecutorName(raw);
      op.additionalExecutors[idx] = value;
      if (mobileCombo) {
        if (!isComposing) runFiltering();
      } else {
        updateExecutorCombo(input, { forceOpen: true });
      }
    });
  });

  root.querySelectorAll('.item-status-input').forEach(input => {
    input.addEventListener('input', e => {
      const maxVal = toSafeCount(input.getAttribute('data-item-qty'));
      e.target.value = Math.min(maxVal, toSafeCount(e.target.value));
    });

    input.addEventListener('blur', e => {
      const cardId = input.getAttribute('data-card-id');
      const opId = input.getAttribute('data-op-id');
      const itemId = input.getAttribute('data-item-id');
      const type = input.getAttribute('data-qty-type');
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!card || !op || !Array.isArray(op.items)) return;
      const item = op.items.find(it => it.id === itemId);
      if (!item) return;
      const fieldMap = { good: 'goodCount', scrap: 'scrapCount', hold: 'holdCount' };
      const field = fieldMap[type] || null;
      if (!field) return;
      const maxVal = item.quantity != null ? item.quantity : 1;
      const val = Math.min(maxVal, toSafeCount(e.target.value));
      const prev = toSafeCount(item[field] || 0);
      if (prev === val) return;
      item[field] = val;
      normalizeOperationItems(card, op);
      recordCardLog(card, { action: 'Количество изделия', object: opLogLabel(op), field: 'item.' + field, targetId: item.id, oldValue: prev, newValue: val });
      saveData();
      renderDashboard();
      renderWorkordersTable();
      if (activeMobileCardId === card.id && isMobileOperationsLayout()) {
        buildMobileOperationsView(card, { groupId: activeMobileGroupId, preserveScroll: true });
      }
    });
  });

  root.querySelectorAll('.qty-input').forEach(input => {
    const cardId = input.getAttribute('data-card-id');
    const opId = input.getAttribute('data-op-id');
    const type = input.getAttribute('data-qty-type');
    const card = cards.find(c => c.id === cardId);
    const op = card ? (card.operations || []).find(o => o.id === opId) : null;
    if (!op || !card) return;

    input.addEventListener('input', e => {
      e.target.value = toSafeCount(e.target.value);
    });

    input.addEventListener('blur', e => {
      const val = toSafeCount(e.target.value);
      const fieldMap = { good: 'goodCount', scrap: 'scrapCount', hold: 'holdCount' };
      const field = fieldMap[type] || null;
      if (!field) return;
      const prev = toSafeCount(op[field] || 0);
      if (prev === val) return;
      op[field] = val;
      recordCardLog(card, { action: 'Количество деталей', object: opLogLabel(op), field, targetId: op.id, oldValue: prev, newValue: val });
      saveData();
      renderDashboard();
    });
  });

  root.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (readonly) return;
      const action = btn.getAttribute('data-action');
      const cardId = btn.getAttribute('data-card-id');
      const opId = btn.getAttribute('data-op-id');
      const card = cards.find(c => c.id === cardId);
      if (!card) return;
      const op = (card.operations || []).find(o => o.id === opId);
      if (!op) return;
      const detail = btn.closest('.wo-card');
      if (detail && detail.open) {
        workorderOpenCards.add(cardId);
      }
      const anchorGroupId = detail ? detail.getAttribute('data-group-id') : activeMobileGroupId;
      applyOperationAction(action, card, op, { anchorGroupId });
      if (activeMobileCardId === card.id && isMobileOperationsLayout()) {
        buildMobileOperationsView(card, { groupId: activeMobileGroupId, preserveScroll: true });
      }
    });
  });

  syncExecutorComboboxMode();
  applyReadonlyState('workorders', 'workorders');
}

function renderWorkordersTable({ collapseAll = false } = {}) {
  const wrapper = document.getElementById('workorders-table-wrapper');
  const readonly = isTabReadonly('workorders');
  const rootCards = cards.filter(c => !c.archived && !c.groupId);
  const hasOperations = rootCards.some(card => {
    if (isGroupCard(card)) {
      return getGroupChildren(card).some(ch => !ch.archived && ch.operations && ch.operations.length);
    }
    return card.operations && card.operations.length;
  });
  if (!hasOperations) {
    wrapper.innerHTML = '<p>Маршрутных операций пока нет.</p>';
    return;
  }

  if (collapseAll) {
    workorderOpenCards.clear();
    workorderOpenGroups.clear();
  }

  const termRaw = workorderSearchTerm.trim();
  const termLower = termRaw.toLowerCase();
  const hasTerm = !!termLower;
  const filteredByStatus = rootCards.filter(card => {
    const state = getCardProcessState(card);
    return workorderStatusFilter === 'ALL' || state.key === workorderStatusFilter;
  });

  const filteredByMissingExecutor = workorderMissingExecutorFilter === 'NO_EXECUTOR'
    ? filteredByStatus.filter(card => isGroupCard(card) ? groupHasMissingExecutors(card) : cardHasMissingExecutors(card))
    : filteredByStatus;

  if (!filteredByMissingExecutor.length) {
    wrapper.innerHTML = '<p>Нет карт, подходящих под выбранный фильтр.</p>';
    return;
  }

  const scoreFn = (card) => cardSearchScoreWithChildren(card, termRaw);
  let sortedCards = [...filteredByMissingExecutor];
  if (termRaw) {
    sortedCards.sort((a, b) => scoreFn(b) - scoreFn(a));
  }

  const filteredBySearch = termRaw
    ? sortedCards.filter(card => scoreFn(card) > 0)
    : sortedCards;

  if (!filteredBySearch.length) {
    wrapper.innerHTML = '<p>Карты по запросу не найдены.</p>';
    return;
  }

  let html = '';
  filteredBySearch.forEach(card => {
    if (isGroupCard(card)) {
      const children = getGroupChildren(card).filter(c => !c.archived);
      const groupMatches = !hasTerm || cardSearchScore(card, termRaw) > 0;
      const matchingChildren = hasTerm ? children.filter(ch => cardSearchScore(ch, termRaw) > 0) : children;
      if (!groupMatches && !matchingChildren.length) return;
      const opened = !collapseAll && workorderOpenGroups.has(card.id);
      const stateBadge = renderCardStateBadge(card);
      const missingBadge = groupHasMissingExecutors(card)
        ? '<span class="status-pill status-pill-missing-executor" title="Есть операции без исполнителя">Нет исполнителя</span>'
        : '';
      const groupExecutorBtn = readonly ? '' : '<button type="button" class="btn-small group-executor-btn" data-group-id="' + card.id + '"><span class="group-executor-label">Групповой<br>исполнитель</span></button>';
      const filesCount = (card.attachments || []).length;
      const contractText = card.contractNumber ? ' (Договор: ' + escapeHtml(card.contractNumber) + ')' : '';
      const barcodeButton = ' <button type="button" class="btn-small btn-secondary barcode-view-btn" data-card-id="' + card.id + '" title="Показать штрихкод" aria-label="Показать штрихкод">Штрихкод</button>';
      const filesButton = ' <button type="button" class="btn-small clip-btn inline-clip" data-card-id="' + card.id + '" data-attach-card="' + card.id + '">📎 <span class="clip-count">' + filesCount + '</span></button>';
      const inlineActions = '<span class="summary-inline-actions workorder-inline-actions">' + barcodeButton + filesButton + '</span>';
      const statusRow = '<div class="group-status-row">' +
        (missingBadge ? missingBadge + ' ' : '') +
        stateBadge +
        (groupExecutorBtn ? ' ' + groupExecutorBtn : '') +
        '</div>';
      const visibleChildren = hasTerm ? matchingChildren : children;
      const childrenHtml = visibleChildren.length
        ? visibleChildren.map(child => buildWorkorderCardDetails(child, { opened: !collapseAll && workorderOpenCards.has(child.id), allowArchive: false, readonly, highlightCenterTerm: termLower })).join('')
        : '<p class="group-empty">В группе нет карт для отображения.</p>';

      if (hasTerm && !groupMatches) {
        html += childrenHtml;
        return;
      }

      html += '<details class="wo-card group-wo-card" data-group-id="' + card.id + '"' + (opened ? ' open' : '') + '>' +
        '<summary>' +
        '<div class="summary-line">' +
        '<div class="summary-text">' +
        '<strong><span class="group-marker">(Г)</span>' + escapeHtml(formatCardTitle(card) || card.id) + '</strong>' +
        ' <span class="summary-sub">' +
        (card.orderNo ? ' (Заказ: ' + escapeHtml(card.orderNo) + ')' : '') + contractText +
        inlineActions +
        '</span>' +
        '</div>' +
        '<div class="summary-actions group-summary-actions">' +
        statusRow +
        (!readonly && card.status === 'DONE' ? ' <button type="button" class="btn-small btn-secondary archive-group-btn" data-group-id="' + card.id + '">Перенести в архив</button>' : '') +
        '</div>' +
        '</div>' +
        '</summary>' +
        '<div class="group-children">' + childrenHtml + '</div>' +
        '</details>';
    } else if (card.operations && card.operations.length) {
      const opened = !collapseAll && workorderOpenCards.has(card.id);
      html += buildWorkorderCardDetails(card, { opened, readonly, highlightCenterTerm: termLower });
    }
  });

  wrapper.innerHTML = html;
  bindCardInfoToggles(wrapper);

  wrapper.querySelectorAll('.group-wo-card').forEach(detail => {
    const groupId = detail.getAttribute('data-group-id');
    if (detail.open && groupId) {
      workorderOpenGroups.add(groupId);
    }
    markWorkorderToggleState(detail);
    detail.addEventListener('toggle', () => {
      if (!groupId) return;
      if (detail.open) {
        workorderOpenGroups.add(groupId);
        if (shouldScrollAfterWorkorderToggle(detail)) {
          // Автоскролл только после раскрытия ранее закрытой группы.
          scrollWorkorderDetailsIntoViewIfNeeded(detail);
        }
      } else {
        workorderOpenGroups.delete(groupId);
        markWorkorderToggleState(detail);
      }
    });
  });

  wrapper.querySelectorAll('.wo-card[data-card-id]').forEach(detail => {
    const cardId = detail.getAttribute('data-card-id');
    if (detail.open && cardId) {
      workorderOpenCards.add(cardId);
    }
    const summary = detail.querySelector('summary');
    if (summary) {
      summary.addEventListener('click', (e) => {
        if (!isMobileOperationsLayout()) return;
        e.preventDefault();
        e.stopPropagation();
        openMobileOperationsView(cardId, detail.getAttribute('data-group-id'));
      });
    }
    markWorkorderToggleState(detail);
    detail.addEventListener('toggle', () => {
      if (!cardId) return;
      if (detail.open) {
        workorderOpenCards.add(cardId);
        if (shouldScrollAfterWorkorderToggle(detail)) {
          // Скроллим только в момент раскрытия закрытой карточки.
          scrollWorkorderDetailsIntoViewIfNeeded(detail);
        }
      } else {
        workorderOpenCards.delete(cardId);
        markWorkorderToggleState(detail);
      }
    });
  });

  wrapper.querySelectorAll('.barcode-view-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-card-id');
      const card = cards.find(c => c.id === id);
      if (!card) return;
      openBarcodeModal(card);
    });
  });

  wrapper.querySelectorAll('button[data-attach-card]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-attach-card');
      openAttachmentsModal(id, 'live');
    });
  });

  wrapper.querySelectorAll('.group-executor-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const groupId = btn.getAttribute('data-group-id');
      openGroupExecutorModal(groupId);
    });
  });

  wrapper.querySelectorAll('.log-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-log-card');
      openLogModal(id);
    });
  });

  wrapper.querySelectorAll('.archive-group-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-group-id');
      const group = cards.find(c => c.id === id && isGroupCard(c));
      if (!group) return;
      const related = [group, ...getGroupChildren(group)];
      related.forEach(card => {
        if (!card.archived) {
          recordCardLog(card, { action: 'Архивирование', object: 'Карта', field: 'archived', oldValue: false, newValue: true });
        }
        card.archived = true;
      });
      saveData();
      renderEverything();
    });
  });

  wrapper.querySelectorAll('.archive-move-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-card-id');
      const card = cards.find(c => c.id === id);
      if (!card || card.groupId) return;
      if (!card.archived) {
        recordCardLog(card, { action: 'Архивирование', object: 'Карта', field: 'archived', oldValue: false, newValue: true });
      }
      card.archived = true;
      saveData();
      renderEverything();
    });
  });

  wrapper.querySelectorAll('.comment-input').forEach(input => {
    autoResizeComment(input);
    const cardId = input.getAttribute('data-card-id');
    const opId = input.getAttribute('data-op-id');
    const card = cards.find(c => c.id === cardId);
    const op = card ? (card.operations || []).find(o => o.id === opId) : null;
    if (!op) return;

    input.addEventListener('focus', () => {
      input.dataset.prevComment = op.comment || '';
    });

    input.addEventListener('input', e => {
      const value = (e.target.value || '').slice(0, 40);
      e.target.value = value;
      op.comment = value;
      autoResizeComment(e.target);
    });

    input.addEventListener('blur', e => {
      const value = (e.target.value || '').slice(0, 40);
      e.target.value = value;
      const prev = input.dataset.prevComment || '';
      if (prev !== value) {
        recordCardLog(card, { action: 'Комментарий', object: opLogLabel(op), field: 'comment', targetId: op.id, oldValue: prev, newValue: value });
      }
      op.comment = value;
      saveData();
      renderDashboard();
    });
  });

  wrapper.querySelectorAll('.executor-main-input').forEach(input => {
    const openSuggestions = () => updateExecutorCombo(input, { forceOpen: true });
    input.addEventListener('focus', () => {
      input.dataset.prevVal = input.value || '';
      openSuggestions();
    });
    input.addEventListener('click', openSuggestions);
    input.addEventListener('touchstart', openSuggestions);
    input.addEventListener('input', e => {
      const cardId = input.getAttribute('data-card-id');
      const opId = input.getAttribute('data-op-id');
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!op) return;
      op.executor = sanitizeExecutorName((e.target.value || '').trim());
      if (!op.executor && (e.target.value || '').trim()) {
        e.target.value = '';
      }
      updateExecutorCombo(input, { forceOpen: true });
    });
    input.addEventListener('blur', e => {
      const cardId = input.getAttribute('data-card-id');
      const opId = input.getAttribute('data-op-id');
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!op || !card) return;
      const raw = (e.target.value || '').trim();
      const value = sanitizeExecutorName(raw);
      const prev = input.dataset.prevVal || '';
      if (value && !isEligibleExecutorName(value)) {
        alert('Выберите исполнителя со статусом "Рабочий" (пользователь Abyss недоступен).');
        e.target.value = '';
        op.executor = '';
        updateExecutorCombo(input);
        return;
      }
      if (!value && raw) {
        alert('Пользователь Abyss недоступен для выбора. Выберите другого исполнителя.');
        e.target.value = '';
      }
      op.executor = value;
      if (prev !== value) {
        recordCardLog(card, { action: 'Исполнитель', object: opLogLabel(op), field: 'executor', targetId: op.id, oldValue: prev, newValue: value });
        saveData();
        renderDashboard();
      }
      updateExecutorCombo(input);
    });
  });

  wrapper.querySelectorAll('.add-executor-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cardId = btn.getAttribute('data-card-id');
      const opId = btn.getAttribute('data-op-id');
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!card || !op) return;
      if (!Array.isArray(op.additionalExecutors)) op.additionalExecutors = [];
      if (op.additionalExecutors.length >= 3) return;
      const anchorGroupId = btn.closest('.wo-card') ? btn.closest('.wo-card').getAttribute('data-group-id') : null;
      suppressWorkorderAutoscroll = true;
      try {
        withWorkorderScrollLock(() => {
          op.additionalExecutors.push('');
          recordCardLog(card, { action: 'Доп. исполнитель', object: opLogLabel(op), field: 'additionalExecutors', targetId: op.id, oldValue: op.additionalExecutors.length - 1, newValue: op.additionalExecutors.length });
          saveData();
          workorderOpenCards.add(cardId);
          renderWorkordersTable();
        }, { anchorCardId: cardId, anchorGroupId });
      } finally {
        suppressWorkorderAutoscroll = false;
      }
    });
  });

  wrapper.querySelectorAll('.remove-executor-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cardId = btn.getAttribute('data-card-id');
      const opId = btn.getAttribute('data-op-id');
      const idx = parseInt(btn.getAttribute('data-extra-index'), 10);
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!card || !op || !Array.isArray(op.additionalExecutors)) return;
      if (idx < 0 || idx >= op.additionalExecutors.length) return;
      const anchorGroupId = btn.closest('.wo-card') ? btn.closest('.wo-card').getAttribute('data-group-id') : null;
      suppressWorkorderAutoscroll = true;
      try {
        withWorkorderScrollLock(() => {
          const removed = op.additionalExecutors.splice(idx, 1)[0];
          recordCardLog(card, { action: 'Доп. исполнитель', object: opLogLabel(op), field: 'additionalExecutors', targetId: op.id, oldValue: removed, newValue: 'удален' });
          saveData();
          workorderOpenCards.add(cardId);
          renderWorkordersTable();
        }, { anchorCardId: cardId, anchorGroupId });
      } finally {
        suppressWorkorderAutoscroll = false;
      }
    });
  });

  wrapper.querySelectorAll('.additional-executor-input').forEach(input => {
    const openSuggestions = () => updateExecutorCombo(input, { forceOpen: true });
    input.addEventListener('focus', () => {
      input.dataset.prevVal = input.value || '';
      openSuggestions();
    });
    input.addEventListener('click', openSuggestions);
    input.addEventListener('touchstart', openSuggestions);
    input.addEventListener('blur', e => {
      const cardId = input.getAttribute('data-card-id');
      const opId = input.getAttribute('data-op-id');
      const idx = parseInt(input.getAttribute('data-extra-index'), 10);
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!card || !op || !Array.isArray(op.additionalExecutors)) return;
      const raw = (e.target.value || '').trim();
      const value = sanitizeExecutorName(raw);
      const prev = input.dataset.prevVal || '';
      if (value && !isEligibleExecutorName(value)) {
        alert('Выберите исполнителя со статусом "Рабочий" (пользователь Abyss недоступен).');
        e.target.value = '';
        if (idx >= 0 && idx < op.additionalExecutors.length) {
          op.additionalExecutors[idx] = '';
        }
        updateExecutorCombo(input);
        return;
      }
      if (!value && raw) {
        alert('Пользователь Abyss недоступен для выбора. Выберите другого исполнителя.');
        e.target.value = '';
      }
      if (idx < 0 || idx >= op.additionalExecutors.length) return;
      op.additionalExecutors[idx] = value;
      if (prev !== value) {
        recordCardLog(card, { action: 'Доп. исполнитель', object: opLogLabel(op), field: 'additionalExecutors', targetId: op.id, oldValue: prev, newValue: value });
        saveData();
        renderDashboard();
      }
      updateExecutorCombo(input);
    });
    input.addEventListener('input', e => {
      const cardId = input.getAttribute('data-card-id');
      const opId = input.getAttribute('data-op-id');
      const idx = parseInt(input.getAttribute('data-extra-index'), 10);
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!card || !op || !Array.isArray(op.additionalExecutors)) return;
      if (idx < 0 || idx >= op.additionalExecutors.length) return;
      const raw = (e.target.value || '').trim();
      const value = sanitizeExecutorName(raw);
      op.additionalExecutors[idx] = value;
      updateExecutorCombo(input, { forceOpen: true });
    });
  });

  wrapper.querySelectorAll('.item-status-input').forEach(input => {
    input.addEventListener('input', e => {
      const maxVal = toSafeCount(input.getAttribute('data-item-qty'));
      e.target.value = Math.min(maxVal, toSafeCount(e.target.value));
    });

    input.addEventListener('blur', e => {
      const cardId = input.getAttribute('data-card-id');
      const opId = input.getAttribute('data-op-id');
      const itemId = input.getAttribute('data-item-id');
      const type = input.getAttribute('data-qty-type');
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!card || !op || !Array.isArray(op.items)) return;
      const item = op.items.find(it => it.id === itemId);
      if (!item) return;
      const fieldMap = { good: 'goodCount', scrap: 'scrapCount', hold: 'holdCount' };
      const field = fieldMap[type] || null;
      if (!field) return;
      const maxVal = item.quantity != null ? item.quantity : 1;
      const val = Math.min(maxVal, toSafeCount(e.target.value));
      const prev = toSafeCount(item[field] || 0);
      if (prev === val) return;
      item[field] = val;
      normalizeOperationItems(card, op);
      recordCardLog(card, { action: 'Количество изделия', object: opLogLabel(op), field: 'item.' + field, targetId: item.id, oldValue: prev, newValue: val });
      saveData();
      renderDashboard();
      renderWorkordersTable();
    });
  });

  wrapper.querySelectorAll('.qty-input').forEach(input => {
    const cardId = input.getAttribute('data-card-id');
    const opId = input.getAttribute('data-op-id');
    const type = input.getAttribute('data-qty-type');
    const card = cards.find(c => c.id === cardId);
    const op = card ? (card.operations || []).find(o => o.id === opId) : null;
    if (!op || !card) return;

    input.addEventListener('input', e => {
      e.target.value = toSafeCount(e.target.value);
    });

    input.addEventListener('blur', e => {
      const val = toSafeCount(e.target.value);
      const fieldMap = { good: 'goodCount', scrap: 'scrapCount', hold: 'holdCount' };
      const field = fieldMap[type] || null;
      if (!field) return;
      const prev = toSafeCount(op[field] || 0);
      if (prev === val) return;
      op[field] = val;
      recordCardLog(card, { action: 'Количество деталей', object: opLogLabel(op), field, targetId: op.id, oldValue: prev, newValue: val });
      saveData();
      renderDashboard();
    });
  });

    wrapper.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (readonly) return;
        const action = btn.getAttribute('data-action');
      const cardId = btn.getAttribute('data-card-id');
      const opId = btn.getAttribute('data-op-id');
      const card = cards.find(c => c.id === cardId);
      if (!card) return;
      const op = (card.operations || []).find(o => o.id === opId);
      if (!op) return;
      const detail = btn.closest('.wo-card');
      if (detail && detail.open) {
        workorderOpenCards.add(cardId);
      }

        const anchorGroupId = detail ? detail.getAttribute('data-group-id') : null;
        applyOperationAction(action, card, op, { anchorGroupId });
      });
    });

    syncExecutorComboboxMode();
    applyReadonlyState('workorders', 'workorders');
  }

  function renderWorkspaceView() {
  const wrapper = document.getElementById('workspace-results');
  if (!wrapper) return;
  const readonly = isTabReadonly('workspace');

  const termRaw = workspaceSearchTerm.trim();
  const barcodeTerm = termRaw.trim().toLowerCase();
  const isWorker = currentUser && currentUser.permissions && currentUser.permissions.worker;
  let candidates = [];
  if (!barcodeTerm) {
    if (isWorker && currentUser) {
      const name = (currentUser.name || '').toLowerCase();
      candidates = cards.filter(card => {
        if (card.archived) return false;
        return (card.operations || []).some(op => {
          const main = (op.executor || '').toLowerCase();
          const extras = (op.additionalExecutors || []).map(v => (v || '').toLowerCase());
          return main === name || extras.includes(name);
        });
      });
    }
  } else {
    candidates = cards.filter(card => {
      if (card.archived) return false;
      const cardBarcode = getCardBarcodeValue(card).toLowerCase();
      return cardBarcode && cardBarcode === barcodeTerm;
    });
  }

  if (!candidates.length) {
    wrapper.innerHTML = '<p>Карты по запросу не найдены.</p>';
    return;
  }

  let html = '';
  candidates.forEach(card => {
    if (card.operations && card.operations.length) {
      html += buildWorkspaceCardDetails(card, { readonly });
    }
  });

  if (!html) {
    wrapper.innerHTML = '<p>Нет карт с маршрутами для отображения.</p>';
    return;
  }

  wrapper.innerHTML = html;
  bindCardInfoToggles(wrapper);

  wrapper.querySelectorAll('.barcode-view-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-card-id');
      const card = cards.find(c => c.id === id);
      if (!card) return;
      openBarcodeModal(card);
    });
  });

  wrapper.querySelectorAll('button[data-attach-card]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-attach-card');
      openAttachmentsModal(id, 'live');
    });
  });

  wrapper.querySelectorAll('.wo-card button[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (readonly) return;
      const action = btn.getAttribute('data-action');
      const cardId = btn.getAttribute('data-card-id');
      const opId = btn.getAttribute('data-op-id');
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!card || !op) return;

      if (action === 'stop') {
        openWorkspaceStopModal(card, op);
      } else {
        applyOperationAction(action, card, op, { useWorkorderScrollLock: false });
      }
    });
  });

  applyReadonlyState('workspace', 'workspace');
}

function getWorkspaceModalInputs() {
  return [
    document.getElementById('workspace-stop-good'),
    document.getElementById('workspace-stop-scrap'),
    document.getElementById('workspace-stop-hold')
  ].filter(Boolean);
}

function setWorkspaceActiveInput(input) {
  workspaceActiveModalInput = input || null;
  if (workspaceActiveModalInput) {
    workspaceActiveModalInput.focus();
    workspaceActiveModalInput.select();
  }
}

function focusWorkspaceNextInput() {
  const inputs = getWorkspaceModalInputs();
  if (!inputs.length) return;
  const active = document.activeElement && inputs.includes(document.activeElement)
    ? document.activeElement
    : workspaceActiveModalInput;
  const idx = Math.max(0, inputs.indexOf(active));
  const next = inputs[(idx + 1) % inputs.length];
  setWorkspaceActiveInput(next);
}

function openWorkspaceStopModal(card, op) {
  const modal = document.getElementById('workspace-stop-modal');
  if (!modal) return;
  workspaceStopContext = { cardId: card.id, opId: op.id };
  const totalEl = document.getElementById('workspace-stop-total');
  if (totalEl) {
    const qty = getOperationQuantity(op, card);
    totalEl.textContent = qty === '' ? '–' : toSafeCount(qty);
  }
  const [goodInput, scrapInput, holdInput] = getWorkspaceModalInputs();
  if (goodInput) goodInput.value = toSafeCount(op.goodCount || 0);
  if (scrapInput) scrapInput.value = toSafeCount(op.scrapCount || 0);
  if (holdInput) holdInput.value = toSafeCount(op.holdCount || 0);
  modal.classList.remove('hidden');
  setWorkspaceActiveInput(goodInput || scrapInput || holdInput || null);
}

function closeWorkspaceStopModal() {
  const modal = document.getElementById('workspace-stop-modal');
  if (modal) modal.classList.add('hidden');
  workspaceStopContext = null;
  workspaceActiveModalInput = null;
}

function applyWorkspaceKeypad(key) {
  const inputs = getWorkspaceModalInputs();
  if (!inputs.length) return;
  const target = (document.activeElement && inputs.includes(document.activeElement))
    ? document.activeElement
    : workspaceActiveModalInput || inputs[0];
  if (!target) return;

  let value = target.value || '';
  if (key === 'back') {
    value = value.slice(0, -1);
  } else if (key === 'clear') {
    value = '';
  } else if (/^\d$/.test(key)) {
    value = value + key;
  }
  target.value = value.replace(/^0+(?=\d)/, '');
  setWorkspaceActiveInput(target);
}

function submitWorkspaceStopModal() {
  if (!workspaceStopContext) {
    closeWorkspaceStopModal();
    return;
  }
  const card = cards.find(c => c.id === workspaceStopContext.cardId);
  const op = card ? (card.operations || []).find(o => o.id === workspaceStopContext.opId) : null;
  if (!card || !op) {
    closeWorkspaceStopModal();
    return;
  }

  const inputs = getWorkspaceModalInputs();
  const [goodInput, scrapInput, holdInput] = inputs;
  const goodVal = toSafeCount(goodInput ? goodInput.value : 0);
  const scrapVal = toSafeCount(scrapInput ? scrapInput.value : 0);
  const holdVal = toSafeCount(holdInput ? holdInput.value : 0);

  const prevGood = toSafeCount(op.goodCount || 0);
  const prevScrap = toSafeCount(op.scrapCount || 0);
  const prevHold = toSafeCount(op.holdCount || 0);

  op.goodCount = goodVal;
  op.scrapCount = scrapVal;
  op.holdCount = holdVal;

  if (prevGood !== goodVal) {
    recordCardLog(card, { action: 'Количество деталей', object: opLogLabel(op), field: 'goodCount', targetId: op.id, oldValue: prevGood, newValue: goodVal });
  }
  if (prevScrap !== scrapVal) {
    recordCardLog(card, { action: 'Количество деталей', object: opLogLabel(op), field: 'scrapCount', targetId: op.id, oldValue: prevScrap, newValue: scrapVal });
  }
  if (prevHold !== holdVal) {
    recordCardLog(card, { action: 'Количество деталей', object: opLogLabel(op), field: 'holdCount', targetId: op.id, oldValue: prevHold, newValue: holdVal });
  }

  closeWorkspaceStopModal();
  applyOperationAction('stop', card, op, { useWorkorderScrollLock: false });
}

function buildArchiveCardDetails(card, { opened = false } = {}) {
  const stateBadge = renderCardStateBadge(card);
  const filesCount = (card.attachments || []).length;
  const barcodeValue = getCardBarcodeValue(card);
  const barcodeInline = barcodeValue
    ? ' • № карты: <span class="summary-barcode">' + escapeHtml(barcodeValue) + ' <button type="button" class="btn-small btn-secondary wo-barcode-btn" data-card-id="' + card.id + '">Штрихкод</button></span>'
    : '';
  const contractText = card.contractNumber ? ' (Договор: ' + escapeHtml(card.contractNumber) + ')' : '';
  const filesButton = ' <button type="button" class="btn-small clip-btn inline-clip" data-attach-card="' + card.id + '">📎 <span class="clip-count">' + filesCount + '</span></button>';
  const logButton = ' <button type="button" class="btn-small btn-secondary log-btn" data-log-card="' + card.id + '">Log</button>';
  const nameLabel = formatCardNameWithGroupPosition(card, { includeArchivedSiblings: true });

  let html = '<details class="wo-card" data-card-id="' + card.id + '"' + (opened ? ' open' : '') + '>' +
    '<summary>' +
    '<div class="summary-line">' +
    '<div class="summary-text">' +
    '<strong>' + nameLabel + '</strong>' +
    ' <span class="summary-sub">' +
    (card.orderNo ? ' (Заказ: ' + escapeHtml(card.orderNo) + ')' : '') + contractText +
    barcodeInline + filesButton + logButton +
    '</span>' +
    '</div>' +
    '<div class="summary-actions">' +
    ' ' + stateBadge +
    ' <button type="button" class="btn-small btn-secondary repeat-card-btn" data-card-id="' + card.id + '">Повторить</button>' +
    '</div>' +
    '</div>' +
    '</summary>';

  html += buildCardInfoBlock(card);
  html += buildOperationsTable(card, { readonly: true });
  html += '</details>';
  return html;
}

function buildArchiveGroupDetails(group) {
  const stateBadge = renderCardStateBadge(group, { includeArchivedChildren: true });
  const filesCount = (group.attachments || []).length;
  const contractText = group.contractNumber ? ' (Договор: ' + escapeHtml(group.contractNumber) + ')' : '';
  const barcodeValue = getCardBarcodeValue(group);
  const barcodeInline = barcodeValue
    ? ' • № карты: <span class="summary-barcode">' + escapeHtml(barcodeValue) + ' <button type="button" class="btn-small btn-secondary wo-barcode-btn" data-card-id="' + group.id + '">Штрихкод</button></span>'
    : '';
  const filesButton = ' <button type="button" class="btn-small clip-btn inline-clip" data-attach-card="' + group.id + '">📎 <span class="clip-count">' + filesCount + '</span></button>';
  const children = getGroupChildren(group).filter(c => c.archived);
  const childrenHtml = children.length
    ? children.map(child => buildArchiveCardDetails(child, { opened: false })).join('')
    : '<p class="group-empty">В группе нет карт для отображения.</p>';

  let html = '<details class="wo-card group-archive-card" data-group-id="' + group.id + '">' +
    '<summary>' +
    '<div class="summary-line">' +
    '<div class="summary-text">' +
    '<strong><span class="group-marker">(Г)</span>' + escapeHtml(group.name || group.id) + '</strong>' +
    ' <span class="summary-sub">' +
    (group.orderNo ? ' (Заказ: ' + escapeHtml(group.orderNo) + ')' : '') + contractText +
    barcodeInline + filesButton +
    '</span>' +
    '</div>' +
    '<div class="summary-actions">' +
    ' ' + stateBadge +
    ' <button type="button" class="btn-small btn-secondary repeat-card-btn" data-group-id="' + group.id + '">Повторить</button>' +
    '</div>' +
    '</div>' +
    '</summary>' +
    '<div class="group-children">' + childrenHtml + '</div>' +
    '</details>';
  return html;
}

function renderArchiveTable() {
  const wrapper = document.getElementById('archive-table-wrapper');
  const archivedCards = cards.filter(c => c.archived && !c.groupId);
  const groupsWithArchivedChildren = cards.filter(c => isGroupCard(c) && getGroupChildren(c).some(ch => ch.archived));

  const archiveEntries = [...archivedCards];
  groupsWithArchivedChildren.forEach(group => {
    if (!archiveEntries.some(card => card.id === group.id)) {
      archiveEntries.push(group);
    }
  });

  if (!archiveEntries.length) {
    wrapper.innerHTML = '<p>В архиве пока нет карт.</p>';
    return;
  }

  const termRaw = archiveSearchTerm.trim();
  const filteredByStatus = archiveEntries.filter(card => {
    const state = getCardProcessState(card, { includeArchivedChildren: true });
    return archiveStatusFilter === 'ALL' || state.key === archiveStatusFilter;
  });

  if (!filteredByStatus.length) {
    wrapper.innerHTML = '<p>Нет архивных карт, удовлетворяющих фильтру.</p>';
    return;
  }

  const scoreFn = (card) => cardSearchScoreWithChildren(card, termRaw, { includeArchivedChildren: true });
  let sortedCards = [...filteredByStatus];
  if (termRaw) {
    sortedCards.sort((a, b) => scoreFn(b) - scoreFn(a));
  }

  const filteredBySearch = termRaw
    ? sortedCards.filter(card => scoreFn(card) > 0)
    : sortedCards;

  if (!filteredBySearch.length) {
    wrapper.innerHTML = '<p>Архивные карты по запросу не найдены.</p>';
    return;
  }

  let html = '';
  filteredBySearch.forEach(card => {
    if (isGroupCard(card)) {
      html += buildArchiveGroupDetails(card);
    } else if (card.operations && card.operations.length) {
      html += buildArchiveCardDetails(card);
    }
  });

  wrapper.innerHTML = html || '<p>Нет архивных карт, удовлетворяющих фильтру.</p>';
  bindCardInfoToggles(wrapper);

  wrapper.querySelectorAll('.wo-barcode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-card-id');
      const card = cards.find(c => c.id === id);
      if (!card) return;
      openBarcodeModal(card);
    });
  });

  wrapper.querySelectorAll('button[data-attach-card]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-attach-card');
      openAttachmentsModal(id, 'live');
    });
  });

  wrapper.querySelectorAll('.log-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-log-card');
      openLogModal(id);
    });
  });

  wrapper.querySelectorAll('.repeat-card-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const groupId = btn.getAttribute('data-group-id');
      if (groupId) {
        const newGroup = duplicateGroup(groupId, { includeArchivedChildren: true });
        if (newGroup) {
          openGroupTransferModal();
        }
        return;
      }
      const id = btn.getAttribute('data-card-id');
      const card = cards.find(c => c.id === id);
      if (!card) return;
      const cloneOps = (card.operations || []).map(op => ({
        ...op,
        id: genId('rop'),
        status: 'NOT_STARTED',
        startedAt: null,
        finishedAt: null,
        actualSeconds: null,
        elapsedSeconds: 0,
        comment: ''
      }));
      const newCard = {
        ...card,
        id: genId('card'),
        barcode: card.barcode || '',
        name: (card.name || '') + ' (копия)',
        status: 'NOT_STARTED',
        archived: false,
        attachments: (card.attachments || []).map(file => ({
          ...file,
          id: genId('file'),
          createdAt: Date.now()
        })),
        operations: cloneOps
      };
      ensureCardMeta(newCard);
      recalcCardStatus(newCard);
      cards.push(newCard);
      saveData();
      renderEverything();
    });
  });

  applyReadonlyState('archive', 'archive');
}

// === ТАЙМЕР ===
function updateCardsStatusTimers() {
  const nodes = document.querySelectorAll('.cards-status-text[data-card-id]');
  nodes.forEach(node => {
    const cardId = node.getAttribute('data-card-id');
    const card = cards.find(c => c.id === cardId);
    if (!card) return;
    node.textContent = cardStatusText(card);
  });
}

function tickTimers() {
  const rows = getAllRouteRows().filter(r => r.op.status === 'IN_PROGRESS' && r.op.startedAt);
  rows.forEach(row => {
    const card = row.card;
    const op = row.op;
    const rowId = card.id + '::' + op.id;
    const spans = document.querySelectorAll('.wo-timer[data-row-id="' + rowId + '"]');
    const elapsedSec = getOperationElapsedSeconds(op);
    spans.forEach(span => {
      span.textContent = formatSecondsToHMS(elapsedSec);
    });
  });

  refreshCardStatuses();
  updateCardsStatusTimers();
  renderDashboard();
}

// === НАВИГАЦИЯ ===
function setupNavigation() {
  const labelMap = {
    'Дашборд': 'dashboard',
    'МК': 'cards',
    'Трекер': 'workorders',
    'Архив': 'archive',
    'Рабочееместо': 'workspace',
    'Рабочее место': 'workspace',
    'Пользователи': 'users',
    'Уровни доступа': 'accessLevels'
  };

  document.addEventListener('click', event => {
    const toggleBtn = event.target.closest('#nav-toggle');
    if (toggleBtn) {
      event.preventDefault();
      togglePrimaryNav();
      return;
    }

    const navBtn = event.target.closest('button.nav-btn');
    if (!navBtn) return;
    event.preventDefault();
    if (navBtn.classList.contains('nav-dropdown-toggle')) {
      const menu = document.getElementById('nav-cards-menu');
      const isOpen = menu && menu.classList.toggle('open');
      navBtn.setAttribute('aria-expanded', String(Boolean(isOpen)));
      return;
    }
    if (navBtn.classList.contains('hidden')) return;

    const rawLabel = (navBtn.textContent || '').replace(/\s+/g, ' ').trim();
    const target = navBtn.getAttribute('data-target') || labelMap[rawLabel];
    if (!target) return;

    if (!canViewTab(target)) {
      alert('Нет прав доступа к разделу');
      return;
    }

    navigateToRoute('/' + target);
    if (window.innerWidth <= 768) {
      closePrimaryNav();
    }
  });
}

function setupCardsDropdownMenu() {
  const menu = document.getElementById('nav-cards-menu');
  const toggle = document.querySelector('.nav-dropdown-toggle');
  if (!menu || !toggle) return;

  const closeMenu = () => {
    menu.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  };

  menu.querySelectorAll('[data-route]').forEach(item => {
    item.addEventListener('click', () => {
      const route = item.getAttribute('data-route');
      closeMenu();
      if (route) navigateToRoute(route);
      if (window.innerWidth <= 768) closePrimaryNav();
    });
  });

  document.addEventListener('click', (event) => {
    if (menu.contains(event.target) || toggle.contains(event.target)) return;
    closeMenu();
  });
}

function activateTab(target, options = {}) {
  const { skipHistory = false, replaceHistory = false, fromRestore = false } = options;
  const navButtons = document.querySelectorAll('.nav-btn');
  closeAllModals(true);

  document.querySelectorAll('main section').forEach(sec => {
    sec.classList.remove('active');
  });
  const section = document.getElementById(target);
  if (section) {
    section.classList.remove('hidden');
    section.classList.add('active');
  }

  navButtons.forEach(b => b.classList.remove('active'));
  navButtons.forEach(b => {
    if (b.getAttribute('data-target') === target) b.classList.add('active');
  });

  if (skipHistory) {
    appState = { ...appState, tab: target };
  } else {
    setModalState(null, { replace: true, fromRestore });
    setTabState(target, { replaceHistory, fromRestore });
  }

  if (target === 'workorders') {
    renderWorkordersTable({ collapseAll: true });
  } else if (target === 'archive') {
    renderArchiveTable();
  } else if (target === 'workspace') {
    renderWorkspaceView();
    focusWorkspaceSearch();
  } else if (target === 'dashboard' && window.dashboardPager && typeof window.dashboardPager.updatePages === 'function') {
    requestAnimationFrame(() => window.dashboardPager.updatePages());
  }
}

function openDirectoryModal(options = {}) {
  const { pageMode = false } = options;
  const modal = document.getElementById('directory-modal');
  if (!modal) return;
  renderCentersTable();
  renderOpsTable();
  modal.classList.remove('hidden');
  if (pageMode) {
    modal.classList.add('page-mode');
    document.body.classList.add('page-directory-mode');
  } else {
    modal.classList.remove('page-mode');
    document.body.classList.remove('page-directory-mode');
  }
}

function closeDirectoryModal(silent = false) {
  const modal = document.getElementById('directory-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('page-mode');
  document.body.classList.remove('page-directory-mode');
  if (silent) return;
  setModalState(null, { replace: true });
}

function setCardsTab(tabKey) {
  const listPanel = document.getElementById('cards-list-panel');
  if (listPanel) listPanel.classList.toggle('hidden', tabKey !== 'list');
  if (tabKey === 'directory') {
    openDirectoryModal();
    if (listPanel) listPanel.classList.remove('hidden');
  }
}

function setupCardsTabs() {
  const directoryBtn = document.getElementById('btn-directory-modal');
  if (directoryBtn) {
    directoryBtn.addEventListener('click', () => navigateToRoute('/directories'));
  }
  const modal = document.getElementById('directory-modal');
  const closeBtn = document.getElementById('directory-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      if (modal && modal.classList.contains('page-mode')) {
        navigateToRoute('/cards');
        return;
      }
      closeDirectoryModal();
    });
  }
}

function focusCardsSection() {
  document.querySelectorAll('main section').forEach(sec => {
    sec.classList.toggle('active', sec.id === 'cards');
  });
  const navButtons = document.querySelectorAll('.nav-btn');
  navButtons.forEach(btn => {
    const target = btn.getAttribute('data-target');
    btn.classList.toggle('active', target === 'cards');
  });
  setCardsTab('list');
}

function focusWorkspaceSearch() {
  const input = document.getElementById('workspace-search');
  if (input) {
    input.focus();
    input.select();
  }
}

function focusCardsSection() {
  document.querySelectorAll('main section').forEach(sec => {
    sec.classList.toggle('active', sec.id === 'cards');
  });
  const navButtons = document.querySelectorAll('.nav-btn');
  navButtons.forEach(btn => {
    const target = btn.getAttribute('data-target');
    btn.classList.toggle('active', target === 'cards');
  });
  setCardsTab('list');
}

// === ФОРМЫ ===
function setupForms() {
  const newCardBtn = document.getElementById('btn-new-card');
  if (newCardBtn) {
    newCardBtn.addEventListener('click', () => {
      navigateToRoute('/cards/new');
    });
  }

  const newMkiBtn = document.getElementById('btn-new-mki');
  if (newMkiBtn) {
    newMkiBtn.addEventListener('click', () => navigateToRoute('/cards-mki/new'));
  }

  setupCardSectionMenu();

  const cardForm = document.getElementById('card-form');
  if (cardForm) {
    cardForm.addEventListener('submit', e => e.preventDefault());
  }

  const cardMainToggle = document.getElementById('card-main-toggle');
  if (cardMainToggle) {
    cardMainToggle.addEventListener('click', () => {
      const block = document.getElementById('card-main-block');
      const collapsed = block ? block.classList.contains('is-collapsed') : false;
      setCardMainCollapsed(!collapsed);
    });
  }

  const cardNameInput = document.getElementById('card-name');
  if (cardNameInput) {
    cardNameInput.addEventListener('input', () => updateCardMainSummary());
  }

  const cardQtyInput = document.getElementById('card-qty');
  if (cardQtyInput) {
    cardQtyInput.addEventListener('input', e => {
      if (!activeCardDraft) return;
      const raw = e.target.value.trim();
      const qtyVal = raw === '' ? '' : Math.max(0, parseInt(raw, 10) || 0);
      activeCardDraft.quantity = Number.isFinite(qtyVal) ? qtyVal : '';
      if (!routeQtyManual) {
        const qtyField = document.getElementById('route-qty');
        if (qtyField) qtyField.value = activeCardDraft.quantity !== '' ? activeCardDraft.quantity : '';
      }
      if (activeCardDraft.useItemList && Array.isArray(activeCardDraft.operations)) {
        activeCardDraft.operations.forEach(op => normalizeOperationItems(activeCardDraft, op));
        syncItemListFromFirstOperation(activeCardDraft);
      }
      updateCardMainSummary();
      if (activeCardDraft.cardType === 'MKI') {
        recalcMkiOperationQuantities(activeCardDraft);
        updateRouteFormQuantityUI();
        renderMkiSerialTables();
      }
      renderRouteTableDraft();
    });
  }

  const sampleQtyInput = document.getElementById('card-sample-qty');
  if (sampleQtyInput) {
    sampleQtyInput.addEventListener('input', e => {
      if (!activeCardDraft || activeCardDraft.cardType !== 'MKI') return;
      const raw = e.target.value.trim();
      const qtyVal = raw === '' ? '' : Math.max(0, parseInt(raw, 10) || 0);
      activeCardDraft.sampleCount = Number.isFinite(qtyVal) ? qtyVal : '';
      recalcMkiOperationQuantities(activeCardDraft);
      updateRouteFormQuantityUI();
      renderRouteTableDraft();
      renderMkiSerialTables();
    });
  }

  const cardOrderInput = document.getElementById('card-order');
  if (cardOrderInput) {
    cardOrderInput.addEventListener('input', () => updateCardMainSummary());
  }

  const useItemsCheckbox = document.getElementById('card-use-items');
  if (useItemsCheckbox) {
    useItemsCheckbox.addEventListener('change', e => {
      if (!activeCardDraft) return;
      activeCardDraft.useItemList = e.target.checked;
      if (Array.isArray(activeCardDraft.operations)) {
        activeCardDraft.operations.forEach(op => normalizeOperationItems(activeCardDraft, op));
        if (activeCardDraft.useItemList) {
          syncItemListFromFirstOperation(activeCardDraft);
        }
      }
      renderRouteTableDraft();
    });
  }

  const itemSerialsWrapper = document.getElementById('card-item-serials-table-wrapper');
  if (itemSerialsWrapper) {
    itemSerialsWrapper.addEventListener('input', e => {
      if (!activeCardDraft || activeCardDraft.cardType !== 'MKI') return;
      const input = e.target.closest('.serials-input');
      if (!input) return;
      const idx = parseInt(input.dataset.index, 10);
      if (!Number.isNaN(idx) && idx >= 0) {
        activeCardDraft.itemSerials[idx] = input.value;
      }
    });
  }

  const sampleSerialsWrapper = document.getElementById('card-sample-serials-table-wrapper');
  if (sampleSerialsWrapper) {
    sampleSerialsWrapper.addEventListener('input', e => {
      if (!activeCardDraft || activeCardDraft.cardType !== 'MKI') return;
      const input = e.target.closest('.serials-input');
      if (!input) return;
      const idx = parseInt(input.dataset.index, 10);
      if (!Number.isNaN(idx) && idx >= 0) {
        activeCardDraft.sampleSerials[idx] = input.value;
      }
    });
  }

  const importImdxBtn = document.getElementById('card-import-imdx-btn');
  if (importImdxBtn) {
    importImdxBtn.addEventListener('click', () => {
      if (!activeCardDraft) return;
      openImdxImportModal();
    });
  }

  const imdxImportConfirm = document.getElementById('imdx-import-confirm');
  if (imdxImportConfirm) {
    imdxImportConfirm.addEventListener('click', () => handleImdxImportConfirm());
  }

  const imdxImportCancel = document.getElementById('imdx-import-cancel');
  if (imdxImportCancel) {
    imdxImportCancel.addEventListener('click', () => {
      closeImdxImportModal();
      resetImdxImportState();
    });
  }

  const imdxMissingConfirm = document.getElementById('imdx-missing-confirm');
  if (imdxMissingConfirm) {
    imdxMissingConfirm.addEventListener('click', () => confirmImdxMissingAdd());
  }

  const imdxMissingCancel = document.getElementById('imdx-missing-cancel');
  if (imdxMissingCancel) {
    imdxMissingCancel.addEventListener('click', () => {
      closeImdxMissingModal();
      resetImdxImportState();
    });
  }

  const saveBtn = document.getElementById('card-save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      if (!activeCardDraft) return;
      syncCardDraftFromForm();
      const missing = [];
      if (!activeCardDraft.routeCardNumber) missing.push('Маршрутная карта №');
      if (!activeCardDraft.itemName) missing.push('Наименование изделия');
      if (!activeCardDraft.documentDesignation) missing.push('Обозначение документа');
      if (missing.length) {
        alert('Заполните обязательные поля: ' + missing.join(', '));
        return;
      }
      document.getElementById('card-status-text').textContent = cardStatusText(activeCardDraft);
      saveCardDraft();
    });
  }

  const createGroupBtn = document.getElementById('card-create-group-btn');
  if (createGroupBtn) {
    createGroupBtn.addEventListener('click', () => {
      syncCardDraftFromForm();
      openGroupModal();
    });
  }

  const printDraftBtn = document.getElementById('card-print-btn');
  if (printDraftBtn) {
    printDraftBtn.addEventListener('click', async () => {
      if (!activeCardDraft) return;
      syncCardDraftFromForm();
      const saved = await saveCardDraft({ closeModal: false, keepDraftOpen: true });
      if (saved) {
        printCardView(saved);
      }
    });
  }

  const cancelBtn = document.getElementById('card-cancel-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      const modal = document.getElementById('card-modal');
      if (modal && modal.classList.contains('page-mode')) {
        navigateToRoute('/cards');
        return;
      }
      closeCardModal();
    });
  }

  const groupConfirmBtn = document.getElementById('group-create-confirm');
  if (groupConfirmBtn) {
    groupConfirmBtn.addEventListener('click', () => {
      syncCardDraftFromForm();
      createGroupFromDraft();
    });
  }

  const groupCancelBtn = document.getElementById('group-create-cancel');
  if (groupCancelBtn) {
    groupCancelBtn.addEventListener('click', () => closeGroupModal());
  }

  document.getElementById('route-form').addEventListener('submit', e => {
    e.preventDefault();
    if (!activeCardDraft) return;
    const opInput = document.getElementById('route-op');
    const opList = document.getElementById('route-op-options');
    const centerInput = document.getElementById('route-center');
    const centerList = document.getElementById('route-center-options');
    const opMatch = Array.from(opList ? opList.options : []).find(opt => opt.value === (opInput ? opInput.value.trim() : ''));
    const centerMatch = Array.from(centerList ? centerList.options : []).find(opt => opt.value === (centerInput ? centerInput.value.trim() : ''));
    const opId = opMatch ? opMatch.dataset.id : null;
    const centerId = centerMatch ? centerMatch.dataset.id : null;
    const planned = parseInt(document.getElementById('route-planned').value, 10) || 30;
    const codeValue = document.getElementById('route-op-code').value.trim();
    const qtyInput = document.getElementById('route-qty').value.trim();
    const samplesToggle = document.getElementById('route-samples-toggle');
    const isMki = activeCardDraft.cardType === 'MKI';
    const isSamplesMode = isMki && samplesToggle ? Boolean(samplesToggle.checked) : false;
    const qtyValue = isMki
      ? computeMkiOperationQuantity({ isSamples: isSamplesMode }, activeCardDraft)
      : (qtyInput === '' ? activeCardDraft.quantity : qtyInput);
    const qtyNumeric = isMki
      ? computeMkiOperationQuantity({ isSamples: isSamplesMode }, activeCardDraft)
      : (qtyValue === '' ? '' : toSafeCount(qtyValue));
    const firstOp = activeCardDraft.useItemList ? getFirstOperation(activeCardDraft) : null;
    const prevSameQtyOp = activeCardDraft.useItemList
      ? [...(activeCardDraft.operations || [])]
        .sort((a, b) => (b.order || 0) - (a.order || 0))
        .find(o => getOperationQuantity(o, activeCardDraft) === qtyNumeric)
      : null;
    const templateItems = activeCardDraft.useItemList
      ? (firstOp && getOperationQuantity(firstOp, activeCardDraft) === qtyNumeric
        ? firstOp.items
        : (prevSameQtyOp ? prevSameQtyOp.items : []))
      : [];
    const items = activeCardDraft.useItemList
      ? buildItemsFromTemplate(templateItems, Number.isFinite(qtyNumeric) ? qtyNumeric : 0)
      : [];
    let opRef = ops.find(o => o.id === opId);
    let centerRef = centers.find(c => c.id === centerId);
    const opTerm = (opInput ? opInput.value : '').trim().toLowerCase();
    const centerTerm = (centerInput ? centerInput.value : '').trim().toLowerCase();
    if (!opRef && opTerm) {
      opRef = ops.find(o => {
        const label = formatOpLabel(o).toLowerCase();
        const code = (o.opCode || o.code || '').toLowerCase();
        return label === opTerm || code === opTerm;
      }) || ops.find(o => {
        const label = formatOpLabel(o).toLowerCase();
        const code = (o.opCode || o.code || '').toLowerCase();
        return label.includes(opTerm) || code.includes(opTerm);
      });
    }
    if (!centerRef && centerTerm) {
      centerRef = centers.find(c => (c.name || '').toLowerCase() === centerTerm) || centers.find(c => (c.name || '').toLowerCase().includes(centerTerm));
    }
    if (!opRef || !centerRef) {
      alert('Выберите операцию и подразделение из списка.');
      return;
    }
    const maxOrder = activeCardDraft.operations && activeCardDraft.operations.length
      ? Math.max.apply(null, activeCardDraft.operations.map(o => o.order || 0))
      : 0;
    const rop = createRouteOpFromRefs(opRef, centerRef, '', planned, maxOrder + 1, {
      code: codeValue,
      autoCode: !codeValue,
      quantity: qtyValue,
      items,
      isSamples: isSamplesMode,
      card: activeCardDraft
    });
    activeCardDraft.operations = activeCardDraft.operations || [];
    activeCardDraft.operations.push(rop);
    normalizeOperationItems(activeCardDraft, rop);
    if (activeCardDraft.useItemList) {
      syncItemListFromFirstOperation(activeCardDraft);
    }
    renumberAutoCodesForCard(activeCardDraft);
    document.getElementById('card-status-text').textContent = cardStatusText(activeCardDraft);
    renderRouteTableDraft();
    
    // Auto-scroll to bottom
    const wrapper = document.getElementById('route-table-wrapper');
    if (wrapper) {
        requestAnimationFrame(() => {
            wrapper.scrollTop = wrapper.scrollHeight;
        });
    }

    document.getElementById('route-form').reset();
    routeQtyManual = false;
    const qtyField = document.getElementById('route-qty');
    if (qtyField) qtyField.value = activeCardDraft.quantity !== '' ? activeCardDraft.quantity : '';
    if (opInput) opInput.value = '';
    if (centerInput) centerInput.value = '';
    updateRouteFormQuantityUI();
    fillRouteSelectors();
  });

  const routeOpInput = document.getElementById('route-op');
  if (routeOpInput) {
    const openOpList = () => {
      const { filteredOps } = getFilteredRouteSources();
      updateRouteCombo('op', filteredOps, { forceOpen: true });
    };
    routeOpInput.addEventListener('input', () => fillRouteSelectors());
    routeOpInput.addEventListener('focus', openOpList);
    routeOpInput.addEventListener('click', openOpList);
  }

  const routeCenterInput = document.getElementById('route-center');
  if (routeCenterInput) {
    const openCenterList = () => {
      const { filteredCenters } = getFilteredRouteSources();
      updateRouteCombo('center', filteredCenters, { forceOpen: true });
    };
    routeCenterInput.addEventListener('input', () => fillRouteSelectors());
    routeCenterInput.addEventListener('focus', openCenterList);
    routeCenterInput.addEventListener('click', openCenterList);
  }

  document.addEventListener('click', e => {
    if (!e.target.closest('.combo-field')) {
      hideRouteCombos();
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
      hideRouteCombos();
    } else {
      fillRouteSelectors();
    }
  });

  const routeQtyField = document.getElementById('route-qty');
  if (routeQtyField) {
    routeQtyField.addEventListener('input', e => {
      if (activeCardDraft && activeCardDraft.cardType === 'MKI') {
        updateRouteFormQuantityUI();
        return;
      }
      const raw = e.target.value;
      routeQtyManual = raw !== '';
      if (raw !== '') {
        e.target.value = toSafeCount(raw);
      } else if (activeCardDraft) {
        e.target.value = activeCardDraft.quantity !== '' ? activeCardDraft.quantity : '';
      }
    });
  }

  const routeSamplesToggle = document.getElementById('route-samples-toggle');
  if (routeSamplesToggle) {
    routeSamplesToggle.addEventListener('change', () => {
      updateRouteFormQuantityUI();
    });
  }

  const opFilterInput = document.getElementById('route-op-filter');
  const centerFilterInput = document.getElementById('route-center-filter');
  if (opFilterInput) {
    opFilterInput.addEventListener('input', () => fillRouteSelectors());
  }
  if (centerFilterInput) {
    centerFilterInput.addEventListener('input', () => fillRouteSelectors());
  }

  const cardModalBody = document.querySelector('#card-modal .modal-body');
  if (cardModalBody) {
    cardModalBody.addEventListener('scroll', () => updateRouteTableScrollState());
  }
  window.addEventListener('resize', () => {
    updateRouteTableScrollState();
    if (!isDesktopCardLayout()) {
      setCardMainCollapsed(false);
    }
  });

  document.getElementById('center-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = document.getElementById('center-name').value.trim();
    const desc = document.getElementById('center-desc').value.trim();
    if (!name) return;
    const editingId = e.target.dataset.editingId;
    if (editingId) {
      const target = centers.find(c => c.id === editingId);
      if (target) {
        const prevName = target.name;
        target.name = name;
        target.desc = desc;
        updateCenterReferences(target);
        if (prevName !== name) {
          renderWorkordersTable({ collapseAll: true });
        }
      }
    } else {
      centers.push({ id: genId('wc'), name: name, desc: desc });
    }
    saveData();
    renderCentersTable();
    fillRouteSelectors();
    if (activeCardDraft) {
      renderRouteTableDraft();
    }
    renderCardsTable();
    renderWorkordersTable({ collapseAll: true });
    resetCenterForm();
  });

  const centerCancelBtn = document.getElementById('center-cancel-edit');
  if (centerCancelBtn) {
    centerCancelBtn.addEventListener('click', () => resetCenterForm());
  }

      document.getElementById('op-form').addEventListener('submit', e => {
        e.preventDefault();
        const name = document.getElementById('op-name').value.trim();
        const desc = document.getElementById('op-desc').value.trim();
        const time = parseInt(document.getElementById('op-time').value, 10) || 30;
        if (!name) return;
        const editingId = e.target.dataset.editingId;
        if (editingId) {
          const target = ops.find(o => o.id === editingId);
          if (target) {
            target.name = name;
            target.desc = desc;
            target.recTime = time;
            updateOperationReferences(target);
          }
        } else {
          ops.push({ id: genId('op'), name: name, desc: desc, recTime: time });
        }
        saveData();
        renderOpsTable();
        fillRouteSelectors();
        if (activeCardDraft) {
          renderRouteTableDraft();
        }
        renderCardsTable();
        renderWorkordersTable({ collapseAll: true });
        resetOpForm();
      });

      const opCancelBtn = document.getElementById('op-cancel-edit');
      if (opCancelBtn) {
        opCancelBtn.addEventListener('click', () => resetOpForm());
      }

  const cardsSearchInput = document.getElementById('cards-search');
  const cardsSearchClear = document.getElementById('cards-search-clear');
  if (cardsSearchInput) {
    cardsSearchInput.addEventListener('input', e => {
      cardsSearchTerm = e.target.value || '';
      renderCardsTable();
    });
  }
  if (cardsSearchClear) {
    cardsSearchClear.addEventListener('click', () => {
      cardsSearchTerm = '';
      if (cardsSearchInput) cardsSearchInput.value = '';
      renderCardsTable();
    });
  }

  const workorderAutoscrollCheckbox = document.getElementById('workorder-autoscroll');
  if (workorderAutoscrollCheckbox) {
    workorderAutoscrollCheckbox.checked = workorderAutoScrollEnabled;
    workorderAutoscrollCheckbox.addEventListener('change', (e) => {
      workorderAutoScrollEnabled = !!e.target.checked;
    });
  }

  const searchInput = document.getElementById('workorder-search');
  const searchClearBtn = document.getElementById('workorder-search-clear');
  const statusSelect = document.getElementById('workorder-status');
  const missingExecutorSelect = document.getElementById('workorder-missing-executor');
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      workorderSearchTerm = e.target.value || '';
      renderWorkordersTable({ collapseAll: true });
    });
  }
  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', () => {
      workorderSearchTerm = '';
      if (searchInput) searchInput.value = '';
      if (statusSelect) statusSelect.value = 'ALL';
      workorderStatusFilter = 'ALL';
      workorderMissingExecutorFilter = 'ALL';
      if (missingExecutorSelect) missingExecutorSelect.value = 'ALL';
      renderWorkordersTable({ collapseAll: true });
    });
  }

  if (statusSelect) {
    statusSelect.addEventListener('change', e => {
      workorderStatusFilter = e.target.value || 'ALL';
      renderWorkordersTable({ collapseAll: true });
    });
  }

  if (missingExecutorSelect) {
    missingExecutorSelect.addEventListener('change', e => {
      workorderMissingExecutorFilter = e.target.value || 'ALL';
      renderWorkordersTable({ collapseAll: true });
    });
  }

  const archiveSearchInput = document.getElementById('archive-search');
  const archiveSearchClear = document.getElementById('archive-search-clear');
  const archiveStatusSelect = document.getElementById('archive-status');
  if (archiveSearchInput) {
    archiveSearchInput.addEventListener('input', e => {
      archiveSearchTerm = e.target.value || '';
      renderArchiveTable();
    });
  }
  if (archiveStatusSelect) {
    archiveStatusSelect.addEventListener('change', e => {
      archiveStatusFilter = e.target.value || 'ALL';
      renderArchiveTable();
    });
  }
  if (archiveSearchClear) {
    archiveSearchClear.addEventListener('click', () => {
      archiveSearchTerm = '';
      if (archiveSearchInput) archiveSearchInput.value = '';
      archiveStatusFilter = 'ALL';
      if (archiveStatusSelect) archiveStatusSelect.value = 'ALL';
      renderArchiveTable();
    });
  }

  const workspaceSearchInput = document.getElementById('workspace-search');
  const workspaceSearchSubmit = document.getElementById('workspace-search-submit');
  const workspaceSearchClear = document.getElementById('workspace-search-clear');
  const sanitizeWorkspaceTerm = (value = '') => (value || '').replace(/\D/g, '').slice(0, 13);
  const triggerWorkspaceSearch = () => {
    workspaceSearchTerm = workspaceSearchInput ? sanitizeWorkspaceTerm(workspaceSearchInput.value || '') : '';
    if (workspaceSearchInput) {
      workspaceSearchInput.value = workspaceSearchTerm;
    }
    renderWorkspaceView();
  };

  if (workspaceSearchInput) {
    workspaceSearchInput.addEventListener('input', e => {
      const sanitized = sanitizeWorkspaceTerm(e.target.value || '');
      if (sanitized !== e.target.value) {
        e.target.value = sanitized;
      }
      workspaceSearchTerm = sanitized;
    });
    workspaceSearchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        triggerWorkspaceSearch();
      }
    });
  }
  if (workspaceSearchSubmit) {
    workspaceSearchSubmit.addEventListener('click', triggerWorkspaceSearch);
  }
  if (workspaceSearchClear) {
    workspaceSearchClear.addEventListener('click', () => {
      workspaceSearchTerm = '';
      if (workspaceSearchInput) {
        workspaceSearchInput.value = '';
        focusWorkspaceSearch();
      }
      renderWorkspaceView();
    });
  }
}

// === ОБЩИЙ РЕНДЕР ===
function refreshCardStatuses() {
  cards.forEach(card => recalcCardStatus(card));
}

function renderEverything() {
  refreshCardStatuses();
  renderDashboard();
  renderCardsTable();
  renderCentersTable();
  renderOpsTable();
  fillRouteSelectors();
  renderWorkordersTable();
  renderArchiveTable();
  renderWorkspaceView();
  renderUsersTable();
  renderAccessLevelsTable();
  syncReadonlyLocks();
}

function setupDeleteConfirmModal() {
  const cancelBtn = document.getElementById('delete-confirm-cancel');
  const closeBtn = document.getElementById('delete-confirm-close');
  const confirmBtn = document.getElementById('delete-confirm-apply');
  const modal = document.getElementById('delete-confirm-modal');

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => closeDeleteConfirm());
  }
  if (closeBtn) {
    closeBtn.addEventListener('click', () => closeDeleteConfirm());
  }
  if (modal) {
    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        closeDeleteConfirm();
      }
    });
  }
  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => confirmDeletion());
  }
}

function setupGroupTransferModal() {
  const closeBtn = document.getElementById('group-transfer-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => closeGroupTransferModal());
  }
}

function setupGroupExecutorModal() {
  const createBtn = document.getElementById('group-executor-submit');
  const cancelBtn = document.getElementById('group-executor-cancel');

  if (createBtn) {
    createBtn.addEventListener('click', () => applyGroupExecutorToGroup());
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => closeGroupExecutorModal());
  }
}

function setupAttachmentControls() {
  const modal = document.getElementById('attachments-modal');
  const closeBtn = document.getElementById('attachments-close');
  const addBtn = document.getElementById('attachments-add-btn');
  const input = document.getElementById('attachments-input');
  const cardBtn = document.getElementById('card-attachments-btn');

  if (closeBtn) {
    closeBtn.addEventListener('click', () => closeAttachmentsModal());
  }
  if (addBtn && input) {
    addBtn.addEventListener('click', () => input.click());
    input.addEventListener('change', (e) => {
      addAttachmentsFromFiles(e.target.files);
      input.value = '';
    });
  }
  if (cardBtn) {
    cardBtn.addEventListener('click', () => {
      if (!activeCardDraft) return;
      openAttachmentsModal(activeCardDraft.id, 'draft');
    });
  }
}

function setupWorkspaceModal() {
  const modal = document.getElementById('workspace-stop-modal');
  if (!modal) return;

  const keypadButtons = modal.querySelectorAll('.workspace-keypad button[data-key]');
  keypadButtons.forEach(btn => {
    btn.addEventListener('click', () => applyWorkspaceKeypad(btn.getAttribute('data-key')));
  });

  const enterBtn = document.getElementById('workspace-stop-enter');
  if (enterBtn) {
    enterBtn.addEventListener('click', () => submitWorkspaceStopModal());
  }

  const nextBtn = document.getElementById('workspace-stop-next');
  if (nextBtn) {
    nextBtn.addEventListener('click', () => focusWorkspaceNextInput());
  }

  const confirmBtn = document.getElementById('workspace-stop-confirm');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => submitWorkspaceStopModal());
  }

  const cancelBtn = document.getElementById('workspace-stop-cancel');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => closeWorkspaceStopModal());
  }

  getWorkspaceModalInputs().forEach(input => {
    input.addEventListener('focus', () => setWorkspaceActiveInput(input));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitWorkspaceStopModal();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        focusWorkspaceNextInput();
      }
    });
  });
}

// === ПОЛЬЗОВАТЕЛИ И УРОВНИ ДОСТУПА ===
function renderUsersTable() {
  const container = document.getElementById('users-table');
  const createBtn = document.getElementById('user-create');
  if (!container) return;
  if (!canViewTab('users')) {
    container.innerHTML = '<p>Нет прав для просмотра пользователей.</p>';
    return;
  }
  if (createBtn) createBtn.disabled = !canEditTab('users');
  renderUserDatalist();
  let rows = '';
  users.forEach(u => {
    const level = accessLevels.find(l => l.id === u.accessLevelId);
    rows += '<tr>' +
      '<td>' + escapeHtml(u.name || '') + '</td>' +
      '<td>' + escapeHtml(level ? level.name : 'Не задан') + '</td>' +
      '<td>' + (u.permissions && u.permissions.worker ? 'Да' : 'Нет') + '</td>' +
      '<td class="action-col">' +
        (canEditTab('users') ? '<button class="btn-secondary user-edit" data-id="' + u.id + '">Редактировать</button>' : '') +
        (canEditTab('users') && u.name !== 'Abyss' ? '<button class="btn-secondary user-delete" data-id="' + u.id + '">Удалить</button>' : '') +
      '</td>' +
    '</tr>';
  });
  container.innerHTML = '<table class="security-table"><thead><tr><th>Имя</th><th>Уровень</th><th>Рабочий</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';

  container.querySelectorAll('.user-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      openUserModal(users.find(u => u.id === id) || null);
    });
  });
  container.querySelectorAll('.user-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      if (!confirm('Удалить пользователя?')) return;
      await fetch('/api/security/users/' + id, { method: 'DELETE', credentials: 'include' });
      await loadSecurityData();
      renderUsersTable();
    });
  });
}

function renderAccessLevelsTable() {
  const container = document.getElementById('access-levels-table');
  const createBtn = document.getElementById('access-level-create');
  if (!container) return;
  if (!canViewTab('accessLevels')) {
    container.innerHTML = '<p>Нет прав для просмотра уровней доступа.</p>';
    return;
  }
  if (createBtn) createBtn.disabled = !canEditTab('accessLevels');
  let rows = '';
  accessLevels.forEach(level => {
    const perms = level.permissions || {};
    rows += '<tr>' +
      '<td>' + escapeHtml(level.name || '') + '</td>' +
      '<td>' + escapeHtml(level.description || '') + '</td>' +
      '<td>' + escapeHtml(perms.landingTab || 'dashboard') + '</td>' +
      '<td>' + (perms.worker ? 'Да' : 'Нет') + '</td>' +
      '<td class="action-col">' + (canEditTab('accessLevels') ? '<button class="btn-secondary access-edit" data-id="' + level.id + '">Настроить</button>' : '') + '</td>' +
    '</tr>';
  });
  container.innerHTML = '<table class="security-table"><thead><tr><th>Название</th><th>Описание</th><th>Стартовая вкладка</th><th>Рабочий</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';

  container.querySelectorAll('.access-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const level = accessLevels.find(l => l.id === id) || null;
      openAccessLevelModal(level);
    });
  });
}

function buildPermissionGrid(level = {}) {
  const perms = level.permissions || {};
  return ACCESS_TAB_CONFIG.map(tab => {
    const tabPerms = perms.tabs && perms.tabs[tab.key] ? perms.tabs[tab.key] : { view: true, edit: true };
    return '<div class="permission-card">' +
      '<h4>' + escapeHtml(tab.label) + '</h4>' +
      '<label class="toggle-row"><input type="checkbox" data-perm="view" data-tab="' + tab.key + '" ' + (tabPerms.view ? 'checked' : '') + '> Просмотр</label>' +
      '<label class="toggle-row"><input type="checkbox" data-perm="edit" data-tab="' + tab.key + '" ' + (tabPerms.edit ? 'checked' : '') + '> Изменение</label>' +
    '</div>';
  }).join('');
}

function openUserModal(user) {
  const modal = document.getElementById('user-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  document.getElementById('user-id').value = user ? user.id : '';
  document.getElementById('user-name').value = user ? user.name || '' : '';
  const pwdInput = document.getElementById('user-password');
  if (pwdInput) {
    pwdInput.setAttribute('type', 'password');
    const resolvedPassword = resolveUserPassword(user);
    pwdInput.value = resolvedPassword;
    pwdInput.dataset.initialPassword = resolvedPassword || '';
  }
  const select = document.getElementById('user-access-level');
  if (select) {
    select.innerHTML = accessLevels.map(l => '<option value="' + l.id + '">' + escapeHtml(l.name || '') + '</option>').join('');
    select.value = user ? user.accessLevelId : (accessLevels[0] ? accessLevels[0].id : '');
  }
}

function openAccessLevelModal(level) {
  const modal = document.getElementById('access-level-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  document.getElementById('access-level-id').value = level ? level.id : '';
  document.getElementById('access-level-name').value = level ? level.name || '' : '';
  document.getElementById('access-level-desc').value = level ? level.description || '' : '';
  document.getElementById('access-landing').value = level ? (level.permissions?.landingTab || 'dashboard') : 'dashboard';
  document.getElementById('access-timeout').value = level ? (level.permissions?.inactivityTimeoutMinutes || 30) : 30;
  document.getElementById('access-worker').checked = level ? !!level.permissions?.worker : false;
  document.getElementById('access-permissions').innerHTML = buildPermissionGrid(level || {});
}

function renderUserDatalist() {
  let list = document.getElementById(USER_DATALIST_ID);
  if (!list) {
    list = document.createElement('datalist');
    list.id = USER_DATALIST_ID;
    document.body.appendChild(list);
  }
  const filteredUsers = getEligibleExecutorUsers();
  list.innerHTML = filteredUsers.map(u => '<option value="' + escapeHtml(u.name || '') + '"></option>').join('');
}

function closeUserModal() {
  const modal = document.getElementById('user-modal');
  if (modal) modal.classList.add('hidden');
}

function closeAccessLevelModal() {
  const modal = document.getElementById('access-level-modal');
  if (modal) modal.classList.add('hidden');
}

async function saveUserFromModal() {
  const id = document.getElementById('user-id').value;
  const name = document.getElementById('user-name').value;
  const passwordInput = document.getElementById('user-password');
  const initialPassword = passwordInput ? (passwordInput.dataset.initialPassword || '') : '';
  const password = passwordInput ? passwordInput.value.trim() : '';
  const accessLevelId = document.getElementById('user-access-level').value;
  const errorEl = document.getElementById('user-error');
  if (errorEl) { errorEl.textContent = ''; }
  const passwordChanged = !!password && password !== initialPassword;
  const payload = { name, password: passwordChanged ? password : undefined, accessLevelId, status: 'active' };
  const method = id ? 'PUT' : 'POST';
  const url = id ? '/api/security/users/' + id : '/api/security/users';
  const res = await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    if (errorEl) errorEl.textContent = data.error || 'Ошибка сохранения';
    return;
  }
  await loadSecurityData();
  const updatedUser = id ? users.find(u => u.id === id) : users.find(u => (u.name || '') === name);
  const effectivePassword = passwordChanged ? password : (initialPassword || resolveUserPassword(updatedUser));
  if (updatedUser && effectivePassword) {
    rememberUserPassword(updatedUser.id, effectivePassword);
  }
  renderUsersTable();
  closeUserModal();
}

async function saveAccessLevelFromModal() {
  const id = document.getElementById('access-level-id').value;
  const name = document.getElementById('access-level-name').value;
  const description = document.getElementById('access-level-desc').value;
  const landingTab = document.getElementById('access-landing').value;
  const timeout = parseInt(document.getElementById('access-timeout').value, 10) || 30;
  const worker = document.getElementById('access-worker').checked;
  const errorEl = document.getElementById('access-error');
  const checkboxEls = document.querySelectorAll('#access-permissions input[type="checkbox"]');
  const permissions = { tabs: {}, attachments: { upload: true, remove: true }, landingTab, inactivityTimeoutMinutes: timeout, worker };
  checkboxEls.forEach(cb => {
    const tab = cb.getAttribute('data-tab');
    const perm = cb.getAttribute('data-perm');
    permissions.tabs[tab] = permissions.tabs[tab] || { view: false, edit: false };
    permissions.tabs[tab][perm] = cb.checked;
  });
  const payload = { id: id || undefined, name, description, permissions };
  const res = await fetch('/api/security/access-levels', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    if (errorEl) errorEl.textContent = data.error || 'Ошибка сохранения';
    return;
  }
  await loadSecurityData();
  renderAccessLevelsTable();
  closeAccessLevelModal();
}

function setupSecurityControls() {
  const createUserBtn = document.getElementById('user-create');
  if (createUserBtn) {
    createUserBtn.addEventListener('click', () => openUserModal(null));
  }
  const createLevelBtn = document.getElementById('access-level-create');
  if (createLevelBtn) {
    createLevelBtn.addEventListener('click', () => openAccessLevelModal(null));
  }
  const userCancel = document.getElementById('user-cancel');
  if (userCancel) userCancel.addEventListener('click', () => closeUserModal());
  const accessCancel = document.getElementById('access-cancel');
  if (accessCancel) accessCancel.addEventListener('click', () => closeAccessLevelModal());
  const userForm = document.getElementById('user-form');
  if (userForm) {
    userForm.addEventListener('submit', async e => {
      e.preventDefault();
      await saveUserFromModal();
    });
  }
  const levelForm = document.getElementById('access-level-form');
  if (levelForm) {
    levelForm.addEventListener('submit', async e => {
      e.preventDefault();
      await saveAccessLevelFromModal();
    });
  }
  const userGenerate = document.getElementById('user-generate');
  if (userGenerate) {
    userGenerate.addEventListener('click', () => {
      const pwd = generatePassword();
      const input = document.getElementById('user-password');
      if (input) input.value = pwd;
    });
  }
  const passwordToggle = document.getElementById('user-password-visibility');
  if (passwordToggle) {
    passwordToggle.addEventListener('click', () => {
      const input = document.getElementById('user-password');
      if (!input) return;
      const isHidden = input.getAttribute('type') === 'password';
      input.setAttribute('type', isHidden ? 'text' : 'password');
      passwordToggle.setAttribute('aria-label', isHidden ? 'Скрыть пароль' : 'Показать пароль');
    });
  }
  const userBarcode = document.getElementById('user-barcode');
  if (userBarcode) {
    userBarcode.addEventListener('click', () => {
      const input = document.getElementById('user-password');
      const nameInput = document.getElementById('user-name');
      const idInput = document.getElementById('user-id');
      const pwd = input ? input.value : '';
      const username = nameInput ? nameInput.value : '';
      const userId = idInput ? idInput.value : '';
      if (!pwd) { alert('Введите или сгенерируйте пароль'); return; }
      openPasswordBarcode(pwd, username, userId);
    });
  }
}

// === ИНИЦИАЛИЗАЦИЯ ===
document.addEventListener('DOMContentLoaded', async () => {
  loadUserPasswordCache();
  setupResponsiveNav();
  startRealtimeClock();
  setupAuthControls();
  setupHelpModal();
  updateUserBadge();
  hideMainApp();
  showAuthOverlay();
  await restoreSession();
});
