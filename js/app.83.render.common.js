// === ОБЩИЙ РЕНДЕР ===
function refreshCardStatuses() {
  cards.forEach(card => recalcCardStatus(card));
}

function renderEverything() {
  refreshCardStatuses();
  renderDashboard();
  renderCardsTable();
  renderCentersTable();
  renderOpsTable();
  fillRouteSelectors();
  renderWorkordersTable();
  renderArchiveTable();
  renderWorkspaceView();
  renderUsersTable();
  renderAccessLevelsTable();
  syncReadonlyLocks();
}

function setupDeleteConfirmModal() {
  const cancelBtn = document.getElementById('delete-confirm-cancel');
  const closeBtn = document.getElementById('delete-confirm-close');
  const confirmBtn = document.getElementById('delete-confirm-apply');
  const modal = document.getElementById('delete-confirm-modal');

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => closeDeleteConfirm());
  }
  if (closeBtn) {
    closeBtn.addEventListener('click', () => closeDeleteConfirm());
  }
  if (modal) {
    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        closeDeleteConfirm();
      }
    });
  }
  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => confirmDeletion());
  }
}

function setupGroupTransferModal() {
  const closeBtn = document.getElementById('group-transfer-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => closeGroupTransferModal());
  }
}

function setupGroupExecutorModal() {
  const createBtn = document.getElementById('group-executor-submit');
  const cancelBtn = document.getElementById('group-executor-cancel');

  if (createBtn) {
    createBtn.addEventListener('click', () => applyGroupExecutorToGroup());
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => closeGroupExecutorModal());
  }
}

function setupAttachmentControls() {
  const modal = document.getElementById('attachments-modal');
  const closeBtn = document.getElementById('attachments-close');
  const addBtn = document.getElementById('attachments-add-btn');
  const input = document.getElementById('attachments-input');
  const cardBtn = document.getElementById('card-attachments-btn');

  if (closeBtn) {
    closeBtn.addEventListener('click', () => closeAttachmentsModal());
  }
  if (addBtn && input) {
    addBtn.addEventListener('click', () => input.click());
    input.addEventListener('change', (e) => {
      addAttachmentsFromFiles(e.target.files);
      input.value = '';
    });
  }
  if (cardBtn) {
    cardBtn.addEventListener('click', () => {
      if (!activeCardDraft) return;
      openAttachmentsModal(activeCardDraft.id, 'draft');
    });
  }
}

function setupWorkspaceModal() {
  const modal = document.getElementById('workspace-stop-modal');
  if (!modal) return;

  const keypadButtons = modal.querySelectorAll('.workspace-keypad button[data-key]');
  keypadButtons.forEach(btn => {
    btn.addEventListener('click', () => applyWorkspaceKeypad(btn.getAttribute('data-key')));
  });

  const enterBtn = document.getElementById('workspace-stop-enter');
  if (enterBtn) {
    enterBtn.addEventListener('click', () => submitWorkspaceStopModal());
  }

  const nextBtn = document.getElementById('workspace-stop-next');
  if (nextBtn) {
    nextBtn.addEventListener('click', () => focusWorkspaceNextInput());
  }

  const confirmBtn = document.getElementById('workspace-stop-confirm');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => submitWorkspaceStopModal());
  }

  const cancelBtn = document.getElementById('workspace-stop-cancel');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => closeWorkspaceStopModal());
  }

  getWorkspaceModalInputs().forEach(input => {
    input.addEventListener('focus', () => setWorkspaceActiveInput(input));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitWorkspaceStopModal();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        focusWorkspaceNextInput();
      }
    });
  });
}

