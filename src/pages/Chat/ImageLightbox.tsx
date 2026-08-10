import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

type ImageLightboxProps = {
  src: string;
  onClose: () => void;
};

export function ImageLightbox({ src, onClose }: ImageLightboxProps) {
  const { t } = useTranslation();
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
      if (event.key === 'Tab') {
        event.preventDefault();
        closeRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    closeRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, []);

  return createPortal(
    <div
      className="image-lightbox"
      data-testid="image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={t('chat.imagePreview')}
      onClick={onClose}
    >
      <button
        type="button"
        ref={closeRef}
        className="image-lightbox-close"
        data-testid="image-lightbox-close"
        title={t('chat.closeImagePreview')}
        aria-label={t('chat.closeImagePreview')}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
      >
        <X size={18} />
      </button>
      <img src={src} alt={t('chat.imagePreview')} onClick={(event) => event.stopPropagation()} />
    </div>,
    document.body,
  );
}
