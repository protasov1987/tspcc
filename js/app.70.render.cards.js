// === РЕНДЕРИНГ МАРШРУТНЫХ КАРТ ===
function renderCardStatusCell(card) {
  if (!card) return '';
  const status = cardStatusText(card);
  return '<span class="cards-status-text" data-card-id="' + card.id + '">' + escapeHtml(status) + '</span>';
}

function getApprovalStageLabel(stage) {
  if (stage === APPROVAL_STAGE_DRAFT) return 'Черновик';
  if (stage === APPROVAL_STAGE_ON_APPROVAL) return 'На согласовании';
  if (stage === APPROVAL_STAGE_REJECTED) return 'Отклонено';
  if (stage === APPROVAL_STAGE_APPROVED) return 'Согласовано';
  return '';
}

function renderApprovalStageCell(card) {
  if (!card) return '';
  const label = getApprovalStageLabel(card.approvalStage);
  return '<span class="cards-approval-stage" data-card-id="' + card.id + '">' + escapeHtml(label) + '</span>';
}

let approvalDialogContext = null;

function renderCardsTable() {
  const wrapper = document.getElementById('cards-table-wrapper');
  const visibleCards = cards.filter(c => !c.archived && !c.groupId);
  if (!visibleCards.length) {
    wrapper.innerHTML = '<p>Список маршрутных карт пуст. Нажмите «Создать МК».</p>';
    return;
  }

  const termRaw = cardsSearchTerm.trim();
  const cardMatches = (card) => {
    return termRaw ? cardSearchScore(card, termRaw) > 0 : true;
  };

  let sortedCards = [...visibleCards];
  if (termRaw) {
    sortedCards.sort((a, b) => cardSearchScore(b, termRaw) - cardSearchScore(a, termRaw));
  }

  const filteredCards = sortedCards.filter(card => {
    if (isGroupCard(card)) {
      const children = getGroupChildren(card).filter(c => !c.archived);
      return cardMatches(card) || children.some(ch => cardMatches(ch));
    }
    return cardMatches(card);
  });

  if (!filteredCards.length) {
    wrapper.innerHTML = '<p>Карты по запросу не найдены.</p>';
    return;
  }

  let html = '<table><thead><tr>' +
    '<th>Маршрутная карта № (Code128)</th><th>Наименование</th><th>Статус</th><th>Этап согласования</th><th>Операций</th><th>Файлы</th><th>Действия</th>' +
    '</tr></thead><tbody>';

  filteredCards.forEach(card => {
    if (isGroupCard(card)) {
      const children = getGroupChildren(card).filter(c => !c.archived);
      const filesCount = (card.attachments || []).length;
      const opened = cardsGroupOpen.has(card.id);
      const opsTotal = children.reduce((acc, c) => acc + ((c.operations || []).length), 0);
        const toggleLabel = opened ? 'Закрыть' : 'Открыть';
        const groupBarcode = getCardBarcodeValue(card);
        html += '<tr class="group-row" data-group-id="' + card.id + '">' +
          '<td><button class="btn-link barcode-link" data-id="' + card.id + '">' + escapeHtml(groupBarcode) + '</button></td>' +
          '<td><span class="group-marker">(Г)</span>' + escapeHtml(card.name || '') + '</td>' +
          '<td></td>' +
          '<td></td>' +
          '<td>' + opsTotal + '</td>' +
        '<td><button class="btn-small clip-btn" data-attach-card="' + card.id + '">📎 <span class="clip-count">' + filesCount + '</span></button></td>' +
        '<td><div class="table-actions">' +
        '<button class="btn-small group-toggle-btn" data-action="toggle-group" data-id="' + card.id + '">' + toggleLabel + '</button>' +
        '<button class="btn-small" data-action="print-group" data-id="' + card.id + '">Печать</button>' +
        '<button class="btn-small" data-action="copy-group" data-id="' + card.id + '">Копировать</button>' +
        '<button class="btn-small btn-danger" data-action="delete-group" data-id="' + card.id + '">Удалить</button>' +
        '</div></td>' +
        '</tr>';

      if (opened) {
        children.forEach(child => {
          const childFiles = (child.attachments || []).length;
          const childBarcode = getCardBarcodeValue(child);
          html += '<tr class="group-child-row" data-parent="' + card.id + '">' +
            '<td><button class="btn-link barcode-link" data-id="' + child.id + '">' + escapeHtml(childBarcode) + '</button></td>' +
            '<td class="group-indent">' + escapeHtml(child.name || '') + '</td>' +
            '<td>' + renderCardStatusCell(child) + '</td>' +
            '<td>' + renderApprovalStageCell(child) + '</td>' +
            '<td>' + ((child.operations || []).length) + '</td>' +
            '<td><button class="btn-small clip-btn" data-attach-card="' + child.id + '">📎 <span class="clip-count">' + childFiles + '</span></button></td>' +
            '<td><div class="table-actions">' +
            '<button class="btn-small" data-action="edit-card" data-id="' + child.id + '">Открыть</button>' +
            '<button class="btn-small" data-action="print-card" data-id="' + child.id + '">Печать</button>' +
            '<button class="btn-small" data-action="copy-card" data-id="' + child.id + '">Копировать</button>' +
            '<button class="btn-small approval-dialog-btn' + (child.approvalStage === APPROVAL_STAGE_REJECTED && child.rejectionReason && !child.rejectionReadByUserName ? ' btn-danger' : '') + '" data-action="approval-dialog" data-id="' + child.id + '">Согласование</button>' +
            '<button class="btn-small btn-danger" data-action="delete-card" data-id="' + child.id + '">Удалить</button>' +
            '</div></td>' +
            '</tr>';
        });
      }
      return;
    }

    const filesCount = (card.attachments || []).length;
    const barcodeValue = getCardBarcodeValue(card);
    html += '<tr>' +
      '<td><button class="btn-link barcode-link" data-id="' + card.id + '">' + escapeHtml(barcodeValue) + '</button></td>' +
      '<td>' + escapeHtml(card.name || '') + '</td>' +
      '<td>' + renderCardStatusCell(card) + '</td>' +
      '<td>' + renderApprovalStageCell(card) + '</td>' +
      '<td>' + (card.operations ? card.operations.length : 0) + '</td>' +
      '<td><button class="btn-small clip-btn" data-attach-card="' + card.id + '">📎 <span class="clip-count">' + filesCount + '</span></button></td>' +
      '<td><div class="table-actions">' +
      '<button class="btn-small" data-action="edit-card" data-id="' + card.id + '">Открыть</button>' +
      '<button class="btn-small" data-action="print-card" data-id="' + card.id + '">Печать</button>' +
      '<button class="btn-small" data-action="copy-card" data-id="' + card.id + '">Копировать</button>' +
      '<button class="btn-small approval-dialog-btn' + (card.approvalStage === APPROVAL_STAGE_REJECTED && card.rejectionReason && !card.rejectionReadByUserName ? ' btn-danger' : '') + '" data-action="approval-dialog" data-id="' + card.id + '">Согласование</button>' +
      '<button class="btn-small btn-danger" data-action="delete-card" data-id="' + card.id + '">Удалить</button>' +
      '</div></td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  wrapper.innerHTML = html;

  wrapper.querySelectorAll('button[data-action="edit-card"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cardId = btn.getAttribute('data-id');
      const card = cards.find(c => c.id === cardId);
      const isMki = card && card.cardType === 'MKI';
      const route = isMki ? '/cards-mki/new?cardId=' + encodeURIComponent(cardId) : '/cards/new?cardId=' + encodeURIComponent(cardId);
      navigateToRoute(route);
    });
  });

  wrapper.querySelectorAll('button[data-action="copy-card"]').forEach(btn => {
    btn.addEventListener('click', () => {
      duplicateCard(btn.getAttribute('data-id'));
    });
  });

  wrapper.querySelectorAll('button[data-action="toggle-group"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      if (cardsGroupOpen.has(id)) {
        cardsGroupOpen.delete(id);
      } else {
        cardsGroupOpen.add(id);
      }
      renderCardsTable();
    });
  });

  wrapper.querySelectorAll('button[data-action="copy-group"]').forEach(btn => {
    btn.addEventListener('click', () => duplicateGroup(btn.getAttribute('data-id')));
  });

  wrapper.querySelectorAll('button[data-action="delete-group"]').forEach(btn => {
    btn.addEventListener('click', () => openDeleteConfirm({ type: 'group', id: btn.getAttribute('data-id') }));
  });

  wrapper.querySelectorAll('button[data-action="print-group"]').forEach(btn => {
    btn.addEventListener('click', () => printGroupList(btn.getAttribute('data-id')));
  });

  wrapper.querySelectorAll('button[data-action="print-card"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = cards.find(c => c.id === btn.getAttribute('data-id'));
      if (!card) return;
      printCardView(card);
    });
  });

  wrapper.querySelectorAll('button[data-action="delete-card"]').forEach(btn => {
    btn.addEventListener('click', () => {
      openDeleteConfirm({ type: 'card', id: btn.getAttribute('data-id') });
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

  wrapper.querySelectorAll('button[data-action="approval-dialog"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cardId = btn.getAttribute('data-id');
      openApprovalDialog(cardId);
    });
  });

  applyReadonlyState('cards', 'cards');
}

function openApprovalDialog(cardId) {
  const modal = document.getElementById('approval-dialog-modal');
  if (!modal) return;
  approvalDialogContext = { cardId };
  const card = cards.find(c => c.id === cardId);
  if (card) ensureCardMeta(card, { skipSnapshot: true });
  renderApprovalDialog(card);
  modal.classList.remove('hidden');
  const confirmBtn = document.getElementById('approval-dialog-confirm');
  const cancelBtn = document.getElementById('approval-dialog-cancel');
  const comment = document.getElementById('approval-dialog-comment');
  if (comment) comment.value = '';
  if (confirmBtn) confirmBtn.onclick = () => confirmApprovalDialogAction();
  if (cancelBtn) cancelBtn.onclick = () => closeApprovalDialog();
  modal.onclick = (event) => {
    if (event.target === modal) closeApprovalDialog();
  };
}

