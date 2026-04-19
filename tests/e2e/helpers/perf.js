const { expect } = require('@playwright/test');

async function captureActionTiming(page, action, settle) {
  const t0 = Date.now();
  await action();
  const feedbackMs = Date.now() - t0;
  if (settle) {
    await settle();
  }
  const totalMs = Date.now() - t0;
  return { feedbackMs, totalMs };
}

function expectWithinBudget(metricName, actual, budgetMs) {
  expect.soft(actual, `${metricName} exceeded ${budgetMs}ms, got ${actual}ms`).toBeLessThanOrEqual(budgetMs);
}

module.exports = {
  captureActionTiming,
  expectWithinBudget
};
