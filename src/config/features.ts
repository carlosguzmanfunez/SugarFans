// Product feature flags, in one place.
//
// OPEN LIVE (the free public Live anyone signed in can watch) is a capability
// Fans Reserve keeps but does not offer: the product is Subscribe → Subscriber
// Live and Reserve → Reserve Event / Reserve 1:1. With the flag off there is no
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

export const FEATURES = {
  openLive: ENABLE_OPEN_LIVE,
  happeningNow: ENABLE_HAPPENING_NOW,
} as const;
