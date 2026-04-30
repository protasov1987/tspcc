const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  DERIVED_VIEW_DEPENDENCIES,
  DerivedViewsRepository
} = require('../../server/repositories/derivedViewsRepository');

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

function createRepository(rowsByView = {}) {
  const calls = [];
  const repository = new DerivedViewsRepository({
    pool: {
      async execute(sql, values) {
        calls.push({ sql, values });
        const view = Object.keys(rowsByView).find(name => new RegExp(`\\bFROM\\s+${name}\\b`, 'i').test(sql));
        return [rowsByView[view] || [], []];
      }
    }
  });
  return { repository, calls };
}

test('derived views repository reads only Stage 9 read models with SELECT queries', async () => {
  const { repository, calls } = createRepository({
    workorders_read_model: [{
      card_id: 'card-1',
      qr_id: 'QR-1',
      route_card_number: 'RC-1',
      card_type: 'MKI',
      approval_stage: 'PLANNED',
      status: 'IN_PROGRESS',
      production_status: 'IN_PROGRESS',
      planning_task_count: 2,
      flow_state_count: 1,
      flow_version: 4,
      current_flow_status: 'IN_PROGRESS'
    }],
    archive_read_model: [{
      card_id: 'card-arch',
      qr_id: 'QR-A',
      route_card_number: 'RC-A',
      card_type: 'MKI',
      approval_stage: 'PLANNED',
      status: 'DONE',
      archived_at: '2026-01-01 00:00:00',
      updated_at: '2026-01-01 00:00:00'
    }],
    production_items_read_model: [{
      item_state_id: 'item-1',
      card_id: 'card-1',
      qr_id: 'QR-1',
      route_operation_id: 'op-1',
      item_kind: 'ITEM',
      item_status: 'PENDING',
      quantity: 1
    }],
    production_ok_read_model: [{
      item_state_id: 'sample-ok',
      card_id: 'card-1',
      item_kind: 'SAMPLE',
      sample_type: 'CONTROL',
      item_status: 'PENDING'
    }],
    production_oc_read_model: [{
      item_state_id: 'sample-oc',
      card_id: 'card-1',
      item_kind: 'SAMPLE',
      sample_type: 'WITNESS',
      item_status: 'PENDING'
    }]
  });

  assert.equal((await repository.listWorkorders())[0].planningTaskCount, 2);
  assert.equal((await repository.listArchive())[0].cardId, 'card-arch');
  assert.equal((await repository.listProductionItems())[0].kind, 'ITEM');
  assert.equal((await repository.listControlSamples())[0].sampleType, 'CONTROL');
  assert.equal((await repository.listWitnessSamples())[0].sampleType, 'WITNESS');

  const sql = calls.map(call => call.sql).join('\n');
  assert.match(sql, /\bFROM\s+workorders_read_model\b/i);
  assert.match(sql, /\bFROM\s+archive_read_model\b/i);
  assert.match(sql, /\bFROM\s+production_items_read_model\b/i);
  assert.match(sql, /\bFROM\s+production_ok_read_model\b/i);
  assert.match(sql, /\bFROM\s+production_oc_read_model\b/i);
  assert.equal(/\b(INSERT|UPDATE|DELETE|REPLACE|MERGE|TRUNCATE)\b/i.test(sql), false);
});

test('derived detail queries are parameterized by card key', async () => {
  const { repository, calls } = createRepository({
    workorders_read_model: [{ card_id: 'card-1', qr_id: 'QR-1', route_card_number: 'RC-1' }],
    archive_read_model: [{ card_id: 'card-arch', qr_id: 'QR-A', route_card_number: 'RC-A' }]
  });

  assert.equal((await repository.getWorkorder('QR-1')).qrId, 'QR-1');
  assert.equal((await repository.getArchivedCard('RC-A')).routeCardNumber, 'RC-A');
  assert.deepEqual(calls[0].values, ['QR-1', 'QR-1', 'QR-1']);
  assert.deepEqual(calls[1].values, ['RC-A', 'RC-A', 'RC-A']);
  assert.equal(calls.every(call => /\?/.test(call.sql)), true);
});

