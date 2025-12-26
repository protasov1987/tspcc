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
  renderEverything();
}

function confirmApprovalReject() {
  if (!approvalRejectContext) return;
  const card = cards.find(c => c.id === approvalRejectContext.cardId);
  if (!card) {
    closeApprovalRejectModal();
    return;
  }
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
  renderEverything();
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
  const visibleCards = cards.filter(c => !c.archived && !c.groupId && !isGroupCard(c) && c.approvalStage === APPROVAL_STAGE_ON_APPROVAL);
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

  let html = '<table><thead><tr>' +
    '<th>Маршрутная карта № (Code128)</th>' +
    '<th>Наименование</th>' +
    '<th>Статус</th>' +
    '<th>Файлы</th>' +
    '<th>Печать</th>' +
    '<th class="approval-icon-col" title="Начальник производства">🔨</th>' +
    '<th class="approval-icon-col" title="Начальник СКК">🔍</th>' +
    '<th class="approval-icon-col" title="ЗГД по технологиям">🧠</th>' +
    '<th>Согласование</th>' +
    '<th>Открыть</th>' +
    '</tr></thead><tbody>';

  const userRoles = getUserApprovalRoles();

  filteredCards.forEach(card => {
    const filesCount = (card.attachments || []).length;
    const barcodeValue = getCardBarcodeValue(card);
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
    html += '<tr>' +
      '<td><button class="btn-link barcode-link" data-id="' + card.id + '">' + escapeHtml(barcodeValue) + '</button></td>' +
      '<td>' + escapeHtml(card.name || '') + '</td>' +
      '<td>' + renderCardStatusCell(card) + '</td>' +
      '<td><button class="btn-small clip-btn" data-attach-card="' + card.id + '">📎 <span class="clip-count">' + filesCount + '</span></button></td>' +
      '<td><button class="btn-small" data-action="print-card" data-id="' + card.id + '">Печать</button></td>' +
      '<td class="approval-icon-cell">' + renderApprovalStatusIcon(card, APPROVAL_ROLE_CONFIG[0]) + '</td>' +
      '<td class="approval-icon-cell">' + renderApprovalStatusIcon(card, APPROVAL_ROLE_CONFIG[1]) + '</td>' +
      '<td class="approval-icon-cell">' + renderApprovalStatusIcon(card, APPROVAL_ROLE_CONFIG[2]) + '</td>' +
      '<td>' + actionsHtml + '</td>' +
      '<td><button class="btn-small" data-action="open-card" data-id="' + card.id + '">Открыть</button></td>' +
      '</tr>';
  });

  html += '</tbody></table>';
  wrapper.innerHTML = html;

  wrapper.querySelectorAll('button[data-action="print-card"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = cards.find(c => c.id === btn.getAttribute('data-id'));
      if (!card) return;
      printCardView(card);
    });
  });

  wrapper.querySelectorAll('button[data-action="open-card"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cardId = btn.getAttribute('data-id');
      openCardModal(cardId, { readOnly: true });
    });
  });

  wrapper.querySelectorAll('button[data-action="approve"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = cards.find(c => c.id === btn.getAttribute('data-id'));
      if (!card) return;
      openApprovalApproveModal(card.id);
    });
  });

  wrapper.querySelectorAll('button[data-action="reject"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cardId = btn.getAttribute('data-id');
      openApprovalRejectModal(cardId);
    });
  });

  wrapper.querySelectorAll('.barcode-link').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const card = cards.find(c => c.id === id);
      if (!card) return;
      openBarcodeModal(card);
    });
  });

  wrapper.querySelectorAll('button[data-attach-card]').forEach(btn => {
    btn.addEventListener('click', () => {
      openAttachmentsModal(btn.getAttribute('data-attach-card'), 'live');
    });
  });

  applyReadonlyState('approvals', 'approvals');
}
