// === ХРАНИЛИЩЕ ===
let __saveInFlight = null;      // Promise текущего сохранения
let __savePending = false;      // нужно ли повторить сохранение после текущего
let bootstrapDataLoaded = false;
let cardsDataLoaded = false;
let securityDataLoaded = false;
let fullDataLoaded = false;

function resetClientDataLoadFlags() {
  bootstrapDataLoaded = false;
  cardsDataLoaded = false;
  securityDataLoaded = false;
  fullDataLoaded = false;
}

function normalizeUsersPayload(rawUsers) {
  return Array.isArray(rawUsers)
    ? rawUsers.map(user => ({
      ...user,
      id: String(user.id).trim(),
      departmentId: user.departmentId == null ? null : String(user.departmentId).trim()
    }))
    : [];
}

function applyDataPayload(payload = {}) {
  if (Object.prototype.hasOwnProperty.call(payload, 'cards')) {
    cards = Array.isArray(payload.cards) ? payload.cards : [];
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'ops')) {
    ops = Array.isArray(payload.ops) ? payload.ops : [];
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'centers')) {
    centers = Array.isArray(payload.centers) ? payload.centers : [];
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'areas')) {
    areas = Array.isArray(payload.areas) ? payload.areas.map(area => normalizeArea(area)) : [];
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'productionSchedule')) {
    productionSchedule = Array.isArray(payload.productionSchedule) ? payload.productionSchedule : [];
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'productionShiftTasks')) {
    productionShiftTasks = Array.isArray(payload.productionShiftTasks) ? payload.productionShiftTasks : [];
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'productionShifts')) {
    productionShifts = Array.isArray(payload.productionShifts) ? payload.productionShifts : [];
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'productionShiftTimes')) {
    productionShiftTimes = Array.isArray(payload.productionShiftTimes) && payload.productionShiftTimes.length
      ? payload.productionShiftTimes.map((item, index) => normalizeProductionShiftTimeEntry(item, index + 1))
      : getDefaultProductionShiftTimes().map((item, index) => normalizeProductionShiftTimeEntry(item, index + 1));
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'accessLevels')) {
    accessLevels = Array.isArray(payload.accessLevels) ? payload.accessLevels : [];
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'users')) {
    users = normalizeUsersPayload(payload.users);
  }
}

function finalizeLoadedData() {
  ensureDefaults();
  ensureOperationCodes();
  ensureOperationTypes();
  ensureAreaTypes();
  ensureOperationAllowedAreas();
  ensureUniqueQrIds(cards);
  ensureUniqueBarcodes(cards);
  if (typeof renderUserDatalist === 'function') {
    renderUserDatalist();
  }

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
  if (typeof onProductionShiftTasksChanged === 'function') {
    onProductionShiftTasksChanged();
  }
  cards.forEach(card => recalcCardPlanningStage(card.id));
}

async function loadBootstrapData({ force = false } = {}) {
  if (bootstrapDataLoaded && !force) return true;
  try {
    const res = await apiFetch('/api/bootstrap', {
      method: 'GET',
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    });
    if (!res.ok) throw new Error('Ответ сервера ' + res.status);
    const payload = await res.json();
    if (payload && payload.user) {
      currentUser = payload.user;
    }
    if (payload && payload.csrfToken) {
      setCsrfToken(payload.csrfToken);
    }
    window.__appBootstrap = payload?.bootstrap || null;
    apiOnline = true;
    bootstrapDataLoaded = true;
    setConnectionStatus('', 'info');
    return true;
  } catch (err) {
    if (err.message === 'Unauthorized') {
      apiOnline = false;
      return false;
    }
    apiOnline = false;
    console.warn('Не удалось загрузить bootstrap-данные', err);
    setConnectionStatus('Нет соединения с сервером: данные будут только в этой сессии', 'error');
    return false;
  }
}

async function loadCardsData({ force = false } = {}) {
  if ((cardsDataLoaded || fullDataLoaded) && !force) return true;
  try {
    const res = await apiFetch('/api/cards-bootstrap', {
      method: 'GET',
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    });
    if (!res.ok) throw new Error('Ответ сервера ' + res.status);
    const payload = await res.json();
    applyDataPayload(payload);
    apiOnline = true;
    cardsDataLoaded = true;
    setConnectionStatus('', 'info');
  } catch (err) {
    if (err.message === 'Unauthorized') {
      apiOnline = false;
      return false;
    }
    console.warn('Не удалось загрузить карточные данные', err);
    apiOnline = false;
    setConnectionStatus('Нет соединения с сервером: данные будут только в этой сессии', 'error');
    cards = [];
    ops = [];
    centers = [];
    areas = [];
  }

  finalizeLoadedData();
  return apiOnline;
}

async function __doSingleSave() {
  if (!apiOnline) {
    setConnectionStatus('Сервер недоступен — изменения не сохраняются. Проверьте, что запущен server.js.', 'error');
    return false;
  }

  const res = await apiFetch(API_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
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
    })
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

async function loadData({ force = true } = {}) {
  if (fullDataLoaded && !force) {
    apiOnline = true;
    setConnectionStatus('', 'info');
    return true;
  }
  try {
    const res = await apiFetch(API_ENDPOINT, {
      method: 'GET',
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    });
    if (!res.ok) throw new Error('Ответ сервера ' + res.status);
    const payload = await res.json();
    applyDataPayload(payload);
    apiOnline = true;
    cardsDataLoaded = true;
    securityDataLoaded = true;
    bootstrapDataLoaded = true;
    fullDataLoaded = true;
    setConnectionStatus('', 'info');
  } catch (err) {
    if (err.message === 'Unauthorized') {
      apiOnline = false;
      return false;
    }
    console.warn('Не удалось загрузить данные с сервера, используем пустые коллекции', err);
    apiOnline = false;
    setConnectionStatus('Нет соединения с сервером: данные будут только в этой сессии', 'error');
    cards = [];
    ops = [];
    centers = [];
    areas = [];
  }

  finalizeLoadedData();
  return apiOnline;
}

async function loadSecurityData({ force = true } = {}) {
  if ((securityDataLoaded || fullDataLoaded) && currentUser && !force) return true;
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
      users = normalizeUsersPayload(payload.users);
      users.forEach(u => {
        const cached = resolveUserPassword(u);
        if (cached) u.password = cached;
      });
      forgetMissingUserPasswords(users);
      if (typeof renderUserDatalist === 'function') {
        renderUserDatalist();
      }
    }
    if (levelsRes && levelsRes.ok) {
      const payload = await levelsRes.json();
      accessLevels = Array.isArray(payload.accessLevels) ? payload.accessLevels : [];
    }
    securityDataLoaded = true;
    return true;
  } catch (err) {
    console.error('Не удалось загрузить данные доступа', err);
    return false;
  }
}
