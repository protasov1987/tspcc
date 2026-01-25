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
let productionSchedule = [];
let productionShiftTimes = [];
let productionShiftTasks = [];
let productionShifts = [];
let userPasswordCache = {};
let workorderSearchTerm = '';
let workorderStatusFilter = 'ALL';
let workorderMissingExecutorFilter = 'ALL';
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
let cardsSortKey = '';
let cardsSortDir = 'asc';
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
let workspaceStopContext = null;
let workspaceActiveModalInput = null;
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
const OPERATION_TYPE_OPTIONS = ['Стандартная', 'Идентификация', 'Документы'];
const DEFAULT_OPERATION_TYPE = OPERATION_TYPE_OPTIONS[0];

function isCardsLiveRoute(pathname = location.pathname) {
  return pathname === '/cards'
    || pathname === '/dashboard'
    || pathname === '/approvals'
    || pathname === '/provision'
    || pathname === '/input-control';
}

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

function getDefaultProductionShiftTimes() {
  return [
    { shift: 1, timeFrom: '08:00', timeTo: '16:00' },
    { shift: 2, timeFrom: '16:00', timeTo: '00:00' },
    { shift: 3, timeFrom: '00:00', timeTo: '08:00' }
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
    if (target === 'production') return;
    if (canViewTab(target)) {
      tabs.push(target);
    }
  });
  ['approvals', 'provision', 'departments', 'operations', 'areas', 'employees', 'shift-times'].forEach(tab => {
    if (canViewTab(tab) && !tabs.includes(tab)) {
      tabs.push(tab);
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

function isPageRoute(pathname = window.location.pathname) {
  const pageRoutes = ['/cards/new', '/cards-mki/new'];
  if (pageRoutes.includes(pathname)) return true;
  if (pathname.startsWith('/cards/') && pathname !== '/cards/new') return true;
  if (pathname.startsWith('/workorders/')) return true;
  if (pathname.startsWith('/archive/')) return true;
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

function handleRoute(path, { replace = false, fromHistory = false } = {}) {
  let urlObj;
  try {
    urlObj = new URL(path || '/', window.location.origin);
  } catch (err) {
    urlObj = new URL('/', window.location.origin);
  }

  let currentPath = urlObj.pathname || '/';
  const search = urlObj.search || '';
  let normalized = (currentPath || '/') + search;
  const tabRoutes = {
    '/dashboard': 'dashboard',
    '/approvals': 'approvals',
    '/provision': 'provision',
    '/input-control': 'input-control',
    '/departments': 'departments',
    '/operations': 'operations',
    '/areas': 'areas',
    '/employees': 'employees',
    '/shift-times': 'shift-times',
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

  if (!isCardsLiveRoute(currentPath)) {
    stopCardsSse();
    stopCardsLivePolling();
  }

  if (currentPath === '/cards-mki/new') {
    history.replaceState({}, '', '/cards/new' + location.search);
    currentPath = '/cards/new';
    normalized = (currentPath || '/') + search;
  }

  if (currentPath.startsWith('/cards/') && currentPath !== '/cards/new') {
    const keyRaw = currentPath.split('/')[2] || '';
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
      navigateToRoute('/cards');
      return;
    }
    const qr = normalizeQrId(card.qrId || '');
    if (isValidScanId(qr)) {
      const canonicalPath = `/cards/${encodeURIComponent(qr)}`;
      if (currentPath !== canonicalPath) {
        history.replaceState({}, '', canonicalPath);
        currentPath = canonicalPath;
        normalized = canonicalPath;
      }
    }
    closeAllModals(true);
    showPage('page-cards-new');
    const mountEl = document.getElementById('page-cards-new');
    resetPageContainer(mountEl);
    openCardModal(card.id, {
      cardType: 'MKI',
      renderMode: 'page',
      mountEl,
      fromRestore: fromHistory
    });
    pushState();
    return;
  }

  if (currentPath === '/cards/new') {
    const cardIdParam = urlObj.searchParams.get('cardId');
    const trimmedCardId = (cardIdParam || '').toString().trim();
    if (trimmedCardId) {
      const next = `/cards/${encodeURIComponent(trimmedCardId)}`;
      history.replaceState({}, '', next);
      handleRoute(next, { replace: true, fromHistory: true });
      return;
    }
    const card = cardIdParam ? cards.find(c => c.id === cardIdParam) : null;
    if (card && card.cardType !== 'MKI') {
      showToast('Маршрутная карта недоступна.');
      navigateToRoute('/cards');
      return;
    }
    closeAllModals(true);
    showPage('page-cards-new');
    const mountEl = document.getElementById('page-cards-new');
    resetPageContainer(mountEl);
    openCardModal(card ? card.id : null, {
      cardType: 'MKI',
      renderMode: 'page',
      mountEl,
      fromRestore: fromHistory
    });
    pushState();
    return;
  }

  if (currentPath === '/cards') {
    const openCardsView = async () => {
      stopCardsLivePolling();
      await refreshCardsDataOnEnter();
      closePageScreens();
      activateTab('cards', { skipHistory: true, fromRestore: fromHistory });
      renderCardsTable();
      startCardsSse();
      startCardsLiveTick();
      scheduleCardsLiveRefresh('enter', 0);
      pushState();
    };
    openCardsView();
    return;
  }

  if (currentPath === '/dashboard') {
    const openDashboardView = async () => {
      stopCardsLivePolling();
      await refreshCardsDataOnEnter();
      closePageScreens();
      activateTab('dashboard', { skipHistory: true, fromRestore: fromHistory });
      renderDashboard();
      startCardsSse();
      startCardsLiveTick();
      scheduleCardsLiveRefresh('enter', 0);
      pushState();
    };
    openDashboardView();
    return;
  }

  if (currentPath === '/approvals') {
    if (!canViewTab('approvals')) {
      alert('Нет прав доступа к разделу');
      const fallback = getDefaultTab();
      closePageScreens();
      activateTab(fallback, { skipHistory: true, fromRestore: fromHistory });
      pushState();
      return;
    }
    const openApprovalsView = async () => {
      stopCardsLivePolling();
      await refreshCardsDataOnEnter();
      closePageScreens();
      activateTab('approvals', { skipHistory: true, fromRestore: fromHistory });
      startCardsSse();
      startCardsLiveTick();
      scheduleCardsLiveRefresh('enter', 0);
      pushState();
    };
    openApprovalsView();
    return;
  }

  if (currentPath === '/provision') {
    if (!canViewTab('provision')) {
      alert('Нет прав доступа к разделу');
      const fallback = getDefaultTab();
      closePageScreens();
      activateTab(fallback, { skipHistory: true, fromRestore: fromHistory });
      pushState();
      return;
    }
    const openProvisionView = async () => {
      stopCardsLivePolling();
      await refreshCardsDataOnEnter();
      closePageScreens();
      activateTab('provision', { skipHistory: true, fromRestore: fromHistory });
      startCardsSse();
      startCardsLiveTick();
      scheduleCardsLiveRefresh('enter', 0);
      pushState();
    };
    openProvisionView();
    return;
  }

  if (currentPath === '/input-control') {
    if (!canViewTab('input-control')) {
      alert('Нет прав доступа к разделу');
      const fallback = getDefaultTab();
      closePageScreens();
      activateTab(fallback, { skipHistory: true, fromRestore: fromHistory });
      pushState();
      return;
    }
    const openInputControlView = async () => {
      stopCardsLivePolling();
      await refreshCardsDataOnEnter();
      closePageScreens();
      activateTab('input-control', { skipHistory: true, fromRestore: fromHistory });
      startCardsSse();
      startCardsLiveTick();
      scheduleCardsLiveRefresh('enter', 0);
      pushState();
    };
    openInputControlView();
    return;
  }

  if (currentPath.startsWith('/production/')) {
    if (!canViewTab('production')) {
      alert('Нет прав доступа к разделу');
      const fallback = getDefaultTab();
      closePageScreens();
      activateTab(fallback, { skipHistory: true, fromRestore: fromHistory });
      pushState();
      return;
    }
    closePageScreens();
    openProductionRoute(currentPath, { fromRestore: fromHistory });
    pushState();
    return;
  }

  if (currentPath.startsWith('/workorders/')) {
    if (!canViewTab('workorders')) {
      alert('Нет прав доступа к разделу');
      const fallback = getDefaultTab();
      closePageScreens();
      activateTab(fallback, { skipHistory: true, fromRestore: fromHistory });
      pushState();
      return;
    }
    const qrParam = (currentPath.split('/')[2] || '').trim();
    const qr = normalizeQrId(qrParam);
    if (!qr || !isValidScanId(qr)) {
      showToast?.('Некорректный QR') || alert('Некорректный QR');
      navigateToRoute('/workorders');
      return;
    }
    const card = cards.find(c => normalizeQrId(c.qrId) === qr && !c.archived);
    if (!card) {
      showToast?.('Маршрутная карта не найдена') || alert('Маршрутная карта не найдена');
      navigateToRoute('/workorders');
      return;
    }
    closeAllModals(true);
    closePageScreens();
    activateTab('workorders', { skipHistory: true, fromRestore: fromHistory });
    document.body.classList.add('page-wo-mode');
    showPage('page-workorders-card');
    const mountEl = document.getElementById('page-workorders-card');
    resetPageContainer(mountEl);
    renderWorkorderCardPage(card, mountEl);
    pushState();
    return;
  }

  if (currentPath.startsWith('/archive/')) {
    if (!canViewTab('archive')) {
      alert('Нет прав доступа к разделу');
      const fallback = getDefaultTab();
      closePageScreens();
      activateTab(fallback, { skipHistory: true, fromRestore: fromHistory });
      pushState();
      return;
    }
    const qrParam = (currentPath.split('/')[2] || '').trim();
    const qr = normalizeQrId(qrParam);
    if (!qr || !isValidScanId(qr)) {
      showToast?.('Некорректный QR') || alert('Некорректный QR');
      navigateToRoute('/archive');
      return;
    }
    const card = cards.find(c => normalizeQrId(c.qrId) === qr && !!c.archived);
    if (!card) {
      showToast?.('Карта в архиве не найдена') || alert('Карта в архиве не найдена');
      navigateToRoute('/archive');
      return;
    }
    closeAllModals(true);
    closePageScreens();
    activateTab('archive', { skipHistory: true, fromRestore: fromHistory });
    document.body.classList.add('page-wo-mode');
    showPage('page-archive-card');
    const mountEl = document.getElementById('page-archive-card');
    resetPageContainer(mountEl);
    renderArchiveCardPage(card, mountEl);
    pushState();
    return;
  }

  if (tabRoutes[currentPath]) {
    closePageScreens();
    activateTab(tabRoutes[currentPath], { skipHistory: true, fromRestore: fromHistory });
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
