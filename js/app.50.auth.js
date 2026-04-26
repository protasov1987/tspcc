// === АВТОРИЗАЦИЯ ===
function showAppRoot() {
  const root = document.getElementById('app-root');
  if (root) root.classList.remove('hidden');
}

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
    const body = new URLSearchParams();
    body.set('password', password);

    const res = await fetch('/api/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
      },
      body: body.toString(),
      credentials: 'include'
    });
    if (typeof reportServerConnectionOk === 'function') {
      reportServerConnectionOk('login');
    }
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
    setCsrfToken(payload.csrfToken);
    updateUserBadge();
    hideAuthOverlay();
    hideSessionOverlay();
    showAppRoot();
    showAppRoot();

    showMainApp();

    await bootstrapApp();
    applyNavigationPermissions();
    resetInactivityTimer();
  } catch (err) {
    if (typeof reportServerConnectionLost === 'function') {
      reportServerConnectionLost('login', err, {
        message: 'Сервер недоступен. Не удалось выполнить вход.'
      });
    }
    if (errorEl) {
      errorEl.style.display = 'block';
      errorEl.textContent = 'Ошибка входа: ' + err.message;
    }
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      cache: 'no-store',
    });
  } finally {
    clearTimeout(timerId);
  }
}

async function restoreSession() {
  if (typeof setSessionRestorePhase === 'function') {
    setSessionRestorePhase('pending', 'restoreSession:start');
  }
  try {
    let res;
    const sessionPerfStart = performance.now();
    console.log('[PERF] session:fetch:start');
    try {
      res = await fetchWithTimeout('/api/session', { credentials: 'include' }, 10000);
      if (typeof reportServerConnectionOk === 'function') {
        reportServerConnectionOk('session-bootstrap');
      }
    } catch (e) {
      if (typeof reportServerConnectionLost === 'function') {
        reportServerConnectionLost('session-bootstrap', e, {
          message: 'Сервер недоступен. Не удалось проверить сессию.'
        });
      }
      console.warn('[BOOT] session check failed', {
        error: e?.message || String(e)
      });
      // Важно: не оставлять overlay навсегда при зависшем запросе (pending) — будет abort по таймауту.
      hideSessionOverlay();
      // Показать окно авторизации/сообщение и выйти
      if (typeof hideMainApp === 'function') hideMainApp();
      if (typeof showAuthOverlay === 'function') {
        showAuthOverlay('Сессия не проверена. Обновите страницу или войдите заново.');
      } else {
        alert('Сессия не проверена. Обновите страницу или войдите заново.');
      }
      if (typeof setSessionRestorePhase === 'function') {
        setSessionRestorePhase('complete', 'restoreSession:network-failed');
      }
      return false;
    }
    const sessionPerfAfterFetch = performance.now();
    console.log('[PERF] session:fetch:done', {
      fetchMs: Math.round(sessionPerfAfterFetch - sessionPerfStart),
      status: res?.status
    });
    if (!res.ok) throw new Error('Unauthorized');
    const payload = await res.json();
    const sessionPerfAfterJson = performance.now();
    console.log('[PERF] session:json:done', {
      jsonMs: Math.round(sessionPerfAfterJson - sessionPerfAfterFetch),
      totalMs: Math.round(sessionPerfAfterJson - sessionPerfStart)
    });
    currentUser = payload.user || null;
    setCsrfToken(payload.csrfToken);
    updateUserBadge();
    if (typeof setSessionRestorePhase === 'function') {
      setSessionRestorePhase('complete', 'restoreSession:authenticated');
    }
    hideAuthOverlay();
    hideSessionOverlay();
    showAppRoot();
    showAppRoot();

    showMainApp();

    await bootstrapApp();
    applyNavigationPermissions();
    resetInactivityTimer();
  } catch (err) {
    if (typeof reportServerConnectionOk === 'function') {
      reportServerConnectionOk('session-bootstrap');
    }
    currentUser = null;
    setCsrfToken(null);
    updateUserBadge();
    if (typeof setSessionRestorePhase === 'function') {
      setSessionRestorePhase('complete', 'restoreSession:guest');
    }
    hideMainApp();
    hideSessionOverlay();
    showAuthOverlay('Введите пароль для входа');
  } finally {
    // Страховка: overlay не должен оставаться навсегда
    try { hideSessionOverlay(); } catch (_) {}
  }
}

