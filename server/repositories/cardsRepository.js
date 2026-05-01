const { BaseRepository } = require('./baseRepository');
const { createSqlConflict } = require('../persistence/mysql/conflicts');

function trimToString(value) {
  return value == null ? '' : String(value).trim();
}

function toNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toBoolean(value) {
  return value === true || value === 1 || value === '1';
}

function attachmentsChanged(previous = {}, next = {}) {
  return JSON.stringify(previous?.attachments || []) !== JSON.stringify(next?.attachments || [])
    || trimToString(previous?.inputControlFileId || '') !== trimToString(next?.inputControlFileId || '');
}

function toMysqlDateTime(value) {
  if (value == null || value === '') return null;
  const date = value instanceof Date
    ? value
    : typeof value === 'number'
      ? new Date(value)
      : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace('T', ' ').replace('Z', '').replace(/(\.\d{3})\d+$/, '$1');
}

function fromMysqlDateTime(value) {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  const text = String(value);
  const ms = Date.parse(text.includes('T') ? text : `${text.replace(' ', 'T')}Z`);
  return Number.isFinite(ms) ? ms : null;
}

function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed == null ? fallback : parsed;
  } catch (err) {
    return fallback;
  }
}

const CARD_LOG_MESSAGE_MARKER = '__tspccCardLog';

function serializeCardLogMessage(log = {}) {
  return JSON.stringify({
    [CARD_LOG_MESSAGE_MARKER]: 1,
    object: trimToString(log.object || ''),
    targetId: log.targetId == null ? null : trimToString(log.targetId),
    field: log.field == null ? null : trimToString(log.field),
    userName: trimToString(log.userName || ''),
    createdBy: trimToString(log.createdBy || ''),
    oldValue: log.oldValue == null ? '' : log.oldValue,
    newValue: log.newValue == null ? '' : log.newValue,
    message: trimToString(log.message || '')
  });
}

function parseCardLogMessage(value) {
  const parsed = parseJson(value, null);
  if (parsed && typeof parsed === 'object' && parsed[CARD_LOG_MESSAGE_MARKER]) {
    return {
      object: trimToString(parsed.object || ''),
      targetId: parsed.targetId == null ? null : trimToString(parsed.targetId),
      field: parsed.field == null ? null : trimToString(parsed.field),
      userName: trimToString(parsed.userName || ''),
      createdBy: trimToString(parsed.createdBy || ''),
      oldValue: parsed.oldValue == null ? '' : parsed.oldValue,
      newValue: parsed.newValue == null ? '' : parsed.newValue,
      message: trimToString(parsed.message || '')
    };
  }
  if (parsed && typeof parsed === 'object') {
    return {
      object: trimToString(parsed.object || ''),
      targetId: parsed.targetId == null ? null : trimToString(parsed.targetId),
      field: parsed.field == null ? null : trimToString(parsed.field),
      userName: trimToString(parsed.userName || ''),
      createdBy: trimToString(parsed.createdBy || ''),
      oldValue: parsed.oldValue == null ? '' : parsed.oldValue,
      newValue: parsed.newValue == null ? '' : parsed.newValue,
      message: trimToString(parsed.message || value || '')
    };
  }
  return {
    object: '',
    targetId: null,
    field: null,
    userName: '',
    createdBy: '',
    oldValue: '',
    newValue: value || '',
    message: value || ''
  };
}

function normalizeAttachmentForSql(card, attachment = {}) {
  const relPath = trimToString(attachment.relPath || attachment.storedName || attachment.name || attachment.originalName);
  const originalName = trimToString(attachment.originalName || attachment.name || attachment.storedName || relPath || 'file');
  return {
    id: trimToString(attachment.id),
    cardId: trimToString(card.id),
    storageKey: trimToString(card.qrId || card.barcode || card.id),
    relPath,
    category: trimToString(attachment.category || 'GENERAL').toUpperCase(),
    scope: trimToString(attachment.scope || 'CARD').toUpperCase(),
    scopeId: trimToString(attachment.scopeId || '') || null,
    operationLabel: trimToString(attachment.operationLabel || ''),
    itemsLabel: trimToString(attachment.itemsLabel || ''),
    opId: trimToString(attachment.opId || '') || null,
    opCode: trimToString(attachment.opCode || ''),
    opName: trimToString(attachment.opName || ''),
    originalName,
    mimeType: trimToString(attachment.mime || attachment.type || 'application/octet-stream'),
    sizeBytes: toNumberOrNull(attachment.size),
    createdAt: toMysqlDateTime(attachment.createdAt || card.createdAt || Date.now())
  };
}

