// === УТИЛИТЫ ===
function genId(prefix) {
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
}

function generateRawOpCode() {
  return 'OP-' + Math.random().toString(36).substring(2, 6).toUpperCase();
}

function generateUniqueOpCode(used = new Set()) {
  let code = generateRawOpCode();
  let attempt = 0;
  const taken = new Set(used);
  while ((taken.has(code) || !code) && attempt < 1000) {
    code = generateRawOpCode();
    attempt++;
  }
  return code;
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showToast(message) {
  const container = document.getElementById('toast-container');
  if (!container) {
    alert(message);
    return;
  }
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast--visible'));
  setTimeout(() => {
    toast.classList.remove('toast--visible');
    setTimeout(() => toast.remove(), 250);
  }, 3000);
}

function captureClientWriteRouteContext() {
  const fullPath = typeof getFullPath === 'function'
    ? getFullPath()
    : ((window.location.pathname + window.location.search) || '/');
  return {
    fullPath
  };
}

function resolveClientWriteUserMessage(payload, fallbackMessage = '') {
  const resolvedPayload = payload && typeof payload === 'object' ? payload : {};
  const message = String(resolvedPayload.error || resolvedPayload.message || '').trim();
  return message || String(fallbackMessage || '').trim();
}

function isFlowVersionConflictMessage(message = '') {
  return String(message || '').toLowerCase().includes('версия flow устарела');
}

async function runClientConflictRefreshOnce({ guardKey = '', refresh } = {}) {
  const normalizedGuardKey = String(guardKey || '').trim();
  if (normalizedGuardKey) {
    try {
      if (sessionStorage.getItem(normalizedGuardKey)) return false;
      sessionStorage.setItem(normalizedGuardKey, '1');
    } catch (err) {
      console.warn('[CONFLICT] failed to access conflict refresh guard', {
        guardKey: normalizedGuardKey,
        error: err?.message || err
      });
    }
  }
  try {
    if (typeof refresh === 'function') {
      await refresh();
    }
    return true;
  } finally {
    if (normalizedGuardKey) {
      try {
        sessionStorage.removeItem(normalizedGuardKey);
      } catch (err) {
        console.warn('[CONFLICT] failed to clear conflict refresh guard', {
          guardKey: normalizedGuardKey,
          error: err?.message || err
        });
      }
    }
  }
}

async function refreshScopedDataPreservingRoute({
  scope = DATA_SCOPE_FULL,
  reason = 'mutation',
  routeContext = null,
  liveIgnoreWindowKey = '',
  liveIgnoreDurationMs = 0
} = {}) {
  const safeRouteContext = routeContext || captureClientWriteRouteContext();
  const fullPath = safeRouteContext?.fullPath || '/';
  const liveKey = String(liveIgnoreWindowKey || '').trim();
  if (liveKey) {
    window[liveKey] = Date.now() + Math.max(0, Number(liveIgnoreDurationMs) || 0);
  }
  console.log('[DATA] targeted refresh start', {
    scope,
    reason,
    route: fullPath
  });
  if (typeof loadDataWithScope === 'function') {
    await loadDataWithScope({ scope, force: true, reason });
  } else if (typeof loadData === 'function') {
    await loadData();
  }
  if (typeof handleRoute === 'function') {
    handleRoute(fullPath, { replace: true, fromHistory: true, soft: true });
  }
  console.log('[DATA] targeted refresh done', {
    scope,
    reason,
    route: fullPath
  });
  return true;
}

async function runClientWriteRequest({
  action = 'client-write',
  request,
  routeContext = null,
  defaultErrorMessage = 'Не удалось выполнить действие.',
  defaultConflictMessage = '',
  onSuccess = null,
  onConflict = null,
  onError = null,
  successRefresh = null,
  conflictRefresh = null
} = {}) {
  if (typeof request !== 'function') {
    throw new Error('runClientWriteRequest requires request()');
  }
  const safeRouteContext = routeContext || captureClientWriteRouteContext();
  const res = await request();
  const payload = await res.json().catch(() => ({}));

  if (!res.ok) {
    const fallbackMessage = res.status === 409
      ? (defaultConflictMessage || defaultErrorMessage)
      : defaultErrorMessage;
    const message = resolveClientWriteUserMessage(payload, typeof fallbackMessage === 'function'
      ? fallbackMessage({ res, payload, routeContext: safeRouteContext })
      : fallbackMessage);
    const diagnosticPayload = {
      action,
      status: res.status,
      route: safeRouteContext.fullPath,
      code: payload?.code || '',
      entity: payload?.entity || '',
      id: payload?.id || '',
      expectedRev: payload?.expectedRev ?? payload?.expectedFlowVersion ?? null,
      actualRev: payload?.actualRev ?? payload?.flowVersion ?? null
    };
    if (res.status === 409) {
      console.warn('[CONFLICT] client write conflict', diagnosticPayload);
      if (typeof onConflict === 'function') {
        await onConflict({ res, payload, message, routeContext: safeRouteContext });
      }
      if (typeof conflictRefresh === 'function') {
        await conflictRefresh({ res, payload, message, routeContext: safeRouteContext });
      }
      return { ok: false, isConflict: true, res, payload, message, routeContext: safeRouteContext };
    }
    console.warn('[DATA] client write error', {
      ...diagnosticPayload,
      message
    });
    if (typeof onError === 'function') {
      await onError({ res, payload, message, routeContext: safeRouteContext });
    }
    return { ok: false, isConflict: false, res, payload, message, routeContext: safeRouteContext };
  }

  console.log('[DATA] client write success', {
    action,
    status: res.status,
    route: safeRouteContext.fullPath
  });
  if (typeof onSuccess === 'function') {
    await onSuccess({ res, payload, routeContext: safeRouteContext });
  }
  if (typeof successRefresh === 'function') {
    await successRefresh({ res, payload, routeContext: safeRouteContext });
  }
  return { ok: true, res, payload, routeContext: safeRouteContext };
}

const APP_VERSION_FOOTER_PLACEHOLDER = '__APP_VERSION_FOOTER__';

function formatAppVersionPart(value) {
  const numeric = Number.isFinite(value) ? value : 0;
  return String(numeric).padStart(2, '0');
}

function formatAppVersionMajor(stage, value) {
  const numeric = Number.isFinite(value) ? value : 0;
  return String(stage || '').trim() === 'Betta'
    ? formatAppVersionPart(numeric)
    : String(numeric);
}

function buildAppVersionFooterText(meta) {
  const resolved = meta && typeof meta === 'object' ? meta : {};
  const productName = String(resolved.productName || 'Tracker').trim() || 'Tracker';
  const stage = String(resolved.stage || 'Alpha').trim() || 'Alpha';
  const email = String(resolved.email || 'a.protasov@tspc.ru').trim() || 'a.protasov@tspc.ru';
  const version = [
    formatAppVersionMajor(stage, Number(resolved.major || 0)),
    formatAppVersionPart(Number(resolved.minor || 0)),
    formatAppVersionPart(Number(resolved.patch || 0))
  ].join('.');
  return `${productName} ${stage} v ${version} mail to: ${email}`;
}

function applyAppVersionText(target, placeholder = APP_VERSION_FOOTER_PLACEHOLDER) {
  if (!target) return false;
  const currentText = String(target.textContent || '').trim();
  if (currentText && currentText !== placeholder) return true;
  if (window.__APP_VERSION_FOOTER_TEXT__) {
    target.textContent = window.__APP_VERSION_FOOTER_TEXT__;
    return true;
  }
  if (window.__APP_VERSION_META__) {
    const nextText = buildAppVersionFooterText(window.__APP_VERSION_META__);
    window.__APP_VERSION_FOOTER_TEXT__ = nextText;
    target.textContent = nextText;
    return true;
  }
  return false;
}

async function ensureAppVersionFooter() {
  const footer = document.getElementById('app-footer');
  if (!footer) return;
  if (applyAppVersionText(footer)) return;
  try {
    const response = await fetch('/app-version.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const meta = await response.json();
    const nextText = buildAppVersionFooterText(meta);
    window.__APP_VERSION_META__ = meta;
    window.__APP_VERSION_FOOTER_TEXT__ = nextText;
    footer.textContent = nextText;
  } catch (err) {
    console.error('[BOOT] Failed to hydrate footer version from /app-version.json', err?.message || err);
    footer.textContent = '';
  }
}

async function ensureLoginVersionFooter() {
  const loginVersion = document.getElementById('login-version');
  if (!loginVersion) return;
  if (applyAppVersionText(loginVersion)) return;
  await ensureAppVersionFooter();
  applyAppVersionText(loginVersion);
}

function wrapTable(tableHtml) {
  return '<div class="table-wrapper">' + tableHtml + '</div>';
}

function normalizeOperationType(value) {
  const raw = (value || '').toString().trim();
  if (!raw) return DEFAULT_OPERATION_TYPE;
  const matched = OPERATION_TYPE_OPTIONS.find(option => option.toLowerCase() === raw.toLowerCase());
  return matched || DEFAULT_OPERATION_TYPE;
}

function normalizeAreaType(value) {
  const raw = (value || '').toString().trim();
  if (!raw) return DEFAULT_AREA_TYPE;
  const matched = AREA_TYPE_OPTIONS.find(option => option.toLowerCase() === raw.toLowerCase());
  return matched || DEFAULT_AREA_TYPE;
}

function getAreaTypeDisplayLabel(value) {
  const type = normalizeAreaType(value);
  return AREA_TYPE_DISPLAY_LABELS[type] || type;
}

function normalizeArea(area) {
  if (!area || typeof area !== 'object') {
    return {
      id: '',
      name: '',
      desc: '',
      type: DEFAULT_AREA_TYPE
    };
  }
  return {
    ...area,
    id: (area.id || '').toString().trim(),
    name: (area.name || '').toString().trim(),
    desc: (area.desc || '').toString().trim(),
    type: normalizeAreaType(area.type)
  };
}

function shouldShowAreaTypeTag(area) {
  const type = normalizeAreaType(area?.type);
  return Boolean(type && type !== DEFAULT_AREA_TYPE);
}

function renderAreaLabel(area, options = {}) {
  const fallbackName = options.fallbackName != null ? String(options.fallbackName) : 'Участок';
  const explicitName = options.name != null ? String(options.name) : '';
  const resolvedName = explicitName || area?.name || area?.title || fallbackName;
  const safeName = String(resolvedName || fallbackName).trim() || fallbackName;
  const className = [options.className, 'area-title-block'].filter(Boolean).join(' ');
  const typeHtml = shouldShowAreaTypeTag(area)
    ? '<span class="area-type-tag">[' + escapeHtml(getAreaTypeDisplayLabel(area.type)) + ']</span>'
    : '';
  return '<span class="' + className + '">'
    + '<span class="area-title-line">' + escapeHtml(safeName) + '</span>'
    + typeHtml
    + '</span>';
}

function ensureAreaTypes() {
  if (!Array.isArray(areas)) {
    areas = [];
    return;
  }
  areas = areas.map(area => normalizeArea(area));
}

function isMaterialIssueOperation(op) {
  return normalizeOperationType(op?.operationType) === 'Получение материала';
}

function isDocumentsOperation(op) {
  return normalizeOperationType(op?.operationType) === 'Документы';
}

function isIdentificationOperation(op) {
  return normalizeOperationType(op?.operationType) === 'Идентификация';
}

function isMaterialReturnOperation(op) {
  return normalizeOperationType(op?.operationType) === 'Возврат материала';
}

function isDryingOperation(op) {
  return normalizeOperationType(op?.operationType) === 'Сушка';
}

function formatSecondsToHMS(sec) {
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const hh = h.toString().padStart(2, '0');
  const mm = m.toString().padStart(2, '0');
  const ss = s.toString().padStart(2, '0');
  return hh + ':' + mm + ':' + ss;
}

function formatDateTime(ts) {
  if (!ts) return '-';
  try {
    return new Date(ts).toLocaleString();
  } catch (e) {
    return '-';
  }
}

function formatDateDisplay(value) {
  const normalized = formatDateInputValue(value);
  if (!normalized) return '';
  const [yyyy, mm, dd] = normalized.split('-');
  if (!yyyy || !mm || !dd) return normalized;
  return `${dd}.${mm}.${yyyy}`;
}

function formatStartEnd(op) {
  const start = op.firstStartedAt || op.startedAt;
  let endLabel = '-';
  if (op.status === 'PAUSED') {
    const pauseTs = op.lastPausedAt || Date.now();
    endLabel = formatDateTime(pauseTs) + ' (П)';
  } else if (op.finishedAt) {
    endLabel = formatDateTime(op.finishedAt);
  } else if (op.status === 'DONE' && op.finishedAt) {
    endLabel = formatDateTime(op.finishedAt);
  } else if (op.status === 'IN_PROGRESS') {
    endLabel = '-';
  }

  return '<div class="nk-lines"><div>Н: ' + escapeHtml(formatDateTime(start)) + '</div><div>К: ' + escapeHtml(endLabel) + '</div></div>';
}

function generatePassword(len = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789';
  let pwd = '';
  while (pwd.length < len) {
    const idx = Math.floor(Math.random() * chars.length);
    pwd += chars[idx];
  }
  return pwd;
}

// Время операции с учётом пауз / продолжений
function resolveCardForOperation(op) {
  if (!op || !Array.isArray(cards)) return null;
  return cards.find(card => Array.isArray(card?.operations) && card.operations.some(candidate => candidate === op || candidate?.id === op.id)) || null;
}

function getDryingOperationElapsedSeconds(op, card) {
  if (!op || !isDryingOperation(op) || typeof buildDryingRows !== 'function' || typeof getDryingElapsedSeconds !== 'function') {
    return 0;
  }
  const resolvedCard = card || resolveCardForOperation(op);
  if (!resolvedCard) return 0;
  const rows = buildDryingRows(resolvedCard, op);
  if (!Array.isArray(rows) || !rows.length) return 0;
  return rows.reduce((total, row) => total + getDryingElapsedSeconds(row), 0);
}

function isOperationTimerActive(op, card) {
  if (!op) return false;
  if (isDryingOperation(op)) {
    if (typeof buildDryingRows !== 'function') return false;
    const resolvedCard = card || resolveCardForOperation(op);
    if (!resolvedCard) return false;
    const rows = buildDryingRows(resolvedCard, op);
    return Array.isArray(rows) && rows.some(row => (row?.status || '') === 'IN_PROGRESS' && row?.startedAt);
  }
  return op.status === 'IN_PROGRESS' && !!op.startedAt;
}

function getOperationElapsedSeconds(op, card = null) {
  if (isDryingOperation(op)) {
    return getDryingOperationElapsedSeconds(op, card);
  }
  const base = typeof op.elapsedSeconds === 'number' ? op.elapsedSeconds : 0;
  if (op.status === 'IN_PROGRESS' && op.startedAt) {
    return base + (Date.now() - op.startedAt) / 1000;
  }
  return base;
}

function autoResizeComment(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function getUserPermissions() {
  if (!currentUser || !currentUser.permissions) return null;
  return currentUser.permissions;
}

function hasWorkerLikePermissions(permissions) {
  return Boolean(permissions && (permissions.worker || permissions.labWorker));
}

function getUserAccessStatusLabel(user) {
  const permissions = user?.permissions || null;
  if (permissions?.labWorker) return 'Сотрудник лаборатории';
  if (permissions?.skkWorker) return 'Сотрудник СКК';
  if (permissions?.warehouseWorker) return 'Работник склада';
  if (permissions?.worker) return 'Рабочий';
  return String(user?.role || user?.status || '').trim();
}

function getTabPermissionEntry(perms, tabKey) {
  if (!perms) return null;
  const tabs = perms.tabs || {};
  if (Object.prototype.hasOwnProperty.call(tabs, tabKey)) {
    return tabs[tabKey];
  }
  const legacyKeys = typeof getAccessLegacyPermissionKeys === 'function'
    ? getAccessLegacyPermissionKeys(tabKey)
    : [];
  for (const legacyKey of legacyKeys) {
    if (Object.prototype.hasOwnProperty.call(tabs, legacyKey)) {
      return tabs[legacyKey];
    }
  }
  return null;
}

function canViewTab(tabKey) {
  const perms = getUserPermissions();
  if (!perms) return true;
  const tab = getTabPermissionEntry(perms, tabKey);
  return tab ? !!tab.view : true;
}

function canEditTab(tabKey) {
  const perms = getUserPermissions();
  if (!perms) return true;
  const tab = getTabPermissionEntry(perms, tabKey);
  return tab ? !!tab.edit : true;
}

function canAccessTab(tabKey, accessMode = 'view') {
  return accessMode === 'edit'
    ? canEditTab(tabKey)
    : canViewTab(tabKey);
}

function isTabReadonly(tabKey) {
  return canViewTab(tabKey) && !canEditTab(tabKey);
}

function isReadonlyViewAllowedControl(ctrl) {
  if (!ctrl) return false;
  if (ctrl.dataset.allowView === 'true') return true;
  if (ctrl.classList && ctrl.classList.contains('camera-scan-btn')) return true;

  const explicitViewControlIds = new Set([
    'production-week-start',
    'production-today',
    'production-department',
    'production-filter',
    'production-reset',
    'production-shifts-week-start',
    'production-shifts-today',
    'production-shifts-queue-toggle',
    'production-shifts-queue-search',
    'production-plan-visible-columns',
    'production-shifts-back-to-queue',
    'production-auto-plan-open',
    'production-gantt-open',
    'production-shift-close-filter'
  ]);
  if (ctrl.id && explicitViewControlIds.has(ctrl.id)) return true;

  const explicitViewControlClasses = [
    'production-shift-btn',
    'production-employee',
    'production-day-shift',
    'production-shifts-shift-btn',
    'production-shifts-card-btn',
    'production-shift-board-jump',
    'production-shift-close-filter-input',
    'production-shifts-queue-search'
  ];
  if (ctrl.classList && explicitViewControlClasses.some(className => ctrl.classList.contains(className))) {
    return true;
  }

  const viewContainers = [
    '.search-with-camera',
    '.cards-filters-row',
    '.workorders-filters',
    '.items-page-filters',
    '.workspace-search-row',
    '.areas-load-filters',
    '.production-shift-log-controls',
    '.production-shift-close-filter-row'
  ];
  if (viewContainers.some(selector => ctrl.closest(selector))) {
    return true;
  }

  const tokens = [
    ctrl.id,
    ctrl.name,
    String(ctrl.className || ''),
    ctrl.getAttribute('data-action'),
    ctrl.getAttribute('aria-label')
  ].filter(Boolean).join(' ').toLowerCase();

  return /search|filter|scan|camera|clear/.test(tokens);
}

function getCurrentRoutePermissionKey() {
  if (typeof getAccessRoutePermission !== 'function') return '';
  const routePermission = getAccessRoutePermission(window.location.pathname || '');
  return routePermission && routePermission.key
    ? String(routePermission.key).trim()
    : '';
}

function isCurrentTabReadonly() {
  const tabKey = getCurrentRoutePermissionKey() || String(appState?.tab || '').trim();
  if (!tabKey) return false;
  return canViewTab(tabKey) && !canEditTab(tabKey);
}

function isApprovalStatus(value) {
  return value === APPROVAL_STATUS_APPROVED || value === APPROVAL_STATUS_REJECTED;
}

function normalizeApprovalStatus(value, fallback = null) {
  return isApprovalStatus(value) ? value : fallback;
}

function isCardApprovalBlocked(card) {
  if (!card) return true;
  return card.approvalStage !== APPROVAL_STAGE_ON_APPROVAL;
}

function isCardProductionEligible(card) {
  if (!card) return false;
  return [
    APPROVAL_STAGE_PROVIDED,
    APPROVAL_STAGE_PLANNING,
    APPROVAL_STAGE_PLANNED
  ].includes(card.approvalStage);
}

function recalcCardPlanningStage(cardId) {
  const card = cards.find(c => c.id === cardId);
  if (!card) return;

  if (![APPROVAL_STAGE_PROVIDED, APPROVAL_STAGE_PLANNING, APPROVAL_STAGE_PLANNED].includes(card.approvalStage)) {
    return;
  }

  const plannableOps = (card.operations || []).filter(op => (
    op
    && !isMaterialIssueOperation(op)
    && !isMaterialReturnOperation(op)
  ));
  const totalOps = plannableOps.length;
  const processState = getCardProcessState(card);
  let coveredCount = 0;
  let plannedCount = 0;

  plannableOps.forEach(op => {
    if (!op?.id) return;
    if (typeof getOperationPlanningSnapshot === 'function') {
      const snapshot = getOperationPlanningSnapshot(cardId, op.id);
      if (snapshot.plannedMinutes > 0 || snapshot.availableToPlanMinutes === 0) plannedCount += 1;
      if (snapshot.availableToPlanMinutes === 0) coveredCount += 1;
      return;
    }
    const hasPlan = (productionShiftTasks || []).some(task => task.cardId === cardId && String(task.routeOpId || '') === String(op.id || ''));
    if (hasPlan) {
      plannedCount += 1;
      coveredCount += 1;
    }
  });

  if (totalOps === 0) {
    card.approvalStage = APPROVAL_STAGE_PLANNED;
    return;
  }

  if (plannedCount === 0) {
    if (processState.key === 'NOT_STARTED') {
      card.approvalStage = APPROVAL_STAGE_PROVIDED;
    } else {
      card.approvalStage = APPROVAL_STAGE_PLANNING;
    }
    return;
  }

  if (coveredCount < totalOps) {
    card.approvalStage = APPROVAL_STAGE_PLANNING;
    return;
  }

  card.approvalStage = APPROVAL_STAGE_PLANNED;
}

const APPROVAL_STATUS_FIELDS = ['approvalProductionStatus', 'approvalSKKStatus', 'approvalTechStatus'];

function areAllApprovalsApproved(card) {
  if (!card) return false;
  return APPROVAL_STATUS_FIELDS.every(field => card[field] === APPROVAL_STATUS_APPROVED);
}

function hasAnyApprovalRejected(card) {
  if (!card) return false;
  return APPROVAL_STATUS_FIELDS.some(field => card[field] === APPROVAL_STATUS_REJECTED);
}

function syncApprovalStatus(card) {
  if (!card) return;
  if (card.approvalStage === APPROVAL_STAGE_ON_APPROVAL) {
    if (areAllApprovalsApproved(card)) {
      card.approvalStage = APPROVAL_STAGE_APPROVED;
    } else if (hasAnyApprovalRejected(card)) {
      card.approvalStage = APPROVAL_STAGE_REJECTED;
    }
  }
}

function applyReadonlyState(tabKey, sectionId) {
  const section = document.getElementById(sectionId);
  if (!section) return;
  const readonly = isTabReadonly(tabKey);
  section.classList.toggle('tab-readonly', readonly);

  const controls = section.querySelectorAll('input, select, textarea, button');
  controls.forEach(ctrl => {
    const allowView = isReadonlyViewAllowedControl(ctrl);
    if (readonly && !allowView) {
      ctrl.disabled = true;
      ctrl.classList.add('view-disabled');
    } else {
      ctrl.disabled = false;
      ctrl.classList.remove('view-disabled');
    }
  });
}

function cloneCard(card) {
  return JSON.parse(JSON.stringify(card));
}

function getCardBarcodeValue(card) {
  if (!card) return '';
  const qr = normalizeQrId(card.qrId || '');
  return qr || '';
}

function getCardRouteNumberForTitle(card) {
  const route = String(card?.routeCardNumber || '').trim();
  return route || getCardBarcodeValue(card) || '';
}

function toSafeCount(val) {
  const num = parseInt(val, 10);
  if (!Number.isFinite(num) || num < 0) return 0;
  return num;
}

function clampToSafeCount(val, max) {
  const safe = toSafeCount(val);
  if (!Number.isFinite(max) || max < 0) return safe;
  return Math.min(safe, max);
}

function sanitizeEncodingArtifacts(value) {
  if (value == null) return '';
  return String(value).replace(/\uFFFD/g, '').trim();
}

function normalizeSerialInput(value) {
  if (Array.isArray(value)) return value.map(v => sanitizeEncodingArtifacts(v));
  if (typeof value === 'string') {
    return value.split(/\r?\n|,/).map(v => sanitizeEncodingArtifacts(v));
  }
  return [];
}

function resizeSerialList(list, targetLength, { fillDefaults = false } = {}) {
  const safeList = Array.isArray(list) ? list : [];
  const length = Math.max(0, targetLength || 0);
  const result = [];
  for (let i = 0; i < length; i++) {
    if (i < safeList.length) {
      const val = safeList[i];
      result.push(sanitizeEncodingArtifacts(val));
    } else if (fillDefaults) {
      result.push('Без номера ' + (i + 1));
    } else {
      result.push('');
    }
  }
  return result;
}

function hasEmptySerial(values = []) {
  return (values || []).some(v => !String(v || '').trim());
}

function looksLikeLegacyBarcode(code) {
  return /^\d{13}$/.test((code || '').trim());
}

function normalizeScanIdInput(raw) {
  const mapping = {
    'Ф': 'A', 'И': 'B', 'С': 'C', 'В': 'D', 'У': 'E', 'А': 'F', 'П': 'G', 'Р': 'H',
    'Ш': 'I', 'О': 'J', 'Л': 'K', 'Д': 'L', 'Ь': 'M', 'Т': 'N', 'Щ': 'O', 'З': 'P',
    'Й': 'Q', 'К': 'R', 'Ы': 'S', 'Е': 'T', 'Г': 'U', 'М': 'V', 'Ц': 'W', 'Ч': 'X',
    'Н': 'Y', 'Я': 'Z'
  };
  const upper = (raw || '').toString().trim().toUpperCase();
  let result = '';
  for (let i = 0; i < upper.length; i += 1) {
    const ch = upper[i];
    result += mapping[ch] || ch;
  }
  return result.replace(/[^A-Z0-9]/g, '');
}

function isValidScanId(value) {
  return /^[A-Z0-9]{6,32}$/.test(value || '');
}

function normalizeQrId(value) {
  return normalizeScanIdInput(value);
}

function generateCardQrId(len = 10) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  while (code.length < len) {
    const idx = Math.floor(Math.random() * chars.length);
    code += chars[idx];
  }
  return code;
}

function collectQrIdSet(excludeId = null) {
  const set = new Set();
  (cards || []).forEach(card => {
    if (!card || card.id === excludeId) return;
    const value = normalizeQrId(card.qrId || '');
    if (value) set.add(value);
  });
  return set;
}

function generateUniqueCardQrId(used = collectQrIdSet()) {
  let attempt = 0;
  while (attempt < 1000) {
    const code = generateCardQrId();
    if (!used.has(code)) {
      used.add(code);
      return code;
    }
    attempt += 1;
  }
  const fallback = generateCardQrId(12);
  used.add(fallback);
  return fallback;
}

function ensureUniqueQrIds(list = cards) {
  const used = new Set();
  (list || []).forEach(card => {
    if (!card) return;
    let value = normalizeQrId(card.qrId || '');
    if (!isValidScanId(value) || used.has(value)) {
      value = generateUniqueCardQrId(used);
    }
    card.qrId = value;
    used.add(value);
  });
}

function generateCardCode128() {
  return `MK-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function collectBarcodeSet(excludeId = null) {
  const set = new Set();
  (cards || []).forEach(card => {
    if (!card || card.id === excludeId) return;
    const value = (card.barcode || '').trim();
    if (value) set.add(value);
  });
  return set;
}

function generateUniqueCardCode128(used = collectBarcodeSet()) {
  let attempt = 0;
  while (attempt < 1000) {
    const code = generateCardCode128();
    const exists = (cards || []).some(c => (c?.barcode || '').trim() === code) || used.has(code);
    if (!exists) {
      used.add(code);
      return code;
    }
    attempt += 1;
  }
  const fallback = `${generateCardCode128()}-${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
  used.add(fallback);
  return fallback;
}

function normalizeSortText(value) {
  return String(value == null ? '' : value).trim();
}

function compareTextNatural(a, b) {
  const aa = normalizeSortText(a);
  const bb = normalizeSortText(b);
  return aa.localeCompare(bb, 'ru', { numeric: true, sensitivity: 'base' });
}

function getCardRouteNumberForSort(card) {
  return normalizeSortText(card?.routeCardNumber || '');
}

function getCardNameForSort(card) {
  return normalizeSortText(card?.name || '');
}

function getCardCreatedAtForSort(card) {
  return Number(card?.createdAt) || 0;
}

function getCardCreatedDateValue(card) {
  return formatDateInputValue(getCardCreatedAtForSort(card));
}

function getCardCreatedDateDisplay(card) {
  return formatDateDisplay(getCardCreatedDateValue(card));
}

function getCardFilesCount(card) {
  if (Array.isArray(card?.attachments)) {
    return card.attachments.filter(file => file && file.relPath).length;
  }
  if (typeof card?.filesCount === 'number') return card.filesCount;
  return 0;
}

function getCardOpsCount(card) {
  return Array.isArray(card?.operations) ? card.operations.length : 0;
}

function sortCardsByKey(cardsArr, key, dir, getValue) {
  const mul = dir === 'desc' ? -1 : 1;
  return [...cardsArr].sort((a, b) => {
    const va = getValue(a);
    const vb = getValue(b);

    if (typeof va === 'number' && typeof vb === 'number') {
      return (va - vb) * mul;
    }

    const sa = normalizeSortText(va);
    const sb = normalizeSortText(vb);
    const aEmpty = !sa;
    const bEmpty = !sb;
    if (aEmpty && !bEmpty) return 1;
    if (!aEmpty && bEmpty) return -1;

    return compareTextNatural(sa, sb) * mul;
  });
}

function updateTableSortUI(wrapper, sortKey, sortDir) {
  if (!wrapper) return;
  const ths = wrapper.querySelectorAll('th.th-sortable');
  ths.forEach(th => {
    th.classList.remove('active');
    const old = th.querySelector('.th-sort-ind');
    if (old) old.remove();

    if (th.getAttribute('data-sort-key') === sortKey) {
      th.classList.add('active');
      const span = document.createElement('span');
      span.className = 'th-sort-ind';
      span.textContent = sortDir === 'asc' ? ' ▲' : ' ▼';
      th.appendChild(span);
    }
  });
}

function ensureUniqueBarcodes(list = cards) {
  const used = new Set();
  (list || []).forEach(card => {
    if (!card) return;
    let value = (card.barcode || '').trim();
    const legacy = looksLikeLegacyBarcode(value);
    if (!value || legacy || used.has(value)) {
      value = generateUniqueCardCode128(used);
    }
    card.barcode = value;
    used.add(value);
  });
}

function getCardPlannedQuantity(card) {
  if (!card) return { qty: null, hasValue: false };
  const rawQty = card.batchSize;
  if (rawQty !== '' && rawQty != null) {
    return { qty: toSafeCount(rawQty), hasValue: true };
  }
  return { qty: null, hasValue: false };
}

function formatStepCode(step) {
  return String(step * 5).padStart(3, '0');
}

function computeMkiOperationQuantity(op, card) {
  if (!card || card.cardType !== 'MKI') return null;
  if (op && op.isSamples) {
    const sampleType = normalizeSampleType(op.sampleType);
    const source = sampleType === 'WITNESS' ? card.witnessSampleCount : card.sampleCount;
    if (source === '' || source == null) return '';
    const qty = toSafeCount(source);
    return Number.isFinite(qty) ? qty : '';
  }
  const source = card.quantity;
  if (source === '' || source == null) return '';
  const qty = toSafeCount(source);
  return Number.isFinite(qty) ? qty : '';
}

function normalizeSampleType(value) {
  const raw = (value || '').toString().trim().toUpperCase();
  return raw === 'WITNESS' ? 'WITNESS' : 'CONTROL';
}

function getOperationQuantity(op, card) {
  if (card && card.cardType === 'MKI') {
    const computed = computeMkiOperationQuantity(op, card);
    return computed === null ? '' : computed;
  }
  if (op && (op.quantity || op.quantity === 0)) {
    const q = toSafeCount(op.quantity);
    return Number.isFinite(q) ? q : '';
  }
  if (card && (card.quantity || card.quantity === 0)) {
    const q = toSafeCount(card.quantity);
    return Number.isFinite(q) ? q : '';
  }
  return '';
}

function recalcMkiOperationQuantities(card) {
  if (!card || card.cardType !== 'MKI' || !Array.isArray(card.operations)) return;
  card.operations.forEach(op => {
    op.quantity = computeMkiOperationQuantity(op, card);
  });
}

function calculateFinalResults(operations = [], initialQty = 0) {
  const total = toSafeCount(initialQty);
  const opsSorted = Array.isArray(operations)
    ? operations.filter(Boolean).slice().sort((a, b) => (a.order || 0) - (b.order || 0))
    : [];

  const lastOp = opsSorted[opsSorted.length - 1];
  const goodFinal = toSafeCount(lastOp && lastOp.goodCount != null ? lastOp.goodCount : 0);
  const scrapFinal = toSafeCount(lastOp && lastOp.scrapCount != null ? lastOp.scrapCount : 0);
  const delayedFinal = toSafeCount(lastOp && lastOp.holdCount != null ? lastOp.holdCount : 0);

  return {
    good_final: goodFinal,
    scrap_final: scrapFinal,
    delayed_final: delayedFinal,
    summary_ok: total === 0 || goodFinal + scrapFinal + delayedFinal === total
  };
}

const flowOperationConsistencyWarnings = new Set();

function getOperationExecutionStats(card, op, { logConsistency = true } = {}) {
  const fallback = {
    totalCard: 0,
    onOpTotal: 0,
    pendingOnOp: 0,
    awaiting: 0,
    good: toSafeCount(op?.goodCount || 0),
    defect: toSafeCount(op?.scrapCount || 0),
    delayed: toSafeCount(op?.holdCount || 0)
  };
  fallback.completed = fallback.good + fallback.defect + fallback.delayed;
  fallback.remaining = Math.max(0, fallback.totalCard - (fallback.defect + fallback.delayed));

  if (!card || !op || card.cardType !== 'MKI') {
    return fallback;
  }

  let stats = null;
  if (typeof collectOpFlowStats === 'function') {
    stats = collectOpFlowStats(card, op);
  } else if (op.flowStats) {
    stats = op.flowStats;
  }
  if (!stats) return fallback;

  const normalized = {
    totalCard: Math.max(0, Number(stats.totalCard || 0)),
    onOpTotal: Math.max(0, Number(stats.onOpTotal || 0)),
    pendingOnOp: Math.max(0, Number(stats.pendingOnOp || 0)),
    awaiting: Math.max(0, Number(stats.awaiting || 0)),
    good: Math.max(0, Number(stats.good || 0)),
    defect: Math.max(0, Number(stats.defect || 0)),
    delayed: Math.max(0, Number(stats.delayed || 0))
  };
  normalized.completed = Number.isFinite(Number(stats.completed))
    ? Math.max(0, Number(stats.completed))
    : (normalized.good + normalized.defect + normalized.delayed);
  normalized.remaining = Number.isFinite(Number(stats.remaining))
    ? Math.max(0, Number(stats.remaining))
    : Math.max(0, normalized.totalCard - (normalized.defect + normalized.delayed));

  if (logConsistency) {
    const storedGood = toSafeCount(op.goodCount || 0);
    const storedDefect = toSafeCount(op.scrapCount || 0);
    const storedDelayed = toSafeCount(op.holdCount || 0);
    if (
      storedGood !== normalized.good
      || storedDefect !== normalized.defect
      || storedDelayed !== normalized.delayed
    ) {
      const warningKey = [
        card.id || '',
        op.id || op.opId || '',
        storedGood,
        storedDefect,
        storedDelayed,
        normalized.good,
        normalized.defect,
        normalized.delayed
      ].join('|');
      if (!flowOperationConsistencyWarnings.has(warningKey)) {
        flowOperationConsistencyWarnings.add(warningKey);
        console.warn(
          '[CONSISTENCY][FLOW] operation stats mismatch',
          {
            cardId: card.id || '',
            opId: op.id || op.opId || '',
            stored: { good: storedGood, defect: storedDefect, delayed: storedDelayed },
            flow: { good: normalized.good, defect: normalized.defect, delayed: normalized.delayed }
          }
        );
      }
    }
  }

  return normalized;
}

 

function renumberAutoCodesForCard(card) {
  if (!card || !Array.isArray(card.operations)) return;
  const opsSorted = [...card.operations].sort((a, b) => (a.order || 0) - (b.order || 0));
  let autoIndex = 0;
  opsSorted.forEach(op => {
    if (op.autoCode) {
      autoIndex++;
      op.opCode = formatStepCode(autoIndex);
    }
  });
}

function ensureAttachments(card) {
  if (!card) return;
  if (!Array.isArray(card.attachments)) card.attachments = [];
  card.attachments = card.attachments.map(file => ({
    id: file.id || genId('file'),
    name: file.name || file.originalName || 'file',
    originalName: file.originalName || file.name || 'file',
    storedName: file.storedName || '',
    relPath: file.relPath || '',
    type: file.type || file.mime || 'application/octet-stream',
    mime: file.mime || file.type || 'application/octet-stream',
    size: typeof file.size === 'number' ? file.size : 0,
    content: typeof file.content === 'string' ? file.content : '',
    createdAt: file.createdAt || Date.now(),
    category: String(file.category || 'GENERAL').toUpperCase(),
    scope: String(file.scope || 'CARD').toUpperCase(),
    scopeId: file.scopeId || null,
    operationLabel: file.operationLabel || '',
    itemsLabel: file.itemsLabel || '',
    opId: file.opId || null,
    opCode: file.opCode || '',
    opName: file.opName || ''
  }));
}

function normalizeFlowSerialList(raw, fallbackCount = 0) {
  let list = [];
  if (Array.isArray(raw)) {
    list = raw.map(value => (value == null ? '' : String(value)));
  } else if (typeof raw === 'string' && raw.trim()) {
    list = [raw.trim()];
  }
  if (!list.length && Number.isFinite(fallbackCount) && fallbackCount > 0) {
    list = Array.from({ length: fallbackCount }, () => '');
  }
  return list;
}

function parseAutoSampleSerial(value, prefixLetter) {
  const trimmed = (value || '').toString().trim();
  if (!trimmed) return null;
  const match = trimmed.match(new RegExp(`^(.+)-${prefixLetter}(\\d+)-(\\d{4})$`));
  if (!match) return null;
  return {
    base: match[1],
    seq: parseInt(match[2], 10),
    year: match[3]
  };
}

function detectAutoSampleSerialBase(values, prefixLetter, routeNo, prevRouteNo = '') {
  const currentBase = (routeNo || '').toString().trim();
  const previousBase = (prevRouteNo || '').toString().trim();
  if (previousBase && currentBase && previousBase !== currentBase) return previousBase;

  const prefixes = new Set();
  let nonEmptyCount = 0;
  let matchedCount = 0;

  (values || []).forEach((value, idx) => {
    const trimmed = (value || '').toString().trim();
    if (!trimmed) return;
    nonEmptyCount += 1;
    const parsed = parseAutoSampleSerial(trimmed, prefixLetter);
    if (!parsed || parsed.seq !== idx + 1) return;
    prefixes.add(parsed.base);
    matchedCount += 1;
  });

  if (!nonEmptyCount || matchedCount !== nonEmptyCount || prefixes.size !== 1) return '';
  const [detectedBase] = Array.from(prefixes);
  if (!detectedBase || detectedBase === currentBase) return '';
  return detectedBase;
}

function normalizeAutoSampleSerials(values, count, prefixLetter, routeNo, year, prevRouteNo = '') {
  const normalized = normalizeSerialInput(values);
  const sized = resizeSerialList(normalized, count, { fillDefaults: false });
  const currentBase = (routeNo || '').toString().trim();
  if (!currentBase) return sized;

  const rebaseBase = detectAutoSampleSerialBase(sized, prefixLetter, currentBase, prevRouteNo);
  return sized.map((val, idx) => {
    const trimmed = (val || '').toString().trim();
    if (!trimmed) {
      return `${currentBase}-${prefixLetter}${idx + 1}-${year}`;
    }
    const parsed = parseAutoSampleSerial(trimmed, prefixLetter);
    if (parsed && rebaseBase && parsed.base === rebaseBase && parsed.seq === idx + 1) {
      return `${currentBase}-${prefixLetter}${parsed.seq}-${parsed.year}`;
    }
    return val;
  });
}

function buildFlowDisplayName(serials, kind, index) {
  const raw = Array.isArray(serials) ? serials[index] : '';
  const value = (raw == null ? '' : String(raw)).trim();
  if (value) return value;
  return kind === 'SAMPLE' ? `Образец #${index + 1}` : `Изделие #${index + 1}`;
}

function collectFlowQrSet(card) {
  const set = new Set();
  if (!card || !card.flow) return set;
  const items = Array.isArray(card.flow.items) ? card.flow.items : [];
  const samples = Array.isArray(card.flow.samples) ? card.flow.samples : [];
  items.concat(samples).forEach(item => {
    const code = normalizeItemQrCode(item?.qrCode || '')
      || extractItemQrCode(item?.qr || '', card?.qrId || '')
      || extractAnyItemQrCode(item?.qr || '');
    if (code) set.add(code);
  });
  return set;
}

function normalizeItemQrCode(value) {
  return normalizeQrId(value || '');
}

function isValidItemQrCode(value) {
  return /^[A-Z0-9]{5}$/.test(value || '');
}

function buildItemQr(cardQrId, qrCode) {
  const base = normalizeQrId(cardQrId || '');
  const code = normalizeItemQrCode(qrCode);
  if (!base || !isValidItemQrCode(code)) return '';
  return `${base}-${code}`;
}

function extractItemQrCode(qrValue, cardQrId) {
  const raw = String(qrValue || '').trim().toUpperCase();
  const base = normalizeQrId(cardQrId || '');
  if (!raw || !base) return '';
  const prefix = `${base}-`;
  if (!raw.startsWith(prefix)) return '';
  const suffix = normalizeItemQrCode(raw.slice(prefix.length));
  return isValidItemQrCode(suffix) ? suffix : '';
}

function extractAnyItemQrCode(qrValue) {
  const raw = String(qrValue || '').trim().toUpperCase();
  const match = raw.match(/-([A-Z0-9]{5})$/);
  return match ? normalizeItemQrCode(match[1]) : '';
}

function generateItemQrCode(len = 5) {
  return generateCardQrId(len);
}

function generateUniqueItemQr(kind, cardQrId, used = new Set()) {
  const base = normalizeQrId(cardQrId || '') || 'CARD';
  let attempt = 0;
  while (attempt < 1000) {
    const code = generateItemQrCode();
    if (!used.has(code)) {
      used.add(code);
      return buildItemQr(base, code);
    }
    attempt += 1;
  }
  const fallback = generateItemQrCode();
  used.add(fallback);
  return buildItemQr(base, fallback);
}

function resolveCardOpId(op) {
  return (op && (op.id || op.opId)) || null;
}

function getFirstOperationForKind(card, kind, sampleType = '') {
  const ops = Array.isArray(card.operations) ? card.operations : [];
  const wantSamples = kind === 'SAMPLE';
  const sampleTypeNorm = normalizeSampleType(sampleType);
  const filtered = ops.filter(op => {
    if (!op) return false;
    if (Boolean(op.isSamples) !== wantSamples) return false;
    if (!wantSamples) return true;
    const opSampleType = normalizeSampleType(op.sampleType);
    return opSampleType === sampleTypeNorm;
  });
  if (!filtered.length) return { opId: null, opCode: null };
  const sorted = filtered
    .map((op, index) => ({
      op,
      index,
      order: Number.isFinite(op.order) ? op.order : index
    }))
    .sort((a, b) => (a.order - b.order) || (a.index - b.index));
  const first = sorted[0].op || null;
  return {
    opId: resolveCardOpId(first),
    opCode: first ? (first.opCode || null) : null
  };
}

function initFlowItemsForCard(card, kind, serials, usedQrs, sampleType = '') {
  const opInfo = getFirstOperationForKind(card, kind, sampleType);
  const now = Date.now();
  return serials.map((_, index) => {
    const qr = generateUniqueItemQr(kind, card.qrId || '', usedQrs);
    return {
      id: genId('it'),
      kind,
      displayName: buildFlowDisplayName(serials, kind, index),
      sampleType: kind === 'SAMPLE' ? normalizeSampleType(sampleType) : '',
      qrCode: extractItemQrCode(qr, card.qrId || '') || extractAnyItemQrCode(qr),
      qr,
      createdInCardQr: card.qrId || '',
      current: {
        opId: opInfo.opId,
        opCode: opInfo.opCode,
        status: 'PENDING',
        updatedAt: now
      },
      history: []
    };
  });
}

function ensureCardFlow(card) {
  if (!card) return;
  if (!card.flow || typeof card.flow !== 'object') {
    card.flow = { items: [], samples: [], events: [], version: 1 };
  }
  if (!Array.isArray(card.flow.items)) card.flow.items = [];
  if (!Array.isArray(card.flow.samples)) card.flow.samples = [];
  if (!Array.isArray(card.flow.events)) card.flow.events = [];
  if (!Number.isFinite(card.flow.version)) card.flow.version = 1;

  const itemSerials = normalizeFlowSerialList(card.itemSerials, toSafeCount(card.quantity));
  const sampleSerials = normalizeFlowSerialList(card.sampleSerials, toSafeCount(card.sampleCount));
  const witnessSerials = normalizeFlowSerialList(card.witnessSampleSerials, toSafeCount(card.witnessSampleCount));
  const usedQrs = collectFlowQrSet(card);

  if (card.flow.items.length === 0 && itemSerials.length) {
    card.flow.items = initFlowItemsForCard(card, 'ITEM', itemSerials, usedQrs);
  }

  if (card.flow.samples.length === 0 && (sampleSerials.length || witnessSerials.length)) {
    const controlItems = sampleSerials.length
      ? initFlowItemsForCard(card, 'SAMPLE', sampleSerials, usedQrs, 'CONTROL')
      : [];
    const witnessItems = witnessSerials.length
      ? initFlowItemsForCard(card, 'SAMPLE', witnessSerials, usedQrs, 'WITNESS')
      : [];
    card.flow.samples = controlItems.concat(witnessItems);
  } else if (card.flow.samples.length) {
    card.flow.samples.forEach(item => {
      if (item && item.kind === 'SAMPLE' && !item.sampleType) {
        item.sampleType = 'CONTROL';
      }
    });
    const hasWitness = card.flow.samples.some(item => item && item.kind === 'SAMPLE' && normalizeSampleType(item.sampleType) === 'WITNESS');
    const hasControl = card.flow.samples.some(item => item && item.kind === 'SAMPLE' && normalizeSampleType(item.sampleType) === 'CONTROL');
    if (!hasControl && sampleSerials.length) {
      card.flow.samples = card.flow.samples.concat(
        initFlowItemsForCard(card, 'SAMPLE', sampleSerials, usedQrs, 'CONTROL')
      );
    }
    if (!hasWitness && witnessSerials.length) {
      card.flow.samples = card.flow.samples.concat(
        initFlowItemsForCard(card, 'SAMPLE', witnessSerials, usedQrs, 'WITNESS')
      );
    }
  }
  const syncFlowQr = (item) => {
    if (!item) return;
    const qrCode = normalizeItemQrCode(item.qrCode || '')
      || extractItemQrCode(item.qr || '', card.qrId || '')
      || extractAnyItemQrCode(item.qr || '');
    if (!isValidItemQrCode(qrCode)) {
      const nextQr = generateUniqueItemQr(item.kind || 'ITEM', card.qrId || '', usedQrs);
      item.qrCode = extractItemQrCode(nextQr, card.qrId || '') || extractAnyItemQrCode(nextQr);
      item.qr = nextQr;
      item.createdInCardQr = card.qrId || '';
      return;
    }
    item.qrCode = qrCode;
    item.qr = buildItemQr(card.qrId || '', qrCode);
    item.createdInCardQr = card.qrId || '';
  };
  (card.flow.items || []).forEach(syncFlowQr);
  (card.flow.samples || []).forEach(syncFlowQr);
}

function ensureCardMeta(card, options = {}) {
  if (!card) return;
  const { skipSnapshot = false } = options;
  card.cardType = card.cardType === 'MKI' ? 'MKI' : (card.cardType || 'MKI');
  const isMki = card.cardType === 'MKI';
  card.routeCardNumber = typeof card.routeCardNumber === 'string'
    ? card.routeCardNumber
    : (card.orderNo ? String(card.orderNo) : '');
  card.orderNo = card.routeCardNumber;
  card.documentDesignation = typeof card.documentDesignation === 'string' ? card.documentDesignation : '';
  card.documentDate = formatDateInputValue(card.documentDate) || '';
  card.plannedCompletionDate = formatDateInputValue(card.plannedCompletionDate) || '';
  card.issuedBySurname = typeof card.issuedBySurname === 'string' ? card.issuedBySurname : '';
  card.programName = typeof card.programName === 'string' ? card.programName : '';
  card.labRequestNumber = typeof card.labRequestNumber === 'string' ? card.labRequestNumber : '';
  card.workBasis = typeof card.workBasis === 'string'
    ? card.workBasis
    : (card.contractNumber ? String(card.contractNumber) : '');
  card.contractNumber = card.workBasis;
  card.supplyState = typeof card.supplyState === 'string' ? card.supplyState : '';
  card.itemDesignation = typeof card.itemDesignation === 'string'
    ? card.itemDesignation
    : (card.drawing ? String(card.drawing) : '');
  card.drawing = card.itemDesignation;
  card.supplyStandard = typeof card.supplyStandard === 'string' ? card.supplyStandard : '';
  card.itemName = typeof card.itemName === 'string' ? card.itemName : (card.name || '');
  card.name = card.itemName || 'Маршрутная карта';
  card.mainMaterials = typeof card.mainMaterials === 'string' ? card.mainMaterials : '';
  card.materialIssues = Array.isArray(card.materialIssues) ? card.materialIssues : [];
  card.mainMaterialGrade = typeof card.mainMaterialGrade === 'string'
    ? card.mainMaterialGrade
    : (card.material ? String(card.material) : '');
  card.material = card.mainMaterialGrade;
  card.batchSize = card.batchSize == null ? card.quantity : card.batchSize;
  const qtyVal = card.batchSize === '' ? '' : toSafeCount(card.batchSize);
  card.quantity = qtyVal;
  card.batchSize = card.quantity;
  if (isMki) {
    const currentYear = new Date().getFullYear();
    const normalizedItems = normalizeSerialInput(card.itemSerials);
    const itemCount = card.quantity === '' ? 0 : toSafeCount(card.quantity);
    card.itemSerials = resizeSerialList(normalizedItems, itemCount, { fillDefaults: true });

    const normalizedSamples = normalizeSerialInput(card.sampleSerials);
    card.sampleCount = card.sampleCount === '' || card.sampleCount == null ? '' : toSafeCount(card.sampleCount);
    const sampleCount = card.sampleCount === '' ? 0 : toSafeCount(card.sampleCount);
    card.sampleSerials = normalizeAutoSampleSerials(
      normalizedSamples,
      sampleCount,
      'К',
      card.routeCardNumber,
      currentYear,
      card.__serialRouteBase || ''
    );

    const normalizedWitnessSamples = normalizeSerialInput(card.witnessSampleSerials);
    card.witnessSampleCount = card.witnessSampleCount === '' || card.witnessSampleCount == null ? '' : toSafeCount(card.witnessSampleCount);
    const witnessCount = card.witnessSampleCount === '' ? 0 : toSafeCount(card.witnessSampleCount);
    card.witnessSampleSerials = normalizeAutoSampleSerials(
      normalizedWitnessSamples,
      witnessCount,
      'С',
      card.routeCardNumber,
      currentYear,
      card.__serialRouteBase || ''
    );
  } else {
    card.itemSerials = typeof card.itemSerials === 'string' ? card.itemSerials : '';
    card.sampleCount = '';
    card.sampleSerials = [];
    card.witnessSampleCount = '';
    card.witnessSampleSerials = [];
  }
  if (Array.isArray(card.operations)) {
    card.operations.forEach(op => {
      if (!op) return;
      if (op.isSamples) {
        op.sampleType = normalizeSampleType(op.sampleType);
      } else if (op.sampleType) {
        op.sampleType = '';
      }
    });
  }
  card.specialNotes = typeof card.specialNotes === 'string'
    ? card.specialNotes
    : (card.desc ? String(card.desc) : '');
  card.desc = card.specialNotes;
  card.responsibleProductionChief = typeof card.responsibleProductionChief === 'string'
    ? card.responsibleProductionChief
    : '';
  card.responsibleSKKChief = typeof card.responsibleSKKChief === 'string' ? card.responsibleSKKChief : '';
  card.responsibleTechLead = typeof card.responsibleTechLead === 'string' ? card.responsibleTechLead : '';
  card.responsibleProductionChiefAt = typeof card.responsibleProductionChiefAt === 'number' ? card.responsibleProductionChiefAt : null;
  card.responsibleSKKChiefAt = typeof card.responsibleSKKChiefAt === 'number' ? card.responsibleSKKChiefAt : null;
  card.responsibleTechLeadAt = typeof card.responsibleTechLeadAt === 'number' ? card.responsibleTechLeadAt : null;
  if (card.approvalSkkStatus != null && card.approvalSKKStatus == null) {
    card.approvalSKKStatus = card.approvalSkkStatus;
    delete card.approvalSkkStatus;
  }

  if (card.status === APPROVAL_STATUS_APPROVED) {
    card.approvalStage = APPROVAL_STAGE_APPROVED;
  } else if (card.status === APPROVAL_STATUS_REJECTED) {
    const hasReason = typeof card.rejectionReason === 'string' && card.rejectionReason.trim();
    card.approvalStage = hasReason ? APPROVAL_STAGE_REJECTED : APPROVAL_STAGE_DRAFT;
  }

  card.approvalStage = card.approvalStage || APPROVAL_STAGE_DRAFT;
  card.approvalProductionStatus = normalizeApprovalStatus(card.approvalProductionStatus);
  card.approvalSKKStatus = normalizeApprovalStatus(card.approvalSKKStatus);
  card.approvalTechStatus = normalizeApprovalStatus(card.approvalTechStatus);
  card.inputControlComment = typeof card.inputControlComment === 'string' ? card.inputControlComment : '';
  card.inputControlFileId = typeof card.inputControlFileId === 'string' ? card.inputControlFileId : '';
  card.inputControlDoneAt = typeof card.inputControlDoneAt === 'number' ? card.inputControlDoneAt : null;
  card.inputControlDoneBy = typeof card.inputControlDoneBy === 'string' ? card.inputControlDoneBy : '';
  card.provisionDoneAt = typeof card.provisionDoneAt === 'number' ? card.provisionDoneAt : null;
  card.provisionDoneBy = typeof card.provisionDoneBy === 'string' ? card.provisionDoneBy : '';
  if (card.approvalStage === APPROVAL_STAGE_APPROVED) {
    const hasIC = !!card.inputControlDoneAt;
    const hasPR = !!card.provisionDoneAt;

    if (hasIC && hasPR) {
      card.approvalStage = APPROVAL_STAGE_PROVIDED;
    } else if (hasIC && !hasPR) {
      card.approvalStage = APPROVAL_STAGE_WAITING_PROVISION;
    } else if (!hasIC && hasPR) {
      card.approvalStage = APPROVAL_STAGE_WAITING_INPUT_CONTROL;
    }
  }
  if ('approvalProductionDecided' in card) delete card.approvalProductionDecided;
  if ('approvalSkkDecided' in card) delete card.approvalSkkDecided;
  if ('approvalTechDecided' in card) delete card.approvalTechDecided;
  card.rejectionReason = typeof card.rejectionReason === 'string' ? card.rejectionReason : '';
  card.approvalThread = Array.isArray(card.approvalThread) ? card.approvalThread : [];
  card.rejectionReadByUserName = typeof card.rejectionReadByUserName === 'string' ? card.rejectionReadByUserName : '';
  card.rejectionReadAt = typeof card.rejectionReadAt === 'number' ? card.rejectionReadAt : null;
  syncApprovalStatus(card);
  if (typeof card.createdAt !== 'number') {
    card.createdAt = Date.now();
  }
  card.documentDate = getCardCreatedDateValue(card) || getCurrentDateString();
  if (!Array.isArray(card.logs)) {
    card.logs = [];
  }
  const usedQrIds = collectQrIdSet(card.id);
  let qrIdValue = normalizeQrId(card.qrId || '');
  if (!isValidScanId(qrIdValue) || usedQrIds.has(qrIdValue)) {
    qrIdValue = generateUniqueCardQrId(usedQrIds);
  }
  card.qrId = qrIdValue;
  usedQrIds.add(qrIdValue);
  const usedBarcodes = collectBarcodeSet(card.id);
  const barcodeValue = (card.barcode || '').trim();
  if (!barcodeValue || looksLikeLegacyBarcode(barcodeValue) || usedBarcodes.has(barcodeValue)) {
    card.barcode = generateUniqueCardCode128(usedBarcodes);
  } else {
    card.barcode = barcodeValue;
  }
  if (!card.initialSnapshot && !skipSnapshot) {
    const snapshot = cloneCard(card);
    snapshot.logs = [];
    card.initialSnapshot = snapshot;
  }
  card.operations = card.operations || [];
  card.operations.forEach(op => {
    op.isSamples = isMki ? Boolean(op && op.isSamples) : false;
    op.goodCount = toSafeCount(op.goodCount || 0);
    op.scrapCount = toSafeCount(op.scrapCount || 0);
    op.holdCount = toSafeCount(op.holdCount || 0);
    op.quantity = getOperationQuantity(op, card);
    op.autoCode = Boolean(op.autoCode);
    op.additionalExecutors = Array.isArray(op.additionalExecutors)
      ? op.additionalExecutors.map(name => (name || '').toString()).slice(0, 2)
      : [];
  });
  renumberAutoCodesForCard(card);
  ensureCardFlow(card);
  recalcCardStatus(card);
}

function formatCardTitle(card) {
  if (!card) return '';

  const name = (card?.name || '').toString().trim();
  const route = (card?.routeCardNumber || '').toString().trim();

  if (card?.cardType === 'MKI') {
    if (route && name) return route + ' · ' + name;
    if (route) return route;
    if (name) return name;
    return '';
  }

  return card?.name ? String(card.name) : 'Маршрутная карта';
}

function formatItemSerialsValue(card) {
  if (!card) return '';
  const raw = resolveCardField(card, 'itemSerials');
  if (Array.isArray(raw)) {
    return raw.map(v => (v == null ? '' : String(v))).join(', ');
  }
  return typeof raw === 'string' ? raw : '';
}

function getCardItemName(card) {
  if (!card) return '';
  return (card.itemName || card.name || '').toString().trim();
}

// Deprecated alias kept for backwards compatibility
function getCardDisplayTitle(card) {
  return formatCardTitle(card);
}

function validateMkiRouteCardNumber(draft, allCards) {
  if (!draft || draft.cardType !== 'MKI') return null;

  const number = String(draft.routeCardNumber || '').trim();
  if (!number) return null;

  const conflict = (allCards || []).some(c =>
    c && c.cardType !== 'MKI' && String(c.routeCardNumber || '').trim() === number && c.id !== draft.id
  );

  if (conflict) {
    return 'Нельзя создать МК с номером маршрутной карты, совпадающим с существующей.';
  }

  return null;
}

function validateMkiDraftConstraints(draft) {
  if (!draft || draft.cardType !== 'MKI') return null;
  const qty = draft.quantity === '' ? 0 : toSafeCount(draft.quantity);
  if (qty === 0) {
    return 'Размер партии не может быть равен 0';
  }

  const normalizedItems = resizeSerialList(normalizeSerialInput(draft.itemSerials), qty, { fillDefaults: false });
  if (hasEmptySerial(normalizedItems)) {
    return 'Заполните все значения в таблице "Индивидуальные номера изделий".';
  }
  const seen = new Set();
  const duplicateItem = normalizedItems.find(value => {
    const trimmed = (value || '').toString().trim();
    if (!trimmed) return false;
    if (seen.has(trimmed)) return true;
    seen.add(trimmed);
    return false;
  });
  if (duplicateItem) {
    return 'Индивидуальные номера изделий не могут совпадать.';
  }

  const sampleCount = draft.sampleCount === '' ? 0 : toSafeCount(draft.sampleCount);
  const normalizedSamples = resizeSerialList(normalizeSerialInput(draft.sampleSerials), sampleCount, { fillDefaults: false });
  if (hasEmptySerial(normalizedSamples)) {
    return 'Заполните все значения в таблице "Индивидуальные номера контрольных образцов".';
  }
  const seenSamples = new Set();
  const duplicateSample = normalizedSamples.find(value => {
    const trimmed = (value || '').toString().trim();
    if (!trimmed) return false;
    if (seenSamples.has(trimmed)) return true;
    seenSamples.add(trimmed);
    return false;
  });
  if (duplicateSample) {
    return 'Индивидуальные номера контрольных образцов не могут совпадать.';
  }

  const witnessCount = draft.witnessSampleCount === '' ? 0 : toSafeCount(draft.witnessSampleCount);
  const normalizedWitness = resizeSerialList(normalizeSerialInput(draft.witnessSampleSerials), witnessCount, { fillDefaults: false });
  if (hasEmptySerial(normalizedWitness)) {
    return 'Заполните все значения в таблице "Индивидуальные номера образцов свидетелей".';
  }
  const seenWitness = new Set();
  const duplicateWitness = normalizedWitness.find(value => {
    const trimmed = (value || '').toString().trim();
    if (!trimmed) return false;
    if (seenWitness.has(trimmed)) return true;
    seenWitness.add(trimmed);
    return false;
  });
  if (duplicateWitness) {
    return 'Индивидуальные номера образцов свидетелей не могут совпадать.';
  }

  return null;
}

function formatLogValue(val) {
  if (val === undefined || val === null) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  try {
    return JSON.stringify(val);
  } catch (err) {
    return String(val);
  }

  const cleanFlowItemName = (item) => {
    if (!item || typeof item !== 'object') return;
    const name = sanitizeEncodingArtifacts(item.displayName || '');
    if (name) item.displayName = name;
  };
  card.flow.items.forEach(cleanFlowItemName);
  card.flow.samples.forEach(cleanFlowItemName);
}

function recordCardLog(card, { action, object, field = null, targetId = null, oldValue = '', newValue = '' }) {
  if (!card) return;
  ensureCardMeta(card);
  card.logs.push({
    id: genId('log'),
    ts: Date.now(),
    action: action || 'update',
    object: object || '',
    userName: currentUser?.name || currentUser?.login || currentUser?.username || 'Пользователь',
    field,
    targetId,
    oldValue: formatLogValue(oldValue),
    newValue: formatLogValue(newValue)
  });
}

function formatApprovalActionLabel(actionType) {
  if (actionType === 'SEND_TO_APPROVAL') return 'Отправлено на согласование';
  if (actionType === 'APPROVE') return 'Согласовано';
  if (actionType === 'REJECT') return 'Отклонено';
  if (actionType === 'UNFREEZE') return 'Разморожено';
  return 'Действие';
}

function formatApprovalRoleLabel(roleContext) {
  if (roleContext === 'PRODUCTION') return 'Начальник производства';
  if (roleContext === 'SKK') return 'Начальник СКК';
  if (roleContext === 'TECH') return 'ЗГД по технологиям';
  return '';
}

function approvalThreadToHtml(thread = [], options = {}) {
  const { newestFirst = false } = options || {};
  const entries = Array.isArray(thread) ? thread.slice() : [];
  entries.sort((a, b) => (a?.ts || 0) - (b?.ts || 0));
  if (newestFirst) {
    entries.reverse();
  }
  if (!entries.length) return '<p class="muted">История пуста</p>';
  return entries.map(entry => {
    const date = entry?.ts ? new Date(entry.ts).toLocaleString('ru-RU') : '';
    const user = escapeHtml(entry?.userName || '');
    const action = escapeHtml(formatApprovalActionLabel(entry?.actionType));
    const role = escapeHtml(formatApprovalRoleLabel(entry?.roleContext || ''));
    const comment = escapeHtml(entry?.comment || '');
    const headerParts = [action, role].filter(Boolean).join(' · ');
    return '<div class="approval-thread-entry">'
      + '<div class="approval-thread-header">' + (headerParts || 'Действие') + '</div>'
      + '<div class="approval-thread-meta">' + (user || 'Неизвестно') + (date ? ' · ' + date : '') + '</div>'
      + (comment ? '<div class="approval-thread-comment">' + comment + '</div>' : '')
      + '</div>';
  }).join('');
}

function opLogLabel(op) {
  return formatOpLabel(op) || 'Операция';
}

function dataUrlToBlob(dataUrl, fallbackType = 'application/octet-stream') {
  const parts = (dataUrl || '').split(',');
  if (parts.length < 2) return new Blob([], { type: fallbackType });
  const match = parts[0].match(/data:(.*);base64/);
  const mime = match ? match[1] : fallbackType;
  const binary = atob(parts[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

function formatBytes(size) {
  if (!size) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let idx = 0;
  let s = size;
  while (s >= 1024 && idx < units.length - 1) {
    s /= 1024;
    idx++;
  }
  return s.toFixed(Math.min(1, idx)).replace(/\.0$/, '') + ' ' + units[idx];
}

async function fetchBarcodeSvg(value, options = {}) {
  const { raw = false } = options;
  const normalized = raw
    ? (value || '').trim()
    : (typeof normalizeScanIdInput === 'function'
      ? normalizeScanIdInput(value)
      : (value || '').trim());
  if (!normalized) return '';
  const params = new URLSearchParams({ value: normalized });
  if (raw) params.set('raw', '1');
  const res = await apiFetch('/api/barcode/svg?' + params.toString(), { method: 'GET' });
  if (!res.ok) throw new Error('Не удалось получить QR-код');
  return res.text();
}

async function renderBarcodeInto(container, value, options = {}) {
  const { raw = false } = options;
  if (!container) return;
  container.innerHTML = '';
  container.dataset.barcodeValue = '';
  const normalized = raw
    ? (value || '').trim()
    : (typeof normalizeScanIdInput === 'function'
      ? normalizeScanIdInput(value)
      : (value || '').trim());
  if (!normalized) return;
  container.dataset.barcodeValue = normalized;
  try {
    const svg = await fetchBarcodeSvg(normalized, { raw });
    if (container.dataset.barcodeValue === normalized) {
      container.innerHTML = svg;
    }
  } catch (err) {
    if (container.dataset.barcodeValue === normalized) {
      container.innerHTML = '<div class="barcode-error">Не удалось загрузить QR-код</div>';
    }
  }
}

function openPasswordBarcode(password, username, userId, options = {}) {
  const { fromRestore = false } = options;
  const modal = document.getElementById('barcode-modal');
  const barcodeContainer = document.getElementById('barcode-svg');
  const codeSpan = document.getElementById('barcode-modal-code');
  const title = document.getElementById('barcode-modal-title');
  const userLabel = document.getElementById('barcode-modal-user');
  const extraLabel = document.getElementById('barcode-modal-extra');
  const settingsBtn = document.getElementById('btn-barcode-print-settings');
  if (!modal || !barcodeContainer || !codeSpan) return;
  if (title) title.textContent = 'QR-код пароля';
  renderBarcodeInto(barcodeContainer, password, { raw: true });
  codeSpan.textContent = password;
  if (userLabel) {
    const normalized = (username || '').trim();
    userLabel.textContent = normalized ? `Пользователь: ${normalized}` : '';
    userLabel.classList.toggle('hidden', !normalized);
  }
  if (extraLabel) {
    extraLabel.textContent = '';
    extraLabel.classList.add('hidden');
  }
  if (settingsBtn) settingsBtn.classList.remove('hidden');
  modal.dataset.username = username || '';
  modal.dataset.passwordValue = password || '';
  modal.dataset.mode = 'password';
  modal.dataset.userId = userId || '';
  modal.dataset.cardId = '';
  modal.style.display = 'flex';
  ensurePasswordQrPrintSettingsLoaded().catch(() => {});
  setModalState({ type: 'barcode', mode: 'password', userId }, { fromRestore });
}

function openBarcodeModal(card, options = {}) {
  const { fromRestore = false } = options;
  const modal = document.getElementById('barcode-modal');
  const barcodeContainer = document.getElementById('barcode-svg');
  const codeSpan = document.getElementById('barcode-modal-code');
  const title = document.getElementById('barcode-modal-title');
  const userLabel = document.getElementById('barcode-modal-user');
  const extraLabel = document.getElementById('barcode-modal-extra');
  const settingsBtn = document.getElementById('btn-barcode-print-settings');
  if (!modal || !barcodeContainer || !codeSpan) return;

  if (title) {
    title.textContent = 'QR-код маршрутной карты';
  }

  if (userLabel) {
    userLabel.textContent = '';
    userLabel.classList.add('hidden');
  }
  modal.dataset.username = '';
  modal.dataset.passwordValue = '';
  modal.dataset.mode = 'card';
  modal.dataset.cardId = card && card.id ? card.id : '';
  modal.dataset.userId = '';
  if (settingsBtn) settingsBtn.classList.remove('hidden');

  let value = getCardBarcodeValue(card);
  if (!value) {
    card.qrId = generateUniqueCardQrId();
    ensureUniqueQrIds(cards);
    ensureUniqueBarcodes(cards);
    value = card.qrId;
    saveData();
    renderEverything();
  }
  renderBarcodeInto(barcodeContainer, value);
  codeSpan.textContent = value || '(нет номера МК)';
  if (extraLabel) {
    const routeNumber = trimToString(card?.routeCardNumber || '');
    const itemName = trimToString(getCardItemName(card) || '');
    const extraText = [
      routeNumber ? `Номер МК: ${routeNumber}` : '',
      itemName ? `Наименование изделия: ${itemName}` : ''
    ].filter(Boolean).join(' · ');
    extraLabel.textContent = extraText;
    extraLabel.classList.toggle('hidden', !extraText);
  }
  modal.dataset.cardQrValue = value || '';
  modal.dataset.cardRouteNumber = trimToString(card?.routeCardNumber || '');
  modal.dataset.cardItemName = trimToString(getCardItemName(card) || '');
  modal.style.display = 'flex';
  ensureCardQrPrintSettingsLoaded().catch(() => {});
  setModalState({
    type: 'barcode',
    cardId: card && card.id ? card.id : '',
    mode: 'card'
  }, { fromRestore });
}

function ensureCardQrIdValue(card) {
  let cardQr = getCardBarcodeValue(card);
  if (!cardQr) {
    card.qrId = generateUniqueCardQrId();
    ensureUniqueQrIds(cards);
    ensureUniqueBarcodes(cards);
    cardQr = card.qrId;
  }
  return cardQr || '';
}

function ensureCardPartQrMap(card) {
  if (!card) return {};
  if (!card.partQrs || typeof card.partQrs !== 'object' || Array.isArray(card.partQrs)) {
    card.partQrs = {};
  }
  return card.partQrs;
}

function findFlowItemByDisplayName(card, serial) {
  if (!card) return null;
  ensureCardFlow(card);
  const target = String(serial || '').trim();
  if (!target) return null;
  const all = []
    .concat(Array.isArray(card.flow?.items) ? card.flow.items : [])
    .concat(Array.isArray(card.flow?.samples) ? card.flow.samples : []);
  return all.find(item => String(item?.displayName || '').trim() === target) || null;
}

function getOrCreatePartQrValue(card, serial) {
  if (!card) return { value: '', serial: '', cardQr: '', created: false };
  const serialText = (serial || '').trim();
  if (!serialText) {
    return {
      value: '',
      serial: serialText,
      routeNumber: trimToString(card?.routeCardNumber || ''),
      itemName: getCardItemName(card) || '',
      cardQr: getCardBarcodeValue(card) || '',
      created: false
    };
  }

  const flowItem = findFlowItemByDisplayName(card, serialText);
  if (flowItem) {
    const cardQr = getCardBarcodeValue(card) || '';
    const value = String(flowItem.qr || '').trim();
    if (value) {
      return {
        value,
        serial: serialText,
        routeNumber: trimToString(card?.routeCardNumber || ''),
        itemName: getCardItemName(card) || '',
        cardQr,
        created: false
      };
    }
  }

  const map = ensureCardPartQrMap(card);
  let cardQr = getCardBarcodeValue(card);
  let created = false;
  if (!cardQr) {
    cardQr = ensureCardQrIdValue(card);
    created = true;
  }

  let value = map[serialText];
  if (!value) {
    value = `${cardQr}-${serialText}`;
    map[serialText] = value;
    created = true;
  }

  return {
    value,
    serial: serialText,
    routeNumber: trimToString(card?.routeCardNumber || ''),
    itemName: getCardItemName(card) || '',
    cardQr,
    created
  };
}

function buildPartQrPrintItems(card, serials = []) {
  const items = [];
  let created = false;
  if (!card) return { items, created };

  const normalized = (serials || [])
    .map(val => (val == null ? '' : String(val)).trim())
    .filter(Boolean);
  if (!normalized.length) return { items, created };

  ensureCardFlow(card);
  const map = ensureCardPartQrMap(card);
  let cardQr = getCardBarcodeValue(card);
  if (!cardQr) {
    cardQr = ensureCardQrIdValue(card);
    created = true;
  }

  const flowItems = Array.isArray(card.flow?.items) ? card.flow.items : [];
  normalized.forEach((serial, index) => {
    const flowItem = findFlowItemByDisplayName(card, serial) || flowItems[index] || null;
    let value = flowItem ? String(flowItem.qr || '').trim() : '';
    if (!value) value = map[serial];
    if (!value) {
      value = `${cardQr}-${serial}`;
      map[serial] = value;
      created = true;
    }
    items.push({
      value,
      routeNumber: trimToString(card?.routeCardNumber || ''),
      itemName: getCardItemName(card) || '',
      serial,
      extra: [trimToString(card?.routeCardNumber || '') ? `МК: ${trimToString(card?.routeCardNumber || '')}` : '', serial ? `№ детали: ${serial}` : ''].filter(Boolean).join(' · ')
    });
  });

  return { items, created };
}

function normalizePartSerialsInput(input) {
  if (Array.isArray(input)) {
    return input.map(val => (val == null ? '' : String(val)).trim()).filter(Boolean);
  }
  if (input == null) return [];
  const raw = String(input);
  if (typeof normalizeSerialInput === 'function') {
    return normalizeSerialInput(raw).map(val => (val == null ? '' : String(val)).trim()).filter(Boolean);
  }
  return raw.split(/\r?\n|,/).map(val => val.trim()).filter(Boolean);
}

function updateCardPartQrMap(card, serialsInput) {
  if (!card) return false;
  const serials = normalizePartSerialsInput(serialsInput);
  const map = ensureCardPartQrMap(card);
  let changed = false;
  ensureCardFlow(card);

  if (!serials.length) {
    if (Object.keys(map).length) {
      card.partQrs = {};
      return true;
    }
    return false;
  }

  let cardQr = getCardBarcodeValue(card);
  if (!cardQr) {
    cardQr = ensureCardQrIdValue(card);
    changed = true;
  }

  const nextMap = {};
  const flowItems = Array.isArray(card.flow?.items) ? card.flow.items : [];
  serials.forEach((serial, index) => {
    const flowItem = findFlowItemByDisplayName(card, serial) || flowItems[index] || null;
    const value = trimToString(flowItem?.qr || '') || `${cardQr}-${serial}`;
    nextMap[serial] = value;
    if (map[serial] !== value) changed = true;
  });

  const oldKeys = Object.keys(map);
  const newKeys = Object.keys(nextMap);
  if (oldKeys.length !== newKeys.length) {
    changed = true;
  } else if (!changed) {
    for (const key of oldKeys) {
      if (!(key in nextMap)) {
        changed = true;
        break;
      }
    }
  }

  card.partQrs = nextMap;
  return changed;
}

const PASSWORD_QR_PRINT_SETTINGS_DEFAULTS = {
  paperMode: 'A4',
  customWidthMm: 58,
  customHeightMm: 40,
  placement: 'CENTER',
  rotate90: false,
  showUsername: true,
  showPassword: true,
  qrSizeMm: 25,
  fontSizePt: 9
};

const ITEM_QR_PRINT_SETTINGS_DEFAULTS = {
  paperMode: 'A4',
  customWidthMm: 58,
  customHeightMm: 40,
  placement: 'CENTER',
  rotate90: false,
  showRouteCardNumber: true,
  showItemName: true,
  showItemSerial: true,
  qrSizeMm: 25,
  fontSizePt: 9
};

const CARD_QR_PRINT_SETTINGS_DEFAULTS = {
  paperMode: 'A4',
  customWidthMm: 58,
  customHeightMm: 40,
  placement: 'CENTER',
  rotate90: false,
  showRouteNumber: true,
  showItemName: true,
  qrSizeMm: 25,
  fontSizePt: 9
};

let passwordQrPrintSettingsCache = null;
let passwordQrPrintSettingsOwnerId = '';
let itemQrPrintSettingsCache = null;
let itemQrPrintSettingsOwnerId = '';
let cardQrPrintSettingsCache = null;
let cardQrPrintSettingsOwnerId = '';

function normalizePasswordQrPrintSettingsClient(value) {
  const source = value && typeof value === 'object' ? value : {};
  const parseMm = (input, fallback, min) => {
    const parsed = Number(input);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, parsed);
  };
  const parsePt = (input, fallback, min) => {
    const parsed = Number(input);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, parsed);
  };
  return {
    paperMode: String(source.paperMode || PASSWORD_QR_PRINT_SETTINGS_DEFAULTS.paperMode).toUpperCase() === 'CUSTOM' ? 'CUSTOM' : 'A4',
    customWidthMm: parseMm(source.customWidthMm, PASSWORD_QR_PRINT_SETTINGS_DEFAULTS.customWidthMm, 10),
    customHeightMm: parseMm(source.customHeightMm, PASSWORD_QR_PRINT_SETTINGS_DEFAULTS.customHeightMm, 10),
    placement: String(source.placement || PASSWORD_QR_PRINT_SETTINGS_DEFAULTS.placement).toUpperCase() === 'TOP_LEFT' ? 'TOP_LEFT' : 'CENTER',
    rotate90: Boolean(source.rotate90),
    showUsername: source.showUsername !== false,
    showPassword: source.showPassword !== false,
    qrSizeMm: parseMm(source.qrSizeMm, PASSWORD_QR_PRINT_SETTINGS_DEFAULTS.qrSizeMm, 5),
    fontSizePt: parsePt(source.fontSizePt, PASSWORD_QR_PRINT_SETTINGS_DEFAULTS.fontSizePt, 4)
  };
}

function normalizeItemQrPrintSettingsClient(value) {
  const source = value && typeof value === 'object' ? value : {};
  const parseMm = (input, fallback, min) => {
    const parsed = Number(input);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, parsed);
  };
  const parsePt = (input, fallback, min) => {
    const parsed = Number(input);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, parsed);
  };
  return {
    paperMode: String(source.paperMode || ITEM_QR_PRINT_SETTINGS_DEFAULTS.paperMode).toUpperCase() === 'CUSTOM' ? 'CUSTOM' : 'A4',
    customWidthMm: parseMm(source.customWidthMm, ITEM_QR_PRINT_SETTINGS_DEFAULTS.customWidthMm, 10),
    customHeightMm: parseMm(source.customHeightMm, ITEM_QR_PRINT_SETTINGS_DEFAULTS.customHeightMm, 10),
    placement: String(source.placement || ITEM_QR_PRINT_SETTINGS_DEFAULTS.placement).toUpperCase() === 'TOP_LEFT' ? 'TOP_LEFT' : 'CENTER',
    rotate90: Boolean(source.rotate90),
    showRouteCardNumber: source.showRouteCardNumber !== false,
    showItemName: source.showItemName !== false,
    showItemSerial: source.showItemSerial !== false,
    qrSizeMm: parseMm(source.qrSizeMm, ITEM_QR_PRINT_SETTINGS_DEFAULTS.qrSizeMm, 5),
    fontSizePt: parsePt(source.fontSizePt, ITEM_QR_PRINT_SETTINGS_DEFAULTS.fontSizePt, 4)
  };
}

function normalizeCardQrPrintSettingsClient(value) {
  const source = value && typeof value === 'object' ? value : {};
  const parseMm = (input, fallback, min) => {
    const parsed = Number(input);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, parsed);
  };
  const parsePt = (input, fallback, min) => {
    const parsed = Number(input);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, parsed);
  };
  return {
    paperMode: String(source.paperMode || CARD_QR_PRINT_SETTINGS_DEFAULTS.paperMode).toUpperCase() === 'CUSTOM' ? 'CUSTOM' : 'A4',
    customWidthMm: parseMm(source.customWidthMm, CARD_QR_PRINT_SETTINGS_DEFAULTS.customWidthMm, 10),
    customHeightMm: parseMm(source.customHeightMm, CARD_QR_PRINT_SETTINGS_DEFAULTS.customHeightMm, 10),
    placement: String(source.placement || CARD_QR_PRINT_SETTINGS_DEFAULTS.placement).toUpperCase() === 'TOP_LEFT' ? 'TOP_LEFT' : 'CENTER',
    rotate90: Boolean(source.rotate90),
    showRouteNumber: source.showRouteNumber !== false,
    showItemName: source.showItemName !== false,
    qrSizeMm: parseMm(source.qrSizeMm, CARD_QR_PRINT_SETTINGS_DEFAULTS.qrSizeMm, 5),
    fontSizePt: parsePt(source.fontSizePt, CARD_QR_PRINT_SETTINGS_DEFAULTS.fontSizePt, 4)
  };
}