function renderApprovalDialog(card) {
  const modal = document.getElementById('approval-dialog-modal');
  if (!modal) return;
  if (!card) {
    closeApprovalDialog();
    return;
  }
  modal.dataset.cardId = card.id;
  const stageEl = document.getElementById('approval-dialog-stage');
  if (stageEl) stageEl.textContent = getApprovalStageLabel(card.approvalStage);
  const threadContainer = document.getElementById('approval-dialog-thread');
  if (threadContainer) threadContainer.innerHTML = approvalThreadToHtml(card.approvalThread);
  const reasonBlock = document.getElementById('approval-dialog-reason');
  if (reasonBlock) {
    reasonBlock.textContent = card.approvalStage === APPROVAL_STAGE_REJECTED && card.rejectionReason
      ? 'Причина отказа: ' + card.rejectionReason
      : '';
    reasonBlock.classList.toggle('hidden', !(card.approvalStage === APPROVAL_STAGE_REJECTED && card.rejectionReason));
  }
  const comment = document.getElementById('approval-dialog-comment');
  const confirmBtn = document.getElementById('approval-dialog-confirm');
  const showComment = card.approvalStage === APPROVAL_STAGE_DRAFT
    || (card.approvalStage === APPROVAL_STAGE_REJECTED && !card.rejectionReadByUserName);
  const commentWrapper = comment ? comment.closest('.flex-col') || comment.parentElement : null;
  if (comment) {
    comment.value = '';
    comment.classList.toggle('hidden', !showComment);
    comment.disabled = !showComment;
    comment.required = card.approvalStage === APPROVAL_STAGE_REJECTED && !card.rejectionReadByUserName;
  }
  if (commentWrapper) {
    commentWrapper.classList.toggle('hidden', !showComment);
  }
  if (confirmBtn) {
    if (card.approvalStage === APPROVAL_STAGE_DRAFT) {
      confirmBtn.textContent = 'Отправить';
      confirmBtn.classList.remove('hidden');
      confirmBtn.disabled = false;
    } else if (card.approvalStage === APPROVAL_STAGE_REJECTED && !card.rejectionReadByUserName) {
      confirmBtn.textContent = 'Разморозить';
      confirmBtn.classList.remove('hidden');
      confirmBtn.disabled = false;
    } else {
      confirmBtn.classList.add('hidden');
      confirmBtn.disabled = true;
    }
  }
}

function closeApprovalDialog() {
  const modal = document.getElementById('approval-dialog-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.dataset.cardId = '';
  }
  approvalDialogContext = null;
}

function confirmApprovalDialogAction() {
  if (!approvalDialogContext) return;
  const card = cards.find(c => c.id === approvalDialogContext.cardId);
  if (!card) {
    closeApprovalDialog();
    return;
  }
  const commentEl = document.getElementById('approval-dialog-comment');
  const comment = commentEl ? (commentEl.value || '').trim() : '';
  if (card.approvalStage === APPROVAL_STAGE_DRAFT) {
    const oldStage = card.approvalStage;
    card.approvalStage = APPROVAL_STAGE_ON_APPROVAL;
    card.approvalProductionStatus = null;
    card.approvalSKKStatus = null;
    card.approvalTechStatus = null;
    card.rejectionReason = '';
    card.rejectionReadByUserName = '';
    card.rejectionReadAt = null;
    card.approvalThread.push({
      ts: Date.now(),
      userName: currentUser?.name || 'Пользователь',
      actionType: 'SEND_TO_APPROVAL',
      roleContext: '',
      comment
    });
    recordCardLog(card, { action: 'approval', field: 'approvalStage', oldValue: oldStage, newValue: card.approvalStage });
    saveData();
    renderEverything();
    closeApprovalDialog();
    return;
  }
  if (card.approvalStage === APPROVAL_STAGE_REJECTED && !card.rejectionReadByUserName) {
    if (!comment) {
      alert('Добавьте комментарий для разморозки.');
      return;
    }
    const oldStage = card.approvalStage;
    card.rejectionReadByUserName = currentUser?.name || 'Пользователь';
    card.rejectionReadAt = Date.now();
    card.approvalThread.push({
      ts: Date.now(),
      userName: currentUser?.name || 'Пользователь',
      actionType: 'UNFREEZE',
      roleContext: '',
      comment
    });
    card.approvalStage = APPROVAL_STAGE_DRAFT;
    recordCardLog(card, { action: 'approval', field: 'approvalStage', oldValue: oldStage, newValue: card.approvalStage });
    saveData();
    renderEverything();
    closeApprovalDialog();
  }
}

function buildCardCopy(template, { nameOverride, groupId = null } = {}) {
  const copy = cloneCard(template);
  copy.id = genId('card');
  copy.cardType = template.cardType === 'MKI' ? 'MKI' : 'MK';
  copy.itemName = nameOverride || template.itemName || template.name || '';
  copy.name = copy.itemName || 'Маршрутная карта';
  copy.groupId = groupId;
  copy.isGroup = false;
  copy.status = 'NOT_STARTED';
  copy.approvalStage = APPROVAL_STAGE_DRAFT;
  copy.approvalProductionStatus = null;
  copy.approvalSKKStatus = null;
  copy.approvalTechStatus = null;
  copy.rejectionReason = '';
  copy.rejectionReadByUserName = '';
  copy.rejectionReadAt = null;
  copy.approvalThread = [];
  copy.archived = false;
  copy.useItemList = Boolean(template.useItemList);
  copy.logs = [];
  copy.createdAt = Date.now();
  copy.initialSnapshot = null;
  copy.attachments = (copy.attachments || []).map(file => ({
    ...file,
    id: genId('file'),
    createdAt: Date.now()
  }));
  copy.operations = (copy.operations || []).map((op) => ({
    ...op,
    id: genId('rop'),
    status: 'NOT_STARTED',
    startedAt: null,
    finishedAt: null,
    elapsedSeconds: 0,
    actualSeconds: null,
    comment: '',
    goodCount: 0,
    scrapCount: 0,
    holdCount: 0,
    items: Array.isArray(op.items)
      ? op.items.map(item => ({
        ...item,
        id: genId('item'),
        goodCount: 0,
        scrapCount: 0,
        holdCount: 0,
        quantity: toSafeCount(item.quantity || 0) || 1
      }))
      : [],
    order: typeof op.order === 'number' ? op.order : undefined
  }));
  renumberAutoCodesForCard(copy);
  return copy;
}

function duplicateCard(cardId) {
  const card = cards.find(c => c.id === cardId);
  if (!card) return;
  const copy = buildCardCopy(card, { nameOverride: (card.name || '') + ' (копия)' });
  copy.barcode = generateUniqueCardCode128();
  recalcCardStatus(copy);
  ensureCardMeta(copy);
  if (!copy.initialSnapshot) {
    const snapshot = cloneCard(copy);
    snapshot.logs = [];
    copy.initialSnapshot = snapshot;
  }
  const oldBarcode = getCardBarcodeValue(card);
  const newBarcode = getCardBarcodeValue(copy);
  recordCardLog(copy, { action: 'Создание копии', object: 'Карта', oldValue: oldBarcode, newValue: newBarcode });
  cards.push(copy);
  saveData();
  renderEverything();
}

function duplicateGroup(groupId, { includeArchivedChildren = false } = {}) {
  const group = cards.find(c => c.id === groupId && isGroupCard(c));
  if (!group) return;
  const children = getGroupChildren(group).filter(c => includeArchivedChildren || !c.archived);
  const usedBarcodes = collectBarcodeSet();
  const newGroup = {
    id: genId('group'),
    isGroup: true,
    name: (group.name || '') + ' (копия)',
    barcode: generateUniqueCardCode128(usedBarcodes),
    orderNo: group.orderNo || '',
    contractNumber: group.contractNumber || '',
    status: 'NOT_STARTED',
    archived: false,
    attachments: (group.attachments || []).map(file => ({
      ...file,
      id: genId('file'),
      createdAt: Date.now()
    })),
    createdAt: Date.now()
  };

  cards.push(newGroup);

  children.forEach((child, idx) => {
    const baseName = child.name ? child.name.replace(/^\d+\.\s*/, '') : group.name || 'Карта';
    const copy = buildCardCopy(child, { nameOverride: (idx + 1) + '. ' + baseName, groupId: newGroup.id });
    copy.barcode = generateUniqueCardCode128(usedBarcodes);
    ensureCardMeta(copy);
    recalcCardStatus(copy);
    cards.push(copy);
  });

  recalcCardStatus(newGroup);
  saveData();
  renderEverything();
  return newGroup;
}

