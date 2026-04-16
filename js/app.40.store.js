// === ХРАНИЛИЩЕ ===
let __saveInFlight = null;      // Promise текущего сохранения
let __savePending = false;      // нужно ли повторить сохранение после текущего
let __securityDataLoaded = false;
let __loadedDataScopes = new Set();
let __fullDataHydrated = false;
let __dataLoadInFlight = new Map();
let __backgroundHydrationPromise = null;
let __cardStoreById = new Map();

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
  if (normalizedScope === DATA_SCOPE_FULL) {
    __fullDataHydrated = true;
    __loadedDataScopes = new Set([
      DATA_SCOPE_FULL,
      DATA_SCOPE_CARDS_BASIC,
      DATA_SCOPE_DIRECTORIES,
      DATA_SCOPE_PRODUCTION
    ]);
    return;
  }
  __loadedDataScopes.add(normalizedScope);
  if (normalizedScope === DATA_SCOPE_PRODUCTION) {
    __loadedDataScopes.add(DATA_SCOPE_CARDS_BASIC);
  }
}

function hasLoadedDataScope(scope) {
  const normalizedScope = normalizeClientDataScope(scope);
  return __fullDataHydrated || __loadedDataScopes.has(normalizedScope);
}

function isFullDataHydrated() {
  return __fullDataHydrated;
}

function isBackgroundHydrationInFlight() {
  return Boolean(__backgroundHydrationPromise);
}

function resetDataHydrationState() {
  __loadedDataScopes = new Set();
  __fullDataHydrated = false;
  __dataLoadInFlight = new Map();
  __backgroundHydrationPromise = null;
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
    setConnectionStatus('Сервер недоступен — изменения не сохраняются. Проверьте, что запущен server.js.', 'error');
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

  const res = await apiFetch(API_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    throw new Error('Ответ сервера ' + res.status);
  }

  // ВАЖНО: НЕ вызываем loadData() после сохранения.
  // Иначе при частых вызовах saveData() возможен откат состояния (race condition).
  setConnectionStatus('', 'info');
  return true;
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
      setConnectionStatus('Не удалось сохранить данные на сервер: ' + err.message, 'error');
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
    ? API_ENDPOINT
    : API_ENDPOINT + '?scope=' + encodeURIComponent(normalizedScope);

  const promise = (async () => {
    const perfLabel = '[PERF] data:' + normalizedScope;
    const perfStart = performance.now();
    try {
      console.log('[DATA] scope load start', { scope: normalizedScope, reason });
      console.log(perfLabel + ':fetch:start', {
        reason,
        url: requestUrl
      });
      const res = await apiFetch(requestUrl, { method: 'GET' });
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
      setConnectionStatus('', 'info');
      console.log('[DATA] scope load done', { scope: normalizedScope, reason });
      return true;
    } catch (err) {
      if (err.message === 'Unauthorized') {
        __securityDataLoaded = false;
        apiOnline = false;
        console.warn('[DATA] scope load unauthorized', { scope: normalizedScope, reason });
        return false;
      }

      console.warn('Не удалось загрузить данные с сервера', { scope: normalizedScope, reason, err });
      apiOnline = false;
      setConnectionStatus('Нет соединения с сервером: данные будут только в этой сессии', 'error');

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
