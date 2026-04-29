const fs = require('fs');
const path = require('path');

function trimToString(value) {
  if (value == null) return '';
  return (typeof value === 'string' ? value : String(value)).trim();
}

function normalizeQrId(value) {
  return trimToString(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function isValidQrId(value) {
  return /^[A-Z0-9]{6,32}$/.test(trimToString(value));
}

function createSummary(card) {
  return {
    cardId: trimToString(card?.id),
    qrIds: [],
    attachmentIds: [],
    routeOpIds: [],
    productionShiftTaskIds: [],
    cardsRemoved: 0,
    productionShiftTasksRemoved: 0,
    productionShiftCloseDraftRowsRemoved: 0,
    productionShiftCloseSnapshotRowsRemoved: 0,
    productionShiftCloseSnapshotHistoryRowsRemoved: 0,
    productionShiftCloseOperationFactsRemoved: 0,
    productionShiftInitialSnapshotTasksRemoved: 0,
    productionShiftLogsRemoved: 0,
    userActionsRemoved: 0,
    chatMessagesRemoved: 0,
    chatConversationsUpdated: 0,
    storageFoldersRemoved: 0,
    storageFolderErrors: 0
  };
}

function addSetValue(set, value) {
  const normalized = trimToString(value);
  if (normalized) set.add(normalized);
}

function buildRefs(card, draft) {
  const cardIds = new Set();
  const qrIds = new Set();
  const routeCardNumbers = new Set();
  const routeOpIds = new Set();
  const attachmentIds = new Set();
  const attachmentRelPaths = new Set();
  const taskIds = new Set();

  addSetValue(cardIds, card?.id);
  addSetValue(routeCardNumbers, card?.routeCardNumber);
  addSetValue(routeCardNumbers, card?.name);

  [card?.qrId, card?.barcode].forEach(value => {
    const normalized = normalizeQrId(value);
    if (isValidQrId(normalized)) qrIds.add(normalized);
  });

  (Array.isArray(card?.operations) ? card.operations : []).forEach(op => {
    addSetValue(routeOpIds, op?.id);
    addSetValue(routeOpIds, op?.routeOpId);
  });

  (Array.isArray(card?.attachments) ? card.attachments : []).forEach(file => {
    addSetValue(attachmentIds, file?.id);
    addSetValue(attachmentRelPaths, file?.relPath);
  });
  addSetValue(attachmentIds, card?.inputControlFileId);

  (Array.isArray(draft?.productionShiftTasks) ? draft.productionShiftTasks : []).forEach(task => {
    if (trimToString(task?.cardId) !== trimToString(card?.id)) return;
    addSetValue(taskIds, task?.id);
    addSetValue(routeOpIds, task?.routeOpId);
  });

  return {
    cardIds,
    qrIds,
    routeCardNumbers,
    routeOpIds,
    attachmentIds,
    attachmentRelPaths,
    taskIds
  };
}

function valueInSet(value, set, normalizer = trimToString) {
  const normalized = normalizer(value);
  return Boolean(normalized && set.has(normalized));
}

function fieldMatchesReference(key, value, refs) {
  const normalizedKey = trimToString(key).toLowerCase();
  if (!normalizedKey) return false;

  if (/(^|_)(cardid|card_id|deletedcardid|sourcecardid)$/.test(normalizedKey)) {
    return valueInSet(value, refs.cardIds);
  }
  if (/(^|_)(qrid|qr_id|qr|barcode)$/.test(normalizedKey)) {
    return valueInSet(value, refs.qrIds, normalizeQrId);
  }
  if (/(routecardnumber|route_card_number|cardnumber|route_no|routeno)/.test(normalizedKey)) {
    return valueInSet(value, refs.routeCardNumbers);
  }
  if (/(^|_)(taskid|task_id|productionshifttaskid|production_shift_task_id)$/.test(normalizedKey)) {
    return valueInSet(value, refs.taskIds);
  }
  if (/(^|_)(routeopid|route_op_id)$/.test(normalizedKey)) {
    return valueInSet(value, refs.routeOpIds);
  }
  if (/(attachmentid|attachment_id|fileid|file_id|inputcontrolfileid|input_control_file_id)/.test(normalizedKey)) {
    return valueInSet(value, refs.attachmentIds);
  }
  if (/(relpath|rel_path|filepath|file_path)/.test(normalizedKey)) {
    return valueInSet(value, refs.attachmentRelPaths);
  }
  return false;
}

function textContainsStableReference(value, refs) {
  const text = trimToString(value);
  if (!text) return false;
  const lower = text.toLowerCase();
  const containsAny = (set, normalizer = trimToString) => {
    for (const ref of set) {
      const needle = normalizer(ref);
      if (needle && lower.includes(needle.toLowerCase())) return true;
    }
    return false;
  };

  if (containsAny(refs.cardIds)) return true;
  if (containsAny(refs.qrIds)) return true;
  if (containsAny(refs.taskIds)) return true;
  if (containsAny(refs.routeOpIds)) return true;
  if (containsAny(refs.attachmentIds)) return true;
  if (containsAny(refs.attachmentRelPaths)) return true;

  for (const routeNo of refs.routeCardNumbers) {
    const normalized = trimToString(routeNo);
    if (!normalized || normalized.length < 3) continue;
    const idx = lower.indexOf(normalized.toLowerCase());
    if (idx < 0) continue;
    const window = lower.slice(Math.max(0, idx - 32), Math.min(lower.length, idx + normalized.length + 32));
    if (/(\bmk\b|мк|маршрут|карт)/i.test(window)) return true;
  }
  return false;
}

function objectHasReference(value, refs, { allowText = false } = {}) {
  if (!value || typeof value !== 'object') return false;
  const stack = [value];
  const seen = new Set();
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    for (const [key, entryValue] of Object.entries(current)) {
      if (fieldMatchesReference(key, entryValue, refs)) return true;
      if (allowText && typeof entryValue === 'string' && textContainsStableReference(entryValue, refs)) return true;
      if (entryValue && typeof entryValue === 'object') stack.push(entryValue);
    }
  }
  return false;
}

function rowMatchesReference(row, refs, rowKey = '') {
  if (objectHasReference(row, refs, { allowText: false })) return true;
  return textContainsStableReference(rowKey, refs);
}

function cleanupRowsArray(rows, refs) {
  const source = Array.isArray(rows) ? rows : [];
  const next = source.filter(row => !rowMatchesReference(row, refs, trimToString(row?.key)));
  return { rows: next, removed: source.length - next.length };
}

function cleanupRowsObject(rows, refs) {
  if (!rows || typeof rows !== 'object' || Array.isArray(rows)) {
    return { rows: {}, removed: 0 };
  }
  const next = {};
  let removed = 0;
  Object.entries(rows).forEach(([key, row]) => {
    if (rowMatchesReference(row, refs, key)) {
      removed += 1;
      return;
    }
    next[key] = row;
  });
  return { rows: next, removed };
}

function cleanupOperationFacts(operationFacts, refs) {
  if (!operationFacts || typeof operationFacts !== 'object' || Array.isArray(operationFacts)) {
    return { operationFacts, removed: 0 };
  }
  const next = {};
  let removed = 0;
  Object.entries(operationFacts).forEach(([key, value]) => {
    if (textContainsStableReference(key, refs) || objectHasReference(value, refs, { allowText: false })) {
      removed += 1;
      return;
    }
    next[key] = value;
  });
  return { operationFacts: next, removed };
}

function cleanupCloseSnapshot(snapshot, refs) {
  if (!snapshot || typeof snapshot !== 'object') {
    return { rowsRemoved: 0, operationFactsRemoved: 0, changed: false };
  }
  const rowCleanup = cleanupRowsArray(snapshot.rows, refs);
  const factCleanup = cleanupOperationFacts(snapshot.operationFacts, refs);
  if (rowCleanup.removed > 0) snapshot.rows = rowCleanup.rows;
  if (factCleanup.removed > 0) snapshot.operationFacts = factCleanup.operationFacts;
  return {
    rowsRemoved: rowCleanup.removed,
    operationFactsRemoved: factCleanup.removed,
    changed: rowCleanup.removed > 0 || factCleanup.removed > 0
  };
}

function updateConversationPreviews(draft, removedMessageIds) {
  if (!removedMessageIds.size || !Array.isArray(draft.chatConversations)) return 0;
  const messages = Array.isArray(draft.chatMessages) ? draft.chatMessages : [];
  let updated = 0;
  draft.chatConversations.forEach(conversation => {
    if (!conversation || !removedMessageIds.has(trimToString(conversation.lastMessageId))) return;
    const remaining = messages
      .filter(message => trimToString(message?.conversationId) === trimToString(conversation.id))
      .sort((a, b) => {
        const seqDelta = Number(a?.seq || 0) - Number(b?.seq || 0);
        if (seqDelta !== 0) return seqDelta;
        return new Date(a?.createdAt || 0).getTime() - new Date(b?.createdAt || 0).getTime();
      });
    const last = remaining[remaining.length - 1] || null;
    conversation.lastMessageId = last?.id || null;
    conversation.lastMessageAt = last?.createdAt || null;
    conversation.lastMessagePreview = last?.text ? trimToString(last.text).slice(0, 120) : null;
    updated += 1;
  });
  return updated;
}

function applyCardDeletionCascade(draft, card) {
  const summary = createSummary(card);
  const cardId = trimToString(card?.id);
  if (!draft || typeof draft !== 'object' || !cardId) return summary;

  const refs = buildRefs(card, draft);
  summary.qrIds = Array.from(refs.qrIds);
  summary.attachmentIds = Array.from(refs.attachmentIds);
  summary.routeOpIds = Array.from(refs.routeOpIds);
  summary.productionShiftTaskIds = Array.from(refs.taskIds);

  const cardsBefore = Array.isArray(draft.cards) ? draft.cards.length : 0;
  draft.cards = (Array.isArray(draft.cards) ? draft.cards : []).filter(item => trimToString(item?.id) !== cardId);
  summary.cardsRemoved = Math.max(0, cardsBefore - draft.cards.length);

  const tasksBefore = Array.isArray(draft.productionShiftTasks) ? draft.productionShiftTasks.length : 0;
  draft.productionShiftTasks = (Array.isArray(draft.productionShiftTasks) ? draft.productionShiftTasks : []).filter(task => (
    !rowMatchesReference(task, refs, trimToString(task?.id))
  ));
  summary.productionShiftTasksRemoved = Math.max(0, tasksBefore - draft.productionShiftTasks.length);

  (Array.isArray(draft.productionShifts) ? draft.productionShifts : []).forEach(shift => {
    if (!shift || typeof shift !== 'object') return;

    if (shift.closePageDraft && typeof shift.closePageDraft === 'object') {
      const cleanup = cleanupRowsObject(shift.closePageDraft.rows, refs);
      if (cleanup.removed > 0) {
        shift.closePageDraft.rows = cleanup.rows;
        summary.productionShiftCloseDraftRowsRemoved += cleanup.removed;
      }
    }

    const snapshotCleanup = cleanupCloseSnapshot(shift.closePageSnapshot, refs);
    summary.productionShiftCloseSnapshotRowsRemoved += snapshotCleanup.rowsRemoved;
    summary.productionShiftCloseOperationFactsRemoved += snapshotCleanup.operationFactsRemoved;

    if (Array.isArray(shift.closePageSnapshotHistory)) {
      shift.closePageSnapshotHistory.forEach(snapshot => {
        const historyCleanup = cleanupCloseSnapshot(snapshot, refs);
        summary.productionShiftCloseSnapshotHistoryRowsRemoved += historyCleanup.rowsRemoved;
        summary.productionShiftCloseOperationFactsRemoved += historyCleanup.operationFactsRemoved;
      });
    }

    if (shift.initialSnapshot && typeof shift.initialSnapshot === 'object' && Array.isArray(shift.initialSnapshot.tasks)) {
      const cleanup = cleanupRowsArray(shift.initialSnapshot.tasks, refs);
      if (cleanup.removed > 0) {
        shift.initialSnapshot.tasks = cleanup.rows;
        summary.productionShiftInitialSnapshotTasksRemoved += cleanup.removed;
      }
    }

    if (Array.isArray(shift.logs)) {
      const before = shift.logs.length;
      shift.logs = shift.logs.filter(log => !objectHasReference(log, refs, { allowText: true }));
      summary.productionShiftLogsRemoved += Math.max(0, before - shift.logs.length);
    }
  });

  if (Array.isArray(draft.userActions)) {
    const before = draft.userActions.length;
    draft.userActions = draft.userActions.filter(entry => !objectHasReference(entry, refs, { allowText: true }));
    summary.userActionsRemoved = Math.max(0, before - draft.userActions.length);
  }

  if (Array.isArray(draft.chatMessages)) {
    const removedIds = new Set();
    const before = draft.chatMessages.length;
    draft.chatMessages = draft.chatMessages.filter(message => {
      const remove = objectHasReference(message, refs, { allowText: true });
      if (remove) addSetValue(removedIds, message?.id);
      return !remove;
    });
    summary.chatMessagesRemoved = Math.max(0, before - draft.chatMessages.length);
    summary.chatConversationsUpdated = updateConversationPreviews(draft, removedIds);
  }

  return summary;
}

function removeCardDeletionStorageFolders(summary, { cardsStorageDir, fsImpl = fs, pathImpl = path } = {}) {
  const result = {
    storageFoldersRemoved: 0,
    storageFolderErrors: 0
  };
  const baseDir = trimToString(cardsStorageDir);
  if (!baseDir) return result;
  const qrIds = Array.isArray(summary?.qrIds) ? summary.qrIds : [];
  qrIds.forEach(qr => {
    const safe = normalizeQrId(qr);
    if (!isValidQrId(safe)) return;
    const target = pathImpl.resolve(baseDir, safe);
    const base = pathImpl.resolve(baseDir);
    if (target !== base && !target.startsWith(base + pathImpl.sep)) {
      result.storageFolderErrors += 1;
      return;
    }
    try {
      const existed = fsImpl.existsSync(target);
      fsImpl.rmSync(target, { recursive: true, force: true });
      if (existed) result.storageFoldersRemoved += 1;
    } catch (err) {
      result.storageFolderErrors += 1;
    }
  });
  return result;
}

module.exports = {
  applyCardDeletionCascade,
  removeCardDeletionStorageFolders
};
