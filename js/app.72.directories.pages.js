// === СТРАНИЦЫ СПРАВОЧНИКОВ ===
function getDepartmentEmployeeCount(centerId) {
  const normalizedId = (centerId || '').trim();
  if (!normalizedId) return 0;
  return (users || []).filter(user => {
    const name = (user?.name || user?.username || '').trim();
    if (!name || name.toLowerCase() === 'abyss') return false;
    return (user?.departmentId || '').trim() === normalizedId;
  }).length;
}

function resetDepartmentsForm() {
  const form = document.getElementById('departments-form');
  if (!form) return;
  form.dataset.editingId = '';
  form.reset();
  const submit = document.getElementById('departments-submit');
  const cancel = document.getElementById('departments-cancel');
  if (submit) submit.textContent = 'Добавить подразделение';
  if (cancel) cancel.classList.add('hidden');
}

function startDepartmentEdit(center) {
  const form = document.getElementById('departments-form');
  if (!form || !center) return;
  form.dataset.editingId = center.id;
  const nameInput = document.getElementById('departments-name');
  const descInput = document.getElementById('departments-desc');
  if (nameInput) nameInput.value = center.name || '';
  if (descInput) descInput.value = center.desc || '';
  const submit = document.getElementById('departments-submit');
  const cancel = document.getElementById('departments-cancel');
  if (submit) submit.textContent = 'Сохранить';
  if (cancel) cancel.classList.remove('hidden');
  if (nameInput) nameInput.focus();
}

function renderDepartmentsTable() {
  const wrapper = document.getElementById('departments-table-wrapper');
  if (!wrapper) return;
  if (!centers.length) {
    wrapper.innerHTML = '<p>Список подразделений пуст.</p>';
    return;
  }
  let html = '<table><thead><tr><th>Название</th><th>Описание</th><th>Сотрудники</th><th>Действия</th></tr></thead><tbody>';
  centers.forEach(center => {
    const count = getDepartmentEmployeeCount(center.id);
    html += '<tr>' +
      '<td>' + escapeHtml(center.name) + '</td>' +
      '<td>' + escapeHtml(center.desc || '') + '</td>' +
      '<td>' + count + '</td>' +
      '<td><div class="table-actions">' +
      '<button class="btn-small btn-secondary" data-id="' + center.id + '" data-action="edit">Изменить</button>' +
      '<button class="btn-small btn-delete" data-id="' + center.id + '" data-action="delete">🗑️</button>' +
      '</div></td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  wrapper.innerHTML = html;

  wrapper.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      const action = btn.getAttribute('data-action');
      const center = centers.find(c => c.id === id);
      if (!center) return;
      if (action === 'edit') {
        startDepartmentEdit(center);
        return;
      }
      const count = getDepartmentEmployeeCount(center.id);
      if (count > 0) {
        alert('Нельзя удалить подразделение: есть сотрудники (' + count + ').');
        return;
      }
      if (confirm('Удалить подразделение? Он останется в уже созданных маршрутах как текст.')) {
        centers = centers.filter(c => c.id !== id);
        const saved = await saveData();
        if (saved === false) return;
        const form = document.getElementById('departments-form');
        if (form && form.dataset.editingId === id) {
          resetDepartmentsForm();
        }
        renderDepartmentsTable();
        fillRouteSelectors();
        renderEmployeesPage();
      }
    });
  });
}

function renderDepartmentsPage() {
  const form = document.getElementById('departments-form');
  if (form && form.dataset.bound !== 'true') {
    form.dataset.bound = 'true';
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const name = document.getElementById('departments-name').value.trim();
      const desc = document.getElementById('departments-desc').value.trim();
      if (!name) return;
      const editingId = form.dataset.editingId;
      if (editingId) {
        const target = centers.find(c => c.id === editingId);
        if (target) {
          const prevName = target.name;
          target.name = name;
          target.desc = desc;
          updateCenterReferences(target);
          if (prevName !== name) {
            renderWorkordersTable({ collapseAll: true });
          }
        }
      } else {
        centers.push({ id: genId('wc'), name, desc });
      }
      saveData();
      renderDepartmentsTable();
      fillRouteSelectors();
      if (activeCardDraft) {
        renderRouteTableDraft();
      }
      renderCardsTable();
      renderWorkordersTable({ collapseAll: true });
      renderEmployeesPage();
      resetDepartmentsForm();
    });
  }
  const cancelBtn = document.getElementById('departments-cancel');
  if (cancelBtn && cancelBtn.dataset.bound !== 'true') {
    cancelBtn.dataset.bound = 'true';
    cancelBtn.addEventListener('click', () => resetDepartmentsForm());
  }

  renderDepartmentsTable();
}

