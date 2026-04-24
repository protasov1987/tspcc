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

function isSecurityUserAbyss(user) {
  const name = String(user?.name || user?.username || '').trim().toLowerCase();
  const login = String(user?.login || '').trim().toLowerCase();
  return name === 'abyss' || login === 'abyss';
}

function getSecurityUserEntityRev(user) {
  const rev = Number(user?.rev);
  return Number.isFinite(rev) && rev > 0 ? Math.floor(rev) : 1;
}

function getSecurityAccessLevelEntityRev(level) {
  const rev = Number(level?.rev);
  return Number.isFinite(rev) && rev > 0 ? Math.floor(rev) : 1;
}

function findSecurityUserById(userId = '') {
  const normalizedId = String(userId || '').trim();
  if (!normalizedId) return null;
  return (users || []).find(user => String(user?.id || '').trim() === normalizedId) || null;
}

function findSecurityAccessLevelById(accessLevelId = '') {
  const normalizedId = String(accessLevelId || '').trim();
  if (!normalizedId) return null;
  return (accessLevels || []).find(level => String(level?.id || '').trim() === normalizedId) || null;
}

function hasSecurityAccessLevel(accessLevelId = '') {
  const normalizedId = String(accessLevelId || '').trim();
  if (!normalizedId) return false;
  return (accessLevels || []).some(level => String(level?.id || '').trim() === normalizedId);
}

function getSecurityRouteContext() {
  return typeof captureClientWriteRouteContext === 'function'
    ? captureClientWriteRouteContext()
    : { fullPath: (window.location.pathname + window.location.search) || '/users' };
}

function setUserModalError(message = '') {
  const errorEl = document.getElementById('user-error');
  if (errorEl) {
    errorEl.textContent = String(message || '').trim();
  }
}

function setAccessLevelModalError(message = '') {
  const errorEl = document.getElementById('access-error');
  if (errorEl) {
    errorEl.textContent = String(message || '').trim();
  }
}

function applyUserModalReadonlyState(user = null) {
  const isAbyss = isSecurityUserAbyss(user);
  const nameInput = document.getElementById('user-name');
  const accessLevelSelect = document.getElementById('user-access-level');
  if (nameInput) {
    nameInput.readOnly = isAbyss;
  }
  if (accessLevelSelect) {
    accessLevelSelect.disabled = isAbyss;
  }
}

function renderSecurityViews() {
  if (typeof renderUsersTable === 'function') {
    renderUsersTable();
  }
  if (typeof renderAccessLevelsTable === 'function') {
    renderAccessLevelsTable();
  }
}

async function refreshSecurityUiState() {
  await loadSecurityData({ force: true });
  renderSecurityViews();
}

async function refreshSecurityRouteAfterRejected({
  action = 'security-user',
  routeContext = null
} = {}) {
  if (typeof refreshSecurityMutationAfterConflict === 'function') {
    await refreshSecurityMutationAfterConflict({
      routeContext,
      reason: action,
      guardKey: `securityConflict:${action}`
    });
    return;
  }
  await refreshSecurityUiState();
}

async function runSecurityUserWriteAction({
  action = 'security-user',
  writePath = '',
  userId = '',
  expectedRev = null,
  request,
  defaultErrorMessage = 'Не удалось выполнить действие с пользователем.',
  defaultConflictMessage = 'Пользователь уже был изменён другим пользователем. Данные обновлены.',
  onSuccess = null,
  afterConflictRefresh = null,
  onError = null
} = {}) {
  const routeContext = getSecurityRouteContext();
  return runClientWriteRequest({
    action,
    writePath,
    entity: 'security.user',
    entityId: userId,
    expectedRev,
    routeContext,
    request,
    defaultErrorMessage,
    defaultConflictMessage,
    onSuccess: async ({ payload, routeContext: successRouteContext }) => {
      if (typeof applySecuritySlicePayload === 'function') {
        applySecuritySlicePayload(payload);
      }
      renderSecurityViews();
      if (typeof onSuccess === 'function') {
        await onSuccess({ payload, routeContext: successRouteContext });
      }
    },
    onConflict: async ({ payload }) => {
      if (typeof applySecuritySlicePayload === 'function') {
        applySecuritySlicePayload(payload);
      }
      renderSecurityViews();
    },
    conflictRefresh: async ({ payload, message, routeContext: conflictRouteContext }) => {
      await refreshSecurityRouteAfterRejected({
        action,
        routeContext: conflictRouteContext
      });
      if (typeof afterConflictRefresh === 'function') {
        await afterConflictRefresh({
          payload,
          message,
          routeContext: conflictRouteContext
        });
      }
    },
    onError: async ({ res, payload, message, routeContext: errorRouteContext }) => {
      if (typeof applySecuritySlicePayload === 'function') {
        applySecuritySlicePayload(payload);
      }
      renderSecurityViews();
      if (res?.status === 404) {
        await refreshSecurityRouteAfterRejected({
          action: `${action}:not-found`,
          routeContext: errorRouteContext
        });
      }
      if (typeof onError === 'function') {
        await onError({
          res,
          payload,
          message,
          routeContext: errorRouteContext
        });
      }
    }
  });
}

