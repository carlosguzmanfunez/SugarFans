import React, { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { categories, posts as catalogPosts, type Creator } from '../../data/mockData';
import { backend } from '../../lib/backend';
import { socialApi } from '../../lib/social';
import { usePlatformQuery, platformApi, isCutOff } from '../../lib/platform';
import { useBackendData } from '../../lib/useBackendData';
import { onNewNotification } from '../../lib/live';
import { isActiveSubscription } from '../../lib/liveAccess';
import { reserveStatusOf, liveWindow, type VipBooking } from '../../lib/vip';
import { RESERVE_STATUSES } from '../../config/reserve';
import { zonedDate } from '../../lib/timeZones';
import { CategoryRail, LiveRail, ReserveRail, RailHeading } from '../AppRails';
import { CoverImage } from '../CoverArt';
import Avatar from '../Avatar';
import LiveRoomButton from '../LiveRoomButton';
import Icon from '../Icon';

// What a signed-in fan opens the app to: their next Reserve, the creators they
// follow and what those creators posted. The product pitch stays on the visitor's page.

const firstName = (name: string) => name.trim().split(/\s+/)[0];
const ACTIVE: string[] = ['pending', 'countered', 'accepted', 'confirmed', 'reschedule_requested'];
const NEWS_LIMIT = 6;

interface NewsItem {
  id: string;
  creator: Creator;
  content: string;
  media?: string;
  isLocked: boolean;
  createdAt: string;
}

const whenLabel = (b: VipBooking) => {
  const at = zonedDate(b.date, b.time, b.timeZone);
  return at.toLocaleString('es', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).replace(/\./g, '');
};

const timeAgo = (iso: string) => {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days < 1) return 'Hoy';
  if (days === 1) return 'Ayer';
  if (days < 30) return `Hace ${days} días`;
  return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short' }).replace(/\./g, '');
};

const NextReserve: React.FC<{ booking: VipBooking; creator?: Creator; more: number }> = ({ booking, creator, more }) => {
  const status = RESERVE_STATUSES[reserveStatusOf(booking)];
  return (
    <section aria-labelledby="next-reserve-title" className="mb-8" data-testid="home-next-reserve">
      <RailHeading id="next-reserve-title" title="Tu próxima reserva" to="/profile#mis-reservas" />
      <div className="card flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Avatar src={creator?.avatar} name={booking.creatorName} size={52} decorative />
          <div className="min-w-0">
            <p className="truncate font-semibold text-ink">{booking.title}</p>
            <p className="truncate text-sm text-muted">con {booking.creatorName}</p>
            <p className="mt-0.5 text-sm text-ink/75 first-letter:uppercase">{whenLabel(booking)}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${status.className}`}>{status.label}</span>
          <LiveRoomButton booking={booking} />
        </div>
      </div>
      {more > 0 && (
        <Link to="/profile#mis-reservas" className="mt-2 inline-block text-sm text-muted hover:text-ink">
          y {more} {more === 1 ? 'reserva más' : 'reservas más'}
        </Link>
      )}
    </section>
  );
};

const NewsList: React.FC<{ items: NewsItem[] }> = ({ items }) => (
  <ul className="grid gap-3 md:grid-cols-2" data-testid="home-news">
    {items.map((n) => (
      <li key={n.id}>
        <Link to={`/creator/${n.creator.id}#post-${n.id}`} className="card card-hover flex gap-3 p-3">
          <div className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <Avatar src={n.creator.avatar} name={n.creator.name} size={28} decorative />
              <span className="truncate text-sm font-semibold text-ink">{n.creator.name}</span>
              <span className="shrink-0 text-xs text-muted">· {timeAgo(n.createdAt)}</span>
            </span>
            <p className="mt-2 line-clamp-3 text-sm text-ink/80">{n.content}</p>
          </div>
          {n.media && (
            <CoverImage
              src={n.media}
              seed={`post-${n.id}`}
              className="size-24 shrink-0 rounded-xl"
              imgClassName={n.isLocked ? 'scale-110 blur-md' : ''}
            >
              {n.isLocked && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/30 text-white">
                  <Icon name="fa-lock" />
                </span>
              )}
            </CoverImage>
          )}
        </Link>
      </li>
    ))}
  </ul>
);