function resetOperationsForm() {
  const form = document.getElementById('operations-form');
  if (!form) return;
  form.dataset.editingId = '';
  form.reset();
  const submit = document.getElementById('operations-submit');
  const cancel = document.getElementById('operations-cancel');
  const typeInput = document.getElementById('operations-type');
  if (submit) submit.textContent = 'Добавить операцию';
  if (cancel) cancel.classList.add('hidden');
  if (typeInput) typeInput.value = DEFAULT_OPERATION_TYPE;
}

function startOperationEdit(op) {
  const form = document.getElementById('operations-form');
  if (!form || !op) return;
  form.dataset.editingId = op.id;
  const nameInput = document.getElementById('operations-name');
  const descInput = document.getElementById('operations-desc');
  const timeInput = document.getElementById('operations-time');
  const typeInput = document.getElementById('operations-type');
  if (nameInput) nameInput.value = op.name || '';
  if (descInput) descInput.value = op.desc || '';
  if (timeInput) timeInput.value = op.recTime || 30;
  if (typeInput) typeInput.value = normalizeOperationType(op.operationType);
  const submit = document.getElementById('operations-submit');
  const cancel = document.getElementById('operations-cancel');
  if (submit) submit.textContent = 'Сохранить';
  if (cancel) cancel.classList.remove('hidden');
  if (nameInput) nameInput.focus();
}

function normalizeAllowedAreaIds(value) {
  if (!Array.isArray(value)) return [];
  return value.map(v => String(v).trim()).filter(Boolean);
}

function hasPlannedCardsWithActiveOperation(opId) {
  const targetId = String(opId || '').trim();
  if (!targetId) return false;
  return (cards || []).some(card => {
    if (!card) return false;
    if (card.approvalStage !== APPROVAL_STAGE_PLANNING && card.approvalStage !== APPROVAL_STAGE_PLANNED) return false;
    const cardOps = Array.isArray(card.operations) ? card.operations : [];
    return cardOps.some(routeOp => {
      if (!routeOp) return false;
      const refId = String(routeOp.opId || '').trim();
      if (!refId || refId !== targetId) return false;
      const status = routeOp.status || 'NOT_STARTED';
      return status !== 'NOT_STARTED';
    });
  });
}

function findOperationDuplicateByName(name, editingId = '') {
  const normalized = String(name || '').trim().toLowerCase();
  if (!normalized) return null;
  const editing = String(editingId || '');
  return (ops || []).find(op => {
    if (!op) return false;
    if (editing && String(op.id) === editing) return false;
    return String(op.name || '').trim().toLowerCase() === normalized;
  }) || null;
}

function buildOperationsAreasControlsHtml(operation) {
  const allowedAreaIds = normalizeAllowedAreaIds(operation?.allowedAreaIds);
  const selectedAreas = allowedAreaIds.map(id => (areas || []).find(area => area.id === id)).filter(Boolean);
  const selectedHtml = selectedAreas.length
    ? '<div class="op-areas-list">' + selectedAreas.map(area => (
      '<span class="op-area-pill">' +
      renderAreaLabel(area, { name: area.name || '', fallbackName: '' }) +
      '<button type="button" class="btn-small btn-secondary op-area-remove" data-id="' + operation.id + '" data-area-id="' + escapeHtml(area.id) + '">-</button>' +
      '</span>'
    )).join('') + '</div>'
    : '<span class="muted">Участки не заданы</span>';
  const availableOptions = (areas || []).length
    ? ['<option value="">Выберите участок</option>'].concat(
      (areas || []).map(area => (
        '<option value="' + escapeHtml(area.id) + '"' + (allowedAreaIds.includes(area.id) ? ' disabled' : '') + '>' +
        escapeHtml(area.name || '') +
        '</option>'
      ))
    ).join('')
    : '';
  return (areas || []).length
    ? '<div class="op-areas-controls" data-op-id="' + operation.id + '">' +
      selectedHtml +
      '<div class="op-areas-add">' +
      '<button type="button" class="btn-small btn-secondary op-area-add-toggle" data-id="' + operation.id + '">+</button>' +
      '<select class="op-areas-picker hidden" data-id="' + operation.id + '">' + availableOptions + '</select>' +
      '</div>' +
      '</div>'
    : '<span class="muted">Участки не заданы</span>';
}

