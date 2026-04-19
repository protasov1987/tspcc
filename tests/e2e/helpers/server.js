const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { host, port, baseURL, repoRoot, serverEntryPath, runtimeDir } = require('./paths');

let serverProcess = null;

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
}

async function restartServer() {
  await stopServer();
  fs.mkdirSync(runtimeDir, { recursive: true });
  const logPath = path.join(runtimeDir, 'playwright-server.log');
  const out = fs.openSync(logPath, 'a');
  serverProcess = spawn(process.execPath, [serverEntryPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: host
    },
    stdio: ['ignore', out, out]
  });
  await waitForHttpReady(baseURL, 30000);
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
