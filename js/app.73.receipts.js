// === МАРШРУТНЫЕ КВИТАНЦИИ ===
function getAllRouteRows() {
  const rows = [];
  cards.forEach(card => {
    if (!card || card.archived || card.cardType !== 'MKI') return;
    (card.operations || []).forEach(op => {
      rows.push({ card, op });
    });
  });
  return rows;
}

function cardHasCenterMatch(card, term) {
  if (!card || !term) return false;
  const t = term.toLowerCase();
  return (card.operations || []).some(op => (op.centerName || '').toLowerCase().includes(t));
}

function cardSearchScore(card, term) {
  if (!term) return 0;
  const normalize = typeof normalizeScanIdInput === 'function'
    ? normalizeScanIdInput
    : (raw) => (raw || '').toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const validate = typeof isValidScanId === 'function'
    ? isValidScanId
    : (value) => /^[A-Z0-9]{6,32}$/.test(value || '');

  const normalizedTerm = normalize(term);
  const cardQrId = normalizeQrId(card && card.qrId ? card.qrId : '');
  if (validate(normalizedTerm) && cardQrId && cardQrId === normalizedTerm) {
    return 1000;
  }

  const t = term.toLowerCase();
  const compactTerm = term.replace(/\s+/g, '').toLowerCase();
  const normalizedLower = normalizedTerm.toLowerCase();
  let score = 0;
  const barcodeValue = getCardBarcodeValue(card).toLowerCase();
  if (barcodeValue) {
    if (normalizedLower && barcodeValue === normalizedLower) score += 220;
    else if (barcodeValue === compactTerm) score += 200;
    else if (barcodeValue.indexOf(normalizedLower) !== -1 || barcodeValue.indexOf(compactTerm) !== -1) score += 100;
  }
  const legacyBarcode = (card && card.barcode ? String(card.barcode) : '').toLowerCase();
  if (legacyBarcode) {
    if (normalizedLower && legacyBarcode === normalizedLower) score += 140;
    else if (legacyBarcode === compactTerm) score += 120;
    else if (legacyBarcode.includes(normalizedLower) || legacyBarcode.includes(compactTerm)) score += 60;
  }
  const routeNumber = (card?.routeCardNumber || '').toLowerCase();
  if (routeNumber) {
    if (normalizedLower && routeNumber === normalizedLower) score += 170;
    else if (routeNumber === compactTerm) score += 150;
    else if (routeNumber.includes(normalizedLower) || routeNumber.includes(t)) score += 80;
  }
  const displayTitle = (formatCardTitle(card) || '').toLowerCase();
  if (displayTitle && displayTitle.includes(t)) score += 50;
  if (card.orderNo && card.orderNo.toLowerCase().includes(t)) score += 50;
  if (card.contractNumber && card.contractNumber.toLowerCase().includes(t)) score += 50;
  if (cardHasCenterMatch(card, t)) score += 40;
  return score;
}

function shouldIgnoreCardOpenClick(e) {
  return !!e.target.closest('button, a, input, textarea, select, label');
}

function getWorkordersCardUrlByCard(card) {
  const qr = normalizeQrId(card?.qrId || '');
  return qr ? `/workorders/${qr}` : '/workorders';
}

function getArchiveCardUrlByCard(card) {
  const qr = normalizeQrId(card?.qrId || '');
  return qr ? `/archive/${qr}` : '/archive';
}

function buildWorkorderCardDetails(card, { opened = false, allowArchive = true, showLog = true, readonly = false, highlightCenterTerm = '' } = {}) {
  const stateBadge = renderCardStateBadge(card);
  const missingBadge = cardHasMissingExecutors(card)
    ? '<span class="status-pill status-pill-missing-executor" title="Есть операции без исполнителя">Нет исполнителя</span>'
    : '';
  const canArchive = allowArchive && getCardProcessState(card).key === 'DONE' && !readonly;
  const filesCount = (card.attachments || []).length;
  const contractText = card.contractNumber ? ' (Договор: ' + escapeHtml(card.contractNumber) + ')' : '';
  const barcodeButton = ' <button type="button" class="btn-small btn-secondary barcode-view-btn" data-allow-view="true" data-card-id="' + card.id + '" title="Показать QR-код" aria-label="Показать QR-код">QR-код</button>';
  const filesButton = ' <button type="button" class="btn-small clip-btn inline-clip" data-card-id="' + card.id + '" data-attach-card="' + card.id + '">📎 <span class="clip-count">' + filesCount + '</span></button>';
  const logButton = showLog ? ' <button type="button" class="btn-small btn-secondary log-btn" data-allow-view="true" data-log-card="' + card.id + '">Log</button>' : '';
  const inlineActions = '<span class="summary-inline-actions">' + barcodeButton + filesButton + logButton + '</span>';
  const nameLabel = escapeHtml(formatCardTitle(card) || card.name || card.id || '');

  let html = '<details class="wo-card" data-card-id="' + card.id + '"' + (opened ? ' open' : '') + '>' +
    '<summary>' +
    '<div class="summary-line">' +
    '<div class="summary-text">' +
    '<strong>' + nameLabel + '</strong>' +
    ' <span class="summary-sub">' +
    (card.orderNo ? ' (Заказ: ' + escapeHtml(card.orderNo) + ')' : '') + contractText +
    inlineActions +
    '</span>' +
    '</div>' +
    '<div class="summary-actions">' +
    (missingBadge ? missingBadge + ' ' : '') + stateBadge +
    (canArchive ? ' <button type="button" class="btn-small btn-secondary archive-move-btn" data-card-id="' + card.id + '">Перенести в архив</button>' : '') +
    '</div>' +
    '</div>' +
    '</summary>';

  html += buildCardInfoBlock(card);
  html += buildOperationsTable(card, { readonly, showQuantityColumn: false, allowActions: !readonly, centerHighlightTerm: highlightCenterTerm });
  html += '</details>';
  return html;
}

function buildWorkspaceCardDetails(card, { opened = true, readonly = false } = {}) {
  const stateBadge = renderCardStateBadge(card);
  const filesCount = (card.attachments || []).length;
  const contractText = card.contractNumber ? ' (Договор: ' + escapeHtml(card.contractNumber) + ')' : '';
  const barcodeButton = ' <button type="button" class="btn-small btn-secondary barcode-view-btn" data-allow-view="true" data-card-id="' + card.id + '" title="Показать QR-код" aria-label="Показать QR-код">QR-код</button>';
  const filesButton = ' <button type="button" class="btn-small clip-btn inline-clip" data-attach-card="' + card.id + '">📎 <span class="clip-count">' + filesCount + '</span></button>';
  const inlineActions = '<span class="summary-inline-actions workorder-inline-actions">' + barcodeButton + filesButton + '</span>';
  const nameLabel = escapeHtml(formatCardTitle(card) || card.name || card.id || '');

  let html = '<details class="wo-card workspace-card" data-card-id="' + card.id + '"' + (opened ? ' open' : '') + '>' +
    '<summary>' +
    '<div class="summary-line">' +
    '<div class="summary-text">' +
    '<strong>' + nameLabel + '</strong>' +
    ' <span class="summary-sub">' +
    (card.orderNo ? ' (Заказ: ' + escapeHtml(card.orderNo) + ')' : '') + contractText +
    inlineActions +
    '</span>' +
    '</div>' +
    '<div class="summary-actions">' + stateBadge + '</div>' +
    '</div>' +
    '</summary>';

  html += buildCardInfoBlock(card);
  html += buildOperationsTable(card, { readonly, showQuantityColumn: false, lockExecutors: true, lockQuantities: true, allowActions: !readonly });
  html += '</details>';
  return html;
}

function scrollWorkorderDetailsIntoViewIfNeeded(detailsEl) {
  if (!detailsEl || !workorderAutoScrollEnabled || suppressWorkorderAutoscroll) return;

  // Автоскролл существует только для удобного просмотра именно что раскрытой карточки/группы.
  requestAnimationFrame(() => {
    if (suppressWorkorderAutoscroll) return;
    const rect = detailsEl.getBoundingClientRect();
    const header = document.querySelector('header');
    const headerOffset = header ? header.getBoundingClientRect().height : 0;
    const offset = headerOffset + 16;

    const needsScrollDown = rect.bottom > window.innerHeight;
    const needsScrollUp = rect.top < offset;
    if (!needsScrollDown && !needsScrollUp) return;
    const targetTop = window.scrollY + rect.top - offset;

    window.scrollTo({
      top: targetTop,
      behavior: 'smooth',
    });
  });
}