function buildOperationsRowHtml(operation) {
  const opType = normalizeOperationType(operation?.operationType);
  const typeOptions = OPERATION_TYPE_OPTIONS.map(type => '<option value="' + escapeHtml(type) + '"' + (type === opType ? ' selected' : '') + '>' + escapeHtml(type) + '</option>').join('');
  return '<tr data-operation-id="' + escapeHtml(operation.id || '') + '">' +
    '<td>' + escapeHtml(operation.name || '') + '</td>' +
    '<td>' + escapeHtml(operation.desc || '') + '</td>' +
    '<td><select class="op-type-select" data-id="' + operation.id + '">' + typeOptions + '</select></td>' +
    '<td>' + buildOperationsAreasControlsHtml(operation) + '</td>' +
    '<td>' + (operation.recTime || '') + '</td>' +
    '<td><div class="table-actions">' +
    '<button class="btn-small btn-secondary" data-id="' + operation.id + '" data-action="edit">Изменить</button>' +
    '<button class="btn-small btn-delete" data-id="' + operation.id + '" data-action="delete">🗑️</button>' +
    '</div></td>' +
    '</tr>';
}

function findOperationsTableBody() {
  return document.querySelector('#operations-table-wrapper tbody');
}

function findOperationsRow(opId) {
  const tbody = findOperationsTableBody();
  if (!tbody || !opId) return null;
  return tbody.querySelector(`tr[data-operation-id="${CSS.escape(String(opId))}"]`);
}

function bindOperationsRowControls(root) {
  if (!root) return;
  root.querySelectorAll('button[data-action][data-id]').forEach(btn => {
    if (btn.dataset.bound === 'true') return;
    btn.dataset.bound = 'true';
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const action = btn.getAttribute('data-action');
      const op = ops.find(v => v.id === id);
      if (!op) return;
      if (action === 'edit') {
        startOperationEdit(op);
        return;
      }
      if (confirm('Удалить операцию? Она останется в уже созданных маршрутах как текст.')) {
        ops = ops.filter(o => o.id !== id);
        saveData();
        const form = document.getElementById('operations-form');
        if (form && form.dataset.editingId === id) {
          resetOperationsForm();
        }
        renderOperationsTable();
        fillRouteSelectors();
        if (activeCardDraft) {
          renderRouteTableDraft();
        }
        renderWorkordersTable({ collapseAll: true });
        renderCardsTable();
      }
    });
  });

  root.querySelectorAll('select.op-type-select').forEach(select => {
    if (select.dataset.bound === 'true') return;
    select.dataset.bound = 'true';
    select.addEventListener('change', () => {
      const id = select.getAttribute('data-id');
      const op = ops.find(v => v.id === id);
      if (!op) return;
      const prevType = normalizeOperationType(op.operationType);
      const nextType = normalizeOperationType(select.value);
      if (hasPlannedCardsWithActiveOperation(op.id)) {
        select.value = prevType;
        if (typeof showToast === 'function') {
          showToast('Нельзя изменить тип операции: есть запланированные МК с этой операцией в статусе не "Не начата".');
        }
        return;
      }
      if (prevType === nextType) return;
      op.operationType = nextType;
      updateOperationReferences(op);
      ensureOperationTypes();
      saveData();
      renderOperationsTable();
      renderRouteTableDraft();
      renderWorkordersTable({ collapseAll: true });
      renderCardsTable();
    });
  });
}

function getOrderedOperationIds() {
  ops.forEach(op => {
    op.allowedAreaIds = normalizeAllowedAreaIds(op.allowedAreaIds);
  });
  let finalOps = Array.isArray(ops) ? ops.slice() : [];
  if (operationsSortKey === 'name') {
    finalOps = sortCardsByKey(finalOps, 'name', operationsSortDir, op => op?.name || '');
  } else if (operationsSortKey === 'desc') {
    finalOps = sortCardsByKey(finalOps, 'desc', operationsSortDir, op => op?.desc || '');
  } else if (operationsSortKey === 'type') {
    finalOps = sortCardsByKey(finalOps, 'type', operationsSortDir, op => normalizeOperationType(op?.operationType));
  } else if (operationsSortKey === 'areas') {
    finalOps = sortCardsByKey(finalOps, 'areas', operationsSortDir, op => {
      const ids = normalizeAllowedAreaIds(op?.allowedAreaIds);
      return ids
        .map(id => ((areas || []).find(area => area.id === id)?.name || ''))
        .filter(Boolean)
        .join(', ');
    });
  } else if (operationsSortKey === 'time') {
    finalOps = sortCardsByKey(finalOps, 'time', operationsSortDir, op => Number(op?.recTime) || 0);
  }
  return finalOps.map(op => String(op?.id || '')).filter(Boolean);
}

function insertOperationRowLive(operation) {
  const tbody = findOperationsTableBody();
  if (!tbody || !operation?.id) return false;
  if (findOperationsRow(operation.id)) return updateOperationRowLive(operation);
  if (operationsSortKey) return renderOperationsTable(), true;
  const emptyState = document.querySelector('#operations-table-wrapper > p');
  if (emptyState) {
    renderOperationsTable();
    return true;
  }
  tbody.insertAdjacentHTML('beforeend', buildOperationsRowHtml(operation));
  bindOperationsRowControls(findOperationsRow(operation.id));
  return true;
}

