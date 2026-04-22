// === СТРАНИЦЫ СПРАВОЧНИКОВ ===
let departmentsSortKey = '';
let departmentsSortDir = 'asc';
let employeesSortKey = '';
let employeesSortDir = 'asc';

function getDepartmentEmployeeCount(centerId) {
  const normalizedId = (centerId || '').trim();
  if (!normalizedId) return 0;
  return (users || []).filter(user => {
    const name = (user?.name || user?.username || '').trim();
    if (!name || name.toLowerCase() === 'abyss') return false;
    return (user?.departmentId || '').trim() === normalizedId;
  }).length;
}

function countCardsReferencingDepartment(centerId) {
  const normalizedId = (centerId || '').trim();
  if (!normalizedId) return 0;
  return (cards || []).reduce((count, card) => {
    if (!card || !Array.isArray(card.operations)) return count;
    const hasReference = card.operations.some(routeOp => (
      routeOp
      && String(routeOp.centerId || '').trim() === normalizedId
    ));
    return hasReference ? count + 1 : count;
  }, 0);
}

function getAreaDeleteBlockInfo(area) {
  const areaId = String(area?.id || '').trim();
  if (!areaId) {
    return {
      blocked: false,
      plannedTasksCount: 0,
      executionHistoryCount: 0,
      planningLogsCount: 0
    };
  }
  const areaNameNeedle = String(area?.name || '').trim().toLowerCase();
  const clientProductionShiftTasks = typeof productionShiftTasks !== 'undefined' && Array.isArray(productionShiftTasks)
    ? productionShiftTasks
    : [];
  const clientProductionShifts = typeof productionShifts !== 'undefined' && Array.isArray(productionShifts)
    ? productionShifts
    : [];
  const plannedTasksCount = clientProductionShiftTasks.filter(task => (
    String(task?.areaId || '').trim() === areaId
  )).length;

  const cardsWithExecutionHistory = new Set();
  const cardsWithPlanningLogs = new Set();
  (cards || []).forEach(card => {
    const cardId = String(card?.id || '').trim();
    if (!cardId) return;
    const flowLists = [
      Array.isArray(card?.flow?.items) ? card.flow.items : [],
      Array.isArray(card?.flow?.samples) ? card.flow.samples : []
    ];
    const hasExecutionHistory = flowLists.some(list => list.some(item => (
      Array.isArray(item?.history)
      && item.history.some(entry => (
        String(entry?.areaId || '').trim() === areaId
        && ['GOOD', 'DEFECT', 'DELAYED'].includes(String(entry?.status || '').trim().toUpperCase())
      ))
    )));
    if (hasExecutionHistory) {
      cardsWithExecutionHistory.add(cardId);
    }
    if (areaNameNeedle) {
      const hasPlanningLog = (Array.isArray(card?.logs) ? card.logs : []).some(entry => {
        const field = String(entry?.field || '').trim().toLowerCase();
        if (field !== 'planning' && field !== 'subcontractchain') return false;
        const oldValue = String(entry?.oldValue || '').trim().toLowerCase();
        const newValue = String(entry?.newValue || '').trim().toLowerCase();
        return oldValue.includes(areaNameNeedle) || newValue.includes(areaNameNeedle);
      });
      if (hasPlanningLog) {
        cardsWithPlanningLogs.add(cardId);
      }
    }
  });

  const shiftLogRefsCount = clientProductionShifts.reduce((sum, shift) => (
    sum + (Array.isArray(shift?.logs) ? shift.logs.filter(entry => {
      const field = String(entry?.field || '').trim().toLowerCase();
      const oldValue = String(entry?.oldValue || '').trim();
      const newValue = String(entry?.newValue || '').trim();
      if (field === 'shiftcell') {
        return oldValue.includes(areaId) || newValue.includes(areaId);
      }
      if (field === 'subcontractchain' && areaNameNeedle) {
        return oldValue.toLowerCase().includes(areaNameNeedle) || newValue.toLowerCase().includes(areaNameNeedle);
      }
      return false;
    }).length : 0)
  ), 0);

  return {
    blocked: plannedTasksCount > 0 || cardsWithExecutionHistory.size > 0 || cardsWithPlanningLogs.size > 0 || shiftLogRefsCount > 0,
    plannedTasksCount,
    executionHistoryCount: cardsWithExecutionHistory.size,
    planningLogsCount: cardsWithPlanningLogs.size + shiftLogRefsCount
  };
}

