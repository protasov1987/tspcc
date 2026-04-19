const { test, expect } = require('@playwright/test');
const { resetDatabaseFromSnapshot } = require('./helpers/snapshot');
const { restartServer, stopServer } = require('./helpers/server');
const { attachDiagnostics, expectNoCriticalClientFailures } = require('./helpers/diagnostics');
const AuthFlow = require('./flows/auth.flow');
const CardsFlow = require('./flows/cards.flow');
const ProductionPlanFlow = require('./flows/production-plan.flow');
const ProductionShiftsFlow = require('./flows/production-shifts.flow');
const WorkspaceFlow = require('./flows/workspace.flow');

async function closeModalBestEffort(page, modalLocator) {
  const closeByLabel = modalLocator.getByRole('button', { name: /закрыть|отмена/i }).first();
  if (await closeByLabel.count()) {
    await closeByLabel.click();
  } else {
    await page.keyboard.press('Escape');
    if (await modalLocator.isVisible().catch(() => false)) {
      await modalLocator.click({ position: { x: 5, y: 5 }, force: true });
    }
  }
  await expect(modalLocator).toBeHidden({ timeout: 10000 });
}

test.describe.serial('Pages and modals smoke', () => {
  test.beforeAll(async () => {
    resetDatabaseFromSnapshot('baseline-with-routes-and-directories');
    await restartServer();
  });

  test.afterAll(async () => {
    await stopServer();
  });

  test('opens core overlays and page modals', async ({ page }) => {
    const diagnostics = attachDiagnostics(page);
    const authFlow = new AuthFlow(page);
    const cardsFlow = new CardsFlow(page);
    const productionPlanFlow = new ProductionPlanFlow(page);
    const productionShiftsFlow = new ProductionShiftsFlow(page);
    const workspaceFlow = new WorkspaceFlow(page);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('#login-help-btn').click();
    await expect(page.locator('#help-overlay')).toBeVisible();
    await closeModalBestEffort(page, page.locator('#help-overlay'));

    await page.locator('#login-qr-btn').click();
    await expect(page.locator('#barcode-scanner-modal')).toBeVisible();
    await closeModalBestEffort(page, page.locator('#barcode-scanner-modal'));

    await authFlow.login();

    await cardsFlow.openList();
    await cardsFlow.openFirstCardModal();
    await closeModalBestEffort(page, page.locator('#card-modal'));

    await cardsFlow.openFirstAttachments();
    await closeModalBestEffort(page, page.locator('#attachments-modal'));

    await cardsFlow.openFirstDeleteConfirm();
    await closeModalBestEffort(page, page.locator('#delete-confirm-modal'));

    await cardsFlow.openFirstApprovalDialog();
    await closeModalBestEffort(page, page.locator('#approval-dialog-modal'));

    await productionPlanFlow.openPage();
    await productionPlanFlow.openPlanModal();
    await closeModalBestEffort(page, page.locator('#production-shift-plan-modal'));

    await productionShiftsFlow.openPage();
    await productionShiftsFlow.openShiftLog();
    await closeModalBestEffort(page, page.locator('#production-shift-log-modal'));

    await workspaceFlow.openPage();

    const barcodeButton = page.locator('.barcode-view-btn').first();
    if (await barcodeButton.count()) {
      await barcodeButton.click();
      await expect(page.locator('#barcode-modal')).toBeVisible();
      await closeModalBestEffort(page, page.locator('#barcode-modal'));
    }

    const itemsButton = page.locator('.items-view-btn').first();
    if (await itemsButton.count()) {
      await itemsButton.click();
      await expect(page.locator('#items-modal')).toBeVisible();
      await closeModalBestEffort(page, page.locator('#items-modal'));
    }

    const stopButton = page.locator('details.workspace-card button[data-action="stop"]').first();
    if (await stopButton.count()) {
      await stopButton.click();
      await expect(page.locator('#workspace-stop-modal')).toBeVisible();
      await closeModalBestEffort(page, page.locator('#workspace-stop-modal'));
    }

    const blockedInfoButton = page.locator('.workspace-op-blocked-info').first();
    if (await blockedInfoButton.count()) {
      await blockedInfoButton.click();
      await expect(page.locator('#workspace-blocked-info-modal')).toBeVisible();
      await closeModalBestEffort(page, page.locator('#workspace-blocked-info-modal'));
    }

    const dryingButton = page.locator('details.workspace-card button[data-action="drying"]').first();
    if (await dryingButton.count()) {
      await dryingButton.click();
      await expect(page.locator('#drying-modal')).toBeVisible();
      await closeModalBestEffort(page, page.locator('#drying-modal'));
    }

    await page.goto('/operations', { waitUntil: 'domcontentloaded' });
    const addDirectoryButton = page.getByRole('button', { name: /добавить/i }).first();
    if (await addDirectoryButton.count()) {
      await addDirectoryButton.click();
      await expect(page.locator('#directory-modal')).toBeVisible();
      await closeModalBestEffort(page, page.locator('#directory-modal'));
    }

    await page.goto('/users', { waitUntil: 'domcontentloaded' });
    const addUserButton = page.getByRole('button', { name: /добавить/i }).first();
    if (await addUserButton.count()) {
      await addUserButton.click();
      await expect(page.locator('#user-modal')).toBeVisible();
      await closeModalBestEffort(page, page.locator('#user-modal'));
    }

    await page.goto('/accessLevels', { waitUntil: 'domcontentloaded' });
    const addAccessButton = page.getByRole('button', { name: /добавить/i }).first();
    if (await addAccessButton.count()) {
      await addAccessButton.click();
      await expect(page.locator('#access-level-modal')).toBeVisible();
      await closeModalBestEffort(page, page.locator('#access-level-modal'));
    }

    expectNoCriticalClientFailures(diagnostics);
  });
});
