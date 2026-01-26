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
    setCsrfToken(payload.csrfToken);
    updateUserBadge();
    if (typeof startMessagesSse === 'function') startMessagesSse();
    hideAuthOverlay();
    hideSessionOverlay();
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
    currentUser = payload.user || null;
    setCsrfToken(payload.csrfToken);
    updateUserBadge();
    if (typeof startMessagesSse === 'function') startMessagesSse();
    hideAuthOverlay();
    hideSessionOverlay();
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
  unreadMessagesCount = 0;
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
  const approvalsAllowed = canViewTab('approvals');
  const approvalsSection = document.getElementById('approvals');
  if (approvalsSection) approvalsSection.classList.toggle('hidden', !approvalsAllowed);
  const approvalsLink = document.getElementById('nav-approvals-link');
  if (approvalsLink) approvalsLink.classList.toggle('hidden', !approvalsAllowed);
  const productionAllowed = canViewTab('production');
  const productionContainer = document.getElementById('nav-production-dropdown');
  if (productionContainer) productionContainer.classList.toggle('hidden', !productionAllowed);
  ['production-schedule', 'production-shifts', 'production-delayed', 'production-defects'].forEach(id => {
    const section = document.getElementById(id);
    if (section) section.classList.toggle('hidden', !productionAllowed);
  });
  const shiftTimesAllowed = canViewTab('shift-times');
  const shiftTimesSection = document.getElementById('shift-times');
  if (shiftTimesSection) shiftTimesSection.classList.toggle('hidden', !shiftTimesAllowed);
  const shiftTimesLink = document.getElementById('nav-shift-times-link');
  if (shiftTimesLink) shiftTimesLink.classList.toggle('hidden', !shiftTimesAllowed);

  const isHome = window.location.pathname === '/';
  const hasHash = !!window.location.hash;
  const currentTab = appState.tab && canViewTab(appState.tab) ? appState.tab : getDefaultTab();

  const replaceHistory = isHome || hasHash;
  if (!isPageRoute(window.location.pathname)) {
    activateTab(currentTab, { replaceHistory });
  } else {
    appState = { ...appState, tab: currentTab };
  }
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
  applyReadonlyState('approvals', 'approvals');
  applyReadonlyState('workorders', 'workorders');
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
    initScanButton('approvals-search', 'approvals-scan-btn');
    initScanButton('provision-search', 'provision-scan-btn');
    initScanButton('input-control-search', 'input-control-scan-btn');
    initScanButton('workorder-search', 'workorder-scan-btn');
    initScanButton('archive-search', 'archive-scan-btn');
    initScanButton('workspace-search', 'workspace-scan-btn');
    setupAttachmentControls();
    setupWorkspaceModal();
    setupProvisionModal();
    setupInputControlModal();
    setupLogModal();
    setupSecurityControls();
    setupApprovalRejectModal();
    setupApprovalApproveModal();
    setupProductionModule();
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
