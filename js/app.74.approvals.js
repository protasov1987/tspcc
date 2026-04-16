// === СОГЛАСОВАНИЕ МАРШРУТНЫХ КАРТ ===
const APPROVAL_ROLE_CONFIG = [
  {
    key: 'production',
    label: 'Начальник производства',
    icon: '🔨',
    statusField: 'approvalProductionStatus',
    permissionField: 'headProduction'
  },
  {
    key: 'skk',
    label: 'Начальник СКК',
    icon: '🔍',
    statusField: 'approvalSKKStatus',
    permissionField: 'headSKK'
  },
  {
    key: 'tech',
    label: 'ЗГД по технологиям',
    icon: '🧠',
    statusField: 'approvalTechStatus',
    permissionField: 'deputyTechDirector'
  }
];

const APPROVAL_RESPONSIBLE_MAP = {
  production: { nameField: 'responsibleProductionChief', atField: 'responsibleProductionChiefAt' },
  skk: { nameField: 'responsibleSKKChief', atField: 'responsibleSKKChiefAt' },
  tech: { nameField: 'responsibleTechLead', atField: 'responsibleTechLeadAt' }
};

let approvalRejectContext = null;
let approvalApproveContext = null;

function isAdminUser(user = currentUser) {
  if (!user) return false;
  const name = (user.name || user.username || '').trim();
  return user.role === 'admin' || name === 'Abyss';
}

function getEffectiveUserPermissions() {
  if (!currentUser) return {};
  const direct = currentUser.permissions || {};
  if (typeof direct.headProduction === 'boolean'
    || typeof direct.headSKK === 'boolean'
    || typeof direct.deputyTechDirector === 'boolean') {
    return direct;
  }
  const levelId = currentUser.accessLevelId;
  const level = levelId ? accessLevels.find(l => l.id === levelId) : null;
  return level && level.permissions ? level.permissions : direct;
}

function getUserApprovalRoles() {
  if (isAdminUser()) {
    return APPROVAL_ROLE_CONFIG.slice();
  }
  const perms = getEffectiveUserPermissions();
  return APPROVAL_ROLE_CONFIG.filter(role => perms && perms[role.permissionField]);
}

function getApprovalRoleContext(roleKey) {
  if (roleKey === 'production') return 'PRODUCTION';
  if (roleKey === 'skk') return 'SKK';
  if (roleKey === 'tech') return 'TECH';
  return '';
}

function renderApprovalStatusIcon(card, role) {
  const status = card ? card[role.statusField] : APPROVAL_STATUS_REJECTED;
  if (status === APPROVAL_STATUS_APPROVED) {
    return '<span class="approval-status approval-status-approved" title="Согласовано">✓</span>';
  }
  if (status === APPROVAL_STATUS_REJECTED) {
    return '<span class="approval-status approval-status-rejected" title="Не согласовано">✕</span>';
  }
  return '<span class="approval-status approval-status-pending" title="Ожидается">•</span>';
}

function getPendingRolesForUser(card) {
  const roles = getUserApprovalRoles();
  return roles.filter(role => !isApprovalStatus(card[role.statusField]));
}

function openApprovalApproveModal(cardId) {
  const modal = document.getElementById('approval-approve-modal');
  if (!modal) return;
  approvalApproveContext = { cardId };
  const textarea = document.getElementById('approval-approve-comment');
  if (textarea) textarea.value = '';
  const thread = document.getElementById('approval-approve-thread');
  const card = cards.find(c => c.id === cardId);
  if (card) ensureCardMeta(card, { skipSnapshot: true });
  const titleEl = document.getElementById('approval-approve-title');
  if (titleEl) {
    const num = getCardRouteNumberForTitle(card);
    titleEl.textContent = `Согласовать карту – "${num}"`;
  }
  if (thread) {
    thread.innerHTML = approvalThreadToHtml(card ? card.approvalThread : [], { newestFirst: true });
    thread.scrollTop = 0;
  }
  modal.classList.remove('hidden');
  if (textarea) textarea.focus();
}

