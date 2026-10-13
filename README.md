# Fans Reserve

**Conexiones más cercanas. Experiencias exclusivas.** · [fansreserve.com](https://fansreserve.com)

Fans Reserve es un marketplace internacional que conecta a creadores de contenido independientes con sus seguidores. Los fans pueden suscribirse a un creador (contenido exclusivo y Lives para suscriptores), enviarle regalos o propinas y reservar experiencias definidas por el propio creador: videollamadas 1:1 en la sala de la app, eventos en grupo y servicios profesionales presenciales (clases, coaching, meet & greet en eventos, sesiones en estudio). El creador presta el servicio; Fans Reserve facilita la contratación y el pago y retiene una comisión.

La plataforma prohíbe el contenido sexual explícito, los servicios sexuales, el escort y las citas remuneradas ("Reserva experiencias, no personas"). Es solo para mayores de 18 años porque hay pagos y reservas presenciales; los creadores verifican su identidad (Didit) antes de poder publicar o cobrar.

Repositorio: el nombre `SugarFans` es histórico (nombre anterior del proyecto) y se mantiene para no romper la integración con Vercel. La marca vigente es únicamente Fans Reserve.

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

El nombre, dominio, eslogan, correos de contacto y prefijo de almacenamiento viven en `src/config/brand.ts`. La interfaz, los textos legales de la app y los metadatos de `index.html` (título, SEO, Open Graph) se generan desde ahí. El logo es la "R que contiene una F" (`src/components/BrandLogo.tsx`, `public/favicon.svg`, recursos en `design/brand/`).

## Documentación

- `docs/product/reserve-vision.md`: reglas de Reserve, categorías y experiencias permitidas.
- `docs/historico/`: documentos de las primeras versiones. No describen el producto actual; se guardan solo como referencia.
