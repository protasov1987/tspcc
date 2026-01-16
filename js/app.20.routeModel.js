// === МОДЕЛЬ ОПЕРАЦИИ МАРШРУТА ===
function createRouteOpFromRefs(op, center, executor, plannedMinutes, order, options = {}) {
  const { code, autoCode = false, quantity, isSamples = false, card = null } = options;
  const opData = {
    id: genId('rop'),
    opId: op.id,
    opCode: code || op.code || op.opCode || generateUniqueOpCode(collectUsedOpCodes()),
    opName: op.name,
    operationType: normalizeOperationType(op.operationType),
    centerId: center.id,
    centerName: center.name,
    executor: executor || '',
    plannedMinutes: plannedMinutes || op.recTime || 30,
    quantity: quantity === '' || quantity == null ? '' : toSafeCount(quantity),
    autoCode,
    additionalExecutors: Array.isArray(op.additionalExecutors)
      ? op.additionalExecutors.slice(0, 2)
      : [],
    status: 'NOT_STARTED',
    firstStartedAt: null,
    startedAt: null,
    lastPausedAt: null,
    finishedAt: null,
    actualSeconds: null,
    elapsedSeconds: 0,
    order: order || 1,
    comment: '',
    goodCount: 0,
    scrapCount: 0,
    holdCount: 0,
    isSamples: Boolean(isSamples)
  };
  if (card && card.cardType === 'MKI') {
    opData.quantity = computeMkiOperationQuantity(opData, card);
  }
  return opData;
}

function recalcCardStatus(card) {
  const state = getCardProcessState(card, { includeArchivedChildren: !!card.archived });
  if (!state) return;
  const processStatus = state.key || 'NOT_STARTED';
  const normalizedStatus = processStatus === 'MIXED' ? 'PAUSED' : processStatus;
  card.status = normalizedStatus;
  return normalizedStatus;
}

function statusBadge(status) {
  if (status === 'IN_PROGRESS') return '<span class="badge status-in-progress">В работе</span>';
  if (status === 'PAUSED') return '<span class="badge status-paused">Пауза</span>';
  if (status === 'DONE') return '<span class="badge status-done">Завершена</span>';
  return '<span class="badge status-not-started">Не начата</span>';
}

function cardStatusText(card) {
  const opsArr = card.operations || [];

  const hasStartedOrDoneOrPaused = opsArr.some(o =>
    o.status === 'IN_PROGRESS' || o.status === 'DONE' || o.status === 'PAUSED'
  );
  if (!opsArr.length || !hasStartedOrDoneOrPaused) {
    return 'Не запущена';
  }

  const inProgress = opsArr.find(o => o.status === 'IN_PROGRESS');
  if (inProgress) {
    const sec = getOperationElapsedSeconds(inProgress);
    return formatOpLabel(inProgress) + ' (' + formatSecondsToHMS(sec) + ')';
  }

  const paused = opsArr.find(o => o.status === 'PAUSED');
  if (paused) {
    const sec = getOperationElapsedSeconds(paused);
    return formatOpLabel(paused) + ' (пауза ' + formatSecondsToHMS(sec) + ')';
  }

  const allDone = opsArr.length > 0 && opsArr.every(o => o.status === 'DONE');
  if (allDone) {
    return 'Завершена';
  }

  const hasDone = opsArr.some(o => o.status === 'DONE');
  const hasNotStarted = opsArr.some(o => o.status === 'NOT_STARTED' || !o.status);
  if (hasDone && hasNotStarted) {
    return 'Пауза';
  }

  const notStartedOps = opsArr.filter(o => o.status === 'NOT_STARTED' || !o.status);
  if (notStartedOps.length) {
    let next = notStartedOps[0];
    notStartedOps.forEach(o => {
      const curOrder = typeof next.order === 'number' ? next.order : 999999;
      const newOrder = typeof o.order === 'number' ? o.order : 999999;
      if (newOrder < curOrder) next = o;
    });
    return formatOpLabel(next) + ' (ожидание)';
  }

  return 'Не запущена';
}

function getCardProcessState(card, { includeArchivedChildren = false } = {}) {
  const opsArr = card.operations || [];
  const hasInProgress = opsArr.some(o => o.status === 'IN_PROGRESS');
  const hasPaused = opsArr.some(o => o.status === 'PAUSED');
  const allDone = opsArr.length > 0 && opsArr.every(o => o.status === 'DONE');
  const allNotStarted = opsArr.length > 0 && opsArr.every(o => o.status === 'NOT_STARTED' || !o.status);
  const hasAnyDone = opsArr.some(o => o.status === 'DONE');
  const hasNotStarted = opsArr.some(o => o.status === 'NOT_STARTED' || !o.status);

  if (allDone) return { key: 'DONE', label: 'Выполнено', className: 'done' };
  if (hasInProgress && hasPaused) return { key: 'MIXED', label: 'Смешанно', className: 'mixed' };
  if (hasInProgress) return { key: 'IN_PROGRESS', label: 'Выполняется', className: 'in-progress' };
  if (hasPaused) return { key: 'PAUSED', label: 'Пауза', className: 'paused' };
  if (hasAnyDone && hasNotStarted) return { key: 'PAUSED', label: 'Пауза', className: 'paused' };
  if (allNotStarted) return { key: 'NOT_STARTED', label: 'Не запущена', className: 'not-started' };
  if (hasAnyDone) return { key: 'IN_PROGRESS', label: 'Выполняется', className: 'in-progress' };
  return { key: 'NOT_STARTED', label: 'Не запущена', className: 'not-started' };
}

