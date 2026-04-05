// === КОНСТАНТЫ И ГЛОБАЛЬНЫЕ МАССИВЫ ===
const API_ENDPOINT = '/api/data';
const APPROVAL_STATUS_APPROVED = 'Согласовано';
const APPROVAL_STATUS_REJECTED = 'Не согласовано';
const APPROVAL_STAGE_DRAFT = 'DRAFT';
const APPROVAL_STAGE_ON_APPROVAL = 'ON_APPROVAL';
const APPROVAL_STAGE_REJECTED = 'REJECTED';
const APPROVAL_STAGE_APPROVED = 'APPROVED';
const APPROVAL_STAGE_WAITING_INPUT_CONTROL = 'WAITING_INPUT_CONTROL';
const APPROVAL_STAGE_WAITING_PROVISION = 'WAITING_PROVISION';
const APPROVAL_STAGE_PROVIDED = 'PROVIDED';
const APPROVAL_STAGE_PLANNING = 'PLANNING';
const APPROVAL_STAGE_PLANNED = 'PLANNED';

let cards = [];
let ops = [];
let centers = [];
let areas = [];
let accessLevels = [];
let users = [];
let unreadMessagesCount = 0;
let productionSchedule = [];
let productionShiftTimes = [];
let productionShiftTasks = [];
let productionShifts = [];
let userPasswordCache = {};
let workorderSearchTerm = '';
let workorderStatusFilter = 'ALL';
let workorderMissingExecutorFilter = 'ALL';
let workorderAvailabilityMode = 'ALL';
let workorderFilterDate = '';
let workorderFilterShift = '';
let workorderAutoScrollEnabled = true;
let suppressWorkorderAutoscroll = false;
const MOBILE_OPERATIONS_BREAKPOINT = 768;
let activeMobileCardId = null;
let mobileWorkorderScroll = 0;
let mobileOpsScrollTop = 0;
let mobileOpsObserver = null;
let archiveSearchTerm = '';
let archiveStatusFilter = 'ALL';
let approvalsSearchTerm = '';
let provisionSearchTerm = '';
let inputControlSearchTerm = '';
let operationsSortKey = '';
let operationsSortDir = 'asc';
let cardsSortKey = '';
let cardsSortDir = 'asc';
let cardsTableCurrentPage = 1;
let approvalsSortKey = '';
let approvalsSortDir = 'asc';
let provisionSortKey = '';
let provisionSortDir = 'asc';
let inputControlSortKey = '';
let inputControlSortDir = 'asc';
let apiOnline = false;
const workorderOpenCards = new Set();
let activeCardDraft = null;
let activeCardOriginalId = null;
let activeCardIsNew = false;
let activeMkiDraft = null;
let activeMkiId = null;
let mkiIsNew = false;
let cardsSearchTerm = '';
let cardsAuthorFilter = '';
let attachmentContext = null;
let routeQtyManual = false;
let imdxImportState = { parsed: null, missing: null };
const IMDX_ALLOWED_CENTERS = ['ТО', 'ПО', 'СКК', 'Склад', 'УГН', 'УТО', 'ИЛ'];
const DEBUG_IMDX = false;
const ATTACH_ACCEPT = '.pdf,.doc,.docx,.jpg,.jpeg,.png,.zip,.rar,.7z';
const ATTACH_MAX_SIZE = 15 * 1024 * 1024; // 15 MB
let logContextCardId = null;
let clockIntervalId = null;
let dashboardStatusSnapshot = null;
let dashboardEligibleCache = [];
let workspaceSearchTerm = '';
let scannerRegistry = {};
let appState = { tab: 'dashboard', modal: null };
let restoringState = false;
let productionLiveDebounceTimer = null;
let productionLiveInFlight = false;
let productionLivePending = false;
let workspaceStopContext = null;
let workspaceActiveModalInput = null;
let workspaceTransferContext = null;
let workspaceTransferSelections = new Map();
let workspaceTransferNameEdits = new Map();
let workspaceTransferDocFiles = [];
let workspaceTransferDocIdentifier = 'ХА';
let workspaceItemResultContext = null;
let workspaceTransferScannerState = null;
let cardActiveSectionKey = 'main';
let deleteContext = null;
let cardRenderMode = 'modal';
let directoryRenderMode = 'modal';
let cardPageMount = null;
let directoryPageMount = null;
let cardsLiveLastRevision = 0;
let cardsLiveCardRevs = {};
let cardsSse = null;
let cardsLiveInFlight = false;
let cardsLivePending = false;
let cardsLiveDebounceTimer = null;
let cardsLiveFallbackTimer = null;
let cardsLiveTickTimer = null;
let cardsSseOnline = false;
let cardsLiveAbort = null;
let cardsLiveFallbackStartTimer = null;
let cardsLiveLastTickAt = 0;
let cardsLiveMissingIds = new Set();
const modalMountRegistry = {
  card: { placeholder: null, home: null },
  directory: { placeholder: null, home: null }
};
const ACCESS_TAB_CONFIG = [
  { key: 'dashboard', label: 'Дашборд' },
  { key: 'cards', label: 'МК' },
  { key: 'approvals', label: 'Согласование' },
  { key: 'provision', label: 'Обеспечение' },
  { key: 'input-control', label: 'Входной контроль' },
  { key: 'production', label: 'Производство' },
  { key: 'departments', label: 'Подразделения' },
  { key: 'operations', label: 'Операции' },
  { key: 'areas', label: 'Участки' },
  { key: 'employees', label: 'Сотрудники' },
  { key: 'shift-times', label: 'Время смен' },
  { key: 'workorders', label: 'Трекер' },
  { key: 'items', label: 'Изделия' },
  { key: 'ok', label: 'Образцы контрольные' },
  { key: 'oc', label: 'Образцы свидетели' },
  { key: 'archive', label: 'Архив' },
  { key: 'workspace', label: 'Рабочее место' },
  { key: 'users', label: 'Пользователи' },
  { key: 'accessLevels', label: 'Уровни доступа' }
];
const USER_DATALIST_ID = 'user-combobox-options';
const FORBIDDEN_EXECUTOR = 'abyss';
const USER_PASSWORD_CACHE_KEY = 'userPasswordCache';
let currentUser = null;
let csrfToken = null;
let appBootstrapped = false;
let timersStarted = false;
let inactivityTimer = null;
let userBadgeClickBound = false;
const OPERATION_TYPE_OPTIONS = ['Стандартная', 'Идентификация', 'Документы', 'Получение материала', 'Возврат материала', 'Сушка'];
const DEFAULT_OPERATION_TYPE = OPERATION_TYPE_OPTIONS[0];
const AREA_TYPE_OPTIONS = ['Производство', 'Качество', 'Лаборатория', 'Субподрядчик', 'Индивидуальный'];
const AREA_TYPE_DISPLAY_LABELS = Object.freeze({
  Индивидуальный: 'Индивид.'
});
const DEFAULT_AREA_TYPE = AREA_TYPE_OPTIONS[0];

const CARDS_LIVE_TABS = new Set(['cards', 'dashboard', 'approvals', 'provision', 'input-control']);
let __routeCleanup = null;

function setRouteCleanup(fn) {
  __routeCleanup = (typeof fn === 'function') ? fn : null;
}

function runRouteCleanup() {
  try { __routeCleanup && __routeCleanup(); } catch (e) {}
  __routeCleanup = null;
}

function getAppMain() {
  return document.getElementById('app-main');
}

function mountTemplate(tplId) {
  const tpl = document.getElementById(tplId);
  const mount = getAppMain();
  if (!tpl || !mount) return false;


  // cleanup previous page
  runRouteCleanup();

  // replace DOM
  mount.innerHTML = '';
  const frag = tpl.content.cloneNode(true);
  mount.appendChild(frag);
  const root = mount.firstElementChild;
  try {
    console.log('[MOUNT]', {
      tplId,
      hasRoot: !!root,
      mountChildren: mount.children ? mount.children.length : 0,
      path: location.pathname
    });
  } catch (e) {}
  // NOTE: do NOT strip `.active` from all sections inside the newly mounted template.
  // Some templates rely on nested <section class="active"> for visible content.
  if (root) {
    root.classList.remove('hidden');

    // Important: templates for page-mode use the HTML [hidden] attribute
    if (root.hasAttribute('hidden')) root.removeAttribute('hidden');
    root.hidden = false;
// Unhide descendants inside the mounted template (some templates mark inner blocks as .hidden/[hidden])
try {
  root.querySelectorAll('[hidden]').forEach(el => {
    try { el.hidden = false; el.removeAttribute('hidden'); } catch (e) {}
  });
  root.querySelectorAll('.hidden').forEach(el => {
    try { el.classList.remove('hidden'); } catch (e) {}
  });
} catch (e) {}

    if (root.tagName === 'SECTION') {
      root.classList.add('active');
    } else {
      const fallbackSection = mount.querySelector('section');
      if (fallbackSection) fallbackSection.classList.add('active');
    }
  }
  return true;
}

function isCardsLiveRoute(pathname = location.pathname) {
  if (pathname === '/cards'
    || pathname === '/dashboard'
    || pathname === '/approvals'
    || pathname === '/provision'
    || pathname === '/input-control') {
    return true;
  }
  return CARDS_LIVE_TABS.has(appState?.tab);
}

function isProductionLiveRoute(pathname = location.pathname) {
  return String(pathname || '').startsWith('/production/');
}

function startCardsLiveIfNeeded(targetTab) {
  if (targetTab && !CARDS_LIVE_TABS.has(targetTab)) return;
  startCardsSse();
  startCardsLiveTick();
  scheduleCardsLiveRefresh('route', 0);
}

function stopCardsLiveIfNeeded() {
  stopCardsSse();
  stopCardsLivePolling();
}

function startProductionLiveIfNeeded() {
  startCardsSse();
}

function stopProductionLiveIfNeeded() {
  if (productionLiveDebounceTimer) {
    clearTimeout(productionLiveDebounceTimer);
    productionLiveDebounceTimer = null;
  }
  productionLiveInFlight = false;
  productionLivePending = false;
  stopCardsSse();
}

