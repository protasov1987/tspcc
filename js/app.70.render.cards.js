// === РЕНДЕРИНГ МАРШРУТНЫХ КАРТ ===
function renderCardStatusCell(card) {
  if (!card) return '';
  const html = buildDashboardLikeStatusHtml(card);
  return '<span class="cards-status-text dashboard-card-status" data-card-id="' + card.id + '">' + html + '</span>';
}

function buildCardsTableRowHtml(card) {
  const opsCount = (typeof card.__liveOpsCount === 'number')
    ? card.__liveOpsCount
    : (card.operations ? card.operations.length : 0);
  const filesCount = (typeof card.__liveFilesCount === 'number')
    ? card.__liveFilesCount
    : getCardFilesCount(card);
  const barcodeValue = getCardBarcodeValue(card);
  const displayRouteNumber = (card.routeCardNumber || card.orderNo || '').toString().trim() || barcodeValue;
  return '<tr data-card-id="' + card.id + '">' +
    '<td><button class="btn-link barcode-link" data-id="' + card.id + '" title="' + escapeHtml(barcodeValue) + '">' +
      '<div class="mk-cell">' +
        '<div class="mk-no">' + escapeHtml(displayRouteNumber) + '</div>' +
        '<div class="mk-qr">(' + escapeHtml(barcodeValue) + ')</div>' +
      '</div>' +
    '</button></td>' +
    '<td>' + escapeHtml(card.name || '') + '</td>' +
    '<td>' + renderCardStatusCell(card) + '</td>' +
    '<td>' + escapeHtml(card.issuedBySurname || '') + '</td>' +
    '<td>' + renderApprovalStageCell(card) + '</td>' +
    '<td><span class="cards-ops-count" data-card-id="' + card.id + '">' + opsCount + '</span></td>' +
    '<td><button class="btn-small clip-btn" data-attach-card="' + card.id + '">📎 <span class="clip-count">' + filesCount + '</span></button></td>' +
    '<td><div class="table-actions">' +
    '<button class="btn-small" data-action="edit-card" data-id="' + card.id + '">Открыть</button>' +
    '<button class="btn-small" data-action="print-card" data-id="' + card.id + '">Печать</button>' +
    '<button class="btn-small" data-action="copy-card" data-id="' + card.id + '">Копировать</button>' +
    '<button class="btn-small approval-dialog-btn' + (card.approvalStage === APPROVAL_STAGE_REJECTED && card.rejectionReason && !card.rejectionReadByUserName ? ' btn-danger' : '') + '" data-action="approval-dialog" data-id="' + card.id + '">Согласование</button>' +
    '<button class="btn-small btn-delete" data-action="delete-card" data-id="' + card.id + '">🗑️</button>' +
    '</div></td>' +
    '</tr>';
}

function bindCardsRowActions(scope) {
  if (!scope) return;
  scope.querySelectorAll('button[data-action="edit-card"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cardId = btn.getAttribute('data-id');
      const card = cards.find(item => item.id === cardId);
      if (!card) {
        showToast('Маршрутная карта не найдена.');
        navigateToRoute('/cards');
        return;
      }
      const qr = normalizeQrId(card.qrId || '');
      const targetId = isValidScanId(qr) ? qr : card.id;
      navigateToRoute('/cards/' + encodeURIComponent(targetId));
    });
  });

  scope.querySelectorAll('button[data-action="copy-card"]').forEach(btn => {
    btn.addEventListener('click', () => {
      duplicateCard(btn.getAttribute('data-id'));
    });
  });

  scope.querySelectorAll('button[data-action="print-card"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = cards.find(c => c.id === btn.getAttribute('data-id'));
      if (!card) return;
      printCardView(card);
    });
  });

  scope.querySelectorAll('button[data-action="delete-card"]').forEach(btn => {
    btn.addEventListener('click', () => {
      openDeleteConfirm({ type: 'card', id: btn.getAttribute('data-id') });
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

  scope.querySelectorAll('button[data-action="approval-dialog"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cardId = btn.getAttribute('data-id');
      openApprovalDialog(cardId);
    });
  });
}