function buildAreaDeleteBlockedMessage(blockInfo = {}) {
  const reasons = [];
  if ((blockInfo?.plannedTasksCount || 0) > 0) {
    reasons.push('есть записи планирования (' + blockInfo.plannedTasksCount + ')');
  }
  if ((blockInfo?.executionHistoryCount || 0) > 0) {
    reasons.push('есть история выполнения (' + blockInfo.executionHistoryCount + ')');
  }
  if ((blockInfo?.planningLogsCount || 0) > 0) {
    reasons.push('есть записи в логах (' + blockInfo.planningLogsCount + ')');
  }
  if (!reasons.length) {
    return 'Нельзя удалить участок: есть история планирования или выполнения.';
  }
  return 'Нельзя удалить участок: ' + reasons.join(', ') + '.';
}

function showDirectoryActionMessage(message = '') {
  const text = String(message || '').trim();
  if (!text) return;
  if (typeof showToast === 'function') {
    showToast(text);
    return;
  }
  alert(text);
}

function captureDirectoryRouteContext() {
  return typeof captureClientWriteRouteContext === 'function'
    ? captureClientWriteRouteContext()
    : { fullPath: (window.location.pathname + window.location.search) || '/' };
}

async function refreshDirectoriesForInvalidState(message, reason = 'invalid-state', routeContext = null) {
  showDirectoryActionMessage(message);
  if (typeof refreshDirectoriesMutationAfterConflict === 'function') {
    await refreshDirectoriesMutationAfterConflict({
      routeContext: routeContext || captureDirectoryRouteContext(),
      reason,
      guardKey: `directoriesInvalidState:${reason}`
    });
  }
}

function cleanupDirectoryEditingStateAfterRejected(entity = '', entityId = '') {
  const normalizedEntity = String(entity || '').trim().toLowerCase();
  const normalizedId = String(entityId || '').trim();
  if (!normalizedId) return;

  const maybeResetForm = (formId, list, resetFn) => {
    const form = document.getElementById(formId);
    if (!form || String(form.dataset.editingId || '').trim() !== normalizedId) return;
    const currentEntity = Array.isArray(list)
      ? list.find(item => String(item?.id || '').trim() === normalizedId) || null
      : null;
    const expectedRev = parseInt(form.dataset.expectedRev || '', 10) || null;
    const currentRev = currentEntity && typeof getDirectoryEntityRev === 'function'
      ? getDirectoryEntityRev(currentEntity)
      : null;
    if (!currentEntity || (Number.isFinite(expectedRev) && Number.isFinite(currentRev) && currentRev !== expectedRev)) {
      resetFn();
    }
  };

  if (normalizedEntity === 'directory.department') {
    maybeResetForm('departments-form', centers, resetDepartmentsForm);
    return;
  }
  if (normalizedEntity === 'directory.operation') {
    maybeResetForm('operations-form', ops, resetOperationsForm);
    return;
  }
  if (normalizedEntity === 'directory.area') {
    maybeResetForm('areas-form', areas, resetAreasForm);
  }
}

