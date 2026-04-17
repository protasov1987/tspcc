// === МАРШРУТ КАРТЫ (ЧЕРЕЗ МОДАЛЬНОЕ ОКНО) ===
function canEditRouteOpPlannedMinutes(card = activeCardDraft) {
  if (!card) return false;
  if (activeCardIsNew) return true;
  return card.approvalStage === APPROVAL_STAGE_DRAFT;
}

function normalizeRouteOpPlannedMinutes(value, fallback = 30) {
  const parsed = parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed >= 1) return parsed;
  const normalizedFallback = parseInt(fallback, 10);
  return Number.isFinite(normalizedFallback) && normalizedFallback >= 1 ? normalizedFallback : 30;
}

function updateRouteTableScrollState() {
  const wrapper = document.getElementById('route-table-wrapper');
  if (!wrapper) return;
  wrapper.style.removeProperty('--route-table-max-height');
  wrapper.classList.remove('route-table-scrollable');
}

function isDesktopCardLayout() {
  return getViewportWidth() > DESKTOP_CARD_LAYOUT_BREAKPOINT;
}

function scrollRouteAreaToLatest() {
  const wrapper = document.getElementById('route-table-wrapper');
  const modalBody = document.querySelector('#card-modal .modal-body');
  if (!wrapper || !modalBody) return;
  const lastRow = wrapper.querySelector('tbody tr:last-child');
  const scrollContainer = isDesktopCardLayout() ? wrapper : modalBody;
  if (!lastRow) {
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
    return;
  }

  if (scrollContainer === wrapper) {
    const lastBottom = lastRow.offsetTop + lastRow.offsetHeight;
    const targetScroll = Math.max(0, lastBottom - wrapper.clientHeight);
    wrapper.scrollTop = targetScroll;
    return;
  }

  const addPanel = document.querySelector('#route-editor .route-add-panel');
  const bodyRect = modalBody.getBoundingClientRect();
  const rowRect = lastRow.getBoundingClientRect();
  const stickyBottomOffset = addPanel ? addPanel.getBoundingClientRect().height : 0;
  const visibleBottom = bodyRect.bottom - stickyBottomOffset - 12;
  const visibleTop = bodyRect.top + 12;

  if (rowRect.bottom > visibleBottom) {
    modalBody.scrollTop += rowRect.bottom - visibleBottom;
  } else if (rowRect.top < visibleTop) {
    modalBody.scrollTop += rowRect.top - visibleTop;
  }
}

function formatCardMainSummaryText({ name, quantity, routeNumber }) {
  const safeName = name || 'Маршрутная карта';
  const qtyLabel = quantity !== '' && quantity != null
    ? toSafeCount(quantity) + ' шт.'
    : 'Размер партии не указан';
  const routeLabel = routeNumber ? 'МК № ' + routeNumber : 'МК без номера';
  return safeName + ' · ' + qtyLabel + ' · ' + routeLabel;
}

function computeCardMainSummary() {
  const nameInput = document.getElementById('card-name');
  const qtyInput = document.getElementById('card-qty');
  const routeInput = document.getElementById('card-route-number');
  return formatCardMainSummaryText({
    name: (nameInput ? nameInput.value : '').trim(),
    quantity: (qtyInput ? qtyInput.value : '').trim(),
    routeNumber: (routeInput ? routeInput.value : '').trim()
  });
}

function updateCardMainSummary() {
  const summary = document.getElementById('card-main-summary');
  if (!summary) return;
  summary.textContent = computeCardMainSummary();
}

function setCardMainCollapsed(collapsed) {
  const block = document.getElementById('card-main-block');
  const toggle = document.getElementById('card-main-toggle');
  if (!block || !toggle) return;
  const isCollapsed = collapsed && isDesktopCardLayout();
  block.classList.toggle('is-collapsed', isCollapsed);
  toggle.textContent = isCollapsed ? 'Развернуть' : 'Свернуть';
  toggle.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
  updateCardMainSummary();
}

