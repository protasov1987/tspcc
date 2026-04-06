const STYLE_START_MARKER = '<!-- APP_STYLE_ASSET_START -->';
const STYLE_END_MARKER = '<!-- APP_STYLE_ASSET_END -->';
const SCRIPT_START_MARKER = '<!-- APP_SCRIPT_ASSETS_START -->';
const SCRIPT_END_MARKER = '<!-- APP_SCRIPT_ASSETS_END -->';

const STYLE_ASSET_PATHS = ['/style.css'];

const JS_CHUNK_GROUPS = {
  core: [
    '/js/app.02.loading-ui.js',
    '/js/app.03.skeletons.registry.js',
    '/js/app.00.state.js',
    '/js/app.10.utils.js',
    '/js/app.20.routeModel.js',
    '/js/app.30.imdx.js',
    '/js/app.40.store.js',
    '/js/app.50.auth.js',
    '/js/app.80.timer.js',
    '/js/app.81.navigation.js',
    '/js/app.83.render.common.js',
    '/js/app.99.init.js'
  ],
  dashboard: [
    '/dashboard.js',
    '/js/app.60.render.dashboard.js'
  ],
  'route-searches': [
    '/js/app.82.route-searches.js'
  ],
  'cards-list': [
    '/js/app.70.render.cards.js',
  ],
  'cards-page': [
    '/js/app.71.cardRoute.modal.js',
    '/js/app.82.forms.js'
  ],
  'cards-scanner': [
    '/barcodeScanner.js'
  ],
  directories: [
    '/js/app.72.directories.js',
    '/js/app.72.directories.pages.js'
  ],
  'items-base': [
    '/js/app.73.receipts.js'
  ],
  receipts: [
    '/js/app.73.receipts-list.js'
  ],
  approvals: [
    '/js/app.74.approvals.js'
  ],
  production: [
    '/js/app.75.production.js'
  ],
  security: [
    '/js/app.90.usersAccess.js'
  ],
  messenger: [
    '/js/app.95.messenger.js',
    '/js/app.96.webpush.js'
  ]
};

const SCRIPT_ASSET_PATHS = [
  '/js/app.02.loading-ui.js',
  '/js/app.03.skeletons.registry.js',
  '/js/app.00.state.js',
  '/js/app.10.utils.js',
  '/js/app.20.routeModel.js',
  '/js/app.30.imdx.js',
  '/js/app.40.store.js',
  '/js/app.50.auth.js',
  '/js/app.80.timer.js',
  '/js/app.81.navigation.js',
  '/js/app.83.render.common.js',
  '/js/app.99.init.js',
  '/dashboard.js',
  '/js/app.60.render.dashboard.js',
  '/js/app.82.route-searches.js',
  '/js/app.70.render.cards.js',
  '/js/app.71.cardRoute.modal.js',
  '/js/app.82.forms.js',
  '/barcodeScanner.js',
  '/js/app.72.directories.js',
  '/js/app.72.directories.pages.js',
  '/js/app.73.receipts.js',
  '/js/app.73.receipts-list.js',
  '/js/app.74.approvals.js',
  '/js/app.75.production.js',
  '/js/app.90.usersAccess.js',
  '/js/app.95.messenger.js',
  '/js/app.96.webpush.js'
];

module.exports = {
  STYLE_START_MARKER,
  STYLE_END_MARKER,
  SCRIPT_START_MARKER,
  SCRIPT_END_MARKER,
  STYLE_ASSET_PATHS,
  SCRIPT_ASSET_PATHS,
  JS_CHUNK_GROUPS
};
