const BaseFlow = require('./base.flow');

class ProvisionFlow extends BaseFlow {
  async openList() {
    await this.open('/provision');
  }
}

module.exports = ProvisionFlow;