function openGroupTransferModal() {
  const modal = document.getElementById('group-transfer-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
}

function closeGroupTransferModal() {
  const modal = document.getElementById('group-transfer-modal');
  if (!modal) return;
  modal.classList.add('hidden');
}

function archiveCardWithLog(card) {
  if (!card || card.archived) return false;
  recordCardLog(card, { action: 'Архивирование', object: 'Карта', field: 'archived', oldValue: false, newValue: true });
  card.archived = true;
  return true;
}

function deleteGroup(groupId) {
  const group = cards.find(c => c.id === groupId && isGroupCard(c));
  if (!group) return false;
  cards = cards.filter(c => c.id !== groupId && c.groupId !== groupId);
  cardsGroupOpen.delete(groupId);
  return true;
}

function deleteCardById(cardId) {
  const card = cards.find(c => c.id === cardId);
  if (!card) return false;
  const parentId = card.groupId;
  cards = cards.filter(c => c.id !== cardId);
  if (parentId) {
    const parent = cards.find(c => c.id === parentId);
    if (parent) recalcCardStatus(parent);
  }
  return true;
}

function buildDeleteConfirmMessage(context) {
  if (!context || !context.id) return '';
  if (context.type === 'group') {
    const group = cards.find(c => c.id === context.id && isGroupCard(c));
    if (!group) return '';
    const children = group.archived ? getGroupChildren(group) : getActiveGroupChildren(group);
    const groupTitle = formatCardTitle(group) || group.name || getCardBarcodeValue(group) || 'Группа карт';
    const childText = children.length ? ' вместе с ' + children.length + ' вложенными картами' : '';
    return 'Группа «' + groupTitle + '»' + childText + ' будет удалена без возможности восстановления.';
  }

  const card = cards.find(c => c.id === context.id);
  if (!card) return '';
  const cardTitle = formatCardTitle(card) || getCardBarcodeValue(card) || 'Маршрутная карта';
  return 'Карта «' + cardTitle + '» будет удалена без возможности восстановления.';
}

function openDeleteConfirm(context) {
  deleteContext = null;
  const modal = document.getElementById('delete-confirm-modal');
  const messageEl = document.getElementById('delete-confirm-message');
  const hintEl = document.getElementById('delete-confirm-hint');
  if (!modal || !messageEl || !context || !context.id) return;
  const message = buildDeleteConfirmMessage(context);
  if (!message) return;
  deleteContext = context;
  messageEl.textContent = message;
  if (hintEl) {
    hintEl.textContent = 'Нажмите «Удалить», чтобы полностью убрать запись из системы. «Отменить» закроет окно без удаления.';
  }
  modal.classList.remove('hidden');
}

function closeDeleteConfirm() {
  const modal = document.getElementById('delete-confirm-modal');
  deleteContext = null;
  if (modal) modal.classList.add('hidden');
}

function confirmDeletion() {
  if (!deleteContext || !deleteContext.id) {
    closeDeleteConfirm();
    return;
  }

  const { type, id } = deleteContext;
  deleteContext = null;
  let changed = false;

  if (type === 'group') {
    workorderOpenGroups.delete(id);
    const group = cards.find(c => c.id === id && isGroupCard(c));
    if (group) {
      getGroupChildren(group).forEach(child => workorderOpenCards.delete(child.id));
    }
    changed = deleteGroup(id);
  } else {
    workorderOpenCards.delete(id);
    changed = deleteCardById(id);
  }

  closeDeleteConfirm();
  if (changed) {
    saveData();
    renderEverything();
  }
}

function printGroupList(groupId) {
  const group = cards.find(c => c.id === groupId && isGroupCard(c));
  if (!group) return;
  const children = getGroupChildren(group).filter(c => !c.archived);
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write('<html><head><title>Список карт группы</title><style> .print-meta { margin: 12px 0; } .print-meta div { margin: 4px 0; font-size: 14px; } </style></head><body onload="window.print()">');
  win.document.write('<h3>Группа: ' + escapeHtml(group.name || '') + '</h3>');

  if (children.length > 0) {
    const firstCard = children[0];
    win.document.write('<div class="print-meta">');
    win.document.write('<div><strong>Номер / код заказа:</strong> ' + escapeHtml(firstCard.orderNo || '') + '</div>');
    win.document.write('<div><strong>Чертёж / обозначение детали:</strong> ' + escapeHtml(firstCard.drawing || '') + '</div>');
    win.document.write('<div><strong>Материал:</strong> ' + escapeHtml(firstCard.material || '') + '</div>');
    win.document.write('<div><strong>Номер договора:</strong> ' + escapeHtml(firstCard.contractNumber || '') + '</div>');
    win.document.write('<div><strong>Описание:</strong> ' + escapeHtml(firstCard.desc || '') + '</div>');
    win.document.write('</div>');
  }

  win.document.write('<ol>');
  children.forEach(child => {
    win.document.write('<li>' + escapeHtml(child.name || '') + ' — ' + escapeHtml(child.barcode || '') + '</li>');
  });
  win.document.write('</ol>');
  win.document.close();
}

async function openPrintPreview(url) {
  const win = window.open('', '_blank');
  if (!win) {
    alert('Разрешите всплывающие окна для печати.');
    return;
  }

  try {
    const res = await apiFetch(url, { method: 'GET' });
    if (!res.ok) {
      throw new Error('Ответ сервера ' + res.status);
    }
    const html = await res.text();
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
  } catch (err) {
    win.close();
    alert('Не удалось открыть печатную форму: ' + (err.message || err));
  }
}

function openGroupModal() {
  const modal = document.getElementById('group-modal');
  if (!modal || !activeCardDraft) return;
  const nameInput = document.getElementById('group-name');
  const qtyInput = document.getElementById('group-qty');
  if (nameInput) nameInput.value = activeCardDraft.name || '';
  if (qtyInput) qtyInput.value = activeCardDraft.quantity || 2;
  modal.classList.remove('hidden');
}

function closeGroupModal() {
  const modal = document.getElementById('group-modal');
  if (modal) modal.classList.add('hidden');
}

function createGroupFromDraft() {
  if (!activeCardDraft) return;
  ensureCardMeta(activeCardDraft, { skipSnapshot: true });
  const mkiConflict = validateMkiRouteCardNumber(activeCardDraft, cards);
  if (mkiConflict) {
    alert(mkiConflict);
    return;
  }
  const nameInput = document.getElementById('group-name');
  const qtyInput = document.getElementById('group-qty');
  const groupName = nameInput ? nameInput.value.trim() : '';
  const qty = qtyInput ? Math.max(1, toSafeCount(qtyInput.value)) : 1;
  const baseName = activeCardDraft.name || 'МК';
  const finalGroupName = groupName || baseName;
  const usedBarcodes = collectBarcodeSet();

  const newGroup = {
    id: genId('group'),
    isGroup: true,
    name: finalGroupName,
    barcode: generateUniqueCardCode128(usedBarcodes),
    orderNo: activeCardDraft.orderNo || '',
    contractNumber: activeCardDraft.contractNumber || '',
    cardType: activeCardDraft.cardType === 'MKI' ? 'MKI' : 'MK',
    status: 'NOT_STARTED',
    approvalStage: APPROVAL_STAGE_DRAFT,
    approvalProductionStatus: null,
    approvalSKKStatus: null,
    approvalTechStatus: null,
    rejectionReason: '',
    rejectionReadByUserName: '',
    rejectionReadAt: null,
    approvalThread: [],
    archived: false,
    attachments: [],
    createdAt: Date.now()
  };

  cards.push(newGroup);

  for (let i = 0; i < qty; i++) {
    const child = buildCardCopy(activeCardDraft, { nameOverride: (i + 1) + '. ' + baseName, groupId: newGroup.id });
    child.barcode = generateUniqueCardCode128(usedBarcodes);
    recalcCardStatus(child);
    ensureCardMeta(child);
    cards.push(child);
  }

  recalcCardStatus(newGroup);
  saveData();
  closeGroupModal();
  closeCardModal();
  renderEverything();
}

function createEmptyCardDraft(cardType = 'MK') {
  const normalizedType = cardType === 'MKI' ? 'MKI' : 'MK';
  const defaultName = normalizedType === 'MKI' ? 'Новая МКИ' : 'Новая карта';
  return {
    id: genId('card'),
    barcode: generateUniqueCardCode128(),
    cardType: normalizedType,
    name: defaultName,
    itemName: defaultName,
    routeCardNumber: '',
    documentDesignation: '',
    documentDate: getCurrentDateString(),
    issuedBySurname: '',
    programName: '',
    labRequestNumber: '',
    workBasis: '',
    supplyState: '',
    itemDesignation: '',
    supplyStandard: '',
    mainMaterials: '',
    mainMaterialGrade: '',
    batchSize: '',
    itemSerials: normalizedType === 'MKI' ? [] : '',
    specialNotes: '',
    quantity: '',
    sampleCount: '',
    sampleSerials: [],
    useItemList: false,
    drawing: '',
    material: '',
    contractNumber: '',
    orderNo: '',
    desc: '',
    responsibleProductionChief: '',
    responsibleSKKChief: '',
    responsibleTechLead: '',
    status: 'NOT_STARTED',
    approvalStage: APPROVAL_STAGE_DRAFT,
    approvalProductionStatus: null,
    approvalSKKStatus: null,
    approvalTechStatus: null,
    rejectionReason: '',
    rejectionReadByUserName: '',
    rejectionReadAt: null,
    approvalThread: [],
    archived: false,
    createdAt: Date.now(),
    logs: [],
    initialSnapshot: null,
    attachments: [],
    operations: []
  };
}

function cardSectionLabel(sectionKey) {
  const labels = {
    main: 'Основная информация',
    operations: 'Операции',
    add: 'Добавление операций'
  };
  return labels[sectionKey] || labels.main;
}

function updateCardSectionsVisibility() {
  // Override: Always show all sections inside tabs
  const sections = document.querySelectorAll('.card-section');
  sections.forEach(section => {
    section.classList.add('active');
    section.hidden = false;
  });
}

window.openTab = function(evt, tabName) {
    var i, tabcontent, tablinks;
    tabcontent = document.getElementsByClassName("tab-pane");
    for (i = 0; i < tabcontent.length; i++) {
        tabcontent[i].classList.remove("active");
    }
    tablinks = document.getElementsByClassName("tab-btn");
    for (i = 0; i < tablinks.length; i++) {
        tablinks[i].classList.remove("active");
    }
    const target = document.getElementById(tabName);
    if (target) target.classList.add("active");
    
    if (evt) {
        evt.currentTarget.classList.add("active");
    } else {
        const btn = Array.from(tablinks).find(b => b.getAttribute('onclick') && b.getAttribute('onclick').includes(`'${tabName}'`));
        if (btn) btn.classList.add("active");
    }
};

function updateCardSectionMenuItems() {
  const menu = document.getElementById('card-section-menu');
  if (!menu) return;
  menu.querySelectorAll('.card-section-menu-item[data-section-target]').forEach(item => {
    const key = item.getAttribute('data-section-target');
    const shouldHide = key === cardActiveSectionKey;
    item.classList.toggle('hidden', shouldHide);
    item.setAttribute('aria-hidden', shouldHide ? 'true' : 'false');
    item.tabIndex = shouldHide ? -1 : 0;
  });
}

function setActiveCardSection(sectionKey = 'main') {
  cardActiveSectionKey = sectionKey;
  const labelEl = document.getElementById('card-mobile-active-label');
  if (labelEl) {
    labelEl.textContent = cardSectionLabel(cardActiveSectionKey);
  }
  updateCardSectionMenuItems();
  updateCardSectionsVisibility();
}

function closeCardSectionMenu() {
  const toggle = document.getElementById('card-section-menu-toggle');
  const menu = document.getElementById('card-section-menu');
  if (menu) menu.classList.remove('open');
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
}

function setupCardSectionMenu() {
  const toggle = document.getElementById('card-section-menu-toggle');
  const menu = document.getElementById('card-section-menu');
  if (!toggle || !menu) return;

  toggle.addEventListener('click', () => {
    const isOpen = menu.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(isOpen));
  });

  menu.addEventListener('click', e => {
    const target = e.target.closest('button');
    if (!target) return;
    const sectionKey = target.getAttribute('data-section-target');
    const actionTarget = target.getAttribute('data-action-target');
    if (sectionKey) {
      setActiveCardSection(sectionKey);
      closeCardSectionMenu();
      return;
    }
    if (actionTarget) {
      const btn = document.getElementById(actionTarget);
      if (btn) btn.click();
      closeCardSectionMenu();
    }
  });

  window.addEventListener('resize', () => updateCardSectionsVisibility());
}

