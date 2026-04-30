const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const { toHttpConflictPayload } = require('../../server/persistence/mysql/conflicts');
const { ProductionExecutionRepository } = require('../../server/repositories/productionExecutionRepository');

function createRepository() {
  return new ProductionExecutionRepository({
    pool: {
      async execute() {
        throw new Error('Pool should not be used by tx-scoped repository test.');
      }
    }
  });
}

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');
}

function extractFunctionSource(source, functionName) {
  const start = source.indexOf(`function ${functionName}`);
  assert.notEqual(start, -1, `${functionName} not found`);
  const nextMatch = /\n(?:async\s+)?function\s+/.exec(source.slice(start + 1));
  const next = nextMatch ? start + 1 + nextMatch.index : -1;
  return source.slice(start, next === -1 ? source.length : next);
}

function runServerBoot(envPatch) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '../..'),
      env: {
        ...process.env,
        PORT: '0',
        HOST: '127.0.0.1',
        TSPCC_PRODUCTION_EXECUTION_SQL_SOURCE: '',
        TSPCC_PRODUCTION_PLANNING_SQL_SOURCE: '',
        TSPCC_PRODUCTION_SQL_SOURCE: '',
        TSPCC_CARDS_SQL_SOURCE: '',
        TSPCC_DIRECTORIES_SECURITY_SQL_SOURCE: '',
        TSPCC_DIRECTORIES_SQL_SOURCE: '',
        TSPCC_SECURITY_SQL_SOURCE: '',
        ...envPatch
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`server boot guard did not finish. Output:\n${output}`));
    }, 8000);
    child.stdout.on('data', chunk => { output += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { output += chunk.toString('utf8'); });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

test('production execution repository enforces SQL flow version before update', async () => {
  const repository = createRepository();
  const calls = [];
  const tx = {
    async query(options) {
      calls.push(options);
      if (options.label === 'production-execution:flow-states:lock') {
        return {
          rows: [{
            id: 'pfs_1',
            card_id: 'card-1',
            route_operation_id: 'op-1',
            flow_version: 4
          }]
        };
      }
      return { rows: [] };
    }
  };

  const result = await repository.syncFlowStateFromCard(tx, {
    id: 'card-1',
    status: 'IN_PROGRESS',
    productionStatus: 'IN_PROGRESS',
    flow: { version: 5 },
    operations: [{ id: 'op-1', status: 'IN_PROGRESS' }]
  }, {
    expectedFlowVersion: 4,
    actorUserId: 'user-1',
    eventType: 'operation-start'
  });

  assert.equal(result.flowVersion, 5);
  assert.equal(calls[0].label, 'production-execution:flow-states:lock');
  assert.ok(calls.some(call => call.label === 'production-execution:flow-state:update'));
  assert.ok(calls.some(call => call.label === 'production-execution:projection:upsert'));
  assert.ok(calls.some(call => call.label === 'production-execution:flow-event:insert'));
  assert.equal(calls.some(call => /DELETE\s+FROM\s+production_flow_events/i.test(call.sql)), false);
});

test('production execution repository exposes stable normalized SQL ids', () => {
  const repository = createRepository();
  const flowStateId = repository.getFlowStateId('card-1', 'op-1');
  assert.equal(flowStateId, repository.getFlowStateId('card-1', 'op-1'));
  assert.notEqual(flowStateId, repository.getFlowStateId('card-1', 'op-2'));
  assert.match(flowStateId, /^pfs_[a-f0-9]{24}$/);
  assert.match(repository.getItemStateId(flowStateId, 'SN-001'), /^pfi_[a-f0-9]{24}$/);
  assert.match(repository.getPersonalOperationId(flowStateId, 'user-1', 'po-1'), /^ppo_[a-f0-9]{24}$/);
  assert.match(repository.getMaterialIssueId(flowStateId, 'mat-1'), /^pmi_[a-f0-9]{24}$/);
  assert.match(repository.getMaterialReturnId('pmi_1', 'return-1'), /^pmr_[a-f0-9]{24}$/);
  assert.match(repository.getDryingRecordId(flowStateId, 'dry-1'), /^pdr_[a-f0-9]{24}$/);
  assert.match(repository.getDelayId(flowStateId, 'delay-1'), /^pdl_[a-f0-9]{24}$/);
  assert.match(repository.getDefectId(flowStateId, 'defect-1'), /^pdf_[a-f0-9]{24}$/);
  assert.match(repository.getRepairId('pdf_1', 'repair-1'), /^prp_[a-f0-9]{24}$/);
  assert.match(repository.getDisposalId('pdf_1', 'dispose-1'), /^pds_[a-f0-9]{24}$/);
});

test('production execution repository provides normalized helper methods without wiring command families', async () => {
  const repository = createRepository();
  const calls = [];
  const tx = {
    async query(options) {
      calls.push(options);
      return { rows: [] };
    }
  };
  const flowStateId = repository.getFlowStateId('card-1', 'op-1');
  const itemStateId = await repository.upsertItemState(tx, {
    flowStateId,
    serialNo: 'SN-001',
    itemStatus: 'PENDING',
    qualityStatus: 'OK',
    quantity: 1
  });
  const personalOperationId = await repository.upsertPersonalOperation(tx, {
    flowStateId,
    userId: 'user-1',
    status: 'IN_PROGRESS',
    personalOperationKey: 'po-1',
    startedAt: Date.now()
  });
  const materialIssueId = await repository.appendMaterialIssue(tx, {
    flowStateId,
    materialCode: 'MAT-1',
    materialName: 'Material',
    quantity: 2,
    unit: 'kg',
    materialKey: 'issue-1'
  });
  await repository.appendMaterialReturn(tx, {
    materialIssueId,
    quantity: 1,
    returnKey: 'return-1'
  });
  await repository.upsertDryingRecord(tx, { flowStateId, dryingKey: 'dry-1', status: 'IN_PROGRESS' });
  await repository.upsertDelay(tx, { flowStateId, itemStateId, reason: 'wait', delayKey: 'delay-1' });
  const defectId = await repository.upsertDefect(tx, { flowStateId, itemStateId, description: 'defect', defectKey: 'defect-1' });
  await repository.upsertRepair(tx, { defectId, status: 'OPEN', repairKey: 'repair-1' });
  await repository.appendDisposal(tx, { defectId, reason: 'scrap', disposalKey: 'dispose-1' });
  await repository.listItemStates(tx, flowStateId);
  await repository.listPersonalOperations(tx, flowStateId);

  assert.match(itemStateId, /^pfi_/);
  assert.match(personalOperationId, /^ppo_/);
  assert.match(materialIssueId, /^pmi_/);
  assert.deepEqual(calls.map(call => call.label), [
    'production-execution:item-state:upsert',
    'production-execution:personal-operation:upsert',
    'production-execution:material-issue:insert',
    'production-execution:material-return:insert',
    'production-execution:drying-record:upsert',
    'production-execution:delay:upsert',
    'production-execution:defect:upsert',
    'production-execution:repair:upsert',
    'production-execution:disposal:insert',
    'production-execution:item-states:list',
    'production-execution:personal-operations:list'
  ]);
  assert.ok(calls.some(call => /INSERT INTO production_flow_item_states/i.test(call.sql)));
  assert.ok(calls.some(call => /INSERT INTO personal_operations/i.test(call.sql)));
  assert.ok(calls.some(call => /INSERT INTO production_material_issues/i.test(call.sql)));
  assert.ok(calls.some(call => /INSERT INTO production_drying_records/i.test(call.sql)));
  assert.ok(calls.some(call => /INSERT INTO production_delays/i.test(call.sql)));
  assert.ok(calls.some(call => /INSERT INTO production_defects/i.test(call.sql)));
  assert.ok(calls.some(call => /INSERT INTO production_repairs/i.test(call.sql)));
  assert.ok(calls.some(call => /INSERT INTO production_disposals/i.test(call.sql)));
});

test('core workspace command transaction locks SQL flow version before projection and syncs normalized rows', async () => {
  const repository = createRepository();
  const calls = [];
  const tx = {
    async query(options) {
      calls.push(options);
      if (options.label === 'production-execution:flow-states:lock') {
        return {
          rows: [{
            id: repository.getFlowStateId('card-1', 'op-1'),
            card_id: 'card-1',
            route_operation_id: 'op-1',
            flow_version: 3
          }]
        };
      }
      return { rows: [] };
    }
  };
  repository.inTransaction = async (work, options = {}) => {
    calls.push({ label: `tx:${options.label}` });
    return work(tx);
  };
  const cardsRepository = {
    async writeCardExecutionProjection(_tx, card) {
      calls.push({ label: 'cards:execution-projection:card', cardId: card.id });
    }
  };

  const result = await repository.persistCoreWorkspaceExecutionCommand({
    cardsRepository,
    buildCurrentData: async () => ({
      cards: [{
        id: 'card-1',
        status: 'IN_PROGRESS',
        productionStatus: 'IN_PROGRESS',
        flow: {
          version: 3,
          items: [{
            id: 'item-1',
            displayName: 'SN-001',
            current: { opId: 'op-1', status: 'PENDING' }
          }],
          samples: []
        },
        operations: [{ id: 'op-1', operationType: 'Получение материала', status: 'IN_PROGRESS' }],
        materialIssues: [{
          opId: 'op-1',
          items: [{
            name: 'Powder',
            qty: '2,5',
            unit: 'кг',
            isPowder: true,
            returnQty: '1',
            balanceQty: '1,5'
          }],
          dryingRows: [{
            rowId: 'dry-1',
            sourceIssueOpId: 'op-1',
            sourceItemIndex: 0,
            name: 'Powder',
            qty: '2,5',
            unit: 'кг',
            isPowder: true,
            dryQty: '1',
            dryResultQty: '1',
            status: 'DONE',
            startedAt: Date.now() - 1000,
            finishedAt: Date.now()
          }]
        }],
        personalOperations: [{
          id: 'pop-1',
          parentOpId: 'op-1',
          currentExecutorUserId: 'user-1',
          status: 'IN_PROGRESS',
          historySegments: [{ startedAt: Date.now() }]
        }]
      }]
    }),
    normalizeData: value => value,
    deepClone: value => JSON.parse(JSON.stringify(value)),
    findCardByKey: (data, cardId) => (data.cards || []).find(card => card.id === cardId) || null,
    mutator: async (draft) => {
      const card = draft.cards[0];
      card.flow.version = 4;
      card.flow.items[0].current.status = 'GOOD';
      return draft;
    },
    cardId: 'card-1',
    expectedFlowVersion: 3,
    actorUserId: 'user-1',
    eventType: 'operation-complete',
    eventPayload: { opId: 'op-1', action: 'complete' }
  });

  const labels = calls.map(call => call.label);
  assert.equal(result.cards[0].flow.version, 4);
  assert.equal(labels[0], 'tx:production-execution:core-workspace-command');
  assert.ok(labels.indexOf('production-execution:flow-states:lock') < labels.indexOf('cards:execution-projection:card'));
  assert.ok(labels.some(label => label === 'production-execution:flow-state:update'));
  assert.ok(labels.some(label => label === 'production-execution:item-state:upsert'));
  assert.ok(labels.some(label => label === 'production-execution:personal-operation:upsert'));
  assert.ok(labels.some(label => label === 'production-execution:material-issue:insert'));
  assert.ok(labels.some(label => label === 'production-execution:material-return:insert'));
  assert.ok(labels.some(label => label === 'production-execution:drying-record:upsert'));
  assert.ok(labels.some(label => label === 'production-execution:flow-event:insert'));
  assert.ok(calls.some(call => /INSERT INTO production_flow_item_states/i.test(call.sql || '')));
  assert.ok(calls.some(call => /INSERT INTO personal_operations/i.test(call.sql || '')));
  assert.ok(calls.some(call => /INSERT INTO production_material_issues/i.test(call.sql || '')));
  assert.ok(calls.some(call => /INSERT INTO production_material_returns/i.test(call.sql || '')));
  assert.ok(calls.some(call => /INSERT INTO production_drying_records/i.test(call.sql || '')));
});

test('material and drying reconciliation compares SQL rows to compatibility projection and append-only events', async () => {
  const repository = createRepository();
  const flowStateId = repository.getFlowStateId('card-1', 'mat-op');
  const materialIssueId = repository.getMaterialIssueId(flowStateId, 'mat-op:0');
  const materialReturnId = repository.getMaterialReturnId(materialIssueId, 'return:mat-op:0');
  const dryingRecordId = repository.getDryingRecordId(flowStateId, 'dry-1');
  const calls = [];
  const tx = {
    async query(options) {
      calls.push(options);
      if (options.label === 'production-execution:reconcile:material-issues') {
        return { rows: [{ id: materialIssueId, flow_state_id: flowStateId, material_code: 'mat-op:0' }] };
      }
      if (options.label === 'production-execution:reconcile:material-returns') {
        return { rows: [{ id: materialReturnId, material_issue_id: materialIssueId }] };
      }
      if (options.label === 'production-execution:reconcile:drying-records') {
        return { rows: [{ id: dryingRecordId, flow_state_id: flowStateId, status: 'DONE' }] };
      }
      if (options.label === 'production-execution:reconcile:material-drying-event-count') {
        return { rows: [{ card_id: 'card-1', event_count: 3 }] };
      }
      return { rows: [] };
    }
  };

  const result = await repository.compareMaterialDryingProjection(tx, {
    id: 'card-1',
    operations: [{ id: 'mat-op', operationType: 'Получение материала' }],
    materialIssues: [{
      opId: 'mat-op',
      items: [{ name: 'Powder', qty: '2', unit: 'кг', isPowder: true, returnQty: '1', balanceQty: '1' }],
      dryingRows: [{ rowId: 'dry-1', status: 'DONE' }]
    }]
  });

  assert.equal(result.compatible, true);
  assert.deepEqual(result.issues, []);
  assert.equal(result.expected.materialIssueCount, 1);
  assert.equal(result.expected.materialReturnCount, 1);
  assert.equal(result.expected.dryingRecordCount, 1);
  assert.equal(result.actual.eventCount, 3);
  assert.deepEqual(calls.map(call => call.label), [
    'production-execution:reconcile:material-issues',
    'production-execution:reconcile:material-returns',
    'production-execution:reconcile:drying-records',
    'production-execution:reconcile:material-drying-event-count'
  ]);
});

test('production execution SQL conflict keeps card.flow envelope shape', async () => {
  const repository = createRepository();
  const tx = {
    async query(options) {
      if (options.label === 'production-execution:flow-states:lock') {
        return {
          rows: [{
            id: 'pfs_1',
            card_id: 'card-1',
            route_operation_id: 'op-1',
            flow_version: 7
          }]
        };
      }
      return { rows: [] };
    }
  };

  await assert.rejects(
    () => repository.syncFlowStateFromCard(tx, {
      id: 'card-1',
      flow: { version: 8 },
      operations: [{ id: 'op-1', status: 'IN_PROGRESS' }]
    }, {
      expectedFlowVersion: 6
    }),
    (error) => {
      const payload = toHttpConflictPayload(error);
      assert.equal(payload.code, 'STALE_REVISION');
      assert.equal(payload.entity, 'card.flow');
      assert.equal(payload.id, 'card-1');
      assert.equal(payload.expectedRev, 6);
      assert.equal(payload.actualRev, 7);
      assert.equal(payload.flowVersion, 7);
      return true;
    }
  );
});

test('production execution reconciliation compares normalized SQL projection to card.flow', async () => {
  const repository = createRepository();
  const flowStateId = repository.getFlowStateId('card-1', 'op-1');
  const calls = [];
  const tx = {
    async query(options) {
      calls.push(options);
      if (options.label === 'production-execution:reconcile:flow-states') {
        return {
          rows: [{
            id: flowStateId,
            card_id: 'card-1',
            route_operation_id: 'op-1',
            flow_version: 9,
            flow_status: 'IN_PROGRESS',
            current_area_id: null
          }]
        };
      }
      if (options.label === 'production-execution:reconcile:projection') {
        return {
          rows: [{
            card_id: 'card-1',
            active_flow_state_id: flowStateId,
            flow_version: 9,
            current_status: 'IN_PROGRESS',
            current_area_id: null
          }]
        };
      }
      if (options.label === 'production-execution:reconcile:event-count') {
        return { rows: [{ card_id: 'card-1', event_count: 2 }] };
      }
      return { rows: [] };
    }
  };

  const result = await repository.compareCardFlowProjection(tx, {
    id: 'card-1',
    status: 'IN_PROGRESS',
    productionStatus: 'IN_PROGRESS',
    flow: { version: 9 },
    operations: [{ id: 'op-1', status: 'IN_PROGRESS' }]
  });

  assert.equal(result.compatible, true);
  assert.deepEqual(result.issues, []);
  assert.equal(result.expected.activeFlowStateId, flowStateId);
  assert.equal(result.actual.eventCount, 2);
  assert.deepEqual(calls.map(call => call.label), [
    'production-execution:reconcile:flow-states',
    'production-execution:reconcile:projection',
    'production-execution:reconcile:event-count'
  ]);
});

test('production flow events are append-only in repository foundation', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../server/repositories/productionExecutionRepository.js'), 'utf8');
  assert.match(source, /async appendFlowEvent/);
  assert.match(source, /INSERT INTO production_flow_events/);
  assert.equal(/DELETE\s+FROM\s+production_flow_events/i.test(source), false);
  assert.equal(/UPDATE\s+production_flow_events/i.test(source), false);
});

