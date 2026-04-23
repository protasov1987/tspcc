// === ФОРМЫ ===
function normalizeSerialValue(value) {
  return (value || '').toString().trim();
}

function findDuplicateSerial(values) {
  const seen = new Set();
  for (const raw of values || []) {
    const val = normalizeSerialValue(raw);
    if (!val) continue;
    if (seen.has(val)) return val;
    seen.add(val);
  }
  return null;
}

function ensureUniqueSerials(values, onDuplicate) {
  const dup = findDuplicateSerial(values);
  if (!dup) return true;
  if (typeof onDuplicate === 'function') onDuplicate(dup);
  return false;
}

function disableCardBrowserAutocomplete(field) {
  if (!field) return;
  const tagName = String(field.tagName || '').toUpperCase();
  if (tagName !== 'INPUT' && tagName !== 'TEXTAREA') return;

  const inputType = String(field.type || '').toLowerCase();
  if (tagName === 'INPUT' && ['hidden', 'file', 'checkbox', 'radio', 'button', 'submit', 'reset'].includes(inputType)) {
    return;
  }

  field.setAttribute('autocomplete', 'off');
  field.setAttribute('autocorrect', 'off');
  field.setAttribute('autocapitalize', 'off');
  field.spellcheck = false;
}

function setupCardBrowserAutocompleteGuard() {
  const modal = document.getElementById('card-modal');
  if (!modal || modal.dataset.autocompleteGuard === 'true') return;
  modal.dataset.autocompleteGuard = 'true';

  const cardForm = document.getElementById('card-form');
  if (cardForm) cardForm.setAttribute('autocomplete', 'off');
  const routeForm = document.getElementById('route-form');
  if (routeForm) routeForm.setAttribute('autocomplete', 'off');

  modal.querySelectorAll('input, textarea').forEach(disableCardBrowserAutocomplete);
  modal.addEventListener('focusin', event => {
    const field = event.target.closest('input, textarea');
    if (field) disableCardBrowserAutocomplete(field);
  });
}

