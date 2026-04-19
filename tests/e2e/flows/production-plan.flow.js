const { expect } = require('@playwright/test');
const BaseFlow = require('./base.flow');

class ProductionPlanFlow extends BaseFlow {
  async openPage() {
    await this.open('/production/plan');
  }

  async openPlanModal() {
    await this.page.locator('.production-shift-plan-btn').first().click();
    await expect(this.page.locator('#production-shift-plan-modal')).toBeVisible();
  }
}

module.exports = ProductionPlanFlow;