test('card execution projection does not delete card operations and cascade flow history', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../server/repositories/cardsRepository.js'), 'utf8');
  const methodSource = source.slice(source.indexOf('async writeCardExecutionProjection'));
  assert.ok(methodSource.includes('ON DUPLICATE KEY UPDATE'));
  assert.equal(/DELETE\s+FROM\s+card_operations/i.test(methodSource), false);
});

test('production scope client refresh uses production execution endpoint instead of legacy snapshot scope', () => {
  const stateSource = readRepoFile('js/app.00.state.js');
  const storeSource = readRepoFile('js/app.40.store.js');
  assert.match(stateSource, /PRODUCTION_EXECUTION_SCOPE_PATH\s*=\s*'\/api\/production\/execution\/scope'/);
  assert.match(storeSource, /normalizedScope === DATA_SCOPE_PRODUCTION[\s\S]+PRODUCTION_EXECUTION_SCOPE_PATH/);
});

test('production execution SQL source fails fast without production SQL mode', async () => {
  const result = await runServerBoot({
    TSPCC_PRODUCTION_EXECUTION_SQL_SOURCE: '1',
    TSPCC_PRODUCTION_PLANNING_SQL_SOURCE: '1',
    TSPCC_CARDS_SQL_SOURCE: '1',
    TSPCC_DIRECTORIES_SECURITY_SQL_SOURCE: '1'
  });
  assert.notEqual(result.code, 0);
  assert.match(result.output, /\[DB\] production execution SQL source guard failed/);
  assert.match(result.output, /\[BOOT\] server start failed/);
  assert.match(result.output, /TSPCC_PRODUCTION_SQL_SOURCE=1/);
});