function closeApprovalApproveModal() {
  const modal = document.getElementById('approval-approve-modal');
  if (modal) modal.classList.add('hidden');
  approvalApproveContext = null;
}

function openApprovalRejectModal(cardId) {
  const modal = document.getElementById('approval-reject-modal');
  if (!modal) return;
  approvalRejectContext = { cardId };
  const textarea = document.getElementById('approval-reject-text');
  if (textarea) {
    textarea.value = '';
  }
  const thread = document.getElementById('approval-reject-thread');
  const card = cards.find(c => c.id === cardId);
  if (card) ensureCardMeta(card, { skipSnapshot: true });
  const titleEl = document.getElementById('approval-reject-title');
  if (titleEl) {
    const num = getCardRouteNumberForTitle(card);
    titleEl.textContent = `Отклонить карту – "${num}"`;
  }
  if (thread) {
    thread.innerHTML = approvalThreadToHtml(card ? card.approvalThread : [], { newestFirst: true });
    thread.scrollTop = 0;
  }
  updateApprovalRejectCounter();
  modal.classList.remove('hidden');
  if (textarea) textarea.focus();
}

function closeApprovalRejectModal() {
  const modal = document.getElementById('approval-reject-modal');
  if (modal) modal.classList.add('hidden');
  approvalRejectContext = null;
}

function updateApprovalRejectCounter() {
  const textarea = document.getElementById('approval-reject-text');
  const counter = document.getElementById('approval-reject-counter');
  if (!textarea || !counter) return;
  const count = (textarea.value || '').length;
  counter.textContent = count + '/600';
}

function confirmApprovalApprove() {
  if (!approvalApproveContext) return;
  const card = cards.find(c => c.id === approvalApproveContext.cardId);
  if (!card) {
    closeApprovalApproveModal();
    return;
  }
  const previousCard = cloneCard(card);
  const commentEl = document.getElementById('approval-approve-comment');
  const comment = commentEl ? (commentEl.value || '').trim() : '';
  const userRoles = getUserApprovalRoles();
  const pendingRoles = userRoles.filter(role => card[role.statusField] == null);
  if (!pendingRoles.length) {
    closeApprovalApproveModal();
    return;
  }
  pendingRoles.forEach(role => {
    const oldValue = card[role.statusField];
    card[role.statusField] = APPROVAL_STATUS_APPROVED;
    recordCardLog(card, { action: 'approval', field: role.statusField, oldValue, newValue: card[role.statusField] });
    const responsibleMap = APPROVAL_RESPONSIBLE_MAP[role.key];
    if (responsibleMap) {
      const newName = (currentUser?.name || currentUser?.username || 'Пользователь').trim();
      const oldName = card[responsibleMap.nameField];
      const oldAt = card[responsibleMap.atField];
      card[responsibleMap.nameField] = newName;
      card[responsibleMap.atField] = Date.now();
      recordCardLog(card, { action: 'approval', field: responsibleMap.nameField, oldValue: oldName, newValue: card[responsibleMap.nameField] });
      recordCardLog(card, { action: 'approval', field: responsibleMap.atField, oldValue: oldAt, newValue: card[responsibleMap.atField] });
    }
    card.approvalThread.push({
      ts: Date.now(),
      userName: currentUser?.name || 'Пользователь',
      actionType: 'APPROVE',
      roleContext: getApprovalRoleContext(role.key),
      comment
    });
  });
  const prevStage = card.approvalStage;
  syncApprovalStatus(card);
  if (prevStage !== card.approvalStage) {
    recordCardLog(card, { action: 'approval', field: 'approvalStage', oldValue: prevStage, newValue: card.approvalStage });
  }
  closeApprovalApproveModal();
  saveData();
  if (typeof patchCardFamilyAfterUpsert === 'function') {
    patchCardFamilyAfterUpsert(card, previousCard);
  } else {
    renderEverything();
  }
}

