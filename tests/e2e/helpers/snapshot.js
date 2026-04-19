const fs = require('fs');
const path = require('path');
const manifest = require('../fixtures/fixture-manifest');
const { dataDbPath } = require('./paths');

function resolveSnapshot(snapshotName) {
  const snapshotPath = manifest[snapshotName];
  if (!snapshotPath) {
    throw new Error(`Unknown snapshot "${snapshotName}"`);
  }
  return snapshotPath;
}

function resetDatabaseFromSnapshot(snapshotName) {
  const snapshotPath = resolveSnapshot(snapshotName);
  if (!fs.existsSync(snapshotPath)) {
    throw new Error(`Snapshot file not found: ${snapshotPath}`);
  }
  fs.mkdirSync(path.dirname(dataDbPath), { recursive: true });
  fs.copyFileSync(snapshotPath, dataDbPath);
  return snapshotPath;
}

module.exports = {
  resolveSnapshot,
  resetDatabaseFromSnapshot
};
