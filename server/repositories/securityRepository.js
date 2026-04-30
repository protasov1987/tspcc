const { BaseRepository } = require('./baseRepository');
const { createSqlConflict } = require('../persistence/mysql/conflicts');

const DEFAULT_TAB_KEYS = [
  'dashboard',
  'cards',
  'approvals',
  'provision',
  'input-control',
  'production',
  'production-schedule',
  'production-plan',
  'production-shifts',
  'production-delayed',
  'production-defects',
  'departments',
  'operations',
  'areas',
  'employees',
  'shift-times',
  'workorders',
  'items',
  'ok',
  'oc',
  'archive',
  'workspace',
  'users',
  'accessLevels'
];

const SPECIAL_ROLE_KEYS = [
  'worker',
  'headProduction',
  'headSKK',
  'skkWorker',
  'labWorker',
  'warehouseWorker',
  'deputyTechDirector'
];

const USER_ID_PATTERN = /^id(\d{6})$/;

function trimToString(value) {
  return value == null ? '' : String(value).trim();
}

function normalizeRev(value) {
  const rev = Number(value);
  return Number.isFinite(rev) && rev > 0 ? Math.floor(rev) : 1;
}

function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object' && !Buffer.isBuffer(value)) return value;
  try {
    const parsed = JSON.parse(Buffer.isBuffer(value) ? value.toString('utf8') : String(value));
    return parsed == null ? fallback : parsed;
  } catch (_err) {
    return fallback;
  }
}

function bufferToText(value) {
  if (value == null) return '';
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return String(value);
}

function textToBuffer(value) {
  const text = trimToString(value);
  return text ? Buffer.from(text, 'utf8') : null;
}

function securityError(statusCode, code, message, details = {}) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  Object.assign(err, details);
  return err;
}

function createSequentialUserId(existingIds = []) {
  const usedIds = new Set();
  let maxValue = 0;
  (existingIds || []).forEach((id) => {
    const match = USER_ID_PATTERN.exec(trimToString(id));
    if (!match) return;
    const num = parseInt(match[1], 10);
    if (Number.isFinite(num)) {
      maxValue = Math.max(maxValue, num);
      usedIds.add(`id${String(num).padStart(6, '0')}`);
    }
  });
  let candidate = '';
  let attempts = 0;
  do {
    maxValue = maxValue >= 999999 ? 1 : maxValue + 1;
    candidate = `id${String(maxValue).padStart(6, '0')}`;
    attempts += 1;
    if (attempts > 1000000) {
      throw securityError(500, 'USER_ID_ALLOCATION_FAILED', 'Не удалось выделить ID пользователя');
    }
  } while (usedIds.has(candidate));
  return candidate;
}

function rowToUser(row) {
  const printSettings = parseJson(row.print_settings_json, null);
  const productionSettings = parseJson(row.production_settings_json, null);
  const user = {
    id: trimToString(row.id),
    login: trimToString(row.login),
    name: trimToString(row.display_name),
    username: trimToString(row.display_name),
    role: trimToString(row.role),
    status: trimToString(row.status || 'active').toLowerCase(),
    departmentId: trimToString(row.department_id),
    accessLevelId: trimToString(row.access_level_id),
    passwordHash: bufferToText(row.password_hash),
    passwordSalt: bufferToText(row.password_salt),
    rev: normalizeRev(row.rev)
  };
  if (printSettings) user.printSettings = printSettings;
  if (productionSettings) user.productionSettings = productionSettings;
  return user;
}

function emptyPermissions(row) {
  const roles = parseJson(row.special_roles_json, {}) || {};
  const timeout = Number(row.inactivity_timeout_minutes);
  const permissions = {
    tabs: Object.fromEntries(DEFAULT_TAB_KEYS.map(key => [key, { view: false, edit: false }])),
    attachments: { upload: false, remove: false },
    landingTab: trimToString(row.landing_tab) || 'dashboard',
    inactivityTimeoutMinutes: Number.isFinite(timeout) && timeout > 0 ? Math.floor(timeout) : 30
  };
  SPECIAL_ROLE_KEYS.forEach((key) => {
    permissions[key] = Boolean(roles[key]);
  });
  return permissions;
}

