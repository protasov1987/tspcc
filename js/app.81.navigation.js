// === НАВИГАЦИЯ ===
function setupNavigation() {
  const labelMap = {
    'Дашборд': 'dashboard',
    'МК': 'cards',
    'Трекер': 'workorders',
    'Архив': 'archive',
    'Рабочееместо': 'workspace',
    'Рабочее место': 'workspace',
    'Производство': 'production',
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
    if (route) navigateToRoute(route);
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
  } else if (target === 'approvals') {
    renderApprovalsTable();
  } else if (target === 'provision') {
    renderProvisionTable();
  } else if (target === 'input-control') {
    renderInputControlTable();
  } else if (target === 'departments') {
    renderDepartmentsPage();
  } else if (target === 'operations') {
    renderOperationsPage();
  } else if (target === 'areas') {
    renderAreasPage();
  } else if (target === 'employees') {
    renderEmployeesPage();
  } else if (target === 'shift-times') {
    renderProductionShiftTimesPage();
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
