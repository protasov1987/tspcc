// === ХРАНИЛИЩЕ ===
let __saveInFlight = null;      // Promise текущего сохранения
let __savePending = false;      // нужно ли повторить сохранение после текущего

async function __doSingleSave() {
  if (!apiOnline) {
    setConnectionStatus('Сервер недоступен — изменения не сохраняются. Проверьте, что запущен server.js.', 'error');
    return;
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
      productionShiftTasks
    })
  });

  if (!res.ok) {
    throw new Error('Ответ сервера ' + res.status);
  }

  // ВАЖНО: НЕ вызываем loadData() после сохранения.
  // Иначе при частых вызовах saveData() возможен откат состояния (race condition).
  setConnectionStatus('', 'info');
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
        await __doSingleSave();
      } while (__savePending);

      apiOnline = true;
    } catch (err) {
      apiOnline = false;
      setConnectionStatus('Не удалось сохранить данные на сервер: ' + err.message, 'error');
      console.error('Ошибка сохранения данных на сервер', err);
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
  if (!Array.isArray(productionSchedule)) {
    productionSchedule = [];
  }
  if (!Array.isArray(productionShiftTasks)) {
    productionShiftTasks = [];
  }
  if (!Array.isArray(productionShiftTimes) || !productionShiftTimes.length) {
    productionShiftTimes = getDefaultProductionShiftTimes();
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
  try {
    const res = await apiFetch(API_ENDPOINT, { method: 'GET' });
    if (!res.ok) throw new Error('Ответ сервера ' + res.status);
    const payload = await res.json();
    cards = Array.isArray(payload.cards) ? payload.cards : [];
    ops = Array.isArray(payload.ops) ? payload.ops : [];
    centers = Array.isArray(payload.centers) ? payload.centers : [];
    areas = Array.isArray(payload.areas) ? payload.areas : [];
    productionSchedule = Array.isArray(payload.productionSchedule) ? payload.productionSchedule : [];
    productionShiftTasks = Array.isArray(payload.productionShiftTasks) ? payload.productionShiftTasks : [];
    productionShiftTimes = Array.isArray(payload.productionShiftTimes) && payload.productionShiftTimes.length
      ? payload.productionShiftTimes
      : getDefaultProductionShiftTimes();
    accessLevels = Array.isArray(payload.accessLevels) ? payload.accessLevels : [];
    users = Array.isArray(payload.users)
      ? payload.users.map(user => ({
        ...user,
        id: String(user.id).trim(),
        departmentId: user.departmentId == null ? null : String(user.departmentId).trim()
      }))
      : [];
    apiOnline = true;
    setConnectionStatus('', 'info');
  } catch (err) {
    if (err.message === 'Unauthorized') {
      apiOnline = false;
      return;
    }
    console.warn('Не удалось загрузить данные с сервера, используем пустые коллекции', err);
    apiOnline = false;
    setConnectionStatus('Нет соединения с сервером: данные будут только в этой сессии', 'error');
    cards = [];
    ops = [];
    centers = [];
    areas = [];
  }

  ensureDefaults();
  ensureOperationCodes();
  ensureOperationTypes();
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
  cards.forEach(card => recalcCardPlanningStage(card.id));
}

async function loadSecurityData() {
  try {
    const [usersRes, levelsRes] = await Promise.all([
      apiFetch('/api/security/users', { method: 'GET' }),
      apiFetch('/api/security/access-levels', { method: 'GET' })
    ]);
    if (usersRes.ok) {
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
    if (levelsRes.ok) {
      const payload = await levelsRes.json();
      accessLevels = Array.isArray(payload.accessLevels) ? payload.accessLevels : [];
    }
  } catch (err) {
    console.error('Не удалось загрузить данные доступа', err);
  }
}
