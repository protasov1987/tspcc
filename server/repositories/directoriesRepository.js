const { BaseRepository } = require('./baseRepository');
const { createSqlConflict } = require('../persistence/mysql/conflicts');

function trimToString(value) {
  return value == null ? '' : String(value).trim();
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeRev(value) {
  const rev = Number(value);
  return Number.isFinite(rev) && rev > 0 ? Math.floor(rev) : 1;
}

function toTimeText(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value.toISOString().slice(11, 19);
  const text = String(value).trim();
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(text)) {
    const [h, m, s = '00'] = text.split(':');
    return `${h.padStart(2, '0')}:${m}:${s}`;
  }
  if (typeof value === 'object' && Number.isFinite(Number(value.hours))) {
    return `${String(value.hours).padStart(2, '0')}:${String(value.minutes || 0).padStart(2, '0')}:00`;
  }
  return null;
}

function fromTimeText(value) {
  const text = toTimeText(value);
  return text ? text.slice(0, 5) : '';
}

function directoryError(statusCode, code, message, details = {}) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  Object.assign(err, details);
  return err;
}

function stale(entity, row, expectedRev, message) {
  return createSqlConflict({
    code: 'STALE_REVISION',
    entity,
    id: row?.id,
    expectedRev,
    actualRev: normalizeRev(row?.rev),
    message
  });
}

function rowToDepartment(row) {
  return {
    id: trimToString(row.id),
    name: trimToString(row.name),
    desc: trimToString(row.description),
    rev: normalizeRev(row.rev)
  };
}

function rowToArea(row) {
  return {
    id: trimToString(row.id),
    name: trimToString(row.name),
    desc: trimToString(row.description),
    type: trimToString(row.area_type) || 'Производство',
    rev: normalizeRev(row.rev)
  };
}

function rowToOperation(row, allowedAreaIds = []) {
  return {
    id: trimToString(row.id),
    code: trimToString(row.code),
    name: trimToString(row.name),
    desc: trimToString(row.description),
    recTime: Math.max(1, Math.round(toNumber(row.rec_time_minutes, 30))),
    operationType: trimToString(row.operation_type) || 'Стандартная',
    allowedAreaIds,
    rev: normalizeRev(row.rev)
  };
}

function rowToShiftTime(row) {
  return {
    id: trimToString(row.id),
    shift: trimToString(row.shift_code || row.id),
    timeFrom: fromTimeText(row.time_from),
    timeTo: fromTimeText(row.time_to),
    lunchFrom: fromTimeText(row.lunch_from),
    lunchTo: fromTimeText(row.lunch_to),
    rev: normalizeRev(row.rev)
  };
}

class DirectoriesRepository extends BaseRepository {
  constructor(options = {}) {
    super({ ...options, domain: 'directories' });
  }

  async readSnapshot(options = {}) {
    const target = options.tx || this;
    const [centers, areas, operations, bindings, shiftTimes] = await Promise.all([
      target.query({
        sql: 'SELECT id, rev, name, description FROM work_centers WHERE deleted_at IS NULL ORDER BY name, id',
        values: [],
        label: 'directories:work-centers'
      }),
      target.query({
        sql: 'SELECT id, rev, name, area_type, description FROM production_areas WHERE deleted_at IS NULL ORDER BY name, id',
        values: [],
        label: 'directories:areas'
      }),
      target.query({
        sql: 'SELECT id, rev, code, name, description, operation_type, rec_time_minutes FROM operations WHERE deleted_at IS NULL ORDER BY name, id',
        values: [],
        label: 'directories:operations'
      }),
      target.query({
        sql: `
          SELECT operation_id, area_id
          FROM operation_allowed_areas
          ORDER BY operation_id, area_id
        `,
        values: [],
        label: 'directories:operation-areas'
      }),
      target.query({
        sql: 'SELECT id, rev, shift_code, time_from, time_to, lunch_from, lunch_to FROM production_shift_times WHERE deleted_at IS NULL ORDER BY shift_code, id',
        values: [],
        label: 'directories:shift-times'
      })
    ]);

    const allowedByOperation = new Map();
    for (const row of bindings.rows || []) {
      const operationId = trimToString(row.operation_id);
      const areaId = trimToString(row.area_id);
      if (!operationId || !areaId) continue;
      if (!allowedByOperation.has(operationId)) allowedByOperation.set(operationId, []);
      allowedByOperation.get(operationId).push(areaId);
    }

    return {
      centers: (centers.rows || []).map(rowToDepartment),
      areas: (areas.rows || []).map(rowToArea),
      ops: (operations.rows || []).map((row) => rowToOperation(row, allowedByOperation.get(trimToString(row.id)) || [])),
      productionShiftTimes: (shiftTimes.rows || []).map(rowToShiftTime)
    };
  }

