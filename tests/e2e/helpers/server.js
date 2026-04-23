const { spawn, execFileSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { host, port, baseURL, repoRoot, serverEntryPath, runtimeDir, runtimeDataDir } = require('./paths');

let serverProcess = null;

function listListeningPidsForPort(targetPort) {
  const normalizedPort = String(targetPort).trim();
  if (!normalizedPort) return [];

  try {
    if (process.platform === 'win32') {
      const output = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' });
      return Array.from(new Set(
        output
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line && /\bLISTENING\b/i.test(line))
          .map((line) => line.split(/\s+/))
          .filter((parts) => parts.length >= 5 && parts[1].endsWith(`:${normalizedPort}`))
          .map((parts) => parseInt(parts[parts.length - 1], 10))
          .filter((pid) => Number.isFinite(pid) && pid > 0)
      ));
    }

    const output = execFileSync('lsof', ['-nP', `-iTCP:${normalizedPort}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' });
    return Array.from(new Set(
      output
        .split(/\r?\n/)
        .map((line) => parseInt(String(line || '').trim(), 10))
        .filter((pid) => Number.isFinite(pid) && pid > 0)
    ));
  } catch (err) {
    return [];
  }
}

function isPidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return false;
  }
}

async function terminatePid(pid) {
  if (!Number.isFinite(pid) || pid <= 0 || !isPidAlive(pid)) return;
  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    return;
  }

  const startedAt = Date.now();
  while (isPidAlive(pid) && Date.now() - startedAt < 5000) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (!isPidAlive(pid)) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch (err) {}
}

async function killLingeringPortListeners(targetPort, { excludePids = [] } = {}) {
  const excluded = new Set(
    (Array.isArray(excludePids) ? excludePids : [excludePids])
      .map((pid) => parseInt(pid, 10))
      .filter((pid) => Number.isFinite(pid) && pid > 0)
  );
  const pids = listListeningPidsForPort(targetPort).filter((pid) => !excluded.has(pid));
  for (const pid of pids) {
    await terminatePid(pid);
  }
}

async function waitForPortOwner(targetPort, expectedPid, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const owners = listListeningPidsForPort(targetPort);
    if (owners.includes(expectedPid)) {
      return { ownerPid: expectedPid, totalMs: Date.now() - startedAt };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not claim port ${targetPort} within ${timeoutMs}ms (expected pid ${expectedPid})`);
}

function waitForHttpReady(url, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const poll = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve({ statusCode: res.statusCode, totalMs: Date.now() - startedAt });
      });
      req.on('error', () => {
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`Server did not become ready within ${timeoutMs}ms: ${url}`));
          return;
        }
        setTimeout(poll, 250);
      });
    };
    poll();
  });
}

async function stopServer() {
  if (!serverProcess) return;
  const proc = serverProcess;
  serverProcess = null;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch (err) {}
      resolve();
    }, 5000);
    proc.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      proc.kill('SIGTERM');
    } catch (err) {
      clearTimeout(timer);
      resolve();
    }
  });
  await killLingeringPortListeners(port);
}

async function restartServer() {
  await stopServer();
  await killLingeringPortListeners(port);
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.mkdirSync(runtimeDataDir, { recursive: true });
  const logPath = path.join(runtimeDir, 'playwright-server.log');
  const out = fs.openSync(logPath, 'a');
  serverProcess = spawn(process.execPath, [serverEntryPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: host,
      TSPCC_DATA_DIR: runtimeDataDir
    },
    stdio: ['ignore', out, out]
  });
  if (!serverProcess || !Number.isFinite(serverProcess.pid)) {
    throw new Error('Failed to start Playwright runtime server process');
  }
  await waitForHttpReady(baseURL, 30000);
  await waitForPortOwner(port, serverProcess.pid, 10000);
  return {
    pid: serverProcess.pid,
    baseURL,
    logPath
  };
}

module.exports = {
  restartServer,
  stopServer,
  waitForHttpReady
};