async function runSecurityAccessLevelWriteAction({
  action = 'security-access-level',
  accessLevelId = '',
  expectedRev = null,
  request,
  defaultErrorMessage = 'Не удалось выполнить действие с уровнем доступа.',
  defaultConflictMessage = 'Уровень доступа уже был изменён другим пользователем. Данные обновлены.',
  onSuccess = null,
  afterConflictRefresh = null,
  onError = null
} = {}) {
  const routeContext = getSecurityRouteContext();
  return runClientWriteRequest({
    action,
    writePath: '/api/security/access-levels',
    entity: 'security.access-level',
    entityId: accessLevelId,
    expectedRev,
    routeContext,
    request,
    defaultErrorMessage,
    defaultConflictMessage,
    onSuccess: async ({ payload, routeContext: successRouteContext }) => {
      if (typeof applySecuritySlicePayload === 'function') {
        applySecuritySlicePayload(payload);
      }
      renderSecurityViews();
      if (typeof onSuccess === 'function') {
        await onSuccess({ payload, routeContext: successRouteContext });
      }
    },
    onConflict: async ({ payload }) => {
      if (typeof applySecuritySlicePayload === 'function') {
        applySecuritySlicePayload(payload);
      }
      renderSecurityViews();
    },
    conflictRefresh: async ({ payload, message, routeContext: conflictRouteContext }) => {
      await refreshSecurityRouteAfterRejected({
        action,
        routeContext: conflictRouteContext
      });
      if (typeof afterConflictRefresh === 'function') {
        await afterConflictRefresh({
          payload,
          message,
          routeContext: conflictRouteContext
        });
      }
    },
    onError: async ({ res, payload, message, routeContext: errorRouteContext }) => {
      if (typeof applySecuritySlicePayload === 'function') {
        applySecuritySlicePayload(payload);
      }
      renderSecurityViews();
      if (res?.status === 404) {
        await refreshSecurityRouteAfterRejected({
          action: `${action}:not-found`,
          routeContext: errorRouteContext
        });
      }
      if (typeof onError === 'function') {
        await onError({
          res,
          payload,
          message,
          routeContext: errorRouteContext
        });
      }
    }
  });
}

