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
  let rows = '';
  users.forEach(u => {
    const level = accessLevels.find(l => l.id === u.accessLevelId);
    rows += '<tr>' +
      '<td>' + escapeHtml(u.name || '') + '</td>' +
      '<td>' + escapeHtml(level ? level.name : 'Не задан') + '</td>' +
      '<td>' + (u.permissions && u.permissions.worker ? 'Да' : 'Нет') + '</td>' +
      '<td class="action-col">' +
        (canEditTab('users') ? '<button class="btn-secondary user-edit" data-id="' + u.id + '">Редактировать</button>' : '') +
        (canEditTab('users') && u.name !== 'Abyss' ? '<button class="btn-secondary user-delete" data-id="' + u.id + '">Удалить</button>' : '') +
      '</td>' +
    '</tr>';
  });
  container.innerHTML = '<table class="security-table"><thead><tr><th>Имя</th><th>Уровень</th><th>Рабочий</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';

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
      await loadSecurityData();
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
      '<td>' + escapeHtml(perms.landingTab || 'dashboard') + '</td>' +
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
  return ACCESS_TAB_CONFIG.map(tab => {
    const tabPerms = perms.tabs && perms.tabs[tab.key] ? perms.tabs[tab.key] : { view: true, edit: true };
    return '<div class="permission-card">' +
      '<h4>' + escapeHtml(tab.label) + '</h4>' +
      '<label class="toggle-row"><input type="checkbox" data-perm="view" data-tab="' + tab.key + '" ' + (tabPerms.view ? 'checked' : '') + '> Просмотр</label>' +
      '<label class="toggle-row"><input type="checkbox" data-perm="edit" data-tab="' + tab.key + '" ' + (tabPerms.edit ? 'checked' : '') + '> Изменение</label>' +
    '</div>';
  }).join('');
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
  document.getElementById('access-landing').value = level ? (level.permissions?.landingTab || 'dashboard') : 'dashboard';
  document.getElementById('access-timeout').value = level ? (level.permissions?.inactivityTimeoutMinutes || 30) : 30;
  document.getElementById('access-worker').checked = level ? !!level.permissions?.worker : false;
  const headProduction = document.getElementById('access-head-production');
  if (headProduction) headProduction.checked = level ? !!level.permissions?.headProduction : false;
  const headSkk = document.getElementById('access-head-skk');
  if (headSkk) headSkk.checked = level ? !!level.permissions?.headSKK : false;
  const deputyTechDirector = document.getElementById('access-deputy-tech-director');
  if (deputyTechDirector) deputyTechDirector.checked = level ? !!level.permissions?.deputyTechDirector : false;
  document.getElementById('access-permissions').innerHTML = buildPermissionGrid(level || {});
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
  await loadSecurityData();
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
    deputyTechDirector
  };
  checkboxEls.forEach(cb => {
    const tab = cb.getAttribute('data-tab');
    const perm = cb.getAttribute('data-perm');
    permissions.tabs[tab] = permissions.tabs[tab] || { view: false, edit: false };
    permissions.tabs[tab][perm] = cb.checked;
  });
  const payload = { id: id || undefined, name, description, permissions };
  const res = await apiFetch('/api/security/access-levels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    if (errorEl) errorEl.textContent = data.error || 'Ошибка сохранения';
    return;
  }
  await loadSecurityData();
  renderAccessLevelsTable();
  closeAccessLevelModal();
}

function setupSecurityControls() {
  const createUserBtn = document.getElementById('user-create');
  if (createUserBtn) {
    createUserBtn.addEventListener('click', () => openUserModal(null));
  }
  const createLevelBtn = document.getElementById('access-level-create');
  if (createLevelBtn) {
    createLevelBtn.addEventListener('click', () => openAccessLevelModal(null));
  }
  const userCancel = document.getElementById('user-cancel');
  if (userCancel) userCancel.addEventListener('click', () => closeUserModal());
  const accessCancel = document.getElementById('access-cancel');
  if (accessCancel) accessCancel.addEventListener('click', () => closeAccessLevelModal());
  const userForm = document.getElementById('user-form');
  if (userForm) {
    userForm.addEventListener('submit', async e => {
      e.preventDefault();
      await saveUserFromModal();
    });
  }
  const levelForm = document.getElementById('access-level-form');
  if (levelForm) {
    levelForm.addEventListener('submit', async e => {
      e.preventDefault();
      await saveAccessLevelFromModal();
    });
  }
  const userGenerate = document.getElementById('user-generate');
  if (userGenerate) {
    userGenerate.addEventListener('click', () => {
      const pwd = generatePassword();
      const input = document.getElementById('user-password');
      if (input) input.value = pwd;
    });
  }
  const passwordToggle = document.getElementById('user-password-visibility');
  if (passwordToggle) {
    passwordToggle.addEventListener('click', () => {
      const input = document.getElementById('user-password');
      if (!input) return;
      const isHidden = input.getAttribute('type') === 'password';
      input.setAttribute('type', isHidden ? 'text' : 'password');
      passwordToggle.setAttribute('aria-label', isHidden ? 'Скрыть пароль' : 'Показать пароль');
    });
  }
  const userBarcode = document.getElementById('user-barcode');
  if (userBarcode) {
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
