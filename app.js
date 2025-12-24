(function () {
  const scriptUrls = [
    '/js/app.00.state.js',
    '/js/app.10.utils.js',
    '/js/app.20.routeModel.js',
    '/js/app.30.imdx.js',
    '/js/app.40.store.js',
    '/js/app.50.auth.js',
    '/js/app.60.render.dashboard.js',
    '/js/app.70.render.cards.js',
    '/js/app.71.cardRoute.modal.js',
    '/js/app.72.directories.js',
    '/js/app.73.receipts.js',
    '/js/app.80.timer.js',
    '/js/app.81.navigation.js',
    '/js/app.82.forms.js',
    '/js/app.83.render.common.js',
    '/js/app.90.usersAccess.js',
    '/js/app.99.init.js'
  ];

  function loadScriptSequential(urls) {
    return urls.reduce((chain, url) => {
      return chain.then(() => new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.defer = true;
        script.onload = () => resolve();
        script.onerror = () => {
          console.error(`Не удалось загрузить скрипт: ${url}`);
          reject(new Error(`Failed to load ${url}`));
        };
        (document.head || document.body).appendChild(script);
      }));
    }, Promise.resolve());
  }

  loadScriptSequential(scriptUrls).catch(err => {
    console.error('Ошибка последовательной загрузки скриптов:', err);
  });
})();