function setCardModalReadonly(readonly) {
  const modal = document.getElementById('card-modal');
  if (!modal) return;
  modal.classList.toggle('modal-readonly', readonly);
  const controls = modal.querySelectorAll('input, select, textarea, button');
  controls.forEach(ctrl => {
    const allowView = ctrl.dataset.allowView === 'true';
    if (readonly && !allowView) {
      if (!ctrl.disabled) ctrl.dataset.readonlyDisabled = 'true';
      ctrl.disabled = true;
    } else if (!readonly && ctrl.dataset.readonlyDisabled === 'true') {
      ctrl.disabled = false;
      delete ctrl.dataset.readonlyDisabled;
    }
  });
}

function openCardModal(cardId, options = {}) {
  const { fromRestore = false, cardType = 'MK', pageMode = false, renderMode, mountEl = null, readOnly = false } = options;
  const modal = document.getElementById('card-modal');
  if (!modal) return;
  setCardModalReadonly(false);
  const mode = renderMode || (pageMode ? 'page' : 'modal');
  cardRenderMode = mode;
  cardPageMount = mode === 'page' ? mountEl : null;
  if (mode === 'page') {
    if (!mountEl) return;
    mountModalToPage(modal, 'card', mountEl);
  } else {
    restoreModalToHome(modal, 'card');
  }
  closeImdxImportModal();
  closeImdxMissingModal();
  resetImdxImportState();
  focusCardsSection();
  activeCardOriginalId = cardId || null;
  if (cardId) {
    const card = cards.find(c => c.id === cardId);
    if (!card) return;
    activeCardDraft = cloneCard(card);
    activeCardIsNew = false;
  } else {
    activeCardDraft = createEmptyCardDraft(cardType);
    activeCardIsNew = true;
  }
  const isMki = activeCardDraft.cardType === 'MKI';
  modal.classList.toggle('is-mki', isMki);
  document.body.classList.toggle('is-mki', isMki);
  ensureCardMeta(activeCardDraft, { skipSnapshot: activeCardIsNew });
  if (activeCardIsNew) {
    activeCardDraft.documentDate = getCurrentDateString();
    if (!activeCardDraft.issuedBySurname) {
      activeCardDraft.issuedBySurname = getSurnameFromUser(currentUser);
    }
  }
  const effectiveReadOnly = readOnly || activeCardDraft.approvalStage !== APPROVAL_STAGE_DRAFT;
  const cardTypeLabel = activeCardDraft.cardType === 'MKI' ? 'МКИ' : 'МК';
  document.getElementById('card-modal-title').textContent = effectiveReadOnly
    ? 'Просмотр ' + cardTypeLabel
    : (activeCardIsNew ? 'Создание ' + cardTypeLabel : 'Редактирование ' + cardTypeLabel);
  document.getElementById('card-id').value = activeCardDraft.id;
  document.getElementById('card-route-number').value = activeCardDraft.routeCardNumber || '';
  document.getElementById('card-document-designation').value = activeCardDraft.documentDesignation || '';
  document.getElementById('card-date').value = activeCardDraft.documentDate || '';
  document.getElementById('card-issued-by').value = activeCardDraft.issuedBySurname || '';
  document.getElementById('card-program-name').value = activeCardDraft.programName || '';
  document.getElementById('card-lab-request').value = activeCardDraft.labRequestNumber || '';
  document.getElementById('card-work-basis').value = activeCardDraft.workBasis || '';
  document.getElementById('card-supply-state').value = activeCardDraft.supplyState || '';
  document.getElementById('card-item-designation').value = activeCardDraft.itemDesignation || '';
  document.getElementById('card-supply-standard').value = activeCardDraft.supplyStandard || '';
  document.getElementById('card-name').value = activeCardDraft.name || '';
  document.getElementById('card-main-materials').value = activeCardDraft.mainMaterials || '';
  document.getElementById('card-material').value = activeCardDraft.mainMaterialGrade || '';
  document.getElementById('card-qty').value = activeCardDraft.quantity != null ? activeCardDraft.quantity : '';
  const serialsTextarea = document.getElementById('card-item-serials');
  if (serialsTextarea) {
    const serialValue = Array.isArray(activeCardDraft.itemSerials)
      ? activeCardDraft.itemSerials.join('\n')
      : (activeCardDraft.itemSerials || '');
    serialsTextarea.value = serialValue;
  }
  const sampleQtyInput = document.getElementById('card-sample-qty');
  if (sampleQtyInput) {
    sampleQtyInput.value = activeCardDraft.sampleCount != null ? activeCardDraft.sampleCount : '';
  }
  document.getElementById('card-production-chief').value = activeCardDraft.responsibleProductionChief || '';
  document.getElementById('card-skk-chief').value = activeCardDraft.responsibleSKKChief || '';
  document.getElementById('card-tech-lead').value = activeCardDraft.responsibleTechLead || '';
  const useItemsCheckbox = document.getElementById('card-use-items');
  if (useItemsCheckbox) {
    useItemsCheckbox.checked = Boolean(activeCardDraft.useItemList);
    const label = useItemsCheckbox.closest('.toggle-row');
    if (label) {
        if (activeCardDraft.cardType === 'MKI') {
            label.classList.add('hidden');
        } else {
            label.classList.remove('hidden');
        }
    }
  }
  document.getElementById('card-desc').value = activeCardDraft.specialNotes || '';
  document.getElementById('card-status-text').textContent = cardStatusText(activeCardDraft);
  const attachBtn = document.getElementById('card-attachments-btn');
  if (attachBtn) {
    attachBtn.innerHTML = '📎 Файлы (' + (activeCardDraft.attachments ? activeCardDraft.attachments.length : 0) + ')';
  }
  const routeCodeInput = document.getElementById('route-op-code');
  if (routeCodeInput) routeCodeInput.value = '';
  const routeOpInput = document.getElementById('route-op');
  if (routeOpInput) routeOpInput.value = '';
  const routeCenterInput = document.getElementById('route-center');
  if (routeCenterInput) routeCenterInput.value = '';
  const routeQtyInput = document.getElementById('route-qty');
  routeQtyManual = false;
  if (routeQtyInput) routeQtyInput.value = activeCardDraft.quantity !== '' ? activeCardDraft.quantity : '';
  const routeSamplesToggle = document.getElementById('route-samples-toggle');
  if (routeSamplesToggle) routeSamplesToggle.checked = false;
  updateCardMainSummary();
  setCardMainCollapsed(false);
  renderRouteTableDraft();
  fillRouteSelectors();
  setProductsLayoutMode(activeCardDraft.cardType);
  renderMkiSerialTables();
  if (activeCardDraft.cardType === 'MKI') {
    applyMkiProductsGridLayout();
  } else {
    restoreProductsLayout();
  }
  updateRouteFormQuantityUI();
  cleanupMkiRouteFormUi();
  if (typeof window.openTab === 'function') {
    window.openTab(null, 'tab-main');
  }
  // setActiveCardSection('main'); // Disabled in favor of tabs
  closeCardSectionMenu();
  modal.classList.remove('hidden');
  setCardModalReadonly(effectiveReadOnly);
  if (mode === 'page') {
    modal.classList.add('page-mode');
    document.body.classList.add('page-card-mode');
  } else {
    modal.classList.remove('page-mode');
    document.body.classList.remove('page-card-mode');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setModalState({ type: 'card', cardId: activeCardDraft ? activeCardDraft.id : null }, { fromRestore });
  }
}

function closeCardModal(silent = false) {
  const modal = document.getElementById('card-modal');
  if (!modal) return;
  setCardModalReadonly(false);
  const wasPageMode = cardRenderMode === 'page' || modal.classList.contains('page-mode');
  modal.classList.add('hidden');
  modal.classList.remove('is-mki');
  document.body.classList.remove('is-mki');
  document.getElementById('card-form').reset();
  document.getElementById('route-form').reset();
  document.getElementById('route-table-wrapper').innerHTML = '';
  setCardMainCollapsed(false);
  closeImdxImportModal();
  closeImdxMissingModal();
  resetImdxImportState();
  activeCardDraft = null;
  activeCardOriginalId = null;
  activeCardIsNew = false;
  routeQtyManual = false;
  focusCardsSection();
  restoreModalToHome(modal, 'card');
  cardRenderMode = 'modal';
  cardPageMount = null;
  if (wasPageMode) {
    modal.classList.remove('page-mode');
    document.body.classList.remove('page-card-mode');
    return;
  }
  if (silent || restoringState) return;
  if (appState.modal && appState.modal.type === 'card') {
    history.back();
  } else {
    setModalState(null, { replace: true });
  }
}