async function runDirectoryWriteAction({
  action = 'directory-write',
  writePath = '',
  entity = '',
  entityId = '',
  expectedRev = null,
  request,
  defaultErrorMessage = 'Не удалось выполнить действие со справочником.',
  defaultConflictMessage = '',
  onSuccess = null
} = {}) {
  const routeContext = captureDirectoryRouteContext();
  return runClientWriteRequest({
    action,
    writePath,
    entity,
    entityId,
    expectedRev,
    request,
    routeContext,
    defaultErrorMessage,
    defaultConflictMessage,
    onSuccess: async ({ payload, routeContext: successRouteContext }) => {
      if (typeof applyDirectorySlicePayload === 'function') {
        applyDirectorySlicePayload(payload);
      }
      if (typeof onSuccess === 'function') {
        await onSuccess({ payload, routeContext: successRouteContext });
      }
    },
    onConflict: async ({ payload, message }) => {
      if (typeof applyDirectorySlicePayload === 'function') {
        applyDirectorySlicePayload(payload);
      }
      showDirectoryActionMessage(message || defaultConflictMessage || defaultErrorMessage);
    },
    conflictRefresh: async ({ routeContext: conflictRouteContext }) => {
      if (typeof refreshDirectoriesMutationAfterConflict === 'function') {
        await refreshDirectoriesMutationAfterConflict({
          routeContext: conflictRouteContext,
          reason: action,
          guardKey: `directoriesConflict:${action}`
        });
      }
      cleanupDirectoryEditingStateAfterRejected(entity, entityId);
    },
    onError: async ({ res, message, routeContext: errorRouteContext }) => {
      showDirectoryActionMessage(message || defaultErrorMessage);
      if (res?.status === 404 && typeof refreshDirectoriesMutationAfterConflict === 'function') {
        await refreshDirectoriesMutationAfterConflict({
          routeContext: errorRouteContext,
          reason: `${action}:not-found`,
          guardKey: `directoriesNotFound:${action}`
        });
        cleanupDirectoryEditingStateAfterRejected(entity, entityId);
      }
    }
  });
}