function markWorkorderToggleState(detail) {
  detail.dataset.wasOpen = detail.open ? 'true' : 'false';
}

function shouldScrollAfterWorkorderToggle(detail) {
  const wasOpen = detail.dataset.wasOpen === 'true';
  const nowOpen = detail.open;
  detail.dataset.wasOpen = nowOpen ? 'true' : 'false';
  // Скроллим только при переходе «было закрыто → стало открыто».
  return nowOpen && !wasOpen;
}

function findWorkorderDetail({ cardId = null } = {}) {
  if (!cardId) return null;
  return document.querySelector('.wo-card[data-card-id="' + cardId + '"]');
}

function withWorkorderScrollLock(cb, { anchorCardId = null } = {}) {
  const anchorEl = anchorCardId ? findWorkorderDetail({ cardId: anchorCardId }) : null;
  const anchorTop = anchorEl ? anchorEl.getBoundingClientRect().top : null;
  const prevX = window.scrollX;
  const prevY = window.scrollY;
  cb();
  if (!suppressWorkorderAutoscroll) return;
  requestAnimationFrame(() => {
    if (anchorTop != null) {
      const freshAnchor = findWorkorderDetail({ cardId: anchorCardId });
      if (freshAnchor) {
        const newTop = freshAnchor.getBoundingClientRect().top;
        const delta = newTop - anchorTop;
        window.scrollTo({ left: prevX, top: window.scrollY + delta });
        return;
      }
    }
    window.scrollTo({ left: prevX, top: prevY });
  });
}

function renderExecutorCell(op, card, { readonly = false, mobile = false } = {}) {
  const extras = Array.isArray(op.additionalExecutors) ? op.additionalExecutors : [];
  if (readonly) {
    const extrasText = extras.filter(Boolean).length
      ? '<div class="additional-executor-list">' + extras.map(name => '<span class="executor-chip">' + escapeHtml(name) + '</span>').join('') + '</div>'
      : '';
    return '<div class="executor-cell readonly">' +
      '<div class="executor-name">' + escapeHtml(op.executor || '') + '</div>' +
      extrasText +
      '</div>';
  }
  const cardId = card ? card.id : '';
  const comboClass = mobile ? 'combo-field executor-combo executor-combobox' : 'combo-field executor-combo';
  const comboAttrs = mobile ? ' data-mobile-combo="true"' : '';

  let html = '<div class="executor-cell" data-card-id="' + cardId + '" data-op-id="' + op.id + '">';
  html += '<div class="executor-row primary">' +
    '<div class="' + comboClass + '"' + comboAttrs + '>' +
      '<input type="text" list="' + USER_DATALIST_ID + '" class="executor-main-input" data-card-id="' + cardId + '" data-op-id="' + op.id + '" value="' + escapeHtml(op.executor || '') + '" placeholder="Исполнитель" />' +
      (mobile ? '<button type="button" class="executor-arrow" aria-label="Открыть список исполнителей" tabindex="-1">▼</button>' : '') +
      '<div class="combo-suggestions executor-suggestions" role="listbox"></div>' +
    '</div>' +
    (extras.length < 3 ? '<button type="button" class="icon-btn add-executor-btn" data-card-id="' + cardId + '" data-op-id="' + op.id + '">+</button>' : '') +
    '</div>';

  extras.forEach((name, idx) => {
    const canAddMore = extras.length < 3 && idx === extras.length - 1;
    html += '<div class="executor-row extra" data-extra-index="' + idx + '">' +
      '<div class="' + comboClass + '"' + comboAttrs + '>' +
        '<input type="text" list="' + USER_DATALIST_ID + '" class="additional-executor-input" data-card-id="' + cardId + '" data-op-id="' + op.id + '" data-extra-index="' + idx + '" value="' + escapeHtml(name || '') + '" placeholder="Доп. исполнитель" />' +
        (mobile ? '<button type="button" class="executor-arrow" aria-label="Открыть список исполнителей" tabindex="-1">▼</button>' : '') +
        '<div class="combo-suggestions executor-suggestions" role="listbox"></div>' +
      '</div>' +
      (canAddMore ? '<button type="button" class="icon-btn add-executor-btn" data-card-id="' + cardId + '" data-op-id="' + op.id + '">+</button>' : '') +
      '<button type="button" class="icon-btn remove-executor-btn" data-card-id="' + cardId + '" data-op-id="' + op.id + '" data-extra-index="' + idx + '">-</button>' +
      '</div>';
  });

  html += '</div>';
  return html;
}

