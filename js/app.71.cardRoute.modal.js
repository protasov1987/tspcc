// === МАРШРУТ КАРТЫ (ЧЕРЕЗ МОДАЛЬНОЕ ОКНО) ===
function renderDraftItemsRow(op, colspan = 8) {
  const items = Array.isArray(op.items) ? op.items : [];
  const content = items.length
    ? items.map((item, idx) => '<label class="item-name-field">' +
        '<span class="item-name-index">' + (idx + 1) + '.</span>' +
        '<input class="item-name-input" data-op-id="' + op.id + '" data-item-id="' + (item.id || '') + '" placeholder="Изделие ' + (idx + 1) + '" value="' + escapeHtml(item.name || '') + '">' +
        '<span class="item-qty-tag">1 шт</span>' +
      '</label>').join('')
    : '<span class="items-empty">Укажите количество изделий для операции, чтобы задать их список.</span>';

  return '<tr class="op-qty-row op-items-row"><td colspan="' + colspan + '">' +
    '<div class="items-row-header">Список изделий</div>' +
    '<div class="items-row-content editable">' + content + '</div>' +
    '</td></tr>';
}

function updateRouteTableScrollState() {
  const wrapper = document.getElementById('route-table-wrapper');
  if (!wrapper) return;
  wrapper.style.removeProperty('--route-table-max-height');
  wrapper.classList.remove('route-table-scrollable');
}

function isDesktopCardLayout() {
  return window.innerWidth > 1024;
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
  renumberAutoCodesForCard(activeCardDraft);
  if (!opsArr.length) {
    wrapper.innerHTML = '<p>Маршрут пока пуст. Добавьте операции ниже.</p>';
    document.getElementById('card-status-text').textContent = cardStatusText(activeCardDraft);
    requestAnimationFrame(() => updateRouteTableScrollState());
    return;
  }
  const sortedOps = [...opsArr].sort((a, b) => (a.order || 0) - (b.order || 0));
  const { isMki, hasSamples } = getActiveCardSampleAvailability();
  let html = '<table><thead><tr>' +
    '<th>Порядок</th><th>Подразделение</th><th>Код операции</th><th>Наименование операции</th><th>Кол-во изделий</th><th>План (мин)</th><th>Статус</th><th>Действия</th>' +
    '</tr></thead><tbody>';
  sortedOps.forEach((o, index) => {
    normalizeOperationItems(activeCardDraft, o);
    const qtyValue = getOperationQuantity(o, activeCardDraft);
    const qtyLabel = o.isSamples ? 'Кол-во образцов' : 'Кол-во изделий';
    const qtyCell = isMki
      ? '<td class="route-qty-cell mki-op-qty-cell">' +
        '<div class="mki-op-qty-cell__value">' + escapeHtml(qtyValue) + '</div>' +
        '<label class="mki-op-qty-cell__samples">' +
          '<span>Образцы</span>' +
          '<input type="checkbox" class="route-samples-checkbox" data-rop-id="' + o.id + '"' + (o.isSamples ? ' checked' : '') + (hasSamples ? '' : ' disabled') + '>' +
        '</label>' +
      '</td>'
      : '<td><input type="number" min="0" class="route-qty-input" data-rop-id="' + o.id + '" value="' + escapeHtml(qtyValue) + '"></td>';

    html += '<tr data-rop-id="' + o.id + '">' +
      '<td>' + (index + 1) + '</td>' +
      '<td>' + escapeHtml(o.centerName) + '</td>' +
      '<td><input class="route-code-input" data-rop-id="' + o.id + '" value="' + escapeHtml(o.opCode || '') + '" /></td>' +
      '<td>' + renderOpName(o, { card: activeCardDraft }) + '</td>' +
      qtyCell +
      '<td>' + (o.plannedMinutes || '') + '</td>' +
      '<td>' + statusBadge(o.status) + '</td>' +
      '<td><div class="table-actions">' +
      '<button class="btn-small" data-action="move-up">↑</button>' +
      '<button class="btn-small" data-action="move-down">↓</button>' +
      '<button class="btn-small btn-danger" data-action="delete">Удалить</button>' +
      '</div></td>' +
      '</tr>';

    if (activeCardDraft.useItemList) {
      html += renderDraftItemsRow(o, 8);
    }
  });
  html += '</tbody></table>';
  wrapper.innerHTML = html;

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

  if (isMki) {
    wrapper.querySelectorAll('.route-samples-checkbox').forEach(input => {
      input.addEventListener('change', e => {
        if (!activeCardDraft) return;
        const ropId = input.getAttribute('data-rop-id');
        const op = activeCardDraft.operations.find(o => o.id === ropId);
        if (!op) return;
        op.isSamples = Boolean(e.target.checked);
        recalcMkiOperationQuantities(activeCardDraft);
        renderRouteTableDraft();
      });
    });
  }

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
      normalizeOperationItems(activeCardDraft, op);
      const firstOp = getFirstOperation(activeCardDraft);
      if (firstOp && firstOp.id === ropId) {
        syncItemListFromFirstOperation(activeCardDraft);
      }
      if (prev !== op.quantity && !activeCardIsNew) {
        recordCardLog(activeCardDraft, { action: 'Количество изделий', object: opLogLabel(op), field: 'operationQuantity', targetId: op.id, oldValue: prev, newValue: op.quantity });
      }
      renderRouteTableDraft();
    });
  });

  wrapper.querySelectorAll('.item-name-input').forEach(input => {
    input.addEventListener('blur', e => {
      if (!activeCardDraft) return;
      const ropId = input.getAttribute('data-op-id');
      const itemId = input.getAttribute('data-item-id');
      const op = activeCardDraft.operations.find(o => o.id === ropId);
      if (!op || !Array.isArray(op.items)) return;
      const item = op.items.find(it => it.id === itemId);
      if (!item) return;
      const prev = item.name || '';
      const value = (e.target.value || '').trim();
      item.name = value;
      if (prev !== value && !activeCardIsNew) {
        recordCardLog(activeCardDraft, { action: 'Список изделий', object: opLogLabel(op), field: 'itemName', targetId: item.id, oldValue: prev, newValue: value });
      }
      const firstOp = getFirstOperation(activeCardDraft);
      if (firstOp && firstOp.id === ropId) {
        syncItemListFromFirstOperation(activeCardDraft);
        renderRouteTableDraft();
        return;
      }
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

  if (window.innerWidth > 768) {
    container.classList.remove('open');
    container.innerHTML = '';
    return;
  }

  container.innerHTML = '';
  if (!items || !items.length) {
    container.classList.remove('open');
    return;
  }

  items.forEach(item => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'combo-option';
    btn.textContent = kind === 'center' ? (item.name || '') : formatOpLabel(item);
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
}

function hideRouteCombos() {
  const containers = document.querySelectorAll('.combo-suggestions');
  containers.forEach(el => {
    el.classList.remove('open');
    if (el.classList.contains('executor-suggestions')) {
      resetExecutorSuggestionPosition(el);
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

function filterExecutorChoices(filter, { useCyrillic = false } = {}) {
  const normalize = useCyrillic ? normalizeCyrillicTerm : (val = '') => val.toLowerCase();
  const term = normalize(filter || '');
  return getEligibleExecutorNames()
    .filter(name => !term || normalize(name).includes(term))
    .slice(0, 30);
}

function shouldUseCustomExecutorCombo() {
  const pointerCoarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const touchCapable = typeof navigator !== 'undefined' && Number(navigator.maxTouchPoints || 0) > 0;
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

