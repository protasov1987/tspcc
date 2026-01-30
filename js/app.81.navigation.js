// === НАВИГАЦИЯ ===
const NAV_LABEL_MAP = {
  'Дашборд': 'dashboard',
  'МК': 'cards',
  'Трекер': 'workorders',
  'Архив': 'archive',
  'Рабочееместо': 'workspace',
  'Рабочее место': 'workspace',
  'Производство': 'production',
  'Пользователи': 'users',
  'Уровни доступа': 'accessLevels',
  'Справочники': 'directories',
  'Приемка': 'receipts'
};

const NAV_ROUTE_MAP = {
  dashboard: '/dashboard',
  cards: '/cards',
  workorders: '/workorders',
  archive: '/archive',
  workspace: '/workspace',
  production: '/production/shifts',
  users: '/users',
  accessLevels: '/accessLevels',
  directories: '/departments',
  receipts: '/receipts',
  approvals: '/approvals',
  provision: '/provision',
  'input-control': '/input-control'
};

let navigationSetupDone = false;
let cardsDropdownSetupDone = false;
let cardsTabsSetupDone = false;

function resolveTargetFromLabel(label) {
  const key = (label || '').replace(/\s+/g, ' ').trim();
  return NAV_LABEL_MAP[key] || null;
}

function resolveRouteFromTarget(target) {
  if (!target) return null;
  return NAV_ROUTE_MAP[target] || ('/' + target);
}

function setupNavigation() {
  if (navigationSetupDone) return;
  navigationSetupDone = true;

  document.addEventListener('click', event => {
    const toggleBtn = event.target.closest('#nav-toggle');
    if (toggleBtn) {
      event.preventDefault();
      togglePrimaryNav();
      return;
    }

    const tabButton = event.target.closest('.tab-btn[data-action="card-tab"]');
    if (tabButton) {
      event.preventDefault();
      const target = tabButton.getAttribute('data-tab-target');
      if (target && typeof window.openTab === 'function') {
        window.openTab(event, target);
      }
      return;
    }

    const dropdownToggle = event.target.closest('button.nav-btn.nav-dropdown-toggle');
    if (dropdownToggle) {
      event.preventDefault();
      const dropdown = dropdownToggle.closest('.nav-dropdown');
      const menu = dropdown ? dropdown.querySelector('.nav-dropdown-menu') : null;
      const allMenus = document.querySelectorAll('.nav-dropdown-menu');
      allMenus.forEach(m => {
        if (menu && m === menu) return;
        m.classList.remove('open');
        const toggle = m.closest('.nav-dropdown')?.querySelector('.nav-dropdown-toggle');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
      });
      if (menu) {
        const isOpen = menu.classList.toggle('open');
        dropdownToggle.setAttribute('aria-expanded', String(Boolean(isOpen)));
      }
      return;
    }

    const navLink = event.target.closest('a.nav-btn');
    if (navLink) {
      if (navLink.classList.contains('hidden')) return;
      const isPlainLeftClick = (event.button === undefined || event.button === 0) && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
      if (!isPlainLeftClick) return;

      const href = navLink.getAttribute('href') || '';
      const rawLabel = (navLink.textContent || '').replace(/\s+/g, ' ').trim();
      const target = navLink.getAttribute('data-target') || resolveTargetFromLabel(rawLabel);
      const route = href.startsWith('/') ? href : resolveRouteFromTarget(target);
      if (!route) return;

      if (target && !canViewTab(target)) {
        alert('Нет прав доступа к разделу');
        return;
      }

      event.preventDefault();
      navigateToPath(route);
      if (window.innerWidth <= 768) {
        closePrimaryNav();
      }
      return;
    }
  });
}

function setupCardsDropdownMenu() {
  if (cardsDropdownSetupDone) return;
  cardsDropdownSetupDone = true;

  const dropdowns = Array.from(document.querySelectorAll('.nav-dropdown'));
  if (!dropdowns.length) return;

  const closeMenu = (menu, toggle) => {
    if (menu) menu.classList.remove('open');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  };

  const closeAllMenus = () => {
    dropdowns.forEach(dropdown => {
      const menu = dropdown.querySelector('.nav-dropdown-menu');
      const toggle = dropdown.querySelector('.nav-dropdown-toggle');
      closeMenu(menu, toggle);
    });
  };

  const createMenuClickHandler = (menu, toggle) => (event) => {
    const isPlainLeftClick = (event.button === undefined || event.button === 0) && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
    if (!isPlainLeftClick) return;

    event.preventDefault();
    const route = event.currentTarget.getAttribute('data-route');
    closeMenu(menu, toggle);
    if (route) navigateToPath(route);
    if (window.innerWidth <= 768) closePrimaryNav();
  };

  dropdowns.forEach(dropdown => {
    const menu = dropdown.querySelector('.nav-dropdown-menu');
    const toggle = dropdown.querySelector('.nav-dropdown-toggle');
    if (!menu || !toggle) return;

    menu.querySelectorAll('[data-route]').forEach(item => {
      item.addEventListener('click', createMenuClickHandler(menu, toggle));
    });

    menu.addEventListener('auxclick', (event) => {
      const targetLink = event.target.closest('a[data-route]');
      if (event.button === 1 && targetLink) return;
    });
  });

  document.addEventListener('click', (event) => {
    if (event.target.closest('.nav-dropdown')) return;
    closeAllMenus();
  });
}