function buildOperationsTable(card, { readonly = false, quantityPrintBlanks = false, showQuantityColumn = true, lockExecutors = false, lockQuantities = false, allowActions = !readonly, restrictToUser = false, centerHighlightTerm = '' } = {}) {
  const opsSorted = [...(card.operations || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const hasActions = allowActions && !readonly;
  const baseColumns = hasActions ? 10 : 9;
  const totalColumns = baseColumns + (showQuantityColumn ? 1 : 0);
  let html = '<table><thead><tr>' +
    '<th>Порядок</th><th>Подразделение</th><th>Код операции</th><th>Наименование операции</th>' +
    (showQuantityColumn ? '<th>Количество изделий</th>' : '') +
    '<th>Исполнитель</th><th>План (мин)</th><th>Статус</th><th>Текущее / факт. время</th>' +
    (hasActions ? '<th>Действия</th>' : '') +
    '<th>Комментарии</th>' +
    '</tr></thead><tbody>';

  opsSorted.forEach((op, idx) => {
    op.executor = sanitizeExecutorName(op.executor || '');
    if (Array.isArray(op.additionalExecutors)) {
      op.additionalExecutors = op.additionalExecutors
        .map(name => sanitizeExecutorName(name || ''))
        .slice(0, 2);
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

    const userName = (currentUser && currentUser.name ? currentUser.name.toLowerCase() : '').trim();
    const matchesUser = userName && ((op.executor || '').toLowerCase() === userName || (op.additionalExecutors || []).map(v => (v || '').toLowerCase()).includes(userName));
    let actionsHtml = '';
    if (hasActions) {
      if (op.status === 'NOT_STARTED' || !op.status) {
        actionsHtml = '<button class="btn-primary" data-action="start" data-card-id="' + card.id + '" data-op-id="' + op.id + '">Начать</button>';
      } else if (op.status === 'IN_PROGRESS') {
        actionsHtml =
          '<button class="btn-secondary" data-action="pause" data-card-id="' + card.id + '" data-op-id="' + op.id + '">Пауза</button>' +
          '<button class="btn-secondary" data-action="stop" data-card-id="' + card.id + '" data-op-id="' + op.id + '">Завершить</button>';
      } else if (op.status === 'PAUSED') {
        actionsHtml =
          '<button class="btn-primary" data-action="resume" data-card-id="' + card.id + '" data-op-id="' + op.id + '">Продолжить</button>' +
          '<button class="btn-secondary" data-action="stop" data-card-id="' + card.id + '" data-op-id="' + op.id + '">Завершить</button>';
      } else if (op.status === 'DONE') {
        actionsHtml =
          '<button class="btn-primary" data-action="resume" data-card-id="' + card.id + '" data-op-id="' + op.id + '">Продолжить</button>';
      }
    }

    const commentCell = readonly || op.status === 'DONE'
      ? '<div class="comment-readonly">' + escapeHtml(op.comment || '') + '</div>'
      : '<textarea class="comment-input" data-card-id="' + card.id + '" data-op-id="' + op.id + '" maxlength="40" rows="1" placeholder="Комментарий">' + escapeHtml(op.comment || '') + '</textarea>';

    const actionsCell = hasActions
      ? '<td><div class="table-actions">' + actionsHtml + '</div></td>'
      : '';

    const rowClasses = [];
    if (matchesUser) rowClasses.push('executor-highlight');
    if (centerHighlightTerm && (op.centerName || '').toLowerCase().includes(centerHighlightTerm)) {
      rowClasses.push('center-highlight');
    }
    const highlightClass = rowClasses.length ? ' class="' + rowClasses.join(' ') + '"' : '';
    html += '<tr data-row-id="' + rowId + '"' + highlightClass + '>' +
      '<td>' + (idx + 1) + '</td>' +
      '<td>' + escapeHtml(op.centerName) + '</td>' +
      '<td>' + escapeHtml(op.opCode || '') + '</td>' +
      '<td>' + renderOpName(op, { card }) + '</td>' +
      (showQuantityColumn ? '<td>' + escapeHtml(getOperationQuantity(op, card)) + '</td>' : '') +
      '<td>' + renderExecutorCell(op, card, { readonly: readonly || lockExecutors }) + '</td>' +
      '<td>' + (op.plannedMinutes || '') + '</td>' +
      '<td>' + statusBadge(op.status) + '</td>' +
      '<td>' + timeCell + '</td>' +
      actionsCell +
      '<td>' + commentCell + '</td>' +
      '</tr>';

    html += renderQuantityRow(card, op, { readonly: readonly || lockQuantities, colspan: totalColumns, blankForPrint: quantityPrintBlanks });
  });

  html += '</tbody></table>';
  return '<div class="table-wrapper operations-table-wrapper">' + html + '</div>';
}

function formatQuantityValue(val) {
  if (val === '' || val == null) return '';
  return val + ' шт';
}

function resolveCardField(card, ...fields) {
  if (!card) return '';
  for (const field of fields) {
    const raw = card[field];
    if (raw === null || raw === undefined) continue;
    const value = typeof raw === 'string' ? raw.trim() : raw;
    if (value !== '') return value;
  }
  return '';
}

function formatMultilineValue(value, { multiline = false } = {}) {
  if (value === '' || value == null) return '—';
  const safe = escapeHtml(String(value));
  return multiline ? safe.replace(/\n/g, '<br>') : safe;
}

function formatCardMainSummaryFromCard(card) {
  const name = resolveCardField(card, 'itemName', 'name');
  const quantity = resolveCardField(card, 'batchSize', 'quantity');
  const routeNumber = resolveCardField(card, 'routeCardNumber', 'orderNo');
  return formatCardMainSummaryText({ name, quantity, routeNumber });
}

function renderCardDisplayField(label, value, { multiline = false, fullWidth = false } = {}) {
  const classes = ['card-display-field'];
  if (fullWidth) classes.push('card-display-field-full');
  const content = formatMultilineValue(value, { multiline });
  return '<div class="' + classes.join(' ') + '">' +
    '<div class="field-label">' + escapeHtml(label) + '</div>' +
    '<div class="field-value' + (multiline ? ' multiline' : '') + '">' + content + '</div>' +
    '</div>';
}

function buildCardInfoBlock(card, { collapsible = true, startCollapsed = false } = {}) {
  if (!card) return '';

  const routeCardNumber = resolveCardField(card, 'routeCardNumber', 'orderNo');
  const documentDesignation = resolveCardField(card, 'documentDesignation', 'drawing');
  const documentDate = formatDateInputValue(resolveCardField(card, 'documentDate'));
  const issuedBySurname = resolveCardField(card, 'issuedBySurname');
  const programName = resolveCardField(card, 'programName');
  const labRequestNumber = resolveCardField(card, 'labRequestNumber');
  const workBasis = resolveCardField(card, 'workBasis', 'contractNumber');
  const supplyState = resolveCardField(card, 'supplyState');
  const itemDesignation = resolveCardField(card, 'itemDesignation', 'drawing');
  const supplyStandard = resolveCardField(card, 'supplyStandard');
  const itemName = resolveCardField(card, 'itemName', 'name');
  const mainMaterials = resolveCardField(card, 'mainMaterials');
  const mainMaterialGrade = resolveCardField(card, 'mainMaterialGrade', 'material');
  const batchSize = resolveCardField(card, 'batchSize', 'quantity');
  const itemSerials = formatItemSerialsValue(card);
  const specialNotes = resolveCardField(card, 'specialNotes', 'desc');
  const responsibleProductionChief = resolveCardField(card, 'responsibleProductionChief');
  const responsibleSKKChief = resolveCardField(card, 'responsibleSKKChief');
  const responsibleTechLead = resolveCardField(card, 'responsibleTechLead');

  const summaryText = formatCardMainSummaryFromCard(card);
  const batchLabel = batchSize === '' || batchSize == null ? '—' : toSafeCount(batchSize);

  const blockClasses = ['card-main-collapse-block', 'card-info-collapse-block'];
  if (!collapsible) blockClasses.push('card-info-static');
  const attrs = ['class="' + blockClasses.join(' ') + '"', 'data-card-id="' + card.id + '"'];
  if (collapsible && startCollapsed) attrs.push('data-start-collapsed="true"');

  let html = '<div ' + attrs.join(' ') + '>';
  html += '<div class="card-main-header">' +
    '<h3 class="card-main-title">Основные данные</h3>' +
    '<div class="card-main-summary">' + escapeHtml(summaryText) + '</div>' +
    (collapsible ? '<button type="button" class="btn-secondary card-main-toggle card-info-toggle" aria-expanded="true">Свернуть</button>' : '') +
    '</div>';

  html += '<div class="card-main-collapse-body">';
  html += '<div class="card-info-block">';
  html += '<div class="card-meta-grid card-meta-grid-compact card-display-grid">' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Маршрутная карта №', routeCardNumber) +
    renderCardDisplayField('Обозначение документа', documentDesignation) +
    renderCardDisplayField('Дата', documentDate) +
    '</div>' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Фамилия выписавшего маршрутную карту', issuedBySurname) +
    renderCardDisplayField('Название программы', programName) +
    renderCardDisplayField('Номер заявки лаборатории', labRequestNumber) +
    '</div>' +
    '</div>';

  html += '<div class="card-meta-grid card-meta-grid-compact card-display-grid">' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Основание для выполнения работ', workBasis, { multiline: true }) +
    '</div>' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Состояние поставки', supplyState) +
    '</div>' +
    '</div>';

  html += '<div class="card-meta-grid card-meta-grid-compact card-display-grid">' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Обозначение изделия', itemDesignation) +
    '</div>' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('НТД на поставку', supplyStandard) +
    '</div>' +
    '</div>';

  html += '<div class="card-display-field card-display-field-full">' +
    '<div class="field-label">Наименование изделия</div>' +
    '<div class="field-value multiline">' + formatMultilineValue(itemName, { multiline: true }) + '</div>' +
    '</div>';

  html += '<div class="card-meta-grid card-meta-grid-compact card-display-grid">' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Основные материалы, применяемые в техпроцессе (согласно заказу на производство)', mainMaterials, { multiline: true }) +
    '</div>' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Марка основного материала', mainMaterialGrade) +
    '</div>' +
    '</div>';

  html += '<div class="card-meta-grid card-meta-grid-compact card-display-grid">' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Размер партии', batchLabel) +
    '</div>' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Индивидуальные номера изделий', itemSerials, { multiline: true }) +
    '</div>' +
    '</div>';

  html += renderCardDisplayField('Особые отметки', specialNotes, { multiline: true, fullWidth: true });

  html += '<div class="card-meta-grid card-meta-grid-compact card-display-grid card-meta-responsible">' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Начальник производства (ФИО)', responsibleProductionChief) +
    '</div>' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Начальник СКК (ФИО)', responsibleSKKChief) +
    '</div>' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('ЗГД по технологиям (ФИО)', responsibleTechLead) +
    '</div>' +
    '</div>';

  html += '</div>';
  html += '</div>';
  html += '</div>';
  return html;
}

function setCardInfoCollapsed(block, collapsed) {
  if (!block) return;
  const toggle = block.querySelector('.card-info-toggle');
  block.classList.toggle('is-collapsed', !!collapsed);
  if (toggle) {
    toggle.textContent = collapsed ? 'Развернуть' : 'Свернуть';
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }
}

function bindCardInfoToggles(root, { defaultCollapsed = true } = {}) {
  if (!root) return;
  root.querySelectorAll('.card-info-collapse-block').forEach(block => {
    const toggle = block.querySelector('.card-info-toggle');
    if (!toggle) return;
    const startCollapsed = block.hasAttribute('data-start-collapsed')
      ? block.getAttribute('data-start-collapsed') !== 'false'
      : defaultCollapsed;
    setCardInfoCollapsed(block, startCollapsed);
    toggle.addEventListener('click', () => {
      setCardInfoCollapsed(block, !block.classList.contains('is-collapsed'));
    });
  });
}

function renderQuantityRow(card, op, { readonly = false, colspan = 9, blankForPrint = false } = {}) {
  const opQty = getOperationQuantity(op, card);
  const totalLabel = opQty === '' ? '—' : opQty + ' шт';
  const base = '<span class="qty-total">Количество изделий: ' + escapeHtml(totalLabel) + '</span>';
  const lockRow = readonly || op.status === 'DONE';
  const goodVal = op.goodCount != null ? op.goodCount : 0;
  const scrapVal = op.scrapCount != null ? op.scrapCount : 0;
  const holdVal = op.holdCount != null ? op.holdCount : 0;

  if (lockRow) {
    const chipGood = blankForPrint ? '____' : escapeHtml(goodVal);
    const chipScrap = blankForPrint ? '____' : escapeHtml(scrapVal);
    const chipHold = blankForPrint ? '____' : escapeHtml(holdVal);

    return '<tr class="op-qty-row"><td colspan="' + colspan + '">' +
      '<div class="qty-row-content readonly">' +
      base +
      '<span class="qty-chip">Годные: ' + chipGood + '</span>' +
      '<span class="qty-chip">Брак: ' + chipScrap + '</span>' +
      '<span class="qty-chip">Задержано: ' + chipHold + '</span>' +
      '</div>' +
      '</td></tr>';
  }

  return '<tr class="op-qty-row" data-card-id="' + card.id + '" data-op-id="' + op.id + '"><td colspan="' + colspan + '">' +
    '<div class="qty-row-content">' +
    base +
    '<label>Годные <input type="number" class="qty-input" data-qty-type="good" data-card-id="' + card.id + '" data-op-id="' + op.id + '" min="0" value="' + goodVal + '"></label>' +
    '<label>Брак <input type="number" class="qty-input" data-qty-type="scrap" data-card-id="' + card.id + '" data-op-id="' + op.id + '" min="0" value="' + scrapVal + '"></label>' +
    '<label>Задержано <input type="number" class="qty-input" data-qty-type="hold" data-card-id="' + card.id + '" data-op-id="' + op.id + '" min="0" value="' + holdVal + '"></label>' +
    '</div>' +
    '</td></tr>';
}

function applyOperationAction(action, card, op, { useWorkorderScrollLock = true } = {}) {
  if (!card || !op) return;

  const syncQuantitiesFromInputs = () => {
    const fieldMap = { good: 'goodCount', scrap: 'scrapCount', hold: 'holdCount' };
    const selectorBase = '[data-card-id="' + card.id + '"][data-op-id="' + op.id + '"]';

    document.querySelectorAll('.qty-input' + selectorBase).forEach(input => {
      const type = input.getAttribute('data-qty-type');
      const field = fieldMap[type] || null;
      if (!field) return;
      const val = toSafeCount(input.value);
      const prev = toSafeCount(op[field] || 0);
      if (prev === val) return;
      op[field] = val;
      recordCardLog(card, { action: 'Количество деталей', object: opLogLabel(op), field, targetId: op.id, oldValue: prev, newValue: val });
    });

  };

  const execute = () => {
    const prevStatus = op.status;
    const prevElapsed = op.elapsedSeconds || 0;
    const prevCardStatus = getCardProcessState(card).key;

    syncQuantitiesFromInputs();

    if (action === 'start') {
      const now = Date.now();
      if (!op.firstStartedAt) op.firstStartedAt = now;
      op.status = 'IN_PROGRESS';
      op.startedAt = now;
      op.lastPausedAt = null;
      op.finishedAt = null;
      op.actualSeconds = null;
      op.elapsedSeconds = 0;
    } else if (action === 'pause') {
      if (op.status === 'IN_PROGRESS') {
        const now = Date.now();
        const diff = op.startedAt ? (now - op.startedAt) / 1000 : 0;
        op.elapsedSeconds = (op.elapsedSeconds || 0) + diff;
        op.lastPausedAt = now;
        op.startedAt = null;
        op.status = 'PAUSED';
      }
    } else if (action === 'resume') {
      const now = Date.now();
      if (op.status === 'DONE' && typeof op.elapsedSeconds !== 'number') {
        op.elapsedSeconds = op.actualSeconds || 0;
      }
      if (!op.firstStartedAt) op.firstStartedAt = now;
      op.status = 'IN_PROGRESS';
      op.startedAt = now;
      op.lastPausedAt = null;
      op.finishedAt = null;
    } else if (action === 'stop') {
      const now = Date.now();
      if (op.status === 'IN_PROGRESS') {
        const diff = op.startedAt ? (now - op.startedAt) / 1000 : 0;
        op.elapsedSeconds = (op.elapsedSeconds || 0) + diff;
      }
      const qtyTotal = getOperationQuantity(op, card);
      if (qtyTotal > 0) {
        const sum = toSafeCount(op.goodCount || 0) + toSafeCount(op.scrapCount || 0) + toSafeCount(op.holdCount || 0);
        if (sum !== qtyTotal) {
          alert('Количество деталей не совпадает');
          return;
        }
      }
      op.startedAt = null;
      op.finishedAt = now;
      op.lastPausedAt = null;
      op.actualSeconds = op.elapsedSeconds || 0;
      op.status = 'DONE';
    }

    recalcCardStatus(card);
    const nextCardStatus = getCardProcessState(card).key;
    if (prevStatus !== op.status) {
      recordCardLog(card, { action: 'Статус операции', object: opLogLabel(op), field: 'status', targetId: op.id, oldValue: prevStatus, newValue: op.status });
    }
    if (prevElapsed !== op.elapsedSeconds && op.status === 'DONE') {
      recordCardLog(card, { action: 'Факт. время', object: opLogLabel(op), field: 'elapsedSeconds', targetId: op.id, oldValue: Math.round(prevElapsed), newValue: Math.round(op.elapsedSeconds || 0) });
    }
    if (prevCardStatus !== nextCardStatus) {
      recordCardLog(card, { action: 'Статус карты', object: 'Карта', field: 'status', oldValue: prevCardStatus, newValue: nextCardStatus });
    }
    saveData();
    renderEverything();
  };

  suppressWorkorderAutoscroll = true;
  try {
    if (useWorkorderScrollLock) {
      withWorkorderScrollLock(execute, { anchorCardId: card.id });
    } else {
      execute();
    }
  } finally {
    suppressWorkorderAutoscroll = false;
  }
}

function isMobileOperationsLayout() {
  return window.innerWidth <= MOBILE_OPERATIONS_BREAKPOINT;
}

function closeMobileOperationsView() {
  const container = document.getElementById('mobile-operations-view');
  if (!container) return;
  activeMobileCardId = null;
  mobileOpsScrollTop = 0;
  if (mobileOpsObserver) {
    mobileOpsObserver.disconnect();
    mobileOpsObserver = null;
  }
  container.classList.add('hidden');
  container.innerHTML = '';
  document.body.classList.remove('mobile-ops-open');
  window.scrollTo({ top: mobileWorkorderScroll, left: 0 });
}

function buildMobileQtyBlock(card, op) {
  const opQty = getOperationQuantity(op, card);
  return '<div class="card-section-title">Количество изделий: ' + escapeHtml(opQty || '—') + (opQty ? ' шт' : '') + '</div>' +
    '<div class="mobile-qty-grid" data-card-id="' + card.id + '" data-op-id="' + op.id + '">' +
    '<label>Годные <input type="number" class="qty-input" data-qty-type="good" data-card-id="' + card.id + '" data-op-id="' + op.id + '" min="0" value="' + (op.goodCount || 0) + '"></label>' +
    '<label>Брак <input type="number" class="qty-input" data-qty-type="scrap" data-card-id="' + card.id + '" data-op-id="' + op.id + '" min="0" value="' + (op.scrapCount || 0) + '"></label>' +
    '<label>Задержано <input type="number" class="qty-input" data-qty-type="hold" data-card-id="' + card.id + '" data-op-id="' + op.id + '" min="0" value="' + (op.holdCount || 0) + '"></label>' +
    '</div>';
}

function buildMobileOperationCard(card, op, idx, total) {
  const rowId = card.id + '::' + op.id;
  const elapsed = getOperationElapsedSeconds(op);
  const timeText = op.status === 'IN_PROGRESS' || op.status === 'PAUSED'
    ? '<span class="wo-timer" data-row-id="' + rowId + '">' + formatSecondsToHMS(elapsed) + '</span>'
    : (op.status === 'DONE' ? formatSecondsToHMS(op.elapsedSeconds || op.actualSeconds || 0) : '—');
  let actionsHtml = '';
  if (op.status === 'NOT_STARTED' || !op.status) {
    actionsHtml = '<button class="btn-primary" data-action="start" data-card-id="' + card.id + '" data-op-id="' + op.id + '">Начать</button>';
  } else if (op.status === 'IN_PROGRESS') {
    actionsHtml = '<button class="btn-secondary" data-action="pause" data-card-id="' + card.id + '" data-op-id="' + op.id + '">Пауза</button>' +
      '<button class="btn-secondary" data-action="stop" data-card-id="' + card.id + '" data-op-id="' + op.id + '">Завершить</button>';
  } else if (op.status === 'PAUSED') {
    actionsHtml = '<button class="btn-primary" data-action="resume" data-card-id="' + card.id + '" data-op-id="' + op.id + '">Продолжить</button>' +
      '<button class="btn-secondary" data-action="stop" data-card-id="' + card.id + '" data-op-id="' + op.id + '">Завершить</button>';
  } else if (op.status === 'DONE') {
    actionsHtml = '<button class="btn-primary" data-action="resume" data-card-id="' + card.id + '" data-op-id="' + op.id + '">Продолжить</button>';
  }

  return '<article class="mobile-op-card" data-op-index="' + (idx + 1) + '">' +
    '<div class="mobile-op-top op-card-header">' +
    '<div class="op-title">' +
    '<div class="mobile-op-name">' + (idx + 1) + '. ' + renderOpName(op, { card }) + '</div>' +
    '<div class="mobile-op-meta">Подразделение: ' + escapeHtml(op.centerName) + ' • Код операции: ' + escapeHtml(op.opCode || '') + '</div>' +
    '</div>' +
    '<div class="op-status">' + statusBadge(op.status) + '</div>' +
    '</div>' +
    '<div class="mobile-executor-block">' +
    '<div class="card-section-title">Исполнитель <span class="hint" style="font-weight:400; font-size:12px;">(доп. до 3)</span></div>' +
    renderExecutorCell(op, card, { mobile: true }) +
    '</div>' +
    '<div class="mobile-plan-time">' +
    '<div><div class="card-section-title">План (мин)</div><div>' + escapeHtml(op.plannedMinutes || '') + '</div></div>' +
    '<div><div class="card-section-title">Текущее / факт. время</div><div>' + timeText + '</div></div>' +
    '</div>' +
    '<div class="mobile-qty-block">' + buildMobileQtyBlock(card, op) + '</div>' +
    '<div class="mobile-actions">' + actionsHtml + '</div>' +
    '<div class="mobile-op-comment">' +
    '<div class="card-section-title">Комментарий</div>' +
    (op.status === 'DONE'
      ? '<div class="comment-readonly">' + escapeHtml(op.comment || '') + '</div>'
      : '<textarea class="comment-input" data-card-id="' + card.id + '" data-op-id="' + op.id + '" maxlength="40" rows="2" placeholder="Комментарий">' + escapeHtml(op.comment || '') + '</textarea>') +
    '</div>' +
    '</article>';
}

function buildMobileOperationsView(card, { preserveScroll = false } = {}) {
  const container = document.getElementById('mobile-operations-view');
  if (!container || !card) return;
  const opsSorted = [...(card.operations || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const titleHtml = escapeHtml(formatCardTitle(card) || card.name || card.id || '');
  const status = cardStatusText(card);
  const headerActions = '<div class="mobile-ops-actions">' +
    '<span class="status-pill">' + escapeHtml(status) + '</span>' +
    '<button type="button" class="btn-small btn-secondary barcode-view-btn" data-allow-view="true" data-card-id="' + card.id + '">Штрихкод</button>' +
    '<button type="button" class="btn-small btn-secondary log-btn" data-allow-view="true" data-log-card="' + card.id + '">Log</button>' +
    '</div>';

  const cardsHtml = opsSorted.map((op, idx) => buildMobileOperationCard(card, op, idx, opsSorted.length)).join('');
  container.innerHTML =
    '<div class="mobile-ops-header">' +
    '<div class="mobile-ops-header-row">' +
    '<button type="button" id="mobile-ops-back" class="btn-secondary mobile-ops-back" aria-label="Назад">← Назад</button>' +
    '<div class="mobile-ops-title">' + titleHtml + '</div>' +
    '</div>' +
    headerActions +
    '</div>' +
    '<div class="mobile-ops-indicator" id="mobile-ops-indicator">Операция 1 / ' + opsSorted.length + '</div>' +
    '<div class="mobile-ops-list" id="mobile-ops-list">' + cardsHtml + '</div>';

  const listEl = container.querySelector('#mobile-ops-list');
  if (preserveScroll) {
    listEl.scrollTop = mobileOpsScrollTop;
  } else {
    listEl.scrollTop = 0;
  }

  const updateIndicator = () => {
    const indicator = container.querySelector('#mobile-ops-indicator');
    if (!indicator) return;
    const cards = Array.from(listEl.querySelectorAll('.mobile-op-card'));
    if (!cards.length) return;
    const listTop = listEl.getBoundingClientRect().top;
    let minIdx = 0;
    let minDelta = Infinity;
    cards.forEach((cardEl, idx) => {
      const delta = Math.abs(cardEl.getBoundingClientRect().top - listTop);
      if (delta < minDelta) {
        minDelta = delta;
        minIdx = idx;
      }
    });
    indicator.textContent = 'Операция ' + (minIdx + 1) + ' / ' + cards.length;
  };

  listEl.addEventListener('scroll', () => {
    mobileOpsScrollTop = listEl.scrollTop;
    updateIndicator();
  });
  updateIndicator();

  const backBtn = container.querySelector('#mobile-ops-back');
  if (backBtn) {
    backBtn.addEventListener('click', () => closeMobileOperationsView());
  }

  bindOperationControls(container, { readonly: isTabReadonly('workorders') });

  container.classList.remove('hidden');
  document.body.classList.add('mobile-ops-open');
  mobileOpsScrollTop = listEl.scrollTop;
}

function openMobileOperationsView(cardId) {
  const card = cards.find(c => c.id === cardId);
  if (!card) return;
  mobileWorkorderScroll = window.scrollY;
  activeMobileCardId = card.id;
  buildMobileOperationsView(card);
}

function bindOperationControls(root, { readonly = false } = {}) {
  if (!root) return;

  root.querySelectorAll('.barcode-view-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-card-id');
      const card = cards.find(c => c.id === id);
      if (!card) return;
      openBarcodeModal(card);
    });
  });

  root.querySelectorAll('.log-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-log-card');
      openLogModal(id);
    });
  });

  root.querySelectorAll('.comment-input').forEach(input => {
    autoResizeComment(input);
    const cardId = input.getAttribute('data-card-id');
    const opId = input.getAttribute('data-op-id');
    const card = cards.find(c => c.id === cardId);
    const op = card ? (card.operations || []).find(o => o.id === opId) : null;
    if (!op) return;

    input.addEventListener('focus', () => {
      input.dataset.prevComment = op.comment || '';
    });

    input.addEventListener('input', e => {
      const value = (e.target.value || '').slice(0, 40);
      e.target.value = value;
      op.comment = value;
      autoResizeComment(e.target);
    });

    input.addEventListener('blur', e => {
      const value = (e.target.value || '').slice(0, 40);
      e.target.value = value;
      const prev = input.dataset.prevComment || '';
      if (prev !== value) {
        recordCardLog(card, { action: 'Комментарий', object: opLogLabel(op), field: 'comment', targetId: op.id, oldValue: prev, newValue: value });
      }
      op.comment = value;
      saveData();
      renderDashboard();
    });
  });

  root.querySelectorAll('.executor-main-input').forEach(input => {
    const mobileCombo = isMobileExecutorInput(input);
    let isComposing = false;
    const runFiltering = () => updateExecutorCombo(input, { forceOpen: true });
    const comboWrapper = input.closest('.executor-combobox');
    const arrow = comboWrapper ? comboWrapper.querySelector('.executor-arrow') : null;

    if (arrow) {
      arrow.addEventListener('pointerdown', e => {
        e.preventDefault();
        input.focus({ preventScroll: true });
        runFiltering();
      });
    }

    if (mobileCombo) {
      input.addEventListener('compositionstart', () => { isComposing = true; });
      input.addEventListener('compositionend', () => { isComposing = false; runFiltering(); });
    }

    input.addEventListener('focus', () => {
      input.dataset.prevVal = input.value || '';
      runFiltering();
    });
    input.addEventListener('click', runFiltering);
    input.addEventListener('touchstart', runFiltering);
    input.addEventListener('input', e => {
      const cardId = input.getAttribute('data-card-id');
      const opId = input.getAttribute('data-op-id');
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!op) return;
      op.executor = sanitizeExecutorName((e.target.value || '').trim());
      if (!op.executor && (e.target.value || '').trim()) {
        e.target.value = '';
      }
      if (mobileCombo) {
        if (!isComposing) runFiltering();
      } else {
        updateExecutorCombo(input, { forceOpen: true });
      }
    });
    input.addEventListener('blur', e => {
      const cardId = input.getAttribute('data-card-id');
      const opId = input.getAttribute('data-op-id');
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!op || !card) return;
      const raw = (e.target.value || '').trim();
      const value = sanitizeExecutorName(raw);
      const prev = input.dataset.prevVal || '';
      if (value && !isEligibleExecutorName(value)) {
        alert('Выберите исполнителя со статусом "Рабочий" (пользователь Abyss недоступен).');
        e.target.value = '';
        op.executor = '';
        updateExecutorCombo(input);
        return;
      }
      if (!value && raw) {
        alert('Пользователь Abyss недоступен для выбора. Выберите другого исполнителя.');
        e.target.value = '';
      }
      op.executor = value;
      if (prev !== value) {
        recordCardLog(card, { action: 'Исполнитель', object: opLogLabel(op), field: 'executor', targetId: op.id, oldValue: prev, newValue: value });
        saveData();
        renderDashboard();
      }
      updateExecutorCombo(input);
    });
  });

  root.querySelectorAll('.add-executor-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cardId = btn.getAttribute('data-card-id');
      const opId = btn.getAttribute('data-op-id');
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!card || !op) return;
      if (!Array.isArray(op.additionalExecutors)) op.additionalExecutors = [];
      if (op.additionalExecutors.length >= 3) return;
      op.additionalExecutors.push('');
      recordCardLog(card, { action: 'Доп. исполнитель', object: opLogLabel(op), field: 'additionalExecutors', targetId: op.id, oldValue: op.additionalExecutors.length - 1, newValue: op.additionalExecutors.length });
      saveData();
      renderWorkordersTable();
      if (activeMobileCardId === card.id && isMobileOperationsLayout()) {
        buildMobileOperationsView(card, { preserveScroll: true });
      }
    });
  });

  root.querySelectorAll('.remove-executor-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cardId = btn.getAttribute('data-card-id');
      const opId = btn.getAttribute('data-op-id');
      const idx = parseInt(btn.getAttribute('data-extra-index'), 10);
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!card || !op || !Array.isArray(op.additionalExecutors)) return;
      if (idx < 0 || idx >= op.additionalExecutors.length) return;
      const removed = op.additionalExecutors.splice(idx, 1)[0];
      recordCardLog(card, { action: 'Доп. исполнитель', object: opLogLabel(op), field: 'additionalExecutors', targetId: op.id, oldValue: removed, newValue: 'удален' });
      saveData();
      renderWorkordersTable();
      if (activeMobileCardId === card.id && isMobileOperationsLayout()) {
        buildMobileOperationsView(card, { preserveScroll: true });
      }
    });
  });

  root.querySelectorAll('.additional-executor-input').forEach(input => {
    const mobileCombo = isMobileExecutorInput(input);
    let isComposing = false;
    const runFiltering = () => updateExecutorCombo(input, { forceOpen: true });
    const comboWrapper = input.closest('.executor-combobox');
    const arrow = comboWrapper ? comboWrapper.querySelector('.executor-arrow') : null;

    if (arrow) {
      arrow.addEventListener('pointerdown', e => {
        e.preventDefault();
        input.focus({ preventScroll: true });
        runFiltering();
      });
    }

    if (mobileCombo) {
      input.addEventListener('compositionstart', () => { isComposing = true; });
      input.addEventListener('compositionend', () => { isComposing = false; runFiltering(); });
    }

    input.addEventListener('focus', () => {
      input.dataset.prevVal = input.value || '';
      runFiltering();
    });
    input.addEventListener('click', runFiltering);
    input.addEventListener('touchstart', runFiltering);
    input.addEventListener('blur', e => {
      const cardId = input.getAttribute('data-card-id');
      const opId = input.getAttribute('data-op-id');
      const idx = parseInt(input.getAttribute('data-extra-index'), 10);
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!card || !op || !Array.isArray(op.additionalExecutors)) return;
      const raw = (e.target.value || '').trim();
      const value = sanitizeExecutorName(raw);
      const prev = input.dataset.prevVal || '';
      if (value && !isEligibleExecutorName(value)) {
        alert('Выберите исполнителя со статусом "Рабочий" (пользователь Abyss недоступен).');
        e.target.value = '';
        if (idx >= 0 && idx < op.additionalExecutors.length) {
          op.additionalExecutors[idx] = '';
        }
        updateExecutorCombo(input);
        return;
      }
      if (!value && raw) {
        alert('Пользователь Abyss недоступен для выбора. Выберите другого исполнителя.');
        e.target.value = '';
      }
      if (idx < 0 || idx >= op.additionalExecutors.length) return;
      op.additionalExecutors[idx] = value;
      if (prev !== value) {
        recordCardLog(card, { action: 'Доп. исполнитель', object: opLogLabel(op), field: 'additionalExecutors', targetId: op.id, oldValue: prev, newValue: value });
        saveData();
        renderDashboard();
      }
      updateExecutorCombo(input);
    });
    input.addEventListener('input', e => {
      const cardId = input.getAttribute('data-card-id');
      const opId = input.getAttribute('data-op-id');
      const idx = parseInt(input.getAttribute('data-extra-index'), 10);
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!card || !op || !Array.isArray(op.additionalExecutors)) return;
      if (idx < 0 || idx >= op.additionalExecutors.length) return;
      const raw = (e.target.value || '').trim();
      const value = sanitizeExecutorName(raw);
      op.additionalExecutors[idx] = value;
      if (mobileCombo) {
        if (!isComposing) runFiltering();
      } else {
        updateExecutorCombo(input, { forceOpen: true });
      }
    });
  });

  root.querySelectorAll('.qty-input').forEach(input => {
    const cardId = input.getAttribute('data-card-id');
    const opId = input.getAttribute('data-op-id');
    const type = input.getAttribute('data-qty-type');
    const card = cards.find(c => c.id === cardId);
    const op = card ? (card.operations || []).find(o => o.id === opId) : null;
    if (!op || !card) return;

    input.addEventListener('input', e => {
      e.target.value = toSafeCount(e.target.value);
    });

    input.addEventListener('blur', e => {
      const val = toSafeCount(e.target.value);
      const fieldMap = { good: 'goodCount', scrap: 'scrapCount', hold: 'holdCount' };
      const field = fieldMap[type] || null;
      if (!field) return;
      const prev = toSafeCount(op[field] || 0);
      if (prev === val) return;
      op[field] = val;
      recordCardLog(card, { action: 'Количество деталей', object: opLogLabel(op), field, targetId: op.id, oldValue: prev, newValue: val });
      saveData();
      renderDashboard();
    });
  });

  root.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (readonly) return;
      const action = btn.getAttribute('data-action');
      const cardId = btn.getAttribute('data-card-id');
      const opId = btn.getAttribute('data-op-id');
      const card = cards.find(c => c.id === cardId);
      if (!card) return;
      const op = (card.operations || []).find(o => o.id === opId);
      if (!op) return;
      const detail = btn.closest('.wo-card');
      if (detail && detail.open) {
        workorderOpenCards.add(cardId);
      }
      applyOperationAction(action, card, op);
      if (activeMobileCardId === card.id && isMobileOperationsLayout()) {
        buildMobileOperationsView(card, { preserveScroll: true });
      }
    });
  });

  syncExecutorComboboxMode();
  applyReadonlyState('workorders', 'workorders');
}