function renderRouteTableDraft() {
  const wrapper = document.getElementById('route-table-wrapper');
  if (!wrapper || !activeCardDraft) return;
  const opsArr = activeCardDraft.operations || [];
  const canEditPlannedMinutes = canEditRouteOpPlannedMinutes(activeCardDraft);
  renumberAutoCodesForCard(activeCardDraft);
  if (!opsArr.length) {
    wrapper.innerHTML = '<p>Маршрут пока пуст. Добавьте операции ниже.</p>';
    document.getElementById('card-status-text').textContent = cardStatusText(activeCardDraft);
    requestAnimationFrame(() => updateRouteTableScrollState());
    return;
  }
  const sortedOps = [...opsArr].sort((a, b) => (a.order || 0) - (b.order || 0));
  const { isMki } = getActiveCardSampleAvailability();
  const resolveSampleType = (op) => {
    if (!op || !op.isSamples) return '';
    const raw = (op.sampleType || '').toString().trim().toUpperCase();
    return raw === 'WITNESS' ? 'WITNESS' : 'CONTROL';
  };
  const getOpQtyMode = (op) => {
    if (!op || !op.isSamples) return 'ITEM';
    return resolveSampleType(op) === 'WITNESS' ? 'WITNESS' : 'CONTROL';
  };
  const formatQtyModeLogValue = (mode, qty) => {
    const label = mode === 'WITNESS' ? 'ОС' : (mode === 'CONTROL' ? 'ОК' : 'Изд.');
    return `${label}: ${qty === '' || qty == null ? '—' : qty}`;
  };
  let html = '<table><thead><tr>' +
    '<th>Порядок</th><th>Подразделение</th><th>Код операции</th><th>Наименование операции</th><th>Кол-во изделий</th><th>План (мин)</th><th>Статус</th><th>Действия</th>' +
    '</tr></thead><tbody>';
  sortedOps.forEach((o, index) => {
    const qtyValue = getOperationQuantity(o, activeCardDraft);
    const qtyLabel = o.isSamples ? 'Кол-во образцов' : 'Кол-во изделий';
    const opSampleType = resolveSampleType(o);
    const isMaterialIssue = isMaterialIssueOperation(o) || isMaterialReturnOperation(o) || isDryingOperation(o);
    const sampleMarks = o.isSamples
      ? (opSampleType === 'WITNESS'
        ? '<label class="mki-op-qty-cell__samples">' +
          '<span>ОС</span>' +
          '<input type="checkbox" class="route-samples-checkbox" data-rop-id="' + o.id + '" data-sample-type="WITNESS" checked disabled>' +
        '</label>'
        : '<label class="mki-op-qty-cell__samples">' +
          '<span>ОК</span>' +
          '<input type="checkbox" class="route-samples-checkbox" data-rop-id="' + o.id + '" data-sample-type="CONTROL" checked disabled>' +
        '</label>')
      : '';
    const qtyCell = isMaterialIssue
      ? '<td class="route-qty-cell muted">—</td>'
      : (isMki
        ? '<td class="route-qty-cell"><div class="mki-op-qty-cell">' +
          '<div class="mki-op-qty-cell__value">' + escapeHtml(qtyValue) + '</div>' +
          sampleMarks +
        '</div></td>'
        : '<td><input type="number" min="0" class="route-qty-input" data-rop-id="' + o.id + '" value="' + escapeHtml(qtyValue) + '"></td>');

    html += '<tr data-rop-id="' + o.id + '">' +
      '<td>' + (index + 1) + '</td>' +
      '<td>' + escapeHtml(o.centerName) + '</td>' +
      '<td><input class="route-code-input" data-rop-id="' + o.id + '" value="' + escapeHtml(o.opCode || '') + '" /></td>' +
      '<td>' + renderOpName(o, { card: activeCardDraft }) + '</td>' +
      qtyCell +
      '<td>' + (canEditPlannedMinutes
        ? '<input type="number" min="1" step="1" class="route-planned-input" data-rop-id="' + o.id + '" value="' + escapeHtml(String(normalizeRouteOpPlannedMinutes(o.plannedMinutes, 30))) + '">'
        : escapeHtml(String(o.plannedMinutes || ''))) + '</td>' +
      '<td>' + statusBadge(o.status) + '</td>' +
      '<td><div class="table-actions">' +
      '<button class="btn-small" data-action="move-up">↑</button>' +
      '<button class="btn-small" data-action="move-down">↓</button>' +
      '<button class="btn-small btn-delete" data-action="delete">🗑️</button>' +
      '</div></td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  wrapper.innerHTML = html;

  if (isMki) {
    sortedOps.forEach(op => {
      const isMaterialLike = isMaterialIssueOperation(op) || isMaterialReturnOperation(op) || isDryingOperation(op);
      if (isMaterialLike) return;
      const opIdSelector = String(op.id || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const row = wrapper.querySelector(`tr[data-rop-id='${opIdSelector}']`);
      const cell = row ? row.querySelector('.route-qty-cell .mki-op-qty-cell') : null;
      if (!cell) return;
      const qtyValue = getOperationQuantity(op, activeCardDraft);
      const opSampleType = resolveSampleType(op);
      cell.innerHTML = '' +
        '<div class="mki-op-qty-cell__value">' + escapeHtml(qtyValue) + '</div>' +
        '<div class="mki-op-qty-cell__marks">' +
          '<label class="mki-op-qty-cell__samples">' +
            '<span>ОС</span>' +
            '<input type="checkbox" class="route-samples-checkbox" data-rop-id="' + op.id + '" data-sample-type="WITNESS"' + (op.isSamples && opSampleType === 'WITNESS' ? ' checked' : '') + '>' +
          '</label>' +
          '<label class="mki-op-qty-cell__samples">' +
            '<span>ОК</span>' +
            '<input type="checkbox" class="route-samples-checkbox" data-rop-id="' + op.id + '" data-sample-type="CONTROL"' + (op.isSamples && opSampleType === 'CONTROL' ? ' checked' : '') + '>' +
          '</label>' +
        '</div>';
    });
  }

  wrapper.querySelectorAll('tr[data-rop-id]').forEach(row => {
    const ropId = row.getAttribute('data-rop-id');
    row.querySelectorAll('button[data-action]').forEach(btn => {
      const action = btn.getAttribute('data-action');
      btn.addEventListener('click', () => {
        if (!activeCardDraft) return;
        if (action === 'delete') {
          activeCardDraft.operations = activeCardDraft.operations.filter(o => o.id !== ropId);
          renumberAutoCodesForCard(activeCardDraft);
        } else if (action === 'move-up' || action === 'move-down') {
          moveRouteOpInDraft(ropId, action === 'move-up' ? -1 : 1);
        }
        document.getElementById('card-status-text').textContent = cardStatusText(activeCardDraft);
        renderRouteTableDraft();
      });
    });
  });

  wrapper.querySelectorAll('.route-code-input').forEach(input => {
    input.addEventListener('blur', e => {
      if (!activeCardDraft) return;
      const ropId = input.getAttribute('data-rop-id');
      const op = activeCardDraft.operations.find(o => o.id === ropId);
      if (!op) return;
      const prev = op.opCode || '';
      const value = (e.target.value || '').trim();
      if (!value) {
        op.autoCode = true;
      } else {
        op.autoCode = false;
        op.opCode = value;
      }
      renumberAutoCodesForCard(activeCardDraft);
      if (prev !== op.opCode && !activeCardIsNew) {
        recordCardLog(activeCardDraft, { action: 'Код операции', object: opLogLabel(op), field: 'opCode', targetId: op.id, oldValue: prev, newValue: op.opCode });
      }
      renderRouteTableDraft();
    });
  });

  wrapper.querySelectorAll('.route-samples-checkbox').forEach(input => {
    input.addEventListener('change', () => {
      if (!activeCardDraft || activeCardDraft.cardType !== 'MKI') return;
      const ropId = input.getAttribute('data-rop-id');
      const sampleType = (input.getAttribute('data-sample-type') || '').toUpperCase() === 'WITNESS' ? 'WITNESS' : 'CONTROL';
      const op = activeCardDraft.operations.find(o => o.id === ropId);
      if (!op) return;
      const prevMode = getOpQtyMode(op);
      const prevQty = getOperationQuantity(op, activeCardDraft);
      if (input.checked) {
        op.isSamples = true;
        op.sampleType = sampleType;
      } else {
        op.isSamples = false;
        op.sampleType = '';
      }
      const nextMode = getOpQtyMode(op);
      const nextQty = getOperationQuantity(op, activeCardDraft);
      if (!activeCardIsNew && (prevMode !== nextMode || prevQty !== nextQty)) {
        recordCardLog(activeCardDraft, {
          action: 'Количество изделий',
          object: opLogLabel(op),
          field: 'operationQuantity',
          targetId: op.id,
          oldValue: formatQtyModeLogValue(prevMode, prevQty),
          newValue: formatQtyModeLogValue(nextMode, nextQty)
        });
      }
      renderRouteTableDraft();
    });
  });

  wrapper.querySelectorAll('.route-qty-input').forEach(input => {
    input.addEventListener('input', e => {
      if (activeCardDraft && activeCardDraft.cardType === 'MKI') {
        const ropId = input.getAttribute('data-rop-id');
        const op = activeCardDraft.operations.find(o => o.id === ropId);
        e.target.value = getOperationQuantity(op, activeCardDraft);
        return;
      }
      e.target.value = toSafeCount(e.target.value);
    });
    input.addEventListener('blur', e => {
      if (!activeCardDraft) return;
      const ropId = input.getAttribute('data-rop-id');
      const op = activeCardDraft.operations.find(o => o.id === ropId);
      if (!op) return;
      if (activeCardDraft.cardType === 'MKI') {
        input.value = getOperationQuantity(op, activeCardDraft);
        return;
      }
      const prev = getOperationQuantity(op, activeCardDraft);
      const raw = e.target.value;
      if (raw === '') {
        op.quantity = '';
      } else {
        op.quantity = toSafeCount(raw);
      }
      if (prev !== op.quantity && !activeCardIsNew) {
        recordCardLog(activeCardDraft, { action: 'Количество изделий', object: opLogLabel(op), field: 'operationQuantity', targetId: op.id, oldValue: prev, newValue: op.quantity });
      }
      renderRouteTableDraft();
    });
  });

  wrapper.querySelectorAll('.route-planned-input').forEach(input => {
    input.addEventListener('input', e => {
      const raw = String(e.target.value || '').trim();
      if (!raw) return;
      const parsed = parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        e.target.value = '1';
      } else if (String(parsed) !== raw) {
        e.target.value = String(parsed);
      }
    });
    input.addEventListener('blur', e => {
      if (!activeCardDraft) return;
      const ropId = input.getAttribute('data-rop-id');
      const op = activeCardDraft.operations.find(item => item.id === ropId);
      if (!op) return;
      op.plannedMinutes = normalizeRouteOpPlannedMinutes(e.target.value, op.plannedMinutes);
      e.target.value = String(op.plannedMinutes);
    });
  });

  requestAnimationFrame(() => {
    updateRouteTableScrollState();
    scrollRouteAreaToLatest();
  });
}

function moveRouteOpInDraft(ropId, delta) {
  if (!activeCardDraft) return;
  const opsArr = [...(activeCardDraft.operations || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const idx = opsArr.findIndex(o => o.id === ropId);
  if (idx < 0) return;
  const newIdx = idx + delta;
  if (newIdx < 0 || newIdx >= opsArr.length) return;
  const tmpOrder = opsArr[idx].order;
  opsArr[idx].order = opsArr[newIdx].order;
  opsArr[newIdx].order = tmpOrder;
  activeCardDraft.operations = opsArr;
  renumberAutoCodesForCard(activeCardDraft);
}

function getFilteredRouteSources() {
  const opInput = document.getElementById('route-op');
  const centerInput = document.getElementById('route-center');
  const opFilter = (opInput ? opInput.value : '').toLowerCase();
  const centerFilter = (centerInput ? centerInput.value : '').toLowerCase();

  const filteredOps = ops.filter(o => {
    if (!opFilter) return true;
    const label = formatOpLabel(o).toLowerCase();
    const code = (o.opCode || o.code || '').toLowerCase();
    const desc = (o.desc || '').toLowerCase();
    return label.includes(opFilter) || code.includes(opFilter) || desc.includes(opFilter);
  });
  const filteredCenters = centers.filter(c => {
    if (!centerFilter) return true;
    const name = (c.name || '').toLowerCase();
    const desc = (c.desc || '').toLowerCase();
    return name.includes(centerFilter) || desc.includes(centerFilter);
  });

  return { filteredOps, filteredCenters };
}

function updateRouteCombo(kind, items, { forceOpen = false } = {}) {
  const containerId = kind === 'center' ? 'route-center-suggestions' : 'route-op-suggestions';
  const inputId = kind === 'center' ? 'route-center' : 'route-op';
  const container = document.getElementById(containerId);
  const input = document.getElementById(inputId);
  if (!container || !input) return;
  const comboField = input.closest('.combo-field');

  const otherContainerId = kind === 'center' ? 'route-op-suggestions' : 'route-center-suggestions';
  const otherContainer = document.getElementById(otherContainerId);
  if (otherContainer) {
    otherContainer.classList.remove('open');
    const otherField = otherContainer.closest('.combo-field');
    if (otherField) otherField.classList.remove('has-open-combo');
    resetRouteSuggestionPosition(otherContainer);
  }

  container.innerHTML = '';
  if (!items || !items.length) {
    container.classList.remove('open');
    if (comboField) comboField.classList.remove('has-open-combo');
    resetRouteSuggestionPosition(container);
    return;
  }

  items.forEach(item => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'combo-option';
    btn.textContent = kind === 'center' ? (item.name || '') : formatOpLabel(item);
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('pointerdown', e => e.preventDefault());
    btn.addEventListener('click', () => {
      input.value = btn.textContent;
      container.classList.remove('open');
      fillRouteSelectors();
      input.focus();
    });
    container.appendChild(btn);
  });

  const shouldOpen = forceOpen || container.classList.contains('open');
  container.classList.toggle('open', shouldOpen);
  if (comboField) comboField.classList.toggle('has-open-combo', shouldOpen);
  if (shouldOpen) {
    positionRouteSuggestions(container, input);
  } else {
    resetRouteSuggestionPosition(container);
  }
}

function hideRouteCombos() {
  const containers = document.querySelectorAll('.combo-suggestions');
  containers.forEach(el => {
    el.classList.remove('open');
    const comboField = el.closest('.combo-field');
    if (comboField) comboField.classList.remove('has-open-combo');
    if (el.classList.contains('executor-suggestions')) {
      resetExecutorSuggestionPosition(el);
    } else {
      resetRouteSuggestionPosition(el);
    }
  });
}

function isMobileExecutorInput(input) {
  if (!input) return false;
  if (input.closest && input.closest('#mobile-operations-view')) return true;
  return document.body.classList.contains('mobile-ops-open') && isMobileOperationsLayout();
}

function normalizeCyrillicTerm(str = '') {
  return str.toLowerCase().replace(/[^а-яё]/g, '');
}

function resetRouteSuggestionPosition(container) {
  if (!container) return;
  container.style.position = '';
  container.style.left = '';
  container.style.top = '';
  container.style.width = '';
  container.style.maxWidth = '';
  container.style.zIndex = '';
}

function positionRouteSuggestions(container, input) {
  if (!container || !input) {
    resetRouteSuggestionPosition(container);
    return;
  }
  const rect = input.getBoundingClientRect();
  const viewportPadding = 8;
  const availableWidth = Math.max(0, window.innerWidth - viewportPadding * 2);
  const targetWidth = Math.min(rect.width, availableWidth);
  const left = Math.min(
    Math.max(viewportPadding, rect.left),
    Math.max(viewportPadding, window.innerWidth - targetWidth - viewportPadding)
  );
  const top = Math.min(rect.bottom + 4, window.innerHeight - viewportPadding);

  container.style.position = 'fixed';
  container.style.left = `${left}px`;
  container.style.top = `${top}px`;
  container.style.width = `${targetWidth}px`;
  container.style.maxWidth = `${availableWidth}px`;
  container.style.zIndex = '5000';
}

function repositionOpenRouteSuggestions() {
  const openContainers = document.querySelectorAll('.combo-suggestions.open:not(.executor-suggestions)');
  openContainers.forEach(container => {
    const comboField = container.closest('.combo-field');
    const input = comboField ? comboField.querySelector('input') : null;
    if (input) {
      positionRouteSuggestions(container, input);
    } else {
      resetRouteSuggestionPosition(container);
    }
  });
}

function filterExecutorChoices(filter, { useCyrillic = false } = {}) {
  const normalize = useCyrillic ? normalizeCyrillicTerm : (val = '') => val.toLowerCase();
  const term = normalize(filter || '');
  return getEligibleExecutorNames()
    .filter(name => !term || normalize(name).includes(term))
    .slice(0, 30);
}

function shouldUseCustomExecutorCombo() {
  const routePath = String(window.location.pathname || '').split('?')[0];
  if (routePath === '/cards/new' || routePath === '/cards-mki/new') {
    return false;
  }
  const pointerCoarse = hasCoarsePointer();
  const touchCapable = isTouchCapableDevice();
  const mobileOpsActive = isMobileOperationsLayout() || document.body.classList.contains('mobile-ops-open');
  return pointerCoarse || touchCapable || mobileOpsActive;
}

function updateExecutorCombo(input, { forceOpen = false } = {}) {
  if (!input) return;
  const combo = input.closest('.executor-combo');
  const container = combo ? combo.querySelector('.executor-suggestions') : null;
  if (!container) return;

  if (!shouldUseCustomExecutorCombo()) {
    container.classList.remove('open');
    container.innerHTML = '';
    resetExecutorSuggestionPosition(container);
    return;
  }

  const mobileMode = isMobileExecutorInput(input);
  const options = filterExecutorChoices(input.value, { useCyrillic: mobileMode });
  container.innerHTML = '';
  if (!options.length) {
    container.classList.remove('open');
    resetExecutorSuggestionPosition(container);
    return;
  }

  options.forEach(name => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'combo-option';
    btn.textContent = name;
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('pointerdown', e => e.preventDefault());
    btn.addEventListener('click', () => {
      input.value = name;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      container.classList.remove('open');
      input.focus();
    });
    container.appendChild(btn);
  });

  const shouldOpen = forceOpen || container.classList.contains('open');
  container.classList.toggle('open', shouldOpen);
  if (shouldOpen) {
    if (!mobileMode) {
      positionExecutorSuggestions(container, input);
    } else {
      resetExecutorSuggestionPosition(container);
    }
  } else {
    resetExecutorSuggestionPosition(container);
  }
}

function repositionOpenExecutorSuggestions() {
  if (!shouldUseCustomExecutorCombo()) return;
  const openContainers = document.querySelectorAll('.executor-suggestions.open');
  openContainers.forEach(container => {
    const combo = container.closest('.executor-combo');
    const input = combo ? combo.querySelector('input[type="text"]') : null;
    if (input && !isMobileExecutorInput(input)) {
      positionExecutorSuggestions(container, input);
    } else {
      resetExecutorSuggestionPosition(container);
    }
  });
}

function syncExecutorComboboxMode() {
  const useCustom = shouldUseCustomExecutorCombo();
  const inputs = document.querySelectorAll('.executor-main-input, .additional-executor-input');
  inputs.forEach(input => {
    if (useCustom) {
      if (input.hasAttribute('list')) {
        input.removeAttribute('list');
      }
    } else {
      if (input.getAttribute('list') !== USER_DATALIST_ID) {
        input.setAttribute('list', USER_DATALIST_ID);
      }
    }
  });

  document.querySelectorAll('.executor-suggestions').forEach(container => {
    if (!useCustom) {
      container.classList.remove('open');
      resetExecutorSuggestionPosition(container);
    }
  });
}

function handleExecutorViewportChange() {
  syncExecutorComboboxMode();
  repositionOpenExecutorSuggestions();
}

window.addEventListener('resize', handleExecutorViewportChange);
window.addEventListener('scroll', repositionOpenExecutorSuggestions, true);
window.addEventListener('resize', repositionOpenRouteSuggestions);
window.addEventListener('scroll', repositionOpenRouteSuggestions, true);

function fillRouteSelectors() {
  const opList = document.getElementById('route-op-options');
  const centerList = document.getElementById('route-center-options');
  if (!opList || !centerList) return;

  const { filteredOps, filteredCenters } = getFilteredRouteSources();

  opList.innerHTML = '';
  filteredOps.forEach(o => {
    const opt = document.createElement('option');
    opt.value = formatOpLabel(o);
    opt.dataset.id = o.id;
    opList.appendChild(opt);
  });

  centerList.innerHTML = '';
  filteredCenters.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.name;
    opt.dataset.id = c.id;
    centerList.appendChild(opt);
  });

  const centerSuggestions = document.getElementById('route-center-suggestions');
  if (centerSuggestions) {
    centerSuggestions.classList.remove('open');
    const comboField = centerSuggestions.closest('.combo-field');
    if (comboField) comboField.classList.remove('has-open-combo');
    resetRouteSuggestionPosition(centerSuggestions);
  }

  const opSuggestions = document.getElementById('route-op-suggestions');
  if (opSuggestions) {
    opSuggestions.classList.remove('open');
    const comboField = opSuggestions.closest('.combo-field');
    if (comboField) comboField.classList.remove('has-open-combo');
    resetRouteSuggestionPosition(opSuggestions);
  }

  updateRouteCombo('op', filteredOps);
  updateRouteCombo('center', filteredCenters);
}