function resolveUserModalLocalInvalidState({
  userId = '',
  expectedRev = null,
  name = '',
  accessLevelId = ''
} = {}) {
  const currentUser = userId ? findSecurityUserById(userId) : null;
  const requestedName = String(name || '').trim();
  const requestedAbyss = isSecurityUserAbyss({ name: requestedName });

  if (userId && !currentUser) {
    return {
      reason: 'user-missing',
      message: 'Пользователь уже недоступен. Данные обновлены.',
      actualRev: null,
      reopenUserId: ''
    };
  }

  if (currentUser) {
    const actualRev = getSecurityUserEntityRev(currentUser);
    if (Number.isFinite(Number(expectedRev)) && actualRev !== Number(expectedRev)) {
      return {
        reason: 'stale-revision',
        message: 'Пользователь уже был изменён другим пользователем. Данные обновлены.',
        actualRev,
        reopenUserId: currentUser.id
      };
    }
    if (isSecurityUserAbyss(currentUser) && requestedName && requestedName !== 'Abyss') {
      return {
        reason: 'abyss-name-locked',
        message: 'Нельзя переименовать системного администратора.',
        actualRev,
        reopenUserId: currentUser.id
      };
    }
    if (!isSecurityUserAbyss(currentUser) && requestedAbyss) {
      return {
        reason: 'abyss-name-reserved',
        message: 'Имя системного администратора зарезервировано.',
        actualRev,
        reopenUserId: currentUser.id
      };
    }
    if (isSecurityUserAbyss(currentUser) && accessLevelId && accessLevelId !== 'level_admin') {
      return {
        reason: 'abyss-access-level-locked',
        message: 'Нельзя изменить уровень доступа системного администратора.',
        actualRev,
        reopenUserId: currentUser.id
      };
    }
  } else if (requestedAbyss) {
    return {
      reason: 'abyss-name-reserved',
      message: 'Имя системного администратора зарезервировано.',
      actualRev: null,
      reopenUserId: ''
    };
  }

  if (accessLevelId && !hasSecurityAccessLevel(accessLevelId)) {
    return {
      reason: 'access-level-missing',
      message: 'Уровень доступа уже недоступен. Данные обновлены.',
      actualRev: currentUser ? getSecurityUserEntityRev(currentUser) : null,
      reopenUserId: currentUser?.id || ''
    };
  }

  return null;
}

function resolveAccessLevelModalLocalInvalidState({
  accessLevelId = '',
  expectedRev = null
} = {}) {
  if (!accessLevelId) return null;
  const currentLevel = findSecurityAccessLevelById(accessLevelId);
  if (!currentLevel) {
    return {
      reason: 'access-level-missing',
      message: 'Уровень доступа уже недоступен. Данные обновлены.',
      actualRev: null,
      reopenAccessLevelId: ''
    };
  }
  const actualRev = getSecurityAccessLevelEntityRev(currentLevel);
  if (Number.isFinite(Number(expectedRev)) && actualRev !== Number(expectedRev)) {
    return {
      reason: 'stale-revision',
      message: 'Уровень доступа уже был изменён другим пользователем. Данные обновлены.',
      actualRev,
      reopenAccessLevelId: currentLevel.id
    };
  }
  return null;
}

async function handleUserModalLocalInvalidState({
  action = 'security-user:update',
  userId = '',
  expectedRev = null,
  actualRev = null,
  message = 'Пользователь уже был изменён другим пользователем. Данные обновлены.',
  reason = 'security-user-local-invalid-state',
  reopenUserId = ''
} = {}) {
  const routeContext = getSecurityRouteContext();
  console.warn('[CONFLICT] security user local invalid state', {
    action,
    userId: String(userId || '').trim() || null,
    route: routeContext?.fullPath || null,
    expectedRevAtOpen: Number.isFinite(Number(expectedRev)) ? Number(expectedRev) : null,
    actualRev: Number.isFinite(Number(actualRev)) ? Number(actualRev) : null,
    noRequest: true,
    reason
  });

  await refreshSecurityRouteAfterRejected({
    action: `${action}:local-invalid`,
    routeContext
  });

  const freshUser = reopenUserId ? findSecurityUserById(reopenUserId) : null;
  if (freshUser) {
    openUserModal(freshUser, { errorMessage: message });
  } else {
    closeUserModal();
  }
  if (typeof showToast === 'function') {
    showToast(message || 'Данные пользователя уже изменены. Данные обновлены.');
  }
  return {
    ok: false,
    isLocalInvalidState: true,
    routeContext
  };
}

async function handleAccessLevelModalLocalInvalidState({
  action = 'security-access-level:update',
  accessLevelId = '',
  expectedRev = null,
  actualRev = null,
  message = 'Уровень доступа уже был изменён другим пользователем. Данные обновлены.',
  reason = 'security-access-level-local-invalid-state',
  reopenAccessLevelId = ''
} = {}) {
  const routeContext = getSecurityRouteContext();
  console.warn('[CONFLICT] security access-level local invalid state', {
    action,
    accessLevelId: String(accessLevelId || '').trim() || null,
    route: routeContext?.fullPath || null,
    expectedRevAtOpen: Number.isFinite(Number(expectedRev)) ? Number(expectedRev) : null,
    actualRev: Number.isFinite(Number(actualRev)) ? Number(actualRev) : null,
    noRequest: true,
    reason
  });

  await refreshSecurityRouteAfterRejected({
    action: `${action}:local-invalid`,
    routeContext
  });

  const freshLevel = reopenAccessLevelId ? findSecurityAccessLevelById(reopenAccessLevelId) : null;
  if (freshLevel) {
    openAccessLevelModal(freshLevel, { errorMessage: message });
  } else {
    closeAccessLevelModal();
  }
  if (typeof showToast === 'function') {
    showToast(message || 'Данные уровня доступа уже изменены. Данные обновлены.');
  }
  return {
    ok: false,
    isLocalInvalidState: true,
    routeContext
  };
}