const FanHome: React.FC<{ creators: Creator[] }> = ({ creators }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const userId = user?.id;

  const { data: bookings, reload } = useBackendData(() => (user ? backend.fanBookings(user.id) : Promise.resolve([])), [userId], [] as VipBooking[]);
  // A creator's answer moves the next Reserve at once.
  useEffect(() => (userId ? onNewNotification(userId, reload) : undefined), [userId, reload]);
  const { data: follows } = usePlatformQuery(() => (user ? socialApi.myFollows(user) : Promise.resolve([])), [userId], [] as string[]);
  const { data: platform } = usePlatformQuery(
    async () => {
      const [removedPosts, blocks] = await Promise.all([platformApi.removedPosts(), user ? platformApi.blocks(user) : Promise.resolve([])]);
      return { removedPosts, blocks };
    },
    [userId],
    { removedPosts: [] as string[], blocks: [] as Awaited<ReturnType<typeof platformApi.blocks>> }
  );

  const visible = creators.filter((c) => !user || !isCutOff(platform.blocks, user.id, c.id));
  const subscribedIds = new Set((user?.subscriptions ?? []).filter((s) => isActiveSubscription(s)).map((s) => s.creatorId));
  // Subscriptions first, then follows, in the order they appear in the catalogue.
  const mine = [
    ...visible.filter((c) => subscribedIds.has(c.id)),
    ...visible.filter((c) => !subscribedIds.has(c.id) && follows.includes(c.id)),
  ];
  const mineKey = mine.map((c) => c.id).join(',');
  const others = visible.filter((c) => !mine.includes(c));

  const { data: news } = usePlatformQuery(
    async () => {
      const published = await Promise.all(mine.slice(0, 8).map((c) => socialApi.postsByCreator(c.id).catch(() => [])));
      const byId = new Map(mine.map((c) => [c.id, c]));
      const items: NewsItem[] = [
        ...published.flat().filter((p) => !p.isDraft).map((p) => ({
          id: p.id,
          creator: byId.get(p.creatorProfileId)!,
          content: p.content,
          media: p.mediaType === 'image' ? p.mediaUrl : undefined,
          isLocked: p.isLocked,
          createdAt: p.createdAt,
        })),
        ...catalogPosts.filter((p) => byId.has(p.creatorId)).map((p) => ({
          id: p.id,
          creator: byId.get(p.creatorId)!,
          content: p.content,
          media: p.mediaType === 'image' ? p.media : undefined,
          isLocked: p.isLocked,
          createdAt: p.createdAt,
        })),
      ];
      return items.filter((n) => n.creator).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    [mineKey],
    [] as NewsItem[]
  );
  // Locked posts stay locked for fans who aren't subscribed to that creator.
  const newsItems = news
    .filter((n) => !platform.removedPosts.includes(n.id))
    .map((n) => ({ ...n, isLocked: n.isLocked && !subscribedIds.has(n.creator.id) }))
    .slice(0, NEWS_LIMIT);

  const now = new Date();
  const upcoming = bookings
    .filter((b) => ACTIVE.includes(reserveStatusOf(b, now)))
    .filter((b) => liveWindow(b.date, b.time, b.durationMinutes ?? 60, b.timeZone).closes > now)
    .sort((a, b) => zonedDate(a.date, a.time, a.timeZone).getTime() - zonedDate(b.date, b.time, b.timeZone).getTime());

  if (!user) return null;

  // Reserve experiences from the fan's own creators come first.
  const reserveCreators = [...mine, ...others];

  return (
    <div className="min-h-screen bg-canvas" data-testid="fan-home">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 md:py-10">
        <header className="mb-6 md:mb-8">
          <h1 className="font-display text-3xl font-bold tracking-tight text-ink md:text-4xl">Hola, {firstName(user.name)}</h1>
          <Link
            to="/explore"
            className="mt-4 flex items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3.5 text-ink/45 shadow-[var(--shadow-card)] transition hover:border-ink/20"
            data-testid="home-search"
          >
            <Icon name="fa-search" />
            <span>Buscar creadores o experiencias</span>
          </Link>
        </header>

        {upcoming.length > 0 && (
          <NextReserve booking={upcoming[0]} creator={visible.find((c) => c.id === upcoming[0].creatorProfileId)} more={upcoming.length - 1} />
        )}

        <section aria-labelledby="my-creators-title" className="mb-8">
          <RailHeading id="my-creators-title" title="Tus creadores" />
          {mine.length > 0 ? (
            <LiveRail creators={mine} liveIds={new Set()} />
          ) : (
            <div className="card p-5 text-center" data-testid="home-no-creators">
              <p className="font-semibold text-ink">Aún no sigues a ningún creador</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted">Sigue a quienes te gustan y aquí verás lo nuevo que publiquen y sus experiencias de Reserve.</p>
              <Link to="/explore" className="btn btn-primary btn-md mt-4">Explorar creadores</Link>
            </div>
          )}
        </section>

        {newsItems.length > 0 && (
          <section aria-labelledby="news-title" className="mb-8">
            <RailHeading id="news-title" title="Lo nuevo de tus creadores" />
            <NewsList items={newsItems} />
          </section>
        )}

        <section aria-labelledby="home-reserve-title" className="mb-8">
          <RailHeading id="home-reserve-title" title="Reserve disponible" to="/reserve" icon="fa-ticket" tone="text-gold-600" />
          <ReserveRail creators={reserveCreators} />
        </section>

        <section aria-labelledby="discover-title" className="mb-4">
          <RailHeading id="discover-title" title="Descubre más creadores" to="/explore" />
          <CategoryRail
            categories={categories}
            selected=""
            onSelect={(name) => navigate(name ? `/explore?category=${encodeURIComponent(name)}` : '/explore')}
          />
          {others.length > 0 && (
            <div className="mt-5">
              <LiveRail creators={others.slice(0, 12)} liveIds={new Set()} />
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default FanHome;
