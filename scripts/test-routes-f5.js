const { chromium } = require('playwright');

const BASE_URL = (process.env.APP_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');
const LOGIN_PASSWORD = process.env.APP_LOGIN_PASSWORD || '123456a';

const STATIC_ROUTES = [
  '/',
  '/dashboard',
  '/cards',
  '/cards/new',
  '/cards-mki/new',
  '/approvals',
  '/provision',
  '/input-control',
  '/departments',
  '/operations',
  '/areas',
  '/employees',
  '/shift-times',
  '/production/schedule',
  '/production/shifts',
  '/production/delayed',
  '/production/defects',
  '/production/plan',
  '/workorders',
  '/items',
  '/ok',
  '/oc',
  '/archive',
  '/receipts',
  '/workspace',
  '/users',
  '/accessLevels',
  '/profile'
];

function uniq(list) {
  return Array.from(new Set((list || []).filter(Boolean)));
}

function isRouteFailureMessage(text) {
  if (!text) return false;
  if (text.includes('401 (Unauthorized)')) return false;
  return /\[ROUTE\].*failed|ReferenceError|TypeError/.test(text);
}

async function login(page) {
  await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.fill('#login-password', LOGIN_PASSWORD);
  await page.click('#login-submit');
  await page.waitForFunction(() => window.__bootPhase === 'authorized-bootstrap:done', null, { timeout: 30000 });
}

async function discoverDynamicRoutes(page) {
  await page.goto(BASE_URL + '/production/plan', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const discovered = await page.evaluate(async () => {
    const resp = await fetch('/api/data', { credentials: 'include', cache: 'no-store' });
    const data = await resp.json();
    const cards = Array.isArray(data?.cards) ? data.cards : [];
    const normalizeQr = (value) => String(value || '').trim().toUpperCase();
    const validScan = (value) => /^[A-Z0-9]{6,}$/.test(String(value || '').trim().toUpperCase());

    const activeCards = cards.filter(card => card && !card.archived);
    const archivedCards = cards.filter(card => card && card.archived);
    const firstActive = activeCards.find(card => validScan(normalizeQr(card?.qrId))) || activeCards[0] || null;
    const firstArchived = archivedCards.find(card => validScan(normalizeQr(card?.qrId))) || archivedCards[0] || null;
    const workspaceCard = activeCards.find(card => (
      card &&
      card.cardType === 'MKI' &&
      Array.isArray(card.operations) &&
      card.operations.length &&
      validScan(normalizeQr(card.qrId))
    )) || null;

    const firstActiveQr = firstActive ? normalizeQr(firstActive.qrId || '') : '';
    const firstArchivedQr = firstArchived ? normalizeQr(firstArchived.qrId || '') : '';
    const workspaceQr = workspaceCard ? normalizeQr(workspaceCard.qrId || '') : '';

    let ganttPath = '';
    if (typeof window.findProductionGanttCard === 'function') {
      for (const card of activeCards) {
        const qr = normalizeQr(card?.qrId || '');
        if (!validScan(qr)) continue;
        try {
          const resolved = window.findProductionGanttCard('/production/gantt/' + encodeURIComponent(qr));
          if (resolved?.canonicalPath) {
            ganttPath = resolved.canonicalPath;
            break;
          }
        } catch (_) {}
      }
    }

    let shiftClosePath = '';
    if (typeof window.buildProductionShiftClosePath === 'function') {
      const now = new Date();
      const dateKey = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('');
      shiftClosePath = window.buildProductionShiftClosePath(dateKey, 1) || '';
    }

    return {
      firstActiveQr,
      firstArchivedQr,
      workspaceQr,
      ganttPath,
      shiftClosePath,
      totalCards: cards.length,
      archivedCount: archivedCards.length
    };
  });

  const routes = uniq([
    discovered.firstActiveQr ? '/cards/' + encodeURIComponent(discovered.firstActiveQr) : '',
    discovered.firstActiveQr ? '/card-route/' + encodeURIComponent(discovered.firstActiveQr) : '',
    discovered.firstActiveQr ? '/card-route/' + encodeURIComponent(discovered.firstActiveQr) + '/log' : '',
    discovered.firstActiveQr ? '/workorders/' + encodeURIComponent(discovered.firstActiveQr) : '',
    discovered.workspaceQr ? '/workspace/' + encodeURIComponent(discovered.workspaceQr) : '',
    discovered.firstArchivedQr ? '/archive/' + encodeURIComponent(discovered.firstArchivedQr) : '',
    discovered.firstActiveQr ? '/production/delayed/' + encodeURIComponent(discovered.firstActiveQr) : '',
    discovered.firstActiveQr ? '/production/defects/' + encodeURIComponent(discovered.firstActiveQr) : '',
    discovered.ganttPath,
    discovered.shiftClosePath
  ]);

  return { discovered, routes };
}

async function verifyRoutes(page, routes) {
  const results = [];
  for (const route of routes) {
    const consoleErrors = [];
    const pageErrors = [];
    const onConsole = (msg) => {
      const text = msg.text();
      if (msg.type() === 'error' || isRouteFailureMessage(text)) {
        consoleErrors.push(text);
      }
    };
    const onPageError = (err) => pageErrors.push(String(err));

    page.on('console', onConsole);
    page.on('pageerror', onPageError);

    try {
      await page.goto(BASE_URL + route, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (_) {}
    await page.waitForTimeout(1200);
    try {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (_) {}
    await page.waitForTimeout(2200);

    results.push({
      route,
      finalUrl: page.url(),
      bootPhase: await page.evaluate(() => window.__bootPhase || null).catch(() => null),
      consoleErrors: Array.from(new Set(consoleErrors)).filter(isRouteFailureMessage),
      pageErrors: Array.from(new Set(pageErrors)),
      textSample: await page.locator('body').innerText().then(text => text.slice(0, 180)).catch(() => '')
    });

    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  }

  return results;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await login(page);

    const dynamic = await discoverDynamicRoutes(page);
    const staticResults = await verifyRoutes(page, STATIC_ROUTES);
    const dynamicResults = await verifyRoutes(page, dynamic.routes);

    const allResults = staticResults.concat(dynamicResults);
    const failed = allResults.filter(item => item.pageErrors.length || item.consoleErrors.length || item.bootPhase !== 'authorized-bootstrap:done');

    console.log(JSON.stringify({
      baseUrl: BASE_URL,
      staticRouteCount: STATIC_ROUTES.length,
      dynamicRouteCount: dynamic.routes.length,
      discovered: dynamic.discovered,
      failedCount: failed.length,
      failed,
      okRoutes: allResults.filter(item => !failed.includes(item)).map(item => item.route)
    }, null, 2));

    if (failed.length) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});