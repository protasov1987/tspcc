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
  await ensureLoginVersionFooter();
  loadUserPasswordCache();
  setupResponsiveNav();
  startRealtimeClock();
  setupAuthControls();
  setupHelpModal();
  updateUserBadge();
  if (typeof setSessionRestorePhase === 'function') {
    setSessionRestorePhase('pending', 'runAppBootstrap:start');
  }
  hideMainApp();
  showSessionOverlay('Проверка сессии...');
  await restoreSession();
  window.__bootPerf.t1 = performance.now();
  console.log('[PERF] boot:restoreSession:done', {
    totalMs: Math.round(window.__bootPerf.t1 - window.__bootPerf.t0)
  });
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