async function saveCardDraft(options = {}) {
  if (!activeCardDraft) return null;
  const { closeModal = true, keepDraftOpen = false, skipRender = false } = options;
  const draft = cloneCard(activeCardDraft);
  draft.useItemList = Boolean(draft.useItemList);
  draft.operations = (draft.operations || []).map((op, idx) => ({
    ...op,
    order: typeof op.order === 'number' ? op.order : idx + 1,
    goodCount: toSafeCount(op.goodCount || 0),
    scrapCount: toSafeCount(op.scrapCount || 0),
    holdCount: toSafeCount(op.holdCount || 0),
    isSamples: draft.cardType === 'MKI' ? Boolean(op.isSamples) : false,
    quantity: getOperationQuantity(op, draft),
    autoCode: Boolean(op.autoCode),
    additionalExecutors: Array.isArray(op.additionalExecutors) ? op.additionalExecutors.slice(0, 2) : [],
    items: Array.isArray(op.items)
      ? op.items.map(item => ({
        id: item.id || genId('item'),
        name: typeof item.name === 'string' ? item.name : '',
        quantity: 1,
        goodCount: toSafeCount(item.goodCount || 0),
        scrapCount: toSafeCount(item.scrapCount || 0),
        holdCount: toSafeCount(item.holdCount || 0)
      }))
      : []
  }));
  renumberAutoCodesForCard(draft);
  recalcCardStatus(draft);
  ensureCardMeta(draft, { skipSnapshot: true });

  const mkiValidationError = validateMkiDraftConstraints(draft);
  if (mkiValidationError) {
    alert(mkiValidationError);
    return null;
  }

  const mkiConflictError = validateMkiRouteCardNumber(draft, cards);
  if (mkiConflictError) {
    alert(mkiConflictError);
    return null;
  }

  if (activeCardIsNew || activeCardOriginalId == null) {
    ensureCardMeta(draft);
    if (!draft.initialSnapshot) {
      const snapshot = cloneCard(draft);
      snapshot.logs = [];
      draft.initialSnapshot = snapshot;
    }
    recordCardLog(draft, { action: 'Создание МК', object: 'Карта', oldValue: '', newValue: draft.name || draft.barcode });
    cards.push(draft);
  } else {
    const idx = cards.findIndex(c => c.id === activeCardOriginalId);
    if (idx >= 0) {
      const original = cloneCard(cards[idx]);
      ensureCardMeta(original);
      ensureCardMeta(draft);
      draft.createdAt = original.createdAt || draft.createdAt;
      draft.initialSnapshot = original.initialSnapshot || draft.initialSnapshot;
      draft.logs = Array.isArray(original.logs) ? original.logs : [];
      logCardDifferences(original, draft);
      cards[idx] = draft;
    }
  }

  activeCardIsNew = false;
  activeCardOriginalId = draft.id;

  ensureUniqueBarcodes(cards);
  const savePromise = saveData();
  if (!skipRender) {
    renderEverything();
  }
  if (closeModal) {
    closeCardModal();
  } else if (keepDraftOpen) {
    activeCardDraft = cloneCard(draft);
    document.getElementById('card-status-text').textContent = cardStatusText(activeCardDraft);
    updateCardMainSummary();
  }

  await savePromise;
  return draft;
}

function syncCardDraftFromForm() {
  if (!activeCardDraft) return;
  activeCardDraft.routeCardNumber = document.getElementById('card-route-number').value.trim();
  activeCardDraft.documentDesignation = document.getElementById('card-document-designation').value.trim();
  activeCardDraft.documentDate = formatDateInputValue(document.getElementById('card-date').value.trim());
  activeCardDraft.issuedBySurname = document.getElementById('card-issued-by').value.trim();
  activeCardDraft.programName = document.getElementById('card-program-name').value.trim();
  activeCardDraft.labRequestNumber = document.getElementById('card-lab-request').value.trim();
  activeCardDraft.workBasis = document.getElementById('card-work-basis').value.trim();
  activeCardDraft.supplyState = document.getElementById('card-supply-state').value.trim();
  activeCardDraft.itemDesignation = document.getElementById('card-item-designation').value.trim();
  activeCardDraft.supplyStandard = document.getElementById('card-supply-standard').value.trim();
  activeCardDraft.itemName = document.getElementById('card-name').value.trim();
  activeCardDraft.name = activeCardDraft.itemName;
  activeCardDraft.mainMaterials = document.getElementById('card-main-materials').value.trim();
  activeCardDraft.mainMaterialGrade = document.getElementById('card-material').value.trim();
  const qtyRaw = document.getElementById('card-qty').value.trim();
  const qtyVal = qtyRaw === '' ? '' : Math.max(0, parseInt(qtyRaw, 10) || 0);
  activeCardDraft.quantity = Number.isFinite(qtyVal) ? qtyVal : '';
  activeCardDraft.batchSize = activeCardDraft.quantity;
  if (activeCardDraft.cardType === 'MKI') {
    const sampleRaw = document.getElementById('card-sample-qty').value.trim();
    const sampleVal = sampleRaw === '' ? '' : Math.max(0, parseInt(sampleRaw, 10) || 0);
    activeCardDraft.sampleCount = Number.isFinite(sampleVal) ? sampleVal : '';

    activeCardDraft.itemSerials = collectSerialValuesFromTable('card-item-serials-table');
    activeCardDraft.sampleSerials = collectSerialValuesFromTable('card-sample-serials-table');
    const normalizedItems = normalizeSerialInput(activeCardDraft.itemSerials);
    const normalizedSamples = normalizeSerialInput(activeCardDraft.sampleSerials);
    const qtyCount = activeCardDraft.quantity === '' ? 0 : toSafeCount(activeCardDraft.quantity);
    const sampleCount = activeCardDraft.sampleCount === '' ? 0 : toSafeCount(activeCardDraft.sampleCount);
    activeCardDraft.itemSerials = resizeSerialList(normalizedItems, qtyCount, { fillDefaults: true });
    activeCardDraft.sampleSerials = resizeSerialList(normalizedSamples, sampleCount, { fillDefaults: true });
  } else {
    activeCardDraft.itemSerials = document.getElementById('card-item-serials').value.trim();
    activeCardDraft.sampleCount = '';
    activeCardDraft.sampleSerials = [];
  }
  activeCardDraft.specialNotes = document.getElementById('card-desc').value.trim();
  activeCardDraft.desc = activeCardDraft.specialNotes;
  activeCardDraft.responsibleProductionChief = document.getElementById('card-production-chief').value.trim();
  activeCardDraft.responsibleSKKChief = document.getElementById('card-skk-chief').value.trim();
  activeCardDraft.responsibleTechLead = document.getElementById('card-tech-lead').value.trim();
  const useItemsCheckbox = document.getElementById('card-use-items');
  const prevUseList = Boolean(activeCardDraft.useItemList);
  activeCardDraft.useItemList = useItemsCheckbox ? useItemsCheckbox.checked : false;
  if (prevUseList !== activeCardDraft.useItemList && Array.isArray(activeCardDraft.operations)) {
    activeCardDraft.operations.forEach(op => normalizeOperationItems(activeCardDraft, op));
  }
}

function collectSerialValuesFromTable(tableId) {
  const table = document.getElementById(tableId);
  if (!table) return [];
  return Array.from(table.querySelectorAll('.serials-input')).map(input => input.value || '');
}

function renderSerialsTable(tableId, values = []) {
  const rows = (values || []).map((val, idx) => {
    return '<tr>' +
      '<td class="serials-index-cell">' + (idx + 1) + '.</td>' +
      '<td class="serials-input-cell">' +
        '<input class="serials-input" data-index="' + idx + '" value="' + escapeHtml(val || '') + '" placeholder="Без номера ' + (idx + 1) + '">' +
      '</td>' +
    '</tr>';
  }).join('');
  return '<table id="' + tableId + '" class="serials-table"><tbody>' + rows + '</tbody></table>';
}

function setProductsLayoutMode(cardType) {
  const isMki = cardType === 'MKI';
  const tab = document.getElementById('tab-products');
  if (tab) tab.classList.toggle('mki-mode', isMki);
  const serialsTableWrapper = document.getElementById('card-item-serials-table-wrapper');
  if (serialsTableWrapper) serialsTableWrapper.classList.toggle('hidden', !isMki);
  const serialsTextarea = document.getElementById('card-item-serials');
  if (serialsTextarea) serialsTextarea.classList.toggle('hidden', isMki);
  const sampleQtyField = document.getElementById('field-sample-qty');
  if (sampleQtyField) sampleQtyField.classList.toggle('hidden', !isMki);
  const sampleSerialsField = document.getElementById('field-sample-serials');
  if (sampleSerialsField) sampleSerialsField.classList.toggle('hidden', !isMki);
}

function getActiveCardSampleAvailability() {
  const isMki = activeCardDraft && activeCardDraft.cardType === 'MKI';
  const sampleCount = isMki ? toSafeCount(activeCardDraft.sampleCount || 0) : 0;
  return { isMki, sampleCount, hasSamples: isMki && sampleCount > 0 };
}

function cleanupMkiRouteFormUi() {
  if (!activeCardDraft || activeCardDraft.cardType !== 'MKI') return;
  const qtyBlock = document.querySelector('#route-form .mki-qty-block');
  const primaryToggle = document.getElementById('route-samples-col');
  const disabledSamplesText = 'Операции по образцам недоступны при нулевом количестве образцов';

  document.querySelectorAll('#route-form .route-samples-hint-text').forEach(node => node.remove());
  document.querySelectorAll('#route-form *').forEach(node => {
    if (node.textContent && node.textContent.trim() === disabledSamplesText) {
      node.remove();
    }
  });

  const toggles = Array.from(document.querySelectorAll('#route-form .mki-samples-toggle__label'));
  toggles.forEach(toggle => {
    const isPrimary = toggle === primaryToggle || (qtyBlock && qtyBlock.contains(toggle));
    if (!isPrimary) toggle.remove();
  });
}