function bindWorkordersInteractions(rootEl, { readonly = false, forceClosed = true, enableSummaryNavigation = true } = {}) {
  if (!rootEl) return;
  bindCardInfoToggles(rootEl);

  rootEl.querySelectorAll('.wo-card[data-card-id]').forEach(detail => {
    if (forceClosed) {
      detail.open = false;
    }
    const summary = detail.querySelector('summary');
    if (summary && enableSummaryNavigation) {
      summary.addEventListener('click', (e) => {
        if (shouldIgnoreCardOpenClick(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const cardId = detail.dataset.cardId;
        const card = cards.find(c => c.id === cardId);
        if (!card) return;
        navigateToRoute(getWorkordersCardUrlByCard(card));
      });
    }
    markWorkorderToggleState(detail);
  });

  rootEl.querySelectorAll('button[data-attach-card]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-attach-card');
      openAttachmentsModal(id, 'live');
    });
  });

  rootEl.querySelectorAll('.archive-move-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-card-id');
      const card = cards.find(c => c.id === id);
      if (!card) return;
      if (!card.archived) {
        recordCardLog(card, { action: 'Архивирование', object: 'Карта', field: 'archived', oldValue: false, newValue: true });
      }
      card.archived = true;
      saveData();
      renderEverything();
    });
  });

  bindOperationControls(rootEl, { readonly });
}

