const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const { readMysqlMigrationEnv } = require('../env');
const { createMysqlPoolFromConfig } = require('../pool');
const { executeQuery } = require('../query');

const DEFAULT_MIGRATIONS_DIR = path.resolve(__dirname, '../../../../migrations/mysql');
const HISTORY_TABLE = 'schema_migrations';

function logDb(message, details) {
  if (details) {
    console.info(`[DB] ${message}`, details);
    return;
  }
  console.info(`[DB] ${message}`);
}

function checksumSql(sql) {
  return crypto.createHash('sha256').update(sql, 'utf8').digest('hex');
}

function splitSqlStatements(sql) {
  const statements = [];
  let current = '';
  let quote = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];

    if (lineComment) {
      current += char;
      if (char === '\n') lineComment = false;
      continue;
    }

    if (blockComment) {
      current += char;
      if (char === '*' && next === '/') {
        current += next;
        index += 1;
        blockComment = false;
      }
      continue;
    }

    if (quote) {
      current += char;
      if (char === '\\' && quote !== '`' && next) {
        current += next;
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }

    if (char === '-' && next === '-') {
      current += char;
      current += next;
      index += 1;
      lineComment = true;
      continue;
    }

    if (char === '/' && next === '*') {
      current += char;
      current += next;
      index += 1;
      blockComment = true;
      continue;
    }

    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      current += char;
      continue;
    }

    if (char === ';') {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = '';
      continue;
    }

    current += char;
  }

  const trailing = current.trim();
  if (trailing) statements.push(trailing);
  return statements;
}

function parseMigrationMetadata(sql, version) {
  const metadata = {};
  const lines = String(sql || '').split(/\r?\n/);
  for (const line of lines) {
    const match = /^--\s*@([a-z_]+):\s*(.+?)\s*$/.exec(line);
    if (!match) continue;
    metadata[match[1]] = match[2];
  }

  const required = ['purpose', 'domain', 'business_impact', 'rollback'];
  for (const key of required) {
    if (!metadata[key]) {
      throw new Error(`Migration ${version} is missing @${key} metadata.`);
    }
  }

  return Object.freeze({
    purpose: metadata.purpose,
    domain: metadata.domain,
    businessImpact: metadata.business_impact,
    rollback: metadata.rollback
  });
}

async function readMigrationFiles(options = {}) {
  const migrationsDir = options.migrationsDir || DEFAULT_MIGRATIONS_DIR;
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /^\d{3,}_.+\.sql$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  if (files.length === 0) {
    throw new Error(`No MySQL migrations found in ${migrationsDir}.`);
  }

  const migrations = [];
  for (const fileName of files) {
    const filePath = path.join(migrationsDir, fileName);
    const sql = await fs.readFile(filePath, 'utf8');
    const version = fileName.replace(/\.sql$/i, '');
    const metadata = parseMigrationMetadata(sql, version);
    migrations.push(Object.freeze({
      version,
      fileName,
      filePath,
      sql,
      checksum: checksumSql(sql),
      metadata,
      statements: splitSqlStatements(sql)
    }));
  }

  return migrations;
}

async function ensureMigrationHistory(pool) {
  const existing = await executeQuery(pool, {
    sql: `
      SELECT COUNT(*) AS count
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = ?
    `,
    values: [HISTORY_TABLE],
    label: 'schema-migrations-check',
    domain: 'migration'
  });
  const exists = Number(existing.rows[0]?.count || 0) > 0;
  if (exists) return;

  await executeQuery(pool, {
    sql: `
      CREATE TABLE schema_migrations (
        version VARCHAR(190) NOT NULL,
        checksum CHAR(64) NOT NULL,
        purpose TEXT NOT NULL,
        domain VARCHAR(190) NOT NULL,
        business_impact TEXT NOT NULL,
        rollback_expectation TEXT NOT NULL,
        applied_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
        PRIMARY KEY (version)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `,
    values: [],
    label: 'schema-migrations-create',
    domain: 'migration'
  });
}

async function readAppliedMigrations(pool) {
  const result = await executeQuery(pool, {
    sql: 'SELECT version, checksum FROM schema_migrations ORDER BY version',
    values: [],
    label: 'schema-migrations-read',
    domain: 'migration'
  });
  return new Map(result.rows.map((row) => [row.version, row.checksum]));
}

async function applyMigration(pool, migration) {
  logDb('migration apply start', {
    version: migration.version,
    domain: migration.metadata.domain
  });

  for (let index = 0; index < migration.statements.length; index += 1) {
    await executeQuery(pool, {
      sql: migration.statements[index],
      values: [],
      label: `${migration.version}:${index + 1}`,
      domain: 'migration'
    });
  }

  await executeQuery(pool, {
    sql: `
      INSERT INTO schema_migrations (
        version,
        checksum,
        purpose,
        domain,
        business_impact,
        rollback_expectation
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
    values: [
      migration.version,
      migration.checksum,
      migration.metadata.purpose,
      migration.metadata.domain,
      migration.metadata.businessImpact,
      migration.metadata.rollback
    ],
    label: `${migration.version}:record`,
    domain: 'migration'
  });

  logDb('migration apply complete', {
    version: migration.version
  });
}

async function runMysqlMigrations(options = {}) {
  const pool = options.pool || createMysqlPoolFromConfig(readMysqlMigrationEnv(options));
  const shouldClose = !options.pool;
  try {
    const migrations = options.migrations || await readMigrationFiles(options);
    await ensureMigrationHistory(pool);
    const applied = await readAppliedMigrations(pool);
    const pending = [];

    for (const migration of migrations) {
      const appliedChecksum = applied.get(migration.version);
      if (!appliedChecksum) {
        pending.push(migration);
        continue;
      }
      if (appliedChecksum !== migration.checksum) {
        throw new Error(`Applied migration ${migration.version} checksum differs from repository migration.`);
      }
    }

    for (const migration of pending) {
      await applyMigration(pool, migration);
    }

    return {
      applied: pending.map((migration) => migration.version),
      skipped: migrations.length - pending.length,
      total: migrations.length
    };
  } finally {
    if (shouldClose) {
      await pool.end();
    }
  }
}

module.exports = {
  DEFAULT_MIGRATIONS_DIR,
  HISTORY_TABLE,
  checksumSql,
  ensureMigrationHistory,
  parseMigrationMetadata,
  readMigrationFiles,
  runMysqlMigrations,
  splitSqlStatements
};