test('derived read model migration encodes route semantics for workorders archive items ok and oc', () => {
  const migration = readRepoFile('migrations/mysql/010_derived_views_read_model_semantics.sql');
  const lower = migration.toLowerCase();

  assert.match(lower, /create\s+or\s+replace\s+sql\s+security\s+invoker\s+view\s+workorders_read_model/);
  assert.match(lower, /left\s+join\s+production_shift_tasks/);
  assert.match(lower, /left\s+join\s+production_flow_states/);
  assert.match(lower, /c\.card_type\s*=\s*'mki'/);
  assert.match(lower, /c\.approval_stage\s+in\s+\('provided',\s*'planning',\s*'planned'\)/);
  assert.doesNotMatch(lower, /workorders_read_model[\s\S]{0,900}where\s+c\.deleted_at\s+is\s+null\s+and\s+c\.archived\s*=\s*false\s*;/);

  assert.match(lower, /view\s+archive_read_model[\s\S]+c\.archived\s*=\s*true/);
  assert.match(lower, /view\s+production_items_read_model[\s\S]+i\.item_kind[\s\S]+=\s*'item'/);
  assert.match(lower, /view\s+production_ok_read_model[\s\S]+i\.item_kind[\s\S]+=\s*'sample'[\s\S]+i\.sample_type[\s\S]+=\s*'control'/);
  assert.match(lower, /view\s+production_oc_read_model[\s\S]+i\.item_kind[\s\S]+=\s*'sample'[\s\S]+i\.sample_type[\s\S]+=\s*'witness'/);
  assert.match(lower, /production_items_read_model[\s\S]+c\.route_card_number/);
  assert.match(lower, /production_ok_read_model[\s\S]+c\.route_card_number/);
  assert.match(lower, /production_oc_read_model[\s\S]+c\.route_card_number/);
  assert.match(lower, /production_items_read_model[\s\S]+c\.item_name/);
  assert.match(lower, /production_ok_read_model[\s\S]+issued_by_surname/);
  assert.match(lower, /production_oc_read_model[\s\S]+work_basis/);

  const okView = lower.slice(lower.indexOf('view production_ok_read_model'), lower.indexOf('create or replace sql security invoker view production_oc_read_model'));
  const ocView = lower.slice(lower.indexOf('view production_oc_read_model'));
  assert.doesNotMatch(okView, /quality_status\s*=\s*'ok'/);
  assert.doesNotMatch(ocView, /production_defects/);
});

test('derived repository source does not use legacy data APIs or compatibility payloads as authority', () => {
  const repositorySource = readRepoFile('server/repositories/derivedViewsRepository.js');
  assert.deepEqual(DERIVED_VIEW_DEPENDENCIES, {
    cards: 'CardsRepository',
    directoriesSecurity: ['DirectoriesRepository', 'SecurityRepository'],
    productionPlanning: 'ProductionPlanningRepository',
    productionExecution: 'ProductionExecutionRepository'
  });
  assert.equal(/\/api\/data|api\/data|database\.getData|JsonDatabase|database\.json|compatibility payload/i.test(repositorySource), false);
  assert.equal(/saveData|snapshot-save|legacy snapshot/i.test(repositorySource), false);
});

test('production execution item state writer persists item kind and sample type for derived sample routes', () => {
  const source = readRepoFile('server/repositories/productionExecutionRepository.js');
  const upsertSource = source.slice(
    source.indexOf('async upsertItemState'),
    source.indexOf('async listItemStates')
  );
  const syncSource = source.slice(
    source.indexOf('async syncFlowItemStatesFromCard'),
    source.indexOf('async upsertPersonalOperation')
  );

  assert.match(upsertSource, /item_kind/);
  assert.match(upsertSource, /sample_type/);
  assert.match(upsertSource, /normalizedItemKind/);
  assert.match(syncSource, /kind:\s*'SAMPLE'/);
  assert.match(syncSource, /sampleType:\s*group\.kind === 'SAMPLE'/);
});

