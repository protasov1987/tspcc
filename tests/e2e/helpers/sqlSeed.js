const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const manifest = require('../fixtures/fixture-manifest');
const {
  repoRoot,
  runtimeDir,
  runtimeDataDir,
  runtimeStorageDir,
  sqlSeedManifestPath
} = require('./paths');

const importScriptPath = path.join(repoRoot, 'scripts', 'mysql', 'import-json-dry-run.js');
const runtimeSeedDir = path.join(runtimeDir, 'sql-seed');
const runtimeSeedJsonPath = path.join(runtimeSeedDir, 'seed.database.json');
const runtimeReportDir = path.join(runtimeSeedDir, 'import-report');
const runtimeCardsStorageDir = path.join(runtimeStorageDir, 'cards');
const sourceCardsStorageDir = path.join(repoRoot, 'storage', 'cards');

const SQL_SOURCE_FLAGS = Object.freeze({
  TSPCC_SQL_TEST: '1',
  TSPCC_CARDS_SQL_SOURCE: '1',
  TSPCC_DIRECTORIES_SECURITY_SQL_SOURCE: '1',
  TSPCC_DIRECTORIES_SQL_SOURCE: '1',
  TSPCC_SECURITY_SQL_SOURCE: '1',
  TSPCC_PRODUCTION_SQL_SOURCE: '1',
  TSPCC_PRODUCTION_PLANNING_SQL_SOURCE: '1',
  TSPCC_PRODUCTION_EXECUTION_SQL_SOURCE: '1',
  TSPCC_MESSAGING_PROFILE_SQL_SOURCE: '1',
  TSPCC_MESSAGING_SQL_SOURCE: '1'
});

function resolveSqlSeedFixture(fixtureName) {
  const fixturePath = manifest[fixtureName];
  if (!fixturePath) {
    throw new Error(`Unknown SQL seed fixture "${fixtureName}"`);
  }
  return fixturePath;
}

function readFixtureJson(fixturePath) {
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function assertE2eSqlSeedEnabled(env = process.env) {
  if (String(env.TSPCC_E2E_SQL_SEED || '').trim() !== '1') {
    throw new Error(
      'Post-cutover E2E requires SQL seed. Set TSPCC_E2E_SQL_SEED=1, ' +
      'TSPCC_SQL_TEST=1, TSPCC_DB_* and TSPCC_DB_MIGRATION_* for a local/test MySQL schema.'
    );
  }
}

function removeDirectoryInsideRuntime(targetPath) {
  const resolved = path.resolve(targetPath);
  const allowedRoot = path.resolve(runtimeDir);
  if (resolved !== allowedRoot && !resolved.startsWith(`${allowedRoot}${path.sep}`)) {
    throw new Error(`Refusing to clear path outside E2E runtime: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

function copyDirectoryIfExists(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

function prepareRuntimeStorage(options = {}) {
  removeDirectoryInsideRuntime(runtimeStorageDir);
  fs.mkdirSync(runtimeCardsStorageDir, { recursive: true });
  copyDirectoryIfExists(sourceCardsStorageDir, runtimeCardsStorageDir);
  if (typeof options.prepareFiles === 'function') {
    options.prepareFiles({
      storageRoot: runtimeStorageDir,
      storageCardsDir: runtimeCardsStorageDir
    });
  }
}

function writeSeedManifest({ fixtureName, fixturePath, db, reportDir }) {
  fs.mkdirSync(path.dirname(sqlSeedManifestPath), { recursive: true });
  const seedManifest = {
    fixtureName,
    fixturePath,
    seededAt: new Date().toISOString(),
    source: 'sql-seed-manifest',
    reportDir,
    cards: Array.isArray(db.cards) ? db.cards : [],
    users: Array.isArray(db.users) ? db.users : [],
    accessLevels: Array.isArray(db.accessLevels) ? db.accessLevels : [],
    chatConversations: Array.isArray(db.chatConversations) ? db.chatConversations : [],
    chatMessages: Array.isArray(db.chatMessages) ? db.chatMessages : [],
    chatStates: Array.isArray(db.chatStates) ? db.chatStates : [],
    webPushSubscriptions: Array.isArray(db.webPushSubscriptions) ? db.webPushSubscriptions : [],
    fcmTokens: Array.isArray(db.fcmTokens) ? db.fcmTokens : [],
    productionShiftTasks: Array.isArray(db.productionShiftTasks) ? db.productionShiftTasks : [],
    productionShifts: Array.isArray(db.productionShifts) ? db.productionShifts : []
  };
  fs.writeFileSync(sqlSeedManifestPath, `${JSON.stringify(seedManifest, null, 2)}\n`, 'utf8');
}

function seedSqlFixture(fixtureName, options = {}) {
  assertE2eSqlSeedEnabled();
  const fixturePath = resolveSqlSeedFixture(fixtureName);
  const db = readFixtureJson(fixturePath);
  if (typeof options.mutateDb === 'function') {
    options.mutateDb(db);
  }

  fs.mkdirSync(runtimeSeedDir, { recursive: true });
  fs.mkdirSync(runtimeDataDir, { recursive: true });
  prepareRuntimeStorage(options);
  fs.writeFileSync(runtimeSeedJsonPath, `${JSON.stringify(db, null, 2)}\n`, 'utf8');

  execFileSync(process.execPath, [
    importScriptPath,
    '--json', runtimeSeedJsonPath,
    '--files-root', runtimeCardsStorageDir,
    '--report-dir', runtimeReportDir,
    '--execute',
    '--reset-import'
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...SQL_SOURCE_FLAGS
    },
    stdio: 'inherit'
  });

  writeSeedManifest({ fixtureName, fixturePath, db, reportDir: runtimeReportDir });
  return db;
}

module.exports = {
  SQL_SOURCE_FLAGS,
  seedSqlFixture
};