async function runProductionLiveRefresh(reason = 'manual') {
  if (!isProductionLiveRoute()) return;
  if (reason === 'sse' && Date.now() < Number(window.__productionLiveIgnoreUntil || 0)) return;
  if (productionLiveInFlight) {
    productionLivePending = true;
    return;
  }
  productionLiveInFlight = true;
  try {
    await loadData();
    const fullPath = `${window.location.pathname || ''}${window.location.search || ''}`;
    handleRoute(fullPath, { replace: true, fromHistory: true, soft: true });
  } catch {
    // silent
  } finally {
    productionLiveInFlight = false;
    if (productionLivePending) {
      productionLivePending = false;
      scheduleProductionLiveRefresh('pending', 0);
    }
  }
}

function scheduleProductionLiveRefresh(reason, delay = 300) {
  if (!isProductionLiveRoute()) return;
  if (productionLiveDebounceTimer) {
    clearTimeout(productionLiveDebounceTimer);
  }
  productionLiveDebounceTimer = setTimeout(() => {
    productionLiveDebounceTimer = null;
    runProductionLiveRefresh(reason);
  }, delay);
}

function isActiveWorker(user) {
  if (!user || typeof user !== 'object') return false;
  const normalizedStatus = (user.status || 'active').toLowerCase();
  if (normalizedStatus === 'deleted' || normalizedStatus === 'disabled' || normalizedStatus === 'inactive') return false;
  return hasWorkerLikePermissions(user.permissions);
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

function normalizeUserId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^id\d+$/i.test(raw)) return 'id' + raw.slice(2).replace(/\D/g, '');
  if (/^\d+$/.test(raw)) return 'id' + raw;
  return raw;
}

function findUserNameById(userId) {
  const normalizedId = normalizeUserId(userId);
  if (!normalizedId) return '';
  const profileUser =
    (users || []).find(u => normalizeUserId(u && u.id) === normalizedId) ||
    ((currentUser && normalizeUserId(currentUser.id) === normalizedId) ? currentUser : null);
  return (profileUser && profileUser.name ? profileUser.name : '').trim();
}

function renderUserPage(userId) {
  const rawId = String(userId || '').trim();
  const normalizedId = normalizeUserId(rawId);
  const displayId = rawId || normalizedId || '';
  const profileUser =
    (users || []).find(u => normalizeUserId(u && u.id) === normalizedId) ||
    ((currentUser && normalizeUserId(currentUser.id) === normalizedId) ? currentUser : null);
  const name = (profileUser && profileUser.name ? profileUser.name : '').trim();
  const showMissing = !profileUser;

  return `
    <div class="card">
      <h2>Профиль пользователя</h2>
      <div>ID: ${escapeHtml(displayId)}</div>
      ${name ? `<div>Имя: ${escapeHtml(name)}</div>` : ''}
      ${showMissing ? '<div class="muted">Пользователь не найден</div>' : ''}
    </div>
  `;
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

function getDefaultProductionShiftTimes() {
  return [
    { shift: 1, timeFrom: '08:00', timeTo: '16:00', lunchFrom: '', lunchTo: '' },
    { shift: 2, timeFrom: '16:00', timeTo: '00:00', lunchFrom: '', lunchTo: '' },
    { shift: 3, timeFrom: '00:00', timeTo: '08:00', lunchFrom: '', lunchTo: '' }
  ];
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
  if (!userBadgeClickBound) {
    badge.addEventListener('click', () => {
      if (currentUser) {
        handleRoute('/profile/' + currentUser.id);
      }
    });
    userBadgeClickBound = true;
  }
  if (currentUser) {
    const name = currentUser.name || 'Пользователь';
    badge.innerHTML = `<span class="user-name">${escapeHtml(name)}</span>` +
      `<span class="unread-count">${unreadMessagesCount}</span>`;
    badge.classList.toggle('has-unread', unreadMessagesCount > 0);
    badge.classList.remove('hidden');
  } else {
    unreadMessagesCount = 0;
    badge.innerHTML = '<span class="user-name">Не авторизовано</span><span class="unread-count">0</span>';
    badge.classList.remove('has-unread');
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

function showSessionOverlay(message = 'Проверка сессии...') {
  const overlay = document.getElementById('session-overlay');
  const messageEl = document.getElementById('session-message');
  if (messageEl) messageEl.textContent = message;
  if (overlay) overlay.classList.remove('hidden');
}

function hideSessionOverlay() {
  const overlay = document.getElementById('session-overlay');
  if (overlay) overlay.classList.add('hidden');
}

function setCsrfToken(token) {
  csrfToken = token || null;
}

async function apiFetch(url, options = {}) {
  const opts = { ...options };
  const method = (opts.method || 'GET').toUpperCase();
  opts.method = method;
  opts.credentials = 'include';
  opts.headers = { ...(opts.headers || {}) };
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    if (csrfToken) {
      opts.headers['X-CSRF-Token'] = csrfToken;
    }
  }

  const res = await fetch(url, opts);
  if (res.status === 401) {
    handleUnauthorized('Сессия истекла, войдите снова');
    throw new Error('Unauthorized');
  }
  return res;
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
  setCsrfToken(null);
  updateUserBadge();
  hideMainApp();
  hideSessionOverlay();
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

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && location.pathname === '/cards') {
    scheduleCardsLiveRefresh('visibility', 0);
  }
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
    if (target === 'production' || target === 'items-hub') return;
    if (canViewTab(target)) {
      tabs.push(target);
    }
  });
  ['approvals', 'provision', 'departments', 'operations', 'areas', 'employees', 'shift-times', 'items', 'ok', 'oc'].forEach(tab => {
    if (canViewTab(tab) && !tabs.includes(tab)) {
      tabs.push(tab);
    }
  });
  return tabs.length ? tabs : ['dashboard'];
}

function getDefaultTab() {
  const allowed = getAllowedTabs();
  const landing = currentUser?.permissions?.landingTab || 'dashboard';
  return allowed.includes(landing) ? landing : allowed[0];
}

