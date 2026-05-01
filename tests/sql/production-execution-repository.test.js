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

test('delayed return queue command resolves SQL delay before compatibility projection', async () => {
  const repository = createRepository();
  const calls = [];
  const cardBefore = {
    id: 'card-delay',
    qrId: 'QR-DELAY',
    status: 'IN_PROGRESS',
    productionStatus: 'IN_PROGRESS',
    flow: {
      version: 3,
      items: [{
        id: 'item-1',
        displayName: 'SN-001',
        current: { opId: 'op-1', status: 'DELAYED' }
      }],
      samples: []
    },
    operations: [{ id: 'op-1', status: 'IN_PROGRESS' }]
  };
  const tx = {
    async query(options) {
      calls.push(options);
      if (options.label === 'production-execution:flow-states:lock') {
        return {
          rows: [{
            id: repository.getFlowStateId('card-delay', 'op-1'),
            card_id: 'card-delay',
            route_operation_id: 'op-1',
            flow_version: 3
          }]
        };
      }
      if (options.label === 'production-execution:reconcile:delays') {
        return {
          rows: [{
            id: repository.getDelayQueueId('card-delay', 'op-1', 'ITEM', 'item-1'),
            status: 'RESOLVED',
            card_id: 'card-delay',
            qr_id: 'QR-DELAY',
            route_operation_id: 'op-1'
          }]
        };
      }
      if (options.label === 'production-execution:reconcile:defects') return { rows: [] };
      if (options.label === 'production-execution:reconcile:queue-event-count') {
        return { rows: [{ card_id: 'card-delay', event_count: 1 }] };
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

  const result = await repository.persistDelayedDefectQueueCommand({
    cardsRepository,
    buildCurrentData: async () => ({ cards: [cardBefore] }),
    normalizeData: value => value,
    deepClone: value => JSON.parse(JSON.stringify(value)),
    findCardByKey: (data, cardId) => (data.cards || []).find(card => card.id === cardId) || null,
    mutator: async (draft) => {
      const card = draft.cards[0];
      card.flow.version = 4;
      card.flow.items[0].current.status = 'PENDING';
      return draft;
    },
    cardId: 'card-delay',
    expectedFlowVersion: 3,
    actorUserId: 'user-1',
    eventType: 'flow-return',
    eventPayload: { opId: 'op-1', itemId: 'item-1', kind: 'ITEM' },
    queueCommand: { action: 'return', opId: 'op-1', itemId: 'item-1', kind: 'ITEM', now: Date.now() }
  });

  const labels = calls.map(call => call.label);
  assert.equal(result.queueReconciliation.compatible, true);
  assert.equal(result.queueReconciliation.actual.delayedCount, 0);
  assert.equal(result.cards[0].flow.version, 4);
  assert.ok(labels.indexOf('production-execution:flow-states:lock') < labels.indexOf('production-execution:delay:upsert'));
  assert.ok(labels.indexOf('production-execution:delay:upsert') < labels.indexOf('cards:execution-projection:card'));
  assert.ok(labels.some(label => label === 'production-execution:item-state:upsert'));
  assert.ok(labels.some(label => label === 'production-execution:flow-event:insert'));
  assert.ok(calls.some(call => /INSERT INTO production_delays/i.test(call.sql || '')));
  assert.equal(calls.some(call => /INSERT INTO production_repairs|INSERT INTO production_disposals/i.test(call.sql || '')), false);
});

test('defect queue command resolves SQL delay and opens SQL defect before projection', async () => {
  const repository = createRepository();
  const calls = [];
  const defectId = repository.getDefectQueueId('card-defect', 'op-1', 'ITEM', 'item-1');
  const cardBefore = {
    id: 'card-defect',
    qrId: 'QR-DEFECT',
    status: 'IN_PROGRESS',
    productionStatus: 'IN_PROGRESS',
    flow: {
      version: 6,
      items: [{
        id: 'item-1',
        displayName: 'SN-001',
        current: { opId: 'op-1', status: 'DELAYED' }
      }],
      samples: []
    },
    operations: [{ id: 'op-1', status: 'IN_PROGRESS' }]
  };
  const tx = {
    async query(options) {
      calls.push(options);
      if (options.label === 'production-execution:flow-states:lock') {
        return {
          rows: [{
            id: repository.getFlowStateId('card-defect', 'op-1'),
            card_id: 'card-defect',
            route_operation_id: 'op-1',
            flow_version: 6
          }]
        };
      }
      if (options.label === 'production-execution:reconcile:delays') {
        return { rows: [{ id: repository.getDelayQueueId('card-defect', 'op-1', 'ITEM', 'item-1'), status: 'RESOLVED' }] };
      }
      if (options.label === 'production-execution:reconcile:defects') {
        return {
          rows: [{
            id: defectId,
            status: 'OPEN',
            card_id: 'card-defect',
            qr_id: 'QR-DEFECT',
            route_operation_id: 'op-1'
          }]
        };
      }
      if (options.label === 'production-execution:reconcile:queue-event-count') {
        return { rows: [{ card_id: 'card-defect', event_count: 2 }] };
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

  const result = await repository.persistDelayedDefectQueueCommand({
    cardsRepository,
    buildCurrentData: async () => ({ cards: [cardBefore] }),
    normalizeData: value => value,
    deepClone: value => JSON.parse(JSON.stringify(value)),
    findCardByKey: (data, cardId) => (data.cards || []).find(card => card.id === cardId) || null,
    mutator: async (draft) => {
      const card = draft.cards[0];
      card.flow.version = 7;
      card.flow.items[0].current.status = 'DEFECT';
      return draft;
    },
    cardId: 'card-defect',
    expectedFlowVersion: 6,
    actorUserId: 'user-1',
    eventType: 'flow-defect',
    eventPayload: { opId: 'op-1', itemId: 'item-1', kind: 'ITEM' },
    queueCommand: { action: 'defect', opId: 'op-1', itemId: 'item-1', kind: 'ITEM', now: Date.now() }
  });

  const labels = calls.map(call => call.label);
  assert.equal(result.queueReconciliation.compatible, true);
  assert.equal(result.queueReconciliation.actual.defectCount, 1);
  assert.deepEqual(result.queueReconciliation.actual.detailRoutes.defects, ['/production/defects/QR-DEFECT']);
  assert.ok(labels.indexOf('production-execution:delay:upsert') < labels.indexOf('production-execution:defect:upsert'));
  assert.ok(labels.indexOf('production-execution:defect:upsert') < labels.indexOf('cards:execution-projection:card'));
  assert.ok(calls.some(call => /INSERT INTO production_defects/i.test(call.sql || '')));
  assert.equal(calls.some(call => /INSERT INTO production_repairs|INSERT INTO production_disposals/i.test(call.sql || '')), false);
});

test('delayed and defect queue command returns SQL stale flow conflict before queue writes', async () => {
  const repository = createRepository();
  const calls = [];
  const tx = {
    async query(options) {
      calls.push(options);
      if (options.label === 'production-execution:flow-states:lock') {
        return {
          rows: [{
            id: repository.getFlowStateId('card-stale', 'op-1'),
            card_id: 'card-stale',
            route_operation_id: 'op-1',
            flow_version: 9
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

  await assert.rejects(
    () => repository.persistDelayedDefectQueueCommand({
      cardsRepository: { async writeCardExecutionProjection() { calls.push({ label: 'cards:execution-projection:card' }); } },
      buildCurrentData: async () => ({
        cards: [{
          id: 'card-stale',
          flow: { version: 10, items: [{ id: 'item-1', current: { opId: 'op-1', status: 'DEFECT' } }], samples: [] },
          operations: [{ id: 'op-1', status: 'IN_PROGRESS' }]
        }]
      }),
      normalizeData: value => value,
      deepClone: value => JSON.parse(JSON.stringify(value)),
      findCardByKey: (data, cardId) => (data.cards || []).find(card => card.id === cardId) || null,
      mutator: async (draft) => draft,
      cardId: 'card-stale',
      expectedFlowVersion: 8,
      queueCommand: { action: 'defect', opId: 'op-1', itemId: 'item-1', kind: 'ITEM' }
    }),
    (error) => {
      const payload = toHttpConflictPayload(error);
      assert.equal(payload.code, 'STALE_REVISION');
      assert.equal(payload.entity, 'card.flow');
      assert.equal(payload.id, 'card-stale');
      assert.equal(payload.expectedRev, 8);
      assert.equal(payload.actualRev, 9);
      return true;
    }
  );

  assert.equal(calls.some(call => call.label === 'production-execution:delay:upsert'), false);
  assert.equal(calls.some(call => call.label === 'production-execution:defect:upsert'), false);
  assert.equal(calls.some(call => call.label === 'cards:execution-projection:card'), false);
});

test('repair command persists source defect, repair row and repair card projection atomically', async () => {
  const repository = createRepository();
  const calls = [];
  const defectId = repository.getDefectQueueId('card-repair-source', 'op-1', 'ITEM', 'item-1');
  const repairId = repository.getRepairQueueId('card-repair-source', 'op-1', 'ITEM', 'item-1', 'card-repair-target');
  const sourceAfter = {
    id: 'card-repair-source',
    qrId: 'QR-REPAIR-SOURCE',
    status: 'IN_PROGRESS',
    productionStatus: 'IN_PROGRESS',
    flow: {
      version: 9,
      items: [],
      samples: [],
      archivedItems: [{
        id: 'item-1',
        displayName: 'SN-001',
        archivedReason: 'MOVED',
        archivedTarget: { cardId: 'card-repair-target' }
      }]
    },
    operations: [{ id: 'op-1', status: 'IN_PROGRESS' }]
  };
  const repairAfter = {
    id: 'card-repair-target',
    qrId: 'QR-REPAIR-TARGET',
    status: 'NOT_STARTED',
    productionStatus: 'NOT_STARTED',
    itemSerials: ['SN-001'],
    flow: {
      version: 2,
      items: [{ id: 'repair-item-1', displayName: 'SN-001', current: { opId: 'repair-op-1', status: 'PENDING' } }],
      samples: []
    },
    operations: [{ id: 'repair-op-1', status: 'NOT_STARTED' }]
  };
  const tx = {
    async query(options) {
      calls.push(options);
      if (options.label === 'production-execution:flow-states:lock') {
        if (options.values[0] === 'card-repair-source') {
          return {
            rows: [{
              id: repository.getFlowStateId('card-repair-source', 'op-1'),
              card_id: 'card-repair-source',
              route_operation_id: 'op-1',
              flow_version: 8
            }]
          };
        }
        return { rows: [] };
      }
      if (options.label === 'production-execution:reconcile:repair-dispose-defects') {
        return { rows: [{ id: defectId, status: 'REPAIRED', card_id: 'card-repair-source', qr_id: 'QR-REPAIR-SOURCE' }] };
      }
      if (options.label === 'production-execution:reconcile:repairs') {
        return { rows: [{ id: repairId, defect_id: defectId, repair_card_id: 'card-repair-target', status: 'OPEN' }] };
      }
      if (options.label === 'production-execution:reconcile:disposals') return { rows: [] };
      if (options.label === 'production-execution:reconcile:repair-dispose-event-count') {
        return { rows: [{ card_id: 'card-repair-source', event_count: 2 }] };
      }
      if (options.label === 'production-execution:reconcile:delays') return { rows: [] };
      if (options.label === 'production-execution:reconcile:defects') {
        return { rows: [{ id: defectId, status: 'REPAIRED', card_id: 'card-repair-source', qr_id: 'QR-REPAIR-SOURCE' }] };
      }
      if (options.label === 'production-execution:reconcile:queue-event-count') {
        return { rows: [{ card_id: 'card-repair-source', event_count: 2 }] };
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

  const result = await repository.persistRepairDisposeCommand({
    cardsRepository,
    buildCurrentData: async () => ({ cards: [sourceAfter, repairAfter] }),
    normalizeData: value => value,
    deepClone: value => JSON.parse(JSON.stringify(value)),
    findCardByKey: (data, cardId) => (data.cards || []).find(card => card.id === cardId) || null,
    mutator: async (draft) => draft,
    cardId: 'card-repair-source',
    expectedFlowVersion: 8,
    actorUserId: 'user-1',
    eventType: 'flow-repair',
    eventPayload: { opId: 'op-1', itemId: 'item-1', kind: 'ITEM', mode: 'add_existing' },
    extraCards: [repairAfter],
    repairDisposeCommand: {
      action: 'repair',
      opId: 'op-1',
      itemId: 'item-1',
      kind: 'ITEM',
      repairCardId: 'card-repair-target',
      repairMode: 'add_existing',
      itemLabel: 'SN-001',
      trpnFileId: 'file-trpn-1'
    }
  });

  const labels = calls.map(call => `${call.label}:${call.cardId || ''}`);
  assert.equal(result.repairDisposeReconciliation.compatible, true);
  assert.equal(result.queueReconciliation.compatible, true);
  assert.ok(labels.indexOf('production-execution:flow-states:lock:') < labels.indexOf('cards:execution-projection:card:card-repair-target'));
  assert.ok(labels.indexOf('cards:execution-projection:card:card-repair-target') < labels.indexOf('production-execution:repair:upsert:'));
  assert.ok(labels.indexOf('production-execution:repair:upsert:') < labels.indexOf('cards:execution-projection:card:card-repair-source'));
  assert.ok(calls.some(call => /INSERT INTO production_defects/i.test(call.sql || '')));
  assert.ok(calls.some(call => /INSERT INTO production_repairs/i.test(call.sql || '')));
  assert.equal(calls.some(call => /INSERT INTO production_disposals/i.test(call.sql || '')), false);
});

test('dispose command persists closed defect and disposal before source projection', async () => {
  const repository = createRepository();
  const calls = [];
  const defectId = repository.getDefectQueueId('card-dispose', 'op-1', 'ITEM', 'item-1');
  const disposalId = repository.getDisposalQueueId('card-dispose', 'op-1', 'ITEM', 'item-1', 'file-trpn-dispose');
  const sourceAfter = {
    id: 'card-dispose',
    qrId: 'QR-DISPOSE',
    status: 'IN_PROGRESS',
    productionStatus: 'IN_PROGRESS',
    flow: {
      version: 5,
      items: [{ id: 'item-1', displayName: 'SN-001', current: { opId: 'op-1', status: 'DISPOSED' } }],
      samples: []
    },
    operations: [{ id: 'op-1', status: 'IN_PROGRESS' }]
  };
  const tx = {
    async query(options) {
      calls.push(options);
      if (options.label === 'production-execution:flow-states:lock') {
        return {
          rows: [{
            id: repository.getFlowStateId('card-dispose', 'op-1'),
            card_id: 'card-dispose',
            route_operation_id: 'op-1',
            flow_version: 4
          }]
        };
      }
      if (options.label === 'production-execution:reconcile:repair-dispose-defects') {
        return { rows: [{ id: defectId, status: 'DISPOSED', card_id: 'card-dispose', qr_id: 'QR-DISPOSE' }] };
      }
      if (options.label === 'production-execution:reconcile:repairs') return { rows: [] };
      if (options.label === 'production-execution:reconcile:disposals') {
        return { rows: [{ id: disposalId, defect_id: defectId, quantity: 1, reason: 'Утилизация' }] };
      }
      if (options.label === 'production-execution:reconcile:repair-dispose-event-count') {
        return { rows: [{ card_id: 'card-dispose', event_count: 1 }] };
      }
      if (options.label === 'production-execution:reconcile:delays') return { rows: [] };
      if (options.label === 'production-execution:reconcile:defects') {
        return { rows: [{ id: defectId, status: 'DISPOSED', card_id: 'card-dispose', qr_id: 'QR-DISPOSE' }] };
      }
      if (options.label === 'production-execution:reconcile:queue-event-count') {
        return { rows: [{ card_id: 'card-dispose', event_count: 1 }] };
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

  const result = await repository.persistRepairDisposeCommand({
    cardsRepository,
    buildCurrentData: async () => ({ cards: [sourceAfter] }),
    normalizeData: value => value,
    deepClone: value => JSON.parse(JSON.stringify(value)),
    findCardByKey: (data, cardId) => (data.cards || []).find(card => card.id === cardId) || null,
    mutator: async (draft) => draft,
    cardId: 'card-dispose',
    expectedFlowVersion: 4,
    actorUserId: 'user-1',
    eventType: 'flow-dispose',
    eventPayload: { opId: 'op-1', itemId: 'item-1', kind: 'ITEM' },
    repairDisposeCommand: {
      action: 'dispose',
      opId: 'op-1',
      itemId: 'item-1',
      kind: 'ITEM',
      itemLabel: 'SN-001',
      trpnFileId: 'file-trpn-dispose'
    }
  });

  const labels = calls.map(call => `${call.label}:${call.cardId || ''}`);
  assert.equal(result.repairDisposeReconciliation.compatible, true);
  assert.ok(labels.indexOf('production-execution:disposal:insert:') < labels.indexOf('cards:execution-projection:card:card-dispose'));
  assert.ok(calls.some(call => /INSERT INTO production_defects/i.test(call.sql || '')));
  assert.ok(calls.some(call => /INSERT INTO production_disposals/i.test(call.sql || '')));
  assert.equal(calls.some(call => /INSERT INTO production_repairs/i.test(call.sql || '')), false);
});

test('repair dispose command returns SQL stale flow conflict before repair or disposal writes', async () => {
  const repository = createRepository();
  const calls = [];
  const tx = {
    async query(options) {
      calls.push(options);
      if (options.label === 'production-execution:flow-states:lock') {
        return {
          rows: [{
            id: repository.getFlowStateId('card-stale-repair', 'op-1'),
            card_id: 'card-stale-repair',
            route_operation_id: 'op-1',
            flow_version: 11
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

  await assert.rejects(
    () => repository.persistRepairDisposeCommand({
      cardsRepository: { async writeCardExecutionProjection() { calls.push({ label: 'cards:execution-projection:card' }); } },
      buildCurrentData: async () => ({
        cards: [{
          id: 'card-stale-repair',
          flow: { version: 12, items: [{ id: 'item-1', current: { opId: 'op-1', status: 'DEFECT' } }], samples: [] },
          operations: [{ id: 'op-1', status: 'IN_PROGRESS' }]
        }]
      }),
      normalizeData: value => value,
      deepClone: value => JSON.parse(JSON.stringify(value)),
      findCardByKey: (data, cardId) => (data.cards || []).find(card => card.id === cardId) || null,
      mutator: async (draft) => draft,
      cardId: 'card-stale-repair',
      expectedFlowVersion: 10,
      repairDisposeCommand: { action: 'dispose', opId: 'op-1', itemId: 'item-1', kind: 'ITEM' }
    }),
    (error) => {
      const payload = toHttpConflictPayload(error);
      assert.equal(payload.code, 'STALE_REVISION');
      assert.equal(payload.entity, 'card.flow');
      assert.equal(payload.id, 'card-stale-repair');
      assert.equal(payload.expectedRev, 10);
      assert.equal(payload.actualRev, 11);
      return true;
    }
  );

  assert.equal(calls.some(call => call.label === 'production-execution:defect:upsert'), false);
  assert.equal(calls.some(call => call.label === 'production-execution:repair:upsert'), false);
  assert.equal(calls.some(call => call.label === 'production-execution:disposal:insert'), false);
  assert.equal(calls.some(call => call.label === 'cards:execution-projection:card'), false);
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

test('delayed and defect queue reconciliation compares SQL rows and rebuilds detail routes', async () => {
  const repository = createRepository();
  const delayId = repository.getDelayQueueId('card-queue', 'op-1', 'ITEM', 'item-delay');
  const defectId = repository.getDefectQueueId('card-queue', 'op-1', 'ITEM', 'item-defect');
  const calls = [];
  const tx = {
    async query(options) {
      calls.push(options);
      if (options.label === 'production-execution:reconcile:delays') {
        return {
          rows: [{ id: delayId, status: 'OPEN', card_id: 'card-queue', qr_id: 'QR-QUEUE', route_operation_id: 'op-1' }]
        };
      }
      if (options.label === 'production-execution:reconcile:defects') {
        return {
          rows: [{ id: defectId, status: 'OPEN', card_id: 'card-queue', qr_id: 'QR-QUEUE', route_operation_id: 'op-1' }]
        };
      }
      if (options.label === 'production-execution:reconcile:queue-event-count') {
        return { rows: [{ card_id: 'card-queue', event_count: 4 }] };
      }
      return { rows: [] };
    }
  };

  const result = await repository.compareDelayedDefectQueueProjection(tx, {
    id: 'card-queue',
    flow: {
      items: [
        { id: 'item-delay', current: { opId: 'op-1', status: 'DELAYED' } },
        { id: 'item-defect', current: { opId: 'op-1', status: 'DEFECT' } }
      ],
      samples: []
    }
  });

  assert.equal(result.compatible, true);
  assert.deepEqual(result.issues, []);
  assert.equal(result.expected.delayedCount, 1);
  assert.equal(result.expected.defectCount, 1);
  assert.deepEqual(result.actual.detailRoutes.delayed, ['/production/delayed/QR-QUEUE']);
  assert.deepEqual(result.actual.detailRoutes.defects, ['/production/defects/QR-QUEUE']);
  assert.deepEqual(calls.map(call => call.label), [
    'production-execution:reconcile:delays',
    'production-execution:reconcile:defects',
    'production-execution:reconcile:queue-event-count'
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
  const requestUrlSource = storeSource.slice(
    storeSource.indexOf('const requestUrl = normalizedScope === DATA_SCOPE_PRODUCTION'),
    storeSource.indexOf('const promise = (async () => {')
  );
  assert.match(requestUrlSource, /normalizedScope === DATA_SCOPE_DIRECTORIES[\s\S]+\/api\/directories/);
  assert.match(requestUrlSource, /normalizedScope === DATA_SCOPE_CARDS_BASIC[\s\S]+\/api\/cards-core/);
  assert.equal(/LEGACY_SNAPSHOT_READ_PATH\s*\+\s*'\?scope='/.test(requestUrlSource), false);
  const productionBranch = storeSource.slice(
    storeSource.indexOf('normalizedScope === DATA_SCOPE_PRODUCTION'),
    storeSource.indexOf("      : normalizedScope === DATA_SCOPE_DIRECTORIES")
  );
  assert.match(productionBranch, /PRODUCTION_EXECUTION_SCOPE_PATH/);
  assert.equal(/LEGACY_SNAPSHOT_READ_PATH\s*\+\s*'\?scope='/.test(productionBranch), false);
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
  assert.match(compatibility, /\[DATA\] production execution compatibility read/);
  assert.match(compatibility, /mode:\s*'read-only-compatibility'/);

  const legacyGet = serverSource.slice(
    serverSource.indexOf("if (req.method === 'GET' && isLegacySnapshotDataPath(pathname))"),
    serverSource.indexOf("if (req.method === 'POST' && isLegacySnapshotDataPath(pathname))")
  );
  assert.match(legacyGet, /requestedScope === DATA_SCOPE_PRODUCTION && isProductionExecutionSqlSourceEnabled\(\)/);
  assert.match(legacyGet, /buildProductionExecutionCompatibilityScopePayload\(requestedScope\)/);
  assert.match(legacyGet, /\[DATA\] legacy production scope compatibility response/);

  const executionScopeEndpoint = serverSource.slice(
    serverSource.indexOf("if (req.method === 'GET' && pathname === '/api/production/execution/scope')"),
    serverSource.indexOf("if (req.method === 'GET' && pathname === '/api/chat/stream')")
  );
  assert.match(executionScopeEndpoint, /buildProductionExecutionCompatibilityScopePayload\(DATA_SCOPE_PRODUCTION\)/);
  assert.match(executionScopeEndpoint, /\[DATA\] production execution scope response/);
  assert.match(executionScopeEndpoint, /mode:\s*'primary-workspace-refresh'/);
});

test('legacy snapshot POST is disabled after cutover and keeps execution fields protected', () => {
  const serverSource = readRepoFile('server.js');
  assert.match(serverSource, /LEGACY_SNAPSHOT_EXECUTION_COMPATIBILITY_FIELDS/);
  assert.match(serverSource, /'cards\[\]\.flow'/);
  assert.match(serverSource, /'cards\[\]\.personalOperations'/);
  assert.match(serverSource, /'cards\[\]\.materialIssues'/);
  assert.match(serverSource, /'cards\[\]\.materialReturns'/);

  const listProtected = extractFunctionSource(serverSource, 'listLegacySnapshotProtectedSlices');
  assert.match(listProtected, /isProductionExecutionSqlSourceEnabled\(\)/);
  assert.match(listProtected, /LEGACY_SNAPSHOT_EXECUTION_COMPATIBILITY_FIELDS\.forEach/);

  const legacyPost = serverSource.slice(
    serverSource.indexOf("if (req.method === 'POST' && isLegacySnapshotDataPath(pathname))"),
    serverSource.indexOf('function findAttachment')
  );
  assert.match(legacyPost, /LEGACY_SNAPSHOT_WRITE_DISABLED/);
  assert.match(legacyPost, /sendJson\(res,\s*410/);
  assert.match(legacyPost, /mode:\s*'read-only-compatibility'/);
  assert.match(legacyPost, /executionCompatibilityFields/);
  assert.equal(/database\.update|mergeSnapshots|broadcastCardsChanged|broadcastCardMutationEvents/.test(legacyPost), false);
  assert.equal(/buildSqlBackedProductionExecutionData[\s\S]+database\.update/.test(legacyPost), false);
});

test('production execution diagnostics identify SQL write path', () => {
  const serverSource = readRepoFile('server.js');
  const repositorySource = readRepoFile('server/repositories/productionExecutionRepository.js');
  assert.match(repositorySource, /\[DB\] production execution write path start/);
  assert.match(repositorySource, /sqlPath:\s*'production-execution'/);
  assert.match(repositorySource, /commandFamily:\s*'core-workspace-execution'/);
  assert.match(repositorySource, /commandFamily:\s*'delayed-defect-queue'/);
  assert.match(repositorySource, /commandFamily:\s*'repair-dispose'/);

  const workspacePerf = serverSource.slice(
    serverSource.indexOf("const coreWorkspaceExecutionActions = new Set(["),
    serverSource.indexOf("if (req.method === 'POST' && pathname === '/api/production/plan/auto')")
  );
  assert.match(workspacePerf, /\[PERF\]\[WORKSPACE\] write-path/);
  assert.match(workspacePerf, /persistencePath:\s*isProductionExecutionSqlSourceEnabled\(\)\s*\?\s*'sql'\s*:\s*'legacy-json'/);
  assert.match(workspacePerf, /commandFamily:/);
});

test('production execution SQL composer preserves SQL flow revision after read normalization', () => {
  const serverSource = readRepoFile('server.js');
  const composerSource = extractFunctionSource(serverSource, 'buildSqlBackedProductionExecutionData');
  const ensureIndex = composerSource.indexOf('ensureFlowForCards(cardsWithSqlFlow)');
  const authoritativeIndex = composerSource.indexOf('cardsWithAuthoritativeSqlFlow');
  const secondApplyIndex = composerSource.indexOf('repository.applyFlowVersionsToCards', ensureIndex + 1);

  assert.ok(ensureIndex > -1);
  assert.ok(authoritativeIndex > ensureIndex);
  assert.ok(secondApplyIndex > ensureIndex);
  assert.match(composerSource, /cards:\s*cardsWithAuthoritativeSqlFlow/);
});

test('production execution compatibility removal path is documented', () => {
  const doc = readRepoFile('docs/architecture/mysql-84-stage8-execution-compatibility-removal-path.md');
  assert.match(doc, /cards\[\]\.flow/);
  assert.match(doc, /cards\[\]\.personalOperations/);
  assert.match(doc, /cards\[\]\.materialIssues/);
  assert.match(doc, /cards\[\]\.materialReturns/);
  assert.match(doc, /GET \/api\/production\/execution\/scope/);
  assert.match(doc, /GET \/api\/data\?scope=production/);
  assert.match(doc, /POST \/api\/data/);
  assert.match(doc, /Stage 13/);
  assert.match(doc, /Stage 15/);
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

test('delayed and defect endpoints stay on queue family while repair and dispose use SQL repair-dispose family', () => {
  const serverSource = readRepoFile('server.js');
  const persistBoundary = extractFunctionSource(serverSource, 'persistProductionExecutionMutation');
  assert.match(persistBoundary, /commandFamily === 'delayed-defect-queue'/);
  assert.match(persistBoundary, /executionRepository\.persistDelayedDefectQueueCommand/);
  assert.match(persistBoundary, /commandFamily === 'repair-dispose'/);
  assert.match(persistBoundary, /executionRepository\.persistRepairDisposeCommand/);

  const returnEndpoint = serverSource.slice(
    serverSource.indexOf("if (req.method === 'POST' && pathname === '/api/production/flow/return')"),
    serverSource.indexOf("if (req.method === 'POST' && pathname === '/api/production/flow/defect')")
  );
  const defectEndpoint = serverSource.slice(
    serverSource.indexOf("if (req.method === 'POST' && pathname === '/api/production/flow/defect')"),
    serverSource.indexOf("if (req.method === 'POST' && pathname === '/api/production/flow/repair/check')")
  );
  const repairDisposeEndpoints = serverSource.slice(
    serverSource.indexOf("if (req.method === 'POST' && pathname === '/api/production/flow/repair/check')"),
    serverSource.indexOf("if (req.method === 'POST' && pathname === '/api/production/plan/auto')")
  );

  assert.match(returnEndpoint, /commandFamily:\s*'delayed-defect-queue'/);
  assert.match(returnEndpoint, /queueCommand:\s*{[\s\S]+action:\s*'return'/);
  assert.match(defectEndpoint, /commandFamily:\s*'delayed-defect-queue'/);
  assert.match(defectEndpoint, /queueCommand:\s*{[\s\S]+action:\s*'defect'/);
  assert.equal(/commandFamily:\s*'delayed-defect-queue'/.test(repairDisposeEndpoints), false);
  assert.match(repairDisposeEndpoints, /commandFamily:\s*'repair-dispose'/);
  assert.match(repairDisposeEndpoints, /repairDisposeCommand:\s*{[\s\S]+action:\s*'repair'/);
  assert.match(repairDisposeEndpoints, /repairDisposeCommand:\s*{[\s\S]+action:\s*'dispose'/);
  assert.equal(/production_repairs|production_disposals/.test(returnEndpoint + defectEndpoint), false);
});
