const BaseFlow = require('./base.flow');
const { openRouteAndAssert } = require('../helpers/navigation');

class NavigationFlow extends BaseFlow {
  async openRoute(route) {
    await openRouteAndAssert(this.page, route);
  }
}

module.exports = NavigationFlow;