  async findDepartment(tx, id, { forUpdate = false } = {}) {
    const lock = forUpdate ? ' FOR UPDATE' : '';
    const result = await tx.query({
      sql: `SELECT id, rev, name, description FROM work_centers WHERE id = ? AND deleted_at IS NULL LIMIT 1${lock}`,
      values: [trimToString(id)],
      label: 'directories:department:get'
    });
    return (result.rows || [])[0] || null;
  }

  async findOperation(tx, id, { forUpdate = false } = {}) {
    const lock = forUpdate ? ' FOR UPDATE' : '';
    const result = await tx.query({
      sql: `SELECT id, rev, code, name, description, operation_type, rec_time_minutes FROM operations WHERE id = ? AND deleted_at IS NULL LIMIT 1${lock}`,
      values: [trimToString(id)],
      label: 'directories:operation:get'
    });
    const row = (result.rows || [])[0] || null;
    if (!row) return null;
    const bindings = await tx.query({
      sql: 'SELECT area_id FROM operation_allowed_areas WHERE operation_id = ? ORDER BY area_id',
      values: [trimToString(id)],
      label: 'directories:operation:areas'
    });
    return { ...row, allowedAreaIds: (bindings.rows || []).map(item => trimToString(item.area_id)).filter(Boolean) };
  }

  async findArea(tx, id, { forUpdate = false } = {}) {
    const lock = forUpdate ? ' FOR UPDATE' : '';
    const result = await tx.query({
      sql: `SELECT id, rev, name, area_type, description FROM production_areas WHERE id = ? AND deleted_at IS NULL LIMIT 1${lock}`,
      values: [trimToString(id)],
      label: 'directories:area:get'
    });
    return (result.rows || [])[0] || null;
  }

  async createDepartment(input) {
    const department = {
      id: trimToString(input.id),
      name: trimToString(input.name),
      desc: trimToString(input.desc)
    };
    return this.inTransaction(async (tx) => {
      await tx.query({
        sql: `
          INSERT INTO work_centers (id, rev, name, description, created_at, updated_at)
          VALUES (?, 1, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
        `,
        values: [department.id, department.name, department.desc || null],
        label: 'directories:department:create'
      });
      const row = await this.findDepartment(tx, department.id);
      return rowToDepartment(row);
    }, { label: 'directories:department:create' });
  }

  async updateDepartment(id, input) {
    const departmentId = trimToString(id);
    const expectedRev = normalizeRev(input.expectedRev);
    return this.inTransaction(async (tx) => {
      const row = await this.findDepartment(tx, departmentId, { forUpdate: true });
      if (!row) throw directoryError(404, 'DIRECTORY_NOT_FOUND', 'Подразделение не найдено');
      if (normalizeRev(row.rev) !== expectedRev) {
        throw stale('directory.department', row, expectedRev, 'Подразделение уже было изменено другим пользователем');
      }
      await tx.query({
        sql: `
          UPDATE work_centers
          SET name = ?, description = ?, rev = rev + 1, updated_at = UTC_TIMESTAMP(3)
          WHERE id = ? AND rev = ? AND deleted_at IS NULL
        `,
        values: [trimToString(input.name), trimToString(input.desc) || null, departmentId, expectedRev],
        label: 'directories:department:update'
      });
      const next = await this.findDepartment(tx, departmentId);
      return rowToDepartment(next);
    }, { label: 'directories:department:update' });
  }