function renderWorkorderCardPage(card, mountEl) {
  if (!card || !mountEl) return;
  const readonly = isTabReadonly('workorders');
  mountEl.innerHTML = `
    <div class="wo-page">
      <div class="wo-page-header">
        <button class="btn btn-small" id="wo-page-back">← Назад</button>
        <div class="wo-page-title">
          <div><b>Маршрутная карта</b></div>
          <div class="muted">QR: ${escapeHtml(normalizeQrId(card.qrId || ''))}</div>
        </div>
      </div>
      ${buildWorkorderCardDetails(card, { opened: true, readonly })}
    </div>
  `;

  const backBtn = document.getElementById('wo-page-back');
  if (backBtn) backBtn.onclick = () => navigateToRoute('/workorders');

  bindWorkordersInteractions(mountEl, { readonly, forceClosed: false, enableSummaryNavigation: false });

  const detail = mountEl.querySelector('details.wo-card');
  if (detail) detail.open = true;
}

function renderWorkordersTable({ collapseAll = false } = {}) {
  const wrapper = document.getElementById('workorders-table-wrapper');
  const readonly = isTabReadonly('workorders');
  const rootCards = cards.filter(c =>
    c &&
    !c.archived &&
    c.cardType === 'MKI' &&
    !isCardApprovalBlocked(c)
  );
  const hasOperations = rootCards.some(card => card.operations && card.operations.length);
  if (!hasOperations) {
    wrapper.innerHTML = '<p>Маршрутных операций пока нет.</p>';
    return;
  }

  if (collapseAll) {
    workorderOpenCards.clear();
  }

  const termRaw = workorderSearchTerm.trim();
  const termLower = termRaw.toLowerCase();
  const hasTerm = !!termLower;
  const filteredByStatus = rootCards.filter(card => {
    const state = getCardProcessState(card);
    return workorderStatusFilter === 'ALL' || state.key === workorderStatusFilter;
  });

  const filteredByMissingExecutor = workorderMissingExecutorFilter === 'NO_EXECUTOR'
    ? filteredByStatus.filter(card => cardHasMissingExecutors(card))
    : filteredByStatus;

  if (!filteredByMissingExecutor.length) {
    wrapper.innerHTML = '<p>Нет карт, подходящих под выбранный фильтр.</p>';
    return;
  }

  const scoreFn = (card) => cardSearchScore(card, termRaw);
  let sortedCards = [...filteredByMissingExecutor];
  if (termRaw) {
    sortedCards.sort((a, b) => scoreFn(b) - scoreFn(a));
  }

  const filteredBySearch = termRaw
    ? sortedCards.filter(card => scoreFn(card) > 0)
    : sortedCards;

  if (!filteredBySearch.length) {
    wrapper.innerHTML = '<p>Карты по запросу не найдены.</p>';
    return;
  }

  let html = '';
  filteredBySearch.forEach(card => {
    if (card.operations && card.operations.length) {
      const opened = !collapseAll && workorderOpenCards.has(card.id);
      html += buildWorkorderCardDetails(card, { opened, readonly, highlightCenterTerm: termLower });
    }
  });

  wrapper.innerHTML = html;
  bindWorkordersInteractions(wrapper, { readonly });
}

