(function () {
  function ensureTopProgress() {
    let el = document.querySelector('.top-progress');
    if (!el) {
      el = document.createElement('div');
      el.className = 'top-progress is-hidden';
      document.body.appendChild(el);
    }
    return el;
  }

  const top = { el: null, t: null, active: 0, pct: 0 };

  function startTopProgress() {
    top.el = top.el || ensureTopProgress();
    top.active++;
    if (top.active === 1) {
      top.pct = 8;
      top.el.classList.remove('is-hidden');
      top.el.style.width = top.pct + '%';
      if (top.t) clearInterval(top.t);
      top.t = setInterval(() => {
        if (top.pct < 90) {
          top.pct += Math.max(0.4, (90 - top.pct) * 0.02);
          top.el.style.width = top.pct.toFixed(2) + '%';
        }
      }, 120);
    }
  }

  function finishTopProgress() {
    top.el = top.el || ensureTopProgress();
    top.active = Math.max(0, top.active - 1);
    if (top.active === 0) {
      if (top.t) {
        clearInterval(top.t);
        top.t = null;
      }
      top.pct = 100;
      top.el.style.width = '100%';
      setTimeout(() => {
        top.el.classList.add('is-hidden');
        top.el.style.width = '0%';
        top.pct = 0;
      }, 220);
    }
  }

  const registry = new Map();

  function registerSkeleton(pageId, renderer) {
    registry.set(pageId, renderer);
  }

  function defaultPageSkeleton(root) {
    if (!root) return;
    root.innerHTML = `
      <div class="skel skel-row h36 w40"></div>
      <div class="skel skel-row w90"></div>
      <div class="skel skel-row w70"></div>
      <div class="skel skel-block skel"></div>
    `;
  }

  function tableSkeleton(root) {
    if (!root) return;
    root.innerHTML = `
      <div class="skel skel-row h36 w40"></div>
      <div class="skel skel-row w55"></div>
      <div class="skel skel-table skel"></div>
    `;
  }

  function renderSkeletonForPage(pageId, root) {
    const fn = registry.get(pageId);
    if (fn) return fn(root);
    return defaultPageSkeleton(root);
  }

  function removeSkeletonOverlay(sectionEl) {
    if (!sectionEl) return;
    const old = sectionEl.querySelector(':scope > .spa-skeleton-overlay');
    if (old) old.remove();
    sectionEl.classList.remove('spa-skeleton-host');
  }

  function showSkeletonOverlay(pageId, sectionEl) {
    if (!sectionEl) return;
    removeSkeletonOverlay(sectionEl);

    sectionEl.classList.add('spa-skeleton-host');

    const overlay = document.createElement('div');
    overlay.className = 'spa-skeleton-overlay';

    // ВАЖНО: рисуем скелетон ВНУТРИ overlay, НЕ внутри section
    renderSkeletonForPage(pageId, overlay);

    sectionEl.appendChild(overlay);
  }

  function hideSkeletonOverlay(sectionEl) {
    removeSkeletonOverlay(sectionEl);
  }

  function getActiveMainSection() {
    return (
      document.querySelector('.page-view:not([hidden])') ||
      document.querySelector('main section.active') ||
      document.querySelector('main section:not(.hidden)') ||
      document.querySelector('main') ||
      null
    );
  }

  window.SPA_LOADING = {
    startTopProgress,
    finishTopProgress,
    registerSkeleton,
    renderSkeletonForPage,
    defaultPageSkeleton,
    tableSkeleton,
    getActiveMainSection,
    showSkeletonOverlay,
    hideSkeletonOverlay
  };
})();
