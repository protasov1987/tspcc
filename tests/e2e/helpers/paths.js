const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const runtimeDir = path.resolve(__dirname, '..', '.runtime');

module.exports = {
  repoRoot,
  runtimeDir,
  dataDbPath: path.join(repoRoot, 'data', 'database.json'),
  serverEntryPath: path.join(repoRoot, 'server.js'),
  port: Number(process.env.PLAYWRIGHT_PORT || 8401),
  host: process.env.PLAYWRIGHT_HOST || '127.0.0.1',
  get baseURL() {
    return process.env.PLAYWRIGHT_BASE_URL || `http://${this.host}:${this.port}`;
  }
};