function getPasswordQrPrintSettingsOwnerId() {
  return (currentUser && currentUser.id) ? currentUser.id : '';
}

async function ensurePasswordQrPrintSettingsLoaded({ force = false } = {}) {
  const ownerId = getPasswordQrPrintSettingsOwnerId();
  if (!force && passwordQrPrintSettingsCache && passwordQrPrintSettingsOwnerId === ownerId) {
    return normalizePasswordQrPrintSettingsClient(passwordQrPrintSettingsCache);
  }
  try {
    const res = await apiFetch('/api/security/print-settings/password-qr', { method: 'GET' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      throw new Error(data.error || 'Не удалось загрузить настройки печати');
    }
    passwordQrPrintSettingsCache = normalizePasswordQrPrintSettingsClient(data.settings);
    passwordQrPrintSettingsOwnerId = ownerId;
  } catch (err) {
    console.warn('Password QR print settings load failed', err);
    if (!passwordQrPrintSettingsCache || passwordQrPrintSettingsOwnerId !== ownerId) {
      passwordQrPrintSettingsCache = normalizePasswordQrPrintSettingsClient(PASSWORD_QR_PRINT_SETTINGS_DEFAULTS);
      passwordQrPrintSettingsOwnerId = ownerId;
    }
  }
  return normalizePasswordQrPrintSettingsClient(passwordQrPrintSettingsCache);
}

async function ensureItemQrPrintSettingsLoaded({ force = false } = {}) {
  const ownerId = getPasswordQrPrintSettingsOwnerId();
  if (!force && itemQrPrintSettingsCache && itemQrPrintSettingsOwnerId === ownerId) {
    return normalizeItemQrPrintSettingsClient(itemQrPrintSettingsCache);
  }
  try {
    const res = await apiFetch('/api/security/print-settings/item-qr', { method: 'GET' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      throw new Error(data.error || 'Не удалось загрузить настройки печати');
    }
    itemQrPrintSettingsCache = normalizeItemQrPrintSettingsClient(data.settings);
    itemQrPrintSettingsOwnerId = ownerId;
  } catch (err) {
    console.warn('Item QR print settings load failed', err);
    if (!itemQrPrintSettingsCache || itemQrPrintSettingsOwnerId !== ownerId) {
      itemQrPrintSettingsCache = normalizeItemQrPrintSettingsClient(ITEM_QR_PRINT_SETTINGS_DEFAULTS);
      itemQrPrintSettingsOwnerId = ownerId;
    }
  }
  return normalizeItemQrPrintSettingsClient(itemQrPrintSettingsCache);
}

async function ensureCardQrPrintSettingsLoaded({ force = false } = {}) {
  const ownerId = getPasswordQrPrintSettingsOwnerId();
  if (!force && cardQrPrintSettingsCache && cardQrPrintSettingsOwnerId === ownerId) {
    return normalizeCardQrPrintSettingsClient(cardQrPrintSettingsCache);
  }
  try {
    const res = await apiFetch('/api/security/print-settings/card-qr', { method: 'GET' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      throw new Error(data.error || 'Не удалось загрузить настройки печати');
    }
    cardQrPrintSettingsCache = normalizeCardQrPrintSettingsClient(data.settings);
    cardQrPrintSettingsOwnerId = ownerId;
  } catch (err) {
    console.warn('Card QR print settings load failed', err);
    if (!cardQrPrintSettingsCache || cardQrPrintSettingsOwnerId !== ownerId) {
      cardQrPrintSettingsCache = normalizeCardQrPrintSettingsClient(CARD_QR_PRINT_SETTINGS_DEFAULTS);
      cardQrPrintSettingsOwnerId = ownerId;
    }
  }
  return normalizeCardQrPrintSettingsClient(cardQrPrintSettingsCache);
}

function getCurrentPasswordQrPrintSettings() {
  return normalizePasswordQrPrintSettingsClient(passwordQrPrintSettingsCache || PASSWORD_QR_PRINT_SETTINGS_DEFAULTS);
}

function getCurrentItemQrPrintSettings() {
  return normalizeItemQrPrintSettingsClient(itemQrPrintSettingsCache || ITEM_QR_PRINT_SETTINGS_DEFAULTS);
}

function getCurrentCardQrPrintSettings() {
  return normalizeCardQrPrintSettingsClient(cardQrPrintSettingsCache || CARD_QR_PRINT_SETTINGS_DEFAULTS);
}

async function savePasswordQrPrintSettings(settings) {
  const normalized = normalizePasswordQrPrintSettingsClient(settings);
  const res = await apiFetch('/api/security/print-settings/password-qr', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings: normalized })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(data.error || 'Не удалось сохранить настройки печати');
  }
  passwordQrPrintSettingsCache = normalizePasswordQrPrintSettingsClient(data.settings);
  passwordQrPrintSettingsOwnerId = getPasswordQrPrintSettingsOwnerId();
  return getCurrentPasswordQrPrintSettings();
}

async function saveItemQrPrintSettings(settings) {
  const normalized = normalizeItemQrPrintSettingsClient(settings);
  const res = await apiFetch('/api/security/print-settings/item-qr', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings: normalized })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(data.error || 'Не удалось сохранить настройки печати');
  }
  itemQrPrintSettingsCache = normalizeItemQrPrintSettingsClient(data.settings);
  itemQrPrintSettingsOwnerId = getPasswordQrPrintSettingsOwnerId();
  return getCurrentItemQrPrintSettings();
}

