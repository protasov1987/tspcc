// === ФОРМЫ ===
function setupForms() {
  const newCardBtn = document.getElementById('btn-new-card');
  if (newCardBtn) {
    newCardBtn.addEventListener('click', () => {
      navigateToRoute('/cards-mki/new');
    });
  }

  const newMkiBtn = document.getElementById('btn-new-mki');
  if (newMkiBtn) {
    newMkiBtn.addEventListener('click', () => navigateToRoute('/cards-mki/new'));
  }

  setupCardSectionMenu();

  const cardForm = document.getElementById('card-form');
  if (cardForm) {
    cardForm.addEventListener('submit', e => e.preventDefault());
  }

  const cardMainToggle = document.getElementById('card-main-toggle');
  if (cardMainToggle) {
    cardMainToggle.addEventListener('click', () => {
      const block = document.getElementById('card-main-block');
      const collapsed = block ? block.classList.contains('is-collapsed') : false;
      setCardMainCollapsed(!collapsed);
    });
  }

  const cardNameInput = document.getElementById('card-name');
  if (cardNameInput) {
    cardNameInput.addEventListener('input', () => updateCardMainSummary());
  }

  const cardQtyInput = document.getElementById('card-qty');
  if (cardQtyInput) {
    cardQtyInput.addEventListener('input', e => {
      if (!activeCardDraft) return;
      const raw = e.target.value.trim();
      const qtyVal = raw === '' ? '' : Math.max(0, parseInt(raw, 10) || 0);
      activeCardDraft.quantity = Number.isFinite(qtyVal) ? qtyVal : '';
      if (!routeQtyManual) {
        const qtyField = document.getElementById('route-qty');
        if (qtyField) qtyField.value = activeCardDraft.quantity !== '' ? activeCardDraft.quantity : '';
      }
      updateCardMainSummary();
      if (activeCardDraft.cardType === 'MKI') {
        recalcMkiOperationQuantities(activeCardDraft);
        updateRouteFormQuantityUI();
        renderMkiSerialTables();
      }
      renderRouteTableDraft();
    });
  }

  const sampleQtyInput = document.getElementById('card-sample-qty');
  if (sampleQtyInput) {
    sampleQtyInput.addEventListener('input', e => {
      if (!activeCardDraft || activeCardDraft.cardType !== 'MKI') return;
      const raw = e.target.value.trim();
      const qtyVal = raw === '' ? '' : Math.max(0, parseInt(raw, 10) || 0);
      activeCardDraft.sampleCount = Number.isFinite(qtyVal) ? qtyVal : '';
      recalcMkiOperationQuantities(activeCardDraft);
      updateRouteFormQuantityUI();
      renderRouteTableDraft();
      renderMkiSerialTables();
    });
  }

  const cardOrderInput = document.getElementById('card-order');
  if (cardOrderInput) {
    cardOrderInput.addEventListener('input', () => updateCardMainSummary());
  }

  const itemSerialsWrapper = document.getElementById('card-item-serials-table-wrapper');
  if (itemSerialsWrapper) {
    itemSerialsWrapper.addEventListener('input', e => {
      if (!activeCardDraft || activeCardDraft.cardType !== 'MKI') return;
      const input = e.target.closest('.serials-input');
      if (!input) return;
      const idx = parseInt(input.dataset.index, 10);
      if (!Number.isNaN(idx) && idx >= 0) {
        activeCardDraft.itemSerials[idx] = input.value;
      }
    });
  }

  const sampleSerialsWrapper = document.getElementById('card-sample-serials-table-wrapper');
  if (sampleSerialsWrapper) {
    sampleSerialsWrapper.addEventListener('input', e => {
      if (!activeCardDraft || activeCardDraft.cardType !== 'MKI') return;
      const input = e.target.closest('.serials-input');
      if (!input) return;
      const idx = parseInt(input.dataset.index, 10);
      if (!Number.isNaN(idx) && idx >= 0) {
        activeCardDraft.sampleSerials[idx] = input.value;
      }
    });
  }

  const importImdxBtn = document.getElementById('card-import-imdx-btn');
  if (importImdxBtn) {
    importImdxBtn.addEventListener('click', () => {
      if (!activeCardDraft) return;
      openImdxImportModal();
    });
  }

  const imdxImportConfirm = document.getElementById('imdx-import-confirm');
  if (imdxImportConfirm) {
    imdxImportConfirm.addEventListener('click', () => handleImdxImportConfirm());
  }

  const imdxImportCancel = document.getElementById('imdx-import-cancel');
  if (imdxImportCancel) {
    imdxImportCancel.addEventListener('click', () => {
      closeImdxImportModal();
      resetImdxImportState();
    });
  }

  const imdxMissingConfirm = document.getElementById('imdx-missing-confirm');
  if (imdxMissingConfirm) {
    imdxMissingConfirm.addEventListener('click', () => confirmImdxMissingAdd());
  }

  const imdxMissingCancel = document.getElementById('imdx-missing-cancel');
  if (imdxMissingCancel) {
    imdxMissingCancel.addEventListener('click', () => {
      closeImdxMissingModal();
      resetImdxImportState();
    });
  }

  const saveBtn = document.getElementById('card-save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      if (!activeCardDraft) return;
      syncCardDraftFromForm();
      const missing = [];
      if (!activeCardDraft.routeCardNumber) missing.push('Маршрутная карта №');
      if (!activeCardDraft.itemName) missing.push('Наименование изделия');
      if (!activeCardDraft.documentDesignation) missing.push('Обозначение документа');
      if (missing.length) {
        alert('Заполните обязательные поля: ' + missing.join(', '));
        return;
      }
      document.getElementById('card-status-text').textContent = cardStatusText(activeCardDraft);
      saveCardDraft();
    });
  }

  const printDraftBtn = document.getElementById('card-print-btn');
  if (printDraftBtn) {
    printDraftBtn.addEventListener('click', async () => {
      if (!activeCardDraft) return;
      syncCardDraftFromForm();
      const saved = await saveCardDraft({ closeModal: false, keepDraftOpen: true });
      if (saved) {
        printCardView(saved);
      }
    });
  }

  const cancelBtn = document.getElementById('card-cancel-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      const modal = document.getElementById('card-modal');
      if (modal && modal.classList.contains('page-mode')) {
        navigateToRoute('/cards');
        return;
      }
      closeCardModal();
    });
  }

  document.getElementById('route-form').addEventListener('submit', e => {
    e.preventDefault();
    if (!activeCardDraft) return;
    const opInput = document.getElementById('route-op');
    const opList = document.getElementById('route-op-options');
    const centerInput = document.getElementById('route-center');
    const centerList = document.getElementById('route-center-options');
    const opMatch = Array.from(opList ? opList.options : []).find(opt => opt.value === (opInput ? opInput.value.trim() : ''));
    const centerMatch = Array.from(centerList ? centerList.options : []).find(opt => opt.value === (centerInput ? centerInput.value.trim() : ''));
    const opId = opMatch ? opMatch.dataset.id : null;
    const centerId = centerMatch ? centerMatch.dataset.id : null;
    const planned = parseInt(document.getElementById('route-planned').value, 10) || 30;
    const codeValue = document.getElementById('route-op-code').value.trim();
    const qtyInput = document.getElementById('route-qty').value.trim();
    const samplesToggle = document.getElementById('route-samples-toggle');
    const isMki = activeCardDraft.cardType === 'MKI';
    const isSamplesMode = isMki && samplesToggle ? Boolean(samplesToggle.checked) : false;
    const qtyValue = isMki
      ? computeMkiOperationQuantity({ isSamples: isSamplesMode }, activeCardDraft)
      : (qtyInput === '' ? activeCardDraft.quantity : qtyInput);
    const qtyNumeric = isMki
      ? computeMkiOperationQuantity({ isSamples: isSamplesMode }, activeCardDraft)
      : (qtyValue === '' ? '' : toSafeCount(qtyValue));
    let opRef = ops.find(o => o.id === opId);
    let centerRef = centers.find(c => c.id === centerId);
    const opTerm = (opInput ? opInput.value : '').trim().toLowerCase();
    const centerTerm = (centerInput ? centerInput.value : '').trim().toLowerCase();
    if (!opRef && opTerm) {
      opRef = ops.find(o => {
        const label = formatOpLabel(o).toLowerCase();
        const code = (o.opCode || o.code || '').toLowerCase();
        return label === opTerm || code === opTerm;
      }) || ops.find(o => {
        const label = formatOpLabel(o).toLowerCase();
        const code = (o.opCode || o.code || '').toLowerCase();
        return label.includes(opTerm) || code.includes(opTerm);
      });
    }
    if (!centerRef && centerTerm) {
      centerRef = centers.find(c => (c.name || '').toLowerCase() === centerTerm) || centers.find(c => (c.name || '').toLowerCase().includes(centerTerm));
    }
    if (!opRef || !centerRef) {
      alert('Выберите операцию и подразделение из списка.');
      return;
    }
    const maxOrder = activeCardDraft.operations && activeCardDraft.operations.length
      ? Math.max.apply(null, activeCardDraft.operations.map(o => o.order || 0))
      : 0;
    const rop = createRouteOpFromRefs(opRef, centerRef, '', planned, maxOrder + 1, {
      code: codeValue,
      autoCode: !codeValue,
      quantity: qtyValue,
      isSamples: isSamplesMode,
      card: activeCardDraft
    });
    activeCardDraft.operations = activeCardDraft.operations || [];
    activeCardDraft.operations.push(rop);
    renumberAutoCodesForCard(activeCardDraft);
    document.getElementById('card-status-text').textContent = cardStatusText(activeCardDraft);
    renderRouteTableDraft();
    
    // Auto-scroll to bottom
    const wrapper = document.getElementById('route-table-wrapper');
    if (wrapper) {
        requestAnimationFrame(() => {
            wrapper.scrollTop = wrapper.scrollHeight;
        });
    }

    document.getElementById('route-form').reset();
    routeQtyManual = false;
    const qtyField = document.getElementById('route-qty');
    if (qtyField) qtyField.value = activeCardDraft.quantity !== '' ? activeCardDraft.quantity : '';
    if (opInput) opInput.value = '';
    if (centerInput) centerInput.value = '';
    updateRouteFormQuantityUI();
    fillRouteSelectors();
  });

  const routeOpInput = document.getElementById('route-op');
  if (routeOpInput) {
    const openOpList = () => {
      const { filteredOps } = getFilteredRouteSources();
      updateRouteCombo('op', filteredOps, { forceOpen: true });
    };
    routeOpInput.addEventListener('input', () => fillRouteSelectors());
    routeOpInput.addEventListener('focus', openOpList);
    routeOpInput.addEventListener('click', openOpList);
  }

  const routeCenterInput = document.getElementById('route-center');
  if (routeCenterInput) {
    const openCenterList = () => {
      const { filteredCenters } = getFilteredRouteSources();
      updateRouteCombo('center', filteredCenters, { forceOpen: true });
    };
    routeCenterInput.addEventListener('input', () => fillRouteSelectors());
    routeCenterInput.addEventListener('focus', openCenterList);
    routeCenterInput.addEventListener('click', openCenterList);
  }

  document.addEventListener('click', e => {
    if (!e.target.closest('.combo-field')) {
      hideRouteCombos();
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
      hideRouteCombos();
    } else {
      fillRouteSelectors();
    }
  });

  const routeQtyField = document.getElementById('route-qty');
  if (routeQtyField) {
    routeQtyField.addEventListener('input', e => {
      if (activeCardDraft && activeCardDraft.cardType === 'MKI') {
        updateRouteFormQuantityUI();
        return;
      }
      const raw = e.target.value;
      routeQtyManual = raw !== '';
      if (raw !== '') {
        e.target.value = toSafeCount(raw);
      } else if (activeCardDraft) {
        e.target.value = activeCardDraft.quantity !== '' ? activeCardDraft.quantity : '';
      }
    });
  }

  const routeSamplesToggle = document.getElementById('route-samples-toggle');
  if (routeSamplesToggle) {
    routeSamplesToggle.addEventListener('change', () => {
      updateRouteFormQuantityUI();
    });
  }

  const opFilterInput = document.getElementById('route-op-filter');
  const centerFilterInput = document.getElementById('route-center-filter');
  if (opFilterInput) {
    opFilterInput.addEventListener('input', () => fillRouteSelectors());
  }
  if (centerFilterInput) {
    centerFilterInput.addEventListener('input', () => fillRouteSelectors());
  }

  const cardModalBody = document.querySelector('#card-modal .modal-body');
  if (cardModalBody) {
    cardModalBody.addEventListener('scroll', () => updateRouteTableScrollState());
  }
  window.addEventListener('resize', () => {
    updateRouteTableScrollState();
    if (!isDesktopCardLayout()) {
      setCardMainCollapsed(false);
    }
  });

  document.getElementById('center-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = document.getElementById('center-name').value.trim();
    const desc = document.getElementById('center-desc').value.trim();
    if (!name) return;
    const editingId = e.target.dataset.editingId;
    if (editingId) {
      const target = centers.find(c => c.id === editingId);
      if (target) {
        const prevName = target.name;
        target.name = name;
        target.desc = desc;
        updateCenterReferences(target);
        if (prevName !== name) {
          renderWorkordersTable({ collapseAll: true });
        }
      }
    } else {
      centers.push({ id: genId('wc'), name: name, desc: desc });
    }
    saveData();
    renderCentersTable();
    fillRouteSelectors();
    if (activeCardDraft) {
      renderRouteTableDraft();
    }
    renderCardsTable();
    renderWorkordersTable({ collapseAll: true });
    resetCenterForm();
  });

  const centerCancelBtn = document.getElementById('center-cancel-edit');
  if (centerCancelBtn) {
    centerCancelBtn.addEventListener('click', () => resetCenterForm());
  }

      document.getElementById('op-form').addEventListener('submit', e => {
        e.preventDefault();
        const name = document.getElementById('op-name').value.trim();
        const desc = document.getElementById('op-desc').value.trim();
        const time = parseInt(document.getElementById('op-time').value, 10) || 30;
        const type = normalizeOperationType(document.getElementById('op-type').value);
        if (!name) return;
        const editingId = e.target.dataset.editingId;
        if (editingId) {
          const target = ops.find(o => o.id === editingId);
          if (target) {
            target.name = name;
            target.desc = desc;
            target.recTime = time;
            target.operationType = type;
            updateOperationReferences(target);
          }
        } else {
          ops.push({ id: genId('op'), name: name, desc: desc, recTime: time, operationType: type });
        }
        ensureOperationTypes();
        saveData();
        renderOpsTable();
        fillRouteSelectors();
        if (activeCardDraft) {
          renderRouteTableDraft();
        }
        renderCardsTable();
        renderWorkordersTable({ collapseAll: true });
        resetOpForm();
      });

      const opCancelBtn = document.getElementById('op-cancel-edit');
      if (opCancelBtn) {
        opCancelBtn.addEventListener('click', () => resetOpForm());
      }

  const cardsSearchInput = document.getElementById('cards-search');
  const cardsSearchClear = document.getElementById('cards-search-clear');
  if (cardsSearchInput) {
    cardsSearchInput.addEventListener('input', e => {
      cardsSearchTerm = e.target.value || '';
      renderCardsTable();
    });
  }
  if (cardsSearchClear) {
    cardsSearchClear.addEventListener('click', () => {
      cardsSearchTerm = '';
      if (cardsSearchInput) cardsSearchInput.value = '';
      renderCardsTable();
    });
  }

  const provisionSearchInput = document.getElementById('provision-search');
  const provisionSearchClear = document.getElementById('provision-search-clear');
  if (provisionSearchInput) {
    provisionSearchInput.addEventListener('input', e => {
      provisionSearchTerm = e.target.value || '';
      renderProvisionTable();
    });
  }
  if (provisionSearchClear) {
    provisionSearchClear.addEventListener('click', () => {
      provisionSearchTerm = '';
      if (provisionSearchInput) provisionSearchInput.value = '';
      renderProvisionTable();
    });
  }

  const approvalsSearchInput = document.getElementById('approvals-search');
  const approvalsSearchClear = document.getElementById('approvals-search-clear');
  if (approvalsSearchInput) {
    approvalsSearchInput.addEventListener('input', e => {
      approvalsSearchTerm = e.target.value || '';
      renderApprovalsTable();
    });
  }
  if (approvalsSearchClear) {
    approvalsSearchClear.addEventListener('click', () => {
      approvalsSearchTerm = '';
      if (approvalsSearchInput) approvalsSearchInput.value = '';
      renderApprovalsTable();
    });
  }

  const workorderAutoscrollCheckbox = document.getElementById('workorder-autoscroll');
  if (workorderAutoscrollCheckbox) {
    workorderAutoscrollCheckbox.checked = workorderAutoScrollEnabled;
    workorderAutoscrollCheckbox.addEventListener('change', (e) => {
      workorderAutoScrollEnabled = !!e.target.checked;
    });
  }

  const searchInput = document.getElementById('workorder-search');
  const searchClearBtn = document.getElementById('workorder-search-clear');
  const statusSelect = document.getElementById('workorder-status');
  const missingExecutorSelect = document.getElementById('workorder-missing-executor');
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      workorderSearchTerm = e.target.value || '';
      renderWorkordersTable({ collapseAll: true });
    });
  }
  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', () => {
      workorderSearchTerm = '';
      if (searchInput) searchInput.value = '';
      if (statusSelect) statusSelect.value = 'ALL';
      workorderStatusFilter = 'ALL';
      workorderMissingExecutorFilter = 'ALL';
      if (missingExecutorSelect) missingExecutorSelect.value = 'ALL';
      renderWorkordersTable({ collapseAll: true });
    });
  }

  if (statusSelect) {
    statusSelect.addEventListener('change', e => {
      workorderStatusFilter = e.target.value || 'ALL';
      renderWorkordersTable({ collapseAll: true });
    });
  }

  if (missingExecutorSelect) {
    missingExecutorSelect.addEventListener('change', e => {
      workorderMissingExecutorFilter = e.target.value || 'ALL';
      renderWorkordersTable({ collapseAll: true });
    });
  }

  const archiveSearchInput = document.getElementById('archive-search');
  const archiveSearchClear = document.getElementById('archive-search-clear');
  const archiveStatusSelect = document.getElementById('archive-status');
  if (archiveSearchInput) {
    archiveSearchInput.addEventListener('input', e => {
      archiveSearchTerm = e.target.value || '';
      renderArchiveTable();
    });
  }
  if (archiveStatusSelect) {
    archiveStatusSelect.addEventListener('change', e => {
      archiveStatusFilter = e.target.value || 'ALL';
      renderArchiveTable();
    });
  }
  if (archiveSearchClear) {
    archiveSearchClear.addEventListener('click', () => {
      archiveSearchTerm = '';
      if (archiveSearchInput) archiveSearchInput.value = '';
      archiveStatusFilter = 'ALL';
      if (archiveStatusSelect) archiveStatusSelect.value = 'ALL';
      renderArchiveTable();
    });
  }

  const workspaceSearchInput = document.getElementById('workspace-search');
  const workspaceSearchSubmit = document.getElementById('workspace-search-submit');
  const workspaceSearchClear = document.getElementById('workspace-search-clear');
  const sanitizeWorkspaceTerm = (value = '') => (value || '').replace(/\D/g, '').slice(0, 13);
  const triggerWorkspaceSearch = () => {
    workspaceSearchTerm = workspaceSearchInput ? sanitizeWorkspaceTerm(workspaceSearchInput.value || '') : '';
    if (workspaceSearchInput) {
      workspaceSearchInput.value = workspaceSearchTerm;
    }
    renderWorkspaceView();
  };

  if (workspaceSearchInput) {
    workspaceSearchInput.addEventListener('input', e => {
      const sanitized = sanitizeWorkspaceTerm(e.target.value || '');
      if (sanitized !== e.target.value) {
        e.target.value = sanitized;
      }
      workspaceSearchTerm = sanitized;
    });
    workspaceSearchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        triggerWorkspaceSearch();
      }
    });
  }
  if (workspaceSearchSubmit) {
    workspaceSearchSubmit.addEventListener('click', triggerWorkspaceSearch);
  }
  if (workspaceSearchClear) {
    workspaceSearchClear.addEventListener('click', () => {
      workspaceSearchTerm = '';
      if (workspaceSearchInput) {
        workspaceSearchInput.value = '';
        focusWorkspaceSearch();
      }
      renderWorkspaceView();
    });
  }
}
