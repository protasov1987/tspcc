// === ROUTE SEARCHES & FILTERS ===
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
    (cards || [])
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

function setupCardsSearch() {
  const cardsSearchInput = document.getElementById('cards-search');
  const cardsSearchClear = document.getElementById('cards-search-clear');
  const cardsAuthorSelect = document.getElementById('cards-author-filter');
  if (cardsSearchInput && !cardsSearchInput.dataset.boundSearch) {
    cardsSearchInput.dataset.boundSearch = '1';
    cardsSearchInput.addEventListener('input', e => {
      cardsSearchTerm = e.target.value || '';
      cardsTableCurrentPage = 1;
      renderCardsTable();
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
      renderCardsTable();
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
