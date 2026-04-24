const fs = require('fs');
const path = require('path');

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj || {}));
}

function ensureDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function normalizeDepartmentId(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  return raw ? raw : null;
}

function normalizeUser(user) {
  const id = String(user?.id || '').trim();
  const departmentId = normalizeDepartmentId(user?.departmentId);
  return { ...user, id, departmentId };
}

const AREA_TYPE_OPTIONS = ['Производство', 'Качество', 'Лаборатория', 'Субподрядчик', 'Индивидуальный'];
const DEFAULT_AREA_TYPE = AREA_TYPE_OPTIONS[0];
const OPERATION_TYPE_OPTIONS = ['Стандартная', 'Идентификация', 'Документы', 'Получение материала', 'Возврат материала', 'Сушка'];
const DEFAULT_OPERATION_TYPE = OPERATION_TYPE_OPTIONS[0];

function normalizeEntityRev(value) {
  const rev = Number(value);
  return Number.isFinite(rev) && rev > 0 ? Math.floor(rev) : 1;
}

function normalizeDomainRevisionValue(value) {
  const rev = Number(value);
  return Number.isFinite(rev) && rev > 0 ? Math.floor(rev) : 1;
}

function normalizeDomainRevisions(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    ...source,
    productionPlanning: normalizeDomainRevisionValue(source.productionPlanning)
  };
}

function buildProductionPlanningRevisionSignature(data) {
  const source = data && typeof data === 'object' ? data : {};
  return JSON.stringify({
    productionSchedule: Array.isArray(source.productionSchedule) ? source.productionSchedule : [],
    productionShiftTasks: Array.isArray(source.productionShiftTasks) ? source.productionShiftTasks : [],
    productionShifts: Array.isArray(source.productionShifts) ? source.productionShifts : []
  });
}

function normalizeAreaType(value) {
  const raw = String(value || '').trim();
  if (!raw) return DEFAULT_AREA_TYPE;
  const matched = AREA_TYPE_OPTIONS.find(option => option.toLowerCase() === raw.toLowerCase());
  return matched || DEFAULT_AREA_TYPE;
}

function normalizeOperationType(value) {
  const raw = String(value || '').trim();
  if (!raw) return DEFAULT_OPERATION_TYPE;
  const matched = OPERATION_TYPE_OPTIONS.find(option => option.toLowerCase() === raw.toLowerCase());
  return matched || DEFAULT_OPERATION_TYPE;
}

function normalizeAllowedAreaIds(value) {
  return Array.isArray(value)
    ? Array.from(new Set(value.map(item => String(item || '').trim()).filter(Boolean)))
    : [];
}

function normalizeDepartment(department) {
  if (!department || typeof department !== 'object') {
    return {
      id: '',
      name: '',
      desc: '',
      rev: 1
    };
  }
  return {
    ...department,
    id: String(department?.id || '').trim(),
    name: String(department?.name || '').trim(),
    desc: String(department?.desc || '').trim(),
    rev: normalizeEntityRev(department?.rev)
  };
}

function normalizeOperation(operation) {
  if (!operation || typeof operation !== 'object') {
    return {
      id: '',
      code: '',
      name: '',
      desc: '',
      recTime: 30,
      operationType: DEFAULT_OPERATION_TYPE,
      allowedAreaIds: [],
      rev: 1
    };
  }
  const recTime = parseInt(operation?.recTime, 10);
  return {
    ...operation,
    id: String(operation?.id || '').trim(),
    code: String(operation?.code || '').trim(),
    name: String(operation?.name || '').trim(),
    desc: String(operation?.desc || '').trim(),
    recTime: Number.isFinite(recTime) && recTime > 0 ? recTime : 30,
    operationType: normalizeOperationType(operation?.operationType),
    allowedAreaIds: normalizeAllowedAreaIds(operation?.allowedAreaIds),
    rev: normalizeEntityRev(operation?.rev)
  };
}

function normalizeArea(area) {
  if (!area || typeof area !== 'object') {
    return {
      id: '',
      name: '',
      desc: '',
      type: DEFAULT_AREA_TYPE,
      rev: 1
    };
  }
  return {
    ...area,
    id: String(area?.id || '').trim(),
    name: String(area?.name || '').trim(),
    desc: String(area?.desc || '').trim(),
    type: normalizeAreaType(area?.type),
    rev: normalizeEntityRev(area?.rev)
  };
}

const MOJIBAKE_PATTERNS = [
  /[РС][\u0400-\u040F\u0450-\u045F]/u,
  /[ÐÑ][\u0080-\u00BF]/u
];

