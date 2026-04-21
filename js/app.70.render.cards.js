// === РЕНДЕРИНГ МАРШРУТНЫХ КАРТ ===
function renderCardStatusCell(card) {
  if (!card) return '';
  const html = buildDashboardLikeStatusHtml(card);
  return '<span class="cards-status-text dashboard-card-status" data-card-id="' + card.id + '">' + html + '</span>';
}

function updateCardStatusTextElement(element, card) {
  if (!element) return;
  if (card?.archived) {
    element.innerHTML = '<span class="card-archived-label">В Архиве</span>';
    return;
  }
  element.textContent = cardStatusText(card);
}

function getApprovalDialogButtonClass(card) {
  if (!card) return '';
  switch (card.approvalStage) {
    case APPROVAL_STAGE_DRAFT:
      return ' approval-stage-draft';
    case APPROVAL_STAGE_ON_APPROVAL:
      return ' approval-stage-on-approval';
    case APPROVAL_STAGE_REJECTED:
      return ' approval-stage-rejected';
    case APPROVAL_STAGE_APPROVED:
    case APPROVAL_STAGE_WAITING_INPUT_CONTROL:
    case APPROVAL_STAGE_WAITING_PROVISION:
    case APPROVAL_STAGE_PROVIDED:
    case APPROVAL_STAGE_PLANNING:
    case APPROVAL_STAGE_PLANNED:
      return ' approval-stage-approved';
    default:
      return '';
  }
}

const CARDS_TABLE_TARGET_SCREENS = 2.5;
const CARDS_TABLE_ESTIMATED_ROW_HEIGHT = 38;
const CARDS_TABLE_MIN_ROWS = 18;
const CARDS_TABLE_MAX_ROWS = 90;

function buildCardsTablePaginationTokens(totalPages, currentPage) {
  if (typeof buildItemsPagePaginationTokens === 'function') {
    return buildItemsPagePaginationTokens(totalPages, currentPage);
  }
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const tokens = [1];
  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);

  if (start > 2) tokens.push('ellipsis-left');
  for (let page = start; page <= end; page += 1) {
    tokens.push(page);
  }
  if (end < totalPages - 1) tokens.push('ellipsis-right');
  tokens.push(totalPages);
  return tokens;
}

function buildCardsTablePaginationHtml(totalPages, currentPage) {
  if (totalPages <= 1) return '';
  const tokens = buildCardsTablePaginationTokens(totalPages, currentPage);
  const prevDisabled = currentPage <= 1;
  const nextDisabled = currentPage >= totalPages;
  return '<div class="items-page-pagination" aria-label="\u041f\u0430\u0433\u0438\u043d\u0430\u0446\u0438\u044f \u0442\u0430\u0431\u043b\u0438\u0446\u044b \u043c\u0430\u0440\u0448\u0440\u0443\u0442\u043d\u044b\u0445 \u043a\u0430\u0440\u0442">' +
    '<button type="button" class="items-page-pagination-btn" data-page="' + (currentPage - 1) + '"' + (prevDisabled ? ' disabled' : '') + ' aria-label="\u041f\u0440\u0435\u0434\u044b\u0434\u0443\u0449\u0430\u044f \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0430">\u2039</button>' +
    tokens.map(token => {
      if (typeof token !== 'number') {
        return '<span class="items-page-pagination-ellipsis">\u2026</span>';
      }
      const active = token === currentPage;
      return '<button type="button" class="items-page-pagination-btn' + (active ? ' active' : '') + '" data-page="' + token + '"' + (active ? ' aria-current="page"' : '') + '>' + token + '</button>';
    }).join('') +
    '<button type="button" class="items-page-pagination-btn" data-page="' + (currentPage + 1) + '"' + (nextDisabled ? ' disabled' : '') + ' aria-label="\u0421\u043b\u0435\u0434\u0443\u044e\u0449\u0430\u044f \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0430">\u203a</button>' +
  '</div>';
}

function getCardsTableTargetRows() {
  if (typeof getItemsPageTargetRows === 'function') {
    return getItemsPageTargetRows();
  }
  const viewportHeight = Math.max(window.innerHeight || 0, 720);
  const estimatedRows = Math.round((viewportHeight * CARDS_TABLE_TARGET_SCREENS) / CARDS_TABLE_ESTIMATED_ROW_HEIGHT);
  return Math.min(CARDS_TABLE_MAX_ROWS, Math.max(CARDS_TABLE_MIN_ROWS, estimatedRows));
}

function paginateCardsTableRows(rows, currentPage) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const perPage = Math.max(1, getCardsTableTargetRows());
  const totalPages = Math.max(1, Math.ceil(safeRows.length / perPage));
  const safePage = Math.min(Math.max(1, currentPage || 1), totalPages);
  const startIndex = (safePage - 1) * perPage;
  return {
    totalPages,
    currentPage: safePage,
    pageRows: safeRows.slice(startIndex, startIndex + perPage)
  };
}

function getCardsTableHeaderHtml() {
  return '<thead><tr>' +
    '<th class="th-sortable" data-sort-key="date">\u0414\u0430\u0442\u0430</th>' +
    '<th class="th-sortable" data-sort-key="route">\u041c\u0430\u0440\u0448\u0440\u0443\u0442\u043d\u0430\u044f \u043a\u0430\u0440\u0442\u0430 \u2116 (QR)</th>' +
    '<th class="th-sortable" data-sort-key="name">\u0418\u0437\u0434\u0435\u043b\u0438\u0435</th>' +
    '<th class="th-sortable" data-sort-key="author">\u0410\u0432\u0442\u043e\u0440</th>' +
    '<th class="th-sortable" data-sort-key="status">\u0421\u0442\u0430\u0442\u0443\u0441</th>' +
    '<th class="th-sortable" data-sort-key="stage">\u042d\u0442\u0430\u043f \u0441\u043e\u0433\u043b\u0430\u0441\u043e\u0432\u0430\u043d\u0438\u044f</th>' +
    '<th class="th-sortable" data-sort-key="ops">\u041e\u043f\u0435\u0440\u0430\u0446\u0438\u0439</th>' +
    '<th class="th-sortable" data-sort-key="files">\u0424\u0430\u0439\u043b\u044b</th>' +
    '<th>\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044f</th>' +
    '</tr></thead>';
}

function ensureCardsTableBindings(wrapper) {
  if (!wrapper || wrapper.dataset.sortBound) return;
  wrapper.dataset.sortBound = '1';
  wrapper.addEventListener('click', (e) => {
    const pageBtn = e.target.closest('.items-page-pagination-btn[data-page]');
    if (pageBtn) {
      const nextPage = parseInt(pageBtn.getAttribute('data-page') || '', 10);
      if (Number.isFinite(nextPage) && nextPage > 0 && nextPage !== cardsTableCurrentPage) {
        cardsTableCurrentPage = nextPage;
        renderCardsTable();
      }
      return;
    }

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
    cardsTableCurrentPage = 1;
    renderCardsTable();
  });
}

function ensureCardsTableResizeBinding() {
  if (window.__cardsTableResizeBound) return;
  window.__cardsTableResizeBound = true;
  window.addEventListener('resize', () => {
    if ((window.location.pathname || '') !== '/cards') return;
    renderCardsTable();
  });
}

function getCardsRouteListQuery() {
  return {
    archived: 'active',
    q: typeof cardsSearchTerm === 'string' ? cardsSearchTerm : ''
  };
}

function getCardsRouteSourceCards() {
  const routeQuery = getCardsRouteListQuery();
  if (typeof getCardsCoreListCards === 'function') {
    const listCards = getCardsCoreListCards(routeQuery);
    if (Array.isArray(listCards)) {
      return listCards.filter(card => card && card.cardType === 'MKI');
    }
  }
  return (cards || []).filter(card =>
    card &&
    !card.archived &&
    card.cardType === 'MKI'
  );
}

