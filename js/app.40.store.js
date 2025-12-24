// === ХРАНИЛИЩЕ ===
async function saveData() {
  try {
    if (!apiOnline) {
      setConnectionStatus('Сервер недоступен — изменения не сохраняются. Проверьте, что запущен server.js.', 'error');
      return;
    }

    const res = await apiFetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cards, ops, centers })
    });
    if (!res.ok) {
      throw new Error('Ответ сервера ' + res.status);
    }
    await loadData();
    setConnectionStatus('', 'info');
  } catch (err) {
    apiOnline = false;
    setConnectionStatus('Не удалось сохранить данные на сервер: ' + err.message, 'error');
    console.error('Ошибка сохранения данных на сервер', err);
  }
}

function ensureDefaults() {
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
        status: 'NOT_STARTED',
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
    accessLevels = Array.isArray(payload.accessLevels) ? payload.accessLevels : [];
    users = Array.isArray(payload.users) ? payload.users : [];
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
  }

  ensureDefaults();
  ensureOperationCodes();
  ensureOperationTypes();
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
}

async function loadSecurityData() {
  try {
    const [usersRes, levelsRes] = await Promise.all([
      apiFetch('/api/security/users', { method: 'GET' }),
      apiFetch('/api/security/access-levels', { method: 'GET' })
    ]);
    if (usersRes.ok) {
      const payload = await usersRes.json();
      users = Array.isArray(payload.users) ? payload.users : [];
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