async function performLogout(silent = false) {
  const previousRoute = getFullPath();
  if (typeof stopActiveRouteEffects === 'function') {
    stopActiveRouteEffects('logout');
  }
  if (typeof stopMessagesSse === 'function') stopMessagesSse();
  try {
    await apiFetch('/api/logout', { method: 'POST' });
  } catch (err) {
    if (!silent) console.error('Logout failed', err);
  }
  currentUser = null;
  setCsrfToken(null);
  if (typeof setSessionRestorePhase === 'function') {
    setSessionRestorePhase('complete', 'logout');
  }
  if (typeof resetDataHydrationState === 'function') resetDataHydrationState();
  if (typeof resetSecurityDataLoaded === 'function') resetSecurityDataLoaded();
  unreadMessagesCount = 0;
  updateUserBadge();
  try {
    console.log('[BOOT] logout route reset:start', {
      from: previousRoute
    });
  } catch (e) {}
  if (typeof handleRoute === 'function') {
    handleRoute('/', { replace: true, fromHistory: false, soft: true });
  } else {
    try {
      history.replaceState({}, '', '/');
    } catch (err) {
      console.warn('[BOOT] logout route reset failed', err);
    }
  }
  try {
    console.log('[BOOT] logout route reset:done', {
      from: previousRoute,
      to: getFullPath()
    });
  } catch (e) {}
  hideMainApp();
  showAuthOverlay('Сессия завершена');
}

function applyNavigationPermissions() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    const target = btn.getAttribute('data-target');
    if (!target || ACCESS_PERMISSION_GROUPS[target]) return;
    btn.classList.toggle('hidden', !canViewTab(target));
  });

  ['cards', 'directories', 'production', 'items-hub'].forEach(groupKey => {
    const container = document.getElementById(`nav-${groupKey}-dropdown`);
    if (!container) return;
    const allowed = getAccessPermissionGroupKeys(groupKey).some(tabKey => canViewTab(tabKey));
    container.classList.toggle('hidden', !allowed);
  });

  document.querySelectorAll('.nav-dropdown-item').forEach(link => {
    const route = link.getAttribute('data-route') || link.getAttribute('href') || '';
    const explicitTarget = (link.getAttribute('data-target') || '').trim();
    const routePermission = typeof getAccessRoutePermission === 'function'
      ? getAccessRoutePermission(route)
      : null;
    const permissionKey = explicitTarget || routePermission?.key || '';
    const accessMode = routePermission?.access || 'view';
    const allowed = permissionKey ? canAccessTab(permissionKey, accessMode) : true;
    link.classList.toggle('hidden', !allowed);
  });

  const currentTab = appState.tab && canViewTab(appState.tab) ? appState.tab : getDefaultTab();

  appState = { ...appState, tab: currentTab };
  if (!isPageRoute(window.location.pathname)) {
    handleRoute(getFullPath(), { replace: true, fromHistory: true, soft: true });
  }
}

