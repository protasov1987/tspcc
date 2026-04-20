// === ХРАНИЛИЩЕ ===
let __saveInFlight = null;      // Promise текущего сохранения
let __savePending = false;      // нужно ли повторить сохранение после текущего
let __securityDataLoaded = false;
let __loadedDataScopes = new Set();
let __loadedDataScopeAt = new Map();
let __fullDataHydrated = false;
let __dataLoadInFlight = new Map();
let __backgroundHydrationPromise = null;
let __cardStoreById = new Map();
let __cardsCoreDetailLoadedAt = new Map();

const DATA_SCOPE_FULL = 'full';
const DATA_SCOPE_CARDS_BASIC = 'cards-basic';
const DATA_SCOPE_DIRECTORIES = 'directories';
const DATA_SCOPE_PRODUCTION = 'production';

function normalizeClientDataScope(scope) {
  const value = String(scope || DATA_SCOPE_FULL).trim().toLowerCase();
  if (value === DATA_SCOPE_CARDS_BASIC) return DATA_SCOPE_CARDS_BASIC;
  if (value === DATA_SCOPE_DIRECTORIES) return DATA_SCOPE_DIRECTORIES;
  if (value === DATA_SCOPE_PRODUCTION) return DATA_SCOPE_PRODUCTION;
  return DATA_SCOPE_FULL;
}

function markLoadedDataScope(scope) {
  const normalizedScope = normalizeClientDataScope(scope);
  const markAt = Date.now();
  if (normalizedScope === DATA_SCOPE_FULL) {
    __fullDataHydrated = true;
    __loadedDataScopes = new Set([
      DATA_SCOPE_FULL,
      DATA_SCOPE_CARDS_BASIC,
      DATA_SCOPE_DIRECTORIES,
      DATA_SCOPE_PRODUCTION
    ]);
    __loadedDataScopeAt = new Map([
      [DATA_SCOPE_FULL, markAt],
      [DATA_SCOPE_CARDS_BASIC, markAt],
      [DATA_SCOPE_DIRECTORIES, markAt],
      [DATA_SCOPE_PRODUCTION, markAt]
    ]);
    return;
  }
  __loadedDataScopes.add(normalizedScope);
  __loadedDataScopeAt.set(normalizedScope, markAt);
  if (normalizedScope === DATA_SCOPE_PRODUCTION) {
    __loadedDataScopes.add(DATA_SCOPE_CARDS_BASIC);
    __loadedDataScopeAt.set(DATA_SCOPE_CARDS_BASIC, markAt);
  }
}

function hasLoadedDataScope(scope) {
  const normalizedScope = normalizeClientDataScope(scope);
  return __fullDataHydrated || __loadedDataScopes.has(normalizedScope);
}

function getLoadedDataScopeAgeMs(scope) {
  const normalizedScope = normalizeClientDataScope(scope);
  const loadedAt = __loadedDataScopeAt.get(normalizedScope);
  if (!Number.isFinite(loadedAt)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Date.now() - loadedAt);
}

function isDataScopeLoadInFlight(scope) {
  const normalizedScope = normalizeClientDataScope(scope);
  if (__dataLoadInFlight.has(normalizedScope)) return true;
  if (normalizedScope !== DATA_SCOPE_FULL && __dataLoadInFlight.has(DATA_SCOPE_FULL)) return true;
  return false;
}

function isFullDataHydrated() {
  return __fullDataHydrated;
}

function isBackgroundHydrationInFlight() {
  return Boolean(__backgroundHydrationPromise);
}

function resetDataHydrationState() {
  __loadedDataScopes = new Set();
  __loadedDataScopeAt = new Map();
  __fullDataHydrated = false;
  __dataLoadInFlight = new Map();
  __backgroundHydrationPromise = null;
  __cardsCoreDetailLoadedAt = new Map();
}

function hasLoadedSecurityData() {
  return __securityDataLoaded;
}

function resetSecurityDataLoaded() {
  __securityDataLoaded = false;
}

function rebuildCardStoreIndex() {
  __cardStoreById = new Map();
  (cards || []).forEach(card => {
    const id = String(card?.id || '').trim();
    if (!id) return;
    __cardStoreById.set(id, card);
  });
}