function updateRouteFormQuantityUI() {
  const qtyLabel = document.getElementById('route-qty-label');
  const qtyInput = document.getElementById('route-qty');
  const samplesCol = document.getElementById('route-samples-col');
  const samplesToggle = document.getElementById('route-samples-toggle');
  const { isMki, hasSamples } = getActiveCardSampleAvailability();

  if (samplesCol) samplesCol.classList.toggle('hidden', !isMki);
  if (samplesToggle) {
    if (!hasSamples) samplesToggle.checked = false;
    samplesToggle.disabled = !hasSamples;
  }

  if (!qtyLabel || !qtyInput) return;
  const isSamplesMode = Boolean(samplesToggle && samplesToggle.checked);
  if (isMki) {
    qtyLabel.textContent = isSamplesMode ? 'Кол-во образцов' : 'Кол-во изделий';
    const value = isSamplesMode
      ? (activeCardDraft && activeCardDraft.sampleCount !== '' ? activeCardDraft.sampleCount : '')
      : (activeCardDraft && activeCardDraft.quantity !== '' ? activeCardDraft.quantity : '');
    qtyInput.value = value;
    qtyInput.readOnly = true;
    routeQtyManual = false;
    cleanupMkiRouteFormUi();
  } else {
    qtyLabel.textContent = 'Количество изделий';
    qtyInput.readOnly = false;
    if (activeCardDraft) {
      qtyInput.value = activeCardDraft.quantity !== '' ? activeCardDraft.quantity : '';
    }
  }
}

let originalProductsLayout = null;
let originalProductsLayoutChildren = null;

function getProductsLayoutBlockByLabel(tab, labelText) {
  const labels = Array.from(tab.querySelectorAll('label')).filter(lbl => lbl.textContent && lbl.textContent.trim() === labelText);
  for (const label of labels) {
    const productField = label.closest('.product-field');
    if (productField) return productField;
    const flexCol = label.closest('.flex-col');
    if (flexCol) return flexCol;
  }
  return null;
}

function ensureOriginalProductsLayoutCached() {
  if (originalProductsLayout) return;
  const layout = document.getElementById('products-layout');
  if (layout) {
    originalProductsLayout = layout;
    originalProductsLayoutChildren = Array.from(layout.children);
  }
}

function applyMkiProductsGridLayout() {
  if (!activeCardDraft || activeCardDraft.cardType !== 'MKI') return;
  const tab = document.getElementById('tab-products');
  if (!tab) return;
  ensureOriginalProductsLayoutCached();
  const existingGrid = tab.querySelector('.mki-products-grid');
  if (existingGrid) return;

  const batchBlock = getProductsLayoutBlockByLabel(tab, 'Размер партии');
  const sampleQtyBlock = getProductsLayoutBlockByLabel(tab, 'Количество образцов');
  const itemSerialsBlock = getProductsLayoutBlockByLabel(tab, 'Индивидуальные номера изделий');
  const sampleSerialsBlock = getProductsLayoutBlockByLabel(tab, 'Индивидуальные номера образцов');

  const grid = document.createElement('div');
  grid.className = 'mki-products-grid';

  const cells = [
    { className: 'mki-products-cell mki-products-cell--left-top', block: batchBlock },
    { className: 'mki-products-cell mki-products-cell--right-top', block: sampleQtyBlock },
    { className: 'mki-products-cell mki-products-cell--left-bottom', block: itemSerialsBlock },
    { className: 'mki-products-cell mki-products-cell--right-bottom', block: sampleSerialsBlock },
  ];

  cells.forEach(cellConfig => {
    const cell = document.createElement('div');
    cell.className = cellConfig.className;
    if (cellConfig.block) {
      cell.appendChild(cellConfig.block);
    }
    grid.appendChild(cell);
  });

  tab.innerHTML = '';
  tab.appendChild(grid);
}

function restoreProductsLayout() {
  ensureOriginalProductsLayoutCached();
  const tab = document.getElementById('tab-products');
  if (!tab || !originalProductsLayout) return;
  const isAlreadyDefault = tab.contains(originalProductsLayout) && !tab.querySelector('.mki-products-grid');
  if (isAlreadyDefault) return;

  if (Array.isArray(originalProductsLayoutChildren)) {
    originalProductsLayoutChildren.forEach(child => {
      if (child && child.parentElement !== originalProductsLayout) {
        originalProductsLayout.appendChild(child);
      }
    });
  }

  tab.innerHTML = '';
  tab.appendChild(originalProductsLayout);
}

function renderMkiSerialTables() {
  if (!activeCardDraft || activeCardDraft.cardType !== 'MKI') return;
  const qty = activeCardDraft.quantity === '' ? 0 : toSafeCount(activeCardDraft.quantity);
  const normalizedItems = normalizeSerialInput(activeCardDraft.itemSerials);
  activeCardDraft.itemSerials = resizeSerialList(normalizedItems, qty, { fillDefaults: true });
  const itemWrapper = document.getElementById('card-item-serials-table-wrapper');
  if (itemWrapper) {
    itemWrapper.innerHTML = renderSerialsTable('card-item-serials-table', activeCardDraft.itemSerials);
  }

  const sampleCount = activeCardDraft.sampleCount === '' ? 0 : toSafeCount(activeCardDraft.sampleCount);
  const normalizedSamples = normalizeSerialInput(activeCardDraft.sampleSerials);
  activeCardDraft.sampleSerials = resizeSerialList(normalizedSamples, sampleCount, { fillDefaults: true });
  const sampleField = document.getElementById('field-sample-serials');
  if (sampleField) sampleField.classList.toggle('hidden', sampleCount === 0);
  const sampleWrapper = document.getElementById('card-sample-serials-table-wrapper');
  if (sampleWrapper) {
    sampleWrapper.innerHTML = sampleCount > 0
      ? renderSerialsTable('card-sample-serials-table', activeCardDraft.sampleSerials)
      : '';
  }
}

function logCardDifferences(original, updated) {
  if (!original || !updated) return;
  const cardRef = updated;
  const fields = [
    'itemName',
    'routeCardNumber',
    'documentDesignation',
    'documentDate',
    'issuedBySurname',
    'programName',
    'labRequestNumber',
    'workBasis',
    'supplyState',
    'itemDesignation',
    'supplyStandard',
    'mainMaterials',
    'mainMaterialGrade',
    'batchSize',
    'itemSerials',
    'sampleCount',
    'sampleSerials',
    'specialNotes',
    'responsibleProductionChief',
    'responsibleSKKChief',
    'responsibleTechLead',
    'useItemList'
  ];
  fields.forEach(field => {
    if ((original[field] || '') !== (updated[field] || '')) {
      recordCardLog(cardRef, { action: 'Изменение поля', object: 'Карта', field, oldValue: original[field] || '', newValue: updated[field] || '' });
    }
  });

  if (original.status !== updated.status) {
    recordCardLog(cardRef, { action: 'Статус карты', object: 'Карта', field: 'status', oldValue: original.status, newValue: updated.status });
  }

  if (original.archived !== updated.archived) {
    recordCardLog(cardRef, { action: 'Архивирование', object: 'Карта', field: 'archived', oldValue: original.archived, newValue: updated.archived });
  }

  const originalAttachments = Array.isArray(original.attachments) ? original.attachments.length : 0;
  const updatedAttachments = Array.isArray(updated.attachments) ? updated.attachments.length : 0;
  if (originalAttachments !== updatedAttachments) {
    recordCardLog(cardRef, { action: 'Файлы', object: 'Карта', field: 'attachments', oldValue: originalAttachments, newValue: updatedAttachments });
  }

  const originalOps = Array.isArray(original.operations) ? original.operations : [];
  const updatedOps = Array.isArray(updated.operations) ? updated.operations : [];
  const originalMap = new Map(originalOps.map(op => [op.id, op]));
  const updatedMap = new Map(updatedOps.map(op => [op.id, op]));

  updatedOps.forEach(op => {
    const prev = originalMap.get(op.id);
    if (!prev) {
      recordCardLog(cardRef, { action: 'Добавление операции', object: opLogLabel(op), targetId: op.id, oldValue: '', newValue: `${op.centerName || ''} / ${op.executor || ''}`.trim() });
      return;
    }

    if ((prev.centerName || '') !== (op.centerName || '')) {
      recordCardLog(cardRef, { action: 'Изменение операции', object: opLogLabel(op), field: 'centerName', targetId: op.id, oldValue: prev.centerName || '', newValue: op.centerName || '' });
    }
    if ((prev.opCode || '') !== (op.opCode || '') || (prev.opName || '') !== (op.opName || '')) {
      recordCardLog(cardRef, { action: 'Изменение операции', object: opLogLabel(op), field: 'operation', targetId: op.id, oldValue: opLogLabel(prev), newValue: opLogLabel(op) });
    }
    if ((prev.executor || '') !== (op.executor || '')) {
      recordCardLog(cardRef, { action: 'Исполнитель', object: opLogLabel(op), field: 'executor', targetId: op.id, oldValue: prev.executor || '', newValue: op.executor || '' });
    }
    if ((prev.plannedMinutes || 0) !== (op.plannedMinutes || 0)) {
      recordCardLog(cardRef, { action: 'Плановое время', object: opLogLabel(op), field: 'plannedMinutes', targetId: op.id, oldValue: prev.plannedMinutes || 0, newValue: op.plannedMinutes || 0 });
    }
    if ((prev.order || 0) !== (op.order || 0)) {
      recordCardLog(cardRef, { action: 'Порядок операции', object: opLogLabel(op), field: 'order', targetId: op.id, oldValue: prev.order || 0, newValue: op.order || 0 });
    }
  });

  originalOps.forEach(op => {
    if (!updatedMap.has(op.id)) {
      recordCardLog(cardRef, { action: 'Удаление операции', object: opLogLabel(op), targetId: op.id, oldValue: `${op.centerName || ''} / ${op.executor || ''}`.trim(), newValue: '' });
    }
  });
}

function getAttachmentTargetCard() {
  if (!attachmentContext) return null;
  if (attachmentContext.source === 'draft') {
    return activeCardDraft;
  }
  return cards.find(c => c.id === attachmentContext.cardId);
}

