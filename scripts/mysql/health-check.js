const { closeMysqlPool, mysqlHealthCheck } = require('../../server/persistence/mysql/pool');

async function main() {
  if (String(process.env.TSPCC_SQL_TEST || '').trim() !== '1' && String(process.env.NODE_ENV || '').trim() !== 'test') {
    throw new Error('Set TSPCC_SQL_TEST=1 for local/test MySQL health checks.');
  }
  const result = await mysqlHealthCheck();
  if (!result.ok) {
    throw new Error('MySQL health check returned an unexpected result.');
  }
}

main()
  .catch((error) => {
    console.error('[DB] health failed', {
      code: error?.code || error?.errno || 'UNKNOWN',
      message: error?.message || String(error)
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMysqlPool();
  });