function cardCoreValues(card, rev) {
  return [
    trimToString(card.id),
    Number.isFinite(Number(rev)) ? Number(rev) : 1,
    trimToString(card.qrId || '') || null,
    trimToString(card.barcode || '') || null,
    trimToString(card.routeCardNumber || '') || null,
    trimToString(card.cardType || card.type || 'MKI') || 'MKI',
    trimToString(card.approvalStage || 'DRAFT') || 'DRAFT',
    trimToString(card.status || 'NOT_STARTED') || 'NOT_STARTED',
    trimToString(card.productionStatus || '') || null,
    Boolean(card.archived),
    trimToString(card.name || card.title || '') || null,
    trimToString(card.itemName || '') || null,
    trimToString(card.itemDesignation || card.documentDesignation || '') || null,
    trimToString(card.documentNumber || card.drawing || '') || null,
    trimToString(card.documentRevision || '') || null,
    toNumberOrNull(card.quantity),
    toNumberOrNull(card.batchSize),
    trimToString(card.mainMaterials || '') || null,
    JSON.stringify(buildDescriptiveAttrs(card)),
    trimToString(card.rejectionReason || '') || null,
    trimToString(card.rejectionReadByUserId || '') || null,
    toMysqlDateTime(card.rejectionReadAt),
    Boolean(card.inputControlRequired),
    Boolean(card.inputControlDone || card.inputControlDoneAt),
    null,
    Boolean(card.provisionRequired),
    Boolean(card.provisionDone || card.provisionDoneAt),
    trimToString(card.createdByUserId || '') || null,
    toMysqlDateTime(card.createdAt) || toMysqlDateTime(Date.now()),
    toMysqlDateTime(card.updatedAt) || toMysqlDateTime(Date.now()),
    card.archived ? (toMysqlDateTime(card.archivedAt) || toMysqlDateTime(card.updatedAt) || toMysqlDateTime(Date.now())) : null
  ];
}

function buildDescriptiveAttrs(card) {
  const copy = { ...card };
  [
    'id', 'rev', 'qrId', 'barcode', 'routeCardNumber', 'cardType', 'type',
    'approvalStage', 'status', 'productionStatus', 'archived', 'name', 'title',
    'itemName', 'itemDesignation', 'documentDesignation', 'documentNumber',
    'documentRevision', 'drawing', 'quantity', 'batchSize', 'mainMaterials',
    'rejectionReason', 'rejectionReadByUserId', 'rejectionReadAt',
    'inputControlRequired', 'inputControlDone', 'inputControlFileId',
    'provisionRequired', 'provisionDone', 'createdByUserId', 'createdAt',
    'updatedAt', 'archivedAt', 'attachments', 'logs', 'operations',
    'itemSerials', 'initialSnapshot'
  ].forEach((key) => delete copy[key]);
  return copy;
}

function rowToCard(row, { operations = [], attachments = [], logs = [], approvalThread = [], initialSnapshot = null } = {}) {
  const extra = parseJson(row.descriptive_attrs_json, {});
  const card = {
    ...extra,
    id: row.id,
    rev: Number(row.rev) || 1,
    qrId: row.qr_id || '',
    barcode: row.barcode || '',
    routeCardNumber: row.route_card_number || '',
    cardType: row.card_type || extra.cardType || extra.type || 'MKI',
    approvalStage: row.approval_stage || 'DRAFT',
    status: row.status || 'NOT_STARTED',
    productionStatus: row.production_status || '',
    archived: toBoolean(row.archived),
    name: row.title || extra.name || '',
    title: row.title || extra.title || '',
    itemName: row.item_name || extra.itemName || '',
    itemDesignation: row.item_designation || extra.itemDesignation || '',
    documentDesignation: row.item_designation || extra.documentDesignation || '',
    documentNumber: row.document_number || extra.documentNumber || '',
    documentRevision: row.document_revision || extra.documentRevision || '',
    quantity: row.quantity == null ? extra.quantity || '' : Number(row.quantity),
    batchSize: row.batch_size == null ? extra.batchSize || '' : Number(row.batch_size),
    mainMaterials: row.main_materials_text || extra.mainMaterials || '',
    rejectionReason: row.rejection_reason || '',
    rejectionReadByUserId: row.rejection_read_by_user_id || '',
    rejectionReadAt: fromMysqlDateTime(row.rejection_read_at),
    inputControlRequired: toBoolean(row.input_control_required),
    inputControlDone: toBoolean(row.input_control_done),
    inputControlFileId: row.input_control_file_attachment_id || '',
    provisionRequired: toBoolean(row.provision_required),
    provisionDone: toBoolean(row.provision_done),
    createdByUserId: row.created_by_user_id || '',
    createdAt: fromMysqlDateTime(row.created_at) || Date.now(),
    updatedAt: fromMysqlDateTime(row.updated_at) || Date.now(),
    archivedAt: fromMysqlDateTime(row.archived_at),
    operations,
    itemSerials: Array.isArray(extra.itemSerials) ? extra.itemSerials : [],
    attachments,
    logs,
    approvalThread,
    initialSnapshot
  };
  if (!card.drawing && row.document_number) card.drawing = row.document_number;
  return card;
}