function compareCardsLiveInsertOrder(cardA, cardB, termRaw) {
  if (termRaw) {
    return cardSearchScore(cardB, termRaw) - cardSearchScore(cardA, termRaw);
  }

  if (!cardsSortKey) return 0;

  const getValue = (card) => {
    if (cardsSortKey === 'route') return getCardRouteNumberForSort(card);
    if (cardsSortKey === 'name') return getCardNameForSort(card);
    if (cardsSortKey === 'status') return cardStatusText(card) || '';
    if (cardsSortKey === 'author') return card.issuedBySurname || '';
    if (cardsSortKey === 'stage') return getApprovalStageLabel(card.approvalStage) || '';
    if (cardsSortKey === 'ops') return getCardOpsCount(card);
    if (cardsSortKey === 'files') return getCardFilesCount(card);
    return '';
  };

  const mul = cardsSortDir === 'desc' ? -1 : 1;
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

function insertCardsRowLive(card) {
  if (!card || location.pathname !== '/cards') return;
  if (card.archived || card.cardType !== 'MKI') return;

  const wrapper = document.getElementById('cards-table-wrapper');
  if (!wrapper) return;

  const termRaw = cardsSearchTerm.trim();
  if (termRaw && cardSearchScore(card, termRaw) <= 0) return;

  const existingRow = wrapper.querySelector('tr[data-card-id="' + card.id + '"]');
  if (existingRow) return;

  let table = wrapper.querySelector('table');
  let tbody = wrapper.querySelector('tbody');

  if (!table || !tbody) {
      const tableHeader = '<thead><tr>' +
        '<th class="th-sortable" data-sort-key="route">Маршрутная карта № (QR)</th>' +
        '<th class="th-sortable" data-sort-key="name">Наименование</th>' +
        '<th class="th-sortable" data-sort-key="status">Статус</th>' +
        '<th class="th-sortable" data-sort-key="author">Автор</th>' +
        '<th class="th-sortable" data-sort-key="stage">Этап согласования</th>' +
        '<th class="th-sortable" data-sort-key="ops">Операций</th>' +
      '<th class="th-sortable" data-sort-key="files">Файлы</th>' +
      '<th>Действия</th>' +
      '</tr></thead>';
    wrapper.innerHTML = '<table>' + tableHeader + '<tbody></tbody></table>';
    table = wrapper.querySelector('table');
    tbody = wrapper.querySelector('tbody');

    if (!wrapper.dataset.sortBound) {
      wrapper.dataset.sortBound = '1';
      wrapper.addEventListener('click', (e) => {
        const th = e.target.closest('th.th-sortable');
        if (!th || !wrapper.contains(th)) return;
        const key = th.getAttribute('data-sort-key') || '';
        if (!key) return;

        if (cardsSortKey === key) {
          cardsSortDir = (cardsSortDir === 'asc') ? 'desc' : 'asc';
        } else {
          cardsSortKey = key;
          cardsSortDir = 'asc';
        }
        renderCardsTable();
      });
    }
    updateTableSortUI(wrapper, cardsSortKey, cardsSortDir);
  }

  const rowWrapper = document.createElement('tbody');
  rowWrapper.innerHTML = buildCardsTableRowHtml(card);
  const row = rowWrapper.firstElementChild;
  if (!row) return;

  let inserted = false;
  const rows = Array.from(tbody.querySelectorAll('tr[data-card-id]'));
  for (const existing of rows) {
    const existingId = existing.getAttribute('data-card-id');
    const existingCard = cards.find(item => item && item.id === existingId);
    if (!existingCard) continue;
    if (compareCardsLiveInsertOrder(card, existingCard, termRaw) < 0) {
      tbody.insertBefore(row, existing);
      inserted = true;
      break;
    }
  }
  if (!inserted) tbody.appendChild(row);

  bindCardsRowActions(row);
  applyReadonlyState('cards', 'cards');
  refreshCardsFilesCounters();
}

function getApprovalStageLabel(stage) {
  if (stage === APPROVAL_STAGE_DRAFT) return 'Черновик';
  if (stage === APPROVAL_STAGE_ON_APPROVAL) return 'На согласовании';
  if (stage === APPROVAL_STAGE_REJECTED) return 'Отклонено';
  if (stage === APPROVAL_STAGE_APPROVED) return 'Ожидает входной контроль и обеспечение';
  if (stage === APPROVAL_STAGE_WAITING_INPUT_CONTROL) return 'Ожидает входной контроль';
  if (stage === APPROVAL_STAGE_WAITING_PROVISION) return 'Ожидает обеспечение';
  if (stage === APPROVAL_STAGE_PROVIDED) return 'Ожидает планирования';
  if (stage === APPROVAL_STAGE_PLANNING) return 'Запланировано частично';
  if (stage === APPROVAL_STAGE_PLANNED) return 'Запланировано полностью';
  return '';
}

function getApprovalStageLabelForCard(card) {
  if (!card) return '';

  const stage = card.approvalStage;

  if (stage === APPROVAL_STAGE_DRAFT) return 'Черновик';
  if (stage === APPROVAL_STAGE_ON_APPROVAL) return 'На согласовании';
  if (stage === APPROVAL_STAGE_REJECTED) return 'Отклонено';
  if (stage === APPROVAL_STAGE_APPROVED) return 'Ожидает входной контроль и обеспечение';

  if (stage === APPROVAL_STAGE_PROVIDED) return 'Ожидает планирования';
  if (stage === APPROVAL_STAGE_PLANNING) return 'Запланировано частично';
  if (stage === APPROVAL_STAGE_PLANNED) return 'Запланировано полностью';

  if (stage === APPROVAL_STAGE_WAITING_INPUT_CONTROL) return 'Ожидает входной контроль';
  if (stage === APPROVAL_STAGE_WAITING_PROVISION) return 'Ожидает обеспечение';

  return '';
}

function renderApprovalStageCell(card) {
  if (!card) return '';
  const label = (getApprovalStageLabelForCard(card) || '').toString().trim() || 'Черновик';
  return '<span class="cards-approval-stage" data-card-id="' + card.id + '">' + escapeHtml(label) + '</span>';
}

function updateCardsRowLiveFields(card) {
  if (!card || !card.id) return;

  const statusEl = document.querySelector('.cards-status-text[data-card-id="' + card.id + '"]');
  if (statusEl) {
    const newHtml = buildDashboardLikeStatusHtml(card);
    if (statusEl.innerHTML !== newHtml) statusEl.innerHTML = newHtml;
  }

  const stageEls = document.querySelectorAll('.cards-approval-stage[data-card-id="' + card.id + '"]');
  if (stageEls.length) {
    const label = (getApprovalStageLabelForCard(card) || '').toString().trim() || 'Черновик';
    stageEls.forEach(stageEl => {
      if (stageEl.textContent !== label) stageEl.textContent = label;
    });
  }

  const opsEl = document.querySelector('.cards-ops-count[data-card-id="' + card.id + '"]');
  if (opsEl && typeof card.__liveOpsCount === 'number') {
    const txt = String(card.__liveOpsCount);
    if (opsEl.textContent !== txt) opsEl.textContent = txt;
  }

  const filesEls = document.querySelectorAll('.clip-btn[data-attach-card="' + card.id + '"] .clip-count');
  if (filesEls.length && typeof card.__liveFilesCount === 'number') {
    const txt = String(card.__liveFilesCount);
    filesEls.forEach(filesEl => {
      if (filesEl.textContent !== txt) filesEl.textContent = txt;
    });
  }
}

let approvalDialogContext = null;
let provisionContextCardId = null;
let inputControlContextCardId = null;

function renderProvisionTable() {
  const wrapper = document.getElementById('provision-table-wrapper');
  if (!wrapper) return;

  const eligible = cards.filter(card =>
    card &&
    !card.archived &&
    card.cardType === 'MKI' &&
    (card.approvalStage === APPROVAL_STAGE_APPROVED ||
      card.approvalStage === APPROVAL_STAGE_WAITING_PROVISION) &&
    !card.provisionDoneAt
  );

  if (!eligible.length) {
    wrapper.innerHTML = '<p>Список маршрутных карт пуст.</p>';
    return;
  }

  const termRaw = provisionSearchTerm.trim();
  const cardMatches = (card) => {
    return termRaw ? cardSearchScore(card, termRaw) > 0 : true;
  };

  let sortedCards = [...eligible];
  if (termRaw) {
    sortedCards.sort((a, b) => cardSearchScore(b, termRaw) - cardSearchScore(a, termRaw));
  }

  const filteredCards = sortedCards.filter(cardMatches);

  if (!filteredCards.length) {
    wrapper.innerHTML = '<p>Карты по запросу не найдены.</p>';
    return;
  }

  let finalCards = filteredCards;

  if (provisionSortKey) {
    if (provisionSortKey === 'route') {
      finalCards = sortCardsByKey(finalCards, 'route', provisionSortDir, c => getCardRouteNumberForSort(c));
    } else if (provisionSortKey === 'name') {
      finalCards = sortCardsByKey(finalCards, 'name', provisionSortDir, c => getCardNameForSort(c));
    } else if (provisionSortKey === 'stage') {
      finalCards = sortCardsByKey(finalCards, 'stage', provisionSortDir, c => getApprovalStageLabel(c.approvalStage) || '');
    } else if (provisionSortKey === 'files') {
      finalCards = sortCardsByKey(finalCards, 'files', provisionSortDir, c => getCardFilesCount(c));
    }
  }

  let html = '<table>' + getProvisionTableHeaderHtml() + '<tbody>';

  finalCards.forEach(card => {
    html += buildProvisionRowHtml(card);
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

      if (provisionSortKey === key) {
        provisionSortDir = (provisionSortDir === 'asc') ? 'desc' : 'asc';
      } else {
        provisionSortKey = key;
        provisionSortDir = 'asc';
      }
      renderProvisionTable();
    });
  }
  updateTableSortUI(wrapper, provisionSortKey, provisionSortDir);

  bindProvisionRowActions(wrapper);

  applyReadonlyState('provision', 'provision');
}

function getProvisionTableHeaderHtml() {
  return '<thead><tr>' +
    '<th class="th-sortable" data-sort-key="route">Маршрутная карта № (QR)</th>' +
    '<th class="th-sortable" data-sort-key="name">Наименование</th>' +
    '<th class="th-sortable" data-sort-key="stage">Этап согласования</th>' +
    '<th class="th-sortable" data-sort-key="files">Файлы</th>' +
    '<th>Действия</th>' +
    '</tr></thead>';
}

function buildProvisionRowHtml(card) {
  const filesCount = getCardFilesCount(card);
  const barcodeValue = getCardBarcodeValue(card);
  const displayNumber = (card.routeCardNumber || card.orderNo || '').toString().trim() || barcodeValue;
  return '<tr data-card-id="' + card.id + '">' +
    '<td><button class="btn-link barcode-link" data-id="' + card.id + '" title="' + escapeHtml(barcodeValue) + '">' +
      '<div class="mk-cell">' +
        '<div class="mk-no">' + escapeHtml(displayNumber) + '</div>' +
        '<div class="mk-qr">(' + escapeHtml(barcodeValue) + ')</div>' +
      '</div>' +
    '</button></td>' +
    '<td>' + escapeHtml(card.name || '') + '</td>' +
    '<td>' + renderApprovalStageCell(card) + '</td>' +
    '<td><button class="btn-small clip-btn" data-attach-card="' + card.id + '">📎 <span class="clip-count">' + filesCount + '</span></button></td>' +
    '<td><div class="table-actions">' +
      '<button class="btn-small" data-action="edit-card" data-id="' + card.id + '">Открыть</button>' +
      '<button class="btn-small" data-action="print-card" data-id="' + card.id + '">Печать</button>' +
      '<button class="btn-small" data-action="provision-card" data-id="' + card.id + '">Обеспечить</button>' +
    '</div></td>' +
    '</tr>';
}

