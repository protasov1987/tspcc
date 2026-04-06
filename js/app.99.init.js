// === РРќРР¦РРђР›РР—РђР¦РРЇ ===
let appBootstrapStarted = false;

async function runAppBootstrap() {
  if (appBootstrapStarted) return;
  appBootstrapStarted = true;

  if (typeof startAppVersionSync === 'function') {
    startAppVersionSync();
  }
  await ensureAppVersionFooter();
  loadUserPasswordCache();
  setupResponsiveNav();
  startRealtimeClock();
  setupAuthControls();
  setupHelpModal();
  updateUserBadge();
  hideMainApp();
  showSessionOverlay('РџСЂРѕРІРµСЂРєР° СЃРµСЃСЃРёРё...');
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