function getCardStoreCard(cardId) {
  const key = String(cardId || '').trim();
  if (!key) return null;
  return __cardStoreById.get(key) || null;
}

function findCardEntityByKey(cardKey) {
  const key = String(cardKey || '').trim();
  if (!key) return null;
  const byId = getCardStoreCard(key);
  if (byId) return byId;
  const normalizedQr = typeof normalizeQrId === 'function' ? normalizeQrId(key) : key;
  if (!normalizedQr) return null;
  return (cards || []).find(card => normalizeQrId(card?.qrId || card?.barcode || '') === normalizedQr) || null;
}

function getCardsCoreRouteKey(routePath = '') {
  const rawPath = String(routePath || '').trim();
  const cleanPath = typeof normalizeSecurityRoutePath === 'function'
    ? normalizeSecurityRoutePath(rawPath)
    : ((rawPath.split('?')[0] || '/').replace(/\/+$/, '') || '/');
  if (cleanPath === '/cards/new' || cleanPath === '/cards-mki/new') return '';
  if (cleanPath.startsWith('/card-route/')) {
    return decodeURIComponent((cleanPath.split('/')[2] || '').trim());
  }
  if (cleanPath.startsWith('/cards/')) {
    return decodeURIComponent((cleanPath.split('/')[2] || '').trim());
  }
  return '';
}

function markCardsCoreDetailLoaded(card) {
  if (!card || !card.id) return;
  const markAt = Date.now();
  const keys = new Set();
  const idKey = String(card.id || '').trim();
  if (idKey) keys.add(idKey);
  const qrKey = typeof normalizeQrId === 'function'
    ? normalizeQrId(card.qrId || card.barcode || '')
    : String(card.qrId || card.barcode || '').trim();
  if (qrKey) keys.add(qrKey);
  keys.forEach(key => {
    __cardsCoreDetailLoadedAt.set(key, markAt);
  });
}

function hasCardsCoreRouteCardLoaded(routePath = '') {
  const key = getCardsCoreRouteKey(routePath);
  if (!key) return false;
  if (__cardsCoreDetailLoadedAt.has(key)) return true;
  const normalizedQr = typeof normalizeQrId === 'function' ? normalizeQrId(key) : key;
  return normalizedQr ? __cardsCoreDetailLoadedAt.has(normalizedQr) : false;
}

async function fetchCardsCoreCard(cardKey, { force = false, reason = 'detail' } = {}) {
  const normalizedKey = String(cardKey || '').trim();
  if (!normalizedKey) return null;
  const normalizedQr = typeof normalizeQrId === 'function' ? normalizeQrId(normalizedKey) : normalizedKey;
  if (!force) {
    const existingCard = findCardEntityByKey(normalizedKey);
    if (existingCard && (
      __cardsCoreDetailLoadedAt.has(normalizedKey)
      || (normalizedQr && __cardsCoreDetailLoadedAt.has(normalizedQr))
    )) {
      console.log('[DATA] cards-core detail skipped', {
        cardKey: normalizedKey,
        reason,
        state: 'cached'
      });
      return existingCard;
    }
  }

  console.log('[DATA] cards-core detail start', {
    cardKey: normalizedKey,
    reason
  });
  const res = await apiFetch('/api/cards-core/' + encodeURIComponent(normalizedKey), {
    method: 'GET',
    connectionSource: 'cards-core:detail'
  });
  if (res.status === 404) {
    console.warn('[DATA] cards-core detail not-found', {
      cardKey: normalizedKey,
      reason
    });
    return null;
  }
  if (!res.ok) {
    throw new Error('Ответ сервера ' + res.status);
  }
  const payload = await res.json();
  const card = payload?.card && typeof payload.card === 'object' ? payload.card : null;
  if (card) {
    upsertCardEntity(card);
    markCardsCoreDetailLoaded(card);
  }
  console.log('[DATA] cards-core detail done', {
    cardKey: normalizedKey,
    cardId: card?.id || null,
    rev: Number.isFinite(card?.rev) ? card.rev : null,
    reason
  });
  return card;
}

