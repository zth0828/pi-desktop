import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Download, X, ZoomIn, ZoomOut } from 'lucide-react';
import { hostApi } from '../../lib/host-api';
import { getImageSaveFilters, resolveImageData, suggestFileName } from '../../lib/image-preview';

type ImageLightboxProps = {
  src: string;
  name?: string;
  onClose: () => void;
};

export function ImageLightbox({ src, name, onClose }: ImageLightboxProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [zoom, setZoom] = useState(1);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copying, setCopying] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key === 'Tab') {
        const container = containerRef.current;
        if (!container) return;
        const focusable = Array.from(
          container.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => el.offsetParent !== null || el === document.activeElement);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey) {
          if (document.activeElement === first || !container.contains(document.activeElement)) {
            event.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last || !container.contains(document.activeElement)) {
            event.preventDefault();
            first.focus();
          }
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    closeRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, []);

  const handleCopy = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (copying) return;
    setCopying(true);
    try {
      const { data, mimeType } = await resolveImageData(src);
      const res = await hostApi.app.writeClipboardImage({ data, mimeType });
      if (res.success) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // ignore
    } finally {
      setCopying(false);
    }
  };

  const handleSave = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (saving) return;
    setSaving(true);
    try {
      const { data, mimeType } = await resolveImageData(src);
      const defaultPath = suggestFileName(name, mimeType);
      const filters = getImageSaveFilters(mimeType);
      const dialogRes = await hostApi.dialog.saveFile({
        title: t('chat.imageSave'),
        defaultPath,
        filters,
      });
      if (!dialogRes.canceled && dialogRes.filePath) {
        const writeRes = await hostApi.app.writeBinaryFile({
          path: dialogRes.filePath,
          data,
        });
        if (writeRes.success) {
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        }
      }
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      ref={containerRef}
      className="image-lightbox"
      data-testid="image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={name || t('chat.imagePreview')}
      onClick={onClose}
    >
      <div className="image-lightbox-toolbar" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className="image-lightbox-btn"
          data-testid="image-lightbox-zoom-out"
          title={t('chat.zoomOut')}
          aria-label={t('chat.zoomOut')}
          disabled={zoom <= 0.25}
          onClick={() => setZoom((z) => Math.max(0.25, Math.round((z - 0.25) * 100) / 100))}
        >
          <ZoomOut size={16} />
        </button>
        <button
          type="button"
          className="image-lightbox-btn image-lightbox-zoom-fit"
          data-testid="image-lightbox-zoom-fit"
          title={t('chat.zoomReset')}
          aria-label={t('chat.zoomReset')}
          onClick={() => setZoom(1)}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          className="image-lightbox-btn"
          data-testid="image-lightbox-zoom-in"
          title={t('chat.zoomIn')}
          aria-label={t('chat.zoomIn')}
          disabled={zoom >= 4}
          onClick={() => setZoom((z) => Math.min(4, Math.round((z + 0.25) * 100) / 100))}
        >
          <ZoomIn size={16} />
        </button>
        <span className="toolbar-divider" />
        <button
          type="button"
          className="image-lightbox-btn"
          data-testid="image-lightbox-copy"
          title={copied ? t('chat.copied') : t('chat.imageCopy')}
          aria-label={copied ? t('chat.copied') : t('chat.imageCopy')}
          onClick={handleCopy}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </button>
        <button
          type="button"
          className="image-lightbox-btn"
          data-testid="image-lightbox-save"
          title={saved ? t('chat.imageSaveSuccess') : t('chat.imageSave')}
          aria-label={saved ? t('chat.imageSaveSuccess') : t('chat.imageSave')}
          onClick={handleSave}
        >
          {saved ? <Check size={16} /> : <Download size={16} />}
        </button>
        <span className="toolbar-divider" />
        <button
          type="button"
          ref={closeRef}
          className="image-lightbox-btn image-lightbox-close"
          data-testid="image-lightbox-close"
          title={t('chat.closeImagePreview')}
          aria-label={t('chat.closeImagePreview')}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
        >
          <X size={16} />
        </button>
      </div>
      <div className="image-lightbox-body" onClick={onClose}>
        <img
          src={src}
          alt={name || t('chat.imagePreview')}
          style={{ transform: `scale(${zoom})` }}
          onClick={(event) => event.stopPropagation()}
        />
      </div>
    </div>,
    document.body,
  );
}