function buildUserDeleteConfirmMessage(user) {
  const safeName = String(user?.name || user?.id || 'Пользователь').trim() || 'Пользователь';
  return 'Пользователь «' + safeName + '» будет удалён без возможности восстановления.';
}

function openUserDeleteConfirm(user) {
  if (!user || !user.id) return;
  const expectedRev = getSecurityUserEntityRev(user);
  if (typeof openDeleteConfirm === 'function') {
    openDeleteConfirm({
      id: user.id,
      message: buildUserDeleteConfirmMessage(user),
      hint: 'Нажмите «Удалить», чтобы убрать пользователя из системы. «Отменить» закроет окно без удаления.',
      expectedRev,
      onConfirm: async () => {
        const currentUser = findSecurityUserById(user.id);
        const localInvalid = resolveUserModalLocalInvalidState({
          userId: user.id,
          expectedRev,
          name: currentUser?.name || user.name || '',
          accessLevelId: currentUser?.accessLevelId || user.accessLevelId || ''
        });
        if (localInvalid) {
          await handleUserModalLocalInvalidState({
            action: 'security-user:delete',
            userId: user.id,
            expectedRev,
            actualRev: localInvalid.actualRev,
            message: localInvalid.message || 'Пользователь уже был изменён другим пользователем. Данные обновлены.',
            reason: localInvalid.reason || 'security-user-delete-local-invalid',
            reopenUserId: ''
          });
          return;
        }

        const result = await runSecurityUserWriteAction({
          action: 'security-user:delete',
          writePath: '/api/security/users/' + encodeURIComponent(String(user.id || '').trim()),
          userId: user.id,
          expectedRev,
          request: () => apiFetch('/api/security/users/' + encodeURIComponent(String(user.id || '').trim()), {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expectedRev })
          }),
          defaultErrorMessage: 'Не удалось удалить пользователя.',
          defaultConflictMessage: 'Пользователь уже был изменён другим пользователем. Данные обновлены.',
          afterConflictRefresh: async ({ message }) => {
            if (typeof showToast === 'function') {
              showToast(message || 'Пользователь уже был изменён другим пользователем. Данные обновлены.');
            }
          },
          onError: async ({ message }) => {
            if (typeof showToast === 'function') {
              showToast(message || 'Не удалось удалить пользователя.');
            }
          }
        });
        if (result?.isConflict && typeof showToast === 'function') {
          showToast(result.message || 'Пользователь уже был изменён другим пользователем. Данные обновлены.');
        }
      }
    });
    return;
  }

  if (!confirm('Удалить пользователя?')) return;
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
    viewCheckbox.checked = false;
    return;
  }
  if (viewCheckbox.checked) {
    editCheckbox.checked = false;
  }
}