  async deleteDepartment(id, expectedRev) {
    const departmentId = trimToString(id);
    const expected = normalizeRev(expectedRev);
    return this.inTransaction(async (tx) => {
      const row = await this.findDepartment(tx, departmentId, { forUpdate: true });
      if (!row) throw directoryError(404, 'DIRECTORY_NOT_FOUND', 'Подразделение не найдено');
      if (normalizeRev(row.rev) !== expected) {
        throw stale('directory.department', row, expected, 'Подразделение уже было изменено другим пользователем');
      }
      const employeeCount = await tx.query({
        sql: `
          SELECT COUNT(*) AS count
          FROM users
          WHERE deleted_at IS NULL
            AND department_id = ?
            AND LOWER(display_name) <> 'abyss'
        `,
        values: [departmentId],
        label: 'directories:department:employees-count'
      });
      const assignedEmployees = Number(employeeCount.rows?.[0]?.count || 0);
      if (assignedEmployees > 0) {
        throw directoryError(409, 'INVALID_STATE', `Нельзя удалить подразделение: есть сотрудники (${assignedEmployees}).`, {
          entity: 'directory.department',
          id: departmentId,
          expectedRev: expected,
          actualRev: normalizeRev(row.rev),
          entitySnapshot: rowToDepartment(row)
        });
      }
      const cardRefs = await this.countCardOperationRefs(tx, 'center', departmentId);
      if (cardRefs > 0) {
        throw directoryError(409, 'INVALID_STATE', `Нельзя удалить подразделение: оно используется в маршрутных картах (${cardRefs}).`, {
          entity: 'directory.department',
          id: departmentId,
          expectedRev: expected,
          actualRev: normalizeRev(row.rev),
          entitySnapshot: rowToDepartment(row)
        });
      }
      await tx.query({
        sql: 'UPDATE work_centers SET deleted_at = UTC_TIMESTAMP(3), rev = rev + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND rev = ?',
        values: [departmentId, expected],
        label: 'directories:department:delete'
      });
      return rowToDepartment(row);
    }, { label: 'directories:department:delete' });
  }

  async countCardOperationRefs(tx, type, id) {
    const jsonPath = type === 'center' ? '$.centerId' : '$.opId';
    const column = type === 'center' ? 'work_center_id' : 'operation_id';
    const result = await tx.query({
      sql: `
        SELECT COUNT(DISTINCT card_id) AS count
        FROM card_operations
        WHERE ${column} = ?
           OR JSON_UNQUOTE(JSON_EXTRACT(descriptive_attrs_json, ?)) = ?
      `,
      values: [id, jsonPath, id],
      label: `directories:card-${type}-refs`
    });
    return Number(result.rows?.[0]?.count || 0);
  }

  async createOperation(input) {
    const operation = {
      id: trimToString(input.id),
      code: trimToString(input.code),
      name: trimToString(input.name),
      desc: trimToString(input.desc),
      recTime: Math.max(1, Math.round(toNumber(input.recTime, 30))),
      operationType: trimToString(input.operationType) || 'Стандартная'
    };
    return this.inTransaction(async (tx) => {
      await this.assertOperationNameUnique(tx, operation.name, '');
      await tx.query({
        sql: `
          INSERT INTO operations (id, rev, code, name, description, operation_type, rec_time_minutes, created_at, updated_at)
          VALUES (?, 1, NULLIF(?, ''), ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
        `,
        values: [operation.id, operation.code, operation.name, operation.desc || null, operation.operationType, operation.recTime],
        label: 'directories:operation:create'
      });
      return rowToOperation(await this.findOperation(tx, operation.id), []);
    }, { label: 'directories:operation:create' });
  }

  async assertOperationNameUnique(tx, name, excludeId) {
    const result = await tx.query({
      sql: `
        SELECT id FROM operations
        WHERE deleted_at IS NULL
          AND LOWER(name) = LOWER(?)
          AND id <> ?
        LIMIT 1
      `,
      values: [trimToString(name), trimToString(excludeId)],
      label: 'directories:operation:name-unique'
    });
    if ((result.rows || []).length) {
      throw directoryError(409, 'DUPLICATE_NAME', 'Операция с таким названием уже существует.');
    }
  }