function resetExecutorSuggestionPosition(container) {
  if (!container) return;
  container.style.position = '';
  container.style.left = '';
  container.style.top = '';
  container.style.width = '';
  container.style.maxWidth = '';
  container.style.zIndex = '';
}

function resetCenterForm() {
  const form = document.getElementById('center-form');
  if (!form) return;
  form.dataset.editingId = '';
  form.reset();
  const submit = document.getElementById('center-submit');
  const cancel = document.getElementById('center-cancel-edit');
  if (submit) submit.textContent = 'Добавить подразделение';
  if (cancel) cancel.classList.add('hidden');
}

function startCenterEdit(center) {
  const form = document.getElementById('center-form');
  if (!form || !center) return;
  form.dataset.editingId = center.id;
  const nameInput = document.getElementById('center-name');
  const descInput = document.getElementById('center-desc');
  if (nameInput) nameInput.value = center.name || '';
  if (descInput) descInput.value = center.desc || '';
  const submit = document.getElementById('center-submit');
  const cancel = document.getElementById('center-cancel-edit');
  if (submit) submit.textContent = 'Сохранить';
  if (cancel) cancel.classList.remove('hidden');
  if (nameInput) nameInput.focus();
}

function resetOpForm() {
  const form = document.getElementById('op-form');
  if (!form) return;
  form.dataset.editingId = '';
  form.reset();
  const submit = document.getElementById('op-submit');
  const cancel = document.getElementById('op-cancel-edit');
  const typeInput = document.getElementById('op-type');
  if (submit) submit.textContent = 'Добавить операцию';
  if (cancel) cancel.classList.add('hidden');
  if (typeInput) typeInput.value = DEFAULT_OPERATION_TYPE;
}