function updateHistoryState({ replace = false } = {}) {
  if (restoringState) return;
  const method = replace ? 'replaceState' : 'pushState';
  try {
    const isHome = window.location.pathname === '/';
    const hasHash = !!window.location.hash;
    const pathWithSearch = window.location.pathname + window.location.search;
    const currentHash = window.location.hash;

    let url;
    if (appState.route) {
      url = hasHash && appState.route === pathWithSearch
        ? appState.route + currentHash
        : appState.route;
    } else if (isHome || hasHash) {
      url = '#' + (appState.tab || '');
    } else {
      url = pathWithSearch;
    }
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

function isPageRoute(pathname = window.location.pathname) {
  const pageRoutes = ['/cards/new', '/cards-mki/new'];
  if (pageRoutes.includes(pathname)) return true;
  if (pathname.startsWith('/cards/') && pathname !== '/cards/new') return true;
  if (pathname.startsWith('/card-route/')) return true;
  if (pathname.startsWith('/workorders/')) return true;
  if (pathname.startsWith('/workspace/')) return true;
  if (pathname.startsWith('/archive/')) return true;
  if (pathname === '/profile' || pathname === '/profile/') return true;
  if (pathname.startsWith('/profile/')) return true;
  return false;
}

function ensureModalHome(modal, registryKey) {
  if (!modal) return null;
  const registry = modalMountRegistry[registryKey];
  if (!registry) return null;
  if (!registry.home) {
    registry.home = modal.parentElement || null;
    registry.placeholder = document.createComment(`${registryKey}-modal-placeholder`);
    if (registry.home) {
      registry.home.insertBefore(registry.placeholder, modal.nextSibling);
    }
  }
  return registry;
}

function restoreModalToHome(modal, registryKey) {
  const registry = ensureModalHome(modal, registryKey);
  if (!registry || !registry.home || !registry.placeholder) return;
  if (registry.placeholder.parentNode) {
    registry.placeholder.parentNode.insertBefore(modal, registry.placeholder);
  }
}

function mountModalToPage(modal, registryKey, mountEl) {
  const registry = ensureModalHome(modal, registryKey);
  if (!modal || !registry || !mountEl) return;
  mountEl.appendChild(modal);
}

function showPage(pageId) {
  const views = document.querySelectorAll('.page-view');
  views.forEach(view => { view.hidden = true; });
  if (!pageId) return;
  const target = document.getElementById(pageId);
  if (target) {
    target.hidden = false;
    window.scrollTo(0, 0);
  }
}

function resetPageContainer(el) {
  if (!el) return;
  const cardModal = document.getElementById('card-modal');
  if (cardModal && el.contains(cardModal)) {
    restoreModalToHome(cardModal, 'card');
  }
  const directoryModal = document.getElementById('directory-modal');
  if (directoryModal && el.contains(directoryModal)) {
    restoreModalToHome(directoryModal, 'directory');
  }
  el.innerHTML = '';
}

function closePageScreens() {
  showPage(null);
  closeCardModal(true);
  closeDirectoryModal(true);
  document.body.classList.remove('page-card-mode');
  document.body.classList.remove('page-directory-mode');
  document.body.classList.remove('page-wo-mode');
}

function ensureMainSectionVisible() {
  const mount = getAppMain && getAppMain();
  if (!mount) return;
  const sections = Array.from(mount.querySelectorAll('section'));
  if (!sections.length) return;
  const hasActive = sections.some(sec => sec.classList.contains('active'));
  sections.forEach(sec => sec.classList.remove('hidden'));
  if (!hasActive) {
    sections[0].classList.add('active');
  }
}

function applyCardsLiveSummary(summary) {
  if (!summary || !summary.id) return;
  const idx = cards.findIndex(c => c.id === summary.id);
  if (idx < 0) {
    requestCardsLiveCardInsert(summary);
    return;
  }

  const card = cards[idx];

  if (summary.approvalStage != null) card.approvalStage = summary.approvalStage;

  if (Array.isArray(summary.operationsLive)) {
    if (!Array.isArray(card.operations)) card.operations = [];
    summary.operationsLive.forEach(lop => {
      if (!lop || !lop.id) return;
      const existing = card.operations.find(o => o && o.id === lop.id);
      if (existing) {
        existing.status = lop.status;
        existing.elapsedSeconds = lop.elapsedSeconds;
        existing.startedAt = lop.startedAt;
        existing.order = lop.order;
        existing.plannedMinutes = lop.plannedMinutes;
        existing.opName = lop.opName;
        existing.opCode = lop.opCode;
      } else {
        card.operations.push({
          id: lop.id,
          status: lop.status,
          elapsedSeconds: lop.elapsedSeconds,
          startedAt: lop.startedAt,
          order: lop.order,
          plannedMinutes: lop.plannedMinutes,
          opName: lop.opName,
          opCode: lop.opCode
        });
      }
    });
  }

  // Канонический статус карты из сервера
  if (summary.productionStatus != null) {
    card.productionStatus = summary.productionStatus;
    // для легаси-мест, где ещё читают card.status
    card.status = summary.productionStatus;
  } else if (summary.status != null) {
    // fallback совместимости
    card.productionStatus = summary.status;
    card.status = summary.status;
  }

  if (typeof summary.rev === 'number') {
    cardsLiveCardRevs[summary.id] = summary.rev;
    card.rev = summary.rev;
  }

  if (typeof summary.opsCount === 'number') card.__liveOpsCount = summary.opsCount;
  if (typeof summary.filesCount === 'number') card.__liveFilesCount = summary.filesCount;

  updateCardsRowLiveFields(card);
  if (typeof updateDashboardRowLiveFields === 'function') updateDashboardRowLiveFields(card);
  if (typeof insertDashboardRowLive === 'function') insertDashboardRowLive(card);
  if (typeof insertApprovalsRowLive === 'function') insertApprovalsRowLive(card);
  if (typeof insertProvisionRowLive === 'function') insertProvisionRowLive(card);
  if (typeof insertInputControlRowLive === 'function') insertInputControlRowLive(card);
}

async function requestCardsLiveCardInsert(summary) {
  if (!summary || !summary.id) return;
  if (!isCardsLiveRoute()) return;
  if (cardsLiveMissingIds.has(summary.id)) return;
  cardsLiveMissingIds.add(summary.id);

  try {
    const resp = await fetch('/api/data', {
      method: 'GET',
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    });
    if (!resp.ok) return;
    const data = await resp.json();
    if (!data || !Array.isArray(data.cards)) return;
    const card = data.cards.find(item => item && item.id === summary.id);
    if (!card) return;
    if (cards.find(existing => existing && existing.id === card.id)) return;
    cards.push(card);
    cardsLiveCardRevs[card.id] = card.rev || 1;
    if (typeof insertCardsRowLive === 'function') insertCardsRowLive(card);
    applyCardsLiveSummary(summary);
  } catch (e) {
    // silent
  } finally {
    cardsLiveMissingIds.delete(summary.id);
  }
}

async function refreshCardsDataOnEnter() {
  try {
    const resp = await fetch('/api/cards-live?rev=0', {
      method: 'GET',
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    });
    if (!resp.ok) return;

    const data = await resp.json();
    if (!data || !Array.isArray(data.cards)) return;
    (data.cards || []).forEach(applyCardsLiveSummary);
    cards.forEach(card => {
      if (!card || !card.id) return;
      cardsLiveCardRevs[card.id] = card.rev || 1;
    });
  } catch (e) {
    // молча игнорируем
  }
}

function scheduleCardsLiveRefresh(reason, delay = 300) {
  if (!isCardsLiveRoute()) return;
  if (cardsLiveDebounceTimer) clearTimeout(cardsLiveDebounceTimer);
  cardsLiveDebounceTimer = setTimeout(() => {
    cardsLiveDebounceTimer = null;
    runCardsLiveRefresh(reason);
  }, delay);
}

async function runCardsLiveRefresh(reason) {
  if (!isCardsLiveRoute()) return;
  if (cardsLiveInFlight) {
    cardsLivePending = true;
    return;
  }

  cardsLiveInFlight = true;
  cardsLivePending = false;
  let abort = null;

  try {
    abort = new AbortController();
    cardsLiveAbort = abort;
    const cardRevsParam = encodeURIComponent(JSON.stringify(cardsLiveCardRevs || {}));
    const url = '/api/cards-live?cardRevs=' + cardRevsParam;
    const resp = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      headers: { 'Accept': 'application/json' },
      signal: abort.signal
    });
    if (!resp.ok) return;

    const data = await resp.json();
    if (!data) return;
    if (!isCardsLiveRoute()) return;

    if (data.changed === false) {
      // changed === false — синхронизируем все строки
      cards.forEach(card => {
        applyCardsLiveSummary({
          id: card.id,
          approvalStage: card.approvalStage,
          status: card.status,
          opsCount: card.__liveOpsCount,
          filesCount: card.__liveFilesCount
        });
      });
    } else if (Array.isArray(data.cards) && data.cards.length > 0) {
      // Если есть карты – обновляем только изменённые
      data.cards.forEach(applyCardsLiveSummary);
    } else {
      // На всякий случай синхронизируем все строки при пустом списке
      cards.forEach(card => {
        applyCardsLiveSummary({
          id: card.id,
          approvalStage: card.approvalStage,
          status: card.status,
          opsCount: card.__liveOpsCount,
          filesCount: card.__liveFilesCount
        });
      });
    }
  } catch (e) {
    // молча
  } finally {
    cardsLiveInFlight = false;
    // запрос завершён/отменён — контроллер больше не нужен (только если это именно он)
    if (cardsLiveAbort === abort) cardsLiveAbort = null;
    if (cardsLivePending) {
      cardsLivePending = false;
      scheduleCardsLiveRefresh('pending', 0);
    }
  }
}

function startCardsFallbackPolling() {
  if (cardsLiveFallbackTimer) return;
  cardsLiveFallbackTimer = setInterval(() => {
    if (isCardsLiveRoute() && !cardsSseOnline) {
      scheduleCardsLiveRefresh('fallback');
    }
  }, 30000);
}

function scheduleCardsFallbackStart() {
  if (cardsLiveFallbackStartTimer) return;
  cardsLiveFallbackStartTimer = setTimeout(() => {
    cardsLiveFallbackStartTimer = null;
    if (isCardsLiveRoute() && !cardsSseOnline) {
      startCardsFallbackPolling();
    }
  }, 8000);
}

function stopCardsFallbackPolling() {
  if (!cardsLiveFallbackTimer) return;
  clearInterval(cardsLiveFallbackTimer);
  cardsLiveFallbackTimer = null;
}

function startCardsLiveTick() {
  if (cardsLiveTickTimer) return;
  cardsLiveTickTimer = setInterval(() => {
    if (!isCardsLiveRoute()) return;
    if (document.hidden) return;
    if (Date.now() - cardsLiveLastTickAt < 4000) return;
    cardsLiveLastTickAt = Date.now();
    scheduleCardsLiveRefresh('tick', 0);
  }, 5000);
}

function stopCardsLiveTick() {
  if (!cardsLiveTickTimer) return;
  clearInterval(cardsLiveTickTimer);
  cardsLiveTickTimer = null;
}

function startCardsSse() {
  if (cardsSse) return;
  cardsSseOnline = false;
  cardsSse = new EventSource('/api/events/stream');

  cardsSse.addEventListener('open', () => {
    cardsSseOnline = true;
    if (cardsLiveFallbackStartTimer) {
      clearTimeout(cardsLiveFallbackStartTimer);
      cardsLiveFallbackStartTimer = null;
    }
    stopCardsFallbackPolling();
  });

  cardsSse.addEventListener('cards:changed', (e) => {
    try {
      const msg = JSON.parse(e.data || '{}');
      if (typeof msg.revision === 'number') {
        // источник истины — /api/cards-live
      }
    } catch {}
    scheduleCardsLiveRefresh('sse');
    scheduleProductionLiveRefresh('sse', 0);
  });

  cardsSse.onerror = () => {
    // no toasts; silent reconnect is fine
    cardsSseOnline = false;
    scheduleCardsFallbackStart();
  };
}

function stopCardsSse() {
  if (!cardsSse) return;
  try { cardsSse.close(); } catch {}
  cardsSse = null;
  cardsSseOnline = false;

  if (cardsLiveFallbackStartTimer) {
    clearTimeout(cardsLiveFallbackStartTimer);
    cardsLiveFallbackStartTimer = null;
  }
}

function stopCardsLivePolling() {
  stopCardsLiveTick();
  stopCardsFallbackPolling();
  if (cardsLiveFallbackStartTimer) {
    clearTimeout(cardsLiveFallbackStartTimer);
    cardsLiveFallbackStartTimer = null;
  }
  if (cardsLiveDebounceTimer) {
    clearTimeout(cardsLiveDebounceTimer);
    cardsLiveDebounceTimer = null;
  }
  if (cardsLiveAbort) {
    try { cardsLiveAbort.abort(); } catch {}
  }
  cardsLiveAbort = null;
  cardsLiveInFlight = false;
  cardsLivePending = false;
}

function isAbyssUser(user) {
  if (!user) return false;
  return user.name === 'Abyss' || user.userName === 'Abyss' || user.login === 'Abyss';
}

const APP_ROUTE_CHUNK_KEYS = {
  DASHBOARD: 'dashboard',
  CARDS: 'cards',
  DIRECTORIES: 'directories',
  ITEMS: 'items',
  APPROVALS: 'approvals',
  PRODUCTION: 'production',
  SECURITY: 'security',
  MESSENGER: 'messenger'
};

function getAppChunkState() {
  if (!window.__APP_CHUNK_STATE__) {
    window.__APP_CHUNK_STATE__ = {
      loaded: new Set(),
      initialized: new Set(),
      loading: new Map()
    };
  }
  return window.__APP_CHUNK_STATE__;
}

function callChunkSetup(fnName) {
  if (typeof window[fnName] !== 'function') return;
  try {
    window[fnName]();
  } catch (err) {
    console.error('[BOOT] Chunk setup failed', fnName, err?.message || err);
  }
}