function resetDepartmentsForm() {
  const form = document.getElementById('departments-form');
  if (!form) return;
  form.dataset.editingId = '';
  form.dataset.expectedRev = '';
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
  form.dataset.expectedRev = String(typeof getDirectoryEntityRev === 'function' ? getDirectoryEntityRev(center) : 1);
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
  let departments = [...centers];
  if (departmentsSortKey === 'name') {
    departments = sortCardsByKey(departments, 'name', departmentsSortDir, center => center?.name || '');
  } else if (departmentsSortKey === 'employees') {
    departments = sortCardsByKey(departments, 'employees', departmentsSortDir, center => getDepartmentEmployeeCount(center?.id));
  }
  let html = '<table><thead><tr>' +
    '<th class="th-sortable" data-sort-key="name">Название</th>' +
    '<th>Описание</th>' +
    '<th class="th-sortable" data-sort-key="employees">Сотрудники</th>' +
    '<th>Действия</th>' +
    '</tr></thead><tbody>';
  departments.forEach(center => {
    html += buildDepartmentRowHtml(center);
  });
  html += '</tbody></table>';
  wrapper.innerHTML = html;
  updateTableSortUI(wrapper, departmentsSortKey, departmentsSortDir);
  bindDepartmentsRowControls(wrapper);
  if (wrapper.dataset.boundSort !== 'true') {
    wrapper.dataset.boundSort = 'true';
    wrapper.addEventListener('click', event => {
      const th = event.target.closest('th.th-sortable');
      if (!th || !wrapper.contains(th)) return;
      const key = th.getAttribute('data-sort-key') || '';
      if (!key) return;
      if (departmentsSortKey === key) {
        departmentsSortDir = departmentsSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        departmentsSortKey = key;
        departmentsSortDir = key === 'employees' ? 'desc' : 'asc';
      }
      renderDepartmentsTable();
    });
  }
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
      if (editingId && !centers.find(c => c.id === editingId)) {
        await refreshDirectoriesForInvalidState('Подразделение уже было изменено другим пользователем. Данные обновлены.', 'department-form-missing');
        resetDepartmentsForm();
        return;
      }
      const expectedRev = editingId
        ? (parseInt(form.dataset.expectedRev || '', 10) || 1)
        : null;
      const writePath = editingId
        ? '/api/directories/departments/' + encodeURIComponent(editingId)
        : '/api/directories/departments';
      const result = await runDirectoryWriteAction({
        action: editingId ? 'department.update' : 'department.create',
        writePath,
        entity: 'directory.department',
        entityId: editingId,
        expectedRev,
        request: () => (
          editingId
            ? updateDepartmentCommand(editingId, { name, desc, expectedRev })
            : createDepartmentCommand({ name, desc })
        ),
        defaultErrorMessage: editingId
          ? 'Не удалось сохранить подразделение.'
          : 'Не удалось создать подразделение.',
        defaultConflictMessage: 'Подразделение уже было изменено другим пользователем. Данные обновлены.',
        onSuccess: async ({ payload }) => {
          const savedDepartment = payload?.department || null;
          if (savedDepartment && typeof updateCenterReferences === 'function') {
            updateCenterReferences(savedDepartment);
          }
          renderDepartmentsTable();
          fillRouteSelectors();
          if (activeCardDraft) {
            renderRouteTableDraft();
          }
          renderCardsTable();
          renderWorkordersTable({ collapseAll: true });
          renderEmployeesPage();
          resetDepartmentsForm();
          showDirectoryActionMessage(editingId ? 'Подразделение сохранено.' : 'Подразделение создано.');
        }
      });
      if (result?.ok) {
        return;
      }
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
  form.dataset.expectedRev = '';
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
  form.dataset.expectedRev = String(typeof getDirectoryEntityRev === 'function' ? getDirectoryEntityRev(op) : 1);
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

function countCardsReferencingOperation(opId) {
  const targetId = String(opId || '').trim();
  if (!targetId) return 0;
  return (cards || []).reduce((count, card) => {
    if (!card || !Array.isArray(card.operations)) return count;
    const hasReference = card.operations.some(routeOp => (
      routeOp
      && String(routeOp.opId || '').trim() === targetId
    ));
    return hasReference ? count + 1 : count;
  }, 0);
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
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      const action = btn.getAttribute('data-action');
      const op = ops.find(v => v.id === id);
      if (!op) {
        await refreshDirectoriesForInvalidState('Операция уже была изменена другим пользователем. Данные обновлены.', 'operation-row-missing');
        return;
      }
      if (action === 'edit') {
        startOperationEdit(op);
        return;
      }
      const referencingCards = countCardsReferencingOperation(id);
      if (referencingCards > 0) {
        showDirectoryActionMessage('Нельзя удалить операцию: она используется в маршрутных картах (' + referencingCards + ').');
        return;
      }
      if (confirm('Удалить операцию?')) {
        const expectedRev = typeof getDirectoryEntityRev === 'function' ? getDirectoryEntityRev(op) : 1;
        await runDirectoryWriteAction({
          action: 'operation.delete',
          writePath: '/api/directories/operations/' + encodeURIComponent(id),
          entity: 'directory.operation',
          entityId: id,
          expectedRev,
          request: () => deleteOperationCommand(id, { expectedRev }),
          defaultErrorMessage: 'Не удалось удалить операцию.',
          defaultConflictMessage: 'Операция уже была изменена другим пользователем. Данные обновлены.',
          onSuccess: async () => {
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
            showDirectoryActionMessage('Операция удалена.');
          }
        });
      }
    });
  });

  root.querySelectorAll('select.op-type-select').forEach(select => {
    if (select.dataset.bound === 'true') return;
    select.dataset.bound = 'true';
    select.addEventListener('change', async () => {
      const id = select.getAttribute('data-id');
      const op = ops.find(v => v.id === id);
      if (!op) {
        await refreshDirectoriesForInvalidState('Операция уже была изменена другим пользователем. Данные обновлены.', 'operation-type-missing');
        return;
      }
      const prevType = normalizeOperationType(op.operationType);
      const nextType = normalizeOperationType(select.value);
      if (prevType === nextType) return;
      const expectedRev = typeof getDirectoryEntityRev === 'function' ? getDirectoryEntityRev(op) : 1;
      const result = await runDirectoryWriteAction({
        action: 'operation.update-type',
        writePath: '/api/directories/operations/' + encodeURIComponent(id),
        entity: 'directory.operation',
        entityId: id,
        expectedRev,
        request: () => updateOperationCommand(id, {
          name: op.name || '',
          desc: op.desc || '',
          recTime: op.recTime || 30,
          operationType: nextType,
          expectedRev
        }),
        defaultErrorMessage: 'Не удалось изменить тип операции.',
        defaultConflictMessage: 'Операция уже была изменена другим пользователем. Данные обновлены.',
        onSuccess: async ({ payload }) => {
          const savedOperation = payload?.operation || null;
          if (savedOperation && typeof updateOperationReferences === 'function') {
            updateOperationReferences(savedOperation);
          }
          ensureOperationTypes();
          renderOperationsTable();
          renderRouteTableDraft();
          renderWorkordersTable({ collapseAll: true });
          renderCardsTable();
          showDirectoryActionMessage('Тип операции сохранён.');
        }
      });
      if (!result?.ok) {
        select.value = prevType;
      }
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
    wrapper.addEventListener('click', async event => {
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
        if (!op || !areaId) {
          await refreshDirectoriesForInvalidState('Операция уже была изменена другим пользователем. Данные обновлены.', 'operation-area-remove-missing');
          return;
        }
        const area = (areas || []).find(item => item.id === areaId);
        const areaName = area ? area.name || '' : '';
        if (!confirm('Удалить участок «' + areaName + '» из операции?')) return;
        const expectedRev = typeof getDirectoryEntityRev === 'function' ? getDirectoryEntityRev(op) : 1;
        await runDirectoryWriteAction({
          action: 'operation-area.remove',
          writePath: '/api/directories/operations/' + encodeURIComponent(id) + '/areas/' + encodeURIComponent(areaId),
          entity: 'directory.operation',
          entityId: id,
          expectedRev,
          request: () => removeOperationAreaBindingCommand(id, areaId, { expectedRev }),
          defaultErrorMessage: 'Не удалось удалить участок из операции.',
          defaultConflictMessage: 'Операция уже была изменена другим пользователем. Данные обновлены.',
          onSuccess: async () => {
            renderOperationsTable();
            showDirectoryActionMessage('Участок удалён: ' + areaName);
          }
        });
      }
    });
    wrapper.addEventListener('change', async event => {
      const picker = event.target.closest('.op-areas-picker');
      if (!picker) return;
      const areaId = picker.value;
      if (!areaId) return;
      const id = picker.getAttribute('data-id');
      const op = ops.find(v => v.id === id);
      if (!op) {
        picker.value = '';
        await refreshDirectoriesForInvalidState('Операция уже была изменена другим пользователем. Данные обновлены.', 'operation-area-add-missing');
        return;
      }
      const nextIds = normalizeAllowedAreaIds(op.allowedAreaIds);
      if (nextIds.includes(areaId)) {
        picker.value = '';
        showDirectoryActionMessage('Участок уже добавлен в операцию.');
        renderOperationsTable();
        return;
      }
      const area = (areas || []).find(item => item.id === areaId);
      const areaName = area ? area.name || '' : '';
      const expectedRev = typeof getDirectoryEntityRev === 'function' ? getDirectoryEntityRev(op) : 1;
      await runDirectoryWriteAction({
        action: 'operation-area.add',
        writePath: '/api/directories/operations/' + encodeURIComponent(id) + '/areas',
        entity: 'directory.operation',
        entityId: id,
        expectedRev,
        request: () => addOperationAreaBindingCommand(id, { areaId, expectedRev }),
        defaultErrorMessage: 'Не удалось добавить участок в операцию.',
        defaultConflictMessage: 'Операция уже была изменена другим пользователем. Данные обновлены.',
        onSuccess: async () => {
          renderOperationsTable();
          showDirectoryActionMessage('Участок добавлен: ' + areaName);
        }
      });
      picker.value = '';
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
      const editingId = form.dataset.editingId;
      const duplicate = findOperationDuplicateByName(name, editingId);
      if (duplicate) {
        showDirectoryActionMessage('Операция с таким названием уже существует.');
        return;
      }
      if (editingId && !ops.find(o => o.id === editingId)) {
        await refreshDirectoriesForInvalidState('Операция уже была изменена другим пользователем. Данные обновлены.', 'operation-form-missing');
        resetOperationsForm();
        return;
      }
      const expectedRev = editingId
        ? (parseInt(form.dataset.expectedRev || '', 10) || 1)
        : null;
      const result = await runDirectoryWriteAction({
        action: editingId ? 'operation.update' : 'operation.create',
        writePath: editingId
          ? '/api/directories/operations/' + encodeURIComponent(editingId)
          : '/api/directories/operations',
        entity: 'directory.operation',
        entityId: editingId,
        expectedRev,
        request: () => (
          editingId
            ? updateOperationCommand(editingId, { name, desc, recTime: time, operationType: type, expectedRev })
            : createOperationCommand({ name, desc, recTime: time, operationType: type })
        ),
        defaultErrorMessage: editingId
          ? 'Не удалось сохранить операцию.'
          : 'Не удалось создать операцию.',
        defaultConflictMessage: 'Операция уже была изменена другим пользователем. Данные обновлены.',
        onSuccess: async ({ payload }) => {
          const savedOperation = payload?.operation || null;
          if (savedOperation && typeof updateOperationReferences === 'function') {
            updateOperationReferences(savedOperation);
          }
          ensureOperationTypes();
          renderOperationsTable();
          fillRouteSelectors();
          if (activeCardDraft) {
            renderRouteTableDraft();
          }
          renderCardsTable();
          renderWorkordersTable({ collapseAll: true });
          resetOperationsForm();
          showDirectoryActionMessage(editingId ? 'Операция сохранена.' : 'Операция создана.');
        }
      });
      if (result?.ok) {
        return;
      }
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
  form.dataset.expectedRev = '';
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
  form.dataset.expectedRev = String(typeof getDirectoryEntityRev === 'function' ? getDirectoryEntityRev(area) : 1);
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

function buildDepartmentRowHtml(center) {
  const count = getDepartmentEmployeeCount(center.id);
  return '<tr data-department-id="' + escapeHtml(center.id || '') + '">' +
    '<td>' + escapeHtml(center.name || '') + '</td>' +
    '<td>' + escapeHtml(center.desc || '') + '</td>' +
    '<td>' + count + '</td>' +
    '<td><div class="table-actions">' +
    '<button class="btn-small btn-secondary" data-id="' + center.id + '" data-action="edit">Изменить</button>' +
    '<button class="btn-small btn-delete" data-id="' + center.id + '" data-action="delete">🗑️</button>' +
    '</div></td>' +
    '</tr>';
}

function findDepartmentsTableBody() {
  return document.querySelector('#departments-table-wrapper tbody');
}

function findDepartmentRow(centerId) {
  const tbody = findDepartmentsTableBody();
  if (!tbody || !centerId) return null;
  return tbody.querySelector(`tr[data-department-id="${CSS.escape(String(centerId))}"]`);
}

function bindDepartmentsRowControls(root) {
  if (!root) return;
  root.querySelectorAll('button[data-id]').forEach(btn => {
    if (btn.dataset.bound === 'true') return;
    btn.dataset.bound = 'true';
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      const action = btn.getAttribute('data-action');
      const center = centers.find(c => c.id === id);
      if (!center) {
        await refreshDirectoriesForInvalidState('Подразделение уже было изменено другим пользователем. Данные обновлены.', 'department-row-missing');
        return;
      }
      if (action === 'edit') {
        startDepartmentEdit(center);
        return;
      }
      const count = getDepartmentEmployeeCount(center.id);
      if (count > 0) {
        showDirectoryActionMessage('Нельзя удалить подразделение: есть сотрудники (' + count + ').');
        return;
      }
      const referencingCards = countCardsReferencingDepartment(center.id);
      if (referencingCards > 0) {
        showDirectoryActionMessage('Нельзя удалить подразделение: оно используется в маршрутных картах (' + referencingCards + ').');
        return;
      }
      if (confirm('Удалить подразделение?')) {
        const expectedRev = typeof getDirectoryEntityRev === 'function' ? getDirectoryEntityRev(center) : 1;
        await runDirectoryWriteAction({
          action: 'department.delete',
          writePath: '/api/directories/departments/' + encodeURIComponent(id),
          entity: 'directory.department',
          entityId: id,
          expectedRev,
          request: () => deleteDepartmentCommand(id, { expectedRev }),
          defaultErrorMessage: 'Не удалось удалить подразделение.',
          defaultConflictMessage: 'Подразделение уже было изменено другим пользователем. Данные обновлены.',
          onSuccess: async () => {
            const form = document.getElementById('departments-form');
            if (form && form.dataset.editingId === id) {
              resetDepartmentsForm();
            }
            renderDepartmentsTable();
            fillRouteSelectors();
            renderEmployeesPage();
            showDirectoryActionMessage('Подразделение удалено.');
          }
        });
      }
    });
  });
}

function insertDepartmentRowLive(center) {
  const tbody = findDepartmentsTableBody();
  if (!tbody || !center?.id) return false;
  if (findDepartmentRow(center.id)) return updateDepartmentRowLive(center);
  const emptyState = document.querySelector('#departments-table-wrapper > p');
  if (emptyState) {
    renderDepartmentsTable();
    return true;
  }
  tbody.insertAdjacentHTML('beforeend', buildDepartmentRowHtml(center));
  bindDepartmentsRowControls(findDepartmentRow(center.id));
  return true;
}

function updateDepartmentRowLive(center) {
  const tbody = findDepartmentsTableBody();
  const current = findDepartmentRow(center?.id);
  if (!tbody || !center?.id) return false;
  if (!current) return insertDepartmentRowLive(center);
  current.outerHTML = buildDepartmentRowHtml(center);
  bindDepartmentsRowControls(findDepartmentRow(center.id));
  return true;
}

function removeDepartmentRowLive(centerId) {
  const wrapper = document.getElementById('departments-table-wrapper');
  const current = findDepartmentRow(centerId);
  if (!wrapper || !current) return false;
  current.remove();
  if (!findDepartmentsTableBody()?.querySelector('tr[data-department-id]')) {
    wrapper.innerHTML = '<p>Список подразделений пуст.</p>';
  }
  return true;
}

function syncDepartmentRowLive(center) {
  if (!center?.id) return false;
  const existing = findDepartmentRow(center.id);
  if (existing) return updateDepartmentRowLive(center);
  return insertDepartmentRowLive(center);
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
      if (!area) {
        await refreshDirectoriesForInvalidState('Участок уже был изменён другим пользователем. Данные обновлены.', 'area-row-missing');
        return;
      }
      if (action === 'edit') {
        startAreaEdit(area);
        return;
      }
      const deleteBlockInfo = getAreaDeleteBlockInfo(area);
      if (deleteBlockInfo.blocked) {
        showDirectoryActionMessage(buildAreaDeleteBlockedMessage(deleteBlockInfo));
        return;
      }
      if (confirm('Удалить участок?')) {
        const expectedRev = typeof getDirectoryEntityRev === 'function' ? getDirectoryEntityRev(area) : 1;
        await runDirectoryWriteAction({
          action: 'area.delete',
          writePath: '/api/directories/areas/' + encodeURIComponent(id),
          entity: 'directory.area',
          entityId: id,
          expectedRev,
          request: () => deleteAreaCommand(id, { expectedRev }),
          defaultErrorMessage: 'Не удалось удалить участок.',
          defaultConflictMessage: 'Участок уже был изменён другим пользователем. Данные обновлены.',
          onSuccess: async () => {
            const form = document.getElementById('areas-form');
            if (form && form.dataset.editingId === id) {
              resetAreasForm();
            }
            renderAreasTable();
            if ((window.location.pathname || '') === '/operations' && typeof renderOperationsTable === 'function') {
              renderOperationsTable();
            }
            showDirectoryActionMessage('Участок удалён.');
          }
        });
      }
    });
  });

  root.querySelectorAll('select.area-type-select').forEach(select => {
    if (select.dataset.bound === 'true') return;
    select.dataset.bound = 'true';
    select.addEventListener('change', async () => {
      const id = select.getAttribute('data-id');
      const area = areas.find(item => item.id === id);
      if (!area) {
        await refreshDirectoriesForInvalidState('Участок уже был изменён другим пользователем. Данные обновлены.', 'area-type-missing');
        return;
      }
      const prevType = normalizeAreaType(area.type);
      const nextType = normalizeAreaType(select.value);
      if (prevType === nextType) return;
      const expectedRev = typeof getDirectoryEntityRev === 'function' ? getDirectoryEntityRev(area) : 1;
      const result = await runDirectoryWriteAction({
        action: 'area.update-type',
        writePath: '/api/directories/areas/' + encodeURIComponent(id),
        entity: 'directory.area',
        entityId: id,
        expectedRev,
        request: () => updateAreaCommand(id, {
          name: area.name || '',
          desc: area.desc || '',
          type: nextType,
          expectedRev
        }),
        defaultErrorMessage: 'Не удалось изменить тип участка.',
        defaultConflictMessage: 'Участок уже был изменён другим пользователем. Данные обновлены.',
        onSuccess: async () => {
          renderAreasTable();
          if ((window.location.pathname || '') === '/operations' && typeof renderOperationsTable === 'function') {
            renderOperationsTable();
          }
          showDirectoryActionMessage('Тип участка сохранён.');
        }
      });
      if (!result?.ok) {
        select.value = prevType;
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
      const editingId = form.dataset.editingId;
      if (editingId && !areas.find(a => a.id === editingId)) {
        await refreshDirectoriesForInvalidState('Участок уже был изменён другим пользователем. Данные обновлены.', 'area-form-missing');
        resetAreasForm();
        return;
      }
      const expectedRev = editingId
        ? (parseInt(form.dataset.expectedRev || '', 10) || 1)
        : null;
      const result = await runDirectoryWriteAction({
        action: editingId ? 'area.update' : 'area.create',
        writePath: editingId
          ? '/api/directories/areas/' + encodeURIComponent(editingId)
          : '/api/directories/areas',
        entity: 'directory.area',
        entityId: editingId,
        expectedRev,
        request: () => (
          editingId
            ? updateAreaCommand(editingId, { name, desc, type, expectedRev })
            : createAreaCommand({ name, desc, type })
        ),
        defaultErrorMessage: editingId
          ? 'Не удалось сохранить участок.'
          : 'Не удалось создать участок.',
        defaultConflictMessage: 'Участок уже был изменён другим пользователем. Данные обновлены.',
        onSuccess: async () => {
          renderAreasTable();
          if ((window.location.pathname || '') === '/operations' && typeof renderOperationsTable === 'function') {
            renderOperationsTable();
          }
          resetAreasForm();
          showDirectoryActionMessage(editingId ? 'Участок сохранён.' : 'Участок создан.');
        }
      });
      if (result?.ok) {
        return;
      }
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
  let employees = (users || []).filter(user => {
    const name = String(user?.name || user?.username || '').trim().toLowerCase();
    const login = String(user?.login || '').trim().toLowerCase();
    return name && name !== 'abyss' && login !== 'abyss';
  });
  if (employeesSortKey === 'name') {
    employees = sortCardsByKey(employees, 'name', employeesSortDir, user => user?.name || user?.username || '');
  } else if (employeesSortKey === 'level') {
    employees = sortCardsByKey(employees, 'level', employeesSortDir, user => getUserLevelName(user) || '');
  } else if (employeesSortKey === 'department') {
    employees = sortCardsByKey(employees, 'department', employeesSortDir, user => {
      const center = (centers || []).find(item => item.id === (user?.departmentId || ''));
      return center?.name || '';
    });
  }
  if (!employees.length) {
    wrapper.innerHTML = '<p>Сотрудники не найдены.</p>';
    return;
  }
  let html = '<table><thead><tr>' +
    '<th class="th-sortable" data-sort-key="name">ФИО</th>' +
    '<th class="th-sortable" data-sort-key="level">Уровень доступа</th>' +
    '<th class="th-sortable" data-sort-key="department">Подразделение</th>' +
    '</tr></thead><tbody>';
  employees.forEach(user => {
    const deptId = user.departmentId || '';
    const options = ['<option value="">— не выбрано —</option>'].concat((centers || []).map(center => '<option value="' + center.id + '"' + (center.id === deptId ? ' selected' : '') + '>' + escapeHtml(center.name || '') + '</option>'));
    html += '<tr>' +
      '<td>' + escapeHtml(user.name || user.username || '') + '</td>' +
      '<td>' + escapeHtml(getUserLevelName(user) || '') + '</td>' +
      '<td><select class="employee-department-select" data-id="' + user.id + '">' + options.join('') + '</select></td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  wrapper.innerHTML = html;
  updateTableSortUI(wrapper, employeesSortKey, employeesSortDir);

  if (wrapper.dataset.boundEmployees !== 'true') {
    wrapper.dataset.boundEmployees = 'true';
    wrapper.addEventListener('click', event => {
      const th = event.target.closest('th.th-sortable');
      if (!th || !wrapper.contains(th)) return;
      const key = th.getAttribute('data-sort-key') || '';
      if (!key) return;
      if (employeesSortKey === key) {
        employeesSortDir = employeesSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        employeesSortKey = key;
        employeesSortDir = 'asc';
      }
      renderEmployeesPage();
    });
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
