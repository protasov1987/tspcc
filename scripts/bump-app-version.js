const fs = require('fs');
const path = require('path');
const {
  STYLE_START_MARKER,
  STYLE_END_MARKER,
  SCRIPT_START_MARKER,
  SCRIPT_END_MARKER,
  STYLE_ASSET_PATHS,
  SCRIPT_ASSET_PATHS
} = require('./asset-manifest');

const VERSION_PATH = path.join(__dirname, '..', 'app-version.json');
const INDEX_PATH = path.join(__dirname, '..', 'index.html');

function pad(part) {
  return String(part).padStart(2, '0');
}

function formatMajor(meta) {
  if (meta.stage === 'Betta') return pad(meta.major);
  return String(meta.major);
}

function formatVersion(meta) {
  return `${formatMajor(meta)}.${pad(meta.minor)}.${pad(meta.patch)}`;
}

function formatFooter(meta) {
  return `${meta.productName} ${meta.stage} v ${formatVersion(meta)} mail to: ${meta.email}`;
}

function renderStyleAssetBlock(meta) {
  const version = formatVersion(meta);
  const lines = [STYLE_START_MARKER];
  STYLE_ASSET_PATHS.forEach((assetPath) => {
    lines.push(`  <link rel="stylesheet" href="${assetPath}?v=${version}" />`);
  });
  lines.push(`  ${STYLE_END_MARKER}`);
  return lines.join('\n');
}

function renderScriptAssetBlock(meta) {
  const version = formatVersion(meta);
  const lines = [SCRIPT_START_MARKER];
  SCRIPT_ASSET_PATHS.forEach((assetPath) => {
    lines.push(`  <script src="${assetPath}?v=${version}" defer></script>`);
  });
  lines.push(`  ${SCRIPT_END_MARKER}`);
  return lines.join('\n');
}

function replaceBlock(source, startMarker, endMarker, nextBlock) {
  const startIndex = source.indexOf(startMarker);
  const endIndex = source.indexOf(endMarker);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(`Unable to locate asset block markers: ${startMarker} .. ${endMarker}`);
  }
  const afterEnd = endIndex + endMarker.length;
  return source.slice(0, startIndex) + nextBlock + source.slice(afterEnd);
}

function syncIndexAssetVersion(meta) {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const withStyles = replaceBlock(html, STYLE_START_MARKER, STYLE_END_MARKER, renderStyleAssetBlock(meta));
  const withScripts = replaceBlock(withStyles, SCRIPT_START_MARKER, SCRIPT_END_MARKER, renderScriptAssetBlock(meta));
  fs.writeFileSync(INDEX_PATH, withScripts, 'utf8');
}

function readVersionMeta() {
  return JSON.parse(fs.readFileSync(VERSION_PATH, 'utf8'));
}

function writeVersionMeta(meta) {
  fs.writeFileSync(VERSION_PATH, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
}

function bumpVersion(meta) {
  const next = { ...meta };

  if (next.patch < 99) {
    next.patch += 1;
    return next;
  }

  next.patch = 0;
  if (next.minor < 99) {
    next.minor += 1;
    return next;
  }

  next.minor = 0;
  if (next.major < 99) {
    next.major += 1;
    return next;
  }

  if (next.stage === 'Alpha') {
    next.stage = 'Betta';
    next.major = 0;
    next.minor = 0;
    next.patch = 1;
    return next;
  }

  throw new Error(`Version limit reached for stage "${next.stage}"`);
}

const current = readVersionMeta();
const next = bumpVersion(current);
writeVersionMeta(next);
syncIndexAssetVersion(next);
process.stdout.write(`${formatFooter(next)}\n`);