function renderCardsTableWithPagination(wrapper) {
  ensureCardsTableBindings(wrapper);
  ensureCardsTableResizeBinding();
  if (typeof syncCardsAuthorFilterOptions === 'function') {
    syncCardsAuthorFilterOptions();
  }

  const visibleCards = getCardsRouteSourceCards();
  if (!visibleCards.length) {
    cardsTableCurrentPage = 1;
    wrapper.innerHTML = '<p>\u0421\u043f\u0438\u0441\u043e\u043a \u043c\u0430\u0440\u0448\u0440\u0443\u0442\u043d\u044b\u0445 \u043a\u0430\u0440\u0442 \u043f\u0443\u0441\u0442. \u041d\u0430\u0436\u043c\u0438\u0442\u0435 "\u0421\u043e\u0437\u0434\u0430\u0442\u044c \u041c\u041a".</p>';
    return;
  }

  const termRaw = cardsSearchTerm.trim();
  const authorFilter = (cardsAuthorFilter || '').trim();
  const cardMatches = (card) => termRaw ? cardSearchScore(card, termRaw) > 0 : true;
  const authorMatches = (card) => !authorFilter || ((card?.issuedBySurname || '').trim() === authorFilter);

  let sortedCards = [...visibleCards];
  if (termRaw) {
    sortedCards.sort((a, b) => cardSearchScore(b, termRaw) - cardSearchScore(a, termRaw));
  }

  const filteredCards = sortedCards.filter(card => cardMatches(card) && authorMatches(card));
  if (!filteredCards.length) {
    cardsTableCurrentPage = 1;
    wrapper.innerHTML = '<p>\u041a\u0430\u0440\u0442\u044b \u043f\u043e \u0437\u0430\u0434\u0430\u043d\u043d\u044b\u043c \u0444\u0438\u043b\u044c\u0442\u0440\u0430\u043c \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u044b.</p>';
    return;
  }

  let finalCards = filteredCards;
  if (cardsSortKey) {
    if (cardsSortKey === 'date') {
      finalCards = sortCardsByKey(finalCards, 'date', cardsSortDir, c => getCardCreatedAtForSort(c));
    } else if (cardsSortKey === 'route') {
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

  const pagination = paginateCardsTableRows(finalCards, cardsTableCurrentPage);
  cardsTableCurrentPage = pagination.currentPage;

  let html = '<table>' + getCardsTableHeaderHtml() + '<tbody>';
  pagination.pageRows.forEach(card => {
    html += buildCardsTableRowHtml(card);
  });
  html += '</tbody></table>' + buildCardsTablePaginationHtml(pagination.totalPages, pagination.currentPage);
  wrapper.innerHTML = html;

  updateTableSortUI(wrapper, cardsSortKey, cardsSortDir);
  bindCardsRowActions(wrapper);
  applyReadonlyState('cards', 'cards');
  refreshCardsFilesCounters();
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
  const createdDate = getCardCreatedDateDisplay(card);
  return '<tr data-card-id="' + card.id + '">' +
    '<td>' + escapeHtml(createdDate) + '</td>' +
    '<td><button class="btn-link barcode-link" data-id="' + card.id + '" data-allow-view="true" title="' + escapeHtml(barcodeValue) + '">' +
      '<div class="mk-cell">' +
        '<div class="mk-no">' + escapeHtml(displayRouteNumber) + '</div>' +
        '<div class="mk-qr">(' + escapeHtml(barcodeValue) + ')</div>' +
      '</div>' +
    '</button></td>' +
    '<td>' + escapeHtml(card.name || '') + '</td>' +
    '<td>' + escapeHtml(card.issuedBySurname || '') + '</td>' +
    '<td>' + renderCardStatusCell(card) + '</td>' +
    '<td>' + renderApprovalStageCell(card) + '</td>' +
    '<td><span class="cards-ops-count" data-card-id="' + card.id + '">' + opsCount + '</span></td>' +
    '<td><button class="btn-small clip-btn" data-attach-card="' + card.id + '" data-allow-view="true">📎 <span class="clip-count">' + filesCount + '</span></button></td>' +
    '<td><div class="table-actions">' +
    '<button class="btn-small" data-action="edit-card" data-id="' + card.id + '" data-allow-view="true">Открыть</button>' +
    '<button class="btn-small" data-action="print-card" data-id="' + card.id + '" data-allow-view="true">Печать</button>' +
    '<button class="btn-small" data-action="copy-card" data-id="' + card.id + '">Копировать</button>' +
    '<button class="btn-small approval-dialog-btn' + getApprovalDialogButtonClass(card) + '" data-action="approval-dialog" data-id="' + card.id + '" data-allow-view="true">Согласование</button>' +
    '<button class="btn-small btn-delete" data-action="delete-card" data-id="' + card.id + '">🗑️</button>' +
    '</div></td>' +
    '</tr>';
}

function bindCardsRowActions(scope) {
  if (!scope) return;
  scope.querySelectorAll('button[data-action="edit-card"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cardId = btn.getAttribute('data-id');
      const card = cards.find(c => c.id === cardId);
      const qr = card ? normalizeQrId(card.qrId || card.barcode || '') : '';
      const target = qr ? `/card-route/${encodeURIComponent(qr)}` : `/card-route/${cardId}`;
      navigateTo(target);
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
    if (cardsSortKey === 'date') return getCardCreatedAtForSort(card);
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

function isCardVisibleInCardsTable(card) {
  if (!card || card.archived || card.cardType !== 'MKI') return false;
  const termRaw = cardsSearchTerm.trim();
  const authorFilter = (cardsAuthorFilter || '').trim();
  if (termRaw && cardSearchScore(card, termRaw) <= 0) return false;
  if (authorFilter && (card?.issuedBySurname || '').trim() !== authorFilter) return false;
  return true;
}

function insertCardsRowLive(card) {
  if (!card || location.pathname !== '/cards') return;
  if (!isCardVisibleInCardsTable(card)) return;

  const wrapper = document.getElementById('cards-table-wrapper');
  if (!wrapper) return;

  const termRaw = cardsSearchTerm.trim();
  const existingRow = wrapper.querySelector('tr[data-card-id="' + card.id + '"]');
  if (existingRow) return;

  let table = wrapper.querySelector('table');
  let tbody = wrapper.querySelector('tbody');

  if (!table || !tbody) {
      const tableHeader = '<thead><tr>' +
        '<th class="th-sortable" data-sort-key="date">Дата</th>' +
        '<th class="th-sortable" data-sort-key="route">Маршрутная карта № (QR)</th>' +
        '<th class="th-sortable" data-sort-key="name">Изделие</th>' +
        '<th class="th-sortable" data-sort-key="author">Автор</th>' +
        '<th class="th-sortable" data-sort-key="status">Статус</th>' +
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
  if (typeof syncCardsAuthorFilterOptions === 'function') {
    syncCardsAuthorFilterOptions();
  }
}

function removeCardsRowLive(cardId) {
  if (!cardId || location.pathname !== '/cards') return;
  const wrapper = document.getElementById('cards-table-wrapper');
  if (!wrapper) return;
  const existingRow = wrapper.querySelector('tr[data-card-id="' + cardId + '"]');
  if (!existingRow) return;
  existingRow.remove();
  if (typeof syncCardsAuthorFilterOptions === 'function') {
    syncCardsAuthorFilterOptions();
  }
  const tbody = wrapper.querySelector('tbody');
  if (!tbody || !tbody.querySelector('tr[data-card-id]')) {
    renderCardsTable();
  }
}

function syncCardsRowLive(card) {
  if (!card || !card.id || location.pathname !== '/cards') return;
  const wrapper = document.getElementById('cards-table-wrapper');
  if (!wrapper) return;

  const existingRow = wrapper.querySelector('tr[data-card-id="' + card.id + '"]');
  const visible = isCardVisibleInCardsTable(card);

  if (!visible) {
    if (existingRow) removeCardsRowLive(card.id);
    return;
  }

  if (!existingRow) {
    if (cardsSortKey || cardsSearchTerm.trim() || (cardsAuthorFilter || '').trim()) {
      renderCardsTable();
      return;
    }
    insertCardsRowLive(card);
    return;
  }

  if (cardsSortKey || cardsSearchTerm.trim() || (cardsAuthorFilter || '').trim()) {
    renderCardsTable();
    return;
  }

  existingRow.outerHTML = buildCardsTableRowHtml(card);
  const nextRow = wrapper.querySelector('tr[data-card-id="' + card.id + '"]');
  if (nextRow) bindCardsRowActions(nextRow);
  applyReadonlyState('cards', 'cards');
  updateCardsRowLiveFields(card);
  updateTableAttachmentCount(card.id);
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
    '<td><button class="btn-link barcode-link" data-id="' + card.id + '" data-allow-view="true" title="' + escapeHtml(barcodeValue) + '">' +
      '<div class="mk-cell">' +
        '<div class="mk-no">' + escapeHtml(displayNumber) + '</div>' +
        '<div class="mk-qr">(' + escapeHtml(barcodeValue) + ')</div>' +
      '</div>' +
    '</button></td>' +
    '<td>' + escapeHtml(card.name || '') + '</td>' +
    '<td>' + renderApprovalStageCell(card) + '</td>' +
    '<td><button class="btn-small clip-btn" data-attach-card="' + card.id + '" data-allow-view="true">📎 <span class="clip-count">' + filesCount + '</span></button></td>' +
    '<td><div class="table-actions">' +
      '<button class="btn-small" data-action="edit-card" data-id="' + card.id + '" data-allow-view="true">Открыть</button>' +
      '<button class="btn-small" data-action="print-card" data-id="' + card.id + '" data-allow-view="true">Печать</button>' +
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

function removeProvisionRowLive(cardId) {
  if (!cardId || location.pathname !== '/provision') return;
  const wrapper = document.getElementById('provision-table-wrapper');
  if (!wrapper) return;
  const existingRow = wrapper.querySelector('tr[data-card-id="' + cardId + '"]');
  if (!existingRow) return;
  existingRow.remove();
  const tbody = wrapper.querySelector('tbody');
  if (!tbody || !tbody.querySelector('tr[data-card-id]')) {
    renderProvisionTable();
  }
}

function syncProvisionRowLive(card) {
  if (!card || !card.id || location.pathname !== '/provision') return;
  const wrapper = document.getElementById('provision-table-wrapper');
  if (!wrapper) return;
  const existingRow = wrapper.querySelector('tr[data-card-id="' + card.id + '"]');
  const termRaw = provisionSearchTerm.trim();
  const visible = !card.archived
    && card.cardType === 'MKI'
    && (card.approvalStage === APPROVAL_STAGE_APPROVED || card.approvalStage === APPROVAL_STAGE_WAITING_PROVISION)
    && !card.provisionDoneAt
    && (!termRaw || cardSearchScore(card, termRaw) > 0);

  if (!visible) {
    if (existingRow) removeProvisionRowLive(card.id);
    return;
  }

  if (!existingRow) {
    insertProvisionRowLive(card);
    return;
  }

  if (provisionSortKey || termRaw) {
    renderProvisionTable();
    return;
  }

  existingRow.outerHTML = buildProvisionRowHtml(card);
  const nextRow = wrapper.querySelector('tr[data-card-id="' + card.id + '"]');
  if (nextRow) bindProvisionRowActions(nextRow);
  applyReadonlyState('provision', 'provision');
  updateTableAttachmentCount(card.id);
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
    '<td><button class="btn-link barcode-link" data-id="' + card.id + '" data-allow-view="true" title="' + escapeHtml(barcodeValue) + '">' +
      '<div class="mk-cell">' +
        '<div class="mk-no">' + escapeHtml(displayNumber) + '</div>' +
        '<div class="mk-qr">(' + escapeHtml(barcodeValue) + ')</div>' +
      '</div>' +
    '</button></td>' +
    '<td>' + escapeHtml(card.name || '') + '</td>' +
    '<td>' + renderApprovalStageCell(card) + '</td>' +
    '<td><button class="btn-small clip-btn" data-attach-card="' + card.id + '" data-allow-view="true">📎 <span class="clip-count">' + filesCount + '</span></button></td>' +
    '<td><div class="table-actions">' +
      '<button class="btn-small" data-action="edit-card" data-id="' + card.id + '" data-allow-view="true">Открыть</button>' +
      '<button class="btn-small" data-action="print-card" data-id="' + card.id + '" data-allow-view="true">Печать</button>' +
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

function removeInputControlRowLive(cardId) {
  if (!cardId || location.pathname !== '/input-control') return;
  const wrapper = document.getElementById('input-control-table-wrapper');
  if (!wrapper) return;
  const existingRow = wrapper.querySelector('tr[data-card-id="' + cardId + '"]');
  if (!existingRow) return;
  existingRow.remove();
  const tbody = wrapper.querySelector('tbody');
  if (!tbody || !tbody.querySelector('tr[data-card-id]')) {
    renderInputControlTable();
  }
}

function syncInputControlRowLive(card) {
  if (!card || !card.id || location.pathname !== '/input-control') return;
  const wrapper = document.getElementById('input-control-table-wrapper');
  if (!wrapper) return;
  const existingRow = wrapper.querySelector('tr[data-card-id="' + card.id + '"]');
  const termRaw = inputControlSearchTerm.trim();
  const visible = !card.archived
    && card.cardType === 'MKI'
    && (card.approvalStage === APPROVAL_STAGE_APPROVED || card.approvalStage === APPROVAL_STAGE_WAITING_INPUT_CONTROL)
    && !card.inputControlDoneAt
    && (!termRaw || cardSearchScore(card, termRaw) > 0);

  if (!visible) {
    if (existingRow) removeInputControlRowLive(card.id);
    return;
  }

  if (!existingRow) {
    insertInputControlRowLive(card);
    return;
  }

  if (inputControlSortKey || termRaw) {
    renderInputControlTable();
    return;
  }

  existingRow.outerHTML = buildInputControlRowHtml(card);
  const nextRow = wrapper.querySelector('tr[data-card-id="' + card.id + '"]');
  if (nextRow) bindInputControlRowActions(nextRow);
  applyReadonlyState('input-control', 'input-control');
  updateTableAttachmentCount(card.id);
}

function renderCardsTable() {
  const wrapper = document.getElementById('cards-table-wrapper');
  if (!wrapper) return;
  renderCardsTableWithPagination(wrapper);
  return;
  if (typeof syncCardsAuthorFilterOptions === 'function') {
    syncCardsAuthorFilterOptions();
  }
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
  const authorFilter = (cardsAuthorFilter || '').trim();
  const cardMatches = (card) => {
    return termRaw ? cardSearchScore(card, termRaw) > 0 : true;
  };
  const authorMatches = (card) => {
    if (!authorFilter) return true;
    return ((card?.issuedBySurname || '').trim() === authorFilter);
  };

  let sortedCards = [...visibleCards];
  if (termRaw) {
    sortedCards.sort((a, b) => cardSearchScore(b, termRaw) - cardSearchScore(a, termRaw));
  }

  const filteredCards = sortedCards.filter(card => cardMatches(card) && authorMatches(card));

  if (!filteredCards.length) {
    wrapper.innerHTML = '<p>Карты по заданным фильтрам не найдены.</p>';
    return;
  }

  let finalCards = filteredCards;

  if (cardsSortKey) {
    if (cardsSortKey === 'date') {
      finalCards = sortCardsByKey(finalCards, 'date', cardsSortDir, c => getCardCreatedAtForSort(c));
    } else if (cardsSortKey === 'route') {
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
    '<th class="th-sortable" data-sort-key="date">Дата</th>' +
    '<th class="th-sortable" data-sort-key="route">Маршрутная карта № (QR)</th>' +
    '<th class="th-sortable" data-sort-key="name">Изделие</th>' +
    '<th class="th-sortable" data-sort-key="author">Автор</th>' +
    '<th class="th-sortable" data-sort-key="status">Статус</th>' +
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
  const readonly = typeof isCurrentTabReadonly === 'function' ? isCurrentTabReadonly() : false;
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
  if (comment) {
    comment.value = '';
    comment.readOnly = readonly;
  }
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
  const readonly = typeof isCurrentTabReadonly === 'function' ? isCurrentTabReadonly() : false;
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
    comment.disabled = readonly || !showComment;
    comment.readOnly = readonly;
    comment.required = card.approvalStage === APPROVAL_STAGE_REJECTED && !card.rejectionReadByUserName;
  }
  if (commentWrapper) {
    commentWrapper.classList.toggle('hidden', !showComment);
  }
  if (confirmBtn) {
    if (readonly) {
      confirmBtn.classList.add('hidden');
      confirmBtn.disabled = true;
    } else if (card.approvalStage === APPROVAL_STAGE_DRAFT) {
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

async function confirmApprovalDialogAction() {
  if (typeof isCurrentTabReadonly === 'function' && isCurrentTabReadonly()) {
    showToast('Для вашей роли подтверждение согласования недоступно');
    return;
  }
  if (!approvalDialogContext) return;
  const card = cards.find(c => c.id === approvalDialogContext.cardId);
  if (!card) {
    closeApprovalDialog();
    return;
  }
  const commentEl = document.getElementById('approval-dialog-comment');
  const comment = commentEl ? (commentEl.value || '').trim() : '';
  if (card.approvalStage === APPROVAL_STAGE_DRAFT) {
    const previousCard = cloneCard(card);
    const expectedRev = getCardExpectedRev(previousCard);
    const routeContext = typeof captureClientWriteRouteContext === 'function'
      ? captureClientWriteRouteContext()
      : { fullPath: (window.location.pathname + window.location.search) || '/cards' };
    const result = await runClientWriteRequest({
      action: 'cards-approval:send',
      writePath: '/api/cards-core/' + encodeURIComponent(String(card.id || '').trim()) + '/approval/send',
      entity: 'card',
      entityId: card.id,
      expectedRev,
      routeContext,
      request: () => sendCardToApproval(card.id, { expectedRev, comment }),
      defaultErrorMessage: 'Не удалось отправить карточку на согласование.',
      defaultConflictMessage: 'Карточка уже была изменена другим пользователем. Данные обновлены.',
      onSuccess: async ({ payload }) => {
        const savedCard = payload?.card || null;
        if (!savedCard || !savedCard.id) {
          throw new Error('Сервер не вернул карточку после отправки на согласование');
        }
        if (typeof syncActiveCardDraftAfterPersist === 'function') {
          syncActiveCardDraftAfterPersist(savedCard);
        }
        patchCardFamilyAfterUpsert(savedCard, previousCard);
        closeApprovalDialog();
      },
      onConflict: async ({ message }) => {
        closeApprovalDialog();
        showToast(message || 'Карточка уже была изменена другим пользователем. Данные обновлены.');
      },
      onError: async ({ message }) => {
        showToast(message || 'Не удалось отправить карточку на согласование.');
      },
      conflictRefresh: async ({ routeContext: conflictRouteContext }) => {
        await refreshCardsCoreMutationAfterConflict({
          routeContext: conflictRouteContext || routeContext,
          reason: 'approval-send-conflict'
        });
      }
    });
    if (!result.ok) return;
    return;
  }
  if (card.approvalStage === APPROVAL_STAGE_REJECTED && !card.rejectionReadByUserName) {
    if (!comment) {
      alert('Добавьте комментарий для разморозки.');
      return;
    }
    const previousCard = cloneCard(card);
    const expectedRev = getCardExpectedRev(previousCard);
    const routeContext = typeof captureClientWriteRouteContext === 'function'
      ? captureClientWriteRouteContext()
      : { fullPath: (window.location.pathname + window.location.search) || '/cards' };
    const result = await runClientWriteRequest({
      action: 'cards-approval:return-to-draft',
      writePath: '/api/cards-core/' + encodeURIComponent(String(card.id || '').trim()) + '/approval/return-to-draft',
      entity: 'card',
      entityId: card.id,
      expectedRev,
      routeContext,
      request: () => returnRejectedCardToDraft(card.id, { expectedRev, comment }),
      defaultErrorMessage: 'Не удалось вернуть карточку в черновик.',
      defaultConflictMessage: 'Карточка уже была изменена другим пользователем. Данные обновлены.',
      onSuccess: async ({ payload }) => {
        const savedCard = payload?.card || null;
        if (!savedCard || !savedCard.id) {
          throw new Error('Сервер не вернул карточку после возврата в черновик');
        }
        if (typeof syncActiveCardDraftAfterPersist === 'function') {
          syncActiveCardDraftAfterPersist(savedCard);
        }
        patchCardFamilyAfterUpsert(savedCard, previousCard);
        closeApprovalDialog();
      },
      onConflict: async ({ message }) => {
        closeApprovalDialog();
        showToast(message || 'Карточка уже была изменена другим пользователем. Данные обновлены.');
      },
      onError: async ({ message }) => {
        showToast(message || 'Не удалось вернуть карточку в черновик.');
      },
      conflictRefresh: async ({ routeContext: conflictRouteContext }) => {
        await refreshCardsCoreMutationAfterConflict({
          routeContext: conflictRouteContext || routeContext,
          reason: 'approval-return-conflict'
        });
      }
    });
    if (!result.ok) return;
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
  copy.documentDate = getCardCreatedDateValue(copy);
  copy.initialSnapshot = null;
  copy.materialIssues = [];
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

let pendingCardCopyDraft = null;

function appendCopySuffix(value, usedValues = []) {
  const trimmed = (value || '').toString().trim();
  if (!trimmed) return '';
  const base = trimmed.replace(/-copy\d*$/i, '');
  const basePrefix = base + '-copy';
  let maxSuffix = -1;
  (usedValues || []).forEach(raw => {
    const candidate = (raw || '').toString().trim();
    if (!candidate.startsWith(basePrefix)) return;
    const suffix = candidate.slice(basePrefix.length);
    if (suffix === '') {
      maxSuffix = Math.max(maxSuffix, 0);
      return;
    }
    if (!/^\d+$/.test(suffix)) return;
    maxSuffix = Math.max(maxSuffix, parseInt(suffix, 10));
  });
  if (maxSuffix >= 0) {
    return basePrefix + String(maxSuffix + 1);
  }
  return basePrefix;
}

function buildCardCopyDraft(template) {
  const draft = createEmptyCardDraft();
  const baseName = (template.itemName || template.name || '').toString().trim();
  const usedRouteNumbers = (cards || []).map(card => card && card.routeCardNumber).filter(Boolean);
  const usedDocDesignations = (cards || []).map(card => card && card.documentDesignation).filter(Boolean);
  const usedItemNames = (cards || []).map(card => card && (card.itemName || card.name)).filter(Boolean);
  draft.routeCardNumber = appendCopySuffix(template.routeCardNumber || '', usedRouteNumbers);
  draft.documentDesignation = appendCopySuffix(template.documentDesignation || '', usedDocDesignations);
  draft.documentDate = getCardCreatedDateValue(draft);
  draft.plannedCompletionDate = formatDateInputValue(template.plannedCompletionDate);
  draft.issuedBySurname = getSurnameFromUser(currentUser);
  draft.itemName = appendCopySuffix(baseName, usedItemNames);
  draft.name = draft.itemName || draft.name;
  draft.workBasis = template.workBasis || '';
  draft.itemDesignation = template.itemDesignation || '';
  draft.programName = template.programName || '';
  draft.labRequestNumber = template.labRequestNumber || '';
  draft.supplyState = template.supplyState || '';
  draft.supplyStandard = template.supplyStandard || '';
  draft.specialNotes = template.specialNotes || template.desc || '';
  draft.desc = draft.specialNotes;
  draft.mainMaterialGrade = template.mainMaterialGrade || template.material || '';
  draft.mainMaterials = '';
  draft.materialIssues = [];

  draft.quantity = template.quantity != null ? template.quantity : '';
  draft.batchSize = draft.quantity;
  draft.itemSerials = Array.isArray(template.itemSerials)
    ? template.itemSerials.slice()
    : normalizeSerialInput(template.itemSerials || '');
  draft.sampleCount = template.sampleCount != null ? template.sampleCount : '';
  draft.witnessSampleCount = template.witnessSampleCount != null ? template.witnessSampleCount : '';
  const currentYear = new Date().getFullYear();
  const serialBase = draft.itemName || '';
  draft.sampleSerials = buildSampleSerialDefaults([], toSafeCount(draft.sampleCount || 0), 'К', serialBase, currentYear, '');
  draft.witnessSampleSerials = buildSampleSerialDefaults([], toSafeCount(draft.witnessSampleCount || 0), 'С', serialBase, currentYear, '');
  draft.__serialRouteBase = serialBase;
  draft.partQrs = {};

  draft.operations = (template.operations || []).map(op => ({
    ...op,
    id: genId('rop'),
    status: 'NOT_STARTED',
    firstStartedAt: null,
    startedAt: null,
    lastPausedAt: null,
    finishedAt: null,
    elapsedSeconds: 0,
    actualSeconds: null
  }));

  renumberAutoCodesForCard(draft);
  return draft;
}

function duplicateCard(cardId) {
  const card = cards.find(c => c.id === cardId);
  if (!card) return;
  pendingCardCopyDraft = buildCardCopyDraft(card);
  navigateToRoute('/cards/new');
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

function refreshDerivedCardsCompatibilityViews() {
  const currentPath = window.location.pathname || '';
  if (currentPath === '/workorders' && typeof renderWorkordersTable === 'function') {
    renderWorkordersTable();
  }
  if (currentPath === '/archive' && typeof renderArchiveTable === 'function') {
    renderArchiveTable();
  }
  if ((currentPath.startsWith('/workorders/')
    || currentPath.startsWith('/archive/')
    || currentPath.startsWith('/workspace/'))
    && typeof refreshActiveWoPageIfAny === 'function') {
    refreshActiveWoPageIfAny();
  }
}

function patchCardFamilyAfterUpsert(card, previousCard = null) {
  if (!card || !card.id) return;
  if (typeof upsertCardEntity === 'function') {
    upsertCardEntity(card);
  }
  if (typeof syncCardsRowLive === 'function') syncCardsRowLive(card, previousCard);
  if (typeof syncDashboardRowLive === 'function') syncDashboardRowLive(card, previousCard);
  if (typeof syncApprovalsRowLive === 'function') syncApprovalsRowLive(card, previousCard);
  if (typeof syncProvisionRowLive === 'function') syncProvisionRowLive(card, previousCard);
  if (typeof syncInputControlRowLive === 'function') syncInputControlRowLive(card, previousCard);
  refreshDerivedCardsCompatibilityViews();
}

function patchCardFamilyAfterDelete(cardId, previousCard = null) {
  // UI patch only. Domain state must already be updated before this helper runs.
  if (!cardId) return;
  if (typeof removeCardsRowLive === 'function') removeCardsRowLive(cardId, previousCard);
  if (typeof removeDashboardRowLive === 'function') removeDashboardRowLive(cardId, previousCard);
  if (typeof removeApprovalsRowLive === 'function') removeApprovalsRowLive(cardId, previousCard);
  if (typeof removeProvisionRowLive === 'function') removeProvisionRowLive(cardId, previousCard);
  if (typeof removeInputControlRowLive === 'function') removeInputControlRowLive(cardId, previousCard);
  refreshDerivedCardsCompatibilityViews();
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

async function confirmDeletion() {
  if (!deleteContext || !deleteContext.id) {
    closeDeleteConfirm();
    return;
  }

  const { id } = deleteContext;
  deleteContext = null;
  const previousCard = cards.find(c => c.id === id) || null;
  closeDeleteConfirm();
  if (!previousCard) {
    return;
  }

  const routeContext = typeof captureClientWriteRouteContext === 'function'
    ? captureClientWriteRouteContext()
    : { fullPath: (window.location.pathname + window.location.search) || '/cards' };
  const expectedRev = getCardExpectedRev(previousCard);
  const result = await runClientWriteRequest({
    action: 'cards-core:delete-card',
    writePath: '/api/cards-core/' + encodeURIComponent(String(id || '').trim()),
    entity: 'card',
    entityId: id,
    expectedRev,
    routeContext,
    request: () => deleteCardsCoreCard(id, { expectedRev }),
    defaultErrorMessage: 'Не удалось удалить маршрутную карту.',
    defaultConflictMessage: 'Карточка уже была изменена другим пользователем. Данные обновлены.',
    onSuccess: async ({ payload }) => {
      const deletedId = String(payload?.deletedId || id || '').trim();
      workorderOpenCards.delete(deletedId);
      productionShiftTasks = (productionShiftTasks || []).filter(task => String(task?.cardId || '').trim() !== deletedId);
      if (typeof removeCardEntity === 'function') {
        removeCardEntity(deletedId);
      } else {
        deleteCardById(deletedId);
      }
      patchCardFamilyAfterDelete(deletedId, cloneCard(previousCard));
      const currentPath = window.location.pathname || '';
      if (currentPath === '/production/plan' && typeof renderProductionPlanPage === 'function') {
        renderProductionPlanPage();
      } else if (currentPath === '/production/shifts' && typeof renderProductionShiftBoardPage === 'function') {
        renderProductionShiftBoardPage();
      } else if ((currentPath.startsWith('/cards/') || currentPath.startsWith('/card-route/'))
        && typeof navigateToPath === 'function') {
        navigateToPath('/cards', { replace: true });
      } else if ((currentPath.startsWith('/cards/') || currentPath.startsWith('/card-route/'))
        && typeof handleRoute === 'function') {
        handleRoute('/cards', { replace: true, fromHistory: false });
      }
    },
    conflictRefresh: async ({ routeContext: conflictRouteContext }) => {
      if (typeof refreshCardsCoreMutationAfterConflict !== 'function') return;
      await refreshCardsCoreMutationAfterConflict({
        routeContext: conflictRouteContext || routeContext,
        reason: 'delete-conflict'
      });
    },
    onError: async ({ message }) => {
      showToast(message || 'Не удалось удалить маршрутную карту.');
    }
  });

  if (result?.isConflict) {
    showToast(result.message || 'Карточка уже была изменена другим пользователем. Данные обновлены.');
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
  const defaultName = getNextDefaultCardItemName();
  const createdAt = Date.now();
  return {
    id: genId('card'),
    barcode: generateUniqueCardCode128(),
    qrId: generateUniqueCardQrId(),
    cardType: normalizedType,
    name: defaultName,
    itemName: defaultName,
    routeCardNumber: '',
    documentDesignation: '',
    documentDate: formatDateInputValue(createdAt),
    plannedCompletionDate: '',
    issuedBySurname: '',
    programName: '',
    labRequestNumber: '',
    workBasis: '',
    supplyState: '',
    itemDesignation: '',
    supplyStandard: '',
    mainMaterials: '',
    mainMaterialGrade: '',
    materialIssues: [],
    batchSize: '',
    itemSerials: [],
    specialNotes: '',
    quantity: '',
    sampleCount: '',
    sampleSerials: [],
    witnessSampleCount: '',
    witnessSampleSerials: [],
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
    createdAt,
    logs: [],
    initialSnapshot: null,
    attachments: [],
    operations: []
  };
}

function getNextDefaultCardItemName(cardsList = cards) {
  const pattern = /^Изделие №(\d+)$/i;
  let maxNumber = 0;
  (cardsList || []).forEach(card => {
    const candidate = String(card?.itemName || card?.name || '').trim();
    const match = candidate.match(pattern);
    if (!match) return;
    const parsed = parseInt(match[1], 10);
    if (Number.isFinite(parsed) && parsed > maxNumber) {
      maxNumber = parsed;
    }
  });
  return 'Изделие №' + String(maxNumber + 1);
}

function getMissingRequiredCardFields(draft) {
  if (!draft) return [];
  const missing = [];
  if (!String(draft.routeCardNumber || '').trim()) missing.push('Маршрутная карта №');
  if (!String(draft.itemName || draft.name || '').trim()) missing.push('Наименование изделия');
  if (!String(draft.plannedCompletionDate || '').trim()) missing.push('Планируемая дата завершения');
  return missing;
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
        const clickedBtn = evt.currentTarget && evt.currentTarget.classList
          ? evt.currentTarget
          : (evt.target && typeof evt.target.closest === 'function'
            ? evt.target.closest('.tab-btn[data-action="card-tab"]')
            : null);
        if (clickedBtn) clickedBtn.classList.add("active");
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
    const allowView = typeof isReadonlyViewAllowedControl === 'function'
      ? isReadonlyViewAllowedControl(ctrl)
      : ctrl.dataset.allowView === 'true';
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
    const card = typeof getCardStoreCard === 'function'
      ? getCardStoreCard(cardId)
      : cards.find(c => c.id === cardId);
    if (!card) return;
    if (card.cardType !== 'MKI') {
      showToast('Маршрутная карта недоступна.');
      navigateToRoute('/cards');
      return;
    }
    activeCardDraft = cloneCard(card);
    activeCardIsNew = false;
  } else {
    if (pendingCardCopyDraft) {
      activeCardDraft = pendingCardCopyDraft;
      pendingCardCopyDraft = null;
    } else {
      activeCardDraft = createEmptyCardDraft();
    }
    activeCardIsNew = true;
  }
  const isMki = activeCardDraft.cardType === 'MKI';
  modal.classList.toggle('is-mki', isMki);
  document.body.classList.toggle('is-mki', isMki);
  ensureCardMeta(activeCardDraft, { skipSnapshot: activeCardIsNew });
  if (activeCardIsNew) {
    activeCardDraft.documentDate = getCardCreatedDateValue(activeCardDraft);
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
  document.getElementById('card-date').value = getCardCreatedDateValue(activeCardDraft);
  document.getElementById('card-planned-completion-date').value = activeCardDraft.plannedCompletionDate || '';
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
  const witnessSampleQtyInput = document.getElementById('card-witness-sample-qty');
  if (witnessSampleQtyInput) {
    witnessSampleQtyInput.value = activeCardDraft.witnessSampleCount != null ? activeCardDraft.witnessSampleCount : '';
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
  updateCardStatusTextElement(document.getElementById('card-status-text'), activeCardDraft);
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
  const routeControlToggle = document.getElementById('route-control-samples-toggle');
  if (routeControlToggle) routeControlToggle.checked = false;
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
    if (!silent && !restoringState) {
      navigateToRoute('/cards');
    }
    return;
  }
  if (silent || restoringState) return;
  if (appState.modal && appState.modal.type === 'card') {
    history.back();
  } else {
    setModalState(null, { replace: true });
  }
}

function getActiveCardPersistedEntity() {
  const cardId = activeCardOriginalId || (activeCardDraft && activeCardDraft.id) || '';
  if (!cardId) return null;
  if (typeof getCardStoreCard === 'function') {
    const stored = getCardStoreCard(cardId);
    if (stored) return stored;
  }
  return cards.find(c => c && c.id === cardId) || null;
}

function getCardExpectedRev(card) {
  const rev = Number(card?.rev);
  return Number.isFinite(rev) && rev > 0 ? rev : 1;
}

function resolveCardExpectedRev(previousCard, draft) {
  const draftRev = Number(draft?.rev);
  if (Number.isFinite(draftRev) && draftRev > 0) {
    return draftRev;
  }
  const previousRev = Number(previousCard?.rev);
  return Number.isFinite(previousRev) && previousRev > 0 ? previousRev : 1;
}

function getCardDetailPagePathForRoute(card, routePath = '') {
  if (!card) return '';
  const cleanPath = typeof normalizeSecurityRoutePath === 'function'
    ? normalizeSecurityRoutePath(routePath)
    : String(routePath || '').trim();
  if (cleanPath.startsWith('/card-route/')) {
    return getCardRoutePath(card);
  }
  const qr = normalizeQrId(card.qrId || card.barcode || '');
  const routeKey = isValidScanId(qr) ? qr : String(card.id || '').trim();
  return routeKey ? `/cards/${encodeURIComponent(routeKey)}` : '';
}

function shouldReturnToCardsListAfterPageSave(routePath = '', { keepDraftOpen = false } = {}) {
  if (keepDraftOpen) return false;
  const cleanPath = typeof normalizeSecurityRoutePath === 'function'
    ? normalizeSecurityRoutePath(routePath)
    : String(routePath || '').trim();
  return cleanPath === '/cards/new' || cleanPath.startsWith('/card-route/');
}

function getCardPageSaveSuccessToastMessage({ isCreate = false } = {}) {
  return isCreate ? 'Маршрутная карта создана.' : 'Маршрутная карта сохранена.';
}

function setCardSaveButtonPendingState(pending = false) {
  const saveBtn = document.getElementById('card-save-btn');
  if (!saveBtn) return;
  const nextPending = !!pending;
  saveBtn.classList.toggle('workspace-action-pending', nextPending);
  saveBtn.toggleAttribute('data-pending', nextPending);
  if (nextPending) {
    saveBtn.setAttribute('aria-busy', 'true');
    saveBtn.disabled = true;
  } else {
    saveBtn.removeAttribute('aria-busy');
    saveBtn.disabled = false;
  }
}

function syncActiveCardDraftAfterPersist(card) {
  if (!card) return;
  activeCardDraft = cloneCard(card);
  activeCardIsNew = false;
  activeCardOriginalId = card.id;
  const cardIdInput = document.getElementById('card-id');
  if (cardIdInput) {
    cardIdInput.value = card.id || '';
  }
  updateCardStatusTextElement(document.getElementById('card-status-text'), activeCardDraft);
  updateCardMainSummary();
  if (typeof renderInputControlTab === 'function') {
    renderInputControlTab(activeCardDraft);
  }
  if (typeof updateAttachmentCounters === 'function') {
    updateAttachmentCounters(card.id);
  }
}

async function saveCardDraft(options = {}) {
  if (!activeCardDraft) return null;
  const { closeModal = true, keepDraftOpen = false, skipRender = false } = options;
  const draft = cloneCard(activeCardDraft);
  const routeContext = typeof captureClientWriteRouteContext === 'function'
    ? captureClientWriteRouteContext()
    : {
      fullPath: typeof getFullPath === 'function'
        ? getFullPath()
        : ((window.location.pathname + window.location.search) || '/')
    };
  const pageRouteMode = cardRenderMode === 'page';
  const persistedCard = activeCardOriginalId == null
    ? null
    : getActiveCardPersistedEntity();
  const previousCard = persistedCard ? cloneCard(persistedCard) : null;
  const missingRequiredFields = getMissingRequiredCardFields(draft);
  if (missingRequiredFields.length) {
    alert('Заполните обязательные поля: ' + missingRequiredFields.join(', '));
    return null;
  }
  if (draft.cardType === 'MKI') {
    updateCardPartQrMap(draft, draft.itemSerials);
  }
  draft.operations = (draft.operations || []).map((op, idx) => ({
    ...op,
    order: typeof op.order === 'number' ? op.order : idx + 1,
    goodCount: toSafeCount(op.goodCount || 0),
    scrapCount: toSafeCount(op.scrapCount || 0),
    holdCount: toSafeCount(op.holdCount || 0),
    isSamples: draft.cardType === 'MKI' ? Boolean(op.isSamples) : false,
    sampleType: (draft.cardType === 'MKI' && op.isSamples)
      ? normalizeSampleType(op.sampleType)
      : '',
    quantity: getOperationQuantity(op, draft),
    autoCode: Boolean(op.autoCode),
    additionalExecutors: Array.isArray(op.additionalExecutors) ? op.additionalExecutors.slice(0, 2) : []
  }));
  const materialIssueCount = (draft.operations || []).filter(op => op && isMaterialIssueOperation(op)).length;
  const materialReturnCount = (draft.operations || []).filter(op => op && isMaterialReturnOperation(op)).length;
  if (materialIssueCount > 1) {
    if (typeof showToast === 'function') {
      showToast('В МК может быть только одна операция типа «Получение материала».');
    } else {
      alert('В МК может быть только одна операция типа «Получение материала».');
    }
    return null;
  }
  if (materialReturnCount > 1) {
    if (typeof showToast === 'function') {
      showToast('В МК может быть только одна операция типа «Возврат материала».');
    } else {
      alert('В МК может быть только одна операция типа «Возврат материала».');
    }
    return null;
  }
  if (materialReturnCount > 0 && materialIssueCount === 0) {
    if (typeof showToast === 'function') {
      showToast('Нельзя сохранить МК с «Возвратом материала» без операции «Получение материала».');
    } else {
      alert('Нельзя сохранить МК с «Возвратом материала» без операции «Получение материала».');
    }
    return null;
  }
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
  } else {
    if (!previousCard) {
      showToast('Карточка не найдена. Обновите страницу и попробуйте снова.');
      return null;
    }
    const original = cloneCard(previousCard);
    ensureCardMeta(original);
    ensureCardMeta(draft);
    draft.createdAt = original.createdAt || draft.createdAt;
    draft.initialSnapshot = original.initialSnapshot || draft.initialSnapshot;
    draft.logs = Array.isArray(original.logs) ? original.logs : [];
    logCardDifferences(original, draft);
  }

  const isCreate = activeCardIsNew || activeCardOriginalId == null;
  const cardsForUniquenessCheck = isCreate
    ? (cards || []).concat([draft])
    : (cards || []).map(card => (
      card && card.id === draft.id ? draft : card
    ));
  ensureUniqueQrIds(cardsForUniquenessCheck);
  ensureUniqueBarcodes(cardsForUniquenessCheck);
  const expectedRev = isCreate ? null : resolveCardExpectedRev(previousCard, draft);
  const conflictToastMessage = 'Карточка уже была изменена другим пользователем. Данные обновлены.';
  if (!isCreate) {
    const previousRev = Number(previousCard?.rev);
    const draftRev = Number(draft?.rev);
    if (
      Number.isFinite(previousRev) && previousRev > 0 &&
      Number.isFinite(draftRev) && draftRev > 0 &&
      previousRev !== draftRev
    ) {
      console.warn('[DATA] cards-core rev source mismatch', {
        cardId: String(previousCard?.id || draft?.id || activeCardOriginalId || '').trim() || null,
        previousRev,
        draftRev,
        expectedRev
      });
    }
  }
  const entityId = isCreate
    ? String(draft.id || '').trim()
    : String(previousCard?.id || activeCardOriginalId || '').trim();
  const writePath = isCreate
    ? '/api/cards-core'
    : '/api/cards-core/' + encodeURIComponent(entityId);
  let savedCard = null;
  const result = await runClientWriteRequest({
    action: isCreate ? 'cards-core:create-draft' : 'cards-core:update-card',
    writePath,
    entity: 'card',
    entityId,
    expectedRev,
    routeContext,
    request: () => (isCreate
      ? createCardsCoreCard(draft)
      : updateCardsCoreCard(entityId, draft, { expectedRev })),
    defaultErrorMessage: isCreate
      ? 'Не удалось создать маршрутную карту.'
      : 'Не удалось сохранить изменения маршрутной карты.',
    defaultConflictMessage: conflictToastMessage,
    onSuccess: async ({ payload }) => {
      const card = payload?.card && typeof payload.card === 'object' ? payload.card : null;
      if (!card) return;
      savedCard = card;
      if (typeof upsertCardEntity === 'function') {
        upsertCardEntity(card);
      }
      if (typeof markCardsCoreDetailLoaded === 'function') {
        markCardsCoreDetailLoaded(card);
      }
      if (!skipRender) {
        patchCardFamilyAfterUpsert(card, previousCard);
      }
    },
    conflictRefresh: async ({ routeContext: conflictRouteContext }) => {
      if (typeof refreshCardsCoreRouteAfterConflict !== 'function') return;
      await refreshCardsCoreRouteAfterConflict({
        routeContext: conflictRouteContext || routeContext,
        reason: 'save-conflict'
      });
    },
    onError: async ({ message }) => {
      showToast(message || (isCreate
        ? 'Не удалось создать маршрутную карту.'
        : 'Не удалось сохранить изменения маршрутной карты.'));
    }
  });
  if (!result.ok || !savedCard) {
    if (result?.isConflict) {
      showToast(conflictToastMessage);
    }
    return null;
  }

  syncActiveCardDraftAfterPersist(savedCard);
  if (closeModal && !pageRouteMode) {
    closeCardModal();
  }

  if (pageRouteMode) {
    const currentFullPath = routeContext.fullPath || '/';
    if (shouldReturnToCardsListAfterPageSave(currentFullPath, { keepDraftOpen })) {
      showToast(getCardPageSaveSuccessToastMessage({ isCreate }));
      window.__cardsRouteSkipEnterRefreshOnce = true;
      if (typeof navigateToPath === 'function') {
        navigateToPath('/cards', { replace: true });
      } else if (typeof handleRoute === 'function') {
        handleRoute('/cards', { replace: true, fromHistory: false });
      }
      return savedCard;
    }
    const targetPath = getCardDetailPagePathForRoute(savedCard, currentFullPath);
    const currentCleanPath = typeof normalizeSecurityRoutePath === 'function'
      ? normalizeSecurityRoutePath(currentFullPath)
      : currentFullPath;
    const targetCleanPath = typeof normalizeSecurityRoutePath === 'function'
      ? normalizeSecurityRoutePath(targetPath)
      : targetPath;
    if (targetPath && currentCleanPath !== targetCleanPath) {
      if (typeof navigateToPath === 'function') {
        navigateToPath(targetPath, { replace: true });
      } else if (typeof handleRoute === 'function') {
        handleRoute(targetPath, { replace: true, fromHistory: false });
      }
    }
  }

  return savedCard;
}

function syncCardDraftFromForm() {
  if (!activeCardDraft) return;
  activeCardDraft.routeCardNumber = document.getElementById('card-route-number').value.trim();
  activeCardDraft.documentDesignation = document.getElementById('card-document-designation').value.trim();
  activeCardDraft.documentDate = getCardCreatedDateValue(activeCardDraft);
  activeCardDraft.plannedCompletionDate = formatDateInputValue(document.getElementById('card-planned-completion-date').value.trim());
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

    const witnessRaw = document.getElementById('card-witness-sample-qty')?.value.trim() || '';
    const witnessVal = witnessRaw === '' ? '' : Math.max(0, parseInt(witnessRaw, 10) || 0);
    activeCardDraft.witnessSampleCount = Number.isFinite(witnessVal) ? witnessVal : '';

    activeCardDraft.itemSerials = collectSerialValuesFromTable('card-item-serials-table');
    activeCardDraft.sampleSerials = collectSerialValuesFromTable('card-sample-serials-table');
    activeCardDraft.witnessSampleSerials = collectSerialValuesFromTable('card-witness-sample-serials-table');
    const normalizedItems = normalizeSerialInput(activeCardDraft.itemSerials);
    const normalizedSamples = normalizeSerialInput(activeCardDraft.sampleSerials);
    const normalizedWitnessSamples = normalizeSerialInput(activeCardDraft.witnessSampleSerials);
    const qtyCount = activeCardDraft.quantity === '' ? 0 : toSafeCount(activeCardDraft.quantity);
    const sampleCount = activeCardDraft.sampleCount === '' ? 0 : toSafeCount(activeCardDraft.sampleCount);
    const witnessCount = activeCardDraft.witnessSampleCount === '' ? 0 : toSafeCount(activeCardDraft.witnessSampleCount);
    activeCardDraft.itemSerials = resizeSerialList(normalizedItems, qtyCount, { fillDefaults: true });
    activeCardDraft.sampleSerials = resizeSerialList(normalizedSamples, sampleCount, { fillDefaults: true });
    activeCardDraft.witnessSampleSerials = resizeSerialList(normalizedWitnessSamples, witnessCount, { fillDefaults: true });
    updateCardPartQrMap(activeCardDraft, activeCardDraft.itemSerials);
  } else {
    activeCardDraft.itemSerials = document.getElementById('card-item-serials').value.trim();
    activeCardDraft.sampleCount = '';
    activeCardDraft.sampleSerials = [];
    activeCardDraft.witnessSampleCount = '';
    activeCardDraft.witnessSampleSerials = [];
  }
  activeCardDraft.specialNotes = document.getElementById('card-desc').value.trim();
  activeCardDraft.desc = activeCardDraft.specialNotes;
}

function collectSerialValuesFromTable(tableId) {
  const table = document.getElementById(tableId);
  if (!table) return [];
  return Array.from(table.querySelectorAll('.serials-input')).map(input => input.value || '');
}

function renderSerialsTable(tableId, values = [], { showQrButtons = false } = {}) {
  const rows = (values || []).map((val, idx) => {
    const qrBtn = showQrButtons
      ? '<button type="button" class="serials-qr-btn" data-index="' + idx + '" data-allow-view="true" aria-label="QR-код изделия">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
            '<path d="M3 3h7v7H3V3zm2 2v3h3V5H5zm9-2h7v7h-7V3zm2 2v3h3V5h-3zM3 14h7v7H3v-7zm2 2v3h3v-3H5zm9 1h2v2h-2v-2zm-1-1h4v4h-4v-4zm5-1h2v2h-2v-2zm0 3h2v3h-2v-3z" />' +
          '</svg>' +
        '</button>'
      : '';
    return '<tr>' +
      '<td class="serials-index-cell">' + (idx + 1) + '.</td>' +
      '<td class="serials-input-cell">' +
        '<div class="serials-input-row">' +
          '<input class="serials-input" data-index="' + idx + '" value="' + escapeHtml(val || '') + '" placeholder="Без номера ' + (idx + 1) + '">' +
          qrBtn +
        '</div>' +
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
  const witnessQtyField = document.getElementById('field-witness-sample-qty');
  if (witnessQtyField) witnessQtyField.classList.toggle('hidden', !isMki);
  const witnessSerialsField = document.getElementById('field-witness-sample-serials');
  if (witnessSerialsField) witnessSerialsField.classList.toggle('hidden', !isMki);
}

function getActiveCardSampleAvailability() {
  const isMki = activeCardDraft && activeCardDraft.cardType === 'MKI';
  const controlCount = isMki ? toSafeCount(activeCardDraft.sampleCount || 0) : 0;
  const witnessCount = isMki ? toSafeCount(activeCardDraft.witnessSampleCount || 0) : 0;
  return {
    isMki,
    controlCount,
    witnessCount,
    hasControl: isMki && controlCount > 0,
    hasWitness: isMki && witnessCount > 0,
    hasSamples: isMki && (controlCount > 0 || witnessCount > 0)
  };
}

function cleanupMkiRouteFormUi() {
  if (!activeCardDraft || activeCardDraft.cardType !== 'MKI') return;
  const disabledSamplesText = 'Операции по образцам недоступны при нулевом количестве образцов';

  document.querySelectorAll('#route-form .route-samples-hint-text').forEach(node => node.remove());
  document.querySelectorAll('#route-form *').forEach(node => {
    if (node.textContent && node.textContent.trim() === disabledSamplesText) {
      node.remove();
    }
  });

}

function updateRouteFormQuantityUI() {
  const qtyLabel = document.getElementById('route-qty-label');
  const qtyInput = document.getElementById('route-qty');
  const samplesCol = document.getElementById('route-samples-col');
  const controlCol = document.getElementById('route-control-samples-col');
  const witnessToggle = document.getElementById('route-samples-toggle');
  const controlToggle = document.getElementById('route-control-samples-toggle');
  const { isMki, hasControl, hasWitness } = getActiveCardSampleAvailability();

  if (samplesCol) samplesCol.classList.toggle('hidden', !isMki);
  if (controlCol) controlCol.classList.toggle('hidden', !isMki);
  if (witnessToggle) {
    if (!hasWitness) witnessToggle.checked = false;
    witnessToggle.disabled = !hasWitness;
  }
  if (controlToggle) {
    if (!hasControl) controlToggle.checked = false;
    controlToggle.disabled = !hasControl;
  }

  if (!qtyLabel || !qtyInput) return;
  const isWitnessMode = Boolean(witnessToggle && witnessToggle.checked);
  const isControlMode = Boolean(controlToggle && controlToggle.checked);
  if (isMki) {
    if (isWitnessMode) {
      qtyLabel.textContent = 'Кол-во образцов свидетелей';
    } else if (isControlMode) {
      qtyLabel.textContent = 'Кол-во контрольных образцов';
    } else {
      qtyLabel.textContent = 'Кол-во изделий';
    }
    const value = isWitnessMode
      ? (activeCardDraft && activeCardDraft.witnessSampleCount !== '' ? activeCardDraft.witnessSampleCount : '')
      : (isControlMode
        ? (activeCardDraft && activeCardDraft.sampleCount !== '' ? activeCardDraft.sampleCount : '')
        : (activeCardDraft && activeCardDraft.quantity !== '' ? activeCardDraft.quantity : ''));
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
  const sampleQtyBlock = getProductsLayoutBlockByLabel(tab, 'Количество контрольных образцов');
  const itemSerialsBlock = getProductsLayoutBlockByLabel(tab, 'Индивидуальные номера изделий');
  const sampleSerialsBlock = getProductsLayoutBlockByLabel(tab, 'Индивидуальные номера контрольных образцов');
  const witnessQtyBlock = getProductsLayoutBlockByLabel(tab, 'Количество образцов свидетелей');
  const witnessSerialsBlock = getProductsLayoutBlockByLabel(tab, 'Индивидуальные номера образцов свидетелей');

  const grid = document.createElement('div');
  grid.className = 'mki-products-grid';

  const buildColumn = (blocks) => {
    const col = document.createElement('div');
    col.className = 'mki-products-column';
    blocks.forEach(block => {
      if (block) col.appendChild(block);
    });
    return col;
  };

  grid.appendChild(buildColumn([batchBlock, itemSerialsBlock]));
  grid.appendChild(buildColumn([sampleQtyBlock, sampleSerialsBlock]));
  grid.appendChild(buildColumn([witnessQtyBlock, witnessSerialsBlock]));

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
  const routeNo = (activeCardDraft.routeCardNumber || '').trim();
  const prevRouteNo = (activeCardDraft.__serialRouteBase || '').trim();
  const currentYear = new Date().getFullYear();
  const qty = activeCardDraft.quantity === '' ? 0 : toSafeCount(activeCardDraft.quantity);
  const normalizedItems = normalizeSerialInput(activeCardDraft.itemSerials);
  activeCardDraft.itemSerials = resizeSerialList(normalizedItems, qty, { fillDefaults: true });
  const itemFieldLabel = document.querySelector('#field-item-serials > label');
  if (itemFieldLabel) {
    itemFieldLabel.classList.toggle('hidden', activeCardDraft.quantity === '' || activeCardDraft.quantity == null);
  }
  const itemWrapper = document.getElementById('card-item-serials-table-wrapper');
  if (itemWrapper) {
    const pathname = window.location.pathname || '';
    const isCardRoutePage = pathname.startsWith('/card-route/')
      || window.__isCardRoutePage === true
      || (appState && typeof appState.route === 'string' && appState.route.startsWith('/card-route/'));
    itemWrapper.innerHTML = renderSerialsTable('card-item-serials-table', activeCardDraft.itemSerials, { showQrButtons: isCardRoutePage });
    const printAllBtn = document.getElementById('card-print-all-qr-btn');
    const actionsWrap = document.querySelector('#field-item-serials .serials-actions');
    if (printAllBtn) {
      const hasSerials = Array.isArray(activeCardDraft.itemSerials)
        ? activeCardDraft.itemSerials.some(val => (val || '').toString().trim())
        : Boolean((activeCardDraft.itemSerials || '').toString().trim());
      const shouldShow = isCardRoutePage && hasSerials;
      printAllBtn.classList.toggle('hidden', !shouldShow);
      if (actionsWrap) actionsWrap.classList.toggle('hidden', !shouldShow);
    }
  }

  const sampleCount = activeCardDraft.sampleCount === '' ? 0 : toSafeCount(activeCardDraft.sampleCount);
  activeCardDraft.sampleSerials = buildSampleSerialDefaults(
    activeCardDraft.sampleSerials,
    sampleCount,
    'К',
    routeNo,
    currentYear,
    prevRouteNo
  );
  const sampleField = document.getElementById('field-sample-serials');
  if (sampleField) sampleField.classList.toggle('hidden', sampleCount === 0);
  const sampleWrapper = document.getElementById('card-sample-serials-table-wrapper');
  if (sampleWrapper) {
    sampleWrapper.innerHTML = sampleCount > 0
      ? renderSerialsTable('card-sample-serials-table', activeCardDraft.sampleSerials)
      : '';
  }

  const witnessCount = activeCardDraft.witnessSampleCount === '' ? 0 : toSafeCount(activeCardDraft.witnessSampleCount);
  activeCardDraft.witnessSampleSerials = buildSampleSerialDefaults(
    activeCardDraft.witnessSampleSerials,
    witnessCount,
    'С',
    routeNo,
    currentYear,
    prevRouteNo
  );
  activeCardDraft.__serialRouteBase = routeNo;
  const witnessField = document.getElementById('field-witness-sample-serials');
  if (witnessField) witnessField.classList.toggle('hidden', witnessCount === 0);
  const witnessWrapper = document.getElementById('card-witness-sample-serials-table-wrapper');
  if (witnessWrapper) {
    witnessWrapper.innerHTML = witnessCount > 0
      ? renderSerialsTable('card-witness-sample-serials-table', activeCardDraft.witnessSampleSerials)
      : '';
  }
}

function buildSampleSerialDefaults(values, count, prefixLetter, routeNo, year, prevRouteNo) {
  return normalizeAutoSampleSerials(values, count, prefixLetter, routeNo, year, prevRouteNo);
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
}

function logCardDifferences(original, updated) {
  if (!original || !updated) return;
  const cardRef = updated;
  const fields = [
    'itemName',
    'routeCardNumber',
    'documentDesignation',
    'documentDate',
    'plannedCompletionDate',
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
    'witnessSampleCount',
    'witnessSampleSerials',
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
  const addBtn = document.getElementById('attachments-add-btn');
  const input = document.getElementById('attachments-input');
  if (!card || !list || !title || !uploadHint) return;
  ensureAttachments(card);
  const readonly = typeof isCurrentTabReadonly === 'function' ? isCurrentTabReadonly() : false;
  title.textContent = formatCardTitle(card) || getCardBarcodeValue(card) || 'Файлы карты';
  if (addBtn) {
    addBtn.disabled = readonly;
    addBtn.classList.toggle('hidden', readonly);
  }
  if (input) input.disabled = readonly;
  if (attachmentContext.loading) {
    list.innerHTML = '<p>Загрузка файлов...</p>';
    uploadHint.textContent = readonly
      ? 'Доступны просмотр и скачивание файлов.'
      : 'Допустимые форматы: pdf, doc, jpg, архив. Максимум ' + formatBytes(ATTACH_MAX_SIZE) + '.';
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
    let html = '<table class="attachments-table"><thead><tr><th>Имя файла</th><th>Размер</th><th>Дата</th><th>Операция</th><th>Изделия</th><th>Действия</th></tr></thead><tbody>';
    files.forEach(file => {
      const date = new Date(file.createdAt || Date.now()).toLocaleString();
      const badge = isInputControl(file) ? ' <span class="badge">Входной контроль (ПВХ)</span>' : '';
      const opLabel = (file.operationLabel || '').trim()
        || (file.opCode || file.opName ? [file.opCode || '', file.opName || ''].filter(Boolean).join(' - ') : '');
      const itemsLabel = (file.itemsLabel || '').trim();
      const deleteButton = readonly ? '' : '<button class="btn-small btn-delete" data-delete-id="' + file.id + '">🗑️</button>';
      html += '<tr>' +
        '<td>' + escapeHtml(file.name || 'файл') + badge + '</td>' +
        '<td>' + escapeHtml(formatBytes(file.size)) + '</td>' +
        '<td>' + escapeHtml(date) + '</td>' +
        '<td>' + escapeHtml(opLabel) + '</td>' +
        '<td>' + escapeHtml(itemsLabel) + '</td>' +
        '<td><div class="table-actions">' +
        '<button class="btn-small" data-preview-id="' + file.id + '">Открыть</button>' +
        '<button class="btn-small" data-download-id="' + file.id + '">Скачать</button>' +
        deleteButton +
        '</div></td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    list.innerHTML = wrapTable(html);
  }
  uploadHint.textContent = readonly
    ? 'Доступны просмотр и скачивание файлов.'
    : 'Допустимые форматы: pdf, doc, jpg, архив. Максимум ' + formatBytes(ATTACH_MAX_SIZE) + '.';

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

function isStandalonePwaRuntime() {
  try {
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
      return true;
    }
  } catch (err) {
    // ignore runtime feature detection failure
  }
  return window.navigator && window.navigator.standalone === true;
}

function getAttachmentDisplayName(file) {
  return String(file?.originalName || file?.name || file?.storedName || 'file').trim() || 'file';
}

async function openAttachmentUrlForCurrentRuntime(url, {
  download = false,
  fileName = '',
  connectionSource = 'card-file'
} = {}) {
  if (!url) return false;
  if (isStandalonePwaRuntime()) {
    window.open(url, '_blank', 'noopener');
    return true;
  }

  const request = typeof apiFetch === 'function' ? apiFetch : fetch;
  let previewWindow = null;
  if (!download) {
    previewWindow = window.open('', '_blank', 'noopener');
  }
  try {
    const res = await request(url, {
      method: 'GET',
      connectionSource: connectionSource + (download ? ':browser-download' : ':browser-preview')
    });
    if (!res.ok) {
      throw new Error('Ответ сервера ' + res.status);
    }
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const cleanup = () => {
      setTimeout(() => {
        try {
          URL.revokeObjectURL(blobUrl);
        } catch (err) {
          // ignore object url cleanup failure
        }
      }, 10 * 60 * 1000);
    };
    if (download) {
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = fileName || 'file';
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
      cleanup();
      return true;
    }
    if (previewWindow && !previewWindow.closed) {
      previewWindow.location.href = blobUrl;
      cleanup();
      return true;
    }
    window.open(blobUrl, '_blank', 'noopener');
    cleanup();
    return true;
  } catch (err) {
    if (previewWindow && !previewWindow.closed) {
      previewWindow.close();
    }
    throw err;
  }
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
  try {
    await openAttachmentUrlForCurrentRuntime(url, {
      download: true,
      fileName: getAttachmentDisplayName(resolved),
      connectionSource: 'card-file-download'
    });
  } catch (err) {
    showToast('Не удалось скачать файл');
  }
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
  try {
    await openAttachmentUrlForCurrentRuntime(url, {
      download: false,
      fileName: getAttachmentDisplayName(resolved),
      connectionSource: 'card-file-preview'
    });
  } catch (err) {
    showToast('Не удалось открыть файл');
  }
}

async function deleteAttachment(fileId) {
  if (typeof isCurrentTabReadonly === 'function' && isCurrentTabReadonly()) {
    showToast('Для вашей роли удаление файлов недоступно');
    return;
  }
  const card = getAttachmentTargetCard();
  if (!card) return;
  ensureAttachments(card);
  const previousCard = cloneCard(card);
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
    patchCardFamilyAfterUpsert(card, previousCard);
    renderAttachmentsModal();
    updateAttachmentCounters(card.id);
    updateTableAttachmentCount(card.id);
    showToast('Файл удалён');
  } catch (err) {
    showToast('Не удалось удалить файл');
  }
}

async function addAttachmentsFromFiles(fileList) {
  if (typeof isCurrentTabReadonly === 'function' && isCurrentTabReadonly()) {
    showToast('Для вашей роли загрузка файлов недоступна');
    return;
  }
  const card = getAttachmentTargetCard();
  if (!card || !fileList || !fileList.length) return;
  ensureAttachments(card);
  const previousCard = cloneCard(card);
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
    patchCardFamilyAfterUpsert(card, previousCard);
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
  const previousCard = cloneCard(card);
  const uploaded = await addInputControlAttachment(card, file);
  if (!uploaded || !uploaded.inputControlFileId) return;
  applyFilesPayloadToCard(card.id, { files: uploaded.files || [], inputControlFileId: uploaded.inputControlFileId });
  if (activeCardDraft && activeCardDraft.id === card.id) {
    activeCardDraft.attachments = (card.attachments || []).map(item => ({ ...item }));
    activeCardDraft.inputControlFileId = card.inputControlFileId || '';
    renderInputControlTab(activeCardDraft);
    updateAttachmentCounters(card.id);
  }
  patchCardFamilyAfterUpsert(card, previousCard);
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
  try {
    await openAttachmentUrlForCurrentRuntime(url, {
      download: false,
      fileName: getAttachmentDisplayName(resolved),
      connectionSource: 'input-control-file-preview'
    });
  } catch (err) {
    showToast('Не удалось открыть файл для просмотра');
  }
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
  try {
    await openAttachmentUrlForCurrentRuntime(url, {
      download: true,
      fileName: getAttachmentDisplayName(resolved),
      connectionSource: 'input-control-file-download'
    });
  } catch (err) {
    showToast('Не удалось скачать файл');
  }
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
  const commentInput = document.getElementById('input-control-comment-input');
  const fileInput = document.getElementById('input-control-modal-file');
  if (!commentInput || !fileInput) {
    closeInputControlModal();
    return;
  }
  let card = cards.find(c => c.id === inputControlContextCardId);
  if (!card) {
    closeInputControlModal();
    return;
  }
  const comment = (commentInput.value || '').trim();
  if (!comment) {
    alert('Введите комментарий');
    return;
  }
  if (typeof isCurrentTabReadonly === 'function' && isCurrentTabReadonly()) {
    showToast('Для вашей роли входной контроль недоступен');
    return;
  }
  if (
    card.approvalStage !== APPROVAL_STAGE_APPROVED &&
    card.approvalStage !== APPROVAL_STAGE_WAITING_INPUT_CONTROL &&
    card.approvalStage !== APPROVAL_STAGE_WAITING_PROVISION
  ) {
    alert('Входной контроль доступен только после согласования.');
    return;
  }
  const file = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
  if (file) {
    const uploaded = await addInputControlAttachment(card, file);
    if (uploaded) {
      fileInput.value = '';
      try {
        const refreshedCard = typeof fetchCardsCoreCard === 'function'
          ? await fetchCardsCoreCard(card.id, { force: true, reason: 'input-control-upload-refresh' })
          : null;
        if (refreshedCard && refreshedCard.id) {
          card = refreshedCard;
          if (
            activeCardDraft
            && activeCardDraft.id === refreshedCard.id
            && typeof syncActiveCardDraftAfterPersist === 'function'
          ) {
            syncActiveCardDraftAfterPersist(refreshedCard);
          }
        } else {
          showToast('Файл ПВХ загружен, но не удалось обновить карточку перед входным контролем.');
          return;
        }
      } catch (err) {
        showToast('Файл ПВХ загружен, но не удалось обновить карточку перед входным контролем.');
        return;
      }
    }
  }
  const previousCard = cloneCard(card);
  const expectedRev = getCardExpectedRev(previousCard);
  const routeContext = typeof captureClientWriteRouteContext === 'function'
    ? captureClientWriteRouteContext()
    : { fullPath: (window.location.pathname + window.location.search) || '/input-control' };
  const result = await runClientWriteRequest({
    action: 'cards-input-control:complete',
    writePath: '/api/cards-core/' + encodeURIComponent(String(card.id || '').trim()) + '/input-control/complete',
    entity: 'card',
    entityId: card.id,
    expectedRev,
    routeContext,
    request: () => completeCardInputControl(card.id, { expectedRev, comment }),
    defaultErrorMessage: 'Не удалось выполнить входной контроль.',
    defaultConflictMessage: 'Карточка уже была изменена другим пользователем. Данные обновлены.',
    onSuccess: async ({ payload }) => {
      const savedCard = payload?.card || null;
      if (!savedCard || !savedCard.id) {
        throw new Error('Сервер не вернул карточку после входного контроля');
      }
      if (
        activeCardDraft
        && activeCardDraft.id === savedCard.id
        && typeof syncActiveCardDraftAfterPersist === 'function'
      ) {
        syncActiveCardDraftAfterPersist(savedCard);
      }
      patchCardFamilyAfterUpsert(savedCard, previousCard);
      closeInputControlModal();
      showToast(savedCard.approvalStage === APPROVAL_STAGE_PROVIDED
        ? 'Входной контроль выполнен. Карта переведена в производство'
        : 'Входной контроль выполнен');
    },
    onConflict: async ({ message }) => {
      closeInputControlModal();
      showToast(message || 'Карточка уже была изменена другим пользователем. Данные обновлены.');
    },
    onError: async ({ message }) => {
      showToast(message || 'Не удалось выполнить входной контроль.');
    },
    conflictRefresh: async ({ routeContext: conflictRouteContext }) => {
      await refreshCardsCoreMutationAfterConflict({
        routeContext: conflictRouteContext || routeContext,
        reason: 'input-control-complete-conflict'
      });
    }
  });
  if (!result.ok) return;
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
  const previousCard = cloneCard(card);
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
  patchCardFamilyAfterUpsert(card, previousCard);
  showToast(card.approvalStage === APPROVAL_STAGE_PROVIDED
    ? 'Обеспечение выполнено. Карта переведена в производство'
    : 'Обеспечение выполнено');
}

function cardLogTrim(value) {
  return value == null ? '' : String(value).trim();
}

function getCardLogOperationStatusLabel(status) {
  const code = cardLogTrim(status).toUpperCase();
  if (code === 'IN_PROGRESS') return 'В работе';
  if (code === 'PAUSED') return 'Пауза';
  if (code === 'DONE') return 'Завершена';
  if (code === 'NO_ITEMS') return 'Нет изделий/образцов';
  if (code === 'NOT_STARTED') return 'Не начата';
  return cardLogTrim(status);
}

function getCardLogFlowStatusLabel(status) {
  const code = cardLogTrim(status).toUpperCase();
  if (code === 'PENDING') return 'Ожидает';
  if (code === 'GOOD') return 'Годно';
  if (code === 'DEFECT') return 'Брак';
  if (code === 'DELAYED') return 'Задержано';
  if (code === 'DISPOSED') return 'Утилизировано';
  return cardLogTrim(status);
}

function getCardLogApprovalStageLabel(value) {
  const code = cardLogTrim(value).toUpperCase();
  if (code === 'DRAFT') return 'Черновик';
  if (code === 'ON_APPROVAL') return 'На согласовании';
  if (code === 'REJECTED') return 'Отклонена';
  if (code === 'APPROVED') return 'Согласована';
  if (code === 'WAITING_PROVISION') return 'Ожидает обеспечения';
  if (code === 'WAITING_INPUT_CONTROL') return 'Ожидает входного контроля';
  if (code === 'PROVIDED') return 'Обеспечена';
  if (code === 'PLANNING') return 'В планировании';
  if (code === 'PLANNED') return 'Запланирована';
  return cardLogTrim(value);
}

function getCardLogApprovalStatusLabel(value) {
  const code = cardLogTrim(value).toUpperCase();
  if (code === 'APPROVED') return 'Согласовано';
  if (code === 'REJECTED') return 'Отклонено';
  if (code === 'PENDING' || code === 'ON_APPROVAL') return 'На согласовании';
  if (code === 'DONE') return 'Выполнено';
  if (code === 'NOT_STARTED') return 'Не начато';
  return cardLogTrim(value);
}

function getCardLogFinalStatusLabel(value) {
  const code = cardLogTrim(value).toUpperCase();
  if (code === 'PENDING') return 'Не завершено';
  if (code === 'GOOD') return 'Годно';
  if (code === 'DEFECT') return 'Брак';
  if (code === 'DELAYED') return 'Задержано';
  if (code === 'DISPOSED') return 'Утилизировано';
  return cardLogTrim(value);
}

function getCardLogFlowFinalStatusByStep(card, item, entry) {
  const code = cardLogTrim(entry?.status).toUpperCase();
  if (code === 'DEFECT' || code === 'DELAYED' || code === 'DISPOSED') return code;
  if (code !== 'GOOD') return 'PENDING';
  const lastOp = getCardLogLastOperationForItem(card, item);
  const lastOpId = cardLogTrim(lastOp?.id || lastOp?.opId);
  const lastOpCode = cardLogTrim(lastOp?.opCode || lastOp?.code);
  const entryOpId = cardLogTrim(entry?.opId);
  const entryOpCode = cardLogTrim(entry?.opCode);
  const isLastOp = (lastOpId && entryOpId && lastOpId === entryOpId)
    || (!lastOpId && lastOpCode && entryOpCode && lastOpCode === entryOpCode);
  return isLastOp ? 'GOOD' : 'PENDING';
}

function getCardLogFinalStatusDisplay(value) {
  const code = cardLogTrim(value).toUpperCase();
  if (code === 'DELAYED') return 'Задержано';
  return getCardLogFinalStatusLabel(value);
}

function getCardLogAreaLabel(areaId) {
  const key = cardLogTrim(areaId);
  const areasList = (typeof areas !== 'undefined' && Array.isArray(areas))
    ? areas
    : (Array.isArray(globalThis.productionAreas) ? globalThis.productionAreas : []);
  const area = areasList.find(item => cardLogTrim(item?.id) === key);
  return cardLogTrim(area?.name || area?.title || key || 'Участок');
}

function getCardLogOperationLabel(card, targetId, fallback = '') {
  const op = (card?.operations || []).find(item => cardLogTrim(item?.id) === cardLogTrim(targetId));
  if (op) {
    const code = cardLogTrim(op?.opCode || op?.code || '');
    const name = cardLogTrim(op?.opName || op?.name || '');
    if (code && name) return `${code} ${name}`;
    if (code || name) return code || name;
  }
  return cardLogTrim(fallback || '');
}

function getCardLogLastOperationForItem(card, item) {
  const ops = Array.isArray(card?.operations) ? card.operations : [];
  const isSample = cardLogTrim(item?.kind).toUpperCase() === 'SAMPLE';
  const sampleType = typeof normalizeSampleType === 'function'
    ? normalizeSampleType(item?.sampleType)
    : cardLogTrim(item?.sampleType).toUpperCase();
  const filtered = ops.filter(op => {
    if (!op) return false;
    if (Boolean(op.isSamples) !== isSample) return false;
    if (!isSample) return true;
    const opSampleType = typeof normalizeSampleType === 'function'
      ? normalizeSampleType(op?.sampleType)
      : cardLogTrim(op?.sampleType).toUpperCase();
    return opSampleType === sampleType;
  });
  if (!filtered.length) return null;
  const sorted = filtered
    .map((op, index) => ({
      op,
      index,
      order: Number.isFinite(op?.order) ? Number(op.order) : index
    }))
    .sort((a, b) => (a.order - b.order) || (a.index - b.index));
  return sorted.length ? (sorted[sorted.length - 1].op || null) : null;
}

function getCardLogItemKindLabel(item) {
  if (!item || cardLogTrim(item.kind).toUpperCase() !== 'SAMPLE') return 'Изделие';
  if (typeof normalizeSampleType === 'function' && normalizeSampleType(item.sampleType) === 'WITNESS') return 'ОС';
  return 'ОК';
}

function getCardLogPlanningText(task, op = null) {
  if (!task) return '';
  const dateLabel = typeof getProductionDayLabel === 'function'
    ? (getProductionDayLabel(task.date || '').date || cardLogTrim(task.date))
    : cardLogTrim(task.date);
  const shift = parseInt(task.shift, 10) || 1;
  const areaLabel = getCardLogAreaLabel(task.areaId);
  const minutes = typeof getTaskPlannedMinutes === 'function'
    ? getTaskPlannedMinutes(task)
    : (Number(task?.plannedPartMinutes) || 0);
  const minutesLabel = `${Math.max(0, Math.round(minutes || 0))} мин`;
  const qtyLabel = typeof getTaskPlannedQuantityLabel === 'function'
    ? getTaskPlannedQuantityLabel(task, op)
    : '';
  return `Участок: ${areaLabel}; дата: ${dateLabel}; смена: ${shift}; объём: ${qtyLabel ? `${qtyLabel} / ` : ''}${minutesLabel}`;
}

function formatCardLogValue(entry, value) {
  const field = cardLogTrim(entry?.field);
  const raw = cardLogTrim(value);
  if (!raw) return '—';
  if (field === 'status') {
    if (cardLogTrim(entry?.action) === 'Статус операции' || cardLogTrim(entry?.action) === 'Статус карты') {
      return getCardLogOperationStatusLabel(raw);
    }
    return getCardLogFlowStatusLabel(raw);
  }
  if (field === 'finalStatus') return getCardLogFinalStatusLabel(raw);
  if (field === 'approvalStage') return getCardLogApprovalStageLabel(raw);
  if (field === 'approvalProductionStatus' || field === 'approvalSKKStatus' || field === 'approvalTechStatus') {
    return getCardLogApprovalStatusLabel(raw);
  }
  return raw;
}

function normalizeCardHistoryEntry(card, entry) {
  const actionRaw = cardLogTrim(entry?.action);
  const field = cardLogTrim(entry?.field);
  let action = actionRaw || 'Изменение';
  let object = cardLogTrim(entry?.object);
  let oldValue = formatCardLogValue(entry, entry?.oldValue);
  let newValue = formatCardLogValue(entry, entry?.newValue);
  const operationLabel = getCardLogOperationLabel(card, entry?.targetId, object);

  if (actionRaw === 'approval') {
    action = 'Согласование';
    object = 'Стадия согласования';
  } else if (actionRaw === 'Статус операции') {
    action = 'Изменение статуса';
    object = operationLabel ? `Операция «${operationLabel}»` : 'Операция';
  } else if (actionRaw === 'Статус карты') {
    action = 'Изменение статуса';
    object = 'Маршрутная карта';
  } else if (actionRaw === 'PERSONAL_OPERATION_SELECT') {
    action = 'Выбор изделий';
    object = operationLabel ? `Личная операция «${operationLabel}»` : 'Личная операция';
  } else if (actionRaw === 'PERSONAL_OPERATION_START') {
    action = 'Начало выполнения';
    object = operationLabel ? `Личная операция «${operationLabel}»` : 'Личная операция';
  } else if (actionRaw === 'PERSONAL_OPERATION_PAUSE') {
    action = 'Пауза';
    object = operationLabel ? `Личная операция «${operationLabel}»` : 'Личная операция';
  } else if (actionRaw === 'PERSONAL_OPERATION_RESUME') {
    action = 'Продолжение';
    object = operationLabel ? `Личная операция «${operationLabel}»` : 'Личная операция';
  } else if (actionRaw === 'PERSONAL_OPERATION_COMPLETE') {
    action = 'Завершение';
    object = operationLabel ? `Личная операция «${operationLabel}»` : 'Личная операция';
  } else if (actionRaw === 'PERSONAL_OPERATION_FINISH') {
    action = 'Завершение операции';
    object = operationLabel ? `Личная операция «${operationLabel}»` : 'Личная операция';
  } else if (actionRaw === 'PERSONAL_OPERATION_HANDOFF') {
    action = 'Передача исполнителю';
    object = operationLabel ? `Личная операция «${operationLabel}»` : 'Личная операция';
  } else if (field === 'planning') {
    object = operationLabel ? `Операция «${operationLabel}»` : 'Планирование операции';
  } else if (field === 'approvalStage') {
    object = 'Стадия согласования';
  } else if (field === 'approvalProductionStatus') {
    object = 'Согласование начальником производства';
  } else if (field === 'approvalSKKStatus') {
    object = 'Согласование начальником СКК';
  } else if (field === 'approvalTechStatus') {
    object = 'Согласование ЗГД по технологиям';
  } else if (field === 'status' && object) {
    object = `Объект «${object}»`;
  }

  return {
    ts: Number(entry?.ts) || Date.now(),
    action,
    object: object || 'Маршрутная карта',
    oldValue,
    newValue,
    userName: cardLogTrim(entry?.userName || entry?.createdBy) || '—'
  };
}

function collectCardFlowHistoryRows(card) {
  const rows = [];
  const collections = []
    .concat(Array.isArray(card?.flow?.items) ? card.flow.items : [])
    .concat(Array.isArray(card?.flow?.samples) ? card.flow.samples : []);

  collections.forEach(item => {
    const kindLabel = getCardLogItemKindLabel(item);
    const itemLabel = cardLogTrim(item?.displayName || item?.id || kindLabel);
    const history = Array.isArray(item?.history) ? item.history.slice().sort((a, b) => (a?.at || 0) - (b?.at || 0)) : [];
    let prevStatus = '';
    let prevFinalStatus = 'PENDING';
    history.forEach(entry => {
      const status = cardLogTrim(entry?.status).toUpperCase();
      const opLabel = getCardLogOperationLabel(card, entry?.opId, entry?.opCode || '');
      const objectBase = `${kindLabel} «${itemLabel}»`;
      if (status && status !== prevStatus) {
        rows.push({
          ts: Number(entry?.at) || Date.now(),
          action: 'Изменение статуса',
          object: opLabel ? `${objectBase} · ${opLabel}` : objectBase,
          oldValue: prevStatus ? getCardLogFlowStatusLabel(prevStatus) : '—',
          newValue: getCardLogFlowStatusLabel(status),
          userName: cardLogTrim(entry?.userName || entry?.createdBy) || '—'
        });
        prevStatus = status;
      }
      const nextFinalStatus = getCardLogFlowFinalStatusByStep(card, item, entry);
      if (nextFinalStatus !== prevFinalStatus) {
        rows.push({
          ts: Number(entry?.at) || Date.now(),
          action: 'Изменение итогового статуса',
          object: objectBase,
          oldValue: getCardLogFinalStatusDisplay(prevFinalStatus),
          newValue: getCardLogFinalStatusDisplay(nextFinalStatus),
          userName: cardLogTrim(entry?.userName || entry?.createdBy) || '—'
        });
        prevFinalStatus = nextFinalStatus;
      }
    });
  });

  return rows;
}

function collectCardPlanningFallbackRows(card, existingRows) {
  const rows = [];
  const plannedTasks = (productionShiftTasks || []).filter(task => cardLogTrim(task?.cardId) === cardLogTrim(card?.id));
  if (!plannedTasks.length) return rows;
  const existingKeys = new Set((existingRows || []).map(entry => [
    cardLogTrim(entry?.action),
    cardLogTrim(entry?.object),
    cardLogTrim(entry?.newValue),
    cardLogTrim(entry?.userName)
  ].join('|')));

  plannedTasks.forEach(task => {
    const op = (card.operations || []).find(item => cardLogTrim(item?.id) === cardLogTrim(task?.routeOpId)) || null;
    const object = op?.opName || op?.name || op?.opCode || 'Операция';
    const newValue = getCardLogPlanningText(task, op);
    const key = ['Добавление в план', `Операция «${object}»`, newValue, cardLogTrim(task?.createdBy) || '—'].join('|');
    if (existingKeys.has(key)) return;
    rows.push({
      ts: Number(task?.createdAt) || Date.now(),
      action: 'Добавление в план',
      object: `Операция «${object}»`,
      oldValue: '—',
      newValue,
      userName: cardLogTrim(task?.createdBy) || '—'
    });
  });

  return rows;
}

function buildLogHistoryTable(card) {
  const baseRows = (card.logs || []).map(entry => normalizeCardHistoryEntry(card, entry));
  const allRows = baseRows
    .concat(collectCardFlowHistoryRows(card))
    .concat(collectCardPlanningFallbackRows(card, baseRows))
    .filter(entry => entry && entry.ts);

  const deduped = [];
  const seen = new Set();
  allRows
    .sort((a, b) => (a.ts || 0) - (b.ts || 0))
    .forEach(entry => {
      const key = [
        entry.ts || 0,
        cardLogTrim(entry.action),
        cardLogTrim(entry.object),
        cardLogTrim(entry.oldValue),
        cardLogTrim(entry.newValue),
        cardLogTrim(entry.userName)
      ].join('|');
      if (seen.has(key)) return;
      seen.add(key);
      deduped.push(entry);
    });

  if (!deduped.length) return '<p>История изменений пока отсутствует.</p>';
  let html = '<table><thead><tr><th>Дата/время</th><th>Тип действия</th><th>Объект</th><th>Старое значение</th><th>Новое значение</th><th>Пользователь</th></tr></thead><tbody>';
  deduped.forEach(entry => {
    const date = new Date(entry.ts || Date.now()).toLocaleString('ru-RU');
    html += '<tr>' +
      '<td>' + escapeHtml(date) + '</td>' +
      '<td>' + escapeHtml(entry.action || '') + '</td>' +
      '<td>' + escapeHtml(entry.object || '') + '</td>' +
      '<td>' + escapeHtml(entry.oldValue || '—') + '</td>' +
      '<td>' + escapeHtml(entry.newValue || '—') + '</td>' +
      '<td>' + escapeHtml(entry.userName || '—') + '</td>' +
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

function getOperationDisplayExecutors(card, op) {
  const names = [];
  const seen = new Set();

  function pushName(value, fallbackId = '') {
    const clean = sanitizeExecutorName((value || '').toString().trim());
    const finalValue = clean || (fallbackId || '').toString().trim();
    if (!finalValue || seen.has(finalValue)) return;
    seen.add(finalValue);
    names.push(finalValue);
  }

  const taskMatches = (productionShiftTasks || []).filter(task =>
    task &&
    String(task.cardId || '') === String(card?.id || '') &&
    String(task.routeOpId || '') === String(op?.id || '')
  );

  taskMatches.forEach(task => {
    const assignments = (productionSchedule || []).filter(rec =>
      rec &&
      String(rec.date || '') === String(task.date || '') &&
      String(rec.areaId || '') === String(task.areaId || '') &&
      Number(rec.shift || 0) === Number(task.shift || 0)
    );

    assignments.forEach(rec => {
      const user = (users || []).find(item => String(item.id || '') === String(rec.employeeId || ''));
      pushName(user?.name || user?.username || user?.login || '', rec.employeeId || '');
    });
  });

  if (names.length) return names;

  pushName(op?.executor || '');
  if (Array.isArray(op?.additionalExecutors)) {
    op.additionalExecutors.forEach(name => pushName(name || ''));
  }

  return names;
}

function buildExecutorListCell(card, op) {
  const names = getOperationDisplayExecutors(card, op);
  if (!names.length) return '';
  return names.map(name => '<div class="executor-history-line">' + escapeHtml(name) + '</div>').join('');
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

function buildOpCommentsButtonHtml(card, op) {
  const commentCount = typeof ensureOpCommentsArray === 'function'
    ? ensureOpCommentsArray(op).length
    : (Array.isArray(op?.comments) ? op.comments.length : 0);
  return '<button type="button" class="op-comments-btn" data-action="op-comments" data-card-id="' + card.id + '" data-op-id="' + op.id + '" data-allow-view="true">' +
    '<span>💬</span>' +
    '<span class="op-comments-count">' + commentCount + '</span>' +
  '</button>';
}

function buildSummaryPersonalStartEndCell(personalOp) {
  const segments = typeof getPersonalOperationDisplaySegmentsUi === 'function'
    ? getPersonalOperationDisplaySegmentsUi(personalOp)
    : [];
  if (!segments.length) {
    const start = personalOp?.firstStartedAt || personalOp?.startedAt || null;
    const end = personalOp?.finishedAt || null;
    return '<div class="nk-lines"><div>Н: ' + escapeHtml(start ? formatDateTime(start) : '—') + '</div><div>К: ' + escapeHtml(end ? formatDateTime(end) : '—') + '</div></div>';
  }
  const lines = segments.map(segment => {
    const start = segment?.firstStartedAt || segment?.startedAt || null;
    const end = segment?.finishedAt || null;
    return '<div class="nk-lines"><div>Н: ' + escapeHtml(start ? formatDateTime(start) : '—') + '</div><div>К: ' + escapeHtml(end ? formatDateTime(end) : '—') + '</div></div>';
  });
  return '<div class="personal-op-cell personal-op-cell-time">' + lines.join('') + '</div>';
}

function getSummaryShiftList() {
  const list = Array.isArray(productionShiftTimes) && productionShiftTimes.length
    ? productionShiftTimes.slice()
    : [{ shift: 1 }, { shift: 2 }, { shift: 3 }];
  return list
    .map(item => parseInt(item?.shift, 10) || 0)
    .filter(value => value > 0)
    .sort((a, b) => a - b);
}

function formatSummaryShiftMeta(dateStr, shift) {
  const dateLabel = typeof getProductionDayLabel === 'function'
    ? (getProductionDayLabel(dateStr || '').date || (dateStr || ''))
    : (dateStr || '');
  return `${dateLabel} · ${parseInt(shift, 10) || 1} смена`;
}

function getSummaryShiftWindow(dateStr, shift) {
  if (!dateStr) return null;
  const base = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(base.getTime())) return null;
  const range = typeof getShiftRange === 'function'
    ? getShiftRange(parseInt(shift, 10) || 1)
    : { start: ((parseInt(shift, 10) || 1) - 1) * 8 * 60, end: (parseInt(shift, 10) || 1) * 8 * 60 };
  const start = base.getTime() + ((Number(range?.start) || 0) * 60 * 1000);
  const end = base.getTime() + ((Number(range?.end) || 0) * 60 * 1000);
  return {
    start,
    end: end > start ? end : (end + 24 * 60 * 60 * 1000)
  };
}

function buildSummaryOpStatusIntervals(card, op) {
  const entries = (card.logs || [])
    .filter(entry => entry && entry.targetId === op.id && cardLogTrim(entry.field) === 'status')
    .slice()
    .sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const intervals = [];
  let activeStart = null;
  entries.forEach(entry => {
    const prev = cardLogTrim(entry.oldValue).toUpperCase();
    const next = cardLogTrim(entry.newValue).toUpperCase();
    const ts = Number(entry.ts) || 0;
    if (!ts) return;
    if (next === 'IN_PROGRESS' && prev !== 'IN_PROGRESS') {
      if (activeStart == null) activeStart = ts;
      return;
    }
    if (prev === 'IN_PROGRESS' && next !== 'IN_PROGRESS') {
      intervals.push({ start: activeStart != null ? activeStart : ts, end: ts, endStatus: next || 'PAUSED' });
      activeStart = null;
    }
  });
  if (activeStart != null) {
    intervals.push({ start: activeStart, end: null, endStatus: 'IN_PROGRESS' });
  }
  return intervals;
}

function splitSummaryIntervalsByShift(card, op) {
  const intervals = buildSummaryOpStatusIntervals(card, op);
  const byShiftKey = new Map();
  const shiftList = getSummaryShiftList();
  const pushPart = (dateStr, shift, payload) => {
    const key = `${dateStr}|${shift}`;
    if (!byShiftKey.has(key)) {
      byShiftKey.set(key, {
        key,
        date: dateStr,
        shift,
        firstStart: null,
        lastEnd: null,
        elapsedSeconds: 0,
        hasDone: false,
        hasPause: false,
        hasActive: false
      });
    }
    const target = byShiftKey.get(key);
    if (payload.start != null) {
      target.firstStart = target.firstStart == null ? payload.start : Math.min(target.firstStart, payload.start);
    }
    if (payload.end != null) {
      target.lastEnd = target.lastEnd == null ? payload.end : Math.max(target.lastEnd, payload.end);
    }
    if (payload.elapsedSeconds) target.elapsedSeconds += payload.elapsedSeconds;
    if (payload.hasDone) target.hasDone = true;
    if (payload.hasPause) target.hasPause = true;
    if (payload.hasActive) target.hasActive = true;
  };

  intervals.forEach(interval => {
    const startTs = Number(interval.start) || 0;
    const endTs = interval.end == null ? Date.now() : Number(interval.end);
    if (!startTs || !endTs || endTs < startTs) return;
    const startDate = new Date(startTs);
    const endDate = new Date(endTs);
    for (
      let cursor = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
      cursor <= new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
      cursor.setDate(cursor.getDate() + 1)
    ) {
      const dateStr = typeof formatProductionDate === 'function'
        ? formatProductionDate(cursor)
        : `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
      shiftList.forEach(shift => {
        const window = getSummaryShiftWindow(dateStr, shift);
        if (!window) return;
        const overlapStart = Math.max(startTs, window.start);
        const overlapEnd = Math.min(endTs, window.end);
        if (overlapEnd <= overlapStart) return;
        pushPart(dateStr, shift, {
          start: overlapStart,
          end: overlapEnd,
          elapsedSeconds: Math.max(0, Math.round((overlapEnd - overlapStart) / 1000)),
          hasDone: interval.endStatus === 'DONE' && interval.end != null && interval.end >= window.start && interval.end <= window.end,
          hasPause: interval.endStatus === 'PAUSED' && interval.end != null && interval.end >= window.start && interval.end <= window.end,
          hasActive: interval.end == null
        });
      });
    }
  });

  return byShiftKey;
}

function collectSummaryFlowShiftFacts(card, op) {
  const result = new Map();
  if (typeof ensureCardFlowForUi === 'function') ensureCardFlowForUi(card);
  const flow = card?.flow || {};
  const list = op?.isSamples
    ? (typeof getFlowSamplesForOperation === 'function' ? getFlowSamplesForOperation(flow, op) : [])
    : (Array.isArray(flow.items) ? flow.items : []);

  list.forEach(item => {
    const history = Array.isArray(item?.history) ? item.history : [];
    history.forEach(entry => {
      if (!entry || cardLogTrim(entry.opId) !== cardLogTrim(op.id)) return;
      const dateStr = cardLogTrim(entry.shiftDate);
      const shift = parseInt(entry.shift, 10) || 0;
      if (!dateStr || !shift) return;
      const key = `${dateStr}|${shift}`;
      if (!result.has(key)) {
        result.set(key, {
          key,
          date: dateStr,
          shift,
          firstAt: null,
          lastAt: null,
          users: new Set(),
          areaId: cardLogTrim(entry.areaId),
          counts: { PENDING: 0, GOOD: 0, DEFECT: 0, DELAYED: 0, DISPOSED: 0 }
        });
      }
      const bucket = result.get(key);
      const at = Number(entry.at) || 0;
      if (at > 0) {
        bucket.firstAt = bucket.firstAt == null ? at : Math.min(bucket.firstAt, at);
        bucket.lastAt = bucket.lastAt == null ? at : Math.max(bucket.lastAt, at);
      }
      const userName = cardLogTrim(entry.userName || entry.createdBy);
      if (userName) bucket.users.add(userName);
      const status = cardLogTrim(entry.status).toUpperCase();
      if (bucket.counts[status] != null) bucket.counts[status] += 1;
    });
  });

  return result;
}

function getSummarySegmentExecutors(card, op, taskGroup, flowFact) {
  const names = [];
  const seen = new Set();
  const pushName = (value) => {
    const clean = sanitizeExecutorName(cardLogTrim(value));
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    names.push(clean);
  };
  const groupTasks = Array.isArray(taskGroup?.tasks) ? taskGroup.tasks : [];
  groupTasks.forEach(task => {
    (productionSchedule || [])
      .filter(rec =>
        rec &&
        String(rec.date || '') === String(task.date || '') &&
        String(rec.areaId || '') === String(task.areaId || '') &&
        Number(rec.shift || 0) === Number(task.shift || 0)
      )
      .forEach(rec => {
        const user = (users || []).find(item => String(item.id || '') === String(rec.employeeId || ''));
        pushName(user?.name || user?.username || user?.login || '');
      });
  });
  if (!names.length && flowFact?.users instanceof Set) {
    flowFact.users.forEach(name => pushName(name));
  }
  if (!names.length) {
    pushName(op?.executor || '');
    if (Array.isArray(op?.additionalExecutors)) op.additionalExecutors.forEach(name => pushName(name));
  }
  return names;
}

function groupSummaryPlannedTasks(card, op) {
  const tasks = (productionShiftTasks || [])
    .filter(task => task && String(task.cardId || '') === String(card.id || '') && String(task.routeOpId || '') === String(op.id || ''))
    .slice()
    .sort((a, b) => {
      const dateCmp = String(a.date || '').localeCompare(String(b.date || ''));
      if (dateCmp !== 0) return dateCmp;
      const shiftCmp = (parseInt(a.shift, 10) || 1) - (parseInt(b.shift, 10) || 1);
      if (shiftCmp !== 0) return shiftCmp;
      return String(a.areaId || '').localeCompare(String(b.areaId || ''));
    });
  const grouped = new Map();
  tasks.forEach(task => {
    const key = `${task.date || ''}|${parseInt(task.shift, 10) || 1}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        date: String(task.date || ''),
        shift: parseInt(task.shift, 10) || 1,
        areaIds: new Set(),
        tasks: [],
        plannedMinutes: 0
      });
    }
    const bucket = grouped.get(key);
    bucket.tasks.push(task);
    if (task.areaId) bucket.areaIds.add(String(task.areaId || ''));
    bucket.plannedMinutes += typeof getTaskPlannedMinutes === 'function' ? getTaskPlannedMinutes(task) : (Number(task?.plannedPartMinutes) || 0);
  });
  return grouped;
}

function buildSummaryShiftSegments(card, op) {
  const taskGroups = groupSummaryPlannedTasks(card, op);
  const intervalFacts = splitSummaryIntervalsByShift(card, op);
  const flowFacts = collectSummaryFlowShiftFacts(card, op);
  const segmentKeys = new Set([...taskGroups.keys(), ...intervalFacts.keys(), ...flowFacts.keys()]);
  const segments = Array.from(segmentKeys).map(key => {
    const taskGroup = taskGroups.get(key) || null;
    const intervalFact = intervalFacts.get(key) || null;
    const flowFact = flowFacts.get(key) || null;
    const date = taskGroup?.date || intervalFact?.date || flowFact?.date || '';
    const shift = taskGroup?.shift || intervalFact?.shift || flowFact?.shift || 1;
    const executors = getSummarySegmentExecutors(card, op, taskGroup, flowFact);
    const plannedMinutes = taskGroup ? Math.max(0, Math.round(taskGroup.plannedMinutes || 0)) : null;
    const hasActualTime = Boolean(intervalFact && intervalFact.elapsedSeconds > 0);
    const startAt = intervalFact?.firstStart ?? flowFact?.firstAt ?? null;
    const endAt = intervalFact?.lastEnd ?? flowFact?.lastAt ?? null;
    let statusKey = 'NOT_STARTED';
    if (intervalFact?.hasActive) statusKey = 'IN_PROGRESS';
    else if (intervalFact?.hasDone) statusKey = 'DONE';
    else if (intervalFact?.hasPause) statusKey = 'PAUSED';
    else if (flowFact) {
      const terminalCount = (flowFact.counts.GOOD || 0) + (flowFact.counts.DEFECT || 0) + (flowFact.counts.DELAYED || 0) + (flowFact.counts.DISPOSED || 0);
      if (terminalCount > 0) statusKey = 'DONE';
      else if ((flowFact.counts.PENDING || 0) > 0) statusKey = 'IN_PROGRESS';
    } else if (!taskGroup && op.status) {
      statusKey = cardLogTrim(op.status).toUpperCase() || 'NOT_STARTED';
    }
    return {
      key,
      date,
      shift,
      meta: formatSummaryShiftMeta(date, shift),
      executors,
      plannedMinutes,
      statusKey,
      startAt,
      endAt,
      elapsedSeconds: hasActualTime ? Math.max(0, Math.round(intervalFact.elapsedSeconds || 0)) : null,
      areaId: taskGroup?.areaIds?.values ? (Array.from(taskGroup.areaIds)[0] || '') : (flowFact?.areaId || ''),
      hasCommentsButton: true
    };
  }).sort((a, b) => {
    const dateCmp = String(a.date || '').localeCompare(String(b.date || ''));
    if (dateCmp !== 0) return dateCmp;
    return (a.shift || 1) - (b.shift || 1);
  });
  return segments;
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
    const elapsed = getOperationElapsedSeconds(op, card);
    const shiftSegments = buildSummaryShiftSegments(card, op);
    const useShiftSegments = shiftSegments.length > 1;
    let timeCell = '';
    if (op.status === 'IN_PROGRESS' || op.status === 'PAUSED') {
      timeCell = '<span class="wo-timer" data-row-id="' + rowId + '">' + formatSecondsToHMS(elapsed) + '</span>';
    } else if (op.status === 'DONE') {
      const seconds = isDryingOperation(op)
        ? elapsed
        : (typeof op.elapsedSeconds === 'number' && op.elapsedSeconds
          ? op.elapsedSeconds
          : (op.actualSeconds || 0));
      timeCell = seconds > 0 ? formatSecondsToHMS(seconds) : '—';
    } else {
      const seconds = isDryingOperation(op)
        ? elapsed
        : (typeof op.elapsedSeconds === 'number' && op.elapsedSeconds
          ? op.elapsedSeconds
          : (op.actualSeconds || 0));
      timeCell = seconds > 0 ? formatSecondsToHMS(seconds) : '—';
    }

    const executorCell = buildExecutorListCell(card, op);
    const startEndCell = formatStartEnd(op);
    const commentCell = buildOpCommentsButtonHtml(card, op);
    if (useShiftSegments) {
      shiftSegments.forEach((segment, segmentIndex) => {
        const segmentExecutors = segment.executors.length
          ? segment.executors.map(name => '<div class="executor-history-line">' + escapeHtml(name) + '</div>').join('')
          : '—';
        const segmentPlan = Number.isFinite(segment.plannedMinutes) && segment.plannedMinutes > 0
          ? escapeHtml(String(segment.plannedMinutes))
          : '—';
        const segmentStatus = typeof statusBadge === 'function'
          ? statusBadge(segment.statusKey || 'NOT_STARTED')
          : escapeHtml(getCardLogOperationStatusLabel(segment.statusKey || 'NOT_STARTED'));
        const segmentStart = segment.startAt ? formatDateTime(segment.startAt) : '—';
        const segmentEnd = segment.endAt ? formatDateTime(segment.endAt) : '—';
        const segmentStartEnd = '<div class="nk-lines"><div>Н: ' + escapeHtml(segmentStart) + '</div><div>К: ' + escapeHtml(segmentEnd) + '</div></div>';
        const segmentTime = segment.elapsedSeconds && segment.elapsedSeconds > 0
          ? escapeHtml(formatSecondsToHMS(segment.elapsedSeconds))
          : '—';
        const segmentComment = segmentIndex === 0
          ? '<div class="table-actions">' + commentCell + '</div>'
          : '—';

        html += '<tr data-row-id="' + rowId + '"' + (segmentIndex > 0 ? ' class="log-op-shift-row"' : '') + '>';
        if (segmentIndex === 0) {
          html += '<td rowspan="' + shiftSegments.length + '">' + (idx + 1) + '</td>' +
            '<td rowspan="' + shiftSegments.length + '">' + escapeHtml(op.centerName) + '</td>' +
            '<td rowspan="' + shiftSegments.length + '">' + escapeHtml(op.opCode || '') + '</td>' +
            '<td rowspan="' + shiftSegments.length + '">' + renderOpName(op, { card }) + '</td>';
        }
        html += '<td>' + segmentExecutors + '</td>' +
          '<td><div class="log-op-shift-meta">' + escapeHtml(segment.meta || '') + '</div>' + segmentPlan + '</td>' +
          '<td>' + segmentStatus + '</td>' +
          '<td>' + segmentStartEnd + '</td>' +
          '<td>' + segmentTime + '</td>' +
          '<td>' + segmentComment + '</td>' +
          '</tr>';
      });
    } else {
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
        '<td><div class="table-actions">' + commentCell + '</div></td>' +
        '</tr>';
    }

    html += renderQuantityRow(card, op, { readonly: true, colspan: 10 });

    const personalOperations = (typeof getCardPersonalOperationsUi === 'function' && typeof isIndividualOperationUi === 'function' && isIndividualOperationUi(card, op))
      ? getCardPersonalOperationsUi(card, op.id)
      : [];
    personalOperations.forEach((personalOp, personalIndex) => {
      const personalRowId = rowId + '::' + personalOp.id;
      const personalOrderLabel = String(idx + 1) + '.' + String(personalIndex + 1);
      const personalExecutor = typeof renderPersonalOperationHistoryCellUi === 'function'
        ? renderPersonalOperationHistoryCellUi(personalOp, 'executor')
        : escapeHtml(String(personalOp?.currentExecutorUserName || '—').trim() || '—');
      const personalStatus = typeof renderPersonalOperationHistoryCellUi === 'function'
        ? renderPersonalOperationHistoryCellUi(personalOp, 'status')
        : statusBadge(normalizePersonalOperationStatusUi(personalOp?.status));
      const personalTime = typeof renderPersonalOperationHistoryCellUi === 'function'
        ? renderPersonalOperationHistoryCellUi(personalOp, 'time', { timerRowId: personalRowId })
        : escapeHtml(formatSecondsToHMS(getPersonalOperationElapsedSecondsUi(personalOp)));
      const personalStartEnd = buildSummaryPersonalStartEndCell(personalOp);
      const personalCommentCell = '<div class="table-actions">' + commentCell + '</div>';

      html += '<tr class="individual-op-personal-row" data-row-id="' + personalRowId + '">' +
        '<td>' + escapeHtml(personalOrderLabel) + '</td>' +
        '<td>' + escapeHtml(op.centerName) + '</td>' +
        '<td>' + escapeHtml(op.opCode || '') + '</td>' +
        '<td><div>' + renderOpName(op, { card }) + '</div><div class="personal-op-label">Личная операция</div></td>' +
        '<td>' + personalExecutor + '</td>' +
        '<td>' + (op.plannedMinutes || '') + '</td>' +
        '<td>' + personalStatus + '</td>' +
        '<td>' + personalStartEnd + '</td>' +
        '<td>' + personalTime + '</td>' +
        '<td>' + personalCommentCell + '</td>' +
        '</tr>';
    });
  });

  html += '</tbody></table>';
  return html;
}

function buildInitialSummaryTable(card) {
  const opsSorted = [...(card.operations || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  if (!opsSorted.length) return '<p>Маршрут пока пуст.</p>';
  let html = '<table><thead><tr>' +
    '<th>Порядок</th><th>Подразделение</th><th>Код операции</th><th>Наименование операции</th><th>План (мин)</th>' +
    '</tr></thead><tbody>';

  opsSorted.forEach((op, idx) => {
    html += '<tr>' +
      '<td>' + (idx + 1) + '</td>' +
      '<td>' + escapeHtml(op.centerName) + '</td>' +
      '<td>' + escapeHtml(op.opCode || '') + '</td>' +
      '<td>' + renderOpName(op, { card }) + '</td>' +
      '<td>' + (op.plannedMinutes || '') + '</td>' +
      '</tr>';

    html += renderQuantityRow(card, op, { readonly: true, colspan: 5, blankForPrint: true });
  });

  html += '</tbody></table>';
  return html;
}

function buildInitialSnapshotHtml(card) {
  if (!card) return '';
  const snapshot = card.initialSnapshot || card;
  const opsHtml = buildInitialSummaryTable(snapshot);
  const wrappedOps = opsHtml.trim().startsWith('<table') ? wrapTable(opsHtml) : opsHtml;
  return wrappedOps;
}

function renderInitialSnapshot(card) {
  const container = document.getElementById('page-log-initial-view');
  if (!container || !card) return;
  container.innerHTML = buildInitialSnapshotHtml(card);
}

function findCardForLogRoute(cardKey) {
  const key = (cardKey || '').toString().trim();
  if (!key) return null;
  if (typeof findCardEntityByKey === 'function') {
    return findCardEntityByKey(key);
  }
  const normalizedKey = normalizeQrId(key);
  let card = normalizedKey
    ? cards.find(c => normalizeQrId(c?.qrId || c?.barcode || '') === normalizedKey)
    : null;
  if (!card) {
    card = cards.find(c => String(c?.id || '') === key);
  }
  return card || null;
}

function getCardLogPath(cardOrId) {
  const card = (cardOrId && typeof cardOrId === 'object')
    ? cardOrId
    : findCardForLogRoute(cardOrId);
  if (!card) return '';
  const qr = normalizeQrId(card.qrId || card.barcode || '');
  const routeKey = isValidScanId(qr) ? qr : String(card.id || '').trim();
  if (!routeKey) return '';
  return `/card-route/${encodeURIComponent(routeKey)}/log`;
}

function openCardLogPage(cardOrId, { replace = false } = {}) {
  const path = getCardLogPath(cardOrId);
  if (!path) return;
  if (typeof navigateToPath === 'function') {
    navigateToPath(path, { replace });
    return;
  }
  if (typeof handleRoute === 'function') {
    handleRoute(path, { replace, fromHistory: false });
    return;
  }
  history[replace ? 'replaceState' : 'pushState']({}, '', path);
}

function getCardRoutePath(cardOrId) {
  const card = (cardOrId && typeof cardOrId === 'object')
    ? cardOrId
    : findCardForLogRoute(cardOrId);
  if (!card) return '';
  const qr = normalizeQrId(card.qrId || card.barcode || '');
  const routeKey = isValidScanId(qr) ? qr : String(card.id || '').trim();
  return routeKey ? `/card-route/${encodeURIComponent(routeKey)}` : '';
}

function navigateBackToCardRoute(card) {
  const target = card ? getCardRoutePath(card) : '';
  if (window.history.length > 1) {
    history.back();
    return;
  }
  if (!target) return;
  if (typeof navigateToPath === 'function') {
    navigateToPath(target, { replace: true });
    return;
  }
  if (typeof handleRoute === 'function') {
    handleRoute(target, { replace: true, fromHistory: false });
  }
}

function renderCardLogPage(card, mountEl) {
  const page = mountEl || document.getElementById('page-card-log');
  if (!page || !card) return;
  logContextCardId = card.id;
  const authorName = trimToString(
    card.createdBy
    || card.initialSnapshot?.createdBy
    || card.issuedBySurname
    || card.initialSnapshot?.issuedBySurname
    || ''
  ) || '—';

  const barcodeContainer = page.querySelector('#page-log-barcode-svg');
  const barcodeValue = getCardBarcodeValue(card);
  renderBarcodeInto(barcodeContainer, barcodeValue);
  const barcodeNum = page.querySelector('#page-log-barcode-number');
  if (barcodeNum) {
    barcodeNum.textContent = barcodeValue || '(нет номера МК)';
    barcodeNum.classList.toggle('hidden', Boolean(barcodeContainer && barcodeValue));
  }
  const nameEl = page.querySelector('#page-log-card-name');
  if (nameEl) nameEl.textContent = formatCardTitle(card);
  const orderEl = page.querySelector('#page-log-card-order');
  if (orderEl) orderEl.textContent = card.orderNo || '';
  const statusEl = page.querySelector('#page-log-card-status');
  if (statusEl) statusEl.textContent = cardStatusText(card);
  const createdEl = page.querySelector('#page-log-card-created');
  if (createdEl) createdEl.textContent = new Date(card.createdAt || Date.now()).toLocaleString();
  const authorEl = page.querySelector('#page-log-card-author');
  if (authorEl) authorEl.textContent = authorName;

  const cardInfoContainer = page.querySelector('#page-log-card-info');
  if (cardInfoContainer) {
    cardInfoContainer.innerHTML = typeof buildCardInfoBlock === 'function'
      ? buildCardInfoBlock(card, { collapsible: false, showHeader: false })
      : '';
  }
  const initialContainer = page.querySelector('#page-log-initial-view');
  if (initialContainer) {
    initialContainer.innerHTML = buildInitialSnapshotHtml(card);
  }
  const itemsSummaryEl = page.querySelector('#page-log-items-summary');
  if (itemsSummaryEl) {
    itemsSummaryEl.innerHTML = typeof buildItemsSummaryHtml === 'function'
      ? buildItemsSummaryHtml(card, { interactive: true })
      : '';
  }
  const itemsTableEl = page.querySelector('#page-log-items-table-wrapper');
  if (itemsTableEl) {
    const itemsRows = typeof buildItemsLogRows === 'function' ? buildItemsLogRows(card) : [];
    itemsTableEl.innerHTML = typeof buildItemsLogTableHtml === 'function'
      ? buildItemsLogTableHtml(itemsRows, { sortKey: 'date', sortDir: 'desc' })
      : '<p>Нет данных.</p>';
  }
  const historyContainer = page.querySelector('#page-log-history-table');
  if (historyContainer) historyContainer.innerHTML = buildLogHistoryTable(card);
  const summaryContainer = page.querySelector('#page-log-summary-table');
  if (summaryContainer) summaryContainer.innerHTML = buildSummaryTable(card);

  page.querySelectorAll('.op-comments-btn[data-card-id][data-op-id]').forEach(btn => {
    btn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof openOpCommentsModal !== 'function') return;
      openOpCommentsModal(btn.getAttribute('data-card-id'), btn.getAttribute('data-op-id'));
    };
  });

  bindCardInfoToggles(page, { defaultCollapsed: true });

  page.querySelectorAll('#page-log-back, #page-log-back-bottom').forEach(btn => {
    btn.onclick = () => navigateBackToCardRoute(card);
  });
  const printSummaryBtn = page.querySelector('#page-log-print-summary');
  if (printSummaryBtn) {
    printSummaryBtn.onclick = async () => {
      const url = '/print/log/summary/' + encodeURIComponent(card.id);
      await openPrintPreview(url);
    };
  }
  const printAllBtn = page.querySelector('#page-log-print-all');
  if (printAllBtn) {
    printAllBtn.onclick = async () => {
      const url = '/print/log/full/' + encodeURIComponent(card.id);
      await openPrintPreview(url);
    };
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

window.addEventListener('focus', () => {
  if (typeof currentPage !== 'undefined' && currentPage === 'cards') {
    refreshCardsFilesCounters();
  }
});
