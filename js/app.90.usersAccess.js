let usersFilterTerm = '';
let usersSortKey = '';
let usersSortDir = 'asc';

function getUserLevelName(user) {
  const level = accessLevels.find(l => l.id === user?.accessLevelId);
  return level ? (level.name || '') : 'Не задан';
}

function getUserWorkerLabel(user) {
  return (user?.permissions && user.permissions.worker) ? 'Да' : 'Нет';
}

function buildUsersFiltersHtml() {
  return '<div class="cards-filters-row users-filters-row">' +
    '<label class="flex-col cards-search-field" for="users-filter-term">' +
      '<span class="cards-filter-label">Фильтр</span>' +
      '<input id="users-filter-term" type="text" value="' + escapeHtml(usersFilterTerm) + '" placeholder="Имя, ID, уровень или рабочий">' +
    '</label>' +
    '<div class="flex-col cards-reset-field">' +
      '<button class="btn-secondary" id="users-filter-clear" type="button">Сбросить</button>' +
    '</div>' +
  '</div>';
}

function getUsersTableHeaderHtml() {
  return '<thead><tr>' +
    '<th class="th-sortable" data-sort-key="name">Имя</th>' +
    '<th class="th-sortable" data-sort-key="id">ID</th>' +
    '<th class="th-sortable" data-sort-key="level">Уровень</th>' +
    '<th class="th-sortable" data-sort-key="worker">Рабочий</th>' +
    '<th></th>' +
  '</tr></thead>';
}

function getLevelPermissionState(permissions, tabKey) {
  const tabs = permissions?.tabs || {};
  let tabPerms = Object.prototype.hasOwnProperty.call(tabs, tabKey) ? tabs[tabKey] : null;
  if (!tabPerms && typeof getAccessLegacyPermissionKeys === 'function') {
    const legacyKeys = getAccessLegacyPermissionKeys(tabKey);
    for (const legacyKey of legacyKeys) {
      if (Object.prototype.hasOwnProperty.call(tabs, legacyKey)) {
        tabPerms = tabs[legacyKey];
        break;
      }
    }
  }
  return {
    view: tabPerms ? !!tabPerms.view : true,
    edit: tabPerms ? !!tabPerms.edit : true
  };
}

function renderAccessLandingOptions(selectedKey) {
  const select = document.getElementById('access-landing');
  if (!select) return;
  const options = (typeof getAccessLandingTabs === 'function' ? getAccessLandingTabs() : ACCESS_TAB_CONFIG)
    .map(tab => '<option value="' + escapeHtml(tab.key) + '">' + escapeHtml(tab.label) + '</option>')
    .join('');
  select.innerHTML = options;
  const normalized = typeof resolveAccessLandingKey === 'function'
    ? resolveAccessLandingKey(selectedKey)
    : (selectedKey || 'dashboard');
  select.value = normalized || 'dashboard';
}

function syncPermissionRowState(row) {
  const viewCheckbox = row.querySelector('input[data-perm="view"]');
  const editCheckbox = row.querySelector('input[data-perm="edit"]');
  if (!viewCheckbox || !editCheckbox) return;
  if (editCheckbox.checked) {
    viewCheckbox.checked = true;
  }
  editCheckbox.disabled = !viewCheckbox.checked;
}

function bindAccessPermissionGridControls(container) {
  if (!container) return;
  container.querySelectorAll('tbody tr').forEach(row => {
    const viewCheckbox = row.querySelector('input[data-perm="view"]');
    const editCheckbox = row.querySelector('input[data-perm="edit"]');
    if (!viewCheckbox || !editCheckbox) return;
    syncPermissionRowState(row);
    viewCheckbox.addEventListener('change', () => {
      if (!viewCheckbox.checked) {
        editCheckbox.checked = false;
      }
      syncPermissionRowState(row);
    });
    editCheckbox.addEventListener('change', () => {
      if (editCheckbox.checked) {
        viewCheckbox.checked = true;
      }
      syncPermissionRowState(row);
    });
  });
}

function restoreUsersFilterFocus(selectionStart = null, selectionEnd = null) {
  const termInput = document.getElementById('users-filter-term');
  if (!termInput) return;
  termInput.focus();
  if (selectionStart == null || selectionEnd == null) return;
  try {
    termInput.setSelectionRange(selectionStart, selectionEnd);
  } catch (e) {}
}

