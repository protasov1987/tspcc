// === ИНИЦИАЛИЗАЦИЯ ===
document.addEventListener('DOMContentLoaded', async () => {
  loadUserPasswordCache();
  setupResponsiveNav();
  startRealtimeClock();
  setupAuthControls();
  setupHelpModal();
  updateUserBadge();
  hideMainApp();
  showSessionOverlay('Проверка сессии...');
  await restoreSession();
});
