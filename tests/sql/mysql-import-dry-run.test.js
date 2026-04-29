const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  buildValidationReport,
  findDuplicateJsonKeys,
  parseArgs,
  reconcileFiles,
  resolveImportId,
  runImportPipeline,
  safeRelativePath,
  toMysqlDateTime
} = require('../../scripts/mysql/import-json-dry-run');

function minimalSnapshot() {
  return {
    cards: [
      {
        id: 'card_1',
        rev: 2,
        qrId: 'QR1',
        barcode: 'BC1',
        routeCardNumber: 'RC1',
        cardType: 'MKI',
        approvalStage: 'PROVIDED',
        status: 'NOT_STARTED',
        productionStatus: 'NOT_STARTED',
        archived: false,
        name: 'Card 1',
        itemName: 'Item 1',
        quantity: 1,
        batchSize: 1,
        createdAt: 1700000000000,
        updatedAt: 1700000001000,
        itemSerials: ['SN1'],
        operations: [
          {
            id: 'rop_1',
            opId: 'op_1',
            opCode: '010',
            opName: 'Operation 1',
            centerId: 'wc_1',
            centerName: 'Center 1',
            order: 1,
            quantity: 1,
            status: 'NOT_STARTED'
          }
        ],
        attachments: [
          {
            id: 'att_1',
            relPath: 'doc.txt',
            originalName: 'doc.txt',
            category: 'PARTS_DOCS',
            scope: 'OPERATION',
            scopeId: 'rop_1',
            operationLabel: '010 Operation 1',
            itemsLabel: 'SN1',
            opId: 'op_1',
            opCode: '010',
            opName: 'Operation 1',
            size: 5,
            createdAt: 1700000000000
          }
        ],
        flow: { version: 1, items: [], samples: [], events: [] },
        logs: [],
        approvalThread: []
      }
    ],
    ops: [{ id: 'op_1', code: '010', name: 'Operation 1', allowedAreaIds: ['area_1'], rev: 1 }],
    centers: [{ id: 'wc_1', name: 'Center 1', desc: '', rev: 1 }],
    areas: [{ id: 'area_1', name: 'Area 1', type: 'main', rev: 1 }],
    users: [{ id: 'user_1', name: 'Abyss', role: 'admin', accessLevelId: 'al_1', passwordHash: 'hash', passwordSalt: 'salt', rev: 1 }],
    accessLevels: [{ id: 'al_1', name: 'Admins', permissions: { users: { view: true, edit: true } }, rev: 1 }],
    messages: [],
    chatConversations: [],
    chatMessages: [],
    chatStates: [],
    webPushSubscriptions: [],
    fcmTokens: [],
    userVisits: [],
    userActions: [{ id: 'ua_1', userId: 'user_1', at: 1700000000000, text: 'Created card' }],
    productionSchedule: [],
    productionShiftTimes: [{ shift: '1', timeFrom: '08:00', timeTo: '20:00', rev: 1 }],
    productionShiftTasks: [],
    productionShifts: [],
    meta: { revision: 10 }
  };
}

function reportForFiles() {
  return {
    validation: { fatal: [], warnings: [], byDomain: {} },
    import: { convertedFields: [] },
    reconciliation: { brokenReferences: [] },
    files: {
      metadataRows: 0,
      physicalFiles: 0,
      missingFiles: [],
      orphanFiles: [],
      sizeMismatches: [],
      sizeCorrections: [],
      checksumPolicy: 'generated',
      checksumRows: 0
    }
  };
}

test('duplicate JSON keys are detected before JSON.parse drops ambiguity', () => {
  const duplicates = findDuplicateJsonKeys('{"cards":[{"id":"a","id":"b"}],"meta":{"revision":1,"revision":2}}');
  assert.deepEqual(
    duplicates.map((entry) => entry.path),
    ['$.cards[0].id', '$.meta.revision']
  );
});

test('argument parser keeps importer offline unless --execute is explicit', () => {
  const options = parseArgs(['--json', 'fixture.json', '--files-root', 'storage-copy', '--report-dir', 'reports']);
  assert.equal(options.execute, false);
  assert.match(options.sourceJsonPath, /fixture\.json$/);
  assert.match(options.sourceFilesRoot, /storage-copy$/);
});

