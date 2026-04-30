const { BaseRepository } = require('./baseRepository');
const { createSqlConflict } = require('../persistence/mysql/conflicts');
const { fromMysqlDateTime } = require('./cardsRepository');

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

function dateOnly(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value).trim();
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  return match ? match[1] : '';
}

function timeText(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(11, 16);
  const text = String(value).trim();
  return /^\d{1,2}:\d{2}/.test(text) ? text.slice(0, 5).padStart(5, '0') : null;
}

function shiftNumber(value) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
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
  return {
    id: trimToString(row.id),
    rev: normalizeRev(row.rev),
    date: dateOnly(row.shift_date),
    shift: shiftNumber(row.shift_code),
    timeFrom: timeText(row.time_from),
    timeTo: timeText(row.time_to),
    status: trimToString(row.status) || 'OPEN',
    openedBy: trimToString(row.opened_by_name || row.opened_by_user_id),
    openedByUserId: trimToString(row.opened_by_user_id),
    openedAt: fromMysqlDateTime(row.opened_at),
    closedBy: trimToString(row.closed_by_name || row.closed_by_user_id),
    closedByUserId: trimToString(row.closed_by_user_id),
    closedAt: fromMysqlDateTime(row.closed_at),
    lockedBy: trimToString(row.locked_by_name || row.locked_by_user_id),
    lockedByUserId: trimToString(row.locked_by_user_id),
    lockedAt: fromMysqlDateTime(row.locked_at),
    fixedBy: trimToString(row.fixed_by_name || row.fixed_by_user_id),
    fixedByUserId: trimToString(row.fixed_by_user_id),
    fixedAt: fromMysqlDateTime(row.fixed_at),
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

  async countPlanningRows() {
    const [schedule, masters, tasks, shifts] = await Promise.all([
      this.query({ sql: 'SELECT COUNT(*) AS count FROM production_schedule WHERE deleted_at IS NULL', values: [], label: 'production-planning:schedule:count' }),
      this.query({ sql: 'SELECT COUNT(*) AS count FROM production_shift_masters WHERE deleted_at IS NULL', values: [], label: 'production-planning:masters:count' }),
      this.query({ sql: 'SELECT COUNT(*) AS count FROM production_shift_tasks WHERE deleted_at IS NULL', values: [], label: 'production-planning:tasks:count' }),
      this.query({ sql: 'SELECT COUNT(*) AS count FROM production_shifts', values: [], label: 'production-planning:shifts:count' })
    ]);
    return {
      schedule: toNumber(schedule.rows?.[0]?.count),
      shiftMasters: toNumber(masters.rows?.[0]?.count),
      tasks: toNumber(tasks.rows?.[0]?.count),
      shifts: toNumber(shifts.rows?.[0]?.count)
    };
  }

  async readScheduleRows() {
    const [schedule, masters] = await Promise.all([
      this.query({
        sql: `
          SELECT id, rev, schedule_date, shift_code, employee_user_id, area_id,
                 time_from, time_to, assignment_type, source, note
          FROM production_schedule
          WHERE deleted_at IS NULL
          ORDER BY schedule_date, shift_code, area_id, employee_user_id
        `,
        values: [],
        label: 'production-planning:schedule:read'
      }),
      this.query({
        sql: `
          SELECT id, COALESCE(rev, 1) AS rev, shift_date, shift_code, master_user_id, source, note
          FROM production_shift_masters
          WHERE deleted_at IS NULL
          ORDER BY shift_date, shift_code, master_user_id
        `,
        values: [],
        label: 'production-planning:shift-masters:read'
      })
    ]);
    return [
      ...(schedule.rows || []).map(rowToSchedule),
      ...(masters.rows || []).map(rowToShiftMaster)
    ];
  }

  async readShiftTasks() {
    const result = await this.query({
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

  async readShifts() {
    const shifts = await this.query({
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
    const [logs, initialSnapshots, drafts, snapshots, history] = await Promise.all([
      this.query({
        sql: `
          SELECT l.*, u.display_name AS actor_name
          FROM production_shift_logs l
          LEFT JOIN users u ON u.id = l.actor_user_id
          WHERE l.shift_id IN (${placeholders})
          ORDER BY l.shift_id, l.created_at, l.id
        `,
        values: ids,
        label: 'production-planning:shift-logs:read'
      }),
      this.query({
        sql: `SELECT shift_id, snapshot_json FROM production_shift_initial_snapshot_archive WHERE shift_id IN (${placeholders})`,
        values: ids,
        label: 'production-planning:shift-initial:read'
      }),
      this.query({
        sql: `SELECT shift_id, draft_json FROM production_shift_close_draft_archive WHERE shift_id IN (${placeholders})`,
        values: ids,
        label: 'production-planning:shift-close-draft:read'
      }),
      this.query({
        sql: `SELECT id, shift_id, snapshot_json, created_at FROM production_shift_close_snapshots WHERE shift_id IN (${placeholders}) ORDER BY shift_id, created_at, id`,
        values: ids,
        label: 'production-planning:shift-close-snapshots:read'
      }),
      this.query({
        sql: `SELECT shift_id, snapshot_id, history_event, snapshot_json, created_at FROM production_shift_close_snapshot_history WHERE shift_id IN (${placeholders}) ORDER BY shift_id, created_at, id`,
        values: ids,
        label: 'production-planning:shift-close-history:read'
      })
    ]);

    const logsByShift = new Map();
    for (const log of logs.rows || []) {
      const shiftId = trimToString(log.shift_id);
      if (!logsByShift.has(shiftId)) logsByShift.set(shiftId, []);
      logsByShift.get(shiftId).push({
        id: trimToString(log.id),
        at: fromMysqlDateTime(log.created_at) || Date.now(),
        action: trimToString(log.action_type),
        userName: trimToString(log.actor_name || log.actor_user_id),
        createdBy: trimToString(log.actor_user_id),
        message: trimToString(log.message)
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