function setupForms() {
  setupCardBrowserAutocompleteGuard();

  const newCardBtn = document.getElementById('btn-new-card');
  if (newCardBtn) {
    newCardBtn.addEventListener('click', () => {
      navigateToRoute('/cards/new');
    });
  }

  const newMkiBtn = document.getElementById('btn-new-mki');
  if (newMkiBtn) {
    newMkiBtn.addEventListener('click', () => navigateToRoute('/cards/new'));
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

  const cardRouteInput = document.getElementById('card-route-number');
  if (cardRouteInput) {
    cardRouteInput.addEventListener('input', e => {
      if (activeCardDraft) {
        activeCardDraft.routeCardNumber = e.target.value.trim();
      }
      updateCardMainSummary();
      if (activeCardDraft && activeCardDraft.cardType === 'MKI') {
        renderMkiSerialTables();
      }
    });
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

  const witnessSampleQtyInput = document.getElementById('card-witness-sample-qty');
  if (witnessSampleQtyInput) {
    witnessSampleQtyInput.addEventListener('input', e => {
      if (!activeCardDraft || activeCardDraft.cardType !== 'MKI') return;
      const raw = e.target.value.trim();
      const qtyVal = raw === '' ? '' : Math.max(0, parseInt(raw, 10) || 0);
      activeCardDraft.witnessSampleCount = Number.isFinite(qtyVal) ? qtyVal : '';
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
    itemSerialsWrapper.addEventListener('click', e => {
      const btn = e.target.closest('.serials-qr-btn');
      if (!btn) return;
      if (!activeCardDraft) return;
      const row = btn.closest('tr');
      const input = row ? row.querySelector('.serials-input') : null;
      const idx = input ? parseInt(input.dataset.index, 10) : -1;
      const serial = input ? (input.value || '').trim() : '';
      if (!serial) {
        showToast?.('Введите индивидуальный номер изделия') || alert('Введите индивидуальный номер изделия');
        return;
      }
      if (typeof openPartBarcodeModal === 'function') {
        ensureCardFlow(activeCardDraft);
        const flowItem = Number.isFinite(idx) && idx >= 0
          ? ((activeCardDraft.flow?.items || [])[idx] || null)
          : null;
        openPartBarcodeModal(activeCardDraft, flowItem || serial);
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

  const witnessSerialsWrapper = document.getElementById('card-witness-sample-serials-table-wrapper');
  if (witnessSerialsWrapper) {
    witnessSerialsWrapper.addEventListener('input', e => {
      if (!activeCardDraft || activeCardDraft.cardType !== 'MKI') return;
      const input = e.target.closest('.serials-input');
      if (!input) return;
      const idx = parseInt(input.dataset.index, 10);
      if (!Number.isNaN(idx) && idx >= 0) {
        activeCardDraft.witnessSampleSerials[idx] = input.value;
      }
    });
  }

  const itemSerialsTextarea = document.getElementById('card-item-serials');
  if (itemSerialsTextarea) {
    itemSerialsTextarea.addEventListener('input', () => {
      if (activeCardDraft && activeCardDraft.cardType === 'MKI') return;
    });
  }

  const printAllQrBtn = document.getElementById('card-print-all-qr-btn');
  if (printAllQrBtn) {
    printAllQrBtn.addEventListener('click', async () => {
      if (!activeCardDraft) return;
      const serials = Array.isArray(activeCardDraft.itemSerials)
        ? activeCardDraft.itemSerials
        : normalizeSerialInput(activeCardDraft.itemSerials || '');
      const { items, created } = buildPartQrPrintItems(activeCardDraft, serials);
      if (!items.length) {
        showToast?.('Нет индивидуальных номеров для печати QR') || alert('Нет индивидуальных номеров для печати QR');
        return;
      }
      if (created) {
        await saveData();
        renderEverything();
      }
      openPartBarcodePrintBatch(items, 'QR-код изделия');
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
    saveBtn.addEventListener('click', async () => {
      if (!activeCardDraft) return;
      syncCardDraftFromForm();
      const missing = typeof getMissingRequiredCardFields === 'function'
        ? getMissingRequiredCardFields(activeCardDraft)
        : [];
      if (missing.length) {
        alert('Заполните обязательные поля: ' + missing.join(', '));
        return;
      }
      document.getElementById('card-status-text').textContent = cardStatusText(activeCardDraft);
      if (typeof setCardSaveButtonPendingState === 'function') {
        setCardSaveButtonPendingState(true);
      }
      try {
        await saveCardDraft();
      } finally {
        if (typeof setCardSaveButtonPendingState === 'function') {
          setCardSaveButtonPendingState(false);
        }
      }
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

  const resolveRouteOpFromInput = () => {
    const opInput = document.getElementById('route-op');
    const opList = document.getElementById('route-op-options');
    const opValue = (opInput ? opInput.value.trim() : '');
    const opMatch = Array.from(opList ? opList.options : []).find(opt => opt.value === opValue);
    const opId = opMatch ? opMatch.dataset.id : null;
    let opRef = ops.find(o => o.id === opId);
    const opTerm = opValue.toLowerCase();
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
    return opRef || null;
  };

  const updateRouteFormByOpType = () => {
    const opRef = resolveRouteOpFromInput();
    const isMaterial = opRef && (isMaterialIssueOperation(opRef) || isMaterialReturnOperation(opRef) || isDryingOperation(opRef));
    const qtyCol = document.querySelector('.route-qty-col');
    const samplesCol = document.getElementById('route-samples-col');
    const controlCol = document.getElementById('route-control-samples-col');
    const qtyInput = document.getElementById('route-qty');
    const witnessToggle = document.getElementById('route-samples-toggle');
    const controlToggle = document.getElementById('route-control-samples-toggle');

    if (qtyCol) qtyCol.classList.toggle('hidden', Boolean(isMaterial));
    if (samplesCol) samplesCol.classList.toggle('hidden', Boolean(isMaterial));
    if (controlCol) controlCol.classList.toggle('hidden', Boolean(isMaterial));
    if (isMaterial) {
      if (witnessToggle) witnessToggle.checked = false;
      if (controlToggle) controlToggle.checked = false;
      if (qtyInput) qtyInput.value = '';
      routeQtyManual = false;
    } else {
      updateRouteFormQuantityUI();
    }
  };

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
    const witnessToggle = document.getElementById('route-samples-toggle');
    const controlToggle = document.getElementById('route-control-samples-toggle');
    const isMki = activeCardDraft.cardType === 'MKI';
    const isWitnessMode = isMki && witnessToggle ? Boolean(witnessToggle.checked) : false;
    const isControlMode = isMki && controlToggle ? Boolean(controlToggle.checked) : false;
    const isSamplesMode = isWitnessMode || isControlMode;
    const sampleType = isWitnessMode ? 'WITNESS' : (isControlMode ? 'CONTROL' : '');
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
    if (isMaterialIssueOperation(opRef)) {
      const hasMaterialIssue = (activeCardDraft.operations || []).some(op => op && isMaterialIssueOperation(op));
      if (hasMaterialIssue) {
        if (typeof showToast === 'function') {
          showToast('В МК может быть только одна операция типа «Получение материала».');
        }
        return;
      }
    }
    if (isMaterialReturnOperation(opRef)) {
      const hasMaterialReturn = (activeCardDraft.operations || []).some(op => op && isMaterialReturnOperation(op));
      if (hasMaterialReturn) {
        if (typeof showToast === 'function') {
          showToast('В МК может быть только одна операция типа «Возврат материала».');
        }
        return;
      }
      const hasMaterialIssue = (activeCardDraft.operations || []).some(op => op && isMaterialIssueOperation(op));
      if (!hasMaterialIssue) {
        if (typeof showToast === 'function') {
          showToast('Нельзя добавить «Возврат материала» без операции «Получение материала».');
        }
        return;
      }
    }
    const isMaterialLike = isMaterialIssueOperation(opRef) || isMaterialReturnOperation(opRef) || isDryingOperation(opRef);
    const qtyValue = isMaterialLike
      ? ''
      : (isMki
        ? computeMkiOperationQuantity({ isSamples: isSamplesMode, sampleType }, activeCardDraft)
        : (qtyInput === '' ? activeCardDraft.quantity : qtyInput));
    const qtyNumeric = isMaterialLike
      ? ''
      : (isMki
        ? computeMkiOperationQuantity({ isSamples: isSamplesMode, sampleType }, activeCardDraft)
        : (qtyValue === '' ? '' : toSafeCount(qtyValue)));
    const maxOrder = activeCardDraft.operations && activeCardDraft.operations.length
      ? Math.max.apply(null, activeCardDraft.operations.map(o => o.order || 0))
      : 0;
    const rop = createRouteOpFromRefs(opRef, centerRef, '', planned, maxOrder + 1, {
      code: codeValue,
      autoCode: !codeValue,
      quantity: qtyValue,
      isSamples: isMaterialLike ? false : isSamplesMode,
      sampleType: isMaterialLike ? '' : sampleType,
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
    updateRouteFormByOpType();
    fillRouteSelectors();
  });

  const routeOpInput = document.getElementById('route-op');
  if (routeOpInput) {
    routeOpInput.removeAttribute('list');
    const openOpList = () => {
      const { filteredOps } = getFilteredRouteSources();
      updateRouteCombo('op', filteredOps, { forceOpen: true });
    };
    routeOpInput.addEventListener('input', () => {
      fillRouteSelectors();
      updateRouteFormByOpType();
      openOpList();
    });
    routeOpInput.addEventListener('focus', openOpList);
    routeOpInput.addEventListener('click', openOpList);
    routeOpInput.addEventListener('blur', () => {
      updateRouteFormByOpType();
      hideRouteCombos();
    });
  }

  const routeCenterInput = document.getElementById('route-center');
  if (routeCenterInput) {
    routeCenterInput.removeAttribute('list');
    const openCenterList = () => {
      const { filteredCenters } = getFilteredRouteSources();
      updateRouteCombo('center', filteredCenters, { forceOpen: true });
    };
    routeCenterInput.addEventListener('input', () => {
      fillRouteSelectors();
      openCenterList();
    });
    routeCenterInput.addEventListener('focus', openCenterList);
    routeCenterInput.addEventListener('click', openCenterList);
  }

  document.addEventListener('click', e => {
    if (!e.target.closest('.combo-field')) {
      hideRouteCombos();
    }
  });

  window.addEventListener('resize', () => {
    if (!isPhoneLayout()) {
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
  const routeControlToggle = document.getElementById('route-control-samples-toggle');
  if (routeSamplesToggle) {
    routeSamplesToggle.addEventListener('change', () => {
      if (routeSamplesToggle.checked && routeControlToggle) {
        routeControlToggle.checked = false;
      }
      updateRouteFormQuantityUI();
    });
  }
  if (routeControlToggle) {
    routeControlToggle.addEventListener('change', () => {
      if (routeControlToggle.checked && routeSamplesToggle) {
        routeSamplesToggle.checked = false;
      }
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

  setupCardsSearch();

  setupProvisionSearch();

  setupInputControlSearch();

  setupApprovalsSearch();

  setupWorkorderFilters();

  setupArchiveSearch();

  setupWorkspaceSearch();
}

function setupArchiveSearch() {
  const archiveSearchInput = document.getElementById('archive-search');
  const archiveSearchClear = document.getElementById('archive-search-clear');
  const archiveStatusSelect = document.getElementById('archive-status');
  if (archiveSearchInput && !archiveSearchInput.dataset.boundSearch) {
    archiveSearchInput.dataset.boundSearch = '1';
    archiveSearchInput.addEventListener('input', e => {
      archiveSearchTerm = e.target.value || '';
      renderArchiveTable();
    });
  }
  if (archiveStatusSelect && !archiveStatusSelect.dataset.boundSearch) {
    archiveStatusSelect.dataset.boundSearch = '1';
    archiveStatusSelect.addEventListener('change', e => {
      archiveStatusFilter = e.target.value || 'ALL';
      renderArchiveTable();
    });
  }
  if (archiveSearchClear && !archiveSearchClear.dataset.boundSearch) {
    archiveSearchClear.dataset.boundSearch = '1';
    archiveSearchClear.addEventListener('click', () => {
      archiveSearchTerm = '';
      if (archiveSearchInput) archiveSearchInput.value = '';
      archiveStatusFilter = 'ALL';
      if (archiveStatusSelect) archiveStatusSelect.value = 'ALL';
      renderArchiveTable();
    });
  }
  if (archiveSearchInput && (archiveSearchInput.value || '') !== (archiveSearchTerm || '')) {
    archiveSearchInput.value = archiveSearchTerm || '';
  }
  if (archiveStatusSelect && (archiveStatusSelect.value || '') !== (archiveStatusFilter || 'ALL')) {
    archiveStatusSelect.value = archiveStatusFilter || 'ALL';
  }
}

function setupInputControlSearch() {
  const inputControlSearchInput = document.getElementById('input-control-search');
  const inputControlSearchClear = document.getElementById('input-control-search-clear');
  if (inputControlSearchInput && !inputControlSearchInput.dataset.boundSearch) {
    inputControlSearchInput.dataset.boundSearch = '1';
    inputControlSearchInput.addEventListener('input', e => {
      inputControlSearchTerm = e.target.value || '';
      renderInputControlTable();
    });
  }
  if (inputControlSearchClear && !inputControlSearchClear.dataset.boundSearch) {
    inputControlSearchClear.dataset.boundSearch = '1';
    inputControlSearchClear.addEventListener('click', () => {
      inputControlSearchTerm = '';
      if (inputControlSearchInput) inputControlSearchInput.value = '';
      renderInputControlTable();
    });
  }
  if (inputControlSearchInput && (inputControlSearchInput.value || '') !== (inputControlSearchTerm || '')) {
    inputControlSearchInput.value = inputControlSearchTerm || '';
  }
}

function setupProvisionSearch() {
  const provisionSearchInput = document.getElementById('provision-search');
  const provisionSearchClear = document.getElementById('provision-search-clear');
  if (provisionSearchInput && !provisionSearchInput.dataset.boundSearch) {
    provisionSearchInput.dataset.boundSearch = '1';
    provisionSearchInput.addEventListener('input', e => {
      provisionSearchTerm = e.target.value || '';
      renderProvisionTable();
    });
  }
  if (provisionSearchClear && !provisionSearchClear.dataset.boundSearch) {
    provisionSearchClear.dataset.boundSearch = '1';
    provisionSearchClear.addEventListener('click', () => {
      provisionSearchTerm = '';
      if (provisionSearchInput) provisionSearchInput.value = '';
      renderProvisionTable();
    });
  }
  if (provisionSearchInput && (provisionSearchInput.value || '') !== (provisionSearchTerm || '')) {
    provisionSearchInput.value = provisionSearchTerm || '';
  }
}

function setupApprovalsSearch() {
  const approvalsSearchInput = document.getElementById('approvals-search');
  const approvalsSearchClear = document.getElementById('approvals-search-clear');
  if (approvalsSearchInput && !approvalsSearchInput.dataset.boundSearch) {
    approvalsSearchInput.dataset.boundSearch = '1';
    approvalsSearchInput.addEventListener('input', e => {
      approvalsSearchTerm = e.target.value || '';
      renderApprovalsTable();
    });
  }
  if (approvalsSearchClear && !approvalsSearchClear.dataset.boundSearch) {
    approvalsSearchClear.dataset.boundSearch = '1';
    approvalsSearchClear.addEventListener('click', () => {
      approvalsSearchTerm = '';
      if (approvalsSearchInput) approvalsSearchInput.value = '';
      renderApprovalsTable();
    });
  }
  if (approvalsSearchInput && (approvalsSearchInput.value || '') !== (approvalsSearchTerm || '')) {
    approvalsSearchInput.value = approvalsSearchTerm || '';
  }
}

function syncCardsAuthorFilterOptions() {
  const cardsAuthorSelect = document.getElementById('cards-author-filter');
  if (!cardsAuthorSelect) return;

  const currentValue = (cardsAuthorFilter || '').trim();
  const authors = Array.from(new Set(
    (typeof getCardsRouteSourceCards === 'function' ? getCardsRouteSourceCards() : (cards || []))
      .filter(card => card && !card.archived && card.cardType === 'MKI')
      .map(card => (card.issuedBySurname || '').trim())
      .filter(Boolean)
  ));

  authors.sort((a, b) => compareTextNatural(normalizeSortText(a), normalizeSortText(b)));

  const optionsHtml = ['<option value="">Все авторы</option>']
    .concat(authors.map(author => '<option value="' + escapeHtml(author) + '">' + escapeHtml(author) + '</option>'))
    .join('');

  if (cardsAuthorSelect.innerHTML !== optionsHtml) {
    cardsAuthorSelect.innerHTML = optionsHtml;
  }

  if (currentValue && !authors.includes(currentValue)) {
    cardsAuthorFilter = '';
  }

  const finalValue = (cardsAuthorFilter || '').trim();
  if ((cardsAuthorSelect.value || '') !== finalValue) {
    cardsAuthorSelect.value = finalValue;
  }
}

let cardsCoreSearchRefreshTimer = null;
let cardsCoreSearchRefreshToken = 0;

function scheduleCardsCoreListSearchRefresh(delay = 180) {
  cardsCoreSearchRefreshToken += 1;
  const refreshToken = cardsCoreSearchRefreshToken;
  if (cardsCoreSearchRefreshTimer) {
    clearTimeout(cardsCoreSearchRefreshTimer);
  }
  cardsCoreSearchRefreshTimer = setTimeout(async () => {
    cardsCoreSearchRefreshTimer = null;
    try {
      if (typeof fetchCardsCoreList === 'function') {
        await fetchCardsCoreList({
          archived: 'active',
          q: typeof cardsSearchTerm === 'string' ? cardsSearchTerm : '',
          force: true,
          reason: 'cards-search'
        });
      }
    } catch (err) {
      console.warn('[DATA] cards-core list search failed', {
        query: typeof cardsSearchTerm === 'string' ? cardsSearchTerm : '',
        error: err?.message || err
      });
    }
    if (refreshToken !== cardsCoreSearchRefreshToken) return;
    renderCardsTable();
  }, Math.max(0, Number(delay) || 0));
}

function setupCardsSearch() {
  const cardsSearchInput = document.getElementById('cards-search');
  const cardsSearchClear = document.getElementById('cards-search-clear');
  const cardsAuthorSelect = document.getElementById('cards-author-filter');
  if (cardsSearchInput && !cardsSearchInput.dataset.boundSearch) {
    cardsSearchInput.dataset.boundSearch = '1';
    cardsSearchInput.addEventListener('input', e => {
      cardsSearchTerm = e.target.value || '';
      cardsTableCurrentPage = 1;
      scheduleCardsCoreListSearchRefresh(180);
    });
  }
  if (cardsSearchClear && !cardsSearchClear.dataset.boundSearch) {
    cardsSearchClear.dataset.boundSearch = '1';
    cardsSearchClear.addEventListener('click', () => {
      cardsSearchTerm = '';
      cardsAuthorFilter = '';
      cardsTableCurrentPage = 1;
      if (cardsSearchInput) cardsSearchInput.value = '';
      if (cardsAuthorSelect) cardsAuthorSelect.value = '';
      scheduleCardsCoreListSearchRefresh(0);
    });
  }
  if (cardsAuthorSelect && !cardsAuthorSelect.dataset.boundSearch) {
    cardsAuthorSelect.dataset.boundSearch = '1';
    cardsAuthorSelect.addEventListener('change', e => {
      cardsAuthorFilter = e.target.value || '';
      cardsTableCurrentPage = 1;
      renderCardsTable();
    });
  }
  syncCardsAuthorFilterOptions();
  if (cardsSearchInput && (cardsSearchInput.value || '') !== (cardsSearchTerm || '')) {
    cardsSearchInput.value = cardsSearchTerm || '';
  }
  if (cardsAuthorSelect && (cardsAuthorSelect.value || '') !== (cardsAuthorFilter || '')) {
    cardsAuthorSelect.value = cardsAuthorFilter || '';
  }
}

function setupWorkspaceSearch() {
  const workspaceSearchInput = document.getElementById('workspace-search');
  const workspaceSearchSubmit = document.getElementById('workspace-search-submit');
  const workspaceSearchClear = document.getElementById('workspace-search-clear');
  const normalizeWorkspaceTerm = (value = '') => (value || '').trim().slice(0, 120);
  const triggerWorkspaceSearch = () => {
    workspaceSearchTerm = workspaceSearchInput ? normalizeWorkspaceTerm(workspaceSearchInput.value || '') : '';
    renderWorkspaceView();
  };

  if (workspaceSearchInput && !workspaceSearchInput.dataset.boundSearch) {
    workspaceSearchInput.dataset.boundSearch = '1';
    workspaceSearchInput.addEventListener('input', e => {
      workspaceSearchTerm = normalizeWorkspaceTerm(e.target.value || '');
    });
    workspaceSearchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        triggerWorkspaceSearch();
      }
    });
  }
  if (workspaceSearchSubmit && !workspaceSearchSubmit.dataset.boundSearch) {
    workspaceSearchSubmit.dataset.boundSearch = '1';
    workspaceSearchSubmit.addEventListener('click', triggerWorkspaceSearch);
  }
  if (workspaceSearchClear && !workspaceSearchClear.dataset.boundSearch) {
    workspaceSearchClear.dataset.boundSearch = '1';
    workspaceSearchClear.addEventListener('click', () => {
      workspaceSearchTerm = '';
      if (workspaceSearchInput) {
        workspaceSearchInput.value = '';
        focusWorkspaceSearch();
      }
      renderWorkspaceView();
    });
  }
  if (workspaceSearchInput && (workspaceSearchInput.value || '') !== (workspaceSearchTerm || '')) {
    workspaceSearchInput.value = workspaceSearchTerm || '';
  }
}

function setupWorkorderFilters() {
  const section = document.getElementById('workorders');
  if (!section) return;
  if (section.dataset.filtersSetup === 'true') return;
  section.dataset.filtersSetup = 'true';

  const searchInput = document.getElementById('workorder-search');
  const searchClearBtn = document.getElementById('workorder-search-clear');
  const statusSelect = document.getElementById('workorder-status');
  const missingExecutorSelect = document.getElementById('workorder-missing-executor');
  const availabilityModeSelect = document.getElementById('workorder-availability-mode');
  const availabilityDateInput = document.getElementById('workorder-filter-date');
  const availabilityShiftSelect = document.getElementById('workorder-filter-shift');
  const resolveWorkorderShiftOptions = () => {
    if (typeof getProductionShiftTimesList === 'function') {
      return getProductionShiftTimesList();
    }
    if (Array.isArray(productionShiftTimes) && productionShiftTimes.length) {
      return productionShiftTimes.slice().sort((a, b) => (a.shift || 0) - (b.shift || 0));
    }
    return getDefaultProductionShiftTimes();
  };
  if (!workorderFilterDate) {
    workorderFilterDate = getCurrentDateString();
  }
  if (availabilityModeSelect) {
    availabilityModeSelect.value = workorderAvailabilityMode || 'ALL';
  }
  if (availabilityDateInput) {
    availabilityDateInput.value = workorderFilterDate || '';
  }
  if (availabilityShiftSelect) {
    const shiftOptions = resolveWorkorderShiftOptions();
    availabilityShiftSelect.innerHTML = [
      '<option value="">Любая смена</option>',
      ...shiftOptions.map(item => (
        `<option value="${escapeHtml(String(item.shift))}">${escapeHtml(String(item.shift))} смена</option>`
      ))
    ].join('');
    availabilityShiftSelect.value = workorderFilterShift || '';
  }
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
      workorderAvailabilityMode = 'ALL';
      workorderFilterDate = getCurrentDateString();
      workorderFilterShift = '';
      if (availabilityModeSelect) availabilityModeSelect.value = workorderAvailabilityMode;
      if (availabilityDateInput) availabilityDateInput.value = workorderFilterDate;
      if (availabilityShiftSelect) availabilityShiftSelect.value = '';
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

  if (availabilityModeSelect) {
    availabilityModeSelect.addEventListener('change', e => {
      workorderAvailabilityMode = e.target.value || 'ALL';
      renderWorkordersTable({ collapseAll: true });
    });
  }

  if (availabilityDateInput) {
    availabilityDateInput.addEventListener('input', e => {
      workorderFilterDate = e.target.value || '';
      renderWorkordersTable({ collapseAll: true });
    });
    availabilityDateInput.addEventListener('change', e => {
      workorderFilterDate = e.target.value || '';
      renderWorkordersTable({ collapseAll: true });
    });
  }

  if (availabilityShiftSelect) {
    availabilityShiftSelect.addEventListener('change', e => {
      workorderFilterShift = e.target.value || '';
      renderWorkordersTable({ collapseAll: true });
    });
  }
}
