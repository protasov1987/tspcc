const { expect } = require('@playwright/test');

function normalizeConsoleText(msg) {
  try {
    return msg.text();
  } catch (err) {
    return '';
  }
}

function attachDiagnostics(page) {
  const state = {
    console: [],
    pageErrors: [],
    requestFailed: [],
    responses: []
  };

  page.on('console', (msg) => {
    const text = normalizeConsoleText(msg);
    state.console.push({
      type: msg.type(),
      text
    });
  });
  page.on('pageerror', (error) => {
    state.pageErrors.push({
      message: error?.message || String(error)
    });
  });
  page.on('requestfailed', (request) => {
    state.requestFailed.push({
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText || 'unknown'
    });
  });
  page.on('response', async (response) => {
    state.responses.push({
      url: response.url(),
      status: response.status(),
      method: response.request().method()
    });
  });
  return state;
}

function getCriticalConsole(diag) {
  return diag.console.filter((entry) => {
    if (!entry) return false;
    if (entry.type !== 'error' && entry.type !== 'warning') return false;
    const text = String(entry.text || '');
    if (!text) return false;
    if (/AbortError|aborted|superseded/i.test(text)) return false;
    return true;
  });
}

function expectNoCriticalClientFailures(diag, { allow409 = false } = {}) {
  expect(diag.pageErrors, `pageerror: ${JSON.stringify(diag.pageErrors, null, 2)}`).toEqual([]);
  const criticalConsole = getCriticalConsole(diag);
  const filteredConsole = criticalConsole.filter((entry) => {
    if (allow409 && /409|flow stale|Версия flow устарела/i.test(entry.text || '')) {
      return false;
    }
    if (/offline-suspected-but-suppressed|allowed noise/i.test(entry.text || '')) {
      return false;
    }
    return true;
  });
  expect(filteredConsole, `critical console: ${JSON.stringify(filteredConsole, null, 2)}`).toEqual([]);
}

function findLastActionResponse(diag, method = 'POST') {
  const responses = diag.responses.filter((entry) => entry.method === method);
  return responses[responses.length - 1] || null;
}

module.exports = {
  attachDiagnostics,
  expectNoCriticalClientFailures,
  findLastActionResponse
};
