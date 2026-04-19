const BaseFlow = require('./base.flow');
const { loginAsAbyss } = require('../helpers/auth');

class AuthFlow extends BaseFlow {
  async login() {
    return loginAsAbyss(this.page);
  }
}

module.exports = AuthFlow;