async function saveCardQrPrintSettings(settings) {
  const normalized = normalizeCardQrPrintSettingsClient(settings);
  const res = await apiFetch('/api/security/print-settings/card-qr', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings: normalized })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(data.error || 'Не удалось сохранить настройки печати');
  }
  cardQrPrintSettingsCache = normalizeCardQrPrintSettingsClient(data.settings);
  cardQrPrintSettingsOwnerId = getPasswordQrPrintSettingsOwnerId();
  return getCurrentCardQrPrintSettings();
}

function getPasswordQrPrintPaperSizeMm(settings) {
  const normalized = normalizePasswordQrPrintSettingsClient(settings);
  if (normalized.paperMode === 'CUSTOM') {
    return {
      widthMm: normalized.customWidthMm,
      heightMm: normalized.customHeightMm
    };
  }
  return { widthMm: 210, heightMm: 297 };
}

function getItemQrPrintPaperSizeMm(settings) {
  const normalized = normalizeItemQrPrintSettingsClient(settings);
  if (normalized.paperMode === 'CUSTOM') {
    return {
      widthMm: normalized.customWidthMm,
      heightMm: normalized.customHeightMm
    };
  }
  return { widthMm: 210, heightMm: 297 };
}

function getCardQrPrintPaperSizeMm(settings) {
  const normalized = normalizeCardQrPrintSettingsClient(settings);
  if (normalized.paperMode === 'CUSTOM') {
    return {
      widthMm: normalized.customWidthMm,
      heightMm: normalized.customHeightMm
    };
  }
  return { widthMm: 210, heightMm: 297 };
}