function bindProvisionRowActions(scope) {
  if (!scope) return;
  scope.querySelectorAll('button[data-action="edit-card"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cardId = btn.getAttribute('data-id');
      const card = cards.find(item => item.id === cardId);
      if (!card) {
        showToast('Маршрутная карта не найдена.');
        navigateToRoute('/cards');
        return;
      }
      const qr = normalizeQrId(card.qrId || '');
      const targetId = isValidScanId(qr) ? qr : card.id;
      navigateToRoute('/cards/' + encodeURIComponent(targetId));
    });
  });

  scope.querySelectorAll('button[data-action="print-card"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = cards.find(c => c.id === btn.getAttribute('data-id'));
      if (!card) return;
      printCardView(card);
    });
  });

  scope.querySelectorAll('button[data-attach-card]').forEach(btn => {
    btn.addEventListener('click', () => {
      openAttachmentsModal(btn.getAttribute('data-attach-card'), 'live');
    });
  });

  scope.querySelectorAll('button[data-action="provision-card"]').forEach(btn => {
    btn.addEventListener('click', () => {
      openProvisionModal(btn.getAttribute('data-id'));
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
}

function compareProvisionInsertOrder(cardA, cardB, termRaw) {
  if (termRaw) {
    return cardSearchScore(cardB, termRaw) - cardSearchScore(cardA, termRaw);
  }

  if (!provisionSortKey) return 0;

  const getValue = (card) => {
    if (provisionSortKey === 'route') return getCardRouteNumberForSort(card);
    if (provisionSortKey === 'name') return getCardNameForSort(card);
    if (provisionSortKey === 'stage') return getApprovalStageLabel(card.approvalStage) || '';
    if (provisionSortKey === 'files') return getCardFilesCount(card);
    return '';
  };

  const mul = provisionSortDir === 'desc' ? -1 : 1;
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

function insertProvisionRowLive(card) {
  if (!card || location.pathname !== '/provision') return;
  if (!card || card.archived || card.cardType !== 'MKI') return;
  if (!(card.approvalStage === APPROVAL_STAGE_APPROVED || card.approvalStage === APPROVAL_STAGE_WAITING_PROVISION)) return;
  if (card.provisionDoneAt) return;

  const wrapper = document.getElementById('provision-table-wrapper');
  if (!wrapper) return;

  const termRaw = provisionSearchTerm.trim();
  if (termRaw && cardSearchScore(card, termRaw) <= 0) return;

  const existingRow = wrapper.querySelector('tr[data-card-id="' + card.id + '"]');
  if (existingRow) return;

  let table = wrapper.querySelector('table');
  let tbody = wrapper.querySelector('tbody');

  if (!table || !tbody) {
    wrapper.innerHTML = '<table>' + getProvisionTableHeaderHtml() + '<tbody></tbody></table>';
    table = wrapper.querySelector('table');
    tbody = wrapper.querySelector('tbody');

    if (!wrapper.dataset.sortBound) {
      wrapper.dataset.sortBound = '1';
      wrapper.addEventListener('click', (e) => {
        const th = e.target.closest('th.th-sortable');
        if (!th || !wrapper.contains(th)) return;
        const key = th.getAttribute('data-sort-key') || '';
        if (!key) return;

        if (provisionSortKey === key) {
          provisionSortDir = (provisionSortDir === 'asc') ? 'desc' : 'asc';
        } else {
          provisionSortKey = key;
          provisionSortDir = 'asc';
        }
        renderProvisionTable();
      });
    }
    updateTableSortUI(wrapper, provisionSortKey, provisionSortDir);
  }

  const rowWrapper = document.createElement('tbody');
  rowWrapper.innerHTML = buildProvisionRowHtml(card);
  const row = rowWrapper.firstElementChild;
  if (!row) return;

  let inserted = false;
  const rows = Array.from(tbody.querySelectorAll('tr[data-card-id]'));
  for (const existing of rows) {
    const existingId = existing.getAttribute('data-card-id');
    const existingCard = cards.find(item => item && item.id === existingId);
    if (!existingCard) continue;
    if (compareProvisionInsertOrder(card, existingCard, termRaw) < 0) {
      tbody.insertBefore(row, existing);
      inserted = true;
      break;
    }
  }
  if (!inserted) tbody.appendChild(row);

  bindProvisionRowActions(row);
  applyReadonlyState('provision', 'provision');
}

function renderInputControlTable() {
  const wrapper = document.getElementById('input-control-table-wrapper');
  if (!wrapper) return;

  const eligible = cards.filter(card =>
    card &&
    !card.archived &&
    card.cardType === 'MKI' &&
    (card.approvalStage === APPROVAL_STAGE_APPROVED ||
      card.approvalStage === APPROVAL_STAGE_WAITING_INPUT_CONTROL) &&
    !card.inputControlDoneAt
  );

  if (!eligible.length) {
    wrapper.innerHTML = '<p>Список маршрутных карт пуст.</p>';
    return;
  }

  const termRaw = inputControlSearchTerm.trim();
  const cardMatches = (card) => {
    return termRaw ? cardSearchScore(card, termRaw) > 0 : true;
  };

  let sortedCards = [...eligible];
  if (termRaw) {
    sortedCards.sort((a, b) => cardSearchScore(b, termRaw) - cardSearchScore(a, termRaw));
  }

  const filteredCards = sortedCards.filter(cardMatches);

  if (!filteredCards.length) {
    wrapper.innerHTML = '<p>Карты по запросу не найдены.</p>';
    return;
  }

  let finalCards = filteredCards;

  if (inputControlSortKey) {
    if (inputControlSortKey === 'route') {
      finalCards = sortCardsByKey(finalCards, 'route', inputControlSortDir, c => getCardRouteNumberForSort(c));
    } else if (inputControlSortKey === 'name') {
      finalCards = sortCardsByKey(finalCards, 'name', inputControlSortDir, c => getCardNameForSort(c));
    } else if (inputControlSortKey === 'stage') {
      finalCards = sortCardsByKey(finalCards, 'stage', inputControlSortDir, c => getApprovalStageLabel(c.approvalStage) || '');
    } else if (inputControlSortKey === 'files') {
      finalCards = sortCardsByKey(finalCards, 'files', inputControlSortDir, c => getCardFilesCount(c));
    }
  }

  let html = '<table>' + getInputControlTableHeaderHtml() + '<tbody>';

  finalCards.forEach(card => {
    html += buildInputControlRowHtml(card);
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

      if (inputControlSortKey === key) {
        inputControlSortDir = (inputControlSortDir === 'asc') ? 'desc' : 'asc';
      } else {
        inputControlSortKey = key;
        inputControlSortDir = 'asc';
      }
      renderInputControlTable();
    });
  }
  updateTableSortUI(wrapper, inputControlSortKey, inputControlSortDir);

  bindInputControlRowActions(wrapper);

  applyReadonlyState('input-control', 'input-control');
}

function getInputControlTableHeaderHtml() {
  return '<thead><tr>' +
    '<th class="th-sortable" data-sort-key="route">Маршрутная карта № (QR)</th>' +
    '<th class="th-sortable" data-sort-key="name">Наименование</th>' +
    '<th class="th-sortable" data-sort-key="stage">Этап согласования</th>' +
    '<th class="th-sortable" data-sort-key="files">Файлы</th>' +
    '<th>Действия</th>' +
    '</tr></thead>';
}

function buildInputControlRowHtml(card) {
  const filesCount = getCardFilesCount(card);
  const barcodeValue = getCardBarcodeValue(card);
  const displayNumber = (card.routeCardNumber || card.orderNo || '').toString().trim() || barcodeValue;
  return '<tr data-card-id="' + card.id + '">' +
    '<td><button class="btn-link barcode-link" data-id="' + card.id + '" title="' + escapeHtml(barcodeValue) + '">' +
      '<div class="mk-cell">' +
        '<div class="mk-no">' + escapeHtml(displayNumber) + '</div>' +
        '<div class="mk-qr">(' + escapeHtml(barcodeValue) + ')</div>' +
      '</div>' +
    '</button></td>' +
    '<td>' + escapeHtml(card.name || '') + '</td>' +
    '<td>' + renderApprovalStageCell(card) + '</td>' +
    '<td><button class="btn-small clip-btn" data-attach-card="' + card.id + '">📎 <span class="clip-count">' + filesCount + '</span></button></td>' +
    '<td><div class="table-actions">' +
      '<button class="btn-small" data-action="edit-card" data-id="' + card.id + '">Открыть</button>' +
      '<button class="btn-small" data-action="print-card" data-id="' + card.id + '">Печать</button>' +
      '<button class="btn-small" data-action="input-control-card" data-id="' + card.id + '">Входной контроль</button>' +
    '</div></td>' +
    '</tr>';
}

function bindInputControlRowActions(scope) {
  if (!scope) return;
  scope.querySelectorAll('button[data-action="edit-card"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cardId = btn.getAttribute('data-id');
      const card = cards.find(item => item.id === cardId);
      if (!card) {
        showToast('Маршрутная карта не найдена.');
        navigateToRoute('/cards');
        return;
      }
      const qr = normalizeQrId(card.qrId || '');
      const targetId = isValidScanId(qr) ? qr : card.id;
      navigateToRoute('/cards/' + encodeURIComponent(targetId));
    });
  });

  scope.querySelectorAll('button[data-action="print-card"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = cards.find(c => c.id === btn.getAttribute('data-id'));
      if (!card) return;
      printCardView(card);
    });
  });

  scope.querySelectorAll('button[data-attach-card]').forEach(btn => {
    btn.addEventListener('click', () => {
      openAttachmentsModal(btn.getAttribute('data-attach-card'), 'live');
    });
  });

  scope.querySelectorAll('button[data-action="input-control-card"]').forEach(btn => {
    btn.addEventListener('click', () => {
      openInputControlModal(btn.getAttribute('data-id'));
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
}

function compareInputControlInsertOrder(cardA, cardB, termRaw) {
  if (termRaw) {
    return cardSearchScore(cardB, termRaw) - cardSearchScore(cardA, termRaw);
  }

  if (!inputControlSortKey) return 0;

  const getValue = (card) => {
    if (inputControlSortKey === 'route') return getCardRouteNumberForSort(card);
    if (inputControlSortKey === 'name') return getCardNameForSort(card);
    if (inputControlSortKey === 'stage') return getApprovalStageLabel(card.approvalStage) || '';
    if (inputControlSortKey === 'files') return getCardFilesCount(card);
    return '';
  };

  const mul = inputControlSortDir === 'desc' ? -1 : 1;
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

function insertInputControlRowLive(card) {
  if (!card || location.pathname !== '/input-control') return;
  if (card.archived || card.cardType !== 'MKI') return;
  if (!(card.approvalStage === APPROVAL_STAGE_APPROVED || card.approvalStage === APPROVAL_STAGE_WAITING_INPUT_CONTROL)) return;
  if (card.inputControlDoneAt) return;

  const wrapper = document.getElementById('input-control-table-wrapper');
  if (!wrapper) return;

  const termRaw = inputControlSearchTerm.trim();
  if (termRaw && cardSearchScore(card, termRaw) <= 0) return;

  const existingRow = wrapper.querySelector('tr[data-card-id="' + card.id + '"]');
  if (existingRow) return;

  let table = wrapper.querySelector('table');
  let tbody = wrapper.querySelector('tbody');

  if (!table || !tbody) {
    wrapper.innerHTML = '<table>' + getInputControlTableHeaderHtml() + '<tbody></tbody></table>';
    table = wrapper.querySelector('table');
    tbody = wrapper.querySelector('tbody');

    if (!wrapper.dataset.sortBound) {
      wrapper.dataset.sortBound = '1';
      wrapper.addEventListener('click', (e) => {
        const th = e.target.closest('th.th-sortable');
        if (!th || !wrapper.contains(th)) return;
        const key = th.getAttribute('data-sort-key') || '';
        if (!key) return;

        if (inputControlSortKey === key) {
          inputControlSortDir = (inputControlSortDir === 'asc') ? 'desc' : 'asc';
        } else {
          inputControlSortKey = key;
          inputControlSortDir = 'asc';
        }
        renderInputControlTable();
      });
    }
    updateTableSortUI(wrapper, inputControlSortKey, inputControlSortDir);
  }

  const rowWrapper = document.createElement('tbody');
  rowWrapper.innerHTML = buildInputControlRowHtml(card);
  const row = rowWrapper.firstElementChild;
  if (!row) return;

  let inserted = false;
  const rows = Array.from(tbody.querySelectorAll('tr[data-card-id]'));
  for (const existing of rows) {
    const existingId = existing.getAttribute('data-card-id');
    const existingCard = cards.find(item => item && item.id === existingId);
    if (!existingCard) continue;
    if (compareInputControlInsertOrder(card, existingCard, termRaw) < 0) {
      tbody.insertBefore(row, existing);
      inserted = true;
      break;
    }
  }
  if (!inserted) tbody.appendChild(row);

  bindInputControlRowActions(row);
  applyReadonlyState('input-control', 'input-control');
}

function renderCardsTable() {
  const wrapper = document.getElementById('cards-table-wrapper');
  const visibleCards = cards.filter(c =>
    c &&
    !c.archived &&
    c.cardType === 'MKI'
  );
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

  const filteredCards = sortedCards.filter(card => cardMatches(card));

  if (!filteredCards.length) {
    wrapper.innerHTML = '<p>Карты по запросу не найдены.</p>';
    return;
  }

  let finalCards = filteredCards;

  if (cardsSortKey) {
    if (cardsSortKey === 'route') {
      finalCards = sortCardsByKey(finalCards, 'route', cardsSortDir, c => getCardRouteNumberForSort(c));
    } else if (cardsSortKey === 'name') {
      finalCards = sortCardsByKey(finalCards, 'name', cardsSortDir, c => getCardNameForSort(c));
    } else if (cardsSortKey === 'status') {
      finalCards = sortCardsByKey(finalCards, 'status', cardsSortDir, c => cardStatusText(c) || '');
    } else if (cardsSortKey === 'author') {
      finalCards = sortCardsByKey(finalCards, 'author', cardsSortDir, c => c.issuedBySurname || '');
    } else if (cardsSortKey === 'stage') {
      finalCards = sortCardsByKey(finalCards, 'stage', cardsSortDir, c => getApprovalStageLabel(c.approvalStage) || '');
    } else if (cardsSortKey === 'ops') {
      finalCards = sortCardsByKey(finalCards, 'ops', cardsSortDir, c => getCardOpsCount(c));
    } else if (cardsSortKey === 'files') {
      finalCards = sortCardsByKey(finalCards, 'files', cardsSortDir, c => getCardFilesCount(c));
    }
  }

  let html = '<table><thead><tr>' +
    '<th class="th-sortable" data-sort-key="route">Маршрутная карта № (QR)</th>' +
    '<th class="th-sortable" data-sort-key="name">Наименование</th>' +
    '<th class="th-sortable" data-sort-key="status">Статус</th>' +
    '<th class="th-sortable" data-sort-key="author">Автор</th>' +
    '<th class="th-sortable" data-sort-key="stage">Этап согласования</th>' +
    '<th class="th-sortable" data-sort-key="ops">Операций</th>' +
    '<th class="th-sortable" data-sort-key="files">Файлы</th>' +
    '<th>Действия</th>' +
    '</tr></thead><tbody>';

  finalCards.forEach(card => {
    html += buildCardsTableRowHtml(card);
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

      if (cardsSortKey === key) {
        cardsSortDir = (cardsSortDir === 'asc') ? 'desc' : 'asc';
      } else {
        cardsSortKey = key;
        cardsSortDir = 'asc';
      }
      renderCardsTable();
    });
  }
  updateTableSortUI(wrapper, cardsSortKey, cardsSortDir);

  bindCardsRowActions(wrapper);

  applyReadonlyState('cards', 'cards');
  refreshCardsFilesCounters();
}

function openApprovalDialog(cardId) {
  const modal = document.getElementById('approval-dialog-modal');
  if (!modal) return;
  approvalDialogContext = { cardId };
  const card = cards.find(c => c.id === cardId);
  if (card) ensureCardMeta(card, { skipSnapshot: true });
  const titleEl = document.getElementById('approval-dialog-title');
  if (titleEl) {
    const num = getCardRouteNumberForTitle(card);
    titleEl.textContent = `Согласование – "${num}"`;
  }
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
  if (threadContainer) {
    threadContainer.innerHTML = approvalThreadToHtml(card.approvalThread, { newestFirst: true });
    threadContainer.scrollTop = 0;
  }
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

function buildCardCopy(template, { nameOverride } = {}) {
  const copy = cloneCard(template);
  copy.id = genId('card');
  copy.cardType = 'MKI';
  copy.itemName = nameOverride || template.itemName || template.name || '';
  copy.name = copy.itemName || 'Маршрутная карта';
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
  copy.qrId = generateUniqueCardQrId();
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

function archiveCardWithLog(card) {
  if (!card || card.archived) return false;
  recordCardLog(card, { action: 'Архивирование', object: 'Карта', field: 'archived', oldValue: false, newValue: true });
  card.archived = true;
  return true;
}

function deleteCardById(cardId) {
  const card = cards.find(c => c.id === cardId);
  if (!card) return false;
  cards = cards.filter(c => c.id !== cardId);
  return true;
}

function buildDeleteConfirmMessage(context) {
  if (!context || !context.id) return '';
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

  workorderOpenCards.delete(id);
  changed = deleteCardById(id);

  closeDeleteConfirm();
  if (changed) {
    saveData();
    renderEverything();
  }
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

function createEmptyCardDraft() {
  const normalizedType = 'MKI';
  const defaultName = 'Новая МК';
  return {
    id: genId('card'),
    barcode: generateUniqueCardCode128(),
    qrId: generateUniqueCardQrId(),
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
    itemSerials: [],
    specialNotes: '',
    quantity: '',
    sampleCount: '',
    sampleSerials: [],
    drawing: '',
    material: '',
    contractNumber: '',
    orderNo: '',
    desc: '',
    responsibleProductionChief: '',
    responsibleProductionChiefAt: null,
    responsibleSKKChief: '',
    responsibleSKKChiefAt: null,
    responsibleTechLead: '',
    responsibleTechLeadAt: null,
    status: 'NOT_STARTED',
    approvalStage: APPROVAL_STAGE_DRAFT,
    approvalProductionStatus: null,
    approvalSKKStatus: null,
    approvalTechStatus: null,
    inputControlComment: '',
    inputControlFileId: '',
    inputControlDoneAt: null,
    inputControlDoneBy: '',
    provisionDoneAt: null,
    provisionDoneBy: '',
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
        const btn = Array.from(tablinks).find(b => b.getAttribute('data-tab-target') === tabName)
          || Array.from(tablinks).find(b => b.getAttribute('onclick') && b.getAttribute('onclick').includes(`'${tabName}'`));
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
  const { fromRestore = false, cardType = 'MKI', pageMode = false, renderMode, mountEl = null, readOnly = false } = options;
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
    if (card.cardType !== 'MKI') {
      showToast('Маршрутная карта недоступна.');
      navigateToRoute('/cards');
      return;
    }
    activeCardDraft = cloneCard(card);
    activeCardIsNew = false;
  } else {
    activeCardDraft = createEmptyCardDraft();
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
  const cardTypeLabel = 'МК';
  if (effectiveReadOnly) {
    const num = getCardRouteNumberForTitle(activeCardDraft);
    document.getElementById('card-modal-title').textContent = `Просмотр ${cardTypeLabel} – "${num}"`;
  } else {
    document.getElementById('card-modal-title').textContent =
      activeCardIsNew ? 'Создание ' + cardTypeLabel : 'Редактирование ' + cardTypeLabel;
  }
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
  const prodAt = document.getElementById('card-production-chief-at');
  if (prodAt) prodAt.value = activeCardDraft.responsibleProductionChiefAt ? new Date(activeCardDraft.responsibleProductionChiefAt).toLocaleString() : '';
  const skkAt = document.getElementById('card-skk-chief-at');
  if (skkAt) skkAt.value = activeCardDraft.responsibleSKKChiefAt ? new Date(activeCardDraft.responsibleSKKChiefAt).toLocaleString() : '';
  const techAt = document.getElementById('card-tech-lead-at');
  if (techAt) techAt.value = activeCardDraft.responsibleTechLeadAt ? new Date(activeCardDraft.responsibleTechLeadAt).toLocaleString() : '';
  document.getElementById('card-desc').value = activeCardDraft.specialNotes || '';
  document.getElementById('card-status-text').textContent = cardStatusText(activeCardDraft);
  const attachBtn = document.getElementById('card-attachments-btn');
  if (attachBtn) {
    attachBtn.innerHTML = '📎 Файлы (' + getCardFilesCount(activeCardDraft) + ')';
  }
  renderInputControlTab(activeCardDraft);
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
  draft.operations = (draft.operations || []).map((op, idx) => ({
    ...op,
    order: typeof op.order === 'number' ? op.order : idx + 1,
    goodCount: toSafeCount(op.goodCount || 0),
    scrapCount: toSafeCount(op.scrapCount || 0),
    holdCount: toSafeCount(op.holdCount || 0),
    isSamples: draft.cardType === 'MKI' ? Boolean(op.isSamples) : false,
    quantity: getOperationQuantity(op, draft),
    autoCode: Boolean(op.autoCode),
    additionalExecutors: Array.isArray(op.additionalExecutors) ? op.additionalExecutors.slice(0, 2) : []
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

  ensureUniqueQrIds(cards);
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
    'responsibleTechLead'
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

function applyFilesPayloadToCard(cardId, payload) {
  if (!cardId || !payload) return;
  const files = Array.isArray(payload.files) ? payload.files : null;
  const icId = typeof payload.inputControlFileId === 'string' ? payload.inputControlFileId : null;

  const real = Array.isArray(cards) ? cards.find(c => c && c.id === cardId) : null;
  if (real && files) real.attachments = files;
  if (real && icId !== null) real.inputControlFileId = icId;

  if (typeof activeCardDraft !== 'undefined' && activeCardDraft && activeCardDraft.id === cardId) {
    if (files) activeCardDraft.attachments = files.map(f => ({ ...f }));
    if (icId !== null) activeCardDraft.inputControlFileId = icId;
    renderInputControlTab(activeCardDraft);
  }
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
  if (attachmentContext.loading) {
    list.innerHTML = '<p>Загрузка файлов...</p>';
    uploadHint.textContent = 'Допустимые форматы: pdf, doc, jpg, архив. Максимум ' + formatBytes(ATTACH_MAX_SIZE) + '.';
    return;
  }
  const files = Array.isArray(card.attachments)
    ? card.attachments.filter(file => file && (file.id || file.name || file.relPath))
    : [];
  const isInputControl = file => file && (file.id === card.inputControlFileId || String(file.category || '').toUpperCase() === 'INPUT_CONTROL');
  files.sort((a, b) => {
    const aIC = isInputControl(a);
    const bIC = isInputControl(b);
    if (aIC !== bIC) return aIC ? -1 : 1;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
  if (!files.length) {
    list.innerHTML = '<p>Файлы ещё не добавлены.</p>';
  } else {
    let html = '<table class="attachments-table"><thead><tr><th>Имя файла</th><th>Размер</th><th>Дата</th><th>Действия</th></tr></thead><tbody>';
    files.forEach(file => {
      const date = new Date(file.createdAt || Date.now()).toLocaleString();
      const badge = isInputControl(file) ? ' <span class="badge">Входной контроль (ПВХ)</span>' : '';
      html += '<tr>' +
        '<td>' + escapeHtml(file.name || 'файл') + badge + '</td>' +
        '<td>' + escapeHtml(formatBytes(file.size)) + '</td>' +
        '<td>' + escapeHtml(date) + '</td>' +
        '<td><div class="table-actions">' +
        '<button class="btn-small" data-preview-id="' + file.id + '">Открыть</button>' +
        '<button class="btn-small" data-download-id="' + file.id + '">Скачать</button>' +
      '<button class="btn-small btn-delete" data-delete-id="' + file.id + '">🗑️</button>' +
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
      previewAttachment(file, cardRef.id);
    });
  });

  list.querySelectorAll('button[data-download-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-download-id');
      const cardRef = getAttachmentTargetCard();
      if (!cardRef) return;
      const file = (cardRef.attachments || []).find(f => f.id === id);
      if (!file) return;
      downloadAttachment(file, cardRef.id);
    });
  });

  list.querySelectorAll('button[data-delete-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-delete-id');
      deleteAttachment(id);
    });
  });
}

function buildAttachmentUrl(file, options = {}) {
  if (!file || !file.id) return '';
  const { cardId, download = false } = options;
  const useCardEndpoint = Boolean(cardId && file.relPath);
  const base = useCardEndpoint
    ? '/api/cards/' + encodeURIComponent(String(cardId)) + '/files/' + encodeURIComponent(String(file.id))
    : '/files/' + encodeURIComponent(String(file.id));
  return base + (download ? '?download=1' : '');
}

function normalizeAttachmentName(file) {
  return String(file?.originalName || file?.name || file?.storedName || '').trim().toLowerCase();
}

async function resolveAttachmentForAccess(file, cardId) {
  if (!file || !file.id || !cardId) return file;
  if (file.relPath) return file;
  try {
    const request = typeof apiFetch === 'function' ? apiFetch : fetch;
    const res = await request('/api/cards/' + encodeURIComponent(cardId) + '/files/resync', {
      method: 'POST'
    });
    if (!res.ok) {
      return file;
    }
    const payload = await res.json();
    applyFilesPayloadToCard(cardId, payload);
    const freshFiles = Array.isArray(payload.files) ? payload.files : [];
    const targetName = normalizeAttachmentName(file);
    const targetSize = Number(file.size) || null;
    const matched = freshFiles.find(item => normalizeAttachmentName(item) === targetName)
      || (targetSize ? freshFiles.find(item => Number(item.size) === targetSize) : null);
    return matched || file;
  } catch (err) {
    return file;
  }
}

async function downloadAttachment(file, cardId) {
  if (!file || !file.id) return;
  const resolved = await resolveAttachmentForAccess(file, cardId);
  if (cardId && resolved && !resolved.relPath) {
    showToast('Не удалось найти файл для скачивания');
    return;
  }
  const url = buildAttachmentUrl(resolved, { cardId, download: true });
  if (!url) return;
  window.open(url, '_blank', 'noopener');
}

async function previewAttachment(file, cardId) {
  if (!file || !file.id) return;
  const resolved = await resolveAttachmentForAccess(file, cardId);
  if (cardId && resolved && !resolved.relPath) {
    showToast('Не удалось найти файл для просмотра');
    return;
  }
  const url = buildAttachmentUrl(resolved, { cardId });
  if (!url) return;
  window.open(url, '_blank', 'noopener');
}

async function deleteAttachment(fileId) {
  const card = getAttachmentTargetCard();
  if (!card) return;
  ensureAttachments(card);
  try {
    const request = typeof apiFetch === 'function' ? apiFetch : fetch;
    const res = await request('/api/cards/' + encodeURIComponent(card.id) + '/files/' + encodeURIComponent(fileId), {
      method: 'DELETE'
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || 'Не удалось удалить файл');
      return;
    }
    const payload = await res.json();
    applyFilesPayloadToCard(card.id, payload);
    const before = (card.attachments || []).length;
    card.attachments = payload.files || [];
    card.inputControlFileId = payload.inputControlFileId || '';
    recordCardLog(card, { action: 'Файлы', object: 'Карта', field: 'attachments', oldValue: before, newValue: card.attachments.length });
  if (activeCardDraft && activeCardDraft.id === card.id) {
      activeCardDraft.attachments = (card.attachments || []).map(item => ({ ...item }));
      activeCardDraft.inputControlFileId = card.inputControlFileId || '';
      renderInputControlTab(activeCardDraft);
    }
    renderEverything();
    renderAttachmentsModal();
    updateAttachmentCounters(card.id);
    updateTableAttachmentCount(card.id);
    showToast('Файл удалён');
  } catch (err) {
    showToast('Не удалось удалить файл');
  }
}

async function addAttachmentsFromFiles(fileList) {
  const card = getAttachmentTargetCard();
  if (!card || !fileList || !fileList.length) return;
  ensureAttachments(card);
  const beforeCount = card.attachments.length;
  const filesArray = Array.from(fileList);
  const allowed = ATTACH_ACCEPT.split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
  let addedCount = 0;

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
    try {
      const request = typeof apiFetch === 'function' ? apiFetch : fetch;
      const res = await request('/api/cards/' + encodeURIComponent(card.id) + '/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: file.name,
          type: file.type || 'application/octet-stream',
          content: dataUrl,
          size: file.size,
          category: 'GENERAL',
          scope: 'CARD'
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || ('Не удалось загрузить файл ' + file.name));
        continue;
      }
      const payload = await res.json();
      applyFilesPayloadToCard(card.id, payload);
      card.attachments = payload.files || card.attachments;
      card.inputControlFileId = payload.inputControlFileId || card.inputControlFileId || '';
      addedCount += 1;
    } catch (err) {
      showToast('Не удалось загрузить файл ' + file.name);
    }
  }

  if (addedCount) {
    recordCardLog(card, { action: 'Файлы', object: 'Карта', field: 'attachments', oldValue: beforeCount, newValue: card.attachments.length });
    renderEverything();
    renderAttachmentsModal();
    updateAttachmentCounters(card.id);
    updateTableAttachmentCount(card.id);
    showToast('Файлы загружены');
  }
}

function normalizeInputControlFileName(name) {
  const baseName = (name || '').replace(/^ПВХ\s*-\s*/i, '').trim() || (name || '').trim() || 'file';
  return 'ПВХ - ' + baseName;
}

async function addInputControlAttachment(card, file) {
  if (!card || !file) return null;
  ensureAttachments(card);
  const allowed = ATTACH_ACCEPT.split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
  const ext = ('.' + (file.name.split('.').pop() || '')).toLowerCase();
  if (allowed.length && !allowed.includes(ext)) {
    alert('Тип файла не поддерживается: ' + file.name);
    return null;
  }
  if (file.size > ATTACH_MAX_SIZE) {
    alert('Файл ' + file.name + ' превышает лимит ' + formatBytes(ATTACH_MAX_SIZE));
    return null;
  }
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  try {
    const request = typeof apiFetch === 'function' ? apiFetch : fetch;
    const res = await request('/api/cards/' + encodeURIComponent(card.id) + '/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: normalizeInputControlFileName(file.name),
        type: file.type || 'application/octet-stream',
        content: dataUrl,
        size: file.size,
        category: 'INPUT_CONTROL',
        scope: 'CARD'
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || 'Не удалось загрузить файл входного контроля');
      return null;
    }
    const payload = await res.json();
    const beforeCount = (card.attachments || []).length;
    card.attachments = payload.files || [];
    card.inputControlFileId = payload.inputControlFileId || '';
    recordCardLog(card, { action: 'Файлы', object: 'Карта', field: 'attachments', oldValue: beforeCount, newValue: card.attachments.length });
    return { inputControlFileId: card.inputControlFileId || null, files: card.attachments || [] };
  } catch (err) {
    showToast('Не удалось загрузить файл входного контроля');
    return null;
  }
}

async function addInputControlFileToActiveCard(file) {
  if (!file) return;
  const cardId = getActiveCardId();
  const card = cardId ? cards.find(c => c.id === cardId) : null;
  if (!card) return;
  const uploaded = await addInputControlAttachment(card, file);
  if (!uploaded || !uploaded.inputControlFileId) return;
  applyFilesPayloadToCard(card.id, { files: uploaded.files || [], inputControlFileId: uploaded.inputControlFileId });
  if (activeCardDraft && activeCardDraft.id === card.id) {
    activeCardDraft.attachments = (card.attachments || []).map(item => ({ ...item }));
    activeCardDraft.inputControlFileId = card.inputControlFileId || '';
    renderInputControlTab(activeCardDraft);
    updateAttachmentCounters(card.id);
  }
  renderEverything();
  renderAttachmentsModal();
  updateTableAttachmentCount(card.id);
  showToast('Файл входного контроля загружен');
}

function findAttachmentById(cardId, fileId) {
  if (!fileId) return null;
  if (cardId && activeCardDraft && activeCardDraft.id === cardId) {
    return (activeCardDraft.attachments || []).find(file => file && file.id === fileId) || null;
  }
  if (cardId) {
    const card = cards.find(item => item && item.id === cardId);
    if (card) return (card.attachments || []).find(file => file && file.id === fileId) || null;
  }
  return (cards || [])
    .flatMap(card => (card && Array.isArray(card.attachments) ? card.attachments : []))
    .find(file => file && file.id === fileId) || null;
}

async function previewInputControlAttachment(fileId, cardId) {
  if (!fileId) return;
  const file = findAttachmentById(cardId, fileId) || { id: fileId };
  const resolved = await resolveAttachmentForAccess(file, cardId);
  if (cardId && resolved && !resolved.relPath) {
    showToast('Не удалось найти файл для просмотра');
    return;
  }
  const url = buildAttachmentUrl(resolved, { cardId });
  if (!url) return;
  window.open(url, '_blank', 'noopener');
}

async function downloadInputControlAttachment(fileId, cardId) {
  if (!fileId) return;
  const file = findAttachmentById(cardId, fileId) || { id: fileId };
  const resolved = await resolveAttachmentForAccess(file, cardId);
  if (cardId && resolved && !resolved.relPath) {
    showToast('Не удалось найти файл для скачивания');
    return;
  }
  const url = buildAttachmentUrl(resolved, { cardId, download: true });
  if (!url) return;
  window.open(url, '_blank', 'noopener');
}

async function openAttachmentsModal(cardId, source = 'live') {
  const modal = document.getElementById('attachments-modal');
  if (!modal) return;
  const card = source === 'draft' ? activeCardDraft : cards.find(c => c.id === cardId);
  if (!card) return;
  attachmentContext = { cardId: card.id, source, loading: true };
  renderAttachmentsModal();
  modal.classList.remove('hidden');
  try {
    const request = typeof apiFetch === 'function' ? apiFetch : fetch;
    const res = await request('/api/cards/' + encodeURIComponent(card.id) + '/files');
    if (!res.ok) {
      throw new Error('files load failed');
    }
    const payload = await res.json();
    const files = Array.isArray(payload.files) ? payload.files : [];
    applyFilesPayloadToCard(card.id, { files, inputControlFileId: payload.inputControlFileId });
    card.attachments = files;
    card.inputControlFileId = payload.inputControlFileId || null;
    updateAttachmentCounters(card.id);
    updateTableAttachmentCount(card.id);
    attachmentContext.loading = false;
    renderAttachmentsModal();
  } catch (err) {
    attachmentContext.loading = false;
    renderAttachmentsModal();
    showToast('Не удалось загрузить список файлов');
  }
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
      return getCardFilesCount(activeCardDraft);
    }
    const card = cards.find(c => c.id === cardId);
    return card ? getCardFilesCount(card) : 0;
  })();

  const cardBtn = document.getElementById('card-attachments-btn');
  if (cardBtn && activeCardDraft && activeCardDraft.id === cardId) {
    cardBtn.innerHTML = '📎 Файлы (' + count + ')';
  }
}

