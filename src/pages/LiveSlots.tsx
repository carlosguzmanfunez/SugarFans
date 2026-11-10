import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { backend, PAID_WITH_PAYPAL, type LiveSlot, type LiveSlotsStatus } from '../lib/backend';
import { money, platformChanged } from '../lib/platform';
import { saveRefCode } from '../lib/rewardRules';
import { AUTO_ENTER_SECONDS, LIVE_HOLD_MINUTES, countdown, fill, roomOpen, viewerTime } from '../lib/liveSlots';
import { zonedDate } from '../lib/timeZones';
import { clearReturn, rememberReturn } from '../lib/returnTo';
import CheckoutDialog from '../components/CheckoutDialog';
import SocialLoginButtons from '../components/SocialLoginButtons';
import { usePageMeta } from '../hooks/usePageMeta';

const HANDLE = /^@([A-Za-z0-9_]{3,30})$/;
// The database tells the page about each change at once (liveSlotsWatch). The page
// also asks on its own: every 5 s without that channel, every 20 s with it (a hold
// that runs out of time frees its slot without any change being announced).
const REFRESH_MS = 5_000;
const REFRESH_LIVE_MS = 20_000;

// The board: every slot with its time and a box to tick. Only free slots can be
// ticked; the rest say why (someone is paying it, it is paid, its time passed).
const SlotBoard: React.FC<{
  slots: LiveSlot[];
  picked: number | null;
  mineSlot?: number;
  readOnly: boolean;
  onPick: (n: number) => void;
}> = ({ slots, picked, mineSlot, readOnly, onPick }) => {
  const { t, language } = useLanguage();
  return (
    <div role="radiogroup" aria-label={t('liveSlots.board.title')} className={`grid gap-2 text-left ${slots.length > 4 ? 'grid-cols-2' : ''}`} data-testid="live-slots-board">
      {slots.map((slot) => {
        const mine = slot.n === mineSlot;
        const free = slot.state === 'free' && !mine;
        const on = picked === slot.n && free;
        const label = mine ? t('liveSlots.board.mine') : t(`liveSlots.board.${slot.state}`);
        const tone = mine ? 'border-emerald-300 bg-emerald-50' : on ? 'border-amber-400 bg-amber-50 ring-2 ring-amber-300' : free ? 'border-line bg-white hover:border-ink/40' : 'border-line bg-gray-50';
        const box = mine ? 'border-emerald-500 bg-emerald-500 text-white' : on ? 'border-amber-500 bg-amber-400 text-ink' : free ? 'border-ink/40 bg-white' : slot.state === 'held' ? 'border-amber-300 bg-amber-100 text-amber-700' : 'border-gray-300 bg-gray-200 text-gray-500';
        const icon = mine || on ? 'fa-check' : slot.state === 'held' ? 'fa-hourglass-half' : slot.state === 'free' ? '' : 'fa-xmark';
        return (
          <button key={slot.n} type="button" role="radio" aria-checked={on} disabled={!free || readOnly} onClick={() => onPick(slot.n)}
            data-testid={`live-slot-${slot.n}`} data-state={mine ? 'mine' : slot.state}
            className={`flex min-h-[56px] items-center gap-3 rounded-2xl border px-3 py-2 text-left transition-colors disabled:cursor-default ${tone}`}>
            <span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 text-xs ${box}`}>{icon && <i className={`fas ${icon}`}></i>}</span>
            <span className="min-w-0">
              <span className={`block text-base font-bold tabular-nums ${free || mine ? 'text-ink' : 'text-ink/45 line-through'}`}>{viewerTime(slot.start, language)}</span>
              <span className={`block text-xs font-semibold ${mine ? 'text-emerald-700' : free ? 'text-emerald-700' : slot.state === 'held' ? 'text-amber-700' : 'text-ink/50'}`}>{label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
};

// fansreserve.com/@usuario/ahora: the link a creator says on a TikTok or Instagram
// live. Shows every slot they just opened with its time, a countdown until they
// open, and lets a fan tick one and pay it on the spot (15 minutes to pay).
const LiveSlots: React.FC = () => {
  const { handle: raw = '' } = useParams();
  const username = HANDLE.exec(raw)?.[1]?.toLowerCase() ?? '';
  const { user, loading: authLoading } = useAuth();
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const [status, setStatus] = useState<LiveSlotsStatus | null | undefined>(undefined);
  const [skew, setSkew] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState('');
  // Why a slot could not be reserved. Stays until the fan acts again (loading clears `error`).
  const [claimError, setClaimError] = useState('');
  const [picked, setPicked] = useState<number | null>(null);
  const [live, setLive] = useState(false);
  const [taking, setTaking] = useState(false);
  const [paying, setPaying] = useState(false);
  const [enterDeadline, setEnterDeadline] = useState<number | null>(null);
  usePageMeta({ title: status?.creatorName ? fill(t('liveSlots.page.title'), { name: status.creatorName }) : t('liveSlots.tab'), description: t('liveSlots.page.rules'), path: `/@${username}/ahora` }, !!status);

  const load = useCallback(() => {
    if (!username) return setStatus(null);
    backend.liveSlotsStatus(username)
      .then((s) => {
        setStatus(s);
        setError('');
        if (s) setSkew(Date.parse(s.now) - Date.now());
      })
      .catch(() => setError(t('liveSlots.err.load')));
  }, [username, t]);

  useEffect(() => {
    if (authLoading) return;
    load();
    const refresh = window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, live ? REFRESH_LIVE_MS : REFRESH_MS);
    return () => window.clearInterval(refresh);
  }, [load, authLoading, user?.id, live]);
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, []);
  // Changes announced by the database: ask again at once (several in a row count as one).
  const creatorId = status?.creatorId;
  useEffect(() => {
    if (!creatorId) return;
    let timer = 0;
    const stop = backend.liveSlotsWatch(creatorId, () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(load, 250);
    }, setLive);
    // Coming back to the tab: whatever happened meanwhile.
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearTimeout(timer); stop(); setLive(false); document.removeEventListener('visibilitychange', onVisible); };
  }, [creatorId, load]);

  // Like fansreserve.com/@usuario: the visitor counts as brought by this creator.
  useEffect(() => { if (status?.creatorId) saveRefCode(status.creatorId); }, [status?.creatorId]);

  const drop = status?.drop;
  const mine = status?.mine;
  const serverNow = now + skew;
  const opensIn = drop ? Date.parse(drop.opensAt) - serverNow : 0;
  // Reaching zero, ask the server at once instead of waiting for the next refresh.
  useEffect(() => {
    if (drop && opensIn <= 0 && opensIn > -1500) load();
  }, [drop, opensIn > 0, load]); // eslint-disable-line react-hooks/exhaustive-deps

  const board = drop?.board;
  const pickedSlot = board?.find((s) => s.n === picked && s.state === 'free');
  // The ticked slot was taken by someone else meanwhile: say so and untick it.
  useEffect(() => {
    if (picked !== null && board && !pickedSlot && !taking) {
      setPicked(null);
      if (!status?.mine) setClaimError(t('liveSlots.board.gone'));
    }
  }, [picked, board, pickedSlot, taking, status?.mine, t]);
  // A single free slot ("Llamada ya", or the last one left) comes ticked.
  const onlyFree = board && board.filter((s) => s.state === 'free').length === 1 ? board.find((s) => s.state === 'free')!.n : null;
  useEffect(() => {
    if (onlyFree !== null && picked === null && !claimError) setPicked(onlyFree);
  }, [onlyFree, picked, claimError]);

  const here = `${location.pathname}`;
  // Signing in from here comes back with ?pagar=1 (and the ticked slot) when the
  // slots are already on sale; then the slot is taken and PayPal opens without another tap.
  const back = drop && !drop.closed && opensIn <= 0 && (pickedSlot || !board) ? `${here}?pagar=1${pickedSlot ? `&cupo=${pickedSlot.n}` : ''}` : here;
  const signIn = () => {
    rememberReturn(back);
    navigate('/login', { state: { from: back } });
  };
  const query = new URLSearchParams(location.search);
  const wantsPay = query.get('pagar') === '1';
  const wantsSlot = /^\d{1,2}$/.test(query.get('cupo') ?? '') ? Number(query.get('cupo')) : undefined;

  const take = async (slot?: number) => {
    if (!user) return signIn();
    if (!drop) return;
    setTaking(true);
    setClaimError('');
    const result = await backend.liveSlotsClaim(user, drop.id, slot);
    setTaking(false);
    if (!result.ok) {
      // That slot went to someone else: the page's own words, in the fan's language.
      setClaimError(slot && /Recarga/.test(result.error ?? '') ? t('liveSlots.board.reload') : result.error || t('liveSlots.err.load'));
      setPicked(null);
      load();
      return;
    }
    await new Promise<void>((done) => {
      backend.liveSlotsStatus(username).then((s) => { setStatus(s); done(); }).catch(() => done());
    });
    setPaying(true);
  };

  const pay = async (methodId: string) => {
    if (!user || !mine) return { ok: false, error: t('liveSlots.err.load') };
    const result = methodId === PAID_WITH_PAYPAL ? { ok: true } : await backend.payBooking(user, mine.bookingId, methodId);
    if (result.ok) {
      setPaying(false);
      platformChanged();
      load();
    }
    return result;
  };

  // Back from the login: the visit already reached this page, so forget the stored return.
  useEffect(() => { if (user) clearReturn(); }, [user]);
  // Back from the login with ?pagar=1: take the slot (or reopen the payment of the
  // one already held) and open the checkout over the page.
  const autoPay = useRef(false);
  useEffect(() => {
    if (!wantsPay || autoPay.current || !user || !status || authLoading) return;
    const ownPage = !!user.creatorProfileId && user.creatorProfileId === status.creatorId;
    const onSale = !mine && !ownPage && !!drop && !drop.closed && opensIn <= 0 && drop.left > 0;
    if (mine?.status === 'accepted') { autoPay.current = true; setPaying(true); }
    else if (onSale && board && wantsSlot && board.find((s) => s.n === wantsSlot)?.state !== 'free') {
      // The slot they ticked before signing in is gone: they choose another one.
      autoPay.current = true;
      setClaimError(t('liveSlots.board.gone'));
    }
    else if (onSale && (wantsSlot || !board)) { autoPay.current = true; void take(board ? wantsSlot : undefined); }
    else if (mine || ownPage || !drop || drop.closed || drop.left <= 0 || (board && !wantsSlot)) autoPay.current = true;
    if (autoPay.current) navigate(here, { replace: true });
  }, [wantsPay, user, status, mine, drop, opensIn, authLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const paidLive = !!mine && mine.status === 'confirmed' && !!drop && roomOpen({ date: mine.date, time: mine.time, timeZone: drop.timeZone, durationMinutes: drop.minutes }, now + skew);
  useEffect(() => {
    if (paidLive && !enterDeadline) setEnterDeadline(Date.now() + AUTO_ENTER_SECONDS * 1000);
  }, [paidLive, enterDeadline]);
  useEffect(() => {
    if (enterDeadline && mine && now >= enterDeadline) navigate(`/live/${mine.bookingId}`);
  }, [enterDeadline, now, mine, navigate]);

  if (status === undefined && !error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-label={t('liveSlots.tab')}>
        <i aria-hidden="true" className="fas fa-spinner fa-spin text-2xl text-gray-400"></i>
      </div>
    );
  }
  if (status === null) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4 text-center">
        <div>
          <h1 className="mb-4 text-6xl font-bold text-gray-300">404</h1>
          <p className="mb-6 text-gray-600">{fill(t('liveSlots.page.notFound'), { user: username || raw })}</p>
          <Link to="/explore" className="rounded-xl bg-ink px-6 py-3 font-medium text-white">{t('nav.explore')}</Link>
        </div>
      </div>
    );
  }

  const name = status?.creatorName ?? '';
  const isOwn = !!user?.creatorProfileId && user.creatorProfileId === status?.creatorId;
  const open = drop && !drop.closed && opensIn <= 0;
  const mineTime = mine ? viewerTime(zonedDate(mine.date, mine.time, drop?.timeZone).toISOString(), language) : '';
  const payLeft = mine?.paymentDueAt ? Math.min(Date.parse(mine.paymentDueAt) - serverNow, LIVE_HOLD_MINUTES * 60_000) : 0;

  // Paid and the call room is already open ("Llamada ya"): go in after 10 seconds.
  const roomIsOpen = !!mine && mine.status === 'confirmed' && !!drop && roomOpen({ date: mine.date, time: mine.time, timeZone: drop.timeZone, durationMinutes: drop.minutes }, serverNow);
  const enterAt = roomIsOpen ? enterDeadline : null;

  const body = (() => {
    if (mine && mine.status === 'confirmed' && enterAt) {
      return (
        <div className="text-center" data-testid="live-slots-entering">
          <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><i aria-hidden="true" className="fas fa-video text-xl"></i></span>
          <p className="text-lg font-bold text-ink">{fill(t('liveSlots.now.fanReady'), { name })}</p>
          <p className="mt-1 text-sm text-ink/70">{fill(t('liveSlots.now.entering'), { s: Math.min(AUTO_ENTER_SECONDS, Math.max(0, Math.ceil((enterAt - now) / 1000))) })}</p>
          <Link to={`/live/${mine.bookingId}`} className="btn-gold mt-5 inline-flex h-14 w-full max-w-sm items-center justify-center rounded-full text-base font-bold">{t('liveSlots.now.enter')}</Link>
        </div>
      );
    }
    if (mine && (mine.status === 'confirmed' || mine.status === 'completed')) {
      return (
        <div className="text-center" data-testid="live-slots-paid">
          <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><i aria-hidden="true" className="fas fa-check text-xl"></i></span>
          <p className="text-lg font-bold text-ink">{fill(t('liveSlots.page.paid'), { name, time: mineTime })}</p>
          <p className="mt-2 text-sm text-ink/70">{t('liveSlots.page.paidHow')}</p>
          <Link to="/profile#mis-reservas" className="mt-5 inline-flex h-12 items-center rounded-full bg-ink px-6 text-sm font-semibold text-white">{t('liveSlots.page.myBookings')}</Link>
        </div>
      );
    }
    if (mine && mine.status === 'accepted' && payLeft > 0) {
      return (
        <div className="text-center" data-testid="live-slots-held">
          <p className="text-lg font-bold text-ink">{fill(t('liveSlots.page.held'), { slot: mine.slot })}</p>
          <p className="mt-1 text-sm text-ink/70">{fill(t('liveSlots.page.payNote'), { time: mineTime, minutes: drop?.minutes ?? '' })} · {money(mine.price)}</p>
          <p className="mt-3 text-sm font-semibold text-amber-700">{fill(t('liveSlots.page.payWithin'), { time: countdown(payLeft) })}</p>
          <button type="button" onClick={() => setPaying(true)} className="btn-gold mt-5 h-14 w-full max-w-sm rounded-full text-base font-bold" data-testid="live-slots-pay">
            {t('liveSlots.page.pay')} · {money(mine.price)}
          </button>
        </div>
      );
    }
    if (!drop || drop.closed && drop.left > 0 && !mine) {
      return (
        <div className="text-center" data-testid="live-slots-none">
          <p className="text-lg font-bold text-ink">{fill(t('liveSlots.page.none'), { name })}</p>
          <p className="mt-2 text-sm text-ink/70">{t('liveSlots.page.noneHint')}</p>
          <Link to={`/creator/${status!.creatorId}`} className="mt-5 inline-flex h-11 items-center rounded-full border border-line px-6 text-sm font-semibold text-ink">{t('liveSlots.page.profile')}</Link>
        </div>
      );
    }
    if (drop.closed || open && drop.left === 0 && !board) {
      return (
        <div className="text-center" data-testid="live-slots-soldout">
          <p className="text-lg font-bold text-ink">{t('liveSlots.page.soldOut')}</p>
          <p className="mt-2 text-sm text-ink/70">{fill(t('liveSlots.page.soldOutHint'), { name })}</p>
          <Link to={`/creator/${status!.creatorId}`} className="mt-5 inline-flex h-11 items-center rounded-full border border-line px-6 text-sm font-semibold text-ink">{t('liveSlots.page.profile')}</Link>
        </div>
      );
    }
    const soldOut = open && drop.left === 0;
    const pickedTime = pickedSlot ? viewerTime(pickedSlot.start, language) : '';
    return (
      <div className="text-center">
        {opensIn > 0 ? (
          <div data-testid="live-slots-countdown">
            <p className="text-sm font-semibold uppercase tracking-wide text-muted">{t('liveSlots.page.opensIn')}</p>
            <p className="mt-1 font-mono text-5xl font-bold tabular-nums text-ink" aria-live="off">{countdown(opensIn)}</p>
          </div>
        ) : soldOut ? (
          <div data-testid="live-slots-soldout">
            <p className="text-lg font-bold text-ink">{t('liveSlots.page.soldOut')}</p>
            <p className="mt-1 text-sm text-ink/70">{t('liveSlots.board.soldOutHint')}</p>
          </div>
        ) : (
          <p className="text-2xl font-bold text-ink" data-testid="live-slots-left" aria-live="polite">{fill(t('liveSlots.page.left'), { left: drop.left, slots: drop.slots })}</p>
        )}
        <p className="mt-2 text-3xl font-black text-ink">{money(drop.price)}</p>
        {board && !soldOut && !isOwn && <p className="mt-4 text-sm font-semibold text-ink">{t('liveSlots.board.title')}</p>}
        {board && <div className="mt-3"><SlotBoard slots={board} picked={picked} readOnly={isOwn || taking} onPick={(n) => { setPicked(n); setClaimError(''); }} /></div>}
        {isOwn ? (
          <p className="mt-5 rounded-xl bg-gray-50 px-4 py-3 text-sm text-ink/70">{t('liveSlots.page.own')}</p>
        ) : soldOut ? null : user ? (
          <button type="button" onClick={() => take(board ? pickedSlot?.n : undefined)} disabled={taking || opensIn > 0 || (!!board && !pickedSlot)}
            className="btn-gold mt-5 h-14 w-full max-w-sm rounded-full text-base font-bold disabled:opacity-60" data-testid="live-slots-take">
            {taking ? t('liveSlots.page.taking')
              : !board ? `${t('liveSlots.page.take')} · ${money(drop.price)}`
              : pickedSlot ? `${fill(t('liveSlots.board.reserve'), { time: pickedTime })} · ${money(drop.price)}`
              : t('liveSlots.board.pick')}
          </button>
        ) : (
          <div className="mx-auto mt-5 max-w-sm text-left" data-testid="live-slots-signin">
            <p className="mb-3 text-center text-sm font-semibold text-ink">
              {opensIn > 0 ? t('liveSlots.page.getReady') : pickedSlot ? fill(t('liveSlots.board.signIn'), { time: pickedTime }) : t('liveSlots.page.signIn')}
            </p>
            <SocialLoginButtons role="fan" from={back} onError={(m) => { setError(m); if (!m) rememberReturn(back); }} />
            <button type="button" onClick={signIn} className="mt-3 h-11 w-full rounded-full border border-line text-sm font-semibold text-ink">{t('liveSlots.page.emailLogin')}</button>
            <p className="mt-3 text-center text-xs text-muted">{t('liveSlots.page.newHere')}</p>
          </div>
        )}
      </div>
    );
  })();

  // With a slot of their own, the board below shows it among the others.
  const boardBelow = !!mine && !!board && !drop?.closed;

  return (
    // Dark "stage" with a red spotlight behind the card: the visitor comes from a live.
    <div className="live-stage" data-testid="live-slots-page">
    <div className="relative mx-auto max-w-lg px-4 py-8 sm:py-12">
      <div className="live-stage-card rounded-3xl bg-white p-6 sm:p-8">
        <div className="mb-5 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-1 text-xs font-bold tracking-wider text-white">
            <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-white motion-reduce:animate-none"></span>{t('liveSlots.page.live')}
          </span>
          <h1 className="mt-3 text-2xl font-bold text-ink">{fill(t('liveSlots.page.title'), { name })}</h1>
          {drop && !drop.closed && (
            <p className="mt-1 text-sm text-ink/70">{fill(t(drop.slots === 1 ? 'liveSlots.page.whatOne' : 'liveSlots.page.what'), { slots: drop.slots, minutes: drop.minutes, time: viewerTime(drop.firstStartAt, language) })}</p>
          )}
        </div>
        {error && <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" data-testid="live-slots-error">{error}</p>}
        {claimError && !mine && (
          <div role="alert" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="live-slots-gone">
            <p>{claimError}</p>
            <button type="button" onClick={() => { setClaimError(''); load(); }} className="mt-2 inline-flex h-9 items-center gap-2 rounded-full bg-ink px-4 text-xs font-bold text-white">
              <i aria-hidden="true" className="fas fa-rotate-right"></i>{t('liveSlots.board.reloadBtn')}
            </button>
          </div>
        )}
        {body}
        {boardBelow && <div className="mt-5"><SlotBoard slots={board!} picked={null} mineSlot={mine!.slot} readOnly onPick={() => undefined} /></div>}
        {board && drop && !drop.closed && (
          <p className="mt-4 text-center text-xs text-muted" data-testid="live-slots-hint">
            {live && <span className="mr-2 inline-flex items-center gap-1 font-semibold text-emerald-700"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>{t('liveSlots.board.auto')}</span>}
            {t('liveSlots.board.hint')}
          </p>
        )}
        <p className="mt-6 border-t border-line pt-4 text-center text-xs text-muted">{t('liveSlots.page.rules')}</p>
      </div>
      {paying && user && mine && (
        <CheckoutDialog
          user={user}
          title={fill(t('liveSlots.page.payTitle'), { slot: mine.slot, name })}
          amount={mine.price}
          note={fill(t('liveSlots.page.payNote'), { time: mineTime, minutes: drop?.minutes ?? '' })}
          confirmLabel={t('liveSlots.page.pay')}
          paypal={{ kind: 'booking', params: { bookingId: mine.bookingId } }}
          onConfirm={pay}
          onClose={() => { setPaying(false); load(); }}
        />
      )}
    </div>
    </div>
  );
};

export default LiveSlots;