  async hasActivePlannedOperation(tx, operationId) {
    const result = await tx.query({
      sql: `
        SELECT COUNT(*) AS count
        FROM card_operations co
        INNER JOIN cards c ON c.id = co.card_id AND c.deleted_at IS NULL
        WHERE c.approval_stage IN ('PLANNING', 'PLANNED')
          AND (
            co.operation_id = ?
            OR JSON_UNQUOTE(JSON_EXTRACT(co.descriptive_attrs_json, '$.opId')) = ?
          )
          AND COALESCE(NULLIF(co.status, ''), JSON_UNQUOTE(JSON_EXTRACT(co.descriptive_attrs_json, '$.status')), 'NOT_STARTED') <> 'NOT_STARTED'
      `,
      values: [operationId, operationId],
      label: 'directories:operation:active-planned'
    });
    return Number(result.rows?.[0]?.count || 0) > 0;
  }

  async updateOperation(id, input) {
    const operationId = trimToString(id);
    const expectedRev = normalizeRev(input.expectedRev);
    return this.inTransaction(async (tx) => {
      const row = await this.findOperation(tx, operationId, { forUpdate: true });
      if (!row) throw directoryError(404, 'DIRECTORY_NOT_FOUND', 'Операция не найдена');
      if (normalizeRev(row.rev) !== expectedRev) {
        throw stale('directory.operation', row, expectedRev, 'Операция уже была изменена другим пользователем');
      }
      await this.assertOperationNameUnique(tx, input.name, operationId);
      const nextType = trimToString(input.operationType) || 'Стандартная';
      if ((trimToString(row.operation_type) || 'Стандартная') !== nextType && await this.hasActivePlannedOperation(tx, operationId)) {
        throw directoryError(409, 'INVALID_STATE', 'Нельзя изменить тип операции: есть запланированные МК с этой операцией в статусе не "Не начата".', {
          entity: 'directory.operation',
          id: operationId,
          expectedRev,
          actualRev: normalizeRev(row.rev),
          entitySnapshot: rowToOperation(row, row.allowedAreaIds || [])
        });
      }
      await tx.query({
        sql: `
          UPDATE operations
          SET name = ?, description = ?, operation_type = ?, rec_time_minutes = ?,
              rev = rev + 1, updated_at = UTC_TIMESTAMP(3)
          WHERE id = ? AND rev = ? AND deleted_at IS NULL
        `,
        values: [
          trimToString(input.name),
          trimToString(input.desc) || null,
          nextType,
          Math.max(1, Math.round(toNumber(input.recTime, 30))),
          operationId,
          expectedRev
        ],
        label: 'directories:operation:update'
      });
      const next = await this.findOperation(tx, operationId);
      return rowToOperation(next, next.allowedAreaIds || []);
    }, { label: 'directories:operation:update' });
  }

  async deleteOperation(id, expectedRev) {
    const operationId = trimToString(id);
    const expected = normalizeRev(expectedRev);
    return this.inTransaction(async (tx) => {
      const row = await this.findOperation(tx, operationId, { forUpdate: true });
      if (!row) throw directoryError(404, 'DIRECTORY_NOT_FOUND', 'Операция не найдена');
      if (normalizeRev(row.rev) !== expected) {
        throw stale('directory.operation', row, expected, 'Операция уже была изменена другим пользователем');
      }
      const cardRefs = await this.countCardOperationRefs(tx, 'operation', operationId);
      if (cardRefs > 0) {
        throw directoryError(409, 'INVALID_STATE', `Нельзя удалить операцию: она используется в маршрутных картах (${cardRefs}).`, {
          entity: 'directory.operation',
          id: operationId,
          expectedRev: expected,
          actualRev: normalizeRev(row.rev),
          entitySnapshot: rowToOperation(row, row.allowedAreaIds || [])
        });
      }
      await tx.query({
        sql: 'DELETE FROM operation_allowed_areas WHERE operation_id = ?',
        values: [operationId],
        label: 'directories:operation:delete-bindings'
      });
      await tx.query({
        sql: 'UPDATE operations SET deleted_at = UTC_TIMESTAMP(3), rev = rev + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND rev = ?',
        values: [operationId, expected],
        label: 'directories:operation:delete'
      });
      return rowToOperation(row, row.allowedAreaIds || []);
    }, { label: 'directories:operation:delete' });
  }

