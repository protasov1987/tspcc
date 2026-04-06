// === АВТОРИЗАЦИЯ ===
function setBootPhase(phase, details) {
  window.__bootPhase = phase;
  try {
    console.log('[BOOT]', phase, details || {});
  } catch (e) {}
}

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
    setBootPhase('login:request:start');
    const formData = new FormData();
    formData.append('password', password);

    const res = await fetch('/api/login', {
      method: 'POST',
      body: formData,
      credentials: 'include'
    });
    const payload = await res.json().catch(() => ({}));
    if (!payload.success) {
      setBootPhase('login:request:rejected', { status: res.status });
      const message = (payload && payload.error) ? payload.error : 'Неверный пароль';
      if (errorEl) {
        errorEl.style.display = 'block';
        errorEl.textContent = message;
      }
      return;
    }

    setBootPhase('login:request:authorized', { userId: payload?.user?.id || null });
    await completeAuthorizedBootstrap(payload, 'login');
  } catch (err) {
    hideSessionOverlay();
    hideMainApp();
    if (errorEl) {
      errorEl.style.display = 'block';
      errorEl.textContent = 'Ошибка входа: ' + err.message;
    }
    try {
      console.error('[BOOT] login failed', {
        phase: window.__bootPhase || 'unknown',
        error: err && err.stack ? err.stack : String(err)
      });
    } catch (e) {}
  }
}

async function completeAuthorizedBootstrap(payload, source = 'session') {
  setBootPhase('authorized-bootstrap:start', { source });
  currentUser = payload.user || null;
  setCsrfToken(payload.csrfToken);
  updateUserBadge();
  showAppRoot();
  hideMainApp();

  const overlayMessage = source === 'login'
    ? 'Загрузка данных...'
    : 'Восстановление сессии...';
  showSessionOverlay(overlayMessage);
  console.log('[BOOT] authorized bootstrap:start', {
    source,
    path: getFullPath(),
  });

  setBootPhase('authorized-bootstrap:bootstrap-minimal', { source });
  await loadBootstrapData({ force: true });
  setBootPhase('authorized-bootstrap:bootstrap-app', { source });
  await bootstrapApp();

  setBootPhase('authorized-bootstrap:show-main', { source });
  hideAuthOverlay();
  showMainApp();
  hideSessionOverlay();
  setBootPhase('authorized-bootstrap:apply-navigation', { source });
  applyNavigationPermissions();
  resetInactivityTimer();
  if (typeof startMessagesSse === 'function') startMessagesSse();
  setBootPhase('authorized-bootstrap:done', { source });

  console.log('[BOOT] authorized bootstrap:done', {
    source,
    path: getFullPath(),
  });
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
    setBootPhase('session:restore:start');
    let res;
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
    if (!res.ok) throw new Error('Unauthorized');
    const payload = await res.json();
    setBootPhase('session:restore:authorized', { userId: payload?.user?.id || null });
    await completeAuthorizedBootstrap(payload, 'session');
  } catch (err) {
    setBootPhase('session:restore:failed', { reason: err?.message || String(err) });
    currentUser = null;
    setCsrfToken(null);
    updateUserBadge();
    hideMainApp();
    hideSessionOverlay();
    showAuthOverlay('Введите пароль для входа');
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
  if (typeof resetClientDataLoadFlags === 'function') resetClientDataLoadFlags();
  unreadMessagesCount = 0;
  updateUserBadge();
  hideMainApp();
  showAuthOverlay('Сессия завершена');
}

