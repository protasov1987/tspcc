const path = require('path');
const { execFileSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const buildScript = path.join(__dirname, 'build-frontend.js');
const serverEntry = path.join(rootDir, 'server.js');

execFileSync(process.execPath, [buildScript], {
  cwd: rootDir,
  stdio: 'inherit',
  env: process.env,
});

process.env.USE_DIST_ASSETS = 'true';
process.env.APP_STATIC_MODE = 'dist';

require(serverEntry);