function detectEncodingIssueKind(value) {
  if (typeof value !== 'string') return '';
  if (value.includes('\uFFFD')) return 'replacement';
  return MOJIBAKE_PATTERNS.some(pattern => pattern.test(value)) ? 'mojibake' : '';
}

function findEncodingIssuePaths(value, basePath = '$', acc = []) {
  if (typeof value === 'string') {
    const kind = detectEncodingIssueKind(value);
    if (kind) {
      acc.push({ kind, path: basePath, value });
    }
    return acc;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => findEncodingIssuePaths(item, `${basePath}[${index}]`, acc));
    return acc;
  }
  if (value && typeof value === 'object') {
    Object.keys(value).forEach(key => {
      findEncodingIssuePaths(value[key], `${basePath}.${key}`, acc);
    });
  }
  return acc;
}

function issueSignature(hit) {
  return `${hit.kind}|${hit.path}|${hit.value}`;
}

function collectEncodingIssueSignatures(data) {
  return new Set(findEncodingIssuePaths(data).map(issueSignature));
}

function logEncodingDiagnostics(data, context = 'db') {
  const hits = findEncodingIssuePaths(data);
  if (!hits.length) return hits;
  const replacementCount = hits.filter(hit => hit.kind === 'replacement').length;
  const mojibakeCount = hits.length - replacementCount;
  const preview = hits
    .slice(0, 10)
    .map(hit => `${hit.path} [${hit.kind}] = ${JSON.stringify(hit.value)}`)
    .join('\n');
  console.warn(
    `[DB][ENCODING] encoding issues detected during ${context}. ` +
    `Count=${hits.length} replacement=${replacementCount} mojibake=${mojibakeCount}\n${preview}`
  );
  return hits;
}

function ensureNoNewEncodingIssues(previousData, nextData, context = 'persist') {
  const prevSignatures = collectEncodingIssueSignatures(previousData);
  const newHits = findEncodingIssuePaths(nextData).filter(hit => !prevSignatures.has(issueSignature(hit)));
  if (!newHits.length) return;
  const preview = newHits
    .slice(0, 10)
    .map(hit => `${hit.path} [${hit.kind}] = ${JSON.stringify(hit.value)}`)
    .join('\n');
  const error = new Error(
    `[DB][ENCODING] new encoding issues introduced during ${context}. Count=${newHits.length}\n${preview}`
  );
  error.code = 'DB_ENCODING_REGRESSION';
  throw error;
}