function renderWorkspaceView() {
  const wrapper = document.getElementById('workspace-results');
  if (!wrapper) return;
  const readonly = isTabReadonly('workspace');

  const termRaw = workspaceSearchTerm.trim();
  const barcodeTerm = termRaw.trim().toLowerCase();
  const isWorker = currentUser && currentUser.permissions && currentUser.permissions.worker;
  const activeCards = cards.filter(card =>
    card &&
    !card.archived &&
    card.cardType === 'MKI' &&
    !isCardApprovalBlocked(card) &&
    card.operations &&
    card.operations.length
  );
  let candidates = [];
  if (!barcodeTerm) {
    if (isWorker && currentUser) {
      const name = (currentUser.name || '').toLowerCase();
      const assigned = activeCards.filter(card => (card.operations || []).some(op => {
        const main = (op.executor || '').toLowerCase();
        const extras = (op.additionalExecutors || []).map(v => (v || '').toLowerCase());
        return main === name || extras.includes(name);
      }));
      const others = activeCards.filter(card => !assigned.includes(card));
      candidates = assigned.concat(others);
    } else {
      candidates = activeCards;
    }
  } else {
    candidates = activeCards.filter(card => {
      const cardBarcode = getCardBarcodeValue(card).toLowerCase();
      return cardBarcode && cardBarcode === barcodeTerm;
    });
  }

  if (!candidates.length) {
    wrapper.innerHTML = '<p>Карты по запросу не найдены.</p>';
    return;
  }

  let html = '';
  candidates.forEach(card => {
    if (card.operations && card.operations.length) {
      html += buildWorkspaceCardDetails(card, { readonly });
    }
  });

  if (!html) {
    wrapper.innerHTML = '<p>Нет карт с маршрутами для отображения.</p>';
    return;
  }

  wrapper.innerHTML = html;
  bindCardInfoToggles(wrapper);

  wrapper.querySelectorAll('.barcode-view-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-card-id');
      const card = cards.find(c => c.id === id);
      if (!card) return;
      openBarcodeModal(card);
    });
  });

  wrapper.querySelectorAll('button[data-attach-card]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-attach-card');
      openAttachmentsModal(id, 'live');
    });
  });

  wrapper.querySelectorAll('.wo-card button[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (readonly) return;
      const action = btn.getAttribute('data-action');
      const cardId = btn.getAttribute('data-card-id');
      const opId = btn.getAttribute('data-op-id');
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!card || !op) return;

      if (action === 'stop') {
        openWorkspaceStopModal(card, op);
      } else {
        applyOperationAction(action, card, op, { useWorkorderScrollLock: false });
      }
    });
  });

  applyReadonlyState('workspace', 'workspace');
}

