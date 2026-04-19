const BaseFlow = require('./base.flow');

class DirectoriesFlow extends BaseFlow {
  async openDepartments() {
    await this.open('/departments');
  }

  async openOperations() {
    await this.open('/operations');
  }

  async openAreas() {
    await this.open('/areas');
  }

  async openEmployees() {
    await this.open('/employees');
  }

  async openShiftTimes() {
    await this.open('/shift-times');
  }
}

module.exports = DirectoriesFlow;
