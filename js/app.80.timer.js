// === ТАЙМЕР ===
function updateCardsStatusTimers() {
  if (typeof updateDashboardTimers === 'function') updateDashboardTimers();
}

function tickTimers() {
  const rows = getAllRouteRows().filter(r => isOperationTimerActive(r.op, r.card));
  rows.forEach(row => {
    const card = row.card;
    const op = row.op;
    const rowId = card.id + '::' + op.id;
    const spans = document.querySelectorAll('.wo-timer[data-row-id="' + rowId + '"]');
    const elapsedSec = getOperationElapsedSeconds(op, card);
    spans.forEach(span => {
      span.textContent = formatSecondsToHMS(elapsedSec);
    });
  });

  document.querySelectorAll('.drying-timer[data-drying-started-at]').forEach(span => {
    const startedAt = span.getAttribute('data-drying-started-at') || '';
    const started = typeof normalizeDryingTimestamp === 'function'
      ? normalizeDryingTimestamp(startedAt)
      : Number(startedAt);
    if (!Number.isFinite(started)) return;
    const elapsedSec = Math.max(0, Math.floor((Date.now() - started) / 1000));
    span.textContent = formatSecondsToHMS(elapsedSec);
  });

  refreshCardStatuses();
  updateCardsStatusTimers();
  renderDashboard();
  updateDashboardTimers();
}
