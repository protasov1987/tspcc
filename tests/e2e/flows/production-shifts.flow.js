const { expect } = require('@playwright/test');
const BaseFlow = require('./base.flow');

class ProductionShiftsFlow extends BaseFlow {
  async openPage() {
    await this.open('/production/shifts');
  }

  async openShiftLog() {
    await this.page.getByRole('button', { name: 'Лог смены' }).first().click();
    await expect(this.page.locator('#production-shift-log-modal')).toBeVisible();
  }
}

module.exports = ProductionShiftsFlow;
