// === ИНИЦИАЛИЗАЦИЯ ===
let appBootstrapStarted = false;

async function runAppBootstrap() {
  if (appBootstrapStarted) return;
  appBootstrapStarted = true;

  window.__bootPerf = window.__bootPerf || {};
  window.__bootPerf.t0 = performance.now();
  console.log('[PERF] boot:start', {
    path: window.location.pathname + window.location.search
  });

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
  window.__bootPerf.t1 = performance.now();
  console.log('[PERF] boot:restoreSession:done', {
    totalMs: Math.round(window.__bootPerf.t1 - window.__bootPerf.t0)
  });

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