async function ensureCardsCoreRouteCard(routePath, { force = false, reason = 'route' } = {}) {
  const cardKey = getCardsCoreRouteKey(routePath);
  if (!cardKey) return null;
  return fetchCardsCoreCard(cardKey, {
    force,
    reason: reason + ':' + String(routePath || '').trim()
  });
}

function createCardsCoreCard(cardInput) {
  return apiFetch('/api/cards-core', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cardInput || {}),
    connectionSource: 'cards-core:create'
  });
}

function updateCardsCoreCard(cardId, cardInput, { expectedRev } = {}) {
  const payload = {
    ...(cardInput || {}),
    expectedRev
  };
  return apiFetch('/api/cards-core/' + encodeURIComponent(String(cardId || '').trim()), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    connectionSource: 'cards-core:update'
  });
}

function upsertCardEntity(card) {
  if (!card || !card.id) return null;
  const key = String(card.id).trim();
  if (!key) return null;
  const existingIdx = (cards || []).findIndex(item => String(item?.id || '').trim() === key);
  if (existingIdx >= 0) {
    cards[existingIdx] = card;
  } else {
    cards.push(card);
  }
  __cardStoreById.set(key, card);
  return card;
}

function removeCardEntity(cardId) {
  const key = String(cardId || '').trim();
  if (!key) return false;
  const prevLen = Array.isArray(cards) ? cards.length : 0;
  cards = (cards || []).filter(item => String(item?.id || '').trim() !== key);
  __cardStoreById.delete(key);
  __cardsCoreDetailLoadedAt.delete(key);
  return cards.length !== prevLen;
}

function applyLoadedDataPayload(payload, { scope = DATA_SCOPE_FULL } = {}) {
  const normalizedScope = normalizeClientDataScope(payload?.scope || scope);

  if (Array.isArray(payload?.cards)) {
    cards = payload.cards;
  }
  if (Array.isArray(payload?.ops)) {
    ops = payload.ops;
  }
  if (Array.isArray(payload?.centers)) {
    centers = payload.centers;
  }
  if (Array.isArray(payload?.areas)) {
    areas = payload.areas.map(area => normalizeArea(area));
  }
  if (Array.isArray(payload?.productionSchedule)) {
    productionSchedule = payload.productionSchedule;
  }
  if (Array.isArray(payload?.productionShiftTasks)) {
    productionShiftTasks = payload.productionShiftTasks;
  }
  if (Array.isArray(payload?.productionShifts)) {
    productionShifts = payload.productionShifts;
  }
  if (Array.isArray(payload?.productionShiftTimes)) {
    productionShiftTimes = payload.productionShiftTimes.length
      ? payload.productionShiftTimes.map((item, index) => normalizeProductionShiftTimeEntry(item, index + 1))
      : [];
  }
  if (Array.isArray(payload?.accessLevels)) {
    accessLevels = payload.accessLevels;
  }
  if (Array.isArray(payload?.users)) {
    users = payload.users.map(user => ({
      ...user,
      id: String(user.id).trim(),
      departmentId: user.departmentId == null ? null : String(user.departmentId).trim()
    }));
  }

  ensureDefaults();
  ensureOperationCodes();
  ensureOperationTypes();
  ensureAreaTypes();
  ensureOperationAllowedAreas();
  ensureUniqueQrIds(cards);
  ensureUniqueBarcodes(cards);
  renderUserDatalist();

  cards.forEach(c => {
    c.archived = Boolean(c.archived);
    ensureAttachments(c);
    ensureCardMeta(c);
    c.operations = c.operations || [];
    c.operations.forEach(op => {
      if (typeof op.elapsedSeconds !== 'number') {
        op.elapsedSeconds = 0;
      }
      op.goodCount = toSafeCount(op.goodCount || 0);
      op.scrapCount = toSafeCount(op.scrapCount || 0);
      op.holdCount = toSafeCount(op.holdCount || 0);
      if (typeof op.firstStartedAt !== 'number') {
        op.firstStartedAt = op.startedAt || null;
      }
      if (typeof op.lastPausedAt !== 'number') {
        op.lastPausedAt = null;
      }
      if (typeof op.comment !== 'string') {
        op.comment = '';
      }
      if (op.status === 'DONE' && op.actualSeconds != null && !op.elapsedSeconds) {
        op.elapsedSeconds = op.actualSeconds;
      }
    });
    recalcCardStatus(c);
  });

  if (Array.isArray(payload?.users) && Array.isArray(payload?.accessLevels)) {
    __securityDataLoaded = true;
  }

  if (typeof onProductionShiftTasksChanged === 'function') {
    onProductionShiftTasksChanged();
  }
  cards.forEach(card => recalcCardPlanningStage(card.id));
  rebuildCardStoreIndex();
  markLoadedDataScope(normalizedScope);
}