function operationFromRow(row) {
  const extra = parseJson(row.descriptive_attrs_json, {});
  return {
    ...extra,
    id: row.id,
    opId: row.operation_id || extra.opId || '',
    centerId: row.work_center_id || extra.centerId || '',
    order: Number(row.sequence_no) || extra.order || 0,
    opName: row.operation_name_snapshot || extra.opName || '',
    centerName: row.work_center_name_snapshot || extra.centerName || '',
    quantity: row.planned_quantity == null ? extra.quantity || '' : Number(row.planned_quantity),
    status: row.status || extra.status || 'NOT_STARTED',
    comment: row.comments || extra.comment || ''
  };
}

function attachmentFromRow(row) {
  const storedName = trimToString(row.rel_path || '').split('/').pop() || '';
  return {
    id: row.id,
    name: row.original_name || storedName || 'file',
    originalName: row.original_name || storedName || 'file',
    storedName,
    relPath: row.rel_path || '',
    type: row.mime_type || 'application/octet-stream',
    mime: row.mime_type || 'application/octet-stream',
    size: row.size_bytes == null ? 0 : Number(row.size_bytes),
    createdAt: fromMysqlDateTime(row.created_at) || Date.now(),
    category: trimToString(row.category || 'GENERAL').toUpperCase(),
    scope: trimToString(row.scope || 'CARD').toUpperCase(),
    scopeId: row.scope_id || null,
    operationLabel: row.operation_label || '',
    itemsLabel: row.items_label || '',
    opId: row.op_id || null,
    opCode: row.op_code || '',
    opName: row.op_name || ''
  };
}

function logFromRow(row) {
  const payload = parseCardLogMessage(row.message);
  return {
    id: row.id,
    ts: fromMysqlDateTime(row.created_at) || Date.now(),
    action: row.event_type || 'update',
    object: payload.object,
    targetId: payload.targetId,
    field: payload.field,
    userName: payload.userName,
    createdBy: payload.createdBy,
    oldValue: payload.oldValue,
    newValue: payload.newValue,
    message: payload.message
  };
}

function approvalThreadFromRow(row) {
  return {
    id: row.id,
    ts: fromMysqlDateTime(row.event_at) || Date.now(),
    userName: row.actor_name_snapshot || 'Пользователь',
    actionType: row.action_type || '',
    roleContext: row.role_context || '',
    comment: row.comment || ''
  };
}

class CardsRepository extends BaseRepository {
  constructor(options = {}) {
    super({ ...options, domain: 'cards' });
  }

  async listCards(options = {}) {
    const where = options.includeDeleted ? '' : 'WHERE deleted_at IS NULL';
    const result = await this.query({
      sql: `SELECT * FROM cards ${where} ORDER BY created_at DESC`,
      values: [],
      label: 'cards:list'
    });
    return this.hydrateCards(result.rows || []);
  }

  async getCardByKey(key, options = {}) {
    const normalized = trimToString(key);
    if (!normalized) return null;
    const lock = options.forUpdate ? ' FOR UPDATE' : '';
    const target = options.tx || this;
    const result = await target.query({
      sql: `
        SELECT * FROM cards
        WHERE deleted_at IS NULL
          AND (id = ? OR qr_id = ? OR barcode = ? OR route_card_number = ?)
        LIMIT 1${lock}
      `,
      values: [normalized, normalized, normalized, normalized],
      label: 'cards:get-by-key'
    });
    const row = (result.rows || [])[0];
    if (!row) return null;
    const cards = await this.hydrateCards([row], options.tx || null);
    return cards[0] || null;
  }

  async createCard(card) {
    const created = { ...card, rev: 1 };
    return this.inTransaction(async (tx) => {
      await this.writeCardAggregate(tx, created, { expectedRev: null, nextRev: 1, insert: true });
      const saved = await this.getCardByKey(created.id, { tx });
      await this.appendDomainEvent(tx, {
        domain: 'cards',
        entity: 'card',
        id: saved.id,
        rev: saved.rev,
        eventType: 'card.created',
        transportEventName: 'card.created',
        scope: 'cards-basic',
        route: `/cards/${saved.id}`,
        hints: { ids: [saved.id], cardIds: [saved.id] }
      });
      return saved;
    }, { label: 'cards:create' });
  }

