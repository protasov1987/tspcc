const { expect } = require('@playwright/test');

async function waitForLoginForm(page) {
  await expect(page.locator('#login-form')).toBeVisible();
  await expect(page.locator('#login-password')).toBeEnabled();
  await expect(page.locator('#login-submit')).toBeEnabled();
}

async function loginAsAbyss(page) {
  const t0 = Date.now();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForLoginForm(page);
  await page.fill('#login-password', 'ssyba');
  await page.click('#login-submit');
  await expect(page.locator('#app-root')).toBeVisible();
  await expect(page.locator('#app-root')).not.toHaveClass(/hidden/);
  await expect(page.locator('#user-badge')).toContainText('Abyss');
  return {
    totalMs: Date.now() - t0
  };
}

module.exports = {
  loginAsAbyss,
  waitForLoginForm
};
