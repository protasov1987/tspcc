// === ТАЙМЕР ===
function updateCardsStatusTimers() {
  const nodes = document.querySelectorAll('.cards-status-text[data-card-id]');
  nodes.forEach(node => {
    const cardId = node.getAttribute('data-card-id');
    const card = cards.find(c => c.id === cardId);
    if (!card) return;
    node.textContent = cardStatusText(card);
  });
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
}
