const BaseFlow = require('./base.flow');

class InputControlFlow extends BaseFlow {
  async openList() {
    await this.open('/input-control');
  }
}

module.exports = InputControlFlow;
