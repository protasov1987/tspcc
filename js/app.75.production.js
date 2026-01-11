// === ПРОИЗВОДСТВО: РАСПИСАНИЕ ===
const PRODUCTION_WEEK_DAYS = 7;
const PRODUCTION_WEEK_LABELS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

function getProductionScheduleUserKey() {
  if (!window.currentUser) return 'anonymous';
  return currentUser.id || currentUser.login || currentUser.name || 'anonymous';
}

const AREAS_ORDER_LS_KEY = `tspcc:production:schedule:areasOrder:${getProductionScheduleUserKey()}`;

let isProductionRowOrderEdit = false;

const productionScheduleState = {
  weekStart: null,
  selectedShift: 1,
  selectedCell: null,
  selectedEmployees: [],
  employeeFilter: '',
  departmentId: '',
  clipboard: null,
  selectedCellEmployeeId: null,
  tableFilterEnabled: false
};

const productionShiftsState = {
  weekStart: null,
  selectedShift: 1,
  selectedCardId: null,
  showPlannedQueue: false,
  viewMode: 'queue'
};

function loadAreasOrder() {
  try {
    const raw = localStorage.getItem(AREAS_ORDER_LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveAreasOrder(order) {
  localStorage.setItem(AREAS_ORDER_LS_KEY, JSON.stringify(order));
}

function getNormalizedAreasOrder(list, storedOrder) {
  const areasList = Array.isArray(list) ? list : [];
  const order = Array.isArray(storedOrder) ? storedOrder : [];
  const existingIds = new Set(areasList.map(item => item.id));
  const filteredOrder = order.filter(id => existingIds.has(id));
  const existingSet = new Set(filteredOrder);
  const newAreas = areasList
    .filter(area => !existingSet.has(area.id))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return filteredOrder.concat(newAreas.map(area => area.id));
}

function getProductionAreasWithOrder() {
  const areasList = (areas || []).slice();
  if (!areasList.length) return { areasList: [], order: [] };

  const storedOrder = loadAreasOrder();
  let normalizedOrder;

  if (storedOrder) {
    normalizedOrder = getNormalizedAreasOrder(areasList, storedOrder);
  } else {
    areasList.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    normalizedOrder = areasList.map(area => area.id);
  }

  const orderMap = new Map(normalizedOrder.map((id, idx) => [id, idx]));
  const sortedAreas = areasList.slice().sort((a, b) => {
    const posA = orderMap.has(a.id) ? orderMap.get(a.id) : normalizedOrder.length;
    const posB = orderMap.has(b.id) ? orderMap.get(b.id) : normalizedOrder.length;
    if (posA !== posB) return posA - posB;
    return (a.name || '').localeCompare(b.name || '');
  });

  return { areasList: sortedAreas, order: normalizedOrder };
}

function moveProductionArea(areaId, direction) {
  const areasList = (areas || []).slice();
  if (!areasList.length) return;
  const currentOrder = getNormalizedAreasOrder(areasList, loadAreasOrder());
  const index = currentOrder.indexOf(areaId);
  if (index < 0) return;
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= currentOrder.length) return;
  [currentOrder[index], currentOrder[targetIndex]] = [currentOrder[targetIndex], currentOrder[index]];
  saveAreasOrder(currentOrder);
  renderProductionSchedule();
}

function getProductionWeekStart(date = new Date()) {
  const base = new Date(date);
  const day = base.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  base.setHours(0, 0, 0, 0);
  base.setDate(base.getDate() + diff);
  return base;
}

function normalizeProductionStartDate(date) {
  const base = new Date(date || Date.now());
  if (Number.isNaN(base.getTime())) return getProductionWeekStart();
  base.setHours(0, 0, 0, 0);
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

function addDaysToDateStr(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return formatProductionDate(d);
}

function getProductionWeekDates() {
  const start = productionScheduleState.weekStart || getProductionWeekStart();
  return Array.from({ length: PRODUCTION_WEEK_DAYS }, (_, idx) => addDaysToDate(start, idx));
}

function getProductionShiftsWeekDates() {
  const start = productionShiftsState.weekStart || getProductionWeekStart();
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
  productionScheduleState.weekStart = normalizeProductionStartDate(date);
  resetProductionSelection();
  renderProductionSchedule();
}

function setProductionShiftsWeekStart(date) {
  productionShiftsState.weekStart = normalizeProductionStartDate(date);
  renderProductionShiftsPage();
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

function setProductionShiftsShift(shift) {
  productionShiftsState.selectedShift = shift;
  renderProductionShiftsPage();
}

function resetProductionSelection() {
  productionScheduleState.selectedCell = null;
  productionScheduleState.selectedEmployees = [];
  productionScheduleState.selectedCellEmployeeId = null;
}

function getProductionAssignments(date, areaId, shift) {
  return (productionSchedule || []).filter(rec => rec.date === date && rec.areaId === areaId && rec.shift === shift);
}

function getProductionShiftEmployees(date, areaId, shift) {
  const assignments = getProductionAssignments(date, areaId, shift);
  const unique = new Set(assignments.map(rec => rec.employeeId).filter(Boolean));
  const employeeIds = Array.from(unique);
  const employeeNames = employeeIds.map(id => getProductionEmployeeName(id));
  return { employeeIds, employeeNames };
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
  const date = getProductionFilterDate();
  const shift = productionScheduleState.selectedShift;
  if (!date || !shift) return true;

  const shiftRange = getShiftRange(shift);

  const records = (productionSchedule || []).filter(rec =>
    rec.date === date &&
    rec.shift === shift &&
    rec.employeeId === employeeId
  );

  if (!records.length) return true;

  if (records.some(rec => !rec.timeFrom || !rec.timeTo)) return false;

  const intervals = [];
  for (const rec of records) {
    const interval = getAssignmentIntervalMinutes(rec);
    const start = Math.max(interval.start, shiftRange.start);
    const end = Math.min(interval.end, shiftRange.end);
    if (end > start) intervals.push({ start, end });
  }

  const merged = mergeIntervals(intervals);

  return !(
    merged.length === 1 &&
    merged[0].start <= shiftRange.start &&
    merged[0].end >= shiftRange.end
  );
}

function getFilteredProductionEmployees() {
  const deptId = productionScheduleState.departmentId;
  const selectedCell = productionScheduleState.selectedCell;
  const search = (productionScheduleState.employeeFilter || '').toLowerCase();
  const filtered = (users || []).filter(user => {
    const name = (user?.name || user?.username || '').trim();
    if (!name) return false;
    const nameLower = name.toLowerCase();
    // Исключаем служебных/админских пользователей из списка исполнителей
    if ((user?.role || '').toLowerCase() === 'admin') return false;
    if ((user?.accessLevelId || '') === 'level_admin') return false;
    if (nameLower === 'abyss') return false;
    if (deptId && user.departmentId !== deptId) return false;
    if (!selectedCell) return true;
    if (!isEmployeeAvailableForShift(user.id)) return false;
    if (search && !nameLower.includes(search)) return false;
    return true;
  });
  return filtered.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

function toggleProductionEmployeeSelection(id, buttonEl = null) {
  const next = new Set(productionScheduleState.selectedEmployees || []);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  productionScheduleState.selectedEmployees = Array.from(next);

  if (buttonEl && buttonEl.classList) {
    buttonEl.classList.toggle('active', next.has(id));
  }
}

function applyProductionDepartment(deptId) {
  productionScheduleState.departmentId = deptId || '';
  productionScheduleState.selectedEmployees = [];
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

function isClosedShift(dateStr, shift) {
  const range = getShiftRange(shift);
  if (!range) return false;

  const [y, m, d] = dateStr.split('-').map(Number);
  const endDate = new Date(y, m - 1, d, 0, 0, 0, 0);

  endDate.setMinutes(range.end);

  if (range.end <= range.start) {
    endDate.setDate(endDate.getDate() + 1);
  }

  return Date.now() > endDate.getTime();
}

function canEditShift(dateStr, shift) {
  return currentUser?.login === 'Abyss' ? true : !isClosedShift(dateStr, shift);
}

let productionShiftTasksByCellKey = new Map();

function makeProductionShiftCellKey(dateStr, shift, areaId) {
  const d = String(dateStr ?? '');
  const s = (parseInt(shift, 10) || 1);
  const a = String(areaId ?? '');
  return `${d}|${s}|${a}`;
}

function rebuildProductionShiftTasksIndex() {
  const map = new Map();
  (productionShiftTasks || []).forEach(task => {
    const key = makeProductionShiftCellKey(task.date, task.shift, task.areaId);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(task);
  });
  productionShiftTasksByCellKey = map;
}

function getProductionShiftTasksForCell(dateStr, shift, areaId) {
  const key = makeProductionShiftCellKey(dateStr, shift, areaId);
  return productionShiftTasksByCellKey.get(key) || [];
}

function getPlanningQueueCards(showPlanned = false) {
  // Очередь планирования = карты, у которых есть что планировать:
  // PROVIDED (ничего не запланировано) и PLANNING (частично запланировано).
  if (showPlanned) {
    return (cards || []).filter(card =>
      card &&
      !card.archived &&
      card.cardType === 'MKI' &&
      card.approvalStage === APPROVAL_STAGE_PLANNED
    );
  }
  return (cards || []).filter(card =>
    card &&
    !card.archived &&
    card.cardType === 'MKI' &&
    (card.approvalStage === APPROVAL_STAGE_PROVIDED || card.approvalStage === APPROVAL_STAGE_PLANNING)
  );
}

function isRouteOpPlannedInShifts(cardId, routeOpId) {
  if (!cardId || !routeOpId) return false;
  return (productionShiftTasks || []).some(t => t.cardId === cardId && t.routeOpId === routeOpId);
}

function getPlanningCardLabel(card) {
  if (!card) return '';
  const number = (card.routeCardNumber || '').trim();
  const name = (card.itemName || card.name || '').trim();
  if (number && name) return `${number} — ${name}`;
  return number || name || 'Маршрутная карта';
}

function getShiftRangesForWindow(startMinutes, endMinutes) {
  return (productionShiftTimes || []).map(s => ({ shift: s.shift, range: getShiftRange(s.shift) }))
    .map(item => {
      const overlapStart = Math.max(item.range.start, startMinutes);
      const overlapEnd = Math.min(item.range.end, endMinutes);
      return overlapEnd > overlapStart ? { shift: item.shift, start: overlapStart, end: overlapEnd } : null;
    })
    .filter(Boolean);
}

function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return Math.min(aEnd, bEnd) > Math.max(aStart, bStart);
}

function getAssignmentIntervalMinutes(rec) {
  const range = getShiftRange(rec.shift);

  if (rec.timeFrom && rec.timeTo) {
    const s = parseProductionTime(rec.timeFrom);
    const e0 = parseProductionTime(rec.timeTo);
    if (s == null || e0 == null) return range;

    let e = e0;
    if (e <= s) e += 1440;
    return { start: s, end: e };
  }

  return range;
}

function findEmployeeOverlapConflict({ date, shift, employeeId, newStart, newEnd, allowSameAreaId }) {
  const newInterval = (newStart == null || newEnd == null)
    ? getShiftRange(shift)
    : { start: newStart, end: newEnd };

  const records = (productionSchedule || []).filter(r =>
    r.date === date &&
    r.shift === shift &&
    r.employeeId === employeeId &&
    r.areaId !== allowSameAreaId
  );

  for (const r of records) {
    const rInt = getAssignmentIntervalMinutes(r);
    if (intervalsOverlap(newInterval.start, newInterval.end, rInt.start, rInt.end)) {
      return r;
    }
  }
  return null;
}

function mergeIntervals(intervals) {
  if (!intervals.length) return [];
  intervals.sort((a, b) => a.start - b.start);
  const res = [intervals[0]];
  for (let i = 1; i < intervals.length; i++) {
    const last = res[res.length - 1];
    const cur = intervals[i];
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      res.push(cur);
    }
  }
  return res;
}

function buildProductionAssignmentRecord({ date, areaId, shift, employeeId, timeFrom, timeTo }) {
  return { date, areaId, shift, employeeId, timeFrom, timeTo };
}

function upsertProductionAssignment(record) {
  if (!canEditShift(record.date, record.shift)) {
    return { error: 'closed-shift' };
  }

  const existing = (productionSchedule || []).find(rec =>
    rec.date === record.date &&
    rec.shift === record.shift &&
    rec.areaId === record.areaId &&
    rec.employeeId === record.employeeId
  );

  let newStart = null;
  let newEnd = null;
  if (record.timeFrom && record.timeTo) {
    newStart = parseProductionTime(record.timeFrom);
    newEnd = parseProductionTime(record.timeTo);
  }

  const conflict = findEmployeeOverlapConflict({
    date: record.date,
    shift: record.shift,
    employeeId: record.employeeId,
    newStart,
    newEnd,
    allowSameAreaId: record.areaId
  });

  if (conflict) {
    return { error: 'time-overlap' };
  }

  if (existing) {
    existing.timeFrom = record.timeFrom;
    existing.timeTo = record.timeTo;
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
  if (!canEditShift(cell.date, cell.shift)) {
    showToast('Смена уже завершена. Редактирование запрещено');
    return;
  }
  const employeeIds = productionScheduleState.selectedEmployees || [];
  if (!employeeIds.length) {
    showToast('Выберите сотрудников');
    return;
  }
  const fullShift = Boolean(document.getElementById('production-full-shift')?.checked);
  const rawFrom = document.getElementById('production-time-from')?.value || null;
  const rawTo = document.getElementById('production-time-to')?.value || null;
  const fromMinutes = parseProductionTime(rawFrom);
  const toMinutes = parseProductionTime(rawTo);

  const targetGroups = employeeIds.map(empId => {
    const targets = [];
    if (fullShift || fromMinutes == null || toMinutes == null) {
      targets.push({ date: cell.date, shift: cell.shift, start: null, end: null });
    } else if (toMinutes > fromMinutes) {
      targets.push(
        ...getShiftRangesForWindow(fromMinutes, toMinutes)
          .map(target => ({ ...target, date: cell.date }))
      );
    } else {
      targets.push(
        ...getShiftRangesForWindow(fromMinutes, 1440)
          .map(target => ({ ...target, date: cell.date }))
      );
      targets.push(
        ...getShiftRangesForWindow(0, toMinutes)
          .map(target => ({ ...target, date: addDaysToDateStr(cell.date, 1) }))
      );
    }
    return { empId, targets };
  });

  const hasClosedTarget = targetGroups.some(group =>
    group.targets.some(target => !canEditShift(target.date, target.shift || cell.shift))
  );
  if (hasClosedTarget) {
    showToast('Смена уже завершена. Редактирование запрещено');
    return;
  }

  const hasExistingInCell = targetGroups.some(group =>
    group.targets.some(target => (productionSchedule || []).some(rec =>
      rec.date === target.date &&
      rec.shift === (target.shift || cell.shift) &&
      rec.areaId === cell.areaId &&
      rec.employeeId === group.empId
    ))
  );
  if (hasExistingInCell) {
    showToast('Сотрудник уже добавлен в эту ячейку');
    return;
  }

  const hasConflict = targetGroups.some(group =>
    group.targets.some(target => findEmployeeOverlapConflict({
      date: target.date,
      shift: target.shift || cell.shift,
      employeeId: group.empId,
      newStart: target.start,
      newEnd: target.end,
      allowSameAreaId: cell.areaId
    }))
  );

  if (hasConflict) {
    showToast('Сотрудник уже занят в это время');
    return;
  }

  for (const group of targetGroups) {
    for (const target of group.targets) {
      const record = buildProductionAssignmentRecord({
        date: target.date,
        areaId: cell.areaId,
        shift: target.shift || cell.shift,
        employeeId: group.empId,
        timeFrom: target.start == null ? null : minutesToTimeString(target.start),
        timeTo: target.end == null ? null : minutesToTimeString(target.end)
      });
      productionSchedule.push(record);
    }
  }

  saveData();
  renderProductionSchedule();
  showToast('Сотрудники добавлены в расписание');
  // ❗ КРИТИЧНО: сбрасываем выбранных сотрудников,
  // иначе следующий сотрудник не добавится без F5
  productionScheduleState.selectedEmployees = [];

  // обновляем правую панель, чтобы снять подсветку выбранных
  renderProductionScheduleSidebar();
}

function deleteProductionAssignments() {
  const cell = productionScheduleState.selectedCell;
  if (!cell) return;
  const { date, areaId, shift } = cell;
  const employeeId = productionScheduleState.selectedCellEmployeeId;
  if (!canEditShift(date, shift)) {
    showToast('Смена уже завершена. Редактирование запрещено');
    return;
  }

  // delete whole day (column)
  if (areaId === null) {
    const before = productionSchedule.length;
    productionSchedule = productionSchedule.filter(rec => rec.date !== date || rec.shift !== shift);
    const removed = before !== productionSchedule.length;
    productionScheduleState.selectedCellEmployeeId = null;
    if (removed) {
      saveData();
      renderProductionSchedule();
    }
    return;
  }

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

  // copy single employee
  if (cell.areaId !== null && productionScheduleState.selectedCellEmployeeId) {
    const empId = productionScheduleState.selectedCellEmployeeId;
    const rec = (productionSchedule || []).find(r => r.date === cell.date && r.shift === cell.shift && r.areaId === cell.areaId && r.employeeId === empId);
    if (rec) {
      productionScheduleState.clipboard = {
        type: 'employee',
        item: { employeeId: rec.employeeId, timeFrom: rec.timeFrom ?? null, timeTo: rec.timeTo ?? null }
      };
    }
    return;
  }

  // copy whole day (column)
  if (cell.areaId === null) {
    const items = (productionSchedule || [])
      .filter(rec => rec.date === cell.date && rec.shift === cell.shift)
      .map(rec => ({ ...rec }));
    productionScheduleState.clipboard = { type: 'day', items };
    return;
  }

  // copy single cell
  const items = getProductionAssignments(cell.date, cell.areaId, cell.shift).map(rec => ({ ...rec }));
  productionScheduleState.clipboard = { type: 'cell', items };
}

function pasteProductionCell() {
  const cell = productionScheduleState.selectedCell;
  const clip = productionScheduleState.clipboard;
  if (!cell || !clip) return;
  if (!canEditShift(cell.date, cell.shift)) {
    showToast('Смена уже завершена. Редактирование запрещено');
    return;
  }

  // employee -> cell
  if (clip.type === 'employee' && cell.areaId !== null && clip.item && clip.item.employeeId) {
    const empId = clip.item.employeeId;

    // already in the target cell
    const existsInCell = productionSchedule.some(
      rec => rec.date === cell.date && rec.shift === cell.shift && rec.areaId === cell.areaId && rec.employeeId === empId
    );
    if (existsInCell) return;

    let newStart = null;
    let newEnd = null;
    if (clip.item.timeFrom && clip.item.timeTo) {
      newStart = parseProductionTime(clip.item.timeFrom);
      newEnd = parseProductionTime(clip.item.timeTo);
    }

    const conflict = findEmployeeOverlapConflict({
      date: cell.date,
      shift: cell.shift,
      employeeId: empId,
      newStart,
      newEnd,
      allowSameAreaId: cell.areaId
    });

    if (conflict) {
      showToast('Сотрудник уже занят в это время');
      return;
    }

    productionSchedule.push({
      date: cell.date,
      shift: cell.shift,
      areaId: cell.areaId,
      employeeId: empId,
      timeFrom: clip.item.timeFrom ?? null,
      timeTo: clip.item.timeTo ?? null
    });

    saveData();
    renderProductionSchedule();
    return;
  }

  if (!Array.isArray(clip.items) || clip.items.length === 0) return;

  const hasInternalOverlap = (items, shift) => {
    const byEmployee = new Map();
    items.forEach(item => {
      const interval = getAssignmentIntervalMinutes({
        shift,
        timeFrom: item.timeFrom ?? null,
        timeTo: item.timeTo ?? null
      });
      if (!byEmployee.has(item.employeeId)) byEmployee.set(item.employeeId, []);
      byEmployee.get(item.employeeId).push(interval);
    });

    for (const intervals of byEmployee.values()) {
      intervals.sort((a, b) => a.start - b.start);
      for (let i = 1; i < intervals.length; i++) {
        const prev = intervals[i - 1];
        const cur = intervals[i];
        if (intervalsOverlap(prev.start, prev.end, cur.start, cur.end)) {
          return true;
        }
      }
    }
    return false;
  };

  // day -> day
  if (clip.type === 'day' && cell.areaId === null) {
    const hasScheduleConflict = clip.items.some(item => {
      let newStart = null;
      let newEnd = null;
      if (item.timeFrom && item.timeTo) {
        newStart = parseProductionTime(item.timeFrom);
        newEnd = parseProductionTime(item.timeTo);
      }
      return findEmployeeOverlapConflict({
        date: cell.date,
        shift: cell.shift,
        employeeId: item.employeeId,
        newStart,
        newEnd,
        allowSameAreaId: item.areaId
      });
    });

    if (hasScheduleConflict || hasInternalOverlap(clip.items, cell.shift)) {
      showToast('Сотрудник уже занят в это время');
      return;
    }

    productionSchedule = productionSchedule.filter(rec => rec.date !== cell.date || rec.shift !== cell.shift);

    clip.items.forEach(item => {
      productionSchedule.push({
        date: cell.date,
        shift: cell.shift,
        areaId: item.areaId,
        employeeId: item.employeeId,
        timeFrom: item.timeFrom ?? null,
        timeTo: item.timeTo ?? null
      });
    });

    saveData();
    renderProductionSchedule();
    return;
  }

  // cell -> cell
  if (clip.type === 'cell' && cell.areaId !== null) {
    const hasConflict = clip.items.some(item => {
      let newStart = null;
      let newEnd = null;
      if (item.timeFrom && item.timeTo) {
        newStart = parseProductionTime(item.timeFrom);
        newEnd = parseProductionTime(item.timeTo);
      }
      return findEmployeeOverlapConflict({
        date: cell.date,
        shift: cell.shift,
        employeeId: item.employeeId,
        newStart,
        newEnd,
        allowSameAreaId: cell.areaId
      });
    });

    if (hasConflict) {
      showToast('Сотрудник уже занят в это время');
      return;
    }

    productionSchedule = productionSchedule.filter(
      rec => rec.date !== cell.date || rec.shift !== cell.shift || rec.areaId !== cell.areaId
    );

    clip.items.forEach(item => {
      productionSchedule.push({
        date: cell.date,
        shift: cell.shift,
        areaId: cell.areaId,
        employeeId: item.employeeId,
        timeFrom: item.timeFrom ?? null,
        timeTo: item.timeTo ?? null
      });
    });

    saveData();
    renderProductionSchedule();
    return;
  }

  // mismatched target (do nothing)
  showToast('Неверная цель вставки');
}

function getTodayDateStrLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function renderProductionWeekTable() {
  const wrapper = document.getElementById('production-schedule-table');
  if (!wrapper) return;
  const dates = getProductionWeekDates();
  const { areasList, order: areasOrder } = getProductionAreasWithOrder();
  const orderMap = new Map(areasOrder.map((id, idx) => [id, idx]));
  const todayDateStr = getTodayDateStrLocal();
  if (!areasList.length) {
    wrapper.innerHTML = '<p class="muted">Нет участков для отображения расписания.</p>';
    return;
  }

  const headerCells = dates.map((date, idx) => {
    const { weekday, date: dateLabel } = getProductionDayLabel(date);
    const weekend = isProductionWeekend(date) ? ' weekend' : '';
    const dateStr = formatProductionDate(date);
    const isToday = dateStr === todayDateStr;
    const isDaySelected =
      productionScheduleState.selectedCell &&
      productionScheduleState.selectedCell.areaId === null &&
      productionScheduleState.selectedCell.date === dateStr &&
      productionScheduleState.selectedCell.shift === productionScheduleState.selectedShift;
    const thClass = `production-day${isToday ? ' production-today' : ''}${weekend}${isDaySelected ? ' day-selected' : ''}`;
    const left = idx === 0 ? '<button class="production-day-shift" data-dir="-1" type="button">←</button>' : '';
    const right = idx === dates.length - 1 ? '<button class="production-day-shift" data-dir="1" type="button">→</button>' : '';
    return `
      <th class="${thClass}" data-date="${dateStr}">
        <div class="production-day-header">
          ${left}
          <div class="production-day-info">
            <span class="production-day-title">${weekday}</span>
            <span class="production-day-date">${dateLabel}</span>
          </div>
          ${right}
        </div>
      </th>
    `;
  }).join('');

  const rowsHtml = areasList.map(area => {
    const areaOrderIndex = orderMap.has(area.id) ? orderMap.get(area.id) : -1;
    const isFirst = areaOrderIndex === 0;
    const isLast = areaOrderIndex === areasOrder.length - 1;
    const areaName = escapeHtml(area.name || 'Без названия');
    const reorderControls = isProductionRowOrderEdit
      ? `<div class="area-reorder" data-area-id="${area.id}">`
        + `<button class="area-move-up" type="button"${isFirst ? ' disabled' : ''}>▲</button>`
        + `<button class="area-move-down" type="button"${isLast ? ' disabled' : ''}>▼</button>`
        + '</div>'
      : '';
    const areaCell = `<div class="area-cell">${reorderControls}<span class="area-name">${areaName}</span></div>`;
    const cells = dates.map(date => {
      const dateStr = formatProductionDate(date);
      const assignments = getProductionAssignments(dateStr, area.id, productionScheduleState.selectedShift);
      const isSelected = productionScheduleState.selectedCell
        && productionScheduleState.selectedCell.date === dateStr
        && productionScheduleState.selectedCell.areaId === area.id
        && productionScheduleState.selectedCell.shift === productionScheduleState.selectedShift;
      const weekendClass = isProductionWeekend(date) ? ' weekend' : '';
      const isToday = dateStr === todayDateStr;
      const todayClass = isToday ? ' production-today' : '';
      const filterOn = productionScheduleState.tableFilterEnabled && productionScheduleState.selectedEmployees.length > 0;
      const isDaySelected =
        productionScheduleState.selectedCell &&
        productionScheduleState.selectedCell.areaId === null &&
        productionScheduleState.selectedCell.date === dateStr &&
        productionScheduleState.selectedCell.shift === productionScheduleState.selectedShift;

      let visibleCount = 0;
      const parts = assignments.map(rec => {
        const name = getProductionEmployeeName(rec.employeeId);
        const timeRange = rec.timeFrom && rec.timeTo ? ` ${rec.timeFrom}–${rec.timeTo}` : '';
        const isActive = productionScheduleState.selectedCellEmployeeId === rec.employeeId && isSelected;

        const filteredOut = filterOn && !productionScheduleState.selectedEmployees.includes(rec.employeeId);
        if (!filteredOut) visibleCount++;

        return `<div class="production-assignment${isActive ? ' selected' : ''}${filteredOut ? ' filtered-out' : ''}" data-employee-id="${rec.employeeId}">${name}${timeRange}</div>`;
      }).join('');

      // если назначений нет — пусто, если есть, но все скрыты фильтром — тоже показываем "—"
      let content = '';
      if (!assignments.length) {
        content = '<div class="production-empty">—</div>';
      } else if (visibleCount === 0) {
        content = '<div class="production-empty">—</div>' + parts;
      } else {
        content = parts;
      }
      const selectedClass = isSelected ? ' selected' : '';
      const daySelectedClass = isDaySelected ? ' day-selected' : '';
      return `<td class="production-cell${weekendClass}${todayClass}${selectedClass}${daySelectedClass}" data-area-id="${area.id}" data-date="${dateStr}" data-shift="${productionScheduleState.selectedShift}">${content}</td>`;
    }).join('');
    return `<tr><th class="production-area">${areaCell}</th>${cells}</tr>`;
  }).join('');

  wrapper.innerHTML = `<table class="production-table"><thead><tr><th class="production-area">Участок</th>${headerCells}</tr></thead><tbody>${rowsHtml}</tbody></table>`;
}

function renderProductionScheduleSidebar() {
  const sidebar = document.getElementById('production-sidebar');
  if (!sidebar) return;
  const prevEmployeeList = document.getElementById('production-employee-list');
  const prevEmployeeListScrollTop = prevEmployeeList ? prevEmployeeList.scrollTop : 0;
  const departments = (centers || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const employees = getFilteredProductionEmployees();

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

      <button type="button" class="btn-secondary${productionScheduleState.tableFilterEnabled ? ' active' : ''}" id="production-filter">
        Фильтр
      </button>

      <button type="button" class="btn-tertiary" id="production-reset">Сброс</button>
    </div>
  `;

  const nextEmployeeList = document.getElementById('production-employee-list');
  if (nextEmployeeList) {
    requestAnimationFrame(() => { nextEmployeeList.scrollTop = prevEmployeeListScrollTop; });
  }
}

function renderProductionShiftControls() {
  const container = document.getElementById('production-shift-controls');
  if (!container) return;
  const shiftTimes = getProductionShiftTimesList();
  const timeMap = new Map(shiftTimes.map(item => ([
    item.shift,
    `${item.timeFrom || '00:00'}-${item.timeTo || '00:00'}`
  ])));
  container.innerHTML = [1, 2, 3]
    .map(shift => {
      const timeLabel = escapeHtml(timeMap.get(shift) || '—');
      return `<button type="button" class="production-shift-btn${productionScheduleState.selectedShift === shift ? ' active' : ''}" data-shift="${shift}">
        <span class="production-shift-title">${shift} смена</span>
        <span class="production-shift-time">${timeLabel}</span>
      </button>`;
    })
    .join('');
}

function getProductionShiftTimesList() {
  return (productionShiftTimes && productionShiftTimes.length
    ? productionShiftTimes
    : getDefaultProductionShiftTimes())
    .slice()
    .sort((a, b) => (a.shift || 0) - (b.shift || 0));
}

function renderProductionShiftTimesForm(container) {
  if (!container) return;
  const list = getProductionShiftTimesList();
  container.innerHTML = list.map(item => `
    <div class="production-shift-row">
      <div class="production-shift-label">${item.shift} смена</div>
      <label>С <input type="time" data-shift="${item.shift}" data-type="from" value="${escapeHtml(item.timeFrom || '')}" /></label>
      <label>По <input type="time" data-shift="${item.shift}" data-type="to" value="${escapeHtml(item.timeTo || '')}" /></label>
    </div>
  `).join('');
}

function bindProductionSidebarEvents() {
  const sidebar = document.getElementById('production-sidebar');
  if (!sidebar || sidebar.dataset.bound === 'true') return;
  sidebar.dataset.bound = 'true';

  sidebar.addEventListener('click', (event) => {
    const empBtn = event.target.closest('.production-employee');
    if (empBtn) {
      const id = empBtn.getAttribute('data-id');
      toggleProductionEmployeeSelection(id, empBtn);
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
    const filterBtn = event.target.closest('#production-filter');
    if (filterBtn) {
      productionScheduleState.tableFilterEnabled = !productionScheduleState.tableFilterEnabled;

      // если выбранный в ячейке сотрудник не попадает под фильтр — снимаем выбор
      if (
        productionScheduleState.tableFilterEnabled &&
        productionScheduleState.selectedEmployees.length > 0 &&
        productionScheduleState.selectedCellEmployeeId &&
        !productionScheduleState.selectedEmployees.includes(productionScheduleState.selectedCellEmployeeId)
      ) {
        productionScheduleState.selectedCellEmployeeId = null;
      }

      renderProductionSchedule();
      return;
    }
    const resetBtn = event.target.closest('#production-reset');
    if (resetBtn) {
      resetProductionSelection();
      productionScheduleState.selectedEmployees = [];
      productionScheduleState.employeeFilter = '';
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
}

function bindProductionShiftControls() {
  const container = document.getElementById('production-shift-controls');
  if (!container || container.dataset.bound === 'true') return;
  container.dataset.bound = 'true';
  container.addEventListener('click', (event) => {
    const shiftBtn = event.target.closest('.production-shift-btn');
    if (!shiftBtn) return;
    const shift = parseInt(shiftBtn.getAttribute('data-shift'), 10) || 1;
    setProductionShift(shift);
  });
}

function bindProductionTableEvents() {
  const wrapper = document.getElementById('production-schedule-table');
  if (!wrapper || wrapper.dataset.bound === 'true') return;
  wrapper.dataset.bound = 'true';

  wrapper.addEventListener('click', (event) => {
    const moveUpBtn = event.target.closest('.area-move-up');
    const moveDownBtn = event.target.closest('.area-move-down');
    if (moveUpBtn || moveDownBtn) {
      const reorderContainer = event.target.closest('.area-reorder');
      const areaId = reorderContainer ? reorderContainer.getAttribute('data-area-id') : null;
      if (areaId) moveProductionArea(areaId, moveUpBtn ? -1 : 1);
      return;
    }

    const shiftBtn = event.target.closest('.production-day-shift');
    if (shiftBtn) {
      const dir = parseInt(shiftBtn.getAttribute('data-dir'), 10) || 0;
      const nextStart = addDaysToDate(productionScheduleState.weekStart || getProductionWeekStart(), dir);
      setProductionWeekStart(nextStart);
      return;
    }

    const dayTh = event.target.closest('th.production-day');
    if (dayTh) {
      const date = dayTh.getAttribute('data-date');
      const shift = productionScheduleState.selectedShift;
      setProductionSelectedCell({ date, areaId: null, shift }, null);
      renderProductionSchedule();
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
    const dayTh = event.target.closest('th.production-day');
    if (dayTh) {
      event.preventDefault();
      const date = dayTh.getAttribute('data-date');
      const shift = productionScheduleState.selectedShift;
      setProductionSelectedCell({ date, areaId: null, shift }, null);
      showProductionContextMenu(event.pageX, event.pageY);
      return;
    }

    const cell = event.target.closest('.production-cell');
    if (!cell) return;
    event.preventDefault();
    const date = cell.getAttribute('data-date');
    const areaId = cell.getAttribute('data-area-id');
    const shift = parseInt(cell.getAttribute('data-shift'), 10) || productionScheduleState.selectedShift;
    const assignment = event.target.closest('.production-assignment');
    const employeeId = assignment ? assignment.getAttribute('data-employee-id') : null;
    setProductionSelectedCell({ date, areaId, shift }, employeeId);
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
  renderProductionShiftControls();
  renderProductionWeekTable();
  renderProductionScheduleSidebar();
  bindProductionSidebarEvents();
  bindProductionShiftControls();
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
    todayBtn.addEventListener('click', () => setProductionWeekStart(getProductionWeekStart(new Date())));
  }

  const editorToggle = document.getElementById('production-editor-toggle');
  if (editorToggle && editorToggle.dataset.bound !== 'true') {
    editorToggle.dataset.bound = 'true';
    editorToggle.addEventListener('click', () => {
      isProductionRowOrderEdit = !isProductionRowOrderEdit;
      editorToggle.classList.toggle('active', isProductionRowOrderEdit);
      if (isProductionRowOrderEdit) {
        const { order } = getProductionAreasWithOrder();
        saveAreasOrder(order);
      }
      renderProductionSchedule();
    });
  }
  if (editorToggle) {
    editorToggle.classList.toggle('active', isProductionRowOrderEdit);
  }

  document.addEventListener('keydown', handleProductionShortcuts);
}

let productionShiftPlanContext = null;

function closeProductionShiftPlanModal() {
  const modal = document.getElementById('production-shift-plan-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.dataset.cardId = '';
  productionShiftPlanContext = null;
}

function openProductionShiftPlanModal({ cardId, date, shift, areaId }) {
  const modal = document.getElementById('production-shift-plan-modal');
  if (!modal) return;
  const card = cards.find(c => c.id === cardId);
  if (!card) {
    showToast('Маршрутная карта не найдена.');
    return;
  }
  if (card.approvalStage !== APPROVAL_STAGE_PROVIDED && card.approvalStage !== APPROVAL_STAGE_PLANNING) {
    showToast('Планировать можно только карты в статусе «Обеспечено» или «Планирование».');
    return;
  }
  if (!canEditShift(date, shift)) {
    showToast('Смена уже завершена.');
    return;
  }
  const employees = getProductionShiftEmployees(date, areaId, shift);
  if (!employees.employeeIds.length) {
    showToast('Нельзя планировать: на смене нет сотрудников.');
    return;
  }

  const area = (areas || []).find(a => a.id === areaId);
  const plannedOpIds = new Set(
    (productionShiftTasks || [])
      .filter(task => task.cardId === cardId)
      .map(task => task.routeOpId)
  );

  const dateLabel = getProductionDayLabel(date);

  const cardInfoEl = document.getElementById('production-shift-plan-card');
  const metaEl = document.getElementById('production-shift-plan-meta');
  const employeesEl = document.getElementById('production-shift-plan-employees');
  const opsEl = document.getElementById('production-shift-plan-ops');

  if (cardInfoEl) {
    cardInfoEl.textContent = getPlanningCardLabel(card);
  }
  if (metaEl) {
    metaEl.textContent = `${dateLabel.date} (${dateLabel.weekday}), смена ${shift}, участок: ${area?.name || '-'}`;
  }
  if (employeesEl) {
    const list = employees.employeeNames.length
      ? `<ul>${employees.employeeNames.map(name => `<li>${name}</li>`).join('')}</ul>`
      : '<p class="muted">Нет сотрудников</p>';
    employeesEl.innerHTML = list;
  }
  if (opsEl) {
    const opsHtml = (card.operations || []).map(op => {
      const opLabel = escapeHtml(op.opName || op.name || op.opCode || '');
      const alreadyPlanned = plannedOpIds.has(op.id);
      const disabled = alreadyPlanned ? ' disabled' : '';
      const note = alreadyPlanned ? '<span class="muted">уже запланировано</span>' : '';
      return `
        <label class="checkbox-row">
          <input type="checkbox" data-route-op-id="${op.id}"${disabled} />
          <span>${opLabel}</span>
          ${note}
        </label>
      `;
    }).join('');
    opsEl.innerHTML = opsHtml || '<p class="muted">Операции не найдены.</p>';
  }

  productionShiftPlanContext = {
    cardId,
    date,
    shift,
    areaId
  };
  modal.dataset.cardId = cardId;
  modal.classList.remove('hidden');
}

async function saveProductionShiftPlan() {
  const modal = document.getElementById('production-shift-plan-modal');
  if (!modal || !productionShiftPlanContext) return;
  const { cardId, date, shift, areaId } = productionShiftPlanContext;
  const card = cards.find(c => c.id === cardId);
  if (!card) {
    closeProductionShiftPlanModal();
    return;
  }
  if (!canEditShift(date, shift)) {
    showToast('Смена уже завершена.');
    return;
  }
  const employees = getProductionShiftEmployees(date, areaId, shift);
  if (!employees.employeeIds.length) {
    showToast('Нельзя планировать: на смене нет сотрудников.');
    return;
  }

  const selected = Array.from(modal.querySelectorAll('input[data-route-op-id]:checked'))
    .map(input => input.getAttribute('data-route-op-id'))
    .filter(Boolean);

  if (!selected.length) {
    showToast('Выберите операции для планирования.');
    return;
  }

  const alreadyPlanned = selected.find(id => (productionShiftTasks || []).some(task => task.routeOpId === id));
  if (alreadyPlanned) {
    showToast('Одна или несколько операций уже запланированы.');
    return;
  }

  const createdBy = currentUser?.name || currentUser?.login || currentUser?.username || '';
  const now = Date.now();

  selected.forEach(routeOpId => {
    const op = (card.operations || []).find(item => item.id === routeOpId);
    if (!op) return;
    productionShiftTasks.push({
      id: genId('pst'),
      cardId: String(cardId),
      routeOpId: String(routeOpId),
      opId: op.opId || '',
      opName: op.opName || op.name || '',
      date: String(date),
      shift: (parseInt(shift, 10) || 1),
      areaId: String(areaId),
      createdAt: now,
      createdBy
    });
  });

  recalcCardPlanningStage(cardId);

  const saved = await saveData();
  if (saved === false) {
    showToast('⚠️ Не удалось сохранить планирование. При обновлении страницы изменения будут потеряны.');
    return;
  }

  closeProductionShiftPlanModal();
  renderProductionShiftsPage();
  showToast('Планирование сохранено');
}

function removeProductionShiftTask(taskId) {
  const task = (productionShiftTasks || []).find(item => item.id === taskId);
  if (!task) return;
  if (!canEditShift(task.date, task.shift)) {
    showToast('Смена уже завершена.');
    return;
  }
  productionShiftTasks = (productionShiftTasks || []).filter(item => item.id !== taskId);
  recalcCardPlanningStage(task.cardId);
  saveData();
  renderProductionShiftsPage();
}

function getPlannedOpsCountForCard(cardId) {
  const cid = String(cardId ?? '');
  const plannedOpIds = new Set(
    (productionShiftTasks || [])
      .filter(task => String(task.cardId ?? '') === cid)
      .map(task => String(task.routeOpId ?? '').trim())
      .filter(id => id.length > 0)
  );
  return plannedOpIds.size;
}

function renderProductionShiftsPage() {
  const section = document.getElementById('production-shifts');
  if (!section) return;

  productionShiftsState.weekStart = productionShiftsState.weekStart || getProductionWeekStart();
  const weekDates = getProductionShiftsWeekDates();
  const todayDateStr = getTodayDateStrLocal();
  const shift = productionShiftsState.selectedShift || 1;
  rebuildProductionShiftTasksIndex();
  const { areasList } = getProductionAreasWithOrder();
  const showPlannedQueue = Boolean(productionShiftsState.showPlannedQueue);
  const queueCards = getPlanningQueueCards(showPlannedQueue);
  const selectedCardExists = queueCards.some(card => card.id === productionShiftsState.selectedCardId);
  if (!selectedCardExists) {
    productionShiftsState.selectedCardId = queueCards[0]?.id || null;
  }
  const selectedCard = queueCards.find(card => card.id === productionShiftsState.selectedCardId) || null;
  const viewMode = productionShiftsState.viewMode || 'queue';

  const shiftButtons = (productionShiftTimes || []).map(item => (
    `<button type="button" class="production-shifts-shift-btn${shift === item.shift ? ' active' : ''}" data-shift="${item.shift}">
      Смена ${item.shift}
    </button>`
  )).join('');

  const queueHtml = queueCards.length
    ? queueCards.map(card => `
        <button type="button" class="production-shifts-card-btn${card.id === productionShiftsState.selectedCardId ? ' active' : ''}" data-card-id="${card.id}">
          <div class="production-shifts-card-title">${escapeHtml(getPlanningCardLabel(card))}</div>
          <div class="muted">Операций: ${getPlannedOpsCountForCard(card.id)}/${(card.operations || []).length}</div>
        </button>
      `).join('')
    : `<p class="muted">${showPlannedQueue ? 'Нет карт со статусом PLANNED.' : 'Нет карт для планирования.'}</p>`;

  const cardViewHtml = (viewMode === 'card' && selectedCard)
    ? `
      <div class="production-shifts-cardview">
        <div class="production-shifts-cardview-header">
          <button type="button" class="btn-secondary btn-small" id="production-shifts-back-to-queue">← К очереди</button>
          <div class="production-shifts-cardview-title">
            <div class="production-shifts-card-title">${escapeHtml(getPlanningCardLabel(selectedCard))}</div>
            <div class="muted">Операций: ${(selectedCard.operations || []).length}</div>
          </div>
        </div>

        <div class="production-shifts-opslist">
          ${(selectedCard.operations || []).length ? (selectedCard.operations || []).map(op => {
            const isPlanned = isRouteOpPlannedInShifts(selectedCard.id, op.id);
            const plannedMin = (op && (op.plannedMinutes != null)) ? op.plannedMinutes : '';
            return `
              <div class="production-shifts-op${isPlanned ? ' planned' : ''}" data-op-id="${op.id}">
                <div class="production-shifts-op-main">
                  <div class="production-shifts-op-name">${escapeHtml(op.opName || '')}</div>
                  <div class="production-shifts-op-meta muted">
                    <span class="production-shifts-op-code">${escapeHtml(op.opCode || '')}</span>
                    <span class="production-shifts-op-planned">План: ${escapeHtml(String(plannedMin))} мин</span>
                  </div>
                </div>
              </div>
            `;
          }).join('') : '<div class="muted">Нет операций</div>'}
        </div>
      </div>
    `
    : '';

  let tableHtml = '<table class="production-table production-shifts-table"><thead><tr><th class="production-shifts-area">Участок</th>';
  weekDates.forEach((date, idx) => {
    const label = getProductionDayLabel(date);
    const weekendClass = isProductionWeekend(date) ? ' weekend' : '';
    const dateStr = formatProductionDate(date);
    const isToday = dateStr === todayDateStr;
    const todayClass = isToday ? ' production-today' : '';

    const left = idx === 0
      ? '<button class="production-day-shift" data-dir="-1" type="button">←</button>'
      : '';
    const right = idx === weekDates.length - 1
      ? '<button class="production-day-shift" data-dir="1" type="button">→</button>'
      : '';

    tableHtml += `
      <th class="production-day${todayClass}${weekendClass}" data-date="${dateStr}">
        <div class="production-day-header">
          ${left}
          <div class="production-day-info">
            <div class="production-day-title">${escapeHtml(label.weekday)}</div>
            <div class="production-day-date">${escapeHtml(label.date)}</div>
          </div>
          ${right}
        </div>
      </th>
    `;
  });
  tableHtml += '</tr></thead><tbody>';

  areasList.forEach(area => {
    tableHtml += `<tr><th class="production-shift-label">${escapeHtml(area.name || '')}</th>`;
    weekDates.forEach(date => {
      const dateStr = formatProductionDate(date);
      const weekendClass = isProductionWeekend(date) ? ' weekend' : '';
      const isToday = dateStr === todayDateStr;
      const todayClass = isToday ? ' production-today' : '';
      const employees = getProductionShiftEmployees(dateStr, area.id, shift);
      const tasks = getProductionShiftTasksForCell(dateStr, shift, area.id);
      const canPlan = employees.employeeIds.length > 0
        && selectedCard
        && (selectedCard.approvalStage === APPROVAL_STAGE_PROVIDED || selectedCard.approvalStage === APPROVAL_STAGE_PLANNING)
        && canEditShift(dateStr, shift);
      const tasksHtml = tasks.length
        ? tasks.map(task => {
          const card = cards.find(c => c.id === task.cardId);
          const label = card ? getPlanningCardLabel(card) : 'МК';
          const removeBtn = canEditShift(dateStr, shift)
            ? `<button type="button" class="btn-icon production-shift-remove" data-task-id="${task.id}" title="Снять план">✕</button>`
            : '';
          return `
            <div class="production-shift-task">
              <div class="production-shift-task-info">
                <div class="production-shift-task-name">${escapeHtml(task.opName || '')}</div>
                <div class="production-shift-task-card">${escapeHtml(label)}</div>
              </div>
              ${removeBtn}
            </div>
          `;
        }).join('')
        : '<div class="muted">Нет операций</div>';

      tableHtml += `
        <td class="production-cell${todayClass}${weekendClass}" data-area-id="${area.id}" data-date="${dateStr}" data-shift="${shift}">
          <div class="production-shift-meta">Люди: ${employees.employeeIds.length}</div>
          <div class="production-shift-ops">${tasksHtml}</div>
          ${canPlan ? `<button type="button" class="btn-secondary btn-small production-shift-plan-btn" data-area-id="${area.id}" data-date="${dateStr}" data-shift="${shift}">Запланировать</button>` : ''}
        </td>
      `;
    });
    tableHtml += '</tr>';
  });

  tableHtml += '</tbody></table>';

  section.innerHTML = `
    <div class="card production-card production-shifts-card">
      <div class="production-toolbar">
        <div class="production-toolbar__left">
          <h2>Сменные задания</h2>
          <div class="production-toolbar__controls">
            <input type="date" id="production-shifts-week-start" aria-label="Неделя" />
            <button type="button" id="production-shifts-today" class="btn-secondary">Текущая дата</button>
            <div class="production-shift-group">${shiftButtons}</div>
          </div>
        </div>
      </div>
      <div class="production-shifts-layout">
        <aside class="production-shifts-queue">
          ${viewMode === 'card' ? cardViewHtml : `
            <div class="production-shifts-queue-header">
              <h3>Очередь планирования</h3>
              <label class="production-shifts-queue-toggle toggle-row">
                <input type="checkbox" id="production-shifts-queue-toggle"${showPlannedQueue ? ' checked' : ''} />
                PLANNED
              </label>
            </div>
            <div class="production-shifts-queue-list">${queueHtml}</div>
          `}
        </aside>
        <div class="production-shifts-table-wrapper">${tableHtml}</div>
      </div>
    </div>
  `;

  const backBtn = document.getElementById('production-shifts-back-to-queue');
  if (backBtn) {
    backBtn.onclick = () => {
      productionShiftsState.viewMode = 'queue';
      renderProductionShiftsPage();
    };
  }

  const weekInput = document.getElementById('production-shifts-week-start');
  if (weekInput) {
    weekInput.value = formatProductionDate(productionShiftsState.weekStart);
    weekInput.onchange = () => setProductionShiftsWeekStart(weekInput.value || getCurrentDateString());
  }
  const todayBtn = document.getElementById('production-shifts-today');
  if (todayBtn) {
    todayBtn.onclick = () => setProductionShiftsWeekStart(getProductionWeekStart(new Date()));
  }
  const queueToggle = document.getElementById('production-shifts-queue-toggle');
  if (queueToggle) {
    queueToggle.onchange = () => {
      productionShiftsState.showPlannedQueue = queueToggle.checked;
      productionShiftsState.selectedCardId = null;
      renderProductionShiftsPage();
    };
  }

  section.querySelectorAll('.production-shifts-shift-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const nextShift = parseInt(btn.getAttribute('data-shift'), 10) || 1;
      setProductionShiftsShift(nextShift);
    });
  });

  section.querySelectorAll('.production-shifts-card-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-card-id');
      productionShiftsState.selectedCardId = id;
      renderProductionShiftsPage();
    });
  });

  section.querySelectorAll('.production-shifts-card-btn').forEach(btn => {
    btn.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const id = btn.getAttribute('data-card-id');
      if (!id) return;

      productionShiftsState.selectedCardId = id;
      showProductionShiftsCardMenu(event.pageX, event.pageY, id);
    });
  });

  section.querySelectorAll('.production-shift-plan-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const date = btn.getAttribute('data-date');
      const areaId = btn.getAttribute('data-area-id');
      const shiftValue = parseInt(btn.getAttribute('data-shift'), 10) || shift;
      if (!productionShiftsState.selectedCardId) {
        showToast('Выберите карту для планирования.');
        return;
      }
      openProductionShiftPlanModal({
        cardId: productionShiftsState.selectedCardId,
        date,
        shift: shiftValue,
        areaId
      });
    });
  });

  section.querySelectorAll('.production-shift-remove').forEach(btn => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const taskId = btn.getAttribute('data-task-id');
      if (taskId) removeProductionShiftTask(taskId);
    });
  });

  // Навигация стрелками календаря (как на /production/schedule)
  if (section.dataset.shiftsNavBound !== 'true') {
    section.dataset.shiftsNavBound = 'true';

    section.addEventListener('click', (event) => {
      const shiftBtn = event.target.closest('.production-day-shift');
      if (!shiftBtn) return;

      event.preventDefault();
      event.stopPropagation();

      const dir = parseInt(shiftBtn.getAttribute('data-dir'), 10) || 0;
      const baseStart = productionShiftsState.weekStart || getProductionWeekStart();
      const nextStart = addDaysToDate(baseStart, dir);
      setProductionShiftsWeekStart(nextStart);
    });
  }
}

function hideProductionShiftsCardMenu() {
  const menu = document.getElementById('production-shifts-card-menu');
  if (!menu) return;
  menu.classList.remove('open');
}

function showProductionShiftsCardMenu(x, y, cardId) {
  let menu = document.getElementById('production-shifts-card-menu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'production-shifts-card-menu';
    menu.className = 'production-context-menu';
    menu.innerHTML = `
      <button type="button" data-action="open">Открыть</button>
      <button type="button" data-action="open-new-tab">Открыть в новой вкладке</button>
      <button type="button" data-action="print">Печать</button>
    `;
    document.body.appendChild(menu);

    menu.addEventListener('click', (event) => {
      const action = event.target.getAttribute('data-action');
      const cid = menu.getAttribute('data-card-id');

      if (!cid) {
        hideProductionShiftsCardMenu();
        return;
      }

      if (action === 'open') {
        productionShiftsState.selectedCardId = cid;
        productionShiftsState.viewMode = 'card';
        hideProductionShiftsCardMenu();
        renderProductionShiftsPage();
        return;
      }

      if (action === 'open-new-tab') {
        const url = '/cards/new?cardId=' + encodeURIComponent(cid);
        window.open(url, '_blank');
        hideProductionShiftsCardMenu();
        return;
      }

      if (action === 'print') {
        const card = (cards || []).find(c => c.id === cid);
        if (card) printCardView(card);
        hideProductionShiftsCardMenu();
        return;
      }

      hideProductionShiftsCardMenu();
    });
  }

  menu.setAttribute('data-card-id', String(cardId || ''));
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.classList.add('open');

  document.addEventListener('click', hideProductionShiftsCardMenu, { once: true });
}

function bindProductionShiftPlanModal() {
  const modal = document.getElementById('production-shift-plan-modal');
  if (!modal || modal.dataset.bound === 'true') return;
  modal.dataset.bound = 'true';

  const closeBtn = document.getElementById('production-shift-plan-close');
  const saveBtn = document.getElementById('production-shift-plan-save');
  if (closeBtn) closeBtn.addEventListener('click', closeProductionShiftPlanModal);
  if (saveBtn) saveBtn.addEventListener('click', saveProductionShiftPlan);

  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeProductionShiftPlanModal();
  });
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
  if (targetId === 'production-shifts' && !fromRestore) {
    renderProductionShiftsPage();
  }
}

function saveProductionShiftTimes(container) {
  if (!container) return;
  const inputs = container.querySelectorAll('input[type="time"]');
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
  renderProductionSchedule();
}

function renderProductionShiftTimesPage() {
  const container = document.getElementById('shift-times-body');
  if (!container) return;
  renderProductionShiftTimesForm(container);
  const saveBtn = document.getElementById('shift-times-save');
  const resetBtn = document.getElementById('shift-times-reset');
  if (saveBtn && saveBtn.dataset.bound !== 'true') {
    saveBtn.dataset.bound = 'true';
    saveBtn.addEventListener('click', () => {
      saveProductionShiftTimes(container);
      renderProductionShiftTimesForm(container);
    });
  }
  if (resetBtn && resetBtn.dataset.bound !== 'true') {
    resetBtn.dataset.bound = 'true';
    resetBtn.addEventListener('click', () => renderProductionShiftTimesForm(container));
  }
}

function setupProductionModule() {
  productionScheduleState.weekStart = getProductionWeekStart();
  productionShiftsState.weekStart = getProductionWeekStart();
  setupProductionScheduleControls();
  bindProductionSidebarEvents();
  bindProductionTableEvents();
  bindProductionShiftPlanModal();
}