  async addOperationArea(operationId, areaId, expectedRev) {
    return this.mutateOperationArea(operationId, areaId, expectedRev, 'add');
  }

  async removeOperationArea(operationId, areaId, expectedRev) {
    return this.mutateOperationArea(operationId, areaId, expectedRev, 'remove');
  }

  async mutateOperationArea(operationId, areaId, expectedRev, mode) {
    const opId = trimToString(operationId);
    const targetAreaId = trimToString(areaId);
    const expected = normalizeRev(expectedRev);
    return this.inTransaction(async (tx) => {
      const row = await this.findOperation(tx, opId, { forUpdate: true });
      if (!row) throw directoryError(404, 'DIRECTORY_NOT_FOUND', 'Операция не найдена');
      if (normalizeRev(row.rev) !== expected) {
        throw stale('directory.operation', row, expected, 'Операция уже была изменена другим пользователем');
      }
      const area = await this.findArea(tx, targetAreaId);
      if (!area && mode === 'add') throw directoryError(404, 'AREA_NOT_FOUND', 'Участок не найден');
      const hasBinding = (row.allowedAreaIds || []).includes(targetAreaId);
      if (mode === 'add' && hasBinding) {
        throw directoryError(409, 'INVALID_STATE', `Участок уже добавлен: ${trimToString(area?.name || 'Участок')}`, {
          entity: 'directory.operation',
          id: opId,
          expectedRev: expected,
          actualRev: normalizeRev(row.rev),
          entitySnapshot: rowToOperation(row, row.allowedAreaIds || [])
        });
      }
      if (mode === 'remove' && !hasBinding) {
        throw directoryError(409, 'INVALID_STATE', 'Участок уже удалён из операции.', {
          entity: 'directory.operation',
          id: opId,
          expectedRev: expected,
          actualRev: normalizeRev(row.rev),
          entitySnapshot: rowToOperation(row, row.allowedAreaIds || [])
        });
      }
      if (mode === 'add') {
        await tx.query({
          sql: 'INSERT INTO operation_allowed_areas (operation_id, area_id) VALUES (?, ?)',
          values: [opId, targetAreaId],
          label: 'directories:operation-area:add'
        });
      } else {
        await tx.query({
          sql: 'DELETE FROM operation_allowed_areas WHERE operation_id = ? AND area_id = ?',
          values: [opId, targetAreaId],
          label: 'directories:operation-area:remove'
        });
      }
      await tx.query({
        sql: 'UPDATE operations SET rev = rev + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND rev = ?',
        values: [opId, expected],
        label: 'directories:operation-area:bump'
      });
      const next = await this.findOperation(tx, opId);
      return rowToOperation(next, next.allowedAreaIds || []);
    }, { label: `directories:operation-area:${mode}` });
  }

  async createArea(input) {
    const area = {
      id: trimToString(input.id),
      name: trimToString(input.name),
      desc: trimToString(input.desc),
      type: trimToString(input.type) || 'Производство'
    };
    return this.inTransaction(async (tx) => {
      await tx.query({
        sql: `
          INSERT INTO production_areas (id, rev, name, area_type, description, created_at, updated_at)
          VALUES (?, 1, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
        `,
        values: [area.id, area.name, area.type, area.desc || null],
        label: 'directories:area:create'
      });
      return rowToArea(await this.findArea(tx, area.id));
    }, { label: 'directories:area:create' });
  }

  async updateArea(id, input) {
    const areaId = trimToString(id);
    const expectedRev = normalizeRev(input.expectedRev);
    return this.inTransaction(async (tx) => {
      const row = await this.findArea(tx, areaId, { forUpdate: true });
      if (!row) throw directoryError(404, 'AREA_NOT_FOUND', 'Участок не найден');
      if (normalizeRev(row.rev) !== expectedRev) {
        throw stale('directory.area', row, expectedRev, 'Участок уже был изменён другим пользователем');
      }
      await tx.query({
        sql: `
          UPDATE production_areas
          SET name = ?, area_type = ?, description = ?, rev = rev + 1, updated_at = UTC_TIMESTAMP(3)
          WHERE id = ? AND rev = ? AND deleted_at IS NULL
        `,
        values: [trimToString(input.name), trimToString(input.type) || 'Производство', trimToString(input.desc) || null, areaId, expectedRev],
        label: 'directories:area:update'
      });
      return rowToArea(await this.findArea(tx, areaId));
    }, { label: 'directories:area:update' });
  }

