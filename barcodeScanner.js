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

    this.isOpen = false;
    this.stream = null;
    this.detectInterval = null;
    this.detectTimeout = null;
    this.usingBarcodeDetector = false;
    this.hasCameraSupport = false;
    this.quaggaHandler = null;

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
        this.detector = new BarcodeDetector({ formats: ['ean_13'] });
        this.usingBarcodeDetector = true;
        this.runBarcodeDetector();
        return;
      } catch (err) {
        console.warn('Не удалось инициализировать BarcodeDetector', err);
      }
    }

    this.usingBarcodeDetector = false;
    await this.startQuaggaFallback();
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

  async ensureQuagga() {
    if (window.Quagga) return true;
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@ericblade/quagga2/dist/quagga.min.js';
      script.async = true;
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
    });
  }

  async startQuaggaFallback() {
    this.setStatus('Сканирование (fallback)...');
    const loaded = await this.ensureQuagga();
    if (!loaded || !window.Quagga) {
      this.setStatus('Сканер не поддерживается в этом браузере. Введите код вручную.');
      return;
    }

    const config = {
      inputStream: {
        name: 'Live',
        type: 'LiveStream',
        target: this.video,
        constraints: { facingMode: 'environment' },
      },
      decoder: {
        readers: ['ean_reader'],
      },
      locate: true,
    };

    return new Promise((resolve) => {
      window.Quagga.init(config, (err) => {
        if (err) {
          console.error('Ошибка Quagga', err);
          this.setStatus('Не удалось запустить сканер. Введите код вручную.');
          resolve(false);
          return;
        }
        window.Quagga.start();
        this.setStatus('Сканирование...');
        this.quaggaHandler = (result) => {
          if (!result || !result.codeResult || !result.codeResult.code) return;
          this.handleDetected(result.codeResult.code);
        };
        window.Quagga.onDetected(this.quaggaHandler);
        this.detectTimeout = setTimeout(() => {
          this.setStatus('Не удаётся распознать штрихкод. Попробуйте поднести ближе или введите код вручную.');
        }, 20000);
        resolve(true);
      });
    });
  }

  handleDetected(rawCode) {
    if (!this.isOpen) return;
    const code = (rawCode || '').trim();
    if (!this.validateEAN13(code)) return;

    this.applyCode(code);
    this.showToast(`EAN-13 считан: ${code}`);
    this.closeScanner();
  }

  validateEAN13(code) {
    if (!/^\d{13}$/.test(code)) return false;
    let sum = 0;
    for (let i = 0; i < 12; i += 1) {
      const digit = parseInt(code.charAt(i), 10);
      sum += i % 2 === 0 ? digit : digit * 3;
    }
    const check = (10 - (sum % 10)) % 10;
    return check === parseInt(code.charAt(12), 10);
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
    if (this.usingBarcodeDetector && this.video) {
      this.video.srcObject = null;
    }
    if (window.Quagga) {
      try {
        window.Quagga.stop();
        if (this.quaggaHandler) {
          window.Quagga.offDetected(this.quaggaHandler);
        }
      } catch (err) {
        console.warn('Не удалось остановить Quagga', err);
      }
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
    this.clearTimers();
    this.stopStream();
    if (this.modal) {
      this.modal.classList.add('hidden');
    }
    this.quaggaHandler = null;
    this.isOpen = false;
  }
}

window.BarcodeScanner = BarcodeScanner;
