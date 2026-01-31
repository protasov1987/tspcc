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
      meta: { revision: 1 }
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
      return this.#normalize(parsed);
    } catch (err) {
      const seeded = seedFn();
      await this.#persist(seeded);
      return seeded;
    }
  }

  #normalize(payload) {
    const rawMeta = payload && typeof payload.meta === 'object' ? payload.meta : {};
    const revision = Number.isFinite(rawMeta.revision) ? rawMeta.revision : 1;
    return {
      cards: Array.isArray(payload.cards) ? payload.cards : [],
      ops: Array.isArray(payload.ops) ? payload.ops : [],
      centers: Array.isArray(payload.centers) ? payload.centers : [],
      areas: Array.isArray(payload.areas) ? payload.areas : [],
      users: Array.isArray(payload.users) ? payload.users.map(normalizeUser) : [],
      accessLevels: Array.isArray(payload.accessLevels) ? payload.accessLevels : [],
      messages: Array.isArray(payload.messages) ? payload.messages : [],
      chatConversations: Array.isArray(payload.chatConversations) ? payload.chatConversations : [],
      chatMessages: Array.isArray(payload.chatMessages) ? payload.chatMessages : [],
      chatStates: Array.isArray(payload.chatStates) ? payload.chatStates : [],
      userVisits: Array.isArray(payload.userVisits) ? payload.userVisits : [],
      userActions: Array.isArray(payload.userActions) ? payload.userActions : [],
      productionSchedule: Array.isArray(payload.productionSchedule) ? payload.productionSchedule : [],
      productionShiftTimes: Array.isArray(payload.productionShiftTimes) ? payload.productionShiftTimes : [],
      productionShiftTasks: Array.isArray(payload.productionShiftTasks) ? payload.productionShiftTasks : [],
      productionShifts: Array.isArray(payload.productionShifts) ? payload.productionShifts : [],
      meta: { ...rawMeta, revision }
    };
  }

  async #persist(data) {
    await fs.promises.writeFile(this.filePath, JSON.stringify(this.#normalize(data), null, 2), 'utf8');
  }

  async getData() {
    return this.data;
  }

  async update(mutator) {
    this.writeQueue = this.writeQueue.then(async () => {
      const draft = deepClone(this.data);
      const next = await mutator(draft);
      const normalized = this.#normalize(next);
      normalized.meta = normalized.meta || {};
      normalized.meta.revision = (normalized.meta.revision || 1) + 1;

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
      this.data = normalized;
      await this.#persist(this.data);
      return this.data;
    });
    return this.writeQueue;
  }
}

module.exports = { JsonDatabase, deepClone };
