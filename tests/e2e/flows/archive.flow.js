const BaseFlow = require('./base.flow');

class ArchiveFlow extends BaseFlow {
  async openPage() {
    await this.open('/archive');
  }
}

module.exports = ArchiveFlow;
