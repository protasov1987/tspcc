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
  viewMode: 'queue',
  queueSearch: ''
};

const productionShiftBoardState = {
  windowStart: null,
  selectedShiftId: null,
  selectedCardId: null,
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

function getShiftDurationMinutes(shift) {
  const range = (typeof getProductionShiftTimeRange === 'function')
    ? getProductionShiftTimeRange(shift)
    : (typeof getShiftTimeRange === 'function')
      ? getShiftTimeRange(shift)
      : getShiftRange(shift);

  if (range && range.start != null && range.end != null) {
    const startValue = typeof range.start === 'string' ? parseProductionTime(range.start) : range.start;
    const endValue = typeof range.end === 'string' ? parseProductionTime(range.end) : range.end;
    if (Number.isFinite(startValue) && Number.isFinite(endValue)) {
      let startMin = startValue;
      let endMin = endValue;
      if (endMin <= startMin) endMin += 24 * 60;
      return Math.max(1, endMin - startMin);
    }
  }

  return 8 * 60;
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

function getCurrentUserName() {
  return currentUser?.name || currentUser?.login || currentUser?.username || '';
}

function getProductionShiftId(dateStr, shift) {
  const date = String(dateStr || '');
  const num = parseInt(shift, 10) || 1;
  return `SHIFT_${date}_${num}`;
}

function getProductionShiftTimeRef(shift) {
  const num = parseInt(shift, 10) || 1;
  const ref = (productionShiftTimes || []).find(s => s.shift === num);
  if (ref) return ref;
  const fallback = getDefaultProductionShiftTimes();
  return fallback.find(s => s.shift === num) || fallback[0];
}

function shouldAutoCreateShift(dateStr, shift) {
  const date = String(dateStr || '');
  const num = parseInt(shift, 10) || 1;
  const hasSchedule = (productionSchedule || []).some(rec => rec.date === date && rec.shift === num);
  const hasTasks = (productionShiftTasks || []).some(task => task.date === date && task.shift === num);
  return hasSchedule || hasTasks;
}

function recordShiftLog(shift, { action, object, field = null, targetId = null, oldValue = '', newValue = '' }) {
  if (!shift) return;
  if (!Array.isArray(shift.logs)) shift.logs = [];
  shift.logs.push({
    id: genId('shiftlog'),
    ts: Date.now(),
    action: action || '',
    object: object || '',
    targetId,
    field,
    oldValue: formatLogValue(oldValue),
    newValue: formatLogValue(newValue),
    createdBy: getCurrentUserName()
  });
}

function ensureProductionShift(dateStr, shift, { reason = 'data' } = {}) {
  if (!Array.isArray(productionShifts)) productionShifts = [];
  const date = String(dateStr || '');
  const num = parseInt(shift, 10) || 1;
  const id = getProductionShiftId(date, num);
  let existing = (productionShifts || []).find(item => item.id === id);
  if (existing) return existing;
  const shouldCreate = reason === 'manual' || (reason === 'data' && shouldAutoCreateShift(date, num));
  if (!shouldCreate) return null;
  const ref = getProductionShiftTimeRef(num);
  existing = {
    id,
    date,
    shift: num,
    timeFrom: ref?.timeFrom || '00:00',
    timeTo: ref?.timeTo || '00:00',
    status: 'PLANNING',
    openedAt: null,
    openedBy: null,
    closedAt: null,
    closedBy: null,
    lockedAt: null,
    lockedBy: null,
    initialSnapshot: null,
    logs: []
  };
  productionShifts.push(existing);
  recordShiftLog(existing, { action: 'CREATE_SHIFT', object: 'Смена' });
  return existing;
}

function ensureProductionShiftsFromData() {
  (productionSchedule || []).forEach(rec => {
    ensureProductionShift(rec.date, rec.shift, { reason: 'data' });
  });
  (productionShiftTasks || []).forEach(task => {
    ensureProductionShift(task.date, task.shift, { reason: 'data' });
  });
}

function getProductionShiftStatus(dateStr, shift) {
  const existing = ensureProductionShift(dateStr, shift, { reason: 'data' });
  return existing?.status || 'PLANNING';
}

function isShiftClosedOrLocked(dateStr, shift) {
  const status = getProductionShiftStatus(dateStr, shift);
  return status === 'CLOSED' || status === 'LOCKED';
}

function canEditShiftWithStatus(dateStr, shift) {
  return canEditShift(dateStr, shift) && !isShiftClosedOrLocked(dateStr, shift);
}

function logProductionScheduleChange(record, action) {
  if (!record) return;
  const shiftRecord = ensureProductionShift(record.date, record.shift, { reason: 'data' });
  if (!shiftRecord) return;
  recordShiftLog(shiftRecord, {
    action,
    object: 'Сотрудник',
    targetId: record.employeeId || null,
    field: null,
    oldValue: '',
    newValue: ''
  });
}

function logProductionTaskChange(task, action) {
  if (!task) return;
  const shiftRecord = ensureProductionShift(task.date, task.shift, { reason: 'data' });
  if (!shiftRecord) return;
  recordShiftLog(shiftRecord, {
    action,
    object: 'Операция',
    targetId: task.routeOpId || null,
    field: null,
    oldValue: '',
    newValue: ''
  });
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

function getOperationTotalMinutes(cardId, routeOpId) {
  const card = (cards || []).find(c => String(c.id) === String(cardId));
  if (!card) return 0;
  const op = (card.operations || []).find(item => String(item.id) === String(routeOpId));
  const minutes = Number(op?.plannedMinutes);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
}

function getTaskPlannedMinutes(task) {
  if (!task) return 0;
  const plannedPart = Number(task.plannedPartMinutes);
  if (Number.isFinite(plannedPart) && plannedPart > 0) return plannedPart;
  const total = getOperationTotalMinutes(task.cardId, task.routeOpId);
  return total > 0 ? total : 0;
}

function getTaskTotalMinutes(task) {
  if (!task) return 0;
  const plannedTotal = Number(task.plannedTotalMinutes);
  if (Number.isFinite(plannedTotal) && plannedTotal > 0) return plannedTotal;
  return getOperationTotalMinutes(task.cardId, task.routeOpId);
}

function getOperationPlannedMinutes(cardId, routeOpId) {
  if (!cardId || !routeOpId) return 0;
  return (productionShiftTasks || [])
    .filter(task => String(task.cardId) === String(cardId) && String(task.routeOpId) === String(routeOpId))
    .reduce((sum, task) => sum + getTaskPlannedMinutes(task), 0);
}

function getOperationRemainingMinutes(cardId, routeOpId) {
  const total = getOperationTotalMinutes(cardId, routeOpId);
  const planned = getOperationPlannedMinutes(cardId, routeOpId);
  return Math.max(0, total - planned);
}

function getShiftPlannedMinutes(dateStr, shift, areaId) {
  const tasks = getProductionShiftTasksForCell(dateStr, shift, areaId);
  return (tasks || []).reduce((sum, task) => sum + getTaskPlannedMinutes(task), 0);
}

function getShiftFreeMinutes(dateStr, shift, areaId) {
  const shiftTotal = getShiftDurationMinutes(shift);
  return Math.max(0, shiftTotal - getShiftPlannedMinutes(dateStr, shift, areaId));
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
  return getOperationRemainingMinutes(cardId, routeOpId) === 0;
}

function getPlanningCardLabel(card) {
  if (!card) return '';
  const number = (card.routeCardNumber || '').trim();
  const name = (card.itemName || card.name || '').trim();
  if (number && name) return `${number} — ${name}`;
  return number || name || 'Маршрутная карта';
}

function getShiftBoardCardLabel(card) {
  if (!card) return 'Маршрутная карта';
  const number = (card.routeCardNumber || '').trim();
  const name = (card.itemName || card.name || '').trim();
  if (number && name) return `Маршрутная карта №${number} — ${name}`;
  if (number) return `Маршрутная карта №${number}`;
  return name || 'Маршрутная карта';
}

function normalizeQueueSearchValue(value) {
  return (value || '').toString().trim().toLowerCase();
}

function getProductionQueueCardSearchIndex(card) {
  if (!card) return '';
  const number = normalizeQueueSearchValue(card.routeCardNumber);
  const qrCode = normalizeQueueSearchValue(card.qrId);
  const name = normalizeQueueSearchValue(card.itemName || card.name);
  const basis = normalizeQueueSearchValue(card.workBasis);
  return [number, qrCode, name, basis].filter(Boolean).join(' ');
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
  if (!canEditShiftWithStatus(record.date, record.shift)) {
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
  logProductionScheduleChange(record, 'ADD_EMPLOYEE_TO_SHIFT');
  return { created: true };
}

function addEmployeesToProductionCell() {
  const cell = productionScheduleState.selectedCell;
  if (!cell) {
    alert('Выберите ячейку расписания');
    return;
  }
  if (!canEditShiftWithStatus(cell.date, cell.shift)) {
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
    group.targets.some(target => !canEditShiftWithStatus(target.date, target.shift || cell.shift))
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
      logProductionScheduleChange(record, 'ADD_EMPLOYEE_TO_SHIFT');
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
  if (!canEditShiftWithStatus(date, shift)) {
    showToast('Смена уже завершена. Редактирование запрещено');
    return;
  }

  // delete whole day (column)
  if (areaId === null) {
    const before = productionSchedule.length;
    const removedRecords = productionSchedule.filter(rec => rec.date === date && rec.shift === shift);
    productionSchedule = productionSchedule.filter(rec => rec.date !== date || rec.shift !== shift);
    const removed = before !== productionSchedule.length;
    productionScheduleState.selectedCellEmployeeId = null;
    removedRecords.forEach(rec => logProductionScheduleChange(rec, 'REMOVE_EMPLOYEE_FROM_SHIFT'));
    if (removed) {
      saveData();
      renderProductionSchedule();
    }
    return;
  }

  const before = productionSchedule.length;
  const removedRecords = productionSchedule.filter(rec => {
    if (rec.date !== date || rec.areaId !== areaId || rec.shift !== shift) return false;
    if (employeeId && rec.employeeId !== employeeId) return false;
    return true;
  });
  productionSchedule = productionSchedule.filter(rec => {
    if (rec.date !== date || rec.areaId !== areaId || rec.shift !== shift) return true;
    if (employeeId && rec.employeeId !== employeeId) return true;
    return false;
  });
  const removed = before !== productionSchedule.length;
  productionScheduleState.selectedCellEmployeeId = null;
  removedRecords.forEach(rec => logProductionScheduleChange(rec, 'REMOVE_EMPLOYEE_FROM_SHIFT'));
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
  if (!canEditShiftWithStatus(cell.date, cell.shift)) {
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
    logProductionScheduleChange({
      date: cell.date,
      shift: cell.shift,
      areaId: cell.areaId,
      employeeId: empId,
      timeFrom: clip.item.timeFrom ?? null,
      timeTo: clip.item.timeTo ?? null
    }, 'ADD_EMPLOYEE_TO_SHIFT');

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

    const removedRecords = productionSchedule.filter(rec => rec.date === cell.date && rec.shift === cell.shift);
    productionSchedule = productionSchedule.filter(rec => rec.date !== cell.date || rec.shift !== cell.shift);
    removedRecords.forEach(rec => logProductionScheduleChange(rec, 'REMOVE_EMPLOYEE_FROM_SHIFT'));

    clip.items.forEach(item => {
      const record = {
        date: cell.date,
        shift: cell.shift,
        areaId: item.areaId,
        employeeId: item.employeeId,
        timeFrom: item.timeFrom ?? null,
        timeTo: item.timeTo ?? null
      };
      productionSchedule.push(record);
      logProductionScheduleChange(record, 'ADD_EMPLOYEE_TO_SHIFT');
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

    const removedRecords = productionSchedule.filter(
      rec => rec.date === cell.date && rec.shift === cell.shift && rec.areaId === cell.areaId
    );
    productionSchedule = productionSchedule.filter(
      rec => rec.date !== cell.date || rec.shift !== cell.shift || rec.areaId !== cell.areaId
    );
    removedRecords.forEach(rec => logProductionScheduleChange(rec, 'REMOVE_EMPLOYEE_FROM_SHIFT'));

    clip.items.forEach(item => {
      const record = {
        date: cell.date,
        shift: cell.shift,
        areaId: cell.areaId,
        employeeId: item.employeeId,
        timeFrom: item.timeFrom ?? null,
        timeTo: item.timeTo ?? null
      };
      productionSchedule.push(record);
      logProductionScheduleChange(record, 'ADD_EMPLOYEE_TO_SHIFT');
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
  ensureProductionShiftsFromData();
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

function updateProductionShiftPlanMode(mode) {
  const partEl = document.getElementById('production-shift-plan-part');
  if (!partEl) return;
  const manualEl = partEl.querySelector('.production-shift-plan-manual');
  const fillEl = partEl.querySelector('.production-shift-plan-fill');
  if (manualEl) manualEl.classList.toggle('hidden', mode !== 'manual');
  if (fillEl) fillEl.classList.toggle('hidden', mode !== 'fill');
}

function updateProductionShiftPlanPart(routeOpId) {
  const partEl = document.getElementById('production-shift-plan-part');
  if (!partEl || !productionShiftPlanContext) return;
  if (!routeOpId) {
    partEl.classList.add('hidden');
    partEl.innerHTML = '';
    return;
  }
  const { cardId, date, shift, areaId } = productionShiftPlanContext;
  const total = getOperationTotalMinutes(cardId, routeOpId);
  const planned = getOperationPlannedMinutes(cardId, routeOpId);
  const remaining = Math.max(0, total - planned);
  const shiftFree = getShiftFreeMinutes(date, shift, areaId);
  if (total <= 0) {
    showToast('Не задана длительность операции (plannedMinutes)');
    const modal = document.getElementById('production-shift-plan-modal');
    if (modal) {
      const input = modal.querySelector(`input[data-route-op-id="${routeOpId}"]`);
      if (input) input.checked = false;
    }
    partEl.classList.add('hidden');
    partEl.innerHTML = '';
    return;
  }
  const defaultMinutes = Math.max(1, Math.min(remaining, shiftFree));
  const fillMinutes = Math.min(remaining, shiftFree);
  const fillText = shiftFree <= 0
    ? 'Смена уже загружена на 100%'
    : `Будет добавлено: ${fillMinutes} мин`;
  partEl.innerHTML = `
    <div class="production-shift-plan-part-title">Планировать часть операции</div>
    <div class="row">План: ${total} мин</div>
    <div class="row">Уже запланировано: ${planned} мин</div>
    <div class="row">Осталось: ${remaining} мин</div>
    <div class="row">Свободно в смене: ${shiftFree} мин</div>
    <div class="production-shift-plan-part-modes">
      <label class="checkbox-row">
        <input type="radio" name="production-shift-plan-mode" value="manual" checked />
        <span>Указать минуты</span>
      </label>
      <div class="production-shift-plan-manual">
        <input type="number" id="production-shift-plan-minutes" min="1" max="${Math.max(1, remaining)}" value="${defaultMinutes}" />
      </div>
      <label class="checkbox-row">
        <input type="radio" name="production-shift-plan-mode" value="fill" />
        <span>До 100% загрузки смены</span>
      </label>
      <div class="production-shift-plan-fill muted hidden">${fillText}</div>
    </div>
  `;
  partEl.classList.remove('hidden');
  updateProductionShiftPlanMode('manual');
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
  if (!canEditShiftWithStatus(date, shift)) {
    showToast('Смена уже завершена.');
    return;
  }
  const employees = getProductionShiftEmployees(date, areaId, shift);
  if (!employees.employeeIds.length) {
    showToast('Нельзя планировать: на смене нет сотрудников.');
    return;
  }

  const area = (areas || []).find(a => a.id === areaId);
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
      const totalMinutes = getOperationTotalMinutes(cardId, op.id);
      const plannedMinutes = getOperationPlannedMinutes(cardId, op.id);
      const remainingMinutes = getOperationRemainingMinutes(cardId, op.id);
      const alreadyPlanned = remainingMinutes === 0;
      const disabled = alreadyPlanned ? ' disabled' : '';
      const pct = totalMinutes > 0 ? Math.round((plannedMinutes / totalMinutes) * 100) : 0;
      const progressNote = !alreadyPlanned && totalMinutes > 0
        ? `<span class="muted">Запланировано: ${plannedMinutes} / ${totalMinutes} мин (${pct}%)</span>`
        : '';
      const note = alreadyPlanned
        ? '<span class="muted">уже запланировано</span>'
        : progressNote;
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
  const partEl = document.getElementById('production-shift-plan-part');
  if (partEl) {
    partEl.classList.add('hidden');
    partEl.innerHTML = '';
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
  if (!canEditShiftWithStatus(date, shift)) {
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
    showToast('Выберите операцию');
    return;
  }

  const routeOpId = selected[0];

  const totalMinutes = getOperationTotalMinutes(cardId, routeOpId);
  const plannedMinutes = getOperationPlannedMinutes(cardId, routeOpId);
  const remainingMinutes = Math.max(0, totalMinutes - plannedMinutes);
  const shiftFreeMinutes = getShiftFreeMinutes(date, shift, areaId);
  if (totalMinutes <= 0) {
    showToast('Не задана длительность операции (plannedMinutes)');
    return;
  }

  const modeInput = modal.querySelector('input[name="production-shift-plan-mode"]:checked');
  const mode = modeInput ? modeInput.value : 'manual';
  let plannedPartMinutes = 0;
  if (mode === 'manual') {
    const input = modal.querySelector('#production-shift-plan-minutes');
    const rawMinutes = Number(input?.value);
    if (Number.isFinite(rawMinutes) && remainingMinutes > 0) {
      plannedPartMinutes = Math.min(Math.max(rawMinutes, 1), remainingMinutes);
    }
  } else {
    plannedPartMinutes = remainingMinutes > 0 ? Math.min(remainingMinutes, shiftFreeMinutes) : 0;
  }

  if (plannedPartMinutes <= 0) {
    if (remainingMinutes === 0) {
      showToast('Операция уже запланирована на 100%');
    } else if (shiftFreeMinutes === 0) {
      showToast('Смена уже загружена на 100%');
    }
    return;
  }

  const createdBy = currentUser?.name || currentUser?.login || currentUser?.username || '';
  const now = Date.now();

  const op = (card.operations || []).find(item => item.id === routeOpId);
  if (!op) return;
  const record = {
    id: genId('pst'),
    cardId: String(cardId),
    routeOpId: String(routeOpId),
    opId: op.opId || '',
    opName: op.opName || op.name || '',
    date: String(date),
    shift: (parseInt(shift, 10) || 1),
    areaId: String(areaId),
    plannedPartMinutes,
    plannedTotalMinutes: totalMinutes,
    isPartial: plannedPartMinutes < totalMinutes,
    createdAt: now,
    createdBy
  };
  productionShiftTasks.push(record);
  logProductionTaskChange(record, 'ADD_TASK_TO_SHIFT');

  recalcCardPlanningStage(cardId);

  const saved = await saveData();
  if (saved === false) {
    showToast('⚠️ Не удалось сохранить планирование. При обновлении страницы изменения будут потеряны.');
    return;
  }

  renderProductionShiftsPage();
  openProductionShiftPlanModal({ cardId, date, shift, areaId });
  showToast(`Операция добавлена: ${plannedPartMinutes} мин`);
}

function removeProductionShiftTask(taskId) {
  const task = (productionShiftTasks || []).find(item => item.id === taskId);
  if (!task) return;
  if (!canEditShiftWithStatus(task.date, task.shift)) {
    showToast('Смена уже завершена.');
    return;
  }
  const card = (cards || []).find(c => c.id === task.cardId);
  const op = (card?.operations || []).find(item => item.id === task.routeOpId);
  if (!op || op.status !== 'NOT_STARTED') {
    showToast('Нельзя удалить операцию: операция уже в работе.');
    return;
  }
  productionShiftTasks = (productionShiftTasks || []).filter(item => item.id !== taskId);
  logProductionTaskChange(task, 'REMOVE_TASK_FROM_SHIFT');
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
  const isPlanRoute = window.location.pathname === '/production/plan';
  const pageTitle = isPlanRoute ? 'План производства' : 'Сменные задания';

  productionShiftsState.weekStart = productionShiftsState.weekStart || getProductionWeekStart();
  productionShiftsState.queueSearch = productionShiftsState.queueSearch || '';
  ensureProductionShiftsFromData();
  const weekDates = getProductionShiftsWeekDates();
  const todayDateStr = getTodayDateStrLocal();
  const shift = productionShiftsState.selectedShift || 1;
  rebuildProductionShiftTasksIndex();
  const { areasList } = getProductionAreasWithOrder();
  const showPlannedQueue = Boolean(productionShiftsState.showPlannedQueue);
  const viewMode = productionShiftsState.viewMode || 'queue';
  const selectedCardId = productionShiftsState.selectedCardId || null;
  const queueCards = getPlanningQueueCards(showPlannedQueue);
  if (viewMode !== 'card') {
    const selectedCardExists = queueCards.some(card => card.id === selectedCardId);
    if (!selectedCardExists) {
      productionShiftsState.selectedCardId = queueCards[0]?.id || null;
    }
  }
  const resolvedSelectedCardId = productionShiftsState.selectedCardId || null;
  let selectedCard = null;
  if (viewMode === 'card' && selectedCardId) {
    selectedCard = (cards || []).find(card => card.id === selectedCardId) || null;
  } else if (resolvedSelectedCardId) {
    selectedCard = (queueCards || []).find(card => card.id === resolvedSelectedCardId) || null;
  }
  if (viewMode === 'card' && selectedCardId && !selectedCard) {
    productionShiftsState.viewMode = 'queue';
    showToast('Карта не найдена', 'warning');
  }

  const shiftButtons = (productionShiftTimes || []).map(item => (
    `<button type="button" class="production-shifts-shift-btn${shift === item.shift ? ' active' : ''}" data-shift="${item.shift}">
      Смена ${item.shift}
    </button>`
  )).join('');

  const queueSearch = normalizeQueueSearchValue(productionShiftsState.queueSearch);
  const filteredQueueCards = queueSearch
    ? queueCards.filter(card => getProductionQueueCardSearchIndex(card).includes(queueSearch))
    : queueCards;
  const queueEmptyLabel = queueSearch
    ? 'Ничего не найдено.'
    : (showPlannedQueue ? 'Нет карт со статусом PLANNED.' : 'Нет карт для планирования.');
  const queueHtml = filteredQueueCards.length
    ? filteredQueueCards.map(card => `
        <button type="button" class="production-shifts-card-btn${card.id === productionShiftsState.selectedCardId ? ' active' : ''}" data-card-id="${card.id}">
          <div class="production-shifts-card-title">${escapeHtml(getPlanningCardLabel(card))}</div>
          <div class="muted">Операций: ${getPlannedOpsCountForCard(card.id)}/${(card.operations || []).length}</div>
        </button>
      `).join('')
    : `<p class="muted">${queueEmptyLabel}</p>`;

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
      const focusCardId = productionShiftsState.selectedCardId || null;
      const shiftTotalMinutes = getShiftDurationMinutes(shift);
      const plannedSumMinutes = getShiftPlannedMinutes(dateStr, shift, area.id);
      const loadPct = Math.min(999, Math.max(0, Math.round((plannedSumMinutes / shiftTotalMinutes) * 100)));
      const loadPctHtml = `<div class="production-shifts-load" title="Загрузка: ${plannedSumMinutes} / ${shiftTotalMinutes} мин">${loadPct}%</div>`;
      const canPlan = employees.employeeIds.length > 0
        && selectedCard
        && (selectedCard.approvalStage === APPROVAL_STAGE_PROVIDED || selectedCard.approvalStage === APPROVAL_STAGE_PLANNING)
        && canEditShiftWithStatus(dateStr, shift);
      const tasksHtml = tasks.length
        ? tasks.map(task => {
          const card = cards.find(c => c.id === task.cardId);
          const label = card ? getPlanningCardLabel(card) : 'МК';
          const isFocusTask = focusCardId && task.cardId === focusCardId;
          const focusClass = isFocusTask ? ' focus' : '';
          const totalMinutes = getTaskTotalMinutes(task);
          const partMinutes = getTaskPlannedMinutes(task);
          const pct = totalMinutes > 0 ? Math.round((partMinutes / totalMinutes) * 100) : 0;
          const showPart = totalMinutes > 0 && partMinutes < totalMinutes;
          const partLabel = totalMinutes > 0 ? `${partMinutes} мин (${pct}%)` : `${partMinutes} мин`;
          const removeBtn = canEditShiftWithStatus(dateStr, shift)
            ? `<button type="button" class="btn-icon production-shift-remove" data-task-id="${task.id}" title="Снять план">✕</button>`
            : '';
          return `
            <div class="production-shift-task${focusClass}" data-task-card-id="${task.cardId}" data-task-route-op-id="${task.routeOpId}">
              <div class="production-shift-task-info">
                <div class="production-shift-task-name">${escapeHtml(task.opName || '')}</div>
                ${showPart ? `<div class="production-shift-task-minutes">${escapeHtml(partLabel)}</div>` : ''}
                <div class="production-shift-task-card">${escapeHtml(label)}</div>
              </div>
              ${removeBtn}
            </div>
          `;
        }).join('')
        : '<div class="muted">Нет операций</div>';

      tableHtml += `
        <td class="production-cell production-shifts-cell${todayClass}${weekendClass}" data-area-id="${area.id}" data-date="${dateStr}" data-shift="${shift}">
          ${loadPctHtml}
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
          <h2>${pageTitle}</h2>
          <div class="production-shifts-toolbar-row">
            ${viewMode !== 'card' ? `
              <input
                type="search"
                class="production-shifts-queue-search"
                id="production-shifts-queue-search"
                placeholder="Поиск по МК"
                value="${escapeHtml(productionShiftsState.queueSearch || '')}"
              />
            ` : ''}
            <div class="production-toolbar__controls">
              <input type="date" id="production-shifts-week-start" aria-label="Неделя" />
              <button type="button" id="production-shifts-today" class="btn-secondary">Текущая дата</button>
              <div class="production-shift-group">${shiftButtons}</div>
            </div>
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
  const queueSearchInput = document.getElementById('production-shifts-queue-search');
  if (queueSearchInput) {
    queueSearchInput.value = productionShiftsState.queueSearch || '';
    queueSearchInput.oninput = () => {
      productionShiftsState.queueSearch = queueSearchInput.value || '';
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

  section.querySelectorAll('.production-shift-task').forEach(el => {
    el.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();

      const cardId = el.getAttribute('data-task-card-id');
      if (!cardId) return;

      productionShiftsState.selectedCardId = cardId;
      showProductionShiftsTaskMenu(event.pageX, event.pageY, cardId);
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

function renderProductionPlanPage() {
  renderProductionShiftsPage();
}

function getProductionShiftNumbers() {
  const list = (productionShiftTimes && productionShiftTimes.length)
    ? productionShiftTimes
    : getDefaultProductionShiftTimes();
  const unique = Array.from(new Set(list.map(item => parseInt(item.shift, 10) || 1)));
  unique.sort((a, b) => a - b);
  return unique.length ? unique : [1];
}

function getProductionShiftWindowStart() {
  if (productionShiftBoardState.windowStart) {
    return productionShiftBoardState.windowStart;
  }
  const today = getTodayDateStrLocal();
  const shifts = getProductionShiftNumbers();
  const start = { date: today, shift: shifts[0] };
  productionShiftBoardState.windowStart = start;
  return start;
}

function shiftSlotKey(dateStr, shift) {
  return `${dateStr}|${shift}`;
}

function moveShiftSlot(slot, dir) {
  const shifts = getProductionShiftNumbers();
  const idx = Math.max(0, shifts.indexOf(slot.shift));
  let nextIdx = idx + dir;
  let date = new Date(slot.date + 'T00:00:00');
  if (nextIdx >= shifts.length) {
    nextIdx = 0;
    date = addDaysToDate(date, 1);
  }
  if (nextIdx < 0) {
    nextIdx = shifts.length - 1;
    date = addDaysToDate(date, -1);
  }
  return { date: formatProductionDate(date), shift: shifts[nextIdx] };
}

function getProductionShiftWindowSlots() {
  const start = getProductionShiftWindowStart();
  const slots = [start];
  for (let i = 1; i < 3; i += 1) {
    slots.push(moveShiftSlot(slots[i - 1], 1));
  }
  return slots;
}

function getShiftHeaderLabel(dateStr) {
  const label = getProductionDayLabel(dateStr);
  const weekday = (label.weekday || '').toUpperCase();
  return `${weekday}. ${label.date}`;
}

function resolveShiftDisplayData(slot) {
  const record = ensureProductionShift(slot.date, slot.shift, { reason: 'data' });
  const ref = getProductionShiftTimeRef(slot.shift);
  return {
    record,
    status: record?.status || 'PLANNING',
    timeFrom: record?.timeFrom || ref?.timeFrom || '00:00',
    timeTo: record?.timeTo || ref?.timeTo || '00:00'
  };
}

function buildShiftCellOps(dateStr, shift, areaId) {
  const tasks = getProductionShiftTasksForCell(dateStr, shift, areaId);
  if (!tasks.length) return '<div class="muted">Нет операций</div>';
  const grouped = new Map();
  tasks.forEach(task => {
    if (!grouped.has(task.cardId)) grouped.set(task.cardId, []);
    grouped.get(task.cardId).push(task);
  });
  return Array.from(grouped.entries()).map(([cardId, list]) => {
    const card = (cards || []).find(c => c.id === cardId);
    const cardLabel = card ? getPlanningCardLabel(card) : 'МК';
    const ops = list.map(task => escapeHtml(task.opName || '')).filter(Boolean);
    const opsHtml = ops.length
      ? ops.map(op => `<div class="production-shift-board-op" data-card-id="${cardId}">${op}</div>`).join('')
      : '<div class="muted">Без операций</div>';
    return `
      <div class="production-shift-board-card">
        <div class="production-shift-board-card-title">${escapeHtml(cardLabel)}</div>
        ${opsHtml}
      </div>
    `;
  }).join('');
}

function buildShiftBoardQueue(selectedSlot) {
  if (!selectedSlot) {
    return '<p class="muted">Смена не выбрана.</p>';
  }
  const tasks = (productionShiftTasks || [])
    .filter(task => task.date === selectedSlot.date && task.shift === selectedSlot.shift);
  if (!tasks.length) return '<p class="muted">Нет заданий для выбранной смены.</p>';
  const grouped = new Map();
  tasks.forEach(task => {
    if (!grouped.has(task.cardId)) grouped.set(task.cardId, []);
    grouped.get(task.cardId).push(task);
  });
  return Array.from(grouped.entries()).map(([cardId, list]) => {
    const card = (cards || []).find(c => c.id === cardId);
    const cardLabel = card ? getShiftBoardCardLabel(card) : 'Маршрутная карта';
    const routeOpIds = Array.from(new Set(list.map(task => String(task.routeOpId || '')).filter(Boolean)));
    const totalCount = routeOpIds.length;
    const doneCount = routeOpIds.reduce((acc, routeOpId) => {
      const op = (card?.operations || []).find(item => item.id === routeOpId);
      return acc + (op?.status === 'DONE' ? 1 : 0);
    }, 0);
    return `
      <button type="button" class="production-shifts-card-btn production-shift-board-queue-card" data-card-id="${cardId}">
        <div class="production-shifts-card-title">${escapeHtml(cardLabel)}</div>
        <div class="muted">Операций: ${doneCount}/${totalCount}</div>
      </button>
    `;
  }).join('');
}

function openShiftBySlot(slot) {
  const shiftRecord = ensureProductionShift(slot.date, slot.shift, { reason: 'manual' });
  if (!shiftRecord) return;
  const openCount = (productionShifts || []).filter(item => item.status === 'OPEN').length;
  if (openCount >= 2) {
    showToast('Нельзя открыть больше двух смен одновременно');
    return;
  }
  if (shiftRecord.status !== 'PLANNING') return;
  const now = Date.now();
  shiftRecord.status = 'OPEN';
  shiftRecord.openedAt = now;
  shiftRecord.openedBy = getCurrentUserName();
  if (!shiftRecord.initialSnapshot) {
    const employees = (productionSchedule || [])
      .filter(rec => rec.date === slot.date && rec.shift === slot.shift)
      .map(rec => ({ ...rec }));
    const tasks = (productionShiftTasks || [])
      .filter(task => task.date === slot.date && task.shift === slot.shift)
      .map(task => ({ ...task }));
    shiftRecord.initialSnapshot = {
      createdAt: now,
      createdBy: getCurrentUserName(),
      employees,
      tasks
    };
    recordShiftLog(shiftRecord, { action: 'CREATE_SNAPSHOT', object: 'Смена' });
  }
  recordShiftLog(shiftRecord, {
    action: 'OPEN_SHIFT',
    object: 'Смена',
    field: 'status',
    oldValue: 'PLANNING',
    newValue: 'OPEN'
  });
  saveData();
  renderProductionShiftBoardPage();
}

function closeShiftBySlot(slot) {
  const shiftRecord = ensureProductionShift(slot.date, slot.shift, { reason: 'data' });
  if (!shiftRecord || shiftRecord.status !== 'OPEN') return;
  const tasks = (productionShiftTasks || [])
    .filter(task => task.date === slot.date && task.shift === slot.shift);
  const allowedStatuses = new Set(['NOT_STARTED', 'DONE']);
  const hasInProgress = tasks.some(task => {
    const card = (cards || []).find(c => c.id === task.cardId);
    const op = (card?.operations || []).find(item => item.id === task.routeOpId);
    return !allowedStatuses.has(op?.status);
  });
  if (hasInProgress) {
    showToast('Нельзя закрыть смену: есть операции в работе');
    return;
  }
  const now = Date.now();
  shiftRecord.status = 'CLOSED';
  shiftRecord.closedAt = now;
  shiftRecord.closedBy = getCurrentUserName();
  recordShiftLog(shiftRecord, {
    action: 'CLOSE_SHIFT',
    object: 'Смена',
    field: 'status',
    oldValue: 'OPEN',
    newValue: 'CLOSED'
  });
  saveData();
  renderProductionShiftBoardPage();
}

function lockShiftBySlot(slot) {
  const shiftRecord = ensureProductionShift(slot.date, slot.shift, { reason: 'data' });
  if (!shiftRecord || shiftRecord.status !== 'CLOSED') return;
  const now = Date.now();
  shiftRecord.status = 'LOCKED';
  shiftRecord.lockedAt = now;
  shiftRecord.lockedBy = getCurrentUserName();
  recordShiftLog(shiftRecord, {
    action: 'LOCK_SHIFT',
    object: 'Смена',
    field: 'status',
    oldValue: 'CLOSED',
    newValue: 'LOCKED'
  });
  saveData();
  renderProductionShiftBoardPage();
}

function renderProductionShiftLog(slot) {
  const modal = document.getElementById('production-shift-log-modal');
  if (!modal) return;
  const meta = document.getElementById('production-shift-log-meta');
  const list = document.getElementById('production-shift-log-list');
  const record = ensureProductionShift(slot.date, slot.shift, { reason: 'data' });
  const status = record?.status || 'PLANNING';
  const title = `${getShiftHeaderLabel(slot.date)} · ${slot.shift} смена · ${status}`;
  if (meta) meta.textContent = title;
  if (list) {
    const entries = (record?.logs || []).slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
    list.innerHTML = entries.length
      ? entries.map(entry => {
        const date = entry.ts ? new Date(entry.ts).toLocaleString('ru-RU') : '';
        const action = escapeHtml(entry.action || '');
        const object = escapeHtml(entry.object || '');
        const user = escapeHtml(entry.createdBy || '');
        const target = entry.targetId ? `(${escapeHtml(entry.targetId)})` : '';
        const change = entry.field ? `${escapeHtml(entry.field)}: ${escapeHtml(entry.oldValue)} → ${escapeHtml(entry.newValue)}` : '';
        return `
          <div class="production-shift-log-entry">
            <div class="production-shift-log-title">${action} ${object} ${target}</div>
            ${change ? `<div class="production-shift-log-change muted">${change}</div>` : ''}
            <div class="production-shift-log-meta-row muted">${user}${date ? ` · ${date}` : ''}</div>
          </div>
        `;
      }).join('')
      : '<p class="muted">Событий пока нет.</p>';
  }
  modal.classList.remove('hidden');
}

function closeProductionShiftLogModal() {
  const modal = document.getElementById('production-shift-log-modal');
  if (!modal) return;
  modal.classList.add('hidden');
}

function bindProductionShiftLogModal() {
  const modal = document.getElementById('production-shift-log-modal');
  if (!modal || modal.dataset.bound === 'true') return;
  modal.dataset.bound = 'true';
  const closeBtn = document.getElementById('production-shift-log-close');
  if (closeBtn) closeBtn.addEventListener('click', closeProductionShiftLogModal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeProductionShiftLogModal();
  });
}

function showProductionShiftBoardContextMenu(x, y, cardId) {
  let menu = document.getElementById('production-shift-board-menu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'production-shift-board-menu';
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
        menu.classList.remove('open');
        return;
      }
      if (action === 'open') {
        productionShiftBoardState.selectedCardId = cid;
        productionShiftBoardState.viewMode = 'card';
        menu.classList.remove('open');
        renderProductionShiftBoardPage();
        return;
      }
      if (action === 'open-new-tab') {
        const url = '/cards/new?cardId=' + encodeURIComponent(cid);
        window.open(url, '_blank');
        menu.classList.remove('open');
        return;
      }
      if (action === 'print') {
        const card = (cards || []).find(c => c.id === cid);
        if (card) printCardView(card);
        menu.classList.remove('open');
        return;
      }
      menu.classList.remove('open');
    });
  }
  menu.setAttribute('data-card-id', String(cardId || ''));
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.classList.add('open');
  document.addEventListener('click', () => menu.classList.remove('open'), { once: true });
}

function renderProductionShiftBoardPage() {
  const section = document.getElementById('production-shifts');
  if (!section) return;
  ensureProductionShiftsFromData();
  const slots = getProductionShiftWindowSlots();
  const { areasList } = getProductionAreasWithOrder();
  const selectedId = productionShiftBoardState.selectedShiftId || shiftSlotKey(slots[0].date, slots[0].shift);
  productionShiftBoardState.selectedShiftId = selectedId;
  const selectedSlot = slots.find(slot => shiftSlotKey(slot.date, slot.shift) === selectedId) || slots[0];
  const slotDisplay = slots.map(slot => ({ slot, display: resolveShiftDisplayData(slot) }));
  const viewMode = productionShiftBoardState.viewMode || 'queue';
  const selectedCardId = productionShiftBoardState.selectedCardId || null;
  let selectedCard = null;
  if (viewMode === 'card' && selectedCardId) {
    selectedCard = (cards || []).find(card => card.id === selectedCardId) || null;
  }
  if (viewMode === 'card' && selectedCardId && !selectedCard) {
    productionShiftBoardState.viewMode = 'queue';
    showToast('Карта не найдена', 'warning');
  }
  const selectedShiftOps = new Set(
    (productionShiftTasks || [])
      .filter(task => task.date === selectedSlot.date && task.shift === selectedSlot.shift && task.cardId === selectedCardId)
      .map(task => String(task.routeOpId || ''))
      .filter(Boolean)
  );

  const headerCells = slotDisplay.map(({ slot, display }, idx) => {
    const status = display.status;
    const isOpen = status === 'OPEN';
    const isSelected = shiftSlotKey(slot.date, slot.shift) === selectedId;
    const left = idx === 0 ? '<button class="production-shifts-nav" data-dir="-1" type="button">←</button>' : '';
    const right = idx === slots.length - 1 ? '<button class="production-shifts-nav" data-dir="1" type="button">→</button>' : '';
    const statusBtn = status === 'PLANNING'
      ? `<button type="button" class="btn-primary btn-small production-shift-action" data-action="open">Начать смену</button>`
      : status === 'OPEN'
        ? `<button type="button" class="btn-secondary btn-small production-shift-action" data-action="close">Закончить смену</button>`
        : status === 'CLOSED'
          ? `<button type="button" class="btn-secondary btn-small production-shift-action" data-action="lock">Зафиксировать смену</button>`
          : '';
    return `
      <th class="production-shift-board-head${isOpen ? ' shift-open' : ''}${isSelected ? ' selected' : ''}" data-date="${slot.date}" data-shift="${slot.shift}">
        <div class="production-shift-board-header">
          ${left}
          <div class="production-shift-board-header-info">
            <div class="production-shift-board-date">${escapeHtml(getShiftHeaderLabel(slot.date))}</div>
            <div class="production-shift-board-label">${slot.shift} смена</div>
            <div class="production-shift-board-time">${escapeHtml(display.timeFrom)}–${escapeHtml(display.timeTo)}</div>
          </div>
          ${right}
        </div>
        <div class="production-shift-board-actions">
          ${statusBtn}
          <button type="button" class="btn-tertiary btn-small production-shift-action" data-action="log">Лог смены</button>
        </div>
      </th>
    `;
  }).join('');

  const rowsHtml = areasList.map(area => {
    const cells = slotDisplay.map(({ slot, display }) => {
      const employees = getProductionShiftEmployees(slot.date, area.id, slot.shift);
      const employeesLabel = employees.employeeNames.length
        ? escapeHtml(employees.employeeNames.join(', '))
        : '';
      const employeesHtml = employees.employeeNames.length
        ? `<div class="production-shift-board-employees">${employeesLabel}</div>`
        : '<div class="muted">Нет сотрудников</div>';
      const opsHtml = buildShiftCellOps(slot.date, slot.shift, area.id);
      const openClass = display.status === 'OPEN' ? ' shift-open' : '';
      return `
        <td class="production-shift-board-cell${openClass}" data-date="${slot.date}" data-shift="${slot.shift}" data-area-id="${area.id}">
          ${employeesHtml}
          <div class="production-shift-board-ops">${opsHtml}</div>
        </td>
      `;
    }).join('');
    return `<tr><th class="production-shift-board-area">${escapeHtml(area.name || '')}</th>${cells}</tr>`;
  }).join('');

  section.innerHTML = `
    <div class="card production-card production-shift-board-card">
      <div class="production-toolbar">
        <div class="production-toolbar__left">
          <h2>Сменные задания</h2>
        </div>
      </div>
      <div class="production-shift-board-layout">
        <aside class="production-shift-board-queue">
          ${viewMode === 'card' && selectedCard ? `
            <div class="production-shifts-cardview">
              <div class="production-shifts-cardview-header">
                <button type="button" class="btn-secondary btn-small" id="production-shift-board-back-to-queue">← К списку</button>
                <div class="production-shifts-cardview-title">
                  <div class="production-shifts-card-title">${escapeHtml(getPlanningCardLabel(selectedCard))}</div>
                  <div class="muted">Операций: ${(selectedCard.operations || []).length}</div>
                </div>
              </div>

              <div class="production-shifts-opslist">
                ${(selectedCard.operations || []).length ? (selectedCard.operations || []).map(op => {
                  const plannedMin = (op && (op.plannedMinutes != null)) ? op.plannedMinutes : '';
                  const isInSelectedShift = selectedShiftOps.has(String(op.id || ''));
                  return `
                    <div class="production-shifts-op ${isInSelectedShift ? 'in-shift' : 'out-of-shift'}" data-op-id="${op.id}">
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
          ` : `
            <h3>Маршрутные карты смены</h3>
            <div class="production-shift-board-queue-list">
              ${buildShiftBoardQueue(selectedSlot)}
            </div>
          `}
        </aside>
        <div class="production-shift-board-table-wrapper">
          <table class="production-table production-shift-board-table">
            <thead>
              <tr>
                <th class="production-shift-board-area">Участок</th>
                ${headerCells}
              </tr>
            </thead>
            <tbody>
              ${rowsHtml || '<tr><td colspan="4" class="muted">Нет участков.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  bindProductionShiftLogModal();

  const backBtn = document.getElementById('production-shift-board-back-to-queue');
  if (backBtn) {
    backBtn.onclick = () => {
      productionShiftBoardState.viewMode = 'queue';
      renderProductionShiftBoardPage();
    };
  }

  section.querySelectorAll('.production-shift-board-head').forEach(head => {
    head.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      const date = head.getAttribute('data-date');
      const shift = parseInt(head.getAttribute('data-shift'), 10) || 1;
      productionShiftBoardState.selectedShiftId = shiftSlotKey(date, shift);
      productionShiftBoardState.viewMode = 'queue';
      renderProductionShiftBoardPage();
    });
  });

  section.querySelectorAll('.production-shift-action').forEach(btn => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const head = btn.closest('.production-shift-board-head');
      if (!head) return;
      const date = head.getAttribute('data-date');
      const shift = parseInt(head.getAttribute('data-shift'), 10) || 1;
      const action = btn.getAttribute('data-action');
      const slot = { date, shift };
      if (action === 'open') openShiftBySlot(slot);
      if (action === 'close') closeShiftBySlot(slot);
      if (action === 'lock') lockShiftBySlot(slot);
      if (action === 'log') renderProductionShiftLog(slot);
    });
  });

  section.querySelectorAll('.production-shifts-nav').forEach(btn => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const dir = parseInt(btn.getAttribute('data-dir'), 10) || 0;
      const start = getProductionShiftWindowStart();
      const next = moveShiftSlot(start, dir);
      productionShiftBoardState.windowStart = next;
      renderProductionShiftBoardPage();
    });
  });

  section.querySelectorAll('.production-shift-board-queue-card').forEach(card => {
    card.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      const cardId = card.getAttribute('data-card-id');
      if (cardId) showProductionShiftBoardContextMenu(event.pageX, event.pageY, cardId);
    });
  });

  section.querySelectorAll('.production-shift-board-op').forEach(op => {
    op.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      const cardId = op.getAttribute('data-card-id');
      if (cardId) showProductionShiftBoardContextMenu(event.pageX, event.pageY, cardId);
    });
  });
}

function renderProductionShiftsStubPage() {
  const app = document.getElementById('production-shifts')
    || document.getElementById('app')
    || document.querySelector('#app')
    || document.body;
  if (!app) return;

  app.innerHTML = `
    <section class="page production-shifts-stub">
      <h1>Сменные задания</h1>
      <p class="muted">Раздел временно недоступен. Используйте «План производства».</p>
      <div style="margin-top:12px;">
        <a class="btn-primary btn-small" href="/production/plan" data-route="/production/plan" id="go-production-plan">
          Перейти в План производства
        </a>
      </div>
    </section>
  `;

  const link = document.getElementById('go-production-plan');
  if (link && typeof navigateToRoute === 'function') {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      navigateToRoute('/production/plan');
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

function hideProductionShiftsTaskMenu() {
  const menu = document.getElementById('production-shifts-task-menu');
  if (!menu) return;
  menu.classList.remove('open');
}

function showProductionShiftsTaskMenu(x, y, cardId) {
  let menu = document.getElementById('production-shifts-task-menu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'production-shifts-task-menu';
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
        hideProductionShiftsTaskMenu();
        return;
      }

      if (action === 'open') {
        productionShiftsState.selectedCardId = cid;
        productionShiftsState.viewMode = 'card';
        hideProductionShiftsTaskMenu();
        renderProductionShiftsPage();
        return;
      }

      if (action === 'open-new-tab') {
        const url = '/cards/new?cardId=' + encodeURIComponent(cid);
        window.open(url, '_blank');
        hideProductionShiftsTaskMenu();
        return;
      }

      if (action === 'print') {
        const card = (cards || []).find(c => c.id === cid);
        if (card) printCardView(card);
        hideProductionShiftsTaskMenu();
        return;
      }

      hideProductionShiftsTaskMenu();
    });
  }

  menu.setAttribute('data-card-id', String(cardId || ''));
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.classList.add('open');

  document.addEventListener('click', hideProductionShiftsTaskMenu, { once: true });
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

  modal.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.matches('input[data-route-op-id]')) {
      const routeOpId = target.getAttribute('data-route-op-id');
      if (target.checked) {
        modal.querySelectorAll('input[data-route-op-id]').forEach(input => {
          if (input !== target) input.checked = false;
        });
        updateProductionShiftPlanPart(routeOpId);
      } else {
        updateProductionShiftPlanPart(null);
      }
    }
    if (target.matches('input[name="production-shift-plan-mode"]')) {
      updateProductionShiftPlanMode(target.value);
    }
  });
}

function openProductionRoute(route, { fromRestore = false } = {}) {
  const map = {
    '/production/schedule': 'production-schedule',
    '/production/plan': 'production-shifts',
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
  const productionLinks = document.querySelectorAll('#nav-production-menu .nav-dropdown-item');
  productionLinks.forEach(link => link.classList.remove('active'));
  productionLinks.forEach(link => {
    const linkRoute = link.getAttribute('data-route');
    if (linkRoute && linkRoute === route) link.classList.add('active');
  });
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
    if (route === '/production/plan') {
      renderProductionPlanPage();
    } else {
      renderProductionShiftBoardPage();
    }
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