function bindUsersFilterControls(container) {
  const termInput = document.getElementById('users-filter-term');
  const clearBtn = document.getElementById('users-filter-clear');

  if (termInput) {
    termInput.addEventListener('input', () => {
      const selectionStart = termInput.selectionStart;
      const selectionEnd = termInput.selectionEnd;
      usersFilterTerm = termInput.value || '';
      renderUsersTable();
      restoreUsersFilterFocus(selectionStart, selectionEnd);
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      usersFilterTerm = '';
      renderUsersTable();
      restoreUsersFilterFocus(0, 0);
    });
  }

  container.querySelectorAll('th.th-sortable').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.getAttribute('data-sort-key') || '';
      if (!key) return;
      if (usersSortKey === key) {
        usersSortDir = usersSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        usersSortKey = key;
        usersSortDir = 'asc';
      }
      renderUsersTable();
    });
  });
}

// === ПОЛЬЗОВАТЕЛИ И УРОВНИ ДОСТУПА ===
function renderUsersTable() {
  const container = document.getElementById('users-table');
  const createBtn = document.getElementById('user-create');
  if (!container) return;
  if (!canViewTab('users')) {
    container.innerHTML = '<p>Нет прав для просмотра пользователей.</p>';
    return;
  }
  if (createBtn) createBtn.disabled = !canEditTab('users');
  renderUserDatalist();
  const termFilter = normalizeSortText(usersFilterTerm);
  let visibleUsers = users.filter(u => {
    const userName = normalizeSortText(u?.name || '');
    const userId = normalizeSortText(u?.id || '');
    const levelName = normalizeSortText(getUserLevelName(u));
    const workerLabel = normalizeSortText(getUserWorkerLabel(u));
    return !termFilter
      || userName.includes(termFilter)
      || userId.includes(termFilter)
      || levelName.includes(termFilter)
      || workerLabel.includes(termFilter);
  });

  if (usersSortKey === 'name') {
    visibleUsers = sortCardsByKey(visibleUsers, 'name', usersSortDir, user => user?.name || '');
  } else if (usersSortKey === 'id') {
    visibleUsers = sortCardsByKey(visibleUsers, 'id', usersSortDir, user => user?.id || '');
  } else if (usersSortKey === 'level') {
    visibleUsers = sortCardsByKey(visibleUsers, 'level', usersSortDir, user => getUserLevelName(user));
  } else if (usersSortKey === 'worker') {
    visibleUsers = sortCardsByKey(visibleUsers, 'worker', usersSortDir, user => getUserWorkerLabel(user));
  }

  let rows = '';
  visibleUsers.forEach(u => {
    const levelName = getUserLevelName(u);
    rows += '<tr>' +
      '<td>' + escapeHtml(u.name || '') + '</td>' +
      '<td>' + escapeHtml(u.id || '') + '</td>' +
      '<td>' + escapeHtml(levelName) + '</td>' +
      '<td>' + getUserWorkerLabel(u) + '</td>' +
      '<td class="action-col">' +
        (canEditTab('users') ? '<button class="btn-secondary user-edit" data-id="' + u.id + '">Редактировать</button>' : '') +
        (canEditTab('users') && u.name !== 'Abyss' ? '<button class="btn-small btn-delete user-delete" data-id="' + u.id + '">🗑️</button>' : '') +
      '</td>' +
    '</tr>';
  });
  if (!visibleUsers.length) {
    container.innerHTML = buildUsersFiltersHtml() + '<p>Пользователи по заданным фильтрам не найдены.</p>';
    bindUsersFilterControls(container);
    return;
  }

  container.innerHTML = buildUsersFiltersHtml() + '<table class="security-table">' + getUsersTableHeaderHtml() + '<tbody>' + rows + '</tbody></table>';
  updateTableSortUI(container, usersSortKey, usersSortDir);
  bindUsersFilterControls(container);

  container.querySelectorAll('.user-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      openUserModal(users.find(u => u.id === id) || null);
    });
  });
  container.querySelectorAll('.user-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      if (!confirm('Удалить пользователя?')) return;
      await apiFetch('/api/security/users/' + id, { method: 'DELETE' });
      await loadSecurityData({ force: true });
      renderUsersTable();
    });
  });

}

