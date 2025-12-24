// === РЕНДЕРИНГ ДАШБОРДА ===
function renderDashboard() {
  const statsContainer = document.getElementById('dashboard-stats');
  const activeCards = cards.filter(c => !c.archived && !isGroupCard(c));
  const activeStates = activeCards.map(card => getCardProcessState(card));
  const cardsCount = activeCards.length;
  const inWork = activeStates.filter(state => state && state.key === 'IN_PROGRESS').length;
  const done = activeStates.filter(state => state && state.key === 'DONE').length;
  const notStarted = cardsCount - inWork - done;

  statsContainer.innerHTML = '';
  const stats = [
    { label: 'Всего карт', value: cardsCount },
    { label: 'Не запущено', value: notStarted },
    { label: 'В работе', value: inWork },
    { label: 'Завершено', value: done }
  ];
  stats.forEach(st => {
    const div = document.createElement('div');
    div.className = 'stat-block';
    div.innerHTML = '<span>' + st.label + '</span><strong>' + st.value + '</strong>';
    statsContainer.appendChild(div);
  });

  const dashTableWrapper = document.getElementById('dashboard-cards');
  const currentStatusSnapshot = (() => {
    const map = new Map();
    cards.forEach(card => {
      if (card && !card.archived) {
        const state = getCardProcessState(card);
        map.set(card.id, state ? state.key : 'NOT_STARTED');
      }
    });
    return map;
  })();

  const statusChanged = (() => {
    if (!dashboardStatusSnapshot) return true;
    if (dashboardStatusSnapshot.size !== currentStatusSnapshot.size) return true;
    for (const [id, status] of currentStatusSnapshot.entries()) {
      if (dashboardStatusSnapshot.get(id) !== status) return true;
    }
    return false;
  })();

  dashboardStatusSnapshot = currentStatusSnapshot;
  if (statusChanged) {
    dashboardEligibleCache = activeCards.filter(c => {
      const state = getCardProcessState(c);
      return state && state.key !== 'NOT_STARTED';
    });
  }
  const eligibleCards = dashboardEligibleCache;
  const emptyMessage = '<p>Карт для отображения пока нет.</p>';
  const tableHeader = '<thead><tr><th>Маршрутная карта №</th><th>Наименование изделия</th><th>Статус / операции</th><th>Сделано деталей</th><th>Выполнено операций</th><th>Комментарии</th></tr></thead>';

  if (!eligibleCards.length) {
    if (window.dashboardPager && typeof window.dashboardPager.render === 'function') {
      window.dashboardPager.render({
        headerHtml: tableHeader,
        rowsHtml: [],
        emptyMessage
      });
    } else if (dashTableWrapper) {
      dashTableWrapper.innerHTML = emptyMessage;
    }
    return;
  }

  if (!statusChanged) {
    updateDashboardTimers();
    return;
  }

  const rowsHtml = eligibleCards.map(card => {
    const opsArr = card.operations || [];
    const state = getCardProcessState(card);
    const activeOps = opsArr.filter(o => o.status === 'IN_PROGRESS' || o.status === 'PAUSED');
    let statusHtml = '';

    let opsForDisplay = [];
    if (state.key === 'DONE') {
      statusHtml = '<span class="dash-card-completed">Завершена</span>';
    } else if (!opsArr.length || opsArr.every(o => o.status === 'NOT_STARTED' || !o.status)) {
      statusHtml = 'Не запущена';
    } else if (activeOps.length) {
      opsForDisplay = activeOps;
      activeOps.forEach(op => {
        const elapsed = getOperationElapsedSeconds(op);
        const plannedSec = (op.plannedMinutes || 0) * 60;
        let cls = 'dash-op';
        if (op.status === 'PAUSED') {
          cls += ' dash-op-paused';
        }
        if (plannedSec && elapsed > plannedSec) {
          cls += ' dash-op-overdue';
        }
        statusHtml += '<span class="' + cls + '" data-card-id="' + card.id + '" data-op-id="' + op.id + '">' +
          '<span class="dash-op-label">' + renderOpLabel(op) + '</span>' +
          ' — <span class="dash-op-time">' + formatSecondsToHMS(elapsed) + '</span>' +
          '</span>';
      });
    } else {
      const notStartedOps = opsArr.filter(o => o.status === 'NOT_STARTED' || !o.status);
      if (notStartedOps.length) {
        let next = notStartedOps[0];
        notStartedOps.forEach(o => {
          const curOrder = typeof next.order === 'number' ? next.order : 999999;
          const newOrder = typeof o.order === 'number' ? o.order : 999999;
          if (newOrder < curOrder) next = o;
        });
        opsForDisplay = [next];
        statusHtml = renderOpLabel(next) + ' (ожидание)';
      } else {
        statusHtml = 'Не запущена';
      }
    }

    const { qty: qtyTotal, hasValue: hasQty } = getCardPlannedQuantity(card);
    let qtyCell = '—';

    if (state.key === 'DONE' && hasQty) {
      const batchResult = calculateFinalResults(opsArr, qtyTotal || 0);
      const qtyText = (batchResult.good_final || 0) + ' из ' + qtyTotal;
      qtyCell = '<div class="dash-qty-line">' + qtyText + '</div>';
    } else if (opsForDisplay.length && hasQty) {
      const qtyLines = opsForDisplay.map(op => {
        const good = toSafeCount(op.goodCount || 0);
        const qtyText = good + ' из ' + qtyTotal;
        return '<div class="dash-qty-line">' + qtyText + '</div>';
      });
      qtyCell = qtyLines.length ? qtyLines.join('') : '—';
    }

    const completedCount = opsArr.filter(o => o.status === 'DONE').length;
    const commentLines = opsForDisplay
      .filter(o => o.comment)
      .map(o => '<div class="dash-comment-line"><span class="dash-comment-op">' + renderOpLabel(o) + ':</span> ' + escapeHtml(o.comment) + '</div>');
    const commentCell = commentLines.join('');

    const nameCell = escapeHtml(getCardItemName(card));
    const barcodeValue = getCardBarcodeValue(card);
    return '<tr>' +
      '<td>' + escapeHtml(barcodeValue) + '</td>' +
      '<td>' + nameCell + '</td>' +
      '<td><span class="dashboard-card-status" data-card-id="' + card.id + '">' + statusHtml + '</span></td>' +
      '<td>' + qtyCell + '</td>' +
      '<td>' + completedCount + ' из ' + (card.operations ? card.operations.length : 0) + '</td>' +
      '<td>' + commentCell + '</td>' +
      '</tr>';
  });

  if (window.dashboardPager && typeof window.dashboardPager.render === 'function') {
    window.dashboardPager.render({
      headerHtml: tableHeader,
      rowsHtml,
      emptyMessage
    });
  } else if (dashTableWrapper) {
    dashTableWrapper.innerHTML = wrapTable('<table>' + tableHeader + '<tbody>' + rowsHtml.join('') + '</tbody></table>');
  }
}

function updateDashboardTimers() {
  const nodes = document.querySelectorAll('.dashboard-card-status .dash-op[data-card-id][data-op-id]');
  nodes.forEach(node => {
    const cardId = node.getAttribute('data-card-id');
    const opId = node.getAttribute('data-op-id');
    const card = cards.find(c => c.id === cardId);
    const op = card ? (card.operations || []).find(o => o.id === opId) : null;
    if (!op) return;

    const elapsed = getOperationElapsedSeconds(op);
    const plannedSec = (op.plannedMinutes || 0) * 60;
    const timeSpan = node.querySelector('.dash-op-time');

    if (timeSpan) {
      timeSpan.textContent = formatSecondsToHMS(elapsed);
    }

    node.classList.toggle('dash-op-paused', op.status === 'PAUSED');
    node.classList.toggle('dash-op-overdue', plannedSec && elapsed > plannedSec);
  });
}