function startOpEdit(op) {
  const form = document.getElementById('op-form');
  if (!form || !op) return;
  form.dataset.editingId = op.id;
  const nameInput = document.getElementById('op-name');
  const descInput = document.getElementById('op-desc');
  const timeInput = document.getElementById('op-time');
  const typeInput = document.getElementById('op-type');
  if (nameInput) nameInput.value = op.name || '';
  if (descInput) descInput.value = op.desc || '';
  if (timeInput) timeInput.value = op.recTime || 30;
  if (typeInput) typeInput.value = normalizeOperationType(op.operationType);
  const submit = document.getElementById('op-submit');
  const cancel = document.getElementById('op-cancel-edit');
  if (submit) submit.textContent = 'Сохранить';
  if (cancel) cancel.classList.remove('hidden');
  if (nameInput) nameInput.focus();
}

function updateCenterReferences(updatedCenter) {
  if (!updatedCenter) return;
  const apply = (opsArr = []) => {
    opsArr.forEach(op => {
      if (op && op.centerId === updatedCenter.id) {
        op.centerName = updatedCenter.name;
      }
    });
  };
  cards.forEach(card => apply(card.operations));
  if (activeCardDraft && Array.isArray(activeCardDraft.operations)) {
    apply(activeCardDraft.operations);
  }
}