function updateTableAttachmentCount(cardId) {
  if (!cardId) return;
  const card = cards.find(c => c.id === cardId);
  const count = card ? getCardFilesCount(card) : 0;
  document.querySelectorAll('button[data-attach-card="' + cardId + '"]').forEach(btn => {
    const countEl = btn.querySelector('span.clip-count');
    if (countEl) countEl.textContent = count;
  });
}

async function refreshCardsFilesCounters() {
  const buttons = Array.from(document.querySelectorAll('button[data-attach-card]'));
  if (!buttons.length) return;
  const ids = Array.from(new Set(buttons.map(btn => btn.getAttribute('data-attach-card')).filter(Boolean)));
  if (!ids.length) return;
  ids.forEach(cardId => {
    updateTableAttachmentCount(cardId);
  });
}

function getActiveCardId() {
  return activeCardOriginalId || (activeCardDraft && activeCardDraft.id) || null;
}

function getInputControlAttachment(card) {
  if (!card) return null;
  ensureAttachments(card);
  if (!card.inputControlFileId) return null;
  return (card.attachments || []).find(file => file.id === card.inputControlFileId) || null;
}

function renderInputControlTab(card) {
  const tab = document.getElementById('tab-input-control');
  if (!tab || !card) return;
  const commentField = document.getElementById('input-control-comment');
  if (commentField) {
    commentField.value = card.inputControlComment || '';
  }
  const fileInfo = document.getElementById('input-control-file-info');
  if (fileInfo) {
    const file = getInputControlAttachment(card);
    if (!file) {
      fileInfo.innerHTML = '<p>Файл ПВХ ещё не добавлен.</p>';
    } else {
      const size = formatBytes(file.size || 0);
      const date = new Date(file.createdAt || Date.now()).toLocaleString();
      fileInfo.innerHTML = '<div class="attachment-row">' +
        '<div><strong>' + escapeHtml(file.name || 'ПВХ') + '</strong></div>' +
        '<div class="muted">' + escapeHtml(size) + ' • ' + escapeHtml(date) + '</div>' +
        '<div class="table-actions">' +
        '<button type="button" class="btn-small" data-action="input-control-preview-file" data-file-id="' + file.id + '">Открыть</button>' +
        '<button type="button" class="btn-small" data-action="input-control-download-file" data-file-id="' + file.id + '">Скачать</button>' +
        '</div>' +
        '</div>';
    }
  }

  const addBtn = document.getElementById('input-control-file-add');
  const canAddFile = (
    card.approvalStage === APPROVAL_STAGE_APPROVED ||
    card.approvalStage === APPROVAL_STAGE_WAITING_INPUT_CONTROL ||
    card.approvalStage === APPROVAL_STAGE_WAITING_PROVISION ||
    card.approvalStage === APPROVAL_STAGE_PROVIDED
  );
  if (addBtn) addBtn.disabled = !canAddFile;
}