function syncBarcodePrintCustomSizeVisibility() {
  const select = document.getElementById('barcode-print-paper-mode');
  const customBlock = document.getElementById('barcode-print-custom-size');
  if (!select || !customBlock) return;
  customBlock.classList.toggle('hidden', select.value !== 'CUSTOM');
}

function fillPasswordQrPrintSettingsForm(settings) {
  const normalized = normalizePasswordQrPrintSettingsClient(settings);
  const setValue = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = String(value);
  };
  const setChecked = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.checked = Boolean(value);
  };
  setValue('barcode-print-paper-mode', normalized.paperMode);
  setValue('barcode-print-width-mm', normalized.customWidthMm);
  setValue('barcode-print-height-mm', normalized.customHeightMm);
  setValue('barcode-print-placement', normalized.placement);
  setChecked('barcode-print-rotate90', normalized.rotate90);
  setChecked('barcode-print-show-username', normalized.showUsername);
  setChecked('barcode-print-show-password', normalized.showPassword);
  setValue('barcode-print-qr-size-mm', normalized.qrSizeMm);
  setValue('barcode-print-font-size-pt', normalized.fontSizePt);
  syncBarcodePrintCustomSizeVisibility();
}

function fillItemQrPrintSettingsForm(settings) {
  const normalized = normalizeItemQrPrintSettingsClient(settings);
  const setValue = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = String(value);
  };
  const setChecked = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.checked = Boolean(value);
  };
  setValue('barcode-print-paper-mode', normalized.paperMode);
  setValue('barcode-print-width-mm', normalized.customWidthMm);
  setValue('barcode-print-height-mm', normalized.customHeightMm);
  setValue('barcode-print-placement', normalized.placement);
  setChecked('barcode-print-rotate90', normalized.rotate90);
  setChecked('barcode-print-show-route-card-number', normalized.showRouteCardNumber);
  setChecked('barcode-print-show-item-name', normalized.showItemName);
  setChecked('barcode-print-show-item-serial', normalized.showItemSerial);
  setValue('barcode-print-qr-size-mm', normalized.qrSizeMm);
  setValue('barcode-print-font-size-pt', normalized.fontSizePt);
  syncBarcodePrintCustomSizeVisibility();
}

