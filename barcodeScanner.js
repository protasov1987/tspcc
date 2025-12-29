class BarcodeScanner {
  constructor(options) {
    this.input = options.input;
    this.triggerButton = options.triggerButton;
    this.modal = options.modal;
    this.video = options.video;
    this.closeButton = options.closeButton;
    this.statusEl = options.statusEl;
    this.hintEl = options.hintEl;
    this.toastContainer = document.getElementById('toast-container');
    this.onOpen = typeof options.onOpen === 'function' ? options.onOpen : () => {};
    this.onClose = typeof options.onClose === 'function' ? options.onClose : () => {};

    this.isOpen = false;
    this.stream = null;
    this.detectInterval = null;
    this.detectTimeout = null;
    this.usingBarcodeDetector = false;
    this.hasCameraSupport = false;
    this.canvas = null;
    this.canvasCtx = null;

    this.handleTrigger = this.handleTrigger.bind(this);
    this.handleClose = this.handleClose.bind(this);
    this.onOutsideClick = this.onOutsideClick.bind(this);
  }

  async init() {
    if (!this.triggerButton) return;

    this.hasCameraSupport = await this.checkCameraAvailability();

    this.triggerButton.addEventListener('click', this.handleTrigger);

    if (this.closeButton) {
      this.closeButton.addEventListener('click', this.handleClose);
    }

    if (this.modal) {
      this.modal.addEventListener('click', this.onOutsideClick);
    }

    if (!this.hasCameraSupport) {
      this.triggerButton.classList.add('camera-scan-btn--disabled');
      this.triggerButton.setAttribute('aria-label', 'Камера недоступна. Введите штрихкод вручную.');
      if (this.statusEl) {
        this.statusEl.textContent = 'Камера недоступна. Введите штрихкод вручную.';
      }
    }
  }

  async checkCameraAvailability() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices || !navigator.mediaDevices.getUserMedia) {
      return false;
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.some((device) => device.kind === 'videoinput');
    } catch (err) {
      console.error('Не удалось перечислить камеры', err);
      return false;
    }
  }

  async handleTrigger(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!this.hasCameraSupport) {
      this.showToast('Камера недоступна. Введите штрихкод вручную.');
      return;
    }
    if (!this.modal || !this.video) return;

    await this.openScanner();
  }

  async openScanner() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.setStatus('Запрос доступа к камере...');
    this.modal.classList.remove('hidden');
    this.onOpen();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      this.stream = stream;
      this.video.srcObject = stream;
      await this.video.play();

      this.startDetection();
    } catch (err) {
      console.error('Ошибка доступа к камере', err);
      this.showToast('Не удалось получить доступ к камере. Разрешите доступ или введите код вручную.');
      this.closeScanner();
    }
  }

  async startDetection() {
    const supportsBarcodeDetector = typeof BarcodeDetector !== 'undefined';
    if (supportsBarcodeDetector) {
      try {
        this.detector = new BarcodeDetector({ formats: ['qr_code'] });
        this.usingBarcodeDetector = true;
        this.runBarcodeDetector();
        return;
      } catch (err) {
        console.warn('Не удалось инициализировать BarcodeDetector', err);
      }
    }

    this.usingBarcodeDetector = false;
    await this.startJsQrFallback();
  }

  runBarcodeDetector() {
    if (!this.detector) return;
    this.setStatus('Сканирование...');
    this.detectInterval = setInterval(async () => {
      try {
        const barcodes = await this.detector.detect(this.video);
        const first = barcodes && barcodes[0];
        if (first && first.rawValue) {
          this.handleDetected(first.rawValue);
        }
      } catch (err) {
        console.error('Ошибка сканирования', err);
      }
    }, 180);

    this.detectTimeout = setTimeout(() => {
      this.setStatus('Не удаётся распознать штрихкод. Попробуйте поднести ближе или введите код вручную.');
    }, 20000);
  }

  async ensureJsQr() {
    if (window.jsQR) return true;
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/jsqr/dist/jsQR.js';
      script.async = true;
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
    });
  }

  async startJsQrFallback() {
    this.setStatus('Сканирование (fallback)...');
    const loaded = await this.ensureJsQr();
    if (!loaded || !window.jsQR) {
      this.setStatus('Сканер не поддерживается в этом браузере. Введите код вручную.');
      return;
    }

    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvasCtx = this.canvas.getContext('2d');
    }

    this.setStatus('Сканирование...');
    this.detectInterval = setInterval(() => {
      if (!this.video || this.video.readyState < 2) return;
      const width = this.video.videoWidth || 0;
      const height = this.video.videoHeight || 0;
      if (!width || !height) return;
      if (!this.canvas || !this.canvasCtx) return;
      this.canvas.width = width;
      this.canvas.height = height;
      this.canvasCtx.drawImage(this.video, 0, 0, width, height);
      const imageData = this.canvasCtx.getImageData(0, 0, width, height);
      const code = window.jsQR(imageData.data, width, height);
      if (code && code.data) {
        this.handleDetected(code.data);
      }
    }, 200);

    this.detectTimeout = setTimeout(() => {
      this.setStatus('Не удаётся распознать штрихкод. Попробуйте поднести ближе или введите код вручную.');
    }, 20000);
  }

  handleDetected(rawCode) {
    if (!this.isOpen) return;
    const code = (rawCode || '').trim();
    if (!code) return;
    this.applyCode(code);
    this.showToast(`Штрихкод считан: ${code}`);
    this.closeScanner();
  }

  applyCode(code) {
    if (!this.input) return;
    this.input.value = code;
    const inputEvent = new Event('input', { bubbles: true });
    const changeEvent = new Event('change', { bubbles: true });
    this.input.dispatchEvent(inputEvent);
    this.input.dispatchEvent(changeEvent);
  }

  setStatus(message) {
    if (this.statusEl) {
      this.statusEl.textContent = message || '';
    }
  }

  showToast(message) {
    if (!this.toastContainer) {
      alert(message);
      return;
    }
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    this.toastContainer.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast--visible'));
    setTimeout(() => {
      toast.classList.remove('toast--visible');
      setTimeout(() => toast.remove(), 250);
    }, 3000);
  }

  onOutsideClick(event) {
    if (!this.modal) return;
    const clickedBackdrop = event.target === this.modal || event.target.classList.contains('barcode-scanner-modal__backdrop');
    if (clickedBackdrop) {
      this.handleClose();
    }
  }

  handleClose() {
    this.closeScanner();
  }

  stopStream() {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
    }
  }

  clearTimers() {
    if (this.detectInterval) {
      clearInterval(this.detectInterval);
      this.detectInterval = null;
    }
    if (this.detectTimeout) {
      clearTimeout(this.detectTimeout);
      this.detectTimeout = null;
    }
  }

  closeScanner() {
    if (!this.isOpen) return;
    this.clearTimers();
    this.stopStream();
    if (this.modal) {
      this.modal.classList.add('hidden');
    }
    this.canvas = null;
    this.canvasCtx = null;
    this.isOpen = false;
    this.onClose();
  }
}

window.BarcodeScanner = BarcodeScanner;