function initializeChunkOnce(chunkKey) {
  const state = getAppChunkState();
  if (state.initialized.has(chunkKey)) return;
  state.initialized.add(chunkKey);

  if (chunkKey === APP_ROUTE_CHUNK_KEYS.CARDS) {
    callChunkSetup('setupForms');
    callChunkSetup('setupScanButtons');
    callChunkSetup('setupAttachmentControls');
    callChunkSetup('setupProvisionModal');
    callChunkSetup('setupInputControlModal');
    return;
  }
  if (chunkKey === APP_ROUTE_CHUNK_KEYS.ITEMS) {
    callChunkSetup('setupItemsModal');
    callChunkSetup('setupWorkspaceModal');
    return;
  }
  if (chunkKey === APP_ROUTE_CHUNK_KEYS.APPROVALS) {
    callChunkSetup('setupApprovalRejectModal');
    callChunkSetup('setupApprovalApproveModal');
    return;
  }
  if (chunkKey === APP_ROUTE_CHUNK_KEYS.PRODUCTION) {
    callChunkSetup('setupProductionModule');
    return;
  }
  if (chunkKey === APP_ROUTE_CHUNK_KEYS.SECURITY) {
    callChunkSetup('setupSecurityControls');
  }
}

function normalizeRoutePathForChunks(routePath) {
  try {
    return new URL(routePath || '/', window.location.origin).pathname || '/';
  } catch (err) {
    return window.location.pathname || '/';
  }
}

function resolveRouteChunkKeys(routePath) {
  const cleanPath = normalizeRoutePathForChunks(routePath);
  const keys = new Set();

  if (
    cleanPath === '/' ||
    cleanPath === '/cards' ||
    cleanPath === '/cards/new' ||
    cleanPath === '/approvals' ||
    cleanPath === '/provision' ||
    cleanPath === '/input-control' ||
    cleanPath === '/archive' ||
    cleanPath === '/workorders' ||
    cleanPath === '/workspace' ||
    cleanPath.startsWith('/cards/') ||
    cleanPath.startsWith('/card-route/') ||
    cleanPath.startsWith('/archive/') ||
    cleanPath.startsWith('/workorders/') ||
    cleanPath.startsWith('/workspace/')
  ) {
    keys.add(APP_ROUTE_CHUNK_KEYS.CARDS);
  }

  if (
    cleanPath === '/items' ||
    cleanPath === '/ok' ||
    cleanPath === '/oc' ||
    cleanPath === '/receipts' ||
    cleanPath.startsWith('/receipts/') ||
    cleanPath === '/workspace' ||
    cleanPath.startsWith('/workspace/')
  ) {
    keys.add(APP_ROUTE_CHUNK_KEYS.ITEMS);
  }

  if (cleanPath === '/dashboard') {
    keys.add(APP_ROUTE_CHUNK_KEYS.DASHBOARD);
  }

  if (cleanPath === '/approvals') {
    keys.add(APP_ROUTE_CHUNK_KEYS.APPROVALS);
  }

  if (
    cleanPath === '/departments' ||
    cleanPath === '/operations' ||
    cleanPath === '/areas' ||
    cleanPath === '/employees' ||
    cleanPath === '/shift-times'
  ) {
    keys.add(APP_ROUTE_CHUNK_KEYS.DIRECTORIES);
  }

  if (cleanPath.startsWith('/production')) {
    keys.add(APP_ROUTE_CHUNK_KEYS.PRODUCTION);
  }

  if (cleanPath === '/users' || cleanPath === '/accessLevels') {
    keys.add(APP_ROUTE_CHUNK_KEYS.SECURITY);
  }

  if (cleanPath === '/profile' || cleanPath.startsWith('/profile/')) {
    keys.add(APP_ROUTE_CHUNK_KEYS.MESSENGER);
  }

  return Array.from(keys);
}

function getChunkAssetUrl(chunkKey) {
  return window.__APP_ASSET_MANIFEST__?.chunks?.[chunkKey] || '';
}

function ensureChunkLoaded(chunkKey) {
  const state = getAppChunkState();
  if (!chunkKey) return Promise.resolve();
  if (state.loaded.has(chunkKey)) {
    initializeChunkOnce(chunkKey);
    return Promise.resolve();
  }
  if (state.loading.has(chunkKey)) {
    return state.loading.get(chunkKey);
  }

  const assetUrl = getChunkAssetUrl(chunkKey);
  if (!assetUrl) {
    initializeChunkOnce(chunkKey);
    return Promise.resolve();
  }

  const pending = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = assetUrl;
    script.defer = true;
    script.onload = () => {
      state.loaded.add(chunkKey);
      initializeChunkOnce(chunkKey);
      resolve();
    };
    script.onerror = () => {
      reject(new Error('Failed to load chunk ' + chunkKey));
    };
    document.head.appendChild(script);
  });

  state.loading.set(chunkKey, pending);
  return pending.finally(() => {
    state.loading.delete(chunkKey);
  });
}

async function ensureRouteChunkLoaded(routePath, { loading = false } = {}) {
  if (loading) return;
  const chunkKeys = resolveRouteChunkKeys(routePath);
  for (const chunkKey of chunkKeys) {
    await ensureChunkLoaded(chunkKey);
  }
}

function pushRouteState(normalized, { replace = false, fromHistory = false } = {}) {
  appState = { ...appState, route: normalized };
  window.__routeRenderPath = normalized;
  if (fromHistory) return;
  const next = normalized;
  const method = replace ? 'replaceState' : 'pushState';
  try {
    history[method](appState, '', next);
  } catch (err) {
    console.warn('History update failed', err);
  }
}

function initWorkordersRoute() {
  if (typeof setupWorkorderFilters === 'function') {
    setupWorkorderFilters();
  }
  if (typeof setupScanButtons === 'function') {
    setupScanButtons();
  }
  renderWorkordersTable({ collapseAll: true });
  stopCardsLiveIfNeeded();
  setRouteCleanup(() => stopCardsLiveIfNeeded());
}

function initItemsRoute() {
  if (typeof setupItemsPage === 'function') {
    setupItemsPage();
  }
  if (typeof renderItemsPage === 'function') {
    renderItemsPage();
  }
  stopCardsLiveIfNeeded();
  setRouteCleanup(() => stopCardsLiveIfNeeded());
}

function initOkRoute() {
  initItemsRoute();
}

function initOcRoute() {
  initItemsRoute();
}

function initApprovalsRoute() {
  const run = async () => {
    stopCardsLivePolling();
    await refreshCardsDataOnEnter();
    if (typeof setupApprovalsSearch === 'function') {
      setupApprovalsSearch();
    }
    if (typeof setupScanButtons === 'function') {
      setupScanButtons();
    }
    renderApprovalsTable();
    startCardsLiveIfNeeded('approvals');
    setRouteCleanup(() => stopCardsLiveIfNeeded());
  };
  run();
}

function initProvisionRoute() {
  const run = async () => {
    stopCardsLivePolling();
    await refreshCardsDataOnEnter();
    if (typeof setupProvisionSearch === 'function') {
      setupProvisionSearch();
    }
    if (typeof setupScanButtons === 'function') {
      setupScanButtons();
    }
    renderProvisionTable();
    startCardsLiveIfNeeded('provision');
    setRouteCleanup(() => stopCardsLiveIfNeeded());
  };
  run();
}

function initInputControlRoute() {
  const run = async () => {
    stopCardsLivePolling();
    await refreshCardsDataOnEnter();
    if (typeof setupInputControlSearch === 'function') {
      setupInputControlSearch();
    }
    if (typeof setupScanButtons === 'function') {
      setupScanButtons();
    }
    renderInputControlTable();
    startCardsLiveIfNeeded('input-control');
    setRouteCleanup(() => stopCardsLiveIfNeeded());
  };
  run();
}

function initDepartmentsRoute() {
  renderDepartmentsPage();
  stopCardsLiveIfNeeded();
  setRouteCleanup(() => stopCardsLiveIfNeeded());
}

function initOperationsRoute() {
  renderOperationsPage();
  stopCardsLiveIfNeeded();
  setRouteCleanup(() => stopCardsLiveIfNeeded());
}

function initAreasRoute() {
  renderAreasPage();
  stopCardsLiveIfNeeded();
  setRouteCleanup(() => stopCardsLiveIfNeeded());
}

function initEmployeesRoute() {
  renderEmployeesPage();
  stopCardsLiveIfNeeded();
  setRouteCleanup(() => stopCardsLiveIfNeeded());
}

function initShiftTimesRoute() {
  renderProductionShiftTimesPage();
  stopCardsLiveIfNeeded();
  setRouteCleanup(() => stopCardsLiveIfNeeded());
}

function initArchiveRoute() {
  if (typeof setupArchiveSearch === 'function') {
    setupArchiveSearch();
  }
  if (typeof setupScanButtons === 'function') {
    setupScanButtons();
  }
  renderArchiveTable();
  stopCardsLiveIfNeeded();
  setRouteCleanup(() => stopCardsLiveIfNeeded());
}

function initReceiptsRoute() {
  if (typeof renderReceiptsTable === 'function') {
    renderReceiptsTable();
  }
  stopCardsLiveIfNeeded();
  setRouteCleanup(() => stopCardsLiveIfNeeded());
}

function initWorkspaceRoute() {
  if (typeof setupWorkspaceSearch === 'function') {
    setupWorkspaceSearch();
  }
  if (typeof setupScanButtons === 'function') {
    setupScanButtons();
  }
  renderWorkspaceView();
  focusWorkspaceSearch();
  stopCardsLiveIfNeeded();
  setRouteCleanup(() => stopCardsLiveIfNeeded());
}

function initDashboardRoute() {
  const run = async () => {
    dashboardStatusSnapshot = null;
    dashboardEligibleCache = [];
    stopCardsLivePolling();
    await refreshCardsDataOnEnter();
    renderDashboard();
    if (window.dashboardPager && typeof window.dashboardPager.updatePages === 'function') {
      requestAnimationFrame(() => window.dashboardPager.updatePages());
    }
    startCardsLiveIfNeeded('dashboard');
    setRouteCleanup(() => stopCardsLiveIfNeeded());
  };
  run();
}

