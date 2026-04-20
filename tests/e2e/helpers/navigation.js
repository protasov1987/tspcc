const { expect } = require('@playwright/test');

const routeAnchors = {
  '/dashboard': { pageId: 'page-dashboard', text: 'Состояние производства' },
  '/cards': { pageId: 'page-cards', text: 'Маршрутные карты' },
  '/cards/new': { pageId: 'page-cards-new', text: 'Маршрутная карта' },
  '/production/plan': { pageId: 'page-production-plan', text: 'План производства' },
  '/workspace': { pageId: 'page-workspace', text: 'Рабочее место' },
  '/archive': { pageId: 'page-archive', text: 'Архив' },
  '/workorders': { pageId: 'page-workorders', text: 'Трекер' },
  '/approvals': { pageId: 'page-approvals', text: 'Согласование' },
  '/provision': { pageId: 'page-provision', text: 'Обеспечение' },
  '/input-control': { pageId: 'page-input-control', text: 'Входной контроль' },
  '/items': { pageId: 'page-items', text: 'Изделия' },
  '/ok': { pageId: 'page-ok', text: 'ОК' },
  '/oc': { pageId: 'page-oc', text: 'ОС' },
  '/users': { pageId: 'page-users', text: 'Пользователи' },
  '/accessLevels': { pageId: 'page-access-levels', text: 'Уровни доступа' },
  '/departments': { pageId: 'page-departments', text: 'Подразделения' },
  '/operations': { pageId: 'page-operations', text: 'Операции' },
  '/areas': { pageId: 'page-areas', text: 'Участки' },
  '/employees': { pageId: 'page-employees', text: 'Сотрудники' },
  '/shift-times': { pageId: 'page-shift-times', text: 'Время смен' },
  '/production/schedule': { pageId: 'page-production-schedule', text: 'Расписание сотрудников' },
  '/production/shifts': { pageId: 'page-production-shifts', text: 'Сменные задания' },
  '/production/delayed': { pageId: 'page-production-delayed', text: 'Задержано' },
  '/production/defects': { pageId: 'page-production-defects', text: 'Брак' }
};

const dynamicRouteAnchors = [
  { pattern: /^\/cards\/[^/]+\/?$/, anchor: { pageId: 'page-cards-new', text: 'Маршрутная карта' } },
  { pattern: /^\/card-route\/[^/]+\/?$/, anchor: { pageId: 'page-cards-new', text: 'Маршрутная карта' } },
  { pattern: /^\/card-route\/[^/]+\/log\/?$/, anchor: { pageId: 'page-card-log', text: 'Лог маршрутной карты' } },
  { pattern: /^\/profile\/[^/]+\/?$/, anchor: { pageId: 'page-user-profile', text: 'Профиль пользователя' } },
  { pattern: /^\/workorders\/[^/]+\/?$/, anchor: { pageId: 'page-workorders-card', text: 'Трекер' } },
  { pattern: /^\/workspace\/[^/]+\/?$/, anchor: { pageId: 'page-workorders-card', text: 'Рабочее место' } },
  { pattern: /^\/archive\/[^/]+\/?$/, anchor: { pageId: 'page-archive-card', text: 'Архив' } },
  { pattern: /^\/production\/shifts\/\d{8}s\d+\/?$/, anchor: { pageId: 'page-production-shift-close', text: 'Сменные задания' } },
  { pattern: /^\/production\/gantt\/[^/]+\/?$/, anchor: { pageId: 'page-production-gantt', text: 'План производства' } },
  { pattern: /^\/production\/delayed\/[^/]+\/?$/, anchor: { pageId: 'page-workorders-card', text: 'Задержано' } },
  { pattern: /^\/production\/defects\/[^/]+\/?$/, anchor: { pageId: 'page-workorders-card', text: 'Брак' } }
];

function resolveRouteAnchor(pathname = '') {
  if (routeAnchors[pathname]) return routeAnchors[pathname];
  const dynamic = dynamicRouteAnchors.find((entry) => entry.pattern.test(pathname));
  return dynamic ? dynamic.anchor : null;
}

function normalizeRouteSpec(route) {
  if (typeof route === 'string') {
    return {
      inputPath: route,
      expectedPath: route,
      anchor: resolveRouteAnchor(route)
    };
  }

  const inputPath = String(route?.inputPath || route?.route || route?.path || '').trim();
  const expectedPath = String(route?.expectedPath || inputPath).trim();
  return {
    inputPath,
    expectedPath,
    anchor: {
      ...(resolveRouteAnchor(expectedPath) || {}),
      ...(route?.anchor || {}),
      ...(route?.pageId ? { pageId: route.pageId } : {})
    }
  };
}

async function waitUsableUi(page, route) {
  const spec = normalizeRouteSpec(route);
  const anchor = spec.anchor;
  await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toBe(spec.expectedPath);
  if (anchor?.pageId) {
    await expect.poll(() => page.evaluate(() => window.__currentPageId || null)).toBe(anchor.pageId);
  }
  await expect.poll(async () => {
    const text = await page.locator('#app-main').innerText().catch(() => '');
    return text.trim().length > 20;
  }).toBe(true);
}

async function openRouteAndAssert(page, route) {
  const spec = normalizeRouteSpec(route);
  await page.goto(spec.inputPath, { waitUntil: 'domcontentloaded' });
  await waitUsableUi(page, spec);
  return spec;
}

module.exports = {
  routeAnchors,
  resolveRouteAnchor,
  normalizeRouteSpec,
  waitUsableUi,
  openRouteAndAssert
};
