const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'database.json');
const DRY_RUN = process.argv.includes('--dry-run');
const REPLACEMENT = '\uFFFD';
const KNOWN_FRAGMENT_REPAIRS = [
  ['��г', 'кг'],
  ['зав��ршени��', 'завершение'],
  ['Стал����', 'Сталь'],
  ['��ип-порошок', 'тип-порошок'],
  ['Алюмини��', 'Алюминий'],
  ['тип-н��т', 'тип-нет']
];

const KEY_HINTS = {
  createdBy: 'user',
  userName: 'user',
  openedBy: 'user',
  author: 'user',
  responsibleSKKChief: 'user',
  responsibleDeputyTechDirector: 'user',
  responsibleHeadProduction: 'user',
  responsibleInputControl: 'user',
  responsibleProvision: 'user',
  object: 'phrase',
  action: 'phrase',
  field: 'word',
  opName: 'phrase',
  centerName: 'phrase',
  name: 'phrase'
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function hasBrokenChars(value) {
  return typeof value === 'string' && value.includes(REPLACEMENT);
}

function normalizeSpace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stripBrokenChars(value) {
  return normalizeSpace(String(value || '').replace(/\uFFFD/g, ''));
}

function skeleton(value) {
  return stripBrokenChars(value)
    .toLowerCase()
    .replace(/[^a-zа-яё0-9-]/gi, '');
}

function tokenizeWords(value) {
  return String(value || '').match(/[A-Za-zА-Яа-яЁё0-9-]+/g) || [];
}

function levenshtein(a, b) {
  const aa = String(a || '');
  const bb = String(b || '');
  if (aa === bb) return 0;
  if (!aa.length) return bb.length;
  if (!bb.length) return aa.length;
  const prev = new Array(bb.length + 1);
  const curr = new Array(bb.length + 1);
  for (let j = 0; j <= bb.length; j += 1) prev[j] = j;
  for (let i = 1; i <= aa.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= bb.length; j += 1) {
      const cost = aa[i - 1] === bb[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost
      );
    }
    for (let j = 0; j <= bb.length; j += 1) prev[j] = curr[j];
  }
  return prev[bb.length];
}

function isSubsequence(needle, haystack) {
  const a = String(needle || '');
  const b = String(haystack || '');
  if (!a) return false;
  let i = 0;
  for (let j = 0; j < b.length && i < a.length; j += 1) {
    if (a[i] === b[j]) i += 1;
  }
  return i === a.length;
}

function buildContext(data) {
  const users = new Set();
  const phrases = new Set();
  const words = new Set();
  const byKey = new Map();

  const addByKey = (key, value) => {
    if (!key) return;
    if (!byKey.has(key)) byKey.set(key, new Set());
    byKey.get(key).add(value);
  };

  const visit = (value, key = '') => {
    if (typeof value === 'string') {
      const text = normalizeSpace(value);
      if (!text || hasBrokenChars(text)) return;
      phrases.add(text);
      addByKey(key, text);
      tokenizeWords(text).forEach(word => {
        if (word.length >= 2) words.add(word);
      });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(item => visit(item, key));
      return;
    }
    if (!value || typeof value !== 'object') return;
    Object.keys(value).forEach(nextKey => visit(value[nextKey], nextKey));
  };

  visit(data);

  (data.users || []).forEach(user => {
    [user?.name, user?.login, user?.username].forEach(name => {
      const text = normalizeSpace(name);
      if (!text || hasBrokenChars(text)) return;
      users.add(text);
      phrases.add(text);
      addByKey('createdBy', text);
      addByKey('userName', text);
      tokenizeWords(text).forEach(word => words.add(word));
    });
  });

  [
    'Статус операции',
    'Статус карты',
    'Исполнитель',
    'Доп. исполнитель',
    'Плановое время',
    'Порядок операции',
    'Архивирование',
    'Изменение поля',
    'Изменение операции',
    'Создание МК',
    'Добавление операции',
    'Удаление операции',
    'Файлы',
    'Карта',
    'Операция',
    'Смена',
    'Сотрудник',
    'Возврат материала',
    'Выдача материала',
    'Сдача материала',
    'Подготовка документации',
    'Сушка',
    'завершение',
    'Сталь',
    'Алюминий',
    'Перчатки'
  ].forEach(text => {
    phrases.add(text);
    tokenizeWords(text).forEach(word => words.add(word));
  });

  return {
    users: Array.from(users),
    phrases: Array.from(phrases),
    words: Array.from(words),
    byKey
  };
}

