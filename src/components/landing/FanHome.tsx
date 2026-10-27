import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { posts as catalogPosts, type Creator } from '../../data/mockData';
import { backend } from '../../lib/backend';
import { socialApi } from '../../lib/social';
import { usePlatformQuery, platformApi, isCutOff } from '../../lib/platform';
import { useBackendData } from '../../lib/useBackendData';
import { onNewNotification } from '../../lib/live';
import { isActiveSubscription } from '../../lib/liveAccess';
import { reserveStatusOf, liveWindow, detailsOf, type VipBooking, type VipExperience } from '../../lib/vip';
import { RESERVE_MODALITIES, RESERVE_STATUSES } from '../../config/reserve';
import { zonedDate } from '../../lib/timeZones';
import type { Gift } from '../../lib/gifts';
import { formatPrice } from '../CreatorCard';
import { CoverImage } from '../CoverArt';
import PostCard, { type DisplayPost } from '../PostCard';
import Avatar from '../Avatar';
import LiveRoomButton from '../LiveRoomButton';
import Icon from '../Icon';
import Notice from '../Notice';
import TipDialog from '../TipDialog';
import GiftDialog from '../GiftDialog';
import GiftCelebration from '../GiftCelebration';
import ReportDialog from '../ReportDialog';

// What a signed-in fan opens the app to: a feed of the creators they follow, with
// their Reserve experiences mixed in, and on the side their next Reserve and new
// creators to discover. The product pitch stays on the visitor's page.

const firstName = (name: string) => name.trim().split(/\s+/)[0];
const ACTIVE: string[] = ['pending', 'countered', 'accepted', 'confirmed', 'reschedule_requested'];
const FEED_LIMIT = 20;
// A Reserve card after every few posts, and the suggestions carousel once.
const RESERVE_EVERY = 3;
const SUGGESTIONS_AFTER = 2;

type FeedPost = DisplayPost & { suggested: boolean };

