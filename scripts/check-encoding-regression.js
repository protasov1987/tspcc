const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TARGETS = [
  'server.js',
  'db.js',
  'index.html',
  'style.css',
  'js',
  'scripts',
  path.join('data', 'database.json')
];

const IGNORED_FILES = new Set([
  path.resolve(ROOT, 'scripts', 'repair-text-corruption.js')
]);

const MOJIBAKE_PATTERNS = [
  /[РС][\u0400-\u040F\u0450-\u045F]/u,
  /[ÐÑ][\u0080-\u00BF]/u
];

function collectFiles(targetPath, acc = []) {
  const absPath = path.resolve(ROOT, targetPath);
  if (!fs.existsSync(absPath)) return acc;
  const stat = fs.statSync(absPath);
  if (stat.isDirectory()) {
    if (path.basename(absPath) === '__pycache__') return acc;
    fs.readdirSync(absPath).sort().forEach(entry => {
      collectFiles(path.join(targetPath, entry), acc);
    });
    return acc;
  }
  if (!['.js', '.json', '.html', '.css'].includes(path.extname(absPath))) return acc;
  if (!IGNORED_FILES.has(absPath)) {
    acc.push(absPath);
  }
  return acc;
}

function trimPreview(line) {
  return line.length > 220 ? `${line.slice(0, 217)}...` : line;
}

function scanFile(filePath) {
  const relPath = path.relative(ROOT, filePath).replace(/\\/g, '/');
  const text = fs.readFileSync(filePath, 'utf8');
  const hits = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.includes('\uFFFD')) {
      hits.push({
        file: relPath,
        line: index + 1,
        kind: 'replacement',
        preview: trimPreview(line)
      });
    }
    if (MOJIBAKE_PATTERNS.some(pattern => pattern.test(line))) {
      hits.push({
        file: relPath,
        line: index + 1,
        kind: 'mojibake',
        preview: trimPreview(line)
      });
    }
  });
  return hits;
}

function main() {
  const files = TARGETS.flatMap(target => collectFiles(target));
  const hits = files.flatMap(scanFile);
  if (!hits.length) {
    console.log('[check-encoding] no encoding regressions found');
    return;
  }

  console.error(`[check-encoding] found ${hits.length} encoding issue(s)`);
  hits.slice(0, 50).forEach(hit => {
    console.error(`${hit.file}:${hit.line} [${hit.kind}] ${hit.preview}`);
  });
  process.exitCode = 1;
}

main();
