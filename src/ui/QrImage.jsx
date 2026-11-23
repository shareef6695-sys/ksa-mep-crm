import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

// Renders a QR code in the browser. Replaces api.qrserver.com, which received every invoice's
// seller name, VAT number, total and VAT (the TLV payload) from the customer's browser.
export function QrImage({ value, size = 120, className = '', alt = 'QR code' }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let alive = true;
    if (!value) {
      setSrc('');
      return undefined;
    }
    QRCode.toDataURL(String(value), { errorCorrectionLevel: 'M', margin: 1, width: size * 2 })
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setSrc(''));
    return () => {
      alive = false;
    };
  }, [value, size]);
  if (!src) return <div className={`${className} bg-slate-100`} style={{ width: size, height: size }} aria-label={alt} />;
  return <img src={src} alt={alt} width={size} height={size} className={className} />;
}