test('path validation blocks attachment traversal outside storage root', () => {
  assert.equal(safeRelativePath('QR1/doc.txt'), true);
  assert.equal(safeRelativePath('../secret.txt'), false);
  assert.equal(safeRelativePath('QR1/../../secret.txt'), false);
  assert.equal(safeRelativePath(''), false);
});

test('validation reports required IDs and broken references explicitly', () => {
  const db = minimalSnapshot();
  db.cards[0].operations[0].opId = 'missing_op';
  const report = {
    source: { topLevelCounts: {}, fieldPaths: {}, duplicateJsonKeys: [], unknownFields: [] },
    validation: { fatal: [], warnings: [], byDomain: {} },
    import: { skippedFields: [], convertedFields: [], compatibilityArchives: [], insertedRowsByTable: {} },
    reconciliation: { brokenReferences: [], manualDecisionsRequired: [] },
    files: {}
  };
  buildValidationReport(db, [], report);
  assert.equal(report.validation.fatal.length, 0);
  assert.equal(report.reconciliation.brokenReferences.length, 1);
  assert.match(report.reconciliation.brokenReferences[0].message, /missing operation/i);
});

test('duplicate import IDs are converted with an explicit report entry', () => {
  const report = { import: { convertedFields: [] } };
  const usedIds = new Set();
  const first = resolveImportId({
    preferredId: 'log_1',
    table: 'card_logs',
    usedIds,
    fallbackSeed: 'card_1:log:0:log_1',
    prefix: 'clog',
    report,
    sourcePath: '$.cards[card_1].logs[0].id'
  });
  const second = resolveImportId({
    preferredId: 'log_1',
    table: 'card_logs',
    usedIds,
    fallbackSeed: 'card_1:log:1:log_1',
    prefix: 'clog',
    report,
    sourcePath: '$.cards[card_1].logs[1].id'
  });

  assert.equal(first, 'log_1');
  assert.notEqual(second, 'log_1');
  assert.match(second, /^clog_/);
  assert.deepEqual(report.import.convertedFields, [{
    path: '$.cards[card_1].logs[1].id',
    sourceId: 'log_1',
    targetId: second,
    target: 'card_logs',
    decision: 'deduplicate-import-id',
    reason: 'Duplicate source id for card_logs; source row is preserved with a stable import id.'
  }]);
});

test('file reconciliation covers metadata, physical files, missing files, orphans and checksums', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tspcc-stage4-files-'));
  const filesRoot = path.join(tempRoot, 'cards');
  await fs.mkdir(path.join(filesRoot, 'QR1'), { recursive: true });
  await fs.writeFile(path.join(filesRoot, 'QR1', 'doc.txt'), 'hello');
  await fs.writeFile(path.join(filesRoot, 'QR1', 'orphan.txt'), 'orphan');
  const db = minimalSnapshot();
  db.cards[0].attachments.push({ id: 'att_2', relPath: 'missing.txt', originalName: 'missing.txt', size: 7 });
  const report = reportForFiles();
  const rows = await reconcileFiles(db, filesRoot, report, { checksum: true });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].scope, 'OPERATION');
  assert.equal(rows[0].scopeId, 'rop_1');
  assert.equal(rows[0].operationLabel, '010 Operation 1');
  assert.equal(rows[0].itemsLabel, 'SN1');
  assert.equal(rows[0].opId, 'op_1');
  assert.equal(rows[0].opCode, '010');
  assert.equal(rows[0].opName, 'Operation 1');
  assert.equal(report.files.metadataRows, 2);
  assert.equal(report.files.physicalFiles, 2);
  assert.equal(report.files.missingFiles.length, 1);
  assert.equal(report.files.orphanFiles.length, 1);
  assert.equal(report.files.checksumRows, 1);
  assert.equal(Buffer.isBuffer(rows[0].checksumSha256), true);
});

