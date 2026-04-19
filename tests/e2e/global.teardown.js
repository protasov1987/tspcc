const fs = require('fs');
const path = require('path');

const runtimeDir = path.resolve(__dirname, '.runtime');
const sourceDbPath = path.resolve(__dirname, '..', '..', 'data', 'database.json');
const savedDbPath = path.join(runtimeDir, 'database.original.json');

module.exports = async () => {
  if (fs.existsSync(savedDbPath)) {
    fs.copyFileSync(savedDbPath, sourceDbPath);
  }
};
