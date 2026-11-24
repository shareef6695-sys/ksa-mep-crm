import React, { useRef, useState } from 'react';
import { Upload, Trash2, Image as ImageIcon } from 'lucide-react';

export function CompanyLogoUploader({ logoUrl, onChange }) {
  const fileInputRef = useRef(null);
  const [processing, setProcessing] = useState(false);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    // same limits as the database (0022): PNG / JPEG / WebP / SVG, at most 1 MB
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.type)) {
      window.alert('Choose a PNG, JPEG, WebP or SVG image.');
      return;
    }
    if (file.size > 1024 * 1024) {
      window.alert('The logo must be 1 MB or smaller.');
      return;
    }
    setProcessing(true);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result;
      if (!dataUrl || typeof dataUrl !== 'string') {
        setProcessing(false);
        return;
      }

      // Preserve SVG directly; resize raster images cleanly to max height 180px for crisp A4 print
      if (file.type === 'image/svg+xml') {
        onChange(dataUrl);
        setProcessing(false);
        return;
      }

      const img = new window.Image();
      img.onload = () => {
        const maxH = 180;
        const scale = img.height > maxH ? maxH / img.height : 1;
        const targetW = Math.round(img.width * scale);
        const targetH = Math.round(img.height * scale);

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, targetW, targetH);

        const optimized = canvas.toDataURL('image/png');
        onChange(optimized);
        setProcessing(false);
      };
      img.onerror = () => {
        window.alert('That file could not be read as an image.');
        setProcessing(false);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50/70 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
            <ImageIcon className="w-4 h-4 text-blue-600" />
            <span>Company Official Logo (A4 Letterhead &amp; ZATCA Invoices)</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Upload a transparent PNG, SVG, or JPG logo. Automatically prints on all Invoices, Credit Notes, Purchase Orders, VAT Returns &amp; Financial Statements.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="w-40 h-20 rounded-xl border border-dashed border-slate-300 bg-white flex items-center justify-center p-2 overflow-hidden">
          {logoUrl ? (
            <img src={logoUrl} alt="Company Logo" className="max-h-16 max-w-full object-contain" />
          ) : (
            <span className="text-[11px] text-slate-400 text-center">No Logo Uploaded</span>
          )}
        </div>

        <div className="flex flex-col gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={processing}
              className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{processing ? 'Optimizing...' : logoUrl ? 'Replace Logo' : 'Upload Logo'}</span>
            </button>

            {logoUrl && (
              <button
                type="button"
                onClick={() => onChange('')}
                className="px-3 py-2 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold inline-flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Remove</span>
              </button>
            )}
          </div>

          <input
            type="text"
            placeholder="Or paste direct HTTPS Logo URL..."
            value={logoUrl && !logoUrl.startsWith('data:') ? logoUrl : ''}
            onChange={(e) => onChange(e.target.value)}
            className="w-64 sm:w-80 border border-slate-300 rounded-xl px-3 py-1.5 bg-white text-xs"
          />
        </div>
      </div>
    </div>
  );
}