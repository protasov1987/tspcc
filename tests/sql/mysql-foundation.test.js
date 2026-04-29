const test = require('node:test');
const assert = require('node:assert/strict');

const { readMysqlEnv } = require('../../server/persistence/mysql/env');
const {
  createIdentifierAllowlist,
  sqlDirection,
  sqlIdentifier,
  sqlLimit
} = require('../../server/persistence/mysql/identifiers');
const { buildOrderBy, executeQuery } = require('../../server/persistence/mysql/query');
const { createSqlConflict, isSqlConflict, toHttpConflictPayload } = require('../../server/persistence/mysql/conflicts');
const { classifyDbError, withTransaction } = require('../../server/persistence/mysql/transaction');
const { closeMysqlPool, isSqlLocalTestSignal, mysqlHealthCheck } = require('../../server/persistence/mysql/pool');

test('readMysqlEnv validates Stage 1 runtime env without secrets in code', () => {
  const config = readMysqlEnv({
    env: {
      TSPCC_DB_HOST: '127.0.0.1',
      TSPCC_DB_PORT: '3306',
      TSPCC_DB_NAME: 'tspcc_bd',
      TSPCC_DB_USER: 'tspcc_app',
      TSPCC_DB_PASSWORD: 'local-secret',
      TSPCC_DB_CONNECTION_LIMIT: '10',
      TSPCC_DB_SSL: 'disabled'
    }
  });
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3306);
  assert.equal(config.database, 'tspcc_bd');
  assert.equal(config.user, 'tspcc_app');
  assert.equal(config.connectionLimit, 10);
  assert.equal(config.ssl, 'disabled');
});

test('readMysqlEnv rejects invalid port, placeholder password, and ssl mode', () => {
  assert.throws(() => readMysqlEnv({ env: { TSPCC_DB_PORT: 'nope', TSPCC_DB_PASSWORD: 'x' } }), /TSPCC_DB_PORT/);
  assert.throws(() => readMysqlEnv({ env: { TSPCC_DB_PASSWORD: '<secret>' } }), /TSPCC_DB_PASSWORD/);
  assert.throws(() => readMysqlEnv({ env: { TSPCC_DB_PASSWORD: 'x', TSPCC_DB_SSL: 'sometimes' } }), /TSPCC_DB_SSL/);
});

test('identifier helpers allow only mapped identifiers and safe directions', () => {
  const allowlist = createIdentifierAllowlist({
    created: ['cards', 'created_at'],
    name: 'users.display_name'
  });
  assert.equal(sqlIdentifier('created', allowlist), '`cards`.`created_at`');
  assert.equal(buildOrderBy({ field: 'name', direction: 'desc', allowlist }), '`users`.`display_name` DESC');
  assert.equal(sqlDirection('ASC'), 'ASC');
  assert.equal(sqlLimit(25, { max: 50 }), 25);
  assert.throws(() => sqlIdentifier('missing', allowlist), /not allowlisted/);
  assert.throws(() => createIdentifierAllowlist({ bad: 'cards;DROP' }), /Unsafe SQL identifier/);
  assert.throws(() => sqlDirection('sideways'), /ASC or DESC/);
});

test('executeQuery requires array parameters and rejects interpolation markers', async () => {
  const target = {
    async execute(sql, values) {
      assert.equal(sql, 'SELECT ? AS value');
      assert.deepEqual(values, [1]);
      return [[{ value: 1 }], []];
    }
  };
  const result = await executeQuery(target, { sql: 'SELECT ? AS value', values: [1], label: 'unit' });
  assert.deepEqual(result.rows, [{ value: 1 }]);
  await assert.rejects(() => executeQuery(target, { sql: 'SELECT ${bad}', values: [] }), /interpolation/);
  await assert.rejects(() => executeQuery(target, { sql: 'SELECT ?', values: 1 }), /array/);
});

test('transaction helper commits and rolls back using provided connection', async () => {
  const calls = [];
  const connection = {
    async beginTransaction() { calls.push('begin'); },
    async commit() { calls.push('commit'); },
    async rollback() { calls.push('rollback'); }
  };
  const success = await withTransaction(async () => 'ok', { connection, label: 'unit' });
  assert.equal(success, 'ok');
  assert.deepEqual(calls, ['begin', 'commit']);

  await assert.rejects(
    () => withTransaction(async () => {
      throw Object.assign(new Error('deadlock'), { code: 'ER_LOCK_DEADLOCK', errno: 1213 });
    }, { connection, label: 'unit' }),
    /deadlock/
  );
  assert.deepEqual(calls, ['begin', 'commit', 'begin', 'rollback']);
});

test('transaction helper retries only explicit idempotent transient failures', async () => {
  let attempts = 0;
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {}
  };
  const result = await withTransaction(async () => {
    attempts += 1;
    if (attempts === 1) {
      throw Object.assign(new Error('timeout'), { code: 'ER_LOCK_WAIT_TIMEOUT', errno: 1205 });
    }
    return attempts;
  }, { connection, retries: 1, idempotent: true, label: 'retry-unit' });
  assert.equal(result, 2);
});

test('deadlock and lock timeout classification is explicit', () => {
  assert.deepEqual(classifyDbError({ code: 'ER_LOCK_DEADLOCK', errno: 1213 }), { type: 'deadlock', retryable: true });
  assert.deepEqual(classifyDbError({ code: 'ER_LOCK_WAIT_TIMEOUT', errno: 1205 }), { type: 'lock-timeout', retryable: true });
  assert.deepEqual(classifyDbError({ code: 'ER_PARSE_ERROR' }), { type: 'other', retryable: false });
});

test('SQL conflict helper matches current 409 contract shape', () => {
  const conflict = createSqlConflict({
    entity: 'card',
    id: 'card-1',
    expectedRev: 2,
    actualRev: 3
  });
  assert.equal(conflict.statusCode, 409);
  assert.equal(isSqlConflict(conflict), true);
  assert.deepEqual(toHttpConflictPayload(conflict), {
    code: 'REVISION_CONFLICT',
    entity: 'card',
    id: 'card-1',
    expectedRev: 2,
    actualRev: 3,
    message: conflict.message,
    error: conflict.error
  });
});

test('local/test health check signal is explicit', () => {
  assert.equal(isSqlLocalTestSignal({ TSPCC_SQL_TEST: '1' }), true);
  assert.equal(isSqlLocalTestSignal({ NODE_ENV: 'test' }), true);
  assert.equal(isSqlLocalTestSignal({ NODE_ENV: 'production' }), false);
});

test('optional MySQL health query runs only when TSPCC_SQL_TEST=1', async (t) => {
  if (String(process.env.TSPCC_SQL_TEST || '').trim() !== '1') {
    t.skip('Set TSPCC_SQL_TEST=1 and TSPCC_DB_* env to run local/test MySQL health query.');
    return;
  }
  const result = await mysqlHealthCheck();
  assert.equal(result.ok, true);
  await closeMysqlPool();
});