function confirmApprovalReject() {
  if (!approvalRejectContext) return;
  const card = cards.find(c => c.id === approvalRejectContext.cardId);
  if (!card) {
    closeApprovalRejectModal();
    return;
  }
  const previousCard = cloneCard(card);
  const textarea = document.getElementById('approval-reject-text');
  const reasonText = textarea ? (textarea.value || '').trim() : '';
  if (!reasonText) {
    alert('Укажите причину отклонения.');
    return;
  }
  const userRoles = getUserApprovalRoles();
  if (!userRoles.length) {
    closeApprovalRejectModal();
    return;
  }
  const oldStage = card.approvalStage;
  card.approvalStage = APPROVAL_STAGE_REJECTED;
  card.rejectionReason = reasonText;
  card.rejectionReadByUserName = '';
  card.rejectionReadAt = null;
  userRoles.forEach(role => {
    const oldValue = card[role.statusField];
    card[role.statusField] = APPROVAL_STATUS_REJECTED;
    recordCardLog(card, { action: 'approval', field: role.statusField, oldValue, newValue: card[role.statusField] });
    const responsibleMap = APPROVAL_RESPONSIBLE_MAP[role.key];
    if (responsibleMap) {
      const oldName = card[responsibleMap.nameField];
      const oldAt = card[responsibleMap.atField];
      card[responsibleMap.nameField] = '';
      card[responsibleMap.atField] = null;
      recordCardLog(card, { action: 'approval', field: responsibleMap.nameField, oldValue: oldName, newValue: card[responsibleMap.nameField] });
      recordCardLog(card, { action: 'approval', field: responsibleMap.atField, oldValue: oldAt, newValue: card[responsibleMap.atField] });
    }
    card.approvalThread.push({
      ts: Date.now(),
      userName: currentUser?.name || 'Пользователь',
      actionType: 'REJECT',
      roleContext: getApprovalRoleContext(role.key),
      comment: reasonText
    });
  });
  recordCardLog(card, { action: 'approval', field: 'approvalStage', oldValue: oldStage, newValue: card.approvalStage });
  closeApprovalRejectModal();
  saveData();
  if (typeof patchCardFamilyAfterUpsert === 'function') {
    patchCardFamilyAfterUpsert(card, previousCard);
  } else {
    renderEverything();
  }
}

function setupApprovalRejectModal() {
  const modal = document.getElementById('approval-reject-modal');
  if (!modal) return;
  const textarea = document.getElementById('approval-reject-text');
  const confirmBtn = document.getElementById('approval-reject-confirm');
  const cancelBtn = document.getElementById('approval-reject-cancel');

  if (textarea) {
    textarea.addEventListener('input', () => updateApprovalRejectCounter());
  }
  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => confirmApprovalReject());
  }
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => closeApprovalRejectModal());
  }
  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      closeApprovalRejectModal();
    }
  });
}

function setupApprovalApproveModal() {
  const modal = document.getElementById('approval-approve-modal');
  if (!modal) return;
  const confirmBtn = document.getElementById('approval-approve-confirm');
  const cancelBtn = document.getElementById('approval-approve-cancel');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => confirmApprovalApprove());
  }
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => closeApprovalApproveModal());
  }
  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      closeApprovalApproveModal();
    }
  });
}

