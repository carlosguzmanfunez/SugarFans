import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { backend, PAID_WITH_PAYPAL, type LiveSlotsStatus } from '../lib/backend';
import { money, platformChanged } from '../lib/platform';
import { saveRefCode } from '../lib/rewardRules';
import { LIVE_HOLD_MINUTES, countdown, fill, viewerTime } from '../lib/liveSlots';
import { zonedDate } from '../lib/timeZones';
import CheckoutDialog from '../components/CheckoutDialog';
import SocialLoginButtons from '../components/SocialLoginButtons';
import { usePageMeta } from '../hooks/usePageMeta';

const HANDLE = /^@([A-Za-z0-9_]{3,30})$/;
// Visitors watching a live refresh every 10 s; the countdown ticks locally.
const REFRESH_MS = 10_000;

// fansreserve.com/@usuario/ahora: the link a creator says on a TikTok or Instagram
// live. Shows the slots they just opened, a countdown until they open, and lets a
// fan take the next free one and pay it on the spot (15 minutes to pay).
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
  const [taking, setTaking] = useState(false);
  const [paying, setPaying] = useState(false);
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
    const refresh = window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, REFRESH_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearInterval(refresh); window.clearInterval(tick); };
  }, [load, authLoading, user?.id]);

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

  const here = `${location.pathname}`;
  const signIn = () => navigate('/login', { state: { from: here } });

  const take = async () => {
    if (!user) return signIn();
    if (!drop) return;
    setTaking(true);
    setError('');
    const result = await backend.liveSlotsClaim(user, drop.id);
    setTaking(false);
    if (!result.ok) {
      setError(result.error || t('liveSlots.err.load'));
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

  const body = (() => {
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
    if (open && drop.left === 0 || drop.closed) {
      return (
        <div className="text-center" data-testid="live-slots-soldout">
          <p className="text-lg font-bold text-ink">{t('liveSlots.page.soldOut')}</p>
          <p className="mt-2 text-sm text-ink/70">{fill(t('liveSlots.page.soldOutHint'), { name })}</p>
          <Link to={`/creator/${status!.creatorId}`} className="mt-5 inline-flex h-11 items-center rounded-full border border-line px-6 text-sm font-semibold text-ink">{t('liveSlots.page.profile')}</Link>
        </div>
      );
    }
    return (
      <div className="text-center">
        {opensIn > 0 ? (
          <div data-testid="live-slots-countdown">
            <p className="text-sm font-semibold uppercase tracking-wide text-muted">{t('liveSlots.page.opensIn')}</p>
            <p className="mt-1 font-mono text-5xl font-bold tabular-nums text-ink" aria-live="off">{countdown(opensIn)}</p>
          </div>
        ) : (
          <p className="text-2xl font-bold text-ink" data-testid="live-slots-left" aria-live="polite">{fill(t('liveSlots.page.left'), { left: drop.left, slots: drop.slots })}</p>
        )}
        <p className="mt-2 text-3xl font-black text-ink">{money(drop.price)}</p>
        {isOwn ? (
          <p className="mt-5 rounded-xl bg-gray-50 px-4 py-3 text-sm text-ink/70">{t('liveSlots.page.own')}</p>
        ) : user ? (
          <button type="button" onClick={take} disabled={taking || opensIn > 0} className="btn-gold mt-5 h-14 w-full max-w-sm rounded-full text-base font-bold disabled:opacity-60" data-testid="live-slots-take">
            {taking ? t('liveSlots.page.taking') : `${t('liveSlots.page.take')} · ${money(drop.price)}`}
          </button>
        ) : (
          <div className="mx-auto mt-5 max-w-sm text-left" data-testid="live-slots-signin">
            <p className="mb-3 text-center text-sm font-semibold text-ink">{opensIn > 0 ? t('liveSlots.page.getReady') : t('liveSlots.page.signIn')}</p>
            <SocialLoginButtons role="fan" from={here} onError={setError} />
            <button type="button" onClick={signIn} className="mt-3 h-11 w-full rounded-full border border-line text-sm font-semibold text-ink">{t('liveSlots.page.emailLogin')}</button>
            <p className="mt-3 text-center text-xs text-muted">{t('liveSlots.page.newHere')}</p>
          </div>
        )}
      </div>
    );
  })();

  return (
    <div className="mx-auto max-w-lg px-4 py-8 sm:py-12" data-testid="live-slots-page">
      <div className="rounded-3xl bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-5 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-1 text-xs font-bold tracking-wider text-white">
            <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-white motion-reduce:animate-none"></span>{t('liveSlots.page.live')}
          </span>
          <h1 className="mt-3 text-2xl font-bold text-ink">{fill(t('liveSlots.page.title'), { name })}</h1>
          {drop && !drop.closed && (
            <p className="mt-1 text-sm text-ink/70">{fill(t('liveSlots.page.what'), { slots: drop.slots, minutes: drop.minutes, time: viewerTime(drop.firstStartAt, language) })}</p>
          )}
        </div>
        {error && <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" data-testid="live-slots-error">{error}</p>}
        {body}
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
  );
};

export default LiveSlots;
