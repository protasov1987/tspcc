const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test.describe('diagnostics prefix contract', () => {
  test('uses normalized diagnostics prefixes in application code', () => {
    const sources = [
      'js/app.00.state.js',
      'js/app.10.utils.js',
      'js/app.40.store.js',
      'js/app.50.auth.js',
      'js/app.75.production.js',
      'js/app.81.navigation.js',
      'js/app.95.messenger.js',
      'js/app.99.init.js',
      'server.js'
    ].map(readRepoFile).join('\n');

    for (const prefix of ['[BOOT]', '[ROUTE]', '[LIVE]', '[DATA]', '[CONFLICT]']) {
      expect(sources, `${prefix} must be present in application diagnostics`).toContain(prefix);
    }

    expect(sources, 'legacy route diagnostic tags should be normalized under [ROUTE]').not.toMatch(/\[(?:ROUTE_MATCH|ROUTE_MOUNT|ROUTE_INIT|MOUNT)\]/);
  });
});
