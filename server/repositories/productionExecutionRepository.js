const crypto = require('crypto');
const { BaseRepository } = require('./baseRepository');
const { createSqlConflict } = require('../persistence/mysql/conflicts');
const { toMysqlDateTime } = require('./cardsRepository');

function trimToString(value) {
  return value == null ? '' : String(value).trim();
}

function normalizeRev(value) {
  const rev = Number(value);
  return Number.isFinite(rev) && rev > 0 ? Math.floor(rev) : 1;
}

function toNumberOrNull(value) {
  const normalized = typeof value === 'string' ? value.replace(',', '.') : value;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function defaultDeepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableId(prefix, parts = []) {
  const hash = crypto
    .createHash('sha1')
    .update(parts.map(trimToString).join('|'))
    .digest('hex')
    .slice(0, 24);
  return `${prefix}_${hash}`;
}

function operationStatus(operation = {}, card = {}) {
  return trimToString(operation.status || card.productionStatus || card.status || 'NOT_STARTED') || 'NOT_STARTED';
}

function flowStateIdFor(cardId, routeOperationId) {
  return stableId('pfs', [cardId, routeOperationId, 'flow']);
}

function firstOperationId(card = {}) {
  const operation = (Array.isArray(card.operations) ? card.operations : [])[0] || null;
  return trimToString(operation?.id || operation?.opId || operation?.opCode);
}

function operationIdFor(operation = {}) {
  return trimToString(operation?.id || operation?.opId || operation?.opCode);
}

function findActiveFlowStateId(card = {}) {
  const operations = Array.isArray(card.operations) ? card.operations : [];
  const active = operations.find((operation) => {
    const status = trimToString(operation?.status || '').toUpperCase();
    return status && status !== 'NOT_STARTED';
  }) || operations[0] || null;
  return active ? flowStateIdFor(card.id, operationIdFor(active)) : null;
}

function findOperationById(card = {}, opId = '') {
  const normalizedOpId = trimToString(opId);
  if (!normalizedOpId) return null;
  return (Array.isArray(card.operations) ? card.operations : []).find(operation => operationIdFor(operation) === normalizedOpId) || null;
}

function isMaterialIssueOperation(operation = {}) {
  const type = trimToString(operation?.operationType || operation?.type || '').toLowerCase();
  const name = trimToString(operation?.opName || operation?.name || operation?.opCode || '').toLowerCase();
  return type.includes('получение материала') || type.includes('выдача материала') ||
    name.includes('получение материала') || name.includes('выдача материала');
}

function buildMaterialItemKey(opId = '', itemIndex = 0) {
  return `${trimToString(opId)}:${Number.isFinite(Number(itemIndex)) ? Number(itemIndex) : 0}`;
}

function buildMaterialReturnNote(item = {}) {
  const note = {
    balanceQty: trimToString(item?.balanceQty || ''),
    returnQty: trimToString(item?.returnQty || ''),
    isPowder: Boolean(item?.isPowder)
  };
  return JSON.stringify(note);
}

function buildDryingRecordNote(row = {}) {
  return JSON.stringify({
    rowId: trimToString(row?.rowId || ''),
    sourceIssueOpId: trimToString(row?.sourceIssueOpId || ''),
    sourceItemIndex: Number.isFinite(Number(row?.sourceItemIndex)) ? Number(row.sourceItemIndex) : -1,
    name: trimToString(row?.name || ''),
    qty: trimToString(row?.qty || ''),
    unit: trimToString(row?.unit || ''),
    dryQty: trimToString(row?.dryQty || ''),
    dryResultQty: trimToString(row?.dryResultQty || ''),
    isPowder: Boolean(row?.isPowder)
  });
}

function normalizeFlowItemStatus(item = {}) {
  return trimToString(item?.current?.status || item?.status || item?.finalStatus || 'PENDING') || 'PENDING';
}

function normalizePersonalOperationSqlStatus(personalOperation = {}) {
  const status = trimToString(personalOperation?.status || 'NOT_STARTED').toUpperCase();
  if (status === 'DONE') return 'DONE';
  if (status === 'PAUSED') return 'PAUSED';
  if (status === 'IN_PROGRESS') return 'IN_PROGRESS';
  if (status === 'ASSIGNED') return 'ASSIGNED';
  return 'NOT_STARTED';
}

function latestPersonalOperationSegment(personalOperation = {}) {
  const segments = Array.isArray(personalOperation?.historySegments) ? personalOperation.historySegments : [];
  return segments.length ? segments[segments.length - 1] : null;
}

class ProductionExecutionRepository extends BaseRepository {
  constructor(options = {}) {
    super({ ...options, domain: 'production-execution' });
  }

  getFlowStateId(cardId, routeOperationId) {
    return flowStateIdFor(cardId, routeOperationId);
  }

  getItemStateId(flowStateId, serialNo) {
    return stableId('pfi', [flowStateId, serialNo || 'item']);
  }

  getPersonalOperationId(flowStateId, userId, personalOperationKey = '') {
    return stableId('ppo', [flowStateId, userId, personalOperationKey || 'personal']);
  }

  getMaterialIssueId(flowStateId, materialKey = '') {
    return stableId('pmi', [flowStateId, materialKey || 'material-issue']);
  }

  getMaterialReturnId(materialIssueId, returnKey = '') {
    return stableId('pmr', [materialIssueId, returnKey || 'material-return']);
  }

  getDryingRecordId(flowStateId, dryingKey = '') {
    return stableId('pdr', [flowStateId, dryingKey || 'drying']);
  }

  getDelayId(flowStateId, delayKey = '') {
    return stableId('pdl', [flowStateId, delayKey || 'delay']);
  }

  getDefectId(flowStateId, defectKey = '') {
    return stableId('pdf', [flowStateId, defectKey || 'defect']);
  }

  getRepairId(defectId, repairKey = '') {
    return stableId('prp', [defectId, repairKey || 'repair']);
  }

  getDisposalId(defectId, disposalKey = '') {
    return stableId('pds', [defectId, disposalKey || 'disposal']);
  }

  async readCardFlowVersions(options = {}) {
    const target = options.tx || this;
    const result = await target.query({
      sql: `
        SELECT card_id, MAX(flow_version) AS flow_version
        FROM production_flow_states
        GROUP BY card_id
      `,
      values: [],
      label: 'production-execution:flow-versions:read'
    });
    return new Map((result.rows || []).map((row) => [
      trimToString(row.card_id),
      normalizeRev(row.flow_version)
    ]));
  }

  async lockCardFlowVersion(tx, cardId) {
    const normalizedCardId = trimToString(cardId);
    const result = await tx.query({
      sql: `
        SELECT id, card_id, route_operation_id, flow_version
        FROM production_flow_states
        WHERE card_id = ?
        ORDER BY route_operation_id
        FOR UPDATE
      `,
      values: [normalizedCardId],
      label: 'production-execution:flow-states:lock'
    });
    const rows = result.rows || [];
    if (!rows.length) return { rows, actualRev: 1 };
    const versions = rows.map(row => normalizeRev(row.flow_version));
    return {
      rows,
      actualRev: Math.max(...versions)
    };
  }

  async lockAndCheckCardFlowVersion(tx, cardId, expectedFlowVersion = null, fallbackActualRev = 1) {
    const locked = await this.lockCardFlowVersion(tx, cardId);
    const actualRev = locked.rows.length ? locked.actualRev : normalizeRev(fallbackActualRev);
    if (expectedFlowVersion != null) {
      this.assertExpectedFlowVersion(cardId, expectedFlowVersion, actualRev);
    }
    return {
      ...locked,
      actualRev
    };
  }

  assertExpectedFlowVersion(cardId, expectedFlowVersion, actualRev) {
    const expected = Number(expectedFlowVersion);
    if (Number.isFinite(expected) && expected === normalizeRev(actualRev)) return;
    throw createSqlConflict({
      code: 'STALE_REVISION',
      entity: 'card.flow',
      id: trimToString(cardId),
      expectedRev: expectedFlowVersion,
      actualRev: normalizeRev(actualRev),
      message: 'Версия flow устарела',
      extras: {
        flowVersion: normalizeRev(actualRev)
      }
    });
  }

  async ensureFlowRowsForCard(tx, card, flowVersion) {
    const operations = Array.isArray(card?.operations) ? card.operations : [];
    for (const operation of operations) {
      const opId = trimToString(operation?.id || operation?.opId || operation?.opCode);
      if (!trimToString(card?.id) || !opId) continue;
      const flowStateId = this.getFlowStateId(card.id, opId);
      await tx.query({
        sql: `
          INSERT INTO production_flow_states (
            id, card_id, route_operation_id, shift_task_id, flow_version,
            flow_status, current_area_id, current_employee_user_id,
            started_at, completed_at, updated_at, created_at
          ) VALUES (?, ?, ?, NULL, ?, ?, NULL, NULL, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
          ON DUPLICATE KEY UPDATE
            flow_version = GREATEST(flow_version, VALUES(flow_version)),
            flow_status = VALUES(flow_status),
            started_at = VALUES(started_at),
            completed_at = VALUES(completed_at),
            updated_at = UTC_TIMESTAMP(3)
        `,
        values: [
          flowStateId,
          card.id,
          opId,
          normalizeRev(flowVersion),
          operationStatus(operation, card),
          toMysqlDateTime(operation.startedAt || operation.firstStartedAt),
          toMysqlDateTime(operation.finishedAt)
        ],
        label: 'production-execution:flow-state:ensure'
      });
    }
  }

  async updateFlowStateFromOperation(tx, card, operation, flowVersion) {
    const cardId = trimToString(card?.id);
    const opId = trimToString(operation?.id || operation?.opId || operation?.opCode);
    if (!cardId || !opId) return null;
    const flowStateId = this.getFlowStateId(cardId, opId);
    await tx.query({
      sql: `
        UPDATE production_flow_states
        SET flow_version = ?,
            flow_status = ?,
            started_at = ?,
            completed_at = ?,
            updated_at = UTC_TIMESTAMP(3)
        WHERE id = ?
      `,
      values: [
        normalizeRev(flowVersion),
        operationStatus(operation, card),
        toMysqlDateTime(operation.startedAt || operation.firstStartedAt),
        toMysqlDateTime(operation.finishedAt),
        flowStateId
      ],
      label: 'production-execution:flow-state:update'
    });
    return flowStateId;
  }

  async appendFlowEvent(tx, {
    flowStateId,
    cardId = '',
    eventType = 'execution-update',
    fromStatus = null,
    toStatus = null,
    actorUserId = null,
    expectedFlowVersion = null,
    resultingFlowVersion,
    eventPayload = {},
    eventKey = ''
  } = {}) {
    const normalizedFlowStateId = trimToString(flowStateId);
    if (!normalizedFlowStateId) return null;
    const normalizedEventType = trimToString(eventType) || 'execution-update';
    const resultingRev = normalizeRev(resultingFlowVersion);
    const eventId = stableId('pfe', [
      cardId,
      normalizedFlowStateId,
      normalizedEventType,
      eventKey || Date.now(),
      resultingRev
    ]);
    await tx.query({
      sql: `
        INSERT INTO production_flow_events (
          id, flow_state_id, event_type, from_status, to_status,
          actor_user_id, expected_flow_version, resulting_flow_version,
          event_payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))
      `,
      values: [
        eventId,
        normalizedFlowStateId,
        normalizedEventType,
        trimToString(fromStatus) || null,
        trimToString(toStatus) || null,
        trimToString(actorUserId) || null,
        Number.isFinite(Number(expectedFlowVersion)) ? Number(expectedFlowVersion) : null,
        resultingRev,
        JSON.stringify(eventPayload || {})
      ],
      label: 'production-execution:flow-event:insert'
    });
    return eventId;
  }

  async updateCardFlowProjection(tx, {
    cardId,
    activeFlowStateId = null,
    flowVersion,
    currentStatus = null,
    currentAreaId = null
  } = {}) {
    const normalizedCardId = trimToString(cardId);
    if (!normalizedCardId) {
      throw new Error('Production execution projection card id is required.');
    }
    await tx.query({
      sql: `
        INSERT INTO card_flow_projection (
          card_id, active_flow_state_id, flow_version, current_status,
          current_area_id, updated_at
        ) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE
          active_flow_state_id = VALUES(active_flow_state_id),
          flow_version = VALUES(flow_version),
          current_status = VALUES(current_status),
          current_area_id = VALUES(current_area_id),
          updated_at = UTC_TIMESTAMP(3)
      `,
      values: [
        normalizedCardId,
        trimToString(activeFlowStateId) || null,
        normalizeRev(flowVersion),
        trimToString(currentStatus) || null,
        trimToString(currentAreaId) || null
      ],
      label: 'production-execution:projection:upsert'
    });
  }

  async upsertItemState(tx, {
    flowStateId,
    serialNo = null,
    itemStatus = 'PENDING',
    qualityStatus = null,
    quantity = null,
    itemKey = ''
  } = {}) {
    const normalizedFlowStateId = trimToString(flowStateId);
    const normalizedSerialNo = trimToString(serialNo) || null;
    if (!normalizedFlowStateId) {
      throw new Error('Production execution item state flow_state_id is required.');
    }
    const itemStateId = this.getItemStateId(normalizedFlowStateId, itemKey || normalizedSerialNo);
    await tx.query({
      sql: `
        INSERT INTO production_flow_item_states (
          id, flow_state_id, serial_no, item_status, quality_status, quantity, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE
          item_status = VALUES(item_status),
          quality_status = VALUES(quality_status),
          quantity = VALUES(quantity),
          updated_at = UTC_TIMESTAMP(3)
      `,
      values: [
        itemStateId,
        normalizedFlowStateId,
        normalizedSerialNo,
        trimToString(itemStatus) || 'PENDING',
        trimToString(qualityStatus) || null,
        toNumberOrNull(quantity)
      ],
      label: 'production-execution:item-state:upsert'
    });
    return itemStateId;
  }

  async listItemStates(tx, flowStateId) {
    const result = await tx.query({
      sql: `
        SELECT id, flow_state_id, serial_no, item_status, quality_status, quantity, updated_at
        FROM production_flow_item_states
        WHERE flow_state_id = ?
        ORDER BY serial_no, id
      `,
      values: [trimToString(flowStateId)],
      label: 'production-execution:item-states:list'
    });
    return result.rows || [];
  }

  async syncFlowItemStatesFromCard(tx, card) {
    const cardId = trimToString(card?.id);
    if (!cardId) return [];
    const synced = [];
    const flowGroups = [
      { kind: 'ITEM', rows: Array.isArray(card?.flow?.items) ? card.flow.items : [] },
      { kind: 'SAMPLE', rows: Array.isArray(card?.flow?.samples) ? card.flow.samples : [] }
    ];
    for (const group of flowGroups) {
      for (const item of group.rows) {
        const routeOperationId = trimToString(item?.current?.opId || item?.opId || '');
        if (!routeOperationId || !findOperationById(card, routeOperationId)) continue;
        const flowStateId = this.getFlowStateId(cardId, routeOperationId);
        const itemStateId = await this.upsertItemState(tx, {
          flowStateId,
          serialNo: trimToString(item?.displayName || item?.serialNo || item?.id || '') || null,
          itemStatus: normalizeFlowItemStatus(item),
          qualityStatus: group.kind,
          quantity: 1,
          itemKey: trimToString(item?.id || item?.displayName || item?.serialNo || '')
        });
        synced.push(itemStateId);
      }
    }
    return synced;
  }

  async upsertPersonalOperation(tx, {
    flowStateId,
    userId,
    status = 'ASSIGNED',
    personalOperationKey = '',
    assignedAt = null,
    startedAt = null,
    completedAt = null
  } = {}) {
    const normalizedFlowStateId = trimToString(flowStateId);
    const normalizedUserId = trimToString(userId);
    if (!normalizedFlowStateId || !normalizedUserId) {
      throw new Error('Production execution personal operation flow_state_id and user_id are required.');
    }
    const personalOperationId = this.getPersonalOperationId(normalizedFlowStateId, normalizedUserId, personalOperationKey);
    await tx.query({
      sql: `
        INSERT INTO personal_operations (
          id, flow_state_id, user_id, status, assigned_at, started_at, completed_at
        ) VALUES (?, ?, ?, ?, COALESCE(?, UTC_TIMESTAMP(3)), ?, ?)
        ON DUPLICATE KEY UPDATE
          status = VALUES(status),
          started_at = VALUES(started_at),
          completed_at = VALUES(completed_at)
      `,
      values: [
        personalOperationId,
        normalizedFlowStateId,
        normalizedUserId,
        trimToString(status) || 'ASSIGNED',
        toMysqlDateTime(assignedAt),
        toMysqlDateTime(startedAt),
        toMysqlDateTime(completedAt)
      ],
      label: 'production-execution:personal-operation:upsert'
    });
    return personalOperationId;
  }

  async listPersonalOperations(tx, flowStateId) {
    const result = await tx.query({
      sql: `
        SELECT id, flow_state_id, user_id, status, assigned_at, started_at, completed_at
        FROM personal_operations
        WHERE flow_state_id = ?
        ORDER BY assigned_at, id
      `,
      values: [trimToString(flowStateId)],
      label: 'production-execution:personal-operations:list'
    });
    return result.rows || [];
  }

  async syncPersonalOperationsFromCard(tx, card) {
    const cardId = trimToString(card?.id);
    if (!cardId) return [];
    const synced = [];
    const personalOperations = Array.isArray(card?.personalOperations) ? card.personalOperations : [];
    for (const personalOperation of personalOperations) {
      const parentOpId = trimToString(personalOperation?.parentOpId || personalOperation?.opId || '');
      const userId = trimToString(personalOperation?.currentExecutorUserId || personalOperation?.executorUserId || '');
      if (!parentOpId || !userId || !findOperationById(card, parentOpId)) continue;
      const segment = latestPersonalOperationSegment(personalOperation);
      const status = normalizePersonalOperationSqlStatus(personalOperation);
      const flowStateId = this.getFlowStateId(cardId, parentOpId);
      const personalOperationId = await this.upsertPersonalOperation(tx, {
        flowStateId,
        userId,
        status,
        personalOperationKey: trimToString(personalOperation?.id || ''),
        assignedAt: personalOperation?.assignedAt || personalOperation?.createdAt || segment?.startedAt || null,
        startedAt: personalOperation?.startedAt || segment?.startedAt || null,
        completedAt: personalOperation?.completedAt || personalOperation?.finishedAt || segment?.finishedAt || null
      });
      synced.push(personalOperationId);
    }
    return synced;
  }

  async appendMaterialIssue(tx, {
    flowStateId,
    materialCode = null,
    materialName = null,
    quantity,
    unit = null,
    issuedByUserId = null,
    materialKey = ''
  } = {}) {
    const normalizedFlowStateId = trimToString(flowStateId);
    if (!normalizedFlowStateId) throw new Error('Production material issue flow_state_id is required.');
    const issueId = this.getMaterialIssueId(normalizedFlowStateId, materialKey || materialCode || materialName);
    await tx.query({
      sql: `
        INSERT INTO production_material_issues (
          id, flow_state_id, material_code, material_name_snapshot,
          quantity, unit, issued_by_user_id, issued_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE
          material_code = VALUES(material_code),
          material_name_snapshot = VALUES(material_name_snapshot),
          quantity = VALUES(quantity),
          unit = VALUES(unit),
          issued_by_user_id = COALESCE(production_material_issues.issued_by_user_id, VALUES(issued_by_user_id))
      `,
      values: [
        issueId,
        normalizedFlowStateId,
        trimToString(materialCode) || null,
        trimToString(materialName) || null,
        toNumberOrNull(quantity) || 0,
        trimToString(unit) || null,
        trimToString(issuedByUserId) || null
      ],
      label: 'production-execution:material-issue:insert'
    });
    return issueId;
  }

  async appendMaterialReturn(tx, {
    materialIssueId,
    quantity,
    returnedByUserId = null,
    note = null,
    returnKey = ''
  } = {}) {
    const normalizedIssueId = trimToString(materialIssueId);
    if (!normalizedIssueId) throw new Error('Production material return material_issue_id is required.');
    const returnId = this.getMaterialReturnId(normalizedIssueId, returnKey);
    await tx.query({
      sql: `
        INSERT INTO production_material_returns (
          id, material_issue_id, quantity, returned_by_user_id, returned_at, note
        ) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3), ?)
        ON DUPLICATE KEY UPDATE
          quantity = VALUES(quantity),
          returned_by_user_id = COALESCE(production_material_returns.returned_by_user_id, VALUES(returned_by_user_id)),
          note = VALUES(note)
      `,
      values: [
        returnId,
        normalizedIssueId,
        toNumberOrNull(quantity) || 0,
        trimToString(returnedByUserId) || null,
        trimToString(note) || null
      ],
      label: 'production-execution:material-return:insert'
    });
    return returnId;
  }

  async upsertDryingRecord(tx, {
    flowStateId,
    dryingKey = '',
    status = 'IN_PROGRESS',
    startedByUserId = null,
    completedByUserId = null,
    startedAt = null,
    completedAt = null,
    targetCompletedAt = null,
    note = null
  } = {}) {
    const normalizedFlowStateId = trimToString(flowStateId);
    if (!normalizedFlowStateId) throw new Error('Production drying record flow_state_id is required.');
    const dryingRecordId = this.getDryingRecordId(normalizedFlowStateId, dryingKey);
    await tx.query({
      sql: `
        INSERT INTO production_drying_records (
          id, flow_state_id, started_by_user_id, completed_by_user_id, status,
          started_at, completed_at, target_completed_at, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          started_by_user_id = COALESCE(production_drying_records.started_by_user_id, VALUES(started_by_user_id)),
          completed_by_user_id = VALUES(completed_by_user_id),
          status = VALUES(status),
          started_at = COALESCE(production_drying_records.started_at, VALUES(started_at)),
          completed_at = VALUES(completed_at),
          target_completed_at = VALUES(target_completed_at),
          note = VALUES(note)
      `,
      values: [
        dryingRecordId,
        normalizedFlowStateId,
        trimToString(startedByUserId) || null,
        trimToString(completedByUserId) || null,
        trimToString(status) || 'IN_PROGRESS',
        toMysqlDateTime(startedAt),
        toMysqlDateTime(completedAt),
        toMysqlDateTime(targetCompletedAt),
        trimToString(note) || null
      ],
      label: 'production-execution:drying-record:upsert'
    });
    return dryingRecordId;
  }

  async upsertDelay(tx, {
    flowStateId,
    itemStateId = null,
    reason,
    status = 'OPEN',
    createdByUserId = null,
    resolvedByUserId = null,
    resolvedAt = null,
    delayKey = ''
  } = {}) {
    const normalizedFlowStateId = trimToString(flowStateId);
    if (!normalizedFlowStateId) throw new Error('Production delay flow_state_id is required.');
    const delayId = this.getDelayId(normalizedFlowStateId, delayKey || reason);
    await tx.query({
      sql: `
        INSERT INTO production_delays (
          id, flow_state_id, item_state_id, reason, status,
          created_by_user_id, resolved_by_user_id, created_at, resolved_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), ?)
        ON DUPLICATE KEY UPDATE
          status = VALUES(status),
          resolved_by_user_id = VALUES(resolved_by_user_id),
          resolved_at = VALUES(resolved_at)
      `,
      values: [
        delayId,
        normalizedFlowStateId,
        trimToString(itemStateId) || null,
        trimToString(reason) || 'Задержка',
        trimToString(status) || 'OPEN',
        trimToString(createdByUserId) || null,
        trimToString(resolvedByUserId) || null,
        toMysqlDateTime(resolvedAt)
      ],
      label: 'production-execution:delay:upsert'
    });
    return delayId;
  }

  async upsertDefect(tx, {
    flowStateId,
    itemStateId = null,
    defectType = null,
    description,
    status = 'OPEN',
    createdByUserId = null,
    closedAt = null,
    defectKey = ''
  } = {}) {
    const normalizedFlowStateId = trimToString(flowStateId);
    if (!normalizedFlowStateId) throw new Error('Production defect flow_state_id is required.');
    const defectId = this.getDefectId(normalizedFlowStateId, defectKey || description);
    await tx.query({
      sql: `
        INSERT INTO production_defects (
          id, flow_state_id, item_state_id, defect_type, description,
          status, created_by_user_id, created_at, closed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), ?)
        ON DUPLICATE KEY UPDATE
          description = VALUES(description),
          status = VALUES(status),
          closed_at = VALUES(closed_at)
      `,
      values: [
        defectId,
        normalizedFlowStateId,
        trimToString(itemStateId) || null,
        trimToString(defectType) || null,
        trimToString(description) || 'Брак',
        trimToString(status) || 'OPEN',
        trimToString(createdByUserId) || null,
        toMysqlDateTime(closedAt)
      ],
      label: 'production-execution:defect:upsert'
    });
    return defectId;
  }

  async upsertRepair(tx, {
    defectId,
    repairCardId = null,
    status = 'OPEN',
    createdByUserId = null,
    completedByUserId = null,
    completedAt = null,
    note = null,
    repairKey = ''
  } = {}) {
    const normalizedDefectId = trimToString(defectId);
    if (!normalizedDefectId) throw new Error('Production repair defect_id is required.');
    const repairId = this.getRepairId(normalizedDefectId, repairKey || repairCardId);
    await tx.query({
      sql: `
        INSERT INTO production_repairs (
          id, defect_id, repair_card_id, status, created_by_user_id,
          completed_by_user_id, created_at, completed_at, note
        ) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), ?, ?)
        ON DUPLICATE KEY UPDATE
          status = VALUES(status),
          completed_by_user_id = VALUES(completed_by_user_id),
          completed_at = VALUES(completed_at),
          note = VALUES(note)
      `,
      values: [
        repairId,
        normalizedDefectId,
        trimToString(repairCardId) || null,
        trimToString(status) || 'OPEN',
        trimToString(createdByUserId) || null,
        trimToString(completedByUserId) || null,
        toMysqlDateTime(completedAt),
        trimToString(note) || null
      ],
      label: 'production-execution:repair:upsert'
    });
    return repairId;
  }

  async appendDisposal(tx, {
    defectId,
    quantity = null,
    reason,
    disposedByUserId = null,
    disposalKey = ''
  } = {}) {
    const normalizedDefectId = trimToString(defectId);
    if (!normalizedDefectId) throw new Error('Production disposal defect_id is required.');
    const disposalId = this.getDisposalId(normalizedDefectId, disposalKey || reason);
    await tx.query({
      sql: `
        INSERT INTO production_disposals (
          id, defect_id, quantity, reason, disposed_by_user_id, disposed_at
        ) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3))
      `,
      values: [
        disposalId,
        normalizedDefectId,
        toNumberOrNull(quantity),
        trimToString(reason) || 'Списание',
        trimToString(disposedByUserId) || null
      ],
      label: 'production-execution:disposal:insert'
    });
    return disposalId;
  }

  async syncMaterialDryingFromCard(tx, card, { actorUserId = null } = {}) {
    const cardId = trimToString(card?.id);
    if (!cardId) return { materialIssues: 0, materialReturns: 0, dryingRecords: 0 };
    const materialEntries = Array.isArray(card?.materialIssues) ? card.materialIssues : [];
    let materialIssues = 0;
    let materialReturns = 0;
    let dryingRecords = 0;

    for (const entry of materialEntries) {
      const opId = trimToString(entry?.opId || '');
      if (!opId || !findOperationById(card, opId)) continue;
      const flowStateId = this.getFlowStateId(cardId, opId);
      const items = Array.isArray(entry?.items) ? entry.items : [];
      const operation = findOperationById(card, opId);
      if (isMaterialIssueOperation(operation)) {
        for (let index = 0; index < items.length; index += 1) {
          const item = items[index] || {};
          const materialKey = buildMaterialItemKey(opId, index);
          const materialIssueId = await this.appendMaterialIssue(tx, {
            flowStateId,
            materialCode: materialKey,
            materialName: trimToString(item?.name || ''),
            quantity: item?.qty,
            unit: trimToString(item?.unit || 'кг') || 'кг',
            issuedByUserId: actorUserId,
            materialKey
          });
          materialIssues += 1;
          if (Object.prototype.hasOwnProperty.call(item, 'returnQty') || Object.prototype.hasOwnProperty.call(item, 'balanceQty')) {
            await this.appendMaterialReturn(tx, {
              materialIssueId,
              quantity: trimToString(item?.returnQty || '0') || 0,
              returnedByUserId: actorUserId,
              note: buildMaterialReturnNote(item),
              returnKey: `return:${materialKey}`
            });
            materialReturns += 1;
          }
        }
      }

      const dryingRows = Array.isArray(entry?.dryingRows) ? entry.dryingRows : [];
      for (let index = 0; index < dryingRows.length; index += 1) {
        const row = dryingRows[index] || {};
        const dryingKey = trimToString(row?.rowId || `${opId}:${index}`);
        if (!dryingKey) continue;
        await this.upsertDryingRecord(tx, {
          flowStateId,
          dryingKey,
          status: trimToString(row?.status || 'NOT_STARTED') || 'NOT_STARTED',
          startedByUserId: actorUserId,
          completedByUserId: trimToString(row?.status || '').toUpperCase() === 'DONE' ? actorUserId : null,
          startedAt: row?.startedAt || null,
          completedAt: row?.finishedAt || null,
          note: buildDryingRecordNote(row)
        });
        dryingRecords += 1;
      }
    }

    return { materialIssues, materialReturns, dryingRecords };
  }

  async readFlowReconciliationState(tx, cardId) {
    const normalizedCardId = trimToString(cardId);
    const flowStates = await tx.query({
      sql: `
        SELECT id, card_id, route_operation_id, flow_version, flow_status, current_area_id
        FROM production_flow_states
        WHERE card_id = ?
        ORDER BY route_operation_id, id
      `,
      values: [normalizedCardId],
      label: 'production-execution:reconcile:flow-states'
    });
    const projection = await tx.query({
      sql: `
        SELECT card_id, active_flow_state_id, flow_version, current_status, current_area_id
        FROM card_flow_projection
        WHERE card_id = ?
      `,
      values: [normalizedCardId],
      label: 'production-execution:reconcile:projection'
    });
    const eventCounts = await tx.query({
      sql: `
        SELECT s.card_id, COUNT(e.id) AS event_count
        FROM production_flow_states s
        LEFT JOIN production_flow_events e ON e.flow_state_id = s.id
        WHERE s.card_id = ?
        GROUP BY s.card_id
      `,
      values: [normalizedCardId],
      label: 'production-execution:reconcile:event-count'
    });
    return {
      flowStates: flowStates.rows || [],
      projection: (projection.rows || [])[0] || null,
      eventCount: Number((eventCounts.rows || [])[0]?.event_count) || 0
    };
  }

  async readMaterialDryingReconciliationState(tx, cardId) {
    const normalizedCardId = trimToString(cardId);
    const materialIssues = await tx.query({
      sql: `
        SELECT mi.id, mi.flow_state_id, mi.material_code, mi.quantity, mi.unit
        FROM production_material_issues mi
        JOIN production_flow_states fs ON fs.id = mi.flow_state_id
        WHERE fs.card_id = ?
        ORDER BY mi.id
      `,
      values: [normalizedCardId],
      label: 'production-execution:reconcile:material-issues'
    });
    const materialReturns = await tx.query({
      sql: `
        SELECT mr.id, mr.material_issue_id, mr.quantity, mr.note
        FROM production_material_returns mr
        JOIN production_material_issues mi ON mi.id = mr.material_issue_id
        JOIN production_flow_states fs ON fs.id = mi.flow_state_id
        WHERE fs.card_id = ?
        ORDER BY mr.id
      `,
      values: [normalizedCardId],
      label: 'production-execution:reconcile:material-returns'
    });
    const dryingRecords = await tx.query({
      sql: `
        SELECT dr.id, dr.flow_state_id, dr.status, dr.note
        FROM production_drying_records dr
        JOIN production_flow_states fs ON fs.id = dr.flow_state_id
        WHERE fs.card_id = ?
        ORDER BY dr.id
      `,
      values: [normalizedCardId],
      label: 'production-execution:reconcile:drying-records'
    });
    const eventCounts = await tx.query({
      sql: `
        SELECT fs.card_id, COUNT(e.id) AS event_count
        FROM production_flow_states fs
        LEFT JOIN production_flow_events e ON e.flow_state_id = fs.id
        WHERE fs.card_id = ?
        GROUP BY fs.card_id
      `,
      values: [normalizedCardId],
      label: 'production-execution:reconcile:material-drying-event-count'
    });
    return {
      materialIssues: materialIssues.rows || [],
      materialReturns: materialReturns.rows || [],
      dryingRecords: dryingRecords.rows || [],
      eventCount: Number((eventCounts.rows || [])[0]?.event_count) || 0
    };
  }

  async compareMaterialDryingProjection(tx, card) {
    const cardId = trimToString(card?.id);
    if (!cardId) throw new Error('Production execution material/drying reconciliation card id is required.');
    const state = await this.readMaterialDryingReconciliationState(tx, cardId);
    const expectedIssueIds = new Set();
    const expectedReturnIds = new Set();
    const expectedDryingIds = new Set();

    for (const entry of Array.isArray(card?.materialIssues) ? card.materialIssues : []) {
      const opId = trimToString(entry?.opId || '');
      if (!opId || !findOperationById(card, opId)) continue;
      const flowStateId = this.getFlowStateId(cardId, opId);
      const operation = findOperationById(card, opId);
      if (isMaterialIssueOperation(operation)) {
        (Array.isArray(entry?.items) ? entry.items : []).forEach((item, index) => {
          const materialIssueId = this.getMaterialIssueId(flowStateId, buildMaterialItemKey(opId, index));
          expectedIssueIds.add(materialIssueId);
          if (Object.prototype.hasOwnProperty.call(item || {}, 'returnQty') || Object.prototype.hasOwnProperty.call(item || {}, 'balanceQty')) {
            expectedReturnIds.add(this.getMaterialReturnId(materialIssueId, `return:${buildMaterialItemKey(opId, index)}`));
          }
        });
      }
      (Array.isArray(entry?.dryingRows) ? entry.dryingRows : []).forEach((row, index) => {
        const dryingKey = trimToString(row?.rowId || `${opId}:${index}`);
        if (dryingKey) expectedDryingIds.add(this.getDryingRecordId(flowStateId, dryingKey));
      });
    }

    const actualIssueIds = new Set(state.materialIssues.map(row => trimToString(row.id)).filter(Boolean));
    const actualReturnIds = new Set(state.materialReturns.map(row => trimToString(row.id)).filter(Boolean));
    const actualDryingIds = new Set(state.dryingRecords.map(row => trimToString(row.id)).filter(Boolean));
    const missingIssues = [...expectedIssueIds].filter(id => !actualIssueIds.has(id));
    const missingReturns = [...expectedReturnIds].filter(id => !actualReturnIds.has(id));
    const missingDrying = [...expectedDryingIds].filter(id => !actualDryingIds.has(id));
    const extraIssues = [...actualIssueIds].filter(id => !expectedIssueIds.has(id));
    const extraReturns = [...actualReturnIds].filter(id => !expectedReturnIds.has(id));
    const extraDrying = [...actualDryingIds].filter(id => !expectedDryingIds.has(id));
    const issues = [];
    if (missingIssues.length) issues.push('missing material issue rows');
    if (missingReturns.length) issues.push('missing material return rows');
    if (missingDrying.length) issues.push('missing drying rows');
    if (extraIssues.length) issues.push('extra material issue rows');
    if (extraReturns.length) issues.push('extra material return rows');
    if (extraDrying.length) issues.push('extra drying rows');

    return {
      cardId,
      compatible: issues.length === 0,
      issues,
      expected: {
        materialIssueCount: expectedIssueIds.size,
        materialReturnCount: expectedReturnIds.size,
        dryingRecordCount: expectedDryingIds.size
      },
      actual: {
        materialIssueCount: actualIssueIds.size,
        materialReturnCount: actualReturnIds.size,
        dryingRecordCount: actualDryingIds.size,
        eventCount: state.eventCount
      },
      missing: {
        materialIssues: missingIssues,
        materialReturns: missingReturns,
        dryingRecords: missingDrying
      },
      extra: {
        materialIssues: extraIssues,
        materialReturns: extraReturns,
        dryingRecords: extraDrying
      }
    };
  }

  async compareCardFlowProjection(tx, card) {
    const cardId = trimToString(card?.id);
    if (!cardId) throw new Error('Production execution reconciliation card id is required.');
    const state = await this.readFlowReconciliationState(tx, cardId);
    const expectedFlowVersion = normalizeRev(card?.flow?.version || 1);
    const activeFlowStateId = findActiveFlowStateId(card);
    const currentStatus = trimToString(card.productionStatus || card.status || operationStatus((card.operations || [])[0], card)) || null;
    const issues = [];
    if (!state.projection) issues.push('missing card_flow_projection row');
    if (state.projection && normalizeRev(state.projection.flow_version) !== expectedFlowVersion) {
      issues.push('projection flow_version differs from card.flow.version');
    }
    if (state.projection && trimToString(state.projection.active_flow_state_id) !== trimToString(activeFlowStateId)) {
      issues.push('projection active_flow_state_id differs from active operation');
    }
    if (state.projection && trimToString(state.projection.current_status) !== trimToString(currentStatus)) {
      issues.push('projection current_status differs from card flow projection');
    }
    return {
      cardId,
      compatible: issues.length === 0,
      issues,
      expected: {
        flowVersion: expectedFlowVersion,
        activeFlowStateId,
        currentStatus
      },
      actual: {
        flowVersion: state.projection ? normalizeRev(state.projection.flow_version) : null,
        activeFlowStateId: state.projection?.active_flow_state_id || null,
        currentStatus: state.projection?.current_status || null,
        flowStateCount: state.flowStates.length,
        eventCount: state.eventCount
      }
    };
  }

  async syncFlowStateFromCard(tx, card, {
    expectedFlowVersion = null,
    actorUserId = null,
    eventType = 'execution-update',
    eventPayload = {}
  } = {}) {
    const cardId = trimToString(card?.id);
    if (!cardId) {
      throw new Error('Production execution card id is required.');
    }
    const nextFlowVersion = normalizeRev(card?.flow?.version || eventPayload?.flowVersion || 1);
    await this.lockAndCheckCardFlowVersion(
      tx,
      cardId,
      expectedFlowVersion,
      Number.isFinite(Number(expectedFlowVersion)) ? Number(expectedFlowVersion) : Math.max(1, nextFlowVersion - 1)
    );
    await this.ensureFlowRowsForCard(tx, card, nextFlowVersion);

    const operations = Array.isArray(card.operations) ? card.operations : [];
    for (const operation of operations) {
      await this.updateFlowStateFromOperation(tx, card, operation, nextFlowVersion);
    }

    const activeFlowStateId = findActiveFlowStateId(card);
    await this.updateCardFlowProjection(tx, {
      cardId,
      activeFlowStateId,
      flowVersion: nextFlowVersion,
      currentStatus: trimToString(card.productionStatus || card.status || operationStatus(operations[0], card)) || null,
      currentAreaId: null
    });

    const eventFlowStateId = activeFlowStateId || (firstOperationId(card) ? this.getFlowStateId(cardId, firstOperationId(card)) : null);
    if (eventFlowStateId) {
      await this.appendFlowEvent(tx, {
        flowStateId: eventFlowStateId,
        cardId,
        eventType,
        fromStatus: null,
        toStatus: trimToString(card.productionStatus || card.status || '') || null,
        actorUserId,
        expectedFlowVersion,
        resultingFlowVersion: nextFlowVersion,
        eventPayload
      });
    }

    return {
      cardId,
      flowVersion: nextFlowVersion
    };
  }

  async persistCoreWorkspaceExecutionCommand({
    cardsRepository,
    buildCurrentData,
    normalizeData,
    deepClone = defaultDeepClone,
    findCardByKey,
    mutator,
    cardId = '',
    expectedFlowVersion = null,
    actorUserId = null,
    eventType = 'execution-update',
    eventPayload = {},
    extraCards = []
  } = {}) {
    if (!cardsRepository || typeof cardsRepository.writeCardExecutionProjection !== 'function') {
      throw new Error('Production execution core command requires cards repository projection writer.');
    }
    if (typeof buildCurrentData !== 'function' || typeof normalizeData !== 'function' || typeof findCardByKey !== 'function' || typeof mutator !== 'function') {
      throw new Error('Production execution core command requires command data callbacks.');
    }
    return this.inTransaction(async (tx) => {
      const current = await buildCurrentData({ tx });
      const draft = normalizeData(deepClone(current || {}));
      const result = await mutator(draft);
      const saved = result && typeof result === 'object' ? normalizeData(result) : draft;
      const changedCard = findCardByKey(saved, cardId);
      if (!changedCard) {
        const err = new Error('Карта не найдена');
        err.statusCode = 404;
        throw err;
      }

      const fallbackActualRev = Number.isFinite(Number(expectedFlowVersion))
        ? Number(expectedFlowVersion)
        : normalizeRev(changedCard?.flow?.version || 1);
      await this.lockAndCheckCardFlowVersion(tx, changedCard.id, expectedFlowVersion, fallbackActualRev);

      const cardsToPersist = [changedCard];
      (Array.isArray(extraCards) ? extraCards : []).forEach((card) => {
        const id = trimToString(card?.id);
        if (id && !cardsToPersist.some(item => trimToString(item?.id) === id)) cardsToPersist.push(card);
      });

      for (const card of cardsToPersist) {
        await cardsRepository.writeCardExecutionProjection(tx, card);
        await this.syncFlowStateFromCard(tx, card, {
          expectedFlowVersion: null,
          actorUserId,
          eventType,
          eventPayload
        });
        await this.syncFlowItemStatesFromCard(tx, card);
        await this.syncPersonalOperationsFromCard(tx, card);
        await this.syncMaterialDryingFromCard(tx, card, { actorUserId });
      }

      return {
        ...saved,
        cards: (Array.isArray(saved.cards) ? saved.cards : []).map((card) => (
          card && trimToString(card.id) === trimToString(changedCard.id) ? changedCard : card
        ))
      };
    }, { label: 'production-execution:core-workspace-command' });
  }

  applyFlowVersionsToCards(cards = [], versionMap = new Map()) {
    return (Array.isArray(cards) ? cards : []).map((card) => {
      const cardId = trimToString(card?.id);
      const version = versionMap.get(cardId);
      if (!version) return card;
      const next = { ...card, flow: { ...(card.flow || {}), version } };
      return next;
    });
  }
}

module.exports = {
  ProductionExecutionRepository,
  stableExecutionId: stableId
};