function getProvisionOrderNumber(card) {
  const prefix = 'Заказ на производство №:';
  const materials = (card && card.mainMaterials ? card.mainMaterials : '').split('\n');
  const firstLine = materials[0] ? materials[0].trim() : '';
  if (firstLine.startsWith(prefix)) {
    return firstLine.slice(prefix.length).trim();
  }
  return '';
}

function closeProvisionModal() {
  const modal = document.getElementById('provision-production-order-modal');
  if (!modal) return;
  const input = document.getElementById('provision-production-order-input');
  if (input) input.value = '';
  modal.classList.add('hidden');
  modal.dataset.cardId = '';
  provisionContextCardId = null;
}

function openProvisionModal(cardId) {
  const modal = document.getElementById('provision-production-order-modal');
  if (!modal) return;
  const card = cards.find(c => c.id === cardId);
  if (!card) return;
  ensureCardMeta(card, { skipSnapshot: true });
  provisionContextCardId = cardId;
  modal.dataset.cardId = cardId;
  const titleEl = document.getElementById('provision-production-order-title');
  if (titleEl) {
    const num = getCardRouteNumberForTitle(card);
    titleEl.textContent = `Заказ на производство – "${num}"`;
  }
  const input = document.getElementById('provision-production-order-input');
  if (input) {
    input.value = getProvisionOrderNumber(card);
  }
  modal.classList.remove('hidden');
}

