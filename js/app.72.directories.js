// === СПРАВОЧНИКИ ===
function renderCentersTable() {
  const wrapper = document.getElementById('centers-table-wrapper');
  if (!centers.length) {
    wrapper.innerHTML = '<p>Список подразделений пуст.</p>';
    return;
  }
  let html = '<table><thead><tr><th>Название</th><th>Описание</th><th>Действия</th></tr></thead><tbody>';
  centers.forEach(center => {
    html += '<tr>' +
      '<td>' + escapeHtml(center.name) + '</td>' +
      '<td>' + escapeHtml(center.desc || '') + '</td>' +
      '<td><div class="table-actions">' +
      '<button class="btn-small btn-secondary" data-id="' + center.id + '" data-action="edit">Изменить</button>' +
      '<button class="btn-small btn-danger" data-id="' + center.id + '" data-action="delete">Удалить</button>' +
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
        startCenterEdit(center);
        return;
      }
      if (confirm('Удалить подразделение? Он останется в уже созданных маршрутах как текст.')) {
        centers = centers.filter(c => c.id !== id);
        saveData();
        const centerForm = document.getElementById('center-form');
        if (centerForm && centerForm.dataset.editingId === id) {
          resetCenterForm();
        }
        renderCentersTable();
        fillRouteSelectors();
      }
    });
  });
}

function renderOpsTable() {
  const wrapper = document.getElementById('ops-table-wrapper');
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
      '<button class="btn-small btn-danger" data-id="' + o.id + '" data-action="delete">Удалить</button>' +
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
        startOpEdit(op);
        return;
      }
      if (confirm('Удалить операцию? Она останется в уже созданных маршрутах как текст.')) {
        ops = ops.filter(o => o.id !== id);
        saveData();
        const opForm = document.getElementById('op-form');
        if (opForm && opForm.dataset.editingId === id) {
          resetOpForm();
        }
        renderOpsTable();
        fillRouteSelectors();
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
      renderOpsTable();
      renderRouteTableDraft();
      renderWorkordersTable({ collapseAll: true });
      renderCardsTable();
    });
  });
}