function setNavActiveByRoute(pathname = window.location.pathname) {
  const cleanPath = (pathname || '').split('?')[0].split('#')[0];
  let mainTarget = null;
  
  // Determine the main navigation button to highlight
  if (cleanPath.startsWith('/production')) {
    mainTarget = 'production';
  } else if (
    cleanPath.startsWith('/departments') ||
    cleanPath.startsWith('/operations') ||
    cleanPath.startsWith('/areas') ||
    cleanPath.startsWith('/employees') ||
    cleanPath.startsWith('/shift-times')
  ) {
    mainTarget = 'directories';
  } else if (
    cleanPath.startsWith('/cards') ||
    cleanPath.startsWith('/approvals') ||
    cleanPath.startsWith('/provision') ||
    cleanPath.startsWith('/input-control')
  ) {
    mainTarget = 'cards';
  } else {
    // Fallback for simple routes
    const pathSegment = cleanPath.split('/')[1];
    if (pathSegment) {
      mainTarget = pathSegment;
    } else {
      mainTarget = 'dashboard';
    }
  }

  // Update main navigation buttons
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.target === mainTarget);
  });

  // Update dropdown items
  document.querySelectorAll('.nav-dropdown-item').forEach(item => {
    const route = item.getAttribute('data-route');
    item.classList.toggle('active', route && route === cleanPath);
  });
}

function activateTab(target, options = {}) {
  const { replaceHistory = false } = options;
  const route = resolveRouteFromTarget(target);
  if (!route) return;
  navigateToPath(route, { replace: !!replaceHistory, soft: true });
}

function openDirectoryModal(options = {}) {
  const { pageMode = false, renderMode, mountEl = null, fromRestore = false } = options;
  const modal = document.getElementById('directory-modal');
  if (!modal) return;
  const mode = renderMode || (pageMode ? 'page' : 'modal');
  directoryRenderMode = mode;
  directoryPageMount = mode === 'page' ? mountEl : null;
  if (mode === 'page') {
    if (!mountEl) return;
    mountModalToPage(modal, 'directory', mountEl);
  } else {
    restoreModalToHome(modal, 'directory');
  }
  renderCentersTable();
  renderOpsTable();
  modal.classList.remove('hidden');
  if (mode === 'page') {
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
  const wasPageMode = directoryRenderMode === 'page' || modal.classList.contains('page-mode');
  restoreModalToHome(modal, 'directory');
  directoryRenderMode = 'modal';
  directoryPageMount = null;
  modal.classList.remove('page-mode');
  document.body.classList.remove('page-directory-mode');
  if (wasPageMode || silent) return;
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
  if (cardsTabsSetupDone) return;
  cardsTabsSetupDone = true;

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

// =================================================================================================
// ROUTER HELPERS
// =================================================================================================

const NAV_REPEAT_WINDOW_MS = 250;
let lastNavigation = { path: '', time: 0 };
let navigationBusy = false;
let pendingNavigation = null;

function navigateToPath(path, { replace = false, soft = false } = {}) {
  if (!path) return;
  const now = Date.now();
  if (path === lastNavigation.path && (now - lastNavigation.time) < NAV_REPEAT_WINDOW_MS) return;
  lastNavigation = { path, time: now };

  if (navigationBusy) {
    pendingNavigation = { path, replace, soft };
    return;
  }

  navigationBusy = true;
  try {
    if (typeof handleRoute === 'function') {
      handleRoute(path, { replace, fromHistory: false, soft });
    } else if (typeof navigateToRoute === 'function') {
      if (replace && typeof handleRoute === 'function') {
        handleRoute(path, { replace: true, fromHistory: false, soft });
      } else {
        navigateToRoute(path);
      }
    } else {
      const method = replace ? 'replaceState' : 'pushState';
      try {
        history[method]({}, '', path);
      } catch (err) {
        console.warn('History update failed', err);
      }
      if (typeof setNavActiveByRoute === 'function') setNavActiveByRoute(path);
    }
  } finally {
    navigationBusy = false;
    if (pendingNavigation) {
      const next = pendingNavigation;
      pendingNavigation = null;
      if (next.path && next.path !== path) {
        navigateToPath(next.path, next);
      }
    }
  }
}

// Legacy compatibility: keep old calls working
function navigateTo(path, options = {}) {
  navigateToPath(path, options);
}

function initNavigation() {
  setupNavigation();
  setupCardsDropdownMenu();
  setupCardsTabs();

  // Close modal windows with history.back()
  document.querySelector('#modal-receipt-close-btn')?.addEventListener('click', () => {
    history.back();
  });
  document.querySelector('#modal-card-route-close-btn')?.addEventListener('click', () => {
    history.back();
  });
}

function showModalReceipt(id) {
	const modal = document.getElementById('receipt-modal');
	if (!modal) return;
	modal.classList.remove('hidden');
	modal.querySelector('.receipt-id').textContent = id;
}