function fillCardQrPrintSettingsForm(settings) {
  const normalized = normalizeCardQrPrintSettingsClient(settings);
  const setValue = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = String(value);
  };
  const setChecked = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.checked = Boolean(value);
  };
  setValue('barcode-print-paper-mode', normalized.paperMode);
  setValue('barcode-print-width-mm', normalized.customWidthMm);
  setValue('barcode-print-height-mm', normalized.customHeightMm);
  setValue('barcode-print-placement', normalized.placement);
  setChecked('barcode-print-rotate90', normalized.rotate90);
  setChecked('barcode-print-show-card-route-number', normalized.showRouteNumber);
  setChecked('barcode-print-show-card-item-name', normalized.showItemName);
  setValue('barcode-print-qr-size-mm', normalized.qrSizeMm);
  setValue('barcode-print-font-size-pt', normalized.fontSizePt);
  syncBarcodePrintCustomSizeVisibility();
}

function readPasswordQrPrintSettingsForm() {
  const errorMessages = [];
  const getNumber = (id, label, min) => {
    const input = document.getElementById(id);
    const parsed = Number(input && input.value);
    if (!Number.isFinite(parsed)) {
      errorMessages.push(`Поле «${label}» заполнено некорректно`);
      return min;
    }
    if (parsed < min) {
      errorMessages.push(`Поле «${label}» должно быть не меньше ${min}`);
      return min;
    }
    return parsed;
  };
  const paperMode = (document.getElementById('barcode-print-paper-mode')?.value || 'A4').toUpperCase() === 'CUSTOM' ? 'CUSTOM' : 'A4';
  const current = getCurrentPasswordQrPrintSettings();
  const settings = {
    paperMode,
    customWidthMm: paperMode === 'CUSTOM'
      ? getNumber('barcode-print-width-mm', 'Ширина, мм', 10)
      : current.customWidthMm,
    customHeightMm: paperMode === 'CUSTOM'
      ? getNumber('barcode-print-height-mm', 'Высота, мм', 10)
      : current.customHeightMm,
    placement: (document.getElementById('barcode-print-placement')?.value || 'CENTER').toUpperCase() === 'TOP_LEFT' ? 'TOP_LEFT' : 'CENTER',
    rotate90: Boolean(document.getElementById('barcode-print-rotate90')?.checked),
    showUsername: Boolean(document.getElementById('barcode-print-show-username')?.checked),
    showPassword: Boolean(document.getElementById('barcode-print-show-password')?.checked),
    qrSizeMm: getNumber('barcode-print-qr-size-mm', 'Размер QR, мм', 5),
    fontSizePt: getNumber('barcode-print-font-size-pt', 'Размер шрифта, pt', 4)
  };
  return {
    settings: normalizePasswordQrPrintSettingsClient(settings),
    error: errorMessages[0] || ''
  };
}

