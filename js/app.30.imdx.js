// === ИМПОРТ IMDX (ИЗОЛИРОВАННЫЙ) ===
function resetImdxImportState() {
  imdxImportState = { parsed: null, missing: null };
}

function stripUtf8Bom(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/^\uFEFF/, '');
}

function normalizeImdxText(value) {
  return (value || '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ===== IMDX helpers (FIX: отличаем № п/п от кода операции, нормализуем названия) =====
function normalizeOpName(name) {
  return String(name || '')
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\[\s+/g, '[')
    .replace(/\s+\]/g, ']')
    .trim();
}

// КОД ОПЕРАЦИИ: принимаем только 3-4 цифры
// ВАЖНО: двузначные 1..99 НЕ принимаем, чтобы не путать с № п/п
function parseOpCodeToken(tok) {
  const t = String(tok || '').trim();
  if (!t) return null;
  // иногда встречается 4 цифры, оставим как есть
  if (/^\d{3,4}$/.test(t)) return t.padStart(3, '0');
  // 2 цифры разрешаем ТОЛЬКО если начинается с 0 (например 05 -> 005), иначе это почти всегда № п/п
  if (/^\d{2}$/.test(t) && t.startsWith('0')) return t.padStart(3, '0');
  return null;
}

function isProbablyOrderNumber(tok, opCode) {
  const t = String(tok || '').trim();
  if (!/^\d+$/.test(t)) return false;
  const n = parseInt(t, 10);
  if (Number.isNaN(n) || n < 1 || n > 300) return false;
  // если это совпадает с opCode (055) — не считаем order
  const opN = opCode ? parseInt(opCode, 10) : null;
  if (opN != null && n === opN) return false;
  return true;
}

// Дедуп по названию операции (уникальность только по названию)
function uniqByOpName(items) {
  const seen = new Set();
  const out = [];
  for (const it of items || []) {
    const key = normalizeOpName(it.opName).toLowerCase();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

function extractImdxCardFieldsByAttrGuid(doc) {
  const pickByAttrGuid = (guid) => {
    if (!doc || !guid) return '';
    const all = Array.from(doc.getElementsByTagName('*'));
    for (const el of all) {
      if ((el.getAttribute && el.getAttribute('attrGuid')) !== guid) continue;
      const textNodes = Array.from(el.getElementsByTagName('Text'));
      for (const node of textNodes) {
        const val = normalizeImdxText(node.textContent || '');
        if (val) return val;
      }
      const fallback = normalizeImdxText(el.textContent || '');
      if (fallback) return fallback;
    }
    return '';
  };

  return {
    documentDesignation: pickByAttrGuid('c7ab6c4e-866f-4408-8915-f0c5a4ecaeed'),
    itemName: pickByAttrGuid('cad00020-306c-11d8-b4e9-00304f19f545'),
    itemDesignation: pickByAttrGuid('cad0001f-306c-11d8-b4e9-00304f19f545')
  };
}

function extractImdxOperationsByObjGuid(doc) {
  if (!doc) return { operations: [], guidCount: 0 };

  const byObjGuid = new Map();
  const textBoxes = Array.from(doc.getElementsByTagName('TextBoxElement'));

  // Сбор токенов по objGuid
  textBoxes.forEach((tb, idx) => {
    const ref = Array.from(tb.getElementsByTagName('Reference'))
      .find(r => r.getAttribute && r.getAttribute('objGuid'));
    const guid = ref ? ref.getAttribute('objGuid') : null;
    if (!guid) return;

    const texts = Array.from(tb.getElementsByTagName('Text'));
    texts.forEach(node => {
      const raw = node.textContent || '';
      raw.split(/\r?\n/).forEach(part => {
        const normalized = normalizeImdxText(part);
        if (!normalized) return;
        if (!byObjGuid.has(guid)) byObjGuid.set(guid, { tokens: [], order: idx });
        byObjGuid.get(guid).tokens.push(normalized);
      });
    });
  });

  const headers = [
    'подразделение', '№', '№ п/п', '№оп', '№ оп', '№ оп.', 'наименование операции',
    'выдано в работу', 'изготовлено', 'годные', 'брак', 'задержано',
    'исполнитель', 'дата', 'подпись', 'время начала', 'время окончания'
  ];
  const isHeader = (s = '') => {
    const t = String(s).trim().toLowerCase();
    return !t ? true : headers.some(h => t.includes(h));
  };

  const operations = [];
  let guidIndex = 0;

  for (const [guid, data] of byObjGuid.entries()) {
    guidIndex += 1;
    const tokens = (data.tokens || []).map(normalizeImdxText).filter(Boolean);

    // 1) Находим opCode: ТОЛЬКО 3-4 цифры (иначе путается с № п/п)
    let opCode = null;
    for (const tok of tokens) {
      const c = parseOpCodeToken(tok);
      if (c) { opCode = c; break; }
    }
    if (!opCode) continue; // без кода операции - не операция

    // 2) Найти centerName: ближайший "короткий" текст рядом с opCode
    // допускаем составные типа "О ОПР/СКК": если токены короткие - склеиваем 2-3 шт.
    let centerName = '';
    const opIdx = tokens.findIndex(t => parseOpCodeToken(t) === opCode);
    const scanStart = Math.max(0, (opIdx >= 0 ? opIdx : 0) - 4);
    const scanEnd = Math.min(tokens.length, (opIdx >= 0 ? opIdx : tokens.length) + 1);

    for (let i = scanStart; i < scanEnd; i++) {
      const t = tokens[i];
      if (!t || isHeader(t)) continue;
      if (/^\d+$/.test(t)) continue;

      // пробуем склеить 1-3 токена, после которых стоит opCode
      const t1 = t;
      const t2 = (i + 1 < tokens.length) ? tokens[i + 1] : '';
      const t3 = (i + 2 < tokens.length) ? tokens[i + 2] : '';

      const cand1 = t1;
      const cand2 = (t2 && !/^\d+$/.test(t2) && !isHeader(t2)) ? (t1 + ' ' + t2) : '';
      const cand3 = (cand2 && t3 && !/^\d+$/.test(t3) && !isHeader(t3)) ? (cand2 + ' ' + t3) : '';

      const after1 = tokens[i + 1] || '';
      const after2 = tokens[i + 2] || '';
      const after3 = tokens[i + 3] || '';

      if (parseOpCodeToken(after1) === opCode) { centerName = cand1; break; }
      if (cand2 && parseOpCodeToken(after2) === opCode) { centerName = cand2; break; }
      if (cand3 && parseOpCodeToken(after3) === opCode) { centerName = cand3; break; }

      // fallback: если рядом не нашли, берем первый короткий текст
      if (!centerName && t.length <= 30) centerName = t;
    }

    centerName = normalizeImdxText(centerName);

    // 3) Найти opName: самая "человеческая" строка (длина >= 4), не число, не header, не centerName, не opCode
    let opName = '';
    let best = '';
    for (const tok of tokens) {
      if (!tok || isHeader(tok)) continue;
      if (parseOpCodeToken(tok)) continue;        // это код
      if (/^\d+$/.test(tok)) continue;            // это числа (в т.ч. № п/п)
      if (centerName && tok.toLowerCase() === centerName.toLowerCase()) continue;
      if (tok.length >= 4 && tok.length > best.length) best = tok;
    }
    opName = normalizeOpName(best);

    if (!centerName || !opName) continue;

    // 4) Найти order: число 1..300, но не равное opCode
    let order = null;
    for (const tok of tokens) {
      if (!isProbablyOrderNumber(tok, opCode)) continue;
      order = parseInt(tok, 10);
      break;
    }

    operations.push({
      order: Number.isFinite(order) ? order : null,
      centerName,
      opCode,
      opName,
      __guidIndex: data.order ?? guidIndex
    });
  }

  // сортировка: если order есть у большинства - сортируем по order
  const withOrder = operations.filter(op => Number.isFinite(op.order)).length;
  const sorted = (withOrder >= operations.length / 2)
    ? operations.sort((a, b) => {
        const ao = Number.isFinite(a.order) ? a.order : Number.MAX_SAFE_INTEGER;
        const bo = Number.isFinite(b.order) ? b.order : Number.MAX_SAFE_INTEGER;
        if (ao !== bo) return ao - bo;
        return a.__guidIndex - b.__guidIndex;
      })
    : operations.sort((a, b) => a.__guidIndex - b.__guidIndex);

  return {
    operations: sorted.map(({ __guidIndex, ...op }) => op),
    guidCount: byObjGuid.size
  };
}

function parseImdxContent(xmlText) {
  const cleaned = stripUtf8Bom(xmlText || '');
  const doc = new DOMParser().parseFromString(cleaned, 'application/xml');
  if (!doc || doc.getElementsByTagName('parsererror').length) {
    throw new Error('Файл IMDX повреждён или имеет неверный формат');
  }

  const cardData = extractImdxCardFieldsByAttrGuid(doc);
  const { operations: rawOperations, guidCount } = extractImdxOperationsByObjGuid(doc);

  const normalizeOpField = (val) => normalizeImdxText(val || '');
  const dedupedOperations = [];
  const seenOps = new Set();
  (rawOperations || []).forEach(op => {
    const centerName = normalizeOpField(op.centerName);
    const opCode = (op.opCode || '').trim();
    const opName = normalizeOpField(op.opName);
    if (!centerName || !opCode || !opName) return;
    const key = `${centerName.toLowerCase()}|${opCode}|${opName.toLowerCase()}`;
    if (seenOps.has(key)) return;
    seenOps.add(key);
    dedupedOperations.push({ ...op, centerName, opCode, opName });
  });
  const operations = dedupedOperations;

  if (!cardData.documentDesignation && !cardData.itemName && !cardData.itemDesignation && !operations.length) {
    throw new Error('В IMDX не найдены данные для импорта');
  }

  if (!operations.length) {
    throw new Error('Не удалось извлечь маршрут операций из IMDX');
  }

  if (DEBUG_IMDX) {
    console.log('[IMDX] objGuids:', guidCount, 'operations:', operations.length, 'card fields:', Object.keys(cardData).filter(k => cardData[k]));
    console.log('[IMDX] first operations sample:', operations.slice(0, 3));
  }

  return { card: cardData, operations };
}

function findCenterByName(name) {
  if (!name) return null;
  const target = name.trim().toLowerCase();
  if (!target) return null;
  return centers.find(c => (c.name || '').trim().toLowerCase() === target) || null;
}

function findOpByCodeOrName(opCode, opName) {
  const code = (opCode || '').trim().toLowerCase();
  if (code) {
    const byCode = ops.find(o => (o.code || o.opCode || '').trim().toLowerCase() === code);
    if (byCode) return byCode;
  }
  const name = (opName || '').trim().toLowerCase();
  if (name) {
    const byName = ops.find(o => (o.name || '').trim().toLowerCase() === name);
    if (byName) return byName;
  }
  return null;
}

function collectImdxMissing(parsed) {
  const missingCenters = new Set();
  let missingOps = [];
  if (!parsed || !Array.isArray(parsed.operations)) {
    return { centers: [], ops: [] };
  }

  parsed.operations.forEach(op => {
    const centerName = (op.centerName || '').trim();
    if (centerName && !findCenterByName(centerName)) {
      missingCenters.add(centerName);
    }

    const opRef = findOpByCodeOrName(op.opCode, op.opName);
    if (!opRef) {
      const opKey = normalizeOpName(op.opName).toLowerCase();
      const exists = missingOps.some(item => normalizeOpName(item.opName).toLowerCase() === opKey);
      if (!exists) {
        missingOps.push({ opCode: op.opCode || '', opName: op.opName || '' });
      }
    }
  });

  missingOps = uniqByOpName(missingOps);

  const result = { centers: Array.from(missingCenters), ops: missingOps };
  if (DEBUG_IMDX) {
    console.log('[IMDX] missing references:', result);
  }
  return result;
}

function openImdxImportModal() {
  const modal = document.getElementById('imdx-import-modal');
  if (!modal) return;
  const input = document.getElementById('imdx-file-input');
  if (input) input.value = '';
  closeImdxMissingModal();
  modal.classList.remove('hidden');
}

function closeImdxImportModal() {
  const modal = document.getElementById('imdx-import-modal');
  if (!modal) return;
  modal.classList.add('hidden');
}

function renderImdxMissingList(listEl, items = []) {
  if (!listEl) return;
  listEl.innerHTML = '';
  items.forEach(text => {
    const li = document.createElement('li');
    li.textContent = text;
    listEl.appendChild(li);
  });
}

function openImdxMissingModal(missing) {
  const modal = document.getElementById('imdx-missing-modal');
  if (!modal) return;
  const centersList = document.getElementById('imdx-missing-centers');
  const opsList = document.getElementById('imdx-missing-ops');
  const centerItems = (missing && missing.centers) || [];
  const opItems = (missing && missing.ops) || [];
  renderImdxMissingList(centersList, centerItems);
  renderImdxMissingList(opsList, opItems.map(op => {
    const code = (op.opCode || '').trim();
    const name = (op.opName || '').trim();
    if (code && name) return `${code} — ${name}`;
    return name || code || 'Операция';
  }));
  modal.classList.remove('hidden');
}

function closeImdxMissingModal() {
  const modal = document.getElementById('imdx-missing-modal');
  if (!modal) return;
  modal.classList.add('hidden');
}

async function handleImdxImportConfirm() {
  if (!activeCardDraft) return;
  const input = document.getElementById('imdx-file-input');
  const file = input && input.files ? input.files[0] : null;
  if (!file) {
    alert('Выберите файл IMDX');
    return;
  }
  try {
    const text = await file.text();
    const parsed = parseImdxContent(text);
    if (!parsed.operations || !parsed.operations.length) {
      alert('Не удалось извлечь маршрут операций из IMDX');
      resetImdxImportState();
      return;
    }
    const missing = collectImdxMissing(parsed);
    imdxImportState = { parsed, missing };
    closeImdxImportModal();
    if ((missing.centers && missing.centers.length) || (missing.ops && missing.ops.length)) {
      openImdxMissingModal(missing);
      return;
    }
    applyImdxImport(parsed);
    resetImdxImportState();
  } catch (err) {
    alert('Ошибка импорта IMDX: ' + err.message);
    resetImdxImportState();
  }
}

async function confirmImdxMissingAdd() {
  const state = imdxImportState || {};
  if (!state.parsed || !state.missing) {
    closeImdxMissingModal();
    resetImdxImportState();
    return;
  }

  const usedCodes = collectUsedOpCodes();
  (state.missing.centers || []).forEach(name => {
    const trimmed = (name || '').trim();
    if (!trimmed || findCenterByName(trimmed)) return;
    centers.push({ id: genId('wc'), name: trimmed, desc: '' });
  });

  (state.missing.ops || []).forEach(op => {
    const name = (op.opName || '').trim();
    const code = (op.opCode || '').trim();
    const nameKey = normalizeOpName(name).toLowerCase();
    if (!nameKey) return;
    const existsByName = ops.some(o => normalizeOpName(o.name).toLowerCase() === nameKey);
    if (existsByName) return;
    if (findOpByCodeOrName(code, name)) return;
    let finalCode = code;
    if (!finalCode || usedCodes.has(finalCode)) {
      finalCode = generateUniqueOpCode(usedCodes);
    }
    usedCodes.add(finalCode);
    ops.push({ id: genId('op'), code: finalCode, name: name || finalCode, desc: '', recTime: 0, operationType: DEFAULT_OPERATION_TYPE });
  });

  await saveData();
  closeImdxMissingModal();
  applyImdxImport(state.parsed);
  resetImdxImportState();
}

function applyImdxImport(parsed) {
  if (!activeCardDraft || !parsed) return;
  const { card = {}, operations = [] } = parsed;
  const setFieldIfEmpty = (field, value, inputId) => {
    const val = (value || '').trim();
    if (!val) return;
    const current = (activeCardDraft[field] || '').trim();
    if (current) return;
    activeCardDraft[field] = val;
    if (inputId) {
      const input = document.getElementById(inputId);
      if (input && !input.value.trim()) {
        input.value = val;
      }
    }
  };

  setFieldIfEmpty('documentDesignation', card.documentDesignation, 'card-document-designation');
  setFieldIfEmpty('itemDesignation', card.itemDesignation, 'card-item-designation');
  if ((card.itemDesignation || '').trim()) {
    activeCardDraft.drawing = activeCardDraft.itemDesignation;
  }
  const itemName = (card.itemName || '').trim();
  if (itemName && !(activeCardDraft.itemName || '').trim()) {
    activeCardDraft.itemName = itemName;
    activeCardDraft.name = itemName;
    const nameInput = document.getElementById('card-name');
    if (nameInput && !nameInput.value.trim()) {
      nameInput.value = itemName;
    }
  }
  if (DEBUG_IMDX) {
    console.log('[IMDX] applying card fields', {
      documentDesignation: card.documentDesignation,
      itemDesignation: card.itemDesignation,
      itemName: card.itemName
    });
  }

  activeCardDraft.operations = [];
  const sortedOps = (operations || []).map((op, idx) => ({ ...op, __idx: idx })).sort((a, b) => {
    const aOrder = Number.isFinite(a.order) ? a.order : a.__idx + 1;
    const bOrder = Number.isFinite(b.order) ? b.order : b.__idx + 1;
    return aOrder - bOrder;
  });
  sortedOps.forEach((op, idx) => {
    const center = findCenterByName(op.centerName);
    const opRef = findOpByCodeOrName(op.opCode, op.opName);
    if (!center || !opRef) {
      if (DEBUG_IMDX) {
        console.warn('[IMDX] пропущена операция из-за отсутствия справочника', op);
      }
      return;
    }
    const orderVal = Number.isFinite(op.order) ? op.order : ((op.order != null && !Number.isNaN(parseInt(op.order, 10))) ? parseInt(op.order, 10) : idx + 1);
    const rop = createRouteOpFromRefs(opRef, center, '', 0, orderVal, { autoCode: true });
    activeCardDraft.operations.push(rop);
  });

  updateCardMainSummary();
  renderRouteTableDraft();
  fillRouteSelectors();
  const statusEl = document.getElementById('card-status-text');
  if (statusEl) {
    statusEl.textContent = cardStatusText(activeCardDraft);
  }
}

