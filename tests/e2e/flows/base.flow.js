const { openRouteAndAssert } = require('../helpers/navigation');

class BaseFlow {
  constructor(page) {
    this.page = page;
  }

  async open(route) {
    await openRouteAndAssert(this.page, route);
  }
}

module.exports = BaseFlow;