function applyPermissionRow(permissions, row) {
  const key = trimToString(row.permission_key);
  const canView = Boolean(row.can_view);
  const canEdit = Boolean(row.can_edit);
  if (!key) return;
  if (key.startsWith('tabs.')) {
    const tabKey = key.slice('tabs.'.length);
    permissions.tabs[tabKey] = { view: canView || canEdit, edit: canEdit };
    return;
  }
  if (DEFAULT_TAB_KEYS.includes(key)) {
    permissions.tabs[key] = { view: canView || canEdit, edit: canEdit };
    return;
  }
  if (key === 'attachments.upload') {
    permissions.attachments.upload = canView || canEdit;
    return;
  }
  if (key === 'attachments.remove') {
    permissions.attachments.remove = canView || canEdit;
  }
}

function rowToAccessLevel(row, permissionRows = []) {
  const permissions = emptyPermissions(row);
  permissionRows.forEach(permissionRow => applyPermissionRow(permissions, permissionRow));
  if (row.id === 'level_admin') {
    DEFAULT_TAB_KEYS.forEach((key) => {
      permissions.tabs[key] = { view: true, edit: true };
    });
    permissions.attachments = { upload: true, remove: true };
  }
  return {
    id: trimToString(row.id),
    name: trimToString(row.name),
    description: trimToString(row.description),
    permissions,
    rev: normalizeRev(row.rev)
  };
}

function serializePermissions(permissions = {}) {
  const rows = [];
  const tabs = permissions.tabs && typeof permissions.tabs === 'object' ? permissions.tabs : {};
  for (const key of DEFAULT_TAB_KEYS) {
    const value = tabs[key] || {};
    rows.push({
      key: `tabs.${key}`,
      view: Boolean(value.view || value.edit),
      edit: Boolean(value.edit)
    });
  }
  const attachments = permissions.attachments || {};
  rows.push({ key: 'attachments.upload', view: Boolean(attachments.upload), edit: Boolean(attachments.upload) });
  rows.push({ key: 'attachments.remove', view: Boolean(attachments.remove), edit: Boolean(attachments.remove) });
  return rows;
}

function serializeSpecialRoles(permissions = {}) {
  return Object.fromEntries(SPECIAL_ROLE_KEYS.map(key => [key, Boolean(permissions[key])]));
}

class SecurityRepository extends BaseRepository {
  constructor(options = {}) {
    super({ ...options, domain: 'security' });
  }

  async readSnapshot(options = {}) {
    const target = options.tx || this;
    const [users, levels, permissions] = await Promise.all([
      target.query({
        sql: `
          SELECT id, rev, login, display_name, role, status, department_id, access_level_id,
                 password_hash, password_salt, print_settings_json, production_settings_json
          FROM users
          WHERE deleted_at IS NULL
          ORDER BY display_name, id
        `,
        values: [],
        label: 'security:users'
      }),
      target.query({
        sql: `
          SELECT id, rev, name, description, landing_tab, inactivity_timeout_minutes, special_roles_json
          FROM access_levels
          WHERE deleted_at IS NULL
          ORDER BY name, id
        `,
        values: [],
        label: 'security:access-levels'
      }),
      target.query({
        sql: `
          SELECT access_level_id, permission_key, can_view, can_edit
          FROM access_level_permissions
          ORDER BY access_level_id, permission_key
        `,
        values: [],
        label: 'security:permissions'
      })
    ]);
    const permissionRowsByLevel = new Map();
    for (const row of permissions.rows || []) {
      const levelId = trimToString(row.access_level_id);
      if (!permissionRowsByLevel.has(levelId)) permissionRowsByLevel.set(levelId, []);
      permissionRowsByLevel.get(levelId).push(row);
    }
    return {
      users: (users.rows || []).map(rowToUser),
      accessLevels: (levels.rows || []).map(row => rowToAccessLevel(row, permissionRowsByLevel.get(trimToString(row.id)) || []))
    };
  }