function closeInputControlModal() {
  const modal = document.getElementById('input-control-modal');
  if (!modal) return;
  const commentInput = document.getElementById('input-control-comment-input');
  const fileInput = document.getElementById('input-control-modal-file');
  if (commentInput) commentInput.value = '';
  if (fileInput) fileInput.value = '';
  modal.classList.add('hidden');
  modal.dataset.cardId = '';
  inputControlContextCardId = null;
}

function openInputControlModal(cardId) {
  const modal = document.getElementById('input-control-modal');
  if (!modal) return;
  const card = cards.find(c => c.id === cardId);
  if (!card) return;
  ensureCardMeta(card, { skipSnapshot: true });
  inputControlContextCardId = cardId;
  modal.dataset.cardId = cardId;
  const commentInput = document.getElementById('input-control-comment-input');
  if (commentInput) {
    commentInput.value = card.inputControlComment || '';
  }
  const fileInput = document.getElementById('input-control-modal-file');
  if (fileInput) fileInput.value = '';
  const titleEl = document.getElementById('input-control-title');
  if (titleEl) {
    const barcodeValue = getCardBarcodeValue(card);
    const displayNumber =
      (card.routeCardNumber || card.orderNo || '').toString().trim() || barcodeValue || '';
    titleEl.textContent = `Входной контроль - "${displayNumber}"`;
  }
  modal.classList.remove('hidden');
}