function updateOperationRowLive(operation) {
  const tbody = findOperationsTableBody();
  const current = findOperationsRow(operation?.id);
  if (!tbody || !operation?.id) return false;
  if (!current) return insertOperationRowLive(operation);
  if (operationsSortKey) return renderOperationsTable(), true;
  current.outerHTML = buildOperationsRowHtml(operation);
  bindOperationsRowControls(findOperationsRow(operation.id));
  return true;
}

function removeOperationRowLive(opId) {
  const wrapper = document.getElementById('operations-table-wrapper');
  const current = findOperationsRow(opId);
  if (!wrapper || !current) return false;
  current.remove();
  if (!findOperationsTableBody()?.querySelector('tr[data-operation-id]')) {
    wrapper.innerHTML = '<p>Список операций пуст.</p>';
  }
  return true;
}

function syncOperationRowLive(operation) {
  if (!operation?.id) return false;
  const existing = findOperationsRow(operation.id);
  if (existing) return updateOperationRowLive(operation);
  return insertOperationRowLive(operation);
}

function renderOperationsTable() {
  const wrapper = document.getElementById('operations-table-wrapper');
  if (!wrapper) return;
  if (!ops.length) {
    wrapper.innerHTML = '<p>Список операций пуст.</p>';
    return;
  }
  ops.forEach(op => {
    op.allowedAreaIds = normalizeAllowedAreaIds(op.allowedAreaIds);
  });
  let finalOps = Array.isArray(ops) ? ops.slice() : [];
  if (operationsSortKey) {
    if (operationsSortKey === 'name') {
      finalOps = sortCardsByKey(finalOps, 'name', operationsSortDir, op => op?.name || '');
    } else if (operationsSortKey === 'desc') {
      finalOps = sortCardsByKey(finalOps, 'desc', operationsSortDir, op => op?.desc || '');
    } else if (operationsSortKey === 'type') {
      finalOps = sortCardsByKey(finalOps, 'type', operationsSortDir, op => normalizeOperationType(op?.operationType));
    } else if (operationsSortKey === 'areas') {
      finalOps = sortCardsByKey(finalOps, 'areas', operationsSortDir, op => {
        const ids = normalizeAllowedAreaIds(op?.allowedAreaIds);
        return ids
          .map(id => ((areas || []).find(area => area.id === id)?.name || ''))
          .filter(Boolean)
          .join(', ');
      });
    } else if (operationsSortKey === 'time') {
      finalOps = sortCardsByKey(finalOps, 'time', operationsSortDir, op => Number(op?.recTime) || 0);
    }
  }
  let html = '<table><thead><tr>' +
    '<th class="th-sortable" data-sort-key="name">Название</th>' +
    '<th class="th-sortable" data-sort-key="desc">Описание</th>' +
    '<th class="th-sortable" data-sort-key="type">Тип</th>' +
    '<th class="th-sortable" data-sort-key="areas">Участки</th>' +
    '<th class="th-sortable" data-sort-key="time">Рек. время (мин)</th>' +
    '<th>Действия</th>' +
    '</tr></thead><tbody>';
  finalOps.forEach(o => {
    html += buildOperationsRowHtml(o);
  });
  html += '</tbody></table>';
  wrapper.innerHTML = html;

  if (!wrapper.dataset.sortBound) {
    wrapper.dataset.sortBound = '1';
    wrapper.addEventListener('click', event => {
      const th = event.target.closest('th.th-sortable');
      if (!th || !wrapper.contains(th)) return;
      const key = th.getAttribute('data-sort-key') || '';
      if (!key) return;
      if (operationsSortKey === key) {
        operationsSortDir = operationsSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        operationsSortKey = key;
        operationsSortDir = 'asc';
      }
      renderOperationsTable();
    });
  }
  updateTableSortUI(wrapper, operationsSortKey, operationsSortDir);

  bindOperationsRowControls(wrapper);

  if (wrapper.dataset.boundAreas !== 'true') {
    wrapper.dataset.boundAreas = 'true';
    wrapper.addEventListener('click', event => {
      const addBtn = event.target.closest('.op-area-add-toggle');
      if (addBtn) {
        const row = addBtn.closest('tr');
        const picker = row ? row.querySelector('.op-areas-picker') : null;
        if (!picker) return;
        picker.classList.remove('hidden');
        picker.focus();
        return;
      }
      const removeBtn = event.target.closest('.op-area-remove');
      if (removeBtn) {
        const id = removeBtn.getAttribute('data-id');
        const areaId = removeBtn.getAttribute('data-area-id');
        const op = ops.find(v => v.id === id);
        if (!op || !areaId) return;
        const area = (areas || []).find(item => item.id === areaId);
        const areaName = area ? area.name || '' : '';
        if (!confirm('Удалить участок «' + areaName + '» из операции?')) return;
        const nextIds = normalizeAllowedAreaIds(op.allowedAreaIds).filter(item => item !== areaId);
        op.allowedAreaIds = nextIds;
        saveData();
        if (typeof showToast === 'function') {
          showToast('Участок удалён: ' + areaName);
        }
        renderOperationsTable();
      }
    });
    wrapper.addEventListener('change', event => {
      const picker = event.target.closest('.op-areas-picker');
      if (!picker) return;
      const areaId = picker.value;
      if (!areaId) return;
      const id = picker.getAttribute('data-id');
      const op = ops.find(v => v.id === id);
      if (!op) return;
      const nextIds = normalizeAllowedAreaIds(op.allowedAreaIds);
      if (!nextIds.includes(areaId)) {
        nextIds.push(areaId);
        op.allowedAreaIds = nextIds;
        saveData();
        const area = (areas || []).find(item => item.id === areaId);
        const areaName = area ? area.name || '' : '';
        if (typeof showToast === 'function') {
          showToast('Участок добавлен: ' + areaName);
        }
      }
      renderOperationsTable();
    });
  }
}

