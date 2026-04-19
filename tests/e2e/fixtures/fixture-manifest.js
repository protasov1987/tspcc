const path = require('path');

const baselineCore = path.resolve(__dirname, 'baseline-core.database.json');

module.exports = {
  'baseline-empty-or-clean': baselineCore,
  'baseline-with-routes-and-directories': baselineCore,
  'baseline-with-production-fixtures': baselineCore,
  'baseline-with-archive-fixtures': baselineCore
};