function restoreState(state) {
  if (!currentUser) return;
  restoringState = true;
  const targetTab = state && canViewTab(state.tab) ? state.tab : getDefaultTab();
  const targetRoute = state && typeof state.route === 'string' && state.route
    ? state.route
    : (typeof getRouteForTab === 'function' ? getRouteForTab(targetTab, '/dashboard') : ('/' + targetTab));
  closeAllModals(true);
  handleRoute(targetRoute, { replace: true, fromHistory: true, soft: true });

  let openedModal = null;
  const incomingModal = state ? state.modal : null;
  const cardsAllowed = canViewTab('cards');
  const usersAllowed = canViewTab('users');
  if (incomingModal && incomingModal.type === 'barcode' && incomingModal.mode === 'password' && usersAllowed) {
    const targetUser = users.find(u => u && u.id === incomingModal.userId);
    const password = resolveUserPassword(targetUser);
    if (targetUser && password) {
      openPasswordBarcode(password, targetUser.name || '', targetUser.id, { fromRestore: true });
      openedModal = incomingModal;
    }
  } else if (incomingModal && incomingModal.type === 'barcode' && cardsAllowed) {
    const card = cards.find(c => c.id === incomingModal.cardId);
    if (card) {
      openBarcodeModal(card, { fromRestore: true });
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
  const fullPath = (window.location.pathname + window.location.search) || '/';
  try {
    console.log('[ROUTE] popstate', {
      fullPath,
      stateRoute: event?.state?.route || null
    });
  } catch (e) {}
  handleRoute(fullPath, { fromHistory: true, replace: true });
});

function syncReadonlyLocks() {
  applyReadonlyState('dashboard', 'dashboard');
  applyReadonlyState('cards', 'cards');
  applyReadonlyState('approvals', 'approvals');
  applyReadonlyState('workorders', 'workorders');
  const itemsPermissionKey = (typeof isItemsPageRoute === 'function' && isItemsPageRoute(window.location.pathname || ''))
    ? (typeof getItemsPageConfig === 'function' ? getItemsPageConfig(window.location.pathname || '')?.permissionKey : 'items')
    : 'items';
  applyReadonlyState('items', itemsPermissionKey || 'items');
  applyReadonlyState('archive', 'archive');
  applyReadonlyState('workspace', 'workspace');
  applyReadonlyState('input-control', 'input-control');
  applyReadonlyState('users', 'users');
  applyReadonlyState('accessLevels', 'accessLevels');
}

function setupAuthControls() {
  const form = document.getElementById('login-form');
  const input = document.getElementById('login-password');
  const passwordToggle = document.getElementById('login-password-visibility');
  const errorEl = document.getElementById('login-error');

  if (!form) {
    console.error('login-form not found');
    return;
  }

  setupLoginQrScanner();

  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => performLogout());
  }

  const qwertyRuToEnMap = {
    'й': 'q', 'ц': 'w', 'у': 'e', 'к': 'r', 'е': 't', 'н': 'y', 'г': 'u', 'ш': 'i', 'щ': 'o', 'з': 'p', 'х': '[', 'ъ': ']',
    'ф': 'a', 'ы': 's', 'в': 'd', 'а': 'f', 'п': 'g', 'р': 'h', 'о': 'j', 'л': 'k', 'д': 'l', 'ж': ';', 'э': '\'',
    'я': 'z', 'ч': 'x', 'с': 'c', 'м': 'v', 'и': 'b', 'т': 'n', 'ь': 'm', 'б': ',', 'ю': '.',
    'ё': '`',
    'Й': 'Q', 'Ц': 'W', 'У': 'E', 'К': 'R', 'Е': 'T', 'Н': 'Y', 'Г': 'U', 'Ш': 'I', 'Щ': 'O', 'З': 'P', 'Х': '{', 'Ъ': '}',
    'Ф': 'A', 'Ы': 'S', 'В': 'D', 'А': 'F', 'П': 'G', 'Р': 'H', 'О': 'J', 'Л': 'K', 'Д': 'L', 'Ж': ':', 'Э': '"',
    'Я': 'Z', 'Ч': 'X', 'С': 'C', 'М': 'V', 'И': 'B', 'Т': 'N', 'Ь': 'M', 'Б': '<', 'Ю': '>',
    'Ё': '~'
  };

  const convertLoginPasswordLayout = (value) => {
    if (!value) return '';
    let changed = false;
    const nextValue = String(value).split('').map((char) => {
      if (!Object.prototype.hasOwnProperty.call(qwertyRuToEnMap, char)) return char;
      changed = true;
      return qwertyRuToEnMap[char];
    }).join('');
    return changed ? nextValue : String(value);
  };

  if (input && input.dataset.boundLayoutFix !== 'true') {
    input.dataset.boundLayoutFix = 'true';
    input.addEventListener('input', () => {
      const currentValue = String(input.value || '');
      const convertedValue = convertLoginPasswordLayout(currentValue);
      if (convertedValue === currentValue) return;
      const selectionStart = typeof input.selectionStart === 'number' ? input.selectionStart : null;
      const selectionEnd = typeof input.selectionEnd === 'number' ? input.selectionEnd : null;
      input.value = convertedValue;
      if (selectionStart !== null && selectionEnd !== null && document.activeElement === input) {
        input.setSelectionRange(selectionStart, selectionEnd);
      }
    });
  }

  if (passwordToggle && passwordToggle.dataset.bound !== 'true') {
    passwordToggle.dataset.bound = 'true';
    passwordToggle.addEventListener('click', () => {
      if (!input) return;
      const isHidden = input.getAttribute('type') === 'password';
      input.setAttribute('type', isHidden ? 'text' : 'password');
      passwordToggle.setAttribute('aria-label', isHidden ? 'Скрыть пароль' : 'Показать пароль');
    });
  }

  if (form.dataset.boundAuthSubmit === '1') {
    return;
  }
  form.dataset.boundAuthSubmit = '1';

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

