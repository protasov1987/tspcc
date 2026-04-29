const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const {
  DEFAULT_MIGRATIONS_DIR,
  parseMigrationMetadata,
  readMigrationFiles,
  runMysqlMigrations,
  splitSqlStatements
} = require('../../server/persistence/mysql/migrations/runner');

test('migration SQL splitter keeps semicolons inside quoted values', () => {
  const statements = splitSqlStatements(`
    CREATE TABLE sample (id INT PRIMARY KEY, note VARCHAR(255) DEFAULT 'a;b');
    INSERT INTO sample (id, note) VALUES (1, "x;y");
  `);
  assert.equal(statements.length, 2);
  assert.match(statements[0], /CREATE TABLE sample/);
  assert.match(statements[1], /INSERT INTO sample/);
});

test('migration metadata is required for history descriptions', () => {
  const metadata = parseMigrationMetadata(`
-- @purpose: Create test shape.
-- @domain: test
-- @business_impact: No runtime impact.
-- @rollback: Restore backup.
CREATE TABLE t (id INT PRIMARY KEY);
`, '999_test');
  assert.equal(metadata.domain, 'test');
  assert.match(metadata.businessImpact, /No runtime/);
  assert.throws(
    () => parseMigrationMetadata('-- @purpose: Missing metadata', 'bad'),
    /missing @domain/
  );
});

test('repository migrations cover Stage 3 domains and avoid forbidden whole-site JSON model', async () => {
  const migrations = await readMigrationFiles();
  const allSql = migrations.map((migration) => migration.sql).join('\n').toLowerCase();
  const tableNames = new Set();
  const createTableRegex = /\bcreate\s+table\s+([a-z0-9_]+)/g;
  for (const match of allSql.matchAll(createTableRegex)) {
    tableNames.add(match[1]);
  }

  for (const requiredTable of [
    'schema_migrations',
    'cards',
    'card_operations',
    'card_serials',
    'card_quantities',
    'card_attachments',
    'work_centers',
    'operations',
    'operation_allowed_areas',
    'production_areas',
    'production_shift_times',
    'users',
    'access_levels',
    'user_sessions',
    'production_schedule',
    'production_shift_tasks',
    'production_shifts',
    'production_flow_states',
    'production_flow_events',
    'personal_operations',
    'production_material_issues',
    'production_material_returns',
    'production_drying_records',
    'production_delays',
    'production_defects',
    'production_repairs',
    'production_disposals',
    'card_flow_projection',
    'chat_conversations',
    'chat_conversation_participants',
    'chat_messages',
    'chat_message_states',
    'user_visits',
    'web_push_subscriptions',
    'fcm_tokens',
    'user_actions',
    'audit_events',
    'outbox_events'
  ]) {
    if (requiredTable === 'schema_migrations') continue;
    assert.equal(tableNames.has(requiredTable), true, `${requiredTable} table is missing`);
  }

  assert.doesNotMatch(allSql, /\bcreate\s+table\s+app_data\b/);
  assert.doesNotMatch(allSql, /\bcreate\s+table\s+.*\(\s*(cards|users|production|messages)\s+json\b/);
  assert.match(allSql, /\bview\s+workorders_read_model\b/);
  assert.match(allSql, /\bview\s+archive_read_model\b/);
  assert.match(allSql, /\bview\s+production_items_read_model\b/);
  assert.match(allSql, /\bview\s+production_ok_read_model\b/);
  assert.match(allSql, /\bview\s+production_oc_read_model\b/);
});

test('all migration files have forward-only description metadata', async () => {
  const migrations = await readMigrationFiles();
  assert.equal(migrations.length >= 5, true);
  for (const migration of migrations) {
    assert.match(migration.metadata.purpose, /\S/);
    assert.match(migration.metadata.domain, /\S/);
    assert.match(migration.metadata.businessImpact, /No runtime business behavior changes/i);
    assert.match(migration.metadata.rollback, /Forward-only/i);
    assert.equal(migration.statements.length > 0, true);
  }
});

test('optional local/test migration run uses the same repository migrations', async (t) => {
  if (String(process.env.TSPCC_SQL_MIGRATION_TEST || '').trim() !== '1') {
    t.skip('Set TSPCC_SQL_MIGRATION_TEST=1 with TSPCC_DB_MIGRATION_* for a clean local/test DB migration run.');
    return;
  }

  const result = await runMysqlMigrations();
  assert.equal(result.total > 0, true);
  const rerun = await runMysqlMigrations();
  assert.equal(rerun.applied.length, 0);
});

test('migration directory exists at the documented Stage 3 location', async () => {
  const stat = await fs.stat(path.resolve(DEFAULT_MIGRATIONS_DIR));
  assert.equal(stat.isDirectory(), true);
});
