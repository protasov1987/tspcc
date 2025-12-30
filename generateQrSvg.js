const QRCode = require('qrcode');

function generateQrSvg(value, options = {}) {
  const text = value == null ? '' : String(value);
  const defaultOptions = {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 220
  };
  const opts = { ...defaultOptions, ...options, type: 'svg' };
  return QRCode.toString(text, opts);
}

module.exports = { generateQrSvg };