function setupLoginQrScanner() {
  const form = document.getElementById('login-form');
  const input = document.getElementById('login-password');
  const triggerButton = document.getElementById('login-qr-btn');
  const modal = document.getElementById('barcode-scanner-modal');
  const video = document.getElementById('barcode-scanner-video');
  const closeButton = document.getElementById('barcode-scanner-close');
  const statusEl = document.getElementById('barcode-scanner-status');
  const hintEl = document.getElementById('barcode-scanner-hint');
  const errorEl = document.getElementById('login-error');

  if (!form || !input || !triggerButton || !modal || typeof BarcodeScanner === 'undefined') return null;
  if (triggerButton.dataset.boundScanner === '1') {
    return scannerRegistry?.loginPassword || null;
  }

  const scanner = new BarcodeScanner({
    input,
    triggerButton,
    modal,
    video,
    closeButton,
    statusEl,
    hintEl,
    scanningHintText: 'Наведите камеру на QR-код пароля',
    invalidMessage: 'Не удалось распознать QR-код пароля',
    detectedToastMessage: false,
    normalizeValue: (value) => (value == null ? '' : String(value).trim()),
    validateValue: (value) => Boolean(String(value || '').trim()),
    onDetectedValue: () => {
      if (errorEl) {
        errorEl.style.display = 'none';
        errorEl.textContent = '';
      }
      const submitLogin = () => {
        if (typeof form.requestSubmit === 'function') {
          form.requestSubmit();
          return;
        }
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      };
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(submitLogin);
      } else {
        setTimeout(submitLogin, 0);
      }
    }
  });

  scanner.init();
  scannerRegistry.loginPassword = scanner;
  triggerButton.dataset.boundScanner = '1';
  input.dataset.boundLoginQr = '1';
  return scanner;
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

  const normalizeSearchScanValue = (raw) => {
    const mapping = {
      'Ф': 'A', 'И': 'B', 'С': 'C', 'В': 'D', 'У': 'E', 'А': 'F', 'П': 'G', 'Р': 'H',
      'Ш': 'I', 'О': 'J', 'Л': 'K', 'Д': 'L', 'Ь': 'M', 'Т': 'N', 'Щ': 'O', 'З': 'P',
      'Й': 'Q', 'К': 'R', 'Ы': 'S', 'Е': 'T', 'Г': 'U', 'М': 'V', 'Ц': 'W', 'Ч': 'X',
      'Н': 'Y', 'Я': 'Z'
    };
    const upper = (raw || '').toString().trim().toUpperCase();
    let result = '';
    for (let i = 0; i < upper.length; i += 1) {
      const ch = upper[i];
      result += mapping[ch] || ch;
    }
    return result
      .replace(/[^A-Z0-9-]/g, '')
      .replace(/-{2,}/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '');
  };
  const validateSearchScanValue = (value) => Boolean(normalizeSearchScanValue(value));

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
    },
    normalizeValue: normalizeSearchScanValue,
    validateValue: validateSearchScanValue
  });

  scanner.init();
  scannerRegistry[inputId] = scanner;

  const normalizeInputValue = () => {
    if (!searchInput) return;
    const current = searchInput.value || '';
    const normalized = normalizeSearchScanValue(current);
    if (normalized !== current.trim()) {
      searchInput.value = normalized;
      const inputEvent = new Event('input', { bubbles: true });
      searchInput.dispatchEvent(inputEvent);
    }
    if (normalized && !validateSearchScanValue(normalized)) {
      showToast('Неверный QR ID');
    }
  };

  searchInput.addEventListener('change', normalizeInputValue);
  searchInput.addEventListener('blur', normalizeInputValue);
  return scanner;
}