function readItemQrPrintSettingsForm() {
  const errorMessages = [];
  const getNumber = (id, label, min) => {
    const input = document.getElementById(id);
    const parsed = Number(input && input.value);
    if (!Number.isFinite(parsed)) {
      errorMessages.push(`Поле «${label}» заполнено некорректно`);
      return min;
    }
    if (parsed < min) {
      errorMessages.push(`Поле «${label}» должно быть не меньше ${min}`);
      return min;
    }
    return parsed;
  };
  const paperMode = (document.getElementById('barcode-print-paper-mode')?.value || 'A4').toUpperCase() === 'CUSTOM' ? 'CUSTOM' : 'A4';
  const current = getCurrentItemQrPrintSettings();
  const settings = {
    paperMode,
    customWidthMm: paperMode === 'CUSTOM'
      ? getNumber('barcode-print-width-mm', 'Ширина, мм', 10)
      : current.customWidthMm,
    customHeightMm: paperMode === 'CUSTOM'
      ? getNumber('barcode-print-height-mm', 'Высота, мм', 10)
      : current.customHeightMm,
    placement: (document.getElementById('barcode-print-placement')?.value || 'CENTER').toUpperCase() === 'TOP_LEFT' ? 'TOP_LEFT' : 'CENTER',
    rotate90: Boolean(document.getElementById('barcode-print-rotate90')?.checked),
    showRouteCardNumber: Boolean(document.getElementById('barcode-print-show-route-card-number')?.checked),
    showItemName: Boolean(document.getElementById('barcode-print-show-item-name')?.checked),
    showItemSerial: Boolean(document.getElementById('barcode-print-show-item-serial')?.checked),
    qrSizeMm: getNumber('barcode-print-qr-size-mm', 'Размер QR, мм', 5),
    fontSizePt: getNumber('barcode-print-font-size-pt', 'Размер шрифта, pt', 4)
  };
  return {
    settings: normalizeItemQrPrintSettingsClient(settings),
    error: errorMessages[0] || ''
  };
}

function readCardQrPrintSettingsForm() {
  const errorMessages = [];
  const getNumber = (id, label, min) => {
    const input = document.getElementById(id);
    const parsed = Number(input && input.value);
    if (!Number.isFinite(parsed)) {
      errorMessages.push(`Поле «${label}» заполнено некорректно`);
      return min;
    }
    if (parsed < min) {
      errorMessages.push(`Поле «${label}» должно быть не меньше ${min}`);
      return min;
    }
    return parsed;
  };
  const paperMode = (document.getElementById('barcode-print-paper-mode')?.value || 'A4').toUpperCase() === 'CUSTOM' ? 'CUSTOM' : 'A4';
  const current = getCurrentCardQrPrintSettings();
  const settings = {
    paperMode,
    customWidthMm: paperMode === 'CUSTOM'
      ? getNumber('barcode-print-width-mm', 'Ширина, мм', 10)
      : current.customWidthMm,
    customHeightMm: paperMode === 'CUSTOM'
      ? getNumber('barcode-print-height-mm', 'Высота, мм', 10)
      : current.customHeightMm,
    placement: (document.getElementById('barcode-print-placement')?.value || 'CENTER').toUpperCase() === 'TOP_LEFT' ? 'TOP_LEFT' : 'CENTER',
    rotate90: Boolean(document.getElementById('barcode-print-rotate90')?.checked),
    showRouteNumber: Boolean(document.getElementById('barcode-print-show-card-route-number')?.checked),
    showItemName: Boolean(document.getElementById('barcode-print-show-card-item-name')?.checked),
    qrSizeMm: getNumber('barcode-print-qr-size-mm', 'Размер QR, мм', 5),
    fontSizePt: getNumber('barcode-print-font-size-pt', 'Размер шрифта, pt', 4)
  };
  return {
    settings: normalizeCardQrPrintSettingsClient(settings),
    error: errorMessages[0] || ''
  };
}

function syncBarcodePrintSettingsMode(mode) {
  const normalizedMode = mode === 'part' || mode === 'card'
    ? mode
    : 'password';
  const modal = document.getElementById('barcode-print-settings-modal');
  const titleEl = document.getElementById('barcode-print-settings-title');
  const passwordFields = document.getElementById('barcode-print-settings-password-fields');
  const itemFields = document.getElementById('barcode-print-settings-item-fields');
  const cardFields = document.getElementById('barcode-print-settings-card-fields');
  if (modal) modal.dataset.mode = normalizedMode;
  if (titleEl) {
    titleEl.textContent = normalizedMode === 'part'
      ? 'Настройка печати QR-кода изделия'
      : (normalizedMode === 'card'
        ? 'Настройка печати QR-кода МК'
        : 'Настройка печати');
  }
  if (passwordFields) passwordFields.classList.toggle('hidden', normalizedMode !== 'password');
  if (itemFields) itemFields.classList.toggle('hidden', normalizedMode !== 'part');
  if (cardFields) cardFields.classList.toggle('hidden', normalizedMode !== 'card');
}

function closeBarcodePrintSettingsModal() {
  const modal = document.getElementById('barcode-print-settings-modal');
  if (modal) modal.classList.add('hidden');
  const errorEl = document.getElementById('barcode-print-settings-error');
  if (errorEl) errorEl.textContent = '';
}

async function openBarcodePrintSettingsModal() {
  const modal = document.getElementById('barcode-modal');
  const settingsModal = document.getElementById('barcode-print-settings-modal');
  const errorEl = document.getElementById('barcode-print-settings-error');
  if (!modal || !settingsModal) return;
  const mode = (modal.dataset.mode || '').trim();
  if (mode !== 'password' && mode !== 'part' && mode !== 'card') return;
  if (errorEl) errorEl.textContent = '';
  syncBarcodePrintSettingsMode(mode);
  if (mode === 'part') {
    const settings = await ensureItemQrPrintSettingsLoaded();
    fillItemQrPrintSettingsForm(settings);
  } else if (mode === 'card') {
    const settings = await ensureCardQrPrintSettingsLoaded();
    fillCardQrPrintSettingsForm(settings);
  } else {
    const settings = await ensurePasswordQrPrintSettingsLoaded();
    fillPasswordQrPrintSettingsForm(settings);
  }
  settingsModal.classList.remove('hidden');
}

async function saveBarcodePrintSettingsFromModal() {
  const settingsModal = document.getElementById('barcode-print-settings-modal');
  const errorEl = document.getElementById('barcode-print-settings-error');
  if (errorEl) errorEl.textContent = '';
  const mode = (settingsModal?.dataset.mode || 'password').trim();
  const { settings, error } = mode === 'part'
    ? readItemQrPrintSettingsForm()
    : (mode === 'card' ? readCardQrPrintSettingsForm() : readPasswordQrPrintSettingsForm());
  if (error) {
    if (errorEl) errorEl.textContent = error;
    return false;
  }
  try {
    if (mode === 'part') {
      await saveItemQrPrintSettings(settings);
    } else if (mode === 'card') {
      await saveCardQrPrintSettings(settings);
    } else {
      await savePasswordQrPrintSettings(settings);
    }
    closeBarcodePrintSettingsModal();
    return true;
  } catch (err) {
    if (errorEl) errorEl.textContent = err.message || 'Не удалось сохранить настройки печати';
    return false;
  }
}

