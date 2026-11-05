import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon';
import { NotificationSwipe } from '../lib/notificationSwipe';
import type { AppNotification } from '../lib/backend/liveTypes';

interface Props {
  notification: AppNotification;
  icon: { icon: string; className: string };
  time: string;
  onOpen(): void;
  onDismiss(id: string): Promise<boolean>;
}

export default function NotificationItem({ notification: n, icon, time, onOpen, onDismiss }: Props) {
  const row = useRef<HTMLDivElement>(null);
  const captureTarget = useRef<HTMLElement | null>(null);
  const swipe = useRef(new NotificationSwipe());
  const suppressClickUntil = useRef(0);
  const busy = useRef(false);
  const [deleting, setDeleting] = useState(false);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [tracking, setTracking] = useState(false);

  const release = useCallback(() => {
    const id = swipe.current.pointerId;
    swipe.current.cancel();
    if (id !== undefined && captureTarget.current?.hasPointerCapture(id)) captureTarget.current.releasePointerCapture(id);
    captureTarget.current = null;
  }, []);
  const reset = useCallback(() => {
    release();
    setOffset(0);
    setDragging(false);
    setTracking(false);
  }, [release]);

  useEffect(() => {
    if (!tracking) return;
    window.addEventListener('blur', reset);
    return () => { window.removeEventListener('blur', reset); release(); };
  }, [tracking, reset, release]);

  const remove = async () => {
    if (busy.current) return;
    busy.current = true;
    setDeleting(true);
    try {
      if (!await onDismiss(n.id)) reset();
    } finally {
      busy.current = false;
      setDeleting(false);
    }
  };

  return <li data-notification-id={n.id}>
    <div className="relative overflow-hidden">
      <div aria-hidden="true" className={`pointer-events-none absolute inset-0 flex items-center bg-red-50 px-5 text-xs font-semibold text-red-700 ${offset < 0 ? 'justify-end' : 'justify-start'}`}>
        <span>Eliminar</span>
      </div>
      <div
        ref={row}
        data-testid="notification-item"
        aria-busy={deleting}
        className={`relative flex touch-pan-y select-none bg-white motion-reduce:transition-none ${dragging ? '' : 'transition-[transform,opacity] duration-200'} ${deleting ? 'opacity-50' : ''}`}
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={(e) => {
          if (busy.current || !e.isPrimary || e.button !== 0) return;
          if ((e.target as Element).closest('button')) { suppressClickUntil.current = 0; return; }
          if (swipe.current.begin(e.pointerId, e.clientX, e.clientY, e.currentTarget.clientWidth)) {
            suppressClickUntil.current = 0;
            // Capture on the link so an ordinary tap still opens the notice.
            captureTarget.current = (e.target as Element).closest('a') ?? e.currentTarget;
            captureTarget.current.setPointerCapture(e.pointerId);
            setTracking(true);
          }
        }}
        onPointerMove={(e) => {
          const move = swipe.current.move(e.pointerId, e.clientX, e.clientY);
          if (!move) return;
          if (move.moved) suppressClickUntil.current = Date.now() + 500;
          if (move.horizontal) {
            setDragging(true);
            setOffset(move.offset);
          }
        }}
        onPointerUp={(e) => {
          swipe.current.move(e.pointerId, e.clientX, e.clientY);
          const result = swipe.current.end(e.pointerId);
          if (!result) return;
          if (result.moved) suppressClickUntil.current = Date.now() + 500;
          if (captureTarget.current?.hasPointerCapture(e.pointerId)) captureTarget.current.releasePointerCapture(e.pointerId);
          captureTarget.current = null;
          setDragging(false);
          setTracking(false);
          if (result.dismiss) void remove();
          else setOffset(0);
        }}
        onPointerCancel={(e) => { if (swipe.current.pointerId === e.pointerId) reset(); }}
        onLostPointerCapture={(e) => { if (swipe.current.pointerId === e.pointerId) reset(); }}
        onClickCapture={(e) => {
          if (busy.current || (e.detail > 0 && Date.now() < suppressClickUntil.current)) { e.preventDefault(); e.stopPropagation(); }
        }}
      >
        <Link to={n.link || '/'} onClick={onOpen} draggable={false}
          className={`flex min-w-0 flex-1 gap-3 px-4 py-3 text-left hover:bg-canvas ${n.read ? '' : 'bg-brand-50/60'}`}>
          <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${icon.className}`}>
            <i aria-hidden="true" className={`fas ${icon.icon} text-xs`} />
          </span>
          <span className="min-w-0">
            <span className="block break-words text-sm font-semibold text-ink">{n.title}</span>
            {n.body && <span className="block truncate text-xs text-ink/70">{n.body}</span>}
            <span className="block text-[11px] text-muted">{time}</span>
          </span>
        </Link>
        <button type="button" disabled={deleting} onClick={() => void remove()}
          aria-label={`Eliminar aviso: ${n.title}`} title="Eliminar aviso"
          className="my-auto mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink/60 hover:bg-red-50 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-brand-600 disabled:opacity-50">
          <Icon name="fa-xmark" />
        </button>
      </div>
    </div>
  </li>;
}
