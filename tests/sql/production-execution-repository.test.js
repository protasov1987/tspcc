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
  assert.equal(/database\.update\s*\(/.test(executionCommands), false);

  const persistBoundary = extractFunctionSource(serverSource, 'persistProductionExecutionMutation');
  assert.match(persistBoundary, /cardsRepository\.inTransaction/);
  assert.match(persistBoundary, /cardsRepository\.writeCardExecutionProjection\(tx, card\)/);
  assert.match(persistBoundary, /executionRepository\.syncFlowStateFromCard\(tx, card/);
});