function applyNavigationPermissions() {
  const navButtons = document.querySelectorAll('.nav-btn');
  navButtons.forEach(btn => {
    const target = btn.getAttribute('data-target');
    const allowed = target === 'items-hub'
      ? (canViewTab('items') || canViewTab('ok') || canViewTab('oc'))
      : canViewTab(target);
    btn.classList.toggle('hidden', !allowed);
  });
  const approvalsAllowed = canViewTab('approvals');
  const approvalsLink = document.getElementById('nav-approvals-link');
  if (approvalsLink) approvalsLink.classList.toggle('hidden', !approvalsAllowed);
  const productionAllowed = canViewTab('production');
  const productionContainer = document.getElementById('nav-production-dropdown');
  if (productionContainer) productionContainer.classList.toggle('hidden', !productionAllowed);
  const itemsAllowed = canViewTab('items');
  const okAllowed = canViewTab('ok');
  const ocAllowed = canViewTab('oc');
  const itemsHubAllowed = itemsAllowed || okAllowed || ocAllowed;
  const itemsHubContainer = document.getElementById('nav-items-hub-dropdown');
  if (itemsHubContainer) itemsHubContainer.classList.toggle('hidden', !itemsHubAllowed);
  const itemsLink = document.getElementById('nav-items-link');
  if (itemsLink) itemsLink.classList.toggle('hidden', !itemsAllowed);
  const okLink = document.getElementById('nav-ok-link');
  if (okLink) okLink.classList.toggle('hidden', !okAllowed);
  const ocLink = document.getElementById('nav-oc-link');
  if (ocLink) ocLink.classList.toggle('hidden', !ocAllowed);
  const shiftTimesAllowed = canViewTab('shift-times');
  const shiftTimesLink = document.getElementById('nav-shift-times-link');
  if (shiftTimesLink) shiftTimesLink.classList.toggle('hidden', !shiftTimesAllowed);

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
  closeAllModals(true);
  handleRoute('/' + targetTab, { replace: true, fromHistory: true, soft: true });

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
  if (typeof setupBarcodeScannerForInput !== 'function') {
    return null;
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

async function bootstrapApp() {
  setBootPhase('bootstrap-app:start');
  window.SPA_LOADING?.startTopProgress();

  const fullPath = getFullPath();

  // 1) Route-first: сразу активируем правильную страницу/секцию
  setBootPhase('bootstrap-app:route-loading', { fullPath });
  await handleRoute(fullPath, { replace: true, fromHistory: true, loading: true });

  // 2) Скелетон overlay поверх активной секции (НЕ затираем DOM)
  const sectionEl = window.SPA_LOADING?.getActiveMainSection?.();
  const pageId = window.__currentPageId || null;
  if (sectionEl && pageId) {
    window.SPA_LOADING?.showSkeletonOverlay?.(pageId, sectionEl);
  }

  setBootPhase('bootstrap-app:route-data', { fullPath });
  await ensureRouteDataLoaded(fullPath, { reason: 'boot' });
  if (!currentUser) {
    const s = window.SPA_LOADING?.getActiveMainSection?.();
    if (s) window.SPA_LOADING?.hideSkeletonOverlay?.(s);
    window.SPA_LOADING?.finishTopProgress();
    return;
  }

  if (!appBootstrapped) {
    setBootPhase('bootstrap-app:init-ui');
    setupNavigation();
    setupCardsDropdownMenu();
    setupCardsTabs();
    setupBarcodeModal();
    setupDeleteConfirmModal();
    appBootstrapped = true;
  }

  // 4) Существующий общий рендер (не ломать)
  setBootPhase('bootstrap-app:data-ready', { fullPath });
  setBootPhase('bootstrap-app:render');
  renderEverything();
  if (window.dashboardPager && typeof window.dashboardPager.updatePages === 'function') {
    requestAnimationFrame(() => window.dashboardPager.updatePages());
  }
  if (!timersStarted && typeof tickTimers === 'function') {
    setInterval(tickTimers, 1000);
    timersStarted = true;
  }

  // 5) Soft refresh текущего URL (без смены страницы, без сбросов)
  setBootPhase('bootstrap-app:route-soft', { fullPath });
  await handleRoute(fullPath, { replace: true, fromHistory: true, loading: false, soft: true });
  setBootPhase('bootstrap-app:route-ready', { fullPath });

  // Убрать overlay после успешной дорисовки
  const sectionAfter = window.SPA_LOADING?.getActiveMainSection?.();
  if (sectionAfter) window.SPA_LOADING?.hideSkeletonOverlay?.(sectionAfter);

  setBootPhase('bootstrap-app:done');
  window.SPA_LOADING?.finishTopProgress();
}
