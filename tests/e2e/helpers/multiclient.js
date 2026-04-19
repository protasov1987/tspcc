const { attachDiagnostics } = require('./diagnostics');
const { loginAsAbyss } = require('./auth');

async function createLoggedInClient(browser, { baseURL, route = '/workspace' } = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const diagnostics = attachDiagnostics(page);
  await loginAsAbyss(page);
  if (route) {
    await page.goto(`${baseURL}${route}`, { waitUntil: 'domcontentloaded' });
  }
  return { context, page, diagnostics };
}

async function closeClients(clients) {
  await Promise.all(clients.map(async (client) => {
    try {
      await client.context.close();
    } catch (err) {}
  }));
}

module.exports = {
  createLoggedInClient,
  closeClients
};
