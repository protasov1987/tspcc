// === ПРОИЗВОДСТВО: РАСПИСАНИЕ ===
const PRODUCTION_WEEK_DAYS = 7;
const PRODUCTION_WEEK_LABELS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const PRODUCTION_SHIFT_MASTER_AREA_ID = '__shift_master__';
const PRODUCTION_ASSIGNMENT_STATUS_SHIFT_MASTER = 'SHIFT_MASTER';

function getProductionScheduleUserKey() {
  if (!window.currentUser) return 'anonymous';
  return currentUser.id || currentUser.login || currentUser.name || 'anonymous';
}

function getProductionPlanViewSettingsLsKey() {
  return `tspcc:production:plan:view:${getProductionScheduleUserKey()}`;
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
  selectedShifts: null,
  planWindowStartSlot: null,
  planVisibleColumnCount: 6,
  selectedCardId: null,
  navigationTarget: null,
  navigationIgnoreUntil: 0,
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

const productionGanttState = {
  zoom: 1
};

const productionShiftCloseState = {
  sortKey: 'remaining',
  sortDir: 'desc',
  filterText: ''
};

let productionShiftCloseEndClockTimer = null;

const PRODUCTION_AUTO_PLAN_SETTINGS_LS_KEY = `tspcc:production:auto-plan:${getProductionScheduleUserKey()}`;
const PRODUCTION_PLAN_MAX_VISIBLE_COLUMNS = 6;
const PRODUCTION_PLAN_BASE_QUEUE_WIDTH_PCT = 13;
const PRODUCTION_PLAN_MAX_QUEUE_WIDTH_PCT = 20;
const PRODUCTION_PLAN_BASE_AREA_COLUMN_WIDTH_PCT = 8;
const PRODUCTION_PLAN_MAX_AREA_COLUMN_WIDTH_PCT = 15;

let productionAutoPlanContext = null;
let productionAutoPlanLastPreview = null;
let productionAutoPlanResultHistory = [];
let productionSubcontractPlanSelectionResolver = null;
let productionSubcontractPlanSelectionContext = null;
let productionShiftPlanSessionSeq = 0;
let productionShiftPlanSaveAbortController = null;

function loadAreasOrder() {
  try {
    const raw = localStorage.getItem(AREAS_ORDER_LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function loadProductionPlanViewSettings() {
  try {
    const raw = localStorage.getItem(getProductionPlanViewSettingsLsKey());
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveProductionPlanViewSettings() {
  try {
    const normalizedWeekStart = productionShiftsState.weekStart
      ? formatProductionDate(normalizeProductionStartDate(productionShiftsState.weekStart))
      : '';
    const normalizedPlanWindowStartSlot = productionShiftsState.planWindowStartSlot
      ? {
        date: formatProductionDate(normalizeProductionStartDate(productionShiftsState.planWindowStartSlot.date || normalizedWeekStart || getProductionPlanTodayStart())),
        shift: parseInt(productionShiftsState.planWindowStartSlot.shift, 10) || (getProductionPlanSelectedShifts()[0] || 1)
      }
      : null;
    localStorage.setItem(getProductionPlanViewSettingsLsKey(), JSON.stringify({
      selectedShifts: getProductionPlanSelectedShifts(),
      planVisibleColumnCount: getProductionPlanVisibleColumnCount(),
      weekStart: normalizedWeekStart,
      planWindowStartSlot: normalizedPlanWindowStartSlot
    }));
  } catch {
    // ignore localStorage failures
  }
}

function hydrateProductionPlanViewSettings() {
  const stored = loadProductionPlanViewSettings();
  if (Array.isArray(stored.selectedShifts)) {
    productionShiftsState.selectedShifts = stored.selectedShifts
      .map(value => parseInt(value, 10))
      .filter(value => Number.isFinite(value) && value > 0);
  }
  if (stored.planVisibleColumnCount != null) {
    productionShiftsState.planVisibleColumnCount = Math.max(
      1,
      Math.min(PRODUCTION_PLAN_MAX_VISIBLE_COLUMNS, parseInt(stored.planVisibleColumnCount, 10) || PRODUCTION_PLAN_MAX_VISIBLE_COLUMNS)
    );
  }
  const rawWeekStart = String(stored.weekStart || '').trim();
  const normalizedWeekStart = /^\d{4}-\d{2}-\d{2}$/.test(rawWeekStart)
    ? normalizeProductionStartDate(rawWeekStart)
    : null;
  if (normalizedWeekStart) {
    productionShiftsState.weekStart = normalizedWeekStart;
  }
  const rawPlanWindowStartSlot = stored.planWindowStartSlot;
  const rawPlanWindowDate = String(rawPlanWindowStartSlot?.date || '').trim();
  if (rawPlanWindowStartSlot && /^\d{4}-\d{2}-\d{2}$/.test(rawPlanWindowDate)) {
    productionShiftsState.planWindowStartSlot = {
      date: formatProductionDate(normalizeProductionStartDate(rawPlanWindowDate)),
      shift: parseInt(rawPlanWindowStartSlot.shift, 10) || 1
    };
  }
}

function saveAreasOrder(order) {
  if (!ensureProductionEditAccess('production-schedule')) return false;
  localStorage.setItem(AREAS_ORDER_LS_KEY, JSON.stringify(order));
  return true;
}

function getCurrentProductionPermissionKey(pathname = window.location.pathname || '') {
  const path = String(pathname || '').split('?')[0] || '';
  if (typeof getAccessRoutePermission === 'function') {
    const direct = getAccessRoutePermission(path);
    if (direct?.key) return String(direct.key).trim();
  }
  if (path === '/production/schedule') return 'production-schedule';
  if (path === '/production/plan' || /^\/production\/gantt\//.test(path)) return 'production-plan';
  if (path === '/production/shifts' || /^\/production\/shifts\//.test(path)) return 'production-shifts';
  if (path === '/production/delayed') return 'production-delayed';
  if (path === '/production/defects') return 'production-defects';
  return 'production-schedule';
}

function isProductionRouteReadonly(permissionKey = '') {
  const resolvedKey = String(permissionKey || '').trim() || getCurrentProductionPermissionKey();
  if (typeof canEditTab !== 'function') return false;
  return !canEditTab(resolvedKey);
}

function ensureProductionEditAccess(permissionKey = '', message = 'Недостаточно прав для изменения данных на этой странице') {
  if (!isProductionRouteReadonly(permissionKey)) return true;
  showToast(message);
  return false;
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

function isProductionShiftMasterArea(areaId) {
  return String(areaId || '') === PRODUCTION_SHIFT_MASTER_AREA_ID;
}

function normalizeProductionAssignmentStatus(status, areaId = '') {
  if (isProductionShiftMasterArea(areaId)) return PRODUCTION_ASSIGNMENT_STATUS_SHIFT_MASTER;
  return String(status || '').toUpperCase() === PRODUCTION_ASSIGNMENT_STATUS_SHIFT_MASTER
    ? PRODUCTION_ASSIGNMENT_STATUS_SHIFT_MASTER
    : '';
}

function isProductionShiftMasterAssignment(record) {
  return normalizeProductionAssignmentStatus(record?.assignmentStatus, record?.areaId) === PRODUCTION_ASSIGNMENT_STATUS_SHIFT_MASTER;
}

function getProductionScheduleDisplayAreas() {
  const { areasList, order } = getProductionAreasWithOrder();
  return {
    order,
    areasList: [
      {
        id: PRODUCTION_SHIFT_MASTER_AREA_ID,
        name: 'Мастер смены',
        isSpecial: true
      },
      ...areasList.map(area => ({
        ...area,
        isSpecial: false
      }))
    ]
  };
}

function moveProductionArea(areaId, direction) {
  if (!ensureProductionEditAccess('production-schedule')) return;
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

function formatProductionDisplayDate(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const [yyyy, mm, dd] = normalized.split('-');
    return `${dd}.${mm}.${yyyy}`;
  }
  return normalized;
}

function formatProductionShiftCloseRouteKey(dateStr, shift) {
  const normalizedDate = String(dateStr || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) return '';
  const [, mm, dd] = normalizedDate.split('-');
  const yyyy = normalizedDate.slice(0, 4);
  const shiftNum = Math.max(1, parseInt(shift, 10) || 1);
  return `${dd}${mm}${yyyy}s${shiftNum}`;
}

function parseProductionShiftCloseRouteKey(key) {
  const normalized = String(key || '').trim().toLowerCase();
  const match = normalized.match(/^(\d{2})(\d{2})(\d{4})s(\d+)$/);
  if (!match) return null;
  const [, dd, mm, yyyy, shiftRaw] = match;
  const shift = Math.max(1, parseInt(shiftRaw, 10) || 1);
  const date = `${yyyy}-${mm}-${dd}`;
  const testDate = new Date(`${date}T00:00:00`);
  if (Number.isNaN(testDate.getTime())) return null;
  if (
    testDate.getFullYear() !== Number(yyyy) ||
    testDate.getMonth() + 1 !== Number(mm) ||
    testDate.getDate() !== Number(dd)
  ) {
    return null;
  }
  return { date, shift, key: `${dd}${mm}${yyyy}s${shift}` };
}

function parseProductionShiftCloseRoutePath(path) {
  const clean = String(path || '').split('?')[0].split('#')[0];
  const match = clean.match(/^\/production\/shifts\/([^/]+)\/?$/);
  if (!match) return null;
  return parseProductionShiftCloseRouteKey(match[1]);
}

function getProductionShiftClosePath(dateStr, shift) {
  const key = formatProductionShiftCloseRouteKey(dateStr, shift);
  return key ? `/production/shifts/${key}` : '/production/shifts';
}

function parseProductionDisplayDate(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  const match = normalized.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return '';
  const [, dd, mm, yyyy] = match;
  const date = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  if (
    date.getFullYear() !== Number(yyyy) ||
    date.getMonth() + 1 !== Number(mm) ||
    date.getDate() !== Number(dd)
  ) {
    return '';
  }
  return `${yyyy}-${mm}-${dd}`;
}

function getCurrentProductionShiftNumber() {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const shiftNumbers = getProductionShiftNumbers();
  const found = shiftNumbers.find(shift => {
    const range = getShiftRange(shift);
    if (!range) return false;
    const start = Number(range.start) || 0;
    let end = Number(range.end) || 0;
    if (end <= start) {
      return currentMinutes >= start || currentMinutes < end;
    }
    return currentMinutes >= start && currentMinutes < end;
  });
  return found || shiftNumbers[0] || 1;
}

function loadProductionAutoPlanSettings() {
  try {
    const raw = localStorage.getItem(PRODUCTION_AUTO_PLAN_SETTINGS_LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveProductionAutoPlanSettings(settings) {
  try {
    localStorage.setItem(PRODUCTION_AUTO_PLAN_SETTINGS_LS_KEY, JSON.stringify(settings || {}));
  } catch {
    // ignore localStorage failures
  }
}

function getDefaultProductionAutoPlanSettings(card = null) {
  const stored = loadProductionAutoPlanSettings();
  return {
    startDate: formatProductionDate(new Date()),
    startShift: getCurrentProductionShiftNumber(),
    activeShifts: Array.isArray(stored.activeShifts) && stored.activeShifts.length ? stored.activeShifts : [1],
    deadlineMode: stored.deadlineMode === 'CUSTOM_DEADLINE' ? 'CUSTOM_DEADLINE' : 'CARD_PLANNED_COMPLETION',
    customDeadline: String(stored.customDeadline || card?.plannedCompletionDate || ''),
    maxLoadPercent: Math.max(1, Math.min(100, parseInt(stored.maxLoadPercent, 10) || 100)),
    areaMode: stored.areaMode === 'SELECTED_AREA_ONLY' ? 'SELECTED_AREA_ONLY' : 'AUTO_ALLOWED_AREAS',
    areaId: String(stored.areaId || ''),
    delayMinutes: Math.max(0, parseInt(stored.delayMinutes, 10) || 0),
    minOperationMinutes: Math.max(1, parseInt(stored.minOperationMinutes, 10) || 1),
    minItems: Math.max(1, parseInt(stored.minItems, 10) || 1),
    minWitness: Math.max(1, parseInt(stored.minWitness, 10) || 1),
    minControl: Math.max(1, parseInt(stored.minControl, 10) || 1),
    transferItems: Math.max(1, parseInt(stored.transferItems, 10) || 1),
    transferWitness: Math.max(1, parseInt(stored.transferWitness, 10) || 1),
    transferControl: Math.max(1, parseInt(stored.transferControl, 10) || 1),
    allowLastPartialBatch: stored.allowLastPartialBatch === true
  };
}

function setProductionWeekStart(date) {
  productionScheduleState.weekStart = normalizeProductionStartDate(date);
  resetProductionSelection();
  renderProductionSchedule();
}

function setProductionShiftsWeekStart(date) {
  productionShiftsState.weekStart = normalizeProductionStartDate(date);
  productionShiftsState.planWindowStartSlot = {
    date: formatProductionDate(productionShiftsState.weekStart),
    shift: getProductionPlanSelectedShifts()[0] || 1
  };
  saveProductionPlanViewSettings();
  renderProductionShiftsPage();
}

function getProductionPlanTodayStart() {
  return normalizeProductionStartDate(new Date());
}

function ensureProductionPlanSelectedShift(shift) {
  const targetShift = parseInt(shift, 10) || 1;
  const available = getProductionShiftNumbers();
  if (!available.includes(targetShift)) return;
  const current = getProductionPlanSelectedShifts();
  if (current.includes(targetShift)) return;
  productionShiftsState.selectedShifts = available.filter(item => current.includes(item) || item === targetShift);
  saveProductionPlanViewSettings();
}

function getProductionPlanTodaySlot() {
  const today = getProductionPlanTodayStart();
  const currentShift = getCurrentProductionShiftNumber();
  return {
    date: formatProductionDate(today),
    shift: currentShift || getProductionPlanSelectedShifts()[0] || 1
  };
}

function resetProductionPlanToToday() {
  const today = getProductionPlanTodayStart();
  const todaySlot = getProductionPlanTodaySlot();
  ensureProductionPlanSelectedShift(todaySlot.shift);
  productionShiftsState.weekStart = today;
  productionShiftsState.planWindowStartSlot = todaySlot;
  saveProductionPlanViewSettings();
  renderProductionShiftsPage();
}

function clearProductionPlanNavigationFocusClasses() {
  const section = document.getElementById('production-shifts');
  if (!section) return;
  section.querySelectorAll('.production-day-nav-target').forEach(el => el.classList.remove('production-day-nav-target'));
  section.querySelectorAll('.production-shifts-cell-nav-target').forEach(el => el.classList.remove('production-shifts-cell-nav-target'));
  section.querySelectorAll('.production-shift-task.focus-nav').forEach(el => el.classList.remove('focus-nav'));
}

function clearProductionPlanNavigationFocus() {
  productionShiftsState.navigationTarget = null;
  productionShiftsState.navigationIgnoreUntil = 0;
  clearProductionPlanNavigationFocusClasses();
}

function focusProductionPlanSlot(date, shift, areaId = '', routeOpId = '') {
  const targetDate = normalizeProductionStartDate(date || getProductionPlanTodayStart());
  const targetDateStr = formatProductionDate(targetDate);
  const targetShift = parseInt(shift, 10) || 1;
  const targetRouteOpId = String(routeOpId || '');
  const available = getProductionShiftNumbers();
  const current = getProductionPlanSelectedShifts();
  const next = available.filter(item => current.includes(item) || item === targetShift);
  productionShiftsState.weekStart = targetDate;
  productionShiftsState.selectedShifts = next.length ? next : (available.length ? [available[0]] : [1]);
  productionShiftsState.planWindowStartSlot = {
    date: targetDateStr,
    shift: targetShift
  };
  saveProductionPlanViewSettings();
  productionShiftsState.navigationIgnoreUntil = Date.now() + 300;
  productionShiftsState.navigationTarget = {
    date: targetDateStr,
    shift: targetShift,
    areaId: String(areaId || ''),
    routeOpId: targetRouteOpId,
    cardId: String(productionShiftsState.selectedCardId || '')
  };
  renderProductionShiftsPage();
  requestAnimationFrame(() => {
    const section = document.getElementById('production-shifts');
    if (!section) return;
    clearProductionPlanNavigationFocusClasses();
    const header = section.querySelector(
      `.production-day-plan-slot[data-date="${CSS.escape(targetDateStr)}"][data-shift="${targetShift}"]`
    );
    if (header) {
      header.classList.add('production-day-nav-target');
      header.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
    const cell = areaId ? getProductionShiftCellElement(targetDateStr, targetShift, areaId) : null;
    if (cell) {
      cell.classList.add('production-shifts-cell-nav-target');
      cell.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      if (targetRouteOpId) {
        const targetTask = cell.querySelector(
          `.production-shift-task[data-task-route-op-id="${CSS.escape(targetRouteOpId)}"][data-task-card-id="${CSS.escape(String(productionShiftsState.selectedCardId || ''))}"]`
        );
        if (targetTask) {
          targetTask.classList.add('focus-nav');
        }
      }
    }
  });
}

let productionPlanNavigationClickResetBound = false;

function bindProductionPlanNavigationClearOnClick() {
  if (productionPlanNavigationClickResetBound) return;
  productionPlanNavigationClickResetBound = true;
  document.addEventListener('click', () => {
    if (!productionShiftsState.navigationTarget) return;
    if (Date.now() < (Number(productionShiftsState.navigationIgnoreUntil) || 0)) return;
    clearProductionPlanNavigationFocus();
  });
}

function isProductionNavigationTargetTask(task, dateStr, shift, areaId) {
  const target = productionShiftsState.navigationTarget || null;
  if (!target || !task) return false;
  return (
    String(target.cardId || '') === String(task.cardId || '') &&
    String(target.routeOpId || '') === String(task.routeOpId || '') &&
    String(target.date || '') === String(dateStr || task.date || '') &&
    (parseInt(target.shift, 10) || 1) === (parseInt(shift ?? task.shift, 10) || 1) &&
    String(target.areaId || '') === String(areaId || task.areaId || '')
  );
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

function getProductionPlanSelectedShifts() {
  const available = getProductionShiftNumbers();
  const raw = Array.isArray(productionShiftsState.selectedShifts) ? productionShiftsState.selectedShifts : available;
  const normalized = available.filter(shift => raw.includes(shift));
  if (normalized.length) return normalized;
  return available.length ? [available[0]] : [1];
}

function getProductionPlanWindowStartSlot() {
  const selectedShifts = getProductionPlanSelectedShifts();
  const fallback = {
    date: formatProductionDate(normalizeProductionStartDate(productionShiftsState.weekStart || getProductionPlanTodayStart())),
    shift: selectedShifts[0] || 1
  };
  const raw = productionShiftsState.planWindowStartSlot;
  const slot = {
    date: formatProductionDate(normalizeProductionStartDate(raw?.date || fallback.date)),
    shift: parseInt(raw?.shift, 10) || fallback.shift
  };
  if (selectedShifts.includes(slot.shift)) {
    return slot;
  }
  let cursor = { ...slot };
  for (let i = 0; i < 12; i += 1) {
    cursor = moveShiftSlot(cursor, 1);
    if (selectedShifts.includes(cursor.shift)) {
      return cursor;
    }
  }
  return fallback;
}

function getProductionPlanVisibleColumnCount() {
  const raw = parseInt(productionShiftsState.planVisibleColumnCount, 10);
  return Math.max(1, Math.min(PRODUCTION_PLAN_MAX_VISIBLE_COLUMNS, raw || PRODUCTION_PLAN_MAX_VISIBLE_COLUMNS));
}

function setProductionPlanVisibleColumnCount(count) {
  const nextCount = Math.max(1, Math.min(PRODUCTION_PLAN_MAX_VISIBLE_COLUMNS, parseInt(count, 10) || PRODUCTION_PLAN_MAX_VISIBLE_COLUMNS));
  if (nextCount === getProductionPlanVisibleColumnCount()) return;
  productionShiftsState.planVisibleColumnCount = nextCount;
  saveProductionPlanViewSettings();
  renderProductionShiftsPage();
}

function getProductionPlanVisibleColumnLabel(count) {
  const value = Math.max(1, Math.min(PRODUCTION_PLAN_MAX_VISIBLE_COLUMNS, parseInt(count, 10) || 1));
  const suffixMap = {
    1: 'столбец',
    2: 'столбца',
    3: 'столбца',
    4: 'столбца',
    5: 'столбцов',
    6: 'столбцов'
  };
  return `${value} ${suffixMap[value] || 'столбцов'}`;
}

function getProductionPlanLayoutMetrics(visibleColumnCount = getProductionPlanVisibleColumnCount()) {
  const normalizedCount = Math.max(1, Math.min(PRODUCTION_PLAN_MAX_VISIBLE_COLUMNS, parseInt(visibleColumnCount, 10) || PRODUCTION_PLAN_MAX_VISIBLE_COLUMNS));
  const hiddenColumns = PRODUCTION_PLAN_MAX_VISIBLE_COLUMNS - normalizedCount;
  const queueGrowthPct = (PRODUCTION_PLAN_MAX_QUEUE_WIDTH_PCT - PRODUCTION_PLAN_BASE_QUEUE_WIDTH_PCT)
    * (hiddenColumns / Math.max(1, PRODUCTION_PLAN_MAX_VISIBLE_COLUMNS - 1));
  const areaGrowthPct = (PRODUCTION_PLAN_MAX_AREA_COLUMN_WIDTH_PCT - PRODUCTION_PLAN_BASE_AREA_COLUMN_WIDTH_PCT)
    * (hiddenColumns / Math.max(1, PRODUCTION_PLAN_MAX_VISIBLE_COLUMNS - 1));
  const queueWidthPct = PRODUCTION_PLAN_BASE_QUEUE_WIDTH_PCT + queueGrowthPct;
  const areaWidthPct = PRODUCTION_PLAN_BASE_AREA_COLUMN_WIDTH_PCT + areaGrowthPct;
  const tableWidthPct = 100 - queueWidthPct;
  const slotWidthPct = (100 - areaWidthPct) / normalizedCount;
  const innerOpsColumns = normalizedCount <= 1 ? 4 : (normalizedCount === 2 ? 3 : (normalizedCount <= 4 ? 2 : 1));
  return {
    queueWidthPct,
    tableWidthPct,
    areaWidthPct,
    slotWidthPct,
    innerOpsColumns
  };
}

function moveProductionPlanVisibleSlot(slot, dir) {
  const selectedShifts = getProductionPlanSelectedShifts();
  let cursor = { ...slot };
  for (let i = 0; i < 12; i += 1) {
    cursor = moveShiftSlot(cursor, dir);
    if (selectedShifts.includes(cursor.shift)) {
      return cursor;
    }
  }
  return slot;
}

function toggleProductionPlanShift(shift) {
  const available = getProductionShiftNumbers();
  const current = getProductionPlanSelectedShifts();
  if (!available.includes(shift)) return;
  const exists = current.includes(shift);
  let next = exists ? current.filter(item => item !== shift) : current.concat(shift);
  next = available.filter(item => next.includes(item));
  if (!next.length) next = [shift];
  productionShiftsState.selectedShifts = next;
  productionShiftsState.planWindowStartSlot = getProductionPlanWindowStartSlot();
  saveProductionPlanViewSettings();
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

function hasProductionAreaAssignedEmployees(date, shift, areaId) {
  if (!date || !areaId) return false;
  return getProductionShiftEmployees(date, areaId, shift).employeeIds.length > 0;
}

function getProductionAreaAssignmentToastMessage(areaName) {
  return `На участок ${String(areaName || 'Участок').trim() || 'Участок'} не назначен исполнитель.`;
}

function showProductionMissingAreaExecutorToasts(areaNames) {
  const uniqueNames = Array.from(new Set(
    (Array.isArray(areaNames) ? areaNames : [])
      .map(name => String(name || '').trim())
      .filter(Boolean)
  ));
  uniqueNames.forEach(name => showToast(getProductionAreaAssignmentToastMessage(name)));
  return uniqueNames;
}

function getProductionOpenShiftUnassignedAreaName(date, shift, areaId) {
  if (!date || !areaId) return '';
  if (getProductionShiftStatus(date, shift) !== 'OPEN') return '';
  if (isSubcontractAreaById(areaId)) return '';
  return hasProductionAreaAssignedEmployees(date, shift, areaId)
    ? ''
    : getPlanningTaskAreaName(areaId);
}

function collectProductionShiftStartBlockedAreaNames(date, shift) {
  const slotDate = String(date || '');
  const slotShift = parseInt(shift, 10) || 1;
  if (!slotDate) return [];
  const taskAreaIds = new Set(
    getVisibleProductionShiftTasks()
      .filter(task => (
        String(task?.date || '') === slotDate
        && (parseInt(task?.shift, 10) || 1) === slotShift
      ))
      .map(task => String(task?.areaId || ''))
      .filter(Boolean)
  );
  if (!taskAreaIds.size) return [];
  const { areasList } = getProductionAreasWithOrder();
  const blocked = [];
  const seen = new Set();
  areasList.forEach(area => {
    const areaId = String(area?.id || '');
    if (!areaId || !taskAreaIds.has(areaId) || isSubcontractAreaById(areaId)) return;
    if (hasProductionAreaAssignedEmployees(slotDate, slotShift, areaId)) return;
    seen.add(areaId);
    blocked.push(getPlanningTaskAreaName(areaId));
  });
  taskAreaIds.forEach(areaId => {
    if (seen.has(areaId) || isSubcontractAreaById(areaId)) return;
    if (hasProductionAreaAssignedEmployees(slotDate, slotShift, areaId)) return;
    blocked.push(getPlanningTaskAreaName(areaId));
  });
  return blocked;
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

function normalizeProductionTimeString(value) {
  const minutes = parseProductionTime(value);
  return Number.isFinite(minutes) ? minutesToTimeString(minutes) : '';
}

function minutesToTimeString(minutes) {
  const total = ((minutes % (24 * 60)) + (24 * 60)) % (24 * 60);
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

function normalizeProductionShiftTimeEntry(entry, fallbackShift = 1) {
  const shift = Number.isFinite(parseInt(entry?.shift, 10)) ? Math.max(1, parseInt(entry.shift, 10)) : fallbackShift;
  const rev = Number(entry?.rev);
  return {
    shift,
    timeFrom: normalizeProductionTimeString(entry?.timeFrom) || '00:00',
    timeTo: normalizeProductionTimeString(entry?.timeTo) || '00:00',
    lunchFrom: normalizeProductionTimeString(entry?.lunchFrom),
    lunchTo: normalizeProductionTimeString(entry?.lunchTo),
    rev: Number.isFinite(rev) && rev > 0 ? Math.floor(rev) : 1
  };
}

function resolveProductionShiftLunchState(entry) {
  const normalized = normalizeProductionShiftTimeEntry(entry);
  const shiftFrom = parseProductionTime(normalized.timeFrom) ?? 0;
  let shiftTo = parseProductionTime(normalized.timeTo);
  if (shiftTo == null) shiftTo = shiftFrom;
  if (shiftTo <= shiftFrom) shiftTo += 24 * 60;

  const lunchFrom = parseProductionTime(normalized.lunchFrom);
  const lunchTo = parseProductionTime(normalized.lunchTo);
  if (lunchFrom == null && lunchTo == null) {
    return {
      status: 'none',
      shiftRange: { start: shiftFrom, end: shiftTo },
      lunchRange: null,
      normalized
    };
  }
  if (lunchFrom == null || lunchTo == null) {
    return {
      status: 'partial',
      shiftRange: { start: shiftFrom, end: shiftTo },
      lunchRange: null,
      normalized
    };
  }
  if (lunchFrom === lunchTo) {
    return {
      status: 'zero',
      shiftRange: { start: shiftFrom, end: shiftTo },
      lunchRange: null,
      normalized
    };
  }
  let normalizedLunchFrom = lunchFrom;
  while (normalizedLunchFrom < shiftFrom) normalizedLunchFrom += 24 * 60;
  let normalizedLunchTo = lunchTo;
  while (normalizedLunchTo < normalizedLunchFrom) normalizedLunchTo += 24 * 60;
  const lunchRange = {
    start: normalizedLunchFrom,
    end: normalizedLunchTo
  };
  if (lunchRange.start <= shiftFrom || lunchRange.end >= shiftTo) {
    return {
      status: 'outside',
      shiftRange: { start: shiftFrom, end: shiftTo },
      lunchRange: null,
      normalized
    };
  }
  return {
    status: 'ok',
    shiftRange: { start: shiftFrom, end: shiftTo },
    lunchRange,
    normalized
  };
}

function getShiftRange(shift) {
  const ref = normalizeProductionShiftTimeEntry(getProductionShiftTimeRef(shift), parseInt(shift, 10) || 1);
  const from = parseProductionTime(ref.timeFrom) ?? 0;
  let to = parseProductionTime(ref.timeTo);
  if (to == null) to = from;
  if (to <= from) to += 24 * 60;
  return { start: from, end: to };
}

function getShiftLunchRange(shift, { ignoreLunch = false } = {}) {
  if (ignoreLunch) return null;
  const resolution = resolveProductionShiftLunchState(getProductionShiftTimeRef(shift));
  return resolution.status === 'ok' ? resolution.lunchRange : null;
}

function getShiftWorkRanges(shift, { ignoreLunch = false } = {}) {
  const shiftRange = getShiftRange(shift);
  if (!shiftRange) return [];
  const lunchRange = getShiftLunchRange(shift, { ignoreLunch });
  if (!lunchRange) {
    return [{ start: shiftRange.start, end: shiftRange.end, segmentKey: '' }];
  }
  const ranges = [];
  if (lunchRange.start > shiftRange.start) {
    ranges.push({ start: shiftRange.start, end: lunchRange.start, segmentKey: 'before_lunch' });
  }
  if (lunchRange.end < shiftRange.end) {
    ranges.push({ start: lunchRange.end, end: shiftRange.end, segmentKey: 'after_lunch' });
  }
  return ranges.filter(range => range.end > range.start);
}

function getShiftDurationMinutes(shift, { ignoreLunch = false } = {}) {
  const workRanges = getShiftWorkRanges(shift, { ignoreLunch });
  const totalMinutes = workRanges.reduce((sum, range) => sum + Math.max(0, (range.end - range.start)), 0);
  return totalMinutes > 0 ? totalMinutes : 8 * 60;
}

function getShiftDurationMinutesForArea(shift, areaId = '') {
  return getShiftDurationMinutes(shift, { ignoreLunch: isSubcontractAreaById(areaId) });
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
  const hasTasks = getVisibleProductionShiftTasks().some(task => task.date === date && task.shift === num);
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
    isFixed: false,
    fixedAt: null,
    fixedBy: null,
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
  getVisibleProductionShiftTasks().forEach(task => {
    ensureProductionShift(task.date, task.shift, { reason: 'data' });
  });
}

function getProductionShiftStatus(dateStr, shift) {
  const existing = ensureProductionShift(dateStr, shift, { reason: 'data' });
  return existing?.status || 'PLANNING';
}

function findProductionShiftRecord(dateStr, shift) {
  return (productionShifts || []).find(item => (
    String(item?.date || '') === String(dateStr || '')
    && (parseInt(item?.shift, 10) || 1) === (parseInt(shift, 10) || 1)
  )) || null;
}

function isShiftFixed(dateStr, shift) {
  const record = ensureProductionShift(dateStr, shift, { reason: 'data' });
  if (!record) return false;
  if (record.status === 'LOCKED' && !record.isFixed) {
    record.isFixed = true;
    record.fixedAt = record.fixedAt || record.lockedAt || null;
    record.fixedBy = record.fixedBy || record.lockedBy || null;
  }
  return Boolean(record.isFixed || record.status === 'LOCKED');
}

function getShiftStatusKey(dateStr, shift) {
  if (isShiftFixed(dateStr, shift)) return 'FIXED';
  const status = getProductionShiftStatus(dateStr, shift);
  if (status === 'CLOSED') return 'COMPLETED';
  if (status === 'OPEN') return 'IN_PROGRESS';
  return 'NOT_STARTED';
}

function getShiftStatusLabel(dateStr, shift) {
  const key = getShiftStatusKey(dateStr, shift);
  if (key === 'FIXED') return 'Зафиксирована';
  if (key === 'COMPLETED') return 'Завершена';
  if (key === 'IN_PROGRESS') return 'В работе';
  return 'Не начата';
}

function getShiftStatusClass(dateStr, shift) {
  const key = getShiftStatusKey(dateStr, shift);
  if (key === 'FIXED') return 'status-fixed';
  if (key === 'COMPLETED') return 'status-completed';
  if (key === 'IN_PROGRESS') return 'status-in-progress';
  return 'status-not-started';
}

function isShiftClosedOrLocked(dateStr, shift) {
  const status = getProductionShiftStatus(dateStr, shift);
  return status === 'CLOSED' || status === 'LOCKED';
}

function canEditShiftWithStatus(dateStr, shift) {
  return canEditShift(dateStr, shift) && !isShiftClosedOrLocked(dateStr, shift) && !isShiftFixed(dateStr, shift);
}

function isPlanningShiftInPast(dateStr, shift) {
  return isClosedShift(dateStr, shift);
}

function canMutatePlanningDraftShift(dateStr, shift) {
  if (isShiftFixed(dateStr, shift)) return false;
  const status = getProductionShiftStatus(dateStr, shift);
  return status === 'PLANNING' && !isPlanningShiftInPast(dateStr, shift);
}

function canMoveProductionShiftTaskFromShift(dateStr, shift) {
  if (isShiftFixed(dateStr, shift)) return false;
  return getProductionShiftStatus(dateStr, shift) === 'PLANNING';
}

function canMoveProductionShiftTaskToShift(dateStr, shift) {
  if (isShiftFixed(dateStr, shift)) return false;
  const status = getProductionShiftStatus(dateStr, shift);
  if (status === 'OPEN') return true;
  return status === 'PLANNING' && !isPlanningShiftInPast(dateStr, shift);
}

function isHistoricalPlanningShift(dateStr, shift) {
  if (isShiftFixed(dateStr, shift)) return true;
  const status = getProductionShiftStatus(dateStr, shift);
  return status === 'OPEN' || status === 'CLOSED';
}

function canPlanShiftOperations(dateStr, shift) {
  if (isShiftFixed(dateStr, shift)) return false;
  const status = getProductionShiftStatus(dateStr, shift);
  if (status === 'OPEN') return true;
  return status === 'PLANNING' && !isPlanningShiftInPast(dateStr, shift);
}

function canDragProductionShiftTask(task, op) {
  if (!task || !op) return false;
  if (task?.closePagePreview === true) return false;
  if (isSubcontractTask(task)) return false;
  if (!canMoveProductionShiftTaskFromShift(task.date, task.shift)) return false;
  return op.status !== 'IN_PROGRESS' && op.status !== 'PAUSED';
}

function canDropProductionShiftTask(dateStr, shift) {
  return canMoveProductionShiftTaskToShift(dateStr, shift);
}

function showShiftEditBlockedToast(dateStr, shift) {
  if (isShiftFixed(dateStr, shift)) {
    showToast('Смена зафиксирована и не может быть изменена');
    return;
  }
  showToast('Смена уже завершена. Редактирование запрещено');
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

function getPlanningTaskAreaName(areaId) {
  const key = String(areaId || '');
  const area = (areas || []).find(item => String(item?.id || '') === key);
  return (area?.name || area?.title || key || 'Участок').trim();
}

function getPlanningArea(areaId) {
  const key = String(areaId || '');
  return (areas || []).find(item => String(item?.id || '') === key) || null;
}

function renderPlanningAreaNameHtml(areaId, options = {}) {
  const area = getPlanningArea(areaId);
  const name = options.name != null ? options.name : getPlanningTaskAreaName(areaId);
  return renderAreaLabel(area, {
    name,
    fallbackName: options.fallbackName != null ? options.fallbackName : 'Участок',
    className: options.className || ''
  });
}

function isSubcontractAreaById(areaId) {
  return String(getPlanningArea(areaId)?.type || '').trim() === 'Субподрядчик';
}

function isSubcontractTask(task) {
  return Boolean(task) && isSubcontractAreaById(task.areaId);
}

function getSubcontractChainId(task) {
  return String(task?.subcontractChainId || '').trim();
}

function normalizeSubcontractItemIds(value) {
  return Array.isArray(value)
    ? Array.from(new Set(value.map(item => String(item || '').trim()).filter(Boolean)))
    : [];
}

function getSubcontractTaskLineKey(task) {
  return [
    String(task?.cardId || ''),
    String(task?.routeOpId || ''),
    String(task?.areaId || ''),
    getSubcontractChainId(task)
  ].join('|');
}

function getSubcontractChainTasks(task) {
  if (!isSubcontractTask(task)) return [];
  const chainId = getSubcontractChainId(task);
  if (!chainId) return [];
  return (productionShiftTasks || [])
    .filter(item => (
      isSubcontractTask(item)
      && String(item?.cardId || '') === String(task?.cardId || '')
      && String(item?.routeOpId || '') === String(task?.routeOpId || '')
      && String(item?.areaId || '') === String(task?.areaId || '')
      && getSubcontractChainId(item) === chainId
      && item?.closePagePreview !== true
    ))
    .slice()
    .sort((a, b) => {
      if (String(a?.date || '') !== String(b?.date || '')) {
        return String(a?.date || '').localeCompare(String(b?.date || ''));
      }
      const shiftDiff = (parseInt(a?.shift, 10) || 1) - (parseInt(b?.shift, 10) || 1);
      if (shiftDiff !== 0) return shiftDiff;
      return (Number(a?.createdAt) || 0) - (Number(b?.createdAt) || 0);
    });
}

function getSubcontractChainMeta(task) {
  if (!isSubcontractTask(task)) {
    return {
      isSubcontract: false,
      chainTasks: [],
      isFirst: true,
      isLast: true,
      isSingle: true,
      isMiddle: false
    };
  }
  const chainTasks = getSubcontractChainTasks(task);
  const currentId = String(task?.id || '');
  const firstId = String(chainTasks[0]?.id || '');
  const lastId = String(chainTasks[chainTasks.length - 1]?.id || '');
  const isFirst = firstId === currentId;
  const isLast = lastId === currentId;
  return {
    isSubcontract: true,
    chainTasks,
    isFirst,
    isLast,
    isSingle: isFirst && isLast,
    isMiddle: !isFirst && !isLast
  };
}

function getSubcontractTaskItems(task, card, op) {
  const itemIds = normalizeSubcontractItemIds(task?.subcontractItemIds);
  if (!itemIds.length) return [];
  const list = op?.isSamples
    ? getFlowSamplesForOperation(card?.flow || {}, op)
    : getFlowItemsForOperation(card, op);
  return itemIds.map(itemId => list.find(item => String(item?.id || '') === itemId) || null).filter(Boolean);
}

function getSubcontractTaskCompletionCounts(task, card, op) {
  const counts = { good: 0, delayed: 0, defect: 0, pending: 0, total: 0 };
  getSubcontractTaskItems(task, card, op).forEach(item => {
    counts.total += 1;
    const finalStatus = String(item?.finalStatus || item?.current?.status || '').trim().toUpperCase();
    if (finalStatus === 'GOOD') counts.good += 1;
    else if (finalStatus === 'DELAYED') counts.delayed += 1;
    else if (finalStatus === 'DEFECT') counts.defect += 1;
    else counts.pending += 1;
  });
  return counts;
}

function normalizePlanningFlowItemStatus(value) {
  return String(value || '').trim().toUpperCase();
}

function isPlanningFlowItemFinished(item) {
  const finalStatus = normalizePlanningFlowItemStatus(item?.finalStatus || item?.current?.status);
  return finalStatus === 'GOOD' || finalStatus === 'DELAYED' || finalStatus === 'DEFECT';
}

function getPlanningFlowItemsForOperation(card, op) {
  if (!card || !op) return [];
  if (typeof ensureCardFlowForUi === 'function') ensureCardFlowForUi(card);
  const flow = card?.flow || {};
  if (op.isSamples) {
    return typeof getFlowSamplesForOperation === 'function'
      ? getFlowSamplesForOperation(flow, op)
      : [];
  }
  return Array.isArray(flow?.items) ? flow.items : [];
}

function getPlanningOperationOrderMap(card) {
  const map = new Map();
  (card?.operations || []).forEach((item, index) => {
    const opId = String(item?.id || item?.opId || '').trim();
    if (!opId) return;
    const orderValue = Number.isFinite(Number(item?.order)) ? Number(item.order) : (index + 1);
    map.set(opId, orderValue);
  });
  return map;
}

function isPlanningFlowItemAvailableForOperation(item, card, op, opOrderMap = null) {
  if (!item || !card || !op || isPlanningFlowItemFinished(item)) return false;
  const currentStatus = normalizePlanningFlowItemStatus(item?.current?.status);
  if (currentStatus !== 'PENDING') return false;
  const currentOpId = String(item?.current?.opId || '').trim();
  const routeOpId = String(op?.id || op?.opId || '').trim();
  if (!currentOpId || !routeOpId) return false;
  if (currentOpId === routeOpId) return true;
  const orderMap = opOrderMap || getPlanningOperationOrderMap(card);
  const currentOrder = orderMap.get(routeOpId);
  const itemOrder = orderMap.get(currentOpId);
  return Number.isFinite(currentOrder) && Number.isFinite(itemOrder) && itemOrder < currentOrder;
}

function collectReservedSubcontractItemIds(cardId, routeOpId, { excludeTaskId = '' } = {}) {
  const reservedIds = new Set();
  const normalizedCardId = String(cardId || '').trim();
  const normalizedRouteOpId = String(routeOpId || '').trim();
  const excludedTaskId = String(excludeTaskId || '').trim();
  (productionShiftTasks || []).forEach(task => {
    if (!task || !isSubcontractTask(task)) return;
    if (!shouldCountTaskInPlanningCoverage(task)) return;
    if (normalizedCardId && String(task?.cardId || '').trim() !== normalizedCardId) return;
    if (normalizedRouteOpId && String(task?.routeOpId || '').trim() !== normalizedRouteOpId) return;
    if (excludedTaskId && String(task?.id || '').trim() === excludedTaskId) return;
    normalizeSubcontractItemIds(task?.subcontractItemIds).forEach(itemId => reservedIds.add(itemId));
  });
  return reservedIds;
}

function getAvailableSubcontractPlanningItems(card, op, options = {}) {
  const list = getPlanningFlowItemsForOperation(card, op);
  const opOrderMap = getPlanningOperationOrderMap(card);
  const reservedIds = options?.excludeReserved === false
    ? new Set()
    : collectReservedSubcontractItemIds(card?.id, op?.id, options);
  return list.filter(item => {
    const itemId = String(item?.id || '').trim();
    if (!itemId || reservedIds.has(itemId)) return false;
    return isPlanningFlowItemAvailableForOperation(item, card, op, opOrderMap);
  });
}

function hasNextSubcontractChainTask(task) {
  if (!isSubcontractTask(task)) return false;
  const chainTasks = getSubcontractChainTasks(task);
  const currentId = String(task?.id || '');
  const idx = chainTasks.findIndex(item => String(item?.id || '') === currentId);
  return idx >= 0 && idx < chainTasks.length - 1;
}

function getProductionShiftFactKey(cardId, routeOpId, dateStr, shift) {
  return [
    String(cardId || ''),
    String(routeOpId || ''),
    String(dateStr || ''),
    String(parseInt(shift, 10) || 1)
  ].join('|');
}

function getProductionShiftFactSourceItems(card, op) {
  ensureProductionFlow(card);
  const flow = card?.flow || {};
  const archived = Array.isArray(flow.archivedItems) ? flow.archivedItems : [];
  const normalizeSample = typeof normalizeSampleType === 'function'
    ? normalizeSampleType
    : (value) => ((value || '').toString().trim().toUpperCase() === 'WITNESS' ? 'WITNESS' : 'CONTROL');
  if (op?.isSamples) {
    const active = typeof getFlowSamplesForOperation === 'function'
      ? getFlowSamplesForOperation(flow, op)
      : (Array.isArray(flow.samples) ? flow.samples : []);
    const sampleType = normalizeSample(op?.sampleType);
    const archivedSamples = archived.filter(item => {
      const kind = String(item?.kind || '').trim().toUpperCase();
      if (kind !== 'SAMPLE') return false;
      return normalizeSample(item?.sampleType) === sampleType;
    });
    return active.concat(archivedSamples);
  }
  const activeItems = Array.isArray(flow.items) ? flow.items : [];
  const archivedItems = archived.filter(item => {
    const kind = String(item?.kind || '').trim().toUpperCase();
    return !kind || kind === 'ITEM';
  });
  return activeItems.concat(archivedItems);
}

function normalizeProductionShiftFactStats(stats = null) {
  const good = Math.max(0, Number(stats?.good || stats?.goodQty || 0));
  const delayed = Math.max(0, Number(stats?.delayed || stats?.delayedQty || 0));
  const defect = Math.max(0, Number(stats?.defect || stats?.defectQty || 0));
  const explicitTotal = Math.max(0, Number(stats?.total || stats?.factTotal || stats?.doneQty || 0));
  const fallbackTotal = good + delayed + defect;
  return {
    total: explicitTotal > 0 || fallbackTotal === 0 ? explicitTotal : fallbackTotal,
    good,
    delayed,
    defect
  };
}

function computeProductionShiftFactStatsFromHistory(card, op, dateStr, shift) {
  if (!card || !op || !dateStr || !Number.isFinite(parseInt(shift, 10))) {
    return { total: 0, good: 0, delayed: 0, defect: 0 };
  }
  const normalizedShift = Math.max(1, parseInt(shift, 10));
  const opId = String(op?.id || op?.opId || '').trim();
  const stats = { total: 0, good: 0, delayed: 0, defect: 0 };
  getProductionShiftFactSourceItems(card, op).forEach(item => {
    const history = Array.isArray(item?.history) ? item.history : [];
    history.forEach(entry => {
      if (!entry) return;
      if (String(entry?.shiftDate || '').trim() !== String(dateStr || '').trim()) return;
      if ((parseInt(entry?.shift, 10) || 0) !== normalizedShift) return;
      if (String(entry?.opId || '').trim() !== opId) return;
      const status = String(entry?.status || '').trim().toUpperCase();
      if (status === 'GOOD') {
        stats.good += 1;
        stats.total += 1;
      } else if (status === 'DELAYED') {
        stats.delayed += 1;
        stats.total += 1;
      } else if (status === 'DEFECT') {
        stats.defect += 1;
        stats.total += 1;
      }
    });
  });
  return stats;
}

function getFrozenProductionShiftFactStats(cardId, routeOpId, dateStr, shift) {
  const record = ensureProductionShift(dateStr, shift, { reason: 'data' });
  const snapshot = getProductionShiftCloseSnapshot(record);
  const key = getProductionShiftFactKey(cardId, routeOpId, dateStr, shift);
  if (snapshot?.operationFacts && snapshot.operationFacts[key]) {
    return normalizeProductionShiftFactStats(snapshot.operationFacts[key]);
  }
  const row = Array.isArray(snapshot?.rows)
    ? (snapshot.rows.find(item => (
      String(item?.cardId || '') === String(cardId || '')
      && String(item?.routeOpId || '') === String(routeOpId || '')
      && String(item?.date || '') === String(dateStr || '')
      && (parseInt(item?.shift, 10) || 1) === (parseInt(shift, 10) || 1)
    )) || null)
    : null;
  if (!row) return null;
  return normalizeProductionShiftFactStats({
    factTotal: row.shiftFactTotal,
    goodQty: row.shiftFactGood,
    delayedQty: row.shiftFactDelayed,
    defectQty: row.shiftFactDefect
  });
}

function getProductionShiftOperationFactStats(card, op, dateStr, shift) {
  if (!card || !op || !dateStr) return { total: 0, good: 0, delayed: 0, defect: 0 };
  if (isShiftFixed(dateStr, shift) || getProductionShiftStatus(dateStr, shift) === 'CLOSED') {
    const frozen = getFrozenProductionShiftFactStats(card.id, op.id, dateStr, shift);
    if (frozen) return frozen;
  }
  return normalizeProductionShiftFactStats(computeProductionShiftFactStatsFromHistory(card, op, dateStr, shift));
}

function buildProductionShiftFactSummary(card, op, dateStr, shift, { plannedQtyText = '' } = {}) {
  const stats = getProductionShiftOperationFactStats(card, op, dateStr, shift);
  return buildProductionShiftFactSummaryFromStats(op, stats, { plannedQtyText });
}

function buildProductionShiftFactSummaryFromStats(op, stats, { plannedQtyText = '' } = {}) {
  if (isMaterialIssueOperation(op) || isMaterialReturnOperation(op) || isDryingOperation(op)) {
    return '';
  }
  const normalizedStats = {
    total: Math.max(0, Number(stats?.total || 0)),
    good: Math.max(0, Number(stats?.good || 0)),
    delayed: Math.max(0, Number(stats?.delayed || 0)),
    defect: Math.max(0, Number(stats?.defect || 0))
  };
  const normalizeSample = typeof normalizeSampleType === 'function'
    ? normalizeSampleType
    : (value) => ((value || '').toString().trim().toUpperCase() === 'WITNESS' ? 'WITNESS' : 'CONTROL');
  const kindLabel = op?.isSamples
    ? (normalizeSample(op.sampleType) === 'WITNESS' ? 'ОС' : 'ОК')
    : 'Изд.';
  return [
    '<span class="production-op-summary-token production-op-summary-flow production-op-summary-flow-shiftfact">',
    `<span class="production-op-summary-label${op?.isSamples ? ' op-items-kind-samples' : ''}">${escapeHtml(kindLabel)}</span>`,
    plannedQtyText ? `<span class="production-op-summary-plan">План: ${escapeHtml(String(plannedQtyText))}</span>` : '',
    `<span class="production-op-summary-main">Факт: ${escapeHtml(String(normalizedStats.total || 0))}</span>`,
    '<span class="production-op-summary-sep">(</span>',
    `<span class="production-op-summary-done op-items-summary-done">${escapeHtml(String(normalizedStats.good || 0))}</span>`,
    '<span class="production-op-summary-sep">/</span>',
    `<span class="production-op-summary-delayed op-items-summary-delayed op-item-status-delayed">${escapeHtml(String(normalizedStats.delayed || 0))}</span>`,
    '<span class="production-op-summary-sep">/</span>',
    `<span class="production-op-summary-defect op-items-summary-defect op-item-status-defect">${escapeHtml(String(normalizedStats.defect || 0))}</span>`,
    '<span class="production-op-summary-sep">)</span>',
    '<span class="production-op-summary-main">шт.</span>',
    '</span>'
  ].join(' ');
}

function getProductionPlanDryingFillState(card, op, row = null) {
  const target = row || op;
  if (!target || !isDryingOperation(target)) return '';
  const status = String(row ? (row?.status || '') : (op?.status || '')).toUpperCase();
  const isCompleted = row
    ? (row?.isCompleted === true || status === 'DONE')
    : (status === 'DONE');
  const hasDryPowder = row
    ? (row?.dryingHasDonePowder === true || ((row?.dryingHasDonePowder == null) && isCompleted))
    : ((typeof buildDryingRows === 'function' ? buildDryingRows(card, op) : []).some(item => String(item?.status || '').toUpperCase() === 'DONE'));
  return (isCompleted && hasDryPowder) ? 'done' : 'pending';
}

function hasProductionPlanDryingLivePlan(card, op) {
  if (!card?.id || !op?.id || !isDryingOperation(op)) return false;
  const snapshot = getOperationPlanningSnapshot(card.id, op.id);
  return Math.max(0, Number(snapshot?.plannedMinutes || 0)) > 0;
}

function getProductionPlanDryingQueueState(card, op, { historicalIndex = null } = {}) {
  if (!card?.id || !op?.id || !isDryingOperation(op)) return '';
  if (getProductionPlanDryingFillState(card, op) === 'done') return 'done';
  const hasLivePlan = hasProductionPlanDryingLivePlan(card, op);
  const opKey = makeProductionPlanningOpKey(card.id, op.id);
  const hasHistoricalReplan = Boolean(historicalIndex?.dryingHistoricalOpKeys?.has(opKey));
  if (hasHistoricalReplan && !hasLivePlan) return 'replan';
  if (hasLivePlan) return 'planned';
  return 'pending';
}

function getProductionPlanDryingTableLiveState(card, op, task = null) {
  const target = op || task;
  if (!card || !target || !isDryingOperation(target)) return '';
  return getProductionPlanDryingFillState(card, target) === 'done' ? 'done' : 'planned';
}

function getProductionPlanDryingTableHistoricalState(card, op, row) {
  const target = op || row;
  if (!row || !target || !isDryingOperation(target)) return '';
  return getProductionPlanDryingFillState(card, target, row) === 'done' ? 'done' : 'replan';
}

function getProductionPlanDryingClass(state, { target = 'queue' } = {}) {
  const normalizedState = String(state || '').trim();
  if (!normalizedState || normalizedState === 'pending') return '';
  if (target === 'table' && normalizedState === 'planned') return '';
  if (target === 'table') {
    return ` production-shift-board-op-drying-state-${normalizedState}`;
  }
  return ` production-shifts-op-drying-state-${normalizedState}`;
}

function getProductionPlanTaskStatusFillStyle(task, card, op) {
  if (!task || !card || !op) return '';
  if (isMaterialIssueOperation(op) || isMaterialReturnOperation(op) || isDryingOperation(op)) return '';
  const snapshot = getOperationPlanningSnapshot(card.id, op.id);
  if (!snapshot?.qtyDriven || !(Number(snapshot.minutesPerUnit) > 0)) return '';
  const stats = getProductionShiftOperationFactStats(card, op, task.date, task.shift);
  const factTotal = Math.max(0, Number(stats?.total || 0));
  if (!(factTotal > 0)) return '';
  const plannedQty = Math.max(0, getTaskPlannedQuantity(task));
  const visualBaseQty = Math.max(plannedQty, factTotal);
  if (!(visualBaseQty > 0)) return '';
  const segments = getPlanningFillSegments(visualBaseQty, {
    goodMinutes: Math.max(0, Number(stats?.good || 0)),
    delayedMinutes: Math.max(0, Number(stats?.delayed || 0)),
    defectMinutes: Math.max(0, Number(stats?.defect || 0))
  });
  const coveredEnd = Math.max(
    Number(segments?.goodEnd || 0),
    Number(segments?.delayedEnd || 0),
    Number(segments?.defectEnd || 0)
  );
  if (!(coveredEnd > 0)) return '';
  return getPlanningFillStyleVars(coveredEnd, segments);
}

function buildProductionShiftBoardOpMeta(card, op, task, { shiftDate = '', shiftNumber = null, hideStatus = true } = {}) {
  if (!op) {
    return buildProductionPlanOpMeta(card, op || task, {
      hideStatus,
      shiftDate,
      shiftNumber
    });
  }
  const status = op.status || 'NOT_STARTED';
  const plannedQty = Math.max(0, getTaskPlannedQuantity(task));
  const plannedQtyText = formatPlanningQtyValue(plannedQty);
  const isRegularOperation = !isMaterialIssueOperation(op) && !isMaterialReturnOperation(op) && !isDryingOperation(op);
  const statusClass = getProductionPlanOpStatusClass(status);
  const statusLabel = getProductionPlanOpStatusLabel(status);
  const statusHtml = hideStatus
    ? ''
    : `<span class="badge production-op-status ${statusClass}">${escapeHtml(statusLabel)}</span>`;
  if (card && shiftDate && Number.isFinite(parseInt(shiftNumber, 10)) && isRegularOperation) {
    return `
      <div class="production-op-meta-wrap">
        ${statusHtml}
        ${buildProductionShiftFactSummary(card, op, shiftDate, shiftNumber, { plannedQtyText })}
      </div>
    `;
  }
  return buildProductionPlanOpMeta(card, op, {
    plannedLabel: `План: ${plannedQtyText}`,
    hideStatus,
    shiftDate,
    shiftNumber,
    shiftFactPlannedQtyText: plannedQtyText
  });
}

function buildPlanningTaskLogText(task, op = null) {
  if (!task) return '';
  const dateLabel = typeof getProductionDayLabel === 'function'
    ? (getProductionDayLabel(task.date || '').date || String(task.date || ''))
    : String(task.date || '');
  const shift = parseInt(task.shift, 10) || 1;
  const areaName = getPlanningTaskAreaName(task.areaId);
  const minutes = typeof getTaskPlannedMinutes === 'function'
    ? getTaskPlannedMinutes(task)
    : (Number(task.plannedPartMinutes) || 0);
  const minutesLabel = `${Math.max(0, Math.round(minutes || 0))} мин`;
  const qtyLabel = typeof getTaskPlannedQuantityLabel === 'function'
    ? getTaskPlannedQuantityLabel(task, op)
    : '';
  return `Участок: ${areaName}; дата: ${dateLabel}; смена: ${shift}; объём: ${qtyLabel ? `${qtyLabel} / ` : ''}${minutesLabel}`;
}

function recordCardPlanningTaskLog(task, action, prevTask = null) {
  if (!task || typeof recordCardLog !== 'function') return;
  const card = (cards || []).find(item => String(item?.id || '') === String(task.cardId)) || null;
  if (!card) return;
  const op = (card.operations || []).find(item => String(item?.id || '') === String(task.routeOpId)) || null;
  const object = (op?.opName || op?.name || op?.opCode || 'Операция').trim();
  const nextText = buildPlanningTaskLogText(task, op);
  const prevOp = prevTask
    ? ((card.operations || []).find(item => String(item?.id || '') === String(prevTask.routeOpId)) || op)
    : op;
  const prevText = prevTask ? buildPlanningTaskLogText(prevTask, prevOp) : '';
  let logAction = 'Планирование операции';
  let oldValue = '';
  let newValue = nextText;
  if (action === 'REMOVE_TASK_FROM_SHIFT') {
    logAction = 'Удаление из плана';
    oldValue = nextText;
    newValue = '';
  } else if (action === 'MOVE_TASK_TO_SHIFT') {
    logAction = 'Перенос в плане';
    oldValue = prevText;
    newValue = nextText;
  } else if (action === 'ADD_TASK_TO_SHIFT') {
    logAction = 'Добавление в план';
  }
  recordCardLog(card, {
    action: logAction,
    object,
    field: 'planning',
    targetId: task.routeOpId || null,
    oldValue,
    newValue
  });
}

function logProductionTaskMove(fromTask, toTask) {
  if (!fromTask || !toTask) return;
  const shiftRecord = ensureProductionShift(toTask.date, toTask.shift, { reason: 'data' });
  if (!shiftRecord) return;
  recordShiftLog(shiftRecord, {
    action: 'MOVE_TASK_TO_SHIFT',
    object: 'Операция',
    targetId: toTask.routeOpId || null,
    field: 'shiftCell',
    oldValue: `${fromTask.date} / смена ${fromTask.shift} / ${fromTask.areaId}`,
    newValue: `${toTask.date} / смена ${toTask.shift} / ${toTask.areaId}`
  });
}

let productionShiftTasksByCellKey = new Map();
let productionScheduleCommitQueue = Promise.resolve();
let productionPlanningCommitQueue = Promise.resolve();
const productionPlanningRevisionState = {
  production: null,
  schedule: null,
  plan: null,
  shifts: null,
  'shift-close': null,
  gantt: null
};
let productionPlanningStatsByOpKey = new Map();
let productionShiftDragTaskId = null;

function makeProductionShiftCellKey(dateStr, shift, areaId) {
  const d = String(dateStr ?? '');
  const s = (parseInt(shift, 10) || 1);
  const a = String(areaId ?? '');
  return `${d}|${s}|${a}`;
}

function makeProductionPlanningOpKey(cardId, routeOpId) {
  return `${String(cardId ?? '')}|${String(routeOpId ?? '')}`;
}

function normalizeProductionPlanningSliceClient(slice = '') {
  const value = String(slice || '').trim().toLowerCase();
  if (value === 'production-schedule') return 'schedule';
  if (value === 'production-plan') return 'plan';
  if (value === 'production-shifts') return 'shifts';
  if (value === 'shift-close' || value === 'production-shift-close') return 'shift-close';
  if (value === 'gantt' || value === 'production-gantt') return 'gantt';
  if (['production', 'planning', 'schedule', 'plan', 'shifts', 'shift-close', 'gantt'].includes(value)) return value;
  return 'production';
}

function updateProductionPlanningRevisionFromPayload(payload, fallbackSlice = 'production') {
  const revision = payload?.revision || payload?.productionPlanningRevision || null;
  const rev = Number(revision?.rev ?? revision);
  if (!Number.isFinite(rev)) return;
  const slice = normalizeProductionPlanningSliceClient(payload?.slice || fallbackSlice);
  productionPlanningRevisionState[slice] = rev;
  if (slice === 'production' || slice === 'planning') {
    ['production', 'schedule', 'plan', 'shifts', 'shift-close', 'gantt'].forEach(key => {
      productionPlanningRevisionState[key] = rev;
    });
  }
}

function getProductionPlanningExpectedRev(slice = 'production') {
  const normalized = normalizeProductionPlanningSliceClient(slice);
  const direct = Number(productionPlanningRevisionState[normalized]);
  if (Number.isFinite(direct)) return direct;
  const productionRev = Number(productionPlanningRevisionState.production);
  return Number.isFinite(productionRev) ? productionRev : null;
}

function withProductionPlanningExpectedRev(payload, slice = 'production') {
  const expectedRev = getProductionPlanningExpectedRev(slice);
  if (!Number.isFinite(expectedRev)) return { ...(payload || {}) };
  return { ...(payload || {}), expectedRev };
}

function rebuildProductionShiftTasksIndex() {
  const cellMap = new Map();
  const planningStatsMap = new Map();
  (productionShiftTasks || []).forEach(task => {
    const opKey = makeProductionPlanningOpKey(task?.cardId, task?.routeOpId);
    if (opKey !== '|' && shouldCountTaskInPlanningCoverage(task)) {
      if (!planningStatsMap.has(opKey)) {
        planningStatsMap.set(opKey, { plannedMinutes: 0, plannedQty: 0, subcontractItemIds: new Set() });
      }
      const stats = planningStatsMap.get(opKey);
      stats.plannedMinutes += getTaskPlannedMinutes(task);
      if (isSubcontractTask(task)) {
        const itemIds = normalizeSubcontractItemIds(task?.subcontractItemIds);
        if (itemIds.length) {
          itemIds.forEach(itemId => {
            if (stats.subcontractItemIds.has(itemId)) return;
            stats.subcontractItemIds.add(itemId);
            stats.plannedQty += 1;
          });
        } else {
          stats.plannedQty += getTaskPlannedQuantity(task);
        }
      } else {
        stats.plannedQty += getTaskPlannedQuantity(task);
      }
    }
    if (isPlanningHiddenTask(task)) return;
    const key = makeProductionShiftCellKey(task.date, task.shift, task.areaId);
    if (!cellMap.has(key)) cellMap.set(key, []);
    cellMap.get(key).push(task);
  });
  productionShiftTasksByCellKey = cellMap;
  productionPlanningStatsByOpKey = planningStatsMap;
}

function shouldCountTaskInPlanningCoverage(task) {
  if (!task || task.closePagePreview === true) return false;
  const dateStr = String(task?.date || '');
  const shift = parseInt(task?.shift, 10) || 1;
  if (!dateStr) return false;
  if (isShiftFixed(dateStr, shift)) return false;
  const status = getProductionShiftStatus(dateStr, shift);
  return status !== 'CLOSED' && status !== 'LOCKED';
}

function onProductionShiftTasksChanged({ rerenderCurrentRoute = false } = {}) {
  rebuildProductionShiftTasksIndex();
  if (!rerenderCurrentRoute) return;
  const currentPath = window.location.pathname || '';
  if (currentPath === '/production/plan' && typeof renderProductionShiftsPage === 'function') {
    renderProductionShiftsPage();
    return;
  }
  if (currentPath === '/production/shifts' && typeof renderProductionShiftBoardPage === 'function') {
    renderProductionShiftBoardPage();
    return;
  }
  if (currentPath.startsWith('/production/gantt/') && typeof renderProductionGanttPage === 'function') {
    renderProductionGanttPage(currentPath);
  }
}

function getProductionShiftCellElement(dateStr, shift, areaId) {
  const section = document.getElementById('production-shifts');
  if (!section) return null;
  return section.querySelector(
    `.production-shifts-cell[data-date="${CSS.escape(String(dateStr || ''))}"][data-shift="${parseInt(shift, 10) || 1}"][data-area-id="${CSS.escape(String(areaId || ''))}"]`
  );
}

function updateProductionShiftCellLoad(cell) {
  if (!cell) return;
  const date = cell.getAttribute('data-date') || '';
  const areaId = cell.getAttribute('data-area-id') || '';
  const shift = parseInt(cell.getAttribute('data-shift'), 10) || 1;
  const loadEl = cell.querySelector('.production-shifts-load');
  if (!loadEl) return;
  const shiftTotalMinutes = getShiftDurationMinutesForArea(shift, areaId);
  const plannedSumMinutes = getShiftPlannedMinutes(date, shift, areaId);
  const loadPct = Math.min(999, Math.max(0, Math.round((plannedSumMinutes / shiftTotalMinutes) * 100)));
  loadEl.textContent = `${loadPct}%`;
  loadEl.title = `Загрузка: ${plannedSumMinutes} / ${shiftTotalMinutes} мин`;
}

function updateProductionShiftCellEmptyState(cell) {
  if (!cell) return;
  const opsEl = cell.querySelector('.production-shift-ops');
  if (!opsEl) return;
  const taskEls = opsEl.querySelectorAll('.production-shift-task');
  const emptyEl = opsEl.querySelector('.production-shift-empty');
  if (!taskEls.length) {
    if (!emptyEl) {
      opsEl.innerHTML = '<div class="muted production-shift-empty">Нет операций</div>';
    }
    return;
  }
  if (emptyEl) emptyEl.remove();
}

function updateProductionShiftCellUi(cell) {
  if (!cell) return;
  updateProductionShiftCellEmptyState(cell);
  updateProductionShiftCellLoad(cell);
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

function getProductionPlanningStats(cardId, routeOpId) {
  return productionPlanningStatsByOpKey.get(makeProductionPlanningOpKey(cardId, routeOpId)) || { plannedMinutes: 0, plannedQty: 0 };
}

function roundPlanningMinutes(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.ceil(numeric - 1e-9);
}

function roundPlanningQty(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.round(numeric * 100) / 100;
}

function normalizePlanningWholeQty(value, maxQty = Infinity) {
  const numeric = Number(value);
  const qtyLimit = Number.isFinite(Number(maxQty)) ? Math.max(0, Math.floor(Number(maxQty))) : Infinity;
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.min(Math.max(0, Math.floor(numeric + 1e-9)), qtyLimit);
}

function getPlanningUnitLabel(op) {
  if (!op?.isSamples) return 'изд';
  return normalizeSampleType(op.sampleType) === 'WITNESS' ? 'ОС' : 'ОК';
}

function formatPlanningQtyValue(value) {
  return formatShiftPlanParts(roundPlanningQty(value));
}

function formatPlanningQtyWithUnit(value, unitLabel) {
  return `${formatPlanningQtyValue(value)} ${unitLabel || 'изд'}`;
}

function isQtyDrivenPlanningOperation(card, op) {
  return Boolean(card && op && card.cardType === 'MKI' && !isMaterialIssueOperation(op) && !isMaterialReturnOperation(op) && !isDryingOperation(op));
}

function getPlanningCardOperation(cardId, routeOpId) {
  const card = (cards || []).find(item => String(item?.id || '') === String(cardId)) || null;
  const op = (card?.operations || []).find(item => String(item?.id || '') === String(routeOpId)) || null;
  return { card, op };
}

function getOperationPlanningSnapshot(cardId, routeOpId) {
  const { card, op } = getPlanningCardOperation(cardId, routeOpId);
  const baseMinutes = getOperationTotalMinutes(cardId, routeOpId);
  const planningStats = getProductionPlanningStats(cardId, routeOpId);
  const plannedMinutes = Number(planningStats.plannedMinutes) || 0;
  const plannedQtyRaw = Number(planningStats.plannedQty) || 0;

  const baseQtyRaw = Number(getOperationQuantity(op, card));
  const qtyDriven = isQtyDrivenPlanningOperation(card, op) && Number.isFinite(baseQtyRaw) && baseQtyRaw > 0 && baseMinutes > 0;
  const unitLabel = getPlanningUnitLabel(op);

  if (!qtyDriven) {
    const requiredRemainingMinutes = baseMinutes;
    return {
      card,
      op,
      qtyDriven: false,
      unitLabel,
      baseMinutes,
      baseQty: 0,
      remainingQty: 0,
      coveredQty: 0,
      uncoveredQty: 0,
      minutesPerUnit: 0,
      plannedMinutes,
      requiredRemainingMinutes,
      availableToPlanMinutes: Math.max(0, requiredRemainingMinutes - plannedMinutes),
      overplannedMinutes: Math.max(0, plannedMinutes - requiredRemainingMinutes)
    };
  }

  const stats = typeof collectOpFlowStats === 'function'
    ? collectOpFlowStats(card, op)
    : { pendingOnOp: 0, awaiting: 0 };
  const remainingQty = roundPlanningQty(
    Math.max(0, Number(stats?.pendingOnOp || 0)) + Math.max(0, Number(stats?.awaiting || 0))
  );
  const plannedQty = normalizePlanningWholeQty(plannedQtyRaw, remainingQty);
  const minutesPerUnit = baseMinutes / baseQtyRaw;
  const requiredRemainingMinutes = roundPlanningMinutes(minutesPerUnit * remainingQty);
  const coveredQty = Math.min(remainingQty, Math.max(0, plannedQty));
  const uncoveredQty = Math.max(0, roundPlanningQty(remainingQty - coveredQty));
  const coveredMinutes = roundPlanningMinutes(minutesPerUnit * coveredQty);
  const availableToPlanMinutes = roundPlanningMinutes(minutesPerUnit * uncoveredQty);
  const overplannedQty = Math.max(0, roundPlanningQty(plannedQty - remainingQty));

  return {
    card,
    op,
    qtyDriven: true,
    unitLabel,
    baseMinutes,
    baseQty: roundPlanningQty(baseQtyRaw),
    remainingQty,
    plannedQty,
    coveredQty,
    uncoveredQty,
    minutesPerUnit,
    plannedMinutes,
    coveredMinutes,
    requiredRemainingMinutes,
    availableToPlanMinutes,
    overplannedMinutes: roundPlanningMinutes(minutesPerUnit * overplannedQty)
  };
}

function getTaskPlannedQuantity(task) {
  if (!task) return 0;
  const stored = Number(task.plannedPartQty);
  if (Number.isFinite(stored) && stored > 0) return normalizePlanningWholeQty(stored);
  const snapshot = getOperationPlanningSnapshot(task.cardId, task.routeOpId);
  if (!snapshot.qtyDriven || snapshot.minutesPerUnit <= 0) return 0;
  return normalizePlanningWholeQty(getTaskPlannedMinutes(task) / snapshot.minutesPerUnit);
}

function getTaskPlannedQuantityLabel(task, op = null) {
  const qty = getTaskPlannedQuantity(task);
  if (qty <= 0) return '';
  const unitLabel = getPlanningUnitLabel(op || task);
  return formatPlanningQtyWithUnit(qty, unitLabel);
}

function getOperationPlannedShiftLabels(cardId, routeOpId) {
  if (!cardId || !routeOpId) return [];
  const { op } = getPlanningCardOperation(cardId, routeOpId);
  const items = (productionShiftTasks || [])
    .filter(task =>
      String(task?.cardId || '') === String(cardId)
      && String(task?.routeOpId || '') === String(routeOpId)
      && shouldCountTaskInPlanningCoverage(task)
    )
    .map(task => ({
      key: `${String(task?.date || '')}|${parseInt(task?.shift, 10) || 1}`,
      date: String(task?.date || ''),
      shift: parseInt(task?.shift, 10) || 1,
      plannedMinutes: getTaskPlannedMinutes(task),
      plannedQty: getTaskPlannedQuantity(task)
    }))
    .filter(item => item.date);
  const unique = new Map();
  items.forEach(item => {
    if (!unique.has(item.key)) {
      unique.set(item.key, { ...item });
      return;
    }
    const acc = unique.get(item.key);
    acc.plannedMinutes += item.plannedMinutes;
    acc.plannedQty += item.plannedQty;
  });
  return Array.from(unique.values())
    .sort((a, b) => {
      if (a.date === b.date) return a.shift - b.shift;
      return a.date.localeCompare(b.date);
    })
    .map(item => {
      const dateLabel = getProductionDayLabel(item.date).date || item.date;
      const minutesLabel = `${roundPlanningMinutes(item.plannedMinutes)} мин`;
      const qtyLabel = formatPlanningQtyWithUnit(roundPlanningQty(item.plannedQty), getPlanningUnitLabel(op));
      return `${dateLabel} / смена ${item.shift} / ${minutesLabel} / ${qtyLabel}`;
    });
}

function getOperationHistoricalShiftEntries(cardId, routeOpId) {
  if (!cardId || !routeOpId) return [];
  const { op } = getPlanningCardOperation(cardId, routeOpId);
  const entries = [];
  (productionShifts || []).forEach(record => {
    const snapshots = getProductionShiftCloseSnapshotHistory(record);
    snapshots.forEach((snapshot, snapshotIndex) => {
      const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
      rows.forEach(row => {
        if (String(row?.cardId || '') !== String(cardId)) return;
        if (String(row?.routeOpId || '') !== String(routeOpId)) return;
        const date = String(row?.date || '');
        const shift = parseInt(row?.shift, 10) || 1;
        if (!date) return;
        const plannedMinutes = Math.max(0, roundPlanningMinutes(Number(row?.plannedMinutes || 0)));
        const plannedQty = Math.max(0, roundPlanningQty(Number(row?.plannedQty || 0)));
        const dateLabel = getProductionDayLabel(date).date || date;
        const minutesLabel = plannedMinutes > 0 ? `${plannedMinutes} мин` : '';
        const qtyLabel = plannedQty > 0 ? formatPlanningQtyWithUnit(plannedQty, getPlanningUnitLabel(op || row)) : '';
        const fallbackPlanLabel = (!minutesLabel && !qtyLabel)
          ? String(row?.planDisplay || '').trim()
          : '';
        const factTotal = Math.max(0, Number(row?.shiftFactTotal || 0));
        const resolutionText = String(row?.resolutionText || '').trim();
        const labelParts = [`${dateLabel} / смена ${shift}`];
        if (minutesLabel) labelParts.push(minutesLabel);
        if (qtyLabel) labelParts.push(qtyLabel);
        if (fallbackPlanLabel && fallbackPlanLabel !== '—' && fallbackPlanLabel !== '-') labelParts.push(fallbackPlanLabel);
        if (factTotal > 0) labelParts.push(`факт ${factTotal}`);
        if (resolutionText) labelParts.push(resolutionText);
        entries.push({
          key: [
            String(record?.id || ''),
            String(snapshot?.savedAt || snapshot?.closedAt || 0),
            String(snapshotIndex),
            date,
            String(shift)
          ].join('|'),
          label: labelParts.join(' / '),
          date,
          shift,
          savedAt: Number(snapshot?.savedAt || snapshot?.closedAt || 0),
          snapshotIndex
        });
      });
    });
  });
  entries.sort((a, b) => {
    if (a.savedAt !== b.savedAt) return a.savedAt - b.savedAt;
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.shift !== b.shift) return a.shift - b.shift;
    return a.snapshotIndex - b.snapshotIndex;
  });
  return entries;
}

function buildOperationShiftSlotsHtml(cardId, routeOpId) {
  const activeLabels = getOperationPlannedShiftLabels(cardId, routeOpId);
  const historyEntries = getOperationHistoricalShiftEntries(cardId, routeOpId);
  if (!activeLabels.length && !historyEntries.length) return '';
  const activeHtml = activeLabels.map(label => `<div class="production-shifts-op-slot">${escapeHtml(label)}</div>`).join('');
  const historyHtml = historyEntries.map(entry => `<div class="production-shifts-op-slot production-shifts-op-slot-history">${escapeHtml(entry.label)}</div>`).join('');
  return `<div class="production-shifts-op-slots muted">${activeHtml}${historyHtml}</div>`;
}

function getOperationPlannedParts(cardId, routeOpId) {
  if (!cardId || !routeOpId) return [];
  return (productionShiftTasks || [])
    .filter(task => String(task?.cardId || '') === String(cardId) && String(task?.routeOpId || '') === String(routeOpId))
    .map(task => {
      const date = String(task?.date || '');
      const shift = parseInt(task?.shift, 10) || 1;
      const areaId = String(task?.areaId || '');
      const areaName = getPlanningTaskAreaName(areaId);
      const dateLabel = getProductionDayLabel(date).date || date;
      return {
        id: String(task?.id || ''),
        date,
        shift,
        areaId,
        areaName,
        label: `Перейти к «${dateLabel}» «${shift} смена» «${areaName}»`
      };
    })
    .filter(item => item.date && item.areaId)
    .sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      if (a.shift !== b.shift) return a.shift - b.shift;
      return a.areaName.localeCompare(b.areaName, 'ru');
    });
}

function buildPlanningCoverageMeta(card, op) {
  if (!card || !op) return '';
  const metrics = getOperationPlanningVisualMetrics(card, op);
  if (!metrics.qtyDriven) {
    return `Не запл.: ${metrics.unplannedMinutes} мин`;
  }
  return `Не запл.: ${metrics.unplannedMinutes} мин / ${formatPlanningQtyWithUnit(metrics.unplannedQty, metrics.unitLabel)}`;
}

function getProductionPlanCoveragePercent(card, op) {
  return getOperationPlanningVisualMetrics(card, op).planFillPercent;
}

function clampPlanningPercent(value) {
  if (!Number.isFinite(Number(value))) return 0;
  return Math.min(100, Math.max(0, Math.round(Number(value) * 10) / 10));
}

function getPlanningFillSegments(totalMinutes, { goodMinutes = 0, delayedMinutes = 0, defectMinutes = 0 } = {}) {
  const total = Math.max(0, Number(totalMinutes) || 0);
  if (total <= 0) {
    return {
      goodPercent: 0,
      delayedPercent: 0,
      defectPercent: 0,
      goodStart: 0,
      goodEnd: 0,
      delayedStart: 0,
      delayedEnd: 0,
      defectStart: 0,
      defectEnd: 0
    };
  }
  const goodPercent = clampPlanningPercent((Math.max(0, Number(goodMinutes) || 0) / total) * 100);
  const delayedPercent = clampPlanningPercent((Math.max(0, Number(delayedMinutes) || 0) / total) * 100);
  const defectPercent = clampPlanningPercent((Math.max(0, Number(defectMinutes) || 0) / total) * 100);
  const goodEnd = clampPlanningPercent(goodPercent);
  const delayedStart = goodEnd;
  const delayedEnd = clampPlanningPercent(Math.min(100, delayedStart + delayedPercent));
  const defectStart = delayedEnd;
  const defectEnd = clampPlanningPercent(Math.min(100, defectStart + defectPercent));
  return {
    goodPercent,
    delayedPercent,
    defectPercent,
    goodStart: 0,
    goodEnd,
    delayedStart,
    delayedEnd,
    defectStart,
    defectEnd
  };
}

function getOperationPlanningVisualMetrics(card, op) {
  if (!card || !op) {
    return {
      qtyDriven: false,
      unitLabel: getPlanningUnitLabel(op),
      activeQty: 0,
      activeMinutes: 0,
      plannedMinutes: 0,
      unplannedMinutes: 0,
      unplannedQty: 0,
      goodQty: 0,
      delayedQty: 0,
      defectQty: 0,
      pendingQty: 0,
      goodMinutes: 0,
      delayedMinutes: 0,
      defectMinutes: 0,
      planFillPercent: 100,
      segments: getPlanningFillSegments(0)
    };
  }
  const snapshot = getOperationPlanningSnapshot(card.id, op.id);
  const stats = typeof getOperationExecutionStats === 'function'
    ? getOperationExecutionStats(card, op, { logConsistency: false })
    : { pendingOnOp: 0, awaiting: 0, good: 0, defect: 0, delayed: 0 };
  const goodQty = Math.max(0, Number(stats?.good || 0));
  const delayedQty = Math.max(0, Number(stats?.delayed || 0));
  const defectQty = Math.max(0, Number(stats?.defect || 0));
  const pendingQty = Math.max(0, Number(stats?.pendingOnOp || 0)) + Math.max(0, Number(stats?.awaiting || 0));
  const activeQty = goodQty + delayedQty + defectQty + pendingQty;

  if (!snapshot.qtyDriven || snapshot.minutesPerUnit <= 0) {
    const activeMinutes = Math.max(0, Number(snapshot.baseMinutes || snapshot.requiredRemainingMinutes || 0));
    const plannedMinutes = Math.min(activeMinutes, Math.max(0, Number(snapshot.plannedMinutes || 0)));
    const planFillPercent = activeMinutes > 0
      ? Math.min(100, Math.max(0, Math.round((plannedMinutes / activeMinutes) * 100)))
      : 100;
    return {
      ...snapshot,
      stats,
      qtyDriven: false,
      goodQty: 0,
      delayedQty: 0,
      defectQty: 0,
      pendingQty: 0,
      activeQty: 0,
      activeMinutes,
      plannedMinutes,
      unplannedMinutes: Math.max(0, activeMinutes - plannedMinutes),
      unplannedQty: 0,
      goodMinutes: 0,
      delayedMinutes: 0,
      defectMinutes: 0,
      planFillPercent,
      segments: getPlanningFillSegments(activeMinutes)
    };
  }

  const activeMinutes = roundPlanningMinutes(snapshot.minutesPerUnit * activeQty);
  const executedQty = goodQty + delayedQty + defectQty;
  const visualCoveredQty = Math.min(
    activeQty,
    Math.max(0, roundPlanningQty(executedQty + Math.max(0, Number(snapshot.coveredQty || 0))))
  );
  const plannedMinutes = Math.min(
    activeMinutes,
    roundPlanningMinutes(snapshot.minutesPerUnit * visualCoveredQty)
  );
  const goodMinutes = roundPlanningMinutes(snapshot.minutesPerUnit * goodQty);
  const delayedMinutes = roundPlanningMinutes(snapshot.minutesPerUnit * delayedQty);
  const defectMinutes = roundPlanningMinutes(snapshot.minutesPerUnit * defectQty);
  const unplannedQty = Math.max(0, roundPlanningQty(activeQty - visualCoveredQty));
  const unplannedMinutes = Math.max(0, roundPlanningMinutes(activeMinutes - plannedMinutes));
  const planFillPercent = activeMinutes > 0
    ? Math.min(100, Math.max(0, Math.round((plannedMinutes / activeMinutes) * 100)))
    : 100;

  return {
    ...snapshot,
    stats,
    goodQty,
    delayedQty,
    defectQty,
    pendingQty,
    activeQty,
    activeMinutes,
    plannedMinutes,
    unplannedMinutes,
    unplannedQty,
    goodMinutes,
    delayedMinutes,
    defectMinutes,
    planFillPercent,
    segments: getPlanningFillSegments(activeMinutes, {
      goodMinutes,
      delayedMinutes,
      defectMinutes
    })
  };
}

function getPlanningFillStyleVars(planFillPercent, segments, { prefix = '' } = {}) {
  const normalizedPrefix = String(prefix || '');
  const varName = (name) => normalizedPrefix ? `--${normalizedPrefix}-${name}` : `--${name}`;
  const formatPercent = (value) => `${clampPlanningPercent(value)}%`;
  const coveredEnd = Math.max(
    Number(segments?.goodEnd || 0),
    Number(segments?.delayedEnd || 0),
    Number(segments?.defectEnd || 0)
  );
  return [
    `${varName('plan-fill')}:${formatPercent(planFillPercent)}`,
    `${varName('covered-end')}:${formatPercent(coveredEnd)}`,
    `${varName('good-start')}:${formatPercent(segments?.goodStart || 0)}`,
    `${varName('good-end')}:${formatPercent(segments?.goodEnd || 0)}`,
    `${varName('delayed-start')}:${formatPercent(segments?.delayedStart || 0)}`,
    `${varName('delayed-end')}:${formatPercent(segments?.delayedEnd || 0)}`,
    `${varName('defect-start')}:${formatPercent(segments?.defectStart || 0)}`,
    `${varName('defect-end')}:${formatPercent(segments?.defectEnd || 0)}`
  ].join('; ');
}

function getPlanningExecutionOnlyStyleVars(segments, { prefix = '' } = {}) {
  const coveredEnd = Math.max(
    Number(segments?.goodEnd || 0),
    Number(segments?.delayedEnd || 0),
    Number(segments?.defectEnd || 0)
  );
  if (!(coveredEnd > 0)) return '';
  return getPlanningFillStyleVars(coveredEnd, segments, { prefix });
}

function getPlanningHistoryFillStyleVars(startPercent, fillPercent, { prefix = '' } = {}) {
  const normalizedPrefix = String(prefix || '');
  const varName = (name) => normalizedPrefix ? `--${normalizedPrefix}-${name}` : `--${name}`;
  const safeStart = clampPlanningPercent(startPercent);
  const safeEnd = clampPlanningPercent(safeStart + Math.max(0, Number(fillPercent) || 0));
  if (!(safeEnd > safeStart)) return '';
  return [
    `${varName('history-remaining-start')}:${safeStart}%`,
    `${varName('history-remaining-end')}:${safeEnd}%`
  ].join('; ');
}

function getPlanningFillStyleWithHistory(planFillPercent, segments, { prefix = '', historyFillPercent = 0 } = {}) {
  const baseStyle = getPlanningFillStyleVars(planFillPercent, segments, { prefix });
  const historyStyle = getPlanningHistoryFillStyleVars(planFillPercent, historyFillPercent, { prefix });
  return [baseStyle, historyStyle].filter(Boolean).join('; ');
}

function isPlanningHiddenOperation(op) {
  return Boolean(op) && (
    isMaterialIssueOperation(op) ||
    isMaterialReturnOperation(op)
  );
}

function getPlannableShiftOperations(operations) {
  return (operations || []).filter(op => op && !isPlanningHiddenOperation(op));
}

function makeProductionPlanHistoricalSourceKey(dateStr, shift, cardId, routeOpId) {
  const date = String(dateStr || '').trim();
  const shiftNumber = parseInt(shift, 10) || 0;
  const cid = String(cardId || '').trim();
  const opId = String(routeOpId || '').trim();
  if (!date || !(shiftNumber > 0) || !cid || !opId) return '';
  return `${date}|${shiftNumber}|${cid}|${opId}`;
}

function getProductionPlanHistoricalRowUnresolvedQty(row) {
  if (!row || row?.isQtyDriven !== true) return 0;
  const directValue = Number(row?.remainingQty);
  if (Number.isFinite(directValue) && directValue > 0) {
    return roundPlanningQty(directValue);
  }
  const plannedQty = Math.max(0, Number(row?.plannedQty || 0));
  const executedQty = Math.max(0, roundPlanningQty(
    Number(row?.shiftFactGood || 0) + Number(row?.shiftFactDelayed || 0) + Number(row?.shiftFactDefect || 0)
  ));
  return Math.max(0, roundPlanningQty(plannedQty - executedQty));
}

function buildProductionPlanQueueHistoricalIndex() {
  const sourcePlannedQtyByKey = new Map();
  const rawHistoricalQtyByOpKey = new Map();
  const sourceMatchedQtyByOpKey = new Map();
  const dryingHistoricalOpKeys = new Set();

  getVisibleProductionShiftTasks().forEach(task => {
    if (!shouldCountTaskInPlanningCoverage(task)) return;
    const sourceDate = String(task?.shiftCloseSourceDate || task?.sourceShiftDate || '').trim();
    const sourceShift = parseInt(task?.shiftCloseSourceShift ?? task?.sourceShift, 10) || 0;
    const key = makeProductionPlanHistoricalSourceKey(sourceDate, sourceShift, task?.cardId, task?.routeOpId);
    if (!key) return;
    const plannedQty = Math.max(0, getTaskPlannedQuantity(task));
    if (!(plannedQty > 0)) return;
    sourcePlannedQtyByKey.set(key, roundPlanningQty((sourcePlannedQtyByKey.get(key) || 0) + plannedQty));
  });

  (productionShifts || []).forEach(record => {
    const dateStr = String(record?.date || '').trim();
    const shift = parseInt(record?.shift, 10) || 1;
    if (!dateStr || !['COMPLETED', 'FIXED'].includes(getShiftStatusKey(dateStr, shift))) return;
    const rows = getProductionHistoricalRowsForShift(dateStr, shift);
    rows.forEach(row => {
      const cardId = String(row?.cardId || '').trim();
      const routeOpId = String(row?.routeOpId || '').trim();
      if (!cardId || !routeOpId) return;
      const card = (cards || []).find(item => String(item?.id || '') === cardId) || null;
      const op = (card?.operations || []).find(item => String(item?.id || '') === routeOpId) || null;
      if (isDryingOperation(op || row)) {
        if (getProductionPlanDryingFillState(card, op || row, row) !== 'done') {
          dryingHistoricalOpKeys.add(makeProductionPlanningOpKey(cardId, routeOpId));
        }
        return;
      }
      if (row?.isQtyDriven !== true) return;
      const unresolvedQty = getProductionPlanHistoricalRowUnresolvedQty(row);
      if (!(unresolvedQty > 0)) return;
      const opKey = makeProductionPlanningOpKey(cardId, routeOpId);
      rawHistoricalQtyByOpKey.set(opKey, roundPlanningQty((rawHistoricalQtyByOpKey.get(opKey) || 0) + unresolvedQty));
      const sourceKey = makeProductionPlanHistoricalSourceKey(row?.date, row?.shift, cardId, routeOpId);
      if (!sourceKey) return;
      const availablePlannedQty = Math.max(0, Number(sourcePlannedQtyByKey.get(sourceKey) || 0));
      if (!(availablePlannedQty > 0)) return;
      const matchedQty = Math.min(unresolvedQty, roundPlanningQty(availablePlannedQty));
      if (!(matchedQty > 0)) return;
      sourceMatchedQtyByOpKey.set(opKey, roundPlanningQty((sourceMatchedQtyByOpKey.get(opKey) || 0) + matchedQty));
      sourcePlannedQtyByKey.set(sourceKey, roundPlanningQty(Math.max(0, availablePlannedQty - matchedQty)));
    });
  });

  return {
    rawHistoricalQtyByOpKey,
    sourceMatchedQtyByOpKey,
    dryingHistoricalOpKeys
  };
}

function getProductionPlanQueueHistoricalMetrics(card, op, {
  snapshot = null,
  visualMetrics = null,
  historicalIndex = null
} = {}) {
  const empty = {
    rawHistoricalQty: 0,
    sourceMatchedQty: 0,
    fallbackMatchedQty: 0,
    unreplannedQty: 0,
    unreplannedMinutes: 0,
    fillPercent: 0,
    startPercent: 0,
    endPercent: 0
  };
  if (!card?.id || !op?.id) return empty;
  const planSnapshot = snapshot || getOperationPlanningSnapshot(card.id, op.id);
  const metrics = visualMetrics || getOperationPlanningVisualMetrics(card, op);
  if (!planSnapshot?.qtyDriven || !(Number(planSnapshot?.remainingQty || 0) > 0) || !(Number(metrics?.activeMinutes || 0) > 0)) {
    return {
      ...empty,
      startPercent: clampPlanningPercent(metrics?.planFillPercent || 0),
      endPercent: clampPlanningPercent(metrics?.planFillPercent || 0)
    };
  }
  const index = historicalIndex || buildProductionPlanQueueHistoricalIndex();
  const opKey = makeProductionPlanningOpKey(card.id, op.id);
  const rawHistoricalQty = Math.max(0, roundPlanningQty(index?.rawHistoricalQtyByOpKey?.get(opKey) || 0));
  const sourceMatchedQty = Math.min(
    rawHistoricalQty,
    Math.max(0, roundPlanningQty(index?.sourceMatchedQtyByOpKey?.get(opKey) || 0))
  );
  const currentCoveredQty = Math.max(0, roundPlanningQty(Number(planSnapshot?.coveredQty || 0)));
  const fallbackMatchedQty = Math.max(0, roundPlanningQty(currentCoveredQty - sourceMatchedQty));
  const unreplannedQty = Math.min(
    Math.max(0, roundPlanningQty(Number(planSnapshot?.remainingQty || 0))),
    Math.max(0, roundPlanningQty(rawHistoricalQty - sourceMatchedQty - fallbackMatchedQty))
  );
  const minutesPerUnit = Number(planSnapshot?.minutesPerUnit || metrics?.minutesPerUnit || 0);
  const unreplannedMinutes = unreplannedQty > 0 && minutesPerUnit > 0
    ? roundPlanningMinutes(minutesPerUnit * unreplannedQty)
    : 0;
  const startPercent = clampPlanningPercent(metrics?.planFillPercent || 0);
  const fillPercent = Number(metrics?.activeMinutes || 0) > 0
    ? clampPlanningPercent((unreplannedMinutes / Math.max(1, Number(metrics.activeMinutes) || 0)) * 100)
    : 0;
  const endPercent = clampPlanningPercent(startPercent + fillPercent);
  return {
    rawHistoricalQty,
    sourceMatchedQty,
    fallbackMatchedQty,
    unreplannedQty,
    unreplannedMinutes,
    fillPercent,
    startPercent,
    endPercent
  };
}

function findOperationByShiftTask(task) {
  if (!task?.cardId || !task?.routeOpId) return null;
  const card = (cards || []).find(item => String(item?.id || '') === String(task.cardId)) || null;
  return (card?.operations || []).find(item => String(item?.id || '') === String(task.routeOpId)) || null;
}

function isPlanningHiddenTask(task) {
  return isPlanningHiddenOperation(findOperationByShiftTask(task));
}

function getVisibleProductionShiftTasks() {
  return (productionShiftTasks || []).filter(task => !isPlanningHiddenTask(task));
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

function isAutoProductionShiftTask(task) {
  return String(task?.planningMode || '').toUpperCase() === 'AUTO';
}

function getProductionShiftTaskMergeKey(task, overrides = {}) {
  const cardId = String(overrides.cardId ?? task?.cardId ?? '');
  const routeOpId = String(overrides.routeOpId ?? task?.routeOpId ?? '');
  const date = String(overrides.date ?? task?.date ?? '');
  const shift = parseInt(overrides.shift ?? task?.shift, 10) || 1;
  const areaId = String(overrides.areaId ?? task?.areaId ?? '');
  const subcontractChainId = String(overrides.subcontractChainId ?? task?.subcontractChainId ?? '');
  const workSegmentKey = String(overrides.workSegmentKey ?? task?.workSegmentKey ?? '');
  const isPreview = (overrides.closePagePreview ?? task?.closePagePreview) === true;
  const previewRowKey = String(overrides.closePageRowKey ?? task?.closePageRowKey ?? '');
  return isPreview
    ? `${cardId}|${routeOpId}|${date}|${shift}|${areaId}|${subcontractChainId}|${workSegmentKey}|preview|${previewRowKey}`
    : `${cardId}|${routeOpId}|${date}|${shift}|${areaId}|${subcontractChainId}|${workSegmentKey}`;
}

function getProductionShiftTaskSortableRef(task) {
  return {
    createdAt: Number.isFinite(Number(task?.createdAt)) ? Number(task.createdAt) : Number.MAX_SAFE_INTEGER,
    id: String(task?.id || '')
  };
}

function isProductionShiftTaskRefEarlier(a, b) {
  const refA = getProductionShiftTaskSortableRef(a);
  const refB = getProductionShiftTaskSortableRef(b);
  if (refA.createdAt !== refB.createdAt) return refA.createdAt < refB.createdAt;
  return refA.id.localeCompare(refB.id) < 0;
}

function pickProductionShiftTaskPrimary(tasks, preferredTaskId = '') {
  const list = Array.isArray(tasks) ? tasks.filter(Boolean) : [];
  if (!list.length) return null;
  const preferred = preferredTaskId
    ? list.find(item => String(item?.id || '') === String(preferredTaskId))
    : null;
  if (preferred) return preferred;
  return list.slice().sort((a, b) => {
    const refA = getProductionShiftTaskSortableRef(a);
    const refB = getProductionShiftTaskSortableRef(b);
    if (refA.createdAt !== refB.createdAt) return refA.createdAt - refB.createdAt;
    return refA.id.localeCompare(refB.id);
  })[0];
}

function mergeProductionShiftTaskEntries(tasks, { preferredTaskId = '' } = {}) {
  const list = Array.isArray(tasks) ? tasks.filter(Boolean) : [];
  if (!list.length) return null;
  const primary = pickProductionShiftTaskPrimary(list, preferredTaskId) || list[0];
  const earliest = list.reduce((acc, item) => (
    !acc || isProductionShiftTaskRefEarlier(item, acc) ? item : acc
  ), null);
  const plannedPartMinutes = list.reduce((sum, item) => sum + getTaskPlannedMinutes(item), 0);
  const plannedPartQty = roundPlanningQty(list.reduce((sum, item) => {
    const value = Number(item?.plannedPartQty);
    return sum + (Number.isFinite(value) && value > 0 ? value : 0);
  }, 0));
  const plannedTotalMinutes = list.reduce((max, item) => {
    const value = Number(item?.plannedTotalMinutes);
    return Number.isFinite(value) && value > max ? value : max;
  }, 0);
  const plannedTotalQty = roundPlanningQty(list.reduce((max, item) => {
    const value = Number(item?.plannedTotalQty);
    return Number.isFinite(value) && value > max ? value : max;
  }, 0));
  const minutesPerUnitSnapshot = list.reduce((value, item) => {
    if (value > 0) return value;
    const candidate = Number(item?.minutesPerUnitSnapshot);
    return Number.isFinite(candidate) && candidate > 0 ? candidate : 0;
  }, 0);
  const remainingQtySnapshot = roundPlanningQty(list.reduce((max, item) => {
    const value = Number(item?.remainingQtySnapshot);
    return Number.isFinite(value) && value > max ? value : max;
  }, 0));
  const merged = {
    ...primary,
    id: String(primary?.id || ''),
    cardId: String(primary?.cardId || ''),
    routeOpId: String(primary?.routeOpId || ''),
    opId: String(primary?.opId || list.find(item => item?.opId)?.opId || ''),
    opName: String(primary?.opName || list.find(item => item?.opName)?.opName || ''),
    date: String(primary?.date || ''),
    shift: parseInt(primary?.shift, 10) || 1,
    areaId: String(primary?.areaId || ''),
    subcontractChainId: String(primary?.subcontractChainId || ''),
    subcontractItemIds: normalizeSubcontractItemIds(list.flatMap(item => normalizeSubcontractItemIds(item?.subcontractItemIds))),
    subcontractItemKind: String(primary?.subcontractItemKind || ''),
    subcontractExtendedChain: list.some(item => item?.subcontractExtendedChain === true),
    plannedPartMinutes: plannedPartMinutes > 0 ? plannedPartMinutes : undefined,
    plannedPartQty: plannedPartQty > 0 ? plannedPartQty : undefined,
    plannedTotalMinutes: plannedTotalMinutes > 0 ? plannedTotalMinutes : undefined,
    plannedTotalQty: plannedTotalQty > 0 ? plannedTotalQty : undefined,
    minutesPerUnitSnapshot: minutesPerUnitSnapshot > 0 ? minutesPerUnitSnapshot : undefined,
    remainingQtySnapshot: remainingQtySnapshot > 0 ? remainingQtySnapshot : undefined,
    planningMode: String(primary?.planningMode || 'MANUAL').toUpperCase() || 'MANUAL',
    autoPlanRunId: String(primary?.autoPlanRunId || ''),
    workSegmentKey: String(primary?.workSegmentKey || ''),
    plannedStartAt: Number.isFinite(Number(primary?.plannedStartAt)) ? Number(primary.plannedStartAt) : undefined,
    plannedEndAt: Number.isFinite(Number(primary?.plannedEndAt)) ? Number(primary.plannedEndAt) : undefined,
    sourceShiftDate: String(primary?.sourceShiftDate || ''),
    sourceShift: Number.isFinite(Number(primary?.sourceShift)) ? (parseInt(primary.sourceShift, 10) || 1) : undefined,
    fromShiftCloseTransfer: list.some(item => item?.fromShiftCloseTransfer === true),
    shiftCloseSourceDate: String(primary?.shiftCloseSourceDate || ''),
    shiftCloseSourceShift: Number.isFinite(Number(primary?.shiftCloseSourceShift))
      ? (parseInt(primary.shiftCloseSourceShift, 10) || 1)
      : undefined,
    closePagePreview: primary?.closePagePreview === true,
    closePageRecordId: String(primary?.closePageRecordId || ''),
    closePageRowKey: String(primary?.closePageRowKey || ''),
    delayMinutes: Number.isFinite(Number(primary?.delayMinutes)) ? Math.max(0, parseInt(primary.delayMinutes, 10) || 0) : undefined,
    effectiveDeadlineSnapshot: String(primary?.effectiveDeadlineSnapshot || ''),
    cardPlannedCompletionDateSnapshot: String(primary?.cardPlannedCompletionDateSnapshot || ''),
    isPartial: plannedTotalMinutes > 0 ? plannedPartMinutes < plannedTotalMinutes : false,
    createdAt: Number.isFinite(Number(earliest?.createdAt)) ? Number(earliest.createdAt) : (Number(primary?.createdAt) || Date.now()),
    createdBy: String(earliest?.createdBy || primary?.createdBy || '')
  };
  return merged;
}

function mergeProductionShiftTasksByKey(taskOrKey, { preferredTaskId = '' } = {}) {
  const key = typeof taskOrKey === 'string'
    ? taskOrKey
    : getProductionShiftTaskMergeKey(taskOrKey);
  const current = Array.isArray(productionShiftTasks) ? productionShiftTasks : [];
  const matching = current.filter(item => getProductionShiftTaskMergeKey(item) === key);
  if (!matching.length) return { task: null, merged: false, mergedCount: 0 };
  const mergedTask = mergeProductionShiftTaskEntries(matching, { preferredTaskId }) || matching[0];
  const matchingIds = new Set(matching.map(item => String(item?.id || '')));
  const next = [];
  let inserted = false;
  current.forEach(item => {
    if (!matchingIds.has(String(item?.id || ''))) {
      next.push(item);
      return;
    }
    if (!inserted) {
      next.push(mergedTask);
      inserted = true;
    }
  });
  if (!inserted) next.push(mergedTask);
  productionShiftTasks = next;
  return {
    task: mergedTask,
    merged: matching.length > 1,
    mergedCount: matching.length
  };
}

function planningPerfLog(label, startedAt, extra = '') {
  const duration = Math.max(0, Math.round(performance.now() - startedAt));
  console.info(`[PERF][PLAN] ${label}: ${duration}ms${extra ? ` ${extra}` : ''}`);
}

function getPlanningApiRequest() {
  return typeof apiFetch === 'function' ? apiFetch : fetch;
}

async function commitProductionPlanningChange(payload, options = {}) {
  if (!ensureProductionEditAccess('production-plan', 'Недостаточно прав для изменения плана производства')) {
    throw new Error('Недостаточно прав для изменения плана производства');
  }
  const runCommit = async () => {
    const startedAt = performance.now();
    const actionLabel = String(payload?.action || 'commit');
    console.info(`[PLAN] commit start: action=${actionLabel}`);
    const request = getPlanningApiRequest();
    const requestPayload = withProductionPlanningExpectedRev(payload, 'plan');
    const res = await request('/api/production/plan/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload || {}),
      signal: options?.signal
    });
    planningPerfLog('commit.response', startedAt, `status=${res.status}`);
    const data = await res.json().catch(() => ({}));
    updateProductionPlanningRevisionFromPayload(data, 'plan');
    if (!res.ok) {
      const error = new Error(data?.error || `HTTP ${res.status}`);
      error.blockedAreaNames = Array.isArray(data?.blockedAreaNames) ? data.blockedAreaNames.slice() : [];
      console.info(`[PLAN] commit error: action=${actionLabel} status=${res.status}`);
      throw error;
    }
    console.info(`[PLAN] commit success: action=${actionLabel} status=${res.status}`);
    return data || {};
  };
  const chained = productionPlanningCommitQueue
    .catch(() => {})
    .then(runCommit);
  productionPlanningCommitQueue = chained.catch(() => {});
  return chained;
}

function replacePlanningCardState(card) {
  if (!card?.id) return;
  const idx = (cards || []).findIndex(item => String(item?.id || '') === String(card.id));
  if (idx >= 0) {
    cards[idx] = card;
    return;
  }
  cards.push(card);
}

function replacePlanningTasksForCard(cardId, tasksForCard) {
  const cid = String(cardId || '');
  const nextTasks = Array.isArray(tasksForCard) ? tasksForCard : [];
  const others = (productionShiftTasks || []).filter(task => String(task?.cardId || '') !== cid);
  productionShiftTasks = others.concat(nextTasks);
}

function applyProductionPlanningServerState(payload) {
  updateProductionPlanningRevisionFromPayload(payload, 'plan');
  if (payload?.card) {
    replacePlanningCardState(payload.card);
  }
  if (payload?.cardId) {
    replacePlanningTasksForCard(payload.cardId, payload.tasksForCard || []);
  }
  onProductionShiftTasksChanged();
}

function shouldCardAppearInPlanningQueue(card) {
  if (!card || card.archived || card.cardType !== 'MKI') return false;
  if (getPlannableOpsCountForCard(card) <= 0) return false;
  if (productionShiftsState.showPlannedQueue) {
    return card.approvalStage === APPROVAL_STAGE_PLANNED;
  }
  return card.approvalStage === APPROVAL_STAGE_PROVIDED || card.approvalStage === APPROVAL_STAGE_PLANNING;
}

function getProductionQueueCardMetrics(card, { historicalIndex = null } = {}) {
  const ops = getPlannableShiftOperations(card?.operations || []);
  const totalOpsCount = ops.length;
  const plannedOpsCount = card?.id ? getPlannedOpsCountForCard(card.id) : 0;
  const doneOpsCount = ops.filter(op => String(op?.status || '').toUpperCase() === 'DONE').length;
  const opIdSet = new Set(ops.map(op => String(op?.id || '')).filter(Boolean));
  const actualDateIso = plannedOpsCount === totalOpsCount && totalOpsCount > 0
    ? (productionShiftTasks || []).reduce((maxDate, task) => {
      if (!task) return maxDate;
      if (String(task?.cardId || '') !== String(card?.id || '')) return maxDate;
      if (!opIdSet.has(String(task?.routeOpId || ''))) return maxDate;
      const taskDate = String(task?.date || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(taskDate)) return maxDate;
      return !maxDate || taskDate > maxDate ? taskDate : maxDate;
    }, '')
    : '';
  const planDateIso = String(card?.plannedCompletionDate || '');
  const todayIso = getCurrentDateString();
  let plannedDateClass = '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(planDateIso)) {
    const daysLeft = Math.floor((new Date(`${planDateIso}T00:00:00`).getTime() - new Date(`${todayIso}T00:00:00`).getTime()) / 86400000);
    if (daysLeft <= 0) plannedDateClass = 'is-danger';
    else if (daysLeft < 3) plannedDateClass = 'is-warning';
  }

  let totalPlanMinutes = 0;
  let plannedCoveredMinutes = 0;
  let goodCoveredMinutes = 0;
  let delayedCoveredMinutes = 0;
  let defectCoveredMinutes = 0;
  let historicalUnreplannedMinutes = 0;
  ops.forEach(op => {
    const opPlannedMinutes = Number(op?.plannedMinutes);
    if (!Number.isFinite(opPlannedMinutes) || opPlannedMinutes <= 0) return;
    const snapshot = card?.id ? getOperationPlanningSnapshot(card.id, op.id) : null;
    const metrics = card?.id ? getOperationPlanningVisualMetrics(card, op) : null;
    if (isDryingOperation(op)) {
      const dryingState = getProductionPlanDryingQueueState(card, op, { historicalIndex });
      const scopeMinutes = Math.max(0, Number(snapshot?.baseMinutes || opPlannedMinutes || metrics?.activeMinutes || 0));
      totalPlanMinutes += scopeMinutes;
      if (dryingState === 'planned') {
        plannedCoveredMinutes += scopeMinutes;
      } else if (dryingState === 'replan') {
        historicalUnreplannedMinutes += scopeMinutes;
      } else if (dryingState === 'done') {
        goodCoveredMinutes += scopeMinutes;
      }
      return;
    }
    const actualScopeMinutes = Math.max(0, Number(metrics?.activeMinutes || 0));
    const plannedMinutes = Math.max(0, Number(metrics?.plannedMinutes || 0));
    totalPlanMinutes += actualScopeMinutes;
    plannedCoveredMinutes += Math.min(actualScopeMinutes, plannedMinutes);
    goodCoveredMinutes += Math.max(0, Number(metrics?.goodMinutes || 0));
    delayedCoveredMinutes += Math.max(0, Number(metrics?.delayedMinutes || 0));
    defectCoveredMinutes += Math.max(0, Number(metrics?.defectMinutes || 0));
    const historicalMetrics = card?.id
      ? getProductionPlanQueueHistoricalMetrics(card, op, {
        snapshot,
        visualMetrics: metrics,
        historicalIndex
      })
      : null;
    historicalUnreplannedMinutes += Math.max(0, Number(historicalMetrics?.unreplannedMinutes || 0));
  });

  const plannedFillPercent = totalPlanMinutes > 0
    ? Math.min(100, Math.max(0, Math.floor((plannedCoveredMinutes / totalPlanMinutes) * 100)))
    : 100;
  const historicalFillPercent = totalPlanMinutes > 0
    ? clampPlanningPercent((historicalUnreplannedMinutes / totalPlanMinutes) * 100)
    : 0;
  const segments = getPlanningFillSegments(totalPlanMinutes, {
    goodMinutes: goodCoveredMinutes,
    delayedMinutes: delayedCoveredMinutes,
    defectMinutes: defectCoveredMinutes
  });
  ensureProductionFlow(card);
  const finalStatusGroupsMap = new Map();
  const ensureFinalStatusGroup = (key, label) => {
    if (!finalStatusGroupsMap.has(key)) {
      finalStatusGroupsMap.set(key, {
        label,
        isSamples: key !== 'ITEM',
        total: 0,
        good: 0,
        delayed: 0,
        defect: 0
      });
    }
    return finalStatusGroupsMap.get(key);
  };
  const registerFinalStatusItem = (item, key, label) => {
    if (!item) return;
    const group = ensureFinalStatusGroup(key, label);
    group.total += 1;
    const finalStatus = trimToString(item?.finalStatus || '').toUpperCase();
    if (finalStatus === 'GOOD') group.good += 1;
    else if (finalStatus === 'DELAYED') group.delayed += 1;
    else if (finalStatus === 'DEFECT') group.defect += 1;
  };
  (Array.isArray(card?.flow?.items) ? card.flow.items : []).forEach(item => {
    if (isFlowItemDisposed(item)) return;
    registerFinalStatusItem(item, 'ITEM', 'Изд.');
  });
  (Array.isArray(card?.flow?.samples) ? card.flow.samples : []).forEach(item => {
    if (isFlowItemDisposed(item)) return;
    const sampleType = normalizeSampleType(item?.sampleType);
    registerFinalStatusItem(item, sampleType, sampleType === 'WITNESS' ? 'ОС.' : 'ОК.');
  });
  const finalStatusGroups = ['ITEM', 'WITNESS', 'CONTROL']
    .map(key => finalStatusGroupsMap.get(key))
    .filter(group => group && group.total > 0);

  return {
    totalOpsCount,
    plannedOpsCount,
    doneOpsCount,
    actualDateIso,
    actualDateLabel: actualDateIso ? formatProductionDisplayDate(actualDateIso) : '-',
    plannedDateIso: /^\d{4}-\d{2}-\d{2}$/.test(planDateIso) ? planDateIso : '',
    plannedDateLabel: /^\d{4}-\d{2}-\d{2}$/.test(planDateIso) ? formatProductionDisplayDate(planDateIso) : '-',
    plannedDateClass,
    plannedFillPercent,
    historicalFillPercent,
    goodFillPercent: segments.goodPercent,
    delayedFillPercent: segments.delayedPercent,
    defectFillPercent: segments.defectPercent,
    segments,
    historicalUnreplannedMinutes,
    finalStatusGroups
  };
}

function getProductionQueueCardStyle(metrics) {
  return getPlanningFillStyleWithHistory(metrics.plannedFillPercent, metrics.segments, {
    prefix: 'card',
    historyFillPercent: metrics.historicalFillPercent
  });
}

function getProductionQueueCardExecutionStyle(metrics) {
  return getPlanningExecutionOnlyStyleVars(metrics?.segments, { prefix: 'card' });
}

function buildProductionQueueCardButtonHtml(card, metrics = getProductionQueueCardMetrics(card)) {
  const planDateClass = metrics.plannedDateClass ? ` ${metrics.plannedDateClass}` : '';
  const renderFinalStatusGroup = (group) => `
    <span class="production-shifts-card-final-group">
      <span class="production-shifts-card-final-label${group.isSamples ? ' production-op-summary-label op-items-kind-samples' : ''}">${escapeHtml(group.label)}</span>
      <span class="op-item-status-good">${escapeHtml(String(group.good || 0))}</span>
      <span class="production-shifts-card-final-sep">/</span>
      <span class="op-item-status-delayed">${escapeHtml(String(group.delayed || 0))}</span>
      <span class="production-shifts-card-final-sep">/</span>
      <span class="op-item-status-defect">${escapeHtml(String(group.defect || 0))}</span>
    </span>
  `;
  const finalStatusHtml = Array.isArray(metrics.finalStatusGroups) && metrics.finalStatusGroups.length
    ? (() => {
      const itemGroup = metrics.finalStatusGroups.find(group => group && !group.isSamples) || null;
      const sampleGroups = metrics.finalStatusGroups.filter(group => group && group.isSamples);
      const rows = [];
      if (itemGroup) {
        rows.push(`<div class="production-shifts-card-stat production-shifts-card-stat-final">${renderFinalStatusGroup(itemGroup)}</div>`);
      }
      if (sampleGroups.length) {
        rows.push(`<div class="production-shifts-card-stat production-shifts-card-stat-final">${sampleGroups.map(renderFinalStatusGroup).join('')}</div>`);
      }
      return rows.join('');
    })()
    : '';
  return `
    <div class="production-shifts-card-title">${escapeHtml(getPlanningCardLabel(card))}</div>
    <div class="production-shifts-card-stats">
      <div class="production-shifts-card-stat production-shifts-card-stat-planned">Запланировано Оп.: ${metrics.plannedOpsCount}/${metrics.totalOpsCount}</div>
      <div class="production-shifts-card-stat production-shifts-card-stat-done">Выполнено Оп.: ${metrics.doneOpsCount}/${metrics.totalOpsCount}</div>
      <div class="production-shifts-card-stat production-shifts-card-stat-fact-date">Факт. дата: ${escapeHtml(metrics.actualDateLabel)}</div>
      <div class="production-shifts-card-stat production-shifts-card-stat-plan-date${planDateClass}">План. дата: ${escapeHtml(metrics.plannedDateLabel)}</div>
      ${finalStatusHtml}
    </div>
  `;
}

function updatePlanningQueueCardButton(cardId) {
  const button = document.querySelector(`.production-shifts-card-btn[data-card-id="${CSS.escape(String(cardId || ''))}"]`);
  if (!button) return false;
  const card = (cards || []).find(item => String(item?.id || '') === String(cardId || '')) || null;
  if (!card) return false;
  button.classList.toggle('active', card.id === productionShiftsState.selectedCardId);
  const metrics = getProductionQueueCardMetrics(card, { historicalIndex: buildProductionPlanQueueHistoricalIndex() });
  button.setAttribute('style', getProductionQueueCardStyle(metrics));
  button.innerHTML = buildProductionQueueCardButtonHtml(card, metrics);
  return true;
}

function buildProductionPlanCellInnerHtml(dateStr, shift, areaId) {
  const area = (areas || []).find(item => String(item?.id || '') === String(areaId || '')) || null;
  if (!area) return '';
  const employees = getProductionShiftEmployees(dateStr, area.id, shift);
  const tasks = getProductionShiftTasksForCell(dateStr, shift, area.id);
  const isPlanRoute = window.location.pathname === '/production/plan';
  const focusCardId = productionShiftsState.selectedCardId || null;
  const navigationTarget = productionShiftsState.navigationTarget || null;
  const shiftTotalMinutes = getShiftDurationMinutesForArea(shift, area.id);
  const plannedSumMinutes = getShiftPlannedMinutes(dateStr, shift, area.id);
  const loadPct = Math.min(999, Math.max(0, Math.round((plannedSumMinutes / shiftTotalMinutes) * 100)));
  const loadPctHtml = `<div class="production-shifts-load" title="Загрузка: ${plannedSumMinutes} / ${shiftTotalMinutes} мин">${loadPct}%</div>`;
  const overloadMinutes = Math.max(0, plannedSumMinutes - shiftTotalMinutes);
  const overloadHtml = overloadMinutes > 0
    ? `<div class="production-shift-meta production-shift-meta-empty">Перегрузка: +${overloadMinutes} мин</div>`
    : '';
  const peopleMetaHtml = renderProductionPlanPeopleMeta(employees);
  const selectedCard = (cards || []).find(card => card.id === (productionShiftsState.selectedCardId || '')) || null;
  const canEditPlan = !isProductionRouteReadonly('production-plan');
  const canPlan = window.location.pathname === '/production/plan'
    && canEditPlan
    && selectedCard
    && (selectedCard.approvalStage === APPROVAL_STAGE_PROVIDED || selectedCard.approvalStage === APPROVAL_STAGE_PLANNING)
    && canPlanShiftOperations(dateStr, shift);
  const hideOpStatus = window.location.pathname === '/production/plan'
    && ['COMPLETED', 'FIXED'].includes(getShiftStatusKey(dateStr, shift));
  const tasksHtml = tasks.length
    ? tasks.map(task => {
      const card = cards.find(c => c.id === task.cardId);
      const label = card ? getPlanningCardLabel(card) : 'МК';
      const isNavigationFocus = isProductionNavigationTargetTask(task, dateStr, shift, area.id);
      const isFocusTask = navigationTarget
        ? isNavigationFocus
        : (focusCardId && task.cardId === focusCardId);
      const focusClass = isFocusTask ? ` ${isNavigationFocus ? 'focus-nav' : 'focus'}` : '';
      const subcontractMeta = getSubcontractChainMeta(task);
      const partMinutes = getTaskPlannedMinutes(task);
      const op = (card?.operations || []).find(item => item.id === task.routeOpId) || null;
      const qtyLabel = getTaskPlannedQuantityLabel(task, op);
      const partLabel = qtyLabel ? `${qtyLabel} / ${partMinutes} мин` : `${partMinutes} мин`;
      const removeBtn = canEditPlan && canRemoveProductionShiftTask(task, op)
        ? `<button type="button" class="btn-icon production-shift-remove" data-task-id="${task.id}" title="Снять план">✕</button>`
        : '';
      const canDrag = canEditPlan && canDragProductionShiftTask(task, op);
      const transferClass = isPlanRoute && task?.fromShiftCloseTransfer === true ? ' is-shift-close-transfer' : '';
      const subcontractClass = subcontractMeta.isSubcontract
        ? ` is-subcontract-chain${subcontractMeta.isFirst ? ' is-subcontract-first' : ''}${subcontractMeta.isLast ? ' is-subcontract-last' : ''}${subcontractMeta.isSingle ? ' is-subcontract-single' : ''}${subcontractMeta.isMiddle ? ' is-subcontract-middle' : ''}`
        : '';
      const metaHtml = buildProductionPlanOpMeta(card, op || task, {
        plannedLabel: `План: ${partLabel}`,
        hideStatus: hideOpStatus,
        shiftDate: task.date,
        shiftNumber: task.shift
      });
      const cardLineHtml = buildProductionPlanCardLine(label);
      return `
            <div class="production-shift-task${focusClass}${transferClass}${subcontractClass}${canDrag ? ' is-draggable' : ''}" data-task-id="${task.id}" data-task-card-id="${task.cardId}" data-task-route-op-id="${task.routeOpId}"${canDrag ? ' draggable="true"' : ''}>
              <div class="production-shift-task-info">
                <div class="production-shift-task-name">${buildProductionPlanOpTitle(op || task)}</div>
                ${(subcontractMeta.isMiddle ? '' : cardLineHtml)}
                ${(subcontractMeta.isMiddle ? '' : metaHtml)}
              </div>
              ${subcontractMeta.isMiddle ? '' : removeBtn}
            </div>
          `;
    }).join('')
    : '<div class="muted production-shift-empty">Нет операций</div>';
  return `
          ${loadPctHtml}
          ${overloadHtml}
          ${peopleMetaHtml}
          <div class="production-shift-ops">${tasksHtml}</div>
          ${canPlan ? `<button type="button" class="btn-secondary btn-small production-shift-plan-btn" data-area-id="${area.id}" data-date="${dateStr}" data-shift="${shift}">Запланировать</button>` : ''}
        `;
}

function bindProductionShiftsInteractions(section = document.getElementById('production-shifts')) {
  if (!section) return;
  section.querySelectorAll('.production-shift-task').forEach(el => {
    if (el.dataset.bound === 'true') return;
    el.dataset.bound = 'true';
    el.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const cardId = el.getAttribute('data-task-card-id');
      if (!cardId) return;
      productionShiftsState.selectedCardId = cardId;
      showProductionShiftsTaskMenu(event.pageX, event.pageY, cardId);
    });
    el.addEventListener('dragstart', (event) => {
      const taskId = el.getAttribute('data-task-id');
      if (!taskId) return;
      productionShiftDragTaskId = taskId;
      el.classList.add('is-dragging');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', taskId);
      }
    });
    el.addEventListener('dragend', () => {
      productionShiftDragTaskId = null;
      el.classList.remove('is-dragging');
      section.querySelectorAll('.production-shifts-cell.is-drop-target').forEach(cell => {
        cell.classList.remove('is-drop-target');
      });
    });
  });

  section.querySelectorAll('.production-shift-plan-btn').forEach(btn => {
    if (btn.dataset.bound === 'true') return;
    btn.dataset.bound = 'true';
    btn.addEventListener('click', () => {
      const date = btn.getAttribute('data-date');
      const areaId = btn.getAttribute('data-area-id');
      const shiftValue = parseInt(btn.getAttribute('data-shift'), 10) || (productionShiftsState.selectedShift || 1);
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
    if (btn.dataset.bound === 'true') return;
    btn.dataset.bound = 'true';
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const taskId = btn.getAttribute('data-task-id');
      if (taskId) removeProductionShiftTask(taskId);
    });
  });
}

function refreshProductionPlanUiAfterMutation({ cardId = '', affectedCells = [] } = {}) {
  const capturePlanScrollState = () => {
    const tableWrapper = document.querySelector('.production-shifts-table-wrapper');
    return {
      windowX: window.scrollX || 0,
      windowY: window.scrollY || 0,
      tableScrollLeft: tableWrapper ? tableWrapper.scrollLeft : 0,
      tableScrollTop: tableWrapper ? tableWrapper.scrollTop : 0
    };
  };
  const restorePlanScrollState = (state) => {
    if (!state) return;
    requestAnimationFrame(() => {
      const tableWrapper = document.querySelector('.production-shifts-table-wrapper');
      if (tableWrapper) {
        tableWrapper.scrollLeft = Number(state.tableScrollLeft) || 0;
        tableWrapper.scrollTop = Number(state.tableScrollTop) || 0;
      }
      window.scrollTo(Number(state.windowX) || 0, Number(state.windowY) || 0);
    });
  };
  const currentPath = window.location.pathname || '';
  if (currentPath === '/production/shifts') {
    renderProductionShiftBoardPage();
    return;
  }
  if (currentPath !== '/production/plan') return;
  const preservedScrollState = productionShiftPlanContext?.openScrollState || capturePlanScrollState();
  const card = (cards || []).find(item => String(item?.id || '') === String(cardId || '')) || null;
  const queueBtnExists = Boolean(document.querySelector(`.production-shifts-card-btn[data-card-id="${CSS.escape(String(cardId || ''))}"]`));
  const shouldAppearInQueue = shouldCardAppearInPlanningQueue(card);
  const selectedCardVisible = productionShiftsState.viewMode === 'card';
  if (selectedCardVisible || queueBtnExists !== shouldAppearInQueue) {
    renderProductionShiftsPage();
    restorePlanScrollState(preservedScrollState);
  } else {
    updatePlanningQueueCardButton(cardId);
    affectedCells
      .filter(cell => cell && cell.date && cell.areaId)
      .forEach(cell => {
        const cellEl = getProductionShiftCellElement(cell.date, cell.shift, cell.areaId);
        if (!cellEl) return;
        const cellTasks = getProductionShiftTasksForCell(cell.date, cell.shift, cell.areaId);
        cellEl.classList.toggle('has-shift-close-transfer', cellTasks.some(task => task?.fromShiftCloseTransfer === true));
        cellEl.innerHTML = buildProductionPlanCellInnerHtml(cell.date, cell.shift, cell.areaId);
      });
    bindProductionShiftsInteractions();
    restorePlanScrollState(preservedScrollState);
  }
  if (productionShiftPlanContext && String(productionShiftPlanContext.cardId || '') === String(cardId || '')) {
    refreshProductionShiftPlanModal();
    restorePlanScrollState(preservedScrollState);
  }
}

async function commitProductionAutoPlan(payload) {
  if (!ensureProductionEditAccess('production-plan', 'Недостаточно прав для автопланирования')) {
    throw new Error('Недостаточно прав для автопланирования');
  }
  const startedAt = performance.now();
  console.info(`[AUTO_PLAN] request start: dryRun=${payload?.dryRun === true ? 'true' : 'false'}`);
  const request = getPlanningApiRequest();
  const requestPayload = withProductionPlanningExpectedRev(payload, 'plan');
  const res = await request('/api/production/plan/auto', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestPayload || {})
  });
  planningPerfLog('autoPlan.response', startedAt, `status=${res.status}`);
  const data = await res.json().catch(() => ({}));
  updateProductionPlanningRevisionFromPayload(data, 'plan');
  if (!res.ok) {
    const error = new Error(data?.error || `HTTP ${res.status}`);
    error.blockedAreaNames = Array.isArray(data?.blockedAreaNames) ? data.blockedAreaNames.slice() : [];
    throw error;
  }
  return data || {};
}

function closeProductionAutoPlanModal() {
  const modal = document.getElementById('production-auto-plan-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.dataset.cardId = '';
  productionAutoPlanContext = null;
  productionAutoPlanLastPreview = null;
  productionAutoPlanResultHistory = [];
}

function buildProductionAutoPlanAreaOptions(selectedAreaId = '') {
  const { areasList } = getProductionAreasWithOrder();
  return areasList.map(area => (
    `<option value="${escapeHtml(String(area.id || ''))}"${String(area.id || '') === String(selectedAreaId || '') ? ' selected' : ''}>${escapeHtml(area.name || area.title || area.id || 'Участок')}</option>`
  )).join('');
}

function buildProductionAutoPlanShiftOptions(selectedShift = 1) {
  return getProductionShiftNumbers().map(shift => (
    `<option value="${shift}"${shift === (parseInt(selectedShift, 10) || 1) ? ' selected' : ''}>${shift} смена</option>`
  )).join('');
}

function syncProductionAutoPlanDateInputs(textInput, nativeInput, isoValue) {
  if (textInput) textInput.value = formatProductionDisplayDate(isoValue);
  if (nativeInput) nativeInput.value = isoValue || '';
}

function getProductionAutoPlanFormState(modal = document.getElementById('production-auto-plan-modal')) {
  if (!modal || !productionAutoPlanContext?.card) return null;
  const card = productionAutoPlanContext.card;
  const startDate = parseProductionDisplayDate(modal.querySelector('#production-auto-plan-start-date')?.value || '');
  const startShift = parseInt(modal.querySelector('#production-auto-plan-start-shift')?.value, 10) || 1;
  const activeShiftButtons = Array.from(modal.querySelectorAll('.production-auto-plan-shift-btn.is-active, .production-auto-plan-shift-btn.active'));
  const activeShifts = activeShiftButtons
    .map(btn => parseInt(btn.getAttribute('data-shift'), 10) || 0)
    .filter(Boolean);
  const deadlineMode = modal.querySelector('#production-auto-plan-deadline-mode')?.value === 'CUSTOM_DEADLINE'
    ? 'CUSTOM_DEADLINE'
    : 'CARD_PLANNED_COMPLETION';
  const cardDeadline = String(card?.plannedCompletionDate || '');
  const customDeadline = parseProductionDisplayDate(modal.querySelector('#production-auto-plan-target-end-date')?.value || '');
  const effectiveDeadline = deadlineMode === 'CUSTOM_DEADLINE' ? customDeadline : cardDeadline;
  return {
    cardId: String(card.id || ''),
    startDate,
    startShift,
    activeShifts: activeShifts.length ? activeShifts : [1],
    deadlineMode,
    cardDeadline,
    customDeadline,
    effectiveDeadline,
    maxLoadPercent: Math.max(1, Math.min(100, parseInt(modal.querySelector('#production-auto-plan-max-load-percent')?.value, 10) || 100)),
    areaMode: modal.querySelector('#production-auto-plan-area-mode')?.value === 'SELECTED_AREA_ONLY'
      ? 'SELECTED_AREA_ONLY'
      : 'AUTO_ALLOWED_AREAS',
    areaId: String(modal.querySelector('#production-auto-plan-area-id')?.value || ''),
    delayMinutes: Math.max(0, parseInt(modal.querySelector('#production-auto-plan-delay-minutes')?.value, 10) || 0),
    minOperationMinutes: Math.max(1, parseInt(modal.querySelector('#production-auto-plan-min-operation-minutes')?.value, 10) || 1),
    minItems: Math.max(1, parseInt(modal.querySelector('#production-auto-plan-min-items')?.value, 10) || 1),
    minWitness: Math.max(1, parseInt(modal.querySelector('#production-auto-plan-min-witness')?.value, 10) || 1),
    minControl: Math.max(1, parseInt(modal.querySelector('#production-auto-plan-min-control')?.value, 10) || 1),
    transferItems: Math.max(1, parseInt(modal.querySelector('#production-auto-plan-transfer-items')?.value, 10) || 1),
    transferWitness: Math.max(1, parseInt(modal.querySelector('#production-auto-plan-transfer-witness')?.value, 10) || 1),
    transferControl: Math.max(1, parseInt(modal.querySelector('#production-auto-plan-transfer-control')?.value, 10) || 1),
    allowLastPartialBatch: modal.querySelector('#production-auto-plan-allow-last-partial-batch')?.checked === true
  };
}

function persistProductionAutoPlanFormState(state) {
  if (!state) return;
  saveProductionAutoPlanSettings({
    activeShifts: state.activeShifts,
    deadlineMode: state.deadlineMode,
    customDeadline: state.customDeadline,
    maxLoadPercent: state.maxLoadPercent,
    areaMode: state.areaMode,
    areaId: state.areaId,
    delayMinutes: state.delayMinutes,
    minOperationMinutes: state.minOperationMinutes,
    minItems: state.minItems,
    minWitness: state.minWitness,
    minControl: state.minControl,
    transferItems: state.transferItems,
    transferWitness: state.transferWitness,
    transferControl: state.transferControl,
    allowLastPartialBatch: state.allowLastPartialBatch
  });
}

function validateProductionAutoPlanFormState(state) {
  if (!state) return 'Не удалось собрать настройки автоплана';
  if (!state.startDate) return 'Укажите корректную дату начала';
  if (!state.activeShifts.length) return 'Выберите хотя бы одну смену планирования';
  if (!state.effectiveDeadline) return 'Укажите корректный дедлайн автоплана';
  if (state.effectiveDeadline < state.startDate) return 'Дедлайн не может быть раньше даты старта';
  if (state.areaMode === 'SELECTED_AREA_ONLY' && !state.areaId) return 'Выберите участок для режима «Только выбранный участок»';
  return '';
}

function updateProductionAutoPlanFormUi() {
  const modal = document.getElementById('production-auto-plan-modal');
  if (!modal || !productionAutoPlanContext?.card) return;
  const state = getProductionAutoPlanFormState(modal);
  const startDatePicker = modal.querySelector('#production-auto-plan-start-date-picker');
  const targetEndInput = modal.querySelector('#production-auto-plan-target-end-date');
  const targetEndNative = modal.querySelector('#production-auto-plan-target-end-date-native');
  const targetEndPicker = modal.querySelector('#production-auto-plan-target-end-date-picker');
  const cardDeadlineInput = modal.querySelector('#production-auto-plan-card-deadline');
  const effectiveInput = modal.querySelector('#production-auto-plan-effective-deadline');
  const warningEl = modal.querySelector('#production-auto-plan-deadline-warning');
  const areaSelect = modal.querySelector('#production-auto-plan-area-id');
  const saveBtn = modal.querySelector('#production-auto-plan-save');
  if (cardDeadlineInput) cardDeadlineInput.value = formatProductionDisplayDate(productionAutoPlanContext.card?.plannedCompletionDate || '');
  if (effectiveInput) effectiveInput.value = formatProductionDisplayDate(state?.effectiveDeadline || '');
  const customDeadlineMode = state?.deadlineMode === 'CUSTOM_DEADLINE';
  if (startDatePicker) startDatePicker.disabled = false;
  if (targetEndInput) targetEndInput.disabled = !customDeadlineMode;
  if (targetEndNative) targetEndNative.disabled = !customDeadlineMode;
  if (targetEndPicker) targetEndPicker.disabled = !customDeadlineMode;
  if (areaSelect) areaSelect.disabled = state?.areaMode !== 'SELECTED_AREA_ONLY';
  if (warningEl) {
    const cardDeadline = String(productionAutoPlanContext.card?.plannedCompletionDate || '');
    const effectiveDeadline = String(state?.effectiveDeadline || '');
    if (customDeadlineMode && cardDeadline && effectiveDeadline && effectiveDeadline > cardDeadline) {
      warningEl.textContent = `Дедлайн автоплана (${formatProductionDisplayDate(effectiveDeadline)}) позже планируемой даты завершения МК (${formatProductionDisplayDate(cardDeadline)}).`;
      warningEl.classList.remove('hidden');
    } else {
      warningEl.textContent = '';
      warningEl.classList.add('hidden');
    }
  }
  if (saveBtn && !productionAutoPlanLastPreview?.hasSuccessfulOperations) {
    saveBtn.classList.add('hidden');
  }
}

function normalizeProductionAutoPlanNumberInput(target) {
  if (!(target instanceof HTMLInputElement)) return;
  if (target.type !== 'number') return;
  const rawValue = String(target.value || '').trim();
  if (!rawValue) return;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return;
  const minAttr = target.getAttribute('min');
  const maxAttr = target.getAttribute('max');
  const min = minAttr != null && minAttr !== '' ? Number(minAttr) : null;
  const max = maxAttr != null && maxAttr !== '' ? Number(maxAttr) : null;
  let normalized = Math.trunc(parsed);
  if (Number.isFinite(min)) normalized = Math.max(min, normalized);
  if (Number.isFinite(max)) normalized = Math.min(max, normalized);
  target.value = String(normalized);
}

function renderProductionAutoPlanResultHistory() {
  const resultEl = document.getElementById('production-auto-plan-result');
  if (!resultEl) return;
  if (!productionAutoPlanResultHistory.length) {
    resultEl.innerHTML = '<div class="muted">Результат появится после запуска автопланирования.</div>';
    return;
  }
  resultEl.innerHTML = productionAutoPlanResultHistory.map(entry => `
    <div class="production-auto-plan-result-entry ${entry.className || ''}">
      ${entry.html || ''}
    </div>
  `).join('');
  [].forEach.call([], row => {
    const shift = parseInt(row.querySelector('input[data-shift]')?.getAttribute('data-shift'), 10) || 1;
    const item = list.find(entry => (parseInt(entry?.shift, 10) || 1) === shift) || normalizeProductionShiftTimeEntry({ shift }, shift);
    row.insertAdjacentHTML('beforeend', `
      <label>Обед с <input type="time" data-shift="${shift}" data-type="lunch-from" value="${escapeHtml(item.lunchFrom || '')}" /></label>
      <label>Обед по <input type="time" data-shift="${shift}" data-type="lunch-to" value="${escapeHtml(item.lunchTo || '')}" /></label>
    `);
  });
}

function pushProductionAutoPlanResultMessage(message, { kind = 'error', title = '' } = {}) {
  const safeMessage = escapeHtml(String(message || '').trim() || 'Неизвестный результат автопланирования');
  const safeTitle = escapeHtml(String(title || '').trim() || (kind === 'error' ? 'Автопланирование не выполнено' : 'Автопланирование'));
  productionAutoPlanResultHistory.push({
    className: kind === 'error' ? 'is-error' : 'is-success',
    html: `<div class="production-auto-plan-result-${kind === 'error' ? 'error' : 'success'}"><b>${safeTitle}</b><br>${safeMessage}</div>`
  });
  renderProductionAutoPlanResultHistory();
}

function formatProductionAutoPlanResult(payload, formState) {
  const planned = Array.isArray(payload?.plannedOperations) ? payload.plannedOperations : [];
  const unplanned = Array.isArray(payload?.unplannedOperations) ? payload.unplannedOperations : [];
  const overloaded = Array.isArray(payload?.overloadedSlots) ? payload.overloadedSlots : [];
  const hasSuccess = planned.length > 0;
  const hasFailure = unplanned.length > 0 || overloaded.length > 0;
  const className = hasSuccess && hasFailure ? 'is-partial' : hasSuccess ? 'is-success' : 'is-error';
  const header = hasSuccess && !hasFailure
    ? '<div class="production-auto-plan-result-success"><b>Все операции запланированы.</b></div>'
    : hasSuccess
      ? `<div class="production-auto-plan-result-success"><b>Запланировано ${planned.length} операций.</b></div>`
      : '<div class="production-auto-plan-result-error"><b>Операции не удалось запланировать.</b></div>';
  const plannedLines = planned.length
    ? `<div class="production-auto-plan-result-success">${planned.map(item => escapeHtml(item)).join('<br>')}</div>`
    : '';
  const unplannedLines = unplanned.length
    ? `<div class="production-auto-plan-result-error"><b>Не запланировано:</b><br>${unplanned.map(item => escapeHtml(item)).join('<br>')}</div>`
    : '';
  const overloadedLines = overloaded.length
    ? `<div class="production-auto-plan-result-error"><b>Перегружены:</b><br>${overloaded.map(item => escapeHtml(item)).join('<br>')}</div>`
    : '';
  const meta = [
    `Старт: ${formatProductionDisplayDate(formState?.startDate || '')} / смена ${formState?.startShift || 1}`,
    `Дедлайн МК: ${formatProductionDisplayDate(formState?.cardDeadline || '') || 'не задан'}`,
    `Дедлайн автоплана: ${formatProductionDisplayDate(formState?.effectiveDeadline || '') || 'не задан'}`
  ].join('<br>');
  return {
    className,
    html: `${header}<div class="muted" style="margin:8px 0 10px;">${meta}</div>${plannedLines}${unplannedLines ? `<div style="margin-top:10px;">${unplannedLines}</div>` : ''}${overloadedLines ? `<div style="margin-top:10px;">${overloadedLines}</div>` : ''}`
  };
}

function fillProductionAutoPlanModal(card) {
  const modal = document.getElementById('production-auto-plan-modal');
  if (!modal || !card) return;
  const readonly = isProductionRouteReadonly('production-plan');
  const settings = getDefaultProductionAutoPlanSettings(card);
  const startDateInput = modal.querySelector('#production-auto-plan-start-date');
  const startDateNative = modal.querySelector('#production-auto-plan-start-date-native');
  const startShiftSelect = modal.querySelector('#production-auto-plan-start-shift');
  const cardLabelEl = modal.querySelector('#production-auto-plan-card-label');
  const cardDeadlineLabelEl = modal.querySelector('#production-auto-plan-card-deadline-label');
  const cardDeadlineInput = modal.querySelector('#production-auto-plan-card-deadline');
  const deadlineModeSelect = modal.querySelector('#production-auto-plan-deadline-mode');
  const targetEndDateInput = modal.querySelector('#production-auto-plan-target-end-date');
  const targetEndDateNative = modal.querySelector('#production-auto-plan-target-end-date-native');
  const areaModeSelect = modal.querySelector('#production-auto-plan-area-mode');
  const areaSelect = modal.querySelector('#production-auto-plan-area-id');
  const contextEl = modal.querySelector('#production-auto-plan-context');
  const runBtn = modal.querySelector('#production-auto-plan-run');
  const saveBtn = modal.querySelector('#production-auto-plan-save');
  if (startShiftSelect) startShiftSelect.innerHTML = buildProductionAutoPlanShiftOptions(settings.startShift);
  if (areaSelect) areaSelect.innerHTML = `<option value="">Выберите участок</option>${buildProductionAutoPlanAreaOptions(settings.areaId || productionAutoPlanContext?.areaId || '')}`;
  syncProductionAutoPlanDateInputs(startDateInput, startDateNative, settings.startDate);
  syncProductionAutoPlanDateInputs(targetEndDateInput, targetEndDateNative, settings.customDeadline || card.plannedCompletionDate || '');
  if (cardLabelEl) cardLabelEl.textContent = getPlanningCardLabel(card);
  if (cardDeadlineLabelEl) cardDeadlineLabelEl.textContent = `Плановая дата завершения МК: ${formatProductionDisplayDate(card.plannedCompletionDate || '') || 'не задана'}`;
  if (cardDeadlineInput) cardDeadlineInput.value = formatProductionDisplayDate(card.plannedCompletionDate || '');
  if (deadlineModeSelect) {
    const hasCardDeadline = Boolean(card.plannedCompletionDate);
    deadlineModeSelect.value = hasCardDeadline ? settings.deadlineMode : 'CUSTOM_DEADLINE';
    const cardOption = deadlineModeSelect.querySelector('option[value="CARD_PLANNED_COMPLETION"]');
    if (cardOption) cardOption.disabled = !hasCardDeadline;
  }
  if (areaModeSelect) areaModeSelect.value = settings.areaMode;
  const map = {
    '#production-auto-plan-max-load-percent': settings.maxLoadPercent,
    '#production-auto-plan-delay-minutes': settings.delayMinutes,
    '#production-auto-plan-min-operation-minutes': settings.minOperationMinutes,
    '#production-auto-plan-min-items': settings.minItems,
    '#production-auto-plan-min-witness': settings.minWitness,
    '#production-auto-plan-min-control': settings.minControl,
    '#production-auto-plan-transfer-items': settings.transferItems,
    '#production-auto-plan-transfer-witness': settings.transferWitness,
    '#production-auto-plan-transfer-control': settings.transferControl
  };
  Object.entries(map).forEach(([selector, value]) => {
    const input = modal.querySelector(selector);
    if (input) input.value = String(value);
  });
  const partialBatchInput = modal.querySelector('#production-auto-plan-allow-last-partial-batch');
  if (partialBatchInput) partialBatchInput.checked = settings.allowLastPartialBatch === true;
  modal.querySelectorAll('.production-auto-plan-shift-btn').forEach(btn => {
    const shift = parseInt(btn.getAttribute('data-shift'), 10) || 0;
    btn.classList.toggle('is-active', settings.activeShifts.includes(shift));
    btn.classList.toggle('active', settings.activeShifts.includes(shift));
  });
  if (contextEl) {
    contextEl.textContent = `Карта: ${getPlanningCardLabel(card)}${productionAutoPlanContext?.areaName ? ` / стартовый участок: ${productionAutoPlanContext.areaName}` : ''}`;
  }
  if (runBtn) runBtn.classList.toggle('hidden', readonly);
  if (saveBtn) saveBtn.classList.add('hidden');
  productionAutoPlanLastPreview = null;
  productionAutoPlanResultHistory = [];
  renderProductionAutoPlanResultHistory();
  updateProductionAutoPlanFormUi();
}

function openProductionAutoPlanModal({ cardId, areaId = '', areaName = '' } = {}) {
  const modal = document.getElementById('production-auto-plan-modal');
  if (!modal) return;
  const card = (cards || []).find(item => String(item?.id || '') === String(cardId || '')) || null;
  if (!card) {
    showToast('Маршрутная карта не найдена.');
    return;
  }
  if (
    card.approvalStage !== APPROVAL_STAGE_PROVIDED &&
    card.approvalStage !== APPROVAL_STAGE_PLANNING &&
    card.approvalStage !== APPROVAL_STAGE_PLANNED
  ) {
    showToast('Автопланирование доступно только для карт в статусах «Ожидает планирования», «Планирование» или «Запланировано».');
    return;
  }
  productionAutoPlanContext = {
    cardId: String(card.id || ''),
    card,
    areaId: String(areaId || ''),
    areaName: String(areaName || '')
  };
  modal.dataset.cardId = String(card.id || '');
  fillProductionAutoPlanModal(card);
  modal.classList.remove('hidden');
}

async function runProductionAutoPlan({ save = false } = {}) {
  if (!ensureProductionEditAccess('production-plan')) return;
  const modal = document.getElementById('production-auto-plan-modal');
  if (!modal || !productionAutoPlanContext?.card) return;
  const runBtn = modal.querySelector('#production-auto-plan-run');
  const saveBtn = modal.querySelector('#production-auto-plan-save');
  const formState = getProductionAutoPlanFormState(modal);
  const validationError = validateProductionAutoPlanFormState(formState);
  if (validationError) {
    pushProductionAutoPlanResultMessage(validationError, {
      kind: 'error',
      title: save ? 'Сохранение автоплана отклонено' : 'Запуск автоплана отклонён'
    });
    showToast(validationError);
    return;
  }
  persistProductionAutoPlanFormState(formState);
  try {
    if (runBtn) runBtn.disabled = true;
    if (saveBtn) saveBtn.disabled = true;
    const payload = await commitProductionAutoPlan({
      dryRun: !save,
      cardId: formState.cardId,
      startDate: formState.startDate,
      startShift: formState.startShift,
      activeShifts: formState.activeShifts,
      deadlineMode: formState.deadlineMode,
      cardPlannedCompletionDate: formState.cardDeadline,
      targetEndDate: formState.customDeadline,
      effectiveDeadline: formState.effectiveDeadline,
      maxLoadPercent: formState.maxLoadPercent,
      areaMode: formState.areaMode,
      areaId: formState.areaId,
      delayMinutes: formState.delayMinutes,
      minOperationMinutes: formState.minOperationMinutes,
      minItems: formState.minItems,
      minWitness: formState.minWitness,
      minControl: formState.minControl,
      transferItems: formState.transferItems,
      transferWitness: formState.transferWitness,
      transferControl: formState.transferControl,
      allowLastPartialBatch: formState.allowLastPartialBatch,
      areasOrder: getProductionAreasWithOrder().order,
      previewRunId: productionAutoPlanLastPreview?.previewRunId || ''
    });
    console.info(`[AUTO_PLAN] result card=${formState.cardId} dryRun=${!save} planned=${payload?.plannedCount || 0} unplanned=${payload?.unplannedCount || 0}`);
    if (!save) {
      productionAutoPlanLastPreview = payload;
      productionAutoPlanResultHistory.push(formatProductionAutoPlanResult(payload, formState));
      renderProductionAutoPlanResultHistory();
      const saveBtn = modal.querySelector('#production-auto-plan-save');
      if (saveBtn) {
        saveBtn.classList.toggle('hidden', payload?.hasSuccessfulOperations !== true);
        saveBtn.disabled = false;
      }
      showProductionMissingAreaExecutorToasts(payload?.blockedAreaNames);
      showToast(payload?.message || 'Автопланирование выполнено');
      return;
    }
    applyProductionPlanningServerState(payload);
    refreshProductionPlanUiAfterMutation({
      cardId: formState.cardId,
      affectedCells: Array.isArray(payload?.affectedCells) ? payload.affectedCells : []
    });
    closeProductionAutoPlanModal();
    showProductionMissingAreaExecutorToasts(payload?.blockedAreaNames);
    showToast(payload?.message || 'Автоплан сохранён');
  } catch (err) {
    pushProductionAutoPlanResultMessage(err?.message || 'Не удалось выполнить автопланирование', {
      kind: 'error',
      title: save ? 'Сохранение автоплана завершилось ошибкой' : 'Dry-run автоплана завершился ошибкой'
    });
    if (showProductionMissingAreaExecutorToasts(err?.blockedAreaNames).length) return;
    showToast(err?.message || 'Не удалось выполнить автопланирование');
  } finally {
    if (runBtn) runBtn.disabled = false;
    if (saveBtn && !save) {
      saveBtn.disabled = false;
    }
  }
}

function bindProductionAutoPlanModal() {
  const modal = document.getElementById('production-auto-plan-modal');
  if (!modal || modal.dataset.bound === 'true') return;
  modal.dataset.bound = 'true';
  const cancelBtn = modal.querySelector('#production-auto-plan-cancel');
  const ganttBtn = modal.querySelector('#production-auto-plan-open-gantt');
  const runBtn = modal.querySelector('#production-auto-plan-run');
  const saveBtn = modal.querySelector('#production-auto-plan-save');
  if (cancelBtn) cancelBtn.addEventListener('click', closeProductionAutoPlanModal);
  if (ganttBtn) {
    ganttBtn.addEventListener('click', () => {
      const card = productionAutoPlanContext?.card || null;
      if (!card) {
        showToast('Маршрутная карта не найдена.');
        return;
      }
      closeProductionAutoPlanModal();
      navigateToPath(getProductionGanttPath(card));
    });
  }
  if (runBtn) runBtn.addEventListener('click', () => runProductionAutoPlan({ save: false }));
  if (saveBtn) saveBtn.addEventListener('click', () => runProductionAutoPlan({ save: true }));

  modal.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const shiftBtn = target.closest('.production-auto-plan-shift-btn');
    if (shiftBtn) {
      const currentButtons = Array.from(modal.querySelectorAll('.production-auto-plan-shift-btn.is-active, .production-auto-plan-shift-btn.active'));
      const isActive = shiftBtn.classList.contains('is-active') || shiftBtn.classList.contains('active');
      if (isActive && currentButtons.length === 1) return;
      shiftBtn.classList.toggle('is-active', !isActive);
      shiftBtn.classList.toggle('active', !isActive);
      updateProductionAutoPlanFormUi();
      return;
    }
    const pickerConfig = [
      ['#production-auto-plan-start-date-picker', '#production-auto-plan-start-date-native'],
      ['#production-auto-plan-target-end-date-picker', '#production-auto-plan-target-end-date-native']
    ];
    const match = pickerConfig.find(([buttonSelector]) => target.closest(buttonSelector));
    if (!match) return;
    const nativeInput = modal.querySelector(match[1]);
    if (!nativeInput) return;
    if (typeof nativeInput.showPicker === 'function') {
      nativeInput.showPicker();
    } else {
      nativeInput.click();
    }
  });

  modal.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.matches('#production-auto-plan-start-date-native')) {
      syncProductionAutoPlanDateInputs(
        modal.querySelector('#production-auto-plan-start-date'),
        target,
        target.value || ''
      );
    }
    if (target.matches('#production-auto-plan-target-end-date-native')) {
      syncProductionAutoPlanDateInputs(
        modal.querySelector('#production-auto-plan-target-end-date'),
        target,
        target.value || ''
      );
    }
    if (target instanceof HTMLInputElement && target.type === 'number') {
      normalizeProductionAutoPlanNumberInput(target);
    }
    updateProductionAutoPlanFormUi();
  });

  modal.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    updateProductionAutoPlanFormUi();
  });

  modal.addEventListener('focusout', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    normalizeProductionAutoPlanNumberInput(target);
    updateProductionAutoPlanFormUi();
  });
}

function getOperationPlannedMinutes(cardId, routeOpId) {
  if (!cardId || !routeOpId) return 0;
  return getOperationPlanningSnapshot(cardId, routeOpId).plannedMinutes;
}

function getOperationRemainingMinutes(cardId, routeOpId) {
  return getOperationPlanningSnapshot(cardId, routeOpId).availableToPlanMinutes;
}

function getShiftPlannedMinutes(dateStr, shift, areaId) {
  const tasks = getProductionShiftTasksForCell(dateStr, shift, areaId);
  return (tasks || []).reduce((sum, task) => sum + getTaskPlannedMinutes(task), 0);
}

function getShiftFreeMinutes(dateStr, shift, areaId) {
  const shiftTotal = getShiftDurationMinutesForArea(shift, areaId);
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
      getPlannableOpsCountForCard(card) > 0 &&
      card.approvalStage === APPROVAL_STAGE_PLANNED
    );
  }
  return (cards || []).filter(card =>
    card &&
    !card.archived &&
    card.cardType === 'MKI' &&
    getPlannableOpsCountForCard(card) > 0 &&
    (card.approvalStage === APPROVAL_STAGE_PROVIDED || card.approvalStage === APPROVAL_STAGE_PLANNING)
  );
}

function isRouteOpPlannedInShifts(cardId, routeOpId) {
  if (!cardId || !routeOpId) return false;
  const card = (cards || []).find(item => String(item?.id || '') === String(cardId)) || null;
  const op = (card?.operations || []).find(item => String(item?.id || '') === String(routeOpId)) || null;
  if (isPlanningHiddenOperation(op)) return true;
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
  if (number && name) return `${number} — ${name}`;
  if (number) return number;
  return name || 'Маршрутная карта';
}

function normalizeQueueSearchValue(value) {
  return (value || '').toString().trim().toLowerCase();
}

function getProductionShiftCloseRowSearchIndex(row) {
  if (!row) return '';
  return [
    row.areaName || '',
    row.routeCardNumber || '',
    row.itemName || '',
    row.opCode || '',
    row.opName || ''
  ]
    .map(normalizeQueueSearchValue)
    .filter(Boolean)
    .join(' ');
}

function filterProductionShiftCloseRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const query = normalizeQueueSearchValue(productionShiftCloseState.filterText);
  if (!query) return list;
  return list.filter(row => getProductionShiftCloseRowSearchIndex(row).includes(query));
}

function getProductionQueueCardSearchIndex(card) {
  if (!card) return '';
  const number = normalizeQueueSearchValue(card.routeCardNumber);
  const qrCode = normalizeQueueSearchValue(card.qrId);
  const name = normalizeQueueSearchValue(card.itemName || card.name);
  const basis = normalizeQueueSearchValue(card.workBasis);
  return [number, qrCode, name, basis].filter(Boolean).join(' ');
}

function stopProductionShiftCloseEndClock() {
  if (!productionShiftCloseEndClockTimer) return;
  clearInterval(productionShiftCloseEndClockTimer);
  productionShiftCloseEndClockTimer = null;
}

function getProductionShiftCloseEndTimeValue(record, snapshot = null) {
  const snapshotClosedAt = Number(snapshot?.closedAt) || 0;
  if (snapshotClosedAt > 0) return snapshotClosedAt;
  const status = String(record?.status || '').trim().toUpperCase();
  if (status === 'OPEN') return Date.now();
  return Number(record?.closedAt) || 0;
}

function bindProductionShiftCloseEndClock(section, { record = null, snapshot = null } = {}) {
  stopProductionShiftCloseEndClock();
  const endValueEl = section?.querySelector('[data-role="production-shift-close-end-value"]');
  if (!endValueEl) return;
  const isLive = String(record?.status || '').trim().toUpperCase() === 'OPEN' && !(Number(snapshot?.closedAt) > 0);
  endValueEl.textContent = formatDateTime(getProductionShiftCloseEndTimeValue(record, snapshot)) || '—';
  if (!isLive) return;
  try {
    console.log('[ROUTE] shift close end clock:start', {
      shiftId: record?.id || null
    });
  } catch (e) {}
  productionShiftCloseEndClockTimer = setInterval(() => {
    const liveEl = document.querySelector('[data-role="production-shift-close-end-value"]');
    const currentPath = window.location.pathname || '';
    if (!liveEl || !currentPath.startsWith('/production/shifts/')) {
      stopProductionShiftCloseEndClock();
      return;
    }
    liveEl.textContent = formatDateTime(Date.now()) || '—';
  }, 1000);
}

function openProductionShiftClosePrintPreview() {
  const cardEl = document.querySelector('.production-card.production-shift-close-card');
  if (!cardEl) return;

  const printCard = cardEl.cloneNode(true);
  printCard.querySelectorAll('.production-shift-close-filter-row, .production-shift-close-footer').forEach(node => node.remove());

  const expandPrintTableRowspans = (table) => {
    if (!table) return;
    const rows = Array.from(table.querySelectorAll('tr'));
    const pending = [];
    rows.forEach((row) => {
      pending
        .filter(entry => entry.remaining > 0)
        .sort((a, b) => a.col - b.col)
        .forEach((entry) => {
          const clone = entry.cell.cloneNode(true);
          clone.removeAttribute('rowspan');
          const cells = Array.from(row.children);
          const beforeCell = cells.find((cell, idx) => {
            const col = idx;
            return col >= entry.col;
          }) || null;
          row.insertBefore(clone, beforeCell);
          entry.remaining -= 1;
        });

      Array.from(row.children).forEach((cell, idx) => {
        const span = parseInt(cell.getAttribute('rowspan'), 10) || 1;
        if (span > 1) {
          pending.push({ col: idx, remaining: span - 1, cell: cell.cloneNode(true) });
          cell.removeAttribute('rowspan');
        }
      });
    });
  };

  printCard.querySelectorAll('.production-shift-close-table').forEach(table => expandPrintTableRowspans(table));

  printCard.querySelectorAll('button.production-shift-close-sort').forEach(button => {
    const span = document.createElement('span');
    span.textContent = button.textContent || '';
    button.replaceWith(span);
  });

  printCard.querySelectorAll('input.production-shift-close-target-input').forEach(input => {
    const span = document.createElement('span');
    span.textContent = formatProductionDisplayDate(input.value || '') || '—';
    input.replaceWith(span);
  });

  printCard.querySelectorAll('select.production-shift-close-target-select').forEach(select => {
    const span = document.createElement('span');
    const selectedOption = select.options[select.selectedIndex] || null;
    span.textContent = (selectedOption?.textContent || '').trim() || '—';
    select.replaceWith(span);
  });

  printCard.querySelectorAll('input[type="checkbox"]').forEach(input => input.remove());

  const linkedStyles = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
    .map(link => `<link rel="stylesheet" href="${link.href}">`)
    .join('');
  const inlineStyles = Array.from(document.querySelectorAll('style'))
    .map(style => style.outerHTML)
    .join('');

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Разрешите всплывающие окна для печати.');
    return;
  }

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Закрытие смены — печать</title>
  ${linkedStyles}
  ${inlineStyles}
  <style>
    @page { size: A4 landscape; margin: 10mm; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body { font-family: Arial, sans-serif; }
    .print-shift-close-wrap { padding: 8mm; }
    .print-shift-close-scale { transform-origin: top left; overflow: visible !important; }
    .print-shift-close-wrap .production-card.production-shift-close-card { box-shadow: none !important; border: none !important; }
    .print-shift-close-wrap .production-toolbar { display: none !important; }
    .print-shift-close-wrap .production-shift-close-filter-row { display: none !important; }
    .print-shift-close-wrap .production-shift-close-footer { display: none !important; }
    .print-shift-close-wrap .production-shift-close-table-wrap { overflow: visible !important; }
    .print-shift-close-wrap .production-shift-close-table { min-width: 0 !important; width: 100% !important; table-layout: fixed !important; }
    .print-shift-close-wrap .production-shift-close-table thead { display: table-header-group !important; }
    .print-shift-close-wrap .production-shift-close-table tr > *:last-child { display: none !important; }
    .print-shift-close-wrap .production-shift-close-table th,
    .print-shift-close-wrap .production-shift-close-table td {
      padding: 3px 4px !important;
      font-size: 9px !important;
      line-height: 1.15 !important;
      word-break: break-word !important;
      overflow-wrap: anywhere !important;
    }
    .print-shift-close-wrap .production-shift-close-table tr {
      break-inside: avoid !important;
      page-break-inside: avoid !important;
    }
    .print-shift-close-wrap .production-shift-close-title { font-size: 22px !important; }
    .print-shift-close-wrap .production-shift-close-summary {
      gap: 6px !important;
    }
    .print-shift-close-wrap .production-shift-close-summary-item {
      font-size: 11px !important;
      padding: 6px 8px !important;
    }
    .print-shift-close-wrap .production-shift-close-header,
    .print-shift-close-wrap .production-shift-close-meta-grid {
      gap: 6px !important;
    }
    .print-shift-close-wrap .production-shift-close-personal-subtitle {
      font-size: 8px !important;
    }
    .print-shift-close-wrap button { border: none !important; background: transparent !important; color: inherit !important; box-shadow: none !important; }
    @media print {
      .print-shift-close-wrap { padding: 0; }
      .print-shift-close-wrap .production-card.production-shift-close-card { gap: 10px; }
    }
  </style>
</head>
<body>
  <div class="print-shift-close-wrap"><div class="print-shift-close-scale">${printCard.outerHTML}</div></div>
  <script>
    (function () {
      let fired = false;
      function fitToPageWidth() {
        var scaleEl = document.querySelector('.print-shift-close-scale');
        if (!scaleEl) return;
        scaleEl.style.transform = 'none';
        scaleEl.style.zoom = '1';
        scaleEl.style.width = '100%';
        var availableWidth = Math.max(0, document.documentElement.clientWidth - 2);
        var contentWidth = Math.ceil(scaleEl.scrollWidth || 0);
        if (!availableWidth || !contentWidth) return;
        var scale = Math.min(1, availableWidth / contentWidth);
        scaleEl.style.zoom = String(scale);
      }
      window.addEventListener('load', function () {
        if (fired) return;
        fired = true;
        fitToPageWidth();
        setTimeout(function () { window.print(); }, 250);
      });
      window.addEventListener('resize', fitToPageWidth);
      window.addEventListener('afterprint', function () {
        window.close();
      });
    })();
  <\/script>
</body>
</html>`;

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
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
  return {
    date,
    areaId,
    shift,
    employeeId,
    timeFrom,
    timeTo,
    assignmentStatus: normalizeProductionAssignmentStatus('', areaId)
  };
}

function applyProductionScheduleServerState(payload) {
  updateProductionPlanningRevisionFromPayload(payload, 'schedule');
  if (Array.isArray(payload?.productionSchedule)) {
    productionSchedule = payload.productionSchedule;
  }
  if (Array.isArray(payload?.productionShifts)) {
    productionShifts = payload.productionShifts;
  }
  if (Array.isArray(payload?.productionShiftTimes)) {
    productionShiftTimes = payload.productionShiftTimes.length
      ? payload.productionShiftTimes.map((item, index) => normalizeProductionShiftTimeEntry(item, index + 1))
      : [];
  }
  if (Array.isArray(payload?.areas)) {
    areas = payload.areas.map(area => normalizeArea(area));
  }
  if (Array.isArray(payload?.users)) {
    users = payload.users.map(user => ({
      ...user,
      id: String(user.id).trim(),
      departmentId: user.departmentId == null ? null : String(user.departmentId).trim()
    }));
  }
  ensureDefaults();
  ensureProductionShiftsFromData();
}

async function commitProductionScheduleChange(payload, options = {}) {
  if (!ensureProductionEditAccess('production-schedule')) {
    throw new Error('Недостаточно прав для изменения расписания производства');
  }
  const runCommit = async () => {
    const request = getPlanningApiRequest();
    const requestPayload = withProductionPlanningExpectedRev(payload, 'schedule');
    console.info('[PLAN] schedule commit start', { action: requestPayload?.action || '' });
    const res = await request('/api/production/planning/schedule/assignments/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload || {}),
      signal: options?.signal
    });
    const data = await res.json().catch(() => ({}));
    updateProductionPlanningRevisionFromPayload(data, 'schedule');
    if (!res.ok) {
      const error = new Error(data?.error || `HTTP ${res.status}`);
      error.response = data;
      throw error;
    }
    applyProductionScheduleServerState(data);
    return data || {};
  };
  const chained = productionScheduleCommitQueue
    .catch(() => {})
    .then(runCommit);
  productionScheduleCommitQueue = chained.catch(() => {});
  return chained;
}

function refreshProductionScheduleAfterMutation() {
  if ((window.location.pathname || '') !== '/production/schedule') return;
  renderProductionSchedule();
}

async function addEmployeesToProductionCell() {
  const cell = productionScheduleState.selectedCell;
  if (!cell) {
    alert('Выберите ячейку расписания');
    return;
  }
  if (!ensureProductionEditAccess('production-schedule')) return;
  if (!canEditShiftWithStatus(cell.date, cell.shift)) {
    showShiftEditBlockedToast(cell.date, cell.shift);
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

  const hasFixedTarget = targetGroups.some(group =>
    group.targets.some(target => isShiftFixed(target.date, target.shift || cell.shift))
  );
  if (hasFixedTarget) {
    showToast('Смена зафиксирована и не может быть изменена');
    return;
  }
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

  const assignments = [];
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
      assignments.push(record);
    }
  }

  try {
    await commitProductionScheduleChange({
      action: 'add',
      assignments
    });
    refreshProductionScheduleAfterMutation();
    showToast('Сотрудники добавлены в расписание');
    // Важно сбросить выбор, иначе следующий сотрудник не добавится без F5.
    productionScheduleState.selectedEmployees = [];
    renderProductionScheduleSidebar();
  } catch (err) {
    showToast(err?.message || 'Не удалось сохранить расписание');
  }
}

async function deleteProductionAssignments() {
  if (!ensureProductionEditAccess('production-schedule')) return;
  const cell = productionScheduleState.selectedCell;
  if (!cell) return;
  const { date, areaId, shift } = cell;
  const employeeId = productionScheduleState.selectedCellEmployeeId;
  if (!canEditShiftWithStatus(date, shift)) {
    showShiftEditBlockedToast(date, shift);
    return;
  }

  // delete whole day (column)
  if (areaId === null) {
    try {
      const payload = await commitProductionScheduleChange({
        action: 'delete',
        date,
        shift,
        areaId: null
      });
      productionScheduleState.selectedCellEmployeeId = null;
      if (Number(payload?.changed) > 0) {
        refreshProductionScheduleAfterMutation();
      }
    } catch (err) {
      showToast(err?.message || 'Не удалось удалить назначение');
    }
    return;
  }

  try {
    const payload = await commitProductionScheduleChange({
      action: 'delete',
      date,
      shift,
      areaId,
      employeeId: employeeId || ''
    });
    productionScheduleState.selectedCellEmployeeId = null;
    if (Number(payload?.changed) > 0) {
      refreshProductionScheduleAfterMutation();
    }
  } catch (err) {
    showToast(err?.message || 'Не удалось удалить назначение');
  }
}

function copyProductionCell() {
  if (!ensureProductionEditAccess('production-schedule')) return;
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

async function pasteProductionCell() {
  if (!ensureProductionEditAccess('production-schedule')) return;
  const cell = productionScheduleState.selectedCell;
  const clip = productionScheduleState.clipboard;
  if (!cell || !clip) return;
  if (!canEditShiftWithStatus(cell.date, cell.shift)) {
    showShiftEditBlockedToast(cell.date, cell.shift);
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

    const record = {
      date: cell.date,
      shift: cell.shift,
      areaId: cell.areaId,
      employeeId: empId,
      timeFrom: clip.item.timeFrom ?? null,
      timeTo: clip.item.timeTo ?? null,
      assignmentStatus: normalizeProductionAssignmentStatus('', cell.areaId)
    };
    try {
      await commitProductionScheduleChange({
        action: 'add',
        assignments: [record]
      });
      refreshProductionScheduleAfterMutation();
    } catch (err) {
      showToast(err?.message || 'Не удалось вставить назначение');
    }
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

    const assignments = clip.items.map(item => ({
        date: cell.date,
        shift: cell.shift,
        areaId: item.areaId,
        employeeId: item.employeeId,
        timeFrom: item.timeFrom ?? null,
        timeTo: item.timeTo ?? null,
        assignmentStatus: normalizeProductionAssignmentStatus(item.assignmentStatus, item.areaId)
      }));

    try {
      await commitProductionScheduleChange({
        action: 'replace-day',
        date: cell.date,
        shift: cell.shift,
        assignments
      });
      refreshProductionScheduleAfterMutation();
    } catch (err) {
      showToast(err?.message || 'Не удалось вставить расписание дня');
    }
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

    const assignments = clip.items.map(item => ({
        date: cell.date,
        shift: cell.shift,
        areaId: cell.areaId,
        employeeId: item.employeeId,
        timeFrom: item.timeFrom ?? null,
        timeTo: item.timeTo ?? null,
        assignmentStatus: normalizeProductionAssignmentStatus(item.assignmentStatus, cell.areaId)
      }));

    try {
      await commitProductionScheduleChange({
        action: 'replace-cell',
        date: cell.date,
        shift: cell.shift,
        areaId: cell.areaId,
        assignments
      });
      refreshProductionScheduleAfterMutation();
    } catch (err) {
      showToast(err?.message || 'Не удалось вставить расписание ячейки');
    }
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
  const { areasList, order: areasOrder } = getProductionScheduleDisplayAreas();
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
    const areaName = renderAreaLabel(area, {
      name: area.name || 'Без названия',
      fallbackName: 'Без названия',
      className: 'area-name'
    });
    const reorderControls = !area.isSpecial && isProductionRowOrderEdit
      ? `<div class="area-reorder" data-area-id="${area.id}">`
        + `<button class="area-move-up" type="button"${isFirst ? ' disabled' : ''}>▲</button>`
        + `<button class="area-move-down" type="button"${isLast ? ' disabled' : ''}>▼</button>`
        + '</div>'
      : '';
    const areaCell = `<div class="area-cell${area.isSpecial ? ' area-cell-master' : ''}">${reorderControls}${areaName}</div>`;
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
        const isShiftMaster = isProductionShiftMasterAssignment(rec);

        const filteredOut = filterOn && !productionScheduleState.selectedEmployees.includes(rec.employeeId);
        if (!filteredOut) visibleCount++;

        return `<div class="production-assignment${isActive ? ' selected' : ''}${filteredOut ? ' filtered-out' : ''}${isShiftMaster ? ' production-assignment-master' : ''}" data-employee-id="${rec.employeeId}"${isShiftMaster ? ' title="Статус: Мастер смены"' : ''}>${name}${timeRange}</div>`;
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
      return `<td class="production-cell${weekendClass}${todayClass}${selectedClass}${daySelectedClass}${area.isSpecial ? ' production-cell-master' : ''}" data-area-id="${area.id}" data-date="${dateStr}" data-shift="${productionScheduleState.selectedShift}">${content}</td>`;
    }).join('');
    return `<tr><th class="production-area${area.isSpecial ? ' production-area-master' : ''}">${areaCell}</th>${cells}</tr>`;
  }).join('');

  wrapper.innerHTML = `<table class="production-table"><thead><tr><th class="production-area">Участок</th>${headerCells}</tr></thead><tbody>${rowsHtml}</tbody></table>`;
}

function renderProductionScheduleSidebar() {
  const sidebar = document.getElementById('production-sidebar');
  if (!sidebar) return;
  const readonly = isProductionRouteReadonly('production-schedule');
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
      ${readonly ? '' : '<button type="button" class="btn-primary" id="production-add">Добавить</button>'}
      ${readonly ? '' : '<button type="button" class="btn-secondary" id="production-delete">Удалить</button>'}

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
    .map((item, index) => normalizeProductionShiftTimeEntry(item, index + 1))
    .slice()
    .sort((a, b) => (a.shift || 0) - (b.shift || 0));
}

function renderProductionShiftTimesForm(container) {
  if (!container) return;
  const list = getProductionShiftTimesList();
  const renderShiftTimeRows = () => list.map(item => `
    <div class="production-shift-row">
      <div class="production-shift-label">${item.shift} смена</div>
      <label>С <input type="time" data-shift="${item.shift}" data-type="from" data-expected-rev="${item.rev || 1}" value="${escapeHtml(item.timeFrom || '')}" /></label>
      <label>По <input type="time" data-shift="${item.shift}" data-type="to" data-expected-rev="${item.rev || 1}" value="${escapeHtml(item.timeTo || '')}" /></label>
    </div>
  `).join('');
  const renderLunchRows = () => list.map(item => `
    <div class="production-shift-row">
      <div class="production-shift-label">${item.shift} смена</div>
      <label>С <input type="time" data-shift="${item.shift}" data-type="lunch-from" data-expected-rev="${item.rev || 1}" value="${escapeHtml(item.lunchFrom || '')}" /></label>
      <label>По <input type="time" data-shift="${item.shift}" data-type="lunch-to" data-expected-rev="${item.rev || 1}" value="${escapeHtml(item.lunchTo || '')}" /></label>
    </div>
  `).join('');
  container.innerHTML = `
    <div class="shift-times-layout">
      <div class="shift-times-section">
        <h3>Время смен</h3>
        <div class="shift-times-section__rows">
          ${renderShiftTimeRows()}
        </div>
      </div>
      <div class="shift-times-section">
        <h3>Время обеда</h3>
        <div class="shift-times-section__rows">
          ${renderLunchRows()}
        </div>
      </div>
    </div>
  `;
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
    if (isProductionRouteReadonly('production-schedule')) return;
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
  if (isProductionRouteReadonly('production-schedule')) return;
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
  if (isProductionRouteReadonly('production-schedule')) return;
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
  setupProductionScheduleControls();
  renderProductionShiftControls();
  renderProductionWeekTable();
  renderProductionScheduleSidebar();
  bindProductionSidebarEvents();
  bindProductionShiftControls();
  bindProductionTableEvents();
  if (typeof applyReadonlyState === 'function') {
    applyReadonlyState('production-schedule', 'production-schedule');
  }
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

function createProductionShiftPlanSessionId() {
  productionShiftPlanSessionSeq += 1;
  return `psp_${Date.now().toString(36)}_${productionShiftPlanSessionSeq.toString(36)}`;
}

function getProductionShiftPlanModalElement() {
  return document.getElementById('production-shift-plan-modal');
}

function getProductionShiftPlanSaveButtonElement() {
  return document.getElementById('production-shift-plan-save');
}

function isProductionShiftPlanAbortError(err) {
  return Boolean(err?.name === 'AbortError' || err?.code === 'ABORT_ERR');
}

function createProductionShiftPlanStaleError() {
  const error = new Error('STALE_PRODUCTION_SHIFT_PLAN_SESSION');
  error.isStaleProductionShiftPlanSession = true;
  return error;
}

function getActiveProductionShiftPlanSessionId() {
  const modal = getProductionShiftPlanModalElement();
  const modalSessionId = String(modal?.dataset.sessionId || '').trim();
  const contextSessionId = String(productionShiftPlanContext?.sessionId || '').trim();
  return contextSessionId || modalSessionId;
}

function isProductionShiftPlanSessionActive(sessionId) {
  const normalizedSessionId = String(sessionId || '').trim();
  const modal = getProductionShiftPlanModalElement();
  if (!normalizedSessionId || !modal || modal.classList.contains('hidden')) return false;
  return (
    String(modal.dataset.sessionId || '').trim() === normalizedSessionId
    && String(productionShiftPlanContext?.sessionId || '').trim() === normalizedSessionId
  );
}

function assertProductionShiftPlanSessionActive(sessionId) {
  if (!isProductionShiftPlanSessionActive(sessionId)) {
    throw createProductionShiftPlanStaleError();
  }
}

function setProductionShiftPlanSaveState(sessionId, isSaving) {
  const normalizedSessionId = String(sessionId || '').trim();
  const modal = getProductionShiftPlanModalElement();
  const saveBtn = getProductionShiftPlanSaveButtonElement();
  if (!modal || !saveBtn) return;
  if (isSaving) {
    modal.dataset.saveSessionId = normalizedSessionId;
    saveBtn.disabled = true;
    return;
  }
  if (normalizedSessionId && String(modal.dataset.saveSessionId || '').trim() !== normalizedSessionId) return;
  modal.dataset.saveSessionId = '';
  saveBtn.disabled = false;
}

function invalidateProductionShiftPlanSession({ clearContext = true, closeSubcontract = true } = {}) {
  const modal = getProductionShiftPlanModalElement();
  const activeSessionId = getActiveProductionShiftPlanSessionId();
  if (productionShiftPlanSaveAbortController) {
    try {
      productionShiftPlanSaveAbortController.abort();
    } catch {
      // ignore abort failures
    }
    productionShiftPlanSaveAbortController = null;
  }
  setProductionShiftPlanSaveState(activeSessionId, false);
  if (closeSubcontract) {
    closeProductionSubcontractItemsModal({ keepContext: false });
  }
  if (modal) {
    modal.dataset.sessionId = '';
    modal.dataset.saveSessionId = '';
  }
  if (clearContext) {
    productionShiftPlanContext = null;
  }
}

function closeProductionShiftPlanModal() {
  const modal = document.getElementById('production-shift-plan-modal');
  if (!modal) return;
  invalidateProductionShiftPlanSession({ clearContext: true, closeSubcontract: true });
  modal.classList.add('hidden');
  modal.dataset.cardId = '';
}

function closeProductionSubcontractItemsModal({ keepContext = false } = {}) {
  const modal = document.getElementById('production-subcontract-items-modal');
  if (modal) modal.classList.add('hidden');
  if (productionSubcontractPlanSelectionResolver) {
    productionSubcontractPlanSelectionResolver(null);
    productionSubcontractPlanSelectionResolver = null;
  }
  if (!keepContext) {
    productionSubcontractPlanSelectionContext = null;
  }
}

function getPendingPlanningFlowItems(card, op) {
  return getAvailableSubcontractPlanningItems(card, op);
}

function getPlanningFlowItemLabel(item) {
  return String(item?.displayName || item?.name || item?.id || 'Изделие').trim();
}

function normalizeProductionSubcontractLookupValue(value) {
  return String(value || '').trim().toLocaleUpperCase('ru-RU');
}

function getPlanningFlowItemQrValue(item) {
  return String(item?.qr || item?.id || '').trim();
}

function buildProductionSubcontractSelectionItems(items) {
  return (items || []).map((item, index) => {
    const id = String(item?.id || '').trim();
    const label = getPlanningFlowItemLabel(item);
    const qr = getPlanningFlowItemQrValue(item);
    return {
      raw: item,
      id,
      index,
      label,
      qr,
      normalizedLabel: normalizeProductionSubcontractLookupValue(label),
      normalizedQr: normalizeProductionSubcontractLookupValue(qr)
    };
  }).filter(item => item.id);
}

function compareProductionSubcontractSelectionItems(left, right, sortKey, sortDir, selectedIds) {
  const direction = sortDir === 'desc' ? -1 : 1;
  const compareStrings = (a, b) => a.localeCompare(b, 'ru', { sensitivity: 'base', numeric: true }) * direction;
  const compareNumbers = (a, b) => (a - b) * direction;
  if (sortKey === 'qr') {
    const qrResult = compareStrings(left.qr || '', right.qr || '');
    if (qrResult !== 0) return qrResult;
    const labelResult = compareStrings(left.label || '', right.label || '');
    if (labelResult !== 0) return labelResult;
    return compareNumbers(left.index, right.index);
  }
  if (sortKey === 'select') {
    const leftSelected = selectedIds.has(left.id) ? 1 : 0;
    const rightSelected = selectedIds.has(right.id) ? 1 : 0;
    const selectionResult = compareNumbers(rightSelected, leftSelected);
    if (selectionResult !== 0) return selectionResult;
    const labelResult = compareStrings(left.label || '', right.label || '');
    if (labelResult !== 0) return labelResult;
    return compareStrings(left.qr || '', right.qr || '');
  }
  const labelResult = compareStrings(left.label || '', right.label || '');
  if (labelResult !== 0) return labelResult;
  const qrResult = compareStrings(left.qr || '', right.qr || '');
  if (qrResult !== 0) return qrResult;
  return compareNumbers(left.index, right.index);
}

function getProductionSubcontractSelectionFilteredItems(context) {
  if (!context) return [];
  const filterValue = normalizeProductionSubcontractLookupValue(context.filterText);
  const filtered = !filterValue
    ? context.items.slice()
    : context.items.filter(item => item.normalizedLabel.includes(filterValue) || item.normalizedQr.includes(filterValue));
  const recentSet = new Set(context.recentIds || []);
  const filteredMap = new Map(filtered.map(item => [item.id, item]));
  const recentItems = (context.recentIds || [])
    .map(id => filteredMap.get(id))
    .filter(Boolean);
  const remainingItems = filtered
    .filter(item => !recentSet.has(item.id))
    .sort((left, right) => compareProductionSubcontractSelectionItems(
      left,
      right,
      context.sortKey || 'name',
      context.sortDir || 'asc',
      context.selectedIds || new Set()
    ));
  return recentItems.concat(remainingItems);
}

function findProductionSubcontractExactMatch(context, rawValue) {
  if (!context) return null;
  const lookupValue = normalizeProductionSubcontractLookupValue(rawValue);
  if (!lookupValue) return null;
  const matches = context.items.filter(item => item.normalizedLabel === lookupValue || item.normalizedQr === lookupValue);
  return matches.length === 1 ? matches[0] : null;
}

function renderProductionSubcontractItemsModal() {
  const context = productionSubcontractPlanSelectionContext;
  const listEl = document.getElementById('production-subcontract-items-list');
  const counterEl = document.getElementById('production-subcontract-items-counter');
  if (!listEl || !context) return;
  const orderedItems = getProductionSubcontractSelectionFilteredItems(context);
  const sortKey = context.sortKey || 'name';
  const sortDir = context.sortDir || 'asc';
  const getSortIndicator = (key) => {
    if (sortKey !== key) return '';
    return `<span class="th-sort-ind">${sortDir === 'desc' ? '↓' : '↑'}</span>`;
  };
  if (counterEl) {
    counterEl.textContent = `Выбрано: ${context.selectedIds.size} из ${Math.max(1, Number(context.requestedCount || 0))}`;
  }
  if (!orderedItems.length) {
    listEl.innerHTML = '<div class="production-subcontract-items-empty muted">Нет изделий, подходящих под фильтр.</div>';
    return;
  }
  listEl.innerHTML = `
    <table class="production-subcontract-items-table">
      <thead>
        <tr>
          <th class="th-sortable${sortKey === 'name' ? ' active' : ''}" data-sort-key="name">Наименование изделия ${getSortIndicator('name')}</th>
          <th class="th-sortable${sortKey === 'qr' ? ' active' : ''}" data-sort-key="qr">QR-код ${getSortIndicator('qr')}</th>
          <th class="th-sortable${sortKey === 'select' ? ' active' : ''}" data-sort-key="select">Выбрать ${getSortIndicator('select')}</th>
        </tr>
      </thead>
      <tbody>
        ${orderedItems.map(item => {
          const rowClasses = ['production-subcontract-items-row'];
          if (context.selectedIds.has(item.id)) rowClasses.push('is-selected');
          if ((context.recentIds || []).includes(item.id)) rowClasses.push('is-recent');
          return `
            <tr class="${rowClasses.join(' ')}" data-item-id="${escapeHtml(item.id)}">
              <td class="production-subcontract-items-cell-name">${escapeHtml(item.label || '—')}</td>
              <td class="production-subcontract-items-cell-qr"><code>${escapeHtml(item.qr || item.id || '—')}</code></td>
              <td class="production-subcontract-items-cell-select">
                <input class="production-subcontract-items-checkbox" type="checkbox" data-item-id="${escapeHtml(item.id)}"${context.selectedIds.has(item.id) ? ' checked' : ''} />
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

function applyProductionSubcontractMatchedItem(item) {
  const context = productionSubcontractPlanSelectionContext;
  const input = document.getElementById('production-subcontract-items-filter');
  if (!context || !item) return false;
  if (!context.selectedIds.has(item.id)) {
    context.selectedIds.add(item.id);
  }
  context.recentIds = [item.id].concat((context.recentIds || []).filter(id => id !== item.id));
  context.filterText = '';
  if (input) {
    input.value = '';
  }
  renderProductionSubcontractItemsModal();
  if (input) input.focus();
  return true;
}

function tryProcessProductionSubcontractLookup(rawValue) {
  const item = findProductionSubcontractExactMatch(productionSubcontractPlanSelectionContext, rawValue);
  if (!item) return false;
  return applyProductionSubcontractMatchedItem(item);
}

function openProductionSubcontractItemsModal({ card, op, requestedQty = 0 } = {}) {
  const modal = document.getElementById('production-subcontract-items-modal');
  const filterEl = document.getElementById('production-subcontract-items-filter');
  const summaryEl = document.getElementById('production-subcontract-items-summary');
  const contextEl = document.getElementById('production-subcontract-items-context');
  if (!modal) return Promise.resolve(null);
  const items = buildProductionSubcontractSelectionItems(getPendingPlanningFlowItems(card, op));
  const requestedCount = Math.max(1, Math.floor(Number(requestedQty) || 0));
  const selectedIds = new Set(items.slice(0, requestedCount).map(item => String(item?.id || '')).filter(Boolean));
  productionSubcontractPlanSelectionContext = {
    cardId: card?.id || '',
    opId: op?.id || '',
    requestedCount,
    items,
    selectedIds,
    sortKey: 'name',
    sortDir: 'asc',
    filterText: '',
    recentIds: [],
    scanPending: false,
    parentSessionId: String(productionShiftPlanContext?.sessionId || '')
  };
  if (contextEl) {
    contextEl.textContent = `${getPlanningCardLabel(card)} / ${buildProductionPlanOpTitle(op)}`;
  }
  if (summaryEl) {
    const unitLabel = getPlanningUnitLabel(op);
    summaryEl.textContent = `Выберите ${requestedCount} ${unitLabel} для цепочки субподрядчика.`;
  }
  if (filterEl) {
    filterEl.value = '';
  }
  renderProductionSubcontractItemsModal();
  if (typeof ensureScanButton === 'function') {
    ensureScanButton('production-subcontract-items-filter', 'production-subcontract-items-camera-btn');
  }
  modal.classList.remove('hidden');
  return new Promise(resolve => {
    productionSubcontractPlanSelectionResolver = (value) => {
      productionSubcontractPlanSelectionResolver = null;
      resolve(value);
    };
    if (filterEl) filterEl.focus();
  });
}

function updateProductionShiftPlanMode(mode) {
  const partEl = document.getElementById('production-shift-plan-part');
  if (!partEl) return;
  const manualEl = partEl.querySelector('.production-shift-plan-manual');
  const fillEl = partEl.querySelector('.production-shift-plan-fill');
  if (manualEl) manualEl.classList.toggle('hidden', mode !== 'manual');
  if (fillEl) fillEl.classList.toggle('hidden', mode !== 'fill');
}

function sortOpsVM(opsVM, sortKey, sortDir) {
  const dir = sortDir === 'desc' ? -1 : 1;
  const cmpStr = (a, b) => a.localeCompare(b, 'ru', { sensitivity: 'base' }) * dir;
  const cmpNum = (a, b) => (a - b) * dir;
  return opsVM.slice().sort((a, b) => {
    if (sortKey === 'code') {
      const r = cmpStr(a.code || '', b.code || '');
      return r !== 0 ? r : cmpStr(a.name || '', b.name || '');
    }
    if (sortKey === 'op') return cmpStr(a.name || '', b.name || '');
    if (sortKey === 'details') {
      const aHasValue = Number.isFinite(a.detailsSortValue);
      const bHasValue = Number.isFinite(b.detailsSortValue);
      if (aHasValue !== bHasValue) return aHasValue ? -1 : 1;
      if (aHasValue && bHasValue) {
        const r = cmpNum(a.detailsSortValue || 0, b.detailsSortValue || 0);
        return r !== 0 ? r : cmpStr(a.name || '', b.name || '');
      }
      return cmpStr(a.name || '', b.name || '');
    }
    if (sortKey === 'remain') return cmpNum(a.remain || 0, b.remain || 0);
    if (sortKey === 'status') {
      const r = cmpNum(a.statusRank || 0, b.statusRank || 0);
      return r !== 0 ? r : cmpStr(a.name || '', b.name || '');
    }
    return 0;
  });
}

function updateShiftPlanSortUI(modal) {
  if (!modal) return;
  const key = modal.dataset.pspSortKey || 'code';
  const dir = modal.dataset.pspSortDir || 'asc';
  const ths = modal.querySelectorAll('.psp-th');
  ths.forEach(th => {
    th.classList.remove('active');
    const old = th.querySelector('.psp-sort');
    if (old) old.remove();
    if (th.getAttribute('data-sort-key') === key) {
      th.classList.add('active');
      const span = document.createElement('span');
      span.className = 'psp-sort';
      span.textContent = dir === 'asc' ? '▲' : '▼';
      th.appendChild(span);
    }
  });
}

function getShiftPlanOpDetails(card, op) {
  if (!card || !op) return { text: '-', sortValue: null };
  if (isMaterialIssueOperation(op) || isDryingOperation(op) || isMaterialReturnOperation(op)) {
    return { text: '-', sortValue: null };
  }

  const normalizeSample = typeof normalizeSampleType === 'function'
    ? normalizeSampleType
    : (value) => ((value || '').toString().trim().toUpperCase() === 'WITNESS' ? 'WITNESS' : 'CONTROL');
  const label = op.isSamples
    ? (normalizeSample(op.sampleType) === 'WITNESS' ? 'ОС' : 'ОК')
    : 'ИЗ';
  const stats = typeof collectOpFlowStats === 'function'
    ? collectOpFlowStats(card, op)
    : { pendingOnOp: 0, awaiting: 0 };
  const total = Math.max(0, Number(stats?.pendingOnOp || 0)) + Math.max(0, Number(stats?.awaiting || 0));
  return {
    text: `${label}: ${total}`,
    sortValue: total
  };
}

function buildShiftPlanOpsVM(cardId, operations) {
  const card = (cards || []).find(item => String(item.id) === String(cardId)) || null;
  return (operations || []).map(op => {
    const code = op.opCode || op.code || '';
    const name = op.opName || op.name || op.opCode || '';
    const snapshot = getOperationPlanningSnapshot(cardId, op.id);
    const totalMinutes = snapshot.requiredRemainingMinutes;
    const plannedMinutes = snapshot.plannedMinutes;
    const remainingMinutes = snapshot.availableToPlanMinutes;
    const details = getShiftPlanOpDetails(card, op);
    const isReady = remainingMinutes === 0 && Math.max(0, Number(details?.sortValue || 0)) === 0;
    const statusText = isReady ? 'Готово' : (remainingMinutes === 0 ? 'Запл.' : plannedMinutes > 0 ? 'Част.' : 'Не запл.');
    const statusRank = statusText === 'Не запл.' ? 0 : statusText === 'Част.' ? 1 : 2;
    return {
      routeOpId: op.id,
      code,
      name,
      detailsText: details.text,
      detailsSortValue: details.sortValue,
      planned: plannedMinutes,
      total: totalMinutes,
      remain: remainingMinutes,
      remainingQtyText: snapshot.qtyDriven ? formatPlanningQtyWithUnit(snapshot.remainingQty, snapshot.unitLabel) : '',
      uncoveredQtyText: snapshot.qtyDriven ? formatPlanningQtyWithUnit(snapshot.uncoveredQty, snapshot.unitLabel) : '',
      statusText,
      statusRank
    };
  });
}

function updateProductionShiftPlanCompletionNotice({ opsVM = [] } = {}) {
  const noticeEl = document.getElementById('production-shift-plan-complete');
  if (!noticeEl) return;
  const allPlanned = Array.isArray(opsVM)
    && opsVM.length > 0
    && opsVM.every(vm => Math.max(0, Number(vm?.remain || 0)) === 0);
  if (!allPlanned) {
    noticeEl.classList.add('hidden');
    noticeEl.textContent = '';
    return;
  }
  noticeEl.textContent = 'Все операции запанированы!';
  noticeEl.classList.remove('hidden');
}

function renderShiftPlanOpsList({ modal, opsEl, opsVM, preserveSelectedId = '' }) {
  if (!modal || !opsEl) return;
  if (!opsVM.length) {
    opsEl.innerHTML = '<p class="muted">Операции не найдены.</p>';
    updateProductionShiftPlanCompletionNotice({ opsVM: [] });
    updateShiftPlanSortUI(modal);
    return;
  }
  const sortKey = modal.dataset.pspSortKey || 'code';
  const sortDir = modal.dataset.pspSortDir || 'asc';
  const sorted = sortOpsVM(opsVM, sortKey, sortDir);
  opsEl.innerHTML = sorted.map(vm => {
    const statusClass = (vm.statusText === 'Запл.' || vm.statusText === 'Готово') ? 'planned' : vm.statusText === 'Част.' ? 'partial' : 'not';
    const safeCode = escapeHtml(vm.code || '');
    const safeName = escapeHtml(vm.name || '');
    const safeDetails = escapeHtml(vm.detailsText || '-');
    return `
      <div class="psp-op-row${vm.routeOpId === preserveSelectedId ? ' selected' : ''}" data-route-op-id="${vm.routeOpId}">
        <div class="psp-op-code" title="${safeCode}">${safeCode}</div>
        <div class="psp-op-name" title="${safeName}">${safeName}</div>
        <div class="psp-op-details" title="${safeDetails}">${safeDetails}</div>
        <div><span class="psp-badge ${statusClass}">${vm.statusText}</span></div>
        <div class="psp-op-remain">${vm.remain} мин${vm.uncoveredQtyText ? `<br><span class="muted">${escapeHtml(vm.uncoveredQtyText)}</span>` : ''}</div>
      </div>
    `;
  }).join('');
  updateProductionShiftPlanCompletionNotice({ opsVM: sorted });
  updateShiftPlanSortUI(modal);
}

function refreshProductionShiftPlanModal({ preserveSelected = true } = {}) {
  if (!productionShiftPlanContext) return;
  const modal = document.getElementById('production-shift-plan-modal');
  const opsEl = document.getElementById('production-shift-plan-ops');
  if (!modal || !opsEl) return;
  const selectedRow = modal.querySelector('.psp-op-row.selected');
  const selectedId = preserveSelected ? selectedRow?.getAttribute('data-route-op-id') || '' : '';
  const card = cards.find(c => c.id === productionShiftPlanContext.cardId);
  if (!card) return;
  const routeOps = getPlannableShiftOperations(card.operations || []);
  const areaId = productionShiftPlanContext.areaId || '';
  const filteredOps = routeOps.filter(op => isOperationAllowedForArea(op, areaId));
  if (!filteredOps.length) {
    opsEl.innerHTML = '<p class="muted">Нет операций, доступных для выбранного участка</p>';
    updateProductionShiftPlanCompletionNotice({ opsVM: [] });
  } else {
    const opsVM = buildShiftPlanOpsVM(productionShiftPlanContext.cardId, filteredOps);
    renderShiftPlanOpsList({ modal, opsEl, opsVM, preserveSelectedId: selectedId });
  }
  if (selectedId) {
    const row = modal.querySelector(`.psp-op-row[data-route-op-id="${selectedId}"]`);
    if (row) {
      row.classList.add('selected');
      updateProductionShiftPlanPart(selectedId);
      return;
    }
  }
  const partEl = document.getElementById('production-shift-plan-part');
  if (partEl) {
    partEl.classList.add('hidden');
    partEl.innerHTML = '';
  }
}

function formatShiftPlanParts(value) {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 100) / 100;
  return rounded.toFixed(2).replace(/\.?0+$/, '');
}

function calcShiftPlanPartsForMinutes(totalMinutes, totalParts, minutes) {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return 0;
  if (!Number.isFinite(totalParts) || totalParts <= 0) return 0;
  const ratio = Math.max(0, Math.min(1, minutes / totalMinutes));
  return totalParts * ratio;
}

function getShiftPlanWholeQtyForMinutes(minutesPerUnit, minutes) {
  const perUnit = Number(minutesPerUnit);
  const plannedMinutes = Number(minutes);
  if (!Number.isFinite(perUnit) || perUnit <= 0) return 0;
  if (!Number.isFinite(plannedMinutes) || plannedMinutes <= 0) return 0;
  return Math.max(0, Math.floor((plannedMinutes / perUnit) + 1e-9));
}

function getShiftPlanMinutesForWholeQty(minutesPerUnit, qty) {
  const perUnit = Number(minutesPerUnit);
  const wholeQty = Math.max(0, Math.floor(Number(qty) || 0));
  if (!Number.isFinite(perUnit) || perUnit <= 0 || wholeQty <= 0) return 0;
  return getShiftPlanMinutesForQty(perUnit, wholeQty);
}

function getShiftPlanWholeQtyCapacity(minutesPerUnit, maxMinutes, maxQty = Infinity) {
  const perUnit = Number(minutesPerUnit);
  const minutes = Number(maxMinutes);
  const qtyLimit = Number.isFinite(Number(maxQty)) ? Math.max(0, Math.floor(Number(maxQty))) : Infinity;
  if (!Number.isFinite(perUnit) || perUnit <= 0) return 0;
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  const byMinutes = Math.max(0, Math.floor((minutes / perUnit) + 1e-9));
  return Math.min(byMinutes, qtyLimit);
}

function getShiftPlanQtyCapacity(minutesPerUnit, maxMinutes, maxQty = Infinity) {
  const perUnit = Number(minutesPerUnit);
  const minutes = Number(maxMinutes);
  const qtyLimit = Number.isFinite(Number(maxQty)) ? Math.max(0, Number(maxQty)) : Infinity;
  if (!Number.isFinite(perUnit) || perUnit <= 0) return 0;
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  const byMinutes = Math.max(0, minutes / perUnit);
  return roundPlanningQty(Math.min(byMinutes, qtyLimit));
}

function normalizeShiftPlanQtyValue(qty, maxQty = Infinity) {
  return normalizePlanningWholeQty(qty, maxQty);
}

function getShiftPlanMinutesForQty(minutesPerUnit, qty) {
  const perUnit = Number(minutesPerUnit);
  const numericQty = Number(qty);
  if (!Number.isFinite(perUnit) || perUnit <= 0) return 0;
  if (!Number.isFinite(numericQty) || numericQty <= 0) return 0;
  return roundPlanningMinutes(perUnit * numericQty);
}

function getShiftPlanInputUnitLabel(snapshot) {
  if (!snapshot?.qtyDriven) return 'мин';
  return snapshot.unitLabel === 'ОС' || snapshot.unitLabel === 'ОК' ? snapshot.unitLabel : 'Изд.';
}

function normalizeShiftPlanMinutesForSnapshot(minutes, snapshot, maxMinutes = Infinity) {
  const rawMinutes = Number(minutes);
  const capMinutes = Number.isFinite(Number(maxMinutes)) ? Math.max(0, Number(maxMinutes)) : Infinity;
  if (!snapshot?.qtyDriven || !(snapshot.minutesPerUnit > 0)) {
    if (!Number.isFinite(rawMinutes) || rawMinutes <= 0) return 0;
    return Math.max(0, Math.min(Math.max(rawMinutes, 1), capMinutes));
  }
  const maxQty = getShiftPlanWholeQtyCapacity(snapshot.minutesPerUnit, capMinutes, snapshot.uncoveredQty);
  const desiredQty = getShiftPlanWholeQtyForMinutes(snapshot.minutesPerUnit, rawMinutes);
  const wholeQty = Math.min(Math.max(desiredQty, 0), maxQty);
  return getShiftPlanMinutesForWholeQty(snapshot.minutesPerUnit, wholeQty);
}

function updateShiftPlanPartsPreview(partEl) {
  if (!partEl) return;
  const previewEl = partEl.querySelector('#production-shift-plan-parts');
  if (!previewEl) return;
  const input = partEl.querySelector('#production-shift-plan-minutes');
  const qtyInputMode = partEl.dataset.qtyInputMode === '1';
  let minutes = 0;
  if (qtyInputMode) {
    const minutesPerUnit = Number(partEl.dataset.minutesPerUnit || 0);
    const maxQty = Number(partEl.dataset.maxQty || 0);
    const maxMinutes = Number(partEl.dataset.maxPlanMinutes || 0);
    const qty = normalizeShiftPlanQtyValue(input?.value, maxQty);
    minutes = getShiftPlanMinutesForQty(minutesPerUnit, qty);
    if (qty > 0 && minutes <= 0) minutes = 1;
    if (Number.isFinite(maxMinutes) && maxMinutes > 0) {
      minutes = Math.min(minutes, maxMinutes);
    }
  } else {
    minutes = Number(input?.value || 0);
  }
  previewEl.textContent = `Будет выполнено: ${Math.max(0, Math.round(minutes || 0))} мин`;
}

function updateProductionShiftPlanPart(routeOpId) {
  const partEl = document.getElementById('production-shift-plan-part');
  if (!partEl || !productionShiftPlanContext) return;
  if (!routeOpId) {
    partEl.classList.add('hidden');
    partEl.innerHTML = '';
    return;
  }
  const modal = document.getElementById('production-shift-plan-modal');
  const { cardId, date, shift, areaId } = productionShiftPlanContext;
  const snapshot = getOperationPlanningSnapshot(cardId, routeOpId);
  const total = snapshot.requiredRemainingMinutes;
  const planned = snapshot.qtyDriven ? snapshot.coveredMinutes : snapshot.plannedMinutes;
  const remaining = snapshot.availableToPlanMinutes;
  const isSubcontractArea = isSubcontractAreaById(areaId);
  const shiftFree = isSubcontractArea ? getShiftDurationMinutes(shift, { ignoreLunch: true }) : getShiftFreeMinutes(date, shift, areaId);
  if (total <= 0) {
    showToast(snapshot.qtyDriven ? 'По операции нет фактического остатка для планирования' : 'Не задана длительность операции (plannedMinutes)');
    const row = modal?.querySelector(`.psp-op-row[data-route-op-id="${routeOpId}"]`);
    if (row) row.classList.remove('selected');
    partEl.classList.add('hidden');
    partEl.innerHTML = '';
    return;
  }
  const defaultMinutes = Math.max(1, Math.min(remaining, shiftFree));
  const qtyInputMode = snapshot.qtyDriven && snapshot.minutesPerUnit > 0;
  const maxWholeQty = qtyInputMode
    ? getShiftPlanWholeQtyCapacity(snapshot.minutesPerUnit, Math.min(remaining, shiftFree), snapshot.uncoveredQty)
    : 0;
  const maxQty = qtyInputMode ? maxWholeQty : 0;
  const wholeQtyDefaultValue = maxWholeQty;
  const appliedDefaultValue = qtyInputMode ? wholeQtyDefaultValue : defaultMinutes;
  const fillMinutes = qtyInputMode
    ? getShiftPlanMinutesForWholeQty(snapshot.minutesPerUnit, maxWholeQty)
    : Math.min(remaining, shiftFree);
  const fillQty = qtyInputMode ? maxWholeQty : 0;
  const fillText = !isSubcontractArea && shiftFree <= 0
    ? 'Смена уже загружена на 100%'
    : `Будет добавлено: ${fillMinutes} мин`;
  const card = cards.find(item => item.id === cardId);
  const op = card?.operations?.find(item => item.id === routeOpId);
  const opName = op?.opName || op?.name || op?.opCode || '';
  const plannedPartsText = snapshot.qtyDriven
    ? formatPlanningQtyWithUnit(Math.min(snapshot.remainingQty, snapshot.coveredQty), snapshot.unitLabel)
    : '';
  const remainingPartsText = snapshot.qtyDriven
    ? formatPlanningQtyWithUnit(snapshot.remainingQty, snapshot.unitLabel)
    : '';
  const uncoveredPartsText = snapshot.qtyDriven
    ? formatPlanningQtyWithUnit(snapshot.uncoveredQty, snapshot.unitLabel)
    : '';
  const fillParts = snapshot.qtyDriven
    ? Math.min(snapshot.uncoveredQty, qtyInputMode
      ? fillQty
      : (snapshot.minutesPerUnit > 0 ? roundPlanningQty(fillMinutes / snapshot.minutesPerUnit) : 0))
    : 0;
  const fillPartsText = snapshot.qtyDriven
    ? formatPlanningQtyWithUnit(fillParts, snapshot.unitLabel)
    : '';
  const inputMax = qtyInputMode ? maxQty : Math.max(1, Math.min(remaining, shiftFree));
  const inputMin = qtyInputMode ? 0 : 1;
  const inputStep = qtyInputMode ? '1' : '1';
  const inputUnitLabel = qtyInputMode ? getShiftPlanInputUnitLabel(snapshot) : 'мин';
  partEl.innerHTML = `
    <div class="psp-right-title">${escapeHtml(opName)}</div>
    <div class="psp-right-meta">
      <div>Факт. остаток: ${total} мин${remainingPartsText ? ` / ${remainingPartsText}` : ''}</div>
      <div>Покрыто планом: ${planned} мин${plannedPartsText ? ` / ${plannedPartsText}` : ''}</div>
      <div>Не запланировано: ${remaining} мин${uncoveredPartsText ? ` / ${uncoveredPartsText}` : ''}</div>
    </div>
    <div class="psp-right-meta"><b>Добавить минут:</b></div>
    <div class="psp-stepper${remaining === 0 || (qtyInputMode ? maxQty <= 0 : false) ? ' psp-disabled' : ''}">
      <button type="button" class="psp-stepper-btn" data-psp-action="minus">–</button>
      <input type="number" id="production-shift-plan-minutes" class="psp-stepper-input"
        min="${inputMin}" max="${inputMax}" value="${appliedDefaultValue}" step="${inputStep}" />
      <span class="muted">${escapeHtml(inputUnitLabel)}</span>
      <button type="button" class="psp-stepper-btn" data-psp-action="plus">+</button>
    </div>
    <div class="psp-right-meta psp-parts-preview" id="production-shift-plan-parts"></div>
    <button type="button" class="psp-fill-btn${(!isSubcontractArea && shiftFree <= 0) || remaining === 0 || (qtyInputMode && fillQty <= 0) ? ' psp-disabled' : ''}"
      data-psp-action="fill">До 100% смены</button>
    <div class="psp-fill-note" id="production-shift-plan-fill-note">${fillText}${fillText.includes('мин') ? ` / ${fillPartsText}` : ''}</div>
  `;
  partEl.classList.remove('hidden');
  partEl.dataset.fillMinutes = String(fillMinutes);
  partEl.dataset.fillQty = qtyInputMode ? String(fillQty) : '0';
  partEl.dataset.maxQty = qtyInputMode ? String(maxQty) : '0';
  partEl.dataset.maxPlanMinutes = String(Math.max(0, Math.min(remaining, shiftFree)));
  partEl.dataset.totalMinutes = String(total);
  partEl.dataset.totalParts = snapshot.qtyDriven && snapshot.remainingQty > 0 ? String(snapshot.remainingQty) : '0';
  partEl.dataset.unitLabel = snapshot.unitLabel || 'изд';
  partEl.dataset.qtyInputMode = qtyInputMode ? '1' : '0';
  partEl.dataset.wholeQtyMode = qtyInputMode ? '1' : '0';
  partEl.dataset.minutesPerUnit = qtyInputMode ? String(snapshot.minutesPerUnit) : '0';
  partEl.dataset.maxWholeQty = qtyInputMode ? String(maxWholeQty) : '0';
  updateShiftPlanPartsPreview(partEl);
  if (modal) modal.dataset.pspMode = 'manual';
}

function isOperationAllowedForArea(routeOperation, areaId) {
  if (!areaId) return true;
  if (!routeOperation?.opId) return true;

  const refOp = ops.find(o => o.id === routeOperation.opId);
  if (!refOp) return true;

  const allowed = Array.isArray(refOp.allowedAreaIds)
    ? refOp.allowedAreaIds
    : [];

  if (allowed.length === 0) return true;

  return allowed.includes(areaId);
}

function openProductionShiftPlanModal({ cardId, date, shift, areaId }) {
  if (!ensureProductionEditAccess('production-plan')) return;
  const modal = document.getElementById('production-shift-plan-modal');
  if (!modal) return;
  invalidateProductionShiftPlanSession({ clearContext: true, closeSubcontract: true });
  const openScrollState = (() => {
    const tableWrapper = document.querySelector('.production-shifts-table-wrapper');
    return {
      windowX: window.scrollX || 0,
      windowY: window.scrollY || 0,
      tableScrollLeft: tableWrapper ? tableWrapper.scrollLeft : 0,
      tableScrollTop: tableWrapper ? tableWrapper.scrollTop : 0
    };
  })();
  const openPlanState = {
    weekStart: productionShiftsState.weekStart ? new Date(productionShiftsState.weekStart) : null,
    planWindowStartSlot: productionShiftsState.planWindowStartSlot
      ? {
        date: String(productionShiftsState.planWindowStartSlot.date || ''),
        shift: parseInt(productionShiftsState.planWindowStartSlot.shift, 10) || 1
      }
      : null,
    selectedShifts: Array.isArray(productionShiftsState.selectedShifts)
      ? productionShiftsState.selectedShifts.slice()
      : null
  };
  const card = cards.find(c => c.id === cardId);
  if (!card) {
    showToast('Маршрутная карта не найдена.');
    return;
  }
  if (card.approvalStage !== APPROVAL_STAGE_PROVIDED && card.approvalStage !== APPROVAL_STAGE_PLANNING) {
    showToast('Планировать можно только карты в статусе «Ожидает планирования» или «Планирование».');
    return;
  }
  if (isShiftFixed(date, shift)) {
    showToast('Смена зафиксирована и не может быть изменена');
    return;
  }
  if (!canPlanShiftOperations(date, shift)) {
    showToast('Смена уже завершена.');
    return;
  }
  const blockedAreaName = getProductionOpenShiftUnassignedAreaName(date, shift, areaId);
  if (blockedAreaName) {
    showProductionMissingAreaExecutorToasts([blockedAreaName]);
    return;
  }
  const employees = getProductionShiftEmployees(date, areaId, shift);

  const area = (areas || []).find(a => a.id === areaId);
  const dateLabel = getProductionDayLabel(date);

  modal.dataset.pspSortKey = 'code';
  modal.dataset.pspSortDir = 'asc';

  const contextEl = document.getElementById('production-shift-plan-context');
  const employeesEl = document.getElementById('production-shift-plan-employees');
  const opsEl = document.getElementById('production-shift-plan-ops');

  if (contextEl) {
    const areaName = area?.name || '-';
    contextEl.textContent = `${getPlanningCardLabel(card)} / ${dateLabel.date} (${dateLabel.weekday}) / смена ${shift} / участок: ${areaName}`;
  }
  if (employeesEl) {
    const list = employees.employeeNames.length
      ? `<ul>${employees.employeeNames.map(name => `<li>${name}</li>`).join('')}</ul>`
      : '<p class="muted">Нет сотрудников</p>';
    employeesEl.innerHTML = list;
  }
  if (opsEl) {
    const routeOps = getPlannableShiftOperations(card.operations || []);
    const filteredOps = routeOps.filter(op => isOperationAllowedForArea(op, areaId));
    if (!filteredOps.length) {
      opsEl.innerHTML = '<p class="muted">Нет операций, доступных для выбранного участка</p>';
      updateProductionShiftPlanCompletionNotice({ opsVM: [] });
    } else {
      const opsVM = buildShiftPlanOpsVM(cardId, filteredOps);
      renderShiftPlanOpsList({ modal, opsEl, opsVM });
    }
  }
  const partEl = document.getElementById('production-shift-plan-part');
  if (partEl) {
    partEl.classList.add('hidden');
    partEl.innerHTML = '';
  }
  modal.querySelectorAll('.psp-op-row.selected').forEach(row => row.classList.remove('selected'));
  delete modal.dataset.pspMode;
  updateShiftPlanSortUI(modal);

  productionShiftPlanContext = {
    cardId,
    date,
    shift,
    areaId,
    sessionId: createProductionShiftPlanSessionId(),
    openScrollState,
    openPlanState
  };
  modal.dataset.cardId = cardId;
  modal.dataset.sessionId = productionShiftPlanContext.sessionId;
  modal.dataset.saveSessionId = '';
  setProductionShiftPlanSaveState(productionShiftPlanContext.sessionId, false);
  modal.classList.remove('hidden');
}

async function resolveSubcontractPlanningSelection(card, op, snapshot, plannedPartMinutes, plannedPartQty = 0) {
  const items = getPendingPlanningFlowItems(card, op);
  const isSubcontract = isSubcontractAreaById(productionShiftPlanContext?.areaId);
  if (!isSubcontract) return null;
  const itemKind = op?.isSamples ? 'SAMPLE' : 'ITEM';
  if (!items.length) {
    showToast('Нет доступных изделий для цепочки субподрядчика.');
    return null;
  }
  let requestedQty = items.length;
  if (snapshot?.qtyDriven && snapshot.minutesPerUnit > 0) {
    requestedQty = normalizePlanningWholeQty(plannedPartQty, items.length);
    if (requestedQty <= 0) {
      requestedQty = Math.max(1, Math.round(plannedPartMinutes / snapshot.minutesPerUnit));
    }
  }
  if (requestedQty >= items.length) {
    return {
      itemIds: items.map(item => String(item?.id || '')).filter(Boolean),
      itemKind
    };
  }
  const selectedIds = await openProductionSubcontractItemsModal({
    card,
    op,
    requestedQty
  });
  if (!Array.isArray(selectedIds) || !selectedIds.length) return null;
  return {
    itemIds: Array.from(new Set(selectedIds.map(item => String(item || '').trim()).filter(Boolean))),
    itemKind
  };
}

async function saveProductionShiftPlan() {
  const perfStartedAt = performance.now();
  const modal = document.getElementById('production-shift-plan-modal');
  if (!modal || !productionShiftPlanContext) return;
  const sessionId = String(productionShiftPlanContext.sessionId || modal.dataset.sessionId || '').trim();
  if (!sessionId || !isProductionShiftPlanSessionActive(sessionId)) return;
  if (String(modal.dataset.saveSessionId || '').trim() === sessionId) return;
  const { cardId, date, shift, areaId } = productionShiftPlanContext;
  const preservedPlanWindowStartSlot = productionShiftPlanContext?.openPlanState?.planWindowStartSlot
    ? {
      date: String(productionShiftPlanContext.openPlanState.planWindowStartSlot.date || ''),
      shift: parseInt(productionShiftPlanContext.openPlanState.planWindowStartSlot.shift, 10) || 1
    }
    : (productionShiftsState.planWindowStartSlot
      ? {
        date: String(productionShiftsState.planWindowStartSlot.date || ''),
        shift: parseInt(productionShiftsState.planWindowStartSlot.shift, 10) || 1
      }
      : null);
  const preservedWeekStart = productionShiftPlanContext?.openPlanState?.weekStart
    ? new Date(productionShiftPlanContext.openPlanState.weekStart)
    : (productionShiftsState.weekStart ? new Date(productionShiftsState.weekStart) : null);
  const preservedSelectedShifts = Array.isArray(productionShiftPlanContext?.openPlanState?.selectedShifts)
    ? productionShiftPlanContext.openPlanState.selectedShifts.slice()
    : (Array.isArray(productionShiftsState.selectedShifts)
      ? productionShiftsState.selectedShifts.slice()
      : null);
  const card = cards.find(c => c.id === cardId);
  if (!card) {
    closeProductionShiftPlanModal();
    return;
  }
  if (!canPlanShiftOperations(date, shift)) {
    if (isShiftFixed(date, shift)) {
      showToast('Смена зафиксирована и не может быть изменена');
    } else {
      showToast('Смена уже завершена.');
    }
    return;
  }
  const blockedAreaName = getProductionOpenShiftUnassignedAreaName(date, shift, areaId);
  if (blockedAreaName) {
    showProductionMissingAreaExecutorToasts([blockedAreaName]);
    return;
  }
  const selectedRow = modal.querySelector('.psp-op-row.selected');
  const routeOpId = selectedRow?.getAttribute('data-route-op-id');

  if (!routeOpId) {
    showToast('Выберите операцию');
    return;
  }

  const snapshot = getOperationPlanningSnapshot(cardId, routeOpId);
  const totalMinutes = snapshot.requiredRemainingMinutes;
  const remainingMinutes = snapshot.availableToPlanMinutes;
  const isSubcontractArea = isSubcontractAreaById(areaId);
  const shiftDuration = getShiftDurationMinutes(shift, { ignoreLunch: isSubcontractArea });
  const shiftFreeMinutes = isSubcontractArea ? shiftDuration : getShiftFreeMinutes(date, shift, areaId);
  if (totalMinutes <= 0) {
    showToast(snapshot.qtyDriven ? 'По операции нет фактического остатка для планирования' : 'Не задана длительность операции (plannedMinutes)');
    return;
  }

  const mode = modal.dataset.pspMode || 'manual';
  const qtyInputMode = modal.querySelector('#production-shift-plan-part')?.dataset.qtyInputMode === '1';
  let plannedPartMinutes = 0;
  let plannedPartQty = 0;
  if (mode === 'manual') {
    const input = modal.querySelector('#production-shift-plan-minutes');
    if (qtyInputMode) {
      const maxQty = Number(input?.getAttribute('max') || 0);
      plannedPartQty = normalizeShiftPlanQtyValue(input?.value, maxQty);
      if (plannedPartQty > 0 && remainingMinutes > 0) {
        plannedPartMinutes = getShiftPlanMinutesForQty(snapshot.minutesPerUnit, plannedPartQty);
        plannedPartMinutes = Math.max(0, Math.min(Math.max(plannedPartMinutes, 1), remainingMinutes));
      }
    } else {
      const rawMinutes = Number(input?.value);
      if (Number.isFinite(rawMinutes) && remainingMinutes > 0) {
        plannedPartMinutes = Math.max(0, Math.min(Math.max(Math.round(rawMinutes), 1), remainingMinutes));
      }
    }
  } else {
    if (qtyInputMode) {
      const fillQty = Math.max(0, Math.floor(Number(modal.querySelector('#production-shift-plan-part')?.dataset.fillQty || 0)));
      plannedPartQty = fillQty;
      plannedPartMinutes = fillQty > 0
        ? Math.max(0, Math.min(Math.max(getShiftPlanMinutesForWholeQty(snapshot.minutesPerUnit, fillQty), 1), remainingMinutes))
        : 0;
    } else {
      plannedPartMinutes = remainingMinutes > 0
        ? normalizeShiftPlanMinutesForSnapshot(remainingMinutes, snapshot, remainingMinutes)
        : 0;
    }
  }

  if (plannedPartMinutes <= 0) {
    if (remainingMinutes === 0) {
      showToast('Операция уже запланирована на 100%');
    } else if (!isSubcontractArea && shiftFreeMinutes === 0) {
      showToast('Смена уже загружена на 100%');
    }
    return;
  }

  const createdBy = currentUser?.name || currentUser?.login || currentUser?.username || '';
  const now = Date.now();

  const op = (card.operations || []).find(item => item.id === routeOpId);
  if (!op) return;
  const abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
  productionShiftPlanSaveAbortController = abortController;
  setProductionShiftPlanSaveState(sessionId, true);
  try {
    assertProductionShiftPlanSessionActive(sessionId);
    const subcontractSelection = await resolveSubcontractPlanningSelection(card, op, snapshot, plannedPartMinutes, plannedPartQty);
    assertProductionShiftPlanSessionActive(sessionId);
    if (isSubcontractAreaById(areaId) && !subcontractSelection) {
      return;
    }
    let taskPlannedQty = isSubcontractAreaById(areaId)
      ? (subcontractSelection?.itemIds?.length || 0)
      : (snapshot.qtyDriven ? plannedPartQty : 0);
    if (isSubcontractAreaById(areaId) && snapshot.qtyDriven) {
      if (!(taskPlannedQty > 0)) {
        showToast('Нет доступных изделий для цепочки субподрядчика.');
        return;
      }
      plannedPartMinutes = getShiftPlanMinutesForQty(snapshot.minutesPerUnit, taskPlannedQty);
      plannedPartQty = taskPlannedQty;
    }
    const totalPlannedQty = isSubcontractAreaById(areaId)
      ? (subcontractSelection?.itemIds?.length || 0)
      : (snapshot.qtyDriven ? snapshot.remainingQty : 0);
    const payload = await commitProductionPlanningChange({
      action: 'add',
      cardId: String(cardId),
      routeOpId: String(routeOpId),
      date: String(date),
      shift: parseInt(shift, 10) || 1,
      areaId: String(areaId),
      plannedPartMinutes,
      plannedPartQty: taskPlannedQty || undefined,
      plannedTotalMinutes: isSubcontractAreaById(areaId) ? plannedPartMinutes : totalMinutes,
      plannedTotalQty: totalPlannedQty || undefined,
      minutesPerUnitSnapshot: snapshot.qtyDriven ? snapshot.minutesPerUnit : undefined,
      remainingQtySnapshot: snapshot.qtyDriven ? snapshot.remainingQty : undefined,
      subcontractItemIds: subcontractSelection?.itemIds || undefined,
      subcontractItemKind: subcontractSelection?.itemKind || undefined,
      createdAt: now,
      createdBy
    }, {
      signal: abortController?.signal
    });
    assertProductionShiftPlanSessionActive(sessionId);
    applyProductionPlanningServerState(payload);
    const newAffectedCells = isSubcontractAreaById(areaId)
      ? (Array.isArray(payload?.tasksForCard) ? payload.tasksForCard : [])
        .filter(task => (
          String(task?.cardId || '') === String(cardId)
          && String(task?.routeOpId || '') === String(routeOpId)
          && String(task?.areaId || '') === String(areaId)
          && Number(task?.createdAt || 0) === now
        ))
        .map(task => ({
          date: String(task?.date || ''),
          shift: parseInt(task?.shift, 10) || 1,
          areaId: String(task?.areaId || '')
        }))
      : [{ date: String(date), shift: parseInt(shift, 10) || 1, areaId: String(areaId) }];
    productionShiftsState.weekStart = preservedWeekStart || productionShiftsState.weekStart;
    productionShiftsState.planWindowStartSlot = preservedPlanWindowStartSlot;
    productionShiftsState.selectedShifts = preservedSelectedShifts;
    saveProductionPlanViewSettings();
    refreshProductionPlanUiAfterMutation({
      cardId,
      affectedCells: newAffectedCells.length ? newAffectedCells : [{ date: String(date), shift: parseInt(shift, 10) || 1, areaId: String(areaId) }]
    });
    planningPerfLog('saveProductionShiftPlan.total', perfStartedAt);
    assertProductionShiftPlanSessionActive(sessionId);
    const qtyLabel = snapshot.qtyDriven && plannedPartQty > 0
      ? ` / ${formatPlanningQtyWithUnit(plannedPartQty, snapshot.unitLabel)}`
      : '';
    if (isSubcontractAreaById(areaId)) {
      closeProductionShiftPlanModal();
    }
    if (payload?.merged) {
      showToast(`Операция объединена: +${plannedPartMinutes} мин${qtyLabel}`);
      return;
    }
    showToast(`Операция добавлена: ${plannedPartMinutes} мин${qtyLabel}`);
  } catch (err) {
    if (isProductionShiftPlanAbortError(err) || err?.isStaleProductionShiftPlanSession) return;
    if (!isProductionShiftPlanSessionActive(sessionId)) return;
    if (showProductionMissingAreaExecutorToasts(err?.blockedAreaNames).length) return;
    showToast(err?.message || 'Не удалось сохранить планирование');
  } finally {
    if (productionShiftPlanSaveAbortController === abortController) {
      productionShiftPlanSaveAbortController = null;
    }
    setProductionShiftPlanSaveState(sessionId, false);
  }
}

async function removeProductionShiftTask(taskId) {
  if (!ensureProductionEditAccess('production-plan')) return;
  const normalizedTaskId = String(taskId || '');
  if (!normalizedTaskId) return;
  const task = (productionShiftTasks || []).find(item => item.id === taskId);
  if (!task) return;
  const card = (cards || []).find(c => c.id === task.cardId);
  const op = (card?.operations || []).find(item => item.id === task.routeOpId);
  if (!canRemoveProductionShiftTaskInShift(task.date, task.shift)) {
    if (isShiftFixed(task.date, task.shift)) {
      showToast('Смена зафиксирована и не может быть изменена');
    } else if (getProductionShiftStatus(task.date, task.shift) === 'OPEN') {
      showToast('В смене "В работе" удаление операций из плана запрещено');
    } else if (getProductionShiftStatus(task.date, task.shift) === 'CLOSED') {
      showToast('В завершённой смене удаление операций из плана запрещено');
    } else {
      showToast('Удалять можно только операции из не начатой смены');
    }
    return;
  }
  if (!op) return;
  if (op.status === 'IN_PROGRESS' || op.status === 'PAUSED') {
    showToast('Нельзя удалить операцию со статусом "В работе" или "Пауза".');
    return;
  }
  const affectedCells = isSubcontractTask(task)
    ? getSubcontractChainTasks(task).map(item => ({
        date: String(item?.date || ''),
        shift: parseInt(item?.shift, 10) || 1,
        areaId: String(item?.areaId || '')
      }))
    : [{
        date: task.date,
        shift: parseInt(task.shift, 10) || 1,
        areaId: String(task.areaId || '')
      }];
  const prevTask = {
    ...task,
    date: task.date,
    shift: task.shift,
    areaId: task.areaId
  };
  try {
    const payload = await commitProductionPlanningChange({
      action: 'delete',
      taskId: normalizedTaskId,
      cardId: String(task.cardId || '')
    });
    applyProductionPlanningServerState(payload);
    refreshProductionPlanUiAfterMutation({
      cardId: task.cardId,
      affectedCells
    });
    showToast('Операция удалена');
  } catch (err) {
    showToast(err?.message || 'Не удалось удалить операцию из плана');
  } finally {
  }
}

async function moveProductionShiftTask(taskId, { date, shift, areaId }) {
  if (!ensureProductionEditAccess('production-plan')) return;
  const perfStartedAt = performance.now();
  const task = (productionShiftTasks || []).find(item => item.id === taskId);
  if (!task) return;
  const card = (cards || []).find(c => c.id === task.cardId);
  const op = (card?.operations || []).find(item => item.id === task.routeOpId) || null;
  const nextDate = String(date || '');
  const nextShift = parseInt(shift, 10) || 1;
  const nextAreaId = String(areaId || '');
  if (!nextDate || !nextAreaId) return;
  if (
    task.date === nextDate &&
    (parseInt(task.shift, 10) || 1) === nextShift &&
    String(task.areaId || '') === nextAreaId
  ) {
    return;
  }
  if (!canDragProductionShiftTask(task, op)) {
    showToast('Перенос возможен только для операций из не начатой смены.');
    return;
  }
  if (!canDropProductionShiftTask(nextDate, nextShift)) {
    if (isShiftFixed(nextDate, nextShift)) {
      showToast('Смена зафиксирована и не может быть изменена');
    } else if (getProductionShiftStatus(nextDate, nextShift) === 'CLOSED') {
      showToast('В завершённую смену перенос запрещён');
    } else {
      showToast('Перенос возможен только в смену "Не начата" или "В работе".');
    }
    return;
  }
  const prevTask = {
    ...task,
    date: task.date,
    shift: task.shift,
    areaId: task.areaId
  };
  try {
    const payload = await commitProductionPlanningChange({
      action: 'move',
      taskId: String(taskId),
      cardId: String(task.cardId || ''),
      date: nextDate,
      shift: nextShift,
      areaId: nextAreaId
    });
    applyProductionPlanningServerState(payload);
    refreshProductionPlanUiAfterMutation({
      cardId: task.cardId,
      affectedCells: [
        { date: prevTask.date, shift: parseInt(prevTask.shift, 10) || 1, areaId: String(prevTask.areaId || '') },
        { date: nextDate, shift: nextShift, areaId: nextAreaId }
      ]
    });
    planningPerfLog('moveProductionShiftTask.total', perfStartedAt);
    if (payload?.merged) {
      showToast('Операция перенесена и объединена');
      return;
    }
    showToast('Операция перенесена');
  } catch (err) {
    showToast(err?.message || 'Не удалось сохранить перенос операции');
  }
}

function getPlannedOpsCountForCard(cardId) {
  const cid = String(cardId ?? '');
  const card = (cards || []).find(item => String(item?.id ?? '') === cid) || null;
  return getPlannableShiftOperations(card?.operations || [])
    .filter(op => isRouteOpPlannedInShifts(cid, op.id))
    .length;
}

function getPlannableOpsCountForCard(card) {
  return getPlannableShiftOperations(card?.operations || []).length;
}

function getProductionPlanOpStatusLabel(status) {
  if (status === 'IN_PROGRESS') return 'В работе';
  if (status === 'PAUSED') return 'Пауза';
  if (status === 'DONE') return 'Завершена';
  if (status === 'NO_ITEMS') return 'Нет изделий/образцов';
  return 'Не начата';
}

function getProductionPlanOpStatusClass(status) {
  if (status === 'IN_PROGRESS') return 'status-in-progress';
  if (status === 'PAUSED') return 'status-paused';
  if (status === 'DONE') return 'status-done';
  if (status === 'NO_ITEMS') return 'status-no-items';
  return 'status-not-started';
}

function canRemoveProductionShiftTaskInShift(dateStr, shift) {
  if (isShiftFixed(dateStr, shift)) return false;
  return getProductionShiftStatus(dateStr, shift) === 'PLANNING';
}

function canRemoveProductionShiftTask(task, op) {
  if (!task || !op) return false;
  if (task?.closePagePreview === true) return false;
  if (isSubcontractTask(task)) {
    const meta = getSubcontractChainMeta(task);
    if (!meta.isFirst && !meta.isLast) return false;
  }
  if (!canRemoveProductionShiftTaskInShift(task.date, task.shift)) return false;
  return op.status !== 'IN_PROGRESS' && op.status !== 'PAUSED';
}

function buildProductionPlanOpSummary(card, op) {
  if (!card || !op) return '';

  if (isMaterialIssueOperation(op)) {
    const entry = (card.materialIssues || []).find(item => (item?.opId || '') === op.id) || null;
    const hasMaterials = Array.isArray(entry?.items) && entry.items.length > 0;
    return `<span class="production-op-summary-token op-items-summary-material${hasMaterials ? ' is-done' : ''}">МВ: ${hasMaterials ? 'да' : 'нет'}</span>`;
  }

  if (isDryingOperation(op)) {
    const dryingRows = typeof buildDryingRows === 'function' ? buildDryingRows(card, op) : [];
    const hasDryPowder = dryingRows.some(row => (row?.status || '') === 'DONE');
    return `<span class="production-op-summary-token op-items-summary-material${hasDryPowder ? ' is-done' : ''}">П: ${hasDryPowder ? 'да' : 'нет'}</span>`;
  }

  if (isMaterialReturnOperation(op)) {
    const isDone = op.status === 'DONE';
    return `<span class="production-op-summary-token op-items-summary-material${isDone ? ' is-done' : ''}">МС: ${isDone ? 'да' : 'нет'}</span>`;
  }

  ensureProductionFlow(card);
  const itemsOnOp = typeof getFlowItemsForOperation === 'function'
    ? getFlowItemsForOperation(card, op).filter(item => !isFlowItemDisposed(item))
    : [];
  const stats = typeof getOperationExecutionStats === 'function'
    ? getOperationExecutionStats(card, op)
    : { pendingOnOp: 0, awaiting: 0, good: 0, defect: 0, delayed: 0, onOpTotal: itemsOnOp.length, completed: 0 };
  const normalizeSample = typeof normalizeSampleType === 'function'
    ? normalizeSampleType
    : (value) => ((value || '').toString().trim().toUpperCase() === 'WITNESS' ? 'WITNESS' : 'CONTROL');
  const kindLabel = op.isSamples
    ? (normalizeSample(op.sampleType) === 'WITNESS' ? 'ОС' : 'ОК')
    : 'ИЗ';
  const toExecute = Math.max(0, stats.pendingOnOp || 0);
  const awaiting = Math.max(0, stats.awaiting || 0);
  const defect = Math.max(0, stats.defect || 0);
  const delayed = Math.max(0, stats.delayed || 0);
  return [
    '<span class="production-op-summary-token production-op-summary-flow">',
    `<span class="production-op-summary-label${op.isSamples ? ' op-items-kind-samples' : ''}">${escapeHtml(kindLabel)}:</span>`,
    `<span class="production-op-summary-main">${escapeHtml(String(toExecute))}</span>`,
    '<span class="production-op-summary-sep">/</span>',
    `<span class="production-op-summary-done op-items-summary-done">${escapeHtml(String(stats.good || 0))}</span>`,
    '<span class="production-op-summary-sep">/</span>',
    `<span class="production-op-summary-awaiting">${escapeHtml(String(awaiting))}</span>`,
    '<span class="production-op-summary-sep">/</span>',
    `<span class="production-op-summary-defect op-items-summary-defect op-item-status-defect">${escapeHtml(String(defect))}</span>`,
    '<span class="production-op-summary-sep">/</span>',
    `<span class="production-op-summary-delayed op-items-summary-delayed op-item-status-delayed">${escapeHtml(String(delayed))}</span>`,
    '</span>'
  ].join('');
}

function buildProductionPlanOpMeta(card, op, { plannedLabel = '', extraMeta = '', hideStatus = false, shiftDate = '', shiftNumber = null, shiftFactPlannedQtyText = '', summaryHtmlOverride = '' } = {}) {
  if (!op) return '';
  if (card?.archived) {
    return `
      <div class="production-op-meta-wrap">
        <span class="production-op-archived">В Архиве</span>
      </div>
    `;
  }
  const status = op.status || 'NOT_STARTED';
  const summaryHtml = (
    summaryHtmlOverride
    || (
      shiftDate
      && Number.isFinite(parseInt(shiftNumber, 10))
      && isHistoricalPlanningShift(shiftDate, shiftNumber)
      && !isMaterialIssueOperation(op)
      && !isMaterialReturnOperation(op)
      && !isDryingOperation(op)
    )
  )
    ? (summaryHtmlOverride || buildProductionShiftFactSummary(card, op, shiftDate, shiftNumber, { plannedQtyText: shiftFactPlannedQtyText }))
    : buildProductionPlanOpSummary(card, op);
  const statusClass = getProductionPlanOpStatusClass(status);
  const statusLabel = getProductionPlanOpStatusLabel(status);
  const plannedHtml = plannedLabel
    ? `<span class="production-op-meta-token production-op-meta-planned">${escapeHtml(plannedLabel)}</span>`
    : '';
  const extraHtml = extraMeta
    ? `<span class="production-op-meta-token production-op-meta-extra">${escapeHtml(extraMeta)}</span>`
    : '';
  const statusHtml = hideStatus
    ? ''
    : `<span class="badge production-op-status ${statusClass}">${escapeHtml(statusLabel)}</span>`;
  return `
    <div class="production-op-meta-wrap">
      ${plannedHtml}
      ${extraHtml}
      ${statusHtml}
      ${summaryHtml}
    </div>
  `;
}

function buildProductionPlanOpTitle(op) {
  if (!op) return '';
  const code = trimToString(op.opCode || op.code || '');
  const name = trimToString(op.opName || op.name || '');
  return escapeHtml([code, name].filter(Boolean).join(' '));
}

function buildProductionPlanCardLine(label) {
  const text = trimToString(label || '');
  return text
    ? `<div class="production-shift-task-card">${escapeHtml(text)}</div>`
    : '';
}

function getProductionPlanHistoricalReplannedQty(row) {
  const cardId = String(row?.cardId || '');
  const routeOpId = String(row?.routeOpId || '');
  const rowDate = String(row?.date || '');
  const rowShift = parseInt(row?.shift, 10) || 1;
  const snapshotSavedAt = Number(row?.snapshotSavedAt || 0);
  if (!cardId || !routeOpId || !rowDate || !(snapshotSavedAt > 0)) return 0;
  return roundPlanningQty((productionShiftTasks || []).reduce((sum, task) => {
    if (String(task?.cardId || '') !== cardId) return sum;
    if (String(task?.routeOpId || '') !== routeOpId) return sum;
    if (String(task?.date || '') !== rowDate) return sum;
    if ((parseInt(task?.shift, 10) || 1) !== rowShift) return sum;
    if (!shouldCountTaskInPlanningCoverage(task)) return sum;
    if (!(Number(task?.createdAt || 0) > snapshotSavedAt)) return sum;
    return sum + Math.max(0, getTaskPlannedQuantity(task));
  }, 0));
}

function getProductionPlanHistoricalTaskStyle(row) {
  if (!row) return '';
  const plannedQty = Math.max(0, Number(row?.plannedQty || 0));
  const goodQty = Math.max(0, Number(row?.shiftFactGood || 0));
  const delayedQty = Math.max(0, Number(row?.shiftFactDelayed || 0));
  const defectQty = Math.max(0, Number(row?.shiftFactDefect || 0));
  const executedQty = Math.max(0, roundPlanningQty(goodQty + delayedQty + defectQty));
  const visualBaseQty = Math.max(plannedQty, executedQty);
  if (!(visualBaseQty > 0)) return '';
  const segments = getPlanningFillSegments(visualBaseQty, {
    goodMinutes: goodQty,
    delayedMinutes: delayedQty,
    defectMinutes: defectQty
  });
  const coveredEnd = Math.max(
    Number(segments?.goodEnd || 0),
    Number(segments?.delayedEnd || 0),
    Number(segments?.defectEnd || 0)
  );
  const baseHistoricalUnresolvedQty = row?.isQtyDriven
    ? Math.max(0, roundPlanningQty(plannedQty - executedQty))
    : 0;
  const replannedQtyAfterSnapshot = row?.isQtyDriven
    ? getProductionPlanHistoricalReplannedQty(row)
    : 0;
  const visibleHistoricalUnresolvedQty = row?.isQtyDriven
    ? Math.max(0, roundPlanningQty(baseHistoricalUnresolvedQty - replannedQtyAfterSnapshot))
    : 0;
  const historicalRemainingEnd = clampPlanningPercent(
    coveredEnd + ((visibleHistoricalUnresolvedQty / visualBaseQty) * 100)
  );
  if (!(coveredEnd > 0) && !(historicalRemainingEnd > coveredEnd)) return '';
  return [
    getPlanningFillStyleVars(coveredEnd, segments),
    `--history-remaining-start:${clampPlanningPercent(coveredEnd)}%`,
    `--history-remaining-end:${historicalRemainingEnd}%`
  ].join('; ');
}

function getProductionPlanHistoricalExecutionStyle(row) {
  if (!row) return '';
  const plannedQty = Math.max(0, Number(row?.plannedQty || 0));
  const goodQty = Math.max(0, Number(row?.shiftFactGood || 0));
  const delayedQty = Math.max(0, Number(row?.shiftFactDelayed || 0));
  const defectQty = Math.max(0, Number(row?.shiftFactDefect || 0));
  const executedQty = Math.max(0, roundPlanningQty(goodQty + delayedQty + defectQty));
  const visualBaseQty = Math.max(plannedQty, executedQty);
  if (!(visualBaseQty > 0)) return '';
  const segments = getPlanningFillSegments(visualBaseQty, {
    goodMinutes: goodQty,
    delayedMinutes: delayedQty,
    defectMinutes: defectQty
  });
  return getPlanningExecutionOnlyStyleVars(segments);
}

function formatProductionHistoricalPlannedLabel(row, op) {
  if (!row) return '';
  const plannedMinutes = Math.max(0, roundPlanningMinutes(Number(row?.plannedMinutes || 0)));
  const plannedQty = Math.max(0, roundPlanningQty(Number(row?.plannedQty || 0)));
  if (plannedQty > 0 && plannedMinutes > 0) {
    return `${formatPlanningQtyWithUnit(plannedQty, getPlanningUnitLabel(op || row))} / ${plannedMinutes} мин`;
  }
  if (plannedQty > 0) {
    return `${formatPlanningQtyWithUnit(plannedQty, getPlanningUnitLabel(op || row))}`;
  }
  if (plannedMinutes > 0) {
    return `${plannedMinutes} мин`;
  }
  const fallback = String(row?.planDisplay || '').trim();
  if (!fallback || fallback === '—' || fallback === '-') return '';
  return fallback;
}

function buildProductionPlanHistoricalMeta(card, op, row, { hideStatus = false } = {}) {
  const plannedLabel = formatProductionHistoricalPlannedLabel(row, op);
  const summaryHtml = buildProductionShiftFactSummaryFromStats(op || row, {
    total: row?.shiftFactTotal,
    good: row?.shiftFactGood,
    delayed: row?.shiftFactDelayed,
    defect: row?.shiftFactDefect
  });
  return buildProductionPlanOpMeta(card, op || row, {
    plannedLabel: plannedLabel ? `План: ${plannedLabel}` : '',
    extraMeta: String(row?.resolutionText || '').trim(),
    hideStatus,
    summaryHtmlOverride: summaryHtml
  });
}

function getProductionHistoricalRowsForShift(dateStr, shift) {
  const record = ensureProductionShift(dateStr, shift, { reason: 'data' });
  const snapshot = getProductionShiftCloseSnapshot(record);
  const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
  const snapshotSavedAt = Number(snapshot?.savedAt || snapshot?.closedAt || 0);
  return rows.map(row => ({ ...row, snapshotSavedAt }));
}

function getProductionPlanHistoricalRowsForCell(dateStr, shift, areaId) {
  return getProductionHistoricalRowsForShift(dateStr, shift)
    .filter(row => String(row?.areaId || '') === String(areaId || ''));
}

const PRODUCTION_GANTT_KIND_COLORS = {
  ITEM: '#16a34a',
  CONTROL: '#2563eb',
  WITNESS: '#7c3aed',
  DRYING: '#eab308',
  GATE: '#111827',
  CONFLICT: '#dc2626'
};

const PRODUCTION_GANTT_ROW_HEIGHT = 82;
const PRODUCTION_GANTT_BAR_HEIGHT = 40;
const PRODUCTION_GANTT_HEADER_HEIGHT = 56;
const PRODUCTION_GANTT_ZOOM_STEPS = [0.05, 0.1, 0.15, 0.25, 0.35, 0.45, 0.55, 0.75, 1, 1.25, 1.5, 1.75, 2];

function getProductionGanttFlowKind(op) {
  if (!op) return 'ITEM';
  if (isDryingOperation(op)) return 'DRYING';
  if (Boolean(op.isSamples)) {
    return normalizeSampleType(op.sampleType) === 'WITNESS' ? 'WITNESS' : 'CONTROL';
  }
  return 'ITEM';
}

function getProductionGanttFlowLabel(kind) {
  if (kind === 'CONTROL') return 'ОК';
  if (kind === 'WITNESS') return 'ОС';
  if (kind === 'DRYING') return 'Сушка';
  return 'Изделия';
}

function getProductionGanttColor(kind, { gate = false, conflict = false } = {}) {
  if (conflict) return PRODUCTION_GANTT_KIND_COLORS.CONFLICT;
  if (gate) return PRODUCTION_GANTT_KIND_COLORS.GATE;
  return PRODUCTION_GANTT_KIND_COLORS[kind] || PRODUCTION_GANTT_KIND_COLORS.ITEM;
}

function parseProductionGanttRoutePath(path) {
  const cleanPath = String(path || '').split('?')[0].split('#')[0];
  const match = cleanPath.match(/^\/production\/gantt\/([^/]+)\/?$/);
  if (!match) return null;
  const cardKey = decodeURIComponent(match[1] || '').trim();
  return cardKey ? { cardKey, cleanPath } : null;
}

function getProductionGanttCanonicalKey(card) {
  const qrId = normalizeQrId(card?.qrId);
  if (qrId && isValidScanId(qrId)) return qrId;
  return trimToString(card?.id);
}

function getProductionGanttPath(card) {
  const cardKey = getProductionGanttCanonicalKey(card);
  return cardKey ? `/production/gantt/${encodeURIComponent(cardKey)}` : '/production/plan';
}

function findProductionGanttCard(routePath = '') {
  const parsed = parseProductionGanttRoutePath(routePath || window.location.pathname || '');
  if (!parsed) return null;
  const requestedKey = parsed.cardKey;
  const normalizedQr = normalizeQrId(requestedKey);
  let card = null;
  if (normalizedQr && isValidScanId(normalizedQr)) {
    card = (cards || []).find(item => !item?.archived && normalizeQrId(item?.qrId) === normalizedQr) || null;
  }
  if (!card) {
    card = (cards || []).find(item => !item?.archived && trimToString(item?.id) === requestedKey) || null;
  }
  if (!card && normalizedQr) {
    card = (cards || []).find(item => !item?.archived && trimToString(item?.id) === normalizedQr) || null;
  }
  if (!card) return null;
  return {
    card,
    requestedKey,
    canonicalKey: getProductionGanttCanonicalKey(card),
    canonicalPath: getProductionGanttPath(card)
  };
}

function getProductionGanttTsFromDateMinutes(dateStr, minutes = 0) {
  const base = new Date(`${String(dateStr || '').trim()}T00:00:00`);
  if (Number.isNaN(base.getTime())) return 0;
  base.setMinutes(Number(minutes) || 0);
  return base.getTime();
}

function getProductionGanttTaskWindow(task) {
  const exactStart = Number(task?.plannedStartAt);
  const exactEnd = Number(task?.plannedEndAt);
  if (Number.isFinite(exactStart) && exactStart > 0 && Number.isFinite(exactEnd) && exactEnd > exactStart) {
    return {
      startAt: exactStart,
      endAt: exactEnd,
      exactTime: true
    };
  }
  const date = trimToString(task?.date);
  if (!date) {
    return {
      startAt: 0,
      endAt: 0,
      exactTime: false
    };
  }
  const shift = parseInt(task?.shift, 10) || 1;
  const range = getShiftRange(shift);
  return {
    startAt: getProductionGanttTsFromDateMinutes(date, range.start),
    endAt: getProductionGanttTsFromDateMinutes(date, range.end),
    exactTime: false
  };
}

function getProductionGanttTaskSortStart(task) {
  return getProductionGanttTaskWindow(task).startAt || 0;
}

function formatProductionGanttTime(ts) {
  if (!Number.isFinite(ts) || ts <= 0) return '—';
  const date = new Date(ts);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatProductionGanttDateShift(task) {
  const date = trimToString(task?.date);
  const shift = parseInt(task?.shift, 10) || 1;
  if (!date) return '—';
  return `${formatProductionDisplayDate(date)} / смена ${shift}`;
}

function getProductionGanttAllowedAreaIds(routeOperation) {
  if (!routeOperation) return [];
  const refOpId = trimToString(routeOperation.opId);
  const refOp = refOpId ? (ops || []).find(item => trimToString(item?.id) === refOpId) : null;
  const allowed = new Set();
  if (Array.isArray(refOp?.allowedAreaIds)) {
    refOp.allowedAreaIds.forEach(item => {
      const id = trimToString(item);
      if (id) allowed.add(id);
    });
  }
  if (!allowed.size && Array.isArray(routeOperation.allowedAreaIds)) {
    routeOperation.allowedAreaIds.forEach(item => {
      const id = trimToString(item);
      if (id) allowed.add(id);
    });
  }
  return Array.from(allowed);
}

function getProductionGanttRequiredQtyLabel(fragment, op) {
  const existing = trimToString(fragment?.qtyLabel);
  if (existing) return existing;
  return formatPlanningQtyWithUnit(0, getPlanningUnitLabel(op || fragment?.task));
}

function getProductionGanttBarMinWidth(op, qtyLabel) {
  const code = trimToString(op?.opCode || op?.code || '000');
  const qty = trimToString(qtyLabel || formatPlanningQtyWithUnit(0, getPlanningUnitLabel(op)));
  const longestLine = Math.max(code.length, qty.length);
  const baseWidth = Math.max(112, 24 + (longestLine * 7));
  return Math.max(getProductionGanttBarWidthFloor(false), Math.round(baseWidth * getProductionGanttBarScaleFactor()));
}

function getProductionGanttBarScaleFactor() {
  const zoom = getProductionGanttZoomFactor();
  if (zoom <= 0.025) return 0.12;
  if (zoom <= 0.05) return 0.16;
  if (zoom <= 0.15) return 0.22;
  if (zoom <= 0.25) return 0.3;
  if (zoom <= 0.55) return 0.45;
  if (zoom <= 0.75) return 0.62;
  return 1;
}

function getProductionGanttBarWidthFloor(exactTime = false) {
  const zoom = getProductionGanttZoomFactor();
  if (zoom <= 0.025) return exactTime ? 8 : 18;
  if (zoom <= 0.05) return exactTime ? 10 : 22;
  if (zoom <= 0.15) return exactTime ? 12 : 28;
  if (zoom <= 0.25) return exactTime ? 16 : 40;
  if (zoom <= 0.55) return exactTime ? 28 : 68;
  if (zoom <= 0.75) return exactTime ? 42 : 96;
  return exactTime ? 72 : 148;
}

function getProductionGanttSlotWidthFloor() {
  const zoom = getProductionGanttZoomFactor();
  if (zoom <= 0.025) return 14;
  if (zoom <= 0.05) return 22;
  if (zoom <= 0.15) return 34;
  if (zoom <= 0.25) return 52;
  if (zoom <= 0.55) return 96;
  if (zoom <= 0.75) return 156;
  return 240;
}

function getProductionGanttTimelineWidthFloor() {
  const zoom = getProductionGanttZoomFactor();
  if (zoom <= 0.025) return 120;
  if (zoom <= 0.05) return 160;
  if (zoom <= 0.15) return 220;
  if (zoom <= 0.25) return 300;
  if (zoom <= 0.55) return 420;
  if (zoom <= 0.75) return 520;
  return 640;
}

function buildProductionGanttFlowStatsLabel(row) {
  return [
    `${getProductionGanttFlowLabel(row?.flowKind)}: ${Math.max(0, Number(row?.stats?.pendingOnOp || 0)) + Math.max(0, Number(row?.stats?.awaiting || 0))}`,
    `Годно: ${Math.max(0, Number(row?.stats?.good || 0))}`,
    `Брак: ${Math.max(0, Number(row?.stats?.defect || 0))}`,
    `Задержано: ${Math.max(0, Number(row?.stats?.delayed || 0))}`
  ].join(' / ');
}

function canStartInAutoPlanByWorkspaceRules(op) {
  if (!op) return false;
  if (op.canStart === true) return true;
  if (!isDryingOperation(op)) return false;
  const reasons = Array.isArray(op.blockedReasons)
    ? op.blockedReasons.map(item => trimToString(item)).filter(Boolean)
    : [];
  if (!reasons.length) return true;
  return reasons.every(reason => reason === 'Нет выданного порошка для сушки.');
}

function buildProductionGanttDependencyMeta(card) {
  const states = getPlannableShiftOperations(card?.operations || []).map(op => ({
    op,
    flowKind: getProductionGanttFlowKind(op),
    workspaceCanStartNow: canStartInAutoPlanByWorkspaceRules(op),
    qtySourceOpId: '',
    gatingOpIds: [],
    gatingReasons: new Map()
  }));

  states.forEach((state, index) => {
    const prevStates = states.slice(0, index);
    const prevItem = [...prevStates].reverse().find(item => item?.flowKind === 'ITEM') || null;
    const prevControl = [...prevStates].reverse().find(item => item?.flowKind === 'CONTROL') || null;
    const prevWitness = [...prevStates].reverse().find(item => item?.flowKind === 'WITNESS') || null;
    const prevDrying = [...prevStates].reverse().find(item => item?.flowKind === 'DRYING') || null;
    const prevSample = [...prevStates].reverse().find(item => item?.flowKind === 'CONTROL' || item?.flowKind === 'WITNESS') || null;
    const gating = [];
    const pushGate = (depState, reason) => {
      const depId = trimToString(depState?.op?.id);
      if (!depId || gating.includes(depId)) return;
      gating.push(depId);
      state.gatingReasons.set(depId, trimToString(reason));
    };

    if (state.flowKind === 'ITEM') {
      state.qtySourceOpId = trimToString(prevItem?.op?.id);
      if (prevSample) pushGate(prevSample, 'Есть незавершенные образцы на предыдущих операциях.');
      if (prevDrying) pushGate(prevDrying, 'Предыдущая операция «Сушка» не завершена.');
    } else if (state.flowKind === 'CONTROL') {
      state.qtySourceOpId = trimToString(prevControl?.op?.id);
      if (prevControl) pushGate(prevControl, 'Не все ОК на предыдущей операции имеют статус «Годно».');
    } else if (state.flowKind === 'WITNESS') {
      state.qtySourceOpId = trimToString(prevWitness?.op?.id);
      if (prevItem) pushGate(prevItem, 'Есть незавершенные изделия на предыдущих операциях.');
      if (prevSample) pushGate(prevSample, 'Есть незавершенные образцы на предыдущих операциях.');
      if (prevDrying) pushGate(prevDrying, 'Предыдущая операция «Сушка» не завершена.');
    } else if (state.flowKind === 'DRYING') {
      if (prevItem) pushGate(prevItem, 'Предыдущая операция ещё не завершена.');
    }
    state.gatingOpIds = gating;
  });

  const byOpId = new Map(states.map(state => [trimToString(state?.op?.id), state]));
  return { states, byOpId };
}

function buildProductionGanttRows(card, dependencyMeta) {
  const tasks = getVisibleProductionShiftTasks()
    .filter(task => trimToString(task?.cardId) === trimToString(card?.id))
    .sort((a, b) => getProductionGanttTaskSortStart(a) - getProductionGanttTaskSortStart(b));
  const tasksByOpId = new Map();
  tasks.forEach(task => {
    const key = trimToString(task?.routeOpId);
    if (!key) return;
    if (!tasksByOpId.has(key)) tasksByOpId.set(key, []);
    tasksByOpId.get(key).push(task);
  });

  return getPlannableShiftOperations(card?.operations || []).map((op, rowIndex) => {
    const opTasks = (tasksByOpId.get(trimToString(op?.id)) || []).slice().sort((a, b) => getProductionGanttTaskSortStart(a) - getProductionGanttTaskSortStart(b));
    const snapshot = getOperationPlanningSnapshot(card.id, op.id);
    const stats = typeof collectOpFlowStats === 'function'
      ? collectOpFlowStats(card, op)
      : { pendingOnOp: 0, awaiting: 0, good: 0, defect: 0, delayed: 0 };
    const areas = Array.from(new Set(opTasks.map(task => getPlanningTaskAreaName(task.areaId)).filter(Boolean)));
    const flowKind = getProductionGanttFlowKind(op);
    const depState = dependencyMeta.byOpId.get(trimToString(op?.id)) || null;
    const fragments = opTasks.map((task, fragmentIndex) => {
      const windowRef = getProductionGanttTaskWindow(task);
      const plannedQty = getTaskPlannedQuantity(task);
      const plannedMinutes = getTaskPlannedMinutes(task);
      const areaName = getPlanningTaskAreaName(task.areaId);
      const flowStatsLabel = buildProductionGanttFlowStatsLabel({ flowKind, stats });
      return {
        id: trimToString(task?.id) || `${trimToString(op?.id)}_${fragmentIndex + 1}`,
        task,
        rowIndex,
        opId: trimToString(op?.id),
        flowKind,
        planningMode: isAutoProductionShiftTask(task) ? 'AUTO' : 'MANUAL',
        areaId: trimToString(task?.areaId),
        areaName,
        startAt: windowRef.startAt,
        endAt: windowRef.endAt,
        exactTime: windowRef.exactTime,
        plannedQty,
        plannedMinutes,
        qtyLabel: plannedQty > 0 ? formatPlanningQtyWithUnit(plannedQty, getPlanningUnitLabel(op)) : '',
        timeLabel: windowRef.startAt > 0 && windowRef.endAt > 0
          ? `${formatProductionGanttTime(windowRef.startAt)}–${formatProductionGanttTime(windowRef.endAt)}`
          : formatProductionGanttDateShift(task),
        titleParts: [
          trimToString([op?.opCode, op?.opName].filter(Boolean).join(' ')),
          areaName ? `Участок: ${areaName}` : '',
          windowRef.exactTime
            ? `Время: ${formatProductionGanttTime(windowRef.startAt)}–${formatProductionGanttTime(windowRef.endAt)}`
            : `Окно: ${formatProductionGanttDateShift(task)}`,
          plannedQty > 0 ? `Партия: ${formatPlanningQtyWithUnit(plannedQty, getPlanningUnitLabel(op))}` : '',
          plannedMinutes > 0 ? `План: ${roundPlanningMinutes(plannedMinutes)} мин` : '',
          flowStatsLabel,
          isAutoProductionShiftTask(task) ? 'Автоплан' : 'Ручное размещение'
        ].filter(Boolean)
      };
    });
    return {
      rowIndex,
      op,
      flowKind,
      dependency: depState,
      snapshot,
      stats,
      tasks: opTasks,
      fragments,
      areaNames: areas,
      isManual: fragments.some(fragment => fragment.planningMode === 'MANUAL'),
      isAuto: fragments.some(fragment => fragment.planningMode === 'AUTO'),
      isConflict: false,
      conflictReasons: []
    };
  });
}

function detectProductionGanttConflicts(card, rows, dependencyMeta) {
  const lastEndByOpId = new Map();
  rows.forEach(row => {
    const endAt = row.fragments.reduce((max, fragment) => Math.max(max, Number(fragment?.endAt) || 0), 0);
    if (endAt > 0) lastEndByOpId.set(trimToString(row?.op?.id), endAt);
  });

  const comments = [];

  rows.forEach(row => {
    const opLabel = trimToString([row?.op?.opCode, row?.op?.opName].filter(Boolean).join(' '));
    const state = dependencyMeta.byOpId.get(trimToString(row?.op?.id)) || null;
    const depIds = Array.from(new Set([
      trimToString(state?.qtySourceOpId),
      ...((Array.isArray(state?.gatingOpIds) ? state.gatingOpIds : []).map(item => trimToString(item)))
    ].filter(Boolean)));
    const readyAt = depIds.reduce((max, depId) => Math.max(max, Number(lastEndByOpId.get(depId)) || 0), 0);
    const missingDeps = depIds.filter(depId => !lastEndByOpId.get(depId));
    const allowedAreaIds = getProductionGanttAllowedAreaIds(row.op);

    row.fragments.forEach(fragment => {
      const reasons = [];
      if (allowedAreaIds.length && fragment.areaId && !allowedAreaIds.includes(fragment.areaId)) {
        const areaName = fragment.areaName || fragment.areaId;
        reasons.push(`участок ${areaName} не входит в допустимые для операции`);
      }
      if (readyAt > 0 && fragment.startAt > 0 && fragment.startAt < readyAt) {
        reasons.push(`старт ${formatProductionGanttTime(fragment.startAt)} раньше разрешённого flow ${formatProductionGanttTime(readyAt)}`);
      }
      if (!fragment.exactTime && fragment.planningMode === 'MANUAL' && depIds.length && (missingDeps.length || readyAt <= 0)) {
        reasons.push('ручное размещение без подтвержденного времени выпуска предыдущих операций');
      }
      if (fragment.planningMode === 'MANUAL' && missingDeps.length && !reasons.length) {
        reasons.push('ручное размещение опирается на неполный поток предыдущих операций');
      }
      if (reasons.length) {
        fragment.isConflict = true;
        fragment.conflictReason = reasons.join('; ');
        row.isConflict = true;
        row.conflictReasons.push(...reasons);
      } else {
        fragment.isConflict = false;
        fragment.conflictReason = '';
      }

      if (fragment.planningMode === 'MANUAL') {
        comments.push(`Операция ${opLabel} запланирована вручную: ${formatProductionGanttDateShift(fragment.task)}${fragment.areaName ? `, участок ${fragment.areaName}` : ''}.`);
      }
      if (fragment.isConflict) {
        comments.push(`Операция ${opLabel} противоречит правилам планирования: ${fragment.conflictReason}.`);
      }
    });

    row.conflictReasons = Array.from(new Set(row.conflictReasons.filter(Boolean)));
  });

  if (!comments.length) {
    comments.push('Текущий план не противоречит flow по доступным данным.');
  }
  return { rows, comments };
}

function buildProductionGanttTimelineRange(rows) {
  const timestamps = [];
  rows.forEach(row => {
    row.fragments.forEach(fragment => {
      if (fragment.startAt > 0) timestamps.push(fragment.startAt);
      if (fragment.endAt > 0) timestamps.push(fragment.endAt);
    });
  });
  if (!timestamps.length) {
    const date = formatProductionDate(new Date());
    const shift = getCurrentProductionShiftNumber();
    const range = getShiftRange(shift);
    return {
      startAt: getProductionGanttTsFromDateMinutes(date, range.start),
      endAt: getProductionGanttTsFromDateMinutes(date, range.end)
    };
  }
  const minTs = Math.min(...timestamps);
  const maxTs = Math.max(...timestamps);
  const firstFragment = rows.flatMap(row => row.fragments).sort((a, b) => a.startAt - b.startAt)[0] || null;
  if (firstFragment?.task?.date) {
    const shiftRange = getShiftRange(parseInt(firstFragment.task.shift, 10) || 1);
    const shiftStartAt = getProductionGanttTsFromDateMinutes(firstFragment.task.date, shiftRange.start);
    const shiftEndAt = getProductionGanttTsFromDateMinutes(firstFragment.task.date, shiftRange.end);
    return {
      startAt: Math.min(minTs, shiftStartAt),
      endAt: Math.max(maxTs, shiftEndAt)
    };
  }
  return { startAt: minTs, endAt: maxTs };
}

function getProductionGanttMinuteWidth(totalMinutes) {
  if (totalMinutes <= 12 * 60) return 3.4;
  if (totalMinutes <= 24 * 60) return 2.3;
  if (totalMinutes <= 48 * 60) return 1.45;
  if (totalMinutes <= 96 * 60) return 1;
  return 0.72;
}

function getProductionGanttZoomFactor() {
  const zoom = Number(productionGanttState.zoom);
  return PRODUCTION_GANTT_ZOOM_STEPS.includes(zoom) ? zoom : 1;
}

function getProductionGanttZoomIndex() {
  return Math.max(0, PRODUCTION_GANTT_ZOOM_STEPS.indexOf(getProductionGanttZoomFactor()));
}

function getProductionGanttGridDensityConfig() {
  const zoom = getProductionGanttZoomFactor();
  if (zoom <= 0.025) {
    return {
      quarterFactor: 16,
      hourFactor: 12,
      hourMarkerStepHours: 12
    };
  }
  if (zoom <= 0.05) {
    return {
      quarterFactor: 12,
      hourFactor: 8,
      hourMarkerStepHours: 8
    };
  }
  if (zoom <= 0.15) {
    return {
      quarterFactor: 8,
      hourFactor: 6,
      hourMarkerStepHours: 6
    };
  }
  if (zoom <= 0.25) {
    return {
      quarterFactor: 4,
      hourFactor: 4,
      hourMarkerStepHours: 4
    };
  }
  if (zoom <= 0.55) {
    return {
      quarterFactor: 2,
      hourFactor: 2,
      hourMarkerStepHours: 2
    };
  }
  return {
    quarterFactor: 1,
    hourFactor: 1,
    hourMarkerStepHours: 1
  };
}

function buildProductionGanttVisibleSlots(rows) {
  const slotMap = new Map();
  rows.forEach(row => {
    row.fragments.forEach(fragment => {
      const date = trimToString(fragment?.task?.date);
      const shift = parseInt(fragment?.task?.shift, 10) || 1;
      if (!date) return;
      const key = `${date}|${shift}`;
      if (slotMap.has(key)) return;
      const range = getShiftRange(shift);
      slotMap.set(key, {
        key,
        date,
        shift,
        startAt: getProductionGanttTsFromDateMinutes(date, range.start),
        endAt: getProductionGanttTsFromDateMinutes(date, range.end),
        durationMinutes: Math.max(1, range.end - range.start)
      });
    });
  });
  const slots = Array.from(slotMap.values()).sort((a, b) => {
    if (a.startAt === b.startAt) return a.shift - b.shift;
    return a.startAt - b.startAt;
  });
  let prevDate = '';
  return slots.map(slot => {
    const isFirstInDate = slot.date !== prevDate;
    prevDate = slot.date;
    return {
      ...slot,
      isFirstInDate
    };
  });
}

function buildProductionGanttSlotLayout(rows) {
  const visibleSlots = buildProductionGanttVisibleSlots(rows);
  if (!visibleSlots.length) {
    const date = formatProductionDate(new Date());
    const shift = getCurrentProductionShiftNumber();
    const range = getShiftRange(shift);
    visibleSlots.push({
      key: `${date}|${shift}`,
      date,
      shift,
      startAt: getProductionGanttTsFromDateMinutes(date, range.start),
      endAt: getProductionGanttTsFromDateMinutes(date, range.end),
      durationMinutes: Math.max(1, range.end - range.start),
      isFirstInDate: true
    });
  }
  const totalVisibleMinutes = visibleSlots.reduce((sum, slot) => sum + slot.durationMinutes, 0);
  const minuteWidth = getProductionGanttMinuteWidth(totalVisibleMinutes) * getProductionGanttZoomFactor();
  const slotWidthFloor = getProductionGanttSlotWidthFloor();
  let cursor = 0;
  const positionedSlots = visibleSlots.map(slot => {
    const width = Math.max(slotWidthFloor, Math.round(slot.durationMinutes * minuteWidth));
    const positioned = {
      ...slot,
      left: cursor,
      width
    };
    cursor += width;
    return positioned;
  });
  const slotByKey = new Map(positionedSlots.map(slot => [slot.key, slot]));
  const slotEndLeft = cursor;
  const positionAt = (ts, taskDate = '', taskShift = 1) => {
    const slot = slotByKey.get(`${taskDate}|${parseInt(taskShift, 10) || 1}`) || positionedSlots[0];
    if (!slot) return 0;
    if (!Number.isFinite(ts) || ts <= 0) return slot.left;
    const clampedTs = Math.max(slot.startAt, Math.min(slot.endAt, ts));
    const minutesFromStart = Math.max(0, (clampedTs - slot.startAt) / 60000);
    return slot.left + (minutesFromStart * minuteWidth);
  };
  return {
    visibleSlots: positionedSlots,
    slotByKey,
    totalVisibleMinutes,
    minuteWidth,
    timelineWidth: Math.max(getProductionGanttTimelineWidthFloor(), slotEndLeft),
    quarterWidth: 15 * minuteWidth,
    hourWidth: 60 * minuteWidth,
    positionAt
  };
}

function buildProductionGanttLinks(viewModel) {
  const rowByOpId = new Map(viewModel.rows.map(row => [trimToString(row?.op?.id), row]));
  const links = [];

  const createQtyLinks = (sourceRow, targetRow, color) => {
    if (!sourceRow || !targetRow) return;
    const sources = sourceRow.fragments.slice().sort((a, b) => (a.endAt - b.endAt) || (a.startAt - b.startAt));
    const targets = targetRow.fragments.slice().sort((a, b) => (a.startAt - b.startAt) || (a.endAt - b.endAt));
    if (!sources.length || !targets.length) return;

    const remainingSources = sources.map(fragment => ({
      fragment,
      remainingQty: Math.max(0, Number(fragment.plannedQty) || 0),
      remainingMinutes: Math.max(0, Number(fragment.plannedMinutes) || 0)
    }));

    targets.forEach(target => {
      let remainingQty = Math.max(0, Number(target.plannedQty) || 0);
      let linked = false;
      remainingSources.forEach(sourceState => {
        if (remainingQty <= 0 && linked) return;
        if ((sourceState.remainingQty <= 0 && sourceState.remainingMinutes <= 0) && linked) return;
        const transferQty = remainingQty > 0 && sourceState.remainingQty > 0
          ? Math.min(remainingQty, sourceState.remainingQty)
          : 0;
        const transferMinutes = transferQty > 0
          ? 0
          : Math.min(
            Math.max(1, Math.round(Number(target.plannedMinutes) || 0)),
            Math.max(1, Math.round(sourceState.remainingMinutes || sourceState.fragment.plannedMinutes || 0))
          );
        if (transferQty <= 0 && transferMinutes <= 0) return;
        links.push({
          from: sourceState.fragment,
          to: target,
          color,
          gate: false
        });
        linked = true;
        if (transferQty > 0) {
          remainingQty = Math.max(0, remainingQty - transferQty);
          sourceState.remainingQty = Math.max(0, sourceState.remainingQty - transferQty);
        } else {
          sourceState.remainingMinutes = 0;
        }
      });
      if (!linked) {
        links.push({
          from: sources[sources.length - 1],
          to: target,
          color,
          gate: false
        });
      }
    });
  };

  viewModel.dependencyMeta.states.forEach(state => {
    const row = rowByOpId.get(trimToString(state?.op?.id));
    if (!row) return;
    const qtySourceId = trimToString(state?.qtySourceOpId);
    if (qtySourceId) {
      createQtyLinks(rowByOpId.get(qtySourceId), row, getProductionGanttColor(row.flowKind));
    }
  });

  console.log('[GANTT] links built', { count: links.length });
  return links;
}

function buildProductionGanttViewModel(card) {
  const dependencyMeta = buildProductionGanttDependencyMeta(card);
  console.log('[GANTT] card resolved', { cardId: card?.id, routeCardNumber: card?.routeCardNumber });
  let rows = buildProductionGanttRows(card, dependencyMeta);
  console.log('[GANTT] rows built', { count: rows.length });
  const conflictResult = detectProductionGanttConflicts(card, rows, dependencyMeta);
  rows = conflictResult.rows;
  console.log('[GANTT] conflicts detected', {
    rows: rows.filter(row => row.isConflict).length,
    comments: conflictResult.comments.length
  });
  const range = buildProductionGanttTimelineRange(rows);
  const slotLayout = buildProductionGanttSlotLayout(rows);
  const firstTask = rows
    .flatMap(row => row.fragments)
    .sort((a, b) => (a.startAt - b.startAt) || (a.endAt - b.endAt))[0] || null;

  const positionedRows = rows.map((row, rowIndex) => ({
    ...row,
    top: rowIndex * PRODUCTION_GANTT_ROW_HEIGHT,
    fragments: row.fragments.map(fragment => {
      const slotKey = `${trimToString(fragment?.task?.date)}|${parseInt(fragment?.task?.shift, 10) || 1}`;
      const slot = slotLayout.slotByKey.get(slotKey) || slotLayout.visibleSlots[0];
      const left = fragment.exactTime
        ? slotLayout.positionAt(fragment.startAt, fragment?.task?.date, fragment?.task?.shift)
        : (slot ? slot.left + 8 : 0);
      const requiredQtyLabel = getProductionGanttRequiredQtyLabel(fragment, row.op);
      const exactBarFloor = getProductionGanttBarWidthFloor(true);
      const placeholderBarFloor = getProductionGanttBarWidthFloor(false);
      const rawWidth = fragment.exactTime && fragment.endAt > fragment.startAt
        ? Math.max(exactBarFloor, slotLayout.positionAt(fragment.endAt, fragment?.task?.date, fragment?.task?.shift) - left)
        : Math.max(placeholderBarFloor, (slot ? slot.width - 16 : slotLayout.hourWidth));
      const width = Math.max(
        getProductionGanttBarMinWidth(row.op, requiredQtyLabel),
        fragment.exactTime ? exactBarFloor : placeholderBarFloor,
        rawWidth
      );
      return {
        ...fragment,
        qtyLabel: requiredQtyLabel,
        left,
        width,
        top: (rowIndex * PRODUCTION_GANTT_ROW_HEIGHT) + Math.round((PRODUCTION_GANTT_ROW_HEIGHT - PRODUCTION_GANTT_BAR_HEIGHT) / 2)
      };
    })
  }));

  const links = buildProductionGanttLinks({ rows: positionedRows, dependencyMeta, timelineWidth: slotLayout.timelineWidth });
  const flowComments = [];
  ['ITEM', 'CONTROL', 'WITNESS', 'DRYING'].forEach(kind => {
    const codes = dependencyMeta.states
      .filter(state => state.flowKind === kind)
      .map(state => trimToString(state?.op?.opCode || state?.op?.code))
      .filter(Boolean);
    if (codes.length) {
      flowComments.push(`${getProductionGanttFlowLabel(kind)}: ${codes.join(' → ')}`);
    }
  });

  return {
    card,
    summary: {
      mk: trimToString(card?.routeCardNumber) || trimToString(card?.number) || trimToString(card?.name) || trimToString(card?.id),
      item: trimToString(card?.itemName) || trimToString(card?.name) || '—',
      planDate: firstTask?.task ? formatProductionGanttDateShift(firstTask.task) : '—',
      deadline: formatProductionDisplayDate(card?.plannedCompletionDate) || '—'
    },
    rows: positionedRows,
    dependencyMeta,
    comments: [...flowComments, ...conflictResult.comments],
    range,
    totalMinutes: slotLayout.totalVisibleMinutes,
    minuteWidth: slotLayout.minuteWidth,
    timelineWidth: slotLayout.timelineWidth,
    quarterWidth: slotLayout.quarterWidth,
    hourWidth: slotLayout.hourWidth,
    visibleSlots: slotLayout.visibleSlots,
    bodyHeight: positionedRows.length * PRODUCTION_GANTT_ROW_HEIGHT,
    links
  };
}

function buildProductionGanttMarkerDefs() {
  return [
    ['item', PRODUCTION_GANTT_KIND_COLORS.ITEM],
    ['control', PRODUCTION_GANTT_KIND_COLORS.CONTROL],
    ['witness', PRODUCTION_GANTT_KIND_COLORS.WITNESS],
    ['drying', PRODUCTION_GANTT_KIND_COLORS.DRYING],
    ['gate', PRODUCTION_GANTT_KIND_COLORS.GATE],
    ['conflict', PRODUCTION_GANTT_KIND_COLORS.CONFLICT]
  ].map(([id, color]) => `
    <marker id="production-gantt-arrow-${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="${color}" />
    </marker>
  `).join('');
}

function getProductionGanttMarkerId(color, gate = false) {
  if (gate || color === PRODUCTION_GANTT_KIND_COLORS.GATE) return 'production-gantt-arrow-gate';
  if (color === PRODUCTION_GANTT_KIND_COLORS.CONTROL) return 'production-gantt-arrow-control';
  if (color === PRODUCTION_GANTT_KIND_COLORS.WITNESS) return 'production-gantt-arrow-witness';
  if (color === PRODUCTION_GANTT_KIND_COLORS.DRYING) return 'production-gantt-arrow-drying';
  if (color === PRODUCTION_GANTT_KIND_COLORS.CONFLICT) return 'production-gantt-arrow-conflict';
  return 'production-gantt-arrow-item';
}

function findProductionGanttVerticalLane(viewModel, fromFragment, toFragment) {
  const rowStart = Math.min(fromFragment.rowIndex, toFragment.rowIndex);
  const rowEnd = Math.max(fromFragment.rowIndex, toFragment.rowIndex);
  const minX = Math.min(fromFragment.left + fromFragment.width, toFragment.left);
  const maxX = Math.max(fromFragment.left + fromFragment.width, toFragment.left);
  const candidates = [];
  const preferredLeft = Math.max(8, Math.min(minX + 12, maxX - 12));
  const preferredRight = Math.min(viewModel.timelineWidth - 8, Math.max(maxX - 12, preferredLeft));
  for (let step = 0; step < 80; step += 1) {
    const offset = step * 12;
    candidates.push(preferredLeft + offset, preferredLeft - offset, preferredRight + offset, preferredRight - offset);
  }
  candidates.push(8, viewModel.timelineWidth - 8);

  const unique = Array.from(new Set(candidates
    .map(value => Math.round(value))
    .filter(value => value >= 8 && value <= viewModel.timelineWidth - 8)));

  const intersectsRowAtX = (row, x) => row.fragments.some(fragment => {
    if (fragment.id === fromFragment.id || fragment.id === toFragment.id) return false;
    return x >= (fragment.left - 6) && x <= (fragment.left + fragment.width + 6);
  });

  return unique.find(x => {
    for (let rowIndex = rowStart; rowIndex <= rowEnd; rowIndex += 1) {
      const row = viewModel.rows[rowIndex];
      if (row && intersectsRowAtX(row, x)) return false;
    }
    return true;
  }) || Math.min(viewModel.timelineWidth - 8, Math.max(8, preferredRight));
}

function buildProductionGanttLinkPath(viewModel, link) {
  const from = link.from;
  const to = link.to;
  if (!from || !to) return '';
  const sx = from.left + from.width;
  const sy = from.top + (PRODUCTION_GANTT_BAR_HEIGHT / 2);
  const tx = to.left;
  const ty = to.top + (PRODUCTION_GANTT_BAR_HEIGHT / 2);
  const laneX = findProductionGanttVerticalLane(viewModel, from, to);
  return `M ${sx} ${sy} H ${laneX} V ${ty} H ${tx}`;
}

function renderProductionGanttTimeline(viewModel) {
  const zoomIndex = getProductionGanttZoomIndex();
  const zoomOutDisabled = zoomIndex <= 0;
  const zoomInDisabled = zoomIndex >= (PRODUCTION_GANTT_ZOOM_STEPS.length - 1);
  const gridDensity = getProductionGanttGridDensityConfig();
  const currentZoomFactor = getProductionGanttZoomFactor();
  const isCompactSlotHead = currentZoomFactor <= 0.1;
  const currentZoomLabel = `${currentZoomFactor}x`;
  const currentZoomTooltip = `Текущий масштаб: ${currentZoomLabel}`;
  const hourMarkers = [];
  const slotMarks = [];
  const slotGridsHead = [];
  const slotGridsBody = [];
  const slotSeparators = [];

  (viewModel.visibleSlots || []).forEach(slot => {
    slotMarks.push(`
      <div class="production-gantt-slot-mark${slot.isFirstInDate ? ' is-date-start' : ''}${isCompactSlotHead ? ' is-compact' : ''}" style="left:${slot.left}px;width:${slot.width}px;">
        <div class="production-gantt-slot-label${isCompactSlotHead ? ' is-compact' : ''}">
          ${slot.isFirstInDate ? `<span class="production-gantt-slot-date">${escapeHtml(formatProductionDisplayDate(slot.date))}</span>` : '<span class="production-gantt-slot-date production-gantt-slot-date-empty"></span>'}
          <span class="production-gantt-slot-shift">Смена ${escapeHtml(String(slot.shift))}</span>
        </div>
      </div>
    `);
    slotGridsHead.push(`<div class="production-gantt-slot-grid${slot.isFirstInDate ? ' is-date-start' : ''}" style="left:${slot.left}px;width:${slot.width}px;--production-gantt-quarter-grid-width:${viewModel.quarterWidth * gridDensity.quarterFactor}px;--production-gantt-hour-grid-width:${viewModel.hourWidth * gridDensity.hourFactor}px;"></div>`);
    slotGridsBody.push(`<div class="production-gantt-slot-grid${slot.isFirstInDate ? ' is-date-start' : ''}" style="left:${slot.left}px;width:${slot.width}px;--production-gantt-quarter-grid-width:${viewModel.quarterWidth * gridDensity.quarterFactor}px;--production-gantt-hour-grid-width:${viewModel.hourWidth * gridDensity.hourFactor}px;"></div>`);
    slotSeparators.push(`<div class="production-gantt-slot-separator${slot.isFirstInDate ? ' is-date-start' : ''}" style="left:${slot.left}px;"></div>`);

    const alignedStart = new Date(slot.startAt);
    alignedStart.setMinutes(0, 0, 0);
    const markerStepMs = gridDensity.hourMarkerStepHours * 60 * 60000;
    for (let ts = alignedStart.getTime(); ts <= slot.endAt; ts += markerStepMs) {
      if (ts < slot.startAt || ts > slot.endAt) continue;
      const left = slot.left + (((ts - slot.startAt) / 60000) * viewModel.minuteWidth);
      hourMarkers.push(`
        <div class="production-gantt-hour-mark" style="left:${left}px;">
          <span>${escapeHtml(formatProductionGanttTime(ts))}</span>
        </div>
      `);
    }
  });
  if ((viewModel.visibleSlots || []).length) {
    const lastSlot = viewModel.visibleSlots[viewModel.visibleSlots.length - 1];
    slotSeparators.push(`<div class="production-gantt-slot-separator is-end" style="left:${lastSlot.left + lastSlot.width}px;"></div>`);
  }

  const rowGuidesHtml = viewModel.rows.map(row => `
    <div class="production-gantt-row-guide" style="top:${row.top}px;height:${PRODUCTION_GANTT_ROW_HEIGHT}px;"></div>
  `).join('');

  const fragmentsHtml = viewModel.rows.map(row => row.fragments.map(fragment => {
    const color = getProductionGanttColor(fragment.flowKind, { conflict: fragment.isConflict });
    const mainLabel = trimToString(row?.op?.opCode || row?.op?.code) || 'Операция';
    const qtyLabel = getProductionGanttRequiredQtyLabel(fragment, row.op);
    const subLabel = `<div class="production-gantt-bar-meta">${escapeHtml(qtyLabel)}</div>`;
    const title = escapeHtml(fragment.titleParts.concat(fragment.conflictReason ? [`Конфликт: ${fragment.conflictReason}`] : []).join('\n'));
    return `
      <div
        class="production-gantt-bar${fragment.exactTime ? '' : ' is-placeholder'}${fragment.isConflict ? ' is-conflict' : ''}"
        style="left:${fragment.left}px;top:${fragment.top}px;width:${fragment.width}px;--production-gantt-bar-color:${color};"
        title="${title}"
      >
        <div class="production-gantt-bar-main">${escapeHtml(mainLabel)}</div>
        ${subLabel}
      </div>
    `;
  }).join('')).join('');

  const linksHtml = viewModel.links.map(link => {
    const path = buildProductionGanttLinkPath(viewModel, link);
    if (!path) return '';
    const markerId = getProductionGanttMarkerId(link.color, link.gate);
    return `<path d="${path}" class="production-gantt-link-path" stroke="${link.color}" marker-end="url(#${markerId})" />`;
  }).join('');

  return `
    <div class="production-gantt-timeline-shell">
      <div class="production-gantt-right-scroll">
        <div
          class="production-gantt-timeline"
          style="--production-gantt-quarter-width:${viewModel.quarterWidth}px;--production-gantt-hour-width:${viewModel.hourWidth}px;width:${viewModel.timelineWidth}px;"
        >
          <div class="production-gantt-timeline-head" style="height:${PRODUCTION_GANTT_HEADER_HEIGHT}px;">
            ${slotGridsHead.join('')}
            ${slotSeparators.join('')}
            ${slotMarks.join('')}
            ${hourMarkers.join('')}
          </div>
          <div class="production-gantt-timeline-body" style="height:${viewModel.bodyHeight}px;">
            ${slotGridsBody.join('')}
            ${slotSeparators.join('')}
            ${rowGuidesHtml}
            ${fragmentsHtml}
            <svg class="production-gantt-links" width="${viewModel.timelineWidth}" height="${viewModel.bodyHeight}" viewBox="0 0 ${viewModel.timelineWidth} ${viewModel.bodyHeight}" preserveAspectRatio="none">
              <defs>${buildProductionGanttMarkerDefs()}</defs>
              ${linksHtml}
            </svg>
          </div>
        </div>
      </div>
      <div class="production-gantt-zoom-controls" aria-label="Масштаб диаграммы">
        <button type="button" class="btn-secondary btn-small production-gantt-zoom-btn" id="production-gantt-zoom-out" title="${escapeHtml(currentZoomTooltip)}"${zoomOutDisabled ? ' disabled' : ''} aria-label="Уменьшить масштаб">-</button>
        <button type="button" class="btn-secondary btn-small production-gantt-zoom-btn" id="production-gantt-zoom-in" title="${escapeHtml(currentZoomTooltip)}"${zoomInDisabled ? ' disabled' : ''} aria-label="Увеличить масштаб">+</button>
      </div>
    </div>
  `;
}

function rerenderProductionGanttWithZoom(routePath, nextZoom) {
  const normalizedZoom = Number(nextZoom);
  if (!PRODUCTION_GANTT_ZOOM_STEPS.includes(normalizedZoom)) return;
  const section = document.getElementById('production-shifts');
  const scrollEl = section?.querySelector('.production-gantt-right-scroll') || null;
  const timelineEl = scrollEl?.querySelector('.production-gantt-timeline') || null;
  const previousWidth = timelineEl ? Math.max(1, timelineEl.scrollWidth || timelineEl.clientWidth || 1) : 1;
  const previousScrollLeft = scrollEl ? scrollEl.scrollLeft : 0;
  const previousClientWidth = scrollEl ? scrollEl.clientWidth : 0;
  const previousCenter = previousScrollLeft + (previousClientWidth / 2);
  productionGanttState.zoom = normalizedZoom;
  renderProductionGanttPage(routePath || (window.location.pathname || ''));
  const nextScrollEl = section?.querySelector('.production-gantt-right-scroll') || null;
  const nextTimelineEl = nextScrollEl?.querySelector('.production-gantt-timeline') || null;
  if (!nextScrollEl || !nextTimelineEl) return;
  const nextWidth = Math.max(1, nextTimelineEl.scrollWidth || nextTimelineEl.clientWidth || 1);
  const widthRatio = nextWidth / previousWidth;
  const nextCenter = previousCenter * widthRatio;
  const nextScrollLeft = Math.max(0, nextCenter - (nextScrollEl.clientWidth / 2));
  nextScrollEl.scrollLeft = nextScrollLeft;
}

function bindProductionGanttDragScroll(scrollEl) {
  if (!scrollEl) return;
  let dragState = null;

  const stopDragging = () => {
    if (!dragState) return;
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
    scrollEl.classList.remove('is-dragging');
    dragState = null;
  };

  const handleMouseMove = (event) => {
    if (!dragState) return;
    const deltaX = event.clientX - dragState.startX;
    scrollEl.scrollLeft = dragState.startScrollLeft - deltaX;
    event.preventDefault();
  };

  const handleMouseUp = () => {
    stopDragging();
  };

  scrollEl.onmousedown = (event) => {
    if (event.button !== 0) return;
    if (event.target.closest('button, a, input, textarea, select, label')) return;
    dragState = {
      startX: event.clientX,
      startScrollLeft: scrollEl.scrollLeft
    };
    scrollEl.classList.add('is-dragging');
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    event.preventDefault();
  };

  scrollEl.addEventListener('mouseleave', () => {
    if (!dragState) return;
  });
}

function renderProductionGanttPage(routePath = '') {
  const section = document.getElementById('production-shifts');
  if (!section) return;
  const resolved = findProductionGanttCard(routePath || window.location.pathname || '');
  if (!resolved?.card) {
    section.innerHTML = `
      <div class="card production-card production-gantt-card">
        <div class="production-toolbar">
          <div class="production-toolbar__left">
            <h2>Диаграмма Ганта</h2>
          </div>
        </div>
        <p class="muted">Маршрутная карта не найдена.</p>
      </div>
    `;
    return;
  }

  const viewModel = buildProductionGanttViewModel(resolved.card);
  productionShiftsState.selectedCardId = resolved.card.id;
  productionShiftBoardState.selectedCardId = resolved.card.id;
  const rowsHtml = viewModel.rows.map(row => {
    const opLabel = trimToString([row?.op?.opCode, row?.op?.opName].filter(Boolean).join(' '));
    const badges = [
      row.isAuto ? '<span class="production-gantt-badge is-auto">AUTO</span>' : '',
      row.isManual ? '<span class="production-gantt-badge is-manual">MANUAL</span>' : '',
      row.isConflict ? '<span class="production-gantt-badge is-conflict">CONFLICT</span>' : ''
    ].filter(Boolean).join('');
    const plannedLabel = row.snapshot?.qtyDriven
      ? `План: ${roundPlanningMinutes(row.snapshot.requiredRemainingMinutes)} мин / ${formatPlanningQtyWithUnit(row.snapshot.remainingQty, row.snapshot.unitLabel)}`
      : `План: ${roundPlanningMinutes(row.snapshot?.requiredRemainingMinutes || row.snapshot?.baseMinutes || 0)} мин`;
    const areaLabel = row.areaNames.length ? row.areaNames.join(', ') : '—';
    const reasonHtml = row.conflictReasons.length
      ? `<div class="production-gantt-op-reason">${escapeHtml(row.conflictReasons.join('; '))}</div>`
      : '';
    return `
      <div class="production-gantt-op-card${row.isConflict ? ' is-conflict' : ''}" style="height:${PRODUCTION_GANTT_ROW_HEIGHT}px;">
        <div class="production-gantt-op-title-row">
          <div class="production-gantt-op-title">${escapeHtml(opLabel || 'Операция')}</div>
          <div class="production-gantt-op-badges">${badges}</div>
        </div>
        <div class="production-gantt-op-meta">${escapeHtml(plannedLabel)}</div>
        <div class="production-gantt-op-meta">Участки: ${escapeHtml(areaLabel)}</div>
        ${reasonHtml}
      </div>
    `;
  }).join('');

  section.innerHTML = `
    <div class="card production-card production-gantt-card">
      <div class="production-toolbar">
        <div class="production-toolbar__left">
          <h2>Диаграмма Ганта</h2>
        </div>
        <div class="production-toolbar__controls">
          <button type="button" class="btn-secondary" id="production-gantt-back">Назад</button>
        </div>
      </div>
      <div class="production-gantt-summary">
        <div class="production-gantt-summary-item"><span class="production-gantt-summary-label">МК:</span> ${escapeHtml(viewModel.summary.mk)}</div>
        <div class="production-gantt-summary-item"><span class="production-gantt-summary-label">Изделие:</span> ${escapeHtml(viewModel.summary.item)}</div>
        <div class="production-gantt-summary-item"><span class="production-gantt-summary-label">Дата плана:</span> ${escapeHtml(viewModel.summary.planDate)}</div>
        <div class="production-gantt-summary-item"><span class="production-gantt-summary-label">Дедлайн:</span> ${escapeHtml(viewModel.summary.deadline)}</div>
      </div>
      <div class="production-gantt-layout">
        <div class="production-gantt-left">
          <div class="production-gantt-left-head" style="height:${PRODUCTION_GANTT_HEADER_HEIGHT}px;">Операции</div>
          <div class="production-gantt-left-body">
            ${rowsHtml || '<div class="muted">Нет операций.</div>'}
          </div>
        </div>
        <div class="production-gantt-right">
          ${renderProductionGanttTimeline(viewModel)}
        </div>
      </div>
      <div class="production-gantt-comments">
        ${viewModel.comments.map(comment => `<div class="production-gantt-comment">• ${escapeHtml(comment)}</div>`).join('')}
      </div>
    </div>
  `;

  const backBtn = document.getElementById('production-gantt-back');
  if (backBtn) {
    backBtn.onclick = () => {
      if (window.history.length > 1) {
        window.history.back();
        return;
      }
      navigateToPath('/production/plan');
    };
  }

  const zoomOutBtn = document.getElementById('production-gantt-zoom-out');
  if (zoomOutBtn) {
    zoomOutBtn.onclick = () => {
      const currentIndex = getProductionGanttZoomIndex();
      const nextIndex = Math.max(0, currentIndex - 1);
      rerenderProductionGanttWithZoom(routePath || (window.location.pathname || ''), PRODUCTION_GANTT_ZOOM_STEPS[nextIndex]);
    };
  }

  const zoomInBtn = document.getElementById('production-gantt-zoom-in');
  if (zoomInBtn) {
    zoomInBtn.onclick = () => {
      const currentIndex = getProductionGanttZoomIndex();
      const nextIndex = Math.min(PRODUCTION_GANTT_ZOOM_STEPS.length - 1, currentIndex + 1);
      rerenderProductionGanttWithZoom(routePath || (window.location.pathname || ''), PRODUCTION_GANTT_ZOOM_STEPS[nextIndex]);
    };
  }

  bindProductionGanttDragScroll(section.querySelector('.production-gantt-right-scroll'));
}

function getProductionShiftsRoutePath(routePath = '') {
  const explicitPath = String(routePath || '').split('?')[0].trim();
  if (explicitPath) return explicitPath;

  const appRoutePath = (appState && appState.route ? String(appState.route).split('?')[0] : '').trim();
  if (appRoutePath.startsWith('/production/')) return appRoutePath;

  const pageId = String(window.__currentPageId || '').trim();
  if (pageId === 'page-production-plan') return '/production/plan';
  if (pageId === 'page-production-shifts') return '/production/shifts';

  return (window.location.pathname || '').split('?')[0];
}

function isProductionPlanRouteActive(routePath = '') {
  return getProductionShiftsRoutePath(routePath) === '/production/plan';
}

function buildProductionShiftsQueueCardButton(card, {
  selectedCardId = productionShiftsState.selectedCardId || null,
  historicalIndex = null
} = {}) {
  const metrics = getProductionQueueCardMetrics(card, { historicalIndex });
  return `
    <button
      type="button"
      class="production-shifts-card-btn${card.id === selectedCardId ? ' active' : ''}"
      data-card-id="${card.id}"
      style="${getProductionQueueCardStyle(metrics)}"
    >
      ${buildProductionQueueCardButtonHtml(card, metrics)}
    </button>
  `;
}

function buildProductionShiftsCardView(selectedCard, { historicalIndex = null } = {}) {
  if (!selectedCard) return '';
  const opsCount = getPlannableOpsCountForCard(selectedCard);
  const opsHtml = opsCount
    ? getPlannableShiftOperations(selectedCard.operations || []).map(op => {
      const isPlanned = isRouteOpPlannedInShifts(selectedCard.id, op.id);
      const snapshot = getOperationPlanningSnapshot(selectedCard.id, op.id);
      const visualMetrics = getOperationPlanningVisualMetrics(selectedCard, op);
      const coveragePercent = visualMetrics.planFillPercent;
      const isDrying = isDryingOperation(op);
      const historicalMetrics = isDrying
        ? null
        : getProductionPlanQueueHistoricalMetrics(selectedCard, op, {
          snapshot,
          visualMetrics,
          historicalIndex
        });
      const dryingState = isDrying
        ? getProductionPlanDryingQueueState(selectedCard, op, { historicalIndex })
        : '';
      const fillClass = isDrying
        ? getProductionPlanDryingClass(dryingState)
        : ' production-shifts-op-planfill';
      const fillStyle = isDrying
        ? ''
        : getPlanningFillStyleWithHistory(coveragePercent, visualMetrics.segments, {
          historyFillPercent: historicalMetrics.fillPercent
        });
      const plannedMin = (op && (op.plannedMinutes != null)) ? op.plannedMinutes : '';
      const plannedLabel = plannedMin !== ''
        ? `План: ${plannedMin} мин${snapshot.qtyDriven ? ` / ${formatPlanningQtyWithUnit(snapshot.baseQty, snapshot.unitLabel)}` : ''}`
        : '';
      const metaHtml = buildProductionPlanOpMeta(selectedCard, op, {
        plannedLabel,
        extraMeta: buildPlanningCoverageMeta(selectedCard, op)
      });
      const shiftsHtml = buildOperationShiftSlotsHtml(selectedCard.id, op.id);
      return `
        <div class="production-shifts-op${fillClass}${isPlanned ? ' planned' : ''}" data-op-id="${op.id}"${fillStyle ? ` style="${fillStyle}"` : ''}>
          <div class="production-shifts-op-main">
            <div class="production-shifts-op-name">${buildProductionPlanOpTitle(op)}</div>
            ${metaHtml}
            ${shiftsHtml}
          </div>
        </div>
      `;
    }).join('')
    : '<div class="muted">Нет операций</div>';
  return `
    <div class="production-shifts-cardview production-shifts-cardview--plan">
      <div class="production-shifts-cardview-header production-shifts-cardview-header--plan">
        <button type="button" class="btn-secondary btn-small" id="production-shifts-back-to-queue">← К очереди</button>
        <div class="production-shifts-cardview-actions production-shifts-cardview-actions--plan">
          <button type="button" class="btn-secondary btn-small" id="production-gantt-open">Гант</button>
          <button type="button" class="btn-primary btn-small" id="production-auto-plan-open">Автомат</button>
        </div>
        <div class="production-shifts-cardview-title">
            <div class="production-shifts-card-title">${escapeHtml(getPlanningCardLabel(selectedCard))}</div>
            <div class="muted">Операций: ${opsCount}</div>
        </div>
      </div>

      <div class="production-shifts-opslist">
        ${opsHtml}
      </div>
    </div>
  `;
}

function getProductionPlanQueueSearchValue() {
  return normalizeQueueSearchValue(productionShiftsState.queueSearch);
}

function shouldCardBeVisibleOnProductionPlan(card, {
  showPlannedQueue = Boolean(productionShiftsState.showPlannedQueue),
  queueSearch = getProductionPlanQueueSearchValue()
} = {}) {
  if (!card || card.archived || card.cardType !== 'MKI') return false;
  if (getPlannableOpsCountForCard(card) <= 0) return false;
  const stage = String(card?.approvalStage || '').trim().toUpperCase();
  if (showPlannedQueue) {
    if (stage !== APPROVAL_STAGE_PLANNED) return false;
  } else if (!(stage === APPROVAL_STAGE_PROVIDED || stage === APPROVAL_STAGE_PLANNING)) {
    return false;
  }
  if (!queueSearch) return true;
  return getProductionQueueCardSearchIndex(card).includes(queueSearch);
}

function findProductionPlanQueueList() {
  return document.getElementById('production-plan-queue-list');
}

function findProductionPlanQueueCardButton(cardId) {
  const list = findProductionPlanQueueList();
  if (!list || !cardId) return null;
  return list.querySelector(`.production-shifts-card-btn[data-card-id="${CSS.escape(String(cardId))}"]`);
}

function findProductionPlanCardViewMount() {
  return document.getElementById('production-plan-cardview-mount');
}

function buildProductionPlanQueueEmptyState({
  queueSearch = getProductionPlanQueueSearchValue(),
  showPlannedQueue = Boolean(productionShiftsState.showPlannedQueue)
} = {}) {
  return queueSearch
    ? '<p class="muted">Ничего не найдено.</p>'
    : `<p class="muted">${showPlannedQueue ? 'Нет карт со статусом PLANNED.' : 'Нет карт для планирования.'}</p>`;
}

function insertProductionPlanQueueCardButtonLive(card, {
  selectedCardId = productionShiftsState.selectedCardId || null,
  historicalIndex = buildProductionPlanQueueHistoricalIndex()
} = {}) {
  const list = findProductionPlanQueueList();
  if (!list || !card?.id) return false;
  if (!shouldCardBeVisibleOnProductionPlan(card)) return false;
  if (findProductionPlanQueueCardButton(card.id)) return updateProductionPlanQueueCardButtonLive(card, { selectedCardId, historicalIndex });
  const emptyState = list.querySelector('.muted');
  if (emptyState && list.children.length === 1) {
    emptyState.remove();
  }
  list.insertAdjacentHTML('beforeend', buildProductionShiftsQueueCardButton(card, { selectedCardId, historicalIndex }));
  return true;
}

function updateProductionPlanQueueCardButtonLive(card, {
  selectedCardId = productionShiftsState.selectedCardId || null,
  historicalIndex = buildProductionPlanQueueHistoricalIndex()
} = {}) {
  const current = findProductionPlanQueueCardButton(card?.id);
  if (!current) return insertProductionPlanQueueCardButtonLive(card, { selectedCardId, historicalIndex });
  if (!shouldCardBeVisibleOnProductionPlan(card)) return removeProductionPlanQueueCardButtonLive(card?.id);
  current.outerHTML = buildProductionShiftsQueueCardButton(card, { selectedCardId, historicalIndex });
  return true;
}

function removeProductionPlanQueueCardButtonLive(cardId) {
  const current = findProductionPlanQueueCardButton(cardId);
  const list = findProductionPlanQueueList();
  if (!current || !list) return false;
  current.remove();
  if (!list.querySelector('.production-shifts-card-btn')) {
    list.innerHTML = buildProductionPlanQueueEmptyState();
  }
  return true;
}

function syncProductionPlanQueueCardButtonLive(card, options = {}) {
  if (!card?.id) return false;
  if (!shouldCardBeVisibleOnProductionPlan(card, options)) {
    return removeProductionPlanQueueCardButtonLive(card.id);
  }
  if (findProductionPlanQueueCardButton(card.id)) {
    return updateProductionPlanQueueCardButtonLive(card, options);
  }
  return insertProductionPlanQueueCardButtonLive(card, options);
}

function syncProductionPlanCardViewLive(card, {
  historicalIndex = buildProductionPlanQueueHistoricalIndex(),
  deletedCardId = ''
} = {}) {
  const mount = findProductionPlanCardViewMount();
  if (!mount) return false;
  const selectedCardId = String(productionShiftsState.selectedCardId || '');
  if (!selectedCardId) {
    mount.innerHTML = '';
    return true;
  }
  if (productionShiftsState.viewMode !== 'card') return false;
  if (deletedCardId && selectedCardId === String(deletedCardId)) {
    mount.innerHTML = '';
    return true;
  }
  if (!card || String(card.id || '') !== selectedCardId) {
    return false;
  }
  mount.innerHTML = buildProductionShiftsCardView(card, { historicalIndex });
  return true;
}

function renderProductionShiftsPage(routePath = '') {
  const section = document.getElementById('production-shifts');
  if (!section) return;
  bindProductionPlanNavigationClearOnClick();
  const isPlanRoute = isProductionPlanRouteActive(routePath);
  const pageTitle = isPlanRoute ? 'План производства' : 'Сменные задания';

  if (isPlanRoute) {
    productionShiftsState.weekStart = productionShiftsState.weekStart || getProductionPlanTodayStart();
  } else {
    productionShiftsState.weekStart = productionShiftsState.weekStart || getProductionWeekStart();
  }
  productionShiftsState.queueSearch = productionShiftsState.queueSearch || '';
  ensureProductionShiftsFromData();
  const weekDates = getProductionShiftsWeekDates();
  const todayDateStr = getTodayDateStrLocal();
  const shift = productionShiftsState.selectedShift || 1;
  const planSelectedShifts = isPlanRoute ? getProductionPlanSelectedShifts() : [];
  const planSlots = isPlanRoute ? getProductionPlanVisibleSlots() : [];
  const planVisibleColumnCount = isPlanRoute ? getProductionPlanVisibleColumnCount() : PRODUCTION_PLAN_MAX_VISIBLE_COLUMNS;
  const planLayoutMetrics = isPlanRoute ? getProductionPlanLayoutMetrics(planVisibleColumnCount) : null;
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

  const shiftButtons = (productionShiftTimes || []).map(item => {
    const shiftNumber = parseInt(item.shift, 10) || 1;
    const isActive = isPlanRoute ? planSelectedShifts.includes(shiftNumber) : shift === shiftNumber;
    return `<button type="button" class="production-shifts-shift-btn${isActive ? ' active' : ''}" data-shift="${shiftNumber}">
      ${shiftNumber} смена
    </button>`;
  }).join('');
  const planColumnOptions = isPlanRoute
    ? Array.from({ length: PRODUCTION_PLAN_MAX_VISIBLE_COLUMNS }, (_, index) => {
      const value = index + 1;
      const selectedAttr = value === planVisibleColumnCount ? ' selected' : '';
      return `<option value="${value}"${selectedAttr}>${getProductionPlanVisibleColumnLabel(value)}</option>`;
    }).join('')
    : '';

  const queueSearch = normalizeQueueSearchValue(productionShiftsState.queueSearch);
  const filteredQueueCards = queueSearch
    ? queueCards.filter(card => getProductionQueueCardSearchIndex(card).includes(queueSearch))
    : queueCards;
  const historicalQueueIndex = isPlanRoute ? buildProductionPlanQueueHistoricalIndex() : null;
  const queueEmptyLabel = queueSearch
    ? 'Ничего не найдено.'
    : (showPlannedQueue ? 'Нет карт со статусом PLANNED.' : 'Нет карт для планирования.');
  const queueHtml = filteredQueueCards.length
    ? filteredQueueCards.map(card => buildProductionShiftsQueueCardButton(card, {
      selectedCardId: productionShiftsState.selectedCardId || null,
      historicalIndex: historicalQueueIndex
    })).join('')
    : `<p class="muted">${queueEmptyLabel}</p>`;

  const cardViewHtml = (viewMode === 'card' && selectedCard)
    ? buildProductionShiftsCardView(selectedCard, { historicalIndex: historicalQueueIndex })
    : '';

  const columns = isPlanRoute ? planSlots : weekDates.map(date => ({ date: formatProductionDate(date), shift }));
  const tableStyle = isPlanRoute
    ? ` style="--production-plan-area-width:${planLayoutMetrics.areaWidthPct.toFixed(4)}%; --production-plan-slot-width:${planLayoutMetrics.slotWidthPct.toFixed(4)}%; --production-plan-op-columns:${planLayoutMetrics.innerOpsColumns};"`
    : '';
  let tableHtml = `<table class="production-table production-shifts-table${isPlanRoute ? ' production-shifts-table-plan' : ''}"${tableStyle}><colgroup><col class="production-shifts-col-area" />` +
    columns.map(() => `<col class="${isPlanRoute ? 'production-shifts-col-slot' : 'production-shifts-col-day'}" />`).join('') +
    '</colgroup><thead><tr><th class="production-shifts-area production-shift-area-cell" lang="ru">Участок</th>';
  columns.forEach((column, idx) => {
    const label = getProductionDayLabel(column.date);
    const weekendClass = isProductionWeekend(column.date) ? ' weekend' : '';
    const dateStr = column.date;
    const columnShift = column.shift;
    const isToday = dateStr === todayDateStr;
    const todayClass = isToday ? ' production-today' : '';
    const shiftStatusLabel = getShiftStatusLabel(dateStr, columnShift);
    const shiftStatusClass = getShiftStatusClass(dateStr, columnShift);

    const left = idx === 0
      ? '<button class="production-day-shift" data-dir="-1" type="button">←</button>'
      : '';
    const right = idx === columns.length - 1
      ? '<button class="production-day-shift" data-dir="1" type="button">→</button>'
      : '';
    const shiftBadge = isPlanRoute
      ? `<span class="production-day-shift-corner">${columnShift} смена</span>`
      : '';

    tableHtml += `
      <th class="production-day${todayClass}${weekendClass}${isPlanRoute ? ' production-day-plan-slot' : ''}" data-date="${dateStr}" data-shift="${columnShift}">
        <div class="production-day-header">
          ${left}
          <div class="production-day-info">
            ${shiftBadge}
            <div class="production-day-mainline">
              <span class="production-day-date">${escapeHtml(label.date)}</span>
              <span class="production-day-title">${escapeHtml(label.weekday)}</span>
            </div>
            <div class="production-shift-board-status ${shiftStatusClass}">${escapeHtml(shiftStatusLabel)}</div>
          </div>
          ${right}
        </div>
      </th>
    `;
  });
  tableHtml += '</tr></thead><tbody>';

  areasList.forEach(area => {
    tableHtml += `<tr><th class="production-shift-label production-shift-area-cell" lang="ru">${renderAreaLabel(area, { name: area.name || '', fallbackName: 'Участок' })}</th>`;
    columns.forEach(column => {
      const dateStr = column.date;
      const columnShift = column.shift;
      const weekendClass = isProductionWeekend(dateStr) ? ' weekend' : '';
      const isToday = dateStr === todayDateStr;
      const todayClass = isToday ? ' production-today' : '';
      const employees = getProductionShiftEmployees(dateStr, area.id, columnShift);
      const tasks = getProductionShiftTasksForCell(dateStr, columnShift, area.id);
      const shiftStatusKey = getShiftStatusKey(dateStr, columnShift);
      const historicalRows = isPlanRoute && ['COMPLETED', 'FIXED'].includes(shiftStatusKey)
        ? getProductionPlanHistoricalRowsForCell(dateStr, columnShift, area.id)
        : [];
      const renderEntries = historicalRows.length
        ? historicalRows.map(row => ({ type: 'history', row }))
        : tasks.map(task => ({ type: 'live', task }));
      const hasShiftCloseTransferTasks = isPlanRoute && (
        historicalRows.length
          ? historicalRows.some(row => row?.resolutionAction === 'TRANSFER')
          : tasks.some(task => task?.fromShiftCloseTransfer === true)
      );
      const focusCardId = productionShiftsState.selectedCardId || null;
      const navigationTarget = productionShiftsState.navigationTarget || null;
      const shiftTotalMinutes = getShiftDurationMinutesForArea(columnShift, area.id);
      const plannedSumMinutes = historicalRows.length
        ? historicalRows.reduce((sum, row) => sum + Math.max(0, Number(row?.plannedMinutes || 0)), 0)
        : getShiftPlannedMinutes(dateStr, columnShift, area.id);
      const loadPct = Math.min(999, Math.max(0, Math.round((plannedSumMinutes / shiftTotalMinutes) * 100)));
      const loadPctHtml = `<div class="production-shifts-load" title="Загрузка: ${plannedSumMinutes} / ${shiftTotalMinutes} мин">${loadPct}%</div>`;
      const overloadMinutes = Math.max(0, plannedSumMinutes - shiftTotalMinutes);
      const overloadHtml = overloadMinutes > 0
        ? `<div class="production-shift-meta production-shift-meta-empty">Перегрузка: +${overloadMinutes} мин</div>`
        : '';
      const peopleMetaHtml = renderProductionPlanPeopleMeta(employees);
      const canPlan = selectedCard
        && !isProductionRouteReadonly('production-plan')
        && (selectedCard.approvalStage === APPROVAL_STAGE_PROVIDED || selectedCard.approvalStage === APPROVAL_STAGE_PLANNING)
        && canPlanShiftOperations(dateStr, columnShift);
      const hideOpStatus = isPlanRoute
        && ['COMPLETED', 'FIXED'].includes(shiftStatusKey);
      const tasksHtml = renderEntries.length
        ? renderEntries.map(entry => {
          if (entry.type === 'history') {
            const row = entry.row;
            const card = cards.find(c => c.id === row.cardId);
            const label = card ? getPlanningCardLabel(card) : 'МК';
            const isNavigationFocus = isProductionNavigationTargetTask(row, dateStr, columnShift, area.id);
            const isFocusTask = navigationTarget
              ? isNavigationFocus
              : (focusCardId && String(row.cardId || '') === String(focusCardId));
            const focusClass = isFocusTask ? ` ${isNavigationFocus ? 'focus-nav' : 'focus'}` : '';
            const op = (card?.operations || []).find(item => item.id === row.routeOpId) || null;
            const isDrying = isDryingOperation(op || row);
            const dryingState = isDrying ? getProductionPlanDryingTableHistoricalState(card, op || row, row) : '';
            const dryingFillClass = isDrying ? getProductionPlanDryingClass(dryingState, { target: 'table' }) : '';
            const statusFillStyle = isDrying ? '' : getProductionPlanHistoricalTaskStyle(row);
            const statusFillClass = statusFillStyle ? ' production-shift-board-op production-shift-board-op-planfill' : '';
            const metaHtml = buildProductionPlanHistoricalMeta(card, op || row, row, {
              hideStatus: hideOpStatus
            });
            const cardLineHtml = buildProductionPlanCardLine(label);
            return `
              <div class="production-shift-task${focusClass}${statusFillClass}${dryingFillClass}" data-history="1" data-task-card-id="${escapeHtml(String(row.cardId || ''))}" data-task-route-op-id="${escapeHtml(String(row.routeOpId || ''))}"${statusFillStyle ? ` style="${statusFillStyle}"` : ''}>
                <div class="production-shift-task-info">
                  <div class="production-shift-task-name">${buildProductionPlanOpTitle(op || row)}</div>
                  ${cardLineHtml}
                  ${metaHtml}
                </div>
              </div>
            `;
          }
          const task = entry.task;
          const card = cards.find(c => c.id === task.cardId);
          const label = card ? getPlanningCardLabel(card) : 'МК';
          const isNavigationFocus = isProductionNavigationTargetTask(task, dateStr, columnShift, area.id);
          const isFocusTask = navigationTarget
            ? isNavigationFocus
            : (focusCardId && task.cardId === focusCardId);
          const focusClass = isFocusTask ? ` ${isNavigationFocus ? 'focus-nav' : 'focus'}` : '';
          const partMinutes = getTaskPlannedMinutes(task);
          const op = (card?.operations || []).find(item => item.id === task.routeOpId) || null;
          const isDrying = isDryingOperation(op || task);
          const dryingState = isDrying ? getProductionPlanDryingTableLiveState(card, op || task, task) : '';
          const dryingFillClass = isDrying ? getProductionPlanDryingClass(dryingState, { target: 'table' }) : '';
          const qtyLabel = getTaskPlannedQuantityLabel(task, op);
          const partLabel = qtyLabel ? `${qtyLabel} / ${partMinutes} мин` : `${partMinutes} мин`;
          const removeBtn = !isProductionRouteReadonly('production-plan') && canRemoveProductionShiftTask(task, op)
            ? `<button type="button" class="btn-icon production-shift-remove" data-task-id="${task.id}" title="Снять план">✕</button>`
            : '';
          const canDrag = !isProductionRouteReadonly('production-plan') && canDragProductionShiftTask(task, op);
          const transferClass = isPlanRoute && task?.fromShiftCloseTransfer === true ? ' is-shift-close-transfer' : '';
          const statusFillStyle = isPlanRoute && !isDrying ? getProductionPlanTaskStatusFillStyle(task, card, op) : '';
          const statusFillClass = statusFillStyle ? ' production-shift-board-op production-shift-board-op-planfill' : '';
          const metaHtml = buildProductionPlanOpMeta(card, op || task, {
            plannedLabel: `План: ${partLabel}`,
            hideStatus: hideOpStatus,
            shiftDate: task.date,
            shiftNumber: task.shift
          });
          const cardLineHtml = buildProductionPlanCardLine(label);
          return `
            <div class="production-shift-task${focusClass}${transferClass}${statusFillClass}${dryingFillClass}${canDrag ? ' is-draggable' : ''}" data-task-id="${task.id}" data-task-card-id="${task.cardId}" data-task-route-op-id="${task.routeOpId}"${canDrag ? ' draggable="true"' : ''}${statusFillStyle ? ` style="${statusFillStyle}"` : ''}>
              <div class="production-shift-task-info">
                <div class="production-shift-task-name">${buildProductionPlanOpTitle(op || task)}</div>
                ${cardLineHtml}
                ${metaHtml}
              </div>
              ${removeBtn}
            </div>
          `;
        }).join('')
        : '<div class="muted production-shift-empty">Нет операций</div>';

      tableHtml += `
        <td class="production-cell production-shifts-cell${todayClass}${weekendClass}${hasShiftCloseTransferTasks ? ' has-shift-close-transfer' : ''}" data-area-id="${area.id}" data-date="${dateStr}" data-shift="${columnShift}">
          ${loadPctHtml}
          ${overloadHtml}
          ${peopleMetaHtml}
          <div class="production-shift-ops">${tasksHtml}</div>
          ${canPlan ? `<button type="button" class="btn-secondary btn-small production-shift-plan-btn" data-area-id="${area.id}" data-date="${dateStr}" data-shift="${columnShift}">Запланировать</button>` : ''}
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
              ${isPlanRoute ? `
                <label class="production-plan-columns-control" for="production-plan-visible-columns">
                  <select id="production-plan-visible-columns" aria-label="Количество отображаемых столбцов">
                    ${planColumnOptions}
                  </select>
                </label>
              ` : ''}
            </div>
          </div>
        </div>
      </div>
      <div class="production-shifts-layout${isPlanRoute ? ' is-plan-route' : ''}"${isPlanRoute ? ` style="--production-plan-queue-width:${planLayoutMetrics.queueWidthPct.toFixed(4)}%; --production-plan-table-width:${planLayoutMetrics.tableWidthPct.toFixed(4)}%;"` : ''}>
        <aside class="production-shifts-queue">
          ${viewMode === 'card' ? `<div id="production-plan-cardview-mount">${cardViewHtml}</div>` : `
            <div class="production-shifts-queue-header">
              <h3>Очередь планирования</h3>
              <label class="production-shifts-queue-toggle toggle-row">
                <input type="checkbox" id="production-shifts-queue-toggle"${showPlannedQueue ? ' checked' : ''} />
                PLANNED
              </label>
            </div>
            <div class="production-shifts-queue-list" id="production-plan-queue-list">${queueHtml}</div>
            <div id="production-plan-cardview-mount"></div>
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
  const autoPlanBtn = document.getElementById('production-auto-plan-open');
  if (autoPlanBtn && selectedCard) {
    autoPlanBtn.onclick = () => openProductionAutoPlanModal({
      cardId: selectedCard.id
    });
  }
  const ganttBtn = document.getElementById('production-gantt-open');
  if (ganttBtn && selectedCard) {
    ganttBtn.onclick = () => navigateToPath(getProductionGanttPath(selectedCard));
  }

  const weekInput = document.getElementById('production-shifts-week-start');
  if (weekInput) {
    weekInput.value = formatProductionDate(productionShiftsState.weekStart);
    weekInput.onchange = () => setProductionShiftsWeekStart(weekInput.value || getCurrentDateString());
  }
  const todayBtn = document.getElementById('production-shifts-today');
  if (todayBtn) {
    todayBtn.onclick = () => {
      if (isPlanRoute) {
        resetProductionPlanToToday();
        return;
      }
      setProductionShiftsWeekStart(getProductionWeekStart(new Date()));
    };
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
  const visibleColumnsSelect = document.getElementById('production-plan-visible-columns');
  if (visibleColumnsSelect) {
    visibleColumnsSelect.value = String(planVisibleColumnCount);
    visibleColumnsSelect.onchange = () => setProductionPlanVisibleColumnCount(visibleColumnsSelect.value);
  }

  section.querySelectorAll('.production-shifts-shift-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const nextShift = parseInt(btn.getAttribute('data-shift'), 10) || 1;
      if (isPlanRoute) {
        toggleProductionPlanShift(nextShift);
      } else {
        setProductionShiftsShift(nextShift);
      }
    });
  });

  section.querySelectorAll('.production-shifts-card-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-card-id');
      productionShiftsState.selectedCardId = id;
      renderProductionShiftsPage();
    });
    btn.addEventListener('dblclick', () => {
      const id = btn.getAttribute('data-card-id');
      if (!id) return;
      productionShiftsState.selectedCardId = id;
      productionShiftsState.viewMode = 'card';
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

  if (isPlanRoute && selectedCard) {
    section.querySelectorAll('.production-shifts-op').forEach(el => {
      el.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();

        const routeOpId = el.getAttribute('data-op-id');
        if (!routeOpId) return;
        const parts = getOperationPlannedParts(selectedCard.id, routeOpId);
        if (!parts.length) return;

        showProductionShiftsOpMenu(event.pageX, event.pageY, selectedCard.id, routeOpId);
      });
    });
  }

  section.querySelectorAll('.production-shift-task').forEach(el => {
    el.addEventListener('contextmenu', (event) => {
      if (el.dataset.history === '1') return;
      event.preventDefault();
      event.stopPropagation();

      const cardId = el.getAttribute('data-task-card-id');
      if (!cardId) return;

      productionShiftsState.selectedCardId = cardId;
      showProductionShiftsTaskMenu(event.pageX, event.pageY, cardId);
    });
    el.addEventListener('dragstart', (event) => {
      if (el.dataset.history === '1') return;
      const taskId = el.getAttribute('data-task-id');
      if (!taskId) return;
      productionShiftDragTaskId = taskId;
      el.classList.add('is-dragging');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', taskId);
      }
    });
    el.addEventListener('dragend', () => {
      productionShiftDragTaskId = null;
      el.classList.remove('is-dragging');
      section.querySelectorAll('.production-shifts-cell.is-drop-target').forEach(cell => {
        cell.classList.remove('is-drop-target');
      });
    });
  });

  section.querySelectorAll('.production-shifts-cell').forEach(cell => {
    cell.addEventListener('dragover', (event) => {
      const date = cell.getAttribute('data-date') || '';
      const areaId = cell.getAttribute('data-area-id') || '';
      const shiftValue = parseInt(cell.getAttribute('data-shift'), 10) || shift;
      if (!productionShiftDragTaskId || !areaId || !date) return;
      if (!canDropProductionShiftTask(date, shiftValue)) return;
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
      cell.classList.add('is-drop-target');
    });
    cell.addEventListener('dragleave', (event) => {
      if (event.currentTarget !== cell) return;
      cell.classList.remove('is-drop-target');
    });
    cell.addEventListener('drop', async (event) => {
      const date = cell.getAttribute('data-date') || '';
      const areaId = cell.getAttribute('data-area-id') || '';
      const shiftValue = parseInt(cell.getAttribute('data-shift'), 10) || shift;
      cell.classList.remove('is-drop-target');
      if (!productionShiftDragTaskId || !areaId || !date) return;
      if (!canDropProductionShiftTask(date, shiftValue)) return;
      event.preventDefault();
      const taskId = productionShiftDragTaskId;
      productionShiftDragTaskId = null;
      await moveProductionShiftTask(taskId, {
        date,
        shift: shiftValue,
        areaId
      });
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
      if (isPlanRoute) {
        const nextStart = moveProductionPlanVisibleSlot(getProductionPlanWindowStartSlot(), dir);
        productionShiftsState.weekStart = normalizeProductionStartDate(nextStart.date);
        productionShiftsState.planWindowStartSlot = nextStart;
        saveProductionPlanViewSettings();
        renderProductionShiftsPage();
        return;
      }
      const baseStart = productionShiftsState.weekStart || getProductionWeekStart();
      const nextStart = addDaysToDate(baseStart, dir);
      setProductionShiftsWeekStart(nextStart);
    });
  }

  applyReadonlyState(isPlanRoute ? 'production-plan' : 'production-shifts', 'production-shifts');
}

function renderProductionPlanPage(routePath = '/production/plan') {
  renderProductionShiftsPage(routePath);
}

function getProductionShiftNumbers() {
  const list = (productionShiftTimes && productionShiftTimes.length)
    ? productionShiftTimes
    : getDefaultProductionShiftTimes();
  const unique = new Map();
  list.forEach(item => {
    const shift = parseInt(item.shift, 10) || 1;
    if (!unique.has(shift)) unique.set(shift, item || { shift });
  });
  const ordered = Array.from(unique.values()).map(item => {
    const shift = parseInt(item.shift, 10) || 1;
    const timeFrom = parseProductionTime(item.timeFrom);
    return {
      shift,
      order: Number.isFinite(timeFrom) ? timeFrom : 0
    };
  });
  ordered.sort((a, b) => (a.order - b.order) || (a.shift - b.shift));
  const shifts = ordered.map(item => item.shift);
  return shifts.length ? shifts : [1];
}

function getProductionPlanVisibleSlots() {
  const selectedShifts = getProductionPlanSelectedShifts();
  const visibleCount = getProductionPlanVisibleColumnCount();
  const startSlot = getProductionPlanWindowStartSlot();
  const slots = [];
  let cursor = { ...startSlot };
  while (slots.length < visibleCount) {
    if (selectedShifts.includes(cursor.shift)) {
      slots.push({ date: cursor.date, shift: cursor.shift });
    }
    cursor = moveShiftSlot(cursor, 1);
  }
  return slots;
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

function getShiftDateLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return dateStr || '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function resolveCurrentShiftSlot(now = new Date()) {
  const shifts = getProductionShiftNumbers();
  const todayStr = formatProductionDate(now);
  const minutes = (now.getHours() * 60) + now.getMinutes();
  const fallback = { date: todayStr, shift: shifts[0] || 1 };
  for (const shift of shifts) {
    const range = getShiftRange(shift);
    if (!range) continue;
    if (range.end <= 1440) {
      if (minutes >= range.start && minutes < range.end) {
        return { date: todayStr, shift };
      }
      continue;
    }
    const endToday = range.end - 1440;
    if (minutes >= range.start) {
      return { date: todayStr, shift };
    }
    if (minutes < endToday) {
      return { date: addDaysToDateStr(todayStr, -1), shift };
    }
  }
  return fallback;
}

function getOpenShiftSlots() {
  const list = (productionShifts || [])
    .filter(item => item && item.status === 'OPEN')
    .map(item => ({
      date: item.date,
      shift: parseInt(item.shift, 10) || 1
    }));
  return list
    .map(slot => {
      const ref = getProductionShiftTimeRef(slot.shift);
      const start = parseProductionTime(ref?.timeFrom) ?? 0;
      const base = new Date(slot.date + 'T00:00:00').getTime();
      return {
        ...slot,
        sortKey: base + (start * 60 * 1000)
      };
    })
    .sort((a, b) => (a.sortKey - b.sortKey) || (a.shift - b.shift));
}

function resolveShiftDisplayData(slot) {
  const record = ensureProductionShift(slot.date, slot.shift, { reason: 'data' });
  const ref = getProductionShiftTimeRef(slot.shift);
  const statusLabel = getShiftStatusLabel(slot.date, slot.shift);
  const statusClass = getShiftStatusClass(slot.date, slot.shift);
  return {
    record,
    status: record?.status || 'PLANNING',
    statusLabel,
    statusClass,
    timeFrom: record?.timeFrom || ref?.timeFrom || '00:00',
    timeTo: record?.timeTo || ref?.timeTo || '00:00'
  };
}

function getShiftBoardOpStatusLabel(status) {
  if (status === 'IN_PROGRESS') return 'В работе';
  if (status === 'PAUSED') return 'Пауза';
  if (status === 'DONE') return 'Завершена';
  if (status === 'NO_ITEMS') return 'Нет изделий/образцов';
  return 'Не начата';
}

function getShiftBoardOpStatusClass(status) {
  if (status === 'IN_PROGRESS') return 'status-in-progress';
  if (status === 'PAUSED') return 'status-paused';
  if (status === 'DONE') return 'status-done';
  if (status === 'NO_ITEMS') return 'status-no-items';
  return 'status-not-started';
}

function buildShiftCellOps(dateStr, shift, areaId) {
  const shiftStatusKey = getShiftStatusKey(dateStr, shift);
  const historicalRows = ['COMPLETED', 'FIXED'].includes(shiftStatusKey)
    ? getProductionPlanHistoricalRowsForCell(dateStr, shift, areaId)
    : [];
  if (historicalRows.length) {
    return historicalRows.map(row => {
      const card = (cards || []).find(c => c.id === row.cardId) || null;
      const op = (card?.operations || []).find(item => item.id === row.routeOpId) || null;
      const dryingFillState = getProductionPlanDryingFillState(card, op || row, row);
      const dryingFillClass = dryingFillState === 'done'
        ? ' production-shift-board-op-drying-fill-done'
        : '';
      const statusFillStyle = getProductionPlanHistoricalTaskStyle(row);
      const statusFillClass = statusFillStyle ? ' production-shift-board-op-planfill' : '';
      const label = card ? getPlanningCardLabel(card) : 'МК';
      const metaHtml = buildProductionPlanHistoricalMeta(card, op || row, row, {
        hideStatus: true
      });
      const cardLineHtml = buildProductionPlanCardLine(label);
      return `
        <div class="production-shift-task production-shift-board-op${statusFillClass}${dryingFillClass}" data-history="1" data-card-id="${escapeHtml(String(row.cardId || ''))}" data-route-op-id="${escapeHtml(String(row.routeOpId || ''))}"${statusFillStyle ? ` style="${statusFillStyle}"` : ''}>
          <div class="production-shift-task-info">
            <div class="production-shift-board-op-head">
              <div class="production-shift-task-name">${buildProductionPlanOpTitle(op || row)}</div>
            </div>
            ${cardLineHtml}
            ${metaHtml}
          </div>
        </div>
      `;
    }).join('');
  }
  const tasks = getProductionShiftTasksForCell(dateStr, shift, areaId);
  if (!tasks.length) return '<div class="muted">Нет операций</div>';
  return tasks.map(task => {
    const card = (cards || []).find(c => c.id === task.cardId) || null;
    const op = (card?.operations || []).find(item => item.id === task.routeOpId) || null;
    const status = String(op?.status || task?.status || 'NOT_STARTED').trim().toUpperCase();
    const statusLabel = getShiftBoardOpStatusLabel(status);
    const statusClass = getShiftBoardOpStatusClass(status);
    const dryingFillState = getProductionPlanDryingFillState(card, op);
    const dryingFillClass = dryingFillState === 'done'
      ? ' production-shift-board-op-drying-fill-done'
      : '';
    const visualMetrics = card && op ? getOperationPlanningVisualMetrics(card, op) : null;
    const planFillStyle = (!dryingFillState && visualMetrics)
      ? getPlanningFillStyleVars(visualMetrics.plannedFillPercent, visualMetrics.segments)
      : '';
    const label = card ? getPlanningCardLabel(card) : 'МК';
    const totalMinutes = getTaskTotalMinutes(task);
    const partMinutes = getTaskPlannedMinutes(task);
    const pct = totalMinutes > 0 ? Math.round((partMinutes / totalMinutes) * 100) : 0;
    const showPart = totalMinutes > 0 && partMinutes < totalMinutes;
    const partLabel = totalMinutes > 0 ? `${partMinutes} мин (${pct}%)` : `${partMinutes} мин`;
    const metaHtml = buildProductionShiftBoardOpMeta(card, op || task, task, {
      shiftDate: task.date,
      shiftNumber: task.shift,
      hideStatus: true
    });
    const cardLineHtml = buildProductionPlanCardLine(label);
    return `
      <div class="production-shift-task production-shift-board-op${planFillStyle ? ' production-shift-board-op-planfill' : ''}${dryingFillClass}" data-card-id="${task.cardId}" data-task-id="${task.id}" data-route-op-id="${task.routeOpId}"${planFillStyle ? ` style="${planFillStyle}"` : ''}>
        <div class="production-shift-task-info">
          <div class="production-shift-board-op-head">
            <div class="production-shift-task-name">${buildProductionPlanOpTitle(op || task)}</div>
            <div class="production-shift-board-op-status ${escapeHtml(statusClass)}">${escapeHtml(statusLabel)}</div>
          </div>
          ${cardLineHtml}
          ${metaHtml}
        </div>
      </div>
    `;
  }).join('');
}

function buildShiftBoardQueueCardHtml(cardId, { totalCount = 0, doneCount = 0, historicalIndex = null } = {}) {
  const card = (cards || []).find(c => String(c?.id || '') === String(cardId || '')) || null;
  const cardLabel = card ? getShiftBoardCardLabel(card) : 'Маршрутная карта';
  const metrics = card ? getProductionQueueCardMetrics(card, { historicalIndex }) : null;
  const styleAttr = metrics ? ` style="${getProductionQueueCardExecutionStyle(metrics)}"` : '';
  const activeClass = String(cardId || '') === String(productionShiftBoardState.selectedCardId || '') ? ' active' : '';
  return `
    <button type="button" class="production-shifts-card-btn production-shift-board-queue-card${activeClass}" data-card-id="${escapeHtml(String(cardId || ''))}"${styleAttr}>
      <div class="production-shifts-card-title">${escapeHtml(cardLabel)}</div>
      <div class="muted">Операций: ${escapeHtml(String(doneCount || 0))}/${escapeHtml(String(totalCount || 0))}</div>
    </button>
  `;
}

function buildShiftBoardQueue(selectedSlot, { historicalIndex = null } = {}) {
  if (!selectedSlot) {
    return '<p class="muted">Смена не выбрана.</p>';
  }
  const shiftStatusKey = getShiftStatusKey(selectedSlot.date, selectedSlot.shift);
  if (['COMPLETED', 'FIXED'].includes(shiftStatusKey)) {
    const historicalRows = getProductionHistoricalRowsForShift(selectedSlot.date, selectedSlot.shift);
    if (!historicalRows.length) return '<p class="muted">Нет заданий для выбранной смены.</p>';
    const grouped = new Map();
    historicalRows.forEach(row => {
      const cardId = String(row?.cardId || '');
      if (!cardId) return;
      if (!grouped.has(cardId)) grouped.set(cardId, []);
      grouped.get(cardId).push(row);
    });
    return Array.from(grouped.entries()).map(([cardId, list]) => {
      const uniqueRows = Array.from(new Map(list.map(row => [String(row?.routeOpId || ''), row])).values());
      const totalCount = uniqueRows.length;
      const doneCount = uniqueRows.reduce((acc, row) => acc + (row?.isCompleted ? 1 : 0), 0);
      return buildShiftBoardQueueCardHtml(cardId, {
        totalCount,
        doneCount,
        historicalIndex
      });
    }).join('');
  }
  const tasks = getVisibleProductionShiftTasks()
    .filter(task => task.date === selectedSlot.date && task.shift === selectedSlot.shift);
  if (!tasks.length) return '<p class="muted">Нет заданий для выбранной смены.</p>';
  const grouped = new Map();
  tasks.forEach(task => {
    if (!grouped.has(task.cardId)) grouped.set(task.cardId, []);
    grouped.get(task.cardId).push(task);
  });
  return Array.from(grouped.entries()).map(([cardId, list]) => {
    const routeOpIds = Array.from(new Set(list.map(task => String(task.routeOpId || '')).filter(Boolean)));
    const totalCount = routeOpIds.length;
    const card = (cards || []).find(c => c.id === cardId) || null;
    const doneCount = routeOpIds.reduce((acc, routeOpId) => {
      const op = (card?.operations || []).find(item => item.id === routeOpId);
      return acc + (op?.status === 'DONE' ? 1 : 0);
    }, 0);
    return buildShiftBoardQueueCardHtml(cardId, {
      totalCount,
      doneCount,
      historicalIndex
    });
  }).join('');
}

function openShiftBySlot(slot) {
  if (!ensureProductionEditAccess('production-shifts')) return;
  const existingRecord = findProductionShiftRecord(slot.date, slot.shift);
  if (existingRecord?.isFixed === true || String(existingRecord?.status || '').toUpperCase() === 'LOCKED') {
    showToast('Смена зафиксирована и не может быть открыта');
    return;
  }
  const openCount = (productionShifts || []).filter(item => item.status === 'OPEN').length;
  if (openCount >= 2) {
    showToast('Нельзя открыть больше двух смен одновременно');
    return;
  }
  const currentStatus = String(existingRecord?.status || 'PLANNING').toUpperCase();
  if (!['PLANNING', 'CLOSED'].includes(currentStatus)) return;
  const blockedAreaNames = collectProductionShiftStartBlockedAreaNames(slot.date, slot.shift);
  if (blockedAreaNames.length) {
    showProductionMissingAreaExecutorToasts(blockedAreaNames);
    return;
  }
  const shiftRecord = existingRecord || ensureProductionShift(slot.date, slot.shift, { reason: 'manual' });
  if (!shiftRecord) return;
  if (!['PLANNING', 'CLOSED'].includes(shiftRecord.status)) return;
  const now = Date.now();
  const prevStatus = shiftRecord.status;
  shiftRecord.status = 'OPEN';
  if (!(Number(shiftRecord.openedAt) > 0)) {
    shiftRecord.openedAt = now;
  }
  if (!String(shiftRecord.openedBy || '').trim()) {
    shiftRecord.openedBy = getCurrentUserName();
  }
  shiftRecord.closedAt = null;
  shiftRecord.closedBy = '';
  if (!shiftRecord.initialSnapshot) {
    const employees = (productionSchedule || [])
      .filter(rec => rec.date === slot.date && rec.shift === slot.shift)
      .map(rec => ({ ...rec }));
    const tasks = getVisibleProductionShiftTasks()
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
    oldValue: prevStatus,
    newValue: 'OPEN'
  });
  saveData();
  renderProductionShiftBoardPage();
}

function closeShiftBySlot(slot) {
  const shiftRecord = ensureProductionShift(slot.date, slot.shift, { reason: 'data' });
  if (!shiftRecord || shiftRecord.status !== 'OPEN') return;
  if (isShiftFixed(slot.date, slot.shift)) {
    showToast('Смена зафиксирована и не может быть изменена');
    return;
  }
  const tasks = getVisibleProductionShiftTasks()
    .filter(task => task.date === slot.date && task.shift === slot.shift);
  const allowedStatuses = new Set(['NOT_STARTED', 'DONE', 'NO_ITEMS']);
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

function getProductionShiftCloseDraft(record) {
  if (!record) return { rows: {} };
  if (!record.closePageDraft || typeof record.closePageDraft !== 'object') {
    record.closePageDraft = { rows: {} };
  }
  if (!record.closePageDraft.rows || typeof record.closePageDraft.rows !== 'object') {
    record.closePageDraft.rows = {};
  }
  return record.closePageDraft;
}

function getProductionShiftCloseSnapshotHistory(record) {
  if (!record || typeof record !== 'object') return [];
  const history = Array.isArray(record.closePageSnapshotHistory)
    ? record.closePageSnapshotHistory.filter(item => item && typeof item === 'object')
    : [];
  if (history.length) return history;
  return (record.closePageSnapshot && typeof record.closePageSnapshot === 'object')
    ? [record.closePageSnapshot]
    : [];
}

function getProductionShiftCloseSnapshot(record) {
  const history = getProductionShiftCloseSnapshotHistory(record);
  return history.length ? history[history.length - 1] : null;
}

function appendProductionShiftCloseSnapshot(record, snapshot) {
  if (!record || !snapshot || typeof snapshot !== 'object') return;
  const history = getProductionShiftCloseSnapshotHistory(record).slice();
  history.push(snapshot);
  record.closePageSnapshotHistory = history;
  record.closePageSnapshot = snapshot;
}

function getProductionShiftCloseRowKey(task) {
  if (!task) return '';
  return [
    String(task.date || ''),
    parseInt(task.shift, 10) || 1,
    String(task.areaId || ''),
    String(task.cardId || ''),
    String(task.routeOpId || ''),
    String(task.subcontractChainId || '')
  ].join('|');
}

function getProductionShiftCloseWindow(slot, record = null) {
  const range = getShiftRange(slot?.shift);
  const base = new Date(`${slot?.date || ''}T00:00:00`);
  if (!range || Number.isNaN(base.getTime())) {
    return { start: 0, end: 0 };
  }
  const start = base.getTime() + (range.start * 60 * 1000);
  const scheduledEnd = base.getTime() + (range.end * 60 * 1000);
  const closedAt = Number(record?.closedAt);
  const end = closedAt > 0
    ? Math.min(closedAt, scheduledEnd)
    : Math.min(Date.now(), scheduledEnd);
  return {
    start,
    end: Math.max(start, end),
    scheduledEnd
  };
}

function getProductionShiftCloseFactSeconds(card, op, slot, record = null) {
  if (!card || !op || !slot?.date) return 0;
  const window = getProductionShiftCloseWindow(slot, record);
  if (!(window.end > window.start)) return 0;
  const getEstimatedIntervalSeconds = (startAt, endAt, actualSeconds = null) => {
    const startTs = Number(startAt) || 0;
    const endTs = Number(endAt) || 0;
    if (!startTs || !endTs || endTs <= startTs) return 0;
    const overlapStart = Math.max(startTs, window.start);
    const overlapEnd = Math.min(endTs, window.end);
    if (overlapEnd <= overlapStart) return 0;
    const overlapSeconds = Math.max(0, Math.round((overlapEnd - overlapStart) / 1000));
    const actual = Number(actualSeconds);
    if (!(actual > 0)) return overlapSeconds;
    const totalSpanSeconds = Math.max(0, Math.round((endTs - startTs) / 1000));
    if (!(totalSpanSeconds > 0)) return overlapSeconds;
    return Math.max(0, Math.round(actual * (overlapSeconds / totalSpanSeconds)));
  };
  const getPersonalOperationFactSeconds = () => {
    const personalOps = Array.isArray(card?.personalOperations) ? card.personalOperations : [];
    const related = personalOps.filter(entry => String(entry?.parentOpId || '') === String(op?.id || ''));
    if (!related.length) return 0;
    return related.reduce((sum, personalOp) => {
      const rawSegments = Array.isArray(personalOp?.historySegments) && personalOp.historySegments.length
        ? personalOp.historySegments
        : [personalOp];
      const segmentSeconds = rawSegments.reduce((segmentSum, segment) => {
        const startedAt = Number(segment?.firstStartedAt || segment?.startedAt || personalOp?.firstStartedAt || personalOp?.startedAt) || 0;
        if (!startedAt) return segmentSum;
        const liveExtraSeconds = Number(segment?.startedAt) > 0
          ? Math.max(0, Math.round((Date.now() - Number(segment.startedAt)) / 1000))
          : 0;
        const storedActualSeconds = Math.max(
          0,
          Number.isFinite(Number(segment?.actualSeconds))
            ? Number(segment.actualSeconds)
            : (Number.isFinite(Number(segment?.elapsedSeconds)) ? Number(segment.elapsedSeconds) : 0)
        );
        const actualSeconds = storedActualSeconds + liveExtraSeconds;
        const finishedAt = Number(
          segment?.finishedAt
          || (Number(segment?.startedAt) > 0 ? Date.now() : 0)
          || personalOp?.finishedAt
          || personalOp?.lastPausedAt
          || 0
        ) || 0;
        return segmentSum + getEstimatedIntervalSeconds(startedAt, finishedAt, actualSeconds);
      }, 0);
      return sum + segmentSeconds;
    }, 0);
  };
  const opRouteId = String(op?.id || '').trim();
  const entries = (Array.isArray(card.logs) ? card.logs : [])
    .filter(entry => {
      if (!entry) return false;
      const targetId = String(entry.targetId || '').trim();
      return targetId === opRouteId && String(entry.field || '').trim() === 'status';
    })
    .slice()
    .sort((a, b) => (a.ts || 0) - (b.ts || 0));
  let activeStart = null;
  let totalMs = 0;
  entries.forEach(entry => {
    const prev = String(entry.oldValue || '').trim().toUpperCase();
    const next = String(entry.newValue || '').trim().toUpperCase();
    const ts = Number(entry.ts) || 0;
    if (!ts) return;
    if (next === 'IN_PROGRESS' && prev !== 'IN_PROGRESS') {
      if (activeStart == null) activeStart = ts;
      return;
    }
    if (prev === 'IN_PROGRESS' && next !== 'IN_PROGRESS' && activeStart != null) {
      const from = Math.max(activeStart, window.start);
      const to = Math.min(ts, window.end);
      if (to > from) totalMs += (to - from);
      activeStart = null;
    }
  });
  if (activeStart != null) {
    const from = Math.max(activeStart, window.start);
    const to = Math.min(window.end, Date.now());
    if (to > from) totalMs += (to - from);
  }
  const logSeconds = Math.max(0, Math.round(totalMs / 1000));
  const personalSeconds = getPersonalOperationFactSeconds();
  if (personalSeconds > 0) return Math.max(personalSeconds, logSeconds);
  if (logSeconds > 0) return logSeconds;
  const fallbackStartAt = Number(op?.firstStartedAt || op?.startedAt) || 0;
  const liveExtraSeconds = Number(op?.startedAt) > 0
    ? Math.max(0, Math.round((Date.now() - Number(op.startedAt)) / 1000))
    : 0;
  const fallbackActualSeconds = Math.max(
    0,
    (Number.isFinite(Number(op?.actualSeconds)) ? Number(op.actualSeconds) : (Number.isFinite(Number(op?.elapsedSeconds)) ? Number(op.elapsedSeconds) : 0))
    + liveExtraSeconds
  );
  const fallbackEndAt = Number(op?.finishedAt || op?.lastPausedAt || (Number(op?.startedAt) > 0 ? Date.now() : 0)) || 0;
  return getEstimatedIntervalSeconds(fallbackStartAt, fallbackEndAt, fallbackActualSeconds);
}

function getProductionShiftCloseComments(op, slot, record = null) {
  const window = getProductionShiftCloseWindow(slot, record);
  return (Array.isArray(op?.comments) ? op.comments : [])
    .filter(entry => {
      const ts = Number(entry?.createdAt || entry?.ts) || 0;
      return ts >= window.start && ts <= window.end;
    })
    .map(entry => ({
      id: String(entry?.id || ''),
      text: String(entry?.text || '').trim(),
      author: String(entry?.author || '').trim(),
      ts: Number(entry?.createdAt || entry?.ts) || 0
    }))
    .filter(entry => entry.text);
}

function getProductionShiftCloseOperationCounts(task, card, op) {
  const list = op?.isSamples
    ? getFlowSamplesForOperation(card?.flow || {}, op)
    : (Array.isArray(card?.flow?.items) ? card.flow.items : []);
  const latestByItemId = new Map();
  list.forEach(item => {
    const itemId = String(item?.id || '');
    if (!itemId) return;
    const history = Array.isArray(item?.history) ? item.history : [];
    history.forEach(entry => {
      const shiftDate = String(entry?.shiftDate || '').trim();
      const shiftNum = parseInt(entry?.shift, 10) || 0;
      const opId = String(entry?.opId || '').trim();
      const areaId = String(entry?.areaId || '').trim();
      const status = String(entry?.status || '').trim().toUpperCase();
      const ts = Number(entry?.at || entry?.ts || entry?.createdAt) || 0;
      if (shiftDate !== String(task?.date || '')) return;
      if (shiftNum !== (parseInt(task?.shift, 10) || 1)) return;
      if (opId !== String(op?.id || '')) return;
      if (areaId && areaId !== String(task?.areaId || '')) return;
      if (!['GOOD', 'DELAYED', 'DEFECT'].includes(status)) return;
      const prev = latestByItemId.get(itemId);
      if (!prev || ts >= prev.ts) {
        latestByItemId.set(itemId, { status, ts });
      }
    });
  });
  const counts = { good: 0, delayed: 0, defect: 0 };
  latestByItemId.forEach(entry => {
    if (entry.status === 'GOOD') counts.good += 1;
    if (entry.status === 'DELAYED') counts.delayed += 1;
    if (entry.status === 'DEFECT') counts.defect += 1;
  });
  return counts;
}

function getProductionShiftCloseOperationItemStats(task, card, op) {
  if (!task || !card || !op) {
    return {
      counts: { good: 0, delayed: 0, defect: 0 },
      totalLabels: [],
      onOpLabels: [],
      goodLabels: [],
      delayedLabels: [],
      defectLabels: [],
      pendingLabels: []
    };
  }
  const list = op?.isSamples
    ? getFlowSamplesForOperation(card?.flow || {}, op)
    : (Array.isArray(card?.flow?.items) ? card.flow.items : []);
  const labelsByItemId = new Map();
  const latestByItemId = new Map();
  list.forEach(item => {
    const itemId = String(item?.id || '').trim();
    if (!itemId) return;
    const itemLabel = getProductionShiftCloseItemDisplayLabel(item) || itemId;
    labelsByItemId.set(itemId, itemLabel);
    const history = Array.isArray(item?.history) ? item.history : [];
    history.forEach(entry => {
      const shiftDate = String(entry?.shiftDate || '').trim();
      const shiftNum = parseInt(entry?.shift, 10) || 0;
      const opId = String(entry?.opId || '').trim();
      const areaId = String(entry?.areaId || '').trim();
      const status = String(entry?.status || '').trim().toUpperCase();
      const ts = Number(entry?.at || entry?.ts || entry?.createdAt) || 0;
      if (shiftDate !== String(task?.date || '')) return;
      if (shiftNum !== (parseInt(task?.shift, 10) || 1)) return;
      if (opId !== String(op?.id || '')) return;
      if (areaId && areaId !== String(task?.areaId || '')) return;
      if (!['GOOD', 'DELAYED', 'DEFECT'].includes(status)) return;
      const prev = latestByItemId.get(itemId);
      if (!prev || ts >= prev.ts) {
        latestByItemId.set(itemId, { status, ts });
      }
    });
  });
  const counts = { good: 0, delayed: 0, defect: 0 };
  const goodLabels = [];
  const delayedLabels = [];
  const defectLabels = [];
  latestByItemId.forEach((entry, itemId) => {
    const itemLabel = labelsByItemId.get(itemId) || itemId;
    if (entry.status === 'GOOD') {
      counts.good += 1;
      goodLabels.push(itemLabel);
    }
    if (entry.status === 'DELAYED') {
      counts.delayed += 1;
      delayedLabels.push(itemLabel);
    }
    if (entry.status === 'DEFECT') {
      counts.defect += 1;
      defectLabels.push(itemLabel);
    }
  });
  const onOpLabels = list
    .filter(item => String(item?.current?.opId || '').trim() === String(op?.id || '').trim())
    .map(item => getProductionShiftCloseItemDisplayLabel(item))
    .filter(Boolean);
  const pendingLabels = list
    .filter(item => String(item?.current?.opId || '').trim() === String(op?.id || '').trim())
    .filter(item => String(item?.current?.status || '').trim().toUpperCase() === 'PENDING')
    .map(item => getProductionShiftCloseItemDisplayLabel(item))
    .filter(Boolean);
  return {
    counts,
    totalLabels: list.map(item => getProductionShiftCloseItemDisplayLabel(item)).filter(Boolean),
    onOpLabels,
    goodLabels,
    delayedLabels,
    defectLabels,
    pendingLabels
  };
}

function getProductionShiftCloseSubcontractItemStats(task, card, op) {
  const items = getSubcontractTaskItems(task, card, op);
  const counts = { good: 0, delayed: 0, defect: 0, pending: 0, total: 0 };
  const totalLabels = [];
  const goodLabels = [];
  const delayedLabels = [];
  const defectLabels = [];
  const pendingLabels = [];
  items.forEach(item => {
    const label = getProductionShiftCloseItemDisplayLabel(item);
    if (label) totalLabels.push(label);
    counts.total += 1;
    const finalStatus = String(item?.finalStatus || item?.current?.status || '').trim().toUpperCase();
    if (finalStatus === 'GOOD') {
      counts.good += 1;
      if (label) goodLabels.push(label);
    } else if (finalStatus === 'DELAYED') {
      counts.delayed += 1;
      if (label) delayedLabels.push(label);
    } else if (finalStatus === 'DEFECT') {
      counts.defect += 1;
      if (label) defectLabels.push(label);
    } else {
      counts.pending += 1;
      if (label) pendingLabels.push(label);
    }
  });
  return { counts, totalLabels, goodLabels, delayedLabels, defectLabels, pendingLabels };
}

function getProductionShiftCloseMasterNames(dateStr, shift) {
  const masters = getProductionShiftEmployees(dateStr, PRODUCTION_SHIFT_MASTER_AREA_ID, shift);
  return Array.isArray(masters?.employeeNames) ? masters.employeeNames.slice() : [];
}

function getProductionShiftCloseAreaFactSeconds(rows) {
  const byArea = new Map();
  rows.forEach(row => {
    const key = String(row?.areaId || '');
    if (!key) return;
    byArea.set(key, (byArea.get(key) || 0) + Math.max(0, Number(row?.factSeconds || 0)));
  });
  if (!byArea.size) return 0;
  const total = Array.from(byArea.values()).reduce((sum, value) => sum + value, 0);
  return Math.round(total / byArea.size);
}

function getProductionShiftCloseProjectedLoadPct(target, addMinutes = 0) {
  const shiftMinutes = getShiftDurationMinutesForArea(target?.shift, target?.areaId);
  const plannedMinutes = getShiftPlannedMinutes(target?.date, target?.shift, target?.areaId);
  return Math.round(((plannedMinutes + Math.max(0, Number(addMinutes) || 0)) / Math.max(1, shiftMinutes)) * 100);
}

function compareProductionShiftSlots(a, b) {
  if (String(a?.date || '') !== String(b?.date || '')) {
    return String(a?.date || '').localeCompare(String(b?.date || ''));
  }
  return (parseInt(a?.shift, 10) || 1) - (parseInt(b?.shift, 10) || 1);
}

function buildProductionShiftCloseShiftOptions(selectedShift = '', { includeEmpty = false } = {}) {
  const normalizedShift = Number.isFinite(Number(selectedShift)) ? (parseInt(selectedShift, 10) || 1) : null;
  const options = [];
  if (includeEmpty) {
    options.push('<option value="">—</option>');
  }
  getProductionShiftNumbers().forEach(shift => {
    options.push(
      `<option value="${shift}"${normalizedShift === shift ? ' selected' : ''}>${shift} смена</option>`
    );
  });
  return options.join('');
}

function getProductionShiftCloseDraftTarget(actionState) {
  const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(String(actionState?.targetDate || '').trim())
    ? String(actionState.targetDate).trim()
    : '';
  const rawShift = String(actionState?.targetShift ?? '').trim();
  const targetShift = rawShift && Number.isFinite(Number(rawShift))
    ? (parseInt(rawShift, 10) || 1)
    : null;
  return { targetDate, targetShift };
}

function getProductionShiftCloseTransferTargetError(validation) {
  const reason = String(validation?.reason || '').trim();
  if (reason === 'missing_target') return 'Укажите дату и смену для передачи';
  if (reason === 'invalid_shift') return 'Выбрана недопустимая смена';
  if (reason === 'target_not_future') return 'Передавать можно только в будущую смену';
  if (reason === 'target_fixed') return 'Целевая смена зафиксирована';
  if (reason === 'target_closed') return 'Нельзя передавать в закрытую или заблокированную смену';
  if (reason === 'target_status_not_allowed') return 'Передача разрешена только в смены PLANNING и OPEN';
  return 'Не удалось проверить целевую смену';
}

function findNextAvailableSubcontractTransferTarget(row, startTarget = null) {
  const base = startTarget && startTarget.date
    ? { date: String(startTarget.date || ''), shift: parseInt(startTarget.shift, 10) || 1 }
    : { date: String(row?.date || ''), shift: parseInt(row?.shift, 10) || 1 };
  let cursor = base;
  for (let guard = 0; guard < 366 * 6; guard += 1) {
    cursor = moveShiftSlot(cursor, 1);
    ensureProductionShift(cursor.date, cursor.shift, { reason: 'data' });
    if (isShiftFixed(cursor.date, cursor.shift)) continue;
    const status = getProductionShiftStatus(cursor.date, cursor.shift);
    if (status === 'CLOSED' || status === 'LOCKED') continue;
    return {
      date: cursor.date,
      shift: cursor.shift,
      areaId: String(row?.areaId || ''),
      projectedLoadPct: getProductionShiftCloseProjectedLoadPct({
        date: cursor.date,
        shift: cursor.shift,
        areaId: String(row?.areaId || '')
      }, row?.remainingMinutes || 0)
    };
  }
  return null;
}

function validateProductionShiftCloseTransferTarget(row, actionState, { logSource = '' } = {}) {
  const { targetDate, targetShift } = getProductionShiftCloseDraftTarget(actionState);
  const logValidation = (result) => {
    if (!logSource) return result;
    try {
      console.log('[ROUTE] shift close transfer target:validate', {
        source: logSource,
        rowKey: row?.key || '',
        targetDate,
        targetShift,
        ok: result.ok,
        reason: result.reason || '',
        targetStatus: result.targetStatus || ''
      });
    } catch (e) {}
    return result;
  };
  if (!row?.date || !Number.isFinite(parseInt(row?.shift, 10))) {
    return logValidation({ ok: false, reason: 'missing_target' });
  }
  if (!targetDate || !targetShift) {
    return logValidation({ ok: false, reason: 'missing_target' });
  }
  const availableShifts = getProductionShiftNumbers();
  if (availableShifts.length && !availableShifts.includes(targetShift)) {
    return logValidation({ ok: false, reason: 'invalid_shift' });
  }
  const target = {
    date: targetDate,
    shift: targetShift,
    areaId: String(row.areaId || '')
  };
  if (compareProductionShiftSlots(target, { date: row.date, shift: row.shift }) <= 0) {
    return logValidation({ ok: false, reason: 'target_not_future' });
  }
  ensureProductionShift(target.date, target.shift, { reason: 'data' });
  if (row?.isSubcontract) {
    const resolvedTarget = findNextAvailableSubcontractTransferTarget(row, target);
    if (!resolvedTarget) {
      return logValidation({ ok: false, reason: 'target_status_not_allowed' });
    }
    return logValidation({
      ok: true,
      target: resolvedTarget,
      targetStatus: getProductionShiftStatus(resolvedTarget.date, resolvedTarget.shift)
    });
  }
  if (isShiftFixed(target.date, target.shift)) {
    return logValidation({ ok: false, reason: 'target_fixed' });
  }
  const targetStatus = getProductionShiftStatus(target.date, target.shift);
  if (targetStatus === 'CLOSED' || targetStatus === 'LOCKED') {
    return logValidation({ ok: false, reason: 'target_closed', targetStatus });
  }
  if (!['PLANNING', 'OPEN'].includes(targetStatus)) {
    return logValidation({ ok: false, reason: 'target_status_not_allowed', targetStatus });
  }
  const projectedLoadPct = getProductionShiftCloseProjectedLoadPct(target, row?.remainingMinutes || 0);
  return logValidation({
    ok: true,
    target: { ...target, projectedLoadPct },
    targetStatus
  });
}

function findProductionShiftCloseTransferTarget(row) {
  if (row?.isSubcontract) {
    return findNextAvailableSubcontractTransferTarget(row);
  }
  const currentSlot = { date: row?.date, shift: row?.shift };
  const areaId = String(row?.areaId || '');
  if (!currentSlot.date || !areaId) return null;
  try {
    console.log('[ROUTE] shift close transfer lookup:start', {
      rowKey: row?.key || '',
      date: currentSlot.date,
      shift: currentSlot.shift,
      areaId
    });
  } catch (e) {}
  ensureProductionShiftsFromData();
  const candidateKeys = new Set();
  (productionSchedule || []).forEach(rec => {
    if (String(rec?.areaId || '') !== areaId) return;
    const slot = { date: String(rec?.date || ''), shift: parseInt(rec?.shift, 10) || 1 };
    if (!slot.date || compareProductionShiftSlots(slot, currentSlot) <= 0) return;
    candidateKeys.add(shiftSlotKey(slot.date, slot.shift));
  });
  getVisibleProductionShiftTasks().forEach(task => {
    if (String(task?.areaId || '') !== areaId) return;
    const slot = { date: String(task?.date || ''), shift: parseInt(task?.shift, 10) || 1 };
    if (!slot.date || compareProductionShiftSlots(slot, currentSlot) <= 0) return;
    candidateKeys.add(shiftSlotKey(slot.date, slot.shift));
  });
  const candidates = Array.from(candidateKeys).map(key => {
    const [date, shiftRaw] = key.split('|');
    return { date, shift: parseInt(shiftRaw, 10) || 1, areaId };
  }).sort(compareProductionShiftSlots);
  for (const candidate of candidates) {
    if (isShiftFixed(candidate.date, candidate.shift)) continue;
    const status = getProductionShiftStatus(candidate.date, candidate.shift);
    if (status === 'CLOSED' || status === 'LOCKED') continue;
    const hasEmployees = getProductionShiftEmployees(candidate.date, areaId, candidate.shift).employeeIds.length > 0;
    const hasTasks = getProductionShiftTasksForCell(candidate.date, candidate.shift, areaId).length > 0;
    if (!hasEmployees && !hasTasks) continue;
    const projectedLoadPct = getProductionShiftCloseProjectedLoadPct(candidate, row?.remainingMinutes || 0);
    try {
      console.log('[ROUTE] shift close transfer lookup:found', {
        rowKey: row?.key || '',
        date: candidate.date,
        shift: candidate.shift,
        areaId: candidate.areaId,
        projectedLoadPct
      });
    } catch (e) {}
    return { ...candidate, hasEmployees, hasTasks, projectedLoadPct };
  }
  try {
    console.log('[ROUTE] shift close transfer lookup:none', {
      rowKey: row?.key || '',
      date: currentSlot.date,
      shift: currentSlot.shift,
      areaId
    });
  } catch (e) {}
  return null;
}

function buildProductionShiftCloseLiveRow(task, slot, record) {
  const card = (cards || []).find(item => String(item?.id || '') === String(task?.cardId || '')) || null;
  const op = (card?.operations || []).find(item => String(item?.id || '') === String(task?.routeOpId || '')) || null;
  const rowKey = getProductionShiftCloseRowKey(task);
  let factSeconds = getProductionShiftCloseFactSeconds(card, op, slot, record);
  const comments = getProductionShiftCloseComments(op, slot, record);
  const isSubcontract = isSubcontractTask(task);
  const isDrying = Boolean(op && isDryingOperation(op));
  const isQtyDriven = Boolean(card && op && isQtyDrivenPlanningOperation(card, op));
  const itemStats = (card && op)
    ? (isSubcontract ? getProductionShiftCloseSubcontractItemStats(task, card, op) : getProductionShiftCloseOperationItemStats(task, card, op))
    : {
      counts: { good: 0, delayed: 0, defect: 0 },
      totalLabels: [],
      onOpLabels: [],
      goodLabels: [],
      delayedLabels: [],
      defectLabels: [],
      pendingLabels: []
    };
  const counts = itemStats.counts || { good: 0, delayed: 0, defect: 0 };
  const unitLabel = getPlanningUnitLabel(op || task);
  const status = String(op?.status || '').toUpperCase();
  const dryingRows = isDrying && typeof buildDryingRows === 'function'
    ? buildDryingRows(card, op)
    : [];
  const dryingHasDonePowder = isDrying && dryingRows.some(row => String(row?.status || '').toUpperCase() === 'DONE');
  const dryingFullMinutes = isDrying
    ? Math.max(0, roundPlanningMinutes(
      Number(task?.plannedTotalMinutes || task?.plannedPartMinutes || getOperationTotalMinutes(card?.id, op?.id) || 0)
    ))
    : 0;
  const dryingNeedsResolution = isDrying && status !== 'DONE';
  const dryingResolutionLabel = dryingFullMinutes > 0
    ? `Полное время сушки: ${dryingFullMinutes} мин`
    : 'Полное время сушки';
  const dryingResolutionDisplay = dryingFullMinutes > 0 ? `${dryingFullMinutes} мин` : 'Сушка';
  const minutesPerUnit = Number(task?.minutesPerUnitSnapshot) > 0
    ? Number(task.minutesPerUnitSnapshot)
    : Number(getOperationPlanningSnapshot(task?.cardId, task?.routeOpId)?.minutesPerUnit || 0);
  const plannedQty = isQtyDriven ? Math.max(0, getTaskPlannedQuantity(task)) : 0;
  const plannedMinutes = Math.max(0, getTaskPlannedMinutes(task));
  const completedQty = isDrying
    ? (dryingNeedsResolution ? 0 : 1)
    : Math.max(0, counts.good + counts.delayed + counts.defect);
  const remainingQty = isSubcontract
    ? Math.max(0, Number(counts.pending || 0))
    : (isDrying
      ? (dryingNeedsResolution ? 1 : 0)
      : (isQtyDriven ? Math.max(0, roundPlanningQty(plannedQty - completedQty)) : 0));
  const overflowQty = isDrying ? 0 : (isQtyDriven ? Math.max(0, roundPlanningQty(completedQty - plannedQty)) : 0);
  if (!(factSeconds > 0) && isQtyDriven && completedQty > 0 && minutesPerUnit > 0) {
    factSeconds = Math.max(0, Math.round(minutesPerUnit * completedQty * 60));
  }
  const remainingMinutes = isSubcontract
    ? getTaskPlannedMinutes(task)
    : (isDrying
      ? dryingFullMinutes
      : (isQtyDriven && minutesPerUnit > 0 ? roundPlanningMinutes(minutesPerUnit * remainingQty) : 0));
  const canResolveRemaining = isSubcontract
    ? ((status === 'IN_PROGRESS' || status === 'PAUSED') && !hasNextSubcontractChainTask(task))
    : (isDrying ? dryingNeedsResolution : (isQtyDriven && remainingQty > 0));
  const completedLabels = []
    .concat(itemStats.goodLabels || [])
    .concat(itemStats.delayedLabels || [])
    .concat(itemStats.defectLabels || []);
  const allItemLabels = Array.isArray(itemStats.totalLabels) ? itemStats.totalLabels.slice() : [];
  const uniqueLabels = (list) => Array.from(new Set((Array.isArray(list) ? list : []).filter(Boolean)));
  const completedUnique = uniqueLabels(completedLabels);
  const pendingUnique = uniqueLabels(itemStats.pendingLabels || []);
  const allUnique = uniqueLabels(allItemLabels);
  const planLabels = (() => {
    if (isSubcontract) return allUnique;
    if (isDrying) return [dryingResolutionLabel];
    if (!(plannedQty > 0)) return [];
    const pool = uniqueLabels([].concat(allUnique, completedUnique, pendingUnique));
    return pool.slice(0, Math.max(0, plannedQty));
  })();
  const remainingLabels = (() => {
    if (isSubcontract) return pendingUnique;
    if (isDrying) return dryingNeedsResolution ? [dryingResolutionLabel] : [];
    if (!(remainingQty > 0)) return [];
    const planSet = new Set(planLabels);
    const completedSet = new Set(completedUnique);
    const primary = planLabels.filter(label => !completedSet.has(label));
    const secondary = pendingUnique.filter(label => !primary.includes(label));
    const tertiary = allUnique.filter(label => planSet.has(label) && !completedSet.has(label) && !primary.includes(label) && !secondary.includes(label));
    const fallback = allUnique.filter(label => !completedSet.has(label) && !primary.includes(label) && !secondary.includes(label) && !tertiary.includes(label));
    return uniqueLabels([].concat(primary, secondary, tertiary, fallback)).slice(0, Math.max(0, remainingQty));
  })();
  const overflowLabels = (() => {
    if (isSubcontract || !(overflowQty > 0)) return [];
    return completedUnique.slice(Math.max(0, plannedQty), Math.max(0, plannedQty) + Math.max(0, overflowQty));
  })();
  return {
    key: rowKey,
    rowType: 'live',
    date: String(task?.date || ''),
    shift: parseInt(task?.shift, 10) || 1,
    areaId: String(task?.areaId || ''),
    areaName: getPlanningTaskAreaName(task?.areaId),
    cardId: String(card?.id || task?.cardId || ''),
    routeOpId: String(op?.id || task?.routeOpId || ''),
    opId: String(op?.opId || task?.opId || ''),
    taskId: String(task?.id || ''),
    subcontractChainId: String(task?.subcontractChainId || ''),
    isSubcontract,
    isDrying,
    routeCardNumber: String(card?.routeCardNumber || '').trim(),
    itemName: String(card?.itemName || card?.name || '').trim() || 'Маршрутная карта',
    executorName: (op?.executor || '').trim(),
    opCode: String(op?.opCode || task?.opCode || '').trim(),
    opName: String(op?.opName || op?.name || task?.opName || '').trim(),
    planDisplay: isSubcontract
      ? `${counts.total || 0}`
      : (isDrying
      ? dryingResolutionDisplay
      : (isQtyDriven
      ? `${unitLabel === 'изд' ? 'Изд.' : unitLabel}: ${formatPlanningQtyValue(plannedQty)}`
      : '-')),
    goodDisplay: (isQtyDriven || isSubcontract) ? String(counts.good) : '—',
    delayedDisplay: (isQtyDriven || isSubcontract) ? String(counts.delayed) : '—',
    defectDisplay: (isQtyDriven || isSubcontract) ? String(counts.defect) : '—',
    overflowDisplay: isQtyDriven ? String(overflowQty) : '—',
    factDisplay: factSeconds > 0 ? formatSecondsToHMS(factSeconds) : '—',
    remainingDisplay: isDrying
      ? (dryingNeedsResolution ? dryingResolutionDisplay : 'вЂ”')
      : ((isQtyDriven || isSubcontract) ? String(remainingQty) : 'вЂ”'),
    remainingDisplay: isDrying
      ? (dryingNeedsResolution ? dryingResolutionDisplay : '-')
      : ((isQtyDriven || isSubcontract) ? String(remainingQty) : '-'),
    comments,
    commentsText: comments.map(entry => `${entry.author ? `${entry.author}: ` : ''}${entry.text}`).join('\n'),
    planLabels,
    goodLabels: itemStats.goodLabels || [],
    delayedLabels: itemStats.delayedLabels || [],
    defectLabels: itemStats.defectLabels || [],
    remainingLabels,
    overflowLabels,
    plannedQty,
    plannedMinutes,
    completedQty,
    remainingQty,
    overflowQty,
    remainingMinutes,
    factSeconds,
    isQtyDriven,
    canResolveRemaining,
    status,
    dryingHasDonePowder,
    hasNextPlannedPart: isSubcontract ? hasNextSubcontractChainTask(task) : false,
    isCompleted: isSubcontract ? remainingQty === 0 : (isDrying ? !dryingNeedsResolution : (isQtyDriven ? remainingQty === 0 : ['DONE', 'NO_ITEMS'].includes(String(op?.status || '').toUpperCase()))),
    minutesPerUnit
  };
}

function getProductionShiftClosePersonalOperationCounts(task, card, op, personalOp) {
  if (!card || !op || !personalOp) {
    return { good: 0, delayed: 0, defect: 0 };
  }
  const items = typeof getPersonalOperationItemsUi === 'function'
    ? getPersonalOperationItemsUi(card, op, personalOp)
    : [];
  const latestByItemId = new Map();
  items.forEach(item => {
    const itemId = String(item?.id || '');
    if (!itemId) return;
    const history = Array.isArray(item?.history) ? item.history : [];
    history.forEach(entry => {
      const shiftDate = String(entry?.shiftDate || '').trim();
      const shiftNum = parseInt(entry?.shift, 10) || 0;
      const opId = String(entry?.opId || '').trim();
      const areaId = String(entry?.areaId || '').trim();
      const status = String(entry?.status || '').trim().toUpperCase();
      const ts = Number(entry?.at || entry?.ts || entry?.createdAt) || 0;
      if (shiftDate !== String(task?.date || '')) return;
      if (shiftNum !== (parseInt(task?.shift, 10) || 1)) return;
      if (opId !== String(op?.id || '')) return;
      if (areaId && areaId !== String(task?.areaId || '')) return;
      if (!['GOOD', 'DELAYED', 'DEFECT'].includes(status)) return;
      const prev = latestByItemId.get(itemId);
      if (!prev || ts >= prev.ts) {
        latestByItemId.set(itemId, { status, ts });
      }
    });
  });
  const counts = { good: 0, delayed: 0, defect: 0 };
  latestByItemId.forEach(entry => {
    if (entry.status === 'GOOD') counts.good += 1;
    if (entry.status === 'DELAYED') counts.delayed += 1;
    if (entry.status === 'DEFECT') counts.defect += 1;
  });
  return counts;
}

function getProductionShiftCloseItemDisplayLabel(item) {
  return String(item?.displayName || item?.label || item?.name || item?.sampleName || item?.title || item?.qr || item?.id || '').trim();
}

function getProductionShiftCloseFlowItemsPool(card, op) {
  if (!card || !op) return [];
  const flow = card.flow || {};
  return op?.isSamples
    ? (typeof getFlowSamplesForOperation === 'function' ? getFlowSamplesForOperation(flow, op) : [])
    : (Array.isArray(flow.items) ? flow.items : []);
}

function getProductionShiftClosePersonalOperationResolvedItems(card, op, personalOp) {
  if (!card || !op || !personalOp) return [];
  const ownedIds = new Set((Array.isArray(personalOp?.itemIds) ? personalOp.itemIds : []).map(itemId => String(itemId || '').trim()).filter(Boolean));
  if (!ownedIds.size) return [];
  const fullList = getProductionShiftCloseFlowItemsPool(card, op);
  const resolvedFromFlow = fullList.filter(item => ownedIds.has(String(item?.id || '').trim()));
  if (resolvedFromFlow.length) return resolvedFromFlow;
  const directItems = typeof getPersonalOperationItemsUi === 'function'
    ? getPersonalOperationItemsUi(card, op, personalOp)
    : [];
  if (directItems.length) return directItems;
  return [];
}

function getProductionShiftClosePersonalOperationStats(task, card, op, personalOp) {
  if (!card || !op || !personalOp) {
    return {
      counts: { good: 0, delayed: 0, defect: 0 },
      planLabels: [],
      goodLabels: [],
      delayedLabels: [],
      defectLabels: [],
      remainingLabels: [],
      overflowLabels: []
    };
  }
  const items = getProductionShiftClosePersonalOperationResolvedItems(card, op, personalOp);
  const ownedIds = (Array.isArray(personalOp?.itemIds) ? personalOp.itemIds : [])
    .map(itemId => String(itemId || '').trim())
    .filter(Boolean);
  const labelsByItemId = new Map();
  const latestByItemId = new Map();
  items.forEach(item => {
    const itemId = String(item?.id || '').trim();
    const itemLabel = getProductionShiftCloseItemDisplayLabel(item);
    if (itemId && itemLabel) labelsByItemId.set(itemId, itemLabel);
    const history = Array.isArray(item?.history) ? item.history : [];
    history.forEach(entry => {
      const shiftDate = String(entry?.shiftDate || '').trim();
      const shiftNum = parseInt(entry?.shift, 10) || 0;
      const opId = String(entry?.opId || '').trim();
      const areaId = String(entry?.areaId || '').trim();
      const status = String(entry?.status || '').trim().toUpperCase();
      const ts = Number(entry?.at || entry?.ts || entry?.createdAt) || 0;
      if (shiftDate !== String(task?.date || '')) return;
      if (shiftNum !== (parseInt(task?.shift, 10) || 1)) return;
      if (opId !== String(op?.id || '')) return;
      if (areaId && areaId !== String(task?.areaId || '')) return;
      if (!['GOOD', 'DELAYED', 'DEFECT'].includes(status)) return;
      const prev = latestByItemId.get(itemId);
      if (!prev || ts >= prev.ts) {
        latestByItemId.set(itemId, { status, ts });
      }
    });
  });
  const statusBuckets = {
    GOOD: [],
    DELAYED: [],
    DEFECT: []
  };
  ownedIds.forEach(itemId => {
    const status = String(latestByItemId.get(itemId)?.status || '').trim().toUpperCase();
    if (statusBuckets[status]) {
      statusBuckets[status].push(itemId);
    }
  });
  const counts = {
    good: statusBuckets.GOOD.length,
    delayed: statusBuckets.DELAYED.length,
    defect: statusBuckets.DEFECT.length
  };
  const mapLabels = (ids) => ids.map(itemId => labelsByItemId.get(itemId) || itemId).filter(Boolean);
  const goodLabels = mapLabels(statusBuckets.GOOD);
  const delayedLabels = mapLabels(statusBuckets.DELAYED);
  const defectLabels = mapLabels(statusBuckets.DEFECT);
  const completedSet = new Set([].concat(statusBuckets.GOOD, statusBuckets.DELAYED, statusBuckets.DEFECT));
  const remainingIds = ownedIds.filter(itemId => !completedSet.has(itemId));
  const planLabels = mapLabels(ownedIds);
  return {
    counts,
    planLabels,
    goodLabels,
    delayedLabels,
    defectLabels,
    remainingLabels: mapLabels(remainingIds),
    overflowLabels: []
  };
}

function getProductionShiftClosePersonalFactSeconds(card, op, personalOp, slot, record = null) {
  if (!card || !op || !personalOp || !slot?.date) return 0;
  const window = getProductionShiftCloseWindow(slot, record);
  if (!(window.end > window.start)) return 0;
  const getEstimatedIntervalSeconds = (startAt, endAt, actualSeconds = null) => {
    const startTs = Number(startAt) || 0;
    const endTs = Number(endAt) || 0;
    if (!startTs || !endTs || endTs <= startTs) return 0;
    const overlapStart = Math.max(startTs, window.start);
    const overlapEnd = Math.min(endTs, window.end);
    if (overlapEnd <= overlapStart) return 0;
    const overlapSeconds = Math.max(0, Math.round((overlapEnd - overlapStart) / 1000));
    const actual = Number(actualSeconds);
    if (!(actual > 0)) return overlapSeconds;
    const totalSpanSeconds = Math.max(0, Math.round((endTs - startTs) / 1000));
    if (!(totalSpanSeconds > 0)) return overlapSeconds;
    return Math.max(0, Math.round(actual * (overlapSeconds / totalSpanSeconds)));
  };
  const rawSegments = Array.isArray(personalOp?.historySegments) && personalOp.historySegments.length
    ? personalOp.historySegments
    : [personalOp];
  return rawSegments.reduce((sum, segment) => {
    const startedAt = Number(segment?.firstStartedAt || segment?.startedAt || personalOp?.firstStartedAt || personalOp?.startedAt) || 0;
    if (!startedAt) return sum;
    const liveExtraSeconds = Number(segment?.startedAt) > 0
      ? Math.max(0, Math.round((Date.now() - Number(segment.startedAt)) / 1000))
      : 0;
    const storedActualSeconds = Math.max(
      0,
      Number.isFinite(Number(segment?.actualSeconds))
        ? Number(segment.actualSeconds)
        : (Number.isFinite(Number(segment?.elapsedSeconds)) ? Number(segment.elapsedSeconds) : 0)
    );
    const actualSeconds = storedActualSeconds + liveExtraSeconds;
    const finishedAt = Number(
      segment?.finishedAt
      || (Number(segment?.startedAt) > 0 ? Date.now() : 0)
      || personalOp?.finishedAt
      || personalOp?.lastPausedAt
      || 0
    ) || 0;
    return sum + getEstimatedIntervalSeconds(startedAt, finishedAt, actualSeconds);
  }, 0);
}

function buildProductionShiftClosePersonalRows(parentRow, slot, record = null) {
  if (!parentRow?.cardId || !parentRow?.routeOpId) return [];
  const card = (cards || []).find(item => String(item?.id || '') === String(parentRow.cardId || '')) || null;
  const op = (card?.operations || []).find(item => String(item?.id || '') === String(parentRow.routeOpId || '')) || null;
  if (!card || !op || typeof getCardPersonalOperationsUi !== 'function') return [];
  const personalOperations = getCardPersonalOperationsUi(card, op.id);
  if (!personalOperations.length) return [];
  const taskLike = {
    date: parentRow.date,
    shift: parentRow.shift,
    areaId: parentRow.areaId
  };
  return personalOperations.map(personalOp => {
    const personalStats = getProductionShiftClosePersonalOperationStats(taskLike, card, op, personalOp);
    const counts = personalStats.counts;
    const totalQty = Array.isArray(personalOp?.itemIds)
      ? personalOp.itemIds.map(itemId => String(itemId || '').trim()).filter(Boolean).length
      : 0;
    const pendingQty = Array.isArray(personalStats.remainingLabels)
      ? personalStats.remainingLabels.length
      : 0;
    const completedQty = Math.max(0, counts.good + counts.delayed + counts.defect);
    let factSeconds = getProductionShiftClosePersonalFactSeconds(card, op, personalOp, slot, record);
    if (!(factSeconds > 0) && Number(parentRow?.minutesPerUnit || 0) > 0 && completedQty > 0) {
      factSeconds = Math.max(0, Math.round(Number(parentRow.minutesPerUnit) * completedQty * 60));
    }
    const status = typeof normalizePersonalOperationStatusUi === 'function'
      ? normalizePersonalOperationStatusUi(personalOp?.status)
      : String(personalOp?.status || '').trim().toUpperCase();
    const itemLabel = typeof buildPersonalOperationItemLabelUi === 'function'
      ? buildPersonalOperationItemLabelUi(card, op, personalOp)
      : '';
    return {
      key: `${String(parentRow.key || '')}::personal::${String(personalOp?.id || '')}`,
      parentKey: String(parentRow.key || ''),
      rowType: 'personal',
      personalOperationId: String(personalOp?.id || ''),
      executorName: String(personalOp?.currentExecutorUserName || '').trim() || '—',
      opName: String(op?.opName || op?.name || parentRow?.opName || '').trim(),
      opSubLabel: 'Личная операция',
      planDisplay: totalQty > 0 ? `Взято: ${formatPlanningQtyValue(totalQty)}` : '—',
      goodDisplay: String(Math.max(0, counts.good || 0)),
      delayedDisplay: String(Math.max(0, counts.delayed || 0)),
      defectDisplay: String(Math.max(0, counts.defect || 0)),
      remainingDisplay: String(Math.max(0, pendingQty || 0)),
      overflowDisplay: '—',
      factDisplay: factSeconds > 0 ? formatSecondsToHMS(factSeconds) : '—',
      comments: [],
      factSeconds,
      isCompleted: status === 'DONE' || Math.max(0, pendingQty || 0) === 0,
      planQty: totalQty,
      goodQty: Math.max(0, counts.good || 0),
      delayedQty: Math.max(0, counts.delayed || 0),
      defectQty: Math.max(0, counts.defect || 0),
      remainingQty: Math.max(0, pendingQty || 0),
      overflowQty: 0,
      planLabels: personalStats.planLabels,
      goodLabels: personalStats.goodLabels,
      delayedLabels: personalStats.delayedLabels,
      defectLabels: personalStats.defectLabels,
      remainingLabels: personalStats.remainingLabels,
      overflowLabels: personalStats.overflowLabels
    };
  });
}

function renderProductionShiftCloseTooltipValue(valueText, {
  toneClass = ''
} = {}) {
  const safeValue = escapeHtml(valueText || '—');
  return toneClass
    ? `<span class="${toneClass} production-shift-close-tooltip-value">${safeValue}</span>`
    : `<span class="production-shift-close-tooltip-value">${safeValue}</span>`;
}

function renderProductionPlanPeopleMeta(employees) {
  const employeeIds = Array.isArray(employees?.employeeIds) ? employees.employeeIds : [];
  const employeeNames = Array.isArray(employees?.employeeNames) ? employees.employeeNames : [];
  const valueText = `Люди: ${employeeIds.length}`;
  const baseClass = employeeIds.length === 0
    ? 'production-shift-meta production-shift-meta-empty'
    : 'production-shift-meta';
  const lines = employeeNames
    .map(name => String(name || '').trim())
    .filter(Boolean)
    .map(line => escapeHtml(line));
  if (!lines.length) {
    return `<div class="${baseClass}">${escapeHtml(valueText)}</div>`;
  }
  const nativeTitle = lines.join('&#10;');
  return `
    <div class="${baseClass} has-tooltip" title="${nativeTitle}" aria-label="${escapeHtml([valueText].concat(employeeNames).join(': '))}">
      <span class="production-shift-close-tooltip-hitbox" title="${nativeTitle}">
        ${escapeHtml(valueText)}
      </span>
    </div>
  `;
}

function renderProductionShiftCloseTooltipCell(valueText, {
  title = '',
  labels = [],
  count = 0,
  toneClass = ''
} = {}) {
  const valueHtml = renderProductionShiftCloseTooltipValue(valueText, { toneClass });
  if (!(Number(count) > 0) || !Array.isArray(labels) || !labels.length) {
    return `<td>${valueHtml}</td>`;
  }
  const titleLines = [String(title || '').trim()]
    .concat(labels.map(label => String(label || '').trim()).filter(Boolean))
    .filter(Boolean)
    .map(line => escapeHtml(line));
  const nativeTitle = titleLines.join('&#10;');
  return `
    <td
      class="production-shift-close-tooltip-cell has-tooltip"
      title="${nativeTitle}"
      aria-label="${escapeHtml([title].concat(labels).join(': '))}"
    >
      <span class="production-shift-close-tooltip-hitbox" title="${nativeTitle}">
        ${valueHtml}
      </span>
    </td>
  `;
}

function buildProductionShiftCloseRenderGroups(rows, slot, record = null) {
  const list = Array.isArray(rows) ? rows : [];
  return list.map(row => ({
    mainRow: row,
    personalRows: buildProductionShiftClosePersonalRows(row, slot, record)
  }));
}

function renderProductionShiftCloseCommentsHtml(comments) {
  return Array.isArray(comments) && comments.length
    ? comments.map(entry => {
      const meta = [entry.author, entry.ts ? formatDateTime(entry.ts) : ''].filter(Boolean).join(' · ');
      return `<div class="production-shift-close-comment"><div class="muted">${escapeHtml(meta || 'Комментарий')}</div><div>${escapeHtml(entry.text || '')}</div></div>`;
    }).join('')
    : '—';
}

function getProductionShiftCloseActionRenderState(row, readonly, draft) {
  const actionState = !readonly ? (draft.rows[row.key] || null) : null;
  const resolutionText = readonly
    ? (row.resolutionText || '')
    : buildProductionShiftCloseResolutionText(row, actionState);
  let dateCellHtml = '—';
  let shiftCellHtml = '—';
  let actionsHtml = resolutionText ? escapeHtml(resolutionText) : '—';
  if (readonly) {
    if (row.resolutionAction === 'TRANSFER') {
      dateCellHtml = escapeHtml(formatProductionDisplayDate(row.resolutionTargetDate || '') || '—');
      shiftCellHtml = row.resolutionTargetShift ? escapeHtml(String(row.resolutionTargetShift)) : '—';
    }
    return { actionState, resolutionText, dateCellHtml, shiftCellHtml, actionsHtml };
  }
  if (!row.canResolveRemaining) {
    return { actionState, resolutionText, dateCellHtml, shiftCellHtml, actionsHtml };
  }
  const transferChecked = actionState?.action === 'TRANSFER' ? ' checked' : '';
  const replanChecked = actionState?.action === 'REPLAN' ? ' checked' : '';
  if (actionState?.action === 'TRANSFER') {
    const draftTarget = getProductionShiftCloseDraftTarget(actionState);
    dateCellHtml = `
      <input
        type="date"
        class="production-shift-close-target-input"
        data-row-key="${escapeHtml(row.key)}"
        data-target-field="date"
        value="${escapeHtml(draftTarget.targetDate || '')}"
      />
    `;
    shiftCellHtml = `
      <select
        class="production-shift-close-target-select"
        data-row-key="${escapeHtml(row.key)}"
        data-target-field="shift"
      >
        ${buildProductionShiftCloseShiftOptions(draftTarget.targetShift, { includeEmpty: true })}
      </select>
    `;
  }
  actionsHtml = row.isSubcontract
    ? `
      <label class="production-shift-close-check">
        <input type="checkbox" data-row-key="${escapeHtml(row.key)}" data-action-type="TRANSFER"${transferChecked} />
        <span>Перенести</span>
      </label>
    `
    : `
      <label class="production-shift-close-check">
        <input type="checkbox" data-row-key="${escapeHtml(row.key)}" data-action-type="TRANSFER"${transferChecked} />
        <span>Передать</span>
      </label>
      <label class="production-shift-close-check">
        <input type="checkbox" data-row-key="${escapeHtml(row.key)}" data-action-type="REPLAN"${replanChecked} />
        <span>Запланировать</span>
      </label>
    `;
  return { actionState, resolutionText, dateCellHtml, shiftCellHtml, actionsHtml };
}

function renderProductionShiftCloseCompactRows(groups, { readonly = false, draft = null, emptyText = 'Нет операций для выбранной смены.' } = {}) {
  const list = Array.isArray(groups) ? groups : [];
  if (!list.length) {
    return `<tr><td colspan="15" class="muted">${escapeHtml(emptyText)}</td></tr>`;
  }
  return list.map(group => {
    const row = group.mainRow;
    const personalRows = Array.isArray(group.personalRows) ? group.personalRows : [];
    const rowSpan = Math.max(1, 1 + personalRows.length);
    const commentsHtml = renderProductionShiftCloseCommentsHtml(row.comments);
    const actionState = getProductionShiftCloseActionRenderState(row, readonly, draft || { rows: {} });
    const mainRowHtml = `
      <tr data-row-key="${escapeHtml(row.key)}">
        <td rowspan="${rowSpan}">${renderPlanningAreaNameHtml(row.areaId, { name: row.areaName || '—', fallbackName: '—' })}</td>
        <td rowspan="${rowSpan}">${escapeHtml(row.routeCardNumber || '—')}</td>
        <td rowspan="${rowSpan}">${escapeHtml(row.itemName || '—')}</td>
        <td rowspan="${rowSpan}">${escapeHtml(row.opCode || '—')}</td>
        <td>${escapeHtml(row.opName || '—')}</td>
        <td>${escapeHtml(row.executorName || '—')}</td>
        ${renderProductionShiftCloseTooltipCell(row.planDisplay || '—', { title: 'План', labels: row.planLabels, count: row.plannedQty || 0 })}
        ${renderProductionShiftCloseTooltipCell(row.goodDisplay || '0', { title: 'Годно', labels: row.goodLabels, count: Number(row.goodDisplay === '—' ? 0 : row.goodDisplay || 0), toneClass: 'op-item-status-good' })}
        ${renderProductionShiftCloseTooltipCell(row.delayedDisplay || '0', { title: 'Задержано', labels: row.delayedLabels, count: Number(row.delayedDisplay === '—' ? 0 : row.delayedDisplay || 0), toneClass: 'op-item-status-delayed' })}
        ${renderProductionShiftCloseTooltipCell(row.defectDisplay || '0', { title: 'Брак', labels: row.defectLabels, count: Number(row.defectDisplay === '—' ? 0 : row.defectDisplay || 0), toneClass: 'op-item-status-defect' })}
        ${renderProductionShiftCloseTooltipCell(row.remainingDisplay || '0', { title: 'Осталось', labels: row.remainingLabels, count: row.remainingQty || 0 })}
        ${renderProductionShiftCloseTooltipCell(row.overflowDisplay || '0', { title: 'Сверх плана', labels: row.overflowLabels, count: row.overflowQty || 0 })}
        <td>${escapeHtml(row.factDisplay || '—')}</td>
        <td>${commentsHtml}</td>
        <td rowspan="${rowSpan}"><div class="production-shift-close-actions-cell">${actionState.actionsHtml}</div></td>
      </tr>
    `;
    const personalRowsHtml = personalRows.map(personalRow => `
      <tr class="production-shift-close-personal-row" data-parent-row-key="${escapeHtml(row.key)}" data-row-key="${escapeHtml(personalRow.key)}">
        <td><div>${escapeHtml(personalRow.opName || '—')}</div><div class="production-shift-close-personal-subtitle">${escapeHtml(personalRow.opSubLabel || 'Личная операция')}</div></td>
        <td>${escapeHtml(personalRow.executorName || '—')}</td>
        ${renderProductionShiftCloseTooltipCell(personalRow.planDisplay || '—', { title: 'Взято', labels: personalRow.planLabels, count: personalRow.planQty })}
        ${renderProductionShiftCloseTooltipCell(personalRow.goodDisplay || '0', { title: 'Годно', labels: personalRow.goodLabels, count: personalRow.goodQty, toneClass: 'op-item-status-good' })}
        ${renderProductionShiftCloseTooltipCell(personalRow.delayedDisplay || '0', { title: 'Задержано', labels: personalRow.delayedLabels, count: personalRow.delayedQty, toneClass: 'op-item-status-delayed' })}
        ${renderProductionShiftCloseTooltipCell(personalRow.defectDisplay || '0', { title: 'Брак', labels: personalRow.defectLabels, count: personalRow.defectQty, toneClass: 'op-item-status-defect' })}
        ${renderProductionShiftCloseTooltipCell(personalRow.remainingDisplay || '0', { title: 'Осталось', labels: personalRow.remainingLabels, count: personalRow.remainingQty })}
        ${renderProductionShiftCloseTooltipCell(personalRow.overflowDisplay || '—', { title: 'Сверх плана', labels: personalRow.overflowLabels, count: personalRow.overflowQty })}
        <td>${escapeHtml(personalRow.factDisplay || '—')}</td>
        <td>${renderProductionShiftCloseCommentsHtml(personalRow.comments)}</td>
      </tr>
    `).join('');
    return mainRowHtml + personalRowsHtml;
  }).join('');
}

function renderProductionShiftCloseExtendedRows(groups, { readonly = false, draft = null, emptyText = 'Нет операций для выбранной смены.' } = {}) {
  const list = Array.isArray(groups) ? groups : [];
  if (!list.length) {
    return `<tr><td colspan="17" class="muted">${escapeHtml(emptyText)}</td></tr>`;
  }
  return list.map(group => {
    const row = group.mainRow;
    const personalRows = Array.isArray(group.personalRows) ? group.personalRows : [];
    const rowSpan = Math.max(1, 1 + personalRows.length);
    const commentsHtml = renderProductionShiftCloseCommentsHtml(row.comments);
    const actionState = getProductionShiftCloseActionRenderState(row, readonly, draft || { rows: {} });
    const mainRowHtml = `
      <tr data-row-key="${escapeHtml(row.key)}"${row.isSubcontract ? ' class="is-subcontract-row"' : ''}>
        <td rowspan="${rowSpan}">${renderPlanningAreaNameHtml(row.areaId, { name: row.areaName || '—', fallbackName: '—' })}</td>
        <td rowspan="${rowSpan}">${escapeHtml(row.routeCardNumber || '—')}</td>
        <td rowspan="${rowSpan}">${escapeHtml(row.itemName || '—')}</td>
        <td rowspan="${rowSpan}">${escapeHtml(row.opCode || '—')}</td>
        <td>${escapeHtml(row.opName || '—')}</td>
        <td>${escapeHtml(row.executorName || '—')}</td>
        ${renderProductionShiftCloseTooltipCell(row.planDisplay || '—', { title: 'План', labels: row.planLabels, count: row.plannedQty || 0 })}
        ${renderProductionShiftCloseTooltipCell(row.goodDisplay || '0', { title: 'Годно', labels: row.goodLabels, count: Number(row.goodDisplay === '—' ? 0 : row.goodDisplay || 0), toneClass: 'op-item-status-good' })}
        ${renderProductionShiftCloseTooltipCell(row.delayedDisplay || '0', { title: 'Задержано', labels: row.delayedLabels, count: Number(row.delayedDisplay === '—' ? 0 : row.delayedDisplay || 0), toneClass: 'op-item-status-delayed' })}
        ${renderProductionShiftCloseTooltipCell(row.defectDisplay || '0', { title: 'Брак', labels: row.defectLabels, count: Number(row.defectDisplay === '—' ? 0 : row.defectDisplay || 0), toneClass: 'op-item-status-defect' })}
        ${renderProductionShiftCloseTooltipCell(row.remainingDisplay || '0', { title: 'Осталось', labels: row.remainingLabels, count: row.remainingQty || 0 })}
        ${renderProductionShiftCloseTooltipCell(row.overflowDisplay || '0', { title: 'Сверх плана', labels: row.overflowLabels, count: row.overflowQty || 0 })}
        <td>${escapeHtml(row.factDisplay || '—')}</td>
        <td>${commentsHtml}</td>
        <td rowspan="${rowSpan}">${actionState.dateCellHtml}</td>
        <td rowspan="${rowSpan}">${actionState.shiftCellHtml}</td>
        <td rowspan="${rowSpan}"><div class="production-shift-close-actions-cell">${actionState.actionsHtml}</div></td>
      </tr>
    `;
    const personalRowsHtml = personalRows.map(personalRow => `
      <tr class="production-shift-close-personal-row" data-parent-row-key="${escapeHtml(row.key)}" data-row-key="${escapeHtml(personalRow.key)}">
        <td><div>${escapeHtml(personalRow.opName || '—')}</div><div class="production-shift-close-personal-subtitle">${escapeHtml(personalRow.opSubLabel || 'Личная операция')}</div></td>
        <td>${escapeHtml(personalRow.executorName || '—')}</td>
        ${renderProductionShiftCloseTooltipCell(personalRow.planDisplay || '—', { title: 'Взято', labels: personalRow.planLabels, count: personalRow.planQty })}
        ${renderProductionShiftCloseTooltipCell(personalRow.goodDisplay || '0', { title: 'Годно', labels: personalRow.goodLabels, count: personalRow.goodQty, toneClass: 'op-item-status-good' })}
        ${renderProductionShiftCloseTooltipCell(personalRow.delayedDisplay || '0', { title: 'Задержано', labels: personalRow.delayedLabels, count: personalRow.delayedQty, toneClass: 'op-item-status-delayed' })}
        ${renderProductionShiftCloseTooltipCell(personalRow.defectDisplay || '0', { title: 'Брак', labels: personalRow.defectLabels, count: personalRow.defectQty, toneClass: 'op-item-status-defect' })}
        ${renderProductionShiftCloseTooltipCell(personalRow.remainingDisplay || '0', { title: 'Осталось', labels: personalRow.remainingLabels, count: personalRow.remainingQty })}
        ${renderProductionShiftCloseTooltipCell(personalRow.overflowDisplay || '—', { title: 'Сверх плана', labels: personalRow.overflowLabels, count: personalRow.overflowQty })}
        <td>${escapeHtml(personalRow.factDisplay || '—')}</td>
        <td>${renderProductionShiftCloseCommentsHtml(personalRow.comments)}</td>
      </tr>
    `).join('');
    return mainRowHtml + personalRowsHtml;
  }).join('');
}

function buildProductionShiftCloseRows(slot, record, { useSnapshot = false } = {}) {
  const snapshot = useSnapshot ? getProductionShiftCloseSnapshot(record) : null;
  if (snapshot && Array.isArray(snapshot.rows)) {
    return snapshot.rows.map(row => ({ ...row, rowType: 'snapshot' }));
  }
  return getVisibleProductionShiftTasks()
    .filter(task => task && task.date === slot.date && task.shift === slot.shift)
    .map(task => buildProductionShiftCloseLiveRow(task, slot, record));
}

function sortProductionShiftCloseRows(rows) {
  const sortKey = productionShiftCloseState.sortKey || 'remaining';
  const sortDir = productionShiftCloseState.sortDir === 'asc' ? 'asc' : 'desc';
  const direction = sortDir === 'asc' ? 1 : -1;
  const list = Array.isArray(rows) ? rows.slice() : [];
  const getValue = (row) => {
    if (sortKey === 'area') return row.areaName || '';
    if (sortKey === 'item') return row.itemName || '';
    if (sortKey === 'code') return row.opCode || '';
    if (sortKey === 'op') return row.opName || '';
    if (sortKey === 'card') return row.routeCardNumber || '';
    if (sortKey === 'executor') return row.executorName || '';
    if (sortKey === 'plan') return Number(row.plannedQty || 0);
    if (sortKey === 'good') return Number(row.goodDisplay === '—' ? 0 : row.goodDisplay);
    if (sortKey === 'delayed') return Number(row.delayedDisplay === '—' ? 0 : row.delayedDisplay);
    if (sortKey === 'defect') return Number(row.defectDisplay === '—' ? 0 : row.defectDisplay);
    if (sortKey === 'overflow') return Number(row.overflowQty || 0);
    if (sortKey === 'fact') return Number(row.factSeconds || 0);
    return Number(row.remainingQty || 0);
  };
  list.sort((a, b) => {
    const aValue = getValue(a);
    const bValue = getValue(b);
    if (typeof aValue === 'string' || typeof bValue === 'string') {
      const cmp = String(aValue).localeCompare(String(bValue), 'ru');
      if (cmp !== 0) return cmp * direction;
    } else if (aValue !== bValue) {
      return (aValue - bValue) * direction;
    }
    return String(a.key || '').localeCompare(String(b.key || ''));
  });
  return list;
}

function buildProductionShiftCloseSummary(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    plannedOps: list.length,
    completedOps: list.filter(row => row?.isCompleted).length,
    goodQty: list.reduce((sum, row) => sum + Math.max(0, Number(row?.goodDisplay === '—' ? 0 : row?.goodDisplay || 0)), 0),
    delayedQty: list.reduce((sum, row) => sum + Math.max(0, Number(row?.delayedDisplay === '—' ? 0 : row?.delayedDisplay || 0)), 0),
    defectQty: list.reduce((sum, row) => sum + Math.max(0, Number(row?.defectDisplay === '—' ? 0 : row?.defectDisplay || 0)), 0),
    averageAreaFactSeconds: getProductionShiftCloseAreaFactSeconds(list)
  };
}

function getProductionShiftCloseActionState(record, rowKey) {
  const draft = getProductionShiftCloseDraft(record);
  return draft.rows[rowKey] || null;
}

async function setProductionShiftCloseAction(record, row, actionType) {
  if (!record || !row?.key) return false;
  const draft = getProductionShiftCloseDraft(record);
  if (!actionType) {
    try {
      console.log('[ROUTE] shift close draft:clear', {
        shiftId: record.id,
        rowKey: row.key
      });
    } catch (e) {}
    delete draft.rows[row.key];
    draft.updatedAt = Date.now();
    draft.updatedBy = getCurrentUserName();
    return saveData();
  }
  if (actionType === 'TRANSFER') {
    const target = findProductionShiftCloseTransferTarget(row);
    if (!target) {
      showToast('Перенос невозможен: подходящая смена не найдена');
      return false;
    }
    try {
      console.log('[ROUTE] shift close draft:set', {
        shiftId: record.id,
        rowKey: row.key,
        action: 'TRANSFER',
        targetDate: target.date,
        targetShift: target.shift,
        targetAreaId: target.areaId,
        projectedLoadPct: target.projectedLoadPct
      });
    } catch (e) {}
    draft.rows[row.key] = {
      action: 'TRANSFER',
      targetDate: target.date,
      targetShift: target.shift,
      targetAreaId: target.areaId,
      projectedLoadPct: target.projectedLoadPct,
      updatedAt: Date.now(),
      updatedBy: getCurrentUserName()
    };
    draft.updatedAt = Date.now();
    draft.updatedBy = getCurrentUserName();
    showToast(`Остаток будет перенесён на ${formatProductionDisplayDate(target.date)}, смена ${target.shift}. Загрузка: ${target.projectedLoadPct}%`);
    return saveData();
  }
  try {
    console.log('[ROUTE] shift close draft:set', {
      shiftId: record.id,
      rowKey: row.key,
      action: 'REPLAN'
    });
  } catch (e) {}
  draft.rows[row.key] = {
    action: 'REPLAN',
    updatedAt: Date.now(),
    updatedBy: getCurrentUserName()
  };
  draft.updatedAt = Date.now();
  draft.updatedBy = getCurrentUserName();
  return saveData();
}

function buildProductionShiftCloseResolutionText(row, actionState) {
  if (!row?.canResolveRemaining) return '';
  if (actionState?.action === 'TRANSFER' && actionState?.targetDate) {
    return `${row?.isSubcontract ? 'Перенесено' : 'Передано'} на ${formatProductionDisplayDate(actionState.targetDate)}, смена ${actionState.targetShift}`;
  }
  if (actionState?.action === 'REPLAN') {
    return 'Передана в планирование';
  }
  return '';
}

function applyProductionShiftCloseToCurrentTask(task, row) {
  if (!task) return;
  if (row?.isDrying && row?.canResolveRemaining && Number(row?.remainingQty || 0) > 0) {
    productionShiftTasks = (productionShiftTasks || []).filter(item => String(item?.id || '') !== String(task.id || ''));
    return;
  }
  if (!row?.isQtyDriven) return;
  const completedQty = Math.max(0, roundPlanningQty(row.completedQty || 0));
  if (completedQty <= 0) {
    productionShiftTasks = (productionShiftTasks || []).filter(item => String(item?.id || '') !== String(task.id || ''));
    return;
  }
  const minutesPerUnit = Number(row.minutesPerUnit || task.minutesPerUnitSnapshot || 0);
  task.plannedPartQty = completedQty > 0 ? completedQty : undefined;
  if (minutesPerUnit > 0) {
    task.plannedPartMinutes = roundPlanningMinutes(minutesPerUnit * completedQty);
  }
}

function appendProductionShiftCloseTransferTask(row, target) {
  if (!row?.isQtyDriven || !(row.remainingQty > 0) || !target?.date) return;
  const existingTask = (productionShiftTasks || []).find(task => getProductionShiftCloseRowKey(task) === row.key) || null;
  const minutesPerUnit = Number(row.minutesPerUnit || existingTask?.minutesPerUnitSnapshot || 0);
  const newTask = {
    id: genId('pst'),
    cardId: row.cardId,
    routeOpId: row.routeOpId,
    opId: existingTask?.opId || row.opId,
    opName: existingTask?.opName || row.opName,
    date: target.date,
    shift: target.shift,
    areaId: target.areaId,
    plannedPartQty: roundPlanningQty(row.remainingQty),
    plannedPartMinutes: minutesPerUnit > 0 ? roundPlanningMinutes(minutesPerUnit * row.remainingQty) : undefined,
    plannedTotalQty: roundPlanningQty(row.remainingQty),
    plannedTotalMinutes: minutesPerUnit > 0 ? roundPlanningMinutes(minutesPerUnit * row.remainingQty) : undefined,
    minutesPerUnitSnapshot: minutesPerUnit > 0 ? minutesPerUnit : undefined,
    remainingQtySnapshot: roundPlanningQty(row.remainingQty),
    planningMode: String(existingTask?.planningMode || 'MANUAL').toUpperCase() || 'MANUAL',
    autoPlanRunId: String(existingTask?.autoPlanRunId || ''),
    sourceShiftDate: row.date,
    sourceShift: row.shift,
    createdAt: Date.now(),
    createdBy: getCurrentUserName()
  };
  productionShiftTasks = (productionShiftTasks || []).concat(newTask);
  if (canMutatePlanningDraftShift(target.date, target.shift)) {
    mergeProductionShiftTasksByKey(newTask, { preferredTaskId: newTask.id });
  }
}

function buildProductionShiftCloseOperationFacts(slot, rows) {
  const operationFacts = {};
  const seen = new Set();
  (Array.isArray(rows) ? rows : []).forEach(row => {
    const card = (cards || []).find(item => String(item?.id || '') === String(row?.cardId || '')) || null;
    const op = (card?.operations || []).find(item => String(item?.id || '') === String(row?.routeOpId || '')) || null;
    if (!card || !op) return;
    const key = getProductionShiftFactKey(card.id, op.id, slot?.date, slot?.shift);
    if (seen.has(key)) return;
    seen.add(key);
    operationFacts[key] = getProductionShiftOperationFactStats(card, op, slot?.date, slot?.shift);
  });
  return operationFacts;
}

async function finalizeProductionShiftClose(slot, routePath) {
  if (!ensureProductionEditAccess('production-shifts')) return;
  const record = ensureProductionShift(slot.date, slot.shift, { reason: 'data' });
  try {
    console.log('[ROUTE] shift close finalize:start', {
      date: slot?.date || '',
      shift: parseInt(slot?.shift, 10) || 1,
      routePath: routePath || '',
      shiftId: record?.id || ''
    });
  } catch (e) {}
  if (!record || record.status !== 'OPEN') {
    showToast('Закрыть можно только открытую смену');
    return;
  }
  const tasks = getVisibleProductionShiftTasks().filter(task => task.date === slot.date && task.shift === slot.shift);
  const hasInProgress = tasks.some(task => {
    const card = (cards || []).find(c => c.id === task.cardId);
    const op = (card?.operations || []).find(item => item.id === task.routeOpId);
    const status = String(op?.status || '').toUpperCase();
    return status === 'IN_PROGRESS' || status === 'PAUSED';
  });
  if (hasInProgress) {
    try {
      console.log('[ROUTE] shift close finalize:blocked', {
        date: slot?.date || '',
        shift: parseInt(slot?.shift, 10) || 1,
        reason: 'has_in_progress_or_paused'
      });
    } catch (e) {}
    showToast('Нельзя закрыть смену: есть операции в работе');
    return;
  }

  const draft = getProductionShiftCloseDraft(record);
  const liveRows = buildProductionShiftCloseRows(slot, record, { useSnapshot: false });
  try {
    console.log('[ROUTE] shift close finalize:rows', {
      shiftId: record.id,
      rowCount: liveRows.length,
      draftRows: Object.keys(draft.rows || {}).length
    });
  } catch (e) {}
  const unresolvedRows = liveRows.filter(row => row.canResolveRemaining && row.remainingQty > 0);
  const missingDecision = unresolvedRows.find(row => {
    const actionState = draft.rows[row.key];
    return !(actionState && (actionState.action === 'TRANSFER' || actionState.action === 'REPLAN'));
  });
  if (missingDecision) {
    try {
      console.log('[ROUTE] shift close finalize:blocked', {
        shiftId: record.id,
        reason: 'missing_decision',
        rowKey: missingDecision.key
      });
    } catch (e) {}
    showToast('Нужно выбрать действие для всех строк с остатком');
    return;
  }

  for (const row of unresolvedRows) {
    const actionState = draft.rows[row.key];
    if (actionState?.action === 'TRANSFER') {
      const target = findProductionShiftCloseTransferTarget(row);
      if (!target) {
        try {
          console.log('[ROUTE] shift close finalize:blocked', {
            shiftId: record.id,
            reason: 'transfer_target_not_found',
            rowKey: row.key
          });
        } catch (e) {}
        showToast(`Не удалось подтвердить перенос для операции ${row.opCode || row.opName}`);
        return;
      }
      actionState.targetDate = target.date;
      actionState.targetShift = target.shift;
      actionState.targetAreaId = target.areaId;
      actionState.projectedLoadPct = target.projectedLoadPct;
    }
  }

  unresolvedRows.forEach(row => {
    const actionState = draft.rows[row.key];
    const task = (productionShiftTasks || []).find(item => String(item?.id || '') === String(row.taskId || '')) || null;
    if (task) {
      applyProductionShiftCloseToCurrentTask(task, row);
    }
    if (actionState?.action === 'TRANSFER') {
      appendProductionShiftCloseTransferTask(row, {
        date: actionState.targetDate,
        shift: actionState.targetShift,
        areaId: actionState.targetAreaId
      });
      recordShiftLog(record, {
        action: 'SHIFT_CLOSE_TRANSFER',
        object: 'Операция',
        targetId: row.routeOpId || null,
        field: 'closeResolution',
        oldValue: '',
        newValue: `${actionState.targetDate} / смена ${actionState.targetShift}`
      });
      return;
    }
    recordShiftLog(record, {
      action: 'SHIFT_CLOSE_REPLAN',
      object: 'Операция',
      targetId: row.routeOpId || null,
      field: 'closeResolution',
      oldValue: '',
      newValue: 'Передана в планирование'
    });
  });

  const now = Date.now();
  const operationFacts = buildProductionShiftCloseOperationFacts(slot, liveRows);
  const snapshotRows = liveRows.map(row => {
    const actionState = draft.rows[row.key] || null;
    const factKey = getProductionShiftFactKey(row.cardId, row.routeOpId, slot.date, slot.shift);
    const factStats = normalizeProductionShiftFactStats(operationFacts[factKey]);
    return {
      ...row,
      shiftFactTotal: factStats.total,
      shiftFactGood: factStats.good,
      shiftFactDelayed: factStats.delayed,
      shiftFactDefect: factStats.defect,
      resolutionAction: actionState?.action || '',
      resolutionTargetDate: actionState?.targetDate || '',
      resolutionTargetShift: actionState?.targetShift || null,
      resolutionText: buildProductionShiftCloseResolutionText(row, actionState)
    };
  });
  const closeSnapshot = {
    savedAt: now,
    savedBy: getCurrentUserName(),
    routeKey: formatProductionShiftCloseRouteKey(slot.date, slot.shift),
    shiftMasterNames: getProductionShiftCloseMasterNames(slot.date, slot.shift),
    openedAt: Number(record.openedAt) || null,
    closedAt: now,
    operationFacts,
    rows: snapshotRows,
    summary: buildProductionShiftCloseSummary(snapshotRows)
  };
  appendProductionShiftCloseSnapshot(record, closeSnapshot);
  record.closePageDraft = { rows: {} };
  record.status = 'CLOSED';
  record.closedAt = now;
  record.closedBy = getCurrentUserName();
  recordShiftLog(record, {
    action: 'CLOSE_SHIFT',
    object: 'Смена',
    field: 'status',
    oldValue: 'OPEN',
    newValue: 'CLOSED'
  });
  await saveData();
  try {
    console.log('[ROUTE] shift close finalize:done', {
      shiftId: record.id,
      closedAt: now,
      snapshotRows: snapshotRows.length
    });
  } catch (e) {}
  await loadDataWithScope({ scope: DATA_SCOPE_PRODUCTION, force: true, reason: 'shift-close-finalize' });
  if (typeof handleRoute === 'function') {
    handleRoute(routePath || getProductionShiftClosePath(slot.date, slot.shift), {
      replace: true,
      fromHistory: true,
      soft: true
    });
  }
}

function lockShiftBySlot(slot) {
  if (!ensureProductionEditAccess('production-shifts')) return;
  const shiftRecord = ensureProductionShift(slot.date, slot.shift, { reason: 'data' });
  if (!shiftRecord) return;
  if (isShiftFixed(slot.date, slot.shift)) {
    showToast('Смена уже зафиксирована');
    return;
  }
  if (shiftRecord.status !== 'CLOSED') {
    showToast('Фиксировать можно только завершённую смену');
    return;
  }
  if (!confirm('Зафиксированную смену нельзя изменить. Зафиксировать смену?')) return;
  const now = Date.now();
  shiftRecord.isFixed = true;
  shiftRecord.fixedAt = now;
  shiftRecord.fixedBy = getCurrentUserName();
  shiftRecord.lockedAt = now;
  shiftRecord.lockedBy = getCurrentUserName();
  recordShiftLog(shiftRecord, {
    action: 'FIX_SHIFT',
    object: 'Смена',
    field: 'isFixed',
    oldValue: 'false',
    newValue: 'true'
  });
  saveData();
  renderProductionShiftBoardPage();
  showToast('Смена зафиксирована');
}

function unfixShiftBySlot(slot) {
  if (!ensureProductionEditAccess('production-shifts')) return;
  const shiftRecord = ensureProductionShift(slot.date, slot.shift, { reason: 'data' });
  if (!shiftRecord) return;
  const currentUserName = getCurrentUserName();
  if (currentUserName !== 'Abyss') {
    showToast('Снять фиксацию может только Abyss');
    return;
  }
  if (!isShiftFixed(slot.date, slot.shift)) return;
  if (!confirm('Снять фиксацию смены? После снятия смену можно будет изменить.')) return;
  shiftRecord.isFixed = false;
  recordShiftLog(shiftRecord, {
    action: 'UNFIX_SHIFT',
    object: 'Смена',
    field: 'isFixed',
    oldValue: 'true',
    newValue: 'false'
  });
  saveData();
  renderProductionShiftBoardPage();
  showToast('Фиксация смены снята');
}

const SHIFT_LOG_ACTION_UI = {
  ADD_TASK_TO_SHIFT: { text: 'Добавлена операция', icon: '➕', tech: false },
  REMOVE_TASK_FROM_SHIFT: { text: 'Удалена операция', icon: '➖', tech: false },
  MOVE_TASK_TO_SHIFT: { text: 'Перенесена операция', icon: '↔', tech: false },
  SUBCONTRACT_CHAIN_CREATE: { text: 'Создана цепочка субподрядчика', icon: '🔗', tech: false },
  SUBCONTRACT_CHAIN_DELETE: { text: 'Удалена цепочка субподрядчика', icon: '🗑️', tech: false },
  SUBCONTRACT_CHAIN_EXTEND: { text: 'Продлена цепочка субподрядчика', icon: '📈', tech: false },
  SUBCONTRACT_CHAIN_FINISH: { text: 'Завершена цепочка субподрядчика', icon: '✅', tech: false },
  SHIFT_CLOSE_TRANSFER: { text: 'Остаток передан', icon: '📦', tech: false },
  SHIFT_CLOSE_REPLAN: { text: 'Остаток передан в планирование', icon: '🗂', tech: false },
  OPEN_SHIFT: { text: 'Смена открыта', icon: '▶️', tech: false },
  CLOSE_SHIFT: { text: 'Смена завершена', icon: '⏹', tech: false },
  LOCK_SHIFT: { text: 'Смена зафиксирована', icon: '🔒', tech: false },
  FIX_SHIFT: { text: 'Смена зафиксирована', icon: '🔒', tech: false },
  UNFIX_SHIFT: { text: 'Снята фиксация смены', icon: '🔓', tech: false },
  CREATE_SNAPSHOT: { text: 'Создан снимок смены', icon: '🧩', tech: true }
};

const SHIFT_STATUS_UI = {
  PLANNING: 'Планирование',
  OPEN: 'Открыта',
  CLOSED: 'Завершена',
  LOCKED: 'Зафиксирована'
};

function getShiftLogBoundaries(entries) {
  const openTs = entries.find(e => e.action === 'OPEN_SHIFT')?.ts ?? null;
  const closeTs = entries.find(e => e.action === 'CLOSE_SHIFT')?.ts ?? null;
  const lockTs = entries.find(e => e.action === 'LOCK_SHIFT' || e.action === 'FIX_SHIFT')?.ts ?? null;
  return { openTs, closeTs, lockTs };
}

function getShiftLogSectionTitle(key) {
  if (key === 'planning') return '🟢 Планирование смены';
  if (key === 'work') return '▶️ Выполнение смены';
  if (key === 'closing') return '⏹ Завершение смены';
  if (key === 'locked') return '🔒 Фиксация смены';
  return 'События';
}

function detectShiftLogSection(entry, boundaries) {
  const ts = entry.ts || 0;
  const { openTs, closeTs, lockTs } = boundaries;
  if (!openTs) return 'planning';
  if (ts < openTs) return 'planning';
  if (openTs && (!closeTs || ts < closeTs)) return 'work';
  if (closeTs && (!lockTs || ts < lockTs)) return 'closing';
  if (lockTs && ts >= lockTs) return 'locked';
  return 'work';
}

function resolveShiftLogTarget(entry) {
  if (!entry?.targetId) return { title: '', details: '' };
  if (entry.object === 'Сотрудник') {
    const name = getProductionEmployeeName(entry.targetId);
    return { title: name, details: '' };
  }
  if (entry.object === 'Операция') {
    const routeOpId = String(entry.targetId);
    let foundCard = null;
    let foundOp = null;
    for (const c of (cards || [])) {
      const op = (c?.operations || []).find(o => String(o.id) === routeOpId);
      if (op) {
        foundCard = c;
        foundOp = op;
        break;
      }
    }
    const opName = (foundOp?.opName || foundOp?.name || '').trim();
    const cardLabel = foundCard ? getPlanningCardLabel(foundCard) : '';
    const title = opName || 'Операция';
    const details = cardLabel ? `МК: ${cardLabel}` : '';
    return { title, details };
  }
  return { title: `(${entry.targetId})`, details: '' };
}

function aggregateShiftLogEntries(entries) {
  const out = [];
  for (let i = 0; i < entries.length; i++) {
    const cur = entries[i];
    const canAgg = (cur.action === 'ADD_TASK_TO_SHIFT' || cur.action === 'REMOVE_TASK_FROM_SHIFT');
    if (!canAgg) {
      out.push(cur);
      continue;
    }
    const group = [cur];
    while (i + 1 < entries.length) {
      const next = entries[i + 1];
      if (
        next.action === cur.action &&
        next.createdBy === cur.createdBy &&
        next.object === cur.object
      ) {
        group.push(next);
        i++;
      } else {
        break;
      }
    }
    if (group.length === 1) {
      out.push(cur);
    } else {
      out.push({
        ...cur,
        __agg: true,
        __aggItems: group
      });
    }
  }
  return out;
}

function renderProductionShiftLog(slot) {
  const modal = document.getElementById('production-shift-log-modal');
  if (!modal) return;

  const meta = document.getElementById('production-shift-log-meta');
  const list = document.getElementById('production-shift-log-list');
  const techToggle = document.getElementById('production-shift-log-show-technical');
  const searchInput = document.getElementById('production-shift-log-search');
  const openPageBtn = document.getElementById('production-shift-log-open-page');

  const record = ensureProductionShift(slot.date, slot.shift, { reason: 'data' });
  const status = record?.status || 'PLANNING';
  const statusLabel = SHIFT_STATUS_UI[status] || status;

  const title = `${getShiftHeaderLabel(slot.date)} · ${slot.shift} смена · ${statusLabel}`;
  if (meta) meta.textContent = title;
  if (openPageBtn) {
    const canOpenPage = status === 'CLOSED' || status === 'LOCKED' || Boolean(record?.isFixed);
    if (canOpenPage) {
      openPageBtn.classList.remove('hidden');
      openPageBtn.setAttribute('data-route', getProductionShiftClosePath(slot.date, slot.shift));
    } else {
      openPageBtn.classList.add('hidden');
      openPageBtn.removeAttribute('data-route');
    }
  }

  const render = () => {
    if (!list) return;
    const showTech = !!techToggle?.checked;
    const q = (searchInput?.value || '').trim().toLowerCase();
    let entries = (record?.logs || []).slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));

    entries = entries.filter(e => {
      const cfg = SHIFT_LOG_ACTION_UI[e.action];
      if (!cfg) return showTech;
      if (cfg.tech) return showTech;
      return true;
    });

    if (!entries.length) {
      list.innerHTML = '<p class="muted">Событий пока нет.</p>';
      return;
    }

    const boundaries = getShiftLogBoundaries(entries.slice().sort((a, b) => (a.ts || 0) - (b.ts || 0)));
    const bySection = new Map();

    entries.forEach(e => {
      const sectionKey = detectShiftLogSection(e, boundaries);
      if (!bySection.has(sectionKey)) bySection.set(sectionKey, []);
      bySection.get(sectionKey).push(e);
    });

    const order = ['locked', 'closing', 'work', 'planning'].filter(k => bySection.has(k));

    const html = order.map(sectionKey => {
      const sectionEntries = bySection.get(sectionKey) || [];
      const aggregated = aggregateShiftLogEntries(sectionEntries);

      const filtered = aggregated.filter(e => {
        const cfg = SHIFT_LOG_ACTION_UI[e.action] || null;
        const baseText = cfg ? cfg.text : (e.action || '');
        const user = (e.createdBy || '');
        const date = e.ts ? new Date(e.ts).toLocaleString('ru-RU') : '';

        const collectTargets = () => {
          if (e.__agg) {
            return (e.__aggItems || []).map(it => resolveShiftLogTarget(it)).map(x => `${x.title} ${x.details}`).join(' ');
          }
          const t = resolveShiftLogTarget(e);
          return `${t.title} ${t.details}`;
        };

        const change = e.field
          ? `${e.field}: ${(SHIFT_STATUS_UI[e.oldValue] || e.oldValue)} → ${(SHIFT_STATUS_UI[e.newValue] || e.newValue)}`
          : '';

        const hay = [baseText, user, date, change, collectTargets()].join(' ').toLowerCase();
        return !q || hay.includes(q);
      });

      if (!filtered.length) return '';

      const sectionTitle = getShiftLogSectionTitle(sectionKey);

      const entriesHtml = filtered.map(entry => {
        const cfg = SHIFT_LOG_ACTION_UI[entry.action] || { text: entry.action || '', icon: '•', tech: true };
        const date = entry.ts ? new Date(entry.ts).toLocaleString('ru-RU') : '';
        const user = escapeHtml(entry.createdBy || '');

        const change = entry.field
          ? `${escapeHtml(entry.field)}: ${escapeHtml(SHIFT_STATUS_UI[entry.oldValue] || entry.oldValue)} → ${escapeHtml(SHIFT_STATUS_UI[entry.newValue] || entry.newValue)}`
          : '';

        if (entry.__agg) {
          const items = (entry.__aggItems || []).map(it => resolveShiftLogTarget(it));
          const itemsHtml = items.map(x => `<li>${escapeHtml(x.title)}${x.details ? ` <span class="muted">(${escapeHtml(x.details)})</span>` : ''}</li>`).join('');
          return `
            <div class="production-shift-log-entry">
              <div class="production-shift-log-title">
                <span class="production-shift-log-icon">${cfg.icon}</span>
                <span>${escapeHtml(cfg.text)} <span class="production-shift-log-badge">${items.length}</span></span>
              </div>
              <ul class="production-shift-log-agg-list">${itemsHtml}</ul>
              <div class="production-shift-log-meta-row muted">${user}${date ? ` · ${escapeHtml(date)}` : ''}</div>
            </div>
          `;
        }

        const target = resolveShiftLogTarget(entry);
        const targetLine = target.title
          ? `<div class="production-shift-log-change muted">${escapeHtml(target.title)}${target.details ? ` · ${escapeHtml(target.details)}` : ''}</div>`
          : '';

        return `
          <div class="production-shift-log-entry">
            <div class="production-shift-log-title">
              <span class="production-shift-log-icon">${cfg.icon}</span>
              <span>${escapeHtml(cfg.text)}</span>
            </div>
            ${targetLine}
            ${change ? `<div class="production-shift-log-change muted">${change}</div>` : ''}
            <div class="production-shift-log-meta-row muted">${user}${date ? ` · ${escapeHtml(date)}` : ''}</div>
          </div>
        `;
      }).join('');

      return `
        <div class="production-shift-log-section">
          <div class="production-shift-log-section-title">${escapeHtml(sectionTitle)}</div>
          <div class="production-shift-log-list-inner" style="display:flex;flex-direction:column;gap:10px;">
            ${entriesHtml}
          </div>
        </div>
      `;
    }).join('');

    list.innerHTML = html || '<p class="muted">Ничего не найдено.</p>';
  };

  if (!modal.dataset.logBound) {
    modal.dataset.logBound = 'true';
    techToggle?.addEventListener('change', render);
    searchInput?.addEventListener('input', render);
  }

  render();
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
  const openPageBtn = document.getElementById('production-shift-log-open-page');
  if (closeBtn) closeBtn.addEventListener('click', closeProductionShiftLogModal);
  if (openPageBtn) {
    openPageBtn.addEventListener('click', () => {
      const route = openPageBtn.getAttribute('data-route');
      if (!route) return;
      try {
        console.log('[ROUTE] shift log open close-page', { route });
      } catch (e) {}
      closeProductionShiftLogModal();
      if (typeof navigateToPath === 'function') {
        navigateToPath(route);
      } else if (typeof navigateToRoute === 'function') {
        navigateToRoute(route);
      }
    });
  }
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
      <button type="button" data-action="open-workspace">Открыть в РМ</button>
      <button type="button" data-action="open-workorders">Открыть в Трекере</button>
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
      if (action === 'open-workspace') {
        openProductionCardInRoute(cid, 'workspace');
        menu.classList.remove('open');
        return;
      }
      if (action === 'open-workorders') {
        openProductionCardInRoute(cid, 'workorders');
        menu.classList.remove('open');
        return;
      }
      if (action === 'open-new-tab') {
        const card = (cards || []).find(item => item.id === cid);
        const qr = normalizeQrId(card?.qrId || '');
        const targetId = isValidScanId(qr) ? qr : cid;
        const url = '/cards/' + encodeURIComponent(targetId);
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

function openProductionCardInRoute(cardId, routeKey) {
  const card = (cards || []).find(item => item.id === cardId) || null;
  if (!card) {
    showToast('Маршрутная карта не найдена');
    return;
  }
  const permissionKey = routeKey === 'workspace' ? 'workspace' : 'workorders';
  if (typeof canViewTab === 'function' && !canViewTab(permissionKey)) {
    showToast('Недостаточно прав доступа');
    return;
  }
  const qr = normalizeQrId(card.qrId || '');
  const targetId = isValidScanId(qr) ? qr : String(cardId || '');
  if (!targetId) {
    showToast('Маршрутная карта не найдена');
    return;
  }
  const path = `/${routeKey}/${encodeURIComponent(targetId)}`;
  if (typeof navigateToRoute === 'function') {
    navigateToRoute(path);
    return;
  }
  window.location.href = path;
}

function renderProductionShiftCloseError(message) {
  const section = document.getElementById('production-shift-close');
  if (!section) return;
  section.innerHTML = `
    <div class="card production-card production-shift-close-card">
      <div class="production-toolbar">
        <div class="production-toolbar__left">
          <h2>Закрытие смены</h2>
        </div>
      </div>
      <div class="production-shift-close-error">
        <h3>Ошибка</h3>
        <p>${escapeHtml(message || 'Не удалось открыть страницу смены')}</p>
        <div class="production-shift-close-actions">
          <button type="button" class="btn-secondary" id="production-shift-close-cancel">Отмена</button>
        </div>
      </div>
    </div>
  `;
  const cancelBtn = document.getElementById('production-shift-close-cancel');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      if (window.history.length > 1) {
        history.back();
      } else if (typeof navigateToPath === 'function') {
        navigateToPath('/production/shifts');
      }
    });
  }
}

function renderProductionShiftClosePage(routePath = '') {
  const section = document.getElementById('production-shift-close');
  if (!section) return;
  const parsed = parseProductionShiftCloseRoutePath(routePath || (window.location.pathname || ''));
  try {
    console.log('[ROUTE] renderProductionShiftClosePage:start', {
      routePath: routePath || (window.location.pathname || ''),
      parsed: parsed ? `${parsed.date}|${parsed.shift}` : null
    });
  } catch (e) {}
  if (!parsed) {
    renderProductionShiftCloseError('Некорректный адрес страницы закрытия смены');
    return;
  }

  const canonicalPath = getProductionShiftClosePath(parsed.date, parsed.shift);
  if ((window.location.pathname || '') !== canonicalPath) {
    try {
      history.replaceState(history.state || {}, '', canonicalPath);
    } catch (err) {
      console.warn('[ROUTE] shift close replaceState failed', err);
    }
  }

  ensureProductionShiftsFromData();
  const record = ensureProductionShift(parsed.date, parsed.shift, { reason: 'data' });
  if (!record) {
    renderProductionShiftCloseError('Смена не найдена');
    return;
  }

  const allowedStatus = record.status === 'OPEN' || record.status === 'CLOSED' || record.status === 'LOCKED' || Boolean(record.isFixed);
  if (!allowedStatus) {
    renderProductionShiftCloseError('Страница закрытия доступна только для открытой, завершённой или зафиксированной смены');
    return;
  }

  const readonly = isProductionRouteReadonly('production-shifts') || record.status !== 'OPEN' || isShiftFixed(parsed.date, parsed.shift);
  const allRows = buildProductionShiftCloseRows(parsed, record, { useSnapshot: readonly });
  const rows = sortProductionShiftCloseRows(filterProductionShiftCloseRows(allRows));
  const rowGroups = buildProductionShiftCloseRenderGroups(rows, parsed, record);
  const snapshot = readonly ? getProductionShiftCloseSnapshot(record) : null;
  const summary = snapshot?.summary || buildProductionShiftCloseSummary(allRows);
  const shiftMasters = snapshot?.shiftMasterNames || getProductionShiftCloseMasterNames(parsed.date, parsed.shift);
  const startLabel = (snapshot?.openedAt || record?.openedAt) ? formatDateTime(snapshot?.openedAt || record?.openedAt) : '—';
  const endLabel = formatDateTime(getProductionShiftCloseEndTimeValue(record, snapshot)) || '—';
  const statusLabel = SHIFT_STATUS_UI[record.status] || getShiftStatusLabel(parsed.date, parsed.shift);
  const draft = getProductionShiftCloseDraft(record);
  try {
    console.log('[ROUTE] renderProductionShiftClosePage:data', {
      routeKey: canonicalPath,
      shiftId: record.id,
      readonly,
      rowCount: allRows.length,
      filteredRowCount: rows.length,
      hasSnapshot: !!snapshot,
      draftRows: Object.keys(draft.rows || {}).length
    });
  } catch (e) {}

  const headers = [
    ['area', 'Участок'],
    ['card', 'Маршрутная карта №'],
    ['item', 'Наименование изделия'],
    ['code', 'Код операции'],
    ['op', 'Наименование операции'],
    ['executor', 'Исполнитель'],
    ['plan', 'План'],
    ['good', 'Годно'],
    ['delayed', 'Задержано'],
    ['defect', 'Брак'],
    ['remaining', 'Осталось'],
    ['overflow', 'Сверх плана'],
    ['fact', 'Текущее / факт. время'],
    ['comments', 'Комментарии'],
    ['actions', 'Действия']
  ];
  const headerHtml = headers.map(([key, label]) => {
    if (['comments', 'actions'].includes(key)) {
      return `<th>${escapeHtml(label)}</th>`;
    }
    const isActive = productionShiftCloseState.sortKey === key;
    const sortMark = isActive ? (productionShiftCloseState.sortDir === 'asc' ? ' ↑' : ' ↓') : '';
    return `<th><button type="button" class="production-shift-close-sort" data-sort-key="${key}">${escapeHtml(label)}${sortMark}</button></th>`;
  }).join('');

  const emptyText = normalizeQueueSearchValue(productionShiftCloseState.filterText)
    ? 'Нет операций, соответствующих фильтру.'
    : 'Нет операций для выбранной смены.';
  const rowsHtml = renderProductionShiftCloseCompactRows(rowGroups, { readonly, draft, emptyText });

  section.innerHTML = `
    <div class="card production-card production-shift-close-card">
      <div class="production-toolbar">
        <div class="production-toolbar__left">
          <h2>Закрытие смены</h2>
        </div>
      </div>
      <div class="production-shift-close-header">
        <div class="production-shift-close-header-main">
          <div class="production-shift-close-title">${escapeHtml(getShiftHeaderLabel(parsed.date))} · ${parsed.shift} смена</div>
          <div class="production-shift-close-status">${escapeHtml(statusLabel)}</div>
        </div>
        <div class="production-shift-close-meta-grid">
          <div><span class="muted">Начало смены:</span> ${escapeHtml(startLabel)}</div>
          <div><span class="muted">Завершение смены:</span> <span data-role="production-shift-close-end-value">${escapeHtml(endLabel)}</span></div>
          <div><span class="muted">Мастер смены:</span> ${escapeHtml(shiftMasters.join(', ') || '—')}</div>
        </div>
      </div>

      <div class="production-shift-close-summary">
        <div class="production-shift-close-summary-item">Запланировано операций: <strong>${summary.plannedOps}</strong></div>
        <div class="production-shift-close-summary-item">Выполнено операций: <strong>${summary.completedOps}</strong></div>
        <div class="production-shift-close-summary-item"><span class="op-item-status-good">Годных деталей: ${summary.goodQty} шт.</span></div>
        <div class="production-shift-close-summary-item"><span class="op-item-status-delayed">Задержанных деталей: ${summary.delayedQty} шт.</span></div>
        <div class="production-shift-close-summary-item"><span class="op-item-status-defect">Бракованных деталей: ${summary.defectQty} шт.</span></div>
        <div class="production-shift-close-summary-item">Среднее время работы участков: <strong>${formatSecondsToHMS(summary.averageAreaFactSeconds || 0)}</strong></div>
      </div>

      <div class="production-shift-close-filter-row">
        <label class="production-shift-close-filter-label" for="production-shift-close-filter">Фильтр</label>
        <input
          type="search"
          class="production-shift-close-filter-input"
          id="production-shift-close-filter"
          placeholder="Участок, МК, изделие, код или операция"
          value="${escapeHtml(productionShiftCloseState.filterText || '')}"
        />
      </div>

      <div class="production-shift-close-table-wrap">
        <table class="production-table production-shift-close-table">
          <thead><tr>${headerHtml}</tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>

      <div class="production-shift-close-footer">
        ${readonly ? '' : '<button type="button" class="btn-secondary btn-small" id="production-shift-close-transfer-all">Передать всё</button>'}
        ${readonly ? '' : '<button type="button" class="btn-secondary btn-small" id="production-shift-close-replan-all">Запланировать всё</button>'}
        ${readonly ? '' : '<button type="button" class="btn-primary" id="production-shift-close-confirm">Закрыть смену</button>'}
        <button type="button" class="btn-secondary" id="production-shift-close-print">Печать</button>
        <button type="button" class="btn-secondary" id="production-shift-close-cancel">Отмена</button>
      </div>
    </div>
  `;

  section.querySelectorAll('.production-shift-close-sort').forEach(button => {
    button.addEventListener('click', () => {
      const key = button.getAttribute('data-sort-key') || 'remaining';
      if (productionShiftCloseState.sortKey === key) {
        productionShiftCloseState.sortDir = productionShiftCloseState.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        productionShiftCloseState.sortKey = key;
        productionShiftCloseState.sortDir = key === 'remaining' ? 'desc' : 'asc';
      }
      renderProductionShiftClosePage(canonicalPath);
    });
  });

  const filterInput = document.getElementById('production-shift-close-filter');
  if (filterInput) {
    filterInput.addEventListener('input', () => {
      const nextValue = filterInput.value || '';
      const selectionStart = filterInput.selectionStart ?? nextValue.length;
      const selectionEnd = filterInput.selectionEnd ?? nextValue.length;
      productionShiftCloseState.filterText = nextValue;
      renderProductionShiftClosePage(canonicalPath);
      const nextInput = document.getElementById('production-shift-close-filter');
      if (nextInput) {
        nextInput.focus();
        nextInput.setSelectionRange(selectionStart, selectionEnd);
      }
    });
  }

  section.querySelectorAll('input[data-row-key][data-action-type]').forEach(input => {
    input.addEventListener('change', async () => {
      const rowKey = input.getAttribute('data-row-key') || '';
      const actionType = input.getAttribute('data-action-type') || '';
      const row = rows.find(item => item.key === rowKey);
      if (!row) return;
      const nextAction = input.checked ? actionType : '';
      await setProductionShiftCloseAction(record, row, nextAction);
      renderProductionShiftClosePage(canonicalPath);
    });
  });

  const transferAllBtn = document.getElementById('production-shift-close-transfer-all');
  if (transferAllBtn) {
    transferAllBtn.addEventListener('click', async () => {
      await applyProductionShiftCloseBulkAction(record, rows, 'TRANSFER');
      renderProductionShiftClosePage(canonicalPath);
    });
  }

  const replanAllBtn = document.getElementById('production-shift-close-replan-all');
  if (replanAllBtn) {
    replanAllBtn.addEventListener('click', async () => {
      await applyProductionShiftCloseBulkAction(record, rows, 'REPLAN');
      renderProductionShiftClosePage(canonicalPath);
    });
  }

  const confirmBtn = document.getElementById('production-shift-close-confirm');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', async () => {
      await finalizeProductionShiftClose(parsed, canonicalPath);
    });
  }

  const printBtn = document.getElementById('production-shift-close-print');
  if (printBtn) {
    printBtn.addEventListener('click', () => {
      openProductionShiftClosePrintPreview();
    });
  }

  const cancelBtn = document.getElementById('production-shift-close-cancel');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      if (window.history.length > 1) {
        history.back();
      } else if (typeof navigateToPath === 'function') {
        navigateToPath('/production/shifts');
      }
    });
  }

  bindProductionShiftCloseEndClock(section, { record, snapshot });
}

function findProductionShiftClosePreviewTask(record, rowKey) {
  const recordId = String(record?.id || '');
  const key = String(rowKey || '');
  if (!recordId || !key) return null;
  return (productionShiftTasks || []).find(task => (
    task?.closePagePreview === true
    && String(task?.closePageRecordId || '') === recordId
    && String(task?.closePageRowKey || '') === key
  )) || null;
}

function removeProductionShiftClosePreviewTask(record, rowKey) {
  const existing = findProductionShiftClosePreviewTask(record, rowKey);
  if (!existing) return false;
  productionShiftTasks = (productionShiftTasks || []).filter(task => String(task?.id || '') !== String(existing.id || ''));
  rebuildProductionShiftTasksIndex();
  return true;
}

function upsertProductionShiftClosePreviewTask(record, row, target) {
  if (!record || !row?.key || !target?.date) return null;
  const existingTask = (productionShiftTasks || []).find(task => getProductionShiftCloseRowKey(task) === row.key) || null;
  const minutesPerUnit = Number(row.minutesPerUnit || existingTask?.minutesPerUnitSnapshot || 0);
  let previewTask = findProductionShiftClosePreviewTask(record, row.key);
  if (!previewTask) {
    previewTask = {
      id: genId('pst'),
      cardId: row.cardId,
      routeOpId: row.routeOpId,
      opId: existingTask?.opId || row.opId,
      opName: existingTask?.opName || row.opName,
      createdAt: Date.now(),
      createdBy: getCurrentUserName()
    };
    productionShiftTasks = (productionShiftTasks || []).concat(previewTask);
  }
  previewTask.date = target.date;
  previewTask.shift = target.shift;
  previewTask.areaId = target.areaId;
  if (row.isSubcontract) {
    previewTask.subcontractChainId = String(row.subcontractChainId || existingTask?.subcontractChainId || '');
    previewTask.subcontractItemIds = Array.isArray(existingTask?.subcontractItemIds) ? existingTask.subcontractItemIds.slice() : [];
    previewTask.subcontractItemKind = String(existingTask?.subcontractItemKind || '');
    previewTask.subcontractExtendedChain = true;
    previewTask.plannedPartQty = undefined;
    previewTask.plannedPartMinutes = getShiftDurationMinutes(target.shift, { ignoreLunch: true });
    previewTask.plannedTotalQty = undefined;
    previewTask.plannedTotalMinutes = Number(existingTask?.plannedTotalMinutes || row.remainingMinutes || previewTask.plannedPartMinutes);
    previewTask.minutesPerUnitSnapshot = undefined;
    previewTask.remainingQtySnapshot = undefined;
  } else if (row.isDrying) {
    const dryingMinutes = Math.max(0, roundPlanningMinutes(
      Number(existingTask?.plannedTotalMinutes || existingTask?.plannedPartMinutes || row.remainingMinutes || 0)
    ));
    previewTask.plannedPartQty = undefined;
    previewTask.plannedPartMinutes = dryingMinutes > 0 ? dryingMinutes : undefined;
    previewTask.plannedTotalQty = undefined;
    previewTask.plannedTotalMinutes = dryingMinutes > 0 ? dryingMinutes : undefined;
    previewTask.minutesPerUnitSnapshot = undefined;
    previewTask.remainingQtySnapshot = undefined;
  } else {
    previewTask.plannedPartQty = roundPlanningQty(row.remainingQty);
    previewTask.plannedPartMinutes = minutesPerUnit > 0 ? roundPlanningMinutes(minutesPerUnit * row.remainingQty) : undefined;
    previewTask.plannedTotalQty = roundPlanningQty(row.remainingQty);
    previewTask.plannedTotalMinutes = minutesPerUnit > 0 ? roundPlanningMinutes(minutesPerUnit * row.remainingQty) : undefined;
    previewTask.minutesPerUnitSnapshot = minutesPerUnit > 0 ? minutesPerUnit : undefined;
    previewTask.remainingQtySnapshot = roundPlanningQty(row.remainingQty);
  }
  previewTask.planningMode = String(existingTask?.planningMode || 'MANUAL').toUpperCase() || 'MANUAL';
  previewTask.autoPlanRunId = String(existingTask?.autoPlanRunId || '');
  previewTask.fromShiftCloseTransfer = true;
  previewTask.subcontractExtendedChain = true;
  previewTask.shiftCloseSourceDate = row.date;
  previewTask.shiftCloseSourceShift = row.shift;
  previewTask.sourceShiftDate = row.date;
  previewTask.sourceShift = row.shift;
  previewTask.closePagePreview = true;
  previewTask.closePageRecordId = String(record.id || '');
  previewTask.closePageRowKey = String(row.key || '');
  rebuildProductionShiftTasksIndex();
  return previewTask;
}

async function persistProductionShiftCloseDraftMutation() {
  window.__productionLiveIgnoreUntil = Date.now() + 1500;
  return saveData();
}

async function syncProductionShiftCloseTransferPreview(record, row, actionState) {
  const validation = validateProductionShiftCloseTransferTarget(row, actionState, { logSource: 'preview-sync' });
  if (!validation.ok) {
    removeProductionShiftClosePreviewTask(record, row?.key);
    return validation;
  }
  upsertProductionShiftClosePreviewTask(record, row, validation.target);
  return validation;
}

function syncProductionShiftCloseDraftFromDom(section, record, rows = []) {
  if (!section || !record) return;
  const draft = getProductionShiftCloseDraft(record);
  section.querySelectorAll('[data-row-key][data-target-field]').forEach(input => {
    const rowKey = String(input.getAttribute('data-row-key') || '');
    const field = String(input.getAttribute('data-target-field') || '');
    const actionState = draft.rows[rowKey];
    const row = Array.isArray(rows) ? rows.find(item => item?.key === rowKey) : null;
    if (!actionState || actionState.action !== 'TRANSFER') return;
    if (field === 'date') {
      actionState.targetDate = /^\d{4}-\d{2}-\d{2}$/.test(String(input.value || '').trim())
        ? String(input.value).trim()
        : '';
    } else if (field === 'shift') {
      const value = String(input.value || '').trim();
      actionState.targetShift = value && Number.isFinite(Number(value))
        ? (parseInt(value, 10) || 1)
        : '';
    }
    actionState.targetAreaId = String(row?.areaId || actionState.targetAreaId || '');
  });
}

async function setProductionShiftCloseAction(record, row, actionType) {
  if (!ensureProductionEditAccess('production-shifts')) return false;
  if (!record || !row?.key) return false;
  const draft = getProductionShiftCloseDraft(record);
  if (!actionType) {
    try {
      console.log('[ROUTE] shift close draft:clear', {
        shiftId: record.id,
        rowKey: row.key
      });
    } catch (e) {}
    removeProductionShiftClosePreviewTask(record, row.key);
    delete draft.rows[row.key];
    draft.updatedAt = Date.now();
    draft.updatedBy = getCurrentUserName();
    return persistProductionShiftCloseDraftMutation();
  }
  if (actionType === 'TRANSFER') {
    const target = findProductionShiftCloseTransferTarget(row);
    try {
      console.log('[ROUTE] shift close draft:set', {
        shiftId: record.id,
        rowKey: row.key,
        action: 'TRANSFER',
        targetDate: target?.date || '',
        targetShift: target?.shift || null,
        targetAreaId: target?.areaId || String(row.areaId || ''),
        projectedLoadPct: target?.projectedLoadPct || null,
        hasDefaultTarget: !!target
      });
    } catch (e) {}
    draft.rows[row.key] = {
      action: 'TRANSFER',
      targetDate: target?.date || '',
      targetShift: target?.shift || '',
      targetAreaId: target?.areaId || String(row.areaId || ''),
      projectedLoadPct: target?.projectedLoadPct || null,
      updatedAt: Date.now(),
      updatedBy: getCurrentUserName()
    };
    draft.updatedAt = Date.now();
    draft.updatedBy = getCurrentUserName();
    if (target) {
      showToast(`Остаток будет перенесён на ${formatProductionDisplayDate(target.date)}, смена ${target.shift}. Загрузка: ${target.projectedLoadPct}%`);
    } else {
      showToast('Подходящая смена по умолчанию не найдена. Укажите дату и смену вручную.', 'warning');
    }
    await syncProductionShiftCloseTransferPreview(record, row, draft.rows[row.key]);
    return persistProductionShiftCloseDraftMutation();
  }
  if (row?.isSubcontract) {
    return false;
  }
  try {
    console.log('[ROUTE] shift close draft:set', {
      shiftId: record.id,
      rowKey: row.key,
      action: 'REPLAN'
    });
  } catch (e) {}
  draft.rows[row.key] = {
    action: 'REPLAN',
    updatedAt: Date.now(),
    updatedBy: getCurrentUserName()
  };
  removeProductionShiftClosePreviewTask(record, row.key);
  draft.updatedAt = Date.now();
  draft.updatedBy = getCurrentUserName();
  return persistProductionShiftCloseDraftMutation();
}

async function setProductionShiftCloseTransferTarget(record, row, { targetDate = '', targetShift = '' } = {}) {
  if (!ensureProductionEditAccess('production-shifts')) return false;
  if (!record || !row?.key) return false;
  const draft = getProductionShiftCloseDraft(record);
  const current = draft.rows[row.key];
  if (!current || current.action !== 'TRANSFER') return false;
  const nextDate = /^\d{4}-\d{2}-\d{2}$/.test(String(targetDate || '').trim())
    ? String(targetDate).trim()
    : '';
  const nextShift = String(targetShift ?? '').trim();
  current.targetDate = nextDate;
  current.targetShift = nextShift && Number.isFinite(Number(nextShift))
    ? (parseInt(nextShift, 10) || 1)
    : '';
  current.targetAreaId = String(row.areaId || '');
  const validation = validateProductionShiftCloseTransferTarget(row, current, { logSource: 'draft-change' });
  current.projectedLoadPct = validation.ok ? validation.target.projectedLoadPct : null;
  current.updatedAt = Date.now();
  current.updatedBy = getCurrentUserName();
  draft.updatedAt = Date.now();
  draft.updatedBy = getCurrentUserName();
  await syncProductionShiftCloseTransferPreview(record, row, current);
  return persistProductionShiftCloseDraftMutation();
}

async function applyProductionShiftCloseBulkAction(record, rows, actionType) {
  if (!ensureProductionEditAccess('production-shifts')) return false;
  if (!record || !Array.isArray(rows) || !rows.length) return false;
  const draft = getProductionShiftCloseDraft(record);
  const actionableRows = rows.filter(row => (
    row?.canResolveRemaining
    && Number(row?.remainingQty || 0) > 0
    && !(row?.isSubcontract && actionType === 'REPLAN')
  ));
  if (!actionableRows.length) return false;
  let missingDefaultTargets = 0;
  for (const row of actionableRows) {
    if (actionType === 'REPLAN') {
      removeProductionShiftClosePreviewTask(record, row.key);
      draft.rows[row.key] = {
        action: 'REPLAN',
        updatedAt: Date.now(),
        updatedBy: getCurrentUserName()
      };
      continue;
    }
    const current = draft.rows[row.key];
    const existingTarget = current?.action === 'TRANSFER'
      ? validateProductionShiftCloseTransferTarget(row, current)
      : { ok: false };
    const fallbackTarget = existingTarget.ok
      ? existingTarget.target
      : findProductionShiftCloseTransferTarget(row);
    if (!fallbackTarget) missingDefaultTargets += 1;
    draft.rows[row.key] = {
      action: 'TRANSFER',
      targetDate: fallbackTarget?.date || '',
      targetShift: fallbackTarget?.shift || '',
      targetAreaId: String(row.areaId || ''),
      projectedLoadPct: fallbackTarget?.projectedLoadPct || null,
      updatedAt: Date.now(),
      updatedBy: getCurrentUserName()
    };
    await syncProductionShiftCloseTransferPreview(record, row, draft.rows[row.key]);
  }
  draft.updatedAt = Date.now();
  draft.updatedBy = getCurrentUserName();
  try {
    console.log('[ROUTE] shift close draft:bulk-set', {
      shiftId: record.id,
      action: actionType,
      rowCount: actionableRows.length,
      missingDefaultTargets
    });
  } catch (e) {}
  await persistProductionShiftCloseDraftMutation();
  if (missingDefaultTargets > 0 && actionType === 'TRANSFER') {
    showToast(`Для ${missingDefaultTargets} строк не найдена смена по умолчанию. Укажите дату и смену вручную.`, 'warning');
  }
  return true;
}

function appendProductionShiftCloseTransferTask(record, row, target) {
  if (!row || !target?.date) return;
  const shiftRecord = ensureProductionShift(target.date, target.shift, { reason: 'data' });
  if (!shiftRecord) return;
  try {
    console.log('[ROUTE] shift close transfer target:create', {
      rowKey: row?.key || '',
      date: target.date,
      shift: target.shift,
      areaId: target.areaId,
      targetStatus: shiftRecord.status || ''
    });
  } catch (e) {}
  const existingTask = (productionShiftTasks || []).find(task => getProductionShiftCloseRowKey(task) === row.key) || null;
  const minutesPerUnit = Number(row.minutesPerUnit || existingTask?.minutesPerUnitSnapshot || 0);
  let finalTask = findProductionShiftClosePreviewTask(record, row.key);
  if (!finalTask) {
    finalTask = {
      id: genId('pst'),
      cardId: row.cardId,
      routeOpId: row.routeOpId,
      opId: existingTask?.opId || row.opId,
      opName: existingTask?.opName || row.opName,
      createdAt: Date.now(),
      createdBy: getCurrentUserName()
    };
    productionShiftTasks = (productionShiftTasks || []).concat(finalTask);
  }
  finalTask.date = target.date;
  finalTask.shift = target.shift;
  finalTask.areaId = target.areaId;
  if (row.isSubcontract) {
    finalTask.subcontractChainId = String(row.subcontractChainId || existingTask?.subcontractChainId || '');
    finalTask.subcontractItemIds = Array.isArray(existingTask?.subcontractItemIds) ? existingTask.subcontractItemIds.slice() : [];
    finalTask.subcontractItemKind = String(existingTask?.subcontractItemKind || '');
    finalTask.subcontractExtendedChain = true;
    finalTask.plannedPartMinutes = getShiftDurationMinutes(target.shift, { ignoreLunch: true });
    finalTask.plannedTotalMinutes = Number(existingTask?.plannedTotalMinutes || row.remainingMinutes || finalTask.plannedPartMinutes);
    finalTask.plannedPartQty = undefined;
    finalTask.plannedTotalQty = undefined;
    finalTask.minutesPerUnitSnapshot = undefined;
    finalTask.remainingQtySnapshot = undefined;
  } else if (row.isDrying) {
    const dryingMinutes = Math.max(0, roundPlanningMinutes(
      Number(existingTask?.plannedTotalMinutes || existingTask?.plannedPartMinutes || row.remainingMinutes || 0)
    ));
    finalTask.plannedPartQty = undefined;
    finalTask.plannedPartMinutes = dryingMinutes > 0 ? dryingMinutes : undefined;
    finalTask.plannedTotalQty = undefined;
    finalTask.plannedTotalMinutes = dryingMinutes > 0 ? dryingMinutes : undefined;
    finalTask.minutesPerUnitSnapshot = undefined;
    finalTask.remainingQtySnapshot = undefined;
  } else {
    finalTask.plannedPartQty = roundPlanningQty(row.remainingQty);
    finalTask.plannedPartMinutes = minutesPerUnit > 0 ? roundPlanningMinutes(minutesPerUnit * row.remainingQty) : undefined;
    finalTask.plannedTotalQty = roundPlanningQty(row.remainingQty);
    finalTask.plannedTotalMinutes = minutesPerUnit > 0 ? roundPlanningMinutes(minutesPerUnit * row.remainingQty) : undefined;
    finalTask.minutesPerUnitSnapshot = minutesPerUnit > 0 ? minutesPerUnit : undefined;
    finalTask.remainingQtySnapshot = roundPlanningQty(row.remainingQty);
  }
  finalTask.planningMode = String(existingTask?.planningMode || 'MANUAL').toUpperCase() || 'MANUAL';
  finalTask.autoPlanRunId = String(existingTask?.autoPlanRunId || '');
  finalTask.fromShiftCloseTransfer = true;
  finalTask.subcontractExtendedChain = true;
  finalTask.shiftCloseSourceDate = row.date;
  finalTask.shiftCloseSourceShift = row.shift;
  finalTask.sourceShiftDate = row.date;
  finalTask.sourceShift = row.shift;
  finalTask.closePagePreview = false;
  finalTask.closePageRecordId = '';
  finalTask.closePageRowKey = '';
  if (canMutatePlanningDraftShift(target.date, target.shift)) {
    mergeProductionShiftTasksByKey(finalTask, { preferredTaskId: finalTask.id });
  } else {
    rebuildProductionShiftTasksIndex();
  }
}

async function finalizeProductionShiftClose(slot, routePath) {
  const record = ensureProductionShift(slot.date, slot.shift, { reason: 'data' });
  const section = document.getElementById('production-shift-close');
  try {
    console.log('[ROUTE] shift close finalize:start', {
      date: slot?.date || '',
      shift: parseInt(slot?.shift, 10) || 1,
      routePath: routePath || '',
      shiftId: record?.id || ''
    });
  } catch (e) {}
  if (!record || record.status !== 'OPEN') {
    showToast('Закрыть можно только открытую смену');
    return;
  }
  const draft = getProductionShiftCloseDraft(record);
  const liveRows = buildProductionShiftCloseRows(slot, record, { useSnapshot: false });
  const blockingRow = liveRows.find(row => {
    const status = String(row?.status || '').toUpperCase();
    if (status !== 'IN_PROGRESS' && status !== 'PAUSED') return false;
    if (row?.isDrying && row?.canResolveRemaining && Number(row?.remainingQty || 0) > 0) return false;
    if (!row?.isSubcontract) return true;
    const actionState = draft.rows[row.key];
    return !row.hasNextPlannedPart && actionState?.action !== 'TRANSFER';
  });
  if (blockingRow) {
    try {
      console.log('[ROUTE] shift close finalize:blocked', {
        date: slot?.date || '',
        shift: parseInt(slot?.shift, 10) || 1,
        reason: 'has_in_progress_or_paused',
        rowKey: blockingRow.key || ''
      });
    } catch (e) {}
    showToast('Нельзя закрыть смену: есть операции в работе без продолжения на следующую смену');
    return;
  }
  syncProductionShiftCloseDraftFromDom(section, record, liveRows);
  for (const row of liveRows) {
    const actionState = draft.rows[row.key];
    if (actionState?.action === 'TRANSFER') {
      await syncProductionShiftCloseTransferPreview(record, row, actionState);
    }
  }
  try {
    console.log('[ROUTE] shift close finalize:rows', {
      shiftId: record.id,
      rowCount: liveRows.length,
      draftRows: Object.keys(draft.rows || {}).length
    });
  } catch (e) {}
  const unresolvedRows = liveRows.filter(row => row.canResolveRemaining && row.remainingQty > 0);
  const missingDecision = unresolvedRows.find(row => {
    const actionState = draft.rows[row.key];
    return !(actionState && (actionState.action === 'TRANSFER' || actionState.action === 'REPLAN'));
  });
  if (missingDecision) {
    try {
      console.log('[ROUTE] shift close finalize:blocked', {
        shiftId: record.id,
        reason: 'missing_decision',
        rowKey: missingDecision.key
      });
    } catch (e) {}
    showToast('Нужно выбрать действие для всех строк с остатком');
    return;
  }

  for (const row of unresolvedRows) {
    const actionState = draft.rows[row.key];
    if (actionState?.action === 'TRANSFER') {
      const validation = validateProductionShiftCloseTransferTarget(row, actionState, { logSource: 'finalize' });
      if (!validation.ok) {
        try {
          console.log('[ROUTE] shift close finalize:blocked', {
            shiftId: record.id,
            reason: 'transfer_target_invalid',
            rowKey: row.key,
            validationReason: validation.reason || ''
          });
        } catch (e) {}
        showToast(`${row.opCode || row.opName}: ${getProductionShiftCloseTransferTargetError(validation)}`, 'warning');
        return;
      }
      actionState.targetDate = validation.target.date;
      actionState.targetShift = validation.target.shift;
      actionState.targetAreaId = validation.target.areaId;
      actionState.projectedLoadPct = validation.target.projectedLoadPct;
    }
  }

  unresolvedRows.forEach(row => {
    const actionState = draft.rows[row.key];
    const task = (productionShiftTasks || []).find(item => String(item?.id || '') === String(row.taskId || '')) || null;
    if (task) {
      applyProductionShiftCloseToCurrentTask(task, row);
    }
    if (actionState?.action === 'TRANSFER') {
      appendProductionShiftCloseTransferTask(record, row, {
        date: actionState.targetDate,
        shift: actionState.targetShift,
        areaId: actionState.targetAreaId
      });
      recordShiftLog(record, {
        action: 'SHIFT_CLOSE_TRANSFER',
        object: 'Операция',
        targetId: row.routeOpId || null,
        field: 'closeResolution',
        oldValue: '',
        newValue: `${actionState.targetDate} / смена ${actionState.targetShift}`
      });
      if (row.isSubcontract) {
        recordShiftLog(record, {
          action: 'SUBCONTRACT_CHAIN_EXTEND',
          object: 'Операция',
          targetId: row.routeOpId || null,
          field: 'subcontractChain',
          oldValue: '',
          newValue: `${row.subcontractChainId || ''}; ${actionState.targetDate} / смена ${actionState.targetShift}`
        });
        const card = (cards || []).find(item => String(item?.id || '') === String(row.cardId || '')) || null;
        const op = (card?.operations || []).find(item => String(item?.id || '') === String(row.routeOpId || '')) || null;
        if (card && typeof recordCardLog === 'function') {
          recordCardLog(card, {
            action: 'Продление цепочки субподрядчика',
            object: String(op?.opName || op?.name || op?.opCode || 'Операция'),
            field: 'subcontractChain',
            targetId: row.routeOpId || null,
            oldValue: '',
            newValue: `${row.subcontractChainId || ''}; ${actionState.targetDate} / смена ${actionState.targetShift}`
          });
        }
      }
      return;
    }
    recordShiftLog(record, {
      action: 'SHIFT_CLOSE_REPLAN',
      object: 'Операция',
      targetId: row.routeOpId || null,
      field: 'closeResolution',
      oldValue: '',
      newValue: 'Передана в планирование'
    });
  });

  const now = Date.now();
  const operationFacts = buildProductionShiftCloseOperationFacts(slot, liveRows);
  const snapshotRows = liveRows.map(row => {
    const actionState = draft.rows[row.key] || null;
    const factKey = getProductionShiftFactKey(row.cardId, row.routeOpId, slot.date, slot.shift);
    const factStats = normalizeProductionShiftFactStats(operationFacts[factKey]);
    return {
      ...row,
      shiftFactTotal: factStats.total,
      shiftFactGood: factStats.good,
      shiftFactDelayed: factStats.delayed,
      shiftFactDefect: factStats.defect,
      resolutionAction: actionState?.action || '',
      resolutionTargetDate: actionState?.targetDate || '',
      resolutionTargetShift: actionState?.targetShift || null,
      resolutionText: buildProductionShiftCloseResolutionText(row, actionState)
    };
  });
  const closeSnapshot = {
    savedAt: now,
    savedBy: getCurrentUserName(),
    routeKey: formatProductionShiftCloseRouteKey(slot.date, slot.shift),
    shiftMasterNames: getProductionShiftCloseMasterNames(slot.date, slot.shift),
    openedAt: Number(record.openedAt) || null,
    closedAt: now,
    operationFacts,
    rows: snapshotRows,
    summary: buildProductionShiftCloseSummary(snapshotRows)
  };
  appendProductionShiftCloseSnapshot(record, closeSnapshot);
  record.closePageDraft = { rows: {} };
  record.status = 'CLOSED';
  record.closedAt = now;
  record.closedBy = getCurrentUserName();
  recordShiftLog(record, {
    action: 'CLOSE_SHIFT',
    object: 'Смена',
    field: 'status',
    oldValue: 'OPEN',
    newValue: 'CLOSED'
  });
  await saveData();
  try {
    console.log('[ROUTE] shift close finalize:done', {
      shiftId: record.id,
      closedAt: now,
      snapshotRows: snapshotRows.length
    });
  } catch (e) {}
  await loadDataWithScope({ scope: DATA_SCOPE_PRODUCTION, force: true, reason: 'shift-close-finalize' });
  if (typeof handleRoute === 'function') {
    handleRoute(routePath || getProductionShiftClosePath(slot.date, slot.shift), {
      replace: true,
      fromHistory: true,
      soft: true
    });
  }
}

function renderProductionShiftClosePage(routePath = '') {
  const section = document.getElementById('production-shift-close');
  if (!section) return;
  const parsed = parseProductionShiftCloseRoutePath(routePath || (window.location.pathname || ''));
  try {
    console.log('[ROUTE] renderProductionShiftClosePage:start', {
      routePath: routePath || (window.location.pathname || ''),
      parsed: parsed ? `${parsed.date}|${parsed.shift}` : null
    });
  } catch (e) {}
  if (!parsed) {
    renderProductionShiftCloseError('Некорректный адрес страницы закрытия смены');
    return;
  }

  const canonicalPath = getProductionShiftClosePath(parsed.date, parsed.shift);
  if ((window.location.pathname || '') !== canonicalPath) {
    try {
      history.replaceState(history.state || {}, '', canonicalPath);
    } catch (err) {
      console.warn('[ROUTE] shift close replaceState failed', err);
    }
  }

  ensureProductionShiftsFromData();
  const record = ensureProductionShift(parsed.date, parsed.shift, { reason: 'data' });
  if (!record) {
    renderProductionShiftCloseError('Смена не найдена');
    return;
  }

  const allowedStatus = record.status === 'OPEN' || record.status === 'CLOSED' || record.status === 'LOCKED' || Boolean(record.isFixed);
  if (!allowedStatus) {
    renderProductionShiftCloseError('Страница закрытия доступна только для открытой, завершённой или зафиксированной смены');
    return;
  }

  const readonly = isProductionRouteReadonly('production-shifts') || record.status !== 'OPEN' || isShiftFixed(parsed.date, parsed.shift);
  const allRows = buildProductionShiftCloseRows(parsed, record, { useSnapshot: readonly });
  const rows = sortProductionShiftCloseRows(filterProductionShiftCloseRows(allRows));
  const rowGroups = buildProductionShiftCloseRenderGroups(rows, parsed, record);
  const snapshot = readonly ? getProductionShiftCloseSnapshot(record) : null;
  const summary = snapshot?.summary || buildProductionShiftCloseSummary(allRows);
  const shiftMasters = snapshot?.shiftMasterNames || getProductionShiftCloseMasterNames(parsed.date, parsed.shift);
  const startLabel = (snapshot?.openedAt || record?.openedAt) ? formatDateTime(snapshot?.openedAt || record?.openedAt) : '—';
  const endLabel = formatDateTime(getProductionShiftCloseEndTimeValue(record, snapshot)) || '—';
  const statusLabel = SHIFT_STATUS_UI[record.status] || getShiftStatusLabel(parsed.date, parsed.shift);
  const draft = getProductionShiftCloseDraft(record);
  try {
    console.log('[ROUTE] renderProductionShiftClosePage:data', {
      routeKey: canonicalPath,
      shiftId: record.id,
      readonly,
      rowCount: allRows.length,
      filteredRowCount: rows.length,
      hasSnapshot: !!snapshot,
      draftRows: Object.keys(draft.rows || {}).length
    });
  } catch (e) {}

  const headers = [
    ['area', 'Участок'],
    ['card', 'Маршрутная карта №'],
    ['item', 'Наименование изделия'],
    ['code', 'Код операции'],
    ['op', 'Наименование операции'],
    ['executor', 'Исполнитель'],
    ['plan', 'План'],
    ['good', 'Годно'],
    ['delayed', 'Задержано'],
    ['defect', 'Брак'],
    ['remaining', 'Осталось'],
    ['overflow', 'Сверх плана'],
    ['fact', 'Текущее / факт. время'],
    ['comments', 'Комментарии'],
    ['transferDate', 'Дата'],
    ['transferShift', 'Смена'],
    ['actions', 'Действия']
  ];
  const headerHtml = headers.map(([key, label]) => {
    if (['comments', 'actions', 'transferDate', 'transferShift'].includes(key)) {
      return `<th>${escapeHtml(label)}</th>`;
    }
    const isActive = productionShiftCloseState.sortKey === key;
    const sortMark = isActive ? (productionShiftCloseState.sortDir === 'asc' ? ' ↑' : ' ↓') : '';
    return `<th><button type="button" class="production-shift-close-sort" data-sort-key="${key}">${escapeHtml(label)}${sortMark}</button></th>`;
  }).join('');

  const emptyText = normalizeQueueSearchValue(productionShiftCloseState.filterText)
    ? 'Нет операций, соответствующих фильтру.'
    : 'Нет операций для выбранной смены.';
  const rowsHtml = renderProductionShiftCloseExtendedRows(rowGroups, { readonly, draft, emptyText });

  section.innerHTML = `
    <div class="card production-card production-shift-close-card">
      <div class="production-toolbar">
        <div class="production-toolbar__left">
          <h2>Закрытие смены</h2>
        </div>
      </div>
      <div class="production-shift-close-header">
        <div class="production-shift-close-header-main">
          <div class="production-shift-close-title">${escapeHtml(getShiftHeaderLabel(parsed.date))} · ${parsed.shift} смена</div>
          <div class="production-shift-close-status">${escapeHtml(statusLabel)}</div>
        </div>
        <div class="production-shift-close-meta-grid">
          <div><span class="muted">Начало смены:</span> ${escapeHtml(startLabel)}</div>
          <div><span class="muted">Завершение смены:</span> <span data-role="production-shift-close-end-value">${escapeHtml(endLabel)}</span></div>
          <div><span class="muted">Мастер смены:</span> ${escapeHtml(shiftMasters.join(', ') || '—')}</div>
        </div>
      </div>

      <div class="production-shift-close-summary">
        <div class="production-shift-close-summary-item">Запланировано операций: <strong>${summary.plannedOps}</strong></div>
        <div class="production-shift-close-summary-item">Выполнено операций: <strong>${summary.completedOps}</strong></div>
        <div class="production-shift-close-summary-item"><span class="op-item-status-good">Годных деталей: ${summary.goodQty} шт.</span></div>
        <div class="production-shift-close-summary-item"><span class="op-item-status-delayed">Задержанных деталей: ${summary.delayedQty} шт.</span></div>
        <div class="production-shift-close-summary-item"><span class="op-item-status-defect">Бракованных деталей: ${summary.defectQty} шт.</span></div>
        <div class="production-shift-close-summary-item">Среднее время работы участков: <strong>${formatSecondsToHMS(summary.averageAreaFactSeconds || 0)}</strong></div>
      </div>

      <div class="production-shift-close-filter-row">
        <label class="production-shift-close-filter-label" for="production-shift-close-filter">Фильтр</label>
        <input
          type="search"
          class="production-shift-close-filter-input"
          id="production-shift-close-filter"
          placeholder="Участок, МК, изделие, код или операция"
          value="${escapeHtml(productionShiftCloseState.filterText || '')}"
        />
      </div>

      <div class="production-shift-close-table-wrap">
        <table class="production-table production-shift-close-table">
          <thead><tr>${headerHtml}</tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>

      <div class="production-shift-close-footer">
        ${readonly ? '' : '<button type="button" class="btn-secondary btn-small" id="production-shift-close-transfer-all">Передать всё</button>'}
        ${readonly ? '' : '<button type="button" class="btn-secondary btn-small" id="production-shift-close-replan-all">Запланировать всё</button>'}
        ${readonly ? '' : '<button type="button" class="btn-primary" id="production-shift-close-confirm">Закрыть смену</button>'}
        <button type="button" class="btn-secondary" id="production-shift-close-print">Печать</button>
        <button type="button" class="btn-secondary" id="production-shift-close-cancel">Отмена</button>
      </div>
    </div>
  `;

  section.querySelectorAll('.production-shift-close-sort').forEach(button => {
    button.addEventListener('click', () => {
      const key = button.getAttribute('data-sort-key') || 'remaining';
      if (productionShiftCloseState.sortKey === key) {
        productionShiftCloseState.sortDir = productionShiftCloseState.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        productionShiftCloseState.sortKey = key;
        productionShiftCloseState.sortDir = key === 'remaining' ? 'desc' : 'asc';
      }
      renderProductionShiftClosePage(canonicalPath);
    });
  });

  const filterInput = document.getElementById('production-shift-close-filter');
  if (filterInput) {
    filterInput.addEventListener('input', () => {
      const nextValue = filterInput.value || '';
      const selectionStart = filterInput.selectionStart ?? nextValue.length;
      const selectionEnd = filterInput.selectionEnd ?? nextValue.length;
      productionShiftCloseState.filterText = nextValue;
      renderProductionShiftClosePage(canonicalPath);
      const nextInput = document.getElementById('production-shift-close-filter');
      if (nextInput) {
        nextInput.focus();
        nextInput.setSelectionRange(selectionStart, selectionEnd);
      }
    });
  }

  section.querySelectorAll('input[data-row-key][data-action-type]').forEach(input => {
    input.addEventListener('change', async () => {
      const rowKey = input.getAttribute('data-row-key') || '';
      const actionType = input.getAttribute('data-action-type') || '';
      const row = rows.find(item => item.key === rowKey);
      if (!row) return;
      const nextAction = input.checked ? actionType : '';
      await setProductionShiftCloseAction(record, row, nextAction);
      renderProductionShiftClosePage(canonicalPath);
    });
  });

  section.querySelectorAll('[data-row-key][data-target-field]').forEach(input => {
    const handleTargetChange = async () => {
      const rowKey = input.getAttribute('data-row-key') || '';
      const row = rows.find(item => item.key === rowKey);
      if (!row) return;
      const actionState = getProductionShiftCloseDraft(record).rows[rowKey] || null;
      if (!actionState || actionState.action !== 'TRANSFER') return;
      const rowEl = input.closest('tr[data-row-key]');
      const dateInput = rowEl?.querySelector('[data-target-field="date"]') || null;
      const shiftInput = rowEl?.querySelector('[data-target-field="shift"]') || null;
      const nextTarget = {
        targetDate: String(dateInput?.value || '').trim(),
        targetShift: String(shiftInput?.value || '').trim()
      };
      await setProductionShiftCloseTransferTarget(record, row, {
        targetDate: nextTarget.targetDate || '',
        targetShift: nextTarget.targetShift || ''
      });
    };
    input.addEventListener('change', handleTargetChange);
    if (input.matches('input[type="date"]')) {
      input.addEventListener('input', handleTargetChange);
    }
  });

  const transferAllBtn = document.getElementById('production-shift-close-transfer-all');
  if (transferAllBtn) {
    transferAllBtn.addEventListener('click', async () => {
      await applyProductionShiftCloseBulkAction(record, rows, 'TRANSFER');
      renderProductionShiftClosePage(canonicalPath);
    });
  }

  const replanAllBtn = document.getElementById('production-shift-close-replan-all');
  if (replanAllBtn) {
    replanAllBtn.addEventListener('click', async () => {
      await applyProductionShiftCloseBulkAction(record, rows, 'REPLAN');
      renderProductionShiftClosePage(canonicalPath);
    });
  }

  const confirmBtn = document.getElementById('production-shift-close-confirm');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', async () => {
      await finalizeProductionShiftClose(parsed, canonicalPath);
    });
  }

  const printBtn = document.getElementById('production-shift-close-print');
  if (printBtn) {
    printBtn.addEventListener('click', () => {
      openProductionShiftClosePrintPreview();
    });
  }

  const cancelBtn = document.getElementById('production-shift-close-cancel');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      if (window.history.length > 1) {
        history.back();
      } else if (typeof navigateToPath === 'function') {
        navigateToPath('/production/shifts');
      }
    });
  }

  bindProductionShiftCloseEndClock(section, { record, snapshot });
}

function renderProductionShiftBoardPage() {
  const section = document.getElementById('production-shifts');
  if (!section) return;
  const isPlanRoute = window.location.pathname === '/production/plan';
  const pageTitle = 'Сменные задания';
  ensureProductionShiftsFromData();
  rebuildProductionShiftTasksIndex();
  const slots = getProductionShiftWindowSlots();
  const { areasList } = getProductionAreasWithOrder();
  const selectedId = productionShiftBoardState.selectedShiftId || shiftSlotKey(slots[0].date, slots[0].shift);
  productionShiftBoardState.selectedShiftId = selectedId;
  const selectedSlot = slots.find(slot => shiftSlotKey(slot.date, slot.shift) === selectedId) || slots[0];
  const slotDisplay = slots.map(slot => ({ slot, display: resolveShiftDisplayData(slot) }));
  const openShiftSlots = getOpenShiftSlots();
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
    (['COMPLETED', 'FIXED'].includes(getShiftStatusKey(selectedSlot.date, selectedSlot.shift))
      ? getProductionHistoricalRowsForShift(selectedSlot.date, selectedSlot.shift)
        .filter(row => String(row?.cardId || '') === String(selectedCardId || ''))
        .map(row => String(row?.routeOpId || ''))
      : getVisibleProductionShiftTasks()
        .filter(task => task.date === selectedSlot.date && task.shift === selectedSlot.shift && task.cardId === selectedCardId)
        .map(task => String(task.routeOpId || ''))
    ).filter(Boolean)
  );
  const selectedShiftHistoricalRowsByOpId = new Map(
    ['COMPLETED', 'FIXED'].includes(getShiftStatusKey(selectedSlot.date, selectedSlot.shift))
      ? getProductionHistoricalRowsForShift(selectedSlot.date, selectedSlot.shift)
        .filter(row => String(row?.cardId || '') === String(selectedCardId || ''))
        .map(row => [String(row?.routeOpId || ''), row])
      : []
  );
  const historicalQueueIndex = buildProductionPlanQueueHistoricalIndex();
  const selectedShiftStatusKey = getShiftStatusKey(selectedSlot.date, selectedSlot.shift);
  const isHistoricalSelectedShift = ['COMPLETED', 'FIXED'].includes(selectedShiftStatusKey);

  const headerCells = slotDisplay.map(({ slot, display }, idx) => {
    const status = display.status;
    const statusKey = getShiftStatusKey(slot.date, slot.shift);
    const isOpen = status === 'OPEN';
    const isSelected = shiftSlotKey(slot.date, slot.shift) === selectedId;
    const isFixed = statusKey === 'FIXED';
    const isAbyss = getCurrentUserName() === 'Abyss';
    const canOpen = statusKey === 'NOT_STARTED' || statusKey === 'COMPLETED';
    const canClose = statusKey === 'IN_PROGRESS';
    const canFix = statusKey === 'COMPLETED';
    const left = idx === 0 ? '<button class="production-shifts-nav" data-dir="-1" type="button">←</button>' : '';
    const right = idx === slots.length - 1 ? '<button class="production-shifts-nav" data-dir="1" type="button">→</button>' : '';
    const shiftMasters = getProductionShiftEmployees(slot.date, PRODUCTION_SHIFT_MASTER_AREA_ID, slot.shift);
    const shiftMastersHtml = shiftMasters.employeeNames.length
      ? `<div class="production-shift-board-masters" title="${escapeHtml(shiftMasters.employeeNames.join(', '))}">${escapeHtml(shiftMasters.employeeNames.join(', '))}</div>`
      : '';
    const canEditShiftActions = !isProductionRouteReadonly('production-shifts');
    const statusBtn = [
      (canEditShiftActions && !isFixed && canOpen)
        ? `<button type="button" class="btn-primary btn-small production-shift-action" data-action="open">Начать смену</button>`
        : '',
      (canEditShiftActions && canClose && !isFixed)
        ? `<button type="button" class="btn-secondary btn-small production-shift-action" data-action="close">Закончить смену</button>`
        : '',
      (canEditShiftActions && !isFixed && canFix)
        ? `<button type="button" class="btn-secondary btn-small production-shift-action" data-action="lock">Зафиксировать смену</button>`
        : '',
      (canEditShiftActions && isFixed && isAbyss)
        ? `<button type="button" class="btn-secondary btn-small production-shift-action" data-action="unfix">Снять фиксацию</button>`
        : ''
    ].filter(Boolean).join('');
    return `
      <th class="production-shift-board-head${isOpen ? ' shift-open' : ''}${isSelected ? ' selected' : ''}" data-date="${slot.date}" data-shift="${slot.shift}">
        <div class="production-shift-board-header">
          <div class="production-shift-board-nav-slot production-shift-board-nav-slot-left">${left}</div>
          <div class="production-shift-board-header-main">
            <div class="production-shift-board-summary">
              <div class="production-shift-board-header-info">
                <div class="production-shift-board-date">${escapeHtml(getShiftHeaderLabel(slot.date))}</div>
                <div class="production-shift-board-label">${slot.shift} смена</div>
              </div>
              <div class="production-shift-board-summary-center">
                ${shiftMastersHtml}
              </div>
              <div class="production-shift-board-summary-status">
                <div class="production-shift-board-status ${display.statusClass}">${escapeHtml(display.statusLabel)}</div>
              </div>
            </div>
            <div class="production-shift-board-actions">
              ${statusBtn}
              <button type="button" class="btn-tertiary btn-small production-shift-action" data-action="log">Лог смены</button>
            </div>
          </div>
          <div class="production-shift-board-nav-slot production-shift-board-nav-slot-right">${right}</div>
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
    return `<tr><th class="production-shift-board-area">${renderAreaLabel(area, { name: area.name || '', fallbackName: 'Участок' })}</th>${cells}</tr>`;
  }).join('');

  const openShiftButtonsHtml = openShiftSlots.length
    ? openShiftSlots.map(slot => `
        <button type="button" class="btn-secondary btn-small production-shift-board-jump" data-date="${slot.date}" data-shift="${slot.shift}">
          Смена ${slot.shift} ${escapeHtml(getShiftDateLabel(slot.date))}
        </button>
      `).join('')
    : '';
  const shiftJumpControlsHtml = `
    <div class="production-shift-board-controls">
      <button type="button" class="btn-secondary btn-small production-shift-board-jump" data-action="current">Текущая смена</button>
      ${openShiftButtonsHtml}
    </div>
  `;

  section.innerHTML = `
    <div class="card production-card production-shift-board-card">
      <div class="production-toolbar">
        <div class="production-toolbar__left">
          <h2>${pageTitle}</h2>
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
                  <div class="muted">Операций: ${getPlannableOpsCountForCard(selectedCard)}</div>
                </div>
                <div class="production-shifts-cardview-actions">
                  <button type="button" class="btn-secondary btn-small" id="production-shift-board-gantt-open">Гант</button>
                </div>
              </div>

              <div class="production-shifts-opslist">
                ${getPlannableOpsCountForCard(selectedCard) ? getPlannableShiftOperations(selectedCard.operations || []).map(op => {
                  const isInSelectedShift = selectedShiftOps.has(String(op.id || ''));
                  const historicalRow = selectedShiftHistoricalRowsByOpId.get(String(op.id || '')) || null;
                  const isDrying = isDryingOperation(op);
                  const visualMetrics = getOperationPlanningVisualMetrics(selectedCard, op);
                  const shiftTask = getVisibleProductionShiftTasks().find(task => (
                    task
                    && task.date === selectedSlot.date
                    && task.shift === selectedSlot.shift
                    && String(task.cardId || '') === String(selectedCard.id || '')
                    && String(task.routeOpId || '') === String(op.id || '')
                  )) || {
                    cardId: selectedCard.id,
                    routeOpId: op.id,
                    plannedPartQty: Number(getOperationPlanningSnapshot(selectedCard.id, op.id)?.baseQty || 0) || 0
                  };
                  const dryingExecutionState = isDrying
                    ? getProductionPlanDryingFillState(selectedCard, op, historicalRow)
                    : '';
                  const fillClass = isDrying
                    ? getProductionPlanDryingClass(dryingExecutionState)
                    : (historicalRow
                      ? ' production-shifts-op-planfill'
                      : ((!isHistoricalSelectedShift && visualMetrics) ? ' production-shifts-op-planfill' : ''));
                  const fillStyle = historicalRow
                    ? (isDrying ? '' : getProductionPlanHistoricalExecutionStyle(historicalRow))
                    : ((!isHistoricalSelectedShift && !isDrying && visualMetrics)
                      ? getPlanningExecutionOnlyStyleVars(visualMetrics.segments)
                      : '');
                  const boardMetaHtml = historicalRow
                    ? buildProductionPlanHistoricalMeta(selectedCard, op, historicalRow, {
                      hideStatus: true
                    })
                    : buildProductionShiftBoardOpMeta(selectedCard, op, shiftTask, {
                      shiftDate: selectedSlot.date,
                      shiftNumber: selectedSlot.shift,
                      hideStatus: true
                    });
                  return `
                    <div class="production-shifts-op ${isInSelectedShift ? 'in-shift' : 'out-of-shift'}${fillClass}" data-op-id="${op.id}"${historicalRow ? ' data-history="1"' : ''}${fillStyle ? ` style="${fillStyle}"` : ''}>
                      <div class="production-shifts-op-main">
                        <div class="production-shifts-op-name">${buildProductionPlanOpTitle(op)}</div>
                        ${boardMetaHtml}
                      </div>
                    </div>
                  `;
                }).join('') : '<div class="muted">Нет операций</div>'}
              </div>
            </div>
          ` : `
            <h3>Маршрутные карты смены</h3>
            <div class="production-shift-board-queue-list">
              ${buildShiftBoardQueue(selectedSlot, { historicalIndex: historicalQueueIndex })}
            </div>
          `}
        </aside>
        <div class="production-shift-board-main">
          ${shiftJumpControlsHtml}
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
  const ganttBtn = document.getElementById('production-shift-board-gantt-open');
  if (ganttBtn && selectedCard) {
    ganttBtn.onclick = () => navigateToPath(getProductionGanttPath(selectedCard));
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
      if (action === 'close') {
        const route = getProductionShiftClosePath(date, shift);
        if (typeof navigateToPath === 'function') {
          navigateToPath(route);
        } else if (typeof navigateToRoute === 'function') {
          navigateToRoute(route);
        }
      }
      if (action === 'lock') lockShiftBySlot(slot);
      if (action === 'unfix') unfixShiftBySlot(slot);
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

  section.querySelectorAll('.production-shift-board-jump').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-action');
      let slot = null;
      if (action === 'current') {
        slot = resolveCurrentShiftSlot();
      } else {
        const date = btn.getAttribute('data-date');
        const shift = parseInt(btn.getAttribute('data-shift'), 10) || 1;
        if (date) slot = { date, shift };
      }
      if (!slot) return;
      productionShiftBoardState.windowStart = { date: slot.date, shift: slot.shift };
      productionShiftBoardState.selectedShiftId = shiftSlotKey(slot.date, slot.shift);
      productionShiftBoardState.viewMode = 'queue';
      renderProductionShiftBoardPage();
    });
  });

  section.querySelectorAll('.production-shift-board-queue-card').forEach(card => {
    card.addEventListener('dblclick', () => {
      const cardId = card.getAttribute('data-card-id');
      if (!cardId) return;
      productionShiftBoardState.selectedCardId = cardId;
      productionShiftBoardState.viewMode = 'card';
      renderProductionShiftBoardPage();
    });
    card.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      const cardId = card.getAttribute('data-card-id');
      if (cardId) showProductionShiftBoardContextMenu(event.pageX, event.pageY, cardId);
    });
  });

  section.querySelectorAll('.production-shift-board-op').forEach(op => {
    op.addEventListener('contextmenu', (event) => {
      if (op.getAttribute('data-history') === '1') return;
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
      <button type="button" data-action="open-workspace">Открыть в РМ</button>
      <button type="button" data-action="open-workorders">Открыть в Трекере</button>
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

      if (action === 'open-workspace') {
        openProductionCardInRoute(cid, 'workspace');
        hideProductionShiftsCardMenu();
        return;
      }

      if (action === 'open-workorders') {
        openProductionCardInRoute(cid, 'workorders');
        hideProductionShiftsCardMenu();
        return;
      }

      if (action === 'open-new-tab') {
        const card = (cards || []).find(item => item.id === cid);
        const qr = normalizeQrId(card?.qrId || '');
        const targetId = isValidScanId(qr) ? qr : cid;
        const url = '/cards/' + encodeURIComponent(targetId);
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

function hideProductionShiftsOpMenu() {
  const menu = document.getElementById('production-shifts-op-menu');
  if (!menu) return;
  menu.classList.remove('open');
}

function showProductionShiftsOpMenu(x, y, cardId, routeOpId) {
  const parts = getOperationPlannedParts(cardId, routeOpId);
  if (!parts.length) {
    hideProductionShiftsOpMenu();
    return;
  }

  let menu = document.getElementById('production-shifts-op-menu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'production-shifts-op-menu';
    menu.className = 'production-context-menu';
    document.body.appendChild(menu);
  }

  menu.innerHTML = parts.map(part => `
    <button
      type="button"
      data-date="${escapeHtml(part.date)}"
      data-shift="${part.shift}"
      data-area-id="${escapeHtml(part.areaId)}"
      title="${escapeHtml(part.label)}"
    >${escapeHtml(part.label)}</button>
  `).join('');
  menu.querySelectorAll('button[data-date][data-shift]').forEach(button => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const date = button.getAttribute('data-date') || '';
      const shift = parseInt(button.getAttribute('data-shift'), 10) || 1;
      const areaId = button.getAttribute('data-area-id') || '';
      hideProductionShiftsOpMenu();
      focusProductionPlanSlot(date, shift, areaId, routeOpId);
    });
  });
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.classList.add('open');

  document.addEventListener('click', hideProductionShiftsOpMenu, { once: true });
}

function showProductionShiftsTaskMenu(x, y, cardId) {
  let menu = document.getElementById('production-shifts-task-menu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'production-shifts-task-menu';
    menu.className = 'production-context-menu';
    menu.innerHTML = `
      <button type="button" data-action="open">Открыть</button>
      <button type="button" data-action="open-workspace">Открыть в РМ</button>
      <button type="button" data-action="open-workorders">Открыть в Трекере</button>
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

      if (action === 'open-workspace') {
        openProductionCardInRoute(cid, 'workspace');
        hideProductionShiftsTaskMenu();
        return;
      }

      if (action === 'open-workorders') {
        openProductionCardInRoute(cid, 'workorders');
        hideProductionShiftsTaskMenu();
        return;
      }

      if (action === 'open-new-tab') {
        const card = (cards || []).find(item => item.id === cid);
        const qr = normalizeQrId(card?.qrId || '');
        const targetId = isValidScanId(qr) ? qr : cid;
        const url = '/cards/' + encodeURIComponent(targetId);
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
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const th = target.closest('.psp-th');
    if (th) {
      const key = th.getAttribute('data-sort-key');
      if (!key) return;
      const curKey = modal.dataset.pspSortKey || 'op';
      const curDir = modal.dataset.pspSortDir || 'asc';
      const nextDir = key === curKey ? (curDir === 'asc' ? 'desc' : 'asc') : 'asc';
      modal.dataset.pspSortKey = key;
      modal.dataset.pspSortDir = nextDir;
      const selectedRow = modal.querySelector('.psp-op-row.selected');
      const selectedId = selectedRow?.getAttribute('data-route-op-id') || '';
      if (productionShiftPlanContext) {
        const card = cards.find(c => c.id === productionShiftPlanContext.cardId);
        const opsEl = document.getElementById('production-shift-plan-ops');
        if (card && opsEl) {
          const routeOps = getPlannableShiftOperations(card.operations || []);
          const areaId = productionShiftPlanContext.areaId || '';
          const filteredOps = routeOps.filter(op => isOperationAllowedForArea(op, areaId));

          if (!filteredOps.length) {
            opsEl.innerHTML = '<p class="muted">Нет операций, доступных для выбранного участка</p>';
            updateProductionShiftPlanCompletionNotice({ opsVM: [] });
          } else {
            const opsVM = buildShiftPlanOpsVM(productionShiftPlanContext.cardId, filteredOps);
            renderShiftPlanOpsList({ modal, opsEl, opsVM, preserveSelectedId: selectedId });
          }
        }
      }
      if (selectedId) {
        const row = modal.querySelector(`.psp-op-row[data-route-op-id="${selectedId}"]`);
        if (row) {
          row.classList.add('selected');
          updateProductionShiftPlanPart(selectedId);
        } else {
          const partEl = document.getElementById('production-shift-plan-part');
          if (partEl) {
            partEl.classList.add('hidden');
            partEl.innerHTML = '';
          }
        }
      }
      updateShiftPlanSortUI(modal);
      return;
    }
    const opRow = target.closest('.psp-op-row');
    if (opRow) {
      modal.querySelectorAll('.psp-op-row.selected').forEach(row => row.classList.remove('selected'));
      opRow.classList.add('selected');
      const routeOpId = opRow.getAttribute('data-route-op-id');
      updateProductionShiftPlanPart(routeOpId);
      return;
    }
    const action = target.getAttribute('data-psp-action');
    if (!action) return;
    const input = modal.querySelector('#production-shift-plan-minutes');
    const partEl = modal.querySelector('#production-shift-plan-part');
    if (action === 'fill') {
      const fillMinutes = Number(partEl?.dataset.fillMinutes || 0);
      const qtyInputMode = partEl?.dataset.qtyInputMode === '1';
      const fillQty = Math.max(0, Math.floor(Number(partEl?.dataset.fillQty || 0)));
      if (input) input.value = String(qtyInputMode ? fillQty : (fillMinutes || 0));
      modal.dataset.pspMode = 'fill';
      updateShiftPlanPartsPreview(partEl);
      return;
    }
    if (!input) return;
    const maxAttr = Number(input.getAttribute('max'));
    const minAttr = Number(input.getAttribute('min'));
    const max = Number.isFinite(maxAttr) ? maxAttr : 1;
    const min = Number.isFinite(minAttr) ? minAttr : 1;
    const currentValue = Number(input.value);
    const current = Number.isFinite(currentValue) ? currentValue : min;
    const qtyInputMode = partEl?.dataset.qtyInputMode === '1';
    let nextValue = current;
    if (qtyInputMode) {
      const currentQty = normalizeShiftPlanQtyValue(current, max);
      nextValue = action === 'plus'
        ? Math.min(roundPlanningQty(currentQty + 1), max)
        : Math.max(0, roundPlanningQty(currentQty - 1));
    } else {
      const step = 5;
      nextValue = action === 'plus'
        ? Math.min(current + step, max)
        : Math.max(current - step, min);
    }
    input.value = String(nextValue);
    modal.dataset.pspMode = 'manual';
    updateShiftPlanPartsPreview(partEl);
  });

  modal.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.matches('#production-shift-plan-minutes')) {
      modal.dataset.pspMode = 'manual';
      const partEl = modal.querySelector('#production-shift-plan-part');
      const qtyInputMode = partEl?.dataset.qtyInputMode === '1';
      if (qtyInputMode) {
        const maxAttr = Number(target.getAttribute('max'));
        const max = Number.isFinite(maxAttr) ? maxAttr : 0;
        const normalizedQty = normalizeShiftPlanQtyValue(target.value, max);
        target.value = normalizedQty > 0 ? String(normalizedQty) : '';
      } else {
        const maxAttr = Number(target.getAttribute('max'));
        const minAttr = Number(target.getAttribute('min'));
        const max = Number.isFinite(maxAttr) ? maxAttr : 0;
        const min = Number.isFinite(minAttr) ? minAttr : 0;
        const rounded = Math.round(Number(target.value || 0));
        if (Number.isFinite(rounded)) {
          const normalized = Math.max(min, Math.min(rounded, max || rounded));
          target.value = String(normalized);
        }
      }
      updateShiftPlanPartsPreview(partEl);
    }
  });
}

function bindProductionSubcontractItemsModal() {
  const modal = document.getElementById('production-subcontract-items-modal');
  if (!modal || modal.dataset.bound === 'true') return;
  modal.dataset.bound = 'true';
  const cancelBtn = document.getElementById('production-subcontract-items-cancel');
  const saveBtn = document.getElementById('production-subcontract-items-save');
  const filterInput = document.getElementById('production-subcontract-items-filter');
  const cameraBtn = document.getElementById('production-subcontract-items-camera-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => closeProductionSubcontractItemsModal());
  }
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const parentSessionId = String(productionSubcontractPlanSelectionContext?.parentSessionId || '').trim();
      if (parentSessionId && !isProductionShiftPlanSessionActive(parentSessionId)) {
        closeProductionSubcontractItemsModal({ keepContext: false });
        return;
      }
      const requestedCount = Math.max(1, Number(productionSubcontractPlanSelectionContext?.requestedCount || 0));
      const selectedIds = Array.from(productionSubcontractPlanSelectionContext?.selectedIds || []);
      if (selectedIds.length !== requestedCount) {
        showToast(`Нужно выбрать ровно ${requestedCount}`);
        return;
      }
      modal.classList.add('hidden');
      if (productionSubcontractPlanSelectionResolver) {
        const resolve = productionSubcontractPlanSelectionResolver;
        productionSubcontractPlanSelectionResolver = null;
        resolve(selectedIds);
      }
      productionSubcontractPlanSelectionContext = null;
    });
  }
  if (filterInput) {
    filterInput.addEventListener('input', (event) => {
      const context = productionSubcontractPlanSelectionContext;
      if (!context) return;
      context.filterText = filterInput.value || '';
      if (event.isTrusted) {
        context.scanPending = false;
      }
      renderProductionSubcontractItemsModal();
    });
    filterInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      tryProcessProductionSubcontractLookup(filterInput.value || '');
    });
    filterInput.addEventListener('change', () => {
      const context = productionSubcontractPlanSelectionContext;
      if (!context?.scanPending) return;
      context.scanPending = false;
      tryProcessProductionSubcontractLookup(filterInput.value || '');
    });
  }
  if (cameraBtn) {
    cameraBtn.addEventListener('click', () => {
      if (!productionSubcontractPlanSelectionContext) return;
      productionSubcontractPlanSelectionContext.scanPending = true;
    });
  }
  modal.addEventListener('change', (event) => {
    const checkbox = event.target.closest('.production-subcontract-items-checkbox[data-item-id]');
    if (!checkbox || !productionSubcontractPlanSelectionContext) return;
    const itemId = String(checkbox.getAttribute('data-item-id') || '').trim();
    if (!itemId) return;
    if (checkbox.checked) {
      productionSubcontractPlanSelectionContext.selectedIds.add(itemId);
    } else {
      productionSubcontractPlanSelectionContext.selectedIds.delete(itemId);
    }
    renderProductionSubcontractItemsModal();
  });
  modal.addEventListener('click', (event) => {
    const th = event.target.closest('th.th-sortable[data-sort-key]');
    if (!th || !productionSubcontractPlanSelectionContext) return;
    const key = th.getAttribute('data-sort-key') || 'name';
    if (productionSubcontractPlanSelectionContext.sortKey === key) {
      productionSubcontractPlanSelectionContext.sortDir = productionSubcontractPlanSelectionContext.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      productionSubcontractPlanSelectionContext.sortKey = key;
      productionSubcontractPlanSelectionContext.sortDir = 'asc';
    }
    renderProductionSubcontractItemsModal();
  });
  modal.addEventListener('dblclick', (event) => {
    const th = event.target.closest('th.th-sortable[data-sort-key="select"]');
    if (!th || !productionSubcontractPlanSelectionContext) return;
    event.preventDefault();
    productionSubcontractPlanSelectionContext.selectedIds = new Set();
    renderProductionSubcontractItemsModal();
    const filterInputEl = document.getElementById('production-subcontract-items-filter');
    if (filterInputEl) filterInputEl.focus();
  });
}

function openProductionRoute(route, { fromRestore = false, loading = false, soft = false } = {}) {
  const isLoading = !!loading;
  const isSoft = !!soft;
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
  appState = { ...appState, tab: getCurrentProductionPermissionKey(route) };
  if (isLoading) return;

  // Важно: при soft refresh после загрузки данных нужно рендерить даже если fromRestore=true
  const shouldRender = (!fromRestore) || isSoft;

  if (targetId === 'production-schedule' && shouldRender) {
    renderProductionSchedule();
  }
  if (targetId === 'production-shifts' && shouldRender) {
    if (route === '/production/plan') {
      renderProductionPlanPage(route);
    } else {
      renderProductionShiftBoardPage();
    }
  }
  if (targetId === 'production-defects' && shouldRender) {
    renderProductionDefectsPage();
  }
  if (targetId === 'production-delayed' && shouldRender) {
    renderProductionDelayedPage();
  }
}

function ensureProductionFlow(card) {
  if (!card || card.flow) return;
  ensureCardMeta(card);
}

function getFlowItemLastStatus(item) {
  const history = Array.isArray(item?.history) ? item.history : [];
  const last = history.length ? history[history.length - 1] : null;
  return last?.status || null;
}

function isFlowItemDisposed(item) {
  if (!item) return false;
  if (item.current?.status === 'DISPOSED') return true;
  const history = Array.isArray(item.history) ? item.history : [];
  return history.some(entry => entry && entry.status === 'DISPOSED');
}

function countCardItemsByStatus(card, status, { currentOnly = false } = {}) {
  ensureProductionFlow(card);
  const items = Array.isArray(card?.flow?.items) ? card.flow.items : [];
  const samples = Array.isArray(card?.flow?.samples) ? card.flow.samples : [];
  return items.concat(samples).filter(item => {
    if (isFlowItemDisposed(item)) return false;
    const current = item?.current?.status || '';
    if (currentOnly) return current === status;
    const lastStatus = getFlowItemLastStatus(item);
    return current === status || lastStatus === status;
  }).length;
}

function countCardEntitiesByStatus(card, status, { currentOnly = false } = {}) {
  ensureProductionFlow(card);
  const items = Array.isArray(card?.flow?.items) ? card.flow.items : [];
  const samples = Array.isArray(card?.flow?.samples) ? card.flow.samples : [];
  const normalize = typeof normalizeSampleType === 'function'
    ? normalizeSampleType
    : (value) => String(value || '').trim().toUpperCase();
  const counts = {
    item: 0,
    control: 0,
    witness: 0,
    total: 0
  };
  items.concat(samples).forEach(item => {
    if (isFlowItemDisposed(item)) return;
    const current = item?.current?.status || '';
    if (currentOnly) {
      if (current !== status) return;
    } else {
      const lastStatus = getFlowItemLastStatus(item);
      if (current !== status && lastStatus !== status) return;
    }
    if (item?.kind === 'SAMPLE') {
      const sampleType = normalize(item?.sampleType);
      if (sampleType === 'WITNESS') {
        counts.witness += 1;
      } else {
        counts.control += 1;
      }
    } else {
      counts.item += 1;
    }
    counts.total += 1;
  });
  return counts;
}

function buildProductionDelayedBadgeText(counts) {
  const parts = [];
  if ((counts?.item || 0) > 0) parts.push(`Изд. - ${counts.item} шт.`);
  if ((counts?.control || 0) > 0) parts.push(`ОК - ${counts.control} шт.`);
  if ((counts?.witness || 0) > 0) parts.push(`ОС - ${counts.witness} шт.`);
  return parts.length ? `Задержано: ${parts.join(', ')}` : 'Задержано';
}

function buildProductionDelayedTotalText(counts) {
  const parts = [];
  if ((counts?.item || 0) > 0) parts.push(`Изд. - ${counts.item} шт.`);
  if ((counts?.control || 0) > 0) parts.push(`ОК - ${counts.control} шт.`);
  if ((counts?.witness || 0) > 0) parts.push(`ОС - ${counts.witness} шт.`);
  return parts.length ? `Всего задержано: ${parts.join(', ')}` : 'Всего задержано: 0 шт.';
}

function buildProductionDefectBadgeText(counts) {
  const parts = [];
  if ((counts?.item || 0) > 0) parts.push(`Изд. - ${counts.item} шт.`);
  if ((counts?.control || 0) > 0) parts.push(`ОК - ${counts.control} шт.`);
  if ((counts?.witness || 0) > 0) parts.push(`ОС - ${counts.witness} шт.`);
  return parts.length ? `Брак: ${parts.join(', ')}` : 'Брак';
}

function buildProductionDefectTotalText(counts) {
  const parts = [];
  if ((counts?.item || 0) > 0) parts.push(`Изд. - ${counts.item} шт.`);
  if ((counts?.control || 0) > 0) parts.push(`ОК - ${counts.control} шт.`);
  if ((counts?.witness || 0) > 0) parts.push(`ОС - ${counts.witness} шт.`);
  return parts.length ? `Всего брака: ${parts.join(', ')}` : 'Всего брака: 0 шт.';
}

function itemHasStatusOnOperation(item, status, opId, { currentOnly = false } = {}) {
  if (!item || !opId) return false;
  if (isFlowItemDisposed(item)) return false;
  if (item.current?.status === status && item.current?.opId === opId) return true;
  if (currentOnly) return false;
  const history = Array.isArray(item.history) ? item.history : [];
  return history.some(entry => entry && entry.status === status && entry.opId === opId);
}

function trimToString(value) {
  return String(value == null ? '' : value).trim();
}

function getSamplePrefixLetter(sampleType) {
  return normalizeSampleType(sampleType) === 'WITNESS' ? 'С' : 'К';
}

function escapeRegex(value) {
  return String(value == null ? '' : value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseAutoSampleName(value, prefixLetter) {
  const trimmed = trimToString(value);
  if (!trimmed || !prefixLetter) return null;
  const match = trimmed.match(new RegExp(`^(.+)-${escapeRegex(prefixLetter)}(\\d+)-(\\d{4})$`));
  if (!match) return null;
  return {
    base: match[1],
    seq: parseInt(match[2], 10),
    year: match[3]
  };
}

function getNextReturnedSampleName(card, item) {
  if (!card || !item || item.kind !== 'SAMPLE') return null;
  ensureProductionFlow(card);
  const prefixLetter = getSamplePrefixLetter(item.sampleType);
  const currentName = trimToString(item.displayName || '');
  const parsedCurrent = parseAutoSampleName(currentName, prefixLetter);
  const fallbackBase = trimToString(card.routeCardNumber || card.orderNo || '');
  const base = trimToString(parsedCurrent?.base || fallbackBase);
  const year = trimToString(parsedCurrent?.year || new Date().getFullYear());
  if (!base || !year) return null;
  const currentSeq = Number.isFinite(parsedCurrent?.seq) ? parsedCurrent.seq : 0;
  const maxExistingSeq = (Array.isArray(card?.flow?.samples) ? card.flow.samples : []).reduce((maxSeq, sample) => {
    if (!sample || sample.id === item.id) return maxSeq;
    if (normalizeSampleType(sample.sampleType) !== normalizeSampleType(item.sampleType)) return maxSeq;
    const parsed = parseAutoSampleName(sample.displayName, prefixLetter);
    if (!parsed || parsed.base !== base || parsed.year !== year || !Number.isFinite(parsed.seq)) return maxSeq;
    return Math.max(maxSeq, parsed.seq);
  }, 0);
  const nextSeq = Math.max(currentSeq, maxExistingSeq) + 1;
  return `${base}-${prefixLetter}${nextSeq}-${year}`;
}

function findOperationInCard(card, opId) {
  if (!card || !opId) return null;
  const ops = Array.isArray(card.operations) ? card.operations : [];
  return ops.find(op => op && String(op.id || '') === String(opId)) || null;
}

function findFirstOperationWithStatus(card, status, { currentOnly = false } = {}) {
  if (!card || !Array.isArray(card.operations)) return null;
  ensureProductionFlow(card);
  const opsSorted = [...card.operations].sort((a, b) => (a.order || 0) - (b.order || 0));
  const items = Array.isArray(card?.flow?.items) ? card.flow.items : [];
  const samples = Array.isArray(card?.flow?.samples) ? card.flow.samples : [];
  const all = items.concat(samples);
  for (let i = 0; i < opsSorted.length; i += 1) {
    const op = opsSorted[i];
    if (!op) continue;
    const found = all.some(item => itemHasStatusOnOperation(item, status, op.id, { currentOnly }));
    if (found) return { op, index: i, opsSorted };
  }
  return null;
}

function findOperationsWithStatus(card, status, { currentOnly = false } = {}) {
  if (!card || !Array.isArray(card.operations)) return { opsSorted: [], issueOps: [] };
  ensureProductionFlow(card);
  const opsSorted = [...card.operations].sort((a, b) => (a.order || 0) - (b.order || 0));
  const items = Array.isArray(card?.flow?.items) ? card.flow.items : [];
  const samples = Array.isArray(card?.flow?.samples) ? card.flow.samples : [];
  const all = items.concat(samples);
  const issueOps = opsSorted.filter(op => op && all.some(item => itemHasStatusOnOperation(item, status, op.id, { currentOnly })));
  return { opsSorted, issueOps };
}

function buildOperationsTableForOps(card, ops, { hideFlowItemStatuses = null, showDelayedActions = false, showDefectActions = false, allowedFlowItemStatuses = null } = {}) {
  const clone = { ...card, operations: Array.isArray(ops) ? ops : [] };
  return buildOperationsTable(clone, {
    readonly: true,
    showQuantityColumn: false,
    showQuantityRow: false,
    lockExecutors: true,
    lockQuantities: true,
    allowActions: false,
    showFlowItems: true,
    hideFlowItemStatuses,
    showDelayedActions,
    showDefectActions,
    allowedFlowItemStatuses
  });
}

function renderProductionIssueListPage({ status, containerId, title, routeBase, badgeLabel, badgeClass }) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const candidates = (cards || []).filter(card => card && !card.archived && card.cardType === 'MKI');
  const countOptions = { currentOnly: status === 'DELAYED' };
  const list = candidates.map(card => {
    const counts = countCardEntitiesByStatus(card, status, countOptions);
    return { card, count: counts.total, counts };
  }).filter(entry => entry.count > 0);
  const totalCounts = list.reduce((acc, entry) => {
    acc.item += entry.counts?.item || 0;
    acc.control += entry.counts?.control || 0;
    acc.witness += entry.counts?.witness || 0;
    acc.total += entry.counts?.total || 0;
    return acc;
  }, { item: 0, control: 0, witness: 0, total: 0 });
  const totalHtml = status === 'DELAYED'
    ? `<div class="production-issue-total">${escapeHtml(buildProductionDelayedTotalText(totalCounts))}</div>`
    : (status === 'DEFECT'
      ? `<div class="production-issue-total">${escapeHtml(buildProductionDefectTotalText(totalCounts))}</div>`
      : '');

  const headerHtml = `
    <div class="card">
      <div class="card-header-row">
        <h2>${escapeHtml(title)}</h2>
      </div>
      ${totalHtml}
    </div>
  `;

  const cardsHtml = list.length
    ? list.map(entry => {
      const badgeText = status === 'DELAYED'
        ? buildProductionDelayedBadgeText(entry.counts)
        : (status === 'DEFECT'
          ? buildProductionDefectBadgeText(entry.counts)
          : `${badgeLabel} — ${entry.count} шт.`);
      const extraInlineActions = `<span class="production-issue-badge ${badgeClass}">${badgeText}</span>`;
      return buildWorkorderCardDetails(entry.card, {
        opened: false,
        allowArchive: false,
        showLog: true,
        readonly: true,
        allowActions: false,
        showCardInfoHeader: true,
        summaryToggle: false,
        extraInlineActions
      });
    }).join('')
    : '<div class="card"><div class="muted">Нет записей.</div></div>';

  container.innerHTML = headerHtml + cardsHtml;

  bindProductionIssueInteractions(container, { routeBase });
}

function bindProductionIssueInteractions(rootEl, { routeBase }) {
  if (!rootEl) return;
  bindCardInfoToggles(rootEl);

  rootEl.querySelectorAll('.wo-card[data-card-id]').forEach(detail => {
    const summaryEl = detail.querySelector('summary');
    const handler = (event) => {
      if (!summaryEl || !summaryEl.contains(event.target)) return;
      if (shouldIgnoreCardOpenClick(event)) return;
      event.preventDefault();
      event.stopPropagation();
      const cardId = detail.dataset.cardId;
      const card = cards.find(c => c.id === cardId);
      if (!card) return;
      const qr = normalizeQrId(card.qrId || '');
      const target = qr || card.id;
      if (!target) return;
      navigateToRoute(`${routeBase}/${encodeURIComponent(target)}`);
    };
    detail.addEventListener('click', handler);
  });

  rootEl.querySelectorAll('.barcode-view-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-card-id');
      const card = cards.find(c => c.id === id);
      if (card) openBarcodeModal(card);
    });
  });

  rootEl.querySelectorAll('.items-view-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-items-card');
      if (id) openItemsModal(id);
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
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const id = btn.getAttribute('data-log-card');
      if (id) openCardLogPage(id);
    });
  });
}

function renderProductionIssueCardPage(card, { status, listRoute, title, emptyTitle }) {
  if (!card) return;
  const mountEl = document.getElementById('page-workorders-card');
  if (!mountEl) return;
  document.body.classList.add('page-wo-mode');
  resetPageContainer(mountEl);
  const isReadonlyRoute = status === 'DELAYED'
    ? isProductionRouteReadonly('production-delayed')
    : (status === 'DEFECT' ? isProductionRouteReadonly('production-defects') : true);
  const issueInfo = findOperationsWithStatus(card, status, { currentOnly: status === 'DELAYED' || status === 'DEFECT' });
  let noticeHtml = '';
  let customOperationsHtml = null;

  const hideFlowItemStatuses = status === 'DEFECT'
    ? ['DELAYED']
    : (status === 'DELAYED' ? ['DEFECT'] : []);
  const showDelayedActions = status === 'DELAYED' && !isReadonlyRoute;
  const showDefectActions = status === 'DEFECT' && !isReadonlyRoute;
  const allowedFlowItemStatuses = status === 'DELAYED'
    ? ['DELAYED']
    : (status === 'DEFECT' ? ['DEFECT'] : null);
  const emptyStateClass = status === 'DELAYED' || status === 'DEFECT'
    ? 'production-issue-empty-state is-highlighted'
    : 'production-issue-empty-state';

  if (!issueInfo.issueOps.length) {
    noticeHtml = `
      <div class="card production-issue-note ${emptyStateClass}">
        <p>${escapeHtml(emptyTitle)}</p>
      </div>
    `;
  } else {
    const opsSorted = issueInfo.opsSorted || [];
    const issueIds = new Set(issueInfo.issueOps.map(op => op.id));
    const hiddenLabel = status === 'DEFECT' ? 'Операции без брака' : 'Операции без задержки';
    const blocks = [];
    let hiddenOps = [];
    let blockIndex = 0;
    const flushHidden = () => {
      if (!hiddenOps.length) return;
      blockIndex += 1;
      const bodyId = `production-issue-hidden-${blockIndex}`;
      blocks.push(`
        <div class="production-issue-done">
          <div class="production-issue-done-header">
            <h4>${escapeHtml(hiddenLabel)}</h4>
            <button type="button" class="btn-secondary btn-small" data-issue-toggle="${bodyId}">Развернуть ▼</button>
          </div>
          <div id="${bodyId}" class="hidden">${buildOperationsTableForOps(card, hiddenOps, { hideFlowItemStatuses, showDelayedActions, showDefectActions, allowedFlowItemStatuses })}</div>
        </div>
      `);
      hiddenOps = [];
    };

    opsSorted.forEach(op => {
      if (!op) return;
      if (issueIds.has(op.id)) {
        flushHidden();
        blocks.push(buildOperationsTableForOps(card, [op], { hideFlowItemStatuses, showDelayedActions, showDefectActions, allowedFlowItemStatuses }));
      } else {
        hiddenOps.push(op);
      }
    });
    flushHidden();
    customOperationsHtml = blocks.join('');
  }

  mountEl.innerHTML = `
    <div class="wo-page">
      <div class="wo-page-header">
        <button class="btn btn-small" id="production-issue-back">← Назад</button>
        <div class="wo-page-title">
          <div><b>${escapeHtml(title)}</b></div>
          <div class="muted">QR: ${escapeHtml(normalizeQrId(card.qrId || ''))}</div>
        </div>
      </div>
      ${noticeHtml}
      ${issueInfo.issueOps.length
        ? buildWorkorderCardDetails(card, { opened: true, readonly: true, allowActions: false, showCardInfoHeader: false, summaryToggle: true, customOperationsHtml })
        : ''}
    </div>
  `;

  const backBtn = document.getElementById('production-issue-back');
  if (backBtn) backBtn.onclick = () => navigateToRoute(listRoute);

  mountEl.querySelectorAll('[data-issue-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const bodyId = btn.getAttribute('data-issue-toggle');
      if (!bodyId) return;
      const body = document.getElementById(bodyId);
      if (!body) return;
      const isHidden = body.classList.toggle('hidden');
      btn.textContent = isHidden ? 'Развернуть ▼' : 'Свернуть ▲';
    });
  });

  if (issueInfo.issueOps.length) {
    bindWorkordersInteractions(mountEl, { readonly: true, forceClosed: false, enableSummaryNavigation: false });

    if (showDelayedActions || showDefectActions) {
      bindProductionDelayedItemActions(mountEl);
    }

    const detail = mountEl.querySelector('details.wo-card');
    if (detail) detail.open = true;
  }
}

let productionIssueModalsReady = false;
let productionIssueActionsBound = false;
let productionIssueReturnContext = null;
let productionIssueSampleRenameContext = null;
let productionIssueDefectContext = null;
let productionIssueRepairContext = null;
let productionIssueDisposeContext = null;

function setupProductionIssueModals() {
  if (productionIssueModalsReady) return;
  productionIssueModalsReady = true;

  const returnModal = document.getElementById('techspec-return-modal');
  const returnClose = document.getElementById('techspec-return-close');
  const returnCancel = document.getElementById('techspec-return-cancel');
  const returnApply = document.getElementById('techspec-return-apply');
  const returnTo = document.getElementById('techspec-return-to');
  const fileAdd = document.getElementById('techspec-file-add');
  const fileInput = document.getElementById('techspec-file-input');

  if (returnClose) returnClose.addEventListener('click', () => closeProductionReturnModal());
  if (returnCancel) returnCancel.addEventListener('click', () => closeProductionReturnModal());
  if (returnModal) {
    returnModal.addEventListener('click', (event) => {
      if (event.target === returnModal) closeProductionReturnModal();
    });
  }
  if (fileAdd && fileInput) {
    fileAdd.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => handleTechSpecFileSelected(fileInput));
  }
  if (returnApply) {
    returnApply.addEventListener('click', () => requestProductionReturn('same'));
  }
  if (returnTo) {
    returnTo.addEventListener('click', () => openProductionReturnTargetModal());
  }

  const targetModal = document.getElementById('techspec-target-modal');
  const targetCancel = document.getElementById('techspec-target-cancel');
  const targetApply = document.getElementById('techspec-target-apply');
  const targetClose = document.getElementById('techspec-target-close');
  if (targetCancel) targetCancel.addEventListener('click', () => closeProductionReturnTargetModal());
  if (targetClose) targetClose.addEventListener('click', () => closeProductionReturnTargetModal());
  if (targetModal) {
    targetModal.addEventListener('click', (event) => {
      if (event.target === targetModal) closeProductionReturnTargetModal();
    });
  }
  if (targetApply) {
    targetApply.addEventListener('click', () => requestProductionReturn('target'));
  }

  const renameModal = document.getElementById('sample-rename-modal');
  const renameCancel = document.getElementById('sample-rename-cancel');
  const renameKeep = document.getElementById('sample-rename-keep');
  const renameApply = document.getElementById('sample-rename-apply');
  const renameClose = document.getElementById('sample-rename-close');
  if (renameCancel) renameCancel.addEventListener('click', () => closeProductionSampleRenameModal());
  if (renameClose) renameClose.addEventListener('click', () => closeProductionSampleRenameModal());
  if (renameModal) {
    renameModal.addEventListener('click', (event) => {
      if (event.target === renameModal) closeProductionSampleRenameModal();
    });
  }
  if (renameKeep) {
    renameKeep.addEventListener('click', () => submitProductionReturn(productionIssueSampleRenameContext?.mode || 'same', { renameSample: false }));
  }
  if (renameApply) {
    renameApply.addEventListener('click', () => submitProductionReturn(productionIssueSampleRenameContext?.mode || 'same', { renameSample: true }));
  }

  const defectModal = document.getElementById('defect-confirm-modal');
  const defectNo = document.getElementById('defect-confirm-no');
  const defectYes = document.getElementById('defect-confirm-yes');
  const defectClose = document.getElementById('defect-confirm-close');
  if (defectNo) defectNo.addEventListener('click', () => closeProductionDefectModal());
  if (defectClose) defectClose.addEventListener('click', () => closeProductionDefectModal());
  if (defectModal) {
    defectModal.addEventListener('click', (event) => {
      if (event.target === defectModal) closeProductionDefectModal();
    });
  }
  if (defectYes) {
    defectYes.addEventListener('click', () => submitProductionDefect());
  }

  const repairModal = document.getElementById('trpn-repair-modal');
  const repairClose = document.getElementById('trpn-repair-close');
  const repairCancel = document.getElementById('trpn-repair-cancel');
  const repairCreate = document.getElementById('trpn-repair-create');
  const repairTransfer = document.getElementById('trpn-repair-transfer');
  const repairFileAdd = document.getElementById('trpn-repair-file-add');
  const repairFileInput = document.getElementById('trpn-repair-file-input');
  if (repairClose) repairClose.addEventListener('click', () => closeProductionRepairModal());
  if (repairCancel) repairCancel.addEventListener('click', () => closeProductionRepairModal());
  if (repairModal) {
    repairModal.addEventListener('click', (event) => {
      if (event.target === repairModal) closeProductionRepairModal();
    });
  }
  if (repairFileAdd && repairFileInput) {
    repairFileAdd.addEventListener('click', () => repairFileInput.click());
    repairFileInput.addEventListener('change', () => handleTrpnRepairFileSelected(repairFileInput));
  }
  if (repairCreate) {
    repairCreate.addEventListener('click', () => submitProductionRepairCreateNew());
  }
  if (repairTransfer) {
    repairTransfer.addEventListener('click', () => submitProductionRepairToExisting());
  }
  const repairSelect = document.getElementById('trpn-repair-existing-select');
  if (repairSelect && repairSelect.dataset.bound !== 'true') {
    repairSelect.dataset.bound = 'true';
    repairSelect.addEventListener('change', () => updateRepairTransferLabel());
  }

  const disposeModal = document.getElementById('trpn-dispose-modal');
  const disposeClose = document.getElementById('trpn-dispose-close');
  const disposeCancel = document.getElementById('trpn-dispose-cancel');
  const disposeApply = document.getElementById('trpn-dispose-apply');
  const disposeFileAdd = document.getElementById('trpn-dispose-file-add');
  const disposeFileInput = document.getElementById('trpn-dispose-file-input');
  if (disposeClose) disposeClose.addEventListener('click', () => closeProductionDisposeModal());
  if (disposeCancel) disposeCancel.addEventListener('click', () => closeProductionDisposeModal());
  if (disposeModal) {
    disposeModal.addEventListener('click', (event) => {
      if (event.target === disposeModal) closeProductionDisposeModal();
    });
  }
  if (disposeFileAdd && disposeFileInput) {
    disposeFileAdd.addEventListener('click', () => disposeFileInput.click());
    disposeFileInput.addEventListener('change', () => handleTrpnDisposeFileSelected(disposeFileInput));
  }
  if (disposeApply) {
    disposeApply.addEventListener('click', () => openProductionDisposeConfirmModal());
  }

  const disposeConfirmModal = document.getElementById('trpn-dispose-confirm-modal');
  const disposeConfirmClose = document.getElementById('trpn-dispose-confirm-close');
  const disposeConfirmNo = document.getElementById('trpn-dispose-confirm-no');
  const disposeConfirmYes = document.getElementById('trpn-dispose-confirm-yes');
  if (disposeConfirmClose) disposeConfirmClose.addEventListener('click', () => closeProductionDisposeConfirmModal());
  if (disposeConfirmNo) disposeConfirmNo.addEventListener('click', () => closeProductionDisposeConfirmModal());
  if (disposeConfirmModal) {
    disposeConfirmModal.addEventListener('click', (event) => {
      if (event.target === disposeConfirmModal) closeProductionDisposeConfirmModal();
    });
  }
  if (disposeConfirmYes) {
    disposeConfirmYes.addEventListener('click', () => submitProductionDispose());
  }

  bindProductionDelayedItemActions();
}

function bindProductionDelayedItemActions(root) {
  if (productionIssueActionsBound) return;
  productionIssueActionsBound = true;
  const scope = root || document;
  scope.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const btn = target.closest('button.op-item-action');
    if (!btn) return;
    event.preventDefault();
    event.stopPropagation();
    const action = btn.getAttribute('data-action');
    const cardId = btn.getAttribute('data-card-id');
    const opId = btn.getAttribute('data-op-id');
    const itemId = btn.getAttribute('data-item-id');
    const kind = btn.getAttribute('data-kind');
    if (!action || !cardId || !opId || !itemId || !kind) return;
    if (action === 'return-item') {
      openProductionReturnModal({ cardId, opId, itemId, kind });
    }
    if (action === 'defect-item') {
      openProductionDefectModal({ cardId, opId, itemId, kind });
    }
    if (action === 'repair-item') {
      openProductionRepairModal({ cardId, opId, itemId, kind });
    }
    if (action === 'dispose-item') {
      openProductionDisposeModal({ cardId, opId, itemId, kind });
    }
  });
}

function getFlowItemById(card, kind, itemId) {
  if (!card || !itemId) return null;
  const source = kind === 'SAMPLE' ? (card.flow?.samples || []) : (card.flow?.items || []);
  return source.find(item => item && item.id === itemId) || null;
}

function buildTechSpecDisplayName(item, fileName) {
  const itemName = trimToString(item?.displayName || item?.id || 'Изделие');
  const fileLabel = trimToString(fileName || 'файл');
  return `ТехУказ - ${itemName} - ${fileLabel}`;
}

function buildTrpnDisplayName(item, fileName, { dispose = false } = {}) {
  const itemName = trimToString(item?.displayName || item?.id || 'Изделие');
  const fileLabel = trimToString(fileName || 'файл');
  const prefix = dispose ? 'ТРПН-У' : 'ТРПН';
  return `${prefix} - ${itemName} - ${fileLabel}`;
}

function updateTechSpecFileUi(fileLabel, { loading = false } = {}) {
  const nameEl = document.getElementById('techspec-file-name');
  const addBtn = document.getElementById('techspec-file-add');
  if (nameEl) nameEl.textContent = fileLabel || 'Файл не выбран';
  if (addBtn) addBtn.disabled = loading;
}

function updateTrpnFileUi(scope, fileLabel, { loading = false } = {}) {
  const nameEl = document.getElementById(`trpn-${scope}-file-name`);
  const addBtn = document.getElementById(`trpn-${scope}-file-add`);
  if (nameEl) nameEl.textContent = fileLabel || 'Файл не выбран';
  if (addBtn) addBtn.disabled = loading;
}

function openProductionReturnModal({ cardId, opId, itemId, kind }) {
  if (!ensureProductionEditAccess('production-delayed')) return;
  const card = cards.find(c => c && c.id === cardId);
  if (!card) {
    showToast('Маршрутная карта не найдена');
    return;
  }
  ensureProductionFlow(card);
  const op = findOperationInCard(card, opId);
  const item = getFlowItemById(card, kind, itemId);
  if (!op || !item) {
    showToast('Не удалось найти изделие или операцию');
    return;
  }
  productionIssueReturnContext = {
    cardId,
    opId,
    itemId,
    kind,
    opCode: trimToString(op.opCode || op.id),
    itemName: trimToString(item.displayName || item.id || 'Изделие'),
    itemQr: trimToString(item.qr || ''),
    flowVersion: Number.isFinite(card.flow?.version) ? card.flow.version : 1,
    techSpecFile: null,
    techSpecFileName: null,
    submitting: false
  };
  const modal = document.getElementById('techspec-return-modal');
  if (!modal) return;
  const nameEl = document.getElementById('techspec-item-name');
  const qrEl = document.getElementById('techspec-item-qr');
  const opEl = document.getElementById('techspec-item-op');
  if (nameEl) nameEl.textContent = productionIssueReturnContext.itemName;
  if (qrEl) qrEl.textContent = productionIssueReturnContext.itemQr || '—';
  if (opEl) opEl.textContent = productionIssueReturnContext.opCode || '—';
  updateTechSpecFileUi('Файл не выбран');
  const input = document.getElementById('techspec-file-input');
  if (input) input.value = '';
  modal.classList.remove('hidden');
}

function closeProductionReturnModal() {
  const modal = document.getElementById('techspec-return-modal');
  if (modal) modal.classList.add('hidden');
  closeProductionSampleRenameModal();
  const input = document.getElementById('techspec-file-input');
  if (input) input.value = '';
  productionIssueReturnContext = null;
  setProductionReturnButtonsDisabled(false);
}

function openProductionRepairModal({ cardId, opId, itemId, kind }) {
  if (!ensureProductionEditAccess('production-defects')) return;
  const card = cards.find(c => c && c.id === cardId);
  if (!card) {
    showToast('Маршрутная карта не найдена');
    return;
  }
  ensureProductionFlow(card);
  const op = findOperationInCard(card, opId);
  const item = getFlowItemById(card, kind, itemId);
  if (!op || !item) {
    showToast('Не удалось найти изделие или операцию');
    return;
  }
  productionIssueRepairContext = {
    cardId,
    opId,
    itemId,
    kind,
    opCode: trimToString(op.opCode || op.id),
    itemName: trimToString(item.displayName || item.id || 'Изделие'),
    itemQr: trimToString(item.qr || ''),
    flowVersion: Number.isFinite(card.flow?.version) ? card.flow.version : 1,
    trpnFile: null,
    trpnFileName: null,
    submitting: false
  };
  const modal = document.getElementById('trpn-repair-modal');
  if (!modal) return;
  const nameEl = document.getElementById('trpn-repair-item-name');
  const qrEl = document.getElementById('trpn-repair-item-qr');
  const opEl = document.getElementById('trpn-repair-item-op');
  if (nameEl) nameEl.textContent = productionIssueRepairContext.itemName;
  if (qrEl) qrEl.textContent = productionIssueRepairContext.itemQr || '—';
  if (opEl) opEl.textContent = productionIssueRepairContext.opCode || '—';
  updateTrpnFileUi('repair', 'Файл не выбран');
  const input = document.getElementById('trpn-repair-file-input');
  if (input) input.value = '';
  updateRepairOptionsUi([]);
  loadProductionRepairOptions();
  modal.classList.remove('hidden');
}

function closeProductionRepairModal() {
  const modal = document.getElementById('trpn-repair-modal');
  if (modal) modal.classList.add('hidden');
  const input = document.getElementById('trpn-repair-file-input');
  if (input) input.value = '';
  productionIssueRepairContext = null;
  updateRepairOptionsUi([]);
  setProductionRepairButtonsDisabled(false);
}

function updateRepairOptionsUi(options) {
  const select = document.getElementById('trpn-repair-existing-select');
  const emptyEl = document.getElementById('trpn-repair-existing-empty');
  const transferBtn = document.getElementById('trpn-repair-transfer');
  if (!select || !emptyEl || !transferBtn) return;
  const items = Array.isArray(options) ? options : [];
  select.innerHTML = '';
  if (!items.length) {
    select.classList.add('hidden');
    emptyEl.classList.remove('hidden');
    transferBtn.classList.add('hidden');
    transferBtn.textContent = 'Перенести в …';
    return;
  }
  select.classList.remove('hidden');
  emptyEl.classList.add('hidden');
  items.forEach((opt, idx) => {
    const option = document.createElement('option');
    option.value = opt.id;
    option.textContent = opt.label;
    if (idx === 0) option.selected = true;
    select.appendChild(option);
  });
  updateRepairTransferLabel();
  transferBtn.classList.remove('hidden');
}

function updateRepairTransferLabel() {
  const select = document.getElementById('trpn-repair-existing-select');
  const transferBtn = document.getElementById('trpn-repair-transfer');
  if (!select || !transferBtn) return;
  const selected = select.options[select.selectedIndex];
  const label = selected ? selected.textContent : 'МК-РЕМ';
  transferBtn.textContent = `Перенести в ${label}`;
}

async function loadProductionRepairOptions() {
  if (!productionIssueRepairContext) return;
  const select = document.getElementById('trpn-repair-existing-select');
  const transferBtn = document.getElementById('trpn-repair-transfer');
  if (select) select.disabled = true;
  if (transferBtn) transferBtn.disabled = true;
  try {
    const card = cards.find(c => c && c.id === productionIssueRepairContext.cardId);
    if (!card) {
      showToast('Маршрутная карта не найдена');
      updateRepairOptionsUi([]);
      return;
    }
    const request = typeof apiFetch === 'function' ? apiFetch : fetch;
    const flowVersion = Number.isFinite(card.flow?.version) ? card.flow.version : productionIssueRepairContext.flowVersion;
    const res = await request('/api/production/flow/repair/options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cardId: productionIssueRepairContext.cardId,
        opId: productionIssueRepairContext.opId,
        itemId: productionIssueRepairContext.itemId,
        kind: productionIssueRepairContext.kind,
        expectedFlowVersion: flowVersion
      })
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      showToast(payload.error || `Не удалось получить список МК-РЕМ (HTTP ${res.status})`);
      updateRepairOptionsUi([]);
      return;
    }
    const payload = await res.json().catch(() => ({}));
    updateRepairOptionsUi(payload?.options || []);
  } catch (err) {
    showToast('Не удалось получить список МК-РЕМ');
    updateRepairOptionsUi([]);
  } finally {
    if (select) select.disabled = false;
    if (transferBtn) transferBtn.disabled = false;
  }
}

function openProductionDisposeModal({ cardId, opId, itemId, kind }) {
  if (!ensureProductionEditAccess('production-defects')) return;
  const card = cards.find(c => c && c.id === cardId);
  if (!card) {
    showToast('Маршрутная карта не найдена');
    return;
  }
  ensureProductionFlow(card);
  const op = findOperationInCard(card, opId);
  const item = getFlowItemById(card, kind, itemId);
  if (!op || !item) {
    showToast('Не удалось найти изделие или операцию');
    return;
  }
  productionIssueDisposeContext = {
    cardId,
    opId,
    itemId,
    kind,
    opCode: trimToString(op.opCode || op.id),
    itemName: trimToString(item.displayName || item.id || 'Изделие'),
    itemQr: trimToString(item.qr || ''),
    flowVersion: Number.isFinite(card.flow?.version) ? card.flow.version : 1,
    trpnFile: null,
    trpnFileName: null,
    submitting: false
  };
  const modal = document.getElementById('trpn-dispose-modal');
  if (!modal) return;
  const nameEl = document.getElementById('trpn-dispose-item-name');
  const qrEl = document.getElementById('trpn-dispose-item-qr');
  const opEl = document.getElementById('trpn-dispose-item-op');
  if (nameEl) nameEl.textContent = productionIssueDisposeContext.itemName;
  if (qrEl) qrEl.textContent = productionIssueDisposeContext.itemQr || '—';
  if (opEl) opEl.textContent = productionIssueDisposeContext.opCode || '—';
  updateTrpnFileUi('dispose', 'Файл не выбран');
  const input = document.getElementById('trpn-dispose-file-input');
  if (input) input.value = '';
  modal.classList.remove('hidden');
}

function closeProductionDisposeModal() {
  const modal = document.getElementById('trpn-dispose-modal');
  if (modal) modal.classList.add('hidden');
  closeProductionDisposeConfirmModal();
  const input = document.getElementById('trpn-dispose-file-input');
  if (input) input.value = '';
  productionIssueDisposeContext = null;
  setProductionDisposeButtonsDisabled(false);
}

function openProductionDisposeConfirmModal() {
  if (!productionIssueDisposeContext) return;
  if (!productionIssueDisposeContext.trpnFile) {
    showToast('Прикрепите файл ТРПН');
    return;
  }
  const modal = document.getElementById('trpn-dispose-confirm-modal');
  if (!modal) return;
  const textEl = document.getElementById('trpn-dispose-confirm-text');
  const itemName = productionIssueDisposeContext.itemName || 'изделие';
  if (textEl) textEl.textContent = `Вы уверены, что хотите утилизировать изделие «${itemName}»?`;
  modal.classList.remove('hidden');
}

function closeProductionDisposeConfirmModal() {
  const modal = document.getElementById('trpn-dispose-confirm-modal');
  if (modal) modal.classList.add('hidden');
}

function openProductionReturnTargetModal() {
  if (!productionIssueReturnContext) return;
  const modal = document.getElementById('techspec-target-modal');
  const select = document.getElementById('techspec-target-op');
  const applyBtn = document.getElementById('techspec-target-apply');
  if (select) select.innerHTML = '';

  const card = cards.find(c => c && c.id === productionIssueReturnContext.cardId);
  if (!card) {
    showToast('Маршрутная карта не найдена');
    return;
  }
  ensureProductionFlow(card);
  const item = getFlowItemById(card, productionIssueReturnContext.kind, productionIssueReturnContext.itemId);
  const rawSampleType = item?.sampleType || '';
  const normalize = typeof normalizeSampleType === 'function'
    ? normalizeSampleType
    : (value) => (value || '').toString().trim().toUpperCase();
  const itemSampleType = normalize(rawSampleType);

  const ops = Array.isArray(card.operations) ? card.operations : [];
  const options = ops.filter(op => {
    if (!op) return false;
    if (
      isMaterialIssueOperation(op) ||
      isDryingOperation(op) ||
      isMaterialReturnOperation(op)
    ) {
      return false;
    }
    if (productionIssueReturnContext.kind === 'SAMPLE') {
      if (!op.isSamples) return false;
      const opSampleType = normalize(op.sampleType || '');
      return opSampleType === itemSampleType;
    }
    return !op.isSamples;
  });

  if (select) {
    if (!options.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Нет доступных операций';
      select.appendChild(option);
      select.disabled = true;
    } else {
      options.forEach((op, idx) => {
        const code = trimToString(op.opCode || op.code || op.id || '');
        const name = trimToString(op.opName || op.name || '');
        const label = name ? `${code} - ${name}` : code;
        const option = document.createElement('option');
        option.value = code;
        option.textContent = label;
        if (idx === 0) option.selected = true;
        select.appendChild(option);
      });
      select.disabled = false;
    }
  }

  if (applyBtn) applyBtn.disabled = !options.length;
  if (modal) modal.classList.remove('hidden');
}

function closeProductionReturnTargetModal() {
  const modal = document.getElementById('techspec-target-modal');
  if (modal) modal.classList.add('hidden');
}

function openProductionSampleRenameModal(mode) {
  if (!productionIssueReturnContext || productionIssueReturnContext.kind !== 'SAMPLE') return false;
  const card = cards.find(c => c && c.id === productionIssueReturnContext.cardId);
  if (!card) {
    showToast('Маршрутная карта не найдена');
    return false;
  }
  ensureProductionFlow(card);
  const item = getFlowItemById(card, productionIssueReturnContext.kind, productionIssueReturnContext.itemId);
  if (!item) {
    showToast('Изделие не найдено');
    return false;
  }
  const nextName = getNextReturnedSampleName(card, item);
  if (!nextName) {
    showToast('Не удалось определить следующее имя образца');
    return false;
  }
  productionIssueSampleRenameContext = {
    mode,
    currentName: trimToString(item.displayName || item.id || 'Образец'),
    nextName
  };
  const currentEl = document.getElementById('sample-rename-current');
  const nextEl = document.getElementById('sample-rename-next');
  const hintEl = document.getElementById('sample-rename-hint');
  const modal = document.getElementById('sample-rename-modal');
  if (currentEl) currentEl.textContent = productionIssueSampleRenameContext.currentName || '—';
  if (nextEl) nextEl.textContent = productionIssueSampleRenameContext.nextName || '—';
  if (hintEl) hintEl.textContent = 'Номер будет увеличен с учётом текущего номера образца и максимального номера этого типа в карте.';
  if (modal) modal.classList.remove('hidden');
  return true;
}

function closeProductionSampleRenameModal() {
  const modal = document.getElementById('sample-rename-modal');
  if (modal) modal.classList.add('hidden');
  productionIssueSampleRenameContext = null;
}

async function handleTechSpecFileSelected(input) {
  if (!input || !productionIssueReturnContext) return;
  const file = input.files && input.files[0];
  if (!file) return;
  const allowed = ATTACH_ACCEPT.split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
  const ext = ('.' + (file.name.split('.').pop() || '')).toLowerCase();
  if (allowed.length && !allowed.includes(ext)) {
    showToast('Тип файла не поддерживается: ' + file.name);
    return;
  }
  if (file.size > ATTACH_MAX_SIZE) {
    showToast('Файл ' + file.name + ' превышает лимит ' + formatBytes(ATTACH_MAX_SIZE));
    return;
  }
  const card = cards.find(c => c && c.id === productionIssueReturnContext.cardId);
  if (!card) {
    showToast('Маршрутная карта не найдена');
    return;
  }
  ensureProductionFlow(card);
  const item = getFlowItemById(card, productionIssueReturnContext.kind, productionIssueReturnContext.itemId);
  if (!item) {
    showToast('Изделие не найдено');
    return;
  }
  const techName = buildTechSpecDisplayName(item, file.name);
  productionIssueReturnContext.techSpecFile = file;
  productionIssueReturnContext.techSpecFileName = techName;
  updateTechSpecFileUi(techName, { loading: false });
}

function handleTrpnRepairFileSelected(input) {
  if (!input || !productionIssueRepairContext) return;
  const file = input.files && input.files[0];
  if (!file) return;
  const allowed = ATTACH_ACCEPT.split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
  const ext = ('.' + (file.name.split('.').pop() || '')).toLowerCase();
  if (allowed.length && !allowed.includes(ext)) {
    showToast('Тип файла не поддерживается: ' + file.name);
    return;
  }
  if (file.size > ATTACH_MAX_SIZE) {
    showToast('Файл ' + file.name + ' превышает лимит ' + formatBytes(ATTACH_MAX_SIZE));
    return;
  }
  const card = cards.find(c => c && c.id === productionIssueRepairContext.cardId);
  if (!card) {
    showToast('Маршрутная карта не найдена');
    return;
  }
  ensureProductionFlow(card);
  const item = getFlowItemById(card, productionIssueRepairContext.kind, productionIssueRepairContext.itemId);
  if (!item) {
    showToast('Изделие не найдено');
    return;
  }
  const trpnName = buildTrpnDisplayName(item, file.name, { dispose: false });
  productionIssueRepairContext.trpnFile = file;
  productionIssueRepairContext.trpnFileName = trpnName;
  updateTrpnFileUi('repair', trpnName, { loading: false });
}

function handleTrpnDisposeFileSelected(input) {
  if (!input || !productionIssueDisposeContext) return;
  const file = input.files && input.files[0];
  if (!file) return;
  const allowed = ATTACH_ACCEPT.split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
  const ext = ('.' + (file.name.split('.').pop() || '')).toLowerCase();
  if (allowed.length && !allowed.includes(ext)) {
    showToast('Тип файла не поддерживается: ' + file.name);
    return;
  }
  if (file.size > ATTACH_MAX_SIZE) {
    showToast('Файл ' + file.name + ' превышает лимит ' + formatBytes(ATTACH_MAX_SIZE));
    return;
  }
  const card = cards.find(c => c && c.id === productionIssueDisposeContext.cardId);
  if (!card) {
    showToast('Маршрутная карта не найдена');
    return;
  }
  ensureProductionFlow(card);
  const item = getFlowItemById(card, productionIssueDisposeContext.kind, productionIssueDisposeContext.itemId);
  if (!item) {
    showToast('Изделие не найдено');
    return;
  }
  const trpnName = buildTrpnDisplayName(item, file.name, { dispose: true });
  productionIssueDisposeContext.trpnFile = file;
  productionIssueDisposeContext.trpnFileName = trpnName;
  updateTrpnFileUi('dispose', trpnName, { loading: false });
}

async function addTechSpecAttachment(card, item, file) {
  if (!card || !item || !file) return null;
  const allowed = ATTACH_ACCEPT.split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
  const ext = ('.' + (file.name.split('.').pop() || '')).toLowerCase();
  if (allowed.length && !allowed.includes(ext)) {
    showToast('Тип файла не поддерживается: ' + file.name);
    return null;
  }
  if (file.size > ATTACH_MAX_SIZE) {
    showToast('Файл ' + file.name + ' превышает лимит ' + formatBytes(ATTACH_MAX_SIZE));
    return null;
  }

  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  }).catch(() => null);

  if (!dataUrl || typeof dataUrl !== 'string') {
    showToast('Не удалось прочитать файл');
    return null;
  }

  const techName = buildTechSpecDisplayName(item, file.name);
  try {
    const expectedRev = typeof getCardExpectedRev === 'function'
      ? getCardExpectedRev(card)
      : ((Number(card?.rev) > 0) ? Number(card.rev) : 1);
    const routeContext = typeof captureClientWriteRouteContext === 'function'
      ? captureClientWriteRouteContext()
      : { fullPath: (window.location.pathname + window.location.search) || '/production' };
    const request = typeof apiFetch === 'function' ? apiFetch : fetch;
    let responsePayload = null;
    const result = await runClientWriteRequest({
      action: 'card-files:upload-tech-spec',
      writePath: '/api/cards/' + encodeURIComponent(String(card.id || '').trim()) + '/files',
      entity: 'card',
      entityId: card.id,
      expectedRev,
      routeContext,
      request: () => request('/api/cards/' + encodeURIComponent(card.id) + '/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedRev,
          name: techName,
          type: file.type || 'application/octet-stream',
          content: dataUrl,
          size: file.size,
          category: 'TECH_SPEC',
          scope: 'CARD'
        })
      }),
      defaultErrorMessage: 'Не удалось загрузить файл технических указаний',
      defaultConflictMessage: 'Карточка уже была изменена другим пользователем. Данные обновлены.',
      onSuccess: async ({ payload }) => {
        responsePayload = payload;
        if (typeof applyFilesPayloadToCard === 'function') {
          applyFilesPayloadToCard(card.id, payload);
        }
      },
      onConflict: async ({ payload, message }) => {
        responsePayload = payload;
        if (typeof applyFilesPayloadToCard === 'function') {
          applyFilesPayloadToCard(card.id, payload);
        }
        showToast(message || 'Не удалось загрузить файл технических указаний');
      },
      onError: async ({ message }) => {
        showToast(message || 'Не удалось загрузить файл технических указаний');
      },
      conflictRefresh: async ({ routeContext: conflictRouteContext }) => {
        if (typeof refreshCardFilesMutationAfterConflict === 'function') {
          await refreshCardFilesMutationAfterConflict(card.id, {
            routeContext: conflictRouteContext || routeContext,
            reason: 'production-tech-spec-upload-conflict'
          });
        }
      }
    });
    if (!result.ok) {
      return null;
    }
    const payload = responsePayload || result.payload || {};
    const updatedCard = (Array.isArray(cards) ? cards.find(itemCard => itemCard && itemCard.id === card.id) : null) || card;
    if (typeof updateAttachmentCounters === 'function') updateAttachmentCounters(updatedCard.id || card.id);
    if (typeof updateTableAttachmentCount === 'function') updateTableAttachmentCount(updatedCard.id || card.id);
    const fileMeta = payload.file || (payload.files || []).find(f => f && f.name === techName) || null;
    return { fileId: fileMeta?.id || null, displayName: fileMeta?.name || techName };
  } catch (err) {
    showToast('Не удалось загрузить файл технических указаний');
    return null;
  }
}

async function requestProductionReturn(mode) {
  if (!productionIssueReturnContext) return;
  if (!productionIssueReturnContext.techSpecFile) {
    showToast('Необходимо прикрепить файл Технических указаний');
    return;
  }
  const targetSelect = document.getElementById('techspec-target-op');
  const targetOpCode = mode === 'target'
    ? trimToString(targetSelect?.value)
    : '';
  if (mode === 'target' && !targetOpCode) {
    showToast('Укажите код операции');
    return;
  }
  if (productionIssueReturnContext.kind === 'SAMPLE') {
    openProductionSampleRenameModal(mode);
    return;
  }
  await submitProductionReturn(mode, { renameSample: false });
}

async function submitProductionReturn(mode, { renameSample = false } = {}) {
  if (!ensureProductionEditAccess('production-delayed')) return;
  if (!productionIssueReturnContext) return;
  if (productionIssueReturnContext.submitting) return;
  if (!productionIssueReturnContext.techSpecFile) {
    showToast('Необходимо прикрепить файл Технических указаний');
    return;
  }
  const card = cards.find(c => c && c.id === productionIssueReturnContext.cardId);
  if (!card) {
    showToast('Маршрутная карта не найдена');
    return;
  }
  const targetSelect = document.getElementById('techspec-target-op');
  const targetOpCode = mode === 'target'
    ? trimToString(targetSelect?.value)
    : '';
  if (mode === 'target' && !targetOpCode) {
    showToast('Укажите код операции');
    return;
  }

  try {
    productionIssueReturnContext.submitting = true;
    setProductionReturnButtonsDisabled(true);
    const file = productionIssueReturnContext.techSpecFile;
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    }).catch(() => null);
    if (!dataUrl || typeof dataUrl !== 'string') {
      productionIssueReturnContext.submitting = false;
      setProductionReturnButtonsDisabled(false);
      showToast('Не удалось прочитать файл');
      return;
    }
    const request = typeof apiFetch === 'function' ? apiFetch : fetch;
    const flowVersion = Number.isFinite(card.flow?.version) ? card.flow.version : productionIssueReturnContext.flowVersion;
    const res = await request('/api/production/flow/return', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cardId: productionIssueReturnContext.cardId,
        opId: productionIssueReturnContext.opId,
        itemId: productionIssueReturnContext.itemId,
        kind: productionIssueReturnContext.kind,
        expectedFlowVersion: flowVersion,
        techSpecFile: {
          name: productionIssueReturnContext.techSpecFileName || file.name,
          type: file.type || 'application/octet-stream',
          content: dataUrl,
          size: file.size
        },
        renameSample: Boolean(renameSample),
        targetOpCode: targetOpCode || undefined
      })
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      showToast(payload.error || `Не удалось выполнить возврат (HTTP ${res.status})`);
      productionIssueReturnContext.submitting = false;
      setProductionReturnButtonsDisabled(false);
      return;
    }
    const payload = await res.json().catch(() => ({}));
    const opLabel = targetOpCode || productionIssueReturnContext.opCode || '—';
    const itemLabel = trimToString(payload.itemName || productionIssueReturnContext.itemName || 'Изделие');
    const text = mode === 'target'
      ? `Изделие ${itemLabel} перенесено на операцию ${opLabel}`
      : `Изделие ${itemLabel} возвращено на операцию ${opLabel}`;
    closeProductionSampleRenameModal();
    closeProductionReturnTargetModal();
    closeProductionReturnModal();
    showToast(text);
    try {
      await refreshProductionIssueRouteAfterMutation('return');
    } catch (err) {
      showToast('Возврат выполнен, но обновление страницы не удалось');
    }
  } catch (err) {
    if (productionIssueReturnContext) {
      productionIssueReturnContext.submitting = false;
    }
    setProductionReturnButtonsDisabled(false);
    showToast('Не удалось выполнить возврат');
  }
}

function setProductionReturnButtonsDisabled(disabled) {
  const ids = [
    'techspec-return-apply',
    'techspec-return-to',
    'techspec-return-cancel',
    'techspec-return-close',
    'techspec-target-apply',
    'techspec-target-cancel',
    'techspec-target-close',
    'sample-rename-apply',
    'sample-rename-keep',
    'sample-rename-cancel',
    'sample-rename-close'
  ];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = disabled;
  });
}

function openProductionDefectModal({ cardId, opId, itemId, kind }) {
  if (!ensureProductionEditAccess('production-defects')) return;
  const card = cards.find(c => c && c.id === cardId);
  if (!card) {
    showToast('Маршрутная карта не найдена');
    return;
  }
  ensureProductionFlow(card);
  const op = findOperationInCard(card, opId);
  const item = getFlowItemById(card, kind, itemId);
  if (!op || !item) {
    showToast('Не удалось найти изделие или операцию');
    return;
  }
  productionIssueDefectContext = {
    cardId,
    opId,
    itemId,
    kind,
    itemName: trimToString(item.displayName || item.id || 'Изделие'),
    flowVersion: Number.isFinite(card.flow?.version) ? card.flow.version : 1,
    submitting: false
  };
  const modal = document.getElementById('defect-confirm-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeProductionDefectModal() {
  const modal = document.getElementById('defect-confirm-modal');
  if (modal) modal.classList.add('hidden');
  productionIssueDefectContext = null;
  setProductionDefectButtonsDisabled(false);
}

async function submitProductionDefect() {
  if (!ensureProductionEditAccess('production-defects')) return;
  if (!productionIssueDefectContext) return;
  if (productionIssueDefectContext.submitting) return;
  try {
    productionIssueDefectContext.submitting = true;
    setProductionDefectButtonsDisabled(true);
    const request = typeof apiFetch === 'function' ? apiFetch : fetch;
    const card = cards.find(c => c && c.id === productionIssueDefectContext.cardId);
    const flowVersion = Number.isFinite(card?.flow?.version) ? card.flow.version : productionIssueDefectContext.flowVersion;
    const routeContext = captureClientWriteRouteContext();
    const result = await runClientWriteRequest({
      action: 'production-issue-defect',
      writePath: '/api/production/flow/defect',
      entity: 'card.flow',
      entityId: productionIssueDefectContext.cardId,
      expectedRev: flowVersion,
      routeContext,
      defaultErrorMessage: ({ res }) => `Не удалось перенести в брак (HTTP ${res.status})`,
      request: () => request('/api/production/flow/defect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cardId: productionIssueDefectContext.cardId,
          opId: productionIssueDefectContext.opId,
          itemId: productionIssueDefectContext.itemId,
          kind: productionIssueDefectContext.kind,
          expectedFlowVersion: flowVersion
        })
      }),
      conflictRefresh: async ({ routeContext: conflictRouteContext }) => {
        await refreshProductionIssueRouteAfterMutation('defect-conflict', {
          routeContext: conflictRouteContext
        });
      }
    });
    if (!result.ok) {
      showToast(result.message);
      productionIssueDefectContext.submitting = false;
      setProductionDefectButtonsDisabled(false);
      return;
    }
    const itemLabel = productionIssueDefectContext.itemName || 'Изделие';
    closeProductionDefectModal();
    showToast(`Изделие ${itemLabel} перенесено в брак`);
    try {
      await refreshProductionIssueRouteAfterMutation('defect', {
        routeContext: result.routeContext
      });
    } catch (err) {
      showToast('Перенос выполнен, но обновление страницы не удалось');
    }
  } catch (err) {
    if (productionIssueDefectContext) {
      productionIssueDefectContext.submitting = false;
    }
    setProductionDefectButtonsDisabled(false);
    showToast('Не удалось перенести в брак');
  }
}

async function submitProductionRepairToExisting() {
  if (!productionIssueRepairContext) return;
  const select = document.getElementById('trpn-repair-existing-select');
  const targetId = select ? trimToString(select.value || '') : '';
  if (!targetId) {
    showToast('Выберите МК-РЕМ');
    return;
  }
  await submitProductionRepairFinal({ mode: 'add_existing', targetRepairCardId: targetId });
}

async function submitProductionRepairCreateNew() {
  await submitProductionRepairFinal({ mode: 'create_new' });
}

async function submitProductionRepairFinal({ mode, targetRepairCardId } = {}) {
  if (!ensureProductionEditAccess('production-defects')) return;
  if (!productionIssueRepairContext) return;
  if (productionIssueRepairContext.submitting) return;
  if (!productionIssueRepairContext.trpnFile) {
    showToast('Прикрепите файл ТРПН');
    return;
  }
  const card = cards.find(c => c && c.id === productionIssueRepairContext.cardId);
  if (!card) {
    showToast('Маршрутная карта не найдена');
    return;
  }

  try {
    productionIssueRepairContext.submitting = true;
    setProductionRepairButtonsDisabled(true);
    const file = productionIssueRepairContext.trpnFile;
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    }).catch(() => null);
    if (!dataUrl || typeof dataUrl !== 'string') {
      productionIssueRepairContext.submitting = false;
      setProductionRepairButtonsDisabled(false);
      setProductionRepairConfirmButtonsDisabled(false);
      showToast('Не удалось прочитать файл');
      return;
    }
    const request = typeof apiFetch === 'function' ? apiFetch : fetch;
    const flowVersion = Number.isFinite(card.flow?.version) ? card.flow.version : productionIssueRepairContext.flowVersion;
    const res = await request('/api/production/flow/repair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cardId: productionIssueRepairContext.cardId,
        opId: productionIssueRepairContext.opId,
        itemId: productionIssueRepairContext.itemId,
        kind: productionIssueRepairContext.kind,
        expectedFlowVersion: flowVersion,
        action: mode === 'add_existing' ? 'add_existing' : 'create_new',
        targetRepairCardId: targetRepairCardId || undefined,
        trpnFile: {
          name: productionIssueRepairContext.trpnFileName || file.name,
          type: file.type || 'application/octet-stream',
          content: dataUrl,
          size: file.size
        }
      })
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      showToast(payload.error || `Не удалось выполнить ремонт (HTTP ${res.status})`);
      productionIssueRepairContext.submitting = false;
      setProductionRepairButtonsDisabled(false);
      return;
    }
    const payload = await res.json().catch(() => ({}));
    const itemLabel = productionIssueRepairContext.itemName || 'Изделие';
    if (payload.mode === 'add_existing') {
      const label = payload.targetCardLabel || 'МК-РЕМ';
      closeProductionRepairModal();
      showToast(`Изделие ${itemLabel} добавлено в ${label}`);
    } else {
      const label = payload.newCardLabel || payload.newCardName || 'МК-РЕМ';
      closeProductionRepairModal();
      showToast(`МК успешно создана: ${label}`);
    }
    try {
      await refreshProductionIssueRouteAfterMutation('repair');
    } catch (err) {
      showToast('Операция выполнена, но обновление страницы не удалось');
    }
  } catch (err) {
    if (productionIssueRepairContext) productionIssueRepairContext.submitting = false;
    setProductionRepairButtonsDisabled(false);
    showToast('Не удалось выполнить ремонт');
  }
}

async function submitProductionDispose() {
  if (!ensureProductionEditAccess('production-defects')) return;
  if (!productionIssueDisposeContext) return;
  if (productionIssueDisposeContext.submitting) return;
  if (!productionIssueDisposeContext.trpnFile) {
    showToast('Прикрепите файл ТРПН');
    return;
  }
  try {
    productionIssueDisposeContext.submitting = true;
    setProductionDisposeButtonsDisabled(true);
    const file = productionIssueDisposeContext.trpnFile;
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    }).catch(() => null);
    if (!dataUrl || typeof dataUrl !== 'string') {
      productionIssueDisposeContext.submitting = false;
      setProductionDisposeButtonsDisabled(false);
      showToast('Не удалось прочитать файл');
      return;
    }
    const request = typeof apiFetch === 'function' ? apiFetch : fetch;
    const card = cards.find(c => c && c.id === productionIssueDisposeContext.cardId);
    const flowVersion = Number.isFinite(card?.flow?.version) ? card.flow.version : productionIssueDisposeContext.flowVersion;
    const res = await request('/api/production/flow/dispose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cardId: productionIssueDisposeContext.cardId,
        opId: productionIssueDisposeContext.opId,
        itemId: productionIssueDisposeContext.itemId,
        kind: productionIssueDisposeContext.kind,
        expectedFlowVersion: flowVersion,
        trpnFile: {
          name: productionIssueDisposeContext.trpnFileName || file.name,
          type: file.type || 'application/octet-stream',
          content: dataUrl,
          size: file.size
        }
      })
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      showToast(payload.error || `Не удалось утилизировать изделие (HTTP ${res.status})`);
      productionIssueDisposeContext.submitting = false;
      setProductionDisposeButtonsDisabled(false);
      return;
    }
    const itemLabel = productionIssueDisposeContext.itemName || 'Изделие';
    closeProductionDisposeConfirmModal();
    closeProductionDisposeModal();
    showToast(`Изделие ${itemLabel} утилизировано`);
    try {
      await refreshProductionIssueRouteAfterMutation('dispose');
    } catch (err) {
      showToast('Утилизация выполнена, но обновление страницы не удалось');
    }
  } catch (err) {
    if (productionIssueDisposeContext) productionIssueDisposeContext.submitting = false;
    setProductionDisposeButtonsDisabled(false);
    showToast('Не удалось утилизировать изделие');
  }
}

function setProductionDefectButtonsDisabled(disabled) {
  const ids = ['defect-confirm-no', 'defect-confirm-yes', 'defect-confirm-close'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = disabled;
  });
}

function setProductionRepairButtonsDisabled(disabled) {
  const ids = ['trpn-repair-create', 'trpn-repair-transfer', 'trpn-repair-cancel', 'trpn-repair-close', 'trpn-repair-file-add', 'trpn-repair-existing-select'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = disabled;
  });
}

function setProductionDisposeButtonsDisabled(disabled) {
  const ids = ['trpn-dispose-apply', 'trpn-dispose-cancel', 'trpn-dispose-close', 'trpn-dispose-confirm-yes', 'trpn-dispose-confirm-no', 'trpn-dispose-confirm-close'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = disabled;
  });
}

function renderProductionDefectsPage() {
  renderProductionIssueListPage({
    status: 'DEFECT',
    containerId: 'production-defects',
    title: 'Брак',
    routeBase: '/production/defects',
    badgeLabel: 'БРАК',
    badgeClass: 'production-issue-badge-defect'
  });
}

function renderProductionDelayedPage() {
  renderProductionIssueListPage({
    status: 'DELAYED',
    containerId: 'production-delayed',
    title: 'Задержано',
    routeBase: '/production/delayed',
    badgeLabel: 'ЗАДЕРЖАНО',
    badgeClass: 'production-issue-badge-delayed'
  });
}

function buildProductionShiftTimesDraft(container) {
  if (!container) return [];
  const inputs = container.querySelectorAll('input[type="time"]');
  const map = new Map();
  inputs.forEach(input => {
    const shift = parseInt(input.getAttribute('data-shift'), 10) || 1;
    const type = input.getAttribute('data-type');
    const expectedRev = parseInt(input.getAttribute('data-expected-rev') || '', 10) || 1;
    const current = map.get(shift) || {
      ...normalizeProductionShiftTimeEntry({ shift }, shift),
      expectedRev
    };
    current.expectedRev = current.expectedRev || expectedRev;
    if (type === 'from') current.timeFrom = input.value || '00:00';
    if (type === 'to') current.timeTo = input.value || '00:00';
    if (type === 'lunch-from') current.lunchFrom = input.value || '';
    if (type === 'lunch-to') current.lunchTo = input.value || '';
    map.set(shift, current);
  });
  return Array.from(map.values())
    .sort((a, b) => (a.shift || 0) - (b.shift || 0))
    .map(item => {
      const resolution = resolveProductionShiftLunchState(item);
      const normalized = {
        ...resolution.normalized,
        expectedRev: parseInt(item?.expectedRev, 10) || 1
      };
      if (resolution.status === 'partial') {
        showToast('Для обеда нужно указать и начало, и конец');
        normalized.lunchFrom = '';
        normalized.lunchTo = '';
      } else if (resolution.status === 'outside') {
        showToast('Обед смены должен полностью попадать во время работы смены');
        normalized.lunchFrom = '';
        normalized.lunchTo = '';
      }
      return normalized;
    });
}

function hasProductionShiftTimesLocalInvalidState(shiftTimesDraft = []) {
  const currentMap = new Map((productionShiftTimes || []).map(item => {
    const normalized = normalizeProductionShiftTimeEntry(item, parseInt(item?.shift, 10) || 1);
    return [String(normalized.shift), normalized];
  }));
  if (shiftTimesDraft.length !== currentMap.size) return true;
  return shiftTimesDraft.some(item => {
    const current = currentMap.get(String(item?.shift || ''));
    if (!current) return true;
    const expectedRev = parseInt(item?.expectedRev, 10) || 1;
    return expectedRev !== (parseInt(current?.rev, 10) || 1);
  });
}

async function refreshShiftTimesRouteAfterMutation(reason = 'shift-times', { routeContext = null } = {}) {
  if (typeof refreshDirectoriesMutationAfterConflict !== 'function') return false;
  return refreshDirectoriesMutationAfterConflict({
    routeContext: routeContext || captureClientWriteRouteContext(),
    reason,
    guardKey: `shiftTimes:${reason}`
  });
}

async function saveProductionShiftTimes(container) {
  if (!container) return false;
  const routeContext = typeof captureClientWriteRouteContext === 'function'
    ? captureClientWriteRouteContext()
    : { fullPath: (window.location.pathname + window.location.search) || '/shift-times' };
  const shiftTimesDraft = buildProductionShiftTimesDraft(container);
  if (!shiftTimesDraft.length) return false;

  if (hasProductionShiftTimesLocalInvalidState(shiftTimesDraft)) {
    showToast('Время смен уже было изменено другим пользователем. Данные обновлены.');
    await refreshShiftTimesRouteAfterMutation('shift-times-local-invalid', { routeContext });
    renderProductionShiftTimesForm(container);
    return false;
  }

  const saveBtn = document.getElementById('shift-times-save');
  if (typeof isServerActionButtonPending === 'function' && isServerActionButtonPending(saveBtn)) {
    return false;
  }

  const runSaveRequest = () => runClientWriteRequest({
    action: 'shift-times.update',
    writePath: '/api/directories/shift-times',
    entity: 'directory.shift-time',
    entityId: shiftTimesDraft.map(item => String(item.shift || '')).filter(Boolean).join(','),
    expectedRev: shiftTimesDraft[0]?.expectedRev ?? null,
    routeContext,
    request: () => updateShiftTimesCommand({
      shiftTimes: shiftTimesDraft.map(item => ({
        shift: item.shift,
        timeFrom: item.timeFrom,
        timeTo: item.timeTo,
        lunchFrom: item.lunchFrom,
        lunchTo: item.lunchTo,
        expectedRev: item.expectedRev
      }))
    }),
    defaultErrorMessage: 'Не удалось сохранить время смен.',
    defaultConflictMessage: 'Время смен уже было изменено другим пользователем. Данные обновлены.',
    onSuccess: async ({ payload }) => {
      if (typeof applyDirectorySlicePayload === 'function') {
        applyDirectorySlicePayload(payload);
      }
      renderProductionSchedule();
      if (typeof renderProductionShiftControls === 'function') {
        renderProductionShiftControls();
      }
      showToast('Время смен сохранено');
    },
    onConflict: async ({ payload, message }) => {
      if (typeof applyDirectorySlicePayload === 'function') {
        applyDirectorySlicePayload(payload);
      }
      showToast(message || 'Время смен уже было изменено другим пользователем. Данные обновлены.');
      renderProductionShiftTimesForm(container);
    },
    conflictRefresh: async ({ routeContext: conflictRouteContext }) => {
      await refreshShiftTimesRouteAfterMutation('shift-times-conflict', {
        routeContext: conflictRouteContext
      });
      renderProductionShiftTimesForm(container);
    },
    onError: async ({ message }) => {
      showToast(message || 'Не удалось сохранить время смен.');
    }
  });

  const result = typeof runServerActionButtonPendingAction === 'function'
    ? await runServerActionButtonPendingAction(saveBtn, runSaveRequest)
    : await runSaveRequest();
  return Boolean(result?.ok);
}

function renderProductionShiftTimesPage() {
  const container = document.getElementById('shift-times-body');
  if (!container) return;
  renderProductionShiftTimesForm(container);
  const saveBtn = document.getElementById('shift-times-save');
  if (saveBtn && saveBtn.dataset.bound !== 'true') {
    saveBtn.dataset.bound = 'true';
    saveBtn.addEventListener('click', async () => {
      const saved = await saveProductionShiftTimes(container);
      if (saved === false) return;
      renderProductionShiftTimesForm(container);
    });
  }
}

async function refreshProductionIssueRouteAfterMutation(reason = 'mutation', { routeContext = null } = {}) {
  return refreshScopedDataPreservingRoute({
    scope: 'production',
    reason: 'production-issue:' + reason,
    routeContext: routeContext || captureClientWriteRouteContext(),
    liveIgnoreWindowKey: '__productionLiveIgnoreUntil',
    liveIgnoreDurationMs: 1500
  });
}

function setupProductionModule() {
  hydrateProductionPlanViewSettings();
  productionScheduleState.weekStart = getProductionWeekStart();
  productionShiftsState.weekStart = productionShiftsState.weekStart || getProductionPlanTodayStart();
  productionShiftsState.planWindowStartSlot = productionShiftsState.planWindowStartSlot || getProductionPlanTodaySlot();
  setupProductionScheduleControls();
  bindProductionSidebarEvents();
  bindProductionTableEvents();
  bindProductionShiftPlanModal();
  bindProductionSubcontractItemsModal();
  bindProductionAutoPlanModal();
  setupProductionIssueModals();
}
