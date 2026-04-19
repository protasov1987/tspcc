const BaseFlow = require('./base.flow');

class DelayedDefectsFlow extends BaseFlow {
  async openDelayed() {
    await this.open('/production/delayed');
  }

  async openDefects() {
    await this.open('/production/defects');
  }
}

module.exports = DelayedDefectsFlow;