function initScanButton(inputId, buttonId) {
  return ensureScanButton(inputId, buttonId);
}

function ensureScanButton(inputId, buttonId) {
  const input = document.getElementById(inputId);
  const button = document.getElementById(buttonId);
  if (!input || !button) return null;
  if (input.dataset.boundScanner === '1' && button.dataset.boundScanner === '1') {
    return scannerRegistry?.[inputId] || null;
  }
  const scanner = setupBarcodeScannerForInput(inputId, buttonId);
  if (scanner) {
    input.dataset.boundScanner = '1';
    button.dataset.boundScanner = '1';
  }
  return scanner;
}

function setupScanButtons() {
  setupLoginQrScanner();
  ensureScanButton('cards-search', 'cards-scan-btn');
  ensureScanButton('approvals-search', 'approvals-scan-btn');
  ensureScanButton('provision-search', 'provision-scan-btn');
  ensureScanButton('input-control-search', 'input-control-scan-btn');
  ensureScanButton('workorder-search', 'workorder-scan-btn');
  ensureScanButton('items-search', 'items-scan-btn');
  ensureScanButton('archive-search', 'archive-scan-btn');
  ensureScanButton('workspace-search', 'workspace-scan-btn');
}

function getFullPath() {
  return (window.location.pathname + window.location.search) || '/';
}

function normalizeSecurityRoutePath(routePath) {
  try {
    return new URL(routePath || '/', window.location.origin).pathname || '/';
  } catch (err) {
    return (routePath || '/').toString().split('?')[0].split('#')[0] || '/';
  }
}

function routeRequiresSecurityData(routePath) {
  const cleanPath = normalizeSecurityRoutePath(routePath);
  return cleanPath === '/users'
    || cleanPath === '/accessLevels'
    || cleanPath === '/profile'
    || cleanPath === '/profile/'
    || cleanPath.startsWith('/profile/');
}

const DIRECTORY_ROUTE_SCOPES = new Set([
  '/departments',
  '/operations',
  '/areas',
  '/employees',
  '/shift-times'
]);