class JsonDatabase {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = {
      cards: [],
      ops: [],
      centers: [],
      areas: [],
      users: [],
      accessLevels: [],
      productionSchedule: [],
      productionShiftTimes: [],
      productionShiftTasks: [],
      productionShifts: [],
      meta: {
        revision: 1,
        domainRevisions: normalizeDomainRevisions()
      }
    };
    this.writeQueue = Promise.resolve();
  }

  async init(seedFn) {
    ensureDirSync(path.dirname(this.filePath));
    this.data = await this.#readOrSeed(seedFn);
    return this.data;
  }

  async #readOrSeed(seedFn) {
    try {
      const raw = await fs.promises.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const normalized = this.#normalize(parsed);
      logEncodingDiagnostics(normalized, 'read');
      return normalized;
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        const seeded = seedFn();
        await this.#persist(seeded, null, 'seed');
        return seeded;
      }
      const exists = fs.existsSync(this.filePath);
      if (exists) {
        const corruptBackupPath = `${this.filePath}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
        try {
          await fs.promises.copyFile(this.filePath, corruptBackupPath);
          console.error(`[DB] Failed to read ${this.filePath}. Corrupt copy saved to ${corruptBackupPath}`);
        } catch (backupErr) {
          console.error(`[DB] Failed to read ${this.filePath} and failed to preserve corrupt copy`, backupErr);
        }
      }
      throw err;
    }
  }

  #normalize(payload) {
    const rawMeta = payload && typeof payload.meta === 'object' ? payload.meta : {};
    const revision = Number.isFinite(rawMeta.revision) ? rawMeta.revision : 1;
    return {
      cards: Array.isArray(payload.cards) ? payload.cards : [],
      ops: Array.isArray(payload.ops) ? payload.ops.map(normalizeOperation) : [],
      centers: Array.isArray(payload.centers) ? payload.centers.map(normalizeDepartment) : [],
      areas: Array.isArray(payload.areas) ? payload.areas.map(normalizeArea) : [],
      users: Array.isArray(payload.users) ? payload.users.map(normalizeUser) : [],
      accessLevels: Array.isArray(payload.accessLevels) ? payload.accessLevels : [],
      messages: Array.isArray(payload.messages) ? payload.messages : [],
      chatConversations: Array.isArray(payload.chatConversations) ? payload.chatConversations : [],
      chatMessages: Array.isArray(payload.chatMessages) ? payload.chatMessages : [],
      chatStates: Array.isArray(payload.chatStates) ? payload.chatStates : [],
      webPushSubscriptions: Array.isArray(payload.webPushSubscriptions) ? payload.webPushSubscriptions : [],
      fcmTokens: Array.isArray(payload.fcmTokens) ? payload.fcmTokens : [],
      userVisits: Array.isArray(payload.userVisits) ? payload.userVisits : [],
      userActions: Array.isArray(payload.userActions) ? payload.userActions : [],
      productionSchedule: Array.isArray(payload.productionSchedule) ? payload.productionSchedule : [],
      productionShiftTimes: Array.isArray(payload.productionShiftTimes) ? payload.productionShiftTimes : [],
      productionShiftTasks: Array.isArray(payload.productionShiftTasks) ? payload.productionShiftTasks : [],
      productionShifts: Array.isArray(payload.productionShifts) ? payload.productionShifts : [],
      meta: {
        ...rawMeta,
        revision,
        domainRevisions: normalizeDomainRevisions(rawMeta.domainRevisions)
      }
    };
  }

  async #persist(data, previousData = null, context = 'persist') {
    const normalized = this.#normalize(data);
    logEncodingDiagnostics(normalized, context);
    if (previousData) {
      ensureNoNewEncodingIssues(previousData, normalized, context);
    }
    await fs.promises.writeFile(this.filePath, JSON.stringify(normalized, null, 2), 'utf8');
    return normalized;
  }

  async getData() {
    return this.data;
  }

  async update(mutator) {
    const run = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
      const draft = deepClone(this.data);
      const next = await mutator(draft);
      const normalized = this.#normalize(next);
      normalized.meta = normalized.meta || {};
      normalized.meta.revision = (normalized.meta.revision || 1) + 1;
      normalized.meta.domainRevisions = normalizeDomainRevisions(normalized.meta.domainRevisions);
      const previousPlanningSignature = buildProductionPlanningRevisionSignature(this.data);
      const nextPlanningSignature = buildProductionPlanningRevisionSignature(normalized);
      if (previousPlanningSignature !== nextPlanningSignature) {
        normalized.meta.domainRevisions.productionPlanning =
          normalizeDomainRevisionValue(normalized.meta.domainRevisions.productionPlanning) + 1;
      }

      // === per-card revision: card.rev grows on any card change ===
      const prevCards = Array.isArray(this.data.cards) ? this.data.cards : [];
      const prevById = new Map(prevCards.map(c => [c.id, c]));

      function stableStringify(obj) {
        return JSON.stringify(obj, (k, v) => {
          if (k === 'rev') return undefined;
          return v;
        });
      }

      normalized.cards = (Array.isArray(normalized.cards) ? normalized.cards : []).map(card => {
        const prev = prevById.get(card.id);
        const prevRev = prev && Number.isFinite(prev.rev) ? prev.rev : 1;

        if (!prev) {
          return { ...card, rev: 1 };
        }

        const prevSig = stableStringify(prev);
        const nextSig = stableStringify(card);

        if (prevSig !== nextSig) {
          return { ...card, rev: prevRev + 1 };
        }

        // не изменялась
        const existing = Number.isFinite(card.rev) ? card.rev : prevRev;
        return { ...card, rev: existing };
      });
      const stableStringifyEntity = (obj) => JSON.stringify(obj, (k, v) => (k === 'rev' ? undefined : v));
      const applyEntityRevisions = (prevItems, nextItems) => {
        const prevById = new Map((Array.isArray(prevItems) ? prevItems : []).map(item => [String(item?.id || '').trim(), item]));
        return (Array.isArray(nextItems) ? nextItems : []).map(item => {
          const id = String(item?.id || '').trim();
          const previous = prevById.get(id);
          const prevRev = previous && Number.isFinite(previous.rev) ? previous.rev : 1;
          if (!previous) {
            return { ...item, rev: 1 };
          }
          if (stableStringifyEntity(previous) !== stableStringifyEntity(item)) {
            return { ...item, rev: prevRev + 1 };
          }
          const existingRev = Number.isFinite(item?.rev) ? item.rev : prevRev;
          return { ...item, rev: existingRev };
        });
      };
      normalized.ops = applyEntityRevisions(this.data.ops, normalized.ops);
      normalized.centers = applyEntityRevisions(this.data.centers, normalized.centers);
      normalized.areas = applyEntityRevisions(this.data.areas, normalized.areas);
      await this.#persist(normalized, this.data, 'persist');
      this.data = normalized;
      return this.data;
      });
    this.writeQueue = run.catch(() => undefined);
    return run;
  }
}

module.exports = { JsonDatabase, deepClone };