function renderOperationsPage() {
  const form = document.getElementById('operations-form');
  if (form && form.dataset.bound !== 'true') {
    form.dataset.bound = 'true';
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const name = document.getElementById('operations-name').value.trim();
      const desc = document.getElementById('operations-desc').value.trim();
      const time = parseInt(document.getElementById('operations-time').value, 10) || 30;
      const type = normalizeOperationType(document.getElementById('operations-type').value);
      if (!name) return;
      const prevAreas = areas.map(item => ({ ...item }));
      const editingId = form.dataset.editingId;
      const duplicate = findOperationDuplicateByName(name, editingId);
      if (duplicate) {
        if (typeof showToast === 'function') {
          showToast('Операция с таким названием уже существует.');
        }
        return;
      }
      if (editingId) {
        const target = ops.find(o => o.id === editingId);
        if (target) {
          target.name = name;
          target.desc = desc;
          target.recTime = time;
          target.operationType = type;
          updateOperationReferences(target);
        }
      } else {
        ops.push({
          id: genId('op'),
          name,
          desc,
          recTime: time,
          operationType: type,
          allowedAreaIds: []
        });
      }
      ensureOperationTypes();
      saveData();
      renderOperationsTable();
      fillRouteSelectors();
      if (activeCardDraft) {
        renderRouteTableDraft();
      }
      renderCardsTable();
      renderWorkordersTable({ collapseAll: true });
      resetOperationsForm();
    });
  }
  const cancelBtn = document.getElementById('operations-cancel');
  if (cancelBtn && cancelBtn.dataset.bound !== 'true') {
    cancelBtn.dataset.bound = 'true';
    cancelBtn.addEventListener('click', () => resetOperationsForm());
  }

  renderOperationsTable();
}

function resetAreasForm() {
  const form = document.getElementById('areas-form');
  if (!form) return;
  form.dataset.editingId = '';
  form.reset();
  const typeInput = document.getElementById('areas-type');
  if (typeInput) typeInput.value = DEFAULT_AREA_TYPE;
  const submit = document.getElementById('areas-submit');
  const cancel = document.getElementById('areas-cancel');
  if (submit) submit.textContent = 'Добавить участок';
  if (cancel) cancel.classList.add('hidden');
}

let areasLoadDateFrom = formatDateInputValue(Date.now());
let areasLoadDateTo = formatDateInputValue(Date.now());
let areasLoadSelectedShifts = [];

function getAreasLoadAvailableShifts() {
  const shifts = typeof getProductionShiftNumbers === 'function'
    ? getProductionShiftNumbers()
    : [1, 2, 3];
  return Array.isArray(shifts) && shifts.length ? shifts : [1, 2, 3];
}

function ensureAreasLoadFiltersState() {
  const today = formatDateInputValue(Date.now());
  if (!areasLoadDateFrom) areasLoadDateFrom = today;
  if (!areasLoadDateTo) areasLoadDateTo = today;
  if (areasLoadDateTo < areasLoadDateFrom) areasLoadDateTo = areasLoadDateFrom;

  const available = getAreasLoadAvailableShifts();
  const normalized = available.filter(shift => (areasLoadSelectedShifts || []).includes(shift));
  areasLoadSelectedShifts = normalized.length ? normalized : available.slice();
}

