# Mano derecha (monitoreo de la web)

Revisa la web sola y avisa. **Solo lee**: no mueve dinero, no cambia cuentas.

## Qué hace

| Cuándo (hora Honduras) | Qué hace |
|---|---|
| Cada hora, minuto 5 | Foto del dinero (última hora, hoy, mes) y de los problemas abiertos → `monitor_snapshots`. Actualiza el día en curso de `monitor_daily`. |
| En esa misma hora, si algo grave sube | Aviso en la campana del dueño (y al celular si tiene avisos activos): disputas, Reserve en disputa, incidentes de finanzas, retiros fallidos, tareas automáticas caídas. |
| 12:00 p. m. | Reporte de mediodía (de 12:00 a. m. a 12:00 p. m.) → `monitor_reports`, campana y correo. |
| 12:00 a. m. | Cierre del día (el día completo), cierra la fila de `monitor_daily`, campana y correo. |

Panel: **Admin → Inicio → Mano derecha** (`/admin?section=monitor`). Se recarga solo cada minuto y tiene "Actualizar ahora".

## Control en el celular

`https://fansreserve.com/control` (archivo `control.html`, aparte de la app): los mismos números en vivo en el teléfono **sin iniciar sesión**.

- El dueño crea una **llave privada** en el panel (Mano derecha › Control en el celular). Se muestra una sola vez; la base solo guarda su huella sha256 (`monitor_access_keys`). Máximo 3 activas.
- El link `…/control#k=<llave>` la deja guardada en ese teléfono (lo que va después de `#` no llega a ningún servidor) y la página la quita de la barra.
- La página llama `monitor_live(llave)`: calcula al momento con `monitor_build()` y suma últimas 24 h, 14 días y 4 reportes. Llave mala o revocada → `null`. Solo lee.
- Se recarga cada minuto. Sin internet muestra lo último que cargó.
- Si se pierde el celular: **Revocar** en el panel y deja de servir al instante.

## Dinero

Mismas reglas que "Todos los movimientos": cobrado (PayPal + Créditos, menos devuelto), comisión PayPal (real o 5.4% + $0.30), parte de creadores (70/30 actual, ventas anteriores 80%, regalos 60%).
"Fans Reserve con ISV" es lo que queda; "sin ISV" le resta el 15% de ISV, que solo se declara sobre la parte de Fans Reserve.

## Correo

La base pide a `GET /api/usage?report=1` que mande los reportes pendientes (solo a `ALERT_EMAIL`, por defecto carlos@fansreserve.com, cada reporte una vez). Si falla, lo vuelve a pedir cada hora durante 12 h y el panel muestra "No llegó al correo". Necesita `RESEND_API_KEY` y `SUPABASE_SERVICE_ROLE_KEY` en Vercel (ya están).

## Pausar o reactivar

```sql
-- Pausar todo
select cron.unschedule(jobid) from cron.job where jobname in ('monitor-hourly','monitor-midday','monitor-midnight');
-- Reactivar: volver a ejecutar el bloque 10 (las 3 líneas cron.schedule) de supabase/migrations/20261107210000_monitor_mano_derecha.sql
```

Qué hacer con cada alerta y el resto de procesos: `docs/operations/manual-operacion.md`.

Código: `supabase/migrations/20261107210000_monitor_mano_derecha.sql`, `supabase/migrations/20261107220000_monitor_control_celular.sql`, `control.html`, `src/components/AdminMonitor.tsx`, `src/lib/monitorReportEmail.ts`, `api/usage.ts`. Pruebas: `npm run build && node e2e/admin-monitor-ui.mjs && node e2e/control-page-ui.mjs`; base: `npm run test:monitor-live-db`.
