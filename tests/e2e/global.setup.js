const fs = require('fs');
const { runtimeDataDir, runtimeDir, runtimeStorageDir } = require('./helpers/paths');

module.exports = async () => {
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.mkdirSync(runtimeDataDir, { recursive: true });
  fs.mkdirSync(runtimeStorageDir, { recursive: true });
};
