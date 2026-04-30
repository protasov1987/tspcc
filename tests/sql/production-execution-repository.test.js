const test = require('node:test');
const assert = require('node:assert/strict');
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
  assert.ok(calls.some(call => call.label === 'production-execution:flow-event:insert'));
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

test('card execution projection does not delete card operations and cascade flow history', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../server/repositories/cardsRepository.js'), 'utf8');
  const methodSource = source.slice(source.indexOf('async writeCardExecutionProjection'));
  assert.ok(methodSource.includes('ON DUPLICATE KEY UPDATE'));
  assert.equal(/DELETE\s+FROM\s+card_operations/i.test(methodSource), false);
});

test('production scope client refresh uses production execution endpoint instead of legacy snapshot scope', () => {
  const stateSource = fs.readFileSync(path.join(__dirname, '../../js/app.00.state.js'), 'utf8');
  const storeSource = fs.readFileSync(path.join(__dirname, '../../js/app.40.store.js'), 'utf8');
  assert.match(stateSource, /PRODUCTION_EXECUTION_SCOPE_PATH\s*=\s*'\/api\/production\/execution\/scope'/);
  assert.match(storeSource, /normalizedScope === DATA_SCOPE_PRODUCTION[\s\S]+PRODUCTION_EXECUTION_SCOPE_PATH/);
});
