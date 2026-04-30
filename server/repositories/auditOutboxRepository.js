const crypto = require('node:crypto');

const { BaseRepository } = require('./baseRepository');

function trimToString(value) {
  return value == null ? '' : String(value).trim();
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

function normalizeTimestamp(value) {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Event timestamp must be a valid date.');
  }
  return date.toISOString();
}

function normalizeJsonPayload(value, fallback = {}) {
  if (value == null) return fallback;
  if (typeof value !== 'object') {
    throw new Error('Event payload must be an object.');
  }
  return value;
}

function createEventEnvelope(input = {}) {
  const domain = trimToString(input.domain);
  const entity = trimToString(input.entity || input.aggregateType);
  const id = trimToString(input.id || input.aggregateId);
  const eventType = trimToString(input.eventType || input.action);
  if (!domain) throw new Error('Event envelope requires domain.');
  if (!entity) throw new Error('Event envelope requires entity.');
  if (!id) throw new Error('Event envelope requires id.');
  if (!eventType) throw new Error('Event envelope requires eventType.');

  const envelope = {
    domain,
    entity,
    id,
    eventType,
    timestamp: normalizeTimestamp(input.timestamp)
  };

  const rev = Number(input.rev);
  if (Number.isFinite(rev)) {
    envelope.rev = rev;
  } else if (input.version != null && trimToString(input.version)) {
    envelope.version = input.version;
  }

  if (trimToString(input.scope)) envelope.scope = trimToString(input.scope);
  if (trimToString(input.route)) envelope.route = trimToString(input.route);
  if (input.hints && typeof input.hints === 'object') envelope.hints = normalizeJsonPayload(input.hints);
  return envelope;
}

function descriptorFromEnvelope(outboxId, envelope, input = {}) {
  const transportEventName = trimToString(input.transportEventName || input.sseEventName || input.eventName || envelope.eventType);
  return {
    id: outboxId,
    domain: envelope.domain,
    entity: envelope.entity,
    aggregateType: envelope.entity,
    aggregateId: envelope.id,
    eventType: envelope.eventType,
    transportEventName,
    payload: envelope,
    createdAt: envelope.timestamp
  };
}

class AuditOutboxRepository extends BaseRepository {
  constructor(options = {}) {
    super({ ...options, domain: 'audit-outbox' });
    this.idFactory = options.idFactory || createId;
  }

  async appendAuditEvent(tx, input = {}) {
    const envelope = createEventEnvelope(input);
    const id = trimToString(input.auditId || input.idForAudit) || this.idFactory('audit');
    const payload = normalizeJsonPayload(input.auditPayload || input.payload || envelope);
    await tx.query({
      sql: `
        INSERT INTO audit_events (
          id, domain, aggregate_type, aggregate_id, event_type, actor_user_id,
          event_payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))
      `,
      values: [
        id,
        envelope.domain,
        envelope.entity,
        envelope.id,
        envelope.eventType,
        trimToString(input.actorUserId) || null,
        JSON.stringify(payload)
      ],
      label: 'audit-outbox:audit:append'
    });
    return { id, envelope };
  }

  async appendOutboxEvent(tx, input = {}) {
    const envelope = createEventEnvelope(input);
    const id = trimToString(input.outboxId || input.idForOutbox) || this.idFactory('outbox');
    await tx.query({
      sql: `
        INSERT INTO outbox_events (
          id, event_type, aggregate_type, aggregate_id, event_payload_json,
          created_at, processed_at, attempts, last_error
        ) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3), NULL, 0, NULL)
      `,
      values: [
        id,
        envelope.eventType,
        envelope.entity,
        envelope.id,
        JSON.stringify(envelope)
      ],
      label: 'audit-outbox:outbox:append'
    });
    const descriptor = descriptorFromEnvelope(id, envelope, input);
    if (typeof tx.addPostCommitEvent === 'function') {
      tx.addPostCommitEvent(descriptor);
    }
    return { id, envelope, descriptor };
  }

  async appendAuditAndOutbox(tx, input = {}) {
    const audit = await this.appendAuditEvent(tx, input);
    const outbox = await this.appendOutboxEvent(tx, {
      ...input,
      timestamp: audit.envelope.timestamp
    });
    return {
      auditId: audit.id,
      outboxId: outbox.id,
      envelope: outbox.envelope,
      descriptor: outbox.descriptor
    };
  }

  async markOutboxProcessed(outboxId) {
    const id = trimToString(outboxId);
    if (!id) throw new Error('outboxId is required.');
    await this.query({
      sql: `
        UPDATE outbox_events
        SET processed_at = UTC_TIMESTAMP(3), attempts = attempts + 1, last_error = NULL
        WHERE id = ?
      `,
      values: [id],
      label: 'audit-outbox:outbox:processed'
    });
    return { id, processed: true };
  }

  async markOutboxDispatchFailed(outboxId, error) {
    const id = trimToString(outboxId);
    if (!id) throw new Error('outboxId is required.');
    const message = trimToString(error?.message || error?.code || 'dispatch failed').slice(0, 4000);
    await this.query({
      sql: `
        UPDATE outbox_events
        SET attempts = attempts + 1, last_error = ?
        WHERE id = ?
      `,
      values: [message, id],
      label: 'audit-outbox:outbox:dispatch-failed'
    });
    return { id, processed: false, error: message };
  }
}

module.exports = {
  AuditOutboxRepository,
  createEventEnvelope,
  descriptorFromEnvelope
};