function bindAccessPermissionGridControls(container) {
  if (!container) return;
  container.querySelectorAll('tbody tr').forEach(row => {
    const viewCheckbox = row.querySelector('input[data-perm="view"]');
    const editCheckbox = row.querySelector('input[data-perm="edit"]');
    if (!viewCheckbox || !editCheckbox) return;
    syncPermissionRowState(row);
    viewCheckbox.addEventListener('change', () => {
      if (viewCheckbox.checked) {
        editCheckbox.checked = false;
      }
      syncPermissionRowState(row);
    });
    editCheckbox.addEventListener('change', () => {
      if (editCheckbox.checked) {
        viewCheckbox.checked = false;
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
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const targetUser = users.find(user => user && user.id === id) || null;
      openUserDeleteConfirm(targetUser);
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

  if (createBtn && createBtn.dataset.bound !== 'true') {
    createBtn.dataset.bound = 'true';
    createBtn.addEventListener('click', () => openAccessLevelModal(null));
  }
}

function buildPermissionGrid(level = {}) {
  const perms = level.permissions || {};
  const rows = ACCESS_TAB_CONFIG.map(tab => {
    const tabPerms = getLevelPermissionState(perms, tab.key);
    const viewChecked = tabPerms.view && !tabPerms.edit;
    const editChecked = !!tabPerms.edit;
    return '<tr>' +
      '<td>' + escapeHtml(tab.label) + '</td>' +
      '<td class="permissions-table-check">' +
        '<input type="checkbox" data-perm="view" data-tab="' + tab.key + '" ' + (viewChecked ? 'checked' : '') + '>' +
      '</td>' +
      '<td class="permissions-table-check">' +
        '<input type="checkbox" data-perm="edit" data-tab="' + tab.key + '" ' + (editChecked ? 'checked' : '') + '>' +
      '</td>' +
    '</tr>';
  }).join('');
  return '<table class="security-table permissions-table">' +
    '<thead><tr><th>Страница</th><th>Просмотр</th><th>Изменения</th></tr></thead>' +
    '<tbody>' + rows + '</tbody>' +
  '</table>';
}

function openUserModal(user, { errorMessage = '' } = {}) {
  const modal = document.getElementById('user-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.dataset.userId = user ? user.id : '';
  const idInput = document.getElementById('user-id');
  if (idInput) {
    idInput.value = user ? user.id : '';
    idInput.dataset.expectedRev = user ? String(getSecurityUserEntityRev(user)) : '';
  }
  const nameInput = document.getElementById('user-name');
  if (nameInput) {
    nameInput.value = user ? user.name || '' : '';
  }
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
  applyUserModalReadonlyState(user);
  setUserModalError(errorMessage);
}

function openAccessLevelModal(level, { errorMessage = '' } = {}) {
  const modal = document.getElementById('access-level-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  const idInput = document.getElementById('access-level-id');
  if (idInput) {
    idInput.value = level ? level.id : '';
    idInput.dataset.expectedRev = level ? String(Number(level.rev) || 1) : '';
  }
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
  setAccessLevelModalError(errorMessage);
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
  if (modal) {
    modal.classList.add('hidden');
    delete modal.dataset.userId;
  }
  applyUserModalReadonlyState(null);
  setUserModalError('');
}

function closeAccessLevelModal() {
  const modal = document.getElementById('access-level-modal');
  if (modal) modal.classList.add('hidden');
  setAccessLevelModalError('');
}

async function saveUserFromModal() {
  const idInput = document.getElementById('user-id');
  const id = idInput ? idInput.value : '';
  const expectedRev = id ? (parseInt(idInput?.dataset.expectedRev || '', 10) || 1) : null;
  const name = document.getElementById('user-name').value;
  const passwordInput = document.getElementById('user-password');
  const initialPassword = passwordInput ? (passwordInput.dataset.initialPassword || '') : '';
  const password = passwordInput ? passwordInput.value.trim() : '';
  const accessLevelId = document.getElementById('user-access-level').value;
  setUserModalError('');
  const passwordChanged = !!password && password !== initialPassword;
  const localInvalid = resolveUserModalLocalInvalidState({
    userId: id,
    expectedRev,
    name,
    accessLevelId
  });
  if (localInvalid) {
    await handleUserModalLocalInvalidState({
      action: id ? 'security-user:update' : 'security-user:create',
      userId: id,
      expectedRev,
      actualRev: localInvalid.actualRev,
      message: localInvalid.message || 'Пользователь уже был изменён другим пользователем. Данные обновлены.',
      reason: localInvalid.reason || 'security-user-save-local-invalid',
      reopenUserId: localInvalid.reopenUserId || ''
    });
    return;
  }
  const payload = {
    name,
    password: passwordChanged ? password : undefined,
    accessLevelId,
    status: 'active',
    expectedRev: id ? expectedRev : undefined
  };
  const method = id ? 'PUT' : 'POST';
  const url = id ? '/api/security/users/' + id : '/api/security/users';
  const result = await runSecurityUserWriteAction({
    action: id ? 'security-user:update' : 'security-user:create',
    writePath: url,
    userId: id,
    expectedRev,
    request: () => apiFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }),
    defaultErrorMessage: 'Ошибка сохранения',
    defaultConflictMessage: 'Данные безопасности уже были изменены. Список обновлён.',
    onSuccess: async ({ payload: responsePayload }) => {
      const createdUserId = String(responsePayload?.user?.id || '').trim();
      const updatedUser = id ? findSecurityUserById(id) : findSecurityUserById(createdUserId);
      const effectivePassword = passwordChanged ? password : (initialPassword || resolveUserPassword(updatedUser));
      if (updatedUser && effectivePassword) {
        rememberUserPassword(updatedUser.id, effectivePassword);
      }
      closeUserModal();
    },
    afterConflictRefresh: async ({ message }) => {
      const freshUser = id ? findSecurityUserById(id) : null;
      if (freshUser) {
        openUserModal(freshUser, { errorMessage: message || 'Данные безопасности уже были изменены. Список обновлён.' });
      } else {
        closeUserModal();
      }
      if (typeof showToast === 'function') {
        showToast(message || 'Данные безопасности уже были изменены. Список обновлён.');
      }
    },
    onError: async ({ res, message }) => {
      if (res?.status === 409 || res?.status === 404) {
        return;
      }
      setUserModalError(message || 'Ошибка сохранения');
    }
  });
  if (!result?.ok) {
    return;
  }
}

async function saveAccessLevelFromModal() {
  const idInput = document.getElementById('access-level-id');
  const id = idInput ? idInput.value : '';
  const expectedRev = id ? (parseInt(idInput?.dataset.expectedRev || '', 10) || 1) : null;
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
  setAccessLevelModalError('');
  const localInvalid = resolveAccessLevelModalLocalInvalidState({
    accessLevelId: id,
    expectedRev
  });
  if (localInvalid) {
    await handleAccessLevelModalLocalInvalidState({
      action: id ? 'security-access-level:update' : 'security-access-level:create',
      accessLevelId: id,
      expectedRev,
      actualRev: localInvalid.actualRev,
      message: localInvalid.message || 'Уровень доступа уже был изменён другим пользователем. Данные обновлены.',
      reason: localInvalid.reason || 'security-access-level-save-local-invalid',
      reopenAccessLevelId: localInvalid.reopenAccessLevelId || ''
    });
    return;
  }
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
  const payload = { id: id || undefined, name, description, permissions, expectedRev: id ? expectedRev : undefined };
  const result = await runSecurityAccessLevelWriteAction({
    action: id ? 'security-access-level:update' : 'security-access-level:create',
    accessLevelId: id,
    expectedRev,
    request: () => apiFetch('/api/security/access-levels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }),
    defaultErrorMessage: 'Ошибка сохранения',
    defaultConflictMessage: 'Уровень доступа уже был изменён другим пользователем. Данные обновлены.',
    onSuccess: async () => {
      closeAccessLevelModal();
    },
    afterConflictRefresh: async ({ message }) => {
      const freshLevel = id ? findSecurityAccessLevelById(id) : null;
      if (freshLevel) {
        openAccessLevelModal(freshLevel, { errorMessage: message || 'Уровень доступа уже был изменён другим пользователем. Данные обновлены.' });
      } else {
        closeAccessLevelModal();
      }
      if (typeof showToast === 'function') {
        showToast(message || 'Уровень доступа уже был изменён другим пользователем. Данные обновлены.');
      }
    },
    onError: async ({ res, message }) => {
      if (res?.status === 409 || res?.status === 404) {
        return;
      }
      setAccessLevelModalError(message || 'Ошибка сохранения');
    }
  });
  if (!result?.ok) {
    return;
  }
}

function setupSecurityControls() {
  const createUserBtn = document.getElementById('user-create');
  if (createUserBtn && createUserBtn.dataset.bound !== 'true') {
    createUserBtn.dataset.bound = 'true';
    createUserBtn.addEventListener('click', () => openUserModal(null));
  }
  const createLevelBtn = document.getElementById('access-level-create');
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
      if (!pwd) {
        const message = 'Введите или сгенерируйте пароль';
        setUserModalError(message);
        if (typeof showToast === 'function') {
          showToast(message);
        }
        return;
      }
      openPasswordBarcode(pwd, username, userId);
    });
  }
}
