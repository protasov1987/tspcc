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
      productionShifts: []
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
    return {
      cards: Array.isArray(payload.cards) ? payload.cards : [],
      ops: Array.isArray(payload.ops) ? payload.ops : [],
      centers: Array.isArray(payload.centers) ? payload.centers : [],
      areas: Array.isArray(payload.areas) ? payload.areas : [],
      users: Array.isArray(payload.users) ? payload.users.map(normalizeUser) : [],
      accessLevels: Array.isArray(payload.accessLevels) ? payload.accessLevels : [],
      productionSchedule: Array.isArray(payload.productionSchedule) ? payload.productionSchedule : [],
      productionShiftTimes: Array.isArray(payload.productionShiftTimes) ? payload.productionShiftTimes : [],
      productionShiftTasks: Array.isArray(payload.productionShiftTasks) ? payload.productionShiftTasks : [],
      productionShifts: Array.isArray(payload.productionShifts) ? payload.productionShifts : []
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
      this.data = this.#normalize(next);
      await this.#persist(this.data);
      return this.data;
    });
    return this.writeQueue;
  }
}

module.exports = { JsonDatabase, deepClone };
