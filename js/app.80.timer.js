// === ТАЙМЕР ===
function updateCardsStatusTimers() {
  if (typeof updateDashboardTimers === 'function') updateDashboardTimers();
}

function tickTimers() {
  const rows = getAllRouteRows().filter(r => r.op.status === 'IN_PROGRESS' && r.op.startedAt);
  rows.forEach(row => {
    const card = row.card;
    const op = row.op;
    const rowId = card.id + '::' + op.id;
    const spans = document.querySelectorAll('.wo-timer[data-row-id="' + rowId + '"]');
    const elapsedSec = getOperationElapsedSeconds(op);
    spans.forEach(span => {
      span.textContent = formatSecondsToHMS(elapsedSec);
    });
  });

  refreshCardStatuses();
  updateCardsStatusTimers();
  renderDashboard();
  updateDashboardTimers();
}