function renderAccessLevelsTable() {
  const container = document.getElementById('access-levels-table');
  const createBtn = document.getElementById('access-level-create');
  if (!container) return;
  if (!canViewTab('accessLevels')) {
    container.innerHTML = '<p>Нет прав для просмотра уровней доступа.</p>';
    return;
  }
  if (createBtn) createBtn.disabled = !canEditTab('accessLevels');
  let rows = '';
  accessLevels.forEach(level => {
    const perms = level.permissions || {};
    rows += '<tr>' +
      '<td>' + escapeHtml(level.name || '') + '</td>' +
      '<td>' + escapeHtml(level.description || '') + '</td>' +
      '<td>' + escapeHtml(typeof getAccessTabLabel === 'function' ? getAccessTabLabel(resolveAccessLandingKey(perms.landingTab || 'dashboard')) : (perms.landingTab || 'dashboard')) + '</td>' +
      '<td>' + (perms.worker ? 'Да' : 'Нет') + '</td>' +
      '<td class="action-col">' + (canEditTab('accessLevels') ? '<button class="btn-secondary access-edit" data-id="' + level.id + '">Настроить</button>' : '') + '</td>' +
    '</tr>';
  });
  container.innerHTML = '<table class="security-table"><thead><tr><th>Название</th><th>Описание</th><th>Стартовая вкладка</th><th>Рабочий</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';

  container.querySelectorAll('.access-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const level = accessLevels.find(l => l.id === id) || null;
      openAccessLevelModal(level);
    });
  });
}

function buildPermissionGrid(level = {}) {
  const perms = level.permissions || {};
  const rows = ACCESS_TAB_CONFIG.map(tab => {
    const tabPerms = getLevelPermissionState(perms, tab.key);
    return '<tr>' +
      '<td>' + escapeHtml(tab.label) + '</td>' +
      '<td class="permissions-table-check">' +
        '<input type="checkbox" data-perm="view" data-tab="' + tab.key + '" ' + (tabPerms.view ? 'checked' : '') + '>' +
      '</td>' +
      '<td class="permissions-table-check">' +
        '<input type="checkbox" data-perm="edit" data-tab="' + tab.key + '" ' + (tabPerms.edit ? 'checked' : '') + '>' +
      '</td>' +
    '</tr>';
  }).join('');
  return '<table class="security-table permissions-table">' +
    '<thead><tr><th>Страница</th><th>Просмотр</th><th>Изменения</th></tr></thead>' +
    '<tbody>' + rows + '</tbody>' +
  '</table>';
}

