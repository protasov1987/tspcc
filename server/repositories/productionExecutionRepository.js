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
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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

function findActiveFlowStateId(card = {}) {
  const operations = Array.isArray(card.operations) ? card.operations : [];
  const active = operations.find((operation) => {
    const status = trimToString(operation?.status || '').toUpperCase();
    return status && status !== 'NOT_STARTED';
  }) || operations[0] || null;
  return active ? flowStateIdFor(card.id, active.id || active.opId || active.opCode) : null;
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
    const itemStateId = this.getItemStateId(normalizedFlowStateId, normalizedSerialNo || itemKey);
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
          completed_by_user_id = VALUES(completed_by_user_id),
          status = VALUES(status),
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
