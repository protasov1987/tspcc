const { stopServer } = require('./helpers/server');

module.exports = async () => {
  await stopServer();
};
