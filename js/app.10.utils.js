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

function wrapTable(tableHtml) {
  return '<div class="table-wrapper">' + tableHtml + '</div>';
}

function normalizeOperationType(value) {
  const raw = (value || '').toString().trim();
  if (!raw) return DEFAULT_OPERATION_TYPE;
  const matched = OPERATION_TYPE_OPTIONS.find(option => option.toLowerCase() === raw.toLowerCase());
  return matched || DEFAULT_OPERATION_TYPE;
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
function getOperationElapsedSeconds(op) {
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

function canViewTab(tabKey) {
  const perms = getUserPermissions();
  if (!perms) return true;
  const tab = perms.tabs && perms.tabs[tabKey];
  return tab ? !!tab.view : true;
}

function canEditTab(tabKey) {
  const perms = getUserPermissions();
  if (!perms) return true;
  const tab = perms.tabs && perms.tabs[tabKey];
  return tab ? !!tab.edit : false;
}

function isTabReadonly(tabKey) {
  return canViewTab(tabKey) && !canEditTab(tabKey);
}

function isApprovalStatus(value) {
  return value === APPROVAL_STATUS_APPROVED || value === APPROVAL_STATUS_REJECTED;
}

function normalizeApprovalStatus(value, fallback = APPROVAL_STATUS_REJECTED) {
  return isApprovalStatus(value) ? value : fallback;
}

function isCardApprovalBlocked(card) {
  return card && card.status === APPROVAL_STATUS_REJECTED;
}

function applyReadonlyState(tabKey, sectionId) {
  const section = document.getElementById(sectionId);
  if (!section) return;
  const readonly = isTabReadonly(tabKey);
  section.classList.toggle('tab-readonly', readonly);

  const controls = section.querySelectorAll('input, select, textarea, button');
  controls.forEach(ctrl => {
    const allowView = ctrl.dataset.allowView === 'true';
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

function isGroupCard(card) {
  return Boolean(card && card.isGroup);
}

function getCardBarcodeValue(card) {
  if (!card) return '';
  if (isGroupCard(card)) return String(card.barcode || '').trim();
  const rc = (card.routeCardNumber || '').trim();
  if (rc) return rc;
  return String(card.barcode || '').trim();
}

function getGroupChildren(group) {
  if (!group) return [];
  return cards.filter(c => c.groupId === group.id);
}

function getActiveGroupChildren(group) {
  return getGroupChildren(group).filter(c => !c.archived);
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

function normalizeSerialInput(value) {
  if (Array.isArray(value)) return value.map(v => (v == null ? '' : String(v).trim()));
  if (typeof value === 'string') {
    return value.split(/\r?\n|,/).map(v => v.trim());
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
      result.push(val == null ? '' : String(val));
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

function formatCardNameWithGroupPosition(card, { includeArchivedSiblings = false } = {}) {
  if (!card) return '';

  const baseName = formatCardTitle(card) || card.id || '';
  if (!card.groupId) return escapeHtml(baseName);

  const siblings = cards.filter(c => c.groupId === card.groupId && (includeArchivedSiblings || !c.archived));
  let displayName = baseName;
  let position = null;

  const nameMatch = /^\s*(\d+)\.\s*(.*)$/.exec(displayName || '');
  if (nameMatch) {
    position = toSafeCount(nameMatch[1]);
    displayName = nameMatch[2] || '';
  }

  if (!position && siblings.length) {
    const idx = siblings.findIndex(c => c.id === card.id);
    position = idx >= 0 ? idx + 1 : null;
  }

  const total = siblings.length || null;
  const prefix = position && total ? '<span class="group-position">' + position + '/' + total + '</span> ' : '';

  return prefix + escapeHtml(displayName.trim());
}

function getCardPlannedQuantity(card) {
  if (!card) return { qty: null, hasValue: false };
  const rawQty = card.quantity !== '' && card.quantity != null
    ? card.quantity
    : (card.initialSnapshot && card.initialSnapshot.quantity);

  if (rawQty !== '' && rawQty != null) {
    return { qty: toSafeCount(rawQty), hasValue: true };
  }

  const snapshotItems = Array.isArray(card.initialSnapshot && card.initialSnapshot.items)
    ? card.initialSnapshot.items.length
    : null;
  if (snapshotItems) {
    return { qty: snapshotItems, hasValue: true };
  }

  const itemsCount = Array.isArray(card.items) ? card.items.length : null;
  if (itemsCount) {
    return { qty: itemsCount, hasValue: true };
  }

  return { qty: null, hasValue: false };
}

function formatStepCode(step) {
  return String(step * 5).padStart(3, '0');
}

function computeMkiOperationQuantity(op, card) {
  if (!card || card.cardType !== 'MKI') return null;
  const source = op && op.isSamples ? card.sampleCount : card.quantity;
  if (source === '' || source == null) return '';
  const qty = toSafeCount(source);
  return Number.isFinite(qty) ? qty : '';
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
    if (card.useItemList) {
      normalizeOperationItems(card, op);
    }
  });
  if (card.useItemList) {
    syncItemListFromFirstOperation(card);
  }
}

function sumItemCounts(items = []) {
  return items.reduce((acc, item) => {
    acc.good += toSafeCount(item && item.goodCount != null ? item.goodCount : 0);
    acc.scrap += toSafeCount(item && item.scrapCount != null ? item.scrapCount : 0);
    acc.hold += toSafeCount(item && item.holdCount != null ? item.holdCount : 0);
    return acc;
  }, { good: 0, scrap: 0, hold: 0 });
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

function buildItemsFromTemplate(template = [], qty = 0) {
  const items = [];
  const targetQty = Number.isFinite(qty) ? qty : 0;
  for (let i = 0; i < targetQty; i++) {
    const source = template[i] || {};
    items.push({
      id: source.id || genId('item'),
      name: typeof source.name === 'string' ? source.name : '',
      quantity: 1,
      goodCount: 0,
      scrapCount: 0,
      holdCount: 0
    });
  }
  return items;
}

function getFirstOperation(card) {
  if (!card || !Array.isArray(card.operations) || !card.operations.length) return null;
  return [...card.operations].sort((a, b) => (a.order || 0) - (b.order || 0))[0];
}

function syncItemListFromFirstOperation(card) {
  if (!card || !card.useItemList) return;
  const firstOp = getFirstOperation(card);
  if (!firstOp) return;
  normalizeOperationItems(card, firstOp);
  const template = buildItemsFromTemplate(firstOp.items, getOperationQuantity(firstOp, card));
  (card.operations || []).forEach(op => {
    if (op.id === firstOp.id) return;
    const qty = getOperationQuantity(op, card);
    op.items = buildItemsFromTemplate(template, qty);
    normalizeOperationItems(card, op);
  });
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

function normalizeOperationItems(card, op) {
  if (!op || !card) return;
  op.items = Array.isArray(op.items) ? op.items : [];
  const useList = Boolean(card.useItemList);
  const opQty = getOperationQuantity(op, card);
  if (!useList) {
    const totals = sumItemCounts(op.items);
    op.goodCount = toSafeCount(op.goodCount || totals.good);
    op.scrapCount = toSafeCount(op.scrapCount || totals.scrap);
    op.holdCount = toSafeCount(op.holdCount || totals.hold);
    op.items = op.items.map(item => ({
      id: item.id || genId('item'),
      name: typeof item.name === 'string' ? item.name : '',
      quantity: 1,
      goodCount: toSafeCount(item.goodCount || 0),
      scrapCount: toSafeCount(item.scrapCount || 0),
      holdCount: toSafeCount(item.holdCount || 0)
    }));
    return;
  }

  const targetQty = Number.isFinite(opQty) ? opQty : 0;
  const normalized = [];
  for (let i = 0; i < targetQty; i++) {
    const source = op.items[i] || {};
    normalized.push({
      id: source.id || genId('item'),
      name: typeof source.name === 'string' ? source.name : '',
      quantity: 1,
      goodCount: toSafeCount(source.goodCount || 0),
      scrapCount: toSafeCount(source.scrapCount || 0),
      holdCount: toSafeCount(source.holdCount || 0)
    });
  }
  op.items = normalized;
  const totals = sumItemCounts(normalized);
  op.goodCount = totals.good;
  op.scrapCount = totals.scrap;
  op.holdCount = totals.hold;
}

function ensureAttachments(card) {
  if (!card) return;
  if (!Array.isArray(card.attachments)) card.attachments = [];
  card.attachments = card.attachments.map(file => ({
    id: file.id || genId('file'),
    name: file.name || 'file',
    type: file.type || 'application/octet-stream',
    size: typeof file.size === 'number' ? file.size : 0,
    content: typeof file.content === 'string' ? file.content : '',
    createdAt: file.createdAt || Date.now()
  }));
}

function ensureCardMeta(card, options = {}) {
  if (!card) return;
  const { skipSnapshot = false } = options;
  card.cardType = card.cardType === 'MKI' ? 'MKI' : 'MK';
  const isMki = card.cardType === 'MKI';
  card.routeCardNumber = typeof card.routeCardNumber === 'string'
    ? card.routeCardNumber
    : (card.orderNo ? String(card.orderNo) : '');
  card.orderNo = card.routeCardNumber;
  card.documentDesignation = typeof card.documentDesignation === 'string' ? card.documentDesignation : '';
  card.documentDate = formatDateInputValue(card.documentDate) || getCurrentDateString();
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
  card.mainMaterialGrade = typeof card.mainMaterialGrade === 'string'
    ? card.mainMaterialGrade
    : (card.material ? String(card.material) : '');
  card.material = card.mainMaterialGrade;
  card.batchSize = card.batchSize == null ? card.quantity : card.batchSize;
  const qtyVal = card.batchSize === '' ? '' : toSafeCount(card.batchSize);
  card.quantity = qtyVal;
  card.batchSize = card.quantity;
  if (isMki) {
    const normalizedItems = normalizeSerialInput(card.itemSerials);
    const itemCount = card.quantity === '' ? 0 : toSafeCount(card.quantity);
    card.itemSerials = resizeSerialList(normalizedItems, itemCount, { fillDefaults: true });

    const normalizedSamples = normalizeSerialInput(card.sampleSerials);
    card.sampleCount = card.sampleCount === '' || card.sampleCount == null ? '' : toSafeCount(card.sampleCount);
    const sampleCount = card.sampleCount === '' ? 0 : toSafeCount(card.sampleCount);
    card.sampleSerials = resizeSerialList(normalizedSamples, sampleCount, { fillDefaults: true });
  } else {
    card.itemSerials = typeof card.itemSerials === 'string' ? card.itemSerials : '';
    card.sampleCount = '';
    card.sampleSerials = [];
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
  card.useItemList = Boolean(card.useItemList);
  if (!card.status || card.status === 'NOT_STARTED' || card.status === 'Не запущена') {
    card.status = APPROVAL_STATUS_REJECTED;
  }
  card.approvalProductionStatus = normalizeApprovalStatus(card.approvalProductionStatus);
  card.approvalSkkStatus = normalizeApprovalStatus(card.approvalSkkStatus);
  card.approvalTechStatus = normalizeApprovalStatus(card.approvalTechStatus);
  card.approvalProductionDecided = typeof card.approvalProductionDecided === 'boolean' ? card.approvalProductionDecided : false;
  card.approvalSkkDecided = typeof card.approvalSkkDecided === 'boolean' ? card.approvalSkkDecided : false;
  card.approvalTechDecided = typeof card.approvalTechDecided === 'boolean' ? card.approvalTechDecided : false;
  card.rejectionReason = typeof card.rejectionReason === 'string' ? card.rejectionReason : '';
  if (typeof card.createdAt !== 'number') {
    card.createdAt = Date.now();
  }
  if (!Array.isArray(card.logs)) {
    card.logs = [];
  }
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
    normalizeOperationItems(card, op);
  });
  renumberAutoCodesForCard(card);
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
    c && c.cardType === 'MK' && String(c.routeCardNumber || '').trim() === number && c.id !== draft.id
  );

  if (conflict) {
    return 'Нельзя создать МКИ с номером маршрутной карты, совпадающим с номером обычной МК.';
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

  const sampleCount = draft.sampleCount === '' ? 0 : toSafeCount(draft.sampleCount);
  const normalizedSamples = resizeSerialList(normalizeSerialInput(draft.sampleSerials), sampleCount, { fillDefaults: false });
  if (hasEmptySerial(normalizedSamples)) {
    return 'Заполните все значения в таблице "Индивидуальные номера образцов".';
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
}

function recordCardLog(card, { action, object, field = null, targetId = null, oldValue = '', newValue = '' }) {
  if (!card) return;
  ensureCardMeta(card);
  card.logs.push({
    id: genId('log'),
    ts: Date.now(),
    action: action || 'update',
    object: object || '',
    field,
    targetId,
    oldValue: formatLogValue(oldValue),
    newValue: formatLogValue(newValue)
  });
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

async function fetchBarcodeSvg(value) {
  const normalized = (value || '').trim();
  if (!normalized) return '';
  const res = await apiFetch('/api/barcode/svg?value=' + encodeURIComponent(normalized), { method: 'GET' });
  if (!res.ok) throw new Error('Не удалось получить штрихкод');
  return res.text();
}

async function renderBarcodeInto(container, value) {
  if (!container) return;
  container.innerHTML = '';
  container.dataset.barcodeValue = '';
  const normalized = (value || '').trim();
  if (!normalized) return;
  container.dataset.barcodeValue = normalized;
  try {
    const svg = await fetchBarcodeSvg(normalized);
    if (container.dataset.barcodeValue === normalized) {
      container.innerHTML = svg;
    }
  } catch (err) {
    if (container.dataset.barcodeValue === normalized) {
      container.innerHTML = '<div class="barcode-error">Не удалось загрузить штрихкод</div>';
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
  if (!modal || !barcodeContainer || !codeSpan) return;
  if (title) title.textContent = 'Штрихкод пароля';
  renderBarcodeInto(barcodeContainer, password);
  codeSpan.textContent = password;
  if (userLabel) {
    const normalized = (username || '').trim();
    userLabel.textContent = normalized ? `Пользователь: ${normalized}` : '';
    userLabel.classList.toggle('hidden', !normalized);
  }
  modal.dataset.username = username || '';
  modal.dataset.mode = 'password';
  modal.dataset.userId = userId || '';
  modal.dataset.cardId = '';
  modal.dataset.groupId = '';
  modal.style.display = 'flex';
  setModalState({ type: 'barcode', mode: 'password', userId }, { fromRestore });
}

function openBarcodeModal(card, options = {}) {
  const { fromRestore = false } = options;
  const modal = document.getElementById('barcode-modal');
  const barcodeContainer = document.getElementById('barcode-svg');
  const codeSpan = document.getElementById('barcode-modal-code');
  const title = document.getElementById('barcode-modal-title');
  const userLabel = document.getElementById('barcode-modal-user');
  if (!modal || !barcodeContainer || !codeSpan) return;

  const isGroup = isGroupCard(card);
  if (title) {
    title.textContent = isGroup ? 'Штрихкод группы карт' : 'Штрихкод маршрутной карты';
  }

  if (userLabel) {
    userLabel.textContent = '';
    userLabel.classList.add('hidden');
  }
  modal.dataset.username = '';
  modal.dataset.mode = 'card';
  modal.dataset.cardId = card && !isGroup ? (card.id || '') : '';
  modal.dataset.groupId = isGroup && card ? (card.id || '') : '';
  modal.dataset.userId = '';

  let value = getCardBarcodeValue(card);
  if (!value) {
    card.barcode = generateUniqueCardCode128();
    ensureUniqueBarcodes(cards);
    value = card.barcode;
    saveData();
    renderEverything();
  }
  renderBarcodeInto(barcodeContainer, value);
  codeSpan.textContent = value || (isGroup ? '(нет номера группы)' : '(нет номера МК)');
  modal.style.display = 'flex';
  setModalState({
    type: 'barcode',
    cardId: card && card.id ? card.id : '',
    mode: isGroup ? 'group' : 'card'
  }, { fromRestore });
}

function closeBarcodeModal(silent = false) {
  const modal = document.getElementById('barcode-modal');
  if (modal) modal.style.display = 'none';
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

  if (closeBtn) {
    closeBtn.addEventListener('click', closeBarcodeModal);
  }

  if (printBtn) {
    printBtn.addEventListener('click', () => {
      const mode = modal.dataset.mode || 'card';
      if (mode === 'password') {
        const userId = (modal.dataset.userId || '').trim();
        if (userId) {
          const url = '/print/barcode/password/' + encodeURIComponent(userId);
          openPrintWindow(url);
        }
        return;
      }

      const groupId = (modal.dataset.groupId || '').trim();
      if (groupId) {
        const url = '/print/barcode/group/' + encodeURIComponent(groupId);
        openPrintWindow(url);
        return;
      }

      const cardId = (modal.dataset.cardId || '').trim();
      if (cardId) {
        const url = '/print/barcode/mk/' + encodeURIComponent(cardId);
        openPrintWindow(url);
      }
    });
  }
}
