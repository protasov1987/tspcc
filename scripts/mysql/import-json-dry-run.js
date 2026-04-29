#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const { readMysqlMigrationEnv } = require('../../server/persistence/mysql/env');
const { createMysqlPoolFromConfig, isSqlLocalTestSignal } = require('../../server/persistence/mysql/pool');
const { executeQuery } = require('../../server/persistence/mysql/query');
const { withTransaction } = require('../../server/persistence/mysql/transaction');
const {
  readMigrationFiles,
  runMysqlMigrations
} = require('../../server/persistence/mysql/migrations/runner');

const REPO_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_JSON_PATH = path.join(REPO_ROOT, 'data/database.json');
const DEFAULT_FILES_ROOT = path.join(REPO_ROOT, 'storage/cards');
const DEFAULT_REPORT_DIR = path.join(REPO_ROOT, 'artifacts/mysql-import');

const EXPECTED_TOP_LEVEL_FIELDS = new Map([
  ['cards', 'cards'],
  ['ops', 'operations'],
  ['centers', 'work_centers'],
  ['areas', 'production_areas'],
  ['users', 'users'],
  ['accessLevels', 'access_levels'],
  ['messages', 'legacy-messages-report-only'],
  ['chatConversations', 'chat_conversations'],
  ['chatMessages', 'chat_messages'],
  ['chatStates', 'chat_message_states'],
  ['webPushSubscriptions', 'web_push_subscriptions'],
  ['fcmTokens', 'fcm_tokens'],
  ['userVisits', 'user_visits'],
  ['userActions', 'user_actions'],
  ['productionSchedule', 'production_schedule'],
  ['productionShiftTimes', 'production_shift_times'],
  ['productionShiftTasks', 'production_shift_tasks'],
  ['productionShifts', 'production_shifts'],
  ['meta', 'import-report-only']
]);

const COLLECTION_ID_FIELDS = new Map([
  ['cards', 'id'],
  ['ops', 'id'],
  ['centers', 'id'],
  ['areas', 'id'],
  ['users', 'id'],
  ['accessLevels', 'id'],
  ['chatConversations', 'id'],
  ['chatMessages', 'id'],
  ['webPushSubscriptions', 'id'],
  ['fcmTokens', 'id'],
  ['userVisits', 'id'],
  ['userActions', 'id'],
  ['productionShiftTasks', 'id'],
  ['productionShifts', 'id']
]);

const CARD_FIELDS = new Set([
  '__liveFilesCount', '__liveOpsCount', '__serialRouteBase', 'approvalProductionStatus',
  'approvalSKKStatus', 'approvalStage', 'approvalTechStatus', 'approvalThread', 'archived',
  'attachments', 'barcode', 'batchSize', 'cardType', 'contractNumber', 'createdAt', 'desc',
  'documentDate', 'documentDesignation', 'drawing', 'flow', 'id', 'initialSnapshot',
  'inputControlComment', 'inputControlDoneAt', 'inputControlDoneBy', 'inputControlFileId',
  'issuedBySurname', 'itemDesignation', 'itemName', 'itemSerials', 'labRequestNumber',
  'logs', 'mainMaterialGrade', 'mainMaterials', 'material', 'materialIssues',
  'materialReturns', 'name', 'operations', 'orderNo', 'partQrs', 'personalOperations',
  'plannedCompletionDate', 'productionStatus', 'programName', 'provisionDoneAt',
  'provisionDoneBy', 'qrId', 'quantity', 'rejectionReadAt', 'rejectionReadByUserName',
  'rejectionReason', 'responsibleProductionChief', 'responsibleProductionChiefAt',
  'responsibleSKKChief', 'responsibleSKKChiefAt', 'responsibleTechLead',
  'responsibleTechLeadAt', 'rev', 'routeCardNumber', 'sampleCount', 'sampleSerials',
  'specialNotes', 'status', 'supplyStandard', 'supplyState', 'updatedAt', 'useItemList',
  'witnessSampleCount', 'witnessSampleSerials', 'workBasis'
]);

const CARD_OPERATION_FIELDS = new Set([
  'id', 'opId', 'opCode', 'opName', 'operationType', 'centerId', 'centerName',
  'executor', 'plannedMinutes', 'quantity', 'autoCode', 'additionalExecutors', 'status',
  'firstStartedAt', 'startedAt', 'lastPausedAt', 'finishedAt', 'actualSeconds',
  'elapsedSeconds', 'order', 'comment', 'goodCount', 'scrapCount', 'holdCount', 'items',
  'isSamples', 'sampleType', 'pendingCount', 'blocked', 'blockedReasons', 'canStart',
  'canPause', 'canResume', 'canComplete', 'flowStats', 'comments'
]);

const ATTACHMENT_FIELDS = new Set([
  'id', 'name', 'originalName', 'storedName', 'relPath', 'type', 'mime', 'size',
  'createdAt', 'category', 'scope', 'scopeId', 'operationLabel', 'itemsLabel', 'opId',
  'opCode', 'opName'
]);

const VALID_CARD_TYPES = new Set(['MKI', 'МКИ', 'MK', 'МК', 'MKR', 'МК-РЕМ', 'REPAIR']);
const VALID_APPROVAL_STAGES = new Set([
  'DRAFT', 'ON_APPROVAL', 'REJECTED', 'APPROVED', 'WAITING_INPUT_CONTROL',
  'WAITING_PROVISION', 'PROVIDED', 'PLANNING', 'PLANNED'
]);
const VALID_CARD_STATUSES = new Set([
  'NOT_STARTED', 'IN_PROGRESS', 'PAUSED', 'DONE', 'COMPLETED', 'PLANNED',
  'PLANNING', 'ARCHIVED', 'WAITING', 'PROVIDED'
]);
const VALID_FLOW_STATUSES = new Set([
  'NOT_STARTED', 'PENDING', 'IN_PROGRESS', 'PAUSED', 'GOOD', 'DEFECT', 'DELAYED',
  'DISPOSED', 'COMPLETED', 'DONE', 'RETURNED', 'REPAIR', 'REPAIRED', 'BLOCKED',
  'NO_ITEMS'
]);
const VALID_SHIFT_STATUSES = new Set(['OPEN', 'CLOSED', 'LOCKED', 'FIXED', 'DRAFT', 'PLANNING']);

const IMPORT_TABLES_REVERSE = [
  'outbox_events',
  'audit_events',
  'user_actions',
  'fcm_tokens',
  'web_push_subscriptions',
  'user_visits',
  'chat_message_states',
  'chat_conversation_participants',
  'chat_messages',
  'chat_conversations',
  'card_flow_projection',
  'production_disposals',
  'production_repairs',
  'production_defects',
  'production_delays',
  'production_drying_records',
  'production_material_returns',
  'production_material_issues',
  'personal_operations',
  'production_flow_item_states',
  'production_flow_events',
  'production_flow_states',
  'production_shift_close_snapshot_history',
  'production_shift_close_snapshots',
  'production_shift_close_draft_archive',
  'production_shift_initial_snapshot_archive',
  'production_shift_logs',
  'production_shifts',
  'production_shift_tasks',
  'production_schedule',
  'production_planning_revisions',
  'card_initial_snapshots_archive',
  'card_input_control_records',
  'card_provision_records',
  'card_attachments',
  'card_logs',
  'card_approval_events',
  'card_lifecycle_events',
  'card_quantities',
  'card_serials',
  'card_operations',
  'cards',
  'user_sessions',
  'users',
  'access_level_permissions',
  'access_levels',
  'production_shift_times',
  'operation_allowed_areas',
  'operations',
  'production_areas',
  'work_centers'
];

function utcNow() {
  return new Date().toISOString();
}

function toMysqlDateTime(value) {
  if (value == null || value === '') return null;
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace('T', ' ').replace('Z', '').slice(0, 23);
}

function toDateOnly(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function toTime(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(text)) {
    const parts = text.split(':');
    return `${parts[0].padStart(2, '0')}:${parts[1]}:${parts[2] || '00'}`;
  }
  return null;
}

function nullableText(value) {
  if (value == null) return null;
  const text = String(value);
  return text === '' ? null : text;
}

function requiredText(value, fallback = '') {
  if (value == null) return fallback;
  return String(value);
}