async function openPasswordBarcodePrint(value, username = '') {
  const normalized = (value || '').trim();
  if (!normalized) return;
  try {
    const settings = await ensurePasswordQrPrintSettingsLoaded({ force: true });
    const svg = await fetchBarcodeSvg(normalized, { raw: true });
    const win = window.open('', '_blank');
    if (!win) return;
    const page = getPasswordQrPrintPaperSizeMm(settings);
    const safeUser = escapeHtml((username || '').trim());
    const safePassword = escapeHtml(normalized);
    const showUsername = settings.showUsername && safeUser;
    const showPassword = settings.showPassword && safePassword;
    const configJson = JSON.stringify({
      pageWidthMm: page.widthMm,
      pageHeightMm: page.heightMm,
      placement: settings.placement,
      rotate90: settings.rotate90,
      qrSizeMm: settings.qrSizeMm,
      fontSizePt: settings.fontSizePt
    }).replace(/</g, '\\u003c');
    win.document.write(`<!doctype html>
<html><head><meta charset="utf-8"><title></title>
<style>
  @page {
    size: ${page.widthMm}mm ${page.heightMm}mm !important;
    margin: 0 !important;
  }
  html, body {
    margin: 0;
    padding: 0;
    width: ${page.widthMm}mm !important;
    height: ${page.heightMm}mm !important;
    min-width: ${page.widthMm}mm !important;
    min-height: ${page.heightMm}mm !important;
    background: #fff;
    overflow: hidden;
  }
  body {
    font-family: Arial, sans-serif;
    color: #111827;
  }
  .print-password-page {
    position: relative;
    width: ${page.widthMm}mm !important;
    height: ${page.heightMm}mm !important;
    overflow: hidden;
    background: #fff;
  }
  .print-password-anchor {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: top left;
  }
  .print-password-rotator {
    transform-origin: top left;
  }
  .print-password-block {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 1mm;
    white-space: nowrap;
  }
  .print-password-qr-box {
    width: ${settings.qrSizeMm}mm;
    height: ${settings.qrSizeMm}mm;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .print-password-qr-box svg {
    width: ${settings.qrSizeMm}mm;
    height: ${settings.qrSizeMm}mm;
    display: block;
  }
  .print-password-line {
    font-size: ${settings.fontSizePt}pt;
    line-height: 1.2;
    text-align: center;
    white-space: nowrap;
  }
  @media print {
    @page {
      size: ${page.widthMm}mm ${page.heightMm}mm !important;
      margin: 0 !important;
    }
    html, body {
      width: ${page.widthMm}mm !important;
      height: ${page.heightMm}mm !important;
      min-width: ${page.widthMm}mm !important;
      min-height: ${page.heightMm}mm !important;
      max-width: ${page.widthMm}mm !important;
      max-height: ${page.heightMm}mm !important;
      overflow: hidden !important;
    }
    .print-password-page {
      width: ${page.widthMm}mm !important;
      height: ${page.heightMm}mm !important;
      overflow: hidden !important;
    }
  }
</style>
</head><body>
  <div class="print-password-page" id="print-password-page">
    <div class="print-password-anchor" id="print-password-anchor">
      <div class="print-password-rotator" id="print-password-rotator">
        <div class="print-password-block" id="print-password-block">
          <div class="print-password-qr-box">${svg}</div>
          ${showUsername ? `<div class="print-password-line">${safeUser}</div>` : ''}
          ${showPassword ? `<div class="print-password-line">${safePassword}</div>` : ''}
        </div>
      </div>
    </div>
  </div>
  <script>
    (function () {
      var config = ${configJson};
      let fired = false;
      function layoutPrintBlock() {
        var pageEl = document.getElementById('print-password-page');
        var anchorEl = document.getElementById('print-password-anchor');
        var rotatorEl = document.getElementById('print-password-rotator');
        var blockEl = document.getElementById('print-password-block');
        if (!pageEl || !anchorEl || !rotatorEl || !blockEl) return;
        anchorEl.style.transform = 'none';
        rotatorEl.style.transform = 'none';
        anchorEl.style.left = '0px';
        anchorEl.style.top = '0px';
        var pageRect = pageEl.getBoundingClientRect();
        var blockWidth = blockEl.offsetWidth || blockEl.getBoundingClientRect().width || 0;
        var blockHeight = blockEl.offsetHeight || blockEl.getBoundingClientRect().height || 0;
        var rotatedWidth = config.rotate90 ? blockHeight : blockWidth;
        var rotatedHeight = config.rotate90 ? blockWidth : blockHeight;
        var marginMm = 0;
        if (config.placement === 'TOP_LEFT') {
          var pxPerMmX = pageRect.width / config.pageWidthMm;
          var pxPerMmY = pageRect.height / config.pageHeightMm;
          var fitsWithFive = rotatedWidth <= Math.max(0, pageRect.width - (10 * pxPerMmX))
            && rotatedHeight <= Math.max(0, pageRect.height - (10 * pxPerMmY));
          marginMm = fitsWithFive ? 5 : 2;
        }
        var marginPxX = (marginMm / config.pageWidthMm) * pageRect.width;
        var marginPxY = (marginMm / config.pageHeightMm) * pageRect.height;
        var availableWidth = config.placement === 'TOP_LEFT'
          ? Math.max(0, pageRect.width - marginPxX * 2)
          : pageRect.width;
        var availableHeight = config.placement === 'TOP_LEFT'
          ? Math.max(0, pageRect.height - marginPxY * 2)
          : pageRect.height;
        var scale = Math.min(1, availableWidth / Math.max(rotatedWidth, 1), availableHeight / Math.max(rotatedHeight, 1));
        if (!Number.isFinite(scale) || scale <= 0) scale = 1;
        var finalWidth = rotatedWidth * scale;
        var finalHeight = rotatedHeight * scale;
        var left = config.placement === 'CENTER'
          ? Math.max(0, (pageRect.width - finalWidth) / 2)
          : marginPxX;
        var top = config.placement === 'CENTER'
          ? Math.max(0, (pageRect.height - finalHeight) / 2)
          : marginPxY;
        anchorEl.style.left = left + 'px';
        anchorEl.style.top = top + 'px';
        anchorEl.style.transform = 'scale(' + scale + ')';
        rotatorEl.style.transform = config.rotate90
          ? 'translateX(' + blockHeight + 'px) rotate(90deg)'
          : 'none';
      }
      window.addEventListener('load', () => {
        if (fired) return;
        fired = true;
        layoutPrintBlock();
        setTimeout(() => {
          try { window.focus(); } catch (e) {}
          window.print();
        }, 250);
      });
      window.addEventListener('resize', layoutPrintBlock);
      window.addEventListener('afterprint', () => {
        try { window.close(); } catch (e) {}
      });
    })();
  </script>
</body></html>`);
    try { win.document.title = ''; } catch (e) {}
    win.document.close();
  } catch (err) {
    console.warn('Password barcode print failed', err);
  }
}

function createCardBarcodePrintMeta(input = {}) {
  return {
    routeNumber: trimToString(input.routeNumber || input.routeCardNumber || ''),
    itemName: trimToString(input.itemName || '')
  };
}

function buildCardBarcodePrintTextLines(meta, settings) {
  const normalizedMeta = createCardBarcodePrintMeta(meta);
  const normalizedSettings = normalizeCardQrPrintSettingsClient(settings);
  const combinedParts = [];
  if (normalizedSettings.showRouteNumber && normalizedMeta.routeNumber) {
    combinedParts.push(normalizedMeta.routeNumber);
  }
  if (normalizedSettings.showItemName && normalizedMeta.itemName) {
    combinedParts.push(normalizedMeta.itemName);
  }
  return {
    combinedLine: combinedParts.join(' · '),
    routeLine: normalizedSettings.showRouteNumber && normalizedMeta.routeNumber ? normalizedMeta.routeNumber : '',
    itemNameLine: normalizedSettings.showItemName && normalizedMeta.itemName ? normalizedMeta.itemName : ''
  };
}

function buildCardBarcodePrintPageHtml(svg, meta, settings, index = 0) {
  const lines = buildCardBarcodePrintTextLines(meta, settings);
  const safeCombinedLine = escapeHtml(lines.combinedLine);
  const safeRouteLine = escapeHtml(lines.routeLine);
  const safeItemNameLine = escapeHtml(lines.itemNameLine);
  return `
      <div class="print-card-page" id="print-card-page-${index}">
        <div class="print-card-anchor" id="print-card-anchor-${index}">
          <div class="print-card-rotator" id="print-card-rotator-${index}">
            <div class="print-card-block" id="print-card-block-${index}">
              <div class="print-card-qr-box">${svg}</div>
              ${safeCombinedLine ? `<div class="print-card-line print-card-combined-line" id="print-card-combined-line-${index}">${safeCombinedLine}</div>` : ''}
              ${safeRouteLine ? `<div class="print-card-line hidden" id="print-card-route-line-${index}">${safeRouteLine}</div>` : ''}
              ${safeItemNameLine ? `<div class="print-card-line hidden" id="print-card-name-line-${index}">${safeItemNameLine}</div>` : ''}
            </div>
          </div>
        </div>
      </div>`;
}

function getCardBarcodePrintStyles(settings, page) {
  return `
  @page {
    size: ${page.widthMm}mm ${page.heightMm}mm !important;
    margin: 0 !important;
  }
  html, body {
    margin: 0;
    padding: 0;
    width: ${page.widthMm}mm !important;
    height: ${page.heightMm}mm !important;
    min-width: ${page.widthMm}mm !important;
    min-height: ${page.heightMm}mm !important;
    background: #fff;
    overflow: hidden;
  }
  body {
    font-family: Arial, sans-serif;
    color: #111827;
  }
  .print-card-page {
    position: relative;
    width: ${page.widthMm}mm !important;
    height: ${page.heightMm}mm !important;
    overflow: hidden;
    background: #fff;
  }
  .print-card-anchor {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: top left;
  }
  .print-card-rotator {
    transform-origin: top left;
  }
  .print-card-block {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 1mm;
    max-width: ${page.widthMm}mm;
  }
  .print-card-qr-box {
    width: ${settings.qrSizeMm}mm;
    height: ${settings.qrSizeMm}mm;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .print-card-qr-box svg {
    width: ${settings.qrSizeMm}mm;
    height: ${settings.qrSizeMm}mm;
    display: block;
  }
  .print-card-line {
    font-size: ${settings.fontSizePt}pt;
    line-height: 1.2;
    text-align: center;
    white-space: nowrap;
    max-width: 100%;
  }
  .hidden {
    display: none !important;
  }
  @media print {
    @page {
      size: ${page.widthMm}mm ${page.heightMm}mm !important;
      margin: 0 !important;
    }
    html, body {
      width: ${page.widthMm}mm !important;
      height: ${page.heightMm}mm !important;
      min-width: ${page.widthMm}mm !important;
      min-height: ${page.heightMm}mm !important;
      max-width: ${page.widthMm}mm !important;
      max-height: ${page.heightMm}mm !important;
      overflow: hidden !important;
    }
    .print-card-page {
      width: ${page.widthMm}mm !important;
      height: ${page.heightMm}mm !important;
      overflow: hidden !important;
    }
  }`;
}

function getCardBarcodePrintScript(configJson) {
  return `
  <script>
    (function () {
      var config = ${configJson};
      var fired = false;
      function toggleCardLines(index, pageEl) {
        var combinedEl = document.getElementById('print-card-combined-line-' + index);
        var routeEl = document.getElementById('print-card-route-line-' + index);
        var itemNameEl = document.getElementById('print-card-name-line-' + index);
        if (!combinedEl) return;
        combinedEl.classList.remove('hidden');
        if (routeEl) routeEl.classList.add('hidden');
        if (itemNameEl) itemNameEl.classList.add('hidden');
        var combinedWidth = combinedEl.offsetWidth || combinedEl.getBoundingClientRect().width || 0;
        var availableWidth = pageEl.getBoundingClientRect().width;
        if (combinedWidth <= Math.max(0, availableWidth)) return;
        combinedEl.classList.add('hidden');
        if (routeEl) routeEl.classList.remove('hidden');
        if (itemNameEl) itemNameEl.classList.remove('hidden');
      }
      function layoutPrintBlock(index) {
        var pageEl = document.getElementById('print-card-page-' + index);
        var anchorEl = document.getElementById('print-card-anchor-' + index);
        var rotatorEl = document.getElementById('print-card-rotator-' + index);
        var blockEl = document.getElementById('print-card-block-' + index);
        if (!pageEl || !anchorEl || !rotatorEl || !blockEl) return;
        toggleCardLines(index, pageEl);
        anchorEl.style.transform = 'none';
        rotatorEl.style.transform = 'none';
        anchorEl.style.left = '0px';
        anchorEl.style.top = '0px';
        var pageRect = pageEl.getBoundingClientRect();
        var blockWidth = blockEl.offsetWidth || blockEl.getBoundingClientRect().width || 0;
        var blockHeight = blockEl.offsetHeight || blockEl.getBoundingClientRect().height || 0;
        var rotatedWidth = config.rotate90 ? blockHeight : blockWidth;
        var rotatedHeight = config.rotate90 ? blockWidth : blockHeight;
        var marginMm = 0;
        if (config.placement === 'TOP_LEFT') {
          var pxPerMmX = pageRect.width / config.pageWidthMm;
          var pxPerMmY = pageRect.height / config.pageHeightMm;
          var fitsWithFive = rotatedWidth <= Math.max(0, pageRect.width - (10 * pxPerMmX))
            && rotatedHeight <= Math.max(0, pageRect.height - (10 * pxPerMmY));
          marginMm = fitsWithFive ? 5 : 2;
        }
        var marginPxX = (marginMm / config.pageWidthMm) * pageRect.width;
        var marginPxY = (marginMm / config.pageHeightMm) * pageRect.height;
        var availableWidth = config.placement === 'TOP_LEFT'
          ? Math.max(0, pageRect.width - marginPxX * 2)
          : pageRect.width;
        var availableHeight = config.placement === 'TOP_LEFT'
          ? Math.max(0, pageRect.height - marginPxY * 2)
          : pageRect.height;
        var scale = Math.min(1, availableWidth / Math.max(rotatedWidth, 1), availableHeight / Math.max(rotatedHeight, 1));
        if (!Number.isFinite(scale) || scale <= 0) scale = 1;
        var finalWidth = rotatedWidth * scale;
        var finalHeight = rotatedHeight * scale;
        var left = config.placement === 'CENTER'
          ? Math.max(0, (pageRect.width - finalWidth) / 2)
          : marginPxX;
        var top = config.placement === 'CENTER'
          ? Math.max(0, (pageRect.height - finalHeight) / 2)
          : marginPxY;
        anchorEl.style.left = left + 'px';
        anchorEl.style.top = top + 'px';
        anchorEl.style.transform = 'scale(' + scale + ')';
        rotatorEl.style.transform = config.rotate90
          ? 'translateX(' + blockHeight + 'px) rotate(90deg)'
          : 'none';
      }
      window.addEventListener('load', function () {
        if (fired) return;
        fired = true;
        layoutPrintBlock(0);
        setTimeout(function () {
          try { window.focus(); } catch (e) {}
          window.print();
        }, 250);
      });
      window.addEventListener('resize', function () { layoutPrintBlock(0); });
      window.addEventListener('afterprint', function () {
        try { window.close(); } catch (e) {}
      });
    })();
  </script>`;
}