function initCardsRoute() {
  const run = async () => {
    stopCardsLivePolling();
    await refreshCardsDataOnEnter();
    if (typeof setupCardsSearch === 'function') {
      setupCardsSearch();
    }
    if (typeof setupScanButtons === 'function') {
      setupScanButtons();
    }
    if (typeof renderCardsTable === 'function') {
      renderCardsTable();
    } else if (typeof renderCardsList === 'function') {
      renderCardsList();
    }
    startCardsLiveIfNeeded('cards');
    setRouteCleanup(() => stopCardsLiveIfNeeded());
  };
  run();
}

function initProductionScheduleRoute({ fromHistory = false, soft = false } = {}) {
  const shouldRender = (!fromHistory) || soft;
  if (shouldRender) {
    renderProductionSchedule();
  }
  startProductionLiveIfNeeded();
  setRouteCleanup(() => stopProductionLiveIfNeeded());
}

function initProductionShiftsRoute({ fromHistory = false, soft = false } = {}) {
  const shouldRender = (!fromHistory) || soft;
  if (shouldRender) {
    renderProductionShiftBoardPage();
  }
  startProductionLiveIfNeeded();
  setRouteCleanup(() => stopProductionLiveIfNeeded());
}

function initProductionPlanRoute({ fromHistory = false, soft = false } = {}) {
  if (typeof hydrateProductionPlanViewSettings === 'function') {
    hydrateProductionPlanViewSettings();
  }
  if (typeof getProductionPlanTodayStart === 'function') {
    productionShiftsState.weekStart = productionShiftsState.weekStart || getProductionPlanTodayStart();
    productionShiftsState.planWindowStartSlot = productionShiftsState.planWindowStartSlot || (
      typeof getProductionPlanTodaySlot === 'function'
        ? getProductionPlanTodaySlot()
        : null
    );
  }
  const shouldRender = (!fromHistory) || soft;
  if (shouldRender) {
    renderProductionPlanPage();
  }
  startProductionLiveIfNeeded();
  setRouteCleanup(() => stopProductionLiveIfNeeded());
}

function initProductionGanttRoute({ fromHistory = false, soft = false, routePath = '' } = {}) {
  try {
    console.log('[ROUTE] production-gantt enter', {
      fromHistory: !!fromHistory,
      soft: !!soft,
      routePath: routePath || (window.location.pathname || '')
    });
  } catch (e) {}
  const shouldRender = (!fromHistory) || soft;
  if (shouldRender && typeof renderProductionGanttPage === 'function') {
    renderProductionGanttPage(routePath || (window.location.pathname || ''));
  }
  startProductionLiveIfNeeded();
  setRouteCleanup(() => stopProductionLiveIfNeeded());
}

function initProductionShiftCloseRoute({ fromHistory = false, soft = false, routePath = '' } = {}) {
  try {
    console.log('[ROUTE] initProductionShiftCloseRoute', {
      fromHistory: !!fromHistory,
      soft: !!soft,
      routePath: routePath || (window.location.pathname || '')
    });
  } catch (e) {}
  const shouldRender = (!fromHistory) || soft;
  if (shouldRender && typeof renderProductionShiftClosePage === 'function') {
    renderProductionShiftClosePage(routePath || (window.location.pathname || ''));
  }
  startProductionLiveIfNeeded();
  setRouteCleanup(() => stopProductionLiveIfNeeded());
}

function initProductionDelayedRoute() {
  if (typeof renderProductionDelayedPage === 'function') {
    renderProductionDelayedPage();
  }
  startProductionLiveIfNeeded();
  setRouteCleanup(() => stopProductionLiveIfNeeded());
}

function initProductionDefectsRoute() {
  if (typeof renderProductionDefectsPage === 'function') {
    renderProductionDefectsPage();
  }
  startProductionLiveIfNeeded();
  setRouteCleanup(() => stopProductionLiveIfNeeded());
}

function initUsersRoute() {
  stopCardsLiveIfNeeded();
  const listView = document.getElementById('users-list-view');
  if (listView) listView.classList.remove('hidden');
  if (typeof renderUsersTable === 'function') renderUsersTable();
  setRouteCleanup(() => stopCardsLiveIfNeeded());
}

function initAccessLevelsRoute() {
  if (typeof setupSecurityControls === 'function') setupSecurityControls();
  renderAccessLevelsTable();
  stopCardsLiveIfNeeded();
  setRouteCleanup(() => stopCardsLiveIfNeeded());
}

function initCardsNewRoute({ fromHistory = false } = {}) {
  let mountEl = document.getElementById('page-cards-new');
  if (!mountEl) {
    mountTemplate('tpl-page-cards-new');
    window.__currentPageId = 'page-cards-new';
    mountEl = document.getElementById('page-cards-new');
  }
  document.body.classList.add('page-card-mode');
  resetPageContainer(mountEl);
  openCardModal(null, {
    cardType: 'MKI',
    renderMode: 'page',
    mountEl,
    fromRestore: fromHistory
  });
  stopCardsLiveIfNeeded();
  setRouteCleanup(() => {
    document.body.classList.remove('page-card-mode');
    stopCardsLiveIfNeeded();
  });
}

function initCardsByIdRoute(card, { fromHistory = false } = {}) {
  let mountEl = document.getElementById('page-cards-new');
  if (!mountEl) {
    mountTemplate('tpl-page-cards-new');
    window.__currentPageId = 'page-cards-new';
    mountEl = document.getElementById('page-cards-new');
  }
  document.body.classList.add('page-card-mode');
  resetPageContainer(mountEl);
  openCardModal(card.id, {
    cardType: 'MKI',
    renderMode: 'page',
    mountEl,
    fromRestore: fromHistory
  });
  stopCardsLiveIfNeeded();
  setRouteCleanup(() => {
    document.body.classList.remove('page-card-mode');
    stopCardsLiveIfNeeded();
  });
}

function initWorkorderCardRoute(card) {
  document.body.classList.add('page-wo-mode');
  const mountEl = document.getElementById('page-workorders-card');
  resetPageContainer(mountEl);
  renderWorkorderCardPage(card, mountEl);
  stopCardsLiveIfNeeded();
  setRouteCleanup(() => {
    document.body.classList.remove('page-wo-mode');
    stopCardsLiveIfNeeded();
  });
}

function initWorkspaceCardRoute(card) {
  const run = async () => {
    document.body.classList.add('page-wo-mode');
    const mountEl = document.getElementById('page-workorders-card');
    resetPageContainer(mountEl);
    await loadData();
    const refreshed = cards.find(c => c && (c.id === card.id || normalizeQrId(c.qrId || '') === normalizeQrId(card.qrId || '')));
    if (!refreshed) {
      showToast?.('Маршрутная карта не найдена') || alert('Маршрутная карта не найдена');
      navigateToRoute('/workspace');
      return;
    }
    if (typeof renderWorkspaceCardPage === 'function') {
      renderWorkspaceCardPage(refreshed, mountEl);
    }
    stopCardsLiveIfNeeded();
    setRouteCleanup(() => {
      document.body.classList.remove('page-wo-mode');
      stopCardsLiveIfNeeded();
    });
  };
  run();
}

function initArchiveCardRoute(card) {
  document.body.classList.add('page-wo-mode');
  const mountEl = document.getElementById('page-archive-card');
  resetPageContainer(mountEl);
  renderArchiveCardPage(card, mountEl);
  stopCardsLiveIfNeeded();
  setRouteCleanup(() => {
    document.body.classList.remove('page-wo-mode');
    stopCardsLiveIfNeeded();
  });
}

function initCardLogRoute(card) {
  const mountEl = document.getElementById('page-card-log');
  if (!mountEl || !card) return;
  if (!mountEl.dataset.defaultContent) {
    mountEl.dataset.defaultContent = mountEl.innerHTML;
  } else {
    mountEl.innerHTML = mountEl.dataset.defaultContent;
  }
  if (typeof renderCardLogPage === 'function') {
    renderCardLogPage(card, mountEl);
  }
  stopCardsLiveIfNeeded();
  setRouteCleanup(() => {
    logContextCardId = null;
    stopCardsLiveIfNeeded();
  });
}

function initUserProfileRoute(userId) {
  const mountEl = document.getElementById('page-user-profile');
  const profileView = document.getElementById('user-profile-view');
  if (!mountEl || !profileView) return;
  if (!profileView.dataset.defaultContent) {
    profileView.dataset.defaultContent = profileView.innerHTML;
  } else {
    profileView.innerHTML = profileView.dataset.defaultContent;
  }
  const normalizedProfileId = normalizeUserId(userId || '');
  const currentUserId = normalizeUserId(currentUser && currentUser.id);
  const isOwnProfile = normalizedProfileId && currentUserId && normalizedProfileId === currentUserId;
  const renderForbidden = () => {
    profileView.innerHTML = `
      <div class="card">
        <h3>Доступ запрещён</h3>
        <p>Индивидуальная страница доступна только владельцу.</p>
      </div>
    `;
  };

  if (!isOwnProfile) {
    renderForbidden();
    stopCardsLiveIfNeeded();
    setRouteCleanup(() => stopCardsLiveIfNeeded());
    return;
  }

  const titleEl = document.getElementById('user-profile-title');
  const metaEl = document.getElementById('user-profile-meta');
  const placeholderEl = document.getElementById('user-profile-placeholder');
  const chatCardEl = document.getElementById('chat-card');
  const profileChildren = profileView ? Array.from(profileView.children) : [];
  const showProfileContent = () => {
    if (profileView) profileView.classList.remove('hidden');
    profileChildren.forEach(child => child.classList.remove('hidden'));
  };

  showProfileContent();
  const profileUser = currentUser;
  if (placeholderEl && !placeholderEl.dataset.defaultText) {
    placeholderEl.dataset.defaultText = placeholderEl.innerHTML;
  }
  if (!profileUser) {
    if (titleEl) titleEl.textContent = 'Пользователь не найден';
    if (metaEl) metaEl.innerHTML = '';
    if (placeholderEl) placeholderEl.innerHTML = '<p>Пользователь не найден.</p>';
    if (chatCardEl) chatCardEl.classList.add('hidden');
    stopCardsLiveIfNeeded();
    setRouteCleanup(() => stopCardsLiveIfNeeded());
    return;
  }
  if (placeholderEl && placeholderEl.dataset.defaultText) {
    placeholderEl.innerHTML = placeholderEl.dataset.defaultText;
  }
  if (chatCardEl) chatCardEl.classList.remove('hidden');
  if (titleEl) {
    const name = profileUser?.name || 'Пользователь';
    titleEl.textContent = `Профиль: ${name}`;
  }
  if (metaEl) {
    metaEl.innerHTML = '';
  }
  if (typeof initMessengerUiOnce === 'function') initMessengerUiOnce();
  if (typeof refreshChatUsers === 'function') refreshChatUsers();
  if (typeof refreshUserActionsLog === 'function') refreshUserActionsLog();
  if (typeof bindWebPushProfileUi === 'function') bindWebPushProfileUi();
  stopCardsLiveIfNeeded();
  setRouteCleanup(() => {
    if (typeof resetChatView === 'function') resetChatView();
    stopCardsLiveIfNeeded();
  });
}

