// Product feature flags, in one place.
//
// OPEN LIVE (the free public Live anyone signed in can watch) is a capability
// Fans Reserve keeps but does not offer: the product is Subscribe → exclusive
// content and Reserve → Reserve Event / Reserve 1:1. With the flag off there is no
// "Live" tab, no public Live directory, no "Iniciar Live" for everyone and no
// Live banners. The code, the LiveKit integration, the live_broadcasts table
// and the routes all stay, so turning it back on is a flag change:
//
//   front end:  VITE_ENABLE_OPEN_LIVE=true   (Vercel env, then redeploy)
//   server:     ENABLE_OPEN_LIVE=true        (Vercel env, read by api/live-token.ts)
//   database:   public.open_live_enabled() returning true
//               (supabase/migrations/20261004000004_subscriber_live_reserve_events.sql)
//
// All three default to off. The server checks are the ones that matter: hiding
// buttons alone is not access control.
export const ENABLE_OPEN_LIVE: boolean = import.meta.env.VITE_ENABLE_OPEN_LIVE === 'true';

// "ESTÁ PASANDO AHORA" (the landing stage of creators after the communities grid) is
// switched off until further notice. The component and its copy stay in the code
// (src/components/landing/HappeningNow.tsx, LIVE_NOW in src/content/landing.ts);
// turning it back on is VITE_ENABLE_HAPPENING_NOW=true in Vercel, then redeploy.
// Defaults to off.
export const ENABLE_HAPPENING_NOW: boolean = import.meta.env.VITE_ENABLE_HAPPENING_NOW === 'true';

// SUBSCRIBER LIVE (the group Live included in a subscription) is switched off too
// (Carlos, 2026-10-16): live video is only sold through Reserve, where every
// Reserve Event and Reserve 1:1 brings its own payment. A subscription now gives
// the creator's exclusive content. Creators get no "Iniciar Live", profiles show no
// "Live para suscriptores" and the server signs no token for one. Code, table and
// routes stay; turning it back on is a flag change:
//
//   front end:  VITE_ENABLE_SUBSCRIBER_LIVE=true   (Vercel env, then redeploy)
//   server:     ENABLE_SUBSCRIBER_LIVE=true        (Vercel env, read by api/live-token.ts)
//
// Both default to off. Reserve Events and Reserve 1:1 are not affected.
export const ENABLE_SUBSCRIBER_LIVE: boolean = import.meta.env.VITE_ENABLE_SUBSCRIBER_LIVE === 'true';

// Any creator Live (Open or Subscriber) on offer at all.
export const ENABLE_CREATOR_LIVE: boolean = ENABLE_OPEN_LIVE || ENABLE_SUBSCRIBER_LIVE;

// Whether a creator Live of this mode may be shown and entered.
export const broadcastModeEnabled = (mode: 'open' | 'subscriber'): boolean => (mode === 'open' ? ENABLE_OPEN_LIVE : ENABLE_SUBSCRIBER_LIVE);

// PAY PER POST (a single locked post sold on its own, e.g. a "$4.99" photo) is not
// part of the model (Carlos, 2026-11-05): Subscribe gives the creator's exclusive
// content and live video is sold through Reserve. There has never been a checkout
// for it; only the demo catalogue carries a per-post price (src/data/mockData.ts
// `price`), which the post card used to show as "$4.99" on the lock. With the flag
// off a locked post always reads "Suscriptores" and unlocks only with the
// subscription. The price field stays so the idea can be built later:
//
//   front end:  VITE_ENABLE_PAY_PER_POST=true   (Vercel env, then redeploy)
//
// Defaults to off. Turning it on would still need a real checkout on the server.
export const ENABLE_PAY_PER_POST: boolean = import.meta.env.VITE_ENABLE_PAY_PER_POST === 'true';

export const FEATURES = {
  openLive: ENABLE_OPEN_LIVE,
  subscriberLive: ENABLE_SUBSCRIBER_LIVE,
  happeningNow: ENABLE_HAPPENING_NOW,
  payPerPost: ENABLE_PAY_PER_POST,
} as const;
