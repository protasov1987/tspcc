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
    if (typeof startMessagesSse === 'function') startMessagesSse();
    hideAuthOverlay();
    hideSessionOverlay();
    showAppRoot();
    showAppRoot();

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
  try {
    let res;
    const sessionPerfStart = performance.now();
    console.log('[PERF] session:fetch:start');
    try {
      res = await fetchWithTimeout('/api/session', { credentials: 'include' }, 10000);
    } catch (e) {
      // Важно: не оставлять overlay навсегда при зависшем запросе (pending) — будет abort по таймауту.
      hideSessionOverlay();
      // Показать окно авторизации/сообщение и выйти
      if (typeof hideMainApp === 'function') hideMainApp();
      if (typeof showAuthOverlay === 'function') {
        showAuthOverlay('Сессия не проверена. Обновите страницу или войдите заново.');
      } else {
        alert('Сессия не проверена. Обновите страницу или войдите заново.');
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
    if (typeof startMessagesSse === 'function') startMessagesSse();
    hideAuthOverlay();
    hideSessionOverlay();
    showAppRoot();
    showAppRoot();

    showMainApp();

    await bootstrapApp();
    applyNavigationPermissions();
    resetInactivityTimer();
  } catch (err) {
    currentUser = null;
    setCsrfToken(null);
    updateUserBadge();
    hideMainApp();
    hideSessionOverlay();
    showAuthOverlay('Введите пароль для входа');
  } finally {
    // Страховка: overlay не должен оставаться навсегда
    try { hideSessionOverlay(); } catch (_) {}
  }
}

async function performLogout(silent = false) {
  try {
    await apiFetch('/api/logout', { method: 'POST' });
  } catch (err) {
    if (!silent) console.error('Logout failed', err);
  }
  if (typeof stopMessagesSse === 'function') stopMessagesSse();
  currentUser = null;
  setCsrfToken(null);
  if (typeof resetDataHydrationState === 'function') resetDataHydrationState();
  if (typeof resetSecurityDataLoaded === 'function') resetSecurityDataLoaded();
  unreadMessagesCount = 0;
  updateUserBadge();
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
  if (incomingModal && incomingModal.type === 'barcode' && cardsAllowed) {
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
  const route = (event.state && event.state.route) || (window.location.pathname + window.location.search) || '/';
  handleRoute(route, { fromHistory: true, replace: true });
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
  const errorEl = document.getElementById('login-error');

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

  const normalizeInputValue = () => {
    if (!searchInput) return;
    const normalizer = typeof normalizeScanIdInput === 'function'
      ? normalizeScanIdInput
      : (raw) => (raw || '').toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const validator = typeof isValidScanId === 'function'
      ? isValidScanId
      : (value) => /^[A-Z0-9]{6,32}$/.test(value || '');
    const current = searchInput.value || '';
    const normalized = normalizer(current);
    if (normalized !== current.trim()) {
      searchInput.value = normalized;
      const inputEvent = new Event('input', { bubbles: true });
      searchInput.dispatchEvent(inputEvent);
    }
    if (normalized && !validator(normalized)) {
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
  ensureScanButton('cards-search', 'cards-scan-btn');
  ensureScanButton('approvals-search', 'approvals-scan-btn');
  ensureScanButton('provision-search', 'provision-scan-btn');
  ensureScanButton('input-control-search', 'input-control-scan-btn');
  ensureScanButton('workorder-search', 'workorder-scan-btn');
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
  if (cleanPath === '/receipts' || cleanPath.startsWith('/receipts/')) {
    return DATA_SCOPE_FULL;
  }
  if (DIRECTORY_ROUTE_SCOPES.has(cleanPath)) {
    return DATA_SCOPE_DIRECTORIES;
  }
  if (cleanPath === '/workspace'
    || cleanPath.startsWith('/workspace/')
    || cleanPath.startsWith('/production/')) {
    return DATA_SCOPE_PRODUCTION;
  }
  return DATA_SCOPE_CARDS_BASIC;
}

async function ensureRouteCriticalData(routePath, { force = false, reason = 'route' } = {}) {
  const cleanPath = normalizeSecurityRoutePath(routePath);
  const scope = getRouteCriticalDataScope(cleanPath);
  if (!scope) {
    console.log('[ROUTE] critical data skipped', { path: cleanPath, reason, state: 'not-required' });
    return false;
  }
  if (typeof hasLoadedDataScope === 'function' && hasLoadedDataScope(scope) && !force) {
    console.log('[ROUTE] critical data skipped', { path: cleanPath, scope, reason, state: 'cached' });
    return false;
  }
  console.log('[ROUTE] critical data start', { path: cleanPath, scope, reason });
  const ok = await loadDataWithScope({ scope, force, reason: reason + ':' + cleanPath });
  console.log('[ROUTE] critical data done', { path: cleanPath, scope, reason, ok: !!ok });
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
    setupNavigation();
    setupCardsDropdownMenu();
    setupCardsTabs();
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
}