async function __doSingleSave() {
  if (!apiOnline) {
    reportServerConnectionLost('data-save', null, {
      message: 'Сервер недоступен — изменения не сохраняются. Проверьте, что запущен server.js.'
    });
    return false;
  }

  const sanitizeEncodingValue = (value) => {
    if (typeof value === 'string') {
      return value.includes('\uFFFD') ? value.replace(/\uFFFD/g, '').trim() : value;
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) {
        value[i] = sanitizeEncodingValue(value[i]);
      }
      return value;
    }
    if (value && typeof value === 'object') {
      Object.keys(value).forEach(key => {
        value[key] = sanitizeEncodingValue(value[key]);
      });
    }
    return value;
  };

  const payload = {
    cards,
    ops,
    centers,
    areas,
    users,
    accessLevels,
    productionSchedule,
    productionShiftTimes,
    productionShiftTasks,
    productionShifts
  };
  sanitizeEncodingValue(payload);

  noteLegacySnapshotSaveBoundary('saveData');
  const res = await apiFetch(LEGACY_SNAPSHOT_SAVE_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    connectionSource: 'data-save'
  });

  if (!res.ok) {
    throw new Error('Ответ сервера ' + res.status);
  }

  // ВАЖНО: НЕ вызываем loadData() после сохранения.
  // Иначе при частых вызовах saveData() возможен откат состояния (race condition).
  reportServerConnectionOk('data-save');
  return true;
}

let __legacySnapshotBoundaryNoticeShown = false;

function noteLegacySnapshotSaveBoundary(reason = 'saveData') {
  if (__legacySnapshotBoundaryNoticeShown) return;
  __legacySnapshotBoundaryNoticeShown = true;
  console.warn('[DATA] legacy snapshot boundary', {
    writePath: LEGACY_SNAPSHOT_SAVE_PATH,
    reason,
    mode: 'legacy-snapshot-save',
    note: 'Do not add new critical writes to /api/data; use domain endpoints.'
  });
}

async function saveData() {
  // Если сохранение уже идёт — помечаем, что нужно ещё одно сохранение после него,
  // и возвращаем Promise текущего сохранения (чтобы все вызовы ждали завершения очереди).
  if (__saveInFlight) {
    __savePending = true;
    return __saveInFlight;
  }

  __savePending = false;

  __saveInFlight = (async () => {
    try {
      // цикл схлопывания: если во время сохранения попросили сохранить ещё раз — повторяем
      do {
        __savePending = false;
        const saved = await __doSingleSave();
        if (saved === false) {
          apiOnline = false;
          return false;
        }
      } while (__savePending);

      apiOnline = true;
      return true;
    } catch (err) {
      apiOnline = false;
      reportServerConnectionLost('data-save', err, {
        message: 'Не удалось сохранить данные на сервер: ' + err.message
      });
      console.error('Ошибка сохранения данных на сервер', err);
      return false;
    } finally {
      __saveInFlight = null;
    }
  })();

  return __saveInFlight;
}