async function openCardBarcodePrintWindow(meta = {}) {
  const value = trimToString(meta.value);
  if (!value) return;
  try {
    const settings = await ensureCardQrPrintSettingsLoaded({ force: true });
    const page = getCardQrPrintPaperSizeMm(settings);
    const svg = await fetchBarcodeSvg(value);
    const safeMeta = createCardBarcodePrintMeta(meta);
    const configJson = JSON.stringify({
      pageWidthMm: page.widthMm,
      pageHeightMm: page.heightMm,
      placement: settings.placement,
      rotate90: settings.rotate90
    }).replace(/</g, '\\u003c');
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!doctype html>
<html><head><meta charset="utf-8"><title></title>
<style>
${getCardBarcodePrintStyles(settings, page)}
</style>
</head><body>
${buildCardBarcodePrintPageHtml(svg, safeMeta, settings, 0)}
${getCardBarcodePrintScript(configJson)}
</body></html>`);
    try { win.document.title = ''; } catch (e) {}
    win.document.close();
  } catch (err) {
    console.warn('Card barcode print failed', err);
  }
}

function createPartBarcodePrintMeta(input = {}) {
  const routeNumber = trimToString(input.routeNumber || input.routeCardNumber || '');
  const itemName = trimToString(input.itemName || '');
  const serial = trimToString(input.serial || input.itemSerial || '');
  return {
    routeNumber,
    itemName,
    serial,
    extraText: [routeNumber ? `МК: ${routeNumber}` : '', serial ? `№ детали: ${serial}` : ''].filter(Boolean).join(' · ')
  };
}

function buildPartBarcodePrintTextLines(meta, settings) {
  const normalizedMeta = createPartBarcodePrintMeta(meta);
  const normalizedSettings = normalizeItemQrPrintSettingsClient(settings);
  const lines = [];
  if (normalizedSettings.showRouteCardNumber && normalizedMeta.routeNumber) {
    lines.push(normalizedMeta.routeNumber);
  }
  const combinedParts = [];
  if (normalizedSettings.showItemName && normalizedMeta.itemName) {
    combinedParts.push(normalizedMeta.itemName);
  }
  if (normalizedSettings.showItemSerial && normalizedMeta.serial) {
    combinedParts.push(normalizedMeta.serial);
  }
  return {
    routeLine: lines[0] || '',
    combinedLine: combinedParts.join(' · '),
    itemNameLine: normalizedSettings.showItemName && normalizedMeta.itemName ? normalizedMeta.itemName : '',
    itemSerialLine: normalizedSettings.showItemSerial && normalizedMeta.serial ? normalizedMeta.serial : ''
  };
}

function buildPartBarcodePrintPageHtml(svg, meta, settings, index = 0) {
  const lines = buildPartBarcodePrintTextLines(meta, settings);
  const safeRouteLine = escapeHtml(lines.routeLine);
  const safeCombinedLine = escapeHtml(lines.combinedLine);
  const safeItemNameLine = escapeHtml(lines.itemNameLine);
  const safeItemSerialLine = escapeHtml(lines.itemSerialLine);
  return `
      <div class="print-item-page" id="print-item-page-${index}">
        <div class="print-item-anchor" id="print-item-anchor-${index}">
          <div class="print-item-rotator" id="print-item-rotator-${index}">
            <div class="print-item-block" id="print-item-block-${index}">
              <div class="print-item-qr-box">${svg}</div>
              ${safeRouteLine ? `<div class="print-item-line">${safeRouteLine}</div>` : ''}
              ${safeCombinedLine ? `<div class="print-item-line print-item-combined-line" id="print-item-combined-line-${index}">${safeCombinedLine}</div>` : ''}
              ${safeItemNameLine ? `<div class="print-item-line hidden" id="print-item-name-line-${index}">${safeItemNameLine}</div>` : ''}
              ${safeItemSerialLine ? `<div class="print-item-line hidden" id="print-item-serial-line-${index}">${safeItemSerialLine}</div>` : ''}
            </div>
          </div>
        </div>
      </div>`;
}

function getPartBarcodePrintStyles(settings, page, { pageBreakAfter = false, multiPage = false } = {}) {
  const htmlBodyBase = multiPage
    ? `  html, body {
    margin: 0;
    padding: 0;
    background: #fff;
  }`
    : `  html, body {
    margin: 0;
    padding: 0;
    width: ${page.widthMm}mm !important;
    height: ${page.heightMm}mm !important;
    min-width: ${page.widthMm}mm !important;
    min-height: ${page.heightMm}mm !important;
    background: #fff;
    overflow: hidden;
  }`;
  const htmlBodyPrint = multiPage
    ? `    html, body {
      margin: 0 !important;
      padding: 0 !important;
      background: #fff !important;
      overflow: visible !important;
    }`
    : `    html, body {
      width: ${page.widthMm}mm !important;
      height: ${page.heightMm}mm !important;
      min-width: ${page.widthMm}mm !important;
      min-height: ${page.heightMm}mm !important;
      max-width: ${page.widthMm}mm !important;
      max-height: ${page.heightMm}mm !important;
      overflow: hidden !important;
    }`;
  return `
  @page {
    size: ${page.widthMm}mm ${page.heightMm}mm !important;
    margin: 0 !important;
  }
${htmlBodyBase}
  body {
    font-family: Arial, sans-serif;
    color: #111827;
  }
  .print-item-page {
    position: relative;
    width: ${page.widthMm}mm !important;
    height: ${page.heightMm}mm !important;
    overflow: hidden;
    background: #fff;
    ${pageBreakAfter ? 'page-break-after: always;' : ''}
  }
  .print-item-page:last-child {
    page-break-after: auto;
  }
  .print-item-anchor {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: top left;
  }
  .print-item-rotator {
    transform-origin: top left;
  }
  .print-item-block {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 1mm;
    max-width: ${page.widthMm}mm;
  }
  .print-item-qr-box {
    width: ${settings.qrSizeMm}mm;
    height: ${settings.qrSizeMm}mm;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .print-item-qr-box svg {
    width: ${settings.qrSizeMm}mm;
    height: ${settings.qrSizeMm}mm;
    display: block;
  }
  .print-item-line {
    font-size: ${settings.fontSizePt}pt;
    line-height: 1.2;
    text-align: center;
    white-space: nowrap;
    max-width: 100%;
  }
  .hidden {
    display: none !important;
  }
  @media print {
    @page {
      size: ${page.widthMm}mm ${page.heightMm}mm !important;
      margin: 0 !important;
    }
${htmlBodyPrint}
    .print-item-page {
      width: ${page.widthMm}mm !important;
      height: ${page.heightMm}mm !important;
      overflow: hidden !important;
      break-after: ${pageBreakAfter ? 'page' : 'auto'};
      page-break-after: ${pageBreakAfter ? 'always' : 'auto'};
    }
    .print-item-page:last-child {
      break-after: auto !important;
      page-break-after: auto !important;
    }
  }`;
}

function getPartBarcodePrintScript(configJson) {
  return `
  <script>
    (function () {
      var config = ${configJson};
      var fired = false;
      function toggleItemLines(index, blockEl, pageEl) {
        var combinedEl = document.getElementById('print-item-combined-line-' + index);
        var itemNameEl = document.getElementById('print-item-name-line-' + index);
        var itemSerialEl = document.getElementById('print-item-serial-line-' + index);
        if (!combinedEl) return;
        combinedEl.classList.remove('hidden');
        if (itemNameEl) itemNameEl.classList.add('hidden');
        if (itemSerialEl) itemSerialEl.classList.add('hidden');
        var availableWidth = pageEl.getBoundingClientRect().width;
        var maxLineWidth = Math.max(0, availableWidth);
        var combinedWidth = combinedEl.offsetWidth || combinedEl.getBoundingClientRect().width || 0;
        if (combinedWidth <= maxLineWidth) return;
        combinedEl.classList.add('hidden');
        if (itemNameEl) itemNameEl.classList.remove('hidden');
        if (itemSerialEl) itemSerialEl.classList.remove('hidden');
      }
      function layoutPrintBlock(index) {
        var pageEl = document.getElementById('print-item-page-' + index);
        var anchorEl = document.getElementById('print-item-anchor-' + index);
        var rotatorEl = document.getElementById('print-item-rotator-' + index);
        var blockEl = document.getElementById('print-item-block-' + index);
        if (!pageEl || !anchorEl || !rotatorEl || !blockEl) return;
        toggleItemLines(index, blockEl, pageEl);
        anchorEl.style.transform = 'none';
        rotatorEl.style.transform = 'none';
        anchorEl.style.left = '0px';
        anchorEl.style.top = '0px';
        var pageRect = pageEl.getBoundingClientRect();
        var blockWidth = blockEl.offsetWidth || blockEl.getBoundingClientRect().width || 0;
        var blockHeight = blockEl.offsetHeight || blockEl.getBoundingClientRect().height || 0;
        var rotatedWidth = config.rotate90 ? blockHeight : blockWidth;
        var rotatedHeight = config.rotate90 ? blockWidth : blockHeight;
        var marginMm = 0;
        if (config.placement === 'TOP_LEFT') {
          var pxPerMmX = pageRect.width / config.pageWidthMm;
          var pxPerMmY = pageRect.height / config.pageHeightMm;
          var fitsWithFive = rotatedWidth <= Math.max(0, pageRect.width - (10 * pxPerMmX))
            && rotatedHeight <= Math.max(0, pageRect.height - (10 * pxPerMmY));
          marginMm = fitsWithFive ? 5 : 2;
        }
        var marginPxX = (marginMm / config.pageWidthMm) * pageRect.width;
        var marginPxY = (marginMm / config.pageHeightMm) * pageRect.height;
        var availableWidth = config.placement === 'TOP_LEFT'
          ? Math.max(0, pageRect.width - marginPxX * 2)
          : pageRect.width;
        var availableHeight = config.placement === 'TOP_LEFT'
          ? Math.max(0, pageRect.height - marginPxY * 2)
          : pageRect.height;
        var scale = Math.min(1, availableWidth / Math.max(rotatedWidth, 1), availableHeight / Math.max(rotatedHeight, 1));
        if (!Number.isFinite(scale) || scale <= 0) scale = 1;
        var finalWidth = rotatedWidth * scale;
        var finalHeight = rotatedHeight * scale;
        var left = config.placement === 'CENTER'
          ? Math.max(0, (pageRect.width - finalWidth) / 2)
          : marginPxX;
        var top = config.placement === 'CENTER'
          ? Math.max(0, (pageRect.height - finalHeight) / 2)
          : marginPxY;
        anchorEl.style.left = left + 'px';
        anchorEl.style.top = top + 'px';
        anchorEl.style.transform = 'scale(' + scale + ')';
        rotatorEl.style.transform = config.rotate90
          ? 'translateX(' + blockHeight + 'px) rotate(90deg)'
          : 'none';
      }
      function layoutAll() {
        for (var i = 0; i < config.pageCount; i += 1) {
          layoutPrintBlock(i);
        }
      }
      window.addEventListener('load', function () {
        if (fired) return;
        fired = true;
        layoutAll();
        setTimeout(function () {
          try { window.focus(); } catch (e) {}
          window.print();
        }, 250);
      });
      window.addEventListener('resize', layoutAll);
      window.addEventListener('afterprint', function () {
        try { window.close(); } catch (e) {}
      });
    })();
  </script>`;
}

async function openItemBarcodePrintWindow(items = []) {
  try {
    const normalizedItems = (items || []).filter(item => item && trimToString(item.value));
    if (!normalizedItems.length) return;
    const multiPage = normalizedItems.length > 1;
    const settings = await ensureItemQrPrintSettingsLoaded({ force: true });
    const page = getItemQrPrintPaperSizeMm(settings);
    const svgs = await Promise.all(
      normalizedItems.map(item => fetchBarcodeSvg(item.value, { raw: true }).catch(() => '<div class="barcode-error">Не удалось загрузить QR-код</div>'))
    );
    const win = window.open('', '_blank');
    if (!win) return;
    const pages = normalizedItems.map((item, index) => {
      const svg = svgs[index] || '<div class="barcode-error">Не удалось загрузить QR-код</div>';
      return buildPartBarcodePrintPageHtml(svg, item, settings, index);
    }).join('');
    const configJson = JSON.stringify({
      pageWidthMm: page.widthMm,
      pageHeightMm: page.heightMm,
      placement: settings.placement,
      rotate90: settings.rotate90,
      pageCount: normalizedItems.length
    }).replace(/</g, '\\u003c');
    win.document.write(`<!doctype html>
<html><head><meta charset="utf-8"><title></title>
<style>
${getPartBarcodePrintStyles(settings, page, { pageBreakAfter: multiPage, multiPage })}
</style>
</head><body>
${pages}
${getPartBarcodePrintScript(configJson)}
</body></html>`);
    try { win.document.title = ''; } catch (e) {}
    win.document.close();
  } catch (err) {
    console.warn('Item barcode print failed', err);
  }
}

async function openPartBarcodePrintBatch(items = [], titleText = 'QR-код изделия') {
  await openItemBarcodePrintWindow(items);
}

async function openLegacyBarcodePrint(value, titleText = '', extraText = '') {
  try {
    const svg = await fetchBarcodeSvg(value);
    const win = window.open('', '_blank');
    if (!win) return;
    const extra = escapeHtml(extraText || '');
    const code = escapeHtml(value || '');
    win.document.write(`<!doctype html>
<html><head><meta charset="utf-8"><title></title>
<style>
  @page { margin: 0; }
  body{font-family:Arial,sans-serif;margin:0;text-align:center;color:#111827;}
  .page{padding:24px;}
  .qr-wrap{display:inline-block;padding:12px;border:1px solid #e5e7eb;border-radius:10px;}
  .qr-code{margin-top:8px;font-size:14px;}
  .qr-extra{margin-top:6px;font-size:13px;color:#6b7280;}
</style>
</head><body>
  <div class="page">
    <div class="qr-wrap">
      ${svg}
      <div class="qr-code">${code}</div>
      ${extra ? `<div class="qr-extra">${extra}</div>` : ''}
    </div>
  </div>
  <script>
    window.addEventListener('load', () => {
      window.focus();
      window.print();
      setTimeout(() => { try { window.close(); } catch (e) {} }, 800);
    });
    window.addEventListener('afterprint', () => { try { window.close(); } catch (e) {} });
  </script>
</body></html>`);
    try { win.document.title = ''; } catch (e) {}
    win.document.close();
  } catch (err) {
    console.warn('Part barcode print failed', err);
  }
}

async function openPartBarcodePrint(value, metaOrTitle = '', extraText = '') {
  const valueText = trimToString(value);
  if (!valueText) return;
  if (metaOrTitle && typeof metaOrTitle === 'object' && !Array.isArray(metaOrTitle)) {
    const meta = createPartBarcodePrintMeta(metaOrTitle);
    await openItemBarcodePrintWindow([{ value: valueText, ...meta }]);
    return;
  } else {
    await openLegacyBarcodePrint(valueText, metaOrTitle, extraText);
  }
}

function openPartBarcodeModal(card, serialOrItem, options = {}) {
  const { fromRestore = false } = options;
  const modal = document.getElementById('barcode-modal');
  const barcodeContainer = document.getElementById('barcode-svg');
  const codeSpan = document.getElementById('barcode-modal-code');
  const title = document.getElementById('barcode-modal-title');
  const userLabel = document.getElementById('barcode-modal-user');
  const extraLabel = document.getElementById('barcode-modal-extra');
  const settingsBtn = document.getElementById('btn-barcode-print-settings');
  if (!modal || !barcodeContainer || !codeSpan) return;

  const flowItem = serialOrItem && typeof serialOrItem === 'object' ? serialOrItem : null;
  const result = flowItem
    ? {
        value: trimToString(flowItem.qr || ''),
        serial: trimToString(flowItem.displayName || flowItem.id || ''),
        routeNumber: trimToString(card?.routeCardNumber || ''),
        itemName: getCardItemName(card) || '',
        created: false
      }
    : getOrCreatePartQrValue(card, serialOrItem);
  const serialText = result.serial;
  const value = result.value;
  const routeNumber = trimToString(result.routeNumber || card?.routeCardNumber || '');
  const itemName = trimToString(result.itemName || getCardItemName(card) || '');
  if (result.created) {
    saveData();
    renderEverything();
  }
  if (title) title.textContent = 'QR-код изделия';
  if (userLabel) {
    userLabel.textContent = '';
    userLabel.classList.add('hidden');
  }
  if (settingsBtn) settingsBtn.classList.remove('hidden');
  renderBarcodeInto(barcodeContainer, value, { raw: true });
  codeSpan.textContent = value;
  if (extraLabel) {
    const extraText = [routeNumber ? `МК: ${routeNumber}` : '', serialText ? `№ детали: ${serialText}` : ''].filter(Boolean).join(' · ');
    extraLabel.textContent = extraText;
    extraLabel.classList.toggle('hidden', !extraText);
  }

  modal.dataset.mode = 'part';
  modal.dataset.partValue = value;
  modal.dataset.partTitle = 'QR-код изделия';
  modal.dataset.partExtra = [routeNumber ? `МК: ${routeNumber}` : '', serialText ? `№ детали: ${serialText}` : ''].filter(Boolean).join(' · ');
  modal.dataset.partRouteNumber = routeNumber;
  modal.dataset.partItemName = itemName;
  modal.dataset.partSerial = serialText;
  modal.dataset.cardId = card && card.id ? card.id : '';
  modal.dataset.userId = '';
  modal.style.display = 'flex';
  ensureItemQrPrintSettingsLoaded().catch(() => {});
  setModalState({ type: 'barcode', cardId: card && card.id ? card.id : '', mode: 'part' }, { fromRestore });
}

function closeBarcodeModal(silent = false) {
  const modal = document.getElementById('barcode-modal');
  if (modal) modal.style.display = 'none';
  closeBarcodePrintSettingsModal();
  if (silent || restoringState) return;
  if (appState.modal && appState.modal.type === 'barcode') {
    history.back();
  } else {
    setModalState(null, { replace: true });
  }
}

function openPrintWindow(url) {
  const win = window.open(url, '_blank');
  if (!win) return;

  try { win.focus(); } catch (e) {}
  // ВАЖНО: здесь НЕЛЬЗЯ вызывать win.print().
  // Печать будет запускаться внутри шаблона после генерации SVG.
}

function setupBarcodeModal() {
  const modal = document.getElementById('barcode-modal');
  if (!modal) return;
  const closeBtn = document.getElementById('btn-close-barcode');
  const printBtn = document.getElementById('btn-print-barcode');
  const settingsBtn = document.getElementById('btn-barcode-print-settings');
  const settingsModal = document.getElementById('barcode-print-settings-modal');
  const settingsForm = document.getElementById('barcode-print-settings-form');
  const settingsCancelBtn = document.getElementById('barcode-print-settings-cancel');
  const paperModeSelect = document.getElementById('barcode-print-paper-mode');

  if (closeBtn) {
    closeBtn.addEventListener('click', closeBarcodeModal);
  }

  if (settingsBtn && settingsBtn.dataset.bound !== 'true') {
    settingsBtn.dataset.bound = 'true';
    settingsBtn.addEventListener('click', () => {
      openBarcodePrintSettingsModal();
    });
  }

  if (settingsCancelBtn && settingsCancelBtn.dataset.bound !== 'true') {
    settingsCancelBtn.dataset.bound = 'true';
    settingsCancelBtn.addEventListener('click', closeBarcodePrintSettingsModal);
  }

  if (paperModeSelect && paperModeSelect.dataset.bound !== 'true') {
    paperModeSelect.dataset.bound = 'true';
    paperModeSelect.addEventListener('change', syncBarcodePrintCustomSizeVisibility);
  }

  if (settingsForm && settingsForm.dataset.bound !== 'true') {
    settingsForm.dataset.bound = 'true';
    settingsForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      await saveBarcodePrintSettingsFromModal();
    });
  }

  if (printBtn) {
    printBtn.addEventListener('click', () => {
      const mode = modal.dataset.mode || 'card';
      if (mode === 'password') {
        const passwordValue = (modal.dataset.passwordValue || '').trim();
        if (passwordValue) {
          const username = (modal.dataset.username || '').trim();
          openPasswordBarcodePrint(passwordValue, username);
        }
        return;
      }

      if (mode === 'part') {
        const value = (modal.dataset.partValue || '').trim();
        if (value) {
          openPartBarcodePrint(value, {
            routeNumber: modal.dataset.partRouteNumber || '',
            itemName: modal.dataset.partItemName || '',
            serial: modal.dataset.partSerial || ''
          });
        }
        return;
      }

      const cardId = (modal.dataset.cardId || '').trim();
      if (cardId) {
        const value = (modal.dataset.cardQrValue || '').trim();
        if (value) {
          openCardBarcodePrintWindow({
            value,
            routeNumber: modal.dataset.cardRouteNumber || '',
            itemName: modal.dataset.cardItemName || ''
          });
        }
      }
    });
  }
}
