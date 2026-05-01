const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');
}

function extractFunctionSource(source, functionName) {
  const start = source.indexOf(`function ${functionName}`);
  assert.notEqual(start, -1, `${functionName} not found`);
  const nextMatch = /\n(?:async\s+)?function\s+/.exec(source.slice(start + 1));
  const next = nextMatch ? start + 1 + nextMatch.index : -1;
  return source.slice(start, next === -1 ? source.length : next);
}

function extractFunctionSourceFromSignature(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} not found`);
  const nextMatch = /\n(?:async\s+)?function\s+/.exec(source.slice(start + 1));
  const next = nextMatch ? start + 1 + nextMatch.index : -1;
  return source.slice(start, next === -1 ? source.length : next);
}

test('stage 12 route-critical hydration uses domain endpoints instead of snapshot scope reads', () => {
  const authSource = readRepoFile('js/app.50.auth.js');
  const storeSource = readRepoFile('js/app.40.store.js');
  const ensureSource = extractFunctionSource(authSource, 'ensureRouteCriticalData');
  const backgroundSource = extractFunctionSource(authSource, 'hydrateRouteInBackground');
  const refreshDomainSource = extractFunctionSource(storeSource, 'refreshDomainScopeData');
  const loadScopeSource = extractFunctionSource(storeSource, 'loadDataWithScope');
  const backgroundHydrationSource = extractFunctionSource(storeSource, 'startBackgroundDataHydration');

  assert.match(ensureSource, /refreshDomainScopeData\(scope/);
  assert.doesNotMatch(ensureSource, /loadDataWithScope\(/);
  assert.doesNotMatch(ensureSource, /loadData\(/);
  assert.match(backgroundSource, /refreshDomainScopeData\(scope/);
  assert.doesNotMatch(backgroundSource, /startBackgroundDataHydration\(/);
  assert.doesNotMatch(backgroundHydrationSource, /loadDataWithScope\(\{\s*scope:\s*DATA_SCOPE_FULL/);

  assert.match(refreshDomainSource, /DATA_SCOPE_CARDS_BASIC[\s\S]+fetchCardsCoreList/);
  assert.match(refreshDomainSource, /DATA_SCOPE_FULL[\s\S]+diagnostic-export-only/);
  assert.match(loadScopeSource, /DATA_SCOPE_PRODUCTION[\s\S]+PRODUCTION_EXECUTION_SCOPE_PATH/);
  assert.match(loadScopeSource, /DATA_SCOPE_DIRECTORIES[\s\S]+['"]\/api\/directories['"]/);
  assert.match(loadScopeSource, /DATA_SCOPE_CARDS_BASIC[\s\S]+['"]\/api\/cards-core['"]/);
  assert.doesNotMatch(loadScopeSource, /LEGACY_SNAPSHOT_READ_PATH\s*\+\s*['"]\?scope=/);
});

test('stage 12 live and conflict fallbacks stay targeted and avoid full snapshot load', () => {
  const stateSource = readRepoFile('js/app.00.state.js');
  const utilsSource = readRepoFile('js/app.10.utils.js');
  const workflowsSource = readRepoFile('js/app.73.production-workflows.js');
  const storeSource = readRepoFile('js/app.40.store.js');
  const scopedRefreshSource = extractFunctionSource(utilsSource, 'refreshScopedDataPreservingRoute');
  const cardsLiveSource = extractFunctionSource(stateSource, 'refreshCardsLiveScopeFromServer');
  const cardsConflictSource = extractFunctionSource(storeSource, 'refreshCardsCoreMutationAfterConflict');

  assert.match(scopedRefreshSource, /diagnostic-export-only/);
  assert.doesNotMatch(scopedRefreshSource, /loadData\(/);
  assert.match(scopedRefreshSource, /refreshDomainScopeData\(normalizedScope/);
  assert.match(cardsLiveSource, /refreshDomainScopeData\(DATA_SCOPE_CARDS_BASIC/);
  assert.doesNotMatch(cardsLiveSource, /loadData\(/);
  assert.match(cardsConflictSource, /fetchCardsCoreList/);
  assert.doesNotMatch(cardsConflictSource, /loadData\(/);
  assert.doesNotMatch(workflowsSource, /await\s+loadData\(\);/);
});

test('stage 12 legacy data endpoint remains read-only diagnostic compatibility on the server', () => {
  const serverSource = readRepoFile('server.js');
  const legacyHandlerSource = serverSource.slice(
    serverSource.indexOf("if (!isLegacySnapshotDataPath(pathname)) return false;"),
    serverSource.indexOf('function findAttachment')
  );

  assert.match(legacyHandlerSource, /req\.method === 'GET'/);
  assert.match(legacyHandlerSource, /mode:\s*'read-only-compatibility'/);
  assert.match(legacyHandlerSource, /LEGACY_SNAPSHOT_WRITE_DISABLED/);
  assert.match(legacyHandlerSource, /sendJson\(res,\s*410/);
  assert.doesNotMatch(legacyHandlerSource, /req\.method === 'POST'[\s\S]+database\.update/);
});

test('stage 12 final runtime cleanup blocks server-domain JSON fallbacks', () => {
  const serverSource = readRepoFile('server.js');
  const directorySource = extractFunctionSourceFromSignature(serverSource, 'async function handleDirectoryRoutes(req, res, parsed)');
  const derivedHandlerSource = extractFunctionSource(serverSource, 'handleDerivedViewsRoutes');
  const productionExecutionSource = extractFunctionSource(serverSource, 'getProductionExecutionCommandData');
  const productionPersistSource = extractFunctionSource(serverSource, 'persistProductionExecutionMutation');
  const messagingSource = extractFunctionSource(serverSource, 'handleMessagingProfileRoutes');
  const fileSource = extractFunctionSource(serverSource, 'handleFileRoutes');
  const cardsReadySource = extractFunctionSource(serverSource, 'ensureCardsCoreDataReady');

  assert.match(directorySource, /DIRECTORIES_SECURITY_SQL_SOURCE_REQUIRED/);
  assert.match(directorySource, /sendSqlSourceRequired\(res/);
  assert.match(derivedHandlerSource, /assertDerivedViewsSqlBoundaryConfig\(route\.family\)/);
  assert.doesNotMatch(derivedHandlerSource, /readDerivedViewsCompatibility|buildDerivedViewsCompatibilityPayload|server-domain/);
  assert.match(productionExecutionSource, /PRODUCTION_EXECUTION_SQL_SOURCE_REQUIRED/);
  assert.doesNotMatch(productionExecutionSource, /return\s+database\.getData\(\)/);
  assert.match(productionPersistSource, /PRODUCTION_EXECUTION_SQL_SOURCE_REQUIRED/);
  assert.doesNotMatch(productionPersistSource, /return\s+database\.update\(mutator\)/);
  assert.match(messagingSource, /MESSAGING_PROFILE_SQL_SOURCE_REQUIRED/);
  assert.match(fileSource, /CARDS_SQL_SOURCE_REQUIRED/);
  assert.match(cardsReadySource, /getCardsRepository\(\)\.listCards\(\)/);
  assert.match(cardsReadySource, /getDirectoriesRepository\(\)\.readSnapshot\(\)/);
  assert.match(cardsReadySource, /getSecurityRepository\(\)\.readSnapshot\(\)/);
  assert.doesNotMatch(cardsReadySource, /const data = await database\.getData\(\)/);
});

test('stage 12 final runtime cleanup removes client writable snapshot adapter names', () => {
  const stateSource = readRepoFile('js/app.00.state.js');
  const storeSource = readRepoFile('js/app.40.store.js');

  assert.doesNotMatch(stateSource, /LEGACY_SNAPSHOT_SAVE_PATH|API_ENDPOINT/);
  assert.doesNotMatch(storeSource, /function\s+saveData|LEGACY_SNAPSHOT_SAVE_PATH|__saveInFlight/);
});

test('stage 12 post-cutover e2e fixtures use SQL seed instead of runtime database copy', () => {
  const e2eFiles = fs.readdirSync(path.join(__dirname, '../e2e'))
    .filter((file) => file.endsWith('.js'))
    .map((file) => `tests/e2e/${file}`);
  const e2eSource = e2eFiles.map(readRepoFile).join('\n');
  const setupSource = readRepoFile('tests/e2e/global.setup.js');
  const teardownSource = readRepoFile('tests/e2e/global.teardown.js');
  const seedSource = readRepoFile('tests/e2e/helpers/sqlSeed.js');
  const serverHelperSource = readRepoFile('tests/e2e/helpers/server.js');

  assert.doesNotMatch(e2eSource, /resetDatabaseFromSnapshot/);
  assert.doesNotMatch(e2eSource, /loadSnapshotDb/);
  assert.doesNotMatch(e2eSource, /dataDbPath/);
  assert.doesNotMatch(`${setupSource}\n${teardownSource}`, /data['"],\s*['"]database\.json|database\.original\.json|copyFileSync/);

  assert.match(seedSource, /import-json-dry-run\.js/);
  assert.match(seedSource, /'--execute'/);
  assert.match(seedSource, /'--reset-import'/);
  assert.match(seedSource, /TSPCC_E2E_SQL_SEED/);
  assert.match(seedSource, /TSPCC_SQL_TEST:\s*'1'/);
  assert.match(seedSource, /TSPCC_CARDS_SQL_SOURCE:\s*'1'/);
  assert.match(seedSource, /TSPCC_DIRECTORIES_SECURITY_SQL_SOURCE:\s*'1'/);
  assert.match(seedSource, /TSPCC_PRODUCTION_SQL_SOURCE:\s*'1'/);
  assert.match(seedSource, /TSPCC_MESSAGING_PROFILE_SQL_SOURCE:\s*'1'/);
  assert.match(serverHelperSource, /SQL_SOURCE_FLAGS/);
});

test('stage 12 post-cutover e2e request expectations use domain endpoints', () => {
  const e2eFiles = fs.readdirSync(path.join(__dirname, '../e2e'))
    .filter((file) => file.endsWith('.js'))
    .map((file) => `tests/e2e/${file}`);
  const e2eSource = e2eFiles.map(readRepoFile).join('\n');

  assert.doesNotMatch(e2eSource, /\/api\/data\?scope=/);
  assert.match(e2eSource, /\/api\/cards-core/);
  assert.match(e2eSource, /\/api\/directories/);
  assert.match(e2eSource, /\/api\/production\/execution\/scope/);
  assert.match(e2eSource, /\/api\/derived\//);
});