function syncAreasLoadDateInputs() {
  ensureAreasLoadFiltersState();
  const fromInput = document.getElementById('areas-load-date-from-native');
  const toInput = document.getElementById('areas-load-date-to-native');
  if (fromInput) fromInput.value = areasLoadDateFrom;
  if (toInput) {
    toInput.min = areasLoadDateFrom;
    toInput.value = areasLoadDateTo;
  }
}

function addAreaLoadDays(dateStr, days) {
  if (typeof addDaysToDateStr === 'function') {
    return addDaysToDateStr(dateStr, days);
  }
  const source = new Date(`${dateStr}T00:00:00`);
  source.setDate(source.getDate() + days);
  return formatDateInputValue(source);
}

function getAreasLoadDateSlots() {
  ensureAreasLoadFiltersState();
  const dates = [];
  let current = areasLoadDateFrom;
  while (current <= areasLoadDateTo) {
    dates.push(current);
    current = addAreaLoadDays(current, 1);
  }
  return dates;
}

function getAreasLoadMetrics(area) {
  const normalizedArea = normalizeArea(area);
  const shifts = getAreasLoadAvailableShifts().filter(shift => areasLoadSelectedShifts.includes(shift));
  const dates = getAreasLoadDateSlots();
  let plannedMinutes = 0;
  let totalMinutes = 0;
  dates.forEach(dateStr => {
    shifts.forEach(shift => {
      plannedMinutes += getShiftPlannedMinutes(dateStr, shift, normalizedArea.id);
      totalMinutes += getShiftDurationMinutesForArea(shift, normalizedArea.id);
    });
  });
  const loadPct = totalMinutes > 0
    ? Math.min(999, Math.max(0, Math.round(((plannedMinutes / totalMinutes) * 100) * 10) / 10)).toFixed(1)
    : '0.0';
  return {
    loadPct,
    plannedMinutes,
    totalMinutes,
    slotCount: dates.length * shifts.length,
    shifts,
    dates
  };
}

function renderAreasLoadShiftButtons() {
  ensureAreasLoadFiltersState();
  const container = document.getElementById('areas-load-shifts');
  if (!container) return;
  const buttonsHtml = getAreasLoadAvailableShifts().map(shift => `
    <button
      type="button"
      class="production-shift-btn${areasLoadSelectedShifts.includes(shift) ? ' active' : ''}"
      data-shift="${shift}"
    >${shift} смена</button>
  `).join('');
  container.innerHTML = buttonsHtml;
}

function bindAreasLoadFilters() {
  ensureAreasLoadFiltersState();
  syncAreasLoadDateInputs();
  renderAreasLoadShiftButtons();

  const fromInput = document.getElementById('areas-load-date-from-native');
  const toInput = document.getElementById('areas-load-date-to-native');
  const shiftGroup = document.getElementById('areas-load-shifts');

  if (fromInput && fromInput.dataset.bound !== 'true') {
    fromInput.dataset.bound = 'true';
    fromInput.addEventListener('change', () => {
      areasLoadDateFrom = formatDateInputValue(fromInput.value || Date.now());
      if (areasLoadDateTo < areasLoadDateFrom) {
        areasLoadDateTo = areasLoadDateFrom;
      }
      syncAreasLoadDateInputs();
      renderAreasTable();
    });
  }

  if (toInput && toInput.dataset.bound !== 'true') {
    toInput.dataset.bound = 'true';
    toInput.addEventListener('change', () => {
      const nextValue = formatDateInputValue(toInput.value || areasLoadDateFrom || Date.now());
      areasLoadDateTo = nextValue < areasLoadDateFrom ? areasLoadDateFrom : nextValue;
      syncAreasLoadDateInputs();
      renderAreasTable();
    });
  }

  if (shiftGroup && shiftGroup.dataset.bound !== 'true') {
    shiftGroup.dataset.bound = 'true';
    shiftGroup.addEventListener('click', event => {
      const btn = event.target.closest('button[data-shift]');
      if (!btn) return;
      const shift = parseInt(btn.getAttribute('data-shift') || '', 10) || 1;
      const available = getAreasLoadAvailableShifts();
      const exists = areasLoadSelectedShifts.includes(shift);
      const next = exists
        ? areasLoadSelectedShifts.filter(item => item !== shift)
        : areasLoadSelectedShifts.concat(shift);
      const normalized = available.filter(item => next.includes(item));
      if (!normalized.length) return;
      areasLoadSelectedShifts = normalized;
      renderAreasLoadShiftButtons();
      renderAreasTable();
    });
  }
}

