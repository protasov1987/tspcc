(function () {
  const L = window.SPA_LOADING;
  if (!L) return;

  // Табличные разделы (у вас это табы main section)
  [
    'page-dashboard',
    'page-cards',
    'page-approvals',
    'page-provision',
    'page-input-control',
    'page-departments',
    'page-operations',
    'page-areas',
    'page-employees',
    'page-shift-times',
    'page-workorders',
    'page-archive',
    'page-workspace',
    'page-users',
    'page-accessLevels'
  ].forEach((id) => L.registerSkeleton(id, (root) => L.tableSkeleton(root)));

  // Производство (ваши секции: production-*)
  [
    'page-production-schedule',
    'page-production-plan',
    'page-production-shifts',
    'page-production-delayed',
    'page-production-defects'
  ].forEach((id) =>
    L.registerSkeleton(id, (root) => {
      if (!root) return;
      root.innerHTML = `
      <div class="skel skel-row h36 w40"></div>
      <div class="skel skel-row w70"></div>
      <div class="skel skel-block skel"></div>
      <div class="skel skel-table skel"></div>
    `;
    })
  );

  // Страница профиля
  L.registerSkeleton('page-user-profile', (root) => {
    if (!root) return;
    root.innerHTML = `
      <div class="skel skel-row h36 w25"></div>
      <div class="skel skel-row w55"></div>
      <div class="skel skel-row w40"></div>
      <div class="skel skel-block skel"></div>
    `;
  });

  // Детальная страница карты через page-mode mount (cards-new / cards-mki/new / cards/:id page-mode)
  L.registerSkeleton('page-card-mode', (root) => {
    if (!root) return;
    root.innerHTML = `
      <div class="skel skel-row h36 w40"></div>
      <div class="skel skel-row w90"></div>
      <div class="skel skel-table skel"></div>
      <div class="skel skel-block skel"></div>
    `;
  });
})();