function getRouteCriticalDataScope(routePath) {
  const cleanPath = normalizeSecurityRoutePath(routePath);
  if (routeRequiresSecurityData(cleanPath)) {
    return null;
  }
  if (cleanPath === '/cards') {
    return null;
  }
  if (cleanPath === '/archive') {
    return DATA_SCOPE_DIRECTORIES;
  }
  if (cleanPath.startsWith('/archive/')) {
    return DATA_SCOPE_DIRECTORIES;
  }
  if (cleanPath === '/cards/new'
    || cleanPath.startsWith('/cards/')
    || cleanPath.startsWith('/card-route/')) {
    return DATA_SCOPE_DIRECTORIES;
  }
  if (cleanPath === '/receipts' || cleanPath.startsWith('/receipts/')) {
    return DATA_SCOPE_FULL;
  }
  if (DIRECTORY_ROUTE_SCOPES.has(cleanPath)) {
    return DATA_SCOPE_DIRECTORIES;
  }
  if (cleanPath === '/items'
    || cleanPath === '/ok'
    || cleanPath === '/oc') {
    return DATA_SCOPE_PRODUCTION;
  }
  if (cleanPath === '/workspace'
    || cleanPath.startsWith('/workspace/')
    || cleanPath === '/workorders'
    || cleanPath.startsWith('/workorders/')
    || cleanPath.startsWith('/production/')) {
    return DATA_SCOPE_PRODUCTION;
  }
  return DATA_SCOPE_CARDS_BASIC;
}

async function ensureRouteCriticalData(routePath, { force = false, reason = 'route' } = {}) {
  const cleanPath = normalizeSecurityRoutePath(routePath);
  const scope = getRouteCriticalDataScope(cleanPath);
  const needsCardsCoreList = cleanPath === '/cards'
    || cleanPath === '/cards/new'
    || cleanPath === '/archive';
  if (!scope) {
    if (!needsCardsCoreList) {
      console.log('[ROUTE] critical data skipped', { path: cleanPath, reason, state: 'not-required' });
      return false;
    }
  }
  const needsCardsCoreDetail = typeof getCardsCoreRouteKey === 'function'
    && Boolean(getCardsCoreRouteKey(cleanPath));
  const hasCardsCoreListReady = !needsCardsCoreList || (
    typeof hasCardsCoreListLoaded === 'function'
    && hasCardsCoreListLoaded({
      archived: cleanPath === '/cards' ? 'active' : (cleanPath === '/archive' ? 'only' : 'all'),
      q: cleanPath === '/cards' ? (typeof cardsSearchTerm === 'string' ? cardsSearchTerm : '') : ''
    })
  );
  const hasScopeLoaded = typeof hasLoadedDataScope === 'function' && hasLoadedDataScope(scope);
  const hasCardsCoreDetailLoaded = !needsCardsCoreDetail || (
    typeof hasCardsCoreRouteCardLoaded === 'function'
    && hasCardsCoreRouteCardLoaded(cleanPath)
  );
  if ((scope ? hasScopeLoaded : true) && hasCardsCoreListReady && hasCardsCoreDetailLoaded && !force) {
    console.log('[ROUTE] critical data skipped', { path: cleanPath, scope, reason, state: 'cached' });
    return false;
  }
  console.log('[ROUTE] critical data start', { path: cleanPath, scope, reason });
  const scopeOk = (!scope) || (hasScopeLoaded && !force)
    ? true
    : await loadDataWithScope({ scope, force, reason: reason + ':' + cleanPath });
  let listOk = true;
  if (needsCardsCoreList && typeof fetchCardsCoreList === 'function') {
    const listQuery = {
      archived: cleanPath === '/cards' ? 'active' : (cleanPath === '/archive' ? 'only' : 'all'),
      q: cleanPath === '/cards' ? (typeof cardsSearchTerm === 'string' ? cardsSearchTerm : '') : '',
      force,
      reason: 'route-list:' + reason + ':' + cleanPath
    };
    const listCards = await fetchCardsCoreList(listQuery);
    listOk = Array.isArray(listCards);
  }
  let detailOk = false;
  if (needsCardsCoreDetail && typeof ensureCardsCoreRouteCard === 'function') {
    const card = await ensureCardsCoreRouteCard(cleanPath, {
      force,
      reason: 'route-detail:' + reason
    });
    detailOk = Boolean(card);
  }
  const ok = Boolean(scopeOk) && Boolean(listOk) && (!needsCardsCoreDetail || detailOk);
  console.log('[ROUTE] critical data done', {
    path: cleanPath,
    scope,
    reason,
    ok,
    scopeOk: !!scopeOk,
    listOk: needsCardsCoreList ? !!listOk : undefined,
    detailOk: needsCardsCoreDetail ? detailOk : undefined
  });
  return ok;
}