function renderAttachmentsModal() {
  const modal = document.getElementById('attachments-modal');
  if (!modal || !attachmentContext) return;
  const card = getAttachmentTargetCard();
  const title = document.getElementById('attachments-title');
  const list = document.getElementById('attachments-list');
  const uploadHint = document.getElementById('attachments-upload-hint');
  if (!card || !list || !title || !uploadHint) return;
  ensureAttachments(card);
  title.textContent = formatCardTitle(card) || getCardBarcodeValue(card) || 'Файлы карты';
  const files = card.attachments || [];
  if (!files.length) {
    list.innerHTML = '<p>Файлы ещё не добавлены.</p>';
  } else {
    let html = '<table class="attachments-table"><thead><tr><th>Имя файла</th><th>Размер</th><th>Дата</th><th>Действия</th></tr></thead><tbody>';
    files.forEach(file => {
      const date = new Date(file.createdAt || Date.now()).toLocaleString();
      html += '<tr>' +
        '<td>' + escapeHtml(file.name || 'файл') + '</td>' +
        '<td>' + escapeHtml(formatBytes(file.size)) + '</td>' +
        '<td>' + escapeHtml(date) + '</td>' +
        '<td><div class="table-actions">' +
        '<button class="btn-small" data-preview-id="' + file.id + '">Открыть</button>' +
        '<button class="btn-small" data-download-id="' + file.id + '">Скачать</button>' +
        '<button class="btn-small btn-danger" data-delete-id="' + file.id + '">Удалить</button>' +
        '</div></td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    list.innerHTML = wrapTable(html);
  }
  uploadHint.textContent = 'Допустимые форматы: pdf, doc, jpg, архив. Максимум ' + formatBytes(ATTACH_MAX_SIZE) + '.';

  list.querySelectorAll('button[data-preview-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-preview-id');
      const cardRef = getAttachmentTargetCard();
      if (!cardRef) return;
      const file = (cardRef.attachments || []).find(f => f.id === id);
      if (!file) return;
      previewAttachment(file);
    });
  });

  list.querySelectorAll('button[data-download-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-download-id');
      const cardRef = getAttachmentTargetCard();
      if (!cardRef) return;
      const file = (cardRef.attachments || []).find(f => f.id === id);
      if (!file) return;
      downloadAttachment(file);
    });
  });

  list.querySelectorAll('button[data-delete-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-delete-id');
      deleteAttachment(id);
    });
  });
}

function downloadAttachment(file) {
  if (!file) return;
  if (file.content) {
    const blob = dataUrlToBlob(file.content, file.type);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = file.name || 'file';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
    return;
  }
  if (file.id) {
    window.open('/files/' + file.id, '_blank', 'noopener');
  }
}

function previewAttachment(file) {
  if (!file) return;
  if (file.content) {
    const blob = dataUrlToBlob(file.content, file.type);
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return;
  }
  if (file.id) {
    window.open('/files/' + file.id, '_blank', 'noopener');
  }
}

async function deleteAttachment(fileId) {
  const card = getAttachmentTargetCard();
  if (!card) return;
  ensureAttachments(card);
  const before = card.attachments.length;
  const idx = card.attachments.findIndex(f => f.id === fileId);
  if (idx < 0) return;
  card.attachments.splice(idx, 1);
  recordCardLog(card, { action: 'Файлы', object: 'Карта', field: 'attachments', oldValue: before, newValue: card.attachments.length });
  if (attachmentContext && attachmentContext.source === 'live') {
    await saveData();
    renderEverything();
  }
  renderAttachmentsModal();
  updateAttachmentCounters(card.id);
}

async function addAttachmentsFromFiles(fileList) {
  const card = getAttachmentTargetCard();
  if (!card || !fileList || !fileList.length) return;
  ensureAttachments(card);
  const beforeCount = card.attachments.length;
  const filesArray = Array.from(fileList);
  const allowed = ATTACH_ACCEPT.split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
  const newFiles = [];

  for (const file of filesArray) {
    const ext = ('.' + (file.name.split('.').pop() || '')).toLowerCase();
    if (allowed.length && !allowed.includes(ext)) {
      alert('Тип файла не поддерживается: ' + file.name);
      continue;
    }
    if (file.size > ATTACH_MAX_SIZE) {
      alert('Файл ' + file.name + ' превышает лимит ' + formatBytes(ATTACH_MAX_SIZE));
      continue;
    }
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    newFiles.push({
      id: genId('file'),
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      content: dataUrl,
      createdAt: Date.now()
    });
  }

  if (newFiles.length) {
    card.attachments.push(...newFiles);
    recordCardLog(card, { action: 'Файлы', object: 'Карта', field: 'attachments', oldValue: beforeCount, newValue: card.attachments.length });
    if (attachmentContext.source === 'live') {
      await saveData();
      renderEverything();
    }
    renderAttachmentsModal();
    updateAttachmentCounters(card.id);
  }
}

function openAttachmentsModal(cardId, source = 'live') {
  const modal = document.getElementById('attachments-modal');
  if (!modal) return;
  const card = source === 'draft' ? activeCardDraft : cards.find(c => c.id === cardId);
  if (!card) return;
  attachmentContext = { cardId: card.id, source };
  renderAttachmentsModal();
  modal.classList.remove('hidden');
}