const ROUTE_TABLE = [
  { path: '/', tpl: 'tpl-cards', tab: 'cards', permission: 'cards', pageId: 'page-cards', init: () => initCardsRoute() },
  { path: '/cards', tpl: 'tpl-cards', tab: 'cards', permission: 'cards', pageId: 'page-cards', init: () => initCardsRoute() },
  { path: '/dashboard', tpl: 'tpl-dashboard', tab: 'dashboard', permission: 'dashboard', pageId: 'page-dashboard', init: () => initDashboardRoute() },
  { path: '/approvals', tpl: 'tpl-approvals', tab: 'cards', permission: 'approvals', pageId: 'page-approvals', init: () => initApprovalsRoute() },
  { path: '/provision', tpl: 'tpl-provision', tab: 'cards', permission: 'provision', pageId: 'page-provision', init: () => initProvisionRoute() },
  { path: '/input-control', tpl: 'tpl-input-control', tab: 'cards', permission: 'input-control', pageId: 'page-input-control', init: () => initInputControlRoute() },
  { path: '/departments', tpl: 'tpl-departments', tab: 'directories', permission: 'departments', pageId: 'page-departments', init: () => initDepartmentsRoute() },
  { path: '/operations', tpl: 'tpl-operations', tab: 'directories', permission: 'operations', pageId: 'page-operations', init: () => initOperationsRoute() },
  { path: '/areas', tpl: 'tpl-areas', tab: 'directories', permission: 'areas', pageId: 'page-areas', init: () => initAreasRoute() },
  { path: '/employees', tpl: 'tpl-employees', tab: 'directories', permission: 'employees', pageId: 'page-employees', init: () => initEmployeesRoute() },
  { path: '/shift-times', tpl: 'tpl-shift-times', tab: 'directories', permission: 'shift-times', pageId: 'page-shift-times', init: () => initShiftTimesRoute() },
  { path: '/production/schedule', tpl: 'tpl-production-schedule', tab: 'production', permission: 'production', pageId: 'page-production-schedule', init: () => initProductionScheduleRoute() },
  { path: '/production/shifts', tpl: 'tpl-production-shifts', tab: 'production', permission: 'production', pageId: 'page-production-shifts', init: () => initProductionShiftsRoute() },
  { path: '/production/delayed', tpl: 'tpl-production-delayed', tab: 'production', permission: 'production', pageId: 'page-production-delayed', init: () => initProductionDelayedRoute() },
  { path: '/production/defects', tpl: 'tpl-production-defects', tab: 'production', permission: 'production', pageId: 'page-production-defects', init: () => initProductionDefectsRoute() },
  { path: '/production/plan', tpl: 'tpl-production-shifts', tab: 'production', permission: 'production', pageId: 'page-production-plan', init: () => initProductionPlanRoute() },
  { path: '/workorders', tpl: 'tpl-workorders', tab: 'workorders', permission: 'workorders', pageId: 'page-workorders', init: () => initWorkordersRoute() },
  { path: '/items', tpl: 'tpl-items', tab: 'items', permission: 'items', pageId: 'page-items', init: () => initItemsRoute() },
  { path: '/ok', tpl: 'tpl-items', tab: 'ok', permission: 'ok', pageId: 'page-ok', init: () => initOkRoute() },
  { path: '/oc', tpl: 'tpl-items', tab: 'oc', permission: 'oc', pageId: 'page-oc', init: () => initOcRoute() },
  { path: '/archive', tpl: 'tpl-archive', tab: 'archive', permission: 'archive', pageId: 'page-archive', init: () => initArchiveRoute() },
  { path: '/receipts', tpl: 'tpl-receipts', tab: 'receipts', permission: 'receipts', pageId: 'page-receipts', init: () => initReceiptsRoute() },
  { path: '/workspace', tpl: 'tpl-workspace', tab: 'workspace', permission: 'workspace', pageId: 'page-workspace', init: () => initWorkspaceRoute() },
  { path: '/users', tpl: 'tpl-users', tab: 'users', permission: 'users', pageId: 'page-users', init: () => initUsersRoute() },
  { path: '/accessLevels', tpl: 'tpl-accessLevels', tab: 'accessLevels', permission: 'accessLevels', pageId: 'page-accessLevels', init: () => initAccessLevelsRoute() },
  { path: '/cards/new', tpl: 'tpl-page-cards-new', tab: 'cards', permission: 'cards', pageId: 'page-cards-new', init: () => initCardsNewRoute() }
];

function renderErrorPage(message) {
  mountTemplate('tpl-page-user-profile');
  const profileView = document.getElementById('user-profile-view');
  if (profileView) {
    profileView.innerHTML = `
      <div class="card">
        <h3>Ошибка</h3>
        <p>${escapeHtml(message || 'Ошибка')}</p>
      </div>
    `;
  }
  window.__currentPageId = 'page-user-profile';
  if (typeof setNavActiveByRoute === 'function') setNavActiveByRoute('/profile');
}

function handleRoute(path, options = {}) {
  const pending = handleRouteInternal(path, options);
  if (pending && typeof pending.catch === 'function') {
    return pending.catch((err) => {
      console.error('[ROUTE] handleRoute failed', err?.message || err);
    });
  }
  return pending;
}

