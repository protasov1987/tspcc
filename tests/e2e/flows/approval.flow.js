const { expect } = require('@playwright/test');
const BaseFlow = require('./base.flow');

class ApprovalFlow extends BaseFlow {
  async openList() {
    await this.open('/approvals');
  }

  async openFirstDialog() {
    await this.page.locator('.approval-dialog-btn').first().click();
    await expect(this.page.locator('#approval-dialog-modal')).toBeVisible();
  }
}

module.exports = ApprovalFlow;
