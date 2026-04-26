// === МАРШРУТНЫЕ КВИТАНЦИИ ===
function getAllRouteRows() {
  const rows = [];
  cards.forEach(card => {
    if (!card || card.archived || card.cardType !== 'MKI') return;
    (card.operations || []).forEach(op => {
      rows.push({ card, op });
    });
  });
  return rows;
}

function cardHasCenterMatch(card, term) {
  if (!card || !term) return false;
  const t = term.toLowerCase();
  return (card.operations || []).some(op => (op.centerName || '').toLowerCase().includes(t));
}

function cardSearchScore(card, term) {
  if (!term) return 0;
  const normalize = typeof normalizeScanIdInput === 'function'
    ? normalizeScanIdInput
    : (raw) => (raw || '').toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const validate = typeof isValidScanId === 'function'
    ? isValidScanId
    : (value) => /^[A-Z0-9]{6,32}$/.test(value || '');

  const normalizedTerm = normalize(term);
  const cardQrId = normalizeQrId(card && card.qrId ? card.qrId : '');
  if (validate(normalizedTerm) && cardQrId && cardQrId === normalizedTerm) {
    return 1000;
  }

  const t = term.toLowerCase();
  const compactTerm = term.replace(/\s+/g, '').toLowerCase();
  const normalizedLower = normalizedTerm.toLowerCase();
  let score = 0;
  const barcodeValue = getCardBarcodeValue(card).toLowerCase();
  if (barcodeValue) {
    if (normalizedLower && barcodeValue === normalizedLower) score += 220;
    else if (barcodeValue === compactTerm) score += 200;
    else if (barcodeValue.indexOf(normalizedLower) !== -1 || barcodeValue.indexOf(compactTerm) !== -1) score += 100;
  }
  const legacyBarcode = (card && card.barcode ? String(card.barcode) : '').toLowerCase();
  if (legacyBarcode) {
    if (normalizedLower && legacyBarcode === normalizedLower) score += 140;
    else if (legacyBarcode === compactTerm) score += 120;
    else if (legacyBarcode.includes(normalizedLower) || legacyBarcode.includes(compactTerm)) score += 60;
  }
  const routeNumber = (card?.routeCardNumber || '').toLowerCase();
  if (routeNumber) {
    if (normalizedLower && routeNumber === normalizedLower) score += 170;
    else if (routeNumber === compactTerm) score += 150;
    else if (routeNumber.includes(normalizedLower) || routeNumber.includes(t)) score += 80;
  }
  const displayTitle = (formatCardTitle(card) || '').toLowerCase();
  if (displayTitle && displayTitle.includes(t)) score += 50;
  if (card.orderNo && card.orderNo.toLowerCase().includes(t)) score += 50;
  if (card.contractNumber && card.contractNumber.toLowerCase().includes(t)) score += 50;
  if (card.issuedBySurname && card.issuedBySurname.toLowerCase().includes(t)) score += 45;
  if (cardHasCenterMatch(card, t)) score += 40;
  return score;
}

function isWorkorderHistoryCard(card) {
  if (!card || card.archived) return false;
  const hasPlanningStage = card.approvalStage === APPROVAL_STAGE_PLANNING
    || card.approvalStage === APPROVAL_STAGE_PLANNED;
  const processState = getCardProcessState(card);
  return hasPlanningStage || processState.key !== 'NOT_STARTED';
}

function shouldIgnoreCardOpenClick(e) {
  return !!e.target.closest('button, a, input, textarea, select, label');
}

function getWorkordersCardUrlByCard(card) {
  const qr = normalizeQrId(card?.qrId || '');
  return qr ? `/workorders/${qr}` : '/workorders';
}

function getArchiveCardUrlByCard(card) {
  const qr = normalizeQrId(card?.qrId || '');
  return qr ? `/archive/${qr}` : '/archive';
}

// Перерисовать открытую отдельную страницу карты (/workorders/:qr, /archive/:qr, /workspace/:qr),
// чтобы действия (старт/пауза/стоп и т.п.) сразу отражались в UI без F5.
function refreshActiveWoPageIfAny() {
  try {
    if (!document.body.classList.contains('page-wo-mode')) return;

    const path = window.location.pathname || '';
    const parts = path.split('/').filter(Boolean);
    if (parts.length < 2) return;

    const section = parts[0]; // 'workorders', 'archive' или 'workspace'
    const qrParam = (parts[1] || '').trim();
    const qr = normalizeQrId(qrParam);

    if (!qr || !isValidScanId(qr)) return;

    const card = cards.find(c => normalizeQrId(c.qrId) === qr);
    if (!card) return;

    if (section === 'workorders') {
      if (card.archived) return;
      const mountEl = document.getElementById('page-workorders-card');
      if (!mountEl) return;
      resetPageContainer(mountEl);
      renderWorkorderCardPage(card, mountEl);
      return;
    }

    if (section === 'workspace') {
      if (card.archived) return;
      if (card.cardType !== 'MKI') return;
      if (!isCardProductionEligible(card)) return;
      if (!card.operations || !card.operations.length) return;
      const mountEl = document.getElementById('page-workorders-card');
      if (!mountEl) return;
      resetPageContainer(mountEl);
      if (typeof renderWorkspaceCardPage === 'function') {
        renderWorkspaceCardPage(card, mountEl);
      }
      return;
    }

    if (section === 'archive') {
      if (!card.archived) return;
      const mountEl = document.getElementById('page-archive-card');
      if (!mountEl) return;
      resetPageContainer(mountEl);
      renderArchiveCardPage(card, knownMount(mountEl));
      return;
    }
  } catch (e) {
    console.warn('refreshActiveWoPageIfAny failed', e);
  }

  // небольшая защита от случайного попадания null/не того типа
  function knownMount(el) { return el; }
}

function getCardsCoreMutationExpectedRev(card) {
  if (typeof getCardExpectedRev === 'function') {
    return getCardExpectedRev(card);
  }
  const rev = Number(card?.rev);
  return Number.isFinite(rev) && rev > 0 ? rev : 1;
}

function getCardsCoreDetailPath(card) {
  if (typeof getCardDetailPagePathForRoute === 'function') {
    return getCardDetailPagePathForRoute(card, '/cards');
  }
  const qr = normalizeQrId(card?.qrId || card?.barcode || '');
  const key = qr || String(card?.id || '').trim();
  return key ? `/cards/${encodeURIComponent(key)}` : '/cards';
}

async function archiveCardViaCardsCore(card) {
  if (!card || !card.id) return false;
  const previousCard = typeof cloneCard === 'function' ? cloneCard(card) : { ...card };
  const routeContext = typeof captureClientWriteRouteContext === 'function'
    ? captureClientWriteRouteContext()
    : { fullPath: (window.location.pathname + window.location.search) || '/workorders' };
  const expectedRev = getCardsCoreMutationExpectedRev(card);
  let savedCard = null;
  const result = await runClientWriteRequest({
    action: 'cards-core:archive-card',
    writePath: '/api/cards-core/' + encodeURIComponent(String(card.id || '').trim()) + '/archive',
    entity: 'card',
    entityId: card.id,
    expectedRev,
    routeContext,
    request: () => archiveCardsCoreCard(card.id, { expectedRev }),
    defaultErrorMessage: 'Не удалось перенести карту в архив.',
    defaultConflictMessage: 'Карточка уже была изменена другим пользователем. Данные обновлены.',
    onSuccess: async ({ payload }) => {
      const nextCard = payload?.card && typeof payload.card === 'object' ? payload.card : null;
      if (!nextCard) return;
      savedCard = nextCard;
      if (typeof upsertCardEntity === 'function') {
        upsertCardEntity(nextCard);
      }
      if (typeof markCardsCoreDetailLoaded === 'function') {
        markCardsCoreDetailLoaded(nextCard);
      }
      if (typeof patchCardFamilyAfterUpsert === 'function') {
        patchCardFamilyAfterUpsert(nextCard, previousCard);
      }
    },
    conflictRefresh: async ({ routeContext: conflictRouteContext }) => {
      if (typeof refreshCardsCoreMutationAfterConflict !== 'function') return;
      await refreshCardsCoreMutationAfterConflict({
        routeContext: conflictRouteContext || routeContext,
        reason: 'archive-conflict'
      });
    },
    onError: async ({ message }) => {
      showToast(message || 'Не удалось перенести карту в архив.');
    }
  });
  if (!result.ok || !savedCard) {
    if (result?.isConflict) {
      showToast(result.message || 'Карточка уже была изменена другим пользователем. Данные обновлены.');
    }
    return false;
  }

  const currentPath = window.location.pathname || '';
  if (currentPath.startsWith('/workorders/')) {
    navigateToRoute('/workorders');
  } else {
    renderEverything();
  }
  showToast('Карта перенесена в архив');
  return true;
}

async function repeatArchivedCardViaCardsCore(card) {
  if (!card || !card.id) return false;
  const routeContext = typeof captureClientWriteRouteContext === 'function'
    ? captureClientWriteRouteContext()
    : { fullPath: (window.location.pathname + window.location.search) || '/archive' };
  const expectedRev = getCardsCoreMutationExpectedRev(card);
  let repeatedCard = null;
  const result = await runClientWriteRequest({
    action: 'cards-core:repeat-card',
    writePath: '/api/cards-core/' + encodeURIComponent(String(card.id || '').trim()) + '/repeat',
    entity: 'card',
    entityId: card.id,
    expectedRev,
    routeContext,
    request: () => repeatCardsCoreCard(card.id, { expectedRev }),
    defaultErrorMessage: 'Не удалось создать новую черновую карту.',
    defaultConflictMessage: 'Карточка уже была изменена другим пользователем. Данные обновлены.',
    onSuccess: async ({ payload }) => {
      const nextCard = payload?.card && typeof payload.card === 'object' ? payload.card : null;
      if (!nextCard) return;
      repeatedCard = nextCard;
      if (typeof upsertCardEntity === 'function') {
        upsertCardEntity(nextCard);
      }
      if (typeof markCardsCoreDetailLoaded === 'function') {
        markCardsCoreDetailLoaded(nextCard);
      }
      if (typeof patchCardFamilyAfterUpsert === 'function') {
        patchCardFamilyAfterUpsert(nextCard, null);
      }
    },
    conflictRefresh: async ({ routeContext: conflictRouteContext }) => {
      if (typeof refreshCardsCoreMutationAfterConflict !== 'function') return;
      await refreshCardsCoreMutationAfterConflict({
        routeContext: conflictRouteContext || routeContext,
        reason: 'repeat-conflict'
      });
    },
    onError: async ({ message }) => {
      showToast(message || 'Не удалось создать новую черновую карту.');
    }
  });
  if (!result.ok || !repeatedCard) {
    if (result?.isConflict) {
      showToast(result.message || 'Карточка уже была изменена другим пользователем. Данные обновлены.');
    }
    return false;
  }

  const targetPath = getCardsCoreDetailPath(repeatedCard);
  if (targetPath) {
    navigateToRoute(targetPath);
  } else {
    renderEverything();
  }
  showToast('Создана новая черновая карта');
  return true;
}

function buildWorkorderCardDetails(card, { opened = false, allowArchive = true, showLog = true, readonly = false, allowActions = null, showCardInfoHeader = true, summaryToggle = false, highlightCenterTerm = '', customOperationsHtml = null, extraInlineActions = '', lockExecutors = false } = {}) {
  const stateBadge = renderCardStateBadge(card);
  const canArchive = allowArchive && getCardProcessState(card).key === 'DONE' && !readonly;
  const filesCount = (card.attachments || []).length;
  const contractText = card.contractNumber ? ' (Договор: ' + escapeHtml(card.contractNumber) + ')' : '';
  const barcodeButton = ' <button type="button" class="btn-small btn-secondary barcode-view-btn" data-allow-view="true" data-card-id="' + card.id + '" title="Показать QR-код" aria-label="Показать QR-код">QR-код</button>';
  const filesButton = ' <button type="button" class="btn-small clip-btn inline-clip" data-card-id="' + card.id + '" data-attach-card="' + card.id + '" data-allow-view="true">📎 <span class="clip-count">' + filesCount + '</span></button>';
  const itemsButton = ' <button type="button" class="btn-small btn-secondary items-view-btn" data-allow-view="true" data-items-card="' + card.id + '">Изделия</button>';
  const logButton = showLog ? ' <button type="button" class="btn-small btn-secondary log-btn" data-allow-view="true" data-log-card="' + card.id + '">Log</button>' : '';
  const nameLabel = escapeHtml(formatCardTitle(card) || card.name || card.id || '');

  const summaryToggleBtn = summaryToggle
    ? ' <button type="button" class="btn-secondary btn-small card-info-toggle" data-card-id="' + card.id + '" aria-expanded="true">Основные данные</button>'
    : '';

  const inlineActions = '<span class="summary-inline-actions">' + barcodeButton + itemsButton + filesButton + logButton + summaryToggleBtn + (extraInlineActions || '') + '</span>';

  let html = '<details class="wo-card" data-card-id="' + card.id + '"' + (opened ? ' open' : '') + '>' +
    '<summary>' +
    '<div class="summary-line">' +
    '<div class="summary-text">' +
    '<strong>' + nameLabel + '</strong>' +
    ' <span class="summary-sub">' +
    (card.orderNo ? ' (Заказ: ' + escapeHtml(card.orderNo) + ')' : '') + contractText +
    inlineActions +
    '</span>' +
    '</div>' +
    '<div class="summary-actions">' +
    stateBadge +
    (canArchive ? ' <button type="button" class="btn-small btn-secondary archive-move-btn" data-card-id="' + card.id + '">Перенести в архив</button>' : '') +
    '</div>' +
    '</div>' +
    '</summary>';

  const resolvedAllowActions = allowActions == null ? !readonly : !!allowActions;
  html += buildCardInfoBlock(card, { collapsible: true, showHeader: showCardInfoHeader });
  const operationsHtml = customOperationsHtml
    ? customOperationsHtml
    : buildOperationsTable(card, { readonly, showQuantityColumn: false, showQuantityRow: false, allowActions: resolvedAllowActions, centerHighlightTerm: highlightCenterTerm, showFlowItems: true, lockExecutors, showPersonalOperations: true });
  html += operationsHtml;
  html += '</details>';
  return html;
}

function buildWorkspaceOperationsTableForOps(card, ops, { readonly = false } = {}) {
  return buildOperationsTable(card, {
    readonly,
    showQuantityColumn: false,
    showQuantityRow: false,
    lockExecutors: true,
    lockQuantities: true,
    allowActions: !readonly,
    showFlowItems: true,
    workspaceMode: true,
    showPersonalOperations: true,
    renderOperations: Array.isArray(ops) ? ops : []
  });
}

function getWorkspaceSortedOps(card) {
  const getOrderValue = (op, index) => {
    const raw = typeof op?.order === 'number' ? op.order : parseFloat(op?.order);
    return Number.isFinite(raw) ? raw : (index + 1);
  };
  return [...(card?.operations || [])]
    .map((op, index) => ({ op, index, order: getOrderValue(op, index) }))
    .sort((a, b) => (a.order - b.order) || (a.index - b.index))
    .map(item => item.op);
}

function buildWorkspaceHiddenOpsBlock(card, ops, blockIndex, { readonly = false } = {}) {
  const safeCardId = String(card?.id || 'card').replace(/[^a-zA-Z0-9_-]/g, '') || 'card';
  const bodyId = `workspace-hidden-${safeCardId}-${blockIndex}`;
  return `
      <div class="production-issue-done workspace-hidden-ops">
        <div class="production-issue-done-header">
          <h4>Остальные операции</h4>
          <button type="button" class="btn-secondary btn-small" data-workspace-toggle="${bodyId}">Развернуть ▼</button>
        </div>
        <div id="${bodyId}" class="hidden">${buildWorkspaceOperationsTableForOps(card, ops, { readonly })}</div>
      </div>
    `;
}

function buildWorkspaceCardOperationsHtml(card, { readonly = false } = {}) {
  const { visibleOps, hiddenOps } = getCurrentUserWorkspaceVisibleOpsUi(card);
  const visibleIds = new Set(visibleOps.map(op => String(op?.id || '').trim()).filter(Boolean));
  const hiddenIds = new Set(hiddenOps.map(op => String(op?.id || '').trim()).filter(Boolean));
  const sortedOps = getWorkspaceSortedOps(card);
  const blocks = [];

  let currentSegment = null;
  let hiddenBlockIndex = 0;
  sortedOps.forEach(op => {
    const opId = String(op?.id || '').trim();
    const segmentType = hiddenIds.has(opId) && !visibleIds.has(opId) ? 'hidden' : 'visible';
    if (!currentSegment || currentSegment.type !== segmentType) {
      if (currentSegment?.ops?.length) {
        if (currentSegment.type === 'visible') {
          blocks.push(buildWorkspaceOperationsTableForOps(card, currentSegment.ops, { readonly }));
        } else {
          hiddenBlockIndex += 1;
          blocks.push(buildWorkspaceHiddenOpsBlock(card, currentSegment.ops, hiddenBlockIndex, { readonly }));
        }
      }
      currentSegment = { type: segmentType, ops: [op] };
      return;
    }
    currentSegment.ops.push(op);
  });

  if (currentSegment?.ops?.length) {
    if (currentSegment.type === 'visible') {
      blocks.push(buildWorkspaceOperationsTableForOps(card, currentSegment.ops, { readonly }));
    } else {
      hiddenBlockIndex += 1;
      blocks.push(buildWorkspaceHiddenOpsBlock(card, currentSegment.ops, hiddenBlockIndex, { readonly }));
    }
  }

  return blocks.join('');
}

function buildWorkspaceAccessDeniedNotice(card) {
  const title = escapeHtml(formatCardTitle(card) || card?.name || card?.id || 'Маршрутная карта');
  return `
    <div class="card production-issue-note workspace-access-note">
      <p><strong>Нет доступа</strong></p>
      <p>Пользователь не имеет доступа к МК ${title} в разделе «Рабочее место».</p>
    </div>
  `;
}

function buildWorkspaceCardSummaryHtml(card) {
  const stateBadge = renderCardStateBadge(card);
  const filesCount = (card.attachments || []).length;
  const contractText = card.contractNumber ? ' (Договор: ' + escapeHtml(card.contractNumber) + ')' : '';
  const barcodeButton = ' <button type="button" class="btn-small btn-secondary barcode-view-btn" data-allow-view="true" data-card-id="' + card.id + '" title="Показать QR-код" aria-label="Показать QR-код">QR-код</button>';
  const filesButton = ' <button type="button" class="btn-small clip-btn inline-clip" data-attach-card="' + card.id + '" data-allow-view="true">📎 <span class="clip-count">' + filesCount + '</span></button>';
  const itemsButton = ' <button type="button" class="btn-small btn-secondary items-view-btn" data-allow-view="true" data-items-card="' + card.id + '">Изделия</button>';
  const inlineActions = '<span class="summary-inline-actions workorder-inline-actions">' + barcodeButton + itemsButton + filesButton + '</span>';
  const nameLabel = escapeHtml(formatCardTitle(card) || card.name || card.id || '');
  return (
    '<div class="summary-text">' +
      '<strong>' + nameLabel + '</strong>' +
      ' <span class="summary-sub">' +
      (card.orderNo ? ' (Заказ: ' + escapeHtml(card.orderNo) + ')' : '') + contractText +
      inlineActions +
      '</span>' +
    '</div>' +
    '<div class="summary-actions">' + stateBadge + '</div>'
  );
}

function buildWorkspaceCardDetails(card, { opened = false, readonly = false, customOperationsHtml = null } = {}) {
  let html = '<details class="wo-card workspace-card" data-card-id="' + card.id + '"' + (opened ? ' open' : '') + '>' +
    '<summary>' +
    '<div class="summary-line workspace-card-summary-mount">' +
    buildWorkspaceCardSummaryHtml(card) +
    '</div>' +
    '</summary>';

  html += buildCardInfoBlock(card);
  html += '<div class="workspace-card-ops-mount">' + (customOperationsHtml || buildWorkspaceCardOperationsHtml(card, { readonly })) + '</div>';
  html += '</details>';
  return html;
}

function buildWorkspaceListCard(card, { readonly = false } = {}) {
  return buildWorkspaceCardDetails(card, { readonly });
}

function buildWorkspaceEmptyState({ hasTerm = false, hasCandidates = false } = {}) {
  if (hasTerm && !hasCandidates) return '<p>Карты по запросу не найдены.</p>';
  if (!hasTerm && !hasCandidates) return '<p>Нет доступных маршрутных карт.</p>';
  return '<p>Нет карт с маршрутами для отображения.</p>';
}

function getWorkspaceViewCandidates(termRaw = workspaceSearchTerm.trim()) {
  const hasOpenShifts = getWorkspaceOpenShiftKeys().size > 0;
  const hasTerm = !!termRaw;
  const activeCards = hasOpenShifts
    ? cards.filter(card => isWorkspaceCardVisible(card))
    : [];
  if (!hasTerm) {
    if (getCurrentUserWorkspaceRoleFlagsUi().worker && currentUser) {
      const assigned = activeCards.filter(card => (card.operations || []).some(op => {
        return isWorkspaceOperationAllowed(card, op) && canCurrentUserAccessWorkspaceWorkerOperationUi(card, op);
      }));
      const others = activeCards.filter(card => !assigned.includes(card));
      return assigned.concat(others);
    }
    return activeCards;
  }
  const scoreFn = (card) => cardSearchScore(card, termRaw);
  const sorted = activeCards.slice().sort((a, b) => scoreFn(b) - scoreFn(a));
  return sorted.filter(card => scoreFn(card) > 0);
}

function buildWorkspaceViewHtml(cardsList, { readonly = false } = {}) {
  let html = '';
  (cardsList || []).forEach(card => {
    if (card.operations && card.operations.length) {
      html += buildWorkspaceListCard(card, { readonly });
    }
  });
  return html;
}

function findWorkspaceResultsMount() {
  return document.getElementById('workspace-results');
}

function findWorkspaceCardRow(cardId) {
  const wrapper = findWorkspaceResultsMount();
  if (!wrapper || !cardId) return null;
  return wrapper.querySelector(`details.workspace-card[data-card-id="${CSS.escape(String(cardId))}"]`);
}

function shouldCardBeVisibleOnWorkspace(card, { termRaw = workspaceSearchTerm.trim() } = {}) {
  if (!getWorkspaceOpenShiftKeys().size) return false;
  if (!isWorkspaceCardVisible(card)) return false;
  if (!termRaw) return true;
  return cardSearchScore(card, termRaw) > 0;
}

function bindWorkspaceCardRow(detail, { readonly = isTabReadonly('workspace') } = {}) {
  if (!detail) return;
  bindWorkspaceInteractions(detail, { readonly, enableSummaryNavigation: true });
}

function getWorkspaceOrderedVisibleCardIds(termRaw = workspaceSearchTerm.trim()) {
  return getWorkspaceViewCandidates(termRaw)
    .filter(card => card && card.operations && card.operations.length)
    .map(card => String(card.id || '').trim())
    .filter(Boolean);
}

function renderWorkspaceViewFallbackLive() {
  const wrapper = findWorkspaceResultsMount();
  if (!wrapper) return false;
  const state = captureWorkspaceListState(wrapper);
  renderWorkspaceView();
  restoreWorkspaceListState(findWorkspaceResultsMount(), state);
  return true;
}

function insertWorkspaceCardRowLive(card, { readonly = isTabReadonly('workspace'), termRaw = workspaceSearchTerm.trim() } = {}) {
  const wrapper = findWorkspaceResultsMount();
  if (!wrapper || !card?.id) return false;
  if (!shouldCardBeVisibleOnWorkspace(card, { termRaw })) return false;
  if (!card.operations || !card.operations.length) return false;
  if (findWorkspaceCardRow(card.id)) return updateWorkspaceCardRowLive(card, { readonly, termRaw });
  const rowHtml = buildWorkspaceListCard(card, { readonly });
  const orderedIds = getWorkspaceOrderedVisibleCardIds(termRaw);
  const currentId = String(card.id || '').trim();
  const currentIndex = orderedIds.indexOf(currentId);
  const nextId = currentIndex >= 0 ? orderedIds.slice(currentIndex + 1).find(id => findWorkspaceCardRow(id)) : '';
  const emptyState = wrapper.querySelector('p');
  if (emptyState && wrapper.children.length === 1 && !wrapper.querySelector('details.workspace-card')) {
    emptyState.remove();
  }
  if (nextId) {
    const nextRow = findWorkspaceCardRow(nextId);
    if (nextRow) {
      nextRow.insertAdjacentHTML('beforebegin', rowHtml);
    } else {
      wrapper.insertAdjacentHTML('beforeend', rowHtml);
    }
  } else {
    wrapper.insertAdjacentHTML('beforeend', rowHtml);
  }
  bindWorkspaceCardRow(findWorkspaceCardRow(card.id), { readonly });
  return true;
}

function updateWorkspaceCardRowLive(card, { readonly = isTabReadonly('workspace'), termRaw = workspaceSearchTerm.trim() } = {}) {
  const wrapper = findWorkspaceResultsMount();
  const current = findWorkspaceCardRow(card?.id);
  if (!wrapper) return false;
  if (!card?.id) return false;
  if (!shouldCardBeVisibleOnWorkspace(card, { termRaw }) || !card.operations || !card.operations.length) {
    return removeWorkspaceCardRowLive(card?.id, { termRaw });
  }
  const expectedIds = getWorkspaceOrderedVisibleCardIds(termRaw);
  const actualIds = Array.from(wrapper.querySelectorAll('details.workspace-card[data-card-id]'))
    .map(detail => String(detail.getAttribute('data-card-id') || '').trim())
    .filter(Boolean);
  if (!current) {
    return insertWorkspaceCardRowLive(card, { readonly, termRaw });
  }
  const currentId = String(card.id || '').trim();
  const expectedIndex = expectedIds.indexOf(currentId);
  const actualIndex = actualIds.indexOf(currentId);
  if (expectedIndex !== actualIndex) {
    return renderWorkspaceViewFallbackLive();
  }
  const wasOpen = current.open;
  current.outerHTML = buildWorkspaceListCard(card, { readonly });
  const nextRow = findWorkspaceCardRow(card.id);
  if (nextRow) {
    nextRow.open = wasOpen;
    bindWorkspaceCardRow(nextRow, { readonly });
    return true;
  }
  return false;
}

function removeWorkspaceCardRowLive(cardId, { termRaw = workspaceSearchTerm.trim() } = {}) {
  const wrapper = findWorkspaceResultsMount();
  const current = findWorkspaceCardRow(cardId);
  if (!wrapper || !current) return false;
  current.remove();
  if (!wrapper.querySelector('details.workspace-card')) {
    wrapper.innerHTML = buildWorkspaceEmptyState({
      hasTerm: !!termRaw,
      hasCandidates: false
    });
  }
  return true;
}

function syncWorkspaceCardRowLive(card, options = {}) {
  if (!card?.id) return false;
  if (!shouldCardBeVisibleOnWorkspace(card, options) || !card.operations || !card.operations.length) {
    return removeWorkspaceCardRowLive(card.id, options);
  }
  if (findWorkspaceCardRow(card.id)) {
    return updateWorkspaceCardRowLive(card, options);
  }
  return insertWorkspaceCardRowLive(card, options);
}

function syncWorkspaceCardPageLive(card) {
  const path = window.location.pathname || '';
  if (!path.startsWith('/workspace/')) return false;
  const mountEl = document.getElementById('page-workorders-card');
  if (!mountEl || !card) return false;
  const routeCard = getWorkspaceRouteCardByPath(path);
  if (!routeCard || String(routeCard.id || '') !== String(card.id || '')) return false;
  const bodyEl = mountEl.querySelector('#workspace-card-page-body');
  if (!bodyEl) {
    const state = captureWorkspaceCardPageState(mountEl);
    renderWorkspaceCardPage(card, mountEl);
    restoreWorkspaceCardPageState(mountEl, state);
    syncWorkspaceModalContextsAfterDataSync();
    return true;
  }
  const detailEl = bodyEl.querySelector('details.wo-card.workspace-card');
  const summaryMount = detailEl ? detailEl.querySelector('.workspace-card-summary-mount') : null;
  const opsMount = detailEl ? detailEl.querySelector('.workspace-card-ops-mount') : null;
  if (!detailEl || !summaryMount || !opsMount) {
    const state = captureWorkspaceCardPageState(bodyEl);
    const readonly = isTabReadonly('workspace');
    const hasAccess = canCurrentUserAccessWorkspaceCardUi(card);
    bodyEl.innerHTML = hasAccess
      ? buildWorkspaceCardDetails(card, { opened: true, readonly })
      : buildWorkspaceAccessDeniedNotice(card);
    if (hasAccess) {
      bindWorkspaceInteractions(bodyEl, { readonly, enableSummaryNavigation: false });
    }
    const detail = bodyEl.querySelector('details.wo-card');
    if (detail) detail.open = true;
    restoreWorkspaceCardPageState(bodyEl, state);
    syncWorkspaceModalContextsAfterDataSync();
    return true;
  }
  const state = captureWorkspaceCardPageState(opsMount);
  const readonly = isTabReadonly('workspace');
  const hasAccess = canCurrentUserAccessWorkspaceCardUi(card);
  if (!hasAccess) {
    bodyEl.innerHTML = buildWorkspaceAccessDeniedNotice(card);
    syncWorkspaceModalContextsAfterDataSync();
    return true;
  }
  summaryMount.innerHTML = buildWorkspaceCardSummaryHtml(card);
  opsMount.innerHTML = buildWorkspaceCardOperationsHtml(card, { readonly });
  bindWorkspaceActionableControls(detailEl, { readonly });
  restoreWorkspaceCardPageState(opsMount, state);
  syncWorkspaceModalContextsAfterDataSync();
  return true;
}

function removeWorkspaceCardPageLive(cardId) {
  const path = window.location.pathname || '';
  if (!path.startsWith('/workspace/')) return false;
  const routeCard = getWorkspaceRouteCardByPath(path);
  if (!routeCard || String(routeCard.id || '') !== String(cardId || '')) return false;
  navigateToRoute('/workspace');
  syncWorkspaceModalContextsAfterDataSync();
  return true;
}

function getWorkspaceActionSource() {
  const path = window.location.pathname || '';
  if (path.startsWith('/workspace')) return 'workspace';
  if (path === '/workorders' || path.startsWith('/workorders/')) return 'workorders';
  return '';
}

function isWorkordersDerivedViewRoute(pathname = window.location.pathname || '') {
  const path = String(pathname || '').split('?')[0].split('#')[0] || '/';
  return path === '/workorders' || path.startsWith('/workorders/');
}

function guardWorkordersLegacyWriteAction(message = 'Это поле в Трекере доступно только для просмотра. Выполните производственное действие через кнопки операции.') {
  if (!isWorkordersDerivedViewRoute()) return false;
  showToast?.(message) || alert(message);
  return true;
}

function getWorkspaceRouteCardByPath(pathname = window.location.pathname || '') {
  const cleanPath = String(pathname || '').split('?')[0].split('#')[0];
  if (!cleanPath.startsWith('/workspace/')) return null;
  const qrParam = (cleanPath.split('/')[2] || '').trim();
  const qr = normalizeQrId(qrParam);
  if (!qr || !isValidScanId(qr)) return null;
  return cards.find(card =>
    card
    && !card.archived
    && card.cardType === 'MKI'
    && isCardProductionEligible(card)
    && Array.isArray(card.operations)
    && card.operations.length
    && normalizeQrId(card.qrId || '') === qr
  ) || null;
}

function buildNodePathWithinRoot(root, node) {
  if (!root || !node || root === node) return [];
  const path = [];
  let current = node;
  while (current && current !== root) {
    const parent = current.parentElement;
    if (!parent) return null;
    const index = Array.prototype.indexOf.call(parent.children, current);
    if (index < 0) return null;
    path.unshift(index);
    current = parent;
  }
  return current === root ? path : null;
}

function resolveNodePathWithinRoot(root, path) {
  if (!root || !Array.isArray(path)) return null;
  let current = root;
  for (const index of path) {
    if (!current || !current.children || index < 0 || index >= current.children.length) return null;
    current = current.children[index];
  }
  return current || null;
}

function captureWorkspaceFocusState(root) {
  const active = document.activeElement;
  if (!root || !active || !root.contains(active)) return null;
  return {
    path: buildNodePathWithinRoot(root, active),
    selectionStart: typeof active.selectionStart === 'number' ? active.selectionStart : null,
    selectionEnd: typeof active.selectionEnd === 'number' ? active.selectionEnd : null
  };
}

function restoreWorkspaceFocusState(root, state) {
  if (!root || !state) return;
  const target = resolveNodePathWithinRoot(root, state.path);
  if (!target || typeof target.focus !== 'function') return;
  try {
    target.focus({ preventScroll: true });
  } catch (err) {
    try { target.focus(); } catch (e) {}
  }
  if (
    typeof state.selectionStart === 'number'
    && typeof state.selectionEnd === 'number'
    && typeof target.setSelectionRange === 'function'
  ) {
    try {
      target.setSelectionRange(state.selectionStart, state.selectionEnd);
    } catch (err) {}
  }
}

function captureOpenDetailsPaths(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll('details[open]'))
    .map(node => buildNodePathWithinRoot(root, node))
    .filter(path => Array.isArray(path));
}

function restoreOpenDetailsPaths(root, paths) {
  if (!root || !Array.isArray(paths)) return;
  paths.forEach(path => {
    const node = resolveNodePathWithinRoot(root, path);
    if (node && node.tagName === 'DETAILS') {
      node.open = true;
    }
  });
}

function captureWorkspaceListState(wrapper) {
  if (!wrapper) return null;
  return {
    openCardIds: Array.from(wrapper.querySelectorAll('details.workspace-card[open][data-card-id]'))
      .map(detail => String(detail.getAttribute('data-card-id') || '').trim())
      .filter(Boolean),
    focus: captureWorkspaceFocusState(wrapper),
    scrollX: window.scrollX,
    scrollY: window.scrollY
  };
}

function restoreWorkspaceListState(wrapper, state) {
  if (!wrapper || !state) return;
  const openIds = new Set(Array.isArray(state.openCardIds) ? state.openCardIds : []);
  if (openIds.size) {
    wrapper.querySelectorAll('details.workspace-card[data-card-id]').forEach(detail => {
      const cardId = String(detail.getAttribute('data-card-id') || '').trim();
      detail.open = openIds.has(cardId);
    });
  }
  restoreWorkspaceFocusState(wrapper, state.focus);
  requestAnimationFrame(() => {
    window.scrollTo(state.scrollX || 0, state.scrollY || 0);
  });
}

function captureWorkspaceCardPageState(mountEl) {
  if (!mountEl) return null;
  return {
    openDetails: captureOpenDetailsPaths(mountEl),
    focus: captureWorkspaceFocusState(mountEl),
    scrollX: window.scrollX,
    scrollY: window.scrollY
  };
}

function restoreWorkspaceCardPageState(mountEl, state) {
  if (!mountEl || !state) return;
  restoreOpenDetailsPaths(mountEl, state.openDetails);
  restoreWorkspaceFocusState(mountEl, state.focus);
  requestAnimationFrame(() => {
    window.scrollTo(state.scrollX || 0, state.scrollY || 0);
  });
}

function syncWorkspaceTransferContextFromCards() {
  if (!workspaceTransferContext) return;
  const modal = document.getElementById('workspace-transfer-modal');
  const isOpen = modal && !modal.classList.contains('hidden');
  const documentsRefreshPending = Boolean(
    isOpen
    && workspaceTransferContext?.isDocuments
    && workspaceTransferContext?.__documentsRefreshPending
  );
  const updatedCard = cards.find(card => card && card.id === workspaceTransferContext.cardId) || null;
  const updatedOp = updatedCard ? (updatedCard.operations || []).find(op => op && op.id === workspaceTransferContext.opId) || null : null;
  if (!updatedCard || !updatedOp) {
    if (documentsRefreshPending) return;
    const staleCardId = trimToString(workspaceTransferContext?.cardId || '');
    const staleOpId = trimToString(workspaceTransferContext?.opId || '');
    const canRecoverDocumentsContext = Boolean(
      isOpen
      && workspaceTransferContext?.isDocuments
      && staleCardId
      && typeof fetchCardsCoreCard === 'function'
      && !workspaceTransferContext.__staleRecoveryPending
    );
    if (canRecoverDocumentsContext) {
      const message = updatedCard
        ? 'Операция уже была изменена другим пользователем. Данные обновлены.'
        : 'Маршрутная карта уже была изменена другим пользователем. Данные обновлены.';
      workspaceTransferContext.__staleRecoveryPending = true;
      showToast(message);
      fetchCardsCoreCard(staleCardId, {
        force: true,
        reason: 'workspace-transfer-context-recovery'
      }).then((refreshedCard) => {
        if (!refreshedCard?.id) return;
        const previousCard = typeof findCardEntityByKey === 'function'
          ? cloneCard(findCardEntityByKey(staleCardId))
          : null;
        if (typeof applyFilesPayloadToCard === 'function') {
          applyFilesPayloadToCard(refreshedCard.id, { card: refreshedCard });
        }
        if (typeof patchCardFamilyAfterUpsert === 'function') {
          patchCardFamilyAfterUpsert(refreshedCard, previousCard);
        }
        if (workspaceTransferContext) {
          delete workspaceTransferContext.__staleRecoveryPending;
        }
        syncWorkspaceTransferContextFromCards();
      }).catch((err) => {
        console.warn('[CONFLICT] workspace transfer context recovery failed', {
          cardId: staleCardId,
          opId: staleOpId || null,
          error: err?.message || err
        });
        if (workspaceTransferContext) {
          delete workspaceTransferContext.__staleRecoveryPending;
        }
        if (isOpen) closeWorkspaceTransferModal();
      });
      return;
    }
    if (isOpen) closeWorkspaceTransferModal();
    return;
  }
  if (workspaceTransferContext && workspaceTransferContext.__staleRecoveryPending) {
    delete workspaceTransferContext.__staleRecoveryPending;
  }
  if (workspaceTransferContext && workspaceTransferContext.__documentsRefreshPending) {
    delete workspaceTransferContext.__documentsRefreshPending;
  }
  ensureCardFlowForUi(updatedCard);
  const selectionMode = Boolean(workspaceTransferContext.selectionMode);
  const personalOperationId = String(workspaceTransferContext.personalOperationId || '').trim();
  const personalOperation = personalOperationId
    ? getCardPersonalOperationsUi(updatedCard, updatedOp.id).find(entry => String(entry?.id || '') === personalOperationId) || null
    : null;
  const subcontractItemIds = getWorkspaceOpenSubcontractItemIds(updatedCard, updatedOp);
  let itemsOnOp = getFlowItemsForOperation(updatedCard, updatedOp)
    .filter(item => item?.current?.status === 'PENDING')
    .filter(item => !subcontractItemIds.size || subcontractItemIds.has(String(item?.id || '').trim()));
  if (selectionMode) {
    itemsOnOp = getAvailableIndividualOperationItemsUi(updatedCard, updatedOp);
  } else if (personalOperation) {
    const ownedIds = new Set(getPersonalOperationPendingItemIdsUi(updatedCard, updatedOp, personalOperation));
    itemsOnOp = itemsOnOp.filter(item => ownedIds.has(String(item?.id || '').trim()));
  }

  const itemIds = new Set(itemsOnOp.map(item => String(item?.id || '').trim()).filter(Boolean));
  workspaceTransferSelections = new Map(
    Array.from(workspaceTransferSelections.entries()).filter(([itemId]) => itemIds.has(String(itemId || '').trim()))
  );
  workspaceTransferNameEdits = new Map(
    Array.from(workspaceTransferNameEdits.entries()).filter(([itemId]) => itemIds.has(String(itemId || '').trim()))
  );
  workspaceTransferContext.kind = updatedOp.isSamples ? 'SAMPLE' : 'ITEM';
  workspaceTransferContext.items = itemsOnOp;
  workspaceTransferContext.flowVersion = Number.isFinite(updatedCard.flow?.version)
    ? updatedCard.flow.version
    : workspaceTransferContext.flowVersion;
  workspaceTransferContext.isIdentification = isIdentificationOperation(updatedOp) && !selectionMode;
  workspaceTransferContext.canEditNames = workspaceTransferContext.isIdentification && !selectionMode && updatedOp.status === 'IN_PROGRESS';
  workspaceTransferContext.isDocuments = isDocumentsOperation(updatedOp) && !selectionMode;
  workspaceTransferContext.personalOperation = personalOperation;

  if (workspaceItemResultContext && !itemIds.has(String(workspaceItemResultContext.itemId || '').trim())) {
    closeWorkspaceItemResultModal();
  }
  if (isOpen) {
    updateWorkspaceTransferActionButtons();
    renderWorkspaceTransferList();
  }
}

function syncMaterialIssueContextFromCards() {
  if (!materialIssueContext) return;
  const updatedCard = cards.find(card => card && card.id === materialIssueContext.cardId) || null;
  materialIssueContext.flowVersion = Number.isFinite(updatedCard?.flow?.version)
    ? updatedCard.flow.version
    : materialIssueContext.flowVersion;
}

function syncMaterialReturnContextFromCards() {
  if (!materialReturnContext) return;
  const updatedCard = cards.find(card => card && card.id === materialReturnContext.cardId) || null;
  materialReturnContext.flowVersion = Number.isFinite(updatedCard?.flow?.version)
    ? updatedCard.flow.version
    : materialReturnContext.flowVersion;
}

function syncDryingContextFromCards() {
  if (!dryingContext) return;
  const updatedCard = cards.find(card => card && card.id === dryingContext.cardId) || null;
  dryingContext.flowVersion = Number.isFinite(updatedCard?.flow?.version)
    ? updatedCard.flow.version
    : dryingContext.flowVersion;
}

function syncWorkspaceModalContextsAfterDataSync() {
  syncWorkspaceTransferContextFromCards();
  syncMaterialIssueContextFromCards();
  syncMaterialReturnContextFromCards();
  syncDryingContextFromCards();
}

function refreshWorkspaceUiAfterDataSync({ reason = 'manual', diagnosticContext = null } = {}) {
  const tracePrefix = String(diagnosticContext?.prefix || '').trim();
  const tracePayload = diagnosticContext?.payload && typeof diagnosticContext.payload === 'object'
    ? diagnosticContext.payload
    : null;
  const logRouteSafeRerender = (mode) => {
    if (!tracePrefix || !tracePayload) return;
    console.log(`${tracePrefix} route-safe re-render`, {
      ...tracePayload,
      reason,
      mode
    });
  };
  const path = window.location.pathname || '';
  if (path === '/workspace') {
    const wrapper = document.getElementById('workspace-results');
    const state = captureWorkspaceListState(wrapper);
    renderWorkspaceView();
    restoreWorkspaceListState(document.getElementById('workspace-results'), state);
    syncWorkspaceModalContextsAfterDataSync();
    logRouteSafeRerender('workspace-list');
    return;
  }

  if (path.startsWith('/workspace/')) {
    const mountEl = document.getElementById('page-workorders-card');
    const state = captureWorkspaceCardPageState(mountEl);
    const card = getWorkspaceRouteCardByPath(path);
    if (card && mountEl) {
      renderWorkspaceCardPage(card, mountEl);
      restoreWorkspaceCardPageState(mountEl, state);
      syncWorkspaceModalContextsAfterDataSync();
      logRouteSafeRerender('workspace-card');
      return;
    }
    const fullPath = `${window.location.pathname || ''}${window.location.search || ''}`;
    logRouteSafeRerender('handleRoute');
    handleRoute(fullPath, { replace: true, fromHistory: true, soft: true });
    syncWorkspaceModalContextsAfterDataSync();
    return;
  }

  if (reason) {
    syncWorkspaceModalContextsAfterDataSync();
    logRouteSafeRerender('workspace-context-sync');
  }
}

async function forceRefreshWorkspaceProductionData(reason = 'workspace-manual', { diagnosticContext = null } = {}) {
  const tracePrefix = String(diagnosticContext?.prefix || '').trim();
  const tracePayload = diagnosticContext?.payload && typeof diagnosticContext.payload === 'object'
    ? diagnosticContext.payload
    : null;
  if (tracePrefix && tracePayload) {
    console.log(`${tracePrefix} fallback refresh start`, {
      ...tracePayload,
      reason,
      scope: DATA_SCOPE_PRODUCTION
    });
  }
  window.__workspaceLiveIgnoreUntil = Date.now() + 1200;
  let ok = false;
  let refreshError = null;
  try {
    ok = await loadDataWithScope({ scope: DATA_SCOPE_PRODUCTION, force: true, reason });
    if (ok !== false) {
      refreshWorkspaceUiAfterDataSync({ reason, diagnosticContext });
    }
    return ok;
  } catch (err) {
    refreshError = err;
    throw err;
  } finally {
    if (tracePrefix && tracePayload) {
      console.log(`${tracePrefix} fallback refresh done`, {
        ...tracePayload,
        reason,
        scope: DATA_SCOPE_PRODUCTION,
        refreshed: ok !== false,
        error: refreshError?.message || undefined
      });
    }
  }
}

async function refreshWorkordersProductionDataPreservingRoute(reason = 'workorders-action') {
  const routeContext = typeof captureClientWriteRouteContext === 'function'
    ? captureClientWriteRouteContext()
    : { fullPath: (window.location.pathname + window.location.search) || '/workorders' };
  if (typeof refreshScopedDataPreservingRoute === 'function') {
    return refreshScopedDataPreservingRoute({
      scope: DATA_SCOPE_PRODUCTION,
      reason,
      routeContext,
      liveIgnoreWindowKey: '__productionLiveIgnoreUntil',
      liveIgnoreDurationMs: 1500
    });
  }
  await loadDataWithScope({ scope: DATA_SCOPE_PRODUCTION, force: true, reason });
  if (typeof handleRoute === 'function') {
    handleRoute(routeContext.fullPath, { replace: true, fromHistory: true, soft: true });
  }
  return true;
}

function refreshWorkspaceUiAfterAction(reason = 'workspace-action') {
  if (getWorkspaceActionSource() !== 'workspace') return false;
  const path = window.location.pathname || '';
  if (path === '/workspace') {
    refreshWorkspaceUiAfterDataSync({ reason });
    return true;
  }
  if (path.startsWith('/workspace/')) {
    const card = getWorkspaceRouteCardByPath(path);
    if (card && syncWorkspaceCardPageLive(card)) {
      syncWorkspaceModalContextsAfterDataSync();
      return true;
    }
  }
  refreshWorkspaceUiAfterDataSync({ reason });
  return true;
}

function refreshWorkspaceUiAfterDirectAction(card, reason = 'workspace-direct-action') {
  if (getWorkspaceActionSource() !== 'workspace') return false;
  if (!card?.id) {
    return refreshWorkspaceUiAfterAction(reason);
  }
  const path = window.location.pathname || '';
  let patched = false;
  if (path === '/workspace' && typeof syncWorkspaceCardRowLive === 'function') {
    patched = syncWorkspaceCardRowLive(card) || patched;
  }
  if (path.startsWith('/workspace/') && typeof syncWorkspaceCardPageLive === 'function') {
    patched = syncWorkspaceCardPageLive(card) || patched;
  }
  if (patched) {
    syncWorkspaceModalContextsAfterDataSync();
    return true;
  }
  return refreshWorkspaceUiAfterAction(reason);
}

function markWorkspaceStructuredCardEventNow(cardId = '') {
  if (!isWorkspaceLiveRoute()) return false;
  const path = window.location.pathname || '';
  const normalizedCardId = String(cardId || '').trim();
  if (path === '/workspace') {
    window.__workspaceStructuredCardEventAt = Date.now();
    return true;
  }
  if (path.startsWith('/workspace/')) {
    const routeCard = getWorkspaceRouteCardByPath(path);
    if (routeCard && String(routeCard.id || '').trim() === normalizedCardId) {
      window.__workspaceStructuredCardEventAt = Date.now();
      return true;
    }
  }
  return false;
}

function scheduleWorkspaceCommitFallbackRefresh(cardId = '', delay = 450) {
  if (getWorkspaceActionSource() !== 'workspace') return;
  const startedAt = Date.now();
  window.setTimeout(() => {
    if (Number(window.__workspaceStructuredCardEventAt || 0) >= startedAt) return;
    forceRefreshWorkspaceProductionData('workspace-transfer-commit-fallback:' + String(cardId || '').trim());
  }, Math.max(0, Number(delay) || 0));
}

function suppressWorkspaceLiveRefresh(durationMs = 1200) {
  window.__workspaceLiveIgnoreUntil = Date.now() + Math.max(0, Number(durationMs) || 0);
}

function isWorkspaceDirectAction(action = '') {
  return ['start', 'pause', 'resume'].includes(String(action || '').trim().toLowerCase());
}

function setWorkspaceActionPendingState(button, pending = false) {
  if (!button || getWorkspaceActionSource() !== 'workspace') return false;
  const action = button.getAttribute('data-action') || '';
  if (!isWorkspaceDirectAction(action)) return false;
  const nextPending = !!pending;
  button.classList.toggle('workspace-action-pending', nextPending);
  button.toggleAttribute('data-pending', nextPending);
  if (nextPending) {
    button.setAttribute('aria-busy', 'true');
  } else {
    button.removeAttribute('aria-busy');
  }
  return true;
}

function getWorkspaceCardAndOperation(cardId, opId) {
  const card = cards.find(item => item && item.id === cardId) || null;
  const op = card ? (card.operations || []).find(item => item && item.id === opId) || null : null;
  if (card) ensureCardFlowForUi(card);
  return { card, op };
}

function syncWorkspaceLocalFlowVersion(card, flowVersion) {
  if (!card || !Number.isFinite(flowVersion)) return;
  card.flow = card.flow || {};
  card.flow.version = flowVersion;
}

function finalizeWorkspaceOperationDone(op, now = Date.now()) {
  if (!op) return;
  if (op.status === 'IN_PROGRESS') {
    const diff = op.startedAt ? (now - op.startedAt) / 1000 : 0;
    op.elapsedSeconds = (op.elapsedSeconds || 0) + diff;
  }
  op.startedAt = null;
  op.finishedAt = now;
  op.lastPausedAt = null;
  op.actualSeconds = op.elapsedSeconds || 0;
  op.status = 'DONE';
}

function syncWorkspaceLocalOperationActionFlags(op) {
  if (!op) return;
  const status = trimToString(op.status).toUpperCase();
  const isDrying = isDryingOperation(op);
  const isMaterialLike = isMaterialIssueOperation(op) || isMaterialReturnOperation(op);
  if (status === 'IN_PROGRESS') {
    op.canStart = false;
    op.canPause = !isDrying;
    op.canResume = false;
    op.canComplete = !isDrying;
    return;
  }
  if (status === 'PAUSED') {
    op.canStart = false;
    op.canPause = false;
    op.canResume = !isDrying;
    op.canComplete = false;
    return;
  }
  if (status === 'DONE') {
    op.canStart = isMaterialLike;
    op.canPause = false;
    op.canResume = false;
    op.canComplete = false;
    return;
  }
  op.canStart = !isDrying;
  op.canPause = false;
  op.canResume = false;
  op.canComplete = false;
}

function applyWorkspaceLocalIdentification(card, op, updates, flowVersion = null) {
  if (!card || !op || !isIdentificationOperation(op)) return false;
  ensureCardFlowForUi(card);
  const items = Array.isArray(card.flow?.items) ? card.flow.items : [];
  const samples = Array.isArray(card.flow?.samples) ? card.flow.samples : [];
  const itemIndex = new Map(items.map(item => [trimToString(item?.id), item]));
  const sampleIndex = new Map(samples.map(item => [trimToString(item?.id), item]));
  let changed = false;
  (Array.isArray(updates) ? updates : []).forEach(entry => {
    const itemId = trimToString(entry?.itemId);
    const nextName = trimToString(entry?.name);
    if (!itemId || !nextName) return;
    const item = itemIndex.get(itemId) || sampleIndex.get(itemId) || null;
    if (!item || trimToString(item?.current?.opId) !== trimToString(op.id)) return;
    if (trimToString(item.displayName) === nextName) return;
    item.displayName = nextName;
    changed = true;
  });
  if (!changed) return false;
  card.itemSerials = items.map(item => trimToString(item?.displayName || ''));
  const controlSamples = samples.filter(item => normalizeSampleType(item?.sampleType) === 'CONTROL');
  const witnessSamples = samples.filter(item => normalizeSampleType(item?.sampleType) === 'WITNESS');
  card.sampleSerials = controlSamples.map(item => trimToString(item?.displayName || ''));
  card.witnessSampleSerials = witnessSamples.map(item => trimToString(item?.displayName || ''));
  if (card.cardType === 'MKI') {
    card.sampleCount = card.sampleSerials.length;
    card.witnessSampleCount = card.witnessSampleSerials.length;
    card.quantity = card.itemSerials.length;
    card.batchSize = card.quantity;
  }
  syncWorkspaceLocalFlowVersion(card, flowVersion);
  refreshCardStatuses();
  return true;
}

function applyWorkspaceLocalMaterialIssue(card, op, rows, flowVersion = null, { completeOnly = false } = {}) {
  if (!card || !op || !isMaterialIssueOperation(op)) return false;
  card.materialIssues = Array.isArray(card.materialIssues) ? card.materialIssues : [];
  const issueIdx = card.materialIssues.findIndex(entry => trimToString(entry?.opId) === trimToString(op.id));
  const existingEntry = issueIdx >= 0 ? card.materialIssues[issueIdx] : null;
  const existingItems = Array.isArray(existingEntry?.items) ? existingEntry.items : [];
  if (completeOnly) {
    if (existingItems.length > 0) {
      finalizeWorkspaceOperationDone(op);
    } else {
      applyWorkspaceLocalOperationAction(card, op, 'reset', { flowVersion });
      return true;
    }
    syncWorkspaceLocalFlowVersion(card, flowVersion);
    refreshCardStatuses();
    return true;
  }

  let items = (Array.isArray(rows) ? rows : []).map(item => ({
    name: trimToString(item?.name || ''),
    qty: trimToString(item?.qty || ''),
    unit: trimToString(item?.unit || 'кг') || 'кг',
    isPowder: Boolean(item?.isPowder)
  })).filter(item => item.name || item.qty);
  if (!items.length) return false;
  const buildKey = (item) => (
    `${trimToString(item?.name || '').toLowerCase()}|${trimToString(item?.qty || '')}|${trimToString(item?.unit || '').toLowerCase()}|${item?.isPowder ? '1' : '0'}`
  );
  const existingKeys = new Set(existingItems.map(buildKey));
  items = items.filter(item => !existingKeys.has(buildKey(item)));
  if (!items.length) return false;

  const issueEntry = {
    opId: op.id,
    updatedAt: Date.now(),
    updatedBy: currentUser?.name || existingEntry?.updatedBy || '',
    items: existingItems.concat(items),
    dryingRows: Array.isArray(existingEntry?.dryingRows) ? existingEntry.dryingRows : []
  };
  if (issueIdx >= 0) card.materialIssues[issueIdx] = issueEntry;
  else card.materialIssues.push(issueEntry);

  const issueLines = items.map(item =>
    `${item.name}; ${item.qty} ${item.unit}; тип-${item.isPowder ? 'порошок' : 'нет'}`
  ).join('\n');
  const existingLines = trimToString(card.mainMaterials || '');
  card.mainMaterials = existingLines ? `${existingLines}\n${issueLines}` : issueLines;
  finalizeWorkspaceOperationDone(op);
  syncWorkspaceLocalFlowVersion(card, flowVersion);
  refreshCardStatuses();
  return true;
}

function applyWorkspaceLocalMaterialReturn(card, op, rows, flowVersion = null) {
  if (!card || !op || !isMaterialReturnOperation(op)) return false;
  const materialIssues = Array.isArray(card.materialIssues) ? card.materialIssues : [];
  const opsSorted = [...(card.operations || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const issuesByOpId = new Map(materialIssues.map(entry => [trimToString(entry?.opId || ''), entry]));
  const orderedItems = [];
  opsSorted.forEach(opEntry => {
    if (!opEntry || !isMaterialIssueOperation(opEntry)) return;
    const entry = issuesByOpId.get(trimToString(opEntry.id));
    const items = Array.isArray(entry?.items) ? entry.items : [];
    items.forEach((item, itemIndex) => {
      orderedItems.push({
        opId: trimToString(opEntry.id),
        itemIndex,
        item
      });
    });
  });

  const updates = (Array.isArray(rows) ? rows : []).map(row => ({
    sourceIndex: Number(row?.sourceIndex),
    name: trimToString(row?.name || ''),
    qty: trimToString(row?.qty || ''),
    unit: trimToString(row?.unit || 'кг') || 'кг',
    isPowder: Boolean(row?.isPowder),
    returnQty: trimToString(row?.returnQty === '' ? '0' : (row?.returnQty || '0')),
    balanceQty: trimToString(row?.balanceQty || '')
  }));
  if (!updates.length) return false;

  const updateLines = [];
  updates.forEach(row => {
    const entry = orderedItems[row.sourceIndex];
    if (!entry || !entry.item) return;
    const item = entry.item;
    const itemUnit = trimToString(item?.unit || '') || row.unit;
    const matches =
      trimToString(item?.name || '') === row.name &&
      trimToString(item?.qty || '') === row.qty &&
      itemUnit === row.unit &&
      Boolean(item?.isPowder) === Boolean(row.isPowder);
    if (!matches) return;
    if (!item.unit) item.unit = row.unit;
    const normalizedBalance = row.balanceQty || subtractDecimalStrings(row.qty, row.returnQty);
    item.returnQty = row.returnQty;
    item.balanceQty = normalizedBalance;
    updateLines.push({
      name: row.name,
      qty: row.qty,
      unit: row.unit,
      isPowder: row.isPowder,
      returnQty: row.returnQty,
      balanceQty: normalizedBalance
    });
  });
  if (!updateLines.length) return false;

  const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lines = trimToString(card.mainMaterials || '').split('\n');
  const queueByBase = new Map();
  updateLines.forEach(entry => {
    const base = `${entry.name}; ${entry.qty} ${entry.unit}; тип-${entry.isPowder ? 'порошок' : 'нет'}`;
    if (!queueByBase.has(base)) queueByBase.set(base, []);
    queueByBase.get(base).push(entry);
  });
  card.mainMaterials = lines.map(line => {
    const raw = (line || '').trim();
    if (!raw) return line;
    for (const [base, queue] of queueByBase.entries()) {
      if (!queue.length) continue;
      const re = new RegExp('^' + escapeRegExp(base) + '(?:;.*)?$');
      if (!re.test(raw)) continue;
      const match = queue.shift();
      return `${base}; Воз. ${match.returnQty}; Ост. ${match.balanceQty} ${match.unit}`;
    }
    return line;
  }).join('\n');

  finalizeWorkspaceOperationDone(op);
  op.returnCompletedOnce = true;
  syncWorkspaceLocalFlowVersion(card, flowVersion);
  refreshCardStatuses();
  return true;
}

function ensureWorkspaceDryingEntry(card, op) {
  if (!card || !op) return null;
  card.materialIssues = Array.isArray(card.materialIssues) ? card.materialIssues : [];
  let entry = card.materialIssues.find(item => trimToString(item?.opId || '') === trimToString(op.id)) || null;
  const sourceRows = buildDryingSourceRows(card, op);
  if (!entry) {
    entry = {
      opId: op.id,
      updatedAt: Date.now(),
      updatedBy: currentUser?.name || '',
      items: [],
      dryingRows: sourceRows
    };
    card.materialIssues.push(entry);
    return entry;
  }
  entry.dryingRows = mergeDryingRows(Array.isArray(entry.dryingRows) ? entry.dryingRows : [], sourceRows);
  return entry;
}

function applyWorkspaceLocalDryingAction(card, op, action, {
  rowId = '',
  dryQty = '',
  flowVersion = null
} = {}) {
  if (!card || !op || !isDryingOperation(op)) return false;
  const now = Date.now();
  const dryingEntry = ensureWorkspaceDryingEntry(card, op);
  if (!dryingEntry) return false;
  const dryingRows = Array.isArray(dryingEntry.dryingRows) ? dryingEntry.dryingRows : [];
  if (action === 'start') {
    const rowIndex = dryingRows.findIndex(row => trimToString(row?.rowId || '') === trimToString(rowId));
    if (rowIndex < 0) return false;
    const row = dryingRows[rowIndex];
    const rowStatus = trimToString(row.status || '').toUpperCase();
    if (rowStatus !== 'NOT_STARTED') {
      const requestedDryQty = trimToString(dryQty || '');
      const currentDryQty = trimToString(row.dryQty || '');
      if ((rowStatus === 'IN_PROGRESS' || rowStatus === 'DONE') && (!requestedDryQty || currentDryQty === requestedDryQty)) {
        syncWorkspaceLocalFlowVersion(card, flowVersion);
        refreshCardStatuses();
        return true;
      }
      return false;
    }
    row.dryQty = trimToString(dryQty || '');
    row.dryResultQty = '';
    row.status = 'IN_PROGRESS';
    row.startedAt = now;
    row.finishedAt = null;
    row.updatedAt = now;
    if (compareDecimalStrings(row.qty, row.dryQty) > 0) {
      dryingRows.splice(rowIndex + 1, 0, {
        rowId: 'dry:' + genId('row'),
        sourceIssueOpId: trimToString(row.sourceIssueOpId || ''),
        sourceItemIndex: Number.isFinite(Number(row.sourceItemIndex)) ? Number(row.sourceItemIndex) : -1,
        name: trimToString(row.name || ''),
        qty: subtractDecimalStrings(row.qty, row.dryQty),
        unit: trimToString(row.unit || 'кг') || 'кг',
        isPowder: true,
        dryQty: '',
        dryResultQty: '',
        status: 'NOT_STARTED',
        startedAt: null,
        finishedAt: null,
        createdAt: now,
        updatedAt: now
      });
    }
    op.dryingCompletedManually = false;
  } else if (action === 'finish') {
    const row = dryingRows.find(item => trimToString(item?.rowId || '') === trimToString(rowId)) || null;
    if (!row) return false;
    row.status = 'DONE';
    row.finishedAt = now;
    row.dryResultQty = trimToString(row.dryQty || '');
    row.updatedAt = now;
  } else if (action === 'complete') {
    finalizeWorkspaceOperationDone(op, now);
    op.dryingCompletedManually = true;
  } else {
    return false;
  }
  dryingEntry.updatedAt = now;
  dryingEntry.updatedBy = currentUser?.name || dryingEntry.updatedBy || '';
  syncWorkspaceLocalFlowVersion(card, flowVersion);
  refreshCardStatuses();
  return true;
}

function refreshWorkspaceDryingUiAfterAction(cardId, opId, reason = 'workspace-drying') {
  refreshWorkspaceUiAfterAction(reason);
  const { card, op } = getWorkspaceCardAndOperation(cardId, opId);
  if (!card || !op) {
    closeDryingModal();
    return;
  }
  dryingRows = buildDryingRows(card, op);
  if (dryingContext) {
    dryingContext.flowVersion = Number.isFinite(card.flow?.version)
      ? card.flow.version
      : dryingContext.flowVersion;
  }
  renderDryingModalTable();
}

function getWorkspaceFlowListForCommit(card, op, kind = 'ITEM') {
  if (!card || !op) return [];
  ensureCardFlowForUi(card);
  if (String(kind || '').toUpperCase() === 'SAMPLE') {
    return getFlowSamplesForOperation(card.flow || {}, op);
  }
  return Array.isArray(card.flow?.items) ? card.flow.items : [];
}

function getNextWorkspaceOperationForKind(card, kind = 'ITEM', currentOpId = '', sampleType = '') {
  const ops = Array.isArray(card?.operations) ? card.operations : [];
  const wantSamples = String(kind || '').toUpperCase() === 'SAMPLE';
  const sampleTypeNorm = normalizeSampleType(sampleType);
  const currentId = trimToString(currentOpId);
  const sorted = ops
    .map((entry, index) => ({
      op: entry,
      index,
      order: Number.isFinite(Number(entry?.order)) ? Number(entry.order) : index
    }))
    .sort((a, b) => (a.order - b.order) || (a.index - b.index));
  let passedCurrent = false;
  for (const entry of sorted) {
    const op = entry.op;
    if (!op) continue;
    const opId = trimToString(op.id || op.opId);
    if (!passedCurrent) {
      if (opId === currentId) passedCurrent = true;
      continue;
    }
    if (Boolean(op.isSamples) !== wantSamples) continue;
    if (wantSamples && normalizeSampleType(op.sampleType) !== sampleTypeNorm) continue;
    return {
      opId,
      opCode: trimToString(op.opCode || '') || null
    };
  }
  return { opId: null, opCode: null };
}

function getLastWorkspaceOperationForKind(card, kind = 'ITEM', sampleType = '') {
  const ops = Array.isArray(card?.operations) ? card.operations : [];
  const wantSamples = String(kind || '').toUpperCase() === 'SAMPLE';
  const sampleTypeNorm = normalizeSampleType(sampleType);
  const sorted = ops
    .map((entry, index) => ({
      op: entry,
      index,
      order: Number.isFinite(Number(entry?.order)) ? Number(entry.order) : index
    }))
    .filter(entry => {
      const op = entry.op;
      if (!op) return false;
      if (Boolean(op.isSamples) !== wantSamples) return false;
      if (wantSamples && normalizeSampleType(op.sampleType) !== sampleTypeNorm) return false;
      return true;
    })
    .sort((a, b) => (a.order - b.order) || (a.index - b.index));
  const last = sorted[sorted.length - 1]?.op || null;
  return {
    opId: trimToString(last?.id || last?.opId || '') || null,
    opCode: trimToString(last?.opCode || '') || null
  };
}

function applyWorkspaceLocalTransferSelection(card, op, selectedItemIds, flowVersion = null, personalOperationId = '') {
  if (!card || !op || !Array.isArray(selectedItemIds) || !selectedItemIds.length) return false;
  card.personalOperations = Array.isArray(card.personalOperations) ? card.personalOperations : [];
  const normalizedSelectedIds = Array.from(new Set(selectedItemIds.map(value => trimToString(value)).filter(Boolean)));
  if (!normalizedSelectedIds.length) return false;
  const currentUserId = trimToString(currentUser?.id || '') || null;
  const currentUserName = trimToString(currentUser?.name || currentUser?.username || '') || null;
  let personalOp = null;
  if (personalOperationId) {
    personalOp = card.personalOperations.find(entry => trimToString(entry?.id || '') === trimToString(personalOperationId)) || null;
  }
  if (!personalOp) {
    personalOp = card.personalOperations.find(entry => (
      trimToString(entry?.parentOpId || '') === trimToString(op.id)
      && trimToString(entry?.currentExecutorUserId || '') === trimToString(currentUserId || '')
    )) || null;
  }
  if (!personalOp) {
    personalOp = {
      id: personalOperationId || genId('pop'),
      parentOpId: trimToString(op.id),
      kind: op.isSamples ? 'SAMPLE' : 'ITEM',
      itemIds: [],
      status: 'NOT_STARTED',
      currentExecutorUserId: currentUserId,
      currentExecutorUserName: currentUserName,
      historySegments: []
    };
    card.personalOperations.push(personalOp);
  }
  const ownedIds = new Set((Array.isArray(personalOp.itemIds) ? personalOp.itemIds : []).map(value => trimToString(value)).filter(Boolean));
  normalizedSelectedIds.forEach(itemId => ownedIds.add(itemId));
  personalOp.itemIds = Array.from(ownedIds);
  const now = Date.now();
  if (!personalOp.firstStartedAt) personalOp.firstStartedAt = now;
  personalOp.status = 'IN_PROGRESS';
  personalOp.startedAt = now;
  personalOp.lastPausedAt = null;
  personalOp.updatedAt = now;
  if (!Number.isFinite(personalOp.elapsedSeconds)) personalOp.elapsedSeconds = 0;
  personalOp.currentExecutorUserId = currentUserId;
  personalOp.currentExecutorUserName = currentUserName;
  syncWorkspaceLocalFlowVersion(card, flowVersion);
  refreshCardStatuses();
  return true;
}

function applyWorkspaceLocalTransferCommit(card, op, {
  kind = 'ITEM',
  updates = [],
  personalOperationId = '',
  flowVersion = null
} = {}) {
  if (!card || !op || !Array.isArray(updates) || !updates.length) return false;
  const list = getWorkspaceFlowListForCommit(card, op, kind);
  const opId = trimToString(op.id || op.opId);
  const opCode = trimToString(op.opCode) || null;
  let changed = false;
  updates.forEach(entry => {
    const itemId = trimToString(entry?.itemId);
    const status = trimToString(entry?.status).toUpperCase();
    const item = list.find(candidate => candidate && trimToString(candidate.id) === itemId) || null;
    if (!item || trimToString(item?.current?.opId) !== opId || trimToString(item?.current?.status).toUpperCase() !== 'PENDING') return;
    item.current = item.current && typeof item.current === 'object' ? item.current : {};
    item.current.opId = opId;
    item.current.opCode = opCode;
    item.current.status = status;
    item.current.updatedAt = Date.now();
    if (status === 'GOOD') {
      const sampleType = String(kind || '').toUpperCase() === 'SAMPLE' ? getOpSampleType(op) : '';
      const next = getNextWorkspaceOperationForKind(card, kind, opId, sampleType);
      if (next?.opId) {
        item.current.opId = next.opId;
        item.current.opCode = next.opCode;
        item.current.status = 'PENDING';
      } else {
        const last = getLastWorkspaceOperationForKind(card, kind, sampleType);
        item.current.opId = last.opId || opId;
        item.current.opCode = last.opCode || opCode;
        item.current.status = 'GOOD';
      }
    }
    changed = true;
  });
  if (!changed) return false;

  if (personalOperationId) {
    const personalOp = getCardPersonalOperationsUi(card, op.id)
      .find(entry => trimToString(entry?.id || '') === trimToString(personalOperationId)) || null;
    if (personalOp) {
      const pendingIds = getPersonalOperationPendingItemIdsUi(card, op, personalOp);
      if (!pendingIds.length) {
        const now = Date.now();
        if (trimToString(personalOp.status).toUpperCase() === 'IN_PROGRESS') {
          const diff = personalOp.startedAt ? (now - personalOp.startedAt) / 1000 : 0;
          personalOp.elapsedSeconds = (personalOp.elapsedSeconds || 0) + diff;
        }
        personalOp.status = 'DONE';
        personalOp.startedAt = null;
        personalOp.lastPausedAt = null;
        personalOp.finishedAt = now;
        personalOp.actualSeconds = personalOp.elapsedSeconds || 0;
        personalOp.updatedAt = now;
      }
    }
  } else {
    const basePending = getFlowItemsForOperation(card, op).filter(item => item?.current?.status === 'PENDING');
    if (!basePending.length && trimToString(op.status).toUpperCase() === 'IN_PROGRESS') {
      finalizeWorkspaceOperationDone(op);
    }
  }

  syncWorkspaceLocalFlowVersion(card, flowVersion);
  refreshCardStatuses();
  return true;
}

function applyWorkspaceLocalOperationAction(card, op, action, {
  personalOperationId = '',
  flowVersion = null
} = {}) {
  if (!card || !op) return false;
  const now = Date.now();
  const normalizedAction = String(action || '').trim().toLowerCase();
  const normalizedPersonalOperationId = String(personalOperationId || '').trim();

  if (normalizedPersonalOperationId) {
    const personalOp = getCardPersonalOperationsUi(card)
      .find(entry => String(entry?.id || '').trim() === normalizedPersonalOperationId);
    if (!personalOp) return false;
    if (normalizedAction === 'pause') {
      if (trimToString(personalOp.status).toUpperCase() === 'IN_PROGRESS') {
        const diff = personalOp.startedAt ? (now - personalOp.startedAt) / 1000 : 0;
        personalOp.elapsedSeconds = (personalOp.elapsedSeconds || 0) + diff;
      }
      personalOp.status = 'PAUSED';
      personalOp.startedAt = null;
      personalOp.lastPausedAt = now;
      personalOp.updatedAt = now;
    } else if (normalizedAction === 'reset') {
      if (trimToString(personalOp.status).toUpperCase() === 'IN_PROGRESS') {
        const diff = personalOp.startedAt ? (now - personalOp.startedAt) / 1000 : 0;
        personalOp.elapsedSeconds = (personalOp.elapsedSeconds || 0) + diff;
      }
      personalOp.status = 'NOT_STARTED';
      personalOp.startedAt = null;
      personalOp.lastPausedAt = null;
      personalOp.finishedAt = null;
      personalOp.updatedAt = now;
    } else if (normalizedAction === 'start' || normalizedAction === 'resume') {
      if (!personalOp.firstStartedAt) personalOp.firstStartedAt = now;
      personalOp.status = 'IN_PROGRESS';
      personalOp.startedAt = now;
      personalOp.lastPausedAt = null;
      personalOp.updatedAt = now;
      if (!Number.isFinite(personalOp.elapsedSeconds)) personalOp.elapsedSeconds = 0;
      if (currentUser?.id != null) personalOp.currentExecutorUserId = currentUser.id;
      if (currentUser?.name) personalOp.currentExecutorUserName = currentUser.name;
    } else {
      return false;
    }
  } else {
    if (normalizedAction === 'start') {
      if (!op.firstStartedAt) op.firstStartedAt = now;
      op.status = 'IN_PROGRESS';
      op.startedAt = now;
      op.lastPausedAt = null;
      if (!Number.isFinite(op.elapsedSeconds) && Number.isFinite(op.actualSeconds)) {
        op.elapsedSeconds = op.actualSeconds;
      }
      if (!Number.isFinite(op.elapsedSeconds)) op.elapsedSeconds = 0;
    } else if (normalizedAction === 'pause') {
      if (op.status === 'IN_PROGRESS') {
        const diff = op.startedAt ? (now - op.startedAt) / 1000 : 0;
        op.elapsedSeconds = (op.elapsedSeconds || 0) + diff;
      }
      op.status = 'PAUSED';
      op.startedAt = null;
      op.lastPausedAt = now;
    } else if (normalizedAction === 'resume') {
      if (!op.firstStartedAt) op.firstStartedAt = now;
      op.status = 'IN_PROGRESS';
      op.startedAt = now;
      op.lastPausedAt = null;
      if (!Number.isFinite(op.elapsedSeconds)) op.elapsedSeconds = 0;
    } else if (normalizedAction === 'reset') {
      if (op.status === 'IN_PROGRESS') {
        const diff = op.startedAt ? (now - op.startedAt) / 1000 : 0;
        op.elapsedSeconds = (op.elapsedSeconds || 0) + diff;
      }
      op.status = 'NOT_STARTED';
      op.startedAt = null;
      op.lastPausedAt = null;
      op.finishedAt = null;
      if (isDryingOperation(op)) op.dryingCompletedManually = false;
    } else {
      return false;
    }
    op.actualSeconds = op.elapsedSeconds || 0;
    syncWorkspaceLocalOperationActionFlags(op);
  }

  if (Number.isFinite(flowVersion)) {
    card.flow = card.flow || {};
    card.flow.version = flowVersion;
  }
  refreshCardStatuses();
  return true;
}

function makeWorkspaceOpenShiftKey(date, shift) {
  return `${String(date || '')}|${parseInt(shift, 10) || 1}`;
}

function getWorkspaceOpenShiftKeys() {
  return new Set(
    (productionShifts || [])
      .filter(item => item && item.status === 'OPEN')
      .map(item => makeWorkspaceOpenShiftKey(item.date, item.shift))
  );
}

function getWorkspaceOpenShiftTasks(card) {
  if (!card?.id) return [];
  const openKeys = getWorkspaceOpenShiftKeys();
  if (!openKeys.size) return [];
  return (productionShiftTasks || []).filter(task => (
    task
    && String(task.cardId || '') === String(card.id || '')
    && openKeys.has(makeWorkspaceOpenShiftKey(task.date, task.shift))
  ));
}

function isWorkspaceRegularOperation(op) {
  return Boolean(op) && !isMaterialIssueOperation(op) && !isMaterialReturnOperation(op);
}

function shouldPrioritizeWorkspaceShiftLockUi(op) {
  return isWorkspaceRegularOperation(op);
}

function hasWorkspaceRegularOperationPlanned(card) {
  if (!card?.id) return false;
  return getWorkspaceOpenShiftTasks(card).some(task => {
    const op = (card.operations || []).find(item => String(item?.id || '') === String(task.routeOpId || '')) || null;
    return isWorkspaceRegularOperation(op);
  });
}

function isWorkspaceOperationAllowed(card, op) {
  if (!card || !op) return false;
  if (!getWorkspaceOpenShiftKeys().size) return false;
  if (isMaterialIssueOperation(op) || isMaterialReturnOperation(op)) {
    return hasWorkspaceRegularOperationPlanned(card);
  }
  return getWorkspaceOpenShiftTasks(card).some(task => String(task.routeOpId || '') === String(op.id || ''));
}

function getWorkspaceOpenShiftTasksForOperation(card, op) {
  if (!card?.id || !op?.id) return [];
  return getWorkspaceOpenShiftTasks(card).filter(task => String(task.routeOpId || '') === String(op.id || ''));
}

function isWorkspaceSubcontractTask(task) {
  if (!task) return false;
  if (typeof isSubcontractTask === 'function') {
    return isSubcontractTask(task);
  }
  return String(task?.subcontractChainId || '').trim().length > 0;
}

function getWorkspaceOpenSubcontractTasksForOperation(card, op) {
  return getWorkspaceOpenShiftTasksForOperation(card, op).filter(task => isWorkspaceSubcontractTask(task));
}

function getCurrentUserIdentityVariants() {
  const variants = new Set();
  [currentUser?.name, currentUser?.username, currentUser?.login].forEach(value => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized) variants.add(normalized);
  });
  return variants;
}

function isCurrentUserAssignedAsWorkspaceExecutor(card, op) {
  const userKeys = getCurrentUserIdentityVariants();
  if (!userKeys.size) return false;
  return getOperationResolvedExecutors(card, op).some(name => userKeys.has(String(name || '').trim().toLowerCase()));
}

function hasCurrentUserWorkspaceShiftMasterPermission(tasks) {
  const userId = String(currentUser?.id || '').trim();
  if (!userId || !Array.isArray(tasks) || !tasks.length) return false;
  const masterAreaId = typeof PRODUCTION_SHIFT_MASTER_AREA_ID !== 'undefined'
    ? String(PRODUCTION_SHIFT_MASTER_AREA_ID || '')
    : '__shift_master__';
  return tasks.some(task => (productionSchedule || []).some(record => (
    record
    && String(record.date || '') === String(task?.date || '')
    && (parseInt(record.shift, 10) || 1) === (parseInt(task?.shift, 10) || 1)
    && String(record.areaId || '') === masterAreaId
    && String(record.employeeId || '') === userId
  )));
}

function canCurrentUserOperateWorkspaceSubcontract(card, op) {
  const subcontractTasks = getWorkspaceOpenSubcontractTasksForOperation(card, op);
  if (!subcontractTasks.length) return true;
  if (isCurrentUserAssignedAsWorkspaceExecutor(card, op)) return true;
  return hasCurrentUserWorkspaceShiftMasterPermission(subcontractTasks);
}

function getCurrentUserWorkspaceRoleFlagsUi(user = currentUser) {
  const permissions = user?.permissions || null;
  const isAdmin = typeof isAdminLikeCurrentUserUi === 'function' && isAdminLikeCurrentUserUi();
  const worker = Boolean(permissions?.worker);
  const warehouseWorker = Boolean(permissions?.warehouseWorker);
  const restricted = !isAdmin && (worker || warehouseWorker);
  return {
    worker,
    warehouseWorker,
    restricted,
    unrestricted: !restricted
  };
}

function isWorkspaceMaterialOperationUi(op) {
  return isMaterialIssueOperation(op) || isMaterialReturnOperation(op);
}

function canCurrentUserAccessWorkspaceTaskAssignmentUi(card, op) {
  if (!card || !op) return false;
  const userId = typeof normalizeUserId === 'function'
    ? normalizeUserId(currentUser?.id)
    : String(currentUser?.id || '').trim().toLowerCase();
  if (!userId) return false;
  return getWorkspaceOpenShiftTasksForOperation(card, op).some(task => (
    productionSchedule || []
  ).some(record => (
    record
    && String(record.date || '') === String(task.date || '')
    && Number(record.shift || 0) === Number(task.shift || 0)
    && String(record.areaId || '') === String(task.areaId || '')
    && (typeof normalizeUserId === 'function'
      ? normalizeUserId(record.employeeId)
      : String(record.employeeId || '').trim().toLowerCase()) === userId
  )));
}

function canCurrentUserAccessWorkspaceWorkerOperationUi(card, op) {
  if (!card || !op) return false;
  if (isWorkspaceMaterialOperationUi(op)) return false;
  if (isCurrentUserAssignedAsWorkspaceExecutor(card, op)) return true;
  return canCurrentUserAccessWorkspaceTaskAssignmentUi(card, op);
}

function getCurrentUserWorkspaceOperationRoleAccessUi(card, op) {
  const roleFlags = getCurrentUserWorkspaceRoleFlagsUi();
  if (!roleFlags.restricted) {
    return {
      ...roleFlags,
      workerAllowed: true,
      warehouseAllowed: true,
      roleAllowed: true,
      denialReason: ''
    };
  }
  const workerAllowed = roleFlags.worker && canCurrentUserAccessWorkspaceWorkerOperationUi(card, op);
  const warehouseAllowed = roleFlags.warehouseWorker && isWorkspaceMaterialOperationUi(op);
  const roleAllowed = workerAllowed || warehouseAllowed;
  let denialReason = '';
  if (!roleAllowed) {
    denialReason = isWorkspaceMaterialOperationUi(op)
      ? 'Операция материалов доступна только работнику склада.'
      : 'Операция доступна только назначенному исполнителю.';
  }
  return {
    ...roleFlags,
    workerAllowed,
    warehouseAllowed,
    roleAllowed,
    denialReason
  };
}

function getCurrentUserWorkspaceVisibleOpsUi(card) {
  const ops = Array.isArray(card?.operations) ? card.operations : [];
  const roleFlags = getCurrentUserWorkspaceRoleFlagsUi();
  if (!roleFlags.restricted) {
    return {
      visibleOps: ops.slice(),
      hiddenOps: [],
      hasAccess: ops.length > 0
    };
  }
  const visibleOps = [];
  const hiddenOps = [];
  ops.forEach(op => {
    const roleAccess = getCurrentUserWorkspaceOperationRoleAccessUi(card, op);
    if (roleAccess.roleAllowed && isWorkspaceOperationAllowed(card, op)) {
      visibleOps.push(op);
    } else {
      hiddenOps.push(op);
    }
  });
  return {
    visibleOps,
    hiddenOps,
    hasAccess: visibleOps.length > 0
  };
}

function isWorkspaceCardBaseVisible(card) {
  return Boolean(
    card &&
    !card.archived &&
    card.cardType === 'MKI' &&
    card.operations &&
    card.operations.length &&
    (card.approvalStage === APPROVAL_STAGE_PLANNING || card.approvalStage === APPROVAL_STAGE_PLANNED) &&
    hasWorkspaceRegularOperationPlanned(card)
  );
}

function canCurrentUserAccessWorkspaceCardUi(card) {
  if (!isWorkspaceCardBaseVisible(card)) return false;
  return getCurrentUserWorkspaceVisibleOpsUi(card).hasAccess;
}

function getWorkspaceOpenSubcontractItemIds(card, op) {
  const ids = new Set();
  getWorkspaceOpenSubcontractTasksForOperation(card, op).forEach(task => {
    const itemIds = Array.isArray(task?.subcontractItemIds) ? task.subcontractItemIds : [];
    itemIds.forEach(itemId => {
      const normalized = String(itemId || '').trim();
      if (normalized) ids.add(normalized);
    });
  });
  return ids;
}

function getWorkspacePlannedTasksForOperation(card, op) {
  if (!card?.id || !op?.id) return [];
  return (productionShiftTasks || []).filter(task => (
    task
    && String(task.cardId || '') === String(card.id || '')
    && String(task.routeOpId || '') === String(op.id || '')
  ));
}

function getWorkspacePlannedTaskLabel(task) {
  if (!task) return '';
  const dateLabel = typeof formatProductionDisplayDate === 'function'
    ? formatProductionDisplayDate(task.date || '')
    : String(task.date || '');
  const shiftLabel = `${parseInt(task.shift, 10) || 1} смена`;
  return `${dateLabel} ${shiftLabel}`.trim();
}

function compareWorkspaceShiftSlots(a, b) {
  if (String(a?.date || '') !== String(b?.date || '')) {
    return String(a?.date || '').localeCompare(String(b?.date || ''));
  }
  return (parseInt(a?.shift, 10) || 1) - (parseInt(b?.shift, 10) || 1);
}

function getWorkspaceOpenShiftRange() {
  const openShifts = (productionShifts || [])
    .filter(item => item && String(item.status || '').trim().toUpperCase() === 'OPEN')
    .map(item => ({
      date: String(item.date || ''),
      shift: parseInt(item.shift, 10) || 1
    }))
    .filter(item => item.date)
    .sort(compareWorkspaceShiftSlots);
  if (!openShifts.length) return null;
  return {
    earliest: openShifts[0],
    latest: openShifts[openShifts.length - 1],
    count: openShifts.length
  };
}

function getAreaByIdUi(areaId) {
  const key = String(areaId || '').trim();
  if (!key) return null;
  return (areas || []).find(area => String(area?.id || '').trim() === key) || null;
}

function getOperationAreaUi(card, op) {
  if (!card || !op) return null;
  const directArea = getAreaByIdUi(op.areaId || op.centerId);
  if (directArea) return directArea;
  const plannedTask = (productionShiftTasks || []).find(task => (
    task
    && String(task.cardId || '') === String(card.id || '')
    && String(task.routeOpId || '') === String(op.id || '')
  )) || null;
  const taskArea = getAreaByIdUi(plannedTask?.areaId || '');
  if (taskArea) return taskArea;
  const centerName = String(op.centerName || '').trim().toLowerCase();
  if (!centerName) return null;
  return (areas || []).find(area => String(area?.name || '').trim().toLowerCase() === centerName) || null;
}

function isIndividualOperationUi(card, op) {
  const type = normalizeOperationType(op?.operationType);
  if (!['Стандартная', 'Идентификация', 'Документы'].includes(type)) return false;
  if (getCardPersonalOperationsUi(card, op?.id).length) return true;
  const areaType = normalizeAreaType(getOperationAreaUi(card, op)?.type || '');
  return areaType === 'Индивидуальный';
}

function getCardPersonalOperationsUi(card, parentOpId = '') {
  const targetOpId = String(parentOpId || '').trim();
  const list = Array.isArray(card?.personalOperations) ? card.personalOperations : [];
  const filtered = targetOpId
    ? list.filter(entry => String(entry?.parentOpId || '').trim() === targetOpId)
    : list.slice();
  return filtered.slice().sort((left, right) => {
    const leftTs = Number(left?.updatedAt || left?.createdAt || left?.firstStartedAt || 0);
    const rightTs = Number(right?.updatedAt || right?.createdAt || right?.firstStartedAt || 0);
    if (leftTs !== rightTs) return leftTs - rightTs;
    return String(left?.id || '').localeCompare(String(right?.id || ''));
  });
}

function normalizePersonalOperationStatusUi(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (['NOT_STARTED', 'IN_PROGRESS', 'PAUSED', 'DONE'].includes(raw)) return raw;
  return 'NOT_STARTED';
}

function getCurrentUserPersonalIdentityVariants() {
  const variants = new Set();
  const userId = typeof normalizeUserId === 'function'
    ? normalizeUserId(currentUser?.id)
    : String(currentUser?.id || '').trim().toLowerCase();
  if (userId) variants.add(userId);
  [currentUser?.name, currentUser?.username, currentUser?.login].forEach(value => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized) variants.add(normalized);
  });
  return variants;
}

function isAdminLikeCurrentUserUi() {
  const role = String(currentUser?.role || currentUser?.status || currentUser?.login || '').trim().toLowerCase();
  return Boolean(
    currentUser?.permissions?.headSKK
    || role === 'admin'
    || role === 'administrator'
    || role === 'администратор'
  );
}

function canCurrentUserAccessIndividualOperationUi(card, op) {
  if (!card || !op) return false;
  if (isAdminLikeCurrentUserUi()) return true;
  const userId = typeof normalizeUserId === 'function'
    ? normalizeUserId(currentUser?.id)
    : String(currentUser?.id || '').trim().toLowerCase();
  if (!userId) return false;
  const tasks = getWorkspaceOpenShiftTasksForOperation(card, op);
  if (!tasks.length) return false;
  return tasks.some(task => (productionSchedule || []).some(record => (
    record
    && String(record.date || '') === String(task.date || '')
    && Number(record.shift || 0) === Number(task.shift || 0)
    && String(record.areaId || '') === String(task.areaId || '')
    && (typeof normalizeUserId === 'function'
      ? normalizeUserId(record.employeeId)
      : String(record.employeeId || '').trim().toLowerCase()) === userId
  )));
}

function isCurrentUserPersonalExecutorUi(personalOp) {
  if (!personalOp) return false;
  const variants = getCurrentUserPersonalIdentityVariants();
  if (!variants.size) return false;
  const userId = typeof normalizeUserId === 'function'
    ? normalizeUserId(personalOp.currentExecutorUserId)
    : String(personalOp.currentExecutorUserId || '').trim().toLowerCase();
  const userName = String(personalOp.currentExecutorUserName || '').trim().toLowerCase();
  return (userId && variants.has(userId)) || (userName && variants.has(userName));
}

function canCurrentUserOperatePersonalOperationUi(card, op, personalOp) {
  if (!card || !op || !personalOp) return false;
  return isAdminLikeCurrentUserUi() || isCurrentUserPersonalExecutorUi(personalOp);
}

function getCurrentUserVisiblePersonalOperationsUi(card, op, personalOperations) {
  const list = Array.isArray(personalOperations) ? personalOperations : [];
  if (!getCurrentUserWorkspaceRoleFlagsUi().restricted) return list;
  return list.filter(personalOp => canCurrentUserOperatePersonalOperationUi(card, op, personalOp));
}

function getBusyPendingItemIdsForOperationUi(card, op, { excludePersonalOperationId = '' } = {}) {
  const ids = new Set();
  const excluded = String(excludePersonalOperationId || '').trim();
  getCardPersonalOperationsUi(card, op?.id).forEach(entry => {
    if (!entry || (excluded && String(entry.id || '') === excluded)) return;
    const pendingIds = getPersonalOperationPendingItemIdsUi(card, op, entry);
    pendingIds.forEach(itemId => ids.add(itemId));
  });
  return ids;
}

function getAvailableIndividualOperationItemsUi(card, op) {
  const busyIds = getBusyPendingItemIdsForOperationUi(card, op);
  return getFlowItemsForOperation(card, op)
    .filter(item => item?.current?.status === 'PENDING')
    .filter(item => !busyIds.has(String(item?.id || '').trim()));
}

function getIndividualParentFlowBlockedReasonsUi(op) {
  return Array.isArray(op?.parentFlowBlockedReasons)
    ? op.parentFlowBlockedReasons.filter(Boolean)
    : [];
}

function isIndividualParentFlowBlockedUi(op) {
  return Boolean(op?.parentFlowBlocked) || getIndividualParentFlowBlockedReasonsUi(op).length > 0;
}

function normalizeWorkspaceFlowBlockedReasonUi(reason) {
  const raw = trimToString(reason);
  if (!raw) return '';
  const map = {
    'Есть незавершенные образцы на предыдущих операциях.': 'Есть незавершённые образцы на предыдущих операциях.',
    'Есть незавершенные изделия на предыдущих операциях.': 'Есть незавершённые изделия на предыдущих операциях.',
    'На предыдущих операциях есть образцы со статусами «В ожидании», «Задержано» или «Брак».': 'На предыдущих операциях есть образцы со статусами «В ожидании», «Задержано» или «Брак».',
    'На предыдущих операциях есть изделия со статусами «В ожидании», «Задержано» или «Брак».': 'На предыдущих операциях есть изделия со статусами «В ожидании», «Задержано» или «Брак».',
    'На предыдущей операции есть ОК со статусами «В ожидании», «Задержано» или «Брак».': 'На предыдущей операции есть ОК со статусами «В ожидании», «Задержано» или «Брак».',
    'Возврат материала не завершен.': 'Возврат материала не завершён.',
    'Нет завершенной операции «Получение материала» перед возвратом.': 'Нет завершённой операции «Получение материала» перед возвратом.',
    'Нет завершенных операций «Получение материала» перед сушкой.': 'Нет завершённых операций «Получение материала» перед сушкой.',
    'Для участка «Индивид.» действие доступно только на личной операции.': 'Это действие доступно только на личной операции.'
  };
  return map[raw] || raw;
}

function getWorkspaceFlowBlockedReasonsUi(op, { parentFlow = false } = {}) {
  const source = parentFlow
    ? getIndividualParentFlowBlockedReasonsUi(op)
    : (Array.isArray(op?.blockedReasons) ? op.blockedReasons.filter(Boolean) : []);
  const seen = new Set();
  return source
    .map(normalizeWorkspaceFlowBlockedReasonUi)
    .filter(Boolean)
    .filter(reason => {
      if (seen.has(reason)) return false;
      seen.add(reason);
      return true;
    });
}

function isWorkspaceNoItemsReasonUi(reason) {
  const normalized = trimToString(reason);
  return normalized === 'Нет изделий на операции'
    || normalized === 'Нет изделий на операции.'
    || normalized === 'Нет образцов на операции.';
}

function findWorkspaceNearestPreviousPendingOperationUi(card, op) {
  if (!card || !op) return null;
  ensureCardFlowForUi(card);
  const currentOpId = String(op?.id || op?.opId || '').trim();
  if (!currentOpId) return null;
  const orderMap = buildOperationOrderMap(card);
  const currentOrder = orderMap.get(currentOpId);
  if (!Number.isFinite(currentOrder)) return null;
  const opsSorted = getWorkspaceSortedOps(card);
  if (!opsSorted.length) return null;
  const items = op?.isSamples
    ? getFlowSamplesForOperation(card.flow || {}, op)
    : (Array.isArray(card?.flow?.items) ? card.flow.items : []);
  let nearest = null;
  opsSorted.forEach(candidate => {
    if (!candidate) return;
    const candidateOpId = String(candidate?.id || candidate?.opId || '').trim();
    if (!candidateOpId || candidateOpId === currentOpId) return;
    const candidateOrder = orderMap.get(candidateOpId);
    if (!Number.isFinite(candidateOrder) || candidateOrder >= currentOrder) return;
    const hasPending = items.some(item => (
      item
      && String(item?.current?.status || '').trim().toUpperCase() === 'PENDING'
      && String(item?.current?.opId || '').trim() === candidateOpId
    ));
    if (!hasPending) return;
    if (!nearest || candidateOrder > nearest.order) {
      nearest = { op: candidate, order: candidateOrder };
    }
  });
  return nearest?.op || null;
}

function buildWorkspaceNearestPendingReasonUi(card, op) {
  const nearestOp = findWorkspaceNearestPreviousPendingOperationUi(card, op);
  if (!nearestOp) return '';
  const opCode = trimToString(nearestOp?.opCode || nearestOp?.code || nearestOp?.id || 'операция');
  const centerName = trimToString(nearestOp?.centerName || nearestOp?.areaName || 'неизвестный участок');
  const subject = op?.isSamples ? 'Ближайший образец' : 'Ближайшее изделие';
  return `${subject} на операции «${opCode}» в подразделении «${centerName}»`;
}

function enrichWorkspaceBlockedInfoReasonsUi(card, op, reasons) {
  if (!Array.isArray(reasons) || !reasons.length) return [];
  const detailsReason = buildWorkspaceNearestPendingReasonUi(card, op);
  if (!detailsReason) return reasons.slice();
  const next = [];
  reasons.forEach(reason => {
    next.push(reason);
    if (isWorkspaceNoItemsReasonUi(reason)) {
      next.push(detailsReason);
    }
  });
  return next;
}

function getWorkspaceBlockedInfoReasonsUi(card, op, { parentFlow = false, effectiveStatus = '' } = {}) {
  const status = String(effectiveStatus || op?.status || '').trim().toUpperCase();
  const reasons = (!parentFlow && status === 'NO_ITEMS')
    ? ['Нет изделий на операции']
    : getWorkspaceFlowBlockedReasonsUi(op, { parentFlow });
  if (parentFlow) {
    return reasons;
  }
  return enrichWorkspaceBlockedInfoReasonsUi(card, op, reasons);
}

function encodeWorkspaceTooltipTextUi(lines) {
  return escapeHtml((Array.isArray(lines) ? lines : []).join('\n')).replace(/\n/g, '&#10;');
}

function buildWorkspaceFlowBlockedBadgeHtml(reasons) {
  if (!Array.isArray(reasons) || !reasons.length) return '';
  const tooltip = encodeWorkspaceTooltipTextUi(reasons);
  const ariaLabel = escapeHtml('Причины блокировки: ' + reasons.join(' '));
  return '<button type="button" class="btn-secondary workspace-op-blocked-info" data-action="workspace-blocked-info" data-allow-view="true" title="' + tooltip + '" aria-label="' + ariaLabel + '">?</button>';
}

function decodeWorkspaceBlockedInfoTextUi(value) {
  const text = String(value || '').trim();
  return text
    .replace(/&#10;/g, '\n')
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

function openWorkspaceBlockedInfoModal(message) {
  const modal = document.getElementById('workspace-blocked-info-modal');
  const messageEl = document.getElementById('workspace-blocked-info-message');
  if (!modal || !messageEl) return;
  messageEl.textContent = decodeWorkspaceBlockedInfoTextUi(message);
  modal.classList.remove('hidden');
  document.getElementById('workspace-blocked-info-cancel')?.focus();
}

function closeWorkspaceBlockedInfoModal() {
  const modal = document.getElementById('workspace-blocked-info-modal');
  const messageEl = document.getElementById('workspace-blocked-info-message');
  if (modal) modal.classList.add('hidden');
  if (messageEl) messageEl.textContent = '';
}

function setupWorkspaceBlockedInfoModal() {
  const modal = document.getElementById('workspace-blocked-info-modal');
  if (!modal || modal.dataset.bound === 'true') return;
  modal.dataset.bound = 'true';
  const closeBtn = document.getElementById('workspace-blocked-info-close');
  const cancelBtn = document.getElementById('workspace-blocked-info-cancel');
  if (closeBtn) closeBtn.addEventListener('click', () => closeWorkspaceBlockedInfoModal());
  if (cancelBtn) cancelBtn.addEventListener('click', () => closeWorkspaceBlockedInfoModal());
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeWorkspaceBlockedInfoModal();
  });
}

function getWorkspaceShiftAwaitingQtyUi(card, op) {
  const metrics = getWorkspaceShiftBlockedBadgeMetricsUi(card, op);
  return metrics ? metrics.awaitingQty : null;
}

function getWorkspaceShiftBlockedBadgeMetricsUi(card, op) {
  if (!card || !op) return null;
  if (isMaterialIssueOperation(op) || isMaterialReturnOperation(op) || isDryingOperation(op)) return null;
  const stats = getOperationExecutionStats(card, op);
  const shiftPlanStats = getWorkspaceOpenShiftPlanStats(card, op, stats);
  if (!shiftPlanStats) return null;
  const basePendingQty = isIndividualOperationUi(card, op)
    ? getAvailableIndividualOperationItemsUi(card, op).length
    : Math.max(0, Number(stats?.pendingOnOp || 0));
  const shiftRemainingQty = Math.max(
    0,
    Number(shiftPlanStats.plannedQty || 0) - Number(shiftPlanStats.doneQty || 0)
  );
  const pendingQty = Math.min(
    basePendingQty,
    shiftRemainingQty
  );
  const awaitingQty = Math.min(
    Math.max(0, Number(stats?.awaiting || 0)),
    Math.max(0, shiftRemainingQty - pendingQty)
  );
  return {
    pendingQty,
    awaitingQty
  };
}

function shouldShowWorkspaceFlowBlockedBadgeUi(card, op, reasons, { parentFlow = false, effectiveStatus = '' } = {}) {
  if (!Array.isArray(reasons) || !reasons.length) return false;
  const status = String(effectiveStatus || op?.status || '').trim().toUpperCase();
  if (!parentFlow && status === 'NO_ITEMS') return true;
  const shiftMetrics = getWorkspaceShiftBlockedBadgeMetricsUi(card, op);
  if (shiftMetrics && shiftMetrics.awaitingQty <= 0 && shiftMetrics.pendingQty <= 0) return false;
  if (parentFlow) return isIndividualParentFlowBlockedUi(op);
  if (status === 'NOT_STARTED') return !op?.canStart;
  if (status === 'PAUSED') return !op?.canResume;
  if (status === 'DONE' && (isMaterialIssueOperation(op) || isMaterialReturnOperation(op))) return !op?.canStart;
  return false;
}

function getPersonalOperationItemsUi(card, op, personalOp) {
  if (!card || !op || !personalOp) return [];
  const ownedIds = new Set((Array.isArray(personalOp.itemIds) ? personalOp.itemIds : []).map(itemId => String(itemId || '').trim()).filter(Boolean));
  return getFlowItemsForOperation(card, op).filter(item => ownedIds.has(String(item?.id || '').trim()));
}

function getPersonalOperationPendingItemIdsUi(card, op, personalOp) {
  return getPersonalOperationItemsUi(card, op, personalOp)
    .filter(item => String(item?.current?.status || '').trim().toUpperCase() === 'PENDING')
    .map(item => String(item?.id || '').trim())
    .filter(Boolean);
}

function getPersonalOperationElapsedSecondsUi(personalOp) {
  if (!personalOp) return 0;
  const base = Number.isFinite(Number(personalOp.elapsedSeconds))
    ? Number(personalOp.elapsedSeconds)
    : (Number.isFinite(Number(personalOp.actualSeconds)) ? Number(personalOp.actualSeconds) : 0);
  if (normalizePersonalOperationStatusUi(personalOp.status) === 'IN_PROGRESS' && personalOp.startedAt) {
    return base + (Date.now() - Number(personalOp.startedAt)) / 1000;
  }
  return base;
}

function getPersonalOperationStoredSecondsUi(personalOp) {
  if (!personalOp) return 0;
  if (Number.isFinite(Number(personalOp.actualSeconds))) return Number(personalOp.actualSeconds);
  if (Number.isFinite(Number(personalOp.elapsedSeconds))) return Number(personalOp.elapsedSeconds);
  return 0;
}

function getIndividualOperationElapsedSecondsUi(card, op) {
  if (!isIndividualOperationUi(card, op)) {
    return getOperationElapsedSeconds(op, card);
  }
  const personalOperations = getCardPersonalOperationsUi(card, op?.id);
  if (!personalOperations.length) {
    return getOperationElapsedSeconds(op, card);
  }
  return personalOperations.reduce((sum, personalOp) => sum + getPersonalOperationElapsedSecondsUi(personalOp), 0);
}

function getIndividualOperationStoredSecondsUi(card, op) {
  if (!isIndividualOperationUi(card, op)) {
    return Number.isFinite(Number(op?.elapsedSeconds))
      ? Number(op.elapsedSeconds)
      : (Number.isFinite(Number(op?.actualSeconds)) ? Number(op.actualSeconds) : 0);
  }
  const personalOperations = getCardPersonalOperationsUi(card, op?.id);
  if (!personalOperations.length) {
    return Number.isFinite(Number(op?.elapsedSeconds))
      ? Number(op.elapsedSeconds)
      : (Number.isFinite(Number(op?.actualSeconds)) ? Number(op.actualSeconds) : 0);
  }
  return personalOperations.reduce((sum, personalOp) => sum + getPersonalOperationStoredSecondsUi(personalOp), 0);
}

function buildPersonalOperationItemLabelUi(card, op, personalOp) {
  const items = getPersonalOperationItemsUi(card, op, personalOp);
  const labels = items
    .map(item => String(item?.displayName || item?.id || '').trim())
    .filter(Boolean);
  return labels.join(', ');
}

function getPersonalOperationDisplaySegmentsUi(personalOp) {
  const rawSegments = Array.isArray(personalOp?.historySegments) ? personalOp.historySegments : [];
  return rawSegments.reduce((acc, segment) => {
    if (!segment) return acc;
    const executorUserId = String(segment?.executorUserId || '').trim();
    const executorUserName = String(segment?.executorUserName || '').trim();
    const elapsed = Number.isFinite(Number(segment?.actualSeconds))
      ? Number(segment.actualSeconds)
      : (Number.isFinite(Number(segment?.elapsedSeconds)) ? Number(segment.elapsedSeconds) : 0);
    const last = acc.length ? acc[acc.length - 1] : null;
    const sameExecutor = last
      && String(last.executorUserId || '').trim() === executorUserId
      && String(last.executorUserName || '').trim() === executorUserName;
    if (sameExecutor) {
      last.elapsedSeconds = Math.max(0, Number(last.elapsedSeconds) || 0) + Math.max(0, elapsed);
      last.actualSeconds = Math.max(0, Number(last.actualSeconds) || 0) + Math.max(0, elapsed);
      if (!last.firstStartedAt && segment?.firstStartedAt) last.firstStartedAt = segment.firstStartedAt;
      if (!last.startedAt && segment?.startedAt) last.startedAt = segment.startedAt;
      if (segment?.finishedAt) last.finishedAt = segment.finishedAt;
      last.finalState = segment?.finalState || last.finalState || 'DONE';
      return acc;
    }
    acc.push({
      executorUserId,
      executorUserName,
      firstStartedAt: segment?.firstStartedAt || null,
      startedAt: segment?.startedAt || null,
      finishedAt: segment?.finishedAt || null,
      elapsedSeconds: Math.max(0, elapsed),
      actualSeconds: Math.max(0, elapsed),
      finalState: segment?.finalState || 'DONE'
    });
    return acc;
  }, []);
}

function renderPersonalOperationHistoryCellUi(personalOp, kind, { timerRowId = '' } = {}) {
  const segments = getPersonalOperationDisplaySegmentsUi(personalOp);
  const status = normalizePersonalOperationStatusUi(personalOp?.status);
  const currentSeconds = getPersonalOperationElapsedSecondsUi(personalOp);
  const currentExecutorName = String(personalOp?.currentExecutorUserName || '—').trim() || '—';
  const previousSegments = segments.slice(0, -1);
  const pieces = previousSegments.map(segment => {
    const name = String(segment?.executorUserName || '—').trim() || '—';
    const elapsed = Number.isFinite(Number(segment?.actualSeconds))
      ? Number(segment.actualSeconds)
      : (Number.isFinite(Number(segment?.elapsedSeconds)) ? Number(segment.elapsedSeconds) : 0);
    if (kind === 'executor') return `<div class="personal-op-cell-line personal-op-cell-line-history">${escapeHtml(name)}</div>`;
    if (kind === 'status') return '<div class="personal-op-cell-line personal-op-cell-line-history">Завершена</div>';
    if (kind === 'time') return `<div class="personal-op-cell-line personal-op-cell-line-history">${escapeHtml(elapsed > 0 ? formatSecondsToHMS(elapsed) : '—')}</div>`;
    if (kind === 'actions') return '<div class="personal-op-cell-line personal-op-cell-line-history">-</div>';
    return '';
  });
  if (kind === 'executor') {
    pieces.push(`<div class="personal-op-cell-line personal-op-cell-line-current">${escapeHtml(currentExecutorName)}</div>`);
  } else if (kind === 'status') {
    pieces.push(`<div class="personal-op-cell-line personal-op-cell-line-current">${statusBadge(status)}</div>`);
  } else if (kind === 'time') {
    if ((status === 'IN_PROGRESS' || status === 'PAUSED') && timerRowId) {
      pieces.push(`<div class="personal-op-cell-line personal-op-cell-line-current"><span class="wo-timer" data-row-id="${escapeHtml(timerRowId)}">${escapeHtml(formatSecondsToHMS(currentSeconds))}</span></div>`);
    } else {
      const currentLabel = status === 'DONE'
        ? (getPersonalOperationStoredSecondsUi(personalOp) > 0 ? formatSecondsToHMS(getPersonalOperationStoredSecondsUi(personalOp)) : '—')
        : formatSecondsToHMS(currentSeconds);
      pieces.push(`<div class="personal-op-cell-line personal-op-cell-line-current">${escapeHtml(currentLabel)}</div>`);
    }
  }
  return `<div class="personal-op-cell personal-op-cell-${kind}">${pieces.join('')}</div>`;
}

function buildPersonalOperationActionsUi(card, op, personalOp, { workspaceMode = false } = {}) {
  if (!personalOp) return '';
  const status = normalizePersonalOperationStatusUi(personalOp.status);
  const workspaceAllowed = workspaceMode ? isWorkspaceOperationAllowed(card, op) : true;
  if (workspaceMode && shouldPrioritizeWorkspaceShiftLockUi(op) && !workspaceAllowed) {
    return '<button type="button" class="btn-secondary workspace-op-lock" data-action="workspace-locked" data-card-id="' + card.id + '" data-op-id="' + op.id + '" title="Операция не запланирована на текущую смену">🔒</button>';
  }
  const pendingCount = getPersonalOperationPendingItemIdsUi(card, op, personalOp).length;
  if (!pendingCount && status === 'DONE') return '';
  const workspaceRoleAccess = workspaceMode
    ? getCurrentUserWorkspaceOperationRoleAccessUi(card, op)
    : null;
  const workspaceDeniedReason = workspaceRoleAccess?.denialReason || 'Операция доступна только назначенному исполнителю.';
  const buildDeniedHtml = () => (
    '<button type="button" class="btn-secondary workspace-op-lock" data-action="workspace-locked" data-card-id="' + card.id + '" data-op-id="' + op.id + '" title="' + escapeHtml(workspaceDeniedReason) + '">🔒</button>'
  );
  if (workspaceMode && !workspaceAllowed) {
    return '<button type="button" class="btn-secondary workspace-op-lock" data-action="workspace-locked" data-card-id="' + card.id + '" data-op-id="' + op.id + '" title="Операция не запланирована на текущую смену">🔒</button>';
  }
  if (workspaceMode && workspaceRoleAccess && !workspaceRoleAccess.roleAllowed) {
    return buildDeniedHtml();
  }
  if (!workspaceMode && !canCurrentUserAccessIndividualOperationUi(card, op) && !isAdminLikeCurrentUserUi()) return '';
  const ownOperation = canCurrentUserOperatePersonalOperationUi(card, op, personalOp);
  const canAccess = canCurrentUserAccessIndividualOperationUi(card, op) || isAdminLikeCurrentUserUi();
  const attrs = ` data-card-id="${card.id}" data-op-id="${op.id}" data-personal-op-id="${personalOp.id}"`;
  if (status === 'IN_PROGRESS') {
    if (!ownOperation) return workspaceMode ? buildDeniedHtml() : '';
    return '<button class="btn-secondary" data-action="pause"' + attrs + '>Пауза</button>'
      + '<button class="btn-secondary" data-action="stop"' + attrs + '>Завершить</button>';
  }
  if (status === 'PAUSED' || status === 'NOT_STARTED') {
    if (!canAccess) return workspaceMode ? buildDeniedHtml() : '';
    const resumeAction = isCurrentUserPersonalExecutorUi(personalOp) ? 'resume' : 'start';
    const resumeLabel = isCurrentUserPersonalExecutorUi(personalOp) ? 'Продолжить' : 'Начать';
    return '<button class="btn-primary" data-action="' + resumeAction + '"' + attrs + '>' + resumeLabel + '</button>';
  }
  return '';
}

function renderPersonalOperationActionsCellUi(card, op, personalOp, { workspaceMode = false } = {}) {
  const segments = getPersonalOperationDisplaySegmentsUi(personalOp);
  const previousCount = Math.max(0, segments.length - 1);
  const lines = [];
  for (let index = 0; index < previousCount; index += 1) {
    lines.push('<div class="personal-op-cell-line personal-op-cell-line-history">-</div>');
  }
  const actionsHtml = buildPersonalOperationActionsUi(card, op, personalOp, { workspaceMode });
  lines.push('<div class="personal-op-cell-line personal-op-cell-line-current">' + (actionsHtml || '-') + '</div>');
  return '<div class="personal-op-cell personal-op-cell-actions">' + lines.join('') + '</div>';
}

function updateRenderedOperationTimers() {
  document.querySelectorAll('.wo-timer[data-row-id]').forEach(timer => {
    const rowId = String(timer.getAttribute('data-row-id') || '').trim();
    if (!rowId) return;
    const parts = rowId.split('::');
    const cardId = String(parts[0] || '').trim();
    const opId = String(parts[1] || '').trim();
    const personalOperationId = String(parts[2] || '').trim();
    const card = (cards || []).find(entry => entry && String(entry.id || '') === cardId) || null;
    const op = card ? (card.operations || []).find(entry => entry && String(entry.id || '') === opId) || null : null;
    if (!card || !op) return;
    let seconds = 0;
    if (personalOperationId) {
      const personalOp = getCardPersonalOperationsUi(card, op.id).find(entry => String(entry?.id || '') === personalOperationId) || null;
      if (!personalOp) return;
      seconds = getPersonalOperationElapsedSecondsUi(personalOp);
    } else {
      seconds = getIndividualOperationElapsedSecondsUi(card, op);
    }
    timer.textContent = formatSecondsToHMS(seconds);
  });
}

function ensureOperationTimersStarted() {
  if (window.__operationTimersStarted) return;
  window.__operationTimersStarted = true;
  window.setInterval(() => {
    if (document.hidden) return;
    updateRenderedOperationTimers();
  }, 1000);
}

function getWorkspaceShiftSummaryNotice(card, op) {
  const openTasks = getWorkspaceOpenShiftTasksForOperation(card, op);
  if (openTasks.length) return '';
  const plannedTasks = getWorkspacePlannedTasksForOperation(card, op)
    .slice()
    .sort(compareWorkspaceShiftSlots);
  if (!plannedTasks.length) {
    return 'Операция не запланирована';
  }
  const openRange = getWorkspaceOpenShiftRange();
  if (!openRange) {
    return `Операция запланирована на ${getWorkspacePlannedTaskLabel(plannedTasks[0])}`;
  }
  const futureTask = plannedTasks.find(task => compareWorkspaceShiftSlots(task, openRange.latest) > 0) || null;
  if (futureTask) {
    return `Операция запланирована на ${getWorkspacePlannedTaskLabel(futureTask)}`;
  }
  const latestPastTask = plannedTasks
    .filter(task => compareWorkspaceShiftSlots(task, openRange.earliest) < 0)
    .slice()
    .sort((a, b) => compareWorkspaceShiftSlots(b, a))[0] || null;
  if (latestPastTask && plannedTasks.every(task => compareWorkspaceShiftSlots(task, openRange.earliest) < 0)) {
    return `Операция была запланирована на ${getWorkspacePlannedTaskLabel(latestPastTask)}`;
  }
  const betweenTask = plannedTasks.find(task => (
    compareWorkspaceShiftSlots(task, openRange.earliest) > 0
    && compareWorkspaceShiftSlots(task, openRange.latest) < 0
  )) || null;
  if (betweenTask) {
    return `Операция запланирована вне открытых смен на ${getWorkspacePlannedTaskLabel(betweenTask)}`;
  }
  if (latestPastTask) {
    return `Операция была запланирована на ${getWorkspacePlannedTaskLabel(latestPastTask)}`;
  }
  return `Операция запланирована на ${getWorkspacePlannedTaskLabel(plannedTasks[0])}`;
}

function getWorkspaceTaskPlannedQty(task) {
  const stored = Number(task?.plannedPartQty);
  if (Number.isFinite(stored) && stored > 0) {
    return Math.round(stored * 100) / 100;
  }
  const minutesPerUnit = Number(task?.minutesPerUnitSnapshot);
  const plannedMinutes = Number(task?.plannedPartMinutes);
  if (Number.isFinite(minutesPerUnit) && minutesPerUnit > 0 && Number.isFinite(plannedMinutes) && plannedMinutes > 0) {
    return Math.round((plannedMinutes / minutesPerUnit) * 100) / 100;
  }
  if (typeof getTaskPlannedQuantity === 'function') {
    return getTaskPlannedQuantity(task);
  }
  return 0;
}

function getWorkspaceOpenShiftPlanStats(card, op, flowStats = null) {
  const tasks = getWorkspaceOpenShiftTasksForOperation(card, op);
  if (!tasks.length) return null;

  const shiftKeys = new Set(tasks.map(task => makeWorkspaceOpenShiftKey(task.date, task.shift)));
  const shiftRecords = (productionShifts || []).filter(item => (
    item
    && item.status === 'OPEN'
    && shiftKeys.has(makeWorkspaceOpenShiftKey(item.date, item.shift))
  ));
  const openedAtValues = shiftRecords
    .map(item => Number(item?.openedAt))
    .filter(value => Number.isFinite(value) && value > 0);
  const lowerBound = openedAtValues.length ? Math.min(...openedAtValues) : null;

  const plannedQty = tasks.reduce((sum, task) => sum + getWorkspaceTaskPlannedQty(task), 0);
  const roundedPlannedQty = Math.round(plannedQty * 100) / 100;
  if (roundedPlannedQty <= 0) return null;

  ensureCardFlowForUi(card);
  const flow = card.flow || {};
  const list = op.isSamples
    ? getFlowSamplesForOperation(flow, op)
    : (Array.isArray(flow.items) ? flow.items : []);

  let goodQty = 0;
  let delayedQty = 0;
  let defectQty = 0;
  if (lowerBound != null) {
    list.forEach(item => {
      const history = (Array.isArray(item?.history) ? item.history : [])
        .filter(entry => entry && Number(entry.at) >= lowerBound)
        .sort((a, b) => Number(a?.at || 0) - Number(b?.at || 0));
      let shiftStatus = '';
      history.forEach(entry => {
        const entryOpId = String(entry?.opId || '');
        const entryStatus = String(entry?.status || '').toUpperCase();
        const isReturn = entryStatus === 'PENDING' && /возврат/i.test(String(entry?.comment || ''));
        if (entryOpId === String(op.id || '') && ['GOOD', 'DELAYED', 'DEFECT'].includes(entryStatus)) {
          shiftStatus = entryStatus;
          return;
        }
        if (isReturn && shiftStatus === 'DELAYED') {
          shiftStatus = '';
        }
      });
      if (shiftStatus === 'GOOD') goodQty += 1;
      else if (shiftStatus === 'DELAYED') delayedQty += 1;
      else if (shiftStatus === 'DEFECT') defectQty += 1;
    });
  }

  const doneQty = goodQty + delayedQty + defectQty;
  const roundedDoneQty = Math.round(doneQty * 100) / 100;
  const remainingQty = Math.max(0, Math.round((roundedPlannedQty - roundedDoneQty) * 100) / 100);
  const overPlanQty = Math.max(0, Math.round((roundedDoneQty - roundedPlannedQty) * 100) / 100);

  return {
    shiftCount: shiftRecords.length || tasks.length,
    plannedQty: roundedPlannedQty,
    doneQty: roundedDoneQty,
    goodQty,
    delayedQty,
    defectQty,
    remainingQty,
    overPlanQty
  };
}

function isWorkspaceCardVisible(card) {
  return canCurrentUserAccessWorkspaceCardUi(card);
}

function scrollWorkorderDetailsIntoViewIfNeeded(detailsEl) {
  if (!detailsEl || !workorderAutoScrollEnabled || suppressWorkorderAutoscroll) return;

  // Автоскролл существует только для удобного просмотра именно что раскрытой карточки/группы.
  requestAnimationFrame(() => {
    if (suppressWorkorderAutoscroll) return;
    const rect = detailsEl.getBoundingClientRect();
    const header = document.querySelector('header');
    const headerOffset = header ? header.getBoundingClientRect().height : 0;
    const offset = headerOffset + 16;

    const needsScrollDown = rect.bottom > window.innerHeight;
    const needsScrollUp = rect.top < offset;
    if (!needsScrollDown && !needsScrollUp) return;
    const targetTop = window.scrollY + rect.top - offset;

    window.scrollTo({
      top: targetTop,
      behavior: 'smooth',
    });
  });
}

function markWorkorderToggleState(detail) {
  detail.dataset.wasOpen = detail.open ? 'true' : 'false';
}

function shouldScrollAfterWorkorderToggle(detail) {
  const wasOpen = detail.dataset.wasOpen === 'true';
  const nowOpen = detail.open;
  detail.dataset.wasOpen = nowOpen ? 'true' : 'false';
  // Скроллим только при переходе «было закрыто → стало открыто».
  return nowOpen && !wasOpen;
}

function findWorkorderDetail({ cardId = null } = {}) {
  if (!cardId) return null;
  return document.querySelector('.wo-card[data-card-id="' + cardId + '"]');
}

function getOperationResolvedExecutors(card, op) {
  const names = [];
  const seen = new Set();

  function pushName(value, fallbackId = '') {
    const clean = sanitizeExecutorName((value || '').toString().trim());
    const finalValue = clean || (fallbackId || '').toString().trim();
    if (!finalValue || seen.has(finalValue)) return;
    seen.add(finalValue);
    names.push(finalValue);
  }

  const taskMatches = (productionShiftTasks || []).filter(task =>
    task &&
    String(task.cardId || '') === String(card?.id || '') &&
    String(task.routeOpId || '') === String(op?.id || '')
  );

  taskMatches.forEach(task => {
    const assignments = (productionSchedule || []).filter(rec =>
      rec &&
      String(rec.date || '') === String(task.date || '') &&
      String(rec.areaId || '') === String(task.areaId || '') &&
      Number(rec.shift || 0) === Number(task.shift || 0)
    );

    assignments.forEach(rec => {
      const user = (users || []).find(item => String(item.id || '') === String(rec.employeeId || ''));
      pushName(user?.name || user?.username || user?.login || '', rec.employeeId || '');
    });
  });

  if (names.length) return names;

  pushName(op?.executor || '');
  if (Array.isArray(op?.additionalExecutors)) {
    op.additionalExecutors.forEach(name => pushName(name || ''));
  }

  return names;
}

function withWorkorderScrollLock(cb, { anchorCardId = null } = {}) {
  const anchorEl = anchorCardId ? findWorkorderDetail({ cardId: anchorCardId }) : null;
  const anchorTop = anchorEl ? anchorEl.getBoundingClientRect().top : null;
  const prevX = window.scrollX;
  const prevY = window.scrollY;
  cb();
  if (!suppressWorkorderAutoscroll) return;
  requestAnimationFrame(() => {
    if (anchorTop != null) {
      const freshAnchor = findWorkorderDetail({ cardId: anchorCardId });
      if (freshAnchor) {
        const newTop = freshAnchor.getBoundingClientRect().top;
        const delta = newTop - anchorTop;
        window.scrollTo({ left: prevX, top: window.scrollY + delta });
        return;
      }
    }
    window.scrollTo({ left: prevX, top: prevY });
  });
}

function renderExecutorCell(op, card, { readonly = false, mobile = false } = {}) {
  const resolvedExecutors = getOperationResolvedExecutors(card, op);
  const extras = Array.isArray(op.additionalExecutors) ? op.additionalExecutors : [];
  if (readonly) {
    const readonlyExecutors = resolvedExecutors.length ? resolvedExecutors : [sanitizeExecutorName(op.executor || '')].filter(Boolean);
    return '<div class="executor-cell readonly">' +
      readonlyExecutors.map(name => '<div class="executor-name">' + escapeHtml(name) + '</div>').join('') +
      '</div>';
  }
  const cardId = card ? card.id : '';
  const comboClass = mobile ? 'combo-field executor-combo executor-combobox' : 'combo-field executor-combo';
  const comboAttrs = mobile ? ' data-mobile-combo="true"' : '';

  let html = '<div class="executor-cell" data-card-id="' + cardId + '" data-op-id="' + op.id + '">';
  html += '<div class="executor-row primary">' +
    '<div class="' + comboClass + '"' + comboAttrs + '>' +
      '<input type="text" list="' + USER_DATALIST_ID + '" class="executor-main-input" data-card-id="' + cardId + '" data-op-id="' + op.id + '" value="' + escapeHtml(op.executor || '') + '" placeholder="Исполнитель" />' +
      (mobile ? '<button type="button" class="executor-arrow" aria-label="Открыть список исполнителей" tabindex="-1">▼</button>' : '') +
      '<div class="combo-suggestions executor-suggestions" role="listbox"></div>' +
    '</div>' +
    (extras.length < 3 ? '<button type="button" class="icon-btn add-executor-btn" data-card-id="' + cardId + '" data-op-id="' + op.id + '">+</button>' : '') +
    '</div>';

  extras.forEach((name, idx) => {
    const canAddMore = extras.length < 3 && idx === extras.length - 1;
    html += '<div class="executor-row extra" data-extra-index="' + idx + '">' +
      '<div class="' + comboClass + '"' + comboAttrs + '>' +
        '<input type="text" list="' + USER_DATALIST_ID + '" class="additional-executor-input" data-card-id="' + cardId + '" data-op-id="' + op.id + '" data-extra-index="' + idx + '" value="' + escapeHtml(name || '') + '" placeholder="Доп. исполнитель" />' +
        (mobile ? '<button type="button" class="executor-arrow" aria-label="Открыть список исполнителей" tabindex="-1">▼</button>' : '') +
        '<div class="combo-suggestions executor-suggestions" role="listbox"></div>' +
      '</div>' +
      (canAddMore ? '<button type="button" class="icon-btn add-executor-btn" data-card-id="' + cardId + '" data-op-id="' + op.id + '">+</button>' : '') +
      '<button type="button" class="icon-btn remove-executor-btn" data-card-id="' + cardId + '" data-op-id="' + op.id + '" data-extra-index="' + idx + '">-</button>' +
      '</div>';
  });

  html += '</div>';
  return html;
}

function ensureCardFlowForUi(card) {
  if (!card || card.flow) return;
  ensureCardMeta(card);
}

function normalizeSampleType(value) {
  const raw = (value || '').toString().trim().toUpperCase();
  return raw === 'WITNESS' ? 'WITNESS' : 'CONTROL';
}

function getOpSampleType(op) {
  if (!op || !op.isSamples) return '';
  return normalizeSampleType(op.sampleType);
}

function getFlowSamplesForOperation(flow, op) {
  if (!op || !op.isSamples) return [];
  const samples = Array.isArray(flow?.samples) ? flow.samples : [];
  const sampleType = getOpSampleType(op);
  return samples.filter(item => normalizeSampleType(item?.sampleType) === sampleType);
}

function getFlowItemsForOperation(card, op) {
  if (!card || !op) return [];
  ensureCardFlowForUi(card);
  const flow = card.flow || {};
  const list = op.isSamples ? getFlowSamplesForOperation(flow, op) : (Array.isArray(flow.items) ? flow.items : []);
  return list.filter(item => item && item.current && item.current.opId === op.id);
}

function formatFlowItemStatusLabel(status) {
  if (status === 'GOOD') return { text: 'Годно', cls: 'op-item-status-good' };
  if (status === 'DEFECT') return { text: 'Брак', cls: 'op-item-status-defect' };
  if (status === 'DELAYED') return { text: 'Задержано', cls: 'op-item-status-delayed' };
  if (status === 'DISPOSED') return { text: 'Утилизировано', cls: 'op-item-status-disposed' };
  return null;
}

function isFlowItemDisposed(item) {
  if (!item) return false;
  if (item.current?.status === 'DISPOSED') return true;
  const history = Array.isArray(item.history) ? item.history : [];
  return history.some(entry => entry && entry.status === 'DISPOSED');
}

function buildOperationOrderMap(card) {
  const map = new Map();
  const ops = Array.isArray(card?.operations) ? card.operations : [];
  ops.forEach((op, index) => {
    const raw = typeof op?.order === 'number' ? op.order : parseFloat(op?.order);
    const order = Number.isFinite(raw) ? raw : (index + 1);
    const opId = (op?.id || op?.opId || '').toString().trim();
    if (opId) map.set(opId, order);
  });
  return map;
}

function collectOpFlowStats(card, op) {
  ensureCardFlowForUi(card);
  const flow = card.flow || {};
  const list = op.isSamples
    ? getFlowSamplesForOperation(flow, op)
    : (Array.isArray(flow.items) ? flow.items : []);
  const orderMap = buildOperationOrderMap(card);
  const currentOpId = (op?.id || op?.opId || '').toString().trim();
  const currentOrder = orderMap.get(currentOpId) ?? Number.POSITIVE_INFINITY;
  const getOrder = (opId) => orderMap.get((opId || '').toString().trim()) ?? Number.POSITIVE_INFINITY;

  const getLastStatusForOp = (item, opId) => {
    const history = Array.isArray(item?.history) ? item.history : [];
    let last = null;
    history.forEach(entry => {
      if (!entry || entry.opId !== opId) return;
      last = entry.status || last;
    });
    return last;
  };

  const totalCard = list.length;
  let onOpTotal = 0;
  let pendingOnOp = 0;
  let awaiting = 0;
  let good = 0;
  let defect = 0;
  let delayed = 0;

  list.forEach(item => {
    if (!item) return;
    const onCurrentOp = item.current?.opId === op.id;
    if (onCurrentOp) {
      onOpTotal += 1;
      const status = item.current?.status;
      if (status === 'GOOD') good += 1;
      else if (status === 'DEFECT') defect += 1;
      else if (status === 'DELAYED') delayed += 1;
      else if (status === 'DISPOSED') {}
      else pendingOnOp += 1;
      return;
    }

    const lastStatus = getLastStatusForOp(item, op.id);
    if (lastStatus === 'GOOD') {
      good += 1;
    }

    const currentStatus = item.current?.status;
    if (currentStatus === 'PENDING') {
      const curOrder = getOrder(item.current?.opId);
      if (curOrder < currentOrder) {
        awaiting += 1;
      }
    }
  });

  const completed = good + defect + delayed;
  const remaining = Math.max(0, totalCard - (defect + delayed));
  return {
    totalCard,
    onOpTotal,
    pendingOnOp,
    awaiting,
    good,
    remaining,
    completed,
    defect,
    delayed
  };
}

function collectOpFlowStatsForItems(items) {
  const list = Array.isArray(items) ? items : [];
  let good = 0;
  let defect = 0;
  let delayed = 0;
  list.forEach(item => {
    const status = item?.current?.status;
    if (status === 'GOOD') good += 1;
    if (status === 'DEFECT') defect += 1;
    if (status === 'DELAYED') delayed += 1;
  });
  const completed = good + defect + delayed;
  const total = list.length;
  return {
    totalCard: total,
    onOpTotal: total,
    pendingOnOp: Math.max(0, total - completed),
    awaiting: 0,
    good,
    remaining: total,
    completed,
    defect,
    delayed
  };
}

function collectCurrentOpStatusCounts(items) {
  const list = Array.isArray(items) ? items : [];
  let good = 0;
  let defect = 0;
  let delayed = 0;
  list.forEach(item => {
    const status = item?.current?.status;
    if (status === 'GOOD') good += 1;
    if (status === 'DEFECT') defect += 1;
    if (status === 'DELAYED') delayed += 1;
  });
  return {
    total: list.length,
    good,
    defect,
    delayed,
    completed: good + defect + delayed
  };
}

function buildOperationItemsAccordion(card, op, itemsOnOp, { hideItemStatuses = null, showDelayedActions = false, showDefectActions = false, allowedItemStatuses = null, workspaceMode = false, personalOperation = null } = {}) {
  if (isMaterialIssueOperation(op)) {
    const entry = (card.materialIssues || []).find(item => (item?.opId || '') === op.id) || null;
    const materials = Array.isArray(entry?.items) ? entry.items : [];
    const hasMaterials = materials.length > 0;
    const summaryText = hasMaterials ? 'Материал выдан' : 'Материал не выдан';
    const summaryClass = hasMaterials ? 'op-items-summary-material is-done' : 'op-items-summary-material';
    const listHtml = materials.length
      ? '<table class="material-issue-table"><thead><tr><th>№</th><th>Наименование материала</th><th>Кол-во.</th><th>Ед. изм.</th><th>Порошок</th></tr></thead><tbody>' +
        materials.map((row, idx) => {
          const name = row?.name || '';
          const qty = row?.qty || '';
          const unit = row?.unit || 'кг';
          const powder = row?.isPowder ? 'Да' : 'Нет';
          return '<tr>' +
            '<td>' + (idx + 1) + '</td>' +
            '<td>' + escapeHtml(name) + '</td>' +
            '<td>' + escapeHtml(qty) + '</td>' +
            '<td>' + escapeHtml(unit) + '</td>' +
            '<td>' + powder + '</td>' +
          '</tr>';
        }).join('') +
      '</tbody></table>'
      : '<div class="muted">Материалы не выдавались.</div>';

    return `
      <details class="op-items-accordion">
        <summary class="op-items-summary ${summaryClass}">${summaryText}</summary>
        <div class="op-items-list">${listHtml}</div>
      </details>
    `;
  }

  if (isDryingOperation(op)) {
    const dryingRows = buildDryingRows(card, op);
    const hasDryPowder = dryingRows.some(row => (row?.status || '') === 'DONE');
    const summaryText = hasDryPowder ? 'Есть сухой порошок' : 'Нет сухого порошка';
    const summaryClass = hasDryPowder ? 'op-items-summary-material is-done' : 'op-items-summary-material';
    const listHtml = dryingRows.length
      ? renderDryingTable(dryingRows, { readonly: true })
      : '<div class="muted">Нет порошка для сушки.</div>';
    return `
      <details class="op-items-accordion">
        <summary class="op-items-summary ${summaryClass}">${summaryText}</summary>
        <div class="op-items-list">${listHtml}</div>
      </details>
    `;
  }

  if (isMaterialReturnOperation(op)) {
    const returnRows = buildMaterialReturnRows(card);
    const isDone = op.status === 'DONE';
    const summaryText = isDone ? 'Материал сдан' : 'Материал не сдан';
    const summaryClass = isDone ? 'op-items-summary-material is-done' : 'op-items-summary-material';
    const listHtml = isDone
      ? renderMaterialReturnTable(returnRows, { readonly: true })
      : '<div class="muted">Материал не сдан.</div>';
    return `
      <details class="op-items-accordion">
        <summary class="op-items-summary ${summaryClass}">${summaryText}</summary>
        <div class="op-items-list">${listHtml}</div>
      </details>
    `;
  }

  const sampleLabel = op.isSamples
    ? (normalizeSampleType(op.sampleType) === 'WITNESS' ? 'ОС' : 'ОК')
    : 'Изделия';
  const hideSet = new Set(Array.isArray(hideItemStatuses) ? hideItemStatuses.filter(Boolean) : []);
  const allowSet = new Set(Array.isArray(allowedItemStatuses) ? allowedItemStatuses.filter(Boolean) : []);
  let visibleItems = (itemsOnOp || []).filter(item => !isFlowItemDisposed(item));
  visibleItems = hideSet.size
    ? visibleItems.filter(item => !hideSet.has(item?.current?.status))
    : visibleItems;
  if (allowSet.size) {
    visibleItems = visibleItems.filter(item => allowSet.has(item?.current?.status));
  }
  const stats = (() => {
    if (allowSet.size || hideSet.size) {
      if (allowSet.size) return collectOpFlowStatsForItems(visibleItems);
      const filteredCurrent = collectCurrentOpStatusCounts(visibleItems);
      const base = getOperationExecutionStats(card, op);
      return {
        ...base,
        onOpTotal: filteredCurrent.total,
        pendingOnOp: Math.max(0, filteredCurrent.total - filteredCurrent.completed),
        good: filteredCurrent.good,
        defect: filteredCurrent.defect,
        delayed: filteredCurrent.delayed,
        completed: filteredCurrent.completed
      };
    }
    return getOperationExecutionStats(card, op);
  })();
  const pendingVisibleQty = visibleItems.reduce((sum, item) => (
    sum + (String(item?.current?.status || '').trim().toUpperCase() === 'PENDING' ? 1 : 0)
  ), 0);
  const toExecute = Math.max(0, pendingVisibleQty);
  const awaiting = Math.max(0, stats.awaiting || 0);
  const kindLabelHtml = `<span class="op-items-kind${op.isSamples ? ' op-items-kind-samples' : ''}">${escapeHtml(sampleLabel)}:</span>`;
  const workspaceKindLabelHtml = `<span class="op-items-kind${op.isSamples ? ' op-items-kind-samples' : ''}">${escapeHtml(op.isSamples ? sampleLabel : 'Изд.')}</span>`;
  const summaryMain = `${kindLabelHtml} К выполнению: ${toExecute} шт.`;
  const summaryDone = `Выполнено: ${stats.good} шт.`;
  const summaryCompleted = `Выполнено: ${stats.completed} шт.`;
  const summaryGood = `Годно: ${stats.good} шт.`;
  const summaryDelayed = `Задержано: ${stats.delayed} шт.`;
  const summaryDefect = `Брак: ${stats.defect} шт.`;
  const summaryAwaiting = `Ожидается: ${awaiting} шт.`;
  const shiftPlanStats = workspaceMode ? getWorkspaceOpenShiftPlanStats(card, op, stats) : null;
  const personalFactStats = personalOperation
    ? collectOpFlowStatsForItems(visibleItems)
    : null;
  const personalTakenQty = personalOperation
    ? ((Array.isArray(personalOperation.itemIds) ? personalOperation.itemIds : []).map(item => String(item || '').trim()).filter(Boolean).length)
    : 0;
  const personalPendingQty = personalOperation
    ? getPersonalOperationPendingItemIdsUi(card, op, personalOperation).length
    : 0;
  const basePendingQty = !personalOperation && isIndividualOperationUi(card, op)
    ? getAvailableIndividualOperationItemsUi(card, op).length
    : Math.max(0, Number(stats?.pendingOnOp || 0));
  const shiftRemainingQty = shiftPlanStats
    ? Math.max(0, Number(shiftPlanStats.plannedQty || 0) - Number(shiftPlanStats.doneQty || 0))
    : 0;
  const baseShiftPendingQty = basePendingQty;
  const baseShiftAwaitingQty = Math.min(
    Math.max(0, Number(stats?.awaiting || 0)),
    Math.max(0, shiftRemainingQty - baseShiftPendingQty)
  );
  const shiftPendingQty = personalOperation
    ? Math.min(personalPendingQty, shiftRemainingQty)
    : baseShiftPendingQty;
  const shiftAwaitingQty = personalOperation
    ? baseShiftAwaitingQty
    : baseShiftAwaitingQty;
  const overPlanSummary = shiftPlanStats && Number(shiftPlanStats.overPlanQty) > 0
    ? `<span class="op-items-shift-summary-over">Сверх плана: ${shiftPlanStats.overPlanQty} шт.</span>`
    : '';
  const shiftSummary = shiftPlanStats
    ? [
      '<span class="op-items-shift-summary-label">Смена:</span>',
      `<span class="op-items-kind${op.isSamples ? ' op-items-kind-samples' : ''}">${escapeHtml(op.isSamples ? sampleLabel : 'Изд.')}</span>`,
      `<span class="op-items-shift-summary-main">${personalOperation ? 'Взято' : 'План'}: ${personalOperation ? personalTakenQty : shiftPlanStats.plannedQty} шт.</span>`,
      `<span class="op-items-shift-summary-fact">Факт: ${personalOperation ? personalFactStats.completed : shiftPlanStats.doneQty} ( <span class="op-items-shift-summary-good">${personalOperation ? personalFactStats.good : shiftPlanStats.goodQty}</span> / <span class="op-items-shift-summary-delayed op-item-status-delayed">${personalOperation ? personalFactStats.delayed : shiftPlanStats.delayedQty}</span> / <span class="op-items-shift-summary-defect op-item-status-defect">${personalOperation ? personalFactStats.defect : shiftPlanStats.defectQty}</span> ) шт.</span>`,
      `<span class="op-items-shift-summary-over">К выполнению: ${shiftPendingQty} шт.</span>`,
      `<span class="op-items-shift-summary-awaiting">Ожидается: ${shiftAwaitingQty} шт.</span>`,
      overPlanSummary
    ].join(' ')
    : (workspaceMode ? `<span class="op-items-shift-summary-notice">${escapeHtml(getWorkspaceShiftSummaryNotice(card, op))}</span>` : '');
  const parts = [
    `<span class="op-items-summary-main">${summaryMain}</span>`,
    `<span class="op-items-summary-done">${escapeHtml(summaryDone)}</span>`,
    `<span class="op-items-summary-awaiting">${escapeHtml(summaryAwaiting)}</span>`
  ];
  if (stats.defect > 0) {
    parts.push(`<span class="op-items-summary-defect op-item-status-defect">Брак: ${stats.defect} шт.</span>`);
  }
  if (stats.delayed > 0) {
    parts.push(`<span class="op-items-summary-delayed op-item-status-delayed">Задержано: ${stats.delayed} шт.</span>`);
  }
  const summary = parts.join(' ');
  const workspaceTotalParts = [
    '<span class="op-items-summary-total-label">Всего:</span>',
    `<span class="op-items-summary-main">${workspaceKindLabelHtml} К выполнению: ${toExecute} шт.</span>`,
    `<span class="op-items-summary-completed">${escapeHtml(summaryCompleted)}</span>`,
    `<span class="op-items-summary-done">${escapeHtml(summaryGood)}</span>`,
    stats.delayed > 0 ? `<span class="op-items-summary-delayed op-item-status-delayed">${escapeHtml(summaryDelayed)}</span>` : '',
    stats.defect > 0 ? `<span class="op-items-summary-defect op-item-status-defect">${escapeHtml(summaryDefect)}</span>` : '',
    `<span class="op-items-summary-awaiting">${escapeHtml(summaryAwaiting)}</span>`
  ].filter(Boolean).join(' ');
  const workspaceSummary = workspaceMode
    ? `
      <span class="op-items-summary-workspace">
        ${shiftSummary ? `<span class="op-items-summary-line op-items-summary-line-shift">${shiftSummary}</span>` : ''}
      </span>
    `
    : summary;
  const workspaceListSummary = workspaceMode && !personalOperation
    ? `<div class="op-items-list-summary"><span class="op-items-summary-line">${workspaceTotalParts}</span></div>`
    : '';
  const listHtml = visibleItems.length
    ? `${workspaceListSummary}${visibleItems.map(item => {
      const statusInfo = formatFlowItemStatusLabel(item?.current?.status || '');
      const statusHtml = statusInfo
        ? ` <span class="op-item-status ${statusInfo.cls}">${statusInfo.text}</span>`
        : '';
      const showDelayedButtons = showDelayedActions && item?.current?.status === 'DELAYED';
      const showDefectButtons = showDefectActions && item?.current?.status === 'DEFECT';
      const actionsHtml = showDelayedButtons
        ? `
            <div class="op-item-actions">
              <button type="button" class="btn-small btn-secondary op-item-action" data-action="return-item" data-card-id="${card.id}" data-op-id="${op.id}" data-item-id="${item.id}" data-kind="${op.isSamples ? 'SAMPLE' : 'ITEM'}" data-allow-view="true">Возврат</button>
              <button type="button" class="btn-small btn-danger op-item-action" data-action="defect-item" data-card-id="${card.id}" data-op-id="${op.id}" data-item-id="${item.id}" data-kind="${op.isSamples ? 'SAMPLE' : 'ITEM'}" data-allow-view="true">Брак</button>
            </div>
          `
        : (showDefectButtons
          ? `
            <div class="op-item-actions">
              <button type="button" class="btn-small btn-secondary op-item-action" data-action="repair-item" data-card-id="${card.id}" data-op-id="${op.id}" data-item-id="${item.id}" data-kind="${op.isSamples ? 'SAMPLE' : 'ITEM'}" data-allow-view="true">Ремонт</button>
              <button type="button" class="btn-small btn-danger op-item-action" data-action="dispose-item" data-card-id="${card.id}" data-op-id="${op.id}" data-item-id="${item.id}" data-kind="${op.isSamples ? 'SAMPLE' : 'ITEM'}" data-allow-view="true">Утилизация</button>
            </div>
          `
          : '');
      return `
        <div class="op-item-row">
          <div>
            <div class="op-item-title">${escapeHtml(item.displayName || '')}${statusHtml}</div>
            <div class="op-item-qr">${escapeHtml(item.qr || '')}</div>
            ${actionsHtml}
          </div>
        </div>
      `;
    }).join('')}`
    : `${workspaceListSummary}<div class="muted">Нет изделий на операции</div>`;

  return `
    <div class="op-items-accordion">
      <details class="op-items-accordion-details">
      <summary class="op-items-summary${workspaceMode ? ' op-items-summary-workspace-toggle' : ''}">${workspaceSummary}</summary>
      <div class="op-items-list">${listHtml}</div>
      </details>
    </div>
  `;
}

function buildOperationsTable(card, { readonly = false, quantityPrintBlanks = false, showQuantityColumn = true, showQuantityRow = true, lockExecutors = false, lockQuantities = false, allowActions = !readonly, restrictToUser = false, centerHighlightTerm = '', showFlowItems = false, hideFlowItemStatuses = null, showDelayedActions = false, showDefectActions = false, allowedFlowItemStatuses = null, workspaceMode = false, showPersonalOperations = false, renderOperations = null } = {}) {
  const getOrderValue = (op) => {
    const raw = typeof op?.order === 'number' ? op.order : parseFloat(op?.order);
    return Number.isFinite(raw) ? raw : null;
  };
  const operationsForRender = Array.isArray(renderOperations) ? renderOperations : (card.operations || []);
  const opsSorted = [...operationsForRender].sort((a, b) => {
    const orderA = getOrderValue(a) ?? 0;
    const orderB = getOrderValue(b) ?? 0;
    return orderA - orderB;
  });
  const hasActions = allowActions && !readonly;
  const baseColumns = hasActions ? 10 : 9;
  const totalColumns = baseColumns + (showQuantityColumn ? 1 : 0);
  if (showFlowItems) {
    ensureCardFlowForUi(card);
  }
  let html = '<table><thead><tr>' +
    '<th>Порядок</th><th>Подразделение</th><th>Код операции</th><th>Наименование операции</th>' +
    (showQuantityColumn ? '<th>Количество изделий</th>' : '') +
    '<th>Исполнитель</th><th>План (мин)</th><th>Статус</th><th>Текущее / факт. время</th>' +
    (hasActions ? '<th>Действия</th>' : '') +
    '<th>Комментарии</th>' +
    '</tr></thead><tbody>';

  opsSorted.forEach((op, idx) => {
    op.executor = sanitizeExecutorName(op.executor || '');
    if (Array.isArray(op.additionalExecutors)) {
      op.additionalExecutors = op.additionalExecutors
        .map(name => sanitizeExecutorName(name || ''))
        .slice(0, 2);
    } else {
      op.additionalExecutors = [];
    }
    const rowId = card.id + '::' + op.id;
    const elapsed = getIndividualOperationElapsedSecondsUi(card, op);
    const allItemsOnOp = showFlowItems ? getFlowItemsForOperation(card, op) : [];
    const showPersonalRows = showPersonalOperations && isIndividualOperationUi(card, op);
    const allPersonalOperations = showPersonalRows ? getCardPersonalOperationsUi(card, op.id) : [];
    const personalOperations = showPersonalRows
      ? (workspaceMode ? getCurrentUserVisiblePersonalOperationsUi(card, op, allPersonalOperations) : allPersonalOperations)
      : [];
    const itemsOnOp = showPersonalRows ? getAvailableIndividualOperationItemsUi(card, op) : allItemsOnOp;
    const effectiveStatus = op.status || 'NOT_STARTED';
    const rowReadonly = readonly;

    const storedSeconds = isDryingOperation(op)
      ? elapsed
      : getIndividualOperationStoredSecondsUi(card, op);
    let timeCell = '';
    if (effectiveStatus === 'IN_PROGRESS' || effectiveStatus === 'PAUSED') {
      timeCell = '<span class="wo-timer" data-row-id="' + rowId + '">' + formatSecondsToHMS(elapsed) + '</span>';
    } else if (effectiveStatus === 'DONE') {
      timeCell = storedSeconds > 0 ? formatSecondsToHMS(storedSeconds) : '—';
    } else if (storedSeconds > 0) {
      timeCell = formatSecondsToHMS(storedSeconds);
    }

    const userName = (currentUser && currentUser.name ? currentUser.name.toLowerCase() : '').trim();
    const matchesUser = !showPersonalRows && userName && getOperationResolvedExecutors(card, op).map(v => (v || '').toLowerCase()).includes(userName);
    let actionsHtml = '';
    const workspaceAllowed = !workspaceMode || isWorkspaceOperationAllowed(card, op);
    const workspaceRoleAccess = workspaceMode
      ? getCurrentUserWorkspaceOperationRoleAccessUi(card, op)
      : null;
    const canAccessByRole = !workspaceMode || workspaceRoleAccess?.roleAllowed;
    const canOperateSubcontract = !workspaceMode || canCurrentUserOperateWorkspaceSubcontract(card, op);
    const canAccessIndividual = showPersonalRows ? canCurrentUserAccessIndividualOperationUi(card, op) : false;
    const subcontractDeniedTitle = 'Операция субподрядчика доступна только мастеру смены этой даты/смены или назначенному исполнителю';
    if (hasActions && !rowReadonly) {
      const flowBlockedReasons = getWorkspaceBlockedInfoReasonsUi(card, op, { parentFlow: showPersonalRows, effectiveStatus });
      const blockers = flowBlockedReasons.join(' ');
      const pauseDisabled = op.canPause ? '' : ' disabled';
      const resumeDisabled = op.canResume ? '' : ' disabled';
      const completeDisabled = op.canComplete ? '' : ' disabled';
      const titleAttr = blockers ? ' title="' + escapeHtml(blockers) + '"' : '';
      const individualActionAttrs = ' data-card-id="' + card.id + '" data-op-id="' + op.id + '"';
      const roleDeniedReason = workspaceRoleAccess?.denialReason || 'Операция доступна только назначенному исполнителю.';
      const showBlockedInfo = workspaceMode
        && workspaceAllowed
        && canAccessByRole
        && canOperateSubcontract
        && shouldShowWorkspaceFlowBlockedBadgeUi(card, op, flowBlockedReasons, { parentFlow: showPersonalRows, effectiveStatus });

      if (workspaceMode && shouldPrioritizeWorkspaceShiftLockUi(op) && !workspaceAllowed) {
        actionsHtml = '<button type="button" class="btn-secondary workspace-op-lock" data-action="workspace-locked" data-card-id="' + card.id + '" data-op-id="' + op.id + '" title="Операция не запланирована на текущую смену">🔒</button>';
      } else if (workspaceMode && !canAccessByRole) {
        actionsHtml = '<button type="button" class="btn-secondary workspace-op-lock" data-action="workspace-locked" data-card-id="' + card.id + '" data-op-id="' + op.id + '" title="' + escapeHtml(roleDeniedReason) + '">🔒</button>';
      } else if (workspaceMode && !canOperateSubcontract) {
        actionsHtml = '<button type="button" class="btn-secondary workspace-op-lock" data-action="workspace-locked" data-card-id="' + card.id + '" data-op-id="' + op.id + '" title="' + escapeHtml(subcontractDeniedTitle) + '">🔒</button>';
      } else if (showPersonalRows) {
        if (itemsOnOp.length && canAccessIndividual && !isIndividualParentFlowBlockedUi(op)) {
          actionsHtml = '<button class="btn-primary" data-action="start"' + individualActionAttrs + '>Начать</button>';
        }
      } else if (isDryingOperation(op)) {
        if (op.canStart || effectiveStatus === 'IN_PROGRESS' || effectiveStatus === 'DONE') {
          actionsHtml = '<button class="btn-primary" data-action="drying" data-card-id="' + card.id + '" data-op-id="' + op.id + '"' + titleAttr + '>Сушить</button>';
        }
      } else if (effectiveStatus === 'NOT_STARTED') {
        if (op.canStart) {
          actionsHtml = '<button class="btn-primary" data-action="start" data-card-id="' + card.id + '" data-op-id="' + op.id + '"' + titleAttr + '>Начать</button>';
        }
      } else if (effectiveStatus === 'IN_PROGRESS') {
        actionsHtml =
          '<button class="btn-secondary" data-action="pause" data-card-id="' + card.id + '" data-op-id="' + op.id + '"' + pauseDisabled + '>Пауза</button>' +
          '<button class="btn-secondary" data-action="stop" data-card-id="' + card.id + '" data-op-id="' + op.id + '"' + completeDisabled + titleAttr + '>Завершить</button>';
      } else if (effectiveStatus === 'PAUSED') {
        actionsHtml =
          '<button class="btn-primary" data-action="resume" data-card-id="' + card.id + '" data-op-id="' + op.id + '"' + resumeDisabled + titleAttr + '>Продолжить</button>';
      } else if (effectiveStatus === 'DONE' && (isMaterialIssueOperation(op) || isMaterialReturnOperation(op)) && op.canStart) {
        actionsHtml = '<button class="btn-primary" data-action="start" data-card-id="' + card.id + '" data-op-id="' + op.id + '"' + titleAttr + '>Начать</button>';
      }

      if (showBlockedInfo) {
        actionsHtml += buildWorkspaceFlowBlockedBadgeHtml(flowBlockedReasons);
      }
    }

    const commentCount = ensureOpCommentsArray(op).length;
    const commentCell = '<button type="button" class="op-comments-btn" data-action="op-comments" data-card-id="' + card.id + '" data-op-id="' + op.id + '" data-allow-view="true">' +
      '<span>💬</span>' +
      '<span class="op-comments-count">' + commentCount + '</span>' +
    '</button>';

    const actionsCell = hasActions
      ? '<td><div class="table-actions">' + actionsHtml + '</div></td>'
      : '';

    const rowClasses = [];
    if (workspaceMode && effectiveStatus === 'DONE') {
      rowClasses.push('workspace-op-done');
    } else if (matchesUser && getCurrentUserWorkspaceRoleFlagsUi && getCurrentUserWorkspaceRoleFlagsUi().worker && workspaceMode) {
      // Выделение исполнителя для Рабочего на /workspace/*
      rowClasses.push('workspace-executor-fill');
    } else if (matchesUser) {
      rowClasses.push('executor-highlight');
    }
    if (showPersonalRows) rowClasses.push('individual-op-parent-row');
    if (centerHighlightTerm && (op.centerName || '').toLowerCase().includes(centerHighlightTerm)) {
      rowClasses.push('center-highlight');
    }
    const highlightClass = rowClasses.length ? ' class="' + rowClasses.join(' ') + '"' : '';
    const orderValue = getOrderValue(op);
    const orderLabel = orderValue != null ? orderValue : (idx + 1);
    const executorCellHtml = showPersonalRows
      ? '—'
      : renderExecutorCell(op, card, { readonly: readonly || lockExecutors });
    const quantityHtml = showQuantityColumn
      ? '<td>' + escapeHtml(showPersonalRows ? String(itemsOnOp.length) : getOperationQuantity(op, card)) + '</td>'
      : '';

    html += '<tr data-row-id="' + rowId + '"' + highlightClass + '>' +
      '<td>' + orderLabel + '</td>' +
      '<td>' + escapeHtml(op.centerName) + '</td>' +
      '<td>' + escapeHtml(op.opCode || '') + '</td>' +
      '<td>' + renderOpName(op, { card }) + '</td>' +
      quantityHtml +
      '<td>' + executorCellHtml + '</td>' +
      '<td>' + (op.plannedMinutes || '') + '</td>' +
      '<td>' + statusBadge(effectiveStatus) + '</td>' +
      '<td>' + timeCell + '</td>' +
      actionsCell +
      '<td>' + commentCell + '</td>' +
      '</tr>';

    if (showQuantityRow) {
      html += renderQuantityRow(card, op, { readonly: readonly || lockQuantities || showPersonalRows, colspan: totalColumns, blankForPrint: quantityPrintBlanks });
    }

    if (showFlowItems) {
      html += '<tr class="op-items-row"><td colspan="' + totalColumns + '">' + buildOperationItemsAccordion(card, op, itemsOnOp, { hideItemStatuses: hideFlowItemStatuses, showDelayedActions, showDefectActions, allowedItemStatuses: allowedFlowItemStatuses, workspaceMode }) + '</td></tr>';
    }

    if (showPersonalRows) {
      personalOperations.forEach((personalOp, personalIndex) => {
        const personalItems = getPersonalOperationItemsUi(card, op, personalOp);
        const personalOrderLabel = String(orderLabel) + '.' + String(personalIndex + 1);
        const personalRowId = rowId + '::' + personalOp.id;
        const personalTime = renderPersonalOperationHistoryCellUi(personalOp, 'time', { timerRowId: personalRowId });
        const personalExecutor = renderPersonalOperationHistoryCellUi(personalOp, 'executor');
        const personalStatusHtml = renderPersonalOperationHistoryCellUi(personalOp, 'status');
        const personalActionsCell = hasActions
          ? '<td><div class="table-actions personal-op-actions">' + renderPersonalOperationActionsCellUi(card, op, personalOp, { workspaceMode }) + '</div></td>'
          : '';
        const personalCommentCell = '<button type="button" class="op-comments-btn" data-action="op-comments" data-card-id="' + card.id + '" data-op-id="' + op.id + '" data-allow-view="true">' +
          '<span>💬</span>' +
          '<span class="op-comments-count">' + commentCount + '</span>' +
          '</button>';
        html += '<tr class="individual-op-personal-row" data-row-id="' + personalRowId + '">' +
          '<td>' + escapeHtml(personalOrderLabel) + '</td>' +
          '<td>' + escapeHtml(op.centerName) + '</td>' +
          '<td>' + escapeHtml(op.opCode || '') + '</td>' +
          '<td><div>' + renderOpName(op, { card }) + '</div><div class="personal-op-label">Личная операция</div></td>' +
          (showQuantityColumn ? '<td>' + escapeHtml(String(personalItems.length)) + '</td>' : '') +
          '<td>' + personalExecutor + '</td>' +
          '<td>' + (op.plannedMinutes || '') + '</td>' +
          '<td>' + personalStatusHtml + '</td>' +
          '<td>' + personalTime + '</td>' +
          personalActionsCell +
          '<td>' + personalCommentCell + '</td>' +
          '</tr>';
        if (showFlowItems) {
          html += '<tr class="op-items-row individual-op-items-row"><td colspan="' + totalColumns + '">' + buildOperationItemsAccordion(card, op, personalItems, { hideItemStatuses: hideFlowItemStatuses, showDelayedActions, showDefectActions, allowedItemStatuses: allowedFlowItemStatuses, workspaceMode, personalOperation: personalOp }) + '</td></tr>';
        }
      });
    }
  });

  html += '</tbody></table>';
  return '<div class="table-wrapper operations-table-wrapper">' + html + '</div>';
}

function formatQuantityValue(val) {
  if (val === '' || val == null) return '';
  return val + ' шт';
}

function resolveCardField(card, ...fields) {
  if (!card) return '';
  for (const field of fields) {
    const raw = card[field];
    if (raw === null || raw === undefined) continue;
    const value = typeof raw === 'string' ? raw.trim() : raw;
    if (value !== '') return value;
  }
  return '';
}

function formatMultilineValue(value, { multiline = false } = {}) {
  if (value === '' || value == null) return '—';
  const safe = escapeHtml(String(value));
  return multiline ? safe.replace(/\n/g, '<br>') : safe;
}

function formatCardMainSummaryFromCard(card) {
  const name = resolveCardField(card, 'itemName', 'name');
  const quantity = resolveCardField(card, 'batchSize', 'quantity');
  const routeNumber = resolveCardField(card, 'routeCardNumber', 'orderNo');
  return formatCardMainSummaryText({ name, quantity, routeNumber });
}

function renderCardDisplayField(label, value, { multiline = false, fullWidth = false } = {}) {
  const classes = ['card-display-field'];
  if (fullWidth) classes.push('card-display-field-full');
  const content = formatMultilineValue(value, { multiline });
  return '<div class="' + classes.join(' ') + '">' +
    '<div class="field-label">' + escapeHtml(label) + '</div>' +
    '<div class="field-value' + (multiline ? ' multiline' : '') + '">' + content + '</div>' +
    '</div>';
}

function buildCardInfoBlock(card, { collapsible = true, startCollapsed = false, showHeader = true } = {}) {
  if (!card) return '';

  const routeCardNumber = resolveCardField(card, 'routeCardNumber', 'orderNo');
  const documentDesignation = resolveCardField(card, 'documentDesignation', 'drawing');
  const documentDate = formatDateInputValue(resolveCardField(card, 'documentDate'));
  const plannedCompletionDate = formatDateInputValue(resolveCardField(card, 'plannedCompletionDate'));
  const issuedBySurname = resolveCardField(card, 'issuedBySurname');
  const programName = resolveCardField(card, 'programName');
  const labRequestNumber = resolveCardField(card, 'labRequestNumber');
  const workBasis = resolveCardField(card, 'workBasis', 'contractNumber');
  const supplyState = resolveCardField(card, 'supplyState');
  const itemDesignation = resolveCardField(card, 'itemDesignation', 'drawing');
  const supplyStandard = resolveCardField(card, 'supplyStandard');
  const itemName = resolveCardField(card, 'itemName', 'name');
  const mainMaterials = resolveCardField(card, 'mainMaterials');
  const mainMaterialGrade = resolveCardField(card, 'mainMaterialGrade', 'material');
  const batchSize = resolveCardField(card, 'batchSize', 'quantity');
  const itemSerials = formatItemSerialsValue(card);
  const specialNotes = resolveCardField(card, 'specialNotes', 'desc');
  const responsibleProductionChief = resolveCardField(card, 'responsibleProductionChief');
  const responsibleSKKChief = resolveCardField(card, 'responsibleSKKChief');
  const responsibleTechLead = resolveCardField(card, 'responsibleTechLead');
  const approvalThread = Array.isArray(card.approvalThread) ? card.approvalThread : [];

  const getApprovalTsByRole = (roleContext) => {
    const targetRole = String(roleContext || '').trim().toUpperCase();
    for (let i = approvalThread.length - 1; i >= 0; i--) {
      const entry = approvalThread[i];
      if (!entry) continue;
      if (String(entry.actionType || '').trim().toUpperCase() !== 'APPROVE') continue;
      if (String(entry.roleContext || '').trim().toUpperCase() !== targetRole) continue;
      const ts = Number(entry.ts || entry.createdAt || 0);
      if (ts > 0) return ts;
    }
    return 0;
  };

  const renderResponsibleField = (label, value, roleContext) => {
    const ts = getApprovalTsByRole(roleContext);
    const approvedAt = ts > 0 ? new Date(ts).toLocaleString('ru-RU') : '';
    const safeValue = value === '' || value == null ? '—' : escapeHtml(String(value));
    const extraLine = approvedAt
      ? '<div class="field-meta">Согласовано: ' + escapeHtml(approvedAt) + '</div>'
      : '<div class="field-meta">Согласование: —</div>';
    return '<div class="card-display-field">' +
      '<div class="field-label">' + escapeHtml(label) + '</div>' +
      '<div class="field-value">' + safeValue + '</div>' +
      extraLine +
      '</div>';
  };

  const summaryText = formatCardMainSummaryFromCard(card);
  const batchLabel = batchSize === '' || batchSize == null ? '—' : toSafeCount(batchSize);

  const blockClasses = ['card-main-collapse-block', 'card-info-collapse-block'];
  if (!collapsible) blockClasses.push('card-info-static');
  const attrs = ['class="' + blockClasses.join(' ') + '"', 'data-card-id="' + card.id + '"'];
  if (collapsible && startCollapsed) attrs.push('data-start-collapsed="true"');

  let html = '<div ' + attrs.join(' ') + '>';
  if (showHeader) {
    html += '<div class="card-main-header">' +
      '<h3 class="card-main-title">Основные данные</h3>' +
      '<div class="card-main-summary">' + escapeHtml(summaryText) + '</div>' +
      (collapsible ? '<button type="button" class="btn-secondary card-main-toggle card-info-toggle" aria-expanded="true">Свернуть</button>' : '') +
      '</div>';
  }

  html += '<div class="card-main-collapse-body">';
  html += '<div class="card-info-block">';
  html += '<div class="card-meta-grid card-meta-grid-compact card-display-grid">' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Маршрутная карта №', routeCardNumber) +
    renderCardDisplayField('Обозначение документа', documentDesignation) +
    renderCardDisplayField('Дата', documentDate) +
    renderCardDisplayField('Планируемая дата завершения', plannedCompletionDate) +
    '</div>' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Фамилия выписавшего маршрутную карту', issuedBySurname) +
    renderCardDisplayField('Название программы', programName) +
    renderCardDisplayField('Номер заявки лаборатории', labRequestNumber) +
    '</div>' +
    '</div>';

  html += '<div class="card-meta-grid card-meta-grid-compact card-display-grid">' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Основание для выполнения работ', workBasis, { multiline: true }) +
    '</div>' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Состояние поставки', supplyState) +
    '</div>' +
    '</div>';

  html += '<div class="card-meta-grid card-meta-grid-compact card-display-grid">' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Обозначение изделия', itemDesignation) +
    '</div>' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('НТД на поставку', supplyStandard) +
    '</div>' +
    '</div>';

  html += '<div class="card-display-field card-display-field-full">' +
    '<div class="field-label">Наименование изделия</div>' +
    '<div class="field-value multiline">' + formatMultilineValue(itemName, { multiline: true }) + '</div>' +
    '</div>';

  html += '<div class="card-meta-grid card-meta-grid-compact card-display-grid">' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Основные материалы, применяемые в техпроцессе (согласно заказу на производство)', mainMaterials, { multiline: true }) +
    '</div>' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Марка основного материала', mainMaterialGrade) +
    '</div>' +
    '</div>';

  html += '<div class="card-meta-grid card-meta-grid-compact card-display-grid">' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Размер партии', batchLabel) +
    '</div>' +
    '<div class="card-meta-col">' +
    renderCardDisplayField('Индивидуальные номера изделий', itemSerials, { multiline: true }) +
    '</div>' +
    '</div>';

  html += renderCardDisplayField('Особые отметки', specialNotes, { multiline: true, fullWidth: true });

  html += '<div class="card-meta-grid card-meta-grid-compact card-display-grid card-meta-responsible">' +
    '<div class="card-meta-col">' +
    renderResponsibleField('Начальник производства (ФИО)', responsibleProductionChief, 'PRODUCTION') +
    '</div>' +
    '<div class="card-meta-col">' +
    renderResponsibleField('Начальник СКК (ФИО)', responsibleSKKChief, 'SKK') +
    '</div>' +
    '<div class="card-meta-col">' +
    renderResponsibleField('ЗГД по технологиям (ФИО)', responsibleTechLead, 'TECH') +
    '</div>' +
    '</div>';

  html += '</div>';
  html += '</div>';
  html += '</div>';
  return html;
}

function setCardInfoCollapsed(block, collapsed, toggles = []) {
  if (!block) return;
  block.classList.toggle('is-collapsed', !!collapsed);
  const allToggles = Array.isArray(toggles) ? toggles : [];
  allToggles.forEach(toggle => {
    if (!toggle) return;
    toggle.textContent = collapsed ? 'Основные данные ▼' : 'Основные данные ▲';
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  });
}

function bindCardInfoToggles(root, { defaultCollapsed = true } = {}) {
  if (!root) return;
  root.querySelectorAll('.card-info-collapse-block').forEach(block => {
    const cardId = block.getAttribute('data-card-id') || '';
    const internalToggles = Array.from(block.querySelectorAll('.card-info-toggle'));
    const externalToggles = cardId
      ? Array.from(root.querySelectorAll('.card-info-toggle[data-card-id="' + cardId + '"]'))
      : [];
    const toggles = Array.from(new Set(internalToggles.concat(externalToggles)));
    if (!toggles.length) return;
    const startCollapsed = block.hasAttribute('data-start-collapsed')
      ? block.getAttribute('data-start-collapsed') !== 'false'
      : defaultCollapsed;
    setCardInfoCollapsed(block, startCollapsed, toggles);
    toggles.forEach(toggle => {
      toggle.addEventListener('click', () => {
        setCardInfoCollapsed(block, !block.classList.contains('is-collapsed'), toggles);
      });
    });
  });
}

function renderQuantityRow(card, op, { readonly = false, colspan = 9, blankForPrint = false } = {}) {
  const opQty = getOperationQuantity(op, card);
  const totalLabel = opQty === '' ? '—' : opQty + ' шт';
  const base = '<span class="qty-total">Количество изделий: ' + escapeHtml(totalLabel) + '</span>';
  const lockRow = readonly || op.status === 'DONE';
  const executionStats = getOperationExecutionStats(card, op);
  const goodVal = executionStats.good;
  const scrapVal = executionStats.defect;
  const holdVal = executionStats.delayed;

  if (lockRow) {
    const chipGood = blankForPrint ? '____' : escapeHtml(goodVal);
    const chipScrap = blankForPrint ? '____' : escapeHtml(scrapVal);
    const chipHold = blankForPrint ? '____' : escapeHtml(holdVal);

    return '<tr class="op-qty-row"><td colspan="' + colspan + '">' +
      '<div class="qty-row-content readonly">' +
      base +
      '<span class="qty-chip">Годные: ' + chipGood + '</span>' +
      '<span class="qty-chip">Брак: ' + chipScrap + '</span>' +
      '<span class="qty-chip">Задержано: ' + chipHold + '</span>' +
      '</div>' +
      '</td></tr>';
  }

  return '<tr class="op-qty-row" data-card-id="' + card.id + '" data-op-id="' + op.id + '"><td colspan="' + colspan + '">' +
    '<div class="qty-row-content">' +
    base +
    '<label>Годные <input type="number" class="qty-input" data-qty-type="good" data-card-id="' + card.id + '" data-op-id="' + op.id + '" min="0" value="' + goodVal + '"></label>' +
    '<label>Брак <input type="number" class="qty-input" data-qty-type="scrap" data-card-id="' + card.id + '" data-op-id="' + op.id + '" min="0" value="' + scrapVal + '"></label>' +
    '<label>Задержано <input type="number" class="qty-input" data-qty-type="hold" data-card-id="' + card.id + '" data-op-id="' + op.id + '" min="0" value="' + holdVal + '"></label>' +
    '</div>' +
    '</td></tr>';
}

async function applyOperationAction(
  action,
  card,
  op,
  { useWorkorderScrollLock = true, sourceEl = null, syncFromInputs = true, personalOperationId = '' } = {}
) {
  if (!card || !op) {
    if (getWorkspaceActionSource() === 'workspace') {
      showToast?.('Данные операции устарели. Данные обновлены.');
      await forceRefreshWorkspaceProductionData('workspace-action-missing-context');
    }
    return;
  }
  const normalizedPersonalOperationId = String(personalOperationId || '').trim();
  const actionSource = getWorkspaceActionSource();
  const workspaceActionLockKey = actionSource === 'workspace'
    ? [
      String(card.id || '').trim(),
      String(op.id || '').trim(),
      normalizedPersonalOperationId,
      String(action || '').trim().toLowerCase()
    ].join('::')
    : '';
  if (workspaceActionLockKey && workspaceOperationActionLocks.has(workspaceActionLockKey)) {
    return;
  }

  const syncQuantitiesFromInputs = (root) => {
    const fieldMap = { good: 'goodCount', scrap: 'scrapCount', hold: 'holdCount' };
    const selectorBase = '[data-card-id="' + card.id + '"][data-op-id="' + op.id + '"]';
    const result = { goodCount: 0, scrapCount: 0, holdCount: 0 };
    if (!root) return result;

    root.querySelectorAll('.qty-input' + selectorBase).forEach(input => {
      const type = input.getAttribute('data-qty-type');
      const field = fieldMap[type] || null;
      if (!field) return;
      const val = toSafeCount(input.value);
      result[field] = val;
    });

    return result;
  };

  if (action === 'stop' && card.cardType === 'MKI') {
    if (isMaterialIssueOperation(op)) {
      openMaterialIssueModal(card, op);
    } else if (isMaterialReturnOperation(op)) {
      openMaterialReturnModal(card, op);
    } else {
      openWorkspaceTransferModal(card, op, normalizedPersonalOperationId ? { personalOperationId: normalizedPersonalOperationId } : {});
    }
    return;
  }

  if (card.cardType === 'MKI' && isIndividualOperationUi(card, op)) {
    if (action === 'start' && !normalizedPersonalOperationId) {
      openWorkspaceTransferModal(card, op, { selectionMode: true });
      return;
    }
    if (normalizedPersonalOperationId && ['start', 'pause', 'resume'].includes(action)) {
      try {
        const expectedFlowVersion = Number.isFinite(card.flow?.version) ? card.flow.version : 1;
        const routeContext = captureClientWriteRouteContext();
        const result = await runProductionExecutionWriteRequest({
          action: 'workspace-personal-operation:' + action,
          writePath: '/api/production/personal-operation/action',
          cardId: card.id,
          expectedFlowVersion,
          routeContext,
          defaultErrorMessage: 'Не удалось выполнить действие.',
          defaultConflictMessage: 'Данные операции уже изменились. Данные обновлены, попробуйте выполнить действие снова.',
          request: () => apiFetch('/api/production/personal-operation/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              cardId: card.id,
              parentOpId: op.id,
              personalOperationId: normalizedPersonalOperationId,
              action,
              expectedFlowVersion
            })
          }),
          onConflict: async ({ payload }) => {
            if (actionSource === 'workspace' && Number.isFinite(payload.flowVersion)) {
              syncWorkspaceLocalFlowVersion(card, payload.flowVersion);
            }
          },
          onError: async ({ payload }) => {
            if (actionSource === 'workspace' && Number.isFinite(payload.flowVersion)) {
              syncWorkspaceLocalFlowVersion(card, payload.flowVersion);
            }
          }
        });
        if (!result.ok) {
          showToast?.(result.message) || alert(result.message);
          return;
        }
        const data = result.payload || {};
        if (Number.isFinite(data.flowVersion)) {
          applyWorkspaceLocalOperationAction(card, op, action, {
            personalOperationId: normalizedPersonalOperationId,
            flowVersion: data.flowVersion
          });
        }
        if (actionSource === 'workspace') {
          suppressWorkspaceLiveRefresh();
          refreshWorkspaceUiAfterDirectAction(card, 'workspace-personal-action:' + action);
        } else if (actionSource === 'workorders') {
          await refreshWorkordersProductionDataPreservingRoute('workorders-personal-action:' + action);
        } else {
          await loadData();
          renderEverything();
        }
        return;
      } catch (err) {
        console.error('personal operation action failed', err);
        showToast?.('Ошибка соединения при выполнении действия.') || alert('Ошибка соединения при выполнении действия.');
        return;
      }
    }
  }

  const execute = async () => {
    const expectedFlowVersion = Number.isFinite(card.flow?.version) ? card.flow.version : 1;
    let url = '/api/production/operation/' + action;
    const source = actionSource;
    let payload = { cardId: card.id, opId: op.id, expectedFlowVersion, source };

    if (action === 'stop') {
      url = '/api/production/operation/complete';
      if (syncFromInputs) {
        const counts = sourceEl
          ? syncQuantitiesFromInputs(sourceEl)
          : syncQuantitiesFromInputs(document);
        payload = { ...payload, ...counts };
      }
    }

    try {
      const routeContext = captureClientWriteRouteContext();
      const result = await runProductionExecutionWriteRequest({
        action: 'workspace-operation:' + action,
        writePath: url,
        cardId: card.id,
        expectedFlowVersion,
        routeContext,
        defaultErrorMessage: 'Не удалось выполнить действие.',
        defaultConflictMessage: 'Данные операции уже изменились. Данные обновлены, попробуйте выполнить действие снова.',
        request: () => apiFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }),
        onConflict: async ({ payload: responsePayload, message }) => {
          if (source === 'workspace' && Number.isFinite(responsePayload.flowVersion)) {
            syncWorkspaceLocalFlowVersion(card, responsePayload.flowVersion);
          }
        },
        onError: async ({ payload: responsePayload }) => {
          if (source === 'workspace' && Number.isFinite(responsePayload.flowVersion)) {
            syncWorkspaceLocalFlowVersion(card, responsePayload.flowVersion);
          }
        }
      });
      if (!result.ok) {
        showToast?.(result.message) || alert(result.message);
        return;
      }

      const data = result.payload || {};
      if (Number.isFinite(data.flowVersion)) {
        applyWorkspaceLocalOperationAction(card, op, action, {
          flowVersion: data.flowVersion
        });
      }
      if (source === 'workspace') {
        suppressWorkspaceLiveRefresh();
        refreshWorkspaceUiAfterDirectAction(card, 'workspace-operation:' + action);
      } else if (source === 'workorders') {
        await refreshWorkordersProductionDataPreservingRoute('workorders-operation:' + action);
      } else {
        await loadData();
        renderEverything();
      }

      const updated = cards.find(c => c.id === card.id);
      if (activeMobileCardId === card.id && isMobileOperationsLayout() && updated) {
        buildMobileOperationsView(updated, { preserveScroll: true });
      }
    } catch (err) {
      console.error('operation action failed', err);
      showToast?.('Ошибка соединения при выполнении действия.') || alert('Ошибка соединения при выполнении действия.');
    }
  };

  suppressWorkorderAutoscroll = true;
  const anchorEl = useWorkorderScrollLock ? findWorkorderDetail({ cardId: card.id }) : null;
  const anchorTop = anchorEl ? anchorEl.getBoundingClientRect().top : null;
  const prevX = window.scrollX;
  const prevY = window.scrollY;
  if (workspaceActionLockKey) {
    workspaceOperationActionLocks.add(workspaceActionLockKey);
  }
  try {
    await execute();
  } finally {
    if (workspaceActionLockKey) {
      workspaceOperationActionLocks.delete(workspaceActionLockKey);
    }
    if (useWorkorderScrollLock && suppressWorkorderAutoscroll) {
      requestAnimationFrame(() => {
        if (anchorTop != null) {
          const freshAnchor = findWorkorderDetail({ cardId: card.id });
          if (freshAnchor) {
            const newTop = freshAnchor.getBoundingClientRect().top;
            const delta = newTop - anchorTop;
            window.scrollTo({ left: prevX, top: window.scrollY + delta });
            return;
          }
        }
        window.scrollTo({ left: prevX, top: prevY });
      });
    }
    suppressWorkorderAutoscroll = false;
  }
}

function closeMobileOperationsView() {
  const container = document.getElementById('mobile-operations-view');
  if (!container) return;
  activeMobileCardId = null;
  mobileOpsScrollTop = 0;
  if (mobileOpsObserver) {
    mobileOpsObserver.disconnect();
    mobileOpsObserver = null;
  }
  container.classList.add('hidden');
  container.innerHTML = '';
  document.body.classList.remove('mobile-ops-open');
  window.scrollTo({ top: mobileWorkorderScroll, left: 0 });
}

function buildMobileQtyBlock(card, op, { readonly = false } = {}) {
  if (isDryingOperation(op)) {
    return '<div class="card-section-title">Количество изделий: —</div>';
  }
  const opQty = getOperationQuantity(op, card);
  const executionStats = getOperationExecutionStats(card, op);
  if (readonly || op.status === 'DONE') {
    return '<div class="card-section-title">Количество изделий: ' + escapeHtml(opQty || '—') + (opQty ? ' шт' : '') + '</div>' +
      '<div class="mobile-qty-grid readonly">' +
      '<span class="qty-chip">Годные: ' + escapeHtml(executionStats.good) + '</span>' +
      '<span class="qty-chip">Брак: ' + escapeHtml(executionStats.defect) + '</span>' +
      '<span class="qty-chip">Задержано: ' + escapeHtml(executionStats.delayed) + '</span>' +
      '</div>';
  }
  return '<div class="card-section-title">Количество изделий: ' + escapeHtml(opQty || '—') + (opQty ? ' шт' : '') + '</div>' +
    '<div class="mobile-qty-grid" data-card-id="' + card.id + '" data-op-id="' + op.id + '">' +
    '<label>Годные <input type="number" class="qty-input" data-qty-type="good" data-card-id="' + card.id + '" data-op-id="' + op.id + '" min="0" value="' + executionStats.good + '"></label>' +
    '<label>Брак <input type="number" class="qty-input" data-qty-type="scrap" data-card-id="' + card.id + '" data-op-id="' + op.id + '" min="0" value="' + executionStats.defect + '"></label>' +
    '<label>Задержано <input type="number" class="qty-input" data-qty-type="hold" data-card-id="' + card.id + '" data-op-id="' + op.id + '" min="0" value="' + executionStats.delayed + '"></label>' +
    '</div>';
}

function buildMobileOperationCard(card, op, idx, total, { lockExecutors = false, lockQuantities = false } = {}) {
  const rowId = card.id + '::' + op.id;
  const elapsed = getIndividualOperationElapsedSecondsUi(card, op);
  const effectiveStatus = op.status || 'NOT_STARTED';
  const storedSeconds = isDryingOperation(op)
    ? elapsed
    : getIndividualOperationStoredSecondsUi(card, op);
  const timeText = (effectiveStatus === 'IN_PROGRESS' || effectiveStatus === 'PAUSED')
    ? '<span class="wo-timer" data-row-id="' + rowId + '">' + formatSecondsToHMS(elapsed) + '</span>'
    : (effectiveStatus === 'DONE'
      ? (storedSeconds > 0 ? formatSecondsToHMS(storedSeconds) : '—')
      : (storedSeconds > 0 ? formatSecondsToHMS(storedSeconds) : '—'));
  let actionsHtml = '';
  const pendingCount = Number.isFinite(op.pendingCount) ? op.pendingCount : 0;
  const blockers = Array.isArray(op.blockedReasons) ? op.blockedReasons.filter(Boolean).join(' ') : '';
  const startDisabled = op.canStart ? '' : ' disabled';
  const pauseDisabled = op.canPause ? '' : ' disabled';
  const resumeDisabled = op.canResume ? '' : ' disabled';
  const completeDisabled = op.canComplete ? '' : ' disabled';
  const titleAttr = blockers ? ' title="' + escapeHtml(blockers) + '"' : '';
  const workspaceAllowed = !workspaceMode || isWorkspaceOperationAllowed(card, op);
  const canOperateSubcontract = !workspaceMode || canCurrentUserOperateWorkspaceSubcontract(card, op);
  const subcontractDeniedTitle = 'Операция субподрядчика доступна только мастеру смены этой даты/смены или назначенному исполнителю';
  const flowBlockedReasons = getWorkspaceBlockedInfoReasonsUi(card, op, { effectiveStatus });
  const showBlockedInfo = workspaceMode
    && workspaceAllowed
    && canOperateSubcontract
    && shouldShowWorkspaceFlowBlockedBadgeUi(card, op, flowBlockedReasons, { effectiveStatus });

  if (workspaceMode && shouldPrioritizeWorkspaceShiftLockUi(op) && !workspaceAllowed) {
    actionsHtml = '<button type="button" class="btn-secondary workspace-op-lock" data-action="workspace-locked" data-card-id="' + card.id + '" data-op-id="' + op.id + '" title="Операция не запланирована на текущую смену">🔒</button>';
  } else if (workspaceMode && !canOperateSubcontract) {
    actionsHtml = '<button type="button" class="btn-secondary workspace-op-lock" data-action="workspace-locked" data-card-id="' + card.id + '" data-op-id="' + op.id + '" title="' + escapeHtml(subcontractDeniedTitle) + '">🔒</button>';
  } else if (isDryingOperation(op)) {
    if (op.canStart || effectiveStatus === 'IN_PROGRESS' || effectiveStatus === 'DONE') {
      actionsHtml = '<button class="btn-primary" data-action="drying" data-card-id="' + card.id + '" data-op-id="' + op.id + '"' + titleAttr + '>Сушить</button>';
    }
  } else if (effectiveStatus === 'NOT_STARTED') {
    if (op.canStart) {
      actionsHtml = '<button class="btn-primary" data-action="start" data-card-id="' + card.id + '" data-op-id="' + op.id + '"' + titleAttr + '>Начать</button>';
    }
  } else if (effectiveStatus === 'IN_PROGRESS') {
    actionsHtml = '<button class="btn-secondary" data-action="pause" data-card-id="' + card.id + '" data-op-id="' + op.id + '"' + pauseDisabled + '>Пауза</button>' +
      '<button class="btn-secondary" data-action="stop" data-card-id="' + card.id + '" data-op-id="' + op.id + '"' + completeDisabled + titleAttr + '>Завершить</button>';
  } else if (effectiveStatus === 'PAUSED') {
    actionsHtml = '<button class="btn-primary" data-action="resume" data-card-id="' + card.id + '" data-op-id="' + op.id + '"' + resumeDisabled + titleAttr + '>Продолжить</button>';
  } else if (effectiveStatus === 'DONE' && (isMaterialIssueOperation(op) || isMaterialReturnOperation(op)) && op.canStart) {
    actionsHtml = '<button class="btn-primary" data-action="start" data-card-id="' + card.id + '" data-op-id="' + op.id + '"' + titleAttr + '>Начать</button>';
  }
  if (showBlockedInfo) {
    actionsHtml += buildWorkspaceFlowBlockedBadgeHtml(flowBlockedReasons);
  }

  return '<article class="mobile-op-card" data-op-index="' + (idx + 1) + '">' +
    '<div class="mobile-op-top op-card-header">' +
    '<div class="op-title">' +
    '<div class="mobile-op-name">' + (idx + 1) + '. ' + renderOpName(op, { card }) + '</div>' +
    '<div class="mobile-op-meta">Подразделение: ' + escapeHtml(op.centerName) + ' • Код операции: ' + escapeHtml(op.opCode || '') + '</div>' +
    '</div>' +
    '<div class="op-status">' + statusBadge(effectiveStatus) + '</div>' +
    '</div>' +
    '<div class="mobile-executor-block">' +
    '<div class="card-section-title">Исполнитель <span class="hint" style="font-weight:400; font-size:12px;">(доп. до 3)</span></div>' +
    renderExecutorCell(op, card, { mobile: true, readonly: lockExecutors }) +
    '</div>' +
    '<div class="mobile-plan-time">' +
    '<div><div class="card-section-title">План (мин)</div><div>' + escapeHtml(op.plannedMinutes || '') + '</div></div>' +
    '<div><div class="card-section-title">Текущее / факт. время</div><div>' + timeText + '</div></div>' +
    '</div>' +
    '<div class="mobile-qty-block">' + buildMobileQtyBlock(card, op, { readonly: lockQuantities }) + '</div>' +
    '<div class="mobile-actions">' + actionsHtml + '</div>' +
    '<div class="mobile-op-comment">' +
    '<div class="card-section-title">Комментарий</div>' +
    '<button type="button" class="op-comments-btn" data-action="op-comments" data-card-id="' + card.id + '" data-op-id="' + op.id + '" data-allow-view="true">' +
      '<span>💬</span>' +
      '<span class="op-comments-count">' + ensureOpCommentsArray(op).length + '</span>' +
    '</button>' +
    '</div>' +
    '</article>';
}

function buildMobileOperationsView(card, { preserveScroll = false } = {}) {
  const container = document.getElementById('mobile-operations-view');
  if (!container || !card) return;
  const opsSorted = [...(card.operations || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const titleHtml = escapeHtml(formatCardTitle(card) || card.name || card.id || '');
  const status = cardStatusText(card);
  const headerActions = '<div class="mobile-ops-actions">' +
    '<span class="status-pill">' + escapeHtml(status) + '</span>' +
    '<button type="button" class="btn-small btn-secondary barcode-view-btn" data-allow-view="true" data-card-id="' + card.id + '">Штрихкод</button>' +
    '<button type="button" class="btn-small btn-secondary log-btn" data-allow-view="true" data-log-card="' + card.id + '">Log</button>' +
    '</div>';

  const lockDerivedFields = isWorkordersDerivedViewRoute();
  const cardsHtml = opsSorted.map((op, idx) => buildMobileOperationCard(card, op, idx, opsSorted.length, {
    lockExecutors: lockDerivedFields,
    lockQuantities: lockDerivedFields
  })).join('');
  container.innerHTML =
    '<div class="mobile-ops-header">' +
    '<div class="mobile-ops-header-row">' +
    '<button type="button" id="mobile-ops-back" class="btn-secondary mobile-ops-back" aria-label="Назад">← Назад</button>' +
    '<div class="mobile-ops-title">' + titleHtml + '</div>' +
    '</div>' +
    headerActions +
    '</div>' +
    '<div class="mobile-ops-indicator" id="mobile-ops-indicator">Операция 1 / ' + opsSorted.length + '</div>' +
    '<div class="mobile-ops-list" id="mobile-ops-list">' + cardsHtml + '</div>';

  const listEl = container.querySelector('#mobile-ops-list');
  if (preserveScroll) {
    listEl.scrollTop = mobileOpsScrollTop;
  } else {
    listEl.scrollTop = 0;
  }

  const updateIndicator = () => {
    const indicator = container.querySelector('#mobile-ops-indicator');
    if (!indicator) return;
    const cards = Array.from(listEl.querySelectorAll('.mobile-op-card'));
    if (!cards.length) return;
    const listTop = listEl.getBoundingClientRect().top;
    let minIdx = 0;
    let minDelta = Infinity;
    cards.forEach((cardEl, idx) => {
      const delta = Math.abs(cardEl.getBoundingClientRect().top - listTop);
      if (delta < minDelta) {
        minDelta = delta;
        minIdx = idx;
      }
    });
    indicator.textContent = 'Операция ' + (minIdx + 1) + ' / ' + cards.length;
  };

  listEl.addEventListener('scroll', () => {
    mobileOpsScrollTop = listEl.scrollTop;
    updateIndicator();
  });
  updateIndicator();

  const backBtn = container.querySelector('#mobile-ops-back');
  if (backBtn) {
    backBtn.addEventListener('click', () => closeMobileOperationsView());
  }

  bindOperationControls(container, { readonly: isTabReadonly('workorders') });

  container.classList.remove('hidden');
  document.body.classList.add('mobile-ops-open');
  mobileOpsScrollTop = listEl.scrollTop;
}

function openMobileOperationsView(cardId) {
  const card = cards.find(c => c.id === cardId);
  if (!card) return;
  mobileWorkorderScroll = window.scrollY;
  activeMobileCardId = card.id;
  buildMobileOperationsView(card);
}

function bindOperationControls(root, { readonly = false } = {}) {
  if (!root) return;
  ensureOperationTimersStarted();
  updateRenderedOperationTimers();

  root.querySelectorAll('.barcode-view-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-card-id');
      const card = cards.find(c => c.id === id);
      if (!card) return;
      openBarcodeModal(card);
    });
  });

  root.querySelectorAll('.items-view-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-items-card');
      if (id) openItemsModal(id);
    });
  });

  root.querySelectorAll('.log-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-log-card');
      openCardLogPage(id);
    });
  });


  root.querySelectorAll('.executor-main-input').forEach(input => {
    const mobileCombo = isMobileExecutorInput(input);
    let isComposing = false;
    const runFiltering = () => updateExecutorCombo(input, { forceOpen: true });
    const comboWrapper = input.closest('.executor-combobox');
    const arrow = comboWrapper ? comboWrapper.querySelector('.executor-arrow') : null;

    if (arrow) {
      arrow.addEventListener('pointerdown', e => {
        e.preventDefault();
        input.focus({ preventScroll: true });
        runFiltering();
      });
    }

    if (mobileCombo) {
      input.addEventListener('compositionstart', () => { isComposing = true; });
      input.addEventListener('compositionend', () => { isComposing = false; runFiltering(); });
    }

    input.addEventListener('focus', () => {
      input.dataset.prevVal = input.value || '';
      runFiltering();
    });
    input.addEventListener('click', runFiltering);
    input.addEventListener('touchstart', runFiltering);
    input.addEventListener('input', e => {
      if (isWorkordersDerivedViewRoute()) {
        e.target.value = input.dataset.prevVal || '';
        return;
      }
      const cardId = input.getAttribute('data-card-id');
      const opId = input.getAttribute('data-op-id');
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!op) return;
      op.executor = sanitizeExecutorName((e.target.value || '').trim());
      if (!op.executor && (e.target.value || '').trim()) {
        e.target.value = '';
      }
      if (mobileCombo) {
        if (!isComposing) runFiltering();
      } else {
        updateExecutorCombo(input, { forceOpen: true });
      }
    });
    input.addEventListener('blur', e => {
      const cardId = input.getAttribute('data-card-id');
      const opId = input.getAttribute('data-op-id');
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!card || !op) return;
      const raw = (e.target.value || '').trim();
      const value = sanitizeExecutorName(raw);
      const prev = input.dataset.prevVal || '';
      if (guardWorkordersLegacyWriteAction('Исполнители в Трекере доступны только для просмотра. Изменение исполнителей будет перенесено в отдельную доменную команду.')) {
        e.target.value = prev;
        op.executor = sanitizeExecutorName(prev);
        updateExecutorCombo(input);
        return;
      }
      if (value && !isEligibleExecutorName(value)) {
        alert('Выберите исполнителя со статусом "Рабочий" или "Сотрудник лаборатории" (пользователь Abyss недоступен).');
        e.target.value = '';
        op.executor = '';
        updateExecutorCombo(input);
        return;
      }
      if (!value && raw) {
        alert('Пользователь Abyss недоступен для выбора. Выберите другого исполнителя.');
        e.target.value = '';
      }
      op.executor = value;
      if (prev !== value) {
        recordCardLog(card, { action: 'Исполнитель', object: opLogLabel(op), field: 'executor', targetId: op.id, oldValue: prev, newValue: value });
        saveData();
        renderDashboard();
      }
      updateExecutorCombo(input);
    });
  });

  root.querySelectorAll('.add-executor-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (guardWorkordersLegacyWriteAction('Добавление исполнителей в Трекере временно заблокировано до отдельной доменной команды.')) return;
      const cardId = btn.getAttribute('data-card-id');
      const opId = btn.getAttribute('data-op-id');
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!card || !op) return;
      if (!Array.isArray(op.additionalExecutors)) op.additionalExecutors = [];
      if (op.additionalExecutors.length >= 3) return;
      op.additionalExecutors.push('');
      recordCardLog(card, { action: 'Доп. исполнитель', object: opLogLabel(op), field: 'additionalExecutors', targetId: op.id, oldValue: op.additionalExecutors.length - 1, newValue: op.additionalExecutors.length });
      saveData();
      renderWorkordersTable();
      if (activeMobileCardId === card.id && isMobileOperationsLayout()) {
        buildMobileOperationsView(card, { preserveScroll: true });
      }
    });
  });

  root.querySelectorAll('.remove-executor-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (guardWorkordersLegacyWriteAction('Удаление исполнителей в Трекере временно заблокировано до отдельной доменной команды.')) return;
      const cardId = btn.getAttribute('data-card-id');
      const opId = btn.getAttribute('data-op-id');
      const idx = parseInt(btn.getAttribute('data-extra-index'), 10);
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!card || !op || !Array.isArray(op.additionalExecutors)) return;
      if (idx < 0 || idx >= op.additionalExecutors.length) return;
      const removed = op.additionalExecutors.splice(idx, 1)[0];
      recordCardLog(card, { action: 'Доп. исполнитель', object: opLogLabel(op), field: 'additionalExecutors', targetId: op.id, oldValue: removed, newValue: 'удален' });
      saveData();
      renderWorkordersTable();
      if (activeMobileCardId === card.id && isMobileOperationsLayout()) {
        buildMobileOperationsView(card, { preserveScroll: true });
      }
    });
  });

  root.querySelectorAll('.additional-executor-input').forEach(input => {
    const mobileCombo = isMobileExecutorInput(input);
    let isComposing = false;
    const runFiltering = () => updateExecutorCombo(input, { forceOpen: true });
    const comboWrapper = input.closest('.executor-combobox');
    const arrow = comboWrapper ? comboWrapper.querySelector('.executor-arrow') : null;

    if (arrow) {
      arrow.addEventListener('pointerdown', e => {
        e.preventDefault();
        input.focus({ preventScroll: true });
        runFiltering();
      });
    }

    if (mobileCombo) {
      input.addEventListener('compositionstart', () => { isComposing = true; });
      input.addEventListener('compositionend', () => { isComposing = false; runFiltering(); });
    }

    input.addEventListener('focus', () => {
      input.dataset.prevVal = input.value || '';
      runFiltering();
    });
    input.addEventListener('click', runFiltering);
    input.addEventListener('touchstart', runFiltering);
    input.addEventListener('blur', e => {
      const cardId = input.getAttribute('data-card-id');
      const opId = input.getAttribute('data-op-id');
      const idx = parseInt(input.getAttribute('data-extra-index'), 10);
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!card || !op || !Array.isArray(op.additionalExecutors)) return;
      const raw = (e.target.value || '').trim();
      const value = sanitizeExecutorName(raw);
      const prev = input.dataset.prevVal || '';
      if (guardWorkordersLegacyWriteAction('Дополнительные исполнители в Трекере доступны только для просмотра.')) {
        e.target.value = prev;
        if (idx >= 0 && idx < op.additionalExecutors.length) {
          op.additionalExecutors[idx] = sanitizeExecutorName(prev);
        }
        updateExecutorCombo(input);
        return;
      }
      if (value && !isEligibleExecutorName(value)) {
        alert('Выберите исполнителя со статусом "Рабочий" или "Сотрудник лаборатории" (пользователь Abyss недоступен).');
        e.target.value = '';
        if (idx >= 0 && idx < op.additionalExecutors.length) {
          op.additionalExecutors[idx] = '';
        }
        updateExecutorCombo(input);
        return;
      }
      if (!value && raw) {
        alert('Пользователь Abyss недоступен для выбора. Выберите другого исполнителя.');
        e.target.value = '';
      }
      if (idx < 0 || idx >= op.additionalExecutors.length) return;
      op.additionalExecutors[idx] = value;
      if (prev !== value) {
        recordCardLog(card, { action: 'Доп. исполнитель', object: opLogLabel(op), field: 'additionalExecutors', targetId: op.id, oldValue: prev, newValue: value });
        saveData();
        renderDashboard();
      }
      updateExecutorCombo(input);
    });
    input.addEventListener('input', e => {
      if (isWorkordersDerivedViewRoute()) {
        e.target.value = input.dataset.prevVal || '';
        return;
      }
      const cardId = input.getAttribute('data-card-id');
      const opId = input.getAttribute('data-op-id');
      const idx = parseInt(input.getAttribute('data-extra-index'), 10);
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!card || !op || !Array.isArray(op.additionalExecutors)) return;
      if (idx < 0 || idx >= op.additionalExecutors.length) return;
      const raw = (e.target.value || '').trim();
      const value = sanitizeExecutorName(raw);
      op.additionalExecutors[idx] = value;
      if (mobileCombo) {
        if (!isComposing) runFiltering();
      } else {
        updateExecutorCombo(input, { forceOpen: true });
      }
    });
  });

  root.querySelectorAll('.qty-input').forEach(input => {
    const cardId = input.getAttribute('data-card-id');
    const opId = input.getAttribute('data-op-id');
    const type = input.getAttribute('data-qty-type');
    const card = cards.find(c => c.id === cardId);
    const op = card ? (card.operations || []).find(o => o.id === opId) : null;
    if (!op || !card) return;

    input.addEventListener('input', e => {
      e.target.value = toSafeCount(e.target.value);
    });

    input.addEventListener('blur', e => {
      const val = toSafeCount(e.target.value);
      const fieldMap = { good: 'goodCount', scrap: 'scrapCount', hold: 'holdCount' };
      const field = fieldMap[type] || null;
      if (!field) return;
      const prev = toSafeCount(op[field] || 0);
      if (prev === val) return;
      if (guardWorkordersLegacyWriteAction('Ручное изменение количества в Трекере заблокировано. Количество фиксируется через завершение операции.')) {
        e.target.value = prev;
        return;
      }
      op[field] = val;
      recordCardLog(card, { action: 'Количество деталей', object: opLogLabel(op), field, targetId: op.id, oldValue: prev, newValue: val });
      saveData();
      renderDashboard();
    });
  });

  root.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.getAttribute('data-action');
      const cardId = btn.getAttribute('data-card-id');
      const opId = btn.getAttribute('data-op-id');
      const personalOperationId = btn.getAttribute('data-personal-op-id') || '';
      if (action === 'op-comments') {
        openOpCommentsModal(cardId, opId);
        return;
      }
      if (action === 'workspace-locked') {
        showToast(btn.getAttribute('title') || 'Операция не запланирована на текущую смену');
        return;
      }
      if (action === 'workspace-blocked-info') {
        openWorkspaceBlockedInfoModal(btn.getAttribute('title') || '');
        return;
      }
      if (readonly || btn.disabled) return;
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!card || !op) {
        showToast('Данные операции устарели. Данные обновлены.');
        if (getWorkspaceActionSource() === 'workspace') {
          await forceRefreshWorkspaceProductionData('workspace-action-missing-context');
        } else {
          await loadData();
          renderEverything();
        }
        return;
      }
      if (action === 'drying') {
        openDryingModal(card, op);
        return;
      }
      const detail = btn.closest('.wo-card');
      if (detail && detail.open) {
        workorderOpenCards.add(cardId);
      }
      btn.disabled = true;
      try {
        await applyOperationAction(action, card, op, { sourceEl: detail, personalOperationId });
      } finally {
        btn.disabled = false;
      }
    });
  });

  syncExecutorComboboxMode();
  applyReadonlyState('workorders', 'workorders');
}

let itemsModalCardId = null;
let itemsModalSortKey = 'date';
let itemsModalSortDir = 'desc';
let itemsModalRows = [];
const ITEMS_PAGE_ROUTE_DEFAULT = '/items';
let itemsPageActiveRoute = ITEMS_PAGE_ROUTE_DEFAULT;
const itemsPageRouteState = Object.create(null);
let itemsPageSearchTerm = '';
let itemsPageSortKey = 'date';
let itemsPageSortDir = 'desc';
let itemsPageCurrentPage = 1;
let itemsPageStatusFilter = 'ALL';
let itemsPageDateFrom = '';
let itemsPageDateTo = '';
let opCommentsContext = null;
let materialIssueContext = null;
let materialIssueRows = [];
let materialReturnContext = null;
let materialReturnRows = [];
let dryingContext = null;
let dryingRows = [];
const workspaceOperationActionLocks = new Set();
const MATERIAL_UNIT_OPTIONS = ['кг', 'шт', 'л', 'м', 'м2', 'м3', 'пог.м', 'упак', 'компл', 'лист', 'рул', 'набор', 'боб', 'бут', 'пар'];
const DOC_IDENTIFIER_OPTIONS = [
  { label: 'Хим. анализ', value: 'ХА' },
  { label: 'Термограмма', value: 'Терм' },
  { label: 'Контроль', value: 'Конт' },
  { label: 'Документ', value: 'Док' }
];
const DOC_ALLOWED_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.zip', '.rar', '.7z']);

function normalizeDecimalDisplayInput(value) {
  let raw = (value || '').toString().replace(/\s+/g, '');
  if (!raw) return '';
  raw = raw.replace(',', '.');
  raw = raw.replace(/[^0-9.]/g, '');
  const parts = raw.split('.');
  const intPartRaw = parts.shift() || '';
  const fracPart = parts.join('');
  const hasSeparator = raw.includes('.');
  const endsWithSeparator = raw.endsWith('.');
  let intPart = intPartRaw.replace(/^0+(?=\d)/, '');
  if (!intPart) intPart = '0';
  let normalized = intPart;
  if (hasSeparator) {
    normalized += '.' + fracPart;
  }
  const display = normalized.replace('.', ',');
  if (endsWithSeparator && !display.includes(',')) {
    return display + ',';
  }
  if (endsWithSeparator) {
    return display.endsWith(',') ? display : display + ',';
  }
  return display;
}

function parseDecimalNormalized(value) {
  const raw = (value || '').toString().trim();
  if (!raw) return '';
  const normalized = raw.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(normalized)) return '';
  return normalized;
}

function toDecimalParts(value) {
  const normalized = parseDecimalNormalized(value);
  if (!normalized) return null;
  const parts = normalized.split('.');
  const intPart = (parts[0] || '').replace(/^0+(?=\d)/, '') || '0';
  const fracPart = parts[1] || '';
  return { intPart, fracPart, scale: fracPart.length };
}

function toScaledBigInt(parts, scale) {
  const frac = (parts.fracPart || '').padEnd(scale, '0');
  const raw = (parts.intPart || '0') + frac;
  return BigInt(raw || '0');
}

function compareDecimalStrings(a, b) {
  const aParts = toDecimalParts(a || '0');
  const bParts = toDecimalParts(b || '0');
  if (!aParts || !bParts) return null;
  const scale = Math.max(aParts.scale, bParts.scale);
  const aScaled = toScaledBigInt(aParts, scale);
  const bScaled = toScaledBigInt(bParts, scale);
  if (aScaled === bScaled) return 0;
  return aScaled > bScaled ? 1 : -1;
}

function subtractDecimalStrings(a, b) {
  const aParts = toDecimalParts(a || '0');
  const bParts = toDecimalParts(b || '0');
  if (!aParts || !bParts) return '';
  const scale = Math.max(aParts.scale, bParts.scale);
  const aScaled = toScaledBigInt(aParts, scale);
  const bScaled = toScaledBigInt(bParts, scale);
  const diff = aScaled - bScaled;
  const sign = diff < 0n ? '-' : '';
  const abs = diff < 0n ? -diff : diff;
  let str = abs.toString().padStart(scale + 1, '0');
  if (scale > 0) {
    const head = str.slice(0, -scale) || '0';
    const tail = str.slice(-scale);
    return sign + head + ',' + tail;
  }
  return sign + str;
}

function addDecimalStrings(a, b) {
  const aParts = toDecimalParts(a || '0');
  const bParts = toDecimalParts(b || '0');
  if (!aParts || !bParts) return '';
  const scale = Math.max(aParts.scale, bParts.scale);
  const aScaled = toScaledBigInt(aParts, scale);
  const bScaled = toScaledBigInt(bParts, scale);
  const sum = aScaled + bScaled;
  let str = sum.toString().padStart(scale + 1, '0');
  if (scale > 0) {
    const head = str.slice(0, -scale) || '0';
    const tail = str.slice(-scale);
    return head + ',' + tail;
  }
  return str;
}

function buildDryingRowId(issueOpId, itemIndex) {
  return 'src:' + (issueOpId || '') + ':' + itemIndex;
}

function getDryingEntry(card, opId) {
  if (!card || !Array.isArray(card.materialIssues)) return null;
  return card.materialIssues.find(entry => (entry?.opId || '') === opId) || null;
}

function buildDryingSourceRows(card, op) {
  if (!card || !op) return [];
  const currentOrder = Number.isFinite(Number(op.order)) ? Number(op.order) : Number.MAX_SAFE_INTEGER;
  const issueOps = (card.operations || [])
    .filter(candidate => isMaterialIssueOperation(candidate))
    .filter(candidate => {
      const order = Number.isFinite(Number(candidate?.order)) ? Number(candidate.order) : Number.MAX_SAFE_INTEGER;
      return order < currentOrder && (candidate.status || '') === 'DONE';
    })
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

  const rows = [];
  issueOps.forEach(issueOp => {
    const entry = getDryingEntry(card, issueOp.id);
    const items = Array.isArray(entry?.items) ? entry.items : [];
    items.forEach((item, itemIndex) => {
      if (!item?.isPowder) return;
      rows.push({
        rowId: buildDryingRowId(issueOp.id, itemIndex),
        sourceIssueOpId: issueOp.id,
        sourceItemIndex: itemIndex,
        name: (item?.name || '').toString(),
        qty: normalizeDecimalDisplayInput(item?.qty || '') || (item?.qty || '').toString(),
        unit: (item?.unit || 'кг').toString(),
        isPowder: true,
        dryQty: '',
        dryResultQty: '',
        status: 'NOT_STARTED',
        startedAt: '',
        finishedAt: '',
        createdAt: '',
        updatedAt: ''
      });
    });
  });
  return rows;
}

function mergeDryingRows(existingRows, sourceRows) {
  const baseRows = Array.isArray(existingRows) ? existingRows.slice() : [];
  const sourceList = Array.isArray(sourceRows) ? sourceRows : [];
  const knownIds = new Set(baseRows.map(row => (row?.rowId || '').toString()).filter(Boolean));
  sourceList.forEach(row => {
    const rowId = (row?.rowId || '').toString();
    if (!rowId || knownIds.has(rowId)) return;
    baseRows.push(row);
    knownIds.add(rowId);
  });
  return baseRows;
}

function buildDryingRows(card, op) {
  const entry = getDryingEntry(card, op?.id || '');
  const sourceRows = buildDryingSourceRows(card, op);
  if (Array.isArray(entry?.dryingRows) && entry.dryingRows.length) {
    const existingRows = entry.dryingRows.map(row => ({
      rowId: (row?.rowId || '').toString(),
      sourceIssueOpId: (row?.sourceIssueOpId || '').toString(),
      sourceItemIndex: Number.isFinite(Number(row?.sourceItemIndex)) ? Number(row.sourceItemIndex) : 0,
      name: (row?.name || '').toString(),
      qty: normalizeDecimalDisplayInput(row?.qty || '') || (row?.qty || '').toString(),
      unit: (row?.unit || 'кг').toString(),
      isPowder: Boolean(row?.isPowder),
      dryQty: normalizeDecimalDisplayInput(row?.dryQty || '') || (row?.dryQty || '').toString(),
      dryResultQty: normalizeDecimalDisplayInput(row?.dryResultQty || '') || (row?.dryResultQty || '').toString(),
      status: (row?.status || 'NOT_STARTED').toString(),
      startedAt: row?.startedAt ?? null,
      finishedAt: row?.finishedAt ?? null,
      createdAt: (row?.createdAt || '').toString(),
      updatedAt: (row?.updatedAt || '').toString()
    }));
    return mergeDryingRows(existingRows, sourceRows);
  }
  return sourceRows;
}

function normalizeDryingTimestamp(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getDryingElapsedSeconds(row) {
  if (!row?.startedAt) return 0;
  const started = normalizeDryingTimestamp(row.startedAt);
  if (!Number.isFinite(started)) return 0;
  const finished = row.finishedAt ? normalizeDryingTimestamp(row.finishedAt) : NaN;
  const end = Number.isFinite(finished) ? finished : Date.now();
  return Math.max(0, Math.floor((end - started) / 1000));
}

function formatDryingTimerCell(row) {
  if (!row?.startedAt) return '—';
  const elapsed = getDryingElapsedSeconds(row);
  if ((row.status || '') === 'IN_PROGRESS') {
    return '<span class="wo-timer drying-timer" data-drying-started-at="' + escapeHtml(row.startedAt || '') + '">' + formatSecondsToHMS(elapsed) + '</span>';
  }
  return formatSecondsToHMS(elapsed);
}

function isValidDryingStartRow(row) {
  if (!row || (row.status || '') !== 'NOT_STARTED') return false;
  const dryQty = row.dryQty === '' ? '' : (row.dryQty || '0');
  if (!parseDecimalNormalized(dryQty)) return false;
  const positiveCmp = compareDecimalStrings(dryQty, '0');
  const totalCmp = compareDecimalStrings(row.qty || '0', dryQty);
  return positiveCmp != null && positiveCmp > 0 && totalCmp != null && totalCmp >= 0;
}

function renderDryingTable(rows, { readonly = false } = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const headHtml = '<thead><tr>' +
    '<th>№</th><th>Наименование материала</th><th>Кол-во.</th><th>Ед. изм.</th><th>Сушим</th><th>Сухой</th><th>Время сушки</th>' +
    (readonly ? '' : '<th>Действия</th>') +
    '</tr></thead>';
  const bodyHtml = safeRows.length
    ? safeRows.map((row, idx) => {
      const dryQty = normalizeDecimalDisplayInput(row?.dryQty || '') || (row?.dryQty || '').toString();
      const dryResultQty = normalizeDecimalDisplayInput(row?.dryResultQty || '') || (row?.dryResultQty || '').toString();
      let actionHtml = '';
      if (!readonly) {
        if ((row.status || '') === 'IN_PROGRESS') {
          actionHtml = '<button type="button" class="btn-small btn-secondary drying-row-action" data-action="finish" data-row-id="' + escapeHtml(row.rowId || '') + '">Закончить</button>';
        } else if ((row.status || '') === 'NOT_STARTED') {
          actionHtml = '<button type="button" class="btn-small btn-primary drying-row-action" data-action="start" data-row-id="' + escapeHtml(row.rowId || '') + '">Начать</button>';
        }
      }
      return '<tr data-row-id="' + escapeHtml(row?.rowId || '') + '" data-status="' + escapeHtml(row?.status || '') + '">' +
        '<td>' + (idx + 1) + '</td>' +
        '<td>' + escapeHtml(row?.name || '') + '</td>' +
        '<td>' + escapeHtml(row?.qty || '') + '</td>' +
        '<td>' + escapeHtml(row?.unit || 'кг') + '</td>' +
        '<td>' + (readonly || (row?.status || '') !== 'NOT_STARTED'
          ? escapeHtml(dryQty || '')
          : '<input type="text" class="material-issue-input drying-qty-input" data-row-id="' + escapeHtml(row?.rowId || '') + '" value="' + escapeHtml(dryQty || '') + '">') + '</td>' +
        '<td>' + escapeHtml(dryResultQty || '') + '</td>' +
        '<td>' + formatDryingTimerCell(row) + '</td>' +
        (readonly ? '' : '<td>' + actionHtml + '</td>') +
      '</tr>';
    }).join('')
    : '<tr><td colspan="' + (readonly ? '7' : '8') + '" class="muted">Нет порошка для сушки.</td></tr>';
  return '<table class="material-issue-table drying-table">' + headHtml + '<tbody>' + bodyHtml + '</tbody></table>';
}

function normalizeDocExtension(name) {
  const raw = (name || '').toString().trim();
  if (!raw) return '';
  const parts = raw.split('.');
  if (parts.length < 2) return '';
  return '.' + parts.pop().toLowerCase();
}

function buildDocPrefixedName(identifier, originalName) {
  const prefix = (identifier || '').toString().trim() || 'ХА';
  const base = (originalName || '').toString().trim() || 'file';
  return prefix + '_' + base;
}

function renderWorkspaceTransferDocsList() {
  const listEl = document.getElementById('workspace-transfer-docs-list');
  if (!listEl) return;
  if (!workspaceTransferDocFiles.length) {
    listEl.classList.add('muted');
    listEl.textContent = 'Файлы не выбраны.';
    return;
  }
  listEl.classList.remove('muted');
  listEl.innerHTML = '<ul class="workspace-transfer-docs-items">' +
    workspaceTransferDocFiles.map((entry, idx) => {
      const name = entry.displayName || buildDocPrefixedName(entry.identifier, entry.originalName);
      const size = formatBytes(entry.size || entry.file?.size || 0);
      return '<li class="workspace-transfer-docs-item">' +
        '<span>' + escapeHtml(name) + ' (' + escapeHtml(size) + ')</span>' +
        '<button type="button" class="btn-small btn-delete" data-doc-index="' + idx + '">🗑️</button>' +
      '</li>';
    }).join('') +
  '</ul>';
}

function toggleWorkspaceTransferDocs(isVisible) {
  const wrap = document.getElementById('workspace-transfer-docs');
  if (!wrap) return;
  wrap.classList.toggle('hidden', !isVisible);
  if (isVisible) renderWorkspaceTransferDocsList();
}

function collectExistingDocNames(card) {
  const existing = new Set();
  (card?.attachments || []).forEach(file => {
    if (!file || !file.name) return;
    if ((file.category || '') !== 'PARTS_DOCS') return;
    existing.add(file.name.toLowerCase());
  });
  return existing;
}

function addWorkspaceTransferDocFiles(fileList) {
  if (!fileList || !fileList.length) return;
  const card = getWorkspaceTransferCard();
  const existingNames = collectExistingDocNames(card);
  const selectedNames = new Set(workspaceTransferDocFiles.map(entry => (entry.displayName || '').toLowerCase()));
  const identifier = workspaceTransferDocIdentifier || 'ХА';

  Array.from(fileList).forEach(file => {
    const ext = normalizeDocExtension(file.name);
    if (DOC_ALLOWED_EXTENSIONS.size && !DOC_ALLOWED_EXTENSIONS.has(ext)) {
      showToast('Тип файла не поддерживается: ' + file.name);
      return;
    }
    if (file.size > ATTACH_MAX_SIZE) {
      showToast('Файл ' + file.name + ' превышает лимит ' + formatBytes(ATTACH_MAX_SIZE));
      return;
    }
    const displayName = buildDocPrefixedName(identifier, file.name);
    const key = displayName.toLowerCase();
    if (selectedNames.has(key) || existingNames.has(key)) {
      showToast('Файл с именем ' + displayName + ' уже добавлен.');
      return;
    }
    workspaceTransferDocFiles.push({
      file,
      identifier,
      originalName: file.name,
      displayName,
      size: file.size
    });
    selectedNames.add(key);
  });
  renderWorkspaceTransferDocsList();
}

function buildWorkspaceTransferItemsLabel() {
  if (!workspaceTransferContext) return '';
  const selectedIds = new Set(Array.from(workspaceTransferSelections.keys()));
  const items = workspaceTransferContext.items || [];
  const names = items
    .filter(item => selectedIds.has(item.id))
    .map(item => (workspaceTransferNameEdits.get(item.id) || item.displayName || item.qr || '').toString().trim())
    .filter(Boolean);
  return Array.from(new Set(names)).join(', ');
}

async function uploadWorkspaceTransferDocuments(options = {}) {
  if (!workspaceTransferContext) return false;
  if (!workspaceTransferDocFiles.length) return true;
  const refreshWorkspaceDocumentsContext = async (reason, message) => {
    showToast(message || 'Данные уже изменились. Контекст обновлён.');
    if (workspaceTransferContext?.isDocuments) {
      workspaceTransferContext.__documentsRefreshPending = true;
    }
    const staleCardId = trimToString(workspaceTransferContext?.cardId || '');
    if (staleCardId && typeof fetchCardsCoreCard === 'function') {
      try {
        const previousCard = typeof findCardEntityByKey === 'function'
          ? cloneCard(findCardEntityByKey(staleCardId))
          : null;
        const refreshedCard = await fetchCardsCoreCard(staleCardId, {
          force: true,
          reason: 'workspace-transfer-documents:' + String(reason || 'refresh').trim()
        });
        if (refreshedCard && refreshedCard.id) {
          if (typeof applyFilesPayloadToCard === 'function') {
            applyFilesPayloadToCard(refreshedCard.id, { card: refreshedCard });
          }
          if (typeof patchCardFamilyAfterUpsert === 'function') {
            patchCardFamilyAfterUpsert(refreshedCard, previousCard);
          }
          if (typeof refreshWorkspaceUiAfterAction === 'function') {
            refreshWorkspaceUiAfterAction('workspace-transfer-documents-refresh');
          }
          if (typeof syncWorkspaceTransferContextFromCards === 'function') {
            syncWorkspaceTransferContextFromCards();
          }
          if (workspaceTransferContext && typeof renderWorkspaceTransferList === 'function') {
            renderWorkspaceTransferList();
          }
          return false;
        }
      } catch (err) {
        console.warn('[CONFLICT] workspace transfer documents card refresh failed', {
          reason,
          cardId: staleCardId,
          error: err?.message || err
        });
      }
    }
    if (typeof forceRefreshWorkspaceProductionData === 'function') {
      try {
        await forceRefreshWorkspaceProductionData('workspace-transfer-documents:' + String(reason || 'refresh').trim());
        if (typeof syncWorkspaceTransferContextFromCards === 'function') {
          syncWorkspaceTransferContextFromCards();
        }
      } catch (err) {
        console.warn('[CONFLICT] workspace transfer documents refresh failed', {
          reason,
          error: err?.message || err
        });
      }
    }
    return false;
  };
  const card = getWorkspaceTransferCard();
  if (!card) {
    return refreshWorkspaceDocumentsContext(
      'missing-card',
      'Маршрутная карта уже была изменена другим пользователем. Данные обновлены.'
    );
  }
  const op = (card.operations || []).find(item => item.id === workspaceTransferContext.opId) || null;
  if (!op) {
    return refreshWorkspaceDocumentsContext(
      'missing-operation',
      'Операция уже была изменена другим пользователем. Данные обновлены.'
    );
  }

  const operationLabel = (op.opCode && op.opName) ? (op.opCode + ' ' + op.opName) : (op.opName || op.opCode || '');
  const itemsLabel = trimToString(options.itemsLabel || buildWorkspaceTransferItemsLabel());
  const existingNames = collectExistingDocNames(card);
  const previousCard = typeof cloneCard === 'function' ? cloneCard(card) : null;
  const routeContext = typeof captureClientWriteRouteContext === 'function'
    ? captureClientWriteRouteContext()
    : { fullPath: (window.location.pathname + window.location.search) || '/workspace' };
  let uploadedCount = 0;
  let lastFailureMessage = '';
  let conflictDetected = false;

  for (const entry of workspaceTransferDocFiles) {
    const file = entry.file;
    if (!file) continue;
    const name = entry.displayName || buildDocPrefixedName(entry.identifier, entry.originalName || file.name);
    if (existingNames.has(name.toLowerCase())) {
      showToast('Файл с именем ' + name + ' уже существует.');
      continue;
    }
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    try {
      const expectedRev = typeof getCardExpectedRev === 'function'
        ? getCardExpectedRev(card)
        : ((Number(card?.rev) > 0) ? Number(card.rev) : 1);
      const request = typeof apiFetch === 'function' ? apiFetch : fetch;
      const result = await runClientWriteRequest({
        action: 'card-files:upload-workspace-transfer',
        writePath: '/api/cards/' + encodeURIComponent(String(card.id || '').trim()) + '/files',
        entity: 'card',
        entityId: card.id,
        expectedRev,
        routeContext,
        request: () => request('/api/cards/' + encodeURIComponent(card.id) + '/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expectedRev,
            name,
            type: file.type || 'application/octet-stream',
            content: dataUrl,
            size: file.size,
            category: 'PARTS_DOCS',
            scope: 'CARD',
            operationLabel,
            itemsLabel,
            opId: op.id,
            opCode: op.opCode || '',
            opName: op.opName || ''
          })
        }),
        defaultErrorMessage: 'Не удалось загрузить файл ' + name,
        defaultConflictMessage: 'Карточка уже была изменена другим пользователем. Данные обновлены.',
        onSuccess: async ({ payload }) => {
          if (typeof applyFilesPayloadToCard === 'function') {
            applyFilesPayloadToCard(card.id, payload);
          }
          uploadedCount += 1;
          existingNames.add(name.toLowerCase());
        },
        onConflict: async ({ payload, message }) => {
          if (typeof applyFilesPayloadToCard === 'function') {
            applyFilesPayloadToCard(card.id, payload);
          }
          conflictDetected = true;
          lastFailureMessage = message || 'Карточка уже была изменена другим пользователем. Данные обновлены.';
          showToast(lastFailureMessage);
        },
        onError: async ({ message }) => {
          lastFailureMessage = message || ('Не удалось загрузить файл ' + name);
          showToast(lastFailureMessage);
        },
        conflictRefresh: async ({ routeContext: conflictRouteContext }) => {
          if (typeof refreshCardFilesMutationAfterConflict === 'function') {
            await refreshCardFilesMutationAfterConflict(card.id, {
              routeContext: conflictRouteContext || routeContext,
              reason: 'workspace-transfer-doc-upload-conflict'
            });
          }
        }
      });
      if (!result.ok) {
        if (result.isConflict) {
          break;
        }
        continue;
      }
    } catch (err) {
      lastFailureMessage = 'Не удалось загрузить файл ' + name;
      showToast(lastFailureMessage);
    }
  }

  if (uploadedCount) {
    const updatedCard = getWorkspaceTransferCard() || card;
    if (updatedCard && typeof patchCardFamilyAfterUpsert === 'function') {
      patchCardFamilyAfterUpsert(updatedCard, previousCard);
    }
    if (getWorkspaceActionSource() === 'workspace') {
      suppressWorkspaceLiveRefresh();
      refreshWorkspaceUiAfterAction('workspace-documents-upload');
    } else {
      renderEverything();
    }
    updateAttachmentCounters(updatedCard.id || card.id);
    updateTableAttachmentCount(updatedCard.id || card.id);
    showToast('Документы загружены');
    return true;
  }

  if (!conflictDetected && !lastFailureMessage) {
    showToast('Не удалось загрузить документы.');
  }
  return false;
}

function ensureOpCommentsArray(op) {
  if (!op) return [];
  if (!Array.isArray(op.comments)) op.comments = [];
  return op.comments;
}

function isProductionExecutionCommentRoute() {
  const path = window.location.pathname || '';
  return path === '/workspace'
    || path.startsWith('/workspace/')
    || path === '/workorders'
    || path.startsWith('/workorders/')
    || path === '/production/delayed'
    || path.startsWith('/production/delayed/')
    || path === '/production/defects'
    || path.startsWith('/production/defects/');
}

async function submitProductionExecutionOpComment({ cardId, opId, text }) {
  const { card, op } = getWorkspaceCardAndOperation(cardId, opId);
  const writePath = '/api/production/operation/comment';
  const flowVersion = Number.isFinite(card?.flow?.version) ? card.flow.version : 1;
  if (!card || !op) {
    showToast('Операция уже недоступна. Данные обновлены.');
    await refreshWorkspaceExecutionAfterLocalInvalid({
      action: 'production-operation-comment',
      writePath,
      cardId,
      opId,
      expectedFlowVersion: flowVersion,
      reason: 'missing-local-context'
    });
    return false;
  }
  const result = await runProductionExecutionWriteRequest({
    action: 'production-operation-comment',
    writePath,
    cardId,
    expectedFlowVersion: flowVersion,
    routeContext: captureClientWriteRouteContext(),
    defaultErrorMessage: 'Не удалось добавить комментарий.',
    defaultConflictMessage: 'Данные операции уже изменились. Данные обновлены, попробуйте добавить комментарий снова.',
    request: () => apiFetch(writePath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cardId,
        opId,
        text,
        expectedFlowVersion: flowVersion,
        source: getWorkspaceActionSource()
      })
    })
  });
  if (!result.ok) {
    showToast(getWorkspaceExecutionResultMessage(result, 'Не удалось добавить комментарий.'));
    return false;
  }
  const payload = result.payload || {};
  const savedComment = payload.comment && typeof payload.comment === 'object'
    ? payload.comment
    : {
      id: genId('cmt'),
      text,
      author: currentUser?.name || 'Пользователь',
      createdAt: Date.now()
    };
  const current = getWorkspaceCardAndOperation(cardId, opId);
  if (current.card && current.op) {
    ensureOpCommentsArray(current.op).push(savedComment);
    syncWorkspaceLocalFlowVersion(current.card, Number.isFinite(payload.flowVersion) ? payload.flowVersion : flowVersion + 1);
  }
  if (typeof refreshProductionIssueRouteAfterMutation === 'function'
    && ((window.location.pathname || '').startsWith('/production/delayed') || (window.location.pathname || '').startsWith('/production/defects'))) {
    await refreshProductionIssueRouteAfterMutation('operation-comment', { routeContext: result.routeContext });
  } else if (isWorkordersDerivedViewRoute()) {
    await refreshWorkordersProductionDataPreservingRoute('workorders-operation-comment');
  } else if (!refreshWorkspaceUiAfterAction('production-operation-comment')) {
    await forceRefreshWorkspaceProductionData('production-operation-comment');
  }
  showToast('Комментарий добавлен.');
  return true;
}

function renderOpCommentsList() {
  const listEl = document.getElementById('op-comments-list');
  const subtitleEl = document.getElementById('op-comments-subtitle');
  if (!listEl) return;
  if (!opCommentsContext) {
    listEl.innerHTML = '';
    if (subtitleEl) subtitleEl.textContent = '';
    return;
  }
  const { cardId, opId } = opCommentsContext;
  const card = cards.find(c => c.id === cardId);
  const op = card ? (card.operations || []).find(o => o.id === opId) : null;
  if (!card || !op) {
    listEl.innerHTML = '<div class="muted">Нет данных.</div>';
    if (subtitleEl) subtitleEl.textContent = '';
    return;
  }
  if (subtitleEl) {
    subtitleEl.textContent = (formatCardTitle(card) || 'Маршрутная карта') + ' · ' + (op.opName || op.opCode || 'Операция');
  }
  const comments = ensureOpCommentsArray(op);
  if (!comments.length) {
    listEl.innerHTML = '<div class="muted">Комментариев пока нет.</div>';
    return;
  }
  listEl.innerHTML = comments.map(entry => {
    const author = (entry && entry.author) ? entry.author : 'Пользователь';
    const ts = entry && (entry.createdAt || entry.ts) ? new Date(entry.createdAt || entry.ts).toLocaleString() : '';
    const text = entry && entry.text ? entry.text : '';
    return '<div class="op-comments-item">' +
      '<div class="op-comments-meta">' + escapeHtml(author) + (ts ? ' · ' + escapeHtml(ts) : '') + '</div>' +
      '<div>' + escapeHtml(text) + '</div>' +
    '</div>';
  }).join('');
  listEl.scrollTop = listEl.scrollHeight;
}

function openOpCommentsModal(cardId, opId) {
  const modal = document.getElementById('op-comments-modal');
  if (!modal) return;
  opCommentsContext = { cardId, opId };
  renderOpCommentsList();
  const input = document.getElementById('op-comments-input');
  const sendBtn = document.getElementById('op-comments-send');
  const readonly = typeof isCurrentTabReadonly === 'function' ? isCurrentTabReadonly() : false;
  if (input) {
    input.value = '';
    input.readOnly = readonly;
    input.placeholder = readonly ? 'Режим просмотра' : '';
  }
  if (sendBtn) {
    sendBtn.disabled = readonly;
    sendBtn.classList.toggle('hidden', readonly);
  }
  modal.classList.remove('hidden');
  const listEl = document.getElementById('op-comments-list');
  if (listEl) {
    requestAnimationFrame(() => {
      listEl.scrollTop = listEl.scrollHeight;
    });
  }
  if (readonly) {
    document.getElementById('op-comments-close')?.focus();
  } else if (input) {
    input.focus();
  }
}

function closeOpCommentsModal() {
  const modal = document.getElementById('op-comments-modal');
  if (modal) modal.classList.add('hidden');
  opCommentsContext = null;
}

function setupOpCommentsModal() {
  const modal = document.getElementById('op-comments-modal');
  if (!modal) return;
  const closeBtn = document.getElementById('op-comments-close');
  const cancelBtn = document.getElementById('op-comments-cancel');
  const sendBtn = document.getElementById('op-comments-send');
  const input = document.getElementById('op-comments-input');

  if (closeBtn) closeBtn.addEventListener('click', () => closeOpCommentsModal());
  if (cancelBtn) cancelBtn.addEventListener('click', () => closeOpCommentsModal());
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeOpCommentsModal();
  });
  if (sendBtn) {
    sendBtn.addEventListener('click', async () => {
      if (!opCommentsContext) return;
      if (typeof isCurrentTabReadonly === 'function' && isCurrentTabReadonly()) {
        showToast('Для вашей роли добавление комментариев недоступно');
        return;
      }
      const textRaw = input ? input.value : '';
      const text = (textRaw || '').toString().trim();
      if (!text) return;
      const { cardId, opId } = opCommentsContext;
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!card || !op) return;
      if (isProductionExecutionCommentRoute()) {
        sendBtn.disabled = true;
        try {
          const saved = await submitProductionExecutionOpComment({ cardId, opId, text });
          if (saved) {
            if (input) input.value = '';
            renderOpCommentsList();
          }
        } finally {
          sendBtn.disabled = false;
        }
        return;
      }
      const comments = ensureOpCommentsArray(op);
      comments.push({
        id: genId('cmt'),
        text,
        author: currentUser?.name || 'Пользователь',
        createdAt: Date.now()
      });
      saveData();
      renderEverything();
      if (input) input.value = '';
      renderOpCommentsList();
    });
  }
}

function setupItemsModal() {
  const modal = document.getElementById('items-modal');
  if (!modal) return;
  const closeBtn = document.getElementById('items-modal-close');
  const cancelBtn = document.getElementById('items-modal-cancel');
  const tableWrapper = document.getElementById('items-log-table-wrapper');
  if (closeBtn) closeBtn.addEventListener('click', () => closeItemsModal());
  if (cancelBtn) cancelBtn.addEventListener('click', () => closeItemsModal());
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeItemsModal();
  });
  if (tableWrapper && tableWrapper.dataset.bound !== 'true') {
    tableWrapper.dataset.bound = 'true';
    tableWrapper.addEventListener('click', (event) => {
      const th = event.target.closest('th.th-sortable');
      if (!th || !tableWrapper.contains(th)) return;
      const key = th.getAttribute('data-sort-key') || '';
      if (!key) return;
      if (itemsModalSortKey === key) {
        itemsModalSortDir = itemsModalSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        itemsModalSortKey = key;
        itemsModalSortDir = 'asc';
      }
      renderItemsLogTable();
    });
  }
}

function openItemsModal(cardId) {
  const modal = document.getElementById('items-modal');
  if (!modal) return;
  const card = cards.find(c => c && c.id === cardId);
  if (!card) return;
  ensureCardFlow(card);
  itemsModalCardId = card.id;
  itemsModalSortKey = 'date';
  itemsModalSortDir = 'desc';
  renderItemsModal(card);
  modal.classList.remove('hidden');
}

function closeItemsModal() {
  const modal = document.getElementById('items-modal');
  if (modal) modal.classList.add('hidden');
  itemsModalCardId = null;
  itemsModalRows = [];
}

function getLastOperationForItems(card) {
  const ops = Array.isArray(card?.operations) ? card.operations : [];
  const filtered = ops.filter(op => op && !op.isSamples);
  if (!filtered.length) return null;
  const sorted = filtered
    .map((op, index) => ({
      op,
      index,
      order: Number.isFinite(op?.order) ? op.order : index
    }))
    .sort((a, b) => (a.order - b.order) || (a.index - b.index));
  return sorted[sorted.length - 1].op || null;
}

function getPlannedItemNames(card) {
  const raw = Array.isArray(card?.itemSerials)
    ? card.itemSerials
    : normalizeSerialInput(card?.itemSerials || '');
  return (raw || [])
    .map(value => trimToString(value))
    .filter(Boolean);
}

function getActualItemNames(card) {
  const items = Array.isArray(card?.flow?.items) ? card.flow.items : [];
  const names = [];
  const seen = new Set();
  items.forEach(item => {
    const status = trimToString(item?.current?.status || 'PENDING').toUpperCase();
    const name = trimToString(item?.displayName || item?.id || '');
    if (!name || seen.has(name)) return;
    if (!['PENDING', 'GOOD', 'DEFECT', 'DELAYED'].includes(status)) return;
    seen.add(name);
    names.push(name);
  });
  return names;
}

function buildItemsNameListHtml(names, emptyText) {
  const items = Array.isArray(names) ? names.filter(Boolean) : [];
  if (!items.length) {
    return '<div class="muted">' + escapeHtml(emptyText || 'Нет данных.') + '</div>';
  }
  return '<ul class="items-summary-name-list">' +
    items.map(name => '<li>' + escapeHtml(name) + '</li>').join('') +
    '</ul>';
}

function buildItemsSummaryHtml(card, { interactive = false } = {}) {
  const plannedValue = resolveCardField(card, 'batchSize');
  const plannedQty = toSafeCount(plannedValue);
  const plannedNames = getPlannedItemNames(card);
  const actualNames = getActualItemNames(card);
  const items = Array.isArray(card?.flow?.items) ? card.flow.items : [];
  const uniqueMap = new Map();
  items.forEach(item => {
    const key = trimToString(item?.id || item?.qr || '') || trimToString(item?.displayName || '');
    if (!key || uniqueMap.has(key)) return;
    uniqueMap.set(key, { item });
  });

  let actualQty = 0;
  let doneQty = 0;
  let delayedQty = 0;
  let defectQty = 0;
  let disposedQty = 0;
  uniqueMap.forEach(({ item }) => {
    const status = trimToString(item?.current?.status || 'PENDING').toUpperCase();
    const finalStatus = trimToString(item?.finalStatus || '').toUpperCase();
    if (status === 'PENDING' || status === 'GOOD' || status === 'DEFECT' || status === 'DELAYED') {
      actualQty += 1;
    }
    if (finalStatus === 'GOOD') doneQty += 1;
    if (status === 'DELAYED') delayedQty += 1;
    if (status === 'DEFECT') defectQty += 1;
    if (isFlowItemDisposed(item)) disposedQty += 1;
  });

  const plannedLine = interactive
    ? '<details class="items-summary-detail">' +
        '<summary class="items-summary-line"><strong>Запланированное количество изделий:</strong> ' + plannedQty + '</summary>' +
        '<div class="items-summary-detail-body">' + buildItemsNameListHtml(plannedNames, 'Плановые изделия не указаны.') + '</div>' +
      '</details>'
    : '<div class="items-summary-line"><strong>Запланированное количество изделий:</strong> ' + plannedQty + '</div>';
  const actualLine = interactive
    ? '<details class="items-summary-detail">' +
        '<summary class="items-summary-line"><strong>Фактическое количество изделий:</strong> ' + actualQty + '</summary>' +
        '<div class="items-summary-detail-body">' + buildItemsNameListHtml(actualNames, 'Фактические изделия отсутствуют.') + '</div>' +
      '</details>'
    : '<div class="items-summary-line"><strong>Фактическое количество изделий:</strong> ' + actualQty + '</div>';
  return (
    plannedLine +
    actualLine +
    '<div class="items-summary-line items-summary-done"><strong>Сделано изделий:</strong> ' + doneQty + '</div>' +
    '<div class="items-summary-line items-summary-delayed"><strong>Задержано изделий:</strong> ' + delayedQty + '</div>' +
    '<div class="items-summary-line items-summary-defect"><strong>Забраковано изделий:</strong> ' + defectQty + '</div>' +
    '<div class="items-summary-line items-summary-disposed"><strong>Утилизировано изделий:</strong> ' + disposedQty + '</div>'
  );
}

function buildItemsSummary(card) {
  const summaryEl = document.getElementById('items-summary');
  if (!summaryEl) return;
  summaryEl.innerHTML = buildItemsSummaryHtml(card);
}

function buildItemsLogRows(card) {
  const rows = [];
  const items = Array.isArray(card?.flow?.items) ? card.flow.items : [];
  const archived = Array.isArray(card?.flow?.archivedItems) ? card.flow.archivedItems : [];
  const archivedItems = archived.filter(item => {
    const kind = trimToString(item?.kind || '').toUpperCase();
    return !kind || kind === 'ITEM';
  });
  const allItems = items.concat(archivedItems);
  const opMap = new Map();
  (card.operations || []).forEach(op => {
    const id = (op?.id || op?.opId || '').toString().trim();
    if (id) opMap.set(id, op);
  });
  const lastOp = getLastOperationForItems(card);
  const lastOpCode = trimToString(lastOp?.opCode || '');
  const lastOpName = trimToString(lastOp?.opName || lastOp?.name || '');

  const statusTargets = new Set(['DEFECT', 'DELAYED', 'DISPOSED']);
  allItems.forEach(item => {
    const name = trimToString(item?.displayName || item?.id || '');
    if (!name) return;
    const history = Array.isArray(item?.history) ? item.history.slice() : [];
    history.sort((a, b) => (a?.at || 0) - (b?.at || 0));
    let prevStatus = 'PENDING';
    let prevOpId = '';
    const targetInfo = item?.archivedReason === 'MOVED' ? item?.archivedTarget : null;
    const targetName = trimToString(targetInfo?.name || '');
    const targetRouteNo = trimToString(targetInfo?.routeCardNumber || '');
    const targetLabel = targetName && targetRouteNo
      ? `${targetName} (${targetRouteNo})`
      : (targetName || targetRouteNo || trimToString(targetInfo?.label || ''));
    const movedLabel = targetLabel ? `Перемещено в «${targetLabel}»` : '';
    const itemRows = [];
    history.forEach(entry => {
      const nextStatus = trimToString(entry?.status || '');
      if (!nextStatus) return;
      const entryOpId = trimToString(entry?.opId || '');
      const effectiveFrom = entryOpId && entryOpId !== prevOpId ? 'PENDING' : prevStatus;
      const isReturn = nextStatus === 'PENDING' && trimToString(entry?.comment || '') === 'Возврат';
      if (isReturn) {
        const op = opMap.get(entryOpId) || null;
        const opCode = trimToString(entry?.opCode || op?.opCode || '');
        const opName = trimToString(op?.opName || op?.name || '');
        itemRows.push({
          name,
          opCode,
          opName,
          fromStatus: 'DELAYED',
          toStatus: '',
          date: Number(entry?.at) || 0,
          author: trimToString(entry?.createdBy || '') || '—'
        });
      } else if (statusTargets.has(nextStatus)) {
        const op = opMap.get(entryOpId) || null;
        const opCode = trimToString(entry?.opCode || op?.opCode || '');
        const opName = trimToString(op?.opName || op?.name || '');
        itemRows.push({
          name,
          opCode,
          opName,
          fromStatus: effectiveFrom,
          toStatus: nextStatus,
          date: Number(entry?.at) || 0,
          author: trimToString(entry?.createdBy || '') || '—'
        });
      }
      prevStatus = nextStatus;
      prevOpId = entryOpId || prevOpId;
    });
    if (movedLabel && itemRows.length) {
      const lastRow = itemRows[itemRows.length - 1];
      const baseDate = Number(lastRow.date) || 0;
      const archivedAt = Number(item?.archivedAt) || 0;
      const moveEntry = history.find(entry => trimToString(entry?.comment || '') === 'Перемещение в МК-РЕМ');
      const moveAt = Number(moveEntry?.at) || 0;
      const moveDate = Math.max(baseDate + 1, moveAt || archivedAt);
      itemRows.push({
        ...lastRow,
        fromStatus: lastRow.toStatus || lastRow.fromStatus,
        toStatus: movedLabel,
        date: moveDate,
        author: trimToString(moveEntry?.createdBy || '') || lastRow.author
      });
    }

    const finalStatus = trimToString(item?.finalStatus || '').toUpperCase();
    if (finalStatus === 'GOOD') {
      const lastEntry = history.length ? history[history.length - 1] : null;
      itemRows.push({
        name,
        opCode: lastOpCode,
        opName: lastOpName,
        fromStatus: '',
        toStatus: 'GOOD',
        date: Number(lastEntry?.at || item?.current?.updatedAt) || 0,
        author: trimToString(lastEntry?.createdBy || '') || '—'
      });
    }

    rows.push(...itemRows);
  });

  return rows;
}

function buildItemsLogTableHtml(rows, { sortKey = 'date', sortDir = 'desc' } = {}) {
  const sortedRows = sortItemsLogRows(rows, sortKey, sortDir);
  const header =
    '<table>' +
      '<thead><tr>' +
        '<th class="th-sortable" data-sort-key="name">Название изделия</th>' +
        '<th class="th-sortable" data-sort-key="opCode">Код операции</th>' +
        '<th class="th-sortable" data-sort-key="opName">Наименование операции</th>' +
        '<th class="th-sortable" data-sort-key="fromStatus">Начальный статус</th>' +
        '<th class="th-sortable" data-sort-key="toStatus">Полученный статус</th>' +
        '<th class="th-sortable" data-sort-key="date">Дата и время</th>' +
        '<th class="th-sortable" data-sort-key="author">Автор</th>' +
      '</tr></thead>';
  const body = sortedRows.length
    ? '<tbody>' + sortedRows.map(row => {
      const fromInfo = formatFlowItemStatusLabel(row.fromStatus);
      const toInfo = formatFlowItemStatusLabel(row.toStatus);
      const fromLabel = row.fromStatus === ''
        ? ''
        : (fromInfo?.text || (row.fromStatus === 'PENDING' ? '' : (row.fromStatus || '—')));
      const toLabel = row.toStatus === ''
        ? ''
        : (toInfo?.text || (row.toStatus === 'PENDING' ? '' : (row.toStatus || '—')));
      const fromClass = statusToItemsClass(row.fromStatus);
      const toClass = statusToItemsClass(row.toStatus);
      const dateText = row.date ? new Date(row.date).toLocaleString() : '—';
      return '<tr>' +
        '<td>' + escapeHtml(row.name) + '</td>' +
        '<td>' + escapeHtml(row.opCode || '—') + '</td>' +
        '<td>' + escapeHtml(row.opName || '—') + '</td>' +
        '<td>' + (fromClass ? '<span class="' + fromClass + '">' + escapeHtml(fromLabel) + '</span>' : escapeHtml(fromLabel)) + '</td>' +
        '<td>' + (toClass ? '<span class="' + toClass + '">' + escapeHtml(toLabel) + '</span>' : escapeHtml(toLabel)) + '</td>' +
        '<td>' + escapeHtml(dateText) + '</td>' +
        '<td>' + escapeHtml(row.author || '—') + '</td>' +
      '</tr>';
    }).join('') + '</tbody>'
    : '<tbody><tr><td colspan="7" class="muted">Нет данных.</td></tr></tbody>';
  return header + body + '</table>';
}

function renderItemsLogTable() {
  const wrapper = document.getElementById('items-log-table-wrapper');
  if (!wrapper) return;
  wrapper.innerHTML = buildItemsLogTableHtml(itemsModalRows, {
    sortKey: itemsModalSortKey,
    sortDir: itemsModalSortDir
  });
  updateTableSortUI(wrapper, itemsModalSortKey, itemsModalSortDir);
}

function sortItemsLogRows(rows, key, dir) {
  const sorted = (rows || []).slice();
  const factor = dir === 'desc' ? -1 : 1;
  sorted.sort((a, b) => {
    const valA = a[key];
    const valB = b[key];
    if (key === 'date') {
      return ((valA || 0) - (valB || 0)) * factor;
    }
    const textA = (valA == null ? '' : String(valA)).toLowerCase();
    const textB = (valB == null ? '' : String(valB)).toLowerCase();
    if (textA < textB) return -1 * factor;
    if (textA > textB) return 1 * factor;
    return 0;
  });
  return sorted;
}

function renderItemsModal(card) {
  const titleEl = document.getElementById('items-modal-title');
  const number = trimToString(card.routeCardNumber || '');
  if (titleEl) {
    titleEl.textContent = number
      ? `Изделия «${number}»`
      : 'Изделия';
  }
  buildItemsSummary(card);
  itemsModalRows = buildItemsLogRows(card);
  renderItemsLogTable();
}

function statusToItemsClass(status) {
  const normalized = trimToString(status || '').toUpperCase();
  if (normalized === 'PENDING') return 'items-status-pending';
  if (normalized === 'GOOD') return 'items-status-good';
  if (normalized === 'DELAYED') return 'items-status-delayed';
  if (normalized === 'DEFECT') return 'items-status-defect';
  if (normalized === 'DISPOSED') return 'items-status-disposed';
  return '';
}

const ITEMS_PAGE_FINAL_STATUS_SET = new Set(['GOOD', 'DELAYED', 'DEFECT', 'DISPOSED']);
const ITEMS_PAGE_APPROVED_STAGES = new Set([
  APPROVAL_STAGE_APPROVED,
  APPROVAL_STAGE_WAITING_INPUT_CONTROL,
  APPROVAL_STAGE_WAITING_PROVISION,
  APPROVAL_STAGE_PROVIDED,
  APPROVAL_STAGE_PLANNING,
  APPROVAL_STAGE_PLANNED
]);
const ITEMS_PAGE_TARGET_SCREENS = 2.5;
const ITEMS_PAGE_ESTIMATED_ROW_HEIGHT = 38;
const ITEMS_PAGE_MIN_ROWS = 18;
const ITEMS_PAGE_MAX_ROWS = 90;
const ITEMS_PAGE_ROUTE_CONFIG = {
  '/items': {
    route: '/items',
    permissionKey: 'items',
    pageTitle: 'Изделия',
    searchPlaceholder: 'Индивидуальный номер, QR-код, наименование, МК №, основание или фамилия',
    serialColumnLabel: 'Индивидуальный номер изделия',
    qrColumnLabel: 'QR-код изделия',
    paginationAriaLabel: 'Пагинация таблицы изделий',
    itemKind: 'ITEM',
    sampleType: ''
  },
  '/ok': {
    route: '/ok',
    permissionKey: 'ok',
    pageTitle: 'Образцы контрольные',
    searchPlaceholder: 'Индивидуальный номер, QR-код, наименование, МК №, основание или фамилия',
    serialColumnLabel: 'Индивидуальный номер образца',
    qrColumnLabel: 'QR-код образца',
    paginationAriaLabel: 'Пагинация таблицы образцов ОК',
    itemKind: 'SAMPLE',
    sampleType: 'CONTROL'
  },
  '/oc': {
    route: '/oc',
    permissionKey: 'oc',
    pageTitle: 'Образцы свидетели',
    searchPlaceholder: 'Индивидуальный номер, QR-код, наименование, МК №, основание или фамилия',
    serialColumnLabel: 'Индивидуальный номер образца',
    qrColumnLabel: 'QR-код образца',
    paginationAriaLabel: 'Пагинация таблицы образцов ОС',
    itemKind: 'SAMPLE',
    sampleType: 'WITNESS'
  }
};

function createItemsPageDefaultState() {
  return {
    searchTerm: '',
    sortKey: 'date',
    sortDir: 'desc',
    currentPage: 1,
    statusFilter: 'ALL',
    dateFrom: '',
    dateTo: ''
  };
}

function normalizeItemsPageRoute(path = '') {
  const cleanPath = trimToString((path || '').split('?')[0].split('#')[0]);
  return ITEMS_PAGE_ROUTE_CONFIG[cleanPath] ? cleanPath : ITEMS_PAGE_ROUTE_DEFAULT;
}

function isItemsPageRoute(path = '') {
  const cleanPath = trimToString((path || '').split('?')[0].split('#')[0]);
  return Boolean(ITEMS_PAGE_ROUTE_CONFIG[cleanPath]);
}

function getItemsPageRouteContextPath(path = '') {
  const directPath = trimToString(path || '');
  if (isItemsPageRoute(directPath)) return directPath;
  const renderPath = trimToString(window.__routeRenderPath || '');
  if (isItemsPageRoute(renderPath)) return renderPath;
  const appRoute = trimToString(appState?.route || '');
  if (isItemsPageRoute(appRoute)) return appRoute;
  const locationPath = trimToString(window.location.pathname || '');
  if (isItemsPageRoute(locationPath)) return locationPath;
  return ITEMS_PAGE_ROUTE_DEFAULT;
}

function getItemsPageConfig(path = '') {
  return ITEMS_PAGE_ROUTE_CONFIG[normalizeItemsPageRoute(getItemsPageRouteContextPath(path))] || ITEMS_PAGE_ROUTE_CONFIG[ITEMS_PAGE_ROUTE_DEFAULT];
}

function ensureItemsPageRouteState(route = '') {
  const normalizedRoute = normalizeItemsPageRoute(getItemsPageRouteContextPath(route));
  if (!itemsPageRouteState[normalizedRoute]) {
    itemsPageRouteState[normalizedRoute] = createItemsPageDefaultState();
  }
  return itemsPageRouteState[normalizedRoute];
}

function loadItemsPageRouteState(route = '') {
  const normalizedRoute = normalizeItemsPageRoute(getItemsPageRouteContextPath(route));
  const state = ensureItemsPageRouteState(normalizedRoute);
  itemsPageActiveRoute = normalizedRoute;
  itemsPageSearchTerm = state.searchTerm || '';
  itemsPageSortKey = state.sortKey || 'date';
  itemsPageSortDir = state.sortDir || 'desc';
  itemsPageCurrentPage = Number.isFinite(Number(state.currentPage)) ? Math.max(1, parseInt(state.currentPage, 10) || 1) : 1;
  itemsPageStatusFilter = state.statusFilter || 'ALL';
  itemsPageDateFrom = state.dateFrom || '';
  itemsPageDateTo = state.dateTo || '';
  return state;
}

function saveItemsPageRouteState(route = itemsPageActiveRoute) {
  const normalizedRoute = normalizeItemsPageRoute(route);
  itemsPageRouteState[normalizedRoute] = {
    searchTerm: itemsPageSearchTerm || '',
    sortKey: itemsPageSortKey || 'date',
    sortDir: itemsPageSortDir || 'desc',
    currentPage: Number.isFinite(Number(itemsPageCurrentPage)) ? Math.max(1, parseInt(itemsPageCurrentPage, 10) || 1) : 1,
    statusFilter: itemsPageStatusFilter || 'ALL',
    dateFrom: itemsPageDateFrom || '',
    dateTo: itemsPageDateTo || ''
  };
  itemsPageActiveRoute = normalizedRoute;
}

function syncItemsPageRouteContext() {
  const routePath = getItemsPageRouteContextPath();
  return {
    config: getItemsPageConfig(routePath),
    state: loadItemsPageRouteState(routePath)
  };
}

function applyItemsPageConfigToUi(config = getItemsPageConfig()) {
  const titleEl = document.getElementById('items-page-title');
  if (titleEl) titleEl.textContent = config.pageTitle || 'Изделия';
  const searchInput = document.getElementById('items-search');
  if (searchInput) {
    searchInput.placeholder = config.searchPlaceholder || searchInput.placeholder || '';
  }
}

function getLastOperationForFlowKind(card, kind = 'ITEM', sampleType = '') {
  const ops = Array.isArray(card?.operations) ? card.operations : [];
  const sampleTypeNorm = normalizeSampleType(sampleType);
  const filtered = ops.filter(op => {
    if (!op) return false;
    if (kind === 'SAMPLE') {
      return Boolean(op.isSamples) && normalizeSampleType(op.sampleType) === sampleTypeNorm;
    }
    return !op.isSamples;
  });
  if (!filtered.length) return null;
  const sorted = filtered
    .map((op, index) => ({
      op,
      index,
      order: Number.isFinite(op?.order) ? op.order : index
    }))
    .sort((a, b) => (a.order - b.order) || (a.index - b.index));
  return sorted[sorted.length - 1].op || null;
}

function setupItemsPage() {
  const { config } = syncItemsPageRouteContext();
  const section = document.getElementById('items');
  if (!section) return;
  applyItemsPageConfigToUi(config);
  if (section.dataset.itemsPageSetup === 'true') {
    syncItemsPageFiltersUi();
    return;
  }
  section.dataset.itemsPageSetup = 'true';

  const searchInput = document.getElementById('items-search');
  if (searchInput) {
    searchInput.value = itemsPageSearchTerm || '';
    searchInput.addEventListener('input', event => {
      itemsPageSearchTerm = event.target.value || '';
      itemsPageCurrentPage = 1;
      saveItemsPageRouteState();
      renderItemsPage();
    });
  }

  const statusSelect = document.getElementById('items-status-filter');
  if (statusSelect) {
    statusSelect.value = itemsPageStatusFilter || 'ALL';
    syncItemsPageStatusFilterUi(statusSelect);
    statusSelect.addEventListener('change', event => {
      itemsPageStatusFilter = event.target.value || 'ALL';
      syncItemsPageStatusFilterUi(event.target);
      itemsPageCurrentPage = 1;
      saveItemsPageRouteState();
      renderItemsPage();
    });
  }

  const bindItemsPageDateFilter = (textInputId, nativeInputId, pickerBtnId, getValue, setValue) => {
    const textInput = document.getElementById(textInputId);
    const nativeInput = document.getElementById(nativeInputId);
    const pickerBtn = document.getElementById(pickerBtnId);
    syncItemsPageDateInputs(textInput, nativeInput, getValue());

    const applyIsoValue = (isoValue) => {
      setValue(isoValue || '');
      syncItemsPageDateInputs(textInput, nativeInput, isoValue || '');
      itemsPageCurrentPage = 1;
      saveItemsPageRouteState();
      renderItemsPage();
    };

    const applyTextValue = (rawValue) => {
      const trimmed = trimToString(rawValue || '');
      if (!trimmed) {
        applyIsoValue('');
        return;
      }
      const parsed = parseItemsPageDisplayDate(trimmed);
      if (!parsed) return;
      applyIsoValue(parsed);
    };

    if (textInput) {
      textInput.addEventListener('change', () => applyTextValue(textInput.value || ''));
      textInput.addEventListener('blur', () => applyTextValue(textInput.value || ''));
      textInput.addEventListener('input', () => {
        const trimmed = trimToString(textInput.value || '');
        if (!trimmed && getValue()) {
          applyIsoValue('');
          return;
        }
        const parsed = parseItemsPageDisplayDate(trimmed);
        if (!parsed || parsed === getValue()) return;
        setValue(parsed);
        if (nativeInput) nativeInput.value = parsed;
        itemsPageCurrentPage = 1;
        saveItemsPageRouteState();
        renderItemsPage();
      });
    }

    if (nativeInput) {
      nativeInput.addEventListener('change', () => applyIsoValue(nativeInput.value || ''));
    }

    if (pickerBtn && nativeInput) {
      pickerBtn.addEventListener('click', () => {
        if (typeof nativeInput.showPicker === 'function') {
          nativeInput.showPicker();
        } else {
          nativeInput.click();
        }
      });
    }
  };

  bindItemsPageDateFilter('', 'items-date-from-native', '', () => itemsPageDateFrom, value => { itemsPageDateFrom = value; });
  bindItemsPageDateFilter('', 'items-date-to-native', '', () => itemsPageDateTo, value => { itemsPageDateTo = value; });

  const wrapper = document.getElementById('items-table-wrapper');
  if (wrapper) {
    wrapper.addEventListener('click', event => {
      const pageBtn = event.target.closest('.items-page-pagination-btn[data-page]');
      if (pageBtn) {
        const nextPage = parseInt(pageBtn.getAttribute('data-page') || '', 10);
        if (Number.isFinite(nextPage) && nextPage > 0 && nextPage !== itemsPageCurrentPage) {
          itemsPageCurrentPage = nextPage;
          saveItemsPageRouteState();
          renderItemsPage();
        }
        return;
      }
      const th = event.target.closest('th.th-sortable[data-sort-key]');
      if (!th) return;
      const key = th.getAttribute('data-sort-key') || 'date';
      if (itemsPageSortKey === key) {
        itemsPageSortDir = itemsPageSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        itemsPageSortKey = key;
        itemsPageSortDir = key === 'date' ? 'desc' : 'asc';
      }
      itemsPageCurrentPage = 1;
      saveItemsPageRouteState();
      renderItemsPage();
    });

    wrapper.addEventListener('dblclick', event => {
      const cell = event.target.closest('.items-page-route-cell[data-route]');
      if (!cell) return;
      const route = trimToString(cell.getAttribute('data-route') || '');
      if (!route) return;
      event.preventDefault();
      event.stopPropagation();
      navigateToRoute(route);
    });
  }

  if (!window.__itemsPageResizeBound) {
    window.__itemsPageResizeBound = true;
    window.addEventListener('resize', () => {
      if (!isItemsPageRoute(window.location.pathname || '')) return;
      renderItemsPage();
    });
  }

  syncItemsPageFiltersUi();
}

function isItemsPageApprovedCard(card) {
  return Boolean(card && ITEMS_PAGE_APPROVED_STAGES.has(card.approvalStage));
}

function resolveItemsPageCardField(card, keys = []) {
  const current = card || {};
  const snapshot = current.initialSnapshot || {};
  for (const key of keys) {
    const currentValue = trimToString(current?.[key] || '');
    if (currentValue) return currentValue;
  }
  for (const key of keys) {
    const snapshotValue = trimToString(snapshot?.[key] || '');
    if (snapshotValue) return snapshotValue;
  }
  return '';
}

function resolveItemsPageCardMeta(card) {
  ensureCardMeta(card);
  return {
    itemName: resolveItemsPageCardField(card, ['itemName', 'name']),
    routeCardNumber: resolveItemsPageCardField(card, ['routeCardNumber', 'orderNo']),
    issuedBySurname: resolveItemsPageCardField(card, ['issuedBySurname']),
    workBasis: resolveItemsPageCardField(card, ['workBasis', 'contractNumber']),
    routeUrl: card?.archived ? getArchiveCardUrlByCard(card) : getWorkordersCardUrlByCard(card)
  };
}

function resolveItemsPageItemQrCode(item, card) {
  const fullQr = trimToString(item?.qr || '');
  if (fullQr) return fullQr;
  const shortQr = trimToString(item?.qrCode || '')
    || trimToString(extractItemQrCode(item?.qr || '', card?.qrId || '') || '')
    || trimToString(extractAnyItemQrCode(item?.qr || '') || '');
  if (!shortQr) return '';
  return trimToString(buildItemQr(card?.qrId || '', shortQr) || shortQr);
}

function formatItemsPageDate(ts) {
  const value = Number(ts) || 0;
  if (!value) return '—';
  const date = new Date(value);
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = String(date.getFullYear()).padStart(4, '0');
  return `${dd}.${mm}.${yyyy}`;
}

function formatItemsPageTime(ts) {
  const value = Number(ts) || 0;
  if (!value) return '—';
  const date = new Date(value);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function getItemsPageStatusLabel(status) {
  const normalized = trimToString(status || '').toUpperCase();
  if (normalized === 'PENDING') return 'Не готово';
  const info = formatFlowItemStatusLabel(normalized);
  return info?.text || trimToString(status || '') || '—';
}

function parseItemsPageDisplayDate(value) {
  return typeof parseProductionDisplayDate === 'function'
    ? parseProductionDisplayDate(value)
    : '';
}

function formatItemsPageDisplayDate(value) {
  return typeof formatProductionDisplayDate === 'function'
    ? formatProductionDisplayDate(value)
    : '';
}

function syncItemsPageDateInputs(textInput, nativeInput, isoValue) {
  if (textInput) textInput.value = formatItemsPageDisplayDate(isoValue);
  if (nativeInput) nativeInput.value = isoValue || '';
}

function syncItemsPageStatusFilterUi(selectEl) {
  if (!selectEl) return;
  selectEl.classList.remove('is-good', 'is-pending', 'is-delayed', 'is-defect', 'is-disposed');
  if (selectEl.value === 'PENDING') selectEl.classList.add('is-pending');
  if (selectEl.value === 'GOOD') selectEl.classList.add('is-good');
  if (selectEl.value === 'DELAYED') selectEl.classList.add('is-delayed');
  if (selectEl.value === 'DEFECT') selectEl.classList.add('is-defect');
  if (selectEl.value === 'DISPOSED') selectEl.classList.add('is-disposed');
}

function syncItemsPageFiltersUi() {
  const searchInput = document.getElementById('items-search');
  if (searchInput && (searchInput.value || '') !== (itemsPageSearchTerm || '')) {
    searchInput.value = itemsPageSearchTerm || '';
  }
  const statusSelect = document.getElementById('items-status-filter');
  if (statusSelect && statusSelect.value !== (itemsPageStatusFilter || 'ALL')) {
    statusSelect.value = itemsPageStatusFilter || 'ALL';
  }
  syncItemsPageStatusFilterUi(statusSelect);
  syncItemsPageDateInputs(
    null,
    document.getElementById('items-date-from-native'),
    itemsPageDateFrom
  );
  syncItemsPageDateInputs(
    null,
    document.getElementById('items-date-to-native'),
    itemsPageDateTo
  );
}

function normalizeItemsPageDateRange(startDate, endDate) {
  let from = trimToString(startDate || '');
  let to = trimToString(endDate || '');
  if (from && to && from > to) {
    [from, to] = [to, from];
  }
  return { startDate: from, endDate: to };
}

function getItemsPageRowDateIso(row) {
  return row?.at ? formatDateInputValue(row.at) : '';
}

function matchesItemsPageDateRange(row, startDate, endDate) {
  if (!startDate && !endDate) return !row?.isPlaceholder;
  if (row?.isPlaceholder) return false;
  const rowDate = getItemsPageRowDateIso(row);
  if (!rowDate) return false;
  if (startDate && rowDate < startDate) return false;
  if (endDate && rowDate > endDate) return false;
  return true;
}

function isItemsPageFinalGoodEntry(entry, card, config = getItemsPageConfig()) {
  const lastOp = getLastOperationForFlowKind(card, config.itemKind, config.sampleType);
  if (!lastOp) return false;
  const lastOpId = trimToString(lastOp?.id || lastOp?.opId || '');
  const lastOpCode = trimToString(lastOp?.opCode || '');
  const entryOpId = trimToString(entry?.opId || '');
  const entryOpCode = trimToString(entry?.opCode || '');
  return Boolean(
    (lastOpId && entryOpId && lastOpId === entryOpId)
    || (lastOpCode && entryOpCode && lastOpCode === entryOpCode)
  );
}

function buildItemsPageOperationLabel(opCode = '', opName = '') {
  const code = trimToString(opCode || '');
  const name = trimToString(opName || '');
  if (code && name) return `${code} · ${name}`;
  return code || name || '';
}

function resolveItemsPageOperationInfo(entry, card = null) {
  const entryOpId = trimToString(entry?.opId || '');
  const op = entryOpId
    ? ((Array.isArray(card?.operations) ? card.operations : []).find(item => trimToString(item?.id || item?.opId || '') === entryOpId) || null)
    : null;
  const opCode = trimToString(entry?.opCode || op?.opCode || '');
  const opName = trimToString(entry?.opName || op?.opName || op?.name || '');
  const operationLabel = buildItemsPageOperationLabel(opCode, opName);
  return {
    opCode,
    opName,
    operationLabel,
    isPersonalOperation: entry?.isPersonalOperation === true || Boolean(trimToString(entry?.personalOperationId || ''))
  };
}

function buildItemsPageStatusRows(item, card = null, config = getItemsPageConfig()) {
  const rows = [];
  const history = Array.isArray(item?.history) ? item.history.slice() : [];
  history.sort((a, b) => (Number(a?.at) || 0) - (Number(b?.at) || 0));

  const pushStatusRow = (status, entry = null, { synthetic = false, atFallback = 0, shiftFallback = '—', userFallback = '—' } = {}) => {
    if (!status) return;
    const lastRow = rows.length ? rows[rows.length - 1] : null;
    if (lastRow && lastRow.status === status) return;
    const at = Number(entry?.at || atFallback || item?.current?.updatedAt || item?.archivedAt || 0) || 0;
    const operationInfo = entry ? resolveItemsPageOperationInfo(entry, card) : {
      opCode: '',
      opName: '',
      operationLabel: '',
      isPersonalOperation: false
    };
    rows.push({
      status,
      statusLabel: getItemsPageStatusLabel(status),
      statusClass: statusToItemsClass(status),
      at,
      dateText: formatItemsPageDate(at),
      timeText: formatItemsPageTime(at),
      shift: trimToString(entry?.shift || '') || shiftFallback,
      user: trimToString(entry?.userName || entry?.createdBy || '') || userFallback,
      opCode: operationInfo.opCode,
      opName: operationInfo.opName,
      operationLabel: operationInfo.operationLabel,
      operationSort: operationInfo.operationLabel || buildItemsPageOperationLabel(operationInfo.opCode, operationInfo.opName),
      isPersonalOperation: operationInfo.isPersonalOperation,
      isPlaceholder: false,
      synthetic
    });
  };

  history.forEach(entry => {
    const status = trimToString(entry?.status || '').toUpperCase();
    if (status === 'GOOD') {
      if (!isItemsPageFinalGoodEntry(entry, card, config)) return;
      pushStatusRow('GOOD', entry);
      return;
    }
    if (status === 'DELAYED' || status === 'DEFECT' || status === 'DISPOSED') {
      pushStatusRow(status, entry);
      return;
    }
    if (status === 'PENDING' && rows.length) {
      pushStatusRow('PENDING', entry);
    }
  });

  const currentStatus = trimToString(item?.current?.status || item?.finalStatus || '').toUpperCase();
  if (currentStatus === 'PENDING') {
    const lastPendingEntry = history
      .slice()
      .reverse()
      .find(entry => trimToString(entry?.status || '').toUpperCase() === 'PENDING') || null;
    pushStatusRow('PENDING', lastPendingEntry, {
      synthetic: true,
      atFallback: Number(item?.current?.updatedAt || item?.archivedAt || 0) || 0
    });
  } else if (ITEMS_PAGE_FINAL_STATUS_SET.has(currentStatus)) {
    pushStatusRow(currentStatus, null, {
      synthetic: true,
      atFallback: Number(item?.current?.updatedAt || item?.archivedAt || 0) || 0
    });
  }

  return rows;
}

function buildItemsPageInstanceTimelineTs(instance) {
  const firstStatusAt = instance.statusRows.find(row => !row.isPlaceholder)?.at || 0;
  return firstStatusAt
    || Number(instance.item?.archivedAt || 0)
    || Number(instance.item?.current?.updatedAt || 0)
    || Number(instance.card?.updatedAt || instance.card?.createdAt || 0)
    || 0;
}

function buildItemsPageCardSerialKey(cardId, serial) {
  return `${trimToString(cardId || '')}::${trimToString(serial || '').toLowerCase()}`;
}

function collectItemsPageInstances(config = getItemsPageConfig()) {
  const instances = [];
  const cardSerialMap = new Map();
  const sourceKeys = new Set();
  const sampleTypeNorm = normalizeSampleType(config.sampleType);

  (cards || []).forEach(card => {
    if (!card || card.cardType !== 'MKI' || !isItemsPageApprovedCard(card)) return;
    ensureCardFlowForUi(card);
    const cardMeta = resolveItemsPageCardMeta(card);
    const flowItems = config.itemKind === 'SAMPLE'
      ? (Array.isArray(card?.flow?.samples) ? card.flow.samples : []).filter(item => (
        trimToString(item?.kind || '').toUpperCase() === 'SAMPLE'
        && normalizeSampleType(item?.sampleType) === sampleTypeNorm
      ))
      : (Array.isArray(card?.flow?.items) ? card.flow.items : []);
    const archivedItems = (Array.isArray(card?.flow?.archivedItems) ? card.flow.archivedItems : []).filter(item => {
      const kind = trimToString(item?.kind || '').toUpperCase();
      if (trimToString(item?.archivedReason || '').toUpperCase() !== 'MOVED') return false;
      if (config.itemKind === 'SAMPLE') {
        return kind === 'SAMPLE' && normalizeSampleType(item?.sampleType) === sampleTypeNorm;
      }
      return !kind || kind === 'ITEM';
    });
    flowItems.concat(archivedItems).forEach((item, index) => {
      if (!item) return;
      const serial = trimToString(item?.displayName || item?.id || '');
      if (!serial) return;
      const qrCode = resolveItemsPageItemQrCode(item, card);
      const statusRows = buildItemsPageStatusRows(item, card, config);
      const moveTargetCardId = trimToString(item?.archivedTarget?.cardId || '');
      const instanceKey = `${trimToString(card.id || '')}::${trimToString(item.id || `idx-${index}`)}::${trimToString(item?.archivedReason || 'ACTIVE')}`;
      const instance = {
        key: instanceKey,
        card,
        item,
        serial,
        qrCode,
        cardMeta,
        statusRows,
        moveTargetCardId,
        timelineTs: 0
      };
      instance.timelineTs = buildItemsPageInstanceTimelineTs(instance);
      instances.push(instance);

      const serialKey = buildItemsPageCardSerialKey(card.id, serial);
      if (!cardSerialMap.has(serialKey)) {
        cardSerialMap.set(serialKey, []);
      }
      cardSerialMap.get(serialKey).push(instance);
      if (moveTargetCardId) {
        sourceKeys.add(instance.key);
      }
    });
  });

  return { instances, cardSerialMap, sourceKeys };
}

function linkItemsPageInstances(instances, cardSerialMap) {
  const parent = new Map();
  instances.forEach(instance => parent.set(instance.key, instance.key));

  const find = (key) => {
    let current = key;
    while (parent.get(current) !== current) {
      current = parent.get(current);
    }
    let node = key;
    while (parent.get(node) !== current) {
      const next = parent.get(node);
      parent.set(node, current);
      node = next;
    }
    return current;
  };

  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) {
      parent.set(rootB, rootA);
    }
  };

  instances.forEach(instance => {
    if (!instance.moveTargetCardId) return;
    const serialKey = buildItemsPageCardSerialKey(instance.moveTargetCardId, instance.serial);
    const rawCandidates = (cardSerialMap.get(serialKey) || [])
      .filter(candidate => candidate.key !== instance.key);
    const candidates = (rawCandidates.filter(candidate => (candidate.timelineTs || 0) >= (instance.timelineTs || 0)).length
      ? rawCandidates.filter(candidate => (candidate.timelineTs || 0) >= (instance.timelineTs || 0))
      : rawCandidates)
      .sort((a, b) => {
        const deltaA = Math.abs((a.timelineTs || 0) - (instance.timelineTs || 0));
        const deltaB = Math.abs((b.timelineTs || 0) - (instance.timelineTs || 0));
        return deltaA - deltaB;
      });
    if (candidates[0]) {
      union(instance.key, candidates[0].key);
    }
  });

  return find;
}

function finalizeItemsPageBlock({ serial = '', allQrs = [], subgroups = [], searchHaystack = '' } = {}) {
  const lastSubgroup = subgroups[subgroups.length - 1] || null;
  const lastStatusRow = subgroups
    .flatMap(subgroup => subgroup.rows)
    .filter(row => !row.isPlaceholder)
    .sort((a, b) => (Number(a?.at) || 0) - (Number(b?.at) || 0))
    .slice(-1)[0] || null;
  const rowCount = subgroups.reduce((sum, subgroup) => sum + (subgroup.rowCount || 0), 0);
  const displayQr = trimToString(allQrs[allQrs.length - 1] || allQrs[0] || '');
  const qrLines = Array.from(new Set(allQrs.filter(Boolean)));
  return {
    serial,
    displayQr,
    qrLines,
    allQrs,
    subgroups,
    rowCount,
    searchHaystack,
    sortValues: {
      serial,
      qrCode: displayQr,
      name: trimToString(lastSubgroup?.cardMeta?.itemName || ''),
      route: trimToString(lastSubgroup?.cardMeta?.routeCardNumber || ''),
      issuedBy: trimToString(lastSubgroup?.cardMeta?.issuedBySurname || ''),
      basis: trimToString(lastSubgroup?.cardMeta?.workBasis || ''),
      operation: trimToString(lastStatusRow?.operationSort || lastStatusRow?.operationLabel || ''),
      status: trimToString(lastStatusRow?.statusLabel || ''),
      date: Number(lastStatusRow?.at || 0) || 0,
      shift: trimToString(lastStatusRow?.shift || ''),
      time: Number(lastStatusRow?.at || 0) || 0,
      user: trimToString(lastStatusRow?.user || '')
    }
  };
}

function buildItemsPageBlocks() {
  const config = getItemsPageConfig();
  const { instances, cardSerialMap } = collectItemsPageInstances(config);
  if (!instances.length) return [];

  const find = linkItemsPageInstances(instances, cardSerialMap);
  const blockMap = new Map();

  instances.forEach(instance => {
    const rootKey = find(instance.key);
    if (!blockMap.has(rootKey)) {
      blockMap.set(rootKey, []);
    }
    blockMap.get(rootKey).push(instance);
  });

  return Array.from(blockMap.values()).map(groupInstances => {
    const subgroupMap = new Map();
    groupInstances.forEach(instance => {
      const subgroupKey = trimToString(instance.card?.id || '');
      if (!subgroupMap.has(subgroupKey)) {
        subgroupMap.set(subgroupKey, {
          cardId: subgroupKey,
          card: instance.card,
          cardMeta: instance.cardMeta,
          rows: [],
          qrs: [],
          timelineTs: Number.POSITIVE_INFINITY
        });
      }
      const subgroup = subgroupMap.get(subgroupKey);
      subgroup.timelineTs = Math.min(subgroup.timelineTs, instance.timelineTs || Number.POSITIVE_INFINITY);
      if (instance.qrCode) subgroup.qrs.push(instance.qrCode);
      if (instance.statusRows.length) {
        subgroup.rows.push(...instance.statusRows.map(row => ({ ...row })));
      } else {
        subgroup.rows.push({
          status: 'PENDING',
          statusLabel: getItemsPageStatusLabel('PENDING'),
          statusClass: statusToItemsClass('PENDING'),
          at: 0,
          dateText: '—',
          timeText: '—',
          shift: '—',
          user: '—',
          isPlaceholder: true
        });
      }
    });

    const subgroups = Array.from(subgroupMap.values())
      .map(subgroup => {
        subgroup.rows.sort((a, b) => {
          const tsDiff = (Number(a?.at) || 0) - (Number(b?.at) || 0);
          if (tsDiff !== 0) return tsDiff;
          return compareTextNatural(trimToString(a?.statusLabel || ''), trimToString(b?.statusLabel || ''));
        });
        subgroup.rowCount = subgroup.rows.length || 1;
        subgroup.timelineTs = Number.isFinite(subgroup.timelineTs) ? subgroup.timelineTs : 0;
        return subgroup;
      })
      .sort((a, b) => (a.timelineTs || 0) - (b.timelineTs || 0));

    const serial = trimToString(groupInstances[0]?.serial || '');
    const allQrs = groupInstances
      .map(instance => trimToString(instance.qrCode || ''))
      .filter(Boolean);
    const searchHaystack = [
      serial,
      ...allQrs,
      ...subgroups.map(subgroup => subgroup.cardMeta.itemName),
      ...subgroups.map(subgroup => subgroup.cardMeta.routeCardNumber),
      ...subgroups.map(subgroup => subgroup.cardMeta.workBasis),
      ...subgroups.map(subgroup => subgroup.cardMeta.issuedBySurname),
      ...subgroups.flatMap(subgroup => (subgroup.rows || []).flatMap(row => [row?.opCode, row?.opName, row?.operationLabel]))
    ].filter(Boolean).join('\n').toLowerCase();

    return finalizeItemsPageBlock({
      serial,
      allQrs,
      subgroups,
      searchHaystack
    });
  });
}

function sortItemsPageBlocks(blocks, sortKey, sortDir) {
  const factor = sortDir === 'desc' ? -1 : 1;
  return (blocks || []).slice().sort((a, b) => {
    const valA = a?.sortValues?.[sortKey];
    const valB = b?.sortValues?.[sortKey];
    if (sortKey === 'date' || sortKey === 'time') {
      return ((Number(valA) || 0) - (Number(valB) || 0)) * factor;
    }
    return compareTextNatural(trimToString(valA || ''), trimToString(valB || '')) * factor;
  });
}

function filterItemsPageBlocks(blocks, searchTerm) {
  const normalized = trimToString(searchTerm || '').toLowerCase();
  if (!normalized) return (blocks || []).slice();
  return (blocks || []).filter(block => block.searchHaystack.includes(normalized));
}

function matchesItemsPageRowFilters(row, { statusFilter = 'ALL', startDate = '', endDate = '' } = {}) {
  if (statusFilter === 'ALL' && !startDate && !endDate) return true;
  if (row?.isPlaceholder) {
    return statusFilter === 'PENDING' && !startDate && !endDate;
  }
  if (statusFilter !== 'ALL' && trimToString(row?.status || '').toUpperCase() !== statusFilter) return false;
  return matchesItemsPageDateRange(row, startDate, endDate);
}

function buildItemsPageEventFilteredBlocks(blocks, filters = {}) {
  const { statusFilter = 'ALL', startDate = '', endDate = '' } = filters || {};
  if (statusFilter === 'ALL' && !startDate && !endDate) {
    return (blocks || []).slice();
  }
  return (blocks || []).map(block => {
    const statusMatched = statusFilter === 'ALL'
      ? true
      : (block.subgroups || []).some(subgroup => (
        subgroup.rows || []
      ).some(row => matchesItemsPageRowFilters(row, { statusFilter, startDate: '', endDate: '' })));
    if (!statusMatched) return null;

    const subgroups = (block.subgroups || [])
      .map(subgroup => {
        const rows = (subgroup.rows || []).filter(row => matchesItemsPageRowFilters(row, { statusFilter: 'ALL', startDate, endDate }));
        if (!rows.length) return null;
        return {
          ...subgroup,
          rows,
          rowCount: rows.length
        };
      })
      .filter(Boolean);
    if (!subgroups.length) return null;
    return finalizeItemsPageBlock({
      serial: block.serial,
      allQrs: block.allQrs,
      subgroups,
      searchHaystack: block.searchHaystack
    });
  }).filter(Boolean);
}

function buildItemsPageSummary(blocks, { startDate = '', endDate = '' } = {}) {
  const summary = {
    total: 0,
    pending: 0,
    good: 0,
    delayed: 0,
    defect: 0,
    disposed: 0
  };
  (blocks || []).forEach(block => {
    (block.subgroups || []).forEach(subgroup => {
      (subgroup.rows || []).forEach(row => {
        if (!matchesItemsPageDateRange(row, startDate, endDate)) return;
        summary.total += 1;
        if (row.status === 'PENDING') summary.pending += 1;
        if (row.status === 'GOOD') summary.good += 1;
        if (row.status === 'DELAYED') summary.delayed += 1;
        if (row.status === 'DEFECT') summary.defect += 1;
        if (row.status === 'DISPOSED') summary.disposed += 1;
      });
    });
  });
  return summary;
}

function renderItemsPageSummary(summary) {
  const container = document.getElementById('items-summary-stats');
  if (!container) return;
  const safe = summary || { total: 0, pending: 0, good: 0, delayed: 0, defect: 0, disposed: 0 };
  container.innerHTML =
    '<span class="items-page-summary-item items-page-summary-total"><strong>Всего</strong><span>' + escapeHtml(String(safe.total || 0)) + '</span></span>' +
    '<span class="items-page-summary-item items-status-pending"><strong>Не готово</strong><span>' + escapeHtml(String(safe.pending || 0)) + '</span></span>' +
    '<span class="items-page-summary-item op-item-status-good"><strong>Годно</strong><span>' + escapeHtml(String(safe.good || 0)) + '</span></span>' +
    '<span class="items-page-summary-item op-item-status-delayed"><strong>Задержано</strong><span>' + escapeHtml(String(safe.delayed || 0)) + '</span></span>' +
    '<span class="items-page-summary-item op-item-status-defect"><strong>Брак</strong><span>' + escapeHtml(String(safe.defect || 0)) + '</span></span>' +
    '<span class="items-page-summary-item items-status-disposed"><strong>Утилизировано</strong><span>' + escapeHtml(String(safe.disposed || 0)) + '</span></span>';
}

function buildItemsPagePaginationTokens(totalPages, currentPage) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const tokens = [1];
  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);

  if (start > 2) {
    tokens.push('ellipsis-left');
  }

  for (let page = start; page <= end; page += 1) {
    tokens.push(page);
  }

  if (end < totalPages - 1) {
    tokens.push('ellipsis-right');
  }

  tokens.push(totalPages);
  return tokens;
}

function buildItemsPagePaginationHtml(totalPages, currentPage) {
  if (totalPages <= 1) return '';
  const config = getItemsPageConfig();
  const tokens = buildItemsPagePaginationTokens(totalPages, currentPage);
  const prevDisabled = currentPage <= 1;
  const nextDisabled = currentPage >= totalPages;
  return '<div class="items-page-pagination" aria-label="' + escapeHtml(config.paginationAriaLabel || 'Пагинация таблицы изделий') + '">' +
    '<button type="button" class="items-page-pagination-btn" data-page="' + (currentPage - 1) + '"' + (prevDisabled ? ' disabled' : '') + ' aria-label="Предыдущая страница">‹</button>' +
    tokens.map(token => {
      if (typeof token !== 'number') {
        return '<span class="items-page-pagination-ellipsis">…</span>';
      }
      const active = token === currentPage;
      return '<button type="button" class="items-page-pagination-btn' + (active ? ' active' : '') + '" data-page="' + token + '"' + (active ? ' aria-current="page"' : '') + '>' + token + '</button>';
    }).join('') +
    '<button type="button" class="items-page-pagination-btn" data-page="' + (currentPage + 1) + '"' + (nextDisabled ? ' disabled' : '') + ' aria-label="Следующая страница">›</button>' +
  '</div>';
}

function getItemsPageTargetRows() {
  const viewportHeight = Math.max(window.innerHeight || 0, 720);
  const estimatedRows = Math.round((viewportHeight * ITEMS_PAGE_TARGET_SCREENS) / ITEMS_PAGE_ESTIMATED_ROW_HEIGHT);
  return Math.min(ITEMS_PAGE_MAX_ROWS, Math.max(ITEMS_PAGE_MIN_ROWS, estimatedRows));
}

function paginateItemsPageBlocks(blocks, currentPage) {
  const totalBlocks = Array.isArray(blocks) ? blocks.length : 0;
  const targetRows = getItemsPageTargetRows();
  const pages = [];
  let currentChunk = [];
  let currentRows = 0;

  (blocks || []).forEach(block => {
    const blockRows = Math.max(1, Number(block?.rowCount || 0) || 1);
    const shouldSplit = currentChunk.length > 0 && currentRows + blockRows > targetRows;
    if (shouldSplit) {
      pages.push(currentChunk);
      currentChunk = [];
      currentRows = 0;
    }
    currentChunk.push(block);
    currentRows += blockRows;
  });
  if (currentChunk.length) {
    pages.push(currentChunk);
  }

  const totalPages = Math.max(1, pages.length || (totalBlocks ? 1 : 0));
  const safePage = Math.min(Math.max(1, currentPage || 1), totalPages);
  return {
    totalBlocks,
    totalPages,
    currentPage: safePage,
    pageBlocks: pages[safePage - 1] || []
  };
}

function buildItemsPageTableHtml(blocks, { totalPages = 1, currentPage = 1 } = {}) {
  const config = getItemsPageConfig();
  const header = '<table class="items-page-table">' +
    '<thead><tr>' +
      '<th class="th-sortable" data-sort-key="serial">' + escapeHtml(config.serialColumnLabel || 'Индивидуальный номер изделия') + '</th>' +
      '<th class="th-sortable" data-sort-key="qrCode">' + escapeHtml(config.qrColumnLabel || 'QR-код изделия') + '</th>' +
      '<th class="th-sortable" data-sort-key="name">Наименование изделия</th>' +
      '<th class="th-sortable" data-sort-key="route">Маршрутная карта №</th>' +
      '<th class="th-sortable" data-sort-key="issuedBy">Фамилия выписавшего маршрутную карту</th>' +
      '<th class="th-sortable" data-sort-key="basis">Основание для выполнения работ</th>' +
      '<th class="th-sortable" data-sort-key="operation">Операция</th>' +
      '<th class="th-sortable" data-sort-key="status">Статус</th>' +
      '<th class="th-sortable" data-sort-key="date">Дата</th>' +
      '<th class="th-sortable" data-sort-key="shift">Смена</th>' +
      '<th class="th-sortable" data-sort-key="time">Время</th>' +
      '<th class="th-sortable" data-sort-key="user">Пользователь</th>' +
    '</tr></thead>';
  const paginationHtml = buildItemsPagePaginationHtml(totalPages, currentPage);

  if (!blocks.length) {
    return header + '<tbody><tr><td colspan="12" class="muted">Нет данных.</td></tr></tbody></table>';
  }

  const rows = [];
  blocks.forEach(block => {
    let blockRowIndex = 0;
    block.subgroups.forEach((subgroup, subgroupIndex) => {
      subgroup.rows.forEach((row, rowIndex) => {
        const classes = [];
        if (blockRowIndex === 0) classes.push('items-page-row-block-start');
        if (rowIndex === 0) classes.push('items-page-row-subgroup-start');
        if (row.isPlaceholder) classes.push('items-page-muted-row');
        const operationCell = row.operationLabel
          ? '<div>' + escapeHtml(row.operationLabel) + '</div>' + (row.isPersonalOperation ? '<div class="personal-op-label">Личная операция</div>' : '')
          : '—';
        rows.push('<tr' + (classes.length ? ' class="' + classes.join(' ') + '"' : '') + '>' +
          (blockRowIndex === 0
            ? '<td rowspan="' + block.rowCount + '" class="items-page-cell-shared">' + escapeHtml(block.serial || '—') + '</td>' +
              '<td rowspan="' + block.rowCount + '" class="items-page-cell-shared">' + (block.qrLines.length ? block.qrLines.map(value => escapeHtml(value)).join('<br>') : '—') + '</td>'
            : '') +
          (rowIndex === 0
            ? '<td rowspan="' + subgroup.rowCount + '" class="items-page-cell-group">' + escapeHtml(subgroup.cardMeta.itemName || '—') + '</td>' +
              '<td rowspan="' + subgroup.rowCount + '" class="items-page-cell-group items-page-route-cell" data-route="' + escapeHtml(subgroup.cardMeta.routeUrl || '') + '">' +
                '<span class="items-page-route-value">' + escapeHtml(subgroup.cardMeta.routeCardNumber || '—') + '</span>' +
              '</td>' +
              '<td rowspan="' + subgroup.rowCount + '" class="items-page-cell-group">' + escapeHtml(subgroup.cardMeta.issuedBySurname || '—') + '</td>' +
              '<td rowspan="' + subgroup.rowCount + '" class="items-page-cell-group">' + escapeHtml(subgroup.cardMeta.workBasis || '—') + '</td>'
            : '') +
          '<td>' + operationCell + '</td>' +
          '<td>' + (row.statusClass ? '<span class="' + row.statusClass + '">' + escapeHtml(row.statusLabel || '—') + '</span>' : escapeHtml(row.statusLabel || '—')) + '</td>' +
          '<td>' + escapeHtml(row.dateText || '—') + '</td>' +
          '<td>' + escapeHtml(row.shift || '—') + '</td>' +
          '<td>' + escapeHtml(row.timeText || '—') + '</td>' +
          '<td>' + escapeHtml(row.user || '—') + '</td>' +
        '</tr>');
        blockRowIndex += 1;
      });
    });
  });

  return header + '<tbody>' + rows.join('') + '</tbody></table>' + paginationHtml;
}

function renderItemsPage() {
  const { config } = syncItemsPageRouteContext();
  const wrapper = document.getElementById('items-table-wrapper');
  if (!wrapper) return;

  const normalizedRange = normalizeItemsPageDateRange(itemsPageDateFrom, itemsPageDateTo);
  itemsPageDateFrom = normalizedRange.startDate;
  itemsPageDateTo = normalizedRange.endDate;
  saveItemsPageRouteState();
  applyItemsPageConfigToUi(config);
  syncItemsPageFiltersUi();

  const textFilteredBlocks = filterItemsPageBlocks(buildItemsPageBlocks(), itemsPageSearchTerm);
  renderItemsPageSummary(buildItemsPageSummary(textFilteredBlocks, normalizedRange));

  const blocks = sortItemsPageBlocks(
    buildItemsPageEventFilteredBlocks(textFilteredBlocks, {
      statusFilter: itemsPageStatusFilter,
      startDate: normalizedRange.startDate,
      endDate: normalizedRange.endDate
    }),
    itemsPageSortKey,
    itemsPageSortDir
  );
  const pagination = paginateItemsPageBlocks(blocks, itemsPageCurrentPage);
  itemsPageCurrentPage = pagination.currentPage;

  wrapper.innerHTML = buildItemsPageTableHtml(pagination.pageBlocks, {
    totalPages: pagination.totalPages,
    currentPage: pagination.currentPage
  });
  updateTableSortUI(wrapper, itemsPageSortKey, itemsPageSortDir);
  applyReadonlyState('items', config.permissionKey || 'items');
}

function bindWorkordersInteractions(rootEl, { readonly = false, forceClosed = true, enableSummaryNavigation = true } = {}) {
  if (!rootEl) return;
  bindCardInfoToggles(rootEl);

  rootEl.querySelectorAll('.wo-card[data-card-id]').forEach(detail => {
    if (forceClosed) {
      detail.open = false;
    }
    const summary = detail.querySelector('summary');
    if (summary && enableSummaryNavigation) {
      summary.addEventListener('click', (e) => {
        if (shouldIgnoreCardOpenClick(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const cardId = detail.dataset.cardId;
        const card = cards.find(c => c.id === cardId);
        if (!card) return;
        navigateToRoute(getWorkordersCardUrlByCard(card));
      });
    }
    markWorkorderToggleState(detail);
  });

  rootEl.querySelectorAll('button[data-attach-card]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-attach-card');
      openAttachmentsModal(id, 'live');
    });
  });

  rootEl.querySelectorAll('.archive-move-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-card-id');
      const card = cards.find(c => c.id === id);
      if (!card) return;
      await archiveCardViaCardsCore(card);
    });
  });

  bindOperationControls(rootEl, { readonly });
}

function renderWorkorderCardPage(card, mountEl) {
  if (!card || !mountEl) return;
  const readonly = isTabReadonly('workorders');
  mountEl.innerHTML = `
    <div class="wo-page">
      <div class="wo-page-header">
        <button class="btn btn-small" id="wo-page-back">← Назад</button>
        <div class="wo-page-title">
          <div><b>Маршрутная карта</b></div>
          <div class="muted">QR: ${escapeHtml(normalizeQrId(card.qrId || ''))}</div>
        </div>
      </div>
      ${buildWorkorderCardDetails(card, { opened: true, readonly, allowActions: false, showCardInfoHeader: false, summaryToggle: true, lockExecutors: true })}
    </div>
  `;

  const backBtn = document.getElementById('wo-page-back');
  if (backBtn) backBtn.onclick = () => navigateToRoute('/workorders');

  bindWorkordersInteractions(mountEl, { readonly, forceClosed: false, enableSummaryNavigation: false });

  const detail = mountEl.querySelector('details.wo-card');
  if (detail) detail.open = true;
}

function renderWorkspaceCardPage(card, mountEl) {
  if (!card || !mountEl) return;
  const readonly = isTabReadonly('workspace');
  const hasAccess = canCurrentUserAccessWorkspaceCardUi(card);
  document.body.classList.add('page-wo-mode');
  mountEl.innerHTML = `
    <div class="wo-page">
      <div class="wo-page-header">
        <button class="btn btn-small" id="workspace-page-back">← Назад</button>
        <div class="wo-page-title">
          <div><b>Рабочее место</b></div>
          <div class="muted">QR: ${escapeHtml(normalizeQrId(card.qrId || ''))}</div>
        </div>
      </div>
      <div id="workspace-card-page-body">
        ${hasAccess
          ? buildWorkspaceCardDetails(card, { opened: true, readonly })
          : buildWorkspaceAccessDeniedNotice(card)}
      </div>
    </div>
  `;

  const backBtn = document.getElementById('workspace-page-back');
  if (backBtn) backBtn.onclick = () => navigateToRoute('/workspace');

  const bodyEl = mountEl.querySelector('#workspace-card-page-body');
  if (hasAccess && bodyEl) {
    bindWorkspaceInteractions(bodyEl, { readonly, enableSummaryNavigation: false });
  }

  const detail = (bodyEl || mountEl).querySelector('details.wo-card');
  if (detail) detail.open = true;
}

function renderWorkordersTable({ collapseAll = false } = {}) {
  const wrapper = document.getElementById('workorders-table-wrapper');
  if (!wrapper) return;
  const shiftSelect = document.getElementById('workorder-filter-shift');
  if (shiftSelect && (shiftSelect.options.length <= 1 || shiftSelect.dataset.ready !== 'true')) {
    let shiftOptions = [];
    if (typeof getProductionShiftTimesList === 'function') {
      shiftOptions = getProductionShiftTimesList();
    } else if (Array.isArray(productionShiftTimes) && productionShiftTimes.length) {
      shiftOptions = productionShiftTimes.slice().sort((a, b) => (a.shift || 0) - (b.shift || 0));
    } else {
      shiftOptions = getDefaultProductionShiftTimes();
    }
    shiftSelect.innerHTML = [
      '<option value="">Любая смена</option>',
      ...shiftOptions.map(item => (
        `<option value="${escapeHtml(String(item.shift))}">${escapeHtml(String(item.shift))} смена</option>`
      ))
    ].join('');
    shiftSelect.dataset.ready = 'true';
  }
  if (shiftSelect && shiftSelect.value !== (workorderFilterShift || '')) {
    shiftSelect.value = workorderFilterShift || '';
  }
  const readonly = isTabReadonly('workorders');
  let rootCards = cards.filter(c =>
    c &&
    !c.archived &&
    c.cardType === 'MKI' &&
    isWorkorderHistoryCard(c)
  );
  const effectiveDate = workorderFilterDate || getCurrentDateString();
  if (workorderAvailabilityMode === 'AVAILABLE') {
    const selectedShift = workorderFilterShift || '';
    const matchCardIds = new Set();
    (productionShiftTasks || []).forEach(task => {
      if (!task || !task.cardId) return;
      if (task.date !== effectiveDate) return;
      if (selectedShift && String(task.shift) !== String(selectedShift)) return;
      const card = cards.find(item => String(item?.id || '') === String(task.cardId || '')) || null;
      const op = (card?.operations || []).find(item => String(item?.id || '') === String(task.routeOpId || '')) || null;
      if (isMaterialIssueOperation(op) || isMaterialReturnOperation(op)) return;
      matchCardIds.add(task.cardId);
    });
    rootCards = rootCards.filter(card => matchCardIds.has(card.id));
    if (!rootCards.length) {
      wrapper.innerHTML = '<p>Нет карт, подходящих под выбранный фильтр.</p>';
      return;
    }
  }
  const hasOperations = rootCards.some(card => card.operations && card.operations.length);
  if (!hasOperations) {
    wrapper.innerHTML = '<p>Маршрутных операций пока нет.</p>';
    return;
  }

  if (collapseAll) {
    workorderOpenCards.clear();
  }

  const termRaw = workorderSearchTerm.trim();
  const termLower = termRaw.toLowerCase();
  const hasTerm = !!termLower;
  const filteredByStatus = rootCards.filter(card => {
    const state = getCardProcessState(card);
    return workorderStatusFilter === 'ALL' || state.key === workorderStatusFilter;
  });

  const filteredByMissingExecutor = workorderMissingExecutorFilter === 'NO_EXECUTOR'
    ? filteredByStatus.filter(card => cardHasMissingExecutors(card))
    : filteredByStatus;

  if (!filteredByMissingExecutor.length) {
    wrapper.innerHTML = '<p>Нет карт, подходящих под выбранный фильтр.</p>';
    return;
  }

  const scoreFn = (card) => cardSearchScore(card, termRaw);
  let sortedCards = [...filteredByMissingExecutor];
  if (termRaw) {
    sortedCards.sort((a, b) => scoreFn(b) - scoreFn(a));
  }

  const filteredBySearch = termRaw
    ? sortedCards.filter(card => scoreFn(card) > 0)
    : sortedCards;

  if (!filteredBySearch.length) {
    wrapper.innerHTML = '<p>Карты по запросу не найдены.</p>';
    return;
  }

  let html = '';
  filteredBySearch.forEach(card => {
    if (card.operations && card.operations.length) {
      const opened = !collapseAll && workorderOpenCards.has(card.id);
      html += buildWorkorderCardDetails(card, { opened, readonly, highlightCenterTerm: termLower, lockExecutors: true });
    }
  });

  wrapper.innerHTML = html;
  bindWorkordersInteractions(wrapper, { readonly });
}

function renderWorkspaceView() {
  const wrapper = document.getElementById('workspace-results');
  if (!wrapper) return;
  const readonly = isTabReadonly('workspace');
  const termRaw = workspaceSearchTerm.trim();
  const hasTerm = !!termRaw;
  const candidates = getWorkspaceViewCandidates(termRaw);

  if (!candidates.length) {
    wrapper.innerHTML = buildWorkspaceEmptyState({ hasTerm, hasCandidates: false });
    return;
  }

  const html = buildWorkspaceViewHtml(candidates, { readonly });

  if (!html) {
    wrapper.innerHTML = buildWorkspaceEmptyState({ hasTerm, hasCandidates: true });
    return;
  }

  wrapper.innerHTML = html;
  bindWorkspaceInteractions(wrapper, { readonly, enableSummaryNavigation: true });
}

function bindWorkspaceActionableControls(rootEl, { readonly = false } = {}) {
  if (!rootEl) return;
  ensureOperationTimersStarted();
  updateRenderedOperationTimers();

  rootEl.querySelectorAll('.barcode-view-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-card-id');
      const card = cards.find(c => c.id === id);
      if (!card) return;
      openBarcodeModal(card);
    });
  });

  rootEl.querySelectorAll('.items-view-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-items-card');
      if (id) openItemsModal(id);
    });
  });

  rootEl.querySelectorAll('button[data-attach-card]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-attach-card');
      openAttachmentsModal(id, 'live');
    });
  });

  rootEl.querySelectorAll('.wo-card button[data-action]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const action = btn.getAttribute('data-action');
      const cardId = btn.getAttribute('data-card-id');
      const opId = btn.getAttribute('data-op-id');
      const personalOperationId = btn.getAttribute('data-personal-op-id') || '';
      if (action === 'op-comments') {
        openOpCommentsModal(cardId, opId);
        return;
      }
      if (action === 'workspace-locked') {
        showToast(btn.getAttribute('title') || 'Операция не запланирована на текущую смену');
        return;
      }
      if (action === 'workspace-blocked-info') {
        openWorkspaceBlockedInfoModal(btn.getAttribute('title') || '');
        return;
      }
      if (readonly || btn.disabled) return;
      const card = cards.find(c => c.id === cardId);
      const op = card ? (card.operations || []).find(o => o.id === opId) : null;
      if (!card || !op) {
        showToast('Данные операции устарели. Данные обновлены.');
        await forceRefreshWorkspaceProductionData('workspace-action-missing-context');
        return;
      }

      if (action === 'stop') {
        if (isMaterialIssueOperation(op)) {
          openMaterialIssueModal(card, op);
        } else if (isMaterialReturnOperation(op)) {
          openMaterialReturnModal(card, op);
        } else if (isDryingOperation(op)) {
          openDryingModal(card, op);
        } else {
          openWorkspaceStopModal(card, op, personalOperationId ? { personalOperationId } : {});
        }
        return;
      }

      if (action === 'drying') {
        openDryingModal(card, op);
        return;
      }

      const detail = btn.closest('.wo-card');
      const shouldMarkPending = isWorkspaceDirectAction(action);
      btn.disabled = true;
      if (shouldMarkPending) setWorkspaceActionPendingState(btn, true);
      try {
        await applyOperationAction(action, card, op, { useWorkorderScrollLock: false, sourceEl: detail, personalOperationId });
      } finally {
        if (shouldMarkPending) setWorkspaceActionPendingState(btn, false);
        btn.disabled = false;
      }
    });
  });

  rootEl.querySelectorAll('[data-workspace-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const bodyId = btn.getAttribute('data-workspace-toggle');
      if (!bodyId) return;
      const body = document.getElementById(bodyId);
      if (!body) return;
      const isHidden = body.classList.toggle('hidden');
      btn.textContent = isHidden ? 'Развернуть ▼' : 'Свернуть ▲';
    });
  });
}

function bindWorkspaceInteractions(rootEl, { readonly = false, enableSummaryNavigation = true } = {}) {
  if (!rootEl) return;
  ensureOperationTimersStarted();
  updateRenderedOperationTimers();
  bindCardInfoToggles(rootEl);

  if (enableSummaryNavigation) {
    rootEl.querySelectorAll('.wo-card.workspace-card[data-card-id]').forEach(detail => {
      const summary = detail.querySelector('summary');
      if (!summary) return;
      summary.addEventListener('click', (e) => {
        if (shouldIgnoreCardOpenClick(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const cardId = detail.dataset.cardId;
        const card = cards.find(c => c.id === cardId);
        if (!card) return;
        const qr = normalizeQrId(card.qrId || '');
        const target = qr || card.id;
        if (!target) return;
        navigateToRoute(`/workspace/${encodeURIComponent(target)}`);
      });
    });
  }

  bindWorkspaceActionableControls(rootEl, { readonly });

  applyReadonlyState('workspace', 'workspace');
}

function setupWorkspaceTransferModals() {
  const transferModal = document.getElementById('workspace-transfer-modal');
  if (!transferModal) return;
  const resetBtn = document.getElementById('workspace-transfer-reset');
  const allGoodBtn = document.getElementById('workspace-transfer-all-good');
  const confirmBtn = document.getElementById('workspace-transfer-confirm');
  const renameBtn = document.getElementById('workspace-transfer-rename');
  const submitBtn = document.getElementById('workspace-transfer-submit');
  const cancelBtn = document.getElementById('workspace-transfer-cancel');
  const input = document.getElementById('workspace-transfer-scan-input');
  const cameraBtn = document.getElementById('workspace-transfer-camera-btn');
  const docsSelect = document.getElementById('workspace-transfer-docs-id');
  const docsInput = document.getElementById('workspace-transfer-docs-files');
  const docsList = document.getElementById('workspace-transfer-docs-list');

  if (resetBtn) resetBtn.addEventListener('click', () => resetWorkspaceTransferOperation());
  if (allGoodBtn) allGoodBtn.addEventListener('click', () => applyWorkspaceTransferAllGood());
  if (confirmBtn) confirmBtn.addEventListener('click', () => submitWorkspaceTransferModal());
  if (renameBtn) renameBtn.addEventListener('click', () => submitWorkspaceIdentificationAction());
  if (submitBtn) submitBtn.addEventListener('click', () => submitWorkspaceTransferAction());
  if (cancelBtn) cancelBtn.addEventListener('click', () => closeWorkspaceTransferModal());
  transferModal.addEventListener('click', (event) => {
    if (event.target === transferModal) return;
  });

  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleWorkspaceTransferScan(input.value || '');
      }
    });
    input.addEventListener('change', () => handleWorkspaceTransferScan(input.value || ''));
  }

  if (cameraBtn && input && typeof ensureScanButton === 'function') {
    ensureScanButton('workspace-transfer-scan-input', 'workspace-transfer-camera-btn');
  }

  if (docsSelect) {
    docsSelect.addEventListener('change', () => {
      workspaceTransferDocIdentifier = docsSelect.value || 'ХА';
    });
  }
  if (docsInput) {
    docsInput.addEventListener('change', () => {
      addWorkspaceTransferDocFiles(docsInput.files);
      docsInput.value = '';
    });
  }
  if (docsList && docsList.dataset.bound !== 'true') {
    docsList.dataset.bound = 'true';
    docsList.addEventListener('click', (event) => {
      const btn = event.target.closest('button[data-doc-index]');
      if (!btn) return;
      const idx = parseInt(btn.getAttribute('data-doc-index') || '', 10);
      if (!Number.isFinite(idx)) return;
      workspaceTransferDocFiles.splice(idx, 1);
      renderWorkspaceTransferDocsList();
    });
  }

  const resultModal = document.getElementById('workspace-item-result-modal');
  if (resultModal) {
    resultModal.addEventListener('click', (event) => {
      if (event.target === resultModal) closeWorkspaceItemResultModal();
    });
    if (resultModal.dataset.keyboardBound !== 'true') {
      resultModal.dataset.keyboardBound = 'true';
      resultModal.addEventListener('keydown', handleWorkspaceItemResultModalKeydown);
    }
  }

  const resultGood = document.getElementById('workspace-item-result-good');
  const resultDefect = document.getElementById('workspace-item-result-defect');
  const resultDelayed = document.getElementById('workspace-item-result-delayed');
  const resultCancel = document.getElementById('workspace-item-result-cancel');

  if (resultGood) resultGood.addEventListener('click', () => applyWorkspaceItemResult('GOOD'));
  if (resultDefect) resultDefect.addEventListener('click', () => applyWorkspaceItemResult('DEFECT'));
  if (resultDelayed) resultDelayed.addEventListener('click', () => applyWorkspaceItemResult('DELAYED'));
  if (resultCancel) resultCancel.addEventListener('click', () => closeWorkspaceItemResultModal());
}

function applyWorkspaceTransferAllGood() {
  const items = workspaceTransferContext?.items || [];
  if (!items.length) return;
  const nextStatus = workspaceTransferContext?.selectionMode ? 'SELECTED' : 'GOOD';
  workspaceTransferSelections = new Map(items.map(item => [item.id, nextStatus]));
  renderWorkspaceTransferList();
}

function openWorkspaceStopModal(card, op, options = {}) {
  openWorkspaceTransferModal(card, op, options);
}

function closeWorkspaceStopModal() {
  closeWorkspaceTransferModal();
}

function openWorkspaceTransferModal(card, op, options = {}) {
  if (!card || !op) return;
  ensureOpCommentsArray(op);
  ensureCardFlowForUi(card);
  const selectionMode = Boolean(options.selectionMode);
  const personalOperationId = String(options.personalOperationId || '').trim();
  const personalOperation = personalOperationId
    ? getCardPersonalOperationsUi(card, op.id).find(entry => String(entry?.id || '') === personalOperationId) || null
    : null;
  const subcontractItemIds = getWorkspaceOpenSubcontractItemIds(card, op);
  let itemsOnOp = getFlowItemsForOperation(card, op)
    .filter(item => item?.current?.status === 'PENDING')
    .filter(item => !subcontractItemIds.size || subcontractItemIds.has(String(item?.id || '').trim()));
  if (selectionMode) {
    itemsOnOp = getAvailableIndividualOperationItemsUi(card, op);
  } else if (personalOperation) {
    const ownedIds = new Set(getPersonalOperationPendingItemIdsUi(card, op, personalOperation));
    itemsOnOp = itemsOnOp.filter(item => ownedIds.has(String(item?.id || '').trim()));
  }
  const isIdentification = isIdentificationOperation(op);
  const isDocuments = isDocumentsOperation(op);
  const canEditNames = isIdentification && !selectionMode && op.status === 'IN_PROGRESS';
  workspaceTransferContext = {
    cardId: card.id,
    opId: op.id,
    kind: op.isSamples ? 'SAMPLE' : 'ITEM',
    items: itemsOnOp,
    flowVersion: Number.isFinite(card.flow?.version) ? card.flow.version : 1,
    isIdentification: isIdentification && !selectionMode,
    canEditNames,
    isDocuments: isDocuments && !selectionMode,
    selectionMode,
    personalOperationId,
    personalOperation
  };
  workspaceTransferSelections = new Map();
  workspaceTransferNameEdits = new Map();

  const titleEl = document.getElementById('workspace-transfer-title');
  if (titleEl) titleEl.textContent = selectionMode
    ? 'Выбор изделия/ос/ок'
    : (op.isSamples ? 'Передача образцов' : 'Передача изделий');

  const input = document.getElementById('workspace-transfer-scan-input');
  if (input) input.value = '';

  const docsSelect = document.getElementById('workspace-transfer-docs-id');
  if (docsSelect) docsSelect.value = workspaceTransferDocIdentifier || 'ХА';
  toggleWorkspaceTransferDocs(isDocuments && !selectionMode);

  const cancelBtn = document.getElementById('workspace-transfer-cancel');
  if (cancelBtn) cancelBtn.textContent = isIdentification && !selectionMode ? 'Закрыть' : 'Отмена';
  const allGoodBtn = document.getElementById('workspace-transfer-all-good');
  if (allGoodBtn) {
    allGoodBtn.classList.remove('hidden');
    allGoodBtn.textContent = selectionMode ? 'Выбрать всё' : 'Всё годно';
  }
  const printAllBtn = document.getElementById('workspace-print-all-qr-btn');
  if (printAllBtn) printAllBtn.classList.toggle('hidden', selectionMode || !isIdentification);
  updateWorkspaceTransferActionButtons();

  renderWorkspaceTransferList();

  const modal = document.getElementById('workspace-transfer-modal');
  if (modal) modal.classList.remove('hidden');

  const shouldFocusTransferInput = typeof isDesktopLayout === 'function'
    ? isDesktopLayout()
    : !isPhoneLayout() && !isTabletLayout();
  if (input && shouldFocusTransferInput) input.focus();
}

function closeWorkspaceTransferModal() {
  const modal = document.getElementById('workspace-transfer-modal');
  if (modal) modal.classList.add('hidden');
  workspaceTransferContext = null;
  workspaceTransferSelections = new Map();
  workspaceTransferNameEdits = new Map();
  workspaceTransferDocFiles = [];
  updateWorkspaceTransferActionButtons();
  renderWorkspaceTransferDocsList();
  toggleWorkspaceTransferDocs(false);
}

function updateWorkspaceTransferActionButtons() {
  const confirmBtn = document.getElementById('workspace-transfer-confirm');
  const renameBtn = document.getElementById('workspace-transfer-rename');
  const submitBtn = document.getElementById('workspace-transfer-submit');
  const resetBtn = document.getElementById('workspace-transfer-reset');
  const isIdentification = Boolean(workspaceTransferContext?.isIdentification);
  const selectionMode = Boolean(workspaceTransferContext?.selectionMode);
  const personalOperationId = String(workspaceTransferContext?.personalOperationId || '').trim();
  const personalMode = Boolean(personalOperationId);

  if (confirmBtn) {
    confirmBtn.classList.toggle('hidden', isIdentification && !selectionMode);
    confirmBtn.textContent = 'Подтвердить';
  }
  if (renameBtn) renameBtn.classList.toggle('hidden', !isIdentification);
  if (submitBtn) submitBtn.classList.toggle('hidden', !isIdentification);
  if (resetBtn) {
    resetBtn.classList.toggle('hidden', selectionMode);
    resetBtn.disabled = false;
    resetBtn.title = '';
  }
}

function getWorkspaceTransferSuccessSubject() {
  return workspaceTransferContext?.kind === 'SAMPLE' ? 'Образцы' : 'Изделия';
}

async function submitWorkspaceIdentificationAction() {
  if (!workspaceTransferContext?.isIdentification) return;
  await submitWorkspaceIdentificationModal();
}

async function submitWorkspaceTransferAction() {
  if (!workspaceTransferContext) return;
  if (workspaceTransferContext.isIdentification) {
    await submitWorkspaceTransferCommit({
      successMessage: getWorkspaceTransferSuccessSubject() + ' переданы.'
    });
    return;
  }
  await submitWorkspaceTransferModal();
}

async function resetWorkspaceTransferOperation() {
  if (!workspaceTransferContext) return;
  const { cardId, opId, flowVersion, personalOperationId } = workspaceTransferContext;
  const resetBtn = document.getElementById('workspace-transfer-reset');
  if (resetBtn) resetBtn.disabled = true;
  try {
    const isPersonalOperation = Boolean(String(personalOperationId || '').trim());
    const url = isPersonalOperation ? '/api/production/personal-operation/action' : '/api/production/operation/reset';
    const routeContext = captureClientWriteRouteContext();
    const result = await runProductionExecutionWriteRequest({
      action: 'workspace-transfer-reset',
      writePath: url,
      cardId,
      expectedFlowVersion: flowVersion,
      routeContext,
      defaultErrorMessage: 'Не удалось завершить операцию.',
      request: () => apiFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isPersonalOperation
          ? {
            cardId,
            parentOpId: opId,
            personalOperationId,
            action: 'reset',
            expectedFlowVersion: flowVersion
          }
          : {
            cardId,
            opId,
            expectedFlowVersion: flowVersion,
            source: getWorkspaceActionSource()
          })
      })
    });
    if (!result.ok) {
      showToast(result.message || 'Не удалось завершить операцию.');
      return;
    }

    const payload = result.payload || {};
    if (Number.isFinite(payload.flowVersion) && workspaceTransferContext) {
      workspaceTransferContext.flowVersion = payload.flowVersion;
    }
    closeWorkspaceTransferModal();
    const { card, op } = getWorkspaceCardAndOperation(cardId, opId);
    if (card && op) {
      applyWorkspaceLocalOperationAction(card, op, 'reset', {
        personalOperationId,
        flowVersion: payload.flowVersion
      });
      refreshWorkspaceUiAfterAction('workspace-reset-operation');
    } else {
      await forceRefreshWorkspaceProductionData('workspace-reset-operation');
    }
  } catch (err) {
    console.error('workspace reset operation failed', err);
    showToast('Ошибка соединения при завершении операции.');
  } finally {
    if (resetBtn) resetBtn.disabled = false;
  }
}

function renderWorkspaceTransferList() {
  const container = document.getElementById('workspace-transfer-list');
  if (!container) return;
  const items = workspaceTransferContext?.items || [];
  const isIdentification = Boolean(workspaceTransferContext?.isIdentification);
  const selectionMode = Boolean(workspaceTransferContext?.selectionMode);
  const isSamples = workspaceTransferContext?.kind === 'SAMPLE';
  const canEditNames = Boolean(workspaceTransferContext?.canEditNames);
  const card = getWorkspaceTransferCard();
  if (!items.length) {
    container.innerHTML = '<div class="muted">Нет изделий на операции</div>';
    return;
  }

  container.innerHTML = items.map(item => {
    const selected = workspaceTransferSelections.get(item.id);
    const rawNameValue = workspaceTransferNameEdits.get(item.id) ?? (item.displayName || '');
    const nameValue = normalizeWorkspaceDisplayName(rawNameValue);
    const qrValue = resolveWorkspaceTransferItemQr(card, nameValue, item.qr || '');
    const btn = (status, label) => {
      const cls = selected === status ? 'workspace-transfer-status-btn is-selected' : 'workspace-transfer-status-btn';
      return `<button type="button" class="${cls}" data-item-id="${item.id}" data-item-status="${status}">${label}</button>`;
    };
    return `
      <div class="workspace-transfer-item" data-item-id="${item.id}">
        <div class="workspace-transfer-item-header">
          <div class="workspace-transfer-item-name">
            ${isIdentification
              ? `<input class="workspace-transfer-item-name" data-item-id="${item.id}" value="${escapeHtml(nameValue)}" ${canEditNames ? '' : 'disabled'} />`
              : `${escapeHtml(nameValue)}`}
          </div>
          <div class="workspace-transfer-item-qr">${escapeHtml(qrValue)}</div>
          ${isIdentification
            ? `<div class="workspace-transfer-item-qr-actions">
                <button type="button" class="serials-qr-btn" data-item-id="${item.id}" data-allow-view="true" aria-label="QR-код изделия">QR</button>
                <button type="button" class="serials-qr-print-btn" data-item-id="${item.id}">Печать</button>
              </div>`
            : ''}
        </div>
        <div class="workspace-transfer-item-actions">
          ${selectionMode
            ? btn('SELECTED', 'Выбрать')
            : (isSamples
              ? (btn('GOOD', 'Годно') + btn('DELAYED', 'Задержано'))
              : (btn('GOOD', 'Годно') + btn('DEFECT', 'Брак') + btn('DELAYED', 'Задержано')))}
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('button[data-item-status]').forEach(btn => {
    btn.addEventListener('click', () => {
      const itemId = btn.getAttribute('data-item-id');
      const status = btn.getAttribute('data-item-status');
      if (isSamples && status === 'DEFECT') return;
      if (!itemId || !status) return;
      setWorkspaceTransferSelection(itemId, status);
    });
  });

  container.querySelectorAll('input.workspace-transfer-item-name').forEach(input => {
    input.addEventListener('input', () => {
      const itemId = input.getAttribute('data-item-id');
      if (!itemId) return;
      workspaceTransferNameEdits.set(itemId, input.value || '');
      const row = input.closest('.workspace-transfer-item');
      const qrEl = row ? row.querySelector('.workspace-transfer-item-qr') : null;
      if (qrEl) {
        const nextValue = resolveWorkspaceTransferItemQr(card, normalizeWorkspaceDisplayName(input.value || ''), '');
        qrEl.textContent = nextValue || '';
      }
    });
  });

  container.querySelectorAll('.serials-qr-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const itemId = btn.getAttribute('data-item-id');
      const card = getWorkspaceTransferCard();
      if (!itemId || !card) return;
      const item = items.find(entry => entry && entry.id === itemId) || null;
      if (!item) return;
      const name = resolveWorkspaceTransferItemName(itemId, item?.displayName || '', container);
      const qrValue = getWorkspaceTransferExistingItemQr(card, item, name);
      if (!name && !qrValue) {
        if (!workspaceTransferContext?.isDocuments) {
          showToast?.('Введите индивидуальный номер изделия') || alert('Введите индивидуальный номер изделия');
        }
        return;
      }
      if (!qrValue) {
        showToast?.('Сначала сохраните индивидуальный номер, затем откройте QR-код.') || alert('Сначала сохраните индивидуальный номер, затем откройте QR-код.');
        return;
      }
      if (typeof openPartBarcodeModal === 'function') {
        openPartBarcodeModal(card, {
          ...item,
          qr: qrValue,
          displayName: name || item.displayName || item.id || ''
        });
      }
    });
  });

  container.querySelectorAll('.serials-qr-print-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const itemId = btn.getAttribute('data-item-id');
      const card = getWorkspaceTransferCard();
      if (!itemId || !card) return;
      const item = items.find(entry => entry && entry.id === itemId) || null;
      const name = resolveWorkspaceTransferItemName(itemId, item?.displayName || '', container);
      const qrValue = getWorkspaceTransferExistingItemQr(card, item, name);
      if (!name && !qrValue) {
        if (!workspaceTransferContext?.isDocuments) {
          showToast?.('Введите индивидуальный номер изделия') || alert('Введите индивидуальный номер изделия');
        }
        return;
      }
      if (!qrValue) {
        showToast?.('Сначала сохраните индивидуальный номер, затем распечатайте QR-код.') || alert('Сначала сохраните индивидуальный номер, затем распечатайте QR-код.');
        return;
      }
      openPartBarcodePrintBatch([{
        value: qrValue,
        routeNumber: trimToString(card?.routeCardNumber || ''),
        itemName: getCardItemName(card) || '',
        serial: name || item?.displayName || item?.id || '',
        extra: [trimToString(card?.routeCardNumber || '') ? `МК: ${trimToString(card?.routeCardNumber || '')}` : '', (name || item?.displayName || item?.id || '') ? `№ детали: ${name || item?.displayName || item?.id || ''}` : ''].filter(Boolean).join(' · ')
      }], 'QR-код изделия');
    });
  });

  const printAllBtn = document.getElementById('workspace-print-all-qr-btn');
  if (printAllBtn) {
    printAllBtn.onclick = () => {
      const card = getWorkspaceTransferCard();
      if (!card) return;
      const qrItems = items.map(item => {
        const name = (workspaceTransferNameEdits.get(item.id) || item.displayName || '').trim();
        const value = trimToString(item?.qr || '');
        if (!value) return null;
        return {
          value,
          routeNumber: trimToString(card?.routeCardNumber || ''),
          itemName: getCardItemName(card) || '',
          serial: name || item?.id || '',
          extra: [trimToString(card?.routeCardNumber || '') ? `МК: ${trimToString(card?.routeCardNumber || '')}` : '', (name || item?.id || '') ? `№ детали: ${name || item?.id || ''}` : ''].filter(Boolean).join(' · ')
        };
      }).filter(Boolean);
      if (!qrItems.length) {
        showToast?.('Нет индивидуальных номеров для печати QR') || alert('Нет индивидуальных номеров для печати QR');
        return;
      }
      openPartBarcodePrintBatch(qrItems, 'QR-код изделия');
    };
  }
}

function setWorkspaceTransferSelection(itemId, status) {
  if (!workspaceTransferContext || !itemId || !status) return;
  if (workspaceTransferContext.selectionMode && workspaceTransferSelections.get(itemId) === status) {
    workspaceTransferSelections.delete(itemId);
  } else {
    workspaceTransferSelections.set(itemId, status);
  }
  renderWorkspaceTransferList();
}

function getWorkspaceTransferCard() {
  const cardId = workspaceTransferContext?.cardId;
  if (!cardId) return null;
  return cards.find(card => card && card.id === cardId) || null;
}

function resolveWorkspaceTransferItemQr(card, nameValue, fallbackQr, { persist = false } = {}) {
  const directQr = normalizeWorkspaceDisplayName(fallbackQr);
  if (directQr) return directQr;
  const serial = (nameValue || '').toString().trim();
  if (card && serial && typeof findFlowItemByDisplayName === 'function') {
    const flowItem = findFlowItemByDisplayName(card, serial);
    const flowQr = normalizeWorkspaceDisplayName(flowItem?.qr || '');
    if (flowQr) return flowQr;
  }
  if (card && serial && card.partQrs && typeof card.partQrs === 'object' && !Array.isArray(card.partQrs)) {
    const existingQr = normalizeWorkspaceDisplayName(card.partQrs[serial] || '');
    if (existingQr) return existingQr;
  }
  const normalizedFallback = normalizeWorkspaceDisplayName(fallbackQr);
  return normalizedFallback || serial || '';
}

function getWorkspaceTransferExistingItemQr(card, item, nameValue = '') {
  const directQr = normalizeWorkspaceDisplayName(item?.qr || '');
  if (directQr) return directQr;
  const name = normalizeWorkspaceDisplayName(nameValue || item?.displayName || '');
  if (!card || !name) return '';
  if (typeof findFlowItemByDisplayName === 'function') {
    const flowItem = findFlowItemByDisplayName(card, name);
    const flowQr = normalizeWorkspaceDisplayName(flowItem?.qr || '');
    if (flowQr) return flowQr;
  }
  if (card.partQrs && typeof card.partQrs === 'object' && !Array.isArray(card.partQrs)) {
    return normalizeWorkspaceDisplayName(card.partQrs[name] || '');
  }
  return '';
}

function resolveWorkspaceTransferItemName(itemId, fallbackName, scopeEl) {
  const scope = scopeEl || document;
  const input = scope.querySelector('input.workspace-transfer-item-name[data-item-id="' + itemId + '"]');
  if (input && typeof input.value === 'string') {
    const inputValue = normalizeWorkspaceDisplayName(input.value);
    if (inputValue) return inputValue;
  }
  const edited = normalizeWorkspaceDisplayName(workspaceTransferNameEdits.get(itemId));
  if (edited) return edited;
  return normalizeWorkspaceDisplayName(fallbackName);
}

function normalizeWorkspaceDisplayName(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (typeof value === 'object') {
    if (typeof value.name === 'string') return value.name.trim();
    if (typeof value.label === 'string') return value.label.trim();
    if (typeof value.value === 'string') return value.value.trim();
    if (typeof value.qr === 'string') return value.qr.trim();
    if (typeof value.code === 'string') return value.code.trim();
    if (typeof value.id === 'string') return value.id.trim();
  }
  return '';
}

function validateWorkspaceIdentificationNames(card, updatesById) {
  const items = Array.isArray(card?.flow?.items) ? card.flow.items : [];
  const samples = Array.isArray(card?.flow?.samples) ? card.flow.samples : [];
  const all = items.concat(samples);
  const normalized = new Set();
  for (const item of all) {
    const nextName = (updatesById.get(item.id) ?? item.displayName ?? '').toString().trim();
    if (!nextName) return 'Заполните индивидуальные номера изделий.';
    const key = nextName.toLowerCase();
    if (normalized.has(key)) return 'Индивидуальные номера должны быть уникальны внутри МК.';
    normalized.add(key);
  }
  return '';
}

async function submitWorkspaceIdentificationModal() {
  if (!workspaceTransferContext) return;
  const { cardId, opId, flowVersion, canEditNames, personalOperationId } = workspaceTransferContext;
  const card = getWorkspaceTransferCard();
  if (!card) return;
  const op = (card.operations || []).find(item => item.id === opId) || null;
  if (!op || !isIdentificationOperation(op)) return;
  if (!canEditNames) {
    showToast('Изменение номеров доступно только при статусе "В работе".');
    return false;
  }

  const updatesById = new Map();
  const updates = (workspaceTransferContext.items || []).map(item => {
    const nextName = (workspaceTransferNameEdits.get(item.id) ?? item.displayName ?? '').toString().trim();
    updatesById.set(item.id, nextName);
    return { itemId: item.id, name: nextName, prev: (item.displayName || '').toString().trim() };
  });

  const validationError = validateWorkspaceIdentificationNames(card, updatesById);
  if (validationError) {
    showToast(validationError);
    return false;
  }

  const changes = updates.filter(entry => entry.name && entry.name !== entry.prev);
  if (!changes.length) {
    showToast('Изменений нет.');
    return false;
  }

  const activeBtn = workspaceTransferContext?.isIdentification
    ? document.getElementById('workspace-transfer-rename')
    : document.getElementById('workspace-transfer-confirm');
  if (activeBtn) activeBtn.disabled = true;
  try {
    let suppressConflictMessage = false;
    const result = await runClientWriteRequest({
      action: 'workspace-identify',
      writePath: '/api/production/flow/identify',
      entity: 'card.flow',
      entityId: cardId,
      expectedRev: flowVersion,
      routeContext: captureClientWriteRouteContext(),
      defaultErrorMessage: 'Не удалось сохранить изменения.',
      request: () => apiFetch('/api/production/flow/identify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cardId,
          opId,
          personalOperationId,
          expectedFlowVersion: flowVersion,
          updates: changes.map(entry => ({ itemId: entry.itemId, name: entry.name }))
        })
      }),
      conflictRefresh: async ({ message, payload: conflictPayload, routeContext }) => {
        if (!isFlowVersionConflictMessage(message)) return;
        const reloadKey = `flowReloadIdentify:${cardId}:${opId}`;
        const refreshed = await runClientConflictRefreshOnce({
          guardKey: reloadKey,
          refresh: () => forceRefreshWorkspaceProductionData('workspace-identify-stale', {
            diagnosticContext: {
              prefix: '[CONFLICT]',
              payload: buildClientWriteDiagnosticPayload({
                action: 'workspace-identify',
                writePath: '/api/production/flow/identify',
                routeContext,
                payload: conflictPayload,
                entity: 'card.flow',
                id: cardId,
                expectedRev: flowVersion
              })
            }
          })
        });
        if (refreshed) {
          suppressConflictMessage = true;
        }
      }
    });
    if (!result.ok) {
      if (!suppressConflictMessage) {
        showToast(result.message);
      }
      return false;
    }
    const payload = result.payload || {};
    if (Number.isFinite(payload.flowVersion) && workspaceTransferContext) {
      workspaceTransferContext.flowVersion = payload.flowVersion;
    }
    const reloadKey = `flowReloadIdentify:${cardId}:${opId}`;
    sessionStorage.removeItem(reloadKey);
    const { card: updatedCard, op: updatedOp } = getWorkspaceCardAndOperation(cardId, opId);
    if (updatedCard && updatedOp && applyWorkspaceLocalIdentification(updatedCard, updatedOp, changes, payload.flowVersion)) {
      updateCardPartQrMap(updatedCard, updatedCard.itemSerials);
      refreshWorkspaceUiAfterAction('workspace-identify');
    } else {
      await forceRefreshWorkspaceProductionData('workspace-identify');
    }
    workspaceTransferNameEdits = new Map();
    renderWorkspaceTransferList();
    showToast(getWorkspaceTransferSuccessSubject() + ' переименованы.');
    return true;
  } catch (err) {
    console.error('workspace identification failed', err);
    showToast('Ошибка соединения при сохранении.');
    return false;
  } finally {
    if (activeBtn) activeBtn.disabled = false;
  }
}

function handleWorkspaceTransferScan(value) {
  if (!workspaceTransferContext) return;
  const term = (value || '').toString().trim();
  if (!term) return;
  const norm = term.toLowerCase();
  const items = workspaceTransferContext.items || [];
  const card = getWorkspaceTransferCard();
  const matches = items.filter(item => {
    const edited = workspaceTransferNameEdits.get(item.id);
    const name = normalizeWorkspaceDisplayName(edited ?? item.displayName ?? '');
    const qr = resolveWorkspaceTransferItemQr(card, name, item.qr || '');
    const rawQr = (item.qr || '').toString().trim().toLowerCase();
    const legacyQrs = Array.isArray(item?.legacyQrs)
      ? item.legacyQrs.map(value => normalizeWorkspaceDisplayName(value).toLowerCase()).filter(Boolean)
      : [];
    const normalizedName = name.toLowerCase();
    const normalizedQr = (qr || '').toString().trim().toLowerCase();
    return (normalizedQr && normalizedQr === norm)
      || (rawQr && rawQr === norm)
      || legacyQrs.includes(norm)
      || (normalizedName && normalizedName === norm);
  });

  if (matches.length === 1) {
    if (workspaceTransferContext.selectionMode) {
      setWorkspaceTransferSelection(matches[0].id, 'SELECTED');
    } else {
      openWorkspaceItemResultModal(matches[0]);
    }
  } else if (matches.length === 0) {
    showToast('Изделие не найдено');
  } else {
    showToast('Найдено несколько совпадений');
  }
}

function openWorkspaceItemResultModal(item) {
  if (!item) return;
  workspaceItemResultContext = { itemId: item.id };
  const titleEl = document.getElementById('workspace-item-result-title');
  const qrEl = document.getElementById('workspace-item-result-qr');
  if (titleEl) {
    const titleText = normalizeWorkspaceDisplayName(item.displayName) || 'Изделие';
    titleEl.textContent = titleText;
  }
  if (qrEl) {
    const card = getWorkspaceTransferCard();
    const nameValue = normalizeWorkspaceDisplayName(
      workspaceTransferNameEdits.get(item.id) || item.displayName || ''
    );
    qrEl.textContent = resolveWorkspaceTransferItemQr(card, nameValue, item.qr || '');
  }
  const modal = document.getElementById('workspace-item-result-modal');
  if (modal) modal.classList.remove('hidden');
  focusWorkspaceItemResultButton(0);
}

function closeWorkspaceItemResultModal() {
  const modal = document.getElementById('workspace-item-result-modal');
  if (modal) modal.classList.add('hidden');
  workspaceItemResultContext = null;
  const input = document.getElementById('workspace-transfer-scan-input');
  if (input) input.value = '';
  const shouldFocusTransferInput = typeof isDesktopLayout === 'function'
    ? isDesktopLayout()
    : !isPhoneLayout() && !isTabletLayout();
  if (input && shouldFocusTransferInput) input.focus();
}

function applyWorkspaceItemResult(status) {
  if (!workspaceItemResultContext) return;
  const itemId = workspaceItemResultContext.itemId;
  setWorkspaceTransferSelection(itemId, status);
  closeWorkspaceItemResultModal();
}

function getWorkspaceItemResultButtons() {
  return [
    document.getElementById('workspace-item-result-good'),
    document.getElementById('workspace-item-result-defect'),
    document.getElementById('workspace-item-result-delayed'),
    document.getElementById('workspace-item-result-cancel')
  ].filter(btn => btn && !btn.disabled && !btn.classList.contains('hidden'));
}

function focusWorkspaceItemResultButton(index) {
  const buttons = getWorkspaceItemResultButtons();
  if (!buttons.length) return;
  const normalizedIndex = ((index % buttons.length) + buttons.length) % buttons.length;
  buttons[normalizedIndex].focus();
}

function moveWorkspaceItemResultFocus(step) {
  const buttons = getWorkspaceItemResultButtons();
  if (!buttons.length) return;
  const currentIndex = buttons.indexOf(document.activeElement);
  const nextIndex = currentIndex >= 0 ? currentIndex + step : 0;
  focusWorkspaceItemResultButton(nextIndex);
}

function handleWorkspaceItemResultModalKeydown(event) {
  const modal = document.getElementById('workspace-item-result-modal');
  if (!modal || modal.classList.contains('hidden')) return;

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveWorkspaceItemResultFocus(-1);
    return;
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveWorkspaceItemResultFocus(1);
    return;
  }

  if (event.key === 'Enter') {
    const buttons = getWorkspaceItemResultButtons();
    const activeButton = buttons.find(btn => btn === document.activeElement) || buttons[0];
    if (!activeButton) return;
    event.preventDefault();
    activeButton.click();
  }
}

async function submitWorkspaceTransferCommit({ keepOpen = false, successMessage = '' } = {}) {
  if (!workspaceTransferContext) return false;
  const { cardId, opId, kind, selectionMode, personalOperationId } = workspaceTransferContext;
  const card = getWorkspaceTransferCard();
  const flowVersion = Number.isFinite(card?.flow?.version)
    ? card.flow.version
    : workspaceTransferContext.flowVersion;
  const selectedEntries = Array.from(workspaceTransferSelections.entries());
  const updates = selectedEntries.map(([itemId, status]) => ({
    itemId,
    status,
    comment: ''
  }));

  if (!updates.length) {
    showToast(selectionMode ? 'Выберите хотя бы одно изделие.' : 'Выберите статус хотя бы для одного изделия.');
    return false;
  }

  const activeBtn = workspaceTransferContext?.isIdentification
    ? document.getElementById('workspace-transfer-submit')
    : document.getElementById('workspace-transfer-confirm');
  if (activeBtn) activeBtn.disabled = true;
  try {
    const url = selectionMode ? '/api/production/personal-operation/select' : '/api/production/flow/commit';
    const body = selectionMode
      ? {
        cardId,
        parentOpId: opId,
        kind,
        expectedFlowVersion: flowVersion,
        selectedItemIds: selectedEntries.map(([itemId]) => itemId)
      }
      : {
        cardId,
        opId,
        personalOperationId,
        kind,
        updates,
        expectedFlowVersion: flowVersion
      };
    const routeContext = captureClientWriteRouteContext();
    const result = await runProductionExecutionWriteRequest({
      action: selectionMode ? 'workspace-personal-operation-select' : 'workspace-transfer-commit',
      writePath: url,
      cardId,
      expectedFlowVersion: flowVersion,
      routeContext,
      defaultErrorMessage: 'Не удалось сохранить изменения.',
      defaultConflictMessage: 'Данные операции уже изменились. Данные обновлены, попробуйте выполнить действие снова.',
      request: () => apiFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
    });
    if (!result.ok) {
      showToast(result.message || 'Не удалось сохранить изменения.');
      if (selectionMode) {
        if (workspaceTransferContext) {
          renderWorkspaceTransferList();
        }
      }
      return false;
    }

    const payload = result.payload || {};
    if (Number.isFinite(payload.flowVersion) && workspaceTransferContext) {
      workspaceTransferContext.flowVersion = payload.flowVersion;
    }
    const currentCard = getWorkspaceTransferCard();
    const currentOp = currentCard ? (currentCard.operations || []).find(item => item && item.id === opId) || null : null;
    let patched = false;
    if (selectionMode) {
      patched = currentCard && currentOp && applyWorkspaceLocalTransferSelection(
        currentCard,
        currentOp,
        selectedEntries.map(([itemId]) => itemId),
        payload.flowVersion,
        payload.personalOperationId || ''
      );
    } else {
      patched = currentCard && currentOp && applyWorkspaceLocalTransferCommit(currentCard, currentOp, {
        kind,
        updates,
        personalOperationId,
        flowVersion: payload.flowVersion
      });
    }
    if (!keepOpen) closeWorkspaceTransferModal();
    if (patched && getWorkspaceActionSource() === 'workspace') {
      window.__workspaceStructuredCardEventAt = 0;
      suppressWorkspaceLiveRefresh();
      refreshWorkspaceUiAfterAction('workspace-transfer-commit');
      scheduleWorkspaceCommitFallbackRefresh(cardId);
      if (workspaceTransferContext) {
        renderWorkspaceTransferList();
      }
    } else {
      await forceRefreshWorkspaceProductionData('workspace-transfer-commit');
    }
    if (successMessage) showToast(successMessage);
    return true;
  } catch (err) {
    console.error('workspace transfer failed', err);
    showToast('Ошибка соединения при сохранении.');
    return false;
  } finally {
    if (activeBtn) activeBtn.disabled = false;
  }
}

async function submitWorkspaceTransferModal() {
  if (!workspaceTransferContext) return;
  if (workspaceTransferContext.selectionMode) {
    await submitWorkspaceTransferCommit();
    return;
  }
  const isIdentification = workspaceTransferContext.isIdentification;
  const isDocuments = workspaceTransferContext.isDocuments;
  if (isIdentification) {
    const savedNames = await submitWorkspaceIdentificationModal();
    const savedStatuses = await submitWorkspaceTransferCommit({ keepOpen: true });
    if (!savedNames && !savedStatuses) return;
    return;
  }
  if (isDocuments) {
    const itemsLabel = buildWorkspaceTransferItemsLabel();
    const savedStatuses = await submitWorkspaceTransferCommit({ keepOpen: true });
    if (!savedStatuses) return;
    const uploadedDocuments = await uploadWorkspaceTransferDocuments({ itemsLabel });
    if (uploadedDocuments) {
      closeWorkspaceTransferModal();
    }
    return;
  }
  await submitWorkspaceTransferCommit();
}

function collectMaterialIssueItemsOrdered(card) {
  if (!card) return [];
  const issues = Array.isArray(card.materialIssues) ? card.materialIssues : [];
  const issuesByOpId = new Map(issues.map(entry => [entry?.opId || '', entry]));
  const ops = [...(card.operations || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const rows = [];
  ops.forEach(op => {
    if (!op || !isMaterialIssueOperation(op)) return;
    const entry = issuesByOpId.get(op.id) || null;
    const items = Array.isArray(entry?.items) ? entry.items : [];
    items.forEach((item, itemIndex) => {
      rows.push({ opId: op.id, itemIndex, item });
    });
  });
  return rows;
}

function resolveIssueUnitFromMainMaterials(card, item) {
  if (!card || !item || !card.mainMaterials) return '';
  const name = (item.name || '').trim();
  const qty = (item.qty || '').trim();
  if (!name || !qty) return '';
  const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const namePart = escapeRegExp(name);
  const qtyPart = escapeRegExp(qty);
  const re = new RegExp('^' + namePart + ';\s+' + qtyPart + '\s+(.+?);\s+тип-(порошок|нет)', 'i');
  const lines = card.mainMaterials.split('\n');
  for (const line of lines) {
    const trimmed = (line || '').trim();
    if (!trimmed) continue;
    const match = trimmed.match(re);
    if (match && match[1]) return match[1].trim();
  }
  return '';
}

function getMaterialSourceKey(opId, itemIndex) {
  return (opId || '').toString() + '|' + (Number.isFinite(Number(itemIndex)) ? Number(itemIndex) : -1);
}

function buildActiveDryingQtyBySource(card) {
  const activeBySource = new Map();
  const entries = Array.isArray(card?.materialIssues) ? card.materialIssues : [];
  entries.forEach(entry => {
    const rows = Array.isArray(entry?.dryingRows) ? entry.dryingRows : [];
    rows.forEach(row => {
      if (String(row?.status || '').toUpperCase() !== 'IN_PROGRESS') return;
      const dryQty = normalizeDecimalDisplayInput(row?.dryQty || '') || (row?.dryQty || '').toString();
      if (!parseDecimalNormalized(dryQty)) return;
      const sourceOpId = (row?.sourceIssueOpId || '').toString();
      const sourceItemIndex = Number.isFinite(Number(row?.sourceItemIndex)) ? Number(row.sourceItemIndex) : -1;
      if (!sourceOpId || sourceItemIndex < 0) return;
      const key = getMaterialSourceKey(sourceOpId, sourceItemIndex);
      const current = activeBySource.get(key) || '0';
      activeBySource.set(key, addDecimalStrings(current, dryQty) || current);
    });
  });
  return activeBySource;
}

function getMaterialReturnAvailableQty(entry, issuedQty, activeDryingQtyBySource) {
  const item = entry?.item || {};
  const qtyDisplay = normalizeDecimalDisplayInput(issuedQty || '') || (issuedQty || '').toString();
  if (!item.isPowder) return qtyDisplay;
  const key = getMaterialSourceKey(entry.opId, entry.itemIndex);
  const activeQty = activeDryingQtyBySource.get(key) || '0';
  const cmp = compareDecimalStrings(qtyDisplay || '0', activeQty || '0');
  if (cmp == null || cmp <= 0) return '0';
  return subtractDecimalStrings(qtyDisplay || '0', activeQty || '0') || '0';
}

function buildMaterialReturnRows(card) {
  const ordered = collectMaterialIssueItemsOrdered(card);
  const activeDryingQtyBySource = buildActiveDryingQtyBySource(card);
  return ordered.map((entry, sourceIndex) => {
    const item = entry.item || {};
    const rawQty = item.qty || '';
    const issuedQtyDisplay = normalizeDecimalDisplayInput(rawQty) || rawQty;
    const availableQtyDisplay = getMaterialReturnAvailableQty(entry, issuedQtyDisplay, activeDryingQtyBySource);
    const returnDisplay = normalizeDecimalDisplayInput(item.returnQty || '') || (item.returnQty || '');
    const balanceDisplay = item.balanceQty
      ? (normalizeDecimalDisplayInput(item.balanceQty) || item.balanceQty)
      : (issuedQtyDisplay ? subtractDecimalStrings(issuedQtyDisplay, returnDisplay || '0') : '');
    const resolvedUnit = item.unit || resolveIssueUnitFromMainMaterials(card, item) || 'кг';
    return {
      sourceIndex,
      name: item.name || '',
      qty: availableQtyDisplay || '',
      issuedQty: issuedQtyDisplay || '',
      rawQty: rawQty || '',
      unit: resolvedUnit,
      isPowder: Boolean(item.isPowder),
      returnQty: returnDisplay || '',
      balanceQty: balanceDisplay || ''
    };
  });
}

function renderMaterialReturnTable(rows, { readonly = false } = {}) {
  const rowsHtml = (rows || []).map((row, idx) => {
    const powder = row.isPowder ? 'Да' : 'Нет';
    const returnCell = readonly
      ? '<td class="material-return-return" data-row-index="' + idx + '">' + escapeHtml(row.returnQty || '0') + '</td>'
      : '<td><input type="text" class="material-return-input" data-row-index="' + idx + '" value="' + escapeHtml(row.returnQty || '') + '" /></td>';
    return '<tr data-row-index="' + idx + '">' +
      '<td>' + (idx + 1) + '</td>' +
      '<td>' + escapeHtml(row.name || '') + '</td>' +
      '<td>' + escapeHtml(row.qty || '') + '</td>' +
      '<td>' + escapeHtml(row.unit || '') + '</td>' +
      '<td>' + powder + '</td>' +
      returnCell +
      '<td class="material-return-balance" data-row-index="' + idx + '">' + escapeHtml(row.balanceQty || '') + '</td>' +
    '</tr>';
  }).join('');

  return '<table class="material-issue-table"><thead><tr>' +
    '<th>№</th><th>Наименование материала</th><th>Кол-во.</th><th>Ед. изм.</th><th>Порошок</th><th>Возврат</th><th>Остаток</th>' +
    '</tr></thead><tbody>' + rowsHtml + '</tbody></table>';
}

function openMaterialIssueModal(card, op) {
  if (!card || !op) return;
  const existing = Array.isArray(card.materialIssues)
    ? card.materialIssues.find(entry => (entry?.opId || '') === op.id)
    : null;
  materialIssueRows = Array.isArray(existing?.items)
    ? existing.items.map(item => ({
      name: item?.name || '',
      qty: normalizeDecimalDisplayInput(item?.qty || '') || (item?.qty || ''),
      unit: item?.unit || 'кг',
      isPowder: Boolean(item?.isPowder),
      locked: true
    }))
    : [{ name: '', qty: '', unit: 'кг', isPowder: false }];
  if (!materialIssueRows.length) materialIssueRows = [{ name: '', qty: '', unit: 'кг', isPowder: false }];
  materialIssueContext = {
    cardId: card.id,
    opId: op.id,
    flowVersion: Number.isFinite(card.flow?.version) ? card.flow.version : 1
  };
  const titleEl = document.getElementById('material-issue-title');
  if (titleEl) titleEl.textContent = 'Выдача материала';
  renderMaterialIssueTable();
  const modal = document.getElementById('material-issue-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeMaterialIssueModal() {
  const modal = document.getElementById('material-issue-modal');
  if (modal) modal.classList.add('hidden');
  materialIssueContext = null;
  materialIssueRows = [];
}

function renderMaterialIssueTable() {
  const wrapper = document.getElementById('material-issue-table-wrapper');
  if (!wrapper) return;
  if (!materialIssueRows.length) materialIssueRows = [{ name: '', qty: '', unit: 'кг', isPowder: false }];
  const rowsHtml = materialIssueRows.map((row, idx) => {
    const isLocked = Boolean(row.locked);
    const unitValue = row.unit || 'кг';
    const unitOptions = MATERIAL_UNIT_OPTIONS.map(unit =>
      '<option value="' + escapeHtml(unit) + '"' + (unit === unitValue ? ' selected' : '') + '>' + escapeHtml(unit) + '</option>'
    ).join('');
    return '<tr data-row-index="' + idx + '">' +
      '<td>' + (idx + 1) + '</td>' +
      '<td><input type="text" class="material-issue-input" data-field="name" value="' + escapeHtml(row.name || '') + '"' + (isLocked ? ' disabled' : '') + ' /></td>' +
      '<td><input type="text" class="material-issue-input" data-field="qty" value="' + escapeHtml(row.qty || '') + '"' + (isLocked ? ' disabled' : '') + ' /></td>' +
      '<td><select class="material-issue-unit" data-field="unit"' + (isLocked ? ' disabled' : '') + '>' + unitOptions + '</select></td>' +
      '<td><input type="checkbox" class="material-issue-checkbox" data-field="isPowder"' + (row.isPowder ? ' checked' : '') + (isLocked ? ' disabled' : '') + ' /></td>' +
      '<td>' + (isLocked ? '' : '<button type="button" class="btn-small btn-delete" data-action="remove">🗑️</button>') + '</td>' +
    '</tr>';
  }).join('');

  wrapper.innerHTML = '<table class="material-issue-table"><thead><tr>' +
    '<th>№</th><th>Наименование материала</th><th>Кол-во.</th><th>Ед. изм.</th><th>Порошок</th><th></th>' +
    '</tr></thead><tbody>' + rowsHtml + '</tbody></table>';

  wrapper.querySelectorAll('tr[data-row-index]').forEach(row => {
    const idx = parseInt(row.getAttribute('data-row-index'), 10);
    if (Number.isNaN(idx) || !materialIssueRows[idx]) return;
    if (materialIssueRows[idx].locked) return;
    row.querySelectorAll('.material-issue-input').forEach(input => {
      input.addEventListener('input', () => {
        const field = input.getAttribute('data-field');
        if (!field) return;
        if (field === 'qty') {
          const normalized = normalizeDecimalDisplayInput(input.value);
          input.value = normalized;
          materialIssueRows[idx][field] = normalized;
          return;
        }
        materialIssueRows[idx][field] = input.value;
      });
    });
    row.querySelectorAll('.material-issue-checkbox').forEach(input => {
      input.addEventListener('change', () => {
        materialIssueRows[idx].isPowder = input.checked;
      });
    });
    row.querySelectorAll('.material-issue-unit').forEach(input => {
      input.addEventListener('change', () => {
        materialIssueRows[idx].unit = input.value || 'кг';
      });
    });
    const removeBtn = row.querySelector('button[data-action="remove"]');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        materialIssueRows.splice(idx, 1);
        renderMaterialIssueTable();
      });
    }
  });
}

function collectMaterialIssueRows() {
  return materialIssueRows
    .filter(row => !row.locked)
    .map(row => ({
      name: (row.name || '').toString().trim(),
      qty: (row.qty || '').toString().trim(),
      unit: (row.unit || 'кг').toString().trim(),
      isPowder: Boolean(row.isPowder)
    }))
    .filter(row => row.name || row.qty);
}

function analyzeMaterialIssueRows() {
  const draftRows = materialIssueRows
    .filter(row => !row.locked)
    .map(row => ({
      name: (row.name || '').toString().trim(),
      qty: (row.qty || '').toString().trim(),
      unit: (row.unit || 'кг').toString().trim(),
      isPowder: Boolean(row.isPowder)
    }));
  const hasIssuedRows = materialIssueRows.some(row => Boolean(row?.locked));
  let hasPartialDraft = false;
  const newRows = draftRows.filter(row => {
    const isBlank = !row.name && !row.qty;
    if (isBlank) return false;
    const isValid = Boolean(row.name)
      && Boolean(row.qty)
      && MATERIAL_UNIT_OPTIONS.includes(row.unit)
      && Boolean(parseDecimalNormalized(row.qty));
    if (!isValid) {
      hasPartialDraft = true;
      return false;
    }
    return true;
  });
  return {
    hasIssuedRows,
    hasPartialDraft,
    newRows
  };
}

function validateMaterialIssueRows(rows) {
  if (!rows.length) return 'Добавьте хотя бы одну строку материала.';
  const invalid = rows.find(row => {
    if (!row.name || !row.qty) return true;
    if (!row.unit || !MATERIAL_UNIT_OPTIONS.includes(row.unit)) return true;
    return !parseDecimalNormalized(row.qty);
  });
  if (invalid) return 'Проверьте заполнение наименования и количества.';
  return '';
}

function getWorkspaceExecutionResultMessage(result, fallbackMessage = '') {
  const fallback = fallbackMessage || 'Не удалось выполнить действие.';
  if (result?.isConflict && isFlowVersionConflictMessage(result?.message || '')) {
    return 'Данные операции уже изменились. Данные обновлены, попробуйте выполнить действие снова.';
  }
  return result?.message || fallback;
}

async function refreshWorkspaceExecutionAfterLocalInvalid({
  action = 'workspace-execution-local-invalid',
  writePath = '',
  cardId = '',
  opId = '',
  expectedFlowVersion = null,
  reason = 'local-invalid'
} = {}) {
  const routeContext = captureClientWriteRouteContext();
  const diagnosticPayload = buildClientWriteDiagnosticPayload({
    action,
    writePath,
    routeContext,
    entity: 'card.flow',
    id: cardId,
    expectedRev: expectedFlowVersion,
    code: 'LOCAL_INVALID_STATE',
    extras: {
      opId
    }
  });
  await refreshProductionExecutionDataPreservingRoute({
    routeContext,
    reason: action + ':' + reason,
    writePath,
    cardId,
    diagnosticPayload
  });
}

async function runWorkspaceMaterialWriteRequest({
  action = '',
  writePath = '',
  cardId = '',
  opId = '',
  expectedFlowVersion = null,
  body = {},
  defaultErrorMessage = 'Не удалось выполнить действие.',
  defaultConflictMessage = 'Данные операции уже изменились. Данные обновлены, попробуйте выполнить действие снова.'
} = {}) {
  return runProductionExecutionWriteRequest({
    action,
    writePath,
    cardId,
    expectedFlowVersion,
    routeContext: captureClientWriteRouteContext(),
    defaultErrorMessage,
    defaultConflictMessage,
    request: () => apiFetch(writePath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cardId,
        opId,
        expectedFlowVersion,
        source: getWorkspaceActionSource(),
        ...body
      })
    })
  });
}

async function submitMaterialIssueModal() {
  if (!materialIssueContext) {
    showToast('Окно выдачи материала устарело. Откройте действие заново.');
    return false;
  }
  const analysis = analyzeMaterialIssueRows();
  const rows = analysis.newRows;
  if (analysis.hasPartialDraft) {
    showToast('Проверьте заполнение наименования и количества.');
    return;
  }
  const { cardId, opId, flowVersion } = materialIssueContext;
  const issueBtn = document.getElementById('material-issue-issue');
  if (issueBtn) issueBtn.disabled = true;
  try {
    const action = rows.length ? 'material-issue' : (analysis.hasIssuedRows ? 'material-issue-complete' : '');
    if (!action) {
      showToast('Добавьте хотя бы одну строку материала.');
      return;
    }
    if (action === 'material-issue') {
      const err = validateMaterialIssueRows(rows);
      if (err) {
        showToast(err);
        return;
      }
    }
    const writePath = '/api/production/operation/' + action;
    const localState = getWorkspaceCardAndOperation(cardId, opId);
    if (!localState.card || !localState.op) {
      showToast('Операция уже недоступна. Данные обновлены.');
      await refreshWorkspaceExecutionAfterLocalInvalid({
        action: 'workspace-material-issue',
        writePath,
        cardId,
        opId,
        expectedFlowVersion: flowVersion,
        reason: 'missing-local-context'
      });
      return false;
    }
    const result = await runWorkspaceMaterialWriteRequest({
      action: 'workspace-material-issue',
      writePath,
      cardId,
      opId,
      expectedFlowVersion: flowVersion,
      body: action === 'material-issue' ? { materials: rows } : {},
      defaultErrorMessage: 'Не удалось выдать материал.'
    });
    if (!result.ok) {
      showToast(getWorkspaceExecutionResultMessage(result, 'Не удалось выдать материал.'));
      return false;
    }
    closeMaterialIssueModal();
    const payload = result.payload || {};
    if (Number.isFinite(payload.flowVersion) && materialIssueContext) {
      materialIssueContext.flowVersion = payload.flowVersion;
    }
    const { card, op } = getWorkspaceCardAndOperation(cardId, opId);
    if (card && op && applyWorkspaceLocalMaterialIssue(card, op, rows, payload.flowVersion, {
      completeOnly: action === 'material-issue-complete'
    })) {
      refreshWorkspaceUiAfterAction('workspace-material-issue');
    } else {
      await forceRefreshWorkspaceProductionData('workspace-material-issue');
    }
    showToast(action === 'material-issue' ? 'Материал выдан.' : 'Операция завершена.');
    return true;
  } catch (err) {
    console.error('material issue failed', err);
    showToast('Ошибка соединения при выдаче материала.');
    return false;
  } finally {
    if (issueBtn) issueBtn.disabled = false;
  }
}

async function resetMaterialIssueOperation() {
  if (!materialIssueContext) {
    showToast('Окно выдачи материала устарело. Откройте действие заново.');
    return false;
  }
  const { cardId, opId, flowVersion } = materialIssueContext;
  const resetBtn = document.getElementById('material-issue-reset');
  if (resetBtn) resetBtn.disabled = true;
  try {
    const writePath = '/api/production/operation/reset';
    const localState = getWorkspaceCardAndOperation(cardId, opId);
    if (!localState.card || !localState.op) {
      showToast('Операция уже недоступна. Данные обновлены.');
      await refreshWorkspaceExecutionAfterLocalInvalid({
        action: 'workspace-material-reset',
        writePath,
        cardId,
        opId,
        expectedFlowVersion: flowVersion,
        reason: 'missing-local-context'
      });
      return false;
    }
    const result = await runWorkspaceMaterialWriteRequest({
      action: 'workspace-material-reset',
      writePath,
      cardId,
      opId,
      expectedFlowVersion: flowVersion,
      defaultErrorMessage: 'Не удалось завершить операцию.'
    });
    if (!result.ok) {
      showToast(getWorkspaceExecutionResultMessage(result, 'Не удалось завершить операцию.'));
      return false;
    }
    closeMaterialIssueModal();
    const payload = result.payload || {};
    if (Number.isFinite(payload.flowVersion) && materialIssueContext) {
      materialIssueContext.flowVersion = payload.flowVersion;
    }
    const { card, op } = getWorkspaceCardAndOperation(cardId, opId);
    if (card && op) {
      applyWorkspaceLocalOperationAction(card, op, 'reset', { flowVersion: payload.flowVersion });
      refreshWorkspaceUiAfterAction('workspace-material-reset');
    } else {
      await forceRefreshWorkspaceProductionData('workspace-material-reset');
    }
    return true;
  } catch (err) {
    console.error('material reset failed', err);
    showToast('Ошибка соединения при завершении операции.');
    return false;
  } finally {
    if (resetBtn) resetBtn.disabled = false;
  }
}

function setupMaterialIssueModal() {
  const modal = document.getElementById('material-issue-modal');
  if (!modal) return;
  const closeBtn = document.getElementById('material-issue-close');
  const cancelBtn = document.getElementById('material-issue-cancel');
  const addBtn = document.getElementById('material-issue-add-row');
  const issueBtn = document.getElementById('material-issue-issue');
  const resetBtn = document.getElementById('material-issue-reset');

  if (closeBtn) closeBtn.addEventListener('click', () => closeMaterialIssueModal());
  if (cancelBtn) cancelBtn.addEventListener('click', () => closeMaterialIssueModal());
  if (addBtn) addBtn.addEventListener('click', () => {
    materialIssueRows.push({ name: '', qty: '', unit: 'кг', isPowder: false });
    renderMaterialIssueTable();
  });
  if (issueBtn) issueBtn.addEventListener('click', () => submitMaterialIssueModal());
  if (resetBtn) resetBtn.addEventListener('click', () => resetMaterialIssueOperation());

  modal.addEventListener('click', (event) => {
    if (event.target === modal) return;
  });
}

function openDryingModal(card, op) {
  if (!card || !op) return;
  dryingRows = buildDryingRows(card, op);
  dryingContext = {
    cardId: card.id,
    opId: op.id,
    flowVersion: Number.isFinite(card.flow?.version) ? card.flow.version : 1
  };
  const titleEl = document.getElementById('drying-title');
  if (titleEl) titleEl.textContent = 'Сушка материала';
  renderDryingModalTable();
  const modal = document.getElementById('drying-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeDryingModal() {
  const modal = document.getElementById('drying-modal');
  if (modal) modal.classList.add('hidden');
  dryingContext = null;
  dryingRows = [];
}

function renderDryingModalTable() {
  const wrapper = document.getElementById('drying-table-wrapper');
  if (!wrapper) return;
  wrapper.innerHTML = renderDryingTable(dryingRows, { readonly: false });
  syncDryingCompleteButton();
  wrapper.querySelectorAll('.drying-qty-input').forEach(input => {
    input.addEventListener('input', () => {
      const rowId = input.getAttribute('data-row-id') || '';
      const row = dryingRows.find(item => (item?.rowId || '') === rowId);
      if (!row) return;
      const normalized = normalizeDecimalDisplayInput(input.value);
      input.value = normalized;
      row.dryQty = normalized;
    });
  });
  wrapper.querySelectorAll('.drying-row-action').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.getAttribute('data-action');
      const rowId = btn.getAttribute('data-row-id') || '';
      if (!rowId || !action) return;
      btn.disabled = true;
      try {
        if (action === 'start') {
          await submitDryingRowStart(rowId);
        } else if (action === 'finish') {
          await submitDryingRowFinish(rowId);
        }
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function syncDryingCompleteButton() {
  const completeBtn = document.getElementById('drying-complete');
  if (!completeBtn) return;
  const card = dryingContext ? cards.find(item => item && item.id === dryingContext.cardId) : null;
  const op = card && dryingContext ? (card.operations || []).find(item => item && item.id === dryingContext.opId) : null;
  const hasInProgress = dryingRows.some(row => String(row?.status || '').toUpperCase() === 'IN_PROGRESS');
  const hasDone = dryingRows.some(row => String(row?.status || '').toUpperCase() === 'DONE');
  const shouldShow = !hasInProgress && hasDone && String(op?.status || '').toUpperCase() !== 'DONE';
  completeBtn.classList.toggle('hidden', !shouldShow);
  completeBtn.disabled = !shouldShow;
}

async function refreshDryingModalAfterSubmit(cardId, opId) {
  refreshWorkspaceDryingUiAfterAction(cardId, opId, 'workspace-drying-refresh');
}

async function runWorkspaceDryingWriteRequest({
  action = '',
  writePath = '',
  cardId = '',
  opId = '',
  expectedFlowVersion = null,
  body = {},
  defaultErrorMessage = 'Не удалось выполнить действие сушки.'
} = {}) {
  return runProductionExecutionWriteRequest({
    action,
    writePath,
    cardId,
    expectedFlowVersion,
    routeContext: captureClientWriteRouteContext(),
    defaultErrorMessage,
    defaultConflictMessage: 'Данные операции уже изменились. Данные обновлены, попробуйте выполнить действие снова.',
    request: () => apiFetch(writePath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cardId,
        opId,
        expectedFlowVersion,
        source: getWorkspaceActionSource(),
        ...body
      })
    })
  });
}

async function submitDryingRowStart(rowId) {
  if (!dryingContext) {
    showToast('Окно сушки устарело. Откройте действие заново.');
    return;
  }
  const row = dryingRows.find(item => (item?.rowId || '') === rowId);
  if (!isValidDryingStartRow(row)) {
    showToast('Проверьте количество для сушки.');
    return;
  }
  const { cardId, opId, flowVersion } = dryingContext;
  const writePath = '/api/production/operation/drying-start';
  const localState = getWorkspaceCardAndOperation(cardId, opId);
  if (!localState.card || !localState.op) {
    showToast('Операция сушки уже недоступна. Данные обновлены.');
    await refreshWorkspaceExecutionAfterLocalInvalid({
      action: 'workspace-drying-start',
      writePath,
      cardId,
      opId,
      expectedFlowVersion: flowVersion,
      reason: 'missing-local-context'
    });
    return;
  }
  try {
    const result = await runWorkspaceDryingWriteRequest({
      action: 'workspace-drying-start',
      writePath,
      cardId,
      opId,
      expectedFlowVersion: flowVersion,
      body: {
        rowId,
        dryQty: row.dryQty
      },
      defaultErrorMessage: 'Не удалось запустить сушку.'
    });
    if (!result.ok) {
      showToast(getWorkspaceExecutionResultMessage(result, 'Не удалось запустить сушку.'));
      if (result.isConflict) {
        await refreshDryingModalAfterSubmit(cardId, opId);
      }
      return;
    }
    const payload = result.payload || {};
    const { card, op } = getWorkspaceCardAndOperation(cardId, opId);
    if (card && op && applyWorkspaceLocalDryingAction(card, op, 'start', {
      rowId,
      dryQty: row.dryQty,
      flowVersion: payload.flowVersion
    })) {
      await refreshDryingModalAfterSubmit(cardId, opId);
    } else {
      await forceRefreshWorkspaceProductionData('workspace-drying-refresh');
      await refreshDryingModalAfterSubmit(cardId, opId);
    }
    showToast('Сушка запущена.');
  } catch (err) {
    console.error('drying start failed', err);
    showToast('Ошибка соединения при запуске сушки.');
  }
}

async function submitDryingRowFinish(rowId) {
  if (!dryingContext) {
    showToast('Окно сушки устарело. Откройте действие заново.');
    return;
  }
  const { cardId, opId, flowVersion } = dryingContext;
  const writePath = '/api/production/operation/drying-finish';
  const localState = getWorkspaceCardAndOperation(cardId, opId);
  if (!localState.card || !localState.op) {
    showToast('Операция сушки уже недоступна. Данные обновлены.');
    await refreshWorkspaceExecutionAfterLocalInvalid({
      action: 'workspace-drying-finish',
      writePath,
      cardId,
      opId,
      expectedFlowVersion: flowVersion,
      reason: 'missing-local-context'
    });
    return;
  }
  try {
    const result = await runWorkspaceDryingWriteRequest({
      action: 'workspace-drying-finish',
      writePath,
      cardId,
      opId,
      expectedFlowVersion: flowVersion,
      body: { rowId },
      defaultErrorMessage: 'Не удалось завершить сушку.'
    });
    if (!result.ok) {
      showToast(getWorkspaceExecutionResultMessage(result, 'Не удалось завершить сушку.'));
      if (result.isConflict) {
        await refreshDryingModalAfterSubmit(cardId, opId);
      }
      return;
    }
    const payload = result.payload || {};
    const { card, op } = getWorkspaceCardAndOperation(cardId, opId);
    if (card && op && applyWorkspaceLocalDryingAction(card, op, 'finish', {
      rowId,
      flowVersion: payload.flowVersion
    })) {
      await refreshDryingModalAfterSubmit(cardId, opId);
    } else {
      await forceRefreshWorkspaceProductionData('workspace-drying-refresh');
      await refreshDryingModalAfterSubmit(cardId, opId);
    }
    showToast('Сушка завершена.');
  } catch (err) {
    console.error('drying finish failed', err);
    showToast('Ошибка соединения при завершении сушки.');
  }
}

async function submitDryingComplete() {
  if (!dryingContext) {
    showToast('Окно сушки устарело. Откройте действие заново.');
    return;
  }
  const { cardId, opId, flowVersion } = dryingContext;
  const writePath = '/api/production/operation/drying-complete';
  const localState = getWorkspaceCardAndOperation(cardId, opId);
  if (!localState.card || !localState.op) {
    showToast('Операция сушки уже недоступна. Данные обновлены.');
    await refreshWorkspaceExecutionAfterLocalInvalid({
      action: 'workspace-drying-complete',
      writePath,
      cardId,
      opId,
      expectedFlowVersion: flowVersion,
      reason: 'missing-local-context'
    });
    return;
  }
  try {
    const result = await runWorkspaceDryingWriteRequest({
      action: 'workspace-drying-complete',
      writePath,
      cardId,
      opId,
      expectedFlowVersion: flowVersion,
      defaultErrorMessage: 'Не удалось завершить операцию сушки.'
    });
    if (!result.ok) {
      showToast(getWorkspaceExecutionResultMessage(result, 'Не удалось завершить операцию сушки.'));
      if (result.isConflict) {
        await refreshDryingModalAfterSubmit(cardId, opId);
      }
      return;
    }
    const payload = result.payload || {};
    const { card, op } = getWorkspaceCardAndOperation(cardId, opId);
    if (card && op && applyWorkspaceLocalDryingAction(card, op, 'complete', {
      flowVersion: payload.flowVersion
    })) {
      await refreshDryingModalAfterSubmit(cardId, opId);
    } else {
      await forceRefreshWorkspaceProductionData('workspace-drying-refresh');
      await refreshDryingModalAfterSubmit(cardId, opId);
    }
    showToast('Операция сушки завершена.');
  } catch (err) {
    console.error('drying complete failed', err);
    showToast('Ошибка соединения при завершении операции сушки.');
  }
}

function setupDryingModal() {
  const modal = document.getElementById('drying-modal');
  if (!modal) return;
  const closeBtn = document.getElementById('drying-close');
  const cancelBtn = document.getElementById('drying-cancel');
  const completeBtn = document.getElementById('drying-complete');

  if (closeBtn) closeBtn.addEventListener('click', () => closeDryingModal());
  if (cancelBtn) cancelBtn.addEventListener('click', () => closeDryingModal());
  if (completeBtn) completeBtn.addEventListener('click', () => submitDryingComplete());

  modal.addEventListener('click', (event) => {
    if (event.target === modal) return;
  });
}

function openMaterialReturnModal(card, op) {
  if (!card || !op) return;
  materialReturnRows = buildMaterialReturnRows(card);
  materialReturnContext = {
    cardId: card.id,
    opId: op.id,
    flowVersion: Number.isFinite(card.flow?.version) ? card.flow.version : 1
  };
  const titleEl = document.getElementById('material-return-title');
  if (titleEl) titleEl.textContent = 'Возврат материала';
  renderMaterialReturnModalTable();
  const modal = document.getElementById('material-return-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeMaterialReturnModal() {
  const modal = document.getElementById('material-return-modal');
  if (modal) modal.classList.add('hidden');
  materialReturnContext = null;
  materialReturnRows = [];
}

function renderMaterialReturnModalTable() {
  const wrapper = document.getElementById('material-return-table-wrapper');
  if (!wrapper) return;
  wrapper.innerHTML = renderMaterialReturnTable(materialReturnRows, { readonly: false });
  wrapper.querySelectorAll('.material-return-input').forEach(input => {
    input.addEventListener('input', () => {
      const idx = parseInt(input.getAttribute('data-row-index') || '', 10);
      if (Number.isNaN(idx) || !materialReturnRows[idx]) return;
      const row = materialReturnRows[idx];
      const normalized = normalizeDecimalDisplayInput(input.value);
      input.value = normalized;
      const availableQtyValue = row.qty || '0';
      const issuedQtyValue = row.issuedQty || row.rawQty || row.qty || '0';
      const nextReturn = normalized === '' ? '0' : normalized;
      const qtyNorm = parseDecimalNormalized(availableQtyValue);
      const returnNorm = parseDecimalNormalized(nextReturn);
      if (!qtyNorm || !returnNorm) {
        row.balanceQty = '';
        const balanceCell = wrapper.querySelector('.material-return-balance[data-row-index="' + idx + '"]');
        if (balanceCell) balanceCell.textContent = '';
        return;
      }
      let effectiveReturn = nextReturn;
      const cmp = compareDecimalStrings(availableQtyValue, nextReturn);
      if (cmp != null && cmp < 0) {
        effectiveReturn = availableQtyValue || '0';
        input.value = effectiveReturn === '0' ? '' : effectiveReturn;
        showToast('Возврат не может быть больше доступного количества.');
      }
      row.returnQty = effectiveReturn === '0' ? '' : effectiveReturn;
      const balance = subtractDecimalStrings(issuedQtyValue, effectiveReturn);
      row.balanceQty = balance;
      const balanceCell = wrapper.querySelector('.material-return-balance[data-row-index="' + idx + '"]');
      if (balanceCell) balanceCell.textContent = balance;
    });
  });
}

async function submitMaterialReturnModal() {
  if (!materialReturnContext) {
    showToast('Окно возврата материала устарело. Откройте действие заново.');
    return false;
  }
  const { cardId, opId, flowVersion } = materialReturnContext;
  const confirmBtn = document.getElementById('material-return-confirm');
  if (confirmBtn) confirmBtn.disabled = true;
  try {
    const rows = materialReturnRows.map(row => {
      const qtyValue = row.rawQty || row.qty || '';
      const returnValue = row.returnQty === '' ? '0' : row.returnQty;
      const availableValue = row.qty || '0';
      const availableCmp = compareDecimalStrings(availableValue, returnValue);
      if (availableCmp == null || availableCmp < 0) {
        throw new Error('RETURN_EXCEEDS_AVAILABLE');
      }
      const issuedValue = row.issuedQty || qtyValue || '0';
      const balanceValue = row.balanceQty || subtractDecimalStrings(issuedValue, returnValue || '0');
      return {
        sourceIndex: row.sourceIndex,
        name: row.name || '',
        qty: qtyValue,
        unit: row.unit || 'кг',
        isPowder: Boolean(row.isPowder),
        returnQty: returnValue,
        balanceQty: balanceValue
      };
    });

    const writePath = '/api/production/operation/material-return';
    const localState = getWorkspaceCardAndOperation(cardId, opId);
    if (!localState.card || !localState.op) {
      showToast('Операция уже недоступна. Данные обновлены.');
      await refreshWorkspaceExecutionAfterLocalInvalid({
        action: 'workspace-material-return',
        writePath,
        cardId,
        opId,
        expectedFlowVersion: flowVersion,
        reason: 'missing-local-context'
      });
      return false;
    }
    const result = await runWorkspaceMaterialWriteRequest({
      action: 'workspace-material-return',
      writePath,
      cardId,
      opId,
      expectedFlowVersion: flowVersion,
      body: { returns: rows },
      defaultErrorMessage: 'Не удалось сохранить возврат.'
    });
    if (!result.ok) {
      showToast(getWorkspaceExecutionResultMessage(result, 'Не удалось сохранить возврат.'));
      return false;
    }
    closeMaterialReturnModal();
    const payload = result.payload || {};
    if (Number.isFinite(payload.flowVersion) && materialReturnContext) {
      materialReturnContext.flowVersion = payload.flowVersion;
    }
    const { card, op } = getWorkspaceCardAndOperation(cardId, opId);
    if (card && op && applyWorkspaceLocalMaterialReturn(card, op, rows, payload.flowVersion)) {
      refreshWorkspaceUiAfterAction('workspace-material-return');
    } else {
      await forceRefreshWorkspaceProductionData('workspace-material-return');
    }
    showToast('Материал сдан.');
    return true;
  } catch (err) {
    if (err?.message === 'RETURN_EXCEEDS_AVAILABLE') {
      showToast('Возврат не может быть больше доступного количества.');
      return false;
    }
    console.error('material return failed', err);
    showToast('Ошибка соединения при возврате материала.');
    return false;
  } finally {
    if (confirmBtn) confirmBtn.disabled = false;
  }
}

async function resetMaterialReturnOperation() {
  if (!materialReturnContext) {
    showToast('Окно возврата материала устарело. Откройте действие заново.');
    return false;
  }
  const { cardId, opId, flowVersion } = materialReturnContext;
  const resetBtn = document.getElementById('material-return-reset');
  if (resetBtn) resetBtn.disabled = true;
  try {
    const writePath = '/api/production/operation/reset';
    const localState = getWorkspaceCardAndOperation(cardId, opId);
    if (!localState.card || !localState.op) {
      showToast('Операция уже недоступна. Данные обновлены.');
      await refreshWorkspaceExecutionAfterLocalInvalid({
        action: 'workspace-material-return-reset',
        writePath,
        cardId,
        opId,
        expectedFlowVersion: flowVersion,
        reason: 'missing-local-context'
      });
      return false;
    }
    const result = await runWorkspaceMaterialWriteRequest({
      action: 'workspace-material-return-reset',
      writePath,
      cardId,
      opId,
      expectedFlowVersion: flowVersion,
      defaultErrorMessage: 'Не удалось завершить операцию.'
    });
    if (!result.ok) {
      showToast(getWorkspaceExecutionResultMessage(result, 'Не удалось завершить операцию.'));
      return false;
    }
    closeMaterialReturnModal();
    const payload = result.payload || {};
    if (Number.isFinite(payload.flowVersion) && materialReturnContext) {
      materialReturnContext.flowVersion = payload.flowVersion;
    }
    const { card, op } = getWorkspaceCardAndOperation(cardId, opId);
    if (card && op) {
      applyWorkspaceLocalOperationAction(card, op, 'reset', { flowVersion: payload.flowVersion });
      refreshWorkspaceUiAfterAction('workspace-material-return-reset');
    } else {
      await forceRefreshWorkspaceProductionData('workspace-material-return-reset');
    }
    return true;
  } catch (err) {
    console.error('material return reset failed', err);
    showToast('Ошибка соединения при завершении операции.');
    return false;
  } finally {
    if (resetBtn) resetBtn.disabled = false;
  }
}

function setupMaterialReturnModal() {
  const modal = document.getElementById('material-return-modal');
  if (!modal) return;
  const closeBtn = document.getElementById('material-return-close');
  const cancelBtn = document.getElementById('material-return-cancel');
  const confirmBtn = document.getElementById('material-return-confirm');
  const resetBtn = document.getElementById('material-return-reset');

  if (closeBtn) closeBtn.addEventListener('click', () => closeMaterialReturnModal());
  if (cancelBtn) cancelBtn.addEventListener('click', () => closeMaterialReturnModal());
  if (confirmBtn) confirmBtn.addEventListener('click', () => submitMaterialReturnModal());
  if (resetBtn) resetBtn.addEventListener('click', () => resetMaterialReturnOperation());

  modal.addEventListener('click', (event) => {
    if (event.target === modal) return;
  });
}

async function openWorkspaceTransferScanner() {
  if (typeof BarcodeDetector === 'undefined') {
    showToast('Браузер не поддерживает сканер, используйте ввод вручную');
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast('Браузер не поддерживает сканер, используйте ввод вручную');
    return;
  }

  if (workspaceTransferScannerState && workspaceTransferScannerState.isOpen) return;

  const modal = document.getElementById('barcode-scanner-modal');
  const video = document.getElementById('barcode-scanner-video');
  const closeButton = document.getElementById('barcode-scanner-close');
  const statusEl = document.getElementById('barcode-scanner-status');
  const hintEl = document.getElementById('barcode-scanner-hint');
  if (!modal || !video) {
    showToast('Сканер недоступен');
    return;
  }

  workspaceTransferScannerState = {
    isOpen: true,
    modal,
    video,
    stream: null,
    detector: null,
    interval: null
  };

  if (statusEl) statusEl.textContent = 'Запрос доступа к камере...';
  if (hintEl) hintEl.textContent = 'Наведите камеру на QR-код изделия';
  modal.classList.remove('hidden');

  const close = () => {
    if (!workspaceTransferScannerState) return;
    if (workspaceTransferScannerState.interval) {
      clearInterval(workspaceTransferScannerState.interval);
    }
    if (workspaceTransferScannerState.stream) {
      workspaceTransferScannerState.stream.getTracks().forEach(track => track.stop());
    }
    if (workspaceTransferScannerState.video) {
      workspaceTransferScannerState.video.srcObject = null;
    }
    workspaceTransferScannerState.isOpen = false;
    modal.classList.add('hidden');
    workspaceTransferScannerState = null;
  };

  if (closeButton) {
    closeButton.onclick = () => close();
  }
  modal.onclick = (event) => {
    const clickedBackdrop = event.target === modal || event.target.classList.contains('barcode-scanner-modal__backdrop');
    if (clickedBackdrop) close();
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    workspaceTransferScannerState.stream = stream;
    video.srcObject = stream;
    await video.play();

    workspaceTransferScannerState.detector = new BarcodeDetector({ formats: ['qr_code'] });
    if (statusEl) statusEl.textContent = 'Сканирование...';

    workspaceTransferScannerState.interval = setInterval(async () => {
      if (!workspaceTransferScannerState?.detector) return;
      try {
        const barcodes = await workspaceTransferScannerState.detector.detect(video);
        const first = barcodes && barcodes[0];
        if (first && first.rawValue) {
          close();
          const input = document.getElementById('workspace-transfer-scan-input');
          if (input) {
            input.value = first.rawValue.trim();
            handleWorkspaceTransferScan(input.value);
          }
        }
      } catch (err) {
        console.error('scanner error', err);
      }
    }, 180);
  } catch (err) {
    console.error('camera access error', err);
    showToast('Не удалось получить доступ к камере.');
    close();
  }
}

function buildArchiveCardDetails(card, { opened = false } = {}) {
  const stateBadge = renderCardStateBadge(card);
  const filesCount = (card.attachments || []).length;
  const barcodeValue = getCardBarcodeValue(card);
  const barcodeInline = barcodeValue
    ? ' • № карты: <span class="summary-barcode">' + escapeHtml(barcodeValue) + ' <button type="button" class="btn-small btn-secondary wo-barcode-btn" data-card-id="' + card.id + '" data-allow-view="true">Штрихкод</button></span>'
    : '';
  const contractText = card.contractNumber ? ' (Договор: ' + escapeHtml(card.contractNumber) + ')' : '';
  const filesButton = ' <button type="button" class="btn-small clip-btn inline-clip" data-attach-card="' + card.id + '" data-allow-view="true">📎 <span class="clip-count">' + filesCount + '</span></button>';
  const logButton = ' <button type="button" class="btn-small btn-secondary log-btn" data-allow-view="true" data-log-card="' + card.id + '">Log</button>';
  const nameLabel = escapeHtml(formatCardTitle(card) || card.name || card.id || '');

  let html = '<details class="wo-card" data-card-id="' + card.id + '"' + (opened ? ' open' : '') + '>' +
    '<summary>' +
    '<div class="summary-line">' +
    '<div class="summary-text">' +
    '<strong>' + nameLabel + '</strong>' +
    ' <span class="summary-sub">' +
    (card.orderNo ? ' (Заказ: ' + escapeHtml(card.orderNo) + ')' : '') + contractText +
    barcodeInline + filesButton + logButton +
    '</span>' +
    '</div>' +
    '<div class="summary-actions">' +
    ' ' + stateBadge +
    ' <button type="button" class="btn-small btn-secondary repeat-card-btn" data-card-id="' + card.id + '">Повторить</button>' +
    '</div>' +
    '</div>' +
    '</summary>';

  html += buildCardInfoBlock(card);
  html += buildOperationsTable(card, { readonly: true });
  html += '</details>';
  return html;
}

function bindArchiveInteractions(rootEl, { forceClosed = true, enableSummaryNavigation = true } = {}) {
  if (!rootEl) return;
  bindCardInfoToggles(rootEl);

  rootEl.querySelectorAll('.wo-card[data-card-id]').forEach(detail => {
    if (forceClosed) {
      detail.open = false;
    }
    const summary = detail.querySelector('summary');
    if (summary && enableSummaryNavigation) {
      summary.addEventListener('click', (e) => {
        if (shouldIgnoreCardOpenClick(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const cardId = detail.dataset.cardId;
        const card = cards.find(c => c.id === cardId);
        if (!card) return;
        navigateToRoute(getArchiveCardUrlByCard(card));
      });
    }
  });

  rootEl.querySelectorAll('.wo-barcode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-card-id');
      const card = cards.find(c => c.id === id);
      if (!card) return;
      openBarcodeModal(card);
    });
  });

  rootEl.querySelectorAll('button[data-attach-card]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-attach-card');
      openAttachmentsModal(id, 'live');
    });
  });

  rootEl.querySelectorAll('.log-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-log-card');
      openCardLogPage(id);
    });
  });

  rootEl.querySelectorAll('.repeat-card-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-card-id');
      const card = cards.find(c => c.id === id);
      if (!card) return;
      await repeatArchivedCardViaCardsCore(card);
    });
  });

  applyReadonlyState('archive', 'archive');
}

function renderArchiveCardPage(card, mountEl) {
  if (!card || !mountEl) return;
  mountEl.innerHTML = `
    <div class="wo-page">
      <div class="wo-page-header">
        <button class="btn btn-small" id="archive-page-back">← Назад</button>
        <div class="wo-page-title">
          <div><b>Маршрутная карта</b></div>
          <div class="muted">QR: ${escapeHtml(normalizeQrId(card.qrId || ''))}</div>
        </div>
      </div>
      ${buildArchiveCardDetails(card, { opened: true })}
    </div>
  `;

  const backBtn = document.getElementById('archive-page-back');
  if (backBtn) backBtn.onclick = () => navigateToRoute('/archive');

  bindArchiveInteractions(mountEl, { forceClosed: false, enableSummaryNavigation: false });

  const detail = mountEl.querySelector('details.wo-card');
  if (detail) detail.open = true;
}

function renderArchiveTable() {
  const wrapper = document.getElementById('archive-table-wrapper');
  if (!wrapper) return;
  const archivedCards = cards.filter(c =>
    c &&
    c.archived &&
    c.cardType === 'MKI' &&
    isCardProductionEligible(c)
  );

  if (!archivedCards.length) {
    wrapper.innerHTML = '<p>В архиве пока нет карт.</p>';
    return;
  }

  const termRaw = archiveSearchTerm.trim();
  const filteredByStatus = archivedCards.filter(card => {
    const state = getCardProcessState(card);
    return archiveStatusFilter === 'ALL' || state.key === archiveStatusFilter;
  });

  if (!filteredByStatus.length) {
    wrapper.innerHTML = '<p>Нет архивных карт, удовлетворяющих фильтру.</p>';
    return;
  }

  const scoreFn = (card) => cardSearchScore(card, termRaw);
  let sortedCards = [...filteredByStatus];
  if (termRaw) {
    sortedCards.sort((a, b) => scoreFn(b) - scoreFn(a));
  }

  const filteredBySearch = termRaw
    ? sortedCards.filter(card => scoreFn(card) > 0)
    : sortedCards;

  if (!filteredBySearch.length) {
    wrapper.innerHTML = '<p>Архивные карты по запросу не найдены.</p>';
    return;
  }

  let html = '';
  filteredBySearch.forEach(card => {
    if (card.operations && card.operations.length) {
      html += buildArchiveCardDetails(card);
    }
  });

  wrapper.innerHTML = html || '<p>Нет архивных карт, удовлетворяющих фильтру.</p>';
  bindArchiveInteractions(wrapper);
}
