const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertIdentifierPart(part) {
  const value = String(part || '').trim();
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`Unsafe SQL identifier part: ${value || '<empty>'}`);
  }
  return value;
}

function quoteIdentifierPart(part) {
  return `\`${assertIdentifierPart(part)}\``;
}

function createIdentifierAllowlist(mapping) {
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
    throw new Error('Identifier allowlist mapping must be an object.');
  }
  const normalized = {};
  for (const [key, value] of Object.entries(mapping)) {
    const parts = Array.isArray(value) ? value : String(value).split('.');
    normalized[key] = parts.map(assertIdentifierPart);
  }
  return Object.freeze(normalized);
}

function sqlIdentifier(name, allowlist) {
  const parts = allowlist?.[name];
  if (!parts) {
    throw new Error(`SQL identifier is not allowlisted: ${String(name || '')}`);
  }
  return parts.map(quoteIdentifierPart).join('.');
}

function sqlDirection(value) {
  const direction = String(value || 'ASC').trim().toUpperCase();
  if (direction !== 'ASC' && direction !== 'DESC') {
    throw new Error('SQL direction must be ASC or DESC.');
  }
  return direction;
}

function sqlLimit(value, options = {}) {
  const max = Number.isSafeInteger(options.max) && options.max > 0 ? options.max : 500;
  const min = Number.isSafeInteger(options.min) && options.min >= 0 ? options.min : 0;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`SQL limit must be an integer from ${min} to ${max}.`);
  }
  return parsed;
}

module.exports = {
  createIdentifierAllowlist,
  sqlDirection,
  sqlIdentifier,
  sqlLimit
};
