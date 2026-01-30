// === ОБЩИЙ РЕНДЕР ===
function refreshCardStatuses() {
  cards.forEach(card => {
    syncApprovalStatus(card);
    recalcCardStatus(card);
  });
}

function buildDashboardLikeStatusHtml(card) {
  const opsArr = (card && card.operations) ? card.operations : [];
  const state = getCardProcessState(card);
  const activeOps = opsArr.filter(o => o.status === 'IN_PROGRESS' || o.status === 'PAUSED');

  let statusHtml = '';

  if (state.key === 'DONE') {
    statusHtml = '<span class="dash-card-completed">Завершена</span>';
  } else if (!opsArr.length || opsArr.every(o => o.status === 'NOT_STARTED' || !o.status)) {
    statusHtml = 'Не запущена';
  } else if (activeOps.length) {
    activeOps.forEach(op => {
      const elapsed = getOperationElapsedSeconds(op);
      const plannedSec = (op.plannedMinutes || 0) * 60;
      let cls = 'dash-op';
      if (op.status === 'PAUSED') cls += ' dash-op-paused';
      if (plannedSec && elapsed > plannedSec) cls += ' dash-op-overdue';

      statusHtml +=
        '<span class="' + cls + '" data-card-id="' + card.id + '" data-op-id="' + op.id + '">' +
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
      statusHtml = renderOpLabel(next) + ' (ожидание)';
    } else {
      statusHtml = 'Не запущена';
    }
  }

  return statusHtml;
}

function renderEverything() {
  refreshCardStatuses();

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
  safeRender('renderInputControlTable', renderInputControlTable);
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

function setupInputControlModal() {
  const modal = document.getElementById('input-control-modal');
  if (!modal) return;
  const confirmBtn = document.getElementById('input-control-confirm');
  const cancelBtn = document.getElementById('input-control-cancel');
  if (confirmBtn) confirmBtn.addEventListener('click', () => submitInputControlModal());
  if (cancelBtn) cancelBtn.addEventListener('click', () => closeInputControlModal());
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeInputControlModal();
  });

  const tab = document.getElementById('tab-input-control');
  if (tab) {
    tab.addEventListener('click', (event) => {
      const actionBtn = event.target.closest('[data-action]');
      if (!actionBtn) return;
      const action = actionBtn.getAttribute('data-action');
      if (action === 'input-control-add-file') {
        const fileInput = document.getElementById('input-control-file-input');
        if (fileInput) fileInput.click();
      } else if (action === 'input-control-complete') {
        const targetCardId = typeof getActiveCardId === 'function' ? getActiveCardId() : null;
        if (targetCardId) openInputControlModal(targetCardId);
      } else if (action === 'input-control-preview-file') {
        const fileId = actionBtn.getAttribute('data-file-id');
        const cardId = typeof getActiveCardId === 'function' ? getActiveCardId() : null;
        if (fileId && typeof previewInputControlAttachment === 'function') {
          previewInputControlAttachment(fileId, cardId);
        }
      } else if (action === 'input-control-download-file') {
        const fileId = actionBtn.getAttribute('data-file-id');
        const cardId = typeof getActiveCardId === 'function' ? getActiveCardId() : null;
        if (fileId && typeof downloadInputControlAttachment === 'function') {
          downloadInputControlAttachment(fileId, cardId);
        }
      }
    });
  }

  const fileInput = document.getElementById('input-control-file-input');
  if (fileInput) {
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (file && typeof addInputControlFileToActiveCard === 'function') {
        addInputControlFileToActiveCard(file);
      }
      fileInput.value = '';
    });
  }
}

const allContentWrappers = [
	'#dashboard-content',
	'#directories-content',
	'#receipts-content',
	'#approvals-content',
	'#production-content',
	'#modal-receipt-content',
	'#modal-card-route-content',
	'#users-access-content',
	'#messenger-content',
];

function showContent(contentId) {
	// 1. Hide all wrappers
	allContentWrappers.forEach(wrapperSelector => {
		const wrapper = document.querySelector(wrapperSelector);
		if (wrapper) {
			wrapper.classList.add('hidden');
		}
	});

	// 2. Show the requested wrapper
	const contentToShow = document.querySelector(contentId);
	if (contentToShow) {
		contentToShow.classList.remove('hidden');
	}
}