  async findUser(tx, id, { forUpdate = false } = {}) {
    const lock = forUpdate ? ' FOR UPDATE' : '';
    const result = await tx.query({
      sql: `
        SELECT id, rev, login, display_name, role, status, department_id, access_level_id,
               password_hash, password_salt, print_settings_json, production_settings_json
        FROM users
        WHERE id = ? AND deleted_at IS NULL
        LIMIT 1${lock}
      `,
      values: [trimToString(id)],
      label: 'security:user:get'
    });
    return result.rows?.[0] || null;
  }

  async findAccessLevel(tx, id, { forUpdate = false } = {}) {
    const lock = forUpdate ? ' FOR UPDATE' : '';
    const result = await tx.query({
      sql: `
        SELECT id, rev, name, description, landing_tab, inactivity_timeout_minutes, special_roles_json
        FROM access_levels
        WHERE id = ? AND deleted_at IS NULL
        LIMIT 1${lock}
      `,
      values: [trimToString(id)],
      label: 'security:access-level:get'
    });
    const row = result.rows?.[0] || null;
    if (!row) return null;
    const permissions = await tx.query({
      sql: 'SELECT permission_key, can_view, can_edit FROM access_level_permissions WHERE access_level_id = ? ORDER BY permission_key',
      values: [trimToString(id)],
      label: 'security:access-level:permissions'
    });
    return rowToAccessLevel(row, permissions.rows || []);
  }

  async assertAccessLevelExists(tx, id) {
    const result = await tx.query({
      sql: 'SELECT id FROM access_levels WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      values: [trimToString(id)],
      label: 'security:access-level:exists'
    });
    return Boolean(result.rows?.[0]);
  }

  async allocateUserId() {
    const result = await this.query({
      sql: 'SELECT id FROM users',
      values: [],
      label: 'security:user:allocate-id'
    });
    return createSequentialUserId((result.rows || []).map(row => row.id));
  }

  async createUser(input) {
    const user = {
      id: trimToString(input.id),
      name: trimToString(input.name),
      login: trimToString(input.login),
      accessLevelId: trimToString(input.accessLevelId),
      status: trimToString(input.status || 'active').toLowerCase(),
      passwordHash: trimToString(input.passwordHash),
      passwordSalt: trimToString(input.passwordSalt)
    };
    return this.inTransaction(async (tx) => {
      if (!await this.assertAccessLevelExists(tx, user.accessLevelId)) {
        throw securityError(400, 'ACCESS_LEVEL_NOT_FOUND', 'Уровень доступа не найден');
      }
      await tx.query({
        sql: `
          INSERT INTO users (
            id, rev, login, display_name, role, status, department_id, access_level_id,
            password_hash, password_salt, print_settings_json, production_settings_json,
            created_at, updated_at
          ) VALUES (?, 1, NULLIF(?, ''), ?, ?, ?, NULL, ?, ?, ?, NULL, NULL, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
        `,
        values: [
          user.id,
          user.login,
          user.name,
          trimToString(input.role) || null,
          user.status,
          user.accessLevelId,
          textToBuffer(user.passwordHash),
          textToBuffer(user.passwordSalt)
        ],
        label: 'security:user:create'
      });
      return rowToUser(await this.findUser(tx, user.id));
    }, { label: 'security:user:create' });
  }