  async replaceCard(card, expectedRev) {
    return this.inTransaction(async (tx) => {
      const current = await this.getCardByKey(card.id, { tx, forUpdate: true });
      if (!current) {
        const err = new Error('Карточка не найдена');
        err.code = 'CARD_NOT_FOUND';
        throw err;
      }
      const actualRev = Number(current.rev) || 1;
      if (Number(expectedRev) !== actualRev) {
        throw createSqlConflict({
          code: 'STALE_REVISION',
          entity: 'card',
          id: current.id,
          expectedRev,
          actualRev,
          message: 'Версия карточки устарела'
        });
      }
      const next = { ...card, id: current.id, rev: actualRev + 1, updatedAt: Date.now() };
      await this.writeCardAggregate(tx, next, { expectedRev: actualRev, nextRev: actualRev + 1 });
      const saved = await this.getCardByKey(current.id, { tx });
      await this.appendDomainEvent(tx, {
        domain: 'cards',
        entity: 'card',
        id: saved.id,
        rev: saved.rev,
        eventType: 'card.updated',
        transportEventName: 'card.updated',
        scope: 'cards-basic',
        route: `/cards/${saved.id}`,
        hints: { ids: [saved.id], cardIds: [saved.id] }
      });
      if (attachmentsChanged(current, saved)) {
        await this.appendDomainEvent(tx, {
          domain: 'card-files',
          entity: 'card.file-metadata',
          id: saved.id,
          rev: saved.rev,
          eventType: 'card.files-updated',
          transportEventName: 'card.files-updated',
          scope: 'cards-basic',
          route: `/cards/${saved.id}`,
          hints: { ids: [saved.id], cardIds: [saved.id], filesCount: Array.isArray(saved.attachments) ? saved.attachments.length : 0 }
        });
      }
      return saved;
    }, { label: 'cards:replace' });
  }

  async mutateCard(cardKey, expectedRev, mutator) {
    return this.inTransaction(async (tx) => {
      const current = await this.getCardByKey(cardKey, { tx, forUpdate: true });
      if (!current) {
        const err = new Error('Карточка не найдена');
        err.code = 'CARD_NOT_FOUND';
        throw err;
      }
      const actualRev = Number(current.rev) || 1;
      if (Number(expectedRev) !== actualRev) {
        throw createSqlConflict({
          code: 'STALE_REVISION',
          entity: 'card',
          id: current.id,
          expectedRev,
          actualRev,
          message: 'Версия карточки устарела'
        });
      }
      const result = await mutator({ ...current });
      if (result && result.delete === true) {
        await tx.query({
          sql: 'DELETE FROM cards WHERE id = ? AND rev = ?',
          values: [current.id, actualRev],
          label: 'cards:delete'
        });
        await this.appendDomainEvent(tx, {
          domain: 'cards',
          entity: 'card',
          id: current.id,
          rev: actualRev + 1,
          eventType: 'card.deleted',
          transportEventName: 'card.deleted',
          scope: 'cards-basic',
          route: '/cards',
          hints: { ids: [current.id], cardIds: [current.id], deleted: true }
        });
        return { deletedId: current.id, previousCard: current };
      }
      const nextCard = result?.card || result || current;
      nextCard.id = current.id;
      nextCard.rev = actualRev + 1;
      nextCard.updatedAt = Date.now();
      await this.writeCardAggregate(tx, nextCard, { expectedRev: actualRev, nextRev: actualRev + 1 });
      const savedCard = await this.getCardByKey(current.id, { tx });
      await this.appendDomainEvent(tx, {
        domain: 'cards',
        entity: 'card',
        id: savedCard.id,
        rev: savedCard.rev,
        eventType: 'card.updated',
        transportEventName: 'card.updated',
        scope: 'cards-basic',
        route: `/cards/${savedCard.id}`,
        hints: { ids: [savedCard.id], cardIds: [savedCard.id] }
      });
      if (attachmentsChanged(current, savedCard)) {
        await this.appendDomainEvent(tx, {
          domain: 'card-files',
          entity: 'card.file-metadata',
          id: savedCard.id,
          rev: savedCard.rev,
          eventType: 'card.files-updated',
          transportEventName: 'card.files-updated',
          scope: 'cards-basic',
          route: `/cards/${savedCard.id}`,
          hints: { ids: [savedCard.id], cardIds: [savedCard.id], filesCount: Array.isArray(savedCard.attachments) ? savedCard.attachments.length : 0 }
        });
      }
      return { card: savedCard, previousCard: current };
    }, { label: 'cards:mutate' });
  }