function refreshCurrentRouteAfterHydration(routePath, { soft = true } = {}) {
  const currentFullPath = getFullPath();
  const requestedPath = normalizeSecurityRoutePath(routePath);
  const currentPath = normalizeSecurityRoutePath(currentFullPath);
  if (currentPath !== requestedPath) {
    return;
  }
  if (typeof renderEverything === 'function') {
    renderEverything();
  }
  handleRoute(currentFullPath, { replace: true, fromHistory: true, soft });
}

function hydrateRouteInBackground(routePath, { reason = 'route', soft = true } = {}) {
  if (typeof startBackgroundDataHydration !== 'function') {
    return Promise.resolve(false);
  }
  return startBackgroundDataHydration(reason).then((ok) => {
    if (ok) {
      refreshCurrentRouteAfterHydration(routePath, { soft });
    }
    return ok;
  });
}

async function ensureRouteSecurityData(routePath, { force = false } = {}) {
  const cleanPath = normalizeSecurityRoutePath(routePath);
  if (!routeRequiresSecurityData(cleanPath)) {
    console.log('[ROUTE] security-data load skipped', { path: cleanPath, reason: 'not-required' });
    return false;
  }
  if (typeof hasLoadedSecurityData === 'function' && hasLoadedSecurityData() && !force) {
    console.log('[ROUTE] security-data load skipped', { path: cleanPath, reason: 'cached' });
    return false;
  }
  console.log('[ROUTE] security-data load start', { path: cleanPath });
  await loadSecurityData({ force });
  console.log('[ROUTE] security-data load done', { path: cleanPath });
  return true;
}