function positiveRev(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function decimalOrNull(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function jsonOrNull(value) {
  if (value == null) return null;
  return JSON.stringify(value);
}

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest();
}

function shortHash(value, prefix = 'imp') {
  return `${prefix}_${crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 24)}`;
}

function redactedSample(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    if (value.length > 80) return `${value.slice(0, 80)}...`;
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return '[object]';
}

function createEmptyReport(options = {}) {
  return {
    run: {
      startedAt: utcNow(),
      finishedAt: null,
      appVersion: null,
      gitCommit: null,
      sourceJsonPath: options.sourceJsonPath || null,
      sourceFilesRoot: options.sourceFilesRoot || null,
      targetDbName: options.targetDbName || null,
      migrationVersions: [],
      mode: options.execute ? 'sql-import' : 'source-validation',
      status: 'PASS'
    },
    source: {
      topLevelCounts: {},
      fieldPaths: {},
      duplicateJsonKeys: [],
      unknownFields: []
    },
    validation: {
      fatal: [],
      warnings: [],
      byDomain: {}
    },
    import: {
      insertedRowsByTable: {},
      convertedFields: [],
      skippedFields: [],
      compatibilityArchives: []
    },
    reconciliation: {
      countsByDomain: {},
      sqlCountsByTable: {},
      sampleEquality: [],
      brokenReferences: [],
      projectionChecks: [],
      manualDecisionsRequired: []
    },
    files: {
      metadataRows: 0,
      physicalFiles: 0,
      missingFiles: [],
      orphanFiles: [],
      sizeMismatches: [],
      checksumPolicy: options.checksum ? 'generated' : 'unavailable',
      checksumRows: 0
    }
  };
}

function addDomainIssue(report, domain, severity, message, details = {}) {
  if (!report.validation.byDomain[domain]) {
    report.validation.byDomain[domain] = { fatal: [], warnings: [] };
  }
  const entry = { message, ...details };
  if (severity === 'fatal') {
    report.validation.fatal.push({ domain, ...entry });
    report.validation.byDomain[domain].fatal.push(entry);
  } else {
    report.validation.warnings.push({ domain, ...entry });
    report.validation.byDomain[domain].warnings.push(entry);
  }
}

function addBrokenRef(report, ref) {
  report.reconciliation.brokenReferences.push(ref);
  addDomainIssue(report, ref.domain || 'references', ref.fatal ? 'fatal' : 'warning', ref.message || 'Broken reference.', ref);
}

function inc(map, key, amount = 1) {
  map[key] = (map[key] || 0) + amount;
}

function recordInserted(report, table, count = 1) {
  inc(report.import.insertedRowsByTable, table, count);
}

function parseArgs(argv) {
  const options = {
    sourceJsonPath: DEFAULT_JSON_PATH,
    sourceFilesRoot: DEFAULT_FILES_ROOT,
    reportDir: DEFAULT_REPORT_DIR,
    execute: false,
    resetImport: false,
    checksum: false,
    keepDb: true,
    strictValidation: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value.`);
      return argv[index];
    };
    if (arg === '--json') options.sourceJsonPath = next();
    else if (arg === '--files-root') options.sourceFilesRoot = next();
    else if (arg === '--report-dir') options.reportDir = next();
    else if (arg === '--execute') options.execute = true;
    else if (arg === '--reset-import') options.resetImport = true;
    else if (arg === '--checksum') options.checksum = true;
    else if (arg === '--strict-validation') options.strictValidation = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  options.sourceJsonPath = path.resolve(options.sourceJsonPath);
  options.sourceFilesRoot = path.resolve(options.sourceFilesRoot);
  options.reportDir = path.resolve(options.reportDir);
  return options;
}

function printHelp() {
  console.info(`Usage: node scripts/mysql/import-json-dry-run.js [options]

Options:
  --json <path>          JSON database snapshot. Default: data/database.json
  --files-root <path>    Copied storage/cards root. Default: storage/cards
  --report-dir <path>    Output directory. Default: artifacts/mysql-import
  --execute              Apply Stage 3 migrations and import into test MySQL.
  --reset-import         Clear known import tables first. Requires --execute and test DB signal.
  --checksum             Generate SHA-256 for matched physical files.
  --strict-validation    Exit non-zero on validation warnings.
`);
}

async function readAppVersion() {
  try {
    const raw = await fs.readFile(path.join(REPO_ROOT, 'app-version.json'), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed.version || parsed.display) return parsed.version || parsed.display;
    if (parsed.stage && Number.isInteger(parsed.major) && Number.isInteger(parsed.minor) && Number.isInteger(parsed.patch)) {
      return `${parsed.stage} ${parsed.major}.${String(parsed.minor).padStart(2, '0')}.${String(parsed.patch).padStart(2, '0')}`;
    }
    return null;
  } catch (_error) {
    return null;
  }
}

async function readGitCommit() {
  try {
    const gitHead = await fs.readFile(path.join(REPO_ROOT, '.git/HEAD'), 'utf8');
    const head = gitHead.trim();
    if (head.startsWith('ref: ')) {
      const refPath = path.join(REPO_ROOT, '.git', head.slice(5));
      return (await fs.readFile(refPath, 'utf8')).trim();
    }
    return head;
  } catch (_error) {
    return null;
  }
}

function findDuplicateJsonKeys(text) {
  const duplicates = [];
  const stack = [];
  let index = 0;

  function skipWhitespace() {
    while (/\s/.test(text[index] || '')) index += 1;
  }

  function parseString() {
    if (text[index] !== '"') return null;
    index += 1;
    let output = '';
    while (index < text.length) {
      const char = text[index];
      if (char === '"') {
        index += 1;
        return output;
      }
      if (char === '\\') {
        output += char;
        index += 1;
        if (index < text.length) output += text[index];
        index += 1;
        continue;
      }
      output += char;
      index += 1;
    }
    return null;
  }

  function skipPrimitive() {
    while (index < text.length && !/[\s,\]}]/.test(text[index])) index += 1;
  }

  function parseValue(currentPath) {
    skipWhitespace();
    const char = text[index];
    if (char === '{') {
      index += 1;
      const seen = new Set();
      stack.push(seen);
      skipWhitespace();
      if (text[index] === '}') {
        index += 1;
        stack.pop();
        return;
      }
      while (index < text.length) {
        skipWhitespace();
        const key = parseString();
        if (key == null) return;
        const keyPath = `${currentPath}.${key}`;
        if (seen.has(key)) duplicates.push({ path: keyPath, key });
        seen.add(key);
        skipWhitespace();
        if (text[index] !== ':') return;
        index += 1;
        parseValue(keyPath);
        skipWhitespace();
        if (text[index] === ',') {
          index += 1;
          continue;
        }
        if (text[index] === '}') {
          index += 1;
          stack.pop();
          return;
        }
        return;
      }
      return;
    }
    if (char === '[') {
      index += 1;
      let itemIndex = 0;
      skipWhitespace();
      if (text[index] === ']') {
        index += 1;
        return;
      }
      while (index < text.length) {
        parseValue(`${currentPath}[${itemIndex}]`);
        itemIndex += 1;
        skipWhitespace();
        if (text[index] === ',') {
          index += 1;
          continue;
        }
        if (text[index] === ']') {
          index += 1;
          return;
        }
        return;
      }
      return;
    }
    if (char === '"') {
      parseString();
      return;
    }
    skipPrimitive();
  }

  parseValue('$');
  return duplicates;
}

async function readSnapshot(jsonPath) {
  const buffer = await fs.readFile(jsonPath);
  const text = buffer.toString('utf8');
  return {
    text,
    parsed: JSON.parse(text),
    duplicateJsonKeys: findDuplicateJsonKeys(text)
  };
}

function collectFieldPaths(value, root = '$', output = new Map()) {
  if (Array.isArray(value)) {
    output.set(root, { count: (output.get(root)?.count || 0) + 1, sample: '[array]' });
    for (const item of value.slice(0, 1000)) collectFieldPaths(item, `${root}[]`, output);
    return output;
  }
  if (value && typeof value === 'object') {
    output.set(root, { count: (output.get(root)?.count || 0) + 1, sample: '[object]' });
    for (const [key, nested] of Object.entries(value)) collectFieldPaths(nested, `${root}.${key}`, output);
    return output;
  }
  const existing = output.get(root);
  output.set(root, {
    count: (existing?.count || 0) + 1,
    sample: existing?.sample ?? redactedSample(value)
  });
  return output;
}

function recordUnknownFields(db, report) {
  for (const key of Object.keys(db || {})) {
    if (!EXPECTED_TOP_LEVEL_FIELDS.has(key)) {
      const entry = {
        path: `$.${key}`,
        count: Array.isArray(db[key]) ? db[key].length : 1,
        sample: redactedSample(db[key]),
        proposedOwner: 'unknown',
        decision: 'block',
        reason: 'Top-level field is not present in the Stage 0/4 import contract.'
      };
      report.source.unknownFields.push(entry);
      report.reconciliation.manualDecisionsRequired.push(entry);
      addDomainIssue(report, 'source', 'fatal', 'Unknown top-level JSON field.', entry);
    }
  }

  for (const [cardIndex, card] of (db.cards || []).entries()) {
    for (const key of Object.keys(card || {})) {
      if (!CARD_FIELDS.has(key)) {
        const entry = {
          path: `$.cards[${cardIndex}].${key}`,
          count: 1,
          sample: redactedSample(card[key]),
          proposedOwner: 'cards',
          decision: key.startsWith('__') ? 'skip-transient' : 'manual-decision',
          reason: key.startsWith('__') ? 'Transient compatibility field.' : 'Nested card field is not mapped yet.'
        };
        report.source.unknownFields.push(entry);
        report.reconciliation.manualDecisionsRequired.push(entry);
      }
    }
    for (const [operationIndex, operation] of (card.operations || []).entries()) {
      for (const key of Object.keys(operation || {})) {
        if (!CARD_OPERATION_FIELDS.has(key)) {
          report.source.unknownFields.push({
            path: `$.cards[${cardIndex}].operations[${operationIndex}].${key}`,
            count: 1,
            sample: redactedSample(operation[key]),
            proposedOwner: 'cards/production',
            decision: 'manual-decision',
            reason: 'Nested operation field is not mapped yet.'
          });
        }
      }
    }
    for (const [attachmentIndex, attachment] of (card.attachments || []).entries()) {
      for (const key of Object.keys(attachment || {})) {
        if (!ATTACHMENT_FIELDS.has(key)) {
          report.source.unknownFields.push({
            path: `$.cards[${cardIndex}].attachments[${attachmentIndex}].${key}`,
            count: 1,
            sample: redactedSample(attachment[key]),
            proposedOwner: 'card-files',
            decision: 'manual-decision',
            reason: 'Nested attachment field is not mapped yet.'
          });
        }
      }
    }
  }

  const transientFields = report.source.unknownFields.filter((field) => field.decision === 'skip-transient');
  for (const field of transientFields) {
    report.import.skippedFields.push({
      ...field,
      target: null
    });
  }
}

function buildSourceInventory(db, duplicateJsonKeys, report) {
  for (const [key, value] of Object.entries(db || {})) {
    if (Array.isArray(value)) report.source.topLevelCounts[key] = value.length;
    else if (value && typeof value === 'object') report.source.topLevelCounts[key] = Object.keys(value).length;
    else report.source.topLevelCounts[key] = value == null ? 0 : 1;
  }
  const fieldPaths = collectFieldPaths(db);
  for (const [fieldPath, info] of fieldPaths.entries()) {
    report.source.fieldPaths[fieldPath] = info;
  }
  report.source.duplicateJsonKeys = duplicateJsonKeys;
  for (const duplicate of duplicateJsonKeys) {
    addDomainIssue(report, 'source', 'fatal', 'Duplicate JSON object key detected before import.', duplicate);
  }
  recordUnknownFields(db, report);
}

function detectDuplicateIds(db, report) {
  for (const [collection, idField] of COLLECTION_ID_FIELDS.entries()) {
    const rows = db[collection];
    if (!Array.isArray(rows)) continue;
    const seen = new Set();
    for (let index = 0; index < rows.length; index += 1) {
      const id = rows[index]?.[idField];
      if (!id) {
        addDomainIssue(report, collection, 'fatal', `Missing required ${idField}.`, { collection, index });
        continue;
      }
      if (seen.has(id)) {
        addDomainIssue(report, collection, 'fatal', `Duplicate ${collection}.${idField}.`, { collection, id });
      }
      seen.add(id);
    }
  }

  const cardIds = new Set();
  const cardQrIds = new Set();
  const barcodes = new Set();
  const routeNumbers = new Set();
  for (const card of db.cards || []) {
    for (const [field, seen] of [
      ['id', cardIds],
      ['qrId', cardQrIds],
      ['barcode', barcodes],
      ['routeCardNumber', routeNumbers]
    ]) {
      const value = card[field];
      if (!value) continue;
      if (seen.has(value)) {
        addDomainIssue(report, 'cards', 'fatal', `Duplicate card ${field}.`, { field, value, cardId: card.id });
      }
      seen.add(value);
    }
  }
}

function buildIndexes(db) {
  const byId = (collection) => new Map((db[collection] || []).map((row) => [row.id, row]));
  const usersByName = new Map();
  for (const user of db.users || []) {
    if (user.name) usersByName.set(user.name, user);
    if (user.login) usersByName.set(user.login, user);
  }
  const cardsByQr = new Map();
  const routeOps = new Map();
  for (const card of db.cards || []) {
    if (card.qrId) cardsByQr.set(card.qrId, card);
    for (const operation of card.operations || []) {
      if (operation.id) routeOps.set(operation.id, { card, operation });
    }
  }
  return {
    centers: byId('centers'),
    areas: byId('areas'),
    ops: byId('ops'),
    users: byId('users'),
    accessLevels: byId('accessLevels'),
    cards: byId('cards'),
    cardsByQr,
    routeOps,
    usersByName
  };
}

function userIdFromName(indexes, value) {
  if (!value) return null;
  if (indexes.users.has(value)) return value;
  return indexes.usersByName.get(value)?.id || null;
}

function validateStatusesAndRefs(db, indexes, report) {
  for (const required of ['cards', 'ops', 'centers', 'areas', 'users', 'accessLevels']) {
    if (!Array.isArray(db[required])) {
      addDomainIssue(report, 'source', 'fatal', `Required top-level collection is missing or not an array: ${required}.`);
    }
  }

  for (const card of db.cards || []) {
    if (!card.id) continue;
    if (!card.cardType) addDomainIssue(report, 'cards', 'fatal', 'Card has no cardType.', { cardId: card.id });
    else if (!VALID_CARD_TYPES.has(card.cardType)) addDomainIssue(report, 'cards', 'warning', 'Unknown cardType.', { cardId: card.id, cardType: card.cardType });
    if (!card.approvalStage) addDomainIssue(report, 'cards', 'fatal', 'Card has no approvalStage.', { cardId: card.id });
    else if (!VALID_APPROVAL_STAGES.has(card.approvalStage)) addDomainIssue(report, 'cards', 'fatal', 'Invalid approvalStage.', { cardId: card.id, approvalStage: card.approvalStage });
    if (card.status && !VALID_CARD_STATUSES.has(card.status)) {
      addDomainIssue(report, 'cards', 'warning', 'Unknown card status.', { cardId: card.id, status: card.status });
    }
    if (!Number.isSafeInteger(Number(card.rev)) || Number(card.rev) <= 0) {
      addDomainIssue(report, 'cards', 'fatal', 'Invalid card revision.', { cardId: card.id, rev: card.rev });
    }
    for (const operation of card.operations || []) {
      if (!operation.id) addDomainIssue(report, 'cards', 'fatal', 'Card operation has no id.', { cardId: card.id });
      if (operation.opId && !indexes.ops.has(operation.opId)) {
        addBrokenRef(report, {
          domain: 'cards',
          entity: 'card_operation',
          entityId: operation.id,
          reference: 'opId',
          value: operation.opId,
          message: 'Card operation references missing operation. SQL import will preserve snapshot text and set operation_id NULL.'
        });
      }
      if (operation.centerId && !indexes.centers.has(operation.centerId)) {
        addBrokenRef(report, {
          domain: 'cards',
          entity: 'card_operation',
          entityId: operation.id,
          reference: 'centerId',
          value: operation.centerId,
          message: 'Card operation references missing center. SQL import will preserve center snapshot text and set work_center_id NULL.'
        });
      }
      if (operation.status && !VALID_FLOW_STATUSES.has(operation.status)) {
        addDomainIssue(report, 'production-execution', 'warning', 'Unknown operation/flow status.', {
          cardId: card.id,
          routeOperationId: operation.id,
          status: operation.status
        });
      }
    }
    if (card.inputControlFileId) {
      const hasAttachment = (card.attachments || []).some((attachment) => attachment.id === card.inputControlFileId);
      if (!hasAttachment) {
        addBrokenRef(report, {
          domain: 'card-files',
          entity: 'card',
          entityId: card.id,
          reference: 'inputControlFileId',
          value: card.inputControlFileId,
          message: 'Card input-control file points to missing attachment metadata.'
        });
      }
    }
    const flowVersion = Number(card.flow?.version || 0);
    if (card.flow && (!Number.isSafeInteger(flowVersion) || flowVersion <= 0)) {
      addDomainIssue(report, 'production-execution', 'fatal', 'Invalid production flow version.', {
        cardId: card.id,
        flowVersion: card.flow?.version
      });
    }
  }

  for (const operation of db.ops || []) {
    for (const areaId of operation.allowedAreaIds || []) {
      if (!indexes.areas.has(areaId)) {
        addBrokenRef(report, {
          domain: 'directories',
          entity: 'operation',
          entityId: operation.id,
          reference: 'allowedAreaIds',
          value: areaId,
          message: 'Operation references missing allowed area.'
        });
      }
    }
  }

  for (const user of db.users || []) {
    if (user.accessLevelId && !indexes.accessLevels.has(user.accessLevelId)) {
      addBrokenRef(report, {
        domain: 'security',
        entity: 'user',
        entityId: user.id,
        reference: 'accessLevelId',
        value: user.accessLevelId,
        fatal: true,
        message: 'User references missing access level.'
      });
    }
    if (user.departmentId && !indexes.centers.has(user.departmentId)) {
      addBrokenRef(report, {
        domain: 'security',
        entity: 'user',
        entityId: user.id,
        reference: 'departmentId',
        value: user.departmentId,
        message: 'User references missing department/work center.'
      });
    }
  }

  const hasAbyss = (db.users || []).some((user) => user.name === 'Abyss' || user.login === 'Abyss' || user.id === 'Abyss');
  if (!hasAbyss) addDomainIssue(report, 'security', 'warning', 'Abyss user was not found in snapshot.');

  for (const task of db.productionShiftTasks || []) {
    if (task.cardId && !indexes.cards.has(task.cardId)) {
      addBrokenRef(report, { domain: 'production-planning', entity: 'production_shift_task', entityId: task.id, reference: 'cardId', value: task.cardId, fatal: true, message: 'Shift task references missing card.' });
    }
    if (task.routeOpId && !indexes.routeOps.has(task.routeOpId)) {
      addBrokenRef(report, { domain: 'production-planning', entity: 'production_shift_task', entityId: task.id, reference: 'routeOpId', value: task.routeOpId, fatal: true, message: 'Shift task references missing route operation.' });
    }
    if (task.areaId && !indexes.areas.has(task.areaId)) {
      addBrokenRef(report, { domain: 'production-planning', entity: 'production_shift_task', entityId: task.id, reference: 'areaId', value: task.areaId, fatal: true, message: 'Shift task references missing area.' });
    }
  }

  for (const shift of db.productionShifts || []) {
    if (shift.status && !VALID_SHIFT_STATUSES.has(shift.status)) {
      addDomainIssue(report, 'production-shifts', 'warning', 'Unknown shift status.', { shiftId: shift.id, status: shift.status });
    }
  }

  for (const conversation of db.chatConversations || []) {
    for (const userId of conversation.participantIds || []) {
      if (userId === 'system') {
        addDomainIssue(report, 'messaging', 'warning', 'System participant is preserved as compatibility context, not imported as a user.', {
          entity: 'chat_conversation',
          entityId: conversation.id,
          reference: 'participantIds',
          value: userId
        });
        continue;
      }
      if (!indexes.users.has(userId)) {
        addBrokenRef(report, { domain: 'messaging', entity: 'chat_conversation', entityId: conversation.id, reference: 'participantIds', value: userId, fatal: true, message: 'Conversation references missing participant user.' });
      }
    }
  }
  for (const message of db.chatMessages || []) {
    if (!message.conversationId || !(db.chatConversations || []).some((conversation) => conversation.id === message.conversationId)) {
      addBrokenRef(report, { domain: 'messaging', entity: 'chat_message', entityId: message.id, reference: 'conversationId', value: message.conversationId, fatal: true, message: 'Chat message references missing conversation.' });
    }
    if (message.senderId && message.senderId !== 'system' && !indexes.users.has(message.senderId)) {
      addBrokenRef(report, { domain: 'messaging', entity: 'chat_message', entityId: message.id, reference: 'senderId', value: message.senderId, message: 'Chat message references missing sender user; sender snapshot will be preserved as system/unknown.' });
    }
  }
}

function normalizeAttachment(card, attachment) {
  const relPath = nullableText(attachment.relPath || attachment.storedName || attachment.name || attachment.originalName);
  const normalizedRelPath = relPath ? relPath.replace(/\\/g, '/') : null;
  return {
    id: attachment.id || shortHash(`${card.id}:${normalizedRelPath}`, 'att'),
    cardId: card.id,
    storageKey: card.qrId || card.barcode || card.id,
    relPath: normalizedRelPath,
    category: nullableText(attachment.category || attachment.type || attachment.scope),
    originalName: requiredText(attachment.originalName || attachment.name || attachment.storedName || normalizedRelPath, 'unnamed'),
    mimeType: nullableText(attachment.mime),
    sizeBytes: attachment.size == null ? null : Number(attachment.size),
    createdAt: toMysqlDateTime(attachment.createdAt || card.createdAt)
  };
}

async function walkFiles(root) {
  const files = [];
  async function walk(current) {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile()) files.push(fullPath);
    }
  }
  await walk(root);
  return files;
}

function safeRelativePath(relPath) {
  if (!relPath) return false;
  const normalized = relPath.replace(/\\/g, '/');
  return !path.isAbsolute(normalized) && !normalized.split('/').includes('..');
}

async function reconcileFiles(db, filesRoot, report, options = {}) {
  const physicalFiles = await walkFiles(filesRoot);
  const physicalByRel = new Map();
  for (const filePath of physicalFiles) {
    const relativePath = path.relative(filesRoot, filePath).replace(/\\/g, '/');
    const stat = await fs.stat(filePath);
    physicalByRel.set(relativePath, { filePath, relativePath, size: stat.size });
  }

  const metadata = [];
  const seenAttachmentIds = new Set();
  const seenCardPaths = new Set();
  for (const card of db.cards || []) {
    for (const attachment of card.attachments || []) {
      const row = normalizeAttachment(card, attachment);
      metadata.push(row);
      if (seenAttachmentIds.has(row.id)) {
        addDomainIssue(report, 'card-files', 'fatal', 'Duplicate attachment id.', { attachmentId: row.id, cardId: card.id });
      }
      seenAttachmentIds.add(row.id);
      const key = `${row.cardId}:${row.relPath}`;
      if (seenCardPaths.has(key)) {
        addDomainIssue(report, 'card-files', 'fatal', 'Duplicate card attachment relPath.', { cardId: row.cardId, relPath: row.relPath });
      }
      seenCardPaths.add(key);
      if (!safeRelativePath(row.relPath)) {
        addDomainIssue(report, 'card-files', 'fatal', 'Attachment relPath is missing or escapes storage root.', { cardId: row.cardId, attachmentId: row.id, relPath: row.relPath });
        continue;
      }
      const physicalRel = `${row.storageKey}/${row.relPath}`;
      const physical = physicalByRel.get(physicalRel);
      if (!physical) {
        report.files.missingFiles.push({ cardId: row.cardId, attachmentId: row.id, storageKey: row.storageKey, relPath: row.relPath });
        continue;
      }
      if (row.sizeBytes != null && Number(row.sizeBytes) !== Number(physical.size)) {
        report.files.sizeMismatches.push({ cardId: row.cardId, attachmentId: row.id, expected: row.sizeBytes, actual: physical.size, relPath: physicalRel });
      }
      if (options.checksum) {
        const fileBuffer = await fs.readFile(physical.filePath);
        row.checksumSha256 = crypto.createHash('sha256').update(fileBuffer).digest();
        report.files.checksumRows += 1;
      }
    }
  }

  const metadataPhysicalPaths = new Set(metadata.filter((row) => safeRelativePath(row.relPath)).map((row) => `${row.storageKey}/${row.relPath}`));
  for (const physical of physicalByRel.values()) {
    if (!metadataPhysicalPaths.has(physical.relativePath)) {
      report.files.orphanFiles.push({ relPath: physical.relativePath, size: physical.size });
    }
  }

  report.files.metadataRows = metadata.length;
  report.files.physicalFiles = physicalFiles.length;
  return metadata;
}

function buildValidationReport(db, duplicateJsonKeys, report) {
  buildSourceInventory(db, duplicateJsonKeys, report);
  detectDuplicateIds(db, report);
  const indexes = buildIndexes(db);
  validateStatusesAndRefs(db, indexes, report);
  return indexes;
}

function assertSafeTestTarget(config, env, options) {
  const localHost = config.host === '127.0.0.1' || config.host === 'localhost';
  const testSignal = isSqlLocalTestSignal(env);
  const dbName = String(config.database || '');
  const nameLooksSafe = /(test|local|dev|dry|tmp|fixture|stage4)/i.test(dbName);
  const explicitlyAllowedDefault = dbName === 'tspcc_bd' && localHost && testSignal && env.TSPCC_ALLOW_TSPCC_BD_IMPORT === '1';
  if (!localHost || !testSignal || (!nameLooksSafe && !explicitlyAllowedDefault)) {
    throw new Error(
      `Refusing Stage 4 import into database "${dbName}" at "${config.host}". ` +
      'Use a local/test DB name containing test/local/dev/dry/tmp/fixture/stage4 with TSPCC_SQL_TEST=1, ' +
      'or set TSPCC_ALLOW_TSPCC_BD_IMPORT=1 only for a local disposable tspcc_bd test schema.'
    );
  }
  if (options.resetImport && !options.execute) {
    throw new Error('--reset-import requires --execute.');
  }
}

async function resetImportTables(pool, report) {
  await executeQuery(pool, { sql: 'SET FOREIGN_KEY_CHECKS = 0', values: [], label: 'import-reset-fk-off', domain: 'import' });
  try {
    for (const table of IMPORT_TABLES_REVERSE) {
      await executeQuery(pool, { sql: `DELETE FROM ${table}`, values: [], label: `import-reset:${table}`, domain: 'import' });
    }
  } finally {
    await executeQuery(pool, { sql: 'SET FOREIGN_KEY_CHECKS = 1', values: [], label: 'import-reset-fk-on', domain: 'import' });
  }
  report.import.convertedFields.push({
    path: '$',
    decision: 'reset-import',
    reason: 'Known Stage 3 import tables were cleared in an allowlisted local/test DB before dry-run import.'
  });
}

async function insertRow(target, report, table, sql, values) {
  await executeQuery(target, { sql, values, label: `import:${table}`, domain: 'import' });
  recordInserted(report, table);
}

function userVarbinary(value) {
  if (!value) return null;
  return Buffer.from(String(value), 'utf8');
}

async function importDirectoriesAndSecurity(target, db, indexes, report) {
  for (const center of db.centers || []) {
    await insertRow(target, report, 'work_centers', `
      INSERT INTO work_centers (id, rev, name, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
    `, [center.id, positiveRev(center.rev), requiredText(center.name, center.id), nullableText(center.desc)]);
  }

  for (const area of db.areas || []) {
    await insertRow(target, report, 'production_areas', `
      INSERT INTO production_areas (id, rev, name, area_type, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
    `, [area.id, positiveRev(area.rev), requiredText(area.name, area.id), nullableText(area.type), nullableText(area.desc)]);
  }

  for (const operation of db.ops || []) {
    await insertRow(target, report, 'operations', `
      INSERT INTO operations (id, rev, code, name, operation_type, rec_time_minutes, default_work_center_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
    `, [
      operation.id,
      positiveRev(operation.rev),
      nullableText(operation.code),
      requiredText(operation.name, operation.id),
      nullableText(operation.operationType),
      decimalOrNull(operation.recTime),
      indexes.centers.has(operation.centerId) ? operation.centerId : null
    ]);
    for (const areaId of operation.allowedAreaIds || []) {
      if (!indexes.areas.has(areaId)) continue;
      await insertRow(target, report, 'operation_allowed_areas', `
        INSERT INTO operation_allowed_areas (operation_id, area_id)
        VALUES (?, ?)
      `, [operation.id, areaId]);
    }
  }

  for (const shiftTime of db.productionShiftTimes || []) {
    const id = shiftTime.id || `shift_${shiftTime.shift}`;
    await insertRow(target, report, 'production_shift_times', `
      INSERT INTO production_shift_times (id, rev, shift_code, time_from, time_to, lunch_from, lunch_to, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
    `, [
      id,
      positiveRev(shiftTime.rev),
      requiredText(shiftTime.shift, id),
      toTime(shiftTime.timeFrom) || '00:00:00',
      toTime(shiftTime.timeTo) || '00:00:00',
      toTime(shiftTime.lunchFrom),
      toTime(shiftTime.lunchTo)
    ]);
  }

  for (const accessLevel of db.accessLevels || []) {
    await insertRow(target, report, 'access_levels', `
      INSERT INTO access_levels (
        id, rev, name, description, landing_tab, inactivity_timeout_minutes,
        special_roles_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
    `, [
      accessLevel.id,
      positiveRev(accessLevel.rev),
      requiredText(accessLevel.name, accessLevel.id),
      nullableText(accessLevel.description),
      nullableText(accessLevel.landingTab),
      Number.isSafeInteger(Number(accessLevel.inactivityTimeoutMinutes)) ? Number(accessLevel.inactivityTimeoutMinutes) : null,
      jsonOrNull(accessLevel.specialRoles || accessLevel.roles || null)
    ]);
    const permissions = accessLevel.permissions || {};
    for (const [permissionKey, value] of Object.entries(permissions)) {
      const canEdit = typeof value === 'object' ? Boolean(value.edit || value.canEdit) : value === 'edit';
      const canView = canEdit || (typeof value === 'object' ? Boolean(value.view || value.canView) : Boolean(value));
      await insertRow(target, report, 'access_level_permissions', `
        INSERT INTO access_level_permissions (access_level_id, permission_key, can_view, can_edit, updated_at)
        VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))
      `, [accessLevel.id, permissionKey, canView, canEdit]);
    }
  }

  for (const user of db.users || []) {
    const accessLevelId = indexes.accessLevels.has(user.accessLevelId) ? user.accessLevelId : (db.accessLevels || [])[0]?.id;
    if (!accessLevelId) continue;
    await insertRow(target, report, 'users', `
      INSERT INTO users (
        id, rev, login, display_name, role, status, department_id, access_level_id,
        password_hash, password_salt, print_settings_json, production_settings_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
    `, [
      user.id,
      positiveRev(user.rev),
      nullableText(user.login || user.name),
      requiredText(user.name || user.login, user.id),
      nullableText(user.role),
      nullableText(user.status) || 'ACTIVE',
      indexes.centers.has(user.departmentId) ? user.departmentId : null,
      accessLevelId,
      userVarbinary(user.passwordHash),
      userVarbinary(user.passwordSalt),
      jsonOrNull(user.printSettings || null),
      jsonOrNull(user.productionSettings || null)
    ]);
  }
}

function cardDescriptiveAttrs(card) {
  return {
    documentDate: card.documentDate || null,
    issuedBySurname: card.issuedBySurname || null,
    programName: card.programName || null,
    labRequestNumber: card.labRequestNumber || null,
    workBasis: card.workBasis || null,
    supplyState: card.supplyState || null,
    supplyStandard: card.supplyStandard || null,
    mainMaterialGrade: card.mainMaterialGrade || null,
    specialNotes: card.specialNotes || null,
    drawing: card.drawing || null,
    material: card.material || null,
    contractNumber: card.contractNumber || null,
    orderNo: card.orderNo || null,
    desc: card.desc || null,
    responsibleProductionChief: card.responsibleProductionChief || null,
    responsibleSKKChief: card.responsibleSKKChief || null,
    responsibleTechLead: card.responsibleTechLead || null,
    plannedCompletionDate: card.plannedCompletionDate || null,
    sampleCount: card.sampleCount || null,
    witnessSampleCount: card.witnessSampleCount || null,
    useItemList: card.useItemList === true,
    partQrs: card.partQrs || null
  };
}

async function importCards(target, db, indexes, attachmentRows, report) {
  for (const card of db.cards || []) {
    await insertRow(target, report, 'cards', `
      INSERT INTO cards (
        id, rev, qr_id, barcode, route_card_number, card_type, approval_stage, status,
        production_status, archived, title, item_name, item_designation, document_number,
        quantity, batch_size, main_materials_text, descriptive_attrs_json, rejection_reason,
        rejection_read_by_user_id, rejection_read_at, input_control_required, input_control_done,
        provision_required, provision_done, created_by_user_id, created_at, updated_at, archived_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      card.id,
      positiveRev(card.rev),
      nullableText(card.qrId),
      nullableText(card.barcode),
      nullableText(card.routeCardNumber),
      requiredText(card.cardType, 'MKI'),
      requiredText(card.approvalStage, 'DRAFT'),
      nullableText(card.status) || 'NOT_STARTED',
      nullableText(card.productionStatus),
      Boolean(card.archived),
      nullableText(card.name),
      nullableText(card.itemName),
      nullableText(card.itemDesignation),
      nullableText(card.documentDesignation),
      decimalOrNull(card.quantity),
      decimalOrNull(card.batchSize),
      nullableText(card.mainMaterials),
      jsonOrNull(cardDescriptiveAttrs(card)),
      nullableText(card.rejectionReason),
      userIdFromName(indexes, card.rejectionReadByUserName),
      toMysqlDateTime(card.rejectionReadAt),
      card.approvalStage === 'WAITING_INPUT_CONTROL' || Boolean(card.inputControlDoneAt),
      Boolean(card.inputControlDoneAt),
      card.approvalStage === 'WAITING_PROVISION' || Boolean(card.provisionDoneAt),
      Boolean(card.provisionDoneAt),
      userIdFromName(indexes, card.createdBy || card.issuedBySurname),
      toMysqlDateTime(card.createdAt) || toMysqlDateTime(Date.now()),
      toMysqlDateTime(card.updatedAt) || toMysqlDateTime(card.createdAt) || toMysqlDateTime(Date.now()),
      card.archived ? (toMysqlDateTime(card.archivedAt) || toMysqlDateTime(card.updatedAt) || toMysqlDateTime(Date.now())) : null
    ]);

    for (const [index, serial] of (card.itemSerials || []).entries()) {
      await insertRow(target, report, 'card_serials', `
        INSERT INTO card_serials (card_id, serial_no, quantity)
        VALUES (?, ?, ?)
      `, [card.id, String(serial), 1]);
      if (index === 0 && card.sampleSerials?.length) {
        report.import.convertedFields.push({
          path: `$.cards[${card.id}].sampleSerials`,
          decision: 'report-only',
          reason: 'Sample serials are preserved in descriptive card attributes until sample-specific schema is cut over.'
        });
      }
    }

    if (card.quantity != null) {
      await insertRow(target, report, 'card_quantities', `
        INSERT INTO card_quantities (card_id, card_operation_id, quantity_type, amount, unit, updated_at)
        VALUES (?, NULL, 'card_quantity', ?, NULL, UTC_TIMESTAMP(3))
      `, [card.id, decimalOrNull(card.quantity) || 0]);
    }

    for (const [index, operation] of (card.operations || []).entries()) {
      await insertRow(target, report, 'card_operations', `
        INSERT INTO card_operations (
          id, card_id, operation_id, work_center_id, sequence_no, operation_name_snapshot,
          work_center_name_snapshot, planned_quantity, status, comments, descriptive_attrs_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
      `, [
        operation.id,
        card.id,
        indexes.ops.has(operation.opId) ? operation.opId : null,
        indexes.centers.has(operation.centerId) ? operation.centerId : null,
        Number.isSafeInteger(Number(operation.order)) ? Number(operation.order) : index + 1,
        nullableText(operation.opName),
        nullableText(operation.centerName),
        decimalOrNull(operation.quantity),
        nullableText(operation.status) || 'NOT_STARTED',
        nullableText(operation.comment),
        jsonOrNull({
          opCode: operation.opCode || null,
          operationType: operation.operationType || null,
          executor: operation.executor || null,
          plannedMinutes: operation.plannedMinutes ?? null,
          additionalExecutors: operation.additionalExecutors || [],
          isSamples: operation.isSamples === true,
          sampleType: operation.sampleType || null,
          flowStats: operation.flowStats || null
        })
      ]);
      if (operation.quantity != null) {
        await insertRow(target, report, 'card_quantities', `
          INSERT INTO card_quantities (card_id, card_operation_id, quantity_type, amount, unit, updated_at)
          VALUES (?, ?, 'operation_planned', ?, NULL, UTC_TIMESTAMP(3))
        `, [card.id, operation.id, decimalOrNull(operation.quantity) || 0]);
      }
    }

    for (const [index, event] of (card.approvalThread || []).entries()) {
      await insertRow(target, report, 'card_approval_events', `
        INSERT INTO card_approval_events (
          id, card_id, role_context, action_type, actor_user_id, actor_name_snapshot,
          comment, event_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        event.id || shortHash(`${card.id}:approval:${index}:${event.ts}:${event.actionType}`, 'cae'),
        card.id,
        requiredText(event.roleContext, ''),
        requiredText(event.actionType, 'UNKNOWN'),
        userIdFromName(indexes, event.userName),
        nullableText(event.userName),
        nullableText(event.comment),
        toMysqlDateTime(event.ts) || toMysqlDateTime(card.createdAt) || toMysqlDateTime(Date.now())
      ]);
    }

    for (const [index, log] of (card.logs || []).entries()) {
      const id = log.id || shortHash(`${card.id}:log:${index}:${log.ts}:${log.action}`, 'clog');
      await insertRow(target, report, 'card_logs', `
        INSERT INTO card_logs (id, card_id, event_type, actor_user_id, message, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
        id,
        card.id,
        requiredText(log.action, 'log'),
        userIdFromName(indexes, log.createdBy || log.userName),
        JSON.stringify({
          action: log.action || null,
          object: log.object || null,
          targetId: log.targetId || null,
          field: log.field || null,
          userName: log.userName || '',
          oldValue: log.oldValue ?? '',
          newValue: log.newValue ?? ''
        }),
        toMysqlDateTime(log.ts) || toMysqlDateTime(card.createdAt) || toMysqlDateTime(Date.now())
      ]);
      if (log.field === 'approvalStage') {
        await insertRow(target, report, 'card_lifecycle_events', `
          INSERT INTO card_lifecycle_events (id, card_id, event_type, from_stage, to_stage, actor_user_id, reason, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          shortHash(`${id}:lifecycle`, 'cle'),
          card.id,
          requiredText(log.action, 'approval'),
          nullableText(log.oldValue),
          nullableText(log.newValue),
          userIdFromName(indexes, log.createdBy || log.userName),
          nullableText(card.rejectionReason),
          toMysqlDateTime(log.ts) || toMysqlDateTime(card.createdAt) || toMysqlDateTime(Date.now())
        ]);
      }
    }

    if (card.inputControlDoneAt) {
      await insertRow(target, report, 'card_input_control_records', `
        INSERT INTO card_input_control_records (id, card_id, actor_user_id, result_status, attachment_id, comment, created_at)
        VALUES (?, ?, ?, 'DONE', NULL, ?, ?)
      `, [
        shortHash(`${card.id}:input:${card.inputControlDoneAt}`, 'icr'),
        card.id,
        userIdFromName(indexes, card.inputControlDoneBy),
        nullableText(card.inputControlComment),
        toMysqlDateTime(card.inputControlDoneAt)
      ]);
    }
    if (card.provisionDoneAt) {
      await insertRow(target, report, 'card_provision_records', `
        INSERT INTO card_provision_records (id, card_id, actor_user_id, result_status, comment, created_at)
        VALUES (?, ?, ?, 'DONE', NULL, ?)
      `, [
        shortHash(`${card.id}:provision:${card.provisionDoneAt}`, 'cpr'),
        card.id,
        userIdFromName(indexes, card.provisionDoneBy),
        toMysqlDateTime(card.provisionDoneAt)
      ]);
    }

    if (card.initialSnapshot) {
      await insertRow(target, report, 'card_initial_snapshots_archive', `
        INSERT INTO card_initial_snapshots_archive (card_id, snapshot_json)
        VALUES (?, ?)
      `, [card.id, JSON.stringify(card.initialSnapshot)]);
      report.import.compatibilityArchives.push({
        source: `cards.${card.id}.initialSnapshot`,
        target: 'card_initial_snapshots_archive',
        mode: 'read-only-archive'
      });
    }
  }

  for (const attachment of attachmentRows) {
    await insertRow(target, report, 'card_attachments', `
      INSERT INTO card_attachments (
        id, card_id, storage_key, rel_path, category, original_name, mime_type,
        size_bytes, checksum_sha256, created_by_user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
    `, [
      attachment.id,
      attachment.cardId,
      attachment.storageKey,
      attachment.relPath,
      attachment.category,
      attachment.originalName,
      attachment.mimeType,
      Number.isFinite(attachment.sizeBytes) ? attachment.sizeBytes : null,
      attachment.checksumSha256 || null,
      attachment.createdAt || toMysqlDateTime(Date.now())
    ]);
  }

  for (const card of db.cards || []) {
    if (!card.inputControlFileId || !attachmentRows.some((row) => row.id === card.inputControlFileId)) continue;
    await executeQuery(target, {
      sql: 'UPDATE cards SET input_control_file_attachment_id = ? WHERE id = ?',
      values: [card.inputControlFileId, card.id],
      label: 'import:cards:input-control-file',
      domain: 'import'
    });
  }
}

async function importProductionPlanning(target, db, indexes, report) {
  await insertRow(target, report, 'production_planning_revisions', `
    INSERT INTO production_planning_revisions (slice_key, rev, description, updated_at)
    VALUES ('production.planning', 1, 'Imported dry-run planning revision; not derived from meta.revision.', UTC_TIMESTAMP(3))
  `, []);
  report.import.convertedFields.push({
    path: '$.meta.revision',
    decision: 'report-only',
    target: 'production_planning_revisions.rev',
    reason: 'Global meta.revision is not used as a domain concurrency model.'
  });

  for (const [index, row] of (db.productionSchedule || []).entries()) {
    if (!indexes.users.has(row.employeeId) || !indexes.areas.has(row.areaId)) continue;
    await insertRow(target, report, 'production_schedule', `
      INSERT INTO production_schedule (
        id, schedule_date, shift_code, employee_user_id, area_id, time_from, time_to,
        assignment_type, source, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'json-import-dry-run', UTC_TIMESTAMP(3))
    `, [
      row.id || shortHash(`schedule:${row.date}:${row.shift}:${row.employeeId}:${row.areaId}:${index}`, 'ps'),
      toDateOnly(row.date),
      requiredText(row.shift, '1'),
      row.employeeId,
      row.areaId,
      toTime(row.timeFrom),
      toTime(row.timeTo),
      nullableText(row.assignmentStatus)
    ]);
  }

  for (const task of db.productionShiftTasks || []) {
    if (!indexes.cards.has(task.cardId) || !indexes.routeOps.has(task.routeOpId) || !indexes.areas.has(task.areaId)) continue;
    await insertRow(target, report, 'production_shift_tasks', `
      INSERT INTO production_shift_tasks (
        id, rev, card_id, route_operation_id, operation_id, area_id, shift_date,
        shift_code, planned_quantity, effective_deadline_snapshot, status,
        subcontract_status, subcontract_partner_text, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))
    `, [
      task.id,
      positiveRev(task.rev),
      task.cardId,
      task.routeOpId,
      indexes.ops.has(task.opId) ? task.opId : null,
      task.areaId,
      toDateOnly(task.date || task.sourceShiftDate),
      requiredText(task.shift, '1'),
      decimalOrNull(task.quantity || task.plannedQuantity),
      toMysqlDateTime(task.effectiveDeadlineSnapshot),
      nullableText(task.status) || 'PLANNED',
      nullableText(task.subcontractStatus),
      nullableText(task.subcontractPartnerText),
      toMysqlDateTime(task.createdAt) || toMysqlDateTime(Date.now())
    ]);
  }

  for (const shift of db.productionShifts || []) {
    await insertRow(target, report, 'production_shifts', `
      INSERT INTO production_shifts (
        id, rev, shift_date, shift_code, status, opened_by_user_id, opened_at,
        closed_by_user_id, closed_at, locked_by_user_id, locked_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
    `, [
      shift.id,
      positiveRev(shift.rev),
      toDateOnly(shift.date),
      requiredText(shift.shift, '1'),
      requiredText(shift.status, 'OPEN'),
      userIdFromName(indexes, shift.openedBy),
      toMysqlDateTime(shift.openedAt),
      userIdFromName(indexes, shift.closedBy),
      toMysqlDateTime(shift.closedAt),
      userIdFromName(indexes, shift.lockedBy),
      toMysqlDateTime(shift.lockedAt)
    ]);
    for (const [index, log] of (shift.logs || []).entries()) {
      await insertRow(target, report, 'production_shift_logs', `
        INSERT INTO production_shift_logs (id, shift_id, actor_user_id, action_type, message, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
        log.id || shortHash(`${shift.id}:shiftlog:${index}:${log.at}:${log.action}`, 'psl'),
        shift.id,
        userIdFromName(indexes, log.userName || log.createdBy),
        requiredText(log.action || log.actionType, 'log'),
        nullableText(log.message || log.comment || log.text),
        toMysqlDateTime(log.at || log.ts || log.createdAt) || toMysqlDateTime(Date.now())
      ]);
    }
    if (shift.initialSnapshot) {
      await insertRow(target, report, 'production_shift_initial_snapshot_archive', `
        INSERT INTO production_shift_initial_snapshot_archive (shift_id, snapshot_json)
        VALUES (?, ?)
      `, [shift.id, JSON.stringify(shift.initialSnapshot)]);
      report.import.compatibilityArchives.push({ source: `productionShifts.${shift.id}.initialSnapshot`, target: 'production_shift_initial_snapshot_archive', mode: 'read-only-archive' });
    }
    if (shift.closePageDraft) {
      await insertRow(target, report, 'production_shift_close_draft_archive', `
        INSERT INTO production_shift_close_draft_archive (shift_id, rev, draft_json, updated_by_user_id, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `, [shift.id, positiveRev(shift.closePageDraft.rev), JSON.stringify(shift.closePageDraft), userIdFromName(indexes, shift.closePageDraft.updatedBy), toMysqlDateTime(shift.closePageDraft.updatedAt) || toMysqlDateTime(Date.now())]);
      report.import.compatibilityArchives.push({ source: `productionShifts.${shift.id}.closePageDraft`, target: 'production_shift_close_draft_archive', mode: 'read-only-archive' });
    }
    if (shift.closePageSnapshot) {
      const snapshotId = shift.closePageSnapshot.id || shortHash(`${shift.id}:closePageSnapshot`, 'psc');
      await insertRow(target, report, 'production_shift_close_snapshots', `
        INSERT INTO production_shift_close_snapshots (id, shift_id, snapshot_json, created_by_user_id, created_at)
        VALUES (?, ?, ?, ?, ?)
      `, [snapshotId, shift.id, JSON.stringify(shift.closePageSnapshot), userIdFromName(indexes, shift.closePageSnapshot.createdBy), toMysqlDateTime(shift.closePageSnapshot.createdAt) || toMysqlDateTime(Date.now())]);
      report.import.compatibilityArchives.push({ source: `productionShifts.${shift.id}.closePageSnapshot`, target: 'production_shift_close_snapshots', mode: 'read-only-archive' });
      for (const [index, history] of (shift.closePageSnapshotHistory || []).entries()) {
        await insertRow(target, report, 'production_shift_close_snapshot_history', `
          INSERT INTO production_shift_close_snapshot_history (id, shift_id, snapshot_id, history_event, snapshot_json, created_by_user_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
          history.id || shortHash(`${shift.id}:closeHistory:${index}`, 'psh'),
          shift.id,
          snapshotId,
          requiredText(history.event || history.type, 'snapshot'),
          JSON.stringify(history),
          userIdFromName(indexes, history.createdBy),
          toMysqlDateTime(history.createdAt || history.at) || toMysqlDateTime(Date.now())
        ]);
      }
    }
  }
}

async function importProductionExecution(target, db, indexes, report) {
  const flowStateIds = new Map();
  for (const card of db.cards || []) {
    const flowVersion = positiveRev(card.flow?.version || 1);
    for (const operation of card.operations || []) {
      const flowStateId = shortHash(`${card.id}:${operation.id}:flow`, 'pfs');
      flowStateIds.set(`${card.id}:${operation.id}`, flowStateId);
      await insertRow(target, report, 'production_flow_states', `
        INSERT INTO production_flow_states (
          id, card_id, route_operation_id, shift_task_id, flow_version, flow_status,
          current_area_id, started_at, completed_at, updated_at, created_at
        ) VALUES (?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?, ?)
      `, [
        flowStateId,
        card.id,
        operation.id,
        flowVersion,
        nullableText(operation.status) || nullableText(card.productionStatus) || 'NOT_STARTED',
        toMysqlDateTime(operation.startedAt || operation.firstStartedAt),
        toMysqlDateTime(operation.finishedAt),
        toMysqlDateTime(card.updatedAt) || toMysqlDateTime(Date.now()),
        toMysqlDateTime(card.createdAt) || toMysqlDateTime(Date.now())
      ]);
    }

    const flowItems = [...(card.flow?.items || []), ...(card.flow?.samples || [])];
    for (const item of flowItems) {
      const currentOpId = item.current?.opId || (card.operations || [])[0]?.id;
      const flowStateId = flowStateIds.get(`${card.id}:${currentOpId}`);
      if (!flowStateId) continue;
      await insertRow(target, report, 'production_flow_item_states', `
        INSERT INTO production_flow_item_states (id, flow_state_id, serial_no, item_status, quality_status, quantity, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?)
      `, [
        item.id,
        flowStateId,
        nullableText(item.qr || item.displayName),
        nullableText(item.current?.status || item.finalStatus) || 'PENDING',
        nullableText(item.finalStatus === 'GOOD' ? 'OK' : (item.finalStatus === 'DEFECT' ? 'OC' : item.finalStatus)),
        toMysqlDateTime(item.current?.updatedAt) || toMysqlDateTime(Date.now())
      ]);
      for (const [index, history] of (item.history || []).entries()) {
        const historyFlowStateId = flowStateIds.get(`${card.id}:${history.opId}`) || flowStateId;
        await insertRow(target, report, 'production_flow_events', `
          INSERT INTO production_flow_events (
            id, flow_state_id, event_type, from_status, to_status, actor_user_id,
            expected_flow_version, resulting_flow_version, event_payload_json, created_at
          ) VALUES (?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?)
        `, [
          shortHash(`${item.id}:history:${index}:${history.at}:${history.status}`, 'pfe'),
          historyFlowStateId,
          'item-history',
          nullableText(history.status),
          userIdFromName(indexes, history.userId || history.userName || history.createdBy),
          flowVersion,
          JSON.stringify(history),
          toMysqlDateTime(history.at) || toMysqlDateTime(Date.now())
        ]);
      }
    }

    for (const [index, event] of (card.flow?.events || []).entries()) {
      const eventFlowStateId = flowStateIds.get(`${card.id}:${event.opId || event.routeOpId}`) || flowStateIds.get(`${card.id}:${(card.operations || [])[0]?.id}`);
      if (!eventFlowStateId) continue;
      await insertRow(target, report, 'production_flow_events', `
        INSERT INTO production_flow_events (
          id, flow_state_id, event_type, from_status, to_status, actor_user_id,
          expected_flow_version, resulting_flow_version, event_payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        event.id || shortHash(`${card.id}:flowEvent:${index}:${event.at}:${event.type}`, 'pfe'),
        eventFlowStateId,
        requiredText(event.type || event.action, 'flow-event'),
        nullableText(event.fromStatus),
        nullableText(event.toStatus || event.status),
        userIdFromName(indexes, event.userId || event.userName || event.createdBy),
        Number.isSafeInteger(Number(event.expectedFlowVersion)) ? Number(event.expectedFlowVersion) : null,
        positiveRev(event.resultingFlowVersion || flowVersion),
        JSON.stringify(event),
        toMysqlDateTime(event.at || event.createdAt) || toMysqlDateTime(Date.now())
      ]);
    }

    const activeOperation = (card.operations || []).find((operation) => operation.status && operation.status !== 'NOT_STARTED') || (card.operations || [])[0];
    const activeFlowStateId = activeOperation ? flowStateIds.get(`${card.id}:${activeOperation.id}`) : null;
    await insertRow(target, report, 'card_flow_projection', `
      INSERT INTO card_flow_projection (card_id, active_flow_state_id, flow_version, current_status, current_area_id, updated_at)
      VALUES (?, ?, ?, ?, NULL, ?)
    `, [
      card.id,
      activeFlowStateId,
      flowVersion,
      nullableText(card.productionStatus || activeOperation?.status),
      toMysqlDateTime(card.updatedAt) || toMysqlDateTime(Date.now())
    ]);
  }
  report.reconciliation.projectionChecks.push({
    projection: 'card_flow_projection',
    source: 'production_flow_states',
    status: 'generated-from-authoritative-flow-import'
  });
}

async function importMessagingProfile(target, db, indexes, report) {
  for (const conversation of db.chatConversations || []) {
    const directKey = conversation.directKey || (Array.isArray(conversation.participantIds) ? conversation.participantIds.slice().sort().join(':') : null);
    await insertRow(target, report, 'chat_conversations', `
      INSERT INTO chat_conversations (id, conversation_type, direct_key, created_by_user_id, created_at, updated_at)
      VALUES (?, ?, ?, NULL, ?, ?)
    `, [
      conversation.id,
      nullableText(conversation.type) || 'direct',
      nullableText(directKey),
      toMysqlDateTime(conversation.createdAt) || toMysqlDateTime(Date.now()),
      toMysqlDateTime(conversation.updatedAt || conversation.lastMessageAt) || toMysqlDateTime(conversation.createdAt) || toMysqlDateTime(Date.now())
    ]);
    for (const userId of conversation.participantIds || []) {
      if (!indexes.users.has(userId)) continue;
      await insertRow(target, report, 'chat_conversation_participants', `
        INSERT INTO chat_conversation_participants (conversation_id, user_id, joined_at)
        VALUES (?, ?, ?)
      `, [conversation.id, userId, toMysqlDateTime(conversation.createdAt) || toMysqlDateTime(Date.now())]);
    }
  }

  for (const message of db.chatMessages || []) {
    const senderIsUser = message.senderId && indexes.users.has(message.senderId);
    await insertRow(target, report, 'chat_messages', `
      INSERT INTO chat_messages (id, conversation_id, seq, client_msg_id, sender_user_id, sender_kind, body, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      message.id,
      message.conversationId,
      Number.isSafeInteger(Number(message.seq)) ? Number(message.seq) : 0,
      nullableText(message.clientMsgId),
      senderIsUser ? message.senderId : null,
      senderIsUser ? 'user' : (message.senderId === 'system' ? 'system' : 'unknown'),
      requiredText(message.text || message.body, ''),
      toMysqlDateTime(message.createdAt) || toMysqlDateTime(Date.now())
    ]);
  }

  const messagesByConversationSeq = new Map((db.chatMessages || []).map((message) => [`${message.conversationId}:${message.seq}`, message]));
  for (const state of db.chatStates || []) {
    const delivered = messagesByConversationSeq.get(`${state.conversationId}:${state.lastDeliveredSeq}`);
    const read = messagesByConversationSeq.get(`${state.conversationId}:${state.lastReadSeq}`);
    for (const message of [delivered, read]) {
      if (!message || !indexes.users.has(state.userId)) continue;
      await insertRow(target, report, 'chat_message_states', `
        INSERT INTO chat_message_states (message_id, user_id, delivered_at, read_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE delivered_at = VALUES(delivered_at), read_at = VALUES(read_at), updated_at = VALUES(updated_at)
      `, [
        message.id,
        state.userId,
        delivered ? (toMysqlDateTime(state.updatedAt) || toMysqlDateTime(Date.now())) : null,
        read ? (toMysqlDateTime(state.updatedAt) || toMysqlDateTime(Date.now())) : null,
        toMysqlDateTime(state.updatedAt) || toMysqlDateTime(Date.now())
      ]);
    }
  }

  for (const [index, visit] of (db.userVisits || []).entries()) {
    if (!indexes.users.has(visit.userId)) continue;
    await insertRow(target, report, 'user_visits', `
      INSERT INTO user_visits (id, user_id, route_path, visited_at)
      VALUES (?, ?, ?, ?)
    `, [
      visit.id || shortHash(`visit:${visit.userId}:${visit.route || visit.path}:${visit.at || index}`, 'uv'),
      visit.userId,
      requiredText(visit.route || visit.path || visit.routePath, '/'),
      toMysqlDateTime(visit.at || visit.visitedAt) || toMysqlDateTime(Date.now())
    ]);
  }

  for (const [index, subscription] of (db.webPushSubscriptions || []).entries()) {
    const userId = subscription.userId || subscription.ownerUserId;
    if (!indexes.users.has(userId)) continue;
    const endpoint = subscription.endpoint || subscription.subscription?.endpoint || `${userId}:${index}`;
    await insertRow(target, report, 'web_push_subscriptions', `
      INSERT INTO web_push_subscriptions (id, user_id, endpoint_hash, encrypted_payload_json, user_agent_hash, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, NULL, ?, ?)
    `, [
      subscription.id || shortHash(`webpush:${endpoint}`, 'wps'),
      userId,
      sha256Buffer(endpoint),
      JSON.stringify({ redacted: true, sourceFields: Object.keys(subscription) }),
      toMysqlDateTime(subscription.createdAt) || toMysqlDateTime(Date.now()),
      toMysqlDateTime(subscription.lastSeenAt || subscription.updatedAt)
    ]);
  }

  for (const [index, token] of (db.fcmTokens || []).entries()) {
    const userId = token.userId || token.ownerUserId;
    if (!indexes.users.has(userId)) continue;
    const tokenValue = token.token || token.fcmToken || `${userId}:${index}`;
    await insertRow(target, report, 'fcm_tokens', `
      INSERT INTO fcm_tokens (id, user_id, token_hash, token_ciphertext, device_id, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      token.id || shortHash(`fcm:${tokenValue}`, 'fcm'),
      userId,
      sha256Buffer(tokenValue),
      '[redacted-dry-run-token]',
      nullableText(token.deviceId),
      toMysqlDateTime(token.createdAt) || toMysqlDateTime(Date.now()),
      toMysqlDateTime(token.lastSeenAt || token.updatedAt)
    ]);
  }

  for (const action of db.userActions || []) {
    await insertRow(target, report, 'user_actions', `
      INSERT INTO user_actions (id, user_id, actor_user_id, domain, entity_type, entity_id, action_type, message, route_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      action.id,
      indexes.users.has(action.userId) ? action.userId : null,
      indexes.users.has(action.actorUserId) ? action.actorUserId : null,
      nullableText(action.domain) || 'profile',
      nullableText(action.entityType),
      nullableText(action.entityId),
      nullableText(action.actionType) || 'user-action',
      nullableText(action.text || action.message),
      nullableText(action.routePath || action.route),
      toMysqlDateTime(action.at || action.createdAt) || toMysqlDateTime(Date.now())
    ]);
  }

  if ((db.messages || []).length > 0) {
    const decision = {
      path: '$.messages',
      count: db.messages.length,
      proposedOwner: 'messaging',
      decision: 'block',
      reason: 'Legacy messages is non-empty and has no Stage 3 read-only archive table.'
    };
    report.reconciliation.manualDecisionsRequired.push(decision);
    addDomainIssue(report, 'messaging', 'fatal', 'Non-empty legacy messages requires owner/archive decision.', decision);
  } else {
    report.import.skippedFields.push({
      path: '$.messages',
      decision: 'skip-empty-legacy',
      reason: 'Legacy messages field is empty; /api/chat stack remains the only import target.'
    });
  }
}

async function runSqlImport(db, indexes, attachmentRows, report, options) {
  const env = process.env;
  const config = readMysqlMigrationEnv({ env });
  report.run.targetDbName = config.database;
  assertSafeTestTarget(config, env, options);
  const pool = createMysqlPoolFromConfig(config);
  try {
    const migrations = await readMigrationFiles();
    report.run.migrationVersions = migrations.map((migration) => migration.version);
    await runMysqlMigrations({ pool, migrations });
    if (options.resetImport) await resetImportTables(pool, report);
    await withTransaction(async (tx) => {
      await importDirectoriesAndSecurity(tx, db, indexes, report);
      await importCards(tx, db, indexes, attachmentRows, report);
      await importProductionPlanning(tx, db, indexes, report);
      await importProductionExecution(tx, db, indexes, report);
      await importMessagingProfile(tx, db, indexes, report);
    }, { pool, label: 'mysql-stage4-json-import', idempotent: false });
    await reconcileSqlCounts(pool, report);
  } finally {
    await pool.end();
  }
}

async function reconcileSqlCounts(pool, report) {
  for (const table of [...IMPORT_TABLES_REVERSE].reverse()) {
    try {
      const result = await executeQuery(pool, {
        sql: `SELECT COUNT(*) AS count FROM ${table}`,
        values: [],
        label: `reconcile-count:${table}`,
        domain: 'import-reconciliation'
      });
      report.reconciliation.sqlCountsByTable[table] = Number(result.rows[0]?.count || 0);
    } catch (_error) {
      // Some future tables may not exist in older Stage 3 schemas; migration tests cover current required tables.
    }
  }
}

function addAutomatedComparisons(db, report) {
  const countsByDomain = {
    work_centers: (db.centers || []).length,
    operations: (db.ops || []).length,
    production_areas: (db.areas || []).length,
    users: (db.users || []).length,
    access_levels: (db.accessLevels || []).length,
    cards: (db.cards || []).length,
    card_operations: (db.cards || []).reduce((sum, card) => sum + (card.operations || []).length, 0),
    card_attachments: report.files.metadataRows,
    production_schedule: (db.productionSchedule || []).length,
    production_shift_tasks: (db.productionShiftTasks || []).length,
    production_shifts: (db.productionShifts || []).length,
    production_flow_states: (db.cards || []).reduce((sum, card) => sum + (card.operations || []).length, 0),
    card_flow_projection: (db.cards || []).length,
    chat_conversations: (db.chatConversations || []).length,
    chat_messages: (db.chatMessages || []).length,
    user_actions: (db.userActions || []).length
  };
  report.reconciliation.countsByDomain = countsByDomain;

  const sampleCard = (db.cards || [])[0];
  if (sampleCard) {
    report.reconciliation.sampleEquality.push({
      domain: 'cards',
      id: sampleCard.id,
      checks: {
        id: sampleCard.id,
        rev: positiveRev(sampleCard.rev),
        qrId: sampleCard.qrId || null,
        approvalStage: sampleCard.approvalStage,
        operationCount: (sampleCard.operations || []).length,
        attachmentCount: (sampleCard.attachments || []).length
      },
      status: 'source-canonicalized'
    });
  }
  const sampleUser = (db.users || [])[0];
  if (sampleUser) {
    report.reconciliation.sampleEquality.push({
      domain: 'users',
      id: sampleUser.id,
      checks: {
        id: sampleUser.id,
        rev: positiveRev(sampleUser.rev),
        accessLevelId: sampleUser.accessLevelId,
        passwordFieldsRedacted: true
      },
      status: 'source-canonicalized'
    });
  }
  const sampleAction = (db.userActions || [])[0];
  if (sampleAction) {
    report.reconciliation.sampleEquality.push({
      domain: 'user_actions',
      id: sampleAction.id,
      checks: {
        id: sampleAction.id,
        userId: sampleAction.userId || null,
        actionType: sampleAction.actionType || 'user-action'
      },
      status: 'source-canonicalized'
    });
  }
}

function finalizeStatus(report, options) {
  report.run.finishedAt = utcNow();
  if (report.validation.fatal.length > 0) report.run.status = 'FAIL';
  else if (report.validation.warnings.length > 0 || report.reconciliation.manualDecisionsRequired.length > 0 || report.files.missingFiles.length > 0 || report.files.orphanFiles.length > 0 || report.files.sizeMismatches.length > 0) report.run.status = 'WARN';
  else report.run.status = 'PASS';
  if (options.strictValidation && report.run.status === 'WARN') report.run.status = 'FAIL';
}

function renderMarkdownReport(report) {
  const lines = [];
  lines.push('# MySQL Stage 4 JSON Import Dry Run');
  lines.push('');
  lines.push(`- Status: ${report.run.status}`);
  lines.push(`- Mode: ${report.run.mode}`);
  lines.push(`- Started: ${report.run.startedAt}`);
  lines.push(`- Finished: ${report.run.finishedAt}`);
  lines.push(`- Source JSON: ${report.run.sourceJsonPath}`);
  lines.push(`- Files root: ${report.run.sourceFilesRoot}`);
  lines.push(`- Target DB: ${report.run.targetDbName || 'not used'}`);
  lines.push('');
  lines.push('## Domain Counts');
  for (const [key, value] of Object.entries(report.reconciliation.countsByDomain)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push('');
  lines.push('## SQL Counts');
  if (Object.keys(report.reconciliation.sqlCountsByTable).length === 0) {
    lines.push('- SQL import was not executed.');
  } else {
    for (const [key, value] of Object.entries(report.reconciliation.sqlCountsByTable)) {
      lines.push(`- ${key}: ${value}`);
    }
  }
  lines.push('');
  lines.push('## Files');
  lines.push(`- Metadata rows: ${report.files.metadataRows}`);
  lines.push(`- Physical files: ${report.files.physicalFiles}`);
  lines.push(`- Missing files: ${report.files.missingFiles.length}`);
  lines.push(`- Orphan files: ${report.files.orphanFiles.length}`);
  lines.push(`- Size mismatches: ${report.files.sizeMismatches.length}`);
  lines.push(`- Checksum policy: ${report.files.checksumPolicy}`);
  lines.push('');
  lines.push('## Validation');
  lines.push(`- Fatal: ${report.validation.fatal.length}`);
  lines.push(`- Warnings: ${report.validation.warnings.length}`);
  for (const issue of report.validation.fatal.slice(0, 25)) {
    lines.push(`- FATAL [${issue.domain}]: ${issue.message}`);
  }
  for (const issue of report.validation.warnings.slice(0, 25)) {
    lines.push(`- WARN [${issue.domain}]: ${issue.message}`);
  }
  lines.push('');
  lines.push('## Manual Decisions Required');
  if (report.reconciliation.manualDecisionsRequired.length === 0) lines.push('- None.');
  for (const decision of report.reconciliation.manualDecisionsRequired.slice(0, 50)) {
    lines.push(`- ${decision.path || decision.reference}: ${decision.decision} - ${decision.reason || decision.message}`);
  }
  lines.push('');
  lines.push('## Compatibility Archives');
  if (report.import.compatibilityArchives.length === 0) lines.push('- None.');
  for (const archive of report.import.compatibilityArchives.slice(0, 50)) {
    lines.push(`- ${archive.source} -> ${archive.target} (${archive.mode})`);
  }
  return `${lines.join('\n')}\n`;
}

async function writeReports(report, reportDir) {
  await fs.mkdir(reportDir, { recursive: true });
  const jsonPath = path.join(reportDir, 'import-reconciliation.json');
  const mdPath = path.join(reportDir, 'import-reconciliation.md');
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.writeFile(mdPath, renderMarkdownReport(report), 'utf8');
  return { jsonPath, mdPath };
}

async function runImportPipeline(options) {
  const report = createEmptyReport(options);
  report.run.appVersion = await readAppVersion();
  report.run.gitCommit = await readGitCommit();
  const { parsed: db, duplicateJsonKeys } = await readSnapshot(options.sourceJsonPath);
  const indexes = buildValidationReport(db, duplicateJsonKeys, report);
  const attachmentRows = await reconcileFiles(db, options.sourceFilesRoot, report, options);
  addAutomatedComparisons(db, report);

  if (report.validation.fatal.length === 0 && options.execute) {
    await runSqlImport(db, indexes, attachmentRows, report, options);
  } else if (options.execute) {
    report.run.targetDbName = report.run.targetDbName || process.env.TSPCC_DB_NAME || null;
    report.import.skippedFields.push({
      path: '$',
      decision: 'skip-sql-import',
      reason: 'SQL import was not started because pre-import validation has fatal errors.'
    });
  }

  finalizeStatus(report, options);
  const reportPaths = await writeReports(report, options.reportDir);
  return { report, reportPaths };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const { report, reportPaths } = await runImportPipeline(options);
  console.info('[DB] Stage 4 JSON import dry-run complete', {
    status: report.run.status,
    mode: report.run.mode,
    reportJson: reportPaths.jsonPath,
    reportMarkdown: reportPaths.mdPath
  });
  if (report.run.status === 'FAIL') process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[DB] Stage 4 JSON import dry-run failed', {
      code: error?.code || error?.errno || 'UNKNOWN',
      message: error?.message || String(error)
    });
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_FILES_ROOT,
  DEFAULT_JSON_PATH,
  DEFAULT_REPORT_DIR,
  buildValidationReport,
  findDuplicateJsonKeys,
  parseArgs,
  reconcileFiles,
  runImportPipeline,
  safeRelativePath,
  toMysqlDateTime
};
