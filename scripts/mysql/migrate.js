const { runMysqlMigrations } = require('../../server/persistence/mysql/migrations/runner');

async function main() {
  const result = await runMysqlMigrations();
  console.info('[DB] migrations complete', result);
}

main().catch((error) => {
  console.error('[DB] migrations failed', {
    code: error?.code || error?.errno || 'UNKNOWN',
    message: error?.message || String(error)
  });
  process.exitCode = 1;
});
