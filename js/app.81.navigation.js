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

    const dropdownToggle = event.target.closest('button.nav-btn.nav-dropdown-toggle');
    if (dropdownToggle) {
      event.preventDefault();
      const menu = document.getElementById('nav-cards-menu');
      const isOpen = menu && menu.classList.toggle('open');
      dropdownToggle.setAttribute('aria-expanded', String(Boolean(isOpen)));
      return;
    }

    const navLink = event.target.closest('a.nav-btn');
    if (navLink) {
      if (navLink.classList.contains('hidden')) return;
      const isPlainLeftClick = (event.button === undefined || event.button === 0) && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
      if (!isPlainLeftClick) return;

      event.preventDefault();
      const rawLabel = (navLink.textContent || '').replace(/\s+/g, ' ').trim();
      const target = navLink.getAttribute('data-target') || labelMap[rawLabel];
      if (!target) return;

      if (!canViewTab(target)) {
        alert('Нет прав доступа к разделу');
        return;
      }

      navigateToRoute('/' + target);
      if (window.innerWidth <= 768) {
        closePrimaryNav();
      }
      return;
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

  const handleMenuClick = (event) => {
    const isPlainLeftClick = (event.button === undefined || event.button === 0) && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
    if (!isPlainLeftClick) return;

    event.preventDefault();
    const route = event.currentTarget.getAttribute('data-route');
    closeMenu();
    if (route) navigateToRoute(route);
    if (window.innerWidth <= 768) closePrimaryNav();
  };

  menu.querySelectorAll('[data-route]').forEach(item => {
    item.addEventListener('click', handleMenuClick);
  });

  menu.addEventListener('auxclick', (event) => {
    const targetLink = event.target.closest('a[data-route]');
    if (event.button === 1 && targetLink) return;
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