function renderApprovalsTable() {
  const wrapper = document.getElementById('approvals-table-wrapper');
  if (!wrapper) return;
  if (!canViewTab('approvals')) {
    wrapper.innerHTML = '<p>Нет прав для просмотра согласования.</p>';
    return;
  }

  cards.forEach(card => {
    ensureCardMeta(card, { skipSnapshot: true });
    syncApprovalStatus(card);
  });
  const visibleCards = cards.filter(c =>
    c &&
    !c.archived &&
    c.cardType === 'MKI' &&
    c.approvalStage === APPROVAL_STAGE_ON_APPROVAL
  );
  const termRaw = approvalsSearchTerm.trim();
  const hasTerm = !!termRaw;

  let sortedCards = [...visibleCards];
  if (hasTerm) {
    sortedCards.sort((a, b) => cardSearchScore(b, termRaw) - cardSearchScore(a, termRaw));
  }

  const filteredCards = sortedCards.filter(card => hasTerm ? cardSearchScore(card, termRaw) > 0 : true);

  if (!filteredCards.length) {
    wrapper.innerHTML = '<p>Карты по запросу не найдены.</p>';
    return;
  }

  let finalCards = filteredCards;

  if (approvalsSortKey) {
    if (approvalsSortKey === 'route') {
      finalCards = sortCardsByKey(finalCards, 'route', approvalsSortDir, c => getCardRouteNumberForSort(c));
    } else if (approvalsSortKey === 'name') {
      finalCards = sortCardsByKey(finalCards, 'name', approvalsSortDir, c => getCardNameForSort(c));
    } else if (approvalsSortKey === 'files') {
      finalCards = sortCardsByKey(finalCards, 'files', approvalsSortDir, c => getCardFilesCount(c));
    }
  }

  let html = '<table>' + getApprovalsTableHeaderHtml() + '<tbody>';

  finalCards.forEach(card => {
    html += buildApprovalsRowHtml(card);
  });

  html += '</tbody></table>';
  wrapper.innerHTML = html;

  if (!wrapper.dataset.sortBound) {
    wrapper.dataset.sortBound = '1';
    wrapper.addEventListener('click', (e) => {
      const th = e.target.closest('th.th-sortable');
      if (!th || !wrapper.contains(th)) return;
      const key = th.getAttribute('data-sort-key') || '';
      if (!key) return;

      if (approvalsSortKey === key) {
        approvalsSortDir = (approvalsSortDir === 'asc') ? 'desc' : 'asc';
      } else {
        approvalsSortKey = key;
        approvalsSortDir = 'asc';
      }
      renderApprovalsTable();
    });
  }
  updateTableSortUI(wrapper, approvalsSortKey, approvalsSortDir);

  bindApprovalsRowActions(wrapper);

  applyReadonlyState('approvals', 'approvals');
}

function getApprovalsTableHeaderHtml() {
  return '<thead><tr>' +
    '<th class="th-sortable" data-sort-key="route">Маршрутная карта № (QR)</th>' +
    '<th class="th-sortable" data-sort-key="name">Наименование</th>' +
    '<th class="th-sortable" data-sort-key="files">Файлы</th>' +
    '<th>Печать</th>' +
    '<th class="approval-icon-col" title="Начальник производства">🔨</th>' +
    '<th class="approval-icon-col" title="Начальник СКК">🔍</th>' +
    '<th class="approval-icon-col" title="ЗГД по технологиям">🧠</th>' +
    '<th>Согласование</th>' +
    '<th>Открыть</th>' +
    '</tr></thead>';
}