function updateOperationReferences(updatedOp) {
  if (!updatedOp) return;
  const apply = (opsArr = []) => {
    opsArr.forEach(op => {
      if (op && op.opId === updatedOp.id) {
        op.opName = updatedOp.name;
        if (op.status === 'NOT_STARTED' || !op.status) {
          op.plannedMinutes = updatedOp.recTime || op.plannedMinutes;
        }
        op.operationType = normalizeOperationType(updatedOp.operationType);
      }
    });
  };
  cards.forEach(card => apply(card.operations));
  if (activeCardDraft && Array.isArray(activeCardDraft.operations)) {
    apply(activeCardDraft.operations);
  }
}

function positionExecutorSuggestions(container, input) {
  if (!container || !input || !shouldUseCustomExecutorCombo() || isMobileExecutorInput(input)) {
    resetExecutorSuggestionPosition(container);
    return;
  }

  const rect = input.getBoundingClientRect();
  const viewportPadding = 6;
  const availableWidth = window.innerWidth - viewportPadding * 2;
  const targetWidth = Math.min(rect.width, availableWidth);
  const left = Math.min(
    Math.max(viewportPadding, rect.left + window.scrollX),
    window.scrollX + window.innerWidth - targetWidth - viewportPadding
  );
  const top = rect.bottom + window.scrollY + 4;

  container.style.position = 'fixed';
  container.style.left = `${left}px`;
  container.style.top = `${top}px`;
  container.style.width = `${targetWidth}px`;
  container.style.maxWidth = `${availableWidth}px`;
  container.style.zIndex = '1400';
}
