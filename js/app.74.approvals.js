// === СОГЛАСОВАНИЕ МАРШРУТНЫХ КАРТ ===
const APPROVAL_ROLE_CONFIG = [
  {
    key: 'production',
    label: 'Начальник производства',
    icon: '🔨',
    statusField: 'approvalProductionStatus',
    decidedField: 'approvalProductionDecided',
    permissionField: 'headProduction'
  },
  {
    key: 'skk',
    label: 'Начальник СКК',
    icon: '🔍',
    statusField: 'approvalSkkStatus',
    decidedField: 'approvalSkkDecided',
    permissionField: 'headSKK'
  },
  {
    key: 'tech',
    label: 'ЗГД по технологиям',
    icon: '🧠',
    statusField: 'approvalTechStatus',
    decidedField: 'approvalTechDecided',
    permissionField: 'deputyTechDirector'
  }
];

let approvalRejectContext = null;

function getUserApprovalRoles() {
  const perms = currentUser && currentUser.permissions ? currentUser.permissions : {};
  return APPROVAL_ROLE_CONFIG.filter(role => perms && perms[role.permissionField]);
}

function renderApprovalStatusIcon(card, role) {
  const status = card ? card[role.statusField] : APPROVAL_STATUS_REJECTED;
  const decided = card ? card[role.decidedField] : false;
  if (status === APPROVAL_STATUS_APPROVED) {
    return '<span class="approval-status approval-status-approved" title="Согласовано">✓</span>';
  }
  if (decided) {
    return '<span class="approval-status approval-status-rejected" title="Не согласовано">✕</span>';
  }
  return '<span class="approval-status approval-status-pending" title="Ожидается">•</span>';
}

function applyApprovalDecision(card, decision, reasonText = '') {
  if (!card) return;
  const roles = getUserApprovalRoles();
  if (!roles.length) return;

  roles.forEach(role => {
    if (card[role.decidedField]) return;
    card[role.statusField] = decision === 'approve' ? APPROVAL_STATUS_APPROVED : APPROVAL_STATUS_REJECTED;
    card[role.decidedField] = true;
  });

  if (decision === 'reject') {
    const name = currentUser && currentUser.name ? currentUser.name.trim() : 'Пользователь';
    const safeReason = (reasonText || '').trim().slice(0, 600);
    const entry = '@' + name + ': ' + safeReason;
    const existing = (card.rejectionReason || '').trim();
    card.rejectionReason = existing ? existing + '\n' + entry : entry;
  }

  syncApprovalStatus(card);
}

function openApprovalRejectModal(cardId) {
  const modal = document.getElementById('approval-reject-modal');
  if (!modal) return;
  approvalRejectContext = { cardId };
  const textarea = document.getElementById('approval-reject-text');
  if (textarea) {
    textarea.value = '';
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

function confirmApprovalReject() {
  if (!approvalRejectContext) return;
  const card = cards.find(c => c.id === approvalRejectContext.cardId);
  if (!card) {
    closeApprovalRejectModal();
    return;
  }
  const textarea = document.getElementById('approval-reject-text');
  const reasonText = textarea ? textarea.value : '';
  applyApprovalDecision(card, 'reject', reasonText);
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

function renderApprovalsTable() {
  const wrapper = document.getElementById('approvals-table-wrapper');
  if (!wrapper) return;
  if (!canViewTab('approvals')) {
    wrapper.innerHTML = '<p>Нет прав для просмотра согласования.</p>';
    return;
  }

  cards.forEach(card => syncApprovalStatus(card));
  const visibleCards = cards.filter(c => !c.archived && !c.groupId && !isGroupCard(c));
  const termRaw = approvalsSearchTerm.trim();
  const hasTerm = !!termRaw;

  let sortedCards = [...visibleCards];
  if (hasTerm) {
    sortedCards.sort((a, b) => cardSearchScore(b, termRaw) - cardSearchScore(a, termRaw));
  }

  const filteredCards = sortedCards.filter(card => {
    if (card.status !== approvalsStatusFilter) return false;
    return hasTerm ? cardSearchScore(card, termRaw) > 0 : true;
  });

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

  filteredCards.forEach(card => {
    const filesCount = (card.attachments || []).length;
    const barcodeValue = getCardBarcodeValue(card);
    const roles = getUserApprovalRoles();
    const canAct = canEditTab('approvals') && roles.length > 0 && roles.some(role => !card[role.decidedField]);
    html += '<tr>' +
      '<td><button class="btn-link barcode-link" data-id="' + card.id + '">' + escapeHtml(barcodeValue) + '</button></td>' +
      '<td>' + escapeHtml(card.name || '') + '</td>' +
      '<td>' + renderCardStatusCell(card) + '</td>' +
      '<td><button class="btn-small clip-btn" data-attach-card="' + card.id + '">📎 <span class="clip-count">' + filesCount + '</span></button></td>' +
      '<td><button class="btn-small" data-action="print-card" data-id="' + card.id + '">Печать</button></td>' +
      '<td class="approval-icon-cell">' + renderApprovalStatusIcon(card, APPROVAL_ROLE_CONFIG[0]) + '</td>' +
      '<td class="approval-icon-cell">' + renderApprovalStatusIcon(card, APPROVAL_ROLE_CONFIG[1]) + '</td>' +
      '<td class="approval-icon-cell">' + renderApprovalStatusIcon(card, APPROVAL_ROLE_CONFIG[2]) + '</td>' +
      '<td>' +
        '<div class="table-actions approvals-actions">' +
          '<button class="btn-small" data-action="approve" data-id="' + card.id + '"' + (canAct ? '' : ' disabled') + '>Согласовать</button>' +
          '<button class="btn-small btn-danger" data-action="reject" data-id="' + card.id + '"' + (canAct ? '' : ' disabled') + '>Отклонить</button>' +
        '</div>' +
      '</td>' +
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
      if (!confirm('Согласование нельзя отменить! Продолжить?')) return;
      applyApprovalDecision(card, 'approve');
      saveData();
      renderEverything();
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
