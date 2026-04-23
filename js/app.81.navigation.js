// === НАВИГАЦИЯ ===
const NAV_LABEL_MAP = {
  'Дашборд': 'dashboard',
  'МК': 'cards',
  'Трекер': 'workorders',
  'Изделия': 'items',
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
  items: '/items',
  ok: '/ok',
  oc: '/oc',
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

function bindNavigationClickOnce(selector, datasetFlag, handler) {
  const el = document.querySelector(selector);
  if (!el) return false;
  if (el.dataset[datasetFlag] === 'true') return false;
  el.dataset[datasetFlag] = 'true';
  el.addEventListener('click', handler);
  return true;
}

function resolveTargetFromLabel(label) {
  const key = (label || '').replace(/\s+/g, ' ').trim();
  return NAV_LABEL_MAP[key] || null;
}

function resolveRouteFromTarget(target) {
  if (!target) return null;
  if (NAV_ROUTE_MAP[target]) return NAV_ROUTE_MAP[target];
  if (typeof getAccessTabConfig === 'function') {
    const accessTab = getAccessTabConfig(target);
    if (accessTab?.route) return accessTab.route;
  }
  return '/' + target;
}

function closeNavDropdownMenu(menu) {
  if (!menu) return;
  menu.classList.remove('open');
  const toggle = menu.closest('.nav-dropdown')?.querySelector('.nav-dropdown-toggle');
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
}

function closeAllNavDropdownMenus({ except = null } = {}) {
  document.querySelectorAll('.nav-dropdown-menu').forEach(menu => {
    if (except && menu === except) return;
    closeNavDropdownMenu(menu);
  });
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
      closeAllNavDropdownMenus({ except: menu });
      if (menu) {
        const isOpen = menu.classList.toggle('open');
        dropdownToggle.setAttribute('aria-expanded', String(Boolean(isOpen)));
      }
      return;
    }

    const dropdownItem = event.target.closest('a.nav-dropdown-item[data-route]');
    if (dropdownItem) {
      if (dropdownItem.classList.contains('hidden')) return;
      const isPlainLeftClick = (event.button === undefined || event.button === 0) && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
      if (!isPlainLeftClick) return;

      event.preventDefault();
      event.stopPropagation();
      const href = dropdownItem.getAttribute('href') || '';
      const routeFromData = dropdownItem.getAttribute('data-route') || '';
      const routePermission = typeof getAccessRoutePermission === 'function'
        ? getAccessRoutePermission(routeFromData || href)
        : null;
      const target = (dropdownItem.getAttribute('data-target') || '').trim() || routePermission?.key || '';
      const accessMode = routePermission?.access || 'view';
      const routeFromTarget = resolveRouteFromTarget(target);
      const route = routeFromData || (href.startsWith('/') ? href : '') || routeFromTarget;
      if (target && !canAccessTab(target, accessMode)) {
        closeAllNavDropdownMenus();
        alert('Нет прав доступа к разделу');
        return;
      }

      closeAllNavDropdownMenus();
      if (route) navigateToPath(route);
      if (isPhoneLayout()) closePrimaryNav();
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
      if (isPhoneLayout()) {
        closePrimaryNav();
      }
      return;
    }
  });
}

function setupCardsDropdownMenu() {
  if (cardsDropdownSetupDone) return;
  cardsDropdownSetupDone = true;

  document.addEventListener('click', (event) => {
    if (event.target.closest('.nav-dropdown')) return;
    closeAllNavDropdownMenus();
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
    cleanPath.startsWith('/card-route') ||
    cleanPath.startsWith('/approvals') ||
    cleanPath.startsWith('/provision') ||
    cleanPath.startsWith('/input-control') ||
    cleanPath.startsWith('/archive')
  ) {
    mainTarget = 'cards';
  } else if (
    cleanPath.startsWith('/items') ||
    cleanPath.startsWith('/ok') ||
    cleanPath.startsWith('/oc')
  ) {
    mainTarget = 'items-hub';
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
    const isActive = Boolean(
      route && (
        route === cleanPath ||
        (route === '/production/shifts' && cleanPath.startsWith('/production/shifts/')) ||
        (route === '/production/plan' && cleanPath.startsWith('/production/gantt/'))
      )
    );
    item.classList.toggle('active', isActive);
  });
}

function activateTab(target, options = {}) {
  const { replaceHistory = false } = options;
  const route = resolveRouteFromTarget(target);
  if (!route) return;
  navigateToPath(route, { replace: !!replaceHistory, soft: true });
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
  const listPanel = document.getElementById('cards-list-panel');
  if (listPanel) listPanel.classList.remove('hidden');
}

function focusWorkspaceSearch() {
  const input = document.getElementById('workspace-search');
  const shouldFocusWorkspaceSearch = typeof isDesktopLayout === 'function'
    ? isDesktopLayout()
    : !isPhoneLayout() && !isTabletLayout();
  if (input && shouldFocusWorkspaceSearch) {
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

  // Close modal windows with history.back()
  bindNavigationClickOnce('#modal-receipt-close-btn', 'boundHistoryBack', () => {
    history.back();
  });
  bindNavigationClickOnce('#modal-card-route-close-btn', 'boundHistoryBack', () => {
    history.back();
  });
}

function showModalReceipt(id) {
	const modal = document.getElementById('receipt-modal');
	if (!modal) return;
	modal.classList.remove('hidden');
	modal.querySelector('.receipt-id').textContent = id;
}