const whenLabel = (b: VipBooking) =>
  zonedDate(b.date, b.time, b.timeZone)
    .toLocaleString('es', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
    .replace(/\./g, '');

const NextReserve: React.FC<{ booking: VipBooking; creator?: Creator; more: number }> = ({ booking, creator, more }) => {
  const status = RESERVE_STATUSES[reserveStatusOf(booking)];
  return (
    <section aria-labelledby="next-reserve-title" className="card overflow-hidden" data-testid="home-next-reserve">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 id="next-reserve-title" className="text-sm font-semibold text-ink">Tu próxima reserva</h2>
        <Link to="/profile#mis-reservas" className="text-sm font-semibold text-brand-700">
          {more > 0 ? `Ver todas (${more + 1})` : 'Ver'}
        </Link>
      </div>
      <div className="flex items-center gap-3 p-4">
        <Avatar src={creator?.avatar} name={booking.creatorName} size={48} decorative />
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink">{booking.title}</p>
          <p className="truncate text-sm text-muted">con {booking.creatorName}</p>
          <p className="text-sm text-ink/75 first-letter:uppercase">{whenLabel(booking)}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 pb-4">
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${status.className}`}>{status.label}</span>
        <LiveRoomButton booking={booking} />
      </div>
    </section>
  );
};

// A creator on their cover photo, avatar on top: the card the suggestions are made of.
const CreatorCoverCard: React.FC<{ creator: Creator; reserve: boolean; tag?: string }> = ({ creator, reserve, tag }) => (
  <Link to={`/creator/${creator.id}`} className="group relative block h-32 overflow-hidden rounded-2xl" data-testid="suggestion-card">
    <CoverImage
      src={creator.cover}
      seed={creator.id + creator.name}
      className="h-full w-full"
      imgClassName="transition duration-500 group-hover:scale-105"
    />
    <span className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/30 to-black/5" />
    {(tag || reserve) && (
      <span className={`absolute left-2.5 top-2.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${reserve ? 'bg-gold-300 text-night-950' : 'bg-black/45 text-white'}`}>
        {reserve ? 'Reserve' : tag}
      </span>
    )}
    <span className="absolute inset-x-3 bottom-3 flex items-end gap-3">
      <span className={`shrink-0 rounded-full p-[3px] ${reserve ? 'bg-gold-400' : 'bg-white'}`}>
        <Avatar src={creator.avatar} name={creator.name} size={64} decorative />
      </span>
      <span className="min-w-0 pb-1 text-white">
        <span className="flex items-center gap-1.5 truncate text-base font-semibold">
          {creator.name}
          {creator.isVerified && <i className="fas fa-circle-check text-sm text-white/90" aria-label="Verificado"></i>}
        </span>
        {creator.username && <span className="block truncate text-xs text-white/75">@{creator.username}</span>}
      </span>
    </span>
  </Link>
);

// Suggestions as cover cards in a row that swipes sideways.
const SuggestionsRail: React.FC<{ creators: Creator[]; reserveIds: Set<string> }> = ({ creators, reserveIds }) => (
  <ul className="rail -mx-4 gap-3 px-4 sm:mx-0 sm:px-0" aria-label="Creadores sugeridos">
    {creators.map((c) => (
      <li key={c.id} className="w-[78%] max-w-[320px]">
        <CreatorCoverCard creator={c} reserve={reserveIds.has(c.id)} tag={`$${c.subscriptionPrice}/mes`} />
      </li>
    ))}
  </ul>
);

// A Reserve experience inside the feed, in gold: the part of Fans Reserve a feed of posts doesn't have.
const ReserveFeedCard: React.FC<{ exp: VipExperience; creator: Creator }> = ({ exp, creator }) => {
  const modality = RESERVE_MODALITIES[detailsOf(exp).modality];
  return (
    <Link
      to={`/creator/${creator.id}#reserve`}
      className="block overflow-hidden rounded-2xl border border-gold-200 bg-gradient-to-br from-gold-50 to-white shadow-sm transition hover:border-gold-300"
      data-testid="feed-reserve"
    >
      <div className="flex items-center gap-3 p-4">
        <span className="rounded-full bg-gold-400 p-[3px]">
          <Avatar src={creator.avatar} name={creator.name} size={40} decorative />
        </span>
        <div className="min-w-0 text-sm">
          <p className="truncate font-semibold text-ink">{creator.name}</p>
          <p className="text-gold-700">tiene horarios en Reserve</p>
        </div>
        <Icon name="fa-ticket" className="ml-auto text-xl text-gold-600" />
      </div>
      <div className="px-4 pb-4">
        <p className="font-display text-xl font-semibold leading-snug text-ink">{exp.title}</p>
        {exp.description && <p className="mt-1 line-clamp-2 text-sm text-ink/70">{exp.description}</p>}
        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-sm text-muted">
            <i className={`fas ${modality.icon} mr-1 text-gold-600`} aria-hidden="true"></i>
            {modality.label}
            {exp.durationMinutes ? ` · ${exp.durationMinutes} min` : ''}
          </span>
          <span className="flex items-center gap-3">
            <span className="font-display text-lg font-semibold text-ink">{formatPrice(exp.price)}</span>
            <span className="btn btn-gold btn-sm">Solicitar</span>
          </span>
        </div>
      </div>
    </Link>
  );
};

// Creators as story-like avatars; a gold ring marks who has Reserve open.
const CreatorsRow: React.FC<{ creators: Creator[]; reserveIds: Set<string> }> = ({ creators, reserveIds }) => (
  <ul className="rail -mx-4 gap-4 px-4 py-1 sm:mx-0 sm:px-0" aria-label="Tus creadores" data-testid="home-creators">
    {creators.map((c) => (
      <li key={c.id} className="w-[72px]">
        <Link to={`/creator/${c.id}`} aria-label={reserveIds.has(c.id) ? `${c.name}, con Reserve disponible` : c.name} className="tab-press flex flex-col items-center gap-1.5 text-center">
          <span className={`rounded-full p-[3px] ${reserveIds.has(c.id) ? 'bg-gradient-to-tr from-gold-500 to-gold-300' : 'bg-line'}`}>
            <span className="block rounded-full bg-canvas p-[2px]">
              <Avatar src={c.avatar} name={c.name} size={60} decorative />
            </span>
          </span>
          <span className="w-full truncate text-xs font-medium text-ink/75">{firstName(c.name)}</span>
        </Link>
      </li>
    ))}
  </ul>
);

const FanHome: React.FC<{ creators: Creator[] }> = ({ creators }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const userId = user?.id;
  const [tipping, setTipping] = useState<FeedPost | null>(null);
  const [gifting, setGifting] = useState<FeedPost | null>(null);
  const [celebrating, setCelebrating] = useState<{ gift: Gift; to: string } | null>(null);
  const [reporting, setReporting] = useState<FeedPost | null>(null);
  const [notice, setNotice] = useState('');

  const { data: bookings, reload } = useBackendData(() => (user ? backend.fanBookings(user.id) : Promise.resolve([])), [userId], [] as VipBooking[]);
  // A creator's answer moves the next Reserve at once.
  useEffect(() => (userId ? onNewNotification(userId, reload) : undefined), [userId, reload]);
  const { data: follows } = usePlatformQuery(() => (user ? socialApi.myFollows(user) : Promise.resolve([])), [userId], [] as string[]);
  const { data: experiences } = usePlatformQuery(() => backend.listExperiences(), [], [] as VipExperience[]);
  const { data: platform } = usePlatformQuery(
    async () => {
      const [removedPosts, blocks] = await Promise.all([platformApi.removedPosts(), user ? platformApi.blocks(user) : Promise.resolve([])]);
      return { removedPosts, blocks };
    },
    [userId],
    { removedPosts: [] as string[], blocks: [] as Awaited<ReturnType<typeof platformApi.blocks>> }
  );

  const visible = creators.filter((c) => !user || !isCutOff(platform.blocks, user.id, c.id));
  const subs = user?.subscriptions ?? [];
  const subscribedIds = new Set(subs.filter((s) => isActiveSubscription(s)).map((s) => s.creatorId));
  const expired = visible.filter((c) => subs.some((s) => s.creatorId === c.id && !isActiveSubscription(s)));
  // Subscriptions first, then follows, in the order they appear in the catalogue.
  const mine = [
    ...visible.filter((c) => subscribedIds.has(c.id)),
    ...visible.filter((c) => !subscribedIds.has(c.id) && follows.includes(c.id)),
  ];
  const others = visible.filter((c) => !mine.includes(c));
  const activeExperiences = experiences.filter((e) => e.active && visible.some((c) => c.id === e.creatorProfileId));
  const reserveIds = new Set(activeExperiences.map((e) => e.creatorProfileId));
  // With few creators of their own, the feed fills up with suggested ones and never starts empty.
  const feedCreators = mine.length >= 3 ? mine : [...mine, ...others.slice(0, 6 - mine.length)];
  const feedKey = feedCreators.map((c) => c.id).join(',');
  const mineIds = new Set(mine.map((c) => c.id));

  const { data: feed } = usePlatformQuery(
    async () => {
      const byId = new Map(feedCreators.map((c) => [c.id, c]));
      const published = await Promise.all(feedCreators.slice(0, 10).map((c) => socialApi.postsByCreator(c.id).catch(() => [])));
      const items: DisplayPost[] = [
        ...published.flat().filter((p) => !p.isDraft && (!p.moderation || p.moderation === 'approved')).map((p) => ({
          id: p.id,
          creatorProfileId: p.creatorProfileId,
          creatorName: byId.get(p.creatorProfileId)?.name ?? '',
          creatorAvatar: byId.get(p.creatorProfileId)?.avatar ?? '',
          content: p.content,
          mediaUrl: p.mediaUrl,
          mediaType: p.mediaType,
          isLocked: p.isLocked,
          createdAt: p.createdAt,
          baseLikes: 0,
          baseComments: 0,
        })),
        ...catalogPosts.filter((p) => byId.has(p.creatorId)).map((p) => ({
          id: p.id,
          creatorProfileId: p.creatorId,
          creatorName: p.creatorName,
          creatorAvatar: p.creatorAvatar,
          content: p.content,
          mediaUrl: p.media,
          mediaType: p.mediaType,
          isLocked: p.isLocked,
          price: p.price,
          createdAt: p.createdAt,
          baseLikes: p.likes,
          baseComments: p.comments,
        })),
      ];
      const posts = items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, FEED_LIMIT);
      return { posts, engagement: await socialApi.engagement(posts.map((p) => p.id), user) };
    },
    [feedKey, userId],
    { posts: [] as DisplayPost[], engagement: {} as Awaited<ReturnType<typeof socialApi.engagement>> }
  );
  const posts: FeedPost[] = feed.posts
    .filter((p) => !platform.removedPosts.includes(p.id))
    .map((p) => ({ ...p, suggested: !mineIds.has(p.creatorProfileId) }));

  const now = new Date();
  const upcoming = bookings
    .filter((b) => ACTIVE.includes(reserveStatusOf(b, now)))
    .filter((b) => liveWindow(b.date, b.time, b.durationMinutes ?? 60, b.timeZone).closes > now)
    .sort((a, b) => zonedDate(a.date, a.time, a.timeZone).getTime() - zonedDate(b.date, b.time, b.timeZone).getTime());

  if (!user) return null;

  // Reserve cards for the feed: the fan's own creators first, one experience per creator.
  const reserveCards = [...mine, ...others].flatMap((c) => {
    const exp = activeExperiences.find((e) => e.creatorProfileId === c.id);
    return exp ? [{ exp, creator: c }] : [];
  });
  const suggestions = others.slice(0, 10);
  const nextReserve = upcoming.length > 0 && (
    <NextReserve booking={upcoming[0]} creator={visible.find((c) => c.id === upcoming[0].creatorProfileId)} more={upcoming.length - 1} />
  );

  const stream: React.ReactNode[] = [];
  posts.forEach((post, i) => {
    stream.push(
      <div key={post.id}>
        {post.suggested && <p className="mb-2 px-1 text-xs font-medium text-muted">Sugerencia para ti</p>}
        <PostCard
          post={post}
          engagement={feed.engagement[post.id]}
          viewer={user}
          canView={!post.isLocked || subscribedIds.has(post.creatorProfileId)}
          isOwner={false}
          subscribeLabel="Ver perfil para suscribirte"
          onSubscribe={() => navigate(`/creator/${post.creatorProfileId}`)}
          onNeedLogin={() => navigate('/login')}
          onTip={() => setTipping(post)}
          onGift={() => setGifting(post)}
          onReport={() => setReporting(post)}
        />
      </div>
    );
    const card = reserveCards[Math.floor(i / RESERVE_EVERY)];
    if ((i + 1) % RESERVE_EVERY === 0 && card) stream.push(<ReserveFeedCard key={`r-${card.exp.id}`} exp={card.exp} creator={card.creator} />);
    if (i + 1 === SUGGESTIONS_AFTER && suggestions.length) {
      stream.push(
        <section key="suggestions" aria-labelledby="feed-suggestions-title" className="lg:hidden">
          <h2 id="feed-suggestions-title" className="mb-3 px-1 text-sm font-semibold text-ink">Creadores que te pueden gustar</h2>
          <SuggestionsRail creators={suggestions} reserveIds={reserveIds} />
        </section>
      );
    }
  });

  return (
    <div className="min-h-screen bg-canvas" data-testid="fan-home">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-5 sm:px-6 md:py-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="mx-auto w-full max-w-[640px] min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink md:text-3xl">Hola, {firstName(user.name)}</h1>

          {mine.length > 0 && (
            <div className="mt-4">
              <CreatorsRow creators={mine} reserveIds={reserveIds} />
            </div>
          )}

          {notice && <div className="mt-4"><Notice ok text={notice} onClose={() => setNotice('')} /></div>}

          {nextReserve && <div className="mt-5 lg:hidden">{nextReserve}</div>}

          {mine.length === 0 && (
            <div className="card mt-5 p-5" data-testid="home-no-creators">
              <p className="font-semibold text-ink">Sigue a tus creadores para armar tu inicio</p>
              <p className="mt-1 text-sm text-muted">Mientras tanto te mostramos publicaciones de creadores que te pueden gustar.</p>
              <Link to="/explore" className="btn btn-primary btn-md mt-4">Explorar creadores</Link>
            </div>
          )}

          <div className="mt-5 space-y-5" data-testid="home-feed">
            {stream}
          </div>

          {posts.length > 0 && (
            <p className="py-8 text-center text-sm text-muted">
              Eso es todo por ahora. <Link to="/explore" className="font-semibold text-brand-700">Descubre más creadores</Link>
            </p>
          )}
        </div>

        <aside className="hidden lg:block" aria-label="Tu actividad y sugerencias">
          <div className="sticky top-24 space-y-6">
            <Link
              to="/explore"
              className="flex items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3 text-ink/45 transition hover:border-ink/20"
              data-testid="home-search"
            >
              <Icon name="fa-search" />
              <span>Buscar creadores o experiencias</span>
            </Link>
            {nextReserve}
            {suggestions.length > 0 && (
              <section aria-labelledby="side-suggestions-title">
                <div className="mb-3 flex items-center justify-between">
                  <h2 id="side-suggestions-title" className="text-sm font-semibold text-ink">Sugerencias</h2>
                  <Link to="/explore" className="text-sm font-semibold text-brand-700">Ver todo</Link>
                </div>
                <ul className="space-y-3">
                  {suggestions.slice(0, 3).map((c) => (
                    <li key={c.id}><CreatorCoverCard creator={c} reserve={reserveIds.has(c.id)} tag={`$${c.subscriptionPrice}/mes`} /></li>
                  ))}
                </ul>
              </section>
            )}
            {expired.length > 0 && (
              <section aria-labelledby="expired-title">
                <h2 id="expired-title" className="mb-3 text-sm font-semibold text-ink">Suscripciones vencidas</h2>
                <ul className="space-y-3">
                  {expired.slice(0, 3).map((c) => (
                    <li key={c.id}><CreatorCoverCard creator={c} reserve={false} tag="Renovar" /></li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </aside>
      </div>

      {tipping && (
        <TipDialog
          user={user}
          creatorProfileId={tipping.creatorProfileId}
          creatorName={tipping.creatorName}
          postId={tipping.id}
          onDone={(amount) => {
            setNotice(`¡Gracias! Tu propina de $${amount.toFixed(2)} llegó a ${tipping.creatorName}.`);
            setTipping(null);
          }}
          onClose={() => setTipping(null)}
        />
      )}
      {gifting && (
        <GiftDialog
          user={user}
          creatorProfileId={gifting.creatorProfileId}
          creatorName={gifting.creatorName}
          postId={gifting.id}
          onSent={(gift) => {
            setCelebrating({ gift, to: gifting.creatorName });
            setNotice(`¡${gift.icon} ${gift.name} enviado a ${gifting.creatorName}!`);
            setGifting(null);
          }}
          onClose={() => setGifting(null)}
        />
      )}
      {celebrating && <GiftCelebration gift={celebrating.gift} caption={`¡${celebrating.gift.name} para ${celebrating.to}!`} onDone={() => setCelebrating(null)} />}
      {reporting && (
        <ReportDialog kind="post" targetId={reporting.id} targetLabel={`Publicación de ${reporting.creatorName}: "${reporting.content.slice(0, 40)}"`} onClose={() => setReporting(null)} />
      )}
    </div>
  );
};

export default FanHome;
