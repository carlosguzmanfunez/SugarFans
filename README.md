# Fans Reserve

**Conexiones más cercanas. Experiencias exclusivas.** · [fansreserve.com](https://fansreserve.com)

Fans Reserve es la plataforma donde creadores y sus verdaderos fans se conectan más allá del feed: membresías, contenido público y exclusivo, propinas y regalos, experiencias VIP y sesiones en vivo 1 a 1. Pensada para todo tipo de creadores (modelos, músicos, streamers, gamers, atletas, artistas, coaches e influencers). Solo para mayores de 18 años.

## Desarrollo

```bash
npm install
npm run dev        # http://localhost:3000
npm run build
npm run typecheck
npm run e2e        # pruebas de navegador en modo sin conexión (Playwright)
```

- Frontend: Vite + React + Tailwind, desplegado en Vercel.
- Backend: Supabase (Auth, Postgres con RLS, Storage, Realtime). Esquema en `supabase/migrations/`. Sin las variables `VITE_SUPABASE_*` la app usa un backend local en el navegador.

## Identidad de marca

El nombre, dominio, eslogan, correos de contacto y prefijo de almacenamiento viven en `src/config/brand.ts`. La interfaz, los textos legales de la app y los metadatos de `index.html` (título, SEO, Open Graph) se generan desde ahí. El logo actual es un wordmark tipográfico provisional (`src/components/BrandLogo.tsx`, `public/favicon.svg`).
