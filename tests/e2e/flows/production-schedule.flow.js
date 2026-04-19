const { expect } = require('@playwright/test');
const BaseFlow = require('./base.flow');

class ProductionScheduleFlow extends BaseFlow {
  async openPage() {
    await this.open('/production/schedule');
  }

  async openEditorAndAssert() {
    await this.page.locator('#production-editor-toggle').click();
    await expect(this.page.locator('#production-add')).toBeVisible();
  }
}

module.exports = ProductionScheduleFlow;
