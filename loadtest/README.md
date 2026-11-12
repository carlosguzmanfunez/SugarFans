# Prueba de carga (k6)

Simula muchas personas usando Fans Reserve a la vez y mide si la página aguanta.

## Qué hace

- `visitantes.js`: personas sin sesión que entran a Inicio, Explorar, un perfil de
  creador o Reserve. Pide lo mismo que el navegador: HTML y JS/CSS a Vercel, y las
  consultas públicas a Supabase. **Solo lectura**: no inicia sesión, no crea cuentas,
  no reserva, no paga y no llama a `/api` (PayPal, LiveKit, Didit).
- `realtime.js`: abre conexiones en vivo (las que usan la campanita y los cupos en
  vivo) a un canal de prueba, para ver cuántas acepta Supabase.

## Seguros

- Se niega a correr contra `fansreserve.com`. Solo links de Preview de Vercel.
- Se corta sola si más del 5 % de las peticiones falla.
- Preview y Producción **comparten la misma base de Supabase**: corre las pruebas
  grandes de noche y subiendo por niveles.

## Cómo correrla

1. GitHub > Actions > **Prueba de carga** > Run workflow.
2. `base_url`: el link del Preview (`https://...vercel.app`).
3. Primero `nivel = humo` (20 personas). Si sale bien: 200 → 500 → 1000 → 2000.
4. El resultado sale en español en el resumen de la ejecución.

Si el Preview pide login de Vercel: Vercel > Project > Settings > Deployment
Protection > Protection Bypass for Automation, copia el secreto y guárdalo en GitHub
como `VERCEL_AUTOMATION_BYPASS_SECRET`.

## Niveles

| Nivel | Pico | Duración aprox. |
|---|---|---|
| humo | 20 | 2 min |
| 200 | 200 | 5 min |
| 500 | 500 | 6 min |
| 1000 | 1000 | 7 min |
| 2000 | 2000 | 14 min |

Metas: errores < 2 %, 95 % de las respuestas de Supabase en menos de 1,5 s y de
Vercel en menos de 1 s.
