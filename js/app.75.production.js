// === ПРОИЗВОДСТВО: РАСПИСАНИЕ ===
const PRODUCTION_WEEK_DAYS = 7;
const PRODUCTION_WEEK_LABELS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

const productionScheduleState = {
  weekStart: null,
  selectedShift: 1,
  selectedCell: null,
  selectedEmployees: [],
  employeeFilter: '',
  departmentId: '',
  filterVisible: false,
  clipboard: [],
  selectedCellEmployeeId: null
};

function getProductionWeekStart(date = new Date()) {
  const base = new Date(date);
  const day = base.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  base.setHours(0, 0, 0, 0);
  base.setDate(base.getDate() + diff);
  return base;
}

function addDaysToDate(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatProductionDate(date) {
  if (typeof date === 'string') return date;
  const d = new Date(date);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getProductionWeekDates() {
  const start = productionScheduleState.weekStart || getProductionWeekStart();
  return Array.from({ length: PRODUCTION_WEEK_DAYS }, (_, idx) => addDaysToDate(start, idx));
}

function isProductionWeekend(date) {
  const day = new Date(date).getDay();
  return day === 0 || day === 6;
}

function getProductionDayLabel(date) {
  const d = new Date(date);
  const weekday = PRODUCTION_WEEK_LABELS[d.getDay()] || '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return { weekday, date: `${dd}.${mm}.${yy}` };
}

function setProductionWeekStart(date) {
  productionScheduleState.weekStart = getProductionWeekStart(date);
  resetProductionSelection();
  renderProductionSchedule();
}

function setProductionShift(shift) {
  productionScheduleState.selectedShift = shift;
  if (productionScheduleState.selectedCell) {
    productionScheduleState.selectedCell = {
      ...productionScheduleState.selectedCell,
      shift
    };
  }
  renderProductionSchedule();
}

function resetProductionSelection() {
  productionScheduleState.selectedCell = null;
  productionScheduleState.selectedEmployees = [];
  productionScheduleState.selectedCellEmployeeId = null;
}

function getProductionAssignments(date, areaId, shift) {
  return (productionSchedule || []).filter(rec => rec.date === date && rec.areaId === areaId && rec.shift === shift);
}

function getProductionEmployeeName(employeeId) {
  const user = (users || []).find(u => u.id === employeeId);
  return escapeHtml(user?.name || user?.username || 'Неизвестно');
}

function productionScheduleIsActive() {
  const section = document.getElementById('production-schedule');
  return section && section.classList.contains('active');
}

function setProductionSelectedCell(cell, employeeId = null) {
  productionScheduleState.selectedCell = cell;
  productionScheduleState.selectedCellEmployeeId = employeeId;
}

function getProductionFilterDate() {
  if (productionScheduleState.selectedCell?.date) return productionScheduleState.selectedCell.date;
  const weekStart = productionScheduleState.weekStart || getProductionWeekStart();
  return formatProductionDate(weekStart);
}

function isEmployeeAvailableForShift(employeeId) {
  const targetDate = getProductionFilterDate();
  const shift = productionScheduleState.selectedShift;
  return !(productionSchedule || []).some(rec => rec.employeeId === employeeId && rec.date === targetDate && rec.shift === shift);
}

function getFilteredProductionEmployees() {
  const deptId = productionScheduleState.departmentId;
  const search = (productionScheduleState.employeeFilter || '').toLowerCase();
  const filtered = (users || []).filter(user => {
    const name = (user?.name || user?.username || '').trim();
    if (!name) return false;
    if (deptId && user.departmentId !== deptId) return false;
    if (!isEmployeeAvailableForShift(user.id)) return false;
    if (search && !name.toLowerCase().includes(search)) return false;
    return true;
  });
  return filtered.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

function toggleProductionEmployeeSelection(id) {
  const next = new Set(productionScheduleState.selectedEmployees || []);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  productionScheduleState.selectedEmployees = Array.from(next);
  renderProductionScheduleSidebar();
}

function applyProductionEmployeeFilter(text) {
  productionScheduleState.employeeFilter = text || '';
  renderProductionScheduleSidebar();
}

function applyProductionDepartment(deptId) {
  productionScheduleState.departmentId = deptId || '';
  productionScheduleState.selectedEmployees = [];
  renderProductionScheduleSidebar();
}

function setProductionFilterVisible(flag) {
  productionScheduleState.filterVisible = flag;
  renderProductionScheduleSidebar();
}

function parseProductionTime(value) {
  if (!value || typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!/^\d{2}:\d{2}$/.test(normalized)) return null;
  const [hh, mm] = normalized.split(':').map(v => parseInt(v, 10));
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  return hh * 60 + mm;
}

function minutesToTimeString(minutes) {
  const total = ((minutes % (24 * 60)) + (24 * 60)) % (24 * 60);
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

function getShiftRange(shift) {
  const ref = (productionShiftTimes || []).find(s => s.shift === shift);
  const from = parseProductionTime(ref?.timeFrom) ?? 0;
  let to = parseProductionTime(ref?.timeTo);
  if (to == null) to = from;
  if (to <= from) to += 24 * 60;
  return { start: from, end: to };
}

function getShiftRangesForWindow(startMinutes, endMinutes) {
  if (endMinutes <= startMinutes) endMinutes += 24 * 60;
  return (productionShiftTimes || []).map(s => ({ shift: s.shift, range: getShiftRange(s.shift) }))
    .map(item => {
      const overlapStart = Math.max(item.range.start, startMinutes);
      const overlapEnd = Math.min(item.range.end, endMinutes);
      return overlapEnd > overlapStart ? { shift: item.shift, start: overlapStart, end: overlapEnd } : null;
    })
    .filter(Boolean);
}

function buildProductionAssignmentRecord({ date, areaId, shift, employeeId, timeFrom, timeTo }) {
  return { date, areaId, shift, employeeId, timeFrom, timeTo };
}

function upsertProductionAssignment(record) {
  const conflict = (productionSchedule || []).find(rec => rec.date === record.date && rec.shift === record.shift && rec.employeeId === record.employeeId);
  if (conflict && conflict.areaId !== record.areaId) {
    return { error: 'different-area' };
  }
  if (conflict && conflict.areaId === record.areaId) {
    conflict.timeFrom = record.timeFrom;
    conflict.timeTo = record.timeTo;
    return { updated: true };
  }
  productionSchedule.push(record);
  return { created: true };
}

function addEmployeesToProductionCell() {
  const cell = productionScheduleState.selectedCell;
  if (!cell) {
    alert('Выберите ячейку расписания');
    return;
  }
  const employeeIds = productionScheduleState.selectedEmployees || [];
  if (!employeeIds.length) {
    alert('Выберите сотрудников в панели справа');
    return;
  }
  const fullShift = Boolean(document.getElementById('production-full-shift')?.checked);
  const rawFrom = document.getElementById('production-time-from')?.value || null;
  const rawTo = document.getElementById('production-time-to')?.value || null;
  const fromMinutes = parseProductionTime(rawFrom);
  const toMinutes = parseProductionTime(rawTo);

  const created = [];
  const skipped = [];

  employeeIds.forEach(empId => {
    const targets = [];
    if (fullShift || fromMinutes == null || toMinutes == null) {
      targets.push({ shift: cell.shift, start: null, end: null });
    } else {
      targets.push(...getShiftRangesForWindow(fromMinutes, toMinutes));
    }

    targets.forEach(target => {
      const record = buildProductionAssignmentRecord({
        date: cell.date,
        areaId: cell.areaId,
        shift: target.shift || cell.shift,
        employeeId: empId,
        timeFrom: target.start == null ? null : minutesToTimeString(target.start),
        timeTo: target.end == null ? null : minutesToTimeString(target.end)
      });
      const result = upsertProductionAssignment(record);
      if (result.error) {
        skipped.push(empId);
      } else {
        created.push(empId);
      }
    });
  });

  saveData();
  renderProductionSchedule();
  if (skipped.length) {
    showToast('Некоторые сотрудники уже назначены в другую ячейку этой смены');
  } else if (created.length) {
    showToast('Сотрудники добавлены в расписание');
  }
}

function deleteProductionAssignments() {
  const cell = productionScheduleState.selectedCell;
  if (!cell) return;
  const { date, areaId, shift } = cell;
  const employeeId = productionScheduleState.selectedCellEmployeeId;
  const before = productionSchedule.length;
  productionSchedule = productionSchedule.filter(rec => {
    if (rec.date !== date || rec.areaId !== areaId || rec.shift !== shift) return true;
    if (employeeId && rec.employeeId !== employeeId) return true;
    return false;
  });
  const removed = before !== productionSchedule.length;
  productionScheduleState.selectedCellEmployeeId = null;
  if (removed) {
    saveData();
    renderProductionSchedule();
  }
}

function copyProductionCell() {
  const cell = productionScheduleState.selectedCell;
  if (!cell) return;
  productionScheduleState.clipboard = getProductionAssignments(cell.date, cell.areaId, cell.shift).map(rec => ({ ...rec }));
}

function pasteProductionCell() {
  const cell = productionScheduleState.selectedCell;
  if (!cell || !(productionScheduleState.clipboard || []).length) return;
  const copied = productionScheduleState.clipboard || [];
  const conflicts = [];
  copied.forEach(item => {
    const record = { ...item, date: cell.date, areaId: cell.areaId, shift: cell.shift };
    const result = upsertProductionAssignment(record);
    if (result.error) conflicts.push(record.employeeId);
  });
  saveData();
  renderProductionSchedule();
  if (conflicts.length) {
    showToast('Некоторые сотрудники уже заняты в этой смене');
  }
}

function renderProductionWeekTable() {
  const wrapper = document.getElementById('production-schedule-table');
  if (!wrapper) return;
  const dates = getProductionWeekDates();
  const areasList = (areas || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  if (!areasList.length) {
    wrapper.innerHTML = '<p class="muted">Нет участков для отображения расписания.</p>';
    return;
  }

  const headerCells = dates.map((date, idx) => {
    const { weekday, date: dateLabel } = getProductionDayLabel(date);
    const weekend = isProductionWeekend(date) ? ' weekend' : '';
    const dateStr = formatProductionDate(date);
    const left = idx === 0 ? '<button class="production-day-shift" data-dir="-1" type="button">←</button>' : '';
    const right = idx === dates.length - 1 ? '<button class="production-day-shift" data-dir="1" type="button">→</button>' : '';
    return `<th class="production-day${weekend}" data-date="${dateStr}">${left}<span class="production-day-title">${weekday}</span><span class="production-day-date">${dateLabel}</span>${right}</th>`;
  }).join('');

  const rowsHtml = areasList.map(area => {
    const areaName = escapeHtml(area.name || 'Без названия');
    const cells = dates.map(date => {
      const dateStr = formatProductionDate(date);
      const assignments = getProductionAssignments(dateStr, area.id, productionScheduleState.selectedShift);
      const isSelected = productionScheduleState.selectedCell
        && productionScheduleState.selectedCell.date === dateStr
        && productionScheduleState.selectedCell.areaId === area.id
        && productionScheduleState.selectedCell.shift === productionScheduleState.selectedShift;
      const weekendClass = isProductionWeekend(date) ? ' weekend' : '';
      const parts = assignments.map(rec => {
        const name = getProductionEmployeeName(rec.employeeId);
        const timeRange = rec.timeFrom && rec.timeTo ? ` ${rec.timeFrom}–${rec.timeTo}` : '';
        const isActive = productionScheduleState.selectedCellEmployeeId === rec.employeeId && isSelected;
        return `<div class="production-assignment${isActive ? ' selected' : ''}" data-employee-id="${rec.employeeId}">${name}${timeRange}</div>`;
      }).join('');
      const content = parts || '<div class="production-empty">—</div>';
      const selectedClass = isSelected ? ' selected' : '';
      return `<td class="production-cell${weekendClass}${selectedClass}" data-area-id="${area.id}" data-date="${dateStr}" data-shift="${productionScheduleState.selectedShift}">${content}</td>`;
    }).join('');
    return `<tr><th class="production-area">${areaName}</th>${cells}</tr>`;
  }).join('');

  wrapper.innerHTML = `<table class="production-table"><thead><tr><th class="production-area">Участок</th>${headerCells}</tr></thead><tbody>${rowsHtml}</tbody></table>`;
}

function renderProductionScheduleSidebar() {
  const sidebar = document.getElementById('production-sidebar');
  if (!sidebar) return;
  const departments = (centers || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const employees = getFilteredProductionEmployees();
  const filterInput = productionScheduleState.filterVisible
    ? `<input type="text" id="production-employee-search" placeholder="Поиск" value="${escapeHtml(productionScheduleState.employeeFilter)}" />`
    : '';

  const shiftButtons = [1, 2, 3].map(shift => `<button type="button" class="production-shift-btn${productionScheduleState.selectedShift === shift ? ' active' : ''}" data-shift="${shift}">${shift} смена</button>`).join('');
  const employeeItems = employees.map(emp => {
    const name = escapeHtml(emp.name || emp.username || '');
    const active = productionScheduleState.selectedEmployees.includes(emp.id) ? ' active' : '';
    return `<button type="button" class="production-employee${active}" data-id="${emp.id}">${name}</button>`;
  }).join('');

  sidebar.innerHTML = `
    <div class="production-sidebar-block">
      <label for="production-department">Подразделение</label>
      <select id="production-department">
        <option value="">Все подразделения</option>
        ${departments.map(d => `<option value="${d.id}"${productionScheduleState.departmentId === d.id ? ' selected' : ''}>${escapeHtml(d.name || '')}</option>`).join('')}
      </select>
    </div>
    <div class="production-sidebar-block">
      <div class="production-shift-group" id="production-shift-group">${shiftButtons}</div>
    </div>
    <div class="production-sidebar-block">
      <div class="production-employee-filter">
        <button type="button" id="production-toggle-filter" class="btn-tertiary">Фильтр</button>
        ${filterInput}
      </div>
      <div id="production-employee-list" class="production-employee-list">${employeeItems || '<div class="muted">Нет доступных сотрудников</div>'}</div>
    </div>
    <div class="production-sidebar-block">
      <label class="checkbox-inline">
        <input type="checkbox" id="production-full-shift" ${document.getElementById('production-full-shift')?.checked !== false ? 'checked' : ''} />
        <span>Смена</span>
      </label>
      <div class="production-time-row">
        <div>
          <label for="production-time-from">Время с</label>
          <input type="time" id="production-time-from" ${document.getElementById('production-full-shift')?.checked !== false ? 'disabled' : ''} value="${document.getElementById('production-time-from')?.value || ''}" />
        </div>
        <div>
          <label for="production-time-to">Время по</label>
          <input type="time" id="production-time-to" ${document.getElementById('production-full-shift')?.checked !== false ? 'disabled' : ''} value="${document.getElementById('production-time-to')?.value || ''}" />
        </div>
      </div>
    </div>
    <div class="production-sidebar-actions">
      <button type="button" class="btn-primary" id="production-add">Добавить</button>
      <button type="button" class="btn-secondary" id="production-delete">Удалить</button>
      <button type="button" class="btn-tertiary" id="production-reset">Сброс</button>
    </div>
  `;
}

function bindProductionSidebarEvents() {
  const sidebar = document.getElementById('production-sidebar');
  if (!sidebar || sidebar.dataset.bound === 'true') return;
  sidebar.dataset.bound = 'true';

  sidebar.addEventListener('click', (event) => {
    const shiftBtn = event.target.closest('.production-shift-btn');
    if (shiftBtn) {
      const shift = parseInt(shiftBtn.getAttribute('data-shift'), 10) || 1;
      setProductionShift(shift);
      return;
    }
    const empBtn = event.target.closest('.production-employee');
    if (empBtn) {
      const id = empBtn.getAttribute('data-id');
      toggleProductionEmployeeSelection(id);
      return;
    }
    const filterBtn = event.target.closest('#production-toggle-filter');
    if (filterBtn) {
      setProductionFilterVisible(!productionScheduleState.filterVisible);
      return;
    }
    const addBtn = event.target.closest('#production-add');
    if (addBtn) {
      addEmployeesToProductionCell();
      return;
    }
    const delBtn = event.target.closest('#production-delete');
    if (delBtn) {
      deleteProductionAssignments();
      return;
    }
    const resetBtn = event.target.closest('#production-reset');
    if (resetBtn) {
      productionScheduleState.selectedEmployees = [];
      productionScheduleState.employeeFilter = '';
      productionScheduleState.departmentId = '';
      productionScheduleState.filterVisible = false;
      renderProductionSchedule();
      return;
    }
  });

  sidebar.addEventListener('change', (event) => {
    if (event.target.id === 'production-department') {
      applyProductionDepartment(event.target.value);
    }
    if (event.target.id === 'production-full-shift') {
      const checked = event.target.checked;
      const fromInput = document.getElementById('production-time-from');
      const toInput = document.getElementById('production-time-to');
      if (fromInput) fromInput.disabled = checked;
      if (toInput) toInput.disabled = checked;
    }
  });

  sidebar.addEventListener('input', (event) => {
    if (event.target.id === 'production-employee-search') {
      applyProductionEmployeeFilter(event.target.value || '');
    }
  });
}

function bindProductionTableEvents() {
  const wrapper = document.getElementById('production-schedule-table');
  if (!wrapper || wrapper.dataset.bound === 'true') return;
  wrapper.dataset.bound = 'true';

  wrapper.addEventListener('click', (event) => {
    const shiftBtn = event.target.closest('.production-day-shift');
    if (shiftBtn) {
      const dir = parseInt(shiftBtn.getAttribute('data-dir'), 10) || 0;
      const nextStart = addDaysToDate(productionScheduleState.weekStart || getProductionWeekStart(), dir);
      setProductionWeekStart(nextStart);
      return;
    }

    const assignment = event.target.closest('.production-assignment');
    const cell = event.target.closest('.production-cell');
    if (cell) {
      const date = cell.getAttribute('data-date');
      const areaId = cell.getAttribute('data-area-id');
      const shift = parseInt(cell.getAttribute('data-shift'), 10) || productionScheduleState.selectedShift;
      const employeeId = assignment ? assignment.getAttribute('data-employee-id') : null;
      setProductionSelectedCell({ date, areaId, shift }, employeeId);
      renderProductionSchedule();
      return;
    }
  });

  wrapper.addEventListener('contextmenu', (event) => {
    const cell = event.target.closest('.production-cell');
    if (!cell) return;
    event.preventDefault();
    const date = cell.getAttribute('data-date');
    const areaId = cell.getAttribute('data-area-id');
    const shift = parseInt(cell.getAttribute('data-shift'), 10) || productionScheduleState.selectedShift;
    setProductionSelectedCell({ date, areaId, shift }, null);
    showProductionContextMenu(event.pageX, event.pageY);
  });
}

function showProductionContextMenu(x, y) {
  let menu = document.getElementById('production-context-menu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'production-context-menu';
    menu.className = 'production-context-menu';
    menu.innerHTML = `
      <button data-action="copy" type="button">Копировать</button>
      <button data-action="paste" type="button">Вставить</button>
      <button data-action="delete" type="button">Удалить</button>
    `;
    document.body.appendChild(menu);
    menu.addEventListener('click', (event) => {
      const action = event.target.getAttribute('data-action');
      if (action === 'copy') copyProductionCell();
      if (action === 'paste') pasteProductionCell();
      if (action === 'delete') deleteProductionAssignments();
      hideProductionContextMenu();
    });
  }
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.classList.add('open');
  document.addEventListener('click', hideProductionContextMenu, { once: true });
}

function hideProductionContextMenu() {
  const menu = document.getElementById('production-context-menu');
  if (menu) menu.classList.remove('open');
}

function handleProductionShortcuts(event) {
  if (!productionScheduleIsActive()) return;
  if (event.key === 'Delete') {
    deleteProductionAssignments();
    return;
  }
  if (event.key.toLowerCase() === 'c' && event.ctrlKey) {
    copyProductionCell();
    event.preventDefault();
  }
  if (event.key.toLowerCase() === 'v' && event.ctrlKey) {
    pasteProductionCell();
    event.preventDefault();
  }
}

function renderProductionSchedule() {
  productionScheduleState.weekStart = productionScheduleState.weekStart || getProductionWeekStart();
  renderProductionWeekTable();
  renderProductionScheduleSidebar();
  bindProductionSidebarEvents();
  bindProductionTableEvents();
}

function setupProductionScheduleControls() {
  const dateInput = document.getElementById('production-week-start');
  if (dateInput && dateInput.dataset.bound !== 'true') {
    dateInput.dataset.bound = 'true';
    dateInput.addEventListener('change', () => {
      const value = dateInput.value || getCurrentDateString();
      setProductionWeekStart(value);
    });
  }
  if (dateInput) {
    const start = productionScheduleState.weekStart || getProductionWeekStart();
    dateInput.value = formatProductionDate(start);
  }

  const todayBtn = document.getElementById('production-today');
  if (todayBtn && todayBtn.dataset.bound !== 'true') {
    todayBtn.dataset.bound = 'true';
    todayBtn.addEventListener('click', () => setProductionWeekStart(new Date()));
  }

  const resetBtn = document.getElementById('production-reset-selection');
  if (resetBtn && resetBtn.dataset.bound !== 'true') {
    resetBtn.dataset.bound = 'true';
    resetBtn.addEventListener('click', () => {
      resetProductionSelection();
      productionScheduleState.selectedEmployees = [];
      productionScheduleState.employeeFilter = '';
      productionScheduleState.departmentId = '';
      renderProductionSchedule();
    });
  }

  const timesBtn = document.getElementById('production-shift-times-btn');
  if (timesBtn && timesBtn.dataset.bound !== 'true') {
    timesBtn.dataset.bound = 'true';
    timesBtn.addEventListener('click', () => openProductionShiftTimesModal());
  }

  document.addEventListener('keydown', handleProductionShortcuts);
}

function openProductionRoute(route, { fromRestore = false } = {}) {
  const map = {
    '/production/schedule': 'production-schedule',
    '/production/shifts': 'production-shifts',
    '/production/delayed': 'production-delayed',
    '/production/defects': 'production-defects'
  };
  const targetId = map[route] || 'production-schedule';
  document.querySelectorAll('main section').forEach(sec => sec.classList.remove('active'));
  Object.values(map).forEach(id => {
    const section = document.getElementById(id);
    if (section) section.classList.add('hidden');
  });
  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
  const target = document.getElementById(targetId);
  if (target) {
    target.classList.remove('hidden');
    target.classList.add('active');
  }
  const navToggle = document.getElementById('nav-production-toggle');
  if (navToggle) navToggle.classList.add('active');
  appState = { ...appState, tab: 'production' };
  if (targetId === 'production-schedule' && !fromRestore) {
    renderProductionSchedule();
  }
}

function openProductionShiftTimesModal() {
  const modal = document.getElementById('production-shift-times-modal');
  if (!modal) return;
  const body = modal.querySelector('.modal-body');
  const list = (productionShiftTimes && productionShiftTimes.length ? productionShiftTimes : getDefaultProductionShiftTimes())
    .slice()
    .sort((a, b) => (a.shift || 0) - (b.shift || 0));
  body.innerHTML = list.map(item => `
    <div class="production-shift-row">
      <div class="production-shift-label">${item.shift} смена</div>
      <label>С <input type="time" data-shift="${item.shift}" data-type="from" value="${escapeHtml(item.timeFrom || '')}" /></label>
      <label>По <input type="time" data-shift="${item.shift}" data-type="to" value="${escapeHtml(item.timeTo || '')}" /></label>
    </div>
  `).join('');
  modal.classList.remove('hidden');
}

function closeProductionShiftTimesModal() {
  const modal = document.getElementById('production-shift-times-modal');
  if (modal) modal.classList.add('hidden');
}

function saveProductionShiftTimes() {
  const modal = document.getElementById('production-shift-times-modal');
  if (!modal) return;
  const inputs = modal.querySelectorAll('input[type="time"]');
  const map = new Map();
  inputs.forEach(input => {
    const shift = parseInt(input.getAttribute('data-shift'), 10) || 1;
    const type = input.getAttribute('data-type');
    const current = map.get(shift) || { shift, timeFrom: '00:00', timeTo: '00:00' };
    if (type === 'from') current.timeFrom = input.value || '00:00';
    if (type === 'to') current.timeTo = input.value || '00:00';
    map.set(shift, current);
  });
  productionShiftTimes = Array.from(map.values());
  saveData();
  closeProductionShiftTimesModal();
  renderProductionSchedule();
}

function bindProductionShiftModal() {
  const modal = document.getElementById('production-shift-times-modal');
  if (!modal || modal.dataset.bound === 'true') return;
  modal.dataset.bound = 'true';
  const cancelBtn = modal.querySelector('.modal-cancel');
  const confirmBtn = modal.querySelector('.modal-confirm');
  const closeBtn = modal.querySelector('.modal-close');
  if (cancelBtn) cancelBtn.addEventListener('click', () => closeProductionShiftTimesModal());
  if (closeBtn) closeBtn.addEventListener('click', () => closeProductionShiftTimesModal());
  if (confirmBtn) confirmBtn.addEventListener('click', () => saveProductionShiftTimes());
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeProductionShiftTimesModal();
  });
}

function setupProductionModule() {
  productionScheduleState.weekStart = getProductionWeekStart();
  setupProductionScheduleControls();
  bindProductionSidebarEvents();
  bindProductionTableEvents();
  bindProductionShiftModal();
}
