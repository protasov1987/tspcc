// === ИНИЦИАЛИЗАЦИЯ ===
document.addEventListener('DOMContentLoaded', async () => {
  await ensureAppVersionFooter();
  loadUserPasswordCache();
  setupResponsiveNav();
  startRealtimeClock();
  setupAuthControls();
  setupHelpModal();
  updateUserBadge();
  hideMainApp();
  showSessionOverlay('Проверка сессии...');
  await restoreSession();

  // Initialize navigation after session is restored
  if (typeof initNavigation === 'function') {
    initNavigation();
  }
});