  async updateUser(id, input) {
    const userId = trimToString(id);
    const expectedRev = normalizeRev(input.expectedRev);
    return this.inTransaction(async (tx) => {
      const row = await this.findUser(tx, userId, { forUpdate: true });
      if (!row) throw securityError(404, 'USER_NOT_FOUND', 'Пользователь не найден');
      if (normalizeRev(row.rev) !== expectedRev) {
        throw createSqlConflict({
          code: 'STALE_REVISION',
          entity: 'security.user',
          id: userId,
          expectedRev,
          actualRev: normalizeRev(row.rev),
          message: 'Пользователь уже был изменён другим пользователем'
        });
      }
      if (!await this.assertAccessLevelExists(tx, input.accessLevelId)) {
        throw securityError(409, 'INVALID_STATE', 'Уровень доступа уже недоступен. Данные обновлены.', {
          entity: 'security.user',
          id: userId,
          expectedRev,
          actualRev: normalizeRev(row.rev),
          entitySnapshot: rowToUser(row)
        });
      }
      const updates = [
        trimToString(input.name),
        trimToString(input.status || row.status).toLowerCase(),
        trimToString(input.accessLevelId)
      ];
      let passwordSql = '';
      if (input.hasPassword) {
        passwordSql = ', password_hash = ?, password_salt = ?';
        updates.push(textToBuffer(input.passwordHash), textToBuffer(input.passwordSalt));
      }
      await tx.query({
        sql: `
          UPDATE users
          SET display_name = ?, status = ?, access_level_id = ?
              ${passwordSql},
              rev = rev + 1,
              updated_at = UTC_TIMESTAMP(3)
          WHERE id = ? AND rev = ? AND deleted_at IS NULL
        `,
        values: updates.concat([userId, expectedRev]),
        label: 'security:user:update'
      });
      return rowToUser(await this.findUser(tx, userId));
    }, { label: 'security:user:update' });
  }

  async deleteUser(id, expectedRev) {
    const userId = trimToString(id);
    const expected = normalizeRev(expectedRev);
    return this.inTransaction(async (tx) => {
      const row = await this.findUser(tx, userId, { forUpdate: true });
      if (!row) throw securityError(404, 'USER_NOT_FOUND', 'Пользователь не найден');
      if (normalizeRev(row.rev) !== expected) {
        throw createSqlConflict({
          code: 'STALE_REVISION',
          entity: 'security.user',
          id: userId,
          expectedRev: expected,
          actualRev: normalizeRev(row.rev),
          message: 'Пользователь уже был изменён другим пользователем'
        });
      }
      await tx.query({
        sql: 'UPDATE users SET deleted_at = UTC_TIMESTAMP(3), rev = rev + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND rev = ?',
        values: [userId, expected],
        label: 'security:user:delete'
      });
      return rowToUser(row);
    }, { label: 'security:user:delete' });
  }

  async saveAccessLevel(input) {
    const accessLevel = {
      id: trimToString(input.id),
      name: trimToString(input.name),
      description: trimToString(input.description),
      permissions: input.permissions || {},
      expectedRev: input.expectedRev
    };
    return this.inTransaction(async (tx) => {
      const existing = await this.findAccessLevel(tx, accessLevel.id, { forUpdate: true });
      const isUpdate = Boolean(existing);
      if (isUpdate) {
        const expectedRev = normalizeRev(accessLevel.expectedRev);
        if (normalizeRev(existing.rev) !== expectedRev) {
          throw createSqlConflict({
            code: 'STALE_REVISION',
            entity: 'security.access-level',
            id: accessLevel.id,
            expectedRev,
            actualRev: normalizeRev(existing.rev),
            message: 'Уровень доступа уже был изменён другим пользователем'
          });
        }
        await tx.query({
          sql: `
            UPDATE access_levels
            SET name = ?, description = ?, landing_tab = ?, inactivity_timeout_minutes = ?,
                special_roles_json = ?, rev = rev + 1, updated_at = UTC_TIMESTAMP(3)
            WHERE id = ? AND rev = ? AND deleted_at IS NULL
          `,
          values: [
            accessLevel.name,
            accessLevel.description || null,
            trimToString(accessLevel.permissions.landingTab) || null,
            Number.isFinite(Number(accessLevel.permissions.inactivityTimeoutMinutes))
              ? Math.max(1, parseInt(accessLevel.permissions.inactivityTimeoutMinutes, 10))
              : null,
            JSON.stringify(serializeSpecialRoles(accessLevel.permissions)),
            accessLevel.id,
            expectedRev
          ],
          label: 'security:access-level:update'
        });
        await tx.query({
          sql: 'DELETE FROM access_level_permissions WHERE access_level_id = ?',
          values: [accessLevel.id],
          label: 'security:access-level:clear-permissions'
        });
      } else {
        await tx.query({
          sql: `
            INSERT INTO access_levels (
              id, rev, name, description, landing_tab, inactivity_timeout_minutes,
              special_roles_json, created_at, updated_at
            ) VALUES (?, 1, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
          `,
          values: [
            accessLevel.id,
            accessLevel.name,
            accessLevel.description || null,
            trimToString(accessLevel.permissions.landingTab) || null,
            Number.isFinite(Number(accessLevel.permissions.inactivityTimeoutMinutes))
              ? Math.max(1, parseInt(accessLevel.permissions.inactivityTimeoutMinutes, 10))
              : null,
            JSON.stringify(serializeSpecialRoles(accessLevel.permissions))
          ],
          label: 'security:access-level:create'
        });
      }

      for (const permission of serializePermissions(accessLevel.permissions)) {
        await tx.query({
          sql: `
            INSERT INTO access_level_permissions (
              access_level_id, permission_key, can_view, can_edit, created_at, updated_at
            ) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
          `,
          values: [accessLevel.id, permission.key, permission.view, permission.edit],
          label: 'security:access-level:permission'
        });
      }
      return this.findAccessLevel(tx, accessLevel.id);
    }, { label: 'security:access-level:save' });
  }