function bestCandidate(raw, candidates, { maxRatio = 0.34, maxAbs = 3 } = {}) {
  const rawText = normalizeSpace(raw);
  const rawSkeleton = skeleton(rawText);
  if (!rawSkeleton) return null;
  let best = null;

  for (const candidate of candidates) {
    const candidateText = normalizeSpace(candidate);
    if (!candidateText || hasBrokenChars(candidateText)) continue;
    const candidateSkeleton = skeleton(candidateText);
    if (!candidateSkeleton) continue;
    const dist = levenshtein(rawSkeleton, candidateSkeleton);
    const ratio = dist / Math.max(rawSkeleton.length, candidateSkeleton.length, 1);
    const contains = candidateSkeleton.includes(rawSkeleton) || rawSkeleton.includes(candidateSkeleton);
    const subsequence = isSubsequence(rawSkeleton, candidateSkeleton) || isSubsequence(candidateSkeleton, rawSkeleton);
    const absLimit = contains || subsequence ? maxAbs + 2 : maxAbs;
    const ratioLimit = contains || subsequence ? maxRatio + 0.2 : maxRatio;
    if (dist > absLimit || ratio > ratioLimit) continue;
    if (!best || ratio < best.ratio || (ratio === best.ratio && dist < best.dist)) {
      best = { value: candidateText, ratio, dist };
    }
  }

  return best ? best.value : null;
}

function repairWordToken(token, key, context) {
  const hint = KEY_HINTS[key] || 'word';
  const pools = [];
  if (hint === 'user') pools.push(context.users);
  const fieldPool = context.byKey.get(key);
  if (fieldPool) pools.push(Array.from(fieldPool));
  pools.push(context.words);
  return bestCandidate(token, pools.flat(), { maxRatio: 0.45, maxAbs: 3 }) || token;
}

function repairPhrase(value, key, context) {
  let raw = normalizeSpace(value);
  KNOWN_FRAGMENT_REPAIRS.forEach(([broken, fixed]) => {
    raw = raw.split(broken).join(fixed);
  });
  if (!hasBrokenChars(raw)) return raw;
  const hint = KEY_HINTS[key] || 'phrase';
  const pools = [];
  if (hint === 'user') pools.push(context.users);
  const fieldPool = context.byKey.get(key);
  if (fieldPool) pools.push(Array.from(fieldPool));
  pools.push(context.phrases);

  const fullMatch = bestCandidate(raw, pools.flat(), { maxRatio: 0.36, maxAbs: 4 });
  if (fullMatch) return fullMatch;

  return raw
    .split(/([^A-Za-zА-Яа-яЁё0-9-]+)/g)
    .map(part => (part.includes(REPLACEMENT) ? repairWordToken(part, key, context) : part))
    .join('');
}

function walkAndRepair(value, context, state, key = '', pathName = '$') {
  if (typeof value === 'string') {
    if (!hasBrokenChars(value)) return value;
    const repaired = repairPhrase(value, key, context);
    state.seen += 1;
    if (repaired !== value && !hasBrokenChars(repaired)) {
      state.fixed += 1;
      state.samples.push({ path: pathName, from: value, to: repaired });
      return repaired;
    }
    state.unfixed += 1;
    state.unfixedSamples.push({ path: pathName, value });
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => walkAndRepair(item, context, state, key, `${pathName}[${index}]`));
  }
  if (!value || typeof value !== 'object') return value;

  const next = {};
  Object.keys(value).forEach(originalKey => {
    let nextKey = originalKey;
    if (hasBrokenChars(originalKey)) {
      const repairedKey = repairPhrase(originalKey, key, context);
      state.seen += 1;
      if (repairedKey !== originalKey && !hasBrokenChars(repairedKey)) {
        state.fixed += 1;
        state.samples.push({ path: `${pathName}.{key}`, from: originalKey, to: repairedKey });
        nextKey = repairedKey;
      } else {
        state.unfixed += 1;
        state.unfixedSamples.push({ path: `${pathName}.{key}`, value: originalKey });
      }
    }
    next[nextKey] = walkAndRepair(value[originalKey], context, state, nextKey, `${pathName}.${nextKey}`);
  });
  return next;
}

function main() {
  const db = readJson(DB_PATH);
  const context = buildContext(db);
  const state = {
    seen: 0,
    fixed: 0,
    unfixed: 0,
    samples: [],
    unfixedSamples: []
  };

  const repaired = walkAndRepair(db, context, state);

  console.log(`[repair-encoding] seen=${state.seen} fixed=${state.fixed} unfixed=${state.unfixed}`);
  if (state.samples.length) {
    console.log('[repair-encoding] sample fixes:');
    state.samples.slice(0, 20).forEach(item => {
      console.log(`  ${item.path}`);
      console.log(`    from: ${item.from}`);
      console.log(`    to:   ${item.to}`);
    });
  }
  if (state.unfixedSamples.length) {
    console.log('[repair-encoding] sample unresolved:');
    state.unfixedSamples.slice(0, 20).forEach(item => {
      console.log(`  ${item.path}`);
      console.log(`    value: ${item.value}`);
    });
  }

  if (DRY_RUN) return;

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${DB_PATH}.${timestamp}.bak`;
  fs.copyFileSync(DB_PATH, backupPath);
  writeJson(DB_PATH, repaired);
  console.log(`[repair-encoding] backup=${backupPath}`);
  console.log(`[repair-encoding] updated=${DB_PATH}`);
}

main();