async function submitInputControlModal() {
  const modal = document.getElementById('input-control-modal');
  if (!modal || !inputControlContextCardId) return;
  const card = cards.find(c => c.id === inputControlContextCardId);
  const commentInput = document.getElementById('input-control-comment-input');
  const fileInput = document.getElementById('input-control-modal-file');
  if (!card || !commentInput || !fileInput) {
    closeInputControlModal();
    return;
  }
  const comment = (commentInput.value || '').trim();
  if (!comment) {
    alert('Введите комментарий');
    return;
  }
  if (
    card.approvalStage !== APPROVAL_STAGE_APPROVED &&
    card.approvalStage !== APPROVAL_STAGE_WAITING_INPUT_CONTROL
  ) {
    alert('Входной контроль доступен только после согласования.');
    return;
  }
  const file = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
  if (file) {
    await addInputControlAttachment(card, file);
  }
  card.inputControlComment = comment;
  card.inputControlDoneAt = Date.now();
  card.inputControlDoneBy = currentUser.name;
  if (
    card.approvalStage === APPROVAL_STAGE_APPROVED ||
    card.approvalStage === APPROVAL_STAGE_WAITING_INPUT_CONTROL ||
    card.approvalStage === APPROVAL_STAGE_WAITING_PROVISION
  ) {
    const hasIC = !!card.inputControlDoneAt;
    const hasPR = !!card.provisionDoneAt;

    if (hasIC && hasPR) {
      card.approvalStage = APPROVAL_STAGE_PROVIDED;
    } else if (hasIC && !hasPR) {
      card.approvalStage = APPROVAL_STAGE_WAITING_PROVISION;
    }
  }
  if (activeCardDraft && activeCardDraft.id === card.id) {
    activeCardDraft = cloneCard(card);
    renderInputControlTab(activeCardDraft);
    updateAttachmentCounters(card.id);
  }
  saveData();
  closeInputControlModal();
  const statusEl = document.querySelector('.cards-status-text[data-card-id="' + card.id + '"]');
  if (statusEl) {
    const text = (cardStatusText(card) || '').toString().trim() || 'Не запущена';
    statusEl.textContent = text;
  }
  renderEverything();
  showToast(card.approvalStage === APPROVAL_STAGE_PROVIDED
    ? 'Входной контроль выполнен. Карта переведена в производство'
    : 'Входной контроль выполнен');
}