  async getAreaDeleteBlockInfo(tx, areaId) {
    const planned = await tx.query({
      sql: 'SELECT COUNT(*) AS count FROM production_shift_tasks WHERE area_id = ?',
      values: [areaId],
      label: 'directories:area:planned-count'
    });
    const history = await tx.query({
      sql: `
        SELECT COUNT(DISTINCT id) AS count
        FROM production_flow_states
        WHERE current_area_id = ?
          AND flow_status IN ('GOOD', 'DEFECT', 'DELAYED')
      `,
      values: [areaId],
      label: 'directories:area:execution-count'
    });
    const plannedTasksCount = Number(planned.rows?.[0]?.count || 0);
    const executionHistoryCount = Number(history.rows?.[0]?.count || 0);
    return {
      blocked: plannedTasksCount > 0 || executionHistoryCount > 0,
      plannedTasksCount,
      executionHistoryCount
    };
  }

  async deleteArea(id, expectedRev, buildBlockMessage) {
    const areaId = trimToString(id);
    const expected = normalizeRev(expectedRev);
    return this.inTransaction(async (tx) => {
      const row = await this.findArea(tx, areaId, { forUpdate: true });
      if (!row) throw directoryError(404, 'AREA_NOT_FOUND', 'Участок не найден');
      if (normalizeRev(row.rev) !== expected) {
        throw stale('directory.area', row, expected, 'Участок уже был изменён другим пользователем');
      }
      const blockInfo = await this.getAreaDeleteBlockInfo(tx, areaId);
      if (blockInfo.blocked) {
        throw directoryError(409, 'INVALID_STATE', typeof buildBlockMessage === 'function'
          ? buildBlockMessage(blockInfo)
          : 'Нельзя удалить участок: есть текущее планирование или история выполнения.', {
          entity: 'directory.area',
          id: areaId,
          expectedRev: expected,
          actualRev: normalizeRev(row.rev),
          entitySnapshot: rowToArea(row)
        });
      }
      const boundOperations = await tx.query({
        sql: 'SELECT operation_id FROM operation_allowed_areas WHERE area_id = ? FOR UPDATE',
        values: [areaId],
        label: 'directories:area:bound-operations'
      });
      const operationIds = (boundOperations.rows || []).map(item => trimToString(item.operation_id)).filter(Boolean);
      if (operationIds.length) {
        await tx.query({
          sql: `
            UPDATE operations
            SET rev = rev + 1, updated_at = UTC_TIMESTAMP(3)
            WHERE id IN (${operationIds.map(() => '?').join(',')})
          `,
          values: operationIds,
          label: 'directories:area:bump-bound-operations'
        });
      }
      await tx.query({
        sql: 'DELETE FROM operation_allowed_areas WHERE area_id = ?',
        values: [areaId],
        label: 'directories:area:delete-bindings'
      });
      await tx.query({
        sql: 'DELETE FROM production_schedule WHERE area_id = ?',
        values: [areaId],
        label: 'directories:area:delete-schedule-assignments'
      });
      await tx.query({
        sql: 'UPDATE production_areas SET deleted_at = UTC_TIMESTAMP(3), rev = rev + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND rev = ?',
        values: [areaId, expected],
        label: 'directories:area:delete'
      });
      return rowToArea(row);
    }, { label: 'directories:area:delete' });
  }

