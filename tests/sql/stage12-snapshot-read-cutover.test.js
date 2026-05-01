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
