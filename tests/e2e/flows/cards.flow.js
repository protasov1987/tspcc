const { expect } = require('@playwright/test');
const BaseFlow = require('./base.flow');

class CardsFlow extends BaseFlow {
  async openList() {
    await this.open('/cards');
  }

  async openFirstCardModal() {
    await this.page.getByRole('button', { name: 'Открыть' }).first().click();
    await expect(this.page.locator('#card-modal')).toBeVisible();
  }

  async openFirstDeleteConfirm() {
    await this.page.locator('.btn-delete').first().click();
    await expect(this.page.locator('#delete-confirm-modal')).toBeVisible();
  }

  async openFirstApprovalDialog() {
    await this.page.locator('.approval-dialog-btn').first().click();
    await expect(this.page.locator('#approval-dialog-modal')).toBeVisible();
  }

  async openFirstAttachments() {
    await this.page.locator('.clip-btn').first().click();
    await expect(this.page.locator('#attachments-modal')).toBeVisible();
  }
}

module.exports = CardsFlow;