test('production execution SQL boundary requires SQL dependency sources', () => {
  const serverSource = readRepoFile('server.js');
  const guardSource = extractFunctionSource(serverSource, 'getProductionExecutionSqlBoundaryConfigErrors');
  assert.match(guardSource, /isProductionExecutionSqlSourceEnabled\(\)/);
  assert.match(guardSource, /isProductionSqlSourceRequested\(\)/);
  assert.match(guardSource, /isProductionPlanningSqlSourceEnabled\(\)/);
  assert.match(guardSource, /isCardsSqlSourceEnabled\(\)/);
  assert.match(guardSource, /isDirectoriesSecuritySqlSourceEnabled\(\)/);

  const executionComposer = extractFunctionSource(serverSource, 'buildSqlBackedProductionExecutionData');
  assert.match(executionComposer, /assertProductionExecutionSqlBoundaryConfig\(\)/);
  assert.match(executionComposer, /buildSqlBackedProductionPlanningData\(DATA_SCOPE_PRODUCTION\)/);
  assert.equal(/database\.getData\s*\(/.test(executionComposer), false);

  const planningDependencies = extractFunctionSource(serverSource, 'getProductionPlanningDependencyData');
  assert.match(planningDependencies, /getDirectoriesRepository\(\)\.readSnapshot\(\)/);
  assert.match(planningDependencies, /getSecurityRepository\(\)\.readSnapshot\(\)/);
  assert.match(planningDependencies, /getCardsRepository\(\)\.listCards\(\)/);
});

test('production data compatibility scope is SQL-backed in execution SQL mode', () => {
  const serverSource = readRepoFile('server.js');
  const compatibility = extractFunctionSource(serverSource, 'buildProductionExecutionCompatibilityScopePayload');
  assert.match(compatibility, /isProductionExecutionSqlSourceEnabled\(\)/);
  assert.match(compatibility, /buildSqlBackedProductionExecutionData\(scope\)/);
  assert.match(compatibility, /buildScopedDataPayload\(data, DATA_SCOPE_PRODUCTION\)/);

  const legacyGet = serverSource.slice(
    serverSource.indexOf("if (req.method === 'GET' && isLegacySnapshotDataPath(pathname))"),
    serverSource.indexOf("if (req.method === 'POST' && isLegacySnapshotDataPath(pathname))")
  );
  assert.match(legacyGet, /requestedScope === DATA_SCOPE_PRODUCTION && isProductionExecutionSqlSourceEnabled\(\)/);
  assert.match(legacyGet, /buildProductionExecutionCompatibilityScopePayload\(requestedScope\)/);
});

test('production execution command families use the SQL mutation boundary', () => {
  const serverSource = readRepoFile('server.js');
  const executionCommands = serverSource.slice(
    serverSource.indexOf("if (req.method === 'POST' && pathname === '/api/production/personal-operation/select')"),
    serverSource.indexOf("if (req.method === 'POST' && pathname === '/api/production/plan/auto')")
  );
  assert.match(executionCommands, /getProductionExecutionCommandData\(\)/);
  assert.match(executionCommands, /persistProductionExecutionMutation\(/);
  assert.match(executionCommands, /commandFamily:\s*'core-workspace-execution'/);
  assert.match(executionCommands, /coreWorkspaceExecutionActions[\s\S]+material-issue[\s\S]+material-return[\s\S]+drying-start[\s\S]+drying-finish[\s\S]+drying-complete/);
  assert.equal(/database\.update\s*\(/.test(executionCommands), false);

  const persistBoundary = extractFunctionSource(serverSource, 'persistProductionExecutionMutation');
  assert.match(persistBoundary, /executionRepository\.persistCoreWorkspaceExecutionCommand/);
  assert.match(persistBoundary, /commandFamily === 'core-workspace-execution'/);
  assert.match(persistBoundary, /cardsRepository\.inTransaction/);
  assert.match(persistBoundary, /cardsRepository\.writeCardExecutionProjection\(tx, card\)/);
  assert.match(persistBoundary, /executionRepository\.syncFlowStateFromCard\(tx, card/);
  assert.equal(/INSERT\s+INTO\s+production_flow_/i.test(executionCommands), false);
  assert.equal(/UPDATE\s+production_flow_/i.test(executionCommands), false);
  assert.equal(/INSERT\s+INTO\s+card_flow_projection/i.test(executionCommands), false);
  assert.equal(/production_material_issues|production_material_returns|production_drying_records/i.test(executionCommands), false);
});
