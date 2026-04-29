const { sqlDirection, sqlIdentifier, sqlLimit } = require('./identifiers');

function durationBucket(ms) {
  if (ms < 10) return '<10ms';
  if (ms < 50) return '10-49ms';
  if (ms < 100) return '50-99ms';
  if (ms < 250) return '100-249ms';
  if (ms < 1000) return '250-999ms';
  return '>=1000ms';
}

function logDb(message, details) {
  if (details) {
    console.info(`[DB] ${message}`, details);
    return;
  }
  console.info(`[DB] ${message}`);
}

function assertParameterizedValues(values) {
  if (values == null) return [];
  if (!Array.isArray(values)) {
    throw new Error('SQL query values must be passed as an array.');
  }
  return values;
}

function assertSqlShape(sql) {
  const text = String(sql || '').trim();
  if (!text) {
    throw new Error('SQL query text is required.');
  }
  if (/\$\{[^}]+\}/.test(text)) {
    throw new Error('SQL query text must not contain template interpolation markers.');
  }
  return text;
}

async function executeQuery(target, options) {
  if (!target || typeof target.execute !== 'function') {
    throw new Error('SQL query target must expose execute(sql, values).');
  }
  const sql = assertSqlShape(options?.sql);
  const values = assertParameterizedValues(options?.values);
  const label = options?.label || 'query';
  const domain = options?.domain || 'foundation';
  const started = Date.now();
  try {
    const [rows, fields] = await target.execute(sql, values);
    const durationMs = Date.now() - started;
    logDb('query complete', {
      label,
      domain,
      duration: durationBucket(durationMs)
    });
    return { rows, fields, durationMs };
  } catch (error) {
    const durationMs = Date.now() - started;
    logDb('query failed', {
      label,
      domain,
      duration: durationBucket(durationMs),
      code: error?.code || error?.errno || 'UNKNOWN'
    });
    throw error;
  }
}

function buildOrderBy(options) {
  const identifier = sqlIdentifier(options?.field, options?.allowlist);
  const direction = sqlDirection(options?.direction);
  return `${identifier} ${direction}`;
}

function buildLimit(value, options) {
  return String(sqlLimit(value, options));
}

module.exports = {
  buildLimit,
  buildOrderBy,
  durationBucket,
  executeQuery
};