function openUserModal(user) {
  const modal = document.getElementById('user-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  document.getElementById('user-id').value = user ? user.id : '';
  document.getElementById('user-name').value = user ? user.name || '' : '';
  const pwdInput = document.getElementById('user-password');
  if (pwdInput) {
    pwdInput.setAttribute('type', 'password');
    const resolvedPassword = resolveUserPassword(user);
    pwdInput.value = resolvedPassword;
    pwdInput.dataset.initialPassword = resolvedPassword || '';
  }
  const select = document.getElementById('user-access-level');
  if (select) {
    select.innerHTML = accessLevels.map(l => '<option value="' + l.id + '">' + escapeHtml(l.name || '') + '</option>').join('');
    select.value = user ? user.accessLevelId : (accessLevels[0] ? accessLevels[0].id : '');
  }
}

function openAccessLevelModal(level) {
  const modal = document.getElementById('access-level-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  document.getElementById('access-level-id').value = level ? level.id : '';
  document.getElementById('access-level-name').value = level ? level.name || '' : '';
  document.getElementById('access-level-desc').value = level ? level.description || '' : '';
  renderAccessLandingOptions(level ? (level.permissions?.landingTab || 'dashboard') : 'dashboard');
  document.getElementById('access-timeout').value = level ? (level.permissions?.inactivityTimeoutMinutes || 30) : 30;
  document.getElementById('access-worker').checked = level ? !!level.permissions?.worker : false;
  const headProduction = document.getElementById('access-head-production');
  if (headProduction) headProduction.checked = level ? !!level.permissions?.headProduction : false;
  const headSkk = document.getElementById('access-head-skk');
  if (headSkk) headSkk.checked = level ? !!level.permissions?.headSKK : false;
  const skkWorker = document.getElementById('access-skk-worker');
  if (skkWorker) skkWorker.checked = level ? !!level.permissions?.skkWorker : false;
  const labWorker = document.getElementById('access-lab-worker');
  if (labWorker) labWorker.checked = level ? !!level.permissions?.labWorker : false;
  const warehouseWorker = document.getElementById('access-warehouse-worker');
  if (warehouseWorker) warehouseWorker.checked = level ? !!level.permissions?.warehouseWorker : false;
  const deputyTechDirector = document.getElementById('access-deputy-tech-director');
  if (deputyTechDirector) deputyTechDirector.checked = level ? !!level.permissions?.deputyTechDirector : false;
  const permissionsContainer = document.getElementById('access-permissions');
  if (permissionsContainer) {
    permissionsContainer.innerHTML = buildPermissionGrid(level || {});
    bindAccessPermissionGridControls(permissionsContainer);
  }
}

function renderUserDatalist() {
  let list = document.getElementById(USER_DATALIST_ID);
  if (!list) {
    list = document.createElement('datalist');
    list.id = USER_DATALIST_ID;
    document.body.appendChild(list);
  }
  const filteredUsers = getEligibleExecutorUsers();
  list.innerHTML = filteredUsers.map(u => '<option value="' + escapeHtml(u.name || '') + '"></option>').join('');
}

function closeUserModal() {
  const modal = document.getElementById('user-modal');
  if (modal) modal.classList.add('hidden');
}

function closeAccessLevelModal() {
  const modal = document.getElementById('access-level-modal');
  if (modal) modal.classList.add('hidden');
}

async function saveUserFromModal() {
  const id = document.getElementById('user-id').value;
  const name = document.getElementById('user-name').value;
  const passwordInput = document.getElementById('user-password');
  const initialPassword = passwordInput ? (passwordInput.dataset.initialPassword || '') : '';
  const password = passwordInput ? passwordInput.value.trim() : '';
  const accessLevelId = document.getElementById('user-access-level').value;
  const errorEl = document.getElementById('user-error');
  if (errorEl) { errorEl.textContent = ''; }
  const passwordChanged = !!password && password !== initialPassword;
  const payload = { name, password: passwordChanged ? password : undefined, accessLevelId, status: 'active' };
  const method = id ? 'PUT' : 'POST';
  const url = id ? '/api/security/users/' + id : '/api/security/users';
  const res = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    if (errorEl) errorEl.textContent = data.error || 'Ошибка сохранения';
    return;
  }
  await loadSecurityData({ force: true });
  const updatedUser = id ? users.find(u => u.id === id) : users.find(u => (u.name || '') === name);
  const effectivePassword = passwordChanged ? password : (initialPassword || resolveUserPassword(updatedUser));
  if (updatedUser && effectivePassword) {
    rememberUserPassword(updatedUser.id, effectivePassword);
  }
  renderUsersTable();
  closeUserModal();
}

async function saveAccessLevelFromModal() {
  const id = document.getElementById('access-level-id').value;
  const name = document.getElementById('access-level-name').value;
  const description = document.getElementById('access-level-desc').value;
  const landingTab = document.getElementById('access-landing').value;
  const timeout = parseInt(document.getElementById('access-timeout').value, 10) || 30;
  const worker = document.getElementById('access-worker').checked;
  const headProduction = document.getElementById('access-head-production').checked;
  const headSkk = document.getElementById('access-head-skk').checked;
  const skkWorker = document.getElementById('access-skk-worker').checked;
  const labWorker = document.getElementById('access-lab-worker').checked;
  const warehouseWorker = document.getElementById('access-warehouse-worker').checked;
  const deputyTechDirector = document.getElementById('access-deputy-tech-director').checked;
  const errorEl = document.getElementById('access-error');
  const checkboxEls = document.querySelectorAll('#access-permissions input[type="checkbox"]');
  const permissions = {
    tabs: {},
    attachments: { upload: true, remove: true },
    landingTab,
    inactivityTimeoutMinutes: timeout,
    worker,
    headProduction,
    headSKK: headSkk,
    skkWorker,
    labWorker,
    warehouseWorker,
    deputyTechDirector
  };
  checkboxEls.forEach(cb => {
    const tab = cb.getAttribute('data-tab');
    const perm = cb.getAttribute('data-perm');
    permissions.tabs[tab] = permissions.tabs[tab] || { view: false, edit: false };
    permissions.tabs[tab][perm] = cb.checked;
  });
  Object.keys(permissions.tabs).forEach(tab => {
    if (permissions.tabs[tab].edit) {
      permissions.tabs[tab].view = true;
    }
  });
  const payload = { id: id || undefined, name, description, permissions };
  const res = await apiFetch('/api/security/access-levels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    if (errorEl) errorEl.textContent = data.error || 'Ошибка сохранения';
    return;
  }
  await loadSecurityData({ force: true });
  renderAccessLevelsTable();
  closeAccessLevelModal();
}

function setupSecurityControls() {
  const createUserBtn = document.getElementById('user-create');
  if (createUserBtn && createUserBtn.dataset.bound !== 'true') {
    createUserBtn.dataset.bound = 'true';
    createUserBtn.addEventListener('click', () => openUserModal(null));
  }
  const createLevelBtn = document.getElementById('access-level-create');
  if (createLevelBtn && createLevelBtn.dataset.bound !== 'true') {
    createLevelBtn.dataset.bound = 'true';
    createLevelBtn.addEventListener('click', () => openAccessLevelModal(null));
  }
  const userCancel = document.getElementById('user-cancel');
  if (userCancel && userCancel.dataset.bound !== 'true') {
    userCancel.dataset.bound = 'true';
    userCancel.addEventListener('click', () => closeUserModal());
  }
  const accessCancel = document.getElementById('access-cancel');
  if (accessCancel && accessCancel.dataset.bound !== 'true') {
    accessCancel.dataset.bound = 'true';
    accessCancel.addEventListener('click', () => closeAccessLevelModal());
  }
  const userForm = document.getElementById('user-form');
  if (userForm && userForm.dataset.bound !== 'true') {
    userForm.dataset.bound = 'true';
    userForm.addEventListener('submit', async e => {
      e.preventDefault();
      await saveUserFromModal();
    });
  }
  const levelForm = document.getElementById('access-level-form');
  if (levelForm && levelForm.dataset.bound !== 'true') {
    levelForm.dataset.bound = 'true';
    levelForm.addEventListener('submit', async e => {
      e.preventDefault();
      await saveAccessLevelFromModal();
    });
  }
  const userGenerate = document.getElementById('user-generate');
  if (userGenerate && userGenerate.dataset.bound !== 'true') {
    userGenerate.dataset.bound = 'true';
    userGenerate.addEventListener('click', () => {
      const pwd = generatePassword();
      const input = document.getElementById('user-password');
      if (input) input.value = pwd;
    });
  }
  const passwordToggle = document.getElementById('user-password-visibility');
  if (passwordToggle && passwordToggle.dataset.bound !== 'true') {
    passwordToggle.dataset.bound = 'true';
    passwordToggle.addEventListener('click', () => {
      const input = document.getElementById('user-password');
      if (!input) return;
      const isHidden = input.getAttribute('type') === 'password';
      input.setAttribute('type', isHidden ? 'text' : 'password');
      passwordToggle.setAttribute('aria-label', isHidden ? 'Скрыть пароль' : 'Показать пароль');
    });
  }
  const userBarcode = document.getElementById('user-barcode');
  if (userBarcode && userBarcode.dataset.bound !== 'true') {
    userBarcode.dataset.bound = 'true';
    userBarcode.addEventListener('click', () => {
      const input = document.getElementById('user-password');
      const nameInput = document.getElementById('user-name');
      const idInput = document.getElementById('user-id');
      const pwd = input ? input.value : '';
      const username = nameInput ? nameInput.value : '';
      const userId = idInput ? idInput.value : '';
      if (!pwd) { alert('Введите или сгенерируйте пароль'); return; }
      openPasswordBarcode(pwd, username, userId);
    });
  }
}
