// === РЕНДЕРИНГ ДАШБОРДА ===
function renderDashboard() {
  const statsContainer = document.getElementById('dashboard-stats');
  const activeCards = cards.filter(c => c && !c.archived && c.cardType === 'MKI');
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
  const emptyMessage = getDashboardEmptyMessageHtml();
  const tableHeader = getDashboardTableHeaderHtml();

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

  const rowsHtml = eligibleCards.map(card => buildDashboardRowHtml(card));

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

function getDashboardTableHeaderHtml() {
  return '<thead><tr><th>Маршрутная карта №</th><th>Наименование изделия</th><th>Статус / операции</th><th>Сделано деталей</th><th>Выполнено операций</th><th>Комментарии</th></tr></thead>';
}

function getDashboardEmptyMessageHtml() {
  return '<p>Карт для отображения пока нет.</p>';
}

function getDashboardEligibleCards() {
  return cards.filter(card => {
    if (!card || card.archived || card.cardType !== 'MKI') return false;
    const state = getCardProcessState(card);
    return state && state.key !== 'NOT_STARTED';
  });
}

function buildDashboardRowHtml(card) {
  const opsArr = card.operations || [];
  const state = getCardProcessState(card);
  let opsForDisplay = [];
  const activeOps = opsArr.filter(o => o.status === 'IN_PROGRESS' || o.status === 'PAUSED');
  const statusHtml = buildDashboardLikeStatusHtml(card);

  if (state.key === 'DONE') {
    opsForDisplay = [];
  } else if (!opsArr.length || opsArr.every(o => o.status === 'NOT_STARTED' || !o.status)) {
    opsForDisplay = [];
  } else if (activeOps.length) {
    opsForDisplay = activeOps;
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
  const displayRouteNumber = (card.routeCardNumber || card.orderNo || '').toString().trim() || barcodeValue;
  return '<tr data-card-id="' + card.id + '">' +
    '<td>' +
      '<div class="mk-cell">' +
        '<div class="mk-no">' + escapeHtml(displayRouteNumber) + '</div>' +
        '<div class="mk-qr">(' + escapeHtml(barcodeValue) + ')</div>' +
      '</div>' +
    '</td>' +
    '<td>' + nameCell + '</td>' +
    '<td><span class="dashboard-card-status" data-card-id="' + card.id + '">' + statusHtml + '</span></td>' +
    '<td>' + qtyCell + '</td>' +
    '<td>' + completedCount + ' из ' + (card.operations ? card.operations.length : 0) + '</td>' +
    '<td>' + commentCell + '</td>' +
    '</tr>';
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

function updateDashboardRowLiveFields(card) {
  if (!card || !card.id) return;
  const statusEl = document.querySelector('.dashboard-card-status[data-card-id="' + card.id + '"]');
  if (statusEl) {
    const newHtml = buildDashboardLikeStatusHtml(card);
    if (statusEl.innerHTML !== newHtml) statusEl.innerHTML = newHtml;
  }
}

function insertDashboardRowLive(card) {
  if (!card || location.pathname !== '/dashboard') return;
  if (!getDashboardEligibleCards().some(item => item.id === card.id)) return;

  const wrapper = document.getElementById('dashboard-cards');
  if (!wrapper) return;

  const existingRow = wrapper.querySelector('tr[data-card-id="' + card.id + '"]');
  if (existingRow) return;

  const eligibleCards = getDashboardEligibleCards();
  const orderMap = new Map();
  eligibleCards.forEach((item, index) => {
    if (item && item.id) orderMap.set(item.id, index);
  });
  const targetOrder = orderMap.get(card.id);
  if (typeof targetOrder !== 'number') return;

  const rows = Array.from(wrapper.querySelectorAll('tr[data-card-id]'));
  const rowsHtml = rows.map(row => row.outerHTML);
  const rowHtml = buildDashboardRowHtml(card);
  let insertAt = rowsHtml.length;

  for (let i = 0; i < rows.length; i++) {
    const rowId = rows[i].getAttribute('data-card-id');
    const rowOrder = orderMap.get(rowId);
    if (typeof rowOrder === 'number' && rowOrder > targetOrder) {
      insertAt = i;
      break;
    }
  }

  if (window.dashboardPager && typeof window.dashboardPager.render === 'function') {
    rowsHtml.splice(insertAt, 0, rowHtml);
    window.dashboardPager.render({
      headerHtml: getDashboardTableHeaderHtml(),
      rowsHtml,
      emptyMessage: getDashboardEmptyMessageHtml()
    });
    return;
  }

  const tbody = wrapper.querySelector('tbody');
  if (!tbody) return;
  const rowWrapper = document.createElement('tbody');
  rowWrapper.innerHTML = rowHtml;
  const row = rowWrapper.firstElementChild;
  if (!row) return;
  if (insertAt >= rows.length) {
    tbody.appendChild(row);
  } else {
    tbody.insertBefore(row, rows[insertAt]);
  }
}
