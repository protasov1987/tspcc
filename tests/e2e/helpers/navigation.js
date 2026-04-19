const { expect } = require('@playwright/test');

const routeAnchors = {
  '/dashboard': { pageId: 'page-dashboard', text: 'Состояние производства' },
  '/cards': { pageId: 'page-cards', text: 'Маршрутные карты' },
  '/production/plan': { pageId: 'page-production-plan', text: 'План производства' },
  '/workspace': { pageId: 'page-workspace', text: 'Рабочее место' },
  '/archive': { pageId: 'page-archive', text: 'Архив' },
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

async function waitUsableUi(page, route) {
  const anchor = routeAnchors[route];
  await expect.poll(() => page.evaluate(() => window.location.pathname + window.location.search)).toContain(route);
  if (anchor?.pageId) {
    await expect.poll(() => page.evaluate(() => window.__currentPageId || null)).toBe(anchor.pageId);
  }
  await expect.poll(async () => {
    const text = await page.locator('#app-main').innerText().catch(() => '');
    return text.trim().length > 20;
  }).toBe(true);
}

async function openRouteAndAssert(page, route) {
  await page.goto(route, { waitUntil: 'domcontentloaded' });
  await waitUsableUi(page, route);
}

module.exports = {
  routeAnchors,
  waitUsableUi,
  openRouteAndAssert
};
