'use client';

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function ImageZoom({ children }: { children: ReactNode }) {
  const [image, setImage] = useState<{ source: string; alt: string }>();
  const [originalSize, setOriginalSize] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!image || !dialog.current) return;
    const modal = dialog.current;
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    modal.showModal();
    return () => {
      modal.close();
      document.body.style.overflow = overflow;
      if (focused?.isConnected) focused.focus({ preventScroll: true });
    };
  }, [image]);

  function clickedImage(event: MouseEvent) {
    const target = event.target;
    return target instanceof HTMLImageElement && !target.closest('dialog') ? target : undefined;
  }

  function keepImageVisible(event: MouseEvent) {
    if (!clickedImage(event)) return;
    // Keep CodeMirror from switching the image to source text on the first click.
    event.preventDefault();
    event.stopPropagation();
  }

  function enlarge(event: MouseEvent) {
    const target = clickedImage(event);
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    setOriginalSize(false);
    setImage({ source: target.currentSrc || target.src, alt: target.alt || '日志图片' });
  }

  return <div className="wt-image-zoom-host" onMouseDownCapture={keepImageVisible} onClickCapture={keepImageVisible} onDoubleClickCapture={enlarge}>
    {children}
    {image && createPortal(<dialog ref={dialog} className="wt-image-lightbox" aria-label="放大查看日志图片" onCancel={() => setImage(undefined)} onClose={() => setImage(undefined)} onClick={(event) => {
      if (event.target === event.currentTarget) setImage(undefined);
    }}>
      <div className="wt-image-lightbox-panel">
        <div className="wt-image-lightbox-toolbar"><span>{image.alt}</span><div>
          <button type="button" onClick={() => setOriginalSize((value) => !value)}>{originalSize ? '适应窗口' : '原始尺寸'}</button>
          <button type="button" onClick={() => setImage(undefined)} aria-label="关闭图片预览">关闭 ×</button>
        </div></div>
        <div className={`wt-image-lightbox-viewport${originalSize ? ' is-original' : ''}`}>
          <img src={image.source} alt={image.alt} draggable={false} onDoubleClick={() => setOriginalSize((value) => !value)} />
        </div>
        <p>双击图片切换尺寸 · Esc 或点击背景关闭</p>
      </div>
    </dialog>, document.body)}
  </div>;
}