function startAreaEdit(area) {
  const form = document.getElementById('areas-form');
  if (!form || !area) return;
  form.dataset.editingId = area.id;
  const nameInput = document.getElementById('areas-name');
  const descInput = document.getElementById('areas-desc');
  const typeInput = document.getElementById('areas-type');
  if (nameInput) nameInput.value = area.name || '';
  if (descInput) descInput.value = area.desc || '';
  if (typeInput) typeInput.value = normalizeAreaType(area.type);
  const submit = document.getElementById('areas-submit');
  const cancel = document.getElementById('areas-cancel');
  if (submit) submit.textContent = 'Сохранить';
  if (cancel) cancel.classList.remove('hidden');
  if (nameInput) nameInput.focus();
}

function buildAreaRowHtml(rawArea) {
  const area = normalizeArea(rawArea);
  const loadMetrics = getAreasLoadMetrics(area);
  const typeOptions = AREA_TYPE_OPTIONS
    .map(type => '<option value="' + escapeHtml(type) + '"' + (type === area.type ? ' selected' : '') + '>' + escapeHtml(getAreaTypeDisplayLabel(type)) + '</option>')
    .join('');
  return '<tr data-area-id="' + escapeHtml(area.id || '') + '">' +
    '<td>' + renderAreaLabel(area, { name: area.name, fallbackName: 'Участок' }) + '</td>' +
    '<td class="areas-load-cell"><div class="production-shifts-load" title="Загрузка: ' + loadMetrics.plannedMinutes + ' / ' + loadMetrics.totalMinutes + ' мин">' + loadMetrics.loadPct + '%</div></td>' +
    '<td>' + escapeHtml(area.desc || '') + '</td>' +
    '<td><select class="area-type-select" data-id="' + area.id + '">' + typeOptions + '</select></td>' +
    '<td><div class="table-actions">' +
    '<button class="btn-small btn-secondary" data-id="' + area.id + '" data-action="edit">Изменить</button>' +
    '<button class="btn-small btn-delete" data-id="' + area.id + '" data-action="delete">🗑️</button>' +
    '</div></td>' +
    '</tr>';
}

function findAreasTableBody() {
  return document.querySelector('#areas-table-wrapper tbody');
}

function findAreaRow(areaId) {
  const tbody = findAreasTableBody();
  if (!tbody || !areaId) return null;
  return tbody.querySelector(`tr[data-area-id="${CSS.escape(String(areaId))}"]`);
}

function bindAreasRowControls(root) {
  if (!root) return;
  root.querySelectorAll('button[data-id]').forEach(btn => {
    if (btn.dataset.bound === 'true') return;
    btn.dataset.bound = 'true';
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      const action = btn.getAttribute('data-action');
      const area = areas.find(a => a.id === id);
      if (!area) return;
      if (action === 'edit') {
        startAreaEdit(area);
        return;
      }
      if (confirm('Удалить участок?')) {
        const prevAreas = areas.map(item => ({ ...item }));
        areas = areas.filter(a => a.id !== id);
        const saved = await saveData();
        if (saved === false) {
          areas = prevAreas;
          renderAreasTable();
          return;
        }
        const form = document.getElementById('areas-form');
        if (form && form.dataset.editingId === id) {
          resetAreasForm();
        }
        renderAreasTable();
      }
    });
  });

  root.querySelectorAll('select.area-type-select').forEach(select => {
    if (select.dataset.bound === 'true') return;
    select.dataset.bound = 'true';
    select.addEventListener('change', async () => {
      const id = select.getAttribute('data-id');
      const area = areas.find(item => item.id === id);
      if (!area) return;
      const prevType = normalizeAreaType(area.type);
      const nextType = normalizeAreaType(select.value);
      if (prevType === nextType) return;
      area.type = nextType;
      const saved = await saveData();
      if (saved === false) {
        area.type = prevType;
        select.value = prevType;
        return;
      }
      renderAreasTable();
      if ((window.location.pathname || '') === '/operations' && typeof renderOperationsTable === 'function') {
        renderOperationsTable();
      }
    });
  });
}

function insertAreaRowLive(area) {
  const tbody = findAreasTableBody();
  if (!tbody || !area?.id) return false;
  if (findAreaRow(area.id)) return updateAreaRowLive(area);
  const emptyState = document.querySelector('#areas-table-wrapper > p');
  if (emptyState) {
    renderAreasTable();
    return true;
  }
  tbody.insertAdjacentHTML('beforeend', buildAreaRowHtml(area));
  bindAreasRowControls(findAreaRow(area.id));
  return true;
}

function updateAreaRowLive(area) {
  const tbody = findAreasTableBody();
  const current = findAreaRow(area?.id);
  if (!tbody || !area?.id) return false;
  if (!current) return insertAreaRowLive(area);
  current.outerHTML = buildAreaRowHtml(area);
  bindAreasRowControls(findAreaRow(area.id));
  return true;
}

