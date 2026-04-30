const { BaseRepository } = require('./baseRepository');

const DERIVED_VIEW_DEPENDENCIES = Object.freeze({
  cards: 'CardsRepository',
  directoriesSecurity: ['DirectoriesRepository', 'SecurityRepository'],
  productionPlanning: 'ProductionPlanningRepository',
  productionExecution: 'ProductionExecutionRepository'
});

const VIEW_NAMES = Object.freeze({
  workorders: 'workorders_read_model',
  archive: 'archive_read_model',
  items: 'production_items_read_model',
  ok: 'production_ok_read_model',
  oc: 'production_oc_read_model'
});

function trimToString(value) {
  return value == null ? '' : String(value).trim();
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function fromMysqlDateTime(value) {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  const text = String(value);
  const ms = Date.parse(text.includes('T') ? text : `${text.replace(' ', 'T')}Z`);
  return Number.isFinite(ms) ? ms : null;
}

function rowToCardReadModel(row = {}) {
  return {
    cardId: trimToString(row.card_id),
    qrId: trimToString(row.qr_id),
    routeCardNumber: trimToString(row.route_card_number),
    cardType: trimToString(row.card_type),
    approvalStage: trimToString(row.approval_stage),
    status: trimToString(row.status),
    productionStatus: trimToString(row.production_status),
    archivedAt: fromMysqlDateTime(row.archived_at),
    updatedAt: fromMysqlDateTime(row.updated_at),
    planningTaskCount: toNumber(row.planning_task_count),
    flowStateCount: toNumber(row.flow_state_count),
    flowVersion: row.flow_version == null ? null : toNumber(row.flow_version, 1),
    currentFlowStatus: trimToString(row.current_flow_status)
  };
}

function rowToProductionItemReadModel(row = {}) {
  return {
    itemStateId: trimToString(row.item_state_id),
    cardId: trimToString(row.card_id),
    qrId: trimToString(row.qr_id),
    routeOperationId: trimToString(row.route_operation_id),
    operationId: trimToString(row.operation_id),
    operationName: trimToString(row.operation_name_snapshot),
    serialNo: trimToString(row.serial_no),
    kind: trimToString(row.item_kind).toUpperCase() === 'SAMPLE' ? 'SAMPLE' : 'ITEM',
    sampleType: trimToString(row.sample_type).toUpperCase(),
    itemStatus: trimToString(row.item_status),
    qualityStatus: trimToString(row.quality_status),
    quantity: row.quantity == null ? null : Number(row.quantity),
    updatedAt: fromMysqlDateTime(row.updated_at)
  };
}

class DerivedViewsRepository extends BaseRepository {
  constructor(options = {}) {
    super({ ...options, domain: 'derived-views' });
  }

  get dependencies() {
    return DERIVED_VIEW_DEPENDENCIES;
  }

  async listWorkorders(options = {}) {
    const target = options.tx || this;
    const result = await target.query({
      sql: `
        SELECT *
        FROM workorders_read_model
        ORDER BY updated_at DESC, card_id
      `,
      values: [],
      label: 'derived-views:workorders:list'
    });
    return (result.rows || []).map(rowToCardReadModel);
  }

  async getWorkorder(cardKey, options = {}) {
    return this.getCardViewRow(VIEW_NAMES.workorders, 'derived-views:workorders:get', cardKey, options);
  }

  async listArchive(options = {}) {
    const target = options.tx || this;
    const result = await target.query({
      sql: `
        SELECT *
        FROM archive_read_model
        ORDER BY archived_at DESC, updated_at DESC, card_id
      `,
      values: [],
      label: 'derived-views:archive:list'
    });
    return (result.rows || []).map(rowToCardReadModel);
  }

  async getArchivedCard(cardKey, options = {}) {
    return this.getCardViewRow(VIEW_NAMES.archive, 'derived-views:archive:get', cardKey, options);
  }

  async listProductionItems(options = {}) {
    return this.listProductionItemView(VIEW_NAMES.items, 'derived-views:items:list', options);
  }

  async listControlSamples(options = {}) {
    return this.listProductionItemView(VIEW_NAMES.ok, 'derived-views:ok:list', options);
  }

  async listWitnessSamples(options = {}) {
    return this.listProductionItemView(VIEW_NAMES.oc, 'derived-views:oc:list', options);
  }

  async getCardViewRow(viewName, label, cardKey, options = {}) {
    const normalizedKey = trimToString(cardKey);
    if (!normalizedKey) return null;
    const target = options.tx || this;
    const result = await target.query({
      sql: `
        SELECT *
        FROM ${viewName}
        WHERE card_id = ?
           OR qr_id = ?
           OR route_card_number = ?
        LIMIT 1
      `,
      values: [normalizedKey, normalizedKey, normalizedKey],
      label
    });
    const row = (result.rows || [])[0];
    return row ? rowToCardReadModel(row) : null;
  }

  async listProductionItemView(viewName, label, options = {}) {
    const target = options.tx || this;
    const result = await target.query({
      sql: `
        SELECT *
        FROM ${viewName}
        ORDER BY updated_at DESC, card_id, route_operation_id, item_state_id
      `,
      values: [],
      label
    });
    return (result.rows || []).map(rowToProductionItemReadModel);
  }
}

module.exports = {
  DERIVED_VIEW_DEPENDENCIES,
  DerivedViewsRepository,
  rowToCardReadModel,
  rowToProductionItemReadModel
};
