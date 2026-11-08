import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import qrcode from 'qrcode-generator';
import type { User } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { backend, type LiveSlotsStatus, type VipBooking } from '../../lib/backend';
import { money } from '../../lib/platform';
import {
  LIVE_GAPS, LIVE_OPENS_IN, LIVE_SLOT_COUNTS, LIVE_SLOT_MINUTES, countdown, fill, firstCallAt, liveSlotsError, liveSlotsLink, slotStart, viewerTime,
} from '../../lib/liveSlots';

interface Props {
  user: User;
  bookings: VipBooking[];
  onChanged: () => void;
}

const chip = (on: boolean) =>
  `min-h-10 rounded-full border px-4 text-sm font-semibold transition ${on ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink/80 hover:border-ink/40'}`;

// Creator panel → Reserve → Cupos en vivo: open today's 1:1 slots during a live on
// another network, share the short link / QR, and see who is next.
const CreatorLiveSlots: React.FC<Props> = ({ user, bookings, onChanged }) => {
  const { t, language } = useLanguage();
  const [status, setStatus] = useState<LiveSlotsStatus | null>(null);
  const [slots, setSlots] = useState(5);
  const [minutes, setMinutes] = useState(15);
  const [price, setPrice] = useState('15');
  const [opensIn, setOpensIn] = useState(0);
  const [gap, setGap] = useState(15);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // Server clock minus this device's, so the countdown matches the server.
  const [skew, setSkew] = useState(0);
  const username = user.username ?? '';

  const load = React.useCallback(() => {
    if (!username) return;
    backend.liveSlotsStatus(username).then((s) => {
      setStatus(s);
      if (s) setSkew(Date.parse(s.now) - Date.now());
    }).catch(() => setError(t('liveSlots.err.load')));
  }, [username, t]);
  useEffect(() => {
    load();
    const every = window.setInterval(load, 15_000);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearInterval(every); window.clearInterval(tick); };
  }, [load]);

  const drop = status?.drop;
  const link = username ? liveSlotsLink(username) : '';
  const qr = useMemo(() => {
    if (!link) return '';
    const q = qrcode(0, 'M');
    q.addData(link);
    q.make();
    return q.createDataURL(6, 2);
  }, [link]);

  const input = { slots, minutes, price: Number(price.replace(',', '.')), opensIn, gap };
  const preview = (() => {
    const opens = new Date(now + opensIn * 60_000);
    const first = firstCallAt(opens, gap);
    const last = new Date(first.getTime() + slots * minutes * 60_000);
    return { from: viewerTime(first.toISOString(), language), to: viewerTime(last.toISOString(), language) };
  })();

  const open = async () => {
    const problem = liveSlotsError(input);
    if (problem) return setError(t(problem));
    setBusy(true);
    setError('');
    const result = await backend.liveSlotsOpen(user, input);
    setBusy(false);
    if (!result.ok) return setError(result.error || t('liveSlots.err.load'));
    load();
    onChanged();
  };

  const close = async () => {
    if (!drop || !window.confirm(t('liveSlots.closeSure'))) return;
    const result = await backend.liveSlotsClose(user, drop.id);
    if (!result.ok) return setError(result.error || t('liveSlots.err.load'));
    load();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  // Everyone who took a slot in the current drop, in call order (latest booking per slot).
  const order = drop
    ? [...bookings.filter((b) => b.details?.liveDropId === drop.id)]
        .sort((a, b) => (a.details?.liveSlot ?? 0) - (b.details?.liveSlot ?? 0) || b.createdAt.localeCompare(a.createdAt))
    : [];
  const stateOf = (b: VipBooking) =>
    b.status === 'confirmed' || b.status === 'completed' ? 'paid'
    : b.status === 'accepted' && (!b.paymentDueAt || new Date(b.paymentDueAt).getTime() > now) ? 'waiting'
    : b.status === 'cancelled' ? 'cancelled' : 'released';

  const opensLeft = drop ? Date.parse(drop.opensAt) - (now + skew) : 0;

  return (
    <div className="space-y-4" data-testid="live-slots-panel">
      <div className="rounded-2xl bg-white p-5 shadow-sm sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">
          <span className="mr-2 inline-flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold tracking-wider text-white">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-white"></span>{t('liveSlots.page.live')}
          </span>
          {t('liveSlots.tab')}
        </p>
        <h3 className="mt-2 text-lg font-bold text-ink">{t('liveSlots.panel.title')}</h3>
        <p className="mt-1 max-w-2xl text-sm text-ink/70">{t('liveSlots.panel.intro')}</p>
      </div>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {drop && !drop.closed && (
        <div className="rounded-2xl border-2 border-ink bg-white p-5 shadow-sm sm:p-6" data-testid="live-slots-active">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-ink">{t('liveSlots.active.title')}</h3>
              <p className="mt-1 text-sm text-ink/70">
                {fill(t('liveSlots.page.what'), { slots: drop.slots, minutes: drop.minutes, time: viewerTime(drop.firstStartAt, language) })} · {money(drop.price)}
              </p>
            </div>
            <p className="rounded-full bg-gray-100 px-3 py-1 text-sm font-semibold text-ink" data-testid="live-slots-left">
              {opensLeft > 0 ? fill(t('liveSlots.opensIn'), { time: countdown(opensLeft) }) : fill(t('liveSlots.left'), { left: drop.left, slots: drop.slots })}
            </p>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="min-w-0">
              <p className="break-all rounded-xl bg-gray-50 px-4 py-3 font-mono text-base font-semibold text-ink" data-testid="live-slots-link">{link.replace(/^https?:\/\//, '')}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={copy} className="h-10 rounded-full bg-ink px-4 text-sm font-semibold text-white">
                  <i aria-hidden="true" className={`fas ${copied ? 'fa-check' : 'fa-copy'} mr-1.5`}></i>{copied ? t('liveSlots.copied') : t('liveSlots.copy')}
                </button>
                <a href={qr} download={`cupos-${username}.gif`} className="inline-flex h-10 items-center rounded-full border border-line px-4 text-sm font-semibold text-ink">
                  <i aria-hidden="true" className="fas fa-qrcode mr-1.5"></i>{t('liveSlots.downloadQr')}
                </a>
                <button type="button" onClick={close} className="h-10 rounded-full border border-red-200 px-4 text-sm font-semibold text-red-700">{t('liveSlots.close')}</button>
              </div>
              <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">{t('liveSlots.active.say')}</p>
              <p className="mt-1 text-sm italic text-ink/80">{fill(t('liveSlots.active.script'), { slots: drop.slots, minutes: drop.minutes, user: username })}</p>
            </div>
            <figure className="mx-auto text-center">
              <img src={qr} alt={link} width={164} height={164} className="rounded-xl border border-line" data-testid="live-slots-qr" />
              <figcaption className="mt-1 max-w-[164px] text-xs text-muted">{t('liveSlots.qr')}</figcaption>
            </figure>
          </div>
        </div>
      )}

      {drop && (
        <div className="rounded-2xl bg-white p-5 shadow-sm sm:p-6" data-testid="live-slots-order">
          <h3 className="font-bold text-ink">{t('liveSlots.order')}{drop.closed && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-muted">{t('liveSlots.closed')}</span>}</h3>
          <ol className="mt-3 divide-y divide-line">
            {Array.from({ length: drop.slots }, (_, n) => {
              const b = order.find((x) => x.details?.liveSlot === n + 1 && stateOf(x) !== 'released' && stateOf(x) !== 'cancelled')
                ?? order.find((x) => x.details?.liveSlot === n + 1);
              const st = b ? stateOf(b) : null;
              return (
                <li key={n} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm" data-testid="live-slot-row">
                  <span className="font-semibold text-ink">#{n + 1} · {viewerTime(slotStart(drop, n).toISOString(), language)}</span>
                  <span className="flex-1 truncate text-ink/80">{b && st !== 'released' && st !== 'cancelled' ? b.fanName : '—'}</span>
                  {st && (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${st === 'paid' ? 'bg-emerald-50 text-emerald-700' : st === 'waiting' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-muted'}`}>
                      {t(`liveSlots.st.${st}`)}
                    </span>
                  )}
                  {b && st === 'paid' && <Link to={`/live/${b.id}`} className="text-xs font-semibold text-brand-700">{t('liveSlots.join')}</Link>}
                </li>
              );
            })}
          </ol>
          {order.length === 0 && <p className="mt-2 text-xs text-muted">{t('liveSlots.orderEmpty')}</p>}
        </div>
      )}

      {!user.isVerified ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{t('liveSlots.verifyFirst')}</p>
      ) : (
        <form className="space-y-5 rounded-2xl bg-white p-5 shadow-sm sm:p-6" onSubmit={(e) => { e.preventDefault(); open(); }} data-testid="live-slots-form">
          <fieldset>
            <legend className="text-sm font-semibold text-ink">{t('liveSlots.field.slots')}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {LIVE_SLOT_COUNTS.map((n) => <button key={n} type="button" aria-pressed={slots === n} onClick={() => setSlots(n)} className={chip(slots === n)}>{n}</button>)}
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-sm font-semibold text-ink">{t('liveSlots.field.minutes')}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {LIVE_SLOT_MINUTES.map((n) => <button key={n} type="button" aria-pressed={minutes === n} onClick={() => setMinutes(n)} className={chip(minutes === n)}>{n} min</button>)}
            </div>
          </fieldset>
          <label className="block">
            <span className="text-sm font-semibold text-ink">{t('liveSlots.field.price')}</span>
            <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className="mt-2 h-11 w-36 rounded-xl border border-line px-3 text-base" data-testid="live-slots-price" />
          </label>
          <fieldset>
            <legend className="text-sm font-semibold text-ink">{t('liveSlots.field.opens')}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {LIVE_OPENS_IN.map((n) => (
                <button key={n} type="button" aria-pressed={opensIn === n} onClick={() => setOpensIn(n)} className={chip(opensIn === n)}>
                  {n === 0 ? t('liveSlots.opens.now') : fill(t('liveSlots.opens.in'), { n })}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-sm font-semibold text-ink">{t('liveSlots.field.gap')}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {LIVE_GAPS.map((n) => <button key={n} type="button" aria-pressed={gap === n} onClick={() => setGap(n)} className={chip(gap === n)}>{fill(t('liveSlots.gap.after'), { n })}</button>)}
            </div>
          </fieldset>
          <p className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-ink/80" data-testid="live-slots-summary">
            {fill(t('liveSlots.summary'), { slots, minutes, from: preview.from, to: preview.to })}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy} className="btn-gold h-12 rounded-full px-7 text-sm font-bold disabled:opacity-60" data-testid="live-slots-open">
              {busy ? t('liveSlots.opening') : t('liveSlots.open')}
            </button>
            {drop && !drop.closed && <p className="text-xs text-muted">{t('liveSlots.replaceNote')}</p>}
          </div>
        </form>
      )}
    </div>
  );
};

export default CreatorLiveSlots;