test('derived server endpoints expose read-only API map over DerivedViewsRepository', () => {
  const serverSource = readRepoFile('server.js');
  const parserSource = extractFunctionSource(serverSource, 'parseDerivedViewsEndpoint');
  const readerSource = extractFunctionSource(serverSource, 'readDerivedViewsRoute');
  const handlerSource = extractFunctionSource(serverSource, 'handleDerivedViewsRoutes');

  assert.match(serverSource, /require\('\.\/server\/repositories\/derivedViewsRepository'\)/);
  assert.match(serverSource, /function getDerivedViewsRepository/);
  assert.match(parserSource, /'workorders'/);
  assert.match(parserSource, /'archive'/);
  assert.match(parserSource, /'items'/);
  assert.match(parserSource, /'ok'/);
  assert.match(parserSource, /'oc'/);
  assert.match(serverSource, /repository\.listWorkorders\(\)/);
  assert.match(serverSource, /repository\.getWorkorder\(route\.detailKey\)/);
  assert.match(serverSource, /repository\.listArchive\(\)/);
  assert.match(serverSource, /repository\.getArchivedCard\(route\.detailKey\)/);
  assert.match(serverSource, /function hydrateDerivedCardsFromReadModelRows/);
  assert.match(serverSource, /getCardsRepository\(\)\.listCards\(\)/);
  assert.match(serverSource, /getCardsRepository\(\)\.getCardByKey\(key\)/);
  assert.match(serverSource, /getProductionPlanningRepository\(\)\.readShiftTasks\(\)/);
  assert.match(readerSource, /repository\.listProductionItems\(\)/);
  assert.match(readerSource, /repository\.listControlSamples\(\)/);
  assert.match(readerSource, /repository\.listWitnessSamples\(\)/);
  assert.match(handlerSource, /pathname\.startsWith\('\/api\/derived\/'\)/);
  assert.match(handlerSource, /req\.method !== 'GET'/);
  assert.match(handlerSource, /DERIVED_READ_ONLY/);
  assert.match(handlerSource, /sendJson\(res,\s*405/);
});

test('derived endpoint guard requires accepted SQL source domains', () => {
  const serverSource = readRepoFile('server.js');
  const guardSource = extractFunctionSource(serverSource, 'getDerivedViewsSqlBoundaryConfigErrors');
  const assertSource = extractFunctionSource(serverSource, 'assertDerivedViewsSqlBoundaryConfig');
  const handlerSource = extractFunctionSource(serverSource, 'handleDerivedViewsRoutes');

  assert.match(guardSource, /isCardsSqlSourceEnabled\(\)/);
  assert.match(guardSource, /isDirectoriesSecuritySqlSourceEnabled\(\)/);
  assert.match(guardSource, /isProductionPlanningSqlSourceEnabled\(\)/);
  assert.match(guardSource, /isProductionExecutionSqlSourceEnabled\(\)/);
  assert.match(guardSource, /getProductionExecutionSqlBoundaryConfigErrors\(\)/);
  assert.match(assertSource, /\[DB\] derived views SQL source guard failed/);
  assert.match(assertSource, /DERIVED_VIEWS_SQL_SOURCE_GUARD/);
  assert.match(assertSource, /statusCode = 503/);
  assert.match(handlerSource, /assertDerivedViewsSqlBoundaryConfig\(route\.family\)/);
  assert.match(handlerSource, /getSecurityRepository\(\)\.readSnapshot\(\)/);
  assert.match(handlerSource, /canViewTab\(me, securitySnapshot\.accessLevels/);
});

test('derived endpoint implementation does not use snapshot authority or client compatibility payloads', () => {
  const serverSource = readRepoFile('server.js');
  const handlerSource = extractFunctionSource(serverSource, 'handleDerivedViewsRoutes');
  const readerSource = extractFunctionSource(serverSource, 'readDerivedViewsRoute');
  const payloadSource = extractFunctionSource(serverSource, 'buildDerivedViewsPayload');
  const combined = `${handlerSource}\n${readerSource}\n${payloadSource}`;

  assert.equal(/\/api\/data|api\/data|database\.getData|buildProductionExecutionCompatibilityScopePayload|buildProductionPlanningCompatibilityScopePayload|buildScopedDataPayload|saveData|database\.update/i.test(combined), false);
  assert.match(payloadSource, /source:\s*'sql'/);
  assert.match(payloadSource, /mode:\s*'derived-read-model'/);
  assert.match(payloadSource, /dependencies/);
  assert.match(payloadSource, /items/);
  assert.match(payloadSource, /cards/);
  assert.match(payloadSource, /productionShiftTasks/);
  assert.match(handlerSource, /DERIVED_VIEW_NOT_FOUND/);
});

test('client derived route loaders use derived endpoints instead of production snapshot scope', () => {
  const authSource = readRepoFile('js/app.50.auth.js');
  const storeSource = readRepoFile('js/app.40.store.js');
  const stateSource = readRepoFile('js/app.00.state.js');
  const workflowsSource = readRepoFile('js/app.73.production-workflows.js');
  const criticalSource = extractFunctionSource(authSource, 'ensureRouteCriticalData');
  const scopeSource = extractFunctionSource(authSource, 'getRouteCriticalDataScope');
  const backgroundSource = extractFunctionSource(authSource, 'hydrateRouteInBackground');
  const routeSource = extractFunctionSource(stateSource, 'handleRoute');
  const fetchSource = extractFunctionSource(storeSource, 'fetchDerivedView');
  const workordersSource = extractFunctionSource(workflowsSource, 'getWorkordersReadModelSource');
  const archiveSource = extractFunctionSource(workflowsSource, 'getArchiveReadModelCards');
  const itemsSource = extractFunctionSource(workflowsSource, 'getItemsPageReadModelCards');

  assert.match(storeSource, /function getRouteDerivedViewSpec/);
  assert.match(storeSource, /\/api\/derived\//);
  assert.match(fetchSource, /connectionSource:\s*'derived-view:' \+ family/);
  assert.match(criticalSource, /getRouteDerivedViewSpec\(cleanPath\)/);
  assert.match(criticalSource, /fetchDerivedView\(derivedSpec/);
  assert.match(routeSource, /getRouteDerivedViewSpec\(normalized\)/);
  assert.match(routeSource, /hasLoadedDerivedView\(routeDerivedViewSpec\)/);
  assert.match(backgroundSource, /isDerivedViewRoute\(routePath\)/);
  assert.match(workordersSource, /getDerivedViewCards\('workorders'\)/);
  assert.match(archiveSource, /getDerivedViewCards\('archive'\)/);
  assert.match(itemsSource, /getDerivedViewItems\(getItemsPageDerivedFamily\(config\)\)/);
  assert.doesNotMatch(scopeSource, /cleanPath === '\/workorders'[\s\S]{0,180}DATA_SCOPE_PRODUCTION/);
  assert.doesNotMatch(scopeSource, /cleanPath === '\/items'[\s\S]{0,120}DATA_SCOPE_PRODUCTION/);
});