test('file reconciliation canonicalizes SQL size from the physical file with an explicit correction', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tspcc-stage4-size-'));
  const filesRoot = path.join(tempRoot, 'cards');
  await fs.mkdir(path.join(filesRoot, 'QR1'), { recursive: true });
  await fs.writeFile(path.join(filesRoot, 'QR1', 'doc.txt'), 'actual-size');
  const db = minimalSnapshot();
  db.cards[0].attachments[0].size = 1;
  const report = reportForFiles();
  const rows = await reconcileFiles(db, filesRoot, report, { checksum: false });

  assert.equal(rows[0].sizeBytes, 11);
  assert.equal(report.files.sizeMismatches.length, 0);
  assert.deepEqual(report.files.sizeCorrections, [{
    cardId: 'card_1',
    attachmentId: 'att_1',
    expected: 1,
    actual: 11,
    relPath: 'QR1/doc.txt',
    decision: 'use-physical-file-size'
  }]);
  assert.equal(report.import.convertedFields[0].target, 'card_attachments.size_bytes');
});

test('source-only pipeline writes reconciliation reports without MySQL', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tspcc-stage4-import-'));
  const jsonPath = path.join(tempRoot, 'database.json');
  const filesRoot = path.join(tempRoot, 'cards');
  const reportDir = path.join(tempRoot, 'reports');
  await fs.mkdir(path.join(filesRoot, 'QR1'), { recursive: true });
  await fs.writeFile(path.join(filesRoot, 'QR1', 'doc.txt'), 'hello');
  await fs.writeFile(jsonPath, JSON.stringify(minimalSnapshot(), null, 2), 'utf8');

  const { report, reportPaths } = await runImportPipeline({
    sourceJsonPath: jsonPath,
    sourceFilesRoot: filesRoot,
    reportDir,
    execute: false,
    checksum: false,
    strictValidation: false
  });

  assert.equal(report.run.mode, 'source-validation');
  assert.equal(report.reconciliation.countsByDomain.work_centers, 1);
  assert.equal(report.reconciliation.countsByDomain.user_actions, 1);
  assert.equal(report.reconciliation.countsByDomain.production_flow_states, 1);
  assert.equal(report.reconciliation.countsByDomain.card_flow_projection, 1);
  assert.equal(report.files.missingFiles.length, 0);
  assert.equal(await fs.stat(reportPaths.jsonPath).then((stat) => stat.isFile()), true);
  assert.equal(await fs.stat(reportPaths.mdPath).then((stat) => stat.isFile()), true);
});

test('source-only pipeline classifies shift masters and system conversations without FK warnings', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tspcc-stage4-classify-'));
  const jsonPath = path.join(tempRoot, 'database.json');
  const filesRoot = path.join(tempRoot, 'cards');
  const reportDir = path.join(tempRoot, 'reports');
  await fs.mkdir(path.join(filesRoot, 'QR1'), { recursive: true });
  await fs.writeFile(path.join(filesRoot, 'QR1', 'doc.txt'), 'hello');
  const db = minimalSnapshot();
  db.productionSchedule = [
    { date: '2026-04-29', shift: 1, areaId: 'area_1', employeeId: 'user_1', assignmentStatus: '' },
    { date: '2026-04-29', shift: 1, areaId: '__shift_master__', employeeId: 'user_1', assignmentStatus: 'SHIFT_MASTER' }
  ];
  db.chatConversations = [{
    id: 'c_system',
    type: 'direct',
    participantIds: ['user_1', 'system'],
    createdAt: 1700000000000
  }];
  await fs.writeFile(jsonPath, JSON.stringify(db, null, 2), 'utf8');

  const { report } = await runImportPipeline({
    sourceJsonPath: jsonPath,
    sourceFilesRoot: filesRoot,
    reportDir,
    execute: false,
    checksum: false,
    strictValidation: false
  });

  assert.equal(report.reconciliation.countsByDomain.production_schedule, 1);
  assert.equal(report.reconciliation.countsByDomain.production_shift_masters, 1);
  assert.equal(report.validation.warnings.some((warning) => warning.value === 'system'), false);
  assert.equal(report.reconciliation.brokenReferences.length, 0);
});

test('timestamp conversion uses UTC DATETIME(3) format', () => {
  assert.equal(toMysqlDateTime(1700000000123), '2023-11-14 22:13:20.123');
  assert.equal(toMysqlDateTime(null), null);
});
