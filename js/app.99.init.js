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

  // Initialize navigation after session is restored
  if (typeof initNavigation === 'function') {
    initNavigation();
  }

  window.addEventListener('popstate', () => {
    if (typeof handleRoute === 'function') {
      const fullPath = (window.location.pathname + window.location.search) || '/';
      handleRoute(fullPath, { replace: true, fromHistory: true, soft: true });
    }
  });
});