function getWorkspaceModalInputs() {
  return [
    document.getElementById('workspace-stop-good'),
    document.getElementById('workspace-stop-scrap'),
    document.getElementById('workspace-stop-hold')
  ].filter(Boolean);
}

function setWorkspaceActiveInput(input) {
  workspaceActiveModalInput = input || null;
  if (workspaceActiveModalInput) {
    workspaceActiveModalInput.focus();
    workspaceActiveModalInput.select();
  }
}

function focusWorkspaceNextInput() {
  const inputs = getWorkspaceModalInputs();
  if (!inputs.length) return;
  const active = document.activeElement && inputs.includes(document.activeElement)
    ? document.activeElement
    : workspaceActiveModalInput;
  const idx = Math.max(0, inputs.indexOf(active));
  const next = inputs[(idx + 1) % inputs.length];
  setWorkspaceActiveInput(next);
}

function openWorkspaceStopModal(card, op) {
  const modal = document.getElementById('workspace-stop-modal');
  if (!modal) return;
  workspaceStopContext = { cardId: card.id, opId: op.id };
  const totalEl = document.getElementById('workspace-stop-total');
  if (totalEl) {
    const qty = getOperationQuantity(op, card);
    totalEl.textContent = qty === '' ? '–' : toSafeCount(qty);
  }
  const [goodInput, scrapInput, holdInput] = getWorkspaceModalInputs();
  if (goodInput) goodInput.value = toSafeCount(op.goodCount || 0);
  if (scrapInput) scrapInput.value = toSafeCount(op.scrapCount || 0);
  if (holdInput) holdInput.value = toSafeCount(op.holdCount || 0);
  modal.classList.remove('hidden');
  setWorkspaceActiveInput(goodInput || scrapInput || holdInput || null);
}

function closeWorkspaceStopModal() {
  const modal = document.getElementById('workspace-stop-modal');
  if (modal) modal.classList.add('hidden');
  workspaceStopContext = null;
  workspaceActiveModalInput = null;
}

function applyWorkspaceKeypad(key) {
  const inputs = getWorkspaceModalInputs();
  if (!inputs.length) return;
  const target = (document.activeElement && inputs.includes(document.activeElement))
    ? document.activeElement
    : workspaceActiveModalInput || inputs[0];
  if (!target) return;

  let value = target.value || '';
  if (key === 'back') {
    value = value.slice(0, -1);
  } else if (key === 'clear') {
    value = '';
  } else if (/^\d$/.test(key)) {
    value = value + key;
  }
  target.value = value.replace(/^0+(?=\d)/, '');
  setWorkspaceActiveInput(target);
}