function ensureDefaults() {
  if (!Array.isArray(areas)) {
    areas = [];
  }
  ensureAreaTypes();
  if (!Array.isArray(productionSchedule)) {
    productionSchedule = [];
  }
  if (!Array.isArray(productionShiftTasks)) {
    productionShiftTasks = [];
  }
  if (!Array.isArray(productionShifts)) {
    productionShifts = [];
  }
  if (!Array.isArray(productionShiftTimes) || !productionShiftTimes.length) {
    productionShiftTimes = getDefaultProductionShiftTimes().map((item, index) => normalizeProductionShiftTimeEntry(item, index + 1));
  }
  if (!centers.length) {
    centers = [
      { id: genId('wc'), name: 'Механическая обработка', desc: 'Токарные и фрезерные операции' },
      { id: genId('wc'), name: 'Покрытия / напыление', desc: 'Покрытия, термическое напыление' },
      { id: genId('wc'), name: 'Контроль качества', desc: 'Измерения, контроль, визуальный осмотр' }
    ];
  }

  if (!ops.length) {
    const used = new Set();
    ops = [
      { id: genId('op'), code: generateUniqueOpCode(used), name: 'Токарная обработка', desc: 'Черновая и чистовая', recTime: 40, operationType: DEFAULT_OPERATION_TYPE },
      { id: genId('op'), code: generateUniqueOpCode(used), name: 'Напыление покрытия', desc: 'HVOF / APS', recTime: 60, operationType: DEFAULT_OPERATION_TYPE },
      { id: genId('op'), code: generateUniqueOpCode(used), name: 'Контроль размеров', desc: 'Измерения, оформление протокола', recTime: 20, operationType: DEFAULT_OPERATION_TYPE }
    ];
  }

  if (!cards.length) {
    const demoId = genId('card');
    const op1 = ops[0];
    const op2 = ops[1];
    const op3 = ops[2];
    const wc1 = centers[0];
    const wc2 = centers[1];
    const wc3 = centers[2];
    cards = [
      {
        id: demoId,
        barcode: '',
        name: 'Вал привода Ø60',
        quantity: 1,
        drawing: 'DWG-001',
        material: 'Сталь',
        orderNo: 'DEMO-001',
        desc: 'Демонстрационная карта для примера.',
        status: APPROVAL_STATUS_REJECTED,
        archived: false,
        attachments: [],
        operations: [
          createRouteOpFromRefs(op1, wc1, 'Иванов И.И.', 40, 1),
          createRouteOpFromRefs(op2, wc2, 'Петров П.П.', 60, 2),
          createRouteOpFromRefs(op3, wc3, 'Сидоров С.С.', 20, 3)
        ]
      }
    ];
  }
}

async function loadData() {
  return loadDataWithScope();
}

async function loadDataWithScope({ scope = DATA_SCOPE_FULL, force = false, reason = 'manual' } = {}) {
  const normalizedScope = normalizeClientDataScope(scope);
  if (!force) {
    if (hasLoadedDataScope(normalizedScope)) {
      console.log('[DATA] scope load skipped', { scope: normalizedScope, reason, state: 'cached' });
      return true;
    }
    if (__dataLoadInFlight.has(normalizedScope)) {
      console.log('[DATA] scope load joined', { scope: normalizedScope, reason });
      return __dataLoadInFlight.get(normalizedScope);
    }
    if (normalizedScope !== DATA_SCOPE_FULL && __dataLoadInFlight.has(DATA_SCOPE_FULL)) {
      console.log('[DATA] scope load joined full', { scope: normalizedScope, reason });
      return __dataLoadInFlight.get(DATA_SCOPE_FULL);
    }
  }

  const requestUrl = normalizedScope === DATA_SCOPE_FULL
    ? LEGACY_SNAPSHOT_READ_PATH
    : LEGACY_SNAPSHOT_READ_PATH + '?scope=' + encodeURIComponent(normalizedScope);

  const promise = (async () => {
    const perfLabel = '[PERF] data:' + normalizedScope;
    const perfStart = performance.now();
    try {
      console.log('[DATA] scope load start', { scope: normalizedScope, reason });
      console.log(perfLabel + ':fetch:start', {
        reason,
        url: requestUrl
      });
      const dataLoadSource = 'data-load:' + normalizedScope;
      const res = await apiFetch(requestUrl, {
        method: 'GET',
        connectionSource: dataLoadSource
      });
      const perfAfterFetch = performance.now();
      console.log(perfLabel + ':fetch:done', {
        reason,
        fetchMs: Math.round(perfAfterFetch - perfStart),
        status: res.status
      });
      if (!res.ok) throw new Error('Ответ сервера ' + res.status);
      const payload = await res.json();
      const perfAfterJson = performance.now();
      console.log(perfLabel + ':json:done', {
        reason,
        jsonMs: Math.round(perfAfterJson - perfAfterFetch),
        totalMs: Math.round(perfAfterJson - perfStart)
      });
      applyLoadedDataPayload(payload, { scope: normalizedScope });
      const perfAfterApply = performance.now();
      console.log(perfLabel + ':apply:done', {
        reason,
        applyMs: Math.round(perfAfterApply - perfAfterJson),
        totalMs: Math.round(perfAfterApply - perfStart)
      });
      apiOnline = true;
      reportServerConnectionOk(dataLoadSource);
      console.log('[DATA] scope load done', { scope: normalizedScope, reason });
      return true;
    } catch (err) {
      const dataLoadSource = 'data-load:' + normalizedScope;
      if (err.message === 'Unauthorized') {
        __securityDataLoaded = false;
        apiOnline = false;
        reportServerConnectionOk(dataLoadSource);
        console.warn('[DATA] scope load unauthorized', { scope: normalizedScope, reason });
        return false;
      }

      console.warn('Не удалось загрузить данные с сервера', { scope: normalizedScope, reason, err });
      apiOnline = false;
      reportServerConnectionLost(dataLoadSource, err, {
        message: 'Нет соединения с сервером: данные будут только в этой сессии'
      });

      if (normalizedScope === DATA_SCOPE_FULL && !cards.length && !ops.length && !centers.length) {
        cards = [];
        ops = [];
        centers = [];
        areas = [];
        ensureDefaults();
      }
      return false;
    } finally {
      __dataLoadInFlight.delete(normalizedScope);
    }
  })();

  __dataLoadInFlight.set(normalizedScope, promise);
  return promise;
}