  async repeatCard(cardKey, expectedRev, buildRepeatedCard, mutateSource) {
    return this.inTransaction(async (tx) => {
      const current = await this.getCardByKey(cardKey, { tx, forUpdate: true });
      if (!current) {
        const err = new Error('Карточка не найдена');
        err.code = 'CARD_NOT_FOUND';
        throw err;
      }
      const actualRev = Number(current.rev) || 1;
      if (Number(expectedRev) !== actualRev) {
        throw createSqlConflict({
          code: 'STALE_REVISION',
          entity: 'card',
          id: current.id,
          expectedRev,
          actualRev,
          message: 'Версия карточки устарела'
        });
      }
      if (!current.archived) {
        const err = new Error('Повтор доступен только для архивной карточки');
        err.code = 'CARD_NOT_ARCHIVED';
        throw err;
      }
      const sourceCard = mutateSource ? await mutateSource({ ...current }) : current;
      sourceCard.id = current.id;
      sourceCard.rev = actualRev + 1;
      sourceCard.updatedAt = Date.now();
      await this.writeCardAggregate(tx, sourceCard, { expectedRev: actualRev, nextRev: actualRev + 1 });
      const repeatedCard = await buildRepeatedCard(sourceCard);
      repeatedCard.rev = 1;
      await this.writeCardAggregate(tx, repeatedCard, { expectedRev: null, nextRev: 1, insert: true });
      const sourceSaved = await this.getCardByKey(sourceCard.id, { tx });
      const repeatedSaved = await this.getCardByKey(repeatedCard.id, { tx });
      await this.appendDomainEvent(tx, {
        domain: 'cards',
        entity: 'card',
        id: sourceSaved.id,
        rev: sourceSaved.rev,
        eventType: 'card.updated',
        transportEventName: 'card.updated',
        scope: 'cards-basic',
        route: `/cards/${sourceSaved.id}`,
        hints: { ids: [sourceSaved.id], cardIds: [sourceSaved.id], reason: 'repeat-source' }
      });
      await this.appendDomainEvent(tx, {
        domain: 'cards',
        entity: 'card',
        id: repeatedSaved.id,
        rev: repeatedSaved.rev,
        eventType: 'card.created',
        transportEventName: 'card.created',
        scope: 'cards-basic',
        route: `/cards/${repeatedSaved.id}`,
        hints: { ids: [repeatedSaved.id], cardIds: [repeatedSaved.id], sourceCardId: sourceSaved.id }
      });
      return {
        sourceCard: sourceSaved,
        card: repeatedSaved
      };
    }, { label: 'cards:repeat' });
  }

  async hydrateCards(rows, tx = null) {
    const ids = (rows || []).map((row) => row.id).filter(Boolean);
    if (!ids.length) return [];
    const target = tx || this;
    const placeholders = ids.map(() => '?').join(',');
    const operations = await target.query({ sql: `SELECT * FROM card_operations WHERE card_id IN (${placeholders}) ORDER BY card_id, sequence_no`, values: ids, label: 'cards:operations' });
    const attachments = await target.query({ sql: `SELECT * FROM card_attachments WHERE card_id IN (${placeholders}) AND deleted_at IS NULL ORDER BY card_id, created_at, id`, values: ids, label: 'cards:attachments' });
    const logs = await target.query({ sql: `SELECT * FROM card_logs WHERE card_id IN (${placeholders}) ORDER BY card_id, created_at, id`, values: ids, label: 'cards:logs' });
    const approvalEvents = await target.query({ sql: `SELECT * FROM card_approval_events WHERE card_id IN (${placeholders}) ORDER BY card_id, event_at, id`, values: ids, label: 'cards:approval-events' });
    const snapshots = await target.query({ sql: `SELECT * FROM card_initial_snapshots_archive WHERE card_id IN (${placeholders})`, values: ids, label: 'cards:initial-snapshots' });

    const byCard = (result, mapper) => {
      const map = new Map();
      for (const row of result.rows || []) {
        if (!map.has(row.card_id)) map.set(row.card_id, []);
        map.get(row.card_id).push(mapper(row));
      }
      return map;
    };
    const operationMap = byCard(operations, operationFromRow);
    const attachmentMap = byCard(attachments, attachmentFromRow);
    const logMap = byCard(logs, logFromRow);
    const approvalMap = byCard(approvalEvents, approvalThreadFromRow);
    const snapshotMap = new Map((snapshots.rows || []).map((row) => [row.card_id, parseJson(row.snapshot_json, null)]));

    return rows.map((row) => rowToCard(row, {
      operations: operationMap.get(row.id) || [],
      attachments: attachmentMap.get(row.id) || [],
      logs: logMap.get(row.id) || [],
      approvalThread: approvalMap.get(row.id) || [],
      initialSnapshot: snapshotMap.get(row.id) || null
    }));
  }