function submitProvisionModal() {
  const modal = document.getElementById('provision-production-order-modal');
  if (!modal || !provisionContextCardId) return;
  const card = cards.find(c => c.id === provisionContextCardId);
  const input = document.getElementById('provision-production-order-input');
  if (!card || !input) {
    closeProvisionModal();
    return;
  }
  const value = (input.value || '').trim();
  if (!value) {
    alert('Введите № заказа на производство');
    return;
  }
  if (
    card.approvalStage !== APPROVAL_STAGE_APPROVED &&
    card.approvalStage !== APPROVAL_STAGE_WAITING_PROVISION
  ) {
    alert('Перевод в статус «Ожидает планирования» доступен только из состояния «Согласовано».');
    return;
  }
  const prefix = 'Заказ на производство №:';
  const lines = (card.mainMaterials || '').split('\n');
  if (!lines.length) lines.push('');
  if ((lines[0] || '').trim().startsWith(prefix)) {
    lines[0] = prefix + ' ' + value;
  } else {
    lines.unshift(prefix + ' ' + value);
  }
  card.mainMaterials = lines.join('\n');
  card.provisionDoneAt = Date.now();
  card.provisionDoneBy = currentUser.name;
  if (
    card.approvalStage === APPROVAL_STAGE_APPROVED ||
    card.approvalStage === APPROVAL_STAGE_WAITING_INPUT_CONTROL ||
    card.approvalStage === APPROVAL_STAGE_WAITING_PROVISION
  ) {
    const hasIC = !!card.inputControlDoneAt;
    const hasPR = !!card.provisionDoneAt;

    if (hasIC && hasPR) {
      card.approvalStage = APPROVAL_STAGE_PROVIDED;
    } else if (!hasIC && hasPR) {
      card.approvalStage = APPROVAL_STAGE_WAITING_INPUT_CONTROL;
    }
  }
  saveData();
  closeProvisionModal();
  renderEverything();
  showToast(card.approvalStage === APPROVAL_STAGE_PROVIDED
    ? 'Обеспечение выполнено. Карта переведена в производство'
    : 'Обеспечение выполнено');
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

window.addEventListener('focus', () => {
  if (typeof currentPage !== 'undefined' && currentPage === 'cards') {
    refreshCardsFilesCounters();
  }
});

window.addEventListener('popstate', () => {
  if (typeof currentPage !== 'undefined' && currentPage === 'cards') {
    refreshCardsFilesCounters();
  }
});
