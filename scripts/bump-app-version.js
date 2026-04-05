const fs = require('fs');
const path = require('path');

const VERSION_PATH = path.join(__dirname, '..', 'app-version.json');

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
process.stdout.write(`${formatFooter(next)}\n`);