async function startBackgroundDataHydration(reason = 'background') {
  if (__fullDataHydrated) {
    console.log('[DATA] background hydration skipped', { reason, state: 'full-ready' });
    return true;
  }
  if (__backgroundHydrationPromise) {
    console.log('[DATA] background hydration joined', { reason });
    return __backgroundHydrationPromise;
  }

  console.log('[DATA] background hydration start', { reason });
  __backgroundHydrationPromise = loadDataWithScope({ scope: DATA_SCOPE_FULL, reason: 'background:' + reason })
    .then((ok) => {
      console.log('[DATA] background hydration done', { reason, ok: !!ok });
      return ok;
    })
    .finally(() => {
      __backgroundHydrationPromise = null;
    });

  return __backgroundHydrationPromise;
}

async function loadData() {
  try {
    return loadDataWithScope({ scope: DATA_SCOPE_FULL, reason: 'loadData' });
  } catch (err) {
    console.error('loadData failed', err);
    return false;
  }
}

async function loadSecurityData({ force = false } = {}) {
  if (__securityDataLoaded && !force) {
    return true;
  }
  try {
    const canLoadUsers = typeof canViewTab === 'function' ? canViewTab('users') : true;
    const canLoadAccessLevels = typeof canViewTab === 'function' ? canViewTab('accessLevels') : true;
    const usersRes = canLoadUsers
      ? await apiFetch('/api/security/users', { method: 'GET' })
      : null;
    const levelsRes = canLoadAccessLevels
      ? await apiFetch('/api/security/access-levels', { method: 'GET' })
      : null;
    if (usersRes && usersRes.ok) {
      const payload = await usersRes.json();
      users = Array.isArray(payload.users)
        ? payload.users.map(user => ({
          ...user,
          id: String(user.id).trim(),
          departmentId: user.departmentId == null ? null : String(user.departmentId).trim()
        }))
        : [];
      users.forEach(u => {
        const cached = resolveUserPassword(u);
        if (cached) u.password = cached;
      });
      forgetMissingUserPasswords(users);
      renderUserDatalist();
    }
    if (levelsRes && levelsRes.ok) {
      const payload = await levelsRes.json();
      accessLevels = Array.isArray(payload.accessLevels) ? payload.accessLevels : [];
    }
    __securityDataLoaded = true;
    return true;
  } catch (err) {
    __securityDataLoaded = false;
    console.error('Не удалось загрузить данные доступа', err);
    return false;
  }
}
