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
    btn.addEventListener('click', () => {
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
        saveData();
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
    form.addEventListener('submit', e => {
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

function renderOperationsTable() {
  const wrapper = document.getElementById('operations-table-wrapper');
  if (!wrapper) return;
  if (!ops.length) {
    wrapper.innerHTML = '<p>Список операций пуст.</p>';
    return;
  }
  let html = '<table><thead><tr><th>Название</th><th>Описание</th><th>Тип</th><th>Рек. время (мин)</th><th>Действия</th></tr></thead><tbody>';
  ops.forEach(o => {
    const opType = normalizeOperationType(o.operationType);
    const typeOptions = OPERATION_TYPE_OPTIONS.map(type => '<option value="' + escapeHtml(type) + '"' + (type === opType ? ' selected' : '') + '>' + escapeHtml(type) + '</option>').join('');
    html += '<tr>' +
      '<td>' + escapeHtml(o.name) + '</td>' +
      '<td>' + escapeHtml(o.desc || '') + '</td>' +
      '<td><select class="op-type-select" data-id="' + o.id + '">' + typeOptions + '</select></td>' +
      '<td>' + (o.recTime || '') + '</td>' +
      '<td><div class="table-actions">' +
      '<button class="btn-small btn-secondary" data-id="' + o.id + '" data-action="edit">Изменить</button>' +
      '<button class="btn-small btn-delete" data-id="' + o.id + '" data-action="delete">🗑️</button>' +
      '</div></td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  wrapper.innerHTML = html;

  wrapper.querySelectorAll('button[data-id]').forEach(btn => {
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

  wrapper.querySelectorAll('select.op-type-select').forEach(select => {
    select.addEventListener('change', () => {
      const id = select.getAttribute('data-id');
      const op = ops.find(v => v.id === id);
      if (!op) return;
      op.operationType = normalizeOperationType(select.value);
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

function renderOperationsPage() {
  const form = document.getElementById('operations-form');
  if (form && form.dataset.bound !== 'true') {
    form.dataset.bound = 'true';
    form.addEventListener('submit', e => {
      e.preventDefault();
      const name = document.getElementById('operations-name').value.trim();
      const desc = document.getElementById('operations-desc').value.trim();
      const time = parseInt(document.getElementById('operations-time').value, 10) || 30;
      const type = normalizeOperationType(document.getElementById('operations-type').value);
      if (!name) return;
      const editingId = form.dataset.editingId;
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
        ops.push({ id: genId('op'), name, desc, recTime: time, operationType: type });
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
  const submit = document.getElementById('areas-submit');
  const cancel = document.getElementById('areas-cancel');
  if (submit) submit.textContent = 'Добавить участок';
  if (cancel) cancel.classList.add('hidden');
}

function startAreaEdit(area) {
  const form = document.getElementById('areas-form');
  if (!form || !area) return;
  form.dataset.editingId = area.id;
  const nameInput = document.getElementById('areas-name');
  const descInput = document.getElementById('areas-desc');
  if (nameInput) nameInput.value = area.name || '';
  if (descInput) descInput.value = area.desc || '';
  const submit = document.getElementById('areas-submit');
  const cancel = document.getElementById('areas-cancel');
  if (submit) submit.textContent = 'Сохранить';
  if (cancel) cancel.classList.remove('hidden');
  if (nameInput) nameInput.focus();
}

function renderAreasTable() {
  const wrapper = document.getElementById('areas-table-wrapper');
  if (!wrapper) return;
  if (!areas.length) {
    wrapper.innerHTML = '<p>Список участков пуст.</p>';
    return;
  }
  let html = '<table><thead><tr><th>Название участка</th><th>Описание</th><th>Действия</th></tr></thead><tbody>';
  areas.forEach(area => {
    html += '<tr>' +
      '<td>' + escapeHtml(area.name) + '</td>' +
      '<td>' + escapeHtml(area.desc || '') + '</td>' +
      '<td><div class="table-actions">' +
      '<button class="btn-small btn-secondary" data-id="' + area.id + '" data-action="edit">Изменить</button>' +
      '<button class="btn-small btn-delete" data-id="' + area.id + '" data-action="delete">🗑️</button>' +
      '</div></td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  wrapper.innerHTML = html;

  wrapper.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const action = btn.getAttribute('data-action');
      const area = areas.find(a => a.id === id);
      if (!area) return;
      if (action === 'edit') {
        startAreaEdit(area);
        return;
      }
      if (confirm('Удалить участок?')) {
        areas = areas.filter(a => a.id !== id);
        saveData();
        const form = document.getElementById('areas-form');
        if (form && form.dataset.editingId === id) {
          resetAreasForm();
        }
        renderAreasTable();
      }
    });
  });
}

function renderAreasPage() {
  const form = document.getElementById('areas-form');
  if (form && form.dataset.bound !== 'true') {
    form.dataset.bound = 'true';
    form.addEventListener('submit', e => {
      e.preventDefault();
      const name = document.getElementById('areas-name').value.trim();
      const desc = document.getElementById('areas-desc').value.trim();
      if (!name) return;
      const editingId = form.dataset.editingId;
      if (editingId) {
        const target = areas.find(a => a.id === editingId);
        if (target) {
          target.name = name;
          target.desc = desc;
        }
      } else {
        areas.push({ id: genId('area'), name, desc });
      }
      saveData();
      renderAreasTable();
      resetAreasForm();
    });
  }
  const cancelBtn = document.getElementById('areas-cancel');
  if (cancelBtn && cancelBtn.dataset.bound !== 'true') {
    cancelBtn.dataset.bound = 'true';
    cancelBtn.addEventListener('click', () => resetAreasForm());
  }

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
      '<td>' + escapeHtml(user.role || user.status || '') + '</td>' +
      '<td><select class="employee-department-select" data-id="' + user.id + '">' + options.join('') + '</select></td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  wrapper.innerHTML = html;

  wrapper.querySelectorAll('select.employee-department-select').forEach(select => {
    const userId = select.getAttribute('data-id');
    const user = users.find(u => String(u.id) === String(userId));
    if (!user) return;
    select.value = user.departmentId || '';
    select.addEventListener('change', async () => {
      const currentUser = (users || []).find(u => String(u.id) === String(select.getAttribute('data-id')));
      if (!currentUser) return;
      const value = select.value || '';
      select.disabled = true;
      try {
        currentUser.departmentId = value ? value : null;
        await saveData();
        renderEmployeesPage();
        renderDepartmentsPage();
      } finally {
        select.disabled = false;
      }
    });
  });
}
