const mysql = require('mysql2/promise');
const { readMysqlEnv, toMysql2PoolOptions } = require('./env');
const { executeQuery } = require('./query');

let pool;
let poolConfig;

function logDb(message, details) {
  if (details) {
    console.info(`[DB] ${message}`, details);
    return;
  }
  console.info(`[DB] ${message}`);
}

function getMysqlPool(options = {}) {
  if (pool) return pool;
  poolConfig = readMysqlEnv(options);
  pool = mysql.createPool(toMysql2PoolOptions(poolConfig));
  logDb('pool created', {
    host: poolConfig.host,
    port: poolConfig.port,
    database: poolConfig.database,
    user: poolConfig.user,
    connectionLimit: poolConfig.connectionLimit,
    ssl: poolConfig.ssl
  });
  return pool;
}

async function closeMysqlPool() {
  if (!pool) return;
  const closingPool = pool;
  pool = undefined;
  poolConfig = undefined;
  await closingPool.end();
  logDb('pool closed');
}

function isSqlLocalTestSignal(env = process.env) {
  const explicit = String(env.TSPCC_SQL_TEST || '').trim() === '1';
  const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();
  return explicit || nodeEnv === 'test';
}

async function mysqlHealthCheck(options = {}) {
  if (!options.allowOutsideLocalTest && !isSqlLocalTestSignal(options.env || process.env)) {
    throw new Error('MySQL health check requires TSPCC_SQL_TEST=1 or NODE_ENV=test.');
  }
  const activePool = options.pool || getMysqlPool(options);
  const result = await executeQuery(activePool, {
    sql: 'SELECT 1 AS ok',
    values: [],
    label: 'mysql-health',
    domain: 'foundation'
  });
  const ok = Array.isArray(result.rows) && Number(result.rows[0]?.ok) === 1;
  logDb('health result', { ok });
  return { ok, rows: result.rows, durationMs: result.durationMs };
}

module.exports = {
  closeMysqlPool,
  getMysqlPool,
  isSqlLocalTestSignal,
  mysqlHealthCheck
};