  async deleteAccessLevel(id, expectedRev) {
    const accessLevelId = trimToString(id);
    const expected = normalizeRev(expectedRev);
    return this.inTransaction(async (tx) => {
      const row = await this.findAccessLevel(tx, accessLevelId, { forUpdate: true });
      if (!row) throw securityError(404, 'ACCESS_LEVEL_NOT_FOUND', 'Уровень доступа не найден');
      if (normalizeRev(row.rev) !== expected) {
        throw createSqlConflict({
          code: 'STALE_REVISION',
          entity: 'security.access-level',
          id: accessLevelId,
          expectedRev: expected,
          actualRev: normalizeRev(row.rev),
          message: 'Уровень доступа уже был изменён другим пользователем'
        });
      }
      const attached = await tx.query({
        sql: 'SELECT COUNT(*) AS count FROM users WHERE access_level_id = ? AND deleted_at IS NULL',
        values: [accessLevelId],
        label: 'security:access-level:attached-users'
      });
      const attachedUsersCount = Number(attached.rows?.[0]?.count || 0);
      if (attachedUsersCount > 0) {
        throw securityError(409, 'ACCESS_LEVEL_IN_USE', 'Нельзя удалить уровень доступа: он назначен пользователям.', {
          entity: 'security.access-level',
          id: accessLevelId,
          expectedRev: expected,
          actualRev: normalizeRev(row.rev),
          accessLevel: row,
          attachedUsersCount
        });
      }
      await tx.query({
        sql: 'UPDATE access_levels SET deleted_at = UTC_TIMESTAMP(3), rev = rev + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND rev = ?',
        values: [accessLevelId, expected],
        label: 'security:access-level:delete'
      });
      return row;
    }, { label: 'security:access-level:delete' });
  }

  async updatePrintSettings(userId, settingsKey, settings) {
    const safeKey = trimToString(settingsKey);
    if (!['passwordQr', 'itemQr', 'cardQr'].includes(safeKey)) {
      throw securityError(400, 'INVALID_SETTINGS_KEY', 'Некорректные настройки');
    }
    return this.inTransaction(async (tx) => {
      const row = await this.findUser(tx, userId, { forUpdate: true });
      if (!row) throw securityError(404, 'USER_NOT_FOUND', 'Пользователь не найден');
      const user = rowToUser(row);
      const printSettings = user.printSettings && typeof user.printSettings === 'object' ? user.printSettings : {};
      printSettings[safeKey] = settings;
      await tx.query({
        sql: 'UPDATE users SET print_settings_json = ?, rev = rev + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND rev = ?',
        values: [JSON.stringify(printSettings), trimToString(userId), normalizeRev(row.rev)],
        label: 'security:user:print-settings'
      });
      const next = rowToUser(await this.findUser(tx, userId));
      return next.printSettings?.[safeKey] || {};
    }, { label: 'security:user:print-settings' });
  }
}

module.exports = {
  SecurityRepository,
  rowToAccessLevel,
  rowToUser,
  serializePermissions,
  serializeSpecialRoles
};