  async assignEmployeeDepartment(userId, departmentId, expectedRev) {
    const targetUserId = trimToString(userId);
    const nextDepartmentId = trimToString(departmentId) || null;
    const expected = normalizeRev(expectedRev);
    return this.inTransaction(async (tx) => {
      const userResult = await tx.query({
        sql: 'SELECT id, rev, display_name, login, department_id FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
        values: [targetUserId],
        label: 'directories:employee:get-user'
      });
      const user = userResult.rows?.[0] || null;
      if (!user) throw directoryError(404, 'USER_NOT_FOUND', 'Пользователь не найден');
      if (normalizeRev(user.rev) !== expected) {
        throw createSqlConflict({
          code: 'STALE_REVISION',
          entity: 'directory.employee',
          id: targetUserId,
          expectedRev: expected,
          actualRev: normalizeRev(user.rev),
          message: 'Назначение сотрудника уже было изменено другим пользователем'
        });
      }
      if (nextDepartmentId) {
        const department = await this.findDepartment(tx, nextDepartmentId);
        if (!department) {
          throw createSqlConflict({
            code: 'INVALID_STATE',
            entity: 'directory.employee',
            id: targetUserId,
            expectedRev: expected,
            actualRev: normalizeRev(user.rev),
            message: 'Подразделение уже недоступно. Данные обновлены.'
          });
        }
      }
      await tx.query({
        sql: 'UPDATE users SET department_id = ?, rev = rev + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND rev = ?',
        values: [nextDepartmentId, targetUserId, expected],
        label: 'directories:employee:assign'
      });
      return { id: targetUserId, departmentId: nextDepartmentId };
    }, { label: 'directories:employee:assign' });
  }

  async updateShiftTimes(entries = []) {
    const normalized = entries.map((entry) => ({
      id: trimToString(entry.id || `shift_${entry.shift}`),
      shift: trimToString(entry.shift || entry.shiftCode || entry.id),
      timeFrom: toTimeText(entry.timeFrom) || '00:00:00',
      timeTo: toTimeText(entry.timeTo) || '00:00:00',
      lunchFrom: toTimeText(entry.lunchFrom),
      lunchTo: toTimeText(entry.lunchTo),
      expectedRev: normalizeRev(entry.expectedRev ?? entry.rev)
    })).filter(entry => entry.shift);

    return this.inTransaction(async (tx) => {
      const updated = [];
      for (const entry of normalized) {
        const result = await tx.query({
          sql: 'SELECT id, rev, shift_code FROM production_shift_times WHERE shift_code = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
          values: [entry.shift],
          label: 'directories:shift-time:get'
        });
        const row = result.rows?.[0] || null;
        if (row && normalizeRev(row.rev) !== entry.expectedRev) {
          throw createSqlConflict({
            code: 'STALE_REVISION',
            entity: 'directory.shift-time',
            id: trimToString(row.shift_code),
            expectedRev: entry.expectedRev,
            actualRev: normalizeRev(row.rev),
            message: 'Время смен уже было изменено другим пользователем'
          });
        }
        if (row) {
          await tx.query({
            sql: `
              UPDATE production_shift_times
              SET time_from = ?, time_to = ?, lunch_from = ?, lunch_to = ?,
                  rev = rev + 1, updated_at = UTC_TIMESTAMP(3)
              WHERE id = ? AND rev = ?
            `,
            values: [entry.timeFrom, entry.timeTo, entry.lunchFrom, entry.lunchTo, row.id, entry.expectedRev],
            label: 'directories:shift-time:update'
          });
        } else {
          await tx.query({
            sql: `
              INSERT INTO production_shift_times (
                id, rev, shift_code, time_from, time_to, lunch_from, lunch_to, created_at, updated_at
              ) VALUES (?, 1, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
            `,
            values: [entry.id, entry.shift, entry.timeFrom, entry.timeTo, entry.lunchFrom, entry.lunchTo],
            label: 'directories:shift-time:create'
          });
        }
        const next = await tx.query({
          sql: 'SELECT id, rev, shift_code, time_from, time_to, lunch_from, lunch_to FROM production_shift_times WHERE shift_code = ? AND deleted_at IS NULL LIMIT 1',
          values: [entry.shift],
          label: 'directories:shift-time:read-updated'
        });
        updated.push(rowToShiftTime(next.rows?.[0]));
      }
      return updated;
    }, { label: 'directories:shift-times:update' });
  }
}

module.exports = {
  DirectoriesRepository,
  rowToArea,
  rowToDepartment,
  rowToOperation,
  rowToShiftTime
};
