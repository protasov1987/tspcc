// === ИНИЦИАЛИЗАЦИЯ ===
let appBootstrapStarted = false;

async function runAppBootstrap() {
  if (appBootstrapStarted) return;
  appBootstrapStarted = true;

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
}

function startAppBootstrap() {
  runAppBootstrap().catch((err) => {
    console.error('[BOOT] App bootstrap failed', err?.message || err);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startAppBootstrap, { once: true });
} else {
  startAppBootstrap();
}