function closeAttachmentsModal() {
  const modal = document.getElementById('attachments-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  const input = document.getElementById('attachments-input');
  if (input) input.value = '';
  attachmentContext = null;
}

function updateAttachmentCounters(cardId) {
  const count = (() => {
    if (activeCardDraft && activeCardDraft.id === cardId) {
      return (activeCardDraft.attachments || []).length;
    }
    const card = cards.find(c => c.id === cardId);
    return card ? (card.attachments || []).length : 0;
  })();

  const cardBtn = document.getElementById('card-attachments-btn');
  if (cardBtn && activeCardDraft && activeCardDraft.id === cardId) {
    cardBtn.innerHTML = '📎 Файлы (' + count + ')';
  }
}

function openGroupExecutorModal(groupId) {
  const modal = document.getElementById('group-executor-modal');
  const executorInput = document.getElementById('group-executor-input');
  const opCodeInput = document.getElementById('group-op-code-input');
  const group = cards.find(c => c.id === groupId && isGroupCard(c));
  if (!modal || !group) return;
  groupExecutorContext = { groupId };
  if (executorInput) executorInput.value = '';
  if (opCodeInput) opCodeInput.value = '';
  modal.classList.remove('hidden');
  if (executorInput) executorInput.focus();
}

function closeGroupExecutorModal() {
  const modal = document.getElementById('group-executor-modal');
  if (modal) modal.classList.add('hidden');
  groupExecutorContext = null;
}

function applyGroupExecutorToGroup() {
  const executorInput = document.getElementById('group-executor-input');
  const opCodeInput = document.getElementById('group-op-code-input');
  if (!groupExecutorContext) return;

  const rawExecutor = (executorInput ? executorInput.value : '').trim();
  const executor = sanitizeExecutorName(rawExecutor);
  const opCodeRaw = (opCodeInput ? opCodeInput.value : '').trim();
  const group = cards.find(c => c.id === groupExecutorContext.groupId && isGroupCard(c));

  if (!group) {
    closeGroupExecutorModal();
    return;
  }

  if (executor && !isEligibleExecutorName(executor)) {
    alert('Выберите исполнителя со статусом "Рабочий" (пользователь Abyss недоступен).');
    if (executorInput) executorInput.value = '';
    return;
  }

  if (!executor && rawExecutor) {
    alert('Пользователь Abyss недоступен для выбора. Выберите другого исполнителя.');
    if (executorInput) executorInput.value = '';
    return;
  }

  if (!executor || !opCodeRaw) {
    alert('Укажите группового исполнителя и код операции.');
    return;
  }

  const targetCode = opCodeRaw.toUpperCase();
  const children = getGroupChildren(group).filter(c => !c.archived);
  let matched = 0;
  let updated = 0;

  children.forEach(card => {
    (card.operations || []).forEach(op => {
      const opCodeValue = (op.opCode || '').trim().toUpperCase();
      if (opCodeValue !== targetCode) return;
      matched++;
      const prevExecutor = op.executor || '';
      const prevExtras = Array.isArray(op.additionalExecutors) ? [...op.additionalExecutors] : [];
      const extrasChanged = prevExtras.length > 0;
      const executorChanged = prevExecutor !== executor;
      op.executor = executor;
      op.additionalExecutors = [];
      if (executorChanged) {
        recordCardLog(card, { action: 'Исполнитель', object: opLogLabel(op), field: 'executor', targetId: op.id, oldValue: prevExecutor, newValue: executor });
      }
      if (extrasChanged) {
        recordCardLog(card, { action: 'Доп. исполнитель', object: opLogLabel(op), field: 'additionalExecutors', targetId: op.id, oldValue: prevExtras.join(', '), newValue: 'очищено' });
      }
      if (executorChanged || extrasChanged) {
        updated++;
      }
    });
    recalcCardStatus(card);
  });

  recalcCardStatus(group);

  if (!matched) {
    alert('В группе нет операций с указанным кодом.');
    return;
  }

  if (updated) {
    saveData();
    renderDashboard();
  }
  renderWorkordersTable();
  closeGroupExecutorModal();
}

function buildLogHistoryTable(card) {
  const logs = (card.logs || []).slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
  if (!logs.length) return '<p>История изменений пока отсутствует.</p>';
  let html = '<table><thead><tr><th>Дата/время</th><th>Тип действия</th><th>Объект</th><th>Старое значение</th><th>Новое значение</th></tr></thead><tbody>';
  logs.forEach(entry => {
    const date = new Date(entry.ts || Date.now()).toLocaleString();
    html += '<tr>' +
      '<td>' + escapeHtml(date) + '</td>' +
      '<td>' + escapeHtml(entry.action || '') + '</td>' +
      '<td>' + escapeHtml(entry.object || '') + (entry.field ? ' (' + escapeHtml(entry.field) + ')' : '') + '</td>' +
      '<td>' + escapeHtml(entry.oldValue || '') + '</td>' +
      '<td>' + escapeHtml(entry.newValue || '') + '</td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  return html;
}

function buildExecutorHistory(card, op) {
  const entries = (card.logs || [])
    .filter(entry => entry.targetId === op.id && entry.field === 'executor')
    .sort((a, b) => (a.ts || 0) - (b.ts || 0));
  if (!entries.length) {
    return op.executor || '';
  }
  const chain = [];
  entries.forEach((entry, idx) => {
    if (idx === 0 && entry.oldValue) chain.push(entry.oldValue);
    if (entry.newValue) chain.push(entry.newValue);
  });
  if (!chain.length && op.executor) chain.push(op.executor);
  return chain.filter(Boolean).join(' → ');
}

function buildAdditionalExecutorsHistory(card, op) {
  const entries = (card.logs || [])
    .filter(entry => entry.targetId === op.id && entry.field === 'additionalExecutors')
    .sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const lines = [];
  const seen = new Set();

  entries.forEach(entry => {
    const oldVal = (entry.oldValue || '').trim();
    const newVal = (entry.newValue || '').trim();
    const isCountChange = /^\d+$/.test(newVal) && (!oldVal || /^\d+$/.test(oldVal));
    if (isCountChange) return;

    if (oldVal && newVal && newVal !== oldVal && newVal !== 'удален') {
      lines.push(escapeHtml(oldVal) + ' → ' + escapeHtml(newVal));
      seen.add(oldVal);
      seen.add(newVal);
    } else if (!oldVal && newVal && newVal !== 'удален') {
      lines.push(escapeHtml(newVal));
      seen.add(newVal);
    } else if (oldVal && (!newVal || newVal === 'удален')) {
      lines.push(escapeHtml(oldVal) + ' (удален)');
      seen.add(oldVal);
    }
  });

  const currentExtras = Array.isArray(op.additionalExecutors) ? op.additionalExecutors : [];
  currentExtras.forEach(name => {
    const clean = (name || '').trim();
    if (!clean || seen.has(clean)) return;
    lines.push(escapeHtml(clean));
    seen.add(clean);
  });

  return lines.filter(Boolean);
}

function buildExecutorHistoryCell(card, op) {
  const mainHistory = buildExecutorHistory(card, op) || '';
  const extraHistory = buildAdditionalExecutorsHistory(card, op);
  if (!mainHistory && !extraHistory.length) return '';

  let html = '';
  if (mainHistory) {
    html += '<div class="executor-history-main">' + escapeHtml(mainHistory) + '</div>';
  }
  if (extraHistory.length) {
    html += '<div class="executor-history-extras">' +
      extraHistory.map(line => '<div class="executor-history-line">' + line + '</div>').join('') +
      '</div>';
  }
  return html;
}

function buildSummaryTable(card) {
  const opsSorted = [...(card.operations || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  if (!opsSorted.length) return '<p>Маршрут пока пуст.</p>';
  let html = '<table><thead><tr>' +
    '<th>Порядок</th><th>Подразделение</th><th>Код операции</th><th>Наименование операции</th><th>Исполнитель</th><th>План (мин)</th><th>Статус</th><th>Дата и время Н/К</th><th>Текущее / факт. время</th><th>Комментарии</th>' +
    '</tr></thead><tbody>';

  opsSorted.forEach((op, idx) => {
    normalizeOperationItems(card, op);
    op.executor = sanitizeExecutorName(op.executor || '');
      if (Array.isArray(op.additionalExecutors)) {
        op.additionalExecutors = op.additionalExecutors
          .map(name => sanitizeExecutorName(name || ''))
          .slice(0, 3);
      } else {
        op.additionalExecutors = [];
      }
    const rowId = card.id + '::' + op.id;
    const elapsed = getOperationElapsedSeconds(op);
    let timeCell = '';
    if (op.status === 'IN_PROGRESS' || op.status === 'PAUSED') {
      timeCell = '<span class="wo-timer" data-row-id="' + rowId + '">' + formatSecondsToHMS(elapsed) + '</span>';
    } else if (op.status === 'DONE') {
      const seconds = typeof op.elapsedSeconds === 'number' && op.elapsedSeconds
        ? op.elapsedSeconds
        : (op.actualSeconds || 0);
      timeCell = formatSecondsToHMS(seconds);
    }

    const executorCell = buildExecutorHistoryCell(card, op) || escapeHtml(op.executor || '');
    const startEndCell = formatStartEnd(op);

    html += '<tr data-row-id="' + rowId + '">' +
      '<td>' + (idx + 1) + '</td>' +
      '<td>' + escapeHtml(op.centerName) + '</td>' +
      '<td>' + escapeHtml(op.opCode || '') + '</td>' +
      '<td>' + renderOpName(op, { card }) + '</td>' +
      '<td>' + executorCell + '</td>' +
      '<td>' + (op.plannedMinutes || '') + '</td>' +
      '<td>' + statusBadge(op.status) + '</td>' +
      '<td>' + startEndCell + '</td>' +
      '<td>' + timeCell + '</td>' +
      '<td>' + escapeHtml(op.comment || '') + '</td>' +
      '</tr>';

    html += renderQuantityRow(card, op, { readonly: true, colspan: 10 });
  });

  html += '</tbody></table>';
  return html;
}

function buildInitialSummaryTable(card) {
  const opsSorted = [...(card.operations || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  if (!opsSorted.length) return '<p>Маршрут пока пуст.</p>';
  let html = '<table><thead><tr>' +
    '<th>Порядок</th><th>Подразделение</th><th>Код операции</th><th>Наименование операции</th><th>Исполнитель</th><th>План (мин)</th>' +
    '</tr></thead><tbody>';

  opsSorted.forEach((op, idx) => {
    normalizeOperationItems(card, op);
    const executorCell = buildExecutorHistoryCell(card, op) || escapeHtml(op.executor || '');

    html += '<tr>' +
      '<td>' + (idx + 1) + '</td>' +
      '<td>' + escapeHtml(op.centerName) + '</td>' +
      '<td>' + escapeHtml(op.opCode || '') + '</td>' +
      '<td>' + renderOpName(op, { card }) + '</td>' +
      '<td>' + executorCell + '</td>' +
      '<td>' + (op.plannedMinutes || '') + '</td>' +
      '</tr>';

    html += renderQuantityRow(card, op, { readonly: true, colspan: 6, blankForPrint: true });
  });

  html += '</tbody></table>';
  return html;
}

function buildInitialSnapshotHtml(card) {
  if (!card) return '';
  const snapshot = card.initialSnapshot || card;
  const infoBlock = buildCardInfoBlock(snapshot, { startCollapsed: true });
  const opsHtml = buildInitialSummaryTable(snapshot);
  const wrappedOps = opsHtml.trim().startsWith('<table') ? wrapTable(opsHtml) : opsHtml;
  return infoBlock + wrappedOps;
}

function renderInitialSnapshot(card) {
  const container = document.getElementById('log-initial-view');
  if (!container || !card) return;
  container.innerHTML = buildInitialSnapshotHtml(card);
}

function renderLogModal(cardId) {
  const modal = document.getElementById('log-modal');
  if (!modal) return;
  const card = cards.find(c => c.id === cardId);
  if (!card) return;
  logContextCardId = card.id;
  const barcodeContainer = document.getElementById('log-barcode-svg');
  const barcodeValue = getCardBarcodeValue(card);
  renderBarcodeInto(barcodeContainer, barcodeValue);
  const barcodeNum = document.getElementById('log-barcode-number');
  if (barcodeNum) {
    barcodeNum.textContent = barcodeValue || '(нет номера МК)';
    barcodeNum.classList.toggle('hidden', Boolean(barcodeContainer && barcodeValue));
  }
  const nameEl = document.getElementById('log-card-name');
  if (nameEl) nameEl.textContent = formatCardTitle(card);
  const orderEl = document.getElementById('log-card-order');
  if (orderEl) orderEl.textContent = card.orderNo || '';
  const statusEl = document.getElementById('log-card-status');
  if (statusEl) statusEl.textContent = cardStatusText(card);
  const createdEl = document.getElementById('log-card-created');
  if (createdEl) createdEl.textContent = new Date(card.createdAt || Date.now()).toLocaleString();

  renderInitialSnapshot(card);
  const historyContainer = document.getElementById('log-history-table');
  if (historyContainer) historyContainer.innerHTML = buildLogHistoryTable(card);
  const summaryContainer = document.getElementById('log-summary-table');
  if (summaryContainer) summaryContainer.innerHTML = buildSummaryTable(card);

  bindCardInfoToggles(modal, { defaultCollapsed: true });

  modal.classList.remove('hidden');
}

function openLogModal(cardId, options = {}) {
  const { fromRestore = false } = options;
  renderLogModal(cardId);
  setModalState({ type: 'log', cardId }, { fromRestore });
}

function closeLogModal(silent = false) {
  const modal = document.getElementById('log-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  logContextCardId = null;
  if (silent || restoringState) return;
  if (appState.modal && appState.modal.type === 'log') {
    history.back();
  } else {
    setModalState(null, { replace: true });
  }
}

function printCardView(card) {
  if (!card || !card.id) return;
  const draft = cloneCard(card);
  ensureCardMeta(draft, { skipSnapshot: true });
  const validationError = validateMkiDraftConstraints(draft);
  if (validationError) {
    alert(validationError);
    return;
  }
  const url = '/print/mk/' + encodeURIComponent(card.id);
  openPrintPreview(url);
}

function setupLogModal() {
  const modal = document.getElementById('log-modal');
  const closeBtn = document.getElementById('log-close');
  const printBtn = document.getElementById('log-print-summary');
  const printAllBtn = document.getElementById('log-print-all');
  const closeBottomBtn = document.getElementById('log-close-bottom');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => closeLogModal());
  }
  if (closeBottomBtn) {
    closeBottomBtn.addEventListener('click', () => closeLogModal());
  }
  if (printBtn) {
    printBtn.addEventListener('click', async () => {
      if (!logContextCardId) return;
      const url = '/print/log/summary/' + encodeURIComponent(logContextCardId);
      await openPrintPreview(url);
    });
  }
  if (printAllBtn) {
    printAllBtn.addEventListener('click', async () => {
      if (!logContextCardId) return;
      const url = '/print/log/full/' + encodeURIComponent(logContextCardId);
      await openPrintPreview(url);
    });
  }
}