function buildApprovalsRowHtml(card) {
  const userRoles = getUserApprovalRoles();
  const filesCount = (card.attachments || []).length;
  const barcodeValue = getCardBarcodeValue(card);
  const displayRouteNumber = (card.routeCardNumber || card.orderNo || '').toString().trim() || barcodeValue;
  const pendingRoles = userRoles.filter(role => card[role.statusField] == null);
  const canApprove = canEditTab('approvals')
    && userRoles.length > 0
    && card.approvalStage === APPROVAL_STAGE_ON_APPROVAL
    && pendingRoles.length > 0;
  const canReject = canEditTab('approvals')
    && userRoles.length > 0
    && card.approvalStage === APPROVAL_STAGE_ON_APPROVAL;
  let actionsHtml = '<div class="table-actions approvals-actions">';
  if (canApprove) {
    actionsHtml += '<button class="btn-small" data-action="approve" data-id="' + card.id + '">Согласовать</button>';
  }
  if (canReject) {
    actionsHtml += '<button class="btn-small btn-danger" data-action="reject" data-id="' + card.id + '">Отклонить</button>';
  }
  actionsHtml += '</div>';
  return '<tr data-card-id="' + card.id + '">' +
    '<td><button class="btn-link barcode-link" data-id="' + card.id + '" data-allow-view="true" title="' + escapeHtml(barcodeValue) + '">' +
      '<div class="mk-cell">' +
        '<div class="mk-no">' + escapeHtml(displayRouteNumber) + '</div>' +
        '<div class="mk-qr">(' + escapeHtml(barcodeValue) + ')</div>' +
      '</div>' +
    '</button></td>' +
    '<td>' + escapeHtml(card.name || '') + '</td>' +
    '<td><button class="btn-small clip-btn" data-attach-card="' + card.id + '" data-allow-view="true">📎 <span class="clip-count">' + filesCount + '</span></button></td>' +
    '<td><button class="btn-small" data-action="print-card" data-id="' + card.id + '" data-allow-view="true">Печать</button></td>' +
    '<td class="approval-icon-cell">' + renderApprovalStatusIcon(card, APPROVAL_ROLE_CONFIG[0]) + '</td>' +
    '<td class="approval-icon-cell">' + renderApprovalStatusIcon(card, APPROVAL_ROLE_CONFIG[1]) + '</td>' +
    '<td class="approval-icon-cell">' + renderApprovalStatusIcon(card, APPROVAL_ROLE_CONFIG[2]) + '</td>' +
    '<td>' + actionsHtml + '</td>' +
    '<td><button class="btn-small" data-action="open-card" data-id="' + card.id + '" data-allow-view="true">Открыть</button></td>' +
    '</tr>';
}

function bindApprovalsRowActions(scope) {
  if (!scope) return;
  scope.querySelectorAll('button[data-action="print-card"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = cards.find(c => c.id === btn.getAttribute('data-id'));
      if (!card) return;
      printCardView(card);
    });
  });

  scope.querySelectorAll('button[data-action="open-card"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cardId = btn.getAttribute('data-id');
      openCardModal(cardId, { readOnly: true });
    });
  });

  scope.querySelectorAll('button[data-action="approve"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = cards.find(c => c.id === btn.getAttribute('data-id'));
      if (!card) return;
      openApprovalApproveModal(card.id);
    });
  });

  scope.querySelectorAll('button[data-action="reject"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cardId = btn.getAttribute('data-id');
      openApprovalRejectModal(cardId);
    });
  });

  scope.querySelectorAll('.barcode-link').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const card = cards.find(c => c.id === id);
      if (!card) return;
      openBarcodeModal(card);
    });
  });

  scope.querySelectorAll('button[data-attach-card]').forEach(btn => {
    btn.addEventListener('click', () => {
      openAttachmentsModal(btn.getAttribute('data-attach-card'), 'live');
    });
  });
}

function compareApprovalsInsertOrder(cardA, cardB, termRaw) {
  if (termRaw) {
    return cardSearchScore(cardB, termRaw) - cardSearchScore(cardA, termRaw);
  }

  if (!approvalsSortKey) return 0;

  const getValue = (card) => {
    if (approvalsSortKey === 'route') return getCardRouteNumberForSort(card);
    if (approvalsSortKey === 'name') return getCardNameForSort(card);
    if (approvalsSortKey === 'files') return getCardFilesCount(card);
    return '';
  };

  const mul = approvalsSortDir === 'desc' ? -1 : 1;
  const va = getValue(cardA);
  const vb = getValue(cardB);

  if (typeof va === 'number' && typeof vb === 'number') {
    return (va - vb) * mul;
  }

  const sa = normalizeSortText(va);
  const sb = normalizeSortText(vb);
  const aEmpty = !sa;
  const bEmpty = !sb;
  if (aEmpty && !bEmpty) return 1;
  if (!aEmpty && bEmpty) return -1;

  return compareTextNatural(sa, sb) * mul;
}