  async writeCardAggregate(tx, card, options = {}) {
    const nextRev = Number(options.nextRev) || Number(card.rev) || 1;
    await tx.query({
      sql: `
        INSERT INTO cards (
          id, rev, qr_id, barcode, route_card_number, card_type, approval_stage,
          status, production_status, archived, title, item_name, item_designation,
          document_number, document_revision, quantity, batch_size, main_materials_text,
          descriptive_attrs_json, rejection_reason, rejection_read_by_user_id,
          rejection_read_at, input_control_required, input_control_done,
          input_control_file_attachment_id, provision_required, provision_done,
          created_by_user_id, created_at, updated_at, archived_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          rev = VALUES(rev),
          qr_id = VALUES(qr_id),
          barcode = VALUES(barcode),
          route_card_number = VALUES(route_card_number),
          card_type = VALUES(card_type),
          approval_stage = VALUES(approval_stage),
          status = VALUES(status),
          production_status = VALUES(production_status),
          archived = VALUES(archived),
          title = VALUES(title),
          item_name = VALUES(item_name),
          item_designation = VALUES(item_designation),
          document_number = VALUES(document_number),
          document_revision = VALUES(document_revision),
          quantity = VALUES(quantity),
          batch_size = VALUES(batch_size),
          main_materials_text = VALUES(main_materials_text),
          descriptive_attrs_json = VALUES(descriptive_attrs_json),
          rejection_reason = VALUES(rejection_reason),
          rejection_read_by_user_id = VALUES(rejection_read_by_user_id),
          rejection_read_at = VALUES(rejection_read_at),
          input_control_required = VALUES(input_control_required),
          input_control_done = VALUES(input_control_done),
          input_control_file_attachment_id = NULL,
          provision_required = VALUES(provision_required),
          provision_done = VALUES(provision_done),
          updated_at = VALUES(updated_at),
          archived_at = VALUES(archived_at)
      `,
      values: cardCoreValues(card, nextRev),
      label: 'cards:write-core'
    });

    await tx.query({ sql: 'UPDATE cards SET input_control_file_attachment_id = NULL WHERE id = ?', values: [card.id], label: 'cards:clear-input-control-file' });
    await tx.query({ sql: 'DELETE FROM card_operations WHERE card_id = ?', values: [card.id], label: 'cards:replace-operations' });
    const operations = Array.isArray(card.operations) ? card.operations : [];
    for (let index = 0; index < operations.length; index += 1) {
      const op = operations[index] || {};
      await tx.query({
        sql: `
          INSERT INTO card_operations (
            id, card_id, operation_id, work_center_id, sequence_no,
            operation_name_snapshot, work_center_name_snapshot, planned_quantity,
            status, comments, descriptive_attrs_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        values: [
          trimToString(op.id || `${card.id}:op:${index}`),
          card.id,
          null,
          null,
          Number(op.order) || index + 1,
          trimToString(op.opName || op.name || ''),
          trimToString(op.centerName || ''),
          toNumberOrNull(op.quantity),
          trimToString(op.status || 'NOT_STARTED') || 'NOT_STARTED',
          trimToString(op.comment || op.commentsText || ''),
          JSON.stringify(op)
        ],
        label: 'cards:insert-operation'
      });
    }

    await tx.query({ sql: 'DELETE FROM card_serials WHERE card_id = ?', values: [card.id], label: 'cards:replace-serials' });
    const serials = Array.isArray(card.itemSerials) ? card.itemSerials : [];
    for (const serial of serials) {
      const serialText = trimToString(serial?.serialNo || serial);
      if (!serialText) continue;
      await tx.query({
        sql: 'INSERT INTO card_serials (card_id, serial_no, quantity) VALUES (?, ?, ?)',
        values: [card.id, serialText, toNumberOrNull(serial?.quantity)],
        label: 'cards:insert-serial'
      });
    }

    await tx.query({ sql: 'DELETE FROM card_attachments WHERE card_id = ?', values: [card.id], label: 'cards:replace-attachments' });
    const attachments = Array.isArray(card.attachments) ? card.attachments : [];
    for (const attachment of attachments) {
      const row = normalizeAttachmentForSql(card, attachment);
      if (!row.id || !row.relPath) continue;
      await tx.query({
        sql: `
          INSERT INTO card_attachments (
            id, card_id, storage_key, rel_path, category, scope, scope_id,
            operation_label, items_label, op_id, op_code, op_name,
            original_name, mime_type, size_bytes, created_by_user_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
        `,
        values: [
          row.id, row.cardId, row.storageKey, row.relPath, row.category, row.scope,
          row.scopeId, row.operationLabel, row.itemsLabel, row.opId, row.opCode,
          row.opName, row.originalName, row.mimeType, row.sizeBytes, row.createdAt
        ],
        label: 'cards:insert-attachment'
      });
    }

    const inputControlFileId = trimToString(card.inputControlFileId || '');
    if (inputControlFileId && attachments.some((item) => trimToString(item?.id) === inputControlFileId)) {
      await tx.query({
        sql: 'UPDATE cards SET input_control_file_attachment_id = ? WHERE id = ?',
        values: [inputControlFileId, card.id],
        label: 'cards:set-input-control-file'
      });
    }

    for (const log of Array.isArray(card.logs) ? card.logs : []) {
      await tx.query({
        sql: `
          INSERT IGNORE INTO card_logs (id, card_id, event_type, actor_user_id, message, created_at)
          VALUES (?, ?, ?, NULL, ?, ?)
        `,
        values: [
          trimToString(log.id || `${card.id}:log:${log.ts || Date.now()}`),
          card.id,
          trimToString(log.action || 'update'),
          serializeCardLogMessage(log),
          toMysqlDateTime(log.ts || log.createdAt || Date.now())
        ],
        label: 'cards:insert-log'
      });
    }

    for (const event of Array.isArray(card.approvalThread) ? card.approvalThread : []) {
      await tx.query({
        sql: `
          INSERT IGNORE INTO card_approval_events (
            id, card_id, role_context, action_type, actor_user_id,
            actor_name_snapshot, comment, event_at
          ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)
        `,
        values: [
          trimToString(event.id || `${card.id}:approval:${event.ts || Date.now()}:${event.actionType || ''}`),
          card.id,
          trimToString(event.roleContext || ''),
          trimToString(event.actionType || 'APPROVAL'),
          trimToString(event.userName || 'Пользователь'),
          trimToString(event.comment || ''),
          toMysqlDateTime(event.ts || event.createdAt || Date.now())
        ],
        label: 'cards:insert-approval-event'
      });
    }

    if (card.initialSnapshot) {
      await tx.query({
        sql: `
          INSERT INTO card_initial_snapshots_archive (card_id, snapshot_json)
          VALUES (?, ?)
          ON DUPLICATE KEY UPDATE snapshot_json = snapshot_json
        `,
        values: [card.id, JSON.stringify(card.initialSnapshot)],
        label: 'cards:initial-snapshot'
      });
    }
  }

  async writeCardExecutionProjection(tx, card) {
    const rev = Number(card.rev) || 1;
    await tx.query({
      sql: `
        INSERT INTO cards (
          id, rev, qr_id, barcode, route_card_number, card_type, approval_stage,
          status, production_status, archived, title, item_name, item_designation,
          document_number, document_revision, quantity, batch_size, main_materials_text,
          descriptive_attrs_json, rejection_reason, rejection_read_by_user_id,
          rejection_read_at, input_control_required, input_control_done,
          input_control_file_attachment_id, provision_required, provision_done,
          created_by_user_id, created_at, updated_at, archived_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          status = VALUES(status),
          production_status = VALUES(production_status),
          quantity = VALUES(quantity),
          batch_size = VALUES(batch_size),
          main_materials_text = VALUES(main_materials_text),
          descriptive_attrs_json = VALUES(descriptive_attrs_json),
          updated_at = VALUES(updated_at)
      `,
      values: cardCoreValues(card, rev),
      label: 'cards:execution-projection:card'
    });

    const operations = Array.isArray(card.operations) ? card.operations : [];
    for (let index = 0; index < operations.length; index += 1) {
      const op = operations[index] || {};
      await tx.query({
        sql: `
          INSERT INTO card_operations (
            id, card_id, operation_id, work_center_id, sequence_no,
            operation_name_snapshot, work_center_name_snapshot, planned_quantity,
            status, comments, descriptive_attrs_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            sequence_no = VALUES(sequence_no),
            operation_name_snapshot = VALUES(operation_name_snapshot),
            work_center_name_snapshot = VALUES(work_center_name_snapshot),
            planned_quantity = VALUES(planned_quantity),
            status = VALUES(status),
            comments = VALUES(comments),
            descriptive_attrs_json = VALUES(descriptive_attrs_json)
        `,
        values: [
          trimToString(op.id || `${card.id}:op:${index}`),
          card.id,
          null,
          null,
          Number(op.order) || index + 1,
          trimToString(op.opName || op.name || ''),
          trimToString(op.centerName || ''),
          toNumberOrNull(op.quantity),
          trimToString(op.status || 'NOT_STARTED') || 'NOT_STARTED',
          trimToString(op.comment || op.commentsText || ''),
          JSON.stringify(op)
        ],
        label: 'cards:execution-projection:operation'
      });
    }

    await tx.query({ sql: 'DELETE FROM card_serials WHERE card_id = ?', values: [card.id], label: 'cards:execution-projection:serials-clear' });
    const serials = Array.isArray(card.itemSerials) ? card.itemSerials : [];
    for (const serial of serials) {
      const serialText = trimToString(serial?.serialNo || serial);
      if (!serialText) continue;
      await tx.query({
        sql: 'INSERT INTO card_serials (card_id, serial_no, quantity) VALUES (?, ?, ?)',
        values: [card.id, serialText, toNumberOrNull(serial?.quantity)],
        label: 'cards:execution-projection:serial'
      });
    }

    for (const attachment of Array.isArray(card.attachments) ? card.attachments : []) {
      const row = normalizeAttachmentForSql(card, attachment);
      if (!row.id || !row.relPath) continue;
      await tx.query({
        sql: `
          INSERT IGNORE INTO card_attachments (
            id, card_id, storage_key, rel_path, category, scope, scope_id,
            operation_label, items_label, op_id, op_code, op_name,
            original_name, mime_type, size_bytes, created_by_user_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
        `,
        values: [
          row.id, row.cardId, row.storageKey, row.relPath, row.category, row.scope,
          row.scopeId, row.operationLabel, row.itemsLabel, row.opId, row.opCode,
          row.opName, row.originalName, row.mimeType, row.sizeBytes, row.createdAt
        ],
        label: 'cards:execution-projection:attachment'
      });
    }

    for (const log of Array.isArray(card.logs) ? card.logs : []) {
      await tx.query({
        sql: `
          INSERT IGNORE INTO card_logs (id, card_id, event_type, actor_user_id, message, created_at)
          VALUES (?, ?, ?, NULL, ?, ?)
        `,
        values: [
          trimToString(log.id || `${card.id}:log:${log.ts || Date.now()}`),
          card.id,
          trimToString(log.action || 'update'),
          serializeCardLogMessage(log),
          toMysqlDateTime(log.ts || log.createdAt || Date.now())
        ],
        label: 'cards:execution-projection:log'
      });
    }
  }
}

class CardFilesRepository extends BaseRepository {
  constructor(options = {}) {
    super({ ...options, domain: 'card-files' });
    this.cardsRepository = options.cardsRepository || new CardsRepository(options);
  }

  async getFiles(cardKey) {
    const card = await this.cardsRepository.inTransaction(async (tx) => this.cardsRepository.getCardByKey(cardKey, { tx }), {
      label: 'card-files:get-card'
    });
    return card ? { card, files: card.attachments || [] } : null;
  }

  async getAttachmentById(attachmentId) {
    const id = trimToString(attachmentId);
    if (!id) return null;
    return this.cardsRepository.inTransaction(async (tx) => {
      const result = await tx.query({
        sql: `
          SELECT c.* FROM cards c
          INNER JOIN card_attachments a ON a.card_id = c.id
          WHERE a.id = ? AND a.deleted_at IS NULL AND c.deleted_at IS NULL
          LIMIT 1
        `,
        values: [id],
        label: 'card-files:get-attachment-card'
      });
      const row = (result.rows || [])[0];
      if (!row) return null;
      const card = (await this.cardsRepository.hydrateCards([row], tx))[0] || null;
      const attachment = (card?.attachments || []).find((item) => item && item.id === id) || null;
      return attachment ? { card, attachment } : null;
    }, { label: 'card-files:get-attachment' });
  }

  async mutateFiles(cardKey, expectedRev, mutator) {
    return this.cardsRepository.mutateCard(cardKey, expectedRev, async (card) => {
      const next = await mutator(card);
      return next || card;
    });
  }
}

module.exports = {
  CardsRepository,
  CardFilesRepository,
  fromMysqlDateTime,
  toMysqlDateTime
};
