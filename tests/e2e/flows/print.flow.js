const { expect } = require('@playwright/test');
const BaseFlow = require('./base.flow');

class PrintFlow extends BaseFlow {
  async openBarcodeModalFromWorkspaceCard() {
    await this.page.locator('.barcode-view-btn').first().click();
    await expect(this.page.locator('#barcode-modal')).toBeVisible();
  }
}

module.exports = PrintFlow;