async function handleRouteInternal(path, { replace = false, fromHistory = false, loading = false, soft = false } = {}) {
  const isLoading = !!loading;
  const isSoft = !!soft;
  try {
    console.log('[ROUTE]', {
      path,
      replace,
      fromHistory,
      loading: isLoading,
      soft: isSoft,
      currentUser: currentUser ? (currentUser.id || currentUser.login || currentUser.name) : null,
      appMainChildren: (getAppMain() && getAppMain().children) ? getAppMain().children.length : 0,
      location: window.location.pathname + window.location.search
    });
  } catch (e) {}
// === FIX: prevent double mount during bootstrap (loading:true) ===
if (isLoading) {
  const clean = (() => {
    try {
      return new URL(path || '/', location.origin).pathname;
    } catch (e) {
      return location.pathname;
    }
  })();

  if (window.__bootstrappedOncePath === clean) {
    return;
  }
  window.__bootstrappedOncePath = clean;
}

  let urlObj;
  try {
    urlObj = new URL(path || '/', window.location.origin);
  } catch (err) {
    urlObj = new URL('/', window.location.origin);
  }

  await ensureRouteChunkLoaded(path || '/', { loading: isLoading });

  let currentPath = urlObj.pathname || '/';
  const search = urlObj.search || '';
  let normalized = (currentPath || '/') + search;
  let cleanPath = currentPath.split('?')[0].split('#')[0];

  window.__isCardRoutePage = cleanPath.startsWith('/card-route/');

  if (cleanPath === '/cards-mki/new') {
    const aliasPath = '/cards/new';
    if (!isLoading) {
      history.replaceState({}, '', aliasPath + search);
      normalized = aliasPath + search;
    }
    currentPath = aliasPath;
    cleanPath = aliasPath;
  }

  if (currentPath === '/cards/new' && !isLoading) {
    const cardIdParam = urlObj.searchParams.get('cardId');
    const trimmedCardId = (cardIdParam || '').toString().trim();
    if (trimmedCardId) {
      const next = `/cards/${encodeURIComponent(trimmedCardId)}`;
      history.replaceState({}, '', next);
      handleRoute(next, { replace: true, fromHistory: false });
      return;
    }
  }

  closeAllModals(true);
  document.body.classList.remove('page-card-mode', 'page-directory-mode', 'page-wo-mode');

  const pushState = () => {
    pushRouteState(normalized, { replace, fromHistory });
  };

  if (cleanPath === '/profile' || cleanPath === '/profile/') {
    if (!currentUser?.id) {
      renderErrorPage('Пользователь не определён');
      pushState();
      return;
    }
    const targetPath = '/profile/' + currentUser.id;
    pushRouteState(targetPath, { replace: true, fromHistory: false });
    handleRoute(targetPath, { replace: true, fromHistory: false });
    return;
  }

  if (cleanPath.startsWith('/profile/')) {
    if (isLoading) {
      mountTemplate('tpl-page-user-profile');
      window.__currentPageId = 'page-user-profile';
      if (typeof setNavActiveByRoute === 'function') setNavActiveByRoute(cleanPath);
      pushState();
      return;
    }
    const rawId = (cleanPath.split('/')[2] || '').trim();
    let requestedId = rawId;
    try {
      requestedId = decodeURIComponent(rawId);
    } catch (err) {
      requestedId = rawId;
    }
    const myId = currentUser?.id;
    mountTemplate('tpl-page-user-profile');
    window.__currentPageId = 'page-user-profile';
    if (typeof setNavActiveByRoute === 'function') setNavActiveByRoute(cleanPath);
    pushState();
    if (!myId || requestedId !== myId) {
      const profileView = document.querySelector('#user-profile-view');
      if (profileView) {
        profileView.innerHTML = `
          <div class="card">
            <h3>Доступ запрещён</h3>
            <p>Индивидуальная страница доступна только владельцу.</p>
          </div>
        `;
      }
      return;
    }
    initUserProfileRoute(myId);
    return;
  }

  if (cleanPath.startsWith('/workorders/')) {
    if (isLoading) {
      mountTemplate('tpl-page-workorders-card');
      appState = { ...appState, tab: 'workorders' };
      window.__currentPageId = 'page-workorders-card';
      if (typeof setNavActiveByRoute === 'function') setNavActiveByRoute(cleanPath);
      pushState();
      return;
    }
    if (!canViewTab('workorders')) {
      alert('Нет прав доступа к разделу');
      const fallback = getDefaultTab();
      handleRoute('/' + fallback, { replace: true, fromHistory });
      return;
    }
    const qrParam = (cleanPath.split('/')[2] || '').trim();
    const qr = normalizeQrId(qrParam);
    if (!qr || !isValidScanId(qr)) {
      showToast?.('Некорректный QR') || alert('Некорректный QR');
      handleRoute('/workorders', { replace: true, fromHistory });
      return;
    }
    const card = cards.find(c => normalizeQrId(c.qrId) === qr && !c.archived);
    if (!card) {
      showToast?.('Маршрутная карта не найдена') || alert('Маршрутная карта не найдена');
      handleRoute('/workorders', { replace: true, fromHistory });
      return;
    }
    mountTemplate('tpl-page-workorders-card');
    initWorkorderCardRoute(card);
    appState = { ...appState, tab: 'workorders' };
    window.__currentPageId = 'page-workorders-card';
    if (typeof setNavActiveByRoute === 'function') setNavActiveByRoute(cleanPath);
    pushState();
    return;
  }

  if (cleanPath.startsWith('/workspace/')) {
    if (isLoading) {
      mountTemplate('tpl-page-workorders-card');
      appState = { ...appState, tab: 'workspace' };
      window.__currentPageId = 'page-workorders-card';
      if (typeof setNavActiveByRoute === 'function') setNavActiveByRoute(cleanPath);
      pushState();
      return;
    }
    if (!canViewTab('workspace')) {
      alert('Нет прав доступа к разделу');
      const fallback = getDefaultTab();
      handleRoute('/' + fallback, { replace: true, fromHistory });
      return;
    }
    const qrParam = (cleanPath.split('/')[2] || '').trim();
    const qr = normalizeQrId(qrParam);
    if (!qr || !isValidScanId(qr)) {
      showToast?.('Некорректный QR') || alert('Некорректный QR');
      handleRoute('/workspace', { replace: true, fromHistory });
      return;
    }
    const card = cards.find(c =>
      c &&
      !c.archived &&
      c.cardType === 'MKI' &&
      isCardProductionEligible(c) &&
      (c.operations && c.operations.length) &&
      normalizeQrId(c.qrId) === qr
    );
    if (!card) {
      showToast?.('Маршрутная карта не найдена') || alert('Маршрутная карта не найдена');
      handleRoute('/workspace', { replace: true, fromHistory });
      return;
    }
    mountTemplate('tpl-page-workorders-card');
    initWorkspaceCardRoute(card);
    appState = { ...appState, tab: 'workspace' };
    window.__currentPageId = 'page-workorders-card';
    if (typeof setNavActiveByRoute === 'function') setNavActiveByRoute(cleanPath);
    pushState();
    return;
  }

  if (cleanPath.startsWith('/production/defects/')) {
    if (isLoading) {
      mountTemplate('tpl-page-workorders-card');
      appState = { ...appState, tab: 'production' };
      window.__currentPageId = 'page-workorders-card';
      if (typeof setNavActiveByRoute === 'function') setNavActiveByRoute(cleanPath);
      pushState();
      return;
    }
    if (!canViewTab('production')) {
      alert('Нет прав доступа к разделу');
      const fallback = getDefaultTab();
      handleRoute('/' + fallback, { replace: true, fromHistory });
      return;
    }
    const qrParam = (cleanPath.split('/')[3] || '').trim();
    const qr = normalizeQrId(qrParam);
    if (!qr || !isValidScanId(qr)) {
      showToast?.('Некорректный QR') || alert('Некорректный QR');
      handleRoute('/production/defects', { replace: true, fromHistory });
      return;
    }
    const card = cards.find(c => normalizeQrId(c.qrId) === qr && !c.archived);
    if (!card) {
      showToast?.('Маршрутная карта не найдена') || alert('Маршрутная карта не найдена');
      handleRoute('/production/defects', { replace: true, fromHistory });
      return;
    }
    mountTemplate('tpl-page-workorders-card');
    if (typeof renderProductionIssueCardPage === 'function') {
      renderProductionIssueCardPage(card, {
        status: 'DEFECT',
        listRoute: '/production/defects',
        title: 'Брак',
        emptyTitle: 'Брак не зафиксирован'
      });
    }
    appState = { ...appState, tab: 'production' };
    window.__currentPageId = 'page-workorders-card';
    if (typeof setNavActiveByRoute === 'function') setNavActiveByRoute(cleanPath);
    pushState();
    return;
  }

  if (cleanPath.startsWith('/production/gantt/')) {
    if (isLoading) {
      mountTemplate('tpl-production-shifts');
      appState = { ...appState, tab: 'production' };
      window.__currentPageId = 'page-production-gantt';
      if (typeof setNavActiveByRoute === 'function') setNavActiveByRoute(cleanPath);
      pushState();
      return;
    }
    if (!canViewTab('production')) {
      alert('Нет прав доступа к разделу');
      const fallback = getDefaultTab();
      handleRoute('/' + fallback, { replace: true, fromHistory });
      return;
    }
    const ganttRef = typeof findProductionGanttCard === 'function'
      ? findProductionGanttCard(cleanPath)
      : null;
    if (!ganttRef?.card) {
      showToast?.('Маршрутная карта не найдена') || alert('Маршрутная карта не найдена');
      handleRoute('/production/plan', { replace: true, fromHistory });
      return;
    }
    if (ganttRef.canonicalPath && ganttRef.canonicalPath !== cleanPath) {
      handleRoute(ganttRef.canonicalPath, { replace: true, fromHistory, soft: true });
      return;
    }
    mountTemplate('tpl-production-shifts');
    appState = { ...appState, tab: 'production' };
    window.__currentPageId = 'page-production-gantt';
    if (typeof setNavActiveByRoute === 'function') setNavActiveByRoute(cleanPath);
    initProductionGanttRoute({ fromHistory, soft: isSoft, routePath: cleanPath });
    pushState();
    return;
  }

  if (/^\/production\/shifts\/\d{8}s\d+\/?$/.test(cleanPath)) {
    if (isLoading) {
      mountTemplate('tpl-production-shift-close');
      appState = { ...appState, tab: 'production' };
      window.__currentPageId = 'page-production-shift-close';
      if (typeof setNavActiveByRoute === 'function') setNavActiveByRoute(cleanPath);
      pushState();
      return;
    }
    if (!canViewTab('production')) {
      alert('Нет прав доступа к разделу');
      const fallback = getDefaultTab();
      handleRoute('/' + fallback, { replace: true, fromHistory });
      return;
    }
    mountTemplate('tpl-production-shift-close');
    appState = { ...appState, tab: 'production' };
    window.__currentPageId = 'page-production-shift-close';
    if (typeof setNavActiveByRoute === 'function') setNavActiveByRoute(cleanPath);
    initProductionShiftCloseRoute({ fromHistory, soft: isSoft, routePath: cleanPath });
    pushState();
    return;
  }

  if (cleanPath.startsWith('/production/delayed/')) {
    if (isLoading) {
      mountTemplate('tpl-page-workorders-card');
      appState = { ...appState, tab: 'production' };
      window.__currentPageId = 'page-workorders-card';
      if (typeof setNavActiveByRoute === 'function') setNavActiveByRoute(cleanPath);
      pushState();
      return;
    }
    if (!canViewTab('production')) {
      alert('Нет прав доступа к разделу');
      const fallback = getDefaultTab();
      handleRoute('/' + fallback, { replace: true, fromHistory });
      return;
    }
    const qrParam = (cleanPath.split('/')[3] || '').trim();
    const qr = normalizeQrId(qrParam);
    if (!qr || !isValidScanId(qr)) {
      showToast?.('Некорректный QR') || alert('Некорректный QR');
      handleRoute('/production/delayed', { replace: true, fromHistory });
      return;
    }
    const card = cards.find(c => normalizeQrId(c.qrId) === qr && !c.archived);
    if (!card) {
      showToast?.('Маршрутная карта не найдена') || alert('Маршрутная карта не найдена');
      handleRoute('/production/delayed', { replace: true, fromHistory });
      return;
    }
    mountTemplate('tpl-page-workorders-card');
    if (typeof renderProductionIssueCardPage === 'function') {
      renderProductionIssueCardPage(card, {
        status: 'DELAYED',
        listRoute: '/production/delayed',
        title: 'Задержано',
        emptyTitle: 'В МК отсутствуют Задержанные изделия'
      });
    }
    appState = { ...appState, tab: 'production' };
    window.__currentPageId = 'page-workorders-card';
    if (typeof setNavActiveByRoute === 'function') setNavActiveByRoute(cleanPath);
    pushState();
    return;
  }

  if (cleanPath.startsWith('/archive/')) {
    if (isLoading) {
      mountTemplate('tpl-page-archive-card');
      appState = { ...appState, tab: 'archive' };
      window.__currentPageId = 'page-archive-card';
      if (typeof setNavActiveByRoute === 'function') setNavActiveByRoute(cleanPath);
      pushState();
      return;
    }
    if (!canViewTab('archive')) {
      alert('Нет прав доступа к разделу');
      const fallback = getDefaultTab();
      handleRoute('/' + fallback, { replace: true, fromHistory });
      return;
    }
    const qrParam = (cleanPath.split('/')[2] || '').trim();
    const qr = normalizeQrId(qrParam);
    if (!qr || !isValidScanId(qr)) {
      showToast?.('Некорректный QR') || alert('Некорректный QR');
      handleRoute('/archive', { replace: true, fromHistory });
      return;
    }
    const card = cards.find(c => normalizeQrId(c.qrId) === qr && !!c.archived);
    if (!card) {
      showToast?.('Карта в архиве не найдена') || alert('Карта в архиве не найдена');
      handleRoute('/archive', { replace: true, fromHistory });
      return;
    }
    mountTemplate('tpl-page-archive-card');
    initArchiveCardRoute(card);
    appState = { ...appState, tab: 'archive' };
    window.__currentPageId = 'page-archive-card';
    if (typeof setNavActiveByRoute === 'function') setNavActiveByRoute(cleanPath);
    pushState();
    return;
  }

  if (/^\/card-route\/[^/]+\/log\/?$/.test(cleanPath)) {
    if (isLoading) {
      mountTemplate('tpl-page-card-log');
      appState = { ...appState, tab: 'cards' };
      window.__currentPageId = 'page-card-log';
      if (typeof setNavActiveByRoute === 'function') setNavActiveByRoute(cleanPath);
      pushState();
      return;
    }
    if (!canViewTab('cards')) {
      alert('Нет прав доступа к разделу');
      const fallback = getDefaultTab();
      handleRoute('/' + fallback, { replace: true, fromHistory });
      return;
    }
    const keyRaw = (cleanPath.split('/')[2] || '').trim();
    const card = typeof findCardForLogRoute === 'function' ? findCardForLogRoute(keyRaw) : null;
    if (!card) {
      showToast?.('Маршрутная карта не найдена.') || alert('Маршрутная карта не найдена.');
      handleRoute('/cards', { replace: true, fromHistory });
      return;
    }
    const canonicalPath = typeof getCardLogPath === 'function' ? getCardLogPath(card) : '';
    if (canonicalPath && cleanPath !== canonicalPath) {
      history.replaceState({}, '', canonicalPath);
      currentPath = canonicalPath;
      normalized = canonicalPath;
      cleanPath = canonicalPath;
    }

    mountTemplate('tpl-page-card-log');
    initCardLogRoute(card);
    appState = { ...appState, tab: 'cards' };
    window.__currentPageId = 'page-card-log';
    if (typeof setNavActiveByRoute === 'function') setNavActiveByRoute(cleanPath);
    pushState();
    return;
  }

  if (cleanPath.startsWith('/card-route/')) {
    if (isLoading) {
      mountTemplate('tpl-page-cards-new');
      appState = { ...appState, tab: 'cards' };
      window.__currentPageId = 'page-cards-new';
      if (typeof setNavActiveByRoute === 'function') setNavActiveByRoute(cleanPath);
      pushState();
      return;
    }
    if (!canViewTab('cards')) {
      alert('Нет прав доступа к разделу');
      const fallback = getDefaultTab();
      handleRoute('/' + fallback, { replace: true, fromHistory });
      return;
    }
    const keyRaw = (cleanPath.split('/')[2] || '').trim();
    const key = keyRaw.toString().trim();
    const normalizedKey = normalizeQrId(key);
    let card = normalizedKey
      ? cards.find(c => normalizeQrId(c.qrId || c.barcode || '') === normalizedKey)
      : null;
    if (!card) {
      card = cards.find(c => c.id === key);
    }
    if (!card) {
      showToast?.('Маршрутная карта не найдена.') || alert('Маршрутная карта не найдена.');
      handleRoute('/cards', { replace: true, fromHistory });
      return;
    }
    const qr = normalizeQrId(card.qrId || '');
    if (isValidScanId(qr)) {
      const canonicalPath = `/card-route/${encodeURIComponent(qr)}`;
      if (cleanPath !== canonicalPath) {
        history.replaceState({}, '', canonicalPath);
        currentPath = canonicalPath;
        normalized = canonicalPath;
        cleanPath = canonicalPath;
      }
    }

    mountTemplate('tpl-page-cards-new');
    initCardsByIdRoute(card, { fromHistory });
    appState = { ...appState, tab: 'cards' };
    window.__currentPageId = 'page-cards-new';
    if (typeof setNavActiveByRoute === 'function') setNavActiveByRoute(cleanPath);
    pushState();
    return;
  }

  if (cleanPath.startsWith('/receipts/')) {
    if (isLoading) {
      mountTemplate('tpl-receipts');
      appState = { ...appState, tab: 'receipts' };
      window.__currentPageId = 'page-receipts';
      if (typeof setNavActiveByRoute === 'function') setNavActiveByRoute(cleanPath);
      pushState();
      return;
    }
    if (!canViewTab('receipts')) {
      alert('Нет прав доступа к разделу');
      const fallback = getDefaultTab();
      handleRoute('/' + fallback, { replace: true, fromHistory });
      return;
    }
    const receiptId = (cleanPath.split('/')[2] || '').trim();
    const receipt = store.receipts.find(r => r.id === receiptId);
    if (!receipt) {
      showToast?.('Приемка не найдена') || alert('Приемка не найдена');
      handleRoute('/receipts', { replace: true, fromHistory });
      return;
    }
    mountTemplate('tpl-receipts');
    initReceiptsRoute();
    appState = { ...appState, tab: 'receipts' };
    window.__currentPageId = 'page-receipts';
    if (typeof setNavActiveByRoute === 'function') setNavActiveByRoute(cleanPath);
    showModalReceipt(receipt.id);
    pushState();
    return;
  }

  if (cleanPath.startsWith('/cards/') && cleanPath !== '/cards/new') {
    if (isLoading) {
      mountTemplate('tpl-page-cards-new');
      appState = { ...appState, tab: 'cards' };
      window.__currentPageId = 'page-cards-new';
      if (typeof setNavActiveByRoute === 'function') setNavActiveByRoute(cleanPath);
      pushState();
      return;
    }
    if (!canViewTab('cards')) {
      alert('Нет прав доступа к разделу');
      const fallback = getDefaultTab();
      handleRoute('/' + fallback, { replace: true, fromHistory });
      return;
    }
    const keyRaw = cleanPath.split('/')[2] || '';
    const key = keyRaw.toString().trim();
    let card = cards.find(c => c.id === key);
    if (!card) {
      const normalizedKey = normalizeQrId(key);
      if (normalizedKey) {
        card = cards.find(c => normalizeQrId(c.qrId || '') === normalizedKey);
      }
    }
    if (!card) {
      showToast('Маршрутная карта не найдена.');
      handleRoute('/cards', { replace: true, fromHistory });
      return;
    }
    const qr = normalizeQrId(card.qrId || '');
    if (isValidScanId(qr)) {
      const canonicalPath = `/cards/${encodeURIComponent(qr)}`;
      if (cleanPath !== canonicalPath) {
        history.replaceState({}, '', canonicalPath);
        currentPath = canonicalPath;
        normalized = canonicalPath;
        cleanPath = canonicalPath;
      }
    }
    mountTemplate('tpl-page-cards-new');
    initCardsByIdRoute(card, { fromHistory });
    appState = { ...appState, tab: 'cards' };
    window.__currentPageId = 'page-cards-new';
    if (typeof setNavActiveByRoute === 'function') setNavActiveByRoute(cleanPath);
    pushState();
    return;
  }
const routeEntry = ROUTE_TABLE.find(route => route.path === cleanPath);
if (routeEntry) {
  try {
    console.log('[ROUTE_MATCH]', {
      cleanPath,
      tpl: routeEntry.tpl,
      pageId: routeEntry.pageId,
      tab: routeEntry.tab
    });
  } catch (e) {}
  const permissionKey = routeEntry.permission || routeEntry.tab;

  if (!isLoading && permissionKey && !canViewTab(permissionKey)) {
    alert('Нет прав доступа к разделу');
    const fallback = getDefaultTab();
    handleRoute('/' + fallback, { replace: true, fromHistory });
    return;
  }

  // mark soft for mountTemplate debug logs
  window.__lastHandleRouteSoft = isSoft;

  // === FIX: avoid double mountTemplate() on bootstrap soft refresh (F5) ===
  const targetPageId = routeEntry.pageId || ('page-' + (routeEntry.tab || 'cards'));
  const currentRoutePath = (appState && appState.route ? String(appState.route).split('?')[0] : '');
  const isSamePath = (currentRoutePath && currentRoutePath === cleanPath) || (location.pathname === cleanPath);
  const alreadyOnSamePage =
          window.__currentPageId === targetPageId &&
    isSamePath;

  const mountRoot = getAppMain && getAppMain();
  const hasMountedContent = !!(mountRoot && mountRoot.children && mountRoot.children.length);
  const shouldMount = !alreadyOnSamePage || !hasMountedContent;

  if (shouldMount) {
    mountTemplate(routeEntry.tpl);
  }
  try {
    console.log('[ROUTE_MOUNT]', {
      alreadyOnSamePage,
      hasMountedContent,
      shouldMount,
      targetPageId
    });
  } catch (e) {}
  window.__currentPageId = targetPageId;

  if (routeEntry.tab || permissionKey) {
    appState = { ...appState, tab: permissionKey || routeEntry.tab };
  }

  window.__routeRenderPath = normalized;

  const forcePageInit = isPageRoute(cleanPath) && (!hasMountedContent || !isSamePath);
  let shouldInit = forcePageInit || (!alreadyOnSamePage) || isSoft || !hasMountedContent;
  if (!isLoading && routeEntry.pageId === 'page-cards-new') {
    const pageMount = document.getElementById('page-cards-new');
    const cardModal = document.getElementById('card-modal');
    const needsCardInit = !pageMount || !pageMount.hasChildNodes() || (cardModal && cardModal.classList.contains('hidden'));
    if (needsCardInit) shouldInit = true;
  }
  if (!isLoading && routeEntry.init && shouldInit) {
    // On soft refresh we still re-render data/widgets without remounting template
    routeEntry.init({ fromHistory, soft: isSoft });
  }

  if (!isPageRoute(cleanPath)) {
    ensureMainSectionVisible();
  }
  try {
    console.log('[ROUTE_INIT]', {
      shouldInit,
      isLoading,
      pageId: routeEntry.pageId || routeEntry.tpl
    });
  } catch (e) {}

  if (typeof setNavActiveByRoute === 'function') setNavActiveByRoute(cleanPath);
  pushState();
  return;
}

}

function navigateToRoute(path) {
  handleRoute(path, { replace: false, fromHistory: false });
}
