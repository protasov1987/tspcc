// === ОБЩИЙ РЕНДЕР ===
function refreshCardStatuses() {
  cards.forEach(card => {
    syncApprovalStatus(card);
    recalcCardStatus(card);
  });
}

function renderEverything() {
  refreshCardStatuses();

  // В SPA не все «обёртки» присутствуют в DOM одновременно (страницы монтируются выборочно).
  // Любой рендер, который без проверки пишет в wrapper.innerHTML, может бросить ошибку и оборвать renderEverything().
  // Итог: изменения видны только после F5. Делаем общий рендер устойчивым.
  const safeRender = (name, fn) => {
    try {
      if (typeof fn === 'function') fn();
    } catch (e) {
      console.warn('renderEverything: render failed -> ' + name, e);
    }
  };

  safeRender('renderDashboard', renderDashboard);
  safeRender('renderCardsTable', renderCardsTable);
  safeRender('renderProvisionTable', renderProvisionTable);
  safeRender('renderApprovalsTable', renderApprovalsTable);
  safeRender('renderCentersTable', renderCentersTable);
  safeRender('renderOpsTable', renderOpsTable);
  safeRender('fillRouteSelectors', fillRouteSelectors);
  safeRender('renderWorkordersTable', renderWorkordersTable);
  safeRender('renderArchiveTable', renderArchiveTable);
  safeRender('renderWorkspaceView', renderWorkspaceView);
  safeRender('renderUsersTable', renderUsersTable);
  safeRender('renderAccessLevelsTable', renderAccessLevelsTable);
  safeRender('renderProductionSchedule', renderProductionSchedule);
  safeRender('syncReadonlyLocks', syncReadonlyLocks);

  // Если сейчас открыт page-view карточки (/workorders/:qr или /archive/:qr) — перерисовать и его.
  if (typeof refreshActiveWoPageIfAny === 'function') {
    refreshActiveWoPageIfAny();
  }
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

function setupProvisionModal() {
  const modal = document.getElementById('provision-production-order-modal');
  if (!modal) return;
  const confirmBtn = document.getElementById('provision-production-order-confirm');
  const cancelBtn = document.getElementById('provision-production-order-cancel');
  if (confirmBtn) confirmBtn.addEventListener('click', () => submitProvisionModal());
  if (cancelBtn) cancelBtn.addEventListener('click', () => closeProvisionModal());
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeProvisionModal();
  });
}