function removeAreaRowLive(areaId) {
  const wrapper = document.getElementById('areas-table-wrapper');
  const current = findAreaRow(areaId);
  if (!wrapper || !current) return false;
  current.remove();
  if (!findAreasTableBody()?.querySelector('tr[data-area-id]')) {
    wrapper.innerHTML = '<p>Список участков пуст.</p>';
  }
  return true;
}

function syncAreaRowLive(area) {
  if (!area?.id) return false;
  const existing = findAreaRow(area.id);
  if (existing) return updateAreaRowLive(area);
  return insertAreaRowLive(area);
}

function renderAreasTable() {
  const wrapper = document.getElementById('areas-table-wrapper');
  if (!wrapper) return;
  if (!areas.length) {
    wrapper.innerHTML = '<p>Список участков пуст.</p>';
    return;
  }
  let html = '<table><thead><tr><th>Название участка</th><th>Процент загрузки</th><th>Описание</th><th>Тип участка</th><th>Действия</th></tr></thead><tbody>';
  areas.forEach(rawArea => {
    html += buildAreaRowHtml(rawArea);
  });
  html += '</tbody></table>';
  wrapper.innerHTML = html;
  bindAreasRowControls(wrapper);
}

function renderAreasPage() {
  ensureAreasLoadFiltersState();
  bindAreasLoadFilters();
  const form = document.getElementById('areas-form');
  if (form && form.dataset.bound !== 'true') {
    form.dataset.bound = 'true';
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const name = document.getElementById('areas-name').value.trim();
      const desc = document.getElementById('areas-desc').value.trim();
      const type = normalizeAreaType(document.getElementById('areas-type').value);
      if (!name) return;
      const prevAreas = areas.map(item => ({ ...item }));
      const editingId = form.dataset.editingId;
      if (editingId) {
        const target = areas.find(a => a.id === editingId);
        if (target) {
          target.name = name;
          target.desc = desc;
          target.type = type;
        }
      } else {
        areas.push(normalizeArea({ id: genId('area'), name, desc, type }));
      }
      const saved = await saveData();
      if (saved === false) {
        areas = prevAreas;
        renderAreasTable();
        return;
      }
      renderAreasTable();
      resetAreasForm();
    });
  }
  const cancelBtn = document.getElementById('areas-cancel');
  if (cancelBtn && cancelBtn.dataset.bound !== 'true') {
    cancelBtn.dataset.bound = 'true';
    cancelBtn.addEventListener('click', () => resetAreasForm());
  }

  ensureAreaTypes();
  resetAreasForm();
  syncAreasLoadDateInputs();
  renderAreasLoadShiftButtons();
  renderAreasTable();
}

function renderEmployeesPage() {
  const wrapper = document.getElementById('employees-table-wrapper');
  if (!wrapper) return;
  const employees = (users || []).filter(user => {
    const name = String(user?.name || user?.username || '').trim().toLowerCase();
    const login = String(user?.login || '').trim().toLowerCase();
    return name && name !== 'abyss' && login !== 'abyss';
  });
  if (!employees.length) {
    wrapper.innerHTML = '<p>Сотрудники не найдены.</p>';
    return;
  }
  let html = '<table><thead><tr><th>ФИО</th><th>Роль/статус</th><th>Подразделение</th></tr></thead><tbody>';
  employees.forEach(user => {
    const deptId = user.departmentId || '';
    const options = ['<option value="">— не выбрано —</option>'].concat((centers || []).map(center => '<option value="' + center.id + '"' + (center.id === deptId ? ' selected' : '') + '>' + escapeHtml(center.name || '') + '</option>'));
    html += '<tr>' +
      '<td>' + escapeHtml(user.name || user.username || '') + '</td>' +
      '<td>' + escapeHtml(getUserAccessStatusLabel(user) || '') + '</td>' +
      '<td><select class="employee-department-select" data-id="' + user.id + '">' + options.join('') + '</select></td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  wrapper.innerHTML = html;

  if (wrapper.dataset.boundEmployees !== 'true') {
    wrapper.dataset.boundEmployees = 'true';
    wrapper.addEventListener('change', onEmployeesDepartmentChange);
  }
}

async function onEmployeesDepartmentChange(e) {
  const wrapper = document.getElementById('employees-table-wrapper');
  if (!wrapper) return;
  const select = e.target;
  if (!select || !select.classList || !select.classList.contains('employee-department-select')) return;

  const userId = select.getAttribute('data-id');
  const currentUser = (users || []).find(u => String(u.id) === String(userId));
  if (!currentUser) return;

  const allSelects = wrapper.querySelectorAll('select.employee-department-select');
  allSelects.forEach(s => (s.disabled = true));

  const value = select.value || '';
  try {
    currentUser.departmentId = value ? value : null;
    await saveData();
  } finally {
    allSelects.forEach(s => (s.disabled = false));
  }
}
