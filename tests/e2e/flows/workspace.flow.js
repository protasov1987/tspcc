const { expect } = require('@playwright/test');
const BaseFlow = require('./base.flow');

class WorkspaceFlow extends BaseFlow {
  async openPage() {
    await this.open('/workspace');
  }

  async getFirstCardWithAction(actionNames = ['pause', 'start']) {
    const target = await this.page.evaluate((actions) => {
      const cards = [...document.querySelectorAll('details.workspace-card[data-card-id]')];
      for (const cardEl of cards) {
        const cardId = cardEl.getAttribute('data-card-id');
        const title = (cardEl.querySelector('summary')?.textContent || '').trim().replace(/\s+/g, ' ');
        const buttons = [...cardEl.querySelectorAll('button[data-action]')];
        for (const button of buttons) {
          const action = button.getAttribute('data-action');
          if (actions.includes(action) && !button.disabled) {
            return {
              cardId,
              title,
              action,
              opId: button.getAttribute('data-op-id') || null,
              text: (button.textContent || '').trim()
            };
          }
        }
      }
      return null;
    }, actionNames);
    if (target?.cardId) {
      await this.ensureCardExpanded(target.cardId);
    }
    return target;
  }

  card(cardId) {
    return this.page.locator(`details.workspace-card[data-card-id="${cardId}"]`).first();
  }

  actionButton(cardId, action, { opId = '' } = {}) {
    const opSelector = opId ? `[data-op-id="${opId}"]` : '';
    return this.card(cardId).locator(`button${opSelector}[data-action="${action}"]`).first();
  }

  async ensureCardExpanded(cardId) {
    const card = this.card(cardId);
    await expect(card).toBeVisible();
    const isOpen = await card.evaluate((node) => node.hasAttribute('open'));
    if (!isOpen) {
      await card.evaluate((node) => node.setAttribute('open', ''));
    }
    await expect.poll(async () => card.evaluate((node) => node.hasAttribute('open'))).toBe(true);
  }

  async readCardActionState(cardId) {
    return this.page.evaluate((targetCardId) => {
      const cardEl = document.querySelector(`details.workspace-card[data-card-id="${targetCardId}"]`);
      if (!cardEl) return null;
      return {
        text: (cardEl.textContent || '').trim().replace(/\s+/g, ' '),
        actions: [...cardEl.querySelectorAll('button[data-action]')].map((button) => ({
          action: button.getAttribute('data-action'),
          text: (button.textContent || '').trim(),
          disabled: !!button.disabled
        }))
      };
    }, cardId);
  }

  async readOperationActionArea(cardId, opId) {
    return this.page.evaluate(({ targetCardId, targetOpId }) => {
      const cardEl = document.querySelector(`details.workspace-card[data-card-id="${targetCardId}"]`);
      if (!cardEl || !targetOpId) return null;
      const buttons = [...cardEl.querySelectorAll(`button[data-op-id="${targetOpId}"][data-action]`)];
      return {
        signature: buttons.map((button) => {
          const action = button.getAttribute('data-action') || '';
          const text = (button.textContent || '').trim();
          if (action === 'op-comments') return `${action}:${text}`;
          return `${action}:${text}`;
        }).join('|'),
        pendingActions: buttons
          .filter((button) => button.getAttribute('aria-busy') === 'true' || button.classList.contains('workspace-action-pending'))
          .map((button) => button.getAttribute('data-action') || '')
      };
    }, { targetCardId: cardId, targetOpId: opId });
  }

  async waitForOperationActionAreaChange(cardId, opId, previousSignature) {
    await expect.poll(async () => {
      const state = await this.readOperationActionArea(cardId, opId);
      return state?.signature || '__missing__';
    }).not.toBe(previousSignature);
  }

  async waitForOperationPendingState(cardId, opId, action) {
    await expect.poll(async () => {
      const state = await this.readOperationActionArea(cardId, opId);
      return state?.pendingActions || [];
    }).toContain(action);
  }

  async performCardAction(cardId, action, { opId = '' } = {}) {
    await this.ensureCardExpanded(cardId);
    await expect(this.actionButton(cardId, action, { opId })).toBeVisible();
    await this.actionButton(cardId, action, { opId }).click();
  }

  async waitForCardStateChange(cardId, previousText) {
    await expect.poll(async () => {
      const state = await this.readCardActionState(cardId);
      return state?.text || '';
    }).not.toBe(previousText);
  }
}

module.exports = WorkspaceFlow;