function insertApprovalsRowLive(card) {
  if (!card || location.pathname !== '/approvals') return;
  if (!canViewTab('approvals')) return;
  if (card.archived || card.cardType !== 'MKI') return;

  ensureCardMeta(card, { skipSnapshot: true });
  syncApprovalStatus(card);
  if (card.approvalStage !== APPROVAL_STAGE_ON_APPROVAL) return;

  const wrapper = document.getElementById('approvals-table-wrapper');
  if (!wrapper) return;

  const termRaw = approvalsSearchTerm.trim();
  if (termRaw && cardSearchScore(card, termRaw) <= 0) return;

  const existingRow = wrapper.querySelector('tr[data-card-id="' + card.id + '"]');
  if (existingRow) return;

  let table = wrapper.querySelector('table');
  let tbody = wrapper.querySelector('tbody');

  if (!table || !tbody) {
    wrapper.innerHTML = '<table>' + getApprovalsTableHeaderHtml() + '<tbody></tbody></table>';
    table = wrapper.querySelector('table');
    tbody = wrapper.querySelector('tbody');

    if (!wrapper.dataset.sortBound) {
      wrapper.dataset.sortBound = '1';
      wrapper.addEventListener('click', (e) => {
        const th = e.target.closest('th.th-sortable');
        if (!th || !wrapper.contains(th)) return;
        const key = th.getAttribute('data-sort-key') || '';
        if (!key) return;

        if (approvalsSortKey === key) {
          approvalsSortDir = (approvalsSortDir === 'asc') ? 'desc' : 'asc';
        } else {
          approvalsSortKey = key;
          approvalsSortDir = 'asc';
        }
        renderApprovalsTable();
      });
    }
    updateTableSortUI(wrapper, approvalsSortKey, approvalsSortDir);
  }

  const rowWrapper = document.createElement('tbody');
  rowWrapper.innerHTML = buildApprovalsRowHtml(card);
  const row = rowWrapper.firstElementChild;
  if (!row) return;

  let inserted = false;
  const rows = Array.from(tbody.querySelectorAll('tr[data-card-id]'));
  for (const existing of rows) {
    const existingId = existing.getAttribute('data-card-id');
    const existingCard = cards.find(item => item && item.id === existingId);
    if (!existingCard) continue;
    if (compareApprovalsInsertOrder(card, existingCard, termRaw) < 0) {
      tbody.insertBefore(row, existing);
      inserted = true;
      break;
    }
  }
  if (!inserted) tbody.appendChild(row);

  bindApprovalsRowActions(row);
  applyReadonlyState('approvals', 'approvals');
}

function removeApprovalsRowLive(cardId) {
  if (!cardId || location.pathname !== '/approvals') return;
  const wrapper = document.getElementById('approvals-table-wrapper');
  if (!wrapper) return;
  const existingRow = wrapper.querySelector('tr[data-card-id="' + cardId + '"]');
  if (!existingRow) return;
  existingRow.remove();
  const tbody = wrapper.querySelector('tbody');
  if (!tbody || !tbody.querySelector('tr[data-card-id]')) {
    renderApprovalsTable();
  }
}

function syncApprovalsRowLive(card) {
  if (!card || !card.id || location.pathname !== '/approvals') return;
  if (!canViewTab('approvals')) return;

  ensureCardMeta(card, { skipSnapshot: true });
  syncApprovalStatus(card);

  const wrapper = document.getElementById('approvals-table-wrapper');
  if (!wrapper) return;
  const existingRow = wrapper.querySelector('tr[data-card-id="' + card.id + '"]');
  const termRaw = approvalsSearchTerm.trim();
  const visible = !card.archived
    && card.cardType === 'MKI'
    && card.approvalStage === APPROVAL_STAGE_ON_APPROVAL
    && (!termRaw || cardSearchScore(card, termRaw) > 0);

  if (!visible) {
    if (existingRow) removeApprovalsRowLive(card.id);
    return;
  }

  if (!existingRow) {
    insertApprovalsRowLive(card);
    return;
  }

  if (approvalsSortKey || termRaw) {
    renderApprovalsTable();
    return;
  }

  existingRow.outerHTML = buildApprovalsRowHtml(card);
  const nextRow = wrapper.querySelector('tr[data-card-id="' + card.id + '"]');
  if (nextRow) bindApprovalsRowActions(nextRow);
  applyReadonlyState('approvals', 'approvals');
}
