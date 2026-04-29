const DEFAULTS = Object.freeze({
  host: '127.0.0.1',
  port: 3306,
  database: 'tspcc_bd',
  user: 'tspcc_app',
  connectionLimit: 10,
  ssl: 'disabled'
});

const ALLOWED_SSL_MODES = new Set(['disabled', 'required', 'custom']);
const ENV_KEYS = Object.freeze([
  'TSPCC_DB_HOST',
  'TSPCC_DB_PORT',
  'TSPCC_DB_NAME',
  'TSPCC_DB_USER',
  'TSPCC_DB_PASSWORD',
  'TSPCC_DB_CONNECTION_LIMIT',
  'TSPCC_DB_SSL'
]);
const MIGRATION_ENV_KEYS = Object.freeze([
  'TSPCC_DB_HOST',
  'TSPCC_DB_PORT',
  'TSPCC_DB_NAME',
  'TSPCC_DB_MIGRATION_USER',
  'TSPCC_DB_MIGRATION_PASSWORD',
  'TSPCC_DB_CONNECTION_LIMIT',
  'TSPCC_DB_SSL'
]);

function readEnv(env, key) {
  const value = env[key];
  return typeof value === 'string' ? value.trim() : '';
}

function parsePositiveInteger(value, key) {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${key} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer.`);
  }
  return parsed;
}

function assertNonEmpty(value, key) {
  if (!value || /^<.*>$/.test(value)) {
    throw new Error(`${key} is required and must not be a placeholder.`);
  }
}

function normalizeSslMode(mode) {
  const normalized = (mode || DEFAULTS.ssl).toLowerCase();
  if (!ALLOWED_SSL_MODES.has(normalized)) {
    throw new Error('TSPCC_DB_SSL must be one of: disabled, required, custom.');
  }
  return normalized;
}

function readMysqlEnv(options = {}) {
  const env = options.env || process.env;
  const requirePassword = options.requirePassword !== false;
  const host = readEnv(env, 'TSPCC_DB_HOST') || DEFAULTS.host;
  const port = parsePositiveInteger(readEnv(env, 'TSPCC_DB_PORT') || String(DEFAULTS.port), 'TSPCC_DB_PORT');
  const database = readEnv(env, 'TSPCC_DB_NAME') || DEFAULTS.database;
  const user = readEnv(env, 'TSPCC_DB_USER') || DEFAULTS.user;
  const password = readEnv(env, 'TSPCC_DB_PASSWORD');
  const connectionLimit = parsePositiveInteger(
    readEnv(env, 'TSPCC_DB_CONNECTION_LIMIT') || String(DEFAULTS.connectionLimit),
    'TSPCC_DB_CONNECTION_LIMIT'
  );
  const ssl = normalizeSslMode(readEnv(env, 'TSPCC_DB_SSL') || DEFAULTS.ssl);

  assertNonEmpty(host, 'TSPCC_DB_HOST');
  assertNonEmpty(database, 'TSPCC_DB_NAME');
  assertNonEmpty(user, 'TSPCC_DB_USER');
  if (requirePassword) {
    assertNonEmpty(password, 'TSPCC_DB_PASSWORD');
  }

  return {
    host,
    port,
    database,
    user,
    password,
    connectionLimit,
    ssl
  };
}

function readMysqlMigrationEnv(options = {}) {
  const env = options.env || process.env;
  const host = readEnv(env, 'TSPCC_DB_HOST') || DEFAULTS.host;
  const port = parsePositiveInteger(readEnv(env, 'TSPCC_DB_PORT') || String(DEFAULTS.port), 'TSPCC_DB_PORT');
  const database = readEnv(env, 'TSPCC_DB_NAME') || DEFAULTS.database;
  const user = readEnv(env, 'TSPCC_DB_MIGRATION_USER');
  const password = readEnv(env, 'TSPCC_DB_MIGRATION_PASSWORD');
  const connectionLimit = parsePositiveInteger(
    readEnv(env, 'TSPCC_DB_CONNECTION_LIMIT') || String(DEFAULTS.connectionLimit),
    'TSPCC_DB_CONNECTION_LIMIT'
  );
  const ssl = normalizeSslMode(readEnv(env, 'TSPCC_DB_SSL') || DEFAULTS.ssl);
  const runtimeUser = readEnv(env, 'TSPCC_DB_USER') || DEFAULTS.user;

  assertNonEmpty(host, 'TSPCC_DB_HOST');
  assertNonEmpty(database, 'TSPCC_DB_NAME');
  assertNonEmpty(user, 'TSPCC_DB_MIGRATION_USER');
  assertNonEmpty(password, 'TSPCC_DB_MIGRATION_PASSWORD');
  if (user === runtimeUser) {
    throw new Error('TSPCC_DB_MIGRATION_USER must be separate from TSPCC_DB_USER.');
  }

  return {
    host,
    port,
    database,
    user,
    password,
    connectionLimit,
    ssl
  };
}

function toMysql2PoolOptions(config) {
  const ssl = config.ssl === 'disabled'
    ? undefined
    : { rejectUnauthorized: config.ssl !== 'custom' };
  return {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    waitForConnections: true,
    connectionLimit: config.connectionLimit,
    queueLimit: 0,
    charset: 'utf8mb4',
    timezone: 'Z',
    ssl
  };
}

module.exports = {
  ALLOWED_SSL_MODES,
  DEFAULTS,
  ENV_KEYS,
  MIGRATION_ENV_KEYS,
  readMysqlEnv,
  readMysqlMigrationEnv,
  toMysql2PoolOptions
};
