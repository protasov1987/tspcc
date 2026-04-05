const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  STYLE_START_MARKER,
  STYLE_END_MARKER,
  SCRIPT_START_MARKER,
  SCRIPT_END_MARKER,
  STYLE_ASSET_PATHS,
  SCRIPT_ASSET_PATHS,
  JS_CHUNK_GROUPS
} = require('./asset-manifest');

const ROOT_DIR = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const DIST_ASSETS_DIR = path.join(DIST_DIR, 'assets');
const INDEX_PATH = path.join(ROOT_DIR, 'index.html');
const VERSION_PATH = path.join(ROOT_DIR, 'app-version.json');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function cleanDist() {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  ensureDir(DIST_ASSETS_DIR);
}

function readUtf8(absPath) {
  return fs.readFileSync(absPath, 'utf8');
}

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
}

function replaceBlock(source, startMarker, endMarker, nextBlock) {
  const startIndex = source.indexOf(startMarker);
  const endIndex = source.indexOf(endMarker);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(`Unable to locate asset block markers: ${startMarker} .. ${endMarker}`);
  }
  const afterEnd = endIndex + endMarker.length;
  return source.slice(0, startIndex) + nextBlock + source.slice(afterEnd);
}

function toAbsPath(assetPath) {
  return path.join(ROOT_DIR, assetPath.replace(/^\/+/, '').replace(/\//g, path.sep));
}

function buildCssBundle() {
  const chunks = STYLE_ASSET_PATHS.map((assetPath) => {
    const absPath = toAbsPath(assetPath);
    const css = readUtf8(absPath);
    return `/* ${assetPath} */\n${css.trimEnd()}\n`;
  });
  const bundle = chunks.join('\n');
  const fileName = `app.${hashContent(bundle)}.css`;
  const outputPath = path.join(DIST_ASSETS_DIR, fileName);
  fs.writeFileSync(outputPath, bundle, 'utf8');
  return { fileName, outputPath };
}

function buildJsBundle(chunkKey, assetPaths) {
  const chunks = assetPaths.map((assetPath) => {
    const absPath = toAbsPath(assetPath);
    const js = readUtf8(absPath);
    return [
      `// BEGIN ${assetPath}`,
      js.trimEnd(),
      `// END ${assetPath}`,
      ';'
    ].join('\n');
  });
  const bundle = chunks.join('\n\n');
  const fileName = `${chunkKey}.${hashContent(bundle)}.js`;
  const outputPath = path.join(DIST_ASSETS_DIR, fileName);
  fs.writeFileSync(outputPath, bundle, 'utf8');
  return { fileName, outputPath };
}

function buildJsBundles() {
  const bundles = {};
  Object.entries(JS_CHUNK_GROUPS).forEach(([chunkKey, assetPaths]) => {
    bundles[chunkKey] = buildJsBundle(chunkKey, assetPaths);
  });
  return bundles;
}

function renderStyleBlock(bundleFileName) {
  return [
    STYLE_START_MARKER,
    `  <link rel="stylesheet" href="/assets/${bundleFileName}" />`,
    `  ${STYLE_END_MARKER}`
  ].join('\n');
}

function renderInlineRuntimeManifest(versionMeta, chunkBundles) {
  const payload = {
    version: versionMeta,
    chunks: Object.fromEntries(
      Object.entries(chunkBundles).map(([chunkKey, bundle]) => [chunkKey, `/assets/${bundle.fileName}`])
    )
  };
  const json = JSON.stringify(payload).replace(/<\//g, '<\\/');
  return `  <script>window.__APP_ASSET_MANIFEST__ = ${json};</script>`;
}

function renderScriptBlock(versionMeta, chunkBundles) {
  return [
    SCRIPT_START_MARKER,
    renderInlineRuntimeManifest(versionMeta, chunkBundles),
    `  <script src="/assets/${chunkBundles.core.fileName}" defer></script>`,
    `  ${SCRIPT_END_MARKER}`
  ].join('\n');
}

function buildIndexHtml(versionMeta, cssBundle, chunkBundles) {
  const source = readUtf8(INDEX_PATH);
  const withStyles = replaceBlock(source, STYLE_START_MARKER, STYLE_END_MARKER, renderStyleBlock(cssBundle.fileName));
  const withScripts = replaceBlock(withStyles, SCRIPT_START_MARKER, SCRIPT_END_MARKER, renderScriptBlock(versionMeta, chunkBundles));
  fs.writeFileSync(path.join(DIST_DIR, 'index.html'), withScripts, 'utf8');
}

function readVersionMeta() {
  return JSON.parse(readUtf8(VERSION_PATH));
}

function writeManifest(versionMeta, cssBundle, chunkBundles) {
  const manifestPath = path.join(DIST_DIR, 'asset-manifest.json');
  const payload = {
    version: versionMeta,
    generatedAt: new Date().toISOString(),
    assets: {
      css: `/assets/${cssBundle.fileName}`,
      core: `/assets/${chunkBundles.core.fileName}`
    },
    chunks: Object.fromEntries(
      Object.entries(chunkBundles).map(([chunkKey, bundle]) => [chunkKey, `/assets/${bundle.fileName}`])
    ),
    legacySources: {
      styles: STYLE_ASSET_PATHS,
      scripts: SCRIPT_ASSET_PATHS,
      chunkGroups: JS_CHUNK_GROUPS
    }
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function main() {
  cleanDist();
  const versionMeta = readVersionMeta();
  const cssBundle = buildCssBundle();
  const chunkBundles = buildJsBundles();
  buildIndexHtml(versionMeta, cssBundle, chunkBundles);
  writeManifest(versionMeta, cssBundle, chunkBundles);
  process.stdout.write(`Built dist with ${cssBundle.fileName} and ${chunkBundles.core.fileName}\n`);
}

main();
