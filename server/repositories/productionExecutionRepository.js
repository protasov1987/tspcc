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

function findActiveFlowStateId(card = {}) {
  const operations = Array.isArray(card.operations) ? card.operations : [];
  const active = operations.find((operation) => {
    const status = trimToString(operation?.status || '').toUpperCase();
    return status && status !== 'NOT_STARTED';
  }) || operations[0] || null;
  return active ? stableId('pfs', [card.id, active.id || active.opId || active.opCode, 'flow']) : null;
}

class ProductionExecutionRepository extends BaseRepository {
  constructor(options = {}) {
    super({ ...options, domain: 'production-execution' });
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
      const flowStateId = stableId('pfs', [card.id, opId, 'flow']);
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
    const locked = await this.lockCardFlowVersion(tx, cardId);
    const actualBefore = locked.rows.length
      ? locked.actualRev
      : (Number.isFinite(Number(expectedFlowVersion)) ? Number(expectedFlowVersion) : Math.max(1, nextFlowVersion - 1));
    if (expectedFlowVersion != null) {
      this.assertExpectedFlowVersion(cardId, expectedFlowVersion, actualBefore);
    }
    await this.ensureFlowRowsForCard(tx, card, nextFlowVersion);

    const operations = Array.isArray(card.operations) ? card.operations : [];
    for (const operation of operations) {
      const opId = trimToString(operation?.id || operation?.opId || operation?.opCode);
      if (!opId) continue;
      const flowStateId = stableId('pfs', [cardId, opId, 'flow']);
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
          nextFlowVersion,
          operationStatus(operation, card),
          toMysqlDateTime(operation.startedAt || operation.firstStartedAt),
          toMysqlDateTime(operation.finishedAt),
          flowStateId
        ],
        label: 'production-execution:flow-state:update'
      });
    }

    const activeFlowStateId = findActiveFlowStateId(card);
    await tx.query({
      sql: `
        INSERT INTO card_flow_projection (
          card_id, active_flow_state_id, flow_version, current_status,
          current_area_id, updated_at
        ) VALUES (?, ?, ?, ?, NULL, UTC_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE
          active_flow_state_id = VALUES(active_flow_state_id),
          flow_version = VALUES(flow_version),
          current_status = VALUES(current_status),
          current_area_id = NULL,
          updated_at = UTC_TIMESTAMP(3)
      `,
      values: [
        cardId,
        activeFlowStateId,
        nextFlowVersion,
        trimToString(card.productionStatus || card.status || operationStatus(operations[0], card)) || null
      ],
      label: 'production-execution:projection:upsert'
    });

    const eventFlowStateId = activeFlowStateId || stableId('pfs', [cardId, trimToString(operations[0]?.id || ''), 'flow']);
    if (eventFlowStateId) {
      await tx.query({
        sql: `
          INSERT INTO production_flow_events (
            id, flow_state_id, event_type, from_status, to_status,
            actor_user_id, expected_flow_version, resulting_flow_version,
            event_payload_json, created_at
          ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))
        `,
        values: [
          stableId('pfe', [cardId, eventType, Date.now(), nextFlowVersion]),
          eventFlowStateId,
          trimToString(eventType) || 'execution-update',
          trimToString(card.productionStatus || card.status || '') || null,
          trimToString(actorUserId) || null,
          Number.isFinite(Number(expectedFlowVersion)) ? Number(expectedFlowVersion) : null,
          nextFlowVersion,
          JSON.stringify(eventPayload || {})
        ],
        label: 'production-execution:flow-event:insert'
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