async function bootstrapApp() {
  window.SPA_LOADING?.startTopProgress();

  let fullPath = getFullPath();
  window.__bootPerf = window.__bootPerf || {};
  window.__bootPerf.bootstrapPath = fullPath;

  const syncBootstrapRoute = (stage = 'sync') => {
    // Bootstrap must continue with the canonical current route after any
    // internal router redirect (for example "/" -> landingTab route).
    const currentPath = getFullPath();
    if (currentPath !== fullPath) {
      console.log('[BOOT] route changed during bootstrap', {
        stage,
        from: fullPath,
        to: currentPath
      });
      fullPath = currentPath;
      window.__bootPerf.bootstrapPath = currentPath;
    }
    return fullPath;
  };

  console.log('[BOOT] navigation setup:start', {
    path: fullPath
  });
  setupNavigation();
  setupCardsDropdownMenu();
  window.__bootPerf.t1a = performance.now();
  console.log('[BOOT] navigation setup:done', {
    path: fullPath,
    totalMs: Math.round(window.__bootPerf.t1a - window.__bootPerf.t0)
  });

  // 1) Route-first: сразу активируем правильную страницу/секцию
  handleRoute(fullPath, { replace: true, fromHistory: true, loading: true });
  fullPath = syncBootstrapRoute('after-loading-route');

  // 2) Скелетон overlay поверх активной секции (НЕ затираем DOM)
  const sectionEl = window.SPA_LOADING?.getActiveMainSection?.();
  const pageId = window.__currentPageId || null;
  if (sectionEl && pageId) {
    window.SPA_LOADING?.showSkeletonOverlay?.(pageId, sectionEl);
  }

  // 3) Route-critical data only
  window.__bootPerf.t2 = performance.now();
  console.log('[PERF] boot:criticalData:start', {
    path: fullPath,
    totalMs: Math.round(window.__bootPerf.t2 - window.__bootPerf.t0)
  });
  await ensureRouteCriticalData(fullPath, { reason: 'bootstrap' });
  fullPath = syncBootstrapRoute('after-critical-data');
  window.__bootPerf.t3 = performance.now();
  console.log('[PERF] boot:criticalData:done', {
    path: fullPath,
    totalMs: Math.round(window.__bootPerf.t3 - window.__bootPerf.t0),
    stepMs: Math.round(window.__bootPerf.t3 - window.__bootPerf.t2)
  });
  console.log('[BOOT] security-data deferred', { path: normalizeSecurityRoutePath(fullPath) });
  if (!currentUser) {
    const s = window.SPA_LOADING?.getActiveMainSection?.();
    if (s) window.SPA_LOADING?.hideSkeletonOverlay?.(s);
    window.SPA_LOADING?.finishTopProgress();
    return;
  }

  if (!appBootstrapped) {
    setupForms();
    setupBarcodeModal();
    setupDeleteConfirmModal();
    setupScanButtons();
    setupAttachmentControls();
    setupWorkspaceModal();
    setupProvisionModal();
    setupInputControlModal();
    if (typeof setupItemsModal === 'function') {
      setupItemsModal();
    }
    setupSecurityControls();
    setupApprovalRejectModal();
    setupApprovalApproveModal();
    setupProductionModule();
    appBootstrapped = true;
  }

  // 4) Существующий общий рендер (не ломать)
  fullPath = syncBootstrapRoute('before-render-everything');
  window.__bootPerf.t4 = performance.now();
  console.log('[PERF] boot:renderEverything:start', {
    path: fullPath,
    totalMs: Math.round(window.__bootPerf.t4 - window.__bootPerf.t0)
  });
  renderEverything();
  window.__bootPerf.t5 = performance.now();
  console.log('[PERF] boot:renderEverything:done', {
    path: fullPath,
    totalMs: Math.round(window.__bootPerf.t5 - window.__bootPerf.t0),
    stepMs: Math.round(window.__bootPerf.t5 - window.__bootPerf.t4)
  });
  if (window.dashboardPager && typeof window.dashboardPager.updatePages === 'function') {
    requestAnimationFrame(() => window.dashboardPager.updatePages());
  }
  if (!timersStarted) {
    setInterval(tickTimers, 1000);
    timersStarted = true;
  }

  // 5) Render the current route after minimal route-critical data is ready
  fullPath = syncBootstrapRoute('before-final-route');
  handleRoute(fullPath, { replace: true, fromHistory: true, loading: false, soft: false });
  fullPath = syncBootstrapRoute('after-final-route');
  window.__bootPerf.t6 = performance.now();
  console.log('[PERF] boot:route-final:done', {
    path: fullPath,
    totalMs: Math.round(window.__bootPerf.t6 - window.__bootPerf.t0),
    stepMs: Math.round(window.__bootPerf.t6 - window.__bootPerf.t5)
  });

  // Убрать overlay после успешной дорисовки
  const sectionAfter = window.SPA_LOADING?.getActiveMainSection?.();
  if (sectionAfter) window.SPA_LOADING?.hideSkeletonOverlay?.(sectionAfter);

  window.SPA_LOADING?.finishTopProgress();

  console.log('[PERF] boot:summary', {
    path: fullPath,
    restoreSessionMs: Math.round((window.__bootPerf.t1 || 0) - (window.__bootPerf.t0 || 0)),
    criticalDataMs: Math.round((window.__bootPerf.t3 || 0) - (window.__bootPerf.t2 || 0)),
    renderEverythingMs: Math.round((window.__bootPerf.t5 || 0) - (window.__bootPerf.t4 || 0)),
    routeFinalizeMs: Math.round((window.__bootPerf.t6 || 0) - (window.__bootPerf.t5 || 0)),
    totalMs: Math.round((window.__bootPerf.t6 || 0) - (window.__bootPerf.t0 || 0))
  });

  fullPath = syncBootstrapRoute('before-background-hydration');
  hydrateRouteInBackground(fullPath, { reason: 'bootstrap:' + normalizeSecurityRoutePath(fullPath), soft: true });

  console.log('[BOOT] live:start', {
    path: fullPath
  });
  if (typeof startMessagesSse === 'function') startMessagesSse();
}