function submitWorkspaceStopModal() {
  if (!workspaceStopContext) {
    closeWorkspaceStopModal();
    return;
  }
  const card = cards.find(c => c.id === workspaceStopContext.cardId);
  const op = card ? (card.operations || []).find(o => o.id === workspaceStopContext.opId) : null;
  if (!card || !op) {
    closeWorkspaceStopModal();
    return;
  }

  const inputs = getWorkspaceModalInputs();
  const [goodInput, scrapInput, holdInput] = inputs;
  const goodVal = toSafeCount(goodInput ? goodInput.value : 0);
  const scrapVal = toSafeCount(scrapInput ? scrapInput.value : 0);
  const holdVal = toSafeCount(holdInput ? holdInput.value : 0);

  const prevGood = toSafeCount(op.goodCount || 0);
  const prevScrap = toSafeCount(op.scrapCount || 0);
  const prevHold = toSafeCount(op.holdCount || 0);

  op.goodCount = goodVal;
  op.scrapCount = scrapVal;
  op.holdCount = holdVal;

  if (prevGood !== goodVal) {
    recordCardLog(card, { action: 'Количество деталей', object: opLogLabel(op), field: 'goodCount', targetId: op.id, oldValue: prevGood, newValue: goodVal });
  }
  if (prevScrap !== scrapVal) {
    recordCardLog(card, { action: 'Количество деталей', object: opLogLabel(op), field: 'scrapCount', targetId: op.id, oldValue: prevScrap, newValue: scrapVal });
  }
  if (prevHold !== holdVal) {
    recordCardLog(card, { action: 'Количество деталей', object: opLogLabel(op), field: 'holdCount', targetId: op.id, oldValue: prevHold, newValue: holdVal });
  }

  closeWorkspaceStopModal();
  applyOperationAction('stop', card, op, { useWorkorderScrollLock: false });
}

function buildArchiveCardDetails(card, { opened = false } = {}) {
  const stateBadge = renderCardStateBadge(card);
  const filesCount = (card.attachments || []).length;
  const barcodeValue = getCardBarcodeValue(card);
  const barcodeInline = barcodeValue
    ? ' • № карты: <span class="summary-barcode">' + escapeHtml(barcodeValue) + ' <button type="button" class="btn-small btn-secondary wo-barcode-btn" data-card-id="' + card.id + '">Штрихкод</button></span>'
    : '';
  const contractText = card.contractNumber ? ' (Договор: ' + escapeHtml(card.contractNumber) + ')' : '';
  const filesButton = ' <button type="button" class="btn-small clip-btn inline-clip" data-attach-card="' + card.id + '">📎 <span class="clip-count">' + filesCount + '</span></button>';
  const logButton = ' <button type="button" class="btn-small btn-secondary log-btn" data-log-card="' + card.id + '">Log</button>';
  const nameLabel = escapeHtml(formatCardTitle(card) || card.name || card.id || '');

  let html = '<details class="wo-card" data-card-id="' + card.id + '"' + (opened ? ' open' : '') + '>' +
    '<summary>' +
    '<div class="summary-line">' +
    '<div class="summary-text">' +
    '<strong>' + nameLabel + '</strong>' +
    ' <span class="summary-sub">' +
    (card.orderNo ? ' (Заказ: ' + escapeHtml(card.orderNo) + ')' : '') + contractText +
    barcodeInline + filesButton + logButton +
    '</span>' +
    '</div>' +
    '<div class="summary-actions">' +
    ' ' + stateBadge +
    ' <button type="button" class="btn-small btn-secondary repeat-card-btn" data-card-id="' + card.id + '">Повторить</button>' +
    '</div>' +
    '</div>' +
    '</summary>';

  html += buildCardInfoBlock(card);
  html += buildOperationsTable(card, { readonly: true });
  html += '</details>';
  return html;
}

function bindArchiveInteractions(rootEl, { forceClosed = true, enableSummaryNavigation = true } = {}) {
  if (!rootEl) return;
  bindCardInfoToggles(rootEl);

  rootEl.querySelectorAll('.wo-card[data-card-id]').forEach(detail => {
    if (forceClosed) {
      detail.open = false;
    }
    const summary = detail.querySelector('summary');
    if (summary && enableSummaryNavigation) {
      summary.addEventListener('click', (e) => {
        if (shouldIgnoreCardOpenClick(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const cardId = detail.dataset.cardId;
        const card = cards.find(c => c.id === cardId);
        if (!card) return;
        navigateToRoute(getArchiveCardUrlByCard(card));
      });
    }
  });

  rootEl.querySelectorAll('.wo-barcode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-card-id');
      const card = cards.find(c => c.id === id);
      if (!card) return;
      openBarcodeModal(card);
    });
  });

  rootEl.querySelectorAll('button[data-attach-card]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-attach-card');
      openAttachmentsModal(id, 'live');
    });
  });

  rootEl.querySelectorAll('.log-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-log-card');
      openLogModal(id);
    });
  });

  rootEl.querySelectorAll('.repeat-card-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-card-id');
      const card = cards.find(c => c.id === id);
      if (!card) return;
      const cloneOps = (card.operations || []).map(op => ({
        ...op,
        id: genId('rop'),
        status: 'NOT_STARTED',
        startedAt: null,
        finishedAt: null,
        actualSeconds: null,
        elapsedSeconds: 0,
        comment: ''
      }));
      const newCard = {
        ...card,
        id: genId('card'),
        barcode: card.barcode || '',
        cardType: 'MKI',
        name: (card.name || '') + ' (копия)',
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
        attachments: (card.attachments || []).map(file => ({
          ...file,
          id: genId('file'),
          createdAt: Date.now()
        })),
        operations: cloneOps
      };
      ensureCardMeta(newCard);
      recalcCardStatus(newCard);
      cards.push(newCard);
      saveData();
      renderEverything();
    });
  });

  applyReadonlyState('archive', 'archive');
}

function renderArchiveCardPage(card, mountEl) {
  if (!card || !mountEl) return;
  mountEl.innerHTML = `
    <div class="wo-page">
      <div class="wo-page-header">
        <button class="btn btn-small" id="archive-page-back">← Назад</button>
        <div class="wo-page-title">
          <div><b>Маршрутная карта</b></div>
          <div class="muted">QR: ${escapeHtml(normalizeQrId(card.qrId || ''))}</div>
        </div>
      </div>
      ${buildArchiveCardDetails(card, { opened: true })}
    </div>
  `;

  const backBtn = document.getElementById('archive-page-back');
  if (backBtn) backBtn.onclick = () => navigateToRoute('/archive');

  bindArchiveInteractions(mountEl, { forceClosed: false, enableSummaryNavigation: false });

  const detail = mountEl.querySelector('details.wo-card');
  if (detail) detail.open = true;
}

function renderArchiveTable() {
  const wrapper = document.getElementById('archive-table-wrapper');
  const archivedCards = cards.filter(c =>
    c &&
    c.archived &&
    c.cardType === 'MKI' &&
    !isCardApprovalBlocked(c)
  );

  if (!archivedCards.length) {
    wrapper.innerHTML = '<p>В архиве пока нет карт.</p>';
    return;
  }

  const termRaw = archiveSearchTerm.trim();
  const filteredByStatus = archivedCards.filter(card => {
    const state = getCardProcessState(card);
    return archiveStatusFilter === 'ALL' || state.key === archiveStatusFilter;
  });

  if (!filteredByStatus.length) {
    wrapper.innerHTML = '<p>Нет архивных карт, удовлетворяющих фильтру.</p>';
    return;
  }

  const scoreFn = (card) => cardSearchScore(card, termRaw);
  let sortedCards = [...filteredByStatus];
  if (termRaw) {
    sortedCards.sort((a, b) => scoreFn(b) - scoreFn(a));
  }

  const filteredBySearch = termRaw
    ? sortedCards.filter(card => scoreFn(card) > 0)
    : sortedCards;

  if (!filteredBySearch.length) {
    wrapper.innerHTML = '<p>Архивные карты по запросу не найдены.</p>';
    return;
  }

  let html = '';
  filteredBySearch.forEach(card => {
    if (card.operations && card.operations.length) {
      html += buildArchiveCardDetails(card);
    }
  });

  wrapper.innerHTML = html || '<p>Нет архивных карт, удовлетворяющих фильтру.</p>';
  bindArchiveInteractions(wrapper);
}
