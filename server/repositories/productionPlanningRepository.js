const crypto = require('crypto');
const { BaseRepository } = require('./baseRepository');
const { createSqlConflict } = require('../persistence/mysql/conflicts');
const { fromMysqlDateTime, toMysqlDateTime } = require('./cardsRepository');

const PLANNING_SLICE_KEY = 'production.planning';
const SHIFT_MASTER_AREA_ID = '__shift_master__';

function trimToString(value) {
  return value == null ? '' : String(value).trim();
}

function normalizeRev(value) {
  const rev = Number(value);
  return Number.isFinite(rev) && rev > 0 ? Math.floor(rev) : 1;
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toBoolean(value) {
  return value === true || value === 1 || value === '1';
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

const SHIFT_LOG_MESSAGE_MARKER = '__tspccShiftLog';

function serializeShiftLogMessage(log = {}) {
  return JSON.stringify({
    [SHIFT_LOG_MESSAGE_MARKER]: 1,
    object: trimToString(log.object || ''),
    targetId: log.targetId == null ? null : trimToString(log.targetId),
    field: log.field == null ? null : trimToString(log.field),
    oldValue: log.oldValue == null ? '' : String(log.oldValue),
    newValue: log.newValue == null ? '' : String(log.newValue),
    message: trimToString(log.message || '')
  });
}

function parseShiftLogMessage(value) {
  const parsed = parseJson(value, null);
  if (parsed && typeof parsed === 'object' && parsed[SHIFT_LOG_MESSAGE_MARKER]) {
    return {
      object: trimToString(parsed.object),
      targetId: parsed.targetId == null ? null : trimToString(parsed.targetId),
      field: parsed.field == null ? null : trimToString(parsed.field),
      oldValue: parsed.oldValue == null ? '' : String(parsed.oldValue),
      newValue: parsed.newValue == null ? '' : String(parsed.newValue),
      message: trimToString(parsed.message)
    };
  }
  return {
    object: '',
    targetId: null,
    field: null,
    oldValue: '',
    newValue: '',
    message: trimToString(value)
  };
}

function stableId(prefix, parts = []) {
  const hash = crypto
    .createHash('sha1')
    .update(parts.map(trimToString).join('|'))
    .digest('hex')
    .slice(0, 24);
  return `${prefix}_${hash}`;
}

function dateOnly(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value).trim();
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  return match ? match[1] : '';
}

function dateOrNull(value) {
  const text = dateOnly(value);
  return text || null;
}

function timeText(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(11, 16);
  const text = String(value).trim();
  return /^\d{1,2}:\d{2}/.test(text) ? text.slice(0, 5).padStart(5, '0') : null;
}

function timeOrNull(value) {
  const text = timeText(value);
  return text || null;
}

function shiftNumber(value) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function intOrNull(value) {
  const number = parseInt(value, 10);
  return Number.isFinite(number) ? number : null;
}

function rowToRevision(row, counters = {}) {
  return {
    entity: PLANNING_SLICE_KEY,
    rev: normalizeRev(row?.rev),
    source: 'production_planning_revisions',
    sliceKey: PLANNING_SLICE_KEY,
    counters
  };
}

function rowToSchedule(row) {
  return {
    id: trimToString(row.id),
    rev: normalizeRev(row.rev),
    date: dateOnly(row.schedule_date),
    shift: shiftNumber(row.shift_code),
    employeeId: trimToString(row.employee_user_id),
    areaId: trimToString(row.area_id),
    timeFrom: timeText(row.time_from),
    timeTo: timeText(row.time_to),
    assignmentStatus: trimToString(row.assignment_type),
    source: trimToString(row.source),
    note: trimToString(row.note)
  };
}

function rowToShiftMaster(row) {
  return {
    id: trimToString(row.id),
    rev: normalizeRev(row.rev),
    date: dateOnly(row.shift_date),
    shift: shiftNumber(row.shift_code),
    employeeId: trimToString(row.master_user_id),
    areaId: SHIFT_MASTER_AREA_ID,
    timeFrom: null,
    timeTo: null,
    assignmentStatus: 'SHIFT_MASTER',
    source: trimToString(row.source),
    note: trimToString(row.note)
  };
}

function rowToTask(row) {
  return {
    id: trimToString(row.id),
    rev: normalizeRev(row.rev),
    cardId: trimToString(row.card_id),
    routeOpId: trimToString(row.route_operation_id),
    opId: trimToString(row.operation_id),
    opName: trimToString(row.operation_name_snapshot),
    areaId: trimToString(row.area_id),
    date: dateOnly(row.shift_date),
    shift: shiftNumber(row.shift_code),
    quantity: row.planned_quantity == null ? undefined : Number(row.planned_quantity),
    plannedQuantity: row.planned_quantity == null ? undefined : Number(row.planned_quantity),
    plannedPartMinutes: row.planned_part_minutes == null ? undefined : Number(row.planned_part_minutes),
    plannedTotalMinutes: row.planned_total_minutes == null ? undefined : Number(row.planned_total_minutes),
    plannedPartQty: row.planned_part_qty == null ? undefined : Number(row.planned_part_qty),
    plannedTotalQty: row.planned_total_qty == null ? undefined : Number(row.planned_total_qty),
    minutesPerUnitSnapshot: row.minutes_per_unit_snapshot == null ? undefined : Number(row.minutes_per_unit_snapshot),
    remainingQtySnapshot: row.remaining_quantity_snapshot == null ? undefined : Number(row.remaining_quantity_snapshot),
    effectiveDeadlineSnapshot: dateOnly(row.effective_deadline_snapshot),
    cardPlannedCompletionDateSnapshot: dateOnly(row.card_planned_completion_date_snapshot),
    status: trimToString(row.status) || 'PLANNED',
    subcontractStatus: trimToString(row.subcontract_status),
    subcontractPartnerText: trimToString(row.subcontract_partner_text),
    subcontractChainId: trimToString(row.subcontract_chain_id),
    subcontractItemIds: parseJson(row.subcontract_item_ids_json, []),
    subcontractItemKind: trimToString(row.subcontract_item_kind),
    subcontractExtendedChain: toBoolean(row.subcontract_extended_chain),
    planningMode: trimToString(row.planning_mode).toUpperCase() === 'AUTO' ? 'AUTO' : 'MANUAL',
    autoPlanRunId: trimToString(row.auto_plan_run_id),
    workSegmentKey: trimToString(row.work_segment_key),
    plannedStartAt: row.planned_start_at == null ? undefined : Number(row.planned_start_at),
    plannedEndAt: row.planned_end_at == null ? undefined : Number(row.planned_end_at),
    sourceShiftDate: dateOnly(row.source_shift_date),
    sourceShift: row.source_shift_code == null ? undefined : shiftNumber(row.source_shift_code),
    fromShiftCloseTransfer: toBoolean(row.from_shift_close_transfer),
    shiftCloseSourceDate: dateOnly(row.shift_close_source_date),
    shiftCloseSourceShift: row.shift_close_source_shift_code == null ? undefined : shiftNumber(row.shift_close_source_shift_code),
    closePagePreview: toBoolean(row.close_page_preview),
    closePageRecordId: trimToString(row.close_page_record_id),
    closePageRowKey: trimToString(row.close_page_row_key),
    delayMinutes: row.delay_minutes == null ? undefined : Number(row.delay_minutes),
    lastPartialBatchApplied: toBoolean(row.last_partial_batch_applied),
    lastPartialBatchReason: trimToString(row.last_partial_batch_reason),
    createdAt: fromMysqlDateTime(row.created_at) || Date.now(),
    createdBy: trimToString(row.created_by_user_id)
  };
}

function rowToShift(row, logs = [], archives = {}) {
  const lockedAt = fromMysqlDateTime(row.locked_at);
  const fixedAt = fromMysqlDateTime(row.fixed_at);
  const status = trimToString(row.status) || 'OPEN';
  return {
    id: trimToString(row.id),
    rev: normalizeRev(row.rev),
    date: dateOnly(row.shift_date),
    shift: shiftNumber(row.shift_code),
    timeFrom: timeText(row.time_from),
    timeTo: timeText(row.time_to),
    status,
    openedBy: trimToString(row.opened_by_name || row.opened_by_user_id),
    openedByUserId: trimToString(row.opened_by_user_id),
    openedAt: fromMysqlDateTime(row.opened_at),
    closedBy: trimToString(row.closed_by_name || row.closed_by_user_id),
    closedByUserId: trimToString(row.closed_by_user_id),
    closedAt: fromMysqlDateTime(row.closed_at),
    lockedBy: trimToString(row.locked_by_name || row.locked_by_user_id),
    lockedByUserId: trimToString(row.locked_by_user_id),
    lockedAt,
    fixedBy: trimToString(row.fixed_by_name || row.fixed_by_user_id),
    fixedByUserId: trimToString(row.fixed_by_user_id),
    fixedAt,
    isFixed: Boolean(lockedAt || fixedAt || status.toUpperCase() === 'LOCKED'),
    note: trimToString(row.note),
    logs,
    initialSnapshot: archives.initialSnapshot || null,
    closePageDraft: archives.closePageDraft || null,
    closePageSnapshot: archives.closePageSnapshot || null,
    closePageSnapshotHistory: archives.closePageSnapshotHistory || []
  };
}

class ProductionPlanningRepository extends BaseRepository {
  constructor(options = {}) {
    super({ ...options, domain: 'production-planning' });
  }

  async readPlanningRevision(options = {}) {
    const target = options.tx || this;
    const result = await target.query({
      sql: 'SELECT slice_key, rev FROM production_planning_revisions WHERE slice_key = ? LIMIT 1',
      values: [PLANNING_SLICE_KEY],
      label: 'production-planning:revision:read'
    });
    return rowToRevision(result.rows?.[0] || { rev: 1 }, options.counters || {});
  }

  async lockPlanningRevision(tx) {
    const result = await tx.query({
      sql: 'SELECT slice_key, rev FROM production_planning_revisions WHERE slice_key = ? LIMIT 1 FOR UPDATE',
      values: [PLANNING_SLICE_KEY],
      label: 'production-planning:revision:lock'
    });
    return result.rows?.[0] || { slice_key: PLANNING_SLICE_KEY, rev: 1 };
  }

  comparePlanningRevision(row, expectedRev) {
    const actualRev = normalizeRev(row?.rev);
    const expected = Number(expectedRev);
    if (Number.isFinite(expected) && expected === actualRev) return { ok: true, actualRev };
    throw createSqlConflict({
      code: 'STALE_REVISION',
      entity: PLANNING_SLICE_KEY,
      id: PLANNING_SLICE_KEY,
      expectedRev,
      actualRev,
      message: 'Данные планирования устарели'
    });
  }

  async incrementPlanningRevision(tx, expectedRev) {
    const row = await this.lockPlanningRevision(tx);
    this.comparePlanningRevision(row, expectedRev);
    await tx.query({
      sql: `
        INSERT INTO production_planning_revisions (slice_key, rev, description, created_at, updated_at)
        VALUES (?, 2, 'Production planning SQL aggregate revision', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE rev = rev + 1, updated_at = UTC_TIMESTAMP(3)
      `,
      values: [PLANNING_SLICE_KEY],
      label: 'production-planning:revision:increment'
    });
    return this.readPlanningRevision({ tx });
  }

  async lockAndComparePlanningRevision(tx, expectedRev) {
    const row = await this.lockPlanningRevision(tx);
    this.comparePlanningRevision(row, expectedRev);
    return row;
  }

  async bumpPlanningRevisionAfterMutation(tx, lockedRow) {
    const currentRev = normalizeRev(lockedRow?.rev);
    await tx.query({
      sql: `
        INSERT INTO production_planning_revisions (slice_key, rev, description, created_at, updated_at)
        VALUES (?, 2, 'Production planning SQL aggregate revision', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE rev = rev + 1, updated_at = UTC_TIMESTAMP(3)
      `,
      values: [PLANNING_SLICE_KEY],
      label: 'production-planning:revision:bump'
    });
    const revision = await this.readPlanningRevision({ tx });
    if (normalizeRev(revision.rev) <= currentRev) {
      throw new Error('Planning revision was not incremented.');
    }
    return revision;
  }

  async countPlanningRows(options = {}) {
    const target = options.tx || this;
    const readCounts = async () => ({
      schedule: await target.query({ sql: 'SELECT COUNT(*) AS count FROM production_schedule WHERE deleted_at IS NULL', values: [], label: 'production-planning:schedule:count' }),
      masters: await target.query({ sql: 'SELECT COUNT(*) AS count FROM production_shift_masters WHERE deleted_at IS NULL', values: [], label: 'production-planning:masters:count' }),
      tasks: await target.query({ sql: 'SELECT COUNT(*) AS count FROM production_shift_tasks WHERE deleted_at IS NULL', values: [], label: 'production-planning:tasks:count' }),
      shifts: await target.query({ sql: 'SELECT COUNT(*) AS count FROM production_shifts', values: [], label: 'production-planning:shifts:count' })
    });
    const counts = options.tx
      ? await readCounts()
      : await Promise.all([
          target.query({ sql: 'SELECT COUNT(*) AS count FROM production_schedule WHERE deleted_at IS NULL', values: [], label: 'production-planning:schedule:count' }),
          target.query({ sql: 'SELECT COUNT(*) AS count FROM production_shift_masters WHERE deleted_at IS NULL', values: [], label: 'production-planning:masters:count' }),
          target.query({ sql: 'SELECT COUNT(*) AS count FROM production_shift_tasks WHERE deleted_at IS NULL', values: [], label: 'production-planning:tasks:count' }),
          target.query({ sql: 'SELECT COUNT(*) AS count FROM production_shifts', values: [], label: 'production-planning:shifts:count' })
        ]).then(([schedule, masters, tasks, shifts]) => ({ schedule, masters, tasks, shifts }));
    return {
      schedule: toNumber(counts.schedule.rows?.[0]?.count),
      shiftMasters: toNumber(counts.masters.rows?.[0]?.count),
      tasks: toNumber(counts.tasks.rows?.[0]?.count),
      shifts: toNumber(counts.shifts.rows?.[0]?.count)
    };
  }

  async readScheduleRows(options = {}) {
    const target = options.tx || this;
    const readSchedule = () => target.query({
        sql: `
          SELECT id, rev, schedule_date, shift_code, employee_user_id, area_id,
                 time_from, time_to, assignment_type, source, note
          FROM production_schedule
          WHERE deleted_at IS NULL
          ORDER BY schedule_date, shift_code, area_id, employee_user_id
        `,
        values: [],
        label: 'production-planning:schedule:read'
      });
    const readMasters = () => target.query({
        sql: `
          SELECT id, COALESCE(rev, 1) AS rev, shift_date, shift_code, master_user_id, source, note
          FROM production_shift_masters
          WHERE deleted_at IS NULL
          ORDER BY shift_date, shift_code, master_user_id
        `,
        values: [],
        label: 'production-planning:shift-masters:read'
      });
    const [schedule, masters] = options.tx
      ? [await readSchedule(), await readMasters()]
      : await Promise.all([readSchedule(), readMasters()]);
    return [
      ...(schedule.rows || []).map(rowToSchedule),
      ...(masters.rows || []).map(rowToShiftMaster)
    ];
  }

  async readShiftTasks(options = {}) {
    const target = options.tx || this;
    const result = await target.query({
      sql: `
        SELECT
          pst.*,
          COALESCE(o.name, co.operation_name_snapshot) AS operation_name_snapshot
        FROM production_shift_tasks pst
        LEFT JOIN operations o ON o.id = pst.operation_id
        LEFT JOIN card_operations co ON co.id = pst.route_operation_id
        WHERE pst.deleted_at IS NULL
        ORDER BY pst.shift_date, pst.shift_code, pst.area_id, pst.card_id, pst.route_operation_id
      `,
      values: [],
      label: 'production-planning:shift-tasks:read'
    });
    return (result.rows || []).map(rowToTask);
  }

  async readShifts(options = {}) {
    const target = options.tx || this;
    const shifts = await target.query({
      sql: `
        SELECT ps.*,
               opened.display_name AS opened_by_name,
               closed.display_name AS closed_by_name,
               locked.display_name AS locked_by_name,
               fixed.display_name AS fixed_by_name
        FROM production_shifts ps
        LEFT JOIN users opened ON opened.id = ps.opened_by_user_id
        LEFT JOIN users closed ON closed.id = ps.closed_by_user_id
        LEFT JOIN users locked ON locked.id = ps.locked_by_user_id
        LEFT JOIN users fixed ON fixed.id = ps.fixed_by_user_id
        ORDER BY ps.shift_date, ps.shift_code
      `,
      values: [],
      label: 'production-planning:shifts:read'
    });
    const ids = (shifts.rows || []).map(row => trimToString(row.id)).filter(Boolean);
    if (!ids.length) return [];
    const placeholders = ids.map(() => '?').join(',');
    const readLogs = () => target.query({
        sql: `
          SELECT l.*, u.display_name AS actor_name
          FROM production_shift_logs l
          LEFT JOIN users u ON u.id = l.actor_user_id
          WHERE l.shift_id IN (${placeholders})
          ORDER BY l.shift_id, l.created_at, l.id
        `,
        values: ids,
        label: 'production-planning:shift-logs:read'
      });
    const readInitialSnapshots = () => target.query({
        sql: `SELECT shift_id, snapshot_json FROM production_shift_initial_snapshot_archive WHERE shift_id IN (${placeholders})`,
        values: ids,
        label: 'production-planning:shift-initial:read'
      });
    const readDrafts = () => target.query({
        sql: `SELECT shift_id, draft_json FROM production_shift_close_draft_archive WHERE shift_id IN (${placeholders})`,
        values: ids,
        label: 'production-planning:shift-close-draft:read'
      });
    const readSnapshots = () => target.query({
        sql: `SELECT id, shift_id, snapshot_json, created_at FROM production_shift_close_snapshots WHERE shift_id IN (${placeholders}) ORDER BY shift_id, created_at, id`,
        values: ids,
        label: 'production-planning:shift-close-snapshots:read'
      });
    const readHistory = () => target.query({
        sql: `SELECT shift_id, snapshot_id, history_event, snapshot_json, created_at FROM production_shift_close_snapshot_history WHERE shift_id IN (${placeholders}) ORDER BY shift_id, created_at, id`,
        values: ids,
        label: 'production-planning:shift-close-history:read'
      });
    const [logs, initialSnapshots, drafts, snapshots, history] = options.tx
      ? [
          await readLogs(),
          await readInitialSnapshots(),
          await readDrafts(),
          await readSnapshots(),
          await readHistory()
        ]
      : await Promise.all([readLogs(), readInitialSnapshots(), readDrafts(), readSnapshots(), readHistory()]);

    const logsByShift = new Map();
    for (const log of logs.rows || []) {
      const shiftId = trimToString(log.shift_id);
      if (!logsByShift.has(shiftId)) logsByShift.set(shiftId, []);
      const message = parseShiftLogMessage(log.message);
      logsByShift.get(shiftId).push({
        id: trimToString(log.id),
        at: fromMysqlDateTime(log.created_at) || Date.now(),
        action: trimToString(log.action_type),
        object: message.object,
        targetId: message.targetId,
        field: message.field,
        oldValue: message.oldValue,
        newValue: message.newValue,
        userName: trimToString(log.actor_name || log.actor_user_id),
        createdBy: trimToString(log.actor_user_id),
        message: message.message
      });
    }

    const archiveByShift = new Map(ids.map(id => [id, {
      initialSnapshot: null,
      closePageDraft: null,
      closePageSnapshot: null,
      closePageSnapshotHistory: []
    }]));
    for (const row of initialSnapshots.rows || []) {
      archiveByShift.get(trimToString(row.shift_id)).initialSnapshot = parseJson(row.snapshot_json, null);
    }
    for (const row of drafts.rows || []) {
      archiveByShift.get(trimToString(row.shift_id)).closePageDraft = parseJson(row.draft_json, null);
    }
    for (const row of snapshots.rows || []) {
      const archive = archiveByShift.get(trimToString(row.shift_id));
      const snapshot = parseJson(row.snapshot_json, null);
      if (snapshot) archive.closePageSnapshot = snapshot;
    }
    for (const row of history.rows || []) {
      const archive = archiveByShift.get(trimToString(row.shift_id));
      const snapshot = parseJson(row.snapshot_json, null);
      if (snapshot) archive.closePageSnapshotHistory.push(snapshot);
    }

    return (shifts.rows || []).map(row => rowToShift(
      row,
      logsByShift.get(trimToString(row.id)) || [],
      archiveByShift.get(trimToString(row.id)) || {}
    ));
  }

  async replaceScheduleAssignments(tx, scheduleRows = []) {
    const rows = Array.isArray(scheduleRows) ? scheduleRows : [];
    const regularRows = [];
    const masterRows = [];
    for (const row of rows) {
      const normalized = row || {};
      if (trimToString(normalized.areaId) === SHIFT_MASTER_AREA_ID
        || trimToString(normalized.assignmentStatus).toUpperCase() === 'SHIFT_MASTER') {
        masterRows.push(normalized);
      } else {
        regularRows.push(normalized);
      }
    }

    await tx.query({
      sql: 'DELETE FROM production_schedule',
      values: [],
      label: 'production-planning:schedule:clear'
    });
    await tx.query({
      sql: 'DELETE FROM production_shift_masters',
      values: [],
      label: 'production-planning:shift-masters:clear'
    });

    for (const row of regularRows) {
      const id = trimToString(row.id) || stableId('ps', [row.date, row.shift, row.areaId, row.employeeId]);
      await tx.query({
        sql: `
          INSERT INTO production_schedule (
            id, rev, schedule_date, shift_code, employee_user_id, area_id,
            time_from, time_to, assignment_type, source, note, created_at, updated_at, deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), NULL)
        `,
        values: [
          id,
          normalizeRev(row.rev),
          dateOrNull(row.date),
          String(shiftNumber(row.shift)),
          trimToString(row.employeeId),
          trimToString(row.areaId),
          timeOrNull(row.timeFrom),
          timeOrNull(row.timeTo),
          trimToString(row.assignmentStatus) || null,
          trimToString(row.source || 'sql-planning-write') || null,
          trimToString(row.note) || null
        ],
        label: 'production-planning:schedule:insert'
      });
    }

    for (const row of masterRows) {
      const id = trimToString(row.id) || stableId('psm', [row.date, row.shift, row.employeeId]);
      await tx.query({
        sql: `
          INSERT INTO production_shift_masters (
            id, rev, shift_date, shift_code, master_user_id, source, note, created_at, updated_at, deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), NULL)
        `,
        values: [
          id,
          normalizeRev(row.rev),
          dateOrNull(row.date),
          String(shiftNumber(row.shift)),
          trimToString(row.employeeId),
          trimToString(row.source || 'sql-planning-write') || null,
          trimToString(row.note) || null
        ],
        label: 'production-planning:shift-master:insert'
      });
    }
  }

  async replaceShiftTasks(tx, taskRows = []) {
    const rows = (Array.isArray(taskRows) ? taskRows : [])
      .map(rowToTaskInput)
      .filter(row => row.id && row.cardId && row.routeOpId && row.areaId && row.date);
    const activeIds = rows.map(row => row.id);
    let validOperationIds = new Set();
    const requestedOperationIds = Array.from(new Set(rows.map(row => trimToString(row.opId)).filter(Boolean)));
    if (requestedOperationIds.length) {
      const placeholders = requestedOperationIds.map(() => '?').join(',');
      const result = await tx.query({
        sql: `SELECT id FROM operations WHERE id IN (${placeholders})`,
        values: requestedOperationIds,
        label: 'production-planning:tasks:valid-ops'
      });
      validOperationIds = new Set((result.rows || []).map(row => trimToString(row.id)).filter(Boolean));
    }

    for (const row of rows) {
      await tx.query({
        sql: `
          INSERT INTO production_shift_tasks (
            id, rev, card_id, route_operation_id, operation_id, operation_name_snapshot,
            area_id, shift_date, shift_code, planned_quantity, planned_part_minutes,
            planned_total_minutes, planned_part_qty, planned_total_qty,
            minutes_per_unit_snapshot, remaining_quantity_snapshot,
            effective_deadline_snapshot, status, subcontract_status,
            subcontract_partner_text, planning_mode, auto_plan_run_id, work_segment_key,
            planned_start_at, planned_end_at, source_shift_date, source_shift_code,
            from_shift_close_transfer, shift_close_source_date,
            shift_close_source_shift_code, close_page_preview, close_page_record_id,
            close_page_row_key, delay_minutes, card_planned_completion_date_snapshot,
            last_partial_batch_applied, last_partial_batch_reason,
            subcontract_chain_id, subcontract_item_ids_json, subcontract_item_kind,
            subcontract_extended_chain, created_at, updated_at, deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), NULL)
          ON DUPLICATE KEY UPDATE
            rev = VALUES(rev),
            operation_id = VALUES(operation_id),
            operation_name_snapshot = VALUES(operation_name_snapshot),
            area_id = VALUES(area_id),
            shift_date = VALUES(shift_date),
            shift_code = VALUES(shift_code),
            planned_quantity = VALUES(planned_quantity),
            planned_part_minutes = VALUES(planned_part_minutes),
            planned_total_minutes = VALUES(planned_total_minutes),
            planned_part_qty = VALUES(planned_part_qty),
            planned_total_qty = VALUES(planned_total_qty),
            minutes_per_unit_snapshot = VALUES(minutes_per_unit_snapshot),
            remaining_quantity_snapshot = VALUES(remaining_quantity_snapshot),
            effective_deadline_snapshot = VALUES(effective_deadline_snapshot),
            status = VALUES(status),
            subcontract_status = VALUES(subcontract_status),
            subcontract_partner_text = VALUES(subcontract_partner_text),
            planning_mode = VALUES(planning_mode),
            auto_plan_run_id = VALUES(auto_plan_run_id),
            work_segment_key = VALUES(work_segment_key),
            planned_start_at = VALUES(planned_start_at),
            planned_end_at = VALUES(planned_end_at),
            source_shift_date = VALUES(source_shift_date),
            source_shift_code = VALUES(source_shift_code),
            from_shift_close_transfer = VALUES(from_shift_close_transfer),
            shift_close_source_date = VALUES(shift_close_source_date),
            shift_close_source_shift_code = VALUES(shift_close_source_shift_code),
            close_page_preview = VALUES(close_page_preview),
            close_page_record_id = VALUES(close_page_record_id),
            close_page_row_key = VALUES(close_page_row_key),
            delay_minutes = VALUES(delay_minutes),
            card_planned_completion_date_snapshot = VALUES(card_planned_completion_date_snapshot),
            last_partial_batch_applied = VALUES(last_partial_batch_applied),
            last_partial_batch_reason = VALUES(last_partial_batch_reason),
            subcontract_chain_id = VALUES(subcontract_chain_id),
            subcontract_item_ids_json = VALUES(subcontract_item_ids_json),
            subcontract_item_kind = VALUES(subcontract_item_kind),
            subcontract_extended_chain = VALUES(subcontract_extended_chain),
            updated_at = UTC_TIMESTAMP(3),
            deleted_at = NULL
        `,
        values: [
          row.id,
          normalizeRev(row.rev),
          row.cardId,
          row.routeOpId,
          validOperationIds.has(row.opId) ? row.opId : null,
          row.opName || null,
          row.areaId,
          dateOrNull(row.date),
          String(shiftNumber(row.shift)),
          positiveNumberOrNull(row.quantity || row.plannedQuantity || row.plannedPartQty),
          intOrNull(row.plannedPartMinutes),
          intOrNull(row.plannedTotalMinutes),
          positiveNumberOrNull(row.plannedPartQty),
          positiveNumberOrNull(row.plannedTotalQty),
          positiveNumberOrNull(row.minutesPerUnitSnapshot),
          positiveNumberOrNull(row.remainingQtySnapshot),
          dateOrNull(row.effectiveDeadlineSnapshot),
          trimToString(row.status || 'PLANNED') || 'PLANNED',
          trimToString(row.subcontractStatus) || null,
          trimToString(row.subcontractPartnerText) || null,
          trimToString(row.planningMode).toUpperCase() === 'AUTO' ? 'AUTO' : 'MANUAL',
          trimToString(row.autoPlanRunId) || null,
          trimToString(row.workSegmentKey) || null,
          numberOrNull(row.plannedStartAt),
          numberOrNull(row.plannedEndAt),
          dateOrNull(row.sourceShiftDate),
          row.sourceShift == null ? null : String(shiftNumber(row.sourceShift)),
          row.fromShiftCloseTransfer === true ? 1 : 0,
          dateOrNull(row.shiftCloseSourceDate),
          row.shiftCloseSourceShift == null ? null : String(shiftNumber(row.shiftCloseSourceShift)),
          row.closePagePreview === true ? 1 : 0,
          trimToString(row.closePageRecordId) || null,
          trimToString(row.closePageRowKey) || null,
          intOrNull(row.delayMinutes),
          dateOrNull(row.cardPlannedCompletionDateSnapshot),
          row.lastPartialBatchApplied === true ? 1 : 0,
          trimToString(row.lastPartialBatchReason) || null,
          trimToString(row.subcontractChainId) || null,
          Array.isArray(row.subcontractItemIds) && row.subcontractItemIds.length
            ? JSON.stringify(row.subcontractItemIds)
            : null,
          trimToString(row.subcontractItemKind) || null,
          row.subcontractExtendedChain === true ? 1 : 0,
          toMysqlDateTime(row.createdAt) || toMysqlDateTime(Date.now())
        ],
        label: 'production-planning:task:upsert'
      });
    }

    if (activeIds.length) {
      const placeholders = activeIds.map(() => '?').join(',');
      await tx.query({
        sql: `UPDATE production_shift_tasks SET deleted_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3) WHERE id NOT IN (${placeholders}) AND deleted_at IS NULL`,
        values: activeIds,
        label: 'production-planning:tasks:soft-delete-missing'
      });
    } else {
      await tx.query({
        sql: 'UPDATE production_shift_tasks SET deleted_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3) WHERE deleted_at IS NULL',
        values: [],
        label: 'production-planning:tasks:soft-delete-all'
      });
    }
  }

  async resolveUserIdMap(tx, values = []) {
    const names = Array.from(new Set(
      (Array.isArray(values) ? values : [])
        .map(trimToString)
        .filter(Boolean)
    ));
    if (!names.length) return new Map();
    const placeholders = names.map(() => '?').join(',');
    const result = await tx.query({
      sql: `
        SELECT id, login, display_name
        FROM users
        WHERE deleted_at IS NULL
          AND (id IN (${placeholders}) OR login IN (${placeholders}) OR display_name IN (${placeholders}))
      `,
      values: [...names, ...names, ...names],
      label: 'production-planning:users:resolve'
    });
    const map = new Map();
    for (const row of result.rows || []) {
      const id = trimToString(row.id);
      if (!id) continue;
      [row.id, row.login, row.display_name].forEach((value) => {
        const key = trimToString(value);
        if (key && !map.has(key)) map.set(key, id);
      });
    }
    return map;
  }

  async replaceShifts(tx, shiftRows = []) {
    const rows = Array.isArray(shiftRows) ? shiftRows : [];
    const activeIds = rows.map(row => trimToString(row?.id)).filter(Boolean);
    const userMap = await this.resolveUserIdMap(tx, rows.flatMap(row => [
      row?.openedByUserId,
      row?.openedBy,
      row?.closedByUserId,
      row?.closedBy,
      row?.lockedByUserId,
      row?.lockedBy,
      row?.fixedByUserId,
      row?.fixedBy,
      ...(Array.isArray(row?.logs) ? row.logs.flatMap(log => [log?.createdBy, log?.userName]) : []),
      row?.closePageDraft?.updatedBy,
      row?.closePageSnapshot?.createdBy,
      ...(Array.isArray(row?.closePageSnapshotHistory) ? row.closePageSnapshotHistory.map(item => item?.createdBy) : [])
    ]));
    const userId = (value) => userMap.get(trimToString(value)) || null;

    await tx.query({ sql: 'DELETE FROM production_shift_close_snapshot_history', values: [], label: 'production-planning:shift-close-history:clear' });
    await tx.query({ sql: 'DELETE FROM production_shift_close_snapshots', values: [], label: 'production-planning:shift-close-snapshots:clear' });
    await tx.query({ sql: 'DELETE FROM production_shift_close_draft_archive', values: [], label: 'production-planning:shift-close-drafts:clear' });
    await tx.query({ sql: 'DELETE FROM production_shift_initial_snapshot_archive', values: [], label: 'production-planning:shift-initial:clear' });
    await tx.query({ sql: 'DELETE FROM production_shift_logs', values: [], label: 'production-planning:shift-logs:clear' });

    for (const row of rows) {
      const id = trimToString(row.id) || stableId('shift', [row.date, row.shift]);
      await tx.query({
        sql: `
          INSERT INTO production_shifts (
            id, rev, shift_date, shift_code, status,
            opened_by_user_id, opened_at, closed_by_user_id, closed_at,
            locked_by_user_id, locked_at, fixed_by_user_id, fixed_at,
            note, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
          ON DUPLICATE KEY UPDATE
            rev = VALUES(rev),
            shift_date = VALUES(shift_date),
            shift_code = VALUES(shift_code),
            status = VALUES(status),
            opened_by_user_id = VALUES(opened_by_user_id),
            opened_at = VALUES(opened_at),
            closed_by_user_id = VALUES(closed_by_user_id),
            closed_at = VALUES(closed_at),
            locked_by_user_id = VALUES(locked_by_user_id),
            locked_at = VALUES(locked_at),
            fixed_by_user_id = VALUES(fixed_by_user_id),
            fixed_at = VALUES(fixed_at),
            note = VALUES(note),
            updated_at = UTC_TIMESTAMP(3)
        `,
        values: [
          id,
          normalizeRev(row.rev),
          dateOrNull(row.date),
          String(shiftNumber(row.shift)),
          trimToString(row.status || 'PLANNING') || 'PLANNING',
          userId(row.openedByUserId || row.openedBy),
          toMysqlDateTime(row.openedAt),
          userId(row.closedByUserId || row.closedBy),
          toMysqlDateTime(row.closedAt),
          userId(row.lockedByUserId || row.lockedBy),
          toMysqlDateTime(row.lockedAt),
          userId(row.fixedByUserId || row.fixedBy),
          toMysqlDateTime(row.fixedAt),
          trimToString(row.note) || null
        ],
        label: 'production-planning:shift:upsert'
      });

      for (const [index, log] of (Array.isArray(row.logs) ? row.logs : []).entries()) {
        await tx.query({
          sql: `
            INSERT INTO production_shift_logs (id, shift_id, actor_user_id, action_type, message, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `,
          values: [
            trimToString(log.id) || stableId('psl', [id, index, log.at, log.action]),
            id,
            userId(log.createdBy || log.userName),
            trimToString(log.action || 'log') || 'log',
            serializeShiftLogMessage(log),
            toMysqlDateTime(log.at || log.ts || log.createdAt) || toMysqlDateTime(Date.now())
          ],
          label: 'production-planning:shift-log:insert'
        });
      }

      if (row.initialSnapshot) {
        await tx.query({
          sql: `
            INSERT INTO production_shift_initial_snapshot_archive (shift_id, snapshot_json)
            VALUES (?, ?)
            ON DUPLICATE KEY UPDATE snapshot_json = VALUES(snapshot_json), imported_at = UTC_TIMESTAMP(3)
          `,
          values: [id, JSON.stringify(row.initialSnapshot)],
          label: 'production-planning:shift-initial:upsert'
        });
      }

      if (row.closePageDraft) {
        await tx.query({
          sql: `
            INSERT INTO production_shift_close_draft_archive (shift_id, rev, draft_json, updated_by_user_id, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              rev = VALUES(rev),
              draft_json = VALUES(draft_json),
              updated_by_user_id = VALUES(updated_by_user_id),
              updated_at = VALUES(updated_at)
          `,
          values: [
            id,
            normalizeRev(row.closePageDraft.rev),
            JSON.stringify(row.closePageDraft),
            userId(row.closePageDraft.updatedBy),
            toMysqlDateTime(row.closePageDraft.updatedAt) || toMysqlDateTime(Date.now())
          ],
          label: 'production-planning:shift-close-draft:upsert'
        });
      }

      const snapshots = [];
      if (row.closePageSnapshot) snapshots.push(row.closePageSnapshot);
      for (const item of (Array.isArray(row.closePageSnapshotHistory) ? row.closePageSnapshotHistory : [])) {
        if (item && !snapshots.some(existing => JSON.stringify(existing) === JSON.stringify(item))) snapshots.push(item);
      }
      let lastSnapshotId = null;
      for (const [index, snapshot] of snapshots.entries()) {
        const snapshotId = trimToString(snapshot?.id) || stableId('psc', [id, index, snapshot?.savedAt, snapshot?.createdAt, JSON.stringify(snapshot)]);
        lastSnapshotId = snapshotId;
        await tx.query({
          sql: `
            INSERT INTO production_shift_close_snapshots (id, shift_id, snapshot_json, created_by_user_id, created_at)
            VALUES (?, ?, ?, ?, ?)
          `,
          values: [
            snapshotId,
            id,
            JSON.stringify(snapshot),
            userId(snapshot?.createdBy || snapshot?.savedBy),
            toMysqlDateTime(snapshot?.createdAt || snapshot?.savedAt) || toMysqlDateTime(Date.now())
          ],
          label: 'production-planning:shift-close-snapshot:insert'
        });
        await tx.query({
          sql: `
            INSERT INTO production_shift_close_snapshot_history (
              id, shift_id, snapshot_id, history_event, snapshot_json, created_by_user_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
          values: [
            trimToString(snapshot?.historyId) || stableId('psh', [id, snapshotId, index]),
            id,
            snapshotId,
            trimToString(snapshot?.event || snapshot?.type || 'snapshot') || 'snapshot',
            JSON.stringify(snapshot),
            userId(snapshot?.createdBy || snapshot?.savedBy),
            toMysqlDateTime(snapshot?.createdAt || snapshot?.savedAt) || toMysqlDateTime(Date.now())
          ],
          label: 'production-planning:shift-close-history:insert'
        });
      }

      if (row.closePageSnapshot && !snapshots.length && lastSnapshotId) {
        void lastSnapshotId;
      }
    }

    if (activeIds.length) {
      const placeholders = activeIds.map(() => '?').join(',');
      await tx.query({
        sql: `DELETE FROM production_shifts WHERE id NOT IN (${placeholders})`,
        values: activeIds,
        label: 'production-planning:shifts:delete-missing'
      });
    } else {
      await tx.query({
        sql: 'DELETE FROM production_shifts',
        values: [],
        label: 'production-planning:shifts:delete-all'
      });
    }
  }
}

function rowToTaskInput(row = {}) {
  return {
    ...row,
    id: trimToString(row.id) || stableId('pst', [row.cardId, row.routeOpId, row.date, row.shift, row.areaId, row.subcontractChainId, row.workSegmentKey]),
    cardId: trimToString(row.cardId),
    routeOpId: trimToString(row.routeOpId),
    opId: trimToString(row.opId),
    opName: trimToString(row.opName),
    areaId: trimToString(row.areaId),
    date: dateOnly(row.date),
    shift: shiftNumber(row.shift),
    subcontractItemIds: Array.isArray(row.subcontractItemIds) ? row.subcontractItemIds.map(trimToString).filter(Boolean) : []
  };
}

module.exports = {
  ProductionPlanningRepository,
  PLANNING_SLICE_KEY,
  SHIFT_MASTER_AREA_ID,
  rowToRevision,
  rowToSchedule,
  rowToShiftMaster,
  rowToTask,
  rowToShift
};