function cardHasMissingExecutors(card) {
  const opsArr = card.operations || [];
  return opsArr.some(op => {
    const mainMissing = !op.executor || !String(op.executor).trim();
    const additionalMissing = Array.isArray(op.additionalExecutors)
      ? op.additionalExecutors.some(ex => !ex || !String(ex).trim())
      : false;
    return mainMissing || additionalMissing;
  });
}

function renderCardStateBadge(card, options) {
  const state = getCardProcessState(card, options);
  if (state.key === 'DONE') {
    return '<span class="status-pill status-pill-done" title="Выполнено">✓</span>';
  }
  if (state.key === 'MIXED') {
    return '<span class="status-pill status-pill-mixed" title="Смешанный статус">Смешанно</span>';
  }
  return '<span class="status-pill status-pill-' + state.className + '">' + state.label + '</span>';
}

function getCardComment(card) {
  const opsArr = card.operations || [];
  const priority = ['IN_PROGRESS', 'PAUSED', 'DONE', 'NOT_STARTED'];
  for (const status of priority) {
    const found = opsArr.find(o => o.status === status && o.comment);
    if (found) return found.comment;
  }
  const fallback = opsArr.find(o => o.comment);
  return fallback ? fallback.comment : '';
}

function formatOpLabel(op) {
  const name = op.opName || op.name || '';
  const code = op.opCode || op.code || '';
  return name || code;
}

function renderOpLabel(op) {
  return escapeHtml(formatOpLabel(op));
}

function renderOpName(op, options = {}) {
  const name = op.opName || op.name || '';
  const cardType = options.cardType || (options.card ? options.card.cardType : null);
  const type = normalizeOperationType(op.operationType);
  const shouldShowType = cardType === 'MKI' && type !== DEFAULT_OPERATION_TYPE;
  const typeHtml = shouldShowType
    ? '<div class="op-type-tag">[' + escapeHtml(type) + ']</div>'
    : '';
  return escapeHtml(name) + typeHtml;
}

function collectUsedOpCodes() {
  const used = new Set();
  ops.forEach(o => {
    if (o.code) used.add(o.code);
  });
  cards.forEach(card => {
    (card.operations || []).forEach(op => {
      if (op.opCode) used.add(op.opCode);
    });
  });
  return used;
}

function ensureOperationCodes() {
  const used = collectUsedOpCodes();
  ops = ops.map(op => {
    const next = { ...op };
    if (!next.code || used.has(next.code)) {
      next.code = generateUniqueOpCode(used);
    }
    used.add(next.code);
    return next;
  });

  const opMap = Object.fromEntries(ops.map(op => [op.id, op]));
  cards = cards.map(card => {
    const clonedCard = { ...card };
    clonedCard.operations = (clonedCard.operations || []).map(op => {
      const next = { ...op };
      const source = next.opId ? opMap[next.opId] : null;
      const isAuto = next.autoCode === true;

      const hasManualCode = typeof next.opCode === 'string'
        ? next.opCode.trim().length > 0
        : Boolean(next.opCode);

      if (!hasManualCode) {
        if (isAuto && source && source.code) {
          next.opCode = source.code;
        }

        if (!next.opCode) {
          next.opCode = generateUniqueOpCode(used);
        }
      }

      if (next.opCode) {
        used.add(next.opCode);
      }
      return next;
    });
    return clonedCard;
  });
}

function ensureOperationTypes() {
  ops = (ops || []).map(op => ({ ...op, operationType: normalizeOperationType(op.operationType) }));
  const typeMap = Object.fromEntries((ops || []).map(op => [op.id, op.operationType]));

  const apply = card => {
    if (!card || !Array.isArray(card.operations)) return;
    card.operations = card.operations.map(op => {
      const next = { ...op };
      const refType = next.opId ? typeMap[next.opId] : null;
      next.operationType = normalizeOperationType(refType || next.operationType);
      return next;
    });
  };

  cards.forEach(apply);
  if (activeCardDraft) apply(activeCardDraft);
}

function ensureOperationAllowedAreas() {
  const normalize = typeof normalizeAllowedAreaIds === 'function'
    ? normalizeAllowedAreaIds
    : (value) => {
      if (!Array.isArray(value)) return [];
      return value.map(v => String(v).trim()).filter(Boolean);
    };

  ops.forEach(op => {
    op.allowedAreaIds = normalize(op.allowedAreaIds);
  });
}
