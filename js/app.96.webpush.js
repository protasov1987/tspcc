function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function webPushEnsureSw() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    return reg;
  } catch (err) {
    console.warn('ServiceWorker registration failed', err);
    return null;
  }
}

async function webPushGetPublicKey() {
  const res = await apiFetch('/api/push/vapidPublicKey');
  if (res.status === 501) {
    const payload = await res.json().catch(() => ({}));
    const msg = payload?.error || 'WebPush не настроен на сервере';
    const err = new Error(msg);
    err.code = 501;
    throw err;
  }
  if (!res.ok) throw new Error('Не удалось получить VAPID ключ');
  const payload = await res.json().catch(() => ({}));
  return payload.publicKey || '';
}

async function webPushSubscribe() {
  const reg = await webPushEnsureSw();
  if (!reg) throw new Error('Service Worker недоступен');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Разрешение на уведомления не получено');

  const publicKey = await webPushGetPublicKey();
  if (!publicKey) throw new Error('Некорректный VAPID ключ');

  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey)
  });

  const res = await apiFetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription, userAgent: navigator.userAgent })
  });
  if (!res.ok) throw new Error('Не удалось сохранить подписку');
  return true;
}

async function webPushUnsubscribe() {
  const reg = await webPushEnsureSw();
  if (!reg) return false;
  const subscription = await reg.pushManager.getSubscription();
  if (!subscription) return true;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  if (endpoint) {
    await apiFetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint })
    });
  }
  return true;
}

async function webPushRefreshUi() {
  const statusEl = document.getElementById('webpush-status');
  const enableBtn = document.getElementById('webpush-enable-btn');
  const disableBtn = document.getElementById('webpush-disable-btn');
  const testBtn = document.getElementById('webpush-test-btn');

  if (!statusEl || !enableBtn || !disableBtn) return;

  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!supported) {
    statusEl.textContent = 'WebPush: не поддерживается';
    enableBtn.classList.add('hidden');
    disableBtn.classList.add('hidden');
    if (testBtn) testBtn.classList.add('hidden');
    return;
  }

  try {
    await webPushGetPublicKey();
  } catch (err) {
    if (err && err.code === 501) {
      statusEl.textContent = err.message;
      enableBtn.classList.add('hidden');
      disableBtn.classList.add('hidden');
      if (testBtn) testBtn.classList.add('hidden');
      return;
    }
  }

  const permission = Notification.permission;
  try {
    const reg = await webPushEnsureSw();
    const subscription = reg ? await reg.pushManager.getSubscription() : null;

    if (permission === 'denied') {
      statusEl.textContent = 'WebPush: заблокировано в браузере';
      enableBtn.classList.add('hidden');
      disableBtn.classList.add('hidden');
      if (testBtn) testBtn.classList.add('hidden');
      return;
    }

    if (subscription) {
      statusEl.textContent = 'WebPush: включен';
      enableBtn.classList.add('hidden');
      disableBtn.classList.remove('hidden');
      if (testBtn) testBtn.classList.remove('hidden');
      return;
    }

    statusEl.textContent = permission === 'granted' ? 'WebPush: выключен' : 'WebPush: не настроен';
    enableBtn.classList.remove('hidden');
    disableBtn.classList.add('hidden');
    if (testBtn) testBtn.classList.add('hidden');
  } catch (err) {
    statusEl.textContent = 'WebPush: ошибка инициализации';
    enableBtn.classList.remove('hidden');
    disableBtn.classList.add('hidden');
    if (testBtn) testBtn.classList.add('hidden');
  }
}

function bindWebPushProfileUi() {
  const enableBtn = document.getElementById('webpush-enable-btn');
  const disableBtn = document.getElementById('webpush-disable-btn');
  const testBtn = document.getElementById('webpush-test-btn');
  const statusEl = document.getElementById('webpush-status');
  if (!enableBtn || !disableBtn || !statusEl) return;
  if (enableBtn.dataset.bound === 'true') return;

  enableBtn.dataset.bound = 'true';
  disableBtn.dataset.bound = 'true';
  if (testBtn) testBtn.dataset.bound = 'true';

  enableBtn.addEventListener('click', async () => {
    try {
      await webPushSubscribe();
    } catch (err) {
      showToast?.(err.message || 'Ошибка WebPush') || alert(err.message || 'Ошибка WebPush');
    } finally {
      webPushRefreshUi();
    }
  });

  disableBtn.addEventListener('click', async () => {
    try {
      await webPushUnsubscribe();
    } catch (err) {
      showToast?.(err.message || 'Ошибка WebPush') || alert(err.message || 'Ошибка WebPush');
    } finally {
      webPushRefreshUi();
    }
  });

  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      const match = window.location.pathname.match(/\/profile\/([^\/]+)/);
      const targetUserId = match ? match[1] : null;
      if (!targetUserId) {
        showToast?.('Не удалось определить ID пользователя') || alert('Не удалось определить ID пользователя');
        return;
      }
      try {
        const res = await apiFetch('/api/push/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetUserId })
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload.error || 'Ошибка отправки теста');
        }
        // WebPush отправлен — не показываем alert/toast
      } catch (err) {
        showToast?.(err.message || 'Ошибка WebPush') || alert(err.message || 'Ошибка WebPush');
      }
    });
  }

  webPushRefreshUi();
}